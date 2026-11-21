# B18-A — Shared Services Readiness Gap Register

**Author:** AuroMind Platform Architecture Team  
**Date:** November 21, 2026  
**Canonical Workspace:** `C:\AuroMindPortal`  
**Active Git Branch:** `dev/studio-integration`  
**Baseline HEAD Commit:** `b6ccc860bb7d38a70ef678049a9588b8b73c40aa`  
**Target Release:** January 1, 2027  

---

## 1. Executive Summary

This register tracks all architectural gaps, missing abstractions, interface inconsistencies, and implementation prerequisites identified during the B18-A shared services readiness assessment.

Resolving these gaps is required to transition the platform from **READY WITH CONDITIONS** to **FULLY READY FOR BACKEND ACTIVATION**.

---

## 2. Platform Readiness Gap Register

| Gap ID | Category | Description | Severity | Affected Files / Components | Target Batch | Blocking B18-B? |
|:---:|:---|:---|:---:|:---|:---:|:---:|
| **GAP-01** | **Adapter Standardization** | VAK, Word Riddle, and VAK Living Sanctuary lack dedicated standalone adapter bridge ES modules in `games/*/assets/`. | **HIGH** | `games/vak/`, `games/word-riddle/`, `games/vak-living-sanctuary/` | **B18-B** | **YES** |
| **GAP-02** | **Multi-User Isolation** | Shared family devices lack an explicit "Switch Profile / Log Out & Clean Local State" workflow, risking save contamination. | **HIGH** | `assets/js/portal.js`, `assets/sdk/auromind-sdk.js` | **B18-C** | NO (B18-C) |
| **GAP-03** | **Achievements Abstraction** | Cross-game achievements lack a formal `sdk.achievements` service and schema; currently loosely tracked in player stats. | **MEDIUM** | `assets/sdk/auromind-sdk.js` | **B18-B** | NO |
| **GAP-04** | **Merge Strategy Contracts** | While `resolveGameMerge` defines non-destructive fallback invariants, games currently lack bespoke domain merge strategies. | **MEDIUM** | `assets/sdk/auromind-adapters.js`, `games/*/` | **B18-B** | NO |
| **GAP-05** | **Unified Audio Bus Bridge** | Portal ambient audio and game-level Web Audio synthesizers manage audio contexts independently without a shared master mute bus. | **LOW** | `assets/js/portal.js`, `games/auromatch/src/audio/synthesizer.js` | **B19** | NO |
| **GAP-06** | **Cloud Provisioning Gate** | Supabase database, tables, RLS policies, and Edge Functions are not yet provisioned in production. | **HIGH** | `supabase/migrations/`, `supabase/functions/` | **B18-C** | NO (Design Ready) |
| **GAP-07** | **Commercial Gate Alignment** | Commercial gate is disabled for beta; client-side payment tokens are disabled, but server purchase webhook is unprovisioned. | **LOW** | `games/auromatch/src/controllers/entitlementManager.js`, `assets/sdk/auromind-sdk.js` | **B19** | NO |

---

## 3. Gap Detail & Remediation Plan

### GAP-01: Standardize Game Adapters Across All Six Games
- **Current State:**
  - AuroMatch implements `createAuroMatchGameAdapter()` directly in its storage adapter ([storageAdapter.js](file:///C:/AuroMindPortal/games/auromatch/src/controllers/storageAdapter.js#L574-L658)).
  - AuroMandala implements `createAuroMandalaGameAdapter()` in [auromandala-sdk-bridge.js](file:///C:/AuroMindPortal/games/auromandala/assets/auromandala-sdk-bridge.js).
  - AuroBlocks implements `createAuroBlocksGameAdapter()` in [auroblocks-sdk-bridge.js](file:///C:/AuroMindPortal/games/auroblocks/assets/auroblocks-sdk-bridge.js).
  - VAK, Word Riddle, and VAK Living Sanctuary persist save state into their own localStorage keys (`auro_vak_user`, `word_discovery_save_v1`, `vak_sanctuary_codex_v1`), but their adapter registration is handled implicitly by the portal rather than by dedicated, testable game adapter modules.
- **Remediation Required (B18-B):**
  Create dedicated adapter bridge modules for the remaining three games:
  1. `games/vak/assets/vak-sdk-bridge.js` -> `createVakGameAdapter()`
  2. `games/word-riddle/assets/word-riddle-sdk-bridge.js` -> `createWordRiddleGameAdapter()`
  3. `games/vak-living-sanctuary/assets/vak-living-sanctuary-sdk-bridge.js` -> `createVakLivingSanctuaryGameAdapter()`
- **Impact:** Ensures 100% uniformity across all six games, allowing the sync service to export, validate, and apply save envelopes identically.

---

### GAP-02: Multi-User Local Storage Scoping & Partitioning
- **Current State:**
  When a player logs out of a registered Supabase account via `sdk.auth.signOut()`, the active session JWT is cleared, but local save keys in `localStorage` and `IndexedDB` remain intact to prevent accidental guest data loss. If a second user immediately begins playing on the same device as a guest, they inherit the first user's local progression.
- **Remediation Required (B18-C):**
  1. Implement a **Sign-Out Prompt Dialog** in the portal UI:
     - *"Do you want to keep your progress on this device for guest play, or clear this device for a new player?"*
  2. In `upgradeGuestToAccount()`, if the target cloud account already contains cloud saves differing from the local device saves, trigger `ADR-06` user conflict resolution modal rather than silently merging.
- **Impact:** Protects player privacy and prevents cross-player data contamination on shared or family devices.

---

### GAP-03: Formalization of Cross-Game Achievements Service
- **Current State:**
  Cross-game stats are stored in `sdk.player.stats` (e.g. `gamesPlayed`, `sessionsCount`, `totalTimePlayed`). There is no dedicated `sdk.achievements` namespace to track cross-game milestones (e.g. "Ponderer: Solved 5 Word Riddles and matched 10 AuroMatch tiles").
- **Remediation Required (B18-B):**
  1. Add an `achievements` service namespace to `assets/sdk/auromind-sdk.js`.
  2. Define an `ACHIEVEMENTS_REGISTRY` mapping milestone IDs, criteria, and unlocked timestamps.
  3. Store unlocked achievements in `auromind.platform.v1.achievements` and include them in the cloud sync envelope.
- **Impact:** Unlocks compelling cross-game meta-progression without touching core game balance.

---

### GAP-04: Bespoke Game-Specific Merge Strategies
- **Current State:**
  `assets/sdk/auromind-adapters.js` implements `resolveGameMerge()`, enforcing Invariants 1–3 (empty handling, identical checksums). However, when two differing non-empty saves collide, the SDK currently falls back to `conflict_requires_user_choice` because games have not registered custom `GameMergeStrategy` objects.
- **Remediation Required (B18-B):**
  Implement domain-specific merge strategies for games where automated non-destructive union is safe:
  - *AuroMatch:* Union `completedLevelIds` sets, take `max(lotusPetalCount)`.
  - *AuroBlocks:* Take `max(highScore)`, union `unlockedStages`.
  - *Word Riddle:* Union `solvedRiddles` array.
- **Impact:** Minimizes disruptive "Conflict: Pick Cloud or Local" modals by automatically and safely combining progress wherever mathematically valid.

---

### GAP-05: Unified Audio Bus & Master Mute Coordination
- **Current State:**
  The portal manages ambient music volume via `auromind_ambient_volume`. Individual games (e.g. AuroMatch raga/gong synth) manage their own internal Web Audio volumes. Muting in the portal does not pause or mute in-game audio synthesis.
- **Remediation Required (B19):**
  Introduce an `AUROMIND_SYNC_AUDIO_PREFERENCES` postMessage contract allowing the portal to broadcast master mute and volume level changes into active game iframes.
- **Impact:** Delivers a harmonious, accessible acoustic experience across the entire sanctuary.

---

## 4. Phase-Gating Matrix: Prerequisites for B18-B & B18-C

```
+-----------------------------------------------------------------------------------------+
|                                    B18-A (Current)                                      |
|  - Full Shared Services Architecture Assessment                                         |
|  - Complete Decisions, Risk, and Data Ownership Registers Documented                    |
|  - Strict Zero-Backend / Zero-Code-Change Constraint Honored                            |
+-----------------------------------------------------------------------------------------+
                                            |
                                            v
                                  [ Owner Approval ]
                                            |
                                            v
+-----------------------------------------------------------------------------------------+
|                                    B18-B (Next)                                         |
|  - Author Standardized Adapter Bridges for VAK, Word Riddle, VAK Sanctuary (GAP-01)     |
|  - Formalize Cross-Game Achievements Service in SDK (GAP-03)                            |
|  - Implement Game Merge Strategies for AuroMatch, AuroBlocks, Word Riddle (GAP-04)      |
|  - Validate 100% Offline Regression Suite                                               |
+-----------------------------------------------------------------------------------------+
                                            |
                                            v
+-----------------------------------------------------------------------------------------+
|                                    B18-C (Backend)                                      |
|  - Provision Supabase Project & Execute Verified SQL Migrations                         |
|  - Apply Strict Row Level Security Policies (SEC-04)                                    |
|  - Deploy Edge Functions (ingest-telemetry, sync-save, owner-metrics)                   |
|  - Implement Multi-User Sign-Out Partitioning (GAP-02)                                  |
|  - End-to-End Live Integration Validation                                               |
+-----------------------------------------------------------------------------------------+
```
