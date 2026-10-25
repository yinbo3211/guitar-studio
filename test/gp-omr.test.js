/* ============================================================
   六弦工坊 V4.2 · OMR 真实谱面音符测试
   ------------------------------------------------------------
   OMR-1 数据结构：GP_OMR_NOTES 条目 schema 合法（拍/时值/midi 单调）
   OMR-2 真值锚点：《送别》旋律音高类别序列须以 5-3-5-1 开头
        （对样本谱人工核对：OMR 60 事件与简谱 16 小节 100% 一致）
   OMR-3 目录集成：OMR 曲目演奏展开为合法歌曲、时间单调、循环铺满
   OMR-4 来源可审计：provenance 标注 OMR 识别来源
   OMR-5 资源一致性：omr-notes.js 纳入 SW 预缓存
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
test('OMR-3 OMR 曲目演奏展开：schema 合法、时间单调、来源标记 omr-tab', () => {
  for (const id of omrIds) {
    const song = cat.findSong(id);
    assert.ok(song, `${id} 应能展开`);
    assert.strictEqual(song.source, 'omr-tab', `${id}: source 应标记 omr-tab`);
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
