/* ============================================================
   六弦工坊 V4.2.3 · T04 P-4 和弦派生 + P-5 节奏型 测试
   ------------------------------------------------------------
   H-1 合成 OMR（C-G-Am-F 四小节）还原 [0,7,9,5]（maj/maj/min/maj）
   H-2 噪声/单音小节沿用上一小节并标 uncertain；开头失败用首个识别回填
   H-3 相邻去重：同一和弦连续小节只保留一次
   H-4 全部识别失败 → chords 为空（调用方回退模板，零数据风险）
   H-5 集成：降级曲展开后 harmony.source 为 derived-omr 时，
      产物音符仍满足 GP-2 硬约束（3–4 音、chord:true）
   H-6 P-5 节奏型：PATTERNS 只改 onset/dur/力度/排列，绝不产出单音
   ============================================================ */
'use strict';
import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

await imp('test/_gp-dom.mjs');

const { deriveHarmony } = await imp('tools/derive-harmony.mjs');   // tools 入口（re-export）
const { deriveHarmony: dh2 } = await imp('assets/js/gp/harmony.js');
const cat = await imp('assets/js/gp/catalog.js');
const { GP_CHORD_SONGS } = await imp('assets/js/gp/songs.js');
const { GP_OMR_NOTES } = await imp('assets/js/gp/omr-notes.js');

/* C-G-Am-F 四小节合成 OMR（每小节一个和弦事件，bass=根音） */
const CG_AM_F = {
  b: 4, span: 16,
  n: [
    [0, 3, [48, 52, 55]],    // C 大三
    [4, 3, [43, 47, 50]],    // G 大三
    [8, 3, [45, 48, 52]],    // A 小三
    [12, 3, [41, 45, 48]],   // F 大三
  ],
};

test('H-1 合成 OMR 还原 C-G-Am-F 进行（rootPc [0,7,9,5]）', () => {
  assert.strictEqual(deriveHarmony, dh2, 'tools/derive-harmony.mjs 应 re-export 运行时实现');
  const r = deriveHarmony(CG_AM_F, 4, { keyPc: 0 });
  assert.deepStrictEqual(r.chords.map(([pc]) => pc), [0, 7, 9, 5]);
  assert.deepStrictEqual(r.chords.map(([, t]) => t), ['maj', 'maj', 'min', 'maj']);
  assert.deepStrictEqual(r.uncertainBars, [], '四小节全部识别成功');
  assert.strictEqual(r.source, 'derived-omr');
});

test('H-2 噪声/单音小节沿用上一小节并标 uncertain', () => {
  const omr = {
    b: 4, span: 12,
    n: [
      [0, 3, [48, 52, 55]],        // bar0 C
      [4, 1, [64]], [5, 1, [64]],  // bar1 单音重复（噪声）→ 沿用 C
      [8, 3, [43, 47, 50]],        // bar2 G
    ],
  };
  const r = deriveHarmony(omr, 4);
  assert.deepStrictEqual(r.chords.map(([pc]) => pc), [0, 7], 'bar1 沿用 C，去重后 C-G');
  assert.deepStrictEqual(r.uncertainBars, [1], 'bar1 标 uncertain');
  /* 开头失败：用首个识别成功的和弦回填 */
  const head = deriveHarmony({ b: 4, span: 8, n: [[0, 1, [64]], [4, 3, [48, 52, 55]]] }, 4);
  assert.deepStrictEqual(head.chords, [[0, 'maj']], '开头噪声小节前移回填');
  assert.ok(head.uncertainBars.includes(0));
});

test('H-3 相邻去重：同一和弦连续多小节只保留一次', () => {
  const omr = {
    b: 4, span: 12,
    n: [
      [0, 3, [48, 52, 55]], [4, 3, [48, 52, 55]],   // C C
      [8, 3, [43, 47, 50]],                          // G
    ],
  };
  const r = deriveHarmony(omr, 4);
  assert.deepStrictEqual(r.chords, [[0, 'maj'], [7, 'maj']]);
});

test('H-4 全部识别失败 → chords 为空（调用方回退模板）', () => {
  const noise = { b: 4, span: 8, n: [[0, 1, [64]], [4, 1, [64]]] };
  const r = deriveHarmony(noise, 4);
  assert.deepStrictEqual(r.chords, []);
  assert.strictEqual(r.source, 'derived-omr');
  assert.deepStrictEqual(deriveHarmony(null, 4).chords, [], '坏数据不抛错');
});

test('H-5 集成：有 OMR 的降级曲优先派生和声；派生产物仍满足 GP-2 硬约束', () => {
  let derived = 0;
  for (const def of GP_CHORD_SONGS) {
    const song = cat.findSong(def.id);
    if (song.chartKind !== 'generated-chords') continue;
    assert.ok(song.harmony && ['template', 'derived-omr'].includes(song.harmony.source),
      `${def.id} harmony.source 非法`);
    if (song.harmony.source === 'derived-omr') {
      derived += 1;
      assert.ok(Array.isArray(song.harmony.uncertainBars), `${def.id} 应带 uncertainBars`);
      /* GP-2 硬约束：派生只换和弦内容，每个音符仍是 3–4 音完整和弦 */
      assert.ok(song.notes.every((n) => n.midi.length >= 3 && n.midi.length <= 4 && n.chord === true),
        `${def.id} 派生和弦不得产出单音/非和弦音符`);
    }
  }
  assert.ok(derived > 0, '应至少 1 首降级曲使用派生和声');
  /* 无 OMR 的纯模板曲保持 template（P-4 未命中分支） */
  const noOmr = GP_CHORD_SONGS.find((s) => !GP_OMR_NOTES[s.id]);
  assert.strictEqual(cat.findSong(noOmr.id).harmony.source, 'template');
});

test('H-6 P-5 节奏型：只改 onset/dur/力度/排列，每个音符仍是完整和弦', () => {
  for (const [name, p] of Object.entries(cat.PATTERNS)) {
    assert.ok(p.events.length >= 2, `${name} 至少 2 个事件`);
    let prev = -1;
    for (const ev of p.events) {
      assert.ok(ev.b >= prev, `${name} onset 单调`);
      assert.ok(Math.abs(ev.b * 4 - Math.round(ev.b * 4)) < 1e-9, `${name} onset 须在 0.25 拍网格上`);
      assert.ok(ev.d > 0 && ev.d <= 2, `${name} 时值合理`);
      prev = ev.b;
    }
  }
  /* 三个层级各取一首无 OMR 曲目验证展开结果 */
  for (const tier of [1, 2, 3]) {
    const def = GP_CHORD_SONGS.find((s) => s.tier === tier && !GP_OMR_NOTES[s.id]);
    assert.ok(def, `tier ${tier} 应有无 OMR 曲目`);
    const song = cat.findSong(def.id);
    assert.ok(song.notes.every((n) => n.midi.length >= 3 && n.midi.length <= 4 && n.chord === true),
      `tier ${tier} 节奏型不得产出单音音符`);
    let prevT = -1;
    for (const n of song.notes) {
      assert.ok(n.time >= prevT - 1e-6, '时间不得回退');
      assert.ok(n.dur > 0);
      prevT = n.time;
    }
  }
  /* F-5：PATTERNS 里定义的每种节奏型都必须有可达路径（无死配置） */
  const reachable = new Set();
  for (const def of GP_CHORD_SONGS) {
    const p = cat.pickPattern(def);
    for (const [name, pat] of Object.entries(cat.PATTERNS)) if (pat === p) reachable.add(name);
  }
  assert.deepStrictEqual([...reachable].sort(), Object.keys(cat.PATTERNS).sort(),
    '每种节奏型都应被至少一首曲目选中');
});
