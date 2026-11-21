# AuroMasti B18-B1 — Master Implementation Execution Plan
## Implementation Roadmap: Zero-Deferred Findings, Six Games, Shared SDK, January 1, 2027 Release

- **Document Version:** 1.0.0
- **Batch Reference:** B18-B1 Master Implementation Execution Plan
- **Canonical Workspace:** `C:\AuroMindPortal`
- **Active Git Branch:** `dev/studio-integration`
- **Baseline HEAD Commit:** `b6ccc860bb7d38a70ef678049a9588b8b73c40aa`
- **Target Platform Release:** January 1, 2027
- **Governance Mandate:** All 10 original ADRs remain **PENDING OWNER APPROVAL**. This plan is 100% implementation-ready and will execute immediately upon owner authorization. Zero application code modifications have been made during this planning phase.

---

## 1. Executive Summary & Mission Scope

The objective of **Phase B18-B1 Implementation** is to execute the complete client-side remediation of the AuroMind Shared Services SDK, harden local storage and save integrity across all six launch titles, author missing game adapter bridges, enforce the sacred artwork protection policy for AuroMandala, formalize offline achievements and telemetry, and synchronize production Content Security Policies.

This execution plan operationalizes all findings (**F-01 through F-09**) and architecture gaps (**GAP-01 through GAP-06**) established in B18-A3 and clarified in the B18-B1 design packages. In accordance with the Product Owner's strict governance:
1. **Zero Deferred Findings:** Every P1, P2, and P3 finding has a dedicated implementation task and automated verification gate. No finding is postponed.
2. **One Browser Profile = One Persistent Player Identity:** In-app player switching or profile selectors are strictly forbidden.
3. **Local Operational Authority:** The platform is 100% operational offline. Cloud services (Supabase) remain strictly decoupled and un-provisioned until Phase B18-C.
4. **Sacred Data Asset Immutability:** VAK Speech Training Corpus, Flora Botanical Database, and Sankalpa Vault E2EE boundaries are cryptographically protected against byte drift.
5. **Commercial Engine Readiness:** The purchase and entitlement engine is fully implemented and validated using a decoupled testable mock provider, while the master launch switch (`COMMERCIAL_GATE_ENABLED: false`) keeps the entire platform free and open for the January 1, 2027 release.

---

## 2. Comprehensive Workstream Architecture (A through K)

The implementation scope is organized into eleven cohesive workstreams:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      B18-B1 IMPLEMENTATION WORKSTREAMS                          │
├──────────────┬────────────────────────────────────────────┬─────────────────────┤
│ WORKSTREAM   │ FUNCTIONAL DOMAIN                          │ OWNING ADRS         │
├──────────────┼────────────────────────────────────────────┼─────────────────────┤
│ Workstream A │ Shared Identity & Storage Resilience       │ ADR-01, ADR-07      │
│ Workstream B │ Save Integrity, Canonical Hashing & Quotas │ ADR-02, ADR-05      │
│ Workstream C │ Shared SDK Singleton Lifecycle & Fallbacks │ ADR-03, ADR-10      │
│ Workstream D │ Six Game Adapter Bridge Implementations   │ ADR-02, ADR-03      │
│ Workstream E │ Game-Specific Sync & Bespoke Domain Merging│ ADR-05, ADR-06      │
│ Workstream F │ AuroMandala Versioned Artwork Protection   │ ADR-06, ADR-02      │
│ Workstream G │ Shared SDK Achievements Service            │ ADR-03, ADR-02      │
│ Workstream H │ Purchase & Entitlement Infrastructure      │ ADR-08, ADR-10      │
│ Workstream I │ 3-Tier Telemetry Queue & Privacy Sanitizer │ ADR-09, ADR-03      │
│ Workstream J │ Multi-Host CSP & Edge Deployment Security │ ADR-07, ADR-10      │
│ Workstream K │ Platform Integration & Regression Gates    │ Platform Baseline   │
└──────────────┴────────────────────────────────────────────┴─────────────────────┘
```

---

## 3. Workstream Detailed Scopes

### Workstream A: Shared Identity & Storage Resilience (ADR-01, ADR-07)
- **Objective:** Finalize the canonical player identity model (`guest_<uuidv4>`) across IndexedDB and localStorage using Web Locks (`auromind_identity_lock`) to prevent multi-tab split-brain states.
- **Storage Resilience:** Call `navigator.storage.persist()` non-blockingly during initialization; query `navigator.storage.estimate()` every 15 minutes and on startup.
- **Graceful Failure Protocol:** If both IndexedDB and localStorage fail (e.g. disk full, extreme privacy modes), degrade gracefully to in-memory RAM storage with an amber non-blocking portal alert and one-click JSON backup download. Basic gameplay is **never blocked**.

### Workstream B: Save Integrity, Canonical Hashing & Quotas (ADR-02, ADR-05)
- **Objective:** Eliminate fragile ad-hoc string checksums. Standardize on Web Crypto SHA-256 computed over canonically sorted JSON payloads.
- **Transport Field Partitioning:** Explicitly exclude `clientUpdatedAt`, `baseRevision`, and `guestId` from the hash target, ensuring cloud sync metadata changes do not alter content hashes.
- **AuroMatch Empty Save Correctness:** Refactor `storageAdapter.js` deep validation to recognize legitimate new-player saves (`completedLevels: []`, `isEmpty: true`) as valid non-corrupt state, while quarantining genuinely corrupt strings to `localStorage['_corrupt_*']` before recovering from IndexedDB.

### Workstream C: Shared SDK Singleton Lifecycle & Fallbacks (ADR-03, ADR-10)
- **Objective:** Harden `AuroMindSDK` singleton in `assets/sdk/auromind-sdk.js` to ensure frozen sub-services (`sdk.identity`, `sdk.storage`, `sdk.sync`, `sdk.achievements`, `sdk.telemetry`, `sdk.purchases`).
- **Standalone Game Offline Fallback:** Embed self-contained mock bridges (`window.AuroMindSDK || LocalMockBridge`) into all game entry points to ensure games running outside the portal iframe (direct URL navigation) execute 100% offline without crashing.

### Workstream D: Six Game Adapter Bridge Implementations (ADR-02, ADR-03)
- **Objective:** Complete the adapter suite across all six launch titles:
  - `auroblocks`: Update `games/auroblocks/assets/auroblocks-sdk-bridge.js` to use canonical SHA-256 hashing.
  - `auromatch`: Author `games/auromatch/assets/auromatch-sdk-bridge.js` to expose standardized envelope framing over `storageAdapter.js`.
  - `auromandala`: Overhaul `games/auromandala/assets/auromandala-sdk-bridge.js` for UUIDv4 artwork dictionary and conflict forking.
  - `vak`: Author new module `games/vak/assets/vak-sdk-bridge.js` adapting `vak_game_data`.
  - `word-riddle`: Author new module `games/word-riddle/assets/word-riddle-sdk-bridge.js` adapting `word_riddle_progress`.
  - `vak-living-sanctuary`: Author new module `games/vak-living-sanctuary/assets/vak-living-sanctuary-sdk-bridge.js` adapting `vak_sanctuary_save_v1`.

### Workstream E: Game-Specific Synchronization & Bespoke Domain Merging (ADR-05, ADR-06)
- **Objective:** Implement tailored non-destructive merge algorithms in `assets/sdk/auromind-adapters.js`:
  - **AuroBlocks:** $\max(\text{highScore})$, Set union of unlocked stages.
  - **AuroMatch:** Set union of completed levels, max stars per level.
  - **AuroMandala:** Union of sessions, fork-on-conflict for artwork entities.
  - **VAK Speech:** Set union of phoneme levels, highest mastery score.
  - **Word Riddle:** Set union of solved riddles, max streak.
  - **VAK Sanctuary:** Monotonic max meditation minutes, Set union of discovered flora.
- **Durable Outbox:** Persist pending save sync operations in IndexedDB to survive tab reloads and network interruptions.

### Workstream F: AuroMandala Versioned Artwork Protection (ADR-06, ADR-02)
- **Objective:** Implement the owner-selected **versioned artwork with conflict recovery** model.
- **Entity Model:** Transition from array to UUIDv4 dictionary (`artworks[artworkId]`) tracking `currentVersion`, `createdAt`, `updatedAt`, `deleted`, `deletedAt`, and up to 10 immutable historical snapshots.
- **Conflict Forking:** Concurrent edits on different devices fork the incoming cloud version into a new entity titled `[Title] (Cloud Copy)` with a fresh UUIDv4. Zero artwork strokes are ever silently overwritten.

### Workstream G: Shared SDK Achievements Service (ADR-03, ADR-02)
- **Objective:** Formalize `sdk.achievements` API supporting typed definitions, idempotent `unlock()`, monotonic `incrementProgress()`, and monotonic union cloud reconciliation (Max Progress, Earliest Timestamp).

### Workstream H: Purchase & Entitlement Infrastructure (ADR-08, ADR-10)
- **Objective:** Build and validate provider-independent purchase architecture (`sdk.purchases`) using `MockPurchaseProvider`.
- **Signed Tokens:** Issue and verify compact JWTs signed with Ed25519 containing `(guest_id, sku, exp, kid)`.
- **Offline Entitlement Verification:** Support recommended 30-day offline grace period with monotonic anchor validation defending against casual clock rollback.
- **Launch Switch:** Keep `COMMERCIAL_GATE_ENABLED: false` in `backend-config.js` to ensure the platform launches 100% free and open.

### Workstream I: 3-Tier Telemetry Queue & Privacy Sanitizer (ADR-09, ADR-03)
- **Objective:** Implement 500-event capacity buffer partitioned into CRITICAL (100, IDB-backed, never dropped), ENGAGEMENT (300, memory FIFO), and DIAGNOSTIC (100, memory, aggressive eviction).
- **Observable Saturation:** If CRITICAL tier fills, log observable console error and increment `critical_overflow_count` in localStorage.
- **Sacred Data Exclusion:** Pre-queue sanitizer strips all occurrences of `sankalpa`, intentions, reflections, and raw audio. Sankalpa Vault remains 100% local-only E2EE.

### Workstream J: Multi-Host CSP & Edge Deployment Security (ADR-07, ADR-10)
- **Objective:** Tailor production security configurations across Vercel (`vercel.json`), Cloudflare Pages (`_headers`), Netlify (`netlify.toml`), and local Express (`server.js`).
- **Policy Directives:** Enforce `frame-ancestors 'self'`, `object-src 'none'`, and pre-authorize future Supabase endpoints (`connect-src https://*.supabase.co wss://*.supabase.co`). Account for GitHub Pages HTTP response header limitations.

### Workstream K: Platform Integration & Regression Gates (Platform Baseline)
- **Objective:** Validate that the entire 251-test baseline remains 100% passing with 0 failures, all 9 new finding test suites pass, all sacred data invariants remain byte-exact, and theater/mobile browser workflows execute smoothly.

---

## 4. Key Implementation Metrics

| Metric | Target Value |
| :--- | :--- |
| **Total Implementation Workstreams** | 11 workstreams (A through K) |
| **Total Granular Implementation Tasks** | 24 canonical tasks |
| **P1 / P2 / P3 Finding Coverage** | 100% (F-01 through F-09 resolved) |
| **Architecture Gap Coverage** | 100% (GAP-01 through GAP-06 resolved) |
| **Baseline Test Suite Preservation** | 251 / 251 tests passing (0 failures, 0 regressions) |
| **New Automated Test Cases** | 42 new targeted test assertions |
| **Offline Test Execution** | 100% air-gapped / zero network calls |
| **Application Source Files Modified in Planning Phase** | **0 files** (Strict Read-Only Observed) |
