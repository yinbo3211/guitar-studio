/* ============================================================
   六弦工坊 V4.0 · 弹唱练习模块测试（T3）
   ------------------------------------------------------------
   纯逻辑：SP-1 状态机 / SP-2 倒计时与计时 / SP-3 BPM 边界 /
           SB-5 打卡记录组装（accuracy 恒 null）
   工程约束：E4 visibilitychange 可移除、E6/E7 Transport 兜底、
           计时器三处清理、禁止自算 60/bpm、禁止直接碰 Tone。
   ============================================================ */
'use strict';
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

const SP = await imp('assets/js/modules/song-practice.js');
const { PRACTICE_CONST, NOTE_MAX, nextState, countdownSequence, elapsedMs, clampBpm, buildSession, fmtClock } = SP;

/* ============================================================
   SP-1 状态机
   ============================================================ */
test('SP-1 合法迁移：idle→countdown→running→paused→running→result→idle', () => {
  assert.strictEqual(nextState('idle', 'START'), 'countdown');
  assert.strictEqual(nextState('countdown', 'TICK'), 'running');
  assert.strictEqual(nextState('running', 'PAUSE'), 'paused');
  assert.strictEqual(nextState('paused', 'RESUME'), 'running');
  assert.strictEqual(nextState('running', 'FINISH'), 'result');
  assert.strictEqual(nextState('paused', 'FINISH'), 'result');
  assert.strictEqual(nextState('result', 'SAVE'), 'idle');
  assert.strictEqual(nextState('result', 'DISCARD'), 'idle');
  assert.strictEqual(nextState('countdown', 'CANCEL'), 'idle');
});

test('SP-1 非法迁移保持原状态，不抛错（E12）', () => {
  assert.strictEqual(nextState('idle', 'FINISH'), 'idle');
  assert.strictEqual(nextState('idle', 'PAUSE'), 'idle');
  assert.strictEqual(nextState('running', 'START'), 'running');
  assert.strictEqual(nextState('result', 'START'), 'result');
  assert.strictEqual(nextState('paused', 'PAUSE'), 'paused');
  assert.strictEqual(nextState('unknown', 'START'), 'unknown');
  assert.strictEqual(nextState('idle', undefined), 'idle');
  assert.strictEqual(nextState(undefined, undefined), undefined);
});

/* ============================================================
   SP-2 倒计时与计时
   ============================================================ */
test('SP-2 倒计时序列为 3-2-1（GO 只显示不计入状态）', () => {
  assert.deepStrictEqual(countdownSequence(), [3, 2, 1]);
  assert.strictEqual(PRACTICE_CONST.LEAD_IN, 3);
});

test('SP-2 已进行时长扣除暂停且永不为负', () => {
  assert.strictEqual(elapsedMs(1000, 61000, 0), 60000);
  assert.strictEqual(elapsedMs(1000, 61000, 20000), 40000, '暂停时长应扣除');
  assert.strictEqual(elapsedMs(61000, 1000, 0), 0, '倒挂不为负');
  assert.strictEqual(elapsedMs(1000, 61000, 999999), 0);
  assert.strictEqual(elapsedMs(null, null, null), 0, '脏入参归零');
});

test('SP-2 时长格式化 mm:ss', () => {
  assert.strictEqual(fmtClock(0), '0:00');
  assert.strictEqual(fmtClock(9500), '0:09');
  assert.strictEqual(fmtClock(60000), '1:00');
  assert.strictEqual(fmtClock(125000), '2:05');
  assert.strictEqual(fmtClock(-5), '0:00');
  assert.strictEqual(fmtClock(NaN), '0:00');
});

/* ============================================================
   SP-3 BPM 边界
   ============================================================ */
test('SP-3 BPM 钳制在 30–180，非法值回落默认 70', () => {
  assert.strictEqual(clampBpm(70), 70);
  assert.strictEqual(clampBpm(1), PRACTICE_CONST.MIN_BPM);
  assert.strictEqual(clampBpm(999), PRACTICE_CONST.MAX_BPM);
  assert.strictEqual(clampBpm(29), 30);
  assert.strictEqual(clampBpm(181), 180);
  assert.strictEqual(clampBpm(0), 30);
  assert.strictEqual(clampBpm('abc'), PRACTICE_CONST.DEFAULT_BPM);
  assert.strictEqual(clampBpm(null), PRACTICE_CONST.DEFAULT_BPM);
  assert.strictEqual(clampBpm(undefined), PRACTICE_CONST.DEFAULT_BPM);
  assert.strictEqual(clampBpm(75.6), 76, '四舍五入取整');
  assert.strictEqual(PRACTICE_CONST.DEFAULT_BPM, 70);
  assert.strictEqual(PRACTICE_CONST.MIN_BPM, 30);
  assert.strictEqual(PRACTICE_CONST.MAX_BPM, 180);
});

/* ============================================================
   SB-5 打卡记录组装
   ============================================================ */
test('SB-5 打卡记录：module=songbook 且 accuracy 恒 null（弹唱无评分，不是 0）', () => {
  const rec = buildSession({ songId: 'song-001', unit: 'L1.1', tier: 1, bpm: 70, stepsDone: 2 });
  assert.strictEqual(rec.module, 'songbook');
  assert.strictEqual(rec.accuracy, null, 'accuracy 必须是 null，不能是 0');
  assert.notStrictEqual(rec.accuracy, 0);
  assert.strictEqual(rec.targetBpm, 70);
  assert.strictEqual(rec.detectedBpm, null);
  assert.strictEqual(rec.meta.songId, 'song-001');
  assert.strictEqual(rec.meta.unit, 'L1.1');
  assert.strictEqual(rec.meta.tier, 1);
  assert.strictEqual(rec.meta.stepsDone, 2);
  assert.strictEqual(rec.meta.record, false, '预留录音联动字段位');
});

test('SB-5 时长由 endedAt-startedAt 推导，显式 durationMs 优先且非负', () => {
  const a = buildSession({ startedAt: 1000, endedAt: 61000 });
  assert.strictEqual(a.durationMs, 60000);
  const b = buildSession({ startedAt: 1000, endedAt: 61000, durationMs: -999 });
  assert.strictEqual(b.durationMs, 0, '负时长归零');
  const c = buildSession({ startedAt: 61000, endedAt: 1000 });
  assert.strictEqual(c.durationMs, 0);
  const d = buildSession({});
  assert.ok(Number.isFinite(d.durationMs) && d.durationMs >= 0);
  assert.ok(Number.isFinite(d.endedAt));
});

test('SB-5 备注截断 200 字，缺失字段有安全默认', () => {
  const long = 'x'.repeat(500);
  const rec = buildSession({ note: long });
  assert.strictEqual(rec.meta.note.length, NOTE_MAX);
  assert.strictEqual(NOTE_MAX, 200);
  const empty = buildSession();
  assert.strictEqual(empty.meta.songId, '');
  assert.strictEqual(empty.meta.unit, '');
  assert.strictEqual(empty.meta.tier, null);
  assert.strictEqual(empty.meta.stepsDone, 0);
  assert.strictEqual(empty.meta.note, '');
  assert.strictEqual(empty.targetBpm, null);
});

/* ============================================================
   工程约束（源码级，防回退）
   ============================================================ */
const SRC = fs.readFileSync(path.join(ROOT, 'assets/js/modules/song-practice.js'), 'utf8');

test('SP-E4 visibilitychange 用具名 handler 且 cleanup 可移除（不泄漏）', () => {
  assert.ok(/this\._visHandler\s*=/.test(SRC), '具名 handler 保存引用');
  assert.ok(/document\.addEventListener\('visibilitychange',\s*this\._visHandler\)/.test(SRC));
  assert.ok(/document\.removeEventListener\('visibilitychange',\s*this\._visHandler\)/.test(SRC));
  assert.ok(/if\s*\(document\.hidden\s*&&\s*this\.state\s*===\s*'running'\)/.test(SRC), '仅 running 时自动暂停');
});

test('SP-T1 计时器句柄在 cancel / 进入 running / cleanup 三处必清', () => {
  const clearCalls = (SRC.match(/this\.clearCountdown\(\)/g) || []).length;
  assert.ok(clearCalls >= 3, `clearCountdown 调用点应 ≥3（实际 ${clearCalls}）`);
  assert.ok(/clearInterval\(this\._cdTimer\)/.test(SRC));
  assert.ok(/clearTimeout\(this\._goTimer\)/.test(SRC), 'GO 延时句柄必须清理');
  assert.ok(/clearInterval\(this\._tickTimer\)/.test(SRC));
});

test('SP-T2 节拍一律走 Transport：禁止自算 60/bpm、禁止直接碰 Tone', () => {
  assert.ok(/Transport\.setBpm\(/.test(SRC), '必须声明本模块 BPM');
  assert.ok(/await Transport\.start\(\)/.test(SRC));
  assert.ok(!/\bTone\./.test(SRC), '不得直接调用 Tone');
  /* 60/bpm 只允许出现在注释里 */
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/60\s*\/\s*(this\.)?bpm/.test(code), '禁止自行换算拍长');
});

test('SP-E6/E7 音频起播失败：toast 提示并回 idle，不卡在 running', () => {
  assert.ok(/songbook\.practice\.audioFail/.test(SRC));
  assert.ok(/this\.state\s*=\s*'idle'/.test(SRC));
  assert.ok(/this\.renderIdle\(\)/.test(SRC));
  assert.ok(/typeof Transport === 'undefined'/.test(SRC), '无音频环境允许无声计时');
});

test('SP-E8 打卡写入失败停留结算页，不误报成功', () => {
  const saveBlock = (/\n  save\(\)\s*\{([\s\S]*?)\n  \}/.exec(SRC) || [, SRC])[1];
  assert.ok(/songbook\.result\.saveFail/.test(saveBlock));
  assert.ok(/if\s*\(!saved\)\s*\{/.test(saveBlock));
  assert.ok(/return;/.test(saveBlock), '失败直接返回，不跳转');
});

test('SP-E2/E18 曲目缺失渲染 notFound，并支持 hash ?song= 兜底', () => {
  assert.ok(/renderNotFound\(\)/.test(SRC));
  assert.ok(/songbook\.notFound/.test(SRC));
  assert.ok(/hashSongId\(\)/.test(SRC));
  assert.ok(/\(\?:\^\|&\)song=\(\[\^&\]\+\)/.test(SRC), '解析 ?song= 查询参数');
});

test('SP-R1 路由注册：songPractice 进入时初始化', () => {
  assert.ok(/onRouteEnter\.songPractice\s*=/.test(SRC));
});
