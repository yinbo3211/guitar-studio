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

/* ============================================================
   模块 3：和弦库（数据 + 指法图 + 扫弦 + 进行伴奏）
   ============================================================ */
const CHORDS={
  major:[
    {name:'C', cat:'major', frets:[-1,3,2,0,1,0], notes:['C','E','G']},
    {name:'D', cat:'major', frets:[-1,-1,0,2,3,2], notes:['D','F#','A']},
    {name:'E', cat:'major', frets:[0,2,2,1,0,0], notes:['E','G#','B']},
    {name:'F', cat:'major', frets:[1,3,3,2,1,1], barre:{fret:1,from:6,to:1}, notes:['F','A','C']},
    {name:'G', cat:'major', frets:[3,2,0,0,0,3], notes:['G','B','D']},
    {name:'A', cat:'major', frets:[-1,0,2,2,2,0], notes:['A','C#','E']},
    {name:'B', cat:'major', frets:[-1,2,4,4,4,2], barre:{fret:2,from:5,to:1}, notes:['B','D#','F#']}
  ],
  minor:[
    {name:'Am', cat:'minor', frets:[-1,0,2,2,1,0], notes:['A','C','E']},
    {name:'Em', cat:'minor', frets:[0,2,2,0,0,0], notes:['E','G','B']},
    {name:'Dm', cat:'minor', frets:[-1,-1,0,2,3,1], notes:['D','F','A']},
    {name:'Bm', cat:'minor', frets:[-1,2,4,4,3,2], barre:{fret:2,from:5,to:1}, notes:['B','D','F#']},
    {name:'F#m', cat:'minor', frets:[2,4,4,2,2,2], barre:{fret:2,from:6,to:1}, notes:['F#','A','C#']}
  ],
  seven:[
    {name:'G7', cat:'seven', frets:[3,2,0,0,0,1], notes:['G','B','D','F']},
    {name:'C7', cat:'seven', frets:[-1,3,2,3,1,0], notes:['C','E','G','Bb']},
    {name:'A7', cat:'seven', frets:[-1,0,2,0,2,0], notes:['A','C#','E','G']},
    {name:'E7', cat:'seven', frets:[0,2,0,1,0,0], notes:['E','G#','B','D']},
    {name:'D7', cat:'seven', frets:[-1,-1,0,2,1,2], notes:['D','F#','A','C']}
  ],
  sus:[
    {name:'Dsus2', cat:'sus', frets:[-1,-1,0,2,3,0], notes:['D','E','A']},
    {name:'Dsus4', cat:'sus', frets:[-1,-1,0,2,3,3], notes:['D','G','A']},
    {name:'Asus2', cat:'sus', frets:[-1,0,2,2,0,0], notes:['A','B','E']},
    {name:'Asus4', cat:'sus', frets:[-1,0,2,2,3,0], notes:['A','D','E']},
    {name:'Esus4', cat:'sus', frets:[0,2,2,2,0,0], notes:['E','A','B']}
  ]
};
const CHORD_MAP={};
Object.values(CHORDS).flat().forEach(c=>CHORD_MAP[c.name]=c);
const PROGRESSIONS=[
  {name:'流行万能 1564', chords:['C','G','Am','F'], desc:'大量华语流行歌的和声骨架'},
  {name:'卡农进行', chords:['C','G','Am','Em','F','C','F','G'], desc:'帕赫贝尔卡农，温暖绵长'},
  {name:'1645 经典', chords:['C','Am','F','G'], desc:'五十年代至今最常见的进行'},
  {name:'4536251', chords:['F','G','Em','Am','Dm','G','C'], desc:'抒情流行高频出现'},
  {name:'6415 抒情', chords:['Am','F','C','G'], desc:'安静、略带忧伤的色彩'},
  {name:'G-C-D-Em', chords:['G','C','D','Em'], desc:'乡村民谣常用进行'}
];
function chordFreqs(chord){
  return chord.frets.map((f,i)=>f<0?null:freqFromMidi(OPEN_MIDI[i]+f)).filter(Boolean);
}
/* 指法图 SVG：i=0..5 对应 6弦→1弦；左手模式整体镜像 */
function renderDiagram(chord, opts={}){
  const s=opts.big?2:1, lh=opts.leftHand?1:0;
  const W=120*s,H=126*s;
  const X=i=>(24+(lh?5-i:i)*14)*s;
  const nutY=27*s, fretH=23*s;
  const fAt=i=>chord.frets[lh?5-i:i];
  let out=`<svg viewBox="0 0 ${W} ${H}" class="diagram-svg" xmlns="http://www.w3.org/2000/svg">`;
  for(let f=0;f<=4;f++){
    out+=`<line x1="${X(0)}" y1="${nutY+f*fretH}" x2="${X(5)}" y2="${nutY+f*fretH}" stroke="rgba(255,255,255,.28)" stroke-width="${s}"/>`;
  }
  for(let i=0;i<6;i++){
    const muted=fAt(i)===-1;
    out+=`<line x1="${X(i)}" y1="${nutY}" x2="${X(i)}" y2="${nutY+4*fretH}" stroke="${muted?'rgba(255,255,255,.12)':'rgba(255,255,255,.4)'}" stroke-width="${s}"/>`;
  }
  const nutX=Math.min(X(0),X(5))-4*s, nutW=Math.abs(X(5)-X(0))+8*s;
  out+=`<rect x="${nutX}" y="${nutY-5*s}" width="${nutW}" height="${5*s}" rx="${2*s}" fill="rgba(255,255,255,.55)"/>`;
  for(let i=0;i<6;i++){
    const f=fAt(i);
    if(f===-1){
      const cx=X(i),cy=13*s;
      out+=`<g stroke="#ff5d73" stroke-width="${1.6*s}" stroke-linecap="round"><line x1="${cx-4*s}" y1="${cy-4*s}" x2="${cx+4*s}" y2="${cy+4*s}"/><line x1="${cx-4*s}" y1="${cy+4*s}" x2="${cx+4*s}" y2="${cy-4*s}"/></g>`;
    }else if(f===0){
      out+=`<circle cx="${X(i)}" cy="${13*s}" r="${4*s}" fill="none" stroke="rgba(255,255,255,.7)" stroke-width="${1.4*s}"/>`;
    }
  }
  if(chord.barre){
    const b=chord.barre;
    const iFrom=6-b.from, iTo=6-b.to;
    const x1=X(iFrom),x2=X(iTo);
    const y=nutY+(b.fret-1)*fretH+fretH/2;
    out+=`<rect x="${Math.min(x1,x2)-7*s}" y="${y-6*s}" width="${Math.abs(x2-x1)+14*s}" height="${12*s}" rx="${6*s}" fill="url(#dotGrad${s})"/>`;
  }
  for(let i=0;i<6;i++){
    const f=fAt(i);
    if(f>0 && !(chord.barre && chord.barre.fret===f)){
      const cx=X(i), cy=nutY+(f-1)*fretH+fretH/2;
      out+=`<circle cx="${cx}" cy="${cy}" r="${7*s}" fill="url(#dotGrad${s})"/>`;
    }
  }
  out+=`<defs><linearGradient id="dotGrad${s}" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#ffd27a"/><stop offset="1" stop-color="#f59136"/></linearGradient></defs>`;
  for(let f=1;f<=4;f++){
    // P2-14 修复：左手镜像模式下品位数字应放在视觉上最后一根弦的外侧
    // （V1 恒用 X(5)+12*s，左手模式时数字叠进弦区）
    const numX=Math.max(X(0),X(5))+12*s;
    out+=`<text x="${numX}" y="${nutY+fretH*(f-0.5)+3*s}" font-size="${9*s}" fill="rgba(255,255,255,.35)" font-family="JetBrains Mono,monospace">${f}</text>`;
  }
  return out+'</svg>';
}

const ChordLib = {
  cat:'major', sel:null, leftHand:false,
  progTimer:null, progIdx:-1, progPlaying:null,
  init(){
    if(this.inited) return; this.inited=true;
    $('#chordCat').onclick=e=>{
      const b=e.target.closest('button'); if(!b)return;
      $$('#chordCat button').forEach(x=>x.classList.toggle('on',x===b));
      this.cat=b.dataset.cat; this.renderGrid();
    };
    $('#chordGrid').onclick=e=>{
      const card=e.target.closest('.chord-card'); if(!card)return;
      this.select(CHORD_MAP[card.dataset.name]);
    };
    const pb=$('#progBpm');
    pb.style.setProperty('--fill',(80-50)/110*100+'%');
    pb.oninput=()=>{ $('#progBpmVal').textContent=pb.value+' BPM'; pb.style.setProperty('--fill',(pb.value-50)/110*100+'%'); };
    $('#progList').innerHTML=PROGRESSIONS.map((p,i)=>`
      <div class="prog-item" data-i="${i}">
        <div style="flex:1">
          <div class="prog-chords">${p.chords.map(c=>`<b>${c}</b>`).join('')}</div>
          <div class="prog-name">${p.name} · ${p.desc}</div>
        </div>
        <button class="prog-play" data-i="${i}"><svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l11-6.5a1 1 0 0 0 0-1.72l-11-6.5A1 1 0 0 0 8 5.5z"/></svg></button>
      </div>`).join('');
    $('#progList').onclick=e=>{
      const b=e.target.closest('.prog-play'); if(!b)return;
      const i=+b.dataset.i;
      if(this.progPlaying===i){ this.stopProg(); } else { this.playProg(i); }
    };
    this.renderGrid();
    this.select(CHORDS.major[0]);
  },
  renderGrid(){
    $('#chordGrid').innerHTML=CHORDS[this.cat].map(c=>`
      <div class="chord-card ${this.sel&&this.sel.name===c.name?'sel':''}" data-name="${c.name}">
        ${renderDiagram(c,{leftHand:this.leftHand})}
        <h4>${c.name}</h4>
        <p>${c.notes.join(' · ')}</p>
      </div>`).join('');
  },
  redrawDetail(c){
    $$('.chord-card').forEach(x=>x.classList.toggle('sel',x.dataset.name===c.name));
    $('#chordDetail').querySelector('.big-diagram').innerHTML=renderDiagram(c,{big:true,leftHand:this.leftHand});
  },
  select(c){
    this.sel=c;
    AudioEngine.ensure();
    AudioEngine.strum(chordFreqs(c),'down',.3);
    this.renderGrid();
    $('#chordDetail').innerHTML=`
      <div class="big-diagram">${renderDiagram(c,{big:true,leftHand:this.leftHand})}</div>
      <div class="chord-meta">
        <h3>${c.name} 和弦</h3>
        <div class="notes">${c.notes.map(n=>`<span class="note-chip">${n}</span>`).join('')}</div>
        <p class="hint">数字代表按弦品位，“○”为空弦音，“×”表示该弦不弹。横按和弦用一根手指同时压住多根弦。</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" id="playStrum"><span style="width:16px;height:16px;display:inline-flex">${SVG_ICONS.play}</span>听扫弦</button>
          <button class="btn btn-sm" id="playArpeggio">听分解</button>
        </div>
        <label class="lh-row" style="margin-top:16px">
          <span class="switch"><input type="checkbox" id="lhSwitch"><span class="track"></span><span class="thumb"></span></span>
          左手琴（反手）指法图
        </label>
      </div>`;
    $('#playStrum').onclick=()=>AudioEngine.strum(chordFreqs(c),'down',.3);
    $('#playArpeggio').onclick=()=>{
      const fs=chordFreqs(c);
      fs.forEach((f,i)=>AudioEngine.pluck(f,i*0.16,1.8,.3));
    };
    $('#lhSwitch').checked=this.leftHand;
    $('#lhSwitch').onchange=e=>{
      this.leftHand=e.target.checked;
      this.renderGrid();
      this.redrawDetail(c);
    };
  },
  playProg(i){
    this.stopProg();
    AudioEngine.ensure();
    this.progPlaying=i;
    const p=PROGRESSIONS[i];
    const bpm=+$('#progBpm').value;
    const bar=60/bpm*4;
    const btn=document.querySelector(`.prog-play[data-i="${i}"]`);
    btn.classList.add('playing');
    btn.innerHTML='<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><rect x="6" y="6" width="12" height="12" rx="2.5"/></svg>';
    document.querySelector(`.prog-item[data-i="${i}"]`).classList.add('playing');
    const ctx=AudioEngine.ctx;
    /* P2-15 修复：V1 每小节用 setTimeout(±抖动) 重新取 currentTime+0.12 起音，
       节拍随播放逐渐漂移、和弦与高亮错位。改为与节拍器相同的 lookahead 方案：
       时间轴锚定在 AudioContext.currentTime，提前把未来 2 小节排进音频时钟
       （精确采样时刻，永不对称轴漂移）；setTimeout 只负责续排与 UI 高亮。 */
    let nextBarTime=ctx.currentTime+0.1;
    let barIdx=0;
    this.progUiTimers=[];
    const highlightBar=(curIdx)=>{
      if(this.progPlaying!==i) return;
      const chips=document.querySelectorAll(`.prog-item[data-i="${i}"] .prog-chords b`);
      chips.forEach((x,k)=>{
        const on=k===curIdx;
        x.style.background=on?'rgba(46,230,168,.25)':'';
        x.style.color=on?'var(--mint)':'';
      });
    };
    const scheduleBar=()=>{
      if(this.progPlaying!==i) return;
      while(nextBarTime < ctx.currentTime + 2*bar){
        const curIdx=barIdx%p.chords.length;
        const c=CHORD_MAP[p.chords[curIdx]];
        const offset=nextBarTime-ctx.currentTime;
        AudioEngine.strum(chordFreqs(c),'down',.26,offset);       // 小节头下扫
        const up=chordFreqs(c).slice().reverse();
        up.forEach((f,k)=>AudioEngine.pluck(f,offset+bar/2+k*0.02,1.2,.13)); // 半小节上琶音
        // UI 高亮与该小节的音频时刻对齐（仅视觉，允许毫秒级误差）
        this.progUiTimers.push(setTimeout(()=>highlightBar(curIdx), Math.max(0,offset*1000)));
        barIdx++;
        nextBarTime+=bar;
      }
      this.progTimer=setTimeout(scheduleBar,1000); // 只负责续排，无累积漂移
    };
    scheduleBar();
  },
  stopProg(){
    // Fix-10: 防御性清理——清空定时器引用，避免快速切换进度时旧定时器对象堆积
    clearTimeout(this.progTimer);
    this.progTimer=null;
    // P2-15：清理 UI 高亮定时器
    if(this.progUiTimers){ this.progUiTimers.forEach(clearTimeout); this.progUiTimers=null; }
    if(this.progPlaying!==null){
      const i=this.progPlaying;
      const btn=document.querySelector(`.prog-play[data-i="${i}"]`);
      if(btn){btn.classList.remove('playing');btn.innerHTML='<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l11-6.5a1 1 0 0 0 0-1.72l-11-6.5A1 1 0 0 0 8 5.5z"/></svg>';}
      const item=document.querySelector(`.prog-item[data-i="${i}"]`);
      if(item){item.classList.remove('playing');item.querySelectorAll('.prog-chords b').forEach(x=>{x.style.background='';x.style.color='';});}
    }
    this.progPlaying=null;
  }
};
onRouteEnter.chords=()=>ChordLib.init();
