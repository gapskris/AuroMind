/**
 * B19.5-07A — Offline Outbox Identity Isolation & Ownership Regression Suite
 *
 * Validates:
 * Case 1: Guest queues a mutation; Guest → Account A migrates it exactly once.
 * Case 2: Account A has a transient push failure; sign out; Account B signs in. B must not see or drain A's mutation.
 * Case 3: Account A signs back in; its pending mutation remains available to A.
 * Case 4: Guest mutations remain available in guest mode and are not automatically exposed to unrelated accounts.
 * Case 5: A successful push clears only the owning account's mutation.
 * Case 6: Reload/reinitialization preserves ownership and pending state.
 * Case 7: Reconnect and repeated retries do not bypass ownership checks.
 */

import test, { describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createAuroMindSDK } from './assets/sdk/auromind-sdk.js';
import {
  AuroBlocksMergeStrategy,
  AuroMatchMergeStrategy,
  AuroMandalaMergeStrategy,
  WordRiddleMergeStrategy,
  computePayloadChecksum
} from './assets/sdk/auromind-adapters.js';

// =============================================================================
// Isolated Storage & Environment Test Fixtures
// =============================================================================

function createMemoryStorage() {
  const map = new Map();
  return {
    get length() { return map.size; },
    key(i) { return Array.from(map.keys())[i] ?? null; },
    getItem(k) { return map.has(String(k)) ? map.get(String(k)) : null; },
    setItem(k, v) { map.set(String(k), String(v)); },
    removeItem(k) { map.delete(String(k)); },
    clear() { map.clear(); },
    _dump() { return Object.fromEntries(map.entries()); }
  };
}

function createFakeIndexedDB() {
  const dbs = new Map();

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
                  const k = explicitKey !== undefined ? explicitKey : (value && (value.id || value.key));
                  store.set(k, structuredClone(value));
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
    _peekStore(dbName, storeName) {
      const db = dbs.get(dbName);
      if (!db || !db.has(storeName)) return {};
      return Object.fromEntries(db.get(storeName).entries());
    },
    _seedStore(dbName, storeName, key, value) {
      if (!dbs.has(dbName)) dbs.set(dbName, new Map());
      const db = dbs.get(dbName);
      if (!db.has(storeName)) db.set(storeName, new Map());
      db.get(storeName).set(key, structuredClone(value));
    }
  };
}

function createSdkEnv({ storage = createMemoryStorage(), idb = createFakeIndexedDB(), onLine = true } = {}) {
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
      BroadcastChannel: null
    },
    storage,
    idb,
    setOnline(next) {
      onlineFlag = Boolean(next);
      win.dispatchEvent({ type: onlineFlag ? 'online' : 'offline' });
    }
  };
}

function createMockAuthProvider(initialAccount = null) {
  let currentAccount = initialAccount ? { ...initialAccount } : null;
  const authListeners = new Set();
  return {
    providerName: 'mock-auth',
    isConfigured: () => true,
    async getCurrentSession() {
      return currentAccount ? { ...currentAccount } : null;
    },
    async getSession() {
      return currentAccount ? { ...currentAccount } : null;
    },
    async signIn(_method, options = {}) {
      const email = options.email || 'player@example.com';
      const userId = options.userId || `user_${email.split('@')[0]}`;
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
    async signUp(params = {}) {
      const email = params.email || 'newplayer@example.com';
      const userId = params.userId || `user_${email.split('@')[0]}`;
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
    async verifyOtp(params = {}) {
      const email = params.email || 'player@example.com';
      const userId = params.userId || `user_${email.split('@')[0]}`;
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
    async handleOAuthCallback(params = {}) {
      const email = params.email || 'oauth_user@example.com';
      const userId = params.userId || 'user_oauth';
      currentAccount = {
        userId,
        email,
        displayName: 'OAuth Player',
        provider: 'google',
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
    }
  };
}

function createMockCloudSyncStore() {
  const rows = new Map(); // `${userId}::${gameId}` -> record
  let pullCount = 0;
  let pushCount = 0;
  let failNextPush = null;

  return {
    rows,
    getStats: () => ({ pullCount, pushCount }),
    setFailNextPush(errMsg) {
      failNextPush = errMsg;
    },
    seed(userId, gameId, record) {
      rows.set(`${userId}::${gameId}`, structuredClone(record));
    },
    get(userId, gameId) {
      return rows.get(`${userId}::${gameId}`) || null;
    },
    provider: {
      providerName: 'mock-cloud-sync',
      isConfigured: () => true,
      async pullLatest(userId, gameId) {
        pullCount += 1;
        const rec = rows.get(`${userId}::${gameId}`);
        return rec ? structuredClone(rec) : null;
      },
      async pushWithOptimisticLock(envelope, userId, expectedRevision) {
        const gameId = envelope.gameId;
        pushCount += 1;
        if (failNextPush) {
          const msg = failNextPush;
          failNextPush = null;
          throw new Error(msg);
        }
        const key = `${userId}::${gameId}`;
        const existing = rows.get(key);
        const currentRev = existing ? existing.revision : 0;
        if (existing && expectedRevision !== currentRev) {
          return {
            status: 'conflict',
            currentRevision: currentRev,
            serverRecord: structuredClone(existing)
          };
        }
        const nextRev = currentRev + 1;
        const stored = {
          userId,
          gameId,
          revision: nextRev,
          checksum: envelope.checksum,
          payload: structuredClone(envelope.payload),
          updatedAt: new Date().toISOString()
        };
        rows.set(key, stored);
        return { status: 'success', newRevision: nextRev, record: stored };
      }
    }
  };
}

function createInMemoryGameAdapter(gameId, initialPayload = { score: 100 }) {
  let state = structuredClone(initialPayload);
  return {
    getState: () => structuredClone(state),
    setState: (next) => { state = structuredClone(next); },
    adapter: {
      gameId,
      adapterVersion: '1.0.0',
      contractVersion: 1,
      integrationMode: 'native',
      storage: {
        kind: 'ls',
        ownedDatabases: [],
        ownedLocalStorageKeys: [`test_${gameId}_save`],
        localOnlyVaults: []
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
        payload: structuredClone(state)
      }),
      applyEnvelope: async (envelope) => {
        if (!envelope || !envelope.payload) return false;
        state = structuredClone(envelope.payload);
        return true;
      }
    }
  };
}

// =============================================================================
// Test Suite: B19.5-07A Offline Outbox Identity Isolation
// =============================================================================

describe('B19.5-07A: Offline Outbox Identity Isolation & Ownership Enforcement', () => {

  test('Case 1: Guest queues a mutation; Guest -> Account A migrates it exactly once', async () => {
    const { env, storage, idb } = createSdkEnv();
    const auth = createMockAuthProvider(null); // start unauthenticated (guest)
    const cloud = createMockCloudSyncStore();

    const sdk = createAuroMindSDK({ env });
    await sdk.init({
      gameId: 'portal',
      capabilities: { authEnabled: true, cloudSyncEnabled: true },
      providers: { auth, cloudSync: cloud.provider }
    });

    const matchHarness = createInMemoryGameAdapter('auromatch', { level: 2 });
    sdk.adapters.register(matchHarness.adapter, { mergeStrategy: AuroMatchMergeStrategy });
    await sdk.adapters.init('auromatch');

    // 1. Guest queues mutation
    await sdk.sync.queueLocalChange('auromatch');
    assert.equal(sdk.sync.getPendingOutboxCount(), 1, 'Guest must have 1 pending mutation in memory outbox');

    // Verify IDB outbox record has mut.userId === null
    const idbBefore = idb._peekStore('AuroMindPlatformDB', 'platform_sync_outbox');
    const guestMutations = Object.values(idbBefore).filter((m) => m && m.gameId === 'auromatch');
    assert.equal(guestMutations.length, 1, 'IDB outbox must have 1 record for auromatch');
    assert.equal(guestMutations[0].userId, null, 'Guest mutation record must have mut.userId === null');

    // 2. Guest upgrades to Account A
    const upgradeRes = await sdk.auth.upgradeGuestToAccount(
      { email: 'usera@example.com', userId: 'user_a' }
    );
    assert.ok(upgradeRes.ok, 'Upgrade to Account A must succeed');
    assert.equal(upgradeRes.account.userId, 'user_a');

    // Verify IDB outbox has been migrated to user_a
    const idbAfterMigration = idb._peekStore('AuroMindPlatformDB', 'platform_sync_outbox');
    const allMutations = Object.values(idbAfterMigration).filter((m) => m && m.gameId === 'auromatch');
    assert.equal(allMutations.length, 1, 'Total mutations count in IDB must remain 1');
    assert.equal(allMutations[0].userId, 'user_a', 'Mutation must now be owned by user_a');
    assert.ok(allMutations[0].migratedAt, 'Mutation must be stamped with migratedAt');

    // In-memory outbox for user_a should hold the mutation
    assert.equal(sdk.sync.getPendingOutboxCount(), 1, 'Account A must have 1 pending mutation');
    assert.deepEqual(sdk.sync.getPendingGames(), ['auromatch']);

    // 3. Account A signs out -> back to guest
    await sdk.auth.signOut();
    assert.equal(sdk.sync.getPendingOutboxCount(), 0, 'Guest outbox must now be 0 because mutation was migrated');
    assert.deepEqual(sdk.sync.getPendingGames(), []);

    // 4. Account B signs in with migration flag -> guest outbox was already migrated, so B gets nothing!
    await sdk.auth.signIn('email', { email: 'userb@example.com', userId: 'user_b' }, { migrateGuestData: true });
    assert.equal(sdk.sync.getPendingOutboxCount(), 0, 'Account B must not adopt Account A mutation (migrated exactly once)');
    assert.deepEqual(sdk.sync.getPendingGames(), []);

    // Verify IDB record is still strictly owned by user_a
    const idbFinal = idb._peekStore('AuroMindPlatformDB', 'platform_sync_outbox');
    const mutFinal = Object.values(idbFinal).filter((m) => m && m.gameId === 'auromatch');
    assert.equal(mutFinal.length, 1);
    assert.equal(mutFinal[0].userId, 'user_a');

    sdk.dispose();
  });

  test('Case 2: Account A has a transient push failure; sign out; Account B signs in. B must not see or drain A mutation', async () => {
    const { env, storage, idb } = createSdkEnv();
    const auth = createMockAuthProvider(null);
    const cloud = createMockCloudSyncStore();

    const sdk = createAuroMindSDK({ env });
    await sdk.init({
      gameId: 'portal',
      capabilities: { authEnabled: true, cloudSyncEnabled: true },
      providers: { auth, cloudSync: cloud.provider }
    });

    const blocksHarness = createInMemoryGameAdapter('auroblocks', { score: 500 });
    sdk.adapters.register(blocksHarness.adapter, { mergeStrategy: AuroBlocksMergeStrategy });
    await sdk.adapters.init('auroblocks');

    // 1. Account A signs in
    await sdk.auth.signIn('email', { email: 'usera@example.com', userId: 'user_a' });
    sdk.sync.setConsent(true);

    // Queue mutation for auroblocks under user_a
    await sdk.sync.queueLocalChange('auroblocks');
    assert.equal(sdk.sync.getPendingOutboxCount(), 1);

    // Verify IDB outbox has userId: 'user_a'
    const idbBefore = idb._peekStore('AuroMindPlatformDB', 'platform_sync_outbox');
    const aMuts = Object.values(idbBefore).filter((m) => m && m.gameId === 'auroblocks');
    assert.equal(aMuts.length, 1);
    assert.equal(aMuts[0].userId, 'user_a');

    // 2. Push fails transiently
    cloud.setFailNextPush('503 Network Interrupted');
    const pushRes = await sdk.sync.drainOutbox();
    assert.equal(pushRes.results[0].action, 'error');
    assert.equal(sdk.sync.getPendingOutboxCount(), 1, 'Transiently failed mutation must remain in Account A outbox');

    // 3. Account A signs out
    await sdk.auth.signOut();

    // 4. Account B signs in (standard sign-in without guest migration)
    await sdk.auth.signIn('email', { email: 'userb@example.com', userId: 'user_b' });
    sdk.sync.setConsent(true);

    // Account B must NOT see Account A's mutation
    assert.equal(sdk.sync.getPendingOutboxCount(), 0, 'Account B outbox count must be 0');
    assert.deepEqual(sdk.sync.getPendingGames(), [], 'Account B pending games must be empty');

    // Account B calls drainOutbox() -> must NOT drain or touch Account A's mutation
    const initialPushCount = cloud.getStats().pushCount;
    const bDrainRes = await sdk.sync.drainOutbox();
    assert.equal(cloud.getStats().pushCount, initialPushCount, 'No pushes should be attempted for Account B');

    // Account A's mutation in IDB must remain untouched with userId: 'user_a'
    const idbAfterB = idb._peekStore('AuroMindPlatformDB', 'platform_sync_outbox');
    const aMutsAfterB = Object.values(idbAfterB).filter((m) => m && m.gameId === 'auroblocks');
    assert.equal(aMutsAfterB.length, 1);
    assert.equal(aMutsAfterB[0].userId, 'user_a', 'Account A mutation must remain intact and owned by user_a');

    sdk.dispose();
  });

  test('Case 3: Account A signs back in; its pending mutation remains available to A', async () => {
    const { env, storage, idb } = createSdkEnv();
    const auth = createMockAuthProvider(null);
    const cloud = createMockCloudSyncStore();

    const sdk = createAuroMindSDK({ env });
    await sdk.init({
      gameId: 'portal',
      capabilities: { authEnabled: true, cloudSyncEnabled: true },
      providers: { auth, cloudSync: cloud.provider }
    });

    const blocksHarness = createInMemoryGameAdapter('auroblocks', { score: 999 });
    sdk.adapters.register(blocksHarness.adapter, { mergeStrategy: AuroBlocksMergeStrategy });
    await sdk.adapters.init('auroblocks');

    // Account A signs in, queues mutation, fails push
    await sdk.auth.signIn('email', { email: 'usera@example.com', userId: 'user_a' });
    sdk.sync.setConsent(true);
    await sdk.sync.queueLocalChange('auroblocks');

    cloud.setFailNextPush('500 Server Error');
    await sdk.sync.drainOutbox();
    assert.equal(sdk.sync.getPendingOutboxCount(), 1);

    // Sign out A, sign in B
    await sdk.auth.signOut();
    await sdk.auth.signIn('email', { email: 'userb@example.com', userId: 'user_b' });
    assert.equal(sdk.sync.getPendingOutboxCount(), 0);

    // Sign out B, sign back in A
    await sdk.auth.signOut();
    await sdk.auth.signIn('email', { email: 'usera@example.com', userId: 'user_a' });

    // Account A's pending mutation must be restored
    assert.equal(sdk.sync.getPendingOutboxCount(), 1, 'Account A pending count must be 1 upon sign-in');
    assert.deepEqual(sdk.sync.getPendingGames(), ['auroblocks']);

    // Now push succeeds on healthy network
    const successRes = await sdk.sync.drainOutbox();
    assert.equal(successRes.status, 'success');
    assert.equal(sdk.sync.getPendingOutboxCount(), 0, 'Account A outbox count must be 0 after successful drain');

    // Verified cleared from IDB
    const idbAfter = idb._peekStore('AuroMindPlatformDB', 'platform_sync_outbox');
    const remaining = Object.values(idbAfter).filter((m) => m && m.gameId === 'auroblocks');
    assert.equal(remaining.length, 0, 'IDB outbox for auroblocks must be cleared after successful push');

    sdk.dispose();
  });

  test('Case 4: Guest mutations remain available in guest mode and are not automatically exposed to unrelated accounts', async () => {
    const { env, storage, idb } = createSdkEnv();
    const auth = createMockAuthProvider(null);
    const cloud = createMockCloudSyncStore();

    const sdk = createAuroMindSDK({ env });
    await sdk.init({
      gameId: 'portal',
      capabilities: { authEnabled: true, cloudSyncEnabled: true },
      providers: { auth, cloudSync: cloud.provider }
    });

    const riddleHarness = createInMemoryGameAdapter('word-riddle', { solved: [1, 2, 3] });
    sdk.adapters.register(riddleHarness.adapter, { mergeStrategy: WordRiddleMergeStrategy });
    await sdk.adapters.init('word-riddle');

    // 1. Guest queues mutation
    await sdk.sync.queueLocalChange('word-riddle');
    assert.equal(sdk.sync.getPendingOutboxCount(), 1);
    assert.deepEqual(sdk.sync.getPendingGames(), ['word-riddle']);

    // 2. Unrelated Account C signs in normally (migrateGuestData = false)
    await sdk.auth.signIn('email', { email: 'userc@example.com', userId: 'user_c' });
    sdk.sync.setConsent(true);

    // Account C must NOT see or drain guest mutation
    assert.equal(sdk.sync.getPendingOutboxCount(), 0, 'Account C must not see un-migrated guest mutation');
    assert.deepEqual(sdk.sync.getPendingGames(), []);

    const initialPushes = cloud.getStats().pushCount;
    await sdk.sync.drainOutbox();
    assert.equal(cloud.getStats().pushCount, initialPushes, 'No pushes should happen for Account C');

    // Guest mutation in IDB must still have userId: null
    const idbDuringC = idb._peekStore('AuroMindPlatformDB', 'platform_sync_outbox');
    const guestMuts = Object.values(idbDuringC).filter((m) => m && m.gameId === 'word-riddle');
    assert.equal(guestMuts.length, 1);
    assert.equal(guestMuts[0].userId, null, 'Mutation must retain mut.userId === null');

    // 3. Account C signs out
    await sdk.auth.signOut();

    // Guest mode is active again; guest mutation must remain pending!
    assert.equal(sdk.sync.getPendingOutboxCount(), 1, 'Guest must still have pending mutation');
    assert.deepEqual(sdk.sync.getPendingGames(), ['word-riddle']);

    sdk.dispose();
  });

  test('Case 5: A successful push clears only the owning account mutation', async () => {
    const { env, storage, idb } = createSdkEnv();
    const auth = createMockAuthProvider(null);
    const cloud = createMockCloudSyncStore();

    // Manually seed IDB with two mutations for the same game 'auromandala':
    // One for user_a, one for user_b
    idb._seedStore('AuroMindPlatformDB', 'platform_sync_outbox', 'mut_a_mandala', {
      id: 'mut_a_mandala',
      gameId: 'auromandala',
      userId: 'user_a',
      attempts: 0,
      status: 'pending',
      queuedAt: new Date().toISOString()
    });
    idb._seedStore('AuroMindPlatformDB', 'platform_sync_outbox', 'mut_b_mandala', {
      id: 'mut_b_mandala',
      gameId: 'auromandala',
      userId: 'user_b',
      attempts: 0,
      status: 'pending',
      queuedAt: new Date().toISOString()
    });

    const sdk = createAuroMindSDK({ env });
    await sdk.init({
      gameId: 'portal',
      capabilities: { authEnabled: true, cloudSyncEnabled: true },
      providers: { auth, cloudSync: cloud.provider }
    });

    const mandalaHarness = createInMemoryGameAdapter('auromandala', { petals: 8 });
    sdk.adapters.register(mandalaHarness.adapter, { mergeStrategy: AuroMandalaMergeStrategy });
    await sdk.adapters.init('auromandala');

    // Account A signs in
    await sdk.auth.signIn('email', { email: 'usera@example.com', userId: 'user_a' });
    sdk.sync.setConsent(true);

    // Account A drains outbox
    const drainRes = await sdk.sync.drainOutbox();
    assert.equal(drainRes.status, 'success');
    assert.equal(sdk.sync.getPendingOutboxCount(), 0, 'Account A outbox should be drained');

    // Check IDB store: user_a's mutation is deleted, BUT user_b's mutation STILL EXISTS!
    const idbAfter = idb._peekStore('AuroMindPlatformDB', 'platform_sync_outbox');
    assert.equal(idbAfter['mut_a_mandala'], undefined, 'User A mutation mut_a_mandala must be deleted');
    assert.ok(idbAfter['mut_b_mandala'], 'User B mutation mut_b_mandala MUST NOT be deleted by User A');
    assert.equal(idbAfter['mut_b_mandala'].userId, 'user_b');

    sdk.dispose();
  });

  test('Case 6: Reload/reinitialization preserves ownership and pending state', async () => {
    const storage = createMemoryStorage();
    const idb = createFakeIndexedDB();

    // Seed IDB outbox with:
    // 1 mutation for user_a (vak)
    // 1 mutation for guest (auroblocks)
    idb._seedStore('AuroMindPlatformDB', 'platform_sync_outbox', 'mut_a_vak', {
      id: 'mut_a_vak',
      gameId: 'vak',
      userId: 'user_a',
      attempts: 0,
      status: 'pending',
      queuedAt: new Date().toISOString()
    });
    idb._seedStore('AuroMindPlatformDB', 'platform_sync_outbox', 'mut_guest_blocks', {
      id: 'mut_guest_blocks',
      gameId: 'auroblocks',
      userId: null,
      attempts: 0,
      status: 'pending',
      queuedAt: new Date().toISOString()
    });

    // 6a: Cold start with active session for user_a
    {
      const { env } = createSdkEnv({ storage, idb });
      const auth = createMockAuthProvider({
        userId: 'user_a',
        email: 'usera@example.com',
        displayName: 'User A',
        provider: 'email',
        expiresAt: new Date(Date.now() + 3600_000).toISOString()
      });
      const cloud = createMockCloudSyncStore();

      const sdk = createAuroMindSDK({ env });
      await sdk.init({
        gameId: 'portal',
        capabilities: { authEnabled: true, cloudSyncEnabled: true },
        providers: { auth, cloudSync: cloud.provider }
      });

      // User A should hydrate ONLY mut_a_vak, NOT mut_guest_blocks!
      assert.equal(sdk.sync.getPendingOutboxCount(), 1);
      assert.deepEqual(sdk.sync.getPendingGames(), ['vak']);
      sdk.dispose();
    }

    // 6b: Cold start in guest mode (null session)
    {
      const { env } = createSdkEnv({ storage, idb });
      const auth = createMockAuthProvider(null);
      const cloud = createMockCloudSyncStore();

      const sdk = createAuroMindSDK({ env });
      await sdk.init({
        gameId: 'portal',
        capabilities: { authEnabled: true, cloudSyncEnabled: true },
        providers: { auth, cloudSync: cloud.provider }
      });

      // Guest should hydrate ONLY mut_guest_blocks, NOT mut_a_vak!
      assert.equal(sdk.sync.getPendingOutboxCount(), 1);
      assert.deepEqual(sdk.sync.getPendingGames(), ['auroblocks']);
      sdk.dispose();
    }
  });

  test('Case 7: Reconnect and repeated retries do not bypass ownership checks', async () => {
    const { env, storage, idb, setOnline } = createSdkEnv({ onLine: false }); // start offline
    const auth = createMockAuthProvider(null);
    const cloud = createMockCloudSyncStore();

    // IDB contains pending mutations for user_a ('auromatch') and guest ('word-riddle')
    idb._seedStore('AuroMindPlatformDB', 'platform_sync_outbox', 'mut_a_match', {
      id: 'mut_a_match',
      gameId: 'auromatch',
      userId: 'user_a',
      attempts: 0,
      status: 'pending',
      queuedAt: new Date().toISOString()
    });
    idb._seedStore('AuroMindPlatformDB', 'platform_sync_outbox', 'mut_g_riddle', {
      id: 'mut_g_riddle',
      gameId: 'word-riddle',
      userId: null,
      attempts: 0,
      status: 'pending',
      queuedAt: new Date().toISOString()
    });

    const sdk = createAuroMindSDK({ env });
    await sdk.init({
      gameId: 'portal',
      capabilities: { authEnabled: true, cloudSyncEnabled: true },
      providers: { auth, cloudSync: cloud.provider }
    });

    // Account B signs in (has 0 mutations)
    await sdk.auth.signIn('email', { email: 'userb@example.com', userId: 'user_b' });
    sdk.sync.setConsent(true);
    assert.equal(sdk.sync.getPendingOutboxCount(), 0);

    // Simulate network reconnect
    setOnline(true);

    // Call onReconnect multiple times (simulating unstable / bouncing connection)
    await sdk.sync.onReconnect();
    await sdk.sync.onReconnect();
    await sdk.sync.onReconnect();

    // Verify Account B never drains or pushes user_a or guest mutations
    assert.equal(cloud.getStats().pushCount, 0, 'Zero pushes should occur for Account B');
    assert.equal(sdk.sync.getPendingOutboxCount(), 0, 'Account B outbox count must remain 0');

    // Both user_a and guest mutations must be completely intact in IDB
    const idbAfter = idb._peekStore('AuroMindPlatformDB', 'platform_sync_outbox');
    assert.ok(idbAfter['mut_a_match'], 'mut_a_match must remain in IDB');
    assert.equal(idbAfter['mut_a_match'].userId, 'user_a');
    assert.ok(idbAfter['mut_g_riddle'], 'mut_g_riddle must remain in IDB');
    assert.equal(idbAfter['mut_g_riddle'].userId, null);

    sdk.dispose();
  });

  describe('B19.5-07A1: Outbox Migration Argument Propagation & Edge Cases', () => {

    test('07A1-1: Explicit signIn with migrateFromGuest: true migrates guest outbox to new account', async () => {
      const { env, storage, idb } = createSdkEnv();
      const auth = createMockAuthProvider(null);
      const cloud = createMockCloudSyncStore();

      const sdk = createAuroMindSDK({ env });
      await sdk.init({
        gameId: 'portal',
        capabilities: { authEnabled: true, cloudSyncEnabled: true },
        providers: { auth, cloudSync: cloud.provider }
      });

      const matchHarness = createInMemoryGameAdapter('auromatch', { score: 10 });
      sdk.adapters.register(matchHarness.adapter, { mergeStrategy: AuroMatchMergeStrategy });
      await sdk.adapters.init('auromatch');

      // Guest queues mutation
      await sdk.sync.queueLocalChange('auromatch');
      assert.equal(sdk.sync.getPendingOutboxCount(), 1);

      // Explicit signIn with migrateFromGuest: true
      const res = await sdk.auth.signIn('email', { email: 'alice@example.com', userId: 'user_alice' }, { migrateFromGuest: true });
      assert.ok(res.ok);

      // Verify migration succeeded
      assert.equal(sdk.sync.getPendingOutboxCount(), 1);
      assert.deepEqual(sdk.sync.getPendingGames(), ['auromatch']);

      const idbStore = idb._peekStore('AuroMindPlatformDB', 'platform_sync_outbox');
      const muts = Object.values(idbStore).filter((m) => m && m.gameId === 'auromatch');
      assert.equal(muts.length, 1);
      assert.equal(muts[0].userId, 'user_alice');

      sdk.dispose();
    });

    test('07A1-2: Ordinary signIn without migration options does NOT migrate guest outbox', async () => {
      const { env, storage, idb } = createSdkEnv();
      const auth = createMockAuthProvider(null);
      const cloud = createMockCloudSyncStore();

      const sdk = createAuroMindSDK({ env });
      await sdk.init({
        gameId: 'portal',
        capabilities: { authEnabled: true, cloudSyncEnabled: true },
        providers: { auth, cloudSync: cloud.provider }
      });

      const matchHarness = createInMemoryGameAdapter('auromatch', { score: 10 });
      sdk.adapters.register(matchHarness.adapter, { mergeStrategy: AuroMatchMergeStrategy });
      await sdk.adapters.init('auromatch');

      // Guest queues mutation
      await sdk.sync.queueLocalChange('auromatch');
      assert.equal(sdk.sync.getPendingOutboxCount(), 1);

      // Ordinary signIn (no migration option)
      const res = await sdk.auth.signIn('email', { email: 'bob@example.com', userId: 'user_bob' });
      assert.ok(res.ok);

      // Bob's outbox must be empty
      assert.equal(sdk.sync.getPendingOutboxCount(), 0);
      assert.deepEqual(sdk.sync.getPendingGames(), []);

      // Guest mutation remains in IDB owned by null
      const idbStore = idb._peekStore('AuroMindPlatformDB', 'platform_sync_outbox');
      const muts = Object.values(idbStore).filter((m) => m && m.gameId === 'auromatch');
      assert.equal(muts.length, 1);
      assert.equal(muts[0].userId, null);

      sdk.dispose();
    });

    test('07A1-3: Account A -> Account B switch with migrateFromGuest: true never migrates', async () => {
      const { env, storage, idb } = createSdkEnv();
      const auth = createMockAuthProvider(null);
      const cloud = createMockCloudSyncStore();

      const sdk = createAuroMindSDK({ env });
      await sdk.init({
        gameId: 'portal',
        capabilities: { authEnabled: true, cloudSyncEnabled: true },
        providers: { auth, cloudSync: cloud.provider }
      });

      const matchHarness = createInMemoryGameAdapter('auromatch', { score: 50 });
      sdk.adapters.register(matchHarness.adapter, { mergeStrategy: AuroMatchMergeStrategy });
      await sdk.adapters.init('auromatch');

      // Account A signs in
      await sdk.auth.signIn('email', { email: 'alpha@example.com', userId: 'user_alpha' });
      await sdk.sync.queueLocalChange('auromatch');
      assert.equal(sdk.sync.getPendingOutboxCount(), 1);

      // Account B signs in directly (Account -> Account switch) even if migrateFromGuest is true!
      await sdk.auth.signIn('email', { email: 'beta@example.com', userId: 'user_beta' }, { migrateFromGuest: true });

      // Account B must NOT have Account A mutation
      assert.equal(sdk.sync.getPendingOutboxCount(), 0);
      assert.deepEqual(sdk.sync.getPendingGames(), []);

      // Mutation in IDB must still be strictly owned by user_alpha
      const idbStore = idb._peekStore('AuroMindPlatformDB', 'platform_sync_outbox');
      const muts = Object.values(idbStore).filter((m) => m && m.gameId === 'auromatch');
      assert.equal(muts.length, 1);
      assert.equal(muts[0].userId, 'user_alpha');

      sdk.dispose();
    });

    test('07A1-4: verifyOtp correctly propagates explicit migration option', async () => {
      const { env, storage, idb } = createSdkEnv();
      const auth = createMockAuthProvider(null);
      const cloud = createMockCloudSyncStore();

      const sdk = createAuroMindSDK({ env });
      await sdk.init({
        gameId: 'portal',
        capabilities: { authEnabled: true, cloudSyncEnabled: true },
        providers: { auth, cloudSync: cloud.provider }
      });

      const matchHarness = createInMemoryGameAdapter('auromatch', { score: 99 });
      sdk.adapters.register(matchHarness.adapter, { mergeStrategy: AuroMatchMergeStrategy });
      await sdk.adapters.init('auromatch');

      // Guest queues mutation
      await sdk.sync.queueLocalChange('auromatch');

      // verifyOtp with migrateGuestData: true
      const res = await sdk.auth.verifyOtp('otpuser@example.com', '123456', { migrateGuestData: true, userId: 'user_otp' });
      assert.ok(res.ok);

      // Outbox migrated to user_otpuser
      assert.equal(sdk.sync.getPendingOutboxCount(), 1);
      const idbStore = idb._peekStore('AuroMindPlatformDB', 'platform_sync_outbox');
      const muts = Object.values(idbStore).filter((m) => m && m.gameId === 'auromatch');
      assert.equal(muts.length, 1);
      assert.equal(muts[0].userId, 'user_otpuser');

      sdk.dispose();
    });

    test('07A1-5: handleAuthCallback correctly propagates explicit migration option', async () => {
      const { env, storage, idb } = createSdkEnv();
      const auth = createMockAuthProvider(null);
      const cloud = createMockCloudSyncStore();

      const sdk = createAuroMindSDK({ env });
      await sdk.init({
        gameId: 'portal',
        capabilities: { authEnabled: true, cloudSyncEnabled: true },
        providers: { auth, cloudSync: cloud.provider }
      });

      const matchHarness = createInMemoryGameAdapter('auromatch', { score: 100 });
      sdk.adapters.register(matchHarness.adapter, { mergeStrategy: AuroMatchMergeStrategy });
      await sdk.adapters.init('auromatch');

      // Guest queues mutation
      await sdk.sync.queueLocalChange('auromatch');

      // handleAuthCallback with migrateFromGuest: true
      const res = await sdk.auth.handleAuthCallback({ code: 'valid_code', state: 'valid_state' }, { migrateFromGuest: true, userId: 'user_oauth' });
      assert.ok(res.ok);

      // Outbox migrated to user_oauth
      assert.equal(sdk.sync.getPendingOutboxCount(), 1);
      const idbStore = idb._peekStore('AuroMindPlatformDB', 'platform_sync_outbox');
      const muts = Object.values(idbStore).filter((m) => m && m.gameId === 'auromatch');
      assert.equal(muts.length, 1);
      assert.equal(muts[0].userId, 'user_oauth');

      sdk.dispose();
    });

    test('07A1-6: Repeated upgrade does not duplicate data and handles ALREADY_AUTHENTICATED', async () => {
      const { env, storage, idb } = createSdkEnv();
      const auth = createMockAuthProvider(null);
      const cloud = createMockCloudSyncStore();

      const sdk = createAuroMindSDK({ env });
      await sdk.init({
        gameId: 'portal',
        capabilities: { authEnabled: true, cloudSyncEnabled: true },
        providers: { auth, cloudSync: cloud.provider }
      });

      const matchHarness = createInMemoryGameAdapter('auromatch', { score: 123 });
      sdk.adapters.register(matchHarness.adapter, { mergeStrategy: AuroMatchMergeStrategy });
      await sdk.adapters.init('auromatch');

      // Guest queues mutation
      await sdk.sync.queueLocalChange('auromatch');

      // First upgrade
      const up1 = await sdk.auth.upgradeGuestToAccount({ email: 'upgrade@example.com', userId: 'user_up' });
      assert.ok(up1.ok);
      assert.equal(sdk.sync.getPendingOutboxCount(), 1);

      // Second upgrade while already authenticated fails gracefully without duplicating
      const up2 = await sdk.auth.upgradeGuestToAccount({ email: 'upgrade2@example.com', userId: 'user_up2' });
      assert.equal(up2.ok, false);
      assert.equal(up2.errorCode, 'ALREADY_AUTHENTICATED');

      // Mutations in IDB must still be exactly 1
      const idbStore = idb._peekStore('AuroMindPlatformDB', 'platform_sync_outbox');
      const muts = Object.values(idbStore).filter((m) => m && m.gameId === 'auromatch');
      assert.equal(muts.length, 1);
      assert.equal(muts[0].userId, 'user_up');

      sdk.dispose();
    });

    test('07A1-7: Failed auth preserves source guest mutation in guest state', async () => {
      const { env, storage, idb } = createSdkEnv();
      const auth = createMockAuthProvider(null);
      // Mock failure on next signIn
      auth.signIn = async () => ({ ok: false, errorCode: 'INVALID_CREDENTIALS', message: 'Wrong password' });
      const cloud = createMockCloudSyncStore();

      const sdk = createAuroMindSDK({ env });
      await sdk.init({
        gameId: 'portal',
        capabilities: { authEnabled: true, cloudSyncEnabled: true },
        providers: { auth, cloudSync: cloud.provider }
      });

      const matchHarness = createInMemoryGameAdapter('auromatch', { score: 456 });
      sdk.adapters.register(matchHarness.adapter, { mergeStrategy: AuroMatchMergeStrategy });
      await sdk.adapters.init('auromatch');

      // Guest queues mutation
      await sdk.sync.queueLocalChange('auromatch');

      // Attempt signIn that fails
      const failRes = await sdk.auth.signIn('email', { email: 'bad@example.com' }, { migrateFromGuest: true });
      assert.equal(failRes.ok, false);

      // Guest mutation must remain intact with userId: null
      assert.equal(sdk.sync.getPendingOutboxCount(), 1);
      const idbStore = idb._peekStore('AuroMindPlatformDB', 'platform_sync_outbox');
      const muts = Object.values(idbStore).filter((m) => m && m.gameId === 'auromatch');
      assert.equal(muts.length, 1);
      assert.equal(muts[0].userId, null);

      sdk.dispose();
    });

    test('07A1-8: authInFlight buffers external provider events and applies them on settlement without state loss', async () => {
      const { env, storage, idb } = createSdkEnv();
      let authCallback = null;
      const auth = {
        providerName: 'mock-auth',
        isConfigured: () => true,
        getAccount: async () => null,
        onAuthStateChange: (cb) => {
          authCallback = cb;
          return () => { authCallback = null; };
        },
        signIn: async () => {
          // While signIn is in-flight, simulate an external sign-out or session replacement event
          if (authCallback) {
            authCallback({ userId: 'user_external_refresh', email: 'external@example.com' });
          }
          return { ok: true, account: { userId: 'user_orig', email: 'orig@example.com' } };
        }
      };

      const sdk = createAuroMindSDK({ env });
      await sdk.init({
        gameId: 'portal',
        capabilities: { authEnabled: true, cloudSyncEnabled: true },
        providers: { auth }
      });

      // Trigger signIn which triggers internal callback during flight
      const res = await sdk.auth.signIn('email', { email: 'orig@example.com' });
      assert.equal(res.ok, true);

      // Once settled, the queued external event must have been applied rather than silently lost
      const currentAcc = sdk.auth.getAccount();
      assert.ok(currentAcc);
      assert.equal(currentAcc.userId, 'user_external_refresh');

      sdk.dispose();
    });

  });

});
