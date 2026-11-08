/* ============================================================
   六弦工坊 V4.3 · R2 静态挂载完整性与死词条看门
   ------------------------------------------------------------
   MOUNT-1  app.html 所有 data-i18n / data-i18n-ph / data-i18n-aria /
            data-i18n-title 引用的键必须存在于 zh-CN 词典（挂错键 = 运行时显示键名）
   MOUNT-2  R2 要求的 chrome/首页/各视图关键挂载点必须存在
            （防后续编辑把挂载属性弄丢）
   MOUNT-3  死词条零新增：词典中既未被 app.html 挂载、也未被 JS 取词的键
            必须 ⊆ PENDING_DELETE 观察清单（文档 §4.3 清理策略：
            待删清单观察一个版本，确认零引用后才物理删除）
   MOUNT-4  带占位符词条四语占位符集合完全一致（GP-I18N-3 的全键推广）
   ============================================================ */
'use strict';
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const { DICT: ZH } = await import(pathToFileURL(path.join(ROOT, 'assets/js/i18n/zh-CN.js')).href);
const { DICT: EN } = await import(pathToFileURL(path.join(ROOT, 'assets/js/i18n/en.js')).href);
const { DICT: JA } = await import(pathToFileURL(path.join(ROOT, 'assets/js/i18n/ja.js')).href);
const { DICT: KO } = await import(pathToFileURL(path.join(ROOT, 'assets/js/i18n/ko.js')).href);

const html = read('app.html');
const mounted = [
  ...[...html.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]),
  ...[...html.matchAll(/data-i18n-ph="([^"]+)"/g)].map((m) => m[1]),
  ...[...html.matchAll(/data-i18n-aria="([^"]+)"/g)].map((m) => m[1]),
  ...[...html.matchAll(/data-i18n-title="([^"]+)"/g)].map((m) => m[1]),
];

test('MOUNT-1 app.html 挂载引用的键全部存在于 zh-CN 词典', () => {
  const missing = [...new Set(mounted)].filter((k) => !(k in ZH));
  assert.deepStrictEqual(missing, [], `挂载了不存在的键：${missing.join(', ')}`);
});

test('MOUNT-2 R2 关键挂载点存在（chrome/首页/视图标题底栏）', () => {
  const required = [
    'brand.name', 'privacy.note', 'sheet.more',
    'home.hero.title1', 'home.hero.title2', 'home.hero.title3', 'home.hero.sub',
    'home.badge.mic', 'home.badge.metro', 'home.badge.local',
    'home.cta.tune', 'home.cta.game', 'home.tag.mic', 'home.tag.songs',
    'tool.tuner', 'tool.metro', 'tool.rhythm', 'tool.game', 'tool.scale',
    'tool.chords', 'tool.ear', 'tool.fret', 'tool.studio', 'tool.songbook',
    'tab.home', 'tab.tuner', 'tab.metro', 'tab.game', 'tab.more',
    'tuner.sub', 'tuner.mode.guitar', 'tuner.start', 'tuner.micNote', 'tuner.a4',
    'metro.sub', 'metro.tap', 'metro.timeSig', 'metro.voice.click', 'metro.soundTest',
    'flow.title', 'flow.pick', 'plan.title', 'plan.step1', 'stats.title', 'stats.chart',
  ];
  const set = new Set(mounted);
  const missing = required.filter((k) => !set.has(k));
  assert.deepStrictEqual(missing, [], `缺失挂载点：${missing.join(', ')}`);
});

/* 死词条观察清单（V4.3 建档）：键存在但当前无任何引用。
   原则：只减不增；M2 模块取词改造会逐步激活，确认零引用后再物理删除。 */
const PENDING_DELETE = [
  'home.hero.title',          // R2：hero 拆为 title1/2/3 三段（保留 <em> 高亮），本键待删
];

test('MOUNT-3 死词条零新增（未挂载且未取词的键 ⊆ 观察清单）', () => {
  /* JS 侧取词引用：t('key') / T("key") / TF(`key`) 及字面量 'key' 出现即视为引用
     （stats.js 等经 tf('stats.xxx') 间接引用，直接扫字面量最稳） */
  const jsFiles = [];
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) walk(p);
      else if (f.name.endsWith('.js')) jsFiles.push(p);
    }
  };
  walk(path.join(ROOT, 'assets/js'));
  const jsAll = jsFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  const dead = Object.keys(ZH).filter((k) => !mounted.includes(k) && !jsAll.includes(`'${k}'`) && !jsAll.includes(`"${k}"`));
  const unexpected = dead.filter((k) => !PENDING_DELETE.includes(k));
  assert.deepStrictEqual(unexpected, [],
    `出现新的死词条（应加入词条引用或登记 PENDING_DELETE）：${unexpected.join(', ')}`);
});

test('MOUNT-4 带占位符词条的四语占位符集合完全一致', () => {
  const slots = (s) => (String(s).match(/\{[a-zA-Z]+\}/g) || []).sort();
  const dicts = { 'zh-CN': ZH, en: EN, ja: JA, ko: KO };
  const bad = [];
  for (const k of Object.keys(ZH)) {
    const base = slots(ZH[k]);
    if (!base.length) continue;
    for (const lang of ['en', 'ja', 'ko']) {
      if (JSON.stringify(slots(dicts[lang][k])) !== JSON.stringify(base)) {
        bad.push(`${lang}.${k}: ${slots(dicts[lang][k])} != ${base}`);
      }
    }
  }
  assert.deepStrictEqual(bad, [], `占位符跨语言不一致：\n${bad.join('\n')}`);
});
