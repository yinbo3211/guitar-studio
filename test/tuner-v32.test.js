/* ============================================================
   六弦工坊 V3.2 · 调音器底层重写回归测试
   ------------------------------------------------------------
   背景：物理机实测反馈「调音时指针不动 / 调音不精确 / 麦克风离远一点
   就识别不到」。按 hybridpicker/pro-tuner 的做法重写底层：
     T-01 PitchDetect 换为 YIN：低电平（远场拾音）不再被门限判死
     T-02 YIN 仍保持「单帧纯函数」：不修改输入缓冲、跨帧无状态
     T-03 makeNoiseGate：低于门限不通过 + 150ms 保持 + 客观 ASR 上限
     T-04 createPitchTracker：起音重置 / 中值去野值 / 大跳变立即吸附
     T-05 调音器 UI 不再有「|cents|>60 清空整个界面」的卡死分支
     T-06 准音绿区具备滞后（进 ≤5¢，出 ≥8¢）
     T-07 支持手动锁定目标弦
     T-08 手机端入口：移动端「更多」菜单覆盖全部路由（含 flow）
   ============================================================ */
'use strict';
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as AC from '../assets/js/core/audio-core.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const readSrc = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const SR = 48000;

/* 模拟真实拨弦：基频 + 谐波 + 指数衰减 + 噪声 */
function pluck(freq, seconds, sr = SR, { amp = 0.05, decay = 3, noise = 0.004 } = {}) {
  const n = Math.round(seconds * sr);
  const buf = new Float32Array(n);
  let seed = 20240921;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = Math.exp(-t * decay);
    buf[i] = amp * env * (
      Math.sin(2 * Math.PI * freq * t)
      + 0.45 * Math.sin(2 * Math.PI * 2 * freq * t + 0.3)
      + 0.22 * Math.sin(2 * Math.PI * 3 * freq * t + 0.9)
    ) + noise * rnd();
  }
  return buf;
}

/* ---------- T-01 ---------- */
test('T-01 远场/低电平：YIN 在旧 RMS 门限（0.01）以下仍能锁定正确弦音', () => {
  const strings = [82.4069, 110, 146.832, 196, 246.942, 329.628]; // E2 A2 D3 G3 B3 E4
  for (const f of strings) {
    const r = AC.PitchDetect(pluck(f, 4096 / SR, SR, { amp: 0.006, decay: 2.5 }), SR);
    assert.ok(r.freq != null, `${f}Hz 极低电平也应检出（rms=${r.rms.toFixed(4)}）`);
    assert.ok(r.rms < 0.01, `本次考查的就是旧门限 0.01 以下的场景，实测 rms=${r.rms}`);
    const cents = Math.abs(1200 * Math.log2(r.freq / f));
    assert.ok(cents < 5, `${f}Hz 偏差 ${cents.toFixed(2)}¢ 应 <5¢（绿区内）`);
  }
});

test('T-01b 灵敏度阶梯：同一拨弦衰减到不同电平仍持续锁定（不提前判死）', () => {
  const seen = [];
  for (const amp of [0.08, 0.03, 0.012, 0.005, 0.002]) {
    const r = AC.PitchDetect(pluck(110, 4096 / SR, SR, { amp, decay: 1.5, noise: 0.0008 }), SR);
    seen.push(r.freq != null);
  }
  assert.ok(seen.every(Boolean), `各电平档位都应检出，实际 ${JSON.stringify(seen)}`);
});

/* ---------- T-02 ---------- */
test('T-02 PitchDetect 保持纯函数：不修改输入缓冲、不持有跨帧状态', () => {
  const buf = pluck(329.628, 4096 / SR, SR, { amp: 0.2 });
  const snap = Float32Array.from(buf);
  AC.PitchDetect(buf, SR);
  assert.deepStrictEqual(Array.from(buf), Array.from(snap), '不得就地修改输入缓冲');

  // 跨帧无状态：连续喂两个相差很大的音高，后一个不能被前一个拖住
  const a = AC.PitchDetect(pluck(82.41, 4096 / SR, SR, { amp: 0.2 }), SR);
  const b = AC.PitchDetect(pluck(440, 4096 / SR, SR, { amp: 0.2 }), SR);
  assert.ok(Math.abs(a.freq - 82.41) < 0.6, `E2 应独立检出，实际 ${a.freq}`);
  assert.ok(Math.abs(b.freq - 440) < 1.8, `A4 不应被上一帧的低音拉偏，实际 ${b.freq}`);
});

/* ---------- T-03 ---------- */
test('T-03 makeNoiseGate：低于门限不通过；通过后 150ms 内保持开启', () => {
  const g = AC.makeNoiseGate('low');            // 预设 0.001
  const t0 = 1_000_000;
  assert.strictEqual(g.above(0.0005, t0), false, '低于门限应拦住');
  assert.strictEqual(g.above(0.01, t0 + 10), true, '高于门限应放行');
  assert.strictEqual(g.above(0.0002, t0 + 20), true, '刚过期票：100ms 内应保持开门');
  assert.strictEqual(g.above(0.0002, t0 + 200), false, '超过 150ms 应关闭');
});

test('T-03b 自适应本底校准永不低于所选预设档位', () => {
  const g = AC.makeNoiseGate('medium');         // 预设 0.004
  g.setThreshold(0.0005);
  assert.ok(g.threshold >= 0.004, `校准值不得低于预设，实际 ${g.threshold}`);
  g.setThreshold(0.02);
  assert.strictEqual(g.threshold, 0.02, '更高的本底噪声应抬高门限');
});

/* ---------- T-04 ---------- */
test('T-04 createPitchTracker：中值滤波剔除单个野值读数', () => {
  const tr = AC.createPitchTracker();
  for (let i = 0; i < 5; i++) tr.push(110, 0.05, 0.9);
  const before = tr.push(110, 0.05, 0.9);
  const wild = tr.push(110 * 3.0, 0.05, 0.9);   // 离群读数（泛音误锁）
  const after = tr.push(110, 0.05, 0.9);
  assert.ok(Math.abs(before.freq - 110) < 1, `基线应贴近 110，实际 ${before.freq}`);
  assert.ok(Math.abs(wild.freq - 110) < 3, `野值应被中值抑制，实际 ${wild.freq}`);
  assert.ok(Math.abs(after.freq - 110) < 1, `恢复后仍贴近 110，实际 ${after.freq}`);
});

test('T-04b createPitchTracker：起音（RMS 突增 3 倍）立即丢弃历史，换弦能跟上', () => {
  const tr = AC.createPitchTracker();
  for (let i = 0; i < 9; i++) tr.push(82.41, 0.01, 0.95);
  const steady = tr.value;
  assert.ok(Math.abs(steady - 82.41) < 1, `应稳定在 E2，实际 ${steady}`);
  const jump = tr.push(146.83, 0.05, 0.95);      // RMS 0.01 → 0.05（>3 倍）视为新的一次拨弦
  assert.ok(Math.abs(jump.freq - 146.83) < 1, `换弦后应立刻跟上 D3，实际 ${jump.freq}`);
});

test('T-04c createPitchTracker：无音高帧返回 null 且不污染已锁定音高', () => {
  const tr = AC.createPitchTracker();
  for (let i = 0; i < 6; i++) tr.push(440, 0.03, 0.9);
  assert.strictEqual(tr.push(null, 0.0002, 0), null);
  assert.strictEqual(tr.push(NaN, 0.0002, 0), null);
  assert.ok(Math.abs(tr.value - 440) < 1, `静音帧不应改变已锁定值，实际 ${tr.value}`);
});

/* ---------- T-05 / T-06 / T-07 ---------- */
const tunerSrc = readSrc('assets/js/modules/tuner.js');

test('T-05 调音器不再存在「偏差过大就清空整个界面」的卡死分支', () => {
  assert.ok(!/Math\.abs\(cents\)\s*>\s*60/.test(tunerSrc),
    '|cents|>60 的整套 UI 复位分支必须删除——它是指针看起来纹丝不动的直接原因');
  assert.ok(/glideNeedle/.test(tunerSrc), '指针应始终由统一的平滑函数驱动');
});

test('T-06 准音绿区具备滞后：进入 ≤5¢，退出 ≥8¢', () => {
  assert.ok(/absC<=5\)\s*this\.inTune=true/.test(tunerSrc.replace(/\s+/g, ' ')),
    '进入绿区阈值应为 5 音分');
  assert.ok(/absC>=8\)\s*this\.inTune=false/.test(tunerSrc.replace(/\s+/g, ' ')),
    '退出绿区阈值应为 8 音分（滞后，防临界闪烁）');
});

test('T-07 支持手动锁定目标弦，并同步按钮选中态', () => {
  assert.ok(/this\.picked\s*=\s*\(this\.picked===midi\)\s*\?\s*null\s*:\s*midi/.test(tunerSrc),
    '点击弦按钮应切换锁定/解锁');
  assert.ok(/if\(this\.picked!=null\)\s*target\s*=/.test(tunerSrc.replace(/\s+/g, ' ')),
    '锁定时判定目标必须优先取手选弦');
  assert.ok(/classList\.toggle\('picked'/.test(tunerSrc), '应同步 picked 选中态到按钮');
});

test('T-07b 调音器接入了噪声门与跨帧跟踪器（V3.2 新增依赖）', () => {
  assert.ok(/makeNoiseGate\(/.test(tunerSrc), '应使用 makeNoiseGate');
  assert.ok(/createPitchTracker\(/.test(tunerSrc), '应使用 createPitchTracker');
  assert.ok(/calibrate\(rms\)/.test(tunerSrc), '开麦初期应做本底噪声自适应校准');
});

/* ---------- T-08 ---------- */
test('T-08 移动端「更多」入口覆盖全部未在 tabbar 直达的路由（含 flow）', () => {
  const src = readSrc('assets/js/core/router.js');
  assert.ok(/MORE_ROUTES\s*=\s*Object\.keys\(ROUTE_TITLES\)/.test(src),
    'MORE_ROUTES 应由 ROUTE_TITLES 推导，避免新增页面再次被漏掉');
  for (const r of ['flow', 'plan', 'stats']) {
    const titles = readSrc('assets/js/core/router.js');
    assert.ok(new RegExp(`\\b${r}:`).test(titles), `${r} 应出现在 MORE_LABEL / ROUTE_TITLES 里`);
  }
  assert.ok(/TABBAR_ROUTES/.test(src), '应显式声明 tabbar 已直达的路由作为排除集');
});

test('T-08b 指法图 SVG 带固有宽高（iOS Safari 依赖它推算 height:auto）', () => {
  const src = readSrc('assets/js/data/chords.js');
  assert.ok(/viewBox="0 0 \$\{W\} \$\{H\}" width="\$\{W\}" height="\$\{H\}"/.test(src),
    'renderDiagram 输出必须带 width/height，否则部分 WebKit 版本高度为 0');
});
