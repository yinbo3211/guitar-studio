/* ============================================================
   六弦工坊 V4.2.4 · test/modules-recorder.test.js
   ------------------------------------------------------------
   N-8 补测清单第 6 项：modules/recorder.js（录音棚）
   RC-1 时长格式化 fmt()
   RC-2 浏览器不支持 MediaRecorder 时不申请麦克风（P1-08 泄漏回归）
   RC-3 正常开录：进入 recording，电平表只有 1 个在排的 rAF
   RC-4 stop 后硬件与定时器全部归位，旧会话数据被保存（Bug3 / P1-3 回归）
   RC-5 stop 幂等：重复 stop 不抛错、不二次释放
   RC-6 列表为空时 render() 清空 DOM（P1-07 回归）
   RC-7 onRouteEnter.studio 注入与 window.Studio 同引用
   ------------------------------------------------------------
   说明：MediaRecorder / getUserMedia 使用测试替身，真实录音链路
   （浏览器媒体栈）无法在 Node 内验证，故断言聚焦「资源不泄漏」这一
   历史上真实发生过的缺陷面（P1-3、Bug3）。
   ============================================================ */
'use strict';
import test from 'node:test';
import assert from 'node:assert/strict';

const stubs = await import('./_gp-stubs.mjs');
const raf = stubs.installRafQueue();

const { Studio } = await import('../assets/js/modules/recorder.js');

function reset() {
  Studio.items = [];
  Studio.idx = 0;
  Studio.rec = null;
  Studio.stream = null;
  Studio.ac = null;
  Studio.analyser = null;
  Studio.raf = null;
  Studio.tickTimer = null;
  Studio._session = 0;
  /* 注意：不要 restore raf 队列。_gp-dom.mjs 的默认 requestAnimationFrame 是
     同步回调，一旦还原，Studio._levelLoop 的递归排帧会立刻栈溢出并落进
     toggle() 的 catch——那正是 Ring-3 想验证的「异常路径」之外的问题。 */
}

test('RC-1 时长格式化 fmt()', () => {
  reset();
  assert.equal(Studio.fmt(0), '00:00');
  assert.equal(Studio.fmt(9.6), '00:09');
  assert.equal(Studio.fmt(65), '01:05');
  assert.equal(Studio.fmt(600), '10:00');
  assert.equal(Studio.fmt(3599), '59:59');
});

test('RC-2 不支持 MediaRecorder 时不申请麦克风（P1-08 泄漏回归）', async () => {
  reset();
  const mr = stubs.installMediaRecorder({ available: false });
  try {
    await Studio.toggle();
    assert.equal(mr.log.gumCalls, 0, '未做支持性检查就申请了麦克风 → getUserMedia 返回的 stream 永远不会被释放');
    assert.equal(Studio.rec, null);
    assert.equal(Studio.stream, null);
  } finally {
    mr.restore();
  }
});

test('RC-3 正常开录：进入 recording，电平表仅排 1 帧', async () => {
  reset();
  const mr = stubs.installMediaRecorder();
  try {
    await Studio.toggle();
    assert.ok(Studio.rec, '应已创建 MediaRecorder');
    assert.equal(Studio.rec.state, 'recording');
    assert.equal(mr.log.gumCalls, 1);
    assert.ok(Studio.ac, '电平表应建立 AudioContext');
    assert.ok(Studio.analyser, '电平表应建立 AnalyserNode');
    assert.equal(raf.size(), 1, '电平表应只保留 1 个在排的帧');
    globalThis.$('#recBtn').classList.contains('recording');
  } finally {
    Studio.stop();
    mr.restore();
  }
});

test('RC-4 stop 后硬件与定时器全部归位，录音数据入列', async () => {
  reset();
  const mr = stubs.installMediaRecorder();
  try {
    await Studio.toggle();
    Studio.stop();
    assert.equal(Studio.rec, null, 'stop 后 rec 必须解绑');
    assert.equal(Studio.stream, null, 'stop 后 stream 必须解绑（麦克风指示灯不能常亮）');
    assert.equal(Studio.ac, null, 'stop 后 AudioContext 必须解绑');
    assert.equal(Studio.analyser, null, 'stop 后 analyser 必须解绑（Fix-7）');
    assert.equal(Studio.tickTimer, null, '计时器必须被清理');
    assert.equal(Studio.raf, null, 'rAF 句柄必须被清理');
    assert.equal(raf.size(), 0, 'stop 后不应再有任何在排的帧');
    assert.ok(Studio.items.length >= 1, 'onstop 应把本会话数据存入列表');
    const latest = Studio.items[0];
    assert.ok(['mp4', 'ogg', 'webm'].includes(latest.ext), `扩展名非法：${latest.ext}`);
    assert.equal(typeof latest.dur, 'number');
  } finally {
    mr.restore();
  }
});

test('RC-5 stop 幂等：重复 stop 不抛错、不二次释放', async () => {
  reset();
  const mr = stubs.installMediaRecorder();
  try {
    await Studio.toggle();
    Studio.stop();
    const itemsAfter = Studio.items.length;
    assert.doesNotThrow(() => { Studio.stop(); Studio.stop(); });
    assert.equal(Studio.items.length, itemsAfter, '重复 stop 不应重复入列');
    assert.equal(Studio.rec, null);
    assert.equal(Studio.raf, null);
  } finally {
    mr.restore();
  }
});

test('RC-6 列表为空时 render() 清空 DOM（P1-07 回归）', () => {
  reset();
  const list = globalThis.$('#recList');
  Studio.items = [{
    url: 'blob:x', ext: 'webm', dur: 3.2, name: '录音 1',
  }];
  Studio.render();
  assert.ok(list.innerHTML.includes('rec-item'), '非空时应渲染条目');
  Studio.items = [];
  Studio.render();
  assert.equal(list.innerHTML, '', '清空后必须同步清空 DOM，否则旧的 <audio> 节点会留在页面上');
});

test('RC-7 onRouteEnter.studio 注入与 window.Studio 同引用', () => {
  assert.strictEqual(globalThis.Studio, Studio);
  assert.equal(typeof globalThis.onRouteEnter.studio, 'function');
});
