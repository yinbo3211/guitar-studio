/* ============================================================
   六弦工坊 V4.2.4 · test/data-scales.test.js
   ------------------------------------------------------------
   N-8 补测清单第 7 项：data/scales.js（音阶数据）
   SC-1 SCALE_TYPES 结构合法（name 非空 / iv 严格递增 / 落在 0..11）
   SC-2 各调式的音数符合其定义（七声 7 音、五声 5 音、布鲁斯 6 音）
   SC-3 SCALE_LIST 每项的 type 必须存在于 SCALE_TYPES
        （拼错会在练习页取 iv 时得到 undefined → 崩指明 rare crash）
   SC-4 SCALE_LIST 每项的 root 是可解析音名、pos 为非负整数
   SC-5 以 C 大调推算的首个八度音级集合长度与 iv 一致（无重复音级）
   SC-6 window.SCALE_TYPES / SCALE_LIST 注入成功
   ============================================================ */
'use strict';
import test from 'node:test';
import assert from 'node:assert/strict';

await import('./_gp-stubs.mjs');
const { SCALE_TYPES, SCALE_LIST } = await import('../assets/js/data/scales.js');
const { pcFromName } = await import('../assets/js/core/audio-core.js');

const TYPES = Object.keys(SCALE_TYPES);

test('SC-1 SCALE_TYPES 结构合法（name 非空 / iv 递增且落在 0..11）', () => {
  assert.ok(TYPES.length >= 6, `调式数量应 >= 6，实测 ${TYPES.length}`);
  for (const key of TYPES) {
    const t = SCALE_TYPES[key];
    assert.equal(typeof t.name, 'string', `${key}.name 应为字符串`);
    assert.ok(t.name.length > 0, `${key}.name 不应为空`);
    assert.ok(Array.isArray(t.iv), `${key}.iv 应为数组`);
    assert.ok(t.iv.length >= 5, `${key}.iv 至少 5 个音，实测 ${t.iv.length}`);
    assert.equal(t.iv[0], 0, `${key}.iv 必须以主音 0 起算`);
    for (let i = 0; i < t.iv.length; i++) {
      assert.ok(Number.isInteger(t.iv[i]), `${key}.iv[${i}] 应为整数`);
      assert.ok(t.iv[i] >= 0 && t.iv[i] <= 11, `${key}.iv[${i}] 应落在 0..11`);
      if (i > 0) assert.ok(t.iv[i] > t.iv[i - 1], `${key}.iv 应严格递增`);
    }
  }
});

test('SC-2 各调式音数符合其定义', () => {
  const expect = {
    major: 7, minor: 7, dorian: 7,
    majorPent: 5, minorPent: 5,
    blues: 6,
  };
  for (const key of TYPES) {
    if (expect[key] === undefined) continue;
    assert.equal(SCALE_TYPES[key].iv.length, expect[key], `${key} 音数不符`);
  }
  assert.deepEqual(SCALE_TYPES.major.iv, [0, 2, 4, 5, 7, 9, 11]);
  assert.deepEqual(SCALE_TYPES.minor.iv, [0, 2, 3, 5, 7, 8, 10]);
});

test('SC-3 SCALE_LIST 每项 type 必须在 SCALE_TYPES 内', () => {
  assert.ok(SCALE_LIST.length >= 10, `音阶练习条目应 >= 10，实测 ${SCALE_LIST.length}`);
  for (const s of SCALE_LIST) {
    assert.ok(TYPES.includes(s.type), `${s.root}/${s.type} 的 type 不在 SCALE_TYPES 内`);
    assert.ok(Array.isArray(SCALE_TYPES[s.type].iv));
  }
});

test('SC-4 SCALE_LIST 每项 root 可解析、pos 为非负整数', () => {
  for (const s of SCALE_LIST) {
    const pc = pcFromName(s.root);
    assert.notEqual(pc, -1, `${s.root} 不是合法音名`);
    assert.ok(pc >= 0 && pc <= 11, `${s.root} 推算出的半音类越界：${pc}`);
    assert.ok(Number.isInteger(s.pos) && s.pos >= 0, `${s.root}/${s.type} 的 pos 非法：${s.pos}`);
  }
});

test('SC-5 root pc + iv 折叠回一个八度后无重复音级', () => {
  for (const s of SCALE_LIST) {
    const root = pcFromName(s.root);
    const pcs = new Set(SCALE_TYPES[s.type].iv.map((iv) => (root + iv) % 12));
    assert.equal(pcs.size, SCALE_TYPES[s.type].iv.length, `${s.root} ${s.type} 出现重复音级`);
  }
});

test('SC-6 window 注入成功（与模块导出同引用）', () => {
  assert.strictEqual(globalThis.SCALE_TYPES, SCALE_TYPES);
  assert.strictEqual(globalThis.SCALE_LIST, SCALE_LIST);
});
