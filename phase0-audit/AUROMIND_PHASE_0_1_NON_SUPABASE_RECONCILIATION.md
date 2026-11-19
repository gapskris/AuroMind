# AuroMind — Phase 0.1: Non-Supabase Finding Reconciliation & Authoritative Remediation Roadmap

- **Date:** 2026-11-18
- **Mode:** Strictly Read-Only Reconciliation & Remediation Planning (Zero application files modified)
- **Active Baseline Commit on `main` & `dev/studio-integration`:** `3805f624ce3d63b80278e7fc531f38b1af1b0a5b` (`recovery/phase1-batch1-2-checkpoint`)
- **Scope:** Reconcile all **35 Phase 0 Findings (`AURO-01`–`AURO-35`)** into:
  - **30 Non-Supabase Candidate Findings:** `AURO-01`–`AURO-26` and `AURO-32`–`AURO-35`
  - **5 Explicitly Deferred Supabase / Cloud Findings:** `AURO-27`–`AURO-31`

---

## 1. Executive Summary of Reconciliation

Following the completion of the GitHub recovery audit (`AUROMIND_FRESH_STUDIO_IMPORT_INTEGRITY_AUDIT.md`), the safe GitHub handoff plan (`AUROMIND_SAFE_GITHUB_HANDOFF_PLAN.md`), the Level C Studio close/reopen validation (`AUROMIND_STUDIO_POST_REOPEN_VALIDATION.md`), and the GitHub merge readiness audit (`AUROMIND_GITHUB_PRE_MERGE_READINESS_AUDIT.md`), all 35 Phase 0 findings have been reconciled against the exact 987-file codebase at commit `3805f624ce3d63b80278e7fc531f38b1af1b0a5b`:

| Reconciliation Category | Count | Finding IDs | Summary |
| :--- | :---: | :--- | :--- |
| **1. Already Resolved in Recovered Phase 1 / Batch 1.2 Baseline (`3805f624...`)** | **13** | `AURO-04`, `AURO-05`, `AURO-06`, `AURO-07`, `AURO-09`, `AURO-10`, `AURO-11`, `AURO-12`, `AURO-13`, `AURO-14`, `AURO-20`, `AURO-22`, `AURO-23`, `AURO-32` *(14 total, with `AURO-01` and `AURO-08` partially resolved)* | Verified present and intact across the 18 recovered files in commit `3805f624ce3d63b80278e7fc531f38b1af1b0a5b`. Require only regression verification in **Batch 4** (zero re-implementation needed). |
| **2. Partially Resolved in `3805f624...` — Remaining Scope Open** | **2** | `AURO-01`, `AURO-08` | `AURO-01` added `<link rel="manifest">` and `"scope": "./"` to the Portal, but root `sw.js` and PNG icons are still missing. `AURO-08` isolated "Clear Cache" to `auromind_*` keys, but Senior Mode, Reduced Motion, and Ambient Volume are not restored on boot. Allocated to **Batch 1**. |
| **3. Open Non-Supabase Findings Allocated to Batches 1–4** | **14** | `AURO-02`, `AURO-03`, `AURO-15`, `AURO-16`, `AURO-17`, `AURO-18`, `AURO-19`, `AURO-21`, `AURO-24`, `AURO-25`, `AURO-26`, `AURO-33`, `AURO-34`, `AURO-35` | Organized into **Batch 1** (Portal PWA/UI), **Batch 2** (Word Riddle, AuroMatch, AuroBlocks), **Batch 3** (VAK Living Sanctuary), and **Batch 4** (6-Game Regression). |
| **4. Explicitly Deferred Supabase / Cloud / Auth Findings** | **5** | `AURO-27`, `AURO-28`, `AURO-29`, `AURO-30`, `AURO-31` | Strictly deferred out of scope. All games remain 100% offline-first using browser `localStorage`. |
| **TOTAL PHASE 0 FINDINGS** | **35** | `AURO-01` – `AURO-35` | **30 Non-Supabase Candidates + 5 Deferred Supabase Findings** |

---

## 2. Master Reconciliation Ledger: All 30 Non-Supabase Candidate Findings (`AURO-01`–`AURO-26`, `AURO-32`–`AURO-35`)

| ID | Component / Game | Finding Title & Technical Description | Severity | Affected Files | Current Status in `3805f624...` | Target Batch | Expected Outcome |
| :--- | :--- | :--- | :---: | :--- | :---: | :---: | :--- |
| **`AURO-01`** | **Portal (`/` )** | **Portal Root PWA Manifest, Icons & Missing Root Service Worker:** Commit `3805f624...` added `<link rel="manifest" href="./manifest.json">` to `index.html` and `"scope": "./"` to `manifest.json`, but `/` still has no root `sw.js` (nor registration in `portal.js`) and `manifest.json` lists only an SVG icon, so loading the portal catalog offline fails with `ERR_INTERNET_DISCONNECTED`. | **HIGH** | `index.html`, `manifest.json`, `assets/js/portal.js`, `/sw.js` *(new)* | **PARTIALLY RESOLVED** | **Batch 1** | Root `/sw.js` precaches the portal shell (`index.html`, `manifest.json`, `assets/css/portal.css`, `assets/js/portal.js`, `assets/icons/*`, key thumbnails) without intercepting `/games/*` scopes; portal loads offline. |
| **`AURO-02`** | **Portal (`/` )** | **Inconsistent "Live Now" Counts & Missing Feedback Dropdown Options:** 6 games are live, but `index.html` shows `Live Now (3)` in the sidebar (line 49), `5 Live Now` in the hero stats (line 184), `5 Active • 1 Next Live` in the section header (line 208), `3 Live Now` in the About Modal (line 1674), and omits `Word Riddle` and `AuroBlocks` from `#feedback-topic-select` (lines 1827–1836). | **MEDIUM** | `index.html`, `assets/js/portal.js` | **OPEN** | **Batch 1** | Sidebar, hero stats, section badge, and About Modal consistently reflect `6` live games; `#feedback-topic-select` includes all 6 live titles. |
| **`AURO-03`** | **Portal (`/` )** | **Missing `data-game-id="auromatch"` on AuroMatch `<article class="game-card">`:** In `index.html` (line 254), the AuroMatch `<article class="game-card">` lacks `data-game-id="auromatch"` (present only on its child `<button>`), unlike the other 5 live game cards. | **LOW** | `index.html` | **OPEN** | **Batch 1** | `<article class="game-card" data-game-id="auromatch" ...>` matches the schema of all other live game cards. |
| **`AURO-04`** | **Portal (`/` )** | **Portal 432 Hz Ambient Audio Collides with Child Game Audio:** Launching a game in Theater Mode previously left the portal's 432 Hz Web Audio oscillator playing simultaneously over the child game's audio. | **MEDIUM** | `assets/js/portal.js` | **RESOLVED in `3805f624...`** | **Batch 4 (Verify)** | `window.suspendAmbientAudio()` stops and disconnects the 432 Hz oscillator whenever `openGameInTheater()` runs. |
| **`AURO-05`** | **Portal / Games** | **Wildcard/Permissive `postMessage` Origin Checks & Hardcoded `github.io` Exit URLs:** Portal accepted broad origins and `vak`/`auromatch` redirected to hardcoded `https://gapskris.github.io/AuroMind/` when exiting standalone mode. | **HIGH** | `assets/js/portal.js`, `games/vak/index.html`, `games/auromatch/index.html`, `games/auromatch/src/main.js` | **RESOLVED in `3805f624...`** | **Batch 4 (Verify)** | Strict `event.origin !== window.location.origin` check in `portal.js` and relative `new URL('../../index.html', window.location.href).href` redirects in games. |
| **`AURO-06`** | **Portal (`/` )** | **Feedback Form Hidden-Iframe Target Blocked by CSP:** Submitting `#feedback-form` via hidden `<iframe name="feedback-target-frame">` failed under strict CSP. | **MEDIUM** | `index.html`, `assets/js/portal.js` | **RESOLVED in `3805f624...`** | **Batch 4 (Verify)** | Replaced hidden iframe with async `fetch('https://api.web3forms.com/submit')` POST allowed by `connect-src`. |
| **`AURO-07`** | **Portal (`/` )** | **Responsive Grid Media Queries Missing `.live-sanctuaries-grid` & Unclosed Root Divs:** Mobile/tablet breakpoints in `portal.css` targeted `.games-uniform-grid` but missed `.live-sanctuaries-grid`, and `index.html` lacked two closing `</div>` tags before `#auth-modal`. | **MEDIUM** | `index.html`, `assets/css/portal.css` | **RESOLVED in `3805f624...`** | **Batch 4 (Verify)** | `.live-sanctuaries-grid` included in mobile/tablet media queries and DOM tree properly closed. |
| **`AURO-08`** | **Portal (`/` )** | **Portal Accessibility & Audio Settings Not Restored on Boot:** Commit `3805f624...` scoped `#settings-reset-btn` to `auromind_*` keys so child game saves are protected, but `auromind_reduced_motion`, Senior Mode (`auromind_senior_mode`), and ambient volume (`auromind_ambient_volume`) are not restored on `DOMContentLoaded`. | **LOW** | `assets/js/portal.js` | **PARTIALLY RESOLVED** | **Batch 1** | Senior Mode, Reduced Motion, and Ambient Volume slider state persist in `localStorage` under `auromind_*` and restore automatically on portal boot. |
| **`AURO-09`** | **1. VAK** | **VAK Service Worker Scope & Cross-Game Cache Deletion Hazard:** `games/vak/sw.js` previously deleted any cache starting with `vak-` (threatening `vak-living-sanctuary` caches) and lacked explicit `{ scope: './' }` registration and fetch scope guards. | **HIGH** | `games/vak/index.html`, `games/vak/sw.js` | **RESOLVED in `3805f624...`** | **Batch 4 (Verify)** | Registered with `{ scope: './' }`, cache cleanup restricted to `auro-vak-*`, and fetch handler restricted to `scopeBase`. |
| **`AURO-10`** | **1. VAK** | **VAK Missing Embedded Quotes Index (`window.__VAK_BUILD_QUOTES_INDEX__`):** `scriptureCardRenderer` failed to display quotes when `teachingsDb.quotes` was unpopulated in the embedded single-file bundle. | **HIGH** | `games/vak/index.html` | **RESOLVED in `3805f624...`** | **Batch 4 (Verify)** | `buildEmbeddedQuotesIndex()` indexes all 1,368 Wisdom, Matrimandir, and Cosmos level quotes at startup. |
| **`AURO-11`** | **1. VAK** | **VAK Theme Selector 0-Count Cards & Broken Theme Level Progression:** Level `domain` values (`Body & Movement`, `Heart & Feelings`, etc.) did not map to the 7 sacred theme categories, showing `0` levels per theme and resetting to level 1 on selection. | **HIGH** | `games/vak/index.html` | **RESOLVED in `3805f624...`** | **Batch 4 (Verify)** | `VAK_DOMAIN_TO_THEME_MAP`, `resolveThemeForLevel()`, and `getLevelsForTheme()` populate accurate counts and advance within the chosen theme. |
| **`AURO-12`** | **1. VAK** | **VAK Redundant 404 Network Fetches for Embedded JSON Files:** VAK attempted network fetches for non-existent external files (`data/levels_source.json`, `data/cosmos_levels.json`, `data/matrimandir_levels.json`, `data/ashram_events.json`, `doc/teachings_repository.json`, `version.json`). | **MEDIUM** | `games/vak/index.html`, `games/vak/sw.js` | **RESOLVED in `3805f624...`** | **Batch 4 (Verify)** | All 6 fetches short-circuit to the embedded `window.__EMBEDDED_*__` datasets with zero 404 console errors. |
| **`AURO-13`** | **1. VAK** | **VAK Mode B (`4 Pics 1 Word`) Empty-Registry Trap:** Toggling to Mode B when `puzzles` registry is empty trapped players on a blank screen and persisted `MODE_B` in `localStorage`. | **HIGH** | `games/vak/index.html` | **RESOLVED in `3805f624...`** | **Batch 4 (Verify)** | `isModeBAvailable()` disables Mode B when registry is empty, shows an informational toast, and auto-migrates stuck `MODE_B` saves to `MODE_A`. |
| **`AURO-14`** | **1. VAK** | **VAK Dual Manifest (`manifest.json` & `manifest.webmanifest`) Parity:** Ensure both manifest files in `games/vak/` remain aligned and precached in `games/vak/sw.js`. | **LOW** | `games/vak/manifest.json`, `games/vak/manifest.webmanifest`, `games/vak/sw.js` | **RESOLVED in `3805f624...`** | **Batch 4 (Verify)** | Both files are present, aligned, and precached in `CORE_SHELL_ASSETS`. |
| **`AURO-15`** | **3. Word Riddle** | **Word Riddle Service Worker Incomplete Precache List (Offline Blank Screen):** `games/word-riddle/sw.js` precaches only `['./', './index.html', './manifest.webmanifest', './icon.svg']` and omits all 20 compiled Vite JS/CSS bundles in `games/word-riddle/assets/`. Offline navigation with a cold HTTP cache returns `index.html` for `.js` requests and fails to mount React. | **CRITICAL** | `games/word-riddle/sw.js` | **OPEN** | **Batch 2** | `games/word-riddle/sw.js` precaches the core entry/vendor/CSS bundles (`index-ClQZWKJi.js`, `index-w4eIMPyb.css`, `vendor-*.js`, and `theme-th01..th15-*.js`) and only falls back to `./index.html` on `request.mode === 'navigate'`. |
| **`AURO-16`** | **3. Word Riddle** | **Word Riddle Eager `modulepreload` of All 15 Theme Bundles in `index.html`:** `games/word-riddle/index.html` has 15 `<link rel="modulepreload" href="./assets/theme-th01...js">` tags in `<head>`, forcing simultaneous download of all 15 theme chunks (~3.05 MB) on initial page load. | **MEDIUM** | `games/word-riddle/index.html` | **OPEN** | **Batch 2** | Remove eager `modulepreload` tags for `theme-th02..th15` from `games/word-riddle/index.html` (retaining entry, vendor, and `theme-th01` preloads while `sw.js` caches all theme chunks in the background). |
| **`AURO-17`** | **2. AuroMatch** | **AuroMatch Service Worker Query-String (`?v=4.0`) Cache Miss Offline:** `games/auromatch/index.html` loads `./styles/main.css?v=4.0` and `./src/main.js?v=4.0`, while `games/auromatch/sw.js` precaches and stores clean URLs without query parameters, causing `caches.match(event.request)` in `.catch()` to miss offline. | **CRITICAL** | `games/auromatch/sw.js` | **OPEN** | **Batch 2** | `games/auromatch/sw.js` falls back to `(await caches.match(event.request)) || (await caches.match(url.origin + url.pathname)) || (await caches.match(event.request, { ignoreSearch: true }))` and scopes fetch interception to `./`. |
| **`AURO-18`** | **2. AuroMatch** | **AuroMatch Service Worker Missing 9 of 12 ES Modules in Precache List:** `games/auromatch/sw.js` precaches only `main.js`, `gameManager.js`, `entitlementManager.js`, and `synthesizer.js`, omitting `storageAdapter.js`, `settings.js`, `particles.js`, `scriptureCard.js`, `floraDatabase.js`, `boardGenerator.js`, `boardRenderer.js`, `themeManager.js`, `constellation.js`, and `inputDispatcher.js`. Offline startup fails if any imported ES module is uncached. | **HIGH** | `games/auromatch/sw.js` | **OPEN** | **Batch 2** | `ASSETS_TO_CACHE` in `games/auromatch/sw.js` includes all 12 ES modules under `./src/**` and core icons under `./Assets/icons/*`. |
| **`AURO-19`** | **2. AuroMatch & Portal** | **AuroMatch 211 MB Unoptimized PNG Asset Footprint & Duplicate `AuroMatch_Web_Prototype.html`:** `games/auromatch/Assets/` is 211 MB (89 multi-MB PNGs in `backgrounds/` = 153 MB; 715 PNGs in `themes/` = 40 MB; duplicate `.png`/`.jpg` pairs) plus `games/auromatch/AuroMatch_Web_Prototype.html` (86 KB unreferenced duplicate). | **MEDIUM** | `games/auromatch/AuroMatch_Web_Prototype.html`, `games/auromatch/sw.js` *(Note: bulk PNG re-encoding see Section 4.2)* | **OPEN** | **Batch 2 (Scoped)** | Ensure `sw.js` uses runtime `Cache-First` (not install-time precache) for the 211 MB `Assets/backgrounds/` & `Assets/themes/` folders so SW install never times out; handle `AuroMatch_Web_Prototype.html` and bulk image compression per explicit approval scope (see Section 4.2). |
| **`AURO-20`** | **6. AuroBlocks** | **AuroBlocks Subpath Service Worker Registration & Relative Manifest Paths:** `games/auroblocks` previously registered `/sw.js` at root scope `/` and used `/` paths in `manifest.webmanifest` and `precache-manifest.json`. | **HIGH** | `games/auroblocks/index.html`, `manifest.webmanifest`, `precache-manifest.json`, `sw.js` | **RESOLVED in `3805f624...`** | **Batch 4 (Verify)** | `index.html` shims `navigator.serviceWorker.register` to `./sw.js` (`scope: './'`), and `manifest.webmanifest` / `precache-manifest.json` / `sw.js` use `./`. |
| **`AURO-21`** | **6. AuroBlocks** | **AuroBlocks Root-Relative `/assets/artwork/*.webp` Requests Outside Subpath & SW Scope:** The protected bundle `games/auroblocks/assets/index-BLt2QrTp.js` sets `img.src = "/assets/artwork/..."` for 4 WebP images. Offline, `/assets/artwork/*` is outside `/games/auroblocks/` SW scope, and on static GitHub Pages subpath hosting (`https://gapskris.github.io/AuroMind/`), `/assets/artwork/*` resolves to root and 404s. | **HIGH** | `games/auroblocks/index.html`, `/assets/artwork/*.webp` *(or root `/sw.js`)* — **Protected bundle `index-BLt2QrTp.js` untouched** | **OPEN** | **Batch 2** | Add a lightweight non-invasive DOM `HTMLImageElement` / `MutationObserver` URL normalizer in `games/auroblocks/index.html` that rewrites `/assets/artwork/*.webp` → `./assets/artwork/*.webp` before fetch, allowing `games/auroblocks/sw.js` (which already precaches `./assets/artwork/*.webp`!) to serve all 4 images both online on GitHub Pages and 100% offline. |
| **`AURO-22`** | **5. AuroMandala** | **AuroMandala Workbox Runtime Cache Name Collision:** `games/auromandala/sw.js` used generic `google-fonts-cache` / `gstatic-fonts-cache` names. | **LOW** | `games/auromandala/sw.js` | **RESOLVED in `3805f624...`** | **Batch 4 (Verify)** | Scoped to `auromandala-google-fonts-cache` and `auromandala-gstatic-fonts-cache`. |
| **`AURO-23`** | **4. VAK Sanctuary** | **VAK Living Sanctuary Subpath Manifest, `registerSW.js` Shim & Cache Cleanup:** `manifest.webmanifest` used `/` paths and `offline-shell-sw.js` deleted all non-matching caches across the origin. | **HIGH** | `games/vak-living-sanctuary/manifest.webmanifest`, `registerSW.js`, `offline-shell-sw.js`, `sw.js` | **RESOLVED in `3805f624...`** | **Batch 4 (Verify)** | Manifest uses `./`, `registerSW.js` normalizes scope to `./`, and `offline-shell-sw.js` only deletes `vak-offline-shell-*`. |
| **`AURO-24`** | **4. VAK Sanctuary** | **VAK Living Sanctuary 5 Missing `/src/assets/images/vak_*.jpg` Artwork Files (HTTP 404s):** Protected bundle `index-CUrzyYgb.js` requests 5 `/src/assets/images/vak_*.jpg` images that do not exist, logging 5 HTTP 404 errors on load. | **HIGH** | `games/vak-living-sanctuary/index.html`, `games/vak-living-sanctuary/sw.js`, `games/vak-living-sanctuary/assets/` — **Protected bundle `index-CUrzyYgb.js` untouched** | **OPEN** | **Batch 3** | Map the 5 `/src/assets/images/vak_*.jpg` requests via a non-invasive image URL shim in `games/vak-living-sanctuary/index.html` (and precache in `sw.js`) to local sanctuary artwork assets so all 5 images render with HTTP 200 online and offline without modifying `index-CUrzyYgb.js`. |
| **`AURO-25`** | **4. VAK Sanctuary** | **VAK Living Sanctuary 11 `/api/corpus/*` Network 404 Requests Before Embedded Fallback:** `index-CUrzyYgb.js` fetches 11 `/api/corpus/*` endpoints (`overview`, `theme1/levels`, `theme1/lexicons`, `theme2/gardens`, `theme3/cosmos`, `wisdom-sanctuary`, `speech-chamber`, `ashram-calendar`, `classified-lexicon`, `validate-scrabble`, `scrabble-list`) which 404 on static hosting before falling back to embedded client data. | **MEDIUM** | `games/vak-living-sanctuary/index.html` — **Protected bundle `index-CUrzyYgb.js` untouched** | **OPEN** | **Batch 3** | Add a lightweight `window.fetch` interceptor in `games/vak-living-sanctuary/index.html` for `/api/corpus/*` so the client bundle immediately uses its built-in embedded corpus without generating network 404 console errors online or offline. |
| **`AURO-26`** | **4. VAK Sanctuary** | **VAK Living Sanctuary `/api/beta-auth/*` (`status`, `login`, `logout`) Network 404 Requests:** `index-CUrzyYgb.js` queries `/api/beta-auth/status` on boot, generating a 404 console error on static hosting. | **LOW** | `games/vak-living-sanctuary/index.html` — **Protected bundle `index-CUrzyYgb.js` untouched** | **OPEN** | **Batch 3** | Handle `/api/beta-auth/{status,login,logout}` in the `games/vak-living-sanctuary/index.html` `window.fetch` interceptor with a local JSON `200 OK` response (`{ authenticated: true, beta: true }`), eliminating 404 noise while keeping all gameplay 100% local. |
| **`AURO-32`** | **Portal, VAK & AuroMatch** | **Insecure Client-Side License Token Bypass & Wildcard Purchase Bridge (`ENT-001`):** Previously, clicking "Complete Purchase" minted a fake `localStorage` token (`AUROMIND-SANCTUARY-PASS-...`) and broadcast `AUROMIND_LICENSE_GRANTED` via `postMessage('*', '*')`. | **HIGH** | `index.html`, `assets/js/portal.js`, `games/vak/index.html`, `games/auromatch/src/controllers/entitlementManager.js` | **RESOLVED in `3805f624...`** | **Batch 4 (Verify)** | Fake token minting and `AUROMIND_LICENSE_GRANTED` listeners are disabled; modals truthfully state `"Sanctuary Lifetime Pass (Planned)"` while all beta levels remain unlocked (`COMMERCIAL_GATE_ENABLED: false`). |
| **`AURO-33`** | **Studio Runtime (`server.js` & `.gitignore`)** | **Express Dev Server Static Exposure of Root Config/Server Files & `.gitignore` Hygiene:** `server.js` mounts `express.static(__dirname)`, allowing HTTP GET access to `/server.js`, `/server.test.js`, `/package.json`, `/bun.lock`, and `/phase0-audit/*`, and `.gitignore` omits `.aistudio/` and `.playwright-cli/`. | **LOW** | `server.js`, `server.test.js`, `.gitignore` | **OPEN** | **Batch 1 (Studio Hygiene Sub-Step)** | Block HTTP serving of `/server.js`, `/server.test.js`, `/package.json`, `/bun.lock`, and `/phase0-audit/*` in `server.js` (verified by `server.test.js`), and add `.aistudio/` and `.playwright-cli/` to `.gitignore`. |
| **`AURO-34`** | **Portal & All Games** | **Google Fonts Offline Fallback & Service Worker Caching Consistency:** Portal (`index.html`), `auromatch`, and `vak-living-sanctuary` load Google Fonts (`fonts.googleapis.com` / `fonts.gstatic.com`) without SW runtime caching or offline fallback, causing network errors in airplane mode. | **LOW** | `/sw.js`, `games/auromatch/sw.js`, `games/vak-living-sanctuary/offline-shell-sw.js` | **OPEN** | **Batches 1, 2 & 3** | Cache Google Fonts with `CacheFirst` / `StaleWhileRevalidate` in each respective Service Worker and fail gracefully to system serif/sans-serif stacks when offline with a cold font cache. |
| **`AURO-35`** | **All 6 Games & Portal** | **Full Six-Game Regression, Offline Airplane-Mode & Progress Persistence Verification:** End-to-end verification that the Portal and all 6 games launch, play interactively, persist `localStorage` progress, and reload cleanly in true offline mode (`context.setOffline(true)`). | **HIGH** | `server.test.js` & Playwright verification suite (read-only against protected bundles) | **OPEN** | **Batch 4** | 100% pass across HTTP, interactive DOM/Canvas gameplay, `localStorage` save/restore, Service Worker activation, and offline reload across Portal + all 6 games. |

---

## 3. Explicitly Deferred Supabase / Cloud Findings (`AURO-27`–`AURO-31`)

Per Mandatory Constraint #2, the following **5 findings (`AURO-27`–`AURO-31`)** are **explicitly deferred** and must **NOT** be implemented in any batch of this roadmap:

| ID | Deferred Finding Title | Deferral Rationale & Offline-First Preservation Guarantee |
| :--- | :--- | :--- |
| **`AURO-27`** | **Supabase Project Provisioning, Schema & Client SDK Setup** | Deferred. No `@supabase/supabase-js` dependency, cloud database, or external API keys will be added. |
| **`AURO-28`** | **User Authentication Flow (`#auth-modal` Magic Link / OAuth Sign-In)** | Deferred. Portal `#auth-modal` remains a static informational roadmap teaser (`"Cloud synchronization and purchase entitlements are arriving in the next release!"`). |
| **`AURO-29`** | **Cross-Device Cloud Save Synchronization (`localStorage` ↔ Supabase Sync)** | Deferred. All 6 games and the portal continue using 100% client-side browser `localStorage` (and `IndexedDB` backup in AuroMatch) with zero remote persistence calls. |
| **`AURO-30`** | **Server-Verified Commercial Entitlements & Payment Checkout Backend (`ENT-001`)** | Deferred. Client-side fake license minting was already removed in `AURO-32` (`3805f624...`), and `COMMERCIAL_GATE_ENABLED` remains `false` so all levels and themes in VAK, AuroMatch, Word Riddle, VAK Sanctuary, AuroMandala, and AuroBlocks are 100% free and playable offline. |
| **`AURO-31`** | **Remote Content Guard / Dynamic Quote Withdrawal Backend (`version.json` / Cloud RPC)** | Deferred. VAK's `ContentGuardController` defaults safely to `{ disabled: false }` locally without making unconfigured network calls. |

---

## 4. Analysis of Duplicates, Overlaps, Dependencies & Out-of-Batch Recommendations

### 4.1 Duplicates, Overlaps & Conflicting Recommendations Reconciled

1. **Subpath Service Worker Scope Overlap (`AURO-01`, `AURO-09`, `AURO-17`, `AURO-20`, `AURO-23`):**
   - *Conflict Risk:* If the new Portal Root Service Worker (`AURO-01`, `/sw.js` with scope `/`) intercepts requests under `/games/*`, it will collide with the 6 individual game Service Workers (`/games/vak/sw.js`, `/games/auromatch/sw.js`, `/games/word-riddle/sw.js`, `/games/vak-living-sanctuary/sw.js`, `/games/auromandala/sw.js`, `/games/auroblocks/sw.js`).
   - *Reconciled Resolution:* The root `/sw.js` (`AURO-01`) **must explicitly ignore any request whose pathname starts with `/games/`** (`if (url.pathname.startsWith('/games/') || url.pathname.includes('/games/')) return;`), delegating 100% of `/games/*` traffic to each game's own scoped Service Worker.

2. **AuroBlocks `/assets/artwork/*.webp` Dual-Path Overlap (`AURO-20` & `AURO-21` vs. Protected Bundle `index-BLt2QrTp.js`):**
   - *Conflict Risk:* Commit `3805f624...` (`AURO-20`) updated `games/auroblocks/sw.js` to precache `./assets/artwork/hero-sacred-geometry.webp`, `./assets/artwork/mode-classic-flow.webp`, `./assets/artwork/mode-sacred-sudoku.webp`, and `./assets/artwork/mode-sacred-journey.webp` (which exist inside `games/auroblocks/assets/artwork/`). However, the compiled React bundle `games/auroblocks/assets/index-BLt2QrTp.js` (which is one of the **29 protected compiled bundles**) hardcodes root-relative `/assets/artwork/*.webp`. Relying only on `server.js` (`app.use('/assets/artwork', ...)`) works online in AI Studio, but fails when AuroBlocks is offline (because `/assets/artwork/` is outside `/games/auroblocks/` SW scope) and fails on GitHub Pages (`/AuroMind/games/auroblocks/`).
   - *Reconciled Resolution (Zero Protected-Bundle Edits):* In **Batch 2 (`AURO-21`)**, inject a tiny script in `games/auroblocks/index.html` (which is already one of the 18 editable HTML files, **not** a protected bundle) that intercepts `HTMLImageElement.prototype.src` / `setAttribute('src')` (and `MutationObserver` on `<img>`) to rewrite `/assets/artwork/` → `./assets/artwork/`. That single change makes AuroBlocks load the artwork from `./assets/artwork/*.webp` (1) online in AI Studio, (2) online on GitHub Pages at `/AuroMind/`, and (3) **100% offline** directly from `games/auroblocks/sw.js`'s existing precache!

3. **VAK Living Sanctuary `/api/corpus/*`, `/api/beta-auth/*`, and `/src/assets/images/*` (`AURO-24`, `AURO-25`, `AURO-26` vs. Protected Bundle `index-CUrzyYgb.js`):**
   - *Conflict Risk:* Modifying `games/vak-living-sanctuary/assets/index-CUrzyYgb.js` directly would violate Mandatory Constraint #4 (Protected Compiled Bundles).
   - *Reconciled Resolution (Zero Protected-Bundle Edits):* Perform all interceptions in `games/vak-living-sanctuary/index.html` (before `<script type="module" src="./assets/index-CUrzyYgb.js">`) and `games/vak-living-sanctuary/offline-shell-sw.js` / `registerSW.js`. Specifically:
     - A lightweight `window.fetch` wrapper in `games/vak-living-sanctuary/index.html` intercepts `/api/beta-auth/*` (returning `{ authenticated: true, beta: true }`) and `/api/corpus/*` (returning immediate clean client-fallback signal so `index-CUrzyYgb.js` uses its embedded corpus without firing 11 failing network requests).
     - A lightweight `HTMLImageElement` URL rewrite in `games/vak-living-sanctuary/index.html` maps the 5 `/src/assets/images/vak_*.jpg` paths to local sanctuary images (e.g., `./assets/...` or `../../assets/thumbnails/vak_living_sanctuary.jpg` / dedicated local images) without touching `index-CUrzyYgb.js` or `sw.js`'s Workbox revision hashes.

### 4.2 Non-Supabase Findings That Do Not Fit Cleanly Into Batches 1–4 & Recommended Placement

1. **`AURO-33` (AI Studio `server.js` Static Exposure & `.gitignore` Hygiene):**
   - *Why it stands apart:* `server.js`, `server.test.js`, and `.gitignore` are development/repository infrastructure files rather than portal or game runtime code.
   - *Recommendation:* Include `AURO-33` as **Part B of Batch 1** (since Batch 1 establishes the root foundation on `dev/studio-integration` right after the Step 7 compatibility-file handoff).

2. **`AURO-19` (AuroMatch 211 MB PNG Asset Footprint & `AuroMatch_Web_Prototype.html`):**
   - *Why it requires careful scoping:* Re-encoding 804 PNG/JPG files (`153 MB` in `games/auromatch/Assets/backgrounds/` and `40 MB` in `games/auromatch/Assets/themes/`) or deleting `games/auromatch/AuroMatch_Web_Prototype.html` would touch hundreds of original repository blobs.
   - *Recommendation:* Split `AURO-19` into two parts:
     - **In Batch 2 (Safe Service Worker Optimization — Zero Asset Deletion):** Ensure `games/auromatch/sw.js` precaches only the core shell, 12 ES modules, CSS, and icons (~2.6 MB total) during `install`, and caches background/theme PNGs on-demand via runtime `Cache-First` as levels are played. This prevents a 211 MB install-time download freeze while keeping 0 original image files modified.
     - **Defer Bulk Image Re-Encoding / Prototype File Removal to a Optional Post-Batch 4 Asset Compression Pass:** Only re-encode the 804 PNGs or remove `AuroMatch_Web_Prototype.html` if separately approved as a dedicated asset-compression PR, preserving fast git diffs during Batches 1–4.

---

## 5. Authoritative 4-Batch Remediation Plan

### Execution Order & Dependency Graph

```
[Prerequisite: Complete Step 7 Handoff on dev/studio-integration]
       │
       ▼
┌───────────────────────────────────────────────────────────────────────────┐
│ BATCH 1: Portal Navigation, PWA & Offline Foundation + Studio Hardening  │
│ Findings: AURO-01, AURO-02, AURO-03, AURO-08, AURO-33, AURO-34 (Portal)  │
└───────────────────────────────────────────────────────────────────────────┘
       │
       ▼
┌───────────────────────────────────────────────────────────────────────────┐
│ BATCH 2: Word Riddle, AuroMatch & AuroBlocks Offline & Asset Reliability  │
│ Findings: AURO-15, AURO-16, AURO-17, AURO-18, AURO-19 (SW), AURO-21,      │
│           AURO-34 (AuroMatch)                                             │
└───────────────────────────────────────────────────────────────────────────┘
       │
       ▼
┌───────────────────────────────────────────────────────────────────────────┐
│ BATCH 3: VAK Living Sanctuary Assets, API Interception & Offline Fallback │
│ Findings: AURO-24, AURO-25, AURO-26, AURO-34 (VAK Living Sanctuary)       │
└───────────────────────────────────────────────────────────────────────────┘
       │
       ▼
┌───────────────────────────────────────────────────────────────────────────┐
│ BATCH 4: Full Six-Game Regression & Production-Readiness Verification     │
│ Findings: AURO-35 + Regression Verification of Resolved AURO-04..07,      │
│           AURO-09..14, AURO-20, AURO-22, AURO-23, AURO-32                 │
└───────────────────────────────────────────────────────────────────────────┘
```

---

### BATCH 1 — Portal Navigation, PWA & Offline Foundation (Plus Studio Hygiene)

- **Included Findings:** `AURO-01`, `AURO-02`, `AURO-03`, `AURO-08`, `AURO-33`, `AURO-34 (Portal)`
- **Prerequisites:**
  - `main` merged to `3805f624ce3d63b80278e7fc531f38b1af1b0a5b` and `dev/studio-integration` created with the 4 Studio compatibility files and Phase 0 audit reports committed.
  - Explicit user approval to start Batch 1.
- **Exact Affected Files Whitelist (`7` files):**
  1. `/index.html` (Update live game counts from `3`/`5` to `6`, add `Word Riddle` & `AuroBlocks` to `#feedback-topic-select`, add `data-game-id="auromatch"` to AuroMatch `<article class="game-card">`)
  2. `/manifest.json` (Add PNG icon entries alongside `assets/icons/auromind-logo.svg`)
  3. `/assets/js/portal.js` (Register root `./sw.js` with `{ scope: './' }`, restore `auromind_senior_mode`, `auromind_reduced_motion`, and `auromind_ambient_volume` on `DOMContentLoaded` and persist Senior Mode & volume changes)
  4. `/sw.js` *(new file — Portal root Service Worker precaching portal HTML/CSS/JS/manifest/icons/thumbnails and explicitly bypassing `/games/*` paths)*
  5. `/server.js` (`AURO-33`: block HTTP serving of `/server.js`, `/server.test.js`, `/package.json`, `/bun.lock`, and `/phase0-audit/*`)
  6. `/server.test.js` (`AURO-33`: add unit tests verifying `/sw.js` returns `200` and `/server.js` & `/package.json` return `403`/`404`)
  7. `/.gitignore` (`AURO-33`: add `.aistudio/` and `.playwright-cli/`)
- **Protected Files Guaranteed Untouched:** All 6 `/games/*` directories, all 29 protected compiled bundles, and all VAK/AuroMatch corpora.
- **Risks & Safeguards:**
  - *Risk:* Root `/sw.js` could intercept `/games/*` requests if not scoped properly.
  - *Safeguard:* The very first check in `/sw.js`'s `fetch` listener must be `if (url.pathname.includes('/games/')) return;` so child game iframes and Service Workers remain 100% independent.
- **Acceptance Criteria:**
  1. Navigating to `http://localhost:3000/` registers `/sw.js` (`state: "activated"`) and loads the full AuroMind portal catalog when browser offline mode (`setOffline(true)`) is enabled.
  2. Sidebar, Hero Banner, Live Sanctuaries badge, and About Modal all consistently display `6` live games, and `#feedback-topic-select` lists all 6 live titles.
  3. `.game-card[data-game-id="auromatch"]` resolves to the AuroMatch `<article>` element.
  4. Toggling Senior Mode, Reduced Motion, or Ambient Volume persists across page reloads, and "Clear Cache" clears only `auromind_*` keys without affecting any game save keys.
  5. `GET /server.js`, `GET /package.json`, `GET /bun.lock`, and `GET /phase0-audit/...` return `404` or `403`.
- **Regression Tests:**
  - `node --check server.js && node --check assets/js/portal.js && node --check sw.js`
  - `node --test server.test.js`
  - Playwright verification of portal online + offline reload, settings persistence, and `.game-card[data-game-id]` count = `6`.

---

### BATCH 2 — Word Riddle, AuroMatch & AuroBlocks Offline Reliability and Asset Optimization

- **Included Findings:** `AURO-15`, `AURO-16`, `AURO-17`, `AURO-18`, `AURO-19 (SW Precache Scope)`, `AURO-21`, `AURO-34 (AuroMatch)`
- **Prerequisites:**
  - Batch 1 completed, verified, and approved.
  - Explicit user approval to start Batch 2.
- **Exact Affected Files Whitelist (`4` files):**
  1. `/games/word-riddle/index.html` (`AURO-16`: remove eager `<link rel="modulepreload">` tags for `theme-th02` through `theme-th15` so initial boot only preloads entry, vendor, and `theme-th01`)
  2. `/games/word-riddle/sw.js` (`AURO-15`: expand `SHELL_URLS` to precache all 20 JS/CSS files in `./assets/` so Word Riddle works 100% offline even on a cold HTTP disk cache, and restrict `./index.html` fallback strictly to `request.mode === 'navigate'`)
  3. `/games/auromatch/sw.js` (`AURO-17`, `AURO-18`, `AURO-19`, `AURO-34`: include all 12 ES modules under `./src/**` and `./Assets/icons/*` in `ASSETS_TO_CACHE`, match cached URLs with query-string fallback `(await caches.match(event.request)) || (await caches.match(url.origin + url.pathname)) || (await caches.match(event.request, { ignoreSearch: true }))`, scope fetch listener to `./`, and keep the 211 MB `Assets/backgrounds/` and `Assets/themes/` on runtime `Cache-First`)
  4. `/games/auroblocks/index.html` (`AURO-21`: add a non-invasive pre-module script that normalizes `/assets/artwork/*.webp` image sources to `./assets/artwork/*.webp` so AuroBlocks loads all 4 artwork WebPs from `./assets/artwork/` both on static GitHub Pages and 100% offline via `games/auroblocks/sw.js`, **without touching `games/auroblocks/assets/index-BLt2QrTp.js`**)
- **Protected Files Guaranteed Untouched:**
  - All 20 compiled bundles in `games/word-riddle/assets/*`
  - All 3 compiled bundles in `games/auroblocks/assets/*`
  - `games/auromatch/src/models/floraDatabase.js` and all AuroMatch gameplay/corpus logic
- **Risks & Safeguards:**
  - *Risk:* Precaching 211 MB of AuroMatch backgrounds during SW `install` would cause install failure/timeout.
  - *Safeguard:* Only precache AuroMatch's HTML, CSS, 12 JS modules (~2.3 MB), manifest, and icons (~320 KB) during `install`; keep `Assets/backgrounds/` and `Assets/themes/` on runtime `Cache-First`.
- **Acceptance Criteria:**
  1. **Word Riddle Offline:** In a fresh browser context after SW activation, setting `context.setOffline(true)` and reloading `/games/word-riddle/index.html` mounts the full React app (`#root` populated, playable riddles across themes) with `0` failed asset requests.
  2. **AuroMatch Offline:** In a fresh browser context after SW activation, setting `context.setOffline(true)` and reloading `/games/auromatch/index.html?standalone=true` (and `#play-auromatch`) loads `main.css?v=4.0`, `main.js?v=4.0`, and all 12 ES modules from `auro-match-v2.x` cache with `0` failed module imports.
  3. **AuroBlocks Offline & Subpath Artwork:** Loading `/games/auroblocks/index.html` resolves all 4 artwork WebPs from `./assets/artwork/*.webp` (zero requests to root `/assets/artwork/*.webp`) and renders all 4 images with `naturalWidth > 0` both online and when `context.setOffline(true)` is enabled.
- **Regression Tests:**
  - `node --check games/word-riddle/sw.js && node --check games/auromatch/sw.js`
  - `node --test server.test.js`
  - Playwright offline reload & interactive gameplay test for `word-riddle`, `auromatch`, and `auroblocks`.

---

### BATCH 3 — VAK Living Sanctuary Assets, Missing API Requests & Offline Fallback

- **Included Findings:** `AURO-24`, `AURO-25`, `AURO-26`, `AURO-34 (VAK Living Sanctuary)`
- **Prerequisites:**
  - Batch 2 completed, verified, and approved.
  - Explicit user approval to start Batch 3.
- **Exact Affected Files Whitelist (`2` files + local artwork copies if approved):**
  1. `/games/vak-living-sanctuary/index.html` (`AURO-24`, `AURO-25`, `AURO-26`: add a non-invasive pre-module script before `./assets/index-CUrzyYgb.js` that:
     - Intercepts `window.fetch` for `/api/beta-auth/{status,login,logout}` and returns a local `200 OK` JSON response (`{ authenticated: true, betaAccess: true }`).
     - Intercepts `window.fetch` for `/api/corpus/*` and returns a clean local fallback response so the bundle immediately uses its embedded corpus without firing 11 failing network requests.
     - Rewrites `/src/assets/images/vak_*.jpg` image `src` attributes to valid local sanctuary artwork paths so all 5 realm/chamber banners render with `HTTP 200` and `0` console 404 errors.)
  2. `/games/vak-living-sanctuary/offline-shell-sw.js` (or `registerSW.js` — ensure local fallback artwork and fonts are cached for offline mode without altering the Workbox precache revision hashes of `index-CUrzyYgb.js` or `index-Dw9BQKWO.css`).
  - *Note on `games/vak-living-sanctuary/sw.js`:* Because `games/vak-living-sanctuary/sw.js` contains a hardcoded Workbox revision hash for `index.html` (`revision:"e2e31a78ee67f5a254d72f117a345f1d"`), if `games/vak-living-sanctuary/index.html` is updated in Batch 3, the `index.html` revision string in `games/vak-living-sanctuary/sw.js` (which is already one of the 18 recovered editable files, not one of the 29 protected bundles) must be updated to match the new MD5/hash of `index.html`.
- **Protected Files Guaranteed Untouched:**
  - `games/vak-living-sanctuary/assets/index-CUrzyYgb.js` (`521,880 B` — protected bundle)
  - `games/vak-living-sanctuary/assets/index-Dw9BQKWO.css` (`111,759 B` — protected bundle)
  - `games/vak-living-sanctuary/workbox-63c18b4d.js` (`22,770 B` — protected bundle)
- **Risks & Safeguards:**
  - *Risk:* Returning an unexpected JSON shape from `/api/corpus/*` could prevent the bundle from triggering its built-in client fallback.
  - *Safeguard:* Inspect the exact `try / catch` response check in `index-CUrzyYgb.js` (read-only) so the intercepted `/api/corpus/*` response triggers the exact same client-side embedded dataset fallback path without firing a network request.
- **Acceptance Criteria:**
  1. Launching `VAK — The Living Sanctuary` produces **zero** network 404 requests for `/api/corpus/*`, `/api/beta-auth/*`, or `/src/assets/images/vak_*.jpg` in the browser Network and Console logs.
  2. All 3 realms (Words of Light, Matrimandir Mandala, Cosmos Prakriti), Wisdom Sanctuary, and Speech Chamber load their complete embedded levels and quotes both online and offline (`context.setOffline(true)`).
  3. All 3 protected bundles (`index-CUrzyYgb.js`, `index-Dw9BQKWO.css`, `workbox-63c18b4d.js`) retain their exact original SHA-256 hashes.
- **Regression Tests:**
  - Verify SHA-256 hashes of all 29 protected compiled bundles remain 100% unchanged.
  - Playwright test capturing all network responses and console logs on `/games/vak-living-sanctuary/index.html` online and offline (`404 count === 0`).

---

### BATCH 4 — Full Six-Game Regression & Production-Readiness Verification

- **Included Findings:** `AURO-35` + Complete Regression Verification of `AURO-04`, `AURO-05`, `AURO-06`, `AURO-07`, `AURO-09`, `AURO-10`, `AURO-11`, `AURO-12`, `AURO-13`, `AURO-14`, `AURO-20`, `AURO-22`, `AURO-23`, `AURO-32` and Batches 1–3 (`AURO-01`–`03`, `AURO-08`, `AURO-15`–`19`, `AURO-21`, `AURO-24`–`26`, `AURO-33`–`34`).
- **Prerequisites:**
  - Batches 1, 2, and 3 completed, verified, and approved.
  - Explicit user approval to execute Batch 4.
- **Affected Files:**
  - `server.test.js` (Expanded automated regression assertions)
  - `phase0-audit/AUROMIND_BATCH4_PRODUCTION_READINESS_REPORT.md` *(final verification report)*
  - Zero application or game source edits (unless a regression defect is discovered and explicitly approved for fix).
- **Acceptance Criteria & Regression Test Matrix:**
  1. **Protected Asset Integrity Gate:** Cryptographic SHA-256 check confirms **29/29 protected compiled bundles** and **all VAK/AuroMatch/Word Riddle corpora** are 100% unchanged from commit `3805f624ce3d63b80278e7fc531f38b1af1b0a5b`.
  2. **Automated Test & Syntax Gate:** `node --test server.test.js` and `node --check` across all custom JS/SW files pass with `0` errors.
  3. **Six-Game Online Interactive Gameplay Gate (Playwright Headless Chromium):**
     - Master Portal (`/`): 6 live cards, search, category filters, Senior Mode, Reduced Motion, Ambient 432 Hz audio auto-suspend on game launch, Settings/Guide/About/Feedback modals.
     - Game 1 (`VAK — Speech Control`): Splash → Door → Wisdom / Mandalas / Cosmos realms, Theme Selector counts & progression, Scripture Card quotes index, Mode B disabled guard.
     - Game 2 (`AuroMatch — Garden`): Door → Theme → Board generation, 3-tray tile selection, `localStorage` save.
     - Game 3 (`Word Riddle — Discovery`): Theme/stage selection, riddle inquiry input, lexicon progress save.
     - Game 4 (`VAK — Living Sanctuary`): Realm navigation, tactile word chamber, `0` network 404s.
     - Game 5 (`AuroMandala — Mindful Breath`): Sacred geometry canvas drawing, breath pacing, gallery/state persistence.
     - Game 6 (`AuroBlocks — Mindful Geometry`): Classic 8×8 and Sacred Sudoku 9×9 launch, all 4 artwork WebPs loaded from `./assets/artwork/*.webp`.
  4. **True Offline Airplane-Mode Gate (`context.setOffline(true)`):**
     - After initial online visit and Service Worker activation (`7` active SWs: root `/` + 6 sub-games), reload `/` and all 6 game URLs with `context.setOffline(true)` and verify `7/7` render their interactive UI with `0` uncaught errors.
  5. **Controlled Git Handoff Gate:** Run all 6 mandatory Git verification commands (`git status --short`, `git diff --name-only`, `git diff --cached --name-only`, `git diff --stat`, `git diff --cached --stat`, `node --test server.test.js`) before committing to `dev/studio-integration` and opening a Pull Request to `main`.

---

## 6. Read-Only Confirmation

- **No application source files, game files, manifests, service workers, or compatibility files** were modified during Phase 0.1.
- **No protected compiled bundles or spiritual/educational corpus datasets** were modified.
- **No Git branches, tags, commits, pushes, merges, or GitHub sync actions** were executed.
- Only `phase0-audit/AUROMIND_PHASE_0_1_NON_SUPABASE_RECONCILIATION.md` was created.
