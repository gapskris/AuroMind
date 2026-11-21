# B17 — AuroMind Issue & Gap Register (Master Defect Log)

**Programme:** AuroMind Production Readiness & Launch Certification  
**Target Release:** January 1, 2027  
**Canonical Workspace:** `C:\AuroMindPortal`  
**Active Git Branch:** `dev/studio-integration`  
**Audit Baseline:** Commit `b6ccc86`  
**Register Status:** **ACTIVE / PRIORITIZED FOR B18 REMEDIATION**

---

## 1. Summary Statistics

| Severity | Count | Definition |
|---|---|---|
| **P0 — Critical** | **0** | Catastrophic platform failure, data loss, active security compromise |
| **P1 — High** | **3** | Immediate release blockers, critical integration missing, broken core loop |
| **P2 — Medium** | **5** | Significant functionality defect, UX friction, missing cross-game sync |
| **P3 — Low** | **4** | Minor catalog polish, cosmetic discrepancy, deferred pipeline item |
| **Total Registered** | **12** | All identified defects, gaps, and release dependencies |

---

## 2. Master Issue Register

### B17-GAP-01: AuroBlocks Catalog Card Duplication in Portal Grid
- **Severity:** P2 (Medium)
- **Layer:** Layer A — AuroMind Portal & Platform Layer
- **Affected Component:** [index.html](file:///C:/AuroMindPortal/index.html#L416-L452), [index.html](file:///C:/AuroMindPortal/index.html#L508-L544)
- **Description:** The AuroBlocks game card appears twice on the home page: once in Section 1 (Core Sanctuary Games, lines 416-452) and once in Section 2 (Blockbuster Adaptation Suite, lines 508-544). Selecting "Live Now (6)" displays 7 cards.
- **Root Cause:** AuroBlocks was promoted from teaser in Section 2 to live in Section 1 without purging the secondary card.
- **Dependencies:** None.
- **Recommended Fix:** Delete lines 507–544 in `index.html` (the secondary duplicate in Section 2) or re-label Section 2 with upcoming titles.
- **Verification Criteria:** `document.querySelectorAll('[data-game-id="auroblocks"]').length === 1`. "Live Now (6)" category filter displays exactly 6 cards.
- **Status:** Open / Scheduled for B18.1.

---

### B17-GAP-02: Catalog All Games Count Discrepancy (33 vs 37 DOM Cards)
- **Severity:** P3 (Low)
- **Layer:** Layer A — AuroMind Portal & Platform Layer
- **Affected Component:** [index.html:45](file:///C:/AuroMindPortal/index.html#L45)
- **Description:** Sidebar displays badge `All Games (33)`, but DOM contains 37 `article.game-card` elements.
- **Root Cause:** Historical static text count in the sidebar was not updated after additional game teaser cards were added.
- **Dependencies:** None.
- **Recommended Fix:** Update sidebar text to reflect the exact intended catalog count, or implement dynamic count synchronization from the DOM grid.
- **Verification Criteria:** Text badge matches count of visible game cards in "All Games" view.
- **Status:** Open / Scheduled for B18.1.

---

### B17-GAP-03: Console Side Edge Drawer Tab Gesture Conflict on Mobile
- **Severity:** P3 (Low)
- **Layer:** Layer A — AuroMind Portal & Platform Layer
- **Affected Component:** [assets/css/portal.css:772-799](file:///C:/AuroMindPortal/assets/css/portal.css#L772-L799), [assets/js/portal.js:320-330](file:///C:/AuroMindPortal/assets/js/portal.js#L320-L330)
- **Description:** In theater view, the return navigation relies on a 28px wide `.edge-tab-trigger` docked to the left screen boundary. On iOS/Android touchscreens, left-edge swipes trigger OS navigation gestures rather than opening the drawer.
- **Root Cause:** Edge tab touch target is narrow (28px) and flush with the system back-swipe threshold.
- **Dependencies:** B17-GAP-05 (In-game exit button).
- **Recommended Fix:** Enlarge the touch target on mobile viewports (`width: 36px`, `height: 56px`), or render a persistent top floating exit button in theater mode.
- **Verification Criteria:** Edge tab is easily operable on mobile viewports (<600px) without triggering browser back swipe.
- **Status:** Open / Scheduled for B18.2.

---

### B17-GAP-04: AuroBlocks Missing Shared Platform SDK Integration Bridge
- **Severity:** P1 (High — Release Blocker)
- **Layer:** Layer B — Individual Game Applications Layer
- **Affected Component:** [games/auroblocks/index.html](file:///C:/AuroMindPortal/games/auroblocks/index.html), `games/auroblocks/assets/`
- **Description:** AuroBlocks is an initial-release title (January 1, 2027), but contains zero Shared SDK imports, zero adapter registration (`AuroMind.adapters.register`), zero telemetry event emission (`level_attempt`, `level_completed`, `score`), and does not establish single-device guest ID binding.
- **Root Cause:** AuroBlocks was imported from its standalone Vite build without authoring an `auroblocks-sdk-bridge.js`.
- **Dependencies:** None.
- **Recommended Fix:** Create `games/auroblocks/assets/auroblocks-sdk-bridge.js` modeling `auromandala-sdk-bridge.js`. Register adapter with `ownedLocalStorageKeys: ['auroblocks_player_save_v1', 'auroblocks_active_session']`. Emit `game_session_start`, `level_attempt`, and `level_completed`.
- **Verification Criteria:** AuroBlocks registers with `AuroMind.adapters.get('auroblocks')`. Guest ID `guest_<uuid>` is linked. Telemetry queue records AuroBlocks events.
- **Status:** Open / Scheduled for B18.1 (Top Priority).

---

### B17-GAP-05: Missing In-Game Return-to-Portal Navigation in Child Games
- **Severity:** P1 (High — Release Blocker)
- **Layer:** Layer B — Individual Game Applications Layer
- **Affected Component:** `games/auroblocks/`, `games/auromatch/`, `games/auromandala/`, `games/word-riddle/`, `games/vak-living-sanctuary/`
- **Description:** Five out of six games lack an in-game "Return to Portal" action dispatching `AUROMIND_CLOSE_THEATER` to `window.parent`. Only VAK provides this feature.
- **Root Cause:** Games were developed as independent standalone web applications and lacked standardized portal shell containment controls.
- **Dependencies:** B17-GAP-04.
- **Recommended Fix:** Add a standard "Return to Portal" / "Exit to Catalog" option in pause/settings menus or headers that calls `window.parent.postMessage({ type: 'AUROMIND_CLOSE_THEATER' }, window.location.origin)`.
- **Verification Criteria:** Clicking exit inside each game closes the theater view and returns to the catalog without reloading the page.
- **Status:** Open / Scheduled for B18.2.

---

### B17-GAP-06: Root Service Worker Offline SDK Exclusion Under Game Referrer
- **Severity:** P1 (High — Release Blocker)
- **Layer:** Layer B & C — Platform Architecture & Service Worker
- **Affected Component:** [sw.js:189-195](file:///C:/AuroMindPortal/sw.js#L189-L195)
- **Description:** Root service worker bypasses any request where `request.referrer.includes('/games/')`. If a child game iframe directly requests `assets/sdk/auromind-sdk.js` when offline, the root SW does not intercept it, and the child SW cannot serve it (outside scope), causing offline SDK imports to fail.
- **Root Cause:** Isolation logic intended for game assets was applied to `request.referrer`, unintentionally blocking platform SDK assets.
- **Dependencies:** None.
- **Recommended Fix:** In `sw.js`, reorder the checks so that `if (PORTAL_SDK_REL_PATHS.has(relPath))` is handled before the `/games/` referrer bypass, or explicitly exempt `/assets/sdk/*` from referrer checks.
- **Verification Criteria:** Offline requests to `assets/sdk/auromind-sdk.js` with `Referer: .../games/auroblocks/index.html` return HTTP 200 from cache.
- **Status:** Open / Scheduled for B18.1.

---

### B17-GAP-07: Senior Mode Accessibility Not Broadcasted to Child Iframes
- **Severity:** P2 (Medium)
- **Layer:** Layer B — Individual Game Applications Layer
- **Affected Component:** [assets/js/portal.js:840-880](file:///C:/AuroMindPortal/assets/js/portal.js#L840-L880), all child game bridges
- **Description:** Portal Senior Mode toggle does not notify running game iframes via postMessage.
- **Root Cause:** Portal senior mode was implemented as a root DOM class toggle (`body.senior-mode`) without cross-frame messaging.
- **Dependencies:** B17-GAP-04, B17-GAP-05.
- **Recommended Fix:** Dispatch `window.parent.postMessage({ type: 'AUROMIND_SET_SENIOR_MODE', enabled: boolean }, origin)` on toggle and on iframe load. Child games listen and adjust font size/contrast.
- **Verification Criteria:** Enabling Senior Mode in the portal visibly updates font scale and contrast in active game iframes.
- **Status:** Open / Scheduled for B18.2.

---

### B17-GAP-08: Deferred Games (Word Riddle & VAK Sanctuary) Missing SDK Bridges
- **Severity:** P2 (Medium / Deferred Scope)
- **Layer:** Layer B — Individual Game Applications Layer
- **Affected Component:** `games/word-riddle/`, `games/vak-living-sanctuary/`
- **Description:** Word Riddle and VAK Living Sanctuary lack official SDK adapters. They operate standalone with isolated databases.
- **Root Cause:** Initial launch focus prioritized the top 3 games (AuroBlocks, AuroMatch, AuroMandala); deferred games were kept intact but unbridged.
- **Dependencies:** None.
- **Recommended Fix:** Author `wordriddle-sdk-bridge.js` and `vaksanctuary-sdk-bridge.js` during post-launch B19 batches.
- **Verification Criteria:** Adapters registered and tested in platform regression suite.
- **Status:** Deferred / Scheduled for B19.

---

### B17-GAP-09: Ambient 432 Hz Audio Not Resumed on Theater Close
- **Severity:** P2 (Medium)
- **Layer:** Layer C — Shared Services Architecture Layer
- **Affected Component:** [assets/js/portal.js:351-354](file:///C:/AuroMindPortal/assets/js/portal.js#L351-L354), [assets/js/portal.js:403-448](file:///C:/AuroMindPortal/assets/js/portal.js#L403-L448)
- **Description:** `openGameInTheater()` suspends portal ambient audio. `closeTheater()` does not resume ambient audio if it was playing previously.
- **Root Cause:** Missing state tracking flag for `ambientAudioWasPlaying`.
- **Dependencies:** None.
- **Recommended Fix:** Record `ambientAudioWasPlaying = true` before calling `suspendAmbientAudio()`. In `closeTheater()`, if `ambientAudioWasPlaying === true`, invoke `resumeAmbientAudio()`.
- **Verification Criteria:** Audio resumes seamlessly when closing the game theater if it was active prior to launch.
- **Status:** Open / Scheduled for B18.2.

---

### B17-GAP-10: Automated Real-Browser E2E Testing Suite Missing
- **Severity:** P2 (Medium)
- **Layer:** Layer C — Testing & Quality Assurance
- **Affected Component:** Project root testing configuration (`package.json`)
- **Description:** All 191 regression tests run in Node.js VM contexts. No headless browser (Playwright/Puppeteer) executes real DOM rendering, iframe sandbox policies, Canvas/WebGL rendering, or real Web Locks.
- **Root Cause:** Fast unit/contract testing was prioritized during Studio export; browser harness was deferred to B17/B18.
- **Dependencies:** None.
- **Recommended Fix:** Add a lightweight Playwright test configuration with 3 smoke tests: (1) Portal loads and filters, (2) Game theater launches AuroBlocks/AuroMatch/AuroMandala, (3) Offline cache serves shell.
- **Verification Criteria:** `npx playwright test` passes in Chromium and WebKit.
- **Status:** Open / Scheduled for B18.3.

---

### B17-GAP-11: Production Supabase Infrastructure Unprovisioned
- **Severity:** P1 (High — External Deployment Dependency)
- **Layer:** Layer D — Backend & Production Readiness Layer
- **Affected Component:** `supabase/migrations/`, `supabase/functions/`, hosting environment variables
- **Description:** Supabase Free cloud backend (`ap-south-1`) has not yet been provisioned. SQL migrations 01–04 and Edge Functions have not been executed on live cloud infrastructure.
- **Root Cause:** Controlled execution policy correctly gated live cloud provisioning to Phase B18 following explicit owner approval.
- **Dependencies:** Owner execution of B15B Supabase Setup Runbook.
- **Recommended Fix:** Execute B15B in Phase B18: Create Supabase project, execute migrations, deploy functions, seed owner role, populate environment secrets.
- **Verification Criteria:** Live Edge Function responds with HTTP 200 to health check; telemetry ingestion stores event in live PostgreSQL.
- **Status:** Open / Scheduled for B18.4 (Owner Action Required).

---

### B17-GAP-12: Commercialization & Payment Webhooks Pipeline Deferred
- **Severity:** P3 (Low / Deferred Feature)
- **Layer:** Layer D — Backend & Production Readiness Layer
- **Affected Component:** `supabase/functions/verify-entitlements/`
- **Description:** No live payment processor webhook (e.g., Stripe, App Store) exists to populate the `public.entitlements` table.
- **Root Cause:** Monetization was explicitly deferred past January 1, 2027 launch; all games are 100% free and unmonetized for launch.
- **Dependencies:** None.
- **Recommended Fix:** Implement Stripe checkout Edge Function in Phase B20 when commercialization is approved.
- **Verification Criteria:** None required for January 1 launch.
- **Status:** Deferred / Post-Launch Scope.

---

## 3. Findings Register Summary Matrix

| Issue ID | Severity | Layer | Summary | Recommended Milestone |
|---|---|---|---|---|
| **B17-GAP-01** | P2 | Portal | AuroBlocks duplicate catalog card in `index.html` | B18.1 |
| **B17-GAP-02** | P3 | Portal | Sidebar "All Games (33)" count label discrepancy | B18.1 |
| **B17-GAP-03** | P3 | Portal | Mobile console edge tab touch gesture usability | B18.2 |
| **B17-GAP-04** | **P1** | Games | AuroBlocks missing Shared SDK bridge & telemetry | **B18.1 (Top Priority)** |
| **B17-GAP-05** | **P1** | Games | Missing in-game return navigation in 5 child games | **B18.2** |
| **B17-GAP-06** | **P1** | SW/SDK | Root SW excludes SDK requests under `/games/` referrer | **B18.1** |
| **B17-GAP-07** | P2 | Portal/Games | Senior Mode not broadcast to child iframes | B18.2 |
| **B17-GAP-08** | P2 | Games | Word Riddle & VAK Sanctuary missing SDK bridges | B19 (Deferred) |
| **B17-GAP-09** | P2 | Portal | Ambient audio does not auto-resume on theater close | B18.2 |
| **B17-GAP-10** | P2 | Testing | No real browser automated E2E testing (Playwright) | B18.3 |
| **B17-GAP-11** | **P1** | Cloud | Production Supabase project unprovisioned in cloud | **B18.4 (Owner Gate)** |
| **B17-GAP-12** | P3 | Backend | Payment webhook not implemented (monetization deferred) | B20 (Post-Launch) |

---

## 4. B17.3 Real-Browser Defect Register & B17.4 Remediation Status

The following real-browser defects were discovered during B17.3 browser E2E test execution and successfully resolved in B17.4:

| Defect ID | Severity | Layer | Summary | Origin Phase | Remediation Milestone | Status |
|---|---|---|---|---|---|---|
| **B17-DEFECT-01** | High | Portal Shell (`portal.js`) | Dynamic import path resolves to HTTP 404 (`./assets/sdk/...` from `assets/js/`) | B17.3 E2E | B17.4 | **RESOLVED & VERIFIED** |
| **B17-DEFECT-02** | Medium | Accessibility (`portal.js`) | Senior Mode runtime toggle queried `#game-theater-iframe` instead of `#game-viewport-iframe` | B17.3 E2E | B17.4 | **RESOLVED & VERIFIED** |
| **B17-DEFECT-03** | High | Game Bridges (`auromatch`, `auromandala`) | `postMessage` threw DOMException when `window.location.origin` was `'null'` | B17.3 E2E | B17.4 | **RESOLVED & VERIFIED** |
| **B17-DEFECT-04** | Low | Game Security (`auroblocks`) | Inline scripts in AuroBlocks HTML violated strict CSP `script-src 'self'` | B17.3 E2E | B17.4 | **RESOLVED & VERIFIED** |

