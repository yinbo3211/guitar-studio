/* ============================================================
   六弦工坊 V4.2 · OMR 真实谱面音符测试
   ------------------------------------------------------------
   OMR-1 数据结构：GP_OMR_NOTES 条目 schema 合法（拍/时值/midi 单调）
   OMR-2 真值锚点：《送别》旋律音高类别序列须以 5-3-5-1 开头
        （对样本谱人工核对：OMR 60 事件与简谱 16 小节 100% 一致）
   OMR-3 目录集成：OMR 曲目演奏展开为合法歌曲、时间单调、循环铺满
        （含 spb 断言：见 BUG-01，禁止再用等比压缩骗过「铺满时长」断言）
   OMR-4 来源可审计：provenance 标注 OMR 识别来源
   OMR-5 资源一致性：omr-notes.js 纳入 SW 预缓存
   OMR-6 tempo 恒定由 bpm 决定，整曲识别不得压缩（BUG-01 回归）
   OMR-7 短片段仍按真实四分拍循环铺满且速度不变（BUG-01 不回归）
   ------------------------------------------------------------
   编号说明：缺陷报告建议新增的 tempo 回归用例原编号 OMR-4/OMR-5 与既有
   「provenance / SW 预缓存」两条重号，故顺延为 OMR-6 / OMR-7，覆盖点一致。
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

const { GP_OMR_NOTES } = await imp('assets/js/gp/omr-notes.js');
const { GP_CHORD_SONGS, GP_PROVENANCE } = await imp('assets/js/gp/songs.js');
const { validateSong, songDuration } = await imp('assets/js/gp/song-format.js');
const cat = await imp('assets/js/gp/catalog.js');

const omrIds = Object.keys(GP_OMR_NOTES);

/* ============================================================
   OMR-1 数据结构
   ============================================================ */
test('OMR-1 GP_OMR_NOTES 条目 schema 合法（b/span/n，拍单调，midi 在吉他音域）', () => {
  assert.ok(omrIds.length > 0, '应至少识别出 1 首 OMR 曲目');
  for (const id of omrIds) {
    const o = GP_OMR_NOTES[id];
    assert.ok(Number.isInteger(o.b) && o.b >= 2 && o.b <= 12, `${id}: beatsPerMeasure`);
    assert.ok(o.span > 0, `${id}: span`);
    assert.ok(Array.isArray(o.n) && o.n.length >= 10, `${id}: 至少 10 个音符`);
    let prev = -1;
    for (const [beat, dur, midi] of o.n) {
      assert.ok(typeof beat === 'number' && beat >= prev - 1e-6, `${id}: 拍回退`);
      assert.ok(typeof dur === 'number' && dur > 0 && dur <= 3, `${id}: 时值越界 ${dur}`);
      assert.ok(Array.isArray(midi) && midi.length >= 1 && midi.length <= 6, `${id}: midi 数组`);
      assert.ok(midi.every((m) => Number.isInteger(m) && m >= 36 && m <= 88), `${id}: midi 越界`);
      prev = beat;
    }
  }
});

test('OMR-1 OMR 条目都能映射到曲库定义', () => {
  for (const id of omrIds) {
    assert.ok(cat.defById(id), `${id} 不在曲库`);
  }
});

/* ============================================================
   OMR-2 真值锚点（送别：人工核对样本 OMR 与简谱 100% 一致）
   ============================================================ */
test('OMR-2 《送别》OMR 旋律以音高类别 5-3-5-1(G-E-G-C) 开头', () => {
  if (!GP_OMR_NOTES['gp-song-001']) {
    assert.ok(false, 'gp-song-001 应有 OMR 数据（样本已验证）');
    return;
  }
  const pcs = [];
  for (const [, , midi] of GP_OMR_NOTES['gp-song-001'].n) {
    const pc = midi[0] % 12; // 每拍的旋律音（单音事件）
    if (!pcs.length || pcs[pcs.length - 1] !== pc) pcs.push(pc);
    if (pcs.length >= 4) break;
  }
  assert.deepStrictEqual(pcs.slice(0, 4), [7, 4, 7, 0], '送别开头应为 5-3-5-1(G-E-G-C)');
});

/* ============================================================
   OMR-3 目录集成
   ============================================================ */
test('OMR-3 OMR 曲目演奏展开：schema 合法、时间单调；通过门禁的标 omr-tab', () => {
  for (const id of omrIds) {
    const song = cat.findSong(id);
    assert.ok(song, `${id} 应能展开`);
    /* BUG-05：未过质量门禁的 OMR 已降级为 generated-chords，不再冒充真实识谱 */
    if (cat.omrQuality(GP_OMR_NOTES[id]).usable) {
      assert.strictEqual(song.source, 'omr-tab', `${id}: 通过门禁的应标记 omr-tab`);
      assert.strictEqual(song.chartKind, 'omr', `${id}: chartKind 应为 omr`);
    } else {
      assert.strictEqual(song.chartKind, 'generated-chords',
        `${id}: 退化识谱必须降级为 generated-chords`);
      assert.ok(cat.isOmrDegraded(id), `${id}: 应标记为「识谱不完整」`);
    }
    assert.deepStrictEqual(validateSong(song).errors, [], `${id}: schema 校验`);
    let prev = -1;
    for (const n of song.notes) {
      assert.ok(n.time >= prev - 1e-6, `${id}: time 回退`);
      assert.ok(n.dur > 0);
      prev = n.time;
    }
  }
});

test('OMR-3 OMR 曲目循环铺满整曲时长（时长 ≥ min(durationSec, span)×0.85）', () => {
  for (const id of omrIds) {
    const def = GP_CHORD_SONGS.find((s) => s.id === id);
    if (!def || !def.durationSec) continue;
    const song = cat.findSong(id);
    const want = Math.min(def.durationSec, GP_OMR_NOTES[id].span * (60 / song.bpm));
    assert.ok(songDuration(song) >= want * 0.85,
      `${id}: ${songDuration(song)}s 应接近目标 ${want}s`);
  }
});

/* BUG-01 加固：只断言「铺满时长」会被等比压缩骗过，必须同时锁死拍速 */
test('OMR-3b 任意相邻音符间隔都必须是四分拍的整数分数（spb=60/bpm 未被压缩）', () => {
  for (const id of omrIds) {
    const song = cat.findSong(id);
    const spb = 60 / song.bpm;
    const onsets = [...new Set(song.notes.map((n) => n.time))].sort((a, b) => a - b);
    /* OMR 事件网格是 1/4 拍 → 相邻 onset 间隔必须是 spb/4 的整数倍（容差 1ms） */
    for (let i = 1; i < onsets.length; i++) {
      const g = onsets[i] - onsets[i - 1];
      if (g < 1e-4) continue;
      const k = g / (spb / 4);
      assert.ok(Math.abs(k - Math.round(k)) < 0.02,
        `${id}: 间隔 ${g.toFixed(4)}s 不是 ${(spb / 4).toFixed(4)}s 的整数倍（拍速被篡改）`);
    }
  }
});

/* ============================================================
   OMR-4 / OMR-5 来源与资源一致性
   ============================================================ */
test('OMR-4 provenance 标注 OMR 识别来源与覆盖数', () => {
  assert.ok(/OMR|光学识别/.test(String(GP_PROVENANCE.omrSource || '')),
    'GP_PROVENANCE.omrSource 应标注 OMR');
  assert.ok(GP_PROVENANCE.counts.omrSongs === omrIds.length,
    `provenance 计数 ${GP_PROVENANCE.counts.omrSongs} 应等于实际 ${omrIds.length}`);
});

test('OMR-5 omr-notes.js 纳入 SW 预缓存（离线可用）', () => {
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf-8');
  assert.ok(sw.includes("'./assets/js/gp/omr-notes.js'"), 'sw.js CORE 应含 omr-notes.js');
});

/* ============================================================
   OMR-6 / OMR-7：BUG-01 tempo 回归
   ------------------------------------------------------------
   旧实现对 18 首「整曲识别」曲目执行 spb = want*0.985/span 的等比压缩，
   晴天 1.74×、稻香 1.69×、多远都要在一起 2.19×，且叠加 loops≥2 重复播放。
   ============================================================ */
const QUARTER_TOL = 0.02;   // 20ms 容差：toFixed(4) 舍入 + 浮点

/** 最小正 onset 间隔：OMR 网格为 1/4 拍，未被压缩时应恰为 spb/4 */
function minGap(song) {
  const onsets = [...new Set(song.notes.map((n) => n.time))].sort((a, b) => a - b);
  let m = Infinity;
  for (let i = 1; i < onsets.length; i++) {
    const d = onsets[i] - onsets[i - 1];
    if (d > 1e-4 && d < m) m = d;
  }
  return Number.isFinite(m) ? m : null;
}

test('OMR-6 整曲识别曲目 tempo 由 bpm 决定，不得被压缩（晴天 BUG-01 回归）', () => {
  const def = GP_CHORD_SONGS.find((s) => s.id === 'gp-song-199');
  const song = cat.findSong('gp-song-199');
  assert.ok(def && song, '晴天应有 OMR 数据');
  assert.strictEqual(cat.omrQuality(GP_OMR_NOTES['gp-song-199']).usable, true, '晴天应通过质量门禁');
  const spb = 60 / def.bpm;                       // 88 → 0.6818
  /* 旧实现 1.74× 压缩后最小间隔会被压到 ~0.098s；现在必须是 0.25 拍 = 0.1704s */
  const g = minGap(song);
  assert.ok(g !== null, '晴天应有多个不同 onset');
  assert.ok(Math.abs(g - spb / 4) < QUARTER_TOL,
    `晴天最小间隔应为 ${(spb / 4).toFixed(4)}s（0.25 拍），实际 ${g}s（拍速被压缩）`);

  /* 整曲形态：loops=1，不允许出现「第二遍整曲」（末音不超过 want + 1 小节） */
  const last = Math.max(...song.notes.map((n) => n.time));
  assert.ok(last <= def.durationSec + spb * 4 + 1e-3,
    `整曲不应多循环：末音 ${last}s 超出 ${def.durationSec + spb * 4}s`);
});

test('OMR-6 曾受压缩且通过门禁的曲目均已恢复到 1.0 倍速', () => {
  const wasBroken = ['gp-song-180', 'gp-song-027', 'gp-song-115', 'gp-song-202', 'gp-song-199',
    'gp-song-201', 'gp-song-014', 'gp-song-035', 'gp-song-018', 'gp-song-174', 'gp-song-142',
    'gp-song-015', 'gp-song-099', 'gp-song-140', 'gp-song-079', 'gp-song-007', 'gp-song-230',
    'gp-song-207'];
  let checked = 0;
  for (const id of wasBroken) {
    const def = GP_CHORD_SONGS.find((s) => s.id === id);
    const song = cat.findSong(id);
    assert.ok(def && song, `${id} 应存在于曲库`);
    /* 退化的识谱已由 BUG-05 降级为占位伴奏，tempo 断言只对真实谱有意义 */
    if (!cat.omrQuality(GP_OMR_NOTES[id]).usable) continue;
    checked++;
    const spb = 60 / def.bpm;
    const g = minGap(song);
    if (g === null) continue;
    const k = g / (spb / 4);
    assert.ok(Math.abs(k - Math.round(k)) < 0.02,
      `${id}《${def.title}》最小间隔 ${g.toFixed(4)}s 不在 ${(spb / 4).toFixed(4)}s 网格上`);
    assert.ok(g >= spb / 4 - 1e-3,
      `${id}《${def.title}》拍速被压缩：${g} < ${(spb / 4).toFixed(4)}`);
  }
  assert.ok(checked >= 8, `18 首中应至少 8 首仍是可用 OMR，实际 ${checked}`);
});

test('OMR-7 短片段仍按真实四分拍循环铺满（送别不回归）', () => {
  const def = GP_CHORD_SONGS.find((s) => s.id === 'gp-song-001');
  const song = cat.findSong('gp-song-001');
  const spb = 60 / def.bpm;                       // 76 → 0.7895
  const last = Math.max(...song.notes.map((n) => n.time));
  assert.ok(last >= def.durationSec - 1,
    `送别需循环铺满约 ${def.durationSec}s，实际末音 ${last}s`);
  const g = minGap(song);
  assert.ok(g !== null && Math.abs(g - spb / 4) < QUARTER_TOL,
    `送别最小间隔应为 ${(spb / 4).toFixed(4)}s，实际 ${g}s`);
  /* 跨度仍应是多次循环：单遍 passSec 远小于 want */
  const passSec = GP_OMR_NOTES['gp-song-001'].span * spb;
  const loops = Math.max(1, Math.ceil(def.durationSec / passSec));
  assert.ok(loops >= 2, `送别应循环 ${loops} 遍`);
});
