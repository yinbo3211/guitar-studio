/* ============================================================
   六弦工坊 V3 · 通用工具 core/ui
   （M3 目录重构：由 V2 app-*.js 拆分，代码体保持不变）
   ============================================================ */
'use strict';

/* ============================================================
   六弦工坊 · 主脚本
   ============================================================ */
'use strict';

/* ---------- 通用工具 ----------
   V2 M1：算法与常量已迁移至 lib/audio-core.js（AudioCore），
   此处仅解构为原有名称，保证后续代码零改动、行为一致。 */
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
const { clamp, midiFromFreq, freqFromMidi, NOTE_NAMES, NOTE_CN, noteName, noteNameNoOct,
        makeSmoother, PitchDetect } = AudioCore;
const SVG_ICONS = {
  mic:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><path d="M12 18v3"/></svg>',
  play:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l11-6.5a1 1 0 0 0 0-1.72l-11-6.5A1 1 0 0 0 8 5.5z"/></svg>',
  stop:'<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2.5"/></svg>',
  check:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  close:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>'
};

/* ---------- S0.4 XSS 边界规范 ----------
   规则：任何「用户可输入内容」（自定义命名、备注、导入的 JSON 文本等）
   进入 innerHTML 前必须经 esc() 转义；优先使用 textContent 渲染。
   esc() 同时挂在 window 上，供各模块直接调用。 */
function esc(v){
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toast(msg, type='info', ms=2200){
  const wrap = $('#toastWrap');
  const el = document.createElement('div');
  el.className = 'toast';
  const colors = {info:'var(--cyan)', ok:'var(--mint)', err:'var(--red)', warn:'var(--amber)'};
  el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="${colors[type]||'var(--cyan)'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.01"/></svg><span>${esc(msg)}</span>`;
  wrap.appendChild(el);
  setTimeout(()=>{ el.classList.add('out'); setTimeout(()=>el.remove(), 320); }, ms);
}

/* 跨模块共享的音高工具（原 app-3.js 头部 baseMidi，Game/Scale 共用） */
function baseMidi(freq){
  const a4 = (typeof Tuner!=='undefined' && Tuner.a4) ? Tuner.a4 : 440;
  return 69 + 12*Math.log2(freq/a4);
}
const _baseMidi = baseMidi;
Object.assign(window, { $: $, $$: $$, SVG_ICONS: SVG_ICONS, toast: toast, baseMidi, esc });
export { $, $$, SVG_ICONS, toast, baseMidi, esc };
