# AuroMasti B18-B1 — Six-Game Adapter Evidence Matrix
## Codebase Inspection, Reconciliation of Authoring Status, and Remaining Work Matrix

- **Document Version:** 1.0.0
- **Batch Reference:** B18-B1 Final ADR Clarification & Approval Preparation
- **Canonical Workspace:** `C:\AuroMindPortal`
- **Target Release:** January 1, 2027
- **Governance Status:** PENDING OWNER APPROVAL

---

## 1. Resolution of Apparent Contradiction (Authored vs. Source-Modified)

In the preceding B18-B1 report, adapter modules were described as "authored" in several sections, while the preflight simultaneously reported "zero application source modifications."

### Explicit Architectural Clarification:
1. **What WAS Authored in B18-B1:** The complete **architectural specifications, contract interfaces, and code blueprints** for all six adapters were authored into the B18-B1 design documentation deliverables (specifically [B18_B1_SHARED_SDK_AND_GAME_ADAPTER_CONTRACTS.md](file:///C:/AuroMindPortal/B18_B1_SHARED_SDK_AND_GAME_ADAPTER_CONTRACTS.md)).
2. **What Was NOT Touched (Zero Source Modifications):** In strict accordance with the read-only mandate of Phase B18-B1, **no physical JavaScript source files were created, edited, or injected into `games/*/assets/` or `assets/sdk/` during B18-B1**.
3. **Execution Sequence:** The physical implementation of these adapter source files is formally scheduled for **Phase B18-B1 Implementation**, which will begin only after the Product Owner reviews and signs off on this approval package.

---

## 2. Six-Game Adapter Evidence & Status Matrix

The following table reflects the **actual, read-only inspected state of the codebase** at Git HEAD `b6ccc860bb7d38a70ef678049a9588b8b73c40aa`:

| Game Name | Existing Storage Mechanism | Adapter Contract Documented? | Actual Source Module Present in Workspace? | Offline Fallback Mechanism | Automated Test Coverage |
| :--- | :--- | :---: | :---: | :--- | :--- |
| **AuroBlocks** | `localStorage` (`auroblocks_save_v1`) | **YES** (`auromind-adapters.js` & B18-B1 design) | **YES**<br>[auroblocks-sdk-bridge.js](file:///C:/AuroMindPortal/games/auroblocks/assets/auroblocks-sdk-bridge.js) (Created B17.1) | Implements internal mock bridge if parent SDK is absent. | `server.test.js` & `b17-3-e2e.test.js` passing. |
| **AuroMatch** | Dual IDB + LocalStorage (`auro_match_user`) | **YES** (`auromind-adapters.js` & B18-B1 design) | **PARTIAL / INTERNAL**<br>[storageAdapter.js](file:///C:/AuroMindPortal/games/auromatch/src/controllers/storageAdapter.js) inside game bundle; no separate bridge file. | Built-in dual IDB + localStorage auto-healing logic. | `server.test.js` tests 1–17 & `b17-remediation.test.js` passing. |
| **AuroMandala** | `localStorage` (`pranamandala_game_cache_v2`) | **YES** (`auromind-adapters.js` & B18-B1 design) | **YES**<br>[auromandala-sdk-bridge.js](file:///C:/AuroMindPortal/games/auromandala/assets/auromandala-sdk-bridge.js) (Needs UUIDv4 & forking update) | Uses direct `localStorage` cache if SDK unavailable. | `server.test.js` & E2E theatre test passing. |
| **VAK Speech Control** | `localStorage` (`vak_game_data`) | **YES** (B18-B1 Design Blueprint) | **NO**<br>(Source module not yet created in `games/vak/assets/`) | Direct inline script writes to `localStorage` in `index.html`. | Sacred corpus SHA-256 test & E2E launch test passing. |
| **Word Riddle** | `localStorage` (`word_riddle_progress`) | **YES** (B18-B1 Design Blueprint) | **NO**<br>(Source module not yet created in `games/word-riddle/assets/`) | Bundled React state engine writes directly to `localStorage`. | E2E theatre test passing. |
| **VAK Living Sanctuary** | `localStorage` (`vak_sanctuary_save_v1`) | **YES** (B18-B1 Design Blueprint) | **NO**<br>(Source module not yet created in `games/vak-living-sanctuary/assets/`) | Bundled engine writes to `localStorage`; offline service worker active. | Flora database byte/line test & E2E launch passing. |

---

## 3. Precise Remaining Implementation & Validation Work

Upon receiving Product Owner authorization, the following concrete tasks will be executed in Phase B18-B1 Implementation:

### Task 1: Author Missing Bridge Source Modules
- Create `games/vak/assets/vak-sdk-bridge.js` implementing typed `extractEnvelope()` and `applyEnvelope()` for `vak_game_data`.
- Create `games/word-riddle/assets/word-riddle-sdk-bridge.js` implementing envelope framing for `word_riddle_progress`.
- Create `games/vak-living-sanctuary/assets/vak-living-sanctuary-sdk-bridge.js` implementing envelope framing for `vak_sanctuary_save_v1`.
- Create `games/auromatch/assets/auromatch-sdk-bridge.js` connecting `storageAdapter.js` cleanly to the Shared SDK.

### Task 2: Remediate Existing Bridges
- **AuroMandala Bridge Refactor:** Overhaul `games/auromandala/assets/auromandala-sdk-bridge.js` to implement the UUIDv4 artwork dictionary, soft deletions, conflict forking into `(Cloud Copy)`, and deep stroke checksumming.
- **AuroBlocks Bridge Refactor:** Replace ad-hoc string checksum with canonical JSON Web Crypto SHA-256 hashing.
- **AuroMatch Storage Adapter Fix:** Patch `games/auromatch/src/controllers/storageAdapter.js` to correct the `autoHealFromIndexedDB()` logic flaw, validating legitimate empty saves (`completedLevels: []`) as valid.

### Task 3: Automated Contract Validation
- Execute the 9 new automated regression test suites specified in [B18_B1_ACCEPTANCE_AND_REGRESSION_TEST_PLAN.md](file:///C:/AuroMindPortal/B18_B1_ACCEPTANCE_AND_REGRESSION_TEST_PLAN.md).
- Verify 100% pass rate alongside the existing 251 baseline tests in an air-gapped offline environment.
