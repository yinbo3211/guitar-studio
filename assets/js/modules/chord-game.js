/* ============================================================
   六弦工坊 V3 · 模块 4：闯关模式
   （M3 目录重构：由 V2 app-*.js 拆分，代码体保持不变）
   ============================================================ */
'use strict';

const { clamp, midiFromFreq, freqFromMidi, NOTE_NAMES, NOTE_CN, noteName, noteNameNoOct, makeSmoother, PitchDetect, OPEN_MIDI, tapBpm, isSubAccent, quantizeToOctave, matchFretTarget, isPitchMatch, centsBetween, pcFromName } = AudioCore;   // V3 M3：模块级解构（原 app 文件共享作用域）

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
    /* V3.1 BUG-7：进回合先渲染指法图与文字按法（麦克风之前，失败也可见） */
    this._renderFingering();
    if(!this.mic){
      // V3.1 BUG-4：记录原始按钮，失败后完整还原（不再丢按钮样式）
      if(!this._startBtnHtml) this._startBtnHtml=$('#gameStart').innerHTML;
      $('#gameStart').innerHTML='<span class="dots"><i></i><i></i><i></i></span>';
      const ok=await Mic.start(r=>this.onPitch(r));
      this.mic=ok;
      if(!ok){
        $('#gameStart').innerHTML=this._startBtnHtml;
        const hint=Mic.lastDiagnostics?('失败原因: '+Mic.lastDiagnostics.hint):'开启麦克风失败，请重试';
        $('#gameResult').style.display='block';
        $('#gameResult').innerHTML='<div style="color:var(--red);line-height:1.7">'+hint+'<br>无麦克风也可照指法图练习按法。</div>';
        return;
      }
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
  /* V3.1 BUG-7：指法图 + 文字按法（麦克风无关，随时可见） */
  _renderFingering(){
    // V3.1 BUG-7：无 cur（首回合未抽题）时预览该难度池的第一个和弦
    const ch = this.cur || (this.levels[this.level] && CHORD_MAP[this.levels[this.level].pool[0]]);
    const d=$('#gameDiagram');
    if(d && ch) d.innerHTML=renderDiagram(ch,{big:true});
    const holder=$('#gameFingering');
    if(holder && ch) holder.textContent=window.formatFingering?formatFingering(ch):'';
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
      // P2-8 修复：保存完成延迟句柄，退出/停止时一并清除，
      // 否则已在 intro 页时它仍会 nextChord()，在隐藏 DOM 上重建计时与状态。
      this.doneTimer=setTimeout(()=>{
        this.doneTimer=null;
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
    // P2-8：清掉「完成本和弦后 750ms 推进」的定时器
    if(this.doneTimer){ clearTimeout(this.doneTimer); this.doneTimer=null; }
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

window.Game = Game;
export { Game };
