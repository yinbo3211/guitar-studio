/* ============================================================
   六弦工坊 V3 · 模块 5：练耳
   （M3 目录重构：由 V2 app-*.js 拆分，代码体保持不变）
   ============================================================ */
'use strict';

/* V4.3.1 收尾：用户可见文案统一走宿主词条（无宿主 / Node 单测回退 key） */
const T = k => { try { if(typeof window!=='undefined' && typeof window.t==='function') return window.t(k); } catch(e){} return k; };
const TF = (k,p) => { try { if(typeof window!=='undefined' && window.gsI18n && typeof window.gsI18n.tF==='function') return window.gsI18n.tF(k,p); } catch(e){} let s=T(k); for(const a of Object.keys(p||{})) s=s.split('{'+a+'}').join(String(p[a])); return s; };

const { clamp, midiFromFreq, freqFromMidi, NOTE_NAMES, NOTE_CN, noteName, noteNameNoOct, makeSmoother, PitchDetect, OPEN_MIDI, tapBpm, isSubAccent, quantizeToOctave, matchFretTarget, isPitchMatch, centsBetween, pcFromName } = AudioCore;   // V3 M3：模块级解构（原 app 文件共享作用域）

/* ============================================================
   模块 5：练耳训练
   ============================================================ */
/* ---------- F3：难度分级与随机音高池（纯函数，供单测覆盖） ----------
   入门：自然音、单八度（C4-B4）
   进阶：含变化音、双八度（C3-B4）
   大师：音程/旋律短句（C3-C5，含变化音） */
const EAR_LEVELS = ['basic', 'advance', 'master'];
const EAR_LEVEL_DEF = {
  basic:   { octaves: 1, withAccidental: false, melody: false, range: [60, 71] },
  advance: { octaves: 2, withAccidental: true,  melody: false, range: [48, 71] },
  master:  { octaves: 2, withAccidental: true,  melody: true,  range: [48, 84] }
};
/* 生成某难度下的音高池（MIDI 数组，去重且升序） */
function earPitchPool(level) {
  const def = EAR_LEVEL_DEF[level] || EAR_LEVEL_DEF.basic;
  const [lo, hi] = def.range;
  const naturals = [0, 2, 4, 5, 7, 9, 11];           // 自然音音级
  const out = [];
  for (let m = lo; m <= hi; m++) {
    const pcv = ((m % 12) + 12) % 12;
    if (def.withAccidental || naturals.includes(pcv)) out.push(m);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}
/* 旋律短句：2-4 音，级进为主，限制在难度范围内 */
function earMelody(level, len) {
  const pool = earPitchPool(level);
  if (!pool.length) return [];
  const n = Math.max(2, Math.min(4, len || (2 + Math.floor(Math.random() * 3))));
  const startIdx = Math.floor(Math.random() * pool.length);
  const seq = [pool[startIdx]];
  while (seq.length < n) {
    const step = [-2, -1, -1, 1, 1, 2][Math.floor(Math.random() * 6)];   // 偏好级进
    const next = pool[Math.min(pool.length - 1, Math.max(0, pool.indexOf(seq[seq.length - 1]) + step))];
    seq.push(next);
  }
  return seq;
}

/* V4.3.1：术语走词条；label/ex 保留原文作 zh-CN 回退与单测契约 */
const L = x => T(x.lk), E = x => T(x.ek);

const Ear = {
  mode:'note', n:0, ok:0, streak:0, bestStreak:0, answer:null, answered:false, opts:[], _nextTimer:null,
  level:'basic', melody:[], melodyInput:[], startedAt:0, reactionSum:0, reactionN:0, _askedAt:0,
  intervals:[
    {semi:2,label:'大二度',ex:'Do–Re',lk:'ear.iv.m2',ek:'ear.iv.m2.ex'},
    {semi:3,label:'小三度',ex:'La–Do',lk:'ear.iv.m3',ek:'ear.iv.m3.ex'},
    {semi:4,label:'大三度',ex:'Do–Mi',lk:'ear.iv.M3',ek:'ear.iv.M3.ex'},
    {semi:5,label:'纯四度',ex:'Do–Fa',lk:'ear.iv.p4',ek:'ear.iv.p4.ex'},
    {semi:7,label:'纯五度',ex:'Do–Sol',lk:'ear.iv.p5',ek:'ear.iv.p5.ex'},
    {semi:9,label:'大六度',ex:'Do–La',lk:'ear.iv.M6',ek:'ear.iv.M6.ex'},
    {semi:10,label:'小七度',ex:'Do–Bb',lk:'ear.iv.m7',ek:'ear.iv.m7.ex'},
    {semi:12,label:'纯八度',ex:'Do–Do',lk:'ear.iv.p8',ek:'ear.iv.p8.ex'}
  ],
  triads:[
    {iv:[0,4,7],label:'大三和弦',ex:'明亮 稳定',lk:'ear.triad.major',ek:'ear.triad.major.ex'},
    {iv:[0,3,7],label:'小三和弦',ex:'柔和 暗淡',lk:'ear.triad.minor',ek:'ear.triad.minor.ex'},
    {iv:[0,3,6],label:'减三和弦',ex:'紧张 收缩',lk:'ear.triad.dim',ek:'ear.triad.dim.ex'},
    {iv:[0,4,8],label:'增三和弦',ex:'悬浮 不安',lk:'ear.triad.aug',ek:'ear.triad.aug.ex'}
  ],
  sevenths:[
    {iv:[0,4,7,10],label:'属七和弦',ex:'想要解决',lk:'ear.seventh.dom',ek:'ear.seventh.dom.ex'},
    {iv:[0,4,7,11],label:'大七和弦',ex:'梦幻 爵士',lk:'ear.seventh.maj',ek:'ear.seventh.maj.ex'},
    {iv:[0,3,7,10],label:'小七和弦',ex:'慵懒 柔和',lk:'ear.seventh.min',ek:'ear.seventh.min.ex'},
    {iv:[0,3,6,10],label:'半减七和弦',ex:'幽暗 紧张',lk:'ear.seventh.halfdim',ek:'ear.seventh.halfdim.ex'}
  ],
  init(){
    if(this.inited){ return; } this.inited=true;
    /* F3：恢复上次难度 */
    try{ const lv=localStorage.getItem('gs.ear.level'); if(lv && EAR_LEVELS.includes(lv)) this.level=lv; }catch(_){}
    if($('#earLevel')) $$('#earLevel button').forEach(x=>x.classList.toggle('on',x.dataset.lv===this.level));
    this.startedAt=Date.now();
    $('#earMode').onclick=e=>{
      const b=e.target.closest('button'); if(!b)return;
      $$('#earMode button').forEach(x=>x.classList.toggle('on',x===b));
      this.mode=b.dataset.m;
      // P2-6 修复：切模式时作废上一题尚未触发的「1.5s 后自动出新题」定时器，
      // 否则旧定时器会在新题上再跑一次 newQuestion，把题面莫名换掉。
      if(this._nextTimer){ clearTimeout(this._nextTimer); this._nextTimer=null; }
      this.n=0; this.ok=0; this.streak=0;
      this.updateStats();
      this.newQuestion();
    };
    $('#earPlay').onclick=()=>{ AudioEngine.ensure(); this.play(); };
    /* F3：难度切换 */
    if($('#earLevel')) $('#earLevel').onclick=e=>{
      const b=e.target.closest('button'); if(!b)return;
      $$('#earLevel button').forEach(x=>x.classList.toggle('on',x===b));
      this.setLevel(b.dataset.lv);
    };
    /* F3：旋律模仿模式 —— 音名选择 + 回听 + 提交 */
    if($('#earMelodyNotes')) $('#earMelodyNotes').onclick=e=>{
      const b=e.target.closest('button'); if(!b)return;
      if(this.melodyInput.length>=this.melody.length) return;
      this.melodyInput.push(+b.dataset.semi);
      this.renderMelodyInput();
    };
    if($('#earReplay')) $('#earReplay').onclick=()=>{ AudioEngine.ensure(); this.play(); };
    if($('#earMelodyClear')) $('#earMelodyClear').onclick=()=>{ this.melodyInput=[]; this.renderMelodyInput(); };
    if($('#earMelodySubmit')) $('#earMelodySubmit').onclick=()=>this.submitMelody();
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
      // F3：记录单题反应时间（用于本轮平均反应时间展示）
      if(this._askedAt){ this.reactionSum+=Date.now()-this._askedAt; this.reactionN++; }
      this.n++;
      if(right){this.ok++;this.streak++;this.bestStreak=Math.max(this.bestStreak,this.streak);this._setQ('ear.correct');}
      else{this.streak=0;this._setQ('ear.wrong');}
      this.updateStats();
      if(this.n%10===0) this.report();
      this._nextTimer=setTimeout(()=>{ this._nextTimer=null; this.newQuestion(); },1500);
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
  setLevel(lv){
    if(!EAR_LEVELS.includes(lv)) lv='basic';
    this.level=lv;
    try{ localStorage.setItem('gs.ear.level', lv); }catch(_){}
    this.n=0; this.ok=0; this.streak=0; this.reactionSum=0; this.reactionN=0;
    this.startedAt=Date.now();
    this.updateStats();
    this.newQuestion();
  },
  /* F3：每 10 题汇总上报一次练习数据（F1 统计中心）
     BUG-03 修复：上报后必须把本轮计数清零。旧实现只重置 startedAt，
     n/ok/reactionSum/reactionN 继续在历史值上累加，导致：
       · 第 2 条会话的题数变成 20（而非当轮 10），正确率变成累计值；
       · 时长按「累计题数 × 单题时长」虚增（两轮 20 题会算出 30 题的量）；
       · 「满 10 题上报」与「切页补报」形成重复上报。
     清零后，切页补报只在「本轮尚未满 10 题」时触发，一次练习仅一条会话。 */
  report(){
    if(typeof PracticeStore!=='undefined' && this.n>0){
      // BUG-03：先快照当轮口径再上报，随后立即复位——旧实现只重置
      // startedAt，n/ok/reactionSum 持续累计，导致每 10 题重复上报历史
      // 累计成绩（会话条数虚增、accuracy 被历史稀释）。
      const roundN=this.n, roundOk=this.ok, roundStart=this.startedAt||Date.now(),
            roundLevel=this.level, roundMode=this.mode,
            roundAvg=this.reactionN?Math.round(this.reactionSum/this.reactionN):null;
      PracticeStore.addSession({
        module:'ear',
        startedAt:roundStart,
        durationMs:Date.now()-roundStart,
        accuracy:roundN?roundOk/roundN:null,
        meta:{ level:roundLevel, mode:roundMode, questions:roundN,
               avgReactionMs:roundAvg }
      });
      this.n=0; this.ok=0;
      this.reactionSum=0; this.reactionN=0;
      this.startedAt=Date.now();
      // streak/bestStreak 是跨轮连击统计，保留不重置
      this.updateStats();
    }
    // 无论是否真的落库（未挂载数据层时）都复位，避免状态残留
    this.n=0; this.ok=0; this.reactionSum=0; this.reactionN=0;
    this.startedAt=Date.now();
  },
  newQuestion(){
    this.answered=false;
    this._askedAt=Date.now();
    const lvDef=EAR_LEVEL_DEF[this.level]||EAR_LEVEL_DEF.basic;
    /* F3：旋律模仿模式（大师档位专属，也可在其它档位手动切到 melody） */
    if(this.mode==='melody'){
      this.melody=earMelody(this.level);
      this.melodyInput=[];
      this._play=()=>{
        this.melody.forEach((m,i)=>AudioEngine.tone(freqFromMidi(m),.9,'sine',.26,i*0.55));
      };
      const len=this.melody.length;
      this._setQ('ear.q.melody',{n:len});
      $('#earOptions').innerHTML='';
      if($('#earMelodyBox')) $('#earMelodyBox').style.display='';
      this.renderMelodyInput();
      setTimeout(()=>this.play(),260);
      return;
    }
    if($('#earMelodyBox')) $('#earMelodyBox').style.display='none';
    if(this.mode==='note'){
      // F3：按难度取音高池（不再固定 60-71 单一八度）
      const pool=earPitchPool(this.level);
      const midi=pool[Math.floor(Math.random()*pool.length)];
      const label=noteNameNoOct(midi);
      const names=[...new Set(pool.map(m=>noteNameNoOct(m)))];
      const wrongs=this.shuffle(names.filter(x=>x!==label)).slice(0,3);
      this.opts=this.shuffle([label,...wrongs]);
      this.answer=this.opts.indexOf(label);
      this._play=()=>{ /* V3.1 BUG-5：与和弦库同源拨弦音色 */ AudioEngine.pluck(freqFromMidi(midi),0,1.6,.32); };
      this._setQ(lvDef.octaves>1?'ear.q.noteWide':'ear.q.note');
    }
    if(this.mode==='interval'){
      const pool=earPitchPool(this.level);
      const root=pool[Math.floor(Math.random()*pool.length)];
      const item=this.intervals[Math.floor(Math.random()*this.intervals.length)];
      this._play=()=>{
        AudioEngine.pluck(freqFromMidi(root),0,1.4,.3);
        AudioEngine.pluck(freqFromMidi(root+item.semi),1.05,1.4,.3);
      };
      const labels=this.intervals.map(x=>L(x));
      const wrongs=this.shuffle(labels.filter(x=>x!==L(item))).slice(0,3);
      this.opts=this.shuffle([L(item),...wrongs]);
      this.answer=this.opts.indexOf(L(item));
      this._setQ('ear.q.interval');
    }
    if(this.mode==='triad'||this.mode==='seven'){
      const list=this.mode==='triad'?this.triads:this.sevenths;
      const item=list[Math.floor(Math.random()*list.length)];
      const root=50+Math.floor(Math.random()*8);
      this._play=()=>{
        // 先分解后柱式
        item.iv.forEach((v,i)=>AudioEngine.pluck(freqFromMidi(root+v),0.15+i*0.18,1.4,.2));
        /* V3.1 BUG-5：齐奏改用和弦库同款 strum（吉他扫弦链路） */
        AudioEngine.strum(item.iv.map(v=>freqFromMidi(root+v)),'down',.3);
      };
      const labels=list.map(x=>L(x));
      const wrongs=this.shuffle(labels.filter(x=>x!==L(item))).slice(0,3);
      this.opts=this.shuffle([L(item),...wrongs]);
      this.answer=this.opts.indexOf(L(item));
      this._setQ('ear.q.triad');
    }
    const list=this.mode==='triad'?this.triads:this.mode==='seven'?this.sevenths:this.intervals;
    const exMap={}, keyMap={};
    if(Array.isArray(list)) list.forEach(x=>{ exMap[L(x)]=E(x); keyMap[L(x)]={lk:x.lk,ek:x.ek}; });
    this._keyMap=keyMap;
    $('#earOptions').innerHTML=this.opts.map((o,i)=>{
      const rec=keyMap[o];
      return `<button class="ear-opt" data-i="${i}"${rec?` data-lk="${rec.lk}" data-ek="${rec.ek}"`:''}>${o}<small>${exMap[o]||''}</small></button>`;
    }).join('');
  },
  renderMelodyInput(){
    const box=$('#earMelodyInput'); if(!box) return;
    const names=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    box.innerHTML=this.melodyInput.length
      ? this.melodyInput.map(s=>`<span class="ear-mel-note">${names[((s%12)+12)%12]}</span>`).join('')
      : '<span style="color:var(--txt-3);font-size:12.5px">'+T('ear.melodyEmpty')+'</span>';
    if($('#earMelodyHint')) $('#earMelodyHint').textContent=`${this.melodyInput.length}/${this.melody.length}`;
  },
  submitMelody(){
    if(!this.melody.length) return;
    const right=this.melody.length===this.melodyInput.length &&
      this.melody.every((m,i)=>((m%12)+12)%12===((this.melodyInput[i]%12)+12)%12);
    this.n++;
    if(right){ this.ok++; this.streak++; this.bestStreak=Math.max(this.bestStreak,this.streak); this._setQ('ear.melodyPerfect'); }
    else{ this.streak=0; this._setQ('ear.melodyOrder',{order:this.melody.map(m=>noteNameNoOct(m)).join(' → ')}); }
    this.updateStats();
    if(this.n%10===0) this.report();
    setTimeout(()=>this.newQuestion(),1800);
  },
  play(){ if(this._play) this._play(); },
  /* V4.3.1：题面按「取词来源」重放；选项按钮只改文本不重建，
     保住 disabled / right / wrong 作答状态与 n/ok/streak 计分。 */
  _setQ(key,pairs){
    this._qKey=key; this._qPairs=pairs||null;
    $('#earQ').textContent=pairs?TF(key,pairs):T(key);
  },
  refreshLang(){
    if(!this.inited) return;
    $$('#earOptions .ear-opt[data-lk]').forEach(b=>{
      const lk=b.dataset.lk, ek=b.dataset.ek;
      b.innerHTML=T(lk)+'<small>'+(ek?T(ek):'')+'</small>';
    });
    if(this._qKey) $('#earQ').textContent=this._qPairs?TF(this._qKey,this._qPairs):T(this._qKey);
    if($('#earMelodyInput')) this.renderMelodyInput();
  }
};
if(typeof document!=='undefined' && document.addEventListener){
  document.addEventListener('gs:lang',()=>Ear.refreshLang());
}
onRouteEnter.ear=()=>{ Ear.init(); };
/* 离开练耳页时补报一次，保证短时练习也计入 F1 统计 */
if(typeof cleanupModules==='function'){
  const _prevCleanup=cleanupModules;
  window.cleanupModules=function(){
    if(typeof Ear!=='undefined' && Ear.n>0) Ear.report();
    _prevCleanup();
  };
}

window.Ear = Ear;
/* 便于自动化测试与调试：以命名空间形式暴露纯函数，不污染全局 */
window.EarTraining = { earPitchPool, earMelody, EAR_LEVELS, EAR_LEVEL_DEF };
export { Ear, earPitchPool, earMelody, EAR_LEVELS, EAR_LEVEL_DEF };
