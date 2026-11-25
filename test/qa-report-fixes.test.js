/* ============================================================
   六弦工坊 · 《全功能体验测试报告》(2026-11-26) 缺陷回归
   ------------------------------------------------------------
   QA-01  P1 和弦闯关「按法」文字必须 = 当前和弦（行为级 + 源码契约）
   QA-02  P2 手机端底部导航不再遮挡调音器主 CTA（CSS 契约）
   QA-03  P2 手机端曲谱工坊工具条按钮不收缩/不溢出（CSS 契约）
   QA-04  P3 四语文案：关闭按钮去双语、标题补空格、BPM 口径一致
   QA-05  P3 数据/命名一致性：模块数量、难度占位符、三处命名
   QA-06  环境：Windows 下 tools 动态 import 必须走 file:// URL
   本文件只做「有牙」的断言：能行为验证的尽量行为验证，其余做源码契约。
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

const LANGS = ['zh-CN', 'en', 'ja', 'ko'];
const DICT = {};
for (const l of LANGS) DICT[l] = (await imp(`assets/js/i18n/${l}.js`)).DICT;

/* ============================================================
   QA-01 和弦闯关按法文字 = 当前和弦
   ============================================================ */
await import('./_gp-stubs.mjs');
await imp('assets/js/data/chords.js');                       // 注入 CHORD_MAP / formatFingering
const { Game } = await imp('assets/js/modules/chord-game.js');

test('QA-01 行为级：nextChord 后 #gameFingering 文字按法等于当前和弦（G / Am / Em）', () => {
  const holder = globalThis.$('#gameFingering');
  const fmt = window.formatFingering;
  const map = window.CHORD_MAP;
  Game.level = 0;
  Game.total = 3;
  Game.queue = ['G', 'Am', 'Em'];
  Game.idx = 0;
  Game.running = true;
  Game.skipTimer = null;
  try {
    const seen = [];
    for (let i = 0; i < Game.queue.length; i++) {
      Game.idx = i;
      Game.nextChord();
      const expected = fmt(map[Game.queue[i]]);
      assert.equal(holder.textContent, expected,
        `第 ${i + 1} 题 ${Game.queue[i]} 的按法文字应等于该和弦的指法文本`);
      seen.push(holder.textContent);
      clearInterval(Game.timer);
    }
    assert.equal(new Set(seen).size, 3, '三个不同和弦的按法文字不能全部相同（原缺陷恒为 C）');
    assert.notEqual(seen[0], fmt(map.C), '首题 G 不应显示 C 和弦的 x32010 按法');
  } finally {
    clearInterval(Game.timer);
    Game.running = false;
  }
});

test('QA-01 源码契约：nextChord 与 refreshLang 均统一渲染指法图 + 按法文本', () => {
  const src = read('assets/js/modules/chord-game.js');
  const next = src.slice(src.indexOf('nextChord(){'), src.indexOf('skipChord(){'));
  const refresh = src.slice(src.indexOf('refreshLang(){'), src.indexOf('};\nif(typeof document'));
  assert.match(next, /this\._renderFingering\(\)/, 'nextChord 必须调用 _renderFingering');
  assert.match(refresh, /this\._renderFingering\(\)/, '切语言时按法文案必须同步重算');
  assert.match(src, /#gameFingering/, '_renderFingering 必须写入 #gameFingering');
});

/* ============================================================
   QA-02 手机端底部导航不遮挡调音器主 CTA
   ============================================================ */
test('QA-02 CSS 契约：移动端 .view 底部预留 tabbar 高度 + 安全区，调音器 CTA 压缩上移并吸底', () => {
  const ui = read('assets/css/ui-kit.css');
  const mobile = ui.slice(ui.indexOf('@media (max-width:860px)'), ui.indexOf('@media (max-width:380px)'));
  assert.match(mobile, /var\(--tabbar-h\)/, '底部 padding 必须以 --tabbar-h 为基准');
  assert.match(mobile, /env\(safe-area-inset-bottom\)/, '底部 padding 必须计入安全区');

  const html = read('app.html');
  const tuner = html.slice(html.indexOf('视图：调音器'), html.indexOf('视图：节拍器'));
  assert.match(tuner, /@media \(max-width:860px\)/, '调音器必须有移动端紧凑布局');
  assert.match(tuner, /\.dial-wrap\{height:118px/, '表盘高度必须压缩');
  assert.match(tuner, /position:sticky/, '主 CTA 需吸底兜底，保证短屏也可点');
  assert.match(tuner, /id="tunerToggle"/, '主按钮仍存在');
});

/* ============================================================
   QA-03 曲谱工坊工具条按钮不收缩 / 不溢出
   ============================================================ */
test('QA-03 CSS 契约：工具条按钮禁止 flex 收缩、不换行并设最小宽度，小屏双行布局', () => {
  const css = read('assets/css/sheet-studio.css');
  assert.match(css, /\.sbl-bar > button \{ flex: 0 0 auto; white-space: nowrap; \}/,
    '按钮不得被 flex 压到 53px');
  assert.match(css, /min-width: 96px/, '「新建曲谱」需 ≥4 个汉字的宽度');
  const small = css.slice(css.indexOf('@media (max-width: 479px)'), css.indexOf('@media print'));
  assert.match(small, /\.sbl-bar \.sbl-search \{ flex: 1 1 100%/, '小屏搜索框独占一行');
});

/* ============================================================
   QA-04 国际化与文案一致性
   ============================================================ */
test('QA-04.1 语言/主题面板关闭按钮不再硬编码「关闭 / Close」，四语各自单语', () => {
  const i18n = read('assets/js/core/i18n.js');
  const theme = read('assets/js/core/theme-switch.js');
  assert.doesNotMatch(i18n, /关闭 \/ Close/, '语言面板不得残留双语硬编码');
  assert.match(i18n, /id="gsLangClose">\$\{t\('common\.close'\)\}/, '关闭按钮须取词条');
  assert.match(theme, /id="gsThemeClose">\$\{T\('common\.close'/, '主题面板关闭按钮与语言面板统一');
  for (const l of LANGS) {
    assert.ok(!DICT[l]['common.close'].includes('/'), `${l} 的 common.close 不得混排双语`);
  }
  assert.equal(DICT['zh-CN']['common.close'], '关闭');
  assert.equal(DICT.en['common.close'], 'Close');
});

test('QA-04.2 首页大标题 title2 与 <em> 之间有空格（英文不再是 insideyour）', () => {
  const html = read('app.html');
  const h1 = html.match(/<h1>[\s\S]*?<\/h1>/)[0];
  assert.match(h1, /<\/span> <em>/, '两段之间必须有一个空格');
  assert.match(h1, /data-i18n="home\.hero\.title2"/);
  assert.match(h1, /data-i18n="home\.hero\.title3"/);
});

test('QA-04.3 节拍器 BPM 文案四语一致为 30-300，中文不再写 40-240', () => {
  for (const l of LANGS) {
    assert.ok(/30-300 BPM/.test(DICT[l]['tool.metro.desc']),
      `${l} 的 tool.metro.desc 应为 30-300 BPM`);
  }
  const src = read('assets/js/modules/metronome.js');
  assert.match(src, /clamp\(bpm,30,300\)|min=30|max=300/, '源码滑块范围仍为 30-300');
});

/* ============================================================
   QA-05 数据与命名一致性
   ============================================================ */
test('QA-05.1 首页模块数量口径由「九大模块」对齐实际 14 个模块（四语同步）', () => {
  const html = read('app.html');
  assert.doesNotMatch(html, /九大模块/);
  assert.match(html, /14 大模块/);
  assert.doesNotMatch(DICT['zh-CN']['home.hero.sub'], /九大模块/);
  const expect = { 'zh-CN': '14 大模块', en: '14 modules', ja: '14 モジュール', ko: '14개 모듈' };
  for (const l of LANGS) {
    assert.ok(DICT[l]['home.hero.sub'].includes(expect[l]), `${l} 首页副标题应为 ${expect[l]}`);
  }
});

test('QA-05.2 曲谱工坊三处命名统一（侧栏 / 页面标题 / 曲库快捷入口）', () => {
  for (const l of LANGS) {
    assert.equal(DICT[l]['sheet.lib.title'], DICT[l]['tool.sheets'],
      `${l} 页面标题应与侧栏模块名一致`);
    assert.equal(DICT[l]['songbook.tab.mine'], DICT[l]['tool.sheets'],
      `${l} 曲库快捷入口应与模块名一致`);
  }
  assert.equal(DICT['zh-CN']['sheet.lib.title'], '曲谱工坊');
});

test('QA-05.3 行为级：无难度数据时不再出现「—★」「难度 —」占位符', async () => {
  const { Songbook } = await imp('assets/js/modules/songbook.js');
  Songbook._practiced = new Set();
  const base = {
    id: 'song-qa', no: 1, title: '测试曲', artist: '朴树', duration: '02:48',
    tier: 1, sheetCount: 1, hasQQChord: false, minDifficulty: null,
    sheets: [{ source: 'qa', name: '谱1', url: '', difficulty: null }],
  };
  const empty = Songbook.songCard(base, 1).innerHTML;
  assert.doesNotMatch(empty, /—/, '空难度不得输出占位破折号');
  assert.doesNotMatch(empty, /songbook\.difficulty/, '空难度不得输出难度徽章');
  assert.doesNotMatch(empty, /★/, '空难度不得输出星级');

  const filled = Songbook.songCard({ ...base, minDifficulty: 3,
    sheets: [{ source: 'qa', name: '谱1', url: '', difficulty: 3 }] }, 1).innerHTML;
  assert.match(filled, /3★/, '有难度时仍应显示星级');
  assert.match(filled, /songbook\.difficulty 3/, '有难度时仍应显示难度徽章');
});

/* ============================================================
   QA-06 Windows 下 tools 动态 import 必须走 file:// URL
   ============================================================ */
test('QA-06 tools 脚本动态 import 使用 pathToFileURL（避免 ERR_UNSUPPORTED_ESM_URL_SCHEME）', () => {
  for (const rel of ['tools/derive-harmony.mjs', 'tools/diagnose-songbook.mjs']) {
    const src = read(rel);
    assert.match(src, /pathToFileURL/, `${rel} 必须导入 pathToFileURL`);
    assert.doesNotMatch(src, /await import\(join\(ROOT/, `${rel} 不得直接用 Windows 绝对路径 import`);
  }
});
