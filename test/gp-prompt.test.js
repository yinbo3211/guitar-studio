/* V4.2.3 · H-6 和弦提示时序回归测试。 */
'use strict';
import test from 'node:test';
import assert from 'node:assert';
import { pickPromptNote } from '../assets/js/gp/song-format.js';

test('P-1 重叠发声区间取开始时间最新的音符', () => {
  const oldChord = { id: 'old', time: 0, dur: 4, midi: [60, 64, 67] };
  const newChord = { id: 'new', time: 2, dur: 1, midi: [62, 66, 69] };
  const hit = pickPromptNote([oldChord, newChord], 2.5, 1);
  assert.strictEqual(hit.note, newChord);
  assert.strictEqual(hit.now, true);
});

test('P-2 未来音符仅在 1.5 拍提前量窗口内显示', () => {
  const inside = { time: 10.9, dur: 0.5, midi: [60] };
  const outside = { time: 11.6, dur: 0.5, midi: [62] };
  assert.deepStrictEqual(pickPromptNote([inside], 10, 1), { note: inside, now: false });
  assert.strictEqual(pickPromptNote([outside], 10, 1), null);
  assert.deepStrictEqual(pickPromptNote([{ ...outside, time: 11.5 }], 10, 1).now, false,
    '窗口边界 1.5 拍应显示');
});

test('P-3 正在发声的音符标记 now=true', () => {
  const note = { time: 4, dur: 2, midi: [60, 64, 67] };
  assert.deepStrictEqual(pickPromptNote([note], 5, 0.5), { note, now: true });
});

test('P-4 空输入、越界时间与 spb=0 返回 null 且不抛错', () => {
  const notes = [{ time: 1, dur: 1, midi: [60] }];
  const calls = [
    () => pickPromptNote([], 0, 1),
    () => pickPromptNote(null, 0, 1),
    () => pickPromptNote(notes, -1, 1),
    () => pickPromptNote(notes, Number.NaN, 1),
    () => pickPromptNote(notes, 10, 1),
    () => pickPromptNote(notes, 0, 0),
  ];
  for (const call of calls) assert.doesNotThrow(() => assert.strictEqual(call(), null));
});
