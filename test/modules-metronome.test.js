/* ============================================================
   六弦工坊 V4.2.4 · test/modules-metronome.test.js
   ------------------------------------------------------------
   N-8 补测清单第 3 项：modules/metronome.js（节拍器）
   MT-1 默认状态 + onRouteEnter.metro 路由注入
   MT-2 renderDots 点数与拍数一致、首拍 strong、6/8 第 4 拍 sub
   MT-3 toggle/stop 走统一时间轴 Transport（不自算 60/bpm）
   MT-4 stop 后 rAF/timer 均被清理，不再继续排帧（无泄漏）
   MT-5 stop 幂等：重复调用不抛错、状态稳定
   MT-6 渐快训练 _trainerTick 线性插值且到点自动结束
   ------------------------------------------------------------
   说明：Transport 用测试替身（其自身行为由 test/transport.test.js 覆盖），
   本文件只验证 metronome 对它的调用契约与自身状态机。
   ============================================================ */
'use strict';
import test from 'node:test';
import assert from 'node:assert/strict';

const { installRafQueue, installTransport, installAudioEngine } = await import('./_gp-stubs.mjs');

const raf = installRafQueue();
const tlog = installTransport();
installAudioEngine();

const { Metro } = await import('../assets/js/modules/metronome.js');

/* Metro 是模块级单例，各用例间需复位 */
function reset(over = {}) {
  Metro.stop();
  Metro.bpm = 90; Metro.beats = 2; Metro.sub = 1;
  Metro.beat = 0; Metro.subIdx = 0; Metro.visualPos = 0;
  Metro._trainer = null; Metro.voice = 'click'; Metro.swing = 0;
  Object.assign(Metro, over);
}

test('MT-1 默认状态与路由注入', () => {
  reset();
  assert.equal(Metro.bpm, 90);
  assert.equal(Metro.beats, 2);
  assert.equal(Metro.sub, 1);
  assert.equal(Metro.playing, false);
  assert.equal(Metro.timer, null);
  assert.equal(Metro.raf, null);
  assert.equal(typeof globalThis.onRouteEnter.metro, 'function');
  assert.strictEqual(globalThis.Metro, Metro);
});

test('MT-2 renderDots：点数 = 拍数，首拍 strong，6/8 第 4 拍 sub', () => {
  reset({ beats: 4 });
  Metro.renderDots();
  const html4 = globalThis.$('#beatDots').innerHTML;
  const dots4 = html4.match(/data-i="\d"/g) || [];
  assert.equal(dots4.length, 4, `4 拍应渲染 4 个点，实测 ${dots4.length}`);
  assert.ok(/class="beat-dot strong"/.test(html4), '第 1 拍应带 strong');

  reset({ beats: 6 });
  Metro.renderDots();
  const html6 = globalThis.$('#beatDots').innerHTML;
  const dots6 = html6.match(/data-i="\d"/g) || [];
  assert.equal(dots6.length, 6);
  assert.ok(/data-i="3"[^>]*>|data-i="3"/.test(html6), '6 拍应包含第 4 拍节点');
  assert.ok(/class="beat-dot sub"/.test(html6), '6/8 拍的第 4 拍应为次强拍 sub');
});

test('MT-3 toggle/stop 走统一时间轴 Transport（不自算 60/bpm）', async () => {
  reset({ bpm: 120 });
  const before = tlog.setBpm.length;
  await Metro.toggle();
  assert.equal(Metro.playing, true);
  assert.ok(tlog.setBpm.length > before, 'toggle 必须通过 Transport.setBpm 写入 BPM');
  assert.equal(tlog.setBpm[tlog.setBpm.length - 1], 120);
  assert.ok(tlog.start > 0, 'toggle 必须 Transport.start()');

  Metro.stop();
  assert.equal(Metro.playing, false);
  assert.ok(tlog.stop > 0, 'stop 必须 Transport.stop()');
});

test('MT-4 stop 后 rAF/timer 全部清理，不再继续排帧', async () => {
  reset();
  await Metro.toggle();
  assert.equal(raf.size(), 1, 'playing 期间应有且仅有 1 个在排的视觉帧');
  raf.pump(3);
  assert.ok(raf.size() >= 1, 'playing 期间泵帧后应继续排下一帧');

  Metro.stop();
  assert.equal(Metro.timer, null, 'timer 必须被清理（无 setInterval 泄漏）');
  assert.equal(Metro.raf, null, 'raf 句柄必须被清理');
  assert.equal(raf.size(), 0, 'stop 后队列中不应残留任何帧');

  const pumped = raf.pump(5);
  assert.equal(pumped, 0, 'stop 后队列应保持为空');
  assert.equal(Metro.playing, false);
});

test('MT-5 stop 幂等（重复调用不抛错、状态稳定）', () => {
  reset();
  assert.doesNotThrow(() => { Metro.stop(); Metro.stop(); Metro.stop(); });
  assert.equal(Metro.playing, false);
  assert.equal(Metro.timer, null);
  assert.equal(Metro.raf, null);
});

test('MT-6 渐快训练 _trainerTick 线性插值、到点自动结束且不越上限', () => {
  reset({ bpm: 100 });
  const before = tlog.setBpm.length;
  Metro.subIdx = 0;
  Metro._trainer = { from: 100, to: 140, total: 4, done: 0 };
  Metro._trainerTick();
  Metro._trainerTick();
  Metro._trainerTick();
  const pushed = tlog.setBpm.slice(before);
  assert.deepEqual(pushed, [110, 120, 130], '每拍应线性插值到目标 BPM');
  assert.notEqual(Metro._trainer, null, '未到总拍数前不应提前结束');

  Metro._trainerTick();
  assert.equal(Metro._trainer, null, '达到总拍数后应自动结束训练');

  /* 上限保护：目标被 toggle() 钳到 300 时，插值结果不得超过 300 */
  reset({ bpm: 280 });
  const before2 = tlog.setBpm.length;
  Metro.subIdx = 0;
  Metro._trainer = { from: 280, to: 300, total: 4, done: 0 };
  for (let i = 0; i < 3; i++) Metro._trainerTick();
  for (const v of tlog.setBpm.slice(before2)) {
    assert.ok(v >= 30 && v <= 300, `渐快训练中间值应落在 30..300，实测 ${v}`);
  }
});
