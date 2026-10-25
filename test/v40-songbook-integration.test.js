/* ============================================================
   六弦工坊 V4.0 · 集成与交付约束测试（T1–T7 收尾）
   ------------------------------------------------------------
   覆盖「模块图 → 路由 → 页面骨架 → 离线缓存 → 版本 → 文档」全链路：
     V4-1 app.html 具备曲库/练习视图与入口（侧栏、首页卡片、统计挂载点）
     V4-2 router 注册新路由（标题、更多菜单排除练习页）
     V4-3 sw.js CORE 覆盖 main.js 全部静态 import（离线冷启动不白屏）
     V4-4 版本号 4.0.0 且 package.json / version.json 一致
     V4-5 统计分区挂载点存在且 stats.js 已实现渲染
     V4-6 数据层纯函数与曲库模块口径一致（231/706/19）
     V4-7 README 记录了 V4.0 交付内容
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

const HTML = read('app.html');
const MAIN = read('assets/js/main.js');
const SW = read('sw.js');
const ROUTER = read('assets/js/core/router.js');
const STATS = read('assets/js/modules/stats.js');

/* ============================================================
   V4-1 页面骨架
   ============================================================ */
test('V4-1 app.html 提供曲库与练习两个视图及必要挂载点', () => {
  assert.ok(/id="view-songbook"/.test(HTML), '曲库视图');
  assert.ok(/id="view-songPractice"/.test(HTML), '弹唱练习视图');
  assert.ok(/id="sbTop"/.test(HTML), '曲库顶部（进度环/tab/搜索）');
  assert.ok(/id="sbList"/.test(HTML), '曲库列表（事件委托容器）');
  assert.ok(/id="spWrap"/.test(HTML), '练习 HUD 容器');
});

test('V4-1 侧栏与首页均提供曲库入口，data-route 一致', () => {
  assert.ok(/data-route="songbook"/.test(HTML), '存在曲库路由入口');
  const navBlock = HTML.slice(HTML.indexOf('nav-group-label'), HTML.indexOf('data-route="plan"'));
  assert.ok(/data-route="songbook"/.test(navBlock), '侧栏「练习管理」分组内含曲库入口');
  assert.ok(/data-i18n="nav\.songbook"/.test(HTML), '侧栏文案走 i18n');
  const toolGrid = HTML.slice(HTML.indexOf('tool-grid'), HTML.indexOf('tool-grid') + 6000);
  assert.ok(/data-route="songbook"/.test(toolGrid), '首页工具卡片含曲库入口');
});

/* ============================================================
   V4-2 路由
   ============================================================ */
test('V4-2 router 注册 songbook / songPractice 两个路由', () => {
  assert.ok(/songbook\s*:\s*'弹唱曲库'/.test(ROUTER), 'ROUTE_TITLES 含曲库');
  assert.ok(/songPractice\s*:\s*'弹唱练习'/.test(ROUTER), 'ROUTE_TITLES 含弹唱练习');
  assert.ok(/onRouteEnter\.songbook/.test(read('assets/js/modules/songbook.js')));
  assert.ok(/onRouteEnter\.songPractice/.test(read('assets/js/modules/song-practice.js')));
});

test('V4-2 「更多」菜单收录曲库但排除练习页（练习页只能从曲卡进入）', () => {
  assert.ok(/MORE_EXCLUDE/.test(ROUTER), '存在排除清单');
  assert.ok(/MORE_EXCLUDE\s*=\s*\[\s*'songPractice'\s*(?:,\s*'songPlay'\s*)?\]/.test(ROUTER));
  assert.ok(/MORE_LABEL[\s\S]*songbook/.test(ROUTER), '更多菜单含曲库标签');
});

/* ============================================================
   V4-3 离线模块图覆盖（C3 / P1-5，硬约束）
   ============================================================ */
test('V4-3 sw.js CORE 覆盖 main.js 全部静态 import', () => {
  const toRoot = (spec) => path.normalize(path.join('assets/js', spec));
  const imports = new Set();
  for (const m of MAIN.matchAll(/^\s*import\s+['"](\.\/[^'"]+\.js)['"]/gm)) imports.add(toRoot(m[1]));
  for (const m of MAIN.matchAll(/^\s*import\s[^;()]*?from\s+['"](\.\/[^'"]+\.js)['"]/gm)) imports.add(toRoot(m[1]));

  const coreBlock = /const\s+CORE\s*=\s*\[([\s\S]*?)\];/.exec(SW);
  assert.ok(coreBlock, 'sw.js 必须定义 CORE 清单');
  const core = new Set([...coreBlock[1].matchAll(/['"](\.\/[^'"]+)['"]/g)].map((m) => path.normalize(m[1])));
  const missing = [...imports].filter((u) => !core.has(u));
  assert.deepStrictEqual(missing, [], `离线冷启动会白屏，缺失：${missing.join(', ')}`);
  for (const f of ['assets/js/data/songlist-data.js', 'assets/js/modules/songbook.js', 'assets/js/modules/song-practice.js']) {
    assert.ok(core.has(path.normalize('./' + f)), `CORE 应包含 ${f}`);
  }
});

test('V4-3 main.js 已静态引入三个新模块（否则不会注册 onRouteEnter）', () => {
  assert.ok(/import\s+'\.\/data\/songlist-data\.js'/.test(MAIN));
  assert.ok(/import\s+'\.\/modules\/songbook\.js'/.test(MAIN));
  assert.ok(/import\s+'\.\/modules\/song-practice\.js'/.test(MAIN));
});

/* ============================================================
   V4-4 版本
   ============================================================ */
test('V4-4 package.json 与 version.json 版本号一致且不低于 4.0.0', () => {
  const pkg = JSON.parse(read('package.json'));
  const ver = JSON.parse(read('version.json'));
  assert.strictEqual(pkg.version, ver.version, '两处版本号必须一致（SW 缓存名取自 version.json）');
  const cmp = (v) => v.split('.').map(Number);
  const [a, b] = [cmp(pkg.version), cmp('4.0.0')];
  assert.ok(a[0] > b[0] || (a[0] === b[0] && a[1] >= b[1]), `版本应 >= 4.0.0，实际 ${pkg.version}`);
});

/* ============================================================
   V4-5 统计分区
   ============================================================ */
test('V4-5 统计中心存在曲库分区挂载点且 stats.js 已实现渲染', () => {
  assert.ok(/id="statSongbookBox"/.test(HTML));
  assert.ok(/renderSongbook\(\)/.test(STATS), 'stats.js 实现曲库分区渲染');
  assert.ok(/this\.renderSongbook\(\)/.test(STATS), 'render() 中调用');
  assert.ok(/songbookStats\(/.test(STATS), '复用曲库模块纯统计函数');
  assert.ok(/songbook:[^,]*nav\.songbook/.test(STATS) || /songbook:T\('nav\.songbook'/.test(STATS),
    '模块对比表把 songbook 纳入（且走 i18n）');
});

/* ============================================================
   V4-6 数据口径
   ============================================================ */
test('V4-6 数据层口径：231 首 / 706 条谱 / 19 单元，且自检通过', async () => {
  const D = await imp('assets/js/data/songlist-data.js');
  assert.strictEqual(D.SONGS.length, 231);
  assert.strictEqual(D.UNITS.length, 19);
  const sheets = D.SONGS.reduce((n, s) => n + (s.sheets ? s.sheets.length : 0), 0);
  assert.strictEqual(sheets, 706);
  assert.deepStrictEqual(D.validate(), []);
  const tier = { 1: 0, 2: 0, 3: 0 };
  for (const s of D.SONGS) tier[s.tier] += 1;
  assert.deepStrictEqual(tier, { 1: 159, 2: 61, 3: 11 });
});

test('V4-6 曲谱外链全部 https 且无空白字符', async () => {
  const D = await imp('assets/js/data/songlist-data.js');
  let n = 0;
  for (const s of D.SONGS) {
    for (const sh of s.sheets || []) {
      assert.ok(/^https:\/\/\S+$/.test(sh.url), `非法链接 ${s.id} ${sh.url}`);
      n += 1;
    }
  }
  assert.strictEqual(n, 706);
});

/* ============================================================
   V4-7 文档
   ============================================================ */
test('V4-7 README 记录 V4.0 交付内容', () => {
  const md = read('README.md');
  assert.ok(/## V4\.0/.test(md), 'README 应有 V4.0 章节');
  assert.ok(/231/.test(md) && /706/.test(md), 'README 应写明曲目与谱数');
  assert.ok(/songlist-data\.js/.test(md));
});

/* ============================================================
   V4-8 曲谱数据不得内联第三方内容（只存外链）
   ============================================================ */
test('V4-8 数据层只保存外链，不内联第三方曲谱正文/图片', () => {
  const src = read('assets/js/data/songlist-data.js');
  assert.ok(!/data:image\//.test(src), '不得内联 base64 图片');
  assert.ok(!/<iframe/.test(src), '不得内联 iframe');
  const perSong = src.length / 231;
  assert.ok(perSong < 2000, `单曲平均体积应远小于 2KB（实际 ${Math.round(perSong)}B），说明未内联谱面`);
});
