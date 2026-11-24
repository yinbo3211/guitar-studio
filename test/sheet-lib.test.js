/* ============================================================
   六弦工坊 V4.4 · test/sheet-lib.test.js
   ------------------------------------------------------------
   曲谱工坊列表（T09/F-13）纯逻辑：搜索命中、标签交集、三模式排序、
   曲卡 XSS 转义、相对时间四语、枚举、以及 F-14 曲库联动源码契约。
   权威口径：docs/V4.4_SHEET_STUDIO_SPEC.md §6 F-13/F-14 / §10.1。
   ============================================================ */
'use strict';
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const L = await import('../assets/js/modules/sheet-lib.js');

const NOW = 1700000000000;
const sheets = [
  { id: '1', title: '晴天', artist: '周杰伦', transcriber: '小明', language: '国语', style: '流行', arrange: '高还原', tags: ['动漫音乐'], key: 'C', timeSig: '4/4', capo: 0, tempo: 70, updatedAt: NOW - 3600e3, createdAt: NOW - 10 * 864e5 },
  { id: '2', title: '七里香', artist: '周杰伦', transcriber: '', language: '国语', style: '民谣', arrange: '简化', tags: ['考级'], key: 'G', timeSig: '3/4', capo: 2, tempo: 90, updatedAt: NOW - 2 * 864e5, createdAt: NOW - 5 * 864e5 },
  { id: '3', title: 'Yesterday', artist: 'The Beatles', transcriber: 'Ann', language: '英语', style: '摇滚', arrange: '改编', tags: [], key: 'F', timeSig: '4/4', capo: 0, tempo: 120, updatedAt: NOW - 30 * 864e5, createdAt: NOW - 30 * 864e5 },
];

test('LB-1 搜索命中曲名 / 歌手 / 制谱人 / 标签（大小写不敏感）', () => {
  assert.deepStrictEqual(L.filterSheets(sheets, { kw: '晴天' }).map((s) => s.id), ['1']);
  assert.deepStrictEqual(L.filterSheets(sheets, { kw: '周杰伦' }).map((s) => s.id), ['1', '2']);
  assert.deepStrictEqual(L.filterSheets(sheets, { kw: 'ANN' }).map((s) => s.id), ['3']);
  assert.deepStrictEqual(L.filterSheets(sheets, { kw: '考级' }).map((s) => s.id), ['2']);
  assert.deepStrictEqual(L.filterSheets(sheets, { kw: '  ' }).length, 3);
  assert.deepStrictEqual(L.filterSheets(null, {}), []);
});

test('LB-2 语言 / 风格 / 编配三标签取交集', () => {
  assert.deepStrictEqual(L.filterSheets(sheets, { filters: { lang: '国语' } }).map((s) => s.id), ['1', '2']);
  assert.deepStrictEqual(L.filterSheets(sheets, { filters: { lang: '国语', style: '民谣' } }).map((s) => s.id), ['2']);
  assert.deepStrictEqual(L.filterSheets(sheets, { filters: { lang: '国语', arrange: '改编' } }), []);
  assert.deepStrictEqual(L.filterSheets(sheets, { filters: { lang: '英语', style: '摇滚', arrange: '改编' } }).map((s) => s.id), ['3']);
  assert.strictEqual(L.filterSheets(sheets, { filters: {}, kw: 'Yesterday' }).length, 1);
});

test('LB-3 三模式排序，且不修改入参数组', () => {
  const input = sheets.slice();
  const before = input.map((s) => s.id).join(',');
  assert.deepStrictEqual(L.sortSheets(input, 'recent').map((s) => s.id), ['1', '2', '3']);
  assert.deepStrictEqual(L.sortSheets(input, 'created').map((s) => s.id), ['2', '1', '3']);
  const byTitle = L.sortSheets(input, 'title').map((s) => s.id);
  assert.ok(byTitle.length === 3 && byTitle.includes('1') && byTitle.includes('2') && byTitle.includes('3'));
  assert.strictEqual(input.map((s) => s.id).join(','), before, '排序不得原地修改入参');
  assert.deepStrictEqual(L.sortSheets(null, 'recent'), []);
});

test('LB-4 曲卡 HTML：用户输入全转义、自制徽章、摘要与动作按钮齐全', () => {
  const evil = { ...sheets[0], title: '<img src=x onerror=alert(1)>', artist: '"&<script>', tags: ['<b>x</b>'] };
  const html = L.sheetCardHtml(evil, { now: NOW });
  /* esc() 只转义 < > & " '，其余字符作为纯文本保留，不构成注入 */
  assert.ok(!/<img\b/i.test(html) && !/<script\b/i.test(html) && !/<b>/i.test(html), '用户内容不得进入 DOM');
  assert.ok(html.includes('&lt;img') && html.includes('&amp;'));
  assert.ok(html.includes('data-id="1"'));
  for (const act of ['play', 'edit', 'copy', 'export', 'delete']) {
    assert.ok(html.includes(`data-act="${act}"`), `缺少动作 ${act}`);
  }
  assert.ok(html.includes('♩=70'));
});

test('LB-5 relativeTime 四语与边界（Intl.RelativeTimeFormat，无词条依赖）', () => {
  const zh = L.relativeTime(NOW - 864e5, NOW, 'zh-CN');
  const en = L.relativeTime(NOW - 864e5, NOW, 'en');
  assert.ok(typeof zh === 'string' && zh.length > 0);
  assert.ok(typeof en === 'string' && en.length > 0);
  assert.notStrictEqual(zh, en, '中英相对时间文案应不同');
  assert.strictEqual(L.relativeTime(0, NOW), '', '无时间戳返回空串');
  assert.strictEqual(L.relativeTime(NOW, NOW, 'zh-CN').length > 0, true);
});

test('LB-6 enumItems 长度与存储值原文（Node 无宿主回退）', () => {
  assert.strictEqual(L.enumItems('lang').length, 10);
  assert.strictEqual(L.enumItems('style').length, 10);
  assert.strictEqual(L.enumItems('arrange').length, 5);
  assert.strictEqual(L.enumItems('lang')[0].value, '纯音乐');
  assert.deepStrictEqual(L.enumItems('nope'), []);
});

test('LB-7 列表源码契约：路由 / 事件委托 / 语言联动 / 弹唱 overlay / 导入导出', () => {
  const src = read('assets/js/modules/sheet-lib.js');
  assert.ok(/onRouteEnter\.sheetLib\s*=/.test(src), '必须注册 sheetLib 路由');
  assert.ok(src.includes("document.addEventListener('gs:lang'"), '必须监听语言切换');
  assert.ok(/addEventListener\('click'/.test(src) && /closest\('\[data-act\]'\)/.test(src), '必须事件委托');
  assert.ok(/SheetPlayer\.mountControls/.test(src), '必须挂载全屏试听控制条');
  assert.ok(/SheetStore\.importData/.test(src) && /exportAll/.test(src), '必须有导入导出');
  assert.ok(/clearDraft/.test(src), '删除须联动清理草稿');
});

test('LB-8 F-14 曲库联动：我的曲谱 tab / 独立数据源 / 不改动内置曲库', () => {
  const sb = read('assets/js/modules/songbook.js');
  assert.ok(sb.includes("songbook.tab.mine"), '难度 tab 行须追加「我的曲谱」');
  assert.ok(/function mySheets\(\)/.test(sb), '须有松耦合的自制谱数据源');
  assert.ok(/this\.tier === 'mine'/.test(sb), '须有 mine 分支');
  assert.ok(/data-action="sheetStart"/.test(sb) && /data-action="sheetEdit"/.test(sb), '曲卡须有弹唱/编辑入口');
  assert.ok(/UNITS\.filter/.test(sb), '内置 19 单元逻辑保持原样');
  const lib = read('assets/js/modules/sheet-lib.js');
  assert.ok(/get\('play'\)/.test(lib) && /openPlay\(playId\)/.test(lib), '?play= 参数由列表页解析并直达全屏试听');
  const fmt = read('assets/js/gp/song-format.js');
  assert.ok(fmt.includes("'user-chord'"), 'CHART_KINDS 须含 user-chord（自制谱不参与音准评分/OMR 统计）');
});
