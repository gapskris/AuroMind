/**
 * B19.5-09 — Entitlements and Commerce Behavioral Test Suite
 *
 * Validates:
 * 1. Server-authoritative Ed25519 entitlement verification (compact JWT & envelope).
 * 2. Key rotation window (dual-key verification) and emergency key revocation list.
 * 3. Exact 30-calendar-day offline grace (2,592,000,000 ms) enforcement.
 * 4. Clock manipulation defense (backward jumps behind last-validated/anchor, forward jumps past grace).
 * 5. Launch invariant: COMMERCIAL_GATE_ENABLED = false, free beta access preserved.
 * 6. Razorpay contract validation: HMAC-SHA256 signature verification (constant-time).
 * 7. Webhook signature validation and replay-attack defenses.
 * 8. Order creation idempotency and payment replay prevention.
 * 9. Resilience: Commerce / payment failures never throw or block core gameplay and saves.
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  createAuroMindSDK,
  createMockPurchaseProvider,
  verifyEd25519EntitlementToken,
  mintEd25519EntitlementToken
} from './assets/sdk/auromind-sdk.js';

import {
  COMMERCIAL_GATE_ENABLED
} from './assets/sdk/config/backend-config.js';

import {
  mintVersionedEntitlementToken,
  verifyVersionedEntitlement,
  verifySignedRemoteConfig,
  OFFLINE_GRACE_MS
} from './assets/sdk/entitlement-revocation.js';

import {
  createRazorpayPurchaseProvider,
  validateRazorpayPaymentSignature,
  validateRazorpayWebhookSignature
} from './assets/sdk/providers/razorpay/razorpay-commerce-provider.js';

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

describe('B19.5-09: Ed25519 Entitlement Verification & Key Rotation', () => {

  test('9.1: Server-authoritative Ed25519 token verifies correctly with active key', async () => {
    const keyPair = await globalThis.crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    const rawPublicKey = await globalThis.crypto.subtle.exportKey('raw', keyPair.publicKey);

    const now = Date.now();
    const payload = {
      iss: 'https://api.auromind.org',
      sub: 'usr_verified_player_1',
      sku: 'supporter_pass_2027',
      tier: 'LIFETIME',
      iat: Math.floor(now / 1000),
      lastValidatedAt: new Date(now).toISOString()
    };

    const token = await mintEd25519EntitlementToken({
      payload,
      privateKey: keyPair.privateKey,
      compact: true
    });

    const result = await verifyEd25519EntitlementToken({
      token,
      publicKey: new Uint8Array(rawPublicKey),
      currentTimestamp: now
    });

    assert.equal(result.valid, true);
    assert.equal(result.sku, 'supporter_pass_2027');
    assert.equal(result.tier, 'LIFETIME');
  });

  test('9.2: Key rotation window verifies tokens from old and new keys (dual-key keystore)', async () => {
    const keyPairV1 = await globalThis.crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    const keyPairV2 = await globalThis.crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);

    const keyStore = new Map([
      ['auromasti-ed25519-2026-v1', keyPairV1.publicKey],
      ['auromasti-ed25519-2026-v2', keyPairV2.publicKey]
    ]);

    const payloadV1 = { sku: 'expansion_pack_1', lastValidatedAt: new Date().toISOString() };
    const tokenV1 = await mintVersionedEntitlementToken({
      payload: payloadV1,
      privateKey: keyPairV1.privateKey,
      kid: 'auromasti-ed25519-2026-v1'
    });

    const payloadV2 = { sku: 'expansion_pack_2', lastValidatedAt: new Date().toISOString() };
    const tokenV2 = await mintVersionedEntitlementToken({
      payload: payloadV2,
      privateKey: keyPairV2.privateKey,
      kid: 'auromasti-ed25519-2026-v2'
    });

    const res1 = await verifyVersionedEntitlement({ token: tokenV1, keyStore });
    assert.equal(res1.valid, true);
    assert.equal(res1.kid, 'auromasti-ed25519-2026-v1');
    assert.equal(res1.payload.sku, 'expansion_pack_1');

    const res2 = await verifyVersionedEntitlement({ token: tokenV2, keyStore });
    assert.equal(res2.valid, true);
    assert.equal(res2.kid, 'auromasti-ed25519-2026-v2');
    assert.equal(res2.payload.sku, 'expansion_pack_2');
  });

  test('9.3: Emergency key revocation list fails closed on revoked key ID', async () => {
    const rootKeyPair = await globalThis.crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    const compromisedKeyPair = await globalThis.crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);

    const keyStore = new Map([
      ['compromised-key-2026', compromisedKeyPair.publicKey]
    ]);

    // Token signed with compromised key
    const token = await mintVersionedEntitlementToken({
      payload: { sku: 'pirated_sku', lastValidatedAt: new Date().toISOString() },
      privateKey: compromisedKeyPair.privateKey,
      kid: 'compromised-key-2026'
    });

    // Signed remote config revoking compromised key
    const revocationPayload = JSON.stringify({
      version: 2,
      revokedKeyIds: ['compromised-key-2026'],
      updatedAt: new Date().toISOString()
    });

    const signature = await globalThis.crypto.subtle.sign(
      { name: 'Ed25519' },
      rootKeyPair.privateKey,
      new TextEncoder().encode(revocationPayload)
    );

    const signedRevocationConfig = {
      payloadJson: revocationPayload,
      signatureB64Url: Buffer.from(signature).toString('base64url')
    };

    const res = await verifyVersionedEntitlement({
      token,
      keyStore,
      signedRevocationConfig,
      configRootPublicKey: rootKeyPair.publicKey
    });

    assert.equal(res.valid, false);
    assert.equal(res.reason, 'KEY_REVOKED');
    assert.equal(res.kid, 'compromised-key-2026');
  });

});

describe('B19.5-09: Offline Grace Period (30 Days) & Clock Manipulation Defenses', () => {

  test('9.4: Exactly 30-day offline grace period (2,592,000,000 ms)', () => {
    assert.equal(OFFLINE_GRACE_MS, 2592000000, 'OFFLINE_GRACE_MS must equal exactly 2,592,000,000 ms (30 days)');
  });

  test('9.5: Token within 30-day offline grace passes, but beyond 30 days is rejected', async () => {
    const keyPair = await globalThis.crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    const rawPublicKey = await globalThis.crypto.subtle.exportKey('raw', keyPair.publicKey);

    const t0 = 1770000000000;
    const token = await mintEd25519EntitlementToken({
      payload: {
        sku: 'zen_garden_palette',
        lastValidatedAt: new Date(t0).toISOString()
      },
      privateKey: keyPair.privateKey,
      compact: true
    });

    // At 29 days offline (within grace)
    const t29Days = t0 + (29 * 24 * 60 * 60 * 1000);
    const validRes = await verifyEd25519EntitlementToken({
      token,
      publicKey: new Uint8Array(rawPublicKey),
      currentTimestamp: t29Days
    });
    assert.equal(validRes.valid, true);

    // At 30 days + 1 second (grace expired)
    const t30DaysPlus = t0 + OFFLINE_GRACE_MS + 1000;
    const expiredRes = await verifyEd25519EntitlementToken({
      token,
      publicKey: new Uint8Array(rawPublicKey),
      currentTimestamp: t30DaysPlus
    });
    assert.equal(expiredRes.valid, false);
    assert.equal(expiredRes.reason, 'OFFLINE_GRACE_EXPIRED');
  });

  test('9.6: Clock tampering defenses reject backward rollback jumps', async () => {
    const keyPair = await globalThis.crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    const rawPublicKey = await globalThis.crypto.subtle.exportKey('raw', keyPair.publicKey);

    const tNow = Date.now();
    const token = await mintEd25519EntitlementToken({
      payload: {
        sku: 'mandala_expansion',
        lastValidatedAt: new Date(tNow).toISOString()
      },
      privateKey: keyPair.privateKey,
      compact: true
    });

    // 1. Clock jumped backward behind last-validation timestamp (> 60s tolerance)
    const backwardRes = await verifyEd25519EntitlementToken({
      token,
      publicKey: new Uint8Array(rawPublicKey),
      currentTimestamp: tNow - 120000 // 2 minutes in the past
    });
    assert.equal(backwardRes.valid, false);
    assert.equal(backwardRes.reason, 'CLOCK_ROLLBACK_DETECTED');

    // 2. Monotonic anchor rollback
    const anchorRes = await verifyEd25519EntitlementToken({
      token,
      publicKey: new Uint8Array(rawPublicKey),
      currentTimestamp: tNow,
      anchorTimestamp: tNow + 300000 // anchor in future relative to test clock
    });
    assert.equal(anchorRes.valid, false);
    assert.equal(anchorRes.reason, 'CLOCK_ROLLBACK_DETECTED');
  });

});

describe('B19.5-09: Launch Invariant & Free Beta Tier Access', () => {

  test('9.7: COMMERCIAL_GATE_ENABLED remains false; all features free without paywall', async () => {
    assert.equal(COMMERCIAL_GATE_ENABLED, false, 'Commercial gate must be false for launch');

    const store = createStorageMock();
    const sdk = createAuroMindSDK({ env: { localStorage: store, BroadcastChannel: null } });
    await sdk.init({ gameId: 'portal' });

    assert.equal(sdk.purchases.isCommercialGateActive(), false);
    assert.equal(sdk.purchases.hasEntitlement('any_sku_name'), true);
    assert.equal(sdk.purchases.hasAccess('any_expansion_tier'), true);

    const purchaseRes = await sdk.purchases.requestPurchase('premium_tile_set');
    assert.equal(purchaseRes.ok, true);
    assert.equal(purchaseRes.status, 'granted_free_tier');

    sdk.dispose();
  });

});

describe('B19.5-09: Razorpay Provider Contract, Idempotency & Replay Defense', () => {

  const KEY_SECRET = 'rzp_test_secret_key_12345';
  const WEBHOOK_SECRET = 'rzp_webhook_secret_67890';

  test('9.8: Constant-time payment signature validation succeeds on authentic HMAC and fails on tamper', () => {
    const orderId = 'order_123456';
    const paymentId = 'pay_789012';

    const hmac = crypto.createHmac('sha256', KEY_SECRET);
    hmac.update(`${orderId}|${paymentId}`);
    const validSignature = hmac.digest('hex');

    // 1. Valid signature
    const isValid = validateRazorpayPaymentSignature({
      orderId,
      paymentId,
      signature: validSignature,
      keySecret: KEY_SECRET
    });
    assert.equal(isValid, true);

    // 2. Tampered paymentId
    const isTampered = validateRazorpayPaymentSignature({
      orderId,
      paymentId: 'pay_attacker_tamper',
      signature: validSignature,
      keySecret: KEY_SECRET
    });
    assert.equal(isTampered, false);

    // 3. Wrong secret
    const isWrongSecret = validateRazorpayPaymentSignature({
      orderId,
      paymentId,
      signature: validSignature,
      keySecret: 'wrong_secret'
    });
    assert.equal(isWrongSecret, false);
  });

  test('9.9: Order creation enforces idempotency keys against duplicate orders', async () => {
    const provider = createRazorpayPurchaseProvider({
      keyId: 'rzp_test_key',
      keySecret: KEY_SECRET,
      webhookSecret: WEBHOOK_SECRET
    });

    const idemKey = 'client_unique_req_9988';
    const res1 = await provider.createOrder('soundtrack_pack', { idempotencyKey: idemKey, amount: 49900 });
    assert.equal(res1.ok, true);
    assert.equal(res1.idempotentReplay, false);

    // Second call with same idempotencyKey returns existing order without creating a new one
    const res2 = await provider.createOrder('soundtrack_pack', { idempotencyKey: idemKey, amount: 49900 });
    assert.equal(res2.ok, true);
    assert.equal(res2.idempotentReplay, true);
    assert.equal(res2.order.id, res1.order.id);
  });

  test('9.10: Replay defense prevents re-settling an already settled payment ID', async () => {
    const provider = createRazorpayPurchaseProvider({
      keyId: 'rzp_test_key',
      keySecret: KEY_SECRET,
      webhookSecret: WEBHOOK_SECRET
    });

    const orderRes = await provider.createOrder('zen_theme');
    const paymentId = 'pay_unique_transaction_5544';

    const hmac = crypto.createHmac('sha256', KEY_SECRET);
    hmac.update(`${orderRes.order.id}|${paymentId}`);
    const signature = hmac.digest('hex');

    // First verification settles successfully
    const settle1 = await provider.verifyPayment({
      orderId: orderRes.order.id,
      paymentId,
      signature
    });
    assert.equal(settle1.ok, true);
    assert.equal(settle1.status, 'success');
    assert.equal(provider.hasEntitlement('zen_theme'), true);

    // Second verification replay with same paymentId must be rejected
    const settle2 = await provider.verifyPayment({
      orderId: orderRes.order.id,
      paymentId,
      signature
    });
    assert.equal(settle2.ok, false);
    assert.equal(settle2.errorCode, 'ERR_PAYMENT_ALREADY_SETTLED');
  });

  test('9.11: Webhook signature validation and payment capture processing', async () => {
    const provider = createRazorpayPurchaseProvider({
      keyId: 'rzp_test_key',
      keySecret: KEY_SECRET,
      webhookSecret: WEBHOOK_SECRET
    });

    const webhookBody = JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_captured_via_webhook',
            amount: 29900,
            status: 'captured'
          }
        }
      }
    });

    const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET);
    hmac.update(webhookBody);
    const validSig = hmac.digest('hex');

    const hookRes = await provider.processWebhook({
      rawBody: webhookBody,
      signature: validSig
    });
    assert.equal(hookRes.ok, true);
    assert.equal(hookRes.eventType, 'payment.captured');

    // Replay of same captured webhook is safely deduplicated
    const replayRes = await provider.processWebhook({
      rawBody: webhookBody,
      signature: validSig
    });
    assert.equal(replayRes.ok, true);
    assert.equal(replayRes.ignored, true);
    assert.equal(replayRes.reason, 'ALREADY_SETTLED');
  });

  test('9.12: Commerce network/provider errors never block offline gameplay or save functionality', async () => {
    const store = createStorageMock();
    const sdk = createAuroMindSDK({ env: { localStorage: store, BroadcastChannel: null } });
    await sdk.init({ gameId: 'portal' });

    // Inject crashing provider
    const crashingProvider = {
      isConfigured: () => true,
      purchase: async () => { throw new Error('Razorpay Gateway 502 Bad Gateway'); },
      refund: async () => { throw new Error('Razorpay Gateway 504 Gateway Timeout'); },
      restorePurchases: async () => { throw new Error('DNS resolution failure'); },
      hasEntitlement: () => { throw new Error('Fatal socket abort'); }
    };

    sdk.purchases.setCommercialGateActiveForTesting(true);
    sdk.purchases.setProvider(crashingProvider);

    // Requesting purchase catches error cleanly and does not throw
    const buyResult = await sdk.purchases.requestPurchase('failing_sku');
    assert.equal(buyResult.ok, false);
    assert.equal(buyResult.errorCode, 'PURCHASE_ERROR');

    // Storage/save operations remain completely intact and unaffected
    await sdk.storage.setPlatformMeta('saved_level_state', { score: 1000, level: 12 });
    const loaded = await sdk.storage.getPlatformMeta('saved_level_state');
    assert.deepEqual(loaded, { score: 1000, level: 12 });

    sdk.dispose();
  });

});
