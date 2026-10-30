/* ============================================================
   六弦工坊 V4.2.6 · 收尾补丁包验收（V6-1..V6-6 可自动化项）
   ------------------------------------------------------------
   需求源：《V4.2.5 全量测试报告》第八节 N-1..N-6 + 第九节 9.1–9.6；
   设计：docs/V4.2.6_INCREMENTAL_DESIGN.md（含对需求源 4 处实测纠正）。

   V6-1   N-1 版本号/json 双源一致 + README 含当前版本章节（lint C8 的单测级双保险）
   V6-2    N-2 六键去 emoji + N-3 coinsHint 中性化 + N-4/N-5 新增键落地
   V6-3    N-3 死链清除（play.js 无生产者、song-play.js NAV 目标必须是真实路由）
   V6-4    N-4 返回可发现性（行为级挂载 + CSS 契约 + 顶栏 aria-label）
   V6-5    N-5 无和弦音曲目的弱提示（gp-song-001 / gp-song-002 双向）
   V6-6    N-6 旧 noteSounds 迁移语义（如实断言现状，不改产品代码）

   不可自动化（人工项，见设计 §4.2）：H-1 结算横幅视觉、H-2 无障碍快照、
   H-3 双分辨率截图、H-4 送别弱提示视觉、H-5 四语巡检。
   ============================================================ */
'use strict';
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
/* 绕过 ESM 缓存取一个全新模块实例（W-2 用例需要未被污染的 state.js 内存态） */
const impFresh = (rel) => import(`${pathToFileURL(path.join(ROOT, rel)).href}?fresh=${Date.now()}`);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

await imp('test/_gp-dom.mjs');
const { El } = await imp('test/_gp-dom.mjs');
const { Store } = await imp('assets/js/gp/state.js');

const LANGS = ['zh-CN', 'en', 'ja', 'ko'];
const DICTS = {};
for (const lang of LANGS) DICTS[lang] = (await imp(`assets/js/i18n/${lang}.js`)).DICT;

const PLAY_SRC = read('assets/js/gp/play.js');
const NAV_SRC = read('assets/js/modules/song-play.js');
const ROUTER_SRC = read('assets/js/core/router.js');
const I18N_CORE_SRC = read('assets/js/core/i18n.js');
const STATE_SRC = read('assets/js/gp/state.js');
const CSS = read('assets/css/gp.css');
const README = read('README.md');

/* 贴纸符号范围（与 test/gp-play-v425.test.js:39 同口径）：
   箭头/几何(2190-21FF) 杂项符号(2300-27FF) 装饰符号(2B00-2BFF) emoji(1F000-1FAFF)。
   ⚠️ 检查面刻意收窄到本轮实际清理的键：play.back「←」/play.backToSongs「←」/
      play.sheetLink「→」/play.harmonica.draw「↓」等在既有设计口径内属文字符号，
      扩大到全部 play.* 键会把它们误杀。 */
const STICKER_RE = /[\u2190-\u21FF\u2300-\u27FF\u2B00-\u2BFF\u{1F000}-\u{1FAFF}]/u;
const CLEANED_KEYS = [
  'play.progress', 'play.capo', 'play.yourPart', 'play.part.singalong',
  'play.badge.generated', 'play.result.coins',
];
/* N-3 coinsHint 中性化：四语均不得再指向不存在的「外观 / Locker / ロッカー / 보관함」 */
const DEAD_WORDS = ['外观', 'Locker', 'ロッカー', '보관함'];

/** 取节点及其子节点的全部文本（shim 的按钮文本落在 Text 子节点上） */
function nodeText(node) {
  if (!node) return '';
  if (typeof node.textContent === 'string' && node.textContent) return node.textContent;
  return (node.children || []).map(nodeText).join('');
}

/* ============================================================
   V6-1 N-1 版本一致性
   ============================================================ */
test('V6-1 版本号双源一致 + README 含当前版本章节（C8 单测级复验）', () => {
  const pkgV = JSON.parse(read('package.json')).version;
  const verV = JSON.parse(read('version.json')).version;
  assert.strictEqual(pkgV, verV, `package.json(${pkgV}) 与 version.json(${verV}) 版本号必须同步`);
  assert.strictEqual(pkgV, '4.2.6', `本轮版本应为 4.2.6，实际 ${pkgV}`);
  /* 与 lint C8 完全同口径：#{1,6} + 空格 + V<ver> + 词边界 */
  const escV = String(verV).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headingRe = new RegExp(`^#{1,6}\\s+V${escV}\\b`, 'm');
  assert.ok(headingRe.test(README), `README 缺少形如「## V${verV}」的当前版本章节`);
  /* 鲁棒性护栏：README 允许并存历史章节（V4.2.1..V4.2.5），不得要求唯一 */
  const allHeadings = [...README.matchAll(/^#{1,6}\s+V(\d+\.\d+\.\d+)\b/gm)].map((m) => m[1]);
  assert.ok(allHeadings.length >= 2, `README 应保留多个历史版本章节，实际 ${allHeadings.length}`);
  assert.ok(allHeadings.includes(verV), `其中必须包含当前版本 ${verV}`);
  /* 误命中护栏：V4.2.60 之类前缀不得被判为 V4.2.6 */
  assert.ok(!new RegExp(`^#{1,6}\\s+V${escV}\\b`, 'm').test('## V4.2.60 修订\n'),
    'C8 正则应带词边界，不得把 V4.2.60 误判为 V4.2.6');
});

/* ============================================================
   V6-2 N-2 / N-3 / N-4 / N-5 词条
   ============================================================ */
test('V6-2a N-2 六键 × 四语均无贴纸符号', () => {
  const bad = [];
  for (const lang of LANGS) {
    for (const k of CLEANED_KEYS) {
      const v = DICTS[lang][k];
      assert.ok(typeof v === 'string' && v.length, `${lang}.${k} 缺失`);
      if (STICKER_RE.test(v)) bad.push(`${lang}.${k} = ${v}`);
    }
  }
  assert.deepStrictEqual(bad, [], `仍有贴纸符号残留：${bad.join(' | ')}`);
});

test('V6-2b N-3 play.locker 四语全删 + coinsHint 不再指向不存在的功能', () => {
  for (const lang of LANGS) {
    assert.strictEqual(DICTS[lang]['play.locker'], undefined, `${lang} 仍残留 play.locker`);
    const hint = DICTS[lang]['play.result.coinsHint'];
    assert.ok(typeof hint === 'string' && hint.trim().length > 0, `${lang}.play.result.coinsHint 缺失或为空`);
    for (const w of DEAD_WORDS) {
      assert.ok(!hint.includes(w), `${lang}.play.result.coinsHint 仍提到不存在的「${w}」：${hint}`);
    }
  }
  /* W-1 拍板口径：保留键 + 改写中性文案 → 键必须还在（play.js:761 的 span 不删） */
  assert.ok(/T\("play\.result\.coinsHint"\)/.test(PLAY_SRC), 'play.js 应继续消费 play.result.coinsHint');
});

test('V6-2c N-4/N-5 新增键四语齐全 + 四语 key 集合全等', () => {
  for (const lang of LANGS) {
    for (const k of ['play.back', 'play.noChordHint']) {
      assert.ok(DICTS[lang][k] && String(DICTS[lang][k]).trim().length > 0, `${lang}.${k} 缺失或为空`);
    }
  }
  const base = Object.keys(DICTS['zh-CN']).sort();
  for (const lang of LANGS.slice(1)) {
    assert.deepStrictEqual(Object.keys(DICTS[lang]).sort(), base, `${lang} 与 zh-CN 的 key 集合不一致`);
  }
  /* 占位符：被改写的键不得引入新的占位符差异（coins 保留 {n}） */
  for (const lang of LANGS) {
    assert.ok(DICTS[lang]['play.result.coins'].includes('{n}'), `${lang}.play.result.coins 应保留 {n} 占位符`);
  }
});

/* ============================================================
   V6-3 N-3 死链清除
   ============================================================ */
test('V6-3a play.js 不再生产 #/locker / play.locker', () => {
  /* N-3 的处置说明写在注释里且必须提到源流，故比对前先剥离注释：
     断言的是「没有活代码生产这条导航」，不是「文件里不得出现这个字符串」。 */
  const live = PLAY_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/#\/locker/.test(live), 'play.js 不应再出现 #/locker 导航');
  assert.ok(!/play\.locker/.test(live), 'play.js 不应再取词 play.locker');
  /* 隐藏（而非改映射）的判据：结算横幅仍只有三个既有的真实导航 */
  assert.ok(/navigate\("#\/library"\)/.test(PLAY_SRC), '结算横幅应保留「曲库」按钮');
  assert.ok(/navigate\("#\/history"\)/.test(PLAY_SRC), '结算横幅应保留「练习进度」按钮');
});

test('V6-3b song-play.js NAV 无死映射（通用防死链护栏：目标必须是真实路由）', () => {
  const navBlock = /const NAV = \{([^}]*)\}/.exec(NAV_SRC);
  assert.ok(navBlock, '应能定位 song-play.js 的 NAV 表');
  const pairs = [...navBlock[1].matchAll(/'([^']+)'\s*:\s*'([^']+)'/g)];
  assert.ok(pairs.length >= 2, `NAV 至少应有 #/library 与 #/history 两项，实际 ${pairs.length}`);
  const titleBlock = /const ROUTE_TITLES = \{([\s\S]*?)\};/.exec(ROUTER_SRC);
  assert.ok(titleBlock, '应能定位 router.js 的 ROUTE_TITLES');
  const routes = new Set([...titleBlock[1].matchAll(/([A-Za-z][A-Za-z0-9]*)\s*:/g)].map((m) => m[1]));
  for (const [, hash, target] of pairs) {
    assert.ok(!/locker/.test(hash), `NAV 不得再包含 #/locker 死映射：${hash}`);
    assert.ok(routes.has(target),
      `NAV 目标 ${target} 不在 router.js 的 ROUTE_TITLES 中 → 点击会被兜底回 #/home（新死链）`);
  }
  assert.ok(!/#\/locker\s*:/.test(NAV_SRC), 'NAV 源不得保留 #/locker');
});

/* ============================================================
   V6-4 N-4 返回可发现性
   ============================================================ */
test('V6-4a 返回栏是 shell 首子节点，点击后导航到 #/library，teardown 随之移除', async () => {
  const play = (await imp('assets/js/gp/play.js')).default;
  const root = new El('div');
  const calls = [];
  const cleanup = await play({ el: root, params: ['gp-song-002'], navigate: (h) => calls.push(h) });
  const shell = root.children[0];
  const bar = shell.children[0];
  assert.ok(bar.className.includes('gp-back-bar'), `shell 首子节点应为返回栏，实际 ${bar.className}`);
  const btns = bar.querySelectorAll('button');
  assert.strictEqual(btns.length, 1, `返回栏应只有 1 个按钮，实际 ${btns.length}`);
  assert.strictEqual(nodeText(btns[0]), 'play.back', '按钮文案应取自 play.back（Node 下 T 退化为 key）');
  btns[0].click();
  assert.deepStrictEqual(calls, ['#/library'], `点击「返回」应导航到 #/library，实际 ${JSON.stringify(calls)}`);
  cleanup();
  assert.strictEqual(root.children.length, 0, 'teardown 后 shell（含返回栏）必须被整体移除（RE-1 语义不变）');
});

test('V6-4b gp.css 提供 .gp-scope .gp-back-bar 作用域规则（S-3 之外的显式钉死）', () => {
  assert.match(CSS, /\.gp-scope \.gp-back-bar \{/, 'gp.css 应有 .gp-scope .gp-back-bar 规则');
  assert.match(CSS, /\.gp-scope \.gp-back-bar \.btn \{/, '返回栏按钮应有作用域内尺寸规则');
  const rule = /\.gp-scope \.gp-back-bar \{([^}]*)\}/.exec(CSS)[1];
  assert.match(rule, /flex:\s*none/, '返回栏不吃 stage 之外的弹性空间：需 flex: none');
  assert.match(rule, /clamp\(/, '横向内边距应使用 clamp() 而非 @media 断点');
  /* 追加补丁不得引入 @media（CSSOM 里既有 @media 为空规则，见 KV-4） */
  const patchIdx = CSS.lastIndexOf('\n.gp-scope {');
  const patch = CSS.slice(patchIdx);
  assert.ok(!/@media/.test(patch), '宿主补丁区不得依赖 @media 断点');
  assert.ok(!/\/\*/.test(patch), '本轮 CSS 补丁不得包含注释');
});

test('V6-4c 顶栏纯图标按钮补可访问名（复用既有词条，零新增 key）', () => {
  assert.ok(/function syncAriaLabels\(\)/.test(I18N_CORE_SRC), 'core/i18n.js 应定义 syncAriaLabels');
  assert.match(I18N_CORE_SRC, /querySelectorAll\('\.gs-theme-btn'\)[\s\S]*?aria-label[\s\S]*?t\('theme\.title'\)/,
    '应给 .gs-theme-btn 写 theme.title 作为 aria-label');
  assert.match(I18N_CORE_SRC, /querySelectorAll\('\.gs-lang-btn'\)[\s\S]*?aria-label[\s\S]*?t\('lang\.title'\)/,
    '应给 .gs-lang-btn 写 lang.title 作为 aria-label');
  /* 切语言后可访问名必须跟随 → setLang 内部也要调用 */
  const setLangBody = /export function setLang\(lang\) \{([\s\S]*?)\n\}/.exec(I18N_CORE_SRC);
  assert.ok(setLangBody, '应能定位 setLang 函数体');
  assert.match(setLangBody[1], /syncAriaLabels\(\);/, 'setLang 应重新同步 aria-label');
  /* W-5：#earPlay / #recBtn 本轮不动，仅登记 → 断言本轮不含对它们的改动 */
  assert.ok(!/earPlay|recBtn/.test(I18N_CORE_SRC), '本轮只补主题/语言两键，练耳/录音棚按钮登记 V4.3');
});

/* ============================================================
   V6-5 N-5 无和弦音曲目的弱提示
   ============================================================ */
test('V6-5 单音谱面在按钮原位给弱提示，有和弦音的曲目仍渲染按钮', async () => {
  const play = (await imp('assets/js/gp/play.js')).default;

  /* gp-song-001：全单音 → 无「和弦提示音」按钮、有弱提示文本 */
  const r1 = new El('div');
  const c1 = await play({ el: r1, params: ['gp-song-001'], navigate: () => {} });
  const ctrl1 = r1.children[0].querySelector('.play-controls');
  const labels1 = ctrl1.querySelectorAll('.btn').map(nodeText);
  assert.ok(!labels1.includes('play.chordHint'), `单音谱面不应渲染提示音按钮：${labels1.join('/')}`);
  const texts1 = ctrl1.children.map(nodeText);
  assert.ok(texts1.some((t) => t === 'play.noChordHint'),
    `单音谱面应在原位给出 play.noChordHint 弱提示：${texts1.join('/')}`);

  /* gp-song-002：有和弦音 → 有按钮、无弱提示 */
  const r2 = new El('div');
  const c2 = await play({ el: r2, params: ['gp-song-002'], navigate: () => {} });
  const ctrl2 = r2.children[0].querySelector('.play-controls');
  const labels2 = ctrl2.querySelectorAll('.btn').map(nodeText);
  assert.ok(labels2.includes('play.chordHint'), `有和弦音的曲目应渲染提示音按钮：${labels2.join('/')}`);
  const texts2 = ctrl2.children.map(nodeText);
  assert.ok(!texts2.includes('play.noChordHint'), '有和弦音的曲目不应显示弱提示');
  /* 控制栏按钮数仍为 7：返回按钮在 .play-controls 之外（R-03d 语义不变） */
  assert.strictEqual(labels2.length, 7, `控制栏按钮应仍为 7 个，实际 ${labels2.length}`);

  c1(); c2();
});

/* ============================================================
   V6-6 N-6 旧 noteSounds 迁移语义（只断言，不改产品代码）
   ============================================================ */
/**
 * 注入假 gsStore：state.js 的 readPrefs/writePrefs 会优先使用它，
 * 从而在没有 localStorage 语义的单测里精确观测「写了什么」。
 * 返回 { writes, prefs } —— writes 是每次 write 的 patch 快照。
 */
function installFakeStore(seedGp) {
  const prefs = seedGp === null ? {} : { gp: { ...seedGp } };
  const writes = [];
  globalThis.gsStore = {
    read: () => prefs,
    write: (patch) => {
      writes.push(JSON.parse(JSON.stringify(patch)));
      Object.keys(patch).forEach((k) => { prefs[k] = { ...(prefs[k] || {}), ...patch[k] }; });
      return prefs;
    },
  };
  return { writes, prefs };
}
function uninstallFakeStore() {
  delete globalThis.gsStore;
}

test('V6-6a 老用户（noteSounds:false）：迁移链保留关闭态、挂载全程零回写', async () => {
  const play = (await imp('assets/js/gp/play.js')).default;

  const fake = installFakeStore({ noteSounds: false });
  try {
    const s = Store.settings();
    assert.strictEqual(s.noteSounds, false, '老用户的旧键原值必须保留（不得被翻转）');
    assert.strictEqual(s.chordHint, undefined, 'chordHint 不得凭空出现在 settings 里（迁移链才能生效）');

    const root = new El('div');
    const cleanup = await play({ el: root, params: ['gp-song-002'], navigate: () => {} });
    assert.strictEqual(fake.writes.length, 0,
      `挂载阶段不得回写任何设置（老用户数据不得被覆盖），实际写了 ${fake.writes.length} 次：${JSON.stringify(fake.writes)}`);

    const ctrl = root.children[0].querySelector('.play-controls');
    const chordBtn = ctrl.querySelectorAll('.btn').filter((b) => nodeText(b) === 'play.chordHint')[0];
    assert.ok(chordBtn, 'gp-song-002 应渲染和弦提示音按钮');
    assert.ok(!chordBtn.classList.contains('primary'),
      '老用户的关闭态必须被迁移链保留（按钮不应带 primary）');
    cleanup();
  } finally {
    uninstallFakeStore();
  }
});

test('V6-6b 切换后只写 chordHint，旧 noteSounds 原值不动', async () => {
  const play = (await imp('assets/js/gp/play.js')).default;

  const fake = installFakeStore({ noteSounds: false });
  try {
    const root = new El('div');
    const cleanup = await play({ el: root, params: ['gp-song-002'], navigate: () => {} });
    const ctrl = root.children[0].querySelector('.play-controls');
    const chordBtn = ctrl.querySelectorAll('.btn').filter((b) => nodeText(b) === 'play.chordHint')[0];
    chordBtn.click();                                   // 关闭态 → 开启
    assert.strictEqual(fake.writes.length, 1, `切换应只写一次，实际 ${fake.writes.length}`);
    assert.strictEqual(fake.prefs.gp.noteSounds, false,
      '切换后旧键原值必须原样保留（不翻转、不删除）');
    assert.strictEqual(fake.prefs.gp.chordHint, true, '切换后新键 chordHint 应为 true');
    cleanup();
    /* 源码层面：不得存在任何独立的 noteSounds 写入点 */
    assert.ok(!/setSetting\(\s*["']noteSounds["']/.test(PLAY_SRC),
      'play.js 不得出现 setSetting("noteSounds") —— 旧键只读不写');
    assert.ok(!/setSetting\(\s*["']noteSounds["']/.test(STATE_SRC),
      'state.js 不得出现 setSetting("noteSounds")');
  } finally {
    uninstallFakeStore();
  }
});

test('V6-6c GP_DEFAULTS 设计约束：含 noteSounds 且不含 chordHint（否则迁移链即死代码）', async () => {
  const block = /const GP_DEFAULTS = \{([\s\S]*?)\n\};/.exec(STATE_SRC);
  assert.ok(block, '应能定位 state.js 的 GP_DEFAULTS');
  /* 注释里也提到 chordHint（含未加冒号的迁移链示例），断言前先剥离注释 */
  const body = block[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(body, /noteSounds:\s*true/, 'noteSounds 必须留在默认值里（老用户升级后开关状态不丢）');
  assert.ok(!/chordHint\s*:/.test(body),
    'chordHint 不得写进 GP_DEFAULTS —— 一旦给默认值，迁移链 s.chordHint ?? s.noteSounds ?? true 永远走不到 noteSounds');
  assert.match(PLAY_SRC, /s\.chordHint \?\? s\.noteSounds \?\? true/, 'play.js 应保留迁移链');

  /* W-2 如实登记：全新用户（无 gp 段）首次 setSetting 会把整个 GP_DEFAULTS
     （含 noteSounds:true）落盘，产生孤儿键。主理人拍板：登记 V4.3 根治
     （方向是 setSetting 落盘前剔除仅作迁移来源的键），本轮不改 Store.setSetting，
     因此这里只把它「观测下来」，不写反断言让它假绿。
     用带查询串的 URL 重新 import state.js → 拿到**未被前面用例污染**的 mem
     （mem.gp 以 GP_DEFAULTS 初始化），才是真正的「全新用户」语义。 */
  const fresh = installFakeStore(null);
  /* state.js 的 mem 是模块级单例且被前面用例写过 mem.gp，必须换一个实例才是「全新用户」 */
  const freshStore = (await impFresh('assets/js/gp/state.js')).Store;
  try {
    freshStore.setSetting('chordHint', true);
    assert.strictEqual(fresh.prefs.gp.chordHint, true, '新键应被写入');
    assert.strictEqual(fresh.prefs.gp.noteSounds, true,
      'W-2 已知残留（V4.3）：全新用户首次写入会带出孤儿键 noteSounds:true');
    /* 与正确的老用户语义的界线：这条路径**不会**翻转已有值（老用户不受影响，见 V6-6a/b） */
  } finally {
    uninstallFakeStore();
  }
});
