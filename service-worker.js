// Kingdom service worker — estrategia NETWORK-FIRST
// Siempre intenta traer la version fresca desde la red.
// Solo usa la cache como respaldo si no hay conexion.
// Subi este archivo a la raiz del repo (junto a dashboard.html).

const CACHE = 'kingdom-v4';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  e.respondWith((async () => {
    try {
      const fresh = await fetch(req, { cache: 'no-store' });
      try { const cache = await caches.open(CACHE); cache.put(req, fresh.clone()); } catch (_) {}
      return fresh;
    } catch (err) {
      const cached = await caches.match(req);
      if (cached) return cached;
      throw err;
    }
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
