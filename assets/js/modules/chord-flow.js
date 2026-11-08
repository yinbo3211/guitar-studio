/* ============================================================
   六弦工坊 V3.1 · 模块：和弦转换训练（F4）
   ------------------------------------------------------------
   按节拍器提示在两个及以上和弦之间切换，屏幕同时显示当前与
   下一个和弦指法图；记录目标速度、停留时长与切换次数，计入 F1。
   V3.1 仅做「节拍引导版」：不接入麦克风识别和弦，也不宣称能
   判断切换动作是否标准。
   ============================================================ */
'use strict';

/* V4.3.1 收尾：用户可见文案统一走宿主词条（无宿主 / Node 单测回退 key） */
const T = k => { try { if(typeof window!=='undefined' && typeof window.t==='function') return window.t(k); } catch(e){} return k; };
const TF = (k,p) => { try { if(typeof window!=='undefined' && window.gsI18n && typeof window.gsI18n.tF==='function') return window.gsI18n.tF(k,p); } catch(e){} let s=T(k); for(const a of Object.keys(p||{})) s=s.split('{'+a+'}').join(String(p[a])); return s; };

const { clamp, freqFromMidi } = AudioCore;

const Flow = {
  seq:['C','G','Am','Em'], bars:2, bpm:80, running:false,
  idx:0, switches:0, timer:null, startedAt:0, beat:0,
  init(){
    if(this.inited) return; this.inited=true;
    const bpmEl = $('#flowBpm');
    if(bpmEl){
      bpmEl.oninput = ()=>{ this.bpm = clamp(+bpmEl.value||80, 30, 300); const v=$('#flowBpmVal'); if(v) v.textContent=this.bpm+' BPM'; };
      this.bpm = clamp(+bpmEl.value||80, 30, 300);
    }
    const barsEl = $('#flowBars');
    if(barsEl){
      barsEl.onclick = e=>{
        const b=e.target.closest('button'); if(!b) return;
        $$('#flowBars button').forEach(x=>x.classList.toggle('on',x===b));
        this.bars = clamp(+b.dataset.bars||2, 1, 8);
      };
      this.bars = +(barsEl.querySelector('button.on')||{dataset:{bars:2}}).dataset.bars || 2;
    }
    const seqEl = $('#flowSeq');
    if(seqEl){
      seqEl.innerHTML = Object.keys(CHORD_MAP).map(name=>
        `<button class="flow-chip ${this.seq.includes(name)?'on':''}" data-name="${name}">${name}</button>`).join('');
      seqEl.onclick = e=>{
        const b=e.target.closest('.flow-chip'); if(!b) return;
        const name=b.dataset.name;
        if(this.seq.includes(name)){
          if(this.seq.length<=2) { toast(T('flow.minChords'),'warn'); return; }
          this.seq = this.seq.filter(x=>x!==name);
        } else this.seq.push(name);
        b.classList.toggle('on', this.seq.includes(name));
      };
    }
    /* 物理机实测：用户希望能一键清空已选和弦 */
    const clear = $('#flowClear');
    if(clear) clear.onclick = ()=>{
      if(this.running) this.stop(false);
      this.seq = [];
      $$('#flowSeq .flow-chip').forEach(x=>x.classList.remove('on'));
      this.idx = 0; this.switches = 0;
      this.render();
      toast(T('flow.cleared'),'ok',2200);
    };
    const start = $('#flowStart');
    if(start) start.onclick = ()=> this.running ? this.stop(true) : this.start();
    this.render();
  },
  /* 少于两个和弦时的显式提示：轻量模态 + toast 双通道，确保被看见 */
  _alertNotEnough(){
    const n = this.seq.length;
    const msg = n === 0
      ? T('flow.needTwo')
      : TF('flow.alertN',{n});
    toast(msg, 'warn', 3200);
    try{
      const box = document.createElement('div');
      box.className = 'gs-modal-mask';
      box.setAttribute('data-flow','mask');
      box.innerHTML =
        `<div class="gs-modal" role="alertdialog" aria-modal="true">
           <div class="gs-modal-title" data-flow="title">${T('flow.modalTitle')}</div>
           <div class="gs-modal-body" data-flow="body">${msg}</div>
           <div class="gs-modal-actions"><button class="gs-modal-btn" data-close data-flow="ok">${T('flow.modalOk')}</button></div>
         </div>`;
      document.body.appendChild(box);
      const close = ()=>{ box.remove(); };
      box.addEventListener('click', e=>{ if(e.target.dataset.close !== undefined || e.target === box) close(); });
      const btn = box.querySelector('.gs-modal-btn');
      if(btn) btn.focus();
    }catch(e){ /* 模态失败时 toast 已提示，不影响功能 */ }
  },
  chordOf(name){ return CHORD_MAP[name] || null; },
  render(){
    const a = $('#flowNow'), b = $('#flowNext');
    const cur = this.chordOf(this.seq[this.idx % this.seq.length]);
    const nxt = this.chordOf(this.seq[(this.idx+1) % this.seq.length]);
    if(a && cur) a.innerHTML = renderDiagram(cur, {big:true});
    if(b && nxt) b.innerHTML = renderDiagram(nxt, {});
    const na = $('#flowNowName'), nb = $('#flowNextName');
    if(na) na.textContent = cur ? cur.name : '—';
    if(nb) nb.textContent = nxt ? nxt.name : '—';
    const sw = $('#flowSwitches'); if(sw) sw.textContent = this.switches;
  },
  start(){
    /* 物理机实测需求：少于两个和弦时明确弹出提示并且绝不开始练习。
       旧实现只有一句 toast 一闪而过，用户不确定到底有没有开始。 */
    if(this.seq.length < 2){
      this._alertNotEnough();
      return;
    }
    AudioEngine.ensure();
    this.running = true; this.idx = 0; this.switches = 0; this.beat = 0;
    this.startedAt = Date.now();
    const btn = $('#flowStart'); if(btn) btn.textContent = T('flow.stop');
    const msPerBeat = 60000 / this.bpm;
    const beatsPerChord = this.bars * 4;
    this.render();
    const tick = ()=>{
      if(!this.running) return;
      const isDownbeat = this.beat % beatsPerChord === 0;
      // 重音提示换和弦，弱音提示拍点
      AudioEngine.click(isDownbeat);
      if(isDownbeat && this.beat > 0){
        this.idx++; this.switches++;
        // 换和弦时给一次扫弦示范（与和弦库音色一致）
        const c = this.chordOf(this.seq[this.idx % this.seq.length]);
        if(c) AudioEngine.strum(chordFreqs(c), 'down', .22);
      }
      this.render();
      this.beat++;
      this.timer = setTimeout(tick, msPerBeat);
    };
    tick();
  },
  stop(report){
    this.running = false;
    if(this.timer){ clearTimeout(this.timer); this.timer = null; }
    const btn = $('#flowStart'); if(btn) btn.textContent = T('flow.start');
    if(report && typeof PracticeStore!=='undefined' && this.switches > 0){
      PracticeStore.addSession({
        module:'flow',
        startedAt:this.startedAt,
        durationMs: Date.now() - this.startedAt,
        accuracy: null,
        targetBpm: this.bpm,
        detectedBpm: null,
        meta:{ seq:this.seq.slice(), bars:this.bars, switches:this.switches }
      });
      toast(TF('flow.toastDone',{n:this.switches}),'ok');
    }
  }
,
  /* V4.3.1：按钮/模态按当前运行态取词；seq / switches / running 状态完全保留 */
  refreshLang(){
    if(!this.inited) return;
    const btn=$('#flowStart');
    if(btn) btn.textContent=this.running?T('flow.stop'):T('flow.start');
    const mask=document.querySelector('.gs-modal-mask[data-flow]');
    if(mask){
      const ti=mask.querySelector('[data-flow="title"]'), ok=mask.querySelector('[data-flow="ok"]');
      const body=mask.querySelector('[data-flow="body"]');
      if(ti) ti.textContent=T('flow.modalTitle');
      if(ok) ok.textContent=T('flow.modalOk');
      if(body) body.textContent=this.seq.length===0?T('flow.needTwo'):TF('flow.alertN',{n:this.seq.length});
    }
  }
};

if(typeof document!=='undefined' && document.addEventListener){
  document.addEventListener('gs:lang',()=>Flow.refreshLang());
}
onRouteEnter.flow = ()=>Flow.init();
/* 切页清理：确保停止后无残留声音 */
if(typeof cleanupModules==='function'){
  const _prev = cleanupModules;
  window.cleanupModules = function(){
    if(typeof Flow!=='undefined' && Flow.running) Flow.stop(true);
    _prev();
  };
}
window.Flow = Flow;
export { Flow };
