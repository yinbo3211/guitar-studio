/* ============================================================
   六弦工坊 V3 · 模块 6：指板
   （M3 目录重构：由 V2 app-*.js 拆分，代码体保持不变）
   ============================================================ */
'use strict';

const { clamp, midiFromFreq, freqFromMidi, NOTE_NAMES, NOTE_CN, noteName, noteNameNoOct, makeSmoother, PitchDetect, OPEN_MIDI, tapBpm, isSubAccent, quantizeToOctave, matchFretTarget, isPitchMatch, centsBetween, pcFromName } = AudioCore;   // V3 M3：模块级解构（原 app 文件共享作用域）

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

window.Fret = Fret;
export { Fret };
