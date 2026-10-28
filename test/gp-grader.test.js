/* ============================================================
   六弦工坊 V4.2.4 · test/gp-grader.test.js
   ------------------------------------------------------------
   GR-1 偏差 70 cents 判 off（N-1：修复前恒判 miss）
   GR-2 偏差 30 cents 单帧判 good
   GR-3 偏差 15 cents 两帧判 perfect
   GR-4 完全无输入判 miss
   GR-5 偏差 150 cents 判 miss（半音外仍不算「有输入」）
   GR-6 八度无关：高八度同音名判 perfect
   GR-7 连续 miss 触发 failed
   GR-8 连击倍率上限精确为 2.5，且 play.js 不得再内联倍率公式/gradeLetter
   GR-9 accuracy 与 gradeLetter 边界
   ============================================================ */
'use strict';
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

const { Grader, centsOff, classify, gradeLetter, comboMult, GRADE_DEFAULTS } =
  await imp('assets/js/gp/grader.js');

test('GR-1 偏差 70 cents 应判 off（而非 miss）', () => {
  const g = new Grader();
  const n = { midi: [60] };
  for (let i = 0; i < 5; i++) g.observe(n, 60.7);   // +70 cents
  assert.strictEqual(g.finalize(n), 'off');
  assert.strictEqual(g.counts.off, 1);
  assert.strictEqual(g.health, 100 + GRADE_DEFAULTS.health.off, 'off 扣 7 → 93');
  assert.strictEqual(g.health, 93);
});

test('GR-2 偏差 30 cents 单帧应判 good', () => {
  const g = new Grader();
  const n = { midi: [60] };
  g.observe(n, 60.3);
  assert.strictEqual(g.finalize(n), 'good');
});

test('GR-3 偏差 15 cents 两帧应判 perfect', () => {
  const g = new Grader();
  const n = { midi: [60] };
  g.observe(n, 60.15); g.observe(n, 60.12);
  assert.strictEqual(g.finalize(n), 'perfect');
});

test('GR-4 完全无输入应判 miss', () => {
  const g = new Grader();
  const n = { midi: [60] };
  assert.strictEqual(g.finalize(n), 'miss');
  assert.strictEqual(g.counts.miss, 1);
});

test('GR-5 偏差 150 cents 应判 miss（半音外不占一帧）', () => {
  const g = new Grader();
  const n = { midi: [60] };
  for (let i = 0; i < 5; i++) g.observe(n, 61.5);
  assert.strictEqual(g.finalize(n), 'miss');
  assert.strictEqual(n.frames, undefined, '半音外不得计帧');
});

test('GR-6 八度无关：高八度同音名应判 perfect', () => {
  const g = new Grader();
  const n = { midi: [60] };
  g.observe(n, 72); g.observe(n, 72);               // C5 对 C4
  assert.strictEqual(g.finalize(n), 'perfect');
  assert.strictEqual(centsOff(72, [60]), 0);
});

test('GR-7 连续 miss 应触发 failed', () => {
  const g = new Grader();
  for (let i = 0; i < 12; i++) g.finalize({ midi: [60] });
  assert.strictEqual(g.health, 0);
  assert.strictEqual(g.failed, true);
});

test('GR-8 倍率上限精确为 2.5，且 play.js 不得再内联倍率/gradeLetter', () => {
  const g = new Grader();
  for (let i = 0; i < 40; i++) {
    const n = { midi: [60] };
    g.observe(n, 60); g.observe(n, 60); g.finalize(n);
  }
  /* N-6：上限是 2.5（不是 3.0）。写成 <= 3 的断言在两种决策下都通过，属无效断言 */
  assert.strictEqual(g.mult, 2.5);
  assert.strictEqual(comboMult(32), 2.5);
  assert.strictEqual(comboMult(8), 1.5);
  assert.strictEqual(comboMult(0), 1);
  assert.strictEqual(comboMult(1e6), 2.5, 'streak 再大也封顶 2.5');

  /* 同源双实现已消灭：play.js 必须引用 grader.js 的常量/函数 */
  const playSrc = fs.readFileSync(path.join(ROOT, 'assets/js/gp/play.js'), 'utf8');
  assert.ok(!/Math\.min\(3,\s*Math\.floor\(streak/.test(playSrc),
    'play.js 不得再内联倍率公式，须调用 comboMult()');
  assert.ok(!/function\s+gradeLetter\s*\(/.test(playSrc),
    'play.js 不得保留本地 gradeLetter（与 grader.js 曾逐字节重复）');
  assert.ok(/comboMult\s*\(/.test(playSrc), 'play.js 应调用 comboMult()');
  assert.ok(/OFF_CENTS/.test(playSrc) && /GRADE_DEFAULTS\.observeCents/.test(playSrc),
    'play.js 的观察窗口须由 GRADE_DEFAULTS.observeCents 派生');
});

test('GR-9 accuracy 与 gradeLetter', () => {
  const g = new Grader();
  assert.strictEqual(g.accuracy(), 100);            // 无音符时默认 100
  assert.strictEqual(gradeLetter(97, false), 'S');
  assert.strictEqual(gradeLetter(92, false), 'A');
  assert.strictEqual(gradeLetter(85, false), 'B');
  assert.strictEqual(gradeLetter(70, false), 'C');
  assert.strictEqual(gradeLetter(60, false), 'D');
  assert.strictEqual(gradeLetter(59, false), 'F');
  assert.strictEqual(gradeLetter(100, true), 'F');  // 失败一律 F
  /* classify 三段分支与 observeCents 对齐（off 上界不得早被 good 抢走） */
  assert.strictEqual(classify(1, 70), 'off');
  assert.strictEqual(classify(1, 60), 'good');
  assert.strictEqual(classify(2, 28), 'perfect');
  assert.strictEqual(classify(0, 0), 'miss');
  assert.strictEqual(GRADE_DEFAULTS.observeCents, 100);
  assert.ok(GRADE_DEFAULTS.observeCents > GRADE_DEFAULTS.goodCents,
    '观察窗口必须严格大于 goodCents，否则 off 分支再次不可达（N-1 回归护栏）');
});
