/* ============================================================
   六弦工坊 V4.2.3 · T03 谱面门禁放宽 + BPM 反推 覆盖测试
   ------------------------------------------------------------
   C-1 chartKind 分布与 hasRealChart 一致（omr 24 / melody 5 / generated 207）
   C-2 三项达标且 ratio∈[0.55,4.0] 的曲目必须 usable（无误杀）
   C-3 所有 omr 曲 loopInfo 完整（passes≥1，truncated/looped 与 ratio 一致）
   C-4 5 首超限（loopRatio>4）仍降级 generated-chords
   C-5 全库 song.bpm ∈ [60,200]
   期望值均为实跑口径（见 tools/diagnose-songbook.mjs），勿凭印象改。
   ============================================================ */
'use strict';
import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

await imp('test/_gp-dom.mjs');

const cat = await imp('assets/js/gp/catalog.js');
const { GP_CHORD_SONGS, GP_MELODY_SONGS } = await imp('assets/js/gp/songs.js');
const { GP_OMR_NOTES } = await imp('assets/js/gp/omr-notes.js');

const ALL_DEFS = GP_MELODY_SONGS.concat(GP_CHORD_SONGS);

test('C-1 chartKind 分布：omr 24 / melody 5 / generated-chords 207，且与 hasRealChart 一致', () => {
  const dist = { omr: 0, melody: 0, 'generated-chords': 0 };
  let realFlag = 0;
  for (const def of ALL_DEFS) {
    const song = cat.findSong(def.id);
    dist[song.chartKind] += 1;
    if (cat.hasRealChart(def.id)) realFlag += 1;
  }
  assert.deepStrictEqual(dist, { omr: 24, melody: 5, 'generated-chords': 207 },
    `chartKind 分布实跑口径：${JSON.stringify(dist)}`);
  assert.strictEqual(realFlag, 29, '真实谱（omr 24 + melody 5）共 29 首，不是 29 首 omr');
});

test('C-2 三项达标且循环比值在 [0.55,4.0] 的曲目必须 usable（门禁无误杀）', () => {
  let checked = 0;
  for (const def of GP_CHORD_SONGS) {
    const omr = GP_OMR_NOTES[def.id];
    if (!omr) continue;
    const q = cat.omrQuality(omr, def);
    const pass3 = q.notes >= 24 && q.density >= 1.2 && q.pitchKinds >= 4;
    const ratioOk = q.loopRatio >= cat.OMR_LOOP_RATIO_MIN && q.loopRatio <= cat.OMR_LOOP_RATIO_MAX;
    if (pass3 && ratioOk) {
      checked += 1;
      assert.strictEqual(q.usable, true,
        `${def.id}《${def.title}》达标且 ratio=${q.loopRatio.toFixed(2)} 在门禁内，不得误杀`);
    }
  }
  assert.strictEqual(checked, 24, `应恰为 24 首 omr 真实谱，实际 ${checked}`);
});

test('C-3 所有 omr 曲带完整 loopInfo：passes≥1，truncated/looped 与 ratio 一致，bpmSource 合法', () => {
  const BPM_SOURCES = ['tier-estimate', 'derived-omr', 'fallback-tier'];
  let omrCount = 0;
  for (const def of ALL_DEFS) {
    const song = cat.findSong(def.id);
    if (song.chartKind !== 'omr') continue;
    omrCount += 1;
    const li = song.loopInfo;
    assert.ok(li, `${def.id} 缺 loopInfo`);
    assert.ok(li.passes >= 1, `${def.id} passes 应 ≥1`);
    assert.ok(li.passSec > 0, `${def.id} passSec 应 >0`);
    assert.strictEqual(li.truncated, li.ratio < 0.98, `${def.id} truncated 与 ratio=${li.ratio.toFixed(3)} 不一致`);
    assert.strictEqual(li.looped, li.ratio > 1.02, `${def.id} looped 与 ratio=${li.ratio.toFixed(3)} 不一致`);
    assert.ok(BPM_SOURCES.includes(song.bpmSource), `${def.id} bpmSource 非法：${song.bpmSource}`);
    assert.ok(song.bpmEffective >= 60 && song.bpmEffective <= 200,
      `${def.id} bpmEffective 越界：${song.bpmEffective}`);
  }
  assert.strictEqual(omrCount, 24, 'omr 曲目数应为 24');
});

test('C-4 5 首循环超限（ratio>4）仍降级 generated-chords 且标记识谱不完整', () => {
  const STILL5 = ['gp-song-093', 'gp-song-102', 'gp-song-129', 'gp-song-171', 'gp-song-188'];
  for (const id of STILL5) {
    const def = GP_CHORD_SONGS.find((s) => s.id === id);
    const q = cat.omrQuality(GP_OMR_NOTES[id], def);
    assert.strictEqual(q.usable, false, `${id} 循环超限必须不可用（ratio=${q.loopRatio.toFixed(2)}）`);
    assert.ok(q.loopRatio > cat.OMR_LOOP_RATIO_MAX, `${id} ratio 应超上限，实际 ${q.loopRatio.toFixed(2)}`);
    assert.strictEqual(cat.findSong(id).chartKind, 'generated-chords', `${id} 必须降级`);
    assert.ok(cat.isOmrDegraded(id), `${id} 应标记为「识谱不完整」`);
  }
});

test('C-5 全库展开曲 bpm ∈ [60,200]（含 bpmEffective 不回灌门禁与播放）', () => {
  for (const def of ALL_DEFS) {
    const song = cat.findSong(def.id);
    assert.ok(song.bpm >= 60 && song.bpm <= 200,
      `${def.id}《${def.title}》bpm 越界：${song.bpm}`);
  }
});

test('C-6 BPM 反推防循环论证：门禁恒用 tier bpm，deriveBpm 结果不回灌 loopRatio', () => {
  /* 送别：tier-bpm loopRatio=3.47（循环 4 遍）→ bpmSource 必须 fallback-tier，
     绝不用反推 bpm 重算 ratio（否则门禁恒等于 1，完全失效） */
  const def = GP_CHORD_SONGS.find((s) => s.id === 'gp-song-001');
  const omr = GP_OMR_NOTES['gp-song-001'];
  const b = cat.deriveBpm(def, omr);
  assert.strictEqual(b.bpmSource, 'fallback-tier', '循环片段不得反推 bpm（循环论证）');
  assert.strictEqual(b.bpm, def.bpm, 'fallback 时保持 tier bpm');
  /* 花海：单遍≈整曲（ratio∈[0.9,1.1]）且偏差 ≤15% → derived-omr */
  const def230 = GP_CHORD_SONGS.find((s) => s.id === 'gp-song-230');
  const b230 = cat.deriveBpm(def230, GP_OMR_NOTES['gp-song-230']);
  assert.strictEqual(b230.bpmSource, 'derived-omr');
  assert.ok(Math.abs(b230.bpm - def230.bpm) / def230.bpm <= 0.15, '偏差须 ≤15%');
  /* 无 OMR / 无时长 → tier-estimate，不抛错 */
  assert.strictEqual(cat.deriveBpm({ bpm: 88 }, null).bpmSource, 'tier-estimate');
  assert.strictEqual(cat.deriveBpm(null, null).bpm, 80);
  /* 回滚开关：直接返回 fallback-tier 即恢复旧行为（本用例锁定该语义） */
  const q = cat.omrQuality(omr, def);
  assert.strictEqual(q.bpmSource, 'fallback-tier', 'omrQuality 透传 deriveBpm 结果');
});
