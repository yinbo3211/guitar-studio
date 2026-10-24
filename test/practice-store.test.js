/* ============================================================
   六弦工坊 V3.1 · F1 统一练习数据层测试
   ------------------------------------------------------------
   覆盖：会话上报结构、今日/本周/累计聚合、7/30/90 天序列、
        模块对比、连续打卡、旧数据迁移、导出 JSON/CSV 与导入幂等、
        目标速度 vs 实测速度分字段（不做自动等同）
   ============================================================ */
'use strict';
import test from 'node:test';
import assert from 'node:assert';
/* Node 环境可能没有 localStorage：提供内存桩，验证「有 localStorage」分支 */
if (typeof globalThis.localStorage === 'undefined') {
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
    clear: () => mem.clear()
  };
}
const { PracticeStore: P } = await import('../assets/js/core/practice-store.js');

test.beforeEach(() => { P.clearAll(); });

test('F1 会话上报结构与字段完整性', () => {
  const s = P.addSession({ module: 'rhythm', durationMs: 60000, accuracy: 0.8, targetBpm: 90, detectedBpm: 72 });
  assert.ok(s && s.id, '应返回带 id 的会话');
  assert.strictEqual(s.module, 'rhythm');
  assert.strictEqual(s.durationMs, 60000);
  assert.strictEqual(s.accuracy, 0.8);
  assert.strictEqual(s.targetBpm, 90);
  assert.strictEqual(s.detectedBpm, 72, '目标速度与实测速度必须分字段记录');
  assert.ok(s.startedAt && s.endedAt && s.endedAt >= s.startedAt);
});

test('F1 目标速度与实测速度不被自动等同', () => {
  const s = P.addSession({ module: 'metro', durationMs: 30000, targetBpm: 120 });
  assert.strictEqual(s.targetBpm, 120);
  assert.strictEqual(s.detectedBpm, null, '未提供实测速度时应为 null，不能回填目标值');
  const s2 = P.addSession({ module: 'metro', durationMs: 30000, targetBpm: 120, detectedBpm: 96 });
  assert.notStrictEqual(s2.detectedBpm, s2.targetBpm);
});

test('F1 非法输入被规范化', () => {
  assert.strictEqual(P.addSession({}), null, '缺少 module 应拒绝');
  assert.strictEqual(P.addSession(null), null);
  const s = P.addSession({ module: 'ear', accuracy: 5, durationMs: -10 });
  assert.strictEqual(s.accuracy, 1, '正确率应钳制到 0-1');
  assert.strictEqual(s.durationMs, 0, '负时长应归零');
});

test('F1 今日/本周/累计聚合', () => {
  P.addSession({ module: 'rhythm', durationMs: 600000 });          // 10 分钟
  P.addSession({ module: 'ear', durationMs: 300000, accuracy: 0.5 });
  const t = P.totals();
  assert.strictEqual(t.today.count, 2);
  assert.strictEqual(t.today.durationMs, 900000);
  assert.strictEqual(t.week.count, 2);
  assert.strictEqual(t.all.count, 2);
});

test('F1 每日序列（7/30/90 天）', () => {
  P.addSession({ module: 'rhythm', durationMs: 120000, accuracy: 1 });
  const d7 = P.dailySeries(7);
  assert.strictEqual(d7.length, 7);
  assert.strictEqual(d7[6].count, 1, '今日应计入序列最后一项');
  assert.strictEqual(d7[6].accuracy, 1);
  assert.strictEqual(P.dailySeries(30).length, 30);
  assert.strictEqual(P.dailySeries(90).length, 90);
  // 无数据日应为 0 且 accuracy 为 null
  assert.strictEqual(d7[0].count, 0);
  assert.strictEqual(d7[0].accuracy, null);
});

test('F1 模块对比与排序', () => {
  P.addSession({ module: 'rhythm', durationMs: 60000, accuracy: 0.6 });
  P.addSession({ module: 'rhythm', durationMs: 60000, accuracy: 0.8 });
  P.addSession({ module: 'ear', durationMs: 30000, accuracy: 0.5 });
  const m = P.byModule();
  assert.strictEqual(m.length, 2);
  assert.strictEqual(m[0].module, 'rhythm', '按时长降序');
  assert.strictEqual(m[0].count, 2);
  assert.ok(Math.abs(m[0].accuracy - 0.7) < 1e-9, '同模块正确率应求平均');
});

test('F1 连续打卡天数（含跨天与断签）', () => {
  assert.strictEqual(P.streak(), 0, '无数据应为 0');
  const day = 86400000;
  const now = Date.now();
  P.addSession({ module: 'rhythm', durationMs: 1000, startedAt: now - day, endedAt: now - day });
  P.addSession({ module: 'rhythm', durationMs: 1000, startedAt: now, endedAt: now });
  assert.ok(P.streak() >= 2, `应至少连续 2 天（实际 ${P.streak()}）`);
  // 断签：仅保留 3 天前的一次
  P.clearAll();
  P.addSession({ module: 'rhythm', durationMs: 1000, startedAt: now - 3 * day, endedAt: now - 3 * day });
  assert.strictEqual(P.streak(), 0, '断签后连续天数应归零');
});

test('F1 导出 JSON / CSV 可再导入且幂等', () => {
  P.addSession({ module: 'rhythm', durationMs: 60000, accuracy: 0.75, targetBpm: 90, detectedBpm: 70 });
  P.addSession({ module: 'ear', durationMs: 30000, accuracy: 0.5 });
  const json = P.exportJSON();
  const parsed = JSON.parse(json);
  assert.strictEqual(parsed.schema, 'practice.v1');
  assert.strictEqual(parsed.sessions.length, 2);

  // 换「浏览器」：清空后导入
  P.clearAll();
  const r1 = P.importData(json);
  assert.strictEqual(r1.ok, true);
  assert.strictEqual(r1.added, 2, '应完整导入 2 条');
  const r2 = P.importData(json);
  assert.strictEqual(r2.added, 0, '重复导入应幂等（同 id 跳过）');
  assert.strictEqual(P.totals().all.count, 2);
  const s = P.listSessions({ module: 'rhythm' })[0];
  assert.strictEqual(s.detectedBpm, 70, '导入后检测速度字段应保留');
});

test('F1 导出 CSV 结构与转义', () => {
  P.addSession({ module: 'chords', durationMs: 60000, accuracy: 0.5, targetBpm: 80 });
  const csv = P.exportCSV();
  const lines = csv.trim().split('\n');
  assert.ok(lines[0].startsWith('id,module,startedAt'), '首行为表头');
  assert.strictEqual(lines.length, 2, '1 条数据 → 表头 + 1 行');
  const cells = lines[1].split(',');
  assert.strictEqual(cells[1], 'chords');
  assert.strictEqual(cells[4], '60.0', '时长以秒导出');
  // 含逗号的 meta 不影响行结构（模块名受控，此处校验基础合法）
  assert.strictEqual(cells.length, 8);
});

test('F1 导入非法数据不崩溃', () => {
  assert.strictEqual(P.importData('not json').ok, false);
  assert.strictEqual(P.importData('{"foo":1}').ok, false, '缺少 sessions 应拒绝');
  assert.strictEqual(P.importData('{"sessions":[null,{"module":"x"}]}').added, 1, '脏条目应被跳过');
});

/* ---------- BUG-05 回归：导入路径与上报共用归一化 ---------- */
test('回归 BUG-05：导入条目逐条归一化（空 module 跳过 / accuracy 钳制 / 时长非负）', () => {
  const payload = JSON.stringify({ sessions: [
    null,
    42,
    'nope',
    {},
    { module: '   ' },                                   // 纯空白 module → 跳过
    { module: '', durationMs: 100 },                     // 空 module → 跳过
    { id: 'a1', module: 'ear', accuracy: 9, durationMs: -500 },   // 钳 1、时长归零
    { id: 'a2', module: 'ear', accuracy: -0.4 },         // 钳 0
    { id: 'a3', module: 'custom-x', accuracy: 0.5, durationMs: 12000,
      meta: { questions: 10 } }                          // 自定义模块名必须接受（不设白名单）
  ]});
  const r = P.importData(payload);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.added, 3, '3 条合法，其余脏条目全部跳过');
  const all = P.listSessions({});
  assert.strictEqual(all.length, 3);
  const a1 = all.find(s => s.id === 'a1');
  assert.strictEqual(a1.accuracy, 1, '越界 accuracy 应钳制到 1');
  assert.strictEqual(a1.durationMs, 0, '负时长应归零');
  const a2 = all.find(s => s.id === 'a2');
  assert.strictEqual(a2.accuracy, 0, '负 accuracy 应钳制到 0');
  const a3 = all.find(s => s.id === 'a3');
  assert.strictEqual(a3.module, 'custom-x', '不得用模块白名单拒绝自定义/历史模块名');
  assert.deepStrictEqual(a3.meta, { questions: 10 });
});

test('回归 BUG-05：导入保留外部 id 且幂等；合并后受 5000 条上限保护', () => {
  const one = JSON.stringify({ sessions: [{ id: 'fixed-id', module: 'tuner', durationMs: 1000 }] });
  assert.strictEqual(P.importData(one).added, 1);
  assert.strictEqual(P.importData(one).added, 0, '同一外部 id 重复导入必须幂等');
  assert.strictEqual(P.listSessions({}).length, 1);

  // 容量保护：导入 5005 条后只保留最新 5000 条（最早 5 条被裁掉）
  const bulk = { sessions: [] };
  const now = Date.now();
  for (let i = 0; i < 5005; i++) {
    bulk.sessions.push({ id: 'bulk-' + i, module: 'flow', durationMs: 100,
      startedAt: now - (5005 - i) * 1000, endedAt: now - (5005 - i) * 1000 + 100 });
  }
  P.clearAll();
  const r = P.importData(JSON.stringify(bulk));
  assert.strictEqual(r.added, 5005);
  const list = P.listSessions({});
  assert.strictEqual(list.length, 5000, '导入同样受 MAX_SESSIONS=5000 上限保护');
  assert.strictEqual(list[0].id, 'bulk-5', '应保留最新的 5000 条（最早 bulk-0..4 被裁）');
  assert.strictEqual(list[4999].id, 'bulk-5004');
});

test('F1 旧数据迁移（gs_rhythm_v1）', () => {
  // 模拟旧模块写入的 localStorage
  const legacy = { t: { sec: 600, loops: 12, count: 3 }, maxBpm: 120, last: [{ d: '10-24 12:00', n: '民谣扫弦', b: 90, l: 4, s: 120 }] };
  globalThis.localStorage.setItem('gs_rhythm_v1', JSON.stringify(legacy));
  const n = P.migrateLegacy();
  assert.ok(n >= 1, '应迁移出至少 1 条会话');
  const list = P.listSessions({ module: 'rhythm' });
  assert.ok(list.length >= 1);
  assert.strictEqual(list[0].durationMs, 120000, '旧 last[0].s（秒）应换算为毫秒');
  assert.strictEqual(list[0].targetBpm, 90);
  assert.strictEqual(list[0].detectedBpm, null, '旧数据无实测速度，应留空');
  assert.strictEqual(P.migrateLegacy(), 0, '重复迁移不应产生重复数据');
  globalThis.localStorage.removeItem('gs_rhythm_v1');
});

test('F1 计划存取（F2 依赖）', () => {
  const plan = { date: '2026-10-24', level: 'basic', minutes: 20, tasks: [{ module: 'tuner', target: 1 }] };
  P.savePlan(plan);
  assert.deepStrictEqual(P.getPlan('2026-10-24'), plan);
  assert.strictEqual(P.getPlan('2026-10-25'), null);
  assert.ok(Object.keys(P.listPlans()).length >= 1);
});
