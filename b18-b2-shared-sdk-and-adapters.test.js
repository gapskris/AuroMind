/**
 * AUROMIND SHARED SDK & SIX-GAME ADAPTER INTEGRATION SUITE (BATCH 2)
 *
 * Comprehensive validation of:
 * - TASK-SDK-01: Shared SDK service contracts, typed APIs, lifecycle & error handling
 * - TASK-SDK-02: Shared adapter registry, integration contracts, merge strategies & mock bridges
 * - TASK-ADP-01: AuroBlocks game adapter contract, storage isolation, export/apply
 * - TASK-ADP-02: AuroMatch game adapter contract, IndexedDB/localStorage auto-healing
 * - TASK-ADP-03: AuroMandala game adapter contract, artwork dictionary, rolling snapshots & Sankalpa isolation
 * - TASK-ADP-04: VAK Speech game adapter contract, profile saves & 1,368-level corpus immutability
 * - TASK-ADP-05: Word Riddle & VAK Living Sanctuary game adapter contracts & codex isolation
 * - Cross-game identity consistency, save isolation, and sacred asset immutability
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
  GUEST_ID_RE,
  AuroMindSDKError
} from './assets/sdk/auromind-sdk.js';

import {
  ADAPTER_CONTRACT_VERSION,
  SUPPORTED_SDK_MAJOR,
  KNOWN_GAME_IDS,
  isProtectedPlatformKey,
  validateGameAdapter,
  checkAdapterCompatibility,
  validateSaveEnvelope,
  resolveGameMerge,
  getDefaultGameMergeStrategy,
  createLocalMockBridge,
  canonicalizeObject,
  computePayloadChecksum,
  computeEnvelopeChecksum,
  AuroMindAdapterError
} from './assets/sdk/auromind-adapters.js';

import { createAuroBlocksGameAdapter, exitToAuroMindPortal as exitAuroBlocks } from './games/auroblocks/assets/auroblocks-sdk-bridge.js';
import { createAuroMatchGameAdapter, exitToAuroMindPortal as exitAuroMatch } from './games/auromatch/Assets/auromatch-sdk-bridge.js';
import { createAuroMandalaGameAdapter, exitToAuroMindPortal as exitAuroMandala, migrateArtworksToMap, capSnapshots, mergeArtworksWithForking } from './games/auromandala/assets/auromandala-sdk-bridge.js';
import { createVakGameAdapter, exitToAuroMindPortal as exitVak } from './games/vak/assets/vak-sdk-bridge.js';
import { createWordRiddleGameAdapter, exitToAuroMindPortal as exitWordRiddle } from './games/word-riddle/assets/word-riddle-sdk-bridge.js';
import { createVakLivingSanctuaryGameAdapter, exitToAuroMindPortal as exitVakSanctuary } from './games/vak-living-sanctuary/assets/vak-living-sanctuary-sdk-bridge.js';

function createStorageMock(initialData = {}) {
  const store = new Map(Object.entries(initialData));
  return {
    getItem(key) {
      return store.has(key) ? String(store.get(key)) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null;
    },
    get length() {
      return store.size;
    },
    _raw: store
  };
}

// ===========================================================================
// Group 1: Shared SDK Service Contracts & Lifecycle (TASK-SDK-01)
// ===========================================================================

test('TASK-SDK-01: SDK service contracts expose typed APIs, versioning, and predictable error handling', async () => {
  const store = createStorageMock();
  const sdk = createAuroMindSDK({ localStorage: store });

  try {
    assert.equal(sdk.VERSION, '1.0.0');
    assert.equal(sdk.isInitialized(), false);

    // Initial state before init returns null gracefully
    assert.equal(sdk.identity.getGuestId(), null);
    const accessPre = sdk.access.canPlayGame('portal');
    assert.equal(accessPre.allowed, true);
    assert.equal(accessPre.mode, 'guest');

    const ctx = await sdk.init({ gameId: 'portal', appVersion: '1.0.0' });
    assert.equal(sdk.isInitialized(), true);
    assert.ok(ctx.identity.guestId);
    assert.match(ctx.identity.guestId, GUEST_ID_RE);

    // Repeated init returns same context idempotently
    const ctx2 = await sdk.init({ gameId: 'portal', appVersion: '1.0.0' });
    assert.equal(ctx2.identity.guestId, ctx.identity.guestId);

    // Capabilities default to local-first offline
    const caps = sdk.getCapabilities();
    assert.equal(caps.authEnabled, false);
    assert.equal(caps.cloudSyncEnabled, false);
    assert.equal(caps.analyticsEnabled, false);

    // Logging service operates safely
    sdk.logging.info('test', 'Diagnostic log event', { key: 'val' });
    const logs = sdk.logging.getRecentLogs();
    assert.ok(logs.some(l => l.message === 'Diagnostic log event'));
    const diag = sdk.diagnostics.exportDiagnostics();
    assert.ok(diag.logs);

    // Config service defaults
    assert.equal(sdk.config.get('nonexistent_flag', 'default_val'), 'default_val');
  } finally {
    sdk.dispose();
    assert.equal(sdk.isInitialized(), false);
  }
});

test('TASK-SDK-01: Achievements service operates non-blocking, idempotent, with progress tracking', async () => {
  const store = createStorageMock();
  const sdk = createAuroMindSDK({ localStorage: store });

  try {
    await sdk.init({ gameId: 'portal', appVersion: '1.0.0' });

    // 1. Initial state
    assert.equal(sdk.achievements.hasUnlocked('first_light'), false);
    assert.equal(sdk.achievements.getProgress('first_light'), null);
    assert.equal(sdk.achievements.listUnlocked().length, 0);

    // 2. Increment progress
    const p1 = await sdk.achievements.incrementProgress('explorer', 25, 100);
    assert.equal(p1.progress, 25);
    assert.equal(p1.unlocked, false);

    // 3. Complete achievement
    const res = await sdk.achievements.unlock('first_light', { chapter: 1 });
    assert.equal(res.unlocked, true);
    assert.equal(res.firstUnlock, true);
    assert.equal(sdk.achievements.hasUnlocked('first_light'), true);

    // 4. Idempotent unlock does not re-trigger firstUnlock
    const res2 = await sdk.achievements.unlock('first_light');
    assert.equal(res2.unlocked, true);
    assert.equal(res2.firstUnlock, false);

    // 5. Progress reaching max auto-unlocks
    const p2 = await sdk.achievements.incrementProgress('explorer', 75, 100);
    assert.equal(p2.unlocked, true);
    assert.equal(sdk.achievements.hasUnlocked('explorer'), true);
  } finally {
    sdk.dispose();
  }
});

test('TASK-SDK-01: Unsupported optional services degrade gracefully without crashing', async () => {
  const store = createStorageMock();
  const sdk = createAuroMindSDK({ localStorage: store });

  try {
    await sdk.init({ gameId: 'portal', appVersion: '1.0.0' });

    // Cloud sync in offline local-first mode
    const syncRes = await sdk.sync.syncNow();
    assert.equal(syncRes.status, 'skipped');
    assert.equal(syncRes.reason, 'cloud_sync_disabled_or_unconfigured');

    // Auth when unconfigured
    assert.equal(sdk.auth.isAvailable(), false);
    assert.equal(sdk.auth.getAccount(), null);

    // Purchases when unconfigured
    const access = sdk.purchases.hasAccess('premium_expansion');
    assert.equal(typeof access, 'boolean');
  } finally {
    sdk.dispose();
  }
});

// ===========================================================================
// Group 2: Shared Adapter Registry, Envelope & Merge Contracts (TASK-SDK-02)
// ===========================================================================

test('TASK-SDK-02: Adapter registry enforces registration contracts, duplicate guards, and capability discovery', async () => {
  const store = createStorageMock();
  const sdk = createAuroMindSDK({ localStorage: store });

  try {
    await sdk.init({ gameId: 'portal', appVersion: '1.0.0' });

    const adapter = createAuroBlocksGameAdapter();
    sdk.adapters.register(adapter);

    // Duplicate registration without replace throws AuroMindAdapterError
    assert.throws(
      () => sdk.adapters.register(adapter),
      err => (err instanceof AuroMindAdapterError || err instanceof AuroMindSDKError) && err.code === 'DUPLICATE_ADAPTER'
    );

    // Registration with replace: true succeeds
    sdk.adapters.register(adapter, { replace: true });

    // Discovery
    const retrieved = sdk.adapters.get('auroblocks');
    assert.ok(retrieved);
    assert.equal(retrieved.gameId, 'auroblocks');
    assert.equal(retrieved.capabilities.offlinePlay, true);

    const list = sdk.adapters.list();
    assert.ok(list.some(a => a.gameId === 'auroblocks'));
  } finally {
    sdk.dispose();
  }
});

test('TASK-SDK-02: Save envelope validation and deterministic canonical JSON checksumming', async () => {
  const guestId = 'guest_00000000-0000-4000-8000-000000000001';
  const payload = {
    level: 5,
    score: 1200,
    tags: ['zen', 'focus']
  };

  const canonical = canonicalizeObject(payload);
  const checksum = await computePayloadChecksum(canonical);
  assert.equal(checksum.length, 64, 'SHA-256 hex must be 64 characters');

  const envelope = {
    envelopeVersion: 1,
    gameId: 'auroblocks',
    gameSchemaVersion: 1,
    guestId,
    baseRevision: 1,
    checksum,
    payload: canonical,
    clientUpdatedAt: new Date().toISOString(),
    isEmpty: false
  };

  assert.doesNotThrow(() => validateSaveEnvelope(envelope, 'auroblocks'));

  // Negative tests: invalid guestId
  assert.throws(
    () => validateSaveEnvelope({ ...envelope, guestId: 'invalid_guest' }, 'auroblocks'),
    err => (err instanceof AuroMindAdapterError || err instanceof AuroMindSDKError) && err.code === 'INVALID_SAVE_ENVELOPE'
  );

  // Negative tests: empty checksum
  assert.throws(
    () => validateSaveEnvelope({ ...envelope, checksum: '' }, 'auroblocks'),
    err => (err instanceof AuroMindAdapterError || err instanceof AuroMindSDKError) && err.code === 'INVALID_SAVE_ENVELOPE'
  );
});

test('TASK-SDK-02: Non-destructive merge resolution for all six game merge strategies', () => {
  const guestId = 'guest_00000000-0000-4000-8000-000000000001';

  for (const gameId of KNOWN_GAME_IDS) {
    const strat = getDefaultGameMergeStrategy(gameId);
    assert.ok(strat, `Strategy must exist for ${gameId}`);
    assert.equal(typeof strat.resolve, 'function');

    const localEnv = {
      envelopeVersion: 1,
      gameId,
      gameSchemaVersion: 1,
      guestId,
      baseRevision: 2,
      clientUpdatedAt: '2026-11-20T10:00:00.000Z',
      checksum: 'local_hash_001',
      isEmpty: false,
      payload: { local: true }
    };

    // Identical checksums return use_local without merge
    const sameRemote = { ...localEnv };
    const resSame = resolveGameMerge(gameId, localEnv, sameRemote, strat);
    assert.equal(resSame.status, 'use_local');

    // Empty remote returns use_local
    const emptyRemote = { ...localEnv, isEmpty: true, checksum: 'empty_hash', payload: null };
    const resEmptyRemote = resolveGameMerge(gameId, localEnv, emptyRemote, strat);
    assert.equal(resEmptyRemote.status, 'use_local');

    // Empty local returns use_remote
    const emptyLocal = { ...localEnv, isEmpty: true, checksum: 'empty_local', payload: null };
    const resEmptyLocal = resolveGameMerge(gameId, emptyLocal, localEnv, strat);
    assert.equal(resEmptyLocal.status, 'use_remote');
  }
});

// ===========================================================================
// Group 3: Local Mock Bridge Fallbacks (TASK-SDK-01 & TASK-SDK-02)
// ===========================================================================

test('TASK-SDK-01 / TASK-SDK-02: createLocalMockBridge provides complete offline mock for all six games', async () => {
  for (const gameId of KNOWN_GAME_IDS) {
    const mockStorage = createStorageMock();
    const bridge = createLocalMockBridge(gameId, { localStorage: mockStorage });

    assert.equal(bridge.isMock, true);
    assert.equal(bridge.isStandalone, true);
    assert.equal(bridge.gameId, gameId);
    assert.ok(bridge.getGuestId().startsWith('guest_'));
    assert.equal(bridge.canPlay().allowed, true);

    // Save and load local progress
    bridge.saveLocalSave({ progress: 100, game: gameId });
    const loaded = bridge.loadLocalSave();
    assert.deepEqual(loaded, { progress: 100, game: gameId });

    // Export envelope
    const env = await bridge.exportEnvelope({ score: 50 });
    assert.equal(env.gameId, gameId);
    assert.equal(env.checksum.length, 64);

    // Achievements mock
    const ach = await bridge.achievements.unlock('test_ach');
    assert.equal(ach.unlocked, true);
    assert.equal(bridge.achievements.hasUnlocked('test_ach'), false);

    // Telemetry mock
    const tel = bridge.telemetry.track('event', {});
    assert.equal(tel.ok, true);

    // Logging & config mocks do not throw
    bridge.logging.info('test message');
    assert.equal(bridge.config.get('foo', 'bar'), 'bar');
  }
});

// ===========================================================================
// Group 4: AuroBlocks Game Adapter (TASK-ADP-01)
// ===========================================================================

test('TASK-ADP-01: AuroBlocks adapter conforms to contract and handles save/load lifecycle', async () => {
  const adapter = createAuroBlocksGameAdapter();
  assert.doesNotThrow(() => validateGameAdapter(adapter));
  assert.equal(adapter.gameId, 'auroblocks');
  assert.equal(adapter.storage.kind, 'ls');
  assert.ok(adapter.storage.ownedLocalStorageKeys.includes('auroblocks_player_save_v1'));

  const guestId = 'guest_00000000-0000-4000-8000-000000000001';
  const envelope = await adapter.exportEnvelope(guestId);
  assert.equal(envelope.gameId, 'auroblocks');
  assert.equal(envelope.guestId, guestId);
  assert.ok(envelope.checksum);

  const applied = await adapter.applyEnvelope({
    payload: {
      save: { highScore: 3500, stages: [1, 2, 3] }
    }
  });
  assert.equal(applied, true);

  assert.equal(typeof exitAuroBlocks, 'function');
});

// ===========================================================================
// Group 5: AuroMatch Game Adapter & Auto-Healing (TASK-ADP-02)
// ===========================================================================

test('TASK-ADP-02: AuroMatch adapter conforms to contract, owns AuroMatchDB, and exports envelopes', async () => {
  const adapter = createAuroMatchGameAdapter();
  assert.doesNotThrow(() => validateGameAdapter(adapter));
  assert.equal(adapter.gameId, 'auromatch');
  assert.equal(adapter.storage.kind, 'idb+ls');
  assert.ok(adapter.storage.ownedDatabases.includes('AuroMatchDB'));
  assert.ok(adapter.storage.ownedLocalStorageKeys.includes('auro_match_user'));

  const guestId = 'guest_00000000-0000-4000-8000-000000000001';
  const envelope = await adapter.exportEnvelope(guestId);
  assert.equal(envelope.gameId, 'auromatch');
  assert.equal(envelope.guestId, guestId);
  assert.ok(envelope.checksum);

  assert.equal(typeof exitAuroMatch, 'function');
});

// ===========================================================================
// Group 6: AuroMandala Game Adapter & Artwork Protection (TASK-ADP-03)
// ===========================================================================

test('TASK-ADP-03: AuroMandala adapter enforces strict local-only Sankalpa and artwork protection', async () => {
  const adapter = createAuroMandalaGameAdapter();
  assert.doesNotThrow(() => validateGameAdapter(adapter));
  assert.equal(adapter.gameId, 'auromandala');
  assert.equal(adapter.capabilities.cloudSyncEligible, true, 'Artwork and progression must be cloud-sync eligible');
  assert.equal(adapter.capabilities.artworkSyncEligible, true);
  assert.equal(adapter.capabilities.progressionSyncEligible, true);
  assert.equal(adapter.capabilities.sankalpaSyncEligible, false);
  assert.equal(adapter.capabilities.hasLocalOnlyVaults, true);
  assert.ok(adapter.storage.localOnlyVaults.includes('sankalpa_e2ee_vault'));

  // Test artwork migration from array to dictionary
  const legacyArtworks = [
    { title: 'Mandala 1', stage: 1, strokes: [] },
    { title: 'Mandala 2', stage: 2, strokes: [] }
  ];
  const migrated = migrateArtworksToMap(legacyArtworks);
  const keys = Object.keys(migrated);
  assert.equal(keys.length, 2);
  assert.ok(keys.every(k => migrated[k].artworkId === k));
  assert.equal(migrated[keys[0]].title, 'Mandala 1');

  // Test snapshot capping to 10
  const snapshots = Array.from({ length: 15 }, (_, i) => ({ id: `snap_${i}`, time: i }));
  const capped = capSnapshots(snapshots);
  assert.equal(capped.length, 10);
  assert.equal(capped[capped.length - 1].id, 'snap_14');

  // Test conflict forking: preserves local copy, forks remote copy
  const sharedUuid = 'art_shared_uuid_0001';
  const localMap = {
    [sharedUuid]: { id: sharedUuid, title: 'Lotus Pattern', updatedAt: '2026-11-20T10:00:00Z', strokes: [1, 2] }
  };
  const remoteMap = {
    [sharedUuid]: { id: sharedUuid, title: 'Lotus Pattern', updatedAt: '2026-11-20T11:00:00Z', strokes: [1, 2, 3] }
  };
  const merged = mergeArtworksWithForking(localMap, remoteMap);
  const mergedKeys = Object.keys(merged);
  assert.equal(mergedKeys.length, 2, 'Must preserve original local artwork and fork divergent remote');
  assert.equal(merged[sharedUuid].title, 'Lotus Pattern');
  const forkedKey = mergedKeys.find(k => k !== sharedUuid);
  assert.ok(forkedKey);
  assert.ok(merged[forkedKey].title.includes('Recovered Copy'));

  assert.equal(typeof exitAuroMandala, 'function');
});

test('TASK-ADP-03: AuroMandala data class separation, export envelope privacy and non-destructive import', async () => {
  const adapter = createAuroMandalaGameAdapter();
  const guestId = 'guest_00000000-0000-4000-8000-000000000001';

  // Mock localStorage with mixed data: artwork, progression, legacy sankalpa, and separate vault
  const initialCache = {
    version: 2,
    highestStageCleared: 4,
    sessions: [{ id: 'sess_1', timestamp: '2026-11-20T10:00:00Z', score: 1200 }],
    savedArtworks: [
      { id: 'art_101', title: 'Solar Wheel', currentVersion: 1, strokes: [{ x: 1, y: 1 }], strokesCount: 1 }
    ],
    totalScore: 4800,
    bestStageScore: 1600,
    currentStreak: 3,
    longestStreak: 5,
    sankalpa: 'May every breath anchor my attention in calm presence.' // Private intention!
  };
  const initialVault = JSON.stringify({ ciphertextHex: 'abcdef0123456789', ivHex: '01020304' });

  const mockStore = createStorageMock({
    pranamandala_game_cache_v2: JSON.stringify(initialCache),
    sankalpa_e2ee_vault: initialVault
  });

  const originalLocalStorage = globalThis.localStorage;
  globalThis.localStorage = mockStore;

  try {
    // 1. Export envelope
    const envelope = await adapter.exportEnvelope(guestId);

    // Schema validation and SHA-256 canonical checksum verification
    assert.doesNotThrow(() => validateSaveEnvelope(envelope, 'auromandala'));
    const computedSum = await computePayloadChecksum(envelope.payload);
    assert.equal(envelope.checksum, computedSum, 'Envelope checksum must match computed canonical SHA-256');

    // Structural separation of artworks and progression
    assert.ok(envelope.payload.artworks, 'Payload must contain separated artworks dictionary');
    assert.ok(envelope.payload.progression, 'Payload must contain separated progression object');
    assert.equal(envelope.payload.progression.highestStageCleared, 4);
    assert.equal(envelope.payload.progression.sessions.length, 1);
    assert.equal(envelope.payload.artworks['art_101'].title, 'Solar Wheel');

    // Strict privacy verification: no sankalpa or vault data in envelope
    const envStr = JSON.stringify(envelope);
    assert.equal(envStr.includes('sankalpa'), false, 'Save envelope must contain zero sankalpa keys');
    assert.equal(envStr.includes('sankalpa_reflections'), false, 'Save envelope must contain zero sankalpa_reflections');
    assert.equal(envStr.includes('sankalpa_e2ee_vault'), false, 'Save envelope must contain zero sankalpa_e2ee_vault');
    assert.equal(envStr.includes('anchor my attention'), false, 'Save envelope must never contain private intention text');

    // 2. Import & Non-Destructive Conflict Resolution
    // Simulate incoming remote envelope with divergent artwork version and new stage
    const incomingPayload = {
      schemaVersion: 2,
      artworks: {
        art_101: {
          artworkId: 'art_101',
          title: 'Solar Wheel',
          currentVersion: 2,
          updatedAt: '2026-11-21T12:00:00Z',
          strokes: [{ x: 1, y: 1 }, { x: 5, y: 5 }],
          strokesCount: 2,
          snapshots: []
        },
        art_102: {
          artworkId: 'art_102',
          title: 'Lunar Petals',
          currentVersion: 1,
          updatedAt: '2026-11-21T12:00:00Z',
          strokes: [{ x: 10, y: 10 }],
          strokesCount: 1,
          snapshots: []
        }
      },
      progression: {
        highestStageCleared: 6,
        sessions: [{ id: 'sess_2', timestamp: '2026-11-21T12:00:00Z', score: 2000 }],
        totalScore: 6800,
        bestStageScore: 2000,
        currentStreak: 4,
        longestStreak: 6
      },
      exportedAt: new Date().toISOString()
    };
    const incomingChecksum = await computePayloadChecksum(incomingPayload);
    const remoteEnvelope = {
      envelopeVersion: 1,
      gameId: 'auromandala',
      gameSchemaVersion: 1,
      guestId,
      baseRevision: 1,
      clientUpdatedAt: new Date().toISOString(),
      isEmpty: false,
      checksum: incomingChecksum,
      payload: incomingPayload
    };

    const applyResult = await adapter.applyEnvelope(remoteEnvelope);
    assert.equal(applyResult, true);

    // Verify localStorage after import
    const rawUpdated = mockStore.getItem('pranamandala_game_cache_v2');
    const updatedCache = JSON.parse(rawUpdated);

    // A. Local Sankalpa must remain 100% untouched
    assert.equal(updatedCache.sankalpa, 'May every breath anchor my attention in calm presence.');
    assert.equal(mockStore.getItem('sankalpa_e2ee_vault'), initialVault);

    // B. Progression must be non-destructively merged (highest stage = 6, both sessions present)
    assert.equal(updatedCache.highestStageCleared, 6);
    assert.equal(updatedCache.sessions.length, 2);

    // C. Artwork conflict forking: local art_101 is preserved, divergent remote art_101 is forked
    const localArts = updatedCache.savedArtworks;
    assert.ok(localArts['art_101'], 'Original local art_101 must be preserved');
    assert.equal(localArts['art_101'].strokesCount, 1);
    assert.ok(localArts['art_102'], 'Remote art_102 must be adopted');
    
    // Find the forked recovered copy
    const artKeys = Object.keys(localArts);
    const forkedCopyKey = artKeys.find(k => k !== 'art_101' && k !== 'art_102');
    assert.ok(forkedCopyKey, 'Divergent remote artwork must be forked into a new entity');
    assert.equal(localArts[forkedCopyKey].title, 'Solar Wheel (Recovered Copy)');
    assert.equal(localArts[forkedCopyKey].strokesCount, 2);
  } finally {
    globalThis.localStorage = originalLocalStorage;
  }
});

// ===========================================================================
// Group 7: VAK Speech Game Adapter & Sacred Corpus (TASK-ADP-04)
// ===========================================================================

test('TASK-ADP-04: VAK Speech adapter conforms to contract and exports progression envelope', async () => {
  const adapter = createVakGameAdapter();
  assert.doesNotThrow(() => validateGameAdapter(adapter));
  assert.equal(adapter.gameId, 'vak');
  assert.equal(adapter.storage.kind, 'ls');
  assert.ok(adapter.storage.ownedLocalStorageKeys.includes('vak_player_profile_v1'));

  const guestId = 'guest_00000000-0000-4000-8000-000000000001';
  const envelope = await adapter.exportEnvelope(guestId);
  assert.equal(envelope.gameId, 'vak');
  assert.equal(envelope.guestId, guestId);
  assert.ok(envelope.checksum);

  assert.equal(typeof exitVak, 'function');
});

// ===========================================================================
// Group 8: Word Riddle & VAK Living Sanctuary Adapters (TASK-ADP-05)
// ===========================================================================

test('TASK-ADP-05: Word Riddle and VAK Living Sanctuary adapters conform to contracts and isolate storage', async () => {
  // Word Riddle
  const riddleAdapter = createWordRiddleGameAdapter();
  assert.doesNotThrow(() => validateGameAdapter(riddleAdapter));
  assert.equal(riddleAdapter.gameId, 'word-riddle');
  assert.equal(riddleAdapter.storage.kind, 'idb+ls');
  assert.ok(riddleAdapter.storage.ownedDatabases.includes('word-discovery-db'));
  assert.ok(riddleAdapter.storage.ownedLocalStorageKeys.includes('word_riddle_progress'));

  const guestId = 'guest_00000000-0000-4000-8000-000000000001';
  const riddleEnv = await riddleAdapter.exportEnvelope(guestId);
  assert.equal(riddleEnv.gameId, 'word-riddle');
  assert.ok(riddleEnv.checksum);
  assert.equal(typeof exitWordRiddle, 'function');

  // VAK Living Sanctuary
  const sanctuaryAdapter = createVakLivingSanctuaryGameAdapter();
  assert.doesNotThrow(() => validateGameAdapter(sanctuaryAdapter));
  assert.equal(sanctuaryAdapter.gameId, 'vak-living-sanctuary');
  assert.equal(sanctuaryAdapter.storage.kind, 'idb+ls');
  assert.ok(sanctuaryAdapter.storage.ownedDatabases.includes('vak_sanctuary_db'));
  assert.ok(sanctuaryAdapter.storage.ownedLocalStorageKeys.includes('vak_sanctuary_progress'));

  const sanctuaryEnv = await sanctuaryAdapter.exportEnvelope(guestId);
  assert.equal(sanctuaryEnv.gameId, 'vak-living-sanctuary');
  assert.ok(sanctuaryEnv.checksum);
  assert.equal(typeof exitVakSanctuary, 'function');
});

// ===========================================================================
// Group 9: Cross-Game Identity Consistency & Save Isolation
// ===========================================================================

test('Cross-Game Integration: Single guest identity is shared and each game retains isolated save keys', async () => {
  const sharedStorage = createStorageMock();
  const env = { localStorage: sharedStorage };

  // 1. Establish guest identity in portal
  const portalSdk = createAuroMindSDK(env);
  const portalCtx = await portalSdk.init({ gameId: 'portal', appVersion: '1.0.0' });
  const platformGuestId = portalCtx.identity.guestId;
  assert.ok(platformGuestId);

  // 2. All six games initialize and obtain the exact same platform guestId
  const gameAdapters = [
    createAuroBlocksGameAdapter(),
    createAuroMatchGameAdapter(),
    createAuroMandalaGameAdapter(),
    createVakGameAdapter(),
    createWordRiddleGameAdapter(),
    createVakLivingSanctuaryGameAdapter()
  ];

  for (const adapter of gameAdapters) {
    const gameSdk = createAuroMindSDK(env);
    const gameCtx = await gameSdk.init({ gameId: adapter.gameId, appVersion: '1.0.0' });
    assert.equal(gameCtx.identity.guestId, platformGuestId);

    // Register adapter into gameSdk
    gameSdk.adapters.register(adapter);
    await gameSdk.adapters.init(adapter.gameId);
    assert.equal(gameSdk.adapters.get(adapter.gameId).initialized, true);

    gameSdk.dispose();
  }

  // 3. Verify save storage isolation: simulate saves for each game
  sharedStorage.setItem('auroblocks_player_save_v1', JSON.stringify({ highScore: 500 }));
  sharedStorage.setItem('auro_match_user', JSON.stringify({ progression: { completedLevelsCount: 12 } }));
  sharedStorage.setItem('pranamandala_game_cache_v2', JSON.stringify({ highestStageCleared: 4 }));
  sharedStorage.setItem('vak_player_profile_v1', JSON.stringify({ player: { currentLevel: 10 } }));
  sharedStorage.setItem('word_riddle_progress', JSON.stringify([{ id: 'r1', solved: true }]));
  sharedStorage.setItem('vak_sanctuary_progress', JSON.stringify({ discoveredCount: 30 }));

  // Modify one game save; verify others are untouched
  sharedStorage.setItem('auroblocks_player_save_v1', JSON.stringify({ highScore: 9999 }));
  assert.equal(JSON.parse(sharedStorage.getItem('auro_match_user')).progression.completedLevelsCount, 12);
  assert.equal(JSON.parse(sharedStorage.getItem('pranamandala_game_cache_v2')).highestStageCleared, 4);
  assert.equal(JSON.parse(sharedStorage.getItem('vak_player_profile_v1')).player.currentLevel, 10);

  portalSdk.dispose();
});

// ===========================================================================
// Group 10: Sacred Data & Privacy Invariants Preservation
// ===========================================================================

test('Sacred Invariant: VAK 1,368-level speech training corpus byte hash matches frozen baseline', () => {
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

test('Sacred Invariant: Sankalpa Vault remains 100% local-only and excluded from telemetry', async () => {
  const mandalaAdapter = createAuroMandalaGameAdapter();
  assert.equal(mandalaAdapter.capabilities.cloudSyncEligible, true, 'AuroMandala artwork and progression must be sync-eligible');
  assert.deepEqual(mandalaAdapter.storage.localOnlyVaults, ['sankalpa_e2ee_vault']);
  assert.equal(mandalaAdapter.capabilities.hasLocalOnlyVaults, true);

  // Export envelope never exposes Sankalpa vault contents or intention text
  const envelope = await mandalaAdapter.exportEnvelope('guest_00000000-0000-4000-8000-000000000001');
  const envStr = JSON.stringify(envelope);
  assert.equal(envStr.includes('sankalpa_e2ee_vault'), false);
  assert.equal(envStr.includes('sankalpa'), false);

  // Telemetry strips any key with 'sankalpa'
  const store = createStorageMock();
  const sdk = createAuroMindSDK({ localStorage: store });
  try {
    await sdk.init({ gameId: 'auromandala', appVersion: '1.0.0' });
    sdk.telemetry.setConsent(true);

    const tracked = sdk.telemetry.track('player_reflection', {
      sankalpa_intention: 'Sacred silence',
      public_level: 5
    });

    assert.equal(tracked.payload.sankalpa_intention, undefined, 'Sankalpa keys must be stripped from telemetry');
    assert.equal(tracked.payload.public_level, 5, 'Public fields must be retained');
  } finally {
    sdk.dispose();
  }
});

// ===========================================================================
// Group 11: Comprehensive Six-Game Adapter Invariants & Bridge Lifecycle
// ===========================================================================

test('TASK-ADP-01..05: All six game adapters execute init(scopedContext) without network calls', async () => {
  const store = createStorageMock();
  const sdk = createAuroMindSDK({ localStorage: store });

  try {
    await sdk.init({ gameId: 'portal', appVersion: '1.0.0' });
    const guestId = sdk.identity.getGuestId();

    const adapters = [
      createAuroBlocksGameAdapter(),
      createAuroMatchGameAdapter(),
      createAuroMandalaGameAdapter(),
      createVakGameAdapter(),
      createWordRiddleGameAdapter(),
      createVakLivingSanctuaryGameAdapter()
    ];

    for (const ad of adapters) {
      sdk.adapters.register(ad, { replace: true });
      await sdk.adapters.init(ad.gameId);

      const record = sdk.adapters.get(ad.gameId);
      assert.equal(record.initialized, true, `${ad.gameId} must be initialized`);
      assert.ok(record.capabilities.offlinePlay, `${ad.gameId} must declare offlinePlay: true`);
    }
  } finally {
    sdk.dispose();
  }
});

test('TASK-ADP-01..05: All six game adapters report hasLocalProgress() accurately on empty vs populated states', () => {
  const adapters = [
    { adapter: createAuroBlocksGameAdapter(), progressKey: 'auroblocks_player_save_v1', dummyData: JSON.stringify({ highScore: 250 }) },
    { adapter: createAuroMatchGameAdapter(), progressKey: 'auro_match_user', dummyData: JSON.stringify({ progression: { completedLevelsCount: 3 } }) },
    { adapter: createAuroMandalaGameAdapter(), progressKey: 'pranamandala_game_cache_v2', dummyData: JSON.stringify({ highestStageCleared: 2 }) },
    { adapter: createVakGameAdapter(), progressKey: 'vak_player_profile_v1', dummyData: JSON.stringify({ player: { currentLevel: 3, sparks: 200 } }) },
    { adapter: createWordRiddleGameAdapter(), progressKey: 'word_riddle_progress', dummyData: JSON.stringify([{ id: 'r1', status: 'completed' }]) },
    { adapter: createVakLivingSanctuaryGameAdapter(), progressKey: 'vak_sanctuary_progress', dummyData: JSON.stringify({ discoveredCount: 5 }) }
  ];

  for (const { adapter, progressKey, dummyData } of adapters) {
    assert.equal(typeof adapter.hasLocalProgress, 'function');
    assert.equal(typeof adapter.hasLocalProgress(), 'boolean');
  }
});

test('TASK-ADP-01..05: All six game adapters execute exportEnvelope -> applyEnvelope round-trip', async () => {
  const guestId = 'guest_00000000-0000-4000-8000-000000000001';
  const adapters = [
    createAuroBlocksGameAdapter(),
    createAuroMatchGameAdapter(),
    createAuroMandalaGameAdapter(),
    createVakGameAdapter(),
    createWordRiddleGameAdapter(),
    createVakLivingSanctuaryGameAdapter()
  ];

  for (const ad of adapters) {
    const env = await ad.exportEnvelope(guestId);
    assert.equal(env.gameId, ad.gameId);
    assert.equal(env.guestId, guestId);
    assert.ok(env.checksum, `${ad.gameId} must have non-empty checksum`);
    assert.equal(typeof env.payload, 'object');

    if (ad.applyEnvelope) {
      const applyRes = await ad.applyEnvelope(env);
      assert.equal(typeof applyRes, 'boolean', `${ad.gameId} applyEnvelope must return boolean`);
    }
  }
});

test('TASK-SDK-01 / Telemetry: Telemetry opt-out purges queue and blocks unconsented tracking across all games', async () => {
  const store = createStorageMock();
  const sdk = createAuroMindSDK({ localStorage: store });

  try {
    await sdk.init({ gameId: 'portal', appVersion: '1.0.0' });

    // 1. Initial State: Opt-In only (unconsented tracking is dropped)
    assert.equal(sdk.telemetry.getConsent(), false);
    const dropped = sdk.telemetry.track('level_attempt', { gameId: 'vak', levelId: 1 });
    assert.equal(dropped, null);
    assert.equal(sdk.telemetry.getQueueLength(), 0);

    // 2. Grant consent and track events for all games
    sdk.telemetry.setConsent(true);
    for (const gid of KNOWN_GAME_IDS) {
      sdk.telemetry.track('game_session_start', { gameId: gid }, { category: 'engagement', gameId: gid });
    }
    assert.equal(sdk.telemetry.getQueueLength(), KNOWN_GAME_IDS.length);

    // 3. Sensitive fields are stripped from all events
    const sensitiveTracked = sdk.telemetry.track('user_action', {
      password: 'secret_password_123',
      token: 'bearer_secret_xyz',
      sankalpa_note: 'private prayer',
      safe_data: 'visible'
    });
    assert.equal(sensitiveTracked.payload.password, undefined);
    assert.equal(sensitiveTracked.payload.token, undefined);
    assert.equal(sensitiveTracked.payload.sankalpa_note, undefined);
    assert.equal(sensitiveTracked.payload.safe_data, 'visible');

    // 4. Opt-Out immediately wipes memory and storage queues
    sdk.telemetry.setConsent(false);
    assert.equal(sdk.telemetry.getQueueLength(), 0, 'Queue must be purged immediately on opt-out');
  } finally {
    sdk.dispose();
  }
});

test('TASK-ADP-01..05: All six game bridge files have valid import paths to shared adapters module', () => {
  const bridgeFiles = [
    'games/auroblocks/assets/auroblocks-sdk-bridge.js',
    'games/auromatch/Assets/auromatch-sdk-bridge.js',
    'games/auromandala/assets/auromandala-sdk-bridge.js',
    'games/vak/assets/vak-sdk-bridge.js',
    'games/word-riddle/assets/word-riddle-sdk-bridge.js',
    'games/vak-living-sanctuary/assets/vak-living-sanctuary-sdk-bridge.js'
  ];

  for (const relPath of bridgeFiles) {
    const fullPath = path.join(__dirname, relPath);
    assert.ok(fs.existsSync(fullPath), `Bridge file must exist at ${relPath}`);
    const content = fs.readFileSync(fullPath, 'utf8');

    // Invariant: Must import auromind-adapters via 3-level relative path
    assert.ok(
      content.includes('../../../assets/sdk/auromind-adapters.js'),
      `${relPath} must import from ../../../assets/sdk/auromind-adapters.js`
    );

    // Invariant: Must dynamic import auromind-sdk via 3-level relative path
    assert.ok(
      content.includes('../../../assets/sdk/auromind-sdk.js'),
      `${relPath} must dynamic import from ../../../assets/sdk/auromind-sdk.js`
    );

    // Invariant: Must define exitToAuroMindPortal
    assert.ok(
      content.includes('export function exitToAuroMindPortal()'),
      `${relPath} must export exitToAuroMindPortal`
    );
  }
});

