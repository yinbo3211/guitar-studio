/* ============================================================
   六弦工坊 V4.2.1 · 缺陷复验回归（BUG-16 补强）
   ------------------------------------------------------------
   与既有测试的分工（不重复造轮子）：
   · 四语字典键集合一致 / 占位符一致 → test/i18n-keys.test.js、gp-i18n.test.js
   · play.js / song-play.js / components.js 英文硬编码扫描 → gp-i18n.test.js
   · chartKind / hasRealChart / omrQuality 门禁 → gp-catalog-chartkind.test.js
   · 成绩写读闭环行为级（module=songbook 打卡点亮）→ songbook-playback-integration.test.js

   本文件只锁「尚无覆盖」的跨模块契约：
   REG-01 宿主壳必须监听 gs:lang 并重建演奏视图（BUG-04 防回退）
   REG-02 演奏写入端 module 与统计读取端 module 源码级口径一致（BUG-07 防回退）
   REG-03 UI 降级提示闭环：无真实谱 ⇒ chartKind=generated-chords，
          且曲库/演奏两侧提示键在四语字典齐全（BUG-01/02 显式降级防回退）
   REG-04 BUG-06 TIER_META/SOURCE_META 中文直取 —— V4.2.2 已修复（i18n 优先）
   REG-05 BUG-11 歌词越界 8 首 —— V4.2.2 已修复（songDuration 统一口径）
   REG-06 BUG-13 结算金币恒 0 —— V4.2.2 已修复（entry 补 coins）
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

await imp('test/_gp-dom.mjs');

const LANGS = ['zh-CN', 'en', 'ja', 'ko'];
const dictOf = async (lang) => (await imp(`assets/js/i18n/${lang}.js`)).DICT;

/* ============================================================
   REG-01 宿主壳监听 gs:lang 并重建演奏视图（BUG-04）
   ============================================================ */
test('REG-01 song-play.js 监听 gs:lang 且触发重建（SongPlay.enter）', () => {
  const src = read('assets/js/modules/song-play.js');
  assert.ok(/addEventListener\(\s*['"]gs:lang['"]/.test(src),
    'song-play.js 未监听 gs:lang，切语言后演奏视图不会刷新');
  const handler = src.slice(src.indexOf("gs:lang"));
  assert.ok(/SongPlay\.enter\(\)/.test(handler),
    'gs:lang 处理器未调用 SongPlay.enter() 重建视图');
});

/* ============================================================
   REG-02 写入端 / 读取端 module 口径一致（BUG-07）
   ============================================================ */
test('REG-02 演奏写入 module 必须被统计读取端覆盖（防 songplay 记录漏统计）', () => {
  const stateSrc = read('assets/js/gp/state.js');
  const statsSrc = read('assets/js/modules/stats.js');
  const writeModule = (stateSrc.match(/module:\s*'(\w+)'/) || [])[1];
  assert.ok(writeModule, 'gp/state.js addHistory 未写 module 字段');
  const readModules = new Set([...statsSrc.matchAll(/module:\s*'(\w+)'/g)].map(m => m[1]));
  assert.ok(readModules.has(writeModule) || readModules.has('songplay'),
    `统计读取端 [${[...readModules]}] 不覆盖写入端 '${writeModule}'，演奏成绩会被漏统计`);
});

/* ============================================================
   REG-03 UI 降级提示闭环（BUG-01/02 显式降级）
   ============================================================ */
test('REG-03a 无真实谱曲目必须 hasRealChart()===false 且 chartKind=generated-chords', async () => {
  const { GP_CHORD_SONGS } = await imp('assets/js/gp/songs.js');
  const { GP_OMR_NOTES } = await imp('assets/js/gp/omr-notes.js');
  const { findSong, hasRealChart } = await imp('assets/js/gp/catalog.js');
  let placeholder = 0;
  for (const d of GP_CHORD_SONGS) {
    if (GP_OMR_NOTES[d.id] && hasRealChart(d.id)) continue;   // 过门禁的真实谱
    assert.strictEqual(hasRealChart(d.id), false, `${d.id} 无真实谱但 hasRealChart 未判 false`);
    assert.strictEqual(findSong(d.id).chartKind, 'generated-chords',
      `${d.id} 无真实谱但 chartKind 不是 generated-chords（静默伪装风险）`);
    placeholder++;
  }
  assert.ok(placeholder > 0, '样本为空，断言无效');
});

test('REG-03b 占位提示文案 i18n 键四语齐全且非空', async () => {
  const KEYS = [
    'play.badge.generated',      // 演奏页「简易伴奏」徽章
    'play.badge.incomplete',     // OMR 识谱不完整追加提示
    'play.singalongNotice',      // 跟唱模式说明
    'play.sheetLink',            // 原版吉他谱外链文案
    'songbook.simpleAcc',        // 曲库曲卡「简易伴奏」角标
    'songbook.simpleAccTip',     // 角标悬停解释
  ];
  for (const lang of LANGS) {
    const dict = await dictOf(lang);
    for (const k of KEYS) {
      assert.ok(typeof dict[k] === 'string' && dict[k].trim(),
        `${lang} 缺少降级提示键 ${k}（占位曲将无可见提示）`);
    }
  }
});

test('REG-03c 曲库与演奏视图源码必须引用占位提示键（UI 确实渲染）', () => {
  assert.ok(/hasRealChart\(s\.id\)[\s\S]{0,200}songbook\.simpleAcc/.test(read('assets/js/modules/songbook.js')),
    'songbook.js 曲卡未按 hasRealChart 渲染 simpleAcc 角标');
  const play = read('assets/js/gp/play.js');
  for (const k of ['play.badge.generated', 'play.singalongNotice']) {
    assert.ok(play.includes(k), `play.js 未引用 ${k}，演奏页无降级提示`);
  }
});

/* ============================================================
   REG-04/05/06 V4.2.2 已修复，skip 移除并启用（BUG-06/11/13 防回退）
   ============================================================ */
/* ============================================================
   REG-04/05/06 V4.2.2 已修复并启用（BUG-06/11/13）
   ============================================================ */
test('REG-04 BUG-06 难度名/谱源名不得直取 TIER_META/SOURCE_META 中文 name', () => {
  const sb = read('assets/js/modules/songbook.js');
  assert.ok(!/TIER_META\[\w+\]\s*&&\s*TIER_META\[\w+\]\.name/.test(sb), '难度名仍直取中文 TIER_META.name');
  assert.ok(!/esc\(src\.name\)/.test(sb), '谱源名仍直取中文 SOURCE_META.name');
  /* i18n 键必须真实存在（四语），否则 i18n 优先会退化显示 key */
  return Promise.all(LANGS.map(async (lang) => {
    const dict = await dictOf(lang);
    for (const k of ['songbook.tier.1', 'songbook.tier.2', 'songbook.tier.3',
      'songbook.source.qq_sheet', 'songbook.source.qq_chord', 'songbook.source.jitashe']) {
      assert.ok(typeof dict[k] === 'string' && dict[k].trim(), `${lang} 缺少 ${k}`);
    }
  }));
});

test('REG-05 BUG-11 统一 songDuration 口径后歌词不被截断（max(谱面末音, 歌词末行)）', async () => {
  const { GP_CHORD_SONGS } = await imp('assets/js/gp/songs.js');
  const { findSong } = await imp('assets/js/gp/catalog.js');
  const { songDuration } = await imp('assets/js/gp/song-format.js');
  for (const d of GP_CHORD_SONGS) {
    const song = findSong(d.id);
    if (!song.notes.length || !d.lyrics?.length) continue;
    const lyrEnd = Math.max(...d.lyrics.map(l => (l.time || 0) + (l.dur || 0)));
    assert.ok(lyrEnd <= songDuration(song) + 0.01,
      `${d.id} ${d.title} 统一口径时长 ${songDuration(song).toFixed(1)}s 仍短于歌词末 ${lyrEnd.toFixed(1)}s`);
  }
  /* 演奏视图确实按统一口径取时长（含歌词），而非仅谱面音符 */
  const play = read('assets/js/gp/play.js');
  assert.ok(/songDuration\(\{\s*notes:\s*lead\.notes,\s*lyrics:\s*song\.lyrics\s*\}\)/.test(play),
    'play.js 未按统一口径（notes+lyrics）计算时长');
});

test('REG-06 BUG-13 演奏结算 entry 必须含 coins 字段（Locker 入口依赖）', () => {
  const play = read('assets/js/gp/play.js');
  const entryBlock = play.slice(play.indexOf('const entry = {'), play.indexOf('Store.addHistory'));
  assert.ok(/coins\s*:/.test(entryBlock), 'entry 缺少 coins 字段，结算金币恒为 0');
});
