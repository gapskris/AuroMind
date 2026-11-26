// AuroBlocks Sanctuary Service Worker
// Version: 1.5.1 — First-visit offline bundle precaching & safe cache lifecycle
const CACHE_NAME = 'auroblocks-v1.5.1';
const BUILD_ID = 'index-B58c9Dok.js';

const PRECACHE_ASSETS = [
  './',
  './index.html',
  './icon.svg',
  './apple-touch-icon.png',
  './pwa-192x192.png',
  './pwa-512x512.png',
  './pwa-maskable-512x512.png',
  './manifest.webmanifest',
  './assets/auroblocks-init.js',
  './assets/auroblocks-sdk-bridge.js',
  './assets/artwork/hero-sacred-geometry.webp',
  './assets/artwork/mode-classic-flow.webp',
  './assets/artwork/mode-sacred-sudoku.webp',
  './assets/artwork/mode-sacred-journey.webp',
  './assets/artwork/sanctuary/level_01.jpg',
  './assets/artwork/sanctuary/level_02.jpg',
  './assets/artwork/sanctuary/level_03.jpg',
  './assets/artwork/sanctuary/level_04.jpg',
  './assets/artwork/sanctuary/level_05.jpg',
  './assets/artwork/sanctuary/level_07.jpg',
  './assets/artwork/sanctuary/level_08.jpg',
  './assets/artwork/sanctuary/level_10.jpg',
  './assets/artwork/sanctuary/level_11.jpg',
  './assets/artwork/sanctuary/level_12.jpg',
  './assets/artwork/sanctuary/level_13.jpg',
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
          let activeBundleSet = null;
          try {
            const mRes = await fetch('./precache-manifest.json', { cache: 'no-cache' });
            if (mRes && mRes.ok) {
              const mData = await mRes.json();
              if (mData && Array.isArray(mData.assets)) {
                activeBundleSet = new Set(
                  mData.assets.map((a) => new URL(a, self.location.href).href)
                );
              }
            }
          } catch {}
          await Promise.all(
            keys.map((req) => {
              try {
                const reqUrl = new URL(req.url);
                if (isViteDevModulePath(reqUrl.pathname)) {
                  return cache.delete(req);
                }
                if (
                  activeBundleSet &&
                  /\/assets\/(?:index|web)-[a-zA-Z0-9_-]+\.(?:js|css)$/i.test(reqUrl.pathname) &&
                  !activeBundleSet.has(reqUrl.origin + reqUrl.pathname)
                ) {
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

// Scope Resolution and Strict Path-Boundary Containment Helpers
function getRegistrationScope() {
  if (typeof self !== 'undefined' && self.registration && self.registration.scope) {
    try {
      return new URL(self.registration.scope, self.location.href);
    } catch {}
  }
  return new URL('./', self.location.href);
}

function isRequestInScope(requestUrl, scopeUrl) {
  // Origin boundary: cross-origin requests bypass AuroBlocks SW cache
  if (requestUrl.origin !== scopeUrl.origin) return false;

  const normalizedScope = scopeUrl.pathname.endsWith('/')
    ? scopeUrl.pathname
    : scopeUrl.pathname + '/';
  const scopeRootWithoutSlash = normalizedScope.slice(0, -1);

  // Exact match on scope root (e.g. '/games/auroblocks')
  if (requestUrl.pathname === scopeRootWithoutSlash) return true;

  // Prefix match with trailing slash boundary (e.g. '/games/auroblocks/')
  if (!requestUrl.pathname.startsWith(normalizedScope)) return false;

  // Reject any backslash characters (counter parser differentials and traversal attacks)
  if (requestUrl.pathname.includes('%5c') || requestUrl.pathname.includes('%5C')) return false;

  // Protect against encoded path traversal attacks (e.g. %2e%2e, %2f, repeated encoding)
  try {
    let decodedPath = decodeURIComponent(requestUrl.pathname);
    // Reject decoded backslashes
    if (decodedPath.includes('\\')) return false;

    // Handle repeated/nested percent-encoding (e.g. %252e%252e)
    if (decodedPath.includes('%')) {
      try {
        decodedPath = decodeURIComponent(decodedPath);
        if (decodedPath.includes('\\')) return false;
      } catch {}
    }
    if (
      decodedPath.includes('/../') ||
      decodedPath.endsWith('/..') ||
      !decodedPath.startsWith(normalizedScope)
    ) {
      const canonicalPath = new URL(decodedPath, 'https://dummy.local').pathname;
      if (
        canonicalPath !== scopeRootWithoutSlash &&
        !canonicalPath.startsWith(normalizedScope)
      ) {
        return false;
      }
    }
  } catch {
    return false;
  }

  return true;
}

// 3. Fetch Phase: Cohesive NetworkFirst for HTML / CacheFirst for versioned assets
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  const scopeUrl = getRegistrationScope();

  // Strict origin and path-boundary containment check
  if (!isRequestInScope(url, scopeUrl)) return;

  // Never intercept or cache Vite dev-server module transform or pre-bundled dependency requests
  if (isViteDevModulePath(url.pathname)) return;

  const normalizedScope = scopeUrl.pathname.endsWith('/')
    ? scopeUrl.pathname
    : scopeUrl.pathname + '/';
  const indexCacheUrl = new URL('./index.html', scopeUrl.href).href;
  const rootCacheUrl = scopeUrl.href;

  // A. Navigation requests (HTML documents):
  // NetworkFirst (bypassing HTTP disk cache) with offline cache fallback to ./index.html or ./
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(typeof Request === 'function' ? new Request(event.request, { cache: 'no-cache' }) : event.request)
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
          const cache = await caches.open(CACHE_NAME);
          const exactMatch = await cache.match(event.request);
          if (exactMatch) return exactMatch;
          const indexMatch = await cache.match(indexCacheUrl);
          if (indexMatch) return indexMatch;
          return cache.match(rootCacheUrl);
        })
    );
    return;
  }

  // B. Immutable content-hashed bundles & static media assets: CacheFirst
  const isContentHashedBundle = /\/assets\/(?:index|web)-[a-zA-Z0-9_-]{6,}\.(?:js|css)$/i.test(url.pathname);
  const isStaticOrHashed =
    isContentHashedBundle ||
    url.pathname.endsWith('.woff2') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.webp') ||
    url.pathname.endsWith('.jpg');

  if (isStaticOrHashed) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cleanHref = url.origin + url.pathname;
        const cachedResponse =
          (await cache.match(event.request)) || (await cache.match(cleanHref));
        if (cachedResponse) {
          return cachedResponse;
        }

        const networkResponse = await fetch(event.request);
        if (networkResponse && networkResponse.status === 200) {
          const copy = networkResponse.clone();
          await cache.put(cleanHref, copy);
        }
        return networkResponse;
      })()
    );
    return;
  }

  // C. Mutable unhashed assets (precache-manifest.json, init/bridge JS, manifests): NetworkFirst with offline cache fallback
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cleanHref = url.origin + url.pathname;
      try {
        const freshReq = typeof Request === 'function' ? new Request(event.request, { cache: 'no-cache' }) : event.request;
        const networkResponse = await fetch(freshReq);
        if (networkResponse && networkResponse.status === 200) {
          const copy = networkResponse.clone();
          await cache.put(cleanHref, copy);
        }
        return networkResponse;
      } catch (_err) {
        const cachedResponse =
          (await cache.match(event.request)) || (await cache.match(cleanHref));
        if (cachedResponse) {
          return cachedResponse;
        }
        return new Response('', { status: 504, statusText: 'Offline' });
      }
    })()
  );
});

// 4. Message Listener: Support safe user-triggered skipWaiting
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
