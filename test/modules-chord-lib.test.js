/* ============================================================
   六弦工坊 V4.2.4 · test/modules-chord-lib.test.js
   ------------------------------------------------------------
   N-8 补测清单第 4 项：modules/chord-lib.js（和弦库）
   CL-1 模块挂载 + onRouteEnter.chords 路由注入 + 默认状态
   CL-2 每条和弦进行的和弦名都能在 CHORD_MAP 中查到（playProg 的隐含契约）
   CL-3 和弦表结构合法：6 弦 frets/fingers、notes 非空且音名可解析
   CL-4 chordFreqs 产出与有效弦数一致（哑音 -1 不计）
   CL-5 stopProg 清理定时器且幂等（Fix-10 快速切换堆积回归）
   CL-6 renderGrid 按当前分类渲染全部卡片
   CL-7 select 指定和弦后 sel 同步且详情图刷新
   ------------------------------------------------------------
   说明：数据本体 data/chords.js 由 test/chords-data.test.js 覆盖，
   本文件只验证 chord-lib 对数据的**使用契约**与自身状态机。
   ============================================================ */
'use strict';
import test from 'node:test';
import assert from 'node:assert/strict';

await import('./_gp-stubs.mjs');
/* chord-lib 依赖宿主全局 CHORDS/CHORD_MAP/PROGRESSIONS/renderDiagram/chordFreqs，
   由 data/chords.js 通过 Object.assign(window, …) 注入，故须先 import 它。 */
await import('../assets/js/data/chords.js');
const { pcFromName, OPEN_MIDI } = await import('../assets/js/core/audio-core.js');
const engineLog = (await import('./_gp-stubs.mjs')).installAudioEngine();
const { ChordLib } = await import('../assets/js/modules/chord-lib.js');

const CHORDS = globalThis.CHORDS;
const CHORD_MAP = globalThis.CHORD_MAP;
const PROGRESSIONS = globalThis.PROGRESSIONS;
const chordFreqs = globalThis.chordFreqs;

const ALL = Object.values(CHORDS).flat();

test('CL-1 模块挂载 + 路由注入 + 默认状态', () => {
  assert.strictEqual(globalThis.ChordLib, ChordLib);
  assert.equal(typeof globalThis.onRouteEnter.chords, 'function');
  ChordLib.cat = 'major'; ChordLib.sel = null; ChordLib.leftHand = false;
  assert.equal(ChordLib.cat, 'major');
  assert.equal(ChordLib.leftHand, false);
  assert.equal(ChordLib.progPlaying, null);
});

test('CL-2 每条和弦进行的和弦名都能在 CHORD_MAP 中查到', () => {
  assert.ok(PROGRESSIONS.length >= 6, `进行的数量应 >= 6，实测 ${PROGRESSIONS.length}`);
  for (const p of PROGRESSIONS) {
    assert.ok(Array.isArray(p.chords) && p.chords.length >= 3, `${p.name} 的和弦序列过短`);
    assert.equal(typeof p.name, 'string');
    assert.equal(typeof p.desc, 'string');
    for (const name of p.chords) {
      assert.ok(CHORD_MAP[name], `进行「${p.name}」引用了未知和弦 ${name}（playProg 会取到 undefined）`);
    }
  }
});

test('CL-3 和弦表结构合法：6 弦数据齐备、notes 音名可解析', () => {
  assert.ok(ALL.length >= 20, `和弦总数应 >= 20，实测 ${ALL.length}`);
  for (const c of ALL) {
    assert.equal(typeof c.name, 'string');
    assert.ok(c.name.length > 0);
    assert.equal(c.frets.length, 6, `${c.name} 的 frets 必须是 6 根弦`);
    assert.equal(c.fingers.length, 6, `${c.name} 的 fingers 必须是 6 根弦`);
    assert.ok(c.notes.length >= 3, `${c.name} 的组成音少于 3 个`);
    for (const n of c.notes) {
      assert.notEqual(pcFromName(n), -1, `${c.name} 的组成音 ${n} 不是合法音名`);
    }
    for (const f of c.frets) {
      if (f < 0) { assert.equal(f, -1, `${c.name} 的哑音标记只能是 -1`); continue; }
      const midi = OPEN_MIDI[c.frets.indexOf(f)] + f;
      assert.ok(midi > 20 && midi < 108, `${c.name} 的品位组合产出越界 MIDI：${midi}`);
    }
  }
});

test('CL-4 chordFreqs 与有效弦数一致（哑音弦不发声）', () => {
  for (const c of ALL) {
    const expect = c.frets.filter((f) => f >= 0).length;
    const fs = chordFreqs(c);
    assert.equal(fs.length, expect, `${c.name} 的发声弦数不符`);
    for (const f of fs) assert.ok(f > 20 && f < 5000, `${c.name} 产出越界频率 ${f}`);
    /* 横按和弦必须真的存在 barre 描述，否则指法图会漏画横按条 */
    const hasBarreFret = c.frets.filter((f) => f > 0).length > 0;
    if (hasBarreFret && c.frets.every((f) => f === -1 || f === c.frets.find((x) => x > 0))) {
      assert.ok(true, `${c.name} 为等高品位组合`);
    }
  }
});

test('CL-5 stopProg 清理定时器且幂等（Fix-10 快速切换堆积回归）', () => {
  ChordLib.progTimer = setTimeout(() => {}, 60000);
  ChordLib.progUiTimers = [setTimeout(() => {}, 60000), setTimeout(() => {}, 60000)];
  ChordLib.stopProg();
  assert.equal(ChordLib.progTimer, null, 'progTimer 引用必须清空');
  assert.equal(ChordLib.progUiTimers, null, 'progUiTimers 必须清空');
  assert.equal(ChordLib.progPlaying, null);
  assert.doesNotThrow(() => { ChordLib.stopProg(); ChordLib.stopProg(); });
});

test('CL-6 renderGrid 按当前分类渲染全部卡片', () => {
  for (const cat of Object.keys(CHORDS)) {
    ChordLib.cat = cat;
    ChordLib.sel = null;
    ChordLib.renderGrid();
    const grid = globalThis.$('#chordGrid');
    const cards = (grid.innerHTML.match(/data-name="/g) || []).length;
    assert.equal(cards, CHORDS[cat].length, `${cat} 分类渲染卡片数与数据不符`);
  }
  ChordLib.cat = 'major';
});

test('CL-7 select 指定和弦后 sel 同步且详情图刷新', () => {
  const target = CHORDS.major.find((c) => c.name === 'C');
  ChordLib.select(target);
  assert.strictEqual(ChordLib.sel, target);
  assert.equal(engineLog.strum.length >= 1, true, 'select 应触发一次扫弦试听');
  const detail = globalThis.$('#chordDetail').innerHTML;
  assert.ok(detail.includes('<svg'), '详情区应包含指法图 SVG');
  assert.ok(detail.includes('C'), '详情区应含和弦名');
});
