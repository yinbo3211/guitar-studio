// One-shot synth: note previews, tuning reference tones, and the metronome.
// Timbres live in voices.js — pass `instrument` (or `voice`) to hear a note the
// way that instrument would actually sound.
import { Audio } from "./engine.js";
import { playVoice, voiceFor } from "./voices.js";

export const Synth = {
  /** Play a midi note in an instrument's voice. Returns kill(when). */
  playMidi(midi, { dur = 0.7, gain = 0.25, a4 = 440, instrument = null, voice = null } = {}) {
    const ctx = Audio.ctx(); Audio.resume();
    return playVoice(ctx, ctx.destination, voice || voiceFor(instrument), midi, { dur, gain, a4 });
  },

  /** Sustained reference tone for tuning a single string. Returns a stop() fn. */
  reference(freq, { gain = 0.18 } = {}) {
    const ctx = Audio.ctx(); Audio.resume();
    const osc = ctx.createOscillator(); const g = ctx.createGain();
    osc.type = "sine"; osc.frequency.value = freq;
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(gain, ctx.currentTime + 0.05);
    osc.connect(g); g.connect(ctx.destination); osc.start();
    return () => {
      g.gain.cancelScheduledValues(ctx.currentTime);
      g.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.08);
      osc.stop(ctx.currentTime + 0.1);
    };
  },

  click({ accent = false } = {}) {
    const ctx = Audio.ctx();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator(); const g = ctx.createGain();
    osc.frequency.value = accent ? 1500 : 900;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(accent ? 0.35 : 0.2, t + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    osc.connect(g); g.connect(ctx.destination); osc.start(t); osc.stop(t + 0.06);
  },
};
