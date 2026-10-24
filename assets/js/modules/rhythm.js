/* ============================================================
   六弦工坊 · 模块 9：节奏型练习（扫弦 / 分解和弦）
   ------------------------------------------------------------
   按《六弦工坊·扫弦与分解节奏型练习·新功能需求手册 V1.0》实现：
     · 节奏数据来自 lib/rhythm-data.js（数据与 UI 分离）；
     · 音频时间轴与节拍器同源：AudioContext.currentTime +
       lookahead 调度（复用 AudioEngine 的音频时钟，不另起炉灶）；
     · 预备拍 1 小节（可关）→ 循环播放，循环数 1/2/4/8/∞；
     · 暂停冻结进度、恢复从原格续播；停止/循环结束做资源清理
       与练习统计（localStorage，异常时静默降级）；
     · 切页（cleanupModules）与 document.hidden 自动暂停。
   ============================================================ */
'use strict';

const { clamp, midiFromFreq, freqFromMidi, NOTE_NAMES, NOTE_CN, noteName, noteNameNoOct, makeSmoother, PitchDetect, OPEN_MIDI, tapBpm, isSubAccent, quantizeToOctave, matchFretTarget, isPitchMatch, centsBetween, pcFromName } = AudioCore;   // V3 M3：模块级解构（原 app 文件共享作用域）

const Rhythm = {
  /* ---------- 状态 ---------- */
  cat:'strum',            // 当前分类：'strum' | 'pick'
  pattern:null,           // 当前预设（RhythmData.ALL_PATTERNS 项）
  chord:'通用',            // 分解模式根音映射和弦
  bpm:60, loops:0,        // loops: 0=∞
  countIn:true,
  demoVol:.8, metroVol:.9,
  phase:'idle',           // idle | countin | playing | paused
  ac:null, demoGain:null, metroGain:null,
  timer:null, raf:null,
  startTime:0,            // 本次播放的 AudioContext 时间锚点
  pausedElapsed:0,        // 暂停时冻结的相对时长（秒）
  playedSeconds:0,        // 本次会话累计练习秒数（不含预备拍）
  lastUiStep:-99,

  init(){
    if(this.inited) return; this.inited=true;
    const RD=window.RhythmData;
    if(!RD){ console.warn('[Rhythm] rhythm-data 未加载'); return; }
    this.pattern = RD.STRUM_PATTERNS[0];

    /* 模式切换 */
    $$('#rtModeSeg button').forEach(b=>b.onclick=()=>{
      if(this.cat===b.dataset.cat) return;
      this.cat=b.dataset.cat;
      $$('#rtModeSeg button').forEach(x=>x.classList.toggle('on',x===b));
      this.stop(false);
      this.pattern=(this.cat==='strum'?RD.STRUM_PATTERNS:RD.PICK_PATTERNS)[0];
      $('#rtChordRow').style.display=this.cat==='pick'?'flex':'none';
      this.renderPatterns(); this.renderGrid(); this.renderInfo();
    });

    /* BPM 控制 */
    const range=$('#rtBpmRange'), num=$('#rtBpmNum');
    const setBpm=(v)=>{
      const nb=clamp(Math.round(v),40,180);
      if(nb===this.bpm){ range.value=this.bpm; num.value=this.bpm; return; }
      /* RT-005：播放中调速必须重锚时间轴，否则 RAF 视觉高亮（按 elapsed 推导）
         与音频调度（按 schedTime 推进）错位。做法：记住当前音乐位置
         （预备拍到第几拍 / 正式拍已完成多少格），换算到新 BPM 的时间轴上。 */
      if(this.phase==='playing'||this.phase==='countin'){
        const wasPhase=this.phase;
        const oldQuarter=60/this.bpm, oldStep=this.stepDur();
        const elapsed=Math.max(0,this.ac.currentTime-this.startTime);
        let anchor;
        if(wasPhase==='countin'){
          const ci=Math.floor(elapsed/oldQuarter);          // 预备拍已数到第几拍
          this.bpm=nb; this._teardown();
          anchor=ci*(60/nb);
        }else{
          const ciDur=this.countIn?this.pattern.beats*oldQuarter:0;
          const k=Math.max(0,Math.floor((elapsed-ciDur)/oldStep)); // 已完成格数(跨循环)
          this.bpm=nb; this._teardown();
          anchor=(this.countIn?this.pattern.beats*(60/nb):0)+k*this.stepDur();
        }
        this.phase=wasPhase;
        this.startTime=this.ac.currentTime+0.08-anchor;     // 新时间轴回拨到同一音乐位置
        this._beginSchedule();
        this._loopRaf();
      }else{
        this.bpm=nb;
      }
      Transport.setBpm(this.bpm);   // R-TONE-01：与统一时间轴保持同速
      range.value=this.bpm; num.value=this.bpm;
      range.style.setProperty('--fill',(this.bpm-40)/140*100+'%');
      this.renderStats();
    };
    range.addEventListener('input',()=>setBpm(+range.value));
    num.addEventListener('change',()=>setBpm(+num.value||60));
    $('#rtBpmMinus').onclick=()=>setBpm(this.bpm-1);
    $('#rtBpmPlus').onclick=()=>setBpm(this.bpm+1);
    $('#rtBpmMinus5').onclick=()=>setBpm(this.bpm-5);
    $('#rtBpmPlus5').onclick=()=>setBpm(this.bpm+5);
    this.setBpm=setBpm;
    /* RT-012：Transport 初值 90、本模块 bpm 初值 60，init 时先校准统一时间轴，
       否则用户首次直接播放（未拖动 BPM）时预备拍按 60、正式格按 90 调度，整体偏快。 */
    Transport.setBpm(this.bpm);

    /* 循环次数 chips */
    const loops=[['1',1],['2',2],['4',4],['8',8],['∞',0]];
    $('#rtLoopChips').innerHTML=loops.map(([t,v],i)=>
      `<button class="preset-chip${v===4?' on':''}" data-v="${v}">${t}</button>`).join('');
    $$('#rtLoopChips .preset-chip').forEach(c=>c.onclick=()=>{
      this.loops=+c.dataset.v;
      $$('#rtLoopChips .preset-chip').forEach(x=>x.classList.toggle('on',x===c));
    });
    this.loops=4;

    /* 预备拍开关 */
    $$('#rtCountInChips .preset-chip').forEach(c=>c.onclick=()=>{
      this.countIn=c.dataset.ci==='1';
      $$('#rtCountInChips .preset-chip').forEach(x=>x.classList.toggle('on',x===c));
    });

    /* 分解模式：和弦根音映射（需求 4.2.6） */
    const chords=['通用','C','G','D','E','Am'];
    $('#rtChordChips').innerHTML=chords.map((c,i)=>
      `<button class="preset-chip${c===this.chord?' on':''}" data-c="${c}">${c}</button>`).join('');
    $$('#rtChordChips .preset-chip').forEach(c=>c.onclick=()=>{
      this.chord=c.dataset.c;
      $$('#rtChordChips .preset-chip').forEach(x=>x.classList.toggle('on',x===c));
      this.renderGrid();   // 根音/低音标签随和弦刷新
      this.renderInfo();
    });

    /* 音量 */
    $('#rtDemoVol').addEventListener('input',e=>{
      this.demoVol=+e.target.value/100;
      if(this.demoGain) this.demoGain.gain.value=this.demoVol;
    });
    $('#rtMetroVol').addEventListener('input',e=>{
      this.metroVol=+e.target.value/100;
      if(this.metroGain) this.metroGain.gain.value=this.metroVol;
    });

    /* 走带控制 */
    $('#rtPlay').onclick=()=>this.togglePlay();
    $('#rtStop').onclick=()=>this.stop(true);
    $('#rtRestart').onclick=()=>{ this.stop(false); this.start(); };

    /* 统计 */
    $('#rtClearStats').onclick=()=>{
      if(!confirm('确定清除全部节奏练习记录吗？此操作不可恢复。')) return;
      try{ localStorage.removeItem('gs_rhythm_v1'); }catch(_){}
      this.renderStats(); $('#rtLastSession').textContent=''; toast('练习记录已清除','ok');
    };

    /* 首次访问自动展开说明 */
    try{
      if(!localStorage.getItem('gs_rhythm_seen')){ $('#rtHelp').open=true; localStorage.setItem('gs_rhythm_seen','1'); }
    }catch(_){}

    /* 后台自动暂停（需求 6.5） */
    this._vis=()=>{
      if(document.hidden && (this.phase==='playing'||this.phase==='countin')) this.pause();
    };
    document.addEventListener('visibilitychange',this._vis);

    this.renderPatterns(); this.renderGrid(); this.renderInfo(); this.renderStats();
  },

  /* ---------- 渲染：预设 chips + 信息 ---------- */
  renderPatterns(){
    const list=this.cat==='strum'?RhythmData.STRUM_PATTERNS:RhythmData.PICK_PATTERNS;
    $('#rtChips').innerHTML=list.map((p,i)=>
      `<button class="preset-chip${p===this.pattern?' on':''}" data-i="${i}">${p.name}</button>`).join('');
    $$('#rtChips .preset-chip').forEach(c=>c.onclick=()=>{
      if(this.phase!=='idle') this.stop(false);
      this.pattern=list[+c.dataset.i];
      this.renderPatterns(); this.renderGrid(); this.renderInfo();
    });
  },

  renderInfo(){
    const p=this.pattern, RD=RhythmData;
    const chordLine=this.cat==='pick'
      ? `<div class="rt-meta">当前和弦：<b style="color:var(--mint)">${this.chord}</b>${this.chord==='通用'?'（通用弦序：根=5弦、B=6弦）':`（根音 ${RD.ROOT_MAP[this.chord].s} 弦${RD.ROOT_MAP[this.chord].fret?' '+RD.ROOT_MAP[this.chord].fret+' 品':'空弦'} · 低音 ${RD.ROOT_MAP[this.chord].altS} 弦）`}</div>`
      : '';
    const subLabel=(p)=>{ // 细分标签按「每拍时值 × 步数」换算，不能只看 subdivision
      if(p.subdivision===3) return '三连音';
      return {2:'二分音符',4:'四分音符',8:'八分音符',16:'十六分音符'}[p.beatUnit*Math.pow(2,p.subdivision-1)]||'自定义';
    };
    $('#rtInfo').innerHTML=
      `<h4>${p.name} <span class="rt-stars">${'★'.repeat(p.difficulty)}${'☆'.repeat(3-p.difficulty)}</span></h4>
       <div class="rt-meta">拍号 ${RD.timeSigText(p)} · 细分 ${subLabel(p)} · 建议 ${p.bpm} BPM 起 · 格数 ${p.actions.length}</div>
       ${chordLine}
       <p>${p.desc}</p>
       <ul class="rt-tips">${p.tips.map(t=>`<li>${t}</li>`).join('')}</ul>`;
  },

  /* ---------- 渲染：拍指示点 + 动作网格 ---------- */
  renderGrid(){
    const p=this.pattern;
    /* 拍点 */
    $('#rtDots').innerHTML=Array.from({length:p.beats},(_,i)=>
      `<span class="beat-dot" data-i="${i}">${i+1}</span>`).join('');
    /* 网格：按拍分组，beat-head 标记每拍第一格 */
    const cells=this.cat==='strum'
      ? p.actions.map(a=>RhythmData.resolveAction(p,a))
      : p.actions.map(a=>RhythmData.resolveAction(p,a,this.chord));
    let html='';
    cells.forEach((c,i)=>{
      const cls=['rt-cell',c.kind, i%p.subdivision===0?'beat-head':''].join(' ');
      html+=`<div class="${cls}" data-i="${i}"><span class="lab">${c.label}</span><span class="cap">${c.sub||''}</span></div>`;
    });
    $('#rtGrid').innerHTML=html;
    this.lastUiStep=-99;
  },

  /* ---------- 音频 ---------- */
  ensureAudio(){
    const ctx=AudioEngine.ensure();   // 复用全局引擎（用户手势内 resume）
    if(!this.demoGain){
      this.demoGain=ctx.createGain(); this.demoGain.gain.value=this.demoVol;
      this.demoGain.connect(AudioEngine.master);
      this.metroGain=ctx.createGain(); this.metroGain.gain.value=this.metroVol;
      this.metroGain.connect(AudioEngine.master);
    }
    this.ac=ctx;
    return ctx;
  },
  clickAt(when,accent){        // 节拍器 click → metroGain
    const ctx=this.ac, t0=when;
    const o=ctx.createOscillator(),f=ctx.createBiquadFilter(),g=ctx.createGain();
    o.type='square'; o.frequency.value=accent?1600:1050;
    f.type='lowpass'; f.frequency.value=2400;
    g.gain.setValueAtTime(accent?.42*.9:.28*.9,t0);
    g.gain.exponentialRampToValueAtTime(.0001,t0+.055);
    o.connect(f);f.connect(g);g.connect(this.metroGain);
    o.start(t0);o.stop(t0+.07);
  },
  softTick(when){              // 细分轻击
    const ctx=this.ac,t0=when,o=ctx.createOscillator(),g=ctx.createGain();
    o.type='square';o.frequency.value=800;
    g.gain.setValueAtTime(.06,t0);
    g.gain.exponentialRampToValueAtTime(.0001,t0+.035);
    o.connect(g);g.connect(this.metroGain);
    o.start(t0);o.stop(t0+.05);
  },
  demoAt(when,kind,midi){      // 示范音 → demoGain
    const ctx=this.ac,t0=when;
    if(kind==='pick'){ this._pluck(midi,when); return; }
    const o=ctx.createOscillator(),g=ctx.createGain(),f=ctx.createBiquadFilter();
    const cfg={
      down:{type:'sawtooth',freq:180,dur:.16,vol:.5,lp:900},
      up:  {type:'sawtooth',freq:330,dur:.14,vol:.42,lp:1500},
      mute:{type:'square',  freq:110,dur:.06,vol:.3, lp:500}
    }[kind];
    if(!cfg) return;
    o.type=cfg.type;o.frequency.setValueAtTime(cfg.freq,t0);
    if(kind==='down') o.frequency.exponentialRampToValueAtTime(cfg.freq*.6,t0+cfg.dur);
    if(kind==='up')   o.frequency.exponentialRampToValueAtTime(cfg.freq*1.4,t0+cfg.dur);
    f.type='lowpass';f.frequency.value=cfg.lp;
    g.gain.setValueAtTime(cfg.vol,t0);
    g.gain.exponentialRampToValueAtTime(.0001,t0+cfg.dur);
    o.connect(f);f.connect(g);g.connect(this.demoGain);
    o.start(t0);o.stop(t0+cfg.dur+.02);
  },
  _pluck(midi,when){           // 轻量拨弦（与 AudioEngine.pluck 同风格）
    const ctx=this.ac,t0=when,g=ctx.createGain();
    g.connect(this.demoGain);
    const freq=freqFromMidi(midi);
    [{type:'triangle',ratio:1,gain:1,decay:1},{type:'sine',ratio:2,gain:.3,decay:.5},
     {type:'sine',ratio:3,gain:.14,decay:.3}].forEach(p=>{
      const o=ctx.createOscillator(),pg=ctx.createGain();
      o.type=p.type;o.frequency.value=freq*p.ratio;pg.gain.value=p.gain;
      o.connect(pg);pg.connect(g);
      o.start(t0);o.stop(t0+1.2*p.decay+.05);
      pg.gain.setValueAtTime(.001,t0);
      pg.gain.exponentialRampToValueAtTime(.32*p.gain,t0+.012);
      pg.gain.exponentialRampToValueAtTime(.0001,t0+1.2*p.decay);
    });
  },

  /* ---------- 时间轴数学 ---------- */
  stepDur(){ /* R-TONE-02：时长来自统一时间轴（Transport.bpm 已与本模块同步） */
    return Transport.beatDuration()/this.pattern.subdivision; },
  barDur(){ return this.stepDur()*this.pattern.actions.length; },
  countInDur(){ return this.countIn?this.pattern.beats*(60/this.bpm):0; },

  /* ---------- 走带 ---------- */
  togglePlay(){
    if(this.phase==='idle') this.start();
    else if(this.phase==='playing'||this.phase==='countin') this.pause();
    else if(this.phase==='paused') this.resume();
  },
  start(){
    if(this.phase!=='idle') return;   // RT-006：防重复实例（快速连点不叠加调度器）
    try{ this.ensureAudio(); }catch(err){ toast('音频初始化失败：'+err.message,'err'); return; }
    /* RT-011：resume() 是异步的——ctx.state 可能仍是 suspended。
       绝不能同步判死卡住，也不该硬要求用户点两次：
       挂起时先提示，等 statechange 到 running 后自动起播。 */
    if(this.ac.state!=='running'){
      toast('正在等待浏览器放行音频…');
      this._setPlayIcon('pause');
      this._waitAudioRunning(()=>this._beginPlayback());
      return;
    }
    this._beginPlayback();
  },
  /* 等待 AudioContext 真正 running 后执行回调；期间用户可随时停止（令牌失效） */
  _waitAudioRunning(cb){
    const token=this._waitToken=(this._waitToken||0)+1;
    const done=()=>{
      if(token!==this._waitToken) return;           // 用户已停止/切换，作废
      if(this.phase!=='idle'&&this.phase!=='paused') return;
      if(this.ac.state!=='running') return;
      this.ac.onstatechange=null;
      cb();
    };
    this.ac.onstatechange=done;
    this.ac.resume().then(()=>setTimeout(done,60)).catch(()=>{ if(token===this._waitToken) toast('音频被浏览器拦截，请点击页面后再试','err'); });
    /* 兜底：8 秒仍没放行就还原按钮，避免永远转圈 */
    setTimeout(()=>{ if(token!==this._waitToken) return; if(this.ac.state!=='running'){ this.ac.onstatechange=null; this._setPlayIcon('play'); this._status('音频未获授权 · 请点击页面任意处后再按播放'); } },8000);
  },
  _beginPlayback(){
    // RT-012：起播前再次声明本模块 BPM，防止和弦库 playProg 等外部模块改过全局
    // Transport（其默认 80），导致本模块调度速度与界面显示的 BPM 不一致。
    Transport.setBpm(this.bpm);
    this.phase=this.countIn?'countin':'playing';
    this.pausedElapsed=0; this.playedSeconds=0; this.loopDone=0;
    this.lastUiStep=-99;
    this.startTime=this.ac.currentTime+.08;
    this._beginSchedule();
    this._loopRaf();
    this._setPlayIcon('pause');
  },
  pause(){
    if(this.phase!=='playing'&&this.phase!=='countin') return;
    this.pausedElapsed=Math.max(0,this.ac.currentTime-this.startTime);
    this._teardown();                       // 停调度器与 RAF，保留进度
    this.phase='paused';
    this._setPlayIcon('play');
    this._status(`已暂停 · 第 ${this.loopDone||1} 遍 · 按 ▶ 从原格继续`);
  },
  resume(){
    if(this.phase!=='paused') return;
    try{ this.ensureAudio(); }catch(err){ toast('音频恢复失败：'+err.message,'err'); return; }
    if(this.ac.state!=='running'){    // RT-011：同 start()，等待放行后续播
      toast('正在等待浏览器放行音频…');
      this._waitAudioRunning(()=>{
        const el=this.pausedElapsed;
        this.startTime=this.ac.currentTime+.1-el;
        this.phase=el<this.countInDur()?'countin':'playing';
        this._beginSchedule(); this._loopRaf(); this._setPlayIcon('pause');
      });
      return;
    }
    const elapsed=this.pausedElapsed;
    this.startTime=this.ac.currentTime+.1-elapsed;   // 时间轴回拨到暂停点
    this.phase = elapsed<this.countInDur()?'countin':'playing';
    this._beginSchedule();
    this._loopRaf();
    this._setPlayIcon('pause');
  },
  /* record=true 时计入练习统计并弹会话小结 */
  stop(record){
    const wasPlaying=this.phase==='playing'||this.phase==='countin';
    // Bug2 修复（与自然结束 P2-13 对齐）：清零 loopDone 之前先快照实际完成的循环数，
    // 否则手动停止时无论设了几遍、已走几遍，统计都恒为 1 遍。
    const finishedLoops=Math.max(1,this.loopDone||1);
    this._waitToken=(this._waitToken||0)+1;   // 作废等待放行的异步回调
    this._teardown();
    this._endAt=null;
    this.phase='idle'; this.loopDone=0; this.pausedElapsed=0;
    this._setPlayIcon('play');
    this._clearCells();
    $$('#rtDots .beat-dot').forEach(d=>d.className='beat-dot');
    if(wasPlaying&&record) this._finishSession(finishedLoops);
    else if(wasPlaying) this.playedSeconds=0;
    this._status(record?this._statusText():'就绪 · 选择节奏型后按开始');
  },
  _teardown(){
    clearInterval(this.timer); this.timer=null;
    cancelAnimationFrame(this.raf); this.raf=null;
  },
  _setPlayIcon(state){
    $('#rtPlay').innerHTML=state==='pause'
      ?'<svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><rect x="6.5" y="5" width="4" height="14" rx="1.4"/><rect x="13.5" y="5" width="4" height="14" rx="1.4"/></svg>'
      :'<svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l11-6.5a1 1 0 0 0 0-1.72l-11-6.5A1 1 0 0 0 8 5.5z"/></svg>';
  },
  _status(t){ $('#rtStatus').innerHTML=t; },
  _statusText(){
    const p=this.pattern;
    return `就绪 · <b>${p.name}</b> · ${this.bpm} BPM · 循环 ${this.loops===0?'∞':this.loops} 遍`;
  },

  /* ---------- lookahead 调度（与节拍器同源方案） ----------
     resume 时把 startTime 回拨到暂停点，本函数按 elapsed 重建调度游标：
     elapsed 处于第 k 格内 → 下一格为 k+1，循环数 = floor((k+1)/总格数)+1 */
  _beginSchedule(){
    const ctx=this.ac, ciDur=this.countInDur();
    const quarter=60/this.bpm, total=this.pattern.actions.length;
    const elapsed=Math.max(0,ctx.currentTime-this.startTime);
    let schedTime, countIdx=0, stepIdx=0, endedAt=null;
    if(this.phase==='countin'){           // 预备拍中（含从预备拍恢复）
      countIdx=Math.floor(elapsed/quarter);
      schedTime=this.startTime+(countIdx+1)*quarter;
      this.loopDone=0;
    }else{                                // 正式拍中：下一格 = k+1
      const k=Math.floor((elapsed-ciDur)/this.stepDur());
      stepIdx=(k+1)%total;
      this.loopDone=Math.floor((k+1)/total)+1;
      schedTime=this.startTime+ciDur+(k+1)*this.stepDur();
    }
    let loopDone=this.loopDone;
    const beats=this.pattern.beats;
    this.timer=setInterval(()=>{
      if(this.phase!=='playing'&&this.phase!=='countin') return;
      while(schedTime<ctx.currentTime+0.14){
        if(this.phase==='countin'){                 // —— 预备拍：只打拍点
          this.clickAt(schedTime,countIdx%beats===0);
          countIdx++;
          if(countIdx>=beats){
            this.phase='playing';
            schedTime=this.startTime+ciDur;         // 正式拍从格 0 起
            stepIdx=0; loopDone=0;
          }else schedTime+=quarter;
        }else if(stepIdx<this.pattern.actions.length){   // —— 正式格
          const sub=this.pattern.subdivision;
          if(stepIdx%sub===0){                      // 拍头：强/次强弱拍点
            const bi=Math.floor(stepIdx/sub);
            this.clickAt(schedTime,bi===0);
            if(isSubAccent(beats,bi)) this.clickAt(schedTime+.001,false);
          }else this.softTick(schedTime);           // 细分轻击
          const act=this.pattern.actions[stepIdx];
          if(act!=='-'){
            if(this.cat==='strum'){
              this.demoAt(schedTime,act==='D'?'down':(act==='U'?'up':'mute'));
            }else{
              const rm=RhythmData.rootMidi(this.chord,AudioCore.OPEN_MIDI);
              if(act==='R') this._pluck(rm.root,schedTime);
              else if(act==='B') this._pluck(rm.alt,schedTime);
              else{
                const res=RhythmData.resolveAction(this.pattern,act,this.chord);
                if(res.string!=null) this._pluck(AudioCore.OPEN_MIDI[6-res.string],schedTime);
              }
            }
          }
          stepIdx++;
          if(stepIdx>=total){                       // —— 循环边界
            loopDone++;
            this.loopDone=loopDone;
            if(this.loops>0&&loopDone>=this.loops){ // 循环计数完成
              endedAt=schedTime;
              break;
            }
            stepIdx=0;
          }
          schedTime+=this.stepDur();
        }else break;
      }
      if(endedAt!=null){
        clearInterval(this.timer); this.timer=null;
        this._endAt=endedAt;                        // RAF 检测到点后收尾
      }
    },25);
  },

  /* ---------- RAF：UI 高亮（状态无 Side Effect，纯按时间推导） ---------- */
  _loopRaf(){
    const ctx=this.ac, ciDur=this.countInDur(), quarter=60/this.bpm;
    const total=this.pattern.actions.length, sub=this.pattern.subdivision, beats=this.pattern.beats;
    const loop=()=>{
      if(this.phase!=='playing'&&this.phase!=='countin') return;
      const elapsed=ctx.currentTime-this.startTime;
      if(this._endAt!=null&&ctx.currentTime>=this._endAt){ this._finish(); return; }
      /* 拍点闪烁 */
      const dotEls=$$('#rtDots .beat-dot');
      if(this.phase==='countin'){
        const ci=Math.min(beats-1,Math.floor(elapsed/quarter));
        $('#rtStatus').innerHTML=`<span class="rt-countin">预备 ${ci+1} / ${beats}</span>`;
        dotEls.forEach((d,i)=>d.className='beat-dot'+(i===ci?' flash-strong':''));
      }else{
        const rel=elapsed-ciDur;
        if(rel>=0){
          const absStep=Math.floor(rel/this.stepDur());
          const idx=absStep%total;
          this.loopDone=Math.floor(absStep/total)+1;
          const bi=Math.floor(idx/sub);
          const loopTxt=this.loops===0?`${this.loopDone} / ∞`:`${Math.min(this.loopDone,this.loops)} / ${this.loops}`;
          $('#rtStatus').innerHTML=`<b>${esc(this.pattern.name)}</b> · ${this.bpm} BPM · 循环 <b>${esc(loopTxt)}</b>`;
          dotEls.forEach((d,i)=>d.className='beat-dot'+(i===bi?(i===0?' flash-strong':(isSubAccent(beats,i)?' flash-sub':' flash-weak')):''));
          if(idx!==this.lastUiStep){                 // 高亮：当前 / 已奏变暗 / 下一格虚框
            this.lastUiStep=idx;
            const cells=$$('#rtGrid .rt-cell');
            cells.forEach((c,i)=>{
              c.classList.toggle('cur',i===idx);
              c.classList.toggle('done',i<idx);
              c.classList.toggle('next',i===(idx+1)%total);
            });
          }
          this.playedSeconds=Math.max(this.playedSeconds,rel); // 不含预备拍
        }
      }
      this.raf=requestAnimationFrame(loop);
    };
    this.raf=requestAnimationFrame(loop);
  },
  _clearCells(){
    $$('#rtGrid .rt-cell').forEach(c=>c.classList.remove('cur','done','next'));
    this.lastUiStep=-99;
  },
  /* 循环自然结束：与手动停止共用统计与清理 */
  _finish(){
    this._teardown();
    this._endAt=null;
    // P2-13 修复：自然结束时实际完成的循环数（_finishSession 内会读 this.loopDone，
    // 若先归零再统计，无论设了几遍循环都只记 1 遍），归零前取出传入。
    const finishedLoops=Math.max(1,this.loopDone||1);
    this.phase='idle'; this.loopDone=0; this.pausedElapsed=0;
    this._setPlayIcon('play'); this._clearCells();
    $$('#rtDots .beat-dot').forEach(d=>d.className='beat-dot');
    this._finishSession(finishedLoops);
    this._status('本轮完成 · 可调整 BPM 再来，或换个节奏型挑战');
  },

  /* ---------- 练习统计（localStorage，异常静默降级） ---------- */
  _loadStats(){
    try{ return JSON.parse(localStorage.getItem('gs_rhythm_v1'))||null; }catch(_){ return null; }
  },
  _finishSession(loopsArg){
    const sec=Math.round(this.playedSeconds);
    // P2-13：自然结束由 _finish 传入真实循环数；手动停止则按当前 this.loopDone 兜底
    const loops=Math.max(1,loopsArg||this.loopDone||1);
    const prev=this._loadStats()||{t:{sec:0,loops:0,count:0},maxBpm:0,last:[]};
    if(sec>=5){
      prev.t.sec+=sec; prev.t.loops+=loops; prev.t.count++;
      prev.maxBpm=Math.max(prev.maxBpm||0,this.bpm);
      prev.last.unshift({d:new Date().toLocaleString('zh-CN',{hour12:false}).slice(5,16),
                         n:this.pattern.name,b:this.bpm,l:loops,s:sec});
      prev.last=prev.last.slice(0,20);
      try{ localStorage.setItem('gs_rhythm_v1',JSON.stringify(prev)); }catch(_){}
      const m=Math.floor(sec/60),s=sec%60;
      $('#rtLastSession').textContent=
        `上次会话：${this.pattern.name} · ${this.bpm} BPM · ${loops} 遍 · ${m}分${s}秒`;
      toast(`练完了！${this.pattern.name} ×${loops} 遍，坚持住 🎸`,'ok');
    }
    this.playedSeconds=0; this.loopDone=0;
    this.renderStats();
  },
  renderStats(){
    const st=this._loadStats();
    const t=st?st.t:{sec:0,loops:0,count:0};
    const m=Math.floor(t.sec/60),s=t.sec%60;
    const fmt=t.sec>=60?`${m} 分 ${s} 秒`:`${t.sec} 秒`;
    $('#rtStats').innerHTML=
      `<div class="rt-stat"><b>${fmt}</b><span>累计练习</span></div>
       <div class="rt-stat"><b>${t.loops}</b><span>完成循环</span></div>
       <div class="rt-stat"><b>${this.bpm}</b><span>当前 BPM</span></div>
       <div class="rt-stat"><b>${st?st.maxBpm:0}</b><span>历史最高 BPM</span></div>
       <div class="rt-stat"><b>${t.count}</b><span>练习次数</span></div>`;
  }
};

onRouteEnter.rhythm=()=>Rhythm.init();

/* 直链/刷新直接落在节奏页时，applyRoute 已在本文件加载前执行完毕
   （onRouteEnter.rhythm 当时还未注册），此处补一次初始化。
   init() 内有 inited 守卫，重复调用安全。 */
if((location.hash.replace('#/','')||'home').split('?')[0]==='rhythm') Rhythm.init();

window.Rhythm = Rhythm;
export { Rhythm };
