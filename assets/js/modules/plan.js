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

/* V4.3.1 收尾：用户可见文案统一走宿主词条（无宿主 / Node 单测回退 key） */
const T = k => { try { if(typeof window!=='undefined' && typeof window.t==='function') return window.t(k); } catch(e){} return k; };
const TF = (k,p) => { try { if(typeof window!=='undefined' && window.gsI18n && typeof window.gsI18n.tF==='function') return window.gsI18n.tF(k,p); } catch(e){} let s=T(k); for(const a of Object.keys(p||{})) s=s.split('{'+a+'}').join(String(p[a])); return s; };

const PLAN_LEVELS = {
  basic:   { label:'入门', lk:'plan.basic', minutes:15, chords:['C','G','Am','Em'], scaleBpm:60, earLevel:'basic' },
  advance: { label:'进阶', lk:'plan.advance', minutes:30, chords:['C','G','Am','F'],  scaleBpm:90, earLevel:'advance' }
};

const FOCUS = {
  chords: { label:'和弦转换', lk:'plan.focus.chords', modules:['flow','chords'] },
  rhythm: { label:'节奏型',   lk:'plan.focus.rhythm', modules:['rhythm'] },
  ear:    { label:'练耳',     lk:'plan.focus.ear',    modules:['ear'] },
  scale:  { label:'音阶',     lk:'plan.focus.scale',  modules:['scale'] }
};

function planTaskDefs(level, focus){
  const L = PLAN_LEVELS[level] || PLAN_LEVELS.basic;
  const defs = [
    { id:'tuner',  module:'tuner',  label:T('plan.task.tuner'),  desc:T('plan.task.tuner.desc'),  target:1,  unit:T('plan.unit.tuner') },
    { id:'chords', module:'flow',   label:TF('plan.task.chords',{chords:L.chords.join(' → ')}), desc:T('plan.task.chords.desc'), target:4, unit:T('plan.unit.chords') },
    { id:'rhythm', module:'rhythm', label:T('plan.task.rhythm'), desc:TF('plan.task.rhythm.desc',{bpm:L.scaleBpm}), target:4, unit:T('plan.unit.rhythm') },
    { id:'scale',  module:'scale',  label:T('plan.task.scale'),  desc:T('plan.task.scale.desc'),  target:1,  unit:T('plan.unit.scale') },
    { id:'ear',    module:'ear',    label:T('plan.task.ear'),    desc:TF('plan.task.ear.desc',{level:T(L.earLevel==='advance'?'plan.advance':'plan.basic')}), target:10, unit:T('plan.unit.ear') }
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
      if(def){ this.minutes = def.minutes; const mi=$('#planMinutes'); if(mi){ mi.value=def.minutes; const mv=$('#planMinutesVal'); if(mv) mv.textContent=def.minutes; } }
    };
    const mi = $('#planMinutes');
    if(mi) mi.oninput = ()=>{
      this.minutes = clamp(+mi.value||15, 5, 120);
      const mv=$('#planMinutesVal'); if(mv) mv.textContent=this.minutes;
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
    if(reset) reset.onclick = ()=>{ this.plan=null; this.render(); toast(T('plan.toast.reset'),'info'); };
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
    toast(T('plan.toast.generated'),'ok');
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
      // BUG-04：累计会话内的真实练习量，供「组 / 题」口径的任务判定使用
      const meta = s.meta && typeof s.meta === 'object' ? s.meta : {};
      if(Number.isFinite(meta.switches)) sum[m].switches += meta.switches;
      if(Number.isFinite(meta.questions)) sum[m].questions += meta.questions;
    });
    /* BUG-04 修复：任务文案写的是「完成 4 组和弦转换」「完成 10 题练耳」，
       而旧实现 flow / ear 都按「会话条数」计数——
         · 和弦：一整轮 4 组转换只上报 1 条会话 → 进度永远是 1/4，要练 4 轮；
         · 练耳：1 条会话（可能只有 2 题）就算完成 → 判定过松。
       改为与文案同口径：flow 取 meta.switches（组）、ear 取 meta.questions（题）。
       节奏型仍按 4 秒/小节折算时长；调音/音阶按会话次数。 */
    /* 兜底口径：模块未上报业务计数（旧数据/其它入口）时退回会话条数 */
    const bySessions = s=>s.count;
    const unitOf = {
      tuner:  s=>s.count,
      flow:   s=>s.switches>0 ? s.switches : bySessions(s),
      rhythm: s=>Math.floor(s.durationMs/4000),
      scale:  s=>s.count,
      ear:    s=>s.questions>0 ? s.questions : bySessions(s)
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
      box.innerHTML = `<div class="stat-empty">${T('plan.empty')}</div>`;
      const prog = $('#planProgress'); if(prog) prog.textContent='';
      return;
    }
    const done = p.tasks.filter(x=>x.finished).length;
    const prog = $('#planProgress');
    if(prog) prog.textContent = TF(p.completedAt?'plan.progressDone':'plan.progress',{done,total:p.tasks.length});
    /* V4.3.1：渲染一律按 task.id 现取词，不使用 localStorage 里存下的旧语言
       label/desc/unit（否则切语言后历史计划会残留中文）。done/finished 状态保留。 */
    const labelOf=(t)=>t.id==='chords'
      ? TF('plan.task.chords',{chords:(PLAN_LEVELS[p.level]||PLAN_LEVELS.basic).chords.join(' → ')})
      : T('plan.task.'+t.id);
    const descOf=(t)=>{
      const L=PLAN_LEVELS[p.level]||PLAN_LEVELS.basic;
      if(t.id==='rhythm') return TF('plan.task.rhythm.desc',{bpm:L.scaleBpm});
      if(t.id==='ear')    return TF('plan.task.ear.desc',{level:T(L.earLevel==='advance'?'plan.advance':'plan.basic')});
      return T('plan.task.'+t.id+'.desc');
    };
    const unitOf=(t)=>T('plan.unit.'+t.id);
    box.innerHTML = p.tasks.map((t,i)=>`
      <div class="plan-task ${t.finished?'finished':''}">
        <div class="plan-task-main">
          <div class="plan-task-label">${labelOf(t)}</div>
          <div class="plan-task-desc">${descOf(t)}</div>
          <div class="plan-task-bar"><i style="width:${Math.round(t.done/t.target*100)}%"></i></div>
        </div>
        <div class="plan-task-side">
          <span class="plan-task-num">${t.done}/${t.target}${unitOf(t)}</span>
          <button class="btn btn-sm plan-go" data-route="${t.module}">${T('plan.go')}</button>
        </div>
      </div>`).join('');
  },
  refreshLang(){ if(this.inited) this.render(); }
};
if(typeof document!=='undefined' && document.addEventListener){
  document.addEventListener('gs:lang',()=>Plan.refreshLang());
}
onRouteEnter.plan = ()=>Plan.init();
window.Plan = Plan;
export { Plan, PLAN_LEVELS, FOCUS, planTaskDefs };
