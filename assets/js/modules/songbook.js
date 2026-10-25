/* ============================================================
   六弦工坊 V4.0 · 模块：弹唱曲库 songbook.js（T1 曲库浏览 + T2 课程单元）
   ------------------------------------------------------------
   · 纯逻辑（可脱离 DOM 单测）：practicedSongIds / unitProgress /
     isUnitUnlocked / filterSongs / songbookStats，全部以入参注入 sessions，
     不直接读 localStorage（浏览器侧由 PracticeStore 提供）。
   · 渲染：总进度环 → 三级难度 tab（带计数）→ 搜索（200ms 防抖）→
     按 UNITS 分组的曲卡；首屏只渲染当前 tab，DocumentFragment 一次插入，
     全容器事件委托（231 首不挂 231 个监听器）。
   · 打卡状态：onRouteEnter 每次进入重新读取，打卡回来即时显示「已练」。
   · 数据自检失败（validate 非空）→ 兜底卡 + console.warn，停止后续渲染（E1）。
   ============================================================ */
'use strict';

import { SonglistData, UNITS, SONGS, TIER_META, SOURCE_META, songById, songsOfUnit } from '../data/songlist-data.js';

/* ---------- 具名常量（禁魔法数字） ---------- */
export const UNLOCK_RATE = 0.4;      // T2.2：上一单元打卡率阈值
export const WARMUP_BPM = 70;        // T2.3：单元热身区推荐 BPM
export const SEARCH_DEBOUNCE_MS = 200;
const WEEK_MS = 7 * 864e5;

/* i18n 取词兜底：t 由 core/i18n 挂到 window；Node 单测环境退化为返回 key */
function T(k) {
  try {
    if (typeof window !== 'undefined' && typeof window.t === 'function') return window.t(k);
    if (typeof t === 'function') return t(k);
  } catch (e) { /* 忽略：无 i18n 环境用 key 兜底 */ }
  return k;
}
/* 占位符替换（手册约定：{n}/{done}/{total}/{bpm}/{id}） */
function TF(k, pairs) {
  let s = T(k);
  for (const [a, b] of Object.entries(pairs || {})) s = s.replace('{' + a + '}', b);
  return s;
}
function esc(v) {
  try { if (typeof window !== 'undefined' && typeof window.esc === 'function') return window.esc(v); } catch (e) {}
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function toastSafe(msg, type) {
  try { if (typeof toast === 'function') toast(msg, type || 'info'); } catch (e) { /* 无 toast 环境静默 */ }
}

/* ============================================================
   纯逻辑区（无 DOM 依赖，单测直接 import）
   ============================================================ */

/** SB-1：已打卡曲目 id 集合（同曲多次打卡只算 1 首；忽略非 songbook / 缺 meta.songId 的会话） */
export function practicedSongIds(sessions) {
  const ids = new Set();
  for (const s of Array.isArray(sessions) ? sessions : []) {
    if (!s || s.module !== 'songbook') continue;
    const sid = s.meta && s.meta.songId;
    if (sid) ids.add(sid);
  }
  return ids;
}

/** SB-2：单元进度 {done, total, rate} */
export function unitProgress(unitId, practiced) {
  const unit = UNITS.find((u) => u.id === unitId) || null;
  const total = unit ? unit.songCount : 0;
  const set = practiced instanceof Set ? practiced : new Set(practiced || []);
  const done = unit ? songsOfUnit(unitId).filter((s) => set.has(s.id)).length : 0;
  return { done, total, rate: total ? done / total : 0 };
}

/** SB-3：解锁规则（UNITS[0] 恒解锁；其余看前一单元完成率；freeMode 全解锁） */
export function isUnitUnlocked(unitId, practiced, opts) {
  const idx = UNITS.findIndex((u) => u.id === unitId);
  if (idx < 0) return false;                       // 未知单元恒不解锁（自由模式也不例外）
  if (opts && opts.freeMode) return true;
  if (idx === 0) return true;
  return unitProgress(UNITS[idx - 1].id, practiced).rate >= UNLOCK_RATE;
}

/** SB-4：筛选（tier=0 全部；kw 在已选层级内再过滤，空关键词不减少） */
export function filterSongs(list, opts) {
  const o = opts || {};
  const tier = Number(o.tier) || 0;
  const kw = String(o.kw == null ? '' : o.kw).trim().toLowerCase();
  let out = (Array.isArray(list) ? list : SONGS).slice();
  if (tier) out = out.filter((s) => s.tier === tier);
  if (kw) {
    out = out.filter((s) => String(s.title).toLowerCase().includes(kw) ||
      String(s.artist).toLowerCase().includes(kw));
  }
  return out;
}

/** SB-6：曲库聚合统计（去重计数 / 时长累加 / 分层完成率 / 近 7 天） */
export function songbookStats(sessions, now) {
  const end = Number.isFinite(now) ? now : Date.now();
  const list = (Array.isArray(sessions) ? sessions : []).filter((s) => s && s.module === 'songbook');
  const tierTotal = { 1: 0, 2: 0, 3: 0 };
  for (const s of SONGS) tierTotal[s.tier] = (tierTotal[s.tier] || 0) + 1;
  const byTier = {
    1: { done: 0, total: tierTotal[1] || 0, rate: 0 },
    2: { done: 0, total: tierTotal[2] || 0, rate: 0 },
    3: { done: 0, total: tierTotal[3] || 0, rate: 0 }
  };
  const ids = new Set();
  let totalDurationMs = 0;
  let last7DaysMs = 0;
  for (const s of list) {
    const sid = s.meta && s.meta.songId;
    if (sid) ids.add(sid);
    const d = Number.isFinite(s.durationMs) ? s.durationMs : 0;
    totalDurationMs += d;
    if (Number.isFinite(s.endedAt) && s.endedAt >= end - WEEK_MS) last7DaysMs += d;
  }
  for (const id of ids) {
    const song = songById(id);
    if (song && byTier[song.tier]) byTier[song.tier].done += 1;
  }
  for (const k of Object.keys(byTier)) {
    byTier[k].rate = byTier[k].total ? byTier[k].done / byTier[k].total : 0;
  }
  return { practicedCount: ids.size, total: SONGS.length, byTier, totalDurationMs, last7DaysMs };
}

/* ============================================================
   渲染区（浏览器）
   ============================================================ */

function readPrefs() {
  try {
    if (typeof gsStore !== 'undefined' && gsStore && typeof gsStore.read === 'function') return gsStore.read();
    if (typeof window !== 'undefined' && window.gsStore) return window.gsStore.read();
  } catch (e) { /* 隐私模式：降级为空偏好 */ }
  return {};
}
function writePrefs(patch) {
  try {
    if (typeof gsStore !== 'undefined' && gsStore && typeof gsStore.write === 'function') return gsStore.write(patch);
    if (typeof window !== 'undefined' && window.gsStore) return window.gsStore.write(patch);
  } catch (e) { /* 写入失败不阻断 UI */ }
  return null;
}
function readSessions() {
  try {
    if (typeof PracticeStore !== 'undefined' && PracticeStore && typeof PracticeStore.listSessions === 'function') {
      return PracticeStore.listSessions({ module: 'songbook' });
    }
  } catch (e) {
    toastSafe(T('songbook.stats.loadFail'), 'warn');   // E9：读取失败按「全部未练」渲染
  }
  return [];
}
function goRoute(route) {
  try { if (typeof go === 'function') { go(route); return; } } catch (e) {}
  if (typeof window !== 'undefined') window.location.hash = '#/' + route;
}

const Songbook = {
  tier: 0,
  kw: '',
  inited: false,
  expanded: new Set(),      // 已展开曲谱区的曲目 id
  freeMode: false,
  _timer: null,
  _practiced: new Set(),

  /* 进入路由：每次重读打卡状态（打卡返回后即时显示「已练」） */
  enter() {
    this.init();
    this.freeMode = !!readPrefs().songbookFreeMode;
    this._practiced = practicedSongIds(readSessions());
    this.render();
  },

  init() {
    if (this.inited) return;
    const root = document.getElementById('sbList');
    if (!root) return;
    this.inited = true;

    /* 全容器事件委托：231 首曲卡共用 1 个监听器（R-PERF） */
    root.addEventListener('click', (e) => this.onListClick(e));
    root.addEventListener('change', (e) => {
      const box = e.target.closest('#sbFree');
      if (box) { this.setFreeMode(box.checked); }
    });

    /* 搜索：200ms 防抖 */
    const input = document.getElementById('sbSearch');
    if (input) {
      input.addEventListener('input', () => {
        clearTimeout(this._timer);
        this._timer = setTimeout(() => { this.kw = input.value || ''; this.renderList(); }, SEARCH_DEBOUNCE_MS);
      });
    }
    /* 语言切换：动态文案随语言重渲染 */
    document.addEventListener('gs:lang', () => {
      const view = document.getElementById('view-songbook');
      if (view && view.classList.contains('active')) this.render();
    });
  },

  setFreeMode(on) {
    writePrefs({ songbookFreeMode: !!on });
    this.freeMode = !!on;
    this.render();          // 切换即时生效，无需刷新
  },

  /* 单元热身：携带推荐 BPM 跳转；节拍器经 gs.prefs.metro.bpm 预填（§7.6） */
  warmup(kind) {
    if (kind === 'metro') {
      const prefs = readPrefs() || {};
      writePrefs({ metro: { ...(prefs.metro || {}), bpm: WARMUP_BPM } });
      goRoute('metro');
      return;
    }
    goRoute(kind === 'rhythm' ? 'rhythm' : 'flow');
  },

  onListClick(e) {
    const card = e.target.closest('[data-song]');
    if (!card) {
      const wm = e.target.closest('[data-warmup]');
      if (wm) this.warmup(wm.dataset.warmup);
      return;
    }
    if (card.classList.contains('is-locked')) return;             // E11：锁定卡片不可点
    const id = card.dataset.song;
    const btn = e.target.closest('[data-action]');
    const action = btn ? btn.dataset.action : '';
    if (action === 'start') {
      const song = songById(id);
      if (!song) return;
      /* V4.1：走 GuitarPicker note-highway 演奏视图（与参考站一致的呈现） */
      try { if (typeof SongPlay !== 'undefined' && SongPlay) SongPlay.prepare(id); } catch (err) { /* 演奏模块缺失时仍跳转 */ }
      goRoute('songPlay');
      return;
    }
    if (action === 'sheets') {
      const box = card.querySelector('.sb-sheets');
      if (!box) return;
      const open = !box.hidden;
      box.hidden = open;
      if (open) this.expanded.delete(id); else this.expanded.add(id);
      if (btn) btn.classList.toggle('on', !open);
      return;
    }
    const wm = e.target.closest('[data-warmup]');
    if (wm) this.warmup(wm.dataset.warmup);
  },

  /* ---------- 渲染主流程 ---------- */
  render() {
    const errs = SonglistData.validate();
    const listBox = document.getElementById('sbList');
    const topBox = document.getElementById('sbTop');
    if (!listBox || !topBox) return;
    if (errs.length) {                                   // E1：数据自检失败 → 兜底卡
      console.warn('[songbook] 曲库数据自检失败：', errs);
      topBox.innerHTML = '';
      listBox.innerHTML = `<div class="card sb-error"><b>${esc(T('songbook.dataError'))}</b></div>`;
      return;
    }
    this.renderTop(topBox);
    this.renderList();
  },

  renderTop(box) {
    const practiced = this._practiced.size;
    const total = SONGS.length;
    const pct = total ? Math.round(practiced / total * 100) : 0;
    const R = 30, C = 2 * Math.PI * R;
    const dash = C * (total ? practiced / total : 0);
    const tierCount = { 1: 0, 2: 0, 3: 0 };
    for (const s of SONGS) tierCount[s.tier] = (tierCount[s.tier] || 0) + 1;

    const tabs = [{ k: 0, label: T('songbook.tier.all'), n: total }]
      .concat([1, 2, 3].map((t) => ({
        k: t, label: (TIER_META[t] && TIER_META[t].name) || T('songbook.tier.' + t), n: tierCount[t] || 0
      })));

    box.innerHTML = `
      <div class="sb-head">
        <div class="sb-ring">
          <svg viewBox="0 0 72 72" width="72" height="72" aria-hidden="true">
            <circle cx="36" cy="36" r="${R}" fill="none" stroke-width="7" class="sb-ring-track"></circle>
            <circle cx="36" cy="36" r="${R}" fill="none" stroke-width="7" class="sb-ring-bar"
              stroke-dasharray="${dash.toFixed(2)} ${(C - dash).toFixed(2)}" transform="rotate(-90 36 36)"></circle>
          </svg>
          <div class="sb-ring-txt"><b>${pct}%</b><span>${practiced}/${total}</span></div>
        </div>
        <div class="sb-head-txt">
          <div class="sb-head-title">${esc(T('songbook.progress'))}</div>
          <div class="sb-head-sub">${esc(TF('songbook.stats.practiced', { done: practiced, total }))}</div>
          <label class="sb-free"><input type="checkbox" id="sbFree" ${this.freeMode ? 'checked' : ''}><span>${esc(T('songbook.freeMode'))}</span></label>
        </div>
      </div>
      <div class="sb-tabs" id="sbTabs" role="tablist">${tabs.map((t) => `
        <button class="sb-tab${this.tier === t.k ? ' is-active' : ''}" data-tier="${t.k}" role="tab">
          ${esc(t.label)}<span class="sb-tab-n">${t.n}</span>
        </button>`).join('')}
      </div>
      <div class="sb-search">
        <input id="sbSearch" class="sb-search-input" type="search" value="${esc(this.kw)}" aria-label="search">
      </div>`;

    const input = box.querySelector('#sbSearch');
    if (input) {
      input.placeholder = T('songbook.search.ph');
      input.value = this.kw;
      input.addEventListener('input', () => {
        clearTimeout(this._timer);
        this._timer = setTimeout(() => { this.kw = input.value || ''; this.renderList(); }, SEARCH_DEBOUNCE_MS);
      });
    }
    const tabBox = box.querySelector('#sbTabs');
    if (tabBox) {
      tabBox.addEventListener('click', (e) => {
        const b = e.target.closest('[data-tier]');
        if (!b) return;
        this.tier = Number(b.dataset.tier) || 0;
        this.render();                    // 切 tab 保留搜索词
      });
    }
  },

  renderList() {
    const box = document.getElementById('sbList');
    if (!box) return;
    const frag = document.createDocumentFragment();
    const units = UNITS.filter((u) => !this.tier || u.tier === this.tier);
    let hit = 0;

    for (const unit of units) {
      const unlocked = isUnitUnlocked(unit.id, this._practiced, { freeMode: this.freeMode });
      const prog = unitProgress(unit.id, this._practiced);
      if (!unlocked) {                                   // 锁定：整组折叠为一张提示卡
        frag.appendChild(this.lockedCard(unit));
        continue;
      }
      const songs = filterSongs(songsOfUnit(unit.id), { tier: 0, kw: this.kw });
      hit += songs.length;
      if (!songs.length && this.kw) continue;            // 本单元无命中：不渲染空组
      frag.appendChild(this.unitBlock(unit, prog, songs));
    }
    if (!hit && this.kw) {
      const empty = document.createElement('div');
      empty.className = 'card sb-empty';
      empty.textContent = T('songbook.empty');           // E10：搜索无结果空态
      frag.appendChild(empty);
    }
    box.innerHTML = '';
    box.appendChild(frag);                               // 一次插入，避免逐卡 reflow
  },

  unitBlock(unit, prog, songs) {
    const wrap = document.createElement('section');
    wrap.className = 'sb-unit';
    const pct = prog.total ? Math.round(prog.rate * 100) : 0;
    const head = document.createElement('div');
    head.className = 'sb-unit-head';
    head.innerHTML = `
      <div class="sb-unit-title">
        <span class="sb-unit-id">${esc(unit.id)}</span>
        <span class="sb-unit-cnt">${esc(TF('songbook.unit.progress', { done: prog.done, total: prog.total }))}</span>
      </div>
      <div class="sb-progress${prog.rate >= UNLOCK_RATE ? ' is-mint' : ''}"><i style="width:${pct}%"></i></div>
      <div class="sb-unit-warmup">
        <span class="sb-unit-wlabel">${esc(T('songbook.unit.warmup'))}</span>
        <button class="btn-mini" data-warmup="flow">${esc(T('nav.flow'))}</button>
        <button class="btn-mini" data-warmup="rhythm">${esc(T('nav.rhythm'))}</button>
        <button class="btn-mini" data-warmup="metro">${esc(TF('songbook.unit.metro', { bpm: WARMUP_BPM }))}</button>
      </div>`;
    wrap.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'sb-grid';
    songs.forEach((s, i) => grid.appendChild(this.songCard(s, i + 1)));
    wrap.appendChild(grid);
    return wrap;
  },

  lockedCard(unit) {
    const el = document.createElement('div');
    el.className = 'sb-card is-locked';
    el.innerHTML = `
      <div class="sb-unit-title"><span class="sb-unit-id">${esc(unit.id)}</span></div>
      <div class="sb-locked-txt">${esc(TF('songbook.unit.locked', { n: Math.round(UNLOCK_RATE * 100) }))}</div>`;
    return el;
  },

  songCard(s, idxInUnit) {
    const done = this._practiced.has(s.id);
    const tierTag = s.tier === 1 ? 'tag tag-mint' : s.tier === 2 ? 'tag tag-amber' : 'tag tag-violet';
    const tierName = (TIER_META[s.tier] && TIER_META[s.tier].name) || '';
    const stars = s.minDifficulty == null ? '—' : String(s.minDifficulty);
    const card = document.createElement('article');
    card.className = 'sb-card' + (done ? ' is-done' : '');
    card.dataset.song = s.id;

    const sheets = (s.sheets || []).map((sh) => {
      const src = SOURCE_META[sh.source] || { name: sh.source };
      const link = sh.url
        ? `<a class="btn-mini sb-sheet-link" href="${esc(sh.url)}" target="_blank" rel="noopener noreferrer">${esc(T('songbook.sheet.open'))}</a>`
        : '';
      const diff = sh.difficulty == null ? '—' : String(sh.difficulty);
      return `<div class="sb-sheet-row">
        <span class="sb-sheet-src">${esc(src.name)}</span>
        <span class="sb-sheet-name">${esc(sh.name)}</span>
        <span class="sb-sheet-diff">${esc(diff)}</span>
        ${link}
      </div>`;
    }).join('');

    card.innerHTML = `
      <div class="sb-card-top">
        <span class="sb-no">${esc('#' + s.no)}</span>
        <h3 class="sb-title">${esc(s.title)}</h3>
      </div>
      <div class="sb-meta">${esc(s.artist)} · ${esc(s.duration)} · ${esc(tierName)} ${esc(stars)}★ · ${esc(String(idxInUnit))}</div>
      <div class="sb-badges">
        <span class="${tierTag}">${esc(tierName)}</span>
        <span class="tag">${esc(T('songbook.difficulty'))} ${esc(stars)}</span>
        ${s.hasQQChord ? `<span class="tag tag-amber">${esc(T('songbook.badge.official'))}</span>` : ''}
        <span class="tag">${esc(TF('songbook.sheets', { n: s.sheetCount }))}</span>
        ${done ? `<span class="tag tag-mint">${esc(T('songbook.badge.done'))}</span>` : ''}
      </div>
      ${s.tier === 3 && s.note ? `<div class="sb-note">${esc(s.note)}</div>` : ''}
      <div class="sb-actions">
        <button class="btn-mini sb-start" data-action="start">${esc(T('songbook.start'))}</button>
        <button class="btn-mini${this.expanded.has(s.id) ? ' on' : ''}" data-action="sheets">${esc(T('songbook.sheetsBtn'))}</button>
      </div>
      <div class="sb-sheets" ${this.expanded.has(s.id) ? '' : 'hidden'}>${sheets}</div>`;
    return card;
  },

  /* 供统计中心 / 外部复用：当前偏好与已练集合 */
  stats(sessions) {
    return songbookStats(sessions || readSessions());
  }
};

if (typeof onRouteEnter !== 'undefined' && onRouteEnter) onRouteEnter.songbook = () => Songbook.enter();
if (typeof window !== 'undefined') window.Songbook = Songbook;
export { Songbook };
export default Songbook;
