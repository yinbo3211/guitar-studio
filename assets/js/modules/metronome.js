/* ============================================================
   六弦工坊 V3 · 模块 2：节拍器
   （M3 目录重构：由 V2 app-*.js 拆分，代码体保持不变）
   ============================================================ */
'use strict';

/* ============================================================
   模块 2：节拍器（lookahead 调度，音频时钟驱动）
   ============================================================ */
/* V2 M1：算法与常量已迁移至 lib/audio-core.js（AudioCore） */
const { OPEN_MIDI, tapBpm, beatDuration, stepDuration, isSubAccent } = AudioCore;
const Metro = {
  bpm:90, beats:2, sub:1, playing:false,
  beat:0, subIdx:0, nextTime:0, startAudioTime:0, visualPos:0,
  timer:null, raf:null,
  init(){
    if(this.inited) return; this.inited=true;
    const range=$('#bpmRange');
    const setBpm=(v)=>{
      this.bpm=clamp(Math.round(v),40,240);
      range.value=this.bpm;
      $('#bpmNum').innerHTML=this.bpm+'<small>BPM</small>';
      range.style.setProperty('--fill',(this.bpm-40)/200*100+'%');
      $$('.preset-chip[data-bpm]').forEach(c=>c.classList.toggle('on',+c.dataset.bpm===this.bpm));
      /* V2-BUG-05 修复（P2）：播放中改 BPM，visualLoop 用「新 beatDur ÷ 全程 elapsed」
         重算相位会瞬间跳拍（如 2.4 拍跳到 4.8 拍），摆锤与 click 声脱节。
         以当前视觉相位（拍数）为基准重锚 startAudioTime，音频计数器不动。 */
      if(this.playing) this.rebaseVisual();
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
        const bpm=tapBpm(taps); // V2 M1：中位间隔测速迁至 AudioCore
        if(bpm) setBpm(bpm);
      }
    };
    // 拍号
    $('#timeSig').onclick=e=>{
      const b=e.target.closest('button'); if(!b)return;
      $$('#timeSig button').forEach(x=>x.classList.toggle('on',x===b));
      this.beats=+b.dataset.beats;
      // P2-17 修复：播放中切换拍号必须把拍指针折回有效范围——
      // V1 残留 this.beat，如从 4/4 的第 3 拍切到 2/4 会出现越界拍与强拍错位
      this.beat=this.beat%this.beats;
      this.subIdx=this.subIdx%this.sub;
      /* V2-BUG-05 修复（P2）：拍号变更后音频计数器与视觉相位（按全程 elapsed
         推导）会分叉——播放中从下一拍起重数（强拍对齐），音频与视觉一起复位 */
      if(this.playing) this.restartCount();
      this.renderDots();
    };
    // 细分
    $('#subdiv').onclick=e=>{
      const b=e.target.closest('button'); if(!b)return;
      $$('#subdiv button').forEach(x=>x.classList.toggle('on',x===b));
      this.sub=+b.dataset.sub;
      // P2-17：切换细分同样把细分指针折回
      this.subIdx=this.subIdx%this.sub;
    };
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
  toggle(){
    AudioEngine.ensure();
    if(this.playing){this.stop();return;}
    this.playing=true;
    this.beat=0; this.subIdx=0; this.visualPos=0;
    const ctx=AudioEngine.ctx;
    this.nextTime=ctx.currentTime+0.1;
    this.startAudioTime=this.nextTime;
    this.timer=setInterval(()=>this.schedule(),25);
    $('#metroToggle').innerHTML='<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2.5"/></svg>';
    $('#metroToggle').classList.add('recording');
    this.visualLoop();
  },
  /* V2-BUG-05：播放中改 BPM——把时间轴原点重锚到「当前视觉相位」，
     使 elapsed/beatDur 在新 BPM 下仍等于重锚前的拍数（相位保持连续） */
  rebaseVisual(){
    const ctx=AudioEngine.ctx;
    if(!ctx) return;
    const pos=this.visualPos||0;
    this.startAudioTime=ctx.currentTime-pos*beatDuration(this.bpm);
  },
  /* V2-BUG-05：播放中改拍号——音频计数器与视觉相位一齐从下一已排拍重数 */
  restartCount(){
    this.beat=0; this.subIdx=0; this.visualPos=0;
    this.startAudioTime=this.nextTime;   // 下一拍=新的第 0 拍（强拍）
  },
  stop(){
    this.playing=false;
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
  schedule(){
    const ctx=AudioEngine.ctx;
    const beatDur=beatDuration(this.bpm);          // V2 M1：节拍计算迁至 AudioCore
    const stepDur=stepDuration(this.bpm,this.sub);
    while(this.nextTime<ctx.currentTime+0.12){
      if(this.subIdx===0){
        // 主拍：强 / 次强 / 弱
        let accent=this.beat===0;
        let subAccent=isSubAccent(this.beats,this.beat);
        AudioEngine.click(accent, this.nextTime-ctx.currentTime);
        if(subAccent) AudioEngine.click(false, this.nextTime-ctx.currentTime); // 6/8 次强稍作强调
      }else{
        // 细分：轻击（用更轻的 click）
        const t=this.nextTime;
        const o=ctx.createOscillator(),g=ctx.createGain();
        o.type='square'; o.frequency.value=800;
        g.gain.setValueAtTime(.07,t);
        g.gain.exponentialRampToValueAtTime(.0001,t+.035);
        o.connect(g); g.connect(AudioEngine.master);
        o.start(t); o.stop(t+.045);
      }
      this.nextTime+=stepDur;
      this.subIdx++;
      if(this.subIdx>=this.sub){this.subIdx=0;this.beat=(this.beat+1)%this.beats;}
    }
  },
  visualLoop(){
    if(!this.playing) return;
    const rod=$('#pendulumRod');
    // Fix-3: 空值守卫——DOM 结构变更或渲染延迟时避免对 null 元素做样式操作
    if(!rod) return;
    const loop=()=>{
      if(!this.playing) return;
      const ctx=AudioEngine.ctx;
      const elapsed=ctx.currentTime-this.startAudioTime;
      const beatDur=beatDuration(this.bpm); // V2 M1
      const pos=Math.max(0,elapsed/beatDur); // V2-BUG-05：clamp，重锚瞬间不允许负相位
      this.visualPos=pos;                    // 持续记录，供 rebaseVisual 使用
      const curBeat=Math.floor(pos)%this.beats;
      // 摆锤：每拍到达端点
      const angle=-Math.cos(pos*Math.PI)*26;
      rod.style.transition='none';
      rod.style.transform='rotate('+angle+'deg)';
      // 灯
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
