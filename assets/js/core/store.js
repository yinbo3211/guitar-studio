/* ============================================================
   六弦工坊 V3 · core/store.js
   ------------------------------------------------------------
   R-BPM-06 / R-AUTO-01：用户偏好统一持久化（localStorage，键 gs.prefs）。
   结构：{ theme:'auto'|主题key, lang:'zh-CN'|'en'|'ja'|'ko',
          metro:{bpm,beats,sub} }。异常时静默降级为内存对象。
   ============================================================ */
'use strict';

const PREFS_KEY = 'gs.prefs';

const DEFAULT_PREFS = { theme: 'auto', lang: 'zh-CN', metro: {} };

function readPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch (e) {
    return { ...DEFAULT_PREFS };
  }
}

function writePrefs(patch) {
  const next = { ...readPrefs(), ...patch };
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch (e) {}
  return next;
}

const store = { read: readPrefs, write: writePrefs, KEY: PREFS_KEY };

window.gsStore = store;
export { store };
export default store;
