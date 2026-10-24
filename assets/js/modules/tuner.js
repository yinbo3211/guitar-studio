// tuner.js — 调音器模块 V3.1
import { AudioAnalyser } from '../core/audio-devices.js';
import { MusicSpelling } from '../core/music-spelling.js';

const NOTES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const BASE_FREQ = 440; // A4
const STRING_NAMES = ['E2','A2','D3','G3','B3','E4'];
const STRING_FREQS = [82.41, 110.00, 146.83, 196.00, 246.94, 329.63];

export class Tuner {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.analyser = null;
    this.active = false;
    this.a4 = 440;
    this.detune = 0;
    this.note = '';
    this.freq = 0;
    this.cent = 0;
    this.tunedSet = new Set();
    this.sessionStartedAt = 0;
    this.onTuned = null;
  }

  async start(a4 = 440) {
    this.a4 = a4;
    if (!this.analyser) {
      this.analyser = new AudioAnalyser();
      try {
        await this.analyser.start();
      } catch (e) {
        this.analyser = null;
        throw e;
      }
    }
    this.active = true;
    this.sessionStartedAt = Date.now();
    this._loop();
  }

  stop() {
    this.active = false;
    if (this.analyser) {
      this.analyser.stop();
      this.analyser = null;
    }
  }

  _loop() {
    if (!this.active) return;
    const d = this.analyser.getPitchData();
    if (d && d.frequency > 50 && d.frequency < 1200) {
      this.freq = d.frequency;
      const info = this._freqToNote(d.frequency);
      this.note = info.note;
      this.detune = info.detune;
      this.cent = Math.round(info.cents);
      this._draw(info);
      if (Math.abs(info.cents) < 4) {
        this.tunedSet.add(info.stringIdx);
        if (this.onTuned) this.onTuned(info);
      }
    } else {
      this._draw(null);
    }
    requestAnimationFrame(() => this._loop());
  }

  _freqToNote(f) {
    const midi = 69 + 12 * Math.log2(f / this.a4);
    const rounded = Math.round(midi);
    const cents = (midi - rounded) * 100;
    const noteName = NOTES[((rounded % 12) + 12) % 12];
    let stringIdx = -1;
    let minDiff = Infinity;
    for (let i = 0; i < STRING_FREQS.length; i++) {
      const diff = Math.abs(f - STRING_FREQS[i]);
      if (diff < minDiff) { minDiff = diff; stringIdx = i; }
    }
    return { note: noteName, cents, detune: cents / 100, stringIdx };
  }

  _draw(info) {
    const { ctx, canvas } = this;
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0f1120';
    ctx.fillRect(0, 0, w, h);
    // center line
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w / 2, h);
    ctx.stroke();
    if (!info) return;
    const x = w / 2 + (info.cents / 50) * (w / 4);
    const inTune = Math.abs(info.cents) < 4;
    ctx.fillStyle = inTune ? '#2ee6a8' : '#ffb454';
    ctx.beginPath();
    ctx.arc(x, h / 2, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#eef0fa';
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(info.note, w / 2, h - 30);
    ctx.font = '14px sans-serif';
    ctx.fillStyle = '#9aa0bd';
    ctx.fillText(`${Math.round(info.cents)} cents · ${Math.round(this.freq)} Hz`, w / 2, h - 10);
  }

  checkAllTuned() {
    return this.tunedSet.size === 6;
  }

  reportTuningSession() {
    if (!this.checkAllTuned()) return false;
    const now = Date.now();
    if (typeof PracticeStore !== 'undefined') {
      PracticeStore.addSession({
        module: 'tuner',
        startedAt: this.sessionStartedAt || now,
        durationMs: now - (this.sessionStartedAt || now),
        accuracy: null,
        meta: { strings: 6, a4: this.a4 }
      });
    }
    this.tunedSet.clear();
    this.sessionStartedAt = Date.now();
    return true;
  }
}
