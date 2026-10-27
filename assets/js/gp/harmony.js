/* ============================================================
   六弦工坊 V4.2.3 · P-4 OMR 和弦派生（运行时，零数据风险）
   ------------------------------------------------------------
   从 GP_OMR_NOTES 的识别音符按小节聚合 → identifyChord 识别
   → 识别失败沿用上一小节并标 uncertain → 相邻去重，
   得到该曲的和弦进行，替换 12 种通用模板和弦。
   · 纯函数、无 DOM 依赖，浏览器与 Node 单测共用；
   · 不写回任何数据文件（songs.js 737KB 全量重建风险大），
     仅在 expandChord() 展开时即时替换，harmony.source 标 'derived-omr'。
   ============================================================ */
'use strict';
import { identifyChord, CHORD_TYPES } from './theory.js';

/**
 * 从 OMR 事件派生和弦进行。
 * @param {object} omr GP_OMR_NOTES 条目（{b, span, n:[beat,dur,midi[]]}）
 * @param {number} [bpb=4] 每小节拍数（beats per bar）
 * @param {object} [opts] { keyPc } 调性音级（识别评分证据之一）
 * @returns {{chords: Array<[number,string]>, bars: number,
 *            uncertainBars: number[], source: 'derived-omr'}}
 *   chords 为相邻去重后的 [rootPc, type] 序列；全部识别失败时 chords 为空，
 *   调用方应回退模板和声。
 */
export function deriveHarmony(omr, bpb = 4, opts = {}) {
  const events = (omr && Array.isArray(omr.n)) ? omr.n : [];
  const span = (omr && omr.span > 0) ? omr.span : 0;
  const beats = Number.isFinite(bpb) && bpb > 0 ? bpb : 4;
  const bars = Math.max(1, Math.ceil(span / beats));
  const keyPc = Number.isFinite(opts && opts.keyPc) ? opts.keyPc : undefined;

  /* 按小节聚合全部音高（OMR 事件的 midi 数组摊平） */
  const perBar = Array.from({ length: bars }, () => []);
  for (const ev of events) {
    const beat = ev[0], midi = ev[2];
    const b = Math.floor(beat / beats);
    if (b < 0 || b >= bars || !Array.isArray(midi)) continue;
    for (const m of midi) if (Number.isFinite(m)) perBar[b].push(m);
  }

  /* 逐小节识别；失败（单音/噪声/空小节）沿用上一小节并标 uncertain。
     只接受 ≥3 音的和弦类型：power chord（2 音）会破坏 GP-2「3–4 音」硬约束。 */
  const raw = new Array(bars).fill(null);
  const uncertainBars = [];
  let prev = null;
  for (let b = 0; b < bars; b++) {
    const hit = perBar[b].length >= 2 ? identifyChord(perBar[b], { keyPc }) : null;
    if (hit && (CHORD_TYPES[hit.type] || { intervals: [] }).intervals.length >= 3) {
      prev = [hit.rootPc, hit.type];
      raw[b] = prev;
    } else {
      uncertainBars.push(b);
      raw[b] = prev;                 // 沿用上一小节；开头失败先置 null
    }
  }
  /* 开头连续失败：用首个识别成功的和弦回填，保证进行非空 */
  const first = raw.find((c) => c);
  if (!first) return { chords: [], bars, uncertainBars, source: 'derived-omr' };
  for (let b = 0; b < bars; b++) if (!raw[b]) raw[b] = first;

  /* 相邻去重：同一和弦连续多小节只保留一次（进行序列，非逐小节铺排） */
  const chords = [];
  for (let b = 0; b < bars; b++) {
    const [pc, type] = raw[b];
    const last = chords[chords.length - 1];
    if (last && last[0] === pc && last[1] === type) continue;
    chords.push([pc, type]);
  }
  return { chords, bars, uncertainBars, source: 'derived-omr' };
}

export default { deriveHarmony };
