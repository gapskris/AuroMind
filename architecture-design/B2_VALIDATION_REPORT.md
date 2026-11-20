# AuroMind — Batch B2 Validation Report
## Automated Tests, Real-Browser Evidence & Acceptance Matrix

**Repository:** `gapskris/AuroMind`  
**Branch:** `dev/studio-integration`  
**Batch:** B2 — Portal Integration & Offline SDK Support  
**Verification Date:** 2026-11-19  
**Browser Runtime:** Headless Chromium via `playwright-cli` (`0.1.22`) against live local Express server (`http://localhost:3000`)

---

## 1. Acceptance Criteria Matrix (B2-01 through B2-14)

| ID | Acceptance Criterion | Status | Direct Verification Evidence |
| --- | --- | --- | --- |
| **B2-01** | Portal loads `auromind-adapters.js` and `auromind-sdk.js` in dependency order under CSP `script-src 'self'` | **PASS** | `server.test.js` test 2 verifies exact `<script type="module">` tag order and CSP `script-src 'self'`; live Chromium verified HTTP `200` for both modules and `window.AuroMind` attached with 0 CSP/console errors. |
| **B2-02** | Portal initializes Shared SDK (`gameId: 'portal'`) exactly once and idempotently | **PASS** | `server.test.js` test 3 verifies duplicate `DOMContentLoaded` + 3 concurrent `ready()` calls result in `initCalls.length === 1` (`{ gameId: 'portal', appVersion: '2.5.0' }`); live Chromium confirmed `portalInitCount === 1` on initial load, reload, and cold offline load. |
| **B2-03** | Persistent valid UUIDv4 guest identity established in `AuroMindPlatformDB` and `auromind.platform.v1.guest` | **PASS** | Live Chromium established `guest_ba6c3d2f-6c59-4bd4-b8b4-4c2ac1bd102b` (`uuidV4Valid: true`), verified identical in `AuroMindPlatformDB` (`platform_meta` / `guest_identity`) and `localStorage['auromind.platform.v1.guest']`. |
| **B2-04** | Portal does not create a second identity or register itself as a game adapter | **PASS** | `server.test.js` test 3 verified `adapterRegisterCalls === 0`; live Chromium confirmed `window.AuroMind.adapters.list().length === 0` and read-only frozen `window.AuroMindPortal`. |
| **B2-05** | SDK init failure degrades gracefully without blocking portal UI/navigation | **PASS** | `server.test.js` test 4 verified rejected `sdk.init` (`UNSUPPORTED_IDENTITY_VERSION`) resolves `ready()` to `null`, captures `getLastError()`, logs warning, and does not throw or block portal startup. |
| **B2-06** | Guest identity survives page reloads | **PASS** | Live Chromium reload confirmed identical `guest_ba6c3d2f-6c59-4bd4-b8b4-4c2ac1bd102b`, `sdkInitialized: true`, and `portalInitCount: 1`. |
| **B2-07** | Portal Clear Cache clears portal preferences while strictly preserving guest identity (`auromind.platform.v1.guest`, `AuroMindPlatformDB`) and game data | **PASS** | `server.test.js` test 5 verified all `auromind_*` cleared while `auromind.platform.v1.guest`, `auromind.platform.future`, `vak_save_v1`, `auromatch_garden`, and IndexedDB (`deleteDatabase` calls `0`) survived. Live Chromium Clear Cache + reload cleared all 4 portal prefs, displayed `'Cache Cleared ✓'`, preserved `vak_b2_sentinel`, and retained identical `guest_ba6c3d2f-6c59-4bd4-b8b4-4c2ac1bd102b` in both `localStorage` and `AuroMindPlatformDB`. |
| **B2-08** | Root SW precaches both shared SDK files and bumps cache version cleanly (`auro-portal-v1.1.0`) | **PASS** | `server.test.js` test 6 verified `install` precaches both SDK files + `portal.js?v=3.7` and `activate` evicts legacy `auro-portal-v1.0.0`. Live Chromium verified active `http://localhost:3000/sw.js` with `auro-portal-v1.1.0` (`56` entries) containing `/assets/sdk/auromind-sdk.js`, `/assets/sdk/auromind-adapters.js`, `/assets/js/portal.js?v=3.7`, and `/index.html`. |
| **B2-09** | Cold offline portal visit loads portal + both SDK files from SW cache and initializes same guest identity offline | **PASS** | Live Chromium `context.setOffline(true)` + brand-new tab `goto('http://localhost:3000/')` verified `navigatorOnLine: false`, `sdkOfflineState.online: false`, HTTP `200` + `fromSW: true` for `/`, `/assets/sdk/auromind-sdk.js`, `/assets/sdk/auromind-adapters.js`, and `/assets/js/portal.js?v=3.7`, `sameOriginFailedCount: 0`, `offlineConsoleErrors: []`, `sdkInitialized: true`, `portalInitCount: 1`, and identical `guest_ba6c3d2f-6c59-4bd4-b8b4-4c2ac1bd102b`. |
| **B2-10** | Root SW strictly isolated from `/games/*`, game iframes, nested game SWs, and non-runtime files | **PASS** | `server.test.js` test 6 verified `sw.js` bypass ordering (`/games/*` before SDK route before generic Step 4) and `respondWith` not called for `/games/*`, game-referrer SDK fetches, `architecture-design/*`, `phase0-audit/*`, `server.js`, `*.test.js`, `*.md`, and `health`. Live Chromium confirmed all 6 game entry points returned HTTP `200` with `fromServiceWorker: false`, `pageErrors: []`, and `auro-portal-v1.1.0` cache audit showed `gamesKeysCount: 0` and `privateDocsKeysCount: 0`. |
| **B2-11** | Existing portal navigation, search, modals, visual layout, and theater game launching remain intact | **PASS** | Live Chromium verified `#search-input` filtering (`1` visible for `"AuroMandala"`, `37` on reset), `#about-modal` open/close, `.play-game-btn` theater launch (`iframeSrc: "games/vak/index.html"`) and `#theater-back-btn` exit, plus visual inspection of `.playwright-cli/b2-portal-catalog.png` confirming crisp layout and zero console errors. |
| **B2-12** | GitHub Pages allowlist workflow remains manual-only (`workflow_dispatch:`) and verifies SDK files while excluding private docs/tests | **PASS** | `server.test.js` test 7 verified `workflow_dispatch:` only and SDK assertions; local allowlist assembly dry-run into temp directory passed (`TOTAL_FILES=956`, `MD_COUNT=0`, both SDK files present, all forbidden paths absent). |
| **B2-13** | All automated test suites, syntax checks, build, and lint pass with zero regressions | **PASS** | `node --test server.test.js` (`7/7` pass), `node --test auromind-sdk.test.js` (`31/31` pass), `node --check` on all modified JS files (`0` errors), `npm run build` / `compile_applet` (pass), `npm run lint` / `lint_applet` (pass). |
| **B2-14** | Protected files unchanged (SHA-256 parity) and tracked-file budget `≤ 990` maintained | **PASS** | All 15 monitored game/corpus/config/SDK files matched pre-B2 SHA-256 digests 100%; candidate tracked-file count = `987 ≤ 990` (`984` baseline + `3` B2 reports). |

---

## 2. Automated Test Suite Results

| Suite / Command | Result | Details |
| --- | --- | --- |
| `node --test server.test.js` | **PASS (7/7)** | Static serving + 404 blocking, `index.html` module order & CSP, single-init idempotency & bridge, graceful init failure, Clear Cache identity protection, SW precache/offline/isolation simulation, Pages workflow verification |
| `node --test auromind-sdk.test.js` | **PASS (31/31)** | Full B1/B1.1 Shared SDK regression suite (identity, storage repair, concurrency, VersionError, adapters, offline state) |
| `node --check assets/js/portal.js sw.js server.test.js` | **PASS** | Zero syntax errors |
| `compile_applet` (`npm run build`) | **PASS** | Build succeeded |
| `lint_applet` (`npm run lint`) | **PASS** | `node --check server.js && node --check assets/js/portal.js` passed |
| Local GitHub Pages allowlist dry-run | **PASS** | `PAGES_DRYRUN_PASS \| TOTAL_FILES=956 \| MD_COUNT=0` (temp directory cleaned immediately) |

---

## 3. Real-Browser & Cold-Offline Verification Log (Headless Chromium)

### 3.1 Online Initial Load (`http://localhost:3000/`)
- `window.AuroMind` present: `true`
- `window.AuroMind.isInitialized()`: `true`
- `window.AuroMindPortal.getInitCount()`: `1`
- `window.AuroMind.adapters.list().length`: `0`
- Guest ID established: `guest_ba6c3d2f-6c59-4bd4-b8b4-4c2ac1bd102b` (valid UUIDv4)
- `localStorage['auromind.platform.v1.guest'].guestId`: `guest_ba6c3d2f-6c59-4bd4-b8b4-4c2ac1bd102b`
- `IndexedDB AuroMindPlatformDB -> platform_meta['guest_identity'].guestId`: `guest_ba6c3d2f-6c59-4bd4-b8b4-4c2ac1bd102b`
- Console errors: `0` (2 pre-existing iframe attribute warnings on `index.html:1549`)

### 3.2 Page Reload Persistence
- Reloaded `http://localhost:3000/`:
  - `guestId`: `guest_ba6c3d2f-6c59-4bd4-b8b4-4c2ac1bd102b` (unchanged)
  - `portalInitCount`: `1`
  - `sdkInitialized`: `true`

### 3.3 Clear Cache & Post-Clear Reload
- Seeded portal preferences (`auromind_senior_mode`, `auromind_reduced_motion`, `auromind_ambient_volume`, `auromind_guide_seen`) and synthetic game sentinel (`vak_b2_sentinel = 'keep-me'`).
- Clicked `#settings-reset-btn` and confirmed prompt:
  - Prompt text: `"Clear local AuroMind cache and preferences? Your guest identity and game progress will be preserved."`
  - Button feedback: `"Cache Cleared ✓"`
  - Portal preferences after click: all 4 `null` (cleared)
  - `auromind.platform.v1.guest`: present (`true`)
  - `vak_b2_sentinel`: preserved (`true`, cleaned up after reload check)
- Reloaded `http://localhost:3000/`:
  - `guestId`: `guest_ba6c3d2f-6c59-4bd4-b8b4-4c2ac1bd102b` (unchanged)
  - `AuroMindPlatformDB` `guest_identity.guestId`: `guest_ba6c3d2f-6c59-4bd4-b8b4-4c2ac1bd102b` (unchanged)
  - `localStorage` mirror `guestId`: `guest_ba6c3d2f-6c59-4bd4-b8b4-4c2ac1bd102b` (unchanged)
  - `portalInitCount`: `1`

### 3.4 Root Service Worker Registration & Precache
- Active worker: `http://localhost:3000/sw.js`
- Controller: `http://localhost:3000/sw.js`
- Cache storage keys: `["auro-portal-v1.1.0", "auro-portal-fonts-v1.0.0"]`
- `auro-portal-v1.1.0` total entries: `56`
  - `/assets/sdk/auromind-sdk.js`: `true`
  - `/assets/sdk/auromind-adapters.js`: `true`
  - `/assets/js/portal.js?v=3.7`: `true`
  - `/index.html`: `true`
  - `/games/*` entries: `0`
  - Private docs / tests / server entries: `0`

### 3.5 Cold-Offline Portal Visit (`context.setOffline(true)` + New Page)
- `navigator.onLine`: `false`
- `window.AuroMind.storage.getOfflineState()`: `{ online: false, serviceWorkerControlled: true, idbAvailable: true, lsAvailable: true }`
- Same-origin responses served offline:
  - `/` → HTTP `200`, `fromServiceWorker: true`
  - `/assets/sdk/auromind-sdk.js` → HTTP `200`, `fromServiceWorker: true`
  - `/assets/sdk/auromind-adapters.js` → HTTP `200`, `fromServiceWorker: true`
  - `/assets/js/portal.js?v=3.7` → HTTP `200`, `fromServiceWorker: true`
- Same-origin failed requests: `0`
- Offline console errors: `0`
- `window.AuroMind.isInitialized()`: `true`
- `window.AuroMindPortal.getInitCount()`: `1`
- `window.AuroMindPortal.getGuestId()`: `guest_ba6c3d2f-6c59-4bd4-b8b4-4c2ac1bd102b` (exact match with online guest ID)

### 3.6 All Six Live Game Routes & Root SW Isolation
| Route | HTTP Status | Served by Root SW (`fromServiceWorker`) | Page Errors |
| --- | --- | --- | --- |
| `/games/vak/index.html` | `200` | `false` | `0` |
| `/games/auromatch/index.html` | `200` | `false` | `0` |
| `/games/word-riddle/index.html` | `200` | `false` | `0` |
| `/games/vak-living-sanctuary/index.html` | `200` | `false` | `0` |
| `/games/auromandala/index.html` | `200` | `false` | `0` |
| `/games/auroblocks/index.html` | `200` | `false` | `0` |

Post-visit `auro-portal-v1.1.0` cache audit: `totalKeys: 56`, `gamesKeysCount: 0`, `privateDocsKeysCount: 0`.

### 3.7 Portal UI & Visual Inspection
- Search filtering (`#search-input`): `"AuroMandala"` narrowed grid to `1` visible card; clearing restored all `37` cards.
- About modal (`#sidebar-about-btn` / `#about-close-btn`): opened and closed cleanly.
- In-portal theater launch (`.play-game-btn` → `#game-theater-view` → `#theater-back-btn`): loaded `games/vak/index.html` inside `#game-viewport-iframe` and returned cleanly to catalog.
- Visual verification of `.playwright-cli/b2-portal-catalog.png` confirmed intact layout, typography, cards, and sidebar at `1440x900`.
