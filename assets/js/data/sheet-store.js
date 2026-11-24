/* ============================================================
   六弦工坊 V4.4 · data/sheet-store.js（曲谱工坊 T02）
   ------------------------------------------------------------
   自制谱 CRUD / 草稿 / 配额 / 导入导出。数据仅存 localStorage
   （键 gs.sheets.v1 / gs.sheets.draft），不上传服务器（与 PracticeStore 同口径）。
   ★ localStorage 不可用时降级内存；损坏条目隔离不拖垮可用部分。
   ★ 纯函数式对象，可脱离浏览器被 node --test 直接 import。
   权威口径：docs/V4.4_SHEET_STUDIO_SPEC.md §4.2 / F-08 / F-16。
   ============================================================ */
'use strict';

import { SHEET_ENUMS, newSheetTemplate } from './sheet-format.js';

const KEY = 'gs.sheets.v1';
const DRAFT_KEY = 'gs.sheets.draft';
const DRAFT_MAX_AGE = 7 * 24 * 3600 * 1000;   // 草稿 7 天有效

/* SheetDoc 白名单字段（导入过滤 / 归一化共用） */
const FIELDS = [
  'v', 'id', 'kind', 'title', 'artist', 'transcriber', 'key', 'originalKey',
  'tempo', 'timeSig', 'capo', 'language', 'style', 'arrange', 'tags',
  'patternId', 'text', 'createdAt', 'updatedAt',
];
const TEXT_FIELDS = ['title', 'artist', 'transcriber', 'key', 'originalKey', 'timeSig', 'language', 'style', 'arrange', 'patternId'];
const NUM_FIELDS = { v: 1, tempo: 70, capo: 0 };

/* ---------- 存储适配（localStorage 不可用 → 内存） ---------- */
const memory = new Map();
const storage = (() => {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) {
      const probe = '__gs_sheet_probe__';
      localStorage.setItem(probe, '1'); localStorage.removeItem(probe);
      return {
        ok: true,
        get: (k) => localStorage.getItem(k),
        set: (k, v) => localStorage.setItem(k, v),
        remove: (k) => localStorage.removeItem(k),
      };
    }
  } catch (e) { /* 隐私模式/禁用：降级 */ }
  return {
    ok: false,
    get: (k) => (memory.has(k) ? memory.get(k) : null),
    set: (k, v) => memory.set(k, v),
    remove: (k) => memory.delete(k),
  };
})();

/* ---------- 工具 ---------- */
function uid() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch (e) {}
  return 's-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}
function byteSize(str) {
  try { if (typeof Blob !== 'undefined') return new Blob([str]).size; } catch (e) {}
  try { if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str).length; } catch (e) {}
  try { if (typeof Buffer !== 'undefined') return Buffer.byteLength(str, 'utf8'); } catch (e) {}
  return String(str).length;
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const str = (v, max) => String(v == null ? '' : v).slice(0, max == null ? 60 : max);
const int = (v, lo, hi, dflt) => { const n = parseInt(v, 10); return Number.isFinite(n) ? clamp(n, lo, hi) : dflt; };

/** 归一化 / 白名单过滤一个 SheetDoc。非法结构返回 null。 */
export function normalizeSheet(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  out.v = SHEET_ENUMS.SHEET_VERSION || 1;
  out.kind = 'sheet';
  out.id = str(raw.id, 80) || uid();
  out.title = str(raw.title, 60).trim();
  out.artist = str(raw.artist, 60).trim();
  out.transcriber = str(raw.transcriber, 30).trim();
  out.key = str(raw.key, 8) || 'C';
  out.originalKey = str(raw.originalKey, 8) || 'C';
  out.tempo = int(raw.tempo, SHEET_ENUMS.TEMPO_MIN, SHEET_ENUMS.TEMPO_MAX, 70);
  out.timeSig = str(raw.timeSig, 8) || '4/4';
  out.capo = int(raw.capo, 0, SHEET_ENUMS.CAPO_MAX, 0);
  out.language = str(raw.language, 30);
  out.style = str(raw.style, 30);
  out.arrange = str(raw.arrange, 30);
  out.tags = Array.isArray(raw.tags) ? raw.tags.slice(0, 3).map((t) => str(t, 20)).filter(Boolean) : [];
  out.patternId = str(raw.patternId, 40) || SHEET_ENUMS.DEFAULT_PATTERN;
  out.text = String(raw.text == null ? '' : raw.text);
  const now = Date.now();
  out.createdAt = Number.isFinite(raw.createdAt) ? raw.createdAt : now;
  out.updatedAt = Number.isFinite(raw.updatedAt) ? raw.updatedAt : now;
  for (const k of TEXT_FIELDS) out[k] = String(out[k]);
  return out;
}

function emptyData() { return { version: 1, sheets: [] }; }

/** 读全部；损坏条目隔离（保留可用部分），JSON 解析失败返回空并 console.warn。 */
export function readAll() {
  try {
    const raw = storage.get(KEY);
    if (!raw) return { ...emptyData(), degraded: !storage.ok };
    const d = JSON.parse(raw);
    if (!d || typeof d !== 'object' || !Array.isArray(d.sheets)) {
      console.warn('[sheet-store] 数据结构损坏，已忽略');
      return { ...emptyData(), degraded: !storage.ok, corrupt: true };
    }
    const sheets = [], dropped = [];
    for (const item of d.sheets) {
      const n = normalizeSheet(item);
      if (n) sheets.push(n); else dropped.push(item);
    }
    if (dropped.length) console.warn('[sheet-store] 隔离损坏条目', dropped.length, '条');
    return { version: 1, sheets, degraded: !storage.ok, dropped: dropped.length };
  } catch (e) {
    console.warn('[sheet-store] 读取失败，降级为空：', e && e.message);
    return { ...emptyData(), degraded: !storage.ok, corrupt: true };
  }
}

/** 整体写回；返回 {ok, code?, msg?, bytes}。2MB 软上限保护。 */
function writeAll(data) {
  const json = JSON.stringify({ version: 1, sheets: data.sheets });
  const bytes = byteSize(json);
  if (bytes > 2 * 1024 * 1024) return { ok: false, code: 'quota-bytes', msg: 'quota-bytes', bytes };
  try { storage.set(KEY, json); return { ok: true, bytes, degraded: !storage.ok }; }
  catch (e) { return { ok: false, code: 'storage', msg: String(e && e.message || e), bytes }; }
}

/* ---------- CRUD ---------- */
export function list() { return readAll().sheets; }
export function get(id) { return readAll().sheets.find((s) => s.id === id) || null; }

/** 新建一张空 SheetDoc（不入库，供表单/编辑器使用）。 */
export function newSheet(fields = {}) {
  const now = Date.now();
  return normalizeSheet({
    id: uid(), v: 1, kind: 'sheet',
    title: '', artist: '', transcriber: '', key: 'C', originalKey: 'C',
    tempo: 70, timeSig: '4/4', capo: 0, language: '', style: '', arrange: '',
    tags: [], patternId: SHEET_ENUMS.DEFAULT_PATTERN,
    text: newSheetTemplate(fields), createdAt: now, updatedAt: now,
    ...fields,
  });
}

/**
 * 保存（新增或更新）。配额：曲目数 200 / 单谱文本 50K / 总 2MB。
 * @returns {{ok, sheet?, code?, msg?}}
 */
export function save(doc) {
  const n = normalizeSheet(doc);
  if (!n) return { ok: false, code: 'invalid', msg: 'invalid' };
  if (!n.title) return { ok: false, code: 'no-title', msg: 'no-title' };
  if (n.text.length > SHEET_ENUMS.TEXT_MAX) return { ok: false, code: 'text-too-long', msg: 'text-too-long' };
  const data = readAll();
  const idx = data.sheets.findIndex((s) => s.id === n.id);
  if (idx < 0 && data.sheets.length >= SHEET_ENUMS.SHEET_MAX) return { ok: false, code: 'too-many', msg: 'too-many' };
  n.updatedAt = Date.now();
  if (idx >= 0) data.sheets[idx] = { ...data.sheets[idx], ...n };
  else data.sheets.push(n);
  const w = writeAll(data);
  if (!w.ok) return { ok: false, code: w.code, msg: w.msg, bytes: w.bytes };
  return { ok: true, sheet: n, degraded: w.degraded };
}

export function remove(id) {
  const data = readAll();
  const before = data.sheets.length;
  data.sheets = data.sheets.filter((s) => s.id !== id);
  if (data.sheets.length === before) return { ok: false, code: 'not-found' };
  const w = writeAll(data);
  return { ok: w.ok, code: w.code };
}

export function duplicate(id) {
  const src = get(id);
  if (!src) return { ok: false, code: 'not-found' };
  const data = readAll();
  if (data.sheets.length >= SHEET_ENUMS.SHEET_MAX) return { ok: false, code: 'too-many' };
  const now = Date.now();
  const copy = normalizeSheet({ ...src, id: uid(), title: (src.title + '(副本)').slice(0, 60), createdAt: now, updatedAt: now });
  return save(copy);
}

/* ---------- 草稿（F-08） ---------- */
export function writeDraft(doc, text) {
  const payload = { doc: normalizeSheet(doc) || doc || null, text: String(text == null ? '' : text), savedAt: Date.now() };
  try { storage.set(DRAFT_KEY, JSON.stringify(payload)); return { ok: true }; }
  catch (e) { return { ok: false, code: 'storage' }; }
}
export function readDraft() {
  try {
    const raw = storage.get(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || typeof d !== 'object' || !Number.isFinite(d.savedAt)) return null;
    if (Date.now() - d.savedAt > DRAFT_MAX_AGE) return null;   // 过期草稿视为不存在
    return d;
  } catch (e) { return null; }
}
export function clearDraft() { try { storage.remove(DRAFT_KEY); return true; } catch (e) { return false; } }

/* ---------- 导入 / 导出（F-16） ---------- */
/** 导出单谱：'txt' 返回源文本，'json' 返回 SheetDoc JSON。 */
export function exportOne(id, fmt = 'txt') {
  const s = get(id);
  if (!s) return { ok: false, code: 'not-found' };
  return { ok: true, name: `${(s.title || 'untitled').replace(/[\\/:*?"<>|]/g, '_')}-${(s.artist || '').replace(/[\\/:*?"<>|]/g, '_')}.gsc.${fmt === 'json' ? 'json' : 'txt'}`, data: fmt === 'json' ? JSON.stringify(s, null, 2) : s.text, sheet: s };
}
/** 全部导出为单个 JSON。 */
export function exportAll() {
  return { ok: true, name: 'guitar-studio-sheets.json', data: JSON.stringify({ version: 1, exportedAt: Date.now(), sheets: list() }, null, 2) };
}
/**
 * 导入：接受单谱 .txt / .json 或批量 JSON。
 * .txt 作为新建谱草稿返回（不直接入库，需经编辑器人工确认，F-16）。
 * @returns {{ok, imported:number, skipped:Array, drafts:Array, code?}}
 */
export function importData(raw, opts = {}) {
  const text = String(raw == null ? '' : raw).trim();
  if (!text) return { ok: false, code: 'empty', imported: 0, skipped: [], drafts: [] };
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (e) { /* 视为纯文本谱 */ }
  const drafts = [], skipped = [];
  let imported = 0;
  const pushDoc = (obj, i) => {
    const n = normalizeSheet(obj);
    if (!n) { skipped.push({ index: i, reason: 'invalid' }); return; }
    if (!n.title) { skipped.push({ index: i, reason: 'no-title' }); return; }
    if (n.text.length > SHEET_ENUMS.TEXT_MAX) { skipped.push({ index: i, reason: 'text-too-long' }); return; }
    if (opts.commit) {
      const r = save(n);
      if (r.ok) imported++; else skipped.push({ index: i, reason: r.code || 'save-failed' });
    } else drafts.push(n);
  };
  if (parsed && Array.isArray(parsed.sheets)) {
    parsed.sheets.slice(0, 50).forEach((o, i) => pushDoc(o, i));   // 单次导入上限 50
  } else if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    pushDoc(parsed, 0);
  } else {
    /* 纯文本谱：作为一张草稿，标题从 {title} 头标记提取 */
    const m = /\{title:([^}]*)\}/.exec(text);
    drafts.push(normalizeSheet({ id: uid(), title: m ? m[1].trim() : '', text, createdAt: Date.now(), updatedAt: Date.now() }));
  }
  return { ok: true, imported, skipped, drafts };
}

/** 统计（供列表页排序/过滤与统计中心）。 */
export function summary() {
  const sheets = list();
  return { count: sheets.length, max: SHEET_ENUMS.SHEET_MAX, degraded: !storage.ok };
}

const SheetStore = {
  KEY, DRAFT_KEY, FIELDS, list, get, newSheet, save, remove, duplicate,
  writeDraft, readDraft, clearDraft, exportOne, exportAll, importData, summary,
  normalizeSheet, readAll,
};
if (typeof window !== 'undefined') window.SheetStore = SheetStore;
export { SheetStore };
export default SheetStore;
