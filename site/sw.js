// Offline support: pages come from the network when possible and from the cache when offline.
// The shared database (/api/...) is never cached.
const CACHE = 'ofek-games-v14';
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(['/', '/ofek.js', '/manifest.webmanifest', '/icons/home-180.png', '/icons/home-192.png', '/breakout/', '/breakout/manifest.webmanifest',
    '/icons/breakout-180.png', '/icons/breakout-192.png',
    '/blocks/', '/blocks/manifest.webmanifest', '/icons/blocks-180.png', '/icons/blocks-192.png',
    '/snake/', '/snake/manifest.webmanifest', '/icons/snake-180.png', '/icons/snake-192.png'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  const fromNet = fetch(req).then(r => {
    if (r && (r.ok || r.type === 'opaque')) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return r;
  });
  if (req.mode === 'navigate' || url.origin === location.origin) {   // our pages and scripts: newest version first, cache when offline
    e.respondWith(fromNet.catch(() => caches.match(req, { ignoreSearch: true })));
  } else {                                  // fonts from Google: cache first, refresh in the background
    e.respondWith(caches.match(req).then(hit => hit || fromNet));
    e.waitUntil(fromNet.catch(() => {}));
  }
});
