// Service Worker for AuroMatch: Concentration Quest (PWA Offline First with Fresh Online Updates)
// Conforms strictly to AuroProject Master Policy AP-PWA-014 (Batch 2: AURO-17, AURO-18, AURO-19, AURO-34)
const CACHE_NAME = 'auro-match-v2.2';
const ARTWORK_CACHE_NAME = 'auro-match-artwork-v2.2';
const FONT_CACHE_NAME = 'auro-match-fonts-v2.2';

const GOOGLE_FONT_STYLESHEET =
  'https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700;800;900&family=Outfit:wght@300;400;500;600;700&family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400&display=swap';

// Mandatory startup shell, stylesheet, all 14 ES modules, and required icons (~2.92 MB total; excludes 208 MB optional themes/backgrounds)
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './favicon.ico',
  './styles/main.css',
  './src/main.js',
  './src/audio/synthesizer.js',
  './src/controllers/entitlementManager.js',
  './src/controllers/gameManager.js',
  './src/controllers/inputDispatcher.js',
  './src/controllers/settings.js',
  './src/controllers/storageAdapter.js',
  './src/controllers/themeManager.js',
  './src/models/boardGenerator.js',
  './src/models/floraDatabase.js',
  './src/ui/boardRenderer.js',
  './src/ui/constellation.js',
  './src/ui/particles.js',
  './src/ui/scriptureCard.js',
  './Assets/icons/logo.svg',
  './Assets/icons/favicon.svg',
  './Assets/icons/favicon.png',
  './Assets/icons/favicon-32.png',
  './Assets/icons/favicon.ico',
  './Assets/icons/apple-touch-icon.png',
  './Assets/icons/icon-192.png',
  './Assets/icons/icon-512.png',
  './Assets/icons/icon-maskable-512.png'
];

// 1x1 transparent SVG fallback for optional uncached theme/flora artwork when offline
const TRANSPARENT_SVG_FALLBACK =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" viewBox="0 0 1 1"></svg>';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const scopeUrl = self.registration ? self.registration.scope : self.location.href;
    const canonicalAssets = ASSETS_TO_CACHE.map((path) => new URL(path, scopeUrl).href);
    await cache.addAll(canonicalAssets);

    // Non-blocking warm-up of Google Fonts stylesheet and referenced woff2 binaries (AURO-34)
    try {
      const fontCache = await caches.open(FONT_CACHE_NAME);
      const cssResp = await fetch(GOOGLE_FONT_STYLESHEET, { mode: 'cors', credentials: 'omit' });
      if (cssResp && cssResp.status === 200) {
        await fontCache.put(GOOGLE_FONT_STYLESHEET, cssResp.clone());
        const cssText = await cssResp.text();
        const fontUrls = Array.from(
          new Set(cssText.match(/https:\/\/fonts\.gstatic\.com\/[^\s)'"]+/g) || [])
        );
        await Promise.allSettled(
          fontUrls.map(async (fontUrl) => {
            const fontResp = await fetch(fontUrl, { mode: 'cors', credentials: 'omit' });
            if (fontResp && (fontResp.status === 200 || fontResp.type === 'opaque')) {
              await fontCache.put(fontUrl, fontResp);
            }
          })
        );
      }
    } catch {
      // System serif/sans-serif fallbacks apply offline if initial install lacks external font connectivity
    }

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const validCaches = new Set([CACHE_NAME, ARTWORK_CACHE_NAME, FONT_CACHE_NAME]);
    await Promise.all(
      keys.map((key) => {
        const isMatchCache = key.startsWith('auro-match-');
        if (isMatchCache && !validCaches.has(key)) {
          return caches.delete(key);
        }
        return Promise.resolve();
      })
    );
    await self.clients.claim();
  })());
});

async function handleGoogleFontRequest(request, url) {
  const fontCache = await caches.open(FONT_CACHE_NAME);
  const cached = await fontCache.match(request);
  if (cached) return cached;

  try {
    const networkResponse = await fetch(request);
    if (
      networkResponse &&
      (networkResponse.status === 200 || networkResponse.type === 'opaque')
    ) {
      await fontCache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    if (url.hostname === 'fonts.googleapis.com') {
      return new Response('/* AuroMatch offline font fallback */', {
        status: 200,
        headers: {
          'Content-Type': 'text/css; charset=utf-8',
          'Cache-Control': 'no-store'
        }
      });
    }
    return Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Google Fonts runtime caching and graceful offline fallback (AURO-34)
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(handleGoogleFontRequest(request, url));
    return;
  }

  // Only intercept same-origin requests within AuroMatch's service worker scope
  if (url.origin !== self.location.origin) return;
  const scopeUrl = self.registration ? self.registration.scope : new URL('./', self.location.href).href;
  const scopePath = new URL(scopeUrl).pathname;
  if (!url.pathname.startsWith(scopePath)) return;

  // Canonical URL without version query strings (?v=4.0, ?standalone=true) to prevent cache mismatch & duplication (AURO-17)
  const cleanUrl = url.origin + url.pathname;

  // Network-First for HTML navigation, modular JS, CSS, and JSON so updates propagate online while matching cleanUrl offline (AURO-17, AURO-18)
  if (
    request.mode === 'navigate' ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('.json') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('/')
  ) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const networkResponse = await fetch(request);
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          await cache.put(cleanUrl, networkResponse.clone());
        }
        return networkResponse;
      } catch {
        const cached =
          (await cache.match(cleanUrl)) ||
          (await cache.match(request, { ignoreSearch: true })) ||
          (await cache.match(request));
        if (cached) return cached;

        if (request.mode === 'navigate') {
          const indexUrl = new URL('./index.html', scopeUrl).href;
          return (await cache.match(indexUrl)) || (await cache.match('./index.html')) || Response.error();
        }
        return Response.error();
      }
    })());
    return;
  }

  // Cache-First with on-demand runtime caching for icons, theme backgrounds, and flora artwork (AURO-19)
  event.respondWith((async () => {
    const coreCache = await caches.open(CACHE_NAME);
    const coreCached =
      (await coreCache.match(cleanUrl)) ||
      (await coreCache.match(request, { ignoreSearch: true }));
    if (coreCached) return coreCached;

    const artworkCache = await caches.open(ARTWORK_CACHE_NAME);
    const artworkCached =
      (await artworkCache.match(cleanUrl)) ||
      (await artworkCache.match(request, { ignoreSearch: true }));
    if (artworkCached) return artworkCached;

    try {
      const networkResponse = await fetch(request);
      if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
        await artworkCache.put(cleanUrl, networkResponse.clone());
      }
      return networkResponse;
    } catch {
      const isImageRequest =
        request.destination === 'image' ||
        /\.(png|jpe?g|webp|svg|gif|ico)$/i.test(url.pathname);
      if (isImageRequest) {
        return new Response(TRANSPARENT_SVG_FALLBACK, {
          status: 200,
          headers: {
            'Content-Type': 'image/svg+xml; charset=utf-8',
            'Cache-Control': 'no-store'
          }
        });
      }
      return Response.error();
    }
  })());
});

