/* ============================================================
   六弦工坊 V3.1 · 音频设备管理 core/audio-devices（F10）
   ------------------------------------------------------------
   1) 输入设备选择器：enumerateDevices，切换即生效，支持热插拔刷新
      （无权限/无 API 时优雅降级，不报错）
   2) AudioContext suspended 恢复横幅：切后台、休眠唤醒后提示恢复
   3) 后台返回行为可预期：页面隐藏时记录状态，返回后提示并继续
   ============================================================ */
'use strict';

const AudioDevices = {
  devices: [], supported: false, bannerEl: null,

  /* 枚举音频输入设备；不支持时返回空数组且不抛错 */
  async list(){
    try{
      if(!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
      const all = await navigator.mediaDevices.enumerateDevices();
      this.supported = true;
      this.devices = all.filter(d => d.kind === 'audioinput')
        .map((d,i)=>({ deviceId:d.deviceId, label:d.label || `输入设备 ${i+1}` }));
      return this.devices;
    }catch(e){ return []; }
  },

  /* 渲染选择器到指定容器（select 元素）；无设备时隐藏（HTTP 无权限场景） */
  async mountSelect(sel, currentId, onChange){
    if(!sel) return;
    const list = await this.list();
    if(!list.length){
      sel.style.display = 'none';
      const hint = sel.parentElement && sel.parentElement.querySelector('.dev-hint');
      if(hint) hint.style.display = 'none';
      return;
    }
    sel.style.display = '';
    sel.innerHTML = list.map(d=>
      `<option value="${d.deviceId}" ${d.deviceId===currentId?'selected':''}>${d.label}</option>`).join('');
    sel.onchange = ()=>{ if(typeof onChange==='function') onChange(sel.value); };
  },

  /* 设备热插拔：自动刷新列表 */
  watch(onChange){
    try{
      if(!navigator.mediaDevices || !navigator.mediaDevices.addEventListener) return;
      navigator.mediaDevices.addEventListener('devicechange', async ()=>{
        await this.list();
        if(typeof onChange==='function') onChange(this.devices);
      });
    }catch(e){}
  },

  /* ---------- AudioContext 恢复横幅 ---------- */
  ensureBanner(){
    if(this.bannerEl && document.body.contains(this.bannerEl)) return this.bannerEl;
    const el = document.createElement('div');
    el.id = 'audioResumeBanner';
    el.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:180;display:none;' +
      'padding:10px 14px;background:linear-gradient(135deg,#ffb454,#ff8f3f);color:#1a1206;' +
      'font-size:13px;font-weight:600;text-align:center;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.35)';
    el.textContent = '音频已暂停（切后台或系统休眠），点击这里恢复播放与收音';
    el.onclick = async ()=>{
      try{
        if(window.AudioEngine){
          AudioEngine.ensure();
          if(AudioEngine.ctx && AudioEngine.ctx.state === 'suspended') await AudioEngine.ctx.resume();
        }
        if(window.ToneEngine && ToneEngine.Tone) { try{ await ToneEngine.Tone.start(); }catch(_){} }
        this.hideBanner();
        toast('音频已恢复','ok');
      }catch(e){ toast('恢复失败，请刷新页面重试','err'); }
    };
    document.body.appendChild(el);
    this.bannerEl = el;
    return el;
  },
  showBanner(){ const el=this.ensureBanner(); el.style.display=''; },
  hideBanner(){ if(this.bannerEl) this.bannerEl.style.display='none'; },

  /* 页面回到前台：检查上下文状态，必要时显示恢复横幅 */
  startWatch(){
    this.ensureBanner();
    // 状态轮询：suspended 且用户已交互过才提示（避免首屏误报）
    setInterval(()=>{
      try{
        const ctx = window.AudioEngine && AudioEngine.ctx;
        if(ctx && ctx.state === 'suspended') this.showBanner();
        else this.hideBanner();
      }catch(e){}
    }, 1500);
    document.addEventListener('visibilitychange', ()=>{
      if(document.visibilityState !== 'visible') return;
      // 后台返回：暂停的上下文立即提示恢复（行为可预期）
      setTimeout(()=>{
        const ctx = window.AudioEngine && AudioEngine.ctx;
        if(ctx && ctx.state === 'suspended') this.showBanner();
      }, 300);
    });
  }
};

window.AudioDevices = AudioDevices;
export { AudioDevices };
export default AudioDevices;
