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
  const m = /^([A-Ga-g])([#b♯♭x]?)(-?\d+)?$/.exec(name.trim());
  if (!m) return null;
  let letter = m[1].toUpperCase();
  let acc = 0;
  const sym = m[2];
  if (sym === '#' || sym === '♯') acc = 1;
  else if (sym === 'b' || sym === '♭') acc = -1;
  else if (sym === 'x') acc = 2;
  const octave = m[3] === undefined ? null : parseInt(m[3], 10);
  return { letter, acc, octave };
}

/* 由「字母 + 升降号」得到音高类 */
function pcOf(letter, acc) { return pc(LETTER_PC[letter] + acc); }

/* 由「字母 + 目标音高类」反推升降号（-2..2，取最简拼写） */
function accidentalFor(letter, targetPc) {
  const natural = LETTER_PC[letter];
  let d = pc(targetPc - natural);
  if (d > 6) d -= 12;            // 优先用降号表示（如 D♭ 而非 C♯）
  return d;
}

function formatNote(letter, acc, octave) {
  const sym = acc > 1 ? 'x' : acc === 1 ? '#' : acc === -1 ? 'b' : acc < -1 ? 'bb' : '';
  return letter + sym + (octave === null || octave === undefined ? '' : octave);
}

/* 音名 → MIDI（用于播放/判定，与 audio-core 的 pcFromName 语义一致） */
function midiOf(name, octave = 4) {
  const n = parseNote(name);
  if (!n) return null;
  return (n.octave !== null ? n.octave : octave) * 12 + 12 + pcOf(n.letter, n.acc);
}

/* ---------------- 音阶拼写 ---------------- */
/* scale('Eb','major') → ['Eb','F','G','Ab','Bb','C','D'] */
function scale(tonic, mode = 'major') {
  const t = parseNote(tonic);
  const steps = INTERVALS[mode];
  if (!t || !steps) return [];
  const startLetterIdx = LETTERS.indexOf(t.letter);
  const tonicPc = pcOf(t.letter, t.acc);
  return steps.map((semi, i) => {
    const letter = LETTERS[(startLetterIdx + i) % 7];
    const targetPc = pc(tonicPc + semi);
    const acc = accidentalFor(letter, targetPc);
    return formatNote(letter, acc, null);
  });
}

/* 调号：{ type:'sharp'|'flat'|'none', count, accidentals:[] } */
function keySignature(tonic, mode = 'major') {
  const notes = scale(tonic, mode);
  const accs = [];
  for (const n of notes) {
    const p = parseNote(n);
    if (p && p.acc !== 0) accs.push(p.letter + (p.acc > 0 ? '#' : 'b'));
  }
  const unique = [];
  for (const a of accs) if (!unique.includes(a)) unique.push(a);
  if (!unique.length) return { type: 'none', count: 0, accidentals: [] };
  const sharp = unique[0].includes('#');
  const order = sharp ? SHARP_ORDER : FLAT_ORDER;
  const sym = sharp ? '#' : 'b';
  const ordered = order.filter(l => unique.includes(l + sym)).map(l => l + sym);
  return { type: sharp ? 'sharp' : 'flat', count: ordered.length, accidentals: ordered };
}

/* ---------------- 和弦构成音拼写 ---------------- */
/* chordTones('Db','maj7') → ['Db','F','Ab','C'] */
function chordTones(root, quality = 'maj') {
  const r = parseNote(root);
  const semis = CHORD_QUALITY[quality];
  if (!r || !semis) return [];
  const startLetterIdx = LETTERS.indexOf(r.letter);
  const rootPc = pcOf(r.letter, r.acc);
  // 字母级步进：1-3-5(-7)；sus2 用 2 音、sus4 用 4 音替换三音
  const stepLetter = QUALITY_LETTER_STEP[quality] || [0, 2, 4, 6];
  return semis.map((semi, i) => {
    const letter = LETTERS[(startLetterIdx + stepLetter[i]) % 7];
    const targetPc = pc(rootPc + semi);
    const acc = accidentalFor(letter, targetPc);
    return formatNote(letter, acc, null);
  });
}

/* 和弦后缀 → 品质 key（用于反查） */
function qualityOf(symbol) {
  if (!symbol) return 'maj';
  const s = String(symbol).trim();
  if (/^m7b5$|^ø/.test(s)) return 'm7b5';
  if (/^dim7$|^o7/.test(s)) return 'dim7';
  if (/^m7$|^min7$|^-7/.test(s)) return 'min7';
  if (/^maj7$|^M7/.test(s)) return 'maj7';
  if (/^7$|^dom7/.test(s)) return 'dom7';
  if (/^m$|^min$|^-/.test(s)) return 'min';
  if (/^dim$|^o/.test(s)) return 'dim';
  if (/^aug$|^ \+/.test(s)) return 'aug';
  if (/^sus2/.test(s)) return 'sus2';
  if (/^sus4|sus$/.test(s)) return 'sus4';
  return 'maj';
}

/* ---------------- 移调与级数 ---------------- */
/* 半音数 → 音程级数（以自然音级数计，用于决定字母走动） */
const SEMI_STEPS = { 0: 0, 1: 1, 2: 1, 3: 2, 4: 2, 5: 3, 6: 4, 7: 4, 8: 5, 9: 5, 10: 6, 11: 6 };

function transpose(root, semitones, preferSharp = false) {
  const r = parseNote(root);
  if (!r) return null;
  const dir = semitones < 0 ? -1 : 1;
  const absSemi = Math.abs(semitones) % 12;
  const octaves = Math.floor(Math.abs(semitones) / 12);
  const steps = dir * ((SEMI_STEPS[absSemi] ?? 0) + 7 * octaves);
  const rootPc = pcOf(r.letter, r.acc);
  const targetPc = pc(rootPc + semitones);
  const idx = LETTERS.indexOf(r.letter);
  const letterIdx = (((idx + steps) % 7) + 7) % 7;
  let letter = LETTERS[letterIdx];
  let acc = accidentalFor(letter, targetPc);
  // 需要重升/重降时，退到相邻字母的等价拼写
  if (Math.abs(acc) > 1) {
    for (const d of [dir > 0 ? 1 : -1, dir > 0 ? -1 : 1]) {
      const altIdx = (((letterIdx + d) % 7) + 7) % 7;
      const altAcc = accidentalFor(LETTERS[altIdx], targetPc);
      if (Math.abs(altAcc) <= 1) { letter = LETTERS[altIdx]; acc = altAcc; break; }
    }
  }
  // preferSharp：把降号拼写换成升号拼写（Db → C#）
  if (preferSharp && acc < 0) {
    const altIdx = (((letterIdx - 1) % 7) + 7) % 7;
    const altAcc = accidentalFor(LETTERS[altIdx], targetPc);
    if (Math.abs(altAcc) <= 1) { letter = LETTERS[altIdx]; acc = altAcc; }
  }
  return formatNote(letter, acc, null);
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

/* 级数分析：numeral('Bb', 'C') → 'bVII'；numeral('C', 'C') → 'I' */
function numeral(chordRoot, tonic, mode = 'major') {
  const notes = scale(tonic, mode);
  const cr = parseNote(chordRoot);
  const tn = parseNote(tonic);
  if (!cr || !tn || !notes.length) return null;
  const crPc = pcOf(cr.letter, cr.acc);
  // 先按「字母级数」定位：根音字母相对主音字母的度数（0=I）
  const degreeIdx = (LETTERS.indexOf(cr.letter) - LETTERS.indexOf(tn.letter) + 7) % 7;
  const steps = INTERVALS[mode] || INTERVALS.major;
  const tonicPc = pcOf(tn.letter, tn.acc);
  const diff = pc(crPc - tonicPc);
  let off = diff - steps[degreeIdx];
  if (off > 6) off -= 12;
  if (off < -6) off += 12;
  const sym = off === 0 ? '' : off > 0 ? '#'.repeat(off) : 'b'.repeat(-off);
  return sym + ROMAN[degreeIdx];
}

/* ---------------- 指板查询 ---------------- */
/* 标准调弦 6→1 弦空弦 MIDI（与 audio-core.OPEN_MIDI 一致） */
const OPEN_MIDI = [40, 45, 50, 55, 59, 64];

/* fretNote(stringIdx 0=6弦, fret, preferSharp) → { name, midi, octave } */
function fretNote(stringIdx, fret, preferSharp = false) {
  const s = Number(stringIdx), f = Number(fret);
  if (!Number.isInteger(s) || !Number.isInteger(f) || s < 0 || s > 5 || f < 0 || f > 24) return null;
  const midi = OPEN_MIDI[s] + f;
  const base = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][pc(midi)];
  const name = preferSharp ? base : (ENHARMONIC[base] && base.includes('#') ? ENHARMONIC[base] : base);
  return { name, midi, octave: Math.floor(midi / 12) - 1, string: s, fret: f };
}

/* 在某弦上查找某音高类的所有品位（0-24） */
function findFrets(targetName) {
  const n = parseNote(targetName);
  if (!n) return [];
  const targetPc = pcOf(n.letter, n.acc);
  const out = [];
  for (let s = 0; s < 6; s++) {
    for (let f = 0; f <= 24; f++) {
      if (pc(OPEN_MIDI[s] + f) === targetPc) out.push({ string: s, fret: f, midi: OPEN_MIDI[s] + f });
    }
  }
  return out;
}

/* ---------------- 6/8 拍分组（节奏型与练耳共用） ---------------- */
/* groupBeats(6, 8) → [3, 3]（6/8 视为两组三连八分） */
function groupBeats(numerator, denominator) {
  const n = Number(numerator), d = Number(denominator);
  if (!n || !d || n <= 0) return [];
  if (d === 8 && n % 3 === 0) return new Array(n / 3).fill(3);   // 6/8、9/8、12/8
  if (n === 5) return [3, 2];
  if (n === 7) return [4, 3];
  if (n % 3 === 0) return new Array(n / 3).fill(3);              // 3/4、6/4、9/4
  if (n % 2 === 0) return [n / 2, n / 2];                        // 2/4、4/4
  return new Array(n).fill(1);
}

export const MusicSpelling = {
  LETTERS, MAJOR_KEYS, INTERVALS, CHORD_QUALITY, OPEN_MIDI, ENHARMONIC, ROMAN,
  parseNote, pcOf, accidentalFor, formatNote, midiOf,
  scale, keySignature, chordTones, qualityOf,
  transpose, numeral, fretNote, findFrets, groupBeats
};
export { parseNote, scale, keySignature, chordTones, qualityOf, transpose, numeral, fretNote, findFrets, groupBeats, midiOf };
export default MusicSpelling;

if (typeof window !== 'undefined') window.MusicSpelling = MusicSpelling;
