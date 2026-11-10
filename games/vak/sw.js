// Service Worker for Vak: The Control of Speech (PWA Offline First with Fresh Online Updates)
const CACHE_NAME = 'auro-vak-v2.18';
const CORE_SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // 1. Mandatory shell assets — must succeed
      await cache.addAll(CORE_SHELL_ASSETS);

      // 2. Optional external JSON assets (graceful fallback in standalone or subpath mode)
      try {
        const jsonRes = await fetch('./data/levels_source.json');
        if (jsonRes && jsonRes.ok) {
          await cache.put('./data/levels_source.json', jsonRes);
        }
      } catch (e) {
        // In standalone single-file bundle on GitHub Pages, JSON is embedded into index.html
      }
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          const isVakCache = key.startsWith('auro-vak-') || key.startsWith('vak-');
          if (isVakCache && key !== CACHE_NAME) {
            console.log(`[SW] Deleting obsolete cache: ${key}`);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Network-First for HTML navigation and dynamic JSON data so updates propagate instantly
  if (event.request.mode === 'navigate' || url.pathname.endsWith('.json') || url.pathname.endsWith('.html') || url.pathname.endsWith('/')) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            // Cache by clean URL without transient timestamp query string to prevent unbounded cache growth (9.1)
            const cleanUrl = url.origin + url.pathname;
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(cleanUrl, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          return caches.match(event.request).then((cached) => {
            if (cached) return cached;
            if (event.request.mode === 'navigate') {
              return caches.match('./index.html');
            }
          });
        })
    );
    return;
  }

  // Cache-First with Network Fallback for fonts, audio, static media
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        if (
          event.request.method === 'GET' &&
          networkResponse &&
          networkResponse.status === 200
        ) {
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
