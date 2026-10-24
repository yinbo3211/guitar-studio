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
    const start = $('#flowStart');
    if(start) start.onclick = ()=> this.running ? this.stop(true) : this.start();
    this.render();
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
    if(this.seq.length < 2){ toast('请先选择至少两个和弦','warn'); return; }
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
