// music-spelling.js — 音名/音程/和弦理论库 V3.1
const NOTES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const FLAT_NOTES = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
const INTERVAL_NAMES = { 0:'P1',1:'m2',2:'M2',3:'m3',4:'M3',5:'P4',6:'TT',7:'P5',8:'m6',9:'M6',10:'m7',11:'M7',12:'P8' };
const QUALITY_OFFSETS = {
  maj: [0,4,7], min: [0,3,7], dim: [0,3,6], aug: [0,4,8],
  sus2: [0,2,7], sus4: [0,5,7], maj7: [0,4,7,11], min7: [0,3,7,10],
  dom7: [0,4,7,10], dim7: [0,3,6,9], m7b5: [0,3,6,10]
};
const SCALE_PATTERNS = {
  major: [0,2,4,5,7,9,11],
  minor: [0,2,3,5,7,8,10],
  dorian: [0,2,3,5,7,9,10],
  mixolydian: [0,2,4,5,7,9,10],
  pentatonic: [0,2,4,7,9],
  blues: [0,3,5,6,7,10]
};

function parseNote(str) {
  if (typeof str !== 'string') return null;
  const m = str.trim().match(/^([A-Ga-g])([#b]?)(\-?\d*)$/);
  if (!m) return null;
  const letter = m[1].toUpperCase();
  const acc = m[2];
  const octave = m[3] ? parseInt(m[3]) : 4;
  const idx = NOTES.indexOf(letter + acc);
  if (idx < 0) {
    if (acc === 'b') {
      const flatIdx = FLAT_NOTES.indexOf(letter + 'b');
      if (flatIdx >= 0) return { midi: flatIdx + (octave + 1) * 12, octave, letter };
    }
    return null;
  }
  return { midi: idx + (octave + 1) * 12, octave, letter };
}

function scale(root, type) {
  const r = parseNote(root);
  if (!r) return [];
  const pattern = SCALE_PATTERNS[type] || SCALE_PATTERNS.major;
  return pattern.map(step => NOTES[(r.midi + step) % 12]);
}

function keySignature(key) {
  const r = parseNote(key);
  if (!r) return { sharps: 0, flats: 0 };
  const idx = (r.midi % 12 + 12) % 12;
  const sharpKeys = [0,7,2,9,4,11,6]; // C G D A E B F#
  const flatKeys = [0,5,10,3,8,1,6];  // C F Bb Eb Ab Db Gb
  const s = sharpKeys.indexOf(idx);
  if (s >= 0) return { sharps: s, flats: 0 };
  const f = flatKeys.indexOf(idx);
  if (f >= 0) return { sharps: 0, flats: f };
  return { sharps: 0, flats: 0 };
}

function chordTones(root, quality) {
  const r = parseNote(root);
  if (!r) return [];
  const offsets = QUALITY_OFFSETS[quality] || QUALITY_OFFSETS.maj;
  return offsets.map(o => NOTES[(r.midi + o) % 12]);
}

function qualityOf(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;
  if (/^maj(?!7)/i.test(s) || s === 'M' || s === '△') return 'maj';
  if (/^min(?!7)/i.test(s) || s === 'm') return 'min';
  if (/^dim/i.test(s)) return 'dim';
  // BUG-10：aug / + / +7
  if (/^aug$|^\+/.test(s)) return 'aug';
  if (/^sus2/i.test(s)) return 'sus2';
  if (/^sus4/i.test(s)) return 'sus4';
  if (/^maj7/i.test(s)) return 'maj7';
  if (/^min7/i.test(s)) return 'min7';
  if (/^[A-G].*7$/.test(s) && !/^m/.test(s)) return 'dom7';
  return null;
}

function transpose(root, semitones) {
  const r = parseNote(root);
  if (!r) return null;
  const newMidi = r.midi + semitones;
  return NOTES[((newMidi % 12) + 12) % 12];
}

function numeral(degree, key) {
  const k = parseNote(key);
  if (!k) return null;
  const s = scale(key, 'major');
  const idx = (degree - 1) % 7;
  if (idx < 0 || idx >= s.length) return null;
  const numerals = ['I','ii','iii','IV','V','vi','vii°'];
  return numerals[idx];
}

function fretNote(stringIdx, fret) {
  const openFreqs = [82.41, 110.00, 146.83, 196.00, 246.94, 329.63];
  if (stringIdx < 0 || stringIdx >= openFreqs.length) return null;
  const midi = 40 + [4,9,2,7,11,4][stringIdx] + fret;
  return NOTES[midi % 12];
}

function findFrets(noteName) {
  const n = parseNote(noteName);
  if (!n) return [];
  const results = [];
  const openMidis = [40,45,50,55,59,64];
  for (let s = 0; s < 6; s++) {
    for (let f = 0; f <= 15; f++) {
      if ((openMidis[s] + f) % 12 === n.midi % 12) {
        results.push({ string: s + 1, fret: f });
      }
    }
  }
  return results;
}

function groupBeats(beatsPerBar, totalBeats) {
  const bars = [];
  for (let i = 0; i < totalBeats; i += beatsPerBar) {
    bars.push(Math.min(beatsPerBar, totalBeats - i));
  }
  return bars;
}

const MusicSpelling = { parseNote, scale, keySignature, chordTones, qualityOf, transpose, numeral, fretNote, findFrets, groupBeats };
export default MusicSpelling;
if (typeof window !== 'undefined') window.MusicSpelling = MusicSpelling;
