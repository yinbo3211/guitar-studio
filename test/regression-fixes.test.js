// regression-fixes.test.js — BUG-02/03/04 源码特征回归测试
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// BUG-02：tuner 完成时应上报 addSession
test('BUG-02: tuner calls PracticeStore.addSession', () => {
  const src = read('assets/js/modules/tuner.js');
  assert.ok(src.includes('PracticeStore'), 'tuner.js should reference PracticeStore');
  assert.ok(src.includes("module: 'tuner'"), 'tuner.js should report module tuner');
  assert.ok(src.includes('sessionStartedAt'), 'tuner.js should track sessionStartedAt');
});

// BUG-02：scale 完成时应上报
test('BUG-02: scale calls PracticeStore.addSession', () => {
  const src = read('assets/js/modules/scale.js');
  assert.ok(src.includes('PracticeStore'), 'scale.js should reference PracticeStore');
  assert.ok(src.includes("module: 'scale'"), 'scale.js should report module scale');
  assert.ok(src.includes('followStartedAt'), 'scale.js should track followStartedAt');
});

// BUG-03：ear 每轮上报后应复位，但保留 streak
test('BUG-03: ear report resets per-round but keeps streak', () => {
  const src = read('assets/js/modules/ear-training.js');
  assert.ok(src.includes('this.n=0'), 'should reset n');
  assert.ok(src.includes('this.ok=0'), 'should reset ok');
  assert.ok(src.includes('this.reactionSum=0'), 'should reset reactionSum');
  assert.ok(src.includes('streak'), 'should keep streak');
});

// BUG-04：plan 用 meta.switches / meta.questions 计数
test('BUG-04: plan counts meta.switches and meta.questions', () => {
  const src = read('assets/js/modules/plan.js');
  assert.ok(src.includes('meta.switches'), 'plan should read meta.switches');
  assert.ok(src.includes('meta.questions'), 'plan should read meta.questions');
});
