// RaatPharmacy service worker — app shell + data.
// The site works fully without it; registration failure is silent.
//
// Caching strategy, in two parts (they are different on purpose):
// - App shell (HTML/CSS/JS/images/blog): stale-while-revalidate. Serve
//   the cache instantly, refresh it in the background, so the app
//   opens fast and still updates.
// - data/pharmacies.json: NETWORK FIRST, cache fallback. The pharmacy
//   hours are the core of the app — the old handler served the cache
//   first and refreshed in the background, so the first visit after a
//   data update showed yesterday's hours. A visitor must never be
//   sent to a pharmacy on stale hours. The network fetch has a 5s
//   timeout so a stalled connection falls back to the cache instead
//   of hanging the page on its skeleton.
// WHY the version in the cache name: a service worker only picks up
// changed files when the cache name changes, so bump v6 -> v7 (and so
// on) on every release that touches a cached file, or visitors keep
// seeing the old version.
const CACHE = 'raatpharmacy-v7';
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
  'icon-512.png',
  'img/hero.webp',
  'blog/',
  'blog/index.html',
  'blog/blog.css',
  'blog/rate-khola-pharmacy-dhaka.html',
  'blog/gulshan-night-pharmacy.html',
  'blog/dhanmondi-night-pharmacy.html',
  'blog/mirpur-night-pharmacy.html',
  'blog/joruri-oshudh-rate.html',
  'blog/pharmacy-khola-ache-kina.html',
  'sitemap.xml',
  'robots.txt'
];

// Fetch with a timeout: resolves to the Response, or null on timeout /
// network failure. Used for the data file so a stalled connection
// falls back to the cache instead of hanging.
function fetchWithTimeout(request, ms) {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), ms);
    fetch(request).then(res => { clearTimeout(timer); resolve(res); })
      .catch(() => { clearTimeout(timer); resolve(null); });
  });
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      // One asset at a time, each with its own catch. The old
      // cache.addAll(ASSETS) rejected entirely if a single URL 404d
      // (e.g. a renamed blog page), and the silent .catch() then left
      // the worker active with an EMPTY cache — offline support gone
      // with no sign of it. One bad URL must not kill the rest.
      .then(cache => Promise.all(
        ASSETS.map(url => cache.add(url).catch(err => {
          console.warn('[RaatPharmacy] precache failed for', url, err);
        }))
      ))
      .then(() => self.skipWaiting())
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
  // Pharmacy data: network first (see the header comment), cache fallback.
  if (url.pathname.endsWith('/data/pharmacies.json')) {
    event.respondWith(
      fetchWithTimeout(event.request, 5000).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, copy));
          return res;
        }
        return caches.match(event.request, { ignoreSearch: true });
      })
    );
    return;
  }
  // App shell: stale-while-revalidate.
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
