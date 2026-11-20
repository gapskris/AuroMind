# AuroMind Platform Modernization — Product Integration Matrix

**Status:** Design Freeze Deliverable (5 of 7)  
**Target Launch (1 January 2027) Priority Products:**
1. **VAK Speech Control** (`games/vak/`) — *Distinct from VAK Living Sanctuary (`games/vak-living-sanctuary/`)*
2. **AuroMatch** (`games/auromatch/`)
3. **AuroMandala / PranaMandala** (`games/auromandala/`)

**Post-January Compatible Products (No Deep Integration in Launch Scope):**
4. Word Riddle / Word Discovery (`games/word-riddle/`)
5. VAK Living Sanctuary (`games/vak-living-sanctuary/` — AURO-26 remains out of January launch scope)
6. AuroBlocks (`games/auroblocks/`)

---

## 1. Six-Game Priority & Integration Summary Matrix

| Product | Launch Tier | Source Editable Here? | Native Storage Owned by Game | SDK Consumption Pattern | Offline SDK Delivery Method | January 2027 Scope |
|---|---|---|---|---|---|---|
| **AuroMind Portal** (`index.html`, `assets/js/portal.js`) | **Core Shell (Mandatory)** | **Yes** (vanilla JS) | `localStorage` (`auromind_senior_mode`, `auromind_ambient_volume`, `auromind_reduced_motion`, `auromind_guide_seen`) | `<script type="module">` + `window.AuroMindSDK` | Root `sw.js` precaches `./assets/sdk/*` in `auro-portal-v*` | Full SDK init, shared guest ID, `Clear Cache` fix, optional Auth/Account modal (if Tier 2 ready) |
| **1. VAK Speech Control** (`games/vak/`) | **Priority Launch #1** | **Yes** (single-file HTML + inline vanilla JS) | `AuroVakDB` (IDB v1, store `gameState`) + 29 `vak_*` / `auro_vak_*` `localStorage` keys + `auro_vak_breathing_done` (`sessionStorage`) | `<script src="../../assets/sdk/auromind-sdk.js">` + `auromind-adapters.js` via `window.AuroMindSDK` | `games/vak/sw.js` precaches `../../assets/sdk/*` into `auro-vak-v*` and intercepts `sdkBaseUrl` before scope guard | **Full native SDK integration** (identity, access, save adapter, merge strategy, offline SW, entitlements delegation) |
| **2. AuroMatch** (`games/auromatch/`) | **Priority Launch #2** | **Yes** (native ES modules in `src/`) | `AuroMatchDB` (IDB v1, store `gameState`) + 15 `auromatch_*` / `auro_match_*` `localStorage` keys | Native ES module `import` from `../../assets/sdk/auromind-sdk.js` & `auromind-adapters.js` | `games/auromatch/sw.js` precaches `../../assets/sdk/*` into `auro-match-v*` and intercepts `sdkBaseUrl` before scope guard | **Full native SDK integration** (identity, access, `storageAdapter.js` & `entitlementManager.js` wiring, merge strategy, offline SW) |
| **3. AuroMandala** (`games/auromandala/`) | **Priority Launch #3** | **No** (compiled Vite/React bundle only in this repo) | `localStorage['pranamandala_game_cache_v2']` (`version: 2`) + in-memory `Map` fallback + AES-GCM 256-bit E2EE Sankalpa vault | **Requires upstream Vite/React source rebuild** consuming `AuroMindSDK` client module | Bundled into AuroMandala's Vite/Workbox precache (zero cross-scope fetch) while sharing origin `AuroMindPlatformDB` + `auromind.platform.v1.guest` | **Full native SDK integration via legitimate upstream rebuild** (host-page injection alone is NOT sufficient) |
| **4. Word Riddle / Word Discovery** (`games/word-riddle/`) | Post-January Compatible | No (compiled Vite/Dexie bundle) | `word-discovery-db` (Dexie v1: 7 tables incl. `questionProgress`, `profiles`, `sessions`, `settings`, `scoreAwards`, `achievements`, `metadata`) | Observer-only adapter descriptor in `auromind-adapters.js`; native integration deferred to upstream rebuild | Unchanged (`games/word-riddle/sw.js`) | **Untouched** for January launch; schema compatibility verified |
| **5. VAK Living Sanctuary** (`games/vak-living-sanctuary/`) | Post-January Compatible | No (protected compiled Vite bundle) | `VakSanctuaryDB` (IDB v2: `progress`, `discoveries`, `settings`, `corpus_slices`) + `vak_onboarding_dismissed` | Observer-only descriptor; **AURO-26 explicitly deferred** out of January launch | Unchanged (`games/vak-living-sanctuary/sw.js`) | **Completely untouched**; AURO-26 documentation preserved |
| **6. AuroBlocks** (`games/auroblocks/`) | Post-January Compatible | No (compiled Vite/React 19 bundle) | 14 `auroblocks_*` `localStorage` keys (`auroblocks_progression_v1`, `auroblocks_active_session`, `auroblocks_stages`, `auroblocks_stage_scores`, etc.) | Observer-only descriptor; native integration deferred to upstream rebuild | Unchanged (`games/auroblocks/sw.js`) | **Untouched** for January launch; schema compatibility verified |

---

## 2. Detailed Integration Plans — Priority Launch Products

### 2.1 AuroMind Portal (`index.html`, `assets/js/portal.js`, `sw.js`)
- **Files Modified (Future Batch):**
  - `index.html`: Load `./assets/sdk/auromind-sdk.js` before `assets/js/portal.js?v=3.6`. If Supabase Auth is later enabled, add exact `https://<project-ref>.supabase.co` to CSP `connect-src`.
  - `assets/js/portal.js`:
    - Call `window.AuroMindSDK.init({ gameId: 'portal', appVersion: '1.0.0' })` on startup to ensure `guestId` is minted/healed early.
    - **Critical Fix (`L596–598`):** Restrict `Clear Cache` to explicitly remove only Portal UI preference keys (`auromind_reduced_motion`, `auromind_senior_mode`, `auromind_ambient_volume`, `auromind_guide_seen`) and skip any key where `AuroMindSDK.storage.isProtectedKey(key)` is true (`auromind.platform.*`).
    - When Tier-2 Auth is ready, host the optional Portal Account & Cloud Sync modal (sign-in/sign-out/status) so users authenticate once at the Portal level and all same-origin games inherit the session.
  - `sw.js`: Add `./assets/sdk/auromind-sdk.js` and `./assets/sdk/auromind-adapters.js` to `PORTAL_SHELL_ASSETS` (`54 → 56` entries) and bump `PORTAL_CACHE_NAME` while keeping strict `/games/*` isolation intact.

### 2.2 Launch Product 1 — VAK Speech Control (`games/vak/`)
- **Protected Invariants:** All 4 embedded corpora (`__EMBEDDED_TEACHINGS_DB__`, `__EMBEDDED_FOUR_PICS_REGISTRY__`, `__EMBEDDED_MATRIMANDIR_LEVELS__`, `__EMBEDDED_COSMOS_LEVELS__` — 1,368-level corpus) and `AuroVakDB` v1 (`gameState` store) must remain 100% untouched in structure and content.
- **Exact Integration Touchpoints:**
  - `games/vak/index.html`:
    - Load `../../assets/sdk/auromind-sdk.js` and `../../assets/sdk/auromind-adapters.js`.
    - Initialize `AuroMindSDK.init({ gameId: 'vak', ... })` on boot; register `VakStorageAdapter` + `VakMergeStrategy`.
    - Delegate `EntitlementManager.isCommercialGateActive()` / `hasValidLicense()` / `canAccessLevel()` to `AuroMindSDK.entitlements` (eliminating duplicate client-side entitlement scaffolding while keeping free guest-first default).
    - Ensure VAK's `vak_purge_lock` reset flow strictly clears only `vak_*` / `auro_vak_*` keys and `AuroVakDB`, **never** `AuroMindPlatformDB` or `auromind.platform.*`.
    - Trigger `AuroMindSDK.sync.queueLocalChange('vak')` (no-op when cloud sync disabled) after local progress commits.
  - `games/vak/sw.js`:
    - Resolve `sdkBaseUrl = new URL('../../assets/sdk/', self.registration.scope).href`.
    - Precache `auromind-sdk.js` and `auromind-adapters.js` in `auro-vak-v2.19` and serve `url.href.startsWith(sdkBaseUrl)` via Network-First + cache fallback **before** the line-43 `scopeBase` early return.

### 2.3 Launch Product 2 — AuroMatch (`games/auromatch/`)
- **Protected Invariants:** `games/auromatch/src/models/floraDatabase.js` (`2.0 MB`), all `games/auromatch/Assets/**`, `AuroMatchDB` v1 (`gameState` store), and PBKDF2/AES-GCM local backup compatibility must remain 100% intact.
- **Exact Integration Touchpoints:**
  - `games/auromatch/index.html`: Keep `<script type="module" src="./src/main.js?v=4.0">`; load SDK cleanly via ES module import inside `src/main.js` (or pre-module script for `entitlementManager.js`). Decide disposition of legacy `AuroMatch_Web_Prototype.html` (see `OPEN_DECISIONS.md`).
  - `games/auromatch/src/main.js`: Call `AuroMindSDK.init({ gameId: 'auromatch', ... })` and register `AuroMatchStorageAdapter` + `AuroMatchMergeStrategy`.
  - `games/auromatch/src/controllers/storageAdapter.js`: Hook `saveProfileState()` and `setItemAsync()` to notify `AuroMindSDK.sync.queueLocalChange('auromatch')` after durable local write. Verify `executeAbsolutePurge()` (already safely scoped to `auromatch_*` / `auro_match_*` and `AuroMatchDB`) leaves `AuroMindPlatformDB` and `auromind.platform.*` untouched.
  - `games/auromatch/src/controllers/entitlementManager.js`: Delegate commercial gate and verified entitlement checks to `AuroMindSDK.entitlements` while preserving the existing informational planned-pass modal.
  - `games/auromatch/sw.js`:
    - Resolve `sdkBaseUrl = new URL('../../assets/sdk/', self.registration.scope).href`.
    - Precache `auromind-sdk.js` and `auromind-adapters.js` in `auro-match-v2.2` and serve `url.href.startsWith(sdkBaseUrl)` via Network-First + `cleanUrl` cache fallback **before** the line-141 `scopePath` early return.

### 2.4 Launch Product 3 — AuroMandala (`games/auromandala/`)
- **Verified Reality:** `games/auromandala/assets/index-DhYVrlzX.js` is compiled Vite/React output; original source is outside `gapskris/AuroMind`.
- **Integration Boundary (Explicitly Enforced):**
  - **Host-page injection (`games/auromandala/index.html`) is NOT complete game integration** — it only ensures `guestId` exists if a user visits AuroMandala standalone before Portal, without wiring AuroMandala's state, saves, or cloud sync.
  - **Genuine Launch Integration (Upstream Source Rebuild):**
    1. Import the `AuroMindSDK` core/contract module in AuroMandala's upstream React/Vite source repository.
    2. Initialize `AuroMindSDK.init({ gameId: 'auromandala', ... })` at React root mount so the app reads `AuroMindPlatformDB` + `auromind.platform.v1.guest` natively.
    3. Wrap `xt()` / `St()` / `Ct()` (`pranamandala_game_cache_v2`) in `AuroMandalaStorageAdapter` preserving `version: 2`, in-memory `Map` fallback, and `cachedCanvasStrokes.slice(-30)` quota guard.
    4. Keep the AES-GCM 256-bit E2EE Sankalpa vault strictly client-side (never transmit plaintext or passphrase).
    5. Rebuild via Vite + `vite-plugin-pwa` so Workbox precaches the bundled SDK automatically inside `/games/auromandala/`, and export verified dist files into `games/auromandala/`.

---

## 3. Post-January Products (Compatibility Guardrails Only)

- **Word Riddle (`games/word-riddle/`):** Dexie `word-discovery-db` v1 remains untouched. Future upstream rebuild will integrate `AuroMindSDK` via a Dexie adapter and tighten `AUROMIND_CLOSE_THEATER` `postMessage` from `'*'` to `window.location.origin`.
- **VAK Living Sanctuary (`games/vak-living-sanctuary/`):** Completely untouched in January launch scope. `VakSanctuaryDB` v2 and `AURO-26` remediation plan remain preserved for its scheduled upstream source rebuild.
- **AuroBlocks (`games/auroblocks/`):** 14 `auroblocks_*` `localStorage` keys remain untouched. Future upstream rebuild will wrap them in `AuroBlocksStorageAdapter` with an IndexedDB backup mirror.

---

## 4. Game-Specific Cloud Merge & Conflict Contracts (NO Generic Union/Max-Score)

Each launch product implements its own deterministic `GameMergeStrategy<T>`:

### 4.1 VAK Speech Control (`VakMergeStrategy`)
| State Slice | Keys / Source | Merge Rule |
|---|---|---|
| **Empty remote / empty local** | Envelope `isEmpty` | Non-destructive: non-empty side wins automatically (`use_local` / `use_remote`). |
| **Realm progression (4 realms)** | `vak_cosmos_progress`, `vak_mandala_progress`, `auro_vak_4pics_progress`, `auro_vak_unlocked_words` | Per-realm deterministic progression merge ONLY if both snapshots belong to the same named profile slot; completed level IDs merged per realm without downgrading unlocked stages. |
| **Spendable currency** | `vak_sparks_balance` | **Never blind `max()`!** If both devices mutated `vak_sparks_balance` since `baseRevision`, flag `conflict_requires_user_choice` (showing both balances & realm totals) unless delta ledger is introduced later. |
| **Multi-profile map** | `vak_player_profiles_map_v1`, `vak_player_profile_v1` | Match profiles by stable profile ID (or flag conflict on name collision with divergent progress — never silently overwrite a profile). |
| **Reflections & Journal** | `auro_vak_reflections` | Deduplicate by stable `(timestamp, contentHash)` preserving both devices' entries without loss. |
| **Active cursors & UI prefs** | `vak_active_mode`, `vak_active_theme`, `vak_level_index`, `vak_senior_view`, `vak_epiphany_index` | Keep active device's session cursors (`local` wins on UI prefs) unless user selects full remote device restore. |

### 4.2 AuroMatch (`AuroMatchMergeStrategy`)
| State Slice | Keys / Source | Merge Rule |
|---|---|---|
| **Level completions & themes** | `auro_match_unlocked_tiles`, `auro_match_user.progression.unlockedThemes`, `auromatch_mode_levels` (`vita`, `tile_club`, `botanical`, `realms`) | Monotonic per-mode progression merge only when no conflicting currency/profile divergence exists; recompute `completedLevelsCount` strictly from deduplicated `completedLevelIds.length`. |
| **Spendable currency & points** | `auromatch_sparks_balance`, `lotusPetalCount`, `consciousnessPoints` | **Never blind `max()`!** Divergent concurrent mutations trigger `conflict_requires_user_choice` showing completed levels + Sparks balance for Local vs. Cloud. |
| **Consecrations / Reflections** | `auro_match_consecrations` | Append-only deduplication by stable reflection ID/timestamp (never drops reflections from either device). |
| **Daily Draw & Settings** | `dailyDrawDate`, `settings` (`experienceMode`, `secularToggle`, `seniorViewActive`, `volumeRaga`, `volumeGong`) | Latest `dailyDrawDate` prevents double-claim; keep local device audio/accessibility settings unless user chooses full remote restore. |
| **Named Profiles** | `auromatch_player_profiles` | Merge non-colliding profiles; surface conflict modal on colliding profile divergence. |

### 4.3 AuroMandala (`AuroMandalaMergeStrategy`)
| State Slice | Keys / Source | Merge Rule |
|---|---|---|
| **In-progress Canvas (`cachedCanvasStrokes`)** | `pranamandala_game_cache_v2.cachedCanvasStrokes` | **ATOMIC — NEVER UNION STROKES!** Combining strokes from two devices ruins the mandala artwork. If both devices have different non-empty canvases, trigger `conflict_requires_user_choice` (Keep Local Canvas / Use Cloud Canvas, optionally archiving the non-selected canvas as a draft/session snapshot). |
| **Completed Sessions & Streaks** | `sessions`, `streakDays` | Deduplicate `sessions` by `(sessionId || startedAtISO)`; **recompute `streakDays` deterministically** from the merged calendar dates of `sessions` (never blind `max(streakDays)`). |
| **Settings & Reminders** | `locale`, `reminder`, `lowPowerMode` | Keep local device reminder/low-power preferences by default (or newest `updatedAtISO` with explicit user option). |
| **E2EE Sankalpa Vault** | `pranamandala-fingerprint:` + AES-GCM ciphertext | **Excluded from cloud sync by default.** If explicitly opted-in later, sync strictly as opaque versioned ciphertext (`salt`, `iv`, `ciphertext`) and require user choice on conflict — never decrypt or merge server-side. |
