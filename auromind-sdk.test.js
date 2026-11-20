import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createAuroMindSDK,
  AuroMindSDKError,
  SDK_VERSION,
  IDENTITY_SCHEMA_VERSION,
  IDB_DB_NAME,
  IDB_STORE_NAME,
  IDB_GUEST_KEY,
  LS_GUEST_KEY,
  generateUuidV4,
  validateGuestRecord,
  reconcileGuestRecords
} from './assets/sdk/auromind-sdk.js';

import {
  ADAPTER_CONTRACT_VERSION,
  AuroMindAdapterError,
  PLATFORM_LS_ROOT,
  checkAdapterCompatibility,
  defineGameAdapter,
  resolveGameMerge,
  validateSaveEnvelope
} from './assets/sdk/auromind-adapters.js';

// ============================================================================
// Deterministic, Isolated In-Memory Browser Storage & Concurrency Mocks
// (Zero network access, zero real player data)
// ============================================================================

class MockLocalStorage {
  constructor({ failGet = false, failSet = false, failRemove = false, onSet = null } = {}) {
    this.map = new Map();
    this.failGet = failGet;
    this.failSet = failSet;
    this.failRemove = failRemove;
    this.onSet = onSet;
  }

  getItem(key) {
    if (this.failGet) throw new Error('SecurityError: localStorage.getItem denied');
    return this.map.has(key) ? this.map.get(key) : null;
  }

  setItem(key, value) {
    if (this.failSet) throw new Error('QuotaExceededError: localStorage.setItem failed');
    const oldValue = this.map.has(key) ? this.map.get(key) : null;
    const strVal = String(value);
    this.map.set(key, strVal);
    if (typeof this.onSet === 'function') {
      this.onSet({ key, oldValue, newValue: strVal });
    }
  }

  removeItem(key) {
    if (this.failRemove) throw new Error('SecurityError: localStorage.removeItem denied');
    this.map.delete(key);
  }

  clear() {
    this.map.clear();
  }
}

class MockIndexedDB {
  constructor({
    delayMs = 0,
    failOpen = false,
    blockOpen = false,
    hangOpen = false,
    failGet = false,
    failPut = false,
    onAfterGet = null,
    onBeforePut = null
  } = {}) {
    this.databases = new Map(); // dbName -> Map(storeName -> Map(key -> structuredClone(val)))
    this.dbVersions = new Map(); // dbName -> integer version
    this.delayMs = delayMs;
    this.failOpen = failOpen;
    this.blockOpen = blockOpen;
    this.hangOpen = hangOpen;
    this.failGet = failGet;
    this.failPut = failPut;
    this.onAfterGet = onAfterGet;
    this.onBeforePut = onBeforePut;
  }

  _schedule(fn) {
    if (this.delayMs > 0) {
      setTimeout(fn, this.delayMs);
    } else {
      queueMicrotask(fn);
    }
  }

  setDatabaseVersion(dbName, version) {
    if (!this.databases.has(dbName)) this.databases.set(dbName, new Map());
    this.dbVersions.set(dbName, version);
  }

  seed(dbName, storeName, key, value, version = 1) {
    if (!this.databases.has(dbName)) this.databases.set(dbName, new Map());
    if (!this.dbVersions.has(dbName)) this.dbVersions.set(dbName, version);
    const dbMap = this.databases.get(dbName);
    if (!dbMap.has(storeName)) dbMap.set(storeName, new Map());
    dbMap.get(storeName).set(key, structuredClone(value));
  }

  readRaw(dbName, storeName, key) {
    const val = this.databases.get(dbName)?.get(storeName)?.get(key);
    return val === undefined ? null : structuredClone(val);
  }

  deleteRaw(dbName, storeName, key) {
    this.databases.get(dbName)?.get(storeName)?.delete(key);
  }

  deleteDatabase(dbName) {
    this.databases.delete(dbName);
    this.dbVersions.delete(dbName);
  }

  open(dbName, requestedVersion = 1) {
    const req = {
      result: null,
      error: null,
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
      onblocked: null
    };

    if (this.hangOpen) {
      return req; // Never settles — tests timeout guard
    }

    this._schedule(() => {
      if (this.blockOpen) {
        if (typeof req.onblocked === 'function') req.onblocked({ target: req });
        return;
      }
      if (this.failOpen) {
        req.error = new Error('MockIDB: open failed');
        if (typeof req.onerror === 'function') req.onerror({ target: req });
        return;
      }

      const existingVersion = this.dbVersions.get(dbName);
      if (existingVersion !== undefined && requestedVersion < existingVersion) {
        const versionErr = new Error(
          `The requested version (${requestedVersion}) is less than the existing version (${existingVersion}).`
        );
        versionErr.name = 'VersionError';
        req.error = versionErr;
        if (typeof req.onerror === 'function') req.onerror({ target: req });
        return;
      }

      const isNew = !this.databases.has(dbName);
      const needsUpgrade = isNew || (existingVersion !== undefined && requestedVersion > existingVersion);
      if (isNew) {
        this.databases.set(dbName, new Map());
      }
      this.dbVersions.set(dbName, Math.max(existingVersion ?? 0, requestedVersion));
      const dbStores = this.databases.get(dbName);
      const self = this;

      const dbHandle = {
        objectStoreNames: {
          contains: (name) => dbStores.has(name)
        },
        createObjectStore: (name) => {
          if (!dbStores.has(name)) dbStores.set(name, new Map());
          return {};
        },
        close: () => {},
        transaction: (storeName) => {
          const tx = {
            error: null,
            oncomplete: null,
            onerror: null,
            onabort: null,
            objectStore: (name) => {
              if (!dbStores.has(name)) {
                throw new Error(`NotFoundError: Object store "${name}" does not exist`);
              }
              const storeMap = dbStores.get(name);
              return {
                get: (key) => {
                  const gReq = { result: undefined, error: null, onsuccess: null, onerror: null };
                  self._schedule(() => {
                    if (self.failGet) {
                      gReq.error = new Error('MockIDB: get failed');
                      if (typeof gReq.onerror === 'function') gReq.onerror({ target: gReq });
                      return;
                    }
                    const val = storeMap.get(key);
                    gReq.result = val === undefined ? undefined : structuredClone(val);
                    if (typeof self.onAfterGet === 'function') {
                      self.onAfterGet({ dbName, storeName: name, key, value: gReq.result });
                    }
                    if (typeof gReq.onsuccess === 'function') gReq.onsuccess({ target: gReq });
                  });
                  return gReq;
                },
                put: (value, key) => {
                  const pReq = { result: key, error: null, onsuccess: null, onerror: null };
                  self._schedule(() => {
                    if (typeof self.onBeforePut === 'function') {
                      self.onBeforePut({ dbName, storeName: name, key, value: structuredClone(value) });
                    }
                    if (self.failPut) {
                      pReq.error = new Error('MockIDB: put failed');
                      tx.error = pReq.error;
                      if (typeof pReq.onerror === 'function') pReq.onerror({ target: pReq });
                      if (typeof tx.onerror === 'function') tx.onerror({ target: tx });
                      return;
                    }
                    storeMap.set(key, structuredClone(value));
                    if (typeof pReq.onsuccess === 'function') pReq.onsuccess({ target: pReq });
                    if (typeof tx.oncomplete === 'function') tx.oncomplete({ target: tx });
                  });
                  return pReq;
                },
                delete: (key) => {
                  const dReq = { result: undefined, error: null, onsuccess: null, onerror: null };
                  self._schedule(() => {
                    storeMap.delete(key);
                    if (typeof dReq.onsuccess === 'function') dReq.onsuccess({ target: dReq });
                    if (typeof tx.oncomplete === 'function') tx.oncomplete({ target: tx });
                  });
                  return dReq;
                }
              };
            }
          };
          return tx;
        }
      };

      req.result = dbHandle;
      if (needsUpgrade && typeof req.onupgradeneeded === 'function') {
        req.onupgradeneeded({ target: req });
      }
      if (typeof req.onsuccess === 'function') {
        req.onsuccess({ target: req });
      }
    });

    return req;
  }
}

class MockWebLocks {
  constructor() {
    this.queues = new Map();
    this.acquireCount = 0;
  }

  request(name, optionsOrCallback, maybeCallback) {
    const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
    const prev = this.queues.get(name) || Promise.resolve();
    let release;
    const nextGate = new Promise((resolve) => {
      release = resolve;
    });
    this.queues.set(name, prev.then(() => nextGate));

    return prev.then(async () => {
      this.acquireCount += 1;
      try {
        return await callback({ name, mode: 'exclusive' });
      } finally {
        release();
      }
    });
  }
}

class MockBroadcastHub {
  constructor() {
    this.channels = new Map();
  }

  createCtor() {
    const hub = this;
    return class MockBroadcastChannel {
      constructor(name) {
        this.name = name;
        this.onmessage = null;
        this.closed = false;
        if (!hub.channels.has(name)) hub.channels.set(name, new Set());
        hub.channels.get(name).add(this);
      }

      postMessage(data) {
        if (this.closed) return;
        const peers = hub.channels.get(this.name);
        if (!peers) return;
        for (const peer of peers) {
          if (peer === this || peer.closed) continue;
          const cloned = structuredClone(data);
          queueMicrotask(() => {
            if (!peer.closed && typeof peer.onmessage === 'function') {
              peer.onmessage({ data: cloned });
            }
          });
        }
      }

      close() {
        this.closed = true;
        hub.channels.get(this.name)?.delete(this);
      }
    };
  }
}

class MockWindow {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }

  removeEventListener(type, fn) {
    this.listeners.get(type)?.delete(fn);
  }

  listenerCount(type) {
    return this.listeners.get(type)?.size ?? 0;
  }

  dispatch(type, event) {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const fn of [...set]) fn(event);
  }
}

function makeClock(isoString) {
  let ms = Date.parse(isoString);
  return {
    now: () => new Date(ms),
    advance(deltaMs) {
      ms += deltaMs;
    }
  };
}

function createSyntheticAdapter(gameId = 'sample-game', overrides = {}) {
  let localState = overrides.initialState ?? { progress: 1 };
  return {
    gameId,
    adapterVersion: '1.0.0',
    contractVersion: ADAPTER_CONTRACT_VERSION,
    minSdkVersion: '1.0.0',
    integrationMode: 'native',
    storage: {
      kind: 'idb+ls',
      ownedDatabases: [`${gameId}_db`],
      ownedLocalStorageKeys: [`${gameId}_save_v1`],
      localOnlyVaults: overrides.localOnlyVaults ?? []
    },
    capabilities: {
      offlinePlay: true,
      localPersistence: true,
      cloudSyncEligible: false,
      ...(overrides.capabilities || {})
    },
    async init(ctx) {
      if (typeof overrides.onInit === 'function') {
        await overrides.onInit(ctx);
      }
    },
    async hasLocalProgress() {
      return localState !== null;
    },
    async exportEnvelope(guestId) {
      return {
        envelopeVersion: 1,
        gameId,
        gameSchemaVersion: 1,
        guestId,
        baseRevision: 0,
        clientUpdatedAt: '2026-11-19T10:00:00.000Z',
        isEmpty: localState === null,
        checksum: JSON.stringify(localState),
        payload: localState
      };
    },
    async applyEnvelope(envelope) {
      localState = envelope.payload;
      return { applied: true };
    },
    ...overrides.extra
  };
}

const UUID_GUEST_RE =
  /^guest_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// ============================================================================
// PART 1: 17 Mandatory Identity & Concurrency Tests
// ============================================================================

test('1. First-time guest identity creation persists versioned UUID record to IDB and localStorage', async () => {
  const idb = new MockIndexedDB();
  const ls = new MockLocalStorage();
  const locks = new MockWebLocks();
  const bcHub = new MockBroadcastHub();
  const clock = makeClock('2026-11-19T08:00:00.000Z');

  const sdk = createAuroMindSDK({
    env: {
      indexedDB: idb,
      localStorage: ls,
      locks,
      BroadcastChannel: bcHub.createCtor(),
      window: new MockWindow(),
      now: clock.now,
      origin: 'https://auromind.test'
    }
  });

  try {
    assert.equal(sdk.isInitialized(), false);
    assert.equal(sdk.identity.get(), null);
    assert.equal(sdk.identity.getGuestId(), null);

    const ctx = await sdk.init({ gameId: 'portal', appVersion: '1.0.0' });
    assert.equal(sdk.isInitialized(), true);
    assert.equal(ctx.sdkVersion, SDK_VERSION);

    const identity = sdk.identity.get();
    assert.equal(identity.mode, 'guest');
    assert.equal(identity.account, null);
    assert.equal(identity.guest.schemaVersion, IDENTITY_SCHEMA_VERSION);
    assert.match(identity.guest.guestId, UUID_GUEST_RE);
    assert.equal(identity.guest.createdAt, '2026-11-19T08:00:00.000Z');
    assert.equal(identity.guest.storageSource, 'idb+ls');
    assert.equal(identity.guest.ephemeral, false);
    assert.equal(sdk.identity.getGuestId(), identity.guest.guestId);

    const idbRecord = idb.readRaw(IDB_DB_NAME, IDB_STORE_NAME, IDB_GUEST_KEY);
    const lsRecord = JSON.parse(ls.getItem(LS_GUEST_KEY));
    assert.equal(idbRecord.guestId, identity.guest.guestId);
    assert.equal(lsRecord.guestId, identity.guest.guestId);
    assert.equal(idbRecord.schemaVersion, 1);
    assert.equal(lsRecord.schemaVersion, 1);
    assert.equal(locks.acquireCount, 1);
  } finally {
    sdk.dispose();
  }
});

test('2. Returning guest identity retrieval preserves guestId and createdAt while updating lastSeenAt', async () => {
  const idb = new MockIndexedDB();
  const ls = new MockLocalStorage();
  const existing = {
    schemaVersion: 1,
    guestId: 'guest_11111111-1111-4111-8111-111111111111',
    createdAt: '2026-10-01T12:00:00.000Z',
    lastSeenAt: '2026-10-01T12:00:00.000Z',
    origin: 'https://auromind.test'
  };
  idb.seed(IDB_DB_NAME, IDB_STORE_NAME, IDB_GUEST_KEY, existing);
  ls.setItem(LS_GUEST_KEY, JSON.stringify(existing));

  const clock = makeClock('2026-11-19T09:30:00.000Z');
  const sdk = createAuroMindSDK({
    env: { indexedDB: idb, localStorage: ls, locks: new MockWebLocks(), BroadcastChannel: null, window: null, now: clock.now }
  });

  try {
    await sdk.init();
    const snap = sdk.identity.get();
    assert.equal(snap.guest.guestId, existing.guestId);
    assert.equal(snap.guest.createdAt, '2026-10-01T12:00:00.000Z');
    assert.equal(snap.guest.lastSeenAt, '2026-11-19T09:30:00.000Z');
    assert.equal(snap.guest.storageSource, 'idb+ls');
  } finally {
    sdk.dispose();
  }
});

test('3. Stable identity persists identically across simulated page reloads', async () => {
  const idb = new MockIndexedDB();
  const ls = new MockLocalStorage();
  const locks = new MockWebLocks();
  const clock = makeClock('2026-11-19T08:00:00.000Z');

  const tabVisit1 = createAuroMindSDK({
    env: { indexedDB: idb, localStorage: ls, locks, BroadcastChannel: null, window: null, now: clock.now }
  });
  await tabVisit1.init();
  const firstGuestId = tabVisit1.identity.getGuestId();
  const firstCreatedAt = tabVisit1.identity.get().guest.createdAt;
  tabVisit1.dispose();

  // Simulate full browser reload one day later
  clock.advance(24 * 60 * 60 * 1000);
  const tabVisit2 = createAuroMindSDK({
    env: { indexedDB: idb, localStorage: ls, locks, BroadcastChannel: null, window: null, now: clock.now }
  });
  try {
    await tabVisit2.init();
    assert.equal(tabVisit2.identity.getGuestId(), firstGuestId);
    assert.equal(tabVisit2.identity.get().guest.createdAt, firstCreatedAt);
  } finally {
    tabVisit2.dispose();
  }
});

test('4. Multiple simultaneous init() calls share a single flight and return identical guestId', async () => {
  const idb = new MockIndexedDB({ delayMs: 10 });
  const ls = new MockLocalStorage();
  const locks = new MockWebLocks();
  const sdk = createAuroMindSDK({
    env: { indexedDB: idb, localStorage: ls, locks, BroadcastChannel: null, window: null }
  });

  try {
    const results = await Promise.all([
      sdk.init(),
      sdk.init(),
      sdk.init(),
      sdk.init(),
      sdk.init()
    ]);

    const uniqueIds = new Set(results.map((r) => r.identity.guest.guestId));
    assert.equal(uniqueIds.size, 1);
    assert.equal(locks.acquireCount, 1);

    // Subsequent repeated init() after completion is idempotent
    const again = await sdk.init();
    assert.equal(again.identity.guest.guestId, results[0].identity.guest.guestId);
    assert.equal(locks.acquireCount, 1);
  } finally {
    sdk.dispose();
  }
});

test('5. Multiple browser tabs attempting first-time init simultaneously converge via Web Locks', async () => {
  const idb = new MockIndexedDB({ delayMs: 12 });
  const ls = new MockLocalStorage();
  const locks = new MockWebLocks();
  const bcHub = new MockBroadcastHub();
  const BC = bcHub.createCtor();

  const tabA = createAuroMindSDK({
    env: { indexedDB: idb, localStorage: ls, locks, BroadcastChannel: BC, window: new MockWindow() }
  });
  const tabB = createAuroMindSDK({
    env: { indexedDB: idb, localStorage: ls, locks, BroadcastChannel: BC, window: new MockWindow() }
  });
  const tabC = createAuroMindSDK({
    env: { indexedDB: idb, localStorage: ls, locks, BroadcastChannel: BC, window: new MockWindow() }
  });

  try {
    const [resA, resB, resC] = await Promise.all([tabA.init(), tabB.init(), tabC.init()]);
    assert.equal(resA.identity.guest.guestId, resB.identity.guest.guestId);
    assert.equal(resB.identity.guest.guestId, resC.identity.guest.guestId);
    assert.equal(tabA.identity.getStorageHealth().webLocksSupported, true);
  } finally {
    tabA.dispose();
    tabB.dispose();
    tabC.dispose();
  }
});

test('6. Reconciliation of competing valid identities chooses earliest createdAt deterministically (plus tie-break)', async () => {
  const earlier = {
    schemaVersion: 1,
    guestId: 'guest_ffffffff-ffff-4fff-8fff-ffffffffffff',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: '2026-01-01T00:00:00.000Z',
    origin: null
  };
  const later = {
    schemaVersion: 1,
    guestId: 'guest_00000000-0000-4000-8000-000000000001',
    createdAt: '2026-01-02T00:00:00.000Z',
    lastSeenAt: '2026-01-02T00:00:00.000Z',
    origin: null
  };

  // Order independence: earliest createdAt wins regardless of argument order
  assert.equal(reconcileGuestRecords(earlier, later).winner.guestId, earlier.guestId);
  assert.equal(reconcileGuestRecords(later, earlier).winner.guestId, earlier.guestId);

  // Exact timestamp tie breaks deterministically by lexicographical guestId
  const tieA = { ...earlier, guestId: 'guest_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', createdAt: '2026-06-01T00:00:00.000Z' };
  const tieB = { ...earlier, guestId: 'guest_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', createdAt: '2026-06-01T00:00:00.000Z' };
  assert.equal(reconcileGuestRecords(tieA, tieB).winner.guestId, tieA.guestId);
  assert.equal(reconcileGuestRecords(tieB, tieA).winner.guestId, tieA.guestId);

  // Live simultaneous 2-tab race WITHOUT Web Locks sharing the SAME IDB & localStorage
  const sharedIdb = new MockIndexedDB({ delayMs: 12 });
  const sharedLs = new MockLocalStorage();
  const bcHub = new MockBroadcastHub();
  const BC = bcHub.createCtor();

  const tabEarly = createAuroMindSDK({
    env: {
      indexedDB: sharedIdb,
      localStorage: sharedLs,
      locks: null,
      BroadcastChannel: BC,
      window: new MockWindow(),
      now: () => new Date('2026-11-19T08:00:00.000Z')
    }
  });
  const tabLate = createAuroMindSDK({
    env: {
      indexedDB: sharedIdb,
      localStorage: sharedLs,
      locks: null,
      BroadcastChannel: BC,
      window: new MockWindow(),
      now: () => new Date('2026-11-19T08:05:00.000Z')
    }
  });

  try {
    await Promise.all([tabEarly.init(), tabLate.init()]);

    // Flush async reconciliation queue
    await new Promise((r) => setTimeout(r, 60));

    const canonicalId = tabEarly.identity.getGuestId();
    assert.match(canonicalId, UUID_GUEST_RE);
    assert.equal(tabLate.identity.getGuestId(), canonicalId);
    assert.equal(tabEarly.identity.get().guest.createdAt, '2026-11-19T08:00:00.000Z');
    assert.equal(tabLate.identity.get().guest.createdAt, '2026-11-19T08:00:00.000Z');
    // Verify BOTH shared storage layers converged onto the canonical earliest identity
    assert.equal(sharedIdb.readRaw(IDB_DB_NAME, IDB_STORE_NAME, IDB_GUEST_KEY).guestId, canonicalId);
    assert.equal(JSON.parse(sharedLs.getItem(LS_GUEST_KEY)).guestId, canonicalId);
  } finally {
    tabEarly.dispose();
    tabLate.dispose();
  }
});

test('7. IndexedDB unavailable (null, failing open, blocked, failing get, failing put, or timed out) falls back cleanly to localStorage', async () => {
  const ls = new MockLocalStorage();
  const sdkNull = createAuroMindSDK({
    env: { indexedDB: null, localStorage: ls, locks: null, BroadcastChannel: null, window: null }
  });
  let canonicalId;
  try {
    await sdkNull.init();
    canonicalId = sdkNull.identity.getGuestId();
    assert.match(canonicalId, UUID_GUEST_RE);
    assert.equal(sdkNull.identity.get().guest.storageSource, 'ls');
    assert.equal(sdkNull.identity.get().guest.ephemeral, false);
    assert.equal(sdkNull.identity.getStorageHealth().idbAvailable, false);
    assert.equal(sdkNull.identity.getStorageHealth().lsAvailable, true);
    assert.equal(JSON.parse(ls.getItem(LS_GUEST_KEY)).guestId, canonicalId);
  } finally {
    sdkNull.dispose();
  }

  // Case 7b: failOpen
  const sdkFailOpen = createAuroMindSDK({
    env: { indexedDB: new MockIndexedDB({ failOpen: true }), localStorage: ls, locks: null, BroadcastChannel: null, window: null }
  });
  try {
    await sdkFailOpen.init();
    assert.equal(sdkFailOpen.identity.getGuestId(), canonicalId);
    assert.equal(sdkFailOpen.identity.get().guest.storageSource, 'ls');
    assert.equal(sdkFailOpen.identity.getStorageHealth().idbAvailable, false);
  } finally {
    sdkFailOpen.dispose();
  }

  // Case 7c: blockOpen
  const sdkBlocked = createAuroMindSDK({
    env: { indexedDB: new MockIndexedDB({ blockOpen: true }), localStorage: ls, locks: null, BroadcastChannel: null, window: null }
  });
  try {
    await sdkBlocked.init();
    assert.equal(sdkBlocked.identity.getGuestId(), canonicalId);
    assert.equal(sdkBlocked.identity.get().guest.storageSource, 'ls');
    assert.equal(sdkBlocked.identity.getStorageHealth().idbAvailable, false);
  } finally {
    sdkBlocked.dispose();
  }

  // Case 7d: failGet (IDB read fails, put succeeds -> recovers canonicalId from LS and re-seeds IDB)
  const failGetIdb = new MockIndexedDB({ failGet: true });
  const sdkFailGet = createAuroMindSDK({
    env: { indexedDB: failGetIdb, localStorage: ls, locks: null, BroadcastChannel: null, window: null }
  });
  try {
    await sdkFailGet.init();
    assert.equal(sdkFailGet.identity.getGuestId(), canonicalId);
    assert.equal(failGetIdb.readRaw(IDB_DB_NAME, IDB_STORE_NAME, IDB_GUEST_KEY).guestId, canonicalId);
  } finally {
    sdkFailGet.dispose();
  }

  // Case 7d2: failGet + failPut -> stays cleanly on localStorage without throwing
  const sdkFailGetAndPut = createAuroMindSDK({
    env: { indexedDB: new MockIndexedDB({ failGet: true, failPut: true }), localStorage: ls, locks: null, BroadcastChannel: null, window: null }
  });
  try {
    await sdkFailGetAndPut.init();
    assert.equal(sdkFailGetAndPut.identity.getGuestId(), canonicalId);
    assert.equal(sdkFailGetAndPut.identity.get().guest.storageSource, 'ls');
    assert.equal(sdkFailGetAndPut.identity.getStorageHealth().idbAvailable, false);
  } finally {
    sdkFailGetAndPut.dispose();
  }

  // Case 7e: failPut (IDB open + get succeed, put fails — A-2: lastRepairedFrom MUST stay null!)
  const sdkFailPut = createAuroMindSDK({
    env: { indexedDB: new MockIndexedDB({ failPut: true }), localStorage: ls, locks: null, BroadcastChannel: null, window: null }
  });
  try {
    await sdkFailPut.init();
    assert.equal(sdkFailPut.identity.getGuestId(), canonicalId);
    assert.equal(sdkFailPut.identity.get().guest.storageSource, 'ls');
    assert.equal(sdkFailPut.identity.getStorageHealth().idbAvailable, false);
    assert.equal(sdkFailPut.identity.getStorageHealth().lastRepairedFrom, null);
  } finally {
    sdkFailPut.dispose();
  }

  // Case 7f: timed-out IDB open must never hang startup
  const sdkTimeout = createAuroMindSDK({
    env: {
      indexedDB: new MockIndexedDB({ hangOpen: true }),
      localStorage: ls,
      locks: null,
      BroadcastChannel: null,
      window: null,
      idbTimeoutMs: 30
    }
  });
  try {
    await sdkTimeout.init();
    assert.equal(sdkTimeout.identity.getGuestId(), canonicalId);
    assert.equal(sdkTimeout.identity.get().guest.storageSource, 'ls');
    assert.equal(sdkTimeout.identity.getStorageHealth().idbAvailable, false);
  } finally {
    sdkTimeout.dispose();
  }
});

test('8. localStorage unavailable falls back cleanly to IndexedDB; both unavailable degrades to ephemeral memory', async () => {
  const idb = new MockIndexedDB();
  const throwingLs = new MockLocalStorage({ failGet: true, failSet: true });

  const sdkIdbOnly = createAuroMindSDK({
    env: { indexedDB: idb, localStorage: throwingLs, locks: null, BroadcastChannel: null, window: null }
  });
  try {
    await sdkIdbOnly.init();
    const snap = sdkIdbOnly.identity.get();
    assert.match(snap.guest.guestId, UUID_GUEST_RE);
    assert.equal(snap.guest.storageSource, 'idb');
    assert.equal(snap.guest.ephemeral, false);
    assert.equal(sdkIdbOnly.identity.getStorageHealth().idbAvailable, true);
    assert.equal(sdkIdbOnly.identity.getStorageHealth().lsAvailable, false);
  } finally {
    sdkIdbOnly.dispose();
  }

  // Both unavailable -> ephemeral in-memory identity so gameplay never crashes
  const sdkMemory = createAuroMindSDK({
    env: { indexedDB: null, localStorage: null, locks: null, BroadcastChannel: null, window: null }
  });
  try {
    await sdkMemory.init();
    const snap = sdkMemory.identity.get();
    assert.match(snap.guest.guestId, UUID_GUEST_RE);
    assert.equal(snap.guest.storageSource, 'memory');
    assert.equal(snap.guest.ephemeral, true);
  } finally {
    sdkMemory.dispose();
  }
});

test('9. Corrupted IndexedDB record recovers valid guestId from localStorage and auto-heals IndexedDB', async () => {
  const idb = new MockIndexedDB();
  const ls = new MockLocalStorage();
  const validLs = {
    schemaVersion: 1,
    guestId: 'guest_22222222-2222-4222-8222-222222222222',
    createdAt: '2026-09-15T10:00:00.000Z',
    lastSeenAt: '2026-09-15T10:00:00.000Z',
    origin: 'https://auromind.test'
  };
  idb.seed(IDB_DB_NAME, IDB_STORE_NAME, IDB_GUEST_KEY, { schemaVersion: 1, guestId: 'corrupted-not-uuid' });
  ls.setItem(LS_GUEST_KEY, JSON.stringify(validLs));

  const sdk = createAuroMindSDK({
    env: { indexedDB: idb, localStorage: ls, locks: null, BroadcastChannel: null, window: null }
  });
  try {
    await sdk.init();
    assert.equal(sdk.identity.getGuestId(), validLs.guestId);
    assert.equal(sdk.identity.get().guest.createdAt, validLs.createdAt);
    assert.equal(sdk.identity.getStorageHealth().lastRepairedFrom, 'localStorage');
    assert.deepEqual(sdk.identity.getStorageHealth().corruptedStores, ['indexedDB']);
    // Confirm IDB was healed
    assert.equal(idb.readRaw(IDB_DB_NAME, IDB_STORE_NAME, IDB_GUEST_KEY).guestId, validLs.guestId);
  } finally {
    sdk.dispose();
  }
});

test('10. Corrupted localStorage mirror recovers valid guestId from IndexedDB and auto-heals localStorage', async () => {
  const idb = new MockIndexedDB();
  const ls = new MockLocalStorage();
  const validIdb = {
    schemaVersion: 1,
    guestId: 'guest_33333333-3333-4333-8333-333333333333',
    createdAt: '2026-08-20T07:00:00.000Z',
    lastSeenAt: '2026-08-20T07:00:00.000Z',
    origin: 'https://auromind.test'
  };
  idb.seed(IDB_DB_NAME, IDB_STORE_NAME, IDB_GUEST_KEY, validIdb);
  ls.setItem(LS_GUEST_KEY, '{not-valid-json!!!');

  const sdk = createAuroMindSDK({
    env: { indexedDB: idb, localStorage: ls, locks: null, BroadcastChannel: null, window: null }
  });
  try {
    await sdk.init();
    assert.equal(sdk.identity.getGuestId(), validIdb.guestId);
    assert.equal(sdk.identity.get().guest.createdAt, validIdb.createdAt);
    assert.equal(sdk.identity.getStorageHealth().lastRepairedFrom, 'idb');
    assert.deepEqual(sdk.identity.getStorageHealth().corruptedStores, ['localStorage']);
    // Confirm localStorage mirror was healed
    assert.equal(JSON.parse(ls.getItem(LS_GUEST_KEY)).guestId, validIdb.guestId);
  } finally {
    sdk.dispose();
  }
});

test('11. IndexedDB and localStorage disagreement reconciles deterministically to earliest createdAt in both stores', async () => {
  const idb = new MockIndexedDB();
  const ls = new MockLocalStorage();
  const olderInLs = {
    schemaVersion: 1,
    guestId: 'guest_44444444-4444-4444-8444-444444444444',
    createdAt: '2026-05-01T00:00:00.000Z',
    lastSeenAt: '2026-05-02T00:00:00.000Z',
    origin: 'https://auromind.test'
  };
  const newerInIdb = {
    schemaVersion: 1,
    guestId: 'guest_55555555-5555-4555-8555-555555555555',
    createdAt: '2026-06-01T00:00:00.000Z',
    lastSeenAt: '2026-06-02T00:00:00.000Z',
    origin: 'https://auromind.test'
  };
  idb.seed(IDB_DB_NAME, IDB_STORE_NAME, IDB_GUEST_KEY, newerInIdb);
  ls.setItem(LS_GUEST_KEY, JSON.stringify(olderInLs));

  const sdk = createAuroMindSDK({
    env: { indexedDB: idb, localStorage: ls, locks: null, BroadcastChannel: null, window: null }
  });
  try {
    await sdk.init();
    assert.equal(sdk.identity.getGuestId(), olderInLs.guestId);
    assert.equal(sdk.identity.getStorageHealth().lastReconciledFrom, 'localStorage');
    // Both stores converged onto the winning older identity
    assert.equal(idb.readRaw(IDB_DB_NAME, IDB_STORE_NAME, IDB_GUEST_KEY).guestId, olderInLs.guestId);
    assert.equal(JSON.parse(ls.getItem(LS_GUEST_KEY)).guestId, olderInLs.guestId);
  } finally {
    sdk.dispose();
  }
});

test('12. Partial deletion of either storage location auto-heals without minting a new guestId', async () => {
  const idb = new MockIndexedDB();
  const ls = new MockLocalStorage();

  // Seed initial identity
  const sdk1 = createAuroMindSDK({
    env: { indexedDB: idb, localStorage: ls, locks: null, BroadcastChannel: null, window: null }
  });
  await sdk1.init();
  const canonicalId = sdk1.identity.getGuestId();
  sdk1.dispose();

  // Case 12a: Clear localStorage completely; IDB must restore it
  ls.clear();
  const sdk2 = createAuroMindSDK({
    env: { indexedDB: idb, localStorage: ls, locks: null, BroadcastChannel: null, window: null }
  });
  try {
    await sdk2.init();
    assert.equal(sdk2.identity.getGuestId(), canonicalId);
    assert.equal(sdk2.identity.getStorageHealth().lastRepairedFrom, 'idb');
    assert.equal(JSON.parse(ls.getItem(LS_GUEST_KEY)).guestId, canonicalId);
  } finally {
    sdk2.dispose();
  }

  // Case 12b: Delete IndexedDB completely; localStorage must re-seed it
  idb.deleteDatabase(IDB_DB_NAME);
  const sdk3 = createAuroMindSDK({
    env: { indexedDB: idb, localStorage: ls, locks: null, BroadcastChannel: null, window: null }
  });
  try {
    await sdk3.init();
    assert.equal(sdk3.identity.getGuestId(), canonicalId);
    assert.equal(sdk3.identity.getStorageHealth().lastRepairedFrom, 'localStorage');
    assert.equal(idb.readRaw(IDB_DB_NAME, IDB_STORE_NAME, IDB_GUEST_KEY).guestId, canonicalId);
  } finally {
    sdk3.dispose();
  }
});

test('13. Interrupted initialization (existing identity, first-launch empty stores, and mid-write failure) resets cleanly and recovers', async () => {
  // Case 13a: Interrupted init with pre-existing localStorage record
  const idb = new MockIndexedDB();
  const ls = new MockLocalStorage();
  const preExisting = {
    schemaVersion: 1,
    guestId: 'guest_66666666-6666-4666-8666-666666666666',
    createdAt: '2026-07-01T00:00:00.000Z',
    lastSeenAt: '2026-07-01T00:00:00.000Z',
    origin: null
  };
  ls.setItem(LS_GUEST_KEY, JSON.stringify(preExisting));

  let attempts = 0;
  const sdk = createAuroMindSDK({
    env: {
      indexedDB: idb,
      localStorage: ls,
      locks: null,
      BroadcastChannel: null,
      window: null,
      beforeIdentityCommit: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('Simulated tab suspension / interrupted initialization');
        }
      }
    }
  });

  try {
    await assert.rejects(() => sdk.init(), /Simulated tab suspension/);
    assert.equal(sdk.isInitialized(), false);

    await sdk.init();
    assert.equal(sdk.isInitialized(), true);
    assert.equal(sdk.identity.getGuestId(), preExisting.guestId);
    assert.equal(idb.readRaw(IDB_DB_NAME, IDB_STORE_NAME, IDB_GUEST_KEY).guestId, preExisting.guestId);
    assert.equal(attempts, 2);
  } finally {
    sdk.dispose();
  }

  // Case 13b: First-launch interruption with completely empty stores, followed by clean retry
  const emptyIdb = new MockIndexedDB();
  const emptyLs = new MockLocalStorage();
  let firstLaunchAttempts = 0;
  const sdkFirst = createAuroMindSDK({
    env: {
      indexedDB: emptyIdb,
      localStorage: emptyLs,
      locks: null,
      BroadcastChannel: null,
      window: null,
      beforeIdentityCommit: async () => {
        firstLaunchAttempts += 1;
        if (firstLaunchAttempts === 1) {
          throw new Error('First-launch crash before persist');
        }
      }
    }
  });

  try {
    await assert.rejects(() => sdkFirst.init(), /First-launch crash/);
    assert.equal(sdkFirst.isInitialized(), false);
    assert.equal(sdkFirst.identity.getGuestId(), null);
    assert.equal(emptyIdb.readRaw(IDB_DB_NAME, IDB_STORE_NAME, IDB_GUEST_KEY), null);
    assert.equal(emptyLs.getItem(LS_GUEST_KEY), null);

    await sdkFirst.init();
    const mintedId = sdkFirst.identity.getGuestId();
    assert.equal(sdkFirst.isInitialized(), true);
    assert.match(mintedId, UUID_GUEST_RE);
    assert.equal(emptyIdb.readRaw(IDB_DB_NAME, IDB_STORE_NAME, IDB_GUEST_KEY).guestId, mintedId);
    assert.equal(JSON.parse(emptyLs.getItem(LS_GUEST_KEY)).guestId, mintedId);
  } finally {
    sdkFirst.dispose();
  }

  // Case 13c: Mid-write failure (IDB put fails while LS write succeeds), then subsequent reload heals IDB cleanly
  const midFailIdb = new MockIndexedDB({ failPut: true });
  const midLs = new MockLocalStorage();
  const sdkMid = createAuroMindSDK({
    env: { indexedDB: midFailIdb, localStorage: midLs, locks: null, BroadcastChannel: null, window: null }
  });
  let survivedId;
  try {
    await sdkMid.init();
    survivedId = sdkMid.identity.getGuestId();
    assert.equal(sdkMid.identity.get().guest.storageSource, 'ls');
    assert.equal(JSON.parse(midLs.getItem(LS_GUEST_KEY)).guestId, survivedId);
    assert.equal(midFailIdb.readRaw(IDB_DB_NAME, IDB_STORE_NAME, IDB_GUEST_KEY), null);
  } finally {
    sdkMid.dispose();
  }

  // IDB recovers on next reload and auto-heals from localStorage without minting a new ID
  midFailIdb.failPut = false;
  const sdkHealAfterMidFail = createAuroMindSDK({
    env: { indexedDB: midFailIdb, localStorage: midLs, locks: null, BroadcastChannel: null, window: null }
  });
  try {
    await sdkHealAfterMidFail.init();
    assert.equal(sdkHealAfterMidFail.identity.getGuestId(), survivedId);
    assert.equal(sdkHealAfterMidFail.identity.get().guest.storageSource, 'idb+ls');
    assert.equal(sdkHealAfterMidFail.identity.getStorageHealth().lastRepairedFrom, 'localStorage');
    assert.equal(midFailIdb.readRaw(IDB_DB_NAME, IDB_STORE_NAME, IDB_GUEST_KEY).guestId, survivedId);
  } finally {
    sdkHealAfterMidFail.dispose();
  }
});

test('14. Unsupported Web Locks degrades cleanly and still reconciles via storage event', async () => {
  const win = new MockWindow();
  const idb = new MockIndexedDB();
  const ls = new MockLocalStorage();

  const sdk = createAuroMindSDK({
    env: {
      indexedDB: idb,
      localStorage: ls,
      locks: null,
      BroadcastChannel: null,
      window: win,
      now: () => new Date('2026-11-19T12:00:00.000Z')
    }
  });

  try {
    await sdk.init();
    assert.equal(sdk.identity.getStorageHealth().webLocksSupported, false);

    // Simulate another tab writing an earlier identity to localStorage
    const earlierPeer = {
      schemaVersion: 1,
      guestId: 'guest_77777777-7777-4777-8777-777777777777',
      createdAt: '2026-11-19T11:00:00.000Z',
      lastSeenAt: '2026-11-19T11:00:00.000Z',
      origin: null
    };
    ls.setItem(LS_GUEST_KEY, JSON.stringify(earlierPeer));
    win.dispatch('storage', { key: LS_GUEST_KEY, newValue: JSON.stringify(earlierPeer) });

    await new Promise((r) => setTimeout(r, 30));
    assert.equal(sdk.identity.getGuestId(), earlierPeer.guestId);
    assert.equal(idb.readRaw(IDB_DB_NAME, IDB_STORE_NAME, IDB_GUEST_KEY).guestId, earlierPeer.guestId);
    assert.equal(JSON.parse(ls.getItem(LS_GUEST_KEY)).guestId, earlierPeer.guestId);
  } finally {
    sdk.dispose();
  }
});

test('15. Unsupported BroadcastChannel degrades cleanly and two tabs reconcile via Web Locks or storage event', async () => {
  // Case 15a: Two tabs with BroadcastChannel undefined + shared Web Locks
  const sharedIdb = new MockIndexedDB({ delayMs: 8 });
  const sharedLs = new MockLocalStorage();
  const locks = new MockWebLocks();
  const tab1 = createAuroMindSDK({
    env: { indexedDB: sharedIdb, localStorage: sharedLs, locks, BroadcastChannel: undefined, window: new MockWindow() }
  });
  const tab2 = createAuroMindSDK({
    env: { indexedDB: sharedIdb, localStorage: sharedLs, locks, BroadcastChannel: undefined, window: new MockWindow() }
  });

  try {
    await Promise.all([tab1.init(), tab2.init()]);
    assert.equal(tab1.isInitialized(), true);
    assert.equal(tab2.isInitialized(), true);
    assert.equal(tab1.identity.getStorageHealth().broadcastChannelSupported, false);
    assert.equal(tab1.identity.getStorageHealth().webLocksSupported, true);
    assert.equal(tab1.identity.getGuestId(), tab2.identity.getGuestId());
    assert.equal(sharedIdb.readRaw(IDB_DB_NAME, IDB_STORE_NAME, IDB_GUEST_KEY).guestId, tab1.identity.getGuestId());
    assert.equal(JSON.parse(sharedLs.getItem(LS_GUEST_KEY)).guestId, tab1.identity.getGuestId());
  } finally {
    tab1.dispose();
    tab2.dispose();
  }

  // Case 15b: Two tabs with BOTH BroadcastChannel undefined AND Web Locks null reconciling via storage event
  const winA = new MockWindow();
  const winB = new MockWindow();
  const idbNoBc = new MockIndexedDB({ delayMs: 5 });
  const lsNoBc = new MockLocalStorage({
    onSet: (ev) => {
      // Simulate cross-tab storage event delivery to peer windows
      winA.dispatch('storage', ev);
      winB.dispatch('storage', ev);
    }
  });
  const tabA = createAuroMindSDK({
    env: {
      indexedDB: idbNoBc,
      localStorage: lsNoBc,
      locks: null,
      BroadcastChannel: undefined,
      window: winA,
      now: () => new Date('2026-11-19T06:00:00.000Z')
    }
  });
  const tabB = createAuroMindSDK({
    env: {
      indexedDB: idbNoBc,
      localStorage: lsNoBc,
      locks: null,
      BroadcastChannel: undefined,
      window: winB,
      now: () => new Date('2026-11-19T06:10:00.000Z')
    }
  });

  try {
    await Promise.all([tabA.init(), tabB.init()]);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(tabA.identity.getGuestId(), tabB.identity.getGuestId());
    assert.equal(idbNoBc.readRaw(IDB_DB_NAME, IDB_STORE_NAME, IDB_GUEST_KEY).guestId, tabA.identity.getGuestId());
    assert.equal(JSON.parse(lsNoBc.getItem(LS_GUEST_KEY)).guestId, tabA.identity.getGuestId());
  } finally {
    tabA.dispose();
    tabB.dispose();
  }
});

test('16. Invalid, future-version (IDB, localStorage, mixed), and DB-level VersionError records are handled safely', async () => {
  // Pure validator checks
  assert.equal(validateGuestRecord({ schemaVersion: 0, guestId: 'guest_11111111-1111-4111-8111-111111111111' }).reason, 'INVALID_VERSION');
  assert.equal(validateGuestRecord({ schemaVersion: '1', guestId: 'guest_11111111-1111-4111-8111-111111111111' }).reason, 'INVALID_VERSION');
  assert.equal(validateGuestRecord({ schemaVersion: 2, guestId: 'guest_11111111-1111-4111-8111-111111111111' }).reason, 'UNSUPPORTED_VERSION');

  const futureRecord = {
    schemaVersion: 2,
    guestId: 'guest_88888888-8888-4888-8888-888888888888',
    createdAt: '2027-01-01T00:00:00.000Z',
    lastSeenAt: '2027-01-01T00:00:00.000Z',
    futureField: 'preserve-me'
  };

  // Case 16a: Future schemaVersion 2 in IDB with NO valid v1 fallback throws & does NOT overwrite
  const idbFuture = new MockIndexedDB();
  const lsFuture = new MockLocalStorage();
  idbFuture.seed(IDB_DB_NAME, IDB_STORE_NAME, IDB_GUEST_KEY, futureRecord);

  const sdkFuture = createAuroMindSDK({
    env: { indexedDB: idbFuture, localStorage: lsFuture, locks: null, BroadcastChannel: null, window: null }
  });
  try {
    await assert.rejects(
      () => sdkFuture.init(),
      (err) => err instanceof AuroMindSDKError && err.code === 'UNSUPPORTED_IDENTITY_VERSION'
    );
    assert.deepEqual(idbFuture.readRaw(IDB_DB_NAME, IDB_STORE_NAME, IDB_GUEST_KEY), futureRecord);
    assert.equal(lsFuture.getItem(LS_GUEST_KEY), null);
  } finally {
    sdkFuture.dispose();
  }

  // Case 16b: Future schemaVersion 2 in localStorage ONLY throws & does NOT overwrite
  const idbEmpty = new MockIndexedDB();
  const lsFutureOnly = new MockLocalStorage();
  lsFutureOnly.setItem(LS_GUEST_KEY, JSON.stringify(futureRecord));
  const sdkLsFuture = createAuroMindSDK({
    env: { indexedDB: idbEmpty, localStorage: lsFutureOnly, locks: null, BroadcastChannel: null, window: null }
  });
  try {
    await assert.rejects(
      () => sdkLsFuture.init(),
      (err) =>
        err instanceof AuroMindSDKError &&
        err.code === 'UNSUPPORTED_IDENTITY_VERSION' &&
        err.details.stores.includes('localStorage')
    );
    assert.deepEqual(JSON.parse(lsFutureOnly.getItem(LS_GUEST_KEY)), futureRecord);
    assert.equal(idbEmpty.readRaw(IDB_DB_NAME, IDB_STORE_NAME, IDB_GUEST_KEY), null);
  } finally {
    sdkLsFuture.dispose();
  }

  // Case 16c: Mixed future schemaVersion 2 in IDB + valid v1 in localStorage preserves IDB v2 and runs on v1 LS
  const idbMixed = new MockIndexedDB();
  const lsMixed = new MockLocalStorage();
  const validV1 = {
    schemaVersion: 1,
    guestId: 'guest_99999999-9999-4999-8999-999999999999',
    createdAt: '2026-04-01T00:00:00.000Z',
    lastSeenAt: '2026-04-01T00:00:00.000Z',
    origin: null
  };
  idbMixed.seed(IDB_DB_NAME, IDB_STORE_NAME, IDB_GUEST_KEY, futureRecord);
  lsMixed.setItem(LS_GUEST_KEY, JSON.stringify(validV1));

  const sdkMixed = createAuroMindSDK({
    env: { indexedDB: idbMixed, localStorage: lsMixed, locks: null, BroadcastChannel: null, window: null }
  });
  try {
    await sdkMixed.init();
    assert.equal(sdkMixed.identity.getGuestId(), validV1.guestId);
    assert.equal(sdkMixed.identity.get().guest.storageSource, 'ls');
    assert.equal(sdkMixed.identity.getStorageHealth().lastRepairedFrom, null);
    // Future v2 IDB record MUST remain intact
    assert.deepEqual(idbMixed.readRaw(IDB_DB_NAME, IDB_STORE_NAME, IDB_GUEST_KEY), futureRecord);
  } finally {
    sdkMixed.dispose();
  }

  // Case 16d: Invalid/corrupted version (schemaVersion: 0) in LS while valid v1 exists in IDB heals cleanly
  const idbValid = new MockIndexedDB();
  const lsInvalidVer = new MockLocalStorage();
  idbValid.seed(IDB_DB_NAME, IDB_STORE_NAME, IDB_GUEST_KEY, validV1);
  lsInvalidVer.setItem(LS_GUEST_KEY, JSON.stringify({ ...validV1, schemaVersion: 0 }));

  const sdkHeal = createAuroMindSDK({
    env: { indexedDB: idbValid, localStorage: lsInvalidVer, locks: null, BroadcastChannel: null, window: null }
  });
  try {
    await sdkHeal.init();
    assert.equal(sdkHeal.identity.getGuestId(), validV1.guestId);
    assert.equal(JSON.parse(lsInvalidVer.getItem(LS_GUEST_KEY)).schemaVersion, 1);
    assert.equal(sdkHeal.identity.getStorageHealth().lastRepairedFrom, 'idb');
  } finally {
    sdkHeal.dispose();
  }

  // Case 16e (A-1): IndexedDB database-level VersionError (existing DB v2, SDK v1)
  // MUST throw UNSUPPORTED_IDENTITY_VERSION and NEVER fall back to LS or mint a new ID
  const idbV2 = new MockIndexedDB();
  idbV2.setDatabaseVersion(IDB_DB_NAME, 2);
  const lsEmptyForV2 = new MockLocalStorage();

  const sdkDbVerErrEmpty = createAuroMindSDK({
    env: { indexedDB: idbV2, localStorage: lsEmptyForV2, locks: null, BroadcastChannel: null, window: null }
  });
  try {
    await assert.rejects(
      () => sdkDbVerErrEmpty.init(),
      (err) =>
        err instanceof AuroMindSDKError &&
        err.code === 'UNSUPPORTED_IDENTITY_VERSION' &&
        err.details.reason === 'IDB_DATABASE_VERSION_TOO_HIGH'
    );
    assert.equal(sdkDbVerErrEmpty.isInitialized(), false);
    assert.equal(sdkDbVerErrEmpty.identity.getGuestId(), null);
    assert.equal(lsEmptyForV2.getItem(LS_GUEST_KEY), null);
  } finally {
    sdkDbVerErrEmpty.dispose();
  }

  // Even when LS has a v1 mirror, a database-level VersionError must NOT silently treat IDB v2 as ordinary unavailability
  const lsWithMirror = new MockLocalStorage();
  lsWithMirror.setItem(LS_GUEST_KEY, JSON.stringify(validV1));
  const sdkDbVerErrWithLs = createAuroMindSDK({
    env: { indexedDB: idbV2, localStorage: lsWithMirror, locks: null, BroadcastChannel: null, window: null }
  });
  try {
    await assert.rejects(
      () => sdkDbVerErrWithLs.init(),
      (err) =>
        err instanceof AuroMindSDKError &&
        err.code === 'UNSUPPORTED_IDENTITY_VERSION' &&
        err.details.reason === 'IDB_DATABASE_VERSION_TOO_HIGH'
    );
    assert.equal(sdkDbVerErrWithLs.isInitialized(), false);
    assert.deepEqual(JSON.parse(lsWithMirror.getItem(LS_GUEST_KEY)), validV1);
  } finally {
    sdkDbVerErrWithLs.dispose();
  }
});

test('17. No accidental overwrite of a valid existing identity by newer peers, repeated calls, or real mid-flight storage mutations', async () => {
  const idb = new MockIndexedDB();
  const ls = new MockLocalStorage();
  const bcHub = new MockBroadcastHub();
  const BC = bcHub.createCtor();

  const existingValid = {
    schemaVersion: 1,
    guestId: 'guest_12345678-1234-4123-8123-123456789abc',
    createdAt: '2026-01-10T00:00:00.000Z',
    lastSeenAt: '2026-01-10T00:00:00.000Z',
    origin: 'https://auromind.test'
  };
  idb.seed(IDB_DB_NAME, IDB_STORE_NAME, IDB_GUEST_KEY, existingValid);
  ls.setItem(LS_GUEST_KEY, JSON.stringify(existingValid));

  const sdk = createAuroMindSDK({
    env: { indexedDB: idb, localStorage: ls, locks: new MockWebLocks(), BroadcastChannel: BC, window: null }
  });
  const roguePeer = new BC('auromind_platform_bus');

  try {
    await sdk.init();
    await sdk.init();
    await sdk.identity.ensureGuestIdentity();

    roguePeer.postMessage({
      type: 'GUEST_IDENTITY_READY',
      senderId: 'tab_newer',
      record: {
        schemaVersion: 1,
        guestId: 'guest_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        createdAt: '2026-11-19T23:59:59.000Z',
        lastSeenAt: '2026-11-19T23:59:59.000Z',
        origin: 'https://auromind.test'
      }
    });

    await new Promise((r) => setTimeout(r, 30));
    assert.equal(sdk.identity.getGuestId(), existingValid.guestId);
    assert.equal(sdk.identity.get().guest.createdAt, existingValid.createdAt);
    assert.equal(idb.readRaw(IDB_DB_NAME, IDB_STORE_NAME, IDB_GUEST_KEY).guestId, existingValid.guestId);
    assert.equal(JSON.parse(ls.getItem(LS_GUEST_KEY)).guestId, existingValid.guestId);
  } finally {
    roguePeer.close();
    sdk.dispose();
  }

  // Case 17b: Real mid-flight storage mutation injected AFTER initial IDB get and BEFORE put commit
  const midFlightEarlier = {
    schemaVersion: 1,
    guestId: 'guest_00000000-0000-4000-8000-000000000099',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: '2026-01-01T00:00:00.000Z',
    origin: 'https://auromind.test'
  };
  const midLs = new MockLocalStorage();
  let injected = false;
  const midIdb = new MockIndexedDB({
    onBeforePut: ({ key }) => {
      if (!injected && key === IDB_GUEST_KEY) {
        injected = true;
        // Another tab without Web Locks writes an earlier record to localStorage right as we are putting to IDB
        midLs.setItem(LS_GUEST_KEY, JSON.stringify(midFlightEarlier));
      }
    }
  });

  const sdkMidFlight = createAuroMindSDK({
    env: {
      indexedDB: midIdb,
      localStorage: midLs,
      locks: null,
      BroadcastChannel: null,
      window: null,
      now: () => new Date('2026-11-19T15:00:00.000Z')
    }
  });
  try {
    await sdkMidFlight.init();
    assert.equal(injected, true);
    // Post-write convergence verification must have detected the mid-flight earlier record and converged both stores
    assert.equal(sdkMidFlight.identity.getGuestId(), midFlightEarlier.guestId);
    assert.equal(midIdb.readRaw(IDB_DB_NAME, IDB_STORE_NAME, IDB_GUEST_KEY).guestId, midFlightEarlier.guestId);
    assert.equal(JSON.parse(midLs.getItem(LS_GUEST_KEY)).guestId, midFlightEarlier.guestId);
  } finally {
    sdkMidFlight.dispose();
  }
});

// ============================================================================
// PART 2: Game Adapter Contracts, Boundary Enforcement & Zero-Network Tests
// ============================================================================

test('18. Adapter registration, retrieval, listing, duplicate guard, replacement, and non-exposure of raw adapter instances (C-1)', async () => {
  const sdk = createAuroMindSDK({
    env: { indexedDB: new MockIndexedDB(), localStorage: new MockLocalStorage(), locks: null, BroadcastChannel: null, window: null }
  });

  try {
    const adapter = defineGameAdapter(createSyntheticAdapter('demo-game'));
    const rec = sdk.adapters.register(adapter);
    assert.equal(rec.gameId, 'demo-game');
    assert.equal(rec.initialized, false);
    assert.equal('adapter' in rec, false);
    assert.equal(rec.adapter, undefined);
    assert.equal(sdk.adapters.has('demo-game'), true);

    const fetched = sdk.adapters.get('demo-game');
    assert.equal(fetched.gameId, 'demo-game');
    assert.equal('adapter' in fetched, false);
    assert.equal(fetched.adapter, undefined);

    const listed = sdk.adapters.list();
    assert.equal(listed.length, 1);
    assert.equal('adapter' in listed[0], false);
    assert.equal(listed[0].adapter, undefined);

    // Duplicate registration rejected unless { replace: true }
    assert.throws(
      () => sdk.adapters.register(adapter),
      (err) => err instanceof AuroMindAdapterError && err.code === 'DUPLICATE_ADAPTER'
    );

    const replaced = sdk.adapters.register(
      createSyntheticAdapter('demo-game', { extra: { adapterVersion: '1.1.0' } }),
      { replace: true }
    );
    assert.equal(replaced.adapterVersion, '1.1.0');
    assert.equal('adapter' in replaced, false);

    assert.equal(await sdk.adapters.unregister('demo-game'), true);
    assert.equal(sdk.adapters.get('demo-game'), null);
  } finally {
    sdk.dispose();
  }
});

test('19. Adapter initialization requires SDK init first and supplies scoped read-only identity context', async () => {
  const sdk = createAuroMindSDK({
    env: { indexedDB: new MockIndexedDB(), localStorage: new MockLocalStorage(), locks: null, BroadcastChannel: null, window: null }
  });

  let receivedContext = null;
  let initCalls = 0;

  try {
    sdk.adapters.register(
      createSyntheticAdapter('scoped-game', {
        onInit: (ctx) => {
          initCalls += 1;
          receivedContext = ctx;
        }
      })
    );

    await assert.rejects(
      () => sdk.adapters.init('scoped-game'),
      (err) => err instanceof AuroMindAdapterError && err.code === 'SDK_NOT_INITIALIZED'
    );

    await sdk.init();
    const record = await sdk.adapters.init('scoped-game');
    assert.equal(record.initialized, true);
    assert.equal('adapter' in record, false);
    assert.equal(initCalls, 1);

    // Second call is idempotent
    await sdk.adapters.init('scoped-game');
    assert.equal(initCalls, 1);

    assert.equal(receivedContext.gameId, 'scoped-game');
    assert.equal(receivedContext.getGuestId(), sdk.identity.getGuestId());
    assert.equal(receivedContext.getIdentity().mode, 'guest');
    assert.equal(receivedContext.canPlay().allowed, true);
    assert.equal(receivedContext.canPlay().offlinePermitted, true);
    assert.equal(Object.isFrozen(receivedContext), true);
  } finally {
    sdk.dispose();
  }
});

test('20. Explicit capability discovery exposes local-only vault boundaries and adapter features', async () => {
  const sdk = createAuroMindSDK({
    env: { indexedDB: new MockIndexedDB(), localStorage: new MockLocalStorage(), locks: null, BroadcastChannel: null, window: null }
  });

  try {
    sdk.adapters.register(
      createSyntheticAdapter('vault-game', {
        localOnlyVaults: ['sankalpa_e2ee_vault'],
        capabilities: { offlinePlay: true, localPersistence: true, cloudSyncEligible: false }
      })
    );

    const caps = sdk.adapters.discoverCapabilities('vault-game');
    assert.equal(caps.offlinePlay, true);
    assert.equal(caps.localPersistence, true);
    assert.equal(caps.exportEnvelope, true);
    assert.equal(caps.applyEnvelope, true);
    assert.equal(caps.cloudSyncEligible, false);
    assert.equal(caps.hasLocalOnlyVaults, true);
    assert.deepEqual(caps.localOnlyVaults, ['sankalpa_e2ee_vault']);

    const allCaps = sdk.adapters.discoverCapabilities();
    assert.ok(allCaps['vault-game']);
  } finally {
    sdk.dispose();
  }
});

test('21. Adapter version and compatibility checks reject incompatible contracts and SDK bounds', () => {
  const badContract = createSyntheticAdapter('compat-a', { extra: { contractVersion: 99 } });
  const c1 = checkAdapterCompatibility(badContract, SDK_VERSION);
  assert.equal(c1.compatible, false);

  const tooNewMin = createSyntheticAdapter('compat-b', { extra: { minSdkVersion: '2.0.0' } });
  const c2 = checkAdapterCompatibility(tooNewMin, SDK_VERSION);
  assert.equal(c2.compatible, false);

  const tooOldMax = createSyntheticAdapter('compat-c', { extra: { maxSdkVersion: '0.9.0' } });
  const c3 = checkAdapterCompatibility(tooOldMax, SDK_VERSION);
  assert.equal(c3.compatible, false);

  const sdk = createAuroMindSDK({
    env: { indexedDB: null, localStorage: null, locks: null, BroadcastChannel: null, window: null }
  });
  try {
    assert.throws(
      () => sdk.adapters.register(tooNewMin),
      (err) => err instanceof AuroMindAdapterError && err.code === 'INCOMPATIBLE_ADAPTER'
    );
  } finally {
    sdk.dispose();
  }
});

test('22. Strict boundary prevents claiming platform DB, platform keys (including exact auromind.platform), or overlapping adapter storage (C-2)', () => {
  const sdk = createAuroMindSDK({
    env: { indexedDB: null, localStorage: null, locks: null, BroadcastChannel: null, window: null }
  });

  try {
    assert.equal(sdk.storage.isProtectedKey(LS_GUEST_KEY), true);
    assert.equal(sdk.storage.isProtectedKey(PLATFORM_LS_ROOT), true);
    assert.equal(sdk.storage.isProtectedKey('auromind_ambient_volume'), false);

    const stealsDb = createSyntheticAdapter('bad-db-game', {
      extra: {
        storage: { kind: 'idb', ownedDatabases: [IDB_DB_NAME], ownedLocalStorageKeys: [] }
      }
    });
    assert.throws(
      () => sdk.adapters.register(stealsDb),
      (err) => err instanceof AuroMindAdapterError && err.code === 'PLATFORM_BOUNDARY_VIOLATION'
    );

    const stealsKey = createSyntheticAdapter('bad-ls-game', {
      extra: {
        storage: { kind: 'ls', ownedDatabases: [], ownedLocalStorageKeys: [LS_GUEST_KEY] }
      }
    });
    assert.throws(
      () => sdk.adapters.register(stealsKey),
      (err) => err instanceof AuroMindAdapterError && err.code === 'PLATFORM_BOUNDARY_VIOLATION'
    );

    // Exact reserved key `auromind.platform` without trailing dot must ALSO be rejected
    const stealsRootKey = createSyntheticAdapter('bad-root-key-game', {
      extra: {
        storage: { kind: 'ls', ownedDatabases: [], ownedLocalStorageKeys: [PLATFORM_LS_ROOT] }
      }
    });
    assert.throws(
      () => sdk.adapters.register(stealsRootKey),
      (err) => err instanceof AuroMindAdapterError && err.code === 'PLATFORM_BOUNDARY_VIOLATION'
    );

    // Cross-adapter storage ownership overlap detection
    sdk.adapters.register(
      createSyntheticAdapter('alpha-game', {
        localOnlyVaults: ['shared_vault_name']
      })
    );

    const overlappingDb = createSyntheticAdapter('beta-db', {
      extra: {
        storage: { kind: 'idb', ownedDatabases: ['alpha-game_db'], ownedLocalStorageKeys: ['beta_only_key'] }
      }
    });
    assert.throws(
      () => sdk.adapters.register(overlappingDb),
      (err) =>
        err instanceof AuroMindAdapterError &&
        err.code === 'STORAGE_OWNERSHIP_CONFLICT' &&
        err.details.resourceKind === 'database'
    );

    const overlappingKey = createSyntheticAdapter('beta-ls', {
      extra: {
        storage: { kind: 'ls', ownedDatabases: ['beta_unique_db'], ownedLocalStorageKeys: ['alpha-game_save_v1'] }
      }
    });
    assert.throws(
      () => sdk.adapters.register(overlappingKey),
      (err) =>
        err instanceof AuroMindAdapterError &&
        err.code === 'STORAGE_OWNERSHIP_CONFLICT' &&
        err.details.resourceKind === 'localStorageKey'
    );

    const overlappingVault = createSyntheticAdapter('beta-vault', {
      localOnlyVaults: ['shared_vault_name']
    });
    assert.throws(
      () => sdk.adapters.register(overlappingVault),
      (err) =>
        err instanceof AuroMindAdapterError &&
        err.code === 'STORAGE_OWNERSHIP_CONFLICT' &&
        err.details.resourceKind === 'localOnlyVault'
    );

    // Replacing the SAME gameId with its own storage declarations remains permitted
    const replacedAlpha = sdk.adapters.register(
      createSyntheticAdapter('alpha-game', {
        localOnlyVaults: ['shared_vault_name'],
        extra: { adapterVersion: '1.2.0' }
      }),
      { replace: true }
    );
    assert.equal(replacedAlpha.adapterVersion, '1.2.0');
  } finally {
    sdk.dispose();
  }
});

test('23. Game-owned save envelopes enforce strict UUIDv4 guestId (C-3) and all non-destructive merge invariants including Invariant 2 and missing strategy', async () => {
  const sdk = createAuroMindSDK({
    env: { indexedDB: new MockIndexedDB(), localStorage: new MockLocalStorage(), locks: null, BroadcastChannel: null, window: null }
  });

  try {
    await sdk.init();
    const customGamePayload = { arbitraryNested: { levelsCleared: [1, 2, 3], customTag: 'opaque' } };
    sdk.adapters.register(
      createSyntheticAdapter('merge-game', { initialState: customGamePayload }),
      {
        mergeStrategy: {
          gameId: 'merge-game',
          resolve(local, remote) {
            return {
              status: 'auto_merged',
              resolvedPayload: { mergedFrom: [local.baseRevision, remote.baseRevision] }
            };
          }
        }
      }
    );

    const localEnv = await sdk.adapters.exportLocalEnvelope('merge-game');
    assert.equal(validateSaveEnvelope(localEnv, 'merge-game'), true);
    assert.deepEqual(localEnv.payload, customGamePayload);

    // C-3: Strict RFC-4122 UUIDv4 validation on envelope.guestId
    for (const badGuestId of [
      'guest_not-a-uuid',
      'guest_12345',
      'guest_11111111-1111-1111-8111-111111111111', // v1, not v4
      'guest_11111111-1111-4111-0111-111111111111', // invalid variant
      '11111111-1111-4111-8111-111111111111'        // missing guest_ prefix
    ]) {
      assert.throws(
        () => validateSaveEnvelope({ ...localEnv, guestId: badGuestId }, 'merge-game'),
        (err) => err instanceof AuroMindAdapterError && err.code === 'INVALID_SAVE_ENVELOPE'
      );
    }

    // Invariant 1: Empty or null remote NEVER overwrites local progress
    const emptyRemote = { ...localEnv, isEmpty: true, checksum: 'empty', payload: null };
    const res1 = sdk.adapters.resolveMerge('merge-game', localEnv, emptyRemote);
    assert.equal(res1.status, 'use_local');
    assert.deepEqual(res1.resolvedPayload, customGamePayload);

    const res1b = sdk.adapters.resolveMerge('merge-game', localEnv, null);
    assert.equal(res1b.status, 'use_local');

    // Invariant 2: Empty local with non-empty remote adopts remote
    const emptyLocal = { ...localEnv, isEmpty: true, checksum: 'empty-local', payload: null };
    const nonEmptyRemote = { ...localEnv, isEmpty: false, baseRevision: 3, checksum: 'remote-v3', payload: { adopted: true } };
    const resInv2 = resolveGameMerge('merge-game', emptyLocal, nonEmptyRemote, null);
    assert.equal(resInv2.status, 'use_remote');
    assert.deepEqual(resInv2.resolvedPayload, { adopted: true });

    // Invariant 3: Matching checksums no-op
    const res3 = sdk.adapters.resolveMerge('merge-game', localEnv, { ...localEnv });
    assert.equal(res3.status, 'use_local');

    // Invariant 4: Divergent non-empty states delegate strictly to game's mergeStrategy
    const divergentRemote = { ...localEnv, baseRevision: 4, checksum: 'remote-hash', payload: { remote: true } };
    const res4 = sdk.adapters.resolveMerge('merge-game', localEnv, divergentRemote);
    assert.equal(res4.status, 'auto_merged');
    assert.deepEqual(res4.resolvedPayload, { mergedFrom: [0, 4] });

    // Missing mergeStrategy conflict fallback -> conflict_requires_user_choice
    sdk.adapters.register(createSyntheticAdapter('no-strategy-game', { initialState: { score: 10 } }));
    const localNoStrat = await sdk.adapters.exportLocalEnvelope('no-strategy-game');
    const remoteNoStrat = { ...localNoStrat, baseRevision: 2, checksum: 'different-hash', payload: { score: 20 } };
    const conflictRes = sdk.adapters.resolveMerge('no-strategy-game', localNoStrat, remoteNoStrat);
    assert.equal(conflictRes.status, 'conflict_requires_user_choice');
    assert.equal(conflictRes.conflictSummary.reason, 'NO_GAME_MERGE_STRATEGY_REGISTERED');
    assert.equal(conflictRes.conflictSummary.localSummary.baseRevision, 0);
    assert.equal(conflictRes.conflictSummary.remoteSummary.baseRevision, 2);
  } finally {
    sdk.dispose();
  }
});

test('24. SDK initialization requires zero network calls and keeps all Tier-2 cloud capabilities disabled by default', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = () => {
    fetchCalled = true;
    throw new Error('Network call forbidden during B1 SDK initialization');
  };

  const sdk = createAuroMindSDK({
    env: { indexedDB: new MockIndexedDB(), localStorage: new MockLocalStorage(), locks: new MockWebLocks(), BroadcastChannel: null, window: null }
  });

  try {
    await sdk.init();
    const caps = sdk.getCapabilities();
    assert.deepEqual(caps, {
      authEnabled: false,
      cloudSyncEnabled: false,
      entitlementsEnabled: false,
      analyticsEnabled: false,
      remoteConfigEnabled: false
    });
    assert.equal(sdk.access.requiresNetwork('vak'), false);
    assert.equal(sdk.access.canPlayGame('vak').allowed, true);
    assert.equal(sdk.auth.isAvailable(), false);
    assert.equal((await sdk.auth.signIn('magic_link')).errorCode, 'NOT_CONFIGURED');
    assert.equal(sdk.sync.isAvailable(), false);
    assert.equal(sdk.entitlements.isCommercialGateActive('auromatch'), false);
    assert.equal(sdk.analytics.isOptedIn(), false);
    assert.equal(sdk.config.getFlag('nonexistent_flag', true), true);

    // Sign-out must never delete local guest identity
    const beforeId = sdk.identity.getGuestId();
    await sdk.auth.signOut();
    assert.equal(sdk.identity.getGuestId(), beforeId);
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
    sdk.dispose();
  }
});

// ============================================================================
// PART 3: B1.1 Hardening & Test Closure Suites (A-2, B-1, B-2, D-1, E-1)
// ============================================================================

test('25. A-2: storageHealth.lastRepairedFrom is set ONLY after repair write actually succeeds', async () => {
  const validIdb = {
    schemaVersion: 1,
    guestId: 'guest_33333333-3333-4333-8333-333333333333',
    createdAt: '2026-08-20T07:00:00.000Z',
    lastSeenAt: '2026-08-20T07:00:00.000Z',
    origin: 'https://auromind.test'
  };
  const idb = new MockIndexedDB();
  idb.seed(IDB_DB_NAME, IDB_STORE_NAME, IDB_GUEST_KEY, validIdb);

  // LS read succeeds (returns null), but LS write throws QuotaExceededError
  const readOnlyLs = new MockLocalStorage({ failGet: false, failSet: true });
  const sdk = createAuroMindSDK({
    env: { indexedDB: idb, localStorage: readOnlyLs, locks: null, BroadcastChannel: null, window: null }
  });
  try {
    await sdk.init();
    assert.equal(sdk.identity.getGuestId(), validIdb.guestId);
    assert.equal(sdk.identity.get().guest.storageSource, 'idb');
    assert.equal(sdk.identity.getStorageHealth().lastRepairedFrom, null);
    assert.equal(readOnlyLs.getItem(LS_GUEST_KEY), null);
  } finally {
    sdk.dispose();
  }

  // Once LS becomes writable, repair succeeds and lastRepairedFrom reports 'idb'
  readOnlyLs.failSet = false;
  const sdkRecovered = createAuroMindSDK({
    env: { indexedDB: idb, localStorage: readOnlyLs, locks: null, BroadcastChannel: null, window: null }
  });
  try {
    await sdkRecovered.init();
    assert.equal(sdkRecovered.identity.getGuestId(), validIdb.guestId);
    assert.equal(sdkRecovered.identity.get().guest.storageSource, 'idb+ls');
    assert.equal(sdkRecovered.identity.getStorageHealth().lastRepairedFrom, 'idb');
    assert.equal(JSON.parse(readOnlyLs.getItem(LS_GUEST_KEY)).guestId, validIdb.guestId);
  } finally {
    sdkRecovered.dispose();
  }
});

test('26. B-1: Pre-init peer broadcasts are buffered, never emit before sdk.isInitialized() is true, and reconcile cleanly on init', async () => {
  const bcHub = new MockBroadcastHub();
  const BC = bcHub.createCtor();
  const idb = new MockIndexedDB({ delayMs: 25 });
  const ls = new MockLocalStorage();

  const peerEarlier = {
    schemaVersion: 1,
    guestId: 'guest_00001111-2222-4333-8444-555566667777',
    createdAt: '2026-02-01T00:00:00.000Z',
    lastSeenAt: '2026-02-01T00:00:00.000Z',
    origin: 'https://auromind.test'
  };

  let releaseInitGate;
  const initGate = new Promise((resolve) => {
    releaseInitGate = resolve;
  });

  const sdk = createAuroMindSDK({
    env: {
      indexedDB: idb,
      localStorage: ls,
      locks: null,
      BroadcastChannel: BC,
      window: new MockWindow(),
      now: () => new Date('2026-11-19T12:00:00.000Z'),
      beforeIdentityCommit: async () => {
        await initGate;
      }
    }
  });

  const observedEvents = [];
  sdk.identity.subscribe((snapshot) => {
    observedEvents.push({
      initializedAtEmit: sdk.isInitialized(),
      guestId: snapshot.guest.guestId
    });
  });

  const peerChannel = new BC('auromind_platform_bus');
  try {
    const initPromise = sdk.init();
    // Wait until setupCrossTabListeners() has attached the BroadcastChannel listener
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(sdk.isInitialized(), false);

    // Peer broadcasts an earlier record WHILE sdk.init() is still paused
    peerChannel.postMessage({
      type: 'GUEST_IDENTITY_READY',
      senderId: 'tab_peer_early',
      record: peerEarlier
    });

    await new Promise((r) => setTimeout(r, 20));
    // CRITICAL B-1 invariant: ZERO notifications emitted before init() completes, and storage untouched
    assert.equal(observedEvents.length, 0);
    assert.equal(sdk.isInitialized(), false);

    releaseInitGate();
    await initPromise;

    assert.equal(sdk.isInitialized(), true);
    assert.equal(sdk.identity.getGuestId(), peerEarlier.guestId);
    assert.equal(observedEvents.length, 1);
    assert.equal(observedEvents[0].initializedAtEmit, true);
    assert.equal(observedEvents[0].guestId, peerEarlier.guestId);
    assert.equal(idb.readRaw(IDB_DB_NAME, IDB_STORE_NAME, IDB_GUEST_KEY).guestId, peerEarlier.guestId);
    assert.equal(JSON.parse(ls.getItem(LS_GUEST_KEY)).guestId, peerEarlier.guestId);
  } finally {
    peerChannel.close();
    sdk.dispose();
  }
});

test('27. B-2: Concurrent identity.ensureGuestIdentity() calls share a single flight and emit once', async () => {
  const idb = new MockIndexedDB({ delayMs: 12 });
  const ls = new MockLocalStorage();
  const locks = new MockWebLocks();
  const sdk = createAuroMindSDK({
    env: { indexedDB: idb, localStorage: ls, locks, BroadcastChannel: null, window: null }
  });

  try {
    await sdk.init();
    const initialLockCount = locks.acquireCount;

    let notifications = 0;
    sdk.identity.subscribe(() => {
      notifications += 1;
    });

    const results = await Promise.all([
      sdk.identity.ensureGuestIdentity(),
      sdk.identity.ensureGuestIdentity(),
      sdk.identity.ensureGuestIdentity(),
      sdk.identity.ensureGuestIdentity()
    ]);

    const uniqueIds = new Set(results.map((r) => r.guestId));
    assert.equal(uniqueIds.size, 1);
    assert.equal(locks.acquireCount, initialLockCount + 1);
    assert.equal(notifications, 1);
  } finally {
    sdk.dispose();
  }
});

test('28. Identity subscriptions notify on init and peer reconciliation, isolate errors, and support unsubscribe', async () => {
  const bcHub = new MockBroadcastHub();
  const BC = bcHub.createCtor();
  const idb = new MockIndexedDB();
  const ls = new MockLocalStorage();
  const sdk = createAuroMindSDK({
    env: {
      indexedDB: idb,
      localStorage: ls,
      locks: null,
      BroadcastChannel: BC,
      window: new MockWindow(),
      now: () => new Date('2026-11-19T10:00:00.000Z')
    }
  });

  assert.throws(
    () => sdk.identity.subscribe('not-a-fn'),
    (err) => err instanceof AuroMindSDKError && err.code === 'INVALID_LISTENER'
  );

  const received = [];
  const unsubThrowing = sdk.identity.subscribe(() => {
    throw new Error('Listener failure must be isolated');
  });
  const unsubGood = sdk.identity.subscribe((snap) => {
    assert.equal(Object.isFrozen(snap), true);
    assert.equal(sdk.isInitialized(), true);
    received.push(snap.guest.guestId);
  });

  const peer = new BC('auromind_platform_bus');
  try {
    await sdk.init();
    assert.equal(received.length, 1);
    const firstId = received[0];

    const earlierPeerId = 'guest_0000aaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    peer.postMessage({
      type: 'GUEST_IDENTITY_READY',
      senderId: 'peer_sub_test',
      record: {
        schemaVersion: 1,
        guestId: earlierPeerId,
        createdAt: '2026-01-01T00:00:00.000Z',
        lastSeenAt: '2026-01-01T00:00:00.000Z',
        origin: null
      }
    });

    await new Promise((r) => setTimeout(r, 30));
    assert.equal(received.length, 2);
    assert.notEqual(received[1], firstId);
    assert.equal(received[1], earlierPeerId);

    // Unsubscribe stops future notifications
    unsubThrowing();
    unsubGood();
    await sdk.identity.ensureGuestIdentity();
    assert.equal(received.length, 2);
  } finally {
    peer.close();
    sdk.dispose();
  }
});

test('29. Platform metadata APIs persist, read, remove, fall back cleanly, and protect reserved keys', async () => {
  const idb = new MockIndexedDB();
  const ls = new MockLocalStorage();
  const sdk = createAuroMindSDK({
    env: { indexedDB: idb, localStorage: ls, locks: null, BroadcastChannel: null, window: null }
  });

  try {
    // Reject reserved guest_identity and invalid keys
    await assert.rejects(
      () => sdk.storage.setPlatformMeta(IDB_GUEST_KEY, { hack: true }),
      (err) => err instanceof AuroMindSDKError && err.code === 'INVALID_META_KEY'
    );
    await assert.rejects(
      () => sdk.storage.getPlatformMeta(''),
      (err) => err instanceof AuroMindSDKError && err.code === 'INVALID_META_KEY'
    );
    await assert.rejects(
      () => sdk.storage.removePlatformMeta(IDB_GUEST_KEY),
      (err) => err instanceof AuroMindSDKError && err.code === 'INVALID_META_KEY'
    );

    assert.equal(await sdk.storage.getPlatformMeta('ui_theme'), null);
    assert.equal(await sdk.storage.setPlatformMeta('ui_theme', { mode: 'dark', v: 1 }), true);
    assert.deepEqual(await sdk.storage.getPlatformMeta('ui_theme'), { mode: 'dark', v: 1 });
    assert.deepEqual(idb.readRaw(IDB_DB_NAME, IDB_STORE_NAME, 'meta:ui_theme'), { mode: 'dark', v: 1 });
    assert.deepEqual(JSON.parse(ls.getItem('auromind.platform.meta.ui_theme')), { mode: 'dark', v: 1 });

    // Remove deletes from both IDB and LS
    assert.equal(await sdk.storage.removePlatformMeta('ui_theme'), true);
    assert.equal(await sdk.storage.getPlatformMeta('ui_theme'), null);
    assert.equal(idb.readRaw(IDB_DB_NAME, IDB_STORE_NAME, 'meta:ui_theme'), null);
    assert.equal(ls.getItem('auromind.platform.meta.ui_theme'), null);
  } finally {
    sdk.dispose();
  }

  // Memory-only fallback when both IDB and LS are unavailable
  const sdkMem = createAuroMindSDK({
    env: { indexedDB: null, localStorage: null, locks: null, BroadcastChannel: null, window: null }
  });
  try {
    assert.equal(await sdkMem.storage.setPlatformMeta('ephemeral_pref', 'quiet'), false);
    assert.equal(await sdkMem.storage.getPlatformMeta('ephemeral_pref'), 'quiet');
    assert.equal(await sdkMem.storage.removePlatformMeta('ephemeral_pref'), false);
    assert.equal(await sdkMem.storage.getPlatformMeta('ephemeral_pref'), null);
  } finally {
    sdkMem.dispose();
  }
});

test('30. D-1: storage.getOfflineState(), subscribeOfflineState(), and dispose() listener cleanup', async () => {
  const win = new MockWindow();
  const nav = { onLine: true, serviceWorker: { controller: null } };
  const bcHub = new MockBroadcastHub();
  const sdk = createAuroMindSDK({
    env: {
      indexedDB: new MockIndexedDB(),
      localStorage: new MockLocalStorage(),
      locks: null,
      BroadcastChannel: bcHub.createCtor(),
      window: win,
      navigator: nav
    }
  });

  assert.throws(
    () => sdk.storage.subscribeOfflineState(null),
    (err) => err instanceof AuroMindSDKError && err.code === 'INVALID_LISTENER'
  );

  const states = [];
  const unsub = sdk.storage.subscribeOfflineState((snap) => {
    assert.equal(Object.isFrozen(snap), true);
    states.push(snap);
  });

  await sdk.init();
  const initialSnap = sdk.storage.getOfflineState();
  assert.equal(initialSnap.online, true);
  assert.equal(initialSnap.serviceWorkerControlled, false);
  assert.equal(initialSnap.idbAvailable, true);
  assert.equal(initialSnap.lsAvailable, true);
  assert.equal(win.listenerCount('online'), 1);
  assert.equal(win.listenerCount('offline'), 1);
  assert.equal(win.listenerCount('storage'), 1);

  // Transition offline -> online
  nav.onLine = false;
  win.dispatch('offline', {});
  nav.onLine = true;
  win.dispatch('online', {});

  assert.equal(states.length, 2);
  assert.equal(states[0].online, false);
  assert.equal(states[1].online, true);

  // Unsubscribe stops callbacks for that subscriber
  unsub();
  nav.onLine = false;
  win.dispatch('offline', {});
  assert.equal(states.length, 2);

  // Re-subscribe and verify dispose() removes ALL window listeners and clears subscribers
  const afterDisposeStates = [];
  sdk.storage.subscribeOfflineState((snap) => afterDisposeStates.push(snap));
  sdk.dispose();

  assert.equal(win.listenerCount('online'), 0);
  assert.equal(win.listenerCount('offline'), 0);
  assert.equal(win.listenerCount('storage'), 0);

  nav.onLine = true;
  win.dispatch('online', {});
  assert.equal(afterDisposeStates.length, 0);
});

test('31. UUIDv4 generation fallback paths (randomUUID, getRandomValues, and Math.random)', () => {
  const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  // Path 1: crypto.randomUUID
  const fromRandomUuid = generateUuidV4({
    randomUUID: () => 'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE'
  });
  assert.equal(fromRandomUuid, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
  assert.match(fromRandomUuid, UUID_V4_RE);

  // Path 2: crypto.getRandomValues fallback (without randomUUID)
  const fromGetRandomValues = generateUuidV4({
    getRandomValues: (arr) => {
      for (let i = 0; i < arr.length; i++) arr[i] = (i * 17 + 3) & 0xff;
      return arr;
    }
  });
  assert.match(fromGetRandomValues, UUID_V4_RE);

  // Path 3: Math.random fallback (crypto completely absent)
  const fromMathRandom = generateUuidV4(null);
  assert.match(fromMathRandom, UUID_V4_RE);
});
