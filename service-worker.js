// Service worker network-first: siempre intenta traer la versión más nueva del
// dashboard y solo usa la copia guardada cuando no hay internet. Así no queda
// pegado a una versión vieja en cache (no hace falta navegacion oculta).

const CACHE_NAME = 'dashboard-portafolio-v2';
const FILES_TO_CACHE = [
  './dashboard.html',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(FILES_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Solo tocamos GET del mismo origen (la app). Las llamadas a GitHub/AssemblyAI/etc.
  // (otro origen, o POST/PUT) pasan directo sin que el service worker las intercepte.
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Network-first: siempre intenta la red; si funciona, actualiza la copia guardada.
  // Si no hay internet, recién ahí usa la copia.
  event.respondWith(
    fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(req))
  );
});
