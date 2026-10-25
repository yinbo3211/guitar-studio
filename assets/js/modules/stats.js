/* ============================================================
   六弦工坊 V3.1 · 模块：练习统计中心（F1）
   ------------------------------------------------------------
   统一仪表盘：今日/本周/累计卡片、7/30/90 天进步曲线、
   模块正确率对比、月度日历打卡、JSON/CSV 导出与导入。
   全部数据来自 core/practice-store，仅存本地。
   ============================================================ */
'use strict';

/* V4.0 T4：统计中心曲库分区复用曲库模块的纯函数（去重计数 / 时长 / 分层完成率） */
import { songbookStats } from './songbook.js';

const { clamp } = AudioCore;
/* i18n 取词：t 可能未挂到 window（i18n.js 以 gsI18n 暴露），这里做安全兜底 */
const T = (typeof t === 'function') ? t
  : ((k, dflt)=> (window.gsI18n && window.gsI18n.t ? window.gsI18n.t(k) : (dflt || k)));

const Stats = {
  rangeDays: 7,
  init(){
    if(this.inited) return; this.inited=true;
    if(typeof PracticeStore!=='undefined'){
      try{ PracticeStore.migrateLegacy(); }catch(_){}
    }
    const seg = $('#statsRange');
    if(seg) seg.onclick = e=>{
      const b=e.target.closest('button'); if(!b) return;
      $$('#statsRange button').forEach(x=>x.classList.toggle('on',x===b));
      this.rangeDays = +b.dataset.d || 7;
      this.renderChart();
    };
    const exp = $('#statsExport');
    if(exp) exp.onclick = ()=>this.exportJSON();
    const exps = $('#statsExportCSV');
    if(exps) exps.onclick = ()=>this.exportCSV();
    const imp = $('#statsImport');
    if(imp) imp.onchange = e=>this.importFile(e);
    const clr = $('#statsClear');
    if(clr) clr.onclick = ()=>{
      if(!confirm(T('stats.clear.confirm', '确定清空全部练习数据？此操作不可恢复。'))) return;
      PracticeStore.clearAll(); this.render(); toast('练习数据已清空','warn');
    };
    this.render();
  },
  fmtDur(ms){
    const m = Math.floor((ms||0)/60000), s = Math.floor(((ms||0)%60000)/1000);
    return m ? `${m} 分 ${s} 秒` : `${s} 秒`;
  },
  moduleName(m){
    const map = {tuner:'调音器', metro:'节拍器', rhythm:'节奏型', game:'和弦闯关',
      chords:'和弦库', scale:'音阶', ear:'练耳', fret:'指板', studio:'录音', flow:'和弦转换',
      songbook:T('nav.songbook','弹唱曲库')};   // V4.0 T4：弹唱打卡并入模块对比
    return map[m] || m;
  },
  /* V4.0 T4：弹唱曲库统计分区（已练曲目 / 累计时长 / 近 7 天 / 分层完成率） */
  renderSongbook(){
    const box = document.getElementById('statSongbookBox');
    if(!box || typeof PracticeStore === 'undefined') return;
    let sessions = [];
    try { sessions = PracticeStore.listSessions({ module:'songbook' }); }
    catch(_){ sessions = []; }
    const s = songbookStats(sessions);
    if(!s.practicedCount){
      box.innerHTML = `<div class="stat-empty">${T('songbook.stats.empty','还没有弹唱记录，去曲库挑一首开始吧')}</div>`;
      return;
    }
    const tf = (k, pairs)=>{ let x = T(k, k); for(const p in pairs) x = x.replace('{'+p+'}', pairs[p]); return x; };
    const tierRows = [1,2,3].map(t=>{
      const r = s.byTier[t] || { done:0, total:0, rate:0 };
      const pct = Math.round((r.rate||0)*100);
      return `<div class="stat-mod-row">
        <span class="stat-mod-name">${T('songbook.tier.'+t, '')}</span>
        <span class="stat-mod-bar"><i style="width:${pct}%"></i></span>
        <span class="stat-mod-val">${pct}%</span>
        <span class="stat-mod-dur">${r.done}/${r.total}</span>
      </div>`;
    }).join('');
    box.innerHTML = `
      <div class="stat-sub-title">${T('songbook.stats.title','弹唱曲库统计')}</div>
      <div class="stat-sb-grid">
        <div class="stat-sb-cell"><b>${s.practicedCount}/${s.total}</b>
          <span>${tf('songbook.stats.practiced', { done:s.practicedCount, total:s.total })}</span></div>
        <div class="stat-sb-cell"><b>${this.fmtDur(s.totalDurationMs)}</b>
          <span>${T('songbook.stats.duration','累计弹唱时长')}</span></div>
        <div class="stat-sb-cell"><b>${this.fmtDur(s.last7DaysMs)}</b>
          <span>${T('songbook.stats.last7','近 7 天时长')}</span></div>
      </div>
      <div class="stat-sub-title" style="margin-top:12px">${T('songbook.stats.tier','分层完成率')}</div>
      ${tierRows}`;
  },
  render(){
    if(typeof PracticeStore==='undefined') return;
    const tot = PracticeStore.totals();
    const st = PracticeStore.streak();
    const set = (id, v)=>{ const el=$(id); if(el) el.textContent=v; };
    set('#statTodayCount', tot.today.count);
    set('#statTodayDur', this.fmtDur(tot.today.durationMs));
    set('#statWeekCount', tot.week.count);
    set('#statWeekDur', this.fmtDur(tot.week.durationMs));
    set('#statAllCount', tot.all.count);
    set('#statAllDur', this.fmtDur(tot.all.durationMs));
    set('#statStreak', st);

    /* 模块对比 */
    const box = $('#statModules');
    if(box){
      const rows = PracticeStore.byModule();
      box.innerHTML = rows.length ? rows.map(r=>{
        const pct = r.accuracy==null ? null : Math.round(r.accuracy*100);
        return `<div class="stat-mod-row">
          <span class="stat-mod-name">${this.moduleName(r.module)}</span>
          <span class="stat-mod-bar"><i style="width:${pct==null?0:pct}%"></i></span>
          <span class="stat-mod-val">${pct==null?'—':pct+'%'}</span>
          <span class="stat-mod-dur">${this.fmtDur(r.durationMs)}</span>
        </div>`;
      }).join('') : `<div class="stat-empty">${T('stats.empty','还没有练习记录，去练一会儿吧 🎸')}</div>`;
    }
    this.renderChart();
    this.renderCalendar();
    this.renderSongbook();      // V4.0 T4：曲库分区
  },
  /* 进步曲线：轻量 SVG 手绘，不引入图表库（PRD 4.1 性能要求） */
  renderChart(){
    if(typeof PracticeStore==='undefined') return;
    const box = $('#statChart'); if(!box) return;
    const series = PracticeStore.dailySeries(this.rangeDays);
    const maxMs = Math.max(1, ...series.map(d=>d.durationMs));
    const W = 100, H = 40;                          // 视口坐标，等比缩放
    const step = series.length>1 ? W/(series.length-1) : W;
    const pts = series.map((d,i)=>[i*step, H - (d.durationMs/maxMs)*H]);
    const line = pts.map(p=>p[0].toFixed(2)+','+p[1].toFixed(2)).join(' ');
    const area = `${line} ${W},${H} 0,${H}`;
    box.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:120px;display:block">
        <defs><linearGradient id="gsChartGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--amber)" stop-opacity=".38"/>
          <stop offset="100%" stop-color="var(--amber)" stop-opacity="0"/>
        </linearGradient></defs>
        <polygon points="${area}" fill="url(#gsChartGrad)"/>
        <polyline points="${line}" fill="none" stroke="var(--amber)" stroke-width="1.2" stroke-linejoin="round"/>
      </svg>
      <div class="stat-chart-foot">
        <span>${series[0] ? series[0].date.slice(5) : ''}</span>
        <span>${T('stats.chart.hint', `过去 ${this.rangeDays} 天练习时长`)}</span>
        <span>${series.length ? series[series.length-1].date.slice(5) : ''}</span>
      </div>`;
  },
  /* 日历打卡 */
  renderCalendar(){
    if(typeof PracticeStore==='undefined') return;
    const box = $('#statCalendar'); if(!box) return;
    const now = new Date();
    const year = now.getFullYear(), month = now.getMonth();
    const first = new Date(year, month, 1);
    const startDow = first.getDay();                 // 0=周日
    const daysInMonth = new Date(year, month+1, 0).getDate();
    const series = PracticeStore.dailySeries(90);
    const byDate = {};
    series.forEach(d=>byDate[d.date]=d);
    const pad = n=>String(n).padStart(2,'0');
    let html = `<div class="stat-cal-head">${year}-${pad(month+1)}</div><div class="stat-cal-grid">`;
    ['日','一','二','三','四','五','六'].forEach(d=>html+=`<span class="stat-cal-dow">${d}</span>`);
    for(let i=0;i<startDow;i++) html+='<span class="stat-cal-cell empty"></span>';
    for(let d=1; d<=daysInMonth; d++){
      const key = `${year}-${pad(month+1)}-${pad(d)}`;
      const rec = byDate[key];
      const level = !rec || !rec.durationMs ? 0 : rec.durationMs>=900000 ? 3 : rec.durationMs>=300000 ? 2 : 1;
      html += `<span class="stat-cal-cell lv${level}" title="${key}${rec?` · ${Math.round(rec.durationMs/60000)} 分钟`:''}">${d}</span>`;
    }
    html += '</div>';
    box.innerHTML = html;
  },
  /* 导出 / 导入 */
  download(filename, text, mime){
    const blob = new Blob([text], {type: mime||'application/json;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 1000);
  },
  exportJSON(){
    this.download(`guitar-studio-practice-${new Date().toISOString().slice(0,10)}.json`, PracticeStore.exportJSON());
    toast('已导出 JSON 备份','ok');
  },
  exportCSV(){
    this.download(`guitar-studio-practice-${new Date().toISOString().slice(0,10)}.csv`, PracticeStore.exportCSV(), 'text/csv;charset=utf-8');
    toast('已导出 CSV 表格','ok');
  },
  importFile(e){
    const f = e.target.files && e.target.files[0];
    if(!f) return;
    const reader = new FileReader();
    reader.onload = ()=>{
      const r = PracticeStore.importData(String(reader.result||''));
      if(r.ok){ this.render(); toast(`已导入 ${r.added} 条练习记录`,'ok'); }
      else toast('导入失败：'+(r.msg||'格式不正确'),'err');
      e.target.value='';
    };
    reader.readAsText(f);
  }
};

onRouteEnter.stats = ()=>Stats.init();
window.Stats = Stats;
export { Stats };
