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
import { chordMidis, keyToPc } from './theory.js';
import { deriveHarmony } from './harmony.js';

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
/* T03（V4.2.3 · P-2/P-3）：loopRatio 门禁放宽并导出（tools/diagnose-songbook.mjs 依赖）。
   旧口径 [0.9, 1.1] 把 19 首「片段循环 / 尾部截断」的真实识谱一律误杀降级；
   放宽后：
     ratio < 1 → 片段比整曲长 → 尾部截断使用（≥0.55 即保留，截断处由 loopInfo.truncated 标注）；
     ratio > 1 → 片段比整曲短 → 循环 ≤4 遍使用（由 loopInfo.looped 标注）。 */
export const OMR_LOOP_RATIO_MIN = 0.55;
export const OMR_LOOP_RATIO_MAX = 4.0;

/**
 * T03 · BPM 反推（P-3，严防循环论证）。
 * ------------------------------------------------------------
 * `bpm_real = span / (durationSec/60)` 隐含「OMR 片段 = 整曲」假设，
 * 而该前提正是 loopRatio 要判定的东西；若用反推 bpm 再算 loopRatio，
 * 门禁恒等于 1、完全失效。因此：
 *   · 门禁始终用 tier bpm 计算 loopRatio，本函数结果**不得回灌门禁**；
 *   · 仅当三者同时满足才采纳反推值（实测约 13 首候选）：
 *       ① tier-bpm 下 loopRatio ∈ [0.9, 1.1]（单遍≈整曲，假设成立）；
 *       ② |dev| ≤ 15%；③ 60 ≤ bpm ≤ 200。
 *   · 回滚开关：本函数返回 { bpm: def.bpm, bpmSource: 'fallback-tier' }
 *     即回到旧行为，无需改数据。
 * @returns {{bpm:number, bpmSource:'tier-estimate'|'derived-omr'|'fallback-tier'}}
 */
export function deriveBpm(def, omr) {
  const tierBpm = (def && def.bpm) || 80;
  if (!def || !omr || !(omr.span > 0) || !(def.durationSec > 0)) {
    return { bpm: tierBpm, bpmSource: 'tier-estimate' };
  }
  /* 与 omrQuality 同一口径的 tier-bpm loopRatio（循环论证防火墙） */
  const spb = 60 / tierBpm;
  const want = def.durationSec;
  const passSec = omr.span * spb;
  const isFullSong = passSec >= want * OMR_FULLSONG_RATIO;
  const loops = isFullSong ? 1 : Math.max(1, Math.ceil(want / passSec));
  const expandedSec = Math.min(loops * passSec, want + spb * 4);
  const ratio = expandedSec / passSec;
  if (ratio < 0.9 || ratio > 1.1) return { bpm: tierBpm, bpmSource: 'fallback-tier' };
  const real = omr.span / (want / 60);
  const dev = Math.abs(real - tierBpm) / tierBpm;
  if (dev <= 0.15 && real >= 60 && real <= 200) {
    return { bpm: +real.toFixed(1), bpmSource: 'derived-omr' };
  }
  return { bpm: tierBpm, bpmSource: 'fallback-tier' };
}

/**
 * OMR 数据质量评估（纯函数，可直接单测）。
 * @param {object} omr GP_OMR_NOTES 条目（{b, span, n}）
 * @param {object} [def] 曲目紧凑定义（可选）；传入后追加循环遍数判定（T03 放宽至
 *        [OMR_LOOP_RATIO_MIN, OMR_LOOP_RATIO_MAX]），并追加 loopInfo / bpmSource /
 *        bpmEffective 元数据。不传 def 时跳过循环判定（保持旧行为，不含追加字段）。
 * @returns {{notes:number, bars:number, density:number, pitchKinds:number,
 *            passSec:number, loops:number, loopRatio:number, usable:boolean,
 *            loopInfo?:object, bpmSource?:string, bpmEffective?:number}}
 */
export function omrQuality(omr, def) {
  const list = (omr && Array.isArray(omr.n)) ? omr.n : [];
  const bars = (omr && omr.span > 0) ? omr.span / (omr.b || 4) : 0;
  const notes = list.length;
  const density = bars > 0 ? notes / bars : 0;
  const pitchKinds = new Set(list.flatMap((x) => x[2])).size;
  /* 循环遍数判定：与 expandOmr 同一套口径（spb 恒为 60/bpm，不压缩）。
     T03 防火墙：永远用 tier bpm，deriveBpm 的反推值不回灌此门禁。 */
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
  const out = { notes, bars, density, pitchKinds, passSec, loops, loopRatio, usable };
  if (def) {
    out.loopInfo = {
      passes: loops,
      ratio: loopRatio,
      truncated: loopRatio < 0.98,
      looped: loopRatio > 1.02,
      passSec,
    };
    const b = deriveBpm(def, omr);
    out.bpmSource = b.bpmSource;
    out.bpmEffective = b.bpm;
  }
  return out;
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

/* ---------- P-5 节奏型多样化（V4.2.3） ----------
   硬约束：不得产出单音音符 —— GP-2 要求每个 note 3–4 音、CHART-2 要求
   降级曲 notes.every(n => n.chord === true)。因此 PATTERNS 只改
   onset / dur / 力度 / 和弦音排列顺序，每个事件仍是完整和弦。
   · b    小节内 onset（拍，0.25 拍的整数倍，保证落在 OMR-3b 网格上）
   · d    时值（拍）
   · vel  力度 0–1
   · rot  和弦音排列右旋位数（分解和弦的拨弦顺序，音集不变） */
export const PATTERNS = {
  'strum-4': {
    events: [
      { b: 0, d: 0.85, vel: 0.95 }, { b: 1, d: 0.85, vel: 0.8 },
      { b: 2, d: 0.85, vel: 0.9 }, { b: 3, d: 0.85, vel: 0.8 },
    ],
  },
  'strum-folk': {
    events: [
      { b: 0, d: 1.6, vel: 0.95 }, { b: 1.5, d: 0.4, vel: 0.7 },
      { b: 2, d: 0.85, vel: 0.9 }, { b: 3, d: 0.85, vel: 0.8 },
    ],
  },
  'arp-5321': {
    events: [
      { b: 0, d: 0.9, vel: 0.95, rot: 0 }, { b: 1, d: 0.9, vel: 0.75, rot: 2 },
      { b: 2, d: 0.9, vel: 0.8, rot: 1 }, { b: 3, d: 0.9, vel: 0.7, rot: 3 },
    ],
  },
  'syncopate': {
    events: [
      { b: 0, d: 0.85, vel: 0.95 }, { b: 1.5, d: 0.6, vel: 0.75 },
      { b: 2, d: 0.85, vel: 0.9 }, { b: 3.5, d: 0.45, vel: 0.8 },
    ],
  },
};
/* 缺省按难度层级分配（数据层 def.pattern 恒为 '4-per-bar' 占位，不入表时走层级）。
   F-5：tier 2 按曲号奇偶在 民谣扫弦 / 分解 5321 间交替（慢板叙事曲用分解更自然），
   保证 PATTERNS 定义的 4 种节奏型全部有可达路径、无死配置。 */
const TIER_PATTERN = { 1: 'strum-4', 2: 'strum-folk', 3: 'syncopate' };
export function pickPattern(def) {
  const byDef = def && PATTERNS[def.pattern];
  if (byDef) return byDef;
  const tier = (def && def.tier) || 1;
  let name = TIER_PATTERN[tier] || 'strum-4';
  if (tier === 2 && def && def.no % 2 === 0) name = 'arp-5321';
  return PATTERNS[name];
}

/* ---------- 展开：紧凑定义 -> GuitarPicker 歌曲对象 ---------- */
function expandChord(def) {
  const bpm = def.bpm || 80;
  const spb = 60 / bpm;
  const bar = spb * 4;
  /* P-4 运行时派生：该曲有 OMR 数据（含未过门禁的退化识谱）时，
     按小节聚合识别真实和弦进行替换模板；全部识别失败则回退模板（零数据风险） */
  let harmony = {
    source: 'template',
    chords: (def.harmony && def.harmony.chords) || [[0, 'maj']],
    uncertainBars: [],
  };
  const omr = GP_OMR_NOTES[def.id] || null;
  if (omr) {
    const derived = deriveHarmony(omr, omr.b || 4, { keyPc: keyToPc(def.key || 'C') ?? 0 });
    if (derived.chords.length) {
      harmony = { source: 'derived-omr', chords: derived.chords, uncertainBars: derived.uncertainBars };
    }
  }
  const chords = harmony.chords;
  const pattern = pickPattern(def);
  const want = Math.ceil((def.durationSec || 120) / bar);
  const bars = Math.max(MIN_BARS, Math.min(MAX_BARS, want));
  const notes = [];
  for (let b = 0; b < bars; b++) {
    const [pc, type] = chords[b % chords.length];
    const midi = chordMidis(ROOT_MIDI + ((pc % 12) + 12) % 12, type);
    for (const ev of pattern.events) {
      /* rot：分解和弦改拨弦顺序（音集不变，仍是 3–4 音完整和弦） */
      const voiced = ev.rot ? midi.map((_, i) => midi[(i + ev.rot) % midi.length]) : midi;
      notes.push({
        time: +(b * bar + ev.b * spb).toFixed(4),
        dur: +(ev.d * spb).toFixed(4),
        midi: voiced,
        chord: true,
        vel: ev.vel,
      });
    }
  }
  const song = newSong({
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
  /* P-4：派生来源标记（derived-omr / template），供徽章与 provenance 审计 */
  song.harmony = harmony;
  return song;
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
  const song = newSong({
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
  /* T03 元数据写回：循环/截断标注 + BPM 反推来源（门禁仍用 tier bpm，不回灌） */
  const q = omrQuality(omr, def);
  song.loopInfo = q.loopInfo;
  song.bpmSource = q.bpmSource;
  song.bpmEffective = q.bpmEffective;
  return song;
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
  deriveBpm, PATTERNS, pickPattern, OMR_LOOP_RATIO_MIN, OMR_LOOP_RATIO_MAX,
};
