/* ============================================================
   六弦工坊 · Service Worker（V2 M1：PWA 离线缓存）
   ------------------------------------------------------------
   策略（PRD 5.2 离线能力）：
     · 预缓存核心静态资源；关键资源安装失败即中止（附录 4），
       避免出现「看起来装好了、离线打开缺文件」的半残缓存；
     · 同源 GET：stale-while-revalidate——立即返回缓存保证体验，
       同时后台拉取最新版回填缓存（P2-10 修复：V1 纯缓存优先，
       发版后用户要再刷两次才能拿到新代码）；
     · /api/* 永不缓存，始终走网络（后台数据必须实时）；
     · 跨域请求直接放行（字体 CDN 等，失败由本地字体回退兜底）。
   版本升级：递增 CACHE 版本号，activate 时清理旧缓存。
   ============================================================ */
'use strict';
/* C3 修复 + BUG-06 修正：缓存版本不再手工递增——安装时读取版本号
   生成缓存名（如 guitar-studio-v3.2.0），漏改版本号导致旧缓存不清理的问题
   从流程上消除；读取失败时回退到内置版本号，保证离线安装不中断。
   BUG-06：package.json 被服务端静态黑名单拦截（含依赖/脚本信息，不应公网
   暴露），SW 拉取恒为 404，缓存名永远停在 FALLBACK、发版不失效。
   因此依次尝试：version.json（只含版本号的白名单静态文件）→
   /api/v1/version（公开只读，不受初始化状态机拦截）→ package.json
   （本地静态托管兼容回退）。 */
const FALLBACK_CACHE = 'guitar-studio-v3.2.0';
let CACHE = FALLBACK_CACHE;
async function resolveCacheName(){
  const sources = ['./version.json', './api/v1/version', './package.json'];
  for(const url of sources){
    try{
      const res = await fetch(url, { cache: 'no-store' });
      if(!res.ok) continue;
      const data = await res.json();
      const v = data && typeof data.version === 'string' ? data.version : '';
      if(v) return `guitar-studio-v${v}`;
    }catch(e){ /* 换下一个来源 */ }
  }
  return FALLBACK_CACHE;
}
/* 关键资源：缺失任何一个都会导致离线白屏/瘫痪，install 失败即重试
   P1-5 修复：必须与 main.js 的静态 import 图完全一致。原清单缺
   store / theme-switch / i18n 及 4 个语言包，main.js 静态 import 它们，
   离线冷启动时模块图直接 reject → 全站白屏；tone-engine/transport/tone-loader
   同为静态 import，一并从 OPTIONAL 提升到 CORE。
   V3.1：随 F1/F2/F4/F8/F10 新增模块同步补入，否则离线冷启动同样白屏。 */
const CORE = [
  './',
  './app.html',
  './index.html',
  './version.json',   // BUG-06：缓存版本派生源，离线也需可读，缺失会回退 FALLBACK 版本名
  './assets/js/main.js',
  './assets/js/core/audio-core.js',
  './assets/js/core/tone-loader.js',
  './assets/js/core/tone-engine.js',
  './assets/js/core/transport.js',
  './assets/js/core/store.js',
  './assets/js/core/theme-switch.js',
  './assets/js/core/i18n.js',
  './assets/js/i18n/zh-CN.js',
  './assets/js/i18n/en.js',
  './assets/js/i18n/ja.js',
  './assets/js/i18n/ko.js',
  './assets/js/core/ui.js',
  './assets/js/core/router.js',
  './assets/js/core/audio-engine.js',
  './assets/js/core/mic-manager.js',   // V3.0.1：audio-engine 静态依赖
  './assets/js/data/rhythm-data.js',
  './assets/js/data/chords.js',
  './assets/js/data/scales.js',
  './assets/js/modules/tuner.js',
  './assets/js/modules/metronome.js',
  './assets/js/modules/chord-lib.js',
  './assets/js/modules/chord-game.js',
  './assets/js/modules/ear-training.js',
  './assets/js/modules/fretboard.js',
  './assets/js/modules/scale.js',
  './assets/js/modules/recorder.js',
  './assets/js/modules/rhythm.js',
  // V3.1 新增（F1 数据层 / F2 计划 / F4 和弦转换 / F8 乐理拼写 / F10 设备）
  './assets/js/core/practice-store.js',
  './assets/js/core/music-spelling.js',
  './assets/js/core/audio-devices.js',
  './assets/js/modules/plan.js',
  './assets/js/modules/stats.js',
  './assets/js/modules/chord-flow.js',
  // V4.0 新增（T1 曲库数据层 / T1+T2 曲库浏览与课程单元 / T3 弹唱练习）
  './assets/js/data/songlist-data.js',
  './assets/js/modules/songbook.js',
  './assets/js/modules/song-practice.js',
  './assets/js/modules/song-play.js',
  // V4.1：note-highway 演奏视图及其全部依赖（离线冷启动不白屏）
  './assets/js/gp/accompany.js',
  './assets/js/gp/avatar.js',
  './assets/js/gp/avatars.js',
  './assets/js/gp/backgrounds.js',
  './assets/js/gp/band.js',
  './assets/js/gp/catalog.js',
  './assets/js/gp/components.js',
  './assets/js/gp/engine.js',
  './assets/js/gp/grader.js',
  './assets/js/gp/karaoke-render.js',
  './assets/js/gp/karaoke-timeline.js',
  './assets/js/gp/notes.js',
  './assets/js/gp/parts.js',
  './assets/js/gp/pitch.js',
  './assets/js/gp/play.js',
  './assets/js/gp/player.js',
  './assets/js/gp/song-format.js',
  './assets/js/gp/songs.js',
  './assets/js/gp/state.js',
  './assets/js/gp/synth.js',
  './assets/js/gp/theory.js',
  './assets/js/gp/voices.js',
];
/* 次要资源：允许个别失败（如图标），不阻塞安装 */
const OPTIONAL = [
  './manifest.webmanifest',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-512.png',
  './assets/vendor/tone.esm.js',
  './assets/css/tokens.css',
  './assets/css/base.css',
  './assets/css/components.css',
  './assets/css/gp.css',
  './assets/css/ui-kit.css',
  './assets/css/themes/theme-neon.css',
  './assets/css/themes/theme-dawn.css',
  './assets/css/themes/theme-vintage.css',
  './assets/css/themes/theme-cyber.css',
  './assets/css/themes/theme-forest.css',
  './assets/css/themes/theme-rose.css',
  './assets/css/themes/theme-mono.css',
  './server/admin.html'
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    CACHE = await resolveCacheName();      // C3：版本名随 version.json 自动更新
    const cache = await caches.open(CACHE);
    await Promise.all(CORE.map(u => cache.add(u)));   // 关键项：任一失败则 install 失败
    await Promise.allSettled(OPTIONAL.map(u => cache.add(u))); // 次要项：尽力而为
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

/* P2-09：允许页面发送 {type:'SKIP_WAITING'} 让新 SW 立即接管 */
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // 非 GET 直接放行
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;             // 跨域（CDN 字体等）不拦截
  if (url.pathname.includes('/api/')) return;             // API 永不缓存

  /* SUG-01：缓存条目上限——只回填预缓存清单（CORE/OPTIONAL）内的资源。
     预缓存之外的同源 GET 仍然放行网络，只是不写入缓存，
     避免长期运行后缓存被任意路径（探测请求、日志页等）撑爆。 */
  const known = new Set(
    CORE.concat(OPTIONAL).map(u => new URL(u, location.origin).pathname)
  );
  const cacheable = known.has(url.pathname);

  // P2-10：stale-while-revalidate——缓存立即响应，同时后台更新
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    const refresh = fetch(req).then(res => {
      if (cacheable && res && res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    return hit || (await refresh) || Response.error();
  })());
});
