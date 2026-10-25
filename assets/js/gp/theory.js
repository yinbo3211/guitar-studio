// Chords, intervals, capo logic, transposition helpers.
import { NOTE_SHARP, midiToName } from "./notes.js";

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
  add9:   { label: "add9", intervals: [0, 4, 7, 14] },
  power:  { label: "5", intervals: [0, 7] },
};

export function chordMidis(rootMidi, type = "maj") {
  const t = CHORD_TYPES[type] || CHORD_TYPES.maj;
  return t.intervals.map((i) => rootMidi + i);
}

export function chordName(rootPc, type = "maj") {
  return NOTE_SHARP[((rootPc % 12) + 12) % 12] + (CHORD_TYPES[type]?.label ?? "");
}

/** Identify a chord (root + type) from a set of midi notes, if recognizable. */
export function identifyChord(midis) {
  if (!midis || midis.length < 2) return null;
  const pcs = [...new Set(midis.map((m) => ((m % 12) + 12) % 12))].sort((a, b) => a - b);
  for (let r = 0; r < 12; r++) {
    const rel = pcs.map((p) => ((p - r) % 12 + 12) % 12).sort((a, b) => a - b);
    for (const [type, def] of Object.entries(CHORD_TYPES)) {
      const want = [...new Set(def.intervals.map((i) => i % 12))].sort((a, b) => a - b);
      if (rel.length === want.length && rel.every((v, i) => v === want[i])) {
        return { rootPc: r, type, name: chordName(r, type) };
      }
    }
  }
  return null;
}

export function intervalBetween(m1, m2) {
  const semis = Math.abs(m2 - m1);
  const within = ((semis % 12) + 12) % 12;
  return INTERVALS.find((i) => i.semitones === within) || INTERVALS[0];
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

export function describeMidiSet(midis) {
  const c = identifyChord(midis);
  if (c) return c.name;
  return midis.map((m) => midiToName(m).full).join(" ");
}
