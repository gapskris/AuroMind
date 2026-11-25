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
  fetchFn = globalThis.fetch
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
  if (isProduction && typeof persistenceStore.settleAndGrantEntitlement !== 'function') {
    throw new Error('ATOMIC_STORE_REQUIRED: Production verifier requires persistenceStore to implement atomic settleAndGrantEntitlement.');
  }

  /**
   * Sanitizes error messages to prevent leakage of secrets, auth headers, and credentials.
   */
  function sanitizeErrorMessage(msg) {
    if (typeof msg !== 'string') return '';
    let sanitized = msg;
    if (keySecret) {
      sanitized = sanitized.split(keySecret).join('[REDACTED_SECRET]');
    }
    if (keyId) {
      sanitized = sanitized.split(keyId).join('[REDACTED_KEY_ID]');
    }
    return sanitized
      .replace(/Basic\s+[A-Za-z0-9+/=]+/gi, 'Basic [REDACTED]')
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]');
  }

  /**
   * Creates an authoritative Razorpay order bound to an authenticated user and SKU.
   * Validates provider order response before persistence. Fails closed on mismatch or failure.
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
        orderEntity = apiRes;
      } catch (err) {
        return {
          ok: false,
          errorCode: 'RAZORPAY_API_ORDER_CREATION_FAILED',
          message: sanitizeErrorMessage(err.message || 'Order creation failed')
        };
      }
    } else if (fetchFn && keyId) {
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
          return {
            ok: false,
            errorCode: 'RAZORPAY_API_ORDER_CREATION_FAILED',
            message: sanitizeErrorMessage(`Razorpay API error: ${resp.status} ${errBody}`)
          };
        }
        orderEntity = await resp.json();
      } catch (err) {
        return {
          ok: false,
          errorCode: 'RAZORPAY_API_NETWORK_ERROR',
          message: sanitizeErrorMessage(err.message || 'Network error reaching Razorpay API')
        };
      }
    } else {
      return {
        ok: false,
        errorCode: 'RAZORPAY_API_NOT_CONFIGURED',
        message: 'Authoritative Razorpay order creation requires razorpayApiClient or fetchFn with keyId.'
      };
    }

    // 1. Validate provider-created order response before persistence
    if (!orderEntity || typeof orderEntity !== 'object') {
      return { ok: false, errorCode: 'PROVIDER_ORDER_INVALID', message: 'Provider returned an invalid order payload' };
    }
    if (typeof orderEntity.id !== 'string' || orderEntity.id.trim() === '') {
      return { ok: false, errorCode: 'PROVIDER_ORDER_ID_MISSING', message: 'Provider order ID is missing or empty' };
    }
    if (Math.floor(Number(orderEntity.amount)) !== amountInPaise) {
      return { ok: false, errorCode: 'PROVIDER_ORDER_AMOUNT_MISMATCH', message: 'Provider order amount does not match requested amount' };
    }
    if (typeof orderEntity.currency !== 'string' || orderEntity.currency.toUpperCase() !== currency.toUpperCase()) {
      return { ok: false, errorCode: 'PROVIDER_ORDER_CURRENCY_MISMATCH', message: 'Provider order currency does not match requested currency' };
    }

    orderId = orderEntity.id;

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

    try {
      const saved = await persistenceStore.saveOrder(orderRecord, idempotencyKey);
      if (!saved) {
        return { ok: false, errorCode: 'ORDER_PERSISTENCE_FAILED', message: 'Failed to persist authoritative order' };
      }
    } catch (err) {
      return {
        ok: false,
        errorCode: 'ORDER_PERSISTENCE_FAILED',
        message: sanitizeErrorMessage(err.message || 'Order persistence error')
      };
    }

    return {
      ok: true,
      order: orderRecord,
      idempotentReplay: false
    };
  }

  /**
   * Verifies payment and activates entitlement with durable replay protection.
   * Strictly enforces provider-authoritative payment evidence. Caller-supplied
   * paymentEntity is NEVER accepted as proof.
   */
  async function verifyAuthoritativePayment({
    userId,
    orderId,
    paymentId,
    signature
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

    // 5. Always retrieve payment status from trusted Razorpay server API or trusted injected API client
    let authoritativePayment = null;

    if (razorpayApiClient && razorpayApiClient.payments && typeof razorpayApiClient.payments.fetch === 'function') {
      try {
        authoritativePayment = await razorpayApiClient.payments.fetch(paymentId);
      } catch (err) {
        return {
          ok: false,
          errorCode: 'RAZORPAY_PAYMENT_FETCH_FAILED',
          message: sanitizeErrorMessage(err.message || 'Failed to fetch payment from Razorpay API')
        };
      }
    } else if (fetchFn && keyId) {
      try {
        const basicAuth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
        const resp = await fetchFn(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, {
          method: 'GET',
          headers: { 'Authorization': `Basic ${basicAuth}` }
        });
        if (!resp.ok) {
          return {
            ok: false,
            errorCode: 'RAZORPAY_PAYMENT_FETCH_FAILED',
            message: `Razorpay payment API returned ${resp.status}`
          };
        }
        authoritativePayment = await resp.json();
      } catch (err) {
        return {
          ok: false,
          errorCode: 'RAZORPAY_API_NETWORK_ERROR',
          message: sanitizeErrorMessage(err.message || 'Network error reaching Razorpay API')
        };
      }
    } else {
      return {
        ok: false,
        errorCode: 'RAZORPAY_API_NOT_CONFIGURED',
        message: 'Authoritative payment verification requires razorpayApiClient or fetchFn with keyId.'
      };
    }

    // 6. Enforce payment status, ID, amount, currency, and order association
    if (!authoritativePayment || typeof authoritativePayment !== 'object') {
      return { ok: false, errorCode: 'INVALID_PAYMENT_RECORD', message: 'Authoritative payment record is invalid' };
    }
    if (authoritativePayment.id !== paymentId) {
      return {
        ok: false,
        errorCode: 'PAYMENT_ID_MISMATCH',
        message: 'Provider payment ID does not match requested payment ID'
      };
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
        if (isProduction) {
          return {
            ok: false,
            errorCode: 'NON_ATOMIC_PERSISTENCE_FORBIDDEN',
            message: 'Production requires an atomic settlement store.'
          };
        }
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
   * Treats signature as proof of origin, then authoritatively verifies payment details
   * from the trusted Razorpay API before settlement and entitlement grant.
   */
  async function processAuthoritativeWebhook({ rawBody, signature }) {
    if (!webhookSecret) {
      return { ok: false, errorCode: 'WEBHOOK_SECRET_NOT_CONFIGURED', message: 'Webhook secret is not configured' };
    }

    const isValid = validateRazorpayWebhookSignature({ rawBody, signature, webhookSecret });
    if (!isValid) {
      return { ok: false, errorCode: 'INVALID_WEBHOOK_SIGNATURE', message: 'Webhook signature validation failed' };
    }

    let payload;
    try {
      payload = typeof rawBody === 'string' ? JSON.parse(rawBody) : JSON.parse(rawBody.toString('utf8'));
    } catch {
      return { ok: false, errorCode: 'MALFORMED_WEBHOOK_PAYLOAD', message: 'Webhook payload could not be parsed as JSON' };
    }

    const eventType = payload.event || null;

    if (eventType === 'payment.captured') {
      const paymentEntity = payload.payload?.payment?.entity;
      const paymentId = paymentEntity?.id;
      const orderId = paymentEntity?.order_id;
      const webhookStatus = paymentEntity?.status;

      // 1. Validate webhook entities (fail closed on missing fields)
      if (!paymentId || typeof paymentId !== 'string' || !orderId || typeof orderId !== 'string') {
        return { ok: false, errorCode: 'INVALID_WEBHOOK_ENTITIES', message: 'Webhook payment entity missing id or order_id' };
      }
      if (!webhookStatus || webhookStatus !== 'captured') {
        return { ok: false, errorCode: 'PAYMENT_NOT_CAPTURED', message: `Webhook payment status is '${webhookStatus}', expected 'captured'` };
      }

      // 2. Duplicate webhook replay defense (idempotent ignore)
      const alreadySettled = await persistenceStore.isPaymentSettled(paymentId);
      if (alreadySettled) {
        return { ok: true, ignored: true, reason: 'ALREADY_SETTLED' };
      }

      // 3. Validate persisted order ownership & binding
      const order = await persistenceStore.getOrderById(orderId);
      if (!order) {
        return { ok: false, errorCode: 'WEBHOOK_ORDER_NOT_FOUND', message: 'Order referenced in webhook not found' };
      }
      if (!order.userId || typeof order.userId !== 'string' || !order.sku || typeof order.sku !== 'string') {
        return { ok: false, errorCode: 'INVALID_ORDER_RECORD', message: 'Persisted order is missing userId or sku' };
      }

      // 4. Authoritative payment verification from trusted Razorpay API
      let authoritativePayment = null;
      if (razorpayApiClient && razorpayApiClient.payments && typeof razorpayApiClient.payments.fetch === 'function') {
        try {
          authoritativePayment = await razorpayApiClient.payments.fetch(paymentId);
        } catch (err) {
          return {
            ok: false,
            errorCode: 'RAZORPAY_PAYMENT_FETCH_FAILED',
            message: sanitizeErrorMessage(err.message || 'Failed to fetch payment from Razorpay API')
          };
        }
      } else if (fetchFn && keyId) {
        try {
          const basicAuth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
          const resp = await fetchFn(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, {
            method: 'GET',
            headers: { 'Authorization': `Basic ${basicAuth}` }
          });
          if (!resp.ok) {
            return {
              ok: false,
              errorCode: 'RAZORPAY_PAYMENT_FETCH_FAILED',
              message: `Razorpay payment API returned ${resp.status}`
            };
          }
          authoritativePayment = await resp.json();
        } catch (err) {
          return {
            ok: false,
            errorCode: 'RAZORPAY_API_NETWORK_ERROR',
            message: sanitizeErrorMessage(err.message || 'Network error reaching Razorpay API')
          };
        }
      } else {
        return {
          ok: false,
          errorCode: 'RAZORPAY_API_NOT_CONFIGURED',
          message: 'Authoritative webhook verification requires razorpayApiClient or fetchFn with keyId.'
        };
      }

      // 5. Enforce fetched payment details match persisted order
      if (!authoritativePayment || typeof authoritativePayment !== 'object') {
        return { ok: false, errorCode: 'INVALID_PAYMENT_RECORD', message: 'Authoritative payment record is invalid' };
      }
      if (authoritativePayment.id !== paymentId) {
        return { ok: false, errorCode: 'PAYMENT_ID_MISMATCH', message: 'Provider payment ID does not match webhook payment ID' };
      }
      if (authoritativePayment.order_id !== orderId) {
        return { ok: false, errorCode: 'ORDER_PAYMENT_MISMATCH', message: 'Payment is not associated with the requested order' };
      }
      if (authoritativePayment.status !== 'captured') {
        return { ok: false, errorCode: 'PAYMENT_NOT_CAPTURED', message: `Authoritative payment status is '${authoritativePayment.status}', expected 'captured'` };
      }
      if (authoritativePayment.amount !== order.amount) {
        return { ok: false, errorCode: 'AMOUNT_MISMATCH', message: `Payment amount (${authoritativePayment.amount}) does not match order amount (${order.amount})` };
      }
      if (authoritativePayment.currency !== order.currency) {
        return { ok: false, errorCode: 'CURRENCY_MISMATCH', message: `Payment currency (${authoritativePayment.currency}) does not match order currency (${order.currency})` };
      }

      // 6. Atomic settlement and entitlement granting
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

      try {
        if (typeof persistenceStore.settleAndGrantEntitlement === 'function') {
          const sRes = await persistenceStore.settleAndGrantEntitlement({ settlementRecord, entitlementRecord });
          if (!sRes || !sRes.ok) {
            return {
              ok: false,
              errorCode: sRes?.errorCode || 'SETTLEMENT_RECORDING_FAILED',
              message: sRes?.message || 'Atomic settlement and entitlement grant failed'
            };
          }
        } else {
          if (isProduction) {
            return {
              ok: false,
              errorCode: 'NON_ATOMIC_PERSISTENCE_FORBIDDEN',
              message: 'Production requires an atomic settlement store.'
            };
          }
          const recorded = await persistenceStore.recordSettlement(settlementRecord);
          if (!recorded) {
            return { ok: false, errorCode: 'SETTLEMENT_RECORDING_FAILED', message: 'Failed to record settlement' };
          }
          await persistenceStore.grantEntitlement(entitlementRecord);
        }
      } catch (err) {
        return {
          ok: false,
          errorCode: 'DURABLE_PERSISTENCE_FAILURE',
          message: sanitizeErrorMessage(err.message || 'Durable persistence failure')
        };
      }

      return { ok: true, eventType, processed: true, userId: order.userId, sku: order.sku };
    }

    if (eventType === 'refund.processed') {
      const refund = payload.payload?.refund?.entity;
      const paymentId = refund?.payment_id;
      const orderId = refund?.order_id;

      if (!paymentId || typeof paymentId !== 'string') {
        return { ok: false, errorCode: 'INVALID_REFUND_ENTITY', message: 'Refund entity missing valid payment_id' };
      }

      try {
        // Enforce ownership: find order and strictly revoke ONLY the affected user and SKU
        const order = orderId ? await persistenceStore.getOrderById(orderId) : null;
        if (order && order.userId && order.sku) {
          await persistenceStore.revokeEntitlement(order.userId, order.sku);
          return { ok: true, eventType, revoked: true, userId: order.userId, sku: order.sku };
        }
        return { ok: true, eventType, ignored: true, reason: 'NO_MATCHING_ORDER' };
      } catch (err) {
        return {
          ok: false,
          errorCode: 'REFUND_REVOCATION_FAILURE',
          message: sanitizeErrorMessage(err.message || 'Refund revocation failure')
        };
      }
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
  const testKeyId = 'rzp_mock_key';
  const paymentsRegistry = new Map();

  const mockApiClient = {
    orders: {
      async create({ amount, currency, receipt, notes }) {
        const id = `order_mock_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        return { id, amount, currency, receipt, status: 'created', notes };
      }
    },
    payments: {
      async fetch(paymentId) {
        if (paymentsRegistry.has(paymentId)) {
          const p = paymentsRegistry.get(paymentId);
          if (p instanceof Error) throw p;
          return p;
        }
        throw new Error(`Razorpay payment ${paymentId} not found in provider API`);
      }
    }
  };

  const verifier = createRazorpayServerVerifier({
    keyId: testKeyId,
    keySecret: testKeySecret,
    webhookSecret: 'test_webhook_secret_67890',
    persistenceStore: store,
    isProduction: false,
    razorpayApiClient: mockApiClient
  });

  return {
    verifier,
    store,
    testKeySecret,
    testKeyId,
    paymentsRegistry,
    mockApiClient
  };
}
