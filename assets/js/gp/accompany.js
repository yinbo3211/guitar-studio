// Auto-accompaniment: give any song a band even when it ships no audio and no
// authored parts. Infers one chord per bar from the melody, then writes a bass
// line, a chord comp and (where it suits the song) a drum groove.
//
// ponytail: assumes 4/4 and one chord per bar, and voices every chord in root
// position. That covers the whole built-in library; add a time-signature field
// and voice leading when a song actually needs them.
import { CHORD_TYPES, chordMidis, identifyChord } from "./theory.js";
import { INSTRUMENTS } from "./notes.js";
import { KICK, SNARE, HAT } from "./voices.js";

const PC = { c: 0, "c#": 1, db: 1, d: 2, "d#": 3, eb: 3, e: 4, f: 5, "f#": 6, gb: 6,
             g: 7, "g#": 8, ab: 8, a: 9, "a#": 10, bb: 10, b: 11 };

/** "F#m" -> { pc: 6, minor: true }. Unparseable keys fall back to C major. */
export function parseKey(key) {
  const m = String(key || "C").trim().replace(/♯/g, "#").replace(/♭/g, "b").match(/^([a-gA-G][#b]?)\s*(m|min)?/);
  if (!m) return { pc: 0, minor: false };
  return { pc: PC[m[1].toLowerCase()] ?? 0, minor: !!m[2] };
}

// Diatonic triads, most-likely-first. Minor uses a major V (harmonic minor) —
// it makes cadences land, which is the whole point of a backing track.
const MAJOR = [[0, "maj"], [7, "maj"], [5, "maj"], [9, "min"], [2, "min"], [4, "min"], [11, "dim"]];
const MINOR = [[0, "min"], [7, "maj"], [5, "min"], [8, "maj"], [3, "maj"], [10, "maj"], [2, "dim"]];

/** One chord per bar: [{ bar, at, pc, type }]. */
export function chordPlan(song) {
  const bpm = song.bpm || 90;
  const spb = 60 / bpm, barLen = 4 * spb;
  const notes = (song.notes || []).filter((n) => n.midi?.length);
  if (!notes.length) return [];
  const end = notes.reduce((m, n) => Math.max(m, n.time + (n.dur || spb)), 0);
  const { pc: keyPc, minor } = parseKey(song.key);
  const pool = (minor ? MINOR : MAJOR).map(([off, type], rank) => ({ pc: (keyPc + off) % 12, type, rank }));

  const plan = [];
  let prev = pool[0];
  for (let bar = 0; bar * barLen < end - 1e-6; bar++) {
    const t0 = bar * barLen, t1 = t0 + barLen;
    const inBar = notes.filter((n) => n.time >= t0 - 1e-6 && n.time < t1 - 1e-6);
    let choice = null;

    // A song built from chords already states its harmony — believe it.
    const stated = inBar.find((n) => n.midi.length > 2 && identifyChord(n.midi));
    if (stated) {
      const c = identifyChord(stated.midi);
      choice = { pc: c.rootPc, type: CHORD_TYPES[c.type] ? c.type : "maj", rank: 0 };
    } else if (inBar.length) {
      const w = new Array(12).fill(0);
      for (const n of inBar) for (const m of n.midi) w[((m % 12) + 12) % 12] += (n.dur || spb);
      let best = null;
      for (const cand of pool) {
        const tones = chordMidis(cand.pc, cand.type).map((m) => m % 12);
        const covered = tones.reduce((s, pcv) => s + w[pcv], 0) + w[cand.pc] * 0.4;
        if (!best || covered > best.covered + 1e-9 || (covered > best.covered - 1e-9 && cand.rank < best.cand.rank)) {
          best = { covered, cand };
        }
      }
      choice = best.cand;
    }
    if (!choice) choice = prev;          // a bar of rests holds the last chord
    prev = choice;
    plan.push({ bar, at: t0, pc: choice.pc, type: choice.type });
  }
  return plan;
}

// What an existing part already covers, so auto-accompaniment doesn't double it.
function roleOf(part) {
  const kind = INSTRUMENTS[part.instrument]?.kind;
  if (kind === "percussion") return "drums";
  if (/bass/.test(part.instrument || "")) return "bass";
  const notes = part.notes || [];
  const chords = notes.filter((n) => n.midi?.length > 2).length;
  if (notes.length && chords / notes.length > 0.6) return "comp";
  return null;
}

const QUIET = new Set(["Classical", "Hymn/Gospel"]);
const DRUMMY = new Set(["Rock", "Blues", "Pop", "Country", "Funk/Soul", "Jazz", "Electronic", "World"]);

/**
 * Parts to add under a song. `existing` is every part already sounding (the one
 * you play plus any authored parts) — roles they cover are skipped.
 */
export function autoAccompaniment(song, existing = []) {
  // A drum chart's "pitches" are kit lanes, so there is no harmony to read out
  // of it. ponytail: give percussion songs a band when one is authored by hand.
  if (INSTRUMENTS[song.instrument]?.kind === "percussion") return [];
  const plan = chordPlan(song);
  if (!plan.length) return [];
  const spb = 60 / (song.bpm || 90);
  const have = new Set(existing.map(roleOf).filter(Boolean));
  const leadKind = INSTRUMENTS[song.instrument]?.kind;
  const bass = [], comp = [], drums = [];
  const wantDrums = !have.has("drums") && !QUIET.has(song.genre) &&
    (DRUMMY.has(song.genre) || (song.bpm || 90) >= 84);

  for (const { at, pc, type } of plan) {
    if (!have.has("bass")) {
      const root = 36 + pc;                       // C2–B2
      const fifth = root + 7 > 47 ? root - 5 : root + 7;
      bass.push({ time: at, dur: spb * 1.8, midi: [root] });
      bass.push({ time: at + spb * 2, dur: spb * 1.8, midi: [fifth], gain: 0.85 });
    }
    if (!have.has("comp")) {
      const voicing = chordMidis(48 + pc, type);  // C3–B3, root position
      for (let b = 0; b < 4; b++) {
        comp.push({ time: at + b * spb, dur: spb * 0.9, midi: voicing, gain: b === 0 ? 0.9 : 0.55 });
      }
    }
    if (wantDrums) {
      drums.push({ time: at, dur: 0.2, midi: [KICK] }, { time: at + spb * 2, dur: 0.2, midi: [KICK], gain: 0.85 });
      drums.push({ time: at + spb, dur: 0.2, midi: [SNARE] }, { time: at + spb * 3, dur: 0.2, midi: [SNARE] });
      for (let h = 0; h < 8; h++) drums.push({ time: at + h * spb * 0.5, dur: 0.05, midi: [HAT], gain: h % 2 ? 0.35 : 0.55 });
    }
  }

  // A piano comp under a guitar lead (and vice versa) keeps the two apart.
  const compInst = leadKind === "keys" ? "acoustic-guitar" : "piano";
  return [
    bass.length ? { instrument: "bass", name: "Bass", notes: bass, gain: 0.9 } : null,
    comp.length ? { instrument: compInst, name: INSTRUMENTS[compInst].name, notes: comp, gain: 0.55 } : null,
    drums.length ? { instrument: "drum-kit", name: "Drums", notes: drums, gain: 0.7 } : null,
  ].filter(Boolean);
}
