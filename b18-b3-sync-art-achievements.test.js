/**
 * AUROMIND SHARED SDK & SIX-GAME PLATFORM — BATCH 3 VALIDATION SUITE
 *
 * Comprehensive validation of:
 * - TASK-SYNC-01: Offline synchronization, durable outbox, retries, backoff, revision tracking & interrupted sync safety
 * - TASK-SYNC-02: Conflict resolution, optimistic concurrency, empty/corrupt remote guards & 6-game merge strategies
 * - TASK-ART-01: AuroMandala artwork versioning, 10-snapshot cap, integrity & stable UUIDs
 * - TASK-ART-02: Artwork conflict recovery, [Title] (Recovered Copy) naming, soft-delete tombstones & Sankalpa exclusion
 * - TASK-ACH-01: Shared achievements API (unlock, hasUnlocked, getProgress, listDefinitions, subscribe, failure isolation)
 * - Sacred Invariants: VAK speech corpus SHA-256 and Flora database byte/line/hash baselines
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import {
  createAuroMindSDK,
  SDK_VERSION,
  GUEST_ID_RE
} from './assets/sdk/auromind-sdk.js';

import {
  validateGameAdapter,
  validateSaveEnvelope,
  resolveGameMerge,
  getDefaultGameMergeStrategy,
  createLocalMockBridge,
  computePayloadChecksum,
  computeEnvelopeChecksum,
  AuroBlocksMergeStrategy,
  AuroMatchMergeStrategy,
  AuroMandalaMergeStrategy,
  VakMergeStrategy,
  WordRiddleMergeStrategy,
  VakLivingSanctuaryMergeStrategy,
  AuroMindAdapterError
} from './assets/sdk/auromind-adapters.js';

import {
  createAuroMandalaGameAdapter,
  migrateArtworksToMap,
  capSnapshots,
  mergeArtworksWithForking,
  generateArtworkUuid,
  CACHE_KEY,
  SANKALPA_VAULT_KEY
} from './games/auromandala/assets/auromandala-sdk-bridge.js';

import { createAuroMatchGameAdapter } from './games/auromatch/Assets/auromatch-sdk-bridge.js';
import { createAuroBlocksGameAdapter } from './games/auroblocks/assets/auroblocks-sdk-bridge.js';
import { createVakGameAdapter } from './games/vak/assets/vak-sdk-bridge.js';
import { createWordRiddleGameAdapter } from './games/word-riddle/assets/word-riddle-sdk-bridge.js';
import { createVakLivingSanctuaryGameAdapter } from './games/vak-living-sanctuary/assets/vak-living-sanctuary-sdk-bridge.js';

function createStorageMock(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? String(map.get(k)) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
    get length() { return map.size; },
    key: (i) => Array.from(map.keys())[i] ?? null
  };
}

function createMockCloudSyncProvider(initialRecords = {}) {
  const store = new Map(Object.entries(initialRecords));
  const pushCalls = [];
  const pullCalls = [];
  let failNextPush = false;
  let simulateInterruption = false;

  return {
    providerName: 'mock-cloud-sync',
    isConfigured: () => true,
    setFailNextPush: (fail) => { failNextPush = fail; },
    setSimulateInterruption: (interrupted) => { simulateInterruption = interrupted; },
    getPushCalls: () => [...pushCalls],
    getPullCalls: () => [...pullCalls],
    async pullLatest(userId, gameId) {
      pullCalls.push({ userId, gameId });
      const key = `${userId}:${gameId}`;
      return store.get(key) || null;
    },
    async pushWithOptimisticLock(envelope, userId, expectedRev) {
      pushCalls.push({ envelope, userId, expectedRev });
      if (simulateInterruption) {
        throw new Error('NETWORK_TIMEOUT: Connection dropped during sync push transit');
      }
      if (failNextPush) {
        failNextPush = false;
        return { status: 'failed', message: 'Simulated 500 internal server error' };
      }
      const key = `${userId}:${envelope.gameId}`;
      const existing = store.get(key);
      const currentRev = existing ? existing.revision : 0;

      if (expectedRev !== currentRev) {
        return {
          status: 'conflict',
          currentRevision: currentRev,
          serverRecord: existing
        };
      }

      const newRevision = currentRev + 1;
      const record = {
        gameId: envelope.gameId,
        revision: newRevision,
        payload: envelope.payload,
        checksum: envelope.checksum,
        serverUpdatedAt: new Date().toISOString()
      };
      store.set(key, record);
      return { status: 'success', newRevision };
    }
  };
}

// ===========================================================================
// Group 1: Offline Synchronization (TASK-SYNC-01)
// ===========================================================================

test('TASK-SYNC-01: Local-authoritative save writes succeed with zero cloud dependency', async () => {
  const store = createStorageMock();
  const orig = globalThis.localStorage;
  globalThis.localStorage = store;
  const sdk = createAuroMindSDK({ localStorage: store });
  try {
    await sdk.init({ gameId: 'auroblocks', appVersion: '1.0.0' });

    // Verify sync service is unconfigured in local-first mode
    assert.equal(sdk.sync.isAvailable(), false);
    assert.equal(sdk.sync.hasConsent(), false);

    // Game adapter performs local-authoritative write
    const adapter = createAuroBlocksGameAdapter();
    sdk.adapters.register(adapter);

    const initialEnvelope = await adapter.exportEnvelope(sdk.identity.getGuestId());
    assert.equal(initialEnvelope.gameId, 'auroblocks');
    assert.ok(initialEnvelope.checksum);

    // Mutate local storage
    store.setItem('auroblocks_player_save_v1', JSON.stringify({ highScore: 5000, stages: [1] }));
    assert.equal(adapter.hasLocalProgress(), true);

    const updatedEnvelope = await adapter.exportEnvelope(sdk.identity.getGuestId());
    assert.equal(updatedEnvelope.isEmpty, false);
    assert.equal(updatedEnvelope.payload.save.highScore, 5000);
  } finally {
    sdk.dispose();
    globalThis.localStorage = orig;
  }
});

test('TASK-SYNC-01: Durable local sync outbox enqueues changes, tracks backoff & processes outbox', async () => {
  const store = createStorageMock();
  const orig = globalThis.localStorage;
  globalThis.localStorage = store;
  const mockSync = createMockCloudSyncProvider();
  const sdk = createAuroMindSDK({
    localStorage: store,
    providers: {
      cloudSync: mockSync,
      auth: {
        isConfigured: () => true,
        getCurrentSession: async () => ({ userId: 'user_auro_01' })
      }
    }
  });

  try {
    await sdk.init({
      gameId: 'portal',
      capabilities: { cloudSyncEnabled: true, authEnabled: true }
    });

    sdk.sync.setConsent(true);
    assert.equal(sdk.sync.isAvailable(), true);

    // Register adapter with local save
    const auroblocks = createAuroBlocksGameAdapter();
    sdk.adapters.register(auroblocks);
    store.setItem('auroblocks_player_save_v1', JSON.stringify({ highScore: 9000, stages: [1] }));

    // Queue change to outbox
    await sdk.sync.queueLocalChange('auroblocks');
    assert.equal(sdk.sync.getPendingOutboxCount(), 1);
    assert.deepEqual(sdk.sync.getPendingGames(), ['auroblocks']);

    // Verify backoff delay calculation
    const delay0 = sdk.sync.getBackoffDelay(0);
    const delay3 = sdk.sync.getBackoffDelay(3);
    assert.ok(delay0 >= 1000 && delay0 <= 1500);
    assert.ok(delay3 >= 8000 && delay3 <= 8500);

    // Drain outbox on reconnect
    const res = await sdk.sync.onReconnect();
    assert.equal(res.status, 'success');
    assert.equal(sdk.sync.getPendingOutboxCount(), 0);
    assert.equal(mockSync.getPushCalls().length, 1);
  } finally {
    sdk.dispose();
    globalThis.localStorage = orig;
  }
});

test('TASK-SYNC-01: Deduplication of in-flight sync calls avoids redundant pushes', async () => {
  const store = createStorageMock();
  const orig = globalThis.localStorage;
  globalThis.localStorage = store;
  const mockSync = createMockCloudSyncProvider();
  const sdk = createAuroMindSDK({
    localStorage: store,
    providers: {
      cloudSync: mockSync,
      auth: {
        isConfigured: () => true,
        getCurrentSession: async () => ({ userId: 'user_auro_02' })
      }
    }
  });

  try {
    await sdk.init({
      gameId: 'portal',
      capabilities: { cloudSyncEnabled: true, authEnabled: true }
    });
    sdk.sync.setConsent(true);

    const auroblocks = createAuroBlocksGameAdapter();
    sdk.adapters.register(auroblocks);
    store.setItem('auroblocks_player_save_v1', JSON.stringify({ highScore: 3000, stages: [1] }));

    // Launch concurrent syncNow calls
    const [res1, res2] = await Promise.all([
      sdk.sync.syncNow('auroblocks'),
      sdk.sync.syncNow('auroblocks')
    ]);

    assert.equal(res1.status, 'success');
    assert.equal(res2.status, 'success');
    // Only 1 push must have executed due to active in-flight deduplication
    assert.equal(mockSync.getPushCalls().length, 1);
  } finally {
    sdk.dispose();
    globalThis.localStorage = orig;
  }
});

test('TASK-SYNC-01: Revision-based synchronization increments monotonically', async () => {
  const store = createStorageMock();
  const orig = globalThis.localStorage;
  globalThis.localStorage = store;
  const mockSync = createMockCloudSyncProvider();
  const sdk = createAuroMindSDK({
    localStorage: store,
    providers: {
      cloudSync: mockSync,
      auth: {
        isConfigured: () => true,
        getCurrentSession: async () => ({ userId: 'user_auro_03' })
      }
    }
  });

  try {
    await sdk.init({
      gameId: 'portal',
      capabilities: { cloudSyncEnabled: true, authEnabled: true }
    });
    sdk.sync.setConsent(true);

    const auroblocks = createAuroBlocksGameAdapter();
    sdk.adapters.register(auroblocks);

    // Initial save -> revision 1
    store.setItem('auroblocks_player_save_v1', JSON.stringify({ highScore: 1000, stages: [1] }));
    const sync1 = await sdk.sync.syncNow('auroblocks');
    assert.equal(sync1.results[0].revision, 1);

    // Update local save -> revision 2
    store.setItem('auroblocks_player_save_v1', JSON.stringify({ highScore: 2000, stages: [1] }));
    const sync2 = await sdk.sync.syncNow('auroblocks');
    assert.equal(sync2.results[0].revision, 2);

    const pushes = mockSync.getPushCalls();
    assert.equal(pushes[0].expectedRev, 0);
    assert.equal(pushes[1].expectedRev, 1);
  } finally {
    sdk.dispose();
    globalThis.localStorage = orig;
  }
});

test('TASK-SYNC-01: Safe handling of interrupted sync preserves local data and queues retry', async () => {
  const store = createStorageMock();
  const orig = globalThis.localStorage;
  globalThis.localStorage = store;
  const mockSync = createMockCloudSyncProvider();
  const sdk = createAuroMindSDK({
    localStorage: store,
    providers: {
      cloudSync: mockSync,
      auth: {
        isConfigured: () => true,
        getCurrentSession: async () => ({ userId: 'user_auro_04' })
      }
    }
  });

  try {
    await sdk.init({
      gameId: 'portal',
      capabilities: { cloudSyncEnabled: true, authEnabled: true }
    });
    sdk.sync.setConsent(true);

    const auroblocks = createAuroBlocksGameAdapter();
    sdk.adapters.register(auroblocks);
    const localContent = JSON.stringify({ highScore: 7777, stages: [{ id: 1, score: 500 }] });
    store.setItem('auroblocks_player_save_v1', localContent);

    // Simulate abrupt network drop / timeout during push transit
    mockSync.setSimulateInterruption(true);
    await sdk.sync.queueLocalChange('auroblocks');

    const syncRes = await sdk.sync.syncNow('auroblocks');
    assert.equal(syncRes.status, 'success');
    assert.equal(syncRes.results[0].action, 'error');

    // Invariant: Local save must NOT be modified or corrupted
    assert.equal(store.getItem('auroblocks_player_save_v1'), localContent);

    // Invariant: Failed item remains in outbox for retry
    assert.equal(sdk.sync.getPendingOutboxCount(), 1);

    // Reconnection: Network restored
    mockSync.setSimulateInterruption(false);
    const retryRes = await sdk.sync.onReconnect();
    assert.equal(retryRes.status, 'success');
    assert.equal(retryRes.results[0].action, 'pushed_initial');
    assert.equal(sdk.sync.getPendingOutboxCount(), 0);
  } finally {
    sdk.dispose();
    globalThis.localStorage = orig;
  }
});

test('TASK-SYNC-01: Idempotent sync processing avoids redundant push when checksums match', async () => {
  const store = createStorageMock();
  const orig = globalThis.localStorage;
  globalThis.localStorage = store;
  const mockSync = createMockCloudSyncProvider();
  const sdk = createAuroMindSDK({
    localStorage: store,
    providers: {
      cloudSync: mockSync,
      auth: {
        isConfigured: () => true,
        getCurrentSession: async () => ({ userId: 'user_auro_05' })
      }
    }
  });

  try {
    await sdk.init({
      gameId: 'portal',
      capabilities: { cloudSyncEnabled: true, authEnabled: true }
    });
    sdk.sync.setConsent(true);

    const auroblocks = createAuroBlocksGameAdapter();
    sdk.adapters.register(auroblocks);
    store.setItem('auroblocks_player_save_v1', JSON.stringify({ highScore: 5000, stages: [1] }));

    // Initial push
    await sdk.sync.syncNow('auroblocks');
    assert.equal(mockSync.getPushCalls().length, 1);

    // Immediate second sync without local change
    await sdk.sync.syncNow('auroblocks');
    // Invariant: Same checksum requires no re-push
    assert.equal(mockSync.getPushCalls().length, 1);
  } finally {
    sdk.dispose();
    globalThis.localStorage = orig;
  }
});

// ===========================================================================
// Group 2: Conflict Resolution & Merge Strategies (TASK-SYNC-02)
// ===========================================================================

test('TASK-SYNC-02: Optimistic concurrency detects revision mismatch without silent clobbering', async () => {
  const store = createStorageMock();
  const orig = globalThis.localStorage;
  globalThis.localStorage = store;
  const mockSync = createMockCloudSyncProvider();
  const sdk = createAuroMindSDK({
    localStorage: store,
    providers: {
      cloudSync: mockSync,
      auth: {
        isConfigured: () => true,
        getCurrentSession: async () => ({ userId: 'user_auro_06' })
      }
    }
  });

  try {
    await sdk.init({
      gameId: 'portal',
      capabilities: { cloudSyncEnabled: true, authEnabled: true }
    });
    sdk.sync.setConsent(true);

    const auroblocks = createAuroBlocksGameAdapter();
    sdk.adapters.register(auroblocks);

    // Push initial save from client A
    store.setItem('auroblocks_player_save_v1', JSON.stringify({ highScore: 1000, stages: [1] }));
    await sdk.sync.syncNow('auroblocks');

    // Simulate another device pushed revision 2 in the meantime
    const envelope = await auroblocks.exportEnvelope('guest_other');
    envelope.payload.save.highScore = 2500;
    envelope.checksum = await computePayloadChecksum(envelope.payload);
    await mockSync.pushWithOptimisticLock(envelope, 'user_auro_06', 1);

    // Client A attempts sync with local highScore: 1500
    store.setItem('auroblocks_player_save_v1', JSON.stringify({ highScore: 1500, stages: [1] }));
    const syncRes = await sdk.sync.syncNow('auroblocks');

    assert.equal(syncRes.status, 'success');
    // Merge strategy auto-merges: max(1500, 2500) = 2500, and pushes revision 3
    assert.equal(syncRes.results[0].action, 'auto_merged_and_pushed');
    assert.equal(syncRes.results[0].revision, 3);
  } finally {
    sdk.dispose();
    globalThis.localStorage = orig;
  }
});

test('TASK-SYNC-02: Empty or absent remote envelope never overwrites valid local progress', async () => {
  const localEnvelope = {
    envelopeVersion: 1,
    gameSchemaVersion: 1,
    gameId: 'auroblocks',
    guestId: 'guest_00000000-0000-4000-8000-000000000001',
    baseRevision: 0,
    clientUpdatedAt: new Date().toISOString(),
    checksum: 'a'.repeat(64),
    isEmpty: false,
    payload: { highScore: 4500 }
  };
  const emptyRemote = {
    envelopeVersion: 1,
    gameSchemaVersion: 1,
    gameId: 'auroblocks',
    guestId: 'guest_00000000-0000-4000-8000-000000000002',
    baseRevision: 0,
    clientUpdatedAt: new Date().toISOString(),
    checksum: 'b'.repeat(64),
    isEmpty: true,
    payload: {}
  };

  const res1 = resolveGameMerge('auroblocks', localEnvelope, null, AuroBlocksMergeStrategy);
  assert.equal(res1.status, 'use_local');
  assert.equal(res1.resolvedPayload.highScore, 4500);

  const res2 = resolveGameMerge('auroblocks', localEnvelope, emptyRemote, AuroBlocksMergeStrategy);
  assert.equal(res2.status, 'use_local');
  assert.equal(res2.resolvedPayload.highScore, 4500);
});

test('TASK-SYNC-02: Corrupt remote envelope with invalid checksum throws and aborts', async () => {
  const localEnvelope = {
    envelopeVersion: 1,
    gameId: 'auroblocks',
    guestId: 'guest_00000000-0000-4000-8000-000000000001',
    checksum: 'a'.repeat(64),
    isEmpty: false,
    payload: { highScore: 1000 }
  };
  const corruptRemote = {
    envelopeVersion: 1,
    gameId: 'auroblocks',
    guestId: 'guest_00000000-0000-4000-8000-000000000002',
    checksum: 'invalid_short_checksum',
    isEmpty: false,
    payload: { highScore: 9999 }
  };

  assert.throws(() => {
    resolveGameMerge('auroblocks', localEnvelope, corruptRemote, AuroBlocksMergeStrategy);
  }, /AuroMindAdapterError/);
});

test('TASK-SYNC-02: Non-destructive merge resolution for all six launch games', async () => {
  const guestId = 'guest_00000000-0000-4000-8000-000000000001';

  // 1. AuroBlocks
  const blocksRes = AuroBlocksMergeStrategy.resolve(
    { payload: { highScore: 1000, stages: [{ id: 1, score: 200, stars: 1 }] } },
    { payload: { highScore: 1500, stages: [{ id: 1, score: 300, stars: 3 }, { id: 2, score: 400 }] } }
  );
  assert.equal(blocksRes.resolvedPayload.highScore, 1500);
  assert.equal(blocksRes.resolvedPayload.stages.length, 2);

  // 2. AuroMatch
  const matchRes = AuroMatchMergeStrategy.resolve(
    { payload: { completedLevels: [1, 2], petals: 10, reflections: [{ id: 'r1', text: 'Peace' }] } },
    { payload: { completedLevels: [2, 3], petals: 15, reflections: [{ id: 'r2', text: 'Joy' }] } }
  );
  assert.deepEqual(matchRes.resolvedPayload.completedLevels, [1, 2, 3]);
  assert.equal(matchRes.resolvedPayload.petals, 15);
  assert.equal(matchRes.resolvedPayload.reflections.length, 2);

  // 3. AuroMandala
  const mandalaRes = AuroMandalaMergeStrategy.resolve(
    { payload: { progression: { highestStageCleared: 2 }, artworks: { a1: { title: 'Lotus' } } } },
    { payload: { progression: { highestStageCleared: 5 }, artworks: { a2: { title: 'Sun' } } } }
  );
  assert.equal(mandalaRes.resolvedPayload.progression.highestStageCleared, 5);
  assert.ok(mandalaRes.resolvedPayload.artworks.a1);
  assert.ok(mandalaRes.resolvedPayload.artworks.a2);

  // 4. VAK
  const vakRes = VakMergeStrategy.resolve(
    { payload: { currentLevel: 10, completedWords: ['OM'], sparks: 50 } },
    { payload: { currentLevel: 15, completedWords: ['SHANTI'], sparks: 80 } }
  );
  assert.equal(vakRes.resolvedPayload.currentLevel, 15);
  assert.deepEqual(vakRes.resolvedPayload.completedWords, ['OM', 'SHANTI']);
  assert.equal(vakRes.resolvedPayload.sparks, 80);

  // 5. Word Riddle
  const riddleRes = WordRiddleMergeStrategy.resolve(
    { payload: { solvedRiddles: ['r1'], currentStreak: 3, maxStreak: 5 } },
    { payload: { solvedRiddles: ['r2'], currentStreak: 4, maxStreak: 4 } }
  );
  assert.deepEqual(riddleRes.resolvedPayload.solvedRiddles, ['r1', 'r2']);
  assert.equal(riddleRes.resolvedPayload.maxStreak, 5);

  // 6. VAK Living Sanctuary
  const sanctuaryRes = VakLivingSanctuaryMergeStrategy.resolve(
    { payload: { unlockedWords: ['w1'], bookmarks: ['b1'], personalNotes: [{ id: 'n1', text: 'Old', updatedAt: '2026-11-20T10:00:00Z' }] } },
    { payload: { unlockedWords: ['w2'], bookmarks: ['b2'], personalNotes: [{ id: 'n1', text: 'New', updatedAt: '2026-11-20T12:00:00Z' }] } }
  );
  assert.deepEqual(sanctuaryRes.resolvedPayload.unlockedWords, ['w1', 'w2']);
  assert.deepEqual(sanctuaryRes.resolvedPayload.bookmarks, ['b1', 'b2']);
  assert.equal(sanctuaryRes.resolvedPayload.personalNotes[0].text, 'New');
});

test('TASK-SYNC-02: VAK Living Sanctuary revision-aware conflict resolution enforces ADR-06 invariants', () => {
  // Invariant 1: Higher revision with older timestamp beats lower revision with newer timestamp
  const higherRevOldTime = {
    id: 'note_insight',
    text: 'Higher revision authoritative insight',
    revision: 5,
    updatedAt: '2026-11-20T08:00:00.000Z' // Older timestamp
  };
  const lowerRevNewTime = {
    id: 'note_insight',
    text: 'Lower revision stale client text',
    revision: 2,
    updatedAt: '2026-11-20T18:00:00.000Z' // Newer timestamp
  };

  const res1 = VakLivingSanctuaryMergeStrategy.resolve(
    { payload: { personalNotes: [higherRevOldTime] } },
    { payload: { personalNotes: [lowerRevNewTime] } }
  );
  // Higher revision must strictly retain primary key
  const primary1 = res1.resolvedPayload.personalNotes.find((n) => n.id === 'note_insight');
  assert.equal(primary1.text, 'Higher revision authoritative insight');
  assert.equal(primary1.revision, 5);
  // Lower revision must be preserved non-destructively as recovered copy (no silent loss)
  const recovered1 = res1.resolvedPayload.personalNotes.find((n) => n.id === 'note_insight_recovered');
  assert.ok(recovered1, 'Lower revision competing note must be preserved as recovered copy');
  assert.equal(recovered1.text, 'Lower revision stale client text');

  // Invariant 2: Reverse order (remote has higher revision with older timestamp)
  const res2 = VakLivingSanctuaryMergeStrategy.resolve(
    { payload: { personalNotes: [lowerRevNewTime] } },
    { payload: { personalNotes: [higherRevOldTime] } }
  );
  const primary2 = res2.resolvedPayload.personalNotes.find((n) => n.id === 'note_insight');
  assert.equal(primary2.text, 'Higher revision authoritative insight');
  assert.equal(primary2.revision, 5);

  // Invariant 3: Equal revisions with divergent content preserves BOTH copies
  const equalRevClientA = {
    id: 'note_reflection',
    text: 'Meditation on divine light',
    revision: 3,
    updatedAt: '2026-11-20T10:00:00.000Z'
  };
  const equalRevClientB = {
    id: 'note_reflection',
    text: 'Meditation on infinite peace',
    revision: 3,
    updatedAt: '2026-11-20T11:00:00.000Z'
  };
  const res3 = VakLivingSanctuaryMergeStrategy.resolve(
    { payload: { personalNotes: [equalRevClientA] } },
    { payload: { personalNotes: [equalRevClientB] } }
  );
  const primary3 = res3.resolvedPayload.personalNotes.find((n) => n.id === 'note_reflection');
  const recovered3 = res3.resolvedPayload.personalNotes.find((n) => n.id === 'note_reflection_recovered');
  assert.ok(primary3, 'Primary note must exist');
  assert.ok(recovered3, 'Recovered copy must exist for equal-revision divergence');
  assert.notEqual(primary3.text, recovered3.text, 'Both divergent contents must be preserved');
  assert.ok(
    (primary3.text === equalRevClientB.text && recovered3.text === equalRevClientA.text) ||
    (primary3.text === equalRevClientA.text && recovered3.text === equalRevClientB.text)
  );

  // Invariant 4: Missing revision metadata preserves both without silent data loss
  const unversionedA = {
    id: 'note_unversioned',
    text: 'Thought A from older client'
  };
  const unversionedB = {
    id: 'note_unversioned',
    text: 'Thought B from offline client'
  };
  const res4 = VakLivingSanctuaryMergeStrategy.resolve(
    { payload: { personalNotes: [unversionedA] } },
    { payload: { personalNotes: [unversionedB] } }
  );
  assert.equal(res4.resolvedPayload.personalNotes.length, 2, 'Missing revision metadata must not drop either note');
  const allTexts = res4.resolvedPayload.personalNotes.map((n) => n.text);
  assert.ok(allTexts.includes('Thought A from older client'));
  assert.ok(allTexts.includes('Thought B from offline client'));
});

// ===========================================================================
// Group 3: AuroMandala Artwork Versioning & Conflict Recovery (TASK-ART-01, 02)
// ===========================================================================

test('TASK-ART-01: Artwork entities are versioned with UUIDv4, integrity metadata & 10-snapshot cap', () => {
  const legacyArtworks = [
    { title: 'Chakra 1', strokes: [{ x: 1, y: 1 }] },
    { title: 'Chakra 2', strokes: [{ x: 2, y: 2 }] }
  ];
  const dict = migrateArtworksToMap(legacyArtworks);
  const ids = Object.keys(dict);

  assert.equal(ids.length, 2);
  for (const id of ids) {
    const art = dict[id];
    assert.equal(typeof art.artworkId, 'string');
    assert.equal(art.currentVersion, 1);
    assert.equal(art.deleted, false);
    assert.ok(Array.isArray(art.snapshots));
    assert.ok(art.snapshots.length <= 10);
  }

  // Cap snapshots test
  const fifteenSnaps = Array.from({ length: 15 }, (_, i) => ({ version: i, hash: `h_${i}` }));
  const capped = capSnapshots(fifteenSnaps);
  assert.equal(capped.length, 10);
  assert.equal(capped[0].version, 5);
  assert.equal(capped[9].version, 14);
});

test('TASK-ART-02: Competing artwork revisions generate [Title] (Recovered Copy) while keeping original local', () => {
  const sharedUuid = 'art_uuid_shared_100';
  const localMap = {
    [sharedUuid]: {
      artworkId: sharedUuid,
      title: 'Cosmic Rose',
      currentVersion: 1,
      updatedAt: '2026-11-21T10:00:00Z',
      strokesCount: 5,
      snapshots: []
    }
  };
  const remoteMap = {
    [sharedUuid]: {
      artworkId: sharedUuid,
      title: 'Cosmic Rose',
      currentVersion: 2,
      updatedAt: '2026-11-21T11:00:00Z',
      strokesCount: 8,
      snapshots: []
    }
  };

  const merged = mergeArtworksWithForking(localMap, remoteMap);
  const keys = Object.keys(merged);

  assert.equal(keys.length, 2, 'Must contain both local original and forked remote copy');
  assert.equal(merged[sharedUuid].title, 'Cosmic Rose');
  assert.equal(merged[sharedUuid].strokesCount, 5, 'Local copy must remain intact');

  const forkedId = keys.find(k => k !== sharedUuid);
  assert.ok(forkedId);
  assert.equal(merged[forkedId].title, 'Cosmic Rose (Recovered Copy)');
  assert.equal(merged[forkedId].strokesCount, 8);
});

test('TASK-ART-02: Soft-delete tombstones prevent deleted artwork from unexpectedly reappearing', () => {
  const artId = 'art_tombstone_001';
  const localMap = {
    [artId]: {
      artworkId: artId,
      title: 'Mandala to Delete',
      deleted: true,
      deletedAt: '2026-11-21T12:00:00Z',
      updatedAt: '2026-11-21T12:00:00Z'
    }
  };
  const remoteStale = {
    [artId]: {
      artworkId: artId,
      title: 'Mandala to Delete',
      deleted: false,
      updatedAt: '2026-11-21T10:00:00Z' // Updated BEFORE deletion
    }
  };

  const merged = mergeArtworksWithForking(localMap, remoteStale);
  // Stale remote must not resurrect deleted artwork
  assert.equal(merged[artId].deleted, true);
});

test('TASK-ART-02: Sankalpa vault and reflections remain 100% local-only and excluded from save envelopes', async () => {
  const store = createStorageMock({
    [CACHE_KEY]: JSON.stringify({
      highestStageCleared: 3,
      sessions: [{ id: 's1', score: 900 }],
      savedArtworks: [{ id: 'a1', title: 'Flower', strokes: [] }],
      sankalpa: 'Deep inner surrender to the divine truth.' // Private intention
    }),
    [SANKALPA_VAULT_KEY]: JSON.stringify({ ciphertextHex: '1122334455667788', ivHex: 'aabbccdd' })
  });

  const originalLocalStorage = globalThis.localStorage;
  globalThis.localStorage = store;

  try {
    const adapter = createAuroMandalaGameAdapter();
    const guestId = 'guest_00000000-0000-4000-8000-000000000001';
    const envelope = await adapter.exportEnvelope(guestId);

    // Verify envelope contents
    assert.ok(envelope.payload.artworks);
    assert.ok(envelope.payload.progression);

    const envString = JSON.stringify(envelope);
    assert.equal(envString.includes('sankalpa'), false, 'Save envelope must not contain any sankalpa key');
    assert.equal(envString.includes('sankalpa_e2ee_vault'), false, 'Save envelope must not contain vault key');
    assert.equal(envString.includes('surrender to the divine'), false, 'Save envelope must not contain private text');

    // Local data remains 100% intact
    const cache = JSON.parse(store.getItem(CACHE_KEY));
    assert.equal(cache.sankalpa, 'Deep inner surrender to the divine truth.');
    assert.ok(store.getItem(SANKALPA_VAULT_KEY));
  } finally {
    globalThis.localStorage = originalLocalStorage;
  }
});

// ===========================================================================
// Group 4: Shared Achievements API (TASK-ACH-01)
// ===========================================================================

test('TASK-ACH-01: Achievements unlock is typed and idempotent with firstUnlock tracking', async () => {
  const store = createStorageMock();
  const sdk = createAuroMindSDK({ localStorage: store });
  try {
    await sdk.init({ gameId: 'vak' });

    // Initial unlock -> firstUnlock: true
    const res1 = await sdk.achievements.unlock('first_word_spoken', { level: 1 });
    assert.equal(res1.unlocked, true);
    assert.equal(res1.firstUnlock, true);
    assert.equal(res1.achievement.id, 'first_word_spoken');

    // Duplicate unlock -> idempotent, firstUnlock: false
    const res2 = await sdk.achievements.unlock('first_word_spoken', { level: 1 });
    assert.equal(res2.unlocked, true);
    assert.equal(res2.firstUnlock, false);

    assert.equal(sdk.achievements.hasUnlocked('first_word_spoken'), true);
    assert.equal(sdk.achievements.hasUnlocked('unearned_badge'), false);
  } finally {
    sdk.dispose();
  }
});

test('TASK-ACH-01: getProgress and incrementProgress track numeric targets up to maxProgress', async () => {
  const store = createStorageMock();
  const sdk = createAuroMindSDK({ localStorage: store });
  try {
    await sdk.init({ gameId: 'auromatch' });

    // Increment progress
    const step1 = await sdk.achievements.incrementProgress('collector_50', 20, 50);
    assert.equal(step1.unlocked, false);
    assert.equal(step1.progress, 20);
    assert.equal(step1.maxProgress, 50);

    const step2 = await sdk.achievements.incrementProgress('collector_50', 25, 50);
    assert.equal(step2.unlocked, false);
    assert.equal(step2.progress, 45);

    // Cross threshold -> unlocks automatically
    const step3 = await sdk.achievements.incrementProgress('collector_50', 10, 50);
    assert.equal(step3.unlocked, true);
    assert.equal(step3.progress, 50);
    assert.equal(sdk.achievements.hasUnlocked('collector_50'), true);

    const p = sdk.achievements.getProgress('collector_50');
    assert.equal(p.unlocked, true);
    assert.equal(p.progress, 50);
  } finally {
    sdk.dispose();
  }
});

test('TASK-ACH-01: listDefinitions and registerDefinitions manage scoped game definitions', async () => {
  const store = createStorageMock();
  const sdk = createAuroMindSDK({ localStorage: store });
  try {
    await sdk.init({ gameId: 'portal' });

    sdk.achievements.registerDefinitions([
      { id: 'vak_master', gameId: 'vak', title: 'Vak Master', description: 'Speak all words' },
      { id: 'match_master', gameId: 'auromatch', title: 'Match Master', description: 'Clear all levels' }
    ]);

    const allDefs = sdk.achievements.listDefinitions();
    assert.equal(allDefs.length, 2);

    const vakDefs = sdk.achievements.listDefinitions('vak');
    assert.equal(vakDefs.length, 1);
    assert.equal(vakDefs[0].id, 'vak_master');
  } finally {
    sdk.dispose();
  }
});

test('TASK-ACH-01: subscribe receives unlock & progress notifications, unsubscribe works cleanly', async () => {
  const store = createStorageMock();
  const sdk = createAuroMindSDK({ localStorage: store });
  try {
    await sdk.init({ gameId: 'word-riddle' });

    const notifications = [];
    const unsubscribe = sdk.achievements.subscribe((record) => {
      notifications.push(record);
    });

    await sdk.achievements.incrementProgress('riddle_solver', 5, 20);
    await sdk.achievements.unlock('quick_thinker');

    assert.equal(notifications.length, 2);
    assert.equal(notifications[0].id, 'riddle_solver');
    assert.equal(notifications[1].id, 'quick_thinker');

    // Unsubscribe
    unsubscribe();
    await sdk.achievements.unlock('after_unsubscribe');
    assert.equal(notifications.length, 2); // No new notification
  } finally {
    sdk.dispose();
  }
});

test('TASK-ACH-01: Non-blocking achievement failures: invalid inputs or listener errors never crash gameplay', async () => {
  const store = createStorageMock();
  const sdk = createAuroMindSDK({ localStorage: store });
  try {
    await sdk.init({ gameId: 'auroblocks' });

    // Faulty listener that throws
    sdk.achievements.subscribe(() => {
      throw new Error('EXPLOSIVE_LISTENER_CRASH');
    });

    // Should not throw
    const res = await sdk.achievements.unlock('safe_achievement');
    assert.equal(res.unlocked, true);

    // Invalid IDs should return cleanly without throwing
    const invalid1 = await sdk.achievements.unlock(null);
    assert.equal(invalid1.unlocked, false);

    const invalid2 = await sdk.achievements.incrementProgress('', 10);
    assert.equal(invalid2, null);
  } finally {
    sdk.dispose();
  }
});

test('TASK-ACH-01: Standalone mock bridge exposes complete offline achievements surface', () => {
  const mockBridge = createLocalMockBridge('auromatch');
  assert.equal(typeof mockBridge.achievements.unlock, 'function');
  assert.equal(typeof mockBridge.achievements.hasUnlocked, 'function');
  assert.equal(typeof mockBridge.achievements.getProgress, 'function');
  assert.equal(typeof mockBridge.achievements.listDefinitions, 'function');
  assert.equal(typeof mockBridge.achievements.subscribe, 'function');
  assert.equal(typeof mockBridge.achievements.listUnlocked, 'function');
  assert.equal(typeof mockBridge.achievements.getAll, 'function');

  assert.equal(mockBridge.achievements.hasUnlocked('any_id'), false);
  assert.deepEqual(mockBridge.achievements.listDefinitions(), []);
});

test('TASK-ACH-01: Game-specific achievement isolation tags achievements by gameId', async () => {
  const store = createStorageMock();
  const sdk = createAuroMindSDK({ localStorage: store });
  let sdkMatch = null;
  try {
    await sdk.init({ gameId: 'vak' });
    await sdk.achievements.unlock('level_10_clear', { gameId: 'vak' });

    // Re-init with auromatch
    sdk.dispose();
    sdkMatch = createAuroMindSDK({ localStorage: store });
    await sdkMatch.init({ gameId: 'auromatch' });
    await sdkMatch.achievements.unlock('botanical_zen', { gameId: 'auromatch' });

    const vakList = sdkMatch.achievements.listUnlocked('vak');
    assert.equal(vakList.length, 1);
    assert.equal(vakList[0].id, 'level_10_clear');

    const matchList = sdkMatch.achievements.listUnlocked('auromatch');
    assert.equal(matchList.length, 1);
    assert.equal(matchList[0].id, 'botanical_zen');
  } finally {
    sdk.dispose();
    if (sdkMatch) sdkMatch.dispose();
  }
});

// ===========================================================================
// Group 5: Sacred Invariants & Cryptographic Baselines
// ===========================================================================

test('Sacred Invariant: VAK 1,368-level speech training corpus matches frozen SHA-256', () => {
  const vakPath = path.join(__dirname, 'games/vak/index.html');
  const vakSrc = fs.readFileSync(vakPath, 'utf8');
  const clMatch = vakSrc.match(/const CL = \[\[[\s\S]*?\]\];/);
  assert.ok(clMatch, 'CL array must exist in games/vak/index.html');
  const hash = crypto.createHash('sha256').update(clMatch[0], 'utf8').digest('hex');
  assert.equal(hash, '9fdb3826030049c9eab183479bcb7fe29304b3ea08d045c8c67f1cfd4d77da09');
});

test('Sacred Invariant: AuroMatch Flora database matches exact size, lines, and SHA-256', () => {
  const floraPath = path.join(__dirname, 'games/auromatch/src/models/floraDatabase.js');
  const stat = fs.statSync(floraPath);
  assert.equal(stat.size, 2002176, 'Flora database size must be exactly 2,002,176 bytes');

  const content = fs.readFileSync(floraPath, 'utf8');
  const newlineCount = (content.match(/\n/g) || []).length;
  assert.equal(newlineCount, 46321, 'Flora database newline count must be exactly 46,321 lines');

  const hash = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  assert.equal(hash, '689d035cd52abd8d342528d8c5f61f298916b8052b8287450be4931cf8ae1a3a');
});
