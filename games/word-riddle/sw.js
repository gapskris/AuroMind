const CACHE_PREFIX = 'word-discovery-';
const SHELL_CACHE = `${CACHE_PREFIX}shell-v2`;

// Mandatory offline shell and core compiled entry/vendor bundles (AURO-15)
const SHELL_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './assets/index-w4eIMPyb.css',
  './assets/index-ClQZWKJi.js',
  './assets/vendor-Bb8JjhAW.js',
  './assets/vendor-react-BohcAXVY.js',
  './assets/vendor-data-ukx0zKqE.js'
];

// Lazy/background-cached theme chunks so all 15 themes work offline (AURO-16)
const THEME_URLS = [
  './assets/theme-th01-XkqLvUYb.js',
  './assets/theme-th02-D0VYPV8R.js',
  './assets/theme-th03-C6KVbNL1.js',
  './assets/theme-th04-CLveTiae.js',
  './assets/theme-th05-CrVH4vr9.js',
  './assets/theme-th06-DddvhNS0.js',
  './assets/theme-th07-74rAY5g6.js',
  './assets/theme-th08-DsM3SUhW.js',
  './assets/theme-th09-DbCbGm8X.js',
  './assets/theme-th10-BxNXndWh.js',
  './assets/theme-th11-C3ytu1rP.js',
  './assets/theme-th12-M-goqWO1.js',
  './assets/theme-th13-CpO6qFgM.js',
  './assets/theme-th14-DxUZGTrt.js',
  './assets/theme-th15-DRqodAya.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const scopeUrl = self.registration ? self.registration.scope : self.location.href;
    const mandatoryUrls = SHELL_URLS.map((path) => new URL(path, scopeUrl).href);
    await cache.addAll(mandatoryUrls);

    // Non-failing background warm-up for all 15 theme chunks (AURO-16)
    await Promise.allSettled(
      THEME_URLS.map(async (path) => {
        const targetUrl = new URL(path, scopeUrl).href;
        const response = await fetch(targetUrl);
        if (response && response.ok) {
          await cache.put(targetUrl, response);
        }
      })
    );
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => name.startsWith(CACHE_PREFIX) && name !== SHELL_CACHE)
        .map((name) => caches.delete(name))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const scopeUrl = self.registration ? self.registration.scope : new URL('./', self.location.href).href;
  const scopePath = new URL(scopeUrl).pathname;
  if (!url.pathname.startsWith(scopePath)) return;

  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const cleanUrl = url.origin + url.pathname;

    const cached = (await cache.match(request)) || (await cache.match(cleanUrl)) || (await cache.match(request, { ignoreSearch: true }));
    if (cached) return cached;

    try {
      const response = await fetch(request);
      if (response && response.ok && response.type === 'basic') {
        await cache.put(cleanUrl, response.clone());
      }
      return response;
    } catch {
      if (request.mode === 'navigate') {
        const indexUrl = new URL('./index.html', scopeUrl).href;
        return (await cache.match(indexUrl)) || (await cache.match('./index.html')) || Response.error();
      }
      return Response.error();
    }
  })());
});

