/* ============================================================
   六弦工坊 · 音频核心算法库单元测试
   运行：node --test test/   （零依赖，Node ≥ 18 内置 test runner）
   按 PRD v2.0 M1 要求：算法迁移必须有回归测试保护。
   ============================================================ */
'use strict';
import test from 'node:test';
import assert from 'node:assert';
import * as AC from '../assets/js/core/audio-core.js';

const SR = 44100;
const near = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg || ''} 期望≈${expected}±${tol}，实际=${actual}`);

/* ---------- 合成音频辅助：生成正弦（可叠加二次谐波） ---------- */
function sine(freq, seconds, { amp = 0.25, h2 = 0, sr = SR, phase = 0 } = {}) {
  const n = Math.round(seconds * sr);
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    buf[i] = amp * Math.sin(2 * Math.PI * freq * t + phase)
           + amp * h2 * Math.sin(4 * Math.PI * freq * t);
  }
  return buf;
}

/* ============ 1. 音高换算 ============ */
test('midiFromFreq / freqFromMidi 标准值与往返一致性', () => {
  near(AC.midiFromFreq(440), 69, 1e-9, 'A4=440Hz → MIDI69');
  // 440Hz 在 442Hz 基准下低于 A4 约 12*log2(440/442) ≈ -0.0785 个半音
  near(AC.midiFromFreq(440, 442), 68.9215, 1e-3, 'A4 基准 442 时 440Hz 低于 A4');
  near(AC.midiFromFreq(AC.freqFromMidi(40, 435), 435), 40, 1e-9, 'E2 在 a4=435 下往返');
  near(AC.freqFromMidi(69, 432), 432, 1e-9, 'freqFromMidi 尊重 a4 基准');
  near(AC.freqFromMidi(40), 82.4069, 1e-3, 'E2 标准 82.41Hz');
});

test('音名换算 noteName / noteNameNoOct / pitchClass', () => {
  assert.strictEqual(AC.noteName(40), 'E2');
  assert.strictEqual(AC.noteName(69), 'A4');
  assert.strictEqual(AC.noteName(61), 'C#4');
  assert.strictEqual(AC.noteNameNoOct(61), 'C#');
  assert.strictEqual(AC.noteNameNoOct(64), 'E');
  assert.strictEqual(AC.pitchClass(-1), 11, '负数取模应回绕');
  assert.strictEqual(AC.pitchClass(69), 9);
});

test('pcFromName 支持升号与降号（修复 Bb 误判 Bug）', () => {
  assert.strictEqual(AC.pcFromName('C'), 0);
  assert.strictEqual(AC.pcFromName('C#'), 1);
  assert.strictEqual(AC.pcFromName('F#'), 6);
  assert.strictEqual(AC.pcFromName('Bb'), 10, '降号 Bb 应为 10，V1 的 replace 逻辑得 -1');
  assert.strictEqual(AC.pcFromName('Db'), 1);
  assert.strictEqual(AC.pcFromName('Eb'), 3);
  assert.strictEqual(AC.pcFromName('B'), 11);
  assert.strictEqual(AC.pcFromName('X'), -1, '非法音名返回 -1');
  assert.strictEqual(AC.pcFromName(''), -1);
});

test('centsBetween 音分差', () => {
  near(AC.centsBetween(440, 440), 0, 1e-9);
  near(AC.centsBetween(466.16, 440), 100, 0.1, 'Bb4 比 A4 高约 100 音分');
  near(AC.centsBetween(415.30, 440), -100, 0.1, '降 A4 比标准低约 100 音分');
});

/* ============ 2. 自相关测频 ============ */
test('PitchDetect：吉他六弦标准音全范围识别', () => {
  const cases = [
    [82.41, 'E2'], [110.00, 'A2'], [146.83, 'D3'],
    [220.00, 'A3'], [329.63, 'E4'], [440.00, 'A4']
  ];
  for (const [f, tag] of cases) {
    const r = AC.PitchDetect(sine(f, 0.25), SR);
    assert.ok(r.freq !== null, `${tag} (${f}Hz) 应能检测出频率`);
    near(r.freq, f, Math.max(0.6, f * 0.004), `${tag} 检测频率`);
    assert.ok(r.clarity > 0.5, `${tag} 清晰度应较高`);
  }
});

test('PitchDetect：含二次谐波时仍锁定基频（抗泛音）', () => {
  const r = AC.PitchDetect(sine(110, 0.3, { h2: 0.5 }), SR);
  assert.ok(r.freq !== null);
  near(r.freq, 110, 1.2, '基频 110Hz，即使二次谐波占 50% 能量');
});

test('PitchDetect：静音与噪声返回 null', () => {
  const silent = AC.PitchDetect(new Float32Array(4096), SR);
  assert.strictEqual(silent.freq, null, '静音应返回 null');
  const rng = (s => () => (s = (s * 16807) % 2147483647) / 2147483647)(42);
  const noise = new Float32Array(4096);
  for (let i = 0; i < noise.length; i++) noise[i] = (rng() - 0.5) * 0.04; // 微弱噪声低于 RMS 门限
  assert.strictEqual(AC.PitchDetect(noise, SR).freq, null, '微弱噪声应返回 null');
  const loudNoise = new Float32Array(4096);
  for (let i = 0; i < loudNoise.length; i++) loudNoise[i] = rng() - 0.5;   // 大幅白噪声无周期性
  const r2 = AC.PitchDetect(loudNoise, SR);
  assert.ok(r2.freq === null || r2.clarity < 0.25, '白噪声应因清晰度低被拒绝');
});

test('PitchDetect：不修改输入缓冲', () => {
  const buf = sine(220, 0.1);
  const snapshot = Float32Array.from(buf);
  AC.PitchDetect(buf, SR);
  assert.deepStrictEqual(Array.from(buf), Array.from(snapshot));
});

/* ============ 3. 平滑滤波 ============ */
test('makeSmoother：滑动窗口中位数，异常值被抑制', () => {
  const s = AC.makeSmoother(3);
  assert.strictEqual(s(10), 10);
  // V1 行为：偶数窗口取上中位（floor(len/2)），[10,12] → 12
  assert.strictEqual(s(12), 12);
  near(s(100), 12, 1e-9, '尖峰 100 被中位数滤除');
  near(s(12), 12, 1e-9);
  s(null);
  assert.strictEqual(s(7), 7, 'null 重置后重新开始');
});

/* P0-01 回归（bug 排查手册）：FIFO 中位数——音高下降必须跟随，不允许卡死。
   旧实现 sort 后 shift 会丢掉窗口最小值（= 新检测到的低音高），
   连续下降音永远进不了窗口，调音器永久卡在高音；FIFO 丢最旧值则立即跟随。 */
test('P0-01 回归：音高持续下降时平滑器必须跟随（修复 sort+shift 卡死）', () => {
  const s = AC.makeSmoother(3);
  [64,64,64].forEach(v=>s(v));   // 稳定在 E4≈64
  assert.strictEqual(s(40), 64); // 过渡帧：窗口 [64,64,40] 中位数 64（符合中位数语义）
  assert.strictEqual(s(40), 40); // [64,40,40] → 40，已开始跟随
  assert.strictEqual(s(40), 40); // [40,40,40] → 40
  assert.strictEqual(s(64), 40); // 回弹过渡 [40,40,64] → 40
  assert.strictEqual(s(64), 64); // [40,64,64] → 64
  s(null);
  [64,64,64].forEach(v=>s(v));
  for(let i=0;i<10;i++) s(40);   // 持续下降 10 帧
  assert.strictEqual(s(40), 40, '连续下降后必须稳定在 40（旧实现永远卡在 64）');
});

test('makeSmoother：默认帧数 3', () => {
  const s = AC.makeSmoother();
  s(5); s(5);
  near(s(50), 5, 1e-9, '第 3 帧 50 仍未主导');
  near(s(5), 5, 1e-9);
});

/* ============ 4. 和弦闯关判定 ============ */
test('quantizeToOctave 八度量化', () => {
  near(AC.quantizeToOctave(0.3), 0.3, 1e-9);
  near(AC.quantizeToOctave(12.3), 0.3, 1e-9);
  near(AC.quantizeToOctave(-11.7), 0.3, 1e-9);
  near(AC.quantizeToOctave(7), -5, 1e-9, '7 半音应量化为 -5');
});

test('matchFretTarget：真实音优先于八度等价音', () => {
  // 候选：6弦 E2(40)，5弦 A2(45)
  const cands = [{ i: 0, target: 40 }, { i: 1, target: 45 }];
  // 弹 A2 真实音：优先匹配 5 弦
  const r1 = AC.matchFretTarget(45.2, cands);
  assert.strictEqual(r1.i, 1);
  near(r1.cents, 20, 1e-6);
  // 弹 A3(57)：与 5 弦差 12（八度等价），无真实音匹配时允许命中
  const r2 = AC.matchFretTarget(57.2, cands);
  assert.strictEqual(r2.i, 1, '八度等价可命中');
  near(r2.cents, 20, 1e-6, 'cents 应为量化后的绝对值（修复负值 Bug）');
  // 明显不相关的音
  assert.strictEqual(AC.matchFretTarget(66.0, cands), null, '差 9 半音不匹配任何候选');
});

test('matchFretTarget：cents 恒为绝对值（回归 Fix-2）', () => {
  // mf 低于目标：realDiff=-0.3，V1 会把 bestCents 写成 -30 导致后续比较失效
  const r = AC.matchFretTarget(44.7, [{ i: 1, target: 45 }]);
  assert.strictEqual(r.i, 1);
  assert.ok(r.cents >= 0, 'cents 不应为负');
  near(r.cents, 30, 1e-6);
});

/* P1-04 回归（bug 排查手册）：两轮匹配——精确命中必须优先于八度等价。
   手册场景：C 和弦未完成弦候选 {5弦C3:48, 4弦E3:52, 3弦G3:55, 2弦C4:60, 1弦E4:64} */
test('P1-04 回归：精确匹配优先，八度等价不得抢占（C 和弦场景）', () => {
  const cands = [
    { i: 1, target: 48 }, { i: 2, target: 52 }, { i: 3, target: 55 },
    { i: 4, target: 60 }, { i: 5, target: 64 }
  ];
  const r48 = AC.matchFretTarget(48, cands);
  assert.deepStrictEqual(r48, { i: 1, cents: 0 }, '弹 5 弦 C3 应命中 5 弦');
  const r60 = AC.matchFretTarget(60, cands);
  assert.deepStrictEqual(r60, { i: 4, cents: 0 }, '弹 2 弦 C4 必须精确命中 2 弦（V1 被 5 弦八度等价抢占）');
  const r72 = AC.matchFretTarget(72, cands);
  assert.deepStrictEqual(r72, { i: 1, cents: 0 }, '弹 C5(72) 无精确候选，八度兜底命中 5 弦 C3');
  assert.strictEqual(AC.matchFretTarget(53, cands), null, '53 介于 E3/G3 之间，不匹配任何候选');
  const r0 = AC.matchFretTarget(40, [{ i: 0, target: 40 }]);
  assert.deepStrictEqual(r0, { i: 0, cents: 0 }, '弦索引 0（6 弦）不得被 falsy 判断吞掉');
});

/* ============ 5. 音阶跟弹判定 ============ */
test('isPitchMatch 阈值判定', () => {
  assert.ok(AC.isPitchMatch(60.3, 60));
  assert.ok(!AC.isPitchMatch(60.7, 60));
  assert.ok(AC.isPitchMatch(60.65, 60, 0.7), '自定义阈值生效');
});

/* ============ 6. 节拍器调度 ============ */
test('tapBpm：TAP 测速取中位数', () => {
  assert.strictEqual(AC.tapBpm([]), null);
  assert.strictEqual(AC.tapBpm([1000]), null, '单次点击无法测速');
  // 500ms ×4 → 120BPM；故意插入一次抖动 300ms，中位数应滤除
  const taps = [0, 500, 1000, 1300, 1500];
  assert.strictEqual(AC.tapBpm(taps), 120);
  // 400ms 均匀 → 150BPM
  assert.strictEqual(AC.tapBpm([0, 400, 800, 1200]), 150);
});

test('beatDuration / stepDuration / isSubAccent', () => {
  near(AC.beatDuration(120), 0.5, 1e-9);
  near(AC.stepDuration(120, 1), 0.5, 1e-9, '四分音符无细分');
  near(AC.stepDuration(60, 2), 0.5, 1e-9);
  assert.ok(AC.isSubAccent(6, 3), '6/8 拍第 4 拍为次强');
  assert.ok(!AC.isSubAccent(4, 1));
  assert.ok(!AC.isSubAccent(6, 0), '次强不在第 1 拍');
});

/* ============ 7. 常量完整性 ============ */
test('OPEN_MIDI 与 NOTE_NAMES 常量', () => {
  assert.deepStrictEqual(AC.OPEN_MIDI, [40, 45, 50, 55, 59, 64]);
  assert.strictEqual(AC.NOTE_NAMES.length, 12);
  assert.strictEqual(Object.keys(AC.NOTE_CN).length, 12);
});
