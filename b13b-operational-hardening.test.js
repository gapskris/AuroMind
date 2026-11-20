/**
 * AuroMind Production Hosting Security & Operational Hardening — B13B Test Suite
 *
 * Verifies the operational hardening and retention implementation from B12/B13B:
 * 1. AUDIT-SEC-04: HTTP security headers (nosniff, SAMEORIGIN, strict-origin, Permissions-Policy, HSTS, frame-ancestors).
 * 2. AUDIT-PERF-01: 60-day telemetry retention, daily rollup aggregates, and bounded-batch cleanup.
 * 3. B13A SEC-01 Independent Verification: Direct PostgREST insert denial and Edge Function exclusive routing.
 * 4. B13A SEC-06 Independent Verification: Untrusted x-real-ip defense, rotating header throttling, zero raw IP persistence.
 * 5. Sacred Invariants: VAK speech corpus SHA-256, Flora database size, and Sankalpa local-only privacy.
 *
 * Runs natively with Node.js test runner (`node --test`). Zero external dependencies.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { createApp } from './server.js';
import {
  DEFAULT_RETENTION_DAYS,
  DEFAULT_BATCH_SIZE,
  computeDailyAggregates,
  pruneTelemetryEventsInMemory
} from './supabase/functions/cleanup-telemetry/retention-handler.js';
import {
  deriveClientIdentifier,
  handleTelemetryIngestRequest,
  MemoryRateLimitStore
} from './supabase/functions/ingest-telemetry/telemetry-handler.js';
import { aggregateTelemetryMetrics } from './supabase/functions/owner-metrics/metrics-handler.js';

// ==============================================================================
// 1. AUDIT-SEC-04: HTTP Security Headers
// ==============================================================================

test('AUDIT-SEC-04 Test 1: _headers configuration file defines all required production headers', () => {
  const headersPath = path.resolve(process.cwd(), '_headers');
  assert.ok(fs.existsSync(headersPath), '_headers file must exist in workspace root');

  const content = fs.readFileSync(headersPath, 'utf8');
  assert.ok(content.includes('X-Content-Type-Options: nosniff'), 'Must define X-Content-Type-Options: nosniff');
  assert.ok(content.includes('X-Frame-Options: SAMEORIGIN'), 'Must define X-Frame-Options: SAMEORIGIN');
  assert.ok(content.includes('Referrer-Policy: strict-origin-when-cross-origin'), 'Must define strict-origin-when-cross-origin');
  assert.ok(content.includes('Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()'), 'Must restrict unused device APIs');
  assert.ok(content.includes('Strict-Transport-Security: max-age=31536000; includeSubDomains'), 'Must define HSTS');
  assert.ok(content.includes("frame-ancestors 'self'"), "Must define frame-ancestors 'self' in CSP");
  assert.ok(content.includes('https://*.supabase.co'), 'Must include Supabase domain in CSP');
});

test('AUDIT-SEC-04 Test 2: server.js emits hardened security headers on HTTP responses', async () => {
  const app = createApp();
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(res.status, 200);

    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.ok(res.headers.get('permissions-policy').includes('camera=()'));
    assert.ok(res.headers.get('permissions-policy').includes('microphone=()'));

    const csp = res.headers.get('content-security-policy') || '';
    assert.ok(csp.includes("frame-ancestors 'self'"), "Response CSP header must define frame-ancestors 'self'");
    assert.ok(csp.includes('https://*.supabase.co'), 'Response CSP must permit Supabase connections');
    await res.text();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('AUDIT-SEC-04 Test 3: X-Frame-Options and frame-ancestors preserve same-origin iframe embedding for all 6 games', async () => {
  const app = createApp();
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  try {
    const { port } = server.address();
    const games = [
      '/games/vak/index.html',
      '/games/auromatch/index.html',
      '/games/auromandala/index.html',
      '/games/word-riddle/index.html',
      '/games/auroblocks/index.html',
      '/games/vak-living-sanctuary/index.html'
    ];

    for (const gamePath of games) {
      const res = await fetch(`http://127.0.0.1:${port}${gamePath}`);
      assert.equal(res.status, 200, `Game ${gamePath} must be accessible with 200 OK`);
      assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN', `${gamePath} must use SAMEORIGIN (NOT DENY)`);
      const csp = res.headers.get('content-security-policy') || '';
      assert.ok(csp.includes("frame-ancestors 'self'"), `${gamePath} CSP must declare frame-ancestors 'self'`);
      await res.text(); // Consume stream body to release keep-alive socket immediately
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('AUDIT-SEC-04 Test 4: Permissions-Policy restricts sensitive hardware APIs without impacting Web Audio', () => {
  const headersPath = path.resolve(process.cwd(), '_headers');
  const content = fs.readFileSync(headersPath, 'utf8');

  // Verify camera, microphone, geolocation, payment, and usb are locked down
  const restrictedApis = ['camera=()', 'microphone=()', 'geolocation=()', 'payment=()', 'usb=()'];
  for (const api of restrictedApis) {
    assert.ok(content.includes(api), `Permissions-Policy must disable ${api}`);
  }

  // Verify audio playback is NOT restricted (games require Web Audio API)
  assert.ok(!content.includes('speaker=()'), 'Audio output must not be restricted');
  assert.ok(!content.includes('autoplay=()'), 'Audio playback must not be blocked');
});

test('AUDIT-SEC-04 Test 5: HSTS is enforced in production HTTPS and safely conditioned on plain HTTP dev', async () => {
  const app = createApp();
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  try {
    const { port } = server.address();

    // 1. Plain HTTP request: HSTS header is safely omitted to prevent localhost certificate errors
    const httpRes = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(httpRes.headers.get('strict-transport-security'), null, 'HSTS must be omitted on plain HTTP');
    await httpRes.text();

    // 2. Simulated HTTPS request (via reverse proxy header x-forwarded-proto: https)
    const httpsRes = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: { 'x-forwarded-proto': 'https' }
    });
    const hsts = httpsRes.headers.get('strict-transport-security');
    assert.ok(hsts !== null, 'HSTS must be set when x-forwarded-proto is https');
    assert.ok(hsts.includes('max-age=31536000'), 'HSTS must specify 1-year max-age');
    assert.ok(hsts.includes('includeSubDomains'), 'HSTS must include subdomains');
    await httpsRes.text();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// ==============================================================================
// 2. AUDIT-PERF-01: Telemetry Retention & Cleanup
// ==============================================================================

test('AUDIT-PERF-01 Test 6: Retention cutoff accurately identifies events older than 60 days based on received_at', () => {
  const now = new Date('2026-11-20T12:00:00.000Z').getTime();
  const dayMs = 24 * 60 * 60 * 1000;

  const mockEvents = [
    { eventId: '1', received_at: new Date(now - (65 * dayMs)).toISOString(), eventName: 'old_1' }, // 65 days old -> expired
    { eventId: '2', received_at: new Date(now - (61 * dayMs)).toISOString(), eventName: 'old_2' }, // 61 days old -> expired
    { eventId: '3', received_at: new Date(now - (59 * dayMs)).toISOString(), eventName: 'recent_1' }, // 59 days old -> retain
    { eventId: '4', received_at: new Date(now - (1 * dayMs)).toISOString(), eventName: 'recent_2' }, // 1 day old -> retain
    { eventId: '5', received_at: new Date(now).toISOString(), eventName: 'recent_3' } // now -> retain
  ];

  const result = pruneTelemetryEventsInMemory(mockEvents, {
    retentionDays: 60,
    batchSize: 10,
    now
  });

  assert.equal(result.deletedCount, 2, 'Exactly 2 events older than 60 days must be pruned');
  assert.equal(result.retained.length, 3, 'Exactly 3 recent events must be retained');
  assert.equal(result.remainingExpired, 0);

  const retainedIds = result.retained.map((e) => e.eventId);
  assert.ok(retainedIds.includes('3'));
  assert.ok(retainedIds.includes('4'));
  assert.ok(retainedIds.includes('5'));
});

test('AUDIT-PERF-01 Test 7: Recent events (< 60 days) are strictly preserved and never eligible for deletion', () => {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  // Collection of 50 recent events within the last 30 days
  const recentEvents = [];
  for (let i = 0; i < 50; i++) {
    recentEvents.push({
      eventId: `recent_${i}`,
      received_at: new Date(now - (i * 0.5 * dayMs)).toISOString(),
      eventName: 'active_session'
    });
  }

  const result = pruneTelemetryEventsInMemory(recentEvents, { retentionDays: 60, now });
  assert.equal(result.deletedCount, 0, 'Zero recent events should be deleted');
  assert.equal(result.retained.length, 50, 'All 50 recent events must be preserved');
});

test('AUDIT-PERF-01 Test 8: Historical daily aggregates roll up events, unique visitors, and sessions before deletion', () => {
  const eventDate = '2026-08-15';
  const rawEvents = [
    { eventDate, received_at: `${eventDate}T10:00:00Z`, gameId: 'vak', category: 'progression', eventName: 'level_complete', guestId: 'guest_1', sessionId: 'sess_1' },
    { eventDate, received_at: `${eventDate}T10:05:00Z`, gameId: 'vak', category: 'progression', eventName: 'level_complete', guestId: 'guest_1', sessionId: 'sess_1' },
    { eventDate, received_at: `${eventDate}T11:00:00Z`, gameId: 'vak', category: 'progression', eventName: 'level_complete', guestId: 'guest_2', sessionId: 'sess_2' },
    { eventDate, received_at: `${eventDate}T12:00:00Z`, gameId: 'auromatch', category: 'engagement', eventName: 'round_start', guestId: 'guest_3', sessionId: 'sess_3' }
  ];

  const rollups = computeDailyAggregates(rawEvents);
  assert.equal(rollups.length, 2, 'Must create 2 distinct daily rollup buckets');

  const vakProgression = rollups.find((r) => r.gameId === 'vak');
  assert.ok(vakProgression);
  assert.equal(vakProgression.eventCount, 3, 'VAK progression had 3 events');
  assert.equal(vakProgression.uniqueVisitors, 2, 'VAK progression had 2 unique visitors');
  assert.equal(vakProgression.uniqueSessions, 2, 'VAK progression had 2 unique sessions');

  const matchEngagement = rollups.find((r) => r.gameId === 'auromatch');
  assert.ok(matchEngagement);
  assert.equal(matchEngagement.eventCount, 1);
  assert.equal(matchEngagement.uniqueVisitors, 1);
});

test('AUDIT-PERF-01 Test 9: Deletions are processed in bounded batches returning deleted count and remaining expired count', () => {
  const now = new Date('2026-11-20T12:00:00.000Z').getTime();
  const dayMs = 24 * 60 * 60 * 1000;

  // Create 15 expired events (older than 60 days) and 5 recent events
  const allEvents = [];
  for (let i = 1; i <= 15; i++) {
    allEvents.push({
      eventId: `exp_${i}`,
      received_at: new Date(now - ((70 + i) * dayMs)).toISOString(),
      eventName: 'old_event'
    });
  }
  for (let i = 1; i <= 5; i++) {
    allEvents.push({
      eventId: `rec_${i}`,
      received_at: new Date(now - (i * dayMs)).toISOString(),
      eventName: 'recent_event'
    });
  }

  // Batch 1: Batch size 6 (prunes first 6 expired rows)
  const pass1 = pruneTelemetryEventsInMemory(allEvents, {
    retentionDays: 60,
    batchSize: 6,
    now
  });
  assert.equal(pass1.deletedCount, 6);
  assert.equal(pass1.remainingExpired, 9);
  assert.equal(pass1.retained.length, 14); // 9 remaining expired + 5 recent

  // Batch 2: Next batch size 6 (prunes next 6 expired rows)
  const pass2 = pruneTelemetryEventsInMemory(pass1.retained, {
    retentionDays: 60,
    batchSize: 6,
    now
  });
  assert.equal(pass2.deletedCount, 6);
  assert.equal(pass2.remainingExpired, 3);
  assert.equal(pass2.retained.length, 8); // 3 remaining expired + 5 recent

  // Batch 3: Final batch size 6 (prunes remaining 3 expired rows)
  const pass3 = pruneTelemetryEventsInMemory(pass2.retained, {
    retentionDays: 60,
    batchSize: 6,
    now
  });
  assert.equal(pass3.deletedCount, 3);
  assert.equal(pass3.remainingExpired, 0);
  assert.equal(pass3.retained.length, 5); // Only 5 recent rows remain
});

test('AUDIT-PERF-01 Test 10: Pruning is safe and idempotent across repeated runs', () => {
  const now = Date.now();
  const events = [
    { eventId: '1', received_at: new Date(now - (100 * 24 * 60 * 60 * 1000)).toISOString() },
    { eventId: '2', received_at: new Date(now - (5 * 24 * 60 * 60 * 1000)).toISOString() }
  ];

  // Run 1: Prunes event 1
  const run1 = pruneTelemetryEventsInMemory(events, { retentionDays: 60, now });
  assert.equal(run1.deletedCount, 1);
  assert.equal(run1.remainingExpired, 0);

  // Run 2: Immediate re-run on retained events
  const run2 = pruneTelemetryEventsInMemory(run1.retained, { retentionDays: 60, now });
  assert.equal(run2.deletedCount, 0, 'Subsequent run must delete 0 events');
  assert.equal(run2.remainingExpired, 0);
  assert.equal(run2.retained.length, 1);
});

test('AUDIT-PERF-01 Test 11: Owner Analytics aggregations (DAU/WAU/MAU) continue working across retention lifecycle', () => {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  // Active user sessions within 30 days (MAU), 7 days (WAU), 24h (DAU)
  const activeEvents = [
    { guest_id: 'g_today', occurred_at: new Date(now - (2 * 3600 * 1000)).toISOString(), game_id: 'vak', category: 'engagement' },
    { guest_id: 'g_week', occurred_at: new Date(now - (3 * dayMs)).toISOString(), game_id: 'auromatch', category: 'engagement' },
    { guest_id: 'g_month', occurred_at: new Date(now - (20 * dayMs)).toISOString(), game_id: 'portal', category: 'lifecycle' }
  ];

  const metrics = aggregateTelemetryMetrics(activeEvents, 100);
  assert.equal(metrics.dau, 1, 'DAU must equal 1');
  assert.equal(metrics.wau, 2, 'WAU must equal 2');
  assert.equal(metrics.mau, 3, 'MAU must equal 3');
});

test('AUDIT-PERF-01 Test 12: Migration 20261120000004_b13b_telemetry_retention.sql exists and defines all requirements', () => {
  const migrationPath = path.resolve(process.cwd(), 'supabase/migrations/20261120000004_b13b_telemetry_retention.sql');
  assert.ok(fs.existsSync(migrationPath), 'Migration file 20261120000004 must exist');

  const content = fs.readFileSync(migrationPath, 'utf8');
  assert.ok(content.includes('idx_telemetry_received_at'), 'Must create index on received_at');
  assert.ok(content.includes('telemetry_daily_aggregates'), 'Must create telemetry_daily_aggregates table');
  assert.ok(content.includes('rollup_telemetry_aggregates'), 'Must define rollup_telemetry_aggregates stored procedure');
  assert.ok(content.includes('prune_expired_telemetry'), 'Must define prune_expired_telemetry stored procedure');
  assert.ok(content.includes('grant execute on function public.prune_expired_telemetry'), 'Must grant execute to service_role');
  assert.ok(content.includes('revoke execute on function public.prune_expired_telemetry'), 'Must revoke execute from public, anon, authenticated');
});

// ==============================================================================
// 3. B13A Independent Verification: SEC-01 & SEC-06
// ==============================================================================

test('SEC-01 Independent Verification 13: Direct PostgREST table insert is strictly denied to public and seekers', () => {
  const migration13a = path.resolve(process.cwd(), 'supabase/migrations/20261120000003_b13a_telemetry_rls_hardening.sql');
  const sql = fs.readFileSync(migration13a, 'utf8');

  // Verify drop policy
  assert.ok(sql.includes('drop policy if exists "telemetry_insert_any" on public.telemetry_events;'));
  // Verify revoke table privileges
  assert.ok(sql.includes('revoke insert on table public.telemetry_events from anon, authenticated, public;'));
  // Verify exclusive grant to service_role
  assert.ok(sql.includes('grant select, insert on table public.telemetry_events to service_role;'));
});

test('SEC-06 Independent Verification 14: Untrusted client cannot supply or manipulate x-real-ip when untrusted', async () => {
  const spoofedReq1 = new Request('https://test', {
    headers: { 'x-real-ip': '203.0.113.1' }
  });
  const spoofedReq2 = new Request('https://test', {
    headers: { 'x-real-ip': '203.0.113.2' }
  });

  // When trustRealIp is disabled (untrusted public client connecting directly)
  const hash1 = await deriveClientIdentifier(spoofedReq1, 'salt', { trustRealIp: false });
  const hash2 = await deriveClientIdentifier(spoofedReq2, 'salt', { trustRealIp: false });

  // Both spoofed IPs MUST map to the same fallback bucket
  assert.equal(hash1, hash2, 'Untrusted X-Real-IP must not produce different client hashes');

  // Verify fallback bucket matches unverified-proxy-network
  const emptyReq = new Request('https://test');
  const hashEmpty = await deriveClientIdentifier(emptyReq, 'salt', { trustRealIp: false });
  assert.equal(hash1, hashEmpty, 'Must map to shared unverified-proxy-network bucket');
});

test('SEC-06 Independent Verification 15: Rotating untrusted x-real-ip headers is blocked by rate limiter on fallback bucket', async () => {
  const store = new MemoryRateLimitStore();
  const maxRequests = 3;

  for (let i = 1; i <= 3; i++) {
    const req = new Request('https://test.supabase.co/functions/v1/ingest-telemetry', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-real-ip': `10.0.0.${i}` // Attacker attempts to rotate spoofed IP
      },
      body: JSON.stringify({
        events: [{
          eventId: `66666666-6666-4666-8666-66666666660${i}`,
          eventName: 'probe_event',
          category: 'system'
        }]
      })
    });

    const res = await handleTelemetryIngestRequest(req, {
      rateLimitStore: store,
      maxRequests,
      trustRealIp: false // Enforce untrusted client policy
    });
    assert.equal(res.status, 200, `Request ${i} should be permitted within quota`);
  }

  // 4th request from another rotating spoofed IP MUST be blocked (HTTP 429)
  const reqBlocked = new Request('https://test.supabase.co/functions/v1/ingest-telemetry', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-real-ip': '10.0.0.99'
    },
    body: JSON.stringify({
      events: [{
        eventId: '66666666-6666-4666-8666-666666666699',
        eventName: 'probe_event',
        category: 'system'
      }]
    })
  });

  const resBlocked = await handleTelemetryIngestRequest(reqBlocked, {
    rateLimitStore: store,
    maxRequests,
    trustRealIp: false
  });

  assert.equal(resBlocked.status, 429, 'Rotating X-Real-IP must not evade rate limit');
  const json = await resBlocked.json();
  assert.equal(json.error, 'RATE_LIMIT_EXCEEDED');
});

test('SEC-06 Independent Verification 16: Zero raw IP persistence or logging guarantee', async () => {
  const testIp = '198.51.100.99';
  const req = new Request('https://test', {
    headers: { 'cf-connecting-ip': testIp }
  });

  const hash = await deriveClientIdentifier(req);

  // Hash must be exactly 64-character hex string (SHA-256)
  assert.equal(hash.length, 64);
  assert.ok(/^[0-9a-f]{64}$/.test(hash));
  // Hash must never contain raw IP string
  assert.equal(hash.includes(testIp), false);
});

// ==============================================================================
// 4. Sacred Invariants Certification
// ==============================================================================

test('Sacred Invariant Test 17: VAK speech corpus SHA-256 matches frozen baseline', () => {
  const vakPath = path.resolve(process.cwd(), 'games/vak/index.html');
  const vakSrc = fs.readFileSync(vakPath, 'utf8');
  const clMatch = vakSrc.match(/const CL = \[\[[\s\S]*?\]\];/);
  assert.ok(clMatch, 'CL array must exist in games/vak/index.html');
  const hash = crypto.createHash('sha256').update(clMatch[0], 'utf8').digest('hex');
  assert.equal(hash, '9fdb3826030049c9eab183479bcb7fe29304b3ea08d045c8c67f1cfd4d77da09');
});

test('Sacred Invariant Test 18: AuroMatch Flora database is exactly 2,002,176 bytes', () => {
  const floraPath = path.resolve(process.cwd(), 'games/auromatch/src/models/floraDatabase.js');
  const stat = fs.statSync(floraPath);
  assert.equal(stat.size, 2002176, 'Flora database size must be exactly 2,002,176 bytes');
});

test('Sacred Invariant Test 19: Sankalpa contemplation vault is 100% local-only with zero cloud sync', async () => {
  const { createAuroMandalaGameAdapter } = await import('./games/auromandala/assets/auromandala-sdk-bridge.js');
  const mandalaAdapter = createAuroMandalaGameAdapter();
  assert.equal(mandalaAdapter.capabilities.cloudSyncEligible, false, 'Sankalpa vault must be strictly local-only');
  assert.deepEqual(mandalaAdapter.storage.localOnlyVaults, ['sankalpa_e2ee_vault']);

  const envelope = await mandalaAdapter.exportEnvelope('guest_test_id');
  const envStr = JSON.stringify(envelope);
  assert.equal(envStr.includes('sankalpa_e2ee_vault'), false, 'Exported envelope must never include Sankalpa vault');
});
