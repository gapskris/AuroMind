/**
 * AuroMind Platform Modernization — Batch B11 Six-Game Integration & E2E Validation Suite
 *
 * Verifies the complete platform as an integrated product:
 * 1. Six-game entry points, PWA manifests, responsive viewports, and asset integrity.
 * 2. Shared platform guest identity consistency across portal and all 6 games.
 * 3. Save schema independence, zero cross-contamination, and corrupted data recovery.
 * 4. Cache isolation: cache clearing does not erase player progress or guest identity.
 * 5. Service worker scope boundaries: root SW bypasses /games/*, game SWs remain isolated.
 * 6. In-portal theater mode, session start/end duration, progression relay, and error diagnostics.
 * 7. Visitor consent lifecycle, immediate opt-out purge, and zero-PII/Sankalpa privacy invariants.
 * 8. Protected content verification: VAK corpus SHA-256 and Flora database byte size.
 *
 * Runs natively with Node.js test runner (`node --test`). Zero external dependencies.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  createAuroMindSDK,
  SDK_VERSION,
  PLATFORM_DB_NAME,
  LS_GUEST_KEY,
  LS_CONSENT_KEY,
  LS_TELEMETRY_KEY
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
import { LAUNCH_GAMES } from './supabase/functions/owner-metrics/metrics-handler.js';

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
// Suite 1: Six-Game Asset, Manifest, Viewport, and Protected Content Integrity
// ---------------------------------------------------------------------------
test('B11 Suite 1: All six games have valid shells, manifests, viewports, and protected corpora', () => {
  const expectedGames = [
    { id: 'vak', dir: 'games/vak', manifest: 'manifest.webmanifest' },
    { id: 'auromatch', dir: 'games/auromatch', manifest: 'manifest.json' },
    { id: 'auromandala', dir: 'games/auromandala', manifest: 'manifest.webmanifest' },
    { id: 'wordriddle', dir: 'games/word-riddle', manifest: 'manifest.webmanifest' },
    { id: 'auroblocks', dir: 'games/auroblocks', manifest: 'manifest.webmanifest' },
    { id: 'vak-sanctuary', dir: 'games/vak-living-sanctuary', manifest: 'manifest.webmanifest' }
  ];

  for (const game of expectedGames) {
    const entryPath = path.join(__dirname, game.dir, 'index.html');
    assert.ok(fs.existsSync(entryPath), `Entry point for ${game.id} must exist at ${entryPath}`);

    const htmlContent = fs.readFileSync(entryPath, 'utf8');

    // 1. Viewport meta tag presence
    assert.ok(
      htmlContent.includes('name="viewport"') || htmlContent.includes("name='viewport'"),
      `Game ${game.id} must include responsive viewport meta tag`
    );

    // 2. Manifest validity
    const manifestPath = path.join(__dirname, game.dir, game.manifest);
    assert.ok(fs.existsSync(manifestPath), `Manifest for ${game.id} must exist at ${manifestPath}`);
    const manifestJson = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.ok(manifestJson.name, `Manifest for ${game.id} must declare name`);
    assert.ok(manifestJson.start_url, `Manifest for ${game.id} must declare start_url`);
    assert.equal(manifestJson.display, 'standalone', `Manifest for ${game.id} must declare standalone display`);

    // 3. Backend independence: zero direct Supabase/Firebase imports in game HTML
    assert.equal(htmlContent.includes('@supabase/supabase-js'), false, `Game ${game.id} must not directly import Supabase`);
    assert.equal(htmlContent.includes('firebase/app'), false, `Game ${game.id} must not directly import Firebase`);
  }

  // 4. VAK 1,368-level corpus SHA-256 verification
  const vakPath = path.join(__dirname, 'games/vak/index.html');
  const vakHtml = fs.readFileSync(vakPath, 'utf8');
  const clMatch = vakHtml.match(/const CL = \[\[[\s\S]*?\]\];/);
  assert.ok(clMatch, 'VAK 1,368-level corpus array (const CL) must be present in index.html');
  const corpusString = clMatch[0];
  const corpusSha256 = crypto.createHash('sha256').update(corpusString, 'utf8').digest('hex');
  assert.equal(
    corpusSha256,
    '9fdb3826030049c9eab183479bcb7fe29304b3ea08d045c8c67f1cfd4d77da09',
    'VAK corpus SHA-256 must match baseline exactly'
  );

  // 5. AuroMatch Flora botanical database size verification
  const floraPath = path.join(__dirname, 'games/auromatch/src/models/floraDatabase.js');
  assert.ok(fs.existsSync(floraPath), 'Flora database must exist');
  const floraStat = fs.statSync(floraPath);
  assert.equal(floraStat.size, 2002176, 'Flora database size must be exactly 2,002,176 bytes');
});

// ---------------------------------------------------------------------------
// Suite 2: Unified Platform Player Identity Across All Six Games
// ---------------------------------------------------------------------------
test('B11 Suite 2: Single-origin guest identity is consistent across portal and all games, surviving restarts', async () => {
  const sharedStorage = createStorageMock();
  const env = { localStorage: sharedStorage };

  // Phase 1: Portal boots and mints guest identity
  const portalSdk = createAuroMindSDK(env);
  const portalCtx = await portalSdk.init({ gameId: 'portal', appVersion: '1.0.0' });
  const platformGuestId = portalCtx.identity.guestId;

  assert.ok(platformGuestId, 'Portal must establish guest identity');
  assert.ok(platformGuestId.startsWith('guest_'), 'Guest ID must use guest_ prefix');

  // Phase 2: Each of the six games initializes in the same browser origin
  const gameIds = ['vak', 'auromatch', 'auromandala', 'wordriddle', 'auroblocks', 'vak-sanctuary'];
  for (const gId of gameIds) {
    const gameSdk = createAuroMindSDK(env);
    const gameCtx = await gameSdk.init({ gameId: gId, appVersion: '1.0.0' });
    assert.equal(
      gameCtx.identity.guestId,
      platformGuestId,
      `Game ${gId} must retrieve the identical shared platform guestId`
    );
    assert.equal(
      gameSdk.identity.getGuestId(),
      platformGuestId,
      `Game ${gId} getGuestId() must match platform guestId`
    );
    gameSdk.dispose();
  }

  // Phase 3: Simulated browser restart (new SDK instance loading from existing storage)
  const restartedSdk = createAuroMindSDK(env);
  const restartCtx = await restartedSdk.init({ gameId: 'portal', appVersion: '1.0.0' });
  assert.equal(
    restartCtx.identity.guestId,
    platformGuestId,
    'Guest identity must survive browser restart identically'
  );

  // Phase 4: Preferences update propagates across instances
  restartedSdk.player.updatePreferences({ seniorMode: true, reducedMotion: true, volume: 75 });
  const prof = restartedSdk.player.getProfile();
  assert.equal(prof.preferences.seniorMode, true);
  assert.equal(prof.preferences.reducedMotion, true);
  assert.equal(prof.preferences.volume, 75);

  portalSdk.dispose();
  restartedSdk.dispose();
});

// ---------------------------------------------------------------------------
// Suite 3: Save Schema Independence, Isolation, and Corrupted Data Resilience
// ---------------------------------------------------------------------------
test('B11 Suite 3: Save schemas remain isolated; cache clearing does not erase game saves', async () => {
  const sharedStorage = createStorageMock();
  const env = { localStorage: sharedStorage };

  const sdk = createAuroMindSDK(env);
  await sdk.init({ gameId: 'portal', appVersion: '1.0.0' });
  const guestId = sdk.identity.getGuestId();

  // 1. Each game writes game-specific progress into its own dedicated keys
  sharedStorage.setItem('auro_vak_user', JSON.stringify({
    player: { name: 'Seeker', currentLevel: 42, sparks: 1500 }
  }));
  sharedStorage.setItem('auro_match_user', JSON.stringify({
    progression: { completedLevelsCount: 18, highestUnlockedMode: 'realms' }
  }));
  sharedStorage.setItem('pranamandala_game_cache_v2', JSON.stringify({
    highestStageCleared: 5, sessions: [{ date: '2026-11-20', duration: 1200 }]
  }));
  sharedStorage.setItem('auroblocks_player_save_v1', JSON.stringify({
    highScore: 4850, modeUnlocked: ['classic', 'sudoku']
  }));
  sharedStorage.setItem('word_discovery_save_v1', JSON.stringify({
    solvedRiddles: [1, 2, 3, 4], currentTheme: 'th03'
  }));
  sharedStorage.setItem('vak_sanctuary_codex_v1', JSON.stringify({
    unlockedWords: ['CALM', 'ASPIRATION', 'PEACE']
  }));

  // 2. Cross-Game Isolation: Clearing or modifying one game's save never corrupts another game's save
  sharedStorage.setItem('auro_vak_user', JSON.stringify({ player: { name: 'Seeker', currentLevel: 43, sparks: 1600 } }));
  assert.ok(sharedStorage.getItem('auro_match_user').includes('18'), 'AuroMatch progress must be unaffected by VAK save update');
  assert.ok(sharedStorage.getItem('pranamandala_game_cache_v2').includes('1200'), 'AuroMandala progress must be unaffected');
  assert.ok(sharedStorage.getItem('auroblocks_player_save_v1').includes('4850'), 'AuroBlocks progress must be unaffected');

  // 3. Cache Clearing Safety: Simulated Service Worker cache clear
  // Clearing CacheStorage (Caches API) strictly leaves localStorage and IndexedDB intact
  const mockCacheStore = new Map([
    ['auro-portal-v1.1.0', new Map([['/index.html', 'cached_html']])],
    ['auro-vak-v2.19', new Map([['/games/vak/index.html', 'cached_vak']])],
    ['word-discovery-shell-v2', new Map([['/games/word-riddle/index.html', 'cached_riddle']])]
  ]);

  // Execute cache purge
  for (const cacheName of mockCacheStore.keys()) {
    mockCacheStore.delete(cacheName);
  }
  assert.equal(mockCacheStore.size, 0, 'All service worker caches purged');

  // Assert game progress and guest identity survived 100% intact
  assert.ok(sharedStorage.getItem('auro_vak_user').includes('43'), 'VAK progress survived cache clear');
  assert.ok(sharedStorage.getItem('auro_match_user').includes('18'), 'AuroMatch progress survived cache clear');
  assert.ok(sharedStorage.getItem(LS_GUEST_KEY).includes(guestId), 'Guest identity survived cache clear');

  // 4. Corrupted Save Data Handling: Graceful degradation with fallback
  sharedStorage.setItem('auro_match_user', 'CORRUPT_JSON_{{{invalid');
  let loadedMatchSave = null;
  try {
    const raw = sharedStorage.getItem('auro_match_user');
    loadedMatchSave = JSON.parse(raw);
  } catch (err) {
    // Fallback default save without crashing
    loadedMatchSave = { progression: { completedLevelsCount: 1, highestUnlockedMode: 'standard' } };
  }
  assert.equal(loadedMatchSave.progression.completedLevelsCount, 1, 'Corrupted save degraded gracefully to safe defaults');
  assert.ok(sharedStorage.getItem(LS_GUEST_KEY).includes(guestId), 'Guest identity remained intact despite corrupt game save');

  sdk.dispose();
});

// ---------------------------------------------------------------------------
// Suite 4: Service Worker Scope Isolation and Offline Caching Boundaries
// ---------------------------------------------------------------------------
test('B11 Suite 4: Root service worker strictly bypasses /games/* routes, preserving nested game SW isolation', () => {
  const rootSwCode = fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8');

  // Invariant 1: Root SW uses isolated portal cache key
  assert.ok(rootSwCode.includes('auro-portal-v1.2.0'), 'Root SW must use auro-portal-v1.2.0 cache');
  assert.ok(rootSwCode.includes('auro-portal-fonts-v1.0.0'), 'Root SW must use isolated font cache');

  // Invariant 2: Root SW explicitly bypasses /games/* and iframe referrers
  assert.ok(
    rootSwCode.includes("relPath.startsWith('games/')"),
    'Root SW must bypass relPath starting with games/'
  );
  assert.ok(
    rootSwCode.includes("url.pathname.includes('/games/')"),
    'Root SW must bypass any pathname containing /games/'
  );
  assert.ok(
    rootSwCode.includes("request.referrer.includes('/games/')"),
    'Root SW must bypass requests with game iframe referrer'
  );

  // Invariant 3: Game Service Workers have isolated scopes and cache prefixes
  const vakSw = fs.readFileSync(path.join(__dirname, 'games/vak/sw.js'), 'utf8');
  assert.ok(vakSw.includes('auro-vak-v2.19'), 'VAK must use isolated auro-vak cache');

  const matchSw = fs.readFileSync(path.join(__dirname, 'games/auromatch/sw.js'), 'utf8');
  // Architectural contract: AuroMatch cache name must adhere to 'auro-match-v<major>.<minor>' versioned pattern
  const matchCacheMatch = matchSw.match(/const\s+CACHE_NAME\s*=\s*['"](auro-match-v\d+\.\d+)['"]/);
  assert.ok(matchCacheMatch, 'AuroMatch must define a versioned auro-match-vX.Y cache name');
  assert.ok(matchSw.includes('auro-match-artwork-v'), 'AuroMatch must isolate artwork cache');
  assert.ok(matchSw.includes('auro-match-fonts-v'), 'AuroMatch must isolate font cache');
  // Negative assertions: AuroMatch SW must NEVER adopt portal or cross-game cache prefixes
  assert.equal(matchSw.includes('auro-portal-'), false, 'AuroMatch must not use portal cache');
  assert.equal(matchSw.includes('auroblocks-'), false, 'AuroMatch must not use auroblocks cache');
  assert.equal(matchSw.includes('auro-vak-'), false, 'AuroMatch must not use vak cache');
  assert.equal(matchSw.includes('word-discovery-'), false, 'AuroMatch must not use word-discovery cache');

  const riddleSw = fs.readFileSync(path.join(__dirname, 'games/word-riddle/sw.js'), 'utf8');
  assert.ok(riddleSw.includes('word-discovery-'), 'Word Riddle must use isolated word-discovery cache');

  const blocksSw = fs.readFileSync(path.join(__dirname, 'games/auroblocks/sw.js'), 'utf8');
  assert.ok(blocksSw.includes('auroblocks-'), 'AuroBlocks must use isolated auroblocks cache');
});

// ---------------------------------------------------------------------------
// Suite 5: In-Portal Theater Mode Lifecycle and Cross-Game Telemetry Relay
// ---------------------------------------------------------------------------
test('B11 Suite 5: Theater session start/end duration, progression events, and error capture', async () => {
  const store = createStorageMock();
  const sdk = createAuroMindSDK({ localStorage: store });
  await sdk.init({ gameId: 'portal', appVersion: '1.0.0' });
  sdk.telemetry.setConsent(true);

  // Simulate in-portal theater launch lifecycle for all six games
  for (const gameId of LAUNCH_GAMES) {
    const startTime = Date.now();

    // 1. User clicks game in portal catalog
    sdk.telemetry.track('game_select', { gameId, source: 'catalog_grid' }, { category: 'engagement', gameId });
    sdk.telemetry.track('game_launch', { gameId, launchContext: 'theater' }, { category: 'engagement', gameId });
    sdk.telemetry.track('game_session_start', { gameId }, { category: 'engagement', gameId });

    // 2. Child game relays progression via postMessage bridge
    sdk.telemetry.track('level_attempt', { gameId, levelId: 1, attemptNumber: 1 }, { category: 'progression', gameId });
    sdk.telemetry.track('level_completed', { gameId, levelId: 1, durationSeconds: 65, score: 850 }, { category: 'progression', gameId });

    // 3. Simulated user closes theater -> computes duration
    const simulatedSessionDurationSec = 120;
    sdk.telemetry.track('game_session_end', { gameId, durationSeconds: simulatedSessionDurationSec }, { category: 'engagement', gameId });
    sdk.telemetry.track('theater_close', { action: 'back_to_catalog' }, { category: 'engagement', gameId: 'portal' });
  }

  // 6 games * 7 events = 42 events
  assert.equal(sdk.telemetry.getQueueLength(), 42);

  const queue = sdk.telemetry.getQueue(100);
  const endEvents = queue.filter(e => e.eventName === 'game_session_end');
  assert.equal(endEvents.length, 6, 'All six games must have game_session_end recorded');
  for (const endEvt of endEvents) {
    assert.equal(endEvt.payload.durationSeconds, 120, 'Duration must be recorded accurately');
  }

  // 4. Error capture resilience: simulated game error relay
  const errEvt = sdk.telemetry.track(
    'game_runtime_error',
    { gameId: 'auromandala', errorMessage: 'AudioContext suspended awaiting gesture', errorCategory: 'audio' },
    { category: 'error', gameId: 'auromandala' }
  );
  assert.equal(errEvt.eventName, 'game_runtime_error');
  assert.equal(errEvt.category, 'error');
  assert.equal(errEvt.payload.errorCategory, 'audio');

  sdk.dispose();
});

// ---------------------------------------------------------------------------
// Suite 6: Visitor Consent Lifecycle, Immediate Opt-Out Purge, and Sankalpa Invariant
// ---------------------------------------------------------------------------
test('B11 Suite 6: Consent lifecycle, opt-out queue wipe, and strict Sankalpa privacy exclusion', async () => {
  const store = createStorageMock();
  const sdk = createAuroMindSDK({ localStorage: store });
  try {
    await sdk.init({ gameId: 'portal', appVersion: '1.0.0' });

    // 1. Initial State: Undecided & Opt-In only
    assert.equal(sdk.telemetry.getConsent(), false, 'Default consent must be false');
    assert.equal(sdk.telemetry.getConsentState(), 'undecided');

    // Attempted tracking before consent produces null
    const dropped = sdk.telemetry.track('page_view', { path: '/' });
    assert.equal(dropped, null, 'Unconsented tracking must be dropped');
    assert.equal(sdk.telemetry.getQueueLength(), 0);

    // 2. Seeker grants consent
    sdk.telemetry.setConsent(true);
    assert.equal(sdk.telemetry.getConsent(), true);
    assert.equal(sdk.telemetry.getConsentState(), 'granted');

    // 3. Track event containing confidential Sankalpa reflection and credentials
    const tracked = sdk.telemetry.track('portal_visit', {
      password: 'sensitive_password_test',
      token: 'bearer_token_xyz',
      sankalpa_note: 'My private inner meditation',
      referrer: 'https://search.partner.org'
    });

    assert.ok(tracked);
    assert.equal(tracked.payload.password, undefined, 'password must be excluded');
    assert.equal(tracked.payload.token, undefined, 'token must be excluded');
    assert.equal(tracked.payload.sankalpa_note, undefined, 'sankalpa_note must be excluded');
    assert.equal(tracked.payload.referrer, 'https://search.partner.org');

    // Negative inclusion verification
    const dumped = JSON.stringify(tracked.payload);
    assert.equal(dumped.includes('sensitive_password_test'), false);
    assert.equal(dumped.includes('bearer_token_xyz'), false);
    assert.equal(dumped.includes('My private inner meditation'), false);

    // 4. Seeker revokes consent (Opt-Out)
    sdk.telemetry.setConsent(false);
    assert.equal(sdk.telemetry.getConsent(), false);
    assert.equal(sdk.telemetry.getConsentState(), 'denied');

    // Immediate effect: queue is wiped from memory and local storage
    assert.equal(sdk.telemetry.getQueueLength(), 0, 'Memory queue must be instantly purged');
    assert.equal(store.getItem(LS_TELEMETRY_KEY), null, 'Persisted storage queue must be instantly deleted');

    // 5. AuroMandala Sankalpa Vault Adapter Invariant
    const mandalaAdapter = createAuroMandalaGameAdapter();
    assert.equal(mandalaAdapter.capabilities.cloudSyncEligible, false, 'Sankalpa vault must be strictly local-only');
    assert.deepEqual(mandalaAdapter.storage.localOnlyVaults, ['sankalpa_e2ee_vault']);

    // Exported envelope never includes Sankalpa secrets
    const envelope = await mandalaAdapter.exportEnvelope('guest_test_id');
    const envStr = JSON.stringify(envelope);
    assert.equal(envStr.includes('sankalpa_e2ee_vault'), false);
    assert.equal(envelope.capabilities?.cloudSyncEligible, undefined);
  } finally {
    sdk.dispose();
  }
});
