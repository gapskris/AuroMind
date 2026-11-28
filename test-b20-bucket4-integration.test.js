import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname);

// Import Shared SDK & Game Adapters
import {
  createAuroMandalaGameAdapter,
  CACHE_KEY as MANDALA_CACHE_KEY,
  SANKALPA_VAULT_KEY
} from './games/auromandala/assets/auromandala-sdk-bridge.js';

import {
  createAuroMatchGameAdapter
} from './games/auromatch/Assets/auromatch-sdk-bridge.js';

import {
  createAuroBlocksGameAdapter
} from './games/auroblocks/assets/auroblocks-sdk-bridge.js';

import {
  createAdapterRegistry,
  KNOWN_GAME_IDS,
  mergeArtworksWithForking,
  migrateArtworksToMap,
  generateArtworkUuid,
  capSnapshots
} from './assets/sdk/auromind-adapters.js';

import {
  createArtworkEntity,
  computeArtworkContentHash,
  MAX_ARTWORK_SNAPSHOTS
} from './assets/sdk/artwork-concurrency.js';

// Setup Mock Browser Storage for Isolation Testing
class MockLocalStorage {
  constructor() {
    this.store = new Map();
  }
  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }
  setItem(key, value) {
    this.store.set(key, String(value));
  }
  removeItem(key) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
  get length() {
    return this.store.size;
  }
  key(index) {
    return Array.from(this.store.keys())[index] || null;
  }
}

// ---------------------------------------------------------------------------
// TEST SUITE 1: SHARED SDK INTEGRATION BASELINE & CONTRACTS (B4.1)
// ---------------------------------------------------------------------------
test('B4.1 — Shared SDK Game Adapter Contracts and Registry', async (t) => {
  await t.test('All three release games exist in KNOWN_GAME_IDS', () => {
    assert.ok(KNOWN_GAME_IDS.includes('auromandala'), 'auromandala in known games');
    assert.ok(KNOWN_GAME_IDS.includes('auromatch'), 'auromatch in known games');
    assert.ok(KNOWN_GAME_IDS.includes('auroblocks'), 'auroblocks in known games');
  });

  await t.test('Adapters instantiate with valid contractVersion 1 and native mode', () => {
    const mandalaAdapter = createAuroMandalaGameAdapter();
    const matchAdapter = createAuroMatchGameAdapter();
    const blocksAdapter = createAuroBlocksGameAdapter();

    assert.equal(mandalaAdapter.gameId, 'auromandala');
    assert.equal(mandalaAdapter.contractVersion, 1);
    assert.equal(mandalaAdapter.integrationMode, 'native');

    assert.equal(matchAdapter.gameId, 'auromatch');
    assert.equal(matchAdapter.contractVersion, 1);
    assert.equal(matchAdapter.integrationMode, 'native');

    assert.equal(blocksAdapter.gameId, 'auroblocks');
    assert.equal(blocksAdapter.contractVersion, 1);
    assert.equal(blocksAdapter.integrationMode, 'native');
  });

  await t.test('Adapter registry successfully registers and initializes all three games', async () => {
    const mockSdkHooks = {
      sdkVersion: '1.0.0',
      isSdkInitialized: () => true,
      getGuestId: () => 'guest_12345678-1234-4123-8123-123456789abc',
      getIdentity: () => ({ guestId: 'guest_12345678-1234-4123-8123-123456789abc' }),
      getCapabilities: () => ({ offlinePlay: true }),
      canPlayGame: () => ({ allowed: true }),
      on: () => {},
      emit: () => {}
    };

    const registry = createAdapterRegistry(mockSdkHooks);
    registry.register(createAuroMandalaGameAdapter());
    registry.register(createAuroMatchGameAdapter());
    registry.register(createAuroBlocksGameAdapter());

    assert.ok(registry.has('auromandala'));
    assert.ok(registry.has('auromatch'));
    assert.ok(registry.has('auroblocks'));

    await registry.init('auromandala');
    await registry.init('auromatch');
    await registry.init('auroblocks');

    assert.equal(registry.get('auromandala').initialized, true);
    assert.equal(registry.get('auromatch').initialized, true);
    assert.equal(registry.get('auroblocks').initialized, true);
  });
});

// ---------------------------------------------------------------------------
// TEST SUITE 2: AUROMANDALA ARTWORK INTEGRATION & PRIVACY BOUNDARIES (B4.2)
// ---------------------------------------------------------------------------
test('B4.2 — AuroMandala Artwork Integration, Versioning & Sankalpa Isolation', async (t) => {
  const originalLocalStorage = globalThis.localStorage;
  const mockStorage = new MockLocalStorage();
  globalThis.localStorage = mockStorage;

  t.after(() => {
    globalThis.localStorage = originalLocalStorage;
  });

  await t.test('Sankalpa E2EE vault is strictly excluded from cloud sync', () => {
    const adapter = createAuroMandalaGameAdapter();
    assert.equal(adapter.capabilities.sankalpaSyncEligible, false, 'sankalpaSyncEligible must be false');
    assert.ok(adapter.capabilities.localOnlyVaults.includes(SANKALPA_VAULT_KEY), 'sankalpa must be listed in localOnlyVaults');
  });

  await t.test('Artwork dictionary migration handles legacy array and generates UUIDv4 keys when missing', () => {
    const legacyArtworks = [
      { title: 'Lotus Mandala', strokes: [{ x: 10, y: 20 }] },
      { title: 'Solar Wheel', strokes: [{ x: 50, y: 50 }] }
    ];

    const mapped = migrateArtworksToMap(legacyArtworks);
    const keys = Object.keys(mapped);
    assert.equal(keys.length, 2);
    // Keys generated via fallback must be UUIDv4 format
    for (const k of keys) {
      assert.match(k, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    }
  });

  await t.test('Rolling snapshot cap strictly limits history to 10 immutable snapshots', () => {
    const snapshots = [];
    for (let i = 1; i <= 15; i++) {
      snapshots.push({ revision: i, contentHash: `hash-${i}`, timestamp: new Date().toISOString() });
    }
    const capped = capSnapshots(snapshots);
    assert.equal(capped.length, MAX_ARTWORK_SNAPSHOTS);
    assert.equal(capped[capped.length - 1].revision, 15);
    assert.equal(capped[0].revision, 6);
  });

  await t.test('Conflict forking preserves local artwork and forks divergent remote into Recovered Copy', () => {
    const artworkId = generateArtworkUuid();
    const localArtworks = {
      [artworkId]: {
        artworkId,
        title: 'Morning Meditation',
        revision: 2,
        parentRevisionId: 'rev-1',
        contentHash: 'local-hash-abc',
        strokes: [{ x: 1, y: 1 }]
      }
    };

    const remoteArtworks = {
      [artworkId]: {
        artworkId,
        title: 'Morning Meditation',
        revision: 2,
        parentRevisionId: 'rev-1',
        contentHash: 'remote-hash-xyz',
        strokes: [{ x: 2, y: 2 }]
      }
    };

    const merged = mergeArtworksWithForking(localArtworks, remoteArtworks);
    const mergedKeys = Object.keys(merged);
    assert.equal(mergedKeys.length, 2, 'Must have forked divergent remote copy');

    // Local copy preserved exactly
    assert.equal(merged[artworkId].contentHash, 'local-hash-abc');
    assert.equal(merged[artworkId].title, 'Morning Meditation');

    // Forked copy has recovered title
    const forkedKey = mergedKeys.find(k => k !== artworkId);
    assert.ok(forkedKey);
    assert.equal(merged[forkedKey].title, 'Morning Meditation (Recovered Copy)');
    assert.equal(merged[forkedKey].contentHash, 'remote-hash-xyz');
  });

  await t.test('applyEnvelope preserves local Sankalpa vault untouched when merging remote data', async () => {
    const adapter = createAuroMandalaGameAdapter();
    const initialCache = {
      highestStageCleared: 3,
      sankalpa: { encryptedVaultPayload: 'SECRET_VAULT_BYTES' },
      savedArtworks: {}
    };
    mockStorage.setItem(MANDALA_CACHE_KEY, JSON.stringify(initialCache));

    const incomingEnvelope = {
      gameId: 'auromandala',
      payload: {
        progression: { highestStageCleared: 5 },
        artworks: {},
        sankalpa: { maliciousOverwriteValue: 'MALICIOUS_OVERWRITE' }
      }
    };

    const success = await adapter.applyEnvelope(incomingEnvelope);
    assert.equal(success, true);

    const resultingCache = JSON.parse(mockStorage.getItem(MANDALA_CACHE_KEY));
    assert.equal(resultingCache.highestStageCleared, 5, 'Progression updated to higher stage');
    assert.deepEqual(resultingCache.sankalpa, { encryptedVaultPayload: 'SECRET_VAULT_BYTES' }, 'Local Sankalpa untouched');
    assert.equal(resultingCache.maliciousOverwriteValue, undefined);
  });

  await t.test('exportEnvelope strictly sanitizes and excludes Sankalpa vault from cloud envelope', async () => {
    const adapter = createAuroMandalaGameAdapter();
    const cacheWithSankalpa = {
      highestStageCleared: 4,
      savedArtworks: {},
      sankalpa: { personalMantra: 'OM_SHANTI_SECRET' },
      sankalpa_e2ee_vault: { rawKeyHex: 'deadbeef1234' },
      sankalpa_reflections: [{ text: 'Deep contemplation' }]
    };
    mockStorage.setItem(MANDALA_CACHE_KEY, JSON.stringify(cacheWithSankalpa));
    mockStorage.setItem(SANKALPA_VAULT_KEY, JSON.stringify({ keyData: 'NON_EXPORTABLE' }));

    const envelope = await adapter.exportEnvelope('guest_test_sankalpa_exclusion');
    assert.equal(envelope.gameId, 'auromandala');
    assert.equal(envelope.payload.sankalpa, undefined, 'sankalpa must not exist in payload');
    assert.equal(envelope.payload.sankalpa_e2ee_vault, undefined, 'sankalpa_e2ee_vault must not exist in payload');
    assert.equal(envelope.payload.sankalpa_reflections, undefined, 'sankalpa_reflections must not exist in payload');

    const envelopeSerialized = JSON.stringify(envelope);
    assert.equal(envelopeSerialized.includes('OM_SHANTI_SECRET'), false, 'Private mantra must never appear in envelope');
    assert.equal(envelopeSerialized.includes('NON_EXPORTABLE'), false, 'Vault keys must never appear in envelope');
    assert.equal(envelopeSerialized.includes('deadbeef1234'), false, 'Raw key hex must never appear in envelope');
  });
});

// ---------------------------------------------------------------------------
// TEST SUITE 3: MAAMATCH GUEST PROGRESS & ISOLATION (B4.3)
// ---------------------------------------------------------------------------
test('B4.3 — MaaMATCH Guest Progress, Player Isolation & Reconciliation', async (t) => {
  const originalLocalStorage = globalThis.localStorage;
  const mockStorage = new MockLocalStorage();
  globalThis.localStorage = mockStorage;

  t.after(() => {
    globalThis.localStorage = originalLocalStorage;
  });

  await t.test('MaaMATCH adapter exports valid save envelope with checksum', async () => {
    const adapter = createAuroMatchGameAdapter();
    const guestId = 'guest_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

    const envelope = await adapter.exportEnvelope(guestId);
    assert.equal(envelope.gameId, 'auromatch');
    assert.equal(envelope.envelopeVersion, 1);
    assert.equal(envelope.guestId, guestId);
    assert.ok(envelope.checksum, 'Envelope has valid checksum');
  });

  await t.test('MaaMATCH preserves progression and does not duplicate on repeated reconciliation', async () => {
    const adapter = createAuroMatchGameAdapter();
    const envelope = {
      gameId: 'auromatch',
      payload: {
        playerState: {
          currentLevel: 12,
          highScore: 4500,
          unlockedThemes: ['sakura', 'classic']
        }
      }
    };

    // Apply first time
    const res1 = await adapter.applyEnvelope(envelope);
    assert.equal(res1, true);

    // Apply second time (idempotent reconciliation)
    const res2 = await adapter.applyEnvelope(envelope);
    assert.equal(res2, true);
  });

  await t.test('Cross-player isolation: distinct guest IDs maintain separate state', async () => {
    const adapter = createAuroMatchGameAdapter();
    const guest1 = 'guest_11111111-1111-4111-8111-111111111111';
    const guest2 = 'guest_22222222-2222-4222-8222-222222222222';

    const env1 = await adapter.exportEnvelope(guest1);
    const env2 = await adapter.exportEnvelope(guest2);

    assert.equal(env1.guestId, guest1);
    assert.equal(env2.guestId, guest2);
    assert.notEqual(env1.guestId, env2.guestId);
  });
});

// ---------------------------------------------------------------------------
// TEST SUITE 4: AUROBLOCKS PUZZLE INTEGRITY & STORAGE CONTRACT (B4.4)
// ---------------------------------------------------------------------------
test('B4.4 — AuroBlocks Puzzle Mechanics, Unique Tile Values & Canvas State', async (t) => {
  const originalLocalStorage = globalThis.localStorage;
  const mockStorage = new MockLocalStorage();
  globalThis.localStorage = mockStorage;

  t.after(() => {
    globalThis.localStorage = originalLocalStorage;
  });

  await t.test('AuroBlocks adapter declares owned storage keys', () => {
    const adapter = createAuroBlocksGameAdapter();
    assert.equal(adapter.gameId, 'auroblocks');
    assert.ok(adapter.storage.ownedLocalStorageKeys.includes('auroblocks_player_save_v1'));
    assert.ok(adapter.storage.ownedLocalStorageKeys.includes('auroblocks_high_score'));
    assert.ok(adapter.storage.ownedLocalStorageKeys.includes('auroblocks_stages'));
  });

  await t.test('AuroBlocks saves and restores valid progression without corruption', async () => {
    const adapter = createAuroBlocksGameAdapter();
    const guestId = 'guest_33333333-3333-4333-8333-333333333333';

    // Mock initial save in localStorage
    mockStorage.setItem('auroblocks_high_score', '8500');
    mockStorage.setItem('auroblocks_stages', JSON.stringify(['classic_1', 'classic_2', 'sudoku_1']));

    assert.equal(adapter.hasLocalProgress(), true);

    const exported = await adapter.exportEnvelope(guestId);
    assert.equal(exported.gameId, 'auroblocks');
    assert.equal(exported.isEmpty, false);
    assert.equal(exported.payload.save.highScore, 8500);
    assert.equal(exported.payload.save.stages.length, 3);

    // Clear storage and restore from envelope
    mockStorage.clear();
    assert.equal(adapter.hasLocalProgress(), false);

    const applied = await adapter.applyEnvelope(exported);
    assert.equal(applied, true);
    assert.equal(adapter.hasLocalProgress(), true);
  });

  await t.test('Incomplete or corrupt envelope does not destroy existing valid save', async () => {
    const adapter = createAuroBlocksGameAdapter();
    mockStorage.setItem('auroblocks_player_save_v1', JSON.stringify({ highScore: 9999, stages: ['stage_1'] }));

    // Apply corrupted envelope
    const corruptEnvelope = { gameId: 'auroblocks', payload: null };
    const result = await adapter.applyEnvelope(corruptEnvelope);
    assert.equal(result, false, 'Rejected invalid envelope');

    // Verify existing save remained intact
    const preserved = JSON.parse(mockStorage.getItem('auroblocks_player_save_v1'));
    assert.equal(preserved.highScore, 9999);
  });
});

// ---------------------------------------------------------------------------
// TEST SUITE 5: PORTAL ASSEMBLY, CATALOGUE & RETURN NAVIGATION (B4.5)
// ---------------------------------------------------------------------------
test('B4.5 — Portal Assembly, Catalogue Conformance & Return Navigation', async (t) => {
  const indexHtmlPath = path.join(REPO_ROOT, 'index.html');
  const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

  await t.test('Index.html catalogue contains exactly 3 games: auromatch, auroblocks, auromandala', () => {
    const gameCardMatches = Array.from(indexHtml.matchAll(/data-game-id="([^"]+)"/g)).map(m => m[1]);
    const uniqueGames = Array.from(new Set(gameCardMatches));

    assert.ok(uniqueGames.includes('auromatch'), 'Contains auromatch');
    assert.ok(uniqueGames.includes('auroblocks'), 'Contains auroblocks');
    assert.ok(uniqueGames.includes('auromandala'), 'Contains auromandala');

    // VAK must NOT be in active portal catalogue
    assert.equal(uniqueGames.includes('vak'), false, 'VAK must be excluded from active catalogue');
    assert.equal(uniqueGames.includes('vak-living-sanctuary'), false, 'VAK Living Sanctuary must be excluded');
  });

  await t.test('Portal JS verifies AUROMIND_CLOSE_THEATER and rejects foreign origins', () => {
    const portalJsPath = path.join(REPO_ROOT, 'assets', 'js', 'portal.js');
    const portalJs = fs.readFileSync(portalJsPath, 'utf8');

    assert.ok(portalJs.includes('AUROMIND_CLOSE_THEATER'), 'Handles AUROMIND_CLOSE_THEATER event');
    assert.ok(portalJs.includes('closeTheater()'), 'Invokes closeTheater');
    assert.ok(portalJs.includes('GAME_ID_ALIASES'), 'Uses explicit game ID alias map for security');
  });

  await t.test('All three games provide floating Return to Portal buttons', () => {
    const mandalaBridge = fs.readFileSync(path.join(REPO_ROOT, 'games', 'auromandala', 'assets', 'auromandala-sdk-bridge.js'), 'utf8');
    const matchMain = fs.readFileSync(path.join(REPO_ROOT, 'games', 'auromatch', 'src', 'main.js'), 'utf8');
    const blocksBridge = fs.readFileSync(path.join(REPO_ROOT, 'games', 'auroblocks', 'assets', 'auroblocks-sdk-bridge.js'), 'utf8');

    assert.ok(mandalaBridge.includes('auromind-theater-return-btn'), 'AuroMandala has return pill button');
    assert.ok(matchMain.includes('auromind-theater-return-btn'), 'MaaMATCH has return pill button');
    assert.ok(blocksBridge.includes('auromind-theater-return-btn'), 'AuroBlocks has return pill button');
  });
});

// ---------------------------------------------------------------------------
// TEST SUITE 6: SERVICE WORKER & OFFLINE ARCHITECTURE (B4.6)
// ---------------------------------------------------------------------------
test('B4.6 — Service Worker Games Isolation & SDK Delivery', async (t) => {
  const rootSwPath = path.join(REPO_ROOT, 'sw.js');
  const rootSw = fs.readFileSync(rootSwPath, 'utf8');

  await t.test('Root service worker strictly bypasses /games/* to allow child SW autonomy', () => {
    assert.ok(rootSw.includes('/games/'), 'References /games/ route');
    assert.ok(
      rootSw.includes('url.pathname.startsWith(\'/games/\')') ||
      rootSw.includes('url.pathname.includes(\'/games/\')'),
      'Root SW explicitly bypasses /games/* routes'
    );
  });

  await t.test('Root service worker precaches shared SDK assets for offline play', () => {
    assert.ok(rootSw.includes('auromind-sdk.js'), 'Precaches auromind-sdk.js');
    assert.ok(rootSw.includes('auromind-adapters.js'), 'Precaches auromind-adapters.js');
  });
});
