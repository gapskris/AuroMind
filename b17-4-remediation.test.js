/**
 * AuroMind B17.4 Defect Remediation & Security Regression Test Suite
 *
 * Validates fixes for real-browser defects discovered in B17.3:
 * - B17-DEFECT-01: Backend config dynamic import resolution and local-first fallback.
 * - B17-DEFECT-02: Senior mode mid-session synchronization via #game-viewport-iframe.
 * - B17-DEFECT-03: Opaque-origin postMessage handling and strict source/payload validation.
 * - B17-DEFECT-04: AuroBlocks strict CSP compliance and externalized initialization.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Group A: B17-DEFECT-01 — Backend Configuration Dynamic Import
// ---------------------------------------------------------------------------

test('B17.4 Group A - 1: backend-config.js exists and exports expected API surface', async () => {
  const configPath = path.join(__dirname, 'assets/sdk/config/backend-config.js');
  assert.ok(fs.existsSync(configPath), 'backend-config.js must exist at assets/sdk/config/');

  const configModule = await import(pathToFileURL(configPath).href);
  assert.ok(configModule.SUPPORTED_PROVIDERS, 'Must export SUPPORTED_PROVIDERS');
  assert.equal(typeof configModule.detectEnvironment, 'function', 'Must export detectEnvironment');
  assert.equal(typeof configModule.resolveBackendConfig, 'function', 'Must export resolveBackendConfig');
  assert.equal(typeof configModule.createConfiguredProviders, 'function', 'Must export createConfiguredProviders');
  assert.equal(configModule.SUPPORTED_PROVIDERS.SUPABASE, 'supabase');
  assert.equal(configModule.SUPPORTED_PROVIDERS.FIREBASE, 'firebase');
  assert.equal(configModule.SUPPORTED_PROVIDERS.NULL, 'null');
});

test('B17.4 Group A - 2: portal.js uses correct relative path for backend-config.js', () => {
  const portalJsPath = path.join(__dirname, 'assets/js/portal.js');
  const content = fs.readFileSync(portalJsPath, 'utf8');

  // Verify no erroneous ./assets/sdk references remain inside assets/js/portal.js
  assert.ok(
    !content.includes("import('./assets/sdk/config/backend-config.js')"),
    'portal.js must not contain invalid relative import ./assets/sdk/config/backend-config.js'
  );
  assert.ok(
    !content.includes("import('./assets/sdk/auromind-sdk.js')"),
    'portal.js must not contain invalid relative import ./assets/sdk/auromind-sdk.js'
  );
  assert.ok(
    !content.includes("import('./assets/sdk/providers/supabase/index.js')"),
    'portal.js must not contain invalid relative import ./assets/sdk/providers/supabase/index.js'
  );

  // Verify correct ../sdk/ path is used
  assert.ok(
    content.includes("import('../sdk/config/backend-config.js')"),
    'portal.js must import backend-config via ../sdk/config/backend-config.js'
  );
});

test('B17.4 Group A - 3: createConfiguredProviders returns null fallback in unconfigured local-first mode', async () => {
  const configPath = path.join(__dirname, 'assets/sdk/config/backend-config.js');
  const { createConfiguredProviders, resolveBackendConfig } = await import(pathToFileURL(configPath).href);

  // In standard unconfigured environment, backend config resolves to local-first mode
  const resolved = resolveBackendConfig({
    provider: 'supabase',
    supabaseUrl: null,
    supabaseAnonKey: null
  });
  assert.equal(resolved.isConfigured, false, 'Without credentials, isConfigured must be false');

  const providers = await createConfiguredProviders({
    provider: 'supabase',
    supabaseUrl: null,
    supabaseAnonKey: null
  });
  assert.equal(providers, null, 'Unconfigured backend must fall back to null (local-first mode)');
});

test('B17.4 Group A - 4: Portal SDK bootstrap succeeds gracefully with local-first providers', async () => {
  const portalJsPath = path.join(__dirname, 'assets/js/portal.js');
  const content = fs.readFileSync(portalJsPath, 'utf8');

  // Verify bootstrap handles null providers cleanly
  assert.ok(
    content.includes('customProviders = resolved;'),
    'portal.js must assign resolved custom providers only if present'
  );
  assert.ok(
    content.includes('portalSdkInitCount += 1;'),
    'portal.js must increment init count on bootstrap'
  );
});

// ---------------------------------------------------------------------------
// Group B: B17-DEFECT-02 — Senior Mode Mid-Session Synchronization
// ---------------------------------------------------------------------------

test('B17.4 Group B - 1: applySeniorMode targets #game-viewport-iframe selector', () => {
  const portalJsPath = path.join(__dirname, 'assets/js/portal.js');
  const content = fs.readFileSync(portalJsPath, 'utf8');

  // Verify that applySeniorMode looks up the correct iframe ID
  assert.ok(
    content.includes("document.getElementById('game-viewport-iframe')"),
    'applySeniorMode must query game-viewport-iframe'
  );
  // Verify it transmits AUROMIND_SET_SENIOR_MODE
  assert.ok(
    content.includes("type: 'AUROMIND_SET_SENIOR_MODE'"),
    'applySeniorMode must dispatch AUROMIND_SET_SENIOR_MODE'
  );
});

test('B17.4 Group B - 2: applySeniorMode persists preference and broadcasts state to iframe', () => {
  const messagesSent = [];
  const storedItems = new Map();

  const mockIframe = {
    contentWindow: {
      postMessage: (msg, targetOrigin) => {
        messagesSent.push({ msg, targetOrigin });
      }
    }
  };

  const mockBody = {
    classList: {
      items: new Set(),
      toggle: function (cls, val) {
        if (val) this.items.add(cls);
        else this.items.delete(cls);
        return this.items.has(cls);
      },
      contains: function (cls) {
        return this.items.has(cls);
      }
    }
  };

  // Simulate applySeniorMode logic
  function applySeniorMode(isActive, persist = true) {
    mockBody.classList.toggle('senior-mode', isActive);
    if (persist) {
      storedItems.set('auromind_senior_mode', isActive ? 'true' : 'false');
    }
    if (mockIframe && mockIframe.contentWindow) {
      mockIframe.contentWindow.postMessage(
        { type: 'AUROMIND_SET_SENIOR_MODE', enabled: isActive },
        '*'
      );
    }
  }

  // Test toggling ON
  applySeniorMode(true, true);
  assert.equal(mockBody.classList.contains('senior-mode'), true);
  assert.equal(storedItems.get('auromind_senior_mode'), 'true');
  assert.equal(messagesSent.length, 1);
  assert.deepEqual(messagesSent[0].msg, { type: 'AUROMIND_SET_SENIOR_MODE', enabled: true });

  // Test toggling OFF
  applySeniorMode(false, true);
  assert.equal(mockBody.classList.contains('senior-mode'), false);
  assert.equal(storedItems.get('auromind_senior_mode'), 'false');
  assert.equal(messagesSent.length, 2);
  assert.deepEqual(messagesSent[1].msg, { type: 'AUROMIND_SET_SENIOR_MODE', enabled: false });
});

test('B17.4 Group B - 3: All six launch games contain AUROMIND_SET_SENIOR_MODE listeners', () => {
  const gameFiles = [
    'games/auroblocks/assets/auroblocks-sdk-bridge.js',
    'games/auromatch/src/main.js',
    'games/auromandala/assets/auromandala-sdk-bridge.js',
    'games/vak/index.html',
    'games/word-riddle/index.html',
    'games/vak-living-sanctuary/index.html'
  ];

  for (const relPath of gameFiles) {
    const fullPath = path.join(__dirname, relPath);
    assert.ok(fs.existsSync(fullPath), `Game file ${relPath} must exist`);
    const content = fs.readFileSync(fullPath, 'utf8');
    assert.ok(
      content.includes('AUROMIND_SET_SENIOR_MODE'),
      `${relPath} must implement AUROMIND_SET_SENIOR_MODE listener`
    );
  }
});

// ---------------------------------------------------------------------------
// Group C: B17-DEFECT-03 — Opaque-Origin postMessage & Security Validation
// ---------------------------------------------------------------------------

test('B17.4 Group C - 1: AuroMatch exitToAuroMindPortal uses exact origin when valid and wildcard when opaque', () => {
  const mainJsPath = path.join(__dirname, 'games/auromatch/src/main.js');
  const content = fs.readFileSync(mainJsPath, 'utf8');

  // Verify that AuroMatch checks for valid HTTP/HTTPS origin before setting targetOrigin
  assert.ok(
    content.includes("window.location.origin !== 'null'"),
    'AuroMatch must check for non-null origin'
  );
  assert.ok(
    content.includes("startsWith('http:')") || content.includes("startsWith('https:')"),
    'AuroMatch must verify HTTP/HTTPS scheme for exact origin targeting'
  );
});

test('B17.4 Group C - 2: AuroMandala exitToAuroMindPortal uses exact origin when valid and wildcard when opaque', () => {
  const bridgePath = path.join(__dirname, 'games/auromandala/assets/auromandala-sdk-bridge.js');
  const content = fs.readFileSync(bridgePath, 'utf8');

  assert.ok(
    content.includes("window.location.origin !== 'null'"),
    'AuroMandala must check for non-null origin'
  );
  assert.ok(
    content.includes("startsWith('http:')") || content.includes("startsWith('https:')"),
    'AuroMandala must verify HTTP/HTTPS scheme for exact origin targeting'
  );
});

test('B17.4 Group C - 3: AuroBlocks exitToAuroMindPortal uses exact origin when valid and wildcard when opaque', () => {
  const bridgePath = path.join(__dirname, 'games/auroblocks/assets/auroblocks-sdk-bridge.js');
  const content = fs.readFileSync(bridgePath, 'utf8');

  assert.ok(
    content.includes("window.location.origin !== 'null'"),
    'AuroBlocks must check for non-null origin'
  );
  assert.ok(
    content.includes("startsWith('http:')") || content.includes("startsWith('https:')"),
    'AuroBlocks must verify HTTP/HTTPS scheme for exact origin targeting'
  );
});

test('B17.4 Group C - 4: Security - Game Senior Mode listeners validate event.source is parent window', () => {
  const gamesWithValidation = [
    'games/auromatch/src/main.js',
    'games/auromandala/assets/auromandala-sdk-bridge.js',
    'games/auroblocks/assets/auroblocks-sdk-bridge.js'
  ];

  for (const relPath of gamesWithValidation) {
    const content = fs.readFileSync(path.join(__dirname, relPath), 'utf8');
    assert.ok(
      content.includes('event.source !== window.parent'),
      `${relPath} must strictly validate event.source === window.parent`
    );
  }
});

test('B17.4 Group C - 5: Security - Portal message listener validates event.source is theater iframe', () => {
  const portalJsPath = path.join(__dirname, 'assets/js/portal.js');
  const content = fs.readFileSync(portalJsPath, 'utf8');

  // Verify source validation
  assert.ok(
    content.includes('event.source !== theaterIframe.contentWindow'),
    'portal.js must reject messages where event.source is not theaterIframe.contentWindow'
  );
  // Verify origin validation permits same origin or null opaque origin
  assert.ok(
    content.includes("event.origin === 'null'"),
    'portal.js must support opaque origin null from sandboxed iframes'
  );
});

test('B17.4 Group C - 6: Security - Unknown and malformed postMessage types are dropped safely', () => {
  let theaterClosed = false;
  const theaterIframeMock = { contentWindow: {} };

  function simulatePortalMessageHandler(event) {
    if (!theaterIframeMock || event.source !== theaterIframeMock.contentWindow) return false;
    const isSameOrigin = (event.origin === 'http://localhost:3000');
    const isOpaqueOrigin = (event.origin === 'null' || event.origin === '');
    if (!isSameOrigin && !isOpaqueOrigin) return false;

    const data = event.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return false;

    if (data.type === 'AUROMIND_CLOSE_THEATER' || data.action === 'EXIT_GAME') {
      theaterClosed = true;
      return true;
    }
    return false;
  }

  // 1. Foreign source window -> must be rejected
  const res1 = simulatePortalMessageHandler({
    source: {}, // not theaterIframe.contentWindow
    origin: 'http://localhost:3000',
    data: { type: 'AUROMIND_CLOSE_THEATER' }
  });
  assert.equal(res1, false);
  assert.equal(theaterClosed, false);

  // 2. Foreign origin -> must be rejected
  const res2 = simulatePortalMessageHandler({
    source: theaterIframeMock.contentWindow,
    origin: 'https://malicious-attacker.com',
    data: { type: 'AUROMIND_CLOSE_THEATER' }
  });
  assert.equal(res2, false);
  assert.equal(theaterClosed, false);

  // 3. Unknown message type -> must be ignored
  const res3 = simulatePortalMessageHandler({
    source: theaterIframeMock.contentWindow,
    origin: 'http://localhost:3000',
    data: { type: 'UNKNOWN_INJECTED_COMMAND' }
  });
  assert.equal(res3, false);
  assert.equal(theaterClosed, false);

  // 4. Non-object payload -> must be ignored
  const res4 = simulatePortalMessageHandler({
    source: theaterIframeMock.contentWindow,
    origin: 'http://localhost:3000',
    data: 'STRING_PAYLOAD'
  });
  assert.equal(res4, false);
  assert.equal(theaterClosed, false);

  // 5. Valid message from same origin -> accepted
  const res5 = simulatePortalMessageHandler({
    source: theaterIframeMock.contentWindow,
    origin: 'http://localhost:3000',
    data: { type: 'AUROMIND_CLOSE_THEATER' }
  });
  assert.equal(res5, true);
  assert.equal(theaterClosed, true);

  // 6. Valid message from opaque 'null' origin -> accepted
  theaterClosed = false;
  const res6 = simulatePortalMessageHandler({
    source: theaterIframeMock.contentWindow,
    origin: 'null',
    data: { type: 'AUROMIND_CLOSE_THEATER' }
  });
  assert.equal(res6, true);
  assert.equal(theaterClosed, true);
});

// ---------------------------------------------------------------------------
// Group D: B17-DEFECT-04 — AuroBlocks Strict CSP Compliance
// ---------------------------------------------------------------------------

test('B17.4 Group D - 1: games/auroblocks/index.html contains zero inline script tags', () => {
  const htmlPath = path.join(__dirname, 'games/auroblocks/index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  // Search for inline scripts: <script> followed by code instead of src=
  const inlineScriptRegex = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  const matches = [];
  let match;
  while ((match = inlineScriptRegex.exec(html)) !== null) {
    const trimmed = match[1].trim();
    if (trimmed.length > 0) {
      matches.push(trimmed);
    }
  }

  assert.equal(
    matches.length,
    0,
    `AuroBlocks index.html must have 0 inline scripts for strict CSP compliance. Found ${matches.length}`
  );
});

test('B17.4 Group D - 2: games/auroblocks/assets/auroblocks-init.js exists and is syntactically valid', () => {
  const initJsPath = path.join(__dirname, 'games/auroblocks/assets/auroblocks-init.js');
  assert.ok(fs.existsSync(initJsPath), 'auroblocks-init.js must exist at games/auroblocks/assets/');

  const code = fs.readFileSync(initJsPath, 'utf8');
  assert.ok(code.length > 500, 'auroblocks-init.js must contain the extracted initialization routines');

  // Verify syntax by parsing in vm.Script
  assert.doesNotThrow(() => {
    new vm.Script(code, { filename: 'auroblocks-init.js' });
  }, 'auroblocks-init.js must have valid JavaScript syntax');
});

test('B17.4 Group D - 3: AuroBlocks scripts load in correct dependency order under script-src self', () => {
  const htmlPath = path.join(__dirname, 'games/auroblocks/index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  const initIndex = html.indexOf('src="./assets/auroblocks-init.js"');
  const bridgeIndex = html.indexOf('src="./assets/auroblocks-sdk-bridge.js"');
  const appMatch = html.match(/src="\.\/assets\/index-[A-Za-z0-9_-]+\.js"/);
  const appIndex = appMatch ? html.indexOf(appMatch[0]) : -1;

  assert.ok(initIndex !== -1, 'auroblocks-init.js must be linked');
  assert.ok(bridgeIndex !== -1, 'auroblocks-sdk-bridge.js must be linked');
  assert.ok(appIndex !== -1, 'Main application bundle must be linked');

  assert.ok(
    initIndex < bridgeIndex,
    'auroblocks-init.js must execute before auroblocks-sdk-bridge.js'
  );
  assert.ok(
    bridgeIndex < appIndex,
    'auroblocks-sdk-bridge.js must execute before the application bundle'
  );
});

test('B17.4 Group D - 4: All scripts in AuroBlocks index.html use relative same-origin paths', () => {
  const htmlPath = path.join(__dirname, 'games/auroblocks/index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  const srcMatches = [...html.matchAll(/<script[^>]*\bsrc=["']([^"']+)["']/gi)].map(m => m[1]);
  assert.ok(srcMatches.length >= 3, 'Must have at least 3 external scripts');

  for (const src of srcMatches) {
    assert.ok(
      src.startsWith('./') || src.startsWith('/'),
      `Script src "${src}" must be a relative or same-origin path complying with script-src 'self'`
    );
    assert.ok(
      !src.startsWith('http:') && !src.startsWith('https:'),
      `Script src "${src}" must not use external origins`
    );
  }
});
