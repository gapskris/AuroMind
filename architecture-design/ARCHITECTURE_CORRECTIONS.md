# AuroMind Platform Modernization — Architecture Corrections & Technical Risk Analysis

**Status:** Design Freeze Deliverable (1 of 7)  
**Programme Scope:** AuroMind Platform Modernization (Target Launch: **1 January 2027**)  
**Priority Launch Products:** VAK Speech Control (`games/vak/`), AuroMatch (`games/auromatch/`), AuroMandala (`games/auromandala/`)  
**Canonical Baseline:** `gapskris/AuroMind` · branch `dev/studio-integration` · commit `67d04726fb82cdb3d9f253bd36e627fe0d7aef20` (workspace at 994 tracked files prior to design-freeze docs)

---

## 1. Purpose

This document audits every architectural assumption made in **Batch A**, records **verified code evidence** from the repository, corrects technical errors before implementation begins, and establishes binding design constraints for all subsequent batches.

---

## 2. Batch A Assumptions Audited & Corrected

### Correction 1 (CRITICAL) — Service Worker Scope & Offline Shared SDK Delivery

#### What Batch A Assumed (Incorrect)
Batch A (§9) proposed serving shared SDK scripts from `/assets/sdk/auromind-sdk.js` and adding a carve-out in the **root Service Worker (`sw.js`)** before its `request.referrer.includes('/games/')` bypass, assuming root `sw.js` would intercept and serve `/assets/sdk/*` offline when requested by nested games (`/games/vak/`, `/games/auromatch/`, `/games/auromandala/`).

#### Verified Technical Reality (W3C Service Worker Spec + Repo Evidence)
1. Under the W3C Service Worker specification, each browser document (client) is controlled by **exactly one** active Service Worker, selected by longest-prefix scope match on the **document's URL**:
   - `/` and `/index.html` → controlled by root `/sw.js` (scope `/`).
   - `/games/vak/index.html` → controlled by `/games/vak/sw.js` (scope `/games/vak/`).
   - `/games/auromatch/index.html` → controlled by `/games/auromatch/sw.js` (scope `/games/auromatch/`).
   - `/games/auromandala/index.html` → controlled by `/games/auromandala/sw.js` (scope `/games/auromandala/`).
2. **Service Workers do NOT chain or bubble `fetch` events to parent-scope Service Workers.** Every subresource fetched by `/games/vak/index.html` — including `<script src="../../assets/sdk/auromind-sdk.js">` — is dispatched **exclusively** to `games/vak/sw.js`, **never** to root `sw.js`.
3. Verified current behavior in the three launch games' Service Workers:
   - `games/vak/sw.js` (line 43): `if (!url.href.startsWith(scopeBase.href)) return;` → falls straight through to the network and **FAILS OFFLINE** for any URL outside `/games/vak/`.
   - `games/auromatch/sw.js` (line 141): `if (!url.pathname.startsWith(scopePath)) return;` → falls straight through to the network and **FAILS OFFLINE** for any URL outside `/games/auromatch/`.
   - `games/auromandala/sw.js` (line 2, Workbox `precacheAndRoute`): only precaches its own relative `./` assets (`index.html`, `assets/index-DhYVrlzX.js`, `assets/index-MfgMt68V.css`, icons, manifest) and routes only Google Fonts + `NavigationRoute` → **FAILS OFFLINE** for any unprecached `/assets/sdk/*` URL.

#### Corrected Offline Delivery Architecture
To guarantee 100% offline reliability **without** violating strict per-game cache-prefix isolation:

1. **Zero-Build Consumers (Portal, VAK Speech Control, AuroMatch):**
   - Load the shared SDK via a **relative, subpath-safe URL** (`./assets/sdk/auromind-sdk.js` in Portal; `../../assets/sdk/auromind-sdk.js` in VAK & AuroMatch).
   - **Each controlling Service Worker MUST precache and serve the shared SDK URL inside its OWN prefix-isolated cache** (`auro-portal-v*`, `auro-vak-v*`, `auro-match-v*`):
     - Compute the SDK base URL dynamically from `self.registration.scope` (`new URL('../../assets/sdk/', self.registration.scope).href`) so it works identically on both `http://localhost:3000/` and GitHub Pages subpath `https://gapskris.github.io/AuroMind/`.
     - Add the SDK runtime asset(s) to each SW's `install` precache list.
     - Match `url.href.startsWith(sdkBaseUrl)` **before** the game's `scopePath` early-return guard, using **Network-First with `cleanUrl` cache update (online) and exact/`ignoreSearch` cache fallback (offline)** — identical to how `games/auromatch/sw.js` already caches external Google Fonts into its own isolated cache!
   - Root `sw.js` still **strictly bypasses `/games/*`** and only caches SDK assets for portal-controlled documents (`/`).
2. **Vite-Built Consumers (AuroMandala, and future rebuilds of Word Riddle / VAK Living Sanctuary / AuroBlocks):**
   - **Preferred (Option 1 — Build-Time Shared Module):** Consume the shared SDK core as a build-time dependency bundled into AuroMandala's Vite `assets/index-*.js` output. Workbox automatically hashes and precaches it inside AuroMandala's own scope — **zero cross-scope fetches** — while sharing the exact same origin-level storage contract (`AuroMindPlatformDB` + `auromind_platform_guest_v1`) with Portal, VAK, and AuroMatch.
   - **Alternative (Option 2 — Workbox External Precaching):** If AuroMandala must load the shared runtime script by URL, register an explicit Workbox route for `/assets/sdk/` inside AuroMandala's upstream `vite-plugin-pwa` config.

#### Lifecycle Verification Matrix for Corrected SW Delivery
| Scenario | Portal (`/`) | VAK / AuroMatch (`/games/<slug>/`) | AuroMandala (Vite Bundled) |
|---|---|---|---|
| **First-time online install** | Root SW installs & precaches `./assets/sdk/*` into `auro-portal-v*`. | Game SW installs & precaches `../../assets/sdk/*` into `auro-vak-v*` / `auro-match-v*`. | Workbox precaches hashed `assets/index-*.js` (containing SDK). |
| **Returning online user** | Network-First (or version-bumped Cache-First) refreshes SDK; stale cache purged on activate. | Game SW fetches fresh SDK online, updates `cleanUrl` in its own cache. | Workbox updates hashed bundle on SW activate. |
| **Returning offline user** | Root SW serves SDK from `auro-portal-v*`. | Game SW serves SDK from `auro-vak-v*` / `auro-match-v*` (root SW not involved). | Workbox serves precached bundle from AuroMandala cache. |
| **Cold offline launch (standalone or iframe)** | Works immediately from `auro-portal-v*` without network. | Works immediately from game SW cache even if user never visited Portal first. | Works immediately from Workbox precache even standalone. |
| **SDK asset updates** | Bump SDK version query or SW `CACHE_NAME`; `activate` cleans old `auro-portal-*` only. | Network-First updates cached SDK on first online visit; SW `CACHE_NAME` bump guarantees atomic refresh. | New Vite content hash triggers Workbox precache update automatically. |
| **Cache version changes** | Prefix-guarded (`auro-portal-*` only); zero impact on game caches. | Prefix-guarded (`auro-vak-*` / `auro-match-*` only); zero impact on portal or sibling games. | Workbox scope-qualified precache; zero impact on sibling games. |
| **Nested SW interaction** | Root SW never intercepts nested game-controlled subresources; `/games/*` navigation bypassed. | Game SW strictly controls `/games/<slug>/*` + explicit `sdkBaseUrl` read-only match; never deletes sibling caches. | Fully self-contained within `/games/auromandala/`. |

---

### Correction 2 (CRITICAL) — AuroMandala Source Availability & Integration Fidelity

#### Verified Repository Finding
Confirmed by direct directory inspection of `games/auromandala/`:
- Contains **14 files**: `index.html`, `manifest.webmanifest`, `registerSW.js`, `sw.js`, `workbox-835c8c05.js`, `assets/index-DhYVrlzX.js` (`396,251 B`, minified Vite/React bundle), `assets/index-MfgMt68V.css`, 2 `assets/aistudio/*.png` images, and 5 PWA icons.
- Contains **zero** editable `.ts`/`.tsx`/`.jsx` source files, `package.json`, or `vite.config.*`.
- Storage implementation inside `assets/index-DhYVrlzX.js` (verified): single `localStorage` key `pranamandala_game_cache_v2` (`version: 2`, `updatedAtISO`, `cachedCanvasStrokes`, `sessions`, `streakDays`, `settings`), in-memory `Map` fallback when `localStorage` is unavailable, quota-exceeded stroke trimming (`cachedCanvasStrokes.slice(-30)`), and an AES-GCM 256-bit E2EE Sankalpa vault (`pranamandala-fingerprint:`).

#### Mandatory Distinction Between Integration Levels
Batch A risked blurring host-page bootstrapping with full game integration. This design freeze establishes four strictly separated tiers:

| Level | Description | Counts as Complete Launch Integration? |
|---|---|---|
| **1. Host-page identity injection** | Adding `<script src="../../assets/sdk/auromind-sdk.js">` to `games/auromandala/index.html` so `window.AuroMindSDK` initializes the shared guest ID before the bundle loads. | **NO.** The compiled React app never reads `window.AuroMindSDK`, never emits save events, and cannot trigger auth/cloud sync UI. |
| **2. Actual game-level SDK integration** | Modifying AuroMandala's **legitimate upstream React/Vite source repository** to consume `AuroMindSDK` for guest identity, access policy, save/restore hooks, optional sign-in/cloud-sync controls, and rebuilt Workbox assets. | **YES.** Required for genuine 1 January 2027 launch integration. |
| **3. Existing local-save compatibility** | Preserving `pranamandala_game_cache_v2` (`version: 2`), `Map` fallback, quota stroke trimming (`slice(-30)`), and AES-GCM Sankalpa vault without schema breakage. | Mandatory invariant across all levels. |
| **4. Future cloud-save compatibility** | Separating syncable session/settings metadata from atomic canvas drafts (`cachedCanvasStrokes`) and strictly client-encrypted Sankalpa vault blobs (zero plaintext vault upload). | Required before enabling cloud sync for AuroMandala. |

**Launch Impact:** Obtaining access to AuroMandala's legitimate upstream Vite/React source repository is a **critical-path dependency** for the 1 January 2027 launch (tracked in `OPEN_DECISIONS.md`). Compiled assets in `games/auromandala/assets/index-DhYVrlzX.js` must **never** be decompiled or binary-patched.

---

### Correction 3 (HIGH) — File-Count Constraint & Resolution of 3-File vs. 4-File SDK Conflict

#### Batch A Contradiction Identified
Batch A listed **4 files** in §6 (`auromind-sdk.js`, `auromind-adapters.js`, `auromind-sdk.test.js`, `README.md` → `998` files) while listing **3 files** in §9/§10/§11 (`assets/sdk/auromind-sdk.js`, `assets/sdk/auromind-adapters.js`, `auromind-sdk.test.js` → `997` files).

#### Resolved Smallest Maintainable SDK Structure (3 Tracked Files Total)
When Batch B is approved, the SDK itself will use **exactly 3 files**:
1. `assets/sdk/auromind-sdk.js` — All core platform services and provider interfaces (zero external dependencies; ES module + `window.AuroMindSDK` facade).
2. `assets/sdk/auromind-adapters.js` — Game-specific storage & merge adapters for the 3 launch products (`vak`, `auromatch`, `auromandala`) plus non-breaking compatibility descriptors for the remaining 3 games.
3. `auromind-sdk.test.js` — Placed at **repository root** (NOT inside `assets/sdk/`) so `server.js` automatically returns HTTP `404` via its existing `firstSegment.endsWith('.test.js')` rule without modifying `server.js` security logic.

*(Documentation belongs outside runtime asset folders — never inside `assets/sdk/` where `server.js` would serve `.md` files publicly!)*

#### Immediate Repository File-Count & Exposure Alert (CRITICAL)
- Prior to this design freeze, the workspace had **994 tracked files** (`6` below Google AI Studio's observed **1,000-file** GitHub import ceiling).
- Creating the **7 design-freeze Markdown files** requested under `architecture-design/` brings the workspace to **`994 + 7 = 1,001` files** — **1 file over** the observed 1,000-file AI Studio import limit, AND `server.js` does not currently block `/architecture-design/*` from public HTTP access!
- **Mandatory Handling Before Next GitHub Sync or Batch B:**
  1. **Short-term (before committing/syncing `dev/studio-integration`):** Move non-runtime documentation (`architecture-design/` and/or `phase0-audit/ARCHIVE.md`) to a dedicated `docs/architecture` branch, OR consolidate frozen docs before syncing, OR free tracked-file headroom so `dev/studio-integration` stays **strictly ≤ 990 tracked files** (`10+` files of safety margin below `1,000`).
  2. **Long-term headroom:** Audit `games/auromatch/Assets/` (`851` files = `85.6%` of the entire repository, including paired `.png` + `_clean.png` / `.jpg` variants) in a dedicated, explicitly approved asset-inventory audit — never modifying protected game assets without separate sign-off.
  3. **HTTP Exposure Guard:** If any design-docs directory remains on a deployed branch, add its top-level folder name to `BLOCKED_ROOT_SEGMENTS` in `server.js` (and verify `404` in `server.test.js`).

---

### Correction 4 (HIGH) — Guest Identity Concurrency, Persistence & Portal Reset Hazard

#### Verified Hazard in `assets/js/portal.js` (Lines 596–598)
```js
Object.keys(localStorage)
  .filter(key => key.startsWith('auromind_'))
  .forEach(key => localStorage.removeItem(key));
```
Batch A noted this hazard; this design freeze enforces a **two-layer defense**:
1. **Protected Storage Namespace:** Store the mirrored local guest identity under **`auromind.platform.v1.guest`** (dot-delimited — does **not** match `key.startsWith('auromind_')`!), AND still explicitly exempt `auromind.platform.*` in `assets/js/portal.js` when Portal is updated.
2. **Primary Durable Vault (`AuroMindPlatformDB`):** Store the canonical guest identity record in a dedicated IndexedDB database **`AuroMindPlatformDB` (v1, store `platform_meta`, key `'guest_identity'`)** completely independent of every game's IndexedDB database.
3. **Multi-Tab Race Prevention:** Wrap first-time identity minting in **`navigator.locks.request('auromind-platform-guest-init', ...)`** (with deterministic fallback using `localStorage` re-read + `BroadcastChannel('auromind_platform_bus')` earliest-`createdAt` tie-breaker when Web Locks is unavailable). Full 9-scenario lifecycle is specified in `TARGET_ARCHITECTURE.md` §5.

---

### Correction 5 (HIGH) — Reject Generic Union/Max-Score Cloud Merge

#### What Batch A Assumed (Incorrect)
Batch A (§8) suggested a generic "union of completed levels/discoveries/unlocked themes, max high scores, newest settings" merge for cloud sync.

#### Why Generic Union/Max-Score Corrupts Real Game State (Verified from Source Schemas)
1. **VAK Speech Control (`games/vak/index.html`):**
   - `vak_sparks_balance` is a **spendable economy currency** — `max()` resurrects spent sparks or silently drops earned deltas.
   - `vak_player_profiles_map_v1` holds **multiple named profiles** — blind merge can cross-contaminate profiles with identical names.
   - `vak_active_mode`, `vak_active_theme`, `vak_level_index`, `vak_epiphany_index`, `vak_pending_epiphany` are **coupled session cursors**, not independent sets.
2. **AuroMatch (`games/auromatch/src/controllers/storageAdapter.js` & `gameManager.js`):**
   - `auromatch_sparks_balance` is spendable currency; `lotusPetalCount` / `consciousnessPoints` must stay consistent with `completedLevelIds`.
   - `auro_match_consecrations` are personal journal reflections requiring stable entry deduplication, not blind array concatenation.
   - `settings.experienceMode` (`gk_quest` vs `ashram_sanctuary`), `secularToggle`, and `seniorViewActive` must remain coherent per-device preferences.
   - `dailyDrawDate` must not double-grant daily rewards across merged devices.
3. **AuroMandala (`games/auromandala/assets/index-DhYVrlzX.js`):**
   - `cachedCanvasStrokes` is an **atomic visual artwork** — unioning strokes from two devices destroys the mandala drawing!
   - `streakDays` is a derived metric that must be recomputed from deduplicated `sessions` timestamps rather than taking `max(streakDays)`.
   - The **AES-GCM 256-bit E2EE Sankalpa vault** (`pranamandala-fingerprint:`) is encrypted with user-passphrase-derived keys and must **never** be inspected, decrypted, or blindly merged server-side.

**Corrected Architecture:** The Shared SDK defines a **provider-independent merge envelope & conflict orchestration contract**, while each game supplies its own explicit `GameMergeStrategy<T>` (detailed in `SHARED_SDK_CONTRACTS.md` §6 and `PRODUCT_INTEGRATION_MATRIX.md` §4).

---

### Correction 6 (MEDIUM) — Scope Alignment to Launch Priorities & Four Parallel Workstreams

Batch A treated all six games sequentially (Portal → AuroMatch → VAK → Tier 2 bootstraps → Upstream rebuilds) without separating the **1 January 2027** launch products or defining the Supabase workstream.

This design freeze establishes:
- **Four equal, coordinated workstreams:** (1) Shared Architecture & Platform Services, (2) Supabase Architecture & Implementation, (3) Non-Supabase Remediation, (4) Product Integration & Launch Readiness.
- **Three priority launch products:** VAK Speech Control (`games/vak/`), AuroMatch (`games/auromatch/`), AuroMandala (`games/auromandala/`).
- **Explicit non-launch scope:** Word Riddle (`games/word-riddle/`), VAK Living Sanctuary (`games/vak-living-sanctuary/`, including **AURO-26**), and AuroBlocks (`games/auroblocks/`) remain architecture-compatible and untouched in the January launch critical path.
- **Strict Launch Gate Classification:** Mandatory local-first / guest / offline capabilities are decoupled from target cloud capabilities (Auth, Cloud Saves, Sync, Entitlements/Payments, Analytics/Remote Config) so any unready cloud feature stays safely feature-flagged OFF without degrading gameplay.

---

## 3. Verification Summary of Batch A Findings Retained

The following Batch A findings were re-verified and carried forward unchanged:
- **Zero existing shared guest UUID** across Portal and all six games.
- **All six existing storage databases/namespaces** remain independent (`AuroVakDB` v1, `AuroMatchDB` v1, `word-discovery-db` v1, `VakSanctuaryDB` v2, `pranamandala_game_cache_v2`, `auroblocks_*`).
- **Same-origin architecture** (`/` + `/games/<slug>/`) enables native `IndexedDB` and `localStorage` sharing across Portal and all games.
- **Existing security hardening** from commit `67d04726` (`index.html` CSP, `portal.js` `postMessage` origin/source/whitelist validation, `games/auromatch/src/main.js` origin-scoped `postMessage`, `games/auromatch/sw.js` `auro-match-*` cache isolation, `server.js` internal path blocking) is intact and verified.
- **AURO-26** remains documented in `phase0-audit/ARCHIVE.md` and out of scope for the January launch.
