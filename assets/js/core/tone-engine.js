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
      // 原生总线：与 Tone 同一 rawContext，供 AudioEngine.master 汇入
      const rawCtx = Tone.getContext().rawContext;
      const rawGain = rawCtx.createGain();
      // BUG-02 修复：standardized-audio-context 环境下 createGain 可能返回
      // Tone 包装对象而非原生 AudioNode，需取底层原生节点，否则 instanceof 判定失败
      const rawMusic = rawGain._nativeAudioNode || (rawGain.output && rawGain.output.nativeNode) || rawGain;
      rawMusic.gain.value = 1;
      try { rawMusic.connect(limiter.input); }          // 汇入同一限幅总线
      catch (e) {
        console.warn('[tone-engine] 原生总线汇入限幅器失败，直连 destination：', e && e.message);
        rawMusic.connect(rawCtx.destination);
      }
      this.rawBuses = { music: rawMusic, ctx: rawCtx };
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
