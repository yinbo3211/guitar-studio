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
  /* 自定义采样音源（物理机实测需求）：支持用户导入真实音频采样
     （如 freesound / zapsplat / creazilla 下载的节拍器音色）。
     _samples: { key -> AudioBuffer }，key 为 'sample' 或自定义槽位名。 */
  _samples: Object.create(null),
  /** 解码 ArrayBuffer → AudioBuffer 并缓存 */
  async decodeSample(key, arrayBuffer){
    const ctx = this.ensure();
    const buf = await ctx.decodeAudioData(arrayBuffer);
    this._samples[key] = buf;
    return buf;
  },
  /** 从 URL 加载并解码（跨域需目标站点允许 CORS） */
  async loadSampleUrl(key, url){
    const res = await fetch(url, { mode: 'cors' });
    if(!res.ok) throw new Error('HTTP ' + res.status);
    return this.decodeSample(key, await res.arrayBuffer());
  },
  hasSample(key){ return !!this._samples[key]; },
  /** 播放已缓存的采样；when 为相对当前时间的秒偏移 */
  playSample(key, when=0, vol=1, rate=1){
    const buf = this._samples[key];
    if(!buf) return false;
    const ctx = this.ensure();
    const t0 = Math.max(ctx.currentTime, ctx.currentTime + (when||0));
    const src = ctx.createBufferSource();
    src.buffer = buf;
    if(rate && rate !== 1) src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = typeof vol === 'number' ? vol : 1;
    src.connect(g); g.connect(this.master);
    src.start(t0);
    return true;
  },
  dropSample(key){ delete this._samples[key]; },
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
      try{
        // V3.1 修4（BUG-3 疑点 C 根治）：不再中途替换 this.ctx——
        // AudioEngine 的振荡器链路固定跑在自有 ctx-A，Tone 合成器跑在 rawCtx-B，
        // 两条发声链互不混用时间基准；只把 master 声音汇入 tone-engine 总线做统一限幅
        if(this.master && ToneEngine.rawBuses){
          this.master.disconnect();
          this.master.connect(ToneEngine.rawBuses.music);
        }
      }catch(e){ console.warn('[audio-engine] Tone 总线接入失败，走原生输出：', e&&e.message); }
    }).catch(()=>{});  },
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

/* ---------- 麦克风管理（V3.2：统一由 core/mic-manager.js 承载） ----------
   调音器/和弦闯关/录音棚共用同一个 Mic 实例，避免重复 getUserMedia 与
   生命周期竞态；实现见 core/mic-manager.js（single-flight + 10s 超时 +
   失败诊断 + stop 后在途回调作废）。 */
import { Mic, buildDiagnostics } from './mic-manager.js';
/* 兼容旧引用名：micHint/diagInfo 指向 MicManager 的统一诊断实现 */
const diagInfo = buildDiagnostics;
const micHint = (err) => (buildDiagnostics(err) || {}).hint || '';
Object.assign(window, { AudioEngine, Mic, buildDiagnostics, diagInfo, micHint });
export { AudioEngine, Mic, buildDiagnostics, diagInfo, micHint };
