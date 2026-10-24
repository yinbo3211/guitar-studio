// ear-training.js — 练耳模块 V3.1
export const EAR_LEVELS = ['note','interval','chord','melody'];
export const EAR_LEVEL_DEF = {
  note:     { label: '单音', pool: ['C','D','E','F','G','A','B'] },
  interval: { label: '音程', pool: ['P1','m3','M3','P4','P5','m7','M7','P8'] },
  chord:    { label: '和弦', pool: ['maj','min','dim','aug','maj7','min7','dom7'] },
  melody:   { label: '旋律', pool: [2,3,4,5] }
};

export const earPitchPool = ['C4','D4','E4','F4','G4','A4','B4'];
export const earMelody = (len) => {
  const arr = [];
  for (let i = 0; i < len; i++) arr.push(earPitchPool[Math.floor(Math.random()*earPitchPool.length)]);
  return arr;
};

export class Ear {
  constructor() {
    this.n = 0;
    this.ok = 0;
    this.reactionSum = 0;
    this.reactionN = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.startedAt = Date.now();
    this.roundN = 0;
    this.roundOk = 0;
    this.roundStart = Date.now();
    this.roundLevel = '';
    this.roundMode = '';
    this.roundAvg = 0;
  }

  report(level, mode, correct, reactionMs) {
    // BUG-03：每轮上报后复位单轮累计量，保留跨轮 streak
    this.roundN = this.n;
    this.roundOk = this.ok;
    this.roundStart = this.startedAt;
    this.roundLevel = level;
    this.roundMode = mode;
    this.roundAvg = this.reactionN ? this.reactionSum / this.reactionN : 0;
    if (typeof PracticeStore !== 'undefined') {
      PracticeStore.addSession({
        module: 'ear',
        startedAt: this.startedAt,
        durationMs: Date.now() - this.startedAt,
        accuracy: this.roundN ? this.roundOk / this.roundN : null,
        meta: { level, mode, questions: this.roundN, avgReactionMs: Math.round(this.roundAvg) }
      });
    }
    // 复位单轮累计，保留 streak / bestStreak
    this.n = 0;
    this.ok = 0;
    this.reactionSum = 0;
    this.reactionN = 0;
    this.startedAt = Date.now();
    return this.roundOk;
  }

  answer(correct, reactionMs) {
    this.n++;
    if (correct) { this.ok++; this.streak++; if (this.streak > this.bestStreak) this.bestStreak = this.streak; }
    else this.streak = 0;
    if (typeof reactionMs === 'number') {
      this.reactionSum += reactionMs;
      this.reactionN++;
    }
  }

  stats() {
    return {
      n: this.n, ok: this.ok,
      accuracy: this.n ? this.ok / this.n : null,
      streak: this.streak, bestStreak: this.bestStreak,
      avgReaction: this.reactionN ? this.reactionSum / this.reactionN : null
    };
  }
}

// cleanupModules 离页补报
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    // 仅当有数据时才补报
    const ear = window.Ear;
    if (ear && ear.n > 0 && typeof PracticeStore !== 'undefined') {
      PracticeStore.addSession({
        module: 'ear', startedAt: ear.startedAt, durationMs: Date.now() - ear.startedAt,
        accuracy: ear.n ? ear.ok / ear.n : null,
        meta: { level: 'auto', mode: 'cleanup', questions: ear.n, avgReactionMs: ear.reactionN ? Math.round(ear.reactionSum / ear.reactionN) : 0 }
      });
    }
  });
}
