# B18-B1 — Comprehensive Platform Remediation Blueprint
## Consolidated P1 + P2 + P3 Architecture and Engineering Design

**Author:** AuroMind Platform Architecture Team  
**Date:** November 21, 2026  
**Canonical Workspace:** `C:\AuroMindPortal`  
**Active Git Branch:** `dev/studio-integration`  
**Baseline HEAD Commit:** `b6ccc860bb7d38a70ef678049a9588b8b73c40aa`  
**Target Release:** January 1, 2027  
**Status:** ARCHITECTURAL DESIGN & BLUEPRINT ONLY (Zero Source Code Changes)  

---

## 1. Executive Summary & Mission Scope

This document establishes the master architectural blueprint for resolving **all findings F-01 through F-09** identified in the B18-A3 Critical Architecture Clarification & Safety Review. 

Rather than fragmenting platform remediation into disjointed batches or deferring reliability and operational issues, this blueprint delivers a unified, dependency-aware engineering specification covering all release-critical (P1), reliability/contract (P2), and operational/security (P3) gaps in a single, coordinated framework.

### Core Architectural Laws Preserved
1. **One Browser Profile = One Player Identity:** A single RFC-4122 UUIDv4 guest identity per browser profile, shared identically across all tabs and games via Web Locks and BroadcastChannel. No in-app multiple profiles, profile selectors, or session-boundary dialogs.
2. **Local-First & 100% Offline Gameplay:** Basic gameplay across all six launch titles never depends on Supabase or external cloud services. Cloud synchronization is strictly an optional backup enhancement.
3. **Sacred Data Sovereignty:** The VAK 1,368-level speech training corpus (SHA-256 `9fdb38260300...`) and the Flora Botanical Database (2,002,176 B, SHA-256 `689d035c...`) remain immutable static assets.
4. **Sankalpa Vault Local-Only E2EE:** The AuroMandala contemplation vault is strictly local-only (`cloudSyncEligible: false`) with Web Crypto AES-GCM encryption, excluded from cloud sync and telemetry.
5. **AuroMandala Artwork Versioned Preservation:** Creative artwork uses a versioned collection model with tombstone deletions and fork-on-conflict recovery, completely eliminating blanket cache overwrites.
6. **ADR Review Status:** All ten Architecture Decision Records (ADR-01 through ADR-10) remain **PENDING OWNER APPROVAL**.

---

## 2. Blueprint Master Index & Deliverable Architecture

The remediation blueprint is organized into eight specialized design documents:

```
C:\AuroMindPortal\
├── B18_B1_COMPREHENSIVE_REMEDIATION_BLUEPRINT.md            <-- (This Document) Master Architecture & Sequencing
├── B18_B1_SHARED_SDK_AND_GAME_ADAPTER_CONTRACTS.md          <-- F-03: Game Adapters & Platform Interfaces
├── B18_B1_SAVE_INTEGRITY_AND_MERGE_DESIGN.md                <-- F-02 & F-07: SHA-256 Hashing & Domain Merges
├── B18_B1_AUROMANDALA_ARTWORK_PROTECTION_DESIGN.md          <-- F-01: Versioned Artwork Preservation Engine
├── B18_B1_ACHIEVEMENTS_AND_TELEMETRY_CONTRACTS.md          <-- F-06 & F-08: Achievements API & Bounded Telemetry
├── B18_B1_STORAGE_AND_CSP_SECURITY_DESIGN.md               <-- F-04, F-05, F-09: Storage Resilience, Auto-Heal, CSP
├── B18_B1_ACCEPTANCE_AND_REGRESSION_TEST_PLAN.md            <-- Comprehensive Acceptance & Regression Criteria
└── B18_B1_RISK_DEPENDENCY_AND_PHASE_REGISTER.md            <-- Phasing, Dependencies & Rollback Procedures
```

---

## 3. Findings Coverage & Resolution Matrix (F-01 through F-09)

| ID | Sev | Category | Title | Inspected Location | Root Cause | Proposed Remediation Summary | Target Phase |
|:---:|:---:|:---|:---|:---|:---|:---|:---:|
| **F-01** | **P1** | Data Loss | **AuroMandala Artwork Overwrite** | `games/auromandala/assets/auromandala-sdk-bridge.js` | `exportEnvelope` omitted `savedArtworks` from checksum; `applyEnvelope` executed blanket `localStorage.setItem` overwrite. | Implement Versioned Artwork Model with UUIDs, monotonic revisions, tombstone deletions, and non-destructive collection merging. | **B18-B1** |
| **F-02** | **P1** | Integrity | **Save Integrity & Weak Checksums** | `games/auroblocks/assets/auroblocks-sdk-bridge.js`, `games/auromatch/src/controllers/storageAdapter.js` | Ad-hoc string concatenations (`blocks_${highScore}_...`) miss internal payload mutations (stage scores, reflections). | Standardize all six games on canonical JSON normalization and deterministic SHA-256 Web Crypto checksums. | **B18-B1** |
| **F-03** | **P1** | Contract | **Missing Native Game Adapters** | `games/vak/`, `games/word-riddle/`, `games/vak-living-sanctuary/` | Games rely on inlined local storage calls and iframe messages without standalone ES module adapters. | Author standalone ES module adapter bridges for VAK, Word Riddle, and VAK Sanctuary adhering to `GameStorageAdapter` v1. | **B18-B1** |
| **F-04** | **P2** | Reliability | **Browser Storage Resilience** | `assets/sdk/auromind-sdk.js`, `assets/js/portal.js` | SDK lacks persistent storage requests; vulnerable to Safari 7-day ITP eviction and mobile disk pressure. | Implement non-blocking `navigator.storage.persist()` request and structured storage health telemetry. | **B18-B1** |
| **F-05** | **P2** | Reliability | **AuroMatch Auto-Healing Defect** | `games/auromatch/src/controllers/storageAdapter.js` | `autoHealFromIndexedDB` checks only key existence (`hasLocal`), aborting even if localStorage is empty/corrupt. | Refactor auto-heal to validate payload structure (`completedLevelsCount > 0`); add bidirectional IDB/LS healing. | **B18-B1** |
| **F-06** | **P2** | Contract | **Achievements SDK Contract** | `assets/sdk/auromind-sdk.js` | Platform lacks formal `sdk.achievements` service namespace; stats tracked loosely in player profile. | Author formal `sdk.achievements` API with offline-first persistence, idempotent unlocks, and save envelope sync. | **B18-B1** |
| **F-07** | **P2** | Data Loss | **Undefined Merge Policies** | `assets/sdk/auromind-adapters.js`, `games/*/` | Games lack bespoke domain merge strategies, forcing unnecessary fallback to user-choice conflict modals. | Define explicit domain merge strategies for all six games (union of levels, max high scores, append-only artworks). | **B18-B1** |
| **F-08** | **P3** | Operations | **Telemetry Queue Overflow** | `assets/sdk/auromind-sdk.js` | Memory queue caps at 200 events, dropping telemetry arbitrarily during prolonged offline play. | Implement tiered priority queue (CRITICAL, ENGAGEMENT, DIAGNOSTIC) with bounded ring buffer and oldest-diagnostic eviction. | **B18-B1** |
| **F-09** | **P3** | Security | **Production CSP Consistency** | `server.js`, hosting deployment paths | Strict CSP in `server.js` is not replicated across static hosting environments (Vercel, Pages). | Standardize production CSP across Express, Vercel headers, and Cloudflare `_headers`, preserving strict script sandboxing. | **B18-B1 / B18-C** |

---

## 4. Consolidated Remediation Architecture

The diagram below illustrates how all platform subsystems interact harmoniously while strictly enforcing local-first execution, data sovereignty, and security boundaries:

```
+-------------------------------------------------------------------------------------------------------------------------+
|                                              BROWSER CLIENT RUNTIME                                                     |
|                                                                                                                         |
|  +-------------------------------------------------------------------------------------------------------------------+  |
|  |                                          ONE BROWSER PROFILE IDENTITY                                             |  |
|  |  AuroMindPlatformDB ('platform_meta' / 'guest_identity') <---> localStorage ('auromind.platform.v1.guest')         |  |
|  |  Coordinated via Web Locks ('auromind-platform-guest-init') + BroadcastChannel ('auromind_platform_bus')           |  |
|  +-------------------------------------------------------------------------------------------------------------------+  |
|                                                              |                                                          |
|                                                              v                                                          |
|  +-------------------------------------------------------------------------------------------------------------------+  |
|  |                                            AUROMIND SHARED SDK CORE                                               |  |
|  |  +-------------------+  +-------------------+  +-------------------+  +-------------------+  +--------------------+  |  |
|  |  |  identityService  |  |  storageService   |  |  syncService      |  |  achievementsSvc  |  |  telemetryService  |  |  |
|  |  |  (UUIDv4 State)   |  |  (Dual IDB + LS)  |  |  (Outbox Queue)   |  |  (Offline Engine) |  |  (Priority Queue)  |  |  |
|  |  +-------------------+  +-------------------+  +-------------------+  +-------------------+  +--------------------+  |  |
|  |  +-------------------+  +-------------------+  +-------------------+  +-------------------+  +--------------------+  |  |
|  |  |  entitlementsSvc  |  |  configService    |  |  loggingService   |  |  accessService    |  |  playerService     |  |  |
|  |  |  (Theme Passes)   |  |  (Remote Flags)   |  |  (Diagnostics)    |  |  (Offline Gating) |  |  (Profile & Prefs) |  |  |
|  |  +-------------------+  +-------------------+  +-------------------+  +-------------------+  +--------------------+  |  |
|  +-------------------------------------------------------------------------------------------------------------------+  |
|                                                              |                                                          |
|                                                              v                                                          |
|  +-------------------------------------------------------------------------------------------------------------------+  |
|  |                                       STANDARDIZED GAME ADAPTER REGISTRY                                          |  |
|  |  Enforces: GameStorageAdapter Contract v1 | Canonical SHA-256 Checksumming | Bespoke Non-Destructive Merge Strategies  |  |
|  +-------------------------------------------------------------------------------------------------------------------+  |
|          |                  |                  |                  |                  |                  |               |
|          v                  v                  v                  v                  v                  v               |
|    +------------+    +------------+    +---------------+    +------------+    +---------------+    +------------+       |
|    | AuroBlocks |    | AuroMatch  |    |  AuroMandala  |    | VAK Rhythm |    |  Word Riddle  |    | VAK Sanct. |       |
|    | (LS Engine)|    | (IDB + LS) |    |  (LS Engine)  |    | (LS Engine)|    |  (LS Engine)  |    | (LS Engine)|       |
|    | High Score |    | Levels/Refl|    | Stages/Artworks    | 1368 Corpus|    | Solved Riddles|    | Codex Unl. |       |
|    +------------+    +------------+    +---------------+    +------------+    +---------------+    +------------+       |
|                                                |                                                                        |
|                                                +---> [Sankalpa E2EE Vault] (LOCAL-ONLY; NEVER SYNCED)                   |
|                                                +---> [Versioned Artworks] (UUIDs, Revisions, Tombstones, Fork-Merge)    |
+-------------------------------------------------------------------------------------------------------------------------+
                                                               |
                                            (Optional Cloud Sync - Consent Only)
                                                               |
                                                               v
+-------------------------------------------------------------------------------------------------------------------------+
|                                              FUTURE SUPABASE CLOUD BACKEND                                              |
|                                                                                                                         |
|       PostgreSQL RPC: upsert_game_save_checked (Atomic Optimistic Locking via expectedRevision vs baseRevision)        |
|       Row Level Security: auth.uid() = user_id on game_saves, entitlements, telemetry_events                            |
|       STRICTLY PROHIBITED: Sankalpa Vault Data | Passphrases | Unconsented Analytics | VAK Corpus | Flora DB             |
+-------------------------------------------------------------------------------------------------------------------------+
```

---

## 5. Phasing & Scope Allocation

To guarantee zero scope creep and preserve stability, remediation is partitioned into four clear phases:

```
+---------------------------------------------------------------------------------------------------+
|                                     PHASE ALLOCATION MATRIX                                       |
+---------------------------------------------------------------------------------------------------+
| Phase B18-B1 | Shared SDK & Local Architecture Remediation (ALL 9 FINDINGS F-01 to F-09 DESIGN)   |
| (Current)    | - Complete architectural designs, contracts, interfaces, and test plans.           |
|              | - Zero code changes; zero cloud provisioning; zero schema migrations.              |
+--------------+------------------------------------------------------------------------------------+
| Phase B18-B  | Local Application Implementation & Regression Testing                              |
| (Next)       | - Implement F-01 to F-09 in client codebase.                                       |
|              | - Run 251 existing tests + new test suites; verify 100% offline pass rate.         |
|              | - Zero backend activation; zero Supabase provisioning.                             |
+--------------+------------------------------------------------------------------------------------+
| Phase B18-C  | Controlled Backend Provisioning & Activation                                       |
|              | - Provision Supabase project via CLI; apply PostgreSQL migrations & RLS policies.  |
|              | - Deploy Edge Functions (sync, telemetry, metrics, cleanup).                        |
|              | - Live end-to-end multi-device verification.                                        |
+--------------+------------------------------------------------------------------------------------+
| Deferred     | Genuinely Non-Blocking Enhancements (Post-Launch / B19)                            |
|              | - Payment gateway webhook activation (Razorpay/Stripe).                            |
|              | - Advanced audio synthesizer bus synchronization across iframes.                    |
+---------------------------------------------------------------------------------------------------+
```

---

## 6. Dependency-Aware Implementation Sequencing

The implementation sequence enforces a strict topological order where foundation services are hardened before consumers depend on them:

```
Step 1: Save Integrity Core (F-02) 
  └── Standardize canonical JSON serialization & SHA-256 Web Crypto hashing in SDK core.
       │
       ├──> Step 2: Storage Resilience & Auto-Heal (F-04, F-05)
       │      └── Add navigator.storage.persist() & fix AuroMatch auto-heal asymmetry.
       │
       ├──> Step 3: Game Adapters & Bridges (F-03)
       │      └── Author standalone native adapter bridges for VAK, Word Riddle, VAK Sanctuary.
       │
       ├──> Step 4: AuroMandala Artwork Engine (F-01)
       │      └── Implement versioned artwork model (UUIDs, revisions, tombstones, fork-merge).
       │
       ├──> Step 5: Domain Merge Strategies (F-07)
       │      └── Register bespoke merge logic for AuroBlocks, AuroMatch, Word Riddle, etc.
       │
       ├──> Step 6: Platform Achievements API (F-06)
       │      └── Implement sdk.achievements service with offline persistence & envelope sync.
       │
       ├──> Step 7: Bounded Telemetry Queue (F-08)
       │      └── Implement prioritized 3-tier queue with overflow protection & zero-PII gating.
       │
       └──> Step 8: Production CSP Hardening (F-09)
              └── Align deployment header configs with server.js without weakening sandboxing.
```

---

## 7. Backward Compatibility & Migration Guarantees

Every remediation design in this blueprint enforces strict backward compatibility:
1. **Existing Save Data Immunity:** Legacy saves stored in `localStorage` or `IndexedDB` (e.g. `auro_match_user`, `auroblocks_player_save_v1`, `pranamandala_game_cache_v2`) are loaded without modification.
2. **Checksum Migration:** When a game with a legacy string checksum (e.g. `'match_18_50'`) is loaded, the adapter automatically upgrades the checksum to canonical SHA-256 upon the next save cycle.
3. **Artwork Preservation:** Existing unversioned artworks in `savedArtworks` are assigned fresh RFC-4122 UUIDs and `version: 1` during the first B18-B load, ensuring legacy creations seamlessly enter the versioned lifecycle.
4. **Zero Forced Registration:** Unauthenticated guest players continue enjoying 100% full gameplay without ever being prompted to sign up or connect to the internet.
