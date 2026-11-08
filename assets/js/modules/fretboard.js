/* ============================================================
   六弦工坊 V3 · 模块 6：指板
   （M3 目录重构：由 V2 app-*.js 拆分，代码体保持不变）
   ============================================================ */
'use strict';

/* V4.3.1 收尾：用户可见文案统一走宿主词条（无宿主 / Node 单测回退 key） */
const T = k => { try { if(typeof window!=='undefined' && typeof window.t==='function') return window.t(k); } catch(e){} return k; };
const TF = (k,p) => { try { if(typeof window!=='undefined' && window.gsI18n && typeof window.gsI18n.tF==='function') return window.gsI18n.tF(k,p); } catch(e){} let s=T(k); for(const a of Object.keys(p||{})) s=s.split('{'+a+'}').join(String(p[a])); return s; };

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
      $('#fbStart').textContent=T('fret.startBtn'); // P2-16：按钮文案回到初始状态
      this._hint(this.mode==='browse'?'fret.hint.browse':'fret.hint.find');
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
      html+=`<div class="fb-open">${noteNameNoOct(base)}<br><span data-fb="str">${T('fret.stringN')}</span></div>`;
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
    let pc=((this.strings[s]+f)%12+12)%12;
    // P1-4 修复：clearMarks 虽会移除 class，但若新题与上一题同音名（约 1/12 概率），
    // 用户可能在标记真正清除前的同一帧/极短时间内看到答案；且题意上连续同题无训练意义。
    // 最多重抽若干次，保证相邻两题目标音名不同。
    let guard=0;
    while(this.targetPC!==null && pc===this.targetPC && guard<20){
      const ss=Math.floor(Math.random()*6);
      const ff=1+Math.floor(Math.random()*12);
      pc=((this.strings[ss]+ff)%12+12)%12;
      guard++;
    }
    this.targetPC=pc;
    const name=NOTE_NAMES[this.targetPC];
    $('#fbHint').innerHTML=`<span class="fb-ask" data-fb="ask" data-name="${name}">${TF('fret.ask',{name})}<small>${TF('fret.askSub',{name})}</small></span>`;
    this._hintKey=null;
    $('#fbScore').textContent=`${this.askOk}/${this.askN}`;
    $('#fbStart').textContent=T('fret.nextBtn'); // P2-16：出题后按钮文案切换
  },
  judge(cell,midi){
    const pc=((midi%12)+12)%12;
    if(pc===this.targetPC){
      cell.classList.add('good');
      this.askOk++;
      this.playing=false;
      $('#fbScore').textContent=`${this.askOk}/${this.askN}`;
      $('#fbHint').innerHTML=`<span class="fb-ask" data-fb="correct" style="color:var(--mint)">${T('fret.correct')}</span><span class="hint" data-fb="nextHint" style="margin-left:10px">${T('fret.nextHint')}</span>`;
      this._hintKey=null;
      // 标出该音在指板上的所有位置
      $$('.fb-cell').forEach(c=>{ if(+c.dataset.pc===pc) c.classList.add('ring'); });
    }else{
      cell.classList.add('bad');
      setTimeout(()=>cell.classList.remove('bad'),450);
    }
  }
,
  /* V4.3.1：提示记录取词来源；题面/结果按 data 属性局部重放，不重建指板、不丢计分 */
  _hint(key,pairs){
    this._hintKey=key; this._hintPairs=pairs||null;
    $('#fbHint').innerHTML=`<span class="hint">${pairs?TF(key,pairs):T(key)}</span>`;
  },
  refreshLang(){
    if(!this.inited) return;
    $$('#fbBoard .fb-open [data-fb="str"]').forEach(e=>{ e.textContent=T('fret.stringN'); });
    const st=$('#fbStart');
    if(st) st.textContent=this.playing?T('fret.nextBtn'):T('fret.startBtn');
    if(this._hintKey) this._hint(this._hintKey,this._hintPairs);
    const ask=$('#fbHint [data-fb="ask"]');
    if(ask){ const nm=ask.dataset.name;
      ask.innerHTML=TF('fret.ask',{name:nm})+'<small>'+TF('fret.askSub',{name:nm})+'</small>'; }
    const corr=$('#fbHint [data-fb="correct"]');
    if(corr) corr.textContent=T('fret.correct');
    const nh=$('#fbHint [data-fb="nextHint"]');
    if(nh) nh.textContent=T('fret.nextHint');
  }
};
if(typeof document!=='undefined' && document.addEventListener){
  document.addEventListener('gs:lang',()=>Fret.refreshLang());
}
onRouteEnter.fret=()=>Fret.init();

window.Fret = Fret;
export { Fret };
