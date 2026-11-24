/* ============================================================
   六弦工坊 V4.4 · modules/sheet-player.js（曲谱工坊 T08 / F-12 / F-15）
   ------------------------------------------------------------
   试听与弹唱预览播放器：按估算拍位驱动扫弦 + 鼓点 + 歌词高亮 +
   段落跳转 + 速度/移调，结束与切路由停播，≥30s 上报 PracticeStore。
   ★ 不引入新音频栈：发声复用 AudioEngine.strum/click（原生链路，V4.3.2
     已修复跨 AudioContext 静音）；拍长沿用 Transport.beatDuration() 口径。
   ★ 自包含调度（不占 Transport._cbs 全局回调），teardown 清干净所有
     timer，避免与节拍器互相串音。
   ★ 预览谱面渲染为纯函数 renderSheetHtml()，editor / lib 共用同一 DOM 结构。
   权威口径：docs/V4.4_SHEET_STUDIO_SPEC.md §4.3 / F-10 / F-12 / F-15。
   ============================================================ */
'use strict';

import { CHORD_TYPES, chordMidis } from '../gp/theory.js';
import { midiToFreq } from '../gp/notes.js';
import { parseSheetText, expandSheetToGp, keyToPc, transposeChord } from '../data/sheet-format.js';

/* ---------- 宿主取词（Node 单测无宿主时回退键名） ---------- */
const T = (k) => { try { if (typeof window !== 'undefined' && typeof window.t === 'function') return window.t(k); } catch (e) {} return k; };
const TF = (k, p) => {
  try { if (typeof window !== 'undefined' && window.gsI18n && typeof window.gsI18n.tF === 'function') return window.gsI18n.tF(k, p); } catch (e) {}
  let s = T(k); for (const a of Object.keys(p || {})) s = s.split('{' + a + '}').join(String(p[a])); return s;
};
const E = (v) => {
  try { if (typeof window !== 'undefined' && typeof window.esc === 'function') return window.esc(v); } catch (e) {}
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5];

/* ---------- 和弦 → 频率（供扫弦发声） ---------- */
function chordFreqs(pair) {
  const [pc, type] = pair || [0, 'maj'];
  if (!CHORD_TYPES[type]) return midiFreqsFor([0, 'maj']);
  return chordMidis(48 + (pc % 12), type).map((m) => midiToFreq(m));
}
function midiFreqsFor(pair) { return chordMidis(48, 'maj').map((m) => midiToFreq(m)); }

/* ---------- 预览谱面渲染（纯函数，可单测） ----------
   结构：每内容行一个 .sbp-line[data-line]；和弦行 .sbp-chords 位于
   歌词行 .sbp-lyrics 上方，用前导空格按显示列宽对齐；歌词逐字包
   <span class="sbp-word"> 以便试听时逐字高亮。 */
export function renderSheetHtml(text, opts = {}) {
  const ast = parseSheetText(text);
  const semi = Number(opts.transpose) || 0;
  const keyPc = keyToPc(ast.meta.key) ?? 0;
  const capo = Number(opts.capo ?? ast.meta.capo) || 0;
  const shape = !!opts.shape;      // 变调夹「指法视图」
  const esc = E;
  const m = ast.meta;
  const fmtChord = (raw) => {
    let name = esc(raw);
    if (semi) { try { name = esc(transposeChord(raw, semi, keyPc)); } catch (e) {} }
    if (shape && capo > 0) { try { name = esc(transposeChord(raw, capo, keyPc)); } catch (e) {} }
    return name;
  };
  /* 每行：把和弦按其列宽放到独立的上方行 */
  const lineHtml = (l) => {
    const width = l.totalWidth || 0;
    const chordRow = new Array(width + 1).fill(' ');
    for (const s of l.segments || []) {
      if (s.chord == null) continue;
      const nm = fmtChord(s.chord);
      const at = Math.min(s.col, width);
      for (let i = 0; i < nm.length && at + i <= width; i++) chordRow[at + i] = nm[i];
    }
    const chordStr = chordRow.join('').replace(/\s+$/, '');
    let lyricStr = '';
    for (const s of l.segments || []) {
      if (s.text == null) continue;
      for (const ch of s.text) lyricStr += `<span class="sbp-word">${esc(ch)}</span>`;
    }
    const rep = l.repeat ? `<span class="sbp-repeat">×${l.repeat}</span>` : '';
    return `<div class="sbp-line" data-line="${l.lineNo}"><div class="sbp-chords">${chordStr || '&nbsp;'}</div><div class="sbp-lyrics">${lyricStr}${rep}</div></div>`;
  };
  const head = `<div class="sbp-head">
      <h2>${esc(m.title || T('sheet.lib.badge'))}</h2>
      <div class="sbp-by">${esc(m.artist || '')}${m.transcriber ? ' · ' + esc(T('sheet.form.transcriber')) + ' ' + esc(m.transcriber) : ''}</div>
      <div class="sbp-meta"><span>${esc(m.key)}</span><span>${esc(m.time || '4/4')}</span><span>♩=${esc(String(m.tempo || 70))}</span><span>${capo ? T('sheet.form.capo') + ' ' + capo : ''}</span>${m.language ? `<span>${esc(m.language)}</span>` : ''}${m.style ? `<span>${esc(m.style)}</span>` : ''}${m.arrange ? `<span>${esc(m.arrange)}</span>` : ''}${(m.tags || []).map((t) => `<span class="sbl-tag">${esc(t)}</span>`).join('')}</div>
    </div>`;
  const body = ast.lines.map((l) => {
    if (l.type === 'section') return `<div class="sbp-section">${esc(l.section)}</div>`;
    if (l.type === 'rhythm') return `<div class="sbp-rhythm-badge" data-pattern="${esc(l.rhythm)}">${esc(l.rhythm)}</div>`;
    if (l.type === 'comment') return `<div class="sbp-comment">${esc(l.raw.replace(/^\{comment:/, '').replace(/\}$/, '').replace(/^#>/, ''))}</div>`;
    if (l.type === 'lyric' || l.type === 'chord-line') return lineHtml(l);
    return '';   // meta / blank 渲染隐藏
  }).join('');
  return head + (body.trim() ? body : `<div class="sbp-empty">${esc(T('sheet.ed.canvasPh'))}</div>`);
}

/* ---------- 播放器控制器 ---------- */
export const SheetPlayer = {
  playing: false,
  paused: false,
  plan: null,
  sheet: null,
  opts: {},
  speed: 1,
  transpose: 0,
  startedAt: 0,
  elapsedMs: 0,
  _timers: [],
  _raf: null,
  _host: null,        // 宿主容器（预览区或全屏 overlay）
  _controls: null,

  /* 生成播放计划（纯逻辑，可单测） */
  prepare(sheet, opts = {}) {
    const gp = expandSheetToGp(sheet, { transpose: this.transpose, displayCapo: opts.displayCapo });
    const chords = gp.harmony.chords;
    const bpb = gp.harmony.beatsPerBar || 4;
    const beats = chords.length * bpb;
    const ast = parseSheetText(sheet.text);
    const sections = [];
    let cur = null;
    for (const l of ast.lines) {
      if (l.type === 'section') { cur = { name: l.section, lineNo: l.lineNo, beat: null }; sections.push(cur); }
      else if ((l.type === 'lyric' || l.type === 'chord-line') && cur && cur.beat == null) {
        /* lineTimeline 记录的是展开后的拍位，这里取首个内容行 */
        const hit = gp.lineTimeline.find((x) => x.lineNo === l.lineNo);
        if (hit) cur.beat = hit.beat;
      }
    }
    return {
      gp, chords, bpb, beats, sections,
      tempo: gp.bpm, spb: 60 / gp.bpm,
      lineTimeline: gp.lineTimeline,
      durationSec: gp.durationSec,
    };
  },

  /* 挂载控制条（列表/编辑器共用）。
     container 只承载控制条 DOM；逐字/逐行高亮的宿主由 opts.sheetHost 指定
     （必须是包含 .sbp-line[data-line] 的谱面容器），否则回退父容器。
     V4.4 修复：早期把 container 同时当控制条与高亮宿主，innerHTML 被覆盖后
     querySelectorAll('.sbp-line') 永远为空，试听高亮静默失效。 */
  mountControls(container, sheet, opts = {}) {
    if (!container) return;
    this._host = opts.sheetHost || container.parentElement || container;
    this._sheetHost = this._host;
    const sections = (this.plan && this.plan.sections) || [];
    const chips = sections.filter((s) => s.beat != null)
      .map((s) => `<button class="sbe-mini sbp-jump" data-beat="${s.beat}">${E(s.name)}</button>`).join('');
    container.innerHTML = `
      <div class="sbp-controls" id="sbpControls">
        <button class="sbe-mini sbp-toggle">${E(T('sheet.player.play'))} ▶</button>
        <button class="sbe-mini sbp-stop">${E(T('sheet.player.stop'))}</button>
        <span class="sbe-mini sbp-speed" title="${E(T('sheet.player.speed'))}">×1</span>
        <button class="sbe-mini sbp-tp" data-d="-1">− ${E(T('sheet.player.transpose'))}</button>
        <span class="sbe-mini sbp-tp-val">0</span>
        <button class="sbe-mini sbp-tp" data-d="1">+ ${E(T('sheet.player.transpose'))}</button>
        <span class="sbp-hint">${E(T('sheet.player.hint'))}</span>
      </div>
      <div class="sbp-sections" id="sbpSections">${chips}</div>`;
    this._controls = container.querySelector('#sbpControls');
    const bind = (sel, fn) => { const el = container.querySelector(sel); if (el) el.addEventListener('click', fn); };
    bind('.sbp-toggle', () => this.toggle(sheet, opts));
    bind('.sbp-stop', () => this.stop());
    bind('.sbp-speed', () => { const i = SPEEDS.indexOf(this.speed); this.setSpeed(SPEEDS[(i + 1) % SPEEDS.length], sheet, opts); });
    container.querySelectorAll('.sbp-tp').forEach((b) => b.addEventListener('click', () => this.setTranspose(this.transpose + Number(b.dataset.d), sheet, opts)));
    container.querySelectorAll('.sbp-jump').forEach((b) => b.addEventListener('click', () => this.gotoBeat(Number(b.dataset.beat), sheet, opts)));
    this._syncControls();
  },

  _syncControls() {
    const c = this._controls;
    if (!c) return;
    const tg = c.querySelector('.sbp-toggle');
    if (tg) tg.textContent = (this.playing && !this.paused ? T('sheet.player.pause') + ' ⏸' : T('sheet.player.play') + ' ▶');
    const sp = c.querySelector('.sbp-speed');
    if (sp) { sp.textContent = '×' + this.speed; sp.classList.toggle('on', this.speed !== 1); }
    const tv = c.querySelector('.sbp-tp-val');
    if (tv) tv.textContent = (this.transpose > 0 ? '+' : '') + this.transpose;
  },

  /** 播放/暂停。speed 改变 tempo 但不改源谱。 */
  toggle(sheet, opts = {}) {
    if (this.playing) { this.pause(); return; }
    if (this.paused) { this.resume(sheet, opts); return; }
    this.start(sheet, opts);
  },

  start(sheet, opts = {}) {
    this.stop();                        // 先清干净上一轮
    this.sheet = sheet; this.opts = opts;
    this.plan = this.prepare(sheet, opts);
    this.playing = true; this.paused = false;
    this.startedAt = Date.now(); this.elapsedMs = 0;
    this._schedule(0);
    this._visual();
    this._syncControls();
  },

  /* 预排整轮拍事件；用 setTimeout 序列，teardown 一次性清空 */
  _schedule(fromBeat) {
    const p = this.plan;
    if (!p) return;
    const spb = p.spb / this.speed;
    for (let beat = Math.floor(fromBeat); beat < p.beats; beat++) {
      const bar = Math.floor(beat / p.bpb);
      const inBar = beat % p.bpb;
      const t = setTimeout(() => {
        if (!this.playing || this.paused) return;
        this._onBeat(beat, bar, inBar);
      }, Math.max(0, (beat - fromBeat) * spb * 1000));
      this._timers.push(t);
    }
    /* 结束 */
    const endT = setTimeout(() => { if (this.playing) this.stop(true); }, (p.beats - fromBeat) * spb * 1000);
    this._timers.push(endT);
  },

  _onBeat(beat, bar, inBar) {
    const p = this.plan;
    const pair = p.chords[bar] || p.chords[p.chords.length - 1] || [0, 'maj'];
    try {
      if (typeof AudioEngine !== 'undefined' && AudioEngine) {
        /* 每小节第一拍扫弦，其余拍轻扫；强拍加鼓点 */
        if (inBar === 0) {
          AudioEngine.strum(chordFreqs(pair), 'down', 0.26, 0);
          if (typeof AudioEngine.click === 'function') AudioEngine.click(true, 0);
        } else if (inBar % 2 === 0) {
          AudioEngine.strum(chordFreqs(pair), 'up', 0.14, 0);
          if (typeof AudioEngine.click === 'function') AudioEngine.click(false, 0);
        }
      }
    } catch (e) { /* 音频不可用静默降级，不影响视觉走带 */ }
    this._curBeat = beat;
    this._highlight(beat);
  },

  /* 逐行 + 逐字高亮；无 DOM 时静默跳过（Node 单测） */
  _highlight(beat) {
    const host = this._host;
    if (!host || typeof host.querySelectorAll !== 'function') return;
    const p = this.plan;
    let cur = null;
    for (const l of p.lineTimeline) if (l.beat <= beat + 1e-6) cur = l; else break;
    const lines = host.querySelectorAll('.sbp-line');
    lines.forEach((el) => el.classList.remove('playing'));
    if (!cur) return;
    const active = host.querySelector(`.sbp-line[data-line="${cur.lineNo}"]`);
    if (!active) return;
    active.classList.add('playing');
    /* 当前行内按拍进度逐字点亮 */
    const words = active.querySelectorAll('.sbp-word');
    const next = p.lineTimeline.find((l) => l.beat > cur.beat);
    const spanBeats = next ? Math.max(1, next.beat - cur.beat) : p.bpb;
    const frac = clamp((beat - cur.beat) / spanBeats, 0, 1);
    const upto = Math.round(frac * words.length);
    words.forEach((w, i) => w.classList.toggle('on', i < upto));
    /* 自动滚屏 */
    if (this.opts.autoScroll && typeof active.scrollIntoView === 'function') {
      try { active.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {}
    }
  },

  _visual() {
    /* 视觉层按拍推进（不依赖音频），保证无音频设备时也有走带反馈 */
    const p = this.plan;
    if (!p) return;
    const spb = p.spb / this.speed;
    const step = () => {
      if (!this.playing || this.paused) return;
      const beat = (Date.now() - this.startedAt) / 1000 / spb;
      this._highlight(beat);
      this._raf = setTimeout(step, 120);
    };
    this._raf = setTimeout(step, 120);
  },

  pause() {
    if (!this.playing || this.paused) return;
    this.paused = true;
    this._clearTimers();
    this.elapsedMs += Date.now() - this.startedAt;
    this._syncControls();
  },

  resume(sheet, opts = {}) {
    if (!this.paused) return;
    this.paused = false;
    this.startedAt = Date.now();
    const p = this.plan;
    const spb = p.spb / this.speed;
    const fromBeat = this.elapsedMs / 1000 / spb;
    this._curBeat = fromBeat;
    this._schedule(fromBeat);
    this._visual();
    this._syncControls();
  },

  setSpeed(x, sheet, opts = {}) {
    const wasPlaying = this.playing && !this.paused;
    const p = this.plan;
    let atBeat = 0;
    if (p && wasPlaying) atBeat = (Date.now() - this.startedAt) / 1000 / (p.spb / this.speed);
    this.speed = x;
    if (wasPlaying) { this._clearTimers(); this.startedAt = Date.now() - atBeat * (p.spb / x) * 1000; this._schedule(atBeat); this._visual(); }
    this._syncControls();
  },

  setTranspose(n, sheet, opts = {}) {
    this.transpose = clamp(n, -12, 12);
    /* 移调只重建计划与预览渲染，不改源文本 */
    if (sheet && this._host) {
      this.plan = this.prepare(sheet, opts);
      /* 预览宿主本身常就是 .sbe-preview / .sbp-sheet，不能只向下查找 */
      const selfHit = this._host.matches && this._host.matches('.sbe-preview, .sbp-sheet');
      const pv = opts.previewEl || (selfHit ? this._host :
        (this._host.querySelector ? this._host.querySelector('.sbe-preview, .sbp-sheet') : null)) || this._host;
      if (typeof opts.rerender === 'function') opts.rerender(pv, { transpose: this.transpose, capo: opts.capo, shape: opts.shape });
    }
    this._syncControls();
  },

  gotoBeat(beat, sheet, opts = {}) {
    if (!this.playing) { this.start(sheet, opts); }
    this._clearTimers();
    this.startedAt = Date.now() - beat * (this.plan.spb / this.speed) * 1000;
    this.elapsedMs = beat * (this.plan.spb / this.speed) * 1000;
    this._curBeat = beat;
    this.paused = false; this.playing = true;
    this._schedule(beat);
    this._visual();
    this._syncControls();
  },

  _clearTimers() {
    this._timers.forEach(clearTimeout); this._timers = [];
    if (this._raf) { clearTimeout(this._raf); this._raf = null; }
  },

  /** @param {boolean} finished 是否正常播完（用于上报判断） */
  stop(finished = false) {
    const dur = this.playing ? this.elapsedMs + (this.paused ? 0 : Date.now() - this.startedAt) : 0;
    this._clearTimers();
    this.playing = false; this.paused = false;
    this._curBeat = 0;
    this._syncControls();
    if (this._host && typeof this._host.querySelectorAll === 'function') {
      this._host.querySelectorAll('.sbp-line.playing').forEach((e) => e.classList.remove('playing'));
      this._host.querySelectorAll('.sbp-word.on').forEach((e) => e.classList.remove('on'));
    }
    /* F-12：一次试听 ≥30s 记一条练习会话 */
    if (finished && dur >= 30000) {
      try {
        const PS = (typeof window !== 'undefined' && window.PracticeStore) || (typeof PracticeStore !== 'undefined' ? PracticeStore : null);
        if (PS && typeof PS.addSession === 'function') {
          PS.addSession({ module: 'sheetPlayer', durationMs: dur, targetBpm: this.plan && this.plan.tempo, meta: { sheetId: this.sheet && this.sheet.id, patternId: this.sheet && this.sheet.patternId, transpose: this.transpose } });
        }
      } catch (e) {}
    }
  },

  teardown() { this.stop(); this._host = null; this._controls = null; this.plan = null; this.sheet = null; },
};

if (typeof window !== 'undefined') window.SheetPlayer = SheetPlayer;
/* 语言切换：只重绘控制条文案，不打断正在播放的走带 */
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('gs:lang', () => {
    try { SheetPlayer._syncControls(); } catch (e) {}
  });
}
export default SheetPlayer;
