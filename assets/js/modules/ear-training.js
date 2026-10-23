/* ============================================================
   六弦工坊 V3 · 模块 5：练耳
   （M3 目录重构：由 V2 app-*.js 拆分，代码体保持不变）
   ============================================================ */
'use strict';

/* ============================================================
   模块 5：练耳训练
   ============================================================ */
const Ear = {
  mode:'note', n:0, ok:0, streak:0, bestStreak:0, answer:null, answered:false, opts:[],
  intervals:[
    {semi:2,label:'大二度',ex:'Do–Re'},
    {semi:3,label:'小三度',ex:'La–Do'},
    {semi:4,label:'大三度',ex:'Do–Mi'},
    {semi:5,label:'纯四度',ex:'Do–Fa'},
    {semi:7,label:'纯五度',ex:'Do–Sol'},
    {semi:9,label:'大六度',ex:'Do–La'},
    {semi:10,label:'小七度',ex:'Do–Bb'},
    {semi:12,label:'纯八度',ex:'Do–Do'}
  ],
  triads:[
    {iv:[0,4,7],label:'大三和弦',ex:'明亮 稳定'},
    {iv:[0,3,7],label:'小三和弦',ex:'柔和 暗淡'},
    {iv:[0,3,6],label:'减三和弦',ex:'紧张 收缩'},
    {iv:[0,4,8],label:'增三和弦',ex:'悬浮 不安'}
  ],
  sevenths:[
    {iv:[0,4,7,10],label:'属七和弦',ex:'想要解决'},
    {iv:[0,4,7,11],label:'大七和弦',ex:'梦幻 爵士'},
    {iv:[0,3,7,10],label:'小七和弦',ex:'慵懒 柔和'},
    {iv:[0,3,6,10],label:'半减七和弦',ex:'幽暗 紧张'}
  ],
  init(){
    if(this.inited) return; this.inited=true;
    $('#earMode').onclick=e=>{
      const b=e.target.closest('button'); if(!b)return;
      $$('#earMode button').forEach(x=>x.classList.toggle('on',x===b));
      this.mode=b.dataset.m;
      this.n=0; this.ok=0; this.streak=0;
      this.updateStats();
      this.newQuestion();
    };
    $('#earPlay').onclick=()=>{ AudioEngine.ensure(); this.play(); };
    $('#earOptions').onclick=e=>{
      const b=e.target.closest('.ear-opt'); if(!b||this.answered)return;
      this.answered=true;
      const idx=+b.dataset.i;
      const right=idx===this.answer;
      $$('.ear-opt').forEach((x,i)=>{
        x.classList.add('disabled');
        if(i===this.answer) x.classList.add('right');
        else if(i===idx) x.classList.add('wrong');
      });
      this.n++;
      if(right){this.ok++;this.streak++;this.bestStreak=Math.max(this.bestStreak,this.streak);$('#earQ').textContent='回答正确！';}
      else{this.streak=0;$('#earQ').textContent='正确答案已标绿，再听一遍';}
      this.updateStats();
      setTimeout(()=>this.newQuestion(),1500);
    };
    this.newQuestion();
  },
  updateStats(){
    $('#earN').textContent=this.n;
    $('#earOk').textContent=this.ok;
    $('#earRate').textContent=this.n?Math.round(this.ok/this.n*100)+'%':'0%';
    $('#earStreak').textContent=this.streak;
  },
  shuffle(arr){return arr.map(v=>[Math.random(),v]).sort((a,b)=>a[0]-b[0]).map(x=>x[1]);},
  newQuestion(){
    this.answered=false;
    if(this.mode==='note'){
      // 附录优化 5：去掉与 60 重复的 72（都是 C），否则 C 被抽中概率是其它音的两倍
      const pool=[60,62,64,65,67,69,71];
      const midi=pool[Math.floor(Math.random()*pool.length)];
      const label=noteNameNoOct(midi);
      const names=[...new Set(pool.map(m=>noteNameNoOct(m)))];
      const wrongs=this.shuffle(names.filter(x=>x!==label)).slice(0,3);
      this.opts=this.shuffle([label,...wrongs]);
      this.answer=this.opts.indexOf(label);
      this._play=()=>{ AudioEngine.tone(freqFromMidi(midi),1.6,'sine',.3); };
      $('#earQ').textContent='这是哪个音？（C 大调）';
    }
    if(this.mode==='interval'){
      const root=52+Math.floor(Math.random()*10);
      const item=this.intervals[Math.floor(Math.random()*this.intervals.length)];
      this._play=()=>{
        AudioEngine.tone(freqFromMidi(root),1,'sine',.28);
        AudioEngine.tone(freqFromMidi(root+item.semi),1.4,'sine',.28,1.05);
      };
      const labels=this.intervals.map(x=>x.label);
      const wrongs=this.shuffle(labels.filter(x=>x!==item.label)).slice(0,3);
      this.opts=this.shuffle([item.label,...wrongs]);
      this.answer=this.opts.indexOf(item.label);
      $('#earQ').textContent='两个音之间是什么音程？';
    }
    if(this.mode==='triad'||this.mode==='seven'){
      const list=this.mode==='triad'?this.triads:this.sevenths;
      const item=list[Math.floor(Math.random()*list.length)];
      const root=50+Math.floor(Math.random()*8);
      this._play=()=>{
        // 先分解后柱式
        item.iv.forEach((v,i)=>AudioEngine.tone(freqFromMidi(root+v),1.4,'sine',.16,0.15+i*0.18));
        item.iv.forEach(v=>AudioEngine.tone(freqFromMidi(root+v),1.8,'triangle',.12,0.15+item.iv.length*0.18+0.25));
      };
      const labels=list.map(x=>x.label);
      const wrongs=this.shuffle(labels.filter(x=>x!==item.label)).slice(0,3);
      this.opts=this.shuffle([item.label,...wrongs]);
      this.answer=this.opts.indexOf(item.label);
      $('#earQ').textContent='这是什么和弦色彩？';
    }
    const list=this.mode==='triad'?this.triads:this.mode==='seven'?this.sevenths:this.intervals;
    const exMap={};
    if(Array.isArray(list)) list.forEach(x=>exMap[x.label]=x.ex);
    $('#earOptions').innerHTML=this.opts.map((o,i)=>
      `<button class="ear-opt" data-i="${i}">${o}<small>${exMap[o]||''}</small></button>`).join('');
  },
  play(){ if(this._play) this._play(); }
};
onRouteEnter.ear=()=>Ear.init();

window.Ear = Ear;
export { Ear };
