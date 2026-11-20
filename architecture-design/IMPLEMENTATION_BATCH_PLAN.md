# AuroMind Platform Modernization — Implementation Batch Plan & Sequencing

**Status:** Design Freeze Deliverable (6 of 7)  
**Target Launch:** **1 January 2027** (Priority Products: VAK Speech Control, AuroMatch, AuroMandala)  
**Four Integrated Workstreams:**
- **WS1:** Shared Architecture & Platform Services
- **WS2:** Supabase Architecture & Implementation
- **WS3:** Non-Supabase Remediation & Repository Hygiene
- **WS4:** Product Integration & Launch Readiness

---

## 1. Evidence-Based Dependency Graph & Parallelism Map

```text
[DECISION GATE 0: OPEN_DECISIONS.md Sign-Off]
   │
   ├──► [Batch B0 — WS3: Repo File-Budget & Docs Exposure Hygiene]  (PREREQUISITE before adding SDK files!)
   │       │  (Keeps dev/studio-integration strictly <= 990 tracked files & blocks non-public docs in server.js)
   │       ▼
   │    [Batch B1 — WS1: Shared SDK Foundation]
   │       │  (assets/sdk/auromind-sdk.js, assets/sdk/auromind-adapters.js, auromind-sdk.test.js)
   │       ▼
   │    [Batch B2 — WS1+WS3: Portal Init, Identity Lifecycle, Clear Cache Fix & Root SW]
   │       │
   │       ├──► [Batch B3 — WS4: VAK Speech Control Native Integration + vak/sw.js Offline SDK]   ──┐
   │       ├──► [Batch B4 — WS4: AuroMatch Native Integration + auromatch/sw.js Offline SDK]      ──┼─► CAN RUN IN PARALLEL
   │       └──► [Batch B5 — WS4: AuroMandala Upstream Source Rebuild & Integration]               ──┘   (B5 waits ONLY on Upstream Source access!)
   │
   └──► [CAN RUN IN PARALLEL WITH B1–B4 ONCE SUPABASE DECISIONS ARE CONFIRMED:]
        [Batch S1 — WS2: Supabase Project Provisioning, Schema, RLS & Security Tests]
           │
           ▼
        [Batch S2 — WS2+WS1: SupabaseAuthProvider & Guest-to-Account Linking]
           │
           ▼
        [Batch S3 — WS2+WS4: SupabaseCloudSyncProvider, Outbox & 3-Game Merge Verification]
           │
           ▼
        [Batch S4 — WS2+WS4 (Optional Target): Verified Entitlements, Payments, Analytics & Remote Config]
           │
           ▼
   ══════════════════════════════════════════════════════════════════════════════════
   [Batch R1 — WS4: Three-Product Full Regression, Offline & Security Release Gate]
   (Mandatory Tier-1 launch can ship on 1 Jan 2027 even if S2–S4 remain safely disabled!)
```

### Parallel vs. Strictly Gated Work
- **Can run in parallel immediately after Decision Gate 0:**
  - **WS1/WS3 track (`B0 → B1 → B2 → B3 / B4`)** and **WS2 Supabase track (`S1`)** are decoupled by provider interfaces and can proceed in parallel.
  - **`B3` (VAK Speech Control)** and **`B4` (AuroMatch)** are completely independent once `B2` lands.
  - **`B5` (AuroMandala upstream source integration)** can begin in the upstream AuroMandala repo as soon as `SHARED_SDK_CONTRACTS.md` is frozen and upstream repo access is confirmed.
- **Must wait for earlier decisions / gates:**
  - `B1` MUST wait for `B0` so adding the 3 SDK files never crosses Google AI Studio's `1,000`-file GitHub import cap.
  - `B5` MUST wait for Product Owner confirmation & access to AuroMandala's legitimate upstream Vite/React source repo.
  - `S1` MUST wait for Product Owner confirmation on Supabase org/project, region, production domain, and auth methods.
  - `S4` (Payments/Entitlements) MUST wait for payment processor & SKU decisions (and never blocks Tier-1 launch).

---

## 2. Ordered Implementation Batches

### Batch B0 — Repository File-Budget & Exposure Hygiene (WS3 — Mandatory Prerequisite)
- **Objective:** Resolve the `1,001 / 1,000` tracked-file count introduced by adding the 7 design-freeze docs (plus ensure non-runtime docs are never served publicly by `server.js`).
- **Scope:** Execute Product Owner's chosen file-budget strategy (e.g., move historical/design docs to a dedicated docs branch or consolidate frozen docs, and if any docs folder remains on `dev/studio-integration`, add it to `server.js` `BLOCKED_ROOT_SEGMENTS` + `server.test.js`). Also resolve `bun.lock` `.gitignore` decision.
- **Acceptance Criteria:** Tracked files strictly **≤ 990** (≥ 10 slots headroom below 1,000); `node --test server.test.js` passes; zero non-runtime docs return HTTP `200`.

### Batch B1 — Shared SDK Foundation & Contract Test Suite (WS1 — Mandatory Tier 1)
- **Objective:** Implement the provider-independent AuroMind Shared Platform SDK in **3 files**: `assets/sdk/auromind-sdk.js`, `assets/sdk/auromind-adapters.js`, and root `auromind-sdk.test.js`.
- **Scope:** All 9 platform interfaces (`Identity`, `GuestAccess`, `Auth`, `LocalPersistence`, `GameSaves`, `CloudSync`, `Entitlements`, `Analytics`, `RemoteConfig`), `AuroMindPlatformDB` + `auromind.platform.v1.guest` dual-store with Web Locks & `BroadcastChannel` concurrency protection, `NullProvider` defaults, and game-specific `GameStorageAdapter` + `GameMergeStrategy` for VAK, AuroMatch, and AuroMandala (plus observer descriptors for the 3 post-January games).
- **Acceptance Criteria:** `node --test auromind-sdk.test.js` passes 100% (covering all 9 identity lifecycle scenarios, empty-remote merge guard, domain-specific conflict detection for VAK/AuroMatch/AuroMandala, sign-out preservation, and zero external dependencies); `GET /auromind-sdk.test.js` returns HTTP `404`.

### Batch B2 — Portal Integration, Identity Lifecycle & Root SW Update (WS1 + WS3 — Mandatory Tier 1)
- **Objective:** Wire Portal to initialize the shared guest identity, fix the `Clear Cache` hazard, and update root `sw.js` for Portal offline SDK delivery.
- **Files Modified:** `index.html`, `assets/js/portal.js`, `sw.js`, `server.test.js`.
- **Acceptance Criteria:**
  - Portal initializes `guest_<uuid>` on first visit and preserves it across reloads and offline restarts.
  - Clicking Portal **`Clear Cache`** resets Portal UI preferences while **preserving** `auromind.platform.v1.guest` and `AuroMindPlatformDB` (verified in browser test).
  - Root `sw.js` precaches `56` assets (54 existing + 2 SDK files) while maintaining 100% `/games/*` isolation.

### Batch B3 — VAK Speech Control Integration & Offline SDK Delivery (WS4 — Mandatory Tier 1)
- **Objective:** Integrate `games/vak/` with `AuroMindSDK` while keeping all 1,368-level embedded corpora and `AuroVakDB` v1 intact.
- **Files Modified:** `games/vak/index.html`, `games/vak/sw.js`.
- **Acceptance Criteria:**
  - VAK receives the **exact same `guestId`** minted by Portal (both iframe and standalone).
  - Existing `AuroVakDB` and `vak_*` progress loads with 0 data loss; VAK purge lock does not delete shared `guestId`.
  - Cold offline launch of `/games/vak/` (standalone and iframe) loads `auromind-sdk.js` and `auromind-adapters.js` cleanly from `auro-vak-v*` cache with `0` failed requests.
  - SHA-256 verification confirms embedded corpus sections remain unmodified.

### Batch B4 — AuroMatch Integration & Offline SDK Delivery (WS4 — Mandatory Tier 1)
- **Objective:** Integrate `games/auromatch/` ES modules with `AuroMindSDK` while keeping `floraDatabase.js`, `Assets/**`, and `AuroMatchDB` v1 intact.
- **Files Modified:** `games/auromatch/index.html`, `games/auromatch/src/main.js`, `games/auromatch/src/controllers/storageAdapter.js`, `games/auromatch/src/controllers/entitlementManager.js`, `games/auromatch/sw.js`.
- **Acceptance Criteria:**
  - AuroMatch shares the exact `guestId` with Portal and VAK.
  - Existing `AuroMatchDB` saves, profiles, consecrations, and PBKDF2 backups work with 0 regressions; `executeAbsolutePurge()` preserves `AuroMindPlatformDB` and `auromind.platform.v1.guest`.
  - Cold offline launch of `/games/auromatch/` serves SDK scripts from `auro-match-v*` cache with `0` network errors.

### Batch B5 — AuroMandala Upstream Source Rebuild & Native Integration (WS4 — Mandatory Tier 1)
- **Prerequisite:** Access to AuroMandala's legitimate upstream React/Vite source repo.
- **Objective:** Integrate `AuroMindSDK` directly in AuroMandala's upstream source, bundle SDK cleanly with Workbox precaching, wrap `pranamandala_game_cache_v2` without breaking `version: 2` or the AES-GCM Sankalpa vault, and re-export verified assets into `games/auromandala/`.
- **Acceptance Criteria:**
  - Genuine in-game SDK integration (not host-page injection): AuroMandala shares exact `guestId` with Portal, VAK, and AuroMatch.
  - Existing `pranamandala_game_cache_v2` progress, strokes, sessions, and E2EE Sankalpa vault load with 0 regressions.
  - Cold offline standalone & iframe launch succeeds with `0` console/network errors and isolated Workbox caches.

### Batch S1 — Supabase Foundation, Schema & RLS Verification (WS2 — Target Tier 2)
- **Prerequisite:** Product Owner pre-provisioning confirmations (`OPEN_DECISIONS.md` §3).
- **Scope:** Provision Supabase project, apply PostgreSQL migrations (`user_profiles`, `guest_identity_links`, `game_saves`, `game_save_revisions`, `entitlements`, `purchase_receipts`, `analytics_events`, `remote_config`), `upsert_game_save_checked` RPC, revision-archive trigger, and automated RLS penetration tests (confirming cross-user isolation and browser write denial on `entitlements`/`purchase_receipts`).

### Batch S2 — Authentication & Guest-to-Account Linking (WS2 + WS1 — Target Tier 2)
- **Scope:** Implement `SupabaseAuthProvider` adapter, update `index.html` CSP `connect-src` for exact Supabase project origin, add optional Portal Sign-In / Sign-Out UI behind `authEnabled` flag, and verify `guest_identity_links` linking.
- **Acceptance Criteria:** Guest play works identically when signed out; sign-out never deletes local `guestId` or game saves; zero `SUPABASE_SERVICE_ROLE_KEY` strings anywhere in client repo.

### Batch S3 — Cloud Saves, Offline Outbox & 3-Game Merge Verification (WS2 + WS4 — Target Tier 2)
- **Scope:** Implement `SupabaseCloudSyncProvider` adapter, offline outbox queue, optimistic revision conflict handling, and conflict-resolution UI for VAK Speech Control, AuroMatch, and AuroMandala.
- **Acceptance Criteria:**
  - New account + existing guest progress → guest progress preserved and uploaded as revision `1` (never overwritten by empty cloud).
  - Concurrent divergent edits across two browsers trigger game-specific merge/conflict modal (sparks currency in VAK/AuroMatch; atomic canvas in AuroMandala) with pre-merge rollback backups intact.
  - Offline play queues changes and syncs cleanly upon reconnect.

### Batch S4 — Verified Entitlements, Payments, Analytics & Remote Config (WS2 + WS4 — Target Tier 2, Optional)
- **Scope:** Edge Functions for checkout/webhook verification (`purchase_receipts` → `entitlements`), `SupabaseEntitlementsProvider`, opt-in `SupabaseAnalyticsProvider`, and `SupabaseRemoteConfigProvider`.
- **Gate Rule:** Remains strictly feature-flagged OFF (`entitlementsEnabled: false`) unless full end-to-end payment/webhook/refund testing passes prior to launch freeze.

### Batch R1 — Three-Product Full Regression & Launch Readiness Gate (WS4 — Mandatory Pre-1 Jan 2027)
- **Objective:** Final cross-product verification across desktop, tablet, mobile, online, cold-offline, cross-tab, and upgrade scenarios for Portal + VAK Speech Control + AuroMatch + AuroMandala (plus non-regression smoke check that Word Riddle, VAK Living Sanctuary, and AuroBlocks remain intact).

---

## 3. Master Regression & Release Validation Checklist

| Gate Category | Mandatory Verification Evidence Required Before Marking Complete |
|---|---|
| **Unit & Contract Tests** | `node --test server.test.js auromind-sdk.test.js` — 100% pass, `0` skipped. |
| **Lint & Build** | `npm run lint` and `npm run build` exit `0`; `server.js` returns `404` on all internal/test/audit/doc paths. |
| **Identity Continuity** | Same `guestId` verified across Portal → VAK → AuroMatch → AuroMandala; survives browser restart, multi-tab race, LS-only clear, IDB-only clear, and Portal `Clear Cache`. |
| **Offline PWA Matrix** | For Portal + all 3 launch games: first-time install → online reload → toggle offline → cold reload (both Portal iframe AND direct standalone URL) → `0` failed SDK/core asset requests. |
| **Zero Data Loss** | Pre-upgrade seeded saves in `AuroVakDB`, `AuroMatchDB`, and `pranamandala_game_cache_v2` load intact post-upgrade with `0` schema errors. |
| **Security & Hardening** | `0` service-role keys or hardcoded passcodes in client files; strict `window.location.origin` on `postMessage`; RLS negative tests pass (if Tier 2 enabled); SW cache-prefix isolation verified. |
| **Repository Budget** | Tracked file count strictly `< 1,000` (target `≤ 995`) verified against Git tree before syncing to GitHub. |
