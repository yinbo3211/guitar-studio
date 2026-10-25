// Shared note-grading engine used by instrument play and karaoke vocal scoring.
//
// Pitch matching is octave-agnostic: a singer (or a capo'd/transposed instrument)
// may be one or more octaves off the written pitch yet still be "right". The
// defaults mirror the play view exactly (PERFECT_CENTS 28 / GOOD_CENTS 60, the
// same health/score/streak bookkeeping) so the two stay in lockstep.

export const GRADE_DEFAULTS = {
  perfectCents: 28,
  goodCents: 60,
  health: { start: 100, max: 100, perfect: +6, good: +3, off: -7, miss: -10 },
  score: { perfect: 100, good: 60, off: 10 },
};

// Smallest octave-folded cents error between a detected pitch and any target.
export function centsOff(detectedMidi, targets) {
  let best = Infinity;
  for (const target of targets) {
    const diff = detectedMidi - target;
    const cents = Math.abs((diff - Math.round(diff / 12) * 12) * 100);
    if (cents < best) best = cents;
  }
  return best;
}

export function classify(frames, bestCents, opt = GRADE_DEFAULTS) {
  if (frames >= 2 && bestCents <= opt.perfectCents) return "perfect";
  if (frames >= 1 && bestCents <= opt.goodCents) return "good";
  if (frames >= 1) return "off";
  return "miss";
}

export class Grader {
  constructor(opt = {}) {
    this.opt = {
      ...GRADE_DEFAULTS, ...opt,
      health: { ...GRADE_DEFAULTS.health, ...(opt.health || {}) },
      score: { ...GRADE_DEFAULTS.score, ...(opt.score || {}) },
    };
    this.reset();
  }

  reset() {
    this.counts = { perfect: 0, good: 0, off: 0, miss: 0 };
    this.health = this.opt.health.start;
    this.failed = false;
    this.score = 0;
    this.streak = 0;
    this.maxStreak = 0;
    this.mult = 1;
  }

  // Accumulate one detection frame onto a still-open note window. `note` is
  // mutated with `frames`/`best`, matching the play view's per-note state.
  observe(note, detectedMidi) {
    if (!(detectedMidi > 0)) return;
    const cents = centsOff(detectedMidi, note.midi);
    if (cents < this.opt.goodCents) {
      note.frames = (note.frames || 0) + 1;
      if (cents < (note.best ?? Infinity)) note.best = cents;
    }
  }

  // Close a note window: classify, apply scoring, stamp `note.state`, return quality.
  finalize(note) {
    const q = classify(note.frames || 0, note.best ?? Infinity, this.opt);
    note.state = q;
    this.apply(q);
    return q;
  }

  apply(q) {
    const H = this.opt.health, S = this.opt.score;
    this.counts[q]++;
    if (q === "perfect") { this.health = Math.min(H.max, this.health + H.perfect); this.streak++; this.score += Math.round(S.perfect * this.mult); }
    else if (q === "good") { this.health = Math.min(H.max, this.health + H.good); this.streak++; this.score += Math.round(S.good * this.mult); }
    else if (q === "off") { this.health = Math.max(0, this.health + H.off); this.streak = 0; this.score += S.off; }
    else { this.health = Math.max(0, this.health + H.miss); this.streak = 0; }
    this.maxStreak = Math.max(this.maxStreak, this.streak);
    this.mult = 1 + Math.min(3, Math.floor(this.streak / 8)) * 0.5;
    if (this.health <= 0) this.failed = true;
    return q;
  }

  accuracy() {
    const c = this.counts;
    const total = c.perfect + c.good + c.off + c.miss;
    if (!total) return 100;
    return Math.round(((c.perfect + c.good * 0.6) / total) * 100);
  }
}

// Choose the pitch target for vocal scoring: an authored vocal melody
// (`song.voice.notes`) when present, otherwise the instrument melody so any
// lyric song stays singable/scorable.
export function vocalTargets(song) {
  const v = song && song.voice && song.voice.notes;
  return (v && v.length ? v : (song && song.notes) || []);
}

export function gradeLetter(acc, failed) {
  if (failed) return "F";
  if (acc >= 97) return "S";
  if (acc >= 92) return "A";
  if (acc >= 82) return "B";
  if (acc >= 70) return "C";
  if (acc >= 60) return "D";
  return "F";
}
