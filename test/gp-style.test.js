/* ============================================================
   六弦工坊 V4.1 · 演奏视图「样式契约」回归测试
   ------------------------------------------------------------
   起因（真实缺陷）：GuitarPicker 的 CSS 被收敛到 .gp-scope 后，
   演奏根容器忘了加这个类 → 全部样式不生效，界面与原站完全不同。
   这类问题跑 JS 单测抓不到，所以这里用「源码 + 样式双向契约」把它钉死：

     S-1 宿主壳必须给演奏根容器设置 class="gp-scope"（行为级）
     S-2 gp.css 必须为演奏视图的每个关键 class 提供 .gp-scope 规则
     S-3 play.js 用到的 class 在 gp.css 中都有对应的作用域规则（防漏）
     S-4 gp.css 不得泄漏裸全局选择器 / :root（否则污染宿主主题）
     S-5 画布祖先必须有确定高度（否则 canvas 高度为 0，highway 全黑）
     S-6 变量只在 .gp-scope 上定义，且与 GuitarPicker midnight 主题一致
     S-7 演奏视图挂载后，根容器确实带 gp-scope（无头 DOM 行为验证）
   ============================================================ */
'use strict';
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const CSS = read('assets/css/gp.css');
const PLAY = read('assets/js/gp/play.js');
const SHELL = read('assets/js/modules/song-play.js');
const COMPONENTS = read('assets/css/components.css');

/* play.js / song-play.js 里真正用于版式的 class（宿主不提供，必须来自 gp.css） */
const KEY_CLASSES = [
  'play-shell', 'play-stage', 'play-overlay', 'play-hud', 'play-controls',
  'play-avatar', 'play-bottom-fade', 'hud-box', 'healthbar-big',
  'killfeed', 'kill', 'lyric-line', 'banner', 'capo-note', 'big-grade',
];

/* ============================================================
   S-1 宿主壳设置 gp-scope（这是本次缺陷的直接成因）
   ============================================================ */
test('S-1 宿主壳必须给演奏根容器设置 class="gp-scope"', () => {
  assert.ok(/root\.className\s*=\s*['"]gp-scope['"]/.test(SHELL),
    'song-play.js 必须写 root.className = "gp-scope"，否则 GuitarPicker 样式全部不生效');
});

test('S-1 兜底页与错误页同样带 gp-scope', () => {
  const boxes = SHELL.match(/box\.className\s*=\s*['"]([^'"]+)['"]/g) || [];
  assert.ok(boxes.length >= 2, 'not-found / error 兜底页也要带作用域类');
  assert.ok(boxes.every((b) => /gp-scope/.test(b)), `兜底页缺少 gp-scope：${boxes.join(', ')}`);
});

/* ============================================================
   S-2 / S-3 样式契约
   ============================================================ */
test('S-2 gp.css 为演奏视图每个关键 class 提供 .gp-scope 规则', () => {
  for (const cls of KEY_CLASSES) {
    assert.ok(CSS.includes(`.gp-scope .${cls}`), `gp.css 缺少 .gp-scope .${cls}`);
  }
});

test('S-3 play.js 使用的 class 在 gp.css 中都有作用域规则（防漏样式）', () => {
  const used = new Set();
  for (const m of PLAY.matchAll(/el\(\s*["'`]([^"'`]+)["'`]/g)) {
    for (const c of m[1].match(/\.([a-zA-Z][\w-]*)/g) || []) used.add(c.slice(1));
  }
  for (const m of PLAY.matchAll(/classList\.(?:add|toggle)\(\s*["'`]([^"'`]+)["'`]/g)) used.add(m[1]);
  const EXEMPT = new Set(['hidden', 'primary', 'on']);     // 通用态，宿主或行内已有
  // 规则可能是 `.gp-scope .btn.ghost` / `.gp-scope .stat .num` 这类复合选择器，
  // 因此按「.gp-scope 之后出现过 .<class>」判定，而不是简单字符串包含。
  const hasScoped = (cls) => new RegExp(`\\.gp-scope[^{]*\\.${cls}\\b`).test(CSS);
  const missing = [...used].filter((c) => !EXEMPT.has(c) && !hasScoped(c));
  assert.deepStrictEqual(missing, [], `这些 class 在 gp.css 中没有作用域规则：${missing.join(', ')}`);
});

test('S-3 canvas 与歌词/判定样式必须存在（highway 的主视觉）', () => {
  assert.ok(/\.gp-scope #highway-canvas/.test(CSS), '画布尺寸规则');
  assert.ok(/\.gp-scope \.lyric-line/.test(CSS), '歌词行');
  assert.ok(/\.gp-scope \.kill\.perfect/.test(CSS), '判定配色');
  assert.ok(/--j-perfect\s*:/.test(CSS), '判定色变量');
});

/* ============================================================
   S-4 不污染宿主
   ============================================================ */
test('S-4 gp.css 不得泄漏裸全局选择器或 :root', () => {
  const bare = CSS.split('\n').filter((l) => /^\s*(?::root|html|body|html,\s*body)\s*(?:,|\{)/.test(l));
  assert.deepStrictEqual(bare, [], `裸全局选择器会覆盖宿主主题：${bare.join(' | ')}`);
  const unscoped = CSS.split('\n')
    .filter((l) => /^\.[a-z][\w-]*\s*\{/.test(l))
    .filter((l) => !/^\.gp-scope\s*\{/.test(l));   // 作用域自身的变量块不算泄漏
  assert.deepStrictEqual(unscoped, [], `未加作用域的类选择器：${unscoped.join(' | ')}`);
});

test('S-4 主题变量只定义在 .gp-scope 上', () => {
  const rootVarBlocks = CSS.match(/:root\s*\{/g) || [];
  assert.strictEqual(rootVarBlocks.length, 0, '不应存在 :root 变量块');
  const scopeBlocks = CSS.match(/\.gp-scope\s*\{/g) || [];
  assert.ok(scopeBlocks.length >= 1, '应有 .gp-scope 变量块');
});

test('S-6 midnight 主题关键色值与 GuitarPicker 默认一致', () => {
  const block = /\.gp-scope\s*\{([\s\S]*?)\}/.exec(CSS);
  assert.ok(block, '应存在作用域变量块');
  const vars = block[1];
  assert.ok(/--bg:\s*#0b0f1a/.test(vars), '背景色应为 midnight #0b0f1a');
  assert.ok(/--accent:\s*#6ea8fe/.test(vars), '强调色应为 #6ea8fe');
  assert.ok(/--highway:\s*#0a0e18/.test(vars), 'highway 底色应为 #0a0e18');
  assert.ok(/--j-perfect:\s*#21d07a/.test(vars), 'Perfect 判定色');
});

/* ============================================================
   S-5 画布高度
   ============================================================ */
test('S-5 演奏根容器有确定高度（否则 canvas 高度为 0）', () => {
  assert.ok(/#gpPlayRoot\s*\{[^}]*height:/.test(COMPONENTS),
    'components.css 必须给 #gpPlayRoot 一个确定高度');
  assert.ok(/min-height:/.test(/#gpPlayRoot\s*\{[^}]*\}/.exec(COMPONENTS)[0]), '应带 min-height 兜底');
});

/* ============================================================
   S-8 画布不得被 ResizeObserver 清空后无人重绘（真实缺陷）
   ============================================================ */
test('S-8 resize 后必须补绘，否则进入页面看到全黑 highway', () => {
  assert.ok(/let painted = false;/.test(PLAY), '需要 painted 标志（避开 playing/clock 的 TDZ）');
  assert.ok(/if \(painted\) render\(clock\);/.test(PLAY), 'resize() 后要补一次静态重绘');
  assert.ok(/painted = true;/.test(PLAY), '首次 render 之后置位 painted');
});

test('S-8 旧的分步练习页已转发到演奏视图（避免只看到外链）', () => {
  const old = read('assets/js/modules/song-practice.js');
  assert.ok(/SongPlay\.prepare\(id\)/.test(old), '旧页应转发到 SongPlay');
  assert.ok(/goRoute\('songPlay'\)/.test(old), '转发目标路由为 songPlay');
});

/* ============================================================
   S-7 行为验证：挂载后根容器确实带 gp-scope
   ============================================================ */
test('S-7 宿主壳挂载演奏视图后根容器带 gp-scope（无头 DOM）', async () => {
  await imp('test/_gp-dom.mjs');
  const { El } = await imp('test/_gp-dom.mjs');
  const { SongPlay } = await imp('assets/js/modules/song-play.js');

  const root = new El('div');
  root.id = 'gpPlayRoot';
  // 把根容器挂进 document（宿主壳通过 getElementById 取）
  const doc = globalThis.document;
  const origGet = doc.getElementById;
  doc.getElementById = (id) => (id === 'gpPlayRoot' ? root : origGet.call(doc, id));

  SongPlay.prepare('gp-song-001');
  SongPlay.enter();
  // play() 是异步的，等一拍
  await new Promise((r) => setTimeout(r, 30));

  assert.strictEqual(root.className, 'gp-scope', '根容器必须带 gp-scope');
  assert.ok(root.children.length > 0, '应渲染出演奏视图');
  assert.ok(root.children[0].className.includes('play-shell'), '首节点应为 play-shell');

  SongPlay.leave();
  doc.getElementById = origGet;
});
