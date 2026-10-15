/* ============================================================
   六弦工坊 · 主脚本
   ============================================================ */
'use strict';

/* ---------- 通用工具 ---------- */
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
const clamp = (v,a,b)=>Math.min(b,Math.max(a,v));
const midiFromFreq = f => 69 + 12*Math.log2(f/440);
const freqFromMidi = m => 440*Math.pow(2,(m-69)/12);
const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const NOTE_CN = {'C':'哆','C#':'升哆','D':'来','D#':'升来','E':'咪','F':'发','F#':'升发','G':'嗦','G#':'升嗦','A':'拉','A#':'升拉','B':'西'};
function noteName(midi){ return NOTE_NAMES[((midi%12)+12)%12] + (Math.floor(midi/12)-1); }
function noteNameNoOct(midi){ return NOTE_NAMES[((midi%12)+12)%12]; }
const SVG_ICONS = {
  mic:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><path d="M12 18v3"/></svg>',
  play:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l11-6.5a1 1 0 0 0 0-1.72l-11-6.5A1 1 0 0 0 8 5.5z"/></svg>',
  stop:'<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2.5"/></svg>',
  check:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  close:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>'
};

function toast(msg, type='info', ms=2200){
  const wrap = $('#toastWrap');
  const el = document.createElement('div');
  el.className = 'toast';
  const colors = {info:'var(--cyan)', ok:'var(--mint)', err:'var(--red)', warn:'var(--amber)'};
  el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="${colors[type]||'var(--cyan)'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.01"/></svg><span>${msg}</span>`;
  wrap.appendChild(el);
  setTimeout(()=>{ el.classList.add('out'); setTimeout(()=>el.remove(), 320); }, ms);
}

/* ---------- 路由 ---------- */
const ROUTE_TITLES = {home:'六弦工坊',tuner:'调音器',metro:'节拍器',game:'和弦闯关',chords:'和弦库',ear:'练耳训练',fret:'指板训练',studio:'录音棚'};
const onRouteEnter = {};
function go(route){
  location.hash = '#/'+route;
}
function applyRoute(){
  const route = (location.hash.replace('#/','')||'home').split('?')[0];
  $$('.view').forEach(v=>v.classList.toggle('active', v.id==='view-'+route));
  $$('.nav-item').forEach(b=>b.classList.toggle('active', b.dataset.route===route));
  $$('.tab').forEach(b=>b.classList.toggle('active', b.dataset.route===route));
  $('#topbarTitle').textContent = ROUTE_TITLES[route]||'六弦工坊';
  $('#views').scrollTop = 0;
  if(onRouteEnter[route]) onRouteEnter[route]();
}
window.addEventListener('hashchange', applyRoute);
document.addEventListener('click', e=>{
  const t = e.target.closest('[data-route]');
  if(t){ closeMoreSheet(); go(t.dataset.route); }
});

/* 移动端更多菜单 */
const MORE_ROUTES = [
  {r:'chords',label:'和弦库',ic:'<circle cx="7" cy="7" r="2.4"/><circle cx="17" cy="7" r="2.4"/><circle cx="12" cy="17" r="2.4"/><path d="M9.2 8.2l3.6 6.6M14.8 8.2l-3.6 6.6"/>'},
  {r:'ear',label:'练耳',ic:'<path d="M12 22a7 7 0 0 0 7-7c0-3-1-5-1-8a6 6 0 0 0-12 0c0 3-1 5-1 8a7 7 0 0 0 7 7z"/>'},
  {r:'fret',label:'指板',ic:'<path d="M4 6h16M4 12h16M4 18h16"/>'},
  {r:'studio',label:'录音',ic:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.2"/>'}
];
$('#moreGrid').innerHTML = MORE_ROUTES.map(m=>`
  <button class="more-item" data-route="${m.r}" style="display:flex;flex-direction:column;align-items:center;gap:8px;padding:14px 4px;border-radius:14px;background:rgba(255,255,255,.04);border:1px solid var(--line);transition:all .2s">
    <span style="width:42px;height:42px;border-radius:13px;display:grid;place-items:center;background:rgba(255,180,84,.12);color:var(--amber)">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${m.ic}</svg>
    </span>
    <span style="font-size:12.5px;color:var(--txt)">${m.label}</span>
  </button>`).join('');
function closeMoreSheet(){
  $('#moreSheet').style.transform='translateY(105%)';
  $('#sheetMask').style.opacity='0';
  $('#sheetMask').style.pointerEvents='none';
}
$('#tabMore').addEventListener('click',()=>{
  $('#moreSheet').style.transform='translateY(0)';
  $('#sheetMask').style.opacity='1';
  $('#sheetMask').style.pointerEvents='auto';
});
$('#sheetMask').addEventListener('click', closeMoreSheet);

/* ============================================================
   音频引擎（原生 Web Audio，全部本地处理）
   ============================================================ */
const AudioEngine = {
  ctx:null, master:null,
  ensure(){
    if(!this.ctx){
      this.ctx = new (window.AudioContext||window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = .5;
      this.master.connect(this.ctx.destination);
    }
    if(this.ctx.state==='suspended') this.ctx.resume();
    return this.ctx;
  },
  /* 拨弦合成：三角波基音 + 泛音 + 指数衰减 */
  pluck(freq, when=0, dur=1.6, vol=.32){
    const ctx=this.ensure(), t0=ctx.currentTime+when;
    const g=ctx.createGain();
    g.connect(this.master);
    const partials=[
      {type:'triangle',ratio:1, gain:1.0, decay:1.0},
      {type:'sine',    ratio:2, gain:.32,decay:.55},
      {type:'sine',    ratio:3, gain:.16,decay:.32},
      {type:'sine',    ratio:4, gain:.07,decay:.18}
    ];
    partials.forEach(p=>{
      const o=ctx.createOscillator(), pg=ctx.createGain();
      o.type=p.type; o.frequency.value=freq*p.ratio;
      pg.gain.value=p.gain;
      o.connect(pg); pg.connect(g);
      const pd=dur*p.decay;
      pg.gain.setValueAtTime(0,t0);
      pg.gain.linearRampToValueAtTime(vol*p.gain, t0+0.004);
      pg.gain.exponentialRampToValueAtTime(0.0001, t0+pd);
      o.start(t0); o.stop(t0+pd+.05);
    });
    // 起音小噪声，模拟拨弦
    return t0;
  },
  /* 扫弦：从低音弦到高音弦依次拨响 */
  strum(freqs, dir='down', vol=.28){
    const order = dir==='down' ? freqs : freqs.slice().reverse();
    order.forEach((f,i)=> this.pluck(f, i*0.032, 1.8, vol));
  },
  /* 节拍器 click：方波短促 */
  click(accent=false, when=0){
    const ctx=this.ensure(), t0=ctx.currentTime+when;
    const o=ctx.createOscillator(), g=ctx.createGain(), f=ctx.createBiquadFilter();
    o.type='square';
    o.frequency.value = accent?1600:1050;
    f.type='lowpass'; f.frequency.value=2400;
    g.gain.setValueAtTime(accent?.42:.28, t0);
    g.gain.exponentialRampToValueAtTime(.0001, t0+.055);
    o.connect(f); f.connect(g); g.connect(this.master);
    o.start(t0); o.stop(t0+.07);
  },
  /* 纯音（练耳、参考音） */
  tone(freq, dur=1.2, type='sine', vol=.25, when=0){
    const ctx=this.ensure(), t0=ctx.currentTime+when;
    const o=ctx.createOscillator(), g=ctx.createGain();
    o.type=type; o.frequency.value=freq;
    g.gain.setValueAtTime(.0001,t0);
    g.gain.linearRampToValueAtTime(vol,t0+.02);
    g.gain.setValueAtTime(vol,t0+dur-.06);
    g.gain.exponentialRampToValueAtTime(.0001,t0+dur);
    o.connect(g); g.connect(this.master);
    o.start(t0); o.stop(t0+dur+.05);
    return t0;
  }
};

/* ---------- 麦克风管理 ---------- */
const Mic = {
  stream:null, ctx:null, analyser:null, raf:null,
  async start(onPitch){
    if(this.stream) return true;
    try{
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio:{echoCancellation:false, noiseSuppression:false, autoGainControl:false}
      });
    }catch(err){
      console.warn(err);
      if(err && (err.name==='NotAllowedError'||err.name==='SecurityError'))
        toast('麦克风权限被拒绝，请在浏览器地址栏允许麦克风','err',3200);
      else
        toast('无法访问麦克风，请检查设备或使用 localhost/HTTPS 访问','err',3200);
      return false;
    }
    const AC = window.AudioContext||window.webkitAudioContext;
    this.ctx = new AC();
    const src=this.ctx.createMediaStreamSource(this.stream);
    this.analyser=this.ctx.createAnalyser();
    this.analyser.fftSize=2048;
    src.connect(this.analyser);
    this.buf=new Float32Array(this.analyser.fftSize);
    const loop=()=>{
      this.analyser.getFloatTimeDomainData(this.buf);
      const r=PitchDetect(this.buf, this.ctx.sampleRate);
      onPitch(r);
      this.raf=requestAnimationFrame(loop);
    };
    loop();
    return true;
  },
  stop(){
    if(this.raf) cancelAnimationFrame(this.raf);
    this.raf=null;
    if(this.stream){ this.stream.getTracks().forEach(t=>t.stop()); this.stream=null; }
    if(this.ctx){ this.ctx.close(); this.ctx=null; }
  }
};

/* ---------- 自相关基频检测（autocorrelation, 基于公开的 ACF2+ 算法） ---------- */
function PitchDetect(buf, sampleRate){
  let SIZE=buf.length;
  let rms=0;
  for(let i=0;i<SIZE;i++) rms+=buf[i]*buf[i];
  rms=Math.sqrt(rms/SIZE);
  if(rms<0.008) return {freq:null,rms,clarity:0};
  // 去直流
  let mean=0; for(let i=0;i<SIZE;i++) mean+=buf[i]; mean/=SIZE;
  for(let i=0;i<SIZE;i++) buf[i]-=mean;
  // 限定吉他基频范围：约 60Hz(E2) ~ 1320Hz(E6)
  let r1=Math.floor(sampleRate/1320);
  let r2=Math.min(SIZE-1, Math.floor(sampleRate/55));
  let bestR=-1, bestV=0, bestDip=1;
  const thresh=0;
  for(let i=0;i<=r1;i++){ /* no-op */ }
  // 找到第一个过零点
  let r=r1;
  while(r<r2 && buf[r]>=thresh) r++;
  while(r<r2 && buf[r]<=thresh) r++;
  for(;r<r2;r++){
    let sum=0;
    for(let i=0;i<SIZE-r;i++) sum+=buf[i]*buf[i+r];
    let v=sum/(SIZE-r);
    if(v>bestV){ bestV=v; bestR=r; bestDip=1; }
    else if(bestR>0){
      let dip=v/bestV;
      if(dip<bestDip) bestDip=dip;
      if(dip>0.95) break; // 越过主峰
    }
  }
  if(bestR<0) return {freq:null,rms,clarity:0};
  // 二次曲线插值提高精度
  let x0=bestR-1, x1=bestR, x2=bestR+1;
  const corr=(lag)=>{
    if(lag<=0||lag>=SIZE) return 0;
    let s=0; for(let i=0;i<SIZE-lag;i++) s+=buf[i]*buf[i+lag];
    return s/(SIZE-lag);
  };
  let a=corr(x0),b=corr(x1),c=corr(x2);
  let shift=(a-c)/(2*(a-2*b+c)+1e-9);
  shift=clamp(isFinite(shift)?shift:0,-1,1);
  let refined=bestR+shift;
  const clarity=clamp((1-bestDip),0,1);
  if(clarity<0.25) return {freq:null,rms,clarity};
  return {freq:sampleRate/refined, rms, clarity};
}

/* 平滑工具：值稳定才采纳 */
function makeSmoother(frames=3){
  const arr=[];
  return v=>{
    if(v==null){ arr.length=0; return null; }
    arr.push(v); if(arr.length>frames) arr.shift();
    arr.sort((a,b)=>a-b);
    return arr[Math.floor(arr.length/2)];
  };
}

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
      }
      return;
    }
    let midiFloat=69+12*Math.log2(r.freq/(this.a4/440*440));
    const smoothed=this.smooth(midiFloat);
    if(smoothed==null) return;
    let targetMidi, cents, displayName, sub;
    if(this.mode==='guitar'){
      // 找最接近的标准弦
      let best=null,bd=99;
      this.strings.forEach(s=>{const d=Math.abs(smoothed-s.midi);if(d<bd){bd=d;best=s;}});
      targetMidi=best.midi;
      cents=(smoothed-targetMidi)*100;
      if(Math.abs(cents)>60){ // 偏差太大，忽略
        $('#tunerStatus').textContent='';
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
