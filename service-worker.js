// service-worker.js

const CACHE_NAME = 'ifrs-cache-v1';
const ASSETS = [
  '.',                    // root
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/firebase-config.js',
  './js/app.js',
  './js/ui.js',
  './assets/airports.json',
  './assets/liveries.json',
  './assets/logo.png',
  './assets/icon-192.png',
  './assets/icon-512.png'
];

self.addEventListener('install', evt => {
  evt.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .catch(err => console.warn('SW install failed:', err))
  );
});

self.addEventListener('fetch', evt => {
  evt.respondWith(
    caches.match(evt.request).then(cached => cached || fetch(evt.request))
  );
});
