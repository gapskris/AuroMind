/**
 * B19.5-03 — Save Synchronization, Artwork Persistence & Flora Integrity Test Suite
 *
 * Part 1: Unit & integration tests executing actual production SDK, adapters,
 *         SupabaseSyncProvider, AuroMandala artwork concurrency/bridge, and
 *         AuroMatch Flora dual-write storageAdapter/bridge code paths.
 * Part 2: Real Chromium/Edge browser verification via ./e2e/browser-harness.js
 *         (real localStorage, real IndexedDB AuroMatchDB, real browser ES modules,
 *         real page reloads, and offline boundary verification).
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { createAuroMindSDK } from './assets/sdk/auromind-sdk.js';
import {
  AuroBlocksMergeStrategy,
  AuroMatchMergeStrategy,
  AuroMandalaMergeStrategy,
  computePayloadChecksum,
  computePayloadChecksumSync,
  mergeArtworksWithForking,
  capSnapshots
} from './assets/sdk/auromind-adapters.js';
import { createSupabaseSyncProvider } from './assets/sdk/providers/supabase/supabase-sync-provider.js';
import {
  MAX_ARTWORK_SNAPSHOTS,
  computeArtworkContentHash,
  createArtworkEntity,
  appendArtworkSnapshot,
  markArtworkDeleted,
  resurrectArtwork,
  resolveArtworkCausalConflict,
  createLocalArtworkStore
} from './assets/sdk/artwork-concurrency.js';
import {
  CACHE_KEY as MANDALA_CACHE_KEY,
  SANKALPA_VAULT_KEY,
  createAuroMandalaGameAdapter
} from './games/auromandala/assets/auromandala-sdk-bridge.js';
import {
  resetIndexedDBConnection,
  setItemDualWrite,
  setItemAsync,
  getItemAsync,
  getDualWriteStatus,
  reconcileDualWriteParity,
  autoHealFromIndexedDB,
  saveProfileState,
  loadProfileState,
  profileState,
  createAuroMatchGameAdapter as createAuroMatchNativeAdapter,
  isPurgeActive,
  setPurgeLock,
  getActiveScope,
  setAccountScope
} from './games/auromatch/src/controllers/storageAdapter.js';
import { createAuroMatchGameAdapter as createAuroMatchBridgeAdapter } from './games/auromatch/Assets/auromatch-sdk-bridge.js';
import { createTestEnvironment } from './e2e/browser-harness.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =============================================================================
// Shared Test Helpers (In-Memory Storage, Mock IDB, Mock Sync/Auth Providers)
// =============================================================================

function createMemoryStorage({ failOnSet = false, quotaError = false } = {}) {
  const map = new Map();
  let shouldFailSet = failOnSet;
  return {
    get length() {
      return map.size;
    },
    key(i) {
      return Array.from(map.keys())[i] ?? null;
    },
    getItem(k) {
      return map.has(String(k)) ? map.get(String(k)) : null;
    },
    setItem(k, v) {
      if (shouldFailSet) {
        const err = new Error(quotaError ? 'QuotaExceededError: storage full' : 'Storage write failed');
        if (quotaError) err.name = 'QuotaExceededError';
        throw err;
      }
      map.set(String(k), String(v));
    },
    removeItem(k) {
      map.delete(String(k));
    },
    clear() {
      map.clear();
    },
    setFailOnWrite(flag) {
      shouldFailSet = Boolean(flag);
    },
    _dump() {
      return Object.fromEntries(map.entries());
    }
  };
}

function createFakeIndexedDB({ failPutCount = 0, alwaysFailPut = false } = {}) {
  const dbs = new Map();
  let remainingPutFailures = failPutCount;
  let forceFailPut = alwaysFailPut;

  function getOrCreateDb(name) {
    if (!dbs.has(name)) {
      dbs.set(name, new Map());
    }
    const stores = dbs.get(name);
    return {
      name,
      objectStoreNames: {
        contains: (storeName) => stores.has(storeName)
      },
      createObjectStore: (storeName) => {
        if (!stores.has(storeName)) stores.set(storeName, new Map());
        return {};
      },
      close() {},
      transaction(storeName, _mode) {
        if (!stores.has(storeName)) stores.set(storeName, new Map());
        const store = stores.get(storeName);
        const tx = {
          oncomplete: null,
          onerror: null,
          onabort: null,
          error: null,
          objectStore() {
            return {
              get(key) {
                const req = { result: undefined, onsuccess: null, onerror: null };
                queueMicrotask(() => {
                  req.result = store.has(key) ? store.get(key) : undefined;
                  if (req.onsuccess) req.onsuccess({ target: req });
                  if (tx.oncomplete) tx.oncomplete({ target: tx });
                });
                return req;
              },
              getAll() {
                const req = { result: [], onsuccess: null, onerror: null };
                queueMicrotask(() => {
                  req.result = Array.from(store.values());
                  if (req.onsuccess) req.onsuccess({ target: req });
                  if (tx.oncomplete) tx.oncomplete({ target: tx });
                });
                return req;
              },
              put(value, explicitKey) {
                const req = { result: undefined, onsuccess: null, onerror: null };
                queueMicrotask(() => {
                  if (forceFailPut || remainingPutFailures > 0) {
                    if (remainingPutFailures > 0) remainingPutFailures--;
                    const err = new Error('Simulated IndexedDB write failure');
                    tx.error = err;
                    req.error = err;
                    if (req.onerror) req.onerror({ target: req });
                    if (tx.onerror) tx.onerror({ target: tx });
                    return;
                  }
                  const k = explicitKey !== undefined ? explicitKey : (value && (value.id || value.key));
                  store.set(k, value);
                  req.result = k;
                  if (req.onsuccess) req.onsuccess({ target: req });
                  if (tx.oncomplete) tx.oncomplete({ target: tx });
                });
                return req;
              },
              delete(key) {
                const req = { result: undefined, onsuccess: null, onerror: null };
                queueMicrotask(() => {
                  store.delete(key);
                  if (req.onsuccess) req.onsuccess({ target: req });
                  if (tx.oncomplete) tx.oncomplete({ target: tx });
                });
                return req;
              }
            };
          }
        };
        return tx;
      }
    };
  }

  return {
    open(name) {
      const req = { result: null, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
      queueMicrotask(() => {
        const db = getOrCreateDb(name);
        req.result = db;
        if (req.onupgradeneeded) req.onupgradeneeded({ target: req });
        if (req.onsuccess) req.onsuccess({ target: req });
      });
      return req;
    },
    deleteDatabase(name) {
      const req = { onsuccess: null, onerror: null, onblocked: null };
      queueMicrotask(() => {
        dbs.delete(name);
        if (req.onsuccess) req.onsuccess({ target: req });
      });
      return req;
    },
    _setAlwaysFailPut(flag) {
      forceFailPut = Boolean(flag);
    },
    _setFailPutCount(n) {
      remainingPutFailures = n;
    },
    _peekStore(dbName, storeName) {
      const db = dbs.get(dbName);
      if (!db || !db.has(storeName)) return {};
      return Object.fromEntries(db.get(storeName).entries());
    },
    _seedStore(dbName, storeName, key, value) {
      if (!dbs.has(dbName)) dbs.set(dbName, new Map());
      const db = dbs.get(dbName);
      if (!db.has(storeName)) db.set(storeName, new Map());
      db.get(storeName).set(key, value);
    }
  };
}

function createFakeBroadcastBus() {
  const channels = new Map();
  class FakeBroadcastChannel {
    constructor(name) {
      this.name = name;
      this.onmessage = null;
      this._closed = false;
      if (!channels.has(name)) channels.set(name, new Set());
      channels.get(name).add(this);
    }
    postMessage(data) {
      if (this._closed) return;
      const peers = channels.get(this.name);
      if (!peers) return;
      for (const peer of peers) {
        if (peer !== this && !peer._closed && typeof peer.onmessage === 'function') {
          peer.onmessage({ data: JSON.parse(JSON.stringify(data)) });
        }
      }
    }
    close() {
      this._closed = true;
      const peers = channels.get(this.name);
      if (peers) peers.delete(this);
    }
  }
  return FakeBroadcastChannel;
}

function createSdkEnv({ storage = createMemoryStorage(), idb = createFakeIndexedDB(), onLine = true, BroadcastChannelImpl = null } = {}) {
  const listeners = new Map();
  let onlineFlag = onLine;
  const win = {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      if (listeners.has(type)) listeners.get(type).delete(fn);
    },
    dispatchEvent(evt) {
      const set = listeners.get(evt.type);
      if (set) {
        for (const fn of set) fn(evt);
      }
    },
    navigator: {
      get onLine() {
        return onlineFlag;
      }
    }
  };

  return {
    env: {
      window: win,
      navigator: win.navigator,
      localStorage: storage,
      indexedDB: idb,
      BroadcastChannel: BroadcastChannelImpl
    },
    setOnline(next) {
      onlineFlag = Boolean(next);
      win.dispatchEvent({ type: onlineFlag ? 'online' : 'offline' });
    }
  };
}

function createMockAuthProvider(initialAccount = null) {
  let currentAccount = initialAccount;
  const authListeners = new Set();
  return {
    providerName: 'mock-auth',
    isConfigured: () => true,
    async getSession() {
      return currentAccount ? { ...currentAccount } : null;
    },
    async signIn(_method, options = {}) {
      const email = options.email || 'player@example.com';
      const userId = `user_${email.split('@')[0]}`;
      currentAccount = {
        userId,
        email,
        displayName: email.split('@')[0],
        provider: 'email',
        expiresAt: new Date(Date.now() + 3600_000).toISOString()
      };
      for (const cb of authListeners) cb({ ...currentAccount });
      return { ok: true, status: 'authenticated', account: { ...currentAccount } };
    },
    async linkGuestIdentity(_guestId) {
      return { linked: true };
    },
    async signOut() {
      currentAccount = null;
      for (const cb of authListeners) cb(null);
      return { ok: true };
    },
    onAuthStateChange(cb) {
      authListeners.add(cb);
      return () => authListeners.delete(cb);
    },
    _emitSwitch(userId, email = `${userId}@example.com`) {
      currentAccount = userId
        ? {
            userId,
            email,
            displayName: userId,
            provider: 'email',
            expiresAt: new Date(Date.now() + 3600_000).toISOString()
          }
        : null;
      for (const cb of authListeners) cb(currentAccount ? { ...currentAccount } : null);
    }
  };
}

function createMockCloudSyncStore() {
  const rows = new Map(); // `${userId}::${gameId}` -> record
  let pullCount = 0;
  let pushCount = 0;
  let failNextPush = null;
  let forceConflictOnce = null;
  let onBeforePull = null;
  let onBeforePush = null;

  return {
    rows,
    getStats: () => ({ pullCount, pushCount }),
    setFailNextPush(errMsg) {
      failNextPush = errMsg;
    },
    setForceConflictOnce(serverRecord) {
      forceConflictOnce = serverRecord;
    },
    setOnBeforePull(fn) {
      onBeforePull = fn;
    },
    setOnBeforePush(fn) {
      onBeforePush = fn;
    },
    seed(userId, gameId, record) {
      rows.set(`${userId}::${gameId}`, JSON.parse(JSON.stringify(record)));
    },
    get(userId, gameId) {
      return rows.get(`${userId}::${gameId}`) || null;
    },
    provider: {
      providerName: 'mock-cloud-sync',
      isConfigured: () => true,
      async pullLatest(userId, gameId) {
        pullCount += 1;
        if (onBeforePull) await onBeforePull({ userId, gameId });
        const rec = rows.get(`${userId}::${gameId}`);
        return rec ? JSON.parse(JSON.stringify(rec)) : null;
      },
      async pushWithOptimisticLock(envelope, userId, expectedRevision) {
        const gameId = envelope.gameId;
        pushCount += 1;
        if (onBeforePush) await onBeforePush({ userId, gameId, envelope, expectedRevision });
        if (failNextPush) {
          const msg = failNextPush;
          failNextPush = null;
          throw new Error(msg);
        }
        if (forceConflictOnce) {
          const conflictRec = forceConflictOnce;
          forceConflictOnce = null;
          rows.set(`${userId}::${gameId}`, JSON.parse(JSON.stringify(conflictRec)));
          return {
            status: 'conflict',
            currentRevision: conflictRec.revision,
            serverRecord: JSON.parse(JSON.stringify(conflictRec))
          };
        }
        const key = `${userId}::${gameId}`;
        const existing = rows.get(key);
        const currentRev = existing ? existing.revision : 0;
        if (existing && expectedRevision !== currentRev) {
          return {
            status: 'conflict',
            currentRevision: currentRev,
            serverRecord: JSON.parse(JSON.stringify(existing))
          };
        }
        const nextRev = currentRev + 1;
        const stored = {
          userId,
          gameId,
          revision: nextRev,
          checksum: envelope.checksum,
          payload: JSON.parse(JSON.stringify(envelope.payload)),
          updatedAt: new Date().toISOString()
        };
        rows.set(key, stored);
        return { status: 'success', newRevision: nextRev, record: stored };
      }
    }
  };
}

function createInMemoryGameAdapter(gameId, initialPayload) {
  let state = JSON.parse(JSON.stringify(initialPayload));
  return {
    getState: () => JSON.parse(JSON.stringify(state)),
    setState: (next) => {
      state = JSON.parse(JSON.stringify(next));
    },
    adapter: {
      gameId,
      adapterVersion: '1.0.0',
      contractVersion: 1,
      integrationMode: 'native',
      storage: {
        kind: 'ls',
        ownedDatabases: [],
        ownedLocalStorageKeys: [`test_${gameId}_save`],
        localOnlyVaults: gameId === 'auromandala' ? [SANKALPA_VAULT_KEY] : []
      },
      capabilities: {
        offlinePlay: true,
        localPersistence: true,
        cloudSyncEligible: true
      },
      hasLocalProgress: () => Boolean(state && Object.keys(state).length > 0),
      exportEnvelope: async (guestId) => ({
        envelopeVersion: 1,
        gameId,
        gameSchemaVersion: 1,
        guestId,
        baseRevision: 0,
        clientUpdatedAt: new Date().toISOString(),
        isEmpty: !state || Object.keys(state).length === 0,
        checksum: await computePayloadChecksum(state),
        payload: JSON.parse(JSON.stringify(state))
      }),
      applyEnvelope: async (envelope) => {
        if (!envelope || !envelope.payload) return false;
        state = JSON.parse(JSON.stringify(envelope.payload));
        return true;
      }
    }
  };
}

// =============================================================================
// PART 1 — UNIT & INTEGRATION TESTS
// =============================================================================

describe('Part 1A — Scope A: Game Save Synchronization & Guest-Save Merging', () => {
  test('Sync-1: Guest-to-account linking merges guest + existing cloud saves without losing either side (AuroMatch + AuroBlocks)', async () => {
    const { env } = createSdkEnv();
    const auth = createMockAuthProvider();
    const cloud = createMockCloudSyncStore();

    // Seed existing cloud account saves for alice (with real canonical SHA-256 checksums)
    const aliceMatchPayload = {
      schemaVersion: 1,
      user: {
        profile: { lotusPetalCount: 40, consciousnessPoints: 300 },
        progression: { completedLevelsCount: 2, completedLevelIds: ['flora_lotus', 'flora_rose'], unlockedThemes: ['flowers'] }
      },
      unlockedTiles: ['flora_lotus', 'flora_rose'],
      consecrations: [{ id: 'c_cloud', text: 'Cloud reflection' }]
    };
    const aliceBlocksPayload = {
      highScore: 1500,
      completedStages: [1, 2, { stageId: 's5', score: 400, stars: 2, cleared: true }],
      stageScores: { s1: 300, s5: 400 }
    };
    cloud.seed('user_alice', 'auromatch', {
      userId: 'user_alice',
      gameId: 'auromatch',
      revision: 3,
      checksum: await computePayloadChecksum(aliceMatchPayload),
      payload: aliceMatchPayload,
      updatedAt: '2026-11-23T08:00:00.000Z'
    });
    cloud.seed('user_alice', 'auroblocks', {
      userId: 'user_alice',
      gameId: 'auroblocks',
      revision: 2,
      checksum: await computePayloadChecksum(aliceBlocksPayload),
      payload: aliceBlocksPayload,
      updatedAt: '2026-11-23T08:00:00.000Z'
    });

    const sdk = createAuroMindSDK({ env });
    await sdk.init({
      gameId: 'portal',
      capabilities: { authEnabled: true, cloudSyncEnabled: true },
      providers: { auth, cloudSync: cloud.provider }
    });

    const matchHarness = createInMemoryGameAdapter('auromatch', {
      schemaVersion: 1,
      user: {
        profile: { lotusPetalCount: 25, consciousnessPoints: 500 },
        progression: { completedLevelsCount: 2, completedLevelIds: ['flora_jasmine', 'flora_lotus'], unlockedThemes: ['flowers', 'qualities'] }
      },
      unlockedTiles: ['flora_jasmine', 'flora_lotus'],
      consecrations: [{ id: 'c_guest', text: 'Guest reflection' }]
    });
    const blocksHarness = createInMemoryGameAdapter('auroblocks', {
      highScore: 2200,
      completedStages: [2, 3, { stageId: 's5', score: 650, stars: 3, cleared: true }],
      stageScores: { s2: 500, s5: 650 }
    });

    sdk.adapters.register(matchHarness.adapter, { mergeStrategy: AuroMatchMergeStrategy });
    sdk.adapters.register(blocksHarness.adapter, { mergeStrategy: AuroBlocksMergeStrategy });
    await sdk.adapters.init('auromatch');
    await sdk.adapters.init('auroblocks');

    // Guest links/migrates into existing account alice & opts into cloud sync
    await sdk.auth.signIn('email', { email: 'alice@example.com' });
    sdk.sync.setConsent(true);

    const res = await sdk.sync.syncNow();
    assert.equal(res.status, 'success');
    assert.equal(res.results.length, 2);

    // Verify AuroMatch merged state preserves BOTH guest and cloud Flora unlocks & reflections
    const mergedMatch = matchHarness.getState();
    assert.deepEqual(
      new Set(mergedMatch.unlockedTiles),
      new Set(['flora_lotus', 'flora_rose', 'flora_jasmine'])
    );
    assert.equal(mergedMatch.consecrations.length, 2);
    assert.equal(mergedMatch.user.profile.lotusPetalCount, 40);
    assert.equal(mergedMatch.user.profile.consciousnessPoints, 500);
    assert.equal(mergedMatch.user.progression.completedLevelsCount, 3);

    // Verify AuroBlocks merged state preserves BOTH primitive and object stage progress
    const mergedBlocks = blocksHarness.getState();
    assert.equal(mergedBlocks.highScore, 2200);
    assert.ok(mergedBlocks.completedStages.includes(1));
    assert.ok(mergedBlocks.completedStages.includes(2));
    assert.ok(mergedBlocks.completedStages.includes(3));
    const s5 = mergedBlocks.completedStages.find((s) => s && typeof s === 'object' && s.stageId === 's5');
    assert.equal(s5.score, 650);
    assert.equal(s5.stars, 3);
    assert.equal(mergedBlocks.stageScores.s1, 300);
    assert.equal(mergedBlocks.stageScores.s2, 500);
    assert.equal(mergedBlocks.stageScores.s5, 650);

    sdk.dispose();
  });

  test('Sync-2: Repeated syncNow() is strictly idempotent with canonical SHA-256 checksums (zero redundant pushes)', async () => {
    const { env } = createSdkEnv();
    const auth = createMockAuthProvider();
    const cloud = createMockCloudSyncStore();
    const sdk = createAuroMindSDK({ env });

    await sdk.init({
      gameId: 'portal',
      capabilities: { authEnabled: true, cloudSyncEnabled: true },
      providers: { auth, cloudSync: cloud.provider }
    });
    const blocksHarness = createInMemoryGameAdapter('auroblocks', {
      highScore: 900,
      completedStages: [1, 2]
    });
    sdk.adapters.register(blocksHarness.adapter, { mergeStrategy: AuroBlocksMergeStrategy });
    await sdk.adapters.init('auroblocks');

    await sdk.auth.signIn('email', { email: 'idemp@example.com' });
    sdk.sync.setConsent(true);

    // First sync pushes revision 1
    const first = await sdk.sync.syncNow('auroblocks');
    assert.equal(first.status, 'success');
    assert.equal(first.results[0].action, 'pushed_initial');
    assert.equal(cloud.getStats().pushCount, 1);

    const cloudRecord = cloud.get('user_idemp', 'auroblocks');
    assert.match(cloudRecord.checksum, /^[a-f0-9]{64}$/, 'Checksum must be a canonical 64-char SHA-256 hex digest');
    assert.equal(cloudRecord.checksum.startsWith('merged_'), false);

    // Second sync with unchanged state must return in_sync with ZERO new pushes!
    const second = await sdk.sync.syncNow('auroblocks');
    assert.equal(second.status, 'success');
    assert.equal(second.results[0].action, 'in_sync');
    assert.equal(cloud.getStats().pushCount, 1, 'Idempotent re-sync must NOT push again');

    // Also test idempotency right after an auto_merged_and_pushed (previously broke with fake merged_${Date.now()} checksum!)
    cloud.seed('user_idemp', 'auroblocks', {
      userId: 'user_idemp',
      gameId: 'auroblocks',
      revision: 2,
      checksum: await computePayloadChecksum({ highScore: 1100, completedStages: [1, 3] }),
      payload: { highScore: 1100, completedStages: [1, 3] },
      updatedAt: new Date().toISOString()
    });
    const mergeSync = await sdk.sync.syncNow('auroblocks');
    assert.equal(mergeSync.results[0].action, 'auto_merged_and_pushed');
    const pushedCountAfterMerge = cloud.getStats().pushCount;
    const mergedRecord = cloud.get('user_idemp', 'auroblocks');
    assert.match(mergedRecord.checksum, /^[a-f0-9]{64}$/, 'Merged push checksum must be real SHA-256, not merged_<timestamp>');

    const repeatAfterMerge = await sdk.sync.syncNow('auroblocks');
    assert.equal(repeatAfterMerge.results[0].action, 'in_sync');
    assert.equal(cloud.getStats().pushCount, pushedCountAfterMerge, 'Re-sync immediately after auto_merged_and_pushed must NOT push again');

    sdk.dispose();
  });

  test('Sync-3: Optimistic concurrency conflict with serverRecord resolves and retries deterministically in 1 shot', async () => {
    const { env } = createSdkEnv();
    const auth = createMockAuthProvider();
    const cloud = createMockCloudSyncStore();
    const sdk = createAuroMindSDK({ env });

    await sdk.init({
      gameId: 'portal',
      capabilities: { authEnabled: true, cloudSyncEnabled: true },
      providers: { auth, cloudSync: cloud.provider }
    });
    const blocksHarness = createInMemoryGameAdapter('auroblocks', {
      highScore: 1200,
      completedStages: [1, 2]
    });
    // Use a strategy that returns use_local on first check and auto_merged on conflict retry
    let resolveCalls = 0;
    const customStrategy = {
      gameId: 'auroblocks',
      resolve(local, remote) {
        resolveCalls += 1;
        if (resolveCalls === 1) {
          return { status: 'use_local', resolvedPayload: local.payload };
        }
        return AuroBlocksMergeStrategy.resolve(local, remote);
      }
    };
    sdk.adapters.register(blocksHarness.adapter, { mergeStrategy: customStrategy });
    await sdk.adapters.init('auroblocks');

    // Seed an older server record at rev 4 so first sync takes the use_local branch
    cloud.seed('user_conflict', 'auroblocks', {
      userId: 'user_conflict',
      gameId: 'auroblocks',
      revision: 4,
      checksum: await computePayloadChecksum({ highScore: 500, completedStages: [1] }),
      payload: { highScore: 500, completedStages: [1] },
      updatedAt: new Date().toISOString()
    });

    await sdk.auth.signIn('email', { email: 'conflict@example.com' });
    sdk.sync.setConsent(true);

    // Simulate concurrent remote write arriving between pull and push (rev 5)
    cloud.setForceConflictOnce({
      userId: 'user_conflict',
      gameId: 'auroblocks',
      revision: 5,
      checksum: await computePayloadChecksum({ highScore: 1800, completedStages: [1, 4] }),
      payload: { highScore: 1800, completedStages: [1, 4] },
      updatedAt: new Date().toISOString()
    });

    const res = await sdk.sync.syncNow('auroblocks');
    assert.equal(res.status, 'success');
    assert.equal(res.results[0].action, 'conflict_resolved_and_pushed');
    assert.equal(res.results[0].revision, 6);

    const finalLocal = blocksHarness.getState();
    assert.equal(finalLocal.highScore, 1800);
    assert.deepEqual(new Set(finalLocal.completedStages), new Set([1, 2, 4]));
    assert.equal(sdk.sync.getPendingOutboxCount(), 0);

    sdk.dispose();
  });

  test('Sync-4 & Sync-5: Offline outbox persists to IndexedDB across SDK restart, retains failed syncs, and flushes cleanly on retry', async () => {
    const sharedStorage = createMemoryStorage();
    const sharedIdb = createFakeIndexedDB();
    const { env: env1 } = createSdkEnv({ storage: sharedStorage, idb: sharedIdb, onLine: false });
    const auth1 = createMockAuthProvider();
    const cloud = createMockCloudSyncStore();

    const sdk1 = createAuroMindSDK({ env: env1 });
    await sdk1.init({
      gameId: 'portal',
      capabilities: { authEnabled: true, cloudSyncEnabled: true },
      providers: { auth: auth1, cloudSync: cloud.provider }
    });
    const harness1 = createInMemoryGameAdapter('auroblocks', { highScore: 777, completedStages: [1] });
    sdk1.adapters.register(harness1.adapter, { mergeStrategy: AuroBlocksMergeStrategy });
    await sdk1.adapters.init('auroblocks');

    // Queue mutation while offline -> persisted to AuroMindPlatformDB.platform_sync_outbox
    await sdk1.sync.queueLocalChange('auroblocks');
    const persistedOutbox = sharedIdb._peekStore('AuroMindPlatformDB', 'platform_sync_outbox');
    assert.ok(
      Object.values(persistedOutbox).some((m) => m && m.gameId === 'auroblocks'),
      'Offline mutation must persist in IndexedDB platform_sync_outbox'
    );
    sdk1.dispose();

    // Clear localStorage outbox mirror to prove IDB outbox alone recovers pending sync on restart!
    sharedStorage.removeItem('auromind.platform.v1.sync.outbox');

    // Cold restart on a fresh SDK instance now back online
    const { env: env2 } = createSdkEnv({ storage: sharedStorage, idb: sharedIdb, onLine: true });
    const auth2 = createMockAuthProvider();
    const sdk2 = createAuroMindSDK({ env: env2 });
    await sdk2.init({
      gameId: 'portal',
      capabilities: { authEnabled: true, cloudSyncEnabled: true },
      providers: { auth: auth2, cloudSync: cloud.provider }
    });
    const harness2 = createInMemoryGameAdapter('auroblocks', { highScore: 777, completedStages: [1] });
    sdk2.adapters.register(harness2.adapter, { mergeStrategy: AuroBlocksMergeStrategy });
    await sdk2.adapters.init('auroblocks');

    assert.equal(sdk2.sync.getPendingOutboxCount(), 1, 'Restarted SDK must hydrate pending mutation from IDB outbox');

    await sdk2.auth.signIn('email', { email: 'retry@example.com' }, { migrateFromGuest: true });
    sdk2.sync.setConsent(true);

    // First flush fails transiently -> outbox MUST retain item
    cloud.setFailNextPush('503 Network Interrupted');
    const failedRun = await sdk2.sync.drainOutbox();
    assert.equal(failedRun.results[0].action, 'error');
    assert.equal(sdk2.sync.getPendingOutboxCount(), 1, 'Failed sync must preserve item in outbox for retry');

    // Second flush succeeds -> clears both memory & IDB outbox
    const recoveredRun = await sdk2.sync.drainOutbox();
    assert.equal(recoveredRun.status, 'success');
    assert.equal(sdk2.sync.getPendingOutboxCount(), 0);
    const outboxAfter = sharedIdb._peekStore('AuroMindPlatformDB', 'platform_sync_outbox');
    assert.equal(
      Object.values(outboxAfter).some((m) => m && m.gameId === 'auroblocks'),
      false,
      'Successfully synced item must be cleared from IDB outbox'
    );

    sdk2.dispose();
  });

  test('Sync-6: Mid-flight account switch during syncNow() aborts safely with zero cross-user save or metadata leakage', async () => {
    const { env } = createSdkEnv();
    const auth = createMockAuthProvider();
    const cloud = createMockCloudSyncStore();

    const alphaPayload = { highScore: 99999, completedStages: [1, 2, 3, 4, 5] };
    cloud.seed('user_alpha', 'auroblocks', {
      userId: 'user_alpha',
      gameId: 'auroblocks',
      revision: 4,
      checksum: await computePayloadChecksum(alphaPayload),
      payload: alphaPayload,
      updatedAt: new Date().toISOString()
    });

    const sdk = createAuroMindSDK({ env });
    await sdk.init({
      gameId: 'portal',
      capabilities: { authEnabled: true, cloudSyncEnabled: true },
      providers: { auth, cloudSync: cloud.provider }
    });
    const blocksHarness = createInMemoryGameAdapter('auroblocks', { highScore: 100, completedStages: [1] });
    sdk.adapters.register(blocksHarness.adapter, { mergeStrategy: AuroBlocksMergeStrategy });
    await sdk.adapters.init('auroblocks');

    await sdk.auth.signIn('email', { email: 'alpha@example.com' });
    sdk.sync.setConsent(true);

    // While pullLatest for user_alpha is in flight, switch authenticated session to user_beta!
    cloud.setOnBeforePull(async () => {
      auth._emitSwitch('user_beta', 'beta@example.com');
    });

    const aborted = await sdk.sync.syncNow('auroblocks');
    assert.equal(aborted.status, 'aborted');
    assert.equal(aborted.reason, 'account_changed_mid_sync');

    // Verify user_alpha's cloud score (99999) was NEVER applied to local state after switching to beta
    assert.equal(blocksHarness.getState().highScore, 100, 'Alpha save must not overwrite state after switch to Beta');
    assert.equal(cloud.get('user_beta', 'auroblocks'), null, 'Alpha save must never be pushed to Beta');
    // Verify B19.5-02 sync metadata isolation remains intact
    assert.equal(sdk.sync.getSyncStatus().lastSyncAt, null);

    sdk.dispose();
  });

  test('Sync-7: Corrupt remote envelopes, mismatched gameId, and remote Sankalpa vault injection are strictly rejected', async () => {
    const { env } = createSdkEnv();
    const auth = createMockAuthProvider();
    const cloud = createMockCloudSyncStore();

    // Seed corrupt remote record containing forbidden sankalpa_e2ee_vault
    cloud.seed('user_sec', 'auromandala', {
      userId: 'user_sec',
      gameId: 'auromandala',
      revision: 2,
      checksum: 'bad_chk',
      payload: {
        schemaVersion: 2,
        artworks: {},
        sankalpa_e2ee_vault: { secret: 'INJECTED_REMOTE_SECRET' }
      },
      updatedAt: new Date().toISOString()
    });
    // Seed remote record with mismatched gameId
    cloud.seed('user_sec', 'auroblocks', {
      userId: 'user_sec',
      gameId: 'wrong-game-slug',
      revision: 2,
      checksum: 'mismatch_chk',
      payload: { highScore: 5000, completedStages: [1] },
      updatedAt: new Date().toISOString()
    });

    const sdk = createAuroMindSDK({ env });
    await sdk.init({
      gameId: 'portal',
      capabilities: { authEnabled: true, cloudSyncEnabled: true },
      providers: { auth, cloudSync: cloud.provider }
    });
    const mandalaHarness = createInMemoryGameAdapter('auromandala', { schemaVersion: 2, artworks: {} });
    const blocksHarness = createInMemoryGameAdapter('auroblocks', { highScore: 50, completedStages: [] });
    sdk.adapters.register(mandalaHarness.adapter, { mergeStrategy: AuroMandalaMergeStrategy });
    sdk.adapters.register(blocksHarness.adapter, { mergeStrategy: AuroBlocksMergeStrategy });
    await sdk.adapters.init('auromandala');
    await sdk.adapters.init('auroblocks');

    await sdk.auth.signIn('email', { email: 'sec@example.com' });
    sdk.sync.setConsent(true);

    const res = await sdk.sync.syncNow();
    assert.equal(res.status, 'success');
    assert.ok(res.results.some((r) => r.gameId === 'auromandala' && r.action === 'blocked_remote_local_only_vault'));
    assert.ok(res.results.some((r) => r.gameId === 'auroblocks' && r.action === 'invalid_remote_envelope' && r.reason === 'REMOTE_GAME_ID_MISMATCH'));
    assert.equal(blocksHarness.getState().highScore, 50, 'Local state must remain untouched on invalid remote envelope');

    sdk.dispose();
  });

  test('Sync-8: createSupabaseSyncProvider.pullLatest handles hyphenated game slugs without swapping userId/gameId', async () => {
    const capturedQueries = [];
    const fakeSupabaseClient = {
      isConfigured: () => true,
      from(table) {
        const filters = {};
        const builder = {
          select() { return builder; },
          eq(col, val) {
            filters[col] = val;
            return builder;
          },
          async maybeSingle() {
            capturedQueries.push({ table, ...filters });
            return { data: null, error: null };
          }
        };
        return builder;
      }
    };

    const provider = createSupabaseSyncProvider(fakeSupabaseClient);

    // Standard order (userId, gameId) with non-UUID userId + hyphenated gameId
    await provider.pullLatest('usr_non_uuid_01', 'word-riddle');
    await provider.pullLatest('usr_non_uuid_01', 'vak-living-sanctuary');
    // Legacy reversed order (gameId, userId)
    await provider.pullLatest('word-riddle', 'usr_non_uuid_01');

    assert.equal(capturedQueries[0].user_id, 'usr_non_uuid_01');
    assert.equal(capturedQueries[0].game_id, 'word-riddle');
    assert.equal(capturedQueries[1].user_id, 'usr_non_uuid_01');
    assert.equal(capturedQueries[1].game_id, 'vak-living-sanctuary');
    assert.equal(capturedQueries[2].user_id, 'usr_non_uuid_01');
    assert.equal(capturedQueries[2].game_id, 'word-riddle');
  });

  test('Sync-9: Cross-tab guest identity & sync state converge cleanly without overwriting progress', async () => {
    const sharedStorage = createMemoryStorage();
    const sharedIdb = createFakeIndexedDB();
    const Bus = createFakeBroadcastBus();
    const { env: envA } = createSdkEnv({ storage: sharedStorage, idb: sharedIdb, BroadcastChannelImpl: Bus });
    const { env: envB } = createSdkEnv({ storage: sharedStorage, idb: sharedIdb, BroadcastChannelImpl: Bus });

    const sdkA = createAuroMindSDK({ env: envA });
    const sdkB = createAuroMindSDK({ env: envB });
    await Promise.all([sdkA.init({ gameId: 'portal' }), sdkB.init({ gameId: 'portal' })]);

    assert.equal(sdkA.identity.getGuestId(), sdkB.identity.getGuestId(), 'Both tabs must converge to identical guestId');
    sdkA.dispose();
    sdkB.dispose();
  });
});

describe('Part 1B — Scope B: AuroMandala Artwork Persistence & Recovery', () => {
  test('Art-1: artwork-concurrency.js has zero node:crypto dependency and matches Web Crypto SHA-256', async () => {
    const src = fs.readFileSync(path.join(__dirname, 'assets/sdk/artwork-concurrency.js'), 'utf8');
    assert.equal(src.includes('node:crypto'), false, 'artwork-concurrency.js must be browser-safe with zero node:crypto import');

    const sampleStrokes = [{ x: 12, y: 34, color: '#f5d061', label: 'ॐ Lotus' }];
    const syncHash = computeArtworkContentHash(sampleStrokes);
    const asyncHash = await computePayloadChecksum(sampleStrokes);
    assert.match(syncHash, /^[a-f0-9]{64}$/);
    assert.equal(syncHash, asyncHash, 'Synchronous SHA-256 fallback must match Web Crypto SHA-256 identically (including Unicode)');
  });

  test('Art-2: Local-first gallery autosave, reload persistence, CRUD, and 10 immutable snapshots', () => {
    const storage = createMemoryStorage();
    const store1 = createLocalArtworkStore({ storage, accountScope: 'guest' });
    assert.equal(store1.cloudSyncOptIn, false, 'Artwork storage must remain local-first by default');

    const { artwork: created } = store1.autosave({ title: 'Golden Yantra', strokes: [{ x: 1, y: 1 }] });
    assert.equal(created.snapshots.length, 1);
    assert.equal(Object.isFrozen(created.snapshots[0]), true, 'Snapshots must be immutable (frozen)');

    // Push 13 more autosaves -> total 14 revisions, capped to latest 10 immutable snapshots
    let latest = created;
    for (let i = 2; i <= 14; i++) {
      latest = store1.autosave({
        artworkId: created.artworkId,
        strokes: [{ x: i, y: i * 2 }]
      }).artwork;
    }

    assert.equal(latest.revision, 14);
    assert.equal(latest.parentRevisionId, `${created.artworkId}@rev_13`);
    assert.equal(latest.snapshots.length, MAX_ARTWORK_SNAPSHOTS);
    assert.equal(latest.snapshots[0].revision, 5);
    assert.equal(latest.snapshots[9].revision, 14);
    for (const snap of latest.snapshots) {
      assert.equal(Object.isFrozen(snap), true);
    }

    // Simulated page reload -> new store instance reading same storage
    const store2 = createLocalArtworkStore({ storage, accountScope: 'guest' });
    const reloaded = store2.get(created.artworkId);
    assert.ok(reloaded);
    assert.equal(reloaded.title, 'Golden Yantra');
    assert.equal(reloaded.revision, 14);
    assert.equal(reloaded.snapshots.length, 10);

    // Soft-delete (tombstone) & restore (causal resurrection)
    const delRes = store2.softDelete(created.artworkId);
    assert.equal(delRes.artwork.deleted, true);
    assert.equal(store2.list().length, 0);
    assert.equal(store2.list({ includeDeleted: true }).length, 1);

    const restored = store2.restore(created.artworkId, [{ x: 99, y: 99 }]);
    assert.equal(restored.artwork.deleted, false);
    assert.equal(restored.artwork.parentRevisionId, `${created.artworkId}@rev_${delRes.artwork.tombstoneRevision}`);
    assert.equal(store2.list().length, 1);
  });

  test('Art-3: Causal edit/edit conflict, pre-tombstone conflict fork, resurrection, and no double suffixing', () => {
    const storage = createMemoryStorage();
    const store = createLocalArtworkStore({ storage, accountScope: 'user_art' });

    const base = createArtworkEntity({
      artworkId: 'art_causal_1',
      title: 'Dawn Mandala',
      strokes: [{ x: 1, y: 1 }],
      revision: 1
    });
    const localV2 = appendArtworkSnapshot(base, [{ x: 2, y: 2 }]);
    const remoteV2 = appendArtworkSnapshot(base, [{ x: 9, y: 9 }]);

    store.create(localV2);
    const mergeRes = store.mergeRemote({ art_causal_1: remoteV2 });
    assert.equal(mergeRes.actions[0].action, 'FORKED_ON_CONCURRENT_EDIT');

    const all = store.list();
    assert.equal(all.length, 2, 'Local original and forked Recovered Copy must both exist');
    const original = all.find((a) => a.artworkId === 'art_causal_1');
    const recovered = all.find((a) => a.artworkId !== 'art_causal_1');
    assert.equal(original.title, 'Dawn Mandala');
    assert.equal(recovered.title, 'Dawn Mandala (Recovered Copy)');

    // Ensure already-recovered title does NOT double-append "(Recovered Copy)"
    const conflictAgain = resolveArtworkCausalConflict(
      createArtworkEntity({ artworkId: 'x1', title: 'Dawn Mandala (Recovered Copy)', strokes: [{ x: 1 }], revision: 2, parentRevisionId: 'x1@rev_1' }),
      createArtworkEntity({ artworkId: 'x1', title: 'Dawn Mandala (Recovered Copy)', strokes: [{ x: 2 }], revision: 2, parentRevisionId: 'x1@rev_1' })
    );
    assert.equal(conflictAgain.forked.title, 'Dawn Mandala (Recovered Copy)');

    // Edit/delete conflict: local tombstoned at rev 3 vs pre-delete remote edit from rev 1
    const deletedLocal = markArtworkDeleted(localV2);
    const preDeleteRemote = createArtworkEntity({
      artworkId: 'art_causal_1',
      title: 'Dawn Mandala',
      strokes: [{ x: 42, y: 42 }],
      revision: 2,
      parentRevisionId: 'art_causal_1@rev_1'
    });
    const tombConflict = resolveArtworkCausalConflict(deletedLocal, preDeleteRemote);
    assert.equal(tombConflict.action, 'FORKED_ON_TOMBSTONE_CONFLICT');
    assert.equal(tombConflict.resolved.deleted, true);
    assert.equal(tombConflict.forked.title, 'Dawn Mandala (Recovered Copy)');

    // Genuine causal resurrection descending from tombstone revision
    const resurrectedRemote = resurrectArtwork(deletedLocal, [{ x: 77, y: 77 }]);
    const resurrectConflict = resolveArtworkCausalConflict(deletedLocal, resurrectedRemote);
    assert.equal(resurrectConflict.action, 'RESURRECTED');
    assert.equal(resurrectConflict.resolved.deleted, false);
    assert.equal(resurrectConflict.forked, null);
  });

  test('Art-4: Corrupt JSON recovery, QuotaExceededError fallback, account isolation, and Sankalpa local-only invariant', async () => {
    // 1. Corrupt JSON recovery + quarantine
    const storage = createMemoryStorage();
    const prevLS = globalThis.localStorage;
    globalThis.localStorage = storage;
    try {
      storage.setItem('auromandala.artworks.v1:guest', '{corrupt_json_truncated');
      const recoveredStore = createLocalArtworkStore({ storage, accountScope: 'guest' });
      assert.equal(recoveredStore.list().length, 0);
      assert.equal(recoveredStore.getStorageStatus().corruptedRecoveries, 1);
      const quarantinedKeys = Object.keys(storage._dump()).filter((k) => k.startsWith('_corrupt_auromandala_guest_'));
      assert.equal(quarantinedKeys.length, 1, 'Corrupt artwork store must be quarantined');

      // 2. QuotaExceededError graceful fallback to in-memory store
      const fullStorage = createMemoryStorage({ failOnSet: true, quotaError: true });
      const quotaStore = createLocalArtworkStore({ storage: fullStorage, accountScope: 'guest' });
      const { artwork, persistence } = quotaStore.autosave({ title: 'Offline Lotus', strokes: [{ x: 3, y: 3 }] });
      assert.equal(persistence.persistedToStorage, false);
      assert.equal(persistence.quotaExceeded, true);
      assert.equal(persistence.fallbackMode, 'memory');
      assert.equal(quotaStore.get(artwork.artworkId).title, 'Offline Lotus');

      // 3. Per-account gallery isolation (Account A cannot leak into Account B)
      const storeA = createLocalArtworkStore({ storage, accountScope: 'account_A' });
      const storeB = createLocalArtworkStore({ storage, accountScope: 'account_B' });
      storeA.autosave({ title: 'Alice Private Mandala', strokes: [{ x: 7, y: 7 }] });
      storeB.reload();
      assert.equal(storeA.list().length, 1);
      assert.equal(storeB.list().length, 0, 'Account B must not see Account A artworks');

      // 4. AuroMandala bridge: Sankalpa E2EE vault NEVER exported and NEVER overwritten on applyEnvelope
      const bridgeAdapter = createAuroMandalaGameAdapter();
      storage.setItem(SANKALPA_VAULT_KEY, JSON.stringify({ encrypted: 'AES_GCM_CIPHERTEXT_ONLY_LOCAL' }));
      storage.setItem(MANDALA_CACHE_KEY, JSON.stringify({
        version: 2,
        highestStageCleared: 4,
        sankalpa: { secretIntention: 'LOCAL_ONLY_SACRED_INTENTION' },
        savedArtworks: [{ id: 'art_local_1', title: 'Local Sun', strokesCount: 15 }]
      }));

      const exported = await bridgeAdapter.exportEnvelope('guest_11111111-1111-4111-8111-111111111111');
      const serializedExport = JSON.stringify(exported);
      assert.equal(serializedExport.includes('LOCAL_ONLY_SACRED_INTENTION'), false);
      assert.equal(serializedExport.includes('AES_GCM_CIPHERTEXT_ONLY_LOCAL'), false);

      // Apply a remote envelope attempting to inject sankalpa + conflicting artwork
      const applied = await bridgeAdapter.applyEnvelope({
        gameId: 'auromandala',
        payload: {
          schemaVersion: 2,
          sankalpa: { secretIntention: 'MALICIOUS_OVERWRITE' },
          sankalpa_e2ee_vault: 'MALICIOUS_VAULT',
          artworks: {
            art_local_1: { artworkId: 'art_local_1', title: 'Local Sun', currentVersion: 2, strokesCount: 22 }
          },
          progression: { highestStageCleared: 6 }
        }
      });
      assert.equal(applied, true);
      const afterCache = JSON.parse(storage.getItem(MANDALA_CACHE_KEY));
      assert.equal(afterCache.sankalpa.secretIntention, 'LOCAL_ONLY_SACRED_INTENTION', 'Local Sankalpa must remain completely untouched');
      assert.equal(afterCache.sankalpa_e2ee_vault, undefined);
      assert.equal(afterCache.highestStageCleared, 6);
      assert.equal(Object.keys(afterCache.savedArtworks).length, 2, 'Conflicting remote artwork must fork non-destructively');
    } finally {
      if (prevLS === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = prevLS;
    }
  });
});

describe('Part 1C — Scope C: Flora Database Dual-Write Parity & Consistency', () => {
  test('Flora-1, Flora-2 & Flora-3: Dual-write normal parity, transient retry recovery, persistent failure read-after-write consistency & reconciliation', async () => {
    const prevLS = globalThis.localStorage;
    const prevIDB = globalThis.indexedDB;
    const storage = createMemoryStorage();
    const fakeIdb = createFakeIndexedDB();
    globalThis.localStorage = storage;
    globalThis.indexedDB = fakeIdb;
    resetIndexedDBConnection();

    try {
      // 1. Healthy dual-write parity + idempotency
      const res1 = await setItemDualWrite('auro_match_unlocked_tiles', ['lotus', 'rose']);
      assert.equal(res1.ok, true);
      assert.equal(res1.lsOk, true);
      assert.equal(res1.idbOk, true);
      assert.equal(res1.partialFailure, false);
      assert.equal(storage.getItem('auro_match_unlocked_tiles'), '["lotus","rose"]');
      assert.equal(fakeIdb._peekStore('AuroMatchDB', 'gameState').auro_match_unlocked_tiles, '["lotus","rose"]');

      // 2. Transient IDB failure on 1st attempt -> recovers automatically on retry 2
      fakeIdb._setFailPutCount(1);
      const resRetry = await setItemDualWrite('auro_match_unlocked_tiles', ['lotus', 'rose', 'jasmine'], {
        maxRetries: 2,
        retryDelayMs: 1
      });
      assert.equal(resRetry.ok, true);
      assert.equal(resRetry.idbOk, true);
      assert.equal(resRetry.partialFailure, false);
      assert.equal(resRetry.attempts, 2);
      assert.equal(fakeIdb._peekStore('AuroMatchDB', 'gameState').auro_match_unlocked_tiles, '["lotus","rose","jasmine"]');

      // 3. Persistent IDB failure -> partialFailure tracked + read-after-write consistency NEVER returns stale IDB
      fakeIdb._setAlwaysFailPut(true);
      const resFail = await setItemDualWrite('auro_match_unlocked_tiles', ['lotus', 'rose', 'jasmine', 'champa'], {
        maxRetries: 1,
        retryDelayMs: 1
      });
      assert.equal(resFail.ok, true, 'Primary localStorage write succeeded');
      assert.equal(resFail.lsOk, true);
      assert.equal(resFail.idbOk, false);
      assert.equal(resFail.partialFailure, true);
      assert.equal(getDualWriteStatus('auro_match_unlocked_tiles').pendingRepair, true);

      // Verify IDB still holds stale value while getItemAsync returns FRESH value (read-after-write consistency!)
      assert.equal(fakeIdb._peekStore('AuroMatchDB', 'gameState').auro_match_unlocked_tiles, '["lotus","rose","jasmine"]');
      const rawRead = await getItemAsync('auro_match_unlocked_tiles');
      assert.deepEqual(JSON.parse(rawRead), ['lotus', 'rose', 'jasmine', 'champa'], 'getItemAsync must never serve stale IndexedDB data after partial write failure');

      // 4. IDB recovers -> reconcileDualWriteParity() heals AuroMatchDB and clears pending status
      fakeIdb._setAlwaysFailPut(false);
      const recon = await reconcileDualWriteParity();
      assert.equal(recon.reconciled, 1);
      assert.equal(recon.remaining, 0);
      assert.equal(getDualWriteStatus().inSync, true);
      assert.equal(
        fakeIdb._peekStore('AuroMatchDB', 'gameState').auro_match_unlocked_tiles,
        '["lotus","rose","jasmine","champa"]'
      );
    } finally {
      resetIndexedDBConnection();
      if (prevLS === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = prevLS;
      if (prevIDB === undefined) delete globalThis.indexedDB;
      else globalThis.indexedDB = prevIDB;
    }
  });

  test('Flora-4 & Flora-5: saveProfileState() set-union prevents lost Flora unlocks, and autoHealFromIndexedDB() reconciles diverged stores', async () => {
    const prevLS = globalThis.localStorage;
    const prevIDB = globalThis.indexedDB;
    const storage = createMemoryStorage();
    const fakeIdb = createFakeIndexedDB();
    globalThis.localStorage = storage;
    globalThis.indexedDB = fakeIdb;
    resetIndexedDBConnection();

    try {
      // Simulate Tab 1 writing 2 Flora unlocks & 1 consecration to localStorage
      storage.setItem('auro_match_unlocked_tiles', JSON.stringify(['flora_a', 'flora_b']));
      storage.setItem('auro_match_consecrations', JSON.stringify([{ id: 'ref_1', text: 'Tab 1 reflection' }]));
      storage.setItem('auro_match_user', JSON.stringify({
        profile: { lotusPetalCount: 15, consciousnessPoints: 200 },
        progression: { completedLevelsCount: 2, completedLevelIds: ['flora_a', 'flora_b'], unlockedThemes: ['flowers'] },
        settings: {},
        dailyDrawDate: '2026-11-23'
      }));

      // Tab 2 (in-memory profileState) has EQUAL-LENGTH disjoint unlocks ['flora_c', 'flora_d'] and reflection ref_2
      profileState.profile.lotusPetalCount = 10;
      profileState.profile.consciousnessPoints = 350;
      profileState.progression.completedLevelsCount = 2;
      profileState.progression.completedLevelIds = ['flora_c', 'flora_d'];
      profileState.progression.unlockedThemes = ['flowers', 'qualities'];
      profileState.reflections = [{ id: 'ref_2', text: 'Tab 2 reflection' }];

      assert.equal(saveProfileState(), true);
      await new Promise((r) => setTimeout(r, 20));

      const mergedTiles = JSON.parse(storage.getItem('auro_match_unlocked_tiles'));
      const mergedRefs = JSON.parse(storage.getItem('auro_match_consecrations'));
      const mergedUser = JSON.parse(storage.getItem('auro_match_user'));

      assert.deepEqual(new Set(mergedTiles), new Set(['flora_a', 'flora_b', 'flora_c', 'flora_d']), 'Equal-length disjoint Flora unlocks must union-merge without loss');
      assert.equal(mergedRefs.length, 2, 'Equal-length disjoint reflections must union-merge without loss');
      assert.equal(mergedUser.profile.lotusPetalCount, 15);
      assert.equal(mergedUser.profile.consciousnessPoints, 350);
      assert.equal(mergedUser.progression.completedLevelsCount, 4);

      // Now simulate divergence: AuroMatchDB has an extra Flora unlock 'flora_idb_only' missing from localStorage!
      fakeIdb._seedStore(
        'AuroMatchDB',
        'gameState',
        'auro_match_unlocked_tiles',
        JSON.stringify(['flora_a', 'flora_idb_only'])
      );
      const healedDivergence = await autoHealFromIndexedDB();
      assert.equal(healedDivergence, true, 'autoHealFromIndexedDB must detect and reconcile diverged Flora records');

      const lsAfterHeal = JSON.parse(storage.getItem('auro_match_unlocked_tiles'));
      const idbAfterHeal = JSON.parse(fakeIdb._peekStore('AuroMatchDB', 'gameState').auro_match_unlocked_tiles);
      assert.deepEqual(new Set(lsAfterHeal), new Set(['flora_a', 'flora_b', 'flora_c', 'flora_d', 'flora_idb_only']));
      assert.deepEqual(new Set(idbAfterHeal), new Set(lsAfterHeal), 'Both stores must converge identically');
    } finally {
      resetIndexedDBConnection();
      if (prevLS === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = prevLS;
      if (prevIDB === undefined) delete globalThis.indexedDB;
      else globalThis.indexedDB = prevIDB;
    }
  });

  test('Flora-6: AuroMatch bridge applyEnvelope performs non-destructive union dual-write parity + Flora DB sacred file untouched', async () => {
    const prevLS = globalThis.localStorage;
    const prevIDB = globalThis.indexedDB;
    const storage = createMemoryStorage();
    const fakeIdb = createFakeIndexedDB();
    globalThis.localStorage = storage;
    globalThis.indexedDB = fakeIdb;
    resetIndexedDBConnection();

    try {
      storage.setItem('auro_match_unlocked_tiles', JSON.stringify(['flora_local_1']));
      storage.setItem('auro_match_consecrations', JSON.stringify([{ id: 'local_c1', text: 'Local' }]));
      storage.setItem('auro_match_user', JSON.stringify({
        profile: { lotusPetalCount: 20, consciousnessPoints: 100 },
        progression: { completedLevelsCount: 1, completedLevelIds: ['flora_local_1'], unlockedThemes: ['flowers'] },
        settings: {},
        dailyDrawDate: '2026-11-22'
      }));

      const bridge = createAuroMatchBridgeAdapter();
      const applied = await bridge.applyEnvelope({
        gameId: 'auromatch',
        payload: {
          schemaVersion: 1,
          user: {
            profile: { lotusPetalCount: 12, consciousnessPoints: 260 },
            progression: { completedLevelsCount: 1, completedLevelIds: ['flora_cloud_2'], unlockedThemes: ['qualities'] },
            settings: {},
            dailyDrawDate: '2026-11-23'
          },
          unlockedTiles: ['flora_cloud_2'],
          consecrations: [{ id: 'cloud_c2', text: 'Cloud' }]
        }
      });

      assert.equal(applied, true);
      const lsTiles = JSON.parse(storage.getItem('auro_match_unlocked_tiles'));
      const idbTiles = JSON.parse(fakeIdb._peekStore('AuroMatchDB', 'gameState').auro_match_unlocked_tiles);
      assert.deepEqual(new Set(lsTiles), new Set(['flora_local_1', 'flora_cloud_2']));
      assert.deepEqual(new Set(idbTiles), new Set(['flora_local_1', 'flora_cloud_2']));

      // Reject wrong gameId
      const wrongGame = await bridge.applyEnvelope({ gameId: 'auroblocks', payload: { unlockedTiles: ['bad'] } });
      assert.equal(wrongGame, false);

      // Verify sacred Flora DB remains 100% untouched
      const floraBuf = fs.readFileSync(path.join(__dirname, 'games/auromatch/src/models/floraDatabase.js'));
      const floraSha = crypto.createHash('sha256').update(floraBuf).digest('hex');
      assert.equal(floraBuf.length, 2002176);
      assert.equal(floraSha, '689d035cd52abd8d342528d8c5f61f298916b8052b8287450be4931cf8ae1a3a');
    } finally {
      resetIndexedDBConnection();
      if (prevLS === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = prevLS;
      if (prevIDB === undefined) delete globalThis.indexedDB;
      else globalThis.indexedDB = prevIDB;
    }
  });

  test('Flora-7: AuroMatch storageAdapter checksum covers entire envelope, purge blocks writes, and applyEnvelope isolates accounts', async () => {
    const prevLS = globalThis.localStorage;
    const prevIDB = globalThis.indexedDB;
    const storage = createMemoryStorage();
    const fakeIdb = createFakeIndexedDB();
    globalThis.localStorage = storage;
    globalThis.indexedDB = fakeIdb;
    resetIndexedDBConnection();

    try {
      const adapter = createAuroMatchNativeAdapter();

      // 1. Checksum represents entire envelope, not merely selected counters
      profileState.progression.completedLevelsCount = 5;
      profileState.profile.lotusPetalCount = 100;
      profileState.reflections = [{ id: 'refl_1', text: 'Peace' }];
      profileState.settings.volumeRaga = 0.5;

      const env1 = await adapter.exportEnvelope('guest_test');
      assert.ok(env1.checksum && typeof env1.checksum === 'string');

      // Keep counters identical (completedLevelsCount=5, lotusPetalCount=100) but change reflections
      profileState.reflections = [{ id: 'refl_2', text: 'Joy' }];
      const env2 = await adapter.exportEnvelope('guest_test');
      assert.notEqual(env1.checksum, env2.checksum, 'Changing reflections must change envelope checksum even if counters are identical');

      // Change settings only
      profileState.settings.volumeRaga = 0.9;
      const env3 = await adapter.exportEnvelope('guest_test');
      assert.notEqual(env2.checksum, env3.checksum, 'Changing settings must change envelope checksum even if counters are identical');

      // 2. Purge lock blocks pending writes and repopulation
      setPurgeLock(true);
      assert.equal(isPurgeActive(), true);
      assert.equal(saveProfileState(), false, 'saveProfileState must return false when purge is active');
      const dualWriteRes = await setItemDualWrite('test_key', 'test_value');
      assert.equal(dualWriteRes.ok, false);
      assert.equal(dualWriteRes.blockedByPurge, true, 'setItemDualWrite must be blocked by active purge');
      setPurgeLock(false);
      assert.equal(isPurgeActive(), false);

      // 3. applyEnvelope isolates accounts and avoids hydrating previous account local data
      storage.setItem('auro_match_consecrations', JSON.stringify([{ id: 'acct_a_refl', text: 'User A Secret' }]));
      const userBEnvelope = {
        gameId: 'auromatch',
        payload: {
          profileState: {
            profile: { lotusPetalCount: 2, consciousnessPoints: 50 },
            progression: { completedLevelsCount: 1, completedLevelIds: ['flora_b'], unlockedThemes: ['flowers'] },
            settings: { volumeRaga: 0.3 },
            reflections: [{ id: 'acct_b_refl', text: 'User B Reflection' }],
            dailyDrawDate: '2026-11-25'
          }
        }
      };

      const applied = await adapter.applyEnvelope(userBEnvelope);
      assert.equal(applied, true);
      const consecrationsAfterApply = JSON.parse(storage.getItem('auro_match_consecrations'));
      assert.deepEqual(consecrationsAfterApply, [{ id: 'acct_b_refl', text: 'User B Reflection' }], 'applyEnvelope must isolate User B reflections without leaking User A data');
    } finally {
      resetIndexedDBConnection();
      if (prevLS === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = prevLS;
      if (prevIDB === undefined) delete globalThis.indexedDB;
      else globalThis.indexedDB = prevIDB;
    }
  });

  test('Flora-8: AuroMatch bridge and native adapters cross-format envelope support, account switch isolation, and purge safety', async () => {
    const prevLS = globalThis.localStorage;
    const prevIDB = globalThis.indexedDB;
    const storage = createMemoryStorage();
    const fakeIdb = createFakeIndexedDB();
    globalThis.localStorage = storage;
    globalThis.indexedDB = fakeIdb;
    resetIndexedDBConnection();

    try {
      const nativeAdapter = createAuroMatchNativeAdapter();
      const bridgeAdapter = createAuroMatchBridgeAdapter();

      // 1. Cross-format: Bridge payload { user, consecrations, unlockedTiles } applied to native adapter
      storage.setItem('auro_match_consecrations', JSON.stringify([{ id: 'guest_c', text: 'Guest' }]));
      const bridgeEnvelope = {
        gameId: 'auromatch',
        payload: {
          user: {
            profile: { lotusPetalCount: 45, consciousnessPoints: 120 },
            progression: { completedLevelsCount: 3, completedLevelIds: ['flora_cross_1', 'flora_cross_2'], unlockedThemes: ['flowers'] }
          },
          consecrations: [{ id: 'cross_c1', text: 'Cross Consecration' }],
          unlockedTiles: ['flora_cross_1', 'flora_cross_2']
        }
      };
      const nativeApplied = await nativeAdapter.applyEnvelope(bridgeEnvelope);
      assert.equal(nativeApplied, true);
      assert.equal(profileState.profile.lotusPetalCount, 45);
      assert.deepEqual(profileState.progression.completedLevelIds, ['flora_cross_1', 'flora_cross_2']);
      assert.deepEqual(profileState.reflections, [{ id: 'cross_c1', text: 'Cross Consecration' }]);

      // 2. Cross-format: Native payload { profileState } applied to bridge adapter with skipLocalMerge
      storage.setItem('auro_match_consecrations', JSON.stringify([{ id: 'stale_c', text: 'Stale Prior User' }]));
      storage.setItem('auro_match_unlocked_tiles', JSON.stringify(['stale_tile_1']));
      const nativeEnvelope = {
        gameId: 'auromatch',
        skipLocalMerge: true,
        payload: {
          profileState: {
            profile: { lotusPetalCount: 99, consciousnessPoints: 300 },
            progression: { completedLevelsCount: 4, completedLevelIds: ['remote_tile_a', 'remote_tile_b'], unlockedThemes: ['flowers', 'qualities'] },
            settings: { volumeRaga: 0.8 },
            reflections: [{ id: 'remote_refl_1', text: 'Remote Pure Reflection' }],
            dailyDrawDate: '2026-11-25'
          }
        }
      };
      const bridgeApplied = await bridgeAdapter.applyEnvelope(nativeEnvelope, { skipLocalMerge: true });
      assert.equal(bridgeApplied, true);
      const postTiles = JSON.parse(storage.getItem('auro_match_unlocked_tiles'));
      assert.deepEqual(postTiles, ['remote_tile_a', 'remote_tile_b'], 'skipLocalMerge must isolate new account tiles without leaking stale prior user tiles');
      const postCons = JSON.parse(storage.getItem('auro_match_consecrations'));
      assert.deepEqual(postCons, [{ id: 'remote_refl_1', text: 'Remote Pure Reflection' }], 'skipLocalMerge must isolate new account reflections');

      // 3. Purge lock blocks both bridge and native applyEnvelope
      setPurgeLock(true);
      const blockedNative = await nativeAdapter.applyEnvelope(bridgeEnvelope);
      assert.equal(blockedNative, false, 'native applyEnvelope must fail closed when purge is active');
      const blockedBridge = await bridgeAdapter.applyEnvelope(nativeEnvelope);
      assert.equal(blockedBridge, false, 'bridge applyEnvelope must fail closed when purge is active');
      setPurgeLock(false);

      // 4. Mismatched gameId is rejected
      const foreignEnvelope = { gameId: 'vak', payload: { profileState: {} } };
      assert.equal(await nativeAdapter.applyEnvelope(foreignEnvelope), false);
      assert.equal(await bridgeAdapter.applyEnvelope(foreignEnvelope), false);
    } finally {
      resetIndexedDBConnection();
      if (prevLS === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = prevLS;
      if (prevIDB === undefined) delete globalThis.indexedDB;
      else globalThis.indexedDB = prevIDB;
    }
  });

  test('Flora-9: Two-account regression: isolation across init, autoHealFromIndexedDB, dual-write reconciliation, empty/populated stores, and guest migration', async () => {
    const prevLS = globalThis.localStorage;
    const prevIDB = globalThis.indexedDB;
    const storage = createMemoryStorage();
    const fakeIdb = createFakeIndexedDB();
    globalThis.localStorage = storage;
    globalThis.indexedDB = fakeIdb;
    resetIndexedDBConnection();
    setAccountScope(null);

    try {
      const nativeAdapter = createAuroMatchNativeAdapter();
      const bridgeAdapter = createAuroMatchBridgeAdapter();

      // Scoped contexts for two accounts
      const scopedContextA = {
        getGuestId: () => 'guest_A',
        getIdentity: () => ({ mode: 'guest', guestId: 'guest_A' }),
        accountScope: 'guest_A'
      };
      const scopedContextB = {
        getGuestId: () => 'guest_B',
        getIdentity: () => ({ mode: 'authenticated', account: { userId: 'user_B' } }),
        accountScope: 'user_B'
      };

      // 1. Guest Account A initializes and writes progression, reflections, and settings
      await nativeAdapter.init(scopedContextA);
      profileState.profile.lotusPetalCount = 75;
      profileState.profile.consciousnessPoints = 250;
      profileState.progression.completedLevelIds = ['flora_lotus'];
      profileState.progression.completedLevelsCount = 1;
      profileState.reflections = [{ id: 'refl_A1', text: 'Account A Sacred Reflection' }];
      profileState.settings.volumeRaga = 0.90;
      saveProfileState({ accountScope: 'guest_A' });

      // Verify Account A saved to localStorage and IDB
      assert.ok(storage.getItem('auro_match_user:guest_A'), 'Account A scoped key must exist in localStorage');
      assert.equal(profileState.profile.lotusPetalCount, 75);

      // 2. Account A signs out.
      setAccountScope(null);

      // 3. Account B signs in with distinct data.
      // 4. Account B initializes the AuroMatch adapter.
      await nativeAdapter.init(scopedContextB);

      // 5. Trigger IndexedDB recovery, auto-heal and dual-write reconciliation for Account B
      const healedB = await autoHealFromIndexedDB(scopedContextB);
      assert.equal(healedB, false, 'Auto-heal for Account B must NOT restore Account A data from IndexedDB');
      await reconcileDualWriteParity();

      // 6. Verify NO Account A data is read, merged, restored or written into Account B
      assert.equal(profileState.profile.lotusPetalCount, 0, 'Account B must not inherit Account A lotus petals');
      assert.equal(profileState.progression.completedLevelsCount, 0, 'Account B must have 0 completed levels');
      assert.deepEqual(profileState.reflections, [], 'Account B must have zero Account A reflections');
      assert.equal(profileState.ownerId, 'user_B', 'Active profile owner must be user_B');

      // Account B writes its own distinct data
      profileState.profile.lotusPetalCount = 20;
      profileState.progression.completedLevelIds = ['flora_jasmine'];
      profileState.progression.completedLevelsCount = 1;
      profileState.reflections = [{ id: 'refl_B1', text: 'Account B Distinct Reflection' }];
      saveProfileState({ accountScope: 'user_B' });

      // 7. Switch back to Account A and verify A's own data remains completely intact
      await nativeAdapter.init(scopedContextA);
      assert.equal(profileState.profile.lotusPetalCount, 75, 'Account A lotus petals must remain 75');
      assert.deepEqual(profileState.progression.completedLevelIds, ['flora_lotus'], 'Account A levels must remain intact');
      assert.deepEqual(profileState.reflections, [{ id: 'refl_A1', text: 'Account A Sacred Reflection' }], 'Account A reflections must remain intact');

      // -----------------------------------------------------------------------
      // Repeat Scenarios:
      // (a) Empty localStorage and populated IndexedDB
      // Clear localStorage completely; IDB still holds both Account A and Account B data
      storage.clear();
      // Account B initializes: must restore ONLY Account B's records from IDB, zero Account A records
      await nativeAdapter.init(scopedContextB);
      assert.equal(profileState.profile.lotusPetalCount, 20, 'Account B restored its own petals from IDB');
      assert.deepEqual(profileState.progression.completedLevelIds, ['flora_jasmine'], 'Account B restored its own levels');
      assert.deepEqual(profileState.reflections, [{ id: 'refl_B1', text: 'Account B Distinct Reflection' }]);

      // Account A initializes: must restore ONLY Account A's records from IDB
      await nativeAdapter.init(scopedContextA);
      assert.equal(profileState.profile.lotusPetalCount, 75, 'Account A restored its own petals from IDB');
      assert.deepEqual(profileState.progression.completedLevelIds, ['flora_lotus']);

      // (b) Populated localStorage and empty IndexedDB
      resetIndexedDBConnection();
      const emptyIdb = createFakeIndexedDB();
      globalThis.indexedDB = emptyIdb;
      // Account B saves local state, populating IDB without touching Account A
      await nativeAdapter.init(scopedContextB);
      saveProfileState({ accountScope: 'user_B' });
      const idbDb = await new Promise(r => {
        const req = emptyIdb.open('AuroMatchDB');
        req.onsuccess = () => r(req.result);
      });
      const idbBUser = await new Promise(r => {
        const tx = idbDb.transaction('gameState', 'readonly');
        const req = tx.objectStore().get('auro_match_user:user_B');
        req.onsuccess = () => r(req.result);
      });
      assert.ok(idbBUser, 'Account B must populate IDB from localStorage');
      const idbAUser = await new Promise(r => {
        const tx = idbDb.transaction('gameState', 'readonly');
        const req = tx.objectStore().get('auro_match_user:guest_A');
        req.onsuccess = () => r(req.result);
      });
      assert.equal(idbAUser, undefined, 'Account A must not be populated in IDB by Account B write');

      // (c) Conflicting localStorage and IndexedDB snapshots for Account B
      // Modify localStorage tiles for Account B; IDB has 'flora_jasmine'
      storage.setItem('auro_match_unlocked_tiles:user_B', JSON.stringify(['flora_rose']));
      const healedConflict = await autoHealFromIndexedDB(scopedContextB);
      assert.equal(healedConflict, true, 'autoHeal must reconcile diverged snapshots for Account B');
      loadProfileState({ accountScope: 'user_B' });
      assert.deepEqual(
        new Set(profileState.progression.completedLevelIds),
        new Set(['flora_jasmine', 'flora_rose']),
        'Diverged tiles must merge via set-union for Account B'
      );

      // (d) Interrupted/partial dual writes: reconcileDualWriteParity heals pending keys
      const partialRes = await setItemDualWrite('auro_match_user:user_B', { ...profileState, testFlag: true });
      assert.equal(partialRes.ok, true);
      const recon = await reconcileDualWriteParity();
      assert.equal(recon.remaining, 0, 'Dual write parity reconciliation must leave zero pending repairs');

      // (e) Purge active during initialization and recovery fails closed
      setPurgeLock(true);
      await nativeAdapter.init(scopedContextB);
      const blockedHeal = await autoHealFromIndexedDB(scopedContextB);
      assert.equal(blockedHeal, false, 'autoHeal must fail closed when purge is active');
      setPurgeLock(false);

      // (f) Guest-to-authenticated migration
      // Explicit migration from guest_A to user_alice
      const scopedContextAlice = {
        getIdentity: () => ({ mode: 'authenticated', account: { userId: 'user_alice' } }),
        accountScope: 'user_alice'
      };
      // Load guest A's data
      await nativeAdapter.init(scopedContextA);
      const guestAData = JSON.parse(JSON.stringify(profileState));
      // Migrate to alice
      await nativeAdapter.applyEnvelope({
        gameId: 'auromatch',
        skipLocalMerge: true,
        payload: {
          profileState: {
            ...guestAData,
            profile: { ...guestAData.profile, platformGuestId: 'guest_A', ownerId: 'user_alice' },
            ownerId: 'user_alice'
          }
        }
      }, scopedContextAlice);

      // Verify Alice has adopted Guest A's data
      await nativeAdapter.init(scopedContextAlice);
      assert.equal(profileState.profile.lotusPetalCount, 75);
      assert.equal(profileState.ownerId, 'user_alice');

      // Verify Account B still gets zero data from Alice
      await nativeAdapter.init(scopedContextB);
      assert.equal(profileState.profile.lotusPetalCount, 20);
      assert.deepEqual(profileState.progression.completedLevelIds.sort(), ['flora_jasmine', 'flora_rose'].sort());
    } finally {
      setPurgeLock(false);
      setAccountScope(null);
      resetIndexedDBConnection();
      if (prevLS === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = prevLS;
      if (prevIDB === undefined) delete globalThis.indexedDB;
      else globalThis.indexedDB = prevIDB;
    }
  });
});

describe('Part 1D — Focused Correction: Remote Save Integrity & Account-Switch Race', () => {
  test('Corr-1: Remote payload modified without updating checksum is rejected, never applied locally, never pushed, and preserves outbox', async () => {
    const { env } = createSdkEnv();
    const auth = createMockAuthProvider();
    const cloud = createMockCloudSyncStore();

    const originalPayload = { highScore: 500, completedStages: [1] };
    const originalChecksum = await computePayloadChecksum(originalPayload);
    // Tamper payload without updating checksum
    cloud.seed('user_tamper', 'auroblocks', {
      userId: 'user_tamper',
      gameId: 'auroblocks',
      revision: 2,
      checksum: originalChecksum,
      payload: { highScore: 999999, completedStages: [1, 99] },
      updatedAt: new Date().toISOString()
    });

    const sdk = createAuroMindSDK({ env });
    await sdk.init({
      gameId: 'portal',
      capabilities: { authEnabled: true, cloudSyncEnabled: true },
      providers: { auth, cloudSync: cloud.provider }
    });
    const harness = createInMemoryGameAdapter('auroblocks', { highScore: 100, completedStages: [1] });
    sdk.adapters.register(harness.adapter, { mergeStrategy: AuroBlocksMergeStrategy });
    await sdk.adapters.init('auroblocks');

    await sdk.sync.queueLocalChange('auroblocks');
    await sdk.auth.signIn('email', { email: 'tamper@example.com' }, { migrateFromGuest: true });
    sdk.sync.setConsent(true);

    const res = await sdk.sync.syncNow('auroblocks');
    assert.equal(res.status, 'success');
    assert.equal(res.results[0].action, 'invalid_remote_envelope');
    assert.equal(res.results[0].reason, 'REMOTE_CHECKSUM_MISMATCH');
    assert.equal(harness.getState().highScore, 100, 'Tampered remote payload must never be applied locally');
    assert.equal(cloud.getStats().pushCount, 0, 'Tampered remote record must not trigger a push');
    assert.equal(sdk.sync.getPendingOutboxCount(), 1, 'Pending sync outbox must be preserved on rejection');

    sdk.dispose();
  });

  test('Corr-2: Missing, malformed, and mismatched remote gameIds are all strictly rejected', async () => {
    const cases = [
      { label: 'missing gameId', gameId: undefined, expectedReason: 'MISSING_REMOTE_GAME_ID' },
      { label: 'empty gameId', gameId: '', expectedReason: 'MISSING_REMOTE_GAME_ID' },
      { label: 'numeric gameId', gameId: 12345, expectedReason: 'MISSING_REMOTE_GAME_ID' },
      { label: 'whitespace-padded gameId', gameId: ' auroblocks ', expectedReason: 'REMOTE_GAME_ID_MISMATCH' },
      { label: 'mismatched gameId', gameId: 'auromatch', expectedReason: 'REMOTE_GAME_ID_MISMATCH' }
    ];

    for (const tc of cases) {
      const { env } = createSdkEnv();
      const auth = createMockAuthProvider();
      const cloud = createMockCloudSyncStore();
      const payload = { highScore: 7777, completedStages: [1, 2] };
      const validChecksum = await computePayloadChecksum(payload);

      cloud.seed('user_gid', 'auroblocks', {
        userId: 'user_gid',
        ...(tc.gameId !== undefined ? { gameId: tc.gameId } : {}),
        revision: 2,
        checksum: validChecksum,
        payload,
        updatedAt: new Date().toISOString()
      });

      const sdk = createAuroMindSDK({ env });
      await sdk.init({
        gameId: 'portal',
        capabilities: { authEnabled: true, cloudSyncEnabled: true },
        providers: { auth, cloudSync: cloud.provider }
      });
      const harness = createInMemoryGameAdapter('auroblocks', { highScore: 10, completedStages: [] });
      sdk.adapters.register(harness.adapter, { mergeStrategy: AuroBlocksMergeStrategy });
      await sdk.adapters.init('auroblocks');

      await sdk.sync.queueLocalChange('auroblocks');
      await sdk.auth.signIn('email', { email: 'gid@example.com' }, { migrateFromGuest: true });
      sdk.sync.setConsent(true);

      const res = await sdk.sync.syncNow('auroblocks');
      assert.equal(res.results[0].action, 'invalid_remote_envelope', `Case "${tc.label}" must be rejected`);
      assert.equal(res.results[0].reason, tc.expectedReason, `Case "${tc.label}" must report ${tc.expectedReason}`);
      assert.equal(harness.getState().highScore, 10, `Case "${tc.label}" must not alter local state`);
      assert.equal(cloud.getStats().pushCount, 0, `Case "${tc.label}" must not push`);
      assert.equal(sdk.sync.getPendingOutboxCount(), 1, `Case "${tc.label}" must preserve outbox`);
      sdk.dispose();
    }
  });

  test('Corr-3: Missing, malformed, placeholder, and incorrect remote checksums are all strictly rejected', async () => {
    const cases = [
      { label: 'missing checksum', checksum: undefined, expectedReason: 'MISSING_REMOTE_CHECKSUM' },
      { label: 'empty checksum', checksum: '', expectedReason: 'MISSING_REMOTE_CHECKSUM' },
      { label: 'placeholder remote_unknown_checksum', checksum: 'remote_unknown_checksum', expectedReason: 'MALFORMED_REMOTE_CHECKSUM' },
      { label: 'short hex checksum', checksum: 'a'.repeat(63), expectedReason: 'MALFORMED_REMOTE_CHECKSUM' },
      { label: 'uppercase hex checksum', checksum: 'A'.repeat(64), expectedReason: 'MALFORMED_REMOTE_CHECKSUM' },
      { label: 'non-hex 64-char checksum', checksum: 'z'.repeat(64), expectedReason: 'MALFORMED_REMOTE_CHECKSUM' },
      { label: 'valid-format but incorrect SHA-256', checksum: '0'.repeat(64), expectedReason: 'REMOTE_CHECKSUM_MISMATCH' }
    ];

    for (const tc of cases) {
      const { env } = createSdkEnv();
      const auth = createMockAuthProvider();
      const cloud = createMockCloudSyncStore();
      const payload = { highScore: 8888, completedStages: [1, 2, 3] };

      cloud.seed('user_chk', 'auroblocks', {
        userId: 'user_chk',
        gameId: 'auroblocks',
        revision: 3,
        ...(tc.checksum !== undefined ? { checksum: tc.checksum } : {}),
        payload,
        updatedAt: new Date().toISOString()
      });

      const sdk = createAuroMindSDK({ env });
      await sdk.init({
        gameId: 'portal',
        capabilities: { authEnabled: true, cloudSyncEnabled: true },
        providers: { auth, cloudSync: cloud.provider }
      });
      const harness = createInMemoryGameAdapter('auroblocks', { highScore: 20, completedStages: [] });
      sdk.adapters.register(harness.adapter, { mergeStrategy: AuroBlocksMergeStrategy });
      await sdk.adapters.init('auroblocks');

      await sdk.sync.queueLocalChange('auroblocks');
      await sdk.auth.signIn('email', { email: 'chk@example.com' }, { migrateFromGuest: true });
      sdk.sync.setConsent(true);

      const res = await sdk.sync.syncNow('auroblocks');
      assert.equal(res.results[0].action, 'invalid_remote_envelope', `Case "${tc.label}" must be rejected`);
      assert.equal(res.results[0].reason, tc.expectedReason, `Case "${tc.label}" must report ${tc.expectedReason}`);
      assert.equal(harness.getState().highScore, 20, `Case "${tc.label}" must not alter local state`);
      assert.equal(cloud.getStats().pushCount, 0, `Case "${tc.label}" must not push`);
      assert.equal(sdk.sync.getPendingOutboxCount(), 1, `Case "${tc.label}" must preserve outbox`);
      sdk.dispose();
    }
  });

  test('Corr-4: Invalid pushRes.serverRecord during conflict recovery is rejected with zero retry push and local state untouched', async () => {
    const validConflictPayload = { highScore: 3000, completedStages: [1, 5] };
    const validConflictChecksum = await computePayloadChecksum(validConflictPayload);

    const invalidServerRecords = [
      {
        label: 'tampered checksum in serverRecord',
        serverRecord: {
          gameId: 'auroblocks',
          revision: 5,
          checksum: validConflictChecksum,
          payload: { highScore: 99999, completedStages: [1, 5, 99] }
        },
        expectedReason: 'REMOTE_CHECKSUM_MISMATCH'
      },
      {
        label: 'missing gameId in serverRecord',
        serverRecord: {
          revision: 5,
          checksum: validConflictChecksum,
          payload: validConflictPayload
        },
        expectedReason: 'MISSING_REMOTE_GAME_ID'
      },
      {
        label: 'missing checksum in serverRecord',
        serverRecord: {
          gameId: 'auroblocks',
          revision: 5,
          payload: validConflictPayload
        },
        expectedReason: 'MISSING_REMOTE_CHECKSUM'
      },
      {
        label: 'missing revision in serverRecord',
        serverRecord: {
          gameId: 'auroblocks',
          checksum: validConflictChecksum,
          payload: validConflictPayload
        },
        expectedReason: 'INVALID_REMOTE_REVISION'
      }
    ];

    for (const tc of invalidServerRecords) {
      const { env } = createSdkEnv();
      const auth = createMockAuthProvider();
      const cloud = createMockCloudSyncStore();
      const initialRemotePayload = { highScore: 500, completedStages: [1] };

      cloud.seed('user_c4', 'auroblocks', {
        userId: 'user_c4',
        gameId: 'auroblocks',
        revision: 4,
        checksum: await computePayloadChecksum(initialRemotePayload),
        payload: initialRemotePayload,
        updatedAt: new Date().toISOString()
      });
      cloud.setForceConflictOnce({
        ...tc.serverRecord,
        // Ensure outer currentRevision is 5 even when serverRecord itself omits revision
        _outerCurrentRevision: 5
      });

      // Wrap provider so conflict returns exact currentRevision: 5 and exact unmutated tc.serverRecord
      const wrappedProvider = {
        ...cloud.provider,
        async pushWithOptimisticLock(envelope, userId, expectedRevision) {
          const inner = await cloud.provider.pushWithOptimisticLock(envelope, userId, expectedRevision);
          if (inner.status === 'conflict') {
            return {
              status: 'conflict',
              currentRevision: 5,
              serverRecord: tc.serverRecord
            };
          }
          return inner;
        }
      };

      const sdk = createAuroMindSDK({ env });
      await sdk.init({
        gameId: 'portal',
        capabilities: { authEnabled: true, cloudSyncEnabled: true },
        providers: { auth, cloudSync: wrappedProvider }
      });
      let applyCalls = 0;
      const harness = createInMemoryGameAdapter('auroblocks', { highScore: 1200, completedStages: [1, 2] });
      const origApply = harness.adapter.applyEnvelope;
      harness.adapter.applyEnvelope = async (envelope, ctx) => {
        applyCalls += 1;
        return origApply(envelope, ctx);
      };
      const useLocalFirstStrategy = {
        gameId: 'auroblocks',
        resolve(local) {
          return { status: 'use_local', resolvedPayload: local.payload };
        }
      };
      sdk.adapters.register(harness.adapter, { mergeStrategy: useLocalFirstStrategy });
      await sdk.adapters.init('auroblocks');

      await sdk.auth.signIn('email', { email: 'c4@example.com' });
      sdk.sync.setConsent(true);

      const res = await sdk.sync.syncNow('auroblocks');
      assert.equal(res.status, 'success');
      assert.equal(res.results[0].action, 'conflict', `Case "${tc.label}" must remain conflict`);
      assert.equal(res.results[0].invalidServerRecordReason, tc.expectedReason);
      assert.equal(applyCalls, 0, `Case "${tc.label}" must NOT apply invalid serverRecord locally`);
      assert.equal(cloud.getStats().pushCount, 1, `Case "${tc.label}" must NOT execute any retry push`);
      assert.equal(harness.getState().highScore, 1200, `Case "${tc.label}" must preserve local state`);
      assert.equal(sdk.sync.getPendingOutboxCount(), 1, `Case "${tc.label}" must keep game queued in outbox`);
      sdk.dispose();
    }
  });

  test('Corr-5: Account switch while applyRemoteEnvelope() is delayed aborts safely on use_remote, auto_merged, and conflict-recovery paths', async () => {
    // Helper to create a deterministic deferred gate for delayed applyEnvelope
    function createGate() {
      let resolveEntered;
      let releaseApply;
      const entered = new Promise((r) => { resolveEntered = r; });
      const release = new Promise((r) => { releaseApply = r; });
      return { entered, release, markEntered: resolveEntered, releaseApply };
    }

    // --- Path A: use_remote (local empty, remote non-empty) ---
    {
      const { env } = createSdkEnv();
      const auth = createMockAuthProvider();
      const cloud = createMockCloudSyncStore();
      const remotePayload = { highScore: 4200, completedStages: [1, 2, 3] };
      cloud.seed('user_a', 'auroblocks', {
        userId: 'user_a',
        gameId: 'auroblocks',
        revision: 3,
        checksum: await computePayloadChecksum(remotePayload),
        payload: remotePayload,
        updatedAt: new Date().toISOString()
      });

      const sdk = createAuroMindSDK({ env });
      await sdk.init({
        gameId: 'portal',
        capabilities: { authEnabled: true, cloudSyncEnabled: true },
        providers: { auth, cloudSync: cloud.provider }
      });

      const gate = createGate();
      let sawActiveBefore = null;
      let sawActiveAfter = null;
      const emptyHarness = createInMemoryGameAdapter('auroblocks', {});
      emptyHarness.adapter.applyEnvelope = async (envelope, ctx) => {
        sawActiveBefore = ctx?.isStillActive?.();
        gate.markEntered();
        await gate.release;
        sawActiveAfter = ctx?.isStillActive?.();
        if (ctx && typeof ctx.isStillActive === 'function' && !ctx.isStillActive()) {
          return false;
        }
        emptyHarness.setState(envelope.payload);
        return true;
      };
      sdk.adapters.register(emptyHarness.adapter, { mergeStrategy: AuroBlocksMergeStrategy });
      await sdk.adapters.init('auroblocks');

      await sdk.sync.queueLocalChange('auroblocks');
      await sdk.auth.signIn('email', { email: 'a@example.com' }, { migrateFromGuest: true });
      sdk.sync.setConsent(true);

      const syncPromise = sdk.sync.syncNow('auroblocks');
      await gate.entered;
      // Account switches to B while applyEnvelope is paused mid-await
      auth._emitSwitch('user_b', 'b@example.com');
      gate.releaseApply();

      const res = await syncPromise;
      assert.equal(res.status, 'aborted', 'use_remote must abort when account switches during applyRemoteEnvelope');
      assert.equal(res.reason, 'account_changed_mid_sync');
      assert.equal(sawActiveBefore, true);
      assert.equal(sawActiveAfter, false);
      assert.equal(sdk.sync.getPendingOutboxCount(), 0, 'Account B must not see Account A outbox');
      auth._emitSwitch('user_a', 'a@example.com');
      assert.equal(sdk.sync.getPendingOutboxCount(), 1, 'use_remote abort must NOT clear pending outbox');
      assert.equal(sdk.sync.getSyncStatus().lastSyncAt, null, 'Account B must receive zero sync metadata');
      assert.equal(cloud.getStats().pushCount, 0);
      sdk.dispose();
    }

    // --- Path B: auto_merged (local and remote both non-empty and divergent) ---
    {
      const { env } = createSdkEnv();
      const auth = createMockAuthProvider();
      const cloud = createMockCloudSyncStore();
      const remotePayload = { highScore: 2500, completedStages: [1, 4] };
      cloud.seed('user_a', 'auroblocks', {
        userId: 'user_a',
        gameId: 'auroblocks',
        revision: 2,
        checksum: await computePayloadChecksum(remotePayload),
        payload: remotePayload,
        updatedAt: new Date().toISOString()
      });

      const sdk = createAuroMindSDK({ env });
      await sdk.init({
        gameId: 'portal',
        capabilities: { authEnabled: true, cloudSyncEnabled: true },
        providers: { auth, cloudSync: cloud.provider }
      });

      const gate = createGate();
      const harness = createInMemoryGameAdapter('auroblocks', { highScore: 1500, completedStages: [1, 2] });
      harness.adapter.applyEnvelope = async (envelope, ctx) => {
        gate.markEntered();
        await gate.release;
        // Even an adapter that does NOT check ctx must still be stopped by syncNow's post-await guard!
        harness.setState(envelope.payload);
        return true;
      };
      sdk.adapters.register(harness.adapter, { mergeStrategy: AuroBlocksMergeStrategy });
      await sdk.adapters.init('auroblocks');

      await sdk.sync.queueLocalChange('auroblocks');
      await sdk.auth.signIn('email', { email: 'a@example.com' }, { migrateFromGuest: true });
      sdk.sync.setConsent(true);

      const syncPromise = sdk.sync.syncNow('auroblocks');
      await gate.entered;
      auth._emitSwitch('user_b', 'b@example.com');
      gate.releaseApply();

      const res = await syncPromise;
      assert.equal(res.status, 'aborted', 'auto_merged must abort immediately after delayed applyRemoteEnvelope');
      assert.equal(res.reason, 'account_changed_mid_sync');
      assert.equal(cloud.getStats().pushCount, 0, 'auto_merged abort MUST prevent follow-on cloud push');
      assert.equal(sdk.sync.getPendingOutboxCount(), 0, 'Account B must not see Account A outbox');
      auth._emitSwitch('user_a', 'a@example.com');
      assert.equal(sdk.sync.getPendingOutboxCount(), 1, 'auto_merged abort MUST NOT delete outbox');
      assert.equal(sdk.sync.getSyncStatus().lastSyncAt, null, 'Account B must receive zero sync metadata');
      assert.equal(cloud.get('user_b', 'auroblocks'), null);
      sdk.dispose();
    }

    // --- Path C: optimistic-lock conflict recovery (push conflicts with valid serverRecord -> delayed recovery applyEnvelope) ---
    {
      const { env } = createSdkEnv();
      const auth = createMockAuthProvider();
      const cloud = createMockCloudSyncStore();
      const initialRemotePayload = { highScore: 500, completedStages: [1] };
      const conflictServerPayload = { highScore: 3100, completedStages: [1, 6] };

      cloud.seed('user_a', 'auroblocks', {
        userId: 'user_a',
        gameId: 'auroblocks',
        revision: 4,
        checksum: await computePayloadChecksum(initialRemotePayload),
        payload: initialRemotePayload,
        updatedAt: new Date().toISOString()
      });
      cloud.setForceConflictOnce({
        userId: 'user_a',
        gameId: 'auroblocks',
        revision: 5,
        checksum: await computePayloadChecksum(conflictServerPayload),
        payload: conflictServerPayload,
        updatedAt: new Date().toISOString()
      });

      const sdk = createAuroMindSDK({ env });
      await sdk.init({
        gameId: 'portal',
        capabilities: { authEnabled: true, cloudSyncEnabled: true },
        providers: { auth, cloudSync: cloud.provider }
      });

      const gate = createGate();
      const harness = createInMemoryGameAdapter('auroblocks', { highScore: 1200, completedStages: [1, 2] });
      harness.adapter.applyEnvelope = async (envelope) => {
        gate.markEntered();
        await gate.release;
        harness.setState(envelope.payload);
        return true;
      };
      let resolveCalls = 0;
      const conflictTriggerStrategy = {
        gameId: 'auroblocks',
        resolve(local, remote) {
          resolveCalls += 1;
          if (resolveCalls === 1) return { status: 'use_local', resolvedPayload: local.payload };
          return AuroBlocksMergeStrategy.resolve(local, remote);
        }
      };
      sdk.adapters.register(harness.adapter, { mergeStrategy: conflictTriggerStrategy });
      await sdk.adapters.init('auroblocks');

      await sdk.sync.queueLocalChange('auroblocks');
      await sdk.auth.signIn('email', { email: 'a@example.com' }, { migrateFromGuest: true });
      sdk.sync.setConsent(true);

      const syncPromise = sdk.sync.syncNow('auroblocks');
      await gate.entered;
      // Switch account while conflict recovery's applyRemoteEnvelope is paused mid-await
      auth._emitSwitch('user_b', 'b@example.com');
      gate.releaseApply();

      const res = await syncPromise;
      assert.equal(res.status, 'aborted', 'conflict recovery must abort immediately after delayed applyRemoteEnvelope');
      assert.equal(res.reason, 'account_changed_mid_sync');
      assert.equal(cloud.getStats().pushCount, 1, 'conflict recovery abort MUST prevent retry push (only initial push ran)');
      assert.equal(sdk.sync.getPendingOutboxCount(), 0, 'Account B must not see Account A outbox');
      auth._emitSwitch('user_a', 'a@example.com');
      assert.equal(sdk.sync.getPendingOutboxCount(), 1, 'conflict recovery abort MUST NOT delete outbox');
      assert.equal(sdk.sync.getSyncStatus().lastSyncAt, null, 'Account B must receive zero sync metadata');
      assert.equal(cloud.get('user_b', 'auroblocks'), null);
      sdk.dispose();
    }
  });

  test('Corr-6: buildValidatedRemoteEnvelope enforces plain JSON object payloads (rejects null, arrays, Date, class instances, custom prototypes, Map/Set/RegExp/TypedArray; accepts Object.prototype & null-prototype objects)', async () => {
    class CustomSaveClass {
      constructor() {
        this.highScore = 9999;
        this.completedStages = [1, 2];
      }
    }

    const customProtoObj = Object.create({ inheritedScore: 100 });
    customProtoObj.highScore = 8888;
    customProtoObj.completedStages = [1];

    const invalidPayloads = [
      { label: 'null', value: null },
      { label: 'undefined', value: undefined },
      { label: 'array', value: [1, 2, 3] },
      { label: 'Date instance', value: new Date('2026-11-23T00:00:00.000Z') },
      { label: 'class instance', value: new CustomSaveClass() },
      { label: 'custom prototype object', value: customProtoObj },
      { label: 'Map instance', value: new Map([['highScore', 5000]]) },
      { label: 'Set instance', value: new Set([1, 2, 3]) },
      { label: 'RegExp instance', value: /auroblocks/ },
      { label: 'Uint8Array instance', value: new Uint8Array([1, 2, 3]) },
      { label: 'primitive string', value: '{"highScore":9000}' },
      { label: 'primitive number', value: 42 },
      { label: 'primitive boolean', value: true }
    ];

    for (const tc of invalidPayloads) {
      const { env } = createSdkEnv();
      const auth = createMockAuthProvider();
      let pushCalls = 0;
      let applyCalls = 0;

      // Compute a matching checksum whenever possible to prove rejection is strictly by payload type
      let matchingChecksum = '0'.repeat(64);
      try {
        matchingChecksum = await computePayloadChecksum(tc.value);
      } catch {}

      const directProvider = {
        providerName: 'direct-nonplain-sync',
        isConfigured: () => true,
        async pullLatest() {
          return {
            gameId: 'auroblocks',
            revision: 2,
            checksum: matchingChecksum,
            payload: tc.value,
            updatedAt: new Date().toISOString()
          };
        },
        async pushWithOptimisticLock() {
          pushCalls += 1;
          return { status: 'success', newRevision: 3 };
        }
      };

      const sdk = createAuroMindSDK({ env });
      await sdk.init({
        gameId: 'portal',
        capabilities: { authEnabled: true, cloudSyncEnabled: true },
        providers: { auth, cloudSync: directProvider }
      });

      const harness = createInMemoryGameAdapter('auroblocks', { highScore: 100, completedStages: [1] });
      const origApply = harness.adapter.applyEnvelope;
      harness.adapter.applyEnvelope = async (envelope, ctx) => {
        applyCalls += 1;
        return origApply(envelope, ctx);
      };
      sdk.adapters.register(harness.adapter, { mergeStrategy: AuroBlocksMergeStrategy });
      await sdk.adapters.init('auroblocks');

      await sdk.sync.queueLocalChange('auroblocks');
      await sdk.auth.signIn('email', { email: 'plaincheck@example.com' }, { migrateFromGuest: true });
      sdk.sync.setConsent(true);

      const res = await sdk.sync.syncNow('auroblocks');
      assert.equal(res.status, 'success');
      assert.equal(res.results[0].action, 'invalid_remote_envelope', `Invalid payload "${tc.label}" must be rejected`);
      assert.equal(res.results[0].reason, 'INVALID_REMOTE_PAYLOAD', `Invalid payload "${tc.label}" must report INVALID_REMOTE_PAYLOAD`);
      assert.equal(applyCalls, 0, `Invalid payload "${tc.label}" must never be applied locally`);
      assert.equal(pushCalls, 0, `Invalid payload "${tc.label}" must never trigger a remote push`);
      assert.equal(harness.getState().highScore, 100, `Invalid payload "${tc.label}" must leave local state intact`);
      assert.equal(sdk.sync.getPendingOutboxCount(), 1, `Invalid payload "${tc.label}" must preserve pending outbox`);
      sdk.dispose();
    }

    // Also verify non-plain serverRecord.payload during optimistic-lock conflict recovery is rejected with zero retry push
    {
      const { env } = createSdkEnv();
      const auth = createMockAuthProvider();
      let pushCalls = 0;
      let applyCalls = 0;
      const validInitialPayload = { highScore: 500, completedStages: [1] };
      const initialChecksum = await computePayloadChecksum(validInitialPayload);
      const classConflictPayload = new CustomSaveClass();
      const classConflictChecksum = await computePayloadChecksum(classConflictPayload);

      const conflictProvider = {
        providerName: 'direct-conflict-nonplain',
        isConfigured: () => true,
        async pullLatest() {
          return {
            gameId: 'auroblocks',
            revision: 4,
            checksum: initialChecksum,
            payload: validInitialPayload,
            updatedAt: new Date().toISOString()
          };
        },
        async pushWithOptimisticLock() {
          pushCalls += 1;
          return {
            status: 'conflict',
            currentRevision: 5,
            serverRecord: {
              gameId: 'auroblocks',
              revision: 5,
              checksum: classConflictChecksum,
              payload: classConflictPayload
            }
          };
        }
      };

      const sdk = createAuroMindSDK({ env });
      await sdk.init({
        gameId: 'portal',
        capabilities: { authEnabled: true, cloudSyncEnabled: true },
        providers: { auth, cloudSync: conflictProvider }
      });
      const harness = createInMemoryGameAdapter('auroblocks', { highScore: 1200, completedStages: [1, 2] });
      const origApply = harness.adapter.applyEnvelope;
      harness.adapter.applyEnvelope = async (envelope, ctx) => {
        applyCalls += 1;
        return origApply(envelope, ctx);
      };
      sdk.adapters.register(harness.adapter, {
        mergeStrategy: {
          gameId: 'auroblocks',
          resolve(local) {
            return { status: 'use_local', resolvedPayload: local.payload };
          }
        }
      });
      await sdk.adapters.init('auroblocks');

      await sdk.auth.signIn('email', { email: 'plainconflict@example.com' });
      sdk.sync.setConsent(true);

      const res = await sdk.sync.syncNow('auroblocks');
      assert.equal(res.results[0].action, 'conflict');
      assert.equal(res.results[0].invalidServerRecordReason, 'INVALID_REMOTE_PAYLOAD');
      assert.equal(applyCalls, 0);
      assert.equal(pushCalls, 1, 'Conflict recovery must not retry push on non-plain serverRecord.payload');
      assert.equal(sdk.sync.getPendingOutboxCount(), 1);
      sdk.dispose();
    }

    // Positive controls: ordinary JSON object (Object.prototype) and null-prototype plain object with valid checksums ARE accepted
    const nullProtoPayload = Object.create(null);
    nullProtoPayload.highScore = 2400;
    nullProtoPayload.completedStages = [1, 3];

    const validPayloads = [
      { label: 'ordinary Object.prototype payload', value: { highScore: 1800, completedStages: [1, 2] }, expectedScore: 1800 },
      { label: 'null-prototype plain object payload', value: nullProtoPayload, expectedScore: 2400 }
    ];

    for (const tc of validPayloads) {
      const { env } = createSdkEnv();
      const auth = createMockAuthProvider();
      let pushCalls = 0;
      const validChecksum = await computePayloadChecksum(tc.value);

      const directProvider = {
        providerName: 'direct-valid-plain',
        isConfigured: () => true,
        async pullLatest() {
          return {
            gameId: 'auroblocks',
            revision: 2,
            checksum: validChecksum,
            payload: tc.value,
            updatedAt: new Date().toISOString()
          };
        },
        async pushWithOptimisticLock() {
          pushCalls += 1;
          return { status: 'success', newRevision: 3 };
        }
      };

      const sdk = createAuroMindSDK({ env });
      await sdk.init({
        gameId: 'portal',
        capabilities: { authEnabled: true, cloudSyncEnabled: true },
        providers: { auth, cloudSync: directProvider }
      });
      const harness = createInMemoryGameAdapter('auroblocks', { highScore: 100, completedStages: [1] });
      sdk.adapters.register(harness.adapter, { mergeStrategy: AuroBlocksMergeStrategy });
      await sdk.adapters.init('auroblocks');

      await sdk.auth.signIn('email', { email: 'plainvalid@example.com' });
      sdk.sync.setConsent(true);

      const res = await sdk.sync.syncNow('auroblocks');
      assert.equal(res.status, 'success', `Valid "${tc.label}" must succeed`);
      assert.equal(res.results[0].action, 'auto_merged_and_pushed', `Valid "${tc.label}" must merge and push`);
      assert.equal(harness.getState().highScore, tc.expectedScore);
      assert.equal(pushCalls, 1);
      sdk.dispose();
    }
  });

  test('Corr-7: Real SDK-to-adapter account transition isolates AuroMatch adapter state and prevents cross-user pollution', async () => {
    const prevLS = globalThis.localStorage;
    const prevIDB = globalThis.indexedDB;
    const storage = createMemoryStorage();
    const fakeIdb = createFakeIndexedDB();
    globalThis.localStorage = storage;
    globalThis.indexedDB = fakeIdb;
    resetIndexedDBConnection();
    setAccountScope(null);

    const { env } = createSdkEnv();
    const auth = createMockAuthProvider();
    const cloud = createMockCloudSyncStore();

    try {
      const sdk = createAuroMindSDK({ env });
      await sdk.init({
        gameId: 'portal',
        capabilities: { authEnabled: true, cloudSyncEnabled: true },
        providers: { auth, cloudSync: cloud.provider }
      });

      const nativeAdapter = createAuroMatchNativeAdapter();
      sdk.adapters.register(nativeAdapter, { mergeStrategy: AuroMatchMergeStrategy });

      // 1. User Alice signs in and initializes AuroMatch adapter
      await sdk.auth.signIn('email', { email: 'alice@example.com' });
      await sdk.adapters.init('auromatch');
      sdk.sync.setConsent(true);

      // Alice plays and earns progression
      profileState.profile.lotusPetalCount = 100;
      profileState.profile.consciousnessPoints = 400;
      profileState.progression.completedLevelIds = ['flora_lotus_blossom'];
      profileState.progression.completedLevelsCount = 1;
      profileState.reflections = [{ id: 'alice_refl', text: 'Alice Contemplation' }];
      saveProfileState({ accountScope: 'user_alice' });

      // Sync Alice's save to cloud
      const syncAlice = await sdk.sync.syncNow('auromatch');
      assert.equal(syncAlice.status, 'success');
      assert.ok(cloud.get('user_alice', 'auromatch'), 'Cloud must hold Alice save');

      // 2. Alice signs out
      await sdk.auth.signOut();
      setAccountScope(null);

      // 3. Bob signs in
      await sdk.auth.signIn('email', { email: 'bob@example.com' });
      setAccountScope('user_bob');
      await sdk.adapters.init('auromatch');
      sdk.sync.setConsent(true);

      // Verify Bob's adapter has ZERO Alice progression
      assert.equal(profileState.profile.lotusPetalCount, 0, 'Bob must not inherit Alice lotus petals');
      assert.equal(profileState.progression.completedLevelsCount, 0, 'Bob must have 0 completed levels');
      assert.deepEqual(profileState.reflections, [], 'Bob must have zero Alice reflections');

      // 4. Bob syncs and saves his own distinct state
      profileState.profile.lotusPetalCount = 35;
      profileState.progression.completedLevelIds = ['flora_jasmine_scent'];
      profileState.progression.completedLevelsCount = 1;
      profileState.reflections = [{ id: 'bob_refl', text: 'Bob Independent Reflection' }];
      saveProfileState({ accountScope: 'user_bob' });

      const syncBob = await sdk.sync.syncNow('auromatch');
      assert.equal(syncBob.status, 'success');

      // 5. Switch back to Alice
      await sdk.auth.signOut();
      setAccountScope(null);
      await sdk.auth.signIn('email', { email: 'alice@example.com' });
      setAccountScope('user_alice');
      await sdk.adapters.init('auromatch');

      // Verify Alice's data was completely preserved
      assert.equal(profileState.profile.lotusPetalCount, 100, 'Alice petals must be restored intact');
      assert.deepEqual(profileState.progression.completedLevelIds, ['flora_lotus_blossom']);
      assert.deepEqual(profileState.reflections, [{ id: 'alice_refl', text: 'Alice Contemplation' }]);

      sdk.dispose();
    } finally {
      setPurgeLock(false);
      setAccountScope(null);
      resetIndexedDBConnection();
      if (prevLS === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = prevLS;
      if (prevIDB === undefined) delete globalThis.indexedDB;
      else globalThis.indexedDB = prevIDB;
    }
  });
});

// =============================================================================
// PART 1E — AUROMATCH LEGACY STORAGE & ACCOUNT-ISOLATION HARDENING (ADVERSARIAL SUITE)
// =============================================================================

describe('Part 1E — AuroMatch Legacy Storage & Account-Isolation Hardening (Adversarial Suite)', () => {
  test('Adv-1: Authenticated Account B with no scoped IndexedDB records and unowned legacy IndexedDB records for all three core keys', async () => {
    const prevLS = globalThis.localStorage;
    const prevIDB = globalThis.indexedDB;
    const storage = createMemoryStorage();
    const fakeIdb = createFakeIndexedDB();
    globalThis.localStorage = storage;
    globalThis.indexedDB = fakeIdb;
    resetIndexedDBConnection();
    setAccountScope(null);

    try {
      // 1. Populate IDB directly with unowned legacy records
      const db = await new Promise((resolve) => {
        const req = fakeIdb.open('AuroMatchDB');
        req.onsuccess = () => resolve(req.result);
      });
      const tx = db.transaction('gameState', 'readwrite');
      const store = tx.objectStore('gameState');
      store.put(JSON.stringify({
        profile: { lotusPetalCount: 50, consciousnessPoints: 200 },
        progression: { completedLevelsCount: 2, completedLevelIds: ['legacy_1', 'legacy_2'], unlockedThemes: ['flowers'] },
        reflections: [{ id: 'leg_c1', text: 'Legacy Unowned' }],
        settings: { volumeRaga: 0.8 },
        dailyDrawDate: '2026-11-20'
      }), 'auro_match_user');
      store.put(JSON.stringify([{ id: 'leg_c1', text: 'Legacy Unowned' }]), 'auro_match_consecrations');
      store.put(JSON.stringify(['legacy_1', 'legacy_2']), 'auro_match_unlocked_tiles');
      await new Promise((r) => { tx.oncomplete = r; });

      const nativeAdapter = createAuroMatchNativeAdapter();
      const bridgeAdapter = createAuroMatchBridgeAdapter();

      // 2. Account B initializes adapter
      await nativeAdapter.init({ accountScope: 'user_B', getGuestId: () => 'guest_B' });
      const healed = await autoHealFromIndexedDB({ accountScope: 'user_B' });
      assert.equal(healed, false, 'autoHealFromIndexedDB must return false for authenticated Account B with unowned legacy IDB records');

      // 3. Assert Account B has zero legacy progression
      assert.equal(profileState.profile.lotusPetalCount, 0, 'Account B must not inherit legacy lotus petals');
      assert.deepEqual(profileState.progression.completedLevelIds, [], 'Account B must have empty completed levels');
      assert.deepEqual(profileState.reflections, [], 'Account B must have empty reflections');
      assert.equal(storage.getItem('auro_match_user:user_B'), null);
      assert.equal(storage.getItem('auro_match_consecrations:user_B'), null);
      assert.equal(storage.getItem('auro_match_unlocked_tiles:user_B'), null);

      assert.equal(nativeAdapter.hasLocalProgress(), false);
      assert.equal(bridgeAdapter.hasLocalProgress(), false);

      const envNative = await nativeAdapter.exportEnvelope('guest_B');
      assert.equal(envNative.isEmpty, true, 'Native envelope must be marked empty');

      const envBridge = await bridgeAdapter.exportEnvelope('guest_B');
      assert.equal(envBridge.isEmpty, true, 'Bridge envelope must be marked empty');
    } finally {
      setPurgeLock(false);
      setAccountScope(null);
      resetIndexedDBConnection();
      if (prevLS === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = prevLS;
      if (prevIDB === undefined) delete globalThis.indexedDB;
      else globalThis.indexedDB = prevIDB;
    }
  });

  test('Adv-2: Authenticated Account B with a valid scoped user record but unowned legacy reflections and unlocked tiles', async () => {
    const prevLS = globalThis.localStorage;
    const prevIDB = globalThis.indexedDB;
    const storage = createMemoryStorage();
    const fakeIdb = createFakeIndexedDB();
    globalThis.localStorage = storage;
    globalThis.indexedDB = fakeIdb;
    resetIndexedDBConnection();
    setAccountScope(null);

    try {
      const db = await new Promise((resolve) => {
        const req = fakeIdb.open('AuroMatchDB');
        req.onsuccess = () => resolve(req.result);
      });
      const tx = db.transaction('gameState', 'readwrite');
      const store = tx.objectStore('gameState');
      // Valid scoped user for user_B
      store.put(JSON.stringify({
        profile: { lotusPetalCount: 25, consciousnessPoints: 100, ownerId: 'user_B' },
        progression: { completedLevelsCount: 1, completedLevelIds: ['b_level_1'] },
        reflections: [],
        settings: { volumeRaga: 0.5 },
        ownerId: 'user_B'
      }), 'auro_match_user:user_B');
      store.put(JSON.stringify(['b_level_1']), 'auro_match_unlocked_tiles:user_B');
      // Unowned legacy arrays in unscoped keys
      store.put(JSON.stringify([{ id: 'unowned_refl', text: 'Foreign Legacy Reflection' }]), 'auro_match_consecrations');
      store.put(JSON.stringify(['foreign_tile_1', 'foreign_tile_2']), 'auro_match_unlocked_tiles');
      await new Promise((r) => { tx.oncomplete = r; });

      const nativeAdapter = createAuroMatchNativeAdapter();
      await nativeAdapter.init({ accountScope: 'user_B' });

      // Account B restores its valid scoped user
      assert.equal(profileState.profile.lotusPetalCount, 25);
      assert.deepEqual(profileState.progression.completedLevelIds, ['b_level_1']);

      // Account B must NOT inherit unowned legacy reflections or foreign tiles
      assert.deepEqual(profileState.reflections, [], 'Must not inherit unowned legacy reflections');
      const scopedTiles = JSON.parse(storage.getItem('auro_match_unlocked_tiles:user_B') || '[]');
      assert.deepEqual(scopedTiles, ['b_level_1'], 'Must not inherit foreign legacy tiles');
      const scopedCons = JSON.parse(storage.getItem('auro_match_consecrations:user_B') || '[]');
      assert.deepEqual(scopedCons, [], 'Must not inherit foreign legacy reflections');
    } finally {
      setPurgeLock(false);
      setAccountScope(null);
      resetIndexedDBConnection();
      if (prevLS === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = prevLS;
      if (prevIDB === undefined) delete globalThis.indexedDB;
      else globalThis.indexedDB = prevIDB;
    }
  });

  test('Adv-3: Missing IndexedDB user record with populated unowned legacy arrays', async () => {
    const prevLS = globalThis.localStorage;
    const prevIDB = globalThis.indexedDB;
    const storage = createMemoryStorage();
    const fakeIdb = createFakeIndexedDB();
    globalThis.localStorage = storage;
    globalThis.indexedDB = fakeIdb;
    resetIndexedDBConnection();
    setAccountScope(null);

    try {
      const db = await new Promise((resolve) => {
        const req = fakeIdb.open('AuroMatchDB');
        req.onsuccess = () => resolve(req.result);
      });
      const tx = db.transaction('gameState', 'readwrite');
      const store = tx.objectStore('gameState');
      // No user record, only arrays
      store.put(JSON.stringify([{ id: 'orphaned_c', text: 'Orphaned' }]), 'auro_match_consecrations');
      store.put(JSON.stringify(['orphaned_tile_1']), 'auro_match_unlocked_tiles');
      await new Promise((r) => { tx.oncomplete = r; });

      const healed = await autoHealFromIndexedDB({ accountScope: 'user_B' });
      assert.equal(healed, false, 'autoHealFromIndexedDB must fail closed when user record is missing');
      assert.equal(storage.getItem('auro_match_consecrations:user_B'), null);
      assert.equal(storage.getItem('auro_match_unlocked_tiles:user_B'), null);
      assert.deepEqual(profileState.reflections, []);
    } finally {
      setPurgeLock(false);
      setAccountScope(null);
      resetIndexedDBConnection();
      if (prevLS === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = prevLS;
      if (prevIDB === undefined) delete globalThis.indexedDB;
      else globalThis.indexedDB = prevIDB;
    }
  });

  test('Adv-4: Malformed owner metadata fails closed across all validation paths', async () => {
    const prevLS = globalThis.localStorage;
    const prevIDB = globalThis.indexedDB;
    const storage = createMemoryStorage();
    const fakeIdb = createFakeIndexedDB();
    globalThis.localStorage = storage;
    globalThis.indexedDB = fakeIdb;
    resetIndexedDBConnection();
    setAccountScope(null);

    const malformedVariants = [
      { label: 'number ownerId', record: { ownerId: 12345, profile: { lotusPetalCount: 50 } } },
      { label: 'object ownerId', record: { ownerId: { id: 'user_B' }, profile: { lotusPetalCount: 50 } } },
      { label: 'empty string ownerId', record: { ownerId: '', profile: { lotusPetalCount: 50 } } },
      { label: 'whitespace ownerId', record: { ownerId: '   ', profile: { lotusPetalCount: 50 } } },
      { label: 'boolean ownerId', record: { ownerId: true, profile: { lotusPetalCount: 50 } } },
      { label: 'array ownerId in profile', record: { profile: { ownerId: ['user_B'], lotusPetalCount: 50 } } },
      { label: 'null ownerId', record: { ownerId: null, profile: { lotusPetalCount: 50 } } }
    ];

    try {
      for (const variant of malformedVariants) {
        storage.clear();
        const db = await new Promise((resolve) => {
          const req = fakeIdb.open('AuroMatchDB');
          req.onsuccess = () => resolve(req.result);
        });
        const tx = db.transaction('gameState', 'readwrite');
        const store = tx.objectStore('gameState');
        store.put(JSON.stringify(variant.record), 'auro_match_user:user_B');
        store.put(JSON.stringify(variant.record), 'auro_match_user');
        await new Promise((r) => { tx.oncomplete = r; });

        const healed = await autoHealFromIndexedDB({ accountScope: 'user_B' });
        assert.equal(healed, false, `autoHealFromIndexedDB must fail closed on ${variant.label}`);
      }
    } finally {
      setPurgeLock(false);
      setAccountScope(null);
      resetIndexedDBConnection();
      if (prevLS === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = prevLS;
      if (prevIDB === undefined) delete globalThis.indexedDB;
      else globalThis.indexedDB = prevIDB;
    }
  });

  test('Adv-5: Account A legacy records followed by Account B initialization and export', async () => {
    const prevLS = globalThis.localStorage;
    const prevIDB = globalThis.indexedDB;
    const storage = createMemoryStorage();
    const fakeIdb = createFakeIndexedDB();
    globalThis.localStorage = storage;
    globalThis.indexedDB = fakeIdb;
    resetIndexedDBConnection();
    setAccountScope(null);

    try {
      const nativeAdapter = createAuroMatchNativeAdapter();
      const bridgeAdapter = createAuroMatchBridgeAdapter();

      // Account A writes legacy records
      storage.setItem('auro_match_user', JSON.stringify({
        profile: { lotusPetalCount: 80, consciousnessPoints: 300, ownerId: 'guest_A' },
        progression: { completedLevelsCount: 2, completedLevelIds: ['a_tile_1'] },
        reflections: [{ id: 'a_refl', text: 'A Reflection' }],
        ownerId: 'guest_A'
      }));
      storage.setItem('auro_match_consecrations', JSON.stringify([{ id: 'a_refl', text: 'A Reflection' }]));
      storage.setItem('auro_match_unlocked_tiles', JSON.stringify(['a_tile_1']));

      // Account B initializes
      await nativeAdapter.init({ accountScope: 'user_B' });

      // Account B must see no progress
      assert.equal(nativeAdapter.hasLocalProgress(), false, 'Account B native hasLocalProgress must be false');
      assert.equal(bridgeAdapter.hasLocalProgress(), false, 'Account B bridge hasLocalProgress must be false');

      const nativeEnvB = await nativeAdapter.exportEnvelope('guest_B');
      assert.equal(nativeEnvB.isEmpty, true, 'Native export must be empty for Account B');
      assert.equal(nativeEnvB.payload.profileState.profile.lotusPetalCount, 0);
      assert.deepEqual(nativeEnvB.payload.profileState.reflections, []);

      const bridgeEnvB = await bridgeAdapter.exportEnvelope('guest_B');
      assert.equal(bridgeEnvB.isEmpty, true, 'Bridge export must be empty for Account B');
      assert.equal(bridgeEnvB.payload.user?.profile?.lotusPetalCount || 0, 0);
      assert.deepEqual(bridgeEnvB.payload.consecrations, []);

      // Account A data remains intact and recoverable
      await nativeAdapter.init({ accountScope: 'guest_A' });
      assert.equal(nativeAdapter.hasLocalProgress(), true, 'Account A data must remain recoverable');
      assert.equal(profileState.profile.lotusPetalCount, 80);
      assert.deepEqual(profileState.reflections, [{ id: 'a_refl', text: 'A Reflection' }]);
    } finally {
      setPurgeLock(false);
      setAccountScope(null);
      resetIndexedDBConnection();
      if (prevLS === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = prevLS;
      if (prevIDB === undefined) delete globalThis.indexedDB;
      else globalThis.indexedDB = prevIDB;
    }
  });

  test('Adv-6: Account switching while dual-write reconciliation is pending isolates pending entries', async () => {
    const prevLS = globalThis.localStorage;
    const prevIDB = globalThis.indexedDB;
    const storage = createMemoryStorage();
    const fakeIdb = createFakeIndexedDB();
    globalThis.localStorage = storage;
    globalThis.indexedDB = fakeIdb;
    resetIndexedDBConnection();
    setAccountScope(null);

    try {
      // Force failure on IDB put for Account A's write to create divergence
      fakeIdb._setAlwaysFailPut(true);
      await setItemDualWrite('test_divergent_key', 'account_A_secret', { accountScope: 'user_A' });
      const statusA = getDualWriteStatus('test_divergent_key');
      assert.equal(statusA.pendingRepair, true);

      // Account switches to user_B
      setAccountScope('user_B');
      fakeIdb._setAlwaysFailPut(false);

      // Reconcile dual-write for Account B
      await reconcileDualWriteParity({ accountScope: 'user_B' });

      // Verify Account A secret was NOT written to user_B's store
      assert.equal(storage.getItem('test_divergent_key:user_B'), null);
      assert.equal(storage.getItem('auro_match_user:user_B'), null);
    } finally {
      fakeIdb._setAlwaysFailPut(false);
      setPurgeLock(false);
      setAccountScope(null);
      resetIndexedDBConnection();
      if (prevLS === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = prevLS;
      if (prevIDB === undefined) delete globalThis.indexedDB;
      else globalThis.indexedDB = prevIDB;
    }
  });

  test('Adv-7: Guest-to-authenticated migration with explicit ownership proof and anti-cross-claim guard', async () => {
    const prevLS = globalThis.localStorage;
    const prevIDB = globalThis.indexedDB;
    const storage = createMemoryStorage();
    const fakeIdb = createFakeIndexedDB();
    globalThis.localStorage = storage;
    globalThis.indexedDB = fakeIdb;
    resetIndexedDBConnection();
    setAccountScope(null);

    try {
      const nativeAdapter = createAuroMatchNativeAdapter();
      const bridgeAdapter = createAuroMatchBridgeAdapter();

      // Guest plays and earns progress
      setAccountScope('guest_migrating');
      profileState.profile.lotusPetalCount = 40;
      profileState.progression.completedLevelIds = ['mig_1', 'mig_2'];
      profileState.reflections = [{ id: 'mig_r', text: 'Migrate Me' }];
      saveProfileState({ accountScope: 'guest_migrating' });

      const guestEnvelope = await nativeAdapter.exportEnvelope('guest_migrating');
      assert.equal(guestEnvelope.isEmpty, false);

      // Legitimate migration to user_migrated
      const applied = await nativeAdapter.applyEnvelope(guestEnvelope, {
        accountScope: 'user_migrated',
        guestId: 'guest_migrating'
      });
      assert.equal(applied, true);
      assert.equal(profileState.ownerId, 'user_migrated');
      assert.equal(profileState.profile.lotusPetalCount, 40);

      // Cross-claim attack: envelope owned by 'user_attacker' targeted to 'user_migrated'
      const spoofEnvelope = {
        gameId: 'auromatch',
        ownerId: 'user_attacker',
        payload: {
          profileState: {
            profile: { lotusPetalCount: 9999, ownerId: 'user_attacker' },
            progression: { completedLevelsCount: 10, completedLevelIds: ['stolen'] },
            reflections: [{ id: 'stolen_r', text: 'Malicious payload' }]
          }
        }
      };
      const blockedNative = await nativeAdapter.applyEnvelope(spoofEnvelope, { accountScope: 'user_migrated' });
      assert.equal(blockedNative, false, 'Native applyEnvelope must reject owner mismatch');

      const blockedBridge = await bridgeAdapter.applyEnvelope(spoofEnvelope, { accountScope: 'user_migrated' });
      assert.equal(blockedBridge, false, 'Bridge applyEnvelope must reject owner mismatch');

      // State of user_migrated remains untouched
      assert.equal(profileState.profile.lotusPetalCount, 40);
    } finally {
      setPurgeLock(false);
      setAccountScope(null);
      resetIndexedDBConnection();
      if (prevLS === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = prevLS;
      if (prevIDB === undefined) delete globalThis.indexedDB;
      else globalThis.indexedDB = prevIDB;
    }
  });

  test('Adv-8: Account A -> B -> A across restart and recovery preserves both accounts intact', async () => {
    const prevLS = globalThis.localStorage;
    const prevIDB = globalThis.indexedDB;
    const storage = createMemoryStorage();
    const fakeIdb = createFakeIndexedDB();
    globalThis.localStorage = storage;
    globalThis.indexedDB = fakeIdb;
    resetIndexedDBConnection();
    setAccountScope(null);

    try {
      const nativeAdapter = createAuroMatchNativeAdapter();
      const ctxA = { accountScope: 'user_A', getGuestId: () => 'guest_A' };
      const ctxB = { accountScope: 'user_B', getGuestId: () => 'guest_B' };

      // 1. Account A saves state
      await nativeAdapter.init(ctxA);
      profileState.profile.lotusPetalCount = 90;
      profileState.progression.completedLevelIds = ['a_lvl'];
      profileState.progression.completedLevelsCount = 1;
      profileState.reflections = [{ id: 'a_ref', text: 'A refl' }];
      saveProfileState({ accountScope: 'user_A' });

      // 2. Account B saves state
      await nativeAdapter.init(ctxB);
      profileState.profile.lotusPetalCount = 30;
      profileState.progression.completedLevelIds = ['b_lvl'];
      profileState.progression.completedLevelsCount = 1;
      profileState.reflections = [{ id: 'b_ref', text: 'B refl' }];
      saveProfileState({ accountScope: 'user_B' });

      // 3. Simulate crash/reload: wipe localStorage
      storage.clear();

      // 4. Account A initializes & recovers
      await nativeAdapter.init(ctxA);
      assert.equal(profileState.profile.lotusPetalCount, 90, 'Account A petals recovered from IDB');
      assert.deepEqual(profileState.progression.completedLevelIds, ['a_lvl']);
      assert.deepEqual(profileState.reflections, [{ id: 'a_ref', text: 'A refl' }]);

      // 5. Account B initializes & recovers
      await nativeAdapter.init(ctxB);
      assert.equal(profileState.profile.lotusPetalCount, 30, 'Account B petals recovered from IDB');
      assert.deepEqual(profileState.progression.completedLevelIds, ['b_lvl']);
      assert.deepEqual(profileState.reflections, [{ id: 'b_ref', text: 'B refl' }]);

      // 6. Return to Account A
      await nativeAdapter.init(ctxA);
      assert.equal(profileState.profile.lotusPetalCount, 90, 'Account A petals remain 90');
      assert.deepEqual(profileState.progression.completedLevelIds, ['a_lvl']);
    } finally {
      setPurgeLock(false);
      setAccountScope(null);
      resetIndexedDBConnection();
      if (prevLS === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = prevLS;
      if (prevIDB === undefined) delete globalThis.indexedDB;
      else globalThis.indexedDB = prevIDB;
    }
  });

  test('Adv-9: Purge lock blocks recovery, export, apply, and writes', async () => {
    const prevLS = globalThis.localStorage;
    const prevIDB = globalThis.indexedDB;
    const storage = createMemoryStorage();
    const fakeIdb = createFakeIndexedDB();
    globalThis.localStorage = storage;
    globalThis.indexedDB = fakeIdb;
    resetIndexedDBConnection();

    try {
      const nativeAdapter = createAuroMatchNativeAdapter();
      const bridgeAdapter = createAuroMatchBridgeAdapter();

      setPurgeLock(true);
      assert.equal(isPurgeActive(), true);

      // Writes blocked
      assert.equal(saveProfileState(), false);
      const dwRes = await setItemDualWrite('test_purge', 'val');
      assert.equal(dwRes.blockedByPurge, true);

      // Auto-heal blocked
      const healed = await autoHealFromIndexedDB({ accountScope: 'user_test' });
      assert.equal(healed, false);

      // hasLocalProgress returns false
      assert.equal(nativeAdapter.hasLocalProgress(), false);
      assert.equal(bridgeAdapter.hasLocalProgress(), false);

      // exportEnvelope returns isEmpty: true
      const envNative = await nativeAdapter.exportEnvelope('guest_test');
      assert.equal(envNative.isEmpty, true);
      const envBridge = await bridgeAdapter.exportEnvelope('guest_test');
      assert.equal(envBridge.isEmpty, true);

      // applyEnvelope returns false
      const testEnv = { gameId: 'auromatch', payload: { profileState: {} } };
      assert.equal(await nativeAdapter.applyEnvelope(testEnv), false);
      assert.equal(await bridgeAdapter.applyEnvelope(testEnv), false);

      setPurgeLock(false);
      assert.equal(isPurgeActive(), false);
    } finally {
      setPurgeLock(false);
      setAccountScope(null);
      resetIndexedDBConnection();
      if (prevLS === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = prevLS;
      if (prevIDB === undefined) delete globalThis.indexedDB;
      else globalThis.indexedDB = prevIDB;
    }
  });

  test('Adv-10: Native adapter and SDK bridge parity across security boundaries', async () => {
    const prevLS = globalThis.localStorage;
    const prevIDB = globalThis.indexedDB;
    const storage = createMemoryStorage();
    const fakeIdb = createFakeIndexedDB();
    globalThis.localStorage = storage;
    globalThis.indexedDB = fakeIdb;
    resetIndexedDBConnection();
    setAccountScope(null);

    try {
      const nativeAdapter = createAuroMatchNativeAdapter();
      const bridgeAdapter = createAuroMatchBridgeAdapter();

      // 1. Empty state: both report false / isEmpty: true
      assert.equal(nativeAdapter.hasLocalProgress(), false);
      assert.equal(bridgeAdapter.hasLocalProgress(), false);
      const natEnv = await nativeAdapter.exportEnvelope('guest_1');
      const briEnv = await bridgeAdapter.exportEnvelope('guest_1');
      assert.equal(natEnv.isEmpty, true);
      assert.equal(briEnv.isEmpty, true);

      // 2. Foreign gameId rejection: both return false
      const foreignGameEnv = { gameId: 'vak', payload: { user: {} } };
      assert.equal(await nativeAdapter.applyEnvelope(foreignGameEnv), false);
      assert.equal(await bridgeAdapter.applyEnvelope(foreignGameEnv), false);

      // 3. Null / malformed envelope rejection: both return false
      assert.equal(await nativeAdapter.applyEnvelope(null), false);
      assert.equal(await bridgeAdapter.applyEnvelope(null), false);
      assert.equal(await nativeAdapter.applyEnvelope({ gameId: 'auromatch' }), false);
      assert.equal(await bridgeAdapter.applyEnvelope({ gameId: 'auromatch' }), false);

      // 4. Owner mismatch rejection: both fail closed
      const mismatchEnv = {
        gameId: 'auromatch',
        ownerId: 'user_attacker',
        payload: {
          user: { profile: { lotusPetalCount: 500 } },
          consecrations: [],
          unlockedTiles: []
        }
      };
      assert.equal(await nativeAdapter.applyEnvelope(mismatchEnv, { accountScope: 'user_victim' }), false);
      assert.equal(await bridgeAdapter.applyEnvelope(mismatchEnv, { accountScope: 'user_victim' }), false);
    } finally {
      setPurgeLock(false);
      setAccountScope(null);
      resetIndexedDBConnection();
      if (prevLS === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = prevLS;
      if (prevIDB === undefined) delete globalThis.indexedDB;
      else globalThis.indexedDB = prevIDB;
    }
  });
});

// =============================================================================
// PART 2 — REAL BROWSER VERIFICATION (CHROMIUM / EDGE VIA BROWSER HARNESS)
// =============================================================================

describe('Part 2 — Real Browser Verification (Chromium/Edge)', () => {
  let env;

  test.before(async () => {
    env = await createTestEnvironment({ port: 3341 });
  });

  test.after(async () => {
    if (env) await env.teardown();
  });

  test('Browser-1: Real Chromium/Edge loads artwork-concurrency.js directly, autosaves 12 revisions (10 immutable snapshots), forks conflict, isolates accounts, and persists across page.reload()', async () => {
    const inst = await env.createInstrumentedPage();
    try {
      await inst.page.goto(`${env.baseUrl}/index.html`, { waitUntil: 'networkidle0' });

      const firstPass = await inst.page.evaluate(async () => {
        const mod = await import('/assets/sdk/artwork-concurrency.js');
        const store = mod.createLocalArtworkStore({ accountScope: 'browser_guest' });

        const created = store.autosave({
          artworkId: 'art_browser_1',
          title: 'Browser Lotus',
          strokes: [{ x: 1, y: 1 }]
        }).artwork;

        let cur = created;
        for (let i = 2; i <= 12; i++) {
          cur = store.autosave({
            artworkId: 'art_browser_1',
            strokes: [{ x: i, y: i * 3 }]
          }).artwork;
        }

        // Trigger concurrent edit/edit conflict from same parent rev 11
        const remoteDivergent = mod.createArtworkEntity({
          artworkId: 'art_browser_1',
          title: 'Browser Lotus',
          strokes: [{ x: 999, y: 999 }],
          revision: 12,
          parentRevisionId: 'art_browser_1@rev_11'
        });
        const mergeOutcome = store.mergeRemote({ art_browser_1: remoteDivergent });

        // Account isolation check
        const otherAccountStore = mod.createLocalArtworkStore({ accountScope: 'browser_user_b' });

        return {
          revision: cur.revision,
          snapshotCount: cur.snapshots.length,
          firstSnapFrozen: Object.isFrozen(cur.snapshots[0]),
          action: mergeOutcome.actions[0].action,
          galleryCount: store.list().length,
          titles: store.list().map((a) => a.title).sort(),
          otherAccountCount: otherAccountStore.list().length
        };
      });

      assert.equal(firstPass.revision, 12);
      assert.equal(firstPass.snapshotCount, 10);
      assert.equal(firstPass.firstSnapFrozen, true);
      assert.equal(firstPass.action, 'FORKED_ON_CONCURRENT_EDIT');
      assert.equal(firstPass.galleryCount, 2);
      assert.deepEqual(firstPass.titles, ['Browser Lotus', 'Browser Lotus (Recovered Copy)']);
      assert.equal(firstPass.otherAccountCount, 0);

      // Real full page reload -> verify localStorage persistence survives reload
      await inst.page.reload({ waitUntil: 'networkidle0' });

      const afterReload = await inst.page.evaluate(async () => {
        const mod = await import('/assets/sdk/artwork-concurrency.js');
        const reloadedStore = mod.createLocalArtworkStore({ accountScope: 'browser_guest' });
        const orig = reloadedStore.get('art_browser_1');
        return {
          galleryCount: reloadedStore.list().length,
          titles: reloadedStore.list().map((a) => a.title).sort(),
          origRevision: orig ? orig.revision : null,
          origSnapshots: orig ? orig.snapshots.length : 0
        };
      });

      assert.equal(afterReload.galleryCount, 2);
      assert.deepEqual(afterReload.titles, ['Browser Lotus', 'Browser Lotus (Recovered Copy)']);
      assert.equal(afterReload.origRevision, 12);
      assert.equal(afterReload.origSnapshots, 10);
      const fatalErrors = inst.consoleErrors.filter((e) => e.type === 'pageerror' || !/504 \(Offline\)|Failed to load resource/i.test(e.text));
      assert.equal(fatalErrors.length, 0, `Unexpected browser console errors: ${JSON.stringify(fatalErrors)}`);
    } finally {
      await inst.close();
    }
  });

  test('Browser-2: Real Chromium/Edge executes AuroMatch Flora dual-write against real localStorage + real IndexedDB (AuroMatchDB), survives reload, heals localStorage wipe, and merges diverged Flora tiles', async () => {
    const inst = await env.createInstrumentedPage();
    try {
      await inst.page.goto(`${env.baseUrl}/index.html`, { waitUntil: 'networkidle0' });

      const writeRes = await inst.page.evaluate(async () => {
        const sa = await import('/games/auromatch/src/controllers/storageAdapter.js');
        sa.resetIndexedDBConnection();

        const r1 = await sa.setItemDualWrite('auro_match_unlocked_tiles', ['lotus_real', 'rose_real']);
        const r2 = await sa.setItemDualWrite('auro_match_consecrations', [{ id: 'real_c1', text: 'Real browser reflection' }]);
        const r3 = await sa.setItemDualWrite('auro_match_user', {
          profile: { lotusPetalCount: 33, consciousnessPoints: 440 },
          progression: { completedLevelsCount: 2, completedLevelIds: ['lotus_real', 'rose_real'], unlockedThemes: ['flowers'] },
          settings: {},
          dailyDrawDate: '2026-11-23'
        });
        return { r1, r2, r3, status: sa.getDualWriteStatus() };
      });

      assert.equal(writeRes.r1.lsOk, true);
      assert.equal(writeRes.r1.idbOk, true);
      assert.equal(writeRes.r2.idbOk, true);
      assert.equal(writeRes.r3.idbOk, true);
      assert.equal(writeRes.status.inSync, true);

      // Real full page reload -> wipe localStorage -> autoHealFromIndexedDB restores from REAL AuroMatchDB!
      await inst.page.reload({ waitUntil: 'networkidle0' });

      const healRes = await inst.page.evaluate(async () => {
        const sa = await import('/games/auromatch/src/controllers/storageAdapter.js');
        sa.resetIndexedDBConnection();

        localStorage.removeItem('auro_match_unlocked_tiles');
        localStorage.removeItem('auro_match_consecrations');
        localStorage.removeItem('auro_match_user');

        const healed = await sa.autoHealFromIndexedDB();
        const restoredTiles = JSON.parse(localStorage.getItem('auro_match_unlocked_tiles') || '[]');
        const restoredCons = JSON.parse(localStorage.getItem('auro_match_consecrations') || '[]');

        // Now create divergence: localStorage adds 'champa_ls' while AuroMatchDB keeps ['lotus_real', 'rose_real']
        localStorage.setItem('auro_match_unlocked_tiles', JSON.stringify(['lotus_real', 'champa_ls']));
        await sa.autoHealFromIndexedDB();
        const afterDivergenceLS = JSON.parse(localStorage.getItem('auro_match_unlocked_tiles') || '[]');
        const afterDivergenceIDB = JSON.parse((await sa.getItemAsync('auro_match_unlocked_tiles')) || '[]');

        return { healed, restoredTiles, restoredCons, afterDivergenceLS, afterDivergenceIDB };
      });

      assert.equal(healRes.healed, true);
      assert.deepEqual(new Set(healRes.restoredTiles), new Set(['lotus_real', 'rose_real']));
      assert.equal(healRes.restoredCons.length, 1);
      assert.deepEqual(new Set(healRes.afterDivergenceLS), new Set(['lotus_real', 'rose_real', 'champa_ls']));
      assert.deepEqual(new Set(healRes.afterDivergenceIDB), new Set(['lotus_real', 'rose_real', 'champa_ls']));
      const fatalErrors = inst.consoleErrors.filter((e) => e.type === 'pageerror' || !/504 \(Offline\)|Failed to load resource/i.test(e.text));
      assert.equal(fatalErrors.length, 0, `Unexpected browser console errors: ${JSON.stringify(fatalErrors)}`);
    } finally {
      await inst.close();
    }
  });

  test('Browser-3: Real Chromium/Edge preserves local-only Sankalpa E2EE vault and offline save access with zero cloud dependency', async () => {
    const inst = await env.createInstrumentedPage();
    try {
      await inst.page.goto(`${env.baseUrl}/index.html`, { waitUntil: 'networkidle0' });

      // Seed AuroMandala local Sankalpa vault + artwork and verify exported envelope excludes Sankalpa
      const beforeOffline = await inst.page.evaluate(async () => {
        const mandala = await import('/games/auromandala/assets/auromandala-sdk-bridge.js');
        localStorage.setItem(mandala.SANKALPA_VAULT_KEY, JSON.stringify({ iv: 'local_iv', ct: 'SECRET_BROWSER_SANKALPA' }));
        localStorage.setItem(mandala.CACHE_KEY, JSON.stringify({
          version: 2,
          highestStageCleared: 3,
          sankalpa: { note: 'PRIVATE_LOCAL_INTENTION' },
          savedArtworks: [{ id: 'art_offline_1', title: 'Offline Mandala', strokesCount: 9 }]
        }));

        const adapter = mandala.createAuroMandalaGameAdapter();
        const envObj = await adapter.exportEnvelope('guest_22222222-2222-4222-8222-222222222222');
        const envJson = JSON.stringify(envObj);
        return {
          hasProgress: adapter.hasLocalProgress(),
          leaksVault: envJson.includes('SECRET_BROWSER_SANKALPA') || envJson.includes('PRIVATE_LOCAL_INTENTION'),
          artworkCount: Object.keys(envObj.payload.artworks || {}).length
        };
      });

      assert.equal(beforeOffline.hasProgress, true);
      assert.equal(beforeOffline.leaksVault, false, 'Sankalpa E2EE vault must NEVER enter save envelope in browser');
      assert.equal(beforeOffline.artworkCount, 1);

      // Go offline via CDP and verify local artwork & Sankalpa remain fully readable with zero network calls
      await inst.setOffline(true);
      const offlineRead = await inst.page.evaluate(() => {
        const cache = JSON.parse(localStorage.getItem('pranamandala_game_cache_v2') || '{}');
        const vault = JSON.parse(localStorage.getItem('sankalpa_e2ee_vault') || '{}');
        return {
          online: navigator.onLine,
          stage: cache.highestStageCleared,
          vaultCt: vault.ct
        };
      });

      assert.equal(offlineRead.online, false);
      assert.equal(offlineRead.stage, 3);
      assert.equal(offlineRead.vaultCt, 'SECRET_BROWSER_SANKALPA');
      await inst.setOffline(false);
    } finally {
      await inst.close();
    }
  });

  test('Browser-4: Real Chromium/Edge Web Crypto rejects tampered remote checksum and aborts delayed applyEnvelope on account switch with zero localStorage metadata leakage', async () => {
    const inst = await env.createInstrumentedPage();
    try {
      await inst.page.goto(`${env.baseUrl}/index.html`, { waitUntil: 'networkidle0' });

      const browserResult = await inst.page.evaluate(async () => {
        const sdkMod = await import('/assets/sdk/auromind-sdk.js');
        const adpMod = await import('/assets/sdk/auromind-adapters.js');

        const acctA = {
          userId: 'browser_user_a',
          email: 'a@browser.test',
          displayName: 'A',
          provider: 'email',
          expiresAt: new Date(Date.now() + 3600_000).toISOString()
        };
        let activeAcct = acctA;
        const listeners = new Set();
        const mockAuth = {
          providerName: 'browser-mock-auth',
          isConfigured: () => true,
          async getSession() { return activeAcct ? { ...activeAcct } : null; },
          async getCurrentSession() { return activeAcct ? { ...activeAcct } : null; },
          async signIn() {
            const acct = { ...activeAcct };
            listeners.forEach((cb) => cb(acct));
            return { ok: true, status: 'authenticated', account: acct };
          },
          async signOut() { activeAcct = null; listeners.forEach((cb) => cb(null)); },
          onAuthStateChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
          switchTo(next) { activeAcct = next; listeners.forEach((cb) => cb(next ? { ...next } : null)); }
        };

        let remoteRecordToReturn = null;
        let pushCalls = 0;
        const mockSync = {
          providerName: 'browser-mock-sync',
          isConfigured: () => true,
          async pullLatest() { return remoteRecordToReturn; },
          async pushWithOptimisticLock() { pushCalls += 1; return { status: 'success', newRevision: 9 }; }
        };

        const sdk = sdkMod.createAuroMindSDK();
        await sdk.init({
          gameId: 'portal',
          capabilities: { authEnabled: true, cloudSyncEnabled: true },
          providers: { auth: mockAuth, cloudSync: mockSync }
        });

        let localScore = 150;
        let releaseDelay = null;
        let enteredDelay = null;
        let delayPromise = null;

        const adapter = {
          gameId: 'auroblocks',
          adapterVersion: '1.0.0',
          contractVersion: 1,
          integrationMode: 'native',
          storage: { kind: 'ls', ownedDatabases: [], ownedLocalStorageKeys: ['b19503_browser_blocks'], localOnlyVaults: [] },
          capabilities: { offlinePlay: true, localPersistence: true, cloudSyncEligible: true },
          hasLocalProgress: () => true,
          exportEnvelope: async (guestId) => {
            const payload = { highScore: localScore, completedStages: [1] };
            return {
              envelopeVersion: 1,
              gameId: 'auroblocks',
              gameSchemaVersion: 1,
              guestId,
              baseRevision: 0,
              clientUpdatedAt: new Date().toISOString(),
              isEmpty: false,
              checksum: await adpMod.computePayloadChecksum(payload),
              payload
            };
          },
          applyEnvelope: async (envelope) => {
            if (delayPromise) {
              if (enteredDelay) enteredDelay();
              await delayPromise;
            }
            localScore = envelope.payload.highScore;
            return true;
          }
        };

        sdk.adapters.register(adapter, { mergeStrategy: adpMod.AuroBlocksMergeStrategy });
        await sdk.adapters.init('auroblocks');
        await sdk.auth.signIn('email', { email: 'a@browser.test' });
        sdk.sync.setConsent(true);

        // 1. Tampered remote checksum (computed via real browser Web Crypto subtle.digest!)
        const origPayload = { highScore: 200, completedStages: [1] };
        const origChk = await adpMod.computePayloadChecksum(origPayload);
        remoteRecordToReturn = {
          gameId: 'auroblocks',
          revision: 2,
          checksum: origChk,
          payload: { highScore: 999999, completedStages: [1, 99] }
        };
        const tamperRes = await sdk.sync.syncNow('auroblocks');

        // 2. Valid remote record, but account switches during delayed applyEnvelope
        const validRemotePayload = { highScore: 500, completedStages: [1, 2] };
        remoteRecordToReturn = {
          gameId: 'auroblocks',
          revision: 2,
          checksum: await adpMod.computePayloadChecksum(validRemotePayload),
          payload: validRemotePayload
        };
        await sdk.sync.queueLocalChange('auroblocks');
        const enteredP = new Promise((r) => { enteredDelay = () => r('entered'); });
        delayPromise = new Promise((r) => { releaseDelay = r; });

        const raceSyncP = sdk.sync.syncNow('auroblocks');
        const firstSignal = await Promise.race([
          enteredP,
          raceSyncP.then((early) => ({ early }))
        ]);
        if (firstSignal !== 'entered') {
          throw new Error(`Expected applyEnvelope to be entered, but syncNow finished early: ${JSON.stringify(firstSignal)}`);
        }
        mockAuth.switchTo({
          userId: 'browser_user_b',
          email: 'b@browser.test',
          displayName: 'B',
          provider: 'email',
          expiresAt: new Date(Date.now() + 3600_000).toISOString()
        });
        releaseDelay();
        const raceRes = await raceSyncP;

        const userBStatus = sdk.sync.getSyncStatus();
        const userBStoredMeta = localStorage.getItem('auromind.platform.v1.sync.meta.browser_user_b');
        const userBOutbox = sdk.sync.getPendingOutboxCount();
        mockAuth.switchTo(acctA);
        const outboxAfterRace = sdk.sync.getPendingOutboxCount();
        sdk.dispose();

        return {
          tamperAction: tamperRes.results[0]?.action,
          tamperReason: tamperRes.results[0]?.reason,
          raceStatus: raceRes.status,
          raceReason: raceRes.reason,
          pushCalls,
          userBLastSyncAt: userBStatus.lastSyncAt,
          userBStoredMeta,
          userBOutbox,
          outboxAfterRace
        };
      });

      assert.equal(browserResult.tamperAction, 'invalid_remote_envelope');
      assert.equal(browserResult.tamperReason, 'REMOTE_CHECKSUM_MISMATCH');
      assert.equal(browserResult.raceStatus, 'aborted');
      assert.equal(browserResult.raceReason, 'account_changed_mid_sync');
      assert.equal(browserResult.pushCalls, 0, 'Zero cloud pushes after mid-apply account switch in browser');
      assert.equal(browserResult.userBLastSyncAt, null);
      assert.equal(browserResult.userBStoredMeta, null);
      assert.equal(browserResult.userBOutbox, 0, 'Account B must have isolated outbox');
      assert.equal(browserResult.outboxAfterRace, 1, 'Account A outbox must be preserved');

      const fatalErrors = inst.consoleErrors.filter((e) => e.type === 'pageerror' || !/504 \(Offline\)|Failed to load resource/i.test(e.text));
      assert.equal(fatalErrors.length, 0, `Unexpected browser console errors: ${JSON.stringify(fatalErrors)}`);
    } finally {
      await inst.close();
    }
  });
});
