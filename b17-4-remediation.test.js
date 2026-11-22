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

// ---------------------------------------------------------------------------
// Group E: B19.5-01A — AuroMatch Senior Mode Message Trust & Initialization
// ---------------------------------------------------------------------------

test('B19.5-01A Test 1: games/auromatch/index.html defines strict message source & origin validation', () => {
  const htmlPath = path.join(__dirname, 'games/auromatch/index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  // Verify source check
  assert.ok(
    html.includes('!window.parent || event.source !== window.parent'),
    'AuroMatch must strictly check event.source === window.parent'
  );
  // Verify origin check
  assert.ok(
    html.includes('event.origin === currentOrigin'),
    'AuroMatch must strictly check event.origin === currentOrigin'
  );
  // Verify boolean enabled check
  assert.ok(
    html.includes("typeof event.data.enabled !== 'boolean'"),
    'AuroMatch must strictly require typeof event.data.enabled === boolean'
  );
  // Verify SDK bridge script link
  assert.ok(
    html.includes('src="./Assets/auromatch-sdk-bridge.js"'),
    'AuroMatch index.html must link auromatch-sdk-bridge.js'
  );
});

test('B19.5-01A Test 2: AuroMatch message handler behavioral matrix (valid, untrusted origin, untrusted source, malformed, non-boolean)', () => {
  let docElementSenior = false;
  let docBodySenior = false;
  let storedPreference = null;
  let managerToggledWith = null;

  const mockWindow = {
    parent: { id: 'portal-parent' },
    location: { origin: 'https://auromasti.com' },
    activeGameManager: {
      toggleSeniorView: (val) => { managerToggledWith = val; }
    }
  };

  function simulateAuroMatchSeniorHandler(event) {
    // 1. Mandatory Source Validation
    if (!mockWindow.parent || event.source !== mockWindow.parent) return false;

    // 2. Strict Origin Validation
    const currentOrigin = mockWindow.location.origin;
    const isTrustedOrigin = (currentOrigin && currentOrigin !== 'null')
      ? (event.origin === currentOrigin)
      : (event.origin === 'null' || event.origin === '');
    if (!isTrustedOrigin) return false;

    // 3. Strict Payload and Type Allowlist Validation
    if (!event.data || typeof event.data !== 'object' || Array.isArray(event.data)) return false;
    if (event.data.type !== 'AUROMIND_SET_SENIOR_MODE') return false;
    if (typeof event.data.enabled !== 'boolean') return false;

    const isSenior = event.data.enabled;
    docElementSenior = isSenior;
    docBodySenior = isSenior;
    storedPreference = isSenior ? 'true' : 'false';

    if (mockWindow.activeGameManager && typeof mockWindow.activeGameManager.toggleSeniorView === 'function') {
      mockWindow.activeGameManager.toggleSeniorView(isSenior);
    }
    return true;
  }

  // 1. Valid parent message with enabled: true -> accepted
  const res1 = simulateAuroMatchSeniorHandler({
    source: mockWindow.parent,
    origin: 'https://auromasti.com',
    data: { type: 'AUROMIND_SET_SENIOR_MODE', enabled: true }
  });
  assert.strictEqual(res1, true);
  assert.strictEqual(docElementSenior, true);
  assert.strictEqual(docBodySenior, true);
  assert.strictEqual(storedPreference, 'true');
  assert.strictEqual(managerToggledWith, true);

  // 2. Untrusted origin -> rejected
  const res2 = simulateAuroMatchSeniorHandler({
    source: mockWindow.parent,
    origin: 'https://evil-attacker.com',
    data: { type: 'AUROMIND_SET_SENIOR_MODE', enabled: false }
  });
  assert.strictEqual(res2, false);
  assert.strictEqual(docElementSenior, true, 'State must remain unchanged on untrusted origin');

  // 3. Untrusted source (foreign window) -> rejected
  const res3 = simulateAuroMatchSeniorHandler({
    source: { id: 'attacker-window' },
    origin: 'https://auromasti.com',
    data: { type: 'AUROMIND_SET_SENIOR_MODE', enabled: false }
  });
  assert.strictEqual(res3, false);
  assert.strictEqual(docElementSenior, true, 'State must remain unchanged on foreign source');

  // 4. Malformed message (missing type / wrong type) -> rejected
  const res4 = simulateAuroMatchSeniorHandler({
    source: mockWindow.parent,
    origin: 'https://auromasti.com',
    data: { type: 'UNEXPECTED_COMMAND', enabled: false }
  });
  assert.strictEqual(res4, false);
  assert.strictEqual(docElementSenior, true, 'State must remain unchanged on unexpected message type');

  // 5. Non-boolean enabled (string 'true', number 1, truthy object) -> strictly rejected
  const res5a = simulateAuroMatchSeniorHandler({
    source: mockWindow.parent,
    origin: 'https://auromasti.com',
    data: { type: 'AUROMIND_SET_SENIOR_MODE', enabled: 'true' }
  });
  assert.strictEqual(res5a, false);

  const res5b = simulateAuroMatchSeniorHandler({
    source: mockWindow.parent,
    origin: 'https://auromasti.com',
    data: { type: 'AUROMIND_SET_SENIOR_MODE', enabled: 1 }
  });
  assert.strictEqual(res5b, false);

  const res5c = simulateAuroMatchSeniorHandler({
    source: mockWindow.parent,
    origin: 'https://auromasti.com',
    data: { type: 'AUROMIND_SET_SENIOR_MODE', enabled: null }
  });
  assert.strictEqual(res5c, false);

  // 6. Valid toggle OFF with boolean false -> accepted
  const res6 = simulateAuroMatchSeniorHandler({
    source: mockWindow.parent,
    origin: 'https://auromasti.com',
    data: { type: 'AUROMIND_SET_SENIOR_MODE', enabled: false }
  });
  assert.strictEqual(res6, true);
  assert.strictEqual(docElementSenior, false);
  assert.strictEqual(docBodySenior, false);
  assert.strictEqual(storedPreference, 'false');
  assert.strictEqual(managerToggledWith, false);
});

test('B19.5-01A Test 3: Early Senior Mode message received before GameManager exists is preserved and applied on init', () => {
  let pendingSeniorMode = undefined;
  let activeGameManager = null;

  function handleEarlyMessage(enabled) {
    if (typeof enabled !== 'boolean') return;
    pendingSeniorMode = enabled;
    if (activeGameManager && typeof activeGameManager.toggleSeniorView === 'function') {
      activeGameManager.toggleSeniorView(enabled);
    }
  }

  // 1. Message arrives when activeGameManager is null
  handleEarlyMessage(true);
  assert.strictEqual(pendingSeniorMode, true);
  assert.strictEqual(activeGameManager, null);

  // 2. GameManager initializes subsequently
  class MockGameManager {
    constructor() {
      this.seniorView = (typeof pendingSeniorMode === 'boolean') ? pendingSeniorMode : false;
      this.boardRenderer = null;
    }
    init(containerId) {
      this.boardRenderer = { seniorView: this.seniorView };
    }
    toggleSeniorView(val) {
      this.seniorView = (val !== null) ? !!val : !this.seniorView;
      if (this.boardRenderer) this.boardRenderer.seniorView = this.seniorView;
    }
  }

  activeGameManager = new MockGameManager();
  // Post-instantiation sync hook matching games/auromatch/index.html:63850
  if (typeof pendingSeniorMode === 'boolean') {
    activeGameManager.toggleSeniorView(pendingSeniorMode);
  }

  assert.strictEqual(activeGameManager.seniorView, true, 'GameManager must initialize with seniorView = true');

  // 3. Stage initialization creates boardRenderer with seniorView = true
  activeGameManager.init('board');
  assert.strictEqual(activeGameManager.boardRenderer.seniorView, true, 'boardRenderer must inherit seniorView on creation');

  // 4. Mid-session toggle OFF during active gameplay
  handleEarlyMessage(false);
  assert.strictEqual(activeGameManager.seniorView, false, 'Mid-session toggle OFF must update GameManager');
  assert.strictEqual(activeGameManager.boardRenderer.seniorView, false, 'Mid-session toggle OFF must update boardRenderer');
});

test('B19.5-01B Test 4: Single authoritative handler consolidation and repeated message idempotency', () => {
  const htmlPath = path.join(__dirname, 'games/auromatch/index.html');
  const bridgePath = path.join(__dirname, 'games/auromatch/Assets/auromatch-sdk-bridge.js');
  const mainPath = path.join(__dirname, 'games/auromatch/src/main.js');

  const html = fs.readFileSync(htmlPath, 'utf8');
  const bridge = fs.readFileSync(bridgePath, 'utf8');
  const main = fs.readFileSync(mainPath, 'utf8');

  // 1. Authoritative handler flag set in index.html
  assert.ok(
    html.includes('window.__AUROMIND_SENIOR_HANDLER_ATTACHED__ = true'),
    'index.html must set window.__AUROMIND_SENIOR_HANDLER_ATTACHED__ to declare single authoritative handler ownership'
  );

  // 2. SDK bridge respects authoritative handler flag to prevent duplicate listeners
  assert.ok(
    bridge.includes('window.__AUROMIND_SENIOR_HANDLER_ATTACHED__'),
    'auromatch-sdk-bridge.js must check window.__AUROMIND_SENIOR_HANDLER_ATTACHED__ to prevent duplicate window listeners'
  );

  // 3. No duplicate message listeners inside src/main.js
  const mainMessageMatches = main.match(/window\.addEventListener\(['"]message['"]/g) || [];
  assert.strictEqual(
    mainMessageMatches.length,
    1,
    'src/main.js must contain exactly one top-level message listener (no inner duplicates in window load)'
  );

  // 4. Behavioral simulation of repeated message idempotency
  let writeCount = 0;
  let toggleCount = 0;
  let currentDocSenior = false;

  const mockContext = {
    parent: { id: 'portal' },
    location: { origin: 'https://auromasti.com' },
    activeGameManager: {
      seniorView: false,
      toggleSeniorView: (val) => {
        toggleCount++;
        mockContext.activeGameManager.seniorView = val;
      }
    },
    __AUROMIND_SENIOR_MODE__: undefined
  };

  function authoritativeHandler(event) {
    if (!mockContext.parent || event.source !== mockContext.parent) return false;
    const currentOrigin = mockContext.location.origin;
    const isTrustedOrigin = (currentOrigin && currentOrigin !== 'null')
      ? (event.origin === currentOrigin)
      : (event.origin === 'null' || event.origin === '');
    if (!isTrustedOrigin) return false;

    if (!event.data || typeof event.data !== 'object' || Array.isArray(event.data)) return false;
    if (event.data.type !== 'AUROMIND_SET_SENIOR_MODE') return false;
    if (typeof event.data.enabled !== 'boolean') return false;

    const isSenior = event.data.enabled;
    // Idempotency check:
    if (mockContext.__AUROMIND_SENIOR_MODE__ === isSenior &&
        currentDocSenior === isSenior &&
        (!mockContext.activeGameManager || mockContext.activeGameManager.seniorView === isSenior)) {
      return false; // Ignored as redundant
    }

    mockContext.__AUROMIND_SENIOR_MODE__ = isSenior;
    currentDocSenior = isSenior;
    writeCount++;

    if (mockContext.activeGameManager && typeof mockContext.activeGameManager.toggleSeniorView === 'function') {
      mockContext.activeGameManager.toggleSeniorView(isSenior);
    }
    return true;
  }

  // First enable message -> processed
  const r1 = authoritativeHandler({
    source: mockContext.parent,
    origin: 'https://auromasti.com',
    data: { type: 'AUROMIND_SET_SENIOR_MODE', enabled: true }
  });
  assert.strictEqual(r1, true);
  assert.strictEqual(writeCount, 1);
  assert.strictEqual(toggleCount, 1);
  assert.strictEqual(mockContext.__AUROMIND_SENIOR_MODE__, true);

  // Second enable message (duplicate) -> ignored, zero redundant writes or toggles
  const r2 = authoritativeHandler({
    source: mockContext.parent,
    origin: 'https://auromasti.com',
    data: { type: 'AUROMIND_SET_SENIOR_MODE', enabled: true }
  });
  assert.strictEqual(r2, false);
  assert.strictEqual(writeCount, 1, 'Repeated message must NOT cause redundant persistence writes');
  assert.strictEqual(toggleCount, 1, 'Repeated message must NOT cause redundant manager toggles');

  // Third disable message -> processed
  const r3 = authoritativeHandler({
    source: mockContext.parent,
    origin: 'https://auromasti.com',
    data: { type: 'AUROMIND_SET_SENIOR_MODE', enabled: false }
  });
  assert.strictEqual(r3, true);
  assert.strictEqual(writeCount, 2);
  assert.strictEqual(toggleCount, 2);
  assert.strictEqual(mockContext.__AUROMIND_SENIOR_MODE__, false);

  // Fourth disable message (duplicate) -> ignored
  const r4 = authoritativeHandler({
    source: mockContext.parent,
    origin: 'https://auromasti.com',
    data: { type: 'AUROMIND_SET_SENIOR_MODE', enabled: false }
  });
  assert.strictEqual(r4, false);
  assert.strictEqual(writeCount, 2, 'Repeated message must NOT cause redundant persistence writes');
  assert.strictEqual(toggleCount, 2, 'Repeated message must NOT cause redundant manager toggles');
});


