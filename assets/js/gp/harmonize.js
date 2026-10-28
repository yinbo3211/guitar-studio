/* ============================================================
   六弦工坊 V4.2.4 · gp/harmonize.js —— 单音旋律配和弦（N-4 / 手册 §4.1）
   ------------------------------------------------------------
   harmony.js 的 deriveHarmony() 依赖「每小节 ≥2 个音 + 识别出 ≥3 音和弦」，
   对单音旋律（真实谱单音占比 68–100%）恒失败 → 24/56 首 OMR 拿不到和弦。
   本模块按「调内自然音级三和弦与旋律音的重合度打分」另起一套算法，
   作为 deriveHarmony 的**降级兜底**（优先级：derived-omr > harmonized-melody）。

   ⚠️ 诚实模型约束（违规视为编造数据）：
   1. 产物 source 恒为 'harmonized-melody'（推算值），
      UI 侧必须标注（本项目用括号包裹和弦名），严禁冒充原曲编配；
   2. 结果**只能**写进 song.harmony，绝不可反向写回 song.notes
      （把单音补成和弦会破坏 GP-2「3–4 音契约」与 chartKind 诚实模型）；
   3. 推算和弦不参与任何评分：评分只读 note.midi 的真实音高，天然满足；
   4. 本模块输出不得回灌 omrQuality() 门禁（防 R-1 循环论证：
      推算算法对任何输入都能产出和弦，用它反证谱面质量 → 门禁恒真失效）。

   纯函数、无 DOM 依赖，浏览器与 Node 单测共用。
   ============================================================ */
'use strict';
import { CHORD_TYPES } from './theory.js';

/* 调内自然音级三和弦（weight 为功能偏好，deg 为相对主音的半音数） */
const DIATONIC_MAJOR = [
  { deg: 0, type: 'maj', fn: 'I', weight: 1.2 },
  { deg: 2, type: 'min', fn: 'ii', weight: 0.8 },
  { deg: 4, type: 'min', fn: 'iii', weight: 0.6 },
  { deg: 5, type: 'maj', fn: 'IV', weight: 1.0 },
  { deg: 7, type: 'maj', fn: 'V', weight: 1.1 },
  { deg: 9, type: 'min', fn: 'vi', weight: 0.9 },
  { deg: 11, type: 'dim', fn: 'vii', weight: 0.3 },
];
const DIATONIC_MINOR = [
  { deg: 0, type: 'min', fn: 'i', weight: 1.2 },
  { deg: 2, type: 'dim', fn: 'ii', weight: 0.3 },
  { deg: 3, type: 'maj', fn: 'III', weight: 1.0 },
  { deg: 5, type: 'min', fn: 'iv', weight: 0.9 },
  { deg: 7, type: 'min', fn: 'v', weight: 0.9 },
  { deg: 8, type: 'maj', fn: 'VI', weight: 0.8 },
  { deg: 10, type: 'maj', fn: 'VII', weight: 0.7 },
];

/** 延续倾向：相邻小节重复同一和弦时的额外加分，用于抑制逐小节抖动 */
const REPEAT_BONUS = 0.6;

/**
 * 为一小节旋律配一个和弦。
 * @param {Array<{midi:number, weight:number, onBeat:boolean}>} melody 本小节旋律音
 * @param {number} keyPc 调主音 pitch class
 * @param {boolean} isMinor 是否小调
 * @param {[number,string]|null} prev 上一小节和弦（用于平滑）
 * @returns {[number,string]|null} [rootPc, type]；空旋律且无 prev 时返回 null
 */
export function harmonizeBar(melody, keyPc, isMinor, prev = null) {
  if (!melody || !melody.length) {
    /* 加固①：返回副本而非 prev 本身——harmonizeOmr 会把结果 push 多次，
       共享同一数组引用会让「就地改一个和弦」污染全部空小节。 */
    return prev ? [prev[0], prev[1]] : null;
  }
  const scale = isMinor ? DIATONIC_MINOR : DIATONIC_MAJOR;
  let best = null;
  for (const c of scale) {
    const rootPc = ((keyPc + c.deg) % 12 + 12) % 12;
    const tones = new Set(CHORD_TYPES[c.type].intervals.map((i) => ((rootPc + i) % 12 + 12) % 12));
    let score = 0;
    for (const m of melody) {
      const pc = ((m.midi % 12) + 12) % 12;
      if (tones.has(pc)) score += m.weight * (m.onBeat ? 2 : 1);
    }
    score += c.weight;                                   // 功能偏好
    if (prev && prev[0] === rootPc && prev[1] === c.type) score += REPEAT_BONUS;
    if (!best || score > best.score) best = { rootPc, type: c.type, score };
  }
  return [best.rootPc, best.type];
}

/**
 * 整曲旋律配和弦：按小节切分 → 逐小节配 → 相邻去重。
 * @param {object} omr GP_OMR_NOTES 条目（{b, span, n:[[beat, dur, midis], …]}）
 * @param {number} [bpb=4] 每小节拍数
 * @param {object} [opts] { keyPc, isMinor }
 * @returns {{chords:Array<[number,string]>, barChords:Array<[number,string]>,
 *            bars:number, uncertainBars:number[], source:'harmonized-melody'}}
 *   chords    —— 相邻去重后的进行（展示/审计用），长度 ≠ bars；
 *   barChords —— 逐小节和弦（长度恒 === bars），演奏视图按小节下标取它。
 */
export function harmonizeOmr(omr, bpb = 4, opts = {}) {
  const events = (omr && Array.isArray(omr.n)) ? omr.n : [];
  const span = (omr && omr.span > 0) ? omr.span : 0;
  const beats = Number.isFinite(bpb) && bpb > 0 ? bpb : 4;
  const bars = Math.max(1, Math.ceil(span / beats));
  const keyPc = Number.isFinite(opts && opts.keyPc) ? opts.keyPc : 0;
  const isMinor = !!(opts && opts.isMinor);

  /* 按小节聚合（含浮点拍位；实测 6937 个事件的 beat%1 只有 0/.25/.5/.75 四种值，
     onBeat 的 <0.01 判定精确命中整拍） */
  const perBar = Array.from({ length: bars }, () => []);
  for (const ev of events) {
    const beat = ev[0], dur = ev[1], midis = ev[2];
    if (!Array.isArray(midis)) continue;
    const b = Math.floor(beat / beats);
    if (!Number.isFinite(b) || b < 0 || b >= bars) continue;
    const onBeat = Math.abs(beat % 1) < 0.01;
    const w = Math.max(0.25, Number.isFinite(dur) ? dur : 1);
    for (const m of midis) if (Number.isFinite(m)) perBar[b].push({ midi: m, weight: w, onBeat });
  }

  /* 加固②：保留逐小节结果 raw，避免 UI 用去重后的 chords 按下标取而错拍 */
  const raw = [];
  let prev = null;
  for (let b = 0; b < bars; b++) {
    prev = harmonizeBar(perBar[b], keyPc, isMinor, prev);
    raw.push(prev);
  }
  /* 加固④：前导空小节为 null，用首个成功和弦回填，保证逐小节数组无空洞 */
  const first = raw.find(Boolean);
  if (first) for (let b = 0; b < bars; b++) if (!raw[b]) raw[b] = [first[0], first[1]];

  const chords = [];
  for (const c of raw) {
    if (!c) continue;
    const last = chords[chords.length - 1];
    if (last && last[0] === c[0] && last[1] === c[1]) continue;
    chords.push([c[0], c[1]]);
  }
  /* 加固③：全空输入时 chords 为空，由调用方 resolveHarmony 兜底到 template */
  return { chords, barChords: raw, bars, uncertainBars: [], source: 'harmonized-melody' };
}

export default { harmonizeBar, harmonizeOmr };
