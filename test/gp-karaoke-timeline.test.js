/* ============================================================
   六弦工坊 V4.2.4 · test/gp-karaoke-timeline.test.js
   ------------------------------------------------------------
   KT-1 中文歌词按字切分（N-5）
   KT-2 逐字时间连续且递增（Σdur === span 护栏）
   KT-3 英文歌词仍按空格切词（保持旧行为）
   KT-4 activeAt 边界与 timelineDuration
   KT-5 自带词级时间戳的行原样保留
   KT-6 CJK 行经 lineFillHTML 渲染不含词间空格
   KT-7 allocate() 夹紧区间与闭合性（长/短极端行）
   ------------------------------------------------------------
   手册纠偏：「长亭外古道边」是 6 个字（非 7），KT-1 按实际字数断言。
   ============================================================ */
'use strict';
import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

const { buildLyricTimeline, activeAt, timelineDuration, tokenizeLine, allocate } =
  await imp('assets/js/gp/karaoke-timeline.js');
const { lineFillHTML } = await imp('assets/js/gp/karaoke-render.js');

const MIN_WORD_DUR = 0.12;
const MAX_WORD_DUR = 1.20;

test('KT-1 中文歌词应按字切分', () => {
  const tl = buildLyricTimeline({ lyrics: [{ time: 0, dur: 7, text: '长亭外古道边' }] });
  const chars = [...'长亭外古道边'];
  assert.strictEqual(chars.length, 6, '「长亭外古道边」实为 6 字（手册写 7，已纠偏）');
  assert.strictEqual(tl.lines[0].words.length, 6);
  assert.deepStrictEqual(tl.lines[0].words.map((w) => w.text), chars);
  assert.strictEqual(tokenizeLine('长亭外古道边').length, 6);
  /* 空行/纯标点行不给 WD 分配时间片 */
  assert.deepStrictEqual(tokenizeLine(''), []);
  assert.deepStrictEqual(tokenizeLine('  ，。！ '), []);
});

test('KT-2 中文词时间应连续且递增（Σdur === span）', () => {
  const tl = buildLyricTimeline({ lyrics: [{ time: 10, dur: 7, text: '长亭外古道边' }] });
  const ws = tl.lines[0].words;
  ws.forEach((w, i) => {
    assert.ok(w.dur > 0, '每字时长须为正');
    if (i) assert.ok(Math.abs(ws[i - 1].end - w.t) < 1e-6, '相邻词时间应衔接');
  });
  assert.strictEqual(ws[0].t, 10);
  /* 闭合性：allocate() 保证 Σdur === span，逐字 dur 经 toFixed(3) 落盘，
     故允许 n×0.001 的取整误差（不影响相邻衔接） */
  const sum = ws.reduce((a, w) => a + w.dur, 0);
  const tol = ws.length * 0.001 + 1e-6;
  assert.ok(Math.abs(sum - tl.lines[0].dur) <= tol, `Σdur 应等于行长，实际 ${sum}`);
  assert.ok(Math.abs(ws[ws.length - 1].end - (10 + 7)) <= tol, '行尾须对齐到行的 end');
});

test('KT-3 英文歌词仍按空格切分（保持旧行为，不得逐字符拆）', () => {
  const tl = buildLyricTimeline({ lyrics: [{ time: 0, dur: 4, text: 'hello world again' }] });
  assert.strictEqual(tl.lines[0].words.length, 3);
  assert.deepStrictEqual(tl.lines[0].words.map((w) => w.text), ['hello', 'world', 'again']);
});

test('KT-4 activeAt 边界', () => {
  const tl = buildLyricTimeline({
    lyrics: [{ time: 5, dur: 4, text: 'abcdefgh' }, { time: 9, dur: 4, text: 'ijklmnop' }],
  });
  assert.strictEqual(activeAt(tl, 0).lineIdx, -1);
  assert.strictEqual(activeAt(tl, 6).lineIdx, 0);
  assert.strictEqual(activeAt(tl, 10).lineIdx, 1);
  assert.strictEqual(timelineDuration(tl), 13);
});

test('KT-5 已有词级时间戳应原样保留', () => {
  const tl = buildLyricTimeline({
    lyrics: [{ time: 0, dur: 4, text: 'ab', words: [{ t: 0, text: 'a' }, { t: 2, text: 'b' }] }],
  });
  assert.strictEqual(tl.hasWordTiming, true);
  assert.strictEqual(tl.lines[0].words.length, 2);
  assert.strictEqual(tl.lines[0].words[0].dur, 2);
});

test('KT-6 CJK 行经 lineFillHTML 渲染不含词间空格', () => {
  const tl = buildLyricTimeline({ lyrics: [{ time: 0, dur: 7, text: '长亭外古道边' }] });
  const html = lineFillHTML(tl.lines[0], 2, 0.5);
  assert.ok(!/<\/span>\s+<span/.test(html), `CJK 词间不得插空格：${html.slice(0, 80)}`);
  assert.ok(html.includes('长') && html.includes('亭'), '应逐字渲染');
  /* 拉丁行仍需空格，否则英文单词会粘成一串 */
  const en = buildLyricTimeline({ lyrics: [{ time: 0, dur: 4, text: 'hello world' }] });
  assert.ok(/<\/span> <span/.test(lineFillHTML(en.lines[0], 0, 0.5)), '英文行应保留词间空格');
});

test('KT-7 allocate() 夹紧 [0.12, 1.20] 且恒闭合', () => {
  /* 均匀中期 bites：总时长恰当的情形应落在夹紧区间内 */
  const mid = allocate([1, 1, 1, 1], 4);
  assert.strictEqual(mid.length, 4);
  assert.ok(Math.abs(mid.reduce((a, b) => a + b, 0) - 4) < 1e-9, 'Σdur 须闭合');
  for (const d of mid) assert.ok(d >= MIN_WORD_DUR - 1e-9 && d <= MAX_WORD_DUR + 1e-9);

  /* 极端长行（3 字占 44 秒）： clamp 后无处可吸，退化为均分，但 Σ 仍闭合 */
  const long = allocate([1, 1, 1], 44);
  assert.ok(Math.abs(long.reduce((a, b) => a + b, 0) - 44) < 1e-9, '极端长行 Σdur 仍须闭合');

  /* 极端短行（10 字占 0.5 秒）：低于 n*MIN 时均分 */
  const short = allocate(new Array(10).fill(1), 0.5);
  assert.ok(Math.abs(short.reduce((a, b) => a + b, 0) - 0.5) < 1e-9);

  /* 权重不等时仍按权重倾斜，并检查闭合 */
  const skew = allocate([5, 1, 1], 3);
  assert.ok(skew[0] > skew[1], '长词应分到更多时长');
  assert.ok(Math.abs(skew.reduce((a, b) => a + b, 0) - 3) < 1e-9);
  assert.deepStrictEqual(allocate([], 5), []);
});
