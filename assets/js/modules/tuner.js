/* ============================================================
   六弦工坊 V3.2 · 模块 1：调音器
   ------------------------------------------------------------
   V3.2 底层重写（参考 hybridpicker/pro-tuner）：
     ① 基频检测由自相关改为 YIN（见 core/audio-core.js PitchDetect），
        RMS 硬门限 0.01 → 5e-4，灵敏度提升约 20 倍，麦克风离远也能拾取；
     ② 增加 RMS 噪声门（150ms 保持）与开麦自适应本底校准，避免放宽
        门限后被环境噪声糊一脸；
     ③ 增加跨帧跟踪器（起音检测 + 9 点中值 + proximity EMA），读数稳定
        但换弦能立刻跟上；
     ④ 删除「偏差 >60 音分就清空整个 UI」的分支——那是指针看起来卡死
        不动的直接原因（每一帧都被擦成 rotate(0)）；
     ⑤ 支持手动锁定目标弦（点弦按钮切换），进入 ±5 音分才亮绿，
        ≥8 音分才退出（滞后判定，避免临界闪烁）。
   ============================================================ */
'use strict';

const { clamp, midiFromFreq, freqFromMidi, NOTE_NAMES, NOTE_CN, noteName, noteNameNoOct, makeNoiseGate, createPitchTracker, OPEN_MIDI, tapBpm, isSubAccent, quantizeToOctave, matchFretTarget, isPitchMatch, centsBetween, pcFromName } = AudioCore;   // V3 M3：模块级解构（原 app 文件共享作用域）

/* ============================================================
   模块 1：调音器
   ============================================================ */
const Tuner = {
  mode:'guitar', a4:440, active:false, sessionStartedAt:0,
  // 标准调弦：从 6 弦（最粗）到 1 弦（最细）
  strings:[
    {n:6, midi:40, label:'E'},
    {n:5, midi:45, label:'A'},
    {n:4, midi:50, label:'D'},
    {n:3, midi:55, label:'G'},
    {n:2, midi:59, label:'B'},
    {n:1, midi:64, label:'E'}
  ],
  /* V3.2：跨帧跟踪 + 噪声门（原来只有一个 makeSmoother(4) 中位数） */
  tracker:createPitchTracker(),
  gate:makeNoiseGate('medium'),
  picked:null,          // 手动锁定的目标弦 midi（null = 自动识别最近的一根）
  inTune:false,         // 绿区滞后状态：进 ≤5¢，出 ≥8¢
  shownCents:0, inTuneCount:0, heardString:null, tunedSet:new Set(),
  lostFrames:0,
  calibFrames:[], calibDone:false,
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
    /* V3.2：点弦按钮 = ①播放该弦的标准参考音 ②锁定/解锁目标弦。
       锁定后所有判定都只针对这一根弦，不会再被邻弦抢跑；
       调准后按钮转绿（.tuned）。再点一次即解锁回到自动模式。 */
    $('#stringRow').addEventListener('click',e=>{
      const b=e.target.closest('.string-btn'); if(!b) return;
      AudioEngine.ensure();
      const midi=+b.dataset.midi;
      AudioEngine.pluck(this.freq(midi),0,2.2,.4);
      this.picked = (this.picked===midi) ? null : midi;
      this.syncPickedUI();
      $('#tunerSub').textContent = this.picked!=null
        ? ('已锁定 '+(this.strings.find(s=>s.midi===this.picked)||{}).n+'弦 · 目标 '+this.freq(this.picked).toFixed(1)+' Hz')
        : '松开锁定，自动识别最近的一根弦';
    });
    // 模式
    $('#tunerMode').addEventListener('click',e=>{
      const b=e.target.closest('button'); if(!b) return;
      $$('#tunerMode button').forEach(x=>x.classList.toggle('on',x===b));
      this.mode=b.dataset.mode;
      this.tunedSet.clear(); this.heardString=null;
      this.picked=null;
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
  /* 同步「手动锁定」的按钮高亮（不触碰 heard / tuned 的既有语义） */
  syncPickedUI(){
    $$('.string-btn').forEach(b=>b.classList.toggle('picked', this.picked!=null && +b.dataset.midi===this.picked));
  },
  /* V3.2：开麦初期自适应本底噪声（参考 pro-tuner calibrateNoiseFloor）。
     取前若干帧「安静值」的 75 分位 ×2.5 作为门限；剔除明显是弹弦的大值，
     防止用户抢先拨弦把门限抬到听不见。 */
  calibrate(rms){
    if(this.calibDone || !(rms>0)) return;
    if(rms < 0.05) this.calibFrames.push(rms);      // 过滤掉拨弦瞬态
    if(this.calibFrames.length < 20) return;
    this.calibDone = true;
    const arr = this.calibFrames.slice().sort((a,b)=>a-b);
    const p75 = arr[Math.min(arr.length-1, Math.floor(arr.length*0.75))];
    const t = Math.min(0.02, p75 * 2.5);
    if(t > 0) this.gate.setThreshold(t);
    this.calibFrames.length = 0;
  },
  async toggle(){
    AudioEngine.ensure();
    if(this.active){
      Mic.stop(); this.active=false;
      this.gate.reset(); this.tracker.reset();
      this.inTune=false; this.inTuneCount=0; this.shownCents=0;
      this.lostFrames=0; this.calibFrames.length=0; this.calibDone=false;
      this.resetUI();
      $('#tunerToggleTxt').textContent='开启麦克风调音';
      $('#tunerToggle').classList.remove('btn-danger');
      $('#tunerToggle').classList.add('btn-primary');
      return;
    }
    $('#tunerToggleTxt').textContent='正在请求麦克风(最多等10秒)…';
    const ok=await Mic.start(r=>this.onPitch(r));
    if(!ok && Mic.lastDiagnostics){
      $('#tunerSub').textContent='失败原因: '+Mic.lastDiagnostics.hint;
    }
    if(ok){
      this.active=true;
      // BUG-02：开麦成功即作为本轮调音起点，供六弦全准时统计练习时长
      this.sessionStartedAt=Date.now();
      this.tuneStartedAt=this.sessionStartedAt;
      this.gate.reset(); this.tracker.reset();
      this.inTune=false; this.inTuneCount=0; this.shownCents=0;
      this.lostFrames=0; this.calibFrames.length=0; this.calibDone=false;
      $('#tunerToggleTxt').textContent='停止调音';
      $('#tunerToggle').classList.remove('btn-primary');
      $('#tunerToggle').classList.add('btn-danger');
      $('#tunerSub').textContent='请拨响任意一根弦 · 点弦按钮可锁定目标弦';
    }else{
      $('#tunerToggleTxt').textContent='开启麦克风调音';
    }
  },
  resetUI(){
    $('#tunerNote').textContent='--';
    $('#tunerSub').textContent='点击下方按钮开启麦克风';
    $('#tunerFreq').textContent='';
    $('#tunerStatus').textContent='';
    $('#tunerStatus').style.color='';
    $('#tunerLevel').style.width='0%';
    $('#dialNeedle').style.transform='rotate(0deg)';
    $('#dialGlow').style.opacity='0';
    $('#tunerNote').style.color='';
    $$('.string-btn').forEach(b=>b.classList.remove('heard','tuned'));
  },
  /* 指针永远连续运动：无信号时缓慢回中，而不是突兀归零或冻住 */
  glideNeedle(target){
    const needle=$('#dialNeedle'); if(!needle) return;
    this.shownCents += (target - this.shownCents) * 0.35;
    needle.style.transform='rotate('+(this.shownCents*1.8)+'deg)';
  },
  onPitch(r){
    const level=$('#tunerLevel'), st=$('#tunerStatus');
    const noteEl=$('#tunerNote'), glow=$('#dialGlow');
    const rms = Number(r && r.rms) || 0;
    /* 电平条改用 sqrt 映射：小信号也能看到明显的条长变化
       （线性 ×900 时，正常弹拨长期贴顶，看不出强弱差别）。 */
    if(level) level.style.width = clamp(Math.sqrt(Math.max(0,rms))*160, 0, 100) + '%';
    this.calibrate(rms);

    let f = (r && r.freq) || null;
    const conf = Number(r && r.clarity) || 0;
    /* V3.2：放宽 YIN 灵敏度后必须靠噪声门兜住。
       这里只做「显示/不显示」的决策，不改 r.freq 语义。 */
    if(f && (!this.gate.above(rms) || conf < 0.25)) f = null;
    const t = this.tracker.push(f, rms, conf);

    if(!t){
      this.lostFrames++;
      this.inTune = false; this.inTuneCount = 0;
      if(this.lostFrames > 12){
        if(st){ st.textContent = rms > 0 ? '信号较弱，请靠近音孔再弹一次' : ''; st.style.color='var(--txt-3)'; }
        if(noteEl){ noteEl.textContent='--'; noteEl.style.color=''; }
        $('#tunerFreq').textContent='';
        if(glow) glow.style.opacity='0';
        $$('.string-btn').forEach(b=>b.classList.remove('heard'));
      }
      this.glideNeedle(0);
      return;
    }
    this.lostFrames = 0;

    // Fix-9: 检测音高统一基于当前 A4 基准（this.a4）计算 MIDI 值
    const midiFloat = 69 + 12*Math.log2(t.freq/this.a4);
    let targetMidi, cents, displayName, sub;
    if(this.mode==='guitar'){
      // V3.2：手动锁定的弦优先；未锁定时才找最接近的标准弦
      let target = null;
      if(this.picked!=null) target = this.strings.find(s=>s.midi===this.picked) || null;
      if(!target){
        let bd=99;
        this.strings.forEach(s=>{const d=Math.abs(midiFloat-s.midi); if(d<bd){bd=d; target=s;}});
      }
      // Fix-9: 目标音高按报告公式基于当前 A4 基准换算：targetMidi=69+12*log2(targetFreq/this.a4)，
      // 与 midiFloat 保持同一基准（this.freq() 本身以 this.a4 计算，故结果恒等于 target.midi）；
      // 取整以避免浮点误差破坏后续 === 比较
      const targetFreq=this.freq(target.midi);
      targetMidi=Math.round(69+12*Math.log2(targetFreq/this.a4));
      cents=(midiFloat-targetMidi)*100;
      displayName=target.label;
      this.heardString=target.n;
      sub = (this.picked!=null ? '已锁定 ' : '') + target.n+'弦 · 目标 '+(targetFreq.toFixed(1))+' Hz';
      $$('.string-btn').forEach(b=>{
        const on = (this.picked!=null) ? (+b.dataset.midi===this.picked) : (+b.dataset.midi===target.midi);
        b.classList.toggle('heard', on);
      });
    }else{
      // Fix-9: midiFloat 已基于当前 A4，直接四舍五入即为目标，两值天然同基准
      targetMidi=Math.round(midiFloat);
      cents=(midiFloat-targetMidi)*100;
      displayName=noteNameNoOct(targetMidi)+(Math.floor(targetMidi/12)-1);
      sub='半音阶';
    }

    /* V3.2 关键修复：删除「|cents| > 60 就清空整个 UI 并 return」的分支。
       旧实现在稍偏离目标弦时把指针强行 rotate(0)、音名置 '--'，
       连续帧之间互相覆盖，视觉上就是「指针纹丝不动」。
       现在：指针始终按夹紧后的偏差连续转动，文字给出真实偏差值。 */
    const shown = clamp(cents, -50, 50);
    this.glideNeedle(shown);
    noteEl.textContent = displayName;
    $('#tunerSub').textContent = sub;
    $('#tunerFreq').textContent = t.freq.toFixed(1)+' Hz';

    // 准音判定：进 ≤5¢，出 ≥8¢（参考 pro-tuner 的滞后策略，防临界闪烁）
    const absC=Math.abs(cents);
    if(!this.inTune && absC<=5) this.inTune=true;
    else if(this.inTune && absC>=8) this.inTune=false;

    if(this.inTune){
      this.inTuneCount++;
      st.textContent='准 ✓';
      st.style.color='var(--mint)';
      noteEl.style.color='var(--mint)';
      if(glow) glow.style.opacity='1';
      if(this.mode==='guitar'){
        const btn=$$('.string-btn').find(b=>+b.dataset.midi===targetMidi);
        if(btn) btn.classList.add('tuned');
        if(this.inTuneCount>8 && this.heardString){
          this.tunedSet.add(this.heardString);
          /* BUG-02 修复：六弦全部调准后上报一次练习会话。旧实现只弹 toast，
             从不写入 PracticeStore，导致每日计划里「调音检查」任务的
             refreshProgress 永远取到 0，该任务永远无法完成。 */
          if(this.tunedSet.size===6){
            toast('六根弦全部调准，开始练习吧！','ok');
            this.tunedSet.clear();
            this.reportTuned();
          }
        }
      }
    }else{
      this.inTuneCount=0;
      const flat=cents<0;
      st.textContent=flat?('偏低 '+(Math.abs(cents).toFixed(0))+' 音分'):('偏高 '+(cents.toFixed(0))+' 音分');
      st.style.color=flat?'var(--blue)':'var(--red)';
      noteEl.style.color=flat?'var(--blue)':'var(--red)';
      if(glow) glow.style.opacity='0';
      if(this.mode==='guitar'){
        const btn=$$('.string-btn').find(b=>+b.dataset.midi===targetMidi);
        if(btn) btn.classList.remove('tuned');
      }
    }
  },
  /* BUG-02：六弦全部调准 -> 上报一次 tuner 会话。
     调音无「正确率」口径，accuracy 记 null；上报后把起点前推为当前时刻，
     避免紧接着的下一轮把上一轮时长重复计入。 */
  reportTuned(){
    if(typeof PracticeStore==='undefined') return;
    const now=Date.now();
    const startedAt=this.sessionStartedAt||this.tuneStartedAt||now;
    PracticeStore.addSession({
      module:'tuner',
      startedAt,
      durationMs:Math.max(0, now-startedAt),
      accuracy:null,
      meta:{ strings:6, a4:this.a4, mode:this.mode }
    });
    this.sessionStartedAt=Date.now();
    this.tuneStartedAt=this.sessionStartedAt;
  }
};
onRouteEnter.tuner=()=>{ Tuner.init(); };

window.Tuner = Tuner;
export { Tuner };
