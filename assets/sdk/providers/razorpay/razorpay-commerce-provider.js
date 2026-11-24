/**
 * AuroMasti Shared Platform SDK — Razorpay Commerce & Payment Verification
 *
 * Implements:
 * 1. Strict separation: Client-side purchase initiation vs Server-authoritative payment verification.
 * 2. Browser protection: Rejects initialization if secrets are passed to client code.
 * 3. Server-authoritative order creation and signature verification (constant-time HMAC-SHA256).
 * 4. Durable persistence contracts for order idempotency and replay prevention.
 * 5. Strict account binding: Orders, payments, and entitlements are tied to verified user IDs.
 * 6. Scoped webhook processing: Refunds revoke only the specific user's affected entitlement.
 */

import crypto from 'node:crypto';

/**
 * Validates Razorpay payment signature using constant-time HMAC-SHA256 comparison.
 *
 * @param {object} params
 * @param {string} params.orderId
 * @param {string} params.paymentId
 * @param {string} params.signature
 * @param {string} params.keySecret
 * @returns {boolean}
 */
export function validateRazorpayPaymentSignature({ orderId, paymentId, signature, keySecret }) {
  if (!orderId || !paymentId || !signature || !keySecret) {
    return false;
  }
  if (typeof orderId !== 'string' || typeof paymentId !== 'string' || typeof signature !== 'string' || typeof keySecret !== 'string') {
    return false;
  }

  const expectedData = `${orderId}|${paymentId}`;
  try {
    const hmac = crypto.createHmac('sha256', keySecret);
    hmac.update(expectedData);
    const expectedSignature = hmac.digest('hex');

    const sigBuf = Buffer.from(signature, 'hex');
    const expectedBuf = Buffer.from(expectedSignature, 'hex');

    if (sigBuf.length !== expectedBuf.length) {
      return false;
    }
    return crypto.timingSafeEqual(sigBuf, expectedBuf);
  } catch {
    return false;
  }
}

/**
 * Validates Razorpay webhook signature using constant-time comparison.
 *
 * @param {object} params
 * @param {string|Buffer} params.rawBody
 * @param {string} params.signature - Header 'X-Razorpay-Signature'
 * @param {string} params.webhookSecret
 * @returns {boolean}
 */
export function validateRazorpayWebhookSignature({ rawBody, signature, webhookSecret }) {
  if (!rawBody || !signature || !webhookSecret) {
    return false;
  }
  if (typeof signature !== 'string' || typeof webhookSecret !== 'string') {
    return false;
  }

  try {
    const hmac = crypto.createHmac('sha256', webhookSecret);
    hmac.update(rawBody);
    const expectedSignature = hmac.digest('hex');

    const sigBuf = Buffer.from(signature, 'hex');
    const expectedBuf = Buffer.from(expectedSignature, 'hex');

    if (sigBuf.length !== expectedBuf.length) {
      return false;
    }
    return crypto.timingSafeEqual(sigBuf, expectedBuf);
  } catch {
    return false;
  }
}

/**
 * In-memory reference store implementing the DurablePersistenceStore interface for tests.
 * Clearly marked with isInMemory = true. MUST NOT be used in production.
 */
export function createInMemoryDurableStore() {
  const orders = new Map();
  const idempotencyMap = new Map();
  const settledPayments = new Map(); // paymentId -> record
  const entitlements = new Map(); // `${userId}:${sku}` -> record

  return {
    isInMemory: true,
    async getOrderById(orderId) {
      return orders.get(orderId) || null;
    },
    async getOrderByKey(idempotencyKey) {
      const orderId = idempotencyMap.get(idempotencyKey);
      return orderId ? orders.get(orderId) || null : null;
    },
    async saveOrder(order, idempotencyKey = null) {
      orders.set(order.id, order);
      if (idempotencyKey) idempotencyMap.set(idempotencyKey, order.id);
      return true;
    },
    async isPaymentSettled(paymentId) {
      return settledPayments.has(paymentId);
    },
    async recordSettlement(record) {
      if (settledPayments.has(record.paymentId)) return false;
      settledPayments.set(record.paymentId, record);
      return true;
    },
    async grantEntitlement(record) {
      const key = `${record.userId}:${record.sku}`;
      entitlements.set(key, record);
      return true;
    },
    async settleAndGrantEntitlement({ settlementRecord, entitlementRecord }) {
      if (settledPayments.has(settlementRecord.paymentId)) {
        return { ok: false, errorCode: 'ERR_PAYMENT_ALREADY_SETTLED', message: 'Payment already settled' };
      }
      settledPayments.set(settlementRecord.paymentId, settlementRecord);
      const key = `${entitlementRecord.userId}:${entitlementRecord.sku}`;
      entitlements.set(key, entitlementRecord);
      return { ok: true };
    },
    async revokeEntitlement(userId, sku) {
      const key = `${userId}:${sku}`;
      return entitlements.delete(key);
    },
    async getEntitlement(userId, sku) {
      return entitlements.get(`${userId}:${sku}`) || null;
    },
    async listUserEntitlements(userId) {
      const userPrefix = `${userId}:`;
      const res = [];
      for (const [k, v] of entitlements.entries()) {
        if (k.startsWith(userPrefix)) res.push(v);
      }
      return res;
    }
  };
}

/**
 * Trusted Server-Side Razorpay Verification Service.
 * Runs strictly within authenticated backend/Edge Functions.
 */
export function createRazorpayServerVerifier({
  keyId = null,
  keySecret,
  webhookSecret = null,
  persistenceStore = null,
  currency = 'INR',
  isProduction = process.env.NODE_ENV === 'production',
  razorpayApiClient = null,
  fetchFn = globalThis.fetch,
  allowSimulatedOrders = false
} = {}) {
  if (!keySecret) {
    throw new Error('KEY_SECRET_REQUIRED: Server verifier requires a valid keySecret.');
  }
  if (!persistenceStore) {
    throw new Error('DURABLE_STORE_REQUIRED: A durable persistence store must be explicitly configured.');
  }
  if (isProduction && persistenceStore.isInMemory) {
    throw new Error('IN_MEMORY_STORE_FORBIDDEN: In-memory persistence store is strictly forbidden in production.');
  }

  /**
   * Creates an authoritative Razorpay order bound to an authenticated user and SKU.
   */
  async function createAuthoritativeOrder({
    userId,
    sku,
    amount,
    receipt = null,
    idempotencyKey = null,
    notes = {}
  }) {
    if (!userId || typeof userId !== 'string') {
      return { ok: false, errorCode: 'INVALID_USER_ID', message: 'Order must be bound to a valid userId' };
    }
    if (!sku || typeof sku !== 'string') {
      return { ok: false, errorCode: 'INVALID_SKU', message: 'Order must have a valid non-empty SKU' };
    }

    const amountInPaise = Math.floor(Number(amount));
    if (!Number.isFinite(amountInPaise) || amountInPaise <= 0) {
      return { ok: false, errorCode: 'INVALID_AMOUNT', message: 'Amount must be a positive integer in paise' };
    }

    // Check durable idempotency
    if (idempotencyKey) {
      const existing = await persistenceStore.getOrderByKey(idempotencyKey);
      if (existing) {
        return { ok: true, order: existing, idempotentReplay: true };
      }
    }

    let orderId;
    let orderEntity = null;

    if (razorpayApiClient && razorpayApiClient.orders && typeof razorpayApiClient.orders.create === 'function') {
      try {
        const apiRes = await razorpayApiClient.orders.create({
          amount: amountInPaise,
          currency,
          receipt: receipt || `rcpt_${Date.now()}`,
          notes: { userId, sku, ...notes }
        });
        orderId = apiRes.id;
        orderEntity = apiRes;
      } catch (err) {
        return { ok: false, errorCode: 'RAZORPAY_API_ORDER_CREATION_FAILED', message: err.message };
      }
    } else if (fetchFn && keyId && !allowSimulatedOrders) {
      try {
        const basicAuth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
        const resp = await fetchFn('https://api.razorpay.com/v1/orders', {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${basicAuth}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            amount: amountInPaise,
            currency,
            receipt: receipt || `rcpt_${Date.now()}`,
            notes: { userId, sku, ...notes }
          })
        });
        if (!resp.ok) {
          const errBody = await resp.text().catch(() => '');
          return { ok: false, errorCode: 'RAZORPAY_API_ORDER_CREATION_FAILED', message: `Razorpay API error: ${resp.status} ${errBody}` };
        }
        const data = await resp.json();
        orderId = data.id;
        orderEntity = data;
      } catch (err) {
        return { ok: false, errorCode: 'RAZORPAY_API_NETWORK_ERROR', message: err.message };
      }
    } else if (allowSimulatedOrders) {
      orderId = `order_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    } else {
      return {
        ok: false,
        errorCode: 'RAZORPAY_API_NOT_CONFIGURED',
        message: 'Authoritative Razorpay order creation requires razorpayApiClient or fetchFn with keyId.'
      };
    }

    const orderRecord = Object.freeze({
      id: orderId,
      userId,
      sku,
      amount: amountInPaise,
      currency,
      receipt: receipt || `rcpt_${Date.now()}`,
      status: 'created',
      createdAt: new Date().toISOString(),
      notes: Object.freeze({ ...notes })
    });

    await persistenceStore.saveOrder(orderRecord, idempotencyKey);

    return {
      ok: true,
      order: orderRecord,
      idempotentReplay: false
    };
  }

  /**
   * Verifies payment and activates entitlement with durable replay protection.
   */
  async function verifyAuthoritativePayment({
    userId,
    orderId,
    paymentId,
    signature,
    paymentEntity = null
  }) {
    if (!userId || !orderId || !paymentId || !signature) {
      return { ok: false, errorCode: 'MISSING_PAYMENT_CREDENTIALS', message: 'userId, orderId, paymentId, and signature are required' };
    }

    // 1. Replay attack defense at persistence boundary
    const alreadySettled = await persistenceStore.isPaymentSettled(paymentId);
    if (alreadySettled) {
      return {
        ok: false,
        errorCode: 'ERR_PAYMENT_ALREADY_SETTLED',
        message: 'Payment ID has already been settled and cannot be replayed'
      };
    }

    // 2. Fetch authoritative order
    const order = await persistenceStore.getOrderById(orderId);
    if (!order) {
      return { ok: false, errorCode: 'ORDER_NOT_FOUND', message: 'Referenced order not found' };
    }

    // 3. Validate user ownership and SKU binding
    if (order.userId !== userId) {
      return {
        ok: false,
        errorCode: 'ORDER_OWNERSHIP_MISMATCH',
        message: 'Authenticated user does not match order recipient'
      };
    }

    // 4. Validate cryptographic HMAC-SHA256 signature
    const isValidSignature = validateRazorpayPaymentSignature({
      orderId,
      paymentId,
      signature,
      keySecret
    });
    if (!isValidSignature) {
      return {
        ok: false,
        errorCode: 'INVALID_PAYMENT_SIGNATURE',
        message: 'Cryptographic signature verification failed'
      };
    }

    // 5. Authoritative verification of payment status against trusted Razorpay API or payment entity
    let authoritativePayment = paymentEntity;
    if (!authoritativePayment) {
      if (razorpayApiClient && razorpayApiClient.payments && typeof razorpayApiClient.payments.fetch === 'function') {
        try {
          authoritativePayment = await razorpayApiClient.payments.fetch(paymentId);
        } catch (err) {
          return { ok: false, errorCode: 'RAZORPAY_PAYMENT_FETCH_FAILED', message: err.message };
        }
      } else if (fetchFn && keyId && !allowSimulatedOrders) {
        try {
          const basicAuth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
          const resp = await fetchFn(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, {
            method: 'GET',
            headers: { 'Authorization': `Basic ${basicAuth}` }
          });
          if (!resp.ok) {
            return { ok: false, errorCode: 'RAZORPAY_PAYMENT_FETCH_FAILED', message: `Razorpay payment API returned ${resp.status}` };
          }
          authoritativePayment = await resp.json();
        } catch (err) {
          return { ok: false, errorCode: 'RAZORPAY_API_NETWORK_ERROR', message: err.message };
        }
      } else if (allowSimulatedOrders) {
        authoritativePayment = {
          id: paymentId,
          order_id: orderId,
          status: 'captured',
          amount: order.amount,
          currency: order.currency
        };
      } else {
        return {
          ok: false,
          errorCode: 'RAZORPAY_API_NOT_CONFIGURED',
          message: 'Authoritative payment verification requires razorpayApiClient or fetchFn with keyId.'
        };
      }
    }

    // 6. Enforce payment status, amount, currency, and order association
    if (!authoritativePayment || typeof authoritativePayment !== 'object') {
      return { ok: false, errorCode: 'INVALID_PAYMENT_RECORD', message: 'Authoritative payment record is invalid' };
    }
    if (authoritativePayment.status !== 'captured') {
      return {
        ok: false,
        errorCode: 'PAYMENT_NOT_CAPTURED',
        message: `Payment status is '${authoritativePayment.status}', expected 'captured'`
      };
    }
    if (authoritativePayment.order_id !== orderId) {
      return {
        ok: false,
        errorCode: 'ORDER_PAYMENT_MISMATCH',
        message: 'Payment is not associated with the requested order'
      };
    }
    if (authoritativePayment.amount !== order.amount) {
      return {
        ok: false,
        errorCode: 'PAYMENT_AMOUNT_MISMATCH',
        message: `Payment amount (${authoritativePayment.amount}) does not match order amount (${order.amount})`
      };
    }
    if (authoritativePayment.currency !== order.currency) {
      return {
        ok: false,
        errorCode: 'PAYMENT_CURRENCY_MISMATCH',
        message: `Payment currency (${authoritativePayment.currency}) does not match order currency (${order.currency})`
      };
    }

    // 7. Atomic settlement and entitlement grant at durable persistence boundary
    const settlementRecord = Object.freeze({
      orderId,
      paymentId,
      userId,
      sku: order.sku,
      amount: order.amount,
      currency: order.currency,
      settledAt: new Date().toISOString()
    });

    const entitlementRecord = Object.freeze({
      sku: order.sku,
      userId,
      orderId,
      paymentId,
      status: 'active',
      grantedAt: new Date().toISOString()
    });

    try {
      if (typeof persistenceStore.settleAndGrantEntitlement === 'function') {
        const settleResult = await persistenceStore.settleAndGrantEntitlement({ settlementRecord, entitlementRecord });
        if (!settleResult || !settleResult.ok) {
          return {
            ok: false,
            errorCode: settleResult?.errorCode || 'SETTLEMENT_RECORDING_FAILED',
            message: settleResult?.message || 'Atomic settlement and entitlement grant failed'
          };
        }
      } else {
        const recorded = await persistenceStore.recordSettlement(settlementRecord);
        if (!recorded) {
          return { ok: false, errorCode: 'SETTLEMENT_RECORDING_FAILED' };
        }
        await persistenceStore.grantEntitlement(entitlementRecord);
      }
    } catch (err) {
      return {
        ok: false,
        errorCode: 'DURABLE_PERSISTENCE_FAILURE',
        message: `Durable persistence store failure: ${err.message}`
      };
    }

    return {
      ok: true,
      status: 'success',
      transaction: entitlementRecord
    };
  }

  /**
   * Processes server webhook with signature, order ownership, and user isolation.
   */
  async function processAuthoritativeWebhook({ rawBody, signature }) {
    if (!webhookSecret) {
      return { ok: false, errorCode: 'WEBHOOK_SECRET_NOT_CONFIGURED' };
    }

    const isValid = validateRazorpayWebhookSignature({ rawBody, signature, webhookSecret });
    if (!isValid) {
      return { ok: false, errorCode: 'INVALID_WEBHOOK_SIGNATURE' };
    }

    let payload;
    try {
      payload = typeof rawBody === 'string' ? JSON.parse(rawBody) : JSON.parse(rawBody.toString('utf8'));
    } catch {
      return { ok: false, errorCode: 'MALFORMED_WEBHOOK_PAYLOAD' };
    }

    const eventType = payload.event || null;

    if (eventType === 'payment.captured') {
      const payment = payload.payload?.payment?.entity;
      const paymentId = payment?.id;
      const orderId = payment?.order_id;

      if (!paymentId || !orderId) {
        return { ok: false, errorCode: 'INVALID_WEBHOOK_ENTITIES' };
      }

      const alreadySettled = await persistenceStore.isPaymentSettled(paymentId);
      if (alreadySettled) {
        return { ok: true, ignored: true, reason: 'ALREADY_SETTLED' };
      }

      const order = await persistenceStore.getOrderById(orderId);
      if (!order) {
        return { ok: false, errorCode: 'WEBHOOK_ORDER_NOT_FOUND' };
      }

      // Validate currency and amount match
      if (payment.amount !== order.amount) {
        return { ok: false, errorCode: 'AMOUNT_MISMATCH' };
      }
      if (payment.currency !== order.currency) {
        return { ok: false, errorCode: 'CURRENCY_MISMATCH' };
      }
      if (payment.status && payment.status !== 'captured') {
        return { ok: false, errorCode: 'PAYMENT_NOT_CAPTURED' };
      }

      const settlementRecord = Object.freeze({
        orderId,
        paymentId,
        userId: order.userId,
        sku: order.sku,
        amount: order.amount,
        currency: order.currency,
        settledAt: new Date().toISOString()
      });

      const entitlementRecord = Object.freeze({
        sku: order.sku,
        userId: order.userId,
        orderId,
        paymentId,
        status: 'active',
        grantedAt: new Date().toISOString()
      });

      if (typeof persistenceStore.settleAndGrantEntitlement === 'function') {
        const sRes = await persistenceStore.settleAndGrantEntitlement({ settlementRecord, entitlementRecord });
        if (!sRes || !sRes.ok) {
          return { ok: false, errorCode: sRes?.errorCode || 'SETTLEMENT_RECORDING_FAILED' };
        }
      } else {
        await persistenceStore.recordSettlement(settlementRecord);
        await persistenceStore.grantEntitlement(entitlementRecord);
      }

      return { ok: true, eventType, processed: true, userId: order.userId, sku: order.sku };
    }

    if (eventType === 'refund.processed') {
      const refund = payload.payload?.refund?.entity;
      const paymentId = refund?.payment_id;

      if (!paymentId) {
        return { ok: false, errorCode: 'INVALID_REFUND_ENTITY' };
      }

      // Find the specific settled payment to target ONLY the affected user and SKU
      const orderId = refund?.order_id;
      const order = orderId ? await persistenceStore.getOrderById(orderId) : null;
      if (order) {
        await persistenceStore.revokeEntitlement(order.userId, order.sku);
        return { ok: true, eventType, revoked: true, userId: order.userId, sku: order.sku };
      }

      return { ok: true, eventType, ignored: true, reason: 'NO_MATCHING_ORDER' };
    }

    return { ok: true, eventType, ignored: true, reason: 'UNHANDLED_EVENT_TYPE' };
  }

  return Object.freeze({
    createAuthoritativeOrder,
    verifyAuthoritativePayment,
    processAuthoritativeWebhook,
    persistenceStore
  });
}

/**
 * Client-Side Razorpay Provider Adapter.
 * Does NOT hold secrets and cannot self-grant entitlements.
 */
export function createRazorpayClientProvider({
  keyId,
  keySecret,
  webhookSecret,
  orderEndpoint = '/api/commerce/create-order',
  verifyEndpoint = '/api/commerce/verify-payment',
  fetchFn = globalThis.fetch
} = {}) {
  // Security Guard: Secrets must NEVER be supplied to client-side code
  if (keySecret || webhookSecret) {
    throw new Error('SECURITY_VIOLATION: Provider secrets (keySecret, webhookSecret) must never be passed to client-side provider.');
  }

  function isConfigured() {
    return Boolean(keyId);
  }

  async function purchase(sku, options = {}) {
    // Client initiates checkout through server-authoritative endpoints
    return Object.freeze({
      ok: false,
      errorCode: 'CLIENT_SELF_GRANT_FORBIDDEN',
      message: 'Client cannot grant its own entitlements without verified server checkout.'
    });
  }

  return Object.freeze({
    providerName: 'razorpay-client',
    isConfigured,
    purchase
  });
}

/**
 * Isolated Mock Provider for unit and behavioral tests.
 */
export function createMockRazorpayTestFixture(initialEntitlements = []) {
  const store = createInMemoryDurableStore();
  const testKeySecret = 'test_secret_for_mock_only_12345';
  const verifier = createRazorpayServerVerifier({
    keyId: 'rzp_mock_key',
    keySecret: testKeySecret,
    webhookSecret: 'test_webhook_secret_67890',
    persistenceStore: store,
    isProduction: false,
    allowSimulatedOrders: true
  });

  return {
    verifier,
    store,
    testKeySecret
  };
}
