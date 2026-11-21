# AuroMasti B18-B1 — Architecture Approval & Acceptance Gates
## Formal Quality Gates, Verification Checkpoints, and Owner Signoff Framework

- **Document Version:** 1.0.0
- **Batch Reference:** B18-B1 Formal Architecture Decision Review
- **Canonical Workspace:** `C:\AuroMindPortal`
- **Target Release:** January 1, 2027
- **Governance Mandate:** All 10 original ADRs remain **PENDING OWNER APPROVAL**. This document defines the formal quality gates, verification checkpoints, and signoff criteria required for owner authorization.

---

## 1. Executive Summary & Governance Gate Purpose

To ensure that AuroMasti maintains absolute software stability, offline resilience, and player data protection, engineering execution is governed by formal **Architecture Acceptance Gates**. 

No engineering transition from **Phase B18-B1** (SDK & Contract Implementation) to **Phase B18-B** (Supabase Schema & Security Design) or **Phase B18-C** (Controlled Cloud Activation) may occur without satisfying the gates detailed below and receiving explicit Product Owner signoff.

---

## 2. Master Architecture Acceptance Gates

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                     AUROMASTI ARCHITECTURE ACCEPTANCE GATES                     │
├─────────┬──────────────────────────────────────────┬──────────────┬─────────────┤
│ GATE ID │ QUALITY VERIFICATION FOCUS               │ TARGET PHASE │ STATUS      │
├─────────┼──────────────────────────────────────────┼──────────────┼─────────────┤
│ GATE-01 │ 100% Offline Gameplay Autonomy           │ B18-B1       │ READY       │
│ GATE-02 │ Sacred Invariant Cryptographic Integrity │ B18-B1       │ VERIFIED    │
│ GATE-03 │ AuroMandala Zero-Loss Artwork Protection │ B18-B1       │ READY       │
│ GATE-04 │ Storage Eviction Defense & Auto-Healing  │ B18-B1       │ READY       │
│ GATE-05 │ Canonical Cryptographic Checksum Engine  │ B18-B1       │ READY       │
│ GATE-06 │ Standalone Game Bridge Decoupling        │ B18-B1       │ READY       │
│ GATE-07 │ Shared SDK Achievements Service          │ B18-B1       │ READY       │
│ GATE-08 │ 3-Tier Telemetry Queue & Privacy Filter  │ B18-B1       │ READY       │
│ GATE-09 │ Unified Multi-Host Security Headers (CSP)│ B18-B1       │ READY       │
│ GATE-10 │ Full Baseline Regression Validation      │ B18-B1       │ VERIFIED    │
└─────────┴──────────────────────────────────────────┴──────────────┴─────────────┘
```

---

## 3. Deep Gate Verification Specifications

### GATE-01: 100% Offline Gameplay Autonomy
- **Governing ADRs:** ADR-01, ADR-03, ADR-07
- **Verification Criteria:**
  - With outbound network blocked (`navigator.onLine = false` or air-gapped test environment), the portal and all six launch games boot, initialize guest identity, save progress, and execute gameplay loops with zero errors.
  - Zero network calls to Supabase, Firebase, or external CDNs are attempted during offline play.
  - Standalone game URLs (e.g. `games/auromatch/index.html`) load and function offline via local mock bridge.

### GATE-02: Sacred Invariant Cryptographic Integrity
- **Governing ADRs:** ADR-02, ADR-07, ADR-09
- **Verification Criteria:**
  - **VAK Speech Corpus:** [speech_training_corpus.json](file:///C:/AuroMindPortal/games/vak/assets/data/speech_training_corpus.json) must match SHA-256 hash `9fdb3826030049c9eab183479bcb7fe29304b3ea08d045c8c67f1cfd4d77da09` exactly (1,368 levels).
  - **Flora Botanical Database:** [flora_database.json](file:///C:/AuroMindPortal/games/vak-living-sanctuary/assets/data/flora_database.json) must measure exactly 2,002,176 bytes, 46,321 LF lines, and match SHA-256 hash `689d035cd52abd8d342528d8c5f61f298916b8052b8287450be4931cf8ae1a3a`.
  - **Sankalpa Vault:** Verified marked as `cloudSyncEligible: false` and `localOnlyVaults: ['sankalpa_e2ee_vault']`. Zero cloud transmission or telemetry ingestion permitted.

### GATE-03: AuroMandala Zero-Loss Artwork Protection
- **Governing ADRs:** ADR-02, ADR-06
- **Verification Criteria:**
  - Save schema migrates to UUIDv4 map with monotonic revisions.
  - When cloud sync encounters a conflicting artwork of the same ID with different strokes, it forks the incoming copy into a new artwork record with title `"(Cloud Copy)"`.
  - Locally created mandalas are never deleted or overwritten during merge operations.
  - Soft deletions (`deleted: true`) prevent deleted mandalas from being revived by stale remote snapshots.

### GATE-04: Storage Eviction Defense & Auto-Healing
- **Governing ADRs:** ADR-01, ADR-07
- **Verification Criteria:**
  - SDK invokes `navigator.storage.persist()` non-blockingly during initialization.
  - Quota estimate exceeding 80% triggers CRITICAL telemetry warning.
  - In AuroMatch, corrupted or empty `localStorage` string `{}` cleanly recovers level progress from valid IndexedDB.
  - Clearing IndexedDB while `localStorage` is valid cleanly restores IndexedDB without data loss.

### GATE-05: Canonical Cryptographic Checksum Engine
- **Governing ADRs:** ADR-02, ADR-05
- **Verification Criteria:**
  - Web Crypto SHA-256 hashes generated over canonically sorted JSON payloads.
  - Mutating object key order does NOT change the hash.
  - Mutating deep gameplay progress changes the hash.
  - Mutating transport metadata (`clientUpdatedAt`, `baseRevision`) does NOT change the hash.

### GATE-06: Standalone Game Bridge Decoupling
- **Governing ADRs:** ADR-02, ADR-03, ADR-10
- **Verification Criteria:**
  - Dedicated bridge modules implemented for VAK, Word Riddle, and VAK Sanctuary.
  - Zero cross-game `localStorage` key bleeding.
  - Standalone execution works seamlessly without portal container.

### GATE-07: Shared SDK Achievements Service
- **Governing ADRs:** ADR-02, ADR-03
- **Verification Criteria:**
  - `sdk.achievements` provides typed `init()`, `unlock()`, `incrementProgress()`, `getAllAchievements()`.
  - Calling `unlock()` repeatedly for the same achievement is strictly idempotent (zero duplicate events).
  - Cloud sync applies monotonic union (Max Progress, Earliest Unlock Time).

### GATE-08: 3-Tier Telemetry Queue & Privacy Filter
- **Governing ADRs:** ADR-03, ADR-09
- **Verification Criteria:**
  - Queue capped at 500 events; overflow evicts DIAGNOSTIC events first, then ENGAGEMENT events.
  - CRITICAL events are never dropped and survive tab reloads via IndexedDB buffering.
  - Automated privacy filter strips all occurrences of `sankalpa`, `intention`, journal text, and raw speech audio.

### GATE-09: Unified Multi-Host Security Headers (CSP)
- **Governing ADRs:** ADR-07, ADR-10
- **Verification Criteria:**
  - Exact CSP directives matching `server.js` deployed across `vercel.json`, `_headers` (Cloudflare), and `netlify.toml`.
  - `frame-ancestors 'self'` prevents external clickjacking.
  - `object-src 'none'` blocks plugins.

### GATE-10: Full Baseline Regression Validation
- **Governing ADRs:** Platform Baseline
- **Verification Criteria:**
  - All 251 automated regression tests pass with 0 failures and 0 warnings.
  - All E2E Playwright tests (theatre iframe, Senior Mode, Service Worker) pass cleanly.

---

## 4. Rollback Strategies & Feature Flag Boundaries

To ensure zero risk of platform destabilization during Phase B18-B1 implementation:
1. **Feature Flags in `backend-config.js`:**
   ```javascript
   export const FEATURE_FLAGS = {
     ENABLE_CRYPTO_CHECKSUM: true,       // Falls back to string hash if Web Crypto unavailable
     ENABLE_STORAGE_PERSISTENCE: true,   // Gracefully skips if navigator.storage unsupported
     ENABLE_ROBUST_AUTOHEAL: true,       // Falls back to legacy recovery if false
     ENABLE_ACHIEVEMENTS_SERVICE: true,  // Idempotent local achievements
     ENABLE_PRIORITIZED_TELEMETRY: true, // 3-tier queue with privacy filter
     COMMERCIAL_GATE_ENABLED: false,     // 100% free beta for Jan 1, 2027 launch
     ENABLE_CLOUD_SYNC: false            // Cloud sync remains disabled until B18-C
   };
   ```
2. **Granular File-Level Rollback:**
   Each game bridge and SDK module is self-contained. If an individual adapter encounters unexpected regressions, it can be reverted via Git checkout without affecting any other game.

---

## 5. Formal Signoff Block for Product Owner Review

```
=================================================================================
                    AUROMASTI B18-B1 ARCHITECTURAL SIGNOFF
=================================================================================

The undersigned Product Owner hereby reviews the formal Architecture Decision 
Review for ADR-01 through ADR-10, the complete finding traceability, and the 
architecture acceptance gates.

[ ] APPROVED: Proceed to Phase B18-B1 Shared Services SDK Remediation & Adapter
    Implementation.
[ ] APPROVED WITH CONDITIONS: Proceed subject to attached owner stipulations.
[ ] REJECTED: Return to architecture review with owner feedback.

Product Owner Signature: ________________________________________________________

Date: ________________________
=================================================================================
```
