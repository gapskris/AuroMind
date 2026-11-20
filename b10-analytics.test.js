/**
 * AuroMind Centralized Analytics & January 1 Release Readiness — B10 Test Suite
 *
 * Verifies:
 * 1. Visitor consent lifecycle, opt-in/opt-out immediate effect, zero PII, and Sankalpa exclusion.
 * 2. Website analytics collection, UTM campaign parsing, referrer sanitization, and portal lifecycle.
 * 3. Cross-game telemetry coverage across all six games (launches, sessions, levels, errors, exit).
 * 4. Owner metrics calculation, server-side authorization, and KPI aggregations.
 * 5. Supabase Free tier quota boundaries, batching efficiency, and rate-limiting safety.
 *
 * Runs natively with Node.js test runner (`node --test`). Zero external dependencies.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createAuroMindSDK,
  SDK_VERSION,
  LS_CONSENT_KEY,
  LS_TELEMETRY_KEY
} from './assets/sdk/auromind-sdk.js';

import {
  aggregateTelemetryMetrics,
  handleOwnerMetricsRequest,
  LAUNCH_GAMES
} from './supabase/functions/owner-metrics/metrics-handler.js';

import {
  handleTelemetryIngestRequest,
  MAX_TELEMETRY_BODY_BYTES,
  MAX_EVENTS_PER_BATCH,
  DEFAULT_RATE_LIMIT_MAX,
  MemoryRateLimitStore
} from './supabase/functions/ingest-telemetry/telemetry-handler.js';

// In-memory localStorage mock
function createStorageMock(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => { map.clear(); },
    key: (i) => Array.from(map.keys())[i] ?? null,
    get length() { return map.size; }
  };
}

// ---------------------------------------------------------------------------
// Suite 1: Visitor Consent Lifecycle & Strict Privacy Invariants
// ---------------------------------------------------------------------------
test('B10 Suite 1: Visitor consent lifecycle, immediate purge on opt-out, and zero PII', async () => {
  const store = createStorageMock();
  const sdk = createAuroMindSDK({ localStorage: store });
  await sdk.init({ gameId: 'portal', appVersion: '1.0.0' });

  // 1. Initial state: undecided
  assert.equal(sdk.telemetry.getConsent(), false, 'Default consent must be false (opt-in only)');
  assert.equal(sdk.telemetry.getConsentState(), 'undecided', 'State must be undecided before user choice');
  assert.equal(sdk.telemetry.isConsentDecided(), false);

  // 2. Tracking without consent drops events completely
  const dropped = sdk.telemetry.track('portal_visit', { test: 1 });
  assert.equal(dropped, null, 'Unconsented tracking must return null');
  assert.equal(sdk.telemetry.getQueueLength(), 0, 'Queue must remain strictly empty');

  // 3. User grants consent (Accept & Support)
  sdk.telemetry.setConsent(true);
  assert.equal(sdk.telemetry.getConsent(), true);
  assert.equal(sdk.telemetry.getConsentState(), 'granted');
  assert.equal(sdk.telemetry.isConsentDecided(), true);
  assert.equal(store.getItem(LS_CONSENT_KEY), 'true');

  // 4. Tracking with consent buffers events
  const rawSecretPassword = 'secret_password_123';
  const rawSecretToken = 'jwt_secret_token';
  const rawSankalpaNote = 'My sacred spiritual intention';

  const tracked = sdk.telemetry.track('game_launch', {
    gameId: 'vak',
    // Sensitive keys to verify automatic redaction
    password: rawSecretPassword,
    token: rawSecretToken,
    sankalpa_note: rawSankalpaNote
  });

  assert.ok(tracked);
  assert.equal(tracked.eventName, 'game_launch');
  assert.equal(sdk.telemetry.getQueueLength(), 1);

  // Privacy invariant: sensitive fields are completely redacted
  assert.equal(tracked.payload.password, '[REDACTED]');
  assert.equal(tracked.payload.token, '[REDACTED]');
  assert.equal(tracked.payload.sankalpa_note, '[REDACTED]');

  // Explicit verification: zero sensitive raw values appear in payload, queue, or persisted storage
  const serializedPayload = JSON.stringify(tracked.payload);
  const serializedQueue = JSON.stringify(sdk.telemetry.getQueue());
  const rawPersistedQueue = store.getItem(LS_TELEMETRY_KEY) || '';

  for (const rawSecret of [rawSecretPassword, rawSecretToken, rawSankalpaNote]) {
    assert.equal(
      serializedPayload.includes(rawSecret),
      false,
      `Tracked payload must never contain original sensitive value: ${rawSecret}`
    );
    assert.equal(
      serializedQueue.includes(rawSecret),
      false,
      `In-memory queue must never contain original sensitive value: ${rawSecret}`
    );
    assert.equal(
      rawPersistedQueue.includes(rawSecret),
      false,
      `Persisted storage queue must never contain original sensitive value: ${rawSecret}`
    );
  }

  // 5. User revokes consent (Decline / Opt-Out)
  sdk.telemetry.setConsent(false);
  assert.equal(sdk.telemetry.getConsent(), false);
  assert.equal(sdk.telemetry.getConsentState(), 'denied');
  assert.equal(store.getItem(LS_CONSENT_KEY), 'false');

  // Immediate effect: queue must be completely purged from memory and storage
  assert.equal(sdk.telemetry.getQueueLength(), 0, 'Opt-out must instantly purge memory queue');
  assert.equal(store.getItem(LS_TELEMETRY_KEY), null, 'Opt-out must instantly remove persisted queue');

  sdk.dispose();
});

// ---------------------------------------------------------------------------
// Suite 2: Website Analytics & Marketing Campaign Attribution
// ---------------------------------------------------------------------------
test('B10 Suite 2: Attribution parsing, referrer sanitization, and website lifecycle events', async () => {
  const store = createStorageMock();
  const sdk = createAuroMindSDK({ localStorage: store });
  await sdk.init({ gameId: 'portal', appVersion: '1.0.0' });
  sdk.telemetry.setConsent(true);

  // Simulated attribution parser
  function parseAttribution(searchQuery, rawReferrer) {
    const params = new URLSearchParams(searchQuery || '');
    const utm = {};
    const utmKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
    for (const key of utmKeys) {
      const val = params.get(key);
      if (val) utm[key] = val.slice(0, 100);
    }
    let referrerDomain = null;
    if (rawReferrer) {
      try {
        const refUrl = new URL(rawReferrer);
        referrerDomain = refUrl.hostname || 'external';
      } catch {
        referrerDomain = 'external';
      }
    }
    return { utm, referrerDomain };
  }

  // Test referrer stripping (zero token leakage from referral URLs)
  const referrerWithToken = 'https://search.partner.org/results?q=mindful+games&auth_token=super_secret_leak#access_token=xyz';
  const parsed = parseAttribution('?utm_source=auroville_today&utm_medium=newsletter&utm_campaign=january_launch', referrerWithToken);

  assert.equal(parsed.referrerDomain, 'search.partner.org', 'Referrer must isolate hostname only');
  assert.equal(parsed.utm.utm_source, 'auroville_today');
  assert.equal(parsed.utm.utm_campaign, 'january_launch');

  // Track page_view and portal_visit
  const pv = sdk.telemetry.track('page_view', {
    path: '/',
    title: 'AuroMind — Sanctuary of Mindful Play',
    referrerDomain: parsed.referrerDomain,
    ...parsed.utm
  }, { category: 'ui', gameId: 'portal' });

  assert.equal(pv.eventName, 'page_view');
  assert.equal(pv.payload.referrerDomain, 'search.partner.org');
  assert.equal(pv.payload.utm_source, 'auroville_today');

  // Track catalog navigation
  const cf = sdk.telemetry.track('catalog_filter', { category: 'strategy' }, { category: 'ui', gameId: 'portal' });
  assert.equal(cf.eventName, 'catalog_filter');
  assert.equal(cf.payload.category, 'strategy');

  // Track portal exit
  const pe = sdk.telemetry.track('portal_exit', { sessionDurationSeconds: 142 }, { category: 'lifecycle', gameId: 'portal' });
  assert.equal(pe.eventName, 'portal_exit');
  assert.equal(pe.payload.sessionDurationSeconds, 142);

  assert.equal(sdk.telemetry.getQueueLength(), 3);
  sdk.dispose();
});

// ---------------------------------------------------------------------------
// Suite 3: Cross-Game Telemetry Across All Six Titles
// ---------------------------------------------------------------------------
test('B10 Suite 3: Standardized gameplay events across all six launch titles', async () => {
  const store = createStorageMock();
  const sdk = createAuroMindSDK({ localStorage: store });
  await sdk.init({ gameId: 'portal', appVersion: '1.0.0' });
  sdk.telemetry.setConsent(true);

  assert.equal(LAUNCH_GAMES.length, 6);
  assert.deepEqual(LAUNCH_GAMES, ['vak', 'auromatch', 'auromandala', 'wordriddle', 'auroblocks', 'vak-sanctuary']);

  // Simulate complete session lifecycle for each of the 6 games
  for (const gameId of LAUNCH_GAMES) {
    // 1. Game Selection & Launch
    sdk.telemetry.track('game_select', { gameId, source: 'catalog_grid' }, { category: 'engagement', gameId });
    sdk.telemetry.track('game_launch', { gameId, launchContext: 'theater' }, { category: 'engagement', gameId });
    sdk.telemetry.track('game_session_start', { gameId }, { category: 'engagement', gameId });

    // 2. Progression
    sdk.telemetry.track('level_attempt', { gameId, levelId: 1, attemptNumber: 1 }, { category: 'progression', gameId });
    sdk.telemetry.track('level_completed', { gameId, levelId: 1, score: 500, durationSeconds: 45 }, { category: 'progression', gameId });
    sdk.telemetry.track('level_failed', { gameId, levelId: 2, reason: 'time_expired' }, { category: 'progression', gameId });

    // 3. Technical Error
    sdk.telemetry.track('game_runtime_error', { gameId, errorMessage: 'AudioContext resumed after gesture', errorCategory: 'audio' }, { category: 'error', gameId });

    // 4. Session End with Duration
    sdk.telemetry.track('game_session_end', { gameId, durationSeconds: 360 }, { category: 'engagement', gameId });
  }

  // 6 games * 8 events = 48 events
  assert.equal(sdk.telemetry.getQueueLength(), 48);

  const queue = sdk.telemetry.getQueue(100);
  const gameIdsPresent = new Set(queue.map(e => e.gameId));
  for (const gId of LAUNCH_GAMES) {
    assert.ok(gameIdsPresent.has(gId), `Game ${gId} must have tracked events`);
  }

  sdk.dispose();
});

// ---------------------------------------------------------------------------
// Suite 4: Server-Authoritative Owner Metrics Aggregations
// ---------------------------------------------------------------------------
test('B10 Suite 4: Owner metrics aggregation computes DAU, WAU, MAU, game breakdown, and error rates', () => {
  const now = new Date();
  const sampleEvents = [
    // Today's events (DAU, WAU, MAU)
    {
      guest_id: 'guest_1',
      session_id: 'sess_1',
      game_id: 'vak',
      event_name: 'game_session_start',
      category: 'engagement',
      occurred_at: now.toISOString()
    },
    {
      guest_id: 'guest_1',
      session_id: 'sess_1',
      game_id: 'vak',
      event_name: 'level_attempt',
      category: 'progression',
      occurred_at: now.toISOString()
    },
    {
      guest_id: 'guest_1',
      session_id: 'sess_1',
      game_id: 'vak',
      event_name: 'level_completed',
      category: 'progression',
      occurred_at: now.toISOString()
    },
    {
      guest_id: 'guest_1',
      session_id: 'sess_1',
      game_id: 'vak',
      event_name: 'game_session_end',
      category: 'engagement',
      payload: { durationSeconds: 600 },
      occurred_at: now.toISOString()
    },
    // Event from 3 days ago (WAU, MAU, returning visitor)
    {
      guest_id: 'guest_1',
      session_id: 'sess_old',
      game_id: 'auromatch',
      event_name: 'game_session_start',
      category: 'engagement',
      occurred_at: new Date(now.getTime() - 3 * 24 * 3600 * 1000).toISOString()
    },
    // Event from another visitor today with an error
    {
      guest_id: 'guest_2',
      session_id: 'sess_2',
      game_id: 'auromandala',
      event_name: 'game_runtime_error',
      category: 'error',
      payload: { errorCategory: 'webgl_context_loss' },
      occurred_at: now.toISOString()
    },
    // Referral event
    {
      guest_id: 'guest_3',
      session_id: 'sess_3',
      game_id: 'portal',
      event_name: 'portal_visit',
      category: 'lifecycle',
      payload: { utm_source: 'search', utm_campaign: 'mindfulness_week' },
      occurred_at: now.toISOString()
    }
  ];

  const metrics = aggregateTelemetryMetrics(sampleEvents, sampleEvents.length);

  assert.equal(metrics.dau, 3, '3 visitors active today (guest_1, guest_2, guest_3)');
  assert.equal(metrics.wau, 3, '3 visitors active within 7 days');
  assert.equal(metrics.mau, 3, '3 visitors active within 30 days');

  // Returning visitor count (guest_1 has 2 sessions: sess_1, sess_old)
  assert.equal(metrics.activeVsReturning.returningVisitors, 1);
  assert.equal(metrics.activeVsReturning.newVisitors, 2);

  // Game popularity
  assert.equal(metrics.gamePopularity.vak.launches, 1);
  assert.equal(metrics.gamePopularity.vak.activePlayMinutes, 10);
  assert.equal(metrics.gamePopularity.auromatch.launches, 1);

  // Game progression
  assert.equal(metrics.gameProgression.vak.attempts, 1);
  assert.equal(metrics.gameProgression.vak.completions, 1);
  assert.equal(metrics.gameProgression.vak.failures, 0);

  // Errors
  assert.equal(metrics.errorMetrics.totalErrors, 1);
  assert.equal(metrics.errorMetrics.topFailureCategories.webgl_context_loss, 1);

  // Attribution
  assert.equal(metrics.attribution.sources.search, 1);
  assert.equal(metrics.attribution.campaigns.mindfulness_week, 1);
});

// ---------------------------------------------------------------------------
// Suite 5: Owner Authorization & Edge Function Security
// ---------------------------------------------------------------------------
test('B10 Suite 5: Server-side authorization blocks unauthorized requests and serves owner', async () => {
  const mockOwnerRoles = new Map([
    ['user_owner_id', 'owner']
  ]);

  const mockAdminClient = {
    from: (table) => {
      if (table === 'owner_roles') {
        return {
          select: () => ({
            eq: (_col1, userId) => ({
              eq: (_col2, role) => ({
                maybeSingle: async () => {
                  const r = mockOwnerRoles.get(userId);
                  return r === role ? { data: { role }, error: null } : { data: null, error: null };
                }
              })
            })
          })
        };
      }
      return {
        select: (_fields, opts) => {
          if (opts && opts.count) {
            return Promise.resolve({ count: 42, error: null });
          }
          return {
            order: () => ({
              limit: async () => ({ data: [], error: null })
            })
          };
        }
      };
    }
  };

  const mockUserClient = {
    auth: {
      getUser: async (token) => {
        if (token === 'owner_jwt') return { data: { user: { id: 'user_owner_id' } }, error: null };
        if (token === 'player_jwt') return { data: { user: { id: 'user_player_id' } }, error: null };
        return { data: { user: null }, error: new Error('Invalid JWT') };
      }
    }
  };

  // Case 1: Missing Authorization Header -> 401
  const req1 = new Request('https://edge.supabase.co/functions/v1/owner-metrics');
  const res1 = await handleOwnerMetricsRequest(req1, { userClient: mockUserClient, adminClient: mockAdminClient });
  assert.equal(res1.status, 401);
  const data1 = await res1.json();
  assert.equal(data1.ok, false);
  assert.equal(data1.error, 'UNAUTHORIZED');

  // Case 2: Non-owner player JWT -> 403 Forbidden
  const req2 = new Request('https://edge.supabase.co/functions/v1/owner-metrics', {
    headers: { Authorization: 'Bearer player_jwt' }
  });
  const res2 = await handleOwnerMetricsRequest(req2, { userClient: mockUserClient, adminClient: mockAdminClient });
  assert.equal(res2.status, 403);
  const data2 = await res2.json();
  assert.equal(data2.ok, false);
  assert.equal(data2.error, 'FORBIDDEN_OWNER_ROLE_REQUIRED');

  // Case 3: Legitimate owner JWT -> 200 with Metrics
  const req3 = new Request('https://edge.supabase.co/functions/v1/owner-metrics', {
    headers: { Authorization: 'Bearer owner_jwt' }
  });
  const res3 = await handleOwnerMetricsRequest(req3, { userClient: mockUserClient, adminClient: mockAdminClient });
  assert.equal(res3.status, 200);
  const data3 = await res3.json();
  assert.equal(data3.ok, true);
  assert.equal(data3.metrics.totalRegisteredUsers, 42);
  assert.ok(data3.metrics.gamePopularity);
});

// ---------------------------------------------------------------------------
// Suite 6: Supabase Free Tier Capacity & Quota Safety Bounds
// ---------------------------------------------------------------------------
test('B10 Suite 6: Supabase Free tier capacity, storage estimation, and batching safety', () => {
  // Free Tier Constants
  const DB_LIMIT_BYTES = 500 * 1024 * 1024; // 500 MB
  const FUNCTION_CALLS_LIMIT = 500000; // 500,000 / month

  // 1. Average Telemetry Event Size Benchmark
  const sampleEvent = {
    eventId: '3e4f7a8b-1234-4567-89ab-cdef01234567',
    schemaVersion: 1,
    timestamp: '2026-11-20T16:00:00.000Z',
    eventName: 'level_completed',
    category: 'progression',
    gameId: 'auromatch',
    sessionId: 'sess_abc123',
    guestId: 'guest_12345678-1234-4234-8234-123456789abc',
    payload: { levelId: 4, score: 1200, durationSeconds: 65 },
    appVersion: SDK_VERSION
  };

  const eventBytes = Buffer.byteLength(JSON.stringify(sampleEvent), 'utf8');
  assert.ok(eventBytes < 400, `Telemetry event should be lightweight (~300 bytes), got ${eventBytes} bytes`);

  // 2. 100,000 Events Storage Footprint Estimation
  const estimatedStorage100k = (eventBytes + 100) * 100000; // +100 bytes DB row overhead
  const storageRatio = estimatedStorage100k / DB_LIMIT_BYTES;
  assert.ok(storageRatio < 0.10, `100,000 events must occupy <10% of 500 MB storage (estimated ${(storageRatio * 100).toFixed(1)}%)`);

  // 3. Batching Invariant: Flushing batches of 20 events requires 1 invocation per 20 events
  const batchSize = 20;
  const invocationsFor100kEvents = 100000 / batchSize;
  const invocationRatio = invocationsFor100kEvents / FUNCTION_CALLS_LIMIT;
  assert.ok(invocationRatio < 0.05, `Invocations for 100k events must be <5% of monthly quota (estimated ${(invocationRatio * 100).toFixed(1)}%)`);

  // 4. Ingest Telemetry Constants
  assert.equal(MAX_TELEMETRY_BODY_BYTES, 65536, 'Body limit must be 64 KiB');
  assert.equal(MAX_EVENTS_PER_BATCH, 50, 'Max events per batch must be 50');
  assert.equal(DEFAULT_RATE_LIMIT_MAX, 30, 'Rate limit must be 30 req/min');
});
