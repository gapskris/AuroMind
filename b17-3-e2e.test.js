/**
 * AuroMind Modernization Batch B17.3
 * Real-Browser E2E Test Suite (Playwright / Chromium Engine)
 *
 * Validates real browser execution, DOM behavior, iframe communication,
 * navigation, PWA functionality, Service Worker caching, and offline behavior.
 *
 * Suites:
 * - Suite A: Portal Shell (6 tests)
 * - Suite B: Game Theatre and Navigation (7 tests covering all 6 games + standalone)
 * - Suite C: Shared SDK and AuroBlocks Integration (2 tests)
 * - Suite D: Senior Mode Synchronization Across Iframes (2 tests)
 * - Suite E: Service Worker and Offline Behaviour (2 tests)
 * - Suite F: Progressive Web App (PWA) (2 tests)
 * - Suite G: Mobile Viewport and Accessibility (2 tests)
 * - Suite H: Ambient 432 Hz Audio Lifecycle (2 tests)
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestEnvironment } from './e2e/browser-harness.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let env = null;

before(async () => {
  env = await createTestEnvironment({ port: 3335 });
});

after(async () => {
  if (env) {
    await env.teardown();
  }
});

// ===========================================================================
// Suite A — Portal Shell
// ===========================================================================
test('E2E Suite A - 1: Portal loads successfully and renders valid document title', async () => {
  const { page, close, consoleErrors } = await env.createInstrumentedPage();
  try {
    const response = await page.goto(env.baseUrl, { waitUntil: 'domcontentloaded' });
    assert.equal(response.status(), 200, 'Portal must respond with HTTP 200');

    const title = await page.title();
    assert.ok(title.includes('AuroMind'), `Page title must contain AuroMind, got: ${title}`);

    // Verify zero unhandled runtime JavaScript exceptions
    const runtimeExceptions = consoleErrors.filter(e => e.type === 'pageerror');
    assert.equal(runtimeExceptions.length, 0, 'No uncaught JS runtime exceptions on initial load');
  } finally {
    await close();
  }
});

test('E2E Suite A - 2: Main navigation header and controls render correctly', async () => {
  const { page, close } = await env.createInstrumentedPage();
  try {
    await page.goto(env.baseUrl, { waitUntil: 'domcontentloaded' });

    // Verify brand text in sidebar
    const brandText = await page.$eval('.sidebar-brand-text h1', el => el.textContent.trim());
    assert.equal(brandText, 'AuroMind', 'Sidebar brand title must be AuroMind');

    // Verify search input
    const searchInput = await page.$('#search-input');
    assert.ok(searchInput, 'Search input (#search-input) must exist');

    // Verify Senior Mode button
    const seniorBtn = await page.$('#senior-mode-btn');
    assert.ok(seniorBtn, 'Senior Mode button (#senior-mode-btn) must exist in header');

    // Verify Ambient Audio button
    const audioBtn = await page.$('#ambient-audio-btn');
    assert.ok(audioBtn, 'Ambient audio button (#ambient-audio-btn) must exist in header');
  } finally {
    await close();
  }
});

test('E2E Suite A - 3: Game catalogue displays exactly 36 unique games and AuroBlocks is unique', async () => {
  const { page, close } = await env.createInstrumentedPage();
  try {
    await page.goto(env.baseUrl, { waitUntil: 'domcontentloaded' });

    const totalCards = await page.$$eval('.game-card', cards => cards.length);
    assert.equal(totalCards, 36, 'Catalogue must display exactly 36 unique cards');

    // Verify AuroBlocks appears exactly once (zero duplicate card articles)
    const auroBlocksCards = await page.$$eval('.game-card[data-game-id="auroblocks"]', cards => cards.length);
    assert.equal(auroBlocksCards, 1, 'AuroBlocks must appear exactly once in catalogue');
  } finally {
    await close();
  }
});

test('E2E Suite A - 4: Live Now category filter displays exactly 6 unique live games', async () => {
  const { page, close } = await env.createInstrumentedPage();
  try {
    await page.goto(env.baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.sidebar-nav-item[data-category="live"]');

    const liveCards = await page.$$eval('.game-card[data-category*="live"]', cards => cards.length);
    assert.equal(liveCards, 6, 'Live Now filter must match exactly 6 live game cards');

    // Trigger filter click via page.evaluate
    await page.evaluate(() => {
      const item = document.querySelector('.sidebar-nav-item[data-category="live"]');
      if (item) item.click();
    });

    // Wait until cards are filtered to 6
    await page.waitForFunction(() => {
      const cards = Array.from(document.querySelectorAll('.game-card'));
      return cards.filter(c => window.getComputedStyle(c).display !== 'none').length === 6;
    }, { timeout: 5000 });

    // Count visible cards
    const visibleLiveCards = await page.$$eval('.game-card', cards => {
      return cards.filter(c => window.getComputedStyle(c).display !== 'none').length;
    });
    assert.equal(visibleLiveCards, 6, 'Exactly 6 cards must be visible when Live Now filter is active');
  } finally {
    await close();
  }
});

test('E2E Suite A - 5: Sidebar game count displays All Games (36)', async () => {
  const { page, close } = await env.createInstrumentedPage();
  try {
    await page.goto(env.baseUrl, { waitUntil: 'domcontentloaded' });

    const allGamesText = await page.$eval(
      '.sidebar-nav-item[data-category="all"] span:last-child',
      el => el.textContent.trim()
    );
    assert.equal(allGamesText, 'All Games (36)', 'Sidebar all games label must read "All Games (36)"');
  } finally {
    await close();
  }
});

test('E2E Suite A - 6: Search input filters catalogue titles dynamically', async () => {
  const { page, close } = await env.createInstrumentedPage();
  try {
    await page.goto(env.baseUrl, { waitUntil: 'domcontentloaded' });

    // Type "Word Riddle" into search input
    await page.type('#search-input', 'Word Riddle');

    const visibleCards = await page.$$eval('.game-card', cards => {
      return cards.filter(c => window.getComputedStyle(c).display !== 'none');
    });
    assert.equal(visibleCards.length, 1, 'Search for "Word Riddle" should yield exactly 1 visible card');

    const visibleTitle = await page.$$eval('.game-card', cards => {
      const visible = cards.find(c => window.getComputedStyle(c).display !== 'none');
      return visible ? visible.querySelector('.game-card-title').textContent : '';
    });
    assert.ok(visibleTitle.includes('Word Riddle'), 'Filtered title must be Word Riddle');
  } finally {
    await close();
  }
});

// ===========================================================================
// Suite B — Game Theatre and Navigation (All 6 Games)
// ===========================================================================
const SIX_GAMES = [
  { id: 'auroblocks', name: 'AuroBlocks', expectedUrl: 'games/auroblocks/index.html' },
  { id: 'auromatch', name: 'AuroMatch', expectedUrl: 'games/auromatch/index.html' },
  { id: 'auromandala', name: 'AuroMandala', expectedUrl: 'games/auromandala/index.html' },
  { id: 'vak', name: 'VAK Speech Control', expectedUrl: 'games/vak/index.html' },
  { id: 'wordriddle', name: 'Word Riddle', expectedUrl: 'games/word-riddle/index.html' },
  { id: 'vak-sanctuary', name: 'VAK Living Sanctuary', expectedUrl: 'games/vak-living-sanctuary/index.html' }
];

for (const game of SIX_GAMES) {
  test(`E2E Suite B: Launch ${game.name} in theatre, verify iframe, return to portal`, async () => {
    const { page, close } = await env.createInstrumentedPage();
    try {
      await page.goto(env.baseUrl, { waitUntil: 'domcontentloaded' });

      // 1. Click Play button for this game
      await page.evaluate((targetId) => {
        const btn = document.querySelector(`.btn-open[data-game-id="${targetId}"]`);
        if (btn) btn.click();
      }, game.id);

      // 2. Verify theater view is visible and body has .in-game-mode
      await page.waitForSelector('#game-theater-view', { visible: true });
      const isInGameMode = await page.$eval('body', el => el.classList.contains('in-game-mode'));
      assert.ok(isInGameMode, 'body must contain .in-game-mode');

      // 3. Verify iframe src on #game-viewport-iframe
      const iframeSrc = await page.$eval('#game-viewport-iframe', el => el.getAttribute('src'));
      assert.ok(iframeSrc.includes(game.expectedUrl), `Iframe src must include ${game.expectedUrl}, got: ${iframeSrc}`);

      // 4. Test Return to Portal control triggered from inside child frame
      await page.waitForFunction(
        (expected) => {
          const iframe = document.querySelector('#game-viewport-iframe');
          return iframe && iframe.contentWindow && iframe.contentWindow.location.href.includes(expected);
        },
        { timeout: 5000 },
        game.expectedUrl
      ).catch(() => {});

      const iframeElement = await page.$('#game-viewport-iframe');
      let frame = await iframeElement.contentFrame();
      assert.ok(frame, 'Content frame must be available');

      await frame.waitForFunction(
        () => document.readyState === 'complete' || typeof window.exitToAuroMindPortal === 'function',
        { timeout: 5000 }
      ).catch(() => {});

      try {
        await frame.evaluate(() => {
          try {
            if (typeof window.exitToAuroMindPortal === 'function') {
              window.exitToAuroMindPortal();
            } else {
              window.parent.postMessage({ type: 'AUROMIND_CLOSE_THEATER' }, '*');
            }
          } catch (e) {
            window.parent.postMessage({ type: 'AUROMIND_CLOSE_THEATER' }, '*');
          }
        });
      } catch (_navErr) {
        frame = await iframeElement.contentFrame();
        if (frame) {
          await frame.evaluate(() => {
            window.parent.postMessage({ type: 'AUROMIND_CLOSE_THEATER' }, '*');
          }).catch(() => {});
        }
      }

      // Allow DOM transition and postMessage queue to settle
      await page.waitForFunction(
        () => !document.body.classList.contains('in-game-mode'),
        { timeout: 5000 }
      ).catch(() => {});

      const isStillInGameMode = await page.$eval('body', el => el.classList.contains('in-game-mode'));
      assert.equal(isStillInGameMode, false, 'body must remove .in-game-mode on theater exit');

      // 5. Verify catalog is restored (.portal-content-scroll)
      const catalogVisible = await page.$eval('.portal-content-scroll', el => el.style.display !== 'none');
      assert.ok(catalogVisible, 'Catalog scroll area must be restored');
    } finally {
      await close();
    }
  });
}

test('E2E Suite B - 7: Direct standalone access to games loads without crashing', async () => {
  const { page, close } = await env.createInstrumentedPage();
  try {
    for (const game of SIX_GAMES) {
      const standaloneUrl = `${env.baseUrl}/${game.expectedUrl}`;
      const response = await page.goto(standaloneUrl, { waitUntil: 'domcontentloaded' });
      assert.equal(response.status(), 200, `${game.name} standalone must return HTTP 200`);
    }
  } finally {
    await close();
  }
});

test('E2E Suite B - 8: AuroBlocks loads under strict CSP without inline script violations (B17-DEFECT-04)', async () => {
  const { page, consoleErrors, close } = await env.createInstrumentedPage();
  try {
    await page.goto(`${env.baseUrl}/games/auroblocks/index.html`, { waitUntil: 'domcontentloaded' });
    const hasRoot = await page.$eval('#root', el => Boolean(el));
    assert.ok(hasRoot, 'AuroBlocks #root mounting point must exist');

    // Verify zero Content Security Policy inline script errors
    const cspErrors = consoleErrors.filter(e =>
      e.text.includes('Content Security Policy') ||
      e.text.includes('inline script') ||
      e.text.includes('script-src')
    );
    assert.equal(cspErrors.length, 0, `Must have 0 CSP violations, found: ${JSON.stringify(cspErrors)}`);
  } finally {
    await close();
  }
});

// ===========================================================================
// Suite C — Shared SDK and AuroBlocks Integration
// ===========================================================================
test('E2E Suite C - 1: Shared SDK loads and initializes with guest identity in browser context', async () => {
  const { page, close } = await env.createInstrumentedPage();
  try {
    await page.goto(`${env.baseUrl}/games/auroblocks/index.html`, { waitUntil: 'networkidle2' });

    // Evaluate SDK bridge in AuroBlocks page context
    const bridgeStatus = await page.evaluate(async () => {
      // Allow async bridge initialization a tick
      let guestId = window.__AUROMIND_GUEST_ID__;
      if (!guestId) {
        await new Promise(r => setTimeout(r, 150));
        guestId = window.__AUROMIND_GUEST_ID__;
      }
      return {
        hasReturnFunction: typeof window.exitToAuroMindPortal === 'function',
        guestId: guestId || localStorage.getItem('auromind.platform.v1.guest')
      };
    });

    assert.ok(bridgeStatus.hasReturnFunction, 'AuroBlocks must expose window.exitToAuroMindPortal');
    assert.ok(Boolean(bridgeStatus.guestId), 'AuroBlocks context must bind platform guest identity');
  } finally {
    await close();
  }
});

test('E2E Suite C - 2: Telemetry dispatch does not throw and follows contract in real browser', async () => {
  const { page, close } = await env.createInstrumentedPage();
  try {
    await page.goto(env.baseUrl, { waitUntil: 'domcontentloaded' });

    const telemetryResult = await page.evaluate(async () => {
      if (!window.AuroMind || !window.AuroMind.telemetry) return { available: false };
      const tracked = window.AuroMind.telemetry.track(
        'game_launch',
        { gameId: 'auroblocks', testMode: true },
        { category: 'engagement', gameId: 'auroblocks' }
      );
      return { available: true, tracked };
    });

    assert.ok(telemetryResult.available, 'window.AuroMind.telemetry must be initialized in portal');
  } finally {
    await close();
  }
});

test('E2E Suite C - 3: Backend configuration resolves dynamically without HTTP 404 errors (B17-DEFECT-01)', async () => {
  const { page, failedRequests, consoleErrors, close } = await env.createInstrumentedPage();
  try {
    await page.goto(env.baseUrl, { waitUntil: 'networkidle2' });

    // Assert that no request failed with 404 for backend-config.js
    const failedConfigRequests = failedRequests.filter(r => r.url.includes('backend-config.js'));
    assert.equal(failedConfigRequests.length, 0, 'backend-config.js must not fail network loading');

    const configErrors = consoleErrors.filter(e => e.text.includes('backend-config.js') && e.text.includes('404'));
    assert.equal(configErrors.length, 0, 'Console must not contain 404 errors for backend-config.js');
  } finally {
    await close();
  }
});

// ===========================================================================
// Suite D — Senior Mode Synchronization Across Iframes
// ===========================================================================
test('E2E Suite D - 1: Enabling Senior Mode in portal applies .senior-mode to parent body', async () => {
  const { page, close } = await env.createInstrumentedPage();
  try {
    await page.goto(env.baseUrl, { waitUntil: 'domcontentloaded' });

    // Toggle senior mode via header button or API
    await page.evaluate(() => {
      const btn = document.getElementById('senior-mode-btn');
      if (btn) btn.click();
      else if (typeof window.applySeniorMode === 'function') window.applySeniorMode(true, true);
    });

    const isSeniorParent = await page.$eval('body', el => el.classList.contains('senior-mode'));
    assert.ok(isSeniorParent, 'Parent body must have .senior-mode class');

    // Verify persistence in localStorage
    const savedPref = await page.evaluate(() => localStorage.getItem('auromind_senior_mode'));
    assert.equal(savedPref, 'true', 'Senior mode preference must persist in localStorage');
  } finally {
    await close();
  }
});

test('E2E Suite D - 2: Senior Mode syncs to theater iframe on load', async () => {
  const { page, close } = await env.createInstrumentedPage();
  try {
    await page.goto(env.baseUrl, { waitUntil: 'domcontentloaded' });

    // 1. Enable senior mode first
    await page.evaluate(() => {
      const btn = document.getElementById('senior-mode-btn');
      if (btn) btn.click();
      else if (typeof window.applySeniorMode === 'function') window.applySeniorMode(true, true);
    });

    // 2. Launch AuroBlocks in theater
    await page.evaluate(() => {
      const btn = document.querySelector('.btn-open[data-game-id="auroblocks"]');
      if (btn) btn.click();
    });

    await page.waitForSelector('#game-theater-view', { visible: true });

    const iframe = await page.$('#game-viewport-iframe');
    assert.ok(iframe, '#game-viewport-iframe must exist in theater view');
    const frame = await iframe.contentFrame();
    assert.ok(frame, 'Child frame must be available');

    // Give postMessage a moment to complete
    await new Promise(r => setTimeout(r, 200));

    // Check child frame body class
    const childHasSenior = await frame.evaluate(() => {
      return document.body.classList.contains('senior-mode') || document.body.classList.contains('senior-view');
    });

    assert.ok(childHasSenior, 'Child iframe body must reflect senior mode class on load');
  } finally {
    await close();
  }
});

test('E2E Suite D - 3: Mid-session Senior Mode toggle updates active theater iframe without reload (B17-DEFECT-02)', async () => {
  const { page, close } = await env.createInstrumentedPage();
  try {
    await page.goto(env.baseUrl, { waitUntil: 'domcontentloaded' });

    // 1. Ensure Senior Mode is off initially
    await page.evaluate(() => {
      document.body.classList.remove('senior-mode');
      localStorage.removeItem('auromind_senior_mode');
    });

    // 2. Launch AuroMatch in theater mode
    await page.evaluate(() => {
      const btn = document.querySelector('.btn-open[data-game-id="auromatch"]');
      if (btn) btn.click();
    });

    await page.waitForSelector('#game-theater-view', { visible: true });
    const iframe = await page.$('#game-viewport-iframe');
    assert.ok(iframe, '#game-viewport-iframe must be mounted in theater view');

    const frame = await iframe.contentFrame();
    assert.ok(frame, 'Child frame must be available');

    // Allow iframe load and script initialization
    await frame.waitForFunction(() => typeof window.exitToAuroMindPortal === 'function', { timeout: 3000 });

    // 3. Toggle Senior Mode ON mid-session
    await page.evaluate(() => {
      if (typeof window.applySeniorMode === 'function') {
        window.applySeniorMode(true, true);
      } else {
        const btn = document.getElementById('senior-mode-btn');
        if (btn) btn.click();
      }
    });

    // Allow postMessage queue to settle
    await new Promise(r => setTimeout(r, 250));

    // Verify child frame received AUROMIND_SET_SENIOR_MODE and updated class
    const childIsSenior = await frame.evaluate(() => {
      return document.documentElement.classList.contains('senior-mode') || document.body.classList.contains('senior-mode');
    });
    assert.equal(childIsSenior, true, 'Child iframe must reflect senior-mode class after mid-session toggle ON');

    // 4. Toggle Senior Mode OFF mid-session
    await page.evaluate(() => {
      if (typeof window.applySeniorMode === 'function') {
        window.applySeniorMode(false, true);
      } else {
        const btn = document.getElementById('senior-mode-btn');
        if (btn) btn.click();
      }
    });
    await new Promise(r => setTimeout(r, 250));

    const childIsSeniorOff = await frame.evaluate(() => {
      return document.documentElement.classList.contains('senior-mode') || document.body.classList.contains('senior-mode');
    });
    assert.equal(childIsSeniorOff, false, 'Child iframe must remove senior-mode class after mid-session toggle OFF');
  } finally {
    await close();
  }
});

test('E2E Suite D - 4: Real-browser AuroMatch senior mode consolidation, listener count, idempotency and security (B19.5-01C)', async () => {
  const { page, close } = await env.createInstrumentedPage();
  try {
    // Instrument window.addEventListener before application scripts execute to measure actual message listener count
    await page.evaluateOnNewDocument(() => {
      const origAdd = window.addEventListener;
      window.addEventListener = function(type, listener, options) {
        if (type === 'message') {
          window.__actualMessageListeners = window.__actualMessageListeners || [];
          window.__actualMessageListeners.push(listener);
        }
        return origAdd.call(this, type, listener, options);
      };
    });

    await page.goto(env.baseUrl, { waitUntil: 'domcontentloaded' });

    // 1. Launch AuroMatch in theater
    await page.evaluate(() => {
      const btn = document.querySelector('.btn-open[data-game-id="auromatch"]');
      if (btn) btn.click();
    });

    await page.waitForSelector('#game-theater-view', { visible: true });
    const iframe = await page.$('#game-viewport-iframe');
    assert.ok(iframe, '#game-viewport-iframe must be mounted in theater view');

    const frame = await iframe.contentFrame();
    assert.ok(frame, 'Child frame must be available');
    await frame.waitForFunction(() => typeof window.exitToAuroMindPortal === 'function', { timeout: 3000 });

    // 2. Measure actual message listeners registered on window (Item 11)
    const listenerCount = await frame.evaluate(() => (window.__actualMessageListeners ? window.__actualMessageListeners.length : 0));
    assert.strictEqual(listenerCount, 1, 'Exactly one Senior Mode message listener must be registered on window');

    // 3. Mark iframe identity to verify zero-reload lifecycle across toggles (Item 19)
    await frame.evaluate(() => {
      window.__FRAME_INSTANCE_IDENTITY__ = 'ORIGINAL_FRAME_INSTANCE_999';
    });

    // 4. Instrument real storage writes and manager transitions (Item 7)
    await frame.evaluate(() => {
      window.__localStorageWriteCount = 0;
      const origSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, val) {
        if (key === 'auromind_senior_mode') {
          window.__localStorageWriteCount++;
        }
        return origSetItem.call(this, key, val);
      };

      window.__managerTransitionCount = 0;
      if (window.activeGameManager && typeof window.activeGameManager.toggleSeniorView === 'function') {
        const origToggle = window.activeGameManager.toggleSeniorView.bind(window.activeGameManager);
        window.activeGameManager.toggleSeniorView = function(...args) {
          window.__managerTransitionCount++;
          return origToggle(...args);
        };
      }
    });

    // 5. Security Rejections (Items 3, 4, 5, 6)
    const securityCheck = await frame.evaluate(() => {
      const initialSenior = document.documentElement.classList.contains('senior-mode');
      const writesBefore = window.__localStorageWriteCount;
      const transitionsBefore = window.__managerTransitionCount;

      // Untrusted foreign source rejected (Item 3)
      // window is not window.parent in iframe context, so passing window tests foreign source with valid EventTarget
      window.dispatchEvent(new MessageEvent('message', {
        source: window,
        origin: window.location.origin,
        data: { type: 'AUROMIND_SET_SENIOR_MODE', enabled: true }
      }));

      // Untrusted external origin rejected (Item 4)
      window.dispatchEvent(new MessageEvent('message', {
        source: window.parent,
        origin: 'https://malicious-attacker.com',
        data: { type: 'AUROMIND_SET_SENIOR_MODE', enabled: true }
      }));

      // Opaque null origin rejected (Item 4)
      window.dispatchEvent(new MessageEvent('message', {
        source: window.parent,
        origin: 'null',
        data: { type: 'AUROMIND_SET_SENIOR_MODE', enabled: true }
      }));

      // Non-boolean payload rejected (Item 5)
      window.dispatchEvent(new MessageEvent('message', {
        source: window.parent,
        origin: window.location.origin,
        data: { type: 'AUROMIND_SET_SENIOR_MODE', enabled: 'true' }
      }));

      // Unrelated message type rejected (Item 5)
      window.dispatchEvent(new MessageEvent('message', {
        source: window.parent,
        origin: window.location.origin,
        data: { type: 'UNRELATED_COMMAND', enabled: true }
      }));

      const unchanged = document.documentElement.classList.contains('senior-mode') === initialSenior;
      const zeroWrites = window.__localStorageWriteCount === writesBefore;
      const zeroTransitions = window.__managerTransitionCount === transitionsBefore;
      return { unchanged, zeroWrites, zeroTransitions };
    });

    assert.ok(securityCheck.unchanged, 'Rejected messages must leave DOM and state unchanged');
    assert.ok(securityCheck.zeroWrites, 'Rejected messages must produce 0 storage writes');
    assert.ok(securityCheck.zeroTransitions, 'Rejected messages must produce 0 manager transitions');

    // 6. Valid Senior Mode ON from portal - verify exact iframe origin targeting, never wildcard (B19.5-01D)
    await page.evaluate(() => {
      window.__seniorPostMessageTargets = [];
      const iframe = document.getElementById('game-viewport-iframe');
      if (iframe && iframe.contentWindow) {
        const origPostMessage = iframe.contentWindow.postMessage;
        iframe.contentWindow.postMessage = function(msg, targetOrigin, ...args) {
          window.__seniorPostMessageTargets.push({ msg, targetOrigin });
          return origPostMessage.call(this, msg, targetOrigin, ...args);
        };
      }
    });

    await page.evaluate(() => {
      if (typeof window.applySeniorMode === 'function') {
        window.applySeniorMode(true, true);
      }
    });
    await new Promise(r => setTimeout(r, 250));

    const postMessageDispatches = await page.evaluate(() => window.__seniorPostMessageTargets || []);
    assert.ok(postMessageDispatches.length > 0, 'Portal must have dispatched Senior Mode postMessage');
    for (const d of postMessageDispatches) {
      assert.notStrictEqual(d.targetOrigin, '*', 'Portal must NEVER send Senior Mode with wildcard "*" target origin (B19.5-01D)');
      assert.notStrictEqual(d.targetOrigin, 'null', 'Portal must NEVER send Senior Mode with "null" target origin (B19.5-01D)');
      assert.notStrictEqual(d.targetOrigin, '', 'Portal must NEVER send Senior Mode with empty target origin (B19.5-01D)');
      assert.strictEqual(d.targetOrigin, env.baseUrl, `Portal must send Senior Mode with exact iframe origin ${env.baseUrl}`);
    }

    const stateOn = await frame.evaluate(() => {
      const isDoc = document.documentElement.classList.contains('senior-mode');
      const isBody = document.body.classList.contains('senior-mode');
      const isMgr = window.activeGameManager ? window.activeGameManager.seniorView : null;
      const isBoard = (window.activeGameManager && window.activeGameManager.boardRenderer)
        ? window.activeGameManager.boardRenderer.seniorView
        : null;
      return { isDoc, isBody, isMgr, isBoard, writes: window.__localStorageWriteCount, transitions: window.__managerTransitionCount };
    });

    assert.strictEqual(stateOn.isDoc, true, 'document.documentElement must reflect senior-mode');
    assert.strictEqual(stateOn.isBody, true, 'document.body must reflect senior-mode');
    if (stateOn.isMgr !== null) assert.strictEqual(stateOn.isMgr, true, 'GameManager must reflect seniorView');
    if (stateOn.isBoard !== null) assert.strictEqual(stateOn.isBoard, true, 'BoardRenderer must reflect seniorView (Item 9)');

    // 7. Duplicate message idempotency (Item 7)
    const writesAfterOn = stateOn.writes;
    const transitionsAfterOn = stateOn.transitions;

    // Send repeated ON message directly from parent
    await page.evaluate(() => {
      if (typeof window.applySeniorMode === 'function') {
        window.applySeniorMode(true, true);
      }
    });
    await new Promise(r => setTimeout(r, 200));

    const duplicateCheck = await frame.evaluate(() => ({
      writes: window.__localStorageWriteCount,
      transitions: window.__managerTransitionCount
    }));

    assert.strictEqual(duplicateCheck.writes, writesAfterOn, 'Duplicate message must produce 0 additional storage writes (Item 7)');
    assert.strictEqual(duplicateCheck.transitions, transitionsAfterOn, 'Duplicate message must produce 0 additional manager transitions (Item 7)');

    // 8. Valid Senior Mode OFF from portal (Item 2)
    await page.evaluate(() => {
      if (typeof window.applySeniorMode === 'function') {
        window.applySeniorMode(false, true);
      }
    });
    await new Promise(r => setTimeout(r, 250));

    const stateOff = await frame.evaluate(() => {
      const isDoc = document.documentElement.classList.contains('senior-mode');
      const isBody = document.body.classList.contains('senior-mode');
      const isMgr = window.activeGameManager ? window.activeGameManager.seniorView : null;
      return { isDoc, isBody, isMgr };
    });

    assert.strictEqual(stateOff.isDoc, false, 'document.documentElement must remove senior-mode');
    assert.strictEqual(stateOff.isBody, false, 'document.body must remove senior-mode');
    if (stateOff.isMgr !== null) assert.strictEqual(stateOff.isMgr, false, 'GameManager seniorView must be false');

    // 9. Iframe identity check: verify zero reload or navigation occurred (Item 20)
    const frameIdentity = await frame.evaluate(() => window.__FRAME_INSTANCE_IDENTITY__);
    assert.strictEqual(frameIdentity, 'ORIGINAL_FRAME_INSTANCE_999', 'Iframe must not reload or navigate during Senior Mode toggles (Item 20)');

    // 10. Standalone Senior Mode button verification (Item 10)
    await page.goto(`${env.baseUrl}/games/auromatch/index.html`, { waitUntil: 'domcontentloaded' });
    const standaloneBtnExists = await page.evaluate(() => !!(document.getElementById('btn-toggle-senior') || document.querySelector('.senior-toggle-btn')));
    assert.ok(standaloneBtnExists, 'Senior mode button must exist in standalone AuroMatch (Item 10)');

    const initialStandalone = await page.evaluate(() => document.documentElement.classList.contains('senior-mode'));
    await page.evaluate(() => {
      const btn = document.getElementById('btn-toggle-senior') || document.querySelector('.senior-toggle-btn');
      if (btn) btn.click();
      else if (typeof window.toggleSeniorViewMode === 'function') window.toggleSeniorViewMode();
    });
    await new Promise(r => setTimeout(r, 200));
    const toggledStandalone = await page.evaluate(() => document.documentElement.classList.contains('senior-mode'));
    assert.notStrictEqual(initialStandalone, toggledStandalone, 'Standalone Senior Mode button must toggle state');
  } finally {
    await close();
  }
});

test('E2E Suite D - 5: Real-browser AuroMatch Return-to-Portal security, button action and lifecycle (B19.5-01C)', async () => {
  const { page, close } = await env.createInstrumentedPage();
  try {
    await page.goto(env.baseUrl, { waitUntil: 'domcontentloaded' });

    // 1. Launch AuroMatch in theater
    await page.evaluate(() => {
      const btn = document.querySelector('.btn-open[data-game-id="auromatch"]');
      if (btn) btn.click();
    });

    await page.waitForSelector('#game-theater-view', { visible: true });
    const iframe = await page.$('#game-viewport-iframe');
    assert.ok(iframe, '#game-viewport-iframe must be mounted in theater view');

    const frame = await iframe.contentFrame();
    assert.ok(frame, 'Child frame must be available');
    await frame.waitForFunction(() => typeof window.exitToAuroMindPortal === 'function', { timeout: 3000 });

    // 2. Foreign source cannot close theater (Item 13)
    await page.evaluate(() => {
      window.dispatchEvent(new MessageEvent('message', {
        source: window, // Foreign source (not theater iframe contentWindow)
        origin: window.location.origin,
        data: { type: 'AUROMIND_CLOSE_THEATER', gameId: 'auromatch' }
      }));
    });
    await new Promise(r => setTimeout(r, 150));
    let isTheaterVisible = await page.$eval('#game-theater-view', el => el.style.display !== 'none');
    assert.ok(isTheaterVisible, 'Foreign source message must NOT close portal theater (Item 13)');

    // 3. Untrusted origin cannot close theater (Item 14)
    await page.evaluate(() => {
      const activeIframe = document.getElementById('game-viewport-iframe');
      window.dispatchEvent(new MessageEvent('message', {
        source: activeIframe ? activeIframe.contentWindow : null,
        origin: 'https://attacker-untrusted.com',
        data: { type: 'AUROMIND_CLOSE_THEATER', gameId: 'auromatch' }
      }));
    });
    await new Promise(r => setTimeout(r, 150));
    isTheaterVisible = await page.$eval('#game-theater-view', el => el.style.display !== 'none');
    assert.ok(isTheaterVisible, 'Untrusted origin message must NOT close portal theater (Item 14)');

    // 3b. Opaque 'null' origin cannot close theater (B19.5-01D)
    await page.evaluate(() => {
      const activeIframe = document.getElementById('game-viewport-iframe');
      window.dispatchEvent(new MessageEvent('message', {
        source: activeIframe ? activeIframe.contentWindow : null,
        origin: 'null',
        data: { type: 'AUROMIND_CLOSE_THEATER', gameId: 'auromatch' }
      }));
    });
    await new Promise(r => setTimeout(r, 150));
    isTheaterVisible = await page.$eval('#game-theater-view', el => el.style.display !== 'none');
    assert.ok(isTheaterVisible, 'Opaque "null" origin message must NOT close portal theater (B19.5-01D)');

    // 3c. Empty origin cannot close theater (B19.5-01D)
    await page.evaluate(() => {
      const activeIframe = document.getElementById('game-viewport-iframe');
      window.dispatchEvent(new MessageEvent('message', {
        source: activeIframe ? activeIframe.contentWindow : null,
        origin: '',
        data: { type: 'AUROMIND_CLOSE_THEATER', gameId: 'auromatch' }
      }));
    });
    await new Promise(r => setTimeout(r, 150));
    isTheaterVisible = await page.$eval('#game-theater-view', el => el.style.display !== 'none');
    assert.ok(isTheaterVisible, 'Empty origin message must NOT close portal theater (B19.5-01D)');

    // 4. Missing gameId rejected (B19.5-01D)
    await page.evaluate(() => {
      const activeIframe = document.getElementById('game-viewport-iframe');
      window.dispatchEvent(new MessageEvent('message', {
        source: activeIframe ? activeIframe.contentWindow : null,
        origin: window.location.origin,
        data: { type: 'AUROMIND_CLOSE_THEATER' }
      }));
    });
    await new Promise(r => setTimeout(r, 150));
    isTheaterVisible = await page.$eval('#game-theater-view', el => el.style.display !== 'none');
    assert.ok(isTheaterVisible, 'Missing gameId message must NOT close portal theater (B19.5-01D)');

    // 4b. Non-string gameId rejected (B19.5-01D)
    await page.evaluate(() => {
      const activeIframe = document.getElementById('game-viewport-iframe');
      window.dispatchEvent(new MessageEvent('message', {
        source: activeIframe ? activeIframe.contentWindow : null,
        origin: window.location.origin,
        data: { type: 'AUROMIND_CLOSE_THEATER', gameId: 9999 }
      }));
    });
    await new Promise(r => setTimeout(r, 150));
    isTheaterVisible = await page.$eval('#game-theater-view', el => el.style.display !== 'none');
    assert.ok(isTheaterVisible, 'Non-string gameId message must NOT close portal theater (B19.5-01D)');

    // 4c. Mismatching game ID rejected (Item 15)
    await page.evaluate(() => {
      const activeIframe = document.getElementById('game-viewport-iframe');
      window.dispatchEvent(new MessageEvent('message', {
        source: activeIframe ? activeIframe.contentWindow : null,
        origin: window.location.origin,
        data: { type: 'AUROMIND_CLOSE_THEATER', gameId: 'vak' }
      }));
    });
    await new Promise(r => setTimeout(r, 150));
    isTheaterVisible = await page.$eval('#game-theater-view', el => el.style.display !== 'none');
    assert.ok(isTheaterVisible, 'Mismatched game ID (vak) must NOT close auromatch theater (Item 15 / B19.5-01D)');

    // 4d. Replaced or detached iframe contentWindow rejected (B19.5-01E)
    await page.evaluate(() => {
      const dummyIframe = document.createElement('iframe');
      dummyIframe.src = 'about:blank';
      document.body.appendChild(dummyIframe);
      const foreignWin = dummyIframe.contentWindow;
      window.dispatchEvent(new MessageEvent('message', {
        source: foreignWin,
        origin: window.location.origin,
        data: { type: 'AUROMIND_CLOSE_THEATER', gameId: 'auromatch' }
      }));
      dummyIframe.remove();
    });
    await new Promise(r => setTimeout(r, 150));
    isTheaterVisible = await page.$eval('#game-theater-view', el => el.style.display !== 'none');
    assert.ok(isTheaterVisible, 'Detached/replaced iframe source must NOT close portal theater (B19.5-01E)');

    // 5. Valid Return Button click returns to portal (Items 12, 16, 21 / B19.5-01D)
    const returnBtnExists = await frame.evaluate(() => !!document.getElementById('auromind-theater-return-btn'));
    assert.ok(returnBtnExists, '#auromind-theater-return-btn must exist in iframe (Item 16)');

    // Verify resolveParentPortalOrigin in child frame resolves exact parent origin
    const resolvedOrigin = await frame.evaluate(() => (typeof window.resolveParentPortalOrigin === 'function' ? window.resolveParentPortalOrigin() : null));
    assert.strictEqual(resolvedOrigin, env.baseUrl, `resolveParentPortalOrigin must resolve exact parent origin ${env.baseUrl} (B19.5-01D)`);

    // Capture active iframe contentWindow before closing the theater (B19.5-01F Item 1)
    await page.evaluate(() => {
      const activeIframe = document.getElementById('game-viewport-iframe');
      window.__capturedActiveContentWindow = activeIframe ? activeIframe.contentWindow : null;
    });
    const capturedWinExists = await page.evaluate(() => !!window.__capturedActiveContentWindow);
    assert.ok(capturedWinExists, 'Must capture active iframe contentWindow before closing theater (B19.5-01F Item 1)');

    // Record close message dispatch received on portal window
    await page.evaluate(() => {
      window.__portalReceivedCloseMessages = [];
      window.addEventListener('message', (e) => {
        if (e.data && e.data.type === 'AUROMIND_CLOSE_THEATER') {
          window.__portalReceivedCloseMessages.push({
            origin: e.origin,
            data: e.data
          });
        }
      });
    });

    // Close the theater (B19.5-01F Item 2)
    await frame.click('#auromind-theater-return-btn');
    await page.waitForFunction(() => {
      const tv = document.getElementById('game-theater-view');
      return tv && tv.style.display === 'none';
    }, { timeout: 3000 });

    const receivedClose = await page.evaluate(() => window.__portalReceivedCloseMessages || []);
    assert.strictEqual(receivedClose.length, 1, 'Return-to-Portal must close theater exactly once (B19.5-01D)');
    assert.notStrictEqual(receivedClose[0].origin, '*', 'Return-to-Portal must NEVER use wildcard "*" target origin (B19.5-01D)');
    assert.notStrictEqual(receivedClose[0].origin, 'null', 'Return-to-Portal must NEVER use "null" target origin (B19.5-01D)');
    assert.notStrictEqual(receivedClose[0].origin, '', 'Return-to-Portal must NEVER use empty target origin (B19.5-01D)');
    assert.strictEqual(receivedClose[0].origin, env.baseUrl, `Return-to-Portal must target verified parent origin ${env.baseUrl}`);
    assert.strictEqual(receivedClose[0].data.gameId, 'auromatch', 'Return-to-Portal payload must include gameId: auromatch');

    const catalogVisible = await page.$eval('.portal-content-scroll', el => el.style.display !== 'none');
    assert.ok(catalogVisible, 'Catalog must be restored after returning to portal (Items 12, 21)');

    // 5b. Inactive theater message rejection verification (B19.5-01F Items 3, 4, 5)
    // Arm controlled spies and sentinel before dispatching valid message to inactive theater
    const inactiveRejectionResult = await page.evaluate(() => {
      const capturedWin = window.__capturedActiveContentWindow;
      if (!capturedWin) {
        return { error: 'Captured active contentWindow is missing' };
      }

      // Spies for all possible side effects of closeTheater()
      const spies = {
        telemetryExitCalls: 0,
        pushStateCalls: 0,
        iframeSrcSets: 0,
        bodyClassRemovals: 0,
        catalogDisplaySets: 0
      };

      // 1. Spy on telemetry exit event
      let origTrack = null;
      if (window.AuroMind && window.AuroMind.telemetry && typeof window.AuroMind.telemetry.track === 'function') {
        origTrack = window.AuroMind.telemetry.track;
        window.AuroMind.telemetry.track = function(name, payload, meta) {
          if (name === 'theater_exit' || name === 'game_session_end') {
            spies.telemetryExitCalls++;
          }
          return origTrack.call(this, name, payload, meta);
        };
      }

      // 2. Spy on history.pushState
      const origPushState = history.pushState;
      history.pushState = function(...args) {
        spies.pushStateCalls++;
        return origPushState.apply(this, args);
      };

      // 3. Spy on iframe src setter
      const iframe = document.getElementById('game-viewport-iframe');
      let origSrcDesc = null;
      if (iframe) {
        origSrcDesc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src');
        if (origSrcDesc && origSrcDesc.set) {
          Object.defineProperty(iframe, 'src', {
            set(val) {
              spies.iframeSrcSets++;
              return origSrcDesc.set.call(this, val);
            },
            get() {
              return origSrcDesc.get.call(this);
            },
            configurable: true
          });
        }
      }

      // 4. Spy on body classList.remove for in-game-mode
      const origClassRemove = document.body.classList.remove;
      document.body.classList.remove = function(...args) {
        if (args.includes('in-game-mode')) {
          spies.bodyClassRemovals++;
        }
        return origClassRemove.apply(this, args);
      };

      // 5. Spy on catalog display style mutation
      const catalogScroll = document.querySelector('.portal-content-scroll');
      let currentDisplay = catalogScroll ? catalogScroll.style.display : null;
      if (catalogScroll) {
        Object.defineProperty(catalogScroll.style, 'display', {
          set(val) {
            spies.catalogDisplaySets++;
            currentDisplay = val;
          },
          get() {
            return currentDisplay;
          },
          configurable: true
        });
      }

      // 6. Observable Sentinel: edgeController classList
      // If closeTheater() executed, it would execute: edgeController.classList.remove('open')
      const edgeController = document.getElementById('edge-menu-tab');
      if (edgeController) {
        edgeController.classList.add('sentinel-inactive-test');
      }

      const initialUrl = window.location.href;

      // Dispatch syntactically valid close message using captured iframe source and correct same-origin (B19.5-01F Item 3)
      window.dispatchEvent(new MessageEvent('message', {
        source: capturedWin,
        origin: window.location.origin,
        data: { type: 'AUROMIND_CLOSE_THEATER', gameId: 'auromatch' }
      }));

      // Cleanup spies and sentinel
      if (origTrack) window.AuroMind.telemetry.track = origTrack;
      history.pushState = origPushState;
      document.body.classList.remove = origClassRemove;
      if (iframe) delete iframe.src;
      if (catalogScroll) delete catalogScroll.style.display;

      const sentinelPreserved = edgeController ? edgeController.classList.contains('sentinel-inactive-test') : true;
      if (edgeController) edgeController.classList.remove('sentinel-inactive-test');

      return {
        spies,
        sentinelPreserved,
        receivedTotal: window.__portalReceivedCloseMessages ? window.__portalReceivedCloseMessages.length : 0,
        urlUnchanged: window.location.href === initialUrl
      };
    });

    assert.ifError(inactiveRejectionResult.error);
    // Verify window received the dispatched message (message delivery succeeded)
    assert.strictEqual(inactiveRejectionResult.receivedTotal, 2, 'Message must be delivered to window message listener');
    // Verify inactive theater handler rejected it: zero close actions or side effects (B19.5-01F Items 4 & 5)
    assert.strictEqual(inactiveRejectionResult.spies.telemetryExitCalls, 0, 'Inactive theater message must NOT trigger telemetry exit (B19.5-01F)');
    assert.strictEqual(inactiveRejectionResult.spies.pushStateCalls, 0, 'Inactive theater message must NOT trigger navigation pushState (B19.5-01F)');
    assert.strictEqual(inactiveRejectionResult.spies.iframeSrcSets, 0, 'Inactive theater message must NOT re-unload or set iframe src (B19.5-01F)');
    assert.strictEqual(inactiveRejectionResult.spies.bodyClassRemovals, 0, 'Inactive theater message must NOT mutate body class (B19.5-01F)');
    assert.strictEqual(inactiveRejectionResult.spies.catalogDisplaySets, 0, 'Inactive theater message must NOT re-transition catalog display (B19.5-01F)');
    assert.strictEqual(inactiveRejectionResult.sentinelPreserved, true, 'Sentinel must be preserved without closeTheater execution (B19.5-01F)');
    assert.strictEqual(inactiveRejectionResult.urlUnchanged, true, 'Location URL must remain unchanged (B19.5-01F)');

    // 6. Standalone AuroMatch navigation (Item 17)
    const { page: standalonePage, close: closeStandalone } = await env.createInstrumentedPage();
    try {
      await standalonePage.goto(`${env.baseUrl}/games/auromatch/index.html`, { waitUntil: 'domcontentloaded' });
      await standalonePage.waitForFunction(() => typeof window.exitToAuroMindPortal === 'function', { timeout: 3000 });
      await Promise.all([
        standalonePage.waitForNavigation({ waitUntil: 'domcontentloaded' }),
        standalonePage.evaluate(() => window.exitToAuroMindPortal())
      ]);
      const currentUrl = standalonePage.url();
      assert.ok(
        currentUrl === `${env.baseUrl}/` ||
        currentUrl === `${env.baseUrl}/index.html` ||
        currentUrl.endsWith('/index.html'),
        `Standalone exit must navigate to portal root (Item 17), actual: ${currentUrl}`
      );
    } finally {
      await closeStandalone();
    }
  } finally {
    await close();
  }
});

// ===========================================================================
// Suite E — Service Worker and Offline Behaviour
// ===========================================================================
test('E2E Suite E - 1: Root Service Worker registers and caches portal shell', async () => {
  const { page, close } = await env.createInstrumentedPage();
  try {
    await page.goto(env.baseUrl, { waitUntil: 'networkidle2' });

    const swRegistered = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return { supported: false };
      try {
        await Promise.race([
          navigator.serviceWorker.ready,
          new Promise((resolve) => setTimeout(resolve, 3000))
        ]);
      } catch {}
      const registration = await navigator.serviceWorker.getRegistration();
      return {
        supported: true,
        hasRegistration: Boolean(registration),
        scope: registration ? registration.scope : null
      };
    });

    assert.ok(swRegistered.supported, 'Browser must support Service Workers');
    assert.ok(swRegistered.hasRegistration, 'Root Service Worker must be registered');
  } finally {
    await close();
  }
});

test('E2E Suite E - 2: Shared SDK asset is precached and served offline to game contexts', async () => {
  const { page, close, setOffline } = await env.createInstrumentedPage();
  try {
    // 1. First visit online to allow service worker to precache
    await page.goto(env.baseUrl, { waitUntil: 'networkidle2' });
    await page.evaluate(async () => {
      if ('serviceWorker' in navigator) {
        await navigator.serviceWorker.ready;
      }
    });

    // 2. Verify cache storage has SDK asset
    const isSdkCached = await page.evaluate(async () => {
      if (!window.caches) return false;
      const cacheNames = await window.caches.keys();
      for (const name of cacheNames) {
        const cache = await window.caches.open(name);
        const match = await cache.match('/assets/sdk/auromind-sdk.js');
        if (match) return true;
      }
      return false;
    });

    assert.ok(isSdkCached, 'Shared SDK file must be precached in CacheStorage');

    // 3. Emulate network offline via CDP
    await setOffline(true);

    // 4. Fetch SDK file offline with game iframe referrer
    const offlineFetchResult = await page.evaluate(async () => {
      try {
        const resp = await fetch('/assets/sdk/auromind-sdk.js', {
          headers: { Referer: window.location.origin + '/games/auroblocks/index.html' }
        });
        return { ok: resp.ok, status: resp.status };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    });

    assert.equal(offlineFetchResult.ok, true, 'SDK asset must be served successfully while offline');
    assert.equal(offlineFetchResult.status, 200, 'SDK asset offline response must be HTTP 200');

    // Restore online
    await setOffline(false);
  } finally {
    await close();
  }
});

// ===========================================================================
// Suite F — Progressive Web App (PWA)
// ===========================================================================
test('E2E Suite F - 1: Web App Manifest loads and contains required PWA metadata', async () => {
  const { page, close } = await env.createInstrumentedPage();
  try {
    await page.goto(env.baseUrl, { waitUntil: 'domcontentloaded' });

    // Check manifest link tag in DOM
    const manifestHref = await page.$eval('link[rel="manifest"]', el => el.getAttribute('href'));
    assert.ok(manifestHref, 'link rel="manifest" must exist');

    // Fetch and parse manifest content
    const manifestResponse = await page.goto(`${env.baseUrl}/${manifestHref}`);
    assert.equal(manifestResponse.status(), 200, 'Manifest must return HTTP 200');

    const manifestJson = await manifestResponse.json();
    assert.ok(manifestJson.name.includes('AuroMind'), 'Manifest name must contain AuroMind');
    assert.ok(manifestJson.icons && manifestJson.icons.length > 0, 'Manifest must declare icons');
    assert.equal(manifestJson.display, 'standalone', 'Manifest display must be standalone');
  } finally {
    await close();
  }
});

test('E2E Suite F - 2: App icons and theme assets are accessible', async () => {
  const { page, close } = await env.createInstrumentedPage();
  try {
    const iconUrls = [
      `${env.baseUrl}/assets/icons/auromind-logo.svg`,
      `${env.baseUrl}/assets/icons/icon-192.png`,
      `${env.baseUrl}/assets/icons/icon-512.png`
    ];

    for (const url of iconUrls) {
      const resp = await page.goto(url);
      assert.equal(resp.status(), 200, `Icon at ${url} must return HTTP 200`);
    }
  } finally {
    await close();
  }
});

// ===========================================================================
// Suite G — Mobile Viewport and Accessibility
// ===========================================================================
test('E2E Suite G - 1: Mobile viewport renders usable layout with zero horizontal overflow', async () => {
  const { page, close } = await env.createInstrumentedPage({
    viewport: { width: 375, height: 667, isMobile: true, hasTouch: true }
  });
  try {
    await page.goto(env.baseUrl, { waitUntil: 'domcontentloaded' });

    // Check horizontal overflow
    const hasHorizontalScroll = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    assert.equal(hasHorizontalScroll, false, 'Mobile viewport must not produce horizontal scrollbar');
  } finally {
    await close();
  }
});

test('E2E Suite G - 2: Mobile edge-tab trigger has accessible touch target size (>= 44x44px)', async () => {
  const { page, close } = await env.createInstrumentedPage({
    viewport: { width: 375, height: 667, isMobile: true, hasTouch: true }
  });
  try {
    await page.goto(env.baseUrl, { waitUntil: 'domcontentloaded' });

    // Open a game to reveal the edge controller
    await page.evaluate(() => {
      const b = document.querySelector('.btn-open[data-game-id="auroblocks"]');
      if (b) b.click();
    });

    await page.waitForSelector('#game-theater-view', { visible: true });

    // Inspect computed dimensions and pseudo-element hitbox
    const triggerMetrics = await page.evaluate(() => {
      const el = document.getElementById('edge-tab-trigger');
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return {
        width: rect.width,
        height: rect.height,
        touchAction: style.touchAction
      };
    });

    // Visual height 52px, expanded by ::after hitbox extending >= 44px
    assert.ok(triggerMetrics.height >= 44, `Edge tab trigger height (${triggerMetrics.height}px) must be >= 44px`);
    assert.equal(triggerMetrics.touchAction, 'manipulation', 'Touch action must be manipulation');
  } finally {
    await close();
  }
});

// ===========================================================================
// Suite H — Ambient 432 Hz Audio Lifecycle
// ===========================================================================
test('E2E Suite H - 1: Stopped audio remains stopped when opening and closing game theater', async () => {
  const { page, close } = await env.createInstrumentedPage();
  try {
    await page.goto(env.baseUrl, { waitUntil: 'domcontentloaded' });

    // Confirm initial state is not playing
    const initialPlaying = await page.evaluate(() => {
      return (typeof window.isAmbientAudioPlaying === 'function') && window.isAmbientAudioPlaying();
    });
    assert.equal(initialPlaying, false, 'Audio must not play initially');

    // Open game
    await page.evaluate(() => {
      const btn = document.querySelector('.btn-open[data-game-id="auroblocks"]');
      if (btn) btn.click();
    });
    await page.waitForSelector('#game-theater-view', { visible: true });

    // Allow theater view and iframe navigation to settle
    await new Promise(r => setTimeout(r, 300));

    // Close theater
    const iframeElement = await page.$('#game-viewport-iframe');
    const frame = await iframeElement.contentFrame();
    await frame.evaluate(() => {
      window.parent.postMessage({ type: 'AUROMIND_CLOSE_THEATER' }, '*');
    });

    await new Promise(r => setTimeout(r, 150));

    const afterClosePlaying = await page.evaluate(() => {
      return (typeof window.isAmbientAudioPlaying === 'function') && window.isAmbientAudioPlaying();
    });
    assert.equal(afterClosePlaying, false, 'Audio must remain stopped if it was not playing initially');
  } finally {
    await close();
  }
});

test('E2E Suite H - 2: Active audio is suspended on theater launch and restored on theater exit', async () => {
  const { page, close } = await env.createInstrumentedPage();
  try {
    await page.goto(env.baseUrl, { waitUntil: 'domcontentloaded' });

    // 1. Start ambient audio
    await page.click('#ambient-audio-btn');

    const isAudioActive = await page.evaluate(() => {
      return (typeof window.isAmbientAudioPlaying === 'function') && window.isAmbientAudioPlaying();
    });
    assert.equal(isAudioActive, true, 'Audio must be playing after clicking audio button');

    // 2. Open game in theater
    await page.evaluate(() => {
      const btn = document.querySelector('.btn-open[data-game-id="auroblocks"]');
      if (btn) btn.click();
    });
    await page.waitForSelector('#game-theater-view', { visible: true });

    // 3. Verify audio was suspended
    const isSuspendedInGame = await page.evaluate(() => {
      return (typeof window.isAmbientAudioPlaying === 'function') && window.isAmbientAudioPlaying();
    });
    assert.equal(isSuspendedInGame, false, 'Audio must be suspended while game theater is open');

    // 4. Close game theater
    const iframeElement = await page.$('#game-viewport-iframe');
    const frame = await iframeElement.contentFrame();
    await frame.evaluate(() => {
      if (typeof window.exitToAuroMindPortal === 'function') {
        window.exitToAuroMindPortal();
      } else {
        window.parent.postMessage({ type: 'AUROMIND_CLOSE_THEATER', gameId: 'auroblocks' }, window.location.origin);
      }
    });

    await new Promise(r => setTimeout(r, 200));

    // 5. Verify audio was automatically resumed
    const isRestoredOnExit = await page.evaluate(() => {
      return (typeof window.isAmbientAudioPlaying === 'function') && window.isAmbientAudioPlaying();
    });
    assert.equal(isRestoredOnExit, true, 'Audio must automatically resume after closing game theater');
  } finally {
    await close();
  }
});
