// Service Worker for Vak: The Control of Speech (PWA Offline First with Fresh Online Updates)
const CACHE_NAME = 'auro-vak-v2.19';
const CORE_SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => {
        return Promise.all(
          keys.map((key) => {
            const isVakCache = key.startsWith('auro-vak-');
            if (isVakCache && key !== CACHE_NAME) {
              console.log(`[SW] Deleting obsolete cache: ${key}`);
              return caches.delete(key);
            }
          })
        );
      })
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  const scopeBase = new URL('./', self.location.href);
  if (url.origin !== self.location.origin) return;
  if (!url.href.startsWith(scopeBase.href)) return;

  // Network-First for HTML navigation and dynamic JSON data so updates propagate instantly
  if (
    event.request.mode === 'navigate' ||
    url.pathname.endsWith('.json') ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('/')
  ) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            const cleanUrl = url.origin + url.pathname;
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(cleanUrl, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(async () => {
          const cached =
            (await caches.match(event.request)) ||
            (await caches.match(url.origin + url.pathname));
          if (cached) return cached;
          if (event.request.mode === 'navigate') {
            return (
              (await caches.match(new URL('./index.html', self.location.href).href)) ||
              (await caches.match(scopeBase.href))
            );
          }
          return new Response('Offline', { status: 503, statusText: 'Offline' });
        })
    );
    return;
  }

  // Cache-First with Network Fallback for fonts, audio, static media within VAK scope
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      });
    })
  );
});
