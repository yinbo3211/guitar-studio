/* V4.2.3 · H-1 和弦级指法求解回归测试。 */
'use strict';
import test from 'node:test';
import assert from 'node:assert';
import { performance } from 'node:perf_hooks';
import { GP_CHORD_SONGS } from '../assets/js/gp/songs.js';
import { findSong } from '../assets/js/gp/catalog.js';
import { INSTRUMENTS, solveVoicing } from '../assets/js/gp/notes.js';

const GUITAR = INSTRUMENTS['acoustic-guitar'];

function assertPlayable(midis, positions, capo = 0, maxSpan = 4) {
  assert.strictEqual(positions.length, midis.length, '结果必须与输入 MIDI 等长');
  const playable = positions.filter(Boolean);
  const strings = playable.map((position) => position.string);
  assert.strictEqual(new Set(strings).size, strings.length, '同一根弦最多分配一个音');
  positions.forEach((position, index) => {
    if (!position) return;
    assert.strictEqual(GUITAR.strings[position.string] + capo + position.fret, midis[index],
      '弦音 + capo + 相对品位必须还原输入音高');
  });
  if (playable.length > 1) {
    const frets = playable.map((position) => position.fret);
    assert.ok(Math.max(...frets) - Math.min(...frets) <= maxSpan,
      `把位跨度不得超过 ${maxSpan} 品`);
  }
}

test('V-1 全库所有多音和弦均无同弦冲突，且求解耗时小于 3 秒', () => {
  const startedAt = performance.now();
  let chordCount = 0;
  for (const definition of GP_CHORD_SONGS) {
    const song = findSong(definition.id);
    for (const note of song.notes) {
      if (!Array.isArray(note.midi) || note.midi.length < 2) continue;
      chordCount++;
      const positions = solveVoicing(note.midi, 'acoustic-guitar', song.capo || 0);
      assert.strictEqual(positions.length, note.midi.length, `${definition.id} 结果长度错误`);
      const strings = positions.filter(Boolean).map((position) => position.string);
      assert.strictEqual(new Set(strings).size, strings.length, `${definition.id} 存在同弦冲突`);
    }
  }
  const elapsed = performance.now() - startedAt;
  assert.strictEqual(GP_CHORD_SONGS.length, 231, '应覆盖完整 231 首曲库');
  assert.ok(chordCount > 20000, `应覆盖足够多的和弦事件，实际 ${chordCount}`);
  assert.ok(elapsed < 3000, `全库求解耗时 ${elapsed.toFixed(1)}ms，超过 3 秒`);
});

test('V-2 G 大三和弦落在三根不同弦，音高可还原且跨度不超过 4 品', () => {
  const midis = [55, 59, 62];
  const positions = solveVoicing(midis, 'acoustic-guitar', 0);
  assert.strictEqual(positions.filter(Boolean).length, 3, '三个音都必须可达');
  assertPlayable(midis, positions);
});

test('V-3 C/F 和弦均获得低把位物理可行解', () => {
  for (const midis of [[48, 52, 55], [53, 57, 60]]) {
    const positions = solveVoicing(midis, 'acoustic-guitar', 0);
    assert.strictEqual(positions.filter(Boolean).length, midis.length, `${midis} 应全部可达`);
    assertPlayable(midis, positions);
  }
});

test('V-5 单音不可达返回对应 null，非法乐器与极端音高均不抛错', () => {
  const partial = solveVoicing([20, 55], 'acoustic-guitar', 0);
  assert.strictEqual(partial[0], null, '低于吉他音域的音应标为 null');
  assert.ok(partial[1], '其余可达音仍应给出位置');
  assert.deepStrictEqual(solveVoicing([20, 200], 'acoustic-guitar', 0), [null, null]);
  assert.deepStrictEqual(solveVoicing([60], 'not-an-instrument', 0), [null]);
  assert.deepStrictEqual(solveVoicing(null), []);
});

test('V-6 capo 后返回相对品位，并能用升高后的空弦还原音高', () => {
  const base = [55, 59, 62];
  const capo = 2;
  const shifted = base.map((midi) => midi + capo);
  const withoutCapo = solveVoicing(base, 'acoustic-guitar', 0);
  const withCapo = solveVoicing(shifted, 'acoustic-guitar', capo);
  assert.deepStrictEqual(withCapo, withoutCapo, '整体升高 capo 后，相对指法应保持一致');
  assertPlayable(shifted, withCapo, capo);
});

test('V-7 高频重复求解保持在 3 秒性能预算内', () => {
  const samples = [[55, 59, 62], [48, 52, 55], [53, 57, 60], [57, 60, 64, 67]];
  const startedAt = performance.now();
  for (let index = 0; index < 5000; index++) {
    solveVoicing(samples[index % samples.length], 'acoustic-guitar', index % 4);
  }
  const elapsed = performance.now() - startedAt;
  assert.ok(elapsed < 3000, `5000 次求解耗时 ${elapsed.toFixed(1)}ms，超过 3 秒`);
});
