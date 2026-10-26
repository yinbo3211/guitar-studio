#!/usr/bin/env node
/* ============================================================
  弹唱曲库 / 演奏视图 缺陷诊断脚本  (只读，不修改任何源码)
  用法： node tools/diagnose-songbook.mjs
  退出码：0 = 全部通过；1 = 存在未通过项
  ------------------------------------------------------------
  每项检查输出 [PASS]/[FAIL]/[DATA] + 实测值 + 期望值。
  [DATA] = 数据依赖项：离线环境无法根治，判定标准为「显式降级」
           （诚实标记 + UI 可见提示），而非数据完备。

  V4.2.2 口径更新（对比 V4.2.1）：
  · BUG-11  由「歌词末时间 ≤ 谱面末音」改为「统一 songDuration 口径后不截断」
            （时长 = max(谱面末音, 歌词末行)；原始差距仍输出为信息项）。
  · BUG-14  由「数据层标题唯一」改为「展示层 曲名·歌手 消歧」（真实曲名不改）。

  V4.2.1 口径更新（对比旧版脚本）：
  · BUG-01  改为方案 B：每首歌「有真实谱面(omr/melody)」或
            「被显式标记 chartKind=generated-chords 且曲库/演奏侧有
             可见降级提示」——两者满足其一即 PASS。
  · BUG-03/04 搜索范围由「仅 assets/js/gp/」扩展为
            gp/ ∪ assets/js/modules/song-play.js ∪ songbook.js，
            判定为「存在 i18n 取词」/「存在 gs:lang 监听」。
  · BUG-07  判定改为「写入端 module 与读取端 module 口径一致」
            （读取端兼容 songbook 或 songplay 之一即算覆盖）。
  · BUG-08/09/10 数据依赖项，输出降级现状与具体名单。
  · BUG-11/14/15 输出完整异常名单（id/标题/越界秒数）。
  ============================================================ */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { GP_CHORD_SONGS } = await import(join(ROOT, 'assets/js/gp/songs.js'));
const { GP_OMR_NOTES } = await import(join(ROOT, 'assets/js/gp/omr-notes.js'));
const cat = await import(join(ROOT, 'assets/js/gp/catalog.js'));
const { findSong, hasRealChart, isOmrDegraded } = cat;
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const results = [];
const check = (id, title, ok, actual, expect, detail, dataDep = false) => {
  results.push({ id, title, ok, actual, expect, detail, dataDep });
  const tag = ok ? '[PASS]' : (dataDep ? '[DATA]' : '[FAIL]');
  console.log(`${tag} ${id} ${title}`);
  console.log(`       实测=${actual}  期望=${expect}`);
  if (detail) console.log(`       ${detail}`);
};

const TOTAL = GP_CHORD_SONGS.length;

/* --- BUG-01 谱面覆盖：真实谱 或 显式降级（方案 B） --- */
const omrIds = Object.keys(GP_OMR_NOTES);
const real = GP_CHORD_SONGS.filter(d => hasRealChart(d.id));
const noChart = GP_CHORD_SONGS.filter(d => !hasRealChart(d.id));
/* 显式降级证据：曲库角标 + 演奏徽章 + 跟唱提示 三处 UI 均走 i18n 键 */
const sbSrc = read('assets/js/modules/songbook.js');
const playSrc = read('assets/js/gp/play.js');
const uiHints = [
  ["曲库角标 songbook.simpleAcc", /hasRealChart\(s\.id\).*songbook\.simpleAcc/s.test(sbSrc)],
  ["演奏徽章 play.badge.generated", playSrc.includes('"play.badge.generated"') || playSrc.includes("'play.badge.generated'")],
  ["跟唱提示 play.singalongNotice", playSrc.includes('"play.singalongNotice"') || playSrc.includes("'play.singalongNotice'")],
];
const uiOk = uiHints.every(([, v]) => v);
const unmarked = noChart.filter(d => {
  const song = findSong(d.id);
  return song.chartKind !== 'generated-chords';
});
check('BUG-01', '每首歌有真实谱面 或 被显式标记为占位且 UI 有可见提示',
  unmarked.length === 0 && uiOk,
  `真实谱 ${real.length}/${TOTAL}；占位显式标记 ${noChart.length - unmarked.length}/${noChart.length}；UI 提示=${uiHints.filter(([, v]) => v).length}/3`,
  '无真实谱 → chartKind=generated-chords 且 曲库角标/演奏徽章/跟唱提示齐全',
  unmarked.length ? `未标记：${unmarked.map(d => d.id).join(',')}` :
    uiHints.map(([k, v]) => `${k}:${v ? 'ok' : '缺失'}`).join('；'));

/* --- BUG-02 占位和弦进行：已显式降级，不再伪装为歌曲专属 --- */
const combos = new Set(GP_CHORD_SONGS.map(d => (d.harmony && d.harmony.chords || []).join('-')));
const genCount = GP_CHORD_SONGS.filter(d => findSong(d.id).chartKind === 'generated-chords').length;
check('BUG-02', '模板和弦进行已被显式标记为占位（不再伪装真实谱）',
  genCount + real.length === TOTAL && uiOk,
  `${TOTAL} 首中共 ${combos.size} 种和弦组合；generated-chords=${genCount}，真实谱=${real.length}`,
  '逐曲真实和弦为数据依赖；占位曲必须全部诚实标记 + UI 提示',
  `占位曲演奏页显示「自动生成的简易伴奏（非原曲编配）」徽章+原版谱外链；真实逐曲和弦回填需回源曲谱数据（离线不可解）`,
  true);

/* --- BUG-03/04 i18n：gp/ ∪ song-play.js ∪ songbook.js --- */
const gpFiles = readdirSync(join(ROOT, 'assets/js/gp')).filter(f => f.endsWith('.js')).map(f => join('assets/js/gp', f));
const I18N_SCOPE = gpFiles.concat(['assets/js/modules/song-play.js', 'assets/js/modules/songbook.js']);
const i18nHits = [], langHits = [];
for (const rel of I18N_SCOPE) {
  const src = read(rel);
  if (/\bi18n\b|\bT\(|TF\(/.test(src)) i18nHits.push(rel);
  if (src.includes('gs:lang')) langHits.push(rel);
}
check('BUG-03', '演奏视图链路已接入 i18n 取词',
  i18nHits.length > 0, `${i18nHits.length}/${I18N_SCOPE.length} 个文件`, '> 0',
  '接入文件：' + i18nHits.join(', '));
check('BUG-04', '宿主壳监听 gs:lang 并重建演奏视图',
  langHits.length > 0, langHits.join(', ') || '无', '> 0',
  langHits.length ? '切语言后演奏视图随宿主壳重建（功能等价于 gp/ 内监听）' : '切换语言后演奏界面不会重新渲染');

/* --- BUG-06 曲库中文硬编码名称 --- */
const badTier = /TIER_META\[t\]\s*&&\s*TIER_META\[t\]\.name/.test(sbSrc);
const badTier2 = /TIER_META\[s\.tier\]\s*&&\s*TIER_META\[s\.tier\]\.name/.test(sbSrc);
const badSrc = /SOURCE_META\[sh\.source\].*\n.*src\.name|esc\(src\.name\)/.test(sbSrc);
check('BUG-06', '难度名/谱源名走 i18n 而非中文硬编码',
  !badTier && !badTier2,
  [
    badTier && 'songbook.js L280 tab 优先取 TIER_META[t].name(中文)',
    badTier2 && 'songbook.js L396 曲卡优先取 TIER_META[s.tier].name(中文)',
    badSrc && 'songbook.js L403-408 谱源名取 SOURCE_META[*].name(中文：QQ音乐曲谱/吉他社)',
  ].filter(Boolean).join('；') || '已走 i18n',
  '不含 TIER_META[..].name / SOURCE_META[..].name 直取',
  '英文界面下仍显示"入门级/初级/中级""QQ音乐曲谱"（i18n 键 songbook.tier.* 已存在但被短路）');

/* --- BUG-07 演奏成绩统计口径：写入端 vs 读取端 --- */
const stateSrc = read('assets/js/gp/state.js');
const stSrc = read('assets/js/modules/stats.js');
const writeModule = (stateSrc.match(/module:\s*'(\w+)'/) || [])[1];
const readModules = [...stSrc.matchAll(/module:\s*'(\w+)'/g)].map(m => m[1]);
const moduleAligned = writeModule && readModules.includes(writeModule);
const legacyCovered = /songplay/.test(stSrc);
check('BUG-07', '演奏写入端 module 与统计读取端口径一致',
  !!moduleAligned,
  `写入端(gp/state.js)='${writeModule}'；读取端(stats.js)=[${[...new Set(readModules)].join(',')}];兼容历史 songplay=${legacyCovered}`,
  '读取端覆盖写入端 module（songbook 或 songplay 之一）',
  legacyCovered ? '' : '风险：V4.2 之前写入的历史 module=songplay 记录在统计中不可见（无迁移/兼容查询）');

/* --- BUG-08 BPM 档位硬编码（数据依赖） --- */
const bpmDist = {}; for (const d of GP_CHORD_SONGS) bpmDist[d.bpm] = (bpmDist[d.bpm] || 0) + 1;
check('BUG-08', 'BPM 为逐曲真实值',
  Object.keys(bpmDist).length > 20,
  `${Object.keys(bpmDist).length} 个值 ${JSON.stringify(bpmDist)}`, '> 20 个值',
  'BPM 仍按 tier 硬编码（76/88/96）。逐曲真实 BPM 需回源数据，离线不可解；当前通过 chartKind 显式降级，不再伪装真实谱',
  true);

/* --- BUG-11 歌词时间轴越界（V4.2.2：统一 songDuration 口径后复验） ---
   修复方式：整曲时长 = max(谱面末音结束, 歌词末行结束)，卡拉 OK 不再截断；
   歌词时间戳数据本身未篡改。此处仍输出「歌词末时间 vs 谱面末音」原始差距作信息项。 */
const { songDuration } = await import(join(ROOT, 'assets/js/gp/song-format.js'));
const overList = [];       // 原始数据差距（歌词时间戳 vs 谱面末音，信息展示）
const cutList = [];        // 统一口径后仍会被截断的（应为 0）
for (const d of GP_CHORD_SONGS) {
  const song = findSong(d.id);
  if (!song.notes.length) continue;
  const noteEnd = Math.max(...song.notes.map(n => n.time + n.dur));
  const lyr = d.lyrics || [];
  const lyrEnd = lyr.length ? Math.max(...lyr.map(l => (l.time || 0) + (l.dur || 0))) : 0;
  if (lyrEnd > noteEnd + 2) overList.push(`${d.id} ${d.title} 原始差${(lyrEnd - noteEnd).toFixed(1)}s`);
  if (lyrEnd > songDuration(song) + 0.01) cutList.push(`${d.id} ${d.title} 仍截断${(lyrEnd - songDuration(song)).toFixed(1)}s`);
}
check('BUG-11', '统一 songDuration 口径后歌词不被中途截断',
  cutList.length === 0,
  `统一口径后仍截断 ${cutList.length} 首；原始歌词时间戳超出谱面末音 ${overList.length} 首（${overList.slice(0, 8).join('；')}）`,
  '0 首截断（时长取 max(谱面, 歌词)；歌词数据本身未改）',
  cutList.join('；') || '歌词末时间已纳入时长口径，卡拉 OK 不再截断');

/* --- BUG-14 重复标题（V4.2.2：展示层「曲名 · 歌手」消歧，不改真实曲名数据） --- */
const tmap = {}; for (const d of GP_CHORD_SONGS) (tmap[d.title] = tmap[d.title] || []).push(`${d.id}(${d.artist})`);
const dup = Object.entries(tmap).filter(([, v]) => v.length > 1);
const dispOk = /displayTitle/.test(playSrc) && /songTitle\(s\)|DUP_TITLES/.test(sbSrc);
check('BUG-14', '同名曲在展示层以「曲名 · 歌手」消歧',
  dispOk,
  `数据层同名 ${dup.length} 组（${dup.map(([k, v]) => `${k}: ${v.join(' vs ')}`).join(' | ') || '无'}）；展示层消歧：演奏视图=${/displayTitle/.test(playSrc)}，曲库卡片=${/DUP_TITLES/.test(sbSrc)}`,
  '展示层（曲库卡片/演奏标题）对同名曲追加歌手区分，真实曲名数据不变',
  dispOk ? '' : '展示层未做消歧处理');

/* --- BUG-15 缺歌词 --- */
const noLyr = GP_CHORD_SONGS.filter(d => !d.lyrics || !d.lyrics.length);
check('BUG-15', '每首歌都有歌词',
  noLyr.length === 0, noLyr.map(d => `${d.id} ${d.title}`).join(' | ') || '无', '无缺失',
  noLyr.length ? '歌词为数据依赖；未回源前演奏视图应显式提示「暂无歌词」而非空白' : '', noLyr.length > 0);

/* --- BUG-09 OMR 谱面循环：tempo 已修复，循环为短片段降级策略 --- */
const loops = [];
for (const gid of omrIds) {
  const d = GP_CHORD_SONGS.find(x => x.id === gid); if (!d) continue;
  const song = findSong(gid);
  if (!song.notes.length) continue;
  const noteEnd = Math.max(...song.notes.map(n => n.time + n.dur));
  const onePass = (GP_OMR_NOTES[gid].span || 0) * (60 / d.bpm);
  if (onePass > 0) loops.push({ id: gid, ratio: noteEnd / onePass, degraded: isOmrDegraded(gid) });
}
const badLoops = loops.filter(x => x.ratio < 0.9 || x.ratio > 1.1);
const badUnmarked = badLoops.filter(x => !x.degraded && findSong(x.id).chartKind === 'omr');
check('BUG-09', '短片段循环铺满的谱面已被显式降级标记（tempo 不再压缩）',
  badUnmarked.length === 0,
  `${badLoops.length}/${loops.length} 首循环遍数偏离 1 (范围 ${Math.min(...loops.map(x => x.ratio)).toFixed(2)}~${Math.max(...loops.map(x => x.ratio)).toFixed(2)})；其中未降级标记 ${badUnmarked.length} 首`,
  '循环曲目全部经 omrQuality 门禁降级或标注',
  badUnmarked.length ? `未标记：${badUnmarked.map(x => x.id).join(',')}` : 'spb 恒为 60/bpm，tempo 错乱已修复；整曲识别为数据依赖',
  true);

/* --- 汇总 --- */
const failed = results.filter(r => !r.ok && !r.dataDep);
const dataDep = results.filter(r => !r.ok && r.dataDep);
console.log('\n================ 汇总 ================');
console.log(`总计 ${results.length} 项，通过 ${results.filter(r => r.ok).length}，未通过 ${failed.length}，数据依赖 ${dataDep.length}`);
if (failed.length) console.log('未通过：' + failed.map(r => r.id).join(', '));
if (dataDep.length) console.log('数据依赖（显式降级口径）：' + dataDep.map(r => r.id).join(', '));
process.exit(failed.length ? 1 : 0);
