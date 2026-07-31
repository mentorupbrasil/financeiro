const CACHE = 'respira-v20';
const STATIC = [
  './assets/logos/icon-192.png',
  './assets/logos/icon-512.png',
  './assets/logos/apple-touch-180.png',
  './assets/logos/gestorpro-symbol.png',
  './manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(STATIC)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
    const cache = await caches.open(CACHE);
    const requests = await cache.keys();
    await Promise.all(requests.map(async (req) => {
      const url = new URL(req.url);
      if (url.pathname.startsWith('/api/') || req.headers.has('Authorization')) {
        await cache.delete(req);
      }
    }));
    await self.clients.claim();
  })());
});

function isApiRequest(request) {
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/')) return true;
  if (request.headers.has('Authorization')) return true;
  return false;
}

function isStaticAsset(request) {
  const url = new URL(request.url);
  return /\.(png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf|otf)$/i.test(url.pathname)
    || url.pathname.endsWith('manifest.webmanifest');
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  if (isApiRequest(request)) {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

  if (isStaticAsset(request)) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
        return response;
      })),
    );
    return;
  }

  // network-first for HTML/JS/CSS
  event.respondWith(
    fetch(request).then((response) => {
      if (response.ok && (request.destination === 'document' || request.destination === 'script' || request.destination === 'style' || /\.(js|css|html)$/i.test(new URL(request.url).pathname))) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    }).catch(() => caches.match(request).then((cached) => cached || caches.match('./index.html'))),
  );
});
