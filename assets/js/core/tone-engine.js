/* ============================================================
   六弦工坊 V3 · core/tone-engine.js
   ------------------------------------------------------------
   R-BUS-01：整个应用唯一的音频总线归属地——
     · 唯一 AudioContext（Tone 底层 rawContext，原生代码共用同一时钟）
     · 总线链：music/fx/metro 三条 Tone.Gain → Limiter(-1dB) → Destination
     · AudioEngine 的原生节点经 rawMusic 挂上同一总线链
   Tone 加载失败时返回 null，各消费方自动走原生回退。
   ============================================================ */
'use strict';

import { loadTone } from './tone-loader.js';

const ToneEngine = {
  Tone: null,
  ready: false,
  buses: null,    // { music, fx, metro, limiter }  (Tone 节点)
  rawBuses: null, // { music, ctx } 原生 GainNode（AudioEngine.master 汇入点）

  async ensure() {
    if (this.ready) return this.Tone;
    this.ready = true;
    const Tone = await loadTone();
    if (!Tone) return null;
    try {
      await Tone.start();                       // 用户手势解锁音频上下文
      const limiter = new Tone.Limiter(-1).toDestination();
      const music = new Tone.Gain(1).connect(limiter);
      const fx = new Tone.Gain(1).connect(limiter);
      const metro = new Tone.Gain(0.9).connect(limiter);
      this.Tone = Tone;
      this.buses = { music, fx, metro, limiter };
      /* V4.3.2 真实浏览器复验修复（Chromium + Tone 15.1.22）：
         standardized-audio-context 下 rawCtx.createGain() 返回的是包装对象，
         不是原生 AudioNode；limiter.input 同样是 Tone 包装对象。旧实现把
         原生节点 connect(limiter.input)，浏览器抛 "Overload resolution failed"
         / "A value with the given key could not be found"，catch 里第二次
         connect 再抛错 → 整个 ensure() 失败、Tone=null → 六种合成器音色与
         Transport 全部不可用（节拍器只能用原生 click）。
         修复：① 连接目标取 limiter 的底层原生节点（input.input._nativeAudioNode），
         已实测可 connect；② 保留包装对象直连包装 destination 的降级路径；
         ③ 整段做成「非致命」——原生总线只供历史兼容，AudioEngine.master 在
         BUG-01 同上下文守卫下已不再汇入，它失败绝不能拖垮 Tone 主链。 */
      try {
        const rawCtx = Tone.getContext().rawContext;
        const rawGain = rawCtx.createGain();
        const rawMusic = rawGain._nativeAudioNode || (rawGain.output && rawGain.output.nativeNode) || rawGain;
        if (rawMusic.gain) rawMusic.gain.value = 1;
        const li = limiter && limiter.input;
        const limNative = li && ((li.input && li.input._nativeAudioNode) ||
                                 (li.output && li.output._nativeAudioNode) || li._nativeAudioNode);
        let linked = false;
        if (limNative) {
          try { rawMusic.connect(limNative); linked = true; } catch (e) { /* 落到降级 */ }
        }
        if (!linked) {
          try { rawGain.connect(limiter); linked = true; }          // Tone 包装对 Tone 包装
          catch (e) { /* 落到降级 */ }
        }
        if (!linked) {
          const dest = (rawCtx.destination && rawCtx.destination._nativeAudioNode) || rawCtx.destination;
          try { rawMusic.connect(dest); }                            // 最后兜底：直连 destination
          catch (e) { console.warn('[tone-engine] 原生总线连接失败（不影响合成器链）：', e && e.message); }
        }
        this.rawBuses = { music: rawMusic, ctx: rawCtx };
      } catch (e) {
        console.warn('[tone-engine] 原生总线创建失败（不影响合成器链）：', e && e.message);
        this.rawBuses = null;
      }
      return Tone;
    } catch (e) {
      console.warn('[tone-engine] 初始化失败，回退原生音频：', e && e.message);
      this.Tone = null;
      return null;
    }
  },

  /* 统一 AudioContext：Tone 可用返回其 rawContext，否则新建原生上下文 */
  async ensureContext() {
    const Tone = await this.ensure();
    if (Tone) return Tone.getContext().rawContext;
    if (!this._fallbackCtx) {
      this._fallbackCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this._fallbackCtx.state === 'suspended') this._fallbackCtx.resume();
    return this._fallbackCtx;
  },
};

window.ToneEngine = ToneEngine;
export { ToneEngine };
export default ToneEngine;
