/* ============================================================
   六弦工坊 V4.2.1 · 跨模块端到端回归：演奏 → 打卡 → 解锁
   ------------------------------------------------------------
   BUG-04 的核心盲区：gp/state.js（写侧）与 modules/songbook.js（读侧）
   各自有单测且全绿，但两侧契约不一致 → 真实链路断裂。
   本文件把「写」和「读」放在同一进程里串联验证：
     Store.addHistory() → PracticeStore.addSession() → practicedSongIds()
     → unitProgress() / isUnitUnlocked() / songbookStats()
   ============================================================ */
'use strict';
import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

/* 先装 DOM shim，再 import 依赖 DOM 的模块（旧练习页 song-practice 需要 document） */
await imp('test/_gp-dom.mjs');

const { Store, normSongId } = await imp('assets/js/gp/state.js');
const sb = await imp('assets/js/modules/songbook.js');
const { SONGS, songsOfUnit, UNITS } = await imp('assets/js/data/songlist-data.js');

/** 用一组 FlexSong 定义驱动一次“完整演奏”，返回落到的 sessions 数组 */
function playAndCollect(songId, extra) {
  const sessions = [];
  globalThis.PracticeStore = { addSession: (r) => { sessions.push(r); return r; } };
  try {
    Store.addHistory(Object.assign({
      ts: Date.now(), songId, songTitle: '测试曲', instrument: 'acoustic-guitar',
      score: 800, accuracy: 92, maxStreak: 12, passed: true, durationSec: 75,
      notes: { perfect: 20, good: 3, off: 1, miss: 0 },
    }, extra || {}));
  } finally {
    delete globalThis.PracticeStore;
  }
  return sessions;
}

test('E2E-1 演奏完成后曲库必须点亮该曲（gp- 前缀 id 也要归一）', () => {
  const sessions = playAndCollect('gp-song-014');
  assert.strictEqual(sessions.length, 1, '应写入 1 条会话');
  const ids = sb.practicedSongIds(sessions);
  assert.ok(ids.has('song-014'), `《稻香》演奏后必须点亮 song-014，实际集合 ${[...ids]}`);
  assert.ok(!ids.has('gp-song-014'), '不得把 gp- 前缀 id 写进集合');
});

test('E2E-2 曲库侧原始 id（song-xxx）演奏同样正常点亮', () => {
  const sessions = playAndCollect('song-199');
  const ids = sb.practicedSongIds(sessions);
  assert.ok(ids.has('song-199'), '《晴天》演奏后必须点亮 song-199');
});

test('E2E-3 写入记录满足弹唱打卡契约：module=songbook、accuracy=null', () => {
  const [rec] = playAndCollect('gp-song-014');
  assert.strictEqual(rec.module, 'songbook', 'module 必须是 songbook（曲库读侧契约）');
  assert.strictEqual(rec.accuracy, null, '弹唱 accuracy 恒 null');
  assert.strictEqual(rec.durationMs, 75000);
  assert.ok(SONGS.some((s) => s.id === rec.meta.songId), 'meta.songId 必须能在 SONGS 中命中');
  assert.deepStrictEqual(rec.meta.notes, { perfect: 20, good: 3, off: 1, miss: 0 });
});

test('E2E-4 unit/tier 从曲库权威字典回填（不再恒为空）', () => {
  const [rec] = playAndCollect('gp-song-014');          // 稻香 → L1.1 / tier 1
  assert.strictEqual(rec.meta.unit, 'L1.1');
  assert.strictEqual(rec.meta.tier, 1);
  const [rec2] = playAndCollect('gp-song-199');         // 晴天 → L2.4 / tier 2
  assert.strictEqual(rec2.meta.unit, 'L2.4');
  assert.strictEqual(rec2.meta.tier, 2);
});

test('E2E-5 单元解锁率随演奏打卡变化（核心闭环真正接通）', () => {
  const target = SONGS.find((s) => s.unit === 'L1.1');
  assert.ok(target, '应存在 L1.1 的曲目');
  const sessions = [];
  globalThis.PracticeStore = { addSession: (r) => { sessions.push(r); return r; } };
  try {
    const before = sb.isUnitUnlocked('L1.2', sb.practicedSongIds(sessions));
    assert.strictEqual(before, false, '未打卡时下一单元应锁定');
    /* L1.1 共 14 首，阈值 0.4 → 至少 6 首 */
    for (const s of songsOfUnit('L1.1').slice(0, 6)) {
      Store.addHistory({ ts: Date.now(), songId: 'gp-' + s.id, songTitle: s.title,
        score: 100, maxStreak: 1, passed: true, durationSec: 10 });
    }
    const practiced = sb.practicedSongIds(sessions);
    assert.strictEqual(practiced.size, 6, '应记录 6 首已练');
    const prog = sb.unitProgress('L1.1', practiced);
    assert.strictEqual(prog.done, 6, '单元完成数应为 6');
    assert.ok(prog.rate >= sb.UNLOCK_RATE, `完成率 ${prog.rate} 应达阈值 ${sb.UNLOCK_RATE}`);
    assert.strictEqual(sb.isUnitUnlocked('L1.2', practiced), true, '达成阈值后 L1.2 必须解锁');
  } finally {
    delete globalThis.PracticeStore;
  }
});

test('E2E-6 统计口径统计到演奏会话（不再因为 module 名被漏掉）', () => {
  const sessions = playAndCollect('gp-song-014', { durationSec: 120 });
  const st = sb.songbookStats(sessions, Date.now());
  assert.strictEqual(st.practicedCount, 1, '去重曲目数应为 1');
  assert.strictEqual(st.byTier[1].done, 1, '稻香 tier=1，分层完成数应为 1');
  assert.ok(st.totalDurationMs >= 120000, `时长应累加，实际 ${st.totalDurationMs}`);
});

/* ============================================================
   BUG-08：旧弹唱练习页只能是转发层，不得露出自己的 UI
   ============================================================ */
test('BUG-08 旧练习页存在 SongPlay 时必须转发到演奏视图并带上曲目 id', async () => {
  const { SongPractice } = await imp('assets/js/modules/song-practice.js');
  const calls = { prepare: null, go: [] };
  globalThis.SongPlay = { prepare: (id) => { calls.prepare = id; } };
  globalThis.go = (r) => { calls.go.push(r); };
  try {
    SongPractice.prepare('song-014');
    SongPractice.enter();
  } finally {
    delete globalThis.SongPlay; delete globalThis.go;
  }
  assert.strictEqual(calls.prepare, 'song-014', '必须把曲目 id 交给 SongPlay');
  assert.deepStrictEqual(calls.go, ['songPlay'], '必须一次性转到 songPlay 路由');
});

test('BUG-08 曲目不存在时不转发，也不进入演奏视图', async () => {
  const { SongPractice } = await imp('assets/js/modules/song-practice.js');
  const calls = { prepare: null, go: [] };
  globalThis.SongPlay = { prepare: (id) => { calls.prepare = id; } };
  globalThis.go = (r) => { calls.go.push(r); };
  try {
    SongPractice.prepare('song-does-not-exist');
    SongPractice.enter();
  } finally {
    delete globalThis.SongPlay; delete globalThis.go;
  }
  assert.strictEqual(calls.prepare, null, '未知曲目不得转发');
  assert.deepStrictEqual(calls.go, []);
});

test('E2E-7 normSongId 幂等且只剥离 gp-song- 前缀', () => {
  assert.strictEqual(normSongId('gp-song-001'), 'song-001');
  assert.strictEqual(normSongId('song-001'), 'song-001');
  assert.strictEqual(normSongId('pd-twinkle'), 'pd-twinkle');
  assert.strictEqual(normSongId(''), '');
  assert.strictEqual(normSongId(null), '');
});

test('E2E-8 未知曲目（如 pd-twinkle）不污染曲库打卡集合', () => {
  const sessions = playAndCollect('pd-twinkle');
  const ids = sb.practicedSongIds(sessions);
  /* 公有领域旋律曲不在 SONGS 中，写库后 meta.songId 也是 pd-twinkle，
     不应影响既有曲卡的已练判定 */
  assert.ok(![...ids].some((i) => /^song-\d+$/.test(i)), '不得伪造 song-xxx 打卡');
  assert.ok(sessions[0].module === 'songbook', '仍按 songbook 契约写入');
  void UNITS;
});
