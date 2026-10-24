/* ============================================================
   六弦工坊 V3 · 应用主入口（R-ESM-04：单一模块入口）
   加载顺序与 V2 的 <script> 顺序保持一致，保证跨模块引用先定义。
   ============================================================ */
import './core/audio-core.js?v=3.0.1';
import './core/music-spelling.js?v=3.0.1';   // V3.1 F8：乐理拼写引擎
import './data/rhythm-data.js?v=3.0.1';
import './core/tone-loader.js?v=3.0.1';   // V3 M2：Tone 15 vendor 预取（本地优先）
import './core/tone-engine.js?v=3.0.1';
import './core/transport.js?v=3.0.1';
import './core/store.js?v=3.0.1';
import './core/practice-store.js?v=3.0.1';   // V3.1 F1：统一练习数据层
import './core/audio-devices.js?v=3.0.1';   // V3.1 F10：音频设备与恢复引导
import './core/theme-switch.js?v=3.0.1';
import './core/i18n.js?v=3.0.1';
import './core/ui.js?v=3.0.1';
import './core/audio-engine.js?v=3.0.1';
import './core/router.js?v=3.0.1';
import './data/chords.js?v=3.0.1';
import './data/scales.js?v=3.0.1';
import './modules/tuner.js?v=3.0.1';
import './modules/metronome.js?v=3.0.1';
import './modules/chord-lib.js?v=3.0.1';
import './modules/chord-game.js?v=3.0.1';
import './modules/ear-training.js?v=3.0.1';
import './modules/fretboard.js?v=3.0.1';
import './modules/scale.js?v=3.0.1';
import './modules/recorder.js?v=3.0.1';
import './modules/rhythm.js?v=3.0.1';
import './modules/chord-flow.js?v=3.0.1';    // V3.1 F4：和弦转换训练
import './modules/plan.js?v=3.0.1';          // V3.1 F2：每日练习计划
import './modules/stats.js?v=3.0.1';         // V3.1 F1：练习统计中心

/* 原 app-3.js 尾部：全部模块注册完 onRouteEnter 后再执行首次路由 */
applyRoute();

/* V3.1 F10：音频设备监听与 suspended 恢复横幅 */
if(window.AudioDevices){
  AudioDevices.startWatch();
  const mountDev = async (selId, apply)=>{
    const sel = document.getElementById(selId);
    if(!sel) return;
    const mount = async ()=> AudioDevices.mountSelect(sel, (window.Mic && Mic.deviceId) || null, apply);
    await mount();
    AudioDevices.watch(mount);
  };
  mountDev('tunerDeviceSel', id=>{
    if(window.Tuner && Tuner.active){ Tuner.toggle(); setTimeout(()=>{ Mic.start(Tuner.onPitch||(()=>{}), id); }, 260); }
    else if(window.Mic) Mic.deviceId = id;
  });
  mountDev('studioDeviceSel', id=>{ if(window.Mic) Mic.deviceId = id; });
}

/* V3 M2：后台预取 Tone（首个用户手势到来前完成网络/编译，
   Tone.start() 仍在手势内调用，符合自动播放策略） */
import('./core/tone-loader.js').then(m => m.default()).catch(() => {});
