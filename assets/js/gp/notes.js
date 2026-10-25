// Notes, frequencies, names, scales, keys, instrument tunings, fretboard math.

export const NOTE_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const NOTE_FLAT  = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

export function midiToFreq(midi, a4 = 440) { return a4 * Math.pow(2, (midi - 69) / 12); }
export function freqToMidiFloat(freq, a4 = 440) { return 69 + 12 * Math.log2(freq / a4); }
export function freqToMidi(freq, a4 = 440) { return Math.round(freqToMidiFloat(freq, a4)); }

export function midiToName(midi, { flat = false } = {}) {
  const m = Math.round(midi);
  const names = flat ? NOTE_FLAT : NOTE_SHARP;
  const pc = ((m % 12) + 12) % 12;
  const octave = Math.floor(m / 12) - 1;
  return { name: names[pc], octave, pc, full: names[pc] + octave, midi: m };
}
export function noteFull(midi, opts) { return midiToName(midi, opts).full; }

/** signed cents that `freq` is from the nearest equal-tempered note */
export function centsFromNearest(freq, a4 = 440) {
  const f = freqToMidiFloat(freq, a4);
  const nearest = Math.round(f);
  return { midi: nearest, cents: Math.round((f - nearest) * 100) };
}
/** cents of `freq` relative to a specific target midi */
export function centsTo(freq, targetMidi, a4 = 440) {
  return Math.round((freqToMidiFloat(freq, a4) - targetMidi) * 100);
}

export function nameToMidi(name) {
  // "C4", "F#3", "Bb2"
  const m = name.trim().match(/^([A-Ga-g])([#b]?)(-?\d+)$/);
  if (!m) return null;
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1].toUpperCase()];
  const acc = m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0;
  const oct = parseInt(m[3], 10);
  return base + acc + (oct + 1) * 12;
}

// ---------- Scales ----------
export const SCALES = {
  major:            [0, 2, 4, 5, 7, 9, 11],
  natural_minor:    [0, 2, 3, 5, 7, 8, 10],
  harmonic_minor:   [0, 2, 3, 5, 7, 8, 11],
  melodic_minor:    [0, 2, 3, 5, 7, 9, 11],
  major_pentatonic: [0, 2, 4, 7, 9],
  minor_pentatonic: [0, 3, 5, 7, 10],
  blues:            [0, 3, 5, 6, 7, 10],
  dorian:           [0, 2, 3, 5, 7, 9, 10],
  mixolydian:       [0, 2, 4, 5, 7, 9, 10],
  chromatic:        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

export function scaleNotes(rootPc, scale = "major") {
  const ints = SCALES[scale] || SCALES.major;
  return ints.map((i) => (rootPc + i) % 12);
}

// Number of sharps(+)/flats(-) per major key, for "key signature" display
export const KEY_SIGNATURES = {
  C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, "F#": 6, "C#": 7,
  F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7,
};
export const CIRCLE_OF_FIFTHS = ["C", "G", "D", "A", "E", "B", "F#", "Db", "Ab", "Eb", "Bb", "F"];

// ---------- Instruments & tunings (open-string MIDI, low -> high) ----------
export const INSTRUMENTS = {
  "acoustic-guitar": { name: "Acoustic Guitar", strings: [40, 45, 50, 55, 59, 64], frets: 20, kind: "fretted" },
  "electric-guitar": { name: "Electric Guitar", strings: [40, 45, 50, 55, 59, 64], frets: 22, kind: "fretted" },
  "bass":            { name: "Bass Guitar",     strings: [28, 33, 38, 43],          frets: 20, kind: "fretted" },
  "ukulele":         { name: "Ukulele",         strings: [67, 60, 64, 69],          frets: 15, kind: "fretted" },
  "mandolin":        { name: "Mandolin",        strings: [55, 62, 69, 76],          frets: 20, kind: "fretted" },
  "violin":          { name: "Violin",          strings: [55, 62, 69, 76],          frets: 0,  kind: "bowed" },
  "piano":           { name: "Piano / Keys",    strings: [],                        frets: 0,  kind: "keys" },
  "voice":           { name: "Voice",           strings: [],                        frets: 0,  kind: "voice" },
  "harmonica":       { name: "Harmonica (C diatonic)", strings: [],                 frets: 0,  kind: "wind" },
  "recorder":        { name: "Recorder (soprano)", strings: [],                     frets: 0,  kind: "wind" },
  "whistle":         { name: "Tin Whistle (D)",   strings: [],                      frets: 0,  kind: "wind" },
  "flute":           { name: "Flute",             strings: [],                      frets: 0,  kind: "wind" },
  "melodica":        { name: "Melodica",          strings: [],                      frets: 0,  kind: "keys" },
  "kalimba":         { name: "Kalimba (17-key C)", strings: [],                     frets: 0,  kind: "tines" },
  "e-drums":         { name: "Electronic Drums",  strings: [],                      frets: 0,  kind: "percussion" },

  // --- fretted: open-string MIDI low → high, so the tuner and fretboard hints
  // --- come for free. Reentrant tunings (banjo's 5th string) are listed in
  // --- playing order, not pitch order — that is what the player sees.
  "classical-guitar": { name: "Classical Guitar (nylon)", strings: [40, 45, 50, 55, 59, 64], frets: 19, kind: "fretted" },
  "baritone-guitar": { name: "Baritone Guitar (B–B)", strings: [35, 40, 45, 50, 54, 59], frets: 22, kind: "fretted" },
  "guitar-7":        { name: "7-String Guitar",   strings: [35, 40, 45, 50, 55, 59, 64], frets: 24, kind: "fretted" },
  "guitar-12":       { name: "12-String Guitar",  strings: [40, 45, 50, 55, 59, 64], frets: 20, kind: "fretted" },
  "bass-5":          { name: "5-String Bass",     strings: [23, 28, 33, 38, 43],    frets: 22, kind: "fretted" },
  "banjo":           { name: "Banjo (5-string, open G)", strings: [67, 50, 55, 59, 62], frets: 22, kind: "fretted" },
  "tenor-banjo":     { name: "Tenor Banjo (CGDA)", strings: [48, 55, 62, 69],       frets: 19, kind: "fretted" },
  "baritone-ukulele": { name: "Baritone Ukulele", strings: [50, 55, 59, 64],        frets: 18, kind: "fretted" },
  "mandola":         { name: "Mandola",           strings: [48, 55, 62, 69],        frets: 20, kind: "fretted" },
  "bouzouki":        { name: "Irish Bouzouki",    strings: [43, 50, 57, 62],        frets: 24, kind: "fretted" },
  "cavaquinho":      { name: "Cavaquinho",        strings: [62, 67, 71, 74],        frets: 17, kind: "fretted" },
  "dulcimer":        { name: "Mountain Dulcimer", strings: [50, 57, 62],            frets: 17, kind: "fretted" },

  // --- fretless plucked: strings (so the tuner works) but no fret grid
  "fretless-bass":   { name: "Fretless Bass",     strings: [28, 33, 38, 43],        frets: 0,  kind: "plucked" },
  "oud":             { name: "Oud",               strings: [36, 41, 45, 50, 55, 60], frets: 0, kind: "plucked" },

  // --- bowed
  "viola":           { name: "Viola",             strings: [48, 55, 62, 69],        frets: 0,  kind: "bowed" },
  "cello":           { name: "Cello",             strings: [36, 43, 50, 57],        frets: 0,  kind: "bowed" },
  "double-bass":     { name: "Double Bass",       strings: [28, 33, 38, 43],        frets: 0,  kind: "bowed" },
  "erhu":            { name: "Erhu",              strings: [62, 69],                frets: 0,  kind: "bowed" },

  // --- keys
  "electric-piano":  { name: "Electric Piano",    strings: [], frets: 0, kind: "keys" },
  "organ":           { name: "Organ",             strings: [], frets: 0, kind: "keys" },
  "synth":           { name: "Synthesizer",       strings: [], frets: 0, kind: "keys" },
  "accordion":       { name: "Accordion",         strings: [], frets: 0, kind: "keys" },

  // --- wind. Ranges in the guide are SOUNDING pitch: the mic hears what comes
  // --- out of the bell, not what is on the page for a transposing instrument.
  "recorder-alto":   { name: "Recorder (alto)",   strings: [], frets: 0, kind: "wind" },
  "ocarina":         { name: "Ocarina (12-hole)", strings: [], frets: 0, kind: "wind" },
  "pan-flute":       { name: "Pan Flute",         strings: [], frets: 0, kind: "wind" },
  "piccolo":         { name: "Piccolo",           strings: [], frets: 0, kind: "wind" },
  "clarinet":        { name: "Clarinet (B♭)",     strings: [], frets: 0, kind: "wind" },
  "alto-sax":        { name: "Alto Saxophone",    strings: [], frets: 0, kind: "wind" },
  "tenor-sax":       { name: "Tenor Saxophone",   strings: [], frets: 0, kind: "wind" },
  "trumpet":         { name: "Trumpet",           strings: [], frets: 0, kind: "wind" },
  "trombone":        { name: "Trombone",          strings: [], frets: 0, kind: "wind" },
  "french-horn":     { name: "French Horn",       strings: [], frets: 0, kind: "wind" },
  "tuba":            { name: "Tuba",              strings: [], frets: 0, kind: "wind" },
  "harmonica-chromatic": { name: "Harmonica (chromatic, C)", strings: [], frets: 0, kind: "wind" },

  // --- struck & tuned percussion (pitched: graded on pitch like anything else)
  "glockenspiel":    { name: "Glockenspiel",      strings: [], frets: 0, kind: "tines" },
  "xylophone":       { name: "Xylophone",         strings: [], frets: 0, kind: "tines" },
  "marimba":         { name: "Marimba",           strings: [], frets: 0, kind: "tines" },
  "vibraphone":      { name: "Vibraphone",        strings: [], frets: 0, kind: "tines" },
  "handpan":         { name: "Handpan (D minor)", strings: [], frets: 0, kind: "tines" },
  "steel-pan":       { name: "Steel Pan (lead)",  strings: [], frets: 0, kind: "tines" },

  // --- unpitched percussion (graded on hit timing)
  "drum-kit":        { name: "Drum Kit",          strings: [], frets: 0, kind: "percussion" },
  "cajon":           { name: "Cajón",             strings: [], frets: 0, kind: "percussion" },
  "djembe":          { name: "Djembe",            strings: [], frets: 0, kind: "percussion" },
  "bongos":          { name: "Bongos",            strings: [], frets: 0, kind: "percussion" },
};

// Richter-tuned 10-hole C diatonic: blow/draw note per hole (index = hole-1).
// ponytail: C harp only; add a key param + transposition if other keys matter.
export const HARMONICA_BLOW = [60, 64, 67, 72, 76, 79, 84, 88, 91, 96];
export const HARMONICA_DRAW = [62, 67, 71, 74, 77, 81, 83, 86, 89, 93];

/** Hole + breath for a midi on a C diatonic (blow preferred on overlaps); null if unplayable (no bends). */
export function midiToHole(midi) {
  let i = HARMONICA_BLOW.indexOf(midi);
  if (i >= 0) return { hole: i + 1, draw: false };
  i = HARMONICA_DRAW.indexOf(midi);
  return i >= 0 ? { hole: i + 1, draw: true } : null;
}

export const ALT_TUNINGS = {
  "acoustic-guitar": {
    standard: [40, 45, 50, 55, 59, 64],
    "drop-d": [38, 45, 50, 55, 59, 64],
    dadgad: [38, 45, 50, 55, 57, 62],
    "open-g": [38, 43, 50, 55, 59, 62],
  },
  "electric-guitar": {
    standard: [40, 45, 50, 55, 59, 64],
    "drop-d": [38, 45, 50, 55, 59, 64],
    "half-step-down": [39, 44, 49, 54, 58, 63],
  },
  bass: { standard: [28, 33, 38, 43], "drop-d": [26, 33, 38, 43] },
  ukulele: { standard: [67, 60, 64, 69] },
  mandolin: { standard: [55, 62, 69, 76] },
  violin: { standard: [55, 62, 69, 76] },
  "classical-guitar": { standard: [40, 45, 50, 55, 59, 64], "drop-d": [38, 45, 50, 55, 59, 64] },
  "guitar-12": { standard: [40, 45, 50, 55, 59, 64], "drop-d": [38, 45, 50, 55, 59, 64] },
  "guitar-7": { standard: [35, 40, 45, 50, 55, 59, 64], "drop-a": [33, 40, 45, 50, 55, 59, 64] },
  "bass-5": { standard: [23, 28, 33, 38, 43], tenor: [28, 33, 38, 43, 48] },
  banjo: { "open-g": [67, 50, 55, 59, 62], "double-c": [67, 48, 55, 60, 62], "open-d": [66, 50, 54, 57, 62] },
  dulcimer: { "dad-mixolydian": [50, 57, 62], "daa-ionian": [50, 57, 57], "dgd-dorian": [50, 55, 62] },
  bouzouki: { gdad: [43, 50, 57, 62], gdae: [43, 50, 57, 64] },
  viola: { standard: [48, 55, 62, 69] },
  cello: { standard: [36, 43, 50, 57] },
  "double-bass": { standard: [28, 33, 38, 43], solo: [30, 35, 40, 45] },
  "fretless-bass": { standard: [28, 33, 38, 43], "drop-d": [26, 33, 38, 43] },
};

export const KIND_LABEL = {
  fretted: "Fretted", plucked: "Plucked (fretless)", bowed: "Bowed", keys: "Keyboard",
  wind: "Wind", tines: "Tuned percussion", percussion: "Percussion", voice: "Voice",
};
const KIND_ORDER = ["fretted", "plucked", "bowed", "keys", "wind", "tines", "percussion", "voice"];

/**
 * Options for an instrument <select>, grouped by family — a flat list of 59 is
 * unusable. `filter(inst, id)` narrows it (the tuner passes strings-only).
 */
export function instrumentOptions(filter = () => true) {
  return KIND_ORDER.flatMap((k) =>
    Object.entries(INSTRUMENTS)
      .filter(([id, i]) => i.kind === k && filter(i, id))
      .map(([id, i]) => ({ value: id, label: i.name, group: KIND_LABEL[k] })));
}

export const STRING_LABELS = {
  "acoustic-guitar": ["E", "A", "D", "G", "B", "e"],
  "electric-guitar": ["E", "A", "D", "G", "B", "e"],
  bass: ["E", "A", "D", "G"],
  ukulele: ["G", "C", "E", "A"],
  mandolin: ["G", "D", "A", "E"],
  violin: ["G", "D", "A", "E"],
  "classical-guitar": ["E", "A", "D", "G", "B", "e"],
  "guitar-12": ["E", "A", "D", "G", "B", "e"],
  "baritone-guitar": ["B", "E", "A", "D", "F#", "b"],
  "guitar-7": ["B", "E", "A", "D", "G", "B", "e"],
  "bass-5": ["B", "E", "A", "D", "G"],
  "fretless-bass": ["E", "A", "D", "G"],
  banjo: ["g", "D", "G", "B", "d"],   // the short 5th string first, as it sits under the thumb
  "tenor-banjo": ["C", "G", "D", "A"],
  "baritone-ukulele": ["D", "G", "B", "E"],
  mandola: ["C", "G", "D", "A"],
  bouzouki: ["G", "D", "A", "d"],
  cavaquinho: ["D", "G", "B", "d"],
  dulcimer: ["D", "A", "d"],
  oud: ["C", "F", "A", "D", "G", "c"],
  viola: ["C", "G", "D", "A"],
  cello: ["C", "G", "D", "A"],
  "double-bass": ["E", "A", "D", "G"],
  erhu: ["D", "A"],
};

/** Best (string, fret) for a midi on a fretted instrument, preferring low frets. */
export function midiToFret(midi, instrumentId = "acoustic-guitar", tuning) {
  const strings = tuning || (INSTRUMENTS[instrumentId] || {}).strings || [];
  const frets = (INSTRUMENTS[instrumentId] || {}).frets || 20;
  let best = null;
  for (let s = strings.length - 1; s >= 0; s--) {
    const fret = midi - strings[s];
    if (fret >= 0 && fret <= frets) {
      if (!best || fret < best.fret) best = { string: s, fret };
    }
  }
  return best;
}

export function fretToMidi(string, fret, instrumentId = "acoustic-guitar", tuning) {
  const strings = tuning || (INSTRUMENTS[instrumentId] || {}).strings || [];
  return strings[string] + fret;
}
