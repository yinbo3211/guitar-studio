/* ============================================================
   六弦工坊 · PitchDetect NSDF 归一化精度测试（V2-BUG-01 回归）
   ------------------------------------------------------------
   修复前：s/n 归一化在长 lag 处方差放大，48kHz 采样率下 E2（6 弦
   空弦 82.41Hz）偏差达 -9.9~-16.6 音分，永远进不了调音器 ±5¢ 的
   「准 ✓」判定（Math.abs(cents)<=5）。
   修复后：NSDF（两段重叠能量归一化），全部音 × 采样率 < 5¢。
   ============================================================ */
'use strict';
import test from 'node:test';
import assert from 'node:assert';
import * as AC from '../assets/js/core/audio-core.js';

const cents = (est, ref) => 1200 * Math.log2(est / ref);

/* 模拟真实拨弦：基频 + 谐波 + 指数衰减包络 + 轻微噪声（与手册 ④ 一致） */
function pluck(freq, seconds, sr, { amp = 0.3, decay = 3, noise = 0.003 } = {}) {
  const n = Math.round(seconds * sr);
  const buf = new Float32Array(n);
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = Math.exp(-t * decay);
    buf[i] = amp * env * (
      Math.sin(2 * Math.PI * freq * t)
      + 0.45 * Math.sin(2 * Math.PI * 2 * freq * t + 0.3)
      + 0.22 * Math.sin(2 * Math.PI * 3 * freq * t + 0.9)
      + 0.10 * Math.sin(2 * Math.PI * 4 * freq * t)
    ) + noise * rnd();
  }
  return buf;
}

test('V2-BUG-01 回归：E2 拨弦包络 @48kHz 误差 < 5¢（修复前 -9.9¢）', () => {
  for (const size of [2048, 4096]) {
    const r = AC.PitchDetect(pluck(82.4069, size / 48000, 48000), 48000);
    assert.ok(r.freq != null, `48k/${size} 应检出频率`);
    assert.ok(Math.abs(cents(r.freq, 82.4069)) < 5,
      `48k/${size} E2 偏差 ${cents(r.freq, 82.4069).toFixed(2)}¢ 应 <5¢`);
  }
});

test('V2-BUG-01 回归：E2 @32kHz 误差 < 5¢（修复前 -3.8¢）', () => {
  const r = AC.PitchDetect(pluck(82.4069, 4096 / 32000, 32000), 32000);
  assert.ok(Math.abs(cents(r.freq, 82.4069)) < 5,
    `偏差 ${cents(r.freq, 82.4069).toFixed(2)}¢`);
});

test('V2-BUG-01 回归：44.1kHz 全六弦拨弦包络误差 < 5¢', () => {
  const strings = [82.4069, 110, 146.832, 220, 246.942, 329.628]; // E2 A2 D3 A3 B3 E4
  for (const f of strings) {
    const r = AC.PitchDetect(pluck(f, 4096 / 44100, 44100), 44100);
    assert.ok(r.freq != null, `${f}Hz 应检出`);
    assert.ok(Math.abs(cents(r.freq, f)) < 5,
      `${f}Hz 偏差 ${cents(r.freq, f).toFixed(2)}¢`);
  }
});

test('V2-BUG-01 回归：纯音各采样率最大偏差 < 2¢（手册实测 0.60¢）', () => {
  for (const sr of [16000, 22050, 32000, 44100, 48000]) {
    const r = AC.PitchDetect(pluck(82.4069, 4096 / sr, sr, { noise: 0 }), sr);
    assert.ok(Math.abs(cents(r.freq, 82.4069)) < 2,
      `${sr}Hz 纯音偏差 ${cents(r.freq, 82.4069).toFixed(2)}¢`);
  }
});

test('V2-BUG-01 回归：clarity 量纲不变（0~1）且低八度不误锁', () => {
  const r = AC.PitchDetect(pluck(82.4069, 4096 / 48000, 48000), 48000);
  assert.ok(r.clarity > 0.25 && r.clarity <= 1.0001, 'clarity 应在 (0.25, 1]');
  assert.ok(r.freq > 70, `不应锁到低八度（实际 ${r.freq}）`);
});
