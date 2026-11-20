# AuroMind — Batch B2 Implementation Report
## Portal Integration & Offline SDK Support

**Repository:** `gapskris/AuroMind`  
**Branch:** `dev/studio-integration`  
**Batch:** B2 — Portal Integration & Offline SDK Support (building on accepted B1/B1.1 Shared SDK)  
**Target Launch:** 1 January 2027 (local-first, guest identity, offline gameplay)  
**Execution Date:** 2026-11-19  
**Status:** COMPLETE

---

## 1. Executive Summary

Batch B2 integrates the accepted B1.1 AuroMind Shared Platform SDK (`assets/sdk/auromind-sdk.js` and `assets/sdk/auromind-adapters.js`) into the AuroMind Portal (`index.html`, `assets/js/portal.js`) and extends the root portal service worker (`sw.js`) and GitHub Pages allowlist workflow (`.github/workflows/pages.yml`) so that:

1. The portal loads both shared SDK ES modules in dependency order under the existing strict `script-src 'self'` CSP without introducing inline scripts.
2. Portal startup initializes `AuroMind.init({ gameId: 'portal', appVersion: '2.5.0' })` **exactly once**, guarded against duplicate invocation, without registering the portal as a game adapter or blocking portal rendering/navigation if initialization fails.
3. Portal **Clear Cache** clears portal-owned preferences (`auromind_*`) while explicitly protecting shared platform identity storage (`auromind.platform.v1.guest`, `auromind.platform`, `auromind.platform.*`, `AuroMindPlatformDB`) and all game-owned storage.
4. The root portal service worker (`auro-portal-v1.1.0`) precaches `./assets/sdk/auromind-sdk.js` and `./assets/sdk/auromind-adapters.js` and serves them cache-first on cold offline portal visits, while preserving strict isolation from `/games/*` routes, game iframes, nested game service workers, and non-runtime repository files.
5. The GitHub Pages manual-only allowlist workflow explicitly verifies both SDK files are present in `_site/` while continuing to exclude private documentation, audit reports, tests, and server code.

Zero game folders (`games/*`), zero B1.1 SDK source files, zero server runtime files (`server.js`), and zero protected corpora were modified.

---

## 2. Architectural Implementation Details

### 2.1 Portal SDK Loading (`index.html`)
- Added external ES module `<script>` tags immediately before `assets/js/portal.js?v=3.7`:
  - `<script type="module" src="assets/sdk/auromind-adapters.js"></script>`
  - `<script type="module" src="assets/sdk/auromind-sdk.js"></script>`
- Bumped portal script cache-buster query string from `assets/js/portal.js?v=3.6` to `assets/js/portal.js?v=3.7` (synchronized with `sw.js` `PORTAL_SHELL_ASSETS`).
- **CSP compliance:** Preserves existing `Content-Security-Policy` (`script-src 'self'`); zero inline `<script>` tags added.
- **Execution order guarantee:** Per the HTML Standard, `<script type="module">` tags execute in document order after parsing completes and **before** `DOMContentLoaded` fires, ensuring `window.AuroMind` is initialized and attached when `portal.js` runs `bootstrapPortal()`.

### 2.2 Single-Init Portal SDK Bootstrap & Read-Only Bridge (`assets/js/portal.js`)
- Wrapped portal startup in an idempotent `bootstrapPortal()` guarded by `portalBootstrapped` so duplicate `DOMContentLoaded` triggers cannot double-initialize listeners or SDK bootstrap.
- Implemented `initPortalSDK()` with a single-flight promise cache (`portalSdkInitPromise`) and invocation counter (`portalSdkInitCount`):
  - Resolves `window.AuroMind` (with safe dynamic `import('./assets/sdk/auromind-sdk.js')` fallback if invoked outside standard `<script type="module">` timing).
  - Calls `sdk.init({ gameId: 'portal', appVersion: '2.5.0' })` **at most once** per page lifecycle.
  - Wraps initialization in `try/catch` so unexpected initialization failures (e.g., future-version identity schema `UNSUPPORTED_IDENTITY_VERSION` or unavailable SDK) log a concise warning and resolve to `null` without blocking portal rendering, search, modals, audio, or game launching.
  - Never mints a second guest identity and never calls `AuroMind.adapters.register(...)`.
- Exposed a frozen, non-writable, non-configurable read-only helper on `window.AuroMindPortal`:
  - `ready()` — returns the single-flight SDK initialization promise.
  - `isInitialized()` — delegates to `window.AuroMind.isInitialized()`.
  - `getIdentity()` — returns frozen identity snapshot via `window.AuroMind.identity.get()`.
  - `getGuestId()` — returns guest UUIDv4 identifier via `window.AuroMind.identity.getGuestId()`.
  - `getInitCount()` — returns portal SDK init invocation count (verifiably `1`).
  - `getLastError()` — returns last initialization error if any (otherwise `null`).
  - `isProtectedStorageKey(key)` — exposes storage-protection check helper.
  - Exposes **no** mutable internal SDK or adapter registry handles.

### 2.3 Clear Cache Platform Identity Protection (`assets/js/portal.js`)
- Extracted explicit storage-layer separation helpers:
  - `isProtectedPlatformStorageKey(key)`: protects `auromind.platform.v1.guest`, `auromind.platform`, any key matching `auromind.platform.*`, and any key flagged by `window.AuroMind.storage.isProtectedKey(key)`.
  - `clearPortalPreferencesOnly(storage)`: removes only portal-owned preferences (`auromind_reduced_motion`, `auromind_senior_mode`, `auromind_ambient_volume`, `auromind_guide_seen`, and any other `auromind_*` preference keys) while explicitly skipping every protected platform key.
- Never invokes `localStorage.clear()`, never deletes `AuroMindPlatformDB`, and never touches any game-owned `localStorage` keys or game-specific IndexedDB databases.
- Preserves existing Clear Cache UX (confirmation dialog with clear reassurance that guest identity and game progress are preserved, UI state reset to defaults, `'Cache Cleared ✓'` feedback).

### 2.4 Root Service Worker Offline SDK Support (`sw.js`)
- Bumped `PORTAL_CACHE_NAME` from `'auro-portal-v1.0.0'` to `'auro-portal-v1.1.0'` (retaining `FONT_CACHE_NAME = 'auro-portal-fonts-v1.0.0'` and `CACHE_PREFIX = 'auro-portal-'` so the existing `activate` handler automatically evicts legacy `auro-portal-v1.0.0`).
- Added `PORTAL_SDK_ASSETS` (`'./assets/sdk/auromind-sdk.js'`, `'./assets/sdk/auromind-adapters.js'`) to `PORTAL_SHELL_ASSETS` and updated `'./assets/js/portal.js?v=3.6'` to `'./assets/js/portal.js?v=3.7'`.
- Preserved strict `/games/*` and game-referrer isolation at Step 3 (`relPath.startsWith('games/') || url.pathname.includes('/games/') || (request.referrer && request.referrer.includes('/games/'))`), returning immediately without calling `event.respondWith()`.
- Expanded non-portal bypass (Step 3a) to also explicitly skip `architecture-design/`, `server.js`, `*.test.js`, and `*.md` alongside `health` and `phase0-audit/`.
- Added narrowly scoped Shared SDK Cache-First route (Step 3b, matching `PORTAL_SDK_REL_PATHS`) strictly **after** `/games/*` isolation and **before** generic Step 4 portal asset handling, with exact match, `{ ignoreSearch: true }` fallback, network-write-through for HTTP `200` `basic` responses, and HTTP `504 Offline` fallback only when both cache and network fail.

### 2.5 GitHub Pages Workflow Verification (`.github/workflows/pages.yml`)
- Preserved manual `workflow_dispatch:` trigger only (no automatic `push:` deployment) and least-privilege permissions (`contents: read` at workflow level; `pages: write` / `id-token: write` only in `deploy` job).
- Added `"_site/assets/sdk/auromind-sdk.js"` and `"_site/assets/sdk/auromind-adapters.js"` to the required-files verification loop in the `build` job while preserving all exclusion checks (`architecture-design`, `phase0-audit`, `server.js`, `*.test.js`, `*.md`, etc.).

---

## 3. Scope Discipline & Non-Goals Verified

- **No Batch B3 work started:** Zero games were wired to the Shared SDK.
- **No game modifications:** All 6 `games/*` directories, nested service workers, manifests, corpora, and game storage schemas are byte-identical to pre-B2 baseline.
- **No Tier-2 features added:** Zero accounts/login/logout/linking, zero Supabase/cloud sync, zero payments/entitlements, zero analytics/telemetry, and zero new npm dependencies.
- **No Git or deployment actions performed.**
