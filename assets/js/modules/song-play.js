/* ============================================================
   六弦工坊 V4.1 · 模块：弹唱演奏（GuitarPicker note-highway 宿主壳）
   ------------------------------------------------------------
   · 把移植进来的 gp/play.js 挂到宿主路由 songPlay 上；
   · 负责：进入时建视图、离开/切换时执行 teardown（停麦、停伴奏、
     解绑 keydown/ResizeObserver），避免计时器与麦克风泄漏；
   · 导航映射：GuitarPicker 的 #/library / #/history / #/locker
     分别落到宿主的 songbook / stats / settings；
   · 曲目来源：曲卡 prepare(id) 进入，或 URL ?song=<id> 兜底。
   ============================================================ */
'use strict';

import playView from '../gp/play.js';
import { defById } from '../gp/catalog.js';

/* GuitarPicker 内部路由 → 宿主路由 */
const NAV = { '#/library': 'songbook', '#/history': 'stats', '#/locker': 'settings' };

function goRoute(route) {
  try { if (typeof go === 'function') { go(route); return; } } catch (e) { /* 无路由函数时回退 hash */ }
  if (typeof window !== 'undefined') window.location.hash = '#/' + route;
}

const SongPlay = {
  pendingId: '',        // 曲卡点击写入
  songId: '',
  teardown: null,
  busy: false,

  /** 曲卡主路径：prepare(id) → go('songPlay') */
  prepare(id) { this.pendingId = id || ''; },

  /** E18：直接刷新/深链时从 ?song= 取曲目 */
  hashId() {
    try {
      const h = (typeof window !== 'undefined' ? window.location.hash : '') || '';
      const q = h.split('?')[1] || '';
      const m = /(?:^|&)song=([^&]+)/.exec(q);
      return m ? decodeURIComponent(m[1]) : '';
    } catch (e) { return ''; }
  },

  enter() {
    const root = document.getElementById('gpPlayRoot');
    if (!root) return;
    this.leave();                                   // 先把上一次拆干净
    const id = this.pendingId || this.hashId() || '';
    this.pendingId = '';
    this.songId = id;
    const def = defById(id);
    if (!def) { this.renderNotFound(root); return; }

    const self = this;
    const ctx = {
      el: root,
      params: [id],
      navigate: (hash) => { self.leave(); goRoute(NAV[hash] || 'songbook'); },
    };
    this.busy = true;
    Promise.resolve(playView(ctx))
      .then((fn) => { self.teardown = typeof fn === 'function' ? fn : null; })
      .catch((err) => { console.warn('[song-play] 演奏视图初始化失败：', err); self.renderError(root); })
      .finally(() => { self.busy = false; });
  },

  leave() {
    if (typeof this.teardown === 'function') {
      try { this.teardown(); } catch (e) { console.warn('[song-play] teardown 异常：', e); }
    }
    this.teardown = null;
  },

  renderNotFound(root) {
    root.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'gp-scope';
    box.innerHTML = `<div class="panel" style="margin:22px">
      <h2>Song not found</h2>
      <p class="muted">No song matches “${String(this.songId || '').replace(/[<>&]/g, '')}”.</p>
    </div>`;
    const back = document.createElement('button');
    back.className = 'btn';
    back.textContent = '← Songs';
    back.addEventListener('click', () => goRoute('songbook'));
    box.querySelector('.panel').appendChild(back);
    root.appendChild(box);
  },

  renderError(root) {
    root.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'gp-scope';
    box.innerHTML = `<div class="panel" style="margin:22px">
      <h3>Play view failed to start</h3>
      <p class="muted">Check the browser console for details.</p>
    </div>`;
    root.appendChild(box);
  },
};

if (typeof onRouteEnter !== 'undefined' && onRouteEnter) {
  onRouteEnter.songPlay = () => SongPlay.enter();
}
/* 路由切走时停麦停伴奏（与 Metro/Rhythm 等模块同一清理时机） */
if (typeof cleanupModules !== 'undefined' && typeof cleanupModules === 'function') {
  const prev = cleanupModules;
  if (typeof window !== 'undefined') {
    window.cleanupModules = function () { SongPlay.leave(); return prev.apply(this, arguments); };
  }
}
if (typeof window !== 'undefined') window.SongPlay = SongPlay;

export { SongPlay };
export default SongPlay;
