// BV Supervisor Tools — service worker
// Bump CACHE_VERSION any time app-shell files change, so clients pick up the update.
const CACHE_VERSION = 'bv-tools-v30';
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
  './Checklist.html',
  './Payments.html',
  './PrizeSheet.html',
  './Report.html',
  './Calendar.html',
  './tools.css',
  './word-export.js',
  './archive.js',
  './Tournament.html',
  './tournament.js',
  './calendar-data.js',
  './bv-admin.js',
  './Archive.html',
  './Odigies.html',
  './gh-publish.js',
  './ui.css',
  './icons/logo.png',
  './EntryList.html',
  './Results.html',
  './ranking-write.js',
  './vendor/exceljs.min.js',
  './Supervisor.html',
  './PoolDraw.html',
  './PoolDrawGR.html',
  './EuropeanCupStandings.html',
  './International/',
  './International/index.html',
  './vendor/xlsx.full.min.js',
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

const DATA_FILES = ['Ranking.xlsx', 'PointSystem.xlsx', 'Calendar.xlsx'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      // Αρχεία δεδομένων: από την αρχή, για να δουλεύουν και χωρίς internet
      // (αν κάποιο αποτύχει, δεν μπλοκάρει την εγκατάσταση).
      .then(() => caches.open(DATA_CACHE).then((c) => Promise.all(DATA_FILES.map((f) =>
        fetch('./' + f, { cache: 'no-store' }).then((r) => r.ok && c.put(new Request(new URL('./' + f, self.location).href), r)).catch(() => {})
      ))))
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

// Δίκτυο πρώτα· αν αργεί ή αποτύχει, ό,τι υπάρχει στην cache.
function networkFirst(req, ms, ignoreSearch) {
  const net = fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(SHELL_CACHE).then((c) => c.put(req, copy)); }
    return res;
  });
  const fromCache = () => caches.match(req, { ignoreSearch: !!ignoreSearch });
  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => { if (!done && r) { done = true; resolve(r); } };
    const timer = setTimeout(() => fromCache().then((c) => finish(c)), ms);
    net.then((r) => { clearTimeout(timer); finish(r); })
      .catch(() => { clearTimeout(timer); fromCache().then((c) => { if (c) finish(c); else net.then(finish, () => { done = true; resolve(undefined); }); }); });
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // GitHub API (δημοσίευση βαθμολογίας): ποτέ από cache.
  if (url.hostname === 'api.github.com') return;

  // Page navigations: network-first (με όριο χρόνου για αδύναμο σήμα), μετά cache, μετά offline page.
  if (req.mode === 'navigate') {
    event.respondWith(
      networkFirst(req, 6000, true).then((res) => res || caches.match('./offline.html'))
    );
    return;
  }

  // The ranking workbook: network-first (fresh data), cached under a clean
  // key (no ?t= cache-busting query) so the offline fallback still matches.
  if (sameOrigin && DATA_FILES.some((f) => url.pathname.endsWith('/' + f))) {
    const cleanKey = new Request(url.origin + url.pathname);
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(DATA_CACHE).then((c) => c.put(cleanKey, copy));
          }
          return res;
        })
        .catch(() => caches.match(cleanKey))
    );
    return;
  }

  // Κώδικας και στυλ (.js/.css): πρώτα από το δίκτυο, ώστε μια ενημέρωση να φτάνει
  // πάντα μαζί με τις σελίδες· αν δεν απαντήσει σε 4", από την cache.
  if (sameOrigin && /\.(js|css|json)$/.test(url.pathname)) {
    event.respondWith(networkFirst(req, 4000).then((r) => r || Response.error()));
    return;
  }

  // Same-origin static assets (app shell files, icons): cache-first.
  if (sameOrigin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          // Only cache genuinely successful responses — caching a 404/error
          // here would otherwise "stick" forever for cache-first assets.
          if (res.ok) {
            const copy = res.clone();
            caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy));
          }
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
          if (res.ok) {
            const copy = res.clone();
            caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
