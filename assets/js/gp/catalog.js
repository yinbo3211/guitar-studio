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
import { newSong, parseMelody, ensureMetadata } from './song-format.js';
import { chordMidis } from './theory.js';

const ROOT_MIDI = 48;            // C3 —— 吉他常用把位区间
const MAX_BARS = 96;
const MIN_BARS = 8;
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
  });
}

/** 惰性展开并缓存；重复演奏同一首不再重建音符数组 */
export function findSong(id) {
  if (!id) return null;
  if (cache.has(id)) return cache.get(id);
  const def = defById(id);
  if (!def) return null;
  const song = ensureMetadata(def.melody ? expandMelody(def) : expandChord(def));
  cache.set(id, song);
  return song;
}

export function clearCache() { cache.clear(); }

export default { listDefs, defCount, searchDefs, defById, findSong, clearCache, GP_PROVENANCE };
