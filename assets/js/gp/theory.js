// Chords, intervals, capo logic, transposition helpers.
import { NOTE_FLAT, NOTE_SHARP, midiToName } from "./notes.js";

export const INTERVALS = [
  { semitones: 0, short: "P1", name: "Unison" },
  { semitones: 1, short: "m2", name: "Minor 2nd" },
  { semitones: 2, short: "M2", name: "Major 2nd" },
  { semitones: 3, short: "m3", name: "Minor 3rd" },
  { semitones: 4, short: "M3", name: "Major 3rd" },
  { semitones: 5, short: "P4", name: "Perfect 4th" },
  { semitones: 6, short: "TT", name: "Tritone" },
  { semitones: 7, short: "P5", name: "Perfect 5th" },
  { semitones: 8, short: "m6", name: "Minor 6th" },
  { semitones: 9, short: "M6", name: "Major 6th" },
  { semitones: 10, short: "m7", name: "Minor 7th" },
  { semitones: 11, short: "M7", name: "Major 7th" },
  { semitones: 12, short: "P8", name: "Octave" },
];

// chord formulas as semitone offsets from root
export const CHORD_TYPES = {
  maj:    { label: "", intervals: [0, 4, 7] },
  min:    { label: "m", intervals: [0, 3, 7] },
  dim:    { label: "dim", intervals: [0, 3, 6] },
  aug:    { label: "aug", intervals: [0, 4, 8] },
  sus2:   { label: "sus2", intervals: [0, 2, 7] },
  sus4:   { label: "sus4", intervals: [0, 5, 7] },
  maj7:   { label: "maj7", intervals: [0, 4, 7, 11] },
  min7:   { label: "m7", intervals: [0, 3, 7, 10] },
  dom7:   { label: "7", intervals: [0, 4, 7, 10] },
  dim7:   { label: "dim7", intervals: [0, 3, 6, 9] },
  m7b5:   { label: "m7b5", intervals: [0, 3, 6, 10] },
  six:    { label: "6", intervals: [0, 4, 7, 9] },
  m6:     { label: "m6", intervals: [0, 3, 7, 9] },
  add9:   { label: "add9", intervals: [0, 4, 7, 14] },
  power:  { label: "5", intervals: [0, 7] },
};

export function chordMidis(rootMidi, type = "maj") {
  const t = CHORD_TYPES[type] || CHORD_TYPES.maj;
  return t.intervals.map((i) => rootMidi + i);
}

/** Common flat-key tonics: F, Bb, Eb, Ab, Db and Gb. */
export const FLAT_KEY_PCS = new Set([5, 10, 3, 8, 1, 6]);

/** Whether a key context prefers flat enharmonic spelling. */
export function prefersFlat(keyPc) {
  return Number.isFinite(keyPc) && FLAT_KEY_PCS.has(((keyPc % 12) + 12) % 12);
}

/** Name a chord, choosing enharmonic spelling from the key context. */
export function chordName(rootPc, type = "maj", opts = {}) {
  const options = opts || {};
  const pc = ((rootPc % 12) + 12) % 12;
  const keyPc = Number.isFinite(options.keyPc) ? ((options.keyPc % 12) + 12) % 12 : null;
  const useFlat = options.useFlat ?? (keyPc != null && FLAT_KEY_PCS.has(keyPc));
  const names = useFlat ? NOTE_FLAT : NOTE_SHARP;
  return names[pc] + (CHORD_TYPES[type]?.label ?? "");
}

/** Identify a chord using bass, key and chord completeness as scoring evidence. */
export function identifyChord(midis, opts = {}) {
  if (!Array.isArray(midis) || midis.length < 2) return null;
  const sorted = midis.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (sorted.length < 2) return null;
  const bassPc = ((sorted[0] % 12) + 12) % 12;
  const pcs = [...new Set(sorted.map((midi) => ((midi % 12) + 12) % 12))].sort((a, b) => a - b);
  if (pcs.length < 2) return null;
  const options = opts || {};
  const candidates = [];
  for (let rootPc = 0; rootPc < 12; rootPc++) {
    const relative = pcs.map((pc) => ((pc - rootPc) % 12 + 12) % 12).sort((a, b) => a - b);
    for (const [type, definition] of Object.entries(CHORD_TYPES)) {
      const wanted = [...new Set(definition.intervals.map((interval) => interval % 12))].sort((a, b) => a - b);
      if (relative.length !== wanted.length || !relative.every((value, index) => value === wanted[index])) continue;
      let score = wanted.length * 2;
      if (rootPc === bassPc) score += 100;
      if (Number.isFinite(options.keyPc) && rootPc === ((options.keyPc % 12) + 12) % 12) score += 30;
      candidates.push({
        rootPc,
        type,
        name: chordName(rootPc, type, options),
        score,
      });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] || null;
}

export function intervalBetween(m1, m2) {
  const semis = Math.abs(m2 - m1);
  const within = ((semis % 12) + 12) % 12;
  return INTERVALS.find((i) => i.semitones === within) || INTERVALS[0];
}

/** Convert a major/minor key name such as C, F#, Bb or Am to pitch class. */
export function keyToPc(key) {
  const normalized = String(key == null ? "" : key).trim().replace(/♯/g, "#").replace(/♭/g, "b");
  const match = /^([A-Ga-g])([#b]?)(?:m|min|minor)?$/.exec(normalized);
  if (!match) return null;
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[match[1].toUpperCase()];
  const accidental = match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0;
  return ((base + accidental) % 12 + 12) % 12;
}

const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/** Infer the most likely key from a duration-weighted note histogram. */
export function detectKey(notes) {
  if (!Array.isArray(notes) || !notes.length) return null;
  const histogram = new Array(12).fill(0);
  for (const note of notes) {
    if (!note || !Array.isArray(note.midi)) continue;
    const weight = Number.isFinite(note.dur) && note.dur > 0 ? note.dur : 1;
    for (const midi of note.midi) {
      if (!Number.isFinite(midi)) continue;
      histogram[((midi % 12) + 12) % 12] += weight;
    }
  }
  if (!histogram.some((weight) => weight > 0)) return null;

  const correlate = (profile) => {
    let best = { pc: 0, score: -Infinity };
    for (let rootPc = 0; rootPc < 12; rootPc++) {
      let score = 0;
      for (let interval = 0; interval < 12; interval++) {
        score += histogram[(rootPc + interval) % 12] * profile[interval];
      }
      if (score > best.score) best = { pc: rootPc, score };
    }
    return best;
  };

  const major = correlate(MAJOR_PROFILE);
  const minor = correlate(MINOR_PROFILE);
  return major.score >= minor.score
    ? { pc: major.pc, minor: false }
    : { pc: minor.pc, minor: true };
}

// ---------- Capo & transposition ----------
/** With a capo at `fret`, an open-position chord shape sounds `fret` semitones higher.
 *  To play song in `songKeyPc` using easy shapes, suggest capo + shape key. */
export function suggestCapo(songKeyPc, preferredShapes = [0, 7, 2, 9, 4]) {
  // preferredShapes are pcs of easy open keys: C, G, D, A, E
  let best = null;
  for (const shapePc of preferredShapes) {
    let capo = (songKeyPc - shapePc + 12) % 12;
    if (capo > 7) continue; // capo beyond fret 7 is impractical
    if (!best || capo < best.capo) best = { capo, shapePc, shapeName: NOTE_SHARP[shapePc] };
  }
  return best || { capo: 0, shapePc: songKeyPc, shapeName: NOTE_SHARP[songKeyPc] };
}

export function transposeNote(midi, semitones) { return midi + semitones; }
export function transposeSong(notes, semitones) {
  return notes.map((n) => ({ ...n, midi: n.midi.map((m) => m + semitones) }));
}

export function keyName(pc, minor = false) {
  return NOTE_SHARP[((pc % 12) + 12) % 12] + (minor ? "m" : "");
}

export function describeMidiSet(midis, opts = {}) {
  const c = identifyChord(midis, opts);
  if (c) return c.name;
  return Array.isArray(midis) ? midis.filter(Number.isFinite).map((m) => midiToName(m).full).join(" ") : "";
}
