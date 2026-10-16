/* ============================================================
   六弦工坊 · 音频核心算法库（V2 · M1 工程化改造）
   ------------------------------------------------------------
   按《产品需求文档与升级方案 v2.0》M1 里程碑要求，将 V1 散落在
   app-*.js 中的音频算法（自相关测频、平滑滤波、音名换算、节拍
   调度、闯关判定）抽取为无副作用的纯函数模块：
     · 浏览器：暴露全局 AudioCore（须在 app-1.js 之前加载）
     · Node.js：module.exports 导出，供单元测试直接 require
   迁移原则：算法行为与 V1 保持一致（回归测试见 test/）。
   ============================================================ */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AudioCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

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

  /* ---------- 归一化自相关基频检测（对相位不敏感，含抛物线插值） ---------- */
  function PitchDetect(buf, sampleRate) {
    const SIZE = buf.length;
    // 去直流（不修改输入缓冲）
    let mean = 0;
    for (let i = 0; i < SIZE; i++) mean += buf[i];
    mean /= SIZE;
    const x = new Float32Array(SIZE);
    for (let i = 0; i < SIZE; i++) x[i] = buf[i] - mean;
    // 能量 / RMS
    let e2 = 0;
    for (let i = 0; i < SIZE; i++) e2 += x[i] * x[i];
    const rms = Math.sqrt(e2 / SIZE);
    if (rms < 0.01) return { freq: null, rms, clarity: 0 };
    // 基频范围：约 50Hz（低音区）~ 1320Hz（E6）
    const maxLag = Math.min(SIZE - 1, Math.floor(sampleRate / FREQ_MIN));
    const minLag = Math.floor(sampleRate / FREQ_MAX);
    // 按样本数归一化的自相关，补偿不同滞后长度造成的能量衰减
    const ac = new Float32Array(maxLag + 1);
    for (let lag = 0; lag <= maxLag; lag++) {
      let s = 0; const n = SIZE - lag;
      for (let i = 0; i < n; i++) s += x[i] * x[i + lag];
      ac[lag] = s / n;
    }
    // 越过 lag0 后的下降段抵达谷底，再在其后寻找最高峰（即基频周期）
    let lag = minLag;
    while (lag < maxLag && ac[lag + 1] <= ac[lag]) lag++;
    let bestLag = lag, bestVal = ac[lag];
    for (let i = lag; i <= maxLag; i++) { if (ac[i] > bestVal) { bestVal = ac[i]; bestLag = i; } }
    /* BugFix（V2 M1 回归测试发现）：整数倍周期（低八度）误锁——
       纯音/干净信号的自相关在 2×、3× 周期处的峰值与 1× 周期几乎相同甚至更高，
       全局 argmax 会选中更大的滞后，导致 220Hz 被判为 110Hz。
       改用 MPM 准则：谷底之后取第一个 ≥ 全局峰值 90% 的局部极大；
       clarity 仍按全局峰值计算，与 V1 一致。 */
    let chosen = bestLag;
    for (let i = lag + 1; i < maxLag; i++) {
      if (ac[i] >= bestVal * 0.9 && ac[i] >= ac[i - 1] && ac[i] >= ac[i + 1]) { chosen = i; break; }
    }
    bestLag = chosen;
    const clarity = clamp(bestVal / ac[0], 0, 1);
    if (clarity < 0.25) return { freq: null, rms, clarity };
    // 抛物线插值细化周期
    let refined = bestLag;
    if (bestLag > 0 && bestLag < maxLag) {
      const a = ac[bestLag - 1], b = ac[bestLag], c = ac[bestLag + 1];
      const den = (a - 2 * b + c);
      if (den !== 0) {
        const p = 0.5 * (a - c) / den;
        if (isFinite(p) && Math.abs(p) < 1) refined = bestLag + p;
      }
    }
    const freq = sampleRate / refined;
    if (freq < FREQ_MIN || freq > FREQ_MAX) return { freq: null, rms, clarity: 0 };
    return { freq, rms, clarity };
  }

  /* ---------- 平滑工具：值稳定才采纳（滑动窗口取中位数） ---------- */
  function makeSmoother(frames = 3) {
    const arr = [];
    return v => {
      if (v == null) { arr.length = 0; return null; }
      arr.push(v); if (arr.length > frames) arr.shift();
      arr.sort((a, b) => a - b);
      return arr[Math.floor(arr.length / 2)];
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
    let hit = null, bestCents = 99;
    for (const c of candidates) {
      let diff = mf - c.target;
      // 量化到最近八度
      diff = quantizeToOctave(diff);
      if (Math.abs(diff) < 0.6 && Math.abs(diff * 100) < bestCents) {
        // 但必须优先匹配非八度的真实音
        const realDiff = mf - c.target;
        if (Math.abs(realDiff) < 0.7) { hit = c.i; bestCents = Math.abs(realDiff * 100); }
        else if (hit === null) { hit = c.i; bestCents = Math.abs(diff * 100); }
      }
    }
    return hit === null ? null : { i: hit, cents: bestCents };
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
  return {
    NOTE_NAMES, NOTE_CN, OPEN_MIDI, FREQ_MIN, FREQ_MAX,
    clamp, midiFromFreq, freqFromMidi, noteName, noteNameNoOct, pitchClass,
    pcFromName, centsBetween, PitchDetect, makeSmoother,
    quantizeToOctave, matchFretTarget, isPitchMatch,
    tapBpm, beatDuration, stepDuration, isSubAccent
  };
});
