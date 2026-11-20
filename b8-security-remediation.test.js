/**
 * AuroMind Modernization Batch B8 — Production Security Remediation Suite
 *
 * Validates:
 * 1. FIND-03: Sync-save payload size protection (upfront Content-Length check,
 *    bounded streaming reader, HTTP 413 rejection, and zero parsing of oversized payloads).
 * 2. FIND-02: Telemetry ingestion abuse protection (server-side rate limiting,
 *    privacy-preserving hashing, batch-size caps, HTTP 429 Retry-After, and multi-instance convergence).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  handleSyncSaveRequest,
  readBoundedBody,
  MAX_SYNC_SAVE_BODY_BYTES,
  corsHeaders as syncCorsHeaders
} from './supabase/functions/sync-save/sync-save-handler.js';
import {
  handleTelemetryIngestRequest,
  deriveClientIdentifier,
  MemoryRateLimitStore,
  MAX_TELEMETRY_BODY_BYTES,
  MAX_EVENTS_PER_BATCH,
  DEFAULT_RATE_LIMIT_MAX,
  DEFAULT_RATE_LIMIT_WINDOW_SECONDS
} from './supabase/functions/ingest-telemetry/telemetry-handler.js';

// ==============================================================================
// Mock Factories
// ==============================================================================

function createMockSupabaseClient(overrides = {}) {
  let rpcCalled = false;
  let lastRpcArgs = null;
  let fromCalled = false;
  let upsertRows = null;

  return {
    auth: {
      getUser: async () => {
        if (overrides.authFail) {
          return { data: { user: null }, error: { message: 'Invalid token' } };
        }
        return { data: { user: { id: overrides.userId || 'usr_test_seeker_101' } }, error: null };
      }
    },
    rpc: async (name, args) => {
      rpcCalled = true;
      lastRpcArgs = { name, args };
      if (overrides.rpcConflict) {
        return { data: { status: 'conflict', currentRevision: 5 }, error: null };
      }
      if (overrides.rpcError) {
        return { data: null, error: { message: overrides.rpcError } };
      }
      return {
        data: {
          status: 'success',
          gameId: args.p_game_id,
          revision: (args.p_expected_revision || 0) + 1,
          savedAt: new Date().toISOString()
        },
        error: null
      };
    },
    from: (table) => {
      fromCalled = true;
      return {
        upsert: async (rows, options) => {
          upsertRows = rows;
          if (overrides.upsertError) {
            return { error: { message: overrides.upsertError } };
          }
          return { data: rows, error: null };
        }
      };
    },
    // Inspection helpers for assertions
    getRpcCalled: () => rpcCalled,
    getLastRpcArgs: () => lastRpcArgs,
    getFromCalled: () => fromCalled,
    getUpsertRows: () => upsertRows
  };
}

function createValidSavePayload() {
  return {
    gameId: 'vak',
    envelopeVersion: 1,
    gameSchemaVersion: 1,
    expectedRevision: 1,
    sourceGuestId: 'guest_11111111-2222-4333-8444-555555555555',
    checksum: 'sha256_mock_checksum',
    payload: { level: 25, wordsCompleted: ['CALM', 'PEACE', 'HARMONY'] },
    clientUpdatedAt: new Date().toISOString()
  };
}

// ==============================================================================
// Part 1: FIND-03 — Sync-Save Payload Size Protection Tests
// ==============================================================================

test('B8 Security Test 1: Valid save request below 512 KiB limit succeeds with HTTP 200', async () => {
  const mockClient = createMockSupabaseClient();
  const validBody = JSON.stringify(createValidSavePayload());

  const req = new Request('https://test.supabase.co/functions/v1/sync-save', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer valid_player_token',
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(validBody))
    },
    body: validBody
  });

  const res = await handleSyncSaveRequest(req, { supabaseClient: mockClient });
  assert.equal(res.status, 200);

  const json = await res.json();
  assert.equal(json.status, 'success');
  assert.equal(json.gameId, 'vak');
  assert.equal(mockClient.getRpcCalled(), true);
});

test('B8 Security Test 2: Declared Content-Length above 512 KiB rejected with HTTP 413 before reading body', async () => {
  const mockClient = createMockSupabaseClient();
  const oversizedLength = MAX_SYNC_SAVE_BODY_BYTES + 1; // 524,289 bytes

  const req = new Request('https://test.supabase.co/functions/v1/sync-save', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer valid_player_token',
      'Content-Type': 'application/json',
      'Content-Length': String(oversizedLength)
    },
    body: JSON.stringify({ gameId: 'vak', payload: 'small' })
  });

  const res = await handleSyncSaveRequest(req, { supabaseClient: mockClient });
  assert.equal(res.status, 413);

  const json = await res.json();
  assert.equal(json.ok, false);
  assert.equal(json.error, 'PAYLOAD_TOO_LARGE');
  assert.match(json.message, /512 KiB/);
  // Verify database RPC was NEVER reached
  assert.equal(mockClient.getRpcCalled(), false);
});

test('B8 Security Test 3: Missing Content-Length header is safely handled by bounded stream reader', async () => {
  const mockClient = createMockSupabaseClient();
  const validBody = JSON.stringify(createValidSavePayload());

  // Note: Request without Content-Length header
  const req = new Request('https://test.supabase.co/functions/v1/sync-save', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer valid_player_token',
      'Content-Type': 'application/json'
    },
    body: validBody
  });

  const res = await handleSyncSaveRequest(req, { supabaseClient: mockClient });
  assert.equal(res.status, 200);

  const json = await res.json();
  assert.equal(json.status, 'success');
  assert.equal(mockClient.getRpcCalled(), true);
});

test('B8 Security Test 4: Malformed Content-Length header (NaN, negative, text) degrades safely without crashing', async () => {
  const mockClient = createMockSupabaseClient();
  const validBody = JSON.stringify(createValidSavePayload());

  const malformedHeaders = ['not-a-number', '-500', '123invalid', ''];

  for (const badCl of malformedHeaders) {
    const req = new Request('https://test.supabase.co/functions/v1/sync-save', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer valid_player_token',
        'Content-Type': 'application/json',
        'Content-Length': badCl
      },
      body: validBody
    });

    const res = await handleSyncSaveRequest(req, { supabaseClient: mockClient });
    // Safe fallback to bounded reader accepts valid body
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.status, 'success');
  }
});

test('B8 Security Test 5: Actual body exceeding 512 KiB with misleading small Content-Length is rejected with HTTP 413', async () => {
  const mockClient = createMockSupabaseClient();

  // Create a large body exceeding 512 KiB (600 KiB)
  const chunk64k = 'A'.repeat(64 * 1024);
  const oversizedText = chunk64k.repeat(10); // 640 KiB
  assert.ok(Buffer.byteLength(oversizedText) > MAX_SYNC_SAVE_BODY_BYTES);

  // Misleading header claims 100 bytes, but body streams 640 KiB
  const req = new Request('https://test.supabase.co/functions/v1/sync-save', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer valid_player_token',
      'Content-Type': 'application/json',
      'Content-Length': '100'
    },
    body: oversizedText
  });

  const res = await handleSyncSaveRequest(req, { supabaseClient: mockClient });
  assert.equal(res.status, 413);

  const json = await res.json();
  assert.equal(json.ok, false);
  assert.equal(json.error, 'PAYLOAD_TOO_LARGE');
  // RPC must never have been called
  assert.equal(mockClient.getRpcCalled(), false);
});

test('B8 Security Test 6: Invalid JSON body is rejected with HTTP 400 without invoking RPC', async () => {
  const mockClient = createMockSupabaseClient();
  const invalidJson = '{ "gameId": "vak", "payload": corrupted_json...';

  const req = new Request('https://test.supabase.co/functions/v1/sync-save', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer valid_player_token',
      'Content-Type': 'application/json'
    },
    body: invalidJson
  });

  const res = await handleSyncSaveRequest(req, { supabaseClient: mockClient });
  assert.equal(res.status, 400);

  const json = await res.json();
  assert.equal(json.ok, false);
  assert.equal(json.error, 'INVALID_JSON');
  assert.equal(mockClient.getRpcCalled(), false);
});

test('B8 Security Test 7: Existing authorization behavior preserves 401 for unauthenticated/invalid tokens', async () => {
  const mockClient = createMockSupabaseClient({ authFail: true });
  const validBody = JSON.stringify(createValidSavePayload());

  // 1. Missing Authorization header
  const reqNoAuth = new Request('https://test.supabase.co/functions/v1/sync-save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: validBody
  });
  const resNoAuth = await handleSyncSaveRequest(reqNoAuth, { supabaseClient: mockClient });
  assert.equal(resNoAuth.status, 401);
  const jsonNoAuth = await resNoAuth.json();
  assert.equal(jsonNoAuth.error, 'UNAUTHORIZED');

  // 2. Invalid Token
  const reqBadToken = new Request('https://test.supabase.co/functions/v1/sync-save', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer bad_expired_token',
      'Content-Type': 'application/json'
    },
    body: validBody
  });
  const resBadToken = await handleSyncSaveRequest(reqBadToken, { supabaseClient: mockClient });
  assert.equal(resBadToken.status, 401);
  const jsonBadToken = await resBadToken.json();
  assert.equal(jsonBadToken.error, 'INVALID_TOKEN');

  assert.equal(mockClient.getRpcCalled(), false);
});

test('B8 Security Test 8: Existing valid save behavior handles optimistic concurrency conflict (HTTP 409)', async () => {
  const mockConflictClient = createMockSupabaseClient({ rpcConflict: true });
  const validBody = JSON.stringify(createValidSavePayload());

  const req = new Request('https://test.supabase.co/functions/v1/sync-save', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer valid_player_token',
      'Content-Type': 'application/json'
    },
    body: validBody
  });

  const res = await handleSyncSaveRequest(req, { supabaseClient: mockConflictClient });
  assert.equal(res.status, 409);

  const json = await res.json();
  assert.equal(json.status, 'conflict');
  assert.equal(json.currentRevision, 5);
});

test('B8 Security Test 9: Oversized request stream never triggers JSON.parse', async () => {
  // Test directly with readBoundedBody
  const chunk64k = 'X'.repeat(64 * 1024);
  const oversizedText = chunk64k.repeat(9); // 576 KiB > 512 KiB

  const req = new Request('https://test.supabase.co/functions/v1/sync-save', {
    method: 'POST',
    body: oversizedText
  });

  const result = await readBoundedBody(req, MAX_SYNC_SAVE_BODY_BYTES);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'PAYLOAD_TOO_LARGE');
  assert.ok(result.bytesRead > MAX_SYNC_SAVE_BODY_BYTES);
});

// ==============================================================================
// Part 2: FIND-02 — Telemetry Ingestion Abuse Protection Tests
// ==============================================================================

function createValidTelemetryEvent(idSuffix = '1') {
  return {
    eventId: `a0000000-0000-4000-8000-00000000000${idSuffix}`,
    eventName: 'vak_level_completed',
    category: 'progression',
    gameId: 'vak',
    payload: { level: 5, accuracy: 0.98 },
    timestamp: new Date().toISOString()
  };
}

test('B8 Security Test 10: Normal permitted telemetry ingestion succeeds within rate limit', async () => {
  const mockClient = createMockSupabaseClient();
  const rateLimitStore = new MemoryRateLimitStore();

  const events = [createValidTelemetryEvent('1'), createValidTelemetryEvent('2')];
  const req = new Request('https://test.supabase.co/functions/v1/ingest-telemetry', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-real-ip': '198.51.100.1'
    },
    body: JSON.stringify({ events })
  });

  const res = await handleTelemetryIngestRequest(req, {
    supabaseClient: mockClient,
    rateLimitStore
  });

  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.equal(json.count, 2);
  assert.equal(mockClient.getFromCalled(), true);
  assert.equal(mockClient.getUpsertRows().length, 2);
});

test('B8 Security Test 11: Repeated requests exceeding rate limit receive HTTP 429 and Retry-After', async () => {
  const mockClient = createMockSupabaseClient();
  const rateLimitStore = new MemoryRateLimitStore();
  const clientIp = '198.51.100.2';
  const customLimit = 5; // Low limit for rapid test verification

  // Send 5 requests (all should succeed)
  for (let i = 1; i <= customLimit; i++) {
    const req = new Request('https://test.supabase.co/functions/v1/ingest-telemetry', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-real-ip': clientIp
      },
      body: JSON.stringify({ events: [createValidTelemetryEvent(String(i))] })
    });

    const res = await handleTelemetryIngestRequest(req, {
      supabaseClient: mockClient,
      rateLimitStore,
      maxRequests: customLimit
    });
    assert.equal(res.status, 200, `Request ${i} should succeed`);
  }

  // Request 6: Must be rejected with HTTP 429 Too Many Requests
  const reqExceeded = new Request('https://test.supabase.co/functions/v1/ingest-telemetry', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-real-ip': clientIp
    },
    body: JSON.stringify({ events: [createValidTelemetryEvent('6')] })
  });

  const resExceeded = await handleTelemetryIngestRequest(reqExceeded, {
    supabaseClient: mockClient,
    rateLimitStore,
    maxRequests: customLimit
  });

  assert.equal(resExceeded.status, 429);
  assert.ok(resExceeded.headers.has('Retry-After'));
  assert.ok(Number(resExceeded.headers.get('Retry-After')) > 0);
  assert.equal(resExceeded.headers.get('X-RateLimit-Remaining'), '0');

  const jsonExceeded = await resExceeded.json();
  assert.equal(jsonExceeded.ok, false);
  assert.equal(jsonExceeded.error, 'RATE_LIMIT_EXCEEDED');
});

test('B8 Security Test 12: Concurrent telemetry requests update counters atomically without race conditions', async () => {
  const mockClient = createMockSupabaseClient();
  const rateLimitStore = new MemoryRateLimitStore();
  const clientIp = '198.51.100.3';
  const concurrency = 10;

  const promises = Array.from({ length: concurrency }, (_, i) => {
    const req = new Request('https://test.supabase.co/functions/v1/ingest-telemetry', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-real-ip': clientIp
      },
      body: JSON.stringify({ events: [createValidTelemetryEvent(String(i))] })
    });

    return handleTelemetryIngestRequest(req, {
      supabaseClient: mockClient,
      rateLimitStore,
      maxRequests: 30
    });
  });

  const results = await Promise.all(promises);
  for (const res of results) {
    assert.equal(res.status, 200);
  }

  // Verify internal bucket count exactly equals 10
  const clientHash = await deriveClientIdentifier(
    new Request('https://test', { headers: { 'x-real-ip': clientIp } })
  );
  const bucket = rateLimitStore.buckets.get(clientHash);
  assert.equal(bucket.count, concurrency);
});

test('B8 Security Test 13: Rate limit state converges across simulated independent Edge Function invocations', async () => {
  const mockClient = createMockSupabaseClient();
  // Shared persistent/database-backed store across independent invocation instances
  const sharedCoordinator = new MemoryRateLimitStore();
  const clientIp = '198.51.100.4';
  const limit = 4;

  // Invocation Instance A receives 2 requests
  for (let i = 0; i < 2; i++) {
    const reqA = new Request('https://test.supabase.co/functions/v1/ingest-telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-real-ip': clientIp },
      body: JSON.stringify({ events: [createValidTelemetryEvent(`a${i}`)] })
    });
    const resA = await handleTelemetryIngestRequest(reqA, {
      supabaseClient: mockClient,
      rateLimitStore: sharedCoordinator,
      maxRequests: limit
    });
    assert.equal(resA.status, 200);
  }

  // Invocation Instance B receives 2 requests (reaching limit)
  for (let i = 0; i < 2; i++) {
    const reqB = new Request('https://test.supabase.co/functions/v1/ingest-telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-real-ip': clientIp },
      body: JSON.stringify({ events: [createValidTelemetryEvent(`b${i}`)] })
    });
    const resB = await handleTelemetryIngestRequest(reqB, {
      supabaseClient: mockClient,
      rateLimitStore: sharedCoordinator,
      maxRequests: limit
    });
    assert.equal(resB.status, 200);
  }

  // Invocation Instance C receives 1 request (must exceed limit across invocations)
  const reqC = new Request('https://test.supabase.co/functions/v1/ingest-telemetry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-real-ip': clientIp },
    body: JSON.stringify({ events: [createValidTelemetryEvent('c0')] })
  });
  const resC = await handleTelemetryIngestRequest(reqC, {
    supabaseClient: mockClient,
    rateLimitStore: sharedCoordinator,
    maxRequests: limit
  });

  assert.equal(resC.status, 429);
  const jsonC = await resC.json();
  assert.equal(jsonC.error, 'RATE_LIMIT_EXCEEDED');
});

test('B8 Security Test 14: Malformed telemetry payloads consume rate limit quota and drop invalid events', async () => {
  const mockClient = createMockSupabaseClient();
  const rateLimitStore = new MemoryRateLimitStore();
  const clientIp = '198.51.100.5';

  // Request containing invalid category and non-UUID eventId
  const malformedPayload = {
    events: [
      { eventId: 'not-a-uuid', eventName: 'test', category: 'invalid_cat' },
      null,
      'plain-string'
    ]
  };

  const req = new Request('https://test.supabase.co/functions/v1/ingest-telemetry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-real-ip': clientIp },
    body: JSON.stringify(malformedPayload)
  });

  const res = await handleTelemetryIngestRequest(req, {
    supabaseClient: mockClient,
    rateLimitStore,
    maxRequests: 5
  });

  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.count, 0);
  assert.equal(json.skipped, 3);

  // Rate limit counter MUST have been charged for this request
  const clientHash = await deriveClientIdentifier(
    new Request('https://test', { headers: { 'x-real-ip': clientIp } })
  );
  assert.equal(rateLimitStore.buckets.get(clientHash).count, 1);
});

test('B8 Security Test 15: Oversized batch (>50 events) is rejected with HTTP 400 BATCH_SIZE_EXCEEDED', async () => {
  const mockClient = createMockSupabaseClient();
  const rateLimitStore = new MemoryRateLimitStore();

  // Create batch of 51 events
  const oversizedBatch = Array.from({ length: 51 }, (_, i) => ({
    eventId: `b0000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    eventName: 'batch_event',
    category: 'engagement'
  }));

  const req = new Request('https://test.supabase.co/functions/v1/ingest-telemetry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-real-ip': '198.51.100.6' },
    body: JSON.stringify({ events: oversizedBatch })
  });

  const res = await handleTelemetryIngestRequest(req, {
    supabaseClient: mockClient,
    rateLimitStore
  });

  assert.equal(res.status, 400);
  const json = await res.json();
  assert.equal(json.ok, false);
  assert.equal(json.error, 'BATCH_SIZE_EXCEEDED');
  assert.match(json.message, /50 events/);
  // Database was never touched
  assert.equal(mockClient.getFromCalled(), false);
});

test('B8 Security Test 16: Untrusted identity or spoofed headers cannot bypass rate limits', async () => {
  const mockClient = createMockSupabaseClient();
  const rateLimitStore = new MemoryRateLimitStore();
  const trustedEdgeIp = '203.0.113.50';

  // Client attempts to bypass rate limits by injecting random spoofed identity headers
  for (let i = 1; i <= 3; i++) {
    const req = new Request('https://test.supabase.co/functions/v1/ingest-telemetry', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'cf-connecting-ip': trustedEdgeIp, // Authoritative edge header
        'X-User-Id': `fake_user_${i}`, // Spoofed identity claim
        'X-Guest-Id': `fake_guest_${i}`, // Spoofed guest claim
        'X-Forwarded-For': `1.2.3.${i}` // Spoofed forward header
      },
      body: JSON.stringify({ events: [createValidTelemetryEvent(String(i))] })
    });

    const res = await handleTelemetryIngestRequest(req, {
      supabaseClient: mockClient,
      rateLimitStore,
      maxRequests: 2 // Limit = 2
    });

    if (i <= 2) {
      assert.equal(res.status, 200);
    } else {
      // 3rd request MUST be rejected despite changing spoofed headers
      assert.equal(res.status, 429);
      const json = await res.json();
      assert.equal(json.error, 'RATE_LIMIT_EXCEEDED');
    }
  }
});

test('B8 Security Test 17: HTTP 429 response provides complete standards-compliant rate-limit headers', async () => {
  const mockClient = createMockSupabaseClient();
  const rateLimitStore = new MemoryRateLimitStore();
  const clientIp = '198.51.100.8';

  // Exhaust rate limit
  for (let i = 0; i < 2; i++) {
    await handleTelemetryIngestRequest(
      new Request('https://test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-real-ip': clientIp },
        body: JSON.stringify({ events: [createValidTelemetryEvent(String(i))] })
      }),
      { supabaseClient: mockClient, rateLimitStore, maxRequests: 2 }
    );
  }

  // Request when exhausted
  const res = await handleTelemetryIngestRequest(
    new Request('https://test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-real-ip': clientIp },
      body: JSON.stringify({ events: [createValidTelemetryEvent('3')] })
    }),
    { supabaseClient: mockClient, rateLimitStore, maxRequests: 2 }
  );

  assert.equal(res.status, 429);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(res.headers.get('Content-Type'), 'application/json');
  assert.ok(Number(res.headers.get('Retry-After')) >= 1);
  assert.equal(res.headers.get('X-RateLimit-Limit'), '2');
  assert.equal(res.headers.get('X-RateLimit-Remaining'), '0');
  assert.ok(Number(res.headers.get('X-RateLimit-Reset')) >= 1);
});

test('B8 Security Test 18: No telemetry dispatch or data leakage after rejection', async () => {
  const mockClient = createMockSupabaseClient();
  const rateLimitStore = new MemoryRateLimitStore();
  const clientIp = '198.51.100.9';

  // Seed store to exhausted
  const clientHash = await deriveClientIdentifier(
    new Request('https://test', { headers: { 'x-real-ip': clientIp } })
  );
  rateLimitStore.buckets.set(clientHash, { count: 100, resetTime: Date.now() + 60000 });

  // Attempt to ingest sensitive event while rate limited
  const sensitiveEvent = {
    eventId: 'c0000000-0000-4000-8000-000000000099',
    eventName: 'private_event',
    category: 'engagement',
    payload: { sensitiveToken: 'SECRET_DATA_DO_NOT_STORE' }
  };

  const req = new Request('https://test.supabase.co/functions/v1/ingest-telemetry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-real-ip': clientIp },
    body: JSON.stringify({ events: [sensitiveEvent] })
  });

  const res = await handleTelemetryIngestRequest(req, {
    supabaseClient: mockClient,
    rateLimitStore,
    maxRequests: 30
  });

  assert.equal(res.status, 429);
  // Verify database was NEVER touched
  assert.equal(mockClient.getFromCalled(), false);
  assert.equal(mockClient.getUpsertRows(), null);

  const json = await res.json();
  // Verify no internal state, database credentials, or sensitive token leaked in response
  const rawResponse = JSON.stringify(json);
  assert.ok(!rawResponse.includes('SECRET_DATA_DO_NOT_STORE'));
  assert.ok(!rawResponse.includes('service_role'));
  assert.ok(!rawResponse.includes('supabase'));
});
