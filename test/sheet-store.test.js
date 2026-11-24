/* ============================================================
   六弦工坊 V4.4 · test/sheet-store.test.js
   ------------------------------------------------------------
   自制谱存储层（T02）：CRUD 往返 / 配额（200 首·50K·2MB）/
   损坏条目隔离 / localStorage 降级内存 / 草稿 / 导入白名单 /
   uuid 唯一性 / 导出回导。
   权威口径：docs/V4.4_SHEET_STUDIO_SPEC.md §4.2 / F-08 / F-16。
   ============================================================ */
'use strict';
import test from 'node:test';
import assert from 'node:assert';

/* 在 import 前安装 localStorage 桩：sheet-store.js 模块加载时决定存储适配器 */
class MemStorage {
  constructor() { this.m = new Map(); this.enabled = true; }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) {
    if (!this.enabled) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
    this.m.set(k, String(v));
  }
  removeItem(k) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
const LS = new MemStorage();
globalThis.localStorage = LS;

const S = (await import('../assets/js/data/sheet-store.js')).SheetStore;
const F = await import('../assets/js/data/sheet-format.js');

function reset() { LS.enabled = true; LS.clear(); }
const doc = (over = {}) => S.newSheet({ title: '测试曲', artist: '歌手', text: '{title:测试曲}\n[C]啦', ...over });

test('ST-1 CRUD 往返：save / get / list / remove', () => {
  reset();
  const d = doc();
  const r = S.save(d);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(S.get(d.id).title, '测试曲');
  assert.strictEqual(S.list().length, 1);
  const up = S.save({ ...d, title: '改名' });
  assert.strictEqual(up.ok, true);
  assert.strictEqual(S.list().length, 1, '同 id 更新不新增');
  assert.strictEqual(S.get(d.id).title, '改名');
  assert.strictEqual(S.remove(d.id).ok, true);
  assert.strictEqual(S.list().length, 0);
  assert.strictEqual(S.remove(d.id).code, 'not-found');
});

test('ST-2 白名单归一化：多余字段丢弃，枚举/数值钳制，必填标题拦截', () => {
  reset();
  const n = S.normalizeSheet({
    id: 'x', title: 'T', artist: 'A', evil: '<script>', constructor: 'bad',
    tempo: 9999, capo: 99, tags: ['a', 'b', 'c', 'd'], text: '{title:T}',
  });
  assert.ok(n && !('evil' in n));
  assert.strictEqual(n.tempo, F.SHEET_ENUMS.TEMPO_MAX);
  assert.strictEqual(n.capo, F.SHEET_ENUMS.CAPO_MAX);
  assert.strictEqual(n.tags.length, 3);
  assert.strictEqual(n.v, 1);
  assert.strictEqual(n.kind, 'sheet');
  assert.strictEqual(S.save({ title: '', text: '{title:}' }).code, 'no-title');
  assert.strictEqual(S.normalizeSheet(null), null);
  assert.strictEqual(S.normalizeSheet([]), null);
});

test('ST-3 单谱文本 50K 上限', () => {
  reset();
  const over = F.SHEET_ENUMS.TEXT_MAX + 1;
  const r = S.save(doc({ text: '{title:测试曲}\n' + 'x'.repeat(over) }));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'text-too-long');
});

test('ST-4 曲目数 200 首上限', () => {
  reset();
  const docs = Array.from({ length: F.SHEET_ENUMS.SHEET_MAX }, (_, i) => doc({ id: 'id-' + i, title: 'T' + i }));
  LS.setItem(S.KEY, JSON.stringify({ version: 1, sheets: docs }));
  assert.strictEqual(S.list().length, 200);
  const r = S.save(doc({ id: 'overflow' }));
  assert.strictEqual(r.code, 'too-many');
  assert.strictEqual(S.duplicate('id-0').code, 'too-many');
});

test('ST-5 总容量 2MB 软上限（写入前 Blob 预估）', () => {
  reset();
  const big = 'x'.repeat(2 * 1024 * 1024);
  LS.setItem(S.KEY, JSON.stringify({ version: 1, sheets: [{ title: 'big', text: big }] }));
  const r = S.save(doc({ id: 'after-big' }));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'quota-bytes');
});

test('ST-6 损坏 JSON 与坏条目隔离（可用部分照常展示）', () => {
  reset();
  LS.setItem(S.KEY, '{ this is not json');
  const c = S.readAll();
  assert.strictEqual(c.corrupt, true);
  assert.deepStrictEqual(c.sheets, []);
  LS.setItem(S.KEY, JSON.stringify({ version: 1, sheets: [null, 42, { title: 'OK', text: '{title:OK}' }, 'str'] }));
  const d = S.readAll();
  assert.strictEqual(d.sheets.length, 1);
  assert.strictEqual(d.sheets[0].title, 'OK');
  assert.strictEqual(d.dropped, 3);
});

test('ST-7 localStorage 不可用降级内存（与 practice-store 同口径）', async () => {
  const saved = globalThis.localStorage;
  globalThis.localStorage = {
    setItem() { throw new Error('denied'); },
    getItem() { return null; },
    removeItem() { throw new Error('denied'); },
  };
  try {
    const S2 = (await import('../assets/js/data/sheet-store.js?degraded=1')).SheetStore;
    const r = S2.save(S2.newSheet({ title: '内存谱' }));
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.degraded, true);
    assert.strictEqual(S2.list().length, 1);
    assert.strictEqual(S2.summary().degraded, true);
  } finally { globalThis.localStorage = saved; }
});

test('ST-8 草稿写入 / 恢复 / 清除 / 7 天过期', () => {
  reset();
  const d = doc();
  assert.strictEqual(S.readDraft(), null);
  assert.strictEqual(S.writeDraft(d, d.text).ok, true);
  const draft = S.readDraft();
  assert.ok(draft && draft.text === d.text && Number.isFinite(draft.savedAt));
  assert.ok(draft.doc && draft.doc.title === '测试曲');
  LS.setItem(S.DRAFT_KEY, JSON.stringify({ doc: d, text: d.text, savedAt: Date.now() - 8 * 24 * 3600 * 1000 }));
  assert.strictEqual(S.readDraft(), null, '过期草稿视为不存在');
  assert.strictEqual(S.clearDraft(), true);
  assert.strictEqual(S.readDraft(), null);
});

test('ST-9 导入白名单：多余字段丢弃、批量上限 50、纯文本谱保留', () => {
  reset();
  const payload = JSON.stringify({ version: 1, sheets: [
    { id: 'a', title: 'A', text: '{title:A}\n[C]啦', evil: '<img src=x>', hacked: true },
    { id: 'b', title: '', text: '{title:}' },
  ] });
  const r = S.importData(payload);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.drafts.length, 1);
  assert.ok(!('evil' in r.drafts[0]) && !('hacked' in r.drafts[0]));
  assert.ok(r.skipped.some((s) => s.reason === 'no-title'));
  const many = JSON.stringify({ version: 1, sheets: Array.from({ length: 60 }, (_, i) => ({ title: 'T' + i, text: '{title:T}\n[C]x' })) });
  assert.strictEqual(S.importData(many).drafts.length, 50, '单次导入上限 50');
  const txt = S.importData('{title:文本谱}\n{key:C}\n[C]啦');
  assert.strictEqual(txt.drafts.length, 1);
  assert.strictEqual(txt.drafts[0].title, '文本谱');
  assert.ok(S.importData('   ').code === 'empty');
});

test('ST-10 导出 → 回导往返，复制生成新 id 与副本后缀', () => {
  reset();
  const d = doc();
  S.save(d);
  const one = S.exportOne(d.id, 'json');
  assert.strictEqual(one.ok, true);
  assert.ok(one.name.endsWith('.gsc.json'));
  const back = S.importData(one.data);
  assert.strictEqual(back.drafts[0].title, '测试曲');
  const all = S.exportAll();
  const parsed = JSON.parse(all.data);
  assert.strictEqual(parsed.sheets.length, 1);
  assert.ok(Number.isFinite(parsed.exportedAt));
  const cp = S.duplicate(d.id);
  assert.strictEqual(cp.ok, true);
  assert.notStrictEqual(cp.sheet.id, d.id);
  assert.ok(cp.sheet.title.includes('(副本)'));
  assert.strictEqual(S.list().length, 2);
});

test('ST-11 uuid 唯一性（含 crypto.randomUUID 降级路径）', () => {
  reset();
  const ids = new Set(Array.from({ length: 120 }, () => S.newSheet({ title: 'x' }).id));
  assert.strictEqual(ids.size, 120);
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  try {
    Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true });
    const a = S.newSheet({ title: 'x' }).id, b = S.newSheet({ title: 'x' }).id;
    assert.notStrictEqual(a, b, '无 randomUUID 时用时间戳+随机数降级');
  } finally {
    if (desc) Object.defineProperty(globalThis, 'crypto', desc);
  }
});

test('ST-12 存储键与统计契约', () => {
  reset();
  assert.strictEqual(S.KEY, 'gs.sheets.v1');
  assert.strictEqual(S.DRAFT_KEY, 'gs.sheets.draft');
  assert.ok(Array.isArray(S.FIELDS) && S.FIELDS.includes('text') && S.FIELDS.includes('updatedAt'));
  const sum = S.summary();
  assert.strictEqual(sum.count, 0);
  assert.strictEqual(sum.max, 200);
  assert.strictEqual(sum.degraded, false);
});
