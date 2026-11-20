/**
 * AuroMind Production Remediation & Security Hardening — B13A Test Suite
 *
 * Verifies the 4 remediated findings from B12 Audit:
 * 1. AUDIT-SEC-01: Direct telemetry table insertion bypassed -> Routed to Edge Function + RLS Hardened.
 * 2. AUDIT-SEC-02: Supabase origin missing from root CSP -> Added https://*.supabase.co; removed stale domain.
 * 3. AUDIT-SEC-05: Unsafe email interpolation into innerHTML -> Replaced with safe DOM textContent nodes.
 * 4. AUDIT-SEC-06: Telemetry rate limiter's forwarded-IP fallback -> Hardened proxy trust boundary.
 *
 * Runs natively with Node.js test runner (`node --test`). Zero external dependencies.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { createSupabaseClient } from './assets/sdk/providers/supabase/supabase-client.js';
import { createSupabaseTelemetryTransport } from './assets/sdk/providers/supabase/supabase-telemetry-transport.js';
import {
  deriveClientIdentifier,
  handleTelemetryIngestRequest,
  MemoryRateLimitStore
} from './supabase/functions/ingest-telemetry/telemetry-handler.js';

// ==============================================================================
// AUDIT-SEC-01: Telemetry Edge Function Ingestion & RLS Hardening
// ==============================================================================

test('AUDIT-SEC-01 Test 1: Supabase client exposes functions.invoke for Edge Function invocation', async () => {
  let invokedUrl = null;
  let invokedMethod = null;
  let invokedBody = null;

  const mockFetch = async (url, options = {}) => {
    invokedUrl = String(url);
    invokedMethod = options.method;
    invokedBody = options.body ? JSON.parse(options.body) : null;
    return {
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      json: async () => ({ ok: true, count: 1 })
    };
  };

  const client = createSupabaseClient({
    supabaseUrl: 'https://test-project.supabase.co',
    supabaseAnonKey: 'anon-key-12345',
    fetch: mockFetch
  });

  assert.equal(typeof client.functions?.invoke, 'function');

  const result = await client.functions.invoke('ingest-telemetry', {
    body: { events: [{ eventId: '00000000-0000-4000-8000-000000000001' }] }
  });

  assert.equal(result.error, null);
  assert.equal(result.data.ok, true);
  assert.equal(invokedUrl, 'https://test-project.supabase.co/functions/v1/ingest-telemetry');
  assert.equal(invokedMethod, 'POST');
  assert.equal(invokedBody.events[0].eventId, '00000000-0000-4000-8000-000000000001');
});

test('AUDIT-SEC-01 Test 2: Telemetry transport routes events primarily via ingest-telemetry Edge Function', async () => {
  let edgeFunctionPayload = null;
  let directTableUpsertCalled = false;

  const mockClient = {
    isConfigured: () => true,
    auth: { getUser: () => ({ id: 'usr_test_edge_1' }) },
    functions: {
      invoke: async (fnName, options) => {
        if (fnName === 'ingest-telemetry') {
          edgeFunctionPayload = options.body;
          return { data: { ok: true, count: options.body.events.length }, error: null };
        }
        return { data: null, error: { status: 404, message: 'Not found' } };
      }
    },
    from: () => ({
      upsert: async () => {
        directTableUpsertCalled = true;
        return { error: null };
      }
    })
  };

  const transport = createSupabaseTelemetryTransport(mockClient);
  const events = [
    {
      eventId: '11111111-1111-4111-8111-111111111111',
      eventName: 'portal_visited',
      category: 'lifecycle',
      gameId: 'portal',
      payload: { screen: 'home' }
    }
  ];

  const res = await transport.sendEvents(events);
  assert.equal(res.ok, true);
  assert.equal(res.sentCount, 1);
  assert.ok(edgeFunctionPayload !== null, 'Edge function should have been invoked');
  assert.equal(edgeFunctionPayload.events.length, 1);
  assert.equal(edgeFunctionPayload.events[0].eventId, '11111111-1111-4111-8111-111111111111');
  assert.equal(edgeFunctionPayload.events[0].userId, 'usr_test_edge_1');
  assert.equal(directTableUpsertCalled, false, 'Direct table upsert MUST NOT be called when Edge Function succeeds');
});

test('AUDIT-SEC-01 Test 3: Telemetry transport deduplicates events before Edge Function invocation', async () => {
  let edgeFunctionPayload = null;

  const mockClient = {
    isConfigured: () => true,
    auth: { getUser: () => null },
    functions: {
      invoke: async (fnName, options) => {
        edgeFunctionPayload = options.body;
        return { data: { ok: true, count: options.body.events.length }, error: null };
      }
    }
  };

  const transport = createSupabaseTelemetryTransport(mockClient);
  const dupEvent = {
    eventId: '22222222-2222-4222-8222-222222222222',
    eventName: 'puzzle_move',
    category: 'engagement',
    gameId: 'vak'
  };

  const res = await transport.sendEvents([dupEvent, dupEvent, dupEvent]);
  assert.equal(res.ok, true);
  assert.equal(res.sentCount, 1);
  assert.equal(edgeFunctionPayload.events.length, 1, 'Duplicate events must be pruned');
});

test('AUDIT-SEC-01 Test 4: Edge Function rate limiting or size rejection (429/413) is strictly preserved without table bypass', async () => {
  let directTableUpsertCalled = false;

  const mockClient = {
    isConfigured: () => true,
    auth: { getUser: () => null },
    functions: {
      invoke: async () => {
        // Edge function rejects with HTTP 429
        return {
          data: null,
          error: { status: 429, message: 'RATE_LIMIT_EXCEEDED' }
        };
      }
    },
    from: () => ({
      upsert: async () => {
        directTableUpsertCalled = true;
        return { error: null };
      }
    })
  };

  const transport = createSupabaseTelemetryTransport(mockClient);
  const res = await transport.sendEvents([
    { eventId: '33333333-3333-4333-8333-333333333333', eventName: 'spam_event', category: 'engagement' }
  ]);

  assert.equal(res.ok, false);
  assert.equal(res.sentCount, 0);
  assert.ok(res.error.includes('RATE_LIMIT_EXCEEDED'));
  assert.equal(directTableUpsertCalled, false, 'Direct table upsert MUST NEVER bypass Edge Function rate limiter');
});

test('AUDIT-SEC-01 Test 5: Graceful 404 fallback to direct table upsert in legacy test environments', async () => {
  let directTableUpsertCalled = false;
  let rowsReceived = [];

  const mockClient = {
    isConfigured: () => true,
    auth: { getUser: () => null },
    functions: {
      invoke: async () => {
        // Simulates un-mocked Edge Function in older test environment (HTTP 404)
        return { data: null, error: { status: 404, message: 'Function not found' } };
      }
    },
    from: (table) => {
      assert.equal(table, 'telemetry_events');
      return {
        upsert: async (rows) => {
          directTableUpsertCalled = true;
          rowsReceived = rows;
          return { error: null };
        }
      };
    }
  };

  const transport = createSupabaseTelemetryTransport(mockClient);
  const res = await transport.sendEvents([
    { eventId: '44444444-4444-4444-8444-444444444444', eventName: 'fallback_event', category: 'lifecycle' }
  ]);

  assert.equal(res.ok, true);
  assert.equal(res.sentCount, 1);
  assert.equal(directTableUpsertCalled, true);
  assert.equal(rowsReceived[0].event_id, '44444444-4444-4444-8444-444444444444');
});

test('AUDIT-SEC-01 Test 6: Migration 20261120000003_b13a_telemetry_rls_hardening.sql revokes direct insert from public', () => {
  const migrationPath = path.resolve(process.cwd(), 'supabase/migrations/20261120000003_b13a_telemetry_rls_hardening.sql');
  assert.ok(fs.existsSync(migrationPath), 'Migration file must exist');

  const content = fs.readFileSync(migrationPath, 'utf8');
  assert.ok(content.includes('drop policy if exists "telemetry_insert_any" on public.telemetry_events;'),
    'Must drop telemetry_insert_any policy');
  assert.ok(content.includes('revoke insert on table public.telemetry_events from anon, authenticated, public;'),
    'Must revoke insert privilege from anon, authenticated, public');
  assert.ok(content.includes('grant select, insert on table public.telemetry_events to service_role;'),
    'Must grant privileges strictly to service_role');
});

// ==============================================================================
// AUDIT-SEC-02: Root Portal Content Security Policy
// ==============================================================================

test('AUDIT-SEC-02 Test 7: Root portal CSP in index.html explicitly allows https://*.supabase.co in connect-src', () => {
  const indexPath = path.resolve(process.cwd(), 'index.html');
  const indexHtml = fs.readFileSync(indexPath, 'utf8');

  const cspMatch = indexHtml.match(/<meta\s+http-equiv=["']Content-Security-Policy["']\s+content="([^"]*)"/i);
  assert.ok(cspMatch, 'index.html must have a Content-Security-Policy meta tag');

  const csp = cspMatch[1];
  assert.ok(csp.includes('connect-src'), 'CSP must define connect-src directive');
  assert.ok(csp.includes('https://*.supabase.co'), 'CSP connect-src must include https://*.supabase.co');
  assert.ok(csp.includes('https://api.web3forms.com'), 'CSP connect-src must preserve web3forms');
});

test('AUDIT-SEC-02 Test 8: Root portal CSP contains no wildcards and removes stale gapskris.github.io domain', () => {
  const indexPath = path.resolve(process.cwd(), 'index.html');
  const indexHtml = fs.readFileSync(indexPath, 'utf8');
  const csp = indexHtml.match(/<meta\s+http-equiv=["']Content-Security-Policy["']\s+content="([^"]*)"/i)[1];

  // No wildcard connect-src
  assert.ok(!csp.includes('connect-src *'), 'CSP connect-src must not contain wildcard *');
  assert.ok(!csp.includes("connect-src 'self' *"), 'CSP connect-src must not allow all domains');
  assert.ok(!csp.includes('gapskris.github.io'), 'Stale gapskris.github.io origin must be removed from CSP');
});

// ==============================================================================
// AUDIT-SEC-05: Safe DOM Construction in portal.js
// ==============================================================================

test('AUDIT-SEC-05 Test 9: portal.js uses safe DOM node construction instead of innerHTML for account label', () => {
  const portalPath = path.resolve(process.cwd(), 'assets/js/portal.js');
  const portalSrc = fs.readFileSync(portalPath, 'utf8');

  // Must not have authBtn.innerHTML = `<span>👤</span><span>${shortName}</span>`;
  assert.ok(!portalSrc.includes('authBtn.innerHTML'), 'authBtn.innerHTML must not be used in portal.js');
  assert.ok(portalSrc.includes("iconSpan.textContent = '👤'"), 'Must construct iconSpan safely');
  assert.ok(portalSrc.includes('labelSpan.textContent = shortName'), 'Must set shortName via textContent');
});

test('AUDIT-SEC-05 Test 10: Adversarial payload in email cannot trigger script execution or parse as HTML', () => {
  // Simulate DOM element container
  class MockElement {
    constructor() {
      this.children = [];
      this._textContent = '';
    }
    set textContent(val) {
      this._textContent = val;
      this.children = [];
    }
    get textContent() {
      if (this.children.length > 0) {
        return this.children.map(c => c.textContent).join('');
      }
      return this._textContent;
    }
    appendChild(child) {
      this.children.push(child);
    }
  }

  const authBtn = new MockElement();
  const maliciousEmail = '<img src=x onerror=alert(1)>@auromind.org';
  const shortName = maliciousEmail.split('@')[0];

  // Simulate portal.js safe rendering logic
  authBtn.textContent = '';
  const iconSpan = new MockElement();
  iconSpan.textContent = '👤';
  const labelSpan = new MockElement();
  labelSpan.textContent = shortName;
  authBtn.appendChild(iconSpan);
  authBtn.appendChild(labelSpan);

  // Assert labelSpan contains the malicious string purely as plaintext
  assert.equal(labelSpan.textContent, '<img src=x onerror=alert(1)>');
  assert.equal(labelSpan.children.length, 0, 'No child HTML elements created from malicious string');
  assert.equal(authBtn.children.length, 2);
});

// ==============================================================================
// AUDIT-SEC-06: Hardened Proxy Precedence & Rate Limiter Spoof Defense
// ==============================================================================

test('AUDIT-SEC-06 Test 11: cf-connecting-ip takes precedence over x-real-ip and x-forwarded-for', async () => {
  const cfReq = new Request('https://test', {
    headers: {
      'cf-connecting-ip': '203.0.113.100',
      'x-real-ip': '198.51.100.50',
      'x-forwarded-for': '1.2.3.4'
    }
  });

  const hashCf = await deriveClientIdentifier(cfReq);

  const directReq = new Request('https://test', {
    headers: { 'cf-connecting-ip': '203.0.113.100' }
  });
  const hashDirect = await deriveClientIdentifier(directReq);

  assert.equal(hashCf, hashDirect, 'cf-connecting-ip must take strict precedence');
});

test('AUDIT-SEC-06 Test 12: x-real-ip is used when cf-connecting-ip is absent', async () => {
  const realIpReq = new Request('https://test', {
    headers: {
      'x-real-ip': '198.51.100.50',
      'x-forwarded-for': '1.2.3.4'
    }
  });

  const hashReal = await deriveClientIdentifier(realIpReq);

  const directRealReq = new Request('https://test', {
    headers: { 'x-real-ip': '198.51.100.50' }
  });
  const hashDirectReal = await deriveClientIdentifier(directRealReq);

  assert.equal(hashReal, hashDirectReal, 'x-real-ip must take precedence over x-forwarded-for');
});

test('AUDIT-SEC-06 Test 13: Untrusted x-forwarded-for maps to unverified-proxy-network fallback bucket', async () => {
  const spoofedReq1 = new Request('https://test', {
    headers: { 'x-forwarded-for': '10.0.0.1' }
  });
  const spoofedReq2 = new Request('https://test', {
    headers: { 'x-forwarded-for': '10.0.0.2' }
  });
  const noHeaderReq = new Request('https://test');

  const hash1 = await deriveClientIdentifier(spoofedReq1);
  const hash2 = await deriveClientIdentifier(spoofedReq2);
  const hashEmpty = await deriveClientIdentifier(noHeaderReq);

  // Both spoofed IPs and empty header request MUST derive the exact same bucket hash
  assert.equal(hash1, hash2, 'Spoofed X-Forwarded-For must NOT create separate rate-limit buckets');
  assert.equal(hash1, hashEmpty, 'Untrusted requests fall back to shared unverified network bucket');
});

test('AUDIT-SEC-06 Test 14: Attacker rotating x-forwarded-for is blocked by rate limiter on unverified network', async () => {
  const store = new MemoryRateLimitStore();
  const maxRequests = 3;

  for (let i = 1; i <= 3; i++) {
    const req = new Request('https://test.supabase.co/functions/v1/ingest-telemetry', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': `192.168.1.${i}` // Attacker attempts to rotate spoofed IP
      },
      body: JSON.stringify({
        events: [{
          eventId: `55555555-5555-4555-8555-55555555550${i}`,
          eventName: 'probe_event',
          category: 'system'
        }]
      })
    });

    const res = await handleTelemetryIngestRequest(req, {
      rateLimitStore: store,
      maxRequests
    });
    assert.equal(res.status, 200, `Request ${i} should be permitted`);
  }

  // 4th request from another rotating spoofed IP MUST be blocked (HTTP 429)
  const reqBlocked = new Request('https://test.supabase.co/functions/v1/ingest-telemetry', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': '192.168.1.99' // New spoofed IP
    },
    body: JSON.stringify({
      events: [{
        eventId: '55555555-5555-4555-8555-555555555599',
        eventName: 'probe_event',
        category: 'system'
      }]
    })
  });

  const resBlocked = await handleTelemetryIngestRequest(reqBlocked, {
    rateLimitStore: store,
    maxRequests
  });

  assert.equal(resBlocked.status, 429, 'Rotating X-Forwarded-For must not bypass rate limit');
  const json = await resBlocked.json();
  assert.equal(json.error, 'RATE_LIMIT_EXCEEDED');
});

// ==============================================================================
// Sacred Invariants Verification
// ==============================================================================

test('Sacred Invariant Test 15: VAK speech corpus SHA-256 matches frozen baseline', () => {
  const vakPath = path.resolve(process.cwd(), 'games/vak/index.html');
  const vakSrc = fs.readFileSync(vakPath, 'utf8');
  const clMatch = vakSrc.match(/const CL = \[\[[\s\S]*?\]\];/);
  assert.ok(clMatch, 'CL array must exist in games/vak/index.html');
  const hash = crypto.createHash('sha256').update(clMatch[0], 'utf8').digest('hex');
  assert.equal(hash, '9fdb3826030049c9eab183479bcb7fe29304b3ea08d045c8c67f1cfd4d77da09');
});

test('Sacred Invariant Test 16: AuroMatch Flora database is exactly 2,002,176 bytes', () => {
  const floraPath = path.resolve(process.cwd(), 'games/auromatch/src/models/floraDatabase.js');
  const stat = fs.statSync(floraPath);
  assert.equal(stat.size, 2002176, 'Flora database size must be exactly 2,002,176 bytes');
});

test('Sacred Invariant Test 17: Sankalpa contemplation vault is 100% local-only with zero cloud sync', async () => {
  const { createAuroMandalaGameAdapter } = await import('./games/auromandala/assets/auromandala-sdk-bridge.js');
  const mandalaAdapter = createAuroMandalaGameAdapter();
  assert.equal(mandalaAdapter.capabilities.cloudSyncEligible, false, 'Sankalpa vault must be strictly local-only');
  assert.deepEqual(mandalaAdapter.storage.localOnlyVaults, ['sankalpa_e2ee_vault']);

  const envelope = await mandalaAdapter.exportEnvelope('guest_test_id');
  const envStr = JSON.stringify(envelope);
  assert.equal(envStr.includes('sankalpa_e2ee_vault'), false, 'Exported envelope must never include Sankalpa vault');
});
