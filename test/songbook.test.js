/* ============================================================
   六弦工坊 V4.0 · 弹唱曲库模块测试（T1 曲库浏览 / T2 课程单元）
   ------------------------------------------------------------
   覆盖 SB-1 ~ SB-6 纯逻辑：
     SB-1 已打卡曲目去重（module==='songbook' 且 meta.songId）
     SB-2 单元进度 {done,total,rate}
     SB-3 解锁规则（首单元恒开 / 上一单元 ≥40% / 自由模式全开）
     SB-4 层级 + 关键词筛选
     SB-5 打卡记录组装（accuracy 恒 null，见 song-practice 用例）
     SB-6 曲库聚合统计（去重计数/时长/分层完成率/近 7 天）
   另校验：常量口径（UNLOCK_RATE/WARMUP_BPM/SEARCH_DEBOUNCE_MS）、
   i18n key 覆盖、DOM 侧事件委托与一次插入的源码约束。
   ============================================================ */
'use strict';
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

const { SONGS, UNITS, songsOfUnit, songById } = await imp('assets/js/data/songlist-data.js');
const SB = await imp('assets/js/modules/songbook.js');

const {
  UNLOCK_RATE, WARMUP_BPM, SEARCH_DEBOUNCE_MS,
  practicedSongIds, unitProgress, isUnitUnlocked, filterSongs, songbookStats
} = SB;

/* ---------- 造数据辅助 ---------- */
const mkSession = (songId, opts = {}) => ({
  module: 'songbook',
  startedAt: opts.startedAt ?? 1000,
  endedAt: opts.endedAt ?? 61000,
  durationMs: opts.durationMs ?? 60000,
  accuracy: null,
  meta: { songId, unit: opts.unit || '', tier: opts.tier ?? null }
});
const firstNofUnit = (unitId, n) => songsOfUnit(unitId).slice(0, n).map((s) => s.id);

/* ============================================================
   常量口径
   ============================================================ */
test('SB-0 常量口径符合手册（解锁率 40% / 热身 70BPM / 防抖 200ms）', () => {
  assert.strictEqual(UNLOCK_RATE, 0.4, '§T2.2 解锁阈值 40%');
  assert.strictEqual(WARMUP_BPM, 70, '§T2.3 单元热身推荐 70 BPM');
  assert.strictEqual(SEARCH_DEBOUNCE_MS, 200, '搜索防抖 200ms');
});

/* ============================================================
   SB-1 已打卡曲目集合
   ============================================================ */
test('SB-1 已打卡曲目去重，且忽略非曲库会话与缺 songId 的会话', () => {
  const list = [
    mkSession('song-001'),
    mkSession('song-001'),                       // 同曲多次打卡只算 1 首
    mkSession('song-002'),
    { module: 'metro', meta: { songId: 'song-999' } },   // 非曲库模块
    { module: 'songbook', meta: {} },                    // 缺 songId
    { module: 'songbook' },                              // 缺 meta
    null                                                  // 脏数据
  ];
  const ids = practicedSongIds(list);
  assert.deepStrictEqual([...ids].sort(), ['song-001', 'song-002']);
});

test('SB-1 空/非数组入参返回空集合，不抛错', () => {
  assert.strictEqual(practicedSongIds(null).size, 0);
  assert.strictEqual(practicedSongIds(undefined).size, 0);
  assert.strictEqual(practicedSongIds([]).size, 0);
  assert.strictEqual(practicedSongIds('oops').size, 0);
});

/* ============================================================
   SB-2 单元进度
   ============================================================ */
test('SB-2 单元进度 done/total/rate 计算正确', () => {
  const unit = UNITS[0];                       // L1.1，14 首
  const practiced = new Set(firstNofUnit(unit.id, 7));
  const p = unitProgress(unit.id, practiced);
  assert.strictEqual(p.total, unit.songCount);
  assert.strictEqual(p.done, 7);
  assert.ok(Math.abs(p.rate - 7 / unit.songCount) < 1e-9);
});

test('SB-2 单元不存在 / 空集合：total=0 且 rate=0（不除零）', () => {
  assert.deepStrictEqual(unitProgress('L9.9', new Set()), { done: 0, total: 0, rate: 0 });
  const p = unitProgress(UNITS[0].id, new Set());
  assert.strictEqual(p.done, 0);
  assert.strictEqual(p.rate, 0);
});

test('SB-2 practiced 支持 Set 与数组两种入参', () => {
  const ids = firstNofUnit(UNITS[0].id, 3);
  const a = unitProgress(UNITS[0].id, new Set(ids));
  const b = unitProgress(UNITS[0].id, ids);
  assert.strictEqual(a.done, b.done);
});

/* ============================================================
   SB-3 解锁规则
   ============================================================ */
test('SB-3 首个单元恒解锁，后续单元默认锁定', () => {
  const empty = new Set();
  assert.strictEqual(isUnitUnlocked(UNITS[0].id, empty), true, 'L1.1 恒解锁');
  assert.strictEqual(isUnitUnlocked(UNITS[1].id, empty), false, '未练时 L1.2 应锁定');
  assert.strictEqual(isUnitUnlocked('L9.9', empty), false, '不存在的单元不解锁');
});

test('SB-3 上一单元完成 40% 即解锁下一单元（39% 仍锁定）', () => {
  const prev = UNITS[0];                                  // 14 首
  const justBelow = Math.floor(prev.songCount * UNLOCK_RATE) - 1;  // 5 < 5.6
  const justEnough = Math.ceil(prev.songCount * UNLOCK_RATE);      // 6 ≥ 5.6
  assert.strictEqual(unitProgress(prev.id, new Set(firstNofUnit(prev.id, justBelow))).rate >= UNLOCK_RATE, false);
  assert.strictEqual(isUnitUnlocked(UNITS[1].id, new Set(firstNofUnit(prev.id, justBelow))), false);
  assert.strictEqual(isUnitUnlocked(UNITS[1].id, new Set(firstNofUnit(prev.id, justEnough))), true);
});

test('SB-3 自由模式解锁全部单元（含不存在的单元返回 false 除外）', () => {
  const empty = new Set();
  for (const u of UNITS) {
    assert.strictEqual(isUnitUnlocked(u.id, empty, { freeMode: true }), true, `${u.id} 自由模式应解锁`);
  }
  assert.strictEqual(isUnitUnlocked('L9.9', empty, { freeMode: true }), false, '未知单元不因自由模式而解锁');
});

/* ============================================================
   SB-4 筛选
   ============================================================ */
test('SB-4 tier=0 返回全部；tier 过滤后总数与层级分布一致', () => {
  assert.strictEqual(filterSongs(SONGS, { tier: 0 }).length, SONGS.length);
  assert.strictEqual(filterSongs(SONGS, { tier: 1 }).length, SONGS.filter((s) => s.tier === 1).length);
  assert.strictEqual(filterSongs(SONGS, { tier: 3 }).length, SONGS.filter((s) => s.tier === 3).length);
});

test('SB-4 关键词命中曲名或歌手，空关键词不减少结果', () => {
  const all = filterSongs(SONGS, { tier: 0, kw: '   ' });
  assert.strictEqual(all.length, SONGS.length, '空白关键词等同不过滤');
  const hit = filterSongs(SONGS, { tier: 0, kw: '晴天' });
  assert.ok(hit.length >= 1);
  assert.ok(hit.every((s) => (s.title + s.artist).toLowerCase().includes('晴天')));
  /* 大小写不敏感 */
  const song = songById('song-001');
  const byArtist = filterSongs(SONGS, { tier: 0, kw: String(song.artist).toUpperCase() });
  assert.ok(byArtist.some((s) => s.id === song.id), '大写歌手名应能命中');
});

test('SB-4 无命中返回空数组，不抛错', () => {
  assert.deepStrictEqual(filterSongs(SONGS, { tier: 0, kw: 'zzz-not-exist-zzz' }), []);
  assert.deepStrictEqual(filterSongs(null, { tier: 2 }), SONGS.filter((s) => s.tier === 2));
});

/* V4.2.3 方案 D：chart:'real' 只看有真实谱面（omr/melody）的曲目 */
test('SB-4 chart:"real" 只保留真实谱面曲目，且与 tier/kw 组合生效', async () => {
  const cat = await imp('assets/js/gp/catalog.js');
  const { hasRealChart } = cat;
  const real = filterSongs(SONGS, { tier: 0, chart: 'real' });
  const expected = SONGS.filter((s) => hasRealChart(s.id));
  assert.strictEqual(real.length, expected.length, '应恰好覆盖全部真实谱面曲目');
  /* F-1 双口径锁定（勿改产品数据）：曲库页走 SONGS（231 首）→ 24 首 omr；
     演奏目录 listDefs()（236 首，含 5 首公有领域旋律）→ 29 首。两个口径都对。 */
  assert.strictEqual(real.length, 24, '曲库页口径（SONGS）应为 24 首真实谱面');
  const catalogReal = cat.listDefs().filter((d) => hasRealChart(d.id));
  assert.strictEqual(catalogReal.length, 29, '演奏目录口径（listDefs，含 5 首旋律）应为 29 首');
  assert.ok(real.length < SONGS.length, '应为真子集');
  assert.ok(real.every((s) => hasRealChart(s.id)), '结果必须全部有真实谱面');
  const combined = filterSongs(SONGS, { tier: 1, chart: 'real' });
  assert.ok(combined.every((s) => s.tier === 1 && hasRealChart(s.id)), '与 tier 组合');
  const noOpt = filterSongs(SONGS, { tier: 0 });
  assert.strictEqual(noOpt.length, SONGS.length, '不传 chart 不过滤（向后兼容）');
});

/* ============================================================
   SB-6 曲库聚合统计
   ============================================================ */
test('SB-6 去重计数 / 时长累加 / 分层完成率 / 近 7 天', () => {
  const now = 1_700_000_000_000;
  const WEEK = 7 * 864e5;
  const s1 = songById('song-001'), s3 = SONGS.find((s) => s.tier === 3);
  const list = [
    mkSession(s1.id, { startedAt: now - 60000, endedAt: now, durationMs: 60000 }),
    mkSession(s1.id, { startedAt: now - 60000, endedAt: now, durationMs: 60000 }),  // 重复打卡
    mkSession(s3.id, { startedAt: now - 9 * 864e5, endedAt: now - 9 * 864e5 + 30000, durationMs: 30000 })
  ];
  const st = songbookStats(list, now);
  assert.strictEqual(st.practicedCount, 2, '同曲多次打卡只算 1 首');
  assert.strictEqual(st.total, SONGS.length);
  assert.strictEqual(st.totalDurationMs, 150000, '时长累加 60s+60s+30s');
  assert.strictEqual(st.last7DaysMs, 120000, '9 天前的记录不计入近 7 天');
  assert.strictEqual(st.byTier[1].done, 1);
  assert.strictEqual(st.byTier[3].done, 1);
  assert.strictEqual(st.byTier[2].done, 0);
  assert.ok(Math.abs(st.byTier[1].rate - 1 / st.byTier[1].total) < 1e-9);
  assert.ok(WEEK === 7 * 864e5);
});

test('SB-6 空数据：计数 0、时长 0、完成率 0，不除零', () => {
  const st = songbookStats([], Date.now());
  assert.strictEqual(st.practicedCount, 0);
  assert.strictEqual(st.totalDurationMs, 0);
  assert.strictEqual(st.last7DaysMs, 0);
  for (const t of [1, 2, 3]) assert.strictEqual(st.byTier[t].rate, 0);
  const st2 = songbookStats(null, Date.now());
  assert.strictEqual(st2.practicedCount, 0);
});

test('SB-6 未知曲目 id 不计入分层完成率', () => {
  const st = songbookStats([mkSession('song-does-not-exist')], Date.now());
  assert.strictEqual(st.practicedCount, 1, '去重计数仍按会话统计');
  assert.strictEqual(st.byTier[1].done + st.byTier[2].done + st.byTier[3].done, 0);
});

/* ============================================================
   DOM 侧工程约束（源码级，防止回退）
   ============================================================ */
const SB_SRC = fs.readFileSync(path.join(ROOT, 'assets/js/modules/songbook.js'), 'utf8');

test('SB-P1 曲库列表使用事件委托，不为每张曲卡单独绑定监听器', () => {
  assert.ok(/root\.addEventListener\('click'/.test(SB_SRC), '容器级 click 委托');
  assert.ok(!/\.forEach\(\(?:[^)]*\)\s*=>\s*[^;]*addEventListener\('click'/.test(SB_SRC),
    '不得在曲卡循环内逐个绑定 click');
});

test('SB-P2 列表一次插入（DocumentFragment），避免逐卡 reflow', () => {
  assert.ok(/createDocumentFragment\(\)/.test(SB_SRC));
  assert.ok(/box\.appendChild\(frag\)/.test(SB_SRC));
});

test('SB-P3 每次进入路由重读打卡状态（打卡回来即时显示已练）', () => {
  assert.ok(/onRouteEnter\.songbook\s*=/.test(SB_SRC));
  assert.ok(/this\._practiced\s*=\s*practicedSongIds\(readSessions\(\)\)/.test(SB_SRC));
});

test('SB-P4 数据自检失败走兜底卡并告警，不静默渲染坏数据', () => {
  assert.ok(/SonglistData\.validate\(\)/.test(SB_SRC));
  assert.ok(/console\.warn\(/.test(SB_SRC));
  assert.ok(/songbook\.dataError/.test(SB_SRC));
});

test('SB-P5 曲谱外链一律 rel="noopener noreferrer" 且 target=_blank', () => {
  const links = SB_SRC.match(/<a [^>]*href="\$\{esc\(sh\.url\)\}"[^>]*>/g) || [];
  assert.ok(links.length >= 1, '曲谱链接由模板产出');
  for (const a of links) {
    assert.ok(/target="_blank"/.test(a) && /rel="noopener noreferrer"/.test(a), a);
  }
});

/* ============================================================
   i18n key 覆盖：模块引用的 key 必须在四语词表中都存在
   ============================================================ */
test('SB-I1 曲库/练习模块引用的 i18n key 四语齐全', async () => {
  const src = SB_SRC + fs.readFileSync(path.join(ROOT, 'assets/js/modules/song-practice.js'), 'utf8');
  const used = new Set();
  const addKey = (k) => { if (k && !k.endsWith('.')) used.add(k); };   // 跳过拼接前缀
  for (const m of src.matchAll(/T\(\s*'([a-zA-Z0-9_.]+)'\s*\)/g)) addKey(m[1]);
  for (const m of src.matchAll(/TF\(\s*'([a-zA-Z0-9_.]+)'/g)) addKey(m[1]);
  /* 动态拼接的 key：songbook.tier.N / songbook.step.N */
  for (const t of [1, 2, 3]) used.add('songbook.tier.' + t);
  for (const s of [1, 2, 3, 4]) used.add('songbook.step.' + s);
  assert.ok(used.size > 20, `应覆盖足够多的 key，实际 ${used.size}`);

  for (const lang of ['zh-CN', 'en', 'ja', 'ko']) {
    const { DICT } = await imp(`assets/js/i18n/${lang}.js`);
    const miss = [...used].filter((k) => !(k in DICT));
    assert.deepStrictEqual(miss, [], `${lang} 缺失 key：${miss.join(', ')}`);
  }
});
