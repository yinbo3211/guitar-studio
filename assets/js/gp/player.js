// Backing-track + vocal-track playback with independent gains, routed to the
// selected output device when the browser supports setSinkId.
import { Audio } from "./engine.js";
import { Store } from "./state.js";

export class TrackPlayer {
  constructor() {
    this.backing = null;
    this.vocal = null;
    this._gainB = null;
    this._gainV = null;
  }

  _make(dataUrl, volume) {
    if (!dataUrl) return null;
    const audioEl = new window.Audio();
    audioEl.src = dataUrl;
    audioEl.crossOrigin = "anonymous";
    Audio.applySink(audioEl);
    const ctx = Audio.ctx();
    const src = ctx.createMediaElementSource(audioEl);
    const gain = ctx.createGain();
    gain.gain.value = volume;
    src.connect(gain); gain.connect(ctx.destination);
    return { audioEl, gain };
  }

  load(song) {
    this.stop();
    const s = Store.settings();
    const a = song.audio || {};
    if (a.backing) { const r = this._make(a.backing, s.backingVolume); this.backing = r.audioEl; this._gainB = r.gain; }
    if (a.vocal)   { const r = this._make(a.vocal, s.vocalVolume);   this.vocal = r.audioEl;   this._gainV = r.gain; }
  }

  setBackingVolume(v) { if (this._gainB) this._gainB.gain.value = v; }
  setVocalVolume(v) { if (this._gainV) this._gainV.gain.value = v; }

  async play(fromSec = 0) {
    await Audio.resume();
    for (const el of [this.backing, this.vocal]) {
      if (el) { try { el.currentTime = fromSec; await el.play(); } catch (e) { console.warn("play blocked", e); } }
    }
  }
  pause() { for (const el of [this.backing, this.vocal]) el && el.pause(); }
  seek(sec) { for (const el of [this.backing, this.vocal]) el && (el.currentTime = sec); }
  stop() {
    for (const el of [this.backing, this.vocal]) { if (el) { el.pause(); el.src = ""; } }
    this.backing = this.vocal = this._gainB = this._gainV = null;
  }
  hasAudio() { return !!(this.backing || this.vocal); }
}
