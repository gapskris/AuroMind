# B18-A — Shared Services Architecture Readiness Assessment

**Author:** AuroMind Platform Architecture Team  
**Date:** November 21, 2026  
**Canonical Workspace:** `C:\AuroMindPortal`  
**Active Git Branch:** `dev/studio-integration`  
**Baseline HEAD Commit:** `b6ccc860bb7d38a70ef678049a9588b8b73c40aa`  
**Target Release:** January 1, 2027  
**Status:** ARCHITECTURE ASSESSMENT & DOCUMENTATION ONLY (Zero Backend Provisioning)  

---

## 1. Executive Summary & Assessment Classification

AuroMasti has achieved full integration of its core game titles and unified runtime platform in `C:\AuroMindPortal`. Before introducing any production cloud backend (Supabase), this assessment establishes the technical readiness of the shared services architecture across seven dimensions:
1. Independent gameplay across all six launch titles.
2. Local-first and 100% offline functionality.
3. Guest and registered player identity lifecycles.
4. Game progression isolation and save envelope framing.
5. Optional, consent-driven cloud backup and optimistic synchronization.
6. Future purchase entitlements and commercial boundary enforcement.
7. Cross-game telemetry, analytics, and privacy protections.

### Overall Assessment Classification: `READY WITH CONDITIONS`

| Dimension | Readiness Rating | Architectural Summary |
|:---|:---:|:---|
| **Core Offline Gameplay** | **READY** | All six launch games execute completely offline with zero network calls. Service workers and precache isolate shells and game bundles. |
| **Protected Corpora Sovereignty** | **READY** | VAK 1,368-level speech corpus (SHA-256 `9fdb3826...`) and Flora Botanical Database (2,002,176 B, SHA-256 `689d035c...`) are 100% local, embedded, and immutable. |
| **Sankalpa Vault Privacy** | **READY** | AuroMandala Sankalpa contemplation vault is strictly local-only with Web Crypto E2EE (`cloudSyncEligible: false`, zero cloud leakage). |
| **Guest Identity Architecture** | **READY** | Deterministic UUIDv4 guest identity with dual IndexedDB + localStorage persistence, Web Locks concurrency control, and cross-tab BroadcastChannel healing. |
| **Save Envelope Framing** | **READY** | `SAVE_ENVELOPE_VERSION = 1` contract enforces versioned, checksummed envelopes with game schema independence and non-destructive merge invariants. |
| **Backend Independence** | **READY** | Provider adapter pattern (`assets/sdk/config/backend-config.js`) completely shields games from concrete cloud APIs. Service role keys and private credentials are structurally banned. |
| **Game Adapter Standardization** | **CONDITIONAL** | AuroBlocks, AuroMandala, and AuroMatch have dedicated native adapters. VAK, Word Riddle, and VAK Living Sanctuary rely on iframe embedding without dedicated native adapter bridge files in `games/*/assets/`. |
| **Multi-User Local Partitioning** | **CONDITIONAL** | A single browser profile shares one guest identity. Switching between multiple authenticated users on a shared device requires explicit storage partition scoping before B18-C. |
| **Cross-Game Achievements** | **CONDITIONAL** | Currently tracked informally via `sdk.player.stats`; needs formalization into an `sdk.achievements` contract before cross-game meta-progression is enabled. |

---

## 2. Workspace & Baseline Preflight

The canonical workspace and repository state were verified prior to inspection:

```text
Workspace Directory: C:\AuroMindPortal
Active Git Branch:   dev/studio-integration
Baseline HEAD:       b6ccc860bb7d38a70ef678049a9588b8b73c40aa
Git Status:          Clean with all B17.1-B17.4A deliverables safely preserved.
Automated Tests:     251 / 251 passing across 17 test suites (100% pass rate).
Historical Snapshot: C:\AuroMind_Studio (frozen, read-only, verified untouched).
```

---

## 3. Shared Services Architecture Inspection

### A. Inventory of Shared Platform Services

The AuroMind Shared Platform SDK (`assets/sdk/auromind-sdk.js`) and Game Adapter Registry (`assets/sdk/auromind-adapters.js`) provide the following service interfaces:

```
+-----------------------------------------------------------------------------------------+
|                                    AuroMind SDK (v1.0.0)                                |
|                                                                                         |
|  +--------------------+  +--------------------+  +------------------+  +-------------+  |
|  |  identityService   |  |  storageService    |  |  playerService   |  | authService |  |
|  |  (Guest UUID, IDB) |  |  (Dual IDB + LS)   |  |  (Prefs, Profile)|  | (Supabase)   |  |
|  +--------------------+  +--------------------+  +------------------+  +-------------+  |
|                                                                                         |
|  +--------------------+  +--------------------+  +------------------+  +-------------+  |
|  |  adaptersRegistry  |  |  syncService       |  | telemetryService |  | accessSvc   |  |
|  |  (Save Envelopes)  |  |  (Optimistic Lock) |  | (Consent, Queue) |  | (Offline)   |  |
|  +--------------------+  +--------------------+  +------------------+  +-------------+  |
|                                                                                         |
|  +--------------------+  +--------------------+  +------------------+  +-------------+  |
|  |  entitlementsSvc   |  |  configService     |  | loggingService   |  | diagnostics |  |
|  |  (Tier/SKU Checks) |  |  (Remote Flags)    |  | (Diagnostics)    |  | (Health)    |  |
|  +--------------------+  +--------------------+  +------------------+  +-------------+  |
+-----------------------------------------------------------------------------------------+
```

| Service Module | Source File | Core Responsibilities | Consumers |
|:---|:---|:---|:---|
| **Identity Service** (`sdk.identity`) | [auromind-sdk.js](file:///C:/AuroMindPortal/assets/sdk/auromind-sdk.js#L1380-L1411) | Mints, verifies, and synchronizes RFC-4122 UUIDv4 guest identities across browser tabs using Web Locks and BroadcastChannel. | Portal bootstrap, all 6 games, telemetry, sync outbox. |
| **Adapter Registry** (`sdk.adapters` / `sdk.saves`) | [auromind-adapters.js](file:///C:/AuroMindPortal/assets/sdk/auromind-adapters.js#L540-L830) | Registers game adapters, validates contract bounds, enforces storage key isolation, and exports/applies versioned save envelopes. | AuroMatch, AuroMandala, AuroBlocks, sync service. |
| **Storage Service** (`sdk.storage`) | [auromind-sdk.js](file:///C:/AuroMindPortal/assets/sdk/auromind-sdk.js#L1583-L1669) | Manages platform-level IndexedDB (`AuroMindPlatformDB`) and localStorage mirror (`auromind.platform.*`); enforces key protection boundaries. | Portal, identity service, profile manager. |
| **Auth Service** (`sdk.auth`) | [auromind-sdk.js](file:///C:/AuroMindPortal/assets/sdk/auromind-sdk.js#L1435-L1570) | Handles user authentication (email/password, OTP), session restoration, guest-to-account upgrading, and account deletion. | Portal auth modals, user account management. |
| **Sync Service** (`sdk.sync`) | [auromind-sdk.js](file:///C:/AuroMindPortal/assets/sdk/auromind-sdk.js#L1670-L1865) | Manages offline outbox (`LS_OUTBOX_KEY`), consent verification, pull/push lifecycle, and optimistic concurrency locks. | Portal sync worker, manual sync triggers. |
| **Player / Profile** (`sdk.player`) | [auromind-sdk.js](file:///C:/AuroMindPortal/assets/sdk/auromind-sdk.js#L2350-L2425) | Manages display name, audio preferences, Senior Mode, reduced motion, lifetime gameplay stats, and GDPR user data export/purge. | Portal UI, Senior Mode sync, Game Managers. |
| **Telemetry Service** (`sdk.telemetry`) | [auromind-sdk.js](file:///C:/AuroMindPortal/assets/sdk/auromind-sdk.js#L2060-L2240) | Ingests structured platform events, validates zero PII, queues offline events (max 200), and flushes batches to Edge Functions. | Portal page lifecycle, Game Managers, session timers. |
| **Entitlements Service** (`sdk.entitlements`) | [auromind-sdk.js](file:///C:/AuroMindPortal/assets/sdk/auromind-sdk.js#L2480-L2535) | Evaluates commercial gate status, manages active passes, verifies server-signed claims, and coordinates purchase requests. | AuroMatch entitlement manager, portal store UI. |
| **Config Service** (`sdk.config`) | [auromind-sdk.js](file:///C:/AuroMindPortal/assets/sdk/auromind-sdk.js#L2250-L2340) | Fetches and caches remote feature flags, semver thresholds, and runtime tuning without application code redeployment. | Portal bootstrap, game feature gating. |
| **Diagnostics & Logging** (`sdk.logging`) | [auromind-sdk.js](file:///C:/AuroMindPortal/assets/sdk/auromind-sdk.js#L1870-L2050) | In-memory ring buffer (150 logs) and localStorage mirror (50 logs) for runtime error tracking and storage health monitoring. | Error boundary, test suites, developer console. |

### B. Interface Consistency and Gaps Identified

1. **Adapter Discrepancy Across Games:**
   - *Native Adapters:* AuroMatch (`storageAdapter.js`), AuroMandala (`auromandala-sdk-bridge.js`), and AuroBlocks (`auroblocks-sdk-bridge.js`) fully implement `exportEnvelope()`, `applyEnvelope()`, `hasLocalProgress()`, and declared storage bounds.
   - *Iframe / Observer-Only Games:* VAK (`games/vak/index.html`), Word Riddle (`games/word-riddle/index.html`), and VAK Living Sanctuary (`games/vak-living-sanctuary/index.html`) persist progress into isolated localStorage keys (`auro_vak_user`, `word_discovery_save_v1`, `vak_sanctuary_codex_v1`) but currently rely on portal iframe postMessage bridges rather than discrete ES module adapter files in their own directories.
2. **Missing SDK Abstractions:**
   - *Cross-Game Achievements:* There is no `sdk.achievements` service. Cross-game milestones (e.g., "Complete 10 levels across 3 games") must be computed ad-hoc from `sdk.player.stats`.
   - *Shared Audio Controller:* Portal audio synthesizer and game audio synthesizers (e.g., AuroMatch Web Audio synthesizer) manage audio contexts independently without an overarching audio bus bridge.

---

## 4. Local-First & Offline Architecture Assessment

### A. Zero-Network Invariant

**Platform Law:** *AuroMasti must remain 100% functional, responsive, and playable even if every cloud endpoint is offline, blocked, or unprovisioned.*

The architecture satisfies this invariant completely:
- `assets/sdk/auromind-sdk.js` requires **zero network calls during `sdk.init()`**.
- `DEFAULT_CAPABILITIES` defaults all Tier-2 cloud capabilities (`authEnabled`, `cloudSyncEnabled`, `entitlementsEnabled`, `analyticsEnabled`, `remoteConfigEnabled`) to `false`.
- Games run without backend dependencies; direct imports of `@supabase/supabase-js` or `firebase/app` in game source code are strictly prohibited and tested.

### B. Feature-by-Feature Offline Storage & Behavior Matrix

| Platform Feature | Local Storage Mechanism | Behavior When 100% Offline | Backend Fallback Mode |
|:---|:---|:---|:---|
| **Game Launch & Theater** | Root Service Worker Cache + Game SW Workbox precache | Boots instantly from local cache; offline indicator visible if offline. | 100% Local (Zero network required) |
| **Guest Player Identity** | IndexedDB `AuroMindPlatformDB` + LS mirror `auromind.platform.v1.guest` | Generates or reads RFC-4122 UUIDv4 locally via Web Crypto API. | 100% Local (Deterministic offline minting) |
| **AuroMatch Progression** | IndexedDB `AuroMatchDB` + LS mirror `auromatch_player_state` | All 520 levels, constellations, lotus petals, and daily draws save locally. | 100% Local (IndexedDB with LS auto-heal) |
| **AuroBlocks Progression** | LocalStorage `auroblocks_player_save_v1` & `auroblocks_high_score` | High scores, stage progression, and grid state save immediately. | 100% Local |
| **AuroMandala Progression** | LocalStorage `pranamandala_game_cache_v2` | Stages, sessions, and sacred mandala geometry artworks persist locally. | 100% Local |
| **VAK Speech Puzzles** | Embedded HTML bundle + LocalStorage `auro_vak_user` | All 1,368 speech levels, clues, and audio synth execute offline. | 100% Local (Corpus embedded in DOM) |
| **Word Riddle Puzzles** | LocalStorage `word_discovery_save_v1` + vendor data chunks | Solved riddles and theme unlocks persist locally. | 100% Local |
| **VAK Living Sanctuary** | LocalStorage `vak_sanctuary_codex_v1` + Workbox precache | Discovered contemplation codex and quotes persist locally. | 100% Local |
| **Sankalpa Sacred Vault** | LocalStorage `sankalpa_e2ee_vault` + Web Crypto AES-GCM | Encrypted locally with user passphrase; never exported or synced. | **SACRED INVARIANT: 100% Local-Only** |
| **Player Preferences** | LocalStorage `auromind.platform.v1.player_profile` | Senior Mode, reduced motion, and volume load and persist locally. | 100% Local |
| **Telemetry & Analytics** | LocalStorage `auromind.platform.v1.telemetry_queue` (max 200) | Events buffer locally; no failed network requests or UI blocking. | Memory queue -> LocalStorage ring buffer |
| **Commercial Passes** | LocalStorage `auromind.platform.v1.entitlements_cache` | Beta mode: 100% free; all levels unlocked without payment checks. | Local entitlement grant |

---

## 5. Identity & Player Isolation Architecture

### A. Guest Identity Lifecycle

```
[ First Launch / Cold Boot ]
             |
             v
+----------------------------+
| Web Locks: 'auromind-init' |
+----------------------------+
             |
             +---> Check IndexedDB 'platform_meta' ('guest_identity')
             |     - Found? Validate schemaVersion === 1 & UUIDv4 format
             |
             +---> Check localStorage 'auromind.platform.v1.guest'
             |     - Found & IDB missing? Auto-heal IDB from LS mirror!
             |     - Both missing? Mint new RFC-4122 UUIDv4 via crypto.randomUUID()
             |
             +---> Write synchronously to localStorage & asynchronously to IDB
             |
             +---> Broadcast on 'auromind_platform_bus' to align concurrent tabs
             |
             v
[ Stable Device Guest Identity: guest_<uuid> ]
```

### B. Game Progression Isolation & Anti-Contamination

1. **Storage Namespace Protection:**
   - Platform keys are strictly reserved under `auromind.platform.*` and `AuroMindPlatformDB`.
   - Adapters are prohibited from claiming platform storage via `isProtectedPlatformKey()`.
   - Each game writes strictly to its declared keys (`storage.ownedLocalStorageKeys`) and databases (`storage.ownedDatabases`).
2. **Clear Cache Safety:**
   - The portal "Clear Cache" button invokes `clearPortalPreferencesOnly()` ([portal.js](file:///C:/AuroMindPortal/assets/js/portal.js#L40-L76)), which removes UI preferences while **strictly preserving** `auromind.platform.v1.guest`, `AuroMindPlatformDB`, and all game save data.
3. **Multi-User Device Scenario Assessment:**
   - *Current Behavior:* All unauthenticated sessions on the same browser profile share the single device guest ID.
   - *Contamination Risk:* If Player A plays as a guest, then logs into their registered account, Player A's guest saves are linked to their account via `guest_identity_links`. If Player A logs out and Player B plays as guest on the same device, Player B inherits Player A's local saves unless the device is explicitly reset or partitioned.
   - *Mitigation Requirement (B18-C):* Implement session-scoped local storage partitioning or explicit "Switch Profile / Log Out & Clear Local Guest" modal prompts.

---

## 6. Offline Synchronization Architecture Design (Future B18-B/C)

### A. Expected Synchronization Architecture

```
+-----------------------------------------------------------------------------------------+
|                                Client Local State (Authoritative)                       |
|                                                                                         |
|  [Game Save Engine] ---> [Game Adapter] ---> [Save Envelope] ---> [Sync Outbox Queue]   |
|                                                     |                         |         |
+-----------------------------------------------------|-------------------------|---------+
                                                      |                         |
                                            (Non-destructive Merge)        (Online Event)
                                                      |                         |
                                                      v                         v
+-----------------------------------------------------------------------------------------+
|                                Cloud Synchronization Boundary                           |
|                                                                                         |
|       [pullLatest] <--------------------------------------------- [pushWithOptimisticLock]
|            |                                                               |            |
|            v                                                               v            |
|   +------------------+                                            +------------------+  |
|   | PostgreSQL:      |                                            | RPC Function:    |  |
|   | game_saves table |                                            | upsert_save_chk  |  |
|   +------------------+                                            +------------------+  |
|            |                                                               |            |
|            +----------------------- RLS: auth.uid() = user_id -------------+            |
+-----------------------------------------------------------------------------------------+
```

### B. Save Envelope Framing Contract (`SAVE_ENVELOPE_VERSION = 1`)

Every game save payload eligible for synchronization must be wrapped in a standardized envelope:

```typescript
interface GameSaveEnvelope {
  envelopeVersion: 1;               // Strict framing version
  gameId: string;                   // Lowercase game slug (e.g. 'auromatch')
  gameSchemaVersion: number;        // Game-owned schema version (e.g. 1)
  guestId: string;                  // Originating RFC-4122 UUIDv4 guest ID
  baseRevision: number;             // Revision count (0 for fresh local saves)
  clientUpdatedAt: string;          // ISO-8601 UTC timestamp
  isEmpty: boolean;                 // True if no real progress exists
  checksum: string;                 // Deterministic payload checksum
  payload: Record<string, unknown>; // Game-owned arbitrary save data
}
```

### C. Concurrency & Conflict Resolution Strategy

1. **Optimistic Locking:** Every cloud push sends `p_expected_revision = baseRevision`. If the server's current revision is greater, PostgreSQL aborts the write and returns `HTTP 409 Conflict` with the latest server envelope.
2. **Mandatory Non-Destructive Merge Invariants (`resolveGameMerge`):**
   - *Invariant 1:* An empty or absent remote record NEVER overwrites non-empty local progress (`status: 'use_local'`).
   - *Invariant 2:* An empty local record with non-empty remote progress automatically adopts the remote progress (`status: 'use_remote'`).
   - *Invariant 3:* Identical checksums indicate data parity and require zero network transmission (`status: 'use_local'`).
   - *Invariant 4:* Conflicting concurrent saves with differing contents are delegated strictly to the game's registered `GameMergeStrategy`. If no strategy is registered, the SDK halts and triggers `status: 'conflict_requires_user_choice'`, prompting the player to choose between Local and Cloud versions.

---

## 7. Future Supabase Integration Boundary

### A. Permitted Cloud Services vs. Strictly Forbidden Local Features

```
+----------------------------------------------------+-----------------------------------------------+
|       PERMITTED FOR SUPABASE (B18-B / B18-C)       |         STRICTLY FORBIDDEN / LOCAL ONLY       |
+----------------------------------------------------+-----------------------------------------------+
| 1. User Authentication (Email, OTP, Passwords)     | 1. Sankalpa Sacred Contemplation Vault        |
| 2. Guest-to-Account Identity Linking               | 2. Web Crypto E2EE Passphrases & Private Keys |
| 3. Game Save Cloud Backup (Non-Sankalpa saves)     | 3. Unconsented Telemetry & Private Logs       |
| 4. Server-Verified Entitlements & Purchased Passes | 4. VAK 1,368-Level Pronunciation Corpus       |
| 5. Dynamic Remote Configuration & Feature Flags    | 5. AuroMatch Flora Botanical Database         |
| 6. Rate-Limited Telemetry Ingestion (Edge Func)    | 6. Local-First Offline Game Engine Playability|
| 7. GDPR Account Export & Absolute Cloud Purge      | 7. Direct Database Access from Game HTMLs     |
+----------------------------------------------------+-----------------------------------------------+
```

### B. Database Schema & Row Level Security (RLS) Requirements

When Supabase is provisioned in B18-C, the following RLS policies are mandatory:

1. `game_saves`:
   - `SELECT`: `auth.uid() = user_id`
   - `INSERT / UPDATE`: Only via `upsert_game_save_checked` RPC with `auth.uid() = user_id`.
   - `DELETE`: `auth.uid() = user_id`
2. `guest_identity_links`:
   - `SELECT / INSERT / UPDATE`: `auth.uid() = user_id`
3. `entitlements`:
   - `SELECT`: `auth.uid() = user_id AND status = 'active'`
   - `INSERT / UPDATE`: Restricted strictly to server-side webhook/Edge Functions with service role.
4. `telemetry_events`:
   - Direct client writes blocked. Ingestion permitted solely via `ingest-telemetry` Edge Function.

---

## 8. Security & Data Integrity Assessment

| Security Dimension | Current Implementation Status | Risk Assessment |
|:---|:---|:---|
| **Service Role Protection** | Checked in `supabase-client.js` ([Line 26](file:///C:/AuroMindPortal/assets/sdk/providers/supabase/supabase-client.js#L26-L34)) and `backend-config.js` ([Line 68](file:///C:/AuroMindPortal/assets/sdk/config/backend-config.js#L68-L73)); throws immediate exception if detected. | **SECURE** |
| **Sankalpa Vault Sovereignty** | Declared `cloudSyncEligible: false` and `localOnlyVaults: ['sankalpa_e2ee_vault']`. Checked in sync service and migration engine. | **SECURE** |
| **CSP & Inline Script Hardening** | `server.js` serves strict CSP headers (`script-src 'self'`). AuroBlocks inline scripts refactored into external module. | **SECURE** |
| **Telemetry Ingestion Safety** | Edge Function enforces 64 KiB payload cap, 50-event batch limit, and rate limiting (FIND-02). | **SECURE** |
| **Cross-Game Storage Boundary** | `auromind-adapters.js` enforces `isProtectedPlatformKey()` and unique storage keys per game. | **SECURE** |
| **Multi-User Device Contamination** | Local storage persists across browser restarts; signing out does not purge local guest data. | **ACTION REQUIRED (B18-C)** |

---

## 9. Final Recommendations & Roadmap to B18-B / B18-C

1. **Owner Approval Required:** Prior to B18-B/C, the owner must formally approve the 10 architecture decisions in [B18_A_ARCHITECTURE_DECISION_REGISTER.md](file:///C:/AuroMindPortal/B18_A_ARCHITECTURE_DECISION_REGISTER.md).
2. **Adapter Harmonization:** Author standardized standalone adapter bridges for VAK, Word Riddle, and VAK Living Sanctuary.
3. **Multi-User Storage Partitioning:** Implement explicit profile segregation for shared family devices.
4. **Backend Provisioning:** Maintain the freeze on Supabase cloud provisioning until B18-C.
