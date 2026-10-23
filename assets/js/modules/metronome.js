/* ============================================================
   六弦工坊 V3 · 模块 2：节拍器（Tone.js 统一时钟驱动）
   ------------------------------------------------------------
   V3.0 M2 改造（R-METRO-01/02、R-TONE-01/02、R-BPM-01/02/04/05）：
     · 时间轴唯一来源 = core/transport.js（不再自算 60/bpm）；
     · BPM 30–300；变速经 Transport.setBpm → Tone.Transport.bpm.rampTo；
     · 强/弱拍与细分走 Transport 统一 tick（1/12 拍粒度，兼容三连音）；
     · 六种音色预设，Tone 就绪时用 Tone 合成器，离线回退原生 click；
     · 渐快训练：N 小节内线性 ramp 到目标 BPM（R-BPM-04）；
     · Swing：反拍延迟比例 0.55/0.62（R-BPM-05）。
   ============================================================ */
'use strict';

const { tapBpm, isSubAccent, clamp } = AudioCore;

const Metro = {
  bpm:90, beats:2, sub:1, playing:false,
  beat:0, subIdx:0, visualPos:0,
  timer:null, raf:null,
  voice:'click', trainerBars:0, swing:0,        // swing: 0 | 0.55 | 0.62
  _trainer:null,

  init(){
    if(this.inited) return; this.inited=true;
    const range=$('#bpmRange');
    const setBpm=(v)=>{
      this.bpm=clamp(Math.round(v),30,300);
      range.value=this.bpm;
      $('#bpmNum').innerHTML=this.bpm+'<small>BPM</small>';
      range.style.setProperty('--fill',(this.bpm-30)/270*100+'%');
      $$('.preset-chip[data-bpm]').forEach(c=>c.classList.toggle('on',+c.dataset.bpm===this.bpm));
      Transport.setBpm(this.bpm);   // R-TONE-02：BPM 唯一写入口
    };
    range.addEventListener('input',e=>setBpm(e.target.value));
    $('#bpmM1').onclick=()=>setBpm(this.bpm-1);
    $('#bpmP1').onclick=()=>setBpm(this.bpm+1);
    $('#bpmM5').onclick=()=>setBpm(this.bpm-5);
    $('#bpmP5').onclick=()=>setBpm(this.bpm+5);
    $$('.preset-chip[data-bpm]').forEach(c=>c.onclick=()=>setBpm(+c.dataset.bpm));
    setBpm(90);
    // TAP
    let taps=[];
    $('#tapBtn').onclick=()=>{
      const now=performance.now();
      if(taps.length && now-taps[taps.length-1]>2000) taps=[];
      taps.push(now);
      if(taps.length>6) taps.shift();
      AudioEngine.ensure(); AudioEngine.click(false);
      if(taps.length>=2){
        const bpm=tapBpm(taps);
        if(bpm) setBpm(clamp(bpm,30,300));
      }
    };
    // 拍号
    $('#timeSig').onclick=e=>{
      const b=e.target.closest('button'); if(!b)return;
      $$('#timeSig button').forEach(x=>x.classList.toggle('on',x===b));
      this.beats=+b.dataset.beats;
      this.beat=this.beat%this.beats;
      this.subIdx=this.subIdx%this.sub;
      this.renderDots();
    };
    // 细分
    $('#subdiv').onclick=e=>{
      const b=e.target.closest('button'); if(!b)return;
      $$('#subdiv button').forEach(x=>x.classList.toggle('on',x===b));
      this.sub=+b.dataset.sub;
      this.subIdx=this.subIdx%this.sub;
    };
    // 音色（R-METRO-03）
    $('#metroVoice').onclick=e=>{
      const b=e.target.closest('button'); if(!b)return;
      $$('#metroVoice button').forEach(x=>x.classList.toggle('on',x===b));
      this.voice=b.dataset.voice;
      try{ localStorage.setItem('gs.metroVoice',this.voice); }catch(err){}
    };
    try{ const v=localStorage.getItem('gs.metroVoice'); if(v && $('#metroVoice [data-voice="'+v+'"]')){ this.voice=v; $$('#metroVoice button').forEach(x=>x.classList.toggle('on',x.dataset.voice===v)); } }catch(err){}
    // 渐快训练（R-BPM-04）
    $('#metroTrainer').onclick=e=>{
      const b=e.target.closest('button'); if(!b)return;
      $$('#metroTrainer button').forEach(x=>x.classList.toggle('on',x===b));
      this.trainerBars=+b.dataset.trainer;
    };
    // Swing（R-BPM-05）
    const swingSeg=$('#metroSwing');
    if(swingSeg) swingSeg.onclick=e=>{
      const b=e.target.closest('button'); if(!b)return;
      $$('#metroSwing button').forEach(x=>x.classList.toggle('on',x===b));
      this.swing=+b.dataset.swing;
    };
    // 统一时钟 tick（1/12 拍粒度）：本模块只认 tick，不再自建循环
    Transport.onTick((time,tick)=>{
      if(!this.playing) return;
      const per=Transport.stepTicks(this.sub);
      if(tick%per!==0) return;
      const stepDur=Transport.beatDuration()/this.sub;
      // R-BPM-05：偶数步（反拍）按 swing 比例延后
      let when=time;
      if(this.swing>0 && this.subIdx%2===1) when=time+stepDur*(this.swing-0.5);
      this._hit(when);
      this._trainerTick();
      this.subIdx++;
      if(this.subIdx>=this.sub){this.subIdx=0;this.beat=(this.beat+1)%this.beats;}
    });
    $('#metroToggle').onclick=()=>this.toggle();
    this.renderDots();
  },
  renderDots(){
    let html='';
    for(let i=0;i<this.beats;i++){
      let cls='beat-dot';
      let label=i+1;
      if(i===0) cls+=' strong';
      else if(isSubAccent(this.beats,i)) cls+=' sub';
      else cls+=' weak';
      html+=`<div class="${cls}" data-i="${i}">${label}</div>`;
    }
    $('#beatDots').innerHTML=html;
  },
  async toggle(){
    AudioEngine.ensure();
    if(this.playing){this.stop();return;}
    await Transport.init();          // R-TONE-01：三处共用同一条时间轴
    Transport.setBpm(this.bpm, 0.01);
    await Transport.start();
    this.playing=true;
    this.beat=0; this.subIdx=0; this.visualPos=0;
    this._trainer=this.trainerBars?{from:this.bpm,to:0,total:this.trainerBars*4,done:0}:null;
    if(this._trainer) this._trainer.to=Math.min(300,this.bpm+40);
    $('#metroToggle').innerHTML='<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2.5"/></svg>';
    $('#metroToggle').classList.add('recording');
    this.visualLoop();
  },
  /* R-BPM-04：每拍按已完成拍数线性插值 BPM */
  _trainerTick(){
    if(!this._trainer || this.subIdx!==0) return;
    const t=this._trainer; t.done++;
    if(t.done>=t.total){ this._trainer=null; $$('#metroTrainer button').forEach(x=>x.classList.toggle('on',x.dataset.trainer==='0')); return; }
    const v=Math.round(t.from+(t.to-t.from)*t.done/t.total);
    if(v!==this.bpm) Transport.setBpm(v);
  },
  /* ---------- 发声（Tone 合成器优先，原生回退） ---------- */
  _ensureVoices(){
    const Tone=ToneEngine.Tone;
    if(this._voices || !Tone) return;
    const bus=ToneEngine.buses.metro;
    try{
      this._voices={
        click:new Tone.Synth({oscillator:{type:'square'},envelope:{attack:.001,decay:.05,sustain:0,release:.01},volume:-14}).connect(bus),
        wood:new Tone.MembraneSynth({pitchDecay:.008,octaves:2,envelope:{attack:.001,decay:.09,sustain:0},volume:-8}).connect(bus),
        rim:new Tone.NoiseSynth({noise:{type:'white'},envelope:{attack:.001,decay:.03,sustain:0},volume:-12}).connect(bus),
        beep:new Tone.Synth({oscillator:{type:'sine'},envelope:{attack:.002,decay:.12,sustain:0,release:.01},volume:-14}).connect(bus),
        kick:new Tone.MembraneSynth({pitchDecay:.03,octaves:6,envelope:{attack:.001,decay:.32,sustain:0},volume:-6}).connect(bus),
        clap:new Tone.NoiseSynth({noise:{type:'pink'},envelope:{attack:.001,decay:.15,sustain:0},volume:-12}).connect(bus),
      };
    }catch(e){ this._voices=null; }
  },
  _hit(time){
    this._ensureVoices();
    const strong=this.beat===0;
    const subAcc=isSubAccent(this.beats,this.beat);
    const v=this._voices && this._voices[this.voice];
    if(v){
      const T=ToneEngine.Tone;
      const freqMap={click:[1600,1050], wood:['G4','C4'], beep:['A5','A5'], kick:['C2','C1']};
      if(v.triggerAttackRelease){
        if(this.voice==='rim'||this.voice==='clap'){
          v.triggerAttackRelease(strong? .08:.04, time);
          if(subAcc) v.triggerAttackRelease(.05, time+0.01);
        }else if(this.voice==='wood'||this.voice==='kick'){
          v.triggerAttackRelease(freqMap[this.voice][strong?0:1], .1, time);
          if(subAcc) v.triggerAttackRelease(freqMap[this.voice][1], .08, time+0.012);
        }else{
          v.triggerAttackRelease(freqMap[this.voice][strong?0:1], .07, time);
          if(subAcc) v.triggerAttackRelease(freqMap[this.voice][1], .05, time+0.012);
        }
      }
    }else{
      // 原生回退：AudioEngine.click（与 V2 行为一致）
      AudioEngine.click(strong, time-AudioEngine.ctx.currentTime);
      if(subAcc) AudioEngine.click(false, time-AudioEngine.ctx.currentTime+0.012);
    }
    if(this.subIdx>0){
      // 细分轻击
      const Tone=ToneEngine.Tone;
      if(this._voices && Tone){
        this._voices.click.triggerAttackRelease(800,.03,time,{gain:.2});
      }else{
        const ctx=AudioEngine.ctx;
        const o=ctx.createOscillator(),g=ctx.createGain();
        o.type='square'; o.frequency.value=800;
        g.gain.setValueAtTime(.07,time);
        g.gain.exponentialRampToValueAtTime(.0001,time+.035);
        o.connect(g); g.connect(AudioEngine.master);
        o.start(time); o.stop(time+.045);
      }
    }
  },
  stop(){
    this.playing=false;
    this._trainer=null;
    Transport.stop();
    if(this.timer){ clearInterval(this.timer); this.timer=null; }
    if(this.raf){ cancelAnimationFrame(this.raf); this.raf=null; }
    $('#metroToggle').innerHTML='<svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l11-6.5a1 1 0 0 0 0-1.72l-11-6.5A1 1 0 0 0 8 5.5z"/></svg>';
    $('#metroToggle').classList.remove('recording');
    const rod=$('#pendulumRod');
    if(rod){ // Fix-3: 与 visualLoop 相同的空值守卫
      rod.style.transition='transform .3s ease';
      rod.style.transform='rotate(0deg)';
    }
    $$('.beat-dot').forEach(d=>d.className=d.className.replace(/flash-\w+/g,'').trim());
  },
  visualLoop(){
    if(!this.playing) return;
    const rod=$('#pendulumRod');
    if(!rod) return;
    const loop=()=>{
      if(!this.playing) return;
      // R-TONE-01：相位来自统一时间轴（Tone.seconds 或原生重锚时钟）
      const pos=Math.max(0,Transport.elapsedBeats());
      this.visualPos=pos;
      const curBeat=Math.floor(pos)%this.beats;
      const angle=-Math.cos(pos*Math.PI)*26;
      rod.style.transition='none';
      rod.style.transform='rotate('+angle+'deg)';
      $$('.beat-dot').forEach((d,i)=>{
        d.className=d.className.replace(/flash-\w+/g,'').trim();
        if(i===curBeat){
          if(i===0) d.classList.add('flash-strong');
          else if(isSubAccent(this.beats,i)) d.classList.add('flash-sub');
          else d.classList.add('flash-weak');
        }
      });
      this.raf=requestAnimationFrame(loop);
    };
    loop();
  }
};
onRouteEnter.metro=()=>Metro.init();

window.Metro = Metro;
export { Metro };
