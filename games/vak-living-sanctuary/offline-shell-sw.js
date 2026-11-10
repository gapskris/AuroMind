const CACHE_NAME = 'vak-offline-shell-v4';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.add(new Request('/', { cache: 'reload' })))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'PRECACHE_URLS' && Array.isArray(event.data.urls)) {
    event.waitUntil(
      caches.open(CACHE_NAME).then(async (cache) => {
        for (const url of event.data.urls) {
          try {
            if (url.startsWith(self.location.origin) && !url.includes('/api/')) {
              const res = await fetch(url, { cache: 'reload' });
              if (res && res.status === 200) {
                await cache.put(url, res.clone());
              }
            }
          } catch {
            // Ignore individual precache errors
          }
        }
        if (event.ports && event.ports[0]) {
          const keys = await cache.keys();
          event.ports[0].postMessage({ type: 'PRECACHE_DONE', count: keys.length });
        }
      })
    );
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Let application IndexedDB handle /api/corpus/* when offline
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(request, { cache: 'no-cache' });
        if (response && response.status === 200) {
          await cache.put(request.url, response.clone());
        }
        return response;
      } catch {
        const exact = await cache.match(request.url, { ignoreVary: true });
        if (exact) return exact;
        const ignoreSearch = await cache.match(request.url, {
          ignoreSearch: true,
          ignoreVary: true,
        });
        if (ignoreSearch) return ignoreSearch;
        if (request.mode === 'navigate') {
          const rootCached = await cache.match(self.location.origin + '/', {
            ignoreSearch: true,
            ignoreVary: true,
          });
          if (rootCached) return rootCached;
        }
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      }
    })()
  );
});
