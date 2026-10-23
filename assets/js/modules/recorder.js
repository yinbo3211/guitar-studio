/* ============================================================
   六弦工坊 V3 · 模块 8：录音棚
   （M3 目录重构：由 V2 app-*.js 拆分，代码体保持不变）
   ============================================================ */
'use strict';

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
    // P1-08 修复：MediaRecorder 支持性检查必须先于 getUserMedia——
    // V1 先申请麦克风再检查，旧浏览器不支持时直接 return，
    // 已获取的 stream 永远不会释放，麦克风指示灯常亮（泄漏）。
    if(!window.MediaRecorder){ toast('当前浏览器不支持录音功能','err');return; }
    // P0-03 修复：HTTP 明文下 mediaDevices 为 undefined，先校验再调用
    if(typeof micGuard==='function' && !micGuard()) return;
    try{
      this.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false}});
    }catch(e){
      toast('无法访问麦克风，请检查权限','err');return;
    }
    const types=['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg'];
    let mime='';
    for(const t of types){ if(MediaRecorder.isTypeSupported(t)){mime=t;break;} }
    this.rec=mime?new MediaRecorder(this.stream,{mimeType:mime}):new MediaRecorder(this.stream);
    this.chunks=[];
    this.rec.ondataavailable=e=>{ if(e.data.size) this.chunks.push(e.data); };
    this.rec.onstop=()=>{
      const blob=new Blob(this.chunks,{type:mime||'audio/webm'});
      const url=URL.createObjectURL(blob);
      this.idx++;
      const ext=(mime.includes('mp4')?'mp4':'webm');
      const item={url,ext,dur:this.lastDur,name:'录音 '+this.idx};
      this.items.unshift(item);
      this.render();
      this.stream.getTracks().forEach(t=>t.stop());
      this.ac.close(); this.ac=null;
      cancelAnimationFrame(this.raf);
    };
    // 电平表
    this.ac=new (window.AudioContext||window.webkitAudioContext)();
    const src=this.ac.createMediaStreamSource(this.stream);
    this.analyser=this.ac.createAnalyser();
    this.analyser.fftSize=512;
    src.connect(this.analyser);
    const buf=new Float32Array(this.analyser.fftSize);
    const loop=()=>{
      if(!this.analyser) return;
      this.analyser.getFloatTimeDomainData(buf);
      let rms=0; for(let i=0;i<buf.length;i++) rms+=buf[i]*buf[i];
      rms=Math.sqrt(rms/buf.length);
      $('#recLevel').style.width=clamp(rms*700,0,100)+'%';
      this.raf=requestAnimationFrame(loop);
    };
    this.rec.start();
    loop();
    this.t0=Date.now();
    $('#recBtn').classList.add('recording');
    $('#recBtn').innerHTML='<svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2.5"/></svg>';
    $('#recHint').textContent='录音中，再点一次停止';
    this.tickTimer=setInterval(()=>{
      $('#recTime').textContent=this.fmt((Date.now()-this.t0)/1000);
    },200);
  },
  stop(){
    this.lastDur=(Date.now()-this.t0)/1000;
    clearInterval(this.tickTimer);
    $('#recTime').textContent='00:00';
    $('#recLevel').style.width='0';
    $('#recBtn').classList.remove('recording');
    $('#recBtn').innerHTML='<svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor"><circle cx="12" cy="12" r="7"/></svg>';
    $('#recHint').textContent='点击按钮开始录音';
    if(this.rec&&this.rec.state==='recording') this.rec.stop();
    // Fix-7: 停止录音时立即取消电平表 rAF 循环，避免访问已释放的 analyser 资源
    if(this.raf){ cancelAnimationFrame(this.raf); this.raf=null; }
    this.analyser=null;
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
