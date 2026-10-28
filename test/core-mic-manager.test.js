/* ============================================================
   六弦工坊 V4.2.4 · test/core-mic-manager.test.js
   ------------------------------------------------------------
   N-8 补测清单第 5 项：core/mic-manager.js（麦克风管理，高权限易泄漏）
   MM-1 buildDiagnostics 对各类失败给出非空中文指引与完整字段
   MM-2 非安全上下文（HTTP）同步失败，且不触碰 getUserMedia
   MM-3 无 navigator.mediaDevices 时同步失败（errName=NoAPI）
   MM-4 single-flight：requesting 期间重复 start 复用同一 Promise
   MM-5 正常启动到达 running，stop 后所有采集资源归位
   MM-6 stop 幂等，且 stop 后旧送到的回调会被丢弃（R5 token 校验）
   MM-7 采集帧确实回调 onPitch（详见下方说明）
   ------------------------------------------------------------
   说明：
     这里用 rAF 队列替身驱动 Mic._loop。注入的是**全零音频帧**，
     PitchDetect 对静音不产生有效基频（返回 ≤0），因此只断言
     「回调被触发且入参类型为 number」，不断言具体音高——
     真实音高检测由 test/pitch-nsdf.test.js 覆盖。

   已知观察（本轮只登记、不改代码）：mic-manager.js:118 的 10s 超时定时器
   在 getUserMedia 成功后**不会被 clear**，因此每次成功的采集都会在事件循环里
   留下一个 10 秒的空转定时器（功能无影响，仅让本用例文件耗时 ~10s）。
   修复需改造 start()，属 V4.3 范围，本轮不碰被测文件。
   ============================================================ */
'use strict';
import test from 'node:test';
import assert from 'node:assert/strict';

const stubs = await import('./_gp-stubs.mjs');
const raf = stubs.installRafQueue();

const { Mic, buildDiagnostics } = await import('../assets/js/core/mic-manager.js');

/** 让 navigator.mediaDevices 指向可控实现；keep=true 时保持 getUserMedia 可用 */
function setMediaDevices(keep = true) {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      userAgent: 'node-test',
      mediaDevices: keep ? {
        enumerateDevices: async () => [],
        getUserMedia: async () => ({ getTracks: () => [{ label: 'Mic', stop() {} }] }),
      } : undefined,
    },
  });
}

function setSecureContext(flag) {
  globalThis.isSecureContext = flag;
}

function resetMic() {
  Mic.stop();
  Mic.lastDiagnostics = null;
  Mic.deviceId = null;
  setMediaDevices(true);
  setSecureContext(true);
}

test('MM-1 buildDiagnostics 给出非空指引与完整诊断字段', () => {
  resetMic();
  const known = ['NotAllowedError', 'NotFoundError', 'NotReadableError', 'OverconstrainedError',
    'AbortError', 'TimeoutError', 'NoAPI', 'InsecureContext'];
  for (const name of known) {
    const d = buildDiagnostics({ name });
    assert.equal(d.errName, name);
    assert.equal(typeof d.hint, 'string');
    assert.ok(d.hint.length > 0, `${name} 缺少人话指引`);
    assert.equal(typeof d.secure, 'boolean');
    assert.equal(typeof d.hasAPI, 'boolean');
    assert.equal(typeof d.insecure, 'boolean');
    assert.equal(typeof d.onLanHttp, 'boolean');
    assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(d.at), `${name} 的时间戳格式异常`);
  }
  /* 未知错误必须落到兜底文案，而不是 undefined */
  const unknown = buildDiagnostics({ name: 'SomeBrandNewError' });
  assert.equal(typeof unknown.hint, 'string');
  assert.ok(unknown.hint.length > 0);
  /* 无 err 对象时，按当前环境推断名称 */
  assert.ok(['TimeoutError', 'NoAPI', 'InsecureContext'].includes(buildDiagnostics(undefined).errName));
});

test('MM-2 非安全上下文同步失败，且不触碰 getUserMedia', async () => {
  resetMic();
  setSecureContext(false);
  let called = 0;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { mediaDevices: { getUserMedia: async () => { called++; throw new Error('nope'); } } },
  });
  const ok = await Mic.start(() => {});
  assert.equal(ok, false, 'HTTP 明文下应同步判定失败');
  assert.equal(called, 0, '失败路径不应再去申请麦克风');
  assert.equal(Mic.lastDiagnostics.errName, 'InsecureContext');
  assert.equal(Mic.state, 'idle');
  assert.equal(Mic.running, false);
});

test('MM-3 无 navigator.mediaDevices 时同步失败（errName=NoAPI）', async () => {
  resetMic();
  setMediaDevices(false);
  const ok = await Mic.start(() => {});
  assert.equal(ok, false);
  assert.equal(Mic.lastDiagnostics.errName, 'NoAPI');
  assert.equal(Mic.state, 'idle');
});

test('MM-4 single-flight：requesting 期间重复 start 复用同一 Promise', async () => {
  resetMic();
  const p1 = Mic.start(() => {});
  const p2 = Mic.start(() => {});
  assert.strictEqual(p1, p2, '重复申请应复用同一个 pending promise（R1）');
  const ok = await p1;
  assert.equal(ok, true);
  assert.equal(Mic.state, 'running');
  /* 已处于 running 时再次 start 应直接成功并复用现有采集 */
  const p3 = Mic.start(() => {});
  assert.equal(await p3, true);
  Mic.stop();
});

test('MM-5 正常启动到达 running，stop 后采集资源全部归位', async () => {
  resetMic();
  const ok = await Mic.start(() => {});
  assert.equal(ok, true);
  assert.equal(Mic.state, 'running');
  assert.equal(Mic.running, true);
  assert.ok(Mic.stream, '应持有 MediaStream');
  assert.ok(Mic.ctx, '应持有独立 AudioContext');
  assert.ok(Mic.analyser, '应持有 AnalyserNode');

  Mic.stop();
  assert.equal(Mic.state, 'idle');
  assert.equal(Mic.running, false);
  assert.strictEqual(Mic.stream, null, 'stop 后 stream 必须释放（麦克风指示灯不能常亮）');
  assert.strictEqual(Mic.ctx, null);
  assert.strictEqual(Mic.analyser, null);
  assert.strictEqual(Mic._cb, null, 'stop 后不应再持有回调（P0-02）');
});

test('MM-6 stop 幂等，且 stop 后旧回调不再被唤起（R5 token 校验）', async () => {
  resetMic();
  let hits = 0;
  await Mic.start(() => { hits++; });
  Mic.stop();
  hits = 0;
  Mic.stop();
  assert.doesNotThrow(() => { Mic.stop(); });
  /* stop 后即使队列中还有在途帧，也不能把结果回调出去 */
  raf.pump(5);
  assert.equal(hits, 0, 'stop 后到达的帧必须被丢弃');
  assert.equal(Mic.state, 'idle');
});

test('MM-7 采集帧确实回调 onPitch（30fps 隔帧策略）', async () => {
  resetMic();
  let hits = 0;
  let lastArg = null;
  await Mic.start((r) => { hits++; lastArg = r; });
  assert.equal(raf.size(), 1, '启动后应有且仅有 1 个在排的采集帧');
  raf.pump(1);
  assert.equal(hits, 1, '第 1 帧应回调一次');

  /* P2-19：隔帧检测（~30fps）。第 2 帧应被跳过，第 3 帧再次检测。 */
  raf.pump(1);
  assert.equal(hits, 1, '第 2 帧应被隔帧策略跳过');
  raf.pump(1);
  assert.equal(hits, 2, '第 3 帧应恢复检测');

  /* 静音帧：PitchDetect 返回 {freq:null, rms:0, clarity:0}，
     这里只断言「回调透传了检测器结果」，具体音高由 test/pitch-nsdf.test.js 覆盖。 */
  assert.equal(typeof lastArg, 'object');
  assert.notEqual(lastArg, null);
  assert.ok('freq' in lastArg && 'rms' in lastArg && 'clarity' in lastArg, '回调参数应为 PitchDetect 的结果对象');
  Mic.stop();
});
