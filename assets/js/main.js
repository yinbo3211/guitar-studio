/* ============================================================
   六弦工坊 V3 · 应用主入口（R-ESM-04：单一模块入口）
   加载顺序与 V2 的 <script> 顺序保持一致，保证跨模块引用先定义。
   ============================================================ */
import './core/audio-core.js';
import './data/rhythm-data.js';
import './core/tone-loader.js';   // V3 M2：Tone 15 vendor 预取（本地优先）
import './core/tone-engine.js';
import './core/transport.js';
import './core/store.js';
import './core/theme-switch.js';
import './core/i18n.js';
import './core/ui.js';
import './core/audio-engine.js';
import './core/router.js';
import './data/chords.js';
import './data/scales.js';
import './modules/tuner.js';
import './modules/metronome.js';
import './modules/chord-lib.js';
import './modules/chord-game.js';
import './modules/ear-training.js';
import './modules/fretboard.js';
import './modules/scale.js';
import './modules/recorder.js';
import './modules/rhythm.js';

/* 原 app-3.js 尾部：全部模块注册完 onRouteEnter 后再执行首次路由 */
applyRoute();

/* V3 M2：后台预取 Tone（首个用户手势到来前完成网络/编译，
   Tone.start() 仍在手势内调用，符合自动播放策略） */
import('./core/tone-loader.js').then(m => m.default()).catch(() => {});
