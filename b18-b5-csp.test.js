/**
 * AuroMasti Platform — B18-B1 Batch 5: CSP & Security Verification Test Suite
 *
 * Covers:
 * - TASK-CSP-01: Multi-Host Production CSP & Static Edge Configs (ADR-07, ADR-10)
 * - Parity across _headers, vercel.json, netlify.toml, and server.js
 * - Verification of frame-ancestors 'self' and X-Frame-Options: SAMEORIGIN
 * - Permissions-Policy hardening without impacting Web Audio API
 * - Validation of HTML meta CSP for GitHub Pages and documentation of edge limitations
 * - Sacred Invariants: VAK speech training corpus & AuroMatch Flora database
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =============================================================================
// TASK-CSP-01: Edge Configuration Parity & Header Analysis
// =============================================================================

test('TASK-CSP-01: _headers configuration file defines all required production security headers', () => {
  const headersPath = path.join(__dirname, '_headers');
  assert.ok(fs.existsSync(headersPath), '_headers file must exist');

  const content = fs.readFileSync(headersPath, 'utf8');
  assert.ok(content.includes('X-Content-Type-Options: nosniff'));
  assert.ok(content.includes('X-Frame-Options: SAMEORIGIN'));
  assert.ok(content.includes('Referrer-Policy: strict-origin-when-cross-origin'));
  assert.ok(content.includes('Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()'));
  assert.ok(content.includes('Strict-Transport-Security: max-age=31536000; includeSubDomains; preload'));
  assert.ok(content.includes("frame-ancestors 'self'"));
  assert.ok(content.includes("object-src 'none'"));
  assert.ok(content.includes("base-uri 'self'"));
  assert.ok(content.includes('https://*.supabase.co'));
  assert.ok(content.includes('wss://*.supabase.co'));
});

test('TASK-CSP-01: vercel.json configuration defines identical security headers', () => {
  const vercelPath = path.join(__dirname, 'vercel.json');
  assert.ok(fs.existsSync(vercelPath), 'vercel.json file must exist');

  const config = JSON.parse(fs.readFileSync(vercelPath, 'utf8'));
  assert.ok(Array.isArray(config.headers), 'vercel.json must define headers array');

  const rootRule = config.headers.find(h => h.source === '/(.*)');
  assert.ok(rootRule, 'vercel.json must have catch-all header rule');

  const headerMap = new Map(rootRule.headers.map(h => [h.key.toLowerCase(), h.value]));
  assert.equal(headerMap.get('x-content-type-options'), 'nosniff');
  assert.equal(headerMap.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(headerMap.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal(headerMap.get('permissions-policy'), 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  assert.equal(headerMap.get('strict-transport-security'), 'max-age=31536000; includeSubDomains; preload');

  const csp = headerMap.get('content-security-policy');
  assert.ok(csp.includes("frame-ancestors 'self'"));
  assert.ok(csp.includes("object-src 'none'"));
  assert.ok(csp.includes("base-uri 'self'"));
  assert.ok(csp.includes('https://*.supabase.co'));
});

test('TASK-CSP-01: netlify.toml configuration defines identical security headers', () => {
  const netlifyPath = path.join(__dirname, 'netlify.toml');
  assert.ok(fs.existsSync(netlifyPath), 'netlify.toml file must exist');

  const content = fs.readFileSync(netlifyPath, 'utf8');
  assert.ok(content.includes('X-Content-Type-Options = "nosniff"'));
  assert.ok(content.includes('X-Frame-Options = "SAMEORIGIN"'));
  assert.ok(content.includes('Referrer-Policy = "strict-origin-when-cross-origin"'));
  assert.ok(content.includes('Permissions-Policy = "camera=(), microphone=(), geolocation=(), payment=(), usb=()"'));
  assert.ok(content.includes('Strict-Transport-Security = "max-age=31536000; includeSubDomains; preload"'));
  assert.ok(content.includes("frame-ancestors 'self'"));
  assert.ok(content.includes("object-src 'none'"));
  assert.ok(content.includes("base-uri 'self'"));
  assert.ok(content.includes('https://*.supabase.co'));
});

test('TASK-CSP-01: server.js response headers match edge config specifications', async () => {
  const serverModule = await import('./server.js');
  const app = serverModule.createApp();

  const server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(res.status, 200);

    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.equal(res.headers.get('permissions-policy'), 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');

    const csp = res.headers.get('content-security-policy');
    assert.ok(csp.includes("frame-ancestors 'self'"));
    assert.ok(csp.includes("object-src 'none'"));
    assert.ok(csp.includes("base-uri 'self'"));
    assert.ok(csp.includes('https://*.supabase.co'));
    assert.ok(csp.includes('wss://*.supabase.co'));
    await res.text();
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

// =============================================================================
// TASK-CSP-01: GitHub Pages Static Hosting Model & Limitations Verification
// =============================================================================

test('TASK-CSP-01: index.html meta tag provides valid CSP protection for static hosting', () => {
  const indexPath = path.join(__dirname, 'index.html');
  const html = fs.readFileSync(indexPath, 'utf8');

  const metaCspMatch = html.match(/<meta\s+http-equiv=["']Content-Security-Policy["']\s+content="([^"]*)"/i);
  assert.ok(metaCspMatch, 'index.html must have a Content-Security-Policy meta tag');

  const csp = metaCspMatch[1];
  assert.ok(csp.includes("default-src 'self'"), "Must enforce default-src 'self'");
  assert.ok(csp.includes("script-src 'self'"), "Must enforce script-src 'self'");
  assert.ok(csp.includes("frame-src 'self'"), "Must enforce frame-src 'self' to restrict framed children");
  assert.ok(csp.includes("object-src 'none'"), "Must enforce object-src 'none'");
  assert.ok(csp.includes("base-uri 'self'"), "Must enforce base-uri 'self'");
  assert.ok(csp.includes('https://*.supabase.co'), 'Must allow Supabase connection');
});

test('TASK-CSP-01: Architectural Limitation Invariant — frame-ancestors is disallowed in meta tags', () => {
  const indexPath = path.join(__dirname, 'index.html');
  const html = fs.readFileSync(indexPath, 'utf8');

  const metaCspMatch = html.match(/<meta\s+http-equiv=["']Content-Security-Policy["']\s+content="([^"]*)"/i);
  const csp = metaCspMatch[1];

  // Per W3C CSP Level 3 spec § 2.2:
  // "The frame-ancestors directive MUST be ignored when contained in a policy defined in a meta element."
  assert.equal(
    csp.includes('frame-ancestors'),
    false,
    "HTML meta CSP must NOT contain frame-ancestors because browsers explicitly ignore it in meta tags"
  );
});

// =============================================================================
// TASK-REG-01: Sacred Invariant Verification Gate
// =============================================================================

test('TASK-REG-01: Sacred Invariant — VAK 1,368-level speech training corpus matches frozen SHA-256', () => {
  const vakPath = path.join(__dirname, 'games/vak/index.html');
  const content = fs.readFileSync(vakPath, 'utf8');
  const clMatch = content.match(/const\s+CL\s*=\s*\[[\s\S]*?\];/);
  assert.ok(clMatch, 'CL array definition must be present');

  const hash = crypto.createHash('sha256').update(clMatch[0], 'utf8').digest('hex');
  assert.equal(
    hash,
    '9fdb3826030049c9eab183479bcb7fe29304b3ea08d045c8c67f1cfd4d77da09',
    'VAK corpus SHA-256 must exactly match frozen baseline'
  );
});

test('TASK-REG-01: Sacred Invariant — AuroMatch Flora database matches exact size, lines, and SHA-256', () => {
  const floraPath = path.join(__dirname, 'games/auromatch/src/models/floraDatabase.js');
  const buffer = fs.readFileSync(floraPath);

  assert.equal(buffer.length, 2002176, 'Flora database size must be exactly 2,002,176 bytes');

  const lineCount = (buffer.toString('utf8').match(/\n/g) || []).length;
  assert.equal(lineCount, 46321, 'Flora database line count must be exactly 46,321 lines');

  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  assert.equal(
    hash,
    '689d035cd52abd8d342528d8c5f61f298916b8052b8287450be4931cf8ae1a3a',
    'Flora database SHA-256 must match frozen baseline'
  );
});
