# AuroMasti B18-B1 — Finding to Implementation Traceability Matrix
## Uncompromised Zero-Deferred Bidirectional Traceability: Findings F-01 through F-09 and Architectural Gaps

- **Document Version:** 1.0.0
- **Batch Reference:** B18-B1 Master Implementation Execution Plan
- **Canonical Workspace:** `C:\AuroMindPortal`
- **Target Release:** January 1, 2027
- **Governance Mandate:** All 10 original ADRs remain **PENDING OWNER APPROVAL**. This matrix provides uncompromised bidirectional traceability ensuring every finding is tied to an actionable implementation task.

---

## 1. Master Finding-to-Task Traceability Matrix

| Finding / Gap ID | Original Priority | Description | Owning ADR | Assigned Task ID(s) | Primary Source Files Affected | Targeted Test Suite | Expected Production Artifacts |
| :--- | :---: | :--- | :--- | :--- | :--- | :--- | :--- |
| **F-01** | **P1** | AuroMandala Artwork Overwrite Risk | **ADR-06**, ADR-02 | `TASK-ART-01`<br>`TASK-ART-02` | `games/auromandala/assets/auromandala-sdk-bridge.js` | `test/save-integrity-merge.test.js` Suite 1 | UUIDv4 artwork dictionary; tombstone records; conflict forking into `(Cloud Copy)`. |
| **F-02** | **P1** | Weak / Inconsistent Checksums | **ADR-02**, ADR-05 | `TASK-SAVE-01`<br>`TASK-ADP-01` | `assets/sdk/auromind-adapters.js`<br>`assets/sdk/auromind-sdk.js` | `test/sdk-adapter-contracts.test.js` Suite 2 | Deterministic canonical JSON sorting; Web Crypto SHA-256 excluding transport metadata. |
| **F-03** | **P1** | Missing Standalone Adapters (3 games) | **ADR-02**, **ADR-03**, ADR-10 | `TASK-ADP-02`<br>`TASK-ADP-03`<br>`TASK-ADP-04`<br>`TASK-ADP-05` | `games/auromatch/assets/auromatch-sdk-bridge.js`<br>`games/vak/assets/vak-sdk-bridge.js`<br>`games/word-riddle/assets/word-riddle-sdk-bridge.js`<br>`games/vak-living-sanctuary/assets/vak-living-sanctuary-sdk-bridge.js` | `test/sdk-adapter-contracts.test.js` Suite 3 | Standalone ES module bridges for all games with embedded mock fallbacks. |
| **F-04** | **P2** | Storage Eviction Vulnerability (ITP / LRU) | **ADR-01**, **ADR-07** | `TASK-ID-02`<br>`TASK-ID-03` | `assets/sdk/auromind-sdk.js`<br>`assets/js/portal.js` | `test/storage-resilience-csp.test.js` Suite 4 | `AuroMindStorageResilienceManager`; `navigator.storage.persist()`; RAM fallback mode. |
| **F-05** | **P2** | AuroMatch Auto-Healing Logic Flaw | **ADR-01**, **ADR-07** | `TASK-SAVE-02`<br>`TASK-ADP-02` | `games/auromatch/src/controllers/storageAdapter.js` | `test/storage-resilience-csp.test.js` Suite 5 | Structural validation accepting `completedLevels: []`; corrupt data quarantine; IDB/LS healing. |
| **F-06** | **P2** | Missing Shared SDK Achievements API | **ADR-03**, ADR-02 | `TASK-ACH-01` | `assets/sdk/auromind-sdk.js`<br>`assets/sdk/auromind-adapters.js` | `test/sdk-adapter-contracts.test.js` Suite 6 | `sdk.achievements` service namespace; idempotent unlocks; monotonic union sync. |
| **F-07** | **P2** | Domain Merge Policy Discrepancies | **ADR-06**, ADR-04 | `TASK-SYNC-01` | `assets/sdk/auromind-adapters.js` | `test/save-integrity-merge.test.js` Suite 7 | Tailored monotonic merge algorithms for all six launch titles in `resolveGameMerge()`. |
| **F-08** | **P3** | Telemetry Queue Overflow & Privacy Risk | **ADR-09**, ADR-03 | `TASK-TEL-01`<br>`TASK-TEL-02` | `assets/sdk/auromind-sdk.js`<br>`assets/sdk/config/backend-config.js` | `test/sdk-adapter-contracts.test.js` Suite 8 | 3-tier queue (CRITICAL, ENGAGEMENT, DIAGNOSTIC); 500-event cap; pre-queue privacy filter. |
| **F-09** | **P3** | Production CSP & Hosting Discrepancies | **ADR-07**, ADR-10 | `TASK-CSP-01` | `server.js`<br>`vercel.json`<br>`_headers`<br>`netlify.toml` | `test/storage-resilience-csp.test.js` Suite 9 | Multi-host synchronized headers; `frame-ancestors 'self'`; Supabase `connect-src`. |
| **GAP-01** | **P1** | Single Identity Rule Enforcement | **ADR-01** | `TASK-ID-01` | `assets/sdk/auromind-sdk.js` | `server.test.js` tests 1–17 | Web Locks identity convergence; zero in-app profile switching or selector dialogs. |
| **GAP-02** | **P2** | Standalone Game Offline Degradation | **ADR-03**, ADR-10 | `TASK-SDK-02` | `assets/sdk/auromind-adapters.js` | E2E Suite B - 7 | In-bridge local mock fallbacks (`createLocalMockBridge`) in all six games. |
| **GAP-03** | **P1** | Sankalpa Vault Local-Only Isolation | **ADR-09** | `TASK-TEL-02` | `assets/sdk/config/backend-config.js` | `test/sacred-invariants.test.js` Assertion 3 | `cloudSyncEligible: false`; AES-GCM local-only encryption; 100% stripped from telemetry. |
| **GAP-04** | **P2** | Offline Entitlements & Clock Skew | **ADR-08** | `TASK-COMM-01`<br>`TASK-COMM-02` | `assets/sdk/auromind-sdk.js` | `test/ed25519-entitlements.test.js` | Server-signed Ed25519 tokens; 30-day offline grace period; monotonic clock checks. |
| **GAP-05** | **P2** | Refund & Revocation Non-Destructive | **ADR-08** | `TASK-COMM-01` | `assets/sdk/auromind-sdk.js` | `test/purchases-mock.test.js` | Graceful access downgrade; zero deletion of player-created artworks or progress. |
| **GAP-06** | **P1** | Sacred Data Asset Byte Immutability | **ADR-02**, **ADR-07** | `TASK-REG-01` | `test/sacred-invariants.test.js` | `test/sacred-invariants.test.js` Assertions 1–2 | VAK Speech Corpus (SHA-256 `9fdb38...`) and Flora DB (2,002,176 bytes) 100% byte-exact. |

---

## 2. Zero-Deferred Findings Policy Affirmation

In strict compliance with the Product Owner's mandate:
- **Zero Omissions:** All 9 findings and 6 architectural gaps are assigned concrete implementation tasks.
- **Zero Priority-Based Postponements:** Findings F-08 and F-09 (Priority P3) receive full task definitions (`TASK-TEL-01`, `TASK-TEL-02`, and `TASK-CSP-01`) and automated test suites, identical in rigor to P1 findings.
- **Zero Launch-State Postponements:** Purchase capabilities under ADR-08 receive complete mock-backed implementations (`TASK-COMM-01`, `TASK-COMM-02`) and cryptographic validation, even though commercial paywalls remain disabled for the January 1, 2027 release.
