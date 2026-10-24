/* ============================================================
   六弦工坊 V3 · 音频引擎与麦克风 core/audio-engine
   （M3 目录重构：由 V2 app-*.js 拆分，代码体保持不变）
   ============================================================ */
'use strict';

/* BUG-01 修复：ESM 模块作用域下 PitchDetect 需从 AudioCore 解构引入
   （与 ui.js / tuner.js 保持一致的写法） */
const { PitchDetect } = AudioCore;

/* ============================================================
   音频引擎（原生 Web Audio，全部本地处理）
   ============================================================ */
const AudioEngine = {
  ctx:null, master:null,
  ensure(){
    if(!this.ctx){
      this.ctx = new (window.AudioContext||window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = .5;
      this.master.connect(this.ctx.destination);
      this._integrateTone();   // V3 M2：Tone 就绪后切换到统一上下文与总线
    }
    if(this.ctx.state==='suspended') this.ctx.resume();
    return this.ctx;
  },
  /* R-BUS-01：AudioEngine 的原生节点汇入 tone-engine 的 music 总线，
     全应用共享同一个 AudioContext（同一时钟） */
  _integrateTone(){
    ToneEngine.ensure().then(Tone=>{
      if(!Tone) return;
      const rawCtx = Tone.getContext().rawContext;
      if(this.ctx && !this.ctx.__gsShared && rawCtx.state!==undefined){
        // BUG-02 修复：替换上下文时必须同步重建 master，
        // 否则 master 属于旧 AudioContext，跨上下文连接必然失败，
        // 且失败前 master.disconnect() 会让它成为悬空节点（全站静音）
        //
        // P1-1 修复：Tone 异步接管发生在「首次音频手势之后」的极窄竞态窗口内时，
        // Rhythm.demoGain/metroGain、ChordLib 等早期消费节点仍挂在旧 master 上。
        // 若此时 disconnect 旧 master，它既不接 Tone 新总线也不接旧 destination，
        // 会变成永久悬空的静音节点（节奏/进度伴奏一路失声，必须刷新页面恢复）。
        // 做法：保留旧 master → 旧 ctx.destination 的输出，让早期声部继续有声；
        // 仅把「今后」新建的节点切到 Tone 共享上下文/总线。代价仅是接管瞬间
        // 短暂存在两个上下文（首屏 main.js 已预取 Tone，正常情况下此窗口不会出现）。
        const vol = this.master ? this.master.gain.value : .5;
        const oldMaster = this.master;
        this.ctx = rawCtx; rawCtx.__gsShared = true;
        this.master = rawCtx.createGain();
        this.master.gain.value = vol;
        this.master.connect(rawCtx.destination);   // 兜底直连，保证一定有声
        void oldMaster;   // 显式保留：旧 master 仍连在旧 ctx.destination 上，不 disconnect
      }
      const bus = ToneEngine.rawBuses && ToneEngine.rawBuses.music;
      if(this.master && bus && bus instanceof AudioNode){
        this.master.disconnect();
        this.master.connect(bus);
      }
    }).catch(e=>{
      // BUG-02 修复：任何失败都要把 master 接回 destination，绝不留下悬空节点
      console.warn('[audio-engine] Tone 总线接入失败，走原生输出：', e&&e.message);
      try{ this.master && this.master.connect(this.ctx.destination); }catch(_){}
    });
  },
  /* 拨弦合成：三角波基音 + 泛音 + 指数衰减 */
  pluck(freq, when=0, dur=1.6, vol=.32){
    const ctx=this.ensure(), t0=ctx.currentTime+when;
    const g=ctx.createGain();
    g.connect(this.master);
    const partials=[
      {type:'triangle',ratio:1, gain:1.0, decay:1.0},
      {type:'sine',    ratio:2, gain:.32,decay:.55},
      {type:'sine',    ratio:3, gain:.16,decay:.32},
      {type:'sine',    ratio:4, gain:.07,decay:.18}
    ];
    partials.forEach(p=>{
      const o=ctx.createOscillator(), pg=ctx.createGain();
      o.type=p.type; o.frequency.value=freq*p.ratio;
      pg.gain.value=p.gain;
      o.connect(pg); pg.connect(g);
      const pd=dur*p.decay;
      pg.gain.setValueAtTime(0,t0);
      pg.gain.linearRampToValueAtTime(vol*p.gain, t0+0.004);
      pg.gain.exponentialRampToValueAtTime(0.0001, t0+pd);
      o.start(t0); o.stop(t0+pd+.05);
    });
    // 起音小噪声，模拟拨弦
    return t0;
  },
  /* 扫弦：从低音弦到高音弦依次拨响（when 为音频时钟偏移，供进度伴奏提前调度） */
  strum(freqs, dir='down', vol=.28, when=0){
    const order = dir==='down' ? freqs : freqs.slice().reverse();
    order.forEach((f,i)=> this.pluck(f, when + i*0.032, 1.8, vol));
  },
  /* 节拍器 click：方波短促 */
  click(accent=false, when=0){
    const ctx=this.ensure(), t0=ctx.currentTime+when;
    const o=ctx.createOscillator(), g=ctx.createGain(), f=ctx.createBiquadFilter();
    o.type='square';
    o.frequency.value = accent?1600:1050;
    f.type='lowpass'; f.frequency.value=2400;
    g.gain.setValueAtTime(accent?.42:.28, t0);
    g.gain.exponentialRampToValueAtTime(.0001, t0+.055);
    o.connect(f); f.connect(g); g.connect(this.master);
    o.start(t0); o.stop(t0+.07);
  },
  /* 纯音（练耳、参考音） */
  tone(freq, dur=1.2, type='sine', vol=.25, when=0){
    const ctx=this.ensure(), t0=ctx.currentTime+when;
    const o=ctx.createOscillator(), g=ctx.createGain();
    o.type=type; o.frequency.value=freq;
    g.gain.setValueAtTime(.0001,t0);
    g.gain.linearRampToValueAtTime(vol,t0+.02);
    g.gain.setValueAtTime(vol,t0+dur-.06);
    g.gain.exponentialRampToValueAtTime(.0001,t0+dur);
    o.connect(g); g.connect(this.master);
    o.start(t0); o.stop(t0+dur+.05);
    return t0;
  }
};

/* ---------- 麦克风管理（V3.1 起：MicManager 承载，见 core/mic-manager.js） ---------- */
import { Mic } from './mic-manager.js';
Object.assign(window, { AudioEngine, Mic });
export { AudioEngine, Mic };
