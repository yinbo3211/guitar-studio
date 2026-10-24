/* ============================================================
   六弦工坊 V3.1 · F8 乐理拼写引擎测试矩阵
   ------------------------------------------------------------
   覆盖 PRD F8 验收标准：
     · 12 调大调 / 自然小调拼写与调号
     · 和弦构成音拼写（大/小/减/增/七/挂留）
     · 移调前后级数一致性
     · 全弦全品音名与 MIDI 查询
     · 6/8 拍分组
   ============================================================ */
'use strict';
import test from 'node:test';
import assert from 'node:assert';
const { MusicSpelling: M } = await import('../assets/js/core/music-spelling.js');

/* ---------- 12 调大调拼写 ---------- */
const MAJOR_EXPECT = {
  C:  ['C', 'D', 'E', 'F', 'G', 'A', 'B'],
  G:  ['G', 'A', 'B', 'C', 'D', 'E', 'F#'],
  D:  ['D', 'E', 'F#', 'G', 'A', 'B', 'C#'],
  A:  ['A', 'B', 'C#', 'D', 'E', 'F#', 'G#'],
  E:  ['E', 'F#', 'G#', 'A', 'B', 'C#', 'D#'],
  B:  ['B', 'C#', 'D#', 'E', 'F#', 'G#', 'A#'],
  'F#': ['F#', 'G#', 'A#', 'B', 'C#', 'D#', 'E#'],
  Db: ['Db', 'Eb', 'F', 'Gb', 'Ab', 'Bb', 'C'],
  Ab: ['Ab', 'Bb', 'C', 'Db', 'Eb', 'F', 'G'],
  Eb: ['Eb', 'F', 'G', 'Ab', 'Bb', 'C', 'D'],
  Bb: ['Bb', 'C', 'D', 'Eb', 'F', 'G', 'A'],
  F:  ['F', 'G', 'A', 'Bb', 'C', 'D', 'E']
};

test('F8 12 个大调音阶拼写全部正确', () => {
  for (const [tonic, expect] of Object.entries(MAJOR_EXPECT)) {
    assert.deepStrictEqual(M.scale(tonic, 'major'), expect, `${tonic} 大调拼写错误`);
  }
});

test('F8 自然小调拼写（含关系小调对应）', () => {
  assert.deepStrictEqual(M.scale('A', 'minor'), ['A', 'B', 'C', 'D', 'E', 'F', 'G']);
  assert.deepStrictEqual(M.scale('E', 'minor'), ['E', 'F#', 'G', 'A', 'B', 'C', 'D']);
  assert.deepStrictEqual(M.scale('C', 'minor'), ['C', 'D', 'Eb', 'F', 'G', 'Ab', 'Bb']);
  // 关系小调：C 大调的音级集合应与 A 小调一致（音高类相同）
  const cMajorPc = M.scale('C', 'major').map(n => M.pcOf(M.parseNote(n).letter, M.parseNote(n).acc));
  const aMinorPc = M.scale('A', 'minor').map(n => M.pcOf(M.parseNote(n).letter, M.parseNote(n).acc));
  assert.deepStrictEqual([...cMajorPc].sort((a, b) => a - b), [...aMinorPc].sort((a, b) => a - b));
});

test('F8 调号：升降号数量与顺序', () => {
  assert.deepStrictEqual(M.keySignature('C', 'major'), { type: 'none', count: 0, accidentals: [] });
  const g = M.keySignature('G', 'major');
  assert.strictEqual(g.type, 'sharp'); assert.strictEqual(g.count, 1);
  assert.deepStrictEqual(g.accidentals, ['F#']);
  const e = M.keySignature('E', 'major');
  assert.strictEqual(e.count, 4);
  assert.deepStrictEqual(e.accidentals, ['F#', 'C#', 'G#', 'D#'], '升号顺序应为 F C G D A E B');
  const eb = M.keySignature('Eb', 'major');
  assert.strictEqual(eb.type, 'flat'); assert.strictEqual(eb.count, 3);
  assert.deepStrictEqual(eb.accidentals, ['Bb', 'Eb', 'Ab'], '降号顺序应为 B E A D G C F');
  const fm = M.keySignature('F', 'minor');
  assert.strictEqual(fm.type, 'flat'); assert.strictEqual(fm.count, 4);
});

test('F8 和弦构成音拼写', () => {
  assert.deepStrictEqual(M.chordTones('C', 'maj'), ['C', 'E', 'G']);
  assert.deepStrictEqual(M.chordTones('C', 'min'), ['C', 'Eb', 'G']);
  assert.deepStrictEqual(M.chordTones('B', 'dim'), ['B', 'D', 'F']);
  assert.deepStrictEqual(M.chordTones('C', 'aug'), ['C', 'E', 'G#']);
  assert.deepStrictEqual(M.chordTones('C', 'maj7'), ['C', 'E', 'G', 'B']);
  assert.deepStrictEqual(M.chordTones('D', 'min7'), ['D', 'F', 'A', 'C']);
  assert.deepStrictEqual(M.chordTones('G', 'dom7'), ['G', 'B', 'D', 'F']);
  assert.deepStrictEqual(M.chordTones('C', 'sus4'), ['C', 'F', 'G']);
  assert.deepStrictEqual(M.chordTones('Db', 'maj7'), ['Db', 'F', 'Ab', 'C'], '降调七和弦应正确拼写');
  assert.deepStrictEqual(M.chordTones('F#', 'min'), ['F#', 'A', 'C#']);
});

test('F8 和弦后缀 → 品质解析', () => {
  assert.strictEqual(M.qualityOf(''), 'maj');
  assert.strictEqual(M.qualityOf('m'), 'min');
  assert.strictEqual(M.qualityOf('m7'), 'min7');
  assert.strictEqual(M.qualityOf('7'), 'dom7');
  assert.strictEqual(M.qualityOf('maj7'), 'maj7');
  assert.strictEqual(M.qualityOf('m7b5'), 'm7b5');
  assert.strictEqual(M.qualityOf('dim'), 'dim');
  assert.strictEqual(M.qualityOf('sus4'), 'sus4');
});

test('F8 移调：半音位移与拼写', () => {
  assert.strictEqual(M.transpose('C', 2), 'D');
  assert.strictEqual(M.transpose('C', 1), 'Db');
  assert.strictEqual(M.transpose('C', 1, true), 'C#');
  assert.strictEqual(M.transpose('Eb', 3), 'Gb');
  assert.strictEqual(M.transpose('A', -3), 'F#');
  // 全 12 半音移调后音高类应逐一对应
  for (let s = 0; s < 12; s++) {
    const n = M.transpose('C', s);
    const p = M.parseNote(n);
    assert.strictEqual(M.pcOf(p.letter, p.acc), s % 12, `C +${s} 音高类错误（得到 ${n}）`);
  }
});

test('F8 移调前后级数保持一致（调内和弦）', () => {
  // C 大调：I=C IV=F V=G；整体移调 +2（到 D 大调）后级数应仍为 I/IV/V
  const roots = ['C', 'F', 'G'];
  const expectedDegrees = roots.map(r => M.numeral(r, 'C'));
  assert.deepStrictEqual(expectedDegrees, ['I', 'IV', 'V']);
  const moved = roots.map(r => M.transpose(r, 2));
  const newTonic = M.transpose('C', 2);
  const newDegrees = moved.map(r => M.numeral(r, newTonic));
  assert.deepStrictEqual(newDegrees, ['I', 'IV', 'V'], 'C→D 移调后级数应不变');
  // 非调内和弦标注变化音
  assert.strictEqual(M.numeral('Bb', 'C'), 'bVII');
  assert.strictEqual(M.numeral('F#', 'C'), '#IV');
});

test('F8 指板：全弦全品音名与 MIDI 查询', () => {
  const e6 = M.fretNote(0, 0);                 // 6 弦空弦 E2
  assert.strictEqual(e6.midi, 40);
  assert.strictEqual(e6.name, 'E');
  const a1 = M.fretNote(4, 0);                 // 2 弦空弦 A4
  assert.strictEqual(a1.midi, 59);
  const e1 = M.fretNote(5, 0);                 // 1 弦空弦 E4
  assert.strictEqual(e1.midi, 64);
  // 6 弦 5 品 = A（与 5 弦空弦同音）
  assert.strictEqual(M.fretNote(0, 5).midi, M.fretNote(1, 0).midi);
  assert.strictEqual(M.fretNote(0, 5).name, 'A');
  // 12 品为八度关系
  assert.strictEqual(M.fretNote(0, 12).midi - M.fretNote(0, 0).midi, 12);
  // 全指板遍历：0-24 品 × 6 弦，无异常且音高类合法
  for (let s = 0; s < 6; s++) {
    for (let f = 0; f <= 24; f++) {
      const n = M.fretNote(s, f);
      assert.ok(n && n.midi >= 40 && n.midi <= 88, `弦${s} 品${f} 结果异常`);
      assert.ok(/^[A-G][#b]?$/.test(n.name), `音名格式异常：${n.name}`);
    }
  }
  // 查找某音的所有位置：C 应在 5 弦 3 品等处
  const cs = M.findFrets('C');
  assert.ok(cs.length >= 10);
  assert.ok(cs.some(x => x.string === 1 && x.fret === 3));  // 5 弦 3 品 = C3
});

test('F8 6/8 拍分组与常见拍号', () => {
  assert.deepStrictEqual(M.groupBeats(6, 8), [3, 3]);
  assert.deepStrictEqual(M.groupBeats(9, 8), [3, 3, 3]);
  assert.deepStrictEqual(M.groupBeats(12, 8), [3, 3, 3, 3]);
  assert.deepStrictEqual(M.groupBeats(4, 4), [2, 2]);
  assert.deepStrictEqual(M.groupBeats(5, 4), [3, 2]);
  assert.deepStrictEqual(M.groupBeats(7, 8), [4, 3]);
});

test('F8 音名解析与 MIDI 换算', () => {
  assert.deepStrictEqual(M.parseNote('Bb3'), { letter: 'B', acc: -1, octave: 3 });
  assert.deepStrictEqual(M.parseNote('F#'), { letter: 'F', acc: 1, octave: null });
  assert.strictEqual(M.midiOf('C4'), 60, '中央 C 应为 MIDI 60');
  assert.strictEqual(M.midiOf('A4'), 69);
  assert.strictEqual(M.midiOf('Bb3'), 58);
  assert.strictEqual(M.midiOf('!!!'), null, '非法音名应返回 null 而非抛错');
});

test('F8 非法输入不崩溃（鲁棒性）', () => {
  assert.deepStrictEqual(M.scale('X', 'major'), []);
  assert.deepStrictEqual(M.scale('C', 'unknown-mode'), []);
  assert.deepStrictEqual(M.chordTones('C', 'nope'), []);
  assert.strictEqual(M.transpose('?', 3), null);
  assert.strictEqual(M.fretNote(9, 0), null, '越界弦号应返回 null');
  assert.strictEqual(M.fretNote(0, 99), null, '越界品位应返回 null');
  assert.deepStrictEqual(M.findFrets('H'), []);
});
