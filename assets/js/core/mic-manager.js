/* ============================================================
   六弦工坊 V3.1 · core/mic-manager.js
   ------------------------------------------------------------
   按《V3物理机实测Bug修复方案》§1 实现，根治 BUG-2/4/6：
     R1 single-flight：requesting 期间重复 start() 复用同一 pending promise
     R2 超时：getUserMedia 10s 超时（AbortController 竞速），不再永久挂起
     R3 只用系统默认麦克风：constraints 不带 deviceId（无任何设备切换逻辑）
     R4 诊断：失败/超时输出 lastDiagnostics（协议/安全上下文/err.name/人话指引）
     R5 竞态安全：stop 后到达的回调/帧全部丢弃（token 校验）
   对外签名与旧 Mic 完全一致：start(onPitch)→Promise<boolean>，stop()。
   ============================================================ */
'use strict';

/* V3.2：基频检测来自 AudioCore（window 全局，由 core/audio-core.js 挂载）。
   Mic 从 audio-engine 拆出后不再继承其解构作用域，这里按帧惰性取值，
   避免模块求值顺序导致的 ReferenceError（表现为「麦克风开了但永远不识别」）。 */
const pitchOf = () => (typeof window !== 'undefined' && window.AudioCore && window.AudioCore.PitchDetect) || null;

const MIC_TIMEOUT_MS = 10000;

function buildDiagnostics(err) {
  const secure = !!(window.isSecureContext);
  const hasAPI = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  const name = err && err.name || (secure ? (hasAPI ? 'TimeoutError' : 'NoAPI') : 'InsecureContext');
  const hints = {
    NotAllowedError: '麦克风权限被拒绝：点击地址栏左侧 🔒 图标，把麦克风改为「允许」后重试',
    PermissionDeniedError: '麦克风权限被拒绝：点击地址栏左侧 🔒 图标，把麦克风改为「允许」后重试',
    NotFoundError: '没有检测到麦克风设备：请检查麦克风是否连接/启用',
    DevicesNotFoundError: '没有检测到麦克风设备：请检查麦克风是否连接/启用',
    NotReadableError: '麦克风被其他应用占用：请关闭微信/腾讯会议/OBS 等占用麦克风的程序后重试',
    TrackStartError: '麦克风被其他应用占用：请关闭占用程序后重试',
    OverconstrainedError: '麦克风参数不受支持：请更换浏览器（推荐 Chrome/Edge）',
    AbortError: '10 秒内未获得系统响应：请检查 Windows 设置 → 隐私和安全性 → 麦克风 → 允许桌面应用访问麦克风',
    TimeoutError: '10 秒内未获得系统响应：请检查 Windows 设置 → 隐私和安全性 → 麦克风 → 允许桌面应用访问麦克风',
    NoAPI: '当前浏览器不支持麦克风（navigator.mediaDevices 缺失）：请换 Chrome/Edge',
    InsecureContext: 'HTTP 明文访问已禁用麦克风：请用 localhost、局域网 HTTPS 或 GitHub Pages 访问',
  };
  return {
    errName: name,
    hint: hints[name] || '无法访问麦克风：请检查设备与浏览器权限设置',
    secure, hasAPI,
    protocol: location.protocol,
    hostname: location.hostname,
    insecure: !secure,
    onLanHttp: !secure && !['localhost', '127.0.0.1'].includes(location.hostname),
    ua: navigator.userAgent,
    at: new Date().toISOString(),
  };
}

const Mic = {
  state: 'idle',            // idle | requesting | running
  lastDiagnostics: null,
  deviceId: null,           // V3.2：选定的输入设备（F10 设备切换；null = 系统默认）
  _cb: null,
  _stream: null,
  _ctx: null,
  _analyser: null,
  _buf: null,
  _raf: null,
  _frame: 0,
  _token: 0,                // R5：stop 后旧回调作废
  _pending: null,           // R1：single-flight

  /* 对外只读视图：供调试与自动化测试观察采集链路状态（内部字段保持私有） */
  get stream(){ return this._stream; },
  get analyser(){ return this._analyser; },
  get ctx(){ return this._ctx; },
  get micCtx(){ return this._ctx; },        // 兼容旧字段名
  get running(){ return this.state === 'running'; },

  /* V3.2：第二参数 deviceId 为可选的输入设备 id（F10 设备切换）。
     不传则使用系统默认麦克风；传入时以 exact 申请，失败回落到默认设备，
     避免「选了设备却拿不到声音」。 */
  start(onPitch, deviceId) {
    if (deviceId !== undefined && deviceId !== null) this.deviceId = deviceId;
    // R1：进行中的请求直接复用
    if (this.state === 'requesting' && this._pending) return this._pending;
    if (this.state === 'running') {
      this._cb = onPitch || this._cb;   // 复用已运行的采集，仅换回调
      return Promise.resolve(true);
    }

    /* P0-03：安全上下文/接口存在性前置校验（同步失败分支，立刻给出原因） */
    if (!window.isSecureContext) {
      this.lastDiagnostics = buildDiagnostics({ name: 'InsecureContext' });
      if (this.lastDiagnostics.onLanHttp) {
        toast('手机局域网 HTTP 访问无法开启麦克风（浏览器安全策略）。', 'err', 4500);
        toast('解决：A. 用 GitHub Pages 的 HTTPS 地址；B. 局域网 HTTPS（见 README）', 'err', 5500);
      } else {
        toast(this.lastDiagnostics.hint, 'err', 4500);
      }
      return Promise.resolve(false);
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.lastDiagnostics = buildDiagnostics({ name: 'NoAPI' });
      toast(this.lastDiagnostics.hint, 'err', 4500);
      return Promise.resolve(false);
    }

    const myToken = ++this._token;
    this.state = 'requesting';

    /* R2：getUserMedia + 10s 超时竞速
       采集参数与「录音棚」保持一致：关回声消除与降噪，但不强制关闭自动增益——
       实测部分声卡在 autoGainControl:false 下输入电平极低，调音器采不到信号。 */
    const base = { echoCancellation: false, noiseSuppression: false };
    const want = this.deviceId ? Object.assign({ deviceId: { exact: this.deviceId } }, base) : base;
    const gUM = navigator.mediaDevices.getUserMedia({ audio: want })
      .catch((err) => {
        // 指定设备不可用（拔掉/被占用）时回落到默认麦克风，不让用户卡死
        if (this.deviceId && err && (err.name === 'OverconstrainedError' || err.name === 'NotFoundError')) {
          this.deviceId = null;
          return navigator.mediaDevices.getUserMedia({ audio: base });
        }
        throw err;
      });
    const timer = new Promise((_, rej) =>
      setTimeout(() => rej({ name: 'TimeoutError' }), MIC_TIMEOUT_MS));

    this._pending = Promise.race([gUM, timer])
      .then(async (stream) => {
        if (myToken !== this._token) {          // R5：期间被 stop
          stream.getTracks().forEach(t => t.stop());
          this.state = 'idle'; this._pending = null;
          return false;
        }
        this._stream = stream;
        const AC = window.AudioContext || window.webkitAudioContext;
        this._ctx = new AC();
        /* V3.2：手机/桌面切后台回来后 AudioContext 常处于 suspended，
           不 resume 会导致「采集到了但界面永远不动」。 */
        if (this._ctx.state === 'suspended') { try { await this._ctx.resume(); } catch (e) {} }
        const src = this._ctx.createMediaStreamSource(stream);
        this._analyser = this._ctx.createAnalyser();
        this._analyser.fftSize = 2048;
        src.connect(this._analyser);
        this._buf = new Float32Array(this._analyser.fftSize);
        this._cb = onPitch;
        this._frame = 0;
        this.state = 'running';
        this._pending = null;
        this._loop(myToken);
        return true;
      })
      .catch((err) => {
        if (myToken !== this._token) { this.state = 'idle'; this._pending = null; return false; }
        this.state = 'idle'; this._pending = null;
        this.lastDiagnostics = buildDiagnostics(err);
        console.warn('[MicManager] 启动失败：', err, this.lastDiagnostics);
        toast(this.lastDiagnostics.hint, 'err', 5000);
        return false;
      });

    return this._pending;
  },

  _loop(token) {
    /* P2-19：~30fps（隔帧检测），低端机不掉帧 */
    this._raf = requestAnimationFrame(() => {
      if (token !== this._token || this.state !== 'running') return;   // R5
      if (++this._frame % 2 === 0) { this._loop(token); return; }
      const detect = pitchOf();
      if (!detect) {                 // 音频核心尚未就绪：下一帧再试，不抛错
        this._loop(token);
        return;
      }
      this._analyser.getFloatTimeDomainData(this._buf);
      const r = detect(this._buf, this._ctx.sampleRate);
      if (this._cb) this._cb(r);
      this._loop(token);
    });
  },

  stop() {
    this._token++;                       // R5：作废在途回调
    this._cb = null;                     // P0-02：停止后不再向任何模块回调
    this.state = 'idle';
    this._pending = null;
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
    if (this._stream) { this._stream.getTracks().forEach(t => t.stop()); this._stream = null; }
    if (this._ctx) { this._ctx.close().catch(() => {}); this._ctx = null; }
    this._analyser = null; this._buf = null;
  },
};

window.Mic = Mic;
export { Mic, buildDiagnostics };
export default Mic;
