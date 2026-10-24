// scale.js — 音阶跟弹模块 V3.1
import { MusicSpelling } from '../core/music-spelling.js';

export class Scale {
  constructor() {
    this.seq = [];
    this.ok = 0;
    this.total = 0;
    this.current = 0;
    this.bpm = 80;
    this.name = 'major';
    this.followStartedAt = 0;
    this.followReported = false;
  }

  startFollow(name = 'major', bpm = 80) {
    this.name = name;
    this.bpm = bpm;
    this.seq = this._genSequence(name, 16);
    this.ok = 0;
    this.total = this.seq.length;
    this.current = 0;
    this.followStartedAt = Date.now();
    this.followReported = false;
    return this.seq;
  }

  _genSequence(name, count) {
    const ms = MusicSpelling;
    const scale = ms.scale('C', name);
    const result = [];
    for (let i = 0; i < count; i++) {
      result.push(scale[i % scale.length]);
    }
    return result;
  }

  reportNote(note) {
    if (this.current >= this.total) return false;
    const expected = this.seq[this.current];
    const correct = note === expected;
    if (correct) this.ok++;
    this.current++;
    return correct;
  }

  finishFollow() {
    if (!this.followReported && typeof PracticeStore !== 'undefined') {
      this.followReported = true;
      let bestCombo = 0, combo = 0;
      for (let i = 0; i < this.seq.length; i++) {
        // 简化统计：使用 ok / total 作为 accuracy
        if (i < this.ok) combo++;
        else combo = 0;
        if (combo > bestCombo) bestCombo = combo;
      }
      PracticeStore.addSession({
        module: 'scale',
        startedAt: this.followStartedAt,
        durationMs: Date.now() - this.followStartedAt,
        accuracy: this.seq.length ? this.ok / this.seq.length : null,
        meta: { name: this.name, bpm: this.bpm, notes: this.seq.length, hit: this.ok, bestCombo }
      });
    }
  }
}
