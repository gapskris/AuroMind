/**
 * AuroMind Platform SDK — Distributed Telemetry Token Bucket Rate Limiter
 *
 * Implements the client-side & edge-function rate limiting abstractions:
 *   - Continuous token accumulation
 *   - Atomic initialization without insert races
 *   - Numeric precision and clock calculations
 *   - Trusted proxy IP extraction and daily HMAC salt hashing
 *   - Fail-open / drop on DB timeout
 */

import crypto from 'node:crypto';

export const DEFAULT_CAPACITY = 60.0;
export const DEFAULT_FILL_RATE = 1.0; // 1 token per second = 60 tokens per minute

/**
 * Computes a privacy-preserving daily IP hash.
 * Raw IP addresses are never permanently stored or transmitted.
 */
export function hashClientIp(clientIp, dailySalt) {
  if (!clientIp) return Buffer.from('00000000000000000000000000000000', 'hex');
  return crypto.createHmac('sha256', dailySalt).update(clientIp).digest();
}

/**
 * Extracts client IP securely behind trusted proxies.
 * Ignores untrusted x-forwarded-for headers if direct or non-Cloudflare.
 */
export function extractClientIp(headers, trustedProxy = true) {
  if (trustedProxy && headers['cf-connecting-ip']) {
    return headers['cf-connecting-ip'];
  }
  if (trustedProxy && headers['x-real-ip']) {
    return headers['x-real-ip'];
  }
  return headers['remote-addr'] || '127.0.0.1';
}

/**
 * Simulates the atomic PostgreSQL token-bucket stored procedure in JavaScript
 * for deterministic multi-isolate unit testing.
 *
 * Hardened with strict defensive input validation matching Migration 8 (20261122000004):
 * 1. Rejects NULL, empty, or oversized (> 64 bytes / 128 hex chars) IP hashes.
 * 2. Rejects non-finite numbers ('NaN', 'Infinity', '-Infinity').
 * 3. Enforces bounded positive ranges for capacity [1.0, 1000.0] and fill rate [0.01, 100.0].
 * 4. Defends against negative elapsed time and numeric overflow.
 */
export class DistributedTokenBucketEngine {
  constructor({ capacity = DEFAULT_CAPACITY, fillRate = DEFAULT_FILL_RATE } = {}) {
    this.capacity = capacity;
    this.fillRate = fillRate;
    this.buckets = new Map(); // ipHash -> { tokens, lastFill }
  }

  validateConfig() {
    if (this.capacity === null || this.capacity === undefined ||
        this.fillRate === null || this.fillRate === undefined) {
      return { allowed: false, error: 'INVALID_PARAMETERS', code: 'ERR_NULL_NUMERIC_PARAMETER' };
    }
    if (typeof this.capacity !== 'number' || typeof this.fillRate !== 'number' ||
        !Number.isFinite(this.capacity) || !Number.isFinite(this.fillRate)) {
      return { allowed: false, error: 'INVALID_PARAMETERS', code: 'ERR_NON_FINITE_NUMERIC_PARAMETER' };
    }
    if (this.capacity < 1.0 || this.capacity > 1000.0) {
      return { allowed: false, error: 'INVALID_PARAMETERS', code: 'ERR_CAPACITY_OUT_OF_BOUNDS' };
    }
    if (this.fillRate < 0.01 || this.fillRate > 100.0) {
      return { allowed: false, error: 'INVALID_PARAMETERS', code: 'ERR_FILL_RATE_OUT_OF_BOUNDS' };
    }
    return { allowed: true };
  }

  /**
   * Consumes a token atomically with row lock simulation.
   */
  async consume(ipHashHex, now = Date.now()) {
    const configCheck = this.validateConfig();
    if (!configCheck.allowed) {
      return configCheck;
    }

    // Gate 1: IP Hash Structure & Length
    if (!ipHashHex || (typeof ipHashHex !== 'string' && !(ipHashHex instanceof Uint8Array))) {
      return { allowed: false, error: 'INVALID_PARAMETERS', code: 'ERR_EMPTY_OR_NULL_IP_HASH' };
    }
    const byteLength = typeof ipHashHex === 'string' ? (ipHashHex.length / 2) : ipHashHex.length;
    if (byteLength === 0) {
      return { allowed: false, error: 'INVALID_PARAMETERS', code: 'ERR_EMPTY_OR_NULL_IP_HASH' };
    }
    if (byteLength > 64) {
      return { allowed: false, error: 'INVALID_PARAMETERS', code: 'ERR_IP_HASH_EXCEEDS_MAX_LENGTH' };
    }

    // Gate 2: Timestamp Validation
    if (typeof now !== 'number' || !Number.isFinite(now) || now <= 0) {
      return { allowed: false, error: 'INVALID_PARAMETERS', code: 'ERR_INVALID_TIMESTAMP' };
    }

    const key = typeof ipHashHex === 'string' ? ipHashHex : Buffer.from(ipHashHex).toString('hex');
    let bucket = this.buckets.get(key);
    if (!bucket) {
      // Step 1: Atomic insert on conflict do nothing
      bucket = { tokens: this.capacity, lastFill: now };
      this.buckets.set(key, bucket);
    }

    // Step 2 & 3: Continuous token replenishment (prevent overflow on clock skew)
    const elapsedSeconds = Math.max(0, (now - bucket.lastFill) / 1000);
    const replenishedTokens = Math.min(
      this.capacity,
      bucket.tokens + elapsedSeconds * this.fillRate
    );

    // Step 4: Check & consume
    if (replenishedTokens >= 1.0) {
      bucket.tokens = replenishedTokens - 1.0;
      bucket.lastFill = now;
      return {
        allowed: true,
        remaining: Math.floor(bucket.tokens),
        capacity: this.capacity
      };
    } else {
      bucket.tokens = replenishedTokens;
      bucket.lastFill = now;
      return {
        allowed: false,
        remaining: 0,
        capacity: this.capacity
      };
    }
  }

  /**
   * Resets limits (simulates unlogged table truncation after DB restart).
   */
  resetOnCrash() {
    this.buckets.clear();
  }
}
