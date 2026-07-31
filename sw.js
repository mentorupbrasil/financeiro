const CACHE = 'respira-v4';
const ASSETS = [
  './', './index.html', './styles.css', './manifest.webmanifest',
  './assets/icon.svg', './assets/logos/gestorpro-icon.png', './assets/logos/gestorpro-symbol.png',
  './js/app.js', './js/storage.js', './js/model.js', './js/templates.js', './js/config.js', './js/sync.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      return response;
    }).catch(() => caches.match('./index.html')))
  );
});
