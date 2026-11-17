// AuroBlocks Sanctuary Service Worker
// Version: 1.5.1 — First-visit offline bundle precaching & safe cache lifecycle
const CACHE_NAME = 'auroblocks-v1.5.1';

const PRECACHE_ASSETS = [
  './',
  './index.html',
  './icon.svg',
  './apple-touch-icon.png',
  './pwa-192x192.png',
  './pwa-512x512.png',
  './pwa-maskable-512x512.png',
  './manifest.webmanifest',
  './assets/artwork/hero-sacred-geometry.webp',
  './assets/artwork/mode-classic-flow.webp',
  './assets/artwork/mode-sacred-sudoku.webp',
  './assets/artwork/mode-sacred-journey.webp',
  './assets/fonts/cinzel-latin.woff2',
  './assets/fonts/plus-jakarta-sans-latin.woff2',
  './assets/fonts/jetbrains-mono-latin.woff2',
];

function toScopeRelative(candidate) {
  if (typeof candidate !== 'string') return null;
  const trimmed = candidate.trim();
  if (!trimmed || trimmed.startsWith('//') || /^[a-z]+:/i.test(trimmed)) {
    return null;
  }
  const clean = trimmed.split('#')[0].split('?')[0];
  if (clean.startsWith('./')) return clean;
  if (clean.startsWith('/')) return './' + clean.slice(1);
  return './' + clean;
}

function extractHtmlAssetUrls(htmlText) {
  const urls = new Set();
  const attrRegex = /(?:src|href)=["']((?:\.\/|\/)[^"'?#]+)["']/gi;
  let match;
  while ((match = attrRegex.exec(htmlText)) !== null) {
    const normalized = toScopeRelative(match[1]);
    if (normalized) {
      urls.add(normalized);
    }
  }
  return Array.from(urls);
}

// 1. Install Phase: Precache shell assets AND all hashed JS/CSS build bundles
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      const allAssetsToCache = new Set(PRECACHE_ASSETS);

      // A. Discover hashed build bundles from build-generated ./precache-manifest.json
      try {
        const manifestRes = await fetch('./precache-manifest.json', { cache: 'no-cache' });
        if (manifestRes.ok) {
          const manifestData = await manifestRes.json();
          if (manifestData && Array.isArray(manifestData.assets)) {
            for (const assetPath of manifestData.assets) {
              const normalized = toScopeRelative(assetPath);
              if (normalized) {
                allAssetsToCache.add(normalized);
              }
            }
          }
        }
      } catch {
        // Ignore in dev mode where precache-manifest.json is not emitted
      }

      // B. Also inspect ./index.html for any referenced hashed JS/CSS bundle URLs
      try {
        const indexRes = await fetch('./index.html', { cache: 'no-cache' });
        if (indexRes.ok) {
          const html = await indexRes.text();
          for (const url of extractHtmlAssetUrls(html)) {
            allAssetsToCache.add(url);
          }
        }
      } catch {
        // Ignore network errors
      }

      await Promise.allSettled(
        Array.from(allAssetsToCache).map(async (assetUrl) => {
          const resolvedUrl = new URL(assetUrl, self.location.href).href;
          const req = new Request(resolvedUrl, { cache: 'reload' });
          const res = await fetch(req);
          if (res.ok) {
            await cache.put(resolvedUrl, res);
          }
        })
      );

      await self.skipWaiting();
    })()
  );
});

function isViteDevModulePath(pathname) {
  return (
    pathname.startsWith('/node_modules/') ||
    pathname.startsWith('/src/') ||
    pathname.startsWith('/@vite/') ||
    pathname.startsWith('/@react-refresh') ||
    pathname.startsWith('/@fs/') ||
    pathname.startsWith('/@id/') ||
    pathname.endsWith('.tsx') ||
    pathname.endsWith('.ts')
  );
}

// 2. Activate Phase: Clean up previous AuroBlocks caches only (strict prefix isolation)
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames.map(async (name) => {
          if (!name.startsWith('auroblocks-')) {
            return;
          }
          if (name !== CACHE_NAME) {
            await caches.delete(name);
            return;
          }
          const cache = await caches.open(name);
          const keys = await cache.keys();
          await Promise.all(
            keys.map((req) => {
              try {
                const reqUrl = new URL(req.url);
                if (isViteDevModulePath(reqUrl.pathname)) {
                  return cache.delete(req);
                }
              } catch {
                // Ignore malformed request URLs
              }
              return Promise.resolve(false);
            })
          );
        })
      );
      await self.clients.claim();
    })()
  );
});

// 3. Fetch Phase: Cohesive NetworkFirst for HTML / CacheFirst for versioned assets
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  const scopeBase = new URL('./', self.location.href);

  // Cross-origin or out-of-scope requests bypass AuroBlocks SW cache
  if (url.origin !== self.location.origin) return;
  if (!url.href.startsWith(scopeBase.href)) return;

  // Never intercept or cache Vite dev-server module transform or pre-bundled dependency requests
  if (isViteDevModulePath(url.pathname)) return;

  const indexCacheUrl = new URL('./index.html', self.location.href).href;
  const rootCacheUrl = scopeBase.href;

  // A. Navigation requests (HTML documents):
  // NetworkFirst with offline cache fallback to ./index.html or ./
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, copy.clone());
              cache.put(indexCacheUrl, copy);
            });
          }
          return networkResponse;
        })
        .catch(async () => {
          const exactMatch = await caches.match(event.request);
          if (exactMatch) return exactMatch;
          const indexMatch = await caches.match(indexCacheUrl);
          if (indexMatch) return indexMatch;
          return caches.match(rootCacheUrl);
        })
    );
    return;
  }

  // B. Hashed or static immutable assets (./assets/*, icons): CacheFirst
  const isStaticOrHashed =
    url.pathname.startsWith(scopeBase.pathname + 'assets/') ||
    url.pathname.endsWith('.woff2') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.webp') ||
    url.pathname.endsWith('.jpg') ||
    url.pathname.endsWith('.webmanifest');

  if (isStaticOrHashed) {
    event.respondWith(
      (async () => {
        const cleanHref = url.origin + url.pathname;
        const cachedResponse =
          (await caches.match(event.request)) || (await caches.match(cleanHref));
        if (cachedResponse) {
          return cachedResponse;
        }

        const networkResponse = await fetch(event.request);
        if (networkResponse && networkResponse.status === 200) {
          const copy = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(cleanHref, copy));
        }
        return networkResponse;
      })()
    );
    return;
  }

  // C. General app assets: StaleWhileRevalidate
  event.respondWith(
    (async () => {
      const cleanHref = url.origin + url.pathname;
      const cachedResponse =
        (await caches.match(event.request)) || (await caches.match(cleanHref));
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(cleanHref, copy));
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })()
  );
});

// 4. Message Listener: Support safe user-triggered skipWaiting
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
