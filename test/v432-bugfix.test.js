/* ============================================================
   六弦工坊 V4.3.2 · test/v432-bugfix.test.js
   ------------------------------------------------------------
   对应《吉他工坊 Bug 检测与修复报告》（docs/V4.3.1_BUG_DETECTION_REPORT.md）
   BUG-01（P1）core/audio-engine.js _integrateTone 跨 AudioContext 导致 master 悬空
   BUG-02（P2）modules/scale.js 音阶跟弹缺弹错提示
   RISK-01    modules/metronome.js 降级 click 的 when 负偏移钳制
   RISK-02    core/tone-loader.js 全源失败用户可见提示
   ------------------------------------------------------------
   B 类为真实行为级：在测试桩下 import 被测模块并驱动状态机，
   不只做静态源码断言。
   ============================================================ */
'use strict';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

const AE_SRC = read('assets/js/core/audio-engine.js');
const SCALE_SRC = read('assets/js/modules/scale.js');
const METRO_SRC = read('assets/js/modules/metronome.js');
const LOADER_SRC = read('assets/js/core/tone-loader.js');
const TONEENG_SRC = read('assets/js/core/tone-engine.js');
const HTML = read('app.html');

const LANGS = ['zh-CN', 'en', 'ja', 'ko'];
const DICT = {};
for (const lang of LANGS) DICT[lang] = (await imp(`assets/js/i18n/${lang}.js`)).DICT;
const { 'zh-CN': ZH, en: EN, ja: JA, ko: KO } = DICT;
const CJK = /[\u4e00-\u9fff]/;

/* ---------- BUG-01 静态：同上下文守卫 + 异常恢复 ---------- */
test('B1-1 BUG-01 _integrateTone 含同上下文守卫（master.context === buses.ctx）', () => {
  assert.ok(/this\.master\.context\s*!==\s*buses\.ctx/.test(AE_SRC),
    '缺少跨上下文守卫：master 会在 connect 抛错后悬空');
  // 旧缺陷形态：无条件 disconnect() 后紧跟 connect(buses.music)，且不在守卫内
  const body = AE_SRC.slice(AE_SRC.indexOf('_integrateTone()'), AE_SRC.indexOf('/* 拨弦合成'));
  assert.ok(!/this\.master\.disconnect\(\);\s*\n\s*this\.master\.connect\(ToneEngine\.rawBuses\.music\)/.test(body),
    '仍是「先断开自身输出再跨上下文 connect」的原始缺陷代码');
  assert.ok(/catch\s*\(e\)[\s\S]*?this\.master\.connect\(this\.ctx\.destination\)/.test(body),
    '异常分支未把 master 恢复到本上下文 destination');
  assert.ok(/this\.master\.connect\(buses\.music\)/.test(body), '缺少汇入 Tone 总线的连接');
});

test('B1-2 BUG-01 行为级：跨上下文时不触碰 master，原生输出保持', async () => {
  await imp('test/_gp-stubs.mjs');
  // ToneEngine 全局桩：rawBuses.ctx 与 AudioEngine.master.context 刻意不同（真实运行态）
  const ctxA = { destination: { id: 'destA' }, currentTime: 0, state: 'running' };
  const ctxB = { destination: { id: 'destB' } };
  const music = { id: 'musicB' };
  const calls = [];
  const master = {
    context: ctxA,
    connect(t) { calls.push(['connect', t && t.id]); },
    disconnect(t) { calls.push(['disconnect', t ? t.id : '*']); },
  };
  globalThis.ToneEngine = { ensure: async () => ({}), rawBuses: { music, ctx: ctxB } };
  const { AudioEngine } = await imp('assets/js/core/audio-engine.js');
  AudioEngine.ctx = ctxA; AudioEngine.master = master;
  AudioEngine._integrateTone();
  await new Promise((r) => setImmediate(r));
  assert.deepStrictEqual(calls, [],
    '跨上下文时不应 disconnect/connect：master 必须保持 ensure() 里建立的原生 destination 输出');
});

test('B1-3 BUG-01 行为级：同上下文时先连总线、再断旧 destination', async () => {
  const ctxA = { destination: { id: 'destA' }, currentTime: 0, state: 'running' };
  const music = { id: 'musicA' };
  const calls = [];
  const master = {
    context: ctxA,
    connect(t) { calls.push(['connect', t && t.id]); },
    disconnect(t) { calls.push(['disconnect', t ? t.id : '*']); },
  };
  globalThis.ToneEngine = { ensure: async () => ({}), rawBuses: { music, ctx: ctxA } };
  const { AudioEngine } = await imp('assets/js/core/audio-engine.js');
  AudioEngine.ctx = ctxA; AudioEngine.master = master;
  AudioEngine._integrateTone();
  await new Promise((r) => setImmediate(r));
  assert.deepStrictEqual(calls, [['connect', 'musicA'], ['disconnect', 'destA']],
    '同上下文应先建立到 Tone 总线的新连接再断旧输出，杜绝「先断后连失败→悬空」');
});

test('B1-4 BUG-01 行为级：connect 抛错时 catch 恢复 master→ctx.destination', async () => {
  const ctxA = { destination: { id: 'destA' }, currentTime: 0, state: 'running' };
  const music = { id: 'musicA' };
  const calls = [];
  let thrown = false;
  const master = {
    context: ctxA,
    connect(t) {
      if (t === music && !thrown) { thrown = true; throw new Error('InvalidAccessError'); }
      calls.push(['connect', t && t.id]);
    },
    disconnect(t) { calls.push(['disconnect', t ? t.id : '*']); },
  };
  globalThis.ToneEngine = { ensure: async () => ({}), rawBuses: { music, ctx: ctxA } };
  const { AudioEngine } = await imp('assets/js/core/audio-engine.js');
  AudioEngine.ctx = ctxA; AudioEngine.master = master;
  AudioEngine._integrateTone();
  await new Promise((r) => setImmediate(r));
  assert.ok(thrown, '用例前提：connect 应抛出');
  assert.deepStrictEqual(calls, [['disconnect', '*'], ['connect', 'destA']],
    '异常后必须断开全部输出并重建到本上下文 destination，绝不让 master 悬空');
});

/* ---------- BUG-02 静态：判定/反馈/复位配套 ---------- */
test('B2-1 BUG-02 onPitch 连续 3 帧弹错判定 + 冷却 + 无有效音高不误判', () => {
  assert.ok(/missN>=3/.test(SCALE_SRC), '缺少连续 3 帧非目标音判定');
  assert.ok(/missUntil\s*=\s*performance\.now\(\)\+/.test(SCALE_SRC), '缺少提示冷却，长按会刷屏');
  assert.ok(/if\(!c \|\| !r\.freq\)\{[^}]*missN=0/.test(SCALE_SRC),
    '无有效音高时必须清零 missN，否则余音衰减期会被误判连续弹错');
  assert.ok(/if\(AudioCore\.isPitchMatch[\s\S]{0,180}?missN=0/.test(SCALE_SRC),
    '弹对目标音时必须清零 missN');
});

test('B2-2 BUG-02 flashMiss 反馈契约（闪红/误弹格/错误音/清连击/toast/tip）', () => {
  assert.ok(/flashMiss\(midiFloat,\s*c\)\s*\{/.test(SCALE_SRC), '缺少 flashMiss 实现');
  assert.ok(/classList\.add\('miss'\)/.test(SCALE_SRC), '缺少目标格闪红');
  assert.ok(/this\.cells\.find\(/.test(SCALE_SRC), '缺少误弹格定位');
  assert.ok(/AudioEngine\.tone\(196,\.14,'square'/.test(SCALE_SRC), '缺少 196Hz 方波错误音');
  assert.ok(/this\.combo=0/.test(SCALE_SRC), '弹错未清连击');
  assert.ok(/toast\(T\('scx\.wrong'\),'err'/.test(SCALE_SRC), '缺少弹错 toast');
  assert.ok(/_txt\('#scxTip','scx\.tip\.wrong'\)/.test(SCALE_SRC), '缺少常驻 tip 提示');
  assert.ok(/bestCombo=Math\.max/.test(SCALE_SRC), 'bestCombo 应保留（advance 中仍取最大值）');
});

test('B2-3 BUG-02 配套复位：startFollow / clearAll / stopAll', () => {
  assert.ok(/this\.missN=0;?\s*this\.missUntil=0/.test(SCALE_SRC), 'startFollow 未复位弹错计数/冷却');
  assert.ok(/clearAll\(\)\{[^}]*remove\('now','done','miss'\)/.test(SCALE_SRC),
    'clearAll 未清除 miss 类，上一轮红闪会残留');
  assert.ok(/clearTimeout\(this\.missTimer\);\s*clearTimeout\(this\.missTipTimer\)/.test(SCALE_SRC),
    'stopAll 未清理红闪/提示恢复定时器');
});

test('B2-4 BUG-02 CSS：.miss 闪红 + scxShake 抖动动画', () => {
  assert.ok(/\.scx-cell\.miss,\.scx-open\.miss\{/.test(HTML), '缺少 miss 样式');
  assert.ok(/@keyframes scxShake/.test(HTML), '缺少 scxShake 抖动动画');
  assert.ok(/\.scx-cell\.miss \.scx-dot/.test(HTML), '缺少红点覆盖 now 脉冲');
  assert.ok(/var\(--red\)/.test(HTML), '闪红应复用主题 --red');
});

test('B2-5 BUG-02 行为级：连续 3 帧非目标音 → 触发 flashMiss 且清连击/toast/tip', async () => {
  await imp('test/_gp-stubs.mjs');
  await imp('assets/js/data/scales.js');
  globalThis.AudioEngine = { tone() {}, pluck() {}, ensure() {}, ctx: { currentTime: 0 } };
  const toasts = [];
  globalThis.toast = (msg, type) => toasts.push({ msg, type });
  // 宿主取词（缺词回退 key），确保 T/TF 正常
  globalThis.window = globalThis;
  globalThis.t = (k) => (ZH[k] ?? k);
  const { Scale } = await imp('assets/js/modules/scale.js');

  const c = { s: 0, f: 0, midi: 40, pc: 4 };            // 目标 E2
  Scale.mode = 'follow'; Scale.seq = [c]; Scale.cells = [c]; Scale.i = 0;
  Scale.cand = null; Scale.candN = 0; Scale.missN = 0; Scale.missUntil = 0;
  Scale.combo = 7; Scale.bestCombo = 12; Scale.cooldown = 0;
  Scale._langText = {}; Scale.missTimer = null; Scale.missTipTimer = null;
  // 冻结时钟：让 missUntil 冷却可控
  const realNow = performance.now;
  let now = 1000;
  performance.now = () => now;
  const realST = globalThis.setTimeout;
  globalThis.setTimeout = () => 1;          // 不真正排定时器
  globalThis.clearTimeout = () => {};
  let flashArg = null;
  const origFlash = Scale.flashMiss;
  Scale.flashMiss = function (m, cc) { flashArg = { m, cc }; return origFlash.call(this, m, cc); };

  try {
    // 3 帧非目标音（440Hz → MIDI69，远离目标 40）
    Scale.onPitch({ freq: 440 });
    Scale.onPitch({ freq: 440 });
    assert.strictEqual(flashArg, null, '不足 3 帧不应触发弹错');
    assert.strictEqual(Scale.combo, 7, '未触发弹错时连击不应清零');
    Scale.onPitch({ freq: 440 });
    assert.ok(flashArg, '第 3 帧应触发 flashMiss');
    assert.strictEqual(Scale.combo, 0, '弹错应清零连击');
    assert.strictEqual(Scale.bestCombo, 12, '最高连击应保留');
    assert.strictEqual(Scale.missN, 0, '触发后 missN 应归零');
    assert.ok(Scale.missUntil > now, '应设置提示冷却');
    assert.ok(toasts.some((t) => t.type === 'err'), '应弹出 err toast');
    assert.strictEqual(Scale._langText['#scxTip'].key, 'scx.tip.wrong', 'tip 应记录取词来源');
    // 冷却期内不再重复触发
    flashArg = null;
    for (let i = 0; i < 6; i++) Scale.onPitch({ freq: 440 });
    assert.strictEqual(flashArg, null, '冷却期内不应重复刷 toast/错误音');
  } finally {
    performance.now = realNow;
    globalThis.setTimeout = realST;
    Scale.flashMiss = origFlash;
  }
});

test('B2-6 BUG-02 行为级：弹对目标音推进且不残留弹错计数；无 freq 不误判', async () => {
  const { Scale } = await imp('assets/js/modules/scale.js');
  const c = { s: 0, f: 0, midi: 40, pc: 4 };
  const realNow = performance.now;
  let now = 5000;
  performance.now = () => now;
  const realST = globalThis.setTimeout;
  globalThis.setTimeout = () => 1;
  globalThis.clearTimeout = () => {};
  let advanced = 0;
  const origAdvance = Scale.advance;
  Scale.advance = function () { advanced++; /* 不真正推进，避免越界 */ };
  try {
    Scale.mode = 'follow'; Scale.seq = [c]; Scale.cells = [c]; Scale.i = 0;
    Scale.cand = null; Scale.candN = 0; Scale.missN = 2; Scale.missUntil = 0;
    Scale.combo = 3; Scale.cooldown = 0; Scale._langText = {};
    const f = 82.41; // E2 ≈ MIDI40
    Scale.onPitch({ freq: f });
    Scale.onPitch({ freq: f });
    assert.strictEqual(Scale.missN, 0, '弹对应清零弹错计数');
    assert.strictEqual(advanced, 1, '连续 2 帧匹配应推进一次');
    // 无有效音高：不应累加 missN、不应推进
    Scale.missN = 2; Scale.candN = 0; Scale.cand = null;
    Scale.onPitch({ freq: 0 });
    assert.strictEqual(Scale.missN, 0, '无有效音高应清零 missN（余音期不误判弹错）');
  } finally {
    performance.now = realNow;
    globalThis.setTimeout = realST;
    Scale.advance = origAdvance;
  }
});

/* ---------- 四语词条 ---------- */
test('B3-1 新增四语词条齐全、非空、EN/KO 不夹带中文', () => {
  for (const k of ['scx.wrong', 'scx.tip.wrong', 'tone.fallback']) {
    for (const lang of LANGS) {
      assert.ok(DICT[lang][k] && DICT[lang][k].trim(), `${k} 在 ${lang} 缺失或为空`);
    }
    assert.ok(!CJK.test(EN[k]), `${k} 英文译文夹带汉字：${EN[k]}`);
    assert.ok(!CJK.test(KO[k]), `${k} 韩文译文夹带汉字：${KO[k]}`);
  }
  assert.notStrictEqual(EN['scx.wrong'], ZH['scx.wrong'], 'scx.wrong 未翻译');
  assert.notStrictEqual(JA['scx.wrong'], ZH['scx.wrong'], 'scx.wrong 日文未翻译');
});

test('B3-2 四语键集合仍完全一致（新增键同步到四语）', () => {
  const base = Object.keys(ZH).sort();
  assert.ok(base.length >= 664, `词条量应 >= 664，实测 ${base.length}`);
  for (const lang of ['en', 'ja', 'ko']) {
    assert.deepStrictEqual(Object.keys(DICT[lang]).sort(), base, `${lang} 键集合不一致`);
  }
});

/* ---------- BUG-03：真实浏览器复验发现（Chromium + Tone 15.1.22） ----------
   tone-engine.js 把原生 GainNode connect(limiter.input)（Tone 包装对象）会抛
   "Overload resolution failed"，catch 内二次 connect 再抛错 → 整个 ensure()
   失败、Tone=null、六种合成器音色与 Transport 全废。修复：连接目标取限幅器
   底层原生节点，且整段非致命（失败不拖垮 Tone 主链）。 */
test('B0-1 BUG-03 原生总线连接取限幅器底层原生节点，且整段非致命', () => {
  assert.ok(/limNative\s*=/.test(TONEENG_SRC) && /_nativeAudioNode/.test(TONEENG_SRC),
    '未取 limiter 的底层原生节点，cross-wrapper connect 会失败');
  assert.ok(!/rawMusic\.connect\(limiter\.input\)/.test(TONEENG_SRC),
    '仍是「原生节点 connect 到 Tone 包装对象」的缺陷写法');
  assert.ok(/rawGain\.connect\(limiter\)/.test(TONEENG_SRC), '缺少 Tone 包装对包装的降级路径');
  assert.ok(/rawMusic\.connect\(dest\)/.test(TONEENG_SRC), '缺少直连 destination 的最终兜底');
  // 原生总线整段在独立 try/catch 内，且 return Tone 在其外（失败不影响主链）
  const seg = TONEENG_SRC.slice(TONEENG_SRC.indexOf('this.buses ='), TONEENG_SRC.indexOf('return Tone;'));
  assert.ok(/try\s*\{[\s\S]*?this\.rawBuses[\s\S]*?\}\s*catch\s*\(e\)[\s\S]*?this\.rawBuses = null/.test(seg),
    '原生总线创建失败必须被隔离，不能让 ensure() 返回 null');
  assert.ok(/console\.warn\([^\n]*不影响合成器链/.test(TONEENG_SRC),
    '降级告警应说明「不影响合成器链」，避免误判为整体失败');
});

test('B0-2 BUG-03 结构契约：原生总线 try/catch 闭合在 return Tone 之前', () => {
  /* 真实行为级由 /tmp/v432_browser_verify.py 在 Chromium + Tone 15.1.22 下复验
     （ensure() 返回 Tone、buses/rawBuses 均就绪、零 warning）。此处锁定结构：
     原生总线的异常必须在 return Tone 之前被吞掉，不能冒泡到外层 catch 把
     this.Tone 置 null。 */
  const ensureBody = TONEENG_SRC.slice(TONEENG_SRC.indexOf('async ensure()'), TONEENG_SRC.indexOf('async ensureContext()'));
  const returnIdx = ensureBody.lastIndexOf('return Tone;');
  const busTry = ensureBody.indexOf('try {', ensureBody.indexOf('this.buses ='));
  const busCatch = ensureBody.indexOf('catch (e)', busTry);
  assert.ok(returnIdx > 0, 'ensure 缺少成功路径 return Tone');
  assert.ok(busTry > 0 && busCatch > busTry && busCatch < returnIdx,
    '原生总线 try/catch 未闭合在 return Tone 之前，失败会中断主链');
  // 外层 catch 只在 Tone.start / 总线创建等主链异常时置 Tone=null
  const outerCatch = ensureBody.lastIndexOf('catch (e)');
  assert.ok(/this\.Tone = null/.test(ensureBody.slice(outerCatch)),
    '外层 catch 应保留 Tone=null 的降级语义');
});

/* ---------- RISK-01 / RISK-02 ---------- */
test('R1-1 RISK-01 降级 catch 分支 when 钳制到 >= 0', () => {
  assert.ok(/const off = Math\.max\(0, \(time\|\|0\) - \(ctxA \? ctxA\.currentTime : 0\)\)/.test(METRO_SRC),
    '降级 click 未把跨时钟偏移钳制到非负，会重现「start/stop 落在过去→静音」');
  assert.ok(/AudioEngine\.click\(this\.beat===0, off\)/.test(METRO_SRC),
    '降级 click 未使用钳制后的 off');
});

test('R2-1 RISK-02 全源失败时一次性、四语、带守卫的用户提示', () => {
  assert.ok(/function notifyFallback\(\)/.test(LOADER_SRC), '缺少 notifyFallback');
  assert.ok(/_fallbackWarned/.test(LOADER_SRC), '缺少一次性标志，会重复弹提示');
  assert.ok(/window\.t\('tone\.fallback'\)/.test(LOADER_SRC), '提示未走四语词条');
  assert.ok(/DOMContentLoaded/.test(LOADER_SRC), '预取阶段 DOM 未就绪，缺少 DOMContentLoaded 守卫');
  assert.ok(/notifyFallback\(\)/.test(LOADER_SRC.slice(LOADER_SRC.indexOf('全部来源加载失败'))),
    '全源失败分支未调用 notifyFallback');
  // 提示失败不得影响音频降级：全程在 try/catch 内
  assert.ok(/try\{[\s\S]*?window\.toast\(pick,'warn',4200\)[\s\S]*?\}catch/.test(LOADER_SRC),
    'toast 调用缺少异常隔离');
});
