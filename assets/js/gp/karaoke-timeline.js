// Karaoke lyric timeline: normalize a song's lyrics into absolute per-line and
// per-word timings driving the teleprompter scroll and the word-by-word fill.
//
// Lines that already carry word timing (e.g. imported enhanced LRC) are used as
// authored. Lines with only `{time,text}` get their words auto-distributed
// across the line's span — weighted by word length so longer words linger — so
// every lyric song becomes a karaoke fill for free.

const DEFAULT_LINE_DUR = 3;

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

function normalizeWords(line, start, end) {
  const span = Math.max(0.1, end - start);
  if (Array.isArray(line.words) && line.words.length) {
    const ws = line.words
      .filter((w) => w && typeof w.t === "number")
      .map((w) => ({ t: w.t, text: w.text || "" }))
      .sort((a, b) => a.t - b.t);
    return ws.map((w, i) => {
      const wEnd = i + 1 < ws.length ? ws[i + 1].t : end;
      const dur = Math.max(0.05, wEnd - w.t);
      return { t: +w.t.toFixed(3), end: +(w.t + dur).toFixed(3), dur: +dur.toFixed(3), text: w.text };
    });
  }
  const tokens = String(line.text || "").trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const weights = tokens.map((t) => Math.max(1, t.replace(/[^\p{L}\p{N}]/gu, "").length));
  const total = weights.reduce((a, b) => a + b, 0);
  let t = start;
  return tokens.map((tok, i) => {
    const dur = span * (weights[i] / total);
    const w = { t: +t.toFixed(3), end: +(t + dur).toFixed(3), dur: +dur.toFixed(3), text: tok };
    t += dur;
    return w;
  });
}

export function buildLyricTimeline(song) {
  const raw = (song?.lyrics || [])
    .filter((l) => l && typeof l.time === "number")
    .slice()
    .sort((a, b) => a.time - b.time);
  const lines = raw.map((L, i) => {
    const next = raw[i + 1];
    const end = L.dur != null
      ? L.time + L.dur
      : (next ? next.time : L.time + DEFAULT_LINE_DUR);
    const dur = Math.max(0.1, end - L.time);
    const words = normalizeWords(L, L.time, L.time + dur);
    return {
      time: L.time,
      end: L.time + dur,
      dur,
      text: (L.text && L.text.trim()) || words.map((w) => w.text).join(" "),
      words,
    };
  });
  return { lines, hasWordTiming: raw.some((l) => Array.isArray(l.words) && l.words.length) };
}

// Resolve the active line/word and fill progress at time `t` (seconds).
//   lineIdx/wordIdx  -1 when nothing is active yet (before the first line/word)
//   nextLineIdx      the upcoming line (-1 when none)
//   lineProgress     0..1 through the current line
//   wordProgress     0..1 through the current word (drives the highlight wipe)
export function activeAt(timeline, t) {
  const lines = timeline?.lines || [];
  const none = { lineIdx: -1, nextLineIdx: lines.length ? 0 : -1, wordIdx: -1, lineProgress: 0, wordProgress: 0 };
  if (!lines.length) return none;

  let lineIdx = -1;
  for (let i = 0; i < lines.length; i++) { if (t >= lines[i].time) lineIdx = i; else break; }
  if (lineIdx < 0) return none;

  const L = lines[lineIdx];
  const lineProgress = clamp01((t - L.time) / Math.max(0.001, L.dur));
  let wordIdx = -1;
  for (let i = 0; i < L.words.length; i++) { if (t >= L.words[i].t) wordIdx = i; else break; }
  let wordProgress = 0;
  if (wordIdx >= 0) {
    const w = L.words[wordIdx];
    wordProgress = clamp01((t - w.t) / Math.max(0.001, w.dur));
  }
  return {
    lineIdx,
    nextLineIdx: lineIdx + 1 < lines.length ? lineIdx + 1 : -1,
    wordIdx,
    wordProgress,
    lineProgress,
  };
}

// Total span of the lyric timeline (for progress bars / end detection).
export function timelineDuration(timeline) {
  const lines = timeline?.lines || [];
  return lines.length ? lines[lines.length - 1].end : 0;
}
