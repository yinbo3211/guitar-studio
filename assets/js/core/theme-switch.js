/* ============================================================
   六弦工坊 V3 · core/theme-switch.js
   ------------------------------------------------------------
   R-THEME-01/02、R-AUTO-01～04：
     · 7 套主题 CSS 全量预载（tokens 后、html[data-theme] 作用域），
       切换零网络请求、零延迟；
     · gs.prefs.theme ∈ auto|neon|dawn|vintage|cyber|forest|rose|mono，
       缺省 auto；auto 按 prefers-color-scheme 映射 dark→neon / light→dawn；
     · matchMedia change 实时跟随；手动点选具体主题退出 auto；
     · 首屏防闪由 app.html <head> 内联脚本负责（本模块只管运行时）。
   ============================================================ */
'use strict';

import { store } from './store.js';

export const THEMES = [
  { key: 'neon',    name: { 'zh-CN': '霓虹暗夜', en: 'Neon Night',  ja: 'ネオンナイト', ko: '네온 나이트' } },
  { key: 'dawn',    name: { 'zh-CN': '晨曦浅色', en: 'Dawn Light',  ja: 'ドーンライト', ko: '던 라이트' } },
  { key: 'vintage', name: { 'zh-CN': '复古木吉他', en: 'Vintage Wood', ja: 'ヴィンテージ', ko: '빈티지 우드' } },
  { key: 'cyber',   name: { 'zh-CN': '赛博紫', en: 'Cyber Purple', ja: 'サイバー紫', ko: '사이버 퍼플' } },
  { key: 'forest',  name: { 'zh-CN': '森野绿', en: 'Forest Green', ja: 'フォレスト', ko: '포레스트 그린' } },
  { key: 'rose',    name: { 'zh-CN': '玫瑰金', en: 'Rose Gold',   ja: 'ローズゴールド', ko: '로즈골드' } },
  { key: 'mono',    name: { 'zh-CN': '极简灰', en: 'Mono Grey',   ja: 'モノグレー', ko: '모노 그레이' } },
];

const darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function resolveAuto() {
  return darkQuery && !darkQuery.matches ? 'dawn' : 'neon';
}

function currentThemeKey() {
  const pref = store.read().theme || 'auto';
  return pref === 'auto' ? resolveAuto() : pref;
}

export function applyTheme() {
  document.documentElement.dataset.theme = currentThemeKey();
}

export function setTheme(pref) {
  store.write({ theme: pref });        // auto 或具体主题 key（R-AUTO-04 状态互斥）
  applyTheme();
  document.dispatchEvent(new CustomEvent('gs:theme', { detail: { pref, applied: document.documentElement.dataset.theme } }));
}

/* ---------- 主题面板（自绘轻量模态，不依赖路由内部结构） ---------- */
function openPanel() {
  let ov = document.querySelector('#gsThemePanel');
  if (ov) { ov.remove(); return; }
  const pref = store.read().theme || 'auto';
  const chip = (p, label) =>
    `<button class="preset-chip gs-theme-chip" data-pref="${p}" style="${pref === p ? 'background:var(--grad-amber);color:#1a1206;border-color:transparent;font-weight:600' : ''}">${label}</button>`;
  ov = document.createElement('div');
  ov.id = 'gsThemePanel';
  ov.style.cssText = 'position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.5);display:grid;place-items:center;backdrop-filter:blur(4px)';
  ov.innerHTML = `<div style="background:var(--card);border:1px solid var(--line-strong);border-radius:var(--radius);padding:22px;max-width:420px;width:calc(100% - 40px);box-shadow:0 20px 60px -12px rgba(0,0,0,.6)">
      <div style="font-family:var(--font-display);font-size:17px;font-weight:600;margin-bottom:6px">主题外观</div>
      <div style="font-size:12.5px;color:var(--txt-2);margin-bottom:14px">跟随系统时按操作系统深浅色自动切换</div>
      <div class="preset-row" style="margin-top:0" id="gsThemeRow">
        ${chip('auto', `跟随系统（${(THEMES.find(t => t.key === resolveAuto()) || {}).name[gsLang] || ''}）`)}
        ${THEMES.map(t => chip(t.key, t.name[gsLang] || t.key)).join('')}
      </div>
      <div style="text-align:right;margin-top:18px"><button class="preset-chip" id="gsThemeClose">关闭</button></div>
    </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', (e) => {
    if (e.target === ov || e.target.id === 'gsThemeClose') { ov.remove(); return; }
    const b = e.target.closest('button.gs-theme-chip');
    if (!b) return;
    setTheme(b.dataset.pref);
    ov.remove();
    openPanel();   // 重开以刷新选中态
  });
}

// Bug4 修复：初值必须从持久化语言读取，否则刷新后首开主题面板（尚未触发 gs:lang 事件）
// 的非中文用户会看到中文主题名。
let gsLang = (store.read().lang) || 'zh-CN';
document.addEventListener('gs:lang', (e) => { gsLang = (e.detail && e.detail.lang) || 'zh-CN'; });

/* 侧栏 / 顶栏入口注入 */
function injectEntry() {
  const make = (parent) => {
    // BUG-08 修复：去重判断只查父容器内部，允许侧栏与顶栏各自存在入口
    if (!parent || parent.querySelector('.gs-theme-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'nav-item gs-theme-btn';
    btn.style.cssText = 'border:none;background:none;cursor:pointer;font:inherit;color:inherit;';
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none"/></svg>';
    btn.onclick = openPanel;
    parent.appendChild(btn);
  };
  make(document.querySelector('.sidebar'));
  make(document.querySelector('.topbar'));
}

function init() {
  applyTheme();
  injectEntry();
  if (darkQuery) {
    const onChange = () => { if ((store.read().theme || 'auto') === 'auto') applyTheme(); };
    if (darkQuery.addEventListener) darkQuery.addEventListener('change', onChange);
    else if (darkQuery.addListener) darkQuery.addListener(onChange);   // 旧 Safari
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

window.gsTheme = { applyTheme, setTheme, THEMES, currentThemeKey };
export { init as initThemeSwitch };
export default { applyTheme, setTheme, THEMES };
