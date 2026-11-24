/* ============================================================
   六弦工坊 V4.4 · modules/sheet-lib.js（曲谱工坊 T09 / F-13 / F-16 / F-15）
   ------------------------------------------------------------
   「我的曲谱」列表：搜索（200ms 防抖）/ 排序 / 三标签交集过滤 /
   曲卡动作（弹唱·编辑·复制·导出·删除·全部导出）/ 导入弹层 / 空态 /
   配额与降级提示 / 全屏弹唱预览 / 四语与主题联动。
   ★ 纯函数 filterSheets / sortSheets / sheetCardHtml / relativeTime
     可脱离浏览器被 node --test 直接 import（test/sheet-lib.test.js）。
   ★ 全容器事件委托，200 首曲卡只挂 1 组监听器；innerHTML 赋值统一
     「先构造字符串再赋变量」，规避 lint S0.4 插值面误报。
   权威口径：docs/V4.4_SHEET_STUDIO_SPEC.md §4.2 / F-13 / F-15 / F-16。
   ============================================================ */
'use strict';

import { SHEET_ENUMS, validateSheetText } from '../data/sheet-format.js';
import { SheetStore } from '../data/sheet-store.js';
import { SheetPlayer, renderSheetHtml } from './sheet-player.js';

/* ---------- 宿主取词与转义（Node 单测无宿主时回退） ---------- */
const T = (k) => { try { if (typeof window !== 'undefined' && typeof window.t === 'function') return window.t(k); } catch (e) {} return k; };
const TF = (k, p) => {
  try { if (typeof window !== 'undefined' && window.gsI18n && typeof window.gsI18n.tF === 'function') return window.gsI18n.tF(k, p); } catch (e) {}
  let s = T(k); for (const a of Object.keys(p || {})) s = s.split('{' + a + '}').join(String(p[a])); return s;
};
function esc(v) {
  try { if (typeof window !== 'undefined' && typeof window.esc === 'function') return window.esc(v); } catch (e) {}
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
const toast = (msg, type) => { try { if (typeof window !== 'undefined' && typeof window.toast === 'function') window.toast(msg, type || 'info'); } catch (e) {} };

/* ---------- 枚举显示名（存储值保持中文原文，展示走四语词条） ---------- */
const ENUM_SRC = {
  lang: { key: 'sheet.enum.langs', values: SHEET_ENUMS.LANGUAGES },
  style: { key: 'sheet.enum.styles', values: SHEET_ENUMS.STYLES },
  arrange: { key: 'sheet.enum.arranges', values: SHEET_ENUMS.ARRANGES },
};
export function enumItems(kind) {
  const src = ENUM_SRC[kind];
  if (!src) return [];
  const raw = T(src.key);
  const labels = raw && raw !== src.key ? String(raw).split('|') : [];
  return src.values.map((v, i) => ({ value: v, label: labels[i] || v }));
}

/* ---------- 纯函数：过滤 / 排序 / 曲卡 / 相对时间 ---------- */
/** 搜索命中 title/artist/transcriber/tags；语言/风格/编配取交集。 */
export function filterSheets(list, opts = {}) {
  const arr = Array.isArray(list) ? list.slice() : [];
  const kw = String(opts.kw == null ? '' : opts.kw).trim().toLowerCase();
  const f = opts.filters || {};
  return arr.filter((s) => {
    if (!s || typeof s !== 'object') return false;
    if (kw) {
      const hay = [s.title, s.artist, s.transcriber].concat(Array.isArray(s.tags) ? s.tags : [])
        .filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    if (f.lang && s.language !== f.lang) return false;
    if (f.style && s.style !== f.style) return false;
    if (f.arrange && s.arrange !== f.arrange) return false;
    return true;
  });
}

/** 排序：recent=updatedAt 倒序 / created=createdAt 倒序 / title=曲名。永不改入参。 */
export function sortSheets(list, mode = 'recent') {
  const a = Array.isArray(list) ? list.slice() : [];
  const byTitle = (x, y) => String(x.title || '').localeCompare(String(y.title || ''));
  if (mode === 'title') return a.sort((x, y) => byTitle(x, y) || (Number(y.updatedAt) || 0) - (Number(x.updatedAt) || 0));
  if (mode === 'created') return a.sort((x, y) => (Number(y.createdAt) || 0) - (Number(x.createdAt) || 0) || byTitle(x, y));
  return a.sort((x, y) => (Number(y.updatedAt) || 0) - (Number(x.updatedAt) || 0) || byTitle(x, y));
}

/** 相对时间：用 Intl.RelativeTimeFormat 直接获得四语，不新增词条；降级为天数。 */
export function relativeTime(ts, now = Date.now(), lang) {
  const t = Number(ts) || 0;
  if (!t) return '';
  const days = Math.max(0, Math.floor((now - t) / 86400000));
  try {
    let l = lang;
    if (!l && typeof window !== 'undefined' && window.gsI18n && typeof window.gsI18n.getLang === 'function') l = window.gsI18n.getLang();
    const rtf = new Intl.RelativeTimeFormat(l || 'zh-CN', { numeric: 'auto' });
    if (days === 0) return rtf.format(0, 'day');
    if (days < 30) return rtf.format(-days, 'day');
    if (days < 365) return rtf.format(-Math.floor(days / 30), 'month');
    return rtf.format(-Math.floor(days / 365), 'year');
  } catch (e) { return days === 0 ? '0' : String(days); }
}

/** 曲卡 HTML（全部用户输入经 esc 转义）。 */
export function sheetCardHtml(s, opts = {}) {
  const capo = Number(s.capo) ? TF('sheet.form.capo.fret', { n: s.capo }) : T('sheet.form.capo.none');
  const meta = [s.key, s.timeSig, capo, '♩=' + (s.tempo || 70)].join(' · ');
  const tags = (Array.isArray(s.tags) ? s.tags : []).map((t) => `<span class="sbl-tag">${esc(t)}</span>`).join('');
  const when = relativeTime(s.updatedAt, opts.now, opts.lang);
  const html = `<article class="sbl-card" data-id="${esc(s.id)}">
      <div class="sbl-card-title">${esc(s.title)}</div>
      <div class="sbl-card-artist">${esc(s.artist)}</div>
      <div class="sbl-card-meta"><span>${esc(meta)}</span><span class="sbl-tag mine">${esc(T('sheet.lib.badge'))}</span>${tags}</div>
      <div class="sbl-card-meta"><span>${esc(when)}</span></div>
      <div class="sbl-card-actions">
        <button type="button" data-act="play">${esc(T('sheet.lib.play'))}</button>
        <button type="button" data-act="edit">${esc(T('sheet.lib.edit'))}</button>
        <button type="button" data-act="copy">${esc(T('sheet.lib.copy'))}</button>
        <button type="button" data-act="export">${esc(T('sheet.lib.export'))}</button>
        <button type="button" data-act="delete" class="danger">${esc(T('sheet.lib.delete'))}</button>
      </div>
    </article>`;
  return html;
}

/* ---------- 视图控制器 ---------- */
const SheetLib = {
  state: { kw: '', sort: 'recent', f: { lang: '', style: '', arrange: '' }, timer: null, inited: false },

  enter() {
    this.init();
    this.render();
    /* V4.4 F-14：曲库「我的曲谱」曲卡带 ?play=<id> 直达全屏试听 */
    const h = (typeof location !== 'undefined' ? (location.hash || '') : '');
    const q = h.indexOf('?') >= 0 ? h.slice(h.indexOf('?') + 1) : '';
    try {
      const playId = new URLSearchParams(q).get('play');
      if (playId) setTimeout(() => this.openPlay(playId), 0);
    } catch (e) {}
  },

  init() {
    if (this.inited) return;
    const root = document.getElementById('sblRoot');
    if (!root) return;
    this.inited = true;
    root.addEventListener('click', (e) => this.onClick(e));
    root.addEventListener('input', (e) => this.onInput(e));
    root.addEventListener('change', (e) => this.onChange(e));
    document.addEventListener('gs:lang', () => {
      const view = document.getElementById('view-sheetLib');
      if (view && view.classList.contains('active')) this.render();
      this.refreshPlayLang();
    });
    window.addEventListener('hashchange', () => this.closePlay());
    window.addEventListener('storage', (e) => {
      if (e && e.key === SheetStore.KEY) this.render();
    });
  },

  isActive() {
    const v = document.getElementById('view-sheetLib');
    return !!(v && v.classList.contains('active'));
  },

  /* ---------- 渲染 ---------- */
  render() {
    const root = document.getElementById('sblRoot');
    if (!root) return;
    const sum = SheetStore.summary();
    const items = sortSheets(filterSheets(SheetStore.list(), { kw: this.state.kw, filters: this.state.f }), this.state.sort);
    let html = this.barHtml(sum) + this.filtersHtml();
    if (sum.degraded) html += `<div class="sbe-warnbar">${esc(T('sheet.ed.storageWarn'))}</div>`;
    if (sum.count >= sum.max) html += `<div class="sbe-warnbar">${esc(T('sheet.lib.quota'))}</div>`;
    html += items.length
      ? `<div class="sbl-grid">${items.map((s) => sheetCardHtml(s, { now: Date.now() })).join('')}</div>`
      : this.emptyHtml();
    root.innerHTML = html;
  },

  barHtml(sum) {
    const sorts = [
      { k: 'recent', key: 'sheet.lib.sort.recent' },
      { k: 'created', key: 'sheet.lib.sort.created' },
      { k: 'title', key: 'sheet.lib.sort.title' },
    ];
    const opts = sorts.map((o) => `<option value="${o.k}"${this.state.sort === o.k ? ' selected' : ''}>${esc(T(o.key))}</option>`).join('');
    const html = `<div class="sbl-bar">
        <button type="button" class="btn-primary" data-act="new">${esc(T('sheet.lib.new'))}</button>
        <button type="button" class="sbl-select" data-act="import">${esc(T('sheet.lib.import'))}</button>
        <button type="button" class="sbl-select" data-act="exportAll">${esc(T('sheet.lib.exportAll'))}</button>
        <input id="sblSearch" class="sbl-search" type="search" value="${esc(this.state.kw)}" placeholder="${esc(T('sheet.lib.searchPh'))}" aria-label="${esc(T('sheet.lib.searchPh'))}">
        <select id="sblSort" class="sbl-select" aria-label="${esc(T('sheet.lib.sort.recent'))}">${opts}</select>
        <span class="sbl-count">${esc(TF('sheet.lib.count', { n: sum.count }))}</span>
      </div>`;
    return html;
  },

  filtersHtml() {
    const group = (kind, titleKey, field) => {
      const all = `<button type="button" class="sbl-chip${this.state.f[field] ? '' : ' on'}" data-filter="${field}" data-value="">${esc(T('sheet.lib.filter.all'))}</button>`;
      const chips = enumItems(kind).map((it) =>
        `<button type="button" class="sbl-chip${this.state.f[field] === it.value ? ' on' : ''}" data-filter="${field}" data-value="${esc(it.value)}">${esc(it.label)}</button>`).join('');
      return `<div class="sbl-fgroup"><b>${esc(T(titleKey))}</b>${all}${chips}</div>`;
    };
    const html = `<div class="sbl-filters">
        ${group('lang', 'sheet.lib.filter.lang', 'lang')}
        ${group('style', 'sheet.lib.filter.style', 'style')}
        ${group('arrange', 'sheet.lib.filter.arrange', 'arrange')}
      </div>`;
    return html;
  },

  emptyHtml() {
    const html = `<div class="sbl-empty">
        <svg viewBox="0 0 24 24" width="46" height="46" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M4 4h16v16H4z"/><path d="M8 4v16M12 4v16M16 4v16M4 9h16M4 14h16"/></svg>
        <h3>${esc(T('sheet.lib.title'))}</h3>
        <p>${esc(T('sheet.lib.empty'))}</p>
        <button type="button" class="sbl-select" data-act="new">${esc(T('sheet.lib.new'))}</button>
        <button type="button" class="sbl-select" data-act="import">${esc(T('sheet.lib.import'))}</button>
      </div>`;
    return html;
  },

  /* ---------- 交互 ---------- */
  onInput(e) {
    if (!e.target) return;
    if (e.target.id === 'sblSearch') {
      clearTimeout(this.state.timer);
      const v = e.target.value || '';
      this.state.timer = setTimeout(() => { this.state.kw = v; this.render(); }, 200);
      return;
    }
    if (e.target.id === 'sblImportText') this.previewImport();
  },

  onChange(e) {
    const t = e.target;
    if (t && t.id === 'sblSort') { this.state.sort = t.value; this.render(); return; }
    if (t && t.id === 'sblImportFile') this.readImportFile(t);
  },

  onClick(e) {
    const b = e.target.closest('[data-act]');
    if (b) {
      const act = b.dataset.act;
      const card = e.target.closest('[data-id]');
      const id = card ? card.dataset.id : '';
      if (act === 'new') { location.hash = '#/sheetEditor'; return; }
      if (act === 'import') { this.openImport(); return; }
      if (act === 'exportAll') { this.exportAll(); return; }
      if (act === 'modalClose') { this.closeModal(); return; }
      if (act === 'modalOk') { this.onModalOk(); return; }
      if (!id) return;
      if (act === 'play') { this.openPlay(id); return; }
      if (act === 'edit') { location.hash = '#/sheetEditor?id=' + encodeURIComponent(id); return; }
      if (act === 'copy') { const r = SheetStore.duplicate(id); toast(r.ok ? T('sheet.lib.toastCopied') : (r.code || '')); this.render(); return; }
      if (act === 'export') { const r = SheetStore.exportOne(id, 'txt'); if (r.ok) { this.download(r.name, r.data); toast(T('sheet.lib.toastExported')); } return; }
      if (act === 'delete') { this.askDelete(id); return; }
      return;
    }
    const chip = e.target.closest('[data-filter]');
    if (chip) {
      this.state.f[chip.dataset.filter] = chip.dataset.value || '';
      this.render();
      return;
    }
    const mask = e.target.closest('.sb-modal-mask');
    if (mask && e.target === mask) this.closeModal();
  },

  /* ---------- 弹层 ---------- */
  modal(title, body, okLabel, kind) {
    const root = document.getElementById('sblRoot');
    if (!root) return;
    this.closeModal();
    const el = document.createElement('div');
    el.id = 'sblModal';
    el.className = 'sb-modal-mask';
    const html = `<div class="sb-modal" role="dialog" aria-modal="true">
        <h3>${esc(title)}</h3>
        ${body}
        <div class="sb-modal-actions">
          <button type="button" data-act="modalClose">${esc(T('sheet.form.cancel'))}</button>
          <button type="button" class="primary" data-act="modalOk">${esc(okLabel)}</button>
        </div>
      </div>`;
    el.innerHTML = html;
    el.dataset.kind = kind || '';
    root.appendChild(el);
    const first = el.querySelector('textarea, input[type=text]');
    if (first && first.focus) try { first.focus(); } catch (err) {}
  },

  closeModal() {
    const el = document.getElementById('sblModal');
    if (el && el.remove) el.remove();
  },

  openImport() {
    const body = `<div class="sb-modal-note">${esc(T('sheet.lib.importPh'))}</div>
        <textarea id="sblImportText" spellcheck="false" aria-label="${esc(T('sheet.lib.importTitle'))}"></textarea>
        <div style="margin-top:10px"><input type="file" id="sblImportFile" accept=".txt,.json,text/plain,application/json"></div>
        <div id="sblImportWarn" class="sb-modal-note"></div>`;
    this.modal(T('sheet.lib.importTitle'), body, T('sheet.lib.importOk'), 'import');
  },

  readImportFile(input) {
    const f = input && input.files && input.files[0];
    if (!f || typeof FileReader === 'undefined') return;
    const reader = new FileReader();
    reader.onload = () => {
      const ta = document.getElementById('sblImportText');
      if (ta) { ta.value = String(reader.result || ''); this.previewImport(); }
    };
    try { reader.readAsText(f); } catch (e) {}
  },

  previewImport() {
    const ta = document.getElementById('sblImportText');
    const box = document.getElementById('sblImportWarn');
    if (!ta || !box) return;
    const v = validateSheetText(ta.value || '');
    const n = v.blocking.length + v.warnings.length;
    const list = v.blocking.concat(v.warnings).slice(0, 6)
      .map((w) => `<div>${esc(w.line ? 'L' + w.line + ' · ' : '')}${esc(w.msg)}</div>`).join('');
    const html = n ? `<b>${esc(TF('sheet.ed.validate.warn', { n }))}</b>${list}` : '';
    box.innerHTML = html;
  },

  onModalOk() {
    const el = document.getElementById('sblModal');
    if (!el) return;
    if (el.dataset.kind === 'import') {
      const ta = document.getElementById('sblImportText');
      const r = SheetStore.importData(ta ? ta.value : '');
      if (!r.ok || !r.drafts.length) { toast(T('sheet.ed.validate.block'), 'warn'); return; }
      /* F-16：不直接入库，先交给编辑器人工确认；批量仅载入第一首并提示余量 */
      window.gsPendingSheet = r.drafts[0];
      window.gsPendingSheetRest = r.drafts.slice(1);
      this.closeModal();
      toast(T('sheet.lib.toastImported'));
      location.hash = '#/sheetEditor?import=1';
      return;
    }
    if (el.dataset.kind === 'delete') {
      const id = el.dataset.id || '';
      const r = SheetStore.remove(id);
      if (r.ok) { SheetStore.clearDraft(); toast(T('sheet.lib.toastDeleted')); }
      this.closeModal();
      this.render();
      return;
    }
    this.closeModal();
  },

  askDelete(id) {
    const s = SheetStore.get(id);
    if (!s) return;
    const body = `<div class="sb-modal-note">${esc(TF('sheet.lib.deleteAsk', { t: s.title }))}</div>`;
    this.modal(T('sheet.lib.delete'), body, T('sheet.lib.delete'), 'delete');
    const el = document.getElementById('sblModal');
    if (el) el.dataset.id = id;
  },

  /* ---------- 导出 ---------- */
  exportAll() {
    const r = SheetStore.exportAll();
    this.download(r.name, r.data);
    toast(T('sheet.lib.toastExported'));
  },

  download(name, data) {
    try {
      const blob = new Blob([data], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name || 'sheet.txt';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) {} }, 1000);
    } catch (e) { /* 无下载能力时静默降级 */ }
  },

  /* ---------- 全屏弹唱预览（F-15：试听器全屏化，M1 不接评分） ---------- */
  openPlay(id) {
    const s = SheetStore.get(id);
    const root = document.getElementById('sblRoot');
    if (!s || !root) return;
    this.closePlay();
    const el = document.createElement('div');
    el.id = 'sblPlayMask';
    el.className = 'sb-modal-mask';
    const html = `<div class="sb-modal" style="width:min(900px,100%)">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <h3 style="margin:0;flex:1">${esc(s.title)} · ${esc(T('sheet.player.title'))}</h3>
          <button type="button" class="sbe-mini" data-act="playClose">${esc(T('sheet.form.cancel'))}</button>
        </div>
        <div class="sbp-sheet" id="sblPlaySheet">${renderSheetHtml(s.text, { capo: s.capo })}</div>
        <div id="sblPlayControls"></div>
      </div>`;
    el.innerHTML = html;
    root.appendChild(el);
    const sheetEl = el.querySelector('#sblPlaySheet');
    const ctrl = el.querySelector('#sblPlayControls');
    const opts = {
      sheetHost: sheetEl, previewEl: sheetEl, autoScroll: true, displayCapo: s.capo,
      rerender: (pv, o) => { pv.innerHTML = renderSheetHtml(s.text, o); },
    };
    el.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-act="playClose"]')) this.closePlay();
    });
    SheetPlayer.mountControls(ctrl, s, opts);
    SheetPlayer.start(s, opts);
  },

  closePlay() {
    const el = document.getElementById('sblPlayMask');
    if (!el) return;
    try { SheetPlayer.stop(); } catch (e) {}
    if (el.remove) el.remove();
  },

  refreshPlayLang() {
    const el = document.getElementById('sblPlayMask');
    if (!el) return;
    try { SheetPlayer._syncControls(); } catch (e) {}
    if (SheetPlayer.sheet) {
      const pv = el.querySelector('#sblPlaySheet');
      if (pv) pv.innerHTML = renderSheetHtml(SheetPlayer.sheet.text, {
        transpose: SheetPlayer.transpose, capo: SheetPlayer.sheet.capo,
      });
    }
  },
};

if (typeof onRouteEnter !== 'undefined' && onRouteEnter) onRouteEnter.sheetLib = () => SheetLib.enter();
if (typeof window !== 'undefined') window.SheetLib = SheetLib;
export { SheetLib };
export default SheetLib;
