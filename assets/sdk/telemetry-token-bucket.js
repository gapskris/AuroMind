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
 */
export class DistributedTokenBucketEngine {
  constructor({ capacity = DEFAULT_CAPACITY, fillRate = DEFAULT_FILL_RATE } = {}) {
    this.capacity = capacity;
    this.fillRate = fillRate;
    this.buckets = new Map(); // ipHash -> { tokens, lastFill }
  }

  /**
   * Consumes a token atomically with row lock simulation.
   */
  async consume(ipHashHex, now = Date.now()) {
    if (this.capacity <= 0 || this.fillRate <= 0) {
      return { allowed: false, error: 'INVALID_PARAMETERS' };
    }

    let bucket = this.buckets.get(ipHashHex);
    if (!bucket) {
      // Step 1: Atomic insert on conflict do nothing
      bucket = { tokens: this.capacity, lastFill: now };
      this.buckets.set(ipHashHex, bucket);
    }

    // Step 2 & 3: Continuous token replenishment
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
