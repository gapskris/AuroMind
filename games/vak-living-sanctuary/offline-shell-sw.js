const CACHE_NAME = 'vak-offline-shell-v4';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.add(new Request('./', { cache: 'reload' })))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('vak-offline-shell-') && k !== CACHE_NAME)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'PRECACHE_URLS' && Array.isArray(event.data.urls)) {
    const scopeBase = new URL('./', self.location.href).href;
    event.waitUntil(
      caches.open(CACHE_NAME).then(async (cache) => {
        for (const rawUrl of event.data.urls) {
          try {
            if (typeof rawUrl !== 'string') continue;
            const resolved = new URL(rawUrl, self.location.href);
            if (
              resolved.href.startsWith(scopeBase) &&
              !resolved.pathname.includes('/api/') &&
              !resolved.pathname.includes('/@vite/') &&
              !resolved.pathname.includes('/src/') &&
              !resolved.pathname.includes('/node_modules/')
            ) {
              const res = await fetch(resolved.href, { cache: 'reload' });
              if (res && res.status === 200) {
                await cache.put(resolved.href, res.clone());
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
  const scopeBase = new URL('./', self.location.href);
  if (url.origin !== self.location.origin) return;
  if (!url.href.startsWith(scopeBase.href)) return;

  // Let application IndexedDB handle /api/* when offline
  if (url.pathname.includes('/api/')) return;
  if (url.pathname.includes('/@vite/') || url.pathname.includes('/src/')) return;

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
          const rootCached = await cache.match(scopeBase.href, {
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
