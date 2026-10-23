/* ============================================================
   六弦工坊 · 节奏型练习数据层单元测试
   ------------------------------------------------------------
   覆盖《节奏型练习需求手册》验收标准中的纯逻辑部分：
     · 预设完整性校验（格数与拍号×细分一致、动作合法、字段齐全）
     · 网格展开与拍头标记（含三连音细分）
     · 步进时值计算（BPM × 细分）
     · 分解模式根音/低音映射（通用 / C / G / D / E / Am，需求 4.2.6）
     · 动作解析（D/U/×/空、弦序与 T/i/m/a 指法标注）
   运行：node --test test/
   ============================================================ */
'use strict';
import test from 'node:test';
import assert from 'node:assert';
import RD from '../assets/js/data/rhythm-data.js';
const OPEN_MIDI = [40, 45, 50, 55, 59, 64]; // 6弦→1弦

/* ============ 1. 预设完整性（扫弦 ≥7、分解 ≥6，合计 14） ============ */
test('预设数量与分类', () => {
  assert.ok(RD.STRUM_PATTERNS.length >= 7, '扫弦至少 7 种');
  assert.ok(RD.PICK_PATTERNS.length >= 6, '分解至少 6 种');
  assert.strictEqual(RD.ALL_PATTERNS.length,
    RD.STRUM_PATTERNS.length + RD.PICK_PATTERNS.length);
});

test('validatePattern：全部预设法无错误', () => {
  for (const p of RD.ALL_PATTERNS) {
    const errs = RD.validatePattern(p);
    assert.deepStrictEqual(errs, [], `${p.id} 应通过校验：${errs.join('; ')}`);
  }
});

test('validatePattern：故意写错的数据能被抓住', () => {
  assert.ok(RD.validatePattern({ id:'x', cat:'strum', name:'坏', beats:4, beatUnit:4,
    subdivision:2, bpm:60, desc:'', tips:[], actions:['D','D'] }).length > 0, '格数不符');
  assert.ok(RD.validatePattern({ id:'x', cat:'strum', name:'坏', beats:4, beatUnit:4,
    subdivision:2, bpm:60, desc:'', tips:[], actions:['Q','Q','Q','Q','Q','Q','Q','Q'] }).length > 0, '非法动作');
  assert.ok(RD.validatePattern({ id:'x', cat:'pick', name:'坏', beats:4, beatUnit:4,
    subdivision:1, bpm:60, desc:'', tips:[], actions:['9','9','9','9'] }).length > 0, '弦号越界');
});

/* ============ 2. 网格展开 ============ */
test('gridOf：4/4 八分 8 格，每拍第一格是拍头', () => {
  const p = RD.ALL_PATTERNS.find(x => x.id === 'strum-pop-a');
  assert.ok(p, '预设 strum-pop-a 存在');
  const g = RD.gridOf(p);
  assert.strictEqual(g.length, 8);
  assert.strictEqual(g.map(s => s.action).join(''), 'D-DU-UDU');
  const heads = g.filter(s => s.subIdx === 0);
  assert.strictEqual(heads.length, 4, '4 个拍头');
  heads.forEach(s => assert.ok(s.accent === (s.beat === 0) || s.accent === true,
    '拍头需标记 accent'));
  assert.ok(g[0].accent, '第 1 格为强拍');
});

test('gridOf：6/8 一小节 6 格', () => {
  const p = RD.ALL_PATTERNS.find(x => x.id === 'pick-waltz6');
  const g = RD.gridOf(p);
  assert.strictEqual(g.length, 6);
  assert.strictEqual(g[3].beat, 3, '第 4 格落在第 4 拍');
  assert.strictEqual(g[3].subIdx, 0);
});

test('gridOf：三连音细分 12 格（三指循环型）', () => {
  const p = RD.ALL_PATTERNS.find(x => x.id === 'pick-triplet');
  assert.ok(p, '预设 pick-triplet 存在');
  const g = RD.gridOf(p);
  assert.strictEqual(g.length, 12, '4 拍 × 每拍 3 份');
  assert.strictEqual(g.filter(s => s.subIdx === 0).length, 4, '4 个拍头');
  assert.strictEqual(g.map(s => s.action).join(''), 'R32R32R32R32');
});

/* ============ 3. 步进时值 ============ */
test('stepDuration：四分/八分/三连音', () => {
  assert.strictEqual(RD.stepDuration(60, 1), 1);      // 60BPM 四分 = 1s
  assert.strictEqual(RD.stepDuration(60, 2), 0.5);    // 八分 = 0.5s
  assert.ok(Math.abs(RD.stepDuration(120, 3) - 1 / 6) < 1e-9, '120BPM 三连音 = 1/6s');
  assert.ok(RD.stepDuration(180, 2) < RD.stepDuration(60, 2), 'BPM 越高格越短');
});

/* ============ 4. 根音映射（需求 4.2.6，C/G/D/E/Am 必测） ============ */
test('rootMidi：五种和弦根音与低音映射', () => {
  const M = n => RD.rootMidi(n, OPEN_MIDI);
  assert.strictEqual(M('C').root, 48,  'C  根音 = A2 三品 C3 (MIDI 48)');
  assert.strictEqual(M('G').root, 43,  'G  根音 = E2 三品 G2 (MIDI 43)');
  assert.strictEqual(M('D').root, 50,  'D  根音 = 4 弦空弦 D3 (MIDI 50)');
  assert.strictEqual(M('E').root, 40,  'E  根音 = 6 弦空弦 E2 (MIDI 40)');
  assert.strictEqual(M('Am').root, 45, 'Am 根音 = 5 弦空弦 A2 (MIDI 45)');
  assert.ok(M('G').alt !== M('G').root, 'G 的低音交替弦与根音不同');
  assert.ok(M('Am').alt !== M('Am').root, 'Am 的低音交替弦与根音不同');
});

test('rootMidi：undefined / 未知和弦回退到通用映射', () => {
  assert.deepStrictEqual(RD.rootMidi(undefined, OPEN_MIDI), RD.rootMidi('通用', OPEN_MIDI));
  assert.deepStrictEqual(RD.rootMidi('不存在的和弦', OPEN_MIDI), RD.rootMidi('通用', OPEN_MIDI));
  assert.strictEqual(RD.rootMidi('通用', OPEN_MIDI).root, 45, '通用模式根音 = 5 弦空弦');
});

/* ============ 5. 动作解析 ============ */
test('resolveAction：扫弦四类动作', () => {
  const p = { cat: 'strum' };
  assert.strictEqual(RD.resolveAction(p, 'D', '通用').label, '↓');
  assert.strictEqual(RD.resolveAction(p, 'U', '通用').label, '↑');
  assert.strictEqual(RD.resolveAction(p, 'x', '通用').kind, 'mute');
  assert.strictEqual(RD.resolveAction(p, '-', '通用').kind, 'rest');
});

test('resolveAction：分解弦序与 T/i/m/a 指法标注', () => {
  const p = { cat: 'pick' };
  const r3 = RD.resolveAction(p, '3', '通用');
  assert.strictEqual(r3.string, 3);
  assert.strictEqual(r3.sub, 'i', '3 弦用食指 i');
  assert.strictEqual(RD.resolveAction(p, '1', '通用').sub, 'a', '1 弦用无名指 a');
  assert.strictEqual(RD.resolveAction(p, '6', '通用').sub, 'T', '低音弦用拇指 T');
  const rRoot = RD.resolveAction(p, 'R', 'C');
  assert.strictEqual(rRoot.string, 5, 'C 的根音落在 5 弦');
  const rBass = RD.resolveAction(p, 'B', 'G');
  assert.strictEqual(rBass.string, 4, 'G 的交替低音落在 4 弦');
});

/* ============ 6. 拍号覆盖（需求 6：至少支持 2/4 3/4 4/4 6/8） ============ */
test('timeSigText 覆盖 2/4 3/4 4/4 6/8', () => {
  const sigs = new Set(RD.ALL_PATTERNS.map(RD.timeSigText));
  for (const s of ['2/4', '3/4', '4/4', '6/8']) assert.ok(sigs.has(s), `缺少拍号 ${s}`);
});
