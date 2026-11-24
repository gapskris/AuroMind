/**
 * AuroMind Platform SDK — Entitlement Signing, Rotation & Revocation Engine
 *
 * Implements robust Ed25519 entitlement token lifecycle:
 *   - Key ID (`kid`) header identification with alg ('EdDSA') and typ ('JWT') enforcement
 *   - Subject (sub) account binding and SKU validation
 *   - Dual-key verification during 90-day transition window
 *   - Signed remote configuration distribution and safe fail-closed revocation lists
 *   - Strict 30-calendar-day (2,592,000,000 ms) offline grace period defense
 *   - Monotonic clock manipulation defenses (rejecting backward rollbacks and forward grace jumps)
 */

import crypto from 'node:crypto';

export const OFFLINE_GRACE_MS = 30 * 24 * 60 * 60 * 1000; // Exact 30 calendar days: 2,592,000,000 ms

/**
 * Mints an Ed25519 entitlement token with a specific `kid`.
 */
export async function mintVersionedEntitlementToken({
  payload,
  privateKey,
  kid = 'auromasti-ed25519-2026-v1'
}) {
  const header = { alg: 'EdDSA', typ: 'JWT', kid };
  const encoder = new TextEncoder();

  const b64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
  const b64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `${b64Header}.${b64Payload}`;

  const signature = await globalThis.crypto.subtle.sign(
    { name: 'Ed25519' },
    privateKey,
    encoder.encode(signingInput)
  );

  const b64Sig = Buffer.from(signature).toString('base64url');
  return `${signingInput}.${b64Sig}`;
}

/**
 * Verifies an entitlement token using a KeyStore and signed revocation list.
 */
export async function verifyVersionedEntitlement({
  token,
  keyStore, // Map of kid -> CryptoKey
  signedRevocationConfig = null,
  configRootPublicKey = null,
  currentTimestamp = Date.now(),
  anchorTimestamp = null,
  requireLastValidatedAt = false,
  expectedSubject = null
}) {
  if (!token || typeof token !== 'string') {
    return { valid: false, reason: 'TOKEN_MISSING' };
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return { valid: false, reason: 'TOKEN_MALFORMED' };
  }

  const [b64Header, b64Payload, b64Sig] = parts;
  let header, payload;
  try {
    header = JSON.parse(Buffer.from(b64Header, 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(b64Payload, 'base64url').toString('utf8'));
  } catch {
    return { valid: false, reason: 'TOKEN_DECODE_FAILED' };
  }

  // 1. Validate Header Structure and Algorithm
  if (!header || typeof header !== 'object') {
    return { valid: false, reason: 'HEADER_INVALID' };
  }
  if (header.alg !== 'EdDSA') {
    return { valid: false, reason: 'UNSUPPORTED_ALGORITHM', alg: header.alg };
  }
  if (header.typ !== 'JWT') {
    return { valid: false, reason: 'UNSUPPORTED_TOKEN_TYPE', typ: header.typ };
  }
  const kid = header.kid;
  if (!kid || typeof kid !== 'string' || kid.trim() === '') {
    return { valid: false, reason: 'KEY_ID_MISSING' };
  }

  // 2. Validate Payload Structure & Subject Binding
  if (!payload || typeof payload !== 'object') {
    return { valid: false, reason: 'PAYLOAD_INVALID' };
  }
  if (expectedSubject && payload.sub !== expectedSubject) {
    return { valid: false, reason: 'SUBJECT_MISMATCH', expected: expectedSubject, actual: payload.sub };
  }

  // 3. Process emergency revocation list if signed remote config is supplied (Fail-Closed)
  const revokedKeyIds = new Set();
  if (signedRevocationConfig) {
    if (!configRootPublicKey) {
      return { valid: false, reason: 'CONFIG_ROOT_KEY_REQUIRED' };
    }
    if (typeof signedRevocationConfig !== 'object' || !signedRevocationConfig.payloadJson || !signedRevocationConfig.signatureB64Url) {
      return { valid: false, reason: 'REVOCATION_CONFIG_MALFORMED' };
    }

    const isConfigValid = await verifySignedRemoteConfig(signedRevocationConfig, configRootPublicKey);
    if (!isConfigValid) {
      return { valid: false, reason: 'REMOTE_CONFIG_SIGNATURE_INVALID' };
    }

    try {
      const configData = JSON.parse(signedRevocationConfig.payloadJson);
      if (Array.isArray(configData.revokedKeyIds)) {
        for (const rk of configData.revokedKeyIds) {
          if (typeof rk === 'string') revokedKeyIds.add(rk);
        }
      }
    } catch {
      return { valid: false, reason: 'REVOCATION_CONFIG_MALFORMED' };
    }
  }

  // 4. Check if key is revoked
  if (revokedKeyIds.has(kid)) {
    return { valid: false, reason: 'KEY_REVOKED', kid };
  }

  // 5. Resolve public key from keystore (supports dual-key rotation window)
  if (!keyStore || typeof keyStore.get !== 'function') {
    return { valid: false, reason: 'KEYSTORE_INVALID' };
  }
  const publicKey = keyStore.get(kid);
  if (!publicKey) {
    return { valid: false, reason: 'UNKNOWN_KEY_ID', kid };
  }

  // 6. Verify cryptographic Ed25519 signature
  const encoder = new TextEncoder();
  const signingInput = `${b64Header}.${b64Payload}`;
  let sigBytes;
  try {
    sigBytes = Buffer.from(b64Sig, 'base64url');
  } catch {
    return { valid: false, reason: 'SIGNATURE_INVALID' };
  }

  try {
    const isVerified = await globalThis.crypto.subtle.verify(
      { name: 'Ed25519' },
      publicKey,
      sigBytes,
      encoder.encode(signingInput)
    );
    if (!isVerified) {
      return { valid: false, reason: 'SIGNATURE_INVALID' };
    }
  } catch {
    return { valid: false, reason: 'SIGNATURE_INVALID' };
  }

  // 7. Expiry Policy Validation (missing expiry must NOT silently create indefinitely valid token unless LIFETIME)
  const isLifetime = payload.tier === 'LIFETIME' || payload.unlimited === true;
  if (!isLifetime) {
    if (payload.exp === undefined || payload.exp === null) {
      return { valid: false, reason: 'TOKEN_EXPIRY_REQUIRED' };
    }
    const expVal = Number(payload.exp);
    if (!Number.isFinite(expVal) || expVal <= 0) {
      return { valid: false, reason: 'INVALID_EXPIRATION_TIMESTAMP' };
    }
    const expMs = expVal > 1e11 ? expVal : expVal * 1000;
    if (currentTimestamp > expMs) {
      return { valid: false, reason: 'TOKEN_EXPIRED', expiredAt: payload.exp };
    }
  } else if (payload.exp !== undefined && payload.exp !== null) {
    const expVal = Number(payload.exp);
    if (!Number.isFinite(expVal)) {
      return { valid: false, reason: 'INVALID_EXPIRATION_TIMESTAMP' };
    }
    const expMs = expVal > 1e11 ? expVal : expVal * 1000;
    if (currentTimestamp > expMs) {
      return { valid: false, reason: 'TOKEN_EXPIRED', expiredAt: payload.exp };
    }
  }

  // 8. Monotonic clock manipulation defense (anchor timestamp)
  if (anchorTimestamp !== null && anchorTimestamp !== undefined) {
    const anchorMs = Number(anchorTimestamp);
    if (!Number.isFinite(anchorMs)) {
      return { valid: false, reason: 'INVALID_ANCHOR_TIMESTAMP' };
    }
    if (currentTimestamp < anchorMs - 60000) {
      return { valid: false, reason: 'CLOCK_ROLLBACK_DETECTED' };
    }
  }

  // 9. Validation Timestamp & 30-Day Offline Grace Period
  if (payload.lastValidatedAt !== undefined && payload.lastValidatedAt !== null) {
    const lastValidatedTime = new Date(payload.lastValidatedAt).getTime();
    if (!Number.isFinite(lastValidatedTime)) {
      return { valid: false, reason: 'INVALID_VALIDATION_TIMESTAMP' };
    }
    // Backward clock manipulation behind lastValidatedAt
    if (currentTimestamp < lastValidatedTime - 60000) {
      return { valid: false, reason: 'CLOCK_ROLLBACK_DETECTED' };
    }
    // Forward grace boundary (exact 2,592,000,000 ms)
    if (currentTimestamp - lastValidatedTime > OFFLINE_GRACE_MS) {
      return { valid: false, reason: 'OFFLINE_GRACE_EXCEEDED' };
    }
  } else if (requireLastValidatedAt) {
    return { valid: false, reason: 'MISSING_VALIDATION_TIMESTAMP' };
  }

  return {
    valid: true,
    kid,
    payload
  };
}

/**
 * Helper to verify signed remote config payload.
 */
export async function verifySignedRemoteConfig({ payloadJson, signatureB64Url }, rootPublicKey) {
  if (!payloadJson || !signatureB64Url || !rootPublicKey) {
    return false;
  }
  try {
    const encoder = new TextEncoder();
    const sigBytes = Buffer.from(signatureB64Url, 'base64url');
    return await globalThis.crypto.subtle.verify(
      { name: 'Ed25519' },
      rootPublicKey,
      sigBytes,
      encoder.encode(payloadJson)
    );
  } catch {
    return false;
  }
}
