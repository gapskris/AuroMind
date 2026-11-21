/**
 * AUROMIND ROOT PORTAL SERVICE WORKER
 * Precaches the essential portal shell, caches Google Fonts with graceful offline fallback,
 * and strictly excludes /games/* routes so individual game Service Workers remain isolated.
 */

const PORTAL_CACHE_NAME = 'auro-portal-v1.1.0';
const FONT_CACHE_NAME = 'auro-portal-fonts-v1.0.0';
const CACHE_PREFIX = 'auro-portal-';

const PORTAL_SDK_ASSETS = [
  './assets/sdk/auromind-sdk.js',
  './assets/sdk/auromind-adapters.js'
];

const PORTAL_SDK_REL_PATHS = new Set([
  'assets/sdk/auromind-sdk.js',
  'assets/sdk/auromind-adapters.js'
]);

const PORTAL_SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './assets/css/portal.css',
  './assets/css/portal.css?v=2.8',
  './assets/js/portal.js',
  './assets/js/portal.js?v=3.7',
  ...PORTAL_SDK_ASSETS,
  './assets/icons/auromind-logo.svg',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/vak-logo.svg',
  './assets/icons/auromatch-logo.svg',
  './assets/icons/wordriddle-logo.svg',
  './assets/icons/vak-sanctuary-logo.svg',
  './assets/icons/auromandala-logo.svg',
  './assets/icons/auroblocks-logo.svg',
  './assets/icons/mahjong-logo.svg',
  './assets/icons/logic-logo.svg',
  './assets/icons/merge-logo.svg',
  './assets/thumbnails/vak.png',
  './assets/thumbnails/auromatch.png',
  './assets/thumbnails/wordriddle.png',
  './assets/thumbnails/vak_living_sanctuary.jpg',
  './assets/thumbnails/auromandala.jpg',
  './assets/thumbnails/auroblocks.webp',
  './assets/thumbnails/match3_puzzle.jpg',
  './assets/thumbnails/logic_riddles.png',
  './assets/thumbnails/sanctuary_merge.jpg',
  './assets/thumbnails/01_stillwater.png',
  './assets/thumbnails/02_living_terrarium.png',
  './assets/thumbnails/03_pattern_and_petal.jpg',
  './assets/thumbnails/04_the_quiet_eye.png',
  './assets/thumbnails/05_chords_of_calm.png',
  './assets/thumbnails/06_lux.jpg',
  './assets/thumbnails/07_hue_and_harmony.png',
  './assets/thumbnails/08_living_tributary.png',
  './assets/thumbnails/09_windborn.png',
  './assets/thumbnails/10_starlight_origami.png',
  './assets/thumbnails/strat_01_chronostasis.png',
  './assets/thumbnails/strat_02_the_axiomat.png',
  './assets/thumbnails/strat_03_metamorphosis.png',
  './assets/thumbnails/strat_04_the_fourfold_veil.png',
  './assets/thumbnails/strat_05_epistemic_horizons.png',
  './assets/thumbnails/strat_06_scale.png',
  './assets/thumbnails/strat_07_topos.png',
  './assets/thumbnails/strat_08_syntropy.png',
  './assets/thumbnails/strat_09_vakya.png',
  './assets/thumbnails/strat_10_equilibrium.png',
  './assets/thumbnails/strat_11_maxwell.png',
  './assets/thumbnails/strat_12_entanglement.png',
  './assets/thumbnails/strat_13_epigenesis.png',
  './assets/thumbnails/strat_14_ananta.png',
  './assets/thumbnails/strat_15_yagna.png',
  './assets/thumbnails/strat_16_pranamirror.png'
];

const PORTAL_FONT_URLS = [
  'https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&family=Cinzel:wght@600;700&display=swap'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const shellCache = await caches.open(PORTAL_CACHE_NAME);
      await shellCache.addAll(PORTAL_SHELL_ASSETS);

      // Warm Google Fonts CSS and referenced woff2 font files without failing installation if offline (AURO-34)
      try {
        const fontCache = await caches.open(FONT_CACHE_NAME);
        for (const fontUrl of PORTAL_FONT_URLS) {
          const req = new Request(fontUrl, { mode: 'cors', credentials: 'omit' });
          const res = await fetch(req);
          if (res && res.status === 200) {
            await fontCache.put(fontUrl, res.clone());
            const cssText = await res.text();
            const gstaticUrls = [
              ...new Set(cssText.match(/https:\/\/fonts\.gstatic\.com\/[^\s)'"]+/g) || [])
            ];
            await Promise.all(
              gstaticUrls.map(async (woffUrl) => {
                try {
                  const fontBinRes = await fetch(
                    new Request(woffUrl, { mode: 'cors', credentials: 'omit' })
                  );
                  if (
                    fontBinRes &&
                    (fontBinRes.status === 200 || fontBinRes.type === 'opaque')
                  ) {
                    await fontCache.put(woffUrl, fontBinRes.clone());
                  }
                } catch (_e) {}
              })
            );
          }
        }
      } catch (_err) {
        // Ignore font warm-up errors during install so offline/restricted installs never fail
      }
    })()
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter(
            (key) =>
              key.startsWith(CACHE_PREFIX) &&
              key !== PORTAL_CACHE_NAME &&
              key !== FONT_CACHE_NAME
          )
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const scopeUrl = new URL(self.registration.scope);
  const scopePath = scopeUrl.pathname;

  // 1. Google Fonts runtime caching and graceful offline fallback (AURO-34)
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(FONT_CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) {
          return cached;
        }
        try {
          const networkResponse = await fetch(request);
          if (
            networkResponse &&
            (networkResponse.status === 200 || networkResponse.type === 'opaque')
          ) {
            cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        } catch (_err) {
          if (url.hostname === 'fonts.googleapis.com') {
            return new Response('/* AuroMind offline font fallback */', {
              status: 200,
              headers: { 'Content-Type': 'text/css; charset=utf-8' }
            });
          }
          return new Response('', { status: 504, statusText: 'Offline' });
        }
      })
    );
    return;
  }

  // 2. Only handle same-origin requests within portal scope
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(scopePath)) return;

  // 3. Strictly bypass /games/* routes and requests originating from game iframes (AURO-01)
  // Note: Platform SDK assets in PORTAL_SDK_REL_PATHS remain available to game iframes when offline (B17-GAP-06)
  const relPath = url.pathname.slice(scopePath.length).replace(/^\/+/, '');
  if (
    relPath.startsWith('games/') ||
    url.pathname.includes('/games/') ||
    (!PORTAL_SDK_REL_PATHS.has(relPath) && request.referrer && request.referrer.includes('/games/'))
  ) {
    return;
  }

  // Bypass health check and internal non-portal routes (never cache docs, tests, server code, or owner-analytics)
  if (
    relPath === 'health' ||
    relPath.startsWith('phase0-audit/') ||
    relPath.startsWith('architecture-design/') ||
    relPath.startsWith('owner-analytics/') ||
    relPath === 'server.js' ||
    relPath.endsWith('.test.js') ||
    relPath.endsWith('.md')
  ) {
    return;
  }

  // 3b. Narrowly scoped Shared SDK offline caching (strictly after /games/* isolation bypass)
  if (PORTAL_SDK_REL_PATHS.has(relPath)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(PORTAL_CACHE_NAME);

        const exactMatch = await cache.match(request);
        if (exactMatch) {
          return exactMatch;
        }

        const cleanMatch = await cache.match(request, { ignoreSearch: true });
        if (cleanMatch) {
          return cleanMatch;
        }

        try {
          const networkResponse = await fetch(request);
          if (
            networkResponse &&
            networkResponse.status === 200 &&
            networkResponse.type === 'basic'
          ) {
            cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        } catch (_err) {
          return new Response('', { status: 504, statusText: 'Offline' });
        }
      })()
    );
    return;
  }

  // 4. Portal shell & asset caching (Cache-First with network fallback and query-agnostic lookup)
  event.respondWith(
    (async () => {
      const cache = await caches.open(PORTAL_CACHE_NAME);

      const exactMatch = await cache.match(request);
      if (exactMatch) {
        return exactMatch;
      }

      const cleanMatch = await cache.match(request, { ignoreSearch: true });
      if (cleanMatch) {
        return cleanMatch;
      }

      try {
        const networkResponse = await fetch(request);
        if (
          networkResponse &&
          networkResponse.status === 200 &&
          networkResponse.type === 'basic'
        ) {
          cache.put(request, networkResponse.clone());
        }
        return networkResponse;
      } catch (_err) {
        if (request.mode === 'navigate') {
          const indexUrl = new URL('./index.html', self.registration.scope).href;
          const fallbackDoc =
            (await cache.match(indexUrl)) || (await cache.match('./index.html'));
          if (fallbackDoc) {
            return fallbackDoc;
          }
        }
        return new Response('', { status: 504, statusText: 'Offline' });
      }
    })()
  );
});
