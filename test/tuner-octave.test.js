/* ============================================================
   六弦工坊 V4.2.7 · 调音器「四弦永远调不准」回归测试
   ------------------------------------------------------------
   用户实测：给 4 弦（D3 146.83Hz）调音时永远进不了绿区。
   定位到两个叠加成因（均已实测复现）：

   成因① createPitchTracker 把新读数往「上一帧的 smoothed」上折八度：
         6 弦 E2(82.41) 与 4 弦 D3(146.83) 相差 1.7818 倍，紧贴旧实现
         ratio>1.8 的折半门槛。实测：先稳定在 82.41，再喂 150Hz（比标准
         D3 高 37 音分），tracker 输出 82.4→82.4→…→75，并自我强化，
         之后无论怎么拨都停在 75Hz，UI 永远显示「6 弦 偏低 163 音分」。

   成因② 手机麦克风对 146.8Hz 衰减明显时，YIN 会锁到 4 弦二次谐波 293.7Hz；
         自动模式按最近弦判给 1 弦 E4(329.6)，显示「偏高 200 音分」，
         同样永远不进绿区。

   修复口径：
     · tracker 删除「相对 smoothed 的八度折叠」，改为连续两帧吻合才认定的
       换音确认（单帧野值仍由中值滤波抑制，T-04 语义不变）；
     · 调音器侧做目标弦八度归一，且必须同时满足三条（不在绿区、原读数
       偏离 >600 音分、折回后 ≤25 音分），真实跑音不会被折回。
   ============================================================ */
'use strict';
import test from 'node:test';
import assert from 'node:assert';
import * as AC from '../assets/js/core/audio-core.js';

const D3 = 146.832;
const E2 = 82.4069;
const cents = (f, ref) => 1200 * Math.log2(f / ref);

/* ---------- 成因①：跨帧跟踪器不得把换弦折成八度 ---------- */

test('TO-1 调完 6 弦再拨 4 弦（高 37 音分）不得被折半，且两帧内跟上', () => {
  const tr = AC.createPitchTracker();
  for (let i = 0; i < 10; i++) tr.push(E2, 0.05, 0.99);   // 已稳定在 6 弦
  const out = [];
  for (let i = 0; i < 8; i++) out.push(tr.push(150, 0.05, 0.99).freq);
  assert.ok(Math.abs(cents(out[0], E2)) < 5, `第 1 帧允许沿用上一音（实测 ${out[0].toFixed(1)}Hz）`);
  for (let i = 1; i < out.length; i++) {
    assert.ok(Math.abs(cents(out[i], 150)) < 5,
      `第 ${i + 1} 帧应已跟上 150Hz，实际 ${out[i].toFixed(1)}Hz（旧实现会钉死在 75Hz）`);
  }
  assert.ok(out.slice(1).every(f => f > 140), '确认换音后任何一帧都不允许出现折半后的 75Hz');
});

test('TO-2 换音确认不破坏单帧野值抑制（T-04 语义）', () => {
  const tr = AC.createPitchTracker();
  for (let i = 0; i < 6; i++) tr.push(110, 0.05, 0.9);
  const before = tr.push(110, 0.05, 0.9).freq;
  const wild = tr.push(110 * 3, 0.05, 0.9).freq;      // 单帧泛音误锁
  const after = tr.push(110, 0.05, 0.9).freq;
  assert.ok(Math.abs(before - 110) < 1, `基线应贴近 110，实际 ${before}`);
  assert.ok(Math.abs(wild - 110) < 3, `单帧野值应被中值抑制，实际 ${wild}`);
  assert.ok(Math.abs(after - 110) < 1, `野值后应回到 110，实际 ${after}`);
});

test('TO-3 谐波误锁（+1200 音分）不被当成换音而清空窗口', () => {
  const tr = AC.createPitchTracker();
  for (let i = 0; i < 8; i++) tr.push(D3, 0.05, 0.99);
  const oct = tr.push(D3 * 2, 0.05, 0.99).freq;       // 单帧二次谐波
  assert.ok(Math.abs(cents(oct, D3)) < 10, `单帧谐波应被抑制在 D3，实际 ${oct.toFixed(1)}Hz`);
});

/* ---------- 成因②：调音器侧的目标弦八度归一 ---------- */
/* 以桩 DOM 驱动真实的 Tuner.onPitch（与 test/tuner-v32.test.js 的源码级断言互补） */
const stubEl = () => ({
  textContent: '', innerHTML: '',
  style: { setProperty() {}, width: '', color: '', transform: '', opacity: '' },
  classList: { add() {}, remove() {}, toggle() {} },
  dataset: {}, addEventListener() {},
});
const els = new Map();
const stringBtns = [6, 5, 4, 3, 2, 1].map((n) => ({
  dataset: { midi: String(44 + n) },
  classList: { add() {}, remove() {}, toggle() {} },
}));
globalThis.$ = (s) => { if (!els.has(s)) els.set(s, stubEl()); return els.get(s); };
globalThis.$$ = () => stringBtns;
globalThis.AudioCore = AC.AudioCore;
globalThis.AudioEngine = { ensure() {}, pluck() {} };
globalThis.Mic = { lastDiagnostics: null, start: async () => true, stop() {} };
globalThis.toast = () => {};
globalThis.onRouteEnter = {};
globalThis.window = globalThis;
/* V4.3：桩环境接入 zh-CN 词典，T()/TF() 产出真实文案（断言继续检查中文口径） */
const { DICT: ZH } = await import('../assets/js/i18n/zh-CN.js');
globalThis.t = (k) => ZH[k] ?? k;
globalThis.gsI18n = {
  tF(k, pairs) {
    let s = ZH[k] ?? k;
    for (const a of Object.keys(pairs || {})) s = s.split('{' + a + '}').join(String(pairs[a]));
    return s;
  },
};
const { Tuner } = await import('../assets/js/modules/tuner.js');

/* 把一段稳定音高喂进真实链路（gate/tracker/判定全部走真代码） */
function feed(freq, { frames = 30, picked = null, mode = 'guitar' } = {}) {
  Tuner.active = true; Tuner.mode = mode; Tuner.picked = picked;
  Tuner.gate.reset(); Tuner.tracker.reset();
  Tuner.inTune = false; Tuner.inTuneCount = 0; Tuner.shownCents = 0;
  Tuner.lostFrames = 0; Tuner.calibDone = true; Tuner.tunedSet.clear();
  for (let i = 0; i < frames; i++) {
    Tuner.onPitch({ freq, rms: 0.05, clarity: 0.99 });
  }
  return {
    note: $('#tunerNote').textContent,
    status: $('#tunerStatus').textContent,
    freq: $('#tunerFreq').textContent,
    inTune: Tuner.inTune,
    heard: Tuner.heardString,
  };
}

test('TO-4 4 弦二次谐波 293.66Hz：锁定 4 弦时仍判为 D 准音', () => {
  const r = feed(293.66, { picked: 50 });
  assert.strictEqual(r.note, 'D', `应显示 D，实际 ${r.note}`);
  assert.ok(r.inTune, `谐波误锁应折回 D3 并判准，实际状态「${r.status}」`);
  assert.strictEqual(r.heard, 4, `应归属 4 弦，实际 ${r.heard}`);
  assert.ok(Math.abs(parseFloat(r.freq) - D3) < 1, `显示频率应折回 146.8Hz，实际 ${r.freq}`);
});

test('TO-5 4 弦二次谐波 293.66Hz：自动模式不得误判给 1 弦', () => {
  const r = feed(293.66);
  assert.strictEqual(r.note, 'D', `应显示 D，实际 ${r.note}（旧实现显示 E 偏高 200 音分）`);
  assert.strictEqual(r.heard, 4, `应归属 4 弦，实际 ${r.heard}`);
  assert.ok(r.inTune, `应判准，实际「${r.status}」`);
});

test('TO-6 真实跑音不得被八度归一掩盖', () => {
  for (const c of [-660, -100, 200, 700]) {
    const r = feed(D3 * Math.pow(2, c / 1200), { picked: 50 });
    assert.strictEqual(r.inTune, false, `4 弦偏差 ${c} 音分不得判准，实际「${r.status}」`);
    assert.ok(r.status.includes(String(Math.abs(c))), `偏差应如实显示 ${Math.abs(c)} 音分，实际「${r.status}」`);
  }
});

test('TO-7 半音阶模式不受八度归一影响', () => {
  const r = feed(293.66, { mode: 'chromatic' });
  assert.strictEqual(r.note, 'D4', `半音阶模式应显示 D4，实际 ${r.note}`);
});
