/**
 * AuroMind Shared Platform SDK — Core Runtime & Guest Identity (v1.0.0)
 *
 * Local-first, offline-first, provider-independent browser-native ES module.
 * Owns ONLY the shared device guest identity and platform metadata store:
 *   - Primary durable store: IndexedDB `AuroMindPlatformDB` (v1), store `platform_meta`, key `guest_identity`
 *   - Synchronous mirror/fallback: localStorage key `auromind.platform.v1.guest`
 *   - Cross-tab coordination: Web Locks (`auromind-platform-guest-init`) +
 *     BroadcastChannel (`auromind_platform_bus`) + `storage` event fallback
 *
 * Zero external runtime dependencies. Zero network calls during initialization.
 * Zero Supabase or cloud provider coupling. Never touches game-owned databases or save keys.
 */

import {
  createAdapterRegistry,
  GUEST_ID_RE,
  isProtectedPlatformKey,
  PLATFORM_DB_NAME,
  PLATFORM_LS_PREFIX,
  canonicalizeJson,
  canonicalizeObject,
  computeEnvelopeChecksum,
  computePayloadChecksum,
  quarantineCorruptSave,
  createLocalMockBridge
} from './auromind-adapters.js';

export {
  GUEST_ID_RE,
  isProtectedPlatformKey,
  PLATFORM_DB_NAME,
  PLATFORM_LS_PREFIX,
  canonicalizeJson,
  canonicalizeObject,
  computeEnvelopeChecksum,
  computePayloadChecksum,
  quarantineCorruptSave,
  createLocalMockBridge
};

export const SDK_VERSION = '1.0.0';
export const IDENTITY_SCHEMA_VERSION = 1;
export const IDB_DB_NAME = PLATFORM_DB_NAME;
export const IDB_DB_VERSION = 1;
export const IDB_STORE_NAME = 'platform_meta';
export const IDB_GUEST_KEY = 'guest_identity';
export const LS_GUEST_KEY = 'auromind.platform.v1.guest';
export const LS_PROTECTED_PREFIX = PLATFORM_LS_PREFIX;
export const WEB_LOCK_NAME = 'auromind-platform-guest-init';
export const BROADCAST_CHANNEL_NAME = 'auromind_platform_bus';
export const DEFAULT_IDB_TIMEOUT_MS = 1500;

export const LS_LOGS_KEY = 'auromind.platform.v1.diagnostics_log';
export const LS_TELEMETRY_KEY = 'auromind.platform.v1.telemetry_queue';
export const LS_CONSENT_KEY = 'auromind.platform.v1.telemetry_consent';
export const LS_CONFIG_KEY = 'auromind.platform.v1.config_cache';
export const LS_PROFILE_KEY = 'auromind.platform.v1.player_profile';
export const LS_ENTITLEMENTS_KEY = 'auromind.platform.v1.entitlements_cache';
export const LS_SYNC_CONSENT_KEY = 'auromind.platform.v1.sync_consent';
export const LS_OUTBOX_KEY = 'auromind.platform.v1.sync_outbox';
export const LS_SYNC_META_KEY = 'auromind.platform.v1.sync_meta';

const DEFAULT_CAPABILITIES = Object.freeze({
  authEnabled: false,
  cloudSyncEnabled: false,
  entitlementsEnabled: false,
  analyticsEnabled: false,
  remoteConfigEnabled: false
});

export class AuroMindSDKError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AuroMindSDKError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function isIdbVersionError(err) {
  if (!err || typeof err !== 'object') return false;
  return err.name === 'VersionError' || err.code === 'IDB_VERSION_ERROR';
}

/**
 * Generates an RFC-4122 v4 UUID using Web Crypto APIs with a safe fallback.
 * @param {object} [cryptoApi]
 * @returns {string}
 */
export function generateUuidV4(cryptoApi = globalThis.crypto) {
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID().toLowerCase();
  }

  const bytes = new Uint8Array(16);
  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
    cryptoApi.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  // RFC-4122 v4 variant & version bits
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Validates a persisted guest identity record and classifies corruption vs
 * unsupported future schema versions.
 *
 * @param {unknown} raw
 * @returns {{ valid: true, record: object } | { valid: false, reason: string, detectedVersion?: unknown }}
 */
export function validateGuestRecord(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, reason: 'INVALID_STRUCTURE' };
  }

  const version = raw.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    return { valid: false, reason: 'INVALID_VERSION', detectedVersion: version };
  }

  if (version > IDENTITY_SCHEMA_VERSION) {
    return { valid: false, reason: 'UNSUPPORTED_VERSION', detectedVersion: version };
  }

  if (version < IDENTITY_SCHEMA_VERSION) {
    return { valid: false, reason: 'INVALID_VERSION', detectedVersion: version };
  }

  if (typeof raw.guestId !== 'string' || !GUEST_ID_RE.test(raw.guestId)) {
    return { valid: false, reason: 'INVALID_GUEST_ID' };
  }

  const createdMs = typeof raw.createdAt === 'string' ? Date.parse(raw.createdAt) : Number.NaN;
  const lastSeenMs = typeof raw.lastSeenAt === 'string' ? Date.parse(raw.lastSeenAt) : Number.NaN;

  if (Number.isNaN(createdMs) || Number.isNaN(lastSeenMs)) {
    return { valid: false, reason: 'INVALID_TIMESTAMP' };
  }

  const normalizedCreated = new Date(createdMs).toISOString();
  const normalizedLastSeen = new Date(Math.max(createdMs, lastSeenMs)).toISOString();

  return {
    valid: true,
    record: {
      schemaVersion: IDENTITY_SCHEMA_VERSION,
      guestId: raw.guestId.toLowerCase(),
      createdAt: normalizedCreated,
      lastSeenAt: normalizedLastSeen,
      origin: typeof raw.origin === 'string' && raw.origin.length > 0 ? raw.origin : null
    }
  };
}

/**
 * Deterministically reconciles two candidate guest identity records.
 * Earliest valid `createdAt` wins; exact timestamp ties break lexicographically
 * by `guestId` so concurrent tabs always converge onto the same canonical record.
 *
 * @param {object | null} first
 * @param {object | null} second
 * @returns {{ winner: object | null, changedFromFirst: boolean, changedFromSecond: boolean, conflictResolved: boolean }}
 */
export function reconcileGuestRecords(first, second) {
  const v1 = first ? validateGuestRecord(first) : { valid: false };
  const v2 = second ? validateGuestRecord(second) : { valid: false };

  if (!v1.valid && !v2.valid) {
    return { winner: null, changedFromFirst: false, changedFromSecond: false, conflictResolved: false };
  }

  if (v1.valid && !v2.valid) {
    return { winner: v1.record, changedFromFirst: false, changedFromSecond: true, conflictResolved: false };
  }

  if (!v1.valid && v2.valid) {
    return { winner: v2.record, changedFromFirst: true, changedFromSecond: false, conflictResolved: false };
  }

  const r1 = v1.record;
  const r2 = v2.record;

  if (r1.guestId === r2.guestId) {
    const earliestCreated =
      Date.parse(r1.createdAt) <= Date.parse(r2.createdAt) ? r1.createdAt : r2.createdAt;
    const latestLastSeen =
      Date.parse(r1.lastSeenAt) >= Date.parse(r2.lastSeenAt) ? r1.lastSeenAt : r2.lastSeenAt;
    const merged = {
      schemaVersion: IDENTITY_SCHEMA_VERSION,
      guestId: r1.guestId,
      createdAt: earliestCreated,
      lastSeenAt: latestLastSeen,
      origin: r1.origin || r2.origin || null
    };
    return {
      winner: merged,
      changedFromFirst: merged.createdAt !== r1.createdAt || merged.lastSeenAt !== r1.lastSeenAt,
      changedFromSecond: merged.createdAt !== r2.createdAt || merged.lastSeenAt !== r2.lastSeenAt,
      conflictResolved: false
    };
  }

  const t1 = Date.parse(r1.createdAt);
  const t2 = Date.parse(r2.createdAt);

  let chosen;
  if (t1 < t2) {
    chosen = r1;
  } else if (t2 < t1) {
    chosen = r2;
  } else {
    chosen = r1.guestId < r2.guestId ? r1 : r2;
  }

  const latestLastSeen =
    Date.parse(r1.lastSeenAt) >= Date.parse(r2.lastSeenAt) ? r1.lastSeenAt : r2.lastSeenAt;

  const winner = {
    schemaVersion: IDENTITY_SCHEMA_VERSION,
    guestId: chosen.guestId,
    createdAt: chosen.createdAt,
    lastSeenAt:
      Date.parse(latestLastSeen) >= Date.parse(chosen.createdAt)
        ? latestLastSeen
        : chosen.createdAt,
    origin: chosen.origin || r1.origin || r2.origin || null
  };

  return {
    winner,
    changedFromFirst: winner.guestId !== r1.guestId,
    changedFromSecond: winner.guestId !== r2.guestId,
    conflictResolved: true
  };
}

const SENSITIVE_KEY_PATTERN = /(?:password|passphrase|token|secret|auth|bearer|credential|sankalpa|vault|key|private|cipher|salt|iv|seed|intention|reflection|prayer|audio|raw_audio|rawAudio|audio_blob|audio_buffer|speech_recording|corpus_text|stroke|strokes|canvas_strokes|svg_data|journal|note|personalNotes)/i;
const SENSITIVE_VALUE_PATTERNS = [
  /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g, // JWT
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g // Email
];

export function redactSensitive(data, depth = 0) {
  if (depth > 6) return '[DEPTH_LIMIT]';
  if (data === null || data === undefined) return data;
  if (typeof data === 'string') {
    let sanitized = data;
    for (const pat of SENSITIVE_VALUE_PATTERNS) {
      sanitized = sanitized.replace(pat, '[REDACTED]');
    }
    return sanitized;
  }
  if (typeof data === 'number' || typeof data === 'boolean') {
    return data;
  }
  if (Array.isArray(data)) {
    return data.map((item) => redactSensitive(item, depth + 1));
  }
  if (typeof data === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(data)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        out[key] = '[REDACTED]';
      } else {
        out[key] = redactSensitive(val, depth + 1);
      }
    }
    return out;
  }
  return String(data);
}

/**
 * Deep pre-queue privacy sanitizer stripping all occurrences of Sankalpa,
 * raw audio, intentions, and private reflections (TASK-TEL-02 / ADR-09).
 *
 * @param {unknown} data
 * @param {number} [depth=0]
 * @returns {unknown}
 */
export function sanitizeTelemetryPayload(data, depth = 0) {
  if (depth > 6) return null;
  if (data === null || data === undefined) return data;
  if (typeof data !== 'object') {
    if (typeof data === 'string') {
      let sanitized = data;
      for (const pat of SENSITIVE_VALUE_PATTERNS) {
        sanitized = sanitized.replace(pat, '[REDACTED]');
      }
      return sanitized;
    }
    return data;
  }
  if (Array.isArray(data)) {
    const hasObjectsOrSensitive = data.some(
      (item) => item && (typeof item === 'object' || (typeof item === 'string' && SENSITIVE_KEY_PATTERN.test(item)))
    );
    if (hasObjectsOrSensitive) {
      return data.length;
    }
    return data
      .map((item) => sanitizeTelemetryPayload(item, depth + 1))
      .filter((item) => item !== null && item !== undefined);
  }
  const out = {};
  for (const [key, val] of Object.entries(data)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      // Purge completely from telemetry queue (TASK-TEL-02)
      continue;
    }
    const sanitizedVal = sanitizeTelemetryPayload(val, depth + 1);
    if (sanitizedVal !== null && sanitizedVal !== undefined) {
      out[key] = sanitizedVal;
    }
  }
  return out;
}

export function hexToUint8Array(hex) {
  if (typeof hex !== 'string') return new Uint8Array(0);
  const cleanHex = hex.replace(/[^0-9a-fA-F]/g, '');
  const bytes = new Uint8Array(Math.floor(cleanHex.length / 2));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.substr(i * 2, 2), 16);
  }
  return bytes;
}

export function base64ToUint8Array(base64) {
  if (typeof base64 !== 'string') return new Uint8Array(0);
  const normalized = base64.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(padded, 'base64'));
  }
  const binaryString = atob(padded);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export function uint8ArrayToBase64(bytes) {
  if (!bytes || !(bytes instanceof Uint8Array || ArrayBuffer.isView(bytes))) return '';
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(u8).toString('base64');
  }
  let binary = '';
  for (let i = 0; i < u8.length; i++) {
    binary += String.fromCharCode(u8[i]);
  }
  return btoa(binary);
}

export function uint8ArrayToBase64Url(bytes) {
  return uint8ArrayToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Mock purchase provider for offline testing and simulated store events (TASK-COMM-01 / ADR-08).
 *
 * @param {object} [initialConfig={}]
 */
export function createMockPurchaseProvider(initialConfig = {}) {
  let mode = initialConfig.mode || 'success';
  const transactions = new Map(initialConfig.purchases || []);

  return {
    providerName: 'mock-purchase-provider',
    setMode(newMode) {
      mode = newMode;
    },
    getMode() {
      return mode;
    },
    isConfigured: () => true,
    async purchase(sku, options = {}) {
      if (mode === 'decline') {
        return Object.freeze({
          ok: false,
          errorCode: 'PAYMENT_DECLINED',
          message: 'The transaction was declined by the simulated bank.'
        });
      }
      if (mode === 'error') {
        throw new Error('Simulated network error during payment processing.');
      }
      const record = Object.freeze({
        sku,
        transactionId: `mock_tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        purchasedAt: new Date().toISOString(),
        status: 'active',
        metadata: options.metadata || {}
      });
      transactions.set(sku, record);
      return Object.freeze({
        ok: true,
        status: 'success',
        transaction: record
      });
    },
    async refund(sku) {
      if (transactions.has(sku)) {
        transactions.delete(sku);
        return Object.freeze({ ok: true, status: 'refunded', sku });
      }
      return Object.freeze({ ok: false, errorCode: 'TRANSACTION_NOT_FOUND' });
    },
    async restorePurchases() {
      return Object.freeze(Array.from(transactions.values()));
    },
    hasEntitlement(sku) {
      return transactions.has(sku);
    }
  };
}

/**
 * Verifies Ed25519 public-key signature on an entitlement token with clock manipulation defense
 * and 30-calendar-day offline grace period (TASK-COMM-02 / ADR-08).
 *
 * @param {object} params
 */
export async function verifyEd25519EntitlementToken({
  token,
  publicKey,
  offlineGraceDays = 30,
  anchorTimestamp = null,
  currentTimestamp = Date.now()
}) {
  if (!token) {
    return Object.freeze({ valid: false, reason: 'TOKEN_MISSING' });
  }

  let payload = null;
  let signature = null;
  let signedBytes = null;

  // Case 1: Compact JWT format ("header.payload.signature")
  if (typeof token === 'string' && token.split('.').length === 3) {
    const parts = token.split('.');
    try {
      const payloadBytes = base64ToUint8Array(parts[1]);
      payload = JSON.parse(new TextDecoder().decode(payloadBytes));
      signature = base64ToUint8Array(parts[2]);
      signedBytes = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    } catch {
      return Object.freeze({ valid: false, reason: 'INVALID_TOKEN_FORMAT' });
    }
  } else {
    // Case 2: JSON string or object envelope { payload, signature }
    let parsedToken = token;
    if (typeof token === 'string') {
      try {
        parsedToken = JSON.parse(token);
      } catch {
        return Object.freeze({ valid: false, reason: 'INVALID_TOKEN_FORMAT' });
      }
    }

    if (!parsedToken || typeof parsedToken !== 'object') {
      return Object.freeze({ valid: false, reason: 'TOKEN_STRUCTURE_INVALID' });
    }

    payload = parsedToken.payload;
    signature = parsedToken.signature;

    if (!payload || !signature) {
      return Object.freeze({ valid: false, reason: 'TOKEN_STRUCTURE_INVALID' });
    }

    signedBytes = new TextEncoder().encode(typeof payload === 'string' ? payload : JSON.stringify(payload));
  }

  // Parse timestamps (supports lastValidatedAt, issuedAt, or iat)
  const lastValidatedMs = Date.parse(
    payload.lastValidatedAt ||
    payload.issuedAt ||
    (payload.iat ? (payload.iat > 1e11 ? new Date(payload.iat).toISOString() : new Date(payload.iat * 1000).toISOString()) : '')
  );
  if (Number.isNaN(lastValidatedMs)) {
    return Object.freeze({ valid: false, reason: 'INVALID_TOKEN_TIMESTAMP' });
  }

  // 1. Clock manipulation defense (ADR-08)
  if (currentTimestamp < lastValidatedMs - 60000) {
    return Object.freeze({
      valid: false,
      reason: 'CLOCK_ROLLBACK_DETECTED',
      details: { currentTimestamp, lastValidatedMs }
    });
  }

  if (anchorTimestamp && currentTimestamp < anchorTimestamp - 60000) {
    return Object.freeze({
      valid: false,
      reason: 'CLOCK_ROLLBACK_DETECTED',
      details: { currentTimestamp, anchorTimestamp }
    });
  }

  // 2. Token expiration check (exp)
  if (payload.exp !== undefined && payload.exp !== null) {
    const expMs = payload.exp > 1e11 ? payload.exp : payload.exp * 1000;
    if (currentTimestamp > expMs) {
      return Object.freeze({
        valid: false,
        reason: 'TOKEN_EXPIRED',
        details: { expMs, currentTimestamp }
      });
    }
  }

  // 3. Offline grace period check (30 calendar days)
  const gracePeriodMs = offlineGraceDays * 24 * 60 * 60 * 1000;
  const effectiveAnchor = Math.max(lastValidatedMs, anchorTimestamp || 0);
  if (currentTimestamp - effectiveAnchor > gracePeriodMs) {
    return Object.freeze({
      valid: false,
      reason: 'OFFLINE_GRACE_EXPIRED',
      details: { effectiveAnchor, currentTimestamp, gracePeriodMs }
    });
  }

  // 4. Cryptographic signature verification using Web Crypto API
  try {
    const cryptoObj = typeof crypto !== 'undefined' ? crypto : (typeof globalThis !== 'undefined' ? globalThis.crypto : null);
    if (!cryptoObj || !cryptoObj.subtle) {
      return Object.freeze({ valid: false, reason: 'CRYPTO_UNAVAILABLE' });
    }

    let key = publicKey;
    if (typeof publicKey === 'string' || publicKey instanceof Uint8Array || ArrayBuffer.isView(publicKey)) {
      const rawKey = typeof publicKey === 'string'
        ? (publicKey.startsWith('0x') ? hexToUint8Array(publicKey.slice(2)) : base64ToUint8Array(publicKey))
        : publicKey;
      key = await cryptoObj.subtle.importKey('raw', rawKey, { name: 'Ed25519' }, true, ['verify']);
    }

    const sigBytes = typeof signature === 'string'
      ? (signature.startsWith('0x') ? hexToUint8Array(signature.slice(2)) : base64ToUint8Array(signature))
      : signature;

    const isVerified = await cryptoObj.subtle.verify({ name: 'Ed25519' }, key, sigBytes, signedBytes);

    if (!isVerified) {
      return Object.freeze({ valid: false, reason: 'SIGNATURE_VERIFICATION_FAILED' });
    }
  } catch (err) {
    return Object.freeze({ valid: false, reason: 'CRYPTO_VERIFICATION_ERROR', error: err?.message });
  }

  return Object.freeze({
    valid: true,
    payload,
    sku: payload.sku || (Array.isArray(payload.entitlements) ? payload.entitlements[0] : null),
    tier: payload.tier || 'STANDARD',
    entitlements: payload.entitlements || (payload.sku ? [payload.sku] : [])
  });
}

/**
 * Mints an Ed25519 digitally signed entitlement token for testing and validation (TASK-COMM-02 / ADR-08).
 *
 * @param {object} params
 * @param {object} params.payload
 * @param {CryptoKey|Uint8Array|string} params.privateKey
 * @param {boolean} [params.compact=false]
 * @returns {Promise<string|object>}
 */
export async function mintEd25519EntitlementToken({
  payload,
  privateKey,
  compact = false
}) {
  const cryptoObj = typeof crypto !== 'undefined' ? crypto : (typeof globalThis !== 'undefined' ? globalThis.crypto : null);
  if (!cryptoObj || !cryptoObj.subtle) {
    throw new Error('WebCrypto subtle is unavailable');
  }

  let key = privateKey;
  if (typeof privateKey === 'string' || privateKey instanceof Uint8Array || ArrayBuffer.isView(privateKey)) {
    const rawKey = typeof privateKey === 'string'
      ? (privateKey.startsWith('0x') ? hexToUint8Array(privateKey.slice(2)) : base64ToUint8Array(privateKey))
      : privateKey;
    key = await cryptoObj.subtle.importKey('pkcs8', rawKey, { name: 'Ed25519' }, true, ['sign']);
  }

  if (compact) {
    const header = { alg: 'EdDSA', typ: 'JWT', crv: 'Ed25519' };
    const headerB64 = uint8ArrayToBase64Url(new TextEncoder().encode(JSON.stringify(header)));
    const payloadB64 = uint8ArrayToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
    const signingInput = `${headerB64}.${payloadB64}`;
    const sigBuffer = await cryptoObj.subtle.sign({ name: 'Ed25519' }, key, new TextEncoder().encode(signingInput));
    const sigB64 = uint8ArrayToBase64Url(new Uint8Array(sigBuffer));
    return `${signingInput}.${sigB64}`;
  }

  const payloadBytes = new TextEncoder().encode(typeof payload === 'string' ? payload : JSON.stringify(payload));
  const sigBuffer = await cryptoObj.subtle.sign({ name: 'Ed25519' }, key, payloadBytes);
  return {
    payload,
    signature: uint8ArrayToBase64(new Uint8Array(sigBuffer))
  };
}

function createNullProviders() {
  return {
    auth: Object.freeze({
      providerName: 'null-auth',
      isConfigured: () => false,
      getCurrentSession: async () => null,
      signIn: async () =>
        Object.freeze({
          ok: false,
          account: null,
          errorCode: 'NOT_CONFIGURED',
          message: 'Authentication provider is not configured.'
        }),
      signUp: async () =>
        Object.freeze({
          ok: false,
          errorCode: 'NOT_CONFIGURED',
          message: 'Authentication provider is not configured.'
        }),
      resetPassword: async () =>
        Object.freeze({
          ok: false,
          errorCode: 'NOT_CONFIGURED',
          message: 'Authentication provider is not configured.'
        }),
      signOut: async () => {},
      linkGuestIdentity: async () => Object.freeze({ linked: false }),
      onAuthStateChange: () => () => {},
      exportUserData: async () => null,
      deleteUserData: async () => false
    }),
    cloudSync: Object.freeze({
      providerName: 'null-cloud-sync',
      isConfigured: () => false,
      pullLatest: async () => null,
      pushWithOptimisticLock: async () => Object.freeze({ status: 'disabled' }),
      listSaves: async () => Object.freeze([])
    }),
    entitlements: Object.freeze({
      providerName: 'null-entitlements',
      isConfigured: () => false,
      fetchEntitlements: async () => Object.freeze([])
    }),
    purchaseProvider: Object.freeze({
      providerName: 'null-purchase',
      isConfigured: () => false,
      purchase: async () =>
        Object.freeze({
          ok: false,
          errorCode: 'NOT_CONFIGURED',
          message: 'Purchase provider is not configured.'
        }),
      restorePurchases: async () => Object.freeze([])
    }),
    analytics: Object.freeze({
      providerName: 'null-analytics',
      isConfigured: () => false,
      flush: async () => {}
    }),
    telemetryTransport: Object.freeze({
      providerName: 'null-telemetry-transport',
      isConfigured: () => false,
      sendEvents: async () => Object.freeze({ ok: false, sentCount: 0 })
    }),
    remoteConfig: Object.freeze({
      providerName: 'null-remote-config',
      isConfigured: () => false,
      fetchConfig: async () => Object.freeze({})
    }),
    accountProvider: Object.freeze({
      providerName: 'null-account',
      isConfigured: () => false,
      exportUserData: async () => null,
      deleteUserData: async () => false
    })
  };
}

/**
 * Wraps a promise with a bounded timeout so blocked IndexedDB operations never
 * hang game startup.
 */
function withTimeout(promise, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new AuroMindSDKError('STORAGE_TIMEOUT', `${label} timed out after ${timeoutMs}ms.`));
      }
    }, timeoutMs);

    Promise.resolve(promise).then(
      (value) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(value);
        }
      },
      (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      }
    );
  });
}

/**
 * Recursively freezes an object and all nested properties for runtime immutability.
 * @param {unknown} obj
 * @returns {unknown}
 */
export function deepFreeze(obj) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  Object.freeze(obj);
  for (const key of Object.getOwnPropertyNames(obj)) {
    const val = obj[key];
    if (val !== null && typeof val === 'object' && !Object.isFrozen(val)) {
      deepFreeze(val);
    }
  }
  return obj;
}

/**
 * Factory creating an isolated AuroMind Shared SDK instance.
 * Accepts optional `env` dependency overrides for deterministic unit testing.
 *
 * @param {object} [options]
 * @param {object} [options.env]
 */
export function createAuroMindSDK(options = {}) {
  const env =
    options && options.env
      ? options.env
      : options && (options.localStorage || options.indexedDB)
        ? options
        : {};

  function resolveEnvApi(name, fallback) {
    if (Object.prototype.hasOwnProperty.call(env, name)) {
      return env[name];
    }
    return fallback;
  }

  const getIndexedDB = () => resolveEnvApi('indexedDB', globalThis.indexedDB ?? null);
  const getLocalStorage = () => {
    if (Object.prototype.hasOwnProperty.call(env, 'localStorage')) {
      return env.localStorage;
    }
    try {
      return globalThis.localStorage ?? null;
    } catch {
      return null;
    }
  };
  const getLocks = () =>
    resolveEnvApi('locks', globalThis.navigator?.locks ?? null);
  const getBroadcastChannelCtor = () =>
    resolveEnvApi('BroadcastChannel', globalThis.BroadcastChannel ?? null);
  const getCrypto = () => resolveEnvApi('crypto', globalThis.crypto ?? null);
  const getWindow = () => resolveEnvApi('window', globalThis.window ?? null);
  const getNow = () => {
    const fn = resolveEnvApi('now', () => new Date());
    const val = typeof fn === 'function' ? fn() : new Date();
    return val instanceof Date ? val : new Date(val);
  };
  const getOrigin = () => {
    if (Object.prototype.hasOwnProperty.call(env, 'origin')) {
      return env.origin;
    }
    try {
      return globalThis.location?.origin ?? null;
    } catch {
      return null;
    }
  };
  const idbTimeoutMs =
    typeof env.idbTimeoutMs === 'number' && env.idbTimeoutMs > 0
      ? env.idbTimeoutMs
      : DEFAULT_IDB_TIMEOUT_MS;

  const instanceId = `tab_${generateUuidV4(getCrypto())}`;

  // Mutable internal state (strictly encapsulated)
  let initialized = false;
  let disposed = false;
  let initPromise = null;
  let ensureIdentityPromise = null;
  let ensurePublicPromise = null;
  let identityOpQueue = Promise.resolve();
  let pendingPeerRecord = null;
  let pendingPeerSource = null;
  let activeConfig = null;
  let capabilities = DEFAULT_CAPABILITIES;
  let providers = createNullProviders();
  let currentGuestRecord = null;
  let currentAccount = null;
  let storageSource = 'memory';
  let ephemeral = true;
  let broadcastChannel = null;
  let storageEventHandler = null;
  let onlineEventHandler = null;
  let offlineEventHandler = null;
  let observedOnline = null;
  let authUnsubscribe = null;
  let analyticsOptIn = false;
  let cachedRemoteConfig = Object.freeze({});
  let cachedEntitlements = Object.freeze([]);

  const currentSessionId = `sess_${generateUuidV4(getCrypto())}`;
  const memoryLogBuffer = [];
  const MAX_MEMORY_LOGS = 150;
  const MAX_LS_LOGS = 50;
  const LOG_LEVELS = Object.freeze({
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    FATAL: 4
  });
  let currentLogLevel = LOG_LEVELS.INFO;

  const memoryTelemetryQueue = [];
  const MAX_TELEMETRY_QUEUE = 200;
  let telemetryConsent = null;

  let localConfigOverrides = {};
  let localEntitlements = [];
  let cachedPlayerProfile = null;

  let syncConsent = false;
  let syncOutbox = new Set();
  let syncMetadata = {};

  function loadPersistedSyncState() {
    try {
      const cRes = lsGetRaw(LS_SYNC_CONSENT_KEY);
      if (cRes.ok && cRes.raw !== null) {
        syncConsent = cRes.raw === 'true';
      }
      const oRes = lsGetRaw(LS_OUTBOX_KEY);
      if (oRes.ok && oRes.raw) {
        const parsed = JSON.parse(oRes.raw);
        if (Array.isArray(parsed)) {
          syncOutbox = new Set(parsed);
        }
      }
      const mRes = lsGetRaw(LS_SYNC_META_KEY);
      if (mRes.ok && mRes.raw) {
        const parsed = JSON.parse(mRes.raw);
        if (parsed && typeof parsed === 'object') {
          syncMetadata = parsed;
        }
      }
    } catch {}
  }

  function persistSyncState() {
    try {
      lsSetRaw(LS_SYNC_CONSENT_KEY, String(syncConsent));
      lsSetRaw(LS_OUTBOX_KEY, JSON.stringify(Array.from(syncOutbox)));
      lsSetRaw(LS_SYNC_META_KEY, JSON.stringify(syncMetadata));
    } catch {}
  }
  const memoryPlatformMeta = new Map();
  const identityListeners = new Set();
  const offlineListeners = new Set();

  const storageHealth = {
    idbAvailable: false,
    lsAvailable: false,
    webLocksSupported: false,
    broadcastChannelSupported: false,
    lastRepairedFrom: null,
    lastReconciledFrom: null,
    corruptedStores: [],
    lastError: null,
    persisted: false,
    quota: null
  };

  // --- Low-level IndexedDB helpers (AuroMindPlatformDB v1 ONLY) ---

  function openPlatformDB() {
    const idb = getIndexedDB();
    if (!idb || typeof idb.open !== 'function') {
      return Promise.reject(new AuroMindSDKError('IDB_UNAVAILABLE', 'IndexedDB is unavailable.'));
    }

    return withTimeout(
      new Promise((resolve, reject) => {
        const rejectOpenError = (err) => {
          if (isIdbVersionError(err)) {
            reject(
              new AuroMindSDKError(
                'IDB_VERSION_ERROR',
                err?.message || `IndexedDB database "${IDB_DB_NAME}" has a higher version than supported v${IDB_DB_VERSION}.`,
                { dbName: IDB_DB_NAME, supportedDbVersion: IDB_DB_VERSION, causeName: err?.name || 'VersionError' }
              )
            );
            return;
          }
          reject(err || new AuroMindSDKError('IDB_OPEN_FAILED', 'Failed to open AuroMindPlatformDB.'));
        };

        let req;
        try {
          req = idb.open(IDB_DB_NAME, IDB_DB_VERSION);
        } catch (err) {
          rejectOpenError(err);
          return;
        }

        req.onupgradeneeded = (event) => {
          const db = event?.target?.result || req.result;
          if (db && !db.objectStoreNames.contains(IDB_STORE_NAME)) {
            db.createObjectStore(IDB_STORE_NAME);
          }
          if (db && !db.objectStoreNames.contains('platform_sync_outbox')) {
            db.createObjectStore('platform_sync_outbox', { keyPath: 'id' });
          }
          if (db && !db.objectStoreNames.contains('platform_telemetry')) {
            db.createObjectStore('platform_telemetry', { keyPath: 'eventId' });
          }
        };

        req.onblocked = () => {
          reject(new AuroMindSDKError('IDB_BLOCKED', 'AuroMindPlatformDB open request was blocked.'));
        };

        req.onerror = () => {
          rejectOpenError(req.error);
        };

        req.onsuccess = () => {
          resolve(req.result);
        };
      }),
      idbTimeoutMs,
      'IndexedDB.open(AuroMindPlatformDB)'
    );
  }

  async function idbGet(key) {
    let db = null;
    try {
      db = await openPlatformDB();
      const value = await withTimeout(
        new Promise((resolve, reject) => {
          try {
            const tx = db.transaction(IDB_STORE_NAME, 'readonly');
            const store = tx.objectStore(IDB_STORE_NAME);
            const req = store.get(key);
            req.onsuccess = () => resolve(req.result === undefined ? null : req.result);
            req.onerror = () => reject(req.error || new Error('IDB get failed'));
            tx.onabort = () => reject(tx.error || new Error('IDB get transaction aborted'));
          } catch (err) {
            reject(err);
          }
        }),
        idbTimeoutMs,
        `IndexedDB.get(${key})`
      );
      storageHealth.idbAvailable = true;
      return { ok: true, value, versionError: false };
    } catch (err) {
      const versionError = isIdbVersionError(err);
      storageHealth.idbAvailable = false;
      storageHealth.lastError = err?.message || String(err);
      return { ok: false, value: null, error: err, versionError };
    } finally {
      try {
        if (db && typeof db.close === 'function') db.close();
      } catch {}
    }
  }

  async function idbPut(key, value) {
    let db = null;
    try {
      db = await openPlatformDB();
      await withTimeout(
        new Promise((resolve, reject) => {
          try {
            const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
            const store = tx.objectStore(IDB_STORE_NAME);
            const req = store.put(value, key);
            let done = false;
            const finish = () => {
              if (!done) {
                done = true;
                resolve(true);
              }
            };
            const fail = (err) => {
              if (!done) {
                done = true;
                reject(err || new Error('IDB put failed'));
              }
            };
            tx.oncomplete = finish;
            req.onerror = () => fail(req.error);
            tx.onerror = () => fail(tx.error);
            tx.onabort = () => fail(tx.error || new Error('IDB put transaction aborted'));
          } catch (err) {
            reject(err);
          }
        }),
        idbTimeoutMs,
        `IndexedDB.put(${key})`
      );
      storageHealth.idbAvailable = true;
      return { ok: true, versionError: false };
    } catch (err) {
      const versionError = isIdbVersionError(err);
      storageHealth.idbAvailable = false;
      storageHealth.lastError = err?.message || String(err);
      return { ok: false, error: err, versionError };
    } finally {
      try {
        if (db && typeof db.close === 'function') db.close();
      } catch {}
    }
  }

  async function idbDelete(key) {
    let db = null;
    try {
      db = await openPlatformDB();
      await withTimeout(
        new Promise((resolve, reject) => {
          try {
            const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
            const store = tx.objectStore(IDB_STORE_NAME);
            const req = store.delete(key);
            tx.oncomplete = () => resolve(true);
            req.onerror = () => reject(req.error || new Error('IDB delete failed'));
            tx.onerror = () => reject(tx.error || new Error('IDB delete tx failed'));
            tx.onabort = () => reject(tx.error || new Error('IDB delete tx aborted'));
          } catch (err) {
            reject(err);
          }
        }),
        idbTimeoutMs,
        `IndexedDB.delete(${key})`
      );
      storageHealth.idbAvailable = true;
      return { ok: true, versionError: false };
    } catch (err) {
      const versionError = isIdbVersionError(err);
      storageHealth.idbAvailable = false;
      storageHealth.lastError = err?.message || String(err);
      return { ok: false, error: err, versionError };
    } finally {
      try {
        if (db && typeof db.close === 'function') db.close();
      } catch {}
    }
  }

  // --- IndexedDB durable sync outbox helpers (TASK-SYNC-02 / ADR-05) ---

  async function idbPutOutbox(record) {
    let db = null;
    try {
      db = await openPlatformDB();
      if (!db || !db.objectStoreNames || !db.objectStoreNames.contains('platform_sync_outbox')) return false;
      await new Promise((resolve, reject) => {
        try {
          const tx = db.transaction('platform_sync_outbox', 'readwrite');
          const store = tx.objectStore('platform_sync_outbox');
          store.put(record);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => reject(tx.error);
        } catch (e) {
          reject(e);
        }
      });
      return true;
    } catch {
      return false;
    } finally {
      if (db && typeof db.close === 'function') {
        try { db.close(); } catch {}
      }
    }
  }

  async function idbGetOutbox() {
    let db = null;
    try {
      db = await openPlatformDB();
      if (!db || !db.objectStoreNames || !db.objectStoreNames.contains('platform_sync_outbox')) return [];
      const records = await new Promise((resolve, reject) => {
        try {
          const tx = db.transaction('platform_sync_outbox', 'readonly');
          const store = tx.objectStore('platform_sync_outbox');
          const req = store.getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error);
        } catch (e) {
          reject(e);
        }
      });
      return records;
    } catch {
      return [];
    } finally {
      if (db && typeof db.close === 'function') {
        try { db.close(); } catch {}
      }
    }
  }

  async function idbDeleteOutbox(id) {
    let db = null;
    try {
      db = await openPlatformDB();
      if (!db || !db.objectStoreNames || !db.objectStoreNames.contains('platform_sync_outbox')) return false;
      await new Promise((resolve, reject) => {
        try {
          const tx = db.transaction('platform_sync_outbox', 'readwrite');
          const store = tx.objectStore('platform_sync_outbox');
          store.delete(id);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => reject(tx.error);
        } catch (e) {
          reject(e);
        }
      });
      return true;
    } catch {
      return false;
    } finally {
      if (db && typeof db.close === 'function') {
        try { db.close(); } catch {}
      }
    }
  }

  // --- Low-level localStorage helpers (auromind.platform.* ONLY) ---

  function lsGetRaw(key) {
    const ls = getLocalStorage();
    if (!ls || typeof ls.getItem !== 'function') {
      storageHealth.lsAvailable = false;
      return { ok: false, raw: null };
    }
    try {
      const raw = ls.getItem(key);
      storageHealth.lsAvailable = true;
      return { ok: true, raw };
    } catch (err) {
      storageHealth.lsAvailable = false;
      storageHealth.lastError = err?.message || String(err);
      return { ok: false, raw: null, error: err };
    }
  }

  function lsSetRaw(key, value) {
    const ls = getLocalStorage();
    if (!ls || typeof ls.setItem !== 'function') {
      storageHealth.lsAvailable = false;
      return { ok: false };
    }
    try {
      ls.setItem(key, value);
      storageHealth.lsAvailable = true;
      return { ok: true };
    } catch (err) {
      storageHealth.lsAvailable = false;
      storageHealth.lastError = err?.message || String(err);
      return { ok: false, error: err };
    }
  }

  function lsRemoveRaw(key) {
    const ls = getLocalStorage();
    if (!ls || typeof ls.removeItem !== 'function') {
      storageHealth.lsAvailable = false;
      return { ok: false };
    }
    try {
      ls.removeItem(key);
      storageHealth.lsAvailable = true;
      return { ok: true };
    } catch (err) {
      storageHealth.lsAvailable = false;
      storageHealth.lastError = err?.message || String(err);
      return { ok: false, error: err };
    }
  }

  function parseLsGuestRecord(raw) {
    if (raw === null || raw === undefined) {
      return { present: false, parsed: null, validation: { valid: false, reason: 'ABSENT' } };
    }
    try {
      const parsed = JSON.parse(raw);
      return { present: true, parsed, validation: validateGuestRecord(parsed) };
    } catch {
      return { present: true, parsed: null, validation: { valid: false, reason: 'CORRUPTED_JSON' } };
    }
  }

  // --- Snapshot construction & listener notifications ---

  function buildGuestView() {
    if (!currentGuestRecord) return null;
    return Object.freeze({
      schemaVersion: currentGuestRecord.schemaVersion,
      guestId: currentGuestRecord.guestId,
      createdAt: currentGuestRecord.createdAt,
      lastSeenAt: currentGuestRecord.lastSeenAt,
      origin: currentGuestRecord.origin,
      storageSource,
      ephemeral
    });
  }

  function buildPlayerIdentity() {
    const guest = buildGuestView();
    if (!guest) return null;
    const verifiedAccount =
      capabilities.authEnabled && currentAccount ? Object.freeze({ ...currentAccount }) : null;
    return Object.freeze({
      mode: verifiedAccount ? 'authenticated' : 'guest',
      guestId: guest.guestId,
      guest,
      account: verifiedAccount
    });
  }

  function emitIdentityChange() {
    if (!initialized || disposed) return;
    const snapshot = buildPlayerIdentity();
    if (!snapshot) return;
    for (const listener of identityListeners) {
      try {
        listener(snapshot);
      } catch {
        // Isolate listener failures from platform runtime
      }
    }
  }

  function emitOfflineStateChange(onlineOverride) {
    if (disposed) return;
    const snapshot = getOfflineStateSnapshot(onlineOverride);
    for (const listener of offlineListeners) {
      try {
        listener(snapshot);
      } catch {
        // Isolate listener failures from platform runtime
      }
    }
  }

  function updateStorageSource(idbWritten, lsWritten) {
    if (idbWritten && lsWritten) {
      storageSource = 'idb+ls';
      ephemeral = false;
    } else if (idbWritten) {
      storageSource = 'idb';
      ephemeral = false;
    } else if (lsWritten) {
      storageSource = 'ls';
      ephemeral = false;
    } else {
      storageSource = 'memory';
      ephemeral = true;
    }
  }

  // --- Cross-tab coordination (Web Locks + BroadcastChannel + storage event) ---

  function enqueueIdentityOp(fn) {
    const run = identityOpQueue.then(
      () => fn(),
      () => fn()
    );
    identityOpQueue = run.catch(() => {});
    return run;
  }

  function createIdbVersionMismatchError(stores = ['indexedDB']) {
    return new AuroMindSDKError(
      'UNSUPPORTED_IDENTITY_VERSION',
      `IndexedDB database "${IDB_DB_NAME}" requires a newer database version than SDK v${SDK_VERSION} (supported IDB version ${IDB_DB_VERSION}). Refusing to fall back or overwrite.`,
      {
        reason: 'IDB_DATABASE_VERSION_TOO_HIGH',
        dbName: IDB_DB_NAME,
        supportedDbVersion: IDB_DB_VERSION,
        supportedVersion: IDENTITY_SCHEMA_VERSION,
        stores
      }
    );
  }

  async function withGuestInitLock(fn) {
    const locks = getLocks();
    if (locks && typeof locks.request === 'function') {
      storageHealth.webLocksSupported = true;
      const AbortCtrl = resolveEnvApi('AbortController', globalThis.AbortController ?? null);
      if (AbortCtrl) {
        const controller = new AbortCtrl();
        let acquired = false;
        const timer = setTimeout(() => {
          if (!acquired) {
            try {
              controller.abort();
            } catch {}
          }
        }, 3000);
        try {
          return await locks.request(
            WEB_LOCK_NAME,
            { mode: 'exclusive', signal: controller.signal },
            async () => {
              acquired = true;
              clearTimeout(timer);
              return await fn();
            }
          );
        } catch (err) {
          clearTimeout(timer);
          if (acquired) {
            throw err;
          }
          // Fallback after 3000ms lock timeout so background tabs never hang
          return await fn();
        }
      }
      return locks.request(WEB_LOCK_NAME, { mode: 'exclusive' }, () => fn());
    }
    storageHealth.webLocksSupported = false;
    return fn();
  }

  function broadcastIdentity(record, type = 'GUEST_IDENTITY_READY') {
    if (disposed || !broadcastChannel || typeof broadcastChannel.postMessage !== 'function') return;
    try {
      broadcastChannel.postMessage({
        type,
        senderId: instanceId,
        record
      });
    } catch {
      // Ignore closed channel or serialization errors
    }
  }

  function bufferPendingPeerRecord(validRecord, sourceLabel) {
    if (!pendingPeerRecord) {
      pendingPeerRecord = validRecord;
      pendingPeerSource = sourceLabel;
      return;
    }
    const merged = reconcileGuestRecords(pendingPeerRecord, validRecord);
    if (merged.winner) {
      pendingPeerRecord = merged.winner;
      if (merged.changedFromFirst) {
        pendingPeerSource = sourceLabel;
      }
    }
  }

  function handleIncomingPeerRecord(incomingRecord, sourceLabel) {
    if (disposed) return;
    const validation = validateGuestRecord(incomingRecord);
    if (!validation.valid) return;

    // Never mutate identity, write storage, or emit notifications before init() completes
    if (!initialized) {
      bufferPendingPeerRecord(validation.record, sourceLabel);
      return;
    }

    void enqueueIdentityOp(() => applyIncomingPeerRecord(validation.record, sourceLabel));
  }

  async function applyIncomingPeerRecord(validRecord, sourceLabel) {
    if (disposed || !initialized) return;

    try {
      await withGuestInitLock(async () => {
        if (disposed || !initialized) return;

        const prevGuestId = currentGuestRecord ? currentGuestRecord.guestId : null;
        const result = reconcileGuestRecords(currentGuestRecord, validRecord);
        if (!result.winner) return;

        if (result.changedFromFirst) {
          currentGuestRecord = result.winner;
          storageHealth.lastReconciledFrom = sourceLabel;
          const persisted = await persistWinnerSafely(currentGuestRecord, {
            preserveUnsupportedIdb: true,
            preserveUnsupportedLs: true
          });
          if (!disposed && initialized) {
            emitIdentityChange();
            broadcastIdentity(persisted.record, 'GUEST_IDENTITY_RECONCILED');
          }
        } else if (result.changedFromSecond) {
          // Local record won over the peer's newer record — ensure both stores stay converged
          // on our canonical winner and announce back to the peer.
          const persisted = await persistWinnerSafely(currentGuestRecord, {
            preserveUnsupportedIdb: true,
            preserveUnsupportedLs: true
          });
          if (!disposed && initialized) {
            if (persisted.record.guestId !== prevGuestId) {
              storageHealth.lastReconciledFrom = sourceLabel;
              emitIdentityChange();
            }
            broadcastIdentity(persisted.record, 'GUEST_IDENTITY_RECONCILED');
          }
        }
      });
    } catch {
      // Peer reconciliation errors (e.g., VersionError) must not trigger unhandled rejections
    }
  }

  function setupOfflineListeners() {
    if (disposed) return;
    const win = getWindow();
    if (!win || typeof win.addEventListener !== 'function') return;

    if (!onlineEventHandler) {
      onlineEventHandler = () => {
        observedOnline = true;
        emitOfflineStateChange(true);
        if (syncConsent && currentAccount && capabilities.cloudSyncEnabled) {
          syncService.syncNow().catch(() => {});
        }
      };
      try {
        win.addEventListener('online', onlineEventHandler);
      } catch {
        onlineEventHandler = null;
      }
    }

    if (!offlineEventHandler) {
      offlineEventHandler = () => {
        observedOnline = false;
        emitOfflineStateChange(false);
      };
      try {
        win.addEventListener('offline', offlineEventHandler);
      } catch {
        offlineEventHandler = null;
      }
    }
  }

  function setupCrossTabListeners() {
    if (disposed) return;
    const BC = getBroadcastChannelCtor();
    if (!broadcastChannel && typeof BC === 'function') {
      try {
        broadcastChannel = new BC(BROADCAST_CHANNEL_NAME);
        storageHealth.broadcastChannelSupported = true;
        broadcastChannel.onmessage = (event) => {
          const data = event?.data;
          if (!data || data.senderId === instanceId) return;
          if (
            (data.type === 'GUEST_IDENTITY_READY' || data.type === 'GUEST_IDENTITY_RECONCILED') &&
            data.record
          ) {
            handleIncomingPeerRecord(data.record, 'broadcastChannel');
          }
        };
      } catch {
        storageHealth.broadcastChannelSupported = false;
        broadcastChannel = null;
      }
    } else if (!broadcastChannel) {
      storageHealth.broadcastChannelSupported = false;
    }

    const win = getWindow();
    if (!storageEventHandler && win && typeof win.addEventListener === 'function') {
      storageEventHandler = (event) => {
        if (!event || event.key !== LS_GUEST_KEY || !event.newValue) return;
        const parsed = parseLsGuestRecord(event.newValue);
        if (parsed.validation.valid) {
          handleIncomingPeerRecord(parsed.validation.record, 'storageEvent');
        }
      };
      try {
        win.addEventListener('storage', storageEventHandler);
      } catch {
        storageEventHandler = null;
      }
    }

    setupOfflineListeners();
  }

  /**
   * Persists the winning guest identity record to available stores without
   * ever overwriting a strictly earlier valid record or an unsupported future
   * schema version record. Re-verifies post-write convergence so out-of-order
   * concurrent writes cannot leave IndexedDB and localStorage diverged.
   */
  async function persistWinnerSafely(
    record,
    { preserveUnsupportedIdb = false, preserveUnsupportedLs = false } = {}
  ) {
    let finalRecord = record;
    let idbWritten = false;
    let lsWritten = false;
    const MAX_CONVERGENCE_PASSES = 3;

    for (let pass = 0; pass < MAX_CONVERGENCE_PASSES; pass++) {
      // Pre-commit re-check against both stores and any buffered peer record
      const [latestIdb, latestLs] = await Promise.all([
        idbGet(IDB_GUEST_KEY),
        Promise.resolve(lsGetRaw(LS_GUEST_KEY))
      ]);

      if (latestIdb.versionError) {
        throw createIdbVersionMismatchError(['indexedDB']);
      }

      const idbVal =
        latestIdb.ok && latestIdb.value !== null
          ? validateGuestRecord(latestIdb.value)
          : { valid: false, reason: 'ABSENT' };
      const lsParsed = latestLs.ok
        ? parseLsGuestRecord(latestLs.raw)
        : { present: false, validation: { valid: false, reason: 'ABSENT' } };

      if (currentGuestRecord && validateGuestRecord(currentGuestRecord).valid) {
        const rec = reconcileGuestRecords(finalRecord, currentGuestRecord);
        if (rec.winner) finalRecord = rec.winner;
      }
      if (pendingPeerRecord && validateGuestRecord(pendingPeerRecord).valid) {
        const rec = reconcileGuestRecords(finalRecord, pendingPeerRecord);
        if (rec.winner) finalRecord = rec.winner;
      }
      if (idbVal.valid) {
        const rec = reconcileGuestRecords(finalRecord, idbVal.record);
        if (rec.winner) finalRecord = rec.winner;
      }
      if (lsParsed.validation.valid) {
        const rec = reconcileGuestRecords(finalRecord, lsParsed.validation.record);
        if (rec.winner) finalRecord = rec.winner;
      }

      const skipIdbWrite = preserveUnsupportedIdb && idbVal.reason === 'UNSUPPORTED_VERSION';
      const skipLsWrite =
        preserveUnsupportedLs && lsParsed.validation.reason === 'UNSUPPORTED_VERSION';

      const idbWriteRes = skipIdbWrite
        ? { ok: false, versionError: false }
        : await idbPut(IDB_GUEST_KEY, finalRecord);
      if (idbWriteRes.versionError) {
        throw createIdbVersionMismatchError(['indexedDB']);
      }

      // Synchronous pre-LS re-check: protect against mid-flight localStorage writes
      // or peer broadcasts that arrived while `await idbPut(...)` was suspended.
      const freshLs = lsGetRaw(LS_GUEST_KEY);
      const freshLsParsed = freshLs.ok
        ? parseLsGuestRecord(freshLs.raw)
        : { present: false, validation: { valid: false, reason: 'ABSENT' } };
      if (freshLsParsed.validation.valid) {
        const rec = reconcileGuestRecords(finalRecord, freshLsParsed.validation.record);
        if (rec.winner) finalRecord = rec.winner;
      }
      if (pendingPeerRecord && validateGuestRecord(pendingPeerRecord).valid) {
        const rec = reconcileGuestRecords(finalRecord, pendingPeerRecord);
        if (rec.winner) finalRecord = rec.winner;
      }

      const skipLsWriteNow =
        skipLsWrite ||
        (preserveUnsupportedLs && freshLsParsed.validation.reason === 'UNSUPPORTED_VERSION');

      const lsWriteRes = skipLsWriteNow
        ? { ok: false }
        : lsSetRaw(LS_GUEST_KEY, JSON.stringify(finalRecord));

      idbWritten = idbWriteRes.ok;
      lsWritten = lsWriteRes.ok;

      // Post-write convergence verification: detect mid-flight or out-of-order concurrent writes
      if (idbWritten || lsWritten) {
        const [postIdb, postLs] = await Promise.all([
          idbWritten ? idbGet(IDB_GUEST_KEY) : Promise.resolve({ ok: false, value: null, versionError: false }),
          lsWritten ? Promise.resolve(lsGetRaw(LS_GUEST_KEY)) : Promise.resolve({ ok: false, raw: null })
        ]);

        if (postIdb.versionError) {
          throw createIdbVersionMismatchError(['indexedDB']);
        }

        const postIdbVal =
          postIdb.ok && postIdb.value !== null
            ? validateGuestRecord(postIdb.value)
            : { valid: false, reason: 'ABSENT' };
        const postLsParsed = postLs.ok
          ? parseLsGuestRecord(postLs.raw)
          : { present: false, validation: { valid: false, reason: 'ABSENT' } };

        let candidate = finalRecord;
        if (postIdbVal.valid) {
          const rec = reconcileGuestRecords(candidate, postIdbVal.record);
          if (rec.winner) candidate = rec.winner;
        }
        if (postLsParsed.validation.valid) {
          const rec = reconcileGuestRecords(candidate, postLsParsed.validation.record);
          if (rec.winner) candidate = rec.winner;
        }

        const idbDiverged =
          idbWritten &&
          (!postIdbVal.valid ||
            postIdbVal.record.guestId !== candidate.guestId ||
            postIdbVal.record.createdAt !== candidate.createdAt);
        const lsDiverged =
          lsWritten &&
          (!postLsParsed.validation.valid ||
            postLsParsed.validation.record.guestId !== candidate.guestId ||
            postLsParsed.validation.record.createdAt !== candidate.createdAt);

        finalRecord = candidate;
        if (!idbDiverged && !lsDiverged) {
          break;
        }
      } else {
        break;
      }
    }

    currentGuestRecord = finalRecord;
    updateStorageSource(idbWritten, lsWritten);

    return {
      record: finalRecord,
      idbWritten,
      lsWritten
    };
  }

  /**
   * Core guest identity bootstrap & recovery sequence.
   * Executes inside both the per-tab serialization queue and Web Lock when available.
   */
  async function runEnsureGuestIdentityCore() {
    setupCrossTabListeners();

    return withGuestInitLock(async () => {
      // Allow tests/diagnostics to observe interrupted init cleanly via optional hook
      if (typeof env.beforeIdentityCommit === 'function') {
        await env.beforeIdentityCommit();
      }

      const corruptedStores = [];

      // 1. Read both stores
      const idbRead = await idbGet(IDB_GUEST_KEY);
      const lsRead = lsGetRaw(LS_GUEST_KEY);

      // Protect against IndexedDB database-level VersionError (never classify as ordinary unavailability!)
      if (idbRead.versionError) {
        throw createIdbVersionMismatchError(['indexedDB']);
      }

      const idbPresent = idbRead.ok && idbRead.value !== null && idbRead.value !== undefined;
      const idbValidation = idbPresent
        ? validateGuestRecord(idbRead.value)
        : { valid: false, reason: 'ABSENT' };

      const lsParsed = lsRead.ok
        ? parseLsGuestRecord(lsRead.raw)
        : { present: false, validation: { valid: false, reason: 'ABSENT' } };

      const lsPresent = lsParsed.present;
      const lsValidation = lsParsed.validation;

      if (idbPresent && !idbValidation.valid && idbValidation.reason !== 'UNSUPPORTED_VERSION') {
        corruptedStores.push('indexedDB');
      }
      if (lsPresent && !lsValidation.valid && lsValidation.reason !== 'UNSUPPORTED_VERSION') {
        corruptedStores.push('localStorage');
      }
      storageHealth.corruptedStores = corruptedStores;

      // 2. Protect strictly unsupported future schema versions (never overwrite silently!)
      const idbUnsupported = idbValidation.reason === 'UNSUPPORTED_VERSION';
      const lsUnsupported = lsValidation.reason === 'UNSUPPORTED_VERSION';

      if ((idbUnsupported || lsUnsupported) && !idbValidation.valid && !lsValidation.valid) {
        const detectedVersion = idbUnsupported
          ? idbValidation.detectedVersion
          : lsValidation.detectedVersion;
        throw new AuroMindSDKError(
          'UNSUPPORTED_IDENTITY_VERSION',
          `Found unsupported guest identity schemaVersion ${String(detectedVersion)} (SDK supports schemaVersion ${IDENTITY_SCHEMA_VERSION}). Refusing to overwrite.`,
          {
            detectedVersion,
            supportedVersion: IDENTITY_SCHEMA_VERSION,
            stores: [
              ...(idbUnsupported ? ['indexedDB'] : []),
              ...(lsUnsupported ? ['localStorage'] : [])
            ]
          }
        );
      }

      const nowIso = getNow().toISOString();
      let winner = null;
      let repairCandidate = null;
      let reconciledFrom = null;

      // 3. Reconcile / recover / mint
      if (idbValidation.valid && lsValidation.valid) {
        const reconciled = reconcileGuestRecords(idbValidation.record, lsValidation.record);
        winner = {
          ...reconciled.winner,
          lastSeenAt:
            Date.parse(nowIso) >= Date.parse(reconciled.winner.lastSeenAt)
              ? nowIso
              : reconciled.winner.lastSeenAt
        };
        if (reconciled.conflictResolved) {
          reconciledFrom =
            winner.guestId === idbValidation.record.guestId ? 'idb' : 'localStorage';
        }
      } else if (idbValidation.valid) {
        winner = {
          ...idbValidation.record,
          lastSeenAt:
            Date.parse(nowIso) >= Date.parse(idbValidation.record.lastSeenAt)
              ? nowIso
              : idbValidation.record.lastSeenAt
        };
        if (lsRead.ok && !lsUnsupported) {
          repairCandidate = 'idb';
        }
      } else if (lsValidation.valid) {
        winner = {
          ...lsValidation.record,
          lastSeenAt:
            Date.parse(nowIso) >= Date.parse(lsValidation.record.lastSeenAt)
              ? nowIso
              : lsValidation.record.lastSeenAt
        };
        if (idbRead.ok && !idbUnsupported) {
          repairCandidate = 'localStorage';
        }
      } else if (currentGuestRecord && validateGuestRecord(currentGuestRecord).valid) {
        // Recover from in-memory record if already resolved earlier in this tab
        winner = {
          ...currentGuestRecord,
          lastSeenAt: nowIso
        };
      } else {
        // First-time creation (or both stores empty/corrupted)
        winner = {
          schemaVersion: IDENTITY_SCHEMA_VERSION,
          guestId: `guest_${generateUuidV4(getCrypto())}`,
          createdAt: nowIso,
          lastSeenAt: nowIso,
          origin: getOrigin()
        };
      }

      // Consume any peer identity message buffered before initialization completed
      if (pendingPeerRecord) {
        const bufferedPeer = pendingPeerRecord;
        const bufferedSource = pendingPeerSource;
        pendingPeerRecord = null;
        pendingPeerSource = null;
        const peerReconciled = reconcileGuestRecords(winner, bufferedPeer);
        if (peerReconciled.winner) {
          if (peerReconciled.changedFromFirst) {
            reconciledFrom = bufferedSource;
          }
          winner = {
            ...peerReconciled.winner,
            lastSeenAt:
              Date.parse(nowIso) >= Date.parse(peerReconciled.winner.lastSeenAt)
                ? nowIso
                : peerReconciled.winner.lastSeenAt
          };
        }
      }

      // 4. Persist winner safely to available stores (auto-healing partial deletion or corruption)
      const persisted = await persistWinnerSafely(winner, {
        preserveUnsupportedIdb: idbUnsupported,
        preserveUnsupportedLs: lsUnsupported
      });

      // Record lastRepairedFrom ONLY after the corresponding repair write is confirmed successful
      if (repairCandidate === 'idb' && persisted.lsWritten) {
        storageHealth.lastRepairedFrom = 'idb';
      } else if (repairCandidate === 'localStorage' && persisted.idbWritten) {
        storageHealth.lastRepairedFrom = 'localStorage';
      } else {
        storageHealth.lastRepairedFrom = null;
      }

      storageHealth.lastReconciledFrom = reconciledFrom;

      // 5. Announce identity to peer tabs
      broadcastIdentity(persisted.record, 'GUEST_IDENTITY_READY');

      return buildGuestView();
    });
  }

  function ensureGuestIdentityInternal() {
    if (ensureIdentityPromise) {
      return ensureIdentityPromise;
    }
    ensureIdentityPromise = enqueueIdentityOp(() => runEnsureGuestIdentityCore()).finally(() => {
      ensureIdentityPromise = null;
    });
    return ensureIdentityPromise;
  }

  // --- Public Services ---

  const identityService = Object.freeze({
    ensureGuestIdentity() {
      if (ensurePublicPromise) {
        return ensurePublicPromise;
      }
      ensurePublicPromise = (async () => {
        try {
          const guest = await ensureGuestIdentityInternal();
          emitIdentityChange();
          return guest;
        } finally {
          ensurePublicPromise = null;
        }
      })();
      return ensurePublicPromise;
    },
    get() {
      return buildPlayerIdentity();
    },
    getSnapshot() {
      return buildPlayerIdentity();
    },
    getGuestId() {
      return currentGuestRecord ? currentGuestRecord.guestId : null;
    },
    subscribe(listener) {
      if (typeof listener !== 'function') {
        throw new AuroMindSDKError('INVALID_LISTENER', 'identity.subscribe requires a function.');
      }
      identityListeners.add(listener);
      return () => {
        identityListeners.delete(listener);
      };
    },
    getStorageHealth() {
      return Object.freeze({
        idbAvailable: storageHealth.idbAvailable,
        lsAvailable: storageHealth.lsAvailable,
        webLocksSupported: storageHealth.webLocksSupported,
        broadcastChannelSupported: storageHealth.broadcastChannelSupported,
        lastRepairedFrom: storageHealth.lastRepairedFrom,
        lastReconciledFrom: storageHealth.lastReconciledFrom,
        corruptedStores: Object.freeze([...storageHealth.corruptedStores]),
        lastError: storageHealth.lastError
      });
    }
  });

  const accessService = Object.freeze({
    canPlayGame(gameId) {
      if (typeof gameId !== 'string' || gameId.trim().length === 0) {
        throw new AuroMindSDKError('INVALID_GAME_ID', 'canPlayGame requires a non-empty gameId.');
      }
      const mode = capabilities.authEnabled && currentAccount ? 'authenticated' : 'guest';
      return Object.freeze({
        allowed: true,
        mode,
        reason: 'guest-default',
        offlinePermitted: true
      });
    },
    isGuestMode() {
      return !(capabilities.authEnabled && currentAccount);
    },
    requiresNetwork() {
      // Core gameplay is ALWAYS offline-capable
      return false;
    }
  });

  const authService = Object.freeze({
    isAvailable() {
      return Boolean(capabilities.authEnabled && providers.auth.isConfigured());
    },
    getAccount() {
      if (!capabilities.authEnabled || !currentAccount) return null;
      return Object.freeze({ ...currentAccount });
    },
    async signIn(method, params) {
      if (!capabilities.authEnabled || !providers.auth.isConfigured()) {
        return Object.freeze({
          ok: false,
          account: null,
          errorCode: 'NOT_CONFIGURED',
          message: 'Authentication is disabled or no AuthProvider is configured.'
        });
      }
      const res = await providers.auth.signIn(method, params);
      if (res && res.ok && res.account) {
        currentAccount = res.account;
        emitIdentityChange();
      }
      return res;
    },
    async signUp(params) {
      if (!capabilities.authEnabled || !providers.auth.isConfigured()) {
        return Object.freeze({
          ok: false,
          account: null,
          errorCode: 'NOT_CONFIGURED',
          message: 'Authentication is disabled or no AuthProvider is configured.'
        });
      }
      const res = await providers.auth.signUp(params);
      if (res && res.ok && res.account) {
        currentAccount = res.account;
        emitIdentityChange();
      }
      return res;
    },
    async signInWithEmail(email, password) {
      return this.signIn('email_password', { email, password });
    },
    async signInWithOtp(email, options = {}) {
      return this.signIn('otp', { email, options });
    },
    async resetPasswordForEmail(email, options = {}) {
      if (!capabilities.authEnabled || !providers.auth.isConfigured()) {
        return Object.freeze({ ok: false, errorCode: 'NOT_CONFIGURED' });
      }
      if (typeof providers.auth.resetPassword === 'function') {
        return providers.auth.resetPassword(email, options);
      }
      return Object.freeze({ ok: false, errorCode: 'METHOD_NOT_SUPPORTED' });
    },
    async linkGuestIdentity(guestId = null) {
      if (!currentAccount) {
        return Object.freeze({ linked: false, error: 'NO_ACTIVE_ACCOUNT' });
      }
      const targetGuestId = guestId || (currentGuestRecord ? currentGuestRecord.guestId : null);
      if (!targetGuestId) {
        return Object.freeze({ linked: false, error: 'NO_GUEST_ID' });
      }
      if (typeof providers.auth.linkGuestIdentity === 'function') {
        return providers.auth.linkGuestIdentity(targetGuestId, currentAccount);
      }
      return Object.freeze({ linked: false, error: 'NOT_SUPPORTED' });
    },
    async upgradeGuestToAccount(credentials, options = {}) {
      const activeGuestId = currentGuestRecord ? currentGuestRecord.guestId : null;
      if (!activeGuestId) {
        throw new AuroMindSDKError('NO_GUEST_IDENTITY', 'Cannot upgrade: no platform guest identity exists.');
      }

      let authRes;
      if (options.mode === 'signUp') {
        authRes = await this.signUp(credentials);
      } else {
        authRes = await this.signIn(options.method || 'email_password', credentials);
      }

      if (!authRes || !authRes.ok || !authRes.account) {
        return Object.freeze({
          ok: false,
          migrated: false,
          error: authRes?.message || authRes?.error || 'AUTHENTICATION_FAILED'
        });
      }

      const linkRes = await this.linkGuestIdentity(activeGuestId);

      let syncResult = null;
      if (options.enableCloudSync === true) {
        syncService.setConsent(true);
        syncResult = await syncService.syncNow();
      }

      loggingService.info('auth', 'Guest identity successfully upgraded to authenticated account', {
        guestId: activeGuestId,
        userId: authRes.account.userId,
        cloudSyncEnabled: options.enableCloudSync === true
      });

      return Object.freeze({
        ok: true,
        migrated: true,
        account: authRes.account,
        guestId: activeGuestId,
        linked: Boolean(linkRes?.linked),
        syncResult
      });
    },
    async deleteAccount() {
      if (!currentAccount) return false;
      let remoteDeleted = false;
      if (providers.accountProvider && providers.accountProvider.isConfigured()) {
        try {
          remoteDeleted = await providers.accountProvider.deleteUserData();
        } catch {}
      }
      await this.signOut();
      return remoteDeleted;
    },
    onAuthStateChange(listener) {
      if (typeof listener !== 'function') return () => {};
      identityListeners.add(listener);
      return () => identityListeners.delete(listener);
    },
    async signOut() {
      // Strictly clears provider session ONLY — NEVER deletes guestId or game saves
      if (providers.auth && typeof providers.auth.signOut === 'function') {
        await providers.auth.signOut();
      }
      currentAccount = null;
      emitIdentityChange();
    }
  });

  function getOfflineStateSnapshot(onlineOverride) {
    const nav = resolveEnvApi('navigator', globalThis.navigator ?? null);
    const online =
      typeof onlineOverride === 'boolean'
        ? onlineOverride
        : nav && typeof nav.onLine === 'boolean'
          ? nav.onLine
          : typeof observedOnline === 'boolean'
            ? observedOnline
            : true;
    return Object.freeze({
      online,
      serviceWorkerControlled: Boolean(nav?.serviceWorker?.controller),
      idbAvailable: storageHealth.idbAvailable,
      lsAvailable: storageHealth.lsAvailable,
      updatedAt: getNow().toISOString()
    });
  }

  async function requestStoragePersistence() {
    const nav = resolveEnvApi('navigator', globalThis.navigator ?? null);
    if (!nav || !nav.storage) return false;
    try {
      if (typeof nav.storage.persisted === 'function' && typeof nav.storage.persist === 'function') {
        let isPersisted = await nav.storage.persisted();
        if (!isPersisted) {
          isPersisted = await nav.storage.persist();
        }
        storageHealth.persisted = Boolean(isPersisted);
        return Boolean(isPersisted);
      }
    } catch (err) {
      loggingService.debug('storage', 'Storage persistence request non-fatal error', { error: err?.message });
    }
    return false;
  }

  async function checkStorageQuota() {
    const nav = resolveEnvApi('navigator', globalThis.navigator ?? null);
    if (!nav || !nav.storage || typeof nav.storage.estimate !== 'function') {
      return null;
    }
    try {
      const estimate = await nav.storage.estimate();
      const usage = estimate.usage || 0;
      const quota = estimate.quota || 1;
      const ratio = quota > 0 ? usage / quota : 0;
      const percentage = Math.round(ratio * 100);
      const isCritical = ratio >= 0.8;

      storageHealth.quota = Object.freeze({
        usage,
        quota,
        percentage,
        ratio,
        isCritical
      });

      if (isCritical) {
        loggingService.warn('storage', `Storage quota usage critical: ${percentage}% (${usage} / ${quota} bytes)`, {
          usage,
          quota,
          percentage
        });
        if (typeof globalThis.dispatchEvent === 'function' && typeof globalThis.CustomEvent === 'function') {
          try {
            globalThis.dispatchEvent(
              new CustomEvent('auromind:storage_quota_warning', {
                detail: { usage, quota, percentage }
              })
            );
          } catch {}
        }
      }
      return storageHealth.quota;
    } catch (err) {
      loggingService.debug('storage', 'Storage quota estimate non-fatal error', { error: err?.message });
      return null;
    }
  }

  const storageService = Object.freeze({
    isProtectedKey(localStorageKey) {
      return isProtectedPlatformKey(localStorageKey);
    },
    async getPlatformMeta(key) {
      if (typeof key !== 'string' || key.trim().length === 0 || key === IDB_GUEST_KEY) {
        throw new AuroMindSDKError(
          'INVALID_META_KEY',
          'getPlatformMeta requires a non-empty non-reserved metadata key.'
        );
      }
      const idbKey = `meta:${key}`;
      const idbRes = await idbGet(idbKey);
      if (idbRes.ok && idbRes.value !== null) {
        return idbRes.value;
      }
      const lsRes = lsGetRaw(`${LS_PROTECTED_PREFIX}meta.${key}`);
      if (lsRes.ok && lsRes.raw !== null) {
        try {
          return JSON.parse(lsRes.raw);
        } catch {
          return null;
        }
      }
      return memoryPlatformMeta.has(key) ? memoryPlatformMeta.get(key) : null;
    },
    async setPlatformMeta(key, value) {
      if (typeof key !== 'string' || key.trim().length === 0 || key === IDB_GUEST_KEY) {
        throw new AuroMindSDKError(
          'INVALID_META_KEY',
          'setPlatformMeta requires a non-empty non-reserved metadata key.'
        );
      }
      memoryPlatformMeta.set(key, value);
      const idbRes = await idbPut(`meta:${key}`, value);
      const lsRes = lsSetRaw(`${LS_PROTECTED_PREFIX}meta.${key}`, JSON.stringify(value));
      return idbRes.ok || lsRes.ok;
    },
    async removePlatformMeta(key) {
      if (typeof key !== 'string' || key.trim().length === 0 || key === IDB_GUEST_KEY) {
        throw new AuroMindSDKError(
          'INVALID_META_KEY',
          'removePlatformMeta requires a non-empty non-reserved metadata key.'
        );
      }
      memoryPlatformMeta.delete(key);
      const idbRes = await idbDelete(`meta:${key}`);
      const lsRes = lsRemoveRaw(`${LS_PROTECTED_PREFIX}meta.${key}`);
      return idbRes.ok || lsRes.ok;
    },
    getOfflineState: () => getOfflineStateSnapshot(),
    subscribeOfflineState(listener) {
      if (typeof listener !== 'function') {
        throw new AuroMindSDKError('INVALID_LISTENER', 'subscribeOfflineState requires a function.');
      }
      setupOfflineListeners();
      offlineListeners.add(listener);
      return () => {
        offlineListeners.delete(listener);
      };
    },
    requestPersistence: () => requestStoragePersistence(),
    checkQuota: () => checkStorageQuota(),
    getStorageResilience() {
      return Object.freeze({
        idbAvailable: storageHealth.idbAvailable,
        lsAvailable: storageHealth.lsAvailable,
        persisted: storageHealth.persisted,
        quota: storageHealth.quota,
        storageSource,
        isEphemeral: ephemeral,
        webLocksSupported: storageHealth.webLocksSupported,
        broadcastChannelSupported: storageHealth.broadcastChannelSupported,
        lastRepairedFrom: storageHealth.lastRepairedFrom,
        lastReconciledFrom: storageHealth.lastReconciledFrom,
        corruptedStores: Object.freeze([...storageHealth.corruptedStores]),
        lastError: storageHealth.lastError
      });
    },
    async exportBackup() {
      const profile = playerService.getProfile();
      const identity = buildPlayerIdentity();
      const entitlements = entitlementsService.getEntitlements();
      const saves = {};
      for (const item of adaptersRegistry.list()) {
        try {
          const env = await adaptersRegistry.exportLocalEnvelope(item.gameId);
          if (env) saves[item.gameId] = env;
        } catch {}
      }
      return Object.freeze({
        backupVersion: 1,
        exportedAt: getNow().toISOString(),
        identity,
        profile,
        entitlements,
        saves
      });
    },
    quarantineCorruptSave(gameId, raw) {
      const result = quarantineCorruptSave(gameId, raw, {
        localStorage: getLocalStorage(),
        guestId: currentGuestRecord ? currentGuestRecord.guestId : null
      });
      loggingService.error('quarantine', `Corrupted save quarantined for game ${gameId}`, {
        gameId,
        raw
      });
      try {
        telemetryService.track(
          'save_corruption_quarantined',
          { gameId, reason: 'unparseable_or_corrupted_payload' },
          { category: 'critical', gameId }
        );
      } catch {}
      return result;
    }
  });

  let activeSyncPromise = null;

  const syncService = Object.freeze({
    isAvailable() {
      return Boolean(
        capabilities.cloudSyncEnabled &&
        providers.cloudSync &&
        typeof providers.cloudSync.isConfigured === 'function' &&
        providers.cloudSync.isConfigured()
      );
    },
    hasConsent() {
      return syncConsent === true;
    },
    getConsent() {
      return syncConsent === true;
    },
    setConsent(consented) {
      syncConsent = Boolean(consented);
      persistSyncState();
      loggingService.info('sync', `Cloud sync consent updated to ${syncConsent}`);
      return syncConsent;
    },
    async queueLocalChange(gameId) {
      if (typeof gameId === 'string' && gameId.trim().length > 0) {
        const gid = gameId.trim();
        syncOutbox.add(gid);
        persistSyncState();

        const mutation = {
          id: `${gid}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          gameId: gid,
          attempts: 0,
          status: 'pending',
          queuedAt: getNow().toISOString(),
          lastAttemptAt: null,
          error: null
        };
        try {
          await idbPutOutbox(mutation);
        } catch {}
      }
    },
    getBackoffDelay(attempts = 0) {
      const base = 1000 * Math.pow(2, Math.min(attempts, 10));
      const jitter = Math.floor(Math.random() * 500);
      return Math.min(base + jitter, 15 * 60 * 1000);
    },
    async drainOutbox() {
      return this.syncNow();
    },
    async onReconnect() {
      if (!this.isAvailable() || !this.hasConsent()) {
        return Object.freeze({ status: 'skipped', reason: 'sync_not_ready' });
      }
      return this.drainOutbox();
    },
    getPendingOutboxCount() {
      return syncOutbox.size;
    },
    getPendingGames() {
      return Array.from(syncOutbox);
    },
    getSyncStatus() {
      return Object.freeze({
        available: this.isAvailable(),
        consent: this.hasConsent(),
        outboxCount: syncOutbox.size,
        pendingGames: Array.from(syncOutbox),
        lastSyncAt: syncMetadata.lastSyncAt || null,
        metadata: { ...syncMetadata }
      });
    },
    async syncNow(targetGameId = null) {
      if (activeSyncPromise) {
        return activeSyncPromise;
      }

      activeSyncPromise = (async () => {
        try {
          if (!this.isAvailable()) {
            return Object.freeze({ status: 'skipped', reason: 'cloud_sync_disabled_or_unconfigured' });
          }
          if (!this.hasConsent()) {
            return Object.freeze({ status: 'skipped', reason: 'consent_not_granted' });
          }
          if (!currentAccount || !currentAccount.userId) {
            return Object.freeze({ status: 'skipped', reason: 'auth_required' });
          }

          const userId = currentAccount.userId;
          const gameIds = targetGameId
            ? [targetGameId]
            : adaptersRegistry.list().map((item) => (typeof item === 'string' ? item : item.gameId));
          const results = [];

          for (const gid of gameIds) {
            try {
              const caps = adaptersRegistry.discoverCapabilities(gid);
              if (!caps || !caps.cloudSyncEligible) {
                loggingService.debug('sync', `Skipping non-sync-eligible game "${gid}"`);
                continue;
              }

              // Export local envelope
              let localEnvelope = null;
              try {
                localEnvelope = await adaptersRegistry.exportLocalEnvelope(gid);
              } catch (e) {
                loggingService.debug('sync', `No local envelope for "${gid}": ${e.message}`);
              }

              if (!localEnvelope) {
                continue;
              }

              // Strict privacy guarantee: local-only vaults (such as Sankalpa E2EE vault)
              // must NEVER be uploaded or synchronized to the cloud.
              if (caps.hasLocalOnlyVaults && Array.isArray(caps.localOnlyVaults)) {
                const payloadStr = JSON.stringify(localEnvelope.payload || {});
                let containsForbiddenVault = false;
                for (const vaultKey of caps.localOnlyVaults) {
                  if (payloadStr.includes(vaultKey)) {
                    loggingService.error('sync', `Security violation: local envelope for "${gid}" contains local-only vault "${vaultKey}". Sync aborted for this game.`);
                    containsForbiddenVault = true;
                    break;
                  }
                }
                if (containsForbiddenVault) {
                  continue;
                }
              }

              // Pull remote save
              const remoteRecord = await providers.cloudSync.pullLatest(userId, gid);

              if (!remoteRecord) {
                // No remote record exists yet
                if (!localEnvelope.isEmpty) {
                  const pushRes = await providers.cloudSync.pushWithOptimisticLock(
                    localEnvelope,
                    userId,
                    0
                  );
                  if (pushRes && pushRes.status === 'success') {
                    syncOutbox.delete(gid);
                    syncMetadata[gid] = {
                      revision: pushRes.newRevision,
                      syncedAt: getNow().toISOString()
                    };
                    results.push({ gameId: gid, action: 'pushed_initial', revision: pushRes.newRevision });
                  } else {
                    results.push({ gameId: gid, action: 'push_failed', error: pushRes?.message });
                  }
                }
                continue;
              }

              // Remote save exists: construct remote envelope
              const remoteEnvelope = Object.freeze({
                envelopeVersion: remoteRecord.envelopeVersion || 1,
                gameId: gid,
                gameSchemaVersion: remoteRecord.gameSchemaVersion || 1,
                guestId:
                  remoteRecord.sourceGuestId ||
                  (currentGuestRecord ? currentGuestRecord.guestId : 'guest_00000000-0000-4000-8000-000000000000'),
                baseRevision: remoteRecord.revision || 1,
                checksum: remoteRecord.checksum,
                payload: remoteRecord.payload,
                clientUpdatedAt:
                  remoteRecord.clientUpdatedAt || remoteRecord.serverUpdatedAt || getNow().toISOString(),
                isEmpty: Boolean(remoteRecord.isEmpty)
              });

              // Idempotent sync: if local and remote checksums match, records are identical
              if (localEnvelope.checksum && remoteRecord.checksum && localEnvelope.checksum === remoteRecord.checksum) {
                syncOutbox.delete(gid);
                syncMetadata[gid] = {
                  revision: remoteRecord.revision || 1,
                  syncedAt: getNow().toISOString()
                };
                results.push({ gameId: gid, action: 'in_sync', revision: remoteRecord.revision || 1 });
                continue;
              }

              // Resolve merge with game-owned strategy
              const mergeResolution = adaptersRegistry.resolveMerge(gid, localEnvelope, remoteEnvelope);

              if (mergeResolution.status === 'use_local') {
                const expectedRev = remoteRecord.revision || 0;
                const pushRes = await providers.cloudSync.pushWithOptimisticLock(
                  localEnvelope,
                  userId,
                  expectedRev
                );

                if (pushRes && pushRes.status === 'success') {
                  syncOutbox.delete(gid);
                  syncMetadata[gid] = {
                    revision: pushRes.newRevision,
                    syncedAt: getNow().toISOString()
                  };
                  results.push({ gameId: gid, action: 'pushed_update', revision: pushRes.newRevision });
                } else if (pushRes && pushRes.status === 'conflict') {
                  loggingService.warn(
                    'sync',
                    `Optimistic concurrency conflict on "${gid}". Current revision: ${pushRes.currentRevision}`
                  );
                  results.push({
                    gameId: gid,
                    action: 'conflict',
                    currentRevision: pushRes.currentRevision,
                    serverRecord: pushRes.serverRecord
                  });
                } else {
                  results.push({ gameId: gid, action: 'push_failed', error: pushRes?.message });
                }
              } else if (mergeResolution.status === 'use_remote') {
                await adaptersRegistry.applyRemoteEnvelope(gid, remoteEnvelope);
                syncOutbox.delete(gid);
                syncMetadata[gid] = {
                  revision: remoteRecord.revision,
                  syncedAt: getNow().toISOString()
                };
                results.push({ gameId: gid, action: 'applied_remote', revision: remoteRecord.revision });
              } else if (mergeResolution.status === 'auto_merged') {
                const mergedEnvelope = Object.freeze({
                  ...localEnvelope,
                  payload: mergeResolution.resolvedPayload,
                  checksum: `merged_${Date.now()}`,
                  clientUpdatedAt: getNow().toISOString()
                });
                await adaptersRegistry.applyRemoteEnvelope(gid, mergedEnvelope);
                const expectedRev = remoteRecord.revision || 0;
                const pushRes = await providers.cloudSync.pushWithOptimisticLock(
                  mergedEnvelope,
                  userId,
                  expectedRev
                );
                if (pushRes && pushRes.status === 'success') {
                  syncOutbox.delete(gid);
                  syncMetadata[gid] = {
                    revision: pushRes.newRevision,
                    syncedAt: getNow().toISOString()
                  };
                  results.push({ gameId: gid, action: 'auto_merged_and_pushed', revision: pushRes.newRevision });
                } else {
                  results.push({ gameId: gid, action: 'auto_merged_push_failed', error: pushRes?.message });
                }
              } else {
                results.push({
                  gameId: gid,
                  action: 'conflict_requires_user_choice',
                  summary: mergeResolution.conflictSummary
                });
              }
            } catch (err) {
              loggingService.error('sync', `Sync failed for game "${gid}": ${err.message}`, {
                error: err.message
              });
              results.push({ gameId: gid, action: 'error', error: err.message });
            }
          }

          syncMetadata.lastSyncAt = getNow().toISOString();
          persistSyncState();

          return Object.freeze({
            status: 'success',
            syncedAt: syncMetadata.lastSyncAt,
            results: Object.freeze(results)
          });
        } finally {
          activeSyncPromise = null;
        }
      })();

      return activeSyncPromise;
    }
  });

  // =========================================================================
  // B4 Centralized Logging & Diagnostics Service
  // =========================================================================

  function getLogLevelNumber(lvl) {
    if (typeof lvl === 'number') return lvl;
    if (typeof lvl === 'string') {
      const u = lvl.toUpperCase();
      if (Object.prototype.hasOwnProperty.call(LOG_LEVELS, u)) {
        return LOG_LEVELS[u];
      }
    }
    return LOG_LEVELS.INFO;
  }

  function getLogLevelName(num) {
    for (const [name, val] of Object.entries(LOG_LEVELS)) {
      if (val === num) return name;
    }
    return 'INFO';
  }

  function persistRecentLogs() {
    try {
      const slice = memoryLogBuffer.slice(-MAX_LS_LOGS);
      lsSetRaw(LS_LOGS_KEY, JSON.stringify(slice));
    } catch {}
  }

  function loadPersistedLogs() {
    try {
      const lsRes = lsGetRaw(LS_LOGS_KEY);
      if (lsRes.ok && lsRes.raw) {
        const parsed = JSON.parse(lsRes.raw);
        if (Array.isArray(parsed)) {
          memoryLogBuffer.length = 0;
          for (const item of parsed.slice(-MAX_MEMORY_LOGS)) {
            memoryLogBuffer.push(Object.freeze(item));
          }
        }
      }
    } catch {}
  }

  const loggingService = Object.freeze({
    log(level, tag, message, data = null) {
      const numLevel = getLogLevelNumber(level);
      if (numLevel < currentLogLevel) {
        return null;
      }
      const levelName = getLogLevelName(numLevel);
      const entry = Object.freeze({
        id: generateUuidV4(getCrypto()),
        timestamp: getNow().toISOString(),
        level: levelName,
        tag: typeof tag === 'string' && tag.trim() ? tag.trim() : 'platform',
        message: typeof message === 'string' ? redactSensitive(message) : String(message),
        data: redactSensitive(data),
        sessionId: currentSessionId,
        gameId: activeConfig?.gameId || 'portal'
      });
      memoryLogBuffer.push(entry);
      if (memoryLogBuffer.length > MAX_MEMORY_LOGS) {
        memoryLogBuffer.shift();
      }
      persistRecentLogs();
      return entry;
    },
    debug(tag, message, data = null) {
      return this.log('DEBUG', tag, message, data);
    },
    info(tag, message, data = null) {
      return this.log('INFO', tag, message, data);
    },
    warn(tag, message, data = null) {
      return this.log('WARN', tag, message, data);
    },
    error(tag, message, data = null) {
      return this.log('ERROR', tag, message, data);
    },
    fatal(tag, message, data = null) {
      return this.log('FATAL', tag, message, data);
    },
    getRecentLogs(limit = 50, minLevel = null) {
      const minNum = minLevel !== null ? getLogLevelNumber(minLevel) : null;
      let logs = memoryLogBuffer;
      if (minNum !== null) {
        logs = logs.filter((l) => getLogLevelNumber(l.level) >= minNum);
      }
      return Object.freeze(logs.slice(-Math.max(1, limit)));
    },
    clear() {
      memoryLogBuffer.length = 0;
      lsRemoveRaw(LS_LOGS_KEY);
    },
    setLevel(level) {
      currentLogLevel = getLogLevelNumber(level);
    },
    getLevel() {
      return getLogLevelName(currentLogLevel);
    },
    exportDiagnostics() {
      return diagnosticsService.exportDiagnostics();
    }
  });

  const diagnosticsService = Object.freeze({
    exportDiagnostics() {
      const perfMem =
        typeof globalThis.performance !== 'undefined' && globalThis.performance?.memory
          ? {
              usedJSHeapSize: globalThis.performance.memory.usedJSHeapSize,
              totalJSHeapSize: globalThis.performance.memory.totalJSHeapSize
            }
          : null;

      return Object.freeze({
        exportedAt: getNow().toISOString(),
        sdkVersion: SDK_VERSION,
        gameId: activeConfig?.gameId || 'portal',
        sessionId: currentSessionId,
        identity: buildPlayerIdentity(),
        storageHealth: identityService.getStorageHealth(),
        offlineState: storageService.getOfflineState(),
        config: configService.getAllConfig(),
        entitlements: entitlementsService.getEntitlements(),
        playerProfile: playerService.getProfile(),
        telemetry: {
          queueLength: memoryTelemetryQueue.length,
          consent: telemetryConsent === true
        },
        sync: {
          consent: syncConsent === true,
          outboxCount: syncOutbox.size,
          pendingGames: Array.from(syncOutbox),
          isAvailable: Boolean(
            capabilities.cloudSyncEnabled &&
            providers.cloudSync &&
            providers.cloudSync.isConfigured()
          )
        },
        logs: loggingService.getRecentLogs(50),
        memory: perfMem
      });
    }
  });

  // =========================================================================
  // B4 Telemetry and Event Collection Service
  // =========================================================================

  function persistTelemetryQueue() {
    try {
      lsSetRaw(LS_TELEMETRY_KEY, JSON.stringify(memoryTelemetryQueue));
    } catch {}
  }

  const TELEMETRY_CAPS = Object.freeze({
    CRITICAL: 100,
    ENGAGEMENT: 300,
    DIAGNOSTIC: 100,
    TOTAL: 500
  });
  let criticalOverflowCounter = 0;

  function loadPersistedTelemetry() {
    try {
      const cRes = lsGetRaw(LS_CONSENT_KEY);
      if (cRes.ok && cRes.raw !== null) {
        telemetryConsent = cRes.raw === 'true';
      }
      const qRes = lsGetRaw(LS_TELEMETRY_KEY);
      if (qRes.ok && qRes.raw) {
        const parsed = JSON.parse(qRes.raw);
        if (Array.isArray(parsed)) {
          memoryTelemetryQueue.length = 0;
          const cutoff = getNow().getTime() - 30 * 24 * 60 * 60 * 1000;
          for (const item of parsed) {
            if (item && item.timestamp && Date.parse(item.timestamp) >= cutoff) {
              memoryTelemetryQueue.push(Object.freeze(item));
            }
          }
        }
      }
    } catch {}
  }

  const telemetryService = Object.freeze({
    track(eventName, payload = {}, options = {}) {
      if (!eventName || typeof eventName !== 'string') {
        return null;
      }
      // Strict privacy check: only collect if consent is explicitly granted (opt-in)
      if (telemetryConsent !== true) {
        return null;
      }
      const rawCat = (typeof options.category === 'string' && options.category.trim())
        ? options.category.trim()
        : 'engagement';
      const category = rawCat;
      const lowerCat = rawCat.toLowerCase();
      const tier = (lowerCat === 'critical' || lowerCat === 'error')
        ? 'critical'
        : (lowerCat === 'diagnostic' || lowerCat === 'debug' ? 'diagnostic' : 'engagement');

      const event = Object.freeze({
        eventId: generateUuidV4(getCrypto()),
        schemaVersion: 1,
        timestamp: getNow().toISOString(),
        eventName: eventName.trim(),
        category,
        tier,
        gameId: options.gameId || activeConfig?.gameId || 'portal',
        sessionId: currentSessionId,
        guestId: currentGuestRecord ? currentGuestRecord.guestId : null,
        payload: sanitizeTelemetryPayload(payload || {}),
        appVersion: activeConfig?.appVersion || SDK_VERSION
      });

      // 30-day auto-purge
      const cutoff = getNow().getTime() - 30 * 24 * 60 * 60 * 1000;
      let i = memoryTelemetryQueue.length;
      while (i--) {
        const ts = Date.parse(memoryTelemetryQueue[i].timestamp);
        if (!Number.isNaN(ts) && ts < cutoff) {
          memoryTelemetryQueue.splice(i, 1);
        }
      }

      // Check tier capacity and total capacity (500)
      if (tier === 'critical') {
        const criticalCount = memoryTelemetryQueue.filter(e => e.tier === 'critical' || e.category === 'critical').length;
        if (criticalCount >= TELEMETRY_CAPS.CRITICAL) {
          const idx = memoryTelemetryQueue.findIndex(e => e.tier === 'critical' || e.category === 'critical');
          if (idx !== -1) {
            memoryTelemetryQueue.splice(idx, 1);
            console.warn('[AuroMind Telemetry] CRITICAL_QUEUE_SATURATED');
            criticalOverflowCounter++;
            try {
              lsSetRaw('auromind.telemetry.critical_overflow', String(criticalOverflowCounter));
            } catch {}
          }
        }
      }

      if (memoryTelemetryQueue.length >= TELEMETRY_CAPS.TOTAL) {
        let dropIdx = memoryTelemetryQueue.findIndex(e => e.tier === 'diagnostic' || e.category === 'diagnostic');
        if (dropIdx === -1) {
          dropIdx = memoryTelemetryQueue.findIndex(e => e.tier === 'engagement' || e.category === 'engagement');
        }
        if (dropIdx !== -1) {
          memoryTelemetryQueue.splice(dropIdx, 1);
        } else {
          memoryTelemetryQueue.shift();
          console.warn('[AuroMind Telemetry] CRITICAL_QUEUE_SATURATED');
          criticalOverflowCounter++;
          try {
            lsSetRaw('auromind.telemetry.critical_overflow', String(criticalOverflowCounter));
          } catch {}
        }
      }

      memoryTelemetryQueue.push(event);
      persistTelemetryQueue();
      return event;
    },
    getCriticalOverflowCount() {
      return criticalOverflowCounter;
    },
    getTierCounts() {
      let critical = 0, engagement = 0, diagnostic = 0;
      for (const e of memoryTelemetryQueue) {
        if (e.tier === 'critical' || e.category === 'critical') critical++;
        else if (e.tier === 'diagnostic' || e.category === 'diagnostic') diagnostic++;
        else engagement++;
      }
      return Object.freeze({ critical, engagement, diagnostic, total: memoryTelemetryQueue.length });
    },
    getQueue(limit = 100) {
      return Object.freeze(memoryTelemetryQueue.slice(-Math.max(1, limit)));
    },
    getQueueLength() {
      return memoryTelemetryQueue.length;
    },
    clearQueue() {
      memoryTelemetryQueue.length = 0;
      criticalOverflowCounter = 0;
      lsRemoveRaw(LS_TELEMETRY_KEY);
      lsRemoveRaw('auromind.telemetry.critical_overflow');
    },
    setConsent(consented) {
      telemetryConsent = Boolean(consented);
      try {
        lsSetRaw(LS_CONSENT_KEY, String(telemetryConsent));
      } catch {}
      if (!telemetryConsent) {
        this.clearQueue();
      }
      return telemetryConsent;
    },
    revokeConsent() {
      return this.setConsent(false);
    },
    getConsent() {
      return telemetryConsent === true;
    },
    hasConsent() {
      return telemetryConsent === true;
    },
    optIn() {
      return this.setConsent(true);
    },
    optOut() {
      return this.setConsent(false);
    },
    setOptIn(enabled) {
      return this.setConsent(enabled);
    },
    isOptedIn() {
      return this.hasConsent();
    },
    getConsentState() {
      if (telemetryConsent === true) return 'granted';
      if (telemetryConsent === false) return 'denied';
      return 'undecided';
    },
    isConsentDecided() {
      return telemetryConsent !== null;
    },
    isAvailable() {
      return Boolean(providers.telemetryTransport && providers.telemetryTransport.isConfigured());
    },
    getSessionId() {
      return currentSessionId;
    },
    async flush() {
      if (criticalOverflowCounter > 0) {
        const incidentEvent = Object.freeze({
          eventId: generateUuidV4(getCrypto()),
          schemaVersion: 1,
          timestamp: getNow().toISOString(),
          eventName: 'TELEMETRY_OVERFLOW_INCIDENT',
          category: 'critical',
          tier: 'critical',
          gameId: activeConfig?.gameId || 'portal',
          sessionId: currentSessionId,
          guestId: currentGuestRecord ? currentGuestRecord.guestId : null,
          payload: {
            droppedCriticalCount: criticalOverflowCounter,
            reason: 'CRITICAL_QUEUE_SATURATED'
          },
          appVersion: activeConfig?.appVersion || SDK_VERSION
        });
        memoryTelemetryQueue.unshift(incidentEvent);
        criticalOverflowCounter = 0;
        try {
          lsRemoveRaw('auromind.telemetry.critical_overflow');
        } catch {}
      }
      if (providers.telemetryTransport && providers.telemetryTransport.isConfigured()) {
        const eventsToSend = [...memoryTelemetryQueue];
        if (eventsToSend.length === 0) {
          return Object.freeze({ ok: true, sentCount: 0 });
        }
        try {
          const res = await providers.telemetryTransport.sendEvents(eventsToSend);
          if (res && res.ok) {
            const count = typeof res.sentCount === 'number' ? res.sentCount : eventsToSend.length;
            memoryTelemetryQueue.splice(0, count);
            persistTelemetryQueue();
            return Object.freeze({ ok: true, sentCount: count });
          }
          return Object.freeze({ ok: false, error: res?.error || 'SEND_FAILED' });
        } catch (err) {
          return Object.freeze({ ok: false, error: err?.message || 'FLUSH_ERROR' });
        }
      }
      if (providers.analytics && providers.analytics.isConfigured()) {
        try {
          await providers.analytics.flush();
          return Object.freeze({ ok: true, sentCount: memoryTelemetryQueue.length });
        } catch (err) {
          return Object.freeze({ ok: false, error: err?.message || 'FLUSH_ERROR' });
        }
      }
      // Offline/local buffering mode: zero network calls in B4
      return Object.freeze({ ok: true, bufferedCount: memoryTelemetryQueue.length });
    }
  });

  const analyticsService = telemetryService;

  // =========================================================================
  // B4 Feature Flags and Configuration Management Service
  // =========================================================================

  const DEFAULT_PLATFORM_CONFIG = Object.freeze({
    'portal.seniorModeDefault': false,
    'portal.reducedMotionDefault': false,
    'portal.theaterAutoplay': true,
    'portal.analyticsOptInPrompt': true,
    'games.vak.audioPresets': 'standard',
    'games.vak.micSensitivity': 1.0,
    'games.auromatch.tileAnimations': true,
    'games.auromandala.soundEffects': true,
    'platform.commercialGatesActive': false,
    'platform.debugDiagnostics': false
  });

  function loadPersistedConfig() {
    try {
      const lsRes = lsGetRaw(LS_CONFIG_KEY);
      if (lsRes.ok && lsRes.raw) {
        const parsed = JSON.parse(lsRes.raw);
        if (parsed && typeof parsed === 'object') {
          localConfigOverrides = { ...parsed };
        }
      }
    } catch {}
  }

  function persistConfigOverrides() {
    try {
      lsSetRaw(LS_CONFIG_KEY, JSON.stringify(localConfigOverrides));
    } catch {}
  }

  const configService = Object.freeze({
    get(key, defaultValue = null) {
      if (typeof key !== 'string') return defaultValue;
      if (Object.prototype.hasOwnProperty.call(localConfigOverrides, key)) {
        return localConfigOverrides[key];
      }
      if (Object.prototype.hasOwnProperty.call(cachedRemoteConfig, key)) {
        return cachedRemoteConfig[key];
      }
      if (Object.prototype.hasOwnProperty.call(DEFAULT_PLATFORM_CONFIG, key)) {
        return DEFAULT_PLATFORM_CONFIG[key];
      }
      return defaultValue;
    },
    getBoolean(key, defaultValue = false) {
      const val = this.get(key, defaultValue);
      return typeof val === 'boolean' ? val : Boolean(val);
    },
    getNumber(key, defaultValue = 0) {
      const val = this.get(key, defaultValue);
      const parsed = Number(val);
      return Number.isNaN(parsed) ? defaultValue : parsed;
    },
    getString(key, defaultValue = '') {
      const val = this.get(key, defaultValue);
      return typeof val === 'string' ? val : String(val ?? defaultValue);
    },
    isFeatureEnabled(featureName) {
      return this.getBoolean(featureName, false);
    },
    setOverride(key, value) {
      if (typeof key !== 'string' || !key.trim()) {
        throw new AuroMindSDKError('INVALID_CONFIG_KEY', 'Config key must be a non-empty string.');
      }
      localConfigOverrides = {
        ...localConfigOverrides,
        [key.trim()]: value
      };
      persistConfigOverrides();
      return true;
    },
    clearOverride(key) {
      if (typeof key !== 'string') return false;
      const copy = { ...localConfigOverrides };
      delete copy[key];
      localConfigOverrides = copy;
      persistConfigOverrides();
      return true;
    },
    getAllConfig() {
      return Object.freeze({
        ...DEFAULT_PLATFORM_CONFIG,
        ...cachedRemoteConfig,
        ...localConfigOverrides
      });
    },
    getFlag(key, defaultValue) {
      return this.getBoolean(key, defaultValue);
    },
    getValue(key, defaultValue) {
      return this.get(key, defaultValue);
    },
    async refresh() {
      if (!capabilities.remoteConfigEnabled || !providers.remoteConfig.isConfigured()) {
        return this.getAllConfig();
      }
      const next = await providers.remoteConfig.fetchConfig(activeConfig?.appVersion || SDK_VERSION);
      if (next && typeof next === 'object') {
        cachedRemoteConfig = Object.freeze({ ...next });
      }
      return this.getAllConfig();
    }
  });

  // =========================================================================
  // B4 Player Profile and Account Abstraction Service
  // =========================================================================

  function loadPlayerProfile() {
    try {
      const lsRes = lsGetRaw(LS_PROFILE_KEY);
      if (lsRes.ok && lsRes.raw) {
        const parsed = JSON.parse(lsRes.raw);
        if (parsed && typeof parsed === 'object') {
          return {
            guestId: currentGuestRecord ? currentGuestRecord.guestId : parsed.guestId || null,
            displayName: typeof parsed.displayName === 'string' ? parsed.displayName : 'Guest Seeker',
            preferences: {
              seniorMode: Boolean(parsed.preferences?.seniorMode),
              reducedMotion: Boolean(parsed.preferences?.reducedMotion),
              ambientVolume:
                typeof parsed.preferences?.ambientVolume === 'number'
                  ? parsed.preferences.ambientVolume
                  : 0.5,
              sfxVolume:
                typeof parsed.preferences?.sfxVolume === 'number' ? parsed.preferences.sfxVolume : 0.8,
              theme: typeof parsed.preferences?.theme === 'string' ? parsed.preferences.theme : 'system',
              ...(parsed.preferences || {})
            },
            stats: {
              totalPlaytimeMinutes: Number(parsed.stats?.totalPlaytimeMinutes) || 0,
              sessionsCount: Number(parsed.stats?.sessionsCount) || 1,
              firstSeen: parsed.stats?.firstSeen || getNow().toISOString(),
              lastSeen: getNow().toISOString()
            },
            schemaVersion: 1
          };
        }
      }
    } catch {}

    return {
      guestId: currentGuestRecord ? currentGuestRecord.guestId : null,
      displayName: 'Guest Seeker',
      preferences: {
        seniorMode: false,
        reducedMotion: false,
        ambientVolume: 0.5,
        sfxVolume: 0.8,
        theme: 'system'
      },
      stats: {
        totalPlaytimeMinutes: 0,
        sessionsCount: 1,
        firstSeen: getNow().toISOString(),
        lastSeen: getNow().toISOString()
      },
      schemaVersion: 1
    };
  }

  function persistPlayerProfile(prof) {
    try {
      lsSetRaw(LS_PROFILE_KEY, JSON.stringify(prof));
    } catch {}
  }

  function getProfileInternal() {
    if (!cachedPlayerProfile) {
      cachedPlayerProfile = loadPlayerProfile();
    }
    if (currentGuestRecord && cachedPlayerProfile.guestId !== currentGuestRecord.guestId) {
      cachedPlayerProfile.guestId = currentGuestRecord.guestId;
    }
    return cachedPlayerProfile;
  }

  const playerService = Object.freeze({
    getProfile() {
      const p = getProfileInternal();
      return Object.freeze(JSON.parse(JSON.stringify(p)));
    },
    updatePreferences(partial) {
      if (!partial || typeof partial !== 'object') return this.getPreferences();
      const prof = getProfileInternal();
      prof.preferences = {
        ...prof.preferences,
        ...partial
      };
      persistPlayerProfile(prof);
      return Object.freeze({ ...prof.preferences });
    },
    getPreferences() {
      const prof = getProfileInternal();
      return Object.freeze({ ...prof.preferences });
    },
    updateStats(partialStats) {
      if (!partialStats || typeof partialStats !== 'object') return;
      const prof = getProfileInternal();
      prof.stats = {
        ...prof.stats,
        ...partialStats,
        lastSeen: getNow().toISOString()
      };
      persistPlayerProfile(prof);
      return Object.freeze({ ...prof.stats });
    },
    getDisplayName() {
      return getProfileInternal().displayName;
    },
    setDisplayName(name) {
      const prof = getProfileInternal();
      prof.displayName =
        typeof name === 'string' && name.trim() ? name.trim().slice(0, 50) : 'Guest Seeker';
      persistPlayerProfile(prof);
      return prof.displayName;
    },
    async exportUserData() {
      const prof = this.getProfile();
      let externalData = null;
      if (providers.accountProvider && providers.accountProvider.isConfigured()) {
        try {
          externalData = await providers.accountProvider.exportUserData();
        } catch {}
      }
      return Object.freeze({
        exportedAt: getNow().toISOString(),
        guestIdentity: buildPlayerIdentity(),
        profile: prof,
        entitlements: entitlementsService.getEntitlements(),
        recentLogs: loggingService.getRecentLogs(20),
        telemetryQueueLength: telemetryService.getQueueLength(),
        providerData: externalData
      });
    },
    async deleteUserData() {
      cachedPlayerProfile = null;
      lsRemoveRaw(LS_PROFILE_KEY);
      loggingService.clear();
      telemetryService.clearQueue();
      localConfigOverrides = {};
      lsRemoveRaw(LS_CONFIG_KEY);
      localEntitlements = [];
      lsRemoveRaw(LS_ENTITLEMENTS_KEY);

      if (providers.accountProvider && providers.accountProvider.isConfigured()) {
        try {
          await providers.accountProvider.deleteUserData();
        } catch {}
      }
      return true;
    }
  });

  const profileService = playerService;

  // =========================================================================
  // B4 Entitlements and Monetization Abstraction Service
  // =========================================================================

  function loadPersistedEntitlements() {
    try {
      const lsRes = lsGetRaw(LS_ENTITLEMENTS_KEY);
      if (lsRes.ok && lsRes.raw) {
        const parsed = JSON.parse(lsRes.raw);
        if (Array.isArray(parsed)) {
          localEntitlements = parsed;
          return;
        }
      }
    } catch {}
    localEntitlements = [];
  }

  function persistEntitlements() {
    try {
      lsSetRaw(LS_ENTITLEMENTS_KEY, JSON.stringify(localEntitlements));
    } catch {}
  }

  let activeCommercialGateOverride = null;

  const entitlementsService = Object.freeze({
    isCommercialGateActive() {
      if (typeof activeCommercialGateOverride === 'boolean') {
        return activeCommercialGateOverride;
      }
      return (
        configService.isFeatureEnabled('platform.commercialGatesActive') ||
        Boolean(capabilities.entitlementsEnabled && providers.entitlements.isConfigured())
      );
    },
    hasEntitlement(gameId, skuOrTier = null) {
      if (!this.isCommercialGateActive()) {
        return true;
      }
      const allEntitlements = [...localEntitlements, ...cachedEntitlements];
      return allEntitlements.some(
        (rec) =>
          (rec.status === 'active' || rec.status === undefined) &&
          (rec.gameId === 'all' || rec.gameId === gameId) &&
          (!skuOrTier || rec.sku === skuOrTier || rec.tier === skuOrTier)
      );
    },
    hasAccess(gameId, levelOrTier = null) {
      if (!this.isCommercialGateActive()) return true;
      if (typeof levelOrTier === 'number') {
        return this.canAccessLevel(gameId, levelOrTier);
      }
      return this.hasEntitlement(gameId, levelOrTier);
    },
    canAccessLevel(gameId, levelNumber, freeTierMax = Infinity) {
      if (!this.isCommercialGateActive()) return true;
      if (levelNumber <= freeTierMax) return true;
      return this.hasEntitlement(gameId);
    },
    getEntitlements() {
      return Object.freeze([...localEntitlements, ...cachedEntitlements]);
    },
    grantLocalEntitlement(gameId, tier = 'full') {
      const record = Object.freeze({
        entitlementId: generateUuidV4(getCrypto()),
        gameId: typeof gameId === 'string' ? gameId : 'all',
        tier: typeof tier === 'string' ? tier : 'full',
        grantedAt: getNow().toISOString(),
        verified: false,
        source: 'local'
      });
      localEntitlements = [...localEntitlements, record];
      persistEntitlements();
      return record;
    },
    revokeLocalEntitlement(gameId) {
      localEntitlements = localEntitlements.filter(
        (rec) => rec.gameId !== gameId && rec.gameId !== 'all'
      );
      persistEntitlements();
      return true;
    },
    async purchase(item) {
      if (providers.purchaseProvider && providers.purchaseProvider.isConfigured()) {
        return providers.purchaseProvider.purchase(item);
      }
      return Object.freeze({
        ok: false,
        errorCode: 'PURCHASE_PROVIDER_NOT_CONFIGURED',
        message: 'No purchase provider is configured.'
      });
    },
    async restorePurchases() {
      if (providers.purchaseProvider && providers.purchaseProvider.isConfigured()) {
        const restored = await providers.purchaseProvider.restorePurchases();
        return Object.freeze([...restored]);
      }
      return Object.freeze([]);
    },
    async refresh() {
      if (!this.isCommercialGateActive() || !currentAccount) {
        return Object.freeze([...localEntitlements, ...cachedEntitlements]);
      }
      const records = await providers.entitlements.fetchEntitlements(currentAccount.userId);
      cachedEntitlements = Object.freeze([...records]);
      return Object.freeze([...localEntitlements, ...cachedEntitlements]);
    }
  });

  // =========================================================================
  // B4 Shared Achievements Management Service (F-06 / ADR-03)
  // =========================================================================

  const LS_ACHIEVEMENTS_KEY = 'auromind.platform.v1.achievements';
  let localAchievements = new Map();
  const achievementDefinitions = new Map();
  const achievementListeners = new Set();

  function loadPersistedAchievements() {
    try {
      const res = lsGetRaw(LS_ACHIEVEMENTS_KEY);
      if (res.ok && res.raw) {
        const parsed = JSON.parse(res.raw);
        if (parsed && typeof parsed === 'object') {
          localAchievements = new Map(Object.entries(parsed));
        }
      }
    } catch {}
  }

  function persistAchievements() {
    try {
      const obj = Object.fromEntries(localAchievements.entries());
      lsSetRaw(LS_ACHIEVEMENTS_KEY, JSON.stringify(obj));
    } catch {}
  }

  const achievementsService = Object.freeze({
    init(config = {}) {
      loadPersistedAchievements();
      return this;
    },
    registerDefinitions(definitions = [], defaultGameId = null) {
      if (Array.isArray(definitions)) {
        for (const def of definitions) {
          if (def && typeof def.id === 'string' && def.id.trim().length > 0) {
            const id = def.id.trim();
            const defRecord = Object.freeze({
              ...def,
              id,
              gameId: def.gameId || defaultGameId || (activeConfig ? activeConfig.gameId : 'portal'),
              title: def.title || id,
              description: def.description || '',
              maxProgress: Number(def.maxProgress || 100)
            });
            achievementDefinitions.set(id, defRecord);
          }
        }
      }
      return this.listDefinitions();
    },
    listDefinitions(filterGameId = null) {
      const list = [];
      for (const def of achievementDefinitions.values()) {
        if (!filterGameId || def.gameId === filterGameId) {
          list.push(def);
        }
      }
      return Object.freeze(list);
    },
    async unlock(achievementId, metadata = {}) {
      try {
        if (!achievementId || typeof achievementId !== 'string') {
          return Object.freeze({ unlocked: false, firstUnlock: false });
        }
        const id = achievementId.trim();
        const existing = localAchievements.get(id);
        if (existing && existing.unlocked) {
          return Object.freeze({ unlocked: true, firstUnlock: false, achievement: existing });
        }
        const gameId = metadata.gameId || (existing && existing.gameId) || (activeConfig ? activeConfig.gameId : 'portal');
        const record = Object.freeze({
          id,
          gameId,
          unlocked: true,
          unlockedAt: (existing && existing.unlockedAt) || getNow().toISOString(),
          progress: (typeof metadata.progress === 'number') ? metadata.progress : ((existing && typeof existing.progress === 'number') ? existing.progress : 100),
          maxProgress: (typeof metadata.maxProgress === 'number') ? metadata.maxProgress : ((existing && typeof existing.maxProgress === 'number') ? existing.maxProgress : 100),
          metadata: redactSensitive(metadata || {})
        });
        localAchievements.set(id, record);
        persistAchievements();

        // Trigger telemetry without throwing
        try {
          telemetryService.track(
            'achievement_unlocked',
            { achievementId: id, gameId, metadata },
            { category: 'engagement' }
          );
        } catch {}

        for (const listener of achievementListeners) {
          try {
            listener(record);
          } catch {}
        }
        return Object.freeze({ unlocked: true, firstUnlock: true, achievement: record });
      } catch (err) {
        loggingService.warn('achievements', `Achievement unlock failed non-blockingly: ${err.message}`);
        return Object.freeze({ unlocked: false, firstUnlock: false, error: err.message });
      }
    },
    async incrementProgress(achievementId, amount = 1, maxProgress = 100, metadata = {}) {
      try {
        if (!achievementId || typeof achievementId !== 'string') {
          return null;
        }
        const id = achievementId.trim();
        const existing = localAchievements.get(id);
        if (existing && existing.unlocked) {
          return existing;
        }
        const gameId = metadata.gameId || (existing && existing.gameId) || (activeConfig ? activeConfig.gameId : 'portal');
        const currentProgress = (existing && typeof existing.progress === 'number') ? existing.progress : 0;
        const targetMax = (existing && typeof existing.maxProgress === 'number') ? existing.maxProgress : maxProgress;
        const newProgress = Math.min(targetMax, currentProgress + Number(amount || 0));

        if (newProgress >= targetMax) {
          const res = await this.unlock(id, { ...metadata, gameId, progress: newProgress, maxProgress: targetMax });
          return res.achievement;
        }

        const updated = Object.freeze({
          id,
          gameId,
          unlocked: false,
          unlockedAt: null,
          progress: newProgress,
          maxProgress: targetMax,
          updatedAt: getNow().toISOString(),
          metadata: redactSensitive(metadata || {})
        });
        localAchievements.set(id, updated);
        persistAchievements();

        for (const listener of achievementListeners) {
          try {
            listener(updated);
          } catch {}
        }
        return updated;
      } catch (err) {
        loggingService.warn('achievements', `Achievement progress failed non-blockingly: ${err.message}`);
        return null;
      }
    },
    hasUnlocked(achievementId) {
      if (!achievementId) return false;
      const existing = localAchievements.get(achievementId.trim());
      return Boolean(existing && existing.unlocked);
    },
    getProgress(achievementId) {
      if (!achievementId) return null;
      return localAchievements.get(achievementId.trim()) || null;
    },
    listUnlocked(filterGameId = null) {
      const list = [];
      for (const val of localAchievements.values()) {
        if (val.unlocked && (!filterGameId || val.gameId === filterGameId)) {
          list.push(val);
        }
      }
      return Object.freeze(list);
    },
    getAll(filterGameId = null) {
      if (!filterGameId) {
        return Object.freeze(Object.fromEntries(localAchievements.entries()));
      }
      const filtered = {};
      for (const [k, v] of localAchievements.entries()) {
        if (v.gameId === filterGameId) {
          filtered[k] = v;
        }
      }
      return Object.freeze(filtered);
    },
    getAllAchievements(filterGameId = null) {
      return this.getAll(filterGameId);
    },
    mergeAchievements(remoteAchievements = {}) {
      const remoteObj = remoteAchievements && typeof remoteAchievements === 'object' ? remoteAchievements : {};
      for (const [id, remoteAch] of Object.entries(remoteObj)) {
        if (!remoteAch) continue;
        const localAch = localAchievements.get(id);
        if (!localAch) {
          localAchievements.set(id, Object.freeze({ ...remoteAch }));
        } else {
          const unlocked = Boolean(localAch.unlocked || remoteAch.unlocked);
          const unlockedAt = (localAch.unlocked && remoteAch.unlocked)
            ? (localAch.unlockedAt < remoteAch.unlockedAt ? localAch.unlockedAt : remoteAch.unlockedAt)
            : (localAch.unlockedAt || remoteAch.unlockedAt);
          const progress = Math.max(localAch.progress || 0, remoteAch.progress || 0);
          const maxProgress = Math.max(localAch.maxProgress || 100, remoteAch.maxProgress || 100);

          localAchievements.set(id, Object.freeze({
            ...localAch,
            ...remoteAch,
            unlocked,
            unlockedAt,
            progress,
            maxProgress
          }));
        }
      }
      persistAchievements();
      return this.getAll();
    },
    reset() {
      localAchievements.clear();
      try {
        lsRemoveRaw(LS_ACHIEVEMENTS_KEY);
      } catch {}
    },
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      achievementListeners.add(listener);
      return () => achievementListeners.delete(listener);
    }
  });

  let activePurchaseProvider = (providers.purchaseProvider && providers.purchaseProvider.providerName !== 'null-purchase')
    ? providers.purchaseProvider
    : createMockPurchaseProvider();

  const purchasesService = Object.freeze({
    isCommercialGateActive() {
      if (typeof activeCommercialGateOverride === 'boolean') {
        return activeCommercialGateOverride;
      }
      return entitlementsService.isCommercialGateActive();
    },
    setCommercialGateActiveForTesting(active) {
      activeCommercialGateOverride = typeof active === 'boolean' ? active : null;
    },
    hasEntitlement(sku) {
      if (!this.isCommercialGateActive()) return true;
      if (activePurchaseProvider && typeof activePurchaseProvider.hasEntitlement === 'function') {
        if (activePurchaseProvider.hasEntitlement(sku)) return true;
      }
      return (
        entitlementsService.hasEntitlement('all', sku) ||
        entitlementsService.hasEntitlement(activeConfig?.gameId || 'all', sku)
      );
    },
    hasAccess(skuOrTier) {
      if (!this.isCommercialGateActive()) return true;
      return this.hasEntitlement(skuOrTier);
    },
    setProvider(provider) {
      activePurchaseProvider = provider || createMockPurchaseProvider();
    },
    getProvider() {
      return activePurchaseProvider;
    },
    async requestPurchase(sku, options = {}) {
      if (!this.isCommercialGateActive()) {
        return Object.freeze({
          ok: true,
          status: 'granted_free_tier',
          sku,
          unlockedAt: getNow().toISOString()
        });
      }
      if (activePurchaseProvider && typeof activePurchaseProvider.purchase === 'function') {
        try {
          return await activePurchaseProvider.purchase(sku, options);
        } catch (err) {
          return Object.freeze({
            ok: false,
            errorCode: 'PURCHASE_ERROR',
            message: err?.message || 'Transaction error.'
          });
        }
      }
      return Object.freeze({
        ok: false,
        errorCode: 'PURCHASE_PROVIDER_UNAVAILABLE',
        message: 'No purchase provider available.'
      });
    },
    async purchase(sku, options = {}) {
      return this.requestPurchase(sku, options);
    },
    async refundPurchase(sku) {
      if (activePurchaseProvider && typeof activePurchaseProvider.refund === 'function') {
        try {
          return await activePurchaseProvider.refund(sku);
        } catch (err) {
          return Object.freeze({ ok: false, errorCode: 'REFUND_ERROR', message: err?.message });
        }
      }
      return Object.freeze({ ok: false, errorCode: 'REFUND_NOT_SUPPORTED' });
    },
    async restorePurchases() {
      if (!this.isCommercialGateActive()) {
        return Object.freeze([]);
      }
      if (activePurchaseProvider && typeof activePurchaseProvider.restorePurchases === 'function') {
        try {
          return await activePurchaseProvider.restorePurchases();
        } catch {
          return Object.freeze([]);
        }
      }
      return Object.freeze([]);
    },
    async verifyEntitlementToken(params) {
      return verifyEd25519EntitlementToken(params);
    },
    getEntitlements() {
      return entitlementsService.getEntitlements();
    }
  });

  // Prime local stores on creation
  loadPersistedLogs();
  loadPersistedConfig();
  loadPersistedTelemetry();
  loadPersistedEntitlements();
  loadPersistedSyncState();
  loadPersistedAchievements();

  // Adapter registry wired to this SDK instance
  const adaptersRegistry = createAdapterRegistry({
    sdkVersion: SDK_VERSION,
    isSdkInitialized: () => initialized,
    getIdentity: () => buildPlayerIdentity(),
    getGuestId: () => (currentGuestRecord ? currentGuestRecord.guestId : null),
    getCapabilities: () => capabilities,
    canPlayGame: (gameId) => accessService.canPlayGame(gameId)
  });

  function registerProviders(nextProviders) {
    if (!nextProviders || typeof nextProviders !== 'object') {
      throw new AuroMindSDKError('INVALID_PROVIDERS', 'registerProviders requires an object.');
    }
    const allowed = [
      'auth',
      'cloudSync',
      'entitlements',
      'analytics',
      'remoteConfig',
      'telemetryTransport',
      'purchaseProvider',
      'accountProvider'
    ];
    for (const key of Object.keys(nextProviders)) {
      if (!allowed.includes(key)) {
        throw new AuroMindSDKError(
          'UNKNOWN_PROVIDER',
          `Unknown provider slot "${key}". Allowed: ${allowed.join(', ')}.`,
          { key }
        );
      }
    }
    providers = {
      ...providers,
      ...nextProviders
    };
  }

  function buildRuntimeContext() {
    return Object.freeze({
      sdkVersion: SDK_VERSION,
      gameId: activeConfig?.gameId || 'portal',
      appVersion: activeConfig?.appVersion || SDK_VERSION,
      initialized,
      capabilities,
      identity: buildPlayerIdentity(),
      storageHealth: identityService.getStorageHealth()
    });
  }

  /**
   * Initializes the AuroMind Shared SDK.
   * Safe to call repeatedly; concurrent calls share a single in-flight promise.
   * If initialization fails/is interrupted, a subsequent call cleanly retries.
   *
   * @param {object} [config]
   * @returns {Promise<object>}
   */
  async function init(config = {}) {
    if (config !== null && typeof config !== 'object') {
      throw new AuroMindSDKError('INVALID_CONFIG', 'AuroMind.init(config) expects an object if provided.');
    }

    if (disposed) {
      disposed = false;
    }

    if (initialized) {
      return buildRuntimeContext();
    }

    if (initPromise) {
      return initPromise;
    }

    const normalizedConfig = Object.freeze({
      gameId: typeof config.gameId === 'string' && config.gameId.trim() ? config.gameId.trim() : 'portal',
      appVersion:
        typeof config.appVersion === 'string' && config.appVersion.trim()
          ? config.appVersion.trim()
          : SDK_VERSION
    });

    const requestedCapabilities = Object.freeze({
      authEnabled: Boolean(config.capabilities?.authEnabled ?? options?.capabilities?.authEnabled),
      cloudSyncEnabled: Boolean(config.capabilities?.cloudSyncEnabled ?? options?.capabilities?.cloudSyncEnabled),
      entitlementsEnabled: Boolean(config.capabilities?.entitlementsEnabled ?? options?.capabilities?.entitlementsEnabled),
      analyticsEnabled: Boolean(config.capabilities?.analyticsEnabled ?? options?.capabilities?.analyticsEnabled),
      remoteConfigEnabled: Boolean(config.capabilities?.remoteConfigEnabled ?? options?.capabilities?.remoteConfigEnabled)
    });

    if (config.providers) {
      registerProviders(config.providers);
    } else if (options && options.providers) {
      registerProviders(options.providers);
    }

    initPromise = (async () => {
      try {
        activeConfig = normalizedConfig;
        capabilities = requestedCapabilities;

        await ensureGuestIdentityInternal();

        // Only query AuthProvider session if explicitly enabled & configured (never in B1 default)
        if (capabilities.authEnabled && providers.auth.isConfigured()) {
          currentAccount = await providers.auth.getCurrentSession();
          if (typeof providers.auth.onAuthStateChange === 'function') {
            if (authUnsubscribe) authUnsubscribe();
            authUnsubscribe = providers.auth.onAuthStateChange((account) => {
              currentAccount = account || null;
              emitIdentityChange();
            });
          }
        } else {
          currentAccount = null;
        }

        initialized = true;
        emitIdentityChange();

        try {
          playerService.updateStats({
            sessionsCount: (playerService.getProfile().stats?.sessionsCount || 0) + 1
          });
        } catch {}

        loggingService.info('platform', `AuroMind Platform SDK initialized for ${normalizedConfig.gameId}`, {
          gameId: normalizedConfig.gameId,
          version: SDK_VERSION,
          guestId: currentGuestRecord ? currentGuestRecord.guestId : null
        });

        // Non-blocking storage persistence registration and quota check (TASK-ID-02)
        void requestStoragePersistence();
        void checkStorageQuota();

        // Drain any peer record that arrived right before `initialized` flipped to true
        if (pendingPeerRecord && !disposed) {
          const bufferedPeer = pendingPeerRecord;
          const bufferedSource = pendingPeerSource;
          pendingPeerRecord = null;
          pendingPeerSource = null;
          void enqueueIdentityOp(() => applyIncomingPeerRecord(bufferedPeer, bufferedSource));
        }

        return buildRuntimeContext();
      } catch (err) {
        // Clear in-flight state cleanly so interrupted initialization can be retried
        initialized = false;
        dispose();
        throw err;
      } finally {
        initPromise = null;
      }
    })();

    return initPromise;
  }

  function dispose() {
    disposed = true;
    initialized = false;
    pendingPeerRecord = null;
    pendingPeerSource = null;

    if (broadcastChannel) {
      try {
        broadcastChannel.onmessage = null;
        if (typeof broadcastChannel.close === 'function') {
          broadcastChannel.close();
        }
      } catch {}
      broadcastChannel = null;
    }

    const win = getWindow();
    if (win && typeof win.removeEventListener === 'function') {
      if (storageEventHandler) {
        try {
          win.removeEventListener('storage', storageEventHandler);
        } catch {}
      }
      if (onlineEventHandler) {
        try {
          win.removeEventListener('online', onlineEventHandler);
        } catch {}
      }
      if (offlineEventHandler) {
        try {
          win.removeEventListener('offline', offlineEventHandler);
        } catch {}
      }
    }
    storageEventHandler = null;
    onlineEventHandler = null;
    offlineEventHandler = null;

    if (authUnsubscribe) {
      try {
        authUnsubscribe();
      } catch {}
      authUnsubscribe = null;
    }

    identityListeners.clear();
    offlineListeners.clear();
    achievementListeners.clear();
    memoryLogBuffer.length = 0;
    memoryTelemetryQueue.length = 0;
  }

  const instance = {
    VERSION: SDK_VERSION,
    init,
    isInitialized: () => initialized,
    getCapabilities: () => capabilities,
    registerProviders,
    dispose,
    identity: identityService,
    adapters: adaptersRegistry,
    saves: adaptersRegistry,
    access: accessService,
    auth: authService,
    storage: storageService,
    sync: syncService,
    logging: loggingService,
    diagnostics: diagnosticsService,
    telemetry: telemetryService,
    analytics: telemetryService,
    config: configService,
    player: playerService,
    profile: playerService,
    entitlements: entitlementsService,
    achievements: achievementsService,
    purchases: purchasesService
  };

  return deepFreeze(instance);
}

// Default browser/module singleton
export const AuroMind = createAuroMindSDK();
export const AuroMindSDK = AuroMind;
export default AuroMind;

// Expose framework-independent global facade in browser environments
if (typeof globalThis.window !== 'undefined') {
  if (!globalThis.window.AuroMind) {
    globalThis.window.AuroMind = AuroMind;
  }
  if (!globalThis.window.AuroMindSDK) {
    globalThis.window.AuroMindSDK = AuroMind;
  }
}
