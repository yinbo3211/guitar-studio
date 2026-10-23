/* ============================================================
   六弦工坊 V3 · 模块 1：调音器
   （M3 目录重构：由 V2 app-*.js 拆分，代码体保持不变）
   ============================================================ */
'use strict';

/* ============================================================
   模块 1：调音器
   ============================================================ */
const Tuner = {
  mode:'guitar', a4:440, active:false,
  // 标准调弦：从 6 弦（最粗）到 1 弦（最细）
  strings:[
    {n:6, midi:40, label:'E'},
    {n:5, midi:45, label:'A'},
    {n:4, midi:50, label:'D'},
    {n:3, midi:55, label:'G'},
    {n:2, midi:59, label:'B'},
    {n:1, midi:64, label:'E'}
  ],
  smooth:makeSmoother(4), shownCents:0, inTuneCount:0, heardString:null, tunedSet:new Set(),
  init(){
    if(this.inited) return; this.inited=true;
    // 表盘刻度
    const W=280,cx=140,cy=162,r=132;
    let svg=`<svg viewBox="0 0 ${W} 170" width="100%" height="100%">`;
    // 底弧
    const polar=(rr,deg)=>{const a=(deg-90)*Math.PI/180;return [cx+rr*Math.cos(a),cy+rr*Math.sin(a)];};
    const arc=(rr,startDeg,endDeg,color,width)=>{
      const [x1,y1]=polar(rr,startDeg),[x2,y2]=polar(rr,endDeg);
      const large=Math.abs(endDeg-startDeg)>180?1:0;
      return `<path d="M${x1} ${y1} A${rr} ${rr} 0 ${large} 1 ${x2} ${y2}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>`;
    };
    svg+=arc(r,-90,90,'rgba(255,255,255,.09)',10);
    // 左半偏低蓝、右半偏高红
    svg+=arc(r,-90,-10,'rgba(77,159,255,.35)',10);
    svg+=arc(r,10,90,'rgba(255,93,115,.35)',10);
    // 准音绿区
    svg+=arc(r,-10,10,'url(#tunerGrad)',10);
    svg+=`<defs><linearGradient id="tunerGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#2ee6a8"/><stop offset="1" stop-color="#5ff5c2"/></linearGradient></defs>`;
    // 刻度
    for(let c=-50;c<=50;c+=5){
      const deg=c*1.8;
      const major=c%10===0;
      const [x1,y1]=polar(r-9,deg),[x2,y2]=polar(r-(major?22:15),deg);
      svg+=`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${major?'rgba(255,255,255,.5)':'rgba(255,255,255,.22)'}" stroke-width="${major?2:1}"/>`;
    }
    [-50,-25,0,25,50].forEach(c=>{
      const deg=c*1.8; const [x,y]=polar(r-36,deg);
      svg+=`<text x="${x}" y="${y+4}" text-anchor="middle" font-size="10" fill="rgba(255,255,255,.4)" font-family="JetBrains Mono,monospace">${c>0?'+'+c:c}</text>`;
    });
    svg+='</svg>';
    $('#dialLines').innerHTML=svg;
    // 弦按钮
    $('#stringRow').innerHTML=this.strings.map(s=>
      `<button class="string-btn" data-midi="${s.midi}"><b>${s.label}</b><span>${s.n}弦</span></button>`).join('');
    $('#stringRow').addEventListener('click',e=>{
      const b=e.target.closest('.string-btn'); if(!b) return;
      AudioEngine.ensure();
      AudioEngine.pluck(this.freq(+b.dataset.midi),0,2.2,.4);
    });
    // 模式
    $('#tunerMode').addEventListener('click',e=>{
      const b=e.target.closest('button'); if(!b) return;
      $$('#tunerMode button').forEach(x=>x.classList.toggle('on',x===b));
      this.mode=b.dataset.mode;
      this.tunedSet.clear(); this.heardString=null;
      $('#stringRow').style.display=this.mode==='guitar'?'flex':'none';
    });
    // A4
    const range=$('#a4Range');
    range.addEventListener('input',()=>{
      this.a4=+range.value;
      $('#a4Val').textContent=this.a4+' Hz';
      range.style.setProperty('--fill',(this.a4-432)/14*100+'%');
    });
    range.style.setProperty('--fill',(440-432)/14*100+'%');
    // 开关
    $('#tunerToggle').addEventListener('click',()=>this.toggle());
  },
  freq(m){ return this.a4*Math.pow(2,(m-69)/12); },
  async toggle(){
    AudioEngine.ensure();
    if(this.active){
      Mic.stop(); this.active=false;
      this.resetUI();
      $('#tunerToggleTxt').textContent='开启麦克风调音';
      $('#tunerToggle').classList.remove('btn-danger');
      $('#tunerToggle').classList.add('btn-primary');
      return;
    }
    $('#tunerToggleTxt').textContent='正在请求麦克风…';
    const ok=await Mic.start(r=>this.onPitch(r));
    if(ok){
      this.active=true;
      $('#tunerToggleTxt').textContent='停止调音';
      $('#tunerToggle').classList.remove('btn-primary');
      $('#tunerToggle').classList.add('btn-danger');
      $('#tunerSub').textContent='请拨响任意一根弦';
    }else{
      $('#tunerToggleTxt').textContent='开启麦克风调音';
    }
  },
  resetUI(){
    $('#tunerNote').textContent='--';
    $('#tunerSub').textContent='点击下方按钮开启麦克风';
    $('#tunerFreq').textContent='';
    $('#tunerStatus').textContent='';
    $('#tunerLevel').style.width='0%';
    $('#dialNeedle').style.transform='rotate(0deg)';
    $('#dialGlow').style.opacity='0';
    $('#tunerNote').style.color='';
    $$('.string-btn').forEach(b=>b.classList.remove('heard','tuned'));
  },
  onPitch(r){
    // 电平
    $('#tunerLevel').style.width=clamp(r.rms*900,0,100)+'%';
    if(r.freq==null){
      this.smooth(null);
      this.inTuneCount=0;
      if(r.rms>0.006){
        $('#tunerStatus').textContent='环境噪音较大，靠近音孔再试';
        $('#tunerStatus').style.color='var(--txt-3)';
      }else{
        /* V2-BUG-04 修复（P2）：静音（无信号）时不能残留上一根弦的
           「准 ✓」绿灯——把音名/指针/高亮弦全部复位到无信号态。 */
        this.shownCents=0;
        $('#dialNeedle').style.transform='rotate(0deg)';
        $('#dialGlow').style.opacity='0';
        $('#tunerNote').textContent='--';
        $('#tunerNote').style.color='';
        $('#tunerStatus').textContent='';
        $$('.string-btn').forEach(b=>b.classList.remove('heard'));
      }
      return;
    }
    // Fix-9: 检测音高统一基于当前 A4 基准（this.a4）计算 MIDI 值
    let midiFloat=69+12*Math.log2(r.freq/this.a4);
    const smoothed=this.smooth(midiFloat);
    if(smoothed==null) return;
    let targetMidi, cents, displayName, sub;
    if(this.mode==='guitar'){
      // 找最接近的标准弦
      let best=null,bd=99;
      this.strings.forEach(s=>{const d=Math.abs(smoothed-s.midi);if(d<bd){bd=d;best=s;}});
      // Fix-9: 目标音高按报告公式基于当前 A4 基准换算：targetMidi=69+12*log2(targetFreq/this.a4)，
      // 与 smoothed 保持同一基准（this.freq() 本身以 this.a4 计算，故结果恒等于 best.midi）；
      // 取整以避免浮点误差破坏后续 === 比较
      const targetFreq=this.freq(best.midi);
      targetMidi=Math.round(69+12*Math.log2(targetFreq/this.a4));
      cents=(smoothed-targetMidi)*100;
      if(Math.abs(cents)>60){ // 偏差太大，忽略
        // P2-20 修复：返回前清空残留 UI——V1 只清状态文字，
        // 指针/音名/频率仍停在上一帧，给人"卡住"的错觉
        $('#tunerStatus').textContent='';
        $('#tunerNote').textContent='--';
        $('#tunerFreq').textContent='';
        $('#dialNeedle').style.transform='rotate(0deg)';
        $('#dialGlow').style.opacity='0';
        return;
      }
      displayName=best.label;
      sub=best.n+'弦 · 目标 '+(this.freq(best.midi).toFixed(1))+' Hz';
      this.heardString=best.n;
      $$('.string-btn').forEach(b=>{
        const on=+b.dataset.midi===best.midi;
        b.classList.toggle('heard',on);
      });
    }else{
      // Fix-9: smoothed 已基于当前 A4，直接四舍五入即为目标，两值天然同基准
      targetMidi=Math.round(smoothed);
      cents=(smoothed-targetMidi)*100;
      displayName=noteNameNoOct(targetMidi)+(Math.floor(targetMidi/12)-1);
      sub='半音阶';
    }
    cents=clamp(cents,-50,50);
    // 指针平滑
    this.shownCents+=(cents-this.shownCents)*0.35;
    $('#dialNeedle').style.transform='rotate('+(this.shownCents*1.8)+'deg)';
    $('#tunerNote').textContent=displayName;
    $('#tunerSub').textContent=sub;
    $('#tunerFreq').textContent=r.freq.toFixed(1)+' Hz';
    const st=$('#tunerStatus'), note=$('#tunerNote'), glow=$('#dialGlow');
    if(Math.abs(cents)<=5){
      this.inTuneCount++;
      st.textContent='准 ✓';
      st.style.color='var(--mint)';
      note.style.color='var(--mint)';
      glow.style.opacity='1';
      if(this.mode==='guitar' && this.heardString){
        const btn=$$('.string-btn').find(b=>+b.dataset.midi===targetMidi);
        if(btn) btn.classList.add('tuned');
        if(this.inTuneCount>8){
          this.tunedSet.add(this.heardString);
          if(this.tunedSet.size===6){ toast('六根弦全部调准，开始练习吧！','ok'); this.tunedSet.clear(); }
        }
      }
    }else{
      this.inTuneCount=0;
      const flat=cents<0;
      st.textContent=flat?('偏低 '+(Math.abs(cents).toFixed(0))+' 音分'):('偏高 '+(cents.toFixed(0))+' 音分');
      st.style.color=flat?'var(--blue)':'var(--red)';
      note.style.color=flat?'var(--blue)':'var(--red)';
      glow.style.opacity='0';
      if(this.mode==='guitar'){
        const btn=$$('.string-btn').find(b=>+b.dataset.midi===targetMidi);
        if(btn) btn.classList.remove('tuned');
      }
    }
  }
};
onRouteEnter.tuner=()=>{ Tuner.init(); };

window.Tuner = Tuner;
export { Tuner };
