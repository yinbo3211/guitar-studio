/* ============================================================
   六弦工坊 V4.1 · 曲库访问层（GuitarPicker catalog 的宿主实现）
   ------------------------------------------------------------
   · 浏览只取「紧凑定义」（231 首和弦弹唱 + 5 首公有领域旋律），不展开音符；
   · 演奏时按 id 惰性展开成 GuitarPicker 歌曲对象并缓存，避免首屏
     一次性生成 7 万多个音符对象。
   · 和弦曲目：按 bars 铺满和声进行，每小节 4 个扫弦（4-per-bar）；
   · 旋律曲目：用 parseMelody 解析紧凑记谱（真实公有领域旋律）。
   ============================================================ */
'use strict';
import { GP_CHORD_SONGS, GP_MELODY_SONGS, GP_PROVENANCE } from './songs.js';
import { GP_OMR_NOTES } from './omr-notes.js';
import { newSong, parseMelody, ensureMetadata } from './song-format.js';
import { chordMidis } from './theory.js';

const ROOT_MIDI = 48;            // C3 —— 吉他常用把位区间
const MAX_BARS = 160;            // 占位伴奏最多铺到目标时长（最长曲约需 144 小节）
const MIN_BARS = 8;
/* 单遍时长达到目标时长的这个比例 → 判定为「整曲识别」，不再循环（BUG-01） */
const OMR_FULLSONG_RATIO = 0.7;

/* ---------- OMR 数据质量门禁（BUG-05） ----------
   识谱对多页/低清/复杂排版的图片识别率很低，会产出「整小节空白」「单音高重复」
   之类的退化数据（如《万有引力》10 个音全是 G4）。旧门禁只查 span>0 与元素个数，
   这类坏数据照样被当成正常谱播放。这里用密度 / 音高多样性 / 事件数三项判定。
   阈值为「20 首正常 OMR 分布」回标的初值：正常谱密度 ≥1.5 音/小节，退化谱 ≤1.1。 */
const OMR_MIN_NOTES = 24;
const OMR_MIN_DENSITY = 1.2;
const OMR_MIN_PITCH_KINDS = 4;
/* BUG-09：单遍时长 vs 展开后谱面时长的比值超出 [0.9, 1.1] → 短片段循环铺满，
   不是「整曲真实谱」，必须降级（循环遍数容差 ±10%） */
const OMR_LOOP_RATIO_MIN = 0.9;
const OMR_LOOP_RATIO_MAX = 1.1;

/**
 * OMR 数据质量评估（纯函数，可直接单测）。
 * @param {object} omr GP_OMR_NOTES 条目（{b, span, n}）
 * @param {object} [def] 曲目紧凑定义（可选）；传入后追加 BUG-09 循环遍数判定：
 *        单遍时长 passSec 与展开后谱面时长的比值超出 [0.9, 1.1] 即 unusable。
 *        不传 def 时跳过循环判定（无法得知 bpm/durationSec，保持旧行为）。
 * @returns {{notes:number, bars:number, density:number, pitchKinds:number,
 *            passSec:number, loops:number, loopRatio:number, usable:boolean}}
 */
export function omrQuality(omr, def) {
  const list = (omr && Array.isArray(omr.n)) ? omr.n : [];
  const bars = (omr && omr.span > 0) ? omr.span / (omr.b || 4) : 0;
  const notes = list.length;
  const density = bars > 0 ? notes / bars : 0;
  const pitchKinds = new Set(list.flatMap((x) => x[2])).size;
  /* BUG-09 循环遍数判定：与 expandOmr 同一套口径（spb 恒为 60/bpm，不压缩） */
  let passSec = 0, loops = 1, loopRatio = 1, loopOk = true;
  if (def && omr && omr.span > 0) {
    const spb = 60 / (def.bpm || 80);
    const want = def.durationSec || 0;
    passSec = omr.span * spb;
    if (want > 0 && passSec > 0) {
      const isFullSong = passSec >= want * OMR_FULLSONG_RATIO;
      loops = isFullSong ? 1 : Math.max(1, Math.ceil(want / passSec));
      /* 展开后谱面时长 ≈ loops 遍单遍时长（尾部截断容差 1 小节，与 expandOmr 一致） */
      const expandedSec = Math.min(loops * passSec, want + spb * 4);
      loopRatio = expandedSec / passSec;
      loopOk = loopRatio >= OMR_LOOP_RATIO_MIN && loopRatio <= OMR_LOOP_RATIO_MAX;
    }
  }
  const usable = notes >= OMR_MIN_NOTES && density >= OMR_MIN_DENSITY
    && pitchKinds >= OMR_MIN_PITCH_KINDS && loopOk;
  return { notes, bars, density, pitchKinds, passSec, loops, loopRatio, usable };
}

/**
 * 该曲目是否有「真实可弹的谱面」（OMR 通过质量门禁）。
 * 曲库页据此打「简易伴奏」角标（BUG-02 Step A）。
 * @param {string} id 宿主 id（song-001）或演奏 id（gp-song-001）
 */
export function hasRealChart(id) {
  const def = defById(id);
  if (!def) return false;
  if (def.melody) return true;
  const omr = GP_OMR_NOTES[def.id] || null;
  return !!omr && omrQuality(omr, def).usable;
}
/** 有 OMR 数据但没过质量门禁（密度退化 或 BUG-09 循环铺满）→ 需要 UI 明确告知（BUG-02 Step A） */
export function isOmrDegraded(defId) {
  const def = defById(defId);
  const key = def ? def.id : defId;
  const omr = (typeof GP_OMR_NOTES === 'object' && GP_OMR_NOTES) ? GP_OMR_NOTES[key] : null;
  if (!omr) return false;
  return omrQuality(omr, def || undefined).usable === false;
}

/* ---------- BUG-14：同名曲展示消歧（曲名 · 歌手），不改真实曲名数据 ---------- */
let dupTitleSet = null;
/** 曲库内同曲名（不同歌手）的标题集合，惰性构建 */
function dupTitles() {
  if (!dupTitleSet) {
    const byTitle = new Map();
    for (const d of listDefs()) {
      const k = String(d.title || '');
      byTitle.set(k, (byTitle.get(k) || 0) + 1);
    }
    dupTitleSet = new Set([...byTitle.entries()].filter(([, n]) => n > 1).map(([k]) => k));
  }
  return dupTitleSet;
}
/**
 * 展示层标题：同曲名存在多首时追加「 · 歌手」消歧（BUG-14，如 玫瑰×2）。
 * @param {{title?:string, artist?:string}} song
 */
export function displayTitle(song) {
  const title = String((song && song.title) || '');
  const artist = String((song && song.artist) || '');
  return dupTitles().has(title) && artist ? `${title} · ${artist}` : title;
}
const cache = new Map();

export { GP_PROVENANCE };

/** 全部紧凑定义（浏览用，不含 notes） */
export function listDefs() {
  return GP_MELODY_SONGS.concat(GP_CHORD_SONGS);
}

export function defCount() { return listDefs().length; }

export function searchDefs(kw) {
  const q = String(kw == null ? '' : kw).trim().toLowerCase();
  const all = listDefs();
  if (!q) return all;
  return all.filter((d) =>
    String(d.title).toLowerCase().includes(q) || String(d.artist).toLowerCase().includes(q));
}

export function defById(id) {
  if (!id) return null;
  const all = listDefs();
  /* 曲库页用的是 song-001 形式，演奏曲库用 gp-song-001：两种都接受 */
  return all.find((d) => d.id === id)
    || all.find((d) => d.id === 'gp-' + id)
    || (String(id).startsWith('gp-') ? all.find((d) => d.id === String(id).slice(3)) : null)
    || null;
}

/* ---------- 展开：紧凑定义 -> GuitarPicker 歌曲对象 ---------- */
function expandChord(def) {
  const bpm = def.bpm || 80;
  const spb = 60 / bpm;
  const bar = spb * 4;
  const chords = (def.harmony && def.harmony.chords) || [[0, 'maj']];
  const want = Math.ceil((def.durationSec || 120) / bar);
  const bars = Math.max(MIN_BARS, Math.min(MAX_BARS, want));
  const notes = [];
  for (let b = 0; b < bars; b++) {
    const [pc, type] = chords[b % chords.length];
    const midi = chordMidis(ROOT_MIDI + ((pc % 12) + 12) % 12, type);
    for (let s = 0; s < 4; s++) {
      notes.push({
        time: +(b * bar + s * spb).toFixed(4),
        dur: +(spb * 0.85).toFixed(4),
        midi,
        chord: true,
      });
    }
  }
  return newSong({
    id: def.id,
    title: def.title,
    artist: def.artist,
    instrument: 'acoustic-guitar',
    key: def.key || 'C',
    bpm,
    capo: def.capo || 0,
    difficulty: def.difficulty || 'beginner',
    genre: def.genre || 'Pop',
    notes,
    lyrics: def.lyrics || [],
    background: def.background || { type: 'solid', value: '' },
    source: 'builtin',
    /* BUG-02：占位扫弦不是原曲编配，必须显式标记为自动生成的伴奏 */
    chartKind: 'generated-chords',
  });
}

/* ---------- OMR 真实谱面：识别出的 (拍, 时值, midi) 事件，循环铺满整曲 ---------- */
/**
 * OMR 展开（V4.2.1 修正版 · BUG-01）
 * ------------------------------------------------------------
 * · beat/dur 单位恒为「四分音符拍」→ spb 恒为 60/bpm，**永不用 want/span 反推速度**。
 * · span 只用于区分两种形态：
 *     - 短片段（passSec < want*0.7）→ 按原始四分拍**整段循环**铺满；
 *     - 整曲识别（passSec >= want*0.7）→ 不再循环，也不压缩，最多播 1 遍并在尾部截断。
 * · 旧实现用 spb = want*0.985/span 等比压缩，把每个音符的 onset/dur 都改小，
 *   导致 18 首（晴天/稻香等）被压到 1.03–2.19 倍速且局部节奏型全错。
 * · 数据本身的疏密/单音退化由 omrQuality() 门禁在更上层降级（BUG-05），不在此篡改节奏。
 */
function expandOmr(def, omr) {
  const bpm = def.bpm || 80;
  const spb = 60 / bpm;                         // 四分拍秒数：永不被压缩
  const span = omr.span || 16;
  const want = def.durationSec || 0;
  const passSec = span * spb;                   // 按真实四分拍走一遍的时长
  /* 单遍已覆盖目标时长的 70% → 视为整曲识别，不再循环 */
  const isFullSong = want > 0 && passSec >= want * OMR_FULLSONG_RATIO;
  const loops = want > 0
    ? (isFullSong ? 1 : Math.max(1, Math.ceil(want / passSec)))
    : 1;
  const cut = want > 0 ? want + spb * 4 : Infinity;   // 尾容差 1 小节，避免内容重复
  const notes = [];
  for (let l = 0; l < loops; l++) {
    const off = l * span * spb;
    for (const [beat, dur, midi] of omr.n) {
      const t = off + beat * spb;
      if (t > cut) break;
      notes.push({
        time: +t.toFixed(4),
        dur: +(dur * spb).toFixed(4),
        midi,
      });
    }
  }
  return newSong({
    id: def.id,
    title: def.title,
    artist: def.artist,
    instrument: 'acoustic-guitar',
    key: def.key || 'C',
    bpm,
    capo: def.capo || 0,
    difficulty: def.difficulty || 'beginner',
    genre: def.genre || 'Pop',
    notes,
    lyrics: def.lyrics || [],
    background: def.background || { type: 'solid', value: '' },
    source: 'omr-tab',
    chartKind: 'omr',
  });
}

function expandMelody(def) {
  const bpm = def.bpm || 100;
  return newSong({
    id: def.id,
    title: def.title,
    artist: def.artist,
    instrument: 'acoustic-guitar',
    key: def.key || 'C',
    bpm,
    capo: def.capo || 0,
    difficulty: def.difficulty || 'beginner',
    genre: def.genre || 'Folk',
    notes: parseMelody(bpm, def.melody || ''),
    lyrics: def.lyrics || [],
    background: def.background || { type: 'animated', value: 'starfield' },
    source: 'builtin',
    chartKind: 'melody',
  });
}

/** 惰性展开并缓存；重复演奏同一首不再重建音符数组 */
export function findSong(id) {
  if (!id) return null;
  if (cache.has(id)) return cache.get(id);
  const def = defById(id);
  if (!def) return null;
  const omr = GP_OMR_NOTES[def.id] || null;
  let song;
  if (def.melody) {
    song = expandMelody(def);
  } else if (omr && omrQuality(omr, def).usable) {
    song = expandOmr(def, omr);                       // 通过质量门禁的真实识谱
  } else {
    /* 无 OMR，或 OMR 未过质量门禁 —— 诚实降级为「自动生成的简易伴奏」，
       不再把 placeholders / 退化识谱当成真实的原曲谱面呈现（BUG-02 + BUG-05） */
    song = expandChord(def);
  }
  song = ensureMetadata(song);
  cache.set(id, song);
  return song;
}

export function clearCache() { cache.clear(); }

export default {
  listDefs, defCount, searchDefs, defById, findSong, clearCache,
  omrQuality, isOmrDegraded, hasRealChart, displayTitle, GP_PROVENANCE,
};
