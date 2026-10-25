/* ============================================================
   六弦工坊 V4.1 · 弹唱演奏（GuitarPicker note-highway）测试
   ------------------------------------------------------------
   GP-1 曲库：236 首（231 和弦弹唱 + 5 首公有领域旋律），真实歌词覆盖
   GP-2 展开：和弦曲目生成合法音符；旋律曲目解析出正确音高与时序
   GP-3 元数据：BPM/时长/歌词时间单调、制作信息已剔除
   GP-4 无头挂载：和弦曲与旋律曲都能渲染且 teardown 不抛错
   GP-5 宿主适配：Store 落到 gsStore、成绩写入 PracticeStore
   GP-6 资源一致性：gp 模块与 CSS 全部纳入 SW 预缓存
   ============================================================ */
'use strict';
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

/* 先装 DOM shim，再 import 依赖 DOM 的模块 */
await imp('test/_gp-dom.mjs');

const { GP_CHORD_SONGS, GP_MELODY_SONGS, GP_PROVENANCE } = await imp('assets/js/gp/songs.js');
const { parseMelody, validateSong, songDuration, songParts, pickPart } = await imp('assets/js/gp/song-format.js');
const cat = await imp('assets/js/gp/catalog.js');
const { midiToName, midiToFret, INSTRUMENTS } = await imp('assets/js/gp/notes.js');

/* ============================================================
   GP-1 曲库规模与真实数据来源
   ============================================================ */
test('GP-1 曲库含 231 首和弦弹唱 + 5 首公有领域旋律', () => {
  assert.strictEqual(GP_CHORD_SONGS.length, 231, '按需求手册 231 首');
  assert.ok(GP_MELODY_SONGS.length >= 5, '公有领域旋律曲目');
  assert.strictEqual(cat.defCount(), GP_CHORD_SONGS.length + GP_MELODY_SONGS.length);
});

test('GP-1 歌词为 QQ 音乐真实抓取（≥225 首带毫秒时间戳）', () => {
  const withLrc = GP_CHORD_SONGS.filter((s) => (s.lyrics || []).length > 0);
  assert.ok(withLrc.length >= 225, `实际 ${withLrc.length} 首带歌词`);
  const src = withLrc.filter((s) => s.lyricSource === 'qqmusic');
  assert.strictEqual(src.length, withLrc.length, '歌词来源须全部标记为 qqmusic');
  // 时间戳必须是真实浮点秒（不是整行 0）
  const times = withLrc[0].lyrics.map((l) => l.time);
  assert.ok(times.some((t) => t > 0 && !Number.isInteger(t)), '应含非整数毫秒级时间戳');
});

test('GP-1 歌词已剔除「词/曲/编曲」等制作信息与标题行', () => {
  const bad = GP_CHORD_SONGS.flatMap((s) => (s.lyrics || []).map((l) => l.text))
    .filter((t) => /^\s*(词|曲|编曲|制作人|专辑|混音|吉他|钢琴|和声|监制|OP|SP|出品)\s*[:：]/.test(t));
  assert.deepStrictEqual(bad.slice(0, 5), [], '不应残留制作信息行');
});

test('GP-1 provenance 明确标注每类数据的来源（可审计）', () => {
  assert.ok(GP_PROVENANCE.counts.chordSongs === 231);
  assert.ok(/QQ/.test(GP_PROVENANCE.lyricSource), '歌词来源标注 QQ 音乐');
  assert.ok(/模板|和声/.test(GP_PROVENANCE.harmonySource), '和声来源标注为模板');
  assert.ok(/公有领域|传统/.test(GP_PROVENANCE.melodySource), '旋律来源标注公有领域');
});

/* ============================================================
   GP-2 展开：和弦曲目 / 旋律曲目
   ============================================================ */
test('GP-2 和弦曲目展开出合法音符（每小节 4 个扫弦、和弦音 3-4 个）', () => {
  const song = cat.findSong('gp-song-001');
  assert.ok(song, '应能按 id 展开');
  assert.ok(song.notes.length > 0);
  assert.ok(song.notes.every((n) => Array.isArray(n.midi) && n.midi.length >= 3 && n.midi.length <= 4));
  assert.ok(song.notes.every((n) => n.midi.every((m) => m >= 40 && m <= 72)), '音高须落在吉他音域');
  assert.ok(song.notes.every((n) => n.chord === true), '和弦曲目标记 chord');
  const v = validateSong(song);
  assert.deepStrictEqual(v.errors, [], '展开结果须通过 schema 校验');
});

test('GP-2 音符时序单调递增且落在合理时长内', () => {
  const song = cat.findSong('gp-song-050');
  let prev = -1;
  for (const n of song.notes) {
    assert.ok(n.time >= prev - 1e-6, 'time 不得回退');
    assert.ok(n.dur > 0);
    prev = n.time;
  }
  const dur = songDuration(song);
  assert.ok(dur > 30 && dur < 400, `时长应合理，实际 ${dur}s`);
});

test('GP-2 旋律曲目解析出真实公有领域旋律（小星星）', () => {
  const song = cat.findSong('pd-twinkle');
  assert.ok(song.notes.length >= 40, `小星星应有足够音符，实际 ${song.notes.length}`);
  // 首音 C4=60，第二音也是 C4，第三音 G4=67
  assert.deepStrictEqual(song.notes[0].midi, [60]);
  assert.deepStrictEqual(song.notes[1].midi, [60]);
  assert.deepStrictEqual(song.notes[2].midi, [67]);
  assert.ok(song.notes.every((n) => n.midi.length === 1), '旋律曲目为单音');
});

test('GP-2 展开结果被缓存，重复取同一首不重建', () => {
  const a = cat.findSong('gp-song-077');
  const b = cat.findSong('gp-song-077');
  assert.strictEqual(a, b, '应为同一对象（缓存命中）');
});

test('GP-2 曲库页的 song-001 与演奏库 gp-song-001 互通', () => {
  assert.ok(cat.defById('song-001'), 'song-001 应能映射到 gp-song-001');
  assert.ok(cat.findSong('song-001'), 'findSong 亦应兼容');
  assert.strictEqual(cat.defById('nope-not-exist'), null);
});

/* ============================================================
   GP-3 元数据与乐理
   ============================================================ */
test('GP-3 BPM/时长/层级齐备，歌词时间单调不减', () => {
  for (const s of GP_CHORD_SONGS.slice(0, 40)) {
    assert.ok(s.bpm >= 60 && s.bpm <= 200, `BPM 越界：${s.title}`);
    assert.ok(s.durationSec > 0, `时长缺失：${s.title}`);
    let prev = -1;
    for (const l of s.lyrics || []) {
      assert.ok(l.time >= prev - 1e-6, `歌词时间回退：${s.title}`);
      prev = l.time;
    }
  }
});

test('GP-3 和弦音可用宿主乐理命名，且能落到指板品位', () => {
  const song = cat.findSong('gp-song-001');
  const midis = song.notes[0].midi;
  const names = midis.map((m) => midiToName(m).name);
  assert.ok(names.every((n) => typeof n === 'string' && n.length));
  const frets = midis.map((m) => midiToFret(m, 'acoustic-guitar'));
  assert.ok(frets.every((f) => f == null || (f.fret >= 0 && f.fret <= 12)), '品位应在 0-12 内');
  assert.ok(INSTRUMENTS['acoustic-guitar'], '乐器表应含吉他');
});

test('GP-3 pickPart 选中吉他声部，其余声部交给伴奏', () => {
  const song = cat.findSong('pd-twinkle');
  const { parts, index, lead } = pickPart(song, 'acoustic-guitar');
  assert.ok(parts.length >= 1);
  assert.strictEqual(lead.instrument, 'acoustic-guitar');
  assert.strictEqual(index, 0);
  assert.strictEqual(songParts(song)[0].notes.length, song.notes.length);
});

/* ============================================================
   GP-4 无头挂载：和弦曲 + 旋律曲
   ============================================================ */
test('GP-4 演奏视图可无头挂载和弦曲目并拆卸（不抛错、有内容）', async () => {
  const play = (await imp('assets/js/gp/play.js')).default;
  const { El } = await imp('test/_gp-dom.mjs');
  const root = new El('div');
  const cleanup = await play({ el: root, params: ['gp-song-001'], navigate: () => {} });
  assert.ok(root.children.length > 0, '应渲染出内容');
  assert.strictEqual(typeof cleanup, 'function', '必须返回 teardown');
  cleanup();
});

test('GP-4 演奏视图可无头挂载旋律曲目（与参考站 bi-twinkle 同型）', async () => {
  const play = (await imp('assets/js/gp/play.js')).default;
  const { El } = await imp('test/_gp-dom.mjs');
  const root = new El('div');
  const cleanup = await play({ el: root, params: ['pd-twinkle'], navigate: () => {} });
  assert.ok(root.children.length > 0);

  /* 与参考站一致的结构：play-shell > (play-stage > canvas + overlay) + play-controls */
  const shell = root.children[0];
  assert.strictEqual(shell.className, 'play-shell', '根容器应为 play-shell');
  assert.ok(shell.querySelector('.play-stage'), '应含演奏舞台');
  assert.ok(shell.querySelector('CANVAS'), '应含 highway 画布');
  assert.ok(shell.querySelector('.play-overlay'), '应含 HUD 浮层');
  assert.ok(shell.querySelector('.play-controls'), '应含控制条');
  assert.ok(shell.querySelector('.healthbar-big'), '应含血条');
  assert.ok(shell.querySelector('.killfeed'), '应含判定流水');
  assert.ok(shell.querySelector('.lyric-line'), '应含歌词行');
  cleanup();
});

test('GP-4 曲目不存在时渲染 not-found，不抛错', async () => {
  const play = (await imp('assets/js/gp/play.js')).default;
  const { El } = await imp('test/_gp-dom.mjs');
  const root = new El('div');
  const out = await play({ el: root, params: ['no-such-song'], navigate: () => {} });
  assert.ok(root.children.length > 0, '应给出兜底提示');
  assert.strictEqual(typeof out, 'undefined', 'not-found 分支无 teardown');
});

/* ============================================================
   GP-5 宿主适配
   ============================================================ */
test('GP-5 Store 适配层默认设置完整、可写可读', async () => {
  const { Store } = await imp('assets/js/gp/state.js');
  const s = Store.settings();
  assert.strictEqual(s.a4, 440);
  assert.strictEqual(s.instrument, 'acoustic-guitar');
  assert.strictEqual(typeof s.band, 'boolean');
  Store.setSetting('noteSpeed', 1.5);
  assert.strictEqual(Store.settings().noteSpeed, 1.5);
  Store.setSetting('noteSpeed', 1);
});

test('GP-5 成绩写入宿主 PracticeStore（module=songplay，accuracy 归一化）', async () => {
  const { Store } = await imp('assets/js/gp/state.js');
  let captured = null;
  globalThis.PracticeStore = { addSession: (r) => { captured = r; return r; } };
  Store.addHistory({
    ts: Date.now(), songId: 'gp-song-001', songTitle: '送别', instrument: 'acoustic-guitar',
    score: 1200, accuracy: 88, maxStreak: 9, passed: true, durationSec: 60,
    notes: { perfect: 10, good: 2, off: 1, miss: 0 },
  });
  assert.ok(captured, '应调用 PracticeStore.addSession');
  assert.strictEqual(captured.module, 'songplay');
  assert.strictEqual(captured.accuracy, 0.88, 'accuracy 归一化为 0-1');
  assert.strictEqual(captured.durationMs, 60000);
  assert.strictEqual(captured.meta.songId, 'gp-song-001');
  assert.strictEqual(captured.meta.passed, true);
  assert.strictEqual(captured.meta.notes.perfect, 10);
  delete globalThis.PracticeStore;
});

/* ============================================================
   GP-6 资源一致性（离线可用）
   ============================================================ */
test('GP-6 所有 gp 模块与 gp.css 都进了 SW 预缓存清单', () => {
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const jsFiles = fs.readdirSync(path.join(ROOT, 'assets/js/gp')).filter((f) => f.endsWith('.js'));
  for (const f of jsFiles) {
    assert.ok(sw.includes(`./assets/js/gp/${f}`), `SW 缺少 ${f}`);
  }
  assert.ok(sw.includes('./assets/css/gp.css'), 'SW 缺少 gp.css');
  assert.ok(sw.includes('./assets/js/modules/song-play.js'), 'SW 缺少 song-play.js');
});

test('GP-6 演奏视图已接入路由与主入口', () => {
  const router = fs.readFileSync(path.join(ROOT, 'assets/js/core/router.js'), 'utf8');
  const main = fs.readFileSync(path.join(ROOT, 'assets/js/main.js'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8');
  assert.ok(/songPlay\s*:\s*'弹唱演奏'/.test(router), '路由标题');
  assert.ok(/song-play\.js/.test(main), 'main.js 引入演奏壳');
  assert.ok(/id="view-songPlay"/.test(html), 'app.html 视图容器');
  assert.ok(/id="gpPlayRoot"/.test(html), '挂载点');
  assert.ok(/assets\/css\/gp\.css/.test(html), '样式引入');
});

test('GP-6 gp.css 全部规则收敛在 .gp-scope 内（不污染宿主令牌）', () => {
  const css = fs.readFileSync(path.join(ROOT, 'assets/css/gp.css'), 'utf8');
  const bare = css.split('\n').filter((l) => /^(:root|body|html, body|#app)\s*\{/.test(l));
  assert.deepStrictEqual(bare, [], `不应有裸全局选择器：${bare.join(' | ')}`);
  assert.ok(css.includes('.gp-scope'), '应定义作用域变量');
});
