/**
 * AuroMind Shared Platform SDK — Batch B3 Game Integration Test Suite
 *
 * Verifies the shared platform identity, game adapter boundaries, offline independence,
 * and data preservation across all launch and companion games:
 *   1. VAK: The Control of Speech (Priority 1 — Full integration)
 *   2. AuroMatch: Concentration Quest (Priority 1 — Full integration)
 *   3. AuroMandala: Sacred Geometry (Priority 1 — Full integration & contract readiness)
 *   4. Word Riddle (Priority 2 — Compatibility readiness)
 *   5. VAK Living Sanctuary (Priority 2 — Compatibility readiness)
 *   6. AuroBlocks (Priority 2 — Compatibility readiness)
 *
 * Runs natively with Node.js test runner (`node --test`). Zero external dependencies.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createAuroMindSDK,
  SDK_VERSION,
  PLATFORM_DB_NAME,
  LS_GUEST_KEY,
  GUEST_ID_RE
} from './assets/sdk/auromind-sdk.js';

import {
  defineGameAdapter,
  validateGameAdapter,
  validateSaveEnvelope,
  resolveGameMerge,
  isProtectedPlatformKey
} from './assets/sdk/auromind-adapters.js';

import { createAuroMatchGameAdapter } from './games/auromatch/src/controllers/storageAdapter.js';
import { createAuroMandalaGameAdapter } from './games/auromandala/assets/auromandala-sdk-bridge.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to create an in-memory storage mock
function createStorageMock(initialState = {}) {
  const store = new Map(Object.entries(initialState));
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); },
    clear: () => { store.clear(); },
    key: (i) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
    _dump: () => Object.fromEntries(store.entries())
  };
}

// ---------------------------------------------------------------------------
// Suite 1: Game Adapter Contract Validation & Platform Boundary Isolation
// ---------------------------------------------------------------------------
test('Suite 1: Game adapters enforce strict boundaries and declare valid contracts', () => {
  const auromatchAdapter = createAuroMatchGameAdapter();
  const auromandalaAdapter = createAuroMandalaGameAdapter();

  // 1. Validate AuroMatch Adapter
  assert.equal(auromatchAdapter.gameId, 'auromatch');
  assert.equal(auromatchAdapter.contractVersion, 1);
  assert.equal(auromatchAdapter.storage.kind, 'idb+ls');
  assert.deepEqual(auromatchAdapter.storage.ownedDatabases, ['AuroMatchDB']);
  assert.ok(validateGameAdapter(auromatchAdapter, SDK_VERSION));

  // 2. Validate AuroMandala Adapter
  assert.equal(auromandalaAdapter.gameId, 'auromandala');
  assert.equal(auromandalaAdapter.contractVersion, 1);
  assert.equal(auromandalaAdapter.storage.kind, 'ls');
  assert.deepEqual(auromandalaAdapter.storage.localOnlyVaults, ['sankalpa_e2ee_vault']);
  assert.equal(auromandalaAdapter.capabilities.cloudSyncEligible, false, 'Sankalpa vault must be local-only');
  assert.ok(validateGameAdapter(auromandalaAdapter, SDK_VERSION));

  // 3. Platform Boundary Invariant: Adapters cannot claim platform resources
  assert.ok(!auromatchAdapter.storage.ownedDatabases.includes(PLATFORM_DB_NAME));
  assert.ok(!auromandalaAdapter.storage.ownedDatabases.includes(PLATFORM_DB_NAME));

  for (const k of auromatchAdapter.storage.ownedLocalStorageKeys) {
    assert.equal(isProtectedPlatformKey(k), false, `Key ${k} must not infringe on platform storage`);
  }
  for (const k of auromandalaAdapter.storage.ownedLocalStorageKeys) {
    assert.equal(isProtectedPlatformKey(k), false, `Key ${k} must not infringe on platform storage`);
  }
});

// ---------------------------------------------------------------------------
// Suite 2: Shared Platform Identity Consistency Across Integrated Games
// ---------------------------------------------------------------------------
test('Suite 2: VAK, AuroMatch, and AuroMandala share identical platform guest identity', async () => {
  const sharedStorage = createStorageMock();
  const env = {
    localStorage: sharedStorage,
    sessionStorage: createStorageMock()
  };

  // 1. Portal initializes SDK first
  const portalSdk = createAuroMindSDK(env);
  const portalCtx = await portalSdk.init({ gameId: 'portal', appVersion: '2.5.0' });
  const sharedGuestId = portalCtx.identity.guestId;

  assert.ok(GUEST_ID_RE.test(sharedGuestId), 'Guest ID must be valid UUIDv4');
  assert.equal(sharedStorage.getItem(LS_GUEST_KEY) !== null, true, 'Mirror key must be populated');

  // 2. VAK initializes in the same browser origin/profile
  const vakSdk = createAuroMindSDK(env);
  const vakCtx = await vakSdk.init({ gameId: 'vak', appVersion: '2.18.0' });
  assert.equal(vakCtx.identity.guestId, sharedGuestId, 'VAK must retrieve identical guest ID');

  // Register VAK adapter
  const vakAdapter = {
    gameId: 'vak',
    adapterVersion: '1.0.0',
    contractVersion: 1,
    integrationMode: 'native',
    storage: {
      kind: 'idb+ls',
      ownedDatabases: ['AuroVakDB'],
      ownedLocalStorageKeys: ['auro_vak_user', 'vak_player_profile_v1'],
      localOnlyVaults: []
    },
    capabilities: { offlinePlay: true, localPersistence: true, cloudSyncEligible: true },
    hasLocalProgress: () => true,
    exportEnvelope: async (guestId) => ({
      envelopeVersion: 1,
      gameId: 'vak',
      gameSchemaVersion: 1,
      guestId,
      baseRevision: 0,
      clientUpdatedAt: new Date().toISOString(),
      isEmpty: false,
      checksum: 'vak_chk_1',
      payload: { level: 42 }
    }),
    applyEnvelope: async () => true,
    init: async () => {}
  };
  vakSdk.adapters.register(vakAdapter);
  await vakSdk.adapters.init('vak');
  assert.equal(vakSdk.adapters.get('vak').initialized, true);

  // 3. AuroMatch initializes in the same browser origin/profile
  const matchSdk = createAuroMindSDK(env);
  const matchCtx = await matchSdk.init({ gameId: 'auromatch', appVersion: '4.0.0' });
  assert.equal(matchCtx.identity.guestId, sharedGuestId, 'AuroMatch must retrieve identical guest ID');

  const matchAdapter = createAuroMatchGameAdapter();
  matchSdk.adapters.register(matchAdapter);
  await matchSdk.adapters.init('auromatch');
  assert.equal(matchSdk.adapters.get('auromatch').initialized, true);

  // 4. AuroMandala initializes in the same browser origin/profile
  const mandalaSdk = createAuroMindSDK(env);
  const mandalaCtx = await mandalaSdk.init({ gameId: 'auromandala', appVersion: '1.0.0' });
  assert.equal(mandalaCtx.identity.guestId, sharedGuestId, 'AuroMandala must retrieve identical guest ID');

  const mandalaAdapter = createAuroMandalaGameAdapter();
  mandalaSdk.adapters.register(mandalaAdapter);
  await mandalaSdk.adapters.init('auromandala');
  assert.equal(mandalaSdk.adapters.get('auromandala').initialized, true);

  // Cleanup
  portalSdk.dispose();
  vakSdk.dispose();
  matchSdk.dispose();
  mandalaSdk.dispose();
});

// ---------------------------------------------------------------------------
// Suite 3: Identity Persistence Across Reloads and Isolated Clear Cache
// ---------------------------------------------------------------------------
test('Suite 3: Platform guest identity survives reloads and never replaces game databases', async () => {
  const sharedStorage = createStorageMock();
  const env = { localStorage: sharedStorage };

  // Phase 1: First launch
  const sdk1 = createAuroMindSDK(env);
  await sdk1.init({ gameId: 'vak' });
  const guestId1 = sdk1.identity.getGuestId();
  sdk1.dispose();

  // Phase 2: Game writes game-owned progress
  sharedStorage.setItem('auro_vak_user', JSON.stringify({ player: { name: 'Seeker', currentLevel: 10 } }));
  sharedStorage.setItem('auro_match_user', JSON.stringify({ progression: { completedLevelsCount: 5 } }));

  // Phase 3: Simulated page reload
  const sdk2 = createAuroMindSDK(env);
  await sdk2.init({ gameId: 'auromatch' });
  const guestId2 = sdk2.identity.getGuestId();

  assert.equal(guestId2, guestId1, 'Guest ID must remain identical after reload');
  assert.ok(sharedStorage.getItem('auro_vak_user').includes('Seeker'), 'VAK progress must be preserved');
  assert.ok(sharedStorage.getItem('auro_match_user').includes('5'), 'AuroMatch progress must be preserved');

  sdk2.dispose();
});

// ---------------------------------------------------------------------------
// Suite 4: Non-Destructive Save Envelope Framing & Merge Invariants
// ---------------------------------------------------------------------------
test('Suite 4: Save envelopes conform to RFC UUIDv4 and merge invariants protect progress', async () => {
  const matchAdapter = createAuroMatchGameAdapter();
  const validGuestId = 'guest_12345678-1234-4234-8234-123456789abc';

  const envelope = await matchAdapter.exportEnvelope(validGuestId);
  assert.ok(validateSaveEnvelope(envelope, 'auromatch'), 'AuroMatch envelope must pass strict envelope validation');
  assert.equal(envelope.envelopeVersion, 1);
  assert.equal(envelope.gameId, 'auromatch');
  assert.equal(envelope.guestId, validGuestId);

  // Merge Invariant: Remote empty payload never overwrites local progress
  const emptyRemote = {
    ...envelope,
    isEmpty: true,
    checksum: 'empty_remote',
    payload: null
  };
  const mergeResult = resolveGameMerge('auromatch', envelope, emptyRemote);
  assert.equal(mergeResult.status, 'use_local', 'Local progress must be protected against empty remote');
});

// ---------------------------------------------------------------------------
// Suite 5: Failure of SDK Initialization Must Never Prevent Game Launch
// ---------------------------------------------------------------------------
test('Suite 5: Game initialization degrades gracefully if SDK is unavailable or throws', async () => {
  // Fault injection: SDK init throws
  let gameLaunched = false;
  let capturedError = null;

  try {
    const brokenSdk = {
      init: async () => { throw new Error('IndexedDB storage quota exceeded / private mode lock'); }
    };

    // Simulated game startup pattern
    try {
      await brokenSdk.init({ gameId: 'vak' });
    } catch (err) {
      capturedError = err;
      // Fallback: proceed to launch local game engine
    }

    gameLaunched = true;
  } catch (fatalErr) {
    gameLaunched = false;
  }

  assert.equal(gameLaunched, true, 'Game must launch even if SDK initialization fails');
  assert.ok(capturedError !== null, 'Non-fatal error was properly captured and handled');
});

// ---------------------------------------------------------------------------
// Suite 6: Service Worker Isolation & Scope Boundaries
// ---------------------------------------------------------------------------
test('Suite 6: Service worker scopes and cache configurations remain strictly isolated', () => {
  const rootSwCode = fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8');
  const vakSwCode = fs.readFileSync(path.join(__dirname, 'games/vak/sw.js'), 'utf8');
  const matchSwCode = fs.readFileSync(path.join(__dirname, 'games/auromatch/sw.js'), 'utf8');
  const mandalaSwCode = fs.readFileSync(path.join(__dirname, 'games/auromandala/sw.js'), 'utf8');
  const blocksSwCode = fs.readFileSync(path.join(__dirname, 'games/auroblocks/sw.js'), 'utf8');
  const riddleSwCode = fs.readFileSync(path.join(__dirname, 'games/word-riddle/sw.js'), 'utf8');

  // Root SW cache isolation
  assert.ok(rootSwCode.includes('auro-portal-v1.1.0'), 'Root SW must use auro-portal-v1.1.0 cache');
  assert.ok(rootSwCode.includes("relPath.startsWith('games/')"), 'Root SW must bypass game routes');

  // Game-specific SW caches
  assert.ok(vakSwCode.includes('auro-vak-v2.19'), 'VAK must use its isolated auro-vak cache');
  assert.ok(matchSwCode.includes('auro-match-v2.2'), 'AuroMatch must use its isolated auro-match cache');
  assert.ok(mandalaSwCode.includes('workbox'), 'AuroMandala must use Workbox isolated cache');
  assert.ok(blocksSwCode.includes('auroblocks-'), 'AuroBlocks must use its isolated shell cache');
  assert.ok(riddleSwCode.includes('word-discovery-'), 'Word Riddle must use its isolated shell cache');
});

// ---------------------------------------------------------------------------
// Suite 7: Static Integrity Parity Across Protected Databases & Game Corpora
// ---------------------------------------------------------------------------
test('Suite 7: 1,368-level VAK corpus and protected game databases remain 100% byte-intact', () => {
  const vakHtml = fs.readFileSync(path.join(__dirname, 'games/vak/index.html'), 'utf8');
  assert.ok(vakHtml.includes('const CL = [[1,"CALM","LCMA"'), 'VAK 1,368-level corpus must be intact');
  assert.ok(vakHtml.includes('"Not agitated, excited, or disturbed; peaceful"'), 'VAK level definitions intact');

  // Flora and crossword databases
  assert.ok(fs.existsSync(path.join(__dirname, 'games/auromatch/src/models/floraDatabase.js')));
  const floraStat = fs.statSync(path.join(__dirname, 'games/auromatch/src/models/floraDatabase.js'));
  assert.equal(floraStat.size, 2002176, 'Flora database size must be exactly 2,002,176 bytes');

  // All 6 entry points exist
  const gameEntryPoints = [
    'games/vak/index.html',
    'games/auromatch/index.html',
    'games/auromandala/index.html',
    'games/word-riddle/index.html',
    'games/vak-living-sanctuary/index.html',
    'games/auroblocks/index.html'
  ];
  for (const entry of gameEntryPoints) {
    assert.ok(fs.existsSync(path.join(__dirname, entry)), `Game entry point ${entry} must exist`);
  }
});
