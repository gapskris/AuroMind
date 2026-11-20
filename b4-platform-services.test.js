/**
 * AuroMind Shared Platform SDK — Batch B4 Platform Services Test Suite
 *
 * Verifies provider-independent platform services:
 *   1. Centralized logging and diagnostics (AuroMind.logging, AuroMind.diagnostics)
 *   2. Telemetry and event collection (AuroMind.telemetry, AuroMind.analytics)
 *   3. Feature flags and configuration management (AuroMind.config)
 *   4. Player profile and account abstractions (AuroMind.player, AuroMind.profile)
 *   5. Entitlements and monetization abstractions (AuroMind.entitlements)
 *   6. Owner Analytics data contract & metric calculation models
 *   7. Zero cloud calls, privacy consent enforcement, and zero Sankalpa leakage
 *
 * Runs natively with Node.js test runner (`node --test`). Zero external dependencies.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createAuroMindSDK,
  SDK_VERSION,
  LS_GUEST_KEY,
  LS_LOGS_KEY,
  LS_TELEMETRY_KEY,
  LS_CONSENT_KEY,
  LS_CONFIG_KEY,
  LS_PROFILE_KEY,
  LS_ENTITLEMENTS_KEY,
  redactSensitive
} from './assets/sdk/auromind-sdk.js';

import {
  calculateMetrics,
  validateEventEnvelope,
  EVENT_CATEGORIES,
  BENCHMARK_BASELINES
} from './owner-analytics/models/analyticsDataContract.js';

function createStorageMock(initialState = {}) {
  const store = new Map(Object.entries(initialState));
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => {
      store.set(key, String(value));
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (i) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
    _dump: () => Object.fromEntries(store.entries())
  };
}

// ---------------------------------------------------------------------------
// Suite 1: Centralized Logging and Diagnostics
// ---------------------------------------------------------------------------
test('Suite 1.1: Logging supports levels, filtering, and buffer boundaries', async () => {
  const sharedStorage = createStorageMock();
  const sdk = createAuroMindSDK({ env: { localStorage: sharedStorage } });
  await sdk.init({ gameId: 'portal' });

  // Default level is INFO
  assert.equal(sdk.logging.getLevel(), 'INFO');

  // DEBUG should be ignored at INFO level
  const debugEntry = sdk.logging.debug('portal', 'This should be filtered');
  assert.equal(debugEntry, null);

  // INFO should be recorded
  const infoEntry = sdk.logging.info('portal', 'Operational info message', { count: 1 });
  assert.ok(infoEntry);
  assert.equal(infoEntry.level, 'INFO');
  assert.equal(infoEntry.tag, 'portal');

  // Change level to DEBUG
  sdk.logging.setLevel('DEBUG');
  assert.equal(sdk.logging.getLevel(), 'DEBUG');
  const nextDebug = sdk.logging.debug('portal', 'Debug is now allowed');
  assert.ok(nextDebug);
  assert.equal(nextDebug.level, 'DEBUG');

  // Buffer length check
  const logs = sdk.logging.getRecentLogs(10);
  assert.ok(logs.length >= 2);

  // Min level filtering in getRecentLogs
  const errorEntry = sdk.logging.error('portal', 'Test error');
  assert.ok(errorEntry);
  const onlyErrors = sdk.logging.getRecentLogs(10, 'ERROR');
  assert.equal(onlyErrors.length, 1);
  assert.equal(onlyErrors[0].level, 'ERROR');

  // localStorage persistence check
  const storedLogsRaw = sharedStorage.getItem(LS_LOGS_KEY);
  assert.ok(storedLogsRaw);
  const storedLogs = JSON.parse(storedLogsRaw);
  assert.ok(Array.isArray(storedLogs));
  assert.ok(storedLogs.length >= 3);

  // Clear logs
  sdk.logging.clear();
  assert.equal(sdk.logging.getRecentLogs().length, 0);
  assert.equal(sharedStorage.getItem(LS_LOGS_KEY), null);

  sdk.dispose();
});

test('Suite 1.2: Redaction sanitizes passwords, tokens, and Sankalpa secrets', () => {
  const dirty = {
    username: 'seeker1',
    password: 'superSecretPassword123!',
    token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.doNotLeak',
    authToken: 'Bearer xyz987',
    sankalpa_vault_key: 'aes_gcm_secret_key_bits',
    normalText: 'Clean non-sensitive narrative',
    email: 'seeker@auromind.org',
    nested: {
      privateEncryptionKey: 'raw_key_material',
      levelScore: 100
    }
  };

  const clean = redactSensitive(dirty);
  assert.equal(clean.username, 'seeker1');
  assert.equal(clean.password, '[REDACTED]');
  assert.equal(clean.token, '[REDACTED]');
  assert.equal(clean.authToken, '[REDACTED]');
  assert.equal(clean.sankalpa_vault_key, '[REDACTED]');
  assert.equal(clean.normalText, 'Clean non-sensitive narrative');
  assert.equal(clean.email, '[REDACTED]');
  assert.equal(clean.nested.privateEncryptionKey, '[REDACTED]');
  assert.equal(clean.nested.levelScore, 100);
});

test('Suite 1.3: Diagnostics export bundles health, storage, config, and logs safely', async () => {
  const sharedStorage = createStorageMock();
  const sdk = createAuroMindSDK({ env: { localStorage: sharedStorage } });
  await sdk.init({ gameId: 'vak' });

  sdk.logging.info('vak', 'Sanctuary session opened');

  const diag = sdk.diagnostics.exportDiagnostics();
  assert.ok(diag.exportedAt);
  assert.equal(diag.sdkVersion, SDK_VERSION);
  assert.equal(diag.gameId, 'vak');
  assert.ok(diag.sessionId.startsWith('sess_'));
  assert.ok(diag.identity.guestId);
  assert.equal(typeof diag.storageHealth, 'object');
  assert.ok(Array.isArray(diag.logs));
  assert.ok(diag.logs.length >= 1);

  sdk.dispose();
});

// ---------------------------------------------------------------------------
// Suite 2: Telemetry & Event Collection
// ---------------------------------------------------------------------------
test('Suite 2.1: Telemetry enforces consent opt-in and drops events when opted out', async () => {
  const sharedStorage = createStorageMock();
  const sdk = createAuroMindSDK({ env: { localStorage: sharedStorage } });
  await sdk.init({ gameId: 'portal' });

  // Default consent is false (opt-in privacy default)
  assert.equal(sdk.telemetry.hasConsent(), false);

  // Tracking without consent is dropped
  const dropped = sdk.telemetry.track('game_launch', { gameId: 'vak' });
  assert.equal(dropped, null);
  assert.equal(sdk.telemetry.getQueueLength(), 0);

  // User opts in
  sdk.telemetry.optIn();
  assert.equal(sdk.telemetry.hasConsent(), true);
  assert.equal(sharedStorage.getItem(LS_CONSENT_KEY), 'true');

  // Tracking with consent queues event
  const evt = sdk.telemetry.track('game_launch', { gameId: 'vak' }, { category: 'engagement' });
  assert.ok(evt);
  assert.ok(evt.eventId);
  assert.equal(evt.schemaVersion, 1);
  assert.equal(evt.eventName, 'game_launch');
  assert.equal(evt.category, 'engagement');
  assert.equal(evt.payload.gameId, 'vak');
  assert.equal(sdk.telemetry.getQueueLength(), 1);

  // Queued event persisted in localStorage
  const storedQueue = JSON.parse(sharedStorage.getItem(LS_TELEMETRY_KEY));
  assert.equal(storedQueue.length, 1);

  // Opting out clears queue for privacy
  sdk.telemetry.optOut();
  assert.equal(sdk.telemetry.hasConsent(), false);
  assert.equal(sdk.telemetry.getQueueLength(), 0);
  assert.equal(sharedStorage.getItem(LS_TELEMETRY_KEY), null);

  sdk.dispose();
});

test('Suite 2.2: Telemetry transport flush handles offline local buffering and pluggable providers', async () => {
  const sharedStorage = createStorageMock();
  const sdk = createAuroMindSDK({ env: { localStorage: sharedStorage } });
  await sdk.init({ gameId: 'auromatch' });
  sdk.telemetry.optIn();

  sdk.telemetry.track('tile_match', { matchCount: 3 });
  assert.equal(sdk.telemetry.getQueueLength(), 1);

  // In offline mode (null transport), flush safely buffers locally
  const flushRes = await sdk.telemetry.flush();
  assert.equal(flushRes.ok, true);
  assert.equal(sdk.telemetry.getQueueLength(), 1);

  // Register a custom mock telemetry transport provider
  let receivedBatch = [];
  sdk.registerProviders({
    telemetryTransport: {
      providerName: 'mock-transport',
      isConfigured: () => true,
      sendEvents: async (events) => {
        receivedBatch = [...events];
        return { ok: true, sentCount: events.length };
      }
    }
  });

  const nextFlush = await sdk.telemetry.flush();
  assert.equal(nextFlush.ok, true);
  assert.equal(nextFlush.sentCount, 1);
  assert.equal(receivedBatch.length, 1);
  assert.equal(sdk.telemetry.getQueueLength(), 0);

  sdk.dispose();
});

// ---------------------------------------------------------------------------
// Suite 3: Feature Flags & Configuration Management
// ---------------------------------------------------------------------------
test('Suite 3.1: Config provides typed getters, defaults, and local overrides', async () => {
  const sharedStorage = createStorageMock();
  const sdk = createAuroMindSDK({ env: { localStorage: sharedStorage } });
  await sdk.init({ gameId: 'portal' });

  // Default values
  assert.equal(sdk.config.getBoolean('portal.seniorModeDefault'), false);
  assert.equal(sdk.config.getBoolean('platform.commercialGatesActive'), false);
  assert.equal(sdk.config.getString('games.vak.audioPresets'), 'standard');
  assert.equal(sdk.config.getNumber('games.vak.micSensitivity'), 1.0);

  // Feature enabled helper
  assert.equal(sdk.config.isFeatureEnabled('portal.theaterAutoplay'), true);
  assert.equal(sdk.config.isFeatureEnabled('platform.commercialGatesActive'), false);

  // Local override
  sdk.config.setOverride('platform.commercialGatesActive', true);
  assert.equal(sdk.config.isFeatureEnabled('platform.commercialGatesActive'), true);

  // Local override persisted in localStorage
  const storedConfig = JSON.parse(sharedStorage.getItem(LS_CONFIG_KEY));
  assert.equal(storedConfig['platform.commercialGatesActive'], true);

  // Clear override restores default
  sdk.config.clearOverride('platform.commercialGatesActive');
  assert.equal(sdk.config.isFeatureEnabled('platform.commercialGatesActive'), false);

  sdk.dispose();
});

// ---------------------------------------------------------------------------
// Suite 4: Player Profile & Account Abstraction
// ---------------------------------------------------------------------------
test('Suite 4.1: Player profile tracks preferences, stats, and provides export/delete abstractions', async () => {
  const sharedStorage = createStorageMock();
  const sdk = createAuroMindSDK({ env: { localStorage: sharedStorage } });
  await sdk.init({ gameId: 'portal' });

  const prof = sdk.player.getProfile();
  assert.ok(prof.guestId);
  assert.equal(prof.displayName, 'Guest Seeker');
  assert.equal(prof.preferences.seniorMode, false);
  assert.equal(prof.preferences.ambientVolume, 0.5);

  // Update preferences
  sdk.player.updatePreferences({ seniorMode: true, ambientVolume: 0.75 });
  const updatedPrefs = sdk.player.getPreferences();
  assert.equal(updatedPrefs.seniorMode, true);
  assert.equal(updatedPrefs.ambientVolume, 0.75);

  // Update display name
  sdk.player.setDisplayName('Ananda Seeker');
  assert.equal(sdk.player.getDisplayName(), 'Ananda Seeker');

  // Verify persistence in LS_PROFILE_KEY
  const storedProf = JSON.parse(sharedStorage.getItem(LS_PROFILE_KEY));
  assert.equal(storedProf.displayName, 'Ananda Seeker');
  assert.equal(storedProf.preferences.seniorMode, true);

  // User data export
  const exportData = await sdk.player.exportUserData();
  assert.ok(exportData.exportedAt);
  assert.equal(exportData.profile.displayName, 'Ananda Seeker');
  assert.ok(exportData.guestIdentity.guestId);

  // User data deletion
  const deleted = await sdk.player.deleteUserData();
  assert.equal(deleted, true);
  assert.equal(sharedStorage.getItem(LS_PROFILE_KEY), null);

  sdk.dispose();
});

// ---------------------------------------------------------------------------
// Suite 5: Entitlements & Monetization Abstraction
// ---------------------------------------------------------------------------
test('Suite 5.1: Entitlements handle gate inactive, local grants, and verified:false trust boundary', async () => {
  const sharedStorage = createStorageMock();
  const sdk = createAuroMindSDK({ env: { localStorage: sharedStorage } });
  await sdk.init({ gameId: 'vak' });

  // While commercial gates are inactive (B4 default), all games and levels are accessible
  assert.equal(sdk.entitlements.isCommercialGateActive(), false);
  assert.equal(sdk.entitlements.hasAccess('vak', 500), true);
  assert.equal(sdk.entitlements.canAccessLevel('auromatch', 100), true);

  // Activate commercial gate via config override
  sdk.config.setOverride('platform.commercialGatesActive', true);
  assert.equal(sdk.entitlements.isCommercialGateActive(), true);

  // Free tier is still accessible, but higher levels require entitlement
  assert.equal(sdk.entitlements.canAccessLevel('vak', 10, 20), true);
  assert.equal(sdk.entitlements.canAccessLevel('vak', 50, 20), false);

  // Grant local entitlement
  const grant = sdk.entitlements.grantLocalEntitlement('vak', 'full');
  assert.ok(grant);
  assert.equal(grant.gameId, 'vak');
  assert.equal(grant.tier, 'full');
  assert.equal(grant.verified, false); // Local trust boundary requirement
  assert.equal(grant.source, 'local');

  // Now has access
  assert.equal(sdk.entitlements.canAccessLevel('vak', 50, 20), true);

  // Revoke entitlement
  sdk.entitlements.revokeLocalEntitlement('vak');
  assert.equal(sdk.entitlements.canAccessLevel('vak', 50, 20), false);

  // Purchase provider fallback check
  const purchaseRes = await sdk.entitlements.purchase({ sku: 'vak_full' });
  assert.equal(purchaseRes.ok, false);
  assert.equal(purchaseRes.errorCode, 'PURCHASE_PROVIDER_NOT_CONFIGURED');

  sdk.dispose();
});

// ---------------------------------------------------------------------------
// Suite 6: Owner Analytics Data Contract & Metrics Calculation
// ---------------------------------------------------------------------------
test('Suite 6.1: Owner Analytics data contract validates event schemas and aggregates live metrics', () => {
  // Validate schema
  const validEvt = {
    eventId: '550e8400-e29b-41d4-a716-446655440000',
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    eventName: 'game_session_start',
    category: 'lifecycle',
    gameId: 'vak',
    sessionId: 'sess_123',
    guestId: '550e8400-e29b-41d4-a716-446655440000',
    payload: { mode: 'native' }
  };
  const vResult = validateEventEnvelope(validEvt);
  assert.equal(vResult.valid, true);

  const invalidEvt = {
    eventId: null,
    schemaVersion: 2,
    eventName: '',
    category: 'unknown_cat'
  };
  const invResult = validateEventEnvelope(invalidEvt);
  assert.equal(invResult.valid, false);
  assert.ok(invResult.errors.length >= 3);

  // Metric calculations
  const sampleEvents = [
    validEvt,
    {
      eventId: '550e8400-e29b-41d4-a716-446655440001',
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      eventName: 'game_launch',
      category: 'engagement',
      gameId: 'portal',
      sessionId: 'sess_123',
      payload: { gameId: 'auromatch' }
    }
  ];

  const metrics = calculateMetrics(sampleEvents, { telemetry: { consent: true }, storageHealth: { idbAvailable: true } });
  assert.ok(metrics.summary.totalRegisteredSeekers >= BENCHMARK_BASELINES.totalSeekers);
  assert.equal(metrics.liveTelemetry.bufferedEventCount, 2);
  assert.equal(metrics.liveTelemetry.activeLiveSessions, 1);
  assert.equal(metrics.liveTelemetry.gameLaunches['auromatch'], 1);
  assert.equal(metrics.privacy.consentActive, true);
});

// ---------------------------------------------------------------------------
// Suite 7: Zero Cloud Calls & Data Protection Guarantees
// ---------------------------------------------------------------------------
test('Suite 7.1: Zero network requests made by SDK platform services in B4', async () => {
  const sharedStorage = createStorageMock();
  let networkAttempted = false;

  // Environment with a throwing global fetch to ensure zero cloud requests
  const throwingFetch = () => {
    networkAttempted = true;
    throw new Error('NETWORK_VIOLATION: No external requests allowed in B4');
  };

  const sdk = createAuroMindSDK({
    env: {
      localStorage: sharedStorage,
      fetch: throwingFetch
    }
  });

  await sdk.init({ gameId: 'portal' });
  sdk.logging.info('test', 'Diagnostic log');
  sdk.telemetry.optIn();
  sdk.telemetry.track('test_event', { key: 'value' });
  await sdk.telemetry.flush();
  await sdk.config.refresh();
  await sdk.entitlements.refresh();
  await sdk.player.getProfile();

  assert.equal(networkAttempted, false, 'SDK must remain strictly local-first with zero network calls in B4');
  sdk.dispose();
});
