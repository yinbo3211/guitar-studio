/* ============================================================
   六弦工坊 V3 · 模块 3：和弦库
   （M3 目录重构：由 V2 app-*.js 拆分，代码体保持不变）
   ============================================================ */
'use strict';

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

window.ChordLib = ChordLib;
export { ChordLib };
