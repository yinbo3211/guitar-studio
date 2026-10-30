/* ============================================================
   六弦工坊 V3 · core/i18n.js
   ------------------------------------------------------------
   R-I18N：中英日韩四语运行时。
     · 静态 data-i18n / data-i18n-ph（占位符）扫描；
     · t(key) 运行时取词，缺词回退 zh-CN；
     · gs.prefs.lang 持久化（store.js），setLang 广播 gs:lang 事件
       （主题面板等动态 UI 据此刷新）。
   词条覆盖范围：导航 / 首页 / 通用动作 / 主题·语言面板（chrome 层）。
   各模块深水区文案按 PRD §7.2 词条结构在后续迭代中接入。
   ============================================================ */
'use strict';

import { store } from './store.js';
import { DICT as ZH } from '../i18n/zh-CN.js';
import { DICT as EN } from '../i18n/en.js';
import { DICT as JA } from '../i18n/ja.js';
import { DICT as KO } from '../i18n/ko.js';

export const LANGS = [
  { key: 'zh-CN', label: '中文' },
  { key: 'en', label: 'English' },
  { key: 'ja', label: '日本語' },
  { key: 'ko', label: '한국어' },
];

const DICTS = { 'zh-CN': ZH, en: EN, ja: JA, ko: KO };

let current = store.read().lang || 'zh-CN';

export function t(key) {
  return (DICTS[current] && DICTS[current][key]) ?? ZH[key] ?? key;
}

export function getLang() { return current; }

export function setLang(lang) {
  if (!DICTS[lang]) return;
  current = lang;
  store.write({ lang });
  document.documentElement.setAttribute('lang', lang);
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  syncAriaLabels();
  document.dispatchEvent(new CustomEvent('gs:lang', { detail: { lang } }));
}

/* V4.2.6 N-4：给纯图标按钮补可访问名，复用既有词条（theme.title / lang.title），零新增 key。
   对象由浏览器实测（CDP Accessibility.getFullAXTree）确定：全站无名按钮只有这两个
   （`.gs-theme-btn` 主题切换、`.gs-lang-btn` 语言切换），均由 JS 注入、纯 SVG、无文本。
   纠正需求源结论：`.nav-item` / `.tab`（首页/调音器…）内部本就有 `<span data-i18n>`
   文本节点，AX 树里可访问名正确，无需补 label。
   放本文件而不是 theme-switch.js：后者在 main.js 中先于 i18n 执行，彼时 window.t 未挂载，
   取词时机不可靠；而两个按钮在 i18n init / injectEntry 之前就已建好，这里补齐最稳。 */
function syncAriaLabels() {
  document.querySelectorAll('.gs-theme-btn').forEach((b) => b.setAttribute('aria-label', t('theme.title')));
  document.querySelectorAll('.gs-lang-btn').forEach((b) => b.setAttribute('aria-label', t('lang.title')));
}

/* 语言面板（与主题面板同风格） */
function openLangPanel() {
  let ov = document.querySelector('#gsLangPanel');
  if (ov) { ov.remove(); return; }
  const chip = (p, label) =>
    `<button class="preset-chip gs-lang-chip" data-lang="${p}" style="${current === p ? 'background:var(--grad-amber);color:#1a1206;border-color:transparent;font-weight:600' : ''}">${label}</button>`;
  ov = document.createElement('div');
  ov.id = 'gsLangPanel';
  ov.style.cssText = 'position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.5);display:grid;place-items:center;backdrop-filter:blur(4px)';
  ov.innerHTML = `<div style="background:var(--card);border:1px solid var(--line-strong);border-radius:var(--radius);padding:22px;max-width:360px;width:calc(100% - 40px)">
      <div style="font-family:var(--font-display);font-size:17px;font-weight:600;margin-bottom:14px">语言 / Language</div>
      <div class="preset-row" style="margin-top:0" id="gsLangRow">${LANGS.map(l => chip(l.key, l.label)).join('')}</div>
      <div style="text-align:right;margin-top:18px"><button class="preset-chip" id="gsLangClose">关闭 / Close</button></div>
    </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', (e) => {
    if (e.target === ov || e.target.id === 'gsLangClose') { ov.remove(); return; }
    const b = e.target.closest('button.gs-lang-chip');
    if (!b) return;
    setLang(b.dataset.lang);
    ov.remove();
    openLangPanel();
  });
}

function injectEntry() {
  const side = document.querySelector('.sidebar');
  if (side && !document.querySelector('.gs-lang-btn')) {
    const btn = document.createElement('button');
    btn.className = 'nav-item gs-lang-btn';
    btn.style.cssText = 'border:none;background:none;cursor:pointer;font:inherit;color:inherit;';
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 5h9M8.5 3v2M6 5c0 4-1 7-4 9M9 5c0 5 3 8 6 9m-4-4c-1 2-3 4-6 5"/><path d="M15 21l4-9 4 9m-6.7-3h5.4"/></svg>';
    btn.onclick = openLangPanel;
    side.appendChild(btn);
  }
}

function init() {
  document.documentElement.setAttribute('lang', current);
  // 静态词条扫描（main.js 模块加载完成后 DOM 已就绪）
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  injectEntry();
  syncAriaLabels();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

window.gsI18n = { t, setLang, getLang, LANGS };
window.t = t;   // V3.1 F9：供各模块直接取词（缺词回退 zh-CN）
export { init as initI18n };
export default { t, setLang, getLang, LANGS };
