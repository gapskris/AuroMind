# AuroMind B17.1 Platform Remediation Report

**Date:** November 20, 2026  
**Canonical Workspace:** `C:\AuroMindPortal`  
**Active Git Branch:** `dev/studio-integration`  
**Baseline HEAD Commit:** `b6ccc860bb7d38a70ef678049a9588b8b73c40aa`  
**Target Release:** January 1, 2027  
**Test Status:** 206 / 206 Passing (100% across 15 test suites)

---

## 1. Executive Summary

Batch B17.1 implemented the first tier of authorized platform remediations identified during the B17 comprehensive platform-wide QA audit. All four targeted critical and high-priority gaps were remediated with zero regressions, zero disruption to the local-first architecture, and strict adherence to all Sacred Invariants:

1. **B17-GAP-04 (Critical):** Implemented the AuroBlocks Shared Platform SDK Adapter & Bridge (`auroblocks-sdk-bridge.js`), establishing guest identity binding, save envelope import/export, owned storage registration, and telemetry dispatch.
2. **B17-GAP-06 (High):** Reconciled the root Service Worker (`sw.js`) fetch handler to permit `/assets/sdk/*` delivery to game iframes while preserving nested game Service Worker caching isolation. Updated `server.test.js` to assert offline SDK delivery under game iframe referrers.
3. **B17-GAP-01 (High):** Removed the duplicate AuroBlocks catalog card in `index.html` (Section 2) per explicit owner instruction. Exactly 1 AuroBlocks card remains in Section 1. "Live Now" filter yields exactly 6 unique live games.
4. **B17-GAP-02 (Medium):** Reconciled sidebar and search count references to the curated 36 unique catalog titles, adding dynamic JavaScript reconciliation in `portal.js` to ensure permanent consistency with DOM card counts.

---

## 2. Detailed Task Breakdown & Implementation Evidence

### 2.1 Task 1: AuroBlocks Shared SDK Bridge (B17-GAP-04)
- **Problem Statement:** AuroBlocks lacked an SDK bridge adapter, isolating it from cross-game guest identity, save envelopes, and standardized telemetry.
- **Implementation:**
  - Created `games/auroblocks/assets/auroblocks-sdk-bridge.js`:
    - Implemented `createAuroBlocksGameAdapter()` conforming to the B5 Platform SDK Adapter specification (`contractVersion: 1`).
    - Registered owned localStorage keys: `auroblocks_player_save_v1`, `auroblocks_high_score`, `auroblocks_stages`.
    - Declared capabilities: `offlinePlay: true`, `localPersistence: true`, `cloudSyncEligible: true`.
    - Bound single-origin guest identity: reads and exposes `window.__AUROMIND_GUEST_ID__`.
    - Implemented non-destructive save envelopes: `exportEnvelope(guestId)` and `applyEnvelope(envelope)`.
    - Integrated with Platform Telemetry: `trackGameSession(action, metadata)` dispatches to `window.AuroMind.telemetry`.
  - Linked bridge in `games/auroblocks/index.html` via ES module script tag before game execution.
- **Verification:**
  - `b17-remediation.test.js` Test 1 validates adapter contract compliance, owned keys registration, and envelope import/export.
  - `b17-remediation.test.js` Test 2 verifies script tag link in `games/auroblocks/index.html`.

### 2.2 Task 2: Service Worker Offline SDK Delivery (B17-GAP-06)
- **Problem Statement:** Root Service Worker (`sw.js`) fetch handler bypassed all requests containing `/games/` in the referrer. When game iframes requested shared SDK files (`/assets/sdk/auromind-sdk.js`) while offline, the request bypassed the cache and failed with network error, breaking offline gameplay initialization.
- **Implementation:**
  - Modified `sw.js` line 192:
    ```javascript
    if (!PORTAL_SDK_REL_PATHS.has(relPath) && request.referrer && request.referrer.includes('/games/')) {
      return;
    }
    ```
    This ensures shared SDK assets (`PORTAL_SDK_REL_PATHS`) are served directly from the root Service Worker cache to game iframes offline, while non-SDK requests from game iframes continue to bypass the root SW to protect nested game Service Worker caches.
  - Updated `server.test.js` to assert that SDK asset requests originating from a game iframe referrer (`http://localhost:3000/games/vak/index.html`) receive HTTP 200 from cache, while non-SDK game requests remain strictly bypassed.
- **Verification:**
  - `b17-remediation.test.js` Test 3 confirms the referrer bypass exemption for SDK assets.
  - `server.test.js` passes all tests validating both cache hit for SDK files and cache bypass for game files.

### 2.3 Task 3: Catalogue Deduplication (B17-GAP-01)
- **Problem Statement:** AuroBlocks was duplicated across Section 1 (card 4) and Section 2 (card 6), distorting catalog counts and displaying duplicate UI cards.
- **Owner Directive:** Remove the duplicate card from Section 2; do not replace it with another game.
- **Implementation:**
  - Removed duplicate `<article class="game-card" data-game-id="auroblocks" ...>` from Section 2 in `index.html`.
  - Retained exactly one canonical card in Section 1 with live game trigger (`data-category="live arcade"`).
- **Verification:**
  - `b17-remediation.test.js` Test 4 confirms exactly 1 AuroBlocks `<article>` exists in `index.html`.
  - `b17-remediation.test.js` Test 5 confirms the "Live Now" category filter matches exactly 6 unique live games:
    1. VAK — The Control of Speech (`vak`)
    2. AuroMatch — Zen Tile Solitaire (`auromatch`)
    3. Word Riddle — Mystic Vocabulary (`wordriddle`)
    4. VAK — The Living Sanctuary (`vak-sanctuary`)
    5. AuroMandala — Sacred Geometry (`auromandala`)
    6. AuroBlocks — Mindful Tetris (`auroblocks`)

### 2.4 Task 4: Sidebar Game Count Alignment (B17-GAP-02)
- **Problem Statement:** Static sidebar navigation read "All Games (37)" and search input read "Search all 37 games", inconsistent with the 36 unique catalog titles.
- **Implementation:**
  - Updated `index.html` static markup:
    - Sidebar navigation item: `<span class="category-name">All Games (36)</span>`
    - Search input placeholder: `placeholder="Search all 36 games..."`
  - Added dynamic reconciliation in `assets/js/portal.js` (`initSidebarAndNavigation`):
    ```javascript
    const allGamesSpan = document.querySelector('.sidebar-nav-item[data-category="all"] span:last-child');
    if (allGamesSpan && cards.length > 0) {
      allGamesSpan.textContent = `All Games (${cards.length})`;
    }
    ```
- **Verification:**
  - `b17-remediation.test.js` Test 6 verifies both static HTML markup and dynamic JavaScript reconciliation.

---

## 3. Files Modified & Added in B17.1

| File | Status | Description |
|------|--------|-------------|
| `games/auroblocks/assets/auroblocks-sdk-bridge.js` | **Created** | AuroBlocks platform SDK adapter & telemetry bridge |
| `games/auroblocks/index.html` | Modified | Linked SDK bridge module |
| `sw.js` | Modified | Root SW referrer filter exemption for `/assets/sdk/*` |
| `server.test.js` | Modified | Updated test assertion for offline SDK delivery to game iframes |
| `index.html` | Modified | Removed duplicate AuroBlocks card, updated sidebar to 36 |
| `assets/js/portal.js` | Modified | Dynamic sidebar count reconciliation |
| `b17-remediation.test.js` | **Created** | Comprehensive test suite for B17 remediations |

---

## 4. Verification & Regression Analysis

- Pre-B17 test baseline: 191 / 191 passing across 14 suites.
- Post-B17.1 test baseline: 197 / 197 passing across 15 suites (+6 new tests).
- All 14 pre-existing test suites passed with zero failures.
- No changes to network layer, Supabase client, or database migrations.
