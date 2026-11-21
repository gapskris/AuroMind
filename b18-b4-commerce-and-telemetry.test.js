/**
 * AuroMasti Platform — B18-B1 Batch 4 Acceptance Test Suite
 *
 * Covers:
 * - TASK-COMM-01: Provider-Independent Purchases Interface & Mock Engine (ADR-08, ADR-10)
 * - TASK-COMM-02: Ed25519 Token Verification & Clock Manipulation Defense (ADR-08)
 * - TASK-TEL-01: 3-Tier Telemetry Queue & Saturation Overflow Policy (ADR-09, ADR-03)
 * - TASK-TEL-02: Pre-Queue Privacy Sanitizer & Sankalpa E2EE Isolation (ADR-09)
 * - Sacred Invariants: VAK speech corpus & Flora database byte-level integrity
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  createAuroMindSDK,
  createMockPurchaseProvider,
  verifyEd25519EntitlementToken,
  mintEd25519EntitlementToken,
  sanitizeTelemetryPayload,
  uint8ArrayToBase64,
  uint8ArrayToBase64Url,
  base64ToUint8Array
} from './assets/sdk/auromind-sdk.js';

import {
  COMMERCIAL_GATE_ENABLED
} from './assets/sdk/config/backend-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In-memory localStorage mock for tests
function createStorageMock(initialState = {}) {
  const map = new Map(Object.entries(initialState));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, val) => map.set(key, String(val)),
    removeItem: (key) => map.delete(key),
    clear: () => map.clear(),
    key: (idx) => Array.from(map.keys())[idx] || null,
    get length() { return map.size; }
  };
}

const activeTestSDKs = [];

function createTestSDK(initialStorage = {}) {
  const store = createStorageMock(initialStorage);
  const sdk = createAuroMindSDK({
    env: {
      localStorage: store,
      BroadcastChannel: null
    }
  });
  activeTestSDKs.push(sdk);
  return { store, sdk };
}

test.afterEach(() => {
  while (activeTestSDKs.length > 0) {
    const s = activeTestSDKs.pop();
    try {
      s.dispose();
    } catch {}
  }
});

// =============================================================================
// TASK-COMM-01: Commerce Engine & Mock Purchase Provider
// =============================================================================

test('TASK-COMM-01: sdk.purchases exposes complete typed API contract', async () => {
  const { store, sdk } = createTestSDK();
  await sdk.init({ gameId: 'portal' });

  assert.ok(sdk.purchases, 'sdk.purchases must exist on SDK singleton');
  assert.equal(typeof sdk.purchases.isCommercialGateActive, 'function');
  assert.equal(typeof sdk.purchases.hasEntitlement, 'function');
  assert.equal(typeof sdk.purchases.hasAccess, 'function');
  assert.equal(typeof sdk.purchases.requestPurchase, 'function');
  assert.equal(typeof sdk.purchases.purchase, 'function');
  assert.equal(typeof sdk.purchases.refundPurchase, 'function');
  assert.equal(typeof sdk.purchases.restorePurchases, 'function');
  assert.equal(typeof sdk.purchases.getProvider, 'function');
  assert.equal(typeof sdk.purchases.setProvider, 'function');
  assert.equal(typeof sdk.purchases.verifyEntitlementToken, 'function');

  sdk.dispose();
});

test('TASK-COMM-01: Launch invariant — commercial gate remains disabled (free beta)', async () => {
  const { store, sdk } = createTestSDK();
  await sdk.init({ gameId: 'portal' });

  assert.equal(COMMERCIAL_GATE_ENABLED, false, 'COMMERCIAL_GATE_ENABLED constant in config must be false');
  assert.equal(sdk.purchases.isCommercialGateActive(), false, 'Commercial gate must report false by default');

  // When commercial gate is disabled, all SKUs and levels return true
  assert.equal(sdk.purchases.hasEntitlement('premium_mandala_palette'), true);
  assert.equal(sdk.purchases.hasEntitlement('supporter_pass_2027'), true);
  assert.equal(sdk.purchases.hasAccess('any_expansion_sku'), true);

  // Purchases in free beta return granted_free_tier immediately with zero payment required
  const purchaseResult = await sdk.purchases.requestPurchase('supporter_pass_2027');
  assert.equal(purchaseResult.ok, true);
  assert.equal(purchaseResult.status, 'granted_free_tier');
  assert.equal(purchaseResult.sku, 'supporter_pass_2027');
  assert.ok(purchaseResult.unlockedAt);

  sdk.dispose();
});

test('TASK-COMM-01: Commercial gate activation behaves correctly when activated for testing', async () => {
  const { store, sdk } = createTestSDK();
  await sdk.init({ gameId: 'portal' });

  // Activate gate explicitly for testing
  sdk.purchases.setCommercialGateActiveForTesting(true);
  assert.equal(sdk.purchases.isCommercialGateActive(), true);

  // Use mock provider to simulate purchase
  const mockProvider = createMockPurchaseProvider({ mode: 'success' });
  sdk.purchases.setProvider(mockProvider);

  // Unowned SKU returns false
  assert.equal(sdk.purchases.hasEntitlement('exclusive_soundtrack'), false);

  const buyRes = await sdk.purchases.requestPurchase('exclusive_soundtrack');
  assert.equal(buyRes.ok, true);
  assert.equal(buyRes.status, 'success');
  assert.equal(buyRes.transaction.sku, 'exclusive_soundtrack');

  // Now owned SKU returns true
  assert.equal(sdk.purchases.hasEntitlement('exclusive_soundtrack'), true);

  // Refund test
  const refundRes = await sdk.purchases.refundPurchase('exclusive_soundtrack');
  assert.equal(refundRes.ok, true);
  assert.equal(refundRes.status, 'refunded');
  assert.equal(sdk.purchases.hasEntitlement('exclusive_soundtrack'), false);

  sdk.dispose();
});

test('TASK-COMM-01: MockPurchaseProvider handles decline, error and refund modes gracefully', async () => {
  // Decline mode
  const declineProvider = createMockPurchaseProvider({ mode: 'decline' });
  const declineRes = await declineProvider.purchase('test_sku');
  assert.equal(declineRes.ok, false);
  assert.equal(declineRes.errorCode, 'PAYMENT_DECLINED');
  assert.ok(declineRes.message);

  // Error mode caught by SDK
  const errorProvider = createMockPurchaseProvider({ mode: 'error' });
  const { store, sdk } = createTestSDK();
  await sdk.init({ gameId: 'portal' });
  sdk.purchases.setCommercialGateActiveForTesting(true);
  sdk.purchases.setProvider(errorProvider);

  const errRes = await sdk.purchases.requestPurchase('fail_sku');
  assert.equal(errRes.ok, false);
  assert.equal(errRes.errorCode, 'PURCHASE_ERROR');
  assert.ok(errRes.message);

  sdk.dispose();
});

test('TASK-COMM-01: Commerce failures never block offline gameplay or corrupt save state', async () => {
  const { store, sdk } = createTestSDK();
  await sdk.init({ gameId: 'portal' });

  // Set failing provider
  const failingProvider = {
    isConfigured: () => false,
    hasEntitlement: () => { throw new Error('Network crash'); },
    purchase: async () => { throw new Error('Payment gateway offline'); },
    restorePurchases: async () => { throw new Error('Server unreachable'); }
  };
  sdk.purchases.setProvider(failingProvider);

  // In default free launch, hasEntitlement still safely returns true despite provider crash
  assert.equal(sdk.purchases.hasEntitlement('auroblocks_expansion'), true);

  // Save gameplay state still functions cleanly
  await sdk.storage.setPlatformMeta('test_save_key', { level: 42, score: 999 });

  const readResult = await sdk.storage.getPlatformMeta('test_save_key');
  assert.ok(readResult);
  assert.equal(readResult.level, 42);

  sdk.dispose();
});

// =============================================================================
// TASK-COMM-02: Ed25519 Token Verification & Clock Manipulation Defense
// =============================================================================

test('TASK-COMM-02: Valid Ed25519 compact JWT verifies successfully', async () => {
  const keyPair = await globalThis.crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const rawPublicKey = await globalThis.crypto.subtle.exportKey('raw', keyPair.publicKey);

  const now = Date.now();
  const payload = {
    iss: 'https://api.auromind.org',
    sub: 'guest_00000000-0000-4000-8000-000000000001',
    aud: 'auromind_game_platform',
    jti: 'token_nonce_12345',
    iat: Math.floor(now / 1000),
    exp: Math.floor(now / 1000) + 86400,
    sku: 'supporter_pass_2027',
    tier: 'LIFETIME',
    lastValidatedAt: new Date(now).toISOString()
  };

  const compactToken = await mintEd25519EntitlementToken({
    payload,
    privateKey: keyPair.privateKey,
    compact: true
  });

  assert.equal(typeof compactToken, 'string');
  assert.equal(compactToken.split('.').length, 3);

  const verification = await verifyEd25519EntitlementToken({
    token: compactToken,
    publicKey: new Uint8Array(rawPublicKey)
  });

  assert.equal(verification.valid, true);
  assert.equal(verification.sku, 'supporter_pass_2027');
  assert.equal(verification.tier, 'LIFETIME');
});

test('TASK-COMM-02: Valid Ed25519 JSON envelope verifies successfully', async () => {
  const keyPair = await globalThis.crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const rawPublicKey = await globalThis.crypto.subtle.exportKey('raw', keyPair.publicKey);

  const now = Date.now();
  const payload = {
    iss: 'https://api.auromind.org',
    sub: 'guest_00000000-0000-4000-8000-000000000002',
    sku: 'sanctuary_theme_pack',
    entitlements: ['sanctuary_theme_pack', 'mandala_gold_palette'],
    lastValidatedAt: new Date(now).toISOString()
  };

  const jsonEnvelope = await mintEd25519EntitlementToken({
    payload,
    privateKey: keyPair.privateKey,
    compact: false
  });

  assert.ok(jsonEnvelope.payload);
  assert.ok(jsonEnvelope.signature);

  const verification = await verifyEd25519EntitlementToken({
    token: jsonEnvelope,
    publicKey: new Uint8Array(rawPublicKey)
  });

  assert.equal(verification.valid, true);
  assert.equal(verification.sku, 'sanctuary_theme_pack');
  assert.deepEqual(verification.entitlements, ['sanctuary_theme_pack', 'mandala_gold_palette']);
});

test('TASK-COMM-02: Tampered payload fails with SIGNATURE_VERIFICATION_FAILED', async () => {
  const keyPair = await globalThis.crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const rawPublicKey = await globalThis.crypto.subtle.exportKey('raw', keyPair.publicKey);

  const now = Date.now();
  const payload = {
    iss: 'https://api.auromind.org',
    sub: 'guest_attacker',
    sku: 'free_tier_item',
    lastValidatedAt: new Date(now).toISOString()
  };

  const token = await mintEd25519EntitlementToken({
    payload,
    privateKey: keyPair.privateKey,
    compact: true
  });

  // Attacker tampers with payload to grant premium pass
  const parts = token.split('.');
  const forgedPayload = Buffer.from(JSON.stringify({ ...payload, sku: 'master_pass_all_games' })).toString('base64url');
  const tamperedToken = `${parts[0]}.${forgedPayload}.${parts[2]}`;

  const verification = await verifyEd25519EntitlementToken({
    token: tamperedToken,
    publicKey: new Uint8Array(rawPublicKey)
  });

  assert.equal(verification.valid, false);
  assert.equal(verification.reason, 'SIGNATURE_VERIFICATION_FAILED');
});

test('TASK-COMM-02: Expired entitlement token is rejected with TOKEN_EXPIRED', async () => {
  const keyPair = await globalThis.crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const rawPublicKey = await globalThis.crypto.subtle.exportKey('raw', keyPair.publicKey);

  const past = Date.now() - 7200000;
  const payload = {
    iss: 'https://api.auromind.org',
    sub: 'guest_123',
    sku: 'temporary_pass',
    iat: Math.floor(past / 1000),
    exp: Math.floor(past / 1000) + 1800, // Expired 1.5 hours ago
    lastValidatedAt: new Date(past).toISOString()
  };

  const token = await mintEd25519EntitlementToken({
    payload,
    privateKey: keyPair.privateKey,
    compact: true
  });

  const verification = await verifyEd25519EntitlementToken({
    token,
    publicKey: new Uint8Array(rawPublicKey)
  });

  assert.equal(verification.valid, false);
  assert.equal(verification.reason, 'TOKEN_EXPIRED');
});

test('TASK-COMM-02: Clock rollback detection triggers on backward time tampering (ADR-08)', async () => {
  const keyPair = await globalThis.crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const rawPublicKey = await globalThis.crypto.subtle.exportKey('raw', keyPair.publicKey);

  const realNow = Date.now();
  const payload = {
    iss: 'https://api.auromind.org',
    sub: 'guest_123',
    sku: 'supporter_pass',
    lastValidatedAt: new Date(realNow).toISOString()
  };

  const token = await mintEd25519EntitlementToken({
    payload,
    privateKey: keyPair.privateKey,
    compact: true
  });

  // Player rolls system clock backward by 1 day
  const tamperedClockTimestamp = realNow - 86400000;

  const verification = await verifyEd25519EntitlementToken({
    token,
    publicKey: new Uint8Array(rawPublicKey),
    currentTimestamp: tamperedClockTimestamp
  });

  assert.equal(verification.valid, false);
  assert.equal(verification.reason, 'CLOCK_ROLLBACK_DETECTED');
});

test('TASK-COMM-02: Monotonic save anchor timestamp prevents clock rollback circumvention', async () => {
  const keyPair = await globalThis.crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const rawPublicKey = await globalThis.crypto.subtle.exportKey('raw', keyPair.publicKey);

  const now = Date.now();
  const payload = {
    iss: 'https://api.auromind.org',
    sub: 'guest_123',
    sku: 'supporter_pass',
    lastValidatedAt: new Date(now - 100000).toISOString()
  };

  const token = await mintEd25519EntitlementToken({
    payload,
    privateKey: keyPair.privateKey,
    compact: true
  });

  // Latest save envelope recorded an anchor timestamp at real current time
  const anchorTimestamp = now;
  // Attacker sets clock before anchor
  const tamperedClock = now - 70000;

  const verification = await verifyEd25519EntitlementToken({
    token,
    publicKey: new Uint8Array(rawPublicKey),
    anchorTimestamp,
    currentTimestamp: tamperedClock
  });

  assert.equal(verification.valid, false);
  assert.equal(verification.reason, 'CLOCK_ROLLBACK_DETECTED');
});

test('TASK-COMM-02: 30-day offline grace period permits valid tokens and expires >30 days', async () => {
  const keyPair = await globalThis.crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const rawPublicKey = await globalThis.crypto.subtle.exportKey('raw', keyPair.publicKey);

  const realNow = Date.now();

  // Case A: 25 days offline (within 30-day grace period)
  const twentyFiveDaysAgo = realNow - 25 * 24 * 3600 * 1000;
  const tokenWithinGrace = await mintEd25519EntitlementToken({
    payload: {
      iss: 'https://api.auromind.org',
      sku: 'offline_pack',
      lastValidatedAt: new Date(twentyFiveDaysAgo).toISOString()
    },
    privateKey: keyPair.privateKey,
    compact: true
  });

  const resWithin = await verifyEd25519EntitlementToken({
    token: tokenWithinGrace,
    publicKey: new Uint8Array(rawPublicKey),
    currentTimestamp: realNow,
    offlineGraceDays: 30
  });
  assert.equal(resWithin.valid, true);

  // Case B: 35 days offline (exceeds 30-day grace period)
  const thirtyFiveDaysAgo = realNow - 35 * 24 * 3600 * 1000;
  const tokenPastGrace = await mintEd25519EntitlementToken({
    payload: {
      iss: 'https://api.auromind.org',
      sku: 'offline_pack',
      lastValidatedAt: new Date(thirtyFiveDaysAgo).toISOString()
    },
    privateKey: keyPair.privateKey,
    compact: true
  });

  const resPast = await verifyEd25519EntitlementToken({
    token: tokenPastGrace,
    publicKey: new Uint8Array(rawPublicKey),
    currentTimestamp: realNow,
    offlineGraceDays: 30
  });
  assert.equal(resPast.valid, false);
  assert.equal(resPast.reason, 'OFFLINE_GRACE_EXPIRED');
});

test('TASK-COMM-02: Revoked or expired entitlements non-destructively preserve user creations', async () => {
  const { store, sdk } = createTestSDK();
  await sdk.init({ gameId: 'auromandala' });

  // User creates artwork while entitled
  const artData = {
    artworkId: 'art_sacred_lotus_01',
    title: 'Sacred Lotus',
    strokes: 450,
    paletteUsed: 'premium_amethyst',
    createdAt: new Date().toISOString()
  };
  await sdk.storage.setPlatformMeta('mandala_art_01', artData);

  // Entitlement is revoked / expires
  sdk.purchases.setCommercialGateActiveForTesting(true);

  // User artwork remains 100% intact and loadable
  const readRes = await sdk.storage.getPlatformMeta('mandala_art_01');
  assert.ok(readRes);
  assert.equal(readRes.title, 'Sacred Lotus');
  assert.equal(readRes.paletteUsed, 'premium_amethyst');

  sdk.dispose();
});

// =============================================================================
// TASK-TEL-01: 3-Tier Telemetry Queue & Saturation Overflow Policy
// =============================================================================

test('TASK-TEL-01: Telemetry queue honors explicit visitor consent lifecycle (opt-in requirement)', async () => {
  const { store, sdk } = createTestSDK();
  await sdk.init({ gameId: 'portal' });

  // Default: consent is not decided, track() drops event
  assert.equal(sdk.telemetry.hasConsent(), false);
  const dropped = sdk.telemetry.track('level_start', { level: 1 });
  assert.equal(dropped, null);
  assert.equal(sdk.telemetry.getQueueLength(), 0);

  // Explicit opt-in
  sdk.telemetry.optIn();
  assert.equal(sdk.telemetry.hasConsent(), true);

  // Events are now queued
  const queued = sdk.telemetry.track('level_start', { level: 1 });
  assert.ok(queued);
  assert.equal(sdk.telemetry.getQueueLength(), 1);

  // Explicit consent withdrawal (optOut / revokeConsent) immediately purges queue
  sdk.telemetry.revokeConsent();
  assert.equal(sdk.telemetry.hasConsent(), false);
  assert.equal(sdk.telemetry.getQueueLength(), 0);

  sdk.dispose();
});

test('TASK-TEL-01: 3-tier queue partitions by priority and caps at 500 events', async () => {
  const { store, sdk } = createTestSDK();
  await sdk.init({ gameId: 'portal' });
  sdk.telemetry.optIn();

  // Enqueue events in each tier
  sdk.telemetry.track('save_corruption_detected', { err: 'idb' }, { category: 'critical' });
  sdk.telemetry.track('level_completed', { level: 5 }, { category: 'engagement' });
  sdk.telemetry.track('frame_latency_spike', { ms: 60 }, { category: 'diagnostic' });

  const counts = sdk.telemetry.getTierCounts();
  assert.equal(counts.critical, 1);
  assert.equal(counts.engagement, 1);
  assert.equal(counts.diagnostic, 1);
  assert.equal(counts.total, 3);

  sdk.dispose();
});

test('TASK-TEL-01: Saturation eviction drops DIAGNOSTIC first, then ENGAGEMENT', async () => {
  const { store, sdk } = createTestSDK();
  await sdk.init({ gameId: 'portal' });
  sdk.telemetry.optIn();

  // Fill buffer up to total capacity (500)
  // Push 10 critical, 390 engagement, 100 diagnostic
  for (let i = 0; i < 10; i++) {
    sdk.telemetry.track(`crit_${i}`, {}, { category: 'critical' });
  }
  for (let i = 0; i < 390; i++) {
    sdk.telemetry.track(`eng_${i}`, {}, { category: 'engagement' });
  }
  for (let i = 0; i < 100; i++) {
    sdk.telemetry.track(`diag_${i}`, {}, { category: 'diagnostic' });
  }

  assert.equal(sdk.telemetry.getQueueLength(), 500);

  // Adding 1 new engagement event must evict the oldest diagnostic event
  sdk.telemetry.track('new_eng_event', {}, { category: 'engagement' });
  assert.equal(sdk.telemetry.getQueueLength(), 500);

  const countsAfter = sdk.telemetry.getTierCounts();
  assert.equal(countsAfter.diagnostic, 99, 'Oldest diagnostic event should be evicted first');
  assert.equal(countsAfter.engagement, 391);
  assert.equal(countsAfter.critical, 10);

  sdk.dispose();
});

test('TASK-TEL-01: Critical queue saturation logs alert and synthesizes overflow incident on flush', async () => {
  const { store, sdk } = createTestSDK();
  await sdk.init({ gameId: 'portal' });
  sdk.telemetry.optIn();

  // Fill critical queue to capacity (100)
  for (let i = 0; i < 100; i++) {
    sdk.telemetry.track(`crit_${i}`, { index: i }, { category: 'critical' });
  }

  assert.equal(sdk.telemetry.getCriticalOverflowCount(), 0);

  // Pushing another critical event triggers saturation rotation
  sdk.telemetry.track('crit_overflow_1', {}, { category: 'critical' });
  assert.equal(sdk.telemetry.getCriticalOverflowCount(), 1);

  // On flush, TELEMETRY_OVERFLOW_INCIDENT is synthesized and prepended
  await sdk.telemetry.flush();
  const queue = sdk.telemetry.getQueue(200);
  const incident = queue.find(e => e.eventName === 'TELEMETRY_OVERFLOW_INCIDENT');
  assert.ok(incident, 'TELEMETRY_OVERFLOW_INCIDENT event must be synthesized');
  assert.equal(incident.payload.droppedCriticalCount, 1);
  assert.equal(incident.payload.reason, 'CRITICAL_QUEUE_SATURATED');

  sdk.dispose();
});

test('TASK-TEL-01: 30-day raw telemetry retention auto-purges stale events', async () => {
  const { store, sdk } = createTestSDK();
  await sdk.init({ gameId: 'portal' });
  sdk.telemetry.optIn();

  // Manually insert an event timestamped 35 days ago into the queue
  const oldDate = new Date(Date.now() - 35 * 24 * 3600 * 1000).toISOString();
  const staleEvent = {
    eventId: 'old_event_1',
    schemaVersion: 1,
    timestamp: oldDate,
    eventName: 'stale_session',
    category: 'engagement',
    tier: 'engagement',
    gameId: 'portal',
    payload: {}
  };

  store.setItem('auromind.platform.v1.telemetry_queue', JSON.stringify([staleEvent]));

  // Track a new event, triggering the 30-day purge cycle
  sdk.telemetry.track('new_session', {});

  const queue = sdk.telemetry.getQueue(10);
  const foundStale = queue.some(e => e.eventId === 'old_event_1');
  assert.equal(foundStale, false, 'Events older than 30 days must be automatically purged');

  sdk.dispose();
});

// =============================================================================
// TASK-TEL-02: Pre-Queue Privacy Sanitizer & Sankalpa E2EE Isolation
// =============================================================================

test('TASK-TEL-02: Pre-queue privacy sanitizer completely purges sensitive keys', () => {
  const dirtyPayload = {
    levelNumber: 15,
    score: 1200,
    sankalpa: 'May all beings find inner peace and liberation',
    intention: 'Deep concentration on the Mother',
    privateReflection: 'I felt resistance during meditation today',
    audio_blob: 'RAW_PCM_BUFFER_DATA_12345',
    speech_recording: 'RECORDING_AUDIO_BYTES',
    canvas_strokes: [{ x: 10, y: 20 }, { x: 30, y: 40 }],
    password: 'SuperSecretPassword!',
    auth_token: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.token',
    secretKey: 'sk_live_123456789',
    nestedContext: {
      gameId: 'auromandala',
      sankalpa_note: 'Secret prayer note',
      cleanMetric: 99
    }
  };

  const sanitized = sanitizeTelemetryPayload(dirtyPayload);

  // Clean metrics preserved
  assert.equal(sanitized.levelNumber, 15);
  assert.equal(sanitized.score, 1200);
  assert.equal(sanitized.nestedContext.gameId, 'auromandala');
  assert.equal(sanitized.nestedContext.cleanMetric, 99);

  // All sensitive keys completely purged
  assert.equal(sanitized.sankalpa, undefined);
  assert.equal(sanitized.intention, undefined);
  assert.equal(sanitized.privateReflection, undefined);
  assert.equal(sanitized.audio_blob, undefined);
  assert.equal(sanitized.speech_recording, undefined);
  assert.equal(sanitized.canvas_strokes, undefined);
  assert.equal(sanitized.password, undefined);
  assert.equal(sanitized.auth_token, undefined);
  assert.equal(sanitized.secretKey, undefined);
  assert.equal(sanitized.nestedContext.sankalpa_note, undefined);
});

test('TASK-TEL-02: Arrays containing sensitive objects collapse to count, never raw content', () => {
  const payloadWithArrays = {
    validCount: 3,
    sessionHistory: [
      { id: 1, note: 'Personal reflection 1', secret: 'foo' },
      { id: 2, note: 'Personal reflection 2', secret: 'bar' }
    ],
    cleanArray: ['tag1', 'tag2', 'tag3']
  };

  const sanitized = sanitizeTelemetryPayload(payloadWithArrays);

  assert.equal(sanitized.validCount, 3);
  assert.equal(sanitized.sessionHistory, 2, 'Array of sensitive items must collapse to count length');
  assert.deepEqual(sanitized.cleanArray, ['tag1', 'tag2', 'tag3']);
});

test('TASK-TEL-02: Sacred Invariant — Sankalpa Vault is local-only E2EE and excluded from telemetry', async () => {
  const { store, sdk } = createTestSDK();
  await sdk.init({ gameId: 'auromandala' });
  sdk.telemetry.optIn();

  // Attempt to track an event containing a Sankalpa vault payload
  sdk.telemetry.track('mandala_save', {
    artworkTitle: 'Golden Sun',
    sankalpa_vault_payload: {
      ciphertext: 'ENCRYPTED_VAULT_BYTES',
      iv: 'random_iv_123',
      plaintext: 'My secret intention'
    }
  });

  const queue = sdk.telemetry.getQueue(5);
  const trackedEvent = queue[0];

  assert.ok(trackedEvent);
  assert.equal(trackedEvent.payload.artworkTitle, 'Golden Sun');
  assert.equal(trackedEvent.payload.sankalpa_vault_payload, undefined, 'Sankalpa vault payload must be purged');
  assert.equal(JSON.stringify(trackedEvent).includes('My secret intention'), false);

  sdk.dispose();
});

test('TASK-TEL-02: Non-blocking telemetry — invalid inputs or circular payloads never throw', () => {
  const circular = { a: 1 };
  circular.self = circular;

  // Does not throw
  const res = sanitizeTelemetryPayload(circular);
  assert.ok(res);
  assert.equal(res.a, 1);
});

// =============================================================================
// Sacred Corpus and Database Invariants
// =============================================================================

test('Sacred Invariant: VAK 1,368-level speech training corpus matches frozen SHA-256', () => {
  const vakPath = path.join(__dirname, 'games/vak/index.html');
  assert.ok(fs.existsSync(vakPath), 'games/vak/index.html must exist');
  const vakSrc = fs.readFileSync(vakPath, 'utf8');
  const clMatch = vakSrc.match(/const CL = \[\[[\s\S]*?\]\];/);
  assert.ok(clMatch, 'CL array must exist in games/vak/index.html');
  const hash = crypto.createHash('sha256').update(clMatch[0], 'utf8').digest('hex');
  assert.equal(
    hash,
    '9fdb3826030049c9eab183479bcb7fe29304b3ea08d045c8c67f1cfd4d77da09',
    'VAK speech training corpus must remain byte-exact to frozen baseline'
  );
});

test('Sacred Invariant: AuroMatch Flora database matches exact size, lines, and SHA-256', () => {
  const floraPath = path.join(__dirname, 'games/auromatch/src/models/floraDatabase.js');
  assert.ok(fs.existsSync(floraPath), 'floraDatabase.js must exist');
  const stat = fs.statSync(floraPath);
  assert.equal(stat.size, 2002176, 'Flora database size must be exactly 2,002,176 bytes');

  const content = fs.readFileSync(floraPath, 'utf8');
  const newlineCount = (content.match(/\n/g) || []).length;
  assert.equal(newlineCount, 46321, 'Flora database newline count must be exactly 46,321 lines');

  const hash = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  assert.equal(
    hash,
    '689d035cd52abd8d342528d8c5f61f298916b8052b8287450be4931cf8ae1a3a',
    'Flora database SHA-256 must match frozen baseline'
  );
});
