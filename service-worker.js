/* Kingdom — Service Worker (network-first)
   Estrategia: siempre intenta la red primero (para traer la última versión
   del dashboard y los datos) y, si no hay conexión, cae a la caché.
   Si cambiás el nombre de la caché (kingdom-vX), se invalida la anterior. */

const CACHE = 'kingdom-v4';
const APP_SHELL = ['./', 'dashboard.html', 'manifest.json'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(APP_SHELL)).catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        // Guardo una copia fresca en caché para uso offline.
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req))
  );
});
