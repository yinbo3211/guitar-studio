/* ============================================================
   六弦工坊 V3.1 · 乐理拼写引擎 core/music-spelling（F8）
   ------------------------------------------------------------
   分层边界（PRD 第四章）：
     · Tone.js        → 只负责播放与调度
     · audio-core.js  → 音高计算（测频、MIDI 换算、判定）
     · music-spelling → 乐理拼写（如何命名）：调号、音阶、和弦构成音、
                        移调、罗马数字级数、指板音名查询
   本模块为纯函数，无任何 DOM/音频依赖，可被 Node 单测直接引入。
   ============================================================ */
'use strict';

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];   // 升号出现顺序
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];    // 降号出现顺序

/* 12 个大调主音（含异名）：C/G/D/A/E/B/F# 与 Db/Ab/Eb/Bb/F */
const MAJOR_KEYS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F'];
/* 常用异名映射（用于输入归一化与展示切换） */
const ENHARMONIC = { 'C#': 'Db', 'Db': 'C#', 'D#': 'Eb', 'Eb': 'D#', 'F#': 'Gb', 'Gb': 'F#', 'G#': 'Ab', 'Ab': 'G#', 'A#': 'Bb', 'Bb': 'A#' };

const INTERVALS = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10]      // 自然小调
};

const QUALITY_LETTER_STEP = {
  maj: [0, 2, 4], min: [0, 2, 4], dim: [0, 2, 4], aug: [0, 2, 4],
  sus2: [0, 1, 4], sus4: [0, 3, 4],
  maj7: [0, 2, 4, 6], min7: [0, 2, 4, 6], dom7: [0, 2, 4, 6],
  dim7: [0, 2, 4, 6], m7b5: [0, 2, 4, 6]
};

const CHORD_QUALITY = {
  maj:  [0, 4, 7],
  min:  [0, 3, 7],
  dim:  [0, 3, 6],
  aug:  [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  dom7: [0, 4, 7, 10],
  dim7: [0, 3, 6, 9],
  m7b5: [0, 3, 6, 10]
};

const pc = (m) => ((m % 12) + 12) % 12;

/* 解析音名 → { letter, acc }  acc: -2..2 */
function parseNote(name) {
  if (typeof name !== 'string') return null;
  const m = /^([A-Ga-g])([#b♯♭x]?)(-?
