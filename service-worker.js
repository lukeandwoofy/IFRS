// service-worker.js
const CACHE_NAME = 'ifrs-cache-v3';
const ASSETS = [
  './', './index.html', './manifest.json',
  './css/style.css',
  './js/firebase-config.js', './js/app.js', './js/ui.js',
  './assets/airports.json', './assets/liveries.json',
  './assets/logo.png', './assets/icon-192.png', './assets/icon-512.png',
  './assets/plane-icon.png',
  './assets/sounds/ding.mp3', './assets/sounds/fire-bell.mp3', './assets/sounds/switch-click.mp3'
];
self.addEventListener('install', evt => {
  evt.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)).catch(err => console.warn('SW install skipped:', err)));
});
self.addEventListener('fetch', evt => {
  evt.respondWith(caches.match(evt.request).then(m => m || fetch(evt.request)));
});
