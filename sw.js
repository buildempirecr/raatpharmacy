// RaatPharmacy service worker — app shell + data, cache-first.
// The site works fully without it; registration failure is silent.
// WHY the version in the cache name: a service worker only picks up
// changed files when the cache name changes, so bump v2 -> v3 (and so
// on) on every release that touches a cached file, or visitors keep
// seeing the old version.
const CACHE = 'raatpharmacy-v3';
const ASSETS = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'data/pharmacies.json',
  'manifest.webmanifest',
  'og.png',
  'icon.svg',
  'icon-192.png',
  'icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => { /* some assets may fail offline; still activate */ })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return; // fonts etc. pass through
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then(cached => {
      const network = fetch(event.request).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, copy));
        }
        return res;
      }).catch(() => null);
      return cached || network.then(res => res || caches.match('index.html'));
    })
  );
});
