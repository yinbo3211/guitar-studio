/* ============================================================
   六弦工坊 V3 · 模块 7：音阶跟弹
   （M3 目录重构：由 V2 app-*.js 拆分，代码体保持不变）
   ============================================================ */
'use strict';

/* V4.3.1 收尾：用户可见文案统一走宿主词条（无宿主 / Node 单测回退 key） */
const T = k => { try { if(typeof window!=='undefined' && typeof window.t==='function') return window.t(k); } catch(e){} return k; };
const TF = (k,p) => { try { if(typeof window!=='undefined' && window.gsI18n && typeof window.gsI18n.tF==='function') return window.gsI18n.tF(k,p); } catch(e){} let s=T(k); for(const a of Object.keys(p||{})) s=s.split('{'+a+'}').join(String(p[a])); return s; };

const { clamp, midiFromFreq, freqFromMidi, NOTE_NAMES, NOTE_CN, noteName, noteNameNoOct, makeSmoother, PitchDetect, OPEN_MIDI, tapBpm, isSubAccent, quantizeToOctave, matchFretTarget, isPitchMatch, centsBetween, pcFromName } = AudioCore;   // V3 M3：模块级解构（原 app 文件共享作用域）

const Scale = {
  sel:0, mode:'idle', seq:[], cells:[], fMin:0, fMax:4, rootPc:0,
  i:0, combo:0, ok:0, bestCombo:0, followStartedAt:0, followReported:false,
  mic:false, timer:null, cand:null, candN:0, cooldown:0, bpm:80,
  init(){
    if(this.inited) return; this.inited=true;
    this.renderList();
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
      `<span class="scx-nt-label">${TF('scx.scaleName',{root:sel.root,type:T(t.nk)})} · </span>`+
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
        html+=this.dot(openCell)+`<small class="fnum-s" data-n="${6-s}">${TF('scx.stringN',{n:6-s})}</small>`;
      }else{
        html+=`<span class="str-lbl">${noteNameNoOct(OPEN_MIDI[s])}<small data-n="${6-s}">${TF('scx.stringN',{n:6-s})}</small></span>`;
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
    this._txt('#scxCur','scale.ready');
    $('#scxPos').textContent='';
    $('#scxProg').textContent='';
    $('#scxCombo').textContent='';
    this._txt('#scxTip','scale.tip');
    this.updateButtons();
  },
  posText(c){ return TF('scx.posText',{s:6-c.s,f:c.f===0?T('rhythm.open'):TF('scx.fretN',{n:c.f})}); },
  /* ---- 跟听示范（BPM 逐音，上行再下行） ---- */
  startListen(){
    // Fix-6: 空序列保护——该音阶/把位在指板上无可用音符时直接提示并返回
    if(!this.seq||!this.seq.length){ toast(T('scx.empty'),'warn'); return; }
    AudioEngine.ensure();
    this.stopFollow();
    this.mode='listen';
    this.i=0; this.clearAll();
    this._txt('#scxTip','scx.tip.listen');
    this.updateButtons();
    this.listenStep();
  },
  listenStep(){
    if(this.mode!=='listen') return;
    if(this.i>=this.seq.length){ this.finishListen(); return; }
    const c=this.seq[this.i];
    AudioEngine.pluck(freqFromMidi(c.midi),0,1.7,.3);
    this.markNow(c);
    this._raw('#scxCur',noteNameNoOct(c.midi));
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
    this._txt('#scxCur','scx.done');
    $('#scxPos').textContent='';
    this._txt('#scxTip','scx.tip.afterListen');
    this.updateButtons();
  },
  /* ---- 麦克风逐音跟弹 ---- */
  async startFollow(){
    // Fix-6: 空序列保护——该音阶/把位在指板上无可用音符时直接提示并返回
    if(!this.seq||!this.seq.length){ toast(T('scx.empty'),'warn'); return; }
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
    // BUG-02：跟弹开始时记录起点并复位上报标志，一轮只计一次
    this.followStartedAt=Date.now(); this.followReported=false;
    this.clearAll();
    this._txt('#scxTip','scx.tip.follow');
    $('#scxCombo').textContent='0';
    this.updateButtons();
    this.showTarget();
  },
  showTarget(){
    const c=this.seq[this.i];
    this._raw('#scxCur',noteNameNoOct(c.midi));
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
    // P2-9 修复：保存 320ms 句柄，stopAll/换音阶时清除，否则会在新指板上
    // 对旧 seq[i] 调 showTarget，污染当前音文案与高亮。
    this.showTimer=setTimeout(()=>{
      this.showTimer=null;
      if(this.mode==='follow' && this.i<this.seq.length) this.showTarget();
    }, 320);
  },
  finishFollow(){
    this.mode='idle';
    this.stopMic();
    this.clearNow();
    this._txt('#scxCur','scx.finish');
    this._txt('#scxPos','scx.hitN',{n:this.ok});
    this._txt('#scxTip','scx.tip.finish',{n:this.bestCombo});
    this.updateButtons();
    toast(TF('scx.toast.finish',{n:this.bestCombo}),'ok');
    /* BUG-02 修复：完整弹完一条音阶后上报练习会话。旧实现只弹 toast，
       从不写入 PracticeStore，每日计划「音阶练习」任务的进度恒为 0，
       永远无法完成（计划无法达到 100%）。 */
    this.reportScale();
  },
  /* BUG-02：音阶完成 -> 计入 F1 练习数据层。
     accuracy=弹对音数/序列长度（advance 中每弹对一音 ok++，正常自然结束时
     ok 应等于 seq 长度；兼容中途漏判）。followReported 保证一轮只上报一次。 */
  reportScale(){
    if(!this.followReported && typeof PracticeStore!=='undefined'){
      this.followReported=true;
      const now=Date.now();
      const startedAt=this.followStartedAt||now;
      this.followStartedAt=now;
      const total=this.seq?this.seq.length:0;
      const sel=this.cur(), t=SCALE_TYPES[sel.type];
      PracticeStore.addSession({
        module:'scale',
        startedAt,
        durationMs:Math.max(0, now-startedAt),
        accuracy:this.seq.length ? this.ok/this.seq.length : null,
        meta:{ name:sel.root+' '+(t?t.name:sel.type), scale:(sel.root+' '+sel.type),
               bpm:this.bpm, notes:total, hit:this.ok, bestCombo:this.bestCombo }
      });
    }
  },
  stopFollow(){
    if(this.mode==='follow'){ this.stopMic(); }
    this.mode='idle';
    this.updateButtons();
  },
  stopMic(){ if(this.mic){ Mic.stop(); this.mic=false; } },
  stopAll(){
    clearTimeout(this.timer);
    clearTimeout(this.showTimer);   // P2-9：取消待执行的下一目标高亮
    this.showTimer=null;
    this.stopMic();
    this.mode='idle';
  },
  updateButtons(){
    const lb=$('#scxListen'), fb=$('#scxFollow');
    if(!lb||!fb) return;
    lb.textContent=this.mode==='listen'?T('scx.btn.stopListen'):T('scale.listen');
    lb.classList.toggle('btn-danger',this.mode==='listen');
    fb.textContent=this.mode==='follow'?T('scx.btn.stopFollow'):T('scale.follow');
    fb.classList.toggle('btn-danger',this.mode==='follow');
    fb.classList.toggle('btn-primary',this.mode!=='follow');
  },
  /* V4.3.1：文本节点记录「取词来源」，语言切换时按当前语言重放，
     不重建指板/不清连击，保住 now/done 高亮与选中把位。 */
  _txt(sel,key,pairs){
    this._langText=this._langText||{};
    this._langText[sel]={key,pairs:pairs||null};
    $(sel).textContent=pairs?TF(key,pairs):T(key);
  },
  _raw(sel,val){
    this._langText=this._langText||{};
    this._langText[sel]=null;
    $(sel).textContent=val;
  },
  renderList(){
    $('#scxList').innerHTML=SCALE_LIST.map((s,idx)=>{
      const t=SCALE_TYPES[s.type];
      const posName=s.pos===0?T('scx.pos.open'):TF('scx.pos.n',{n:s.pos});
      return `<button class="scx-pick ${idx===this.sel?'on':''}" data-i="${idx}">
        <b>${TF('scx.scaleName',{root:s.root,type:T(t.nk)})}</b><span>${posName}</span></button>`;
    }).join('');
  },
  refreshLang(){
    if(!this.inited) return;
    this.renderList();
    $$('#scxBoard .fnum-s,#scxBoard .str-lbl small').forEach(e=>{
      if(e.dataset.n!=null) e.textContent=TF('scx.stringN',{n:e.dataset.n});
    });
    this.updateButtons();
    const lt=this._langText||{};
    for(const sel of Object.keys(lt)){
      const rec=lt[sel]; if(!rec) continue;
      $(sel).textContent=rec.pairs?TF(rec.key,rec.pairs):T(rec.key);
    }
    /* 跟听/跟弹中的品位提示按当前语言重算（下一帧 listenStep 也会刷新） */
    if(this.mode!=='idle'&&this.seq&&this.seq[this.i]){
      const pos=$('#scxPos');
      if(pos && !(lt['#scxPos']&&lt['#scxPos'].key==='scx.hitN')) pos.textContent=this.posText(this.seq[this.i]);
    }
  }
};
if(typeof document!=='undefined' && document.addEventListener){
  document.addEventListener('gs:lang',()=>Scale.refreshLang());
}
onRouteEnter.scale=()=>Scale.init();

window.Scale = Scale;
export { Scale };
