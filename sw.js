/* ============================================================
   六弦工坊 · Service Worker（V2 M1：PWA 离线缓存）
   ------------------------------------------------------------
   策略（PRD 5.2 离线能力）：
     · 预缓存核心静态资源，安装后即可离线打开；
     · 同源 GET：缓存优先，未命中走网络并回填运行时缓存；
     · /api/* 永不缓存，始终走网络（后台数据必须实时）；
     · 跨域请求直接放行（字体 CDN 等，失败由本地字体回退兜底）。
   版本升级：递增 CACHE 版本号，activate 时清理旧缓存。
   ============================================================ */
'use strict';
const CACHE = 'guitar-studio-v1.0.0';
const CORE = [
  './',
  './guitar-studio.html',
  './index.html',
  './lib/audio-core.js',
  './app-1.js',
  './app-2.js',
  './app-3.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(CORE.map(u => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // 非 GET 直接放行
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;             // 跨域（CDN 字体等）不拦截
  if (url.pathname.includes('/api/')) return;             // API 永不缓存

  e.respondWith(
    caches.match(req).then(hit => {
      if (hit) return hit;
      return fetch(req).then(res => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => hit);
    })
  );
});
