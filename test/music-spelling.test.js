// music-spelling.test.js — BUG-10 增三和弦后缀修复测试
import test from 'node:test';
import assert from 'node:assert/strict';

const { default: MusicSpelling } = await import('../assets/js/core/music-spelling.js');

test('parseNote basic', () => {
  const n = MusicSpelling.parseNote('C4');
  assert.ok(n);
  assert.equal(n.letter, 'C');
});

test('scale major from C', () => {
  const s = MusicSpelling.scale('C', 'major');
  assert.equal(s.length, 7);
  assert.equal(s[0], 'C');
});

test('chordTones C maj', () => {
  const t = MusicSpelling.chordTones('C', 'maj');
  assert.deepEqual(t, ['C','E','G']);
});

test('qualityOf maj/min/dim', () => {
  assert.equal(MusicSpelling.qualityOf('maj'), 'maj');
  assert.equal(MusicSpelling.qualityOf('min'), 'min');
  assert.equal(MusicSpelling.qualityOf('dim'), 'dim');
});

test('transpose C +7 = G', () => {
  assert.equal(MusicSpelling.transpose('C', 7), 'G');
});

test('numeral I in C', () => {
  assert.equal(MusicSpelling.numeral(1, 'C'), 'I');
});

test('回归 BUG-10: aug / + / +7 all return aug', () => {
  assert.equal(MusicSpelling.qualityOf('aug'), 'aug');
  assert.equal(MusicSpelling.qualityOf('+'), 'aug');
  assert.equal(MusicSpelling.qualityOf('+7'), 'aug');
});

test('回归 BUG-10: trim whitespace around +', () => {
  assert.equal(MusicSpelling.qualityOf('  +  '), 'aug');
});
