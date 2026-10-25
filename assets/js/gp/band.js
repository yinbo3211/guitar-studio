// The synth backing band: plays every part of a song you are not playing
// yourself. Sample-accurate — notes are scheduled ahead into the AudioContext
// clock rather than fired from requestAnimationFrame.
import { Audio } from "./engine.js";
import { playVoice, voiceFor } from "./voices.js";

const LOOKAHEAD = 0.4;   // seconds of notes to queue ahead of the transport clock

export class Band {
  /** parts: [{ instrument, name?, notes:[{time,dur,midi[],gain?}], gain? }]
   *  `ctx` overrides the shared AudioContext — only the test harness passes it. */
  constructor(parts, { a4 = 440, volume = 0.7, ctx = null } = {}) {
    this.parts = (parts || []).filter((p) => p && p.notes?.length).map((p) => ({
      instrument: p.instrument,
      name: p.name || p.instrument,
      voice: p.voice || voiceFor(p.instrument),
      gain: p.gain ?? 1,
      notes: [...p.notes].sort((a, b) => a.time - b.time),
      i: 0,
    }));
    this.a4 = a4;
    this.volume = volume;
    this._ctxOverride = ctx;
    this._live = [];
    this._g = null;
  }

  get empty() { return this.parts.length === 0; }
  get names() { return this.parts.map((p) => p.name); }

  _ctx() { return this._ctxOverride || Audio.ctx(); }

  _dest() {
    if (!this._g) {
      const ctx = this._ctx();
      this._g = ctx.createGain();
      this._g.gain.value = this.volume;
      this._g.connect(ctx.destination);
    }
    return this._g;
  }

  setVolume(v) { this.volume = v; if (this._g) this._g.gain.value = v; }

  /** Move the playhead; anything already queued is dropped. */
  seek(sec) {
    for (const p of this.parts) {
      let i = 0;
      while (i < p.notes.length && p.notes[i].time < sec) i++;
      p.i = i;
    }
    this.silence();
  }

  /** Call once per frame with the transport clock (seconds, may be negative). */
  schedule(clock) {
    if (this.empty) return;
    const ctx = this._ctx();
    const dest = this._dest();
    const base = ctx.currentTime - clock;   // context time of transport zero
    const horizon = clock + LOOKAHEAD;
    for (const p of this.parts) {
      while (p.i < p.notes.length && p.notes[p.i].time < horizon) {
        const n = p.notes[p.i++];
        const at = base + n.time;
        if (at < ctx.currentTime) continue;   // late (clock jumped) — skip, don't pile up
        const dur = n.dur || 0.4;
        for (const m of n.midi) {
          this._live.push({ kill: playVoice(ctx, dest, p.voice, m, { at, dur, gain: (n.gain ?? 1) * p.gain * 0.34, a4: this.a4 }), end: at + dur + 1.5 });
        }
      }
    }
    const now = ctx.currentTime;
    if (this._live.length > 64) this._live = this._live.filter((l) => l.end > now);
  }

  /** Cut everything currently sounding (pause / seek / toggle off). */
  silence() {
    if (!this._live.length) return;
    const t = this._ctx().currentTime;
    for (const l of this._live) l.kill(t);
    this._live = [];
  }

  stop() {
    this.silence();
    if (this._g) { try { this._g.disconnect(); } catch { /* already gone */ } this._g = null; }
  }
}
