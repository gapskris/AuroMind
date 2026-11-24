/**
 * B19.5-08 — Telemetry and Operations Behavioral Test Suite
 *
 * Validates:
 * 1. Server-side event schema validation & allowlist enforcement.
 * 2. Identity context protection (user-supplied fields cannot override trusted auth context).
 * 3. Sacred privacy boundaries: Sankalpa, tokens, passwords, raw audio, artwork data, save payloads stripped.
 * 4. Token-bucket parameter validation: NULL, NaN, Infinity, negative, and out-of-bounds rejection.
 * 5. Continuous token replenishment, burst capacity limits, and deterministic rate-limiting.
 * 6. Retention & rollups: 30-day raw retention cutoff and daily rollup metrics.
 * 7. Non-blocking telemetry: network/telemetry failure never blocks core offline gameplay or saves.
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  handleTelemetryIngestRequest,
  deriveClientIdentifier,
  MemoryRateLimitStore,
  ALLOWLISTED_EVENT_NAMES,
  FORBIDDEN_KEY_PATTERN
} from './supabase/functions/ingest-telemetry/telemetry-handler.js';
import {
  computeDailyAggregates,
  pruneTelemetryEventsInMemory,
  MIN_RETENTION_DAYS,
  DEFAULT_RETENTION_DAYS
} from './supabase/functions/cleanup-telemetry/retention-handler.js';
import {
  DistributedTokenBucketEngine,
  DEFAULT_CAPACITY,
  DEFAULT_FILL_RATE
} from './assets/sdk/telemetry-token-bucket.js';
import {
  createAuroMindSDK,
  sanitizeTelemetryPayload
} from './assets/sdk/auromind-sdk.js';

describe('B19.5-08: Telemetry Security & Event Schema Validation', () => {

  test('8.1: Server-side ingest enforces allowlisted event names and valid categories', async () => {
    const store = new MemoryRateLimitStore();

    // 1. Valid allowlisted event passes
    const validReq = new Request('http://localhost/functions/v1/ingest-telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '1.2.3.4' },
      body: JSON.stringify({
        events: [{
          eventId: '11111111-1111-4111-8111-111111111111',
          eventName: 'level_completed',
          category: 'progression',
          payload: { level: 5, score: 1200 }
        }]
      })
    });

    const validRes = await handleTelemetryIngestRequest(validReq, { rateLimitStore: store, enforceAllowlist: true });
    assert.equal(validRes.status, 200);
    const validData = await validRes.json();
    assert.equal(validData.ok, true);
    assert.equal(validData.count, 1);
    assert.equal(validData.skipped, 0);

    // 2. Unallowlisted event name is skipped
    const invalidReq = new Request('http://localhost/functions/v1/ingest-telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '1.2.3.4' },
      body: JSON.stringify({
        events: [{
          eventId: '22222222-2222-4222-8222-222222222222',
          eventName: 'arbitrary_injected_event_name',
          category: 'progression',
          payload: { foo: 'bar' }
        }]
      })
    });

    const invalidRes = await handleTelemetryIngestRequest(invalidReq, { rateLimitStore: store, enforceAllowlist: true });
    assert.equal(invalidRes.status, 200);
    const invalidData = await invalidRes.json();
    assert.equal(invalidData.count, 0);
    assert.equal(invalidData.skipped, 1);
  });

  test('8.2: Trusted server boundary defends against user-supplied identity spoofing', async () => {
    const store = new MemoryRateLimitStore();

    // Untrusted request attempts to supply a spoofed userId
    const spoofReq = new Request('http://localhost/functions/v1/ingest-telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '5.6.7.8' },
      body: JSON.stringify({
        events: [{
          eventId: '33333333-3333-4333-8333-333333333333',
          eventName: 'level_completed',
          category: 'progression',
          userId: 'spoofed_victim_uuid',
          payload: { score: 999 }
        }]
      })
    });

    // Simulated handler with authoritative token for 'authoritative_alice'
    let insertedRecords = [];
    const mockSupabase = {
      from: () => ({
        upsert: async (records) => {
          insertedRecords = records;
          return { error: null };
        }
      })
    };

    const res = await handleTelemetryIngestRequest(spoofReq, {
      rateLimitStore: store,
      supabaseClient: mockSupabase,
      authenticatedUserId: 'authoritative_alice'
    });

    assert.equal(res.status, 200);
    assert.equal(insertedRecords.length, 1);
    assert.equal(insertedRecords[0].user_id, 'authoritative_alice', 'Authoritative server identity must override client spoofing');
  });

  test('8.3: Sacred privacy filter strips Sankalpa, tokens, passwords, raw audio, and artwork content', async () => {
    const store = new MemoryRateLimitStore();

    let insertedRecords = [];
    const mockSupabase = {
      from: () => ({
        upsert: async (records) => {
          insertedRecords = records;
          return { error: null };
        }
      })
    };

    const hostileReq = new Request('http://localhost/functions/v1/ingest-telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '9.9.9.9' },
      body: JSON.stringify({
        events: [{
          eventId: '44444444-4444-4444-8444-444444444444',
          eventName: 'save_corruption_detected',
          category: 'error',
          payload: {
            safeMetric: 42,
            sankalpa_reflections: 'private intention',
            vaultPassword: 'secret_passphrase_123',
            access_token: 'bearer_token_xyz',
            audio_blob: [1, 2, 3],
            canvas_strokes: 'stroke_data',
            artwork_data: 'raw_pixels',
            save_payload: { fullSave: true }
          }
        }]
      })
    });

    const res = await handleTelemetryIngestRequest(hostileReq, {
      rateLimitStore: store,
      supabaseClient: mockSupabase
    });

    assert.equal(res.status, 200);
    assert.equal(insertedRecords.length, 1);
    const p = insertedRecords[0].payload;
    assert.equal(p.safeMetric, 42);
    assert.equal(p.sankalpa_reflections, undefined);
    assert.equal(p.vaultPassword, undefined);
    assert.equal(p.access_token, undefined);
    assert.equal(p.audio_blob, undefined);
    assert.equal(p.canvas_strokes, undefined);
    assert.equal(p.artwork_data, undefined);
    assert.equal(p.save_payload, undefined);
  });

  test('8.4: Non-finite numeric inputs (NaN, Infinity, -Infinity) are rejected from payloads', async () => {
    const rawHostile = {
      finiteVal: 100,
      nanVal: NaN,
      infVal: Infinity,
      negInfVal: -Infinity
    };

    const sanitized = sanitizeTelemetryPayload(rawHostile);
    assert.equal(sanitized.finiteVal, 100);
    assert.equal(sanitized.nanVal, undefined);
    assert.equal(sanitized.infVal, undefined);
    assert.equal(sanitized.negInfVal, undefined);
  });

});

describe('B19.5-08: Token-Bucket Engine & Rate Limiting Hardening', () => {

  test('8.5: Engine enforces strict parameter validation and rejects NaN, Infinity, and out-of-bounds', async () => {
    // 1. NaN capacity
    const nanEngine = new DistributedTokenBucketEngine({ capacity: NaN, fillRate: 1.0 });
    const r1 = await nanEngine.consume('abcdef');
    assert.equal(r1.allowed, false);
    assert.equal(r1.code, 'ERR_NON_FINITE_NUMERIC_PARAMETER');

    // 2. Infinity fill rate
    const infEngine = new DistributedTokenBucketEngine({ capacity: 60.0, fillRate: Infinity });
    const r2 = await infEngine.consume('abcdef');
    assert.equal(r2.allowed, false);
    assert.equal(r2.code, 'ERR_NON_FINITE_NUMERIC_PARAMETER');

    // 3. Out-of-bounds capacity (< 1.0)
    const lowCap = new DistributedTokenBucketEngine({ capacity: 0.5, fillRate: 1.0 });
    const r3 = await lowCap.consume('abcdef');
    assert.equal(r3.allowed, false);
    assert.equal(r3.code, 'ERR_CAPACITY_OUT_OF_BOUNDS');

    // 4. Out-of-bounds capacity (> 1000.0)
    const highCap = new DistributedTokenBucketEngine({ capacity: 5000.0, fillRate: 1.0 });
    const r4 = await highCap.consume('abcdef');
    assert.equal(r4.allowed, false);
    assert.equal(r4.code, 'ERR_CAPACITY_OUT_OF_BOUNDS');

    // 5. Out-of-bounds fillRate (< 0.01)
    const lowRate = new DistributedTokenBucketEngine({ capacity: 60.0, fillRate: 0.001 });
    const r5 = await lowRate.consume('abcdef');
    assert.equal(r5.allowed, false);
    assert.equal(r5.code, 'ERR_FILL_RATE_OUT_OF_BOUNDS');

    // 6. Empty / NULL IP hash
    const normalEngine = new DistributedTokenBucketEngine();
    const r6 = await normalEngine.consume('');
    assert.equal(r6.allowed, false);
    assert.equal(r6.code, 'ERR_EMPTY_OR_NULL_IP_HASH');

    // 7. Oversized IP hash (> 64 bytes / 128 hex chars)
    const r7 = await normalEngine.consume('a'.repeat(130));
    assert.equal(r7.allowed, false);
    assert.equal(r7.code, 'ERR_IP_HASH_EXCEEDS_MAX_LENGTH');
  });

  test('8.6: Continuous token replenishment and burst capacity enforcement', async () => {
    const engine = new DistributedTokenBucketEngine({ capacity: 5.0, fillRate: 1.0 });
    const key = 'test_client_key_1';
    const t0 = 1000000;

    // Burst 5 tokens
    for (let i = 0; i < 5; i++) {
      const res = await engine.consume(key, t0);
      assert.equal(res.allowed, true, `Burst token ${i} should be allowed`);
    }

    // 6th immediate token must be blocked (burst exhausted)
    const blocked = await engine.consume(key, t0);
    assert.equal(blocked.allowed, false, 'Exhausted bucket must reject next request');

    // After 2.5 seconds: 2 tokens should have replenished
    const t1 = t0 + 2500;
    const r1 = await engine.consume(key, t1);
    assert.equal(r1.allowed, true);
    const r2 = await engine.consume(key, t1);
    assert.equal(r2.allowed, true);
    const r3 = await engine.consume(key, t1);
    assert.equal(r3.allowed, false, 'Third token should exceed replenished amount');
  });

  test('8.7: MemoryRateLimitStore rejects non-finite or non-positive window parameters', async () => {
    const store = new MemoryRateLimitStore();
    const badCheck = await store.checkRateLimit('client_a', NaN, 60);
    assert.equal(badCheck.allowed, false);
    assert.equal(badCheck.error, 'INVALID_PARAMETERS');

    const zeroCheck = await store.checkRateLimit('client_a', 30, -5);
    assert.equal(zeroCheck.allowed, false);
    assert.equal(zeroCheck.error, 'INVALID_PARAMETERS');
  });

});

describe('B19.5-08: Retention, Operations & Non-Blocking Gameplay', () => {

  test('8.8: 30-day raw telemetry retention policy and daily rollup aggregation', () => {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    const mockEvents = [
      { eventId: '1', received_at: new Date(now - 35 * dayMs).toISOString(), eventName: 'level_completed', gameId: 'vak', category: 'progression', guestId: 'g1', sessionId: 's1' },
      { eventId: '2', received_at: new Date(now - 31 * dayMs).toISOString(), eventName: 'level_completed', gameId: 'vak', category: 'progression', guestId: 'g2', sessionId: 's2' },
      { eventId: '3', received_at: new Date(now - 10 * dayMs).toISOString(), eventName: 'level_completed', gameId: 'vak', category: 'progression', guestId: 'g3', sessionId: 's3' },
      { eventId: '4', received_at: new Date(now).toISOString(), eventName: 'level_completed', gameId: 'vak', category: 'progression', guestId: 'g4', sessionId: 's4' }
    ];

    // Compute rollups before deletion
    const aggregates = computeDailyAggregates(mockEvents);
    assert.ok(Array.isArray(aggregates) && aggregates.length > 0, 'Daily aggregates must compute before pruning');

    // Prune with 30-day retention
    const { retained, deletedCount } = pruneTelemetryEventsInMemory(mockEvents, { retentionDays: 30, now });
    assert.equal(deletedCount, 2, 'Events older than 30 days must be purged');
    assert.equal(retained.length, 2, 'Events within 30 days must be retained');
  });

  test('8.9: Telemetry transport failures never throw or block gameplay and save operations', () => {
    const store = new Map();
    const sdk = createAuroMindSDK({
      env: {
        localStorage: {
          getItem: (k) => store.get(k) ?? null,
          setItem: (k, v) => store.set(k, String(v)),
          removeItem: (k) => store.delete(k),
          clear: () => store.clear()
        },
        BroadcastChannel: null
      }
    });

    // Tracking with invalid inputs or broken network must never throw
    assert.doesNotThrow(() => {
      sdk.telemetry.track(null);
      sdk.telemetry.track('level_completed', { score: 100 });
      sdk.telemetry.track('unknown_event', { circular: {} });
    });

    sdk.dispose();
  });

});
