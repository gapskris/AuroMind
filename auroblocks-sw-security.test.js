/**
 * AuroBlocks Service Worker Scope Security & Isolation Test Suite
 * 
 * Verifies origin and path-scope isolation, cache namespace sandboxing,
 * and real-browser registration & offline resilience.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// 1. Static and Structural Security Invariant Tests
// ---------------------------------------------------------------------------
describe('AuroBlocks SW Scope Security - Structural Invariants', () => {
  const swPath = path.join(__dirname, 'games/auroblocks/sw.js');
  const swCode = fs.readFileSync(swPath, 'utf8');

  test('SW defines isolated CACHE_NAME prefixed with auroblocks-', () => {
    const match = swCode.match(/const\s+CACHE_NAME\s*=\s*['"](auroblocks-[^'"]+)['"]/);
    assert.ok(match, 'Must define CACHE_NAME starting with auroblocks-');
    assert.equal(match[1], 'auroblocks-v1.5.1');
  });

  test('SW activation strictly guards cache deletions with auroblocks- prefix', () => {
    assert.ok(
      swCode.includes("!name.startsWith('auroblocks-')"),
      'Activation must ignore non-auroblocks caches'
    );
  });

  test('SW fetch handler does not call global caches.match() for reads', () => {
    // Negative assertion: caches.match( without cache.match( allows cross-cache reading
    // All read matches should be on an opened cache instance: cache.match(
    const lines = swCode.split('\n');
    const globalCachesMatchLines = lines.filter(
      (line) => line.includes('caches.match(') && !line.trim().startsWith('//')
    );
    assert.equal(
      globalCachesMatchLines.length,
      0,
      'Must not call global caches.match() in fetch handler. Must use cache.match() on CACHE_NAME.'
    );
  });

  test('SW implements strict path-boundary containment helper', () => {
    assert.ok(swCode.includes('function isRequestInScope'), 'Must define isRequestInScope');
    assert.ok(swCode.includes('normalizedScope'), 'Must normalize scope trailing slash');
  });
});

// ---------------------------------------------------------------------------
// 2. Behavioral Unit Execution of Service Worker Logic
// ---------------------------------------------------------------------------
describe('AuroBlocks SW Scope Security - Scope Resolution & Boundary Matrix', () => {
  const swPath = path.join(__dirname, 'games/auroblocks/sw.js');
  const swCode = fs.readFileSync(swPath, 'utf8');

  // Extract isRequestInScope and helper functions for direct behavioral evaluation
  function createSwScopeHarness(scopeUrlStr, selfLocationStr = 'https://portal.auromind.org/games/auroblocks/sw.js') {
    const sandbox = {
      self: {
        location: new URL(selfLocationStr),
        registration: {
          scope: scopeUrlStr,
        },
        addEventListener: () => {},
        skipWaiting: async () => {},
        clients: { claim: async () => {} },
      },
      caches: { open: async () => {}, match: async () => {}, delete: async () => {} },
      Request: class { constructor(url) { this.url = url; } },
      URL,
      decodeURIComponent,
    };
    vm.createContext(sandbox);

    const script = new vm.Script(`
      ${swCode}
      ;globalThis.isRequestInScope = isRequestInScope;
      ;globalThis.getRegistrationScope = getRegistrationScope;
    `);
    script.runInContext(sandbox);
    return sandbox;
  }

  const standardHarness = createSwScopeHarness('https://portal.auromind.org/games/auroblocks/');

  test('Same-origin in-scope requests are allowed', () => {
    const scopeUrl = standardHarness.getRegistrationScope();
    assert.equal(
      standardHarness.isRequestInScope(new URL('https://portal.auromind.org/games/auroblocks/'), scopeUrl),
      true
    );
    assert.equal(
      standardHarness.isRequestInScope(new URL('https://portal.auromind.org/games/auroblocks'), scopeUrl),
      true,
      'Scope root without trailing slash must be in-scope'
    );
    assert.equal(
      standardHarness.isRequestInScope(new URL('https://portal.auromind.org/games/auroblocks/index.html'), scopeUrl),
      true
    );
    assert.equal(
      standardHarness.isRequestInScope(new URL('https://portal.auromind.org/games/auroblocks/assets/index-BhaX7mct.js'), scopeUrl),
      true
    );
  });

  test('Cross-origin requests are strictly rejected', () => {
    const scopeUrl = standardHarness.getRegistrationScope();
    assert.equal(
      standardHarness.isRequestInScope(new URL('https://malicious.org/games/auroblocks/'), scopeUrl),
      false
    );
    assert.equal(
      standardHarness.isRequestInScope(new URL('https://evil.org/games/auroblocks/index.html'), scopeUrl),
      false
    );
  });

  test('Path-prefix collision attacks are strictly rejected', () => {
    const scopeUrl = standardHarness.getRegistrationScope();
    // Path prefix collision: string starts with /games/auroblocks but is another path
    assert.equal(
      standardHarness.isRequestInScope(new URL('https://portal.auromind.org/games/auroblocks-evil/'), scopeUrl),
      false
    );
    assert.equal(
      standardHarness.isRequestInScope(new URL('https://portal.auromind.org/games/auroblocks-evil/exploit.js'), scopeUrl),
      false
    );
    assert.equal(
      standardHarness.isRequestInScope(new URL('https://portal.auromind.org/games/auroblock'), scopeUrl),
      false
    );
    assert.equal(
      standardHarness.isRequestInScope(new URL('https://portal.auromind.org/games/auroblocks_backup/index.html'), scopeUrl),
      false
    );
  });

  test('Sibling game and parent portal requests are strictly rejected', () => {
    const scopeUrl = standardHarness.getRegistrationScope();
    // Sibling games
    assert.equal(
      standardHarness.isRequestInScope(new URL('https://portal.auromind.org/games/auromatch/index.html'), scopeUrl),
      false
    );
    assert.equal(
      standardHarness.isRequestInScope(new URL('https://portal.auromind.org/games/vak/'), scopeUrl),
      false
    );
    assert.equal(
      standardHarness.isRequestInScope(new URL('https://portal.auromind.org/games/word-riddle/sw.js'), scopeUrl),
      false
    );
    // Parent portal
    assert.equal(
      standardHarness.isRequestInScope(new URL('https://portal.auromind.org/'), scopeUrl),
      false
    );
    assert.equal(
      standardHarness.isRequestInScope(new URL('https://portal.auromind.org/index.html'), scopeUrl),
      false
    );
    assert.equal(
      standardHarness.isRequestInScope(new URL('https://portal.auromind.org/portal.js'), scopeUrl),
      false
    );
    assert.equal(
      standardHarness.isRequestInScope(new URL('https://portal.auromind.org/assets/sdk/auromind-sdk.js'), scopeUrl),
      false
    );
  });

  test('Encoded path traversal attacks are detected and rejected', () => {
    const scopeUrl = standardHarness.getRegistrationScope();
    // Raw dot-dot
    assert.equal(
      standardHarness.isRequestInScope(new URL('https://portal.auromind.org/games/auroblocks/../auromatch/index.html'), scopeUrl),
      false
    );
    // Encoded dot-dot (%2e%2e)
    assert.equal(
      standardHarness.isRequestInScope(new URL('https://portal.auromind.org/games/auroblocks/%2e%2e/auromatch/index.html'), scopeUrl),
      false
    );
    // Encoded slash (%2e%2e%2f)
    assert.equal(
      standardHarness.isRequestInScope(new URL('https://portal.auromind.org/games/auroblocks/%2e%2e%2fauromatch/index.html'), scopeUrl),
      false
    );
    // Repeated / nested percent encoding (%252e%252e)
    assert.equal(
      standardHarness.isRequestInScope(new URL('https://portal.auromind.org/games/auroblocks/%252e%252e/auromatch/index.html'), scopeUrl),
      false
    );
    // Encoded backslash (%5c..%5c)
    assert.equal(
      standardHarness.isRequestInScope(new URL('https://portal.auromind.org/games/auroblocks/%5c..%5cauromatch/index.html'), scopeUrl),
      false
    );
  });

  test('Malformed percent encoding is handled safely without throwing', () => {
    const scopeUrl = standardHarness.getRegistrationScope();
    // Incomplete or invalid percent sequence
    assert.equal(
      standardHarness.isRequestInScope(new URL('https://portal.auromind.org/games/auroblocks/%E0%A4%A/index.html'), scopeUrl),
      false
    );
    assert.equal(
      standardHarness.isRequestInScope(new URL('https://portal.auromind.org/games/auroblocks/%/test'), scopeUrl),
      false
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Cache Storage Mock Simulation: Cross-Namespace Isolation
// ---------------------------------------------------------------------------
describe('AuroBlocks SW Scope Security - Cache Namespace Non-Interference', () => {
  const swPath = path.join(__dirname, 'games/auroblocks/sw.js');
  const swCode = fs.readFileSync(swPath, 'utf8');

  test('Fetch handler never reads from or serves sibling cache entries', async () => {
    const mockStorage = new Map();
    function createMockCache(name) {
      if (!mockStorage.has(name)) {
        mockStorage.set(name, new Map());
      }
      const store = mockStorage.get(name);
      return {
        match: async (req) => {
          const key = typeof req === 'string' ? req : req.url;
          return store.get(key) || null;
        },
        put: async (req, res) => {
          const key = typeof req === 'string' ? req : req.url;
          store.set(key, res);
        },
        delete: async (req) => {
          const key = typeof req === 'string' ? req : req.url;
          return store.delete(key);
        },
        keys: async () => Array.from(store.keys()).map((k) => ({ url: k })),
      };
    }

    // Pre-populate sibling cache with a conflicting asset name
    const siblingCache = createMockCache('auro-match-v7.0');
    await siblingCache.put('https://portal.auromind.org/games/auroblocks/icon.svg', {
      source: 'AUROMATCH_FOREIGN_CACHE',
    });

    // Populate AuroBlocks cache with genuine asset
    const auroblocksCache = createMockCache('auroblocks-v1.5.1');
    await auroblocksCache.put('https://portal.auromind.org/games/auroblocks/icon.svg', {
      source: 'AUROBLOCKS_OWN_CACHE',
    });

    let fetchListener = null;
    let activateListener = null;

    const sandbox = {
      self: {
        location: new URL('https://portal.auromind.org/games/auroblocks/sw.js'),
        registration: { scope: 'https://portal.auromind.org/games/auroblocks/' },
        addEventListener: (event, handler) => {
          if (event === 'fetch') fetchListener = handler;
          if (event === 'activate') activateListener = handler;
        },
        clients: { claim: async () => {} },
        skipWaiting: async () => {},
      },
      caches: {
        open: async (name) => createMockCache(name),
        keys: async () => Array.from(mockStorage.keys()),
        delete: async (name) => mockStorage.delete(name),
        match: async () => {
          throw new Error('ILLEGAL GLOBAL caches.match() CALL DETECTED');
        },
      },
      URL,
      Request: class { constructor(url) { this.url = url; } },
      Response: class {},
      decodeURIComponent,
      fetch: async () => {
        return { status: 200, clone: () => ({ status: 200 }) };
      },
    };

    vm.createContext(sandbox);
    const script = new vm.Script(swCode);
    script.runInContext(sandbox);

    assert.ok(fetchListener, 'Fetch listener must be registered');

    // 1. Simulate out-of-scope sibling request: must not call respondWith
    let respondedWith = false;
    fetchListener({
      request: {
        method: 'GET',
        url: 'https://portal.auromind.org/games/auromatch/index.html',
        mode: 'navigate',
      },
      respondWith: () => {
        respondedWith = true;
      },
    });
    assert.equal(respondedWith, false, 'Out-of-scope sibling request must not call respondWith');

    // 2. Simulate in-scope request: must serve from auroblocks-v1.5.1, NOT foreign sibling cache
    let returnedResponse = null;
    fetchListener({
      request: {
        method: 'GET',
        url: 'https://portal.auromind.org/games/auroblocks/icon.svg',
        mode: 'no-cors',
      },
      respondWith: (promise) => {
        returnedResponse = promise;
      },
    });

    assert.ok(returnedResponse, 'In-scope request must call respondWith');
    const result = await returnedResponse;
    assert.equal(
      result.source,
      'AUROBLOCKS_OWN_CACHE',
      'Must return entry from AUROBLOCKS_OWN_CACHE, never foreign cache'
    );

    // 3. Verify activate does NOT delete sibling cache
    await new Promise((resolve) => {
      activateListener({
        waitUntil: (promise) => {
          promise.then(resolve);
        },
      });
    });

    assert.ok(
      mockStorage.has('auro-match-v7.0'),
      'Sibling cache auro-match-v7.0 must remain intact after AuroBlocks activate'
    );
  });
});

// ---------------------------------------------------------------------------
// 4. Real-Browser (Chromium Engine) Execution Verification
// ---------------------------------------------------------------------------
describe('AuroBlocks SW Scope Security - Real Browser E2E Verification', () => {
  let env = null;
  let browserAvailable = false;

  before(async () => {
    try {
      const { createTestEnvironment } = await import('./e2e/browser-harness.js');
      env = await createTestEnvironment({ port: 3338 });
      browserAvailable = true;
    } catch (e) {
      console.warn('[E2E SKIP] Real browser environment unavailable:', e.message);
      browserAvailable = false;
    }
  });

  after(async () => {
    if (env) {
      await env.teardown();
    }
  });

  test('Real Browser: AuroBlocks registers SW with effective scope restricted to /games/auroblocks/', async (t) => {
    if (!browserAvailable || !env) {
      t.skip('Real browser unavailable');
      return;
    }

    const { page, close } = await env.createInstrumentedPage();
    try {
      await page.goto(`${env.baseUrl}/games/auroblocks/index.html`, { waitUntil: 'networkidle2' });

      const swInfo = await page.evaluate(async () => {
        if (!('serviceWorker' in navigator)) return { supported: false };
        try {
          await Promise.race([
            navigator.serviceWorker.ready,
            new Promise((resolve) => setTimeout(resolve, 3000)),
          ]);
        } catch {}

        const registration = await navigator.serviceWorker.getRegistration('./');
        return {
          supported: true,
          registered: Boolean(registration),
          scope: registration ? registration.scope : null,
        };
      });

      assert.ok(swInfo.supported, 'ServiceWorker must be supported');
      assert.ok(swInfo.registered, 'AuroBlocks service worker must be registered');
      assert.ok(
        swInfo.scope && swInfo.scope.endsWith('/games/auroblocks/'),
        `Service worker scope must end with /games/auroblocks/. Got: ${swInfo.scope}`
      );
    } finally {
      await close();
    }
  });

  test('Real Browser: Sibling game requests are not intercepted by AuroBlocks SW', async (t) => {
    if (!browserAvailable || !env) {
      t.skip('Real browser unavailable');
      return;
    }

    const { page, close } = await env.createInstrumentedPage();
    try {
      await page.goto(`${env.baseUrl}/games/auroblocks/index.html`, { waitUntil: 'networkidle2' });

      // Fetch sibling game from inside the page context
      const siblingResult = await page.evaluate(async (baseUrl) => {
        try {
          const resp = await fetch(`${baseUrl}/games/auromatch/index.html`, { method: 'GET' });
          return { ok: resp.ok, status: resp.status };
        } catch (e) {
          return { error: e.message };
        }
      }, env.baseUrl);

      assert.ok(siblingResult.ok, 'Sibling game fetch must succeed from network');
      assert.equal(siblingResult.status, 200);
    } finally {
      await close();
    }
  });

  test('Real Browser: Foreign cache namespaces remain untouched across SW lifecycle', async (t) => {
    if (!browserAvailable || !env) {
      t.skip('Real browser unavailable');
      return;
    }

    const { page, close } = await env.createInstrumentedPage();
    try {
      await page.goto(`${env.baseUrl}/games/auroblocks/index.html`, { waitUntil: 'networkidle2' });

      // Create synthetic sibling cache and portal cache, then verify contents remain unchanged
      const cacheCheck = await page.evaluate(async () => {
        if (!window.caches) return { supported: false };
        const sibling = await window.caches.open('auro-match-v7.0');
        await sibling.put('/test-probe', new Response('probe-data-immutable'));

        const portal = await window.caches.open('auro-portal-v1.2.0');
        await portal.put('/portal-probe', new Response('portal-data-immutable'));

        // Trigger SW activate message or lifecycle check
        const swReg = await navigator.serviceWorker.getRegistration('./');
        if (swReg && swReg.active) {
          swReg.active.postMessage({ type: 'SKIP_WAITING' });
        }

        // Query all cache names and content after lifecycle trigger
        const namesAfter = await window.caches.keys();
        const hasSibling = namesAfter.includes('auro-match-v7.0');
        const hasPortal = namesAfter.includes('auro-portal-v1.2.0');

        // Verify foreign cache content remains exactly identical
        const probeResp = await sibling.match('/test-probe');
        const probeText = probeResp ? await probeResp.text() : null;

        return { supported: true, hasSibling, hasPortal, probeText };
      });

      assert.ok(cacheCheck.supported, 'CacheStorage must be supported');
      assert.ok(cacheCheck.hasSibling, 'Sibling cache auro-match-v7.0 must be preserved');
      assert.ok(cacheCheck.hasPortal, 'Portal cache auro-portal-v1.2.0 must be preserved');
      assert.equal(cacheCheck.probeText, 'probe-data-immutable', 'Foreign cache content must be completely unmutated');
    } finally {
      await close();
    }
  });

  test('Real Browser: AuroBlocks loads offline via service worker cache', async (t) => {
    if (!browserAvailable || !env) {
      t.skip('Real browser unavailable');
      return;
    }

    const { page, close, setOffline } = await env.createInstrumentedPage();
    try {
      // 1. Visit online to allow service worker to install and precache
      await page.goto(`${env.baseUrl}/games/auroblocks/index.html`, { waitUntil: 'networkidle2' });
      await page.evaluate(async () => {
        if ('serviceWorker' in navigator) {
          await navigator.serviceWorker.ready;
        }
      });

      // 2. Emulate network offline via CDP
      await setOffline(true);

      // 3. Reload page offline
      await page.reload({ waitUntil: 'domcontentloaded' });
      const pageTitle = await page.title();

      assert.ok(
        pageTitle.includes('MaaBLOCK'),
        `Offline reload must render game shell. Title was: ${pageTitle}`
      );
    } finally {
      await close();
    }
  });
});
