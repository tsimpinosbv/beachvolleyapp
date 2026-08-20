// Beach Volleyball Supervisor Tools — service worker
// Bump CACHE_VERSION any time app-shell files change, so clients pick up the update.
const CACHE_VERSION = 'bv-tools-v3';
const SHELL_CACHE = CACHE_VERSION + '-shell';
const DATA_CACHE = CACHE_VERSION + '-data';
const RUNTIME_CACHE = CACHE_VERSION + '-runtime';

const APP_SHELL = [
  './',
  './index.html',
  './Ranking.html',
  './PointSystem.html',
  './Prices.html',
  './Schedules.html',
  './files/',
  './files/index.html',
  './offline.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './icons/favicon-16.png'
];

const DATA_FILE = 'Ranking.xlsx';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  const keep = [SHELL_CACHE, DATA_CACHE, RUNTIME_CACHE];
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => !keep.includes(k)).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // Page navigations: network-first, fall back to cached shell, then offline page.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() =>
          caches.match(req).then((cached) => cached || caches.match('./offline.html'))
        )
    );
    return;
  }

  // The ranking workbook: network-first (fresh data), cached under a clean
  // key (no ?t= cache-busting query) so the offline fallback still matches.
  if (sameOrigin && url.pathname.endsWith(DATA_FILE)) {
    const cleanKey = new Request(url.origin + url.pathname);
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(DATA_CACHE).then((c) => c.put(cleanKey, copy));
          return res;
        })
        .catch(() => caches.match(cleanKey))
    );
    return;
  }

  // Same-origin static assets (app shell files, icons): cache-first.
  if (sameOrigin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy));
          return res;
        });
      })
    );
    return;
  }

  // Cross-origin (Google Fonts, cdnjs xlsx library): stale-while-revalidate.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
