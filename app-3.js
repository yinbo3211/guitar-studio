/* ============================================================
   模块 4：和弦闯关（麦克风逐弦判定）
   ============================================================ */
/* P2-09 修复：检测音高换算跟随调音器的 A4 基准设置（V1 硬编码 440，
   用户在调音器里改了 A4 后，闯关与音阶跟弹的判定基准仍然不变，导致判定偏移） */
function baseMidi(freq){
  const a4 = (typeof Tuner!=='undefined' && Tuner.a4) ? Tuner.a4 : 440;
  return 69 + 12*Math.log2(freq/a4);
}
const Game = {
  levels:[
    {name:'第 1 关 · 入门开放和弦', pool:['C','G','Am','Em'], time:18},
    {name:'第 2 关 · 进阶开放和弦', pool:['C','G','Am','Em','D','A','Dm','E7','G7'], time:15},
    {name:'第 3 关 · 横按挑战', pool:['F','Bm','E','D','Am','Em'], time:14},
    {name:'第 4 关 · 综合混合', pool:['C','G','D','Am','Em','F','E','A','Dm','Bm','G7','C7'], time:12}
  ],
  level:0, running:false, mic:false,
  score:0, combo:0, maxCombo:0, okCount:0, idx:0, queue:[],
  cur:null, done:null, lastWrongAt:0, cand:null, candCount:0,
  timer:null, timeLeft:0, total:10,
  init(){
    if(this.inited) return; this.inited=true;
    $('#levelCards').innerHTML=this.levels.map((l,i)=>`
      <div class="level-card ${i===0?'sel':''}" data-i="${i}">
        <div class="lv">${l.name}</div>
        <p>${i===0?'零基础友好：最常用的四个开放和弦':'包含 '+l.pool.length+' 个和弦，每个限时 '+l.time+' 秒'}</p>
        <div class="ch">${l.pool.join(' · ')}</div>
      </div>`).join('');
    $('#levelCards').onclick=e=>{
      const c=e.target.closest('.level-card'); if(!c)return;
      $$('#levelCards .level-card').forEach(x=>x.classList.toggle('sel',x===c));
      this.level=+c.dataset.i;
    };
    $('#gameStart').onclick=()=>this.startRound();
    // P0-03 修复：跳过必须推进题号，否则永久卡在同一和弦
    $('#gameSkip').onclick=()=>{ this.skipChord(); };
    $('#gameQuit').onclick=()=>this.quit();
    $('#gameAgain').onclick=()=>{ $('#gameResult').style.display='none'; this.startRound(); };
    $('#gameBack').onclick=()=>{ this.stopMic(); $('#gameResult').style.display='none'; $('#gamePlay').style.display='none'; $('#gameIntro').style.display='block'; };
  },
  async startRound(){
    AudioEngine.ensure();
    if(!this.mic){
      $('#gameStart').innerHTML='<span class="dots"><i></i><i></i><i></i></span>';
      const ok=await Mic.start(r=>this.onPitch(r));
      this.mic=ok;
      if(!ok){ $('#gameStart').innerHTML='开启麦克风失败，请重试'; return; }
    }
    const lv=this.levels[this.level];
    this.queue=[];
    for(let i=0;i<this.total;i++){
      let pick;
      do{ pick=lv.pool[Math.floor(Math.random()*lv.pool.length)]; }
      while(this.queue.length && pick===this.queue[this.queue.length-1]);
      this.queue.push(pick);
    }
    this.score=0; this.combo=0; this.maxCombo=0; this.okCount=0; this.idx=0;
    $('#gameIntro').style.display='none';
    $('#gameResult').style.display='none';
    $('#gamePlay').style.display='block';
    this.running=true;
    this.nextChord();
  },
  nextChord(){
    // P0-03：清掉尚未触发的超时跳转，防止超时等待期间点"跳过"造成双重推进
    if(this.skipTimer){ clearTimeout(this.skipTimer); this.skipTimer=null; }
    if(this.idx>=this.total){ this.finish(); return; }
    const name=this.queue[this.idx];
    this.cur=CHORD_MAP[name];
    this.done=this.cur.frets.map(f=>f<0?'muted':false);
    this.cand=null; this.candCount=0;
    this.timeLeft=this.levels[this.level].time;
    $('#levelLabel').textContent=this.levels[this.level].name;
    $('#gameChord').textContent=name;
    $('#gameDiagram').innerHTML=renderDiagram(this.cur,{big:true});
    this.renderStringCheck();
    $('#gameProg').textContent=(this.idx+1)+'/'+this.total;
    $('#gameCombo').textContent=this.combo;
    $('#gameTip').textContent='从最粗的 6 弦开始，依次拨响';
    this.renderTime();
    clearInterval(this.timer);
    this.timer=setInterval(()=>{
      this.timeLeft-=0.1;
      if(this.timeLeft<=0){
        // P0-03 修复：超时同样必须推进题号（V1 只重绘同一和弦，永久卡死）
        $('#gameTip').textContent='超时，下一个和弦…';
        this.skipChord();
        return;
      }
      this.renderTime();
    },100);
  },
  /* P0-03：跳过/超时统一入口——先推进题号再进入下一题 */
  skipChord(){
    if(!this.running) return;
    clearInterval(this.timer);
    this.combo=0;
    this.idx++;
    $('#gameCombo').textContent=0;
    // 略作停顿给出反馈，期间再点跳过由 nextChord 开头的 skipTimer 清理兜底
    this.skipTimer=setTimeout(()=>{ this.skipTimer=null; this.nextChord(); },400);
  },
  renderTime(){
    const total=this.levels[this.level].time;
    const pct=clamp(this.timeLeft/total*100,0,100);
    const bar=$('#timeBar');
    bar.style.width=pct+'%';
    bar.style.background=pct>50?'var(--grad-mint)':pct>25?'linear-gradient(90deg,#ffd27a,#f59136)':'linear-gradient(90deg,#ff7d8e,#ff5d73)';
  },
  renderStringCheck(){
    const labels=['6弦','5弦','4弦','3弦','2弦','1弦'];
    $('#stringCheck').innerHTML=this.cur.frets.map((f,i)=>{
      let cls='sc';
      if(f<0) cls+=' muted';
      if(this.done[i]==='done') cls+=' done';
      const target=f<0?null:OPEN_MIDI[i]+f;
      const txt=f<0?'×':(f===0?'空':f+'品');
      return `<div class="${cls}" data-i="${i}"><b>${f<0?'×':noteNameNoOct(target)}</b><span>${labels[i]} ${txt}</span></div>`;
    }).join('');
  },
  onPitch(r){
    if(!this.running||!this.cur||r.freq==null){ this.cand=null; return; }
    const mf=baseMidi(r.freq); // P2-09：跟随 A4 基准
    // 找匹配目标弦（允许八度等价，防止泛音误判）——V2 M1：核心匹配迁至 AudioCore.matchFretTarget
    const targets=[];
    for(let i=0;i<6;i++){
      if(this.done[i]!==false) continue;
      const f=this.cur.frets[i];
      if(f<0) continue;
      targets.push({i, target:OPEN_MIDI[i]+f});
    }
    const m=AudioCore.matchFretTarget(mf, targets);
    if(m!==null){
      if(this.cand===m.i){ this.candCount++; } else { this.cand=m.i; this.candCount=1; }
      if(this.candCount>=2){
        this.cand=null; this.candCount=0;
        this.markDone(m.i);
      }
      return;
    }
    // 是否是错误音：最近半音不在和弦音集合内
    // V2 M1 BugFix：旧实现 n.replace('b','#') 会把 'Bb' 变成 'B#'（indexOf=-1），
    // 导致 C7 和弦弹对 Bb 也被误判为错音；改用 AudioCore.pcFromName 正确解析升降号
    const nearest=Math.round(mf);
    const chordPC=this.cur.notes.map(n=>AudioCore.pcFromName(n));
    const pc=((nearest%12)+12)%12;
    const isChordTone=chordPC.some(c=>c===pc);
    const now=performance.now();
    if(!isChordTone && now-this.lastWrongAt>700){
      this.lastWrongAt=now;
      // 找出可能弹错的弦（未完成的弦）
      const miss=[];
      for(let i=0;i<6;i++) if(this.done[i]===false) miss.push(i);
      if(miss.length){
        const sc=$(`.sc[data-i="${miss[0]}"]`);
        if(sc){ sc.classList.add('miss'); setTimeout(()=>sc.classList.remove('miss'),450); }
        $('#gameTip').innerHTML='这个音不对，检查手指是否按牢、按准品位';
      }
    }
    this.cand=null;
  },
  markDone(i){
    this.done[i]='done';
    AudioEngine.pluck(freqFromMidi(OPEN_MIDI[i]+this.cur.frets[i]),0,0.9,.18);
    this.renderStringCheck();
    if(this.done.every(x=>x!==false)){
      // 本和弦完成
      this.running=false;
      clearInterval(this.timer);
      this.okCount++;
      this.combo++;
      this.maxCombo=Math.max(this.maxCombo,this.combo);
      const bonus=Math.ceil(this.timeLeft)*2 + this.combo*2;
      const gain=10+bonus;
      this.score+=gain;
      $('#gameScore').textContent=this.score;
      $('#gameCombo').textContent=this.combo;
      const pop=$('#comboPop');
      pop.textContent= this.combo>1 ? this.combo+' 连击 +'+gain : '+'+gain;
      pop.classList.remove('go'); void pop.offsetWidth; pop.classList.add('go');
      $('#gameTip').textContent='完成！准备下一个和弦…';
      setTimeout(()=>{
        this.idx++;
        this.running=true;
        this.nextChord();
      },750);
    }
  },
  finish(){
    this.running=false;
    clearInterval(this.timer);
    $('#gamePlay').style.display='none';
    $('#gameResult').style.display='block';
    const pass=this.okCount>=6;
    $('#resultTitle').textContent=pass?'恭喜通关':'本轮结束';
    $('#resultSub').textContent=pass?'全部和弦判定正确，继续挑战更高难度吧':'正确 '+this.okCount+'/'+this.total+'，回到和弦库复习指法后再战';
    $('#rScore').textContent=this.score;
    $('#rOk').textContent=this.okCount+'/'+this.total;
    $('#rCombo').textContent=this.maxCombo;
  },
  stopMic(){
    this.running=false;
    clearInterval(this.timer);
    // P0-03：退出/结算时清掉待触发的跳题定时器，避免界面残留跳转
    if(this.skipTimer){ clearTimeout(this.skipTimer); this.skipTimer=null; }
    if(this.mic){ Mic.stop(); this.mic=false; }
  },
  quit(){
    this.stopMic();
    $('#gamePlay').style.display='none';
    $('#gameResult').style.display='none';
    $('#gameIntro').style.display='block';
    $('#gameStart').innerHTML='<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l11-6.5a1 1 0 0 0 0-1.72l-11-6.5A1 1 0 0 0 8 5.5z"/></svg> 开启麦克风开始';
  }
};
onRouteEnter.game=()=>Game.init();

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

/* ============================================================
   模块 6：指板训练
   ============================================================ */
const Fret = {
  mode:'browse', targetPC:null, askN:0, askOk:0, playing:false,
  // 显示顺序：1弦（最上）到 6弦（最下）
  strings:[64,59,55,50,45,40],
  init(){
    if(this.inited) return; this.inited=true;
    this.build();
    $('#fbMode').onclick=e=>{
      const b=e.target.closest('button'); if(!b)return;
      $$('#fbMode button').forEach(x=>x.classList.toggle('on',x===b));
      this.mode=b.dataset.m;
      this.playing=false;
      // P2-16 修复：切换模式必须重置练习进度与记分（V1 残留旧 askN/askOk，
      // 新模式的第 1 题就显示成 N/M 的错误计数）
      this.askN=0; this.askOk=0; this.targetPC=null;
      $('#fbStart').style.display=this.mode==='find'?'inline-flex':'none';
      $('#fbStart').textContent='开始找音'; // P2-16：按钮文案回到初始状态
      $('#fbHint').innerHTML=this.mode==='browse'
        ?'<span class="hint">点击品格试听该音，横向滑动查看 12 品</span>'
        :'<span class="hint">点击“开始”，根据提示在指板上找音</span>';
      this.clearMarks();
      $('#fbScore').textContent='';
    };
    $('#fbShowAll').onchange=e=>{ $$('.fb-cell .nm').forEach(n=>n.style.display=e.target.checked?'':'none'); };
    $('#fbStart').onclick=()=>this.ask();
    $('#fbBoard').onclick=e=>{
      const cell=e.target.closest('.fb-cell'); if(!cell)return;
      const s=+cell.dataset.s, f=+cell.dataset.f;
      const midi=this.strings[s]+f;
      AudioEngine.ensure();
      AudioEngine.pluck(freqFromMidi(midi),0,1.6,.3);
      if(this.mode==='find'&&this.playing){
        this.judge(cell,midi);
      }else{
        cell.classList.add('ring');
        setTimeout(()=>cell.classList.remove('ring'),400);
      }
    };
  },
  build(){
    let html='';
    this.strings.forEach((base,s)=>{
      html+='<div class="fb-row">';
      html+=`<div class="fb-open">${noteNameNoOct(base)}<br>弦</div>`;
      for(let f=1;f<=12;f++){
        const midi=base+f, pc=((midi%12)+12)%12;
        const dbl=f===12?'double':'';
        const mark=[3,5,7,9,12].includes(f)?'<span class="dot-mark"></span>':'';
        html+=`<div class="fb-cell ${dbl}" data-s="${s}" data-f="${f}" data-pc="${pc}"><span class="nm">${noteNameNoOct(midi)}</span>${mark}</div>`;
      }
      html+='</div>';
    });
    $('#fbBoard').innerHTML=html;
    $('#fbFretNums').innerHTML='<span></span>'+[...Array(12)].map((_,i)=>`<span>${i+1}</span>`).join('');
  },
  clearMarks(){ $$('.fb-cell').forEach(c=>c.classList.remove('good','bad','ring')); },
  ask(){
    this.clearMarks();
    this.playing=true;
    this.askN++;
    // 随机目标音名（在指板 1-12 品范围内出现过的）
    const s=Math.floor(Math.random()*6);
    const f=1+Math.floor(Math.random()*12);
    this.targetPC=((this.strings[s]+f)%12+12)%12;
    const name=NOTE_NAMES[this.targetPC];
    $('#fbHint').innerHTML=`<span class="fb-ask">请找到：${name}<small>点击指板上所有 ${name} 音的位置都算对</small></span>`;
    $('#fbScore').textContent=`${this.askOk}/${this.askN}`;
    $('#fbStart').textContent='下一题'; // P2-16：出题后按钮文案切换
  },
  judge(cell,midi){
    const pc=((midi%12)+12)%12;
    if(pc===this.targetPC){
      cell.classList.add('good');
      this.askOk++;
      this.playing=false;
      $('#fbScore').textContent=`${this.askOk}/${this.askN}`;
      $('#fbHint').innerHTML=`<span class="fb-ask" style="color:var(--mint)">正确！</span><span class="hint" style="margin-left:10px">点击“下一题”继续</span>`;
      // 标出该音在指板上的所有位置
      $$('.fb-cell').forEach(c=>{ if(+c.dataset.pc===pc) c.classList.add('ring'); });
    }else{
      cell.classList.add('bad');
      setTimeout(()=>cell.classList.remove('bad'),450);
    }
  }
};
onRouteEnter.fret=()=>Fret.init();

/* ============================================================
   模块 8：音阶练习（指板高亮 + 跟听示范 + 麦克风逐音跟弹）
   ============================================================ */
const SCALE_TYPES = {
  major:     {name:'大调',     iv:[0,2,4,5,7,9,11]},
  minor:     {name:'自然小调', iv:[0,2,3,5,7,8,10]},
  majorPent: {name:'大调五声', iv:[0,2,4,7,9]},
  minorPent: {name:'小调五声', iv:[0,3,5,7,10]},
  blues:     {name:'布鲁斯',   iv:[0,3,5,6,7,10]},
  dorian:    {name:'多利亚',   iv:[0,2,3,5,7,9,10]}
};
const SCALE_LIST = [
  {root:'C',type:'major',pos:0},
  {root:'G',type:'major',pos:0},
  {root:'D',type:'major',pos:0},
  {root:'A',type:'minor',pos:0},
  {root:'E',type:'minor',pos:0},
  {root:'C',type:'majorPent',pos:0},
  {root:'A',type:'minorPent',pos:0},
  {root:'A',type:'blues',pos:0},
  {root:'A',type:'minorPent',pos:5},
  {root:'E',type:'minorPent',pos:5},
  {root:'G',type:'major',pos:5},
  {root:'A',type:'dorian',pos:5}
];
const Scale = {
  sel:0, mode:'idle', seq:[], cells:[], fMin:0, fMax:4, rootPc:0,
  i:0, combo:0, ok:0, bestCombo:0,
  mic:false, timer:null, cand:null, candN:0, cooldown:0, bpm:80,
  init(){
    if(this.inited) return; this.inited=true;
    $('#scxList').innerHTML = SCALE_LIST.map((s,idx)=>{
      const t=SCALE_TYPES[s.type];
      const posName=s.pos===0?'开放把位':'第 '+s.pos+' 把位';
      return `<button class="scx-pick ${idx===0?'on':''}" data-i="${idx}">
        <b>${s.root} ${t.name}</b><span>${posName}</span></button>`;
    }).join('');
    $('#scxList').onclick=e=>{
      const b=e.target.closest('.scx-pick'); if(!b)return;
      this.stopAll();
      $$('#scxList .scx-pick').forEach(x=>x.classList.toggle('on',x===b));
      this.sel=+b.dataset.i;
      this.build();
    };
    const sr=$('#scxBpm');
    const paint=v=>{ sr.style.setProperty('--fill',(v-50)/130*100+'%'); };
    paint(80);
    sr.oninput=()=>{ this.bpm=+sr.value; $('#scxBpmVal').textContent=this.bpm+' BPM'; paint(this.bpm); };
    $('#scxListen').onclick=()=>{ if(this.mode==='listen') this.stopListen(); else this.startListen(); };
    $('#scxFollow').onclick=()=>{ if(this.mode==='follow') this.stopFollow(); else this.startFollow(); };
    this.build();
  },
  cur(){ return SCALE_LIST[this.sel]; },
  /* 依据根音/音阶/把位，生成指板格子与往返练习序列 */
  build(){
    const sel=this.cur(), t=SCALE_TYPES[sel.type];
    const rootPc=NOTE_NAMES.indexOf(sel.root);
    const pcSet=t.iv.map(v=>(rootPc+v)%12);
    const fMin=sel.pos===0?0:sel.pos;
    const fMax=sel.pos===0?4:sel.pos+3;
    const cells=[];
    for(let s=0;s<6;s++){
      for(let f=fMin;f<=fMax;f++){
        const midi=OPEN_MIDI[s]+f, pc=((midi%12)+12)%12;
        if(pcSet.includes(pc)) cells.push({s,f,midi,pc,root:pc===rootPc});
      }
    }
    // 上行路径：6弦(s=0)→1弦(s=5)，同弦按品位升序
    const path=[...cells].sort((a,b)=>a.s-b.s||a.f-b.f);
    let start=path.findIndex(c=>c.root);
    if(start<0) start=0;
    const up=[];
    path.slice(start).forEach(c=>{
      const last=up[up.length-1];
      if(!last||last.midi!==c.midi) up.push(c); // 相邻弦同音去重
    });
    const down=up.slice(0,-1).reverse();
    this.seq=up.concat(down);
    this.cells=cells; this.fMin=fMin; this.fMax=fMax;
    this.rootPc=rootPc; this.pcSet=pcSet;
    // 组成音（按音阶顺序）
    const ordered=t.iv.map(v=>NOTE_NAMES[(rootPc+v)%12]);
    $('#scxNotes').innerHTML=
      `<span class="scx-nt-label">${sel.root} ${t.name} · </span>`+
      ordered.map((n,k)=>`<span class="scx-nt ${k===0?'root':''}">${n}</span>`).join('');
    this.renderBoard();
    this.resetStage();
  },
  dot(c){
    return `<span class="scx-dot ${c.root?'is-root':''}"><i>${noteNameNoOct(c.midi)}</i></span>`;
  },
  renderBoard(){
    const frets=[];
    for(let f=(this.fMin===0?1:this.fMin);f<=this.fMax;f++) frets.push(f);
    let html='';
    for(let s=5;s>=0;s--){
      html+='<div class="scx-row">';
      const openCell=this.fMin===0?this.cells.find(c=>c.s===s&&c.f===0):null;
      html+=`<div class="scx-open" data-s="${s}" data-f="0">`;
      if(openCell){
        html+=this.dot(openCell)+`<small class="fnum-s">${6-s}弦</small>`;
      }else{
        html+=`<span class="str-lbl">${noteNameNoOct(OPEN_MIDI[s])}<small>${6-s}弦</small></span>`;
      }
      html+='</div>';
      for(const f of frets){
        const cell=this.cells.find(c=>c.s===s&&c.f===f);
        html+=`<div class="scx-cell" data-s="${s}" data-f="${f}">${cell?this.dot(cell):''}</div>`;
      }
      html+='</div>';
    }
    $('#scxBoard').innerHTML=html;
    $('#scxFretNums').innerHTML='<span></span>'+frets.map(f=>`<span>${f}</span>`).join('');
  },
  cellEl(c){
    if(c.f===0) return $(`.scx-open[data-s="${c.s}"]`);
    return $(`.scx-cell[data-s="${c.s}"][data-f="${c.f}"]`);
  },
  clearAll(){ $$('.scx-cell,.scx-open').forEach(e=>e.classList.remove('now','done')); },
  clearNow(){ $$('.now').forEach(e=>e.classList.remove('now')); },
  markNow(c){
    this.clearNow();
    const el=this.cellEl(c); if(el) el.classList.add('now');
    el&&el.scrollIntoView({block:'nearest',inline:'center',behavior:'smooth'});
  },
  markDone(c){
    const el=this.cellEl(c);
    if(el){ el.classList.remove('now'); el.classList.add('done'); }
  },
  resetStage(){
    this.stopAll();
    this.i=0; this.combo=0; this.ok=0; this.bestCombo=0;
    this.clearAll();
    $('#scxCur').textContent='准备好了吗';
    $('#scxPos').textContent='';
    $('#scxProg').textContent='';
    $('#scxCombo').textContent='';
    $('#scxTip').textContent='先在上方选择音阶，点“跟听示范”听一遍，或开麦克风“跟弹”逐音练习';
    this.updateButtons();
  },
  posText(c){ return (6-c.s)+'弦 · '+(c.f===0?'空弦':c.f+'品'); },
  /* ---- 跟听示范（BPM 逐音，上行再下行） ---- */
  startListen(){
    // Fix-6: 空序列保护——该音阶/把位在指板上无可用音符时直接提示并返回
    if(!this.seq||!this.seq.length){ toast('该音阶在当前把位无可用音符','warn'); return; }
    AudioEngine.ensure();
    this.stopFollow();
    this.mode='listen';
    this.i=0; this.clearAll();
    $('#scxTip').textContent='跟听示范，注意每个音在指板上的位置';
    this.updateButtons();
    this.listenStep();
  },
  listenStep(){
    if(this.mode!=='listen') return;
    if(this.i>=this.seq.length){ this.finishListen(); return; }
    const c=this.seq[this.i];
    AudioEngine.pluck(freqFromMidi(c.midi),0,1.7,.3);
    this.markNow(c);
    $('#scxCur').textContent=noteNameNoOct(c.midi);
    $('#scxPos').textContent=this.posText(c);
    $('#scxProg').textContent=(this.i+1)+'/'+this.seq.length;
    this.i++;
    this.timer=setTimeout(()=>this.listenStep(), 60/this.bpm*1000);
  },
  stopListen(){
    this.mode='idle';
    clearTimeout(this.timer);
    this.clearNow();
    this.updateButtons();
  },
  finishListen(){
    this.mode='idle';
    clearTimeout(this.timer);
    this.clearNow();
    $('#scxCur').textContent='示范完成';
    $('#scxPos').textContent='';
    $('#scxTip').textContent='轮到你了：点“开始跟弹”，照着高亮位置逐音弹';
    this.updateButtons();
  },
  /* ---- 麦克风逐音跟弹 ---- */
  async startFollow(){
    // Fix-6: 空序列保护——该音阶/把位在指板上无可用音符时直接提示并返回
    if(!this.seq||!this.seq.length){ toast('该音阶在当前把位无可用音符','warn'); return; }
    AudioEngine.ensure();
    this.stopListen();
    if(!this.mic){
      const btn=$('#scxFollow');
      btn.innerHTML='<span class="dots"><i></i><i></i><i></i></span>';
      const ok=await Mic.start(r=>this.onPitch(r));
      this.mic=ok;
      if(!ok){ this.updateButtons(); return; }
    }
    this.mode='follow';
    this.i=0; this.combo=0; this.ok=0; this.bestCombo=0;
    this.clearAll();
    $('#scxTip').textContent='照指板高亮的位置拨响当前音，逐音上行再下行';
    $('#scxCombo').textContent='0';
    this.updateButtons();
    this.showTarget();
  },
  showTarget(){
    const c=this.seq[this.i];
    $('#scxCur').textContent=noteNameNoOct(c.midi);
    $('#scxPos').textContent=this.posText(c);
    $('#scxProg').textContent=(this.i+1)+'/'+this.seq.length;
    this.markNow(c);
  },
  onPitch(r){
    if(this.mode!=='follow') return;
    if(performance.now()<this.cooldown) return;
    const c=this.seq[this.i];
    if(!c || !r.freq){ this.cand=null; return; }
    // V2 M1：阈值判定迁至 AudioCore.isPitchMatch；P2-09：跟随 A4 基准
    if(AudioCore.isPitchMatch(baseMidi(r.freq), c.midi)){
      if(this.cand===this.i) this.candN++;
      else { this.cand=this.i; this.candN=1; }
      if(this.candN>=2){ this.cand=null; this.candN=0; this.advance(); }
    }else{
      this.cand=null;
    }
  },
  advance(){
    const c=this.seq[this.i];
    AudioEngine.pluck(freqFromMidi(c.midi),0,0.9,.15);
    this.markDone(c);
    this.ok++; this.combo++;
    this.bestCombo=Math.max(this.bestCombo,this.combo);
    $('#scxCombo').textContent=this.combo;
    this.i++;
    this.cooldown=performance.now()+420; // 等余音衰减，避免连判
    if(this.i>=this.seq.length){ this.finishFollow(); return; }
    setTimeout(()=>{ if(this.mode==='follow' && this.i<this.seq.length) this.showTarget(); }, 320);
  },
  finishFollow(){
    this.mode='idle';
    this.stopMic();
    this.clearNow();
    $('#scxCur').textContent='完成！';
    $('#scxPos').textContent='共弹对 '+this.ok+' 个音';
    $('#scxTip').textContent='最高连击 '+this.bestCombo+'，提高速度或换个音阶继续';
    this.updateButtons();
    toast('音阶练习完成，最高连击 '+this.bestCombo,'ok');
  },
  stopFollow(){
    if(this.mode==='follow'){ this.stopMic(); }
    this.mode='idle';
    this.updateButtons();
  },
  stopMic(){ if(this.mic){ Mic.stop(); this.mic=false; } },
  stopAll(){
    clearTimeout(this.timer);
    this.stopMic();
    this.mode='idle';
  },
  updateButtons(){
    const lb=$('#scxListen'), fb=$('#scxFollow');
    if(!lb||!fb) return;
    lb.textContent=this.mode==='listen'?'停止示范':'跟听示范';
    lb.classList.toggle('btn-danger',this.mode==='listen');
    fb.textContent=this.mode==='follow'?'停止跟弹':'开始跟弹（麦克风）';
    fb.classList.toggle('btn-danger',this.mode==='follow');
    fb.classList.toggle('btn-primary',this.mode!=='follow');
  }
};
onRouteEnter.scale=()=>Scale.init();

/* ============================================================
   模块 7：录音棚（MediaRecorder，本地保存）
   ============================================================ */
const Studio = {
  rec:null, chunks:[], stream:null, ac:null, analyser:null, raf:null,
  t0:0, tickTimer:null, items:[], idx:0,
  init(){
    if(this.inited) return; this.inited=true;
    $('#recBtn').onclick=()=>this.toggle();
  },
  fmt(sec){
    const m=Math.floor(sec/60), s=Math.floor(sec%60);
    return String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
  },
  async toggle(){
    if(this.rec&&this.rec.state==='recording'){ this.stop(); return; }
    // P1-08 修复：MediaRecorder 支持性检查必须先于 getUserMedia——
    // V1 先申请麦克风再检查，旧浏览器不支持时直接 return，
    // 已获取的 stream 永远不会释放，麦克风指示灯常亮（泄漏）。
    if(!window.MediaRecorder){ toast('当前浏览器不支持录音功能','err');return; }
    try{
      this.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false}});
    }catch(e){
      toast('无法访问麦克风，请检查权限','err');return;
    }
    const types=['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg'];
    let mime='';
    for(const t of types){ if(MediaRecorder.isTypeSupported(t)){mime=t;break;} }
    this.rec=mime?new MediaRecorder(this.stream,{mimeType:mime}):new MediaRecorder(this.stream);
    this.chunks=[];
    this.rec.ondataavailable=e=>{ if(e.data.size) this.chunks.push(e.data); };
    this.rec.onstop=()=>{
      const blob=new Blob(this.chunks,{type:mime||'audio/webm'});
      const url=URL.createObjectURL(blob);
      this.idx++;
      const ext=(mime.includes('mp4')?'mp4':'webm');
      const item={url,ext,dur:this.lastDur,name:'录音 '+this.idx};
      this.items.unshift(item);
      this.render();
      this.stream.getTracks().forEach(t=>t.stop());
      this.ac.close(); this.ac=null;
      cancelAnimationFrame(this.raf);
    };
    // 电平表
    this.ac=new (window.AudioContext||window.webkitAudioContext)();
    const src=this.ac.createMediaStreamSource(this.stream);
    this.analyser=this.ac.createAnalyser();
    this.analyser.fftSize=512;
    src.connect(this.analyser);
    const buf=new Float32Array(this.analyser.fftSize);
    const loop=()=>{
      if(!this.analyser) return;
      this.analyser.getFloatTimeDomainData(buf);
      let rms=0; for(let i=0;i<buf.length;i++) rms+=buf[i]*buf[i];
      rms=Math.sqrt(rms/buf.length);
      $('#recLevel').style.width=clamp(rms*700,0,100)+'%';
      this.raf=requestAnimationFrame(loop);
    };
    this.rec.start();
    loop();
    this.t0=Date.now();
    $('#recBtn').classList.add('recording');
    $('#recBtn').innerHTML='<svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2.5"/></svg>';
    $('#recHint').textContent='录音中，再点一次停止';
    this.tickTimer=setInterval(()=>{
      $('#recTime').textContent=this.fmt((Date.now()-this.t0)/1000);
    },200);
  },
  stop(){
    this.lastDur=(Date.now()-this.t0)/1000;
    clearInterval(this.tickTimer);
    $('#recTime').textContent='00:00';
    $('#recLevel').style.width='0';
    $('#recBtn').classList.remove('recording');
    $('#recBtn').innerHTML='<svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor"><circle cx="12" cy="12" r="7"/></svg>';
    $('#recHint').textContent='点击按钮开始录音';
    if(this.rec&&this.rec.state==='recording') this.rec.stop();
    // Fix-7: 停止录音时立即取消电平表 rAF 循环，避免访问已释放的 analyser 资源
    if(this.raf){ cancelAnimationFrame(this.raf); this.raf=null; }
    this.analyser=null;
  },
  render(){
    // P1-07 修复：列表为空时也要清空 DOM 并解除旧事件绑定——
    // V1 提前 return，删除最后一条录音后旧节点（含 <audio>）永远留在页面上。
    // 防御：删除回调里对越界索引先判空，避免极端时序下报错。
    if(!this.items.length){
      $('#recList').innerHTML='';
      $('#recList').onclick=null;
      return;
    }
    $('#recList').innerHTML=this.items.map((it,i)=>`
      <div class="rec-item">
        <div class="name">${it.name}<small>${this.fmt(it.dur)} · ${it.ext.toUpperCase()}</small></div>
        <audio controls preload="metadata" src="${it.url}"></audio>
        <a class="btn btn-sm" style="text-decoration:none" href="${it.url}" download="六弦工坊-${it.name.replace(' ','')}.${it.ext}">下载</a>
        <button class="rec-del" data-i="${i}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg></button>
      </div>`).join('');
    $('#recList').onclick=e=>{
      const b=e.target.closest('.rec-del'); if(!b)return;
      const i=+b.dataset.i;
      if(!this.items[i]) return; // P1-07：越界防御
      URL.revokeObjectURL(this.items[i].url);
      this.items.splice(i,1);
      this.render();
    };
  }
};
onRouteEnter.studio=()=>Studio.init();

/* ============================================================
   路由清理：离开页面时停止麦克风 / 计时 / 伴奏
   P1-05 修复：本函数现由 app-1.js 的 applyRoute 内部调用
   （typeof 保护，初始加载时若未定义则跳过），
   V1 在此处包装 applyRoute 因监听绑定旧引用而从不生效，已删除。
   ============================================================ */
function cleanupModules(){
  if(typeof Metro!=='undefined' && Metro.playing) Metro.stop();
  if(typeof Tuner!=='undefined' && Tuner.active) Tuner.toggle();
  if(typeof Game!=='undefined' && Game.mic) Game.quit();
  if(typeof Scale!=='undefined' && Scale.mode!=='idle') Scale.stopAll();
  if(typeof ChordLib!=='undefined') ChordLib.stopProg();
  if(typeof Fret!=='undefined') Fret.playing=false;
  if(typeof Studio!=='undefined' && Studio.rec && Studio.rec.state==='recording') Studio.stop();
}
applyRoute();
