/* ============================================================
   六弦工坊 V3 · 路由与页面清理 core/router
   （M3 目录重构：由 V2 app-*.js 拆分，代码体保持不变）
   ============================================================ */
'use strict';

/* ---------- 路由 ---------- */
const ROUTE_TITLES = {home:'六弦工坊',tuner:'调音器',metro:'节拍器',rhythm:'节奏型练习',game:'和弦闯关',scale:'音阶练习',chords:'和弦库',ear:'练耳训练',fret:'指板训练',studio:'录音棚',flow:'和弦转换训练',plan:'每日练习计划',stats:'练习统计中心'};
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
  // Bug5 修复：未知 hash（手输/外链拼错，如 #/foobar）无任何 .view 命中会导致主体全空白。
  // 校验是否存在对应视图，不存在则回退首页（replace 避免污染历史、且只在非法时触发）。
  if(!ROUTE_TITLES[route] || !$('#view-'+route)){
    if(route!=='home'){
      location.replace('#/home');
      return;   // hash 变为 #/home 会再次触发 hashchange → applyRoute，本次不继续
    }
  }
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
   六弦工坊 V3 · 页面清理 cleanupModules（原 app-3.js 尾部）
   （M3 目录重构：由 V2 app-*.js 拆分，代码体保持不变）
   ============================================================ */
'use strict';

/* ============================================================
   路由清理：离开页面时停止麦克风 / 计时 / 伴奏
   P1-05 修复：本函数现由 app-1.js 的 applyRoute 内部调用
   （typeof 保护，初始加载时若未定义则跳过），
   V1 在此处包装 applyRoute 因监听绑定旧引用而从不生效，已删除。
   ============================================================ */
function cleanupModules(){
  if(typeof Metro!=='undefined' && Metro.playing) Metro.stop();
  if(typeof Rhythm!=='undefined' && Rhythm.phase!=='idle') Rhythm.stop(false);
  if(typeof Tuner!=='undefined' && Tuner.active) Tuner.toggle();
  if(typeof Game!=='undefined' && Game.mic) Game.quit();
  if(typeof Scale!=='undefined' && Scale.mode!=='idle') Scale.stopAll();
  if(typeof ChordLib!=='undefined') ChordLib.stopProg();
  if(typeof Fret!=='undefined') Fret.playing=false;
  if(typeof Studio!=='undefined' && Studio.rec && Studio.rec.state==='recording') Studio.stop();
}
Object.assign(window, { ROUTE_TITLES, onRouteEnter, go, applyRoute, closeMoreSheet, cleanupModules });
export { ROUTE_TITLES, onRouteEnter, go, applyRoute, closeMoreSheet, cleanupModules };
