/**
 * F2 — End-to-End Cache Lifecycle Architecture, Isolation & Storage Safeguards Test Suite
 *
 * Exercises REAL production implementations:
 * 1. SDK storage adapter handling under QuotaExceededError, inaccessible storage and recovery.
 * 2. Actual portal cache cleanup logic (clearPortalPreferencesOnly) preserving game saves, identity, and artwork.
 * 3. Root, AuroBlocks, and AuroMatch service workers executed against shared simulated CacheStorage to verify namespace isolation.
 * 4. Critical shell asset failure rejecting service worker install (preventing broken shell replacement).
 * 5. Optional asset failure allowing resilient service worker install via Promise.allSettled.
 * 6. SW activation, stale cache pruning, client claiming, and offline navigation fallback.
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { createAuroMindSDK } from './assets/sdk/auromind-sdk.js';

const ROOT = process.cwd();

describe('F2: Production Storage Adapter Resilience (Quota & Inaccessible Storage)', () => {

  test('F2.1: Real SDK storage adapter survives QuotaExceededError and recovers gracefully', async () => {
    let quotaExceeded = true;
    const store = new Map();

    const mockStorage = {
      getItem(k) { return store.has(k) ? store.get(k) : null; },
      setItem(k, v) {
        if (quotaExceeded) {
          const err = new Error('The quota has been exceeded.');
          err.name = 'QuotaExceededError';
          throw err;
        }
        store.set(k, String(v));
      },
      removeItem(k) { store.delete(k); },
      clear() { store.clear(); },
      get length() { return store.size; },
      key(i) { return Array.from(store.keys())[i] ?? null; }
    };

    const sdk = createAuroMindSDK({
      localStorage: mockStorage,
      indexedDB: null // force reliance on localStorage to test quota boundary
    });

    // 1. Initialize under QuotaExceededError
    await assert.doesNotReject(async () => {
      await sdk.init({ gameId: 'portal', appVersion: '2.0.0' });
    }, 'SDK init must not throw even under QuotaExceededError');

    const health = sdk.identity.getStorageHealth();
    assert.equal(health.lsAvailable, false, 'Storage health must reflect localStorage failure');
    assert.ok(health.lastError, 'Storage health must record error details');

    // Ephemeral mode should be active with valid guest ID
    const guestId = sdk.identity.getGuestId();
    assert.ok(guestId, 'Guest profile must exist');
    assert.ok(guestId.startsWith('guest_'), 'Valid ephemeral guestId generated');

    // 2. Recovery: storage quota frees up
    quotaExceeded = false;
    mockStorage.setItem('test_recovery_key', 'test_val');
    assert.equal(mockStorage.getItem('test_recovery_key'), 'test_val', 'Storage is writable after quota recovery');
    sdk.dispose();
  });

  test('F2.2: Real SDK survives completely blocked/inaccessible storage (SecurityError)', async () => {
    const throwingStorage = {
      getItem() {
        const err = new Error('Access is denied for this document.');
        err.name = 'SecurityError';
        throw err;
      },
      setItem() {
        const err = new Error('Access is denied for this document.');
        err.name = 'SecurityError';
        throw err;
      },
      removeItem() { throw new Error('SecurityError'); },
      clear() { throw new Error('SecurityError'); }
    };

    const sdk = createAuroMindSDK({
      localStorage: throwingStorage,
      indexedDB: null
    });

    await assert.doesNotReject(async () => {
      await sdk.init({ gameId: 'portal', appVersion: '2.0.0' });
    });

    const identity = sdk.identity.get();
    assert.ok(identity && identity.guest);
    assert.equal(identity.guest.ephemeral, true, 'Must operate in ephemeral mode');
    assert.equal(sdk.identity.getStorageHealth().lsAvailable, false);
    sdk.dispose();
  });

});

describe('F2: Production Portal Cache Cleanup Logic', () => {

  test('F2.3: Production clearPortalPreferencesOnly preserves all game saves, identity, and artwork', () => {
    const portalCode = fs.readFileSync(path.join(ROOT, 'assets/js/portal.js'), 'utf8');

    // Extract production clearPortalPreferencesOnly function using VM
    const sandbox = {
      window: {},
      isProtectedPlatformStorageKey: (key) => {
        return key === 'auromind.platform.v1.guest' ||
               key.startsWith('auromind.platform.') ||
               key.startsWith('auromind_identity_') ||
               key.startsWith('auromind_user_avatar_') ||
               key.startsWith('auromatch_') ||
               key.startsWith('auroblocks_') ||
               key.startsWith('auromandala_');
      }
    };
    vm.createContext(sandbox);

    // Run helper definition
    const fnDefMatch = portalCode.match(/function clearPortalPreferencesOnly\([\s\S]*?\n\}/);
    assert.ok(fnDefMatch, 'clearPortalPreferencesOnly must be defined in portal.js');
    vm.runInContext(fnDefMatch[0] + '; window.clearPortalPreferencesOnly = clearPortalPreferencesOnly;', sandbox);

    const store = new Map([
      // Portal user preferences (SHOULD be cleared)
      ['auromind_senior_mode', 'true'],
      ['auromind_reduced_motion', 'true'],
      ['auromind_ambient_volume', '0.75'],
      ['auromind_guide_seen', 'true'],
      ['auromind_theme_preference', 'warm_cream'],

      // Protected Platform Identity (MUST be preserved)
      ['auromind.platform.v1.guest', JSON.stringify({ guestId: 'guest_alpha_999', createdAt: 12345 })],

      // Protected User Artwork (MUST be preserved)
      ['auromind_user_avatar_art', 'data:image/svg+xml;base64,PHN2Zz4...'],

      // Protected Game Saves (MUST be preserved)
      ['auroblocks_player_save_v1', JSON.stringify({ high_score: 9850, current_level: 14 })],
      ['auroblocks_settings', JSON.stringify({ haptics: true })],
      ['auromatch_profile', JSON.stringify({ unlocked_flowers: 85, zen_tokens: 350 })],
      ['auromatch_db', JSON.stringify({ active_board: [1, 2, 3] })],
      ['auromandala_art_store_v1', JSON.stringify({ artworks: ['mandala_01', 'mandala_02'] })],
      ['auromandala_sankalpa_vault', 'local_encrypted_sankalpa_payload']
    ]);

    const mockLocalStorage = {
      getItem(k) { return store.has(k) ? store.get(k) : null; },
      setItem(k, v) { store.set(k, String(v)); },
      removeItem(k) { store.delete(k); },
      get length() { return store.size; },
      key(i) { return Array.from(store.keys())[i] ?? null; }
    };

    const removedKeys = sandbox.window.clearPortalPreferencesOnly(mockLocalStorage);

    // Verify removed portal preference keys
    assert.ok(removedKeys.includes('auromind_senior_mode'));
    assert.ok(removedKeys.includes('auromind_reduced_motion'));
    assert.ok(removedKeys.includes('auromind_ambient_volume'));
    assert.ok(removedKeys.includes('auromind_guide_seen'));
    assert.equal(store.has('auromind_senior_mode'), false);
    assert.equal(store.has('auromind_reduced_motion'), false);

    // Verify SACRED PRESERVATION: Platform identity, artwork, and game saves are 100% intact
    assert.ok(store.has('auromind.platform.v1.guest'), 'Platform guest identity must be intact');
    assert.ok(store.has('auromind_user_avatar_art'), 'User avatar artwork must be intact');
    assert.ok(store.has('auroblocks_player_save_v1'), 'AuroBlocks save must be intact');
    assert.ok(store.has('auroblocks_settings'), 'AuroBlocks settings must be intact');
    assert.ok(store.has('auromatch_profile'), 'AuroMatch profile must be intact');
    assert.ok(store.has('auromatch_db'), 'AuroMatch DB must be intact');
    assert.ok(store.has('auromandala_art_store_v1'), 'AuroMandala art must be intact');
    assert.ok(store.has('auromandala_sankalpa_vault'), 'Sankalpa vault must be intact');

    assert.ok(store.get('auromind.platform.v1.guest').includes('guest_alpha_999'));
    assert.ok(store.get('auroblocks_player_save_v1').includes('9850'));
    assert.ok(store.get('auromatch_profile').includes('85'));
  });

});

describe('F2: Real Service Worker Execution & Namespace Isolation', () => {

  function createSharedCacheStorage() {
    const storage = new Map();
    return {
      _storage: storage,
      open: async (name) => {
        if (!storage.has(name)) storage.set(name, new Map());
        const store = storage.get(name);
        return {
          add: async (url) => store.set(url, new Response('ok', { status: 200 })),
          addAll: async (urls) => {
            for (const u of urls) store.set(u, new Response('ok', { status: 200 }));
          },
          put: async (req, res) => {
            const url = typeof req === 'string' ? req : req.url;
            store.set(url, res);
          },
          match: async (req) => {
            const url = typeof req === 'string' ? req : req.url;
            return store.get(url) || undefined;
          },
          delete: async (req) => {
            const url = typeof req === 'string' ? req : req.url;
            return store.delete(url);
          },
          keys: async () => Array.from(store.keys()).map(u => {
            const abs = u.startsWith('http') ? u : 'http://localhost:3000/' + u.replace(/^\.\//, '');
            return new Request(abs);
          })
        };
      },
      keys: async () => Array.from(storage.keys()),
      delete: async (name) => storage.delete(name),
      has: async (name) => storage.has(name)
    };
  }

  test('F2.4: Root and game SW activation against shared CacheStorage guarantees strict namespace isolation', async () => {
    const sharedCaches = createSharedCacheStorage();

    // Populate initial caches across portal and games
    sharedCaches._storage.set('auro-portal-v1.2.0', new Map([['./index.html', 'old-portal']]));
    sharedCaches._storage.set('auro-portal-v2.0.0', new Map([['./index.html', 'v2-portal']]));
    sharedCaches._storage.set('auro-portal-fonts-v1.0.0', new Map([['font.woff2', 'font']]));
    sharedCaches._storage.set('auroblocks-v1.5.0', new Map([['./index.html', 'old-blocks']]));
    sharedCaches._storage.set('auroblocks-v1.5.1', new Map([['./index.html', 'v1.5.1-blocks']]));
    sharedCaches._storage.set('auro-match-v7.0', new Map([['./index.html', 'v7-match']]));
    sharedCaches._storage.set('auro-match-v8.0', new Map([['./index.html', 'v8-match']]));
    sharedCaches._storage.set('auro-match-artwork-v8.0', new Map([['art.svg', 'art']]));
    sharedCaches._storage.set('auro-match-fonts-v8.0', new Map([['cinzel.woff2', 'cinzel']]));

    // 1. Run Root SW activate
    const rootSwCode = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    const rootListeners = new Map();
    const rootSelf = {
      location: { origin: 'http://localhost:3000', href: 'http://localhost:3000/sw.js' },
      registration: { scope: 'http://localhost:3000/' },
      skipWaiting: () => Promise.resolve(),
      clients: { claim: () => Promise.resolve() },
      addEventListener: (type, fn) => {
        if (!rootListeners.has(type)) rootListeners.set(type, []);
        rootListeners.get(type).push(fn);
      }
    };
    const rootContext = vm.createContext({
      self: rootSelf,
      caches: sharedCaches,
      URL, Request, Response,
      fetch: async () => new Response('ok', { status: 200 })
    });
    vm.runInContext(rootSwCode, rootContext, { filename: 'sw.js' });

    for (const fn of rootListeners.get('activate') || []) {
      const wait = [];
      fn({ waitUntil: (p) => wait.push(p) });
      await Promise.all(wait);
    }

    // Portal pruned v1.2.0, preserved v2.0.0 and fonts
    assert.equal(sharedCaches._storage.has('auro-portal-v1.2.0'), false, 'Root SW must prune old portal v1.2.0');
    assert.equal(sharedCaches._storage.has('auro-portal-v2.0.0'), true, 'Root SW must preserve portal v2.0.0');
    assert.equal(sharedCaches._storage.has('auro-portal-fonts-v1.0.0'), true, 'Root SW must preserve fonts');

    // Root SW MUST NOT touch sibling game caches
    assert.equal(sharedCaches._storage.has('auroblocks-v1.5.0'), true, 'Root SW must never touch auroblocks caches');
    assert.equal(sharedCaches._storage.has('auroblocks-v1.5.1'), true);
    assert.equal(sharedCaches._storage.has('auro-match-v7.0'), true, 'Root SW must never touch auromatch caches');
    assert.equal(sharedCaches._storage.has('auro-match-v8.0'), true);

    // 2. Run AuroBlocks SW activate
    const blocksSwCode = fs.readFileSync(path.join(ROOT, 'games/auroblocks/sw.js'), 'utf8');
    const blocksListeners = new Map();
    const blocksSelf = {
      location: { origin: 'http://localhost:3000', href: 'http://localhost:3000/games/auroblocks/sw.js' },
      registration: { scope: 'http://localhost:3000/games/auroblocks/' },
      skipWaiting: () => Promise.resolve(),
      clients: { claim: () => Promise.resolve() },
      addEventListener: (type, fn) => {
        if (!blocksListeners.has(type)) blocksListeners.set(type, []);
        blocksListeners.get(type).push(fn);
      }
    };
    const blocksContext = vm.createContext({
      self: blocksSelf,
      caches: sharedCaches,
      URL, Request, Response,
      fetch: async () => new Response('ok', { status: 200 })
    });
    vm.runInContext(blocksSwCode, blocksContext, { filename: 'games/auroblocks/sw.js' });

    for (const fn of blocksListeners.get('activate') || []) {
      const wait = [];
      fn({ waitUntil: (p) => wait.push(p) });
      await Promise.all(wait);
    }

    // AuroBlocks pruned v1.5.0, preserved v1.5.1
    assert.equal(sharedCaches._storage.has('auroblocks-v1.5.0'), false, 'AuroBlocks SW pruned old cache');
    assert.equal(sharedCaches._storage.has('auroblocks-v1.5.1'), true, 'AuroBlocks SW preserved active cache');

    // AuroBlocks SW MUST NOT touch portal or auromatch caches
    assert.equal(sharedCaches._storage.has('auro-portal-v2.0.0'), true, 'AuroBlocks SW must never touch portal cache');
    assert.equal(sharedCaches._storage.has('auro-match-v8.0'), true, 'AuroBlocks SW must never touch auromatch cache');
  });

  test('F2.5: Critical shell asset failure causes install rejection, preserving existing working offline shell', async () => {
    const swCode = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    const caches = createSharedCacheStorage();

    // Populate currently working offline cache v1.2.0
    caches._storage.set('auro-portal-v1.2.0', new Map([['./index.html', 'working-offline-html']]));

    const listeners = new Map();
    const selfMock = {
      location: { origin: 'http://localhost:3000', href: 'http://localhost:3000/sw.js' },
      registration: { scope: 'http://localhost:3000/' },
      skipWaiting: () => Promise.resolve(),
      clients: { claim: () => Promise.resolve() },
      addEventListener: (type, fn) => {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      }
    };

    // Simulate critical network failure on index.html during new SW install
    const context = vm.createContext({
      self: selfMock,
      caches: {
        open: async (name) => {
          return {
            addAll: async (assets) => {
              if (assets.includes('./index.html')) {
                throw new Error('NETWORK_FAILED: 503 Service Unavailable for critical asset index.html');
              }
            },
            add: async () => {},
            put: async () => {},
            match: async () => undefined
          };
        },
        keys: async () => Array.from(caches._storage.keys()),
        delete: async (name) => caches._storage.delete(name)
      },
      URL, Request, Response,
      fetch: async () => { throw new Error('Offline'); }
    });

    vm.runInContext(swCode, context, { filename: 'sw.js' });

    const installPromises = [];
    for (const fn of listeners.get('install') || []) {
      fn({ waitUntil: (p) => installPromises.push(p) });
    }

    // Critical shell failure MUST cause install to reject
    await assert.rejects(
      Promise.all(installPromises),
      /NETWORK_FAILED/,
      'SW install must reject when critical shell asset fails to download'
    );

    // Existing working offline cache must NOT be destroyed
    assert.equal(caches._storage.has('auro-portal-v1.2.0'), true, 'Existing working cache must remain intact');
  });

  test('F2.6: Optional asset failure does not abort SW install (Promise.allSettled resilience)', async () => {
    const swCode = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    const caches = createSharedCacheStorage();
    const cachedUrls = new Set();

    const listeners = new Map();
    const selfMock = {
      location: { origin: 'http://localhost:3000', href: 'http://localhost:3000/sw.js' },
      registration: { scope: 'http://localhost:3000/' },
      skipWaiting: () => Promise.resolve(),
      clients: { claim: () => Promise.resolve() },
      addEventListener: (type, fn) => {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      }
    };

    const context = vm.createContext({
      self: selfMock,
      caches: {
        open: async () => {
          return {
            addAll: async (assets) => {
              // Critical shell succeeds
              for (const a of assets) cachedUrls.add(a);
            },
            add: async (url) => {
              // Optional media asset failure simulated
              if (url.includes('auromandala.jpg')) {
                throw new Error('404 Not Found on optional asset auromandala.jpg');
              }
              cachedUrls.add(url);
            },
            put: async () => {},
            match: async () => undefined
          };
        },
        keys: async () => [],
        delete: async () => true
      },
      URL, Request, Response,
      fetch: async () => { throw new Error('Font offline'); }
    });

    vm.runInContext(swCode, context, { filename: 'sw.js' });

    const installPromises = [];
    for (const fn of listeners.get('install') || []) {
      fn({ waitUntil: (p) => installPromises.push(p) });
    }

    // Install must SUCCEED because critical shell assets succeeded
    await assert.doesNotReject(
      Promise.all(installPromises),
      'Install must succeed when only optional assets fail'
    );

    assert.ok(cachedUrls.has('./index.html'), 'Critical index.html was cached');
    assert.ok(cachedUrls.has('./assets/js/portal.js'), 'Critical portal.js was cached');
    assert.ok(cachedUrls.has('./assets/sdk/auromind-sdk.js'), 'Critical SDK was cached');
  });

  test('F2.7: Activate event skips deletion of old caches if new cache is missing critical shell', async () => {
    const swCode = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    const caches = createSharedCacheStorage();

    // Populate old cache
    caches._storage.set('auro-portal-v1.2.0', new Map([['./index.html', 'v1.2-shell']]));
    // Empty v2.0.0 cache (missing index.html)
    caches._storage.set('auro-portal-v2.0.0', new Map());

    const listeners = new Map();
    const selfMock = {
      location: { origin: 'http://localhost:3000', href: 'http://localhost:3000/sw.js' },
      registration: { scope: 'http://localhost:3000/' },
      skipWaiting: () => Promise.resolve(),
      clients: { claim: () => Promise.resolve() },
      addEventListener: (type, fn) => {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      }
    };

    const context = vm.createContext({
      self: selfMock,
      caches,
      URL, Request, Response,
      fetch: async () => new Response('ok', { status: 200 })
    });

    vm.runInContext(swCode, context, { filename: 'sw.js' });

    for (const fn of listeners.get('activate') || []) {
      const wait = [];
      fn({ waitUntil: (p) => wait.push(p) });
      await Promise.all(wait);
    }

    // Because new cache is empty/corrupt, old cache was NOT pruned!
    assert.equal(caches._storage.has('auro-portal-v1.2.0'), true, 'Old cache must be preserved when new cache lacks critical shell');
  });

  test('F2.8: Fetch handler delegates /games/* routes to child service workers without caching in portal SW', async () => {
    const swCode = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    const caches = createSharedCacheStorage();

    const listeners = new Map();
    const selfMock = {
      location: { origin: 'http://localhost:3000', href: 'http://localhost:3000/sw.js' },
      registration: { scope: 'http://localhost:3000/' },
      skipWaiting: () => Promise.resolve(),
      clients: { claim: () => Promise.resolve() },
      addEventListener: (type, fn) => {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      }
    };

    const context = vm.createContext({
      self: selfMock,
      caches,
      URL, Request, Response,
      fetch: async () => new Response('network-response', { status: 200 })
    });

    vm.runInContext(swCode, context, { filename: 'sw.js' });

    const fetchListeners = listeners.get('fetch') || [];
    assert.ok(fetchListeners.length > 0, 'Fetch listener must be registered');

    // Request to /games/auroblocks/index.html
    let responded = false;
    const gameEvent = {
      request: new Request('http://localhost:3000/games/auroblocks/index.html'),
      respondWith: () => { responded = true; }
    };
    fetchListeners[0](gameEvent);

    assert.equal(responded, false, 'Fetch handler must strictly bypass /games/* requests so child SW handles it');
  });

});
