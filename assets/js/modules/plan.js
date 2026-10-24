/* ============================================================
   六弦工坊 V3.1 · 模块：每日练习计划（F2）
   ------------------------------------------------------------
   3 步生成：选择阶段 → 每日时长 → 关注点；系统自动组合任务，
   完成条件与各模块可测指标联动（次数/时长/正确率），
   完成后回写 PracticeStore 并计入 F1 统计。
   判定边界说明：完成判定仅基于模块内可测指标（识别、命中、时长），
   不宣称对扫弦动作或整曲演奏质量的评估。
   ============================================================ */
'use strict';

const PLAN_LEVELS = {
  basic:   { label:'入门', minutes:15, chords:['C','G','Am','Em'], scaleBpm:60, earLevel:'basic' },
  advance: { label:'进阶', minutes:30, chords:['C','G','Am','F'],  scaleBpm:90, earLevel:'advance' }
};

const FOCUS = {
  chords: { label:'和弦转换', modules:['flow','chords'] },
  rhythm: { label:'节奏型',   modules:['rhythm'] },
  ear:    { label:'练耳',     modules:['ear'] },
  scale:  { label:'音阶',     modules:['scale'] }
};

function planTaskDefs(level, focus){
  const L = PLAN_LEVELS[level] || PLAN_LEVELS.basic;
  const defs = [
    { id:'tuner', module:'tuner', label:'调音检查', desc:'六弦依次调准（偏差 ±5 音分内）', target:1, unit:'次' },
    { id:'chords', module:'flow', label:`和弦转换 ${L.chords.join(' → ')}`, desc:'按节拍器提示完成 4 组和弦转换', target:4, unit:'组' },
    { id:'rhythm', module:'rhythm', label:'节奏型跟练', desc:`连续完成 4 小节（${L.scaleBpm} BPM）`, target:4, unit:'小节' },
    { id:'scale', module:'scale', label:'音阶练习', desc:'完整弹完一条音阶', target:1, unit:'遍' },
    { id:'ear', module:'ear', label:'练耳训练', desc:`完成 10 题（${L.earLevel==='advance'?'进阶':'入门'}）`, target:10, unit:'题' }
  ];
  // 关注点排序：把用户选中的关注点排到前面
  const order = (FOCUS[focus] && FOCUS[focus].modules) || [];
  return defs.sort((a,b)=>{
    const ai = order.includes(a.module) ? 0 : 1;
    const bi = order.includes(b.module) ? 0 : 1;
    return ai - bi;
  });
}

const Plan = {
  level:'basic', minutes:15, focus:'chords', plan:null,
  init(){
    if(this.inited) return; this.inited=true;
    const lv = $('#planLevel');
    if(lv) lv.onclick = e=>{
      const b=e.target.closest('button'); if(!b) return;
      $$('#planLevel button').forEach(x=>x.classList.toggle('on',x===b));
      this.level = b.dataset.lv;
      const def = PLAN_LEVELS[this.level];
      if(def){ this.minutes = def.minutes; const mi=$('#planMinutes'); if(mi){ mi.value=def.minutes; const mv=$('#planMinutesVal'); if(mv) mv.textContent=def.minutes+' 分钟'; } }
    };
    const mi = $('#planMinutes');
    if(mi) mi.oninput = ()=>{
      this.minutes = clamp(+mi.value||15, 5, 120);
      const mv=$('#planMinutesVal'); if(mv) mv.textContent=this.minutes+' 分钟';
    };
    const fo = $('#planFocus');
    if(fo) fo.onclick = e=>{
      const b=e.target.closest('button'); if(!b) return;
      $$('#planFocus button').forEach(x=>x.classList.toggle('on',x===b));
      this.focus = b.dataset.f;
    };
    const gen = $('#planGenerate');
    if(gen) gen.onclick = ()=>this.generate();
    const reset = $('#planReset');
    if(reset) reset.onclick = ()=>{ this.plan=null; this.render(); toast('已重置为模板默认值','info'); };
    this.loadToday();
    this.render();
  },
  todayKey(){ return PracticeStore ? PracticeStore.dayKey(Date.now()) : ''; },
  loadToday(){
    const key = this.todayKey();
    const saved = PracticeStore && PracticeStore.getPlan(key);
    if(saved){ this.plan = saved; this.level=saved.level||this.level; this.minutes=saved.minutes||this.minutes; this.focus=saved.focus||this.focus; }
    else this.plan = null;
  },
  /* 3 步生成首日计划 */
  generate(){
    const today = this.todayKey();
    const tasks = planTaskDefs(this.level, this.focus).map(d=>({
      id:d.id, module:d.module, label:d.label, desc:d.desc,
      target:d.target, done:0, unit:d.unit, finished:false
    }));
    this.plan = {
      date: today, level:this.level, minutes:this.minutes, focus:this.focus,
      createdAt: Date.now(), tasks
    };
    if(PracticeStore) PracticeStore.savePlan(this.plan);
    this.refreshProgress();
    this.render();
    toast('今日计划已生成，开始练琴吧 🎸','ok');
  },
  /* 依据 F1 会话数据刷新完成度（仅用可测指标：次数/时长/正确率） */
  refreshProgress(){
    if(!this.plan || typeof PracticeStore==='undefined') return;
    const start = new Date(); start.setHours(0,0,0,0);
    const sessions = PracticeStore.listSessions({ since:start.getTime() });
    const sum = {};
    sessions.forEach(s=>{
      const m = s.module;
      sum[m] = sum[m] || { count:0, durationMs:0, acc:[], switches:0, questions:0 };
      sum[m].count++;
      sum[m].durationMs += s.durationMs||0;
      // BUG-04：和弦转换按「切换次数」、练耳按「题数」累计，
      // 旧实现一律用会话条数，一轮 10 题只算 1、4 组切换只算 1，计划永远差一截
      if(s.meta && Number.isFinite(Number(s.meta.switches))) sum[m].switches += Number(s.meta.switches);
      if(s.meta && Number.isFinite(Number(s.meta.questions))) sum[m].questions += Number(s.meta.questions);
      if(Number.isFinite(s.accuracy)) sum[m].acc.push(s.accuracy);
    });
    // 时长换算：节奏型「小节」按 4 秒/小节折算；和弦转换按切换组数；练耳按题数
    const unitOf = {
      tuner:  s=>s.count,
      flow:   s=>s.switches,
      rhythm: s=>Math.floor(s.durationMs/4000),
      scale:  s=>s.count,
      ear:    s=>s.questions
    };
    this.plan.tasks.forEach(task=>{
      const s = sum[task.module];
      const v = s ? (unitOf[task.module]||(x=>x.count))(s) : 0;
      task.done = Math.min(task.target, v);
      task.finished = task.done >= task.target;
    });
    const finishedAll = this.plan.tasks.every(x=>x.finished);
    this.plan.completedAt = finishedAll ? (this.plan.completedAt || Date.now()) : null;
    if(PracticeStore) PracticeStore.savePlan(this.plan);
  },
  render(){
    this.refreshProgress();
    const box = $('#planList'); if(!box) return;
    const p = this.plan;
    if(!p){
      box.innerHTML = `<div class="stat-empty">选择阶段与时长后点击「生成今日计划」，系统会自动组合调音、和弦、节奏、音阶与练耳任务。</div>`;
      const prog = $('#planProgress'); if(prog) prog.textContent='';
      return;
    }
    const done = p.tasks.filter(x=>x.finished).length;
    const prog = $('#planProgress');
    if(prog) prog.textContent = `${done}/${p.tasks.length} 项完成${p.completedAt?' · 今日已全部完成 🎉':''}`;
    box.innerHTML = p.tasks.map((t,i)=>`
      <div class="plan-task ${t.finished?'finished':''}">
        <div class="plan-task-main">
          <div class="plan-task-label">${t.label}</div>
          <div class="plan-task-desc">${t.desc}</div>
          <div class="plan-task-bar"><i style="width:${Math.round(t.done/t.target*100)}%"></i></div>
        </div>
        <div class="plan-task-side">
          <span class="plan-task-num">${t.done}/${t.target}${t.unit}</span>
          <button class="btn btn-sm plan-go" data-route="${t.module}">去练习</button>
        </div>
      </div>`).join('');
  }
};

onRouteEnter.plan = ()=>Plan.init();
window.Plan = Plan;
export { Plan, PLAN_LEVELS, FOCUS, planTaskDefs };
