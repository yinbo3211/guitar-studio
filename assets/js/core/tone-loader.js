/* ============================================================
   六弦工坊 V3 · core/tone-loader.js
   ------------------------------------------------------------
   R-TONE-04 / R-ESM-06：本地 vendor 优先 → esm.sh → jsdelivr，
   全部失败返回 null（页面继续以原生 Web Audio 运行，零 npm 依赖）。
   ============================================================ */
'use strict';

/* 物理机实测修复：原写 15.8.6，npm 上并不存在该版本（latest 为 15.1.22），
   三个 CDN 来源全部 404 → Tone 永远加载失败 → 一直走原生后端。
   这里改为真实存在的版本，并在加载失败时明确告警，便于排查。 */
const TONE_VERSION = '15.1.22';

let _tonePromise = null;
let _fallbackWarned = false;

/* RISK-02：Tone 三个来源全失败时，原来只有 console 告警，用户完全无感知，
   「换了网络环境就没声」类反馈无从排查。这里补一条用户可见 toast。
   约束：① 只弹一次；② 走四语词条（不引入硬编码中文）；③ loadTone 在
   main.js 预取阶段就会调用，此时 DOM / i18n 可能尚未就绪，需等 DOMContentLoaded
   后再取词并弹；④ 全程 try/catch，提示失败绝不影响音频降级本身。 */
function notifyFallback(){
  if(_fallbackWarned) return;
  const fire = () => {
    if(_fallbackWarned) return;
    try{
      if(typeof window==='undefined' || typeof window.toast!=='function') return;
      const pick = (typeof window.t==='function') ? window.t('tone.fallback') : null;
      if(!pick || pick==='tone.fallback') return;   // i18n 未就绪时不弹半成品
      _fallbackWarned = true;
      window.toast(pick,'warn',4200);
    }catch(e){ /* 提示不可用时静默，音频回退照常 */ }
  };
  try{
    if(typeof document!=='undefined' && document.readyState==='loading')
      document.addEventListener('DOMContentLoaded',fire,{once:true});
    else fire();
  }catch(e){ /* 无 document 的环境（Node 单测）直接跳过提示 */ }
}

export function loadTone() {
  if (_tonePromise) return _tonePromise;
  /* 缺陷修复：只缓存成功结果——瞬时网络故障（如服务重启窗口）
     不应把 null 永久写进缓存，下次调用可重试 */
  _tonePromise = (async () => {
    if (window.__USE_TONE === false) return null;          // 显式降级开关
    const tries = [
      async () => {
        const m = await import('../../vendor/tone.esm.js');   // 本地 vendor（离线可用）
        return m.default || m.Tone || m;
      },
      async () => {
        const m = await import('https://esm.sh/tone@' + TONE_VERSION);
        return m.default || m.Tone || m;
      },
      async () => {
        const m = await import('https://cdn.jsdelivr.net/npm/tone@' + TONE_VERSION + '/+esm');
        return m.default || m.Tone || m;
      },
    ];
    for (const t of tries) {
      try {
        const Tone = await t();
        if (Tone && typeof Tone.start === 'function') return Tone;
      } catch (e) {
        console.warn('[tone-loader] 加载源失败，尝试下一来源：', e && e.message);
      }
    }
    console.warn('[tone-loader] Tone.js 全部来源加载失败，音频走原生 Web Audio 后端');
    notifyFallback();      // RISK-02：用户可见提示（一次性、四语）
    _tonePromise = null;   // 允许下次重试
    return null;
  })();
  return _tonePromise;
}

export default loadTone;
