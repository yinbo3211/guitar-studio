/* ============================================================
   六弦工坊 V4.0 · 模块：弹唱练习 song-practice.js（T3）
   ------------------------------------------------------------
   流程：准备页 → 3-2-1-GO 倒计时 → 节拍引导练习 HUD → 结算打卡。
   · 状态机与计时为纯函数（nextState / countdownSequence / elapsedMs /
     buildSession / PRACTICE_CONST），可脱离 DOM 单测；
   · 节拍一律走 window.Transport（禁止自算 60/bpm、禁止直接碰 Tone）；
   · 计时器卫生：倒计时句柄在 cancel / 进入 running / cleanup 三处必清；
     visibilitychange 用具名 handler，cleanup 可移除；
   · 打卡唯一出口 PracticeStore.addSession({module:'songbook', ...})，
     accuracy 恒 null（弹唱无评分，不是 0），meta 预留 record 字段位。
   ============================================================ */
'use strict';

import { songById } from '../data/songlist-data.js';

/* ---------- 具名常量 ---------- */
export const PRACTICE_CONST = { LEAD_IN: 3, DEFAULT_BPM: 70, MIN_BPM: 30, MAX_BPM: 180 };
export const NOTE_MAX = 200;
const TICK_MS = 250;

/* i18n 取词兜底 */
function T(k) {
  try {
    if (typeof window !== 'undefined' && typeof window.t === 'function') return window.t(k);
    if (typeof t === 'function') return t(k);
  } catch (e) { /* 无 i18n 环境用 key 兜底 */ }
  return k;
}
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
function goRoute(route) {
  try { if (typeof go === 'function') { go(route); return; } } catch (e) {}
  if (typeof window !== 'undefined') window.location.hash = '#/' + route;
}

/* ============================================================
   纯逻辑区（无 DOM 依赖）
   ============================================================ */

/** SP-1：状态机。非法迁移返回原 state，不抛错 */
export function nextState(state, event) {
  const map = {
    idle: { START: 'countdown' },
    countdown: { TICK: 'running', CANCEL: 'idle' },
    running: { PAUSE: 'paused', FINISH: 'result' },
    paused: { RESUME: 'running', FINISH: 'result' },
    result: { SAVE: 'idle', DISCARD: 'idle' }
  };
  const next = map[state] && map[state][event];
  return next || state;
}

/** SP-2：倒计时序列（GO 只显示，不计入状态） */
export function countdownSequence() {
  const out = [];
  for (let i = PRACTICE_CONST.LEAD_IN; i >= 1; i--) out.push(i);
  return out;
}

/** SP-2：已进行时长（扣除暂停），永不为负 */
export function elapsedMs(startedAt, now, pausedMs) {
  const s = Number(startedAt) || 0;
  const n = Number(now) || 0;
  const p = Number(pausedMs) || 0;
  return Math.max(0, n - s - p);
}

/** SP-3：曲库练习 BPM 边界 30–180（节拍器侧 30–300 由既有模块负责）
    空值（null/undefined/''）与非法值一律回落默认 70，不取最小值 30——
    否则控件读到空值会把速度打到下限，与用户预期不符。 */
export function clampBpm(v) {
  if (v === null || v === undefined || v === '') return PRACTICE_CONST.DEFAULT_BPM;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return PRACTICE_CONST.DEFAULT_BPM;
  return Math.min(PRACTICE_CONST.MAX_BPM, Math.max(PRACTICE_CONST.MIN_BPM, n));
}

/** SB-5：组装打卡记录（accuracy 恒 null；备注截断 200 字；meta 预留 record） */
export function buildSession(args) {
  const a = args || {};
  const endedAt = Number.isFinite(a.endedAt) ? a.endedAt : Date.now();
  const startedAt = Number.isFinite(a.startedAt) ? a.startedAt : endedAt;
  const durationMs = Number.isFinite(a.durationMs) ? Math.max(0, Math.round(a.durationMs))
    : Math.max(0, endedAt - startedAt);
  const note = String(a.note == null ? '' : a.note).slice(0, NOTE_MAX);
  return {
    module: 'songbook',
    startedAt,
    endedAt,
    durationMs,
    accuracy: null,                       // 弹唱无评分：必须 null，不是 0
    targetBpm: Number.isFinite(a.bpm) ? a.bpm : null,
    detectedBpm: null,
    meta: {
      songId: a.songId || '',
      unit: a.unit || '',
      tier: Number.isFinite(a.tier) ? a.tier : null,
      stepsDone: Number.isFinite(a.stepsDone) ? a.stepsDone : 0,
      note,
      record: false                       // 预留：未来录音棚联动字段位
    }
  };
}

/** 时长格式化 mm:ss */
export function fmtClock(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/* ============================================================
   渲染与状态驱动（浏览器）
   ============================================================ */

const SongPractice = {
  state: 'idle',
  songId: '',
  song: null,
  bpm: PRACTICE_CONST.DEFAULT_BPM,
  stepsDone: 0,
  startedAt: 0,
  pausedMs: 0,
  pausedAt: 0,
  pendingSongId: '',
  _cdTimer: null,      // 倒计时句柄
  _goTimer: null,      // GO 显示后的短暂延时
  _tickTimer: null,    // 250ms 计时句柄
  _visHandler: null,   // visibilitychange 具名 handler
  _inited: false,

  /* 曲卡主路径：prepare(id) → go('songPractice') */
  prepare(songId) {
    this.pendingSongId = songId || '';
  },

  enter() {
    this.init();
    const id = this.pendingSongId || this.hashSongId() || '';
    const song = id ? songById(id) : null;
    this.pendingSongId = '';
    /* V4.1：旧的「分步计时 + 曲谱外链」页已被 GuitarPicker 式演奏视图取代。
       这里统一转发，避免任何人再通过旧路由看到只有链接的页面。 */
    if (song) {
      try {
        if (typeof SongPlay !== 'undefined' && SongPlay) {
          SongPlay.prepare(id);
          goRoute('songPlay');
          return;
        }
      } catch (e) { /* 演奏模块不可用时退回旧页 */ }
    }
    if (!id || !song) {                    // E2：无曲目 / 曲目不存在
      this.songId = '';
      this.song = null;
      this.renderNotFound();
      return;
    }
    this.songId = id;
    this.song = song;
    this.stepsDone = 0;
    this.state = 'idle';
    this.renderIdle();
  },

  /* E18：直接刷新时从 hash query 兜底取曲目 */
  hashSongId() {
    try {
      const h = (typeof window !== 'undefined' ? window.location.hash : '') || '';
      const q = h.split('?')[1] || '';
      const m = /(?:^|&)song=([^&]+)/.exec(q);
      return m ? decodeURIComponent(m[1]) : '';
    } catch (e) { return ''; }
  },

  init() {
    if (this._inited) return;
    const wrap = document.getElementById('spWrap');
    if (!wrap) return;
    this._inited = true;
    wrap.addEventListener('click', (e) => this.onClick(e));
    wrap.addEventListener('input', (e) => {
      const r = e.target.closest('#spBpm');
      if (r) { this.bpm = clampBpm(r.value); const v = document.getElementById('spBpmVal'); if (v) v.textContent = this.bpm; }
    });
  },

  /* E4：切后台自动暂停；回前台不自动续拍（防误走拍）。
     具名 handler 保存引用，cleanup 可移除。 */
  bindVisibility() {
    if (this._visHandler) return;
    this._visHandler = () => {
      if (document.hidden && this.state === 'running') {
        this.dispatch('PAUSE');
        toastSafe(T('songbook.practice.pausedHint'), 'warn');
      }
    };
    document.addEventListener('visibilitychange', this._visHandler);
  },

  onClick(e) {
    const btn = e.target.closest('[data-sp]');
    if (!btn || btn.disabled) return;
    const act = btn.dataset.sp;
    if (act === 'start') { this.dispatch('START'); return; }
    if (act === 'cancel') { this.dispatch('CANCEL'); return; }
    if (act === 'pause') { this.dispatch(this.state === 'paused' ? 'RESUME' : 'PAUSE'); return; }
    if (act === 'finish') { this.dispatch('FINISH'); return; }
    if (act === 'save') { this.save(); return; }
    if (act === 'discard') { this.dispatch('DISCARD'); return; }
    if (act === 'back') { this.cleanup(); goRoute('songbook'); return; }
    const step = btn.dataset.step;
    if (step) {
      const on = !btn.classList.contains('is-done');
      btn.classList.toggle('is-done', on);
      this.stepsDone = document.querySelectorAll('#spWrap .sp-step.is-done').length;
    }
  },

  dispatch(event) {
    const from = this.state;
    const to = nextState(from, event);
    if (to === from) return false;          // E12：非法迁移保持原状态
    this.state = to;
    this.onEnter(to, event);
    return true;
  },

  onEnter(state, event) {
    if (state === 'countdown') this.startCountdown();
    else if (state === 'running') {
      if (event === 'TICK') this.beginRunning();
      else this.resumeRunning();
    } else if (state === 'paused') this.pauseRunning();
    else if (state === 'result') this.renderResult();
    else if (state === 'idle') {
      if (event === 'CANCEL' || event === 'SAVE' || event === 'DISCARD') {
        this.clearCountdown();
        this.clearTick();
        this.stopTransport();
        this.renderIdle();
      }
    }
  },

  /* ---------- 倒计时 ---------- */
  startCountdown() {
    this.clearCountdown();
    const seq = countdownSequence();
    this.renderCountdown(seq[0]);
    let i = 0;
    this._cdTimer = setInterval(() => {
      i += 1;
      if (i < seq.length) { this.renderCountdown(seq[i]); return; }
      this.renderGo();
      this.clearCountdown();                // ① 进入 running 前必清
      this._goTimer = setTimeout(() => { this._goTimer = null; this.dispatch('TICK'); }, 600);
    }, 1000);
  },
  clearCountdown() {
    if (this._cdTimer) { clearInterval(this._cdTimer); this._cdTimer = null; }
    if (this._goTimer) { clearTimeout(this._goTimer); this._goTimer = null; }
  },

  /* ---------- 练习中 ---------- */
  async beginRunning() {
    this.startedAt = Date.now();
    this.pausedMs = 0;
    this.pausedAt = 0;
    this.bindVisibility();
    const ok = await this.startTransport();
    if (!ok) return;                        // E7：起播失败已 toast 并回 idle
    this.renderRunning();
    this.clearTick();
    this._tickTimer = setInterval(() => this.updateClock(), TICK_MS);
  },
  async resumeRunning() {
    if (this.pausedAt) { this.pausedMs += Date.now() - this.pausedAt; this.pausedAt = 0; }
    const ok = await this.startTransport();
    if (!ok) return;
    this.renderRunning();
    this.clearTick();
    this._tickTimer = setInterval(() => this.updateClock(), TICK_MS);
  },
  pauseRunning() {
    this.pausedAt = Date.now();
    this.clearTick();
    try {
      if (typeof Transport !== 'undefined' && Transport && typeof Transport.pause === 'function') Transport.pause();
    } catch (e) { /* 暂停失败不阻断结算 */ }
    const btn = document.getElementById('spPause');
    if (btn) btn.textContent = T('songbook.practice.resume');
  },

  async startTransport() {
    try {
      if (typeof Transport === 'undefined' || !Transport) return true;   // E6：无音频环境 → 无声计时
      Transport.setBpm(this.bpm);
      await Transport.start();
      return true;
    } catch (e) {
      toastSafe(T('songbook.practice.audioFail'), 'err');
      this.state = 'idle';
      this.renderIdle();
      return false;
    }
  },
  stopTransport(keepPos) {
    try {
      if (typeof Transport !== 'undefined' && Transport && typeof Transport.stop === 'function') Transport.stop();
    } catch (e) { /* 停止失败不影响结算 */ }
    if (!keepPos) this.pausedAt = 0;
  },
  updateClock() {
    const el = document.getElementById('spElapsed');
    if (!el) return;
    const ms = this.state === 'paused' && this.pausedAt
      ? elapsedMs(this.startedAt, this.pausedAt, this.pausedMs)
      : elapsedMs(this.startedAt, Date.now(), this.pausedMs);
    el.textContent = fmtClock(ms);
  },
  clearTick() {
    if (this._tickTimer) { clearInterval(this._tickTimer); this._tickTimer = null; }
  },

  /* ---------- 结算与打卡 ---------- */
  save() {
    const steps = document.querySelectorAll('#spWrap .sp-step.is-done').length;
    const noteEl = document.getElementById('spNote');
    const note = noteEl ? String(noteEl.value || '').slice(0, NOTE_MAX) : '';
    const endedAt = Date.now();
    const durationMs = this.state === 'paused' && this.pausedAt
      ? elapsedMs(this.startedAt, this.pausedAt, this.pausedMs)
      : elapsedMs(this.startedAt, endedAt, this.pausedMs);
    const rec = buildSession({
      songId: this.songId,
      unit: this.song ? this.song.unit : '',
      tier: this.song ? this.song.tier : null,
      stepsDone: steps,
      note,
      bpm: this.bpm,
      startedAt: this.startedAt,
      endedAt,
      durationMs
    });
    let saved = null;
    try {
      if (typeof PracticeStore !== 'undefined' && PracticeStore) saved = PracticeStore.addSession(rec);
    } catch (e) { saved = null; }
    if (!saved) {                            // E8：写入失败停留结算页
      toastSafe(T('songbook.result.saveFail'), 'err');
      return;
    }
    toastSafe(T('songbook.result.saved'), 'ok');
    this.dispatch('SAVE');
    goRoute('songbook');
  },

  /* ---------- 渲染 ---------- */
  renderNotFound() {
    const wrap = document.getElementById('spWrap');
    if (!wrap) return;
    wrap.innerHTML = `<div class="card sp-empty">
      <div class="sp-empty-txt">${esc(T('songbook.notFound'))}</div>
      <button class="btn btn-primary" data-sp="back">${esc(T('songbook.back'))}</button>
    </div>`;
  },

  renderIdle() {
    const wrap = document.getElementById('spWrap');
    const s = this.song;
    if (!wrap || !s) { this.renderNotFound(); return; }
    const title = document.getElementById('topbarTitle');
    if (title) title.textContent = s.title;
    const rec = (s.sheets && s.sheets[0]) || null;
    const recLink = rec && rec.url
      ? `<a class="btn btn-primary" href="${esc(rec.url)}" target="_blank" rel="noopener noreferrer">${esc(T('songbook.practice.recommended'))}</a>`
      : '';
    const note = (s.tier === 3 && s.note) ? `<div class="sp-note">${esc(s.note)}</div>` : '';
    wrap.innerHTML = `
      <div class="card sp-prepare">
        <div class="sp-song">
          <h2 class="sp-title">${esc(s.title)}</h2>
          <div class="sp-meta">${esc(s.artist)} · ${esc(s.duration)} · ${esc(T('songbook.tier.' + s.tier))}</div>
          ${note}
        </div>
        <div class="sp-capo">${esc(T('songbook.practice.capo'))}<span>${esc(rec ? rec.name : '—')}</span></div>
        ${recLink}
        <div class="sp-bpm-row">
          <label for="spBpm">${esc(T('songbook.practice.bpm'))}</label>
          <input type="range" id="spBpm" min="${PRACTICE_CONST.MIN_BPM}" max="${PRACTICE_CONST.MAX_BPM}" step="1" value="${clampBpm(this.bpm)}">
          <b id="spBpmVal">${clampBpm(this.bpm)}</b>
        </div>
        <button class="btn btn-primary" data-sp="start">${esc(T('songbook.practice.go'))}</button>
        <button class="btn btn-ghost" data-sp="back">${esc(T('songbook.back'))}</button>
      </div>`;
  },

  renderCountdown(n) {
    const wrap = document.getElementById('spWrap');
    if (!wrap) return;
    wrap.innerHTML = `
      <div class="sp-count"><span class="sp-count-num">${Number(n)}</span>
        <button class="btn btn-ghost sp-count-cancel" data-sp="cancel">${esc(T('songbook.practice.cancel'))}</button>
      </div>
      <div class="sp-hud-bottom"><button class="btn-mini" data-sp="cancel">${esc(T('songbook.practice.cancel'))}</button></div>`;
  },
  renderGo() {
    const wrap = document.getElementById('spWrap');
    if (!wrap) return;
    const num = wrap.querySelector('.sp-count-num');
    if (num) num.textContent = T('songbook.practice.goLabel');
  },

  renderRunning() {
    const wrap = document.getElementById('spWrap');
    const s = this.song;
    if (!wrap || !s) return;
    const steps = [1, 2, 3, 4].map((i) => `
      <button class="sp-step${this.stepsDone >= i ? ' is-done' : ''}" data-step="${i}">
        <span class="sp-step-i">${i}</span>${esc(T('songbook.step.' + i))}
      </button>`).join('');
    const rec = (s.sheets && s.sheets[0]) || null;
    const openLink = rec && rec.url
      ? `<a class="btn-mini" href="${esc(rec.url)}" target="_blank" rel="noopener noreferrer">${esc(T('songbook.practice.openSheet'))}</a>`
      : '';
    const paused = this.state === 'paused';
    wrap.innerHTML = `
      <div class="sp-hud-top">
        <div class="sp-hud-song">${esc(s.title)}</div>
        <div class="sp-hud-bpm">${esc(clampBpm(this.bpm))} BPM</div>
        <div class="sp-hud-time"><span id="spElapsed">${fmtClock(elapsedMs(this.startedAt, Date.now(), this.pausedMs))}</span></div>
      </div>
      <div class="sp-center">
        <div class="sp-steps">${steps}</div>
        ${openLink}
      </div>
      <div class="sp-hud-bottom">
        <button class="btn" id="spPause" data-sp="pause">${esc(paused ? T('songbook.practice.resume') : T('songbook.practice.pause'))}</button>
        <button class="btn btn-primary" data-sp="finish">${esc(T('songbook.practice.finish'))}</button>
      </div>`;
  },

  renderResult() {
    this.clearTick();
    this.stopTransport();
    const wrap = document.getElementById('spWrap');
    const s = this.song;
    if (!wrap || !s) return;
    const ms = this.pausedAt ? elapsedMs(this.startedAt, this.pausedAt, this.pausedMs)
      : elapsedMs(this.startedAt, Date.now(), this.pausedMs);
    const steps = [1, 2, 3, 4].map((i) => `
      <button class="sp-step${this.stepsDone >= i ? ' is-done' : ''}" data-step="${i}">
        <span class="sp-step-i">${i}</span>${esc(T('songbook.step.' + i))}
      </button>`).join('');
    wrap.innerHTML = `
      <div class="card sp-result">
        <div class="sp-result-title">${esc(T('songbook.result.title'))}</div>
        <div class="sp-result-row"><span>${esc(T('songbook.practice.elapsed'))}</span><b>${esc(fmtClock(ms))}</b></div>
        <div class="sp-result-row"><span>${esc(T('songbook.practice.bpm'))}</span><b>${esc(clampBpm(this.bpm))}</b></div>
        <div class="sp-result-row"><span>${esc(T('songbook.result.steps'))}</span><b>${esc(String(this.stepsDone))}/4</b></div>
        <div class="sp-steps">${steps}</div>
        <textarea id="spNote" class="sp-note" maxlength="${NOTE_MAX}" placeholder="${esc(T('songbook.result.note'))}"></textarea>
        <div class="sp-result-actions">
          <button class="btn btn-primary" data-sp="save">${esc(T('songbook.result.save'))}</button>
          <button class="btn btn-ghost" data-sp="discard">${esc(T('songbook.result.discard'))}</button>
        </div>
      </div>`;
  },

  /* ---------- 清理（离开视图 / re-init 前必执行） ---------- */
  cleanup() {
    this.clearCountdown();
    this.clearTick();
    this.stopTransport();
    if (this._visHandler) {
      try { document.removeEventListener('visibilitychange', this._visHandler); } catch (e) {}
      this._visHandler = null;
    }
    this.state = 'idle';
    this.stepsDone = 0;
    this.pausedAt = 0;
    this.pausedMs = 0;
  }
};

if (typeof onRouteEnter !== 'undefined' && onRouteEnter) onRouteEnter.songPractice = () => SongPractice.enter();
if (typeof window !== 'undefined') window.SongPractice = SongPractice;
export { SongPractice };
export default SongPractice;
