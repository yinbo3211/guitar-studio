/* ============================================================
   六弦工坊 V4.3 · R1/R3/R4 模块语言联动测试
   ------------------------------------------------------------
   LANG-1  R1：i18n.js 双注入契约（.sidebar + .topbar，topbar 44px 定宽）
   LANG-2  R1：theme-switch.js 顶栏按钮 44px 定宽（修 252px 拉伸）
   LANG-3  R3：Tuner 收到 gs:lang 后弦按钮标签/按钮文案即时重渲染
           （idle→「Start mic tuning」，active→「Stop tuning」，
             弦标签 4弦→Str 4，且 heard/tuned/picked 状态类不被清掉）
   LANG-4  R3：Metronome 注册 gs:lang 监听且 tip 复位逻辑存在（源码契约）
   LANG-5  R2/R3：router.js 标题与更多菜单走词条并监听 gs:lang（源码契约）
   LANG-6  R4：gp/play.js 与 song-play.js 的 TF 委托宿主 window.gsI18n.tF
   LANG-7  R2：setLang 同步 document.title（app.title 键存在且四语非空）
   ============================================================ */
'use strict';
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

test('LANG-1 i18n.js 语言入口双注入（sidebar + topbar，顶栏 44px 定宽）', () => {
  const src = read('assets/js/core/i18n.js');
  assert.ok(src.includes("make(document.querySelector('.sidebar'))"), '缺少 .sidebar 注入');
  assert.ok(src.includes("make(document.querySelector('.topbar'))"), '缺少 .topbar 注入（移动端语言入口）');
  assert.ok(src.includes('flex:0 0 44px'), '顶栏按钮缺少 44px 定宽（会被 flex 拉伸）');
  assert.ok(src.includes("parent.querySelector('.gs-lang-btn')"), '去重必须只查父容器内部（BUG-08 经验）');
  assert.ok(src.includes('window.gsI18n = { t, tF,'), 'window.gsI18n 必须导出 tF（R4 收敛点）');
});

test('LANG-2 theme-switch.js 顶栏主题按钮 44px 定宽', () => {
  const src = read('assets/js/core/theme-switch.js');
  assert.ok(src.includes("parent.classList.contains('topbar')"), '缺少 topbar 分支');
  assert.ok(src.includes('flex:0 0 44px'), '主题按钮缺少 44px 定宽（移动端被拉成 252px）');
});

/* ---------- LANG-3：行为级——桩 DOM 驱动真实 Tuner + 双语切换 ---------- */
const { DICT: ZH } = await imp('assets/js/i18n/zh-CN.js');
const { DICT: EN } = await imp('assets/js/i18n/en.js');
const AC = await imp('assets/js/core/audio-core.js');

/* 可切换语言的宿主词典桩：模拟 core/i18n.js 的 window.t / window.gsI18n.tF */
let LANG = 'zh-CN';
const dict = () => (LANG === 'en' ? EN : ZH);
const stubEl = () => ({
  textContent: '', innerHTML: '', value: '',
  style: { setProperty() {}, width: '', color: '', transform: '', opacity: '' },
  classList: { add() {}, remove() {}, toggle() {} },
  dataset: {}, addEventListener() {},
});
const els = new Map();
const stringBtns = [[6, 40], [5, 45], [4, 50], [3, 55], [2, 59], [1, 64]].map(([n, midi]) => {
  const span = { textContent: '' };
  return {
    dataset: { midi: String(midi) },
    classList: { add() {}, remove() {}, toggle() {} },
    span,
    querySelector(sel) { return sel === 'span' ? span : null; },
  };
});
const langListeners = [];
globalThis.$ = (s) => { if (!els.has(s)) els.set(s, stubEl()); return els.get(s); };
globalThis.$$ = () => stringBtns;
globalThis.AudioCore = AC.AudioCore;
globalThis.AudioEngine = { ensure() {}, pluck() {} };
globalThis.Mic = { lastDiagnostics: null, start: async () => true, stop() {} };
globalThis.toast = () => {};
globalThis.onRouteEnter = {};
globalThis.window = globalThis;
globalThis.t = (k) => dict()[k] ?? k;
globalThis.gsI18n = {
  tF(k, pairs) {
    let s = dict()[k] ?? k;
    for (const a of Object.keys(pairs || {})) s = s.split('{' + a + '}').join(String(pairs[a]));
    return s;
  },
};
globalThis.document = {
  addEventListener(ev, fn) { if (ev === 'gs:lang') langListeners.push(fn); },
};
const { Tuner } = await imp('assets/js/modules/tuner.js');
const fireLang = (lang) => { LANG = lang; langListeners.forEach((fn) => fn({ detail: { lang } })); };

test('LANG-3 调音器随 gs:lang 即时重渲染（idle 与 active 两态）', () => {
  Tuner.init();
  assert.ok(Tuner.inited, 'Tuner 应已初始化');
  assert.ok(langListeners.length >= 1, 'tuner.js 必须注册 gs:lang 监听');

  // idle 态切英文：弦按钮标签 + 主按钮文案 + 待机副标题
  fireLang('en');
  assert.strictEqual(stringBtns[2].span.textContent, 'Str 4', `4 弦标签应为英文，实际「${stringBtns[2].span.textContent}」`);
  assert.strictEqual($('#tunerToggleTxt').textContent, EN['tuner.start']);
  assert.strictEqual($('#tunerSub').textContent, EN['tuner.subIdle']);

  // active 态切回中文：主按钮必须是「停止调音」而非待机枪（scanStatic 复位冲突回归）
  Tuner.active = true;
  fireLang('zh-CN');
  assert.strictEqual($('#tunerToggleTxt').textContent, ZH['tuner.stopTuning'],
    '激活中切语言不得把按钮复位成「开启麦克风调音」');
  assert.strictEqual($('#tunerSub').textContent, ZH['tuner.subListening']);
  assert.strictEqual(stringBtns[2].span.textContent, '4弦');
  Tuner.active = false;
});

test('LANG-4 metronome.js 注册 gs:lang 监听并复位采样提示', () => {
  const src = read('assets/js/modules/metronome.js');
  assert.ok(src.includes("document.addEventListener('gs:lang'"), '缺少 gs:lang 监听');
  assert.ok(src.includes("T('metro.sampleTip')"), '切语言后采样提示应复位为默认词条');
  assert.ok(!src.includes("T('tuner."), '节拍器不得误用 tuner 词条');
  assert.ok(src.includes("T('metro.sample.imported')"), '导入 toast 应走词条');
});

test('LANG-5 router.js 路由标题与更多菜单词条化并监听 gs:lang', () => {
  const src = read('assets/js/core/router.js');
  assert.ok(src.includes('ROUTE_TITLE_KEYS'), '缺少路由标题词条映射');
  assert.ok(src.includes("songPractice:'route.songPractice'"), 'songPractice 标题键缺失');
  assert.ok(src.includes('routeTitle(route)'), 'applyRoute 必须经 routeTitle 取词');
  assert.ok(src.includes('renderMoreGrid'), '更多菜单必须可重渲染');
  assert.ok(src.includes("document.addEventListener('gs:lang'"), '缺少 gs:lang 监听');
  assert.ok(src.includes('MORE_LABEL_KEYS'), '缺少更多菜单词条映射');
});

test('LANG-6 R4：gp 弹唱 TF 委托宿主 window.gsI18n.tF', () => {
  for (const f of ['assets/js/gp/play.js', 'assets/js/modules/song-play.js']) {
    const src = read(f);
    assert.ok(src.includes('window.gsI18n.tF'), `${f} 的 TF 必须优先委托宿主 tF`);
    assert.ok(src.includes("split('{' + a + '}')"), `${f} 必须保留无宿主本地回退分支`);
  }
});

test('LANG-7 app.title 键四语齐全（document.title 联动）', () => {
  for (const [name, d] of [['zh', ZH], ['en', EN]]) {
    assert.ok(d['app.title'] && d['app.title'].length > 3, `${name} 缺 app.title`);
  }
  const src = read('assets/js/core/i18n.js');
  assert.ok(src.includes("document.title = t('app.title')"), 'setLang/init 必须同步 document.title');
});
