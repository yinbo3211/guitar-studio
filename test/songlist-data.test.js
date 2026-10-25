/* ============================================================
   六弦工坊 V4.0 · 曲库数据层回归测试（SD-1 ~ SD-7）
   ------------------------------------------------------------
   纯数据断言，不依赖 DOM / localStorage。
   基线以手册 §10.1 实测值为准：231 首 / 层级 159-61-11 /
   sheets 706（qq_sheet 136 · qq_chord 127 · jitashe 443）/
   hasQQChord 127 首 / UNITS 19 且合计 231。
   ============================================================ */
'use strict';
import test from 'node:test';
import assert from 'node:assert';

const SD = await import('../assets/js/data/songlist-data.js');
const { SONGS, UNITS, validate, songById, searchSongs, songsOfUnit, orderedSongs } = SD;

test('SD-1 数据完整：validate 无错、231 首、编号 1-231 连续', () => {
  assert.deepStrictEqual(validate(), [], 'validate() 应返回空错误数组');
  assert.strictEqual(SONGS.length, 231, '曲目总数应为 231');
  const list = orderedSongs();
  assert.strictEqual(list.length, 231);
  list.forEach((s, i) => assert.strictEqual(s.no, i + 1, `第 ${i + 1} 首的 no 应为 ${i + 1}`));
  assert.strictEqual(list[0].no, 1);
  assert.strictEqual(list[list.length - 1].no, 231);
});

test('SD-2 层级分布：入门 159 / 初级 61 / 中级 11', () => {
  const c = { 1: 0, 2: 0, 3: 0 };
  for (const s of SONGS) c[s.tier] += 1;
  assert.deepStrictEqual(c, { 1: 159, 2: 61, 3: 11 });
});

test('SD-3 曲谱统计：706 条，qq_sheet 136 / qq_chord 127 / jitashe 443，官方谱 127 首', () => {
  const cnt = { qq_sheet: 0, qq_chord: 0, jitashe: 0 };
  let total = 0;
  for (const s of SONGS) {
    assert.strictEqual(s.sheets.length, s.sheetCount, `${s.id} sheetCount 应为 ${s.sheetCount}`);
    for (const sh of s.sheets) { cnt[sh.source] += 1; total += 1; }
  }
  assert.strictEqual(total, 706, '曲谱总数应为 706');
  assert.deepStrictEqual(cnt, { qq_sheet: 136, qq_chord: 127, jitashe: 443 });
  assert.strictEqual(SONGS.filter((s) => s.hasQQChord).length, 127, '官方谱（智能和弦谱）曲目应为 127');
  // hasQQChord 必须与 sheets 中真实存在的智能和弦谱一致
  for (const s of SONGS) {
    assert.strictEqual(s.hasQQChord, s.sheets.some((sh) => sh.source === 'qq_chord'), `${s.id} hasQQChord 与实际曲谱不符`);
  }
});

test('SD-4 单元划分：19 个、层级一致、各单元曲目数与 songCount 相同且合计 231', () => {
  assert.strictEqual(UNITS.length, 19, '课程单元应为 19 个');
  const unitMap = new Map(UNITS.map((u) => [u.id, u]));
  for (const s of SONGS) {
    assert.ok(s.unit, `${s.id} unit 不能为空`);
    const u = unitMap.get(s.unit);
    assert.ok(u, `${s.id} 的 unit ${s.unit} 必须在 UNITS 中存在`);
    assert.strictEqual(u.tier, s.tier, `${s.id} unit.tier 必须与 song.tier 相同`);
  }
  let sum = 0;
  for (const u of UNITS) {
    const n = songsOfUnit(u.id).length;
    assert.strictEqual(n, u.songCount, `单元 ${u.id} 实际 ${n} 首，songCount 声明 ${u.songCount}`);
    sum += n;
  }
  assert.strictEqual(sum, 231, '各单元曲目合计应为 231');
  assert.strictEqual(UNITS.reduce((a, u) => a + u.songCount, 0), 231);
});

test('SD-5 查询纯函数：songById / searchSongs 语义正确', () => {
  assert.strictEqual(songById('song-001').title, '送别');
  const hit = searchSongs('晴天').map((s) => s.id);
  assert.ok(hit.includes('song-199'), '搜索「晴天」应命中 song-199');
  assert.strictEqual(searchSongs('').length, 231, '空关键词返回全量');
  assert.strictEqual(searchSongs('   ').length, 231, '纯空格关键词返回全量');
  assert.strictEqual(songById('nope'), null, '未命中返回 null');
  assert.strictEqual(songById(null), null);
  // 大小写与首尾空格归一化
  assert.ok(searchSongs('  love  ').length > 0, '关键词应 trim + 小写匹配');
  assert.ok(searchSongs('LOVE').length > 0);
});

test('SD-6 曲谱链接规范：全部 https 且不含空白', () => {
  for (const s of SONGS) {
    for (const sh of s.sheets) {
      assert.match(sh.url, /^https:\/\//, `${s.id} 的曲谱链接必须以 https:// 开头`);
      assert.ok(!/\s/.test(sh.url), `${s.id} 的曲谱链接不得包含空白字符`);
    }
  }
});

test('SD-7 顺序即难度：编号升序层级单调不减、id 不重复、sheets 从简到难', () => {
  const list = orderedSongs();
  for (let i = 1; i < list.length; i++) {
    assert.ok(list[i].tier >= list[i - 1].tier, `第 ${list[i].no} 首层级不应低于前一首`);
  }
  assert.strictEqual(new Set(SONGS.map((s) => s.id)).size, 231, 'id 不得重复');
  for (const s of SONGS) {
    let prev = null;
    for (const sh of s.sheets) {
      const key = sh.difficulty == null ? Infinity : sh.difficulty;
      if (prev !== null) assert.ok(key >= prev, `${s.id} 的曲谱未按从简到难排序`);
      prev = key;
    }
  }
});
