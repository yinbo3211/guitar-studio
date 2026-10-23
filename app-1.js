/* ============================================================
   六弦工坊 · 主脚本
   ============================================================ */
'use strict';

/* ---------- 通用工具 ----------
   V2 M1：算法与常量已迁移至 lib/audio-core.js（AudioCore），
   此处仅解构为原有名称，保证后续代码零改动、行为一致。 */
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
const { clamp, midiFromFreq, freqFromMidi, NOTE_NAMES, NOTE_CN, noteName, noteNameNoOct,
        makeSmoother, PitchDetect } = AudioCore;
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
const ROUTE_TITLES = {home:'六弦工坊',tuner:'调音器',metro:'节拍器',rhythm:'节奏型练习',game:'和弦闯关',scale:'音阶练习',chords:'和弦库',ear:'练耳训练',fret:'指板训练',studio:'录音棚'};
const onRouteEnter = {};
function go(route){
  location.hash = '#/'+route;
}
function applyRoute(){
  // P1-05 修复：切页清理必须放在 applyRoute 内部——
  // V1 在 app-3.js 里重包装 applyRoute，但 hashchange 监听绑定的仍是
  // 旧函数引用，包装永远不会被触发，导致切页不清理麦克风/伴奏/录音。
  if(typeof cleanupModules==='function') cleanupModules();
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
  {r:'rhythm',label:'节奏',ic:'<path d="M4 4v16M8 4v16M12 7v10M16 4v16M20 7v10"/>'},
  {r:'chords',label:'和弦库',ic:'<circle cx="7" cy="7" r="2.4"/><circle cx="17" cy="7" r="2.4"/><circle cx="12" cy="17" r="2.4"/><path d="M9.2 8.2l3.6 6.6M14.8 8.2l-3.6 6.6"/>'},
  {r:'scale',label:'音阶',ic:'<path d="M4 19h4v-5h4V9h4V4h4"/>'},
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
  /* 扫弦：从低音弦到高音弦依次拨响（when 为音频时钟偏移，供进度伴奏提前调度） */
  strum(freqs, dir='down', vol=.28, when=0){
    const order = dir==='down' ? freqs : freqs.slice().reverse();
    order.forEach((f,i)=> this.pluck(f, when + i*0.032, 1.8, vol));
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
/* P0-03 修复：HTTP 明文（非 localhost）下浏览器判定非安全上下文，
   navigator.mediaDevices 本身是 undefined，直接调用会抛 TypeError。
   先做存在性/安全性校验，把「为什么不能用」讲清楚，再谈授权。 */
function micGuard(){
  if(!window.isSecureContext){
    toast('当前是 HTTP 明文访问，浏览器已禁用麦克风。','err',4500);
    toast('请用 HTTPS 域名访问（Cloudflare 橙云 / Caddy / certbot）或本机 localhost。','err',4500);
    return false;
  }
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
    toast('当前浏览器未开放麦克风接口，请更换 Chrome/Edge 并用 HTTPS 访问。','err',4500);
    return false;
  }
  return true;
}
const Mic = {
  stream:null, ctx:null, analyser:null, raf:null, cb:null, frame:0,
  async start(onPitch){
    // P0-02 修复：Mic 为全局单例，复用旧流时必须刷新回调，
    // 否则切换模块后检测结果仍发给旧模块、判定完全失效
    this.cb = onPitch;
    if(this.stream) return true; // 已有流：只换回调，不重复申请
    if(!micGuard()) return false; // P0-03：安全上下文/接口存在性前置校验
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
    this.frame=0;
    const loop=()=>{
      // P2-19 修复：PitchDetect 为 O(maxLag×SIZE)，rAF(~60fps) 全帧检测
      // 在低端手机易掉帧，降为 ~30fps（隔帧检测）
      this.raf=requestAnimationFrame(loop);
      if(++this.frame%2===0) return;
      this.analyser.getFloatTimeDomainData(this.buf);
      const r=PitchDetect(this.buf, this.ctx.sampleRate);
      if(this.cb) this.cb(r); // P0-02：始终调用最新回调
    };
    loop();
    return true;
  },
  stop(){
    this.cb=null; // P0-02：停止后不再向任何模块回调
    if(this.raf) cancelAnimationFrame(this.raf);
    this.raf=null;
    if(this.stream){ this.stream.getTracks().forEach(t=>t.stop()); this.stream=null; }
    if(this.ctx){ this.ctx.close(); this.ctx=null; }
  }
};

/* V2 M1：PitchDetect（归一化自相关基频检测，含 MPM 抗低八度误锁与抛物线插值）
   与 makeSmoother（中位数平滑）已迁移至 lib/audio-core.js，由顶部解构引入，
   算法回归测试见 test/audio-core.test.js。 */

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
