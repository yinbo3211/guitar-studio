/* 六弦工坊 Service Worker V3.1 · BUG-06：用 version.json 派生缓存名 */
// Cache names & core assets
let CACHE = 'guitar-studio-v3.1.0';
const FALLBACK_CACHE = 'guitar-studio-v3.1.0';

async function resolveCacheName(){
  try{
    const r = await fetch('./version.json',{cache:'no-store'});
    if(r.ok){ const info = await r.json(); if(info && info.version) return `guitar-studio-v${info.version}`; }
  }catch(e){/* ignore */}
  return FALLBACK_CACHE;
}

const CORE = [
  './',
  './index.html',
  './app.html',
  './manifest.webmanifest',
  './version.json',
  './assets/css/style.css',
  './assets/css/responsive.css',
  './assets/js/main.js',
  './assets/js/router.js',
  './assets/js/core/practice-store.js',
  './assets/js/core/music-spelling.js',
  './assets/js/core/audio-devices.js',
  './assets/js/core/chord-flow.js',
  './assets/js/core/stats.js',
  './assets/js/modules/tuner.js',
  './assets/js/modules/ear-training.js',
  './assets/js/modules/scale.js',
  './assets/js/modules/metronome.js',
  './assets/js/modules/plan.js',
  './assets/js/modules/progression.js',
  './assets/audio/metro-1.wav',
  './assets/audio/metro-2.wav',
  './assets/audio/metro-3.wav',
  './assets/audio/metro-4.wav',
  './assets/icons/icon-192.svg',
  './assets/icons/icon-512.svg'
];

const OPTIONAL = [
  './server/admin.html',
  './server/pwa.html',
  './server/manifest.webmanifest',
  './server/sw.js',
  './server/version.json',
  './server/assets/css/style.css',
  './server/assets/js/admin.js',
  './server/assets/js/pwa.js'
];

// Install
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    CACHE = await resolveCacheName();
    const cache = await caches.open(CACHE);
    // BUG-06：用缓存优先策略安装 CORE；version.json 变化时旧缓存自动淘汰
    await cache.addAll(CORE.filter(url => url !== './version.json'));
    // 先单独缓存 version.json（fetch 失败不影响安装）
    try{ await cache.add('./version.json'); }catch(err){/* ignore */}
  })());
  self.skipWaiting();
});

// Activate - clean old caches
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    CACHE = await resolveCacheName();
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k.startsWith('guitar-studio-v') && k !== CACHE).map(k => caches.delete(k))
    );
  })());
  self.clients.claim();
});

// Fetch handler - stale-while-revalidate for cached assets
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET requests to same origin
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    CACHE = await resolveCacheName();
    const cache = await caches.open(CACHE);

    // Check cache first (stale-while-revalidate for known assets)
    const cached = await cache.match(request);

    // Network fetch in background
    const fetchPromise = fetch(request)
      .then((response) => {
        // Cache successful responses for CORE assets only
        if (response.status === 200 && CORE.includes(url.pathname)) {
          cache.put(request, response.clone());
        }
        return response;
      })
      .catch(() => null);

    // Return cache if available (even if stale)
    if (cached) return cached;

    // Otherwise wait for network
    if (fetchPromise) {
      const resp = await fetchPromise;
      if (resp) return resp;
    }

    // Fallback for HTML navigation to app.html
    if (request.headers.get('Accept')?.includes('text/html')) {
      const fallback = await cache.match('./app.html');
      if (fallback) return fallback;
    }

    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  })());
});

// Background sync (where supported)
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-practice-data') {
    event.waitUntil(
      clients.matchAll({ type: 'window' }).then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'SYNC_REQUEST' });
        });
      })
    );
  }
});

// Push notifications
self.addEventListener('push', (event) => {
  if (event.data) {
    const data = event.data.json();
    event.waitUntil(
      self.registration.showNotification(data.title || '六弦工坊', {
        body: data.body || '该练习啦！',
        icon: '/assets/icons/icon-192.svg',
        badge: '/assets/icons/icon-192.svg',
        tag: 'practice-reminder',
        vibrate: [200, 100, 200]
      })
    );
  }
});

// Notification click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes('/app.html') && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('/app.html');
      }
    })
  );
});
