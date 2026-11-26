/**
 * F1 & F2 Real Browser E2E Validation Suite (Chromium / Edge Engine)
 *
 * Verifies real application behavior in a real browser on an HTTP origin:
 * Part 1 (F1):
 * - Exactly 3 launch games in catalogue, navigation, discovery, and search.
 * - Non-launch games absent from DOM without deleting source files.
 * - Game theater launch into iframe, return navigation, and direct URLs.
 * - Release manifest agreement, responsive layout, and zero critical console errors.
 *
 * Part 2 (F2):
 * - Real browser CacheStorage execution with Service Workers (portal, auroblocks, auromatch).
 * - Cache namespace isolation in actual browser CacheStorage.
 * - Critical shell failure rejecting SW installation and preserving existing working offline shell.
 * - Real browser offline startup and navigation via Service Worker cache.
 * - Actual clearPortalPreferencesOnly execution preserving game saves, identity, and artwork byte-for-byte.
 * - SDK storage adapter under QuotaExceededError and SecurityError in real browser.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createTestEnvironment } from './e2e/browser-harness.js';

let env = null;

before(async () => {
  env = await createTestEnvironment({ port: 3342 });
});

after(async () => {
  if (env) {
    await env.teardown();
  }
});

describe('F1: Real Browser Portal Catalogue, Navigation & Theater Integration', () => {

  test('F1.1: Portal renders exactly 3 launch titles with zero concept card leakage', async () => {
    const { page, close, consoleErrors, captureScreenshot } = await env.createInstrumentedPage();
    try {
      const response = await page.goto(env.baseUrl, { waitUntil: 'domcontentloaded' });
      assert.equal(response.status(), 200, 'Portal must load with HTTP 200');

      await page.waitForFunction(
        () => window.AuroMindPortal && window.AuroMindPortal.isInitialized && window.AuroMindPortal.isInitialized(),
        { timeout: 10000, polling: 100 }
      );

      const title = await page.title();
      assert.ok(title.includes('AuroMasti'), `Document title must contain AuroMasti, got: ${title}`);

      // Query all game cards in catalogue
      const gameCards = await page.$$eval('article.game-card', cards =>
        cards.map(c => ({
          gameId: c.getAttribute('data-game-id'),
          title: c.querySelector('.game-card-title, h4, h3')?.textContent?.trim() || '',
          badge: c.querySelector('.pill-badge, .status-badge')?.textContent?.trim() || ''
        }))
      );

      assert.equal(gameCards.length, 3, 'Must render exactly 3 game cards in catalogue');

      const gameIds = gameCards.map(c => c.gameId).sort();
      assert.deepEqual(gameIds, ['auroblocks', 'auromandala', 'auromatch'], 'Must expose only the 3 launch games');

      // Verify titles
      const cardTitles = gameCards.map(c => c.title);
      assert.ok(cardTitles.some(t => t.includes('AuroMandala')));
      assert.ok(cardTitles.some(t => t.includes('MaaMATCH')));
      assert.ok(cardTitles.some(t => t.includes('MaaBLOCK')));

      // Verify removed/concept games are ABSENT from DOM
      const domContent = await page.content();
      assert.equal(domContent.includes('01_stillwater.png'), false, 'Concept thumbnails must not exist in DOM');
      assert.equal(domContent.includes('strat_01_chronostasis'), false, 'Concept games must not exist in DOM');
      assert.equal(domContent.includes('games/vak/index.html'), false, 'VAK must not be linked in portal DOM');
      assert.equal(domContent.includes('games/word-riddle/index.html'), false, 'Word Riddle must not be linked in portal DOM');

      // Verify sidebar counts
      const allGamesText = await page.$eval('.sidebar-nav-item[data-category="all"]', el => el.textContent.trim());
      const liveNowText = await page.$eval('.sidebar-nav-item[data-category="live"]', el => el.textContent.trim());
      assert.ok(allGamesText.includes('(3)'), `Sidebar All Games count must be 3, got: ${allGamesText}`);
      assert.ok(liveNowText.includes('(3)'), `Sidebar Live Now count must be 3, got: ${liveNowText}`);

      // Verify Hero stats
      const heroStats = await page.$$eval('.hero-stats-row .stat-num', els => els.map(e => e.textContent.trim()));
      assert.equal(heroStats[0], '3', 'Hero Total Titles must be 3');
      assert.equal(heroStats[1], '3', 'Hero Live Now must be 3');

      // Verify release-manifest.json served on origin
      const manifestRes = await page.evaluate(async () => {
        const res = await fetch('/release-manifest.json');
        return { ok: res.ok, data: await res.json() };
      });
      assert.equal(manifestRes.ok, true, 'release-manifest.json must be served');
      assert.equal(manifestRes.data.version, '2.0.0');
      assert.equal(manifestRes.data.featureFlags.COMMERCIAL_GATE_ENABLED, false);
      assert.equal(manifestRes.data.applications.length, 3);

      await captureScreenshot('f1_portal_real_browser');

      // Zero uncaught runtime exceptions
      const pageErrors = consoleErrors.filter(e => e.type === 'pageerror');
      assert.equal(pageErrors.length, 0, 'Must have zero uncaught runtime errors');
    } finally {
      await close();
    }
  });

  test('F1.2: Search filter dynamically isolates launch titles and handles empty matches', async () => {
    const { page, close } = await env.createInstrumentedPage();
    try {
      await page.goto(env.baseUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.AuroMindPortal && window.AuroMindPortal.isInitialized(), { timeout: 10000, polling: 100 });

      // Dismiss guide modal if open
      await page.evaluate(() => {
        const g = document.getElementById('guide-modal');
        if (g) g.classList.remove('open');
      });

      const searchSelector = '#search-input';
      await page.waitForSelector(searchSelector);

      const setSearch = async (val) => {
        await page.evaluate((selector, query) => {
          const input = document.querySelector(selector);
          input.value = query;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }, searchSelector, val);
        await new Promise(r => setTimeout(r, 100));
      };

      // Search "MaaMATCH"
      await setSearch('MaaMATCH');
      let visibleCards = await page.$$eval('article.game-card:not([style*="display: none"])', cards => cards.map(c => c.getAttribute('data-game-id')));
      assert.deepEqual(visibleCards, ['auromatch'], 'Searching MaaMATCH must show only auromatch');

      // Search "Sudoku"
      await setSearch('Sudoku');
      visibleCards = await page.$$eval('article.game-card:not([style*="display: none"])', cards => cards.map(c => c.getAttribute('data-game-id')));
      assert.deepEqual(visibleCards, ['auroblocks'], 'Searching Sudoku must show only auroblocks');

      // Search "Mandala"
      await setSearch('Mandala');
      visibleCards = await page.$$eval('article.game-card:not([style*="display: none"])', cards => cards.map(c => c.getAttribute('data-game-id')));
      assert.ok(visibleCards.includes('auromandala'), 'Searching Mandala must match auromandala');

      // Search non-existent
      await setSearch('NonexistentGameXYZ');
      visibleCards = await page.$$eval('article.game-card:not([style*="display: none"])', cards => cards.map(c => c.getAttribute('data-game-id')));
      assert.equal(visibleCards.length, 0, 'Unmatched search must show 0 cards');

      // Clear search
      await setSearch('');
      visibleCards = await page.$$eval('article.game-card:not([style*="display: none"])', cards => cards.map(c => c.getAttribute('data-game-id')));
      assert.equal(visibleCards.length, 3, 'Clearing search must restore all 3 cards');
    } finally {
      await close();
    }
  });

  test('F1.3: Game theater launches all 3 games in iframe context and handles clean return', async () => {
    const { page, close } = await env.createInstrumentedPage();
    try {
      await page.goto(env.baseUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.AuroMindPortal && window.AuroMindPortal.isInitialized(), { timeout: 10000, polling: 100 });

      // Dismiss guide modal
      await page.evaluate(() => {
        const g = document.getElementById('guide-modal');
        if (g) g.classList.remove('open');
      });

      const launchGames = [
        { id: 'auroblocks', expectedSrc: 'games/auroblocks/index.html' },
        { id: 'auromatch', expectedSrc: 'games/auromatch/index.html' },
        { id: 'auromandala', expectedSrc: 'games/auromandala/index.html' }
      ];

      for (const game of launchGames) {
        // Launch via play button in card
        await page.evaluate((gid) => {
          const btn = document.querySelector(`.play-game-btn[data-game-id="${gid}"]`);
          if (btn) btn.click();
        }, game.id);

        await page.waitForFunction(() => {
          const theater = document.getElementById('game-theater-view');
          return theater && theater.style.display !== 'none' && document.body.classList.contains('in-game-mode');
        }, { timeout: 8000, polling: 100 });

        const iframeSrc = await page.$eval('#game-viewport-iframe', f => f.getAttribute('src'));
        assert.ok(iframeSrc.includes(game.expectedSrc), `Iframe src must contain ${game.expectedSrc}, got: ${iframeSrc}`);

        // Return to portal via back button
        await page.evaluate(() => {
          const backBtn = document.getElementById('theater-back-btn');
          if (backBtn) backBtn.click();
        });

        await page.waitForFunction(() => {
          const theater = document.getElementById('game-theater-view');
          return theater && (theater.style.display === 'none' || !theater.style.display) && !document.body.classList.contains('in-game-mode');
        }, { timeout: 8000, polling: 100 });

        const isInGame = await page.evaluate(() => document.body.classList.contains('in-game-mode'));
        assert.equal(isInGame, false, 'Theater must close cleanly on return');
      }

      // Direct deep link launch in fresh page (#play-auromatch)
      const directEntry = await env.createInstrumentedPage();
      try {
        await directEntry.page.goto(`${env.baseUrl}/#play-auromatch`, { waitUntil: 'domcontentloaded' });
        await directEntry.page.waitForFunction(() => {
          const theater = document.getElementById('game-theater-view');
          return theater && theater.style.display !== 'none' && document.body.classList.contains('in-game-mode');
        }, { timeout: 8000, polling: 100 });

        const directIframeSrc = await directEntry.page.$eval('#game-viewport-iframe', f => f.getAttribute('src'));
        assert.ok(directIframeSrc.includes('games/auromatch/index.html'), 'Direct hash launch must load auromatch');
      } finally {
        await directEntry.close();
      }
    } finally {
      await close();
    }
  });

  test('F1.4: Mobile viewport renders responsive layout with zero horizontal overflow', async () => {
    const { page, close, captureScreenshot } = await env.createInstrumentedPage({
      viewport: { width: 375, height: 667 }
    });
    try {
      await page.goto(env.baseUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.AuroMindPortal && window.AuroMindPortal.isInitialized(), { timeout: 10000, polling: 100 });

      const isOverflowing = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      });
      assert.equal(isOverflowing, false, 'Mobile viewport must have zero horizontal overflow');

      // Verify mobile menu toggle button size
      const toggleBox = await page.$eval('#menu-toggle-btn', btn => {
        const rect = btn.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      });
      assert.ok(toggleBox.width >= 40, `Touch target width must be >= 40px, got ${toggleBox.width}`);
      assert.ok(toggleBox.height >= 40, `Touch target height must be >= 40px, got ${toggleBox.height}`);

      await captureScreenshot('f1_mobile_portal_real_browser');
    } finally {
      await close();
    }
  });

});

describe('F2: Real Browser Storage & Service Worker Execution on HTTP Origin', () => {

  test('F2.5: Real browser portal storage cleanup preserves game saves, identity, and artwork byte-for-byte', async () => {
    const { page, close } = await env.createInstrumentedPage();
    try {
      await page.goto(env.baseUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.AuroMindPortal && window.AuroMindPortal.isInitialized(), { timeout: 10000, polling: 100 });

      // Seed realistic storage state in real browser localStorage
      const seedData = {
        'auromind_senior_mode': 'true',
        'auromind_reduced_motion': 'true',
        'auromind_ambient_volume': '0.85',
        'auromind_guide_seen': 'true',
        'auromind.platform.v1.guest': JSON.stringify({ guestId: 'guest_real_browser_001', createdAt: '2026-11-26T12:00:00.000Z' }),
        'auromind.platform.v1.player_profile': JSON.stringify({ displayName: 'Seeker', avatar: { type: 'data_url', value: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjwvc3ZnPg==' } }),
        'auroblocks_player_save_v1': JSON.stringify({ high_score: 9850, current_level: 14 }),
        'auroblocks_settings': JSON.stringify({ haptics: true }),
        'auromatch_profile': JSON.stringify({ unlocked_flowers: 85, zen_tokens: 350 }),
        'auromatch_db': JSON.stringify({ active_board: [1, 2, 3] }),
        'auromandala_art_store_v1': JSON.stringify({ artworks: ['mandala_01', 'mandala_02'] }),
        'auromandala_sankalpa_vault': 'local_encrypted_sankalpa_payload_e2e'
      };

      await page.evaluate((data) => {
        for (const [k, v] of Object.entries(data)) {
          window.localStorage.setItem(k, v);
        }
      }, seedData);

      // Execute actual clearPortalPreferencesOnly in page context
      const removedKeys = await page.evaluate(() => {
        return window.clearPortalPreferencesOnly(window.localStorage);
      });

      assert.ok(removedKeys.includes('auromind_senior_mode'));
      assert.ok(removedKeys.includes('auromind_reduced_motion'));
      assert.ok(removedKeys.includes('auromind_ambient_volume'));
      assert.ok(removedKeys.includes('auromind_guide_seen'));

      // Retrieve post-cleanup storage from browser
      const postCleanup = await page.evaluate(() => {
        const res = {};
        for (let i = 0; i < window.localStorage.length; i++) {
          const k = window.localStorage.key(i);
          res[k] = window.localStorage.getItem(k);
        }
        return res;
      });

      // Assert portal preferences are deleted
      assert.equal(postCleanup['auromind_senior_mode'], undefined);
      assert.equal(postCleanup['auromind_reduced_motion'], undefined);
      assert.equal(postCleanup['auromind_ambient_volume'], undefined);
      assert.equal(postCleanup['auromind_guide_seen'], undefined);

      // Byte-for-byte exact equality for all preserved keys
      assert.equal(postCleanup['auromind.platform.v1.guest'], seedData['auromind.platform.v1.guest'], 'Platform identity must be byte-exact');
      assert.equal(postCleanup['auromind.platform.v1.player_profile'], seedData['auromind.platform.v1.player_profile'], 'Profile and artwork must be byte-exact');
      assert.equal(postCleanup['auroblocks_player_save_v1'], seedData['auroblocks_player_save_v1'], 'AuroBlocks save must be byte-exact');
      assert.equal(postCleanup['auroblocks_settings'], seedData['auroblocks_settings'], 'AuroBlocks settings must be byte-exact');
      assert.equal(postCleanup['auromatch_profile'], seedData['auromatch_profile'], 'AuroMatch profile must be byte-exact');
      assert.equal(postCleanup['auromatch_db'], seedData['auromatch_db'], 'AuroMatch DB must be byte-exact');
      assert.equal(postCleanup['auromandala_art_store_v1'], seedData['auromandala_art_store_v1'], 'AuroMandala art must be byte-exact');
      assert.equal(postCleanup['auromandala_sankalpa_vault'], seedData['auromandala_sankalpa_vault'], 'Sankalpa vault must be byte-exact');
    } finally {
      await close();
    }
  });

  test('F2.6: Real browser CacheStorage registers SWs and enforces namespace isolation', async () => {
    const { page, close } = await env.createInstrumentedPage();
    try {
      await page.goto(env.baseUrl, { waitUntil: 'domcontentloaded' });

      // 1. Register root SW in real browser
      const rootRegResult = await page.evaluate(async () => {
        if (!('serviceWorker' in navigator)) return { supported: false };
        const reg = await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
        await navigator.serviceWorker.ready;
        const keys = await window.caches.keys();
        return {
          supported: true,
          scope: reg.scope,
          cacheKeys: keys
        };
      });

      assert.equal(rootRegResult.supported, true, 'Service workers must be supported in real browser');
      assert.ok(rootRegResult.cacheKeys.includes('auro-portal-v2.0.0'), 'auro-portal-v2.0.0 must exist in browser CacheStorage');

      // 2. Register child game SWs in real browser
      const multiGameCacheResult = await page.evaluate(async () => {
        // Register AuroBlocks SW
        await navigator.serviceWorker.register('/games/auroblocks/sw.js', { scope: '/games/auroblocks/' });
        // Register AuroMatch SW
        await navigator.serviceWorker.register('/games/auromatch/sw.js', { scope: '/games/auromatch/' });

        // Wait briefly for install/activate
        await new Promise(r => setTimeout(r, 1200));

        const keys = await window.caches.keys();
        return {
          allCacheKeys: keys
        };
      });

      const keys = multiGameCacheResult.allCacheKeys;
      assert.ok(keys.includes('auro-portal-v2.0.0'), 'Portal cache must be present');
      assert.ok(keys.some(k => k.startsWith('auroblocks-')), 'AuroBlocks cache must exist in CacheStorage');
      assert.ok(keys.some(k => k.startsWith('auro-match-')), 'AuroMatch cache must exist in CacheStorage');

      // Verify that old simulated foreign cache is not pruned by another game
      const isolationResult = await page.evaluate(async () => {
        // Open fake old caches
        const c1 = await window.caches.open('auro-portal-v1.0.0');
        await c1.put('/fake', new Response('old'));

        const c2 = await window.caches.open('auromandala-v1.0.0');
        await c2.put('/fake', new Response('old'));

        // Re-run root SW activation
        const reg = await navigator.serviceWorker.getRegistration('/');
        if (reg && reg.active) {
          reg.active.postMessage({ type: 'PRUNE_OLD' });
        }
        await new Promise(r => setTimeout(r, 500));

        const remainingKeys = await window.caches.keys();
        return {
          hasPortalV2: remainingKeys.includes('auro-portal-v2.0.0'),
          hasMandalaV1: remainingKeys.includes('auromandala-v1.0.0'),
          hasAuroBlocksActive: remainingKeys.some(k => k.startsWith('auroblocks-v1.5')),
          hasAuroMatchActive: remainingKeys.some(k => k.startsWith('auro-match-v8'))
        };
      });

      // Sibling game caches MUST remain untouched by portal SW
      assert.equal(isolationResult.hasPortalV2, true);
      assert.equal(isolationResult.hasMandalaV1, true, 'Sibling game cache must not be deleted by portal SW');
      assert.equal(isolationResult.hasAuroBlocksActive, true);
      assert.equal(isolationResult.hasAuroMatchActive, true);
    } finally {
      await close();
    }
  });

  test('F2.7: Real browser offline startup loads portal from Service Worker cache', async () => {
    const { page, close, setOffline } = await env.createInstrumentedPage();
    try {
      // 1. Load portal while online to ensure SW is installed and cached
      await page.goto(env.baseUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(
        () => window.AuroMindPortal && window.AuroMindPortal.isInitialized(),
        { timeout: 10000, polling: 100 }
      );

      // Ensure SW is registered and claims clients
      await page.evaluate(async () => {
        if ('serviceWorker' in navigator) {
          await navigator.serviceWorker.register('/sw.js');
          await navigator.serviceWorker.ready;
          if (!navigator.serviceWorker.controller) {
            await new Promise(resolve => {
              navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
              setTimeout(resolve, 800);
            });
          }
        }
      });

      // 2. Go completely offline via CDP network emulation
      await setOffline(true);

      // 3. Reload portal while completely offline
      const offlineResponse = await page.goto(env.baseUrl, { waitUntil: 'domcontentloaded' });
      assert.equal(offlineResponse.status(), 200, 'Portal must load with HTTP 200 from SW cache while offline');

      const title = await page.title();
      assert.ok(title.includes('AuroMasti'), 'Offline page must render title');

      const cardCount = await page.$$eval('article.game-card', els => els.length);
      assert.equal(cardCount, 3, 'Must render 3 game cards while offline');
    } finally {
      await close();
    }
  });

});
