// practice-store.js — 练习记录存储 V3.1
const KEY = 'gs.practice.v1';
const MAX_SESSIONS = 5000;

function normalizeSession(rec, { keepId = false } = {}) {
  if (!rec || typeof rec !== 'object') return null;
  const module = String(rec.module || '').trim();
  if (!module) return null;
  const startedAt = Number(rec.startedAt) || Date.now();
  const durationMs = Math.max(0, Number(rec.durationMs) || 0);
  let accuracy = rec.accuracy;
  if (typeof accuracy === 'number' && !Number.isNaN(accuracy)) {
    accuracy = Math.max(0, Math.min(1, accuracy));
  } else {
    accuracy = null;
  }
  const meta = (rec.meta && typeof rec.meta === 'object') ? rec.meta : {};
  const out = { module, startedAt, durationMs, accuracy, meta };
  if (keepId && rec.id) out.id = rec.id;
  return out;
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { sessions: [], plans: {} };
    const data = JSON.parse(raw);
    return { sessions: data.sessions || [], plans: data.plans || {} };
  } catch (e) {
    return { sessions: [], plans: {} };
  }
}

function save(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    return false;
  }
}

function addSession(rec) {
  const s = normalizeSession(rec);
  if (!s) return false;
  const data = load();
  data.sessions.push(s);
  if (data.sessions.length > MAX_SESSIONS) {
    data.sessions = data.sessions.slice(-MAX_SESSIONS);
  }
  return save(data);
}

function getSessions(filter) {
  const data = load();
  if (!filter) return data.sessions;
  return data.sessions.filter(s => {
    if (filter.module && s.module !== filter.module) return false;
    if (filter.since && s.startedAt < filter.since) return false;
    if (filter.until && s.startedAt > filter.until) return false;
    return true;
  });
}

function clearSessions() {
  return save({ sessions: [], plans: load().plans });
}

function importData(text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch (e) { return { ok: false, added: 0, skipped: 0 }; }
  const incoming = Array.isArray(parsed) ? parsed : (parsed.sessions || []);
  const data = load();
  const seen = new Set(data.sessions.filter(s => s.id).map(s => s.id));
  let added = 0, skipped = 0;
  for (const rec of incoming) {
    const s = normalizeSession(rec, { keepId: true });
    if (!s) { skipped++; continue; }
    if (s.id && seen.has(s.id)) { skipped++; continue; }
    if (s.id) seen.add(s.id);
    data.sessions.push(s);
    added++;
  }
  if (data.sessions.length > MAX_SESSIONS) {
    data.sessions = data.sessions.slice(-MAX_SESSIONS);
  }
  if (parsed.plans) Object.assign(data.plans, parsed.plans);
  save(data);
  return { ok: true, added, skipped };
}

function exportData() {
  return JSON.stringify(load(), null, 2);
}

const PracticeStore = { addSession, getSessions, clearSessions, importData, exportData, normalizeSession };
export default PracticeStore;
export { addSession, getSessions, clearSessions, importData, exportData, normalizeSession };
if (typeof window !== 'undefined') window.PracticeStore = PracticeStore;
