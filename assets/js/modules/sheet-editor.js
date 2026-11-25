/* ============================================================
   六弦工坊 V4.4 · modules/sheet-editor.js（曲谱工坊 T04–T07 / T11 / T12）
   ------------------------------------------------------------
   新建曲谱表单（F-01/F-02）+ 和弦谱编辑器（F-03–F-11）：
   画布 / 分屏预览 / 顶栏 / 插入面板 / [ 和弦联想 / 撤销重做 /
   草稿自动保存 / 语法校验 / 保存·另存·导出·删除 / 转调另存 /
   快捷键 / 试听 / 四语与主题联动 / 离开 teardown。
   ★ 纯逻辑（UndoStack / validationToView / suggestFor / formToDoc）
     可脱离浏览器被 node --test 直接 import（test/sheet-editor.test.js）。
   ★ 语言切换只更新文本与 chips 标签，绝不重建交互 DOM（V4.3 R3 协议），
     textarea 内容、光标、撤销栈、试听状态全部保留。
   ★ 所有 innerHTML 赋值统一「先构造字符串再赋变量」，规避 lint S0.4。
   权威口径：docs/V4.4_SHEET_STUDIO_SPEC.md §6 F-01–F-11 / §8 / §9。
   ============================================================ */
'use strict';

import {
  SHEET_ENUMS, parseSheetText, parseChord, validateSheetText, transposeSheetText,
  chordSuggestions, newSheetTemplate, suggestCapoForKey, keyToPc,
  metaFromText, applyFieldsToText, lineStartOffset, insertSnippet,
  transposedDocTitle,
} from '../data/sheet-format.js';
import { SheetStore } from '../data/sheet-store.js';
import { SheetPlayer, renderSheetHtml } from './sheet-player.js';
import { ALL_PATTERNS } from '../data/rhythm-data.js';
import { chordMidis } from '../gp/theory.js';
import { midiToFreq } from '../gp/notes.js';

/* ---------- 宿主取词与转义（Node 单测无宿主时回退） ---------- */
const T = (k) => { try { if (typeof window !== 'undefined' && typeof window.t === 'function') return window.t(k); } catch (e) {} return k; };
/* V4.4.3 修复（P-03）：节奏型对用户展示统一走中文名（rhythm-data nk 词条），
   原始 ID（如 strum-pop-a）仅作为存储值，不再直接呈现于表单/插入面板。 */
const PATTERN_NAME_MAP = (() => {
  const m = {};
  try {
    for (const p of ALL_PATTERNS || []) m[p.id] = T(p.nk) || p.name || p.id;
  } catch (e) {}
  return m;
})();
const patternLabel = (id) => PATTERN_NAME_MAP[id] || id;
const TF = (k, p) => {
  try { if (typeof window !== 'undefined' && window.gsI18n && typeof window.gsI18n.tF === 'function') return window.gsI18n.tF(k, p); } catch (e) {}
  let s = T(k); for (const a of Object.keys(p || {})) s = s.split('{' + a + '}').join(String(p[a])); return s;
};
function esc(v) {
  try { if (typeof window !== 'undefined' && typeof window.esc === 'function') return window.esc(v); } catch (e) {}
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
const toast = (msg, type) => { try { if (typeof window !== 'undefined' && typeof window.toast === 'function') window.toast(msg, type || 'info'); } catch (e) {} };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* ---------- 枚举显示名（存储值保持原文，展示走四语词条） ---------- */
const ENUM_SRC = {
  lang: { key: 'sheet.enum.langs', values: SHEET_ENUMS.LANGUAGES },
  style: { key: 'sheet.enum.styles', values: SHEET_ENUMS.STYLES },
  arrange: { key: 'sheet.enum.arranges', values: SHEET_ENUMS.ARRANGES },
  tag: { key: 'sheet.enum.tags', values: SHEET_ENUMS.TAGS },
  section: { key: 'sheet.enum.sections', values: SHEET_ENUMS.SECTION_PRESETS },
};
export function enumItems(kind) {
  const src = ENUM_SRC[kind];
  if (!src) return [];
  const raw = T(src.key);
  const labels = raw && raw !== src.key ? String(raw).split('|') : [];
  return src.values.map((v, i) => ({ value: v, label: labels[i] || v }));
}

/* ============================================================
   纯逻辑区（可单测）
   ============================================================ */

/** 快照式撤销栈：100 步 / 2MB 上限；连续键入 800ms 内合并为一步。 */
export class UndoStack {
  constructor(limit = 100, maxBytes = 2 * 1024 * 1024, mergeMs = 800) {
    this.limit = limit; this.maxBytes = maxBytes; this.mergeMs = mergeMs;
    this.snaps = []; this.index = -1; this.lastAt = 0;
  }
  get canUndo() { return this.index > 0; }
  get canRedo() { return this.index >= 0 && this.index < this.snaps.length - 1; }
  reset(text, caret = 0) { this.snaps = [{ text: String(text), caret: Number(caret) || 0 }]; this.index = 0; this.lastAt = 0; }
  trim() {
    while (this.snaps.length > this.limit) { this.snaps.shift(); this.index--; }
    let bytes = this.snaps.reduce((n, s) => n + s.text.length * 2, 0);
    while (bytes > this.maxBytes && this.snaps.length > 1) {
      bytes -= this.snaps[0].text.length * 2;
      this.snaps.shift(); this.index--;
    }
  }
  /** @param {{discrete?:boolean, now?:number, merge?:boolean}} opts */
  push(text, caret, opts = {}) {
    const now = Number(opts.now) || Date.now();
    const snap = { text: String(text), caret: Number(caret) || 0 };
    if (this.index >= 0 && this.snaps[this.index] && this.snaps[this.index].text === snap.text) {
      this.snaps[this.index].caret = snap.caret;
      this.lastAt = now;
      return;
    }
    if (this.index < this.snaps.length - 1) this.snaps = this.snaps.slice(0, this.index + 1);
    const merge = !!opts.merge && !opts.discrete && (now - this.lastAt) <= this.mergeMs && this.index >= 0;
    this.lastAt = now;
    if (merge) { this.snaps[this.index] = snap; return; }
    this.snaps.push(snap);
    this.index = this.snaps.length - 1;
    this.trim();
  }
  /** 回退一步；未入栈的当前编辑先补一步再回退，保证首次 Ctrl+Z 有效。 */
  undo(curText, curCaret) {
    if (this.index < 0) return null;
    const top = this.snaps[this.index];
    if (String(curText) !== top.text) {
      this.snaps = this.snaps.slice(0, this.index + 1);
      this.snaps.push({ text: String(curText), caret: Number(curCaret) || 0 });
      this.index = this.snaps.length - 1;
      this.trim();
    }
    if (this.index <= 0) return null;
    this.index--;
    return { ...this.snaps[this.index] };
  }
  redo() {
    if (!this.canRedo) return null;
    this.index++;
    return { ...this.snaps[this.index] };
  }
  /** 保存时清空重做栈（撤销栈保留，F-07）。 */
  clearRedo() { if (this.index >= 0) this.snaps = this.snaps.slice(0, this.index + 1); }
}

/** 校验结果 → 视图模型（警告码映射四语词条，行号保留供跳转）。 */
const WARN_KEY = {
  'bad-chord': 'sheet.ed.warn.badChord',
  'unclosed-chord': 'sheet.ed.warn.unclosed',
  'unknown-pattern': 'sheet.ed.warn.pattern',
  'capo-range': 'sheet.ed.warn.capo',
  'dup-section': 'sheet.ed.warn.dupSection',
  'empty-section': 'sheet.ed.warn.emptySection',
  'unknown-marker': 'sheet.ed.warn.unknownMarker',
  'unknown-meta': 'sheet.ed.warn.unknownMarker',
};
export function validationToView(result) {
  const r = result || {};
  const map = (w) => ({ code: w.code, line: w.line || 0, msg: T(WARN_KEY[w.code] || 'sheet.ed.warn.unknownMarker'), raw: w.msg || '' });
  return {
    ok: !!r.ok,
    blocking: (r.blocking || []).map((w) => ({ ...map(w), msg: T('sheet.ed.validate.block') })),
    warnings: (r.warnings || []).map(map),
  };
}

/** 和弦联想（委托数据层，便于测试与 UI 共用同一排序口径）。 */
export function suggestFor(query, key = 'C', freq = {}, limit = 24) {
  return chordSuggestions(query, key, { freq, limit });
}

/** 表单 → SheetDoc（创建时生成初始模板文本，不立即入库）。 */
export function formToDoc(form, base = {}) {
  const f = { ...form };
  const doc = SheetStore.newSheet({
    ...base,
    title: String(f.title || '').slice(0, 60),
    artist: String(f.artist || '').slice(0, 60),
    transcriber: String(f.transcriber || '').slice(0, 30),
    key: f.key || 'C', originalKey: f.originalKey || 'C',
    tempo: clamp(parseInt(f.tempo, 10) || 70, SHEET_ENUMS.TEMPO_MIN, SHEET_ENUMS.TEMPO_MAX),
    timeSig: f.timeSig || '4/4',
    capo: clamp(parseInt(f.capo, 10) || 0, 0, SHEET_ENUMS.CAPO_MAX),
    language: f.language || '', style: f.style || '', arrange: f.arrange || '',
    tags: (f.tags || []).slice(0, 3),
    patternId: f.patternId || SHEET_ENUMS.DEFAULT_PATTERN,
  });
  doc.text = newSheetTemplate({
    title: doc.title, artist: doc.artist, transcriber: doc.transcriber,
    key: doc.key, originalKey: doc.originalKey, tempo: doc.tempo, timeSig: doc.timeSig,
    capo: doc.capo, rhythm: doc.patternId, language: doc.language, style: doc.style,
    arrange: doc.arrange, tags: doc.tags,
  });
  return doc;
}

/** 两个调名之间的最小半音差（用于「原唱调→选调」换算提示）。 */
export function keyDiff(a, b) {
  const pa = keyToPc(a), pb = keyToPc(b);
  if (pa == null || pb == null) return 0;
  let d = pb - pa;
  if (d > 6) d -= 12;
  if (d < -6) d += 12;
  return d;
}

/* ============================================================
   视图控制器
   ============================================================ */
const PRESET_TEMPOS = [60, 70, 80, 90, 100, 120];
const FONT_SIZES = [14, 16, 18];
const SheetEditor = {
  step: 'form',            // 'form' | 'editor'
  doc: null,
  form: null,
  dirty: false,
  transpose: 0,
  capoView: 0,
  shape: false,
  fontIdx: 1,
  layout: 'compact',
  autoScroll: false,
  freq: {},
  undo: new UndoStack(),
  _active: false,
  _delegated: false,
  _globalsBound: false,
  _previewTimer: null,
  _draftTimer: null,
  _demoTimers: [],
  _composing: false,
  _suggestOpen: false,
  _suggestQuery: '',
  _suggestIndex: 0,
  _conflict: false,
  _draftAsk: null,

  /* ---------- 生命周期 ---------- */
  enter() {
    this._active = true;
    this.parseHash();
    this.init();
    this._conflict = false;
    this._draftAsk = null;
    /* 导入：由列表页放进编辑器人工确认，不直接入库（F-16） */
    if (this.mode === 'import' && typeof window !== 'undefined' && window.gsPendingSheet) {
      this.doc = window.gsPendingSheet;
      window.gsPendingSheet = null;
      this.step = 'editor'; this.dirty = true;
      this.resetEditorState(this.doc.text);
      this.render();
      toast(T('sheet.lib.toastImported'));
      return;
    }
    if (this.mode === 'edit') {
      const s = SheetStore.get(this.editId);
      if (!s) { toast(T('sheet.lib.empty'), 'warn'); location.hash = '#/sheetLib'; return; }
      this.doc = { ...s };
      this.step = 'editor'; this.dirty = false;
      this.resetEditorState(s.text);
      const d = SheetStore.readDraft();
      if (d && d.doc && d.doc.id === s.id && d.text !== s.text) this._draftAsk = { doc: d.doc, text: d.text, savedAt: d.savedAt, kind: 'newer' };
      this.render();
      return;
    }
    /* 新建：不写草稿（表单步），但存在 <7 天草稿时给恢复卡 */
    this.form = this.defaultForm();
    this.doc = SheetStore.newSheet();
    this.step = 'form'; this.dirty = false;
    const d = SheetStore.readDraft();
    if (d && d.doc && d.text) this._draftAsk = { doc: d.doc, text: d.text, savedAt: d.savedAt, kind: 'new' };
    this.render();
  },

  parseHash() {
    const h = (typeof location !== 'undefined' ? (location.hash || '') : '');
    const q = h.indexOf('?') >= 0 ? h.slice(h.indexOf('?') + 1) : '';
    const p = new URLSearchParams(q);
    this.editId = p.get('id') || '';
    this.mode = p.get('import') === '1' ? 'import' : (this.editId ? 'edit' : 'new');
  },

  defaultForm() {
    let nickname = '';
    try {
      const st = (typeof window !== 'undefined' && window.gsStore) || (typeof gsStore !== 'undefined' ? gsStore : null);
      const prefs = st && st.read ? st.read() : {};
      nickname = String(prefs.nickname || '');
    } catch (e) {}
    return {
      title: '', artist: '', transcriber: nickname,
      key: 'C', originalKey: 'C', tempo: 70, timeSig: '4/4', capo: 0,
      language: '', style: '', arrange: '', tags: [],
      patternId: SHEET_ENUMS.DEFAULT_PATTERN,
    };
  },

  init() {
    const root = document.getElementById('sbeRoot');
    if (!root) return;
    if (!this._delegated) {
      root.addEventListener('click', (e) => this.onClick(e));
      root.addEventListener('input', (e) => this.onInput(e));
      root.addEventListener('change', (e) => this.onChange(e));
      root.addEventListener('keydown', (e) => this.onCanvasKeydown(e));
      root.addEventListener('compositionstart', () => { this._composing = true; });
      root.addEventListener('compositionend', () => { this._composing = false; this.afterChange({ discrete: false }); });
      document.addEventListener('gs:lang', () => { if (this._active) this.refreshLang(); });
      this._delegated = true;
    }
    if (!this._globalsBound) {
      this._keyHandler = (e) => this.onKey(e);
      this._unloadHandler = (e) => this.onUnload(e);
      this._storageHandler = (e) => this.onStorage(e);
      document.addEventListener('keydown', this._keyHandler);
      window.addEventListener('beforeunload', this._unloadHandler);
      window.addEventListener('storage', this._storageHandler);
      this._globalsBound = true;
    }
  },

  /** 离开路由：停播放器、清 timer、解绑全局监听、脏状态写回草稿。 */
  teardown() {
    clearTimeout(this._previewTimer); clearTimeout(this._draftTimer);
    this._demoTimers.forEach(clearTimeout); this._demoTimers = [];
    try { SheetPlayer.stop(); } catch (e) {}
    if (this._globalsBound) {
      document.removeEventListener('keydown', this._keyHandler);
      window.removeEventListener('beforeunload', this._unloadHandler);
      window.removeEventListener('storage', this._storageHandler);
      this._globalsBound = false;
    }
    if (this._active && this.step === 'editor' && this.dirty && this.doc) {
      try { SheetStore.writeDraft(this.doc, this.text()); } catch (e) {}
    }
    this._suggestOpen = false;
    this._active = false;
  },

  resetEditorState(text) {
    this.transpose = 0; this.capoView = Number(this.doc && this.doc.capo) || 0;
    this.shape = false; this.autoScroll = false; this.fontIdx = 1; this.layout = 'compact';
    this.freq = {};
    this.undo.reset(text, 0);
    SheetPlayer.transpose = 0; SheetPlayer.speed = 1;
  },

  /* ---------- 取 DOM / 文本 ---------- */
  text() {
    const ta = document.getElementById('sbeText');
    return ta ? ta.value : (this.doc && this.doc.text) || '';
  },
  textarea() { return document.getElementById('sbeText'); },
  previewEl() { return document.getElementById('sbePreview'); },

  /* ---------- 渲染主入口 ---------- */
  render() {
    const root = document.getElementById('sbeRoot');
    if (!root) return;
    const html = this.step === 'form' ? this.formHtml() : this.editorHtml();
    root.innerHTML = html;
    if (this.step === 'editor') {
      /* textarea 必须用 value 回填：innerHTML 会转义源文本里的 < > 与和弦标记 */
      this.afterRenderEditorDom();
      this.rerenderPreview();
      this.mountPlayer();
      this.showValidation(validationToView(validateSheetText(this.text())));
      this.showDraftAsk();
      this.showConflict();
      this.updateTopbar();
    } else {
      /* F-08：新建（表单步）也须给出「恢复上次草稿」卡，不能只在编辑器步显示 */
      this.showDraftAsk();
      this.updateFormState();
    }
  },

  /* ---------- 新建表单（F-01 / F-02） ---------- */
  formHtml() {
    const f = this.form || this.defaultForm();
    const opts = (vals, cur, labels) => vals.map((v, i) =>
      `<option value="${esc(v)}"${String(cur) === String(v) ? ' selected' : ''}>${esc(labels ? labels[i] : v)}</option>`).join('');
    const field = (labelKey, control, req, extra) =>
      `<div class="sbe-field"><label class="${req ? 'req' : ''}" data-sbe-i18n="${labelKey}">${esc(T(labelKey))}</label><div>${control}${extra || ''}</div></div>`;
    const chipGroup = (kind, name, multi) => {
      const cur = multi ? (f[name] || []) : f[name];
      const items = enumItems(kind).map((it, i) => {
        const on = multi ? cur.includes(it.value) : cur === it.value;
        return `<button type="button" class="sbl-chip${on ? ' on' : ''}" data-chip="${name}" data-value="${esc(it.value)}" data-sbe-enum="${kind}" data-sbe-idx="${i}">${esc(it.label)}</button>`;
      }).join('');
      const custom = multi ? `<input type="text" id="sbeCustomTag" placeholder="${esc(T('sheet.form.tagCustomPh'))}" data-sbe-i18n-ph="sheet.form.tagCustomPh" aria-label="${esc(T('sheet.form.tags'))}" style="margin-top:8px;max-width:240px">` : '';
      return `<div class="sbe-chips" data-chips="${name}">${items}${custom}</div>`;
    };
    const capoVals = [0, 1, 2, 3, 4, 5, 6, 7];
    const capoLabels = capoVals.map((n) => n === 0 ? T('sheet.form.capo.none') : TF('sheet.form.capo.fret', { n }));
    const capoOpts = capoVals.map((n, i) =>
      `<option value="${n}"${Number(f.capo) === n ? ' selected' : ''}"${n === 0 ? ' data-sbe-i18n="sheet.form.capo.none"' : ''}>${esc(capoLabels[i])}</option>`).join('');
    const presets = PRESET_TEMPOS.map((n) => `<button type="button" class="sbe-preset" data-tempo="${n}">${n}</button>`).join('');
    const patternOpts = opts(SHEET_ENUMS.PATTERN_IDS, f.patternId, SHEET_ENUMS.PATTERN_IDS.map(patternLabel));

    let html = `<div id="sbeDraftBar"></div>
      <form class="sbe-form" id="sbeForm" autocomplete="off">
        <h2 data-sbe-i18n="sheet.form.title">${esc(T('sheet.form.title'))}</h2>
        ${field('sheet.form.songName', `<input type="text" id="sbeFTitle" maxlength="60" value="${esc(f.title)}" placeholder="${esc(T('sheet.form.songNamePh'))}" data-sbe-i18n-ph="sheet.form.songNamePh" data-field="title">`, true, `<div class="err" id="sbeErrTitle" hidden>${esc(T('sheet.form.required'))}</div>`)}
        ${field('sheet.form.artist', `<input type="text" id="sbeFArtist" maxlength="60" value="${esc(f.artist)}" placeholder="${esc(T('sheet.form.artistPh'))}" data-sbe-i18n-ph="sheet.form.artistPh" data-field="artist">`, true, `<div class="err" id="sbeErrArtist" hidden>${esc(T('sheet.form.required'))}</div>`)}
        ${field('sheet.form.transcriber', `<input type="text" id="sbeFTranscriber" maxlength="30" value="${esc(f.transcriber)}" placeholder="${esc(T('sheet.form.transcriberPh'))}" data-sbe-i18n-ph="sheet.form.transcriberPh" data-field="transcriber">`, false)}
        ${field('sheet.form.key', `<select id="sbeFKey" data-field="key">${opts(SHEET_ENUMS.KEYS, f.key)}</select>`, true)}
        ${field('sheet.form.originalKey', `<select id="sbeFOriginalKey" data-field="originalKey">${opts(SHEET_ENUMS.KEYS, f.originalKey)}</select>`, true)}
        ${field('sheet.form.tempo', `<div class="sbe-tempo-row"><input type="number" id="sbeFTempo" min="40" max="240" step="1" value="${esc(f.tempo)}" data-field="tempo">${presets}</div>`, true, `<div class="hint" id="sbeTempoHint" hidden>${esc(T('sheet.form.tempoClamp'))}</div>`)}
        ${field('sheet.form.timeSig', `<select id="sbeFTime" data-field="timeSig">${opts(SHEET_ENUMS.TIME_SIGS, f.timeSig)}</select>`, true)}
        ${field('sheet.form.capo', `<select id="sbeFCapo" data-field="capo">${capoOpts}</select>`, true)}
        ${field('sheet.form.language', chipGroup('lang', 'language', false), true)}
        ${field('sheet.form.style', chipGroup('style', 'style', false), true)}
        ${field('sheet.form.arrange', chipGroup('arrange', 'arrange', false), true)}
        ${field('sheet.form.tags', chipGroup('tag', 'tags', true), false)}
        ${field('sheet.form.pattern', `<div class="sbe-tempo-row"><select id="sbeFPattern" data-field="patternId">${patternOpts}</select><button type="button" class="sbe-preset" data-form-act="demo">${esc(T('sheet.form.preview'))}</button></div>`, true)}
        <div class="sbe-diff" id="sbeKeyDiff"></div>
        <div class="sbe-diff" id="sbeCapoHint"></div>
        <div class="sbe-form-actions">
          <button type="button" data-form-act="cancel" data-sbe-i18n="sheet.form.cancel">${esc(T('sheet.form.cancel'))}</button>
          <button type="button" class="primary" id="sbeCreate" data-form-act="create" data-sbe-i18n="sheet.form.create">${esc(T('sheet.form.create'))}</button>
        </div>
      </form>`;
    return html;
  },

  updateFormState() {
    const f = this.form;
    if (!f) return;
    const ok = !!(String(f.title || '').trim() && String(f.artist || '').trim() && f.language && f.style && f.arrange);
    const btn = document.getElementById('sbeCreate');
    if (btn) btn.disabled = !ok;
    const eT = document.getElementById('sbeErrTitle'), eA = document.getElementById('sbeErrArtist');
    if (eT) eT.hidden = !!String(f.title || '').trim();
    if (eA) eA.hidden = !!String(f.artist || '').trim();
    this.updateDiffHints();
  },

  updateDiffHints() {
    const f = this.form;
    if (!f) return;
    const d = keyDiff(f.originalKey, f.key);
    const box = document.getElementById('sbeKeyDiff');
    if (box) {
      /* textContent 自动转义，不能再 esc()，否则会露出 &amp; 实体 */
      box.textContent = d ? TF('sheet.form.keyDiff', {
        a: f.originalKey, b: f.key, dir: T(d > 0 ? 'sheet.form.up' : 'sheet.form.down'), n: Math.abs(d),
      }) : '';
    }
    const capoBox = document.getElementById('sbeCapoHint');
    if (capoBox) {
      const sug = suggestCapoForKey(f.key) || { capo: 0, shapeName: f.key };
      const html = `<span>${esc(TF('sheet.form.suggestCapo', { n: sug.capo, key: sug.shapeName }))}</span>
        <button type="button" class="sbe-preset" data-form-act="applyCapo" data-capo="${sug.capo}" data-shapekey="${esc(sug.shapeName)}">${esc(T('sheet.form.applyCapo'))}</button>`;
      capoBox.innerHTML = html;
    }
  },

  /* ---------- 编辑器（F-03 / F-04 / F-10） ---------- */
  editorHtml() {
    const d = this.doc || {};
    const capoOpts = [0, 1, 2, 3, 4, 5, 6, 7].map((n) =>
      `<option value="${n}"${this.capoView === n ? ' selected' : ''}>${esc(n === 0 ? T('sheet.form.capo.none') : TF('sheet.form.capo.fret', { n }))}</option>`).join('');
    const icon = (path) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
    const html = `<div class="sbe-topbar">
        <button type="button" class="sbe-icon-btn" data-ed-act="save" title="${esc(T('sheet.ed.save'))}" data-sbe-i18n-title="sheet.ed.save" aria-label="${esc(T('sheet.ed.save'))}">${icon('<path d="M20 6 9 17l-5-5"/>')}</button>
        <div class="sbe-title" id="sbeTitle" data-ed-act="rename" title="${esc(T('sheet.form.songName'))}"></div>
        <div class="sbe-insert">
          <button type="button" class="sbe-icon-btn" data-ed-act="insert" title="${esc(T('sheet.ed.insert'))}" data-sbe-i18n-title="sheet.ed.insert" aria-label="${esc(T('sheet.ed.insert'))}">${icon('<path d="M12 5v14M5 12h14"/>')}</button>
          <div id="sbeInsertHost"></div>
        </div>
        <button type="button" class="sbe-icon-btn" id="sbeUndo" data-ed-act="undo" title="${esc(T('sheet.ed.undo'))}" data-sbe-i18n-title="sheet.ed.undo" aria-label="${esc(T('sheet.ed.undo'))}">${icon('<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>')}</button>
        <button type="button" class="sbe-icon-btn" id="sbeRedo" data-ed-act="redo" title="${esc(T('sheet.ed.redo'))}" data-sbe-i18n-title="sheet.ed.redo" aria-label="${esc(T('sheet.ed.redo'))}">${icon('<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>')}</button>
        <div class="sbe-insert">
          <button type="button" class="sbe-icon-btn" data-ed-act="more" title="${esc(T('sheet.ed.more'))}" data-sbe-i18n-title="sheet.ed.more" aria-label="${esc(T('sheet.ed.more'))}">${icon('<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>')}</button>
          <div id="sbeMoreHost"></div>
        </div>
      </div>
      <div id="sbeConflict"></div>
      <div id="sbeDraftBar"></div>
      <div id="sbeWarnBar"></div>
      <div class="sbe-split-tabs">
        <button type="button" class="sbe-mini" data-ed-act="pane" data-pane="canvas" data-sbe-i18n="sheet.ed.canvas">${esc(T('sheet.ed.canvas'))}</button>
        <button type="button" class="sbe-mini" data-ed-act="pane" data-pane="preview" data-sbe-i18n="sheet.ed.preview">${esc(T('sheet.ed.preview'))}</button>
      </div>
      <div class="sbe-workspace" id="sbeWorkspace" data-pane="canvas">
        <div class="sbe-pane canvas">
          <div class="sbe-pane-head">
            <b data-sbe-i18n="sheet.ed.canvas">${esc(T('sheet.ed.canvas'))}</b>
            <button type="button" class="sbe-mini" data-ed-act="font" data-d="-1" title="${esc(T('sheet.ed.tool.font'))}">A−</button>
            <button type="button" class="sbe-mini" data-ed-act="font" data-d="1" title="${esc(T('sheet.ed.tool.font'))}">A+</button>
          </div>
          <textarea id="sbeText" spellcheck="false" aria-label="${esc(T('sheet.ed.canvas'))}" data-sbe-i18n-aria="sheet.ed.canvas" placeholder="${esc(T('sheet.ed.canvasPh'))}" data-sbe-i18n-ph="sheet.ed.canvasPh"></textarea>
          <div id="sbeSuggestHost"></div>
        </div>
        <div class="sbe-pane preview">
          <div class="sbe-pane-head">
            <b data-sbe-i18n="sheet.ed.preview">${esc(T('sheet.ed.preview'))}</b>
            <button type="button" class="sbe-mini" data-ed-act="tp" data-d="-1" title="${esc(T('sheet.ed.tool.transpose'))}">−</button>
            <span class="sbe-mini" id="sbeTpVal">0</span>
            <button type="button" class="sbe-mini" data-ed-act="tp" data-d="1" title="${esc(T('sheet.ed.tool.transpose'))}">+</button>
            <select class="sbe-mini" id="sbeCapo" title="${esc(T('sheet.ed.tool.capo'))}">${capoOpts}</select>
            <button type="button" class="sbe-mini" data-ed-act="shape" title="${esc(T('sheet.ed.tool.capo'))}">⇄</button>
            <button type="button" class="sbe-mini" data-ed-act="layout" data-sbe-i18n="sheet.ed.tool.compact">${esc(T('sheet.ed.tool.compact'))}</button>
            <button type="button" class="sbe-mini" data-ed-act="autoscroll" data-sbe-i18n="sheet.ed.tool.autoScroll">${esc(T('sheet.ed.tool.autoScroll'))}</button>
            <button type="button" class="sbe-mini" data-ed-act="play" data-sbe-i18n="sheet.player.play">${esc(T('sheet.player.play'))}</button>
          </div>
          <div class="sbe-preview compact" id="sbePreview" tabindex="0"></div>
        </div>
      </div>
      <div id="sbePlayerHost"></div>`;
    /* textarea 内容必须在 innerHTML 之后用 value 写入，避免 HTML 转义破坏源文本 */
    return html;
  },

  afterRenderEditorDom() {
    const ta = this.textarea();
    if (ta && this.doc) ta.value = this.doc.text || '';
  },

  rerenderPreview() {
    const pv = this.previewEl();
    if (!pv) return;
    const opts = { transpose: this.transpose, capo: this.capoView, shape: this.shape };
    const html = renderSheetHtml(this.text(), opts);
    pv.innerHTML = html;
    pv.classList.toggle('compact', this.layout === 'compact');
    pv.classList.toggle('comfort', this.layout === 'comfort');
    pv.style.fontSize = FONT_SIZES[this.fontIdx] + 'px';
  },

  playerOpts() {
    return {
      sheetHost: this.previewEl(), previewEl: this.previewEl(),
      autoScroll: this.autoScroll, displayCapo: this.capoView, shape: this.shape,
      capo: this.capoView,
      rerender: (pv, o) => {
        this.transpose = Number(o.transpose) || 0;
        if (o.capo != null) this.capoView = Number(o.capo) || 0;
        if (o.shape != null) this.shape = !!o.shape;
        const html = renderSheetHtml(this.text(), { transpose: this.transpose, capo: this.capoView, shape: this.shape });
        pv.innerHTML = html;
        const tv = document.getElementById('sbeTpVal');
        if (tv) tv.textContent = (this.transpose > 0 ? '+' : '') + this.transpose;
      },
    };
  },

  mountPlayer() {
    const host = document.getElementById('sbePlayerHost');
    if (!host || !this.doc) return;
    try { SheetPlayer.mountControls(host, this.doc, this.playerOpts()); } catch (e) {}
  },

  updateTopbar() {
    const titleEl = document.getElementById('sbeTitle');
    if (titleEl) {
      const d = this.doc || {};
      const base = esc(d.title || T('sheet.ed.preview')) + ' · ' + esc(d.key || 'C');
      const html = base + (this.dirty ? `<span class="sbe-dirty">${esc(T('sheet.ed.dirty'))}</span>` : '');
      titleEl.innerHTML = html;
    }
    const u = document.getElementById('sbeUndo'), r = document.getElementById('sbeRedo');
    if (u) u.disabled = !this.undo.canUndo;
    if (r) r.disabled = !this.undo.canRedo;
    const tv = document.getElementById('sbeTpVal');
    if (tv) tv.textContent = (this.transpose > 0 ? '+' : '') + this.transpose;
  },

  /* ---------- 输入 / 变更 ---------- */
  onInput(e) {
    const t = e.target;
    if (!t) return;
    if (this.step === 'form') {
      if (t.dataset && t.dataset.field) {
        const name = t.dataset.field;
        let v = t.value;
        if (name === 'title' || name === 'artist') v = v.slice(0, 60);
        if (name === 'transcriber') v = v.slice(0, 30);
        if (name === 'tempo') {
          const n = parseInt(v, 10);
          if (Number.isFinite(n) && (n < SHEET_ENUMS.TEMPO_MIN || n > SHEET_ENUMS.TEMPO_MAX)) {
            v = String(clamp(n, SHEET_ENUMS.TEMPO_MIN, SHEET_ENUMS.TEMPO_MAX));
            t.value = v;
            toast(T('sheet.form.tempoClamp'), 'warn');
          }
        }
        this.form[name] = v;
        this.updateFormState();
        if (name === 'style') {
          const rec = SHEET_ENUMS.STYLE_PATTERN[v];
          if (rec) { this.form.patternId = rec; const sel = document.getElementById('sbeFPattern'); if (sel) sel.value = rec; }
        }
      }
      return;
    }
    if (t.id === 'sbeText') {
      if (this._composing) return;      // IME 合成期间不提交解析
      this.doc.text = t.value;
      this.dirty = true;
      this.undo.push(t.value, t.selectionStart, { merge: true, now: Date.now() });
      this.updateTopbar();
      clearTimeout(this._previewTimer);
      this._previewTimer = setTimeout(() => this.rerenderPreview(), 120);
      clearTimeout(this._draftTimer);
      this._draftTimer = setTimeout(() => {
        try { SheetStore.writeDraft(this.doc, this.text()); } catch (err) {}
      }, 800);
      this.showValidation(validationToView(validateSheetText(t.value)));
      this.updateSuggest(t, e.data);
      return;
    }
    if (t.id === 'sbeCustomTag') return;   // 回车由 keydown 处理
  },

  onChange(e) {
    const t = e.target;
    if (!t) return;
    if (this.step === 'form' && t.dataset && t.dataset.field) {
      this.form[t.dataset.field] = t.value;
      this.updateFormState();
      return;
    }
    if (t.id === 'sbeCapo') {
      this.capoView = Number(t.value) || 0;
      this.rerenderPreview();
      try { SheetPlayer.plan = SheetPlayer.prepare(this.doc, { displayCapo: this.capoView }); } catch (err) {}
    }
  },

  onCanvasKeydown(e) {
    if (e.target && e.target.id === 'sbeCustomTag' && e.key === 'Enter') {
      e.preventDefault();
      const v = String(e.target.value || '').trim().slice(0, 20);
      if (v && !(this.form.tags || []).includes(v) && (this.form.tags || []).length < 3) {
        this.form.tags = (this.form.tags || []).concat(v);
        this.renderChipsOnly('tags');
      }
      e.target.value = '';
      return;
    }
    if (e.target && e.target.id === 'sbeText' && this._suggestOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); this.moveSuggest(e.key === 'ArrowDown' ? 1 : -1); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); this.confirmSuggest(); return; }
      if (e.key === 'Escape') { e.preventDefault(); this.closeSuggest(); return; }
    }
  },

  onKey(e) {
    if (!this._active || this.step !== 'editor') return;
    const mod = e.ctrlKey || e.metaKey;
    const k = String(e.key || '').toLowerCase();
    if (this._suggestOpen) return;      // 联想键盘由 canvas keydown 处理
    if (mod && k === 's') { e.preventDefault(); this.save(); return; }
    if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) this.redoStep(); else this.undoStep(); return; }
    if (mod && k === 'y') { e.preventDefault(); this.redoStep(); return; }
    if (mod && k === 'i') { e.preventDefault(); this.toggleInsert(); return; }
    if (mod && e.key === '[') { e.preventDefault(); this.shiftTranspose(-1); return; }
    if (mod && e.key === ']') { e.preventDefault(); this.shiftTranspose(1); return; }
    if (mod && k === 'p') { e.preventDefault(); try { window.print(); } catch (err) {} return; }
    if (e.code === 'Space' && document.activeElement === this.previewEl()) {
      e.preventDefault();
      try { SheetPlayer.toggle(this.doc, this.playerOpts()); } catch (err) {}
    }
  },

  onUnload(e) {
    if (!this._active || !this.dirty || this.step !== 'editor') return;
    try { SheetStore.writeDraft(this.doc, this.text()); } catch (err) {}
    e.preventDefault();
    e.returnValue = '';
  },

  onStorage(e) {
    if (!this._active || this.step !== 'editor' || !e || e.key !== SheetStore.KEY || !this.doc) return;
    const remote = SheetStore.get(this.doc.id);
    if (!remote) return;
    if (Number(remote.updatedAt) > Number(this.doc.updatedAt) + 1000) { this._conflict = true; this.showConflict(); }
  },

  /* ---------- 事件委托 ---------- */
  onClick(e) {
    const formAct = e.target.closest('[data-form-act]');
    if (formAct && this.step === 'form') { this.onFormAction(formAct, e); return; }
    const chip = e.target.closest('[data-chip]');
    if (chip && this.step === 'form') { this.onChip(chip); return; }
    const tempo = e.target.closest('[data-tempo]');
    if (tempo && this.step === 'form') {
      this.form.tempo = Number(tempo.dataset.tempo);
      const inp = document.getElementById('sbeFTempo'); if (inp) inp.value = this.form.tempo;
      this.updateFormState(); return;
    }
    const ed = e.target.closest('[data-ed-act]');
    if (ed && this.step === 'editor') { this.onEditorAction(ed, e); return; }
    const ins = e.target.closest('[data-ins]');
    if (ins) { this.onInsert(ins); return; }
    const demo = e.target.closest('[data-demo]');
    if (demo) { this.demoStrum(demo.dataset.demo); return; }
    const sug = e.target.closest('[data-suggest]');
    if (sug) { this.confirmSuggest(sug.dataset.suggest); return; }
    const warn = e.target.closest('[data-warn-line]');
    if (warn) { this.gotoLine(Number(warn.dataset.warnLine)); return; }
    const modal = e.target.closest('[data-modal-act]');
    if (modal) { this.onModalAction(modal); return; }
    if (e.target.classList && e.target.classList.contains('sb-modal-mask')) this.closeModal();
  },

  /* ---------- 表单动作 ---------- */
  onFormAction(btn, e) {
    const act = btn.dataset.formAct;
    if (act === 'cancel') {
      const changed = !!(this.form.title || this.form.artist || this.form.language || this.form.style || this.form.arrange);
      if (changed && typeof window.confirm === 'function' && !window.confirm(T('sheet.form.discard'))) return;
      location.hash = '#/sheetLib';
      return;
    }
    if (act === 'create') {
      if (btn.disabled) return;
      this.doc = formToDoc(this.form);
      this.step = 'editor'; this.dirty = true;
      this.resetEditorState(this.doc.text);
      this.render();
      this.afterRenderEditorDom();
      this.rerenderPreview();
      this.showValidation(validationToView(validateSheetText(this.text())));
      return;
    }
    if (act === 'applyCapo') {
      this.form.capo = Number(btn.dataset.capo) || 0;
      this.form.key = btn.dataset.shapekey || this.form.key;
      const c = document.getElementById('sbeFCapo'), k = document.getElementById('sbeFKey');
      if (c) c.value = this.form.capo;
      if (k) k.value = this.form.key;
      this.updateFormState();
      return;
    }
    if (act === 'demo') this.demoStrum(this.form.patternId);
  },

  onChip(chip) {
    const name = chip.dataset.chip, val = chip.dataset.value;
    if (name === 'tags') {
      const arr = (this.form.tags || []).slice();
      const i = arr.indexOf(val);
      if (i >= 0) arr.splice(i, 1);
      else if (arr.length < 3) arr.push(val);
      this.form.tags = arr;
    } else this.form[name] = this.form[name] === val ? '' : val;
    this.renderChipsOnly(name);
    this.updateFormState();
    if (name === 'style') {
      const rec = SHEET_ENUMS.STYLE_PATTERN[this.form.style];
      if (rec) { this.form.patternId = rec; const sel = document.getElementById('sbeFPattern'); if (sel) sel.value = rec; }
    }
  },

  renderChipsOnly(name) {
    const box = document.querySelector(`[data-chips="${name}"]`);
    if (!box) return;
    const btns = box.querySelectorAll('[data-chip]');
    btns.forEach((b) => {
      const v = b.dataset.value;
      const on = name === 'tags' ? (this.form.tags || []).includes(v) : this.form[name] === v;
      b.classList.toggle('on', !!on);
    });
  },

  /* ---------- 编辑器动作 ---------- */
  onEditorAction(btn, e) {
    const act = btn.dataset.edAct;
    if (act === 'save') { this.save(); return; }
    if (act === 'undo') { this.undoStep(); return; }
    if (act === 'redo') { this.redoStep(); return; }
    if (act === 'insert') { this.toggleInsert(); return; }
    if (act === 'more') { this.toggleMore(); return; }
    if (act === 'tp') { this.shiftTranspose(Number(btn.dataset.d) || 0); return; }
    if (act === 'shape') { this.shape = !this.shape; this.rerenderPreview(); return; }
    if (act === 'font') { this.fontIdx = clamp(this.fontIdx + (Number(btn.dataset.d) || 0), 0, FONT_SIZES.length - 1); this.rerenderPreview(); return; }
    if (act === 'layout') {
      this.layout = this.layout === 'compact' ? 'comfort' : 'compact';
      btn.textContent = T(this.layout === 'compact' ? 'sheet.ed.tool.compact' : 'sheet.ed.tool.comfort');
      btn.dataset.sbeI18n = this.layout === 'compact' ? 'sheet.ed.tool.compact' : 'sheet.ed.tool.comfort';
      this.rerenderPreview(); return;
    }
    if (act === 'autoscroll') { this.autoScroll = !this.autoScroll; btn.classList.toggle('on', this.autoScroll); return; }
    if (act === 'play') { try { SheetPlayer.toggle(this.doc, this.playerOpts()); } catch (err) {} return; }
    if (act === 'pane') {
      const ws = document.getElementById('sbeWorkspace');
      if (ws) ws.dataset.pane = btn.dataset.pane;
      return;
    }
    if (act === 'rename') { this.openRename(); return; }
  },

  shiftTranspose(d) {
    const n = clamp(this.transpose + d, -12, 12);
    try { SheetPlayer.setTranspose(n, this.doc, this.playerOpts()); } catch (err) {
      this.transpose = n; this.rerenderPreview();
    }
    this.updateTopbar();
  },

  /* ---------- 撤销 / 重做（F-07） ---------- */
  applySnap(snap) {
    if (!snap) return;
    const ta = this.textarea();
    if (!ta) return;
    ta.value = snap.text;
    try { ta.setSelectionRange(snap.caret, snap.caret); ta.focus(); } catch (e) {}
    this.doc.text = snap.text;
    this.dirty = true;
    this.rerenderPreview();
    this.showValidation(validationToView(validateSheetText(snap.text)));
    this.updateTopbar();
  },
  undoStep() { this.applySnap(this.undo.undo(this.text(), this.caret())); },
  redoStep() { this.applySnap(this.undo.redo()); },
  caret() { const ta = this.textarea(); return ta ? ta.selectionStart : 0; },

  /* ---------- 变更提交（离散操作统一入口） ---------- */
  afterChange(opts = {}) {
    const ta = this.textarea();
    if (!ta) return;
    this.doc.text = ta.value;
    this.dirty = true;
    this.undo.push(ta.value, ta.selectionStart, { discrete: !!opts.discrete, now: Date.now() });
    this.rerenderPreview();
    this.showValidation(validationToView(validateSheetText(ta.value)));
    this.updateTopbar();
    clearTimeout(this._draftTimer);
    this._draftTimer = setTimeout(() => { try { SheetStore.writeDraft(this.doc, this.text()); } catch (e) {} }, 800);
  },

  /* ---------- 插入面板（F-05） ---------- */
  toggleInsert() {
    const host = document.getElementById('sbeInsertHost');
    if (!host) return;
    if (host.firstChild) { host.innerHTML = ''; return; }
    const group = (titleKey, buttons) => `<h4 data-sbe-i18n="${titleKey}">${esc(T(titleKey))}</h4><div class="sbe-insert-items">${buttons}</div>`;
    const sections = enumItems('section').map((it, i) =>
      `<button type="button" data-ins="section" data-val="${esc(it.label)}" data-sbe-enum="section" data-sbe-idx="${i}">${esc(it.label)}</button>`).join('') +
      `<button type="button" data-ins="custom" data-sbe-i18n="sheet.ed.insert.custom">${esc(T('sheet.ed.insert.custom'))}</button>`;
    const rhythms = SHEET_ENUMS.PATTERN_IDS.map((id) =>
      `<button type="button" data-ins="rhythm" data-val="${esc(id)}" title="${esc(id)}">${esc(patternLabel(id))}</button>` +
      `<button type="button" class="sbe-mini" data-demo="${esc(id)}" title="${esc(T('sheet.player.play'))}">▶</button>`).join('');
    const html = `<div class="sbe-insert-panel" role="dialog" aria-label="${esc(T('sheet.ed.insert'))}">
        ${group('sheet.ed.insert.section', sections)}
        ${group('sheet.ed.insert.rhythm', rhythms)}
        ${group('sheet.ed.insert.chordLine', `<button type="button" data-ins="chord4" data-sbe-i18n="sheet.ed.insert.chord4">${esc(T('sheet.ed.insert.chord4'))}</button><button type="button" data-ins="chord8" data-sbe-i18n="sheet.ed.insert.chord8">${esc(T('sheet.ed.insert.chord8'))}</button>`)}
        ${group('sheet.ed.insert.comment', `<button type="button" data-ins="comment" data-sbe-i18n="sheet.ed.insert.comment">${esc(T('sheet.ed.insert.comment'))}</button>`)}
        ${group('sheet.ed.insert.repeat', `<button type="button" data-ins="x2">×2</button><button type="button" data-ins="x4">×4</button>`)}
      </div>`;
    host.innerHTML = html;
  },

  onInsert(btn) {
    const kind = btn.dataset.ins;
    const ta = this.textarea();
    if (!ta) return;
    if (kind === 'custom') { this.openCustomSection(); return; }
    let snippet = '';
    if (kind === 'section') snippet = `\n{name:${btn.dataset.val || ''}}\n`;
    else if (kind === 'rhythm') snippet = `\n{rhythm:${btn.dataset.val || ''}}\n`;
    else if (kind === 'chord4' || kind === 'chord8') {
      const n = kind === 'chord4' ? 4 : 8;
      const cs = suggestFor('', this.doc.key, this.freq, n);
      snippet = '\n' + cs.map((c) => '[' + c.name + ']').join(' ') + '\n';
    } else if (kind === 'comment') snippet = `\n{comment:${T('sheet.ed.insert.commentPh')}}\n`;
    else if (kind === 'x2' || kind === 'x4') snippet = kind === 'x2' ? '{x2}' : '{x4}';
    const r = insertSnippet(ta.value, ta.selectionStart, snippet);
    ta.value = r.text;
    try { ta.setSelectionRange(r.caret, r.caret); ta.focus(); } catch (e) {}
    this.afterChange({ discrete: true });
    const host = document.getElementById('sbeInsertHost');
    if (host) host.innerHTML = '';
  },

  /* ---------- 和弦联想（F-06） ---------- */
  updateSuggest(ta, data) {
    if (data === ']') { this.closeSuggest(); return; }
    const before = ta.value.slice(0, ta.selectionStart);
    const open = before.lastIndexOf('['), close = before.lastIndexOf(']');
    if (open < 0 || close > open) { this.closeSuggest(); return; }
    this._suggestQuery = before.slice(open + 1);
    this._suggestOpen = true;
    this._suggestIndex = 0;
    this.renderSuggest(ta);
  },

  renderSuggest(ta) {
    const host = document.getElementById('sbeSuggestHost');
    if (!host) return;
    const list = suggestFor(this._suggestQuery, this.doc.key, this.freq);
    const bad = !!(this._suggestQuery.trim() && !parseChord(this._suggestQuery).valid);
    const items = list.map((c, i) =>
      `<button type="button" data-suggest="${esc(c.name)}" class="${i === this._suggestIndex ? 'on' : ''}">${esc(c.name)}${c.hasDiagram ? '' : `<span class="no-diagram">${esc(T('sheet.ed.noDiagram'))}</span>`}</button>`).join('');
    const html = `<div class="sbe-suggest" role="listbox" aria-label="${esc(T('sheet.ed.insert.chordLine'))}">
        ${bad ? `<div class="bad">${esc(T('sheet.ed.badChord'))}</div>` : ''}
        ${items || `<div class="bad">${esc(T('sheet.ed.badChord'))}</div>`}
      </div>`;
    host.innerHTML = html;
    const box = host.querySelector('.sbe-suggest');
    if (box && ta && typeof ta.getBoundingClientRect === 'function') {
      const r = ta.getBoundingClientRect();
      box.style.position = 'fixed';
      box.style.left = clamp(r.left + 16, 8, Math.max(8, (window.innerWidth || 1024) - 180)) + 'px';
      box.style.top = clamp(r.top + 60, 8, Math.max(8, (window.innerHeight || 768) - 240)) + 'px';
    }
  },

  moveSuggest(d) {
    const list = suggestFor(this._suggestQuery, this.doc.key, this.freq);
    if (!list.length) return;
    this._suggestIndex = clamp(this._suggestIndex + d, 0, list.length - 1);
    const host = document.getElementById('sbeSuggestHost');
    if (!host) return;
    host.querySelectorAll('[data-suggest]').forEach((b, i) => b.classList.toggle('on', i === this._suggestIndex));
  },

  confirmSuggest(name) {
    const ta = this.textarea();
    if (!ta) { this.closeSuggest(); return; }
    const list = suggestFor(this._suggestQuery, this.doc.key, this.freq);
    const pick = name || (list[this._suggestIndex] && list[this._suggestIndex].name);
    this.closeSuggest();
    if (!pick) return;
    const before = ta.value.slice(0, ta.selectionStart);
    const open = before.lastIndexOf('[');
    if (open < 0) return;
    const tail = ta.value.slice(ta.selectionStart);
    const head = ta.value.slice(0, open);
    const inserted = '[' + pick + ']';
    ta.value = head + inserted + tail;
    const caret = head.length + inserted.length;
    try { ta.setSelectionRange(caret, caret); ta.focus(); } catch (e) {}
    this.freq[pick] = (this.freq[pick] || 0) + 1;
    this.afterChange({ discrete: true });
  },

  closeSuggest() {
    this._suggestOpen = false;
    const host = document.getElementById('sbeSuggestHost');
    if (host) host.innerHTML = '';
  },

  /* ---------- 更多菜单（F-04 / F-11 / F-16） ---------- */
  toggleMore() {
    const host = document.getElementById('sbeMoreHost');
    if (!host) return;
    if (host.firstChild) { host.innerHTML = ''; return; }
    const item = (act, key, danger) => `<button type="button" data-more="${act}" class="${danger ? 'danger' : ''}" data-sbe-i18n="${key}">${esc(T(key))}</button>`;
    const html = `<div class="sbe-more-menu" role="menu">
        ${item('saveAs', 'sheet.ed.more.saveAs')}
        <button type="button" data-more="transposeAs">${esc(T('sheet.ed.tool.transpose') + ' · ' + T('sheet.ed.more.saveAs'))}</button>
        ${item('exportTxt', 'sheet.ed.more.exportTxt')}
        ${item('exportJson', 'sheet.ed.more.exportJson')}
        ${item('help', 'sheet.ed.more.help')}
        ${item('print', 'sheet.ed.more.print')}
        ${item('delete', 'sheet.ed.more.delete', true)}
      </div>`;
    host.innerHTML = html;
    host.querySelectorAll('[data-more]').forEach((b) => {
      b.addEventListener('click', (ev) => { ev.stopPropagation(); this.onMore(b.dataset.more); });
    });
  },

  onMore(act) {
    const host = document.getElementById('sbeMoreHost');
    if (host) host.innerHTML = '';
    if (act === 'saveAs') { this.saveAs(); return; }
    if (act === 'transposeAs') { this.transposeAs(); return; }
    if (act === 'exportTxt' || act === 'exportJson') {
      const isJson = act === 'exportJson';
      const d = this.doc || {};
      const name = (String(d.title || 'untitled').replace(/[\\/:*?"<>|]/g, '_') + '-' + String(d.artist || '').replace(/[\\/:*?"<>|]/g, '_') + '.gsc.' + (isJson ? 'json' : 'txt'));
      this.download(name, isJson ? JSON.stringify(d, null, 2) : this.text());
      toast(T('sheet.lib.toastExported'));
      return;
    }
    if (act === 'help') { this.openHelp(); return; }
    if (act === 'print') { try { window.print(); } catch (e) {} return; }
    if (act === 'delete') { this.askDelete(); return; }
  },

  /* ---------- 保存 / 校验（F-09） ---------- */
  save() {
    const text = this.text();
    const v = validateSheetText(text);
    const view = validationToView(v);
    this.showValidation(view, true);
    if (!v.ok) { toast(T('sheet.ed.validate.block'), 'warn'); return; }
    const doc = { ...this.doc, ...metaFromText(text, this.doc), text };
    const r = SheetStore.save(doc);
    if (!r.ok) { toast(T(r.code || 'sheet.ed.validate.block'), 'warn'); return; }
    this.doc = r.sheet;
    this.dirty = false;
    this.undo.clearRedo();
    try { SheetStore.clearDraft(); } catch (e) {}
    toast(T('sheet.ed.saved'));
    this.updateTopbar();
    this._conflict = false;
    this.showConflict();
  },

  showValidation(view, expand) {
    const box = document.getElementById('sbeWarnBar');
    if (!box) return;
    const all = (view.blocking || []).map((w) => ({ ...w, block: true })).concat(view.warnings || []);
    if (!all.length) { box.innerHTML = ''; return; }
    const n = (view.warnings || []).length;
    const items = all.slice(0, 30).map((w) =>
      `<li data-warn-line="${w.line || 0}" class="${w.block ? 'block' : ''}">${esc(w.line ? 'L' + w.line + ' · ' : '')}${esc(w.msg)}${w.raw ? ' · ' + esc(w.raw) : ''}</li>`).join('');
    const head = (view.blocking || []).length
      ? `<b>${esc(T('sheet.ed.validate.block'))}</b>`
      : `<b>${esc(TF('sheet.ed.validate.warn', { n }))}</b>`;
    const html = `<div class="sbe-warnbar${(view.blocking || []).length ? ' block' : ''}" role="${expand ? 'alert' : 'status'}">
        ${head}<ul${expand ? '' : ' hidden'}>${items}</ul>
      </div>`;
    box.innerHTML = html;
    if (!expand) {
      const bar = box.querySelector('.sbe-warnbar');
      if (bar) bar.addEventListener('click', () => {
        const ul = bar.querySelector('ul');
        if (ul) ul.hidden = !ul.hidden;
      });
    }
  },

  gotoLine(lineNo) {
    const ta = this.textarea();
    if (!ta || !lineNo) return;
    const off = lineStartOffset(ta.value, lineNo);
    try { ta.focus(); ta.setSelectionRange(off, off); ta.scrollTop = Math.max(0, (lineNo - 3) * 22); } catch (e) {}
  },

  /* ---------- 另存 / 转调另存（F-11） ---------- */
  saveAs() {
    const text = this.text();
    const doc = { ...metaFromText(text, this.doc), text, id: undefined,
      title: (String(this.doc.title || '') + '(副本)').slice(0, 60), createdAt: Date.now(), updatedAt: Date.now() };
    const r = SheetStore.save(doc);
    if (!r.ok) { toast(T(r.code || 'sheet.ed.validate.block'), 'warn'); return; }
    this.doc = r.sheet; this.dirty = false;
    this.resetEditorState(r.sheet.text);
    this.render(); this.afterRenderEditorDom(); this.rerenderPreview();
    toast(T('sheet.lib.toastCopied'));
  },

  transposeAs() {
    const n = this.transpose;
    if (!n) { toast(T('sheet.ed.tool.transpose')); return; }
    const src = this.text();
    const text = transposeSheetText(src, n);
    const base = metaFromText(text, this.doc);
    const doc = { ...base, text, id: undefined,
      title: transposedDocTitle(this.doc.title, n).slice(0, 60),
      key: base.key, createdAt: Date.now(), updatedAt: Date.now() };
    const r = SheetStore.save(doc);
    if (!r.ok) { toast(T(r.code || 'sheet.ed.validate.block'), 'warn'); return; }
    this.doc = r.sheet; this.dirty = false; this.transpose = 0;
    SheetPlayer.transpose = 0;
    this.resetEditorState(r.sheet.text);
    this.render(); this.afterRenderEditorDom(); this.rerenderPreview();
    toast(TF('sheet.ed.transposedAs', { n }));
  },

  /* ---------- 弹层：重命名 / 自定义段名 / 帮助 / 删除 ---------- */
  modal(title, body, okLabel, kind) {
    const root = document.getElementById('sbeRoot');
    if (!root) return;
    this.closeModal();
    const el = document.createElement('div');
    el.id = 'sbeModal';
    el.className = 'sb-modal-mask';
    el.dataset.kind = kind || '';
    const html = `<div class="sb-modal" role="dialog" aria-modal="true">
        <h3>${esc(title)}</h3>${body}
        <div class="sb-modal-actions">
          <button type="button" data-modal-act="close" data-sbe-i18n="sheet.form.cancel">${esc(T('sheet.form.cancel'))}</button>
          <button type="button" class="primary" data-modal-act="ok">${esc(okLabel)}</button>
        </div>
      </div>`;
    el.innerHTML = html;
    root.appendChild(el);
    const first = el.querySelector('input[type=text], textarea');
    if (first && first.focus) try { first.focus(); } catch (e) {}
  },

  closeModal() { const el = document.getElementById('sbeModal'); if (el && el.remove) el.remove(); },

  onModalAction(btn) {
    const act = btn.dataset.modalAct;
    const el = document.getElementById('sbeModal');
    const kind = el ? el.dataset.kind : '';
    if (act === 'close') { this.closeModal(); return; }
    if (kind === 'rename') {
      const ti = document.getElementById('sbeMTitle'), ai = document.getElementById('sbeMArtist');
      const title = String(ti ? ti.value : '').trim().slice(0, 60);
      const artist = String(ai ? ai.value : '').trim().slice(0, 60);
      if (!title) { toast(T('sheet.form.required'), 'warn'); return; }
      const ta = this.textarea();
      if (ta) { ta.value = applyFieldsToText(ta.value, { title, artist }); }
      this.doc.title = title; this.doc.artist = artist;
      this.afterChange({ discrete: true });
      this.updateTopbar();
      this.closeModal();
      return;
    }
    if (kind === 'customSection') {
      const inp = document.getElementById('sbeMSection');
      const val = String(inp ? inp.value : '').trim().slice(0, 12);
      this.closeModal();
      if (!val) return;
      const ta = this.textarea();
      if (!ta) return;
      const r = insertSnippet(ta.value, ta.selectionStart, `\n{name:${val}}\n`);
      ta.value = r.text;
      try { ta.setSelectionRange(r.caret, r.caret); } catch (e) {}
      this.afterChange({ discrete: true });
      return;
    }
    if (kind === 'delete') {
      const r = SheetStore.remove(this.doc.id);
      if (r.ok) { SheetStore.clearDraft(); toast(T('sheet.lib.toastDeleted')); }
      this.closeModal();
      this.dirty = false;
      location.hash = '#/sheetLib';
      return;
    }
    this.closeModal();
  },

  openRename() {
    const body = `<div class="sbe-field"><label data-sbe-i18n="sheet.form.songName">${esc(T('sheet.form.songName'))}</label><input type="text" id="sbeMTitle" maxlength="60" value="${esc(this.doc.title)}"></div>
        <div class="sbe-field" style="margin-top:10px"><label data-sbe-i18n="sheet.form.artist">${esc(T('sheet.form.artist'))}</label><input type="text" id="sbeMArtist" maxlength="60" value="${esc(this.doc.artist)}"></div>
        <div class="sb-modal-note">${esc(T('sheet.ed.tool.transpose'))}</div>`;
    this.modal(T('sheet.form.songName'), body, T('sheet.ed.save'), 'rename');
  },

  openCustomSection() {
    const body = `<input type="text" id="sbeMSection" maxlength="12" placeholder="${esc(T('sheet.ed.insert.customPh'))}" data-sbe-i18n-ph="sheet.ed.insert.customPh">`;
    this.modal(T('sheet.ed.insert.custom'), body, T('sheet.ed.insert'), 'customSection');
  },

  openHelp() {
    const body = `<pre style="white-space:pre-wrap;font-family:var(--font-mono);font-size:12.5px;line-height:1.8;color:var(--txt-2)">${esc([
      '{title:Song}  {artist:Artist}  {key:C}  {originalKey:C}',
      '{tempo:70}  {time:4/4}  {capo:0}  {rhythm:strum-pop-a}',
      '{meta:language:...}  {meta:style:...}  {meta:arrange:...}',
      '',
      '{name:Verse}      #Verse',
      '{rhythm:pick-folk-a}',
      '{comment:any note}      #>any note',
      '[C]Lyric [Am]text [F]more [G]end  {x2}',
      '[C] [G] [Am] [F]',
    ].join('\n'))}</pre>`;
    this.modal(T('sheet.ed.help.title'), body, T('sheet.form.cancel'), 'help');
  },

  askDelete() {
    const body = `<div class="sb-modal-note">${esc(TF('sheet.lib.deleteAsk', { t: this.doc.title }))}</div>`;
    this.modal(T('sheet.ed.more.delete'), body, T('sheet.lib.delete'), 'delete');
  },

  /* ---------- 草稿 / 冲突（F-08） ---------- */
  showDraftAsk() {
    const box = document.getElementById('sbeDraftBar');
    if (!box || !this._draftAsk) { if (box) box.innerHTML = ''; return; }
    const d = this._draftAsk;
    const text = d.kind === 'new'
      ? TF('sheet.ed.draftAsk', { t: (d.doc && d.doc.title) || T('sheet.lib.badge') })
      : T('sheet.ed.draftNewer');
    const html = `<div class="sbe-warnbar sbe-conflict">
        <span>${esc(text)}</span>
        <button type="button" class="sbe-mini" data-ed-act="draftRestore" data-sbe-i18n="sheet.ed.restore">${esc(T('sheet.ed.restore'))}</button>
        <button type="button" class="sbe-mini" data-ed-act="draftDiscard" data-sbe-i18n="sheet.ed.discard">${esc(T('sheet.ed.discard'))}</button>
      </div>`;
    box.innerHTML = html;
    box.querySelectorAll('[data-ed-act]').forEach((b) => b.addEventListener('click', () => {
      const restore = b.dataset.edAct === 'draftRestore';
      if (restore) {
        this.doc = { ...(d.doc || this.doc), text: d.text };
        this.step = 'editor'; this.dirty = true;
        this.resetEditorState(d.text);
      } else { try { SheetStore.clearDraft(); } catch (e) {} }
      this._draftAsk = null;
      /* 从「表单步」恢复时必须重建整个编辑器 DOM（画布/预览/控制条），
         否则只改 step 会留下表单布局，textarea 不存在。 */
      if (restore) { this.render(); toast(T('sheet.ed.draftRestored')); }
      else box.innerHTML = '';
      this.updateTopbar();
    }));
  },

  showConflict() {
    const box = document.getElementById('sbeConflict');
    if (!box) return;
    if (!this._conflict) { box.innerHTML = ''; return; }
    const html = `<div class="sbe-warnbar sbe-conflict">
        <span>${esc(T('sheet.ed.conflict'))}</span>
        <button type="button" class="sbe-mini" data-ed-act="conflictReload" data-sbe-i18n="sheet.ed.reload">${esc(T('sheet.ed.reload'))}</button>
        <button type="button" class="sbe-mini" data-ed-act="conflictOverwrite" data-sbe-i18n="sheet.ed.overwrite">${esc(T('sheet.ed.overwrite'))}</button>
      </div>`;
    box.innerHTML = html;
    box.querySelectorAll('[data-ed-act]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.edAct === 'conflictReload') {
        const s = SheetStore.get(this.doc.id);
        if (s) { this.doc = { ...s }; const ta = this.textarea(); if (ta) ta.value = s.text; this.dirty = false; this.rerenderPreview(); }
      } else this.save();
      this._conflict = false;
      box.innerHTML = '';
      this.updateTopbar();
    }));
  },

  /* ---------- 节奏型试听（轻量扫弦，不占用 SheetPlayer 状态） ---------- */
  demoStrum() {
    this._demoTimers.forEach(clearTimeout); this._demoTimers = [];
    let AE = null;
    try { AE = (typeof window !== 'undefined' && window.AudioEngine) || (typeof AudioEngine !== 'undefined' ? AudioEngine : null); } catch (e) {}
    if (!AE || typeof AE.strum !== 'function') { toast(T('sheet.player.hint')); return; }
    const freqs = chordMidis(48, 'maj').map((m) => midiToFreq(m));
    const bpm = this.step === 'form' ? (Number(this.form.tempo) || 70) : (Number(this.doc.tempo) || 70);
    const spb = 60 / clamp(bpm, 40, 240);
    for (let b = 0; b < 8; b++) {
      const t = setTimeout(() => {
        try {
          AE.strum(freqs, b % 2 === 0 ? 'down' : 'up', 0.16, 0);
          if (typeof AE.click === 'function') AE.click(b % 4 === 0, 0);
        } catch (err) {}
      }, b * spb * 1000);
      this._demoTimers.push(t);
    }
    toast(T('sheet.player.hint'));
  },

  /* ---------- 导出下载 ---------- */
  download(name, data) {
    try {
      const blob = new Blob([data], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name || 'sheet.txt';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) {} }, 1000);
    } catch (e) {}
  },

  /* ---------- 语言切换：只改文本，不重建交互 DOM（V4.3 R3） ---------- */
  refreshLang() {
    const root = document.getElementById('sbeRoot');
    if (!root || !this._active) return;
    root.querySelectorAll('[data-sbe-i18n]').forEach((el) => { el.textContent = T(el.dataset.sbeI18n); });
    root.querySelectorAll('[data-sbe-i18n-ph]').forEach((el) => { el.placeholder = T(el.dataset.sbeI18nPh); });
    root.querySelectorAll('[data-sbe-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', T(el.dataset.sbeI18nAria)); });
    root.querySelectorAll('[data-sbe-i18n-title]').forEach((el) => {
      const v = T(el.dataset.sbeI18nTitle);
      el.title = v; el.setAttribute('aria-label', v);
    });
    root.querySelectorAll('[data-sbe-enum]').forEach((el) => {
      const items = enumItems(el.dataset.sbeEnum);
      const i = Number(el.dataset.sbeIdx);
      if (items[i]) el.textContent = items[i].label;
    });
    if (this.step === 'form') {
      this.updateDiffHints();
      this.updateFormState();
    } else {
      this.updateTopbar();
      this.showValidation(validationToView(validateSheetText(this.text())));
      this.rerenderPreview();
      if (this._draftAsk) this.showDraftAsk();
      if (this._conflict) this.showConflict();
      try { SheetPlayer._syncControls(); } catch (e) {}
      const ins = document.getElementById('sbeInsertHost');
      if (ins && ins.firstChild) { ins.innerHTML = ''; this.toggleInsert(); }
      const more = document.getElementById('sbeMoreHost');
      if (more && more.firstChild) { more.innerHTML = ''; this.toggleMore(); }
    }
  },
};

if (typeof onRouteEnter !== 'undefined' && onRouteEnter) onRouteEnter.sheetEditor = () => SheetEditor.enter();
if (typeof window !== 'undefined') window.SheetEditor = SheetEditor;
export { SheetEditor };
export default SheetEditor;
