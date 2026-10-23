/* ============================================================
   六弦工坊 V3 · core/tone-loader.js
   ------------------------------------------------------------
   R-TONE-04 / R-ESM-06：本地 vendor 优先 → esm.sh → jsdelivr，
   全部失败返回 null（页面继续以原生 Web Audio 运行，零 npm 依赖）。
   ============================================================ */
'use strict';

const TONE_VERSION = '15.8.6';

let _tonePromise = null;

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
    _tonePromise = null;   // 允许下次重试
    return null;
  })();
  return _tonePromise;
}

export default loadTone;
