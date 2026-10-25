// Presentation helpers for karaoke lyrics — framework-agnostic HTML strings,
// shared by the Karaoke view and the Play-view karaoke overlay so the
// word-by-word fill looks identical in both. (Kept separate from timeline.js,
// which stays pure data.)

export function escapeHTML(s) {
  return String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

// Render one timeline line as word <span>s: words before the cursor are `.done`,
// the current word fills left-to-right to `wordProgress` (0..1) via a clip-text
// gradient, later words stay neutral. Falls back to the plain (escaped) text
// when the line has no word timing.
export function lineFillHTML(line, wordIdx, wordProgress) {
  if (!line || !line.words || !line.words.length) return escapeHTML(line ? line.text : "");
  return line.words.map((w, i) => {
    if (i < wordIdx) return `<span class="kw done">${escapeHTML(w.text)}</span>`;
    if (i === wordIdx) {
      const p = Math.round((wordProgress || 0) * 100);
      return `<span class="kw cur" style="background:linear-gradient(90deg,var(--accent) ${p}%,var(--kw-future) ${p}%)">${escapeHTML(w.text)}</span>`;
    }
    return `<span class="kw">${escapeHTML(w.text)}</span>`;
  }).join(" ");
}
