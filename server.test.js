import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createApp } from './server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('Express static server serves portal, assets, and all live games', async () => {
  const app = createApp();
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  try {
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;

    const checks = [
      { path: '/', expectedContentType: 'text/html', expectedText: 'AuroMind' },
      { path: '/health', expectedContentType: 'application/json', expectedText: '"ok":true' },
      { path: '/assets/js/portal.js', expectedContentType: 'javascript', expectedText: 'initTheaterMode' },
      { path: '/assets/css/portal.css', expectedContentType: 'text/css', expectedText: '' },
      { path: '/assets/sdk/auromind-sdk.js', expectedContentType: 'javascript', expectedText: 'createAuroMindSDK' },
      { path: '/assets/sdk/auromind-adapters.js', expectedContentType: 'javascript', expectedText: 'createAdapterRegistry' },
      { path: '/games/vak/index.html', expectedContentType: 'text/html', expectedText: 'Vak' },
      { path: '/games/vak-living-sanctuary/index.html', expectedContentType: 'text/html', expectedText: 'VAK' },
      { path: '/games/auromatch/index.html', expectedContentType: 'text/html', expectedText: 'AuroMatch' },
      { path: '/games/word-riddle/index.html', expectedContentType: 'text/html', expectedText: 'Word Discovery' },
      { path: '/games/auromandala/index.html', expectedContentType: 'text/html', expectedText: 'PranaMandala' },
      { path: '/games/auroblocks/index.html', expectedContentType: 'text/html', expectedText: 'AuroBlocks' },
      { path: '/manifest.json', expectedContentType: 'application/json', expectedText: 'icon-192.png' },
      { path: '/sw.js', expectedContentType: 'javascript', expectedText: 'auro-portal-v1.2.0' },
      { path: '/assets/icons/icon-192.png', expectedContentType: 'image/png', expectedText: '' },
      { path: '/assets/icons/icon-512.png', expectedContentType: 'image/png', expectedText: '' },
      { path: '/assets/artwork/hero-sacred-geometry.webp', expectedContentType: 'image/webp', expectedText: '' }
    ];

    for (const check of checks) {
      const res = await fetch(`${baseUrl}${check.path}`);
      assert.equal(res.status, 200, `Expected 200 for ${check.path}`);
      const contentType = res.headers.get('content-type') || '';
      assert.ok(
        contentType.includes(check.expectedContentType),
        `Expected content-type ${check.expectedContentType} for ${check.path}, got ${contentType}`
      );
      if (check.expectedText) {
        const body = await res.text();
        assert.ok(body.includes(check.expectedText), `Expected ${check.path} to contain ${check.expectedText}`);
      }
    }

    const blockedPaths = [
      '/server.js',
      '/server.test.js',
      '/auromind-sdk.test.js',
      '/package.json',
      '/bun.lock',
      '/README.md',
      '/phase0-audit',
      '/phase0-audit/',
      '/phase0-audit/ARCHIVE.md',
      '/phase0-audit/AUROMIND_PHASE_0_1_NON_SUPABASE_RECONCILIATION.md',
      '/architecture-design',
      '/architecture-design/',
      '/architecture-design/TARGET_ARCHITECTURE.md',
      '/architecture-design/OPEN_DECISIONS.md',
      '/architecture-design/B0_FILE_INVENTORY.md',
      '/.gitignore',
      '/.git/HEAD',
      '/.github/workflows/pages.yml',
      '/.aistudio/config.json',
      '/.playwright-cli/page.yml',
      '/node_modules/express/package.json',
      '/non-existent-route-xyz'
    ];

    for (const blockedPath of blockedPaths) {
      const res = await fetch(`${baseUrl}${blockedPath}`);
      assert.equal(res.status, 404, `Expected 404 for blocked path ${blockedPath}, got ${res.status}`);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Portal index.html loads shared SDK ES modules in dependency order under CSP script-src self', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

  assert.ok(
    html.includes("script-src 'self'"),
    'Expected Content-Security-Policy to keep script-src self'
  );

  const adaptersTag = '<script type="module" src="assets/sdk/auromind-adapters.js"></script>';
  const sdkTag = '<script type="module" src="assets/sdk/auromind-sdk.js"></script>';
  const portalTag = '<script src="assets/js/portal.js?v=3.7"></script>';

  const adaptersIdx = html.indexOf(adaptersTag);
  const sdkIdx = html.indexOf(sdkTag);
  const portalIdx = html.indexOf(portalTag);

  assert.ok(adaptersIdx !== -1, 'index.html must load assets/sdk/auromind-adapters.js');
  assert.ok(sdkIdx !== -1, 'index.html must load assets/sdk/auromind-sdk.js');
  assert.ok(portalIdx !== -1, 'index.html must load assets/js/portal.js?v=3.7');
  assert.ok(adaptersIdx < sdkIdx, 'auromind-adapters.js must precede auromind-sdk.js');
  assert.ok(sdkIdx < portalIdx, 'auromind-sdk.js must precede portal.js');
});

function createPortalSandbox({ sdkMock, initialStorage = {}, confirmResult = true }) {
  const portalCode = fs.readFileSync(path.join(__dirname, 'assets/js/portal.js'), 'utf8');
  const storageMap = new Map(Object.entries(initialStorage));
  const localStorageMock = {
    get length() {
      return storageMap.size;
    },
    key(i) {
      return Array.from(storageMap.keys())[i] ?? null;
    },
    getItem(k) {
      return storageMap.has(k) ? storageMap.get(k) : null;
    },
    setItem(k, v) {
      storageMap.set(String(k), String(v));
    },
    removeItem(k) {
      storageMap.delete(k);
    },
    clear() {
      throw new Error('Portal Clear Cache must NEVER call localStorage.clear()');
    }
  };

  let deleteDatabaseCalls = 0;
  const indexedDBMock = {
    deleteDatabase() {
      deleteDatabaseCalls += 1;
      throw new Error('Portal Clear Cache must NEVER delete IndexedDB databases');
    }
  };

  const docListeners = new Map();
  const winListeners = new Map();

  function makeElement(id) {
    const listeners = new Map();
    return {
      id,
      value: '50',
      checked: false,
      textContent: '',
      style: {},
      classList: {
        _set: new Set(),
        add(c) { this._set.add(c); },
        remove(c) { this._set.delete(c); },
        toggle(c) {
          if (this._set.has(c)) { this._set.delete(c); return false; }
          this._set.add(c); return true;
        },
        contains(c) { return this._set.has(c); }
      },
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
      dispatch(type, eventObj = {}) {
        for (const fn of listeners.get(type) || []) {
          fn(eventObj);
        }
      },
      contains() { return false; },
      focus() {},
      setAttribute() {},
      getAttribute() { return null; }
    };
  }

  const elements = new Map([
    ['sidebar-settings-btn', makeElement('sidebar-settings-btn')],
    ['settings-modal', makeElement('settings-modal')],
    ['settings-close-btn', makeElement('settings-close-btn')],
    ['settings-confirm-btn', makeElement('settings-confirm-btn')],
    ['settings-senior-toggle', makeElement('settings-senior-toggle')],
    ['settings-motion-toggle', makeElement('settings-motion-toggle')],
    ['settings-volume-slider', makeElement('settings-volume-slider')],
    ['settings-reset-btn', makeElement('settings-reset-btn')]
  ]);

  const bodyEl = makeElement('body');
  const htmlEl = makeElement('html');
  const documentMock = {
    readyState: 'complete',
    body: bodyEl,
    documentElement: htmlEl,
    addEventListener(type, fn) {
      if (!docListeners.has(type)) docListeners.set(type, []);
      docListeners.get(type).push(fn);
    },
    getElementById(id) {
      return elements.get(id) || null;
    },
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };

  const locationMock = {
    href: 'http://localhost:3000/',
    origin: 'http://localhost:3000',
    pathname: '/',
    hash: ''
  };
  const historyMock = { pushState() {}, replaceState() {} };

  const windowMock = {
    innerWidth: 1280,
    localStorage: localStorageMock,
    indexedDB: indexedDBMock,
    location: locationMock,
    history: historyMock,
    AuroMind: sdkMock,
    addEventListener(type, fn) {
      if (!winListeners.has(type)) winListeners.set(type, []);
      winListeners.get(type).push(fn);
    },
    matchMedia() {
      return { matches: false, addEventListener() {} };
    }
  };

  const warnings = [];
  const context = vm.createContext({
    window: windowMock,
    self: windowMock,
    document: documentMock,
    localStorage: localStorageMock,
    indexedDB: indexedDBMock,
    navigator: {
      serviceWorker: {
        register: () => Promise.resolve({})
      }
    },
    history: historyMock,
    location: locationMock,
    confirm: () => confirmResult,
    setTimeout: () => 1,
    clearTimeout: () => {},
    console: {
      log() {},
      warn(...args) { warnings.push(args.join(' ')); },
      error(...args) { warnings.push(args.join(' ')); }
    }
  });

  vm.runInContext(portalCode, context, { filename: 'assets/js/portal.js' });

  return {
    window: windowMock,
    elements,
    storageMap,
    warnings,
    getDeleteDatabaseCalls: () => deleteDatabaseCalls,
    fireDOMContentLoaded() {
      for (const fn of docListeners.get('DOMContentLoaded') || []) {
        fn();
      }
    }
  };
}

test('Portal bootstrap initializes shared SDK exactly once and exposes read-only identity bridge', async () => {
  const initCalls = [];
  let adapterRegisterCalls = 0;
  let initialized = false;
  const fixedGuestId = 'guest_11111111-2222-4333-8444-555555555555';
  const identityRecord = Object.freeze({
    mode: 'guest',
    guest: Object.freeze({ id: fixedGuestId, schemaVersion: 1 }),
    account: null
  });

  const sdkMock = {
    isInitialized: () => initialized,
    init: async (opts) => {
      initCalls.push(opts);
      initialized = true;
      return { gameId: opts.gameId, identity: identityRecord };
    },
    identity: {
      get: () => (initialized ? identityRecord : null),
      getGuestId: () => (initialized ? fixedGuestId : null)
    },
    storage: {
      isProtectedKey: (k) => k === 'auromind.platform' || k.startsWith('auromind.platform.')
    },
    adapters: {
      register: () => {
        adapterRegisterCalls += 1;
      }
    }
  };

  const sandbox = createPortalSandbox({ sdkMock });

  // Fire DOMContentLoaded twice to verify duplicate bootstrap is ignored
  sandbox.fireDOMContentLoaded();
  sandbox.fireDOMContentLoaded();

  // Invoke ready() multiple times concurrently
  const [ctx1, ctx2, ctx3] = await Promise.all([
    sandbox.window.AuroMindPortal.ready(),
    sandbox.window.AuroMindPortal.ready(),
    sandbox.window.AuroMindPortal.ready()
  ]);

  assert.equal(initCalls.length, 1, 'SDK init must be invoked exactly once');
  assert.deepEqual(JSON.parse(JSON.stringify(initCalls[0])), {
    gameId: 'portal',
    appVersion: '2.5.0',
    capabilities: {
      authEnabled: true,
      cloudSyncEnabled: true,
      entitlementsEnabled: true,
      analyticsEnabled: true,
      remoteConfigEnabled: true
    },
    providers: {}
  });
  assert.equal(adapterRegisterCalls, 0, 'Portal must NOT register itself as a game adapter');
  assert.equal(sandbox.window.AuroMindPortal.getInitCount(), 1);
  assert.equal(sandbox.window.AuroMindPortal.isInitialized(), true);
  assert.equal(sandbox.window.AuroMindPortal.getGuestId(), fixedGuestId);
  assert.deepEqual(sandbox.window.AuroMindPortal.getIdentity(), identityRecord);
  assert.strictEqual(ctx1, ctx2);
  assert.strictEqual(ctx2, ctx3);
  assert.equal(Object.isFrozen(sandbox.window.AuroMindPortal), true);
});

test('Portal bootstrap handles SDK initialization failure gracefully without breaking startup', async () => {
  const sdkMock = {
    isInitialized: () => false,
    init: async () => {
      throw new Error('UNSUPPORTED_IDENTITY_VERSION');
    },
    identity: {
      get: () => null,
      getGuestId: () => null
    }
  };

  const sandbox = createPortalSandbox({ sdkMock });
  sandbox.fireDOMContentLoaded();

  const ctx = await sandbox.window.AuroMindPortal.ready();
  assert.equal(ctx, null);
  assert.equal(sandbox.window.AuroMindPortal.isInitialized(), false);
  assert.equal(sandbox.window.AuroMindPortal.getInitCount(), 1);
  assert.ok(sandbox.window.AuroMindPortal.getLastError() instanceof Error);
  assert.ok(sandbox.warnings.some((w) => w.includes('UNSUPPORTED_IDENTITY_VERSION')));
});

test('Portal Clear Cache clears portal preferences while strictly preserving guest identity and game data', async () => {
  const guestPayload = JSON.stringify({
    schemaVersion: 1,
    guestId: 'guest_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    createdAt: '2026-01-01T00:00:00.000Z'
  });

  const sdkMock = {
    isInitialized: () => true,
    init: async () => ({ gameId: 'portal' }),
    identity: {
      get: () => ({ mode: 'guest', guest: { id: 'guest_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' } }),
      getGuestId: () => 'guest_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    },
    storage: {
      isProtectedKey: (k) => k === 'auromind.platform' || k.startsWith('auromind.platform.')
    }
  };

  const sandbox = createPortalSandbox({
    sdkMock,
    initialStorage: {
      auromind_reduced_motion: 'true',
      auromind_senior_mode: 'true',
      auromind_ambient_volume: '85',
      auromind_guide_seen: 'true',
      auromind_future_pref: 'custom',
      'auromind.platform.v1.guest': guestPayload,
      'auromind.platform.future': 'protected',
      vak_save_v1: '{"level":7}',
      auromatch_garden: '{"score":1200}'
    },
    confirmResult: true
  });

  sandbox.fireDOMContentLoaded();
  await sandbox.window.AuroMindPortal.ready();

  // Trigger Clear Cache click
  sandbox.elements.get('settings-reset-btn').dispatch('click');

  // Portal preferences must be cleared
  assert.equal(sandbox.storageMap.has('auromind_reduced_motion'), false);
  assert.equal(sandbox.storageMap.has('auromind_senior_mode'), false);
  assert.equal(sandbox.storageMap.has('auromind_ambient_volume'), false);
  assert.equal(sandbox.storageMap.has('auromind_guide_seen'), false);
  assert.equal(sandbox.storageMap.has('auromind_future_pref'), false);

  // Shared platform identity and game-owned keys must remain untouched
  assert.equal(sandbox.storageMap.get('auromind.platform.v1.guest'), guestPayload);
  assert.equal(sandbox.storageMap.get('auromind.platform.future'), 'protected');
  assert.equal(sandbox.storageMap.get('vak_save_v1'), '{"level":7}');
  assert.equal(sandbox.storageMap.get('auromatch_garden'), '{"score":1200}');
  assert.equal(sandbox.getDeleteDatabaseCalls(), 0, 'IndexedDB must never be deleted by Clear Cache');
});

test('Root service worker precaches shared SDK files, serves them offline, and isolates /games/* routes', async () => {
  const swCode = fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8');

  // Verify structural ordering: /games/* bypass appears before SDK route
  const gamesBypassIdx = swCode.indexOf("relPath.startsWith('games/')");
  const sdkRouteIdx = swCode.indexOf('PORTAL_SDK_REL_PATHS.has(relPath)');
  const genericStep4Idx = swCode.indexOf('// 4. Portal shell & asset caching');
  assert.ok(gamesBypassIdx !== -1, 'sw.js must preserve /games/* bypass');
  assert.ok(sdkRouteIdx !== -1, 'sw.js must define narrowly scoped SDK route');
  assert.ok(gamesBypassIdx < sdkRouteIdx, '/games/* isolation bypass must precede SDK route');
  assert.ok(sdkRouteIdx < genericStep4Idx, 'SDK route must precede generic portal shell route');

  // In-memory CacheStorage simulation
  const cacheStore = new Map();
  // Seed a legacy cache to verify activate cleanup
  cacheStore.set('auro-portal-v1.0.0', new Map());
  cacheStore.set('auro-portal-fonts-v1.0.0', new Map());

  const scopeBase = 'http://localhost:3000/';
  const normalizeUrl = (reqOrUrl) => {
    const raw = typeof reqOrUrl === 'string' ? reqOrUrl : reqOrUrl.url;
    return new URL(raw, scopeBase).href;
  };

  function makeCacheObj(map) {
    return {
      async addAll(urls) {
        for (const u of urls) {
          const full = normalizeUrl(u);
          map.set(full, new Response(`cached:${u}`, { status: 200 }));
        }
      },
      async match(req, opts = {}) {
        const full = normalizeUrl(req);
        if (map.has(full)) return map.get(full).clone();
        if (opts.ignoreSearch) {
          const targetNoSearch = full.split('?')[0];
          for (const [k, v] of map.entries()) {
            if (k.split('?')[0] === targetNoSearch) return v.clone();
          }
        }
        return undefined;
      },
      async put(req, res) {
        map.set(normalizeUrl(req), res);
      }
    };
  }

  const cachesMock = {
    async open(name) {
      if (!cacheStore.has(name)) cacheStore.set(name, new Map());
      return makeCacheObj(cacheStore.get(name));
    },
    async keys() {
      return Array.from(cacheStore.keys());
    },
    async delete(name) {
      return cacheStore.delete(name);
    }
  };

  const listeners = new Map();
  let offline = false;
  const selfMock = {
    location: { origin: 'http://localhost:3000', href: 'http://localhost:3000/sw.js' },
    registration: { scope: scopeBase },
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    }
  };

  const context = vm.createContext({
    self: selfMock,
    caches: cachesMock,
    URL,
    Request,
    Response,
    fetch: async () => {
      if (offline) throw new Error('Simulated offline network failure');
      return new Response('', { status: 200 });
    }
  });

  vm.runInContext(swCode, context, { filename: 'sw.js' });

  // 1. Run install event and verify precache contents
  const installPromises = [];
  for (const fn of listeners.get('install') || []) {
    fn({ waitUntil: (p) => installPromises.push(p) });
  }
  await Promise.all(installPromises);

  const portalCache = cacheStore.get('auro-portal-v1.2.0');
  assert.ok(portalCache, 'Expected auro-portal-v1.2.0 cache to be created during install');
  assert.ok(
    portalCache.has('http://localhost:3000/assets/sdk/auromind-sdk.js'),
    'auromind-sdk.js must be precached'
  );
  assert.ok(
    portalCache.has('http://localhost:3000/assets/sdk/auromind-adapters.js'),
    'auromind-adapters.js must be precached'
  );
  assert.ok(
    portalCache.has('http://localhost:3000/assets/js/portal.js?v=3.7'),
    'portal.js?v=3.7 must be precached'
  );

  // 2. Run activate event and verify legacy cache cleanup
  const activatePromises = [];
  for (const fn of listeners.get('activate') || []) {
    fn({ waitUntil: (p) => activatePromises.push(p) });
  }
  await Promise.all(activatePromises);
  assert.equal(cacheStore.has('auro-portal-v1.0.0'), false, 'Legacy auro-portal-v1.0.0 cache must be evicted');
  assert.equal(cacheStore.has('auro-portal-v1.2.0'), true, 'Active auro-portal-v1.2.0 cache must remain');
  assert.equal(cacheStore.has('auro-portal-fonts-v1.0.0'), true, 'Font cache must remain');

  // 3. Go offline and dispatch fetch events
  offline = true;
  const dispatchFetch = async (url, { referrer = 'http://localhost:3000/', mode = 'cors' } = {}) => {
    let responded = false;
    let responsePromise = null;
    const event = {
      request: { method: 'GET', url, referrer, mode },
      respondWith(p) {
        responded = true;
        responsePromise = Promise.resolve(p);
      }
    };
    for (const fn of listeners.get('fetch') || []) {
      fn(event);
    }
    const response = responsePromise ? await responsePromise : null;
    return { responded, response };
  };

  // SDK files must be served from cache while offline
  const sdkRes = await dispatchFetch('http://localhost:3000/assets/sdk/auromind-sdk.js');
  assert.equal(sdkRes.responded, true);
  assert.equal(sdkRes.response.status, 200);
  assert.equal(await sdkRes.response.text(), 'cached:./assets/sdk/auromind-sdk.js');

  const adaptersRes = await dispatchFetch('http://localhost:3000/assets/sdk/auromind-adapters.js');
  assert.equal(adaptersRes.responded, true);
  assert.equal(adaptersRes.response.status, 200);
  assert.equal(await adaptersRes.response.text(), 'cached:./assets/sdk/auromind-adapters.js');

  // Query-agnostic lookup for SDK assets
  const sdkQueryRes = await dispatchFetch('http://localhost:3000/assets/sdk/auromind-sdk.js?v=1');
  assert.equal(sdkQueryRes.responded, true);
  assert.equal(sdkQueryRes.response.status, 200);

  // SDK files must be served from cache while offline, even when requested by game iframes (B17-GAP-06)
  const sdkGameReferrerRes = await dispatchFetch('http://localhost:3000/assets/sdk/auromind-sdk.js', {
    referrer: 'http://localhost:3000/games/vak/index.html'
  });
  assert.equal(sdkGameReferrerRes.responded, true);
  assert.equal(sdkGameReferrerRes.response.status, 200);
  assert.equal(await sdkGameReferrerRes.response.text(), 'cached:./assets/sdk/auromind-sdk.js');

  // /games/* routes and non-SDK game-referrer requests MUST be strictly bypassed for game SW isolation
  const gameRoutes = [
    { url: 'http://localhost:3000/games/vak/index.html', referrer: 'http://localhost:3000/' },
    { url: 'http://localhost:3000/games/auromatch/index.html', referrer: 'http://localhost:3000/' },
    { url: 'http://localhost:3000/games/auromandala/assets/index-DhYVrlzX.js', referrer: 'http://localhost:3000/games/auromandala/index.html' }
  ];
  for (const item of gameRoutes) {
    const res = await dispatchFetch(item.url, { referrer: item.referrer });
    assert.equal(
      res.responded,
      false,
      `Root SW must NOT intercept ${item.url} (referrer: ${item.referrer})`
    );
  }

  // Private docs, tests, server files, and health endpoint MUST be bypassed
  const privatePaths = [
    'http://localhost:3000/health',
    'http://localhost:3000/phase0-audit/ARCHIVE.md',
    'http://localhost:3000/architecture-design/TARGET_ARCHITECTURE.md',
    'http://localhost:3000/server.js',
    'http://localhost:3000/auromind-sdk.test.js',
    'http://localhost:3000/README.md'
  ];
  for (const url of privatePaths) {
    const res = await dispatchFetch(url);
    assert.equal(res.responded, false, `Root SW must NOT intercept non-portal route ${url}`);
  }
});

test('GitHub Pages allowlist workflow remains manual-only and verifies shared SDK files', () => {
  const workflow = fs.readFileSync(
    path.join(__dirname, '.github/workflows/pages.yml'),
    'utf8'
  );

  assert.ok(workflow.includes('workflow_dispatch:'), 'Pages workflow must retain manual workflow_dispatch trigger');
  assert.ok(!/^  push:/m.test(workflow), 'Pages workflow must NOT enable automatic push deployment');
  assert.ok(workflow.includes('"_site/assets/sdk/auromind-sdk.js"'), 'Pages workflow must verify auromind-sdk.js');
  assert.ok(workflow.includes('"_site/assets/sdk/auromind-adapters.js"'), 'Pages workflow must verify auromind-adapters.js');
  assert.ok(workflow.includes('"_site/architecture-design"'), 'Pages workflow must exclude architecture-design');
  assert.ok(workflow.includes('"_site/phase0-audit"'), 'Pages workflow must exclude phase0-audit');
});

