/* ============================================================
   六弦工坊 · 节奏模块 BPM 同步回归测试（RT-012）
   ------------------------------------------------------------
   背景：Transport 统一时间轴初值 90 BPM，而 Rhythm 模块自身 bpm
   初值 60、两个 BPM 输入控件默认也是 60。修复前 init() 从不把
   60 同步给 Transport，导致用户首次直接播放（未拖动 BPM）时：
     · 预备拍按时值 60BPM 调度（countInDur 读 this.bpm）
     · 正式格却按 90BPM 调度（stepDur 读 Transport.beatDuration）
   整体节奏比界面显示快 50%。和弦库 playProg 还会把 Transport
   改成 80，起播前同样需要重新声明本模块 BPM。

   本测试用最小 DOM stub 真实 import 模块（非源码字符串匹配），
   验证 init 后与起播前 Transport 都等于 Rhythm.bpm。
   ============================================================ */
'use strict';
import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ---------- 最小 DOM / 浏览器环境 stub ---------- */
function makeEl() {
  const el = {
    style: { setProperty() {} },
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, removeEventListener() {},
    appendChild() {}, focus() {}, click() {},
    querySelectorAll() { return []; },
    getContext() { return null; },
  };
  Object.defineProperties(el, {
    value: { value: 60, writable: true, configurable: true },
    innerHTML: { value: '', writable: true, configurable: true },
    textContent: { value: '', writable: true, configurable: true },
    open: { value: false, writable: true, configurable: true },
    disabled: { value: false, writable: true, configurable: true },
    checked: { value: false, writable: true, configurable: true },
  });
  return el;
}

async function loadRhythm() {
  const els = new Map();
  const get = sel => { if (!els.has(sel)) els.set(sel, makeEl()); return els.get(sel); };
  const queryAll = () => [];

  const store = new Map();
  const localStorageStub = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  };

  globalThis.window = globalThis;
  globalThis.localStorage = localStorageStub;
  globalThis.location = { hash: '', protocol: 'http:' };
  globalThis.confirm = () => false;
  globalThis.document = {
    hidden: false,
    readyState: 'complete',
    addEventListener() {}, removeEventListener() {},
    querySelector: get, querySelectorAll: queryAll,
    getElementById: id => get('#' + id),
    createElement: () => makeEl(),
    documentElement: makeEl(),
  };
  globalThis.$ = get;
  globalThis.$$ = queryAll;
  globalThis.toast = () => {};
  globalThis.onRouteEnter = {};

  // AudioCore：rhythm.js 模块级解构，只要键存在即可
  globalThis.AudioCore = new Proxy({}, { get: () => () => ({}) });

  // 按 main.js 顺序真实导入
  await import(path.join(ROOT, 'assets/js/data/rhythm-data.js'));
  const { Transport } = await import(path.join(ROOT, 'assets/js/core/transport.js'));
  const { Rhythm } = await import(path.join(ROOT, 'assets/js/modules/rhythm.js'));
  return { Rhythm, Transport };
}

/* ---------- 测试 ---------- */
test('RT-012: Rhythm.init 后 Transport BPM 同步为 60（修复前为 90）', async () => {
  const { Rhythm, Transport } = await loadRhythm();
  // 复现修复前的初始不一致
  assert.strictEqual(Rhythm.bpm, 60, 'Rhythm 自身 BPM 初值应为 60');
  Rhythm.init();
  assert.strictEqual(Transport.bpm, Rhythm.bpm,
    'init 后统一时间轴必须与节奏模块 BPM 一致（60），否则首次播放正式格会按 90 调度');
  assert.strictEqual(Transport.beatDuration(), 60 / Rhythm.bpm,
    'beatDuration 应等于 60/60=1 秒/拍');
});

test('RT-012: _beginPlayback 起播前重新声明 BPM（防和弦库把 Transport 改成 80）', async () => {
  const { Rhythm, Transport } = await loadRhythm();
  Rhythm.init();

  // 模拟用户在和弦库听完进行（playProg 会 Transport.setBpm(80)）
  Transport.setBpm(80);
  assert.strictEqual(Transport.bpm, 80);

  // 起播需要音频环境；直接调用会因无 AudioContext 抛错——
  // 但 setBpm 同步发生在第一行，抛错前断言应已成立。
  assert.throws(() => Rhythm._beginPlayback());
  assert.strictEqual(Transport.bpm, Rhythm.bpm,
    '起播调度前必须把 Transport 拉回本模块 BPM，否则扫弦速度与界面显示不符');
});
