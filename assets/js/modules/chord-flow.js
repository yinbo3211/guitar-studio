/* ============================================================
   六弦工坊 V3.1 · 模块：和弦转换训练（F4）
   ------------------------------------------------------------
   按节拍器提示在两个及以上和弦之间切换，屏幕同时显示当前与
   下一个和弦指法图；记录目标速度、停留时长与切换次数，计入 F1。
   V3.1 仅做「节拍引导版」：不接入麦克风识别和弦，也不宣称能
   判断切换动作是否标准。
   ============================================================ */
'use strict';

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
          if(this.seq.length<=2) { toast('至少保留两个和弦','warn'); return; }
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
      toast('已清空已选和弦，请重新选择至少两个','ok',2200);
    };
    const start = $('#flowStart');
    if(start) start.onclick = ()=> this.running ? this.stop(true) : this.start();
    this.render();
  },
  /* 少于两个和弦时的显式提示：轻量模态 + toast 双通道，确保被看见 */
  _alertNotEnough(){
    const n = this.seq.length;
    const msg = n === 0
      ? '请先在上方选择至少两个和弦，再开始转换练习'
      : `当前只选了 ${n} 个和弦，至少需要两个才能开始转换练习`;
    toast(msg, 'warn', 3200);
    try{
      const box = document.createElement('div');
      box.className = 'gs-modal-mask';
      box.innerHTML =
        `<div class="gs-modal" role="alertdialog" aria-modal="true">
           <div class="gs-modal-title">无法开始练习</div>
           <div class="gs-modal-body">${msg}</div>
           <div class="gs-modal-actions"><button class="gs-modal-btn" data-close>我知道了</button></div>
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
    const btn = $('#flowStart'); if(btn) btn.textContent = '停止';
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
    const btn = $('#flowStart'); if(btn) btn.textContent = '开始转换练习';
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
      toast(`本轮完成：${this.switches} 次转换，已计入练习统计`,'ok');
    }
  }
};

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
