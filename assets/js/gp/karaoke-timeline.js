// Karaoke lyric timeline: normalize a song's lyrics into absolute per-line and
// per-word timings driving the teleprompter scroll and the word-by-word fill.
//
// Lines that already carry word timing (e.g. imported enhanced LRC) are used as
// authored. Lines with only `{time,text}` get their words auto-distributed
// across the line's span — weighted by word length so longer words linger — so
// every lyric song becomes a karaoke fill for free.

const DEFAULT_LINE_DUR = 3;

/* N-5 中文逐字高亮：
   · CJK（汉/日/韩）无空格，原本 split(/\s+/) 只切出 1 个 token → 整行一次性填充；
   · 拉丁/数字连续段仍作为整体词处理，不做逐字符切（否则 "Warner" 会被拆成 6 个 token）；
   · 纯标点段不占时间片（如歌词里残留的版权元数据行不会把时长稀释到 0.001s/字）。 */
const CJK_RE = /[一-鿿぀-ヿ가-힯]/;
const PUNCT_ONLY = /^[\p{P}\p{S}\s]+$/u;
const MIN_WORD_DUR = 0.12;   // 低于此值的字肉眼不可见（实测最短 0.001s/字）
const MAX_WORD_DUR = 1.20;   // 实测最长 14.77s/字，单字独占半天会破坏跟唱观感

/**
 * 歌词行分词：含 CJK 时逐字切分（丢空白与纯标点），否则按空白切词。
 * @param {string} text 原始歌词行
 * @returns {string[]} token 列表
 */
export function tokenizeLine(text) {
  const s = String(text == null ? "" : text).trim();
  if (!s) return [];
  /* 纯标点/符号行（含残留的版权元数据行）不占任何时间片 */
  if (PUNCT_ONLY.test(s)) return [];
  /* 纯拉丁：保持 V4.2.3 及以前的行为，兼容欧洲歌词的按空格分词 */
  if (!CJK_RE.test(s)) return s.split(/\s+/).filter(Boolean);
  const out = [];
  for (const ch of s) {
    if (/\s/.test(ch)) continue;
    if (PUNCT_ONLY.test(ch)) continue;
    out.push(ch);
  }
  return out;
}

/**
 * 把 span 秒按权重分配给 n 个词，并夹紧到 [MIN_WORD_DUR, MAX_WORD_DUR]。
 * 硬约束：**Σdur === span** —— activeAt() 的 wordProgress 与下一行起点依赖它，
 * 一旦总和不闭合，逐字高亮与行切换就会错位（KT-2 护栏）。
 * @param {number[]} weights 每词权重（≥0）
 * @param {number} span 待分配总时长（秒，>0）
 * @returns {number[]} 每词时长，长度 === weights.length
 */
export function allocate(weights, span) {
  const n = weights.length;
  if (!n) return [];
  /* 区间外无法夹紧：整行均分，宁可放弃夹紧也要保住 Σ=span */
  if (span < n * MIN_WORD_DUR || span > n * MAX_WORD_DUR) return new Array(n).fill(span / n);

  const total = weights.reduce((a, b) => a + b, 0) || n;
  const durs = weights.map((w) => (span * w) / total);
  /* 迭代：夹紧 → 把余量按自由项权重比例重分配 */
  for (let pass = 0; pass < 16; pass++) {
    let sum = 0;
    const freeIdx = [];
    for (let i = 0; i < n; i++) {
      durs[i] = Math.min(MAX_WORD_DUR, Math.max(MIN_WORD_DUR, durs[i]));
      sum += durs[i];
      if (durs[i] > MIN_WORD_DUR + 1e-9 && durs[i] < MAX_WORD_DUR - 1e-9) freeIdx.push(i);
    }
    const drift = span - sum;
    if (Math.abs(drift) < 1e-9 || !freeIdx.length) break;
    const localTotal = freeIdx.reduce((a, i) => a + (weights[i] || 0), 0) || freeIdx.length;
    for (const i of freeIdx) durs[i] += (drift * (weights[i] || 0)) / localTotal;
  }
  /* 收尾吸收残差：优先摊到仍有余量的词；余量不足（极端长行）则均摊，保 Σ=span */
  const rest = span - durs.reduce((a, b) => a + b, 0);
  if (Math.abs(rest) > 1e-9) {
    const rooms = durs.map((d) => (rest > 0 ? MAX_WORD_DUR - d : d - MIN_WORD_DUR));
    const roomSum = rooms.reduce((a, r) => a + Math.max(0, r), 0);
    if (roomSum >= Math.abs(rest) - 1e-12) {
      for (let i = 0; i < n; i++) durs[i] += (rest * Math.max(0, rooms[i])) / roomSum;
    } else {
      for (let i = 0; i < n; i++) durs[i] += rest / n;
    }
  }
  return durs;
}

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
  /* N-5：CJK 逐字切分，否则中文歌词整行只有一个 token（无逐字高亮） */
  const tokens = tokenizeLine(line.text);
  if (!tokens.length) return [];
  const weights = tokens.map((t) => Math.max(1, t.replace(/[^\p{L}\p{N}]/gu, "").length));
  /* N-5：中文单字权重恒为 1 → 需 [0.12s,1.20s] 夹紧 + 迭代重分配，且 Σdur === span */
  const durs = allocate(weights, span);
  let t = start;
  return tokens.map((tok, i) => {
    const dur = durs[i];
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
