/* ============================================================
   六弦工坊 V4.2.4 · test/gp-harmonize.test.js
   ------------------------------------------------------------
   HM-1 C 大调下 C-E-G → [0,'maj']
   HM-2 C 大调下 G-B-D → [7,'maj']
   HM-3 C 大调下 A-C-E → [9,'min']
   HM-4 空小节沿用上一和弦（且返回副本，不是同一数组引用）
   HM-5 全曲和弦序列相邻不重复
   HM-6 barChords 长度 === bars、前导空小节已回填、source 恒为 harmonized-melody
   HM-7 空 OMR / 坏数据不抛错，chords 为空（由调用方兜底 template）
   ============================================================ */
'use strict';
import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

const { harmonizeBar, harmonizeOmr } = await imp('assets/js/gp/harmonize.js');

const mel = (midis) => midis.map((m) => ({ midi: m, weight: 1, onBeat: true }));

test('HM-1 C 大调下 C-E-G 应配 C 大三和弦', () => {
  assert.deepStrictEqual(harmonizeBar(mel([60, 64, 67]), 0, false, null), [0, 'maj']);
});

test('HM-2 C 大调下 G-B-D 应配 G 大三和弦', () => {
  assert.deepStrictEqual(harmonizeBar(mel([67, 71, 74]), 0, false, null), [7, 'maj']);
});

test('HM-3 C 大调下 A-C-E 应配 Am', () => {
  assert.deepStrictEqual(harmonizeBar(mel([69, 72, 76]), 0, false, null), [9, 'min']);
  /* 小调同一组音：应以小调音阶重算（DEGRESS 切换生效） */
  assert.deepStrictEqual(harmonizeBar(mel([69, 72, 76]), 9, true, null), [9, 'min']);
});

test('HM-4 空小节沿用上一和弦，且返回副本（非共享引用）', () => {
  const prev = [7, 'maj'];
  const out = harmonizeBar([], 0, false, prev);
  assert.deepStrictEqual(out, [7, 'maj']);
  assert.notStrictEqual(out, prev, '必须断引用，避免多处空小节被一次性就地污染');
  /* 无 melody 且无 prev → null（调用方据此兜底） */
  assert.strictEqual(harmonizeBar([], 0, false, null), null);
  assert.strictEqual(harmonizeBar(null, 0, false, null), null);
});

test('HM-5 全曲和弦序列相邻不重复', () => {
  const omr = { span: 16, b: 4, n: [[0, 1, [60]], [4, 1, [65]], [8, 1, [67]], [12, 1, [72]]] };
  const r = harmonizeOmr(omr, 4, { keyPc: 0 });
  assert.ok(r.chords.length > 0);
  for (let i = 1; i < r.chords.length; i++) {
    assert.notDeepStrictEqual(r.chords[i], r.chords[i - 1], '相邻和弦不应重复');
  }
  assert.deepStrictEqual(r.chords.map(([pc]) => pc), [0, 5, 0], 'C 音(Dom)son→C、F音→F、G音→C');
  assert.strictEqual(r.source, 'harmonized-melody');
  assert.strictEqual(r.barChords.length, r.bars);
});

test('HM-6 barChords 长度 === bars，前导空小节已回填', () => {
  /* 前 4 拍空 → bar0 无旋律，须用首个成功和弦回填，逐小节数组不得为 null */
  const omr = { span: 16, b: 4, n: [[4, 1, [60]], [8, 1, [67]]] };
  const r = harmonizeOmr(omr, 4, { keyPc: 0 });
  assert.strictEqual(r.bars, 4);
  assert.strictEqual(r.barChords.length, 4);
  for (const c of r.barChords) {
    assert.ok(Array.isArray(c) && c.length === 2, 'barChords 不得含 null 空洞');
  }
  assert.strictEqual(r.barChords[0][0], 0, 'bar0 应回填为首个成功和弦');
});

test('HM-7 空/坏 OMR 不抛错，chords 为空由调用方兜底', () => {
  assert.deepStrictEqual(harmonizeOmr({ span: 16, b: 4, n: [] }, 4, { keyPc: 0 }).chords, []);
  assert.deepStrictEqual(harmonizeOmr(null, 4, {}).chords, []);
  /* span=0 → bars=max(1,…)=1，单个事件仍可能产出和弦（不抛错即可） */
  const zero = harmonizeOmr({ span: 0, b: 4, n: [[0, 1, [60]]] }, 4, {});
  assert.strictEqual(zero.bars, 1);
  assert.ok(Array.isArray(zero.chords));
  /* 非法 midi（字符串/undefined）应被跳过而不是抛错 */
  const dirty = { span: 8, b: 4, n: [[0, 1, ['x', undefined, 60]], [4, 1, [67]]] };
  const r = harmonizeOmr(dirty, 4, { keyPc: 0 });
  assert.ok(r.chords.length > 0, '脏数据也应产出和弦');
  assert.strictEqual(r.source, 'harmonized-melody');
});
