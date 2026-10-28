/* ============================================================
   六弦工坊 V4.2.4 · test/core-store.test.js
   ------------------------------------------------------------
   N-8 补测清单第 8 项：core/store.js（用户偏好持久化）
   ST-1 默认值结构（theme/lang/metro）
   ST-2 写入后可读回，且未指定的键不被抹掉
   ST-3 坏 JSON 静默降级为默认值（不向外抛）
   ST-4 localStorage 不可写时不抛错、仍返回合并后的内存快照
   ST-5 window.gsStore 与模块导出同引用
   ============================================================ */
'use strict';
import test from 'node:test';
import assert from 'node:assert/strict';

await import('./_gp-stubs.mjs');
const { store } = await import('../assets/js/core/store.js');

const KEY = store.KEY;

test('ST-1 默认偏好结构完整（theme=auto / lang=zh-CN / metro={}）', () => {
  localStorage.removeItem(KEY);
  const prefs = store.read();
  assert.equal(prefs.theme, 'auto');
  assert.equal(prefs.lang, 'zh-CN');
  assert.deepEqual(prefs.metro, {});
  assert.equal(KEY, 'gs.prefs');
});

test('ST-2 写入后可读回，且未写入的键保留默认值', () => {
  localStorage.removeItem(KEY);
  const next = store.write({ lang: 'en' });
  assert.equal(next.lang, 'en');
  assert.equal(next.theme, 'auto', '未指定的 theme 不应被抹掉');
  assert.equal(store.read().lang, 'en');
  const merged = store.write({ metro: { bpm: 120 } });
  assert.equal(store.read().lang, 'en', '第二次 patch 不应丢失上一次的 lang');
  assert.equal(merged.metro.bpm, 120);
});

test('ST-3 坏 JSON 静默降级为默认值（不抛异常）', () => {
  localStorage.setItem(KEY, '{not-json');
  let prefs = null;
  assert.doesNotThrow(() => { prefs = store.read(); });
  assert.equal(prefs.theme, 'auto');
  assert.equal(prefs.lang, 'zh-CN');
});

test('ST-4 localStorage 写入异常时不抛错，仍返回合并后的快照', () => {
  localStorage.removeItem(KEY);
  const realSet = localStorage.setItem;
  localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
  try {
    let next = null;
    assert.doesNotThrow(() => { next = store.write({ lang: 'ja' }); });
    assert.equal(next.lang, 'ja');
    assert.equal(next.theme, 'auto');
  } finally {
    localStorage.setItem = realSet;
  }
});

test('ST-5 window.gsStore 与模块导出同引用（宿主注入一致性）', () => {
  assert.strictEqual(globalThis.gsStore, store);
  assert.equal(typeof store.read, 'function');
  assert.equal(typeof store.write, 'function');
});
