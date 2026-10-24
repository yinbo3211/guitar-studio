'use strict';
/* ============================================================
   六弦工坊 V3.1 · 缺陷修复回归（前端模块）
   ------------------------------------------------------------
   tuner / scale / ear-training / plan 四个模块在文件顶层解构
   AudioCore、引用 PracticeStore 等浏览器全局，无法在 Node 中直接
   import（模块求值即 ReferenceError）。因此本文件对这些模块沿用
   fixes-20261024.test.js 的「源码特征断言」方式：锁定修复必须
   存在的结构性代码，防止回归被改回旧实现。
   可在 Node 直接 import 的纯逻辑（practice-store / music-spelling）
   的行为用例放在各自测试文件中。
   ============================================================ */
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

/* ---------------- BUG-02：调音器/音阶完成时上报练习数据 ---------------- */

test('回归 BUG-02：调音器六弦全准时上报 module:"tuner" 会话', () => {
  const src = read('assets/js/modules/tuner.js');
  assert.ok(/sessionStartedAt/.test(src), '应存在会话起点字段');
  assert.ok(/this\.sessionStartedAt\s*=\s*Date\.now\(\)/.test(src),
    '开麦成功时应记录会话起点');
  assert.ok(/addSession\(\{[\s\S]*?module:\s*['"]tuner['"]/.test(src),
    '六弦全准分支应调用 PracticeStore.addSession 且 module 为 tuner');
  assert.ok(/this\.tunedSet\.size\s*===?\s*6/.test(src), '上报应由六弦全准条件触发');
  // 上报后必须重置起点，避免下一轮统计进上一轮时长
  const allTuned = src.slice(src.indexOf('this.tunedSet.size===6') > -1
    ? src.indexOf('this.tunedSet.size===6') : src.indexOf('this.tunedSet.size === 6'));
  assert.ok(/addSession[\s\S]{0,600}sessionStartedAt\s*=\s*Date\.now\(\)/.test(allTuned),
    '上报后应重置 sessionStartedAt');
  assert.ok(/strings:\s*6/.test(allTuned), 'meta 应记录 strings:6');
});

test('回归 BUG-02：音阶跟弹结束上报 module:"scale"，且防重复上报', () => {
  const src = read('assets/js/modules/scale.js');
  assert.ok(/followStartedAt/.test(src) && /followReported/.test(src),
    '应存在跟弹起点与「已上报」防重标志');
  assert.ok(/this\.followReported\s*=\s*false/.test(src),
    'startFollow 应复位防重标志');
  const finish = src.slice(src.indexOf('finishFollow'));
  assert.ok(/if\s*\(\s*!this\.followReported[\s\S]*?addSession\(\{[\s\S]*?module:\s*['"]scale['"]/.test(finish),
    'finishFollow 应在未上报过时上报 module:"scale"');
  assert.ok(/accuracy:\s*this\.seq\.length\s*\?\s*this\.ok\s*\/\s*this\.seq\.length/.test(finish),
    '正确率应为 ok/seq.length（命中数/序列长度），不能写死');
  assert.ok(/followReported\s*=\s*true/.test(finish), '上报后立即置防重标志');
  assert.ok(/bestCombo/.test(finish), 'meta 应带 bestCombo');
});

/* ---------------- BUG-03：练耳每轮上报后复位计数 ---------------- */

test('回归 BUG-03：练耳 report() 先快照当轮口径，上报后复位 n/ok/反应时', () => {
  const src = read('assets/js/modules/ear-training.js');
  // 只截取 report() 方法体（到下一个对象方法边界），避免扫到 reset/newQuestion 中的 streak=0
  const start = src.indexOf('report(){');
  assert.ok(start > -1, '应存在 report() 方法');
  const body = src.slice(start, src.indexOf('\n  },', start));
  // 复位语句必须存在：n、ok、reactionSum、reactionN 四项归零
  assert.ok(/this\.n\s*=\s*0\s*;?\s*this\.ok\s*=\s*0/.test(body),
    '上报后必须将 n、ok 复位为 0');
  assert.ok(/this\.reactionSum\s*=\s*0/.test(body) && /this\.reactionN\s*=\s*0/.test(body),
    '反应时累计与样本数必须复位');
  // 上报口径使用快照，不能在复位后再读 this.n（旧实现的累计稀释问题）
  assert.ok(/roundN/.test(body), '应先快照当轮 n/ok 再上报');
  assert.ok(/questions:\s*roundN/.test(body), 'meta.questions 必须是当轮题数快照');
  assert.ok(/accuracy:\s*roundN\s*\?\s*roundOk\s*\/\s*roundN/.test(body),
    '正确率必须按当轮快照计算');
  // streak 是跨轮连击，不能在 report() 内清零
  assert.ok(!/this\.(streak|bestStreak)\s*=\s*0/.test(body),
    '连击统计应跨轮保留，不得在 report() 内复位');
});

/* ---------------- BUG-04：计划完成度按业务计数口径 ---------------- */

test('回归 BUG-04：计划计数 flow 按 meta.switches、ear 按 meta.questions 聚合', () => {
  const src = read('assets/js/modules/plan.js');
  // 聚合阶段累加两个业务计数
  assert.ok(/meta\.switches/.test(src), '应从会话 meta.switches 累加切换次数');
  assert.ok(/meta\.questions/.test(src), '应从会话 meta.questions 累加练习题数');
  assert.ok(/switches:\s*0,\s*questions:\s*0/.test(src), '聚合桶应初始化两个计数字段');
  // unitOf 映射不再用 count 充当 flow/ear
  const unitBlock = src.slice(src.indexOf('const unitOf'));
  assert.ok(/flow:\s*s\s*=>\s*s\.switches/.test(unitBlock), 'flow 完成度应取 switches');
  assert.ok(/ear:\s*s\s*=>\s*s\.questions/.test(unitBlock), 'ear 完成度应取 questions');
  assert.ok(/tuner:\s*s\s*=>\s*s\.count/.test(unitBlock), '调音器仍按会话条数');
  assert.ok(/rhythm:\s*s\s*=>\s*Math\.floor\(s\.durationMs\s*\/\s*4000\)/.test(unitBlock),
    '节奏型仍按 4 秒/小节折算');
  // 防回归：旧实现的两个 count 映射不能原样回来
  assert.ok(!/flow:\s*s\s*=>\s*s\.count/.test(unitBlock), 'flow 不得再按会话条数计数');
  const earLine = /ear:\s*s\s*=>\s*([^\n]+)/.exec(unitBlock)[1];
  assert.ok(!/s\.count/.test(earLine), 'ear 不得再按会话条数计数');
});
