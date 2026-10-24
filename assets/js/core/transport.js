/* ============================================================
   六弦工坊 V3 · core/transport.js
   ------------------------------------------------------------
   P-01/P-02：节拍器、进度伴奏、节奏型三处共用的唯一时间轴。
     · Tone 后端：Tone.Transport 驱动，bpm.rampTo 平滑变速（R-TONE-02），
       UI 同步走 Tone.getDraw()（R-METRO-02）
     · 原生回退：AudioContext 时钟 + lookahead 循环（R-TONE-05），
       语义与 Tone 后端对齐
   tick 粒度 = 1/12 拍（'32t'），可整除 1/2/3/4 全部细分：
     sub1=12 tick/步  sub2=6  sub3=4  sub4=3
   约束（R-TONE-02）：业务模块禁止自算 60/bpm、禁止直接调
   Tone.getTransport()，一律经由本模块的 beatDuration()/stepTicks()。
   ============================================================ */
'use strict';

import { ToneEngine } from './tone-engine.js';

const TICKS_PER_BEAT = 12;

const Transport = {
  backend: 'none',       // none | tone | native
  bpm: 90,
  playing: false,
  tick: 0,               // 全局 tick 计数（1 tick = 1/12 拍）
  _ctx: null,
  _timer: null,
  _nextTime: 0,
  _startAudioTime: 0,
  _visualPos: 0,
  _pauseAt: 0,
  _cbs: [],
  _bpmListeners: [],

  async init() {
    if (this.backend !== 'none') return this.backend;
    if (!this._ctx) this._ctx = await ToneEngine.ensureContext();
    const Tone = await ToneEngine.ensure();
    if (Tone) {
      this.backend = 'tone';
      Tone.getTransport().bpm.value = this.bpm;
      this._registerRepeat();             // V3.1 修1：数字秒调度（'32t' 时值兼容性弃用）
    } else {
      this.backend = 'native';
    }
    return this.backend;
  },

  /* ---------- 查询（R-TONE-02：唯一合法的时长来源） ---------- */
  beatDuration() { return 60 / this.bpm; },
  tickDuration() { return this.beatDuration() / TICKS_PER_BEAT; },
  stepTicks(sub) { return TICKS_PER_BEAT / sub; },   // 某细分每步占多少 tick
  elapsedBeats() {
    if (!this._ctx) return 0;
    if (this.backend === 'tone') {
      return ToneEngine.Tone.getTransport().seconds / this.beatDuration();
    }
    return Math.max(0, (this._ctx.currentTime - this._startAudioTime) / this.beatDuration());
  },

  /* V3.1 修1：用数字秒注册 1/12 拍 tick；setBpm 后重注册以跟随新间隔 */
  _registerRepeat() {
    const Tone = ToneEngine.Tone;
    if (!Tone || this.backend !== 'tone') return;
    try {
      if (this._repeatId !== undefined) Tone.getTransport().clear(this._repeatId);
      this._repeatId = Tone.getTransport().scheduleRepeat((time) => {
        this._fire(time, this.tick++);
      }, this.tickDuration());            // tickDuration() = 60/bpm/12 纯数字秒
    } catch (e) { console.warn('[Transport] scheduleRepeat 注册失败：', e && e.message); }
  },

  /* ---------- BPM（R-BPM-04：支持线性渐变） ---------- */
  setBpm(v, ramp = 0.06) {
    v = Math.round(v);
    if (!(v >= 30 && v <= 300)) v = Math.min(300, Math.max(30, v));
    const old = this.bpm;
    this.bpm = v;
    if (this.backend === 'tone') {
      ToneEngine.Tone.getTransport().bpm.rampTo(v, ramp);
    } else if (this.playing) {
      // 原生：重锚时间轴原点保持视觉相位（V2-BUG-05 语义上移）
      this._startAudioTime = this._ctx.currentTime - this._visualPos * this.beatDuration();
    }
    if (this.backend === 'tone') {
      clearTimeout(this._reRegTimer);
      this._reRegTimer = setTimeout(() => this._registerRepeat(), Math.max(80, ramp * 1000 + 30));
    }
    this._bpmListeners.forEach((f) => { try { f(v, old); } catch (e) {} });
    return v;
  },
  onBpm(fn) { this._bpmListeners.push(fn); },

  /* ---------- 走带控制 ---------- */
  async start() {
    if (!this._ctx) await this.init();
    if (this.playing) return;
    if (this.backend === 'tone') {
      ToneEngine.Tone.getTransport().start('+0.08');
      if (this._pauseAt) { ToneEngine.Tone.getTransport().position = 0; this._pauseAt = 0; }
    } else {
      if (this._pauseAt) {           // 暂停恢复：平移时间轴原点
        const dt = this._ctx.currentTime - this._pauseAt;
        this._startAudioTime += dt; this._nextTime += dt; this._pauseAt = 0;
      } else {
        this._nextTime = this._ctx.currentTime + 0.08;
        this._startAudioTime = this._nextTime;
        this._visualPos = 0;
      }
      this._timer = setInterval(() => this._scheduleNative(), 25);
    }
    this.playing = true;
  },
  pause() {
    if (!this.playing) return;
    if (this.backend === 'tone') { ToneEngine.Tone.getTransport().pause(); }
    else { this._pauseAt = this._ctx.currentTime; clearInterval(this._timer); this._timer = null; }
    this.playing = false;
  },
  async stop() {
    if (this.backend === 'none') await this.init();
    if (this.backend === 'tone') { ToneEngine.Tone.getTransport().stop(); ToneEngine.Tone.getTransport().position = 0; }
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    this.playing = false;
    this.tick = 0; this._visualPos = 0; this._pauseAt = 0;
  },

  /* ---------- 步进事件 ---------- */
  onTick(cb) { this._cbs.push(cb); },
  _fire(time, tick) {
    this._visualPos = tick / TICKS_PER_BEAT;
    this._cbs.forEach((cb) => {
      try { cb(time, tick, this.bpm); } catch (e) { console.warn('[Transport] tick 回调异常：', e); }
    });
  },
  _scheduleNative() {
    const lookahead = 0.12;
    while (this._nextTime < this._ctx.currentTime + lookahead) {
      this._fire(this._nextTime, this.tick++);
      this._nextTime += this.tickDuration();
    }
  },

  /* ---------- UI 同步（R-METRO-02：音频时钟对齐的绘制回调） ---------- */
  atDraw(cb, time) {
    if (this.backend === 'tone') {
      ToneEngine.Tone.getDraw().schedule(cb, time);
    } else {
      const ms = Math.max(0, (time - this._ctx.currentTime) * 1000);
      setTimeout(cb, ms);
    }
  },
};

window.Transport = Transport;
export { Transport };
export default Transport;
