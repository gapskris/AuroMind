# B18-A3 — Critical Architecture Clarification & Safety Review

**Author:** AuroMind Platform Architecture Team  
**Date:** November 21, 2026  
**Canonical Workspace:** `C:\AuroMindPortal`  
**Active Git Branch:** `dev/studio-integration`  
**Baseline HEAD Commit:** `b6ccc860bb7d38a70ef678049a9588b8b73c40aa`  
**Target Release:** January 1, 2027  
**Status:** READ-ONLY CRITICAL ARCHITECTURE REVIEW (Zero Code Changes)  

---

## 1. Executive Summary

This review provides a comprehensive, evidence-based evaluation of the AuroMasti shared-services architecture, validates core assumptions, and reconciles all architecture proposals against established product principles prior to product-owner sign-off and subsequent database schema design.

### Core Architecture Confirmation
1. **The Established Product Principle is Re-affirmed:**
   $$\textbf{One Browser Profile} \equiv \textbf{One Player Identity}$$
   AuroMasti intentionally enforces **one persistent player identity per browser profile**. All tabs in that profile share the same identity; all six launch games use the same platform identity; each game maintains its own independent progression and save namespace. There will be **no in-app multiple player profiles, no player selector, and no session-boundary / profile-switching dialogs**. A separate browser profile or browser installation represents a separate player environment. All suggestions from prior reviews proposing in-app profile selectors are formally rescinded.
2. **Local-First & Offline Sovereignty:**
   Core gameplay across all six games executes 100% locally with zero network calls. Cloud services (Supabase) are strictly optional enhancements for cross-device backup and account linking, never prerequisites for basic functionality.
3. **Sacred Data Sovereignty Intact:**
   The VAK 1,368-level speech corpus (SHA-256 `9fdb38260300...`), the Flora Botanical Database (2,002,176 B, 46,321 lines, SHA-256 `689d035c...`), and the local-only E2EE Sankalpa Contemplation Vault (`cloudSyncEligible: false`) remain 100% verified, isolated, and immutable.
4. **Key Vulnerabilities Identified for B18-B Resolution:**
   - *Ad-Hoc Checksum Defect:* AuroBlocks and AuroMandala use naive string concatenation for save envelope checksums, failing to detect internal payload mutations (such as user-created artwork or stage scores).
   - *AuroMandala Creative Artwork Risk:* User-created mandalas and vector geometry cannot be safely resolved using simple maximum-value or blanket overwrite merges without risking irreversible destruction of player creative work.
   - *Adapter Harmonization:* VAK, Word Riddle, and VAK Living Sanctuary require dedicated standalone ES module adapter bridge files.

---

## 2. Scope & Files Inspected

The following source files, test suites, and documentation were inspected under strict read-only execution:

### Shared Platform SDK & Architecture
- `assets/sdk/auromind-sdk.js` (Core SDK runtime, identity, dual-storage, sync outbox, telemetry, auth)
- `assets/sdk/auromind-adapters.js` (Game adapter registry, envelope validation, merge invariants)
- `assets/sdk/config/backend-config.js` (Provider selection, environment detection, service-role shield)
- `assets/sdk/migration/backend-migration.js` (Cross-provider canonical export, SHA-256 seals, privacy filter)
- `assets/sdk/providers/supabase/` (Supabase client, auth, sync, entitlements, telemetry, account adapters)
- `assets/js/portal.js` (Portal bootstrap, game theater, audio management, preference preservation)
- `server.js` (Express static server, Content Security Policy headers)
- `sw.js` (Root Service Worker, `/games/*` bypass routing, shared SDK precache)

### Launch Game Bridges & Storage Engines
- `games/auroblocks/assets/auroblocks-sdk-bridge.js` & `games/auroblocks/assets/auroblocks-init.js`
- `games/auromandala/assets/auromandala-sdk-bridge.js`
- `games/auromatch/src/controllers/storageAdapter.js` & `games/auromatch/src/controllers/entitlementManager.js`
- `games/auromatch/src/main.js` & `games/auromatch/src/models/floraDatabase.js`
- `games/vak/index.html` (Embedded VAK app & 1,368-level speech training corpus)
- `games/word-riddle/index.html`
- `games/vak-living-sanctuary/index.html`

### Test Evidence Baseline (251 Passing Tests)
- `auromind-sdk.test.js` (31 identity, storage, and envelope tests)
- `b11-game-integration.test.js` (Platform integration, guest identity consistency, save isolation)
- `b5-supabase.test.js` & `b9-provider-conformance.test.js` (Provider conformance & RPC locking)
- `b6-security-verification.test.js` & `b8-security-remediation.test.js` (Security, rate limits, sacred corpora)
- `b17-3-e2e.test.js` & `b17-4-remediation.test.js` (Real-browser Playwright test suites)

---

## 3. Current Architecture Findings

### A. Identity Lifecycle and Concurrent Tabs

```
+-----------------------------------------------------------------------------------------+
|                    BROWSER PROFILE IDENTITY BOUNDARY (ONE PROFILE = ONE IDENTITY)       |
+-----------------------------------------------------------------------------------------+
|                                                                                         |
|  [Tab 1: Portal]          [Tab 2: AuroMatch]         [Tab 3: AuroMandala]               |
|         |                         |                          |                          |
|         +-------------------------+--------------------------+                          |
|                                   |                                                     |
|                                   v                                                     |
|                   +-------------------------------+                                     |
|                   | Web Locks: 'auromind-init'    |                                     |
|                   +-------------------------------+                                     |
|                                   |                                                     |
|                                   v                                                     |
|                   +-------------------------------+                                     |
|                   |  AuroMindPlatformDB (v1)      | <---> Synchronous Mirror:           |
|                   |  store: 'platform_meta'       |       'auromind.platform.v1.guest'  |
|                   |  key: 'guest_identity'        |                                     |
|                   +-------------------------------+                                     |
|                                   |                                                     |
|                                   v                                                     |
|                   +-------------------------------+                                     |
|                   | BroadcastChannel:             |                                     |
|                   | 'auromind_platform_bus'       |                                     |
|                   +-------------------------------+                                     |
|                                                                                         |
+-----------------------------------------------------------------------------------------+
```

1. **UUID Generation & Storage:**
   - Minted via `generateUuidV4()` in `auromind-sdk.js` ([Line 74](file:///C:/AuroMindPortal/assets/sdk/auromind-sdk.js#L74-L94)) using Web Crypto `randomUUID()` or `getRandomValues()`.
   - Persisted synchronously to `auromind.platform.v1.guest` and asynchronously to IndexedDB `AuroMindPlatformDB`.
2. **Browser Restart Restoration:**
   - Verified in `b11-game-integration.test.js` (Suite 2): Re-initializing `createAuroMindSDK()` on an existing storage mock restores the exact same `guest_<uuid>` record without modification.
3. **Concurrent First-Time Initialization:**
   - Protected by `navigator.locks.request('auromind-platform-guest-init')` ([auromind-sdk.js Line 906](file:///C:/AuroMindPortal/assets/sdk/auromind-sdk.js#L906)).
   - If two tabs open on an uninitialized browser profile simultaneously, Web Locks forces sequential execution. Tab A creates and writes the record; Tab B enters the lock, detects Tab A's record, and adopts it.
4. **BroadcastChannel Coordination:**
   - State mutations are broadcast over `auromind_platform_bus` (`GUEST_IDENTITY_READY`, `GUEST_IDENTITY_RECONCILED`).
   - If Web Locks is unsupported (legacy browsers), the SDK degrades cleanly to `storage` events on `window`.
5. **Inconsistent IDB and LocalStorage Copies:**
   - In `persistWinnerSafely` ([auromind-sdk.js Line 1043](file:///C:/AuroMindPortal/assets/sdk/auromind-sdk.js#L1043-L1150)), if IDB and localStorage disagree, the SDK deterministically selects the record with the **earliest `createdAt` timestamp** and auto-heals the newer/tampered record.
6. **Single Storage Failure Recovery:**
   - If IndexedDB is blocked or throws, SDK falls back to `localStorage` (`storageHealth.idbAvailable = false`).
   - If localStorage throws `QuotaExceededError`, SDK relies on `IndexedDB` (`storageHealth.lsAvailable = false`).
   - If both fail, SDK operates in ephemeral in-memory state (`ephemeral: true`).
7. **Cross-Game Identity Consistency:**
   - Verified across all six games in `b11-game-integration.test.js` (Suite 2). Every game retrieves the identical `platformGuestId`.
8. **Identified Race Conditions & Gaps:**
   - *No in-flight lock across game iframes if origins diverge:* In local testing, iframes are same-origin (`window.location.origin`). If games were ever hosted on cross-origin subdomains without partitioned Web Locks, convergence would rely on postMessage rather than BroadcastChannel. (Current architecture is strictly same-origin).

---

### B. Local Storage Durability & Recovery

Do not assume IndexedDB is immune to browser storage eviction, quota limits, private browsing restrictions, or storage clearing.

1. **Storage Eviction Vulnerability (Safari ITP & Chromium Storage Pressure):**
   - WebKit/Safari enforces a 7-day storage cap on script-writable storage for sites without user interaction.
   - Chromium evicts IndexedDB under device storage pressure (LRU eviction).
   - *Current Gap:* The SDK currently does **not** call `navigator.storage.persist()`.
   - *Recommendation:* Add an optional, non-blocking call to `navigator.storage.persist()` during portal bootstrap to request durable storage quota from the browser.
2. **Private / Incognito Browsing Behavior:**
   - Modern browsers allow IndexedDB in private mode, but wipe it immediately upon closing the private session.
   - The SDK handles this gracefully: `init()` succeeds, identity is minted, games run in-memory/ephemeral, and all data is cleaned up by the browser upon exit.
3. **Corrupt or Partially Written Records:**
   - If a JSON record in `localStorage` is malformed (e.g. truncated `{"schemaVersion":1,"guestId":`), `parseLsGuestRecord` catches the syntax error, tags it as `{ valid: false, reason: 'CORRUPTED_JSON' }`, and restores the valid record from `IndexedDB`.
4. **Accidental Local Overwrite Protection:**
   - `enforceMergeInvariants` (`auromind-adapters.js` [Line 459](file:///C:/AuroMindPortal/assets/sdk/auromind-adapters.js#L459-L481)):
     - **Invariant 1:** An empty or absent remote save **NEVER** overwrites local player progress.
     - **Invariant 2:** An empty local save adopts non-empty remote progress.
     - **Invariant 3:** Identical payload checksums require no merge.
   - This ensures that a freshly opened game or failed remote read can **never** erase healthy local progress.

---

### C. Game-Specific Save & Merge Policies (Six Games Audit)

```
+---------------------------------------------------------------------------------------------------+
|                                SIX-GAME ARCHITECTURE AUDIT TABLE                                  |
+---------------------------------------------------------------------------------------------------+
| Game Slug            | Native Adapter Present? | Storage Mechanism | Checksum Method              |
+----------------------+-------------------------+-------------------+------------------------------+
| auroblocks           | Standalone Bridge Module| LocalStorage      | Fragile string concatenation |
| auromatch            | Native Controller       | IDB + LS          | Fragile string concatenation |
| auromandala          | Standalone Bridge Module| LocalStorage      | Incomplete string concat     |
| vak                  | NO (Inlined storage)    | LocalStorage      | N/A (Missing adapter)        |
| word-riddle          | NO (Inlined storage)    | LocalStorage      | N/A (Missing adapter)        |
| vak-living-sanctuary | NO (Inlined storage)    | LocalStorage      | N/A (Missing adapter)        |
+---------------------------------------------------------------------------------------------------+
```

#### 1. AuroBlocks
- **Storage:** LocalStorage (`auroblocks_player_save_v1`, `auroblocks_high_score`, `auroblocks_stages`, `auroblocks_stage_scores`).
- **Adapter:** Standalone bridge `games/auroblocks/assets/auroblocks-sdk-bridge.js`.
- **Checksum Issue:** `blocks_${highScore}_${stages.length}`. If a player improves their score on an already cleared stage in `stageScores`, the checksum **does not change**.
- **Merge Policy:** Safe to auto-merge: take `max(highScore)`, union `stages`, and merge `stageScores` taking the highest score per stage.

#### 2. AuroMatch
- **Storage:** Dual IndexedDB (`AuroMatchDB`, store `gameState`) + LocalStorage (`auromatch_player_state`, `auro_match_user`, `auro_match_unlocked_tiles`, `auro_match_consecrations`).
- **Adapter:** Native controller `createAuroMatchGameAdapter()` in `storageAdapter.js`.
- **Checksum Issue:** `match_${completedLevelsCount}_${lotusPetalCount}`. Changes to settings, reflections, or daily draw dates do not alter the checksum.
- **Auto-Heal Asymmetry:** `autoHealFromIndexedDB()` aborts if `localStorage.getItem('auro_match_user')` is truthy, even if the localStorage item is truncated or minimal.
- **Merge Policy:** Safe to auto-merge: union `completedLevelIds`, take `max(lotusPetalCount)` and `max(consciousnessPoints)`, union `reflections` by creation timestamp.

#### 3. AuroMandala (CRITICAL CREATIVE WORK FINDING)
- **Storage:** LocalStorage (`pranamandala_game_cache_v2`, `sankalpa_e2ee_vault`).
- **Adapter:** Standalone bridge `games/auromandala/assets/auromandala-sdk-bridge.js`.
- **Sankalpa Vault Boundary:** Properly declared `cloudSyncEligible: false` and `localOnlyVaults: ['sankalpa_e2ee_vault']`.
- **Critical Artwork Vulnerability:**
  - `exportEnvelope()` computes checksum as `'mandala_' + highestStageCleared + '_' + sessions.length`.
  - **`savedArtworks` is completely omitted from the checksum calculation!**
  - If a player creates or edits a mandala artwork in `savedArtworks`, the checksum is unchanged. Invariant 3 will falsely treat the save as identical and skip sync.
  - Furthermore, `applyEnvelope()` performs a blanket `localStorage.setItem(CACHE_KEY, JSON.stringify(envelope.payload.cache))`, which **completely wipes local artworks** not present in the incoming envelope!
- **Merge Policy:** **UNDECIDED (Product Decision Required)**. Creative artwork cannot be merged via simple union or maximum values. Mandalas must either:
  1. Be assigned immutable UUIDs and merged as an append-only collection.
  2. If the same artwork UUID was modified on two devices, require an explicit user visual choice modal.

#### 4. VAK (Speech Control)
- **Storage:** LocalStorage (`auro_vak_user`).
- **Corpus:** 1,368 levels embedded in single-file DOM (`games/vak/index.html`).
- **Adapter:** Missing standalone bridge module (`GAP-01`).
- **Merge Policy:** Safe to auto-merge: take `max(currentLevel)`, `max(sparks)`, union `unlockedWords`.

#### 5. Word Riddle
- **Storage:** LocalStorage (`word_discovery_save_v1`).
- **Adapter:** Missing standalone bridge module (`GAP-01`).
- **Merge Policy:** Safe to auto-merge: union `solvedRiddles` array, preserve active theme.

#### 6. VAK Living Sanctuary
- **Storage:** LocalStorage (`vak_sanctuary_codex_v1`).
- **Adapter:** Missing standalone bridge module (`GAP-01`).
- **Merge Policy:** Safe to auto-merge: union `unlockedWords` array, merge personal codex reflections by timestamp.

---

### D. Offline Synchronization & Conflict Handling

1. **Local-Authoritative Outbox Queue:**
   - Local saves write immediately to disk and add the game ID to `syncOutbox` (`LS_OUTBOX_KEY`).
   - Pushes execute sequentially during `syncService.syncNow()` on network reconnect.
2. **Idempotency & Replay Protection:**
   - Every push to Supabase invokes `upsert_game_save_checked` with `p_expected_revision = baseRevision`.
   - If a duplicate push arrives, `expectedRevision` matches current server revision only once; subsequent duplicate requests fail or return existing revision without creating duplicates.
3. **HTTP 409 Conflict Handling:**
   - If `currentRevision > expectedRevision`, PostgreSQL returns `status: 'conflict'`.
   - The client SDK catches this, pulls the latest server envelope, and executes `resolveGameMerge()`.
4. **Device Clock Discrepancies:**
   - The architecture uses sequential integer revisions ($1 \rightarrow 2 \rightarrow 3$), **not timestamps**, as the synchronization authority. Client clocks are strictly informational (`clientUpdatedAt`). Clock skew between devices cannot corrupt revisions.
5. **Basic Gameplay Independence:**
   - Confirmed: Basic gameplay never touches `syncService`. If the device is offline, `syncOutbox` buffers changes silently without UI lag or errors.

---

### E. Authentication & Account Migration

1. **Guest-to-Account Linking:**
   - When a guest creates an account via `sdk.auth.upgradeGuestToAccount()`:
     - `guest_identity_links` maps `(user_id, guest_id)`.
     - Local saves are preserved.
     - With explicit user sync consent, local saves are pushed to `game_saves` as revision 1.
2. **Preservation of One Profile = One Identity:**
   - In accordance with the established product principle:
     - When a user logs out (`signOut()`), the session JWT is cleared from `auromind.platform.v1.supabase_session`, but local guest saves remain intact.
     - There is **no in-app player switching dialog**. If a different human uses the device, they use a different browser profile.
3. **Duplicate Account-Link Handling:**
   - In `supabase/migrations/20261120000001_b5_core_schema.sql`, table `guest_identity_links` declares primary key `(user_id, guest_id)`. Linking the same guest multiple times is an idempotent upsert (`onConflict: 'user_id,guest_id'`).

---

### F. Purchase Entitlements & Monetization Security

1. **Ad-Free One-Time Purchase Direction:**
   - AuroMasti's confirmed commercial direction is **ad-free one-time purchases for premium themes** (e.g. Royal Lapis theme, sacred soundscapes), **never recurring subscriptions**.
2. **Server-Side Verification & Signed Claims:**
   - Client-side token generation is strictly forbidden.
   - When payment is activated, an external payment gateway webhook notifies a Supabase Edge Function with service-role permissions.
   - The Edge Function inserts an entitlement record into `entitlements` (`user_id`, `sku`, `tier: 'full'`, `status: 'active'`, `source: 'payment_gateway'`).
   - The client reads entitlements through a strict RLS policy: `auth.uid() = user_id AND status = 'active'`.
3. **Offline Grace Period & Reinstall Recovery:**
   - Entitlements are cached in `auromind.platform.v1.entitlements_cache`.
   - While offline, access to purchased themes is granted based on cached verified entitlements.
   - On reinstall or device switch, logging into Supabase triggers `sdk.entitlements.refresh()`, pulling active entitlements immediately.

---

### G. Achievements Contract (`sdk.achievements`)

1. **Proposed Interface:**
   - `unlock(id)`, `hasUnlocked(id)`, `getProgress(id)`, `listDefinitions()`, `subscribe(fn)`.
2. **Offline-First Guarantees:**
   - Unlocked achievements persist locally in `auromind.platform.v1.achievements`.
   - Idempotent: Unlocking an already-unlocked achievement returns the existing record without duplicate timestamps.
3. **Cloud Synchronization:**
   - Achievements serialize into a standard `GameSaveEnvelope` with `gameId: 'platform_achievements'` and sync via `syncService`.

---

### H. Telemetry & Privacy Boundaries

1. **Explicit Opt-In & Zero PII:**
   - `LS_CONSENT_KEY` gates collection.
   - Payloads are scrubbed for passwords, tokens, and PII via `redactSensitive()` ([auromind-sdk.js Line 240](file:///C:/AuroMindPortal/assets/sdk/auromind-sdk.js#L240-L263)).
2. **Boundary Enforcement for Prohibited Data:**
   - **Sankalpa Vault:** 100% excluded (`localOnlyVaults: ['sankalpa_e2ee_vault']`).
   - **VAK Corpus & Flora Database:** Static code only; never transmitted in telemetry.
   - **User Creative Artwork:** Telemetry collects only event metadata (`event_name: 'mandala_completed'`), never the underlying SVG artwork data.
3. **Retention & Purge:**
   - Telemetry capped at a 90-day retention horizon via `prune_expired_telemetry()`.
   - Account deletion purges all telemetry, saves, and links.

---

### I. Security & Threat Assessment

| Threat Vector | Current Status | Assessment & Mitigation |
|:---|:---:|:---|
| **Service Role Leakage** | **VERIFIED PROTECTED** | Throws runtime errors if `service_role` is passed to client config. |
| **Sankalpa Cloud Leakage** | **VERIFIED PROTECTED** | Triply barred: adapter declaration, sync worker filter, migration assertion. |
| **XSS & Script Injection** | **VERIFIED PROTECTED** | `server.js` serves strict CSP `script-src 'self'`. Inline scripts extracted. |
| **Iframe Message Spoofing** | **VERIFIED PROTECTED** | Games validate `event.origin` and `event.source === window.parent`. |
| **Ad-Hoc Checksum Collision** | **PARTIALLY PROTECTED** | **VULNERABILITY:** String checksums in AuroBlocks and AuroMandala miss internal payload mutations. |
| **AuroMandala Artwork Loss** | **UNPROTECTED** | **VULNERABILITY:** Blanket `localStorage.setItem` in `applyEnvelope` can wipe local artworks. |
| **Storage Quota Eviction** | **PARTIALLY PROTECTED** | Missing `navigator.storage.persist()` call to defend against browser eviction. |

---

## 4. Sacred Invariant Verification

The sacred platform baselines were verified against canonical repository files:

```text
1. VAK Protected Speech Training Corpus
   - File: games/vak/index.html (embedded const CL = [[...]])
   - SHA-256 Hash: 9fdb3826030049c9eab183479bcb7fe29304b3ea08d045c8c67f1cfd4d77da09
   - Status: 100% BYTE-EXACT MATCH (VERIFIED)

2. Flora Botanical Database
   - File: games/auromatch/src/models/floraDatabase.js
   - Exact Size: 2,002,176 bytes
   - Physical LF Lines: 46,321
   - SHA-256 Hash: 689d035cd52abd8d342528d8c5f61f298916b8052b8287450be4931cf8ae1a3a
   - Status: 100% BYTE-EXACT MATCH (VERIFIED)

3. AuroMandala Sankalpa Vault
   - File: games/auromandala/assets/auromandala-sdk-bridge.js
   - Declaration: cloudSyncEligible: false, localOnlyVaults: ['sankalpa_e2ee_vault']
   - Status: 100% ISOLATED & LOCAL-ONLY (VERIFIED)
```

---

## 5. Review of Architecture Decision Records (ADR-01 to ADR-10)

| ADR # | Title | Classification | Technical Justification & Conditions |
|:---:|:---|:---:|:---|
| **ADR-01** | **Canonical Identity** | **Technically Sound with Conditions** | Sound under established principle: **1 browser profile = 1 player identity**. Condition: Formally rescind all proposals for in-app profile selectors / session boundary dialogs. |
| **ADR-02** | **Opaque Save Payload** | **Technically Sound** | Envelope v1 isolates platform metadata from domain game state. Completely protects diverse game architectures. |
| **ADR-03** | **Singleton SDK Contract** | **Technically Sound** | Frozen ES module singleton (`Object.freeze`) encapsulates state and prevents script collisions. |
| **ADR-04** | **Non-Destructive Migration** | **Technically Sound** | `guest_identity_links` maps device ID to account ID without overwriting local progress. |
| **ADR-05** | **Offline Outbox & Concurrency** | **Sound with Conditions** | Sound in principle. Condition: Replace fragile string checksums with SHA-256 payload hashing (`computePayloadChecksum`). |
| **ADR-06** | **Conflict Merge Strategies** | **Sound with Conditions** | Sound for progression. Condition: Explicitly exempt AuroMandala user-created artwork from automated union/max merges; treat artwork as append-only or require user visual selection. |
| **ADR-07** | **Local Operational Authority** | **Technically Sound** | Device is primary operational authority; cloud is durable replica. Essential for 100% offline play. |
| **ADR-08** | **Purchase Entitlements** | **Technically Sound with Conditions** | Sound for ad-free one-time theme purchases. Condition: Provider-agnostic server verification; public-key signed tokens; beta remains 100% free. |
| **ADR-09** | **Privacy & Sankalpa Exclusion** | **Technically Sound** | Zero PII, 90-day retention, GDPR purge, and absolute exclusion of Sankalpa vault. |
| **ADR-10** | **Provider Adapter Pattern** | **Technically Sound** | Shields all games from direct cloud SDK coupling. Service-role keys hard-rejected. |

---

## 6. Architecture Readiness Recommendation

### Final Recommendation: `READY WITH CONDITIONS`

The shared services architecture is conceptually mature, fully verified in offline tests (251/251 passing), and honors the core sacred invariants. Before moving to B18-B implementation and B18-C backend activation, the conditions outlined in [B18_A3_RISK_AND_DECISION_REGISTER.md](file:///C:/AuroMindPortal/B18_A3_RISK_AND_DECISION_REGISTER.md) must be incorporated into the technical roadmap.
