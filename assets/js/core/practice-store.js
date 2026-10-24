/* ============================================================
   六弦工坊 V3.1 · 统一练习数据层 core/practice-store（F1）
   ------------------------------------------------------------
   PracticeSession 标准结构：
     { id, module, startedAt, endedAt, durationMs,
       accuracy,            // 正确率/完成度 0-1，未知为 null
       targetBpm,           // 目标速度（用户设置值）
       detectedBpm,         // 实测/检测速度（严格区分，不做自动等同）
       meta:{} }
   隐私：全部数据仅存 localStorage，不上传服务器。
   兼容：无 localStorage 环境（Node 单测）自动降级为内存存储。
   ============================================================ */
'use strict';

const KEY = 'gs.practice.v1';
const LEGACY_KEYS = ['gs_rhythm_v1', 'gs.practice', 'gs.game.stats'];

/* ---------- 存储适配（localStorage 不可用时降级内存） ---------- */
const memory = new Map();
const storage = (() => {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) {
      const probe = '__gs_probe__';
      localStorage.setItem(probe, '1'); localStorage.removeItem(probe);
      return {
        get: (k) => localStorage.getItem(k),
        set: (k, v) => localStorage.setItem(k, v),
        remove: (k) => localStorage.removeItem(k)
      };
    }
  } catch (e) { /* 隐私模式/禁用 Cookie：降级 */ }
  return {
    get: (k) => (memory.has(k) ? memory.get(k) : null),
    set: (k, v) => memory.set(k, v),
    remove: (k) => memory.delete(k)
  };
})();

const nowId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
/* 容量上限：addSession 与 importData 共用同一常量（BUG-05 前两者口径不一致，
   导入分支完全没有容量保护） */
const MAX_SESSIONS = 5000;

function emptyData() {
  return { version: 1, sessions: [], plans: {}, migrated: false };
}

function read() {
  try {
    const raw = storage.get(KEY);
    if (!raw) return emptyData();
    const d = JSON.parse(raw);
    if (!d || typeof d !== 'object') return emptyData();
    return { ...emptyData(), ...d, sessions: Array.isArray(d.sessions) ? d.sessions : [] };
  } catch (e) { return emptyData(); }
}

function write(data) {
  try { storage.set(KEY, JSON.stringify(data)); return true; }
  catch (e) { return false; }
}

/* ---------- 会话上报 ---------- */
/**
 * 记录一次练习。
 * @param {{module:string, durationMs?:number, accuracy?:number,
 *          targetBpm?:number, detectedBpm?:number, meta?:object}} rec
 */
function addSession(rec) {
  if (!rec || !rec.module) return null;
  const data = read();
  // 结束时间可显式指定（导入/迁移/补记场景），默认取当前时间
  const endedAt = Number.isFinite(rec.endedAt) ? rec.endedAt : Date.now();
  const durationMs = Number.isFinite(rec.durationMs) && rec.durationMs > 0
    ? Math.round(rec.durationMs)
    : Math.max(0, endedAt - (Number.isFinite(rec.startedAt) ? rec.startedAt : endedAt));
  const session = {
    id: nowId(),
    module: String(rec.module),
    startedAt: Number.isFinite(rec.startedAt) ? rec.startedAt : endedAt - durationMs,
    endedAt,
    durationMs,
    // 正确率与速度：未知一律 null，界面与导出均区分显示
    accuracy: Number.isFinite(rec.accuracy) ? Math.max(0, Math.min(1, rec.accuracy)) : null,
    targetBpm: Number.isFinite(rec.targetBpm) ? rec.targetBpm : null,
    detectedBpm: Number.isFinite(rec.detectedBpm) ? rec.detectedBpm : null,
    meta: rec.meta && typeof rec.meta === 'object' ? rec.meta : {}
  };
  data.sessions.push(session);
  // 容量保护：最多保留 MAX_SESSIONS 条
  if (data.sessions.length > MAX_SESSIONS) data.sessions = data.sessions.slice(-MAX_SESSIONS);
  write(data);
  return session;
}

/* ---------- 查询与聚合 ---------- */
function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function listSessions(opts = {}) {
  const { module, since, until } = opts || {};
  return read().sessions.filter(s =>
    (!module || s.module === module) &&
    (!since || s.endedAt >= since) &&
    (!until || s.endedAt <= until)
  );
}

/* 今日/本周/累计 */
function totals() {
  const sessions = read().sessions;
  const now = Date.now();
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const weekAgo = startOfToday.getTime() - 6 * 86400000;
  const sum = (arr, f) => arr.reduce((a, s) => a + f(s), 0);
  const today = sessions.filter(s => s.endedAt >= startOfToday.getTime());
  const week = sessions.filter(s => s.endedAt >= weekAgo);
  return {
    today: { count: today.length, durationMs: sum(today, s => s.durationMs || 0) },
    week: { count: week.length, durationMs: sum(week, s => s.durationMs || 0) },
    all: { count: sessions.length, durationMs: sum(sessions, s => s.durationMs || 0) }
  };
}

/* 过去 N 天每日聚合（用于进步曲线） */
function dailySeries(days = 7) {
  const sessions = read().sessions;
  const out = [];
  const start = new Date(); start.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d0 = new Date(start.getTime() - i * 86400000);
    const d1 = new Date(d0.getTime() + 86400000);
    const inDay = sessions.filter(s => s.endedAt >= d0.getTime() && s.endedAt < d1.getTime());
    const accs = inDay.filter(s => Number.isFinite(s.accuracy)).map(s => s.accuracy);
    out.push({
      date: dayKey(d0.getTime()),
      ts: d0.getTime(),
      count: inDay.length,
      durationMs: inDay.reduce((a, s) => a + (s.durationMs || 0), 0),
      accuracy: accs.length ? accs.reduce((a, b) => a + b, 0) / accs.length : null
    });
  }
  return out;
}

/* 各模块正确率/时长对比 */
function byModule() {
  const sessions = read().sessions;
  const map = new Map();
  for (const s of sessions) {
    const cur = map.get(s.module) || { module: s.module, count: 0, durationMs: 0, accSum: 0, accN: 0 };
    cur.count++;
    cur.durationMs += s.durationMs || 0;
    if (Number.isFinite(s.accuracy)) { cur.accSum += s.accuracy; cur.accN++; }
    map.set(s.module, cur);
  }
  return [...map.values()].map(v => ({
    module: v.module,
    count: v.count,
    durationMs: v.durationMs,
    accuracy: v.accN ? v.accSum / v.accN : null
  })).sort((a, b) => b.durationMs - a.durationMs);
}

/* 连续打卡天数 */
function streak() {
  const days = new Set(read().sessions.map(s => dayKey(s.endedAt)));
  if (!days.size) return 0;
  let n = 0;
  const d = new Date(); d.setHours(0, 0, 0, 0);
  if (!days.has(dayKey(d.getTime()))) d.setTime(d.getTime() - 86400000); // 今天没练则从昨天起算
  while (days.has(dayKey(d.getTime()))) { n++; d.setTime(d.getTime() - 86400000); }
  return n;
}

/* ---------- 旧数据迁移（各模块分散的 localStorage） ---------- */
function migrateLegacy() {
  const data = read();
  if (data.migrated) return 0;
  let n = 0;
  // 节奏型：gs_rhythm_v1 → { t:{sec,loops,count}, maxBpm, last:[{d,n,b,l,s}] }
  try {
    const raw = storage.get('gs_rhythm_v1');
    if (raw) {
      const old = JSON.parse(raw);
      const last = Array.isArray(old && old.last) ? old.last : [];
      for (const item of last) {
        addSession({
          module: 'rhythm',
          durationMs: (Number(item && item.s) || 0) * 1000,
          targetBpm: Number(item && item.b) || null,
          detectedBpm: null,
          meta: { pattern: (item && item.n) || '', loops: Number(item && item.l) || 0, legacy: true }
        });
        n++;
      }
      if (!last.length && old && old.t && Number(old.t.count) > 0) {
        addSession({
          module: 'rhythm',
          durationMs: (Number(old.t.sec) || 0) * 1000,
          meta: { loops: Number(old.t.loops) || 0, legacy: true, aggregate: true }
        });
        n++;
      }
    }
  } catch (e) { /* 旧数据损坏：静默跳过，不影响原模块 */ }
  const d2 = read(); d2.migrated = true; write(d2);
  return n;
}

/* ---------- 计划（F2） ---------- */
function savePlan(plan) {
  const data = read();
  data.plans = data.plans || {};
  data.plans[(plan && plan.date) || dayKey(Date.now())] = plan;
  write(data);
  return plan;
}
function getPlan(date) {
  const data = read();
  return (data.plans || {})[date || dayKey(Date.now())] || null;
}
function listPlans() { return (read().plans || {}); }

/* ---------- 导出 / 导入（F1 数据出口） ---------- */
function exportJSON() {
  const data = read();
  return JSON.stringify({
    app: 'guitar-studio',
    schema: 'practice.v1',
    exportedAt: new Date().toISOString(),
    sessions: data.sessions,
    plans: data.plans || {}
  }, null, 2);
}

function exportCSV() {
  const rows = [['id', 'module', 'startedAt', 'endedAt', 'durationSec', 'accuracy', 'targetBpm', 'detectedBpm']];
  for (const s of read().sessions) {
    rows.push([
      s.id, s.module,
      new Date(s.startedAt).toISOString(), new Date(s.endedAt).toISOString(),
      ((s.durationMs || 0) / 1000).toFixed(1),
      Number.isFinite(s.accuracy) ? s.accuracy.toFixed(3) : '',
      Number.isFinite(s.targetBpm) ? s.targetBpm : '',
      Number.isFinite(s.detectedBpm) ? s.detectedBpm : ''
    ]);
  }
  // 逗号/引号转义（CSV RFC4180 基本规则）
  return rows.map(r => r.map(v => {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\n');
}

/* 导入上限：单次最多接受 IMPORT_MAX 条，防止超大文件写满 localStorage
   （写满后后续写入会静默失败，反而造成数据丢失） */
const IMPORT_MAX = 5000;
function importData(text) {
  let obj;
  try { obj = JSON.parse(text); } catch (e) { return { ok: false, msg: '不是合法 JSON' }; }
  if (!obj || !Array.isArray(obj.sessions)) return { ok: false, msg: '缺少 sessions 字段' };
  const data = read();
  const seen = new Set(data.sessions.map(s => s.id));
  let added = 0, skipped = 0;
  for (const s of obj.sessions) {
    if (!s || typeof s !== 'object') { skipped++; continue; }
    if (added >= IMPORT_MAX) { skipped++; continue; }     // BUG-05：导入条数上限
    if (s.id && seen.has(s.id)) continue;                 // 幂等：同 id 不重复导入
    /* BUG-05 修复：旧实现在此独立 push 外部对象，绕过了 addSession 的
       归一化与容量保护——accuracy 不钳制（可 >1，统计出现「正确率 500%」）、
       时间戳/时长不做有限性校验、总数不裁剪（可远超 5000 条撑爆存储）。
       这里显式复用同一套归一化和钳制规则，保证「导入的数据」与
       「本地记录的数据」口径完全一致。 */
    const endedAt = Number.isFinite(s.endedAt) ? s.endedAt : (Number.isFinite(s.startedAt) ? s.startedAt : Date.now());
    const startedAt = Number.isFinite(s.startedAt) ? s.startedAt : endedAt;
    const dur = Number.isFinite(s.durationMs) && s.durationMs > 0
      ? Math.round(s.durationMs)
      : Math.max(0, endedAt - startedAt);
    data.sessions.push({
      id: s.id || nowId(),
      module: String(s.module || 'unknown'),
      startedAt,
      endedAt,
      durationMs: dur,
      // 正确率钳制到 0–1，非法值（NaN/负数/>1）一律归 null
      accuracy: Number.isFinite(s.accuracy) ? Math.max(0, Math.min(1, s.accuracy)) : null,
      targetBpm: Number.isFinite(s.targetBpm) ? s.targetBpm : null,
      detectedBpm: Number.isFinite(s.detectedBpm) ? s.detectedBpm : null,
      meta: s.meta && typeof s.meta === 'object' ? s.meta : {}
    });
    if (s.id) seen.add(s.id);
    added++;
  }
  // 容量保护：与 addSession 一致，只保留最近 MAX_SESSIONS 条
  if (data.sessions.length > MAX_SESSIONS) data.sessions = data.sessions.slice(-MAX_SESSIONS);
  if (obj.plans && typeof obj.plans === 'object') data.plans = { ...(data.plans || {}), ...obj.plans };
  write(data);
  return { ok: true, added, skipped };
}

function clearAll() { write(emptyData()); return true; }

export const PracticeStore = {
  KEY, LEGACY_KEYS,
  read, write, addSession, listSessions, totals, dailySeries, byModule, streak, dayKey,
  migrateLegacy, savePlan, getPlan, listPlans,
  exportJSON, exportCSV, importData, clearAll
};
export { addSession, listSessions, totals, dailySeries, byModule, streak, exportJSON, exportCSV, importData, migrateLegacy };
export default PracticeStore;

if (typeof window !== 'undefined') window.PracticeStore = PracticeStore;
