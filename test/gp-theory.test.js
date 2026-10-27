/* V4.2.3 · H-2~H-5 调性与和弦识别回归测试。 */
'use strict';
import test from 'node:test';
import assert from 'node:assert';
import {
  CHORD_TYPES,
  chordName,
  describeMidiSet,
  detectKey,
  identifyChord,
  keyToPc,
} from '../assets/js/gp/theory.js';

test('T-1 keyToPc 解析 12 个调名与小调，非法输入返回 null', () => {
  const keys = [
    ['C', 0], ['Db', 1], ['D', 2], ['Eb', 3], ['E', 4], ['F', 5],
    ['F#', 6], ['G', 7], ['Ab', 8], ['A', 9], ['Bb', 10], ['B', 11],
  ];
  for (const [name, pc] of keys) assert.strictEqual(keyToPc(name), pc, name);
  assert.strictEqual(keyToPc('Am'), 9);
  assert.strictEqual(keyToPc('f#m'), 6);
  for (const invalid of ['', null, 'H', 'C7', 'not-a-key']) assert.strictEqual(keyToPc(invalid), null);
});

test('T-2 detectKey 正确识别合成 C 大调、A 小调，空输入返回 null', () => {
  const cMajor = [
    { midi: [60], dur: 4 }, { midi: [60, 64, 67], dur: 2 },
    { midi: [65, 69, 72], dur: 1 }, { midi: [67, 71, 74], dur: 2 },
    { midi: [60], dur: 4 },
  ];
  const aMinor = [
    { midi: [57], dur: 4 }, { midi: [57, 60, 64], dur: 2 },
    { midi: [62, 65, 69], dur: 1 }, { midi: [64, 68, 71], dur: 2 },
    { midi: [57], dur: 4 },
  ];
  assert.deepStrictEqual(detectKey(cMajor), { pc: 0, minor: false });
  assert.deepStrictEqual(detectKey(aMinor), { pc: 9, minor: true });
  assert.strictEqual(detectKey([]), null);
  assert.strictEqual(detectKey(null), null);
});

test('T-3 低音评分消歧 C6 与 Am7', () => {
  assert.strictEqual(describeMidiSet([60, 64, 67, 69]), 'C6');
  assert.strictEqual(describeMidiSet([57, 60, 64, 67]), 'Am7');
  assert.ok(identifyChord([60, 64, 67, 69]).score >= 100, '返回值应包含评分');
});

test('T-4 dim7、m7b5、6、m6 四类和弦均可识别', () => {
  const cases = [
    [[60, 63, 66, 69], 'dim7', 'Cdim7'],
    [[59, 62, 65, 69], 'm7b5', 'Bm7b5'],
    [[60, 64, 67, 69], 'six', 'C6'],
    [[57, 60, 64, 66], 'm6', 'Am6'],
  ];
  for (const [midis, type, name] of cases) {
    assert.ok(CHORD_TYPES[type], `${type} 应注册在 CHORD_TYPES`);
    const chord = identifyChord(midis);
    assert.strictEqual(chord.type, type, `${midis} 类型`);
    assert.strictEqual(chord.name, name, `${midis} 名称`);
  }
});

test('T-5 调性与 useFlat 显式选项决定升降号拼写', () => {
  assert.strictEqual(chordName(10, 'maj', { keyPc: 5 }), 'Bb', 'F 调应使用降号');
  assert.strictEqual(describeMidiSet([58, 62, 65], { keyPc: 5 }), 'Bb');
  assert.strictEqual(chordName(10, 'maj', { keyPc: 0 }), 'A#', 'C 调沿用升号');
  assert.strictEqual(chordName(10, 'maj', { keyPc: 5, useFlat: false }), 'A#', '显式选项优先');
});

test('T-6 单参调用对既有和弦类型保持原有命名', () => {
  const cases = [
    [[60, 64, 67], 'C'], [[60, 63, 67], 'Cm'], [[60, 63, 66], 'Cdim'],
    [[60, 64, 68], 'Caug'], [[60, 62, 67], 'Csus2'], [[60, 65, 67], 'Csus4'],
    [[60, 64, 67, 71], 'Cmaj7'], [[60, 63, 67, 70], 'Cm7'],
    [[60, 64, 67, 70], 'C7'], [[60, 64, 67, 74], 'Cadd9'], [[60, 67], 'C5'],
  ];
  for (const [midis, expected] of cases) {
    assert.strictEqual(describeMidiSet(midis), expected, `${midis} 应保持 ${expected}`);
  }
});
