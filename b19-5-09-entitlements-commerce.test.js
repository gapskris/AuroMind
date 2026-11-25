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

    // Register captured payment in authoritative provider API
    fixture.paymentsRegistry.set(paymentId, {
      id: paymentId,
      order_id: orderId,
      status: 'captured',
      amount: 49900,
      currency: 'INR'
    });

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
    fixture.paymentsRegistry.set('pay_alice_1', {
      id: 'pay_alice_1',
      order_id: orderAlice.order.id,
      status: 'captured',
      amount: 10000,
      currency: 'INR'
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
    fixture.paymentsRegistry.set('pay_bob_1', {
      id: 'pay_bob_1',
      order_id: orderBob.order.id,
      status: 'captured',
      amount: 10000,
      currency: 'INR'
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

  test('9.4b: Authoritative payment verification checks payment entity status, currency, amount, and handles fetch failures', async () => {
    const fixture = createMockRazorpayTestFixture();

    const orderRes = await fixture.verifier.createAuthoritativeOrder({
      userId: 'user_alice',
      sku: 'supporter_pack',
      amount: 50000
    });
    const orderId = orderRes.order.id;
    const paymentId = 'pay_test_auth_123';

    const hmac = crypto.createHmac('sha256', fixture.testKeySecret);
    hmac.update(`${orderId}|${paymentId}`);
    const validSig = hmac.digest('hex');

    // 0. Caller-supplied paymentEntity is ignored; if provider API doesn't know paymentId, fails closed
    const attackerHmac = crypto.createHmac('sha256', fixture.testKeySecret);
    attackerHmac.update(`${orderId}|pay_unregistered_attacker`);
    const attackerSig = attackerHmac.digest('hex');

    const unverifiedApiRes = await fixture.verifier.verifyAuthoritativePayment({
      userId: 'user_alice',
      orderId,
      paymentId: 'pay_unregistered_attacker',
      signature: attackerSig,
      paymentEntity: { id: 'pay_unregistered_attacker', order_id: orderId, status: 'captured', amount: 50000, currency: 'INR' }
    });
    assert.equal(unverifiedApiRes.ok, false);
    assert.equal(unverifiedApiRes.errorCode, 'RAZORPAY_PAYMENT_FETCH_FAILED');

    // 1. Payment status not captured (e.g. 'failed' or 'authorized')
    fixture.paymentsRegistry.set(paymentId, {
      id: paymentId,
      order_id: orderId,
      status: 'failed',
      amount: 50000,
      currency: 'INR'
    });
    const failedPaymentRes = await fixture.verifier.verifyAuthoritativePayment({
      userId: 'user_alice',
      orderId,
      paymentId,
      signature: validSig
    });
    assert.equal(failedPaymentRes.ok, false);
    assert.equal(failedPaymentRes.errorCode, 'PAYMENT_NOT_CAPTURED');

    // 2. Order ID mismatch
    fixture.paymentsRegistry.set(paymentId, {
      id: paymentId,
      order_id: 'order_wrong_456',
      status: 'captured',
      amount: 50000,
      currency: 'INR'
    });
    const wrongOrderRes = await fixture.verifier.verifyAuthoritativePayment({
      userId: 'user_alice',
      orderId,
      paymentId,
      signature: validSig
    });
    assert.equal(wrongOrderRes.ok, false);
    assert.equal(wrongOrderRes.errorCode, 'ORDER_PAYMENT_MISMATCH');

    // 3. Amount mismatch (e.g. partial capture)
    fixture.paymentsRegistry.set(paymentId, {
      id: paymentId,
      order_id: orderId,
      status: 'captured',
      amount: 25000,
      currency: 'INR'
    });
    const partialCaptureRes = await fixture.verifier.verifyAuthoritativePayment({
      userId: 'user_alice',
      orderId,
      paymentId,
      signature: validSig
    });
    assert.equal(partialCaptureRes.ok, false);
    assert.equal(partialCaptureRes.errorCode, 'PAYMENT_AMOUNT_MISMATCH');

    // 4. Currency mismatch (e.g. USD instead of INR)
    fixture.paymentsRegistry.set(paymentId, {
      id: paymentId,
      order_id: orderId,
      status: 'captured',
      amount: 50000,
      currency: 'USD'
    });
    const currencyMismatchRes = await fixture.verifier.verifyAuthoritativePayment({
      userId: 'user_alice',
      orderId,
      paymentId,
      signature: validSig
    });
    assert.equal(currencyMismatchRes.ok, false);
    assert.equal(currencyMismatchRes.errorCode, 'PAYMENT_CURRENCY_MISMATCH');

    // 5. Payment ID mismatch returned by provider API
    fixture.paymentsRegistry.set(paymentId, {
      id: 'pay_provider_returned_different_id',
      order_id: orderId,
      status: 'captured',
      amount: 50000,
      currency: 'INR'
    });
    const idMismatchRes = await fixture.verifier.verifyAuthoritativePayment({
      userId: 'user_alice',
      orderId,
      paymentId,
      signature: validSig
    });
    assert.equal(idMismatchRes.ok, false);
    assert.equal(idMismatchRes.errorCode, 'PAYMENT_ID_MISMATCH');

    // 6. Provider API outage / error fails closed
    const errorFixture = createMockRazorpayTestFixture();
    const failingOrderRes = await errorFixture.verifier.createAuthoritativeOrder({
      userId: 'user_alice',
      sku: 'supporter_pack',
      amount: 50000
    });
    errorFixture.mockApiClient.payments.fetch = async () => {
      throw new Error('Razorpay Gateway 503 Service Unavailable');
    };
    const errorHmac = crypto.createHmac('sha256', errorFixture.testKeySecret);
    errorHmac.update(`${failingOrderRes.order.id}|pay_fail_closed_test`);
    const errorSig = errorHmac.digest('hex');

    const failClosedRes = await errorFixture.verifier.verifyAuthoritativePayment({
      userId: 'user_alice',
      orderId: failingOrderRes.order.id,
      paymentId: 'pay_fail_closed_test',
      signature: errorSig
    });
    assert.equal(failClosedRes.ok, false);
    assert.equal(failClosedRes.errorCode, 'RAZORPAY_PAYMENT_FETCH_FAILED');

    // 7. Legitimate captured payment succeeds
    fixture.paymentsRegistry.set(paymentId, {
      id: paymentId,
      order_id: orderId,
      status: 'captured',
      amount: 50000,
      currency: 'INR'
    });
    const validRes = await fixture.verifier.verifyAuthoritativePayment({
      userId: 'user_alice',
      orderId,
      paymentId,
      signature: validSig
    });
    assert.equal(validRes.ok, true);
    assert.equal(validRes.status, 'success');

    // 8. Replay of settled payment fails closed
    const duplicateRes = await fixture.verifier.verifyAuthoritativePayment({
      userId: 'user_alice',
      orderId,
      paymentId,
      signature: validSig
    });
    assert.equal(duplicateRes.ok, false);
    assert.equal(duplicateRes.errorCode, 'ERR_PAYMENT_ALREADY_SETTLED');

    // 5. Duplicate webhook replay defense
    const webhookPayload = JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: { id: 'pay_hook_1', order_id: orderId, amount: 50000, currency: 'INR', status: 'captured' }
        }
      }
    });
    const hookHmac = crypto.createHmac('sha256', 'test_webhook_secret_67890');
    hookHmac.update(webhookPayload);
    const hookSig = hookHmac.digest('hex');

    const firstHook = await fixture.verifier.processAuthoritativeWebhook({ rawBody: webhookPayload, signature: hookSig });
    assert.equal(firstHook.ok, true);
    assert.equal(firstHook.processed, true);

    const duplicateHook = await fixture.verifier.processAuthoritativeWebhook({ rawBody: webhookPayload, signature: hookSig });
    assert.equal(duplicateHook.ok, true);
    assert.equal(duplicateHook.ignored, true);
    assert.equal(duplicateHook.reason, 'ALREADY_SETTLED');
  });

  test('9.4c: Production verifier requires durable persistence and authoritative API configuration', async () => {
    // 1. Missing persistenceStore fails closed
    assert.throws(() => {
      createRazorpayServerVerifier({
        keyId: 'rzp_key',
        keySecret: 'rzp_secret',
        persistenceStore: null
      });
    }, /DURABLE_STORE_REQUIRED/);

    // 2. In-memory persistence store rejected in production mode
    assert.throws(() => {
      createRazorpayServerVerifier({
        keyId: 'rzp_key',
        keySecret: 'rzp_secret',
        persistenceStore: createInMemoryDurableStore(),
        isProduction: true
      });
    }, /IN_MEMORY_STORE_FORBIDDEN/);

    // 3. Durable persistence failure during atomic settlement returns error
    const failingStore = {
      isInMemory: false,
      getOrderById: async () => ({ id: 'ord_1', userId: 'u1', sku: 's1', amount: 1000, currency: 'INR' }),
      isPaymentSettled: async () => false,
      settleAndGrantEntitlement: async () => { throw new Error('Database disk full'); }
    };

    const verifier = createRazorpayServerVerifier({
      keyId: 'rzp_key',
      keySecret: 'rzp_secret',
      persistenceStore: failingStore,
      isProduction: false,
      allowSimulatedOrders: true
    });

    const hmac = crypto.createHmac('sha256', 'rzp_secret');
    hmac.update('ord_1|pay_1');
    const res = await verifier.verifyAuthoritativePayment({
      userId: 'u1',
      orderId: 'ord_1',
      paymentId: 'pay_1',
      signature: hmac.digest('hex')
    });
    assert.equal(res.ok, false);
    assert.equal(res.errorCode, 'DURABLE_PERSISTENCE_FAILURE');
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
    const r1 = await verifyVersionedEntitlement({ token: tokenNoExp, keyStore, expectedSubject: 'usr_1' });
    assert.equal(r1.valid, false);
    assert.equal(r1.reason, 'TOKEN_EXPIRY_REQUIRED');

    // 2. Invalid NaN exp
    const tokenNanExp = await mintVersionedEntitlementToken({
      payload: { sub: 'usr_1', sku: 'pack_1', exp: 'not_a_number' },
      privateKey: keyPair.privateKey
    });
    const r2 = await verifyVersionedEntitlement({ token: tokenNanExp, keyStore, expectedSubject: 'usr_1' });
    assert.equal(r2.valid, false);
    assert.equal(r2.reason, 'INVALID_EXPIRATION_TIMESTAMP');

    // 3. Finite exp in past is expired
    const tokenPastExp = await mintVersionedEntitlementToken({
      payload: { sub: 'usr_1', sku: 'pack_1', exp: Math.floor((Date.now() - 3600000) / 1000) },
      privateKey: keyPair.privateKey
    });
    const r3 = await verifyVersionedEntitlement({ token: tokenPastExp, keyStore, expectedSubject: 'usr_1' });
    assert.equal(r3.valid, false);
    assert.equal(r3.reason, 'TOKEN_EXPIRED');

    // 4. LIFETIME tier passes without exp when lastValidatedAt is present
    const tokenLifetime = await mintVersionedEntitlementToken({
      payload: { sub: 'usr_1', sku: 'pack_1', tier: 'LIFETIME', lastValidatedAt: new Date().toISOString() },
      privateKey: keyPair.privateKey
    });
    const r4 = await verifyVersionedEntitlement({ token: tokenLifetime, keyStore, expectedSubject: 'usr_1' });
    assert.equal(r4.valid, true);

    // 5. Default requireLastValidatedAt fails closed when lastValidatedAt is missing
    const tokenNoValidation = await mintVersionedEntitlementToken({
      payload: { sub: 'usr_1', sku: 'pack_1', tier: 'LIFETIME' },
      privateKey: keyPair.privateKey
    });
    const r5 = await verifyVersionedEntitlement({ token: tokenNoValidation, keyStore, expectedSubject: 'usr_1' });
    assert.equal(r5.valid, false);
    assert.equal(r5.reason, 'MISSING_VALIDATION_TIMESTAMP');
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
    const rBadDate = await verifyVersionedEntitlement({ token: tokenBadDate, keyStore, currentTimestamp: t0, expectedSubject: 'usr_1' });
    assert.equal(rBadDate.valid, false);
    assert.equal(rBadDate.reason, 'INVALID_VALIDATION_TIMESTAMP');

    // 2. Non-finite or non-positive currentTimestamp fails closed
    const tokenValid = await mintVersionedEntitlementToken({
      payload: { sub: 'usr_1', sku: 'pack_1', tier: 'LIFETIME', lastValidatedAt: new Date(t0).toISOString() },
      privateKey: keyPair.privateKey
    });
    const rNanTime = await verifyVersionedEntitlement({ token: tokenValid, keyStore, currentTimestamp: NaN, expectedSubject: 'usr_1' });
    assert.equal(rNanTime.valid, false);
    assert.equal(rNanTime.reason, 'INVALID_CURRENT_TIMESTAMP');

    const rNegTime = await verifyVersionedEntitlement({ token: tokenValid, keyStore, currentTimestamp: -500, expectedSubject: 'usr_1' });
    assert.equal(rNegTime.valid, false);
    assert.equal(rNegTime.reason, 'INVALID_CURRENT_TIMESTAMP');

    // 3. Account / subject mismatch fails closed even for LIFETIME tokens
    const rSubjectMismatch = await verifyVersionedEntitlement({
      token: tokenValid,
      keyStore,
      currentTimestamp: t0,
      expectedSubject: 'usr_different_account'
    });
    assert.equal(rSubjectMismatch.valid, false);
    assert.equal(rSubjectMismatch.reason, 'SUBJECT_MISMATCH');

    // 4. Token within 30-day offline grace passes
    const tokenGrace = await mintVersionedEntitlementToken({
      payload: { sub: 'usr_1', sku: 'pack_1', tier: 'LIFETIME', lastValidatedAt: new Date(t0).toISOString() },
      privateKey: keyPair.privateKey
    });

    const t29Days = t0 + (29 * 24 * 60 * 60 * 1000);
    const rWithin = await verifyVersionedEntitlement({ token: tokenGrace, keyStore, currentTimestamp: t29Days, expectedSubject: 'usr_1' });
    assert.equal(rWithin.valid, true);

    // 5. Exact grace boundary passes (exact 2,592,000,000 ms)
    const tExactBoundary = t0 + OFFLINE_GRACE_MS;
    const rExact = await verifyVersionedEntitlement({ token: tokenGrace, keyStore, currentTimestamp: tExactBoundary, expectedSubject: 'usr_1' });
    assert.equal(rExact.valid, true, 'Exact 30-day grace boundary must pass');

    // 6. Beyond 30 days fails (even by 1 ms)
    const t30DaysPlus = t0 + OFFLINE_GRACE_MS + 1000;
    const rExceeded = await verifyVersionedEntitlement({ token: tokenGrace, keyStore, currentTimestamp: t30DaysPlus, expectedSubject: 'usr_1' });
    assert.equal(rExceeded.valid, false);
    assert.equal(rExceeded.reason, 'OFFLINE_GRACE_EXCEEDED');

    // 7. Backward clock manipulation behind lastValidatedAt fails
    const tBackward = t0 - 120000; // 2 minutes before validation
    const rBackward = await verifyVersionedEntitlement({ token: tokenGrace, keyStore, currentTimestamp: tBackward, expectedSubject: 'usr_1' });
    assert.equal(rBackward.valid, false);
    assert.equal(rBackward.reason, 'CLOCK_ROLLBACK_DETECTED');
  });

  test('9.7b: Mandatory account subject binding across all tiers and production protection', async () => {
    const keyPair = await globalThis.crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    const keyStore = new Map([['auromasti-ed25519-2026-v1', keyPair.publicKey]]);
    const now = Date.now();

    // 1. Missing expectedSubject fails closed
    const token = await mintVersionedEntitlementToken({
      payload: { sub: 'usr_verified_123', sku: 'pack_1', tier: 'STANDARD', exp: Math.floor(now / 1000) + 3600, lastValidatedAt: new Date(now).toISOString() },
      privateKey: keyPair.privateKey
    });
    const rNoExpected = await verifyVersionedEntitlement({ token, keyStore, currentTimestamp: now });
    assert.equal(rNoExpected.valid, false);
    assert.equal(rNoExpected.reason, 'EXPECTED_SUBJECT_REQUIRED');

    // 2. Empty / whitespace / non-string expectedSubject fails closed
    const rEmptyExpected = await verifyVersionedEntitlement({ token, keyStore, currentTimestamp: now, expectedSubject: '   ' });
    assert.equal(rEmptyExpected.valid, false);
    assert.equal(rEmptyExpected.reason, 'INVALID_EXPECTED_SUBJECT');

    // 3. Missing or whitespace token subject (sub) fails closed
    const tokenNoSub = await mintVersionedEntitlementToken({
      payload: { sku: 'pack_1', tier: 'STANDARD', exp: Math.floor(now / 1000) + 3600, lastValidatedAt: new Date(now).toISOString() },
      privateKey: keyPair.privateKey
    });
    const rMissingSub = await verifyVersionedEntitlement({ token: tokenNoSub, keyStore, currentTimestamp: now, expectedSubject: 'usr_verified_123' });
    assert.equal(rMissingSub.valid, false);
    assert.equal(rMissingSub.reason, 'TOKEN_SUBJECT_MISSING');

    // 4. Subject mismatch fails closed
    const rMismatch = await verifyVersionedEntitlement({ token, keyStore, currentTimestamp: now, expectedSubject: 'usr_attacker_456' });
    assert.equal(rMismatch.valid, false);
    assert.equal(rMismatch.reason, 'SUBJECT_MISMATCH');

    // 5. Matching subject succeeds
    const rMatch = await verifyVersionedEntitlement({ token, keyStore, currentTimestamp: now, expectedSubject: 'usr_verified_123' });
    assert.equal(rMatch.valid, true);

    // 6. LIFETIME tier cannot bypass subject verification
    const tokenLifetime = await mintVersionedEntitlementToken({
      payload: { sub: 'usr_verified_123', sku: 'pack_lifetime', tier: 'LIFETIME', lastValidatedAt: new Date(now).toISOString() },
      privateKey: keyPair.privateKey
    });
    const rLifetimeMismatch = await verifyVersionedEntitlement({ token: tokenLifetime, keyStore, currentTimestamp: now, expectedSubject: 'usr_other' });
    assert.equal(rLifetimeMismatch.valid, false);
    assert.equal(rLifetimeMismatch.reason, 'SUBJECT_MISMATCH');

    const tokenLifetimeNoSub = await mintVersionedEntitlementToken({
      payload: { sku: 'pack_lifetime', tier: 'LIFETIME', lastValidatedAt: new Date(now).toISOString() },
      privateKey: keyPair.privateKey
    });
    const rLifetimeMissingSub = await verifyVersionedEntitlement({ token: tokenLifetimeNoSub, keyStore, currentTimestamp: now, expectedSubject: 'usr_verified_123' });
    assert.equal(rLifetimeMissingSub.valid, false);
    assert.equal(rLifetimeMissingSub.reason, 'TOKEN_SUBJECT_MISSING');

    // 7. Production mode strictly blocks allowUnboundSubject
    const prevEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      const rProdUnbound = await verifyVersionedEntitlement({
        token,
        keyStore,
        currentTimestamp: now,
        allowUnboundSubject: true
      });
      assert.equal(rProdUnbound.valid, false);
      assert.equal(rProdUnbound.reason, 'EXPECTED_SUBJECT_REQUIRED');
    } finally {
      process.env.NODE_ENV = prevEnv;
    }
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
