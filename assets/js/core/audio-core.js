/* ============================================================
   六弦工坊 · 音频核心算法库（V2 · M1 工程化改造）
   ------------------------------------------------------------
   按《产品需求文档与升级方案 v2.0》M1 里程碑要求，将 V1 散落在
   app-*.js 中的音频算法（自相关测频、平滑滤波、音名换算、节拍
   调度、闯关判定）抽取为无副作用的纯函数模块：
     · 浏览器：ESM 具名导出 + window.AudioCore 兼容（V3.0 M3）
     · Node.js：import 直接加载（package.json type=module）
   迁移原则：算法行为与 V1 保持一致（回归测试见 test/）。
   ============================================================ */
  /* ---------- 音乐常量 ---------- */
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const NOTE_CN = { 'C': '哆', 'C#': '升哆', 'D': '来', 'D#': '升来', 'E': '咪', 'F': '发', 'F#': '升发', 'G': '嗦', 'G#': '升嗦', 'A': '拉', 'A#': '升拉', 'B': '西' };
  const OPEN_MIDI = [40, 45, 50, 55, 59, 64]; // 标准调弦 6弦→1弦
  const FREQ_MIN = 50;    // 测频下限（低音区）
  const FREQ_MAX = 1320;  // 测频上限（E6）

  /* ---------- 基础工具 ---------- */
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /* ---------- 音高换算（a4 基准可调，默认 440Hz） ---------- */
  const midiFromFreq = (f, a4) => 69 + 12 * Math.log2(f / (a4 || 440));
  const freqFromMidi = (m, a4) => (a4 || 440) * Math.pow(2, (m - 69) / 12);

  function noteName(midi) { return NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1); }
  function noteNameNoOct(midi) { return NOTE_NAMES[((midi % 12) + 12) % 12]; }
  function pitchClass(midi) { return ((midi % 12) + 12) % 12; }

  /* 音名 → 半音类。
     Bug 修复：V1 用 n.replace('b','#')，导致降号名 'Bb' 被错误替换为 'B#'
     而查表得 -1，和弦闯关中 C7 的 Bb 构成音会被误判为错音。
     现支持升号（C#）与降号（Db）两种写法。 */
  function pcFromName(name) {
    if (typeof name !== 'string') return -1;
    const s = name.trim();
    if (!s) return -1;
    const base = s.charAt(0).toUpperCase();
    const baseIdx = NOTE_NAMES.reduce((acc, n, i) => (n.charAt(0) === base && acc === -1) ? i : acc, -1);
    if (baseIdx < 0) return -1;
    const suffix = s.slice(1);
    let pc = baseIdx;
    for (const ch of suffix) {
      if (ch === '#') pc++;
      else if (ch === 'b') pc--;
      else return -1;
    }
    return ((pc % 12) + 12) % 12;
  }

  /* 两频率间音分差（可为负） */
  const centsBetween = (f1, f2) => 1200 * Math.log2(f1 / f2);

  /* ---------- YIN 基频检测（算法参考 hybridpicker/pro-tuner） ----------
     ------------------------------------------------------------
     重写背景（上一代 = NSDF 自相关 + MPM 峰选）：
       · RMS 硬门限高达 0.01 —— 麦克风离音孔稍远、或轻拨时整帧被判死，
         界面表现为「指针不动 / 识别不到」（本次要解决的核心问题之一）；
       · NSDF 在真实拨弦（强二次谐波 + 噪声）下偶发低八度误锁。
     现按 YIN（de Cheveigné & Kawahara, 2002）实现：
       d(τ) 差分函数 → CMNDF 累积均值归一化 → 绝对门限 0.11（兜底 0.18）
       → 抛物线插值（亚样本精度）→ clarity = 1 − CMNDF(τ*)
     CMNDF 自带幅度归一化且对每个 lag 用「之前的均值」归一，天然抑制
     长滞后处的低八度误锁，灵敏度也显著优于 NSDF + 全局 argmax。

     【纯度约定】本函数保持「单帧纯函数」：
       · 不修改输入缓冲（既有回归测试断言）；
       · 不持有跨帧状态 —— 中值滤波 / EMA / 起音检测由 createPitchTracker 承担，
         这样同一进程内连续喂不同音高不会被历史平滑拖住（单测也依赖此性质）。
     ------------------------------------------------------------ */
  const YIN_THRESHOLD = 0.11;           // YIN 绝对门限（参考实现的实测取值）
  const YIN_FALLBACK = 0.18;            // 无谷低于门限时的兜底门限
  const YIN_CLARITY_MIN = 0.25;         // clarity 下限，与旧实现的语义一致
  /* 电平门限：只用于剔除「完全静音」这种无效帧；真正的灵敏度决策
     交给调用方的噪声门（makeNoiseGate），参考实现亦如此分工。
     旧值 0.01 相当于把灵敏度砍掉一个数量级，是远场拾音失效的主因。 */
  const YIN_LEVEL_GATE = 5e-4;

  /* 单帧工作区：实时路径每帧分配 TypedArray 会造成 GC 抖动，
     这里按 (SIZE, maxLag) 缓存复用；本函数全同步执行，无重入风险。 */
  let _mSize = -1, _mMaxLag = -1, _mX = null, _mTmp = null, _mDiff = null, _mCm = null;
  function _mem(size, maxLag) {
    if (_mSize === size && _mMaxLag >= maxLag) return;
    _mSize = size; _mMaxLag = maxLag;
    _mX = new Float32Array(size);
    _mTmp = new Float32Array(size);
    _mDiff = new Float64Array(maxLag + 1);
    _mCm = new Float64Array(maxLag + 1);
  }

  /* 前置低通：4 点滑动平均 ×2 次（首零点 ~12kHz）。
     YIN 的差分函数会把通带内所有噪声能量全额累加：实测在「极低电平 + 宽带噪声」
     的远场场景下，E2 的偏差可达 40¢ 以上且是系统性偏移（不是随机抖动，
     跨帧平滑也压不住）。加这道低通把差分函数的噪声带宽先收窄，
     同一次测量下最差偏差由 42¢ 降到 ~3¢，正常电平下则由 0.6¢ 改善到 0.2¢。
     滑动平均是线性相位，对周期信号只是整体延时一个常量，周期不变 →
     不会引入音分偏差；1320Hz（测频上限）处的幅度损失 <3%，可忽略。 */
  const YIN_PRE_L = 4, YIN_PRE_PASSES = 2;
  function _lowpass(x, size) {
    const tmp = _mTmp, L = YIN_PRE_L;
    for (let p = 0; p < YIN_PRE_PASSES; p++) {
      let acc = 0;
      for (let i = 0; i < size; i++) {
        acc += x[i];
        if (i >= L) acc -= x[i - L];
        tmp[i] = acc / (i + 1 < L ? i + 1 : L);
      }
      x.set(tmp.subarray(0, size));
    }
    return x;
  }

  function PitchDetect(buf, sampleRate) {
    const SIZE = buf.length;
    const out = { freq: null, rms: 0, clarity: 0 };
    if (!SIZE || SIZE < 128) return out;
    // 去直流：写进工作区副本，输入缓冲保持只读（回归：PitchDetect 不修改输入缓冲）
    let mean = 0;
    for (let i = 0; i < SIZE; i++) mean += buf[i];
    mean /= SIZE;
    let e2 = 0;
    for (let i = 0; i < SIZE; i++) { const v = buf[i] - mean; e2 += v * v; }
    const rms = Math.sqrt(e2 / SIZE);
    out.rms = rms;
    if (!(rms > YIN_LEVEL_GATE)) return out;        // 静音帧

    /* YIN 要求 maxLag 不超过半个分析窗；低频下限再压一道。
       minLag 由上限频率反推，避免检出高于吉他的泛音级频率。 */
    const maxLag = Math.min(SIZE >> 1, Math.floor(sampleRate / FREQ_MIN));
    const minLag = Math.max(2, Math.floor(sampleRate / FREQ_MAX));
    if (maxLag <= minLag + 2) return out;
    /* 必须先把 lag 范围定下来再申请工作区：_mem 会因 maxLag 变大而
       重新分配 _mX，若已写入去直流结果就会被整片清零（历史坑）。 */
    _mem(SIZE, maxLag);
    const x = _mX;
    for (let i = 0; i < SIZE; i++) x[i] = buf[i] - mean;
    const diff = _mDiff, cmndf = _mCm;
    // 差分函数之前先收窄噪声带宽（见 _lowpass 注释）
    _lowpass(x, SIZE);

    // Step 1：差分函数 d(τ) = Σ (x[j] − x[j+τ])²
    diff[0] = 0;
    for (let tau = 1; tau <= maxLag; tau++) {
      const n = SIZE - tau;
      let s = 0;
      for (let j = 0; j < n; j++) { const d = x[j] - x[j + tau]; s += d * d; }
      diff[tau] = s;
    }
    // Step 2：累积均值归一化 d'(τ) = d(τ) / ((1/τ)·Σ_{k≤τ} d(k))，d'(0)=1
    cmndf[0] = 1;
    let run = 0;
    for (let tau = 1; tau <= maxLag; tau++) {
      run += diff[tau];
      cmndf[tau] = run > 0 ? (diff[tau] * tau) / run : 1;
    }
    // Step 3：绝对门限——取第一个跌破门限的谷，并在谷内走到局部最小
    let bestLag = -1;
    for (let tau = minLag; tau < maxLag; tau++) {
      if (cmndf[tau] < YIN_THRESHOLD) {
        while (tau + 1 < maxLag && cmndf[tau + 1] < cmndf[tau]) tau++;
        bestLag = tau;
        break;
      }
    }
    if (bestLag < 0) {
      // 兜底：全窗最小值足够「周期性」才采纳（参考实现同策略）
      let bv = 1;
      for (let tau = minLag; tau < maxLag; tau++) if (cmndf[tau] < bv) { bv = cmndf[tau]; bestLag = tau; }
      if (!(bv < YIN_FALLBACK)) return out;
    }
    const clarity = clamp(1 - cmndf[bestLag], 0, 1);
    out.clarity = clarity;
    if (clarity < YIN_CLARITY_MIN) return out;
    // Step 4：抛物线插值细化周期（位移限幅 ±1，防止外推到离谱的 lag）
    let refined = bestLag;
    if (bestLag > minLag && bestLag < maxLag) {
      const y0 = cmndf[bestLag - 1], y1 = cmndf[bestLag], y2 = cmndf[bestLag + 1];
      const den = 2 * (y0 - 2 * y1 + y2);
      if (den !== 0) {
        const delta = (y0 - y2) / den;
        if (isFinite(delta)) refined = bestLag + clamp(delta, -1, 1);
      }
    }
    const freq = sampleRate / refined;
    if (!(freq >= FREQ_MIN && freq <= FREQ_MAX)) { out.clarity = 0; return out; }
    out.freq = freq;
    return out;
  }

  /* ---------- RMS 噪声门（参考 pro-tuner/js/audio/noise-gate.js） ----------
     单帧 YIN 灵敏度提高后必须用门限挡住环境噪声，否则会给出大量抖动读数。
     · 三档预设：安静 / 普通 / 嘈杂；
     · setThreshold 用于自动校准本底噪声，且永不低于用户所选预设
       （防止把噪声 floor 校准得比预设还灵敏）；
     · 跌落后保持 150ms 开门，避免音符自然衰减尾巴被切断造成读数闪烁。 */
  const GATE_PRESETS = Object.freeze({ low: 0.001, medium: 0.004, high: 0.015 });
  function makeNoiseGate(level) {
    const preset = GATE_PRESETS[level] != null ? GATE_PRESETS[level] : GATE_PRESETS.medium;
    let threshold = preset, holdUntil = 0;
    return {
      setLevel(l) {
        const v = GATE_PRESETS[l];
        threshold = v != null ? v : preset;
        holdUntil = 0;
      },
      setThreshold(v) { threshold = Math.max(preset, Number(v) || 0); holdUntil = 0; },
      calibrated(v) { if (Number.isFinite(v) && v > 0) this.setThreshold(v); },
      get threshold() { return threshold; },
      above(rms, now) {
        const t = typeof now === 'number' ? now : Date.now();
        if (rms >= threshold) { holdUntil = t + 150; return true; }
        return t < holdUntil;
      },
      reset() { holdUntil = 0; }
    };
  }

  /* ---------- 跨帧音高跟踪（参考 pro-tuner PitchDetector Step 5~7） ----------
     单帧读数仍有抖动与偶发八度跳变，逐帧再做三层处理：
       · 起音检测：RMS 突增 3 倍 → 认定换音，立即丢弃历史（换弦后跟上而不是拖尾）
       · 9 点中值：剔除离群野值
       · proximity-aware EMA：接近目标（<10¢）时收敛更快，跳变 >100¢ 时立即吸附
     另有 ×2 / ÷2 八度纠正（参考实现刻意去掉 ÷3/×3，因为 3 倍音程比与真换音难区分）。
     @returns {{freq:number, clarity:number}|null} */
  function createPitchTracker() {
    const RING = 9;
    const ring = new Float64Array(RING);
    const sortBuf = new Float64Array(RING);
    let idx = 0, count = 0, smoothed = 0, prevRms = 0;
    return {
      reset() { idx = 0; count = 0; smoothed = 0; prevRms = 0; },
      get value() { return smoothed; },
      push(freq, rms, clarity) {
        const nowRms = Number(rms) > 0 ? Number(rms) : 0;
        const onset = prevRms > 0 && nowRms > prevRms * 3;
        prevRms = nowRms;
        if (!(freq > 0) || !isFinite(freq)) return null;
        if (onset) { idx = 0; count = 0; smoothed = 0; }   // 新的一次拨弦
        let f = freq;
        if (smoothed > 0) {
          const ratio = f / smoothed;
          if (ratio > 1.8 && ratio < 2.2) f = f / 2;
          else if (ratio > 0.45 && ratio < 0.55) f = f * 2;
        }
        ring[idx] = f;
        idx = (idx + 1) % RING;
        count = count < RING ? count + 1 : RING;
        for (let i = 0; i < count; i++) sortBuf[i] = ring[i];
        const view = sortBuf.subarray(0, count);
        view.sort();
        const mid = count >> 1;
        const med = count % 2 ? view[mid] : (view[mid - 1] + view[mid]) / 2;
        const conf = clamp(Number(clarity) > 0 ? Number(clarity) : 0, 0, 1);
        const baseAlpha = clamp(30 / med, 0.08, 0.5);
        let alpha = baseAlpha + (1 - baseAlpha) * conf * 0.4;
        if (smoothed === 0) {
          smoothed = med;
        } else {
          const cd = Math.abs(1200 * Math.log2(med / smoothed));
          if (cd < 10) alpha = Math.min(1, alpha * 2);
          else if (cd > 100) alpha = 1;
          smoothed = alpha * med + (1 - alpha) * smoothed;
        }
        return { freq: smoothed, clarity: conf };
      }
    };
  }

  /* ---------- 平滑工具：值稳定才采纳（滑动窗口取中位数） ---------- */
  function makeSmoother(frames = 3) {
    // P0-01 修复：V1 先 sort 再 shift，丢掉的是最小值而非最旧的值——
    // 音高下降时新值（窗口内最小）push 后立即被自己挤掉，窗口内容
    // 永远不变，调音器卡死在旧音高。改为 FIFO 队列保插入顺序，
    // 排序仅在副本上进行、只用于取中位数。
    const q = [];
    return v => {
      if (v == null) { q.length = 0; return null; }
      q.push(v);
      if (q.length > frames) q.shift();            // 丢最旧，不是丢最小
      const s = q.slice().sort((a, b) => a - b);   // 排序副本，不破坏队列
      return s[Math.floor(s.length / 2)];
    };
  }

  /* ---------- 八度等价量化：把音高差折算到 [-6, 6) 半音 ---------- */
  function quantizeToOctave(diff) {
    return diff - Math.round(diff / 12) * 12;
  }

  /* ---------- 和弦闯关：弦目标匹配（允许八度等价，防泛音误判） ----------
     candidates: [{ i: 弦索引, target: 目标MIDI }, ...]（调用方先过滤已完成弦/闷音）
     返回最佳匹配 { i, cents }；无匹配返回 null。
     迁移自 Game.onPitch（V1 最佳匹配逻辑 + cents 绝对值修复）。 */
  function matchFretTarget(mf, candidates) {
    // P1-04 修复：V1 单轮循环同时做精确与八度等价匹配——八度等价命中后
    // bestCents 被写成 0，真正的精确匹配因 |d*100| < 0 恒为假被永久跳过，
    // 结果取决于候选顺序（弹 2 弦 C4 会被 5 弦 C3 的八度等价抢占）。
    // 改为两轮：第一轮只认真实音高；无精确命中时第二轮才做八度兜底。
    // 另修复：V1 用 !hit 判断，弦索引 0（6 弦）会被误当"未匹配"。
    let exact = null, exactCents = 99;
    for (const c of candidates) {
      const d = mf - c.target;
      if (Math.abs(d) < 0.6 && Math.abs(d * 100) < exactCents) {
        exact = c.i; exactCents = Math.abs(d * 100);
      }
    }
    if (exact !== null) return { i: exact, cents: exactCents };
    let oct = null, octCents = 99;
    for (const c of candidates) {
      const d = quantizeToOctave(mf - c.target);
      if (Math.abs(d) < 0.6 && Math.abs(d * 100) < octCents) {
        oct = c.i; octCents = Math.abs(d * 100);
      }
    }
    return oct === null ? null : { i: oct, cents: octCents };
  }

  /* ---------- 音阶跟弹：单音判定 ---------- */
  function isPitchMatch(midiFloat, targetMidi, threshold = 0.6) {
    return Math.abs(midiFloat - targetMidi) < threshold;
  }

  /* ---------- 节拍器 ----------
     tapBpm: TAP 测速——取相邻间隔中位数换算 BPM（迁移自 Metro TAP 逻辑）
     beatDuration: 一拍时长（秒）；stepDuration: 细分步长（秒） */
  function tapBpm(taps) {
    if (!taps || taps.length < 2) return null;
    const gaps = [];
    for (let i = 1; i < taps.length; i++) gaps.push(taps[i] - taps[i - 1]);
    gaps.sort((a, b) => a - b);
    const med = gaps[Math.floor(gaps.length / 2)];
    return med > 0 ? Math.round(60000 / med) : null;
  }
  const beatDuration = bpm => 60 / bpm;
  const stepDuration = (bpm, sub) => 60 / bpm / sub;

  /* 6/8 拍次强位置（第 4 拍） */
  function isSubAccent(beats, beat) { return beats === 6 && beat === 3; }

  /* ---------- 导出 ---------- */
/* ---------- ESM 导出（R-ESM-02：具名导出） ---------- */
export { NOTE_NAMES, NOTE_CN, OPEN_MIDI, FREQ_MIN, FREQ_MAX, clamp, midiFromFreq, freqFromMidi, noteName, noteNameNoOct, pitchClass, pcFromName, centsBetween, PitchDetect, makeNoiseGate, GATE_PRESETS, createPitchTracker, makeSmoother, quantizeToOctave, matchFretTarget, isPitchMatch, tapBpm, beatDuration, stepDuration, isSubAccent };

export const AudioCore = { NOTE_NAMES, NOTE_CN, OPEN_MIDI, FREQ_MIN, FREQ_MAX, clamp, midiFromFreq, freqFromMidi, noteName, noteNameNoOct, pitchClass, pcFromName, centsBetween, PitchDetect, makeNoiseGate, GATE_PRESETS, createPitchTracker, makeSmoother, quantizeToOctave, matchFretTarget, isPitchMatch, tapBpm, beatDuration, stepDuration, isSubAccent };

/* V2 兼容：非模块引用（如 admin 调试脚本）仍可走全局 */
if (typeof window !== 'undefined') window.AudioCore = AudioCore;

export default AudioCore;
