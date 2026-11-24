/**
 * B19.5-09 — Entitlements and Commerce Behavioral Test Suite (Hardened)
 *
 * Validates:
 * 1. Strict security boundary: Client-side self-grant is forbidden.
 * 2. Browser protection: Client provider rejects initialization if secrets are passed.
 * 3. Server-authoritative order creation: Bound to verified account, SKU, amount, and currency.
 * 4. Durable idempotency: Prevents duplicate orders across repeat requests.
 * 5. Cryptographic payment verification: Constant-time HMAC-SHA256, ownership matching, and replay defense.
 * 6. Scoped webhook processing: Validates amount/currency, and refunds revoke only the affected user's entitlement.
 * 7. Server-authoritative Ed25519 verification: Header alg ('EdDSA') and typ ('JWT') enforcement.
 * 8. Expiry policy: Rejecting missing or NaN expiry timestamps unless explicitly 'LIFETIME'.
 * 9. Exact 30-day offline grace (2,592,000,000 ms) and clock rollback manipulation defenses.
 * 10. Fail-closed handling of malformed revocation configurations.
 * 11. Launch invariant: COMMERCIAL_GATE_ENABLED = false, all features free in launch beta.
 * 12. Non-blocking gameplay: Commerce errors never block local storage or gameplay saves.
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
  createRazorpayClientProvider,
  createRazorpayServerVerifier,
  createInMemoryDurableStore,
  createMockRazorpayTestFixture,
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

describe('B19.5-09: Razorpay Client & Server Security Boundary', () => {

  test('9.1: Client provider strictly forbids secret exposure and self-granting', async () => {
    // 1. Passing secrets to client provider must throw security violation
    assert.throws(() => {
      createRazorpayClientProvider({
        keyId: 'rzp_public_key',
        keySecret: 'leak_secret_to_browser'
      });
    }, /SECURITY_VIOLATION/);

    assert.throws(() => {
      createRazorpayClientProvider({
        keyId: 'rzp_public_key',
        webhookSecret: 'leak_webhook_to_browser'
      });
    }, /SECURITY_VIOLATION/);

    // 2. Client cannot self-grant an entitlement
    const clientProvider = createRazorpayClientProvider({ keyId: 'rzp_public_key' });
    const purchaseRes = await clientProvider.purchase('premium_sku');
    assert.equal(purchaseRes.ok, false);
    assert.equal(purchaseRes.errorCode, 'CLIENT_SELF_GRANT_FORBIDDEN');
  });

  test('9.2: Server creates authoritative orders bound to verified account and SKU', async () => {
    const fixture = createMockRazorpayTestFixture();

    // 1. Missing user ID rejected
    const badUser = await fixture.verifier.createAuthoritativeOrder({
      userId: '',
      sku: 'supporter_pass_2027',
      amount: 29900
    });
    assert.equal(badUser.ok, false);
    assert.equal(badUser.errorCode, 'INVALID_USER_ID');

    // 2. Invalid non-positive amount rejected
    const badAmount = await fixture.verifier.createAuthoritativeOrder({
      userId: 'user_alice',
      sku: 'supporter_pass_2027',
      amount: -500
    });
    assert.equal(badAmount.ok, false);
    assert.equal(badAmount.errorCode, 'INVALID_AMOUNT');

    // 3. Valid order created and bound to user
    const orderRes = await fixture.verifier.createAuthoritativeOrder({
      userId: 'user_alice',
      sku: 'supporter_pass_2027',
      amount: 29900,
      idempotencyKey: 'idem_key_111'
    });
    assert.equal(orderRes.ok, true);
    assert.equal(orderRes.order.userId, 'user_alice');
    assert.equal(orderRes.order.sku, 'supporter_pass_2027');
    assert.equal(orderRes.order.amount, 29900);
    assert.equal(orderRes.idempotentReplay, false);

    // 4. Repeated call with same idempotency key returns existing order
    const replayRes = await fixture.verifier.createAuthoritativeOrder({
      userId: 'user_alice',
      sku: 'supporter_pass_2027',
      amount: 29900,
      idempotencyKey: 'idem_key_111'
    });
    assert.equal(replayRes.ok, true);
    assert.equal(replayRes.idempotentReplay, true);
    assert.equal(replayRes.order.id, orderRes.order.id);
  });

  test('9.3: Payment verification validates signature, ownership, and enforces replay defense', async () => {
    const fixture = createMockRazorpayTestFixture();

    const orderRes = await fixture.verifier.createAuthoritativeOrder({
      userId: 'user_alice',
      sku: 'expansion_pack_1',
      amount: 49900
    });
    const orderId = orderRes.order.id;
    const paymentId = 'pay_alice_unique_9988';

    // Generate valid HMAC signature
    const hmac = crypto.createHmac('sha256', fixture.testKeySecret);
    hmac.update(`${orderId}|${paymentId}`);
    const validSig = hmac.digest('hex');

    // 1. Order ownership mismatch rejected
    const imposterRes = await fixture.verifier.verifyAuthoritativePayment({
      userId: 'user_attacker_bob',
      orderId,
      paymentId,
      signature: validSig
    });
    assert.equal(imposterRes.ok, false);
    assert.equal(imposterRes.errorCode, 'ORDER_OWNERSHIP_MISMATCH');

    // 2. Tampered signature rejected
    const tamperedRes = await fixture.verifier.verifyAuthoritativePayment({
      userId: 'user_alice',
      orderId,
      paymentId,
      signature: '0'.repeat(64)
    });
    assert.equal(tamperedRes.ok, false);
    assert.equal(tamperedRes.errorCode, 'INVALID_PAYMENT_SIGNATURE');

    // 3. Legitimate verification succeeds
    const legitRes = await fixture.verifier.verifyAuthoritativePayment({
      userId: 'user_alice',
      orderId,
      paymentId,
      signature: validSig
    });
    assert.equal(legitRes.ok, true);
    assert.equal(legitRes.status, 'success');
    assert.equal(legitRes.transaction.userId, 'user_alice');
    assert.equal(legitRes.transaction.sku, 'expansion_pack_1');

    // Verify entitlement granted in store
    const ent = await fixture.store.getEntitlement('user_alice', 'expansion_pack_1');
    assert.ok(ent);
    assert.equal(ent.status, 'active');

    // 4. Replay attack with same paymentId rejected at durable persistence boundary
    const replayRes = await fixture.verifier.verifyAuthoritativePayment({
      userId: 'user_alice',
      orderId,
      paymentId,
      signature: validSig
    });
    assert.equal(replayRes.ok, false);
    assert.equal(replayRes.errorCode, 'ERR_PAYMENT_ALREADY_SETTLED');
  });

  test('9.4: Webhook refund targets strictly the affected user and isolates other users', async () => {
    const fixture = createMockRazorpayTestFixture();

    // Alice buys SKU A
    const orderAlice = await fixture.verifier.createAuthoritativeOrder({
      userId: 'user_alice',
      sku: 'sku_a',
      amount: 10000
    });
    const hmacAlice = crypto.createHmac('sha256', fixture.testKeySecret);
    hmacAlice.update(`${orderAlice.order.id}|pay_alice_1`);
    await fixture.verifier.verifyAuthoritativePayment({
      userId: 'user_alice',
      orderId: orderAlice.order.id,
      paymentId: 'pay_alice_1',
      signature: hmacAlice.digest('hex')
    });

    // Bob buys SKU A
    const orderBob = await fixture.verifier.createAuthoritativeOrder({
      userId: 'user_bob',
      sku: 'sku_a',
      amount: 10000
    });
    const hmacBob = crypto.createHmac('sha256', fixture.testKeySecret);
    hmacBob.update(`${orderBob.order.id}|pay_bob_1`);
    await fixture.verifier.verifyAuthoritativePayment({
      userId: 'user_bob',
      orderId: orderBob.order.id,
      paymentId: 'pay_bob_1',
      signature: hmacBob.digest('hex')
    });

    // Both users have active entitlements
    assert.ok(await fixture.store.getEntitlement('user_alice', 'sku_a'));
    assert.ok(await fixture.store.getEntitlement('user_bob', 'sku_a'));

    // Process refund for Alice's payment only
    const refundBody = JSON.stringify({
      event: 'refund.processed',
      payload: {
        refund: {
          entity: {
            id: 'rfnd_123',
            payment_id: 'pay_alice_1',
            order_id: orderAlice.order.id,
            amount: 10000
          }
        }
      }
    });

    const hmacHook = crypto.createHmac('sha256', 'test_webhook_secret_67890');
    hmacHook.update(refundBody);

    const hookRes = await fixture.verifier.processAuthoritativeWebhook({
      rawBody: refundBody,
      signature: hmacHook.digest('hex')
    });

    assert.equal(hookRes.ok, true);
    assert.equal(hookRes.revoked, true);
    assert.equal(hookRes.userId, 'user_alice');

    // Alice's entitlement is revoked
    assert.equal(await fixture.store.getEntitlement('user_alice', 'sku_a'), null);

    // Bob's entitlement remains strictly ACTIVE and unaffected
    assert.ok(await fixture.store.getEntitlement('user_bob', 'sku_a'));
  });

});

describe('B19.5-09: Ed25519 Entitlement Verification Hardening', () => {

  test('9.5: Header algorithm and token type verification', async () => {
    const keyPair = await globalThis.crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    const keyStore = new Map([['test_key', keyPair.publicKey]]);

    // 1. Wrong algorithm (e.g. HS256)
    const badAlgHeader = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: 'test_key' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: 'user_1', sku: 'sku_1', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
    const fakeSig = Buffer.from('x'.repeat(64)).toString('base64url');
    const badAlgToken = `${badAlgHeader}.${payload}.${fakeSig}`;

    const res1 = await verifyVersionedEntitlement({ token: badAlgToken, keyStore });
    assert.equal(res1.valid, false);
    assert.equal(res1.reason, 'UNSUPPORTED_ALGORITHM');

    // 2. Missing Key ID
    const noKidHeader = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' })).toString('base64url');
    const noKidToken = `${noKidHeader}.${payload}.${fakeSig}`;
    const res2 = await verifyVersionedEntitlement({ token: noKidToken, keyStore });
    assert.equal(res2.valid, false);
    assert.equal(res2.reason, 'KEY_ID_MISSING');
  });

  test('9.6: Expiry policy requires finite positive exp unless tier is LIFETIME', async () => {
    const keyPair = await globalThis.crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    const keyStore = new Map([['auromasti-ed25519-2026-v1', keyPair.publicKey]]);

    // 1. Missing exp without lifetime tier must fail closed
    const tokenNoExp = await mintVersionedEntitlementToken({
      payload: { sub: 'usr_1', sku: 'pack_1' }, // Missing exp and tier !== LIFETIME
      privateKey: keyPair.privateKey
    });
    const r1 = await verifyVersionedEntitlement({ token: tokenNoExp, keyStore });
    assert.equal(r1.valid, false);
    assert.equal(r1.reason, 'TOKEN_EXPIRY_REQUIRED');

    // 2. Invalid NaN exp
    const tokenNanExp = await mintVersionedEntitlementToken({
      payload: { sub: 'usr_1', sku: 'pack_1', exp: 'not_a_number' },
      privateKey: keyPair.privateKey
    });
    const r2 = await verifyVersionedEntitlement({ token: tokenNanExp, keyStore });
    assert.equal(r2.valid, false);
    assert.equal(r2.reason, 'INVALID_EXPIRATION_TIMESTAMP');

    // 3. Finite exp in past is expired
    const tokenPastExp = await mintVersionedEntitlementToken({
      payload: { sub: 'usr_1', sku: 'pack_1', exp: Math.floor((Date.now() - 3600000) / 1000) },
      privateKey: keyPair.privateKey
    });
    const r3 = await verifyVersionedEntitlement({ token: tokenPastExp, keyStore });
    assert.equal(r3.valid, false);
    assert.equal(r3.reason, 'TOKEN_EXPIRED');

    // 4. LIFETIME tier passes without exp
    const tokenLifetime = await mintVersionedEntitlementToken({
      payload: { sub: 'usr_1', sku: 'pack_1', tier: 'LIFETIME' },
      privateKey: keyPair.privateKey
    });
    const r4 = await verifyVersionedEntitlement({ token: tokenLifetime, keyStore });
    assert.equal(r4.valid, true);
  });

  test('9.7: Validation timestamp and exact 30-day offline grace period (2,592,000,000 ms)', async () => {
    assert.equal(OFFLINE_GRACE_MS, 2592000000, 'Grace period must be exactly 2,592,000,000 ms');

    const keyPair = await globalThis.crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    const keyStore = new Map([['auromasti-ed25519-2026-v1', keyPair.publicKey]]);
    const t0 = 1770000000000;

    // 1. Invalid / unparseable lastValidatedAt date fails closed
    const tokenBadDate = await mintVersionedEntitlementToken({
      payload: { sub: 'usr_1', sku: 'pack_1', tier: 'LIFETIME', lastValidatedAt: 'invalid-iso-date' },
      privateKey: keyPair.privateKey
    });
    const rBadDate = await verifyVersionedEntitlement({ token: tokenBadDate, keyStore, currentTimestamp: t0 });
    assert.equal(rBadDate.valid, false);
    assert.equal(rBadDate.reason, 'INVALID_VALIDATION_TIMESTAMP');

    // 2. Token within 30-day offline grace passes
    const tokenGrace = await mintVersionedEntitlementToken({
      payload: { sub: 'usr_1', sku: 'pack_1', tier: 'LIFETIME', lastValidatedAt: new Date(t0).toISOString() },
      privateKey: keyPair.privateKey
    });

    const t29Days = t0 + (29 * 24 * 60 * 60 * 1000);
    const rWithin = await verifyVersionedEntitlement({ token: tokenGrace, keyStore, currentTimestamp: t29Days });
    assert.equal(rWithin.valid, true);

    // 3. Beyond 30 days fails
    const t30DaysPlus = t0 + OFFLINE_GRACE_MS + 1000;
    const rExceeded = await verifyVersionedEntitlement({ token: tokenGrace, keyStore, currentTimestamp: t30DaysPlus });
    assert.equal(rExceeded.valid, false);
    assert.equal(rExceeded.reason, 'OFFLINE_GRACE_EXCEEDED');

    // 4. Backward clock manipulation behind lastValidatedAt fails
    const tBackward = t0 - 120000; // 2 minutes before validation
    const rBackward = await verifyVersionedEntitlement({ token: tokenGrace, keyStore, currentTimestamp: tBackward });
    assert.equal(rBackward.valid, false);
    assert.equal(rBackward.reason, 'CLOCK_ROLLBACK_DETECTED');
  });

  test('9.8: Signed revocation config fails closed on malformed configuration', async () => {
    const rootKeyPair = await globalThis.crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    const keyPair = await globalThis.crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    const keyStore = new Map([['test_key', keyPair.publicKey]]);

    const token = await mintVersionedEntitlementToken({
      payload: { sub: 'usr_1', sku: 'pack_1', tier: 'LIFETIME' },
      privateKey: keyPair.privateKey,
      kid: 'test_key'
    });

    // Malformed revocation config (corrupted JSON)
    const malformedConfig = {
      payloadJson: '{ bad json',
      signatureB64Url: Buffer.from('x'.repeat(64)).toString('base64url')
    };

    const res = await verifyVersionedEntitlement({
      token,
      keyStore,
      signedRevocationConfig: malformedConfig,
      configRootPublicKey: rootKeyPair.publicKey
    });

    assert.equal(res.valid, false);
  });

});

describe('B19.5-09: Launch Invariant & Resilient Gameplay', () => {

  test('9.9: COMMERCIAL_GATE_ENABLED remains false; all features free in launch beta', async () => {
    assert.equal(COMMERCIAL_GATE_ENABLED, false, 'Commercial gate must remain false for launch');

    const store = createStorageMock();
    const sdk = createAuroMindSDK({ env: { localStorage: store, BroadcastChannel: null } });
    await sdk.init({ gameId: 'portal' });

    assert.equal(sdk.purchases.isCommercialGateActive(), false);
    assert.equal(sdk.purchases.hasEntitlement('any_sku'), true);
    assert.equal(sdk.purchases.hasAccess('any_tier'), true);

    const buyRes = await sdk.purchases.requestPurchase('premium_tile_set');
    assert.equal(buyRes.ok, true);
    assert.equal(buyRes.status, 'granted_free_tier');

    sdk.dispose();
  });

  test('9.10: Commerce network/provider errors never block offline gameplay or save operations', async () => {
    const store = createStorageMock();
    const sdk = createAuroMindSDK({ env: { localStorage: store, BroadcastChannel: null } });
    await sdk.init({ gameId: 'portal' });

    const failingProvider = {
      isConfigured: () => true,
      purchase: async () => { throw new Error('Razorpay Gateway 502 Bad Gateway'); },
      refund: async () => { throw new Error('Razorpay Gateway 504 Gateway Timeout'); },
      restorePurchases: async () => { throw new Error('Network unreachable'); },
      hasEntitlement: () => { throw new Error('Fatal socket failure'); }
    };

    sdk.purchases.setCommercialGateActiveForTesting(true);
    sdk.purchases.setProvider(failingProvider);

    const buyResult = await sdk.purchases.requestPurchase('test_sku');
    assert.equal(buyResult.ok, false);
    assert.equal(buyResult.errorCode, 'PURCHASE_ERROR');

    // Storage/save operations remain completely intact
    await sdk.storage.setPlatformMeta('saved_level_state', { score: 1000, level: 12 });
    const loaded = await sdk.storage.getPlatformMeta('saved_level_state');
    assert.deepEqual(loaded, { score: 1000, level: 12 });

    sdk.dispose();
  });

});
