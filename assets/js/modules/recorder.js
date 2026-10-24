/* ============================================================
   六弦工坊 V3 · 模块 8：录音棚
   （M3 目录重构：由 V2 app-*.js 拆分，代码体保持不变）
   ============================================================ */
'use strict';

const { clamp, midiFromFreq, freqFromMidi, NOTE_NAMES, NOTE_CN, noteName, noteNameNoOct, makeSmoother, PitchDetect, OPEN_MIDI, tapBpm, isSubAccent, quantizeToOctave, matchFretTarget, isPitchMatch, centsBetween, pcFromName } = AudioCore;   // V3 M3：模块级解构（原 app 文件共享作用域）

/* ============================================================
   模块 7：录音棚（MediaRecorder，本地保存）
   ============================================================ */
const Studio = {
  rec:null, chunks:[], stream:null, ac:null, analyser:null, raf:null,
  t0:0, tickTimer:null, items:[], idx:0,
  init(){
    if(this.inited) return; this.inited=true;
    $('#recBtn').onclick=()=>this.toggle();
  },
  fmt(sec){
    const m=Math.floor(sec/60), s=Math.floor(sec%60);
    return String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
  },
  async toggle(){
    if(this.rec&&this.rec.state==='recording'){ this.stop(); return; }
    // Bug3：开始新录音前，若上一条刚停止、onstop 尚未派发，先把旧硬件资源在此释放，
    // 避免新旧两条 MediaStream/AudioContext 短暂并存（旧流指示灯常亮）。
    if(this.rec){ try{ if(this.rec.state!=='inactive') this.rec.stop(); }catch(e){} this._detachHardware(); }
    // P1-08 修复：MediaRecorder 支持性检查必须先于 getUserMedia——
    // V1 先申请麦克风再检查，旧浏览器不支持时直接 return，
    // 已获取的 stream 永远不会释放，麦克风指示灯常亮（泄漏）。
    if(!window.MediaRecorder){ toast('当前浏览器不支持录音功能','err');return; }
    // P0-03 修复：HTTP 明文下 mediaDevices 为 undefined，先校验再调用
    try{
      this.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false}});
    }catch(e){
      toast('无法访问麦克风，请检查权限','err');return;
    }
    const types=['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg'];
    let mime='';
    for(const t of types){ if(MediaRecorder.isTypeSupported(t)){mime=t;break;} }
    // P1-3 修复：构造 MediaRecorder 可能抛异常（设备占用/类型不支持等）。
    // 此时 getUserMedia 已拿到 stream，必须 try/catch 并立即释放，否则麦克风灯常亮。
    try{
      this.rec=mime?new MediaRecorder(this.stream,{mimeType:mime}):new MediaRecorder(this.stream);
    }catch(e){
      toast('录音初始化失败：'+(e&&e.message||e),'err');
      this._release();
      return;
    }
    // Bug3 修复：每次录音一个递增会话 token。停止后旧 MediaRecorder 的 onstop 是异步的，
    // 若用户立刻开始新录音，旧 onstop 不得再操作共享字段（this.chunks 已被新一轮清空、
    // this.stream/ac/rec 已指向新会话），否则会：丢上一条录音 + 停掉新流导致录音中断 + UI 假死。
    // 模型：硬件资源在 stop()/切页时「同步独立」释放；onstop 只负责保存数据（纯函数式，自包含）。
    this._session=(this._session||0)+1;
    const session=this._session;
    const chunks=[];          // Bug3：chunks 会话局部化，避免新一轮 this.chunks=[] 清空旧录音数据
    this.chunks=chunks;
    const rec=this.rec;
    rec.ondataavailable=e=>{ if(e.data.size) chunks.push(e.data); };
    rec.onerror=()=>{ if(session===this._session) this._release(); };
    // onstop 仅保存「本会话」的录音数据，绝不释放任何硬件资源（资源已在 stop 同步释放），
    // 因此即使停止后立即重录，旧 onstop 也不会影响新会话。
    rec.onstop=()=>{
      // P2-12：扩展名以「实际生效」的 mimeType 为准（rec.mimeType 可能含编解码器串）。
      const usedMime=rec.mimeType||mime||'';
      const ext=usedMime.includes('mp4')?'mp4':(usedMime.includes('ogg')?'ogg':'webm');
      if(!chunks.length) return;
      const blob=new Blob(chunks,{type:usedMime||'audio/webm'});
      const url=URL.createObjectURL(blob);
      this.idx++;
      this.items.unshift({url,ext,dur:this.lastDur,name:'录音 '+this.idx});
      this.render();
    };
    // 电平表
    try{
      this.ac=new (window.AudioContext||window.webkitAudioContext)();
      const src=this.ac.createMediaStreamSource(this.stream);
      this.analyser=this.ac.createAnalyser();
      this.analyser.fftSize=512;
      src.connect(this.analyser);
      const buf=new Float32Array(this.analyser.fftSize);
      this._levelLoop=()=>{
        if(!this.analyser) return;
        this.analyser.getFloatTimeDomainData(buf);
        let rms=0; for(let i=0;i<buf.length;i++) rms+=buf[i]*buf[i];
        rms=Math.sqrt(rms/buf.length);
        $('#recLevel').style.width=clamp(rms*700,0,100)+'%';
        this.raf=requestAnimationFrame(this._levelLoop);
      };
      this.rec.start();
      this._levelLoop();
    }catch(e){
      // P1-3：建音频图/start 失败也要回滚，避免占用麦克风与半成品状态
      toast('无法开始录音：'+(e&&e.message||e),'err');
      try{ if(this.rec.state!=='inactive') this.rec.stop(); }catch(_){ this._release(); }
      return;
    }
    this.t0=Date.now();
    $('#recBtn').classList.add('recording');
    $('#recBtn').innerHTML='<svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2.5"/></svg>';
    $('#recHint').textContent='录音中，再点一次停止';
    this.tickTimer=setInterval(()=>{
      $('#recTime').textContent=this.fmt((Date.now()-this.t0)/1000);
    },200);
  },
  /* 释放一组具体硬件资源（局部引用），幂等且不依赖 this 当前指向，
     因而停止旧会话不会误伤正在进行的新会话。 */
  _detachHardware(rec, stream, ac){
    if(rec){
      try{ if(rec.state==='recording'||rec.state==='paused') rec.stop(); }catch(e){}
    }
    if(stream){ try{ stream.getTracks().forEach(t=>t.stop()); }catch(e){} }
    if(ac){
      // close() 返回 Promise；重复关闭会 reject(InvalidStateError)，吞掉即可
      try{ const p=ac.close(); if(p&&p.catch) p.catch(()=>{}); }catch(e){}
    }
  },
  /* P1-3：统一资源释放——停定时器/电平表，并同步释放当前会话硬件，全部幂等。 */
  _release(){
    if(this.tickTimer){ clearInterval(this.tickTimer); this.tickTimer=null; }
    if(this.raf){ cancelAnimationFrame(this.raf); this.raf=null; }
    this.analyser=null;
    const { rec, stream, ac } = this;
    this._detachHardware(rec, stream, ac);
    this.rec=null; this.stream=null; this.ac=null;
  },
  stop(){
    this.lastDur=(Date.now()-this.t0)/1000;
    clearInterval(this.tickTimer); this.tickTimer=null;
    $('#recTime').textContent='00:00';
    $('#recLevel').style.width='0';
    $('#recBtn').classList.remove('recording');
    $('#recBtn').innerHTML='<svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor"><circle cx="12" cy="12" r="7"/></svg>';
    $('#recHint').textContent='点击按钮开始录音';
    // Fix-7: 停止录音时立即取消电平表 rAF 循环，避免访问已释放的 analyser 资源
    if(this.raf){ cancelAnimationFrame(this.raf); this.raf=null; }
    this.analyser=null;
    // Bug3：捕获当前会话资源后立即解绑共享引用，并同步释放硬件（不依赖异步 onstop）。
    // 之后即便用户立刻重录，新会话有独立的 rec/stream/ac，旧 onstop 只保存数据、互不干扰。
    const rec=this.rec, stream=this.stream, ac=this.ac;
    this.rec=null; this.stream=null; this.ac=null;
    this._detachHardware(rec, stream, ac);
  },
  render(){
    // P1-07 修复：列表为空时也要清空 DOM 并解除旧事件绑定——
    // V1 提前 return，删除最后一条录音后旧节点（含 <audio>）永远留在页面上。
    // 防御：删除回调里对越界索引先判空，避免极端时序下报错。
    if(!this.items.length){
      $('#recList').innerHTML='';
      $('#recList').onclick=null;
      return;
    }
    $('#recList').innerHTML=this.items.map((it,i)=>`
      <div class="rec-item">
        <div class="name">${it.name}<small>${this.fmt(it.dur)} · ${it.ext.toUpperCase()}</small></div>
        <audio controls preload="metadata" src="${it.url}"></audio>
        <a class="btn btn-sm" style="text-decoration:none" href="${it.url}" download="六弦工坊-${it.name.replace(' ','')}.${it.ext}">下载</a>
        <button class="rec-del" data-i="${i}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg></button>
      </div>`).join('');
    $('#recList').onclick=e=>{
      const b=e.target.closest('.rec-del'); if(!b)return;
      const i=+b.dataset.i;
      if(!this.items[i]) return; // P1-07：越界防御
      URL.revokeObjectURL(this.items[i].url);
      this.items.splice(i,1);
      this.render();
    };
  }
};
onRouteEnter.studio=()=>Studio.init();

window.Studio = Studio;
export { Studio };
