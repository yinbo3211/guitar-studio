/* 六弦工坊 V3 · Transport 统一时间轴单元测试（PRD §4 M2）
   Node 环境最小 window 垫片，只验证纯数学约束。 */
import test from 'node:test';
import assert from 'node:assert';

globalThis.window = globalThis;
globalThis.self = globalThis;
globalThis.AudioContext = class { constructor(){ this.state='running'; this.currentTime=0; } resume(){} };


const { Transport, default: TransportDefault } = await import('../assets/js/core/transport.js');
const { default: ToneEngine } = await import('../assets/js/core/tone-engine.js');

test('stepTicks：1/2/3/4 细分全部整除 12 tick/拍（P-01 统一时间轴前提）', () => {
  assert.strictEqual(Transport.stepTicks(1), 12);
  assert.strictEqual(Transport.stepTicks(2), 6);
  assert.strictEqual(Transport.stepTicks(3), 4);
  assert.strictEqual(Transport.stepTicks(4), 3);
});

test('时长换算零漂移：tickDuration × 12 ≡ beatDuration（误差 < 1e-12）', () => {
  for (const bpm of [30, 60, 90, 120, 180, 300]) {
    Transport.setBpm(bpm, 0);
    const drift = Math.abs(Transport.beatDuration() - Transport.tickDuration() * 12);
    assert.ok(drift < 1e-12, `bpm=${bpm} 漂移 ${drift}`);
  }
});

test('setBpm 边界：30–300 之外被钳制（R-BPM-02）', () => {
  Transport.setBpm(10);  assert.strictEqual(Transport.bpm, 30);
  Transport.setBpm(500); assert.strictEqual(Transport.bpm, 300);
  Transport.setBpm(90);
});

test('onBpm 监听在 setBpm 时触发', () => {
  let seen = null;
  Transport.onBpm(v => { seen = v; });
  Transport.setBpm(120); assert.strictEqual(seen, 120);
  Transport.setBpm(90);
});

test('onTick 回调注册并可触发（原生语义）', () => {
  let fired = 0;
  Transport.onTick(() => fired++);
  Transport._fire(0.5, 7);
  assert.ok(fired >= 1);
});

test('默认导出一致', () => {
  assert.strictEqual(TransportDefault, Transport);
  assert.ok(ToneEngine && typeof ToneEngine.ensure === 'function');
});
