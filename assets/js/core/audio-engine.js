/* ============================================================
   六弦工坊 V3 · 音频引擎与麦克风 core/audio-engine
   （M3 目录重构：由 V2 app-*.js 拆分，代码体保持不变）
   ============================================================ */
'use strict';

/* BUG-01 修复：ESM 模块作用域下 PitchDetect 需从 AudioCore 解构引入
   （与 ui.js / tuner.js 保持一致的写法） */
const { PitchDetect } = AudioCore;

/* ============================================================
   音频引擎（原生 Web Audio，全部本地处理）
   ============================================================ */
const AudioEngine = {
  ctx:null, master:null,
  ensure(){
    if(!this.ctx){
      this.ctx = new (window.AudioContext||window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = .5;
      this.master.connect(this.ctx.destination);
      this._integrateTone();   // V3 M2：Tone 就绪后切换到统一上下文与总线
    }
    if(this.ctx.state==='suspended') this.ctx.resume();
    return this.ctx;
  },
  /* R-BUS-01：AudioEngine 的原生节点汇入 tone-engine 的 music 总线，
     全应用共享同一个 AudioContext（同一时钟） */
  _integrateTone(){
    ToneEngine.ensure().then(Tone=>{
      if(!Tone) return;
      const rawCtx = Tone.getContext().rawContext;
      if(this.ctx && !this.ctx.__gsShared && rawCtx.state!==undefined){
        // BUG-02 修复：替换上下文时必须同步重建 master，
        // 否则 master 属于旧 AudioContext，跨上下文连接必然失败，
        // 且失败前 master.disconnect() 会让它成为悬空节点（全站静音）
        //
        // P1-1 修复：Tone 异步接管发生在「首次音频手势之后」的极窄竞态窗口内时，
        // Rhythm.demoGain/metroGain、ChordLib 等早期消费节点仍挂在旧 master 上。
        // 若此时 disconnect 旧 master，它既不接 Tone 新总线也不接旧 destination，
        // 会变成永久悬空的静音节点（节奏/进度伴奏一路失声，必须刷新页面恢复）。
        // 做法：保留旧 master → 旧 ctx.destination 的输出，让早期声部继续有声；
        // 仅把「今后」新建的节点切到 Tone 共享上下文/总线。代价仅是接管瞬间
        // 短暂存在两个上下文（首屏 main.js 已预取 Tone，正常情况下此窗口不会出现）。
        const vol = this.master ? this.master.gain.value : .5;
        const oldMaster = this.master;
        this.ctx = rawCtx; rawCtx.__gsShared = true;
        this.master = rawCtx.createGain();
        this.master.gain.value = vol;
        this.master.connect(rawCtx.destination);   // 兜底直连，保证一定有声
        void oldMaster;   // 显式保留：旧 master 仍连在旧 ctx.destination 上，不 disconnect
      }
      const bus = ToneEngine.rawBuses && ToneEngine.rawBuses.music;
      if(this.master && bus && bus instanceof AudioNode){
        this.master.disconnect();
        this.master.connect(bus);
      }
    }).catch(e=>{
      // BUG-02 修复：任何失败都要把 master 接回 destination，绝不留下悬空节点
      console.warn('[audio-engine] Tone 总线接入失败，走原生输出：', e&&e.message);
      try{ this.master && this.master.connect(this.ctx.destination); }catch(_){}
    });
  },
  /* 拨弦合成：三角波基音 + 泛音 + 指数衰减 */
  pluck(freq, when=0, dur=1.6, vol=.32){
    const ctx=this.ensure(), t0=ctx.currentTime+when;
    const g=ctx.createGain();
    g.connect(this.master);
    const partials=[
      {type:'triangle',ratio:1, gain:1.0, decay:1.0},
      {type:'sine',    ratio:2, gain:.32,decay:.55},
      {type:'sine',    ratio:3, gain:.16,decay:.32},
      {type:'sine',    ratio:4, gain:.07,decay:.18}
    ];
    partials.forEach(p=>{
      const o=ctx.createOscillator(), pg=ctx.createGain();
      o.type=p.type; o.frequency.value=freq*p.ratio;
      pg.gain.value=p.gain;
      o.connect(pg); pg.connect(g);
      const pd=dur*p.decay;
      pg.gain.setValueAtTime(0,t0);
      pg.gain.linearRampToValueAtTime(vol*p.gain, t0+0.004);
      pg.gain.exponentialRampToValueAtTime(0.0001, t0+pd);
      o.start(t0); o.stop(t0+pd+.05);
    });
    // 起音小噪声，模拟拨弦
    return t0;
  },
  /* 扫弦：从低音弦到高音弦依次拨响（when 为音频时钟偏移，供进度伴奏提前调度） */
  strum(freqs, dir='down', vol=.28, when=0){
    const order = dir==='down' ? freqs : freqs.slice().reverse();
    order.forEach((f,i)=> this.pluck(f, when + i*0.032, 1.8, vol));
  },
  /* 节拍器 click：方波短促 */
  click(accent=false, when=0){
    const ctx=this.ensure(), t0=ctx.currentTime+when;
    const o=ctx.createOscillator(), g=ctx.createGain(), f=ctx.createBiquadFilter();
    o.type='square';
    o.frequency.value = accent?1600:1050;
    f.type='lowpass'; f.frequency.value=2400;
    g.gain.setValueAtTime(accent?.42:.28, t0);
    g.gain.exponentialRampToValueAtTime(.0001, t0+.055);
    o.connect(f); f.connect(g); g.connect(this.master);
    o.start(t0); o.stop(t0+.07);
  },
  /* 纯音（练耳、参考音） */
  tone(freq, dur=1.2, type='sine', vol=.25, when=0){
    const ctx=this.ensure(), t0=ctx.currentTime+when;
    const o=ctx.createOscillator(), g=ctx.createGain();
    o.type=type; o.frequency.value=freq;
    g.gain.setValueAtTime(.0001,t0);
    g.gain.linearRampToValueAtTime(vol,t0+.02);
    g.gain.setValueAtTime(vol,t0+dur-.06);
    g.gain.exponentialRampToValueAtTime(.0001,t0+dur);
    o.connect(g); g.connect(this.master);
    o.start(t0); o.stop(t0+dur+.05);
    return t0;
  }
};

/* ---------- 麦克风管理 ---------- */
/* P0-03 修复：HTTP 明文（非 localhost）下浏览器判定非安全上下文，
   navigator.mediaDevices 本身是 undefined，直接调用会抛 TypeError。
   先做存在性/安全性校验，把「为什么不能用」讲清楚，再谈授权。 */
function micGuard(){
  if(!window.isSecureContext){
    toast('当前是 HTTP 明文访问，浏览器已禁用麦克风。','err',4500);
    toast('请用 HTTPS 域名访问（Cloudflare 橙云 / Caddy / certbot）或本机 localhost。','err',4500);
    return false;
  }
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
    toast('当前浏览器未开放麦克风接口，请更换 Chrome/Edge 并用 HTTPS 访问。','err',4500);
    return false;
  }
  return true;
}
const Mic = {
  // BUG-04 修复：麦克风使用独立上下文字段，绝不覆盖/关闭播放上下文
  stream:null, micCtx:null, deviceId:null, analyser:null, raf:null, cb:null, frame:0,
  async start(onPitch, deviceId){
    // P0-02 修复：Mic 为全局单例，复用旧流时必须刷新回调，
    // 否则切换模块后检测结果仍发给旧模块、判定完全失效
    this.cb = onPitch;
    // F10：指定了设备且当前流来自其它设备时，先释放旧流再重开
    if(this.stream && deviceId && deviceId === this.deviceId) return true;
    if(this.stream && deviceId && deviceId !== this.deviceId){
      this.stop();
    }
    if(this.stream) return true; // 已有流：只换回调，不重复申请
    // Bug1 修复：getUserMedia 在途（权限弹窗未决/设备初始化慢）时并发再点会拿到
    // 第二条流，第一次 resolve 的 stream/micCtx/rAF 被覆盖而永不释放（麦灯常亮、CPU 翻倍）。
    // 复用同一个在途承诺，并发调用共享一次申请与一套音频图。
    if(this._starting) return this._starting;
    this._starting = this._startInner(onPitch);
    try{ return await this._starting; }
    finally{ this._starting = null; }
  },
  async _startInner(onPitch){
    if(!micGuard()) return false; // P0-03：安全上下文/接口存在性前置校验
    const audioConstraint = {echoCancellation:false, noiseSuppression:false, autoGainControl:false};
    if(deviceId) audioConstraint.deviceId = { exact: deviceId };
    try{
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint });
      this.deviceId = deviceId || (this.stream.getAudioTracks()[0] &&
        this.stream.getAudioTracks()[0].getSettings &&
        this.stream.getAudioTracks()[0].getSettings().deviceId) || null;
    }catch(err){
      console.warn(err);
      if(err && (err.name==='NotAllowedError'||err.name==='SecurityError'))
        toast('麦克风权限被拒绝，请在浏览器地址栏允许麦克风','err',3200);
      else
        toast('无法访问麦克风，请检查设备或使用 localhost/HTTPS 访问','err',3200);
      return false;
    }
    const AC = window.AudioContext||window.webkitAudioContext;
    this.micCtx = new AC();
    const src=this.micCtx.createMediaStreamSource(this.stream);
    this.analyser=this.micCtx.createAnalyser();
    this.analyser.fftSize=2048;
    src.connect(this.analyser);
    this.buf=new Float32Array(this.analyser.fftSize);
    this.frame=0;
    const loop=()=>{
      // P2-19 修复：PitchDetect 为 O(maxLag×SIZE)，rAF(~60fps) 全帧检测
      // 在低端手机易掉帧，降为 ~30fps（隔帧检测）
      this.raf=requestAnimationFrame(loop);
      if(++this.frame%2===0) return;
      this.analyser.getFloatTimeDomainData(this.buf);
      const r=PitchDetect(this.buf, this.micCtx.sampleRate);
      if(this.cb) this.cb(r); // P0-02：始终调用最新回调
    };
    loop();
    return true;
  },
  stop(){
    this.cb=null; // P0-02：停止后不再向任何模块回调
    if(this.raf) cancelAnimationFrame(this.raf);
    this.raf=null;
    if(this.stream){ this.stream.getTracks().forEach(t=>t.stop()); this.stream=null; }
    if(this.micCtx){ this.micCtx.close(); this.micCtx=null; }
  }
};

/* V2 M1：PitchDetect（归一化自相关基频检测，含 MPM 抗低八度误锁与抛物线插值）
   与 makeSmoother（中位数平滑）已迁移至 lib/audio-core.js，由顶部解构引入，
   算法回归测试见 test/audio-core.test.js。 */

Object.assign(window, { AudioEngine, Mic, micGuard });
export { AudioEngine, Mic, micGuard };
