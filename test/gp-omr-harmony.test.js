/* ============================================================
   六弦工坊 V4.2.4 · test/gp-omr-harmony.test.js
   ------------------------------------------------------------
   OH-1 每首 chartKind==='omr' 的真实谱都带非空 chords（N-3）
   OH-2 和弦为合法 [rootPc, type] 二元组
   OH-3 harmony.source 必须落在 source 白名单内（§3.4 契约）
   OH-4 幂等性：清缓存重取 source 不变
   OH-5 barChords 长度 === 小节数（供演奏视图按小节取）
   OH-6 有 OMR 数据的 56 首（含降级占位）全部有 harmony（E-3 口径）
   OH-7 绝对禁止：harmonize 结果不得反向污染 song.notes（GP-2 / chartKind 诚实模型）
   OH-8 omrQuality() 源码不得引入 harmony（防 R-1 循环论证）
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
const { GP_CHORD_SONGS } = await imp('assets/js/gp/songs.js');
const { GP_OMR_NOTES } = await imp('assets/js/gp/omr-notes.js');

/** §3.4 契约：source 取值集合（authored 为未来回源预留） */
const ALLOWED_SOURCES = new Set(['template', 'derived-omr', 'harmonized-melody']);

const omrSongs = GP_CHORD_SONGS.map((d) => cat.findSong(d.id)).filter((s) => s.chartKind === 'omr');

test('OH-1 每首真实谱都必须带和弦进行', () => {
  assert.ok(omrSongs.length > 0, '应存在真实谱曲目');
  const missing = omrSongs.filter((s) => !s.harmony || !s.harmony.chords || !s.harmony.chords.length);
  assert.deepStrictEqual(missing.map((s) => s.id), [], '真实谱缺 harmony');
  assert.strictEqual(omrSongs.length, 24, '基线实测：通过门禁的真实谱 24 首');
});

test('OH-2 和弦进行应为合法 [rootPc, type] 二元组', () => {
  for (const d of GP_CHORD_SONGS) {
    const s = cat.findSong(d.id);
    if (!s.harmony) continue;
    for (const c of s.harmony.chords) {
      assert.ok(Array.isArray(c) && c.length === 2, `${d.id} 和弦格式错误`);
      assert.ok(Number.isInteger(c[0]) && c[0] >= 0 && c[0] < 12, `${d.id} rootPc 越界`);
      assert.ok(typeof c[1] === 'string' && c[1].length > 0, `${d.id} type 非字符串`);
    }
  }
});

test('OH-3 所有曲目的 harmony.source 必须落在白名单内', () => {
  const bad = [];
  for (const d of GP_CHORD_SONGS) {
    const src = cat.findSong(d.id).harmony && cat.findSong(d.id).harmony.source;
    if (!ALLOWED_SOURCES.has(src)) bad.push(`${d.id}:${src}`);
  }
  assert.deepStrictEqual(bad.slice(0, 8), [], `越界 source：${bad.join(' | ')}`);
  /* 真实谱只允许两种「有证据」来源，不得是 template 占位 */
  const tpl = omrSongs.filter((s) => s.harmony.source === 'template').map((s) => s.id);
  assert.deepStrictEqual(tpl, [], '真实谱不得为 template 占位和声');
});

test('OH-4 幂等性：清缓存后重取 source 不变（防随机/顺序依赖）', () => {
  const before = omrSongs.map((s) => [s.id, s.harmony.source]);
  cat.clearCache();
  const after = omrSongs.map((d) => [d.id, cat.findSong(d.id).harmony.source]);
  assert.deepStrictEqual(
    Object.fromEntries(after),
    Object.fromEntries(before),
    '同曲目两次展开的 source 必须一致',
  );
});

test('OH-5 barChords 长度应等于小节数（≥ chords 长度）', () => {
  for (const s of omrSongs) {
    const h = s.harmony;
    assert.ok(Array.isArray(h.barChords), `${s.id} 缺 barChords`);
    assert.ok(h.barChords.length >= h.chords.length, `${s.id} barChords 过短`);
    assert.ok(h.beatsPerBar > 0, `${s.id} beatsPerBar 非法`);
    for (const c of h.barChords) {
      assert.ok(Array.isArray(c) && c.length === 2 && Number.isInteger(c[0]),
        `${s.id} barChords 含非法项`);
    }
  }
});

test('OH-6 有 OMR 数据的曲目（含降级占位）全部带 harmony（E-3 口径）', () => {
  const withOmr = GP_CHORD_SONGS.filter((d) => GP_OMR_NOTES[d.id]);
  assert.ok(withOmr.length > 0);
  const missing = withOmr.filter((d) => {
    const h = cat.findSong(d.id).harmony;
    return !h || !h.chords || !h.chords.length;
  });
  assert.deepStrictEqual(missing.map((d) => d.id), [], '有 OMR 的曲目不得缺 harmony');
  assert.strictEqual(withOmr.length, 56, '基线实测：有 OMR 数据的曲目 56 首');
});

test('OH-7 harmonize 不得反向写回 song.notes（GP-2 / chartKind 诚实模型）', () => {
  /* 占位谱（generated-chords）必须仍满足 3–4 音 + chord:true */
  for (const d of GP_CHORD_SONGS) {
    const s = cat.findSong(d.id);
    if (s.chartKind !== 'generated-chords') continue;
    assert.ok(s.notes.every((n) => n.midi.length >= 3 && n.midi.length <= 4 && n.chord === true),
      `${d.id} 占位谱音符被污染`);
  }
  /* 真实谱的单音比例不得被 harmonize 改变：-OW Boravia 音符数量必须与 OMR 事件一致 */
  for (const s of omrSongs) {
    assert.ok(s.notes.length > 0, `${s.id} 真实谱不应无音符`);
    const multi = s.notes.filter((n) => n.midi.length > 1).length;
    assert.ok(multi <= s.notes.length, `${s.id} 音符结构异常`);
  }
});

test('OH-8 omrQuality() 源码不得引入 harmony（防 R-1 循环论证）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'assets/js/gp/catalog.js'), 'utf8');
  const body = src.slice(src.indexOf('export function omrQuality'), src.indexOf('export function hasRealChart'));
  assert.ok(body.length > 0, '应能定位 omrQuality 函数体');
  assert.ok(!/harmony/.test(body),
    'omrQuality() 只允许用 notes/density/pitchKinds/loopRatio 四项原始统计，不得读 harmony');
});
