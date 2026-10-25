// Instrument voices for every synthesized note the app plays: previews, the
// note echo on the highway, and each part of the backing band.
//
// Recipe per voice: additive partials -> a lowpass swept by the envelope ->
// ADSR, with optional vibrato, detune beating and breath noise. Enough shaping
// that a plucked string, a reed and a struck tine are actually distinguishable.
//
// Pure: no AudioContext is created here — the caller passes one in, which also
// keeps this file testable under Node.
// ponytail: subtractive synthesis only. Sampled instruments would sound better
// but cost megabytes of assets; swap in a sampler if realism ever beats size.
import { midiToFreq } from "./notes.js";
import { INSTRUMENTS } from "./notes.js";

// Envelope: atk/dec/rel in seconds, sus as a fraction of peak (0 = fully decaying).
// cut: [open, close] lowpass cutoff as a multiple of the fundamental, swept over dec.
// vib: [cents, hz, delaySec]. detune: cents between a doubled fundamental (beating).
// noise: { g, f, q, hold } — breath/attack noise; hold keeps it for the whole note.
export const VOICES = {
  pluck:  { type: "sawtooth", partials: [[1, 1], [2, 0.45], [3, 0.18], [4.02, 0.07]],
            atk: 0.004, dec: 0.55, sus: 0.05, rel: 0.35, cut: [10, 1.6], q: 3, gain: 0.9,
            noise: { g: 0.09, f: 3000, q: 0.9 } },
  nylon:  { type: "triangle", partials: [[1, 1], [2, 0.3], [3, 0.1]],
            atk: 0.006, dec: 0.7, sus: 0.05, rel: 0.4, cut: [7, 1.3], q: 2, gain: 0.95 },
  banjo:  { type: "sawtooth", partials: [[1, 1], [2, 0.6], [3, 0.35], [5.01, 0.12]],
            atk: 0.002, dec: 0.3, sus: 0.02, rel: 0.2, cut: [16, 3], q: 4, gain: 0.8,
            noise: { g: 0.16, f: 4500, q: 0.8 } },
  bass:   { type: "sawtooth", partials: [[1, 1], [2, 0.22], [3, 0.06]],
            atk: 0.006, dec: 0.5, sus: 0.18, rel: 0.3, cut: [5, 1.1], q: 2, gain: 1.15 },
  bow:    { type: "sawtooth", partials: [[1, 1], [2, 0.5], [3, 0.25], [4, 0.12]],
            atk: 0.11, dec: 0.25, sus: 0.85, rel: 0.28, cut: [5, 3.5], q: 1.5, gain: 0.75,
            vib: [14, 5.2, 0.25] },
  piano:  { type: "triangle", partials: [[1, 1], [2, 0.42], [3, 0.14], [4.01, 0.06]],
            atk: 0.003, dec: 0.9, sus: 0.12, rel: 0.45, cut: [9, 1.8], q: 1.5, gain: 0.95 },
  epiano: { type: "sine", partials: [[1, 1], [2, 0.5], [4.01, 0.22], [7, 0.05]],
            atk: 0.004, dec: 1.1, sus: 0.1, rel: 0.5, cut: [8, 2.2], q: 1, gain: 1 },
  organ:  { type: "sine", partials: [[1, 1], [2, 0.6], [3, 0.35], [4, 0.25], [6, 0.12]],
            atk: 0.02, dec: 0.1, sus: 1, rel: 0.08, cut: [12, 10], q: 0.7, gain: 0.7 },
  reed:   { type: "square", partials: [[1, 1], [2, 0.25], [3, 0.3], [5, 0.1]],
            atk: 0.035, dec: 0.18, sus: 0.8, rel: 0.14, cut: [7, 5], q: 1.2, gain: 0.55,
            detune: 9, vib: [9, 5.6, 0.35], noise: { g: 0.05, f: 2600, q: 0.7, hold: true } },
  flute:  { type: "sine", partials: [[1, 1], [2, 0.18], [3, 0.05]],
            atk: 0.07, dec: 0.15, sus: 0.9, rel: 0.16, cut: [6, 5], q: 0.8, gain: 0.85,
            vib: [10, 5, 0.3], noise: { g: 0.13, f: 3200, q: 0.6, hold: true } },
  brass:  { type: "sawtooth", partials: [[1, 1], [2, 0.55], [3, 0.3], [4, 0.15]],
            atk: 0.055, dec: 0.2, sus: 0.85, rel: 0.18, cut: [2.5, 6], q: 2, gain: 0.7,
            vib: [7, 5.4, 0.4] },
  tine:   { type: "sine", partials: [[1, 1], [3.01, 0.32], [6.03, 0.1]],
            atk: 0.002, dec: 1.5, sus: 0, rel: 1.2, cut: [14, 6], q: 1, gain: 0.9 },
  voice:  { type: "sawtooth", partials: [[1, 1], [2, 0.35], [3, 0.12]],
            atk: 0.08, dec: 0.2, sus: 0.85, rel: 0.2, cut: [3.2, 2.6], q: 3, gain: 0.6,
            vib: [16, 5.5, 0.3] },
  lead:   { type: "sawtooth", partials: [[1, 1], [1.005, 0.8], [2, 0.3]],
            atk: 0.01, dec: 0.3, sus: 0.7, rel: 0.2, cut: [8, 3], q: 6, gain: 0.6 },
  drum:   { drum: true },
};

const BY_KIND = {
  fretted: "pluck", plucked: "pluck", bowed: "bow", keys: "piano",
  wind: "flute", tines: "tine", percussion: "drum", voice: "voice",
};

// Where a whole kind is too coarse to be convincing (a harmonica is not a flute,
// a banjo is not a nylon guitar), name the voice per instrument.
const BY_INSTRUMENT = {
  "classical-guitar": "nylon", "ukulele": "nylon", "baritone-ukulele": "nylon", "oud": "nylon",
  "banjo": "banjo", "tenor-banjo": "banjo", "mandolin": "banjo", "mandola": "banjo", "cavaquinho": "banjo",
  "bass": "bass", "bass-5": "bass", "fretless-bass": "bass", "double-bass": "bass", "tuba": "bass",
  "harmonica": "reed", "harmonica-chromatic": "reed", "accordion": "reed", "melodica": "reed",
  "clarinet": "reed", "alto-sax": "reed", "tenor-sax": "reed",
  "trumpet": "brass", "trombone": "brass", "french-horn": "brass",
  "organ": "organ", "electric-piano": "epiano", "synth": "lead", "electric-guitar": "lead",
};

/** Voice id for an instrument, falling back through its kind to a piano. */
export function voiceFor(instrumentId) {
  if (BY_INSTRUMENT[instrumentId]) return BY_INSTRUMENT[instrumentId];
  return BY_KIND[INSTRUMENTS[instrumentId]?.kind] || "piano";
}

const _noise = new WeakMap();
function noiseBuf(ctx) {
  let b = _noise.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    _noise.set(ctx, b);
  }
  return b;
}

const clampHz = (ctx, hz) => Math.max(30, Math.min(hz, ctx.sampleRate / 2 - 1000));

/**
 * Schedule one note. `at` is an absolute AudioContext time (0 = now).
 * Returns kill(when) — silences and frees the note early (pause, seek, stop).
 */
export function playVoice(ctx, dest, voiceId, midi, { at = 0, dur = 0.5, gain = 0.25, a4 = 440 } = {}) {
  const v = VOICES[voiceId] || VOICES.piano;
  const t0 = at || ctx.currentTime;
  if (v.drum) return playDrum(ctx, dest, midi, t0, gain);

  const f = midiToFreq(midi, a4);
  const peak = Math.max(0.0002, gain * (v.gain ?? 1));
  const out = ctx.createGain();
  out.connect(dest);

  // amp envelope: attack -> decay to sustain -> hold -> release
  const relStart = Math.max(t0 + v.atk + v.dec, t0 + dur);
  const stopAt = relStart + v.rel + 0.02;
  const g = out.gain;
  g.setValueAtTime(0.0002, t0);
  g.linearRampToValueAtTime(peak, t0 + v.atk);
  g.exponentialRampToValueAtTime(Math.max(0.0002, v.sus > 0 ? peak * v.sus : peak * 0.02), t0 + v.atk + v.dec);
  g.exponentialRampToValueAtTime(0.0002, stopAt);

  // one lowpass for the whole note, swept from bright to dark over the decay
  let head = out;
  if (v.cut) {
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.Q.value = v.q ?? 1;
    lp.frequency.setValueAtTime(clampHz(ctx, f * v.cut[0]), t0);
    lp.frequency.exponentialRampToValueAtTime(clampHz(ctx, f * v.cut[1]), t0 + Math.max(0.06, v.dec));
    lp.connect(out);
    head = lp;
  }

  const srcs = [];
  let vibGain = null;
  if (v.vib) {
    const [cents, hz, delay] = v.vib;
    const lfo = ctx.createOscillator(); lfo.frequency.value = hz;
    vibGain = ctx.createGain();
    vibGain.gain.setValueAtTime(0, t0);
    vibGain.gain.linearRampToValueAtTime(cents, t0 + delay);
    lfo.connect(vibGain); lfo.start(t0); srcs.push(lfo);
  }

  const addOsc = (ratio, amp, detune) => {
    const o = ctx.createOscillator();
    o.type = ratio === 1 ? v.type : "sine";
    o.frequency.value = clampHz(ctx, f * ratio);
    if (detune) o.detune.value = detune;
    if (vibGain) vibGain.connect(o.detune);
    const og = ctx.createGain(); og.gain.value = amp;
    o.connect(og); og.connect(head);
    o.start(t0); srcs.push(o);
  };
  for (const [ratio, amp] of v.partials) addOsc(ratio, amp);
  if (v.detune) { addOsc(1, 0.7, v.detune); addOsc(1, 0.7, -v.detune); }

  if (v.noise) {
    const n = ctx.createBufferSource();
    n.buffer = noiseBuf(ctx); n.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = clampHz(ctx, v.noise.f); bp.Q.value = v.noise.q;
    const ng = ctx.createGain();
    const nEnd = v.noise.hold ? relStart : t0 + 0.05;
    ng.gain.setValueAtTime(v.noise.g * peak * 4, t0);
    ng.gain.exponentialRampToValueAtTime(0.0002, nEnd + 0.02);
    n.connect(bp); bp.connect(ng); ng.connect(out);
    n.start(t0); srcs.push(n);
  }

  const stopAll = (when) => { for (const s of srcs) { try { s.stop(when); } catch { /* already stopped */ } } };
  stopAll(stopAt);
  return (when) => {
    const t = when ?? ctx.currentTime;
    try { g.cancelScheduledValues(t); g.setTargetAtTime(0.0001, t, 0.01); } catch { /* node gone */ }
    stopAll(t + 0.06);
  };
}

// General-MIDI-ish drum map: the midi number picks the drum, not a pitch.
const DRUMS = {
  35: { f: 100, to: 42, dur: 0.28, g: 1.2 },   // kick
  36: { f: 120, to: 45, dur: 0.22, g: 1.2 },
  38: { f: 190, to: 170, dur: 0.16, g: 0.9, noise: [1900, 1.1, 0.9] },   // snare
  40: { f: 210, to: 190, dur: 0.14, g: 0.85, noise: [2300, 1.1, 0.9] },
  42: { dur: 0.045, g: 0.5, noise: [8000, 0.6, 1], hp: true },           // closed hat
  46: { dur: 0.3, g: 0.45, noise: [7000, 0.5, 1], hp: true },            // open hat
  49: { dur: 1.1, g: 0.5, noise: [5000, 0.4, 1], hp: true },             // crash
  51: { dur: 0.35, g: 0.4, noise: [9000, 0.5, 1], hp: true },            // ride
};

function playDrum(ctx, dest, midi, t0, gain) {
  const d = DRUMS[midi] || DRUMS[38];
  const peak = Math.max(0.0002, gain * (d.g ?? 1));
  const out = ctx.createGain();
  out.gain.setValueAtTime(peak, t0);
  out.gain.exponentialRampToValueAtTime(0.0002, t0 + d.dur);
  out.connect(dest);
  const srcs = [];
  if (d.f) {   // pitched body: a fast downward sweep is what makes a kick a kick
    const o = ctx.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(d.f, t0);
    o.frequency.exponentialRampToValueAtTime(d.to, t0 + d.dur);
    o.connect(out); o.start(t0); srcs.push(o);
  }
  if (d.noise) {
    const [hz, q, amp] = d.noise;
    const n = ctx.createBufferSource(); n.buffer = noiseBuf(ctx); n.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = d.hp ? "highpass" : "bandpass";
    filt.frequency.value = clampHz(ctx, hz); filt.Q.value = q;
    const ng = ctx.createGain(); ng.gain.value = amp;
    n.connect(filt); filt.connect(ng); ng.connect(out);
    n.start(t0); srcs.push(n);
  }
  const stopAll = (when) => { for (const s of srcs) { try { s.stop(when); } catch { /* already stopped */ } } };
  stopAll(t0 + d.dur + 0.05);
  return (when) => {
    const t = when ?? ctx.currentTime;
    try { out.gain.cancelScheduledValues(t); out.gain.setTargetAtTime(0.0001, t, 0.01); } catch { /* node gone */ }
    stopAll(t + 0.06);
  };
}

export const KICK = 36;
export const SNARE = 38;
export const HAT = 42;
export const OPEN_HAT = 46;
export const CRASH = 49;
