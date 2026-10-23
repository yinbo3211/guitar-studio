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
const CACHE = 'guitar-studio-v1.2.2'; // P2-09：发版必须递增，旧缓存在 activate 时自动清理（P1-5：补全模块图）
/* 关键资源：缺失任何一个都会导致离线白屏/瘫痪，install 失败即重试
   P1-5 修复：必须与 main.js 的静态 import 图完全一致。原清单缺
   store / theme-switch / i18n 及 4 个语言包，main.js 静态 import 它们，
   离线冷启动时模块图直接 reject → 全站白屏；tone-engine/transport/tone-loader
   同为静态 import，一并从 OPTIONAL 提升到 CORE。 */
const CORE = [
  './',
  './app.html',
  './index.html',
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
  './assets/js/modules/rhythm.js'
];
/* 次要资源：允许个别失败（如图标），不阻塞安装 */
const OPTIONAL = [
  './manifest.webmanifest',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/vendor/tone.esm.js',
  './assets/css/tokens.css',
  './assets/css/base.css',
  './assets/css/components.css',
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
