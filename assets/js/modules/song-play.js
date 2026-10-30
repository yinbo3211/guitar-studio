/* ============================================================
   六弦工坊 V4.1 · 模块：弹唱演奏（GuitarPicker note-highway 宿主壳）
   ------------------------------------------------------------
   · 把移植进来的 gp/play.js 挂到宿主路由 songPlay 上；
   · 负责：进入时建视图、离开/切换时执行 teardown（停麦、停伴奏、
     解绑 keydown/ResizeObserver），避免计时器与麦克风泄漏；
   · 导航映射：GuitarPicker 的 #/library / #/history 分别落到宿主的 songbook / stats；
   · 曲目来源：曲卡 prepare(id) 进入，或 URL ?song=<id> 兜底。
   ============================================================ */
'use strict';

import playView from '../gp/play.js';
import { defById } from '../gp/catalog.js';

/* GuitarPicker 内部路由 → 宿主路由。
   V4.2.6 N-3：上游残留的 '#/locker'（GuitarPicker 的 Locker 装扮商店，本仓未移植，
   见 NOTICE.md）已随 play.js 结算横幅的「外观」按钮一起删除，NAV 同步移除该死映射
   —— ROUTE_TITLES 无 settings 路由，原映射点击后会被 core/router.js 兜底回 #/home。
   ⚠️ 新增任何 NAV 项前必须确认目标存在于 ROUTE_TITLES 且有 #view-<route> 视图，
      否则就是新的死链（test/gp-play-v426.test.js V6-3b 已加通用护栏）。 */
const NAV = { '#/library': 'songbook', '#/history': 'stats' };

/* i18n 取词兜底：t 由 core/i18n 挂到 window；Node 单测环境退化为返回 key */
function T(k) {
  try {
    if (typeof window !== 'undefined' && typeof window.t === 'function') return window.t(k);
    if (typeof t === 'function') return t(k);
  } catch (e) { /* 忽略：无 i18n 环境用 key 兜底 */ }
  return k;
}
/** 占位符替换（{id} 等一律走这里，绝不拼进 HTML 模板 —— BUG-06） */
function TF(k, pairs) {
  let s = T(k);
  for (const a of Object.keys(pairs || {})) s = s.split('{' + a + '}').join(String(pairs[a]));
  return s;
}

function goRoute(route) {
  try { if (typeof go === 'function') { go(route); return; } } catch (e) { /* 无路由函数时回退 hash */ }
  if (typeof window !== 'undefined') window.location.hash = '#/' + route;
}

const SongPlay = {
  pendingId: '',        // 曲卡点击写入
  songId: '',
  teardown: null,
  busy: false,
  _gen: 0,              // 会话代次：离开/重进时使在途初始化失效

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
    this.leave();                                   // 停止旧实例并使在途初始化失效
    const root = document.getElementById('gpPlayRoot');
    if (!root) return;
    root.innerHTML = '';                            // 兜住 teardown 尚未就绪的竞态窗口
    /* 关键：GuitarPicker 的 CSS 全部收敛在 .gp-scope 下，根容器必须带这个类，
       否则演奏界面完全无样式（画布/HUD/控制条全部塌陷）。 */
    root.className = 'gp-scope';
    const id = this.pendingId || this.hashId() || '';
    this.pendingId = '';
    this.songId = id;
    const def = defById(id);
    if (!def) { this.renderNotFound(root); return; }

    const self = this;
    const gen = ++this._gen;
    const ctx = {
      el: root,
      params: [id],
      navigate: (hash) => { self.leave(); goRoute(NAV[hash] || 'songbook'); },
    };
    this.busy = true;
    Promise.resolve(playView(ctx))
      .then((fn) => {
        if (gen !== self._gen) {
          if (typeof fn === 'function') {
            try { fn(); } catch (e) { console.warn('[song-play] 过期实例 teardown 异常：', e); }
          }
          return;
        }
        self.teardown = typeof fn === 'function' ? fn : null;
      })
      .catch((err) => {
        if (gen !== self._gen) return;
        console.warn('[song-play] 演奏视图初始化失败：', err);
        self.renderError(root);
      })
      .finally(() => {
        if (gen === self._gen) self.busy = false;
      });
  },

  leave() {
    this._gen++;                                    // 使在途 Promise 立即过期
    if (typeof this.teardown === 'function') {
      try { this.teardown(); } catch (e) { console.warn('[song-play] teardown 异常：', e); }
    }
    this.teardown = null;
    this.busy = false;
    const root = document.getElementById('gpPlayRoot');
    if (root) root.innerHTML = '';
  },

  renderNotFound(root) {
    root.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'gp-scope';
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.style.margin = '22px';
    /* BUG-06：id 来自 URL / 深链，必须走 textContent，不再拼进 innerHTML */
    const h2 = document.createElement('h2');
    h2.textContent = T('play.notFound.title');
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = TF('play.notFound.detail', { id: String(this.songId || '') });
    panel.append(h2, p);
    const back = document.createElement('button');
    back.className = 'btn';
    back.textContent = T('play.backToSongs');
    back.addEventListener('click', () => goRoute('songbook'));
    panel.appendChild(back);
    box.appendChild(panel);
    root.appendChild(box);
  },

  renderError(root) {
    root.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'gp-scope';
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.style.margin = '22px';
    const h3 = document.createElement('h3');
    h3.textContent = T('play.error.title');
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = T('play.error.detail');
    panel.append(h3, p);
    box.appendChild(panel);
    root.appendChild(box);
  },
};

if (typeof onRouteEnter !== 'undefined' && onRouteEnter) {
  onRouteEnter.songPlay = () => SongPlay.enter();
}
/* BUG-07：演奏中切换语言时重建演奏视图。play.js 的静态文案在建视图时取词，
   不重建就会停留在旧语言；重建会保留当前曲目并从开头重新准备（不影响兜底页）。 */
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('gs:lang', () => {
    const view = document.getElementById('view-songPlay');
    if (!view || !view.classList.contains('active')) return;
    if (!SongPlay.songId) return;
    SongPlay.pendingId = SongPlay.songId;
    try { SongPlay.enter(); } catch (e) { console.warn('[song-play] 语言切换后重建失败：', e); }
  });
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
