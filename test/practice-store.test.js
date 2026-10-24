// practice-store.test.js — BUG-05 导入/存储测试
import test from 'node:test';
import assert from 'node:assert/strict';

// 模拟 localStorage
const storage = {};
const localStorage = {
  getItem: (k) => storage[k] || null,
  setItem: (k, v) => { storage[k] = String(v); },
  removeItem: (k) => { delete storage[k]; }
};
globalThis.localStorage = localStorage;

// 动态加载模块
const { default: PracticeStore } = await import('../assets/js/core/practice-store.js');

test.afterEach(() => {
  for (const k of Object.keys(storage)) delete storage[k];
});

test('addSession normalizes and saves', () => {
  PracticeStore.addSession({ module: 'tuner', durationMs: 1000, accuracy: 0.8 });
  const list = PracticeStore.getSessions();
  assert.equal(list.length, 1);
  assert.equal(list[0].module, 'tuner');
  assert.ok(list[0].startedAt > 0);
});

test('addSession rejects invalid module', () => {
  const r = PracticeStore.addSession({ module: '', durationMs: 100 });
  assert.equal(r, false);
  assert.equal(PracticeStore.getSessions().length, 0);
});

test('addSession clamps accuracy to [0,1]', () => {
  PracticeStore.addSession({ module: 'ear', accuracy: 1.5 });
  const s = PracticeStore.getSessions();
  assert.equal(s[0].accuracy, 1);
});

test('addSession clamps negative duration', () => {
  PracticeStore.addSession({ module: 'ear', durationMs: -100 });
  const s = PracticeStore.getSessions();
  assert.equal(s[0].durationMs, 0);
});

test('importData: normalize each item', () => {
  const raw = JSON.stringify([
    { module: '', durationMs: 100 },
    { module: 'ear', accuracy: 2, durationMs: 100 },
    { module: 'scale', durationMs: -5 }
  ]);
  const r = PracticeStore.importData(raw);
  assert.equal(r.ok, true);
  assert.equal(r.added, 2);
  assert.equal(r.skipped, 1);
  const list = PracticeStore.getSessions();
  assert.equal(list.length, 2);
});

test('importData: preserves external id and dedup', () => {
  PracticeStore.importData(JSON.stringify([{ id: 'a', module: 'ear' }, { id: 'b', module: 'ear' }]));
  const r = PracticeStore.importData(JSON.stringify([{ id: 'a', module: 'ear' }, { id: 'c', module: 'ear' }]));
  assert.equal(r.added, 1);
  assert.equal(r.skipped, 1);
  const list = PracticeStore.getSessions();
  const ids = list.map(s => s.id);
  assert.deepEqual(ids.sort(), ['a','b','c']);
});

test('importData: custom module name accepted', () => {
  const r = PracticeStore.importData(JSON.stringify([{ module: 'chord-flow' }]));
  assert.equal(r.added, 1);
});

test('importData: cap at 5000', () => {
  const arr = [];
  for (let i = 0; i < 5005; i++) arr.push({ id: `bulk-${i}`, module: 'ear', startedAt: Date.now() + i });
  PracticeStore.importData(JSON.stringify(arr));
  const list = PracticeStore.getSessions();
  assert.equal(list.length, 5000);
  // 最新 5000 条保留
  assert.ok(list.find(s => s.id === 'bulk-5004'));
});
