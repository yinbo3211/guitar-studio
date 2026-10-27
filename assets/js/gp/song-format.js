// Song schema: validate, parse, serialize, plus a compact authoring notation.
import { nameToMidi } from "./notes.js";

export const SONG_VERSION = 1;

/**
 * 谱面来源分级（V4.2.1 · BUG-02）。
 * omr              —— 吉他社图片谱 OMR 识别并通过质量门禁，可作为真实谱呈现与评分
 * melody           —— 公有领域 / 人工记谱的真实旋律
 * generated-chords —— 程序生成的占位伴奏（含 OMR 未过门禁的降级），
 *                     **不是原曲编配**，必须显著标记且不参与音准评分
 */
export const CHART_KINDS = ['omr', 'melody', 'generated-chords'];

export function uid() {
  return crypto.randomUUID();
}

export function newSong(partial = {}) {
  return {
    v: SONG_VERSION,
    id: partial.id || uid(),
    title: partial.title || "Untitled",
    artist: partial.artist || "Unknown / Trad.",
    instrument: partial.instrument || "acoustic-guitar",
    key: partial.key ?? "C",
    bpm: partial.bpm || 90,
    capo: partial.capo || 0,
    difficulty: partial.difficulty || "beginner",
    genre: partial.genre || "Unknown",
    mood: partial.mood || "",
    tags: partial.tags || [],
    background: partial.background || { type: "solid", value: "" },
    audio: partial.audio || { backing: null, vocal: null },
    chartKind: partial.chartKind || "generated-chords",
    // Other instruments in the arrangement. Whichever part matches the player's
    // instrument becomes the highway; the rest are synthesized as the backing.
    parts: partial.parts || [],
    lyrics: partial.lyrics || [],
    voice: partial.voice || { notes: [] },
    notes: partial.notes || [],
    source: partial.source || "manual",
    createdAt: partial.createdAt || new Date().toISOString(),
  };
}

export function validateSong(o) {
  const errors = [];
  if (!o || typeof o !== "object") return { ok: false, errors: ["not an object"] };
  if (!o.title) errors.push("missing title");
  if (!Array.isArray(o.notes)) errors.push("notes must be an array");
  else o.notes.forEach((n, i) => {
    if (typeof n.time !== "number") errors.push(`note ${i}: time`);
    if (!Array.isArray(n.midi)) errors.push(`note ${i}: midi[]`);
  });
  if (typeof o.bpm !== "number" || o.bpm <= 0) errors.push("bpm");
  /* chartKind：允许缺省（旧数据），但一旦给了值必须是合法枚举 */
  if (o.chartKind != null && CHART_KINDS.indexOf(o.chartKind) < 0) {
    errors.push(`chartKind 非法：${o.chartKind}`);
  }
  if (o.lyrics != null && !Array.isArray(o.lyrics)) errors.push("lyrics must be an array");
  else if (Array.isArray(o.lyrics)) o.lyrics.forEach((l, i) => {
    if (typeof l.time !== "number") errors.push(`lyric ${i}: time`);
    if (l.words != null && !Array.isArray(l.words)) errors.push(`lyric ${i}: words must be an array`);
  });
  if (o.voice != null) {
    if (typeof o.voice !== "object") errors.push("voice must be an object");
    else if (o.voice.notes != null && !Array.isArray(o.voice.notes)) errors.push("voice.notes must be an array");
  }
  if (o.parts != null) {
    if (!Array.isArray(o.parts)) errors.push("parts must be an array");
    else o.parts.forEach((p, i) => {
      if (!p || typeof p !== "object") errors.push(`part ${i}: not an object`);
      else if (!Array.isArray(p.notes)) errors.push(`part ${i}: notes[]`);
      else if (!p.instrument) errors.push(`part ${i}: instrument`);
    });
  }
  return { ok: errors.length === 0, errors };
}

/** Every part of the arrangement, the song's own notes first. */
export function songParts(song) {
  const lead = { instrument: song.instrument || "acoustic-guitar", name: song.partName || "Lead", notes: song.notes || [] };
  return [lead, ...(song.parts || []).filter((p) => p?.notes?.length)];
}

/** Which part the player plays: theirs if the song has one, else the lead. */
export function pickPart(song, instrument) {
  const parts = songParts(song);
  const index = Math.max(0, parts.findIndex((p) => p.instrument === instrument));
  return { parts, index, lead: parts[index] };
}

export function serialize(song) { return JSON.stringify(song, null, 2); }

export function parse(text) {
  const o = JSON.parse(text);
  const v = validateSong(o);
  if (!v.ok) throw new Error("Invalid song: " + v.errors.join(", "));
  return newSong(o); // normalize / fill defaults
}

/* BUG-11：歌词行缺省时长与 karaoke-timeline.js 的 DEFAULT_LINE_DUR 保持一致 */
const LYRIC_DEFAULT_DUR = 3;

/**
 * 整曲时长（统一口径 · BUG-11）：
 *   max(谱面最后一个音符结束时间, 歌词时间轴最后一个时间点)。
 * 歌词行结束时间与 karaoke-timeline 同一规则：
 *   行自带 dur → time + dur；否则取下一行 time；末行缺省 +LYRIC_DEFAULT_DUR。
 * 这样卡拉 OK 歌词不会在谱面音符结束后被中途截断（8 首越界曲目）。
 */
export function songDuration(song) {
  const notes = (song && Array.isArray(song.notes)) ? song.notes : [];
  const noteEnd = notes.reduce((m, n) => Math.max(m, n.time + (n.dur || 0.4)), 0);
  const raw = (song && Array.isArray(song.lyrics) ? song.lyrics : [])
    .filter((l) => l && typeof l.time === 'number')
    .slice()
    .sort((a, b) => a.time - b.time);
  const lyricEnd = raw.reduce((m, L, i) => {
    const next = raw[i + 1];
    const end = L.dur != null ? L.time + L.dur
      : (next ? next.time : L.time + LYRIC_DEFAULT_DUR);
    return Math.max(m, end);
  }, 0);
  return Math.max(noteEnd, lyricEnd);
}

/**
 * Select the current prompt note, or the nearest future note inside a beat-based
 * look-ahead window. Overlapping active notes prefer the latest start time.
 */
export function pickPromptNote(notes, t, spb, lead = 1.5) {
  if (!Array.isArray(notes) || !notes.length || !Number.isFinite(t) || t < 0
      || !Number.isFinite(spb) || spb <= 0 || !Number.isFinite(lead) || lead < 0) return null;
  let active = null;
  let future = null;
  for (const note of notes) {
    if (!note || !Number.isFinite(note.time)) continue;
    const duration = Number.isFinite(note.dur) ? Math.max(0, note.dur) : 0;
    if (note.time <= t && t <= note.time + duration) {
      if (!active || note.time > active.time) active = note;
    } else if (note.time > t && (!future || note.time < future.time)) {
      future = note;
    }
  }
  if (active) return { note: active, now: true };
  if (future && future.time - t <= lead * spb) return { note: future, now: false };
  return null;
}

/**
 * Compact authoring notation -> notes[].
 * Tokens separated by spaces. Each token is PITCHES:beats
 *   - PITCHES: a note like "E4", a chord "C4+E4+G4", or "r" for rest
 *   - beats: number of beats (defaults to 1 if omitted)
 * Example: "C4:1 E4:1 G4:2 C4+E4+G4:2 r:1"
 */
export function parseMelody(bpm, str) {
  const spb = 60 / bpm;
  let t = 0;
  const notes = [];
  for (const tok of str.trim().split(/\s+/)) {
    if (!tok) continue;
    const [pitchPart, beatPart] = tok.split(":");
    const beats = beatPart ? parseFloat(beatPart) : 1;
    const dur = beats * spb;
    if (pitchPart === "r" || pitchPart === "rest") { t += dur; continue; }
    const midi = pitchPart.split("+").map((p) => nameToMidi(p)).filter((m) => m != null);
    if (midi.length) notes.push({ time: +t.toFixed(4), dur: +(dur * 0.92).toFixed(4), midi });
    t += dur;
  }
  return notes;
}

// ---- metadata ("analysis") -------------------------------------------------

export const GENRES = [
  "Classical", "Folk", "Blues", "Rock", "Pop", "Jazz", "Country",
  "Holiday", "Children's", "Hymn/Gospel", "Funk/Soul", "World", "Electronic", "Unknown",
];

// Lightweight metadata analysis: infer a genre + mood when a song lacks them,
// from title keywords, instrument and tempo. Not musicology — a useful default
// so every song in the library carries metadata.
export function analyzeSong(song) {
  const title = (song.title || "").toLowerCase();
  const inst = song.instrument || "acoustic-guitar";
  const bpm = song.bpm || 90;
  const keyword = [
    ["blues", "Blues"], ["boogie", "Blues"], ["jazz", "Jazz"], ["swing", "Jazz"], ["rag", "Jazz"],
    ["waltz", "Classical"], ["sonata", "Classical"], ["symphony", "Classical"], ["nocturne", "Classical"],
    ["minuet", "Classical"], ["prelude", "Classical"], ["fugue", "Classical"], ["canon", "Classical"], ["ode", "Classical"],
    ["carol", "Holiday"], ["christmas", "Holiday"], ["jingle", "Holiday"], ["noel", "Holiday"],
    ["grace", "Hymn/Gospel"], ["holy", "Hymn/Gospel"], ["saints", "Hymn/Gospel"], ["hymn", "Hymn/Gospel"],
    ["twinkle", "Children's"], ["lamb", "Children's"], ["abc", "Children's"], ["nursery", "Children's"], ["birthday", "Children's"],
    ["greensleeves", "Folk"], ["scarborough", "Folk"], ["shanty", "Folk"], ["ballad", "Folk"], ["danny", "Folk"],
    ["auld", "Folk"], ["rising", "Folk"], ["lang syne", "Folk"],
    ["pop", "Pop"], ["progression", "Pop"], ["trainer", "Pop"], ["chord", "Pop"],
    ["country", "Country"], ["honky", "Country"],
  ];
  let genre = null;
  for (const [k, g] of keyword) if (title.includes(k)) { genre = g; break; }
  if (!genre) {
    if (inst === "electric-guitar") genre = bpm >= 120 ? "Rock" : "Blues";
    else if (inst === "bass") genre = "Funk/Soul";
    else if (inst === "piano") genre = "Classical";
    else if (inst === "violin" || inst === "mandolin") genre = "Folk";
    else genre = bpm <= 80 ? "Folk" : "Pop";
  }
  const mood = bpm >= 130 ? "Energetic" : bpm >= 100 ? "Upbeat" : bpm <= 70 ? "Mellow" : "Bright";
  return { genre, mood };
}

// Fill missing genre/mood/tags on a song (in place) and return it.
export function ensureMetadata(song) {
  if (!song) return song;
  if (!song.genre || song.genre === "Unknown" || !song.mood) {
    const a = analyzeSong(song);
    if (!song.genre || song.genre === "Unknown") song.genre = a.genre;
    if (!song.mood) song.mood = a.mood;
  }
  if (!Array.isArray(song.tags)) song.tags = [];
  return song;
}
