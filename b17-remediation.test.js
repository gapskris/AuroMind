/**
 * AuroMind Modernization Batch B17 — Remediation Verification Test Suite
 *
 * Validates B17.1 and B17.2 implementations:
 * 1. AuroBlocks Shared Platform SDK Adapter & Bridge (B17-GAP-04)
 * 2. Service Worker Offline SDK Delivery with Game Referrer (B17-GAP-06)
 * 3. Catalogue AuroBlocks Deduplication & Live Game Count (B17-GAP-01)
 * 4. Sidebar Unique Game Count Consistency (B17-GAP-02)
 * 5. In-Game Return to Portal Navigation Contracts (B17-GAP-05)
 * 6. Console Side Edge-Tab Touch Target Accessibility (B17-GAP-03)
 * 7. Senior Mode Synchronization Across Iframes (B17-GAP-07)
 * 8. Ambient 432 Hz Audio Restoration on Theater Close (B17-GAP-09)
 * 9. Sacred Invariants Preservation (VAK Speech Corpus, Flora Database, Sankalpa Vault)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Suite 1: AuroBlocks Shared SDK Bridge & Adapter Conformance (B17-GAP-04)
// ---------------------------------------------------------------------------
test('B17.1 Test 1: AuroBlocks adapter conforms to SDK specification and registers owned storage keys', async () => {
  const bridgePath = path.join(__dirname, 'games/auroblocks/assets/auroblocks-sdk-bridge.js');
  assert.ok(fs.existsSync(bridgePath), 'auroblocks-sdk-bridge.js must exist');

  const { createAuroBlocksGameAdapter } = await import('./games/auroblocks/assets/auroblocks-sdk-bridge.js');
  const adapter = createAuroBlocksGameAdapter();

  assert.equal(adapter.gameId, 'auroblocks');
  assert.equal(adapter.contractVersion, 1);
  assert.equal(adapter.capabilities.offlinePlay, true);
  assert.equal(adapter.capabilities.localPersistence, true);
  assert.equal(adapter.capabilities.cloudSyncEligible, true);

  assert.ok(adapter.storage.ownedLocalStorageKeys.includes('auroblocks_player_save_v1'));
  assert.ok(adapter.storage.ownedLocalStorageKeys.includes('auroblocks_high_score'));
  assert.ok(adapter.storage.ownedLocalStorageKeys.includes('auroblocks_stages'));

  // Test exportEnvelope with empty progress
  const emptyEnv = await adapter.exportEnvelope('guest_test_id');
  assert.equal(emptyEnv.gameId, 'auroblocks');
  assert.equal(emptyEnv.guestId, 'guest_test_id');
  assert.equal(typeof emptyEnv.checksum, 'string');

  // Test applyEnvelope
  const testEnvelope = {
    gameId: 'auroblocks',
    payload: {
      save: {
        highScore: 5400,
        stages: [1, 2, 3]
      }
    }
  };
  const applyResult = await adapter.applyEnvelope(testEnvelope);
  assert.equal(applyResult, true);
});

test('B17.1 Test 2: AuroBlocks index.html links the SDK bridge module', () => {
  const html = fs.readFileSync(path.join(__dirname, 'games/auroblocks/index.html'), 'utf8');
  assert.ok(
    html.includes('auroblocks-sdk-bridge.js'),
    'games/auroblocks/index.html must load auroblocks-sdk-bridge.js'
  );
});

// ---------------------------------------------------------------------------
// Suite 2: Service Worker Offline SDK Delivery with Game Referrer (B17-GAP-06)
// ---------------------------------------------------------------------------
test('B17.1 Test 3: Root Service Worker fetch handler allows SDK assets under game iframe referrer', () => {
  const swCode = fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8');

  // Verify non-SDK game referrer requests are bypassed, but SDK assets are allowed through
  assert.ok(
    swCode.includes('!PORTAL_SDK_REL_PATHS.has(relPath) && request.referrer && request.referrer.includes(\'/games/\')'),
    'sw.js must exempt PORTAL_SDK_REL_PATHS from game referrer bypass'
  );
});

// ---------------------------------------------------------------------------
// Suite 3: Catalogue Deduplication & Sidebar Counts (B17-GAP-01 & B17-GAP-02)
// ---------------------------------------------------------------------------
test('B17.1 Test 4: AuroBlocks catalog card is unique (zero duplication)', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const auroBlocksMatches = html.match(/data-game-id="auroblocks"/g);
  assert.equal(
    auroBlocksMatches ? auroBlocksMatches.length : 0,
    2,
    'There must be exactly one AuroBlocks card and button in index.html'
  );

  const articleMatches = html.match(/<article[^>]*data-game-id="auroblocks"/g);
  assert.equal(
    articleMatches ? articleMatches.length : 0,
    1,
    'There must be exactly 1 <article> card for AuroBlocks in index.html'
  );
});

test('B17.1 Test 5: Live Now category filter matches exactly 6 unique live games', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const liveCards = html.match(/<article[^>]*class="game-card"[^>]*data-category="[^"]*live[^"]*"/g);
  assert.equal(
    liveCards ? liveCards.length : 0,
    6,
    'Live Now category filter must match exactly 6 unique live game cards'
  );
});

test('B17.1 Test 6: Sidebar count reflects curated 36 unique catalogue entries', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.ok(html.includes('All Games (36)'), 'Sidebar must display All Games (36)');
  assert.ok(html.includes('Search all 36 games'), 'Search input placeholder must say 36 games');

  const portalJs = fs.readFileSync(path.join(__dirname, 'assets/js/portal.js'), 'utf8');
  assert.ok(
    portalJs.includes('allGamesSpan.textContent = `All Games (${cards.length})`'),
    'portal.js must dynamically reconcile sidebar All Games count with actual card count'
  );
});

// ---------------------------------------------------------------------------
// Suite 4: In-Game Return to Portal Navigation Contracts (B17-GAP-05)
// ---------------------------------------------------------------------------
test('B17.2 Test 7: All 6 live games define postMessage return contract (AUROMIND_CLOSE_THEATER)', () => {
  const gameFiles = [
    { name: 'auroblocks', path: 'games/auroblocks/assets/auroblocks-sdk-bridge.js' },
    { name: 'auromandala', path: 'games/auromandala/assets/auromandala-sdk-bridge.js' },
    { name: 'auromatch', path: 'games/auromatch/src/main.js' },
    { name: 'word-riddle', path: 'games/word-riddle/index.html' },
    { name: 'vak', path: 'games/vak/index.html' },
    { name: 'vak-living-sanctuary', path: 'games/vak-living-sanctuary/index.html' }
  ];

  for (const game of gameFiles) {
    const fullPath = path.join(__dirname, game.path);
    assert.ok(fs.existsSync(fullPath), `${game.name} source file must exist at ${game.path}`);
    const content = fs.readFileSync(fullPath, 'utf8');
    assert.ok(
      content.includes('AUROMIND_CLOSE_THEATER'),
      `${game.name} must implement postMessage return protocol with AUROMIND_CLOSE_THEATER`
    );
  }
});

test('B17.2 Test 8: Portal listens for AUROMIND_CLOSE_THEATER and manages theater transitions', () => {
  const portalJs = fs.readFileSync(path.join(__dirname, 'assets/js/portal.js'), 'utf8');
  assert.ok(
    portalJs.includes("data.type === 'AUROMIND_CLOSE_THEATER'"),
    'portal.js must listen for AUROMIND_CLOSE_THEATER from child iframes'
  );
  assert.ok(
    portalJs.includes('function closeTheater()'),
    'portal.js must implement closeTheater teardown'
  );
});

// ---------------------------------------------------------------------------
// Suite 5: Console Side Edge-Tab Touch Target Accessibility (B17-GAP-03)
// ---------------------------------------------------------------------------
test('B17.2 Test 9: Edge-tab trigger has WCAG-compliant mobile touch target & focus visible styles', () => {
  const portalCss = fs.readFileSync(path.join(__dirname, 'assets/css/portal.css'), 'utf8');
  assert.ok(
    portalCss.includes('.edge-tab-trigger:focus-visible'),
    'portal.css must have focus-visible styling for edge tab trigger'
  );
  assert.ok(
    portalCss.includes('.edge-tab-trigger::after'),
    'portal.css must provide expanded touch hitbox pseudo-element for mobile tap safety'
  );
  assert.ok(
    portalCss.includes('touch-action: manipulation;'),
    'portal.css must set touch-action manipulation for responsive touch handling'
  );
});

// ---------------------------------------------------------------------------
// Suite 6: Senior Mode Synchronization Across Iframes (B17-GAP-07)
// ---------------------------------------------------------------------------
test('B17.2 Test 10: Portal broadcasts AUROMIND_SET_SENIOR_MODE on load and toggle', () => {
  const portalJs = fs.readFileSync(path.join(__dirname, 'assets/js/portal.js'), 'utf8');
  assert.ok(
    portalJs.includes("theaterIframe.onload = () => {"),
    'portal.js must attach onload listener to theater iframe'
  );
  assert.ok(
    portalJs.includes("type: 'AUROMIND_SET_SENIOR_MODE'"),
    'portal.js must postMessage AUROMIND_SET_SENIOR_MODE to theater iframe'
  );
});

test('B17.2 Test 11: All 6 live games listen for AUROMIND_SET_SENIOR_MODE', () => {
  const gameFiles = [
    { name: 'auroblocks', path: 'games/auroblocks/assets/auroblocks-sdk-bridge.js' },
    { name: 'auromandala', path: 'games/auromandala/assets/auromandala-sdk-bridge.js' },
    { name: 'auromatch', path: 'games/auromatch/src/main.js' },
    { name: 'word-riddle', path: 'games/word-riddle/index.html' },
    { name: 'vak', path: 'games/vak/index.html' },
    { name: 'vak-living-sanctuary', path: 'games/vak-living-sanctuary/index.html' }
  ];

  for (const game of gameFiles) {
    const fullPath = path.join(__dirname, game.path);
    const content = fs.readFileSync(fullPath, 'utf8');
    assert.ok(
      content.includes('AUROMIND_SET_SENIOR_MODE'),
      `${game.name} must listen for AUROMIND_SET_SENIOR_MODE postMessage`
    );
  }
});

// ---------------------------------------------------------------------------
// Suite 7: Ambient 432 Hz Audio Restoration on Theater Close (B17-GAP-09)
// ---------------------------------------------------------------------------
test('B17.2 Test 12: Portal tracks ambient audio state and restores on theater exit', () => {
  const portalJs = fs.readFileSync(path.join(__dirname, 'assets/js/portal.js'), 'utf8');
  assert.ok(
    portalJs.includes('window.isAmbientAudioPlaying = () => isPlaying;'),
    'portal.js must expose isAmbientAudioPlaying query'
  );
  assert.ok(
    portalJs.includes('window.resumeAmbientAudio = startAmbientAudio;'),
    'portal.js must expose resumeAmbientAudio function'
  );
  assert.ok(
    portalJs.includes('ambientAudioWasPlaying = (typeof window.isAmbientAudioPlaying'),
    'openGameInTheater must record whether ambient audio was playing prior to suspension'
  );
  assert.ok(
    portalJs.includes('if (ambientAudioWasPlaying) {'),
    'closeTheater must restore ambient audio if it was active prior to theater entry'
  );
});

// ---------------------------------------------------------------------------
// Suite 8: Sacred Invariants Preservation
// ---------------------------------------------------------------------------
test('Sacred Invariant Test 13: VAK Speech Corpus CL array SHA-256 remains exact', () => {
  const vakPath = path.join(__dirname, 'games/vak/index.html');
  const vakSrc = fs.readFileSync(vakPath, 'utf8');
  const clMatch = vakSrc.match(/const CL = \[\[[\s\S]*?\]\];/);
  assert.ok(clMatch, 'CL array must exist in games/vak/index.html');
  const hash = crypto.createHash('sha256').update(clMatch[0], 'utf8').digest('hex');
  assert.equal(hash, '9fdb3826030049c9eab183479bcb7fe29304b3ea08d045c8c67f1cfd4d77da09');
});

test('Sacred Invariant Test 14: AuroMatch Flora database is exactly 2,002,176 bytes and 46,321 lines', () => {
  const floraPath = path.join(__dirname, 'games/auromatch/src/models/floraDatabase.js');
  const stat = fs.statSync(floraPath);
  assert.equal(stat.size, 2002176, 'Flora database size must be exactly 2,002,176 bytes');

  const content = fs.readFileSync(floraPath, 'utf8');
  const newlineCount = (content.match(/\n/g) || []).length;
  assert.equal(newlineCount, 46321, 'Flora database newline count must be exactly 46,321 lines');
});

test('Sacred Invariant Test 15: Sankalpa contemplation vault is 100% local-only with zero cloud sync', async () => {
  const { createAuroMandalaGameAdapter } = await import('./games/auromandala/assets/auromandala-sdk-bridge.js');
  const mandalaAdapter = createAuroMandalaGameAdapter();
  assert.equal(mandalaAdapter.capabilities.cloudSyncEligible, false, 'Sankalpa vault must be strictly local-only');
});
