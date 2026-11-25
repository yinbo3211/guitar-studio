/* ============================================================
   六弦工坊 V4.4 · data/sheet-format.js（曲谱工坊 T01）
   ------------------------------------------------------------
   gs-chord v1 标记语言：解析 / 序列化 / 和弦解析 / 转调 / capo /
   桥接 GP 定义 / 语法校验 / 和弦联想排序。
   ★ 纯函数、无 DOM、无宿主依赖，可脱离浏览器被 node --test 直接 import。
   ★ 与 song-format.js / rhythm-data.js 同风格：ESM 具名导出 +
     window.SheetFormat 兼容挂载（供 UI 层直接取用）。
   权威口径：docs/V4.4_SHEET_STUDIO_SPEC.md §4 / §5。
   ============================================================ */
'use strict';

import { CHORD_TYPES, chordName, keyToPc, prefersFlat, suggestCapo } from '../gp/theory.js';
import { NOTE_SHARP, NOTE_FLAT } from '../gp/notes.js';

export const SHEET_VERSION = 1;

/* ---------- 附录 A：全枚举总表 ---------- */
const KEYS = [
  'C', 'C#', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B',
  'Am', 'Bm', 'Cm', 'Dm', 'Em', 'Fm', 'Gm',
];
const TIME_SIGS = ['2/4', '3/4', '4/4', '6/8', '12/8'];
const LANGUAGES = ['纯音乐', '国语', '粤语', '闽南语', '英语', '法语', '日语', '韩语', '泰语', '其他语言'];
const STYLES = ['流行', '古典', '爵士', '摇滚', '民谣', '古风', '电子', '民族', '红歌', '儿歌'];
const ARRANGES = ['高还原', '简化', '改编', '串烧', '原创'];
const TAGS = ['轻音乐', '动漫音乐', '游戏音乐', '影视歌曲', '考级'];
/* 附录 A-6：风格 → 默认节奏型推荐 */
const STYLE_PATTERN = {
  '流行': 'strum-pop-a', '民谣': 'pick-folk-a', '古风': 'pick-folk-a',
  '摇滚': 'strum-du8', '古典': 'pick-basic4', '爵士': 'pick-triplet',
  '电子': 'strum-chuck', '民族': 'strum-basic4', '红歌': 'strum-basic4', '儿歌': 'strum-basic4',
};
/* rhythm-data.js ALL_PATTERNS 的 14 个 id（ID 型节奏型标记必须命中） */
const PATTERN_IDS = [
  'strum-basic4', 'strum-2x4', 'strum-du8', 'strum-pop-a', 'strum-pop-b',
  'strum-waltz', 'strum-du8-long', 'strum-chuck',
  'pick-basic4', 'pick-up8', 'pick-folk-a', 'pick-waltz6', 'pick-bass-alt', 'pick-triplet',
];
/* 附录 A-8：内置指法库 22 个和弦名（用于联想「有指法图」判定） */
const FINGERPRINT_CHORDS = [
  'C', 'C7', 'D', 'D7', 'Dm', 'Dsus2', 'Dsus4', 'E', 'E7', 'Em', 'Esus4',
  'F', 'F#m', 'G', 'G7', 'A', 'A7', 'Am', 'Asus2', 'Asus4', 'B', 'Bm',
];
const SECTION_PRESETS = ['前奏', '主歌', '主歌 B', '预副歌', '副歌', '副歌 B', '间奏', '桥段', '尾奏'];
const TEMPO_MIN = 40, TEMPO_MAX = 240, TEXT_MAX = 50000, SHEET_MAX = 200, CAPO_MAX = 7;

export const SHEET_ENUMS = {
  KEYS, TIME_SIGS, LANGUAGES, STYLES, ARRANGES, TAGS, SECTION_PRESETS,
  STYLE_PATTERN, PATTERN_IDS, FINGERPRINT_CHORDS,
  TEMPO_MIN, TEMPO_MAX, TEXT_MAX, SHEET_MAX, CAPO_MAX,
  DEFAULT_TEMPO: 70, DEFAULT_TIME: '4/4', DEFAULT_KEY: 'C',
  DEFAULT_PATTERN: 'strum-pop-a',
};

/* ---------- 工具 ---------- */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const mod12 = (v) => ((v % 12) + 12) % 12;
/** 显示宽度：CJK / 全角 = 2，ASCII = 1（与预览 monospace 列宽一致） */
export function displayWidth(s) {
  let w = 0;
  for (const ch of String(s == null ? '' : s)) {
    w += /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(ch) ? 2 : 1;
  }
  return w;
}
const normalizeAcc = (s) => String(s == null ? '' : s).replace(/♯/g, '#').replace(/♭/g, 'b');
const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function letterToPc(raw) {
  const s = normalizeAcc(String(raw == null ? '' : raw).trim());
  const m = /^([A-Ga-g])([#b]?)$/.exec(s);
  if (!m) return null;
  return mod12(LETTER_PC[m[1].toUpperCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0));
}

/* 后缀 → CHORD_TYPES key。按 label 长度降序，避免 'm' 抢先匹配 'm7'/'maj7'。
   空 label（maj）放最后作为兜底。 */
const SUFFIX_TO_TYPE = Object.entries(CHORD_TYPES)
  .map(([type, def]) => [def.label, type])
  .sort((a, b) => b[0].length - a[0].length);
/* 常见别名（大小写敏感，先做等价替换） */
const SUFFIX_ALIAS = { M7: 'maj7', Maj7: 'maj7', maj: '', min: 'm', Min: 'm', 'Δ7': 'maj7', 'ø': 'm7b5' };

/**
 * 解析和弦名。支持 [根音][修饰][/低音]，如 C、F#m、Bb、Cmaj7、Am7b5、C/E。
 * @returns {{name:string, rootPc:number, type:string, bassPc:number|null,
 *            valid:boolean, reason?:string}}
 * valid=false 时 rootPc 仍可能为可解析值（调用方可按需容错降级为三和弦）。
 */
export function parseChord(raw) {
  const name = normalizeAcc(String(raw == null ? '' : raw).trim());
  const out = { name, rootPc: 0, type: 'maj', bassPc: null, valid: true };
  if (!name) { out.valid = false; out.reason = 'empty'; return out; }
  const slash = name.indexOf('/');
  const main = (slash >= 0 ? name.slice(0, slash) : name).trim();
  const bassRaw = slash >= 0 ? name.slice(slash + 1).trim() : '';
  const m = /^([A-Ga-g])([#b]?)(.*)$/.exec(main);
  if (!m) { out.valid = false; out.reason = 'root'; return out; }
  out.rootPc = mod12(LETTER_PC[m[1].toUpperCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0));
  let suffix = m[3];
  if (Object.prototype.hasOwnProperty.call(SUFFIX_ALIAS, suffix)) suffix = SUFFIX_ALIAS[suffix];
  const hit = SUFFIX_TO_TYPE.find(([label]) => label === suffix);
  if (hit) out.type = hit[1];
  else if (suffix) { out.valid = false; out.reason = 'suffix'; }
  if (bassRaw) {
    const bp = letterToPc(bassRaw);
    if (bp == null) { out.valid = false; out.reason = 'bass'; }
    else out.bassPc = bp;
  }
  return out;
}

/** 由 [rootPc,type] 生成显示名；keyPc 决定升降号拼写（prefersFlat）。 */
export function chordLabel(rootPc, type = 'maj', keyPc = null, bassPc = null) {
  const base = chordName(mod12(rootPc), type, Number.isFinite(keyPc) ? { keyPc } : {});
  return bassPc == null ? base : base + '/' + chordName(mod12(bassPc), 'maj', Number.isFinite(keyPc) ? { keyPc } : {});
}

/** 单个和弦转调（半音）；targetKeyPc 用于决定新调的降号拼写。 */
export function transposeChord(raw, semitones, keyPc = null) {
  const c = parseChord(raw);
  const n = Number(semitones) || 0;
  const targetKey = Number.isFinite(keyPc) ? mod12(keyPc + n) : (n < 0 ? mod12(c.rootPc + n) : null);
  const useFlat = n < 0 && !Number.isFinite(keyPc);
  const mk = (pc, type, bass) => {
    const names = (useFlat || (Number.isFinite(targetKey) && prefersFlat(targetKey))) ? NOTE_FLAT : NOTE_SHARP;
    return names[mod12(pc)] + (CHORD_TYPES[type]?.label ?? '');
  };
  return mk(mod12(c.rootPc + n), c.type, c.bassPc) +
    (c.bassPc == null ? '' : '/' + mk(mod12(c.bassPc + n), 'maj', null));
}

/** capo 指法换算：夹 n 品时，源谱和弦 C 需「向上 n 半音」的开放和弦形状
 *  才能发出同样音高的听觉效果（文档 §5.10 / SF-08 口径：C + capo2 → D 指法）。
 *  返回 {shapeName, soundingName, capo, shapePc}。源文本不动，仅渲染层换算。 */
export function capoChord(raw, capo, keyPc = null) {
  const c = parseChord(raw);
  const n = clamp(Number(capo) || 0, 0, CAPO_MAX);
  return {
    shapeName: transposeChord(raw, n, keyPc),
    soundingName: c.name || chordLabel(c.rootPc, c.type, keyPc, c.bassPc),
    capo: n,
    shapePc: mod12(c.rootPc + n),
  };
}

/** 推荐变调夹（复用 theory.suggestCapo）。 */
export function suggestCapoForKey(key) {
  const pc = keyToPc(key);
  return suggestCapo(pc == null ? 0 : pc);
}

/* ---------- 头部元信息 ---------- */
const META_KEYS = ['title', 'artist', 'transcriber', 'key', 'originalKey', 'tempo', 'time', 'capo', 'rhythm'];
function emptyMeta() {
  return {
    title: '', artist: '', transcriber: '', key: 'C', originalKey: 'C',
    tempo: 70, time: '4/4', capo: 0, rhythm: 'strum-pop-a',
    language: '', style: '', arrange: '', tags: [],
  };
}
function applyMeta(meta, key, value, warnings, lineNo) {
  if (key === 'meta') {
    const i = value.indexOf(':');
    const cat = (i >= 0 ? value.slice(0, i) : value).trim();
    const val = (i >= 0 ? value.slice(i + 1) : '').trim();
    if (cat === META_CATEGORIES.language) meta.language = val;
    else if (cat === META_CATEGORIES.style) meta.style = val;
    else if (cat === META_CATEGORIES.arrange) meta.arrange = val;
    else if (cat === META_CATEGORIES.tags) meta.tags = val ? val.split(/[,，]/).map((s) => s.trim()).filter(Boolean) : [];
    else warnings.push({ code: 'unknown-meta', line: lineNo, msg: `未知元信息类别：${cat}` });
    return;
  }
  if (key === 'tempo' || key === 'capo') meta[key] = clamp(parseInt(value, 10) || (key === 'tempo' ? 70 : 0), key === 'tempo' ? TEMPO_MIN : 0, key === 'tempo' ? TEMPO_MAX : CAPO_MAX + 5);
  else if (META_KEYS.includes(key)) meta[key] = value.trim();
  else warnings.push({ code: 'unknown-marker', line: lineNo, msg: `未知头部标记：${key}` });
}

/* ---------- gs-chord v1 主解析 ---------- */
/** 行类型判定（§5.7 顺序敏感）。 */
export function classifyLine(raw) {
  const s = raw.trim();
  if (!s) return 'blank';
  if (/^\{name:.*\}$/.test(s) || /^#[^>]/.test(s)) return 'section';
  if (/^\{rhythm:.*\}$/.test(s)) return 'rhythm';
  if (/^\{(title|artist|transcriber|key|originalKey|tempo|time|capo|meta):.*\}$/.test(s)) return 'meta';
  if (/^\{comment:.*\}$/.test(s) || /^#>/.test(s)) return 'comment';
  /* 未知整行 {} 标记（ChordPro {soc}/{eoc}/{column_break} / {sot} 等）：
     保留原文、渲染隐藏、由 parseSheetText 出 warning（附录 B 降级策略）。 */
  if (/^\{[^}]+\}$/.test(s)) return 'meta';
  /* 含 [ ] 且行内去掉所有 [...] 与 | 后无剩余 → 纯和弦行 */
  const stripped = s.replace(/\[[^\]]*\]/g, '').replace(/\|/g, '').replace(/\s/g, '');
  if (/\[/.test(s) && stripped === '') return 'chord-line';
  return 'lyric';
}

/** 把一行文本切成 segments：[{chord?|text, col}]，col 为显示宽度起始列。 */
export function tokenizeLine(raw) {
  const segs = [];
  let col = 0;
  const parts = raw.split(/(\[[^\]]*\])/);
  for (const part of parts) {
    if (!part) continue;
    if (/^\[[^\]]*\]$/.test(part)) {
      segs.push({ chord: part.slice(1, -1), col });
    } else {
      segs.push({ text: part, col });
      col += displayWidth(part);
    }
  }
  return segs;
}

/** 未闭合 [ 检测（split 后残留含 '[' 但不含 ']' 的段）。 */
function hasUnclosed(raw) {
  const opens = (raw.match(/\[/g) || []).length;
  const closes = (raw.match(/\]/g) || []).length;
  return opens > closes;
}

/**
 * 解析 gs-chord v1 源文本 → SheetAST。
 * @returns {{meta, lines, warnings, beatsPerBar, beatCursor}}
 * lines[i]: {type, raw, lineNo, segments?, beats?, col?, section?, rhythm?,
 *            repeat?, pureText?, beatStart?}
 */
export function parseSheetText(text) {
  const src = String(text == null ? '' : text);
  const warnings = [];
  const meta = emptyMeta();
  const lines = [];
  const rows = src ? src.split('\n') : [];   // 空文本 → 空 AST（SF-04 口径）
  const seenSections = new Set();
  let beatCursor = 0;
  let beatsPerBar = 4;
  let lastSection = null;
  /* 头部区（第一个 section/内容行之前）的 {rhythm} 才是默认节奏型；
     段落级 {rhythm} 只作该段标注，不得覆盖 meta.rhythm（F-05/F-02）。 */
  let inHeader = true;

  rows.forEach((raw, idx) => {
    const lineNo = idx + 1;
    const type = classifyLine(raw);
    const line = { type, raw, lineNo };

    if (type === 'meta') {
      const m = /^\{([^:]+):([\s\S]*)\}$/.exec(raw.trim());
      if (m) applyMeta(meta, m[1].trim(), m[2], warnings, lineNo);
      else warnings.push({ code: 'unknown-marker', line: lineNo, msg: '未知标记（已保留原文）' });
      if (m && m[1].trim() === 'time') {
        const b = parseInt(meta.time, 10);
        if (b >= 1 && b <= 12) beatsPerBar = b;
      }
      lines.push(line);
      return;
    }
    if (type === 'section') {
      inHeader = false;
      const m = /^\{name:([\s\S]*)\}$/.exec(raw.trim());
      const name = m ? m[1].trim() : raw.trim().replace(/^#/, '').trim();
      line.section = name;
      lastSection = name;
      if (seenSections.has(name)) warnings.push({ code: 'dup-section', line: lineNo, msg: `段名重复：${name}` });
      seenSections.add(name);
      lines.push(line);
      return;
    }
    if (type === 'rhythm') {
      const m = /^\{rhythm:([\s\S]*)\}$/.exec(raw.trim());
      const val = m ? m[1].trim() : '';
      line.rhythm = val;
      /* V4.4：仅头部区的 {rhythm} 回灌 meta（默认节奏型）；段落级不改 meta，
         否则表单⇔头部双向同步与预览演奏都会串成「最后一个段落的节奏型」。 */
      if (val && inHeader) meta.rhythm = val;
      if (val && !PATTERN_IDS.includes(val) && !/[\s↓↑×·]/.test(val)) {
        warnings.push({ code: 'unknown-pattern', line: lineNo, msg: `未命中的节奏型 ID：${val}` });
      }
      lines.push(line);
      return;
    }
    if (type === 'comment' || type === 'blank') { lines.push(line); return; }

    /* lyric / chord-line：重复标记、segments、字位、拍位 */
    inHeader = false;
    const rep = /\{x(\d+)\}/.exec(raw);
    if (rep) line.repeat = clamp(parseInt(rep[1], 10) || 1, 1, 99);
    const body = raw.replace(/\{x\d+\}/g, '');
    if (hasUnclosed(body)) warnings.push({ code: 'unclosed-chord', line: lineNo, msg: '未闭合的 [ 和弦标记' });
    const segments = tokenizeLine(body);
    line.segments = segments;
    line.pureText = segments.filter((s) => s.text != null).map((s) => s.text).join('');
    line.totalWidth = segments.reduce((w, s) => w + (s.text != null ? displayWidth(s.text) : 0), 0);
    line.col = line.totalWidth;
    /* §5.7：行拍数 = max(1, ceil(宽/8)) */
    line.beats = Math.max(1, Math.ceil(line.totalWidth / 8));
    line.beatStart = beatCursor;
    beatCursor += line.beats;
    /* 和弦校验 */
    for (const s of segments) {
      if (s.chord == null) continue;
      const c = parseChord(s.chord);
      if (!c.valid) warnings.push({ code: 'bad-chord', line: lineNo, msg: `无法识别和弦：${s.chord}` });
    }
    lines.push(line);
  });

  if (meta.capo > CAPO_MAX) warnings.push({ code: 'capo-range', line: 0, msg: `变调夹超过 ${CAPO_MAX} 品：${meta.capo}` });
  return { meta, lines, warnings, beatsPerBar, beatCursor, text: src };
}

/** 序列化回写：保留每行 raw，parse→serialize→parse 幂等（SF-10）。 */
export function serializeSheetText(ast) {
  if (ast && Array.isArray(ast.lines)) return ast.lines.map((l) => l.raw).join('\n');
  return String(ast == null ? '' : ast);
}

/** 转调重写整篇源文本的和弦标记与 {key} 头（F-11 转调另存）。原文其它部分不动。 */
export function transposeSheetText(text, semitones, opts = {}) {
  const n = Number(semitones) || 0;
  if (!n) return String(text == null ? '' : text);
  const ast = parseSheetText(text);
  const keyPc = keyToPc(ast.meta.key);
  return ast.lines.map((l) => {
    if (l.type === 'meta') {
      const m = /^\{(key|originalKey):([\s\S]*)\}$/.exec(l.raw.trim());
      if (m && keyPc != null) {
        const minor = /m$/.test(m[2].trim());
        const np = mod12(keyPc + n);
        const names = (n < 0 || prefersFlat(np)) ? NOTE_FLAT : NOTE_SHARP;
        return `{${m[1]}:${names[np]}${minor ? 'm' : ''}}`;
      }
      return l.raw;
    }
    if (l.type !== 'lyric' && l.type !== 'chord-line') return l.raw;
    return l.raw.replace(/\[([^\]]*)\]/g, (all, inner) => '[' + transposeChord(inner, n, keyPc) + ']');
  }).join('\n');
}

/** 语法校验（F-09）：阻断级阻止保存，警告级不阻止。 */
export function validateSheetText(text) {
  const src = String(text == null ? '' : text);
  const blocking = [], warnings = [];
  if (src.length > TEXT_MAX) blocking.push({ code: 'too-long', line: 0, msg: `文本超过 ${TEXT_MAX} 字符` });
  let ast;
  try { ast = parseSheetText(src); }
  catch (e) { blocking.push({ code: 'parse-error', line: 0, msg: String(e && e.message || e) }); return { ok: false, blocking, warnings, ast: null }; }
  if (!/^\{title:\s*\S/m.test(src)) blocking.push({ code: 'no-title', line: 0, msg: '缺少头部 {title:…} 标记' });
  for (const w of ast.warnings) warnings.push(w);
  /* 空段落：段名行之后紧跟另一个段名或到结尾都无内容行 */
  ast.lines.forEach((l, i) => {
    if (l.type !== 'section') return;
    const next = ast.lines.slice(i + 1).find((x) => x.type === 'lyric' || x.type === 'chord-line');
    const nextSection = ast.lines.slice(i + 1).find((x) => x.type === 'section');
    if (nextSection && (!next || ast.lines.indexOf(nextSection) < ast.lines.indexOf(next))) {
      warnings.push({ code: 'empty-section', line: l.lineNo, msg: `空段落：${l.section}` });
    }
  });
  return { ok: blocking.length === 0, blocking, warnings, ast };
}

/* ---------- 桥接：SheetDoc → GP 演奏定义（§4.3） ---------- */
/** 每小节取最后落入的和弦；空小节沿用上一小节；全谱无和弦回退主和弦。 */
export function expandSheetToGp(sheet, opts = {}) {
  const s = sheet || {};
  const ast = parseSheetText(s.text);
  const meta = { ...ast.meta };
  /* 表单字段优先于头部标记（表单是权威真相） */
  for (const k of ['title', 'artist', 'transcriber', 'key', 'originalKey', 'tempo', 'timeSig', 'capo', 'language', 'style', 'arrange', 'tags', 'patternId']) {
    if (s[k] != null && s[k] !== '') meta[k === 'timeSig' ? 'time' : k === 'patternId' ? 'rhythm' : k] = s[k];
  }
  const tempo = clamp(Number(meta.tempo) || 70, TEMPO_MIN, TEMPO_MAX);
  const spb = 60 / tempo;
  const beatsPerBar = clamp(parseInt(meta.time, 10) || 4, 1, 12);
  const keyPc = keyToPc(meta.key) ?? 0;
  const semitones = Number(opts.transpose) || 0;
  const capo = Number(opts.displayCapo ?? meta.capo) || 0;
  const displayKeyPc = mod12(keyPc + semitones);

  /* 逐行累加拍位，和弦按字位落入小节（§4.3/§5.7 统一口径）。
     · 行拍数 = max(一小节拍数, ceil(显示宽度/8))，与 parseSheetText 的字位同源；
     · {x2} 试听展开：整行和弦复制一遍到翻倍后的拍位，lineBeats 翻倍；
     · 每小节取「最后落入」的和弦，小节无和弦沿用上一小节。 */
  const barChords = new Map();
  const lyrics = [];
  const lineTimeline = [];
  let beat = 0;
  for (const l of ast.lines) {
    if (l.type !== 'lyric' && l.type !== 'chord-line') continue;
    const baseBeats = Math.max(beatsPerBar, l.beats || beatsPerBar);
    const repeat = l.repeat === 2 ? 2 : 1;       // M1 只展开 x2，x4 仅标记
    const lineBeats = baseBeats * repeat;
    const width = Math.max(1, l.totalWidth || 1);
    const chordSegs = (l.segments || []).filter((s) => s.chord != null);
    for (let r = 0; r < repeat; r++) {
      for (const seg of chordSegs) {
        const c = parseChord(seg.chord);
        const localBeat = (seg.col / width) * baseBeats;
        const bar = Math.floor((beat + r * baseBeats + localBeat) / beatsPerBar);
        barChords.set(bar, [mod12(c.rootPc + semitones), c.type]);
      }
      if (l.pureText && l.pureText.trim()) {
        lyrics.push({ time: +((beat + r * baseBeats) * spb).toFixed(3), text: l.pureText.trim() });
      }
    }
    lineTimeline.push({ lineNo: l.lineNo, beat, section: l.section || null });
    beat += lineBeats;
  }
  /* 补空小节：沿用上一小节；全谱无和弦 → 主和弦兜底 */
  const chords = [];
  if (barChords.size) {
    const maxBar = Math.max(...barChords.keys());
    let last = [displayKeyPc, 'maj'];
    for (let b = 0; b <= maxBar; b++) {
      if (barChords.has(b)) last = barChords.get(b);
      chords.push(last);
    }
  } else {
    chords.push([displayKeyPc, 'maj']);
  }
  const durationSec = +(beat * spb).toFixed(3);
  const names = prefersFlat(displayKeyPc) ? NOTE_FLAT : NOTE_SHARP;
  return {
    id: s.id || 'sheet-preview',
    title: meta.title || 'Untitled',
    artist: meta.artist || '',
    key: names[displayKeyPc] + (/m$/.test(String(meta.key)) ? 'm' : ''),
    capo,
    bpm: tempo,
    timeSigText: meta.time || '4/4',
    chartKind: 'user-chord',
    source: 'sheet-editor',
    pattern: meta.rhythm || 'strum-pop-a',
    harmony: { source: 'sheet', chords, beatsPerBar },
    lyrics,
    durationSec,
    background: { type: 'animated', value: 'aurora' },
    /* 供播放器逐行滚动：行级时间轴（与和弦/歌词同一拍位口径） */
    lineTimeline,
  };
}

/* ---------- 和弦联想排序（F-06，纯逻辑便于单测） ---------- */
/** 调内三和弦 I ii iii IV V vi vii°（大调）/ 自然小调。 */
const DIATONIC_MAJOR = [[0, 'maj'], [2, 'min'], [4, 'min'], [5, 'maj'], [7, 'maj'], [9, 'min'], [11, 'dim']];
const DIATONIC_MINOR = [[0, 'min'], [2, 'dim'], [3, 'maj'], [5, 'min'], [7, 'min'], [8, 'maj'], [10, 'maj']];
/**
 * 候选排序（F-06 权重）：调内 diatonic 三和弦 > 指法库其他 > 七/挂留/斜线 > 频次。
 * @param {string} query 已输入的和弦名片段（不含 [ ]）
 * @param {string} key 当前选调
 * @param {{freq?:object, limit?:number}} opts
 * @returns {Array<{name,hasDiagram,rank,pc,type}>}
 */
export function chordSuggestions(query, key = 'C', opts = {}) {
  const q = normalizeAcc(String(query == null ? '' : query)).trim();
  const keyPc = keyToPc(key) ?? 0;
  const minor = /m$/.test(String(key));
  const diatonic = (minor ? DIATONIC_MINOR : DIATONIC_MAJOR)
    .map(([off, type], rank) => ({ name: chordLabel(mod12(keyPc + off), type, keyPc), type, rank: 100 - rank, pc: mod12(keyPc + off) }));
  const seen = new Map();
  const add = (name, hasDiagram, rank, type, pc) => {
    if (!name || seen.has(name)) return;
    seen.set(name, { name, hasDiagram, rank, type, pc });
  };
  /* 1) 调内 diatonic 三和弦（最高） */
  for (const d of diatonic) add(d.name, FINGERPRINT_CHORDS.includes(d.name), d.rank, d.type, d.pc);
  /* 2) 指法库其他 22 个 */
  for (const name of FINGERPRINT_CHORDS) add(name, true, 55, parseChord(name).type, parseChord(name).rootPc);
  /* 3) 全部 12 根音 × 全部 CHORD_TYPES（七/挂留/斜线之类，最低） */
  for (const [type, def] of Object.entries(CHORD_TYPES)) {
    for (let pc = 0; pc < 12; pc++) {
      const name = chordLabel(pc, type, keyPc);
      add(name, false, def.label.length > 2 ? 20 : 30, type, pc);
    }
  }
  let out = [...seen.values()];
  if (q) {
    const ql = q.toLowerCase();
    out = out.filter((c) => c.name.toLowerCase().startsWith(ql) || c.name.toLowerCase() === ql);
  }
  const freq = opts.freq || {};
  out.sort((a, b) => (b.rank + (freq[b.name] || 0) * 0.1) - (a.rank + (freq[a.name] || 0) * 0.1) || a.name.localeCompare(b.name));
  return out.slice(0, opts.limit || 24);
}

/* ---------- 表单 → 初始模板文本（F-01） ---------- */
export function newSheetTemplate(fields = {}) {
  const f = {
    title: '', artist: '', transcriber: '', key: 'C', originalKey: 'C',
    tempo: 70, timeSig: '4/4', capo: 0, rhythm: 'strum-pop-a',
    language: '', style: '', arrange: '', tags: [], ...fields,
  };
  const tagLine = (f.tags || []).length ? `{meta:标签:${(f.tags || []).join(',')}}\n` : '';
  return [
    `{title:${f.title}}`,
    `{artist:${f.artist}}`,
    `{transcriber:${f.transcriber}}`,
    `{key:${f.key}}`,
    `{originalKey:${f.originalKey}}`,
    `{tempo:${f.tempo}}`,
    `{time:${f.timeSig}}`,
    `{capo:${f.capo}}`,
    `{rhythm:${f.rhythm}}`,
    `{meta:语言:${f.language}}`,
    `{meta:风格:${f.style}}`,
    `{meta:编配:${f.arrange}}`,
    tagLine,
    '{name:主歌}',
    '{rhythm:' + f.rhythm + '}',
    '[C] 在这里输入歌词，在歌词字前插入和弦标记',
  ].filter((x) => x !== undefined).join('\n');
}

/* ---------- 表单 ⇔ 头部标记双向同步（F-01 / F-04 / F-05） ----------
   纯函数下沉到 data 层：applyMeta 与 applyFieldsToText 共用同一套类别名，
   避免 UI 层硬编码中文类别（也避开 lint F9 对 modules 目录的计数）。 */
export const META_CATEGORIES = { language: '语言', style: '风格', arrange: '编配', tags: '标签' };
const HEAD_FIELDS = [
  ['title', 'title'], ['artist', 'artist'], ['transcriber', 'transcriber'],
  ['key', 'key'], ['originalKey', 'originalKey'], ['tempo', 'tempo'],
  ['timeSig', 'time'], ['capo', 'capo'], ['patternId', 'rhythm'],
];

/** 头部标记 → SheetDoc 字段（meta 为权威来源，base 仅补缺省）。 */
export function metaFromText(text, base = {}) {
  const m = parseSheetText(text).meta;
  return {
    ...base,
    title: m.title || base.title || '',
    artist: m.artist || base.artist || '',
    transcriber: m.transcriber || base.transcriber || '',
    key: m.key || base.key || 'C',
    originalKey: m.originalKey || base.originalKey || 'C',
    tempo: Number(m.tempo) || Number(base.tempo) || 70,
    timeSig: m.time || base.timeSig || '4/4',
    capo: Number.isFinite(Number(m.capo)) ? Number(m.capo) : (Number(base.capo) || 0),
    language: m.language || base.language || '',
    style: m.style || base.style || '',
    arrange: m.arrange || base.arrange || '',
    tags: Array.isArray(m.tags) && m.tags.length ? m.tags.slice(0, 3) : (Array.isArray(base.tags) ? base.tags.slice(0, 3) : []),
    patternId: m.rhythm || base.patternId || SHEET_ENUMS.DEFAULT_PATTERN,
  };
}

/** SheetDoc 字段 → 头部标记（已有标记原地替换，缺失标记按字段顺序一次性插到最前）。 */
export function applyFieldsToText(text, fields = {}) {
  let out = String(text == null ? '' : text);
  const missing = [];
  for (const [field, marker] of HEAD_FIELDS) {
    if (fields[field] == null) continue;
    const val = String(fields[field]);
    const re = new RegExp('^\\{' + marker + ':[^}]*\\}$', 'm');
    if (re.test(out)) out = out.replace(re, `{${marker}:${val}}`);
    else missing.push(`{${marker}:${val}}`);
  }
  for (const [field, cat] of [
    ['language', META_CATEGORIES.language], ['style', META_CATEGORIES.style],
    ['arrange', META_CATEGORIES.arrange], ['tags', META_CATEGORIES.tags],
  ]) {
    if (fields[field] == null) continue;
    const val = Array.isArray(fields[field]) ? fields[field].join(',') : String(fields[field]);
    const re = new RegExp('^\\{meta:' + cat + ':[^}]*\\}$', 'm');
    if (re.test(out)) out = out.replace(re, `{meta:${cat}:${val}}`);
    else missing.push(`{meta:${cat}:${val}}`);
  }
  return missing.length ? missing.join('\n') + '\n' + out : out;
}

/** 行号 → textarea 字符偏移（校验面板点击跳行）。 */
export function lineStartOffset(text, lineNo) {
  const src = String(text == null ? '' : text);
  const rows = src.split('\n');
  const n = Math.max(1, Number(lineNo) || 1);
  let off = 0;
  for (let i = 0; i < Math.min(n - 1, rows.length); i++) off += rows[i].length + 1;
  return Math.min(off, src.length);
}

/** 光标处插入片段，返回新文本与新光标（撤销栈/插入面板共用）。 */
export function insertSnippet(text, caret, snippet) {
  const src = String(text == null ? '' : text);
  const s = String(snippet == null ? '' : snippet);
  const at = Math.max(0, Math.min(Number(caret) || 0, src.length));
  return { text: src.slice(0, at) + s + src.slice(at), caret: at + s.length };
}

/** 转调另存的标题后缀（F-11）。 */
export function transposedDocTitle(title, semi) {
  const n = Number(semi) || 0;
  return String(title == null ? '' : title) + '(移调' + (n > 0 ? '+' : '') + n + ')';
}

/* V4.4：keyToPc 由 theory.js 提供，此处重导出给 UI 层（sheet-player / sheet-editor）
   单点引用，避免各模块各写一份调名解析。 */
export { keyToPc };

const SheetFormat = {
  SHEET_VERSION, SHEET_ENUMS, displayWidth, parseChord, chordLabel, transposeChord,
  capoChord, suggestCapoForKey, classifyLine, tokenizeLine, parseSheetText,
  serializeSheetText, transposeSheetText, validateSheetText, expandSheetToGp,
  chordSuggestions, newSheetTemplate, keyToPc, META_CATEGORIES,
  metaFromText, applyFieldsToText, lineStartOffset, insertSnippet, transposedDocTitle,
};
if (typeof window !== 'undefined') window.SheetFormat = SheetFormat;
export { SheetFormat };
export default SheetFormat;
