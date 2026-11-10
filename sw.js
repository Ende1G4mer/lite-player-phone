// Service worker: keeps the app's own files cached so it opens instantly and installs to the
// home screen. Spotify's API is never cached. VERSION is replaced on every publish.
const VERSION = 'v20261110-144852';
const CORE = [
  './', './index.html', './style.css', './mobile.css', './app.js', './spotify.js',
  './artist-mode.js', './icons.js', './manifest.webmanifest', './artists/index.json', './canvas.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => Promise.allSettled(CORE.map((u) => c.add(u))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const cached = await cache.match(e.request, { ignoreSearch: url.pathname.endsWith('/') });
    const fetching = fetch(e.request)
      .then((res) => { if (res.ok) cache.put(e.request, res.clone()); return res; })
      .catch(() => null);
    // Data files: newest first. Everything else: cached copy first, refreshed in the background.
    if (url.pathname.endsWith('.json') || url.pathname.endsWith('.txt')) return (await fetching) || cached || Response.error();
    return cached || (await fetching) || Response.error();
  })());
});
