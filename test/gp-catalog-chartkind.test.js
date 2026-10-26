/* ============================================================
   六弦工坊 V4.2.1 · chartKind 诚实降级 与 OMR 质量门禁测试
   ------------------------------------------------------------
   CHART-1 每首展开的 song 都必须带合法 chartKind
   CHART-2 无 OMR / 无 melody 的曲目一律标 generated-chords，不得冒充 omr
   CHART-3 generated-chords 不产出可评分的 accuracy（弹唱契约 accuracy=null）
   CHART-4 真实调号/capo 回填（BUG-02 Step B）——数据尚未具备，显式 skip
   OMR-Q1 质量门禁：正常谱 usable，退化谱 unusable
   OMR-Q2 unusable 的 OMR 必须降级为 generated-chords
   OMR-Q3 曲库角标判定 hasRealChart 与展开结果一致
   ============================================================ */
'use strict';
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

await imp('test/_gp-dom.mjs');

const cat = await imp('assets/js/gp/catalog.js');
const { GP_CHORD_SONGS, GP_MELODY_SONGS } = await imp('assets/js/gp/songs.js');
const { GP_OMR_NOTES } = await imp('assets/js/gp/omr-notes.js');
const { validateSong, CHART_KINDS } = await imp('assets/js/gp/song-format.js');
const { Store } = await imp('assets/js/gp/state.js');

const ALL_DEFS = GP_MELODY_SONGS.concat(GP_CHORD_SONGS);

/* ============================================================
   CHART-1 / CHART-2：chartKind 标记
   ============================================================ */
test('CHART-1 每首展开的 song 都必须带合法 chartKind', () => {
  for (const def of ALL_DEFS) {
    const song = cat.findSong(def.id);
    assert.ok(song, `${def.id} 应能展开`);
    assert.ok(CHART_KINDS.includes(song.chartKind),
      `${def.id}《${def.title}》chartKind 非法：${song.chartKind}`);
    assert.deepStrictEqual(validateSong(song).errors, [], `${def.id} schema 校验`);
  }
});

test('CHART-2 无 OMR 或无 melody 的曲目一律标 generated-chords，不得标 omr', () => {
  let generated = 0;
  for (const def of ALL_DEFS) {
    const hasOmr = !!GP_OMR_NOTES[def.id];
    if (def.melody) {
      assert.strictEqual(cat.findSong(def.id).chartKind, 'melody', `${def.id} 应标 melody`);
      continue;
    }
    const song = cat.findSong(def.id);
    if (hasOmr && cat.omrQuality(GP_OMR_NOTES[def.id], def).usable) {   // BUG-09：含循环遍数判定
      assert.strictEqual(song.chartKind, 'omr', `${def.id} 通过门禁应标 omr`);
    } else {
      assert.strictEqual(song.chartKind, 'generated-chords',
        `${def.id}《${def.title}》无真实谱必须标 generated-chords`);
      assert.ok(song.notes.every((n) => n.chord === true), '降级曲走占位扫弦分支');
      generated++;
    }
  }
  assert.ok(generated >= 175, `至少 175 首标记为简易伴奏，实际 ${generated}`);
  /* BUG-09：19 首短片段循环铺满的 OMR 降级后，generated-chords 应为 221（202 + 19） */
  assert.strictEqual(generated, 221, `BUG-09 后 generated-chords 应为 221，实际 ${generated}`);
});

test('CHART-2b chartKind 非法值必须被 schema 校验拦下', () => {
  const base = cat.findSong('gp-song-001');
  assert.deepStrictEqual(validateSong({ ...base, chartKind: 'omr' }).errors, []);
  const bad = validateSong({ ...base, chartKind: 'real-tab-pirated' });
  assert.ok(!bad.ok && bad.errors.some((e) => /chartKind/.test(e)), '非法 chartKind 必须报错');
});

/* ============================================================
   CHART-3：generated-chords 不评分
   ============================================================ */
test('CHART-3 generated-chords 曲目写入的成绩 accuracy 恒为 null（弹唱契约）', () => {
  const def = GP_CHORD_SONGS.find((s) => !GP_OMR_NOTES[s.id]);
  assert.ok(def, '应存在纯占位曲目');
  assert.strictEqual(cat.findSong(def.id).chartKind, 'generated-chords');
  let captured = null;
  globalThis.PracticeStore = { addSession: (r) => { captured = r; return r; } };
  try {
    Store.addHistory({
      ts: Date.now(), songId: def.id, songTitle: def.title,
      score: 0, accuracy: null, maxStreak: 0, passed: true, durationSec: 30,
    });
  } finally { delete globalThis.PracticeStore; }
  assert.ok(captured, '应写入会话');
  assert.strictEqual(captured.accuracy, null, '占位伴奏不得产出 accuracy');
  assert.strictEqual(captured.meta.score, 0, '占位伴奏不得产出分数');
  assert.strictEqual(captured.module, 'songbook', '仍按曲库契约写入');
});

test('CHART-3b play.js 对 generated-chords 走跟唱模式（源码约束）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'assets/js/gp/play.js'), 'utf8');
  assert.ok(/singalongOnly\s*=\s*chartKind\s*===\s*"generated-chords"/.test(src),
    '必须按 chartKind 判定跟唱模式');
  assert.ok(/if\s*\(!singalongOnly\)\s*grade\(\)/.test(src),
    '跟唱模式下必须跳过判分（占位和弦无法判定对错）');
  assert.ok(/chartBadge\(/.test(src), '演奏页必须渲染谱面来源徽章');
});

/* ============================================================
   CHART-4：Step B 数据回填（当前不具备真实 key/capo 数据）
   ============================================================ */
test('CHART-4 真实调号/capo 回填（BUG-02 Step B）', { skip: '离线环境缺少逐小节真实和弦与调号数据，待按 songlist-data 外链谱回源后再启用' }, () => {
  const keys = new Set(GP_CHORD_SONGS.map((s) => s.key));
  const capos = new Set(GP_CHORD_SONGS.map((s) => s.capo));
  assert.ok(keys.size > 1 || capos.size > 1, '应回填真实调号/capo，不能全 C / 全 0');
});

/* ============================================================
   OMR-Q1 / Q2 / Q3：数据质量门禁
   ============================================================ */
test('OMR-Q1 质量门禁：整曲谱 usable，退化谱/循环铺满谱 unusable（BUG-05 + BUG-09）', () => {
  const defOf = (id) => GP_CHORD_SONGS.find((s) => s.id === id);
  /* 整曲识别（单遍≈整曲时长）→ usable */
  assert.strictEqual(cat.omrQuality(GP_OMR_NOTES['gp-song-011'], defOf('gp-song-011')).usable, true, '简单爱应可用');
  assert.strictEqual(cat.omrQuality(GP_OMR_NOTES['gp-song-230'], defOf('gp-song-230')).usable, true, '花海应可用');
  /* 密度/音高退化（BUG-05） */
  assert.strictEqual(cat.omrQuality(GP_OMR_NOTES['gp-song-063'], defOf('gp-song-063')).usable, false, '万有引力 10 音全同音高必须不可用');
  assert.strictEqual(cat.omrQuality(GP_OMR_NOTES['gp-song-117'], defOf('gp-song-117')).usable, false, '月光密度过低必须不可用');
  /* 短片段循环铺满（BUG-09）：单遍时长 vs 展开时长比值偏离 1 → unusable */
  assert.strictEqual(cat.omrQuality(GP_OMR_NOTES['gp-song-001'], defOf('gp-song-001')).usable, false, '送别为短片段循环铺满，不得再标真实谱');
  assert.strictEqual(cat.omrQuality(GP_OMR_NOTES['gp-song-199'], defOf('gp-song-199')).usable, false, '晴天为短片段循环铺满，不得再标真实谱');
  /* 不传 def 时跳过循环判定（无 bpm/durationSec 可算），保持旧的密度口径 */
  assert.strictEqual(cat.omrQuality(GP_OMR_NOTES['gp-song-001']).usable, true, '无 def 时循环判定跳过');
});

test('OMR-Q1b omrQuality 为空/损坏数据返回 usable=false，不抛错', () => {
  for (const bad of [null, undefined, {}, { span: 0, n: [] }, { span: 16, n: null }]) {
    const q = cat.omrQuality(bad);
    assert.strictEqual(q.usable, false, '损坏数据必须判为不可用');
    assert.ok(Number.isFinite(q.density) && Number.isFinite(q.bars), '返回值必须是有限数字');
  }
});

test('OMR-Q2 unusable 的 OMR 不再产出 omr 谱面，降级为 generated-chords', () => {
  assert.strictEqual(cat.findSong('gp-song-063').chartKind, 'generated-chords');
  assert.strictEqual(cat.findSong('gp-song-117').chartKind, 'generated-chords');
  assert.notStrictEqual(cat.findSong('gp-song-063').source, 'omr-tab',
    '降级曲不得再标榜 omr-tab 来源');
  /* 同时确认未被误伤：整曲识别的真实谱仍标 omr（gp-song-001 送别为循环铺满，BUG-09 已降级） */
  assert.strictEqual(cat.findSong('gp-song-230').chartKind, 'omr');
  assert.strictEqual(cat.findSong('gp-song-011').chartKind, 'omr');
});

test('OMR-Q3 曲库角标判定 hasRealChart 与展开结果一致', () => {
  for (const def of ALL_DEFS) {
    const song = cat.findSong(def.id);
    const real = cat.hasRealChart(def.id);
    assert.strictEqual(real, song.chartKind !== 'generated-chords',
      `${def.id}《${def.title}》角标与 chartKind 不一致`);
    /* 两种 id 形态都要能判定 */
    const bare = String(def.id).replace(/^gp-/, '');
    assert.strictEqual(cat.hasRealChart(bare), real, `${bare} 与 ${def.id} 判定应一致`);
  }
  assert.strictEqual(cat.hasRealChart('no-such-song'), false, '未知 id 恒为 false');
});
