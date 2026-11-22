/**
 * AuroMind Platform SDK — Entitlement Signing, Rotation & Revocation Engine
 *
 * Implements robust Ed25519 entitlement token lifecycle:
 *   - Key ID (`kid`) header identification
 *   - Dual-key verification during 90-day transition window
 *   - Signed remote configuration distribution
 *   - Emergency key revocation list enforcement
 *   - 30-day offline grace period defense
 */

import crypto from 'node:crypto';

export const OFFLINE_GRACE_MS = 30 * 24 * 60 * 60 * 1000; // 30 calendar days

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
  anchorTimestamp = null
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

  const kid = header.kid;
  if (!kid) {
    return { valid: false, reason: 'KEY_ID_MISSING' };
  }

  // 1. Process emergency revocation list if signed remote config is supplied
  const revokedKeyIds = new Set();
  if (signedRevocationConfig) {
    if (!configRootPublicKey) {
      return { valid: false, reason: 'CONFIG_ROOT_KEY_REQUIRED' };
    }
    // Verify remote config signature
    const isConfigValid = await verifySignedRemoteConfig(signedRevocationConfig, configRootPublicKey);
    if (!isConfigValid) {
      return { valid: false, reason: 'REMOTE_CONFIG_SIGNATURE_INVALID' };
    }
    const configData = JSON.parse(signedRevocationConfig.payloadJson);
    if (Array.isArray(configData.revokedKeyIds)) {
      for (const rk of configData.revokedKeyIds) revokedKeyIds.add(rk);
    }
  }

  // 2. Check if key is revoked
  if (revokedKeyIds.has(kid)) {
    return { valid: false, reason: 'KEY_REVOKED', kid };
  }

  // 3. Resolve public key from keystore (supports dual-key rotation window)
  const publicKey = keyStore.get(kid);
  if (!publicKey) {
    return { valid: false, reason: 'UNKNOWN_KEY_ID', kid };
  }

  // 4. Verify cryptographic Ed25519 signature
  const encoder = new TextEncoder();
  const signingInput = `${b64Header}.${b64Payload}`;
  const sigBytes = Buffer.from(b64Sig, 'base64url');

  const isVerified = await globalThis.crypto.subtle.verify(
    { name: 'Ed25519' },
    publicKey,
    sigBytes,
    encoder.encode(signingInput)
  );

  if (!isVerified) {
    return { valid: false, reason: 'SIGNATURE_INVALID' };
  }

  // 5. Expiration check
  if (payload.exp && currentTimestamp > payload.exp * 1000) {
    return { valid: false, reason: 'TOKEN_EXPIRED', expiredAt: payload.exp };
  }

  // 6. Monotonic clock manipulation defense
  if (anchorTimestamp && currentTimestamp < anchorTimestamp - 60000) {
    return { valid: false, reason: 'CLOCK_ROLLBACK_DETECTED' };
  }

  // 7. 30-day offline grace period
  if (payload.lastValidatedAt) {
    const lastValidatedTime = new Date(payload.lastValidatedAt).getTime();
    if (currentTimestamp - lastValidatedTime > OFFLINE_GRACE_MS) {
      return { valid: false, reason: 'OFFLINE_GRACE_EXCEEDED' };
    }
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
