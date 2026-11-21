# AuroMasti B18-B1 — Final Canonical Task Register
## Complete Inventory of All 24 Implementation Tasks Across Workstreams A through K

- **Document Version:** 1.0.0
- **Batch Reference:** B18-B1 Implementation Plan Reconciliation & Final Acceptance
- **Canonical Workspace:** `C:\AuroMindPortal`
- **Active Git Branch:** `dev/studio-integration`
- **Baseline HEAD:** `b6ccc860bb7d38a70ef678049a9588b8b73c40aa`
- **Target Release:** January 1, 2027
- **Canonical Task Count:** **Exactly 24 Tasks** (Zero Merged, Zero Omitted)
- **Governance Mandate:** All 10 original ADRs remain **PENDING OWNER APPROVAL**.

---

## 1. Reconciliation of Task Inventory Discrepancy

In the initial draft of `B18_B1_MASTER_IMPLEMENTATION_EXECUTION_PLAN.md`, an executive summary typo stated "22 implementation tasks", while the granular specification in `B18_B1_TASK_LEVEL_WORK_BREAKDOWN.md` detailed 24 discrete tasks. 

**Official Reconciliation:**
- The canonical task inventory consists of **exactly 24 discrete implementation tasks**.
- No tasks have been merged, omitted, or combined. Every task represents an independent, testable engineering unit.
- The 24 tasks span 11 workstreams (A through K) and address 100% of findings F-01 through F-09 and GAP-01 through GAP-06.

---

## 2. Six-Game Adapter Status Reconciliation

A key architectural clarification relates to **F-03 ("Missing Standalone Adapters")** and the six-game adapter inventory:
1. **Existing Adapters Requiring Remediation (2 games):**
   - **AuroBlocks (`TASK-ADP-01`):** `games/auroblocks/assets/auroblocks-sdk-bridge.js` exists in source; requires remediation to replace ad-hoc string concatenation with canonical Web Crypto SHA-256 hashing (F-02).
   - **AuroMandala (`TASK-ART-01` / `TASK-ART-02`):** `games/auromandala/assets/auromandala-sdk-bridge.js` exists in source; requires remediation to implement UUIDv4 artwork dictionary, soft deletes, conflict forking into `(Cloud Copy)`, and deep stroke checksumming (F-01, ADR-06).
2. **Missing Standalone Adapters (3 games originally cited in F-03):**
   - **VAK Speech Control (`TASK-ADP-03`):** Zero bridge source module exists. Must author `games/vak/assets/vak-sdk-bridge.js`.
   - **Word Riddle (`TASK-ADP-04`):** Zero bridge source module exists. Must author `games/word-riddle/assets/word-riddle-sdk-bridge.js`.
   - **VAK Living Sanctuary (`TASK-ADP-05`):** Zero bridge source module exists. Must author `games/vak-living-sanctuary/assets/vak-living-sanctuary-sdk-bridge.js`.
3. **Additional Bridge Introduced for Architectural Consistency (1 game):**
   - **AuroMatch (`TASK-ADP-02`):** AuroMatch possesses an internal controller `games/auromatch/src/controllers/storageAdapter.js` within its game bundle handling IndexedDB/localStorage, but lacked an external, standardized Shared SDK adapter bridge file matching the standalone envelope bridge pattern of AuroBlocks and AuroMandala. Introducing `games/auromatch/assets/auromatch-sdk-bridge.js` standardizes the platform architecture across all six games, while `storageAdapter.js` is remediated under `TASK-SAVE-02` (F-05 auto-healing fix).

---

## 3. The 24 Canonical Implementation Tasks

| Task ID | Workstream | Finding & GAP Mapping | Owning ADR | Files Affected | Dependencies | Acceptance Criteria | Test Suites |
| :--- | :--- | :---: | :---: | :--- | :--- | :--- | :--- |
| **TASK-ID-01** | A. Identity & Storage | F-04, GAP-01 | **ADR-01** | `assets/sdk/auromind-sdk.js` | None | Multi-tab init converges on single `guest_<uuidv4>` via Web Locks; earliest timestamp wins. | Unit: `test/identity-weblocks.test.js`<br>Integration: `server.test.js` (4–6)<br>Browser: Multi-page Playwright |
| **TASK-ID-02** | A. Identity & Storage | F-04 | **ADR-01**, **ADR-07** | `assets/sdk/auromind-sdk.js` | `TASK-ID-01` | Non-blocking `navigator.storage.persist()`; 80% quota emits CRITICAL alert. | Unit: Storage persistence mock<br>Integration: `test/storage-resilience-csp.test.js` Suite 4<br>Browser: Chrome/FF persistence |
| **TASK-ID-03** | A. Identity & Storage | F-04, GAP-01 | **ADR-01**, **ADR-07** | `assets/sdk/auromind-sdk.js`<br>`assets/js/portal.js`<br>`assets/css/portal.css` | `TASK-ID-01` | Total storage failure activates in-memory RAM mode; renders amber banner + JSON export; gameplay unblocked. | Unit: RAM storage mock<br>Integration: Storage lockout simulation<br>Browser: Blocked storage simulation |
| **TASK-SAVE-01** | B. Save Integrity | F-02 | **ADR-02**, **ADR-05** | `assets/sdk/auromind-adapters.js`<br>`assets/sdk/auromind-sdk.js` | None | Deterministic key sorting; Web Crypto SHA-256 over canonical JSON excluding transport fields. | Unit: Canonical JSON permutations<br>Integration: `test/sdk-adapter-contracts.test.js` Suite 2<br>Browser: Web Crypto digest |
| **TASK-SAVE-02** | B. Save Integrity | F-05 | **ADR-01**, **ADR-07** | `games/auromatch/src/controllers/storageAdapter.js` | `TASK-SAVE-01` | Deep validation accepts empty array (`completedLevels: []`) as valid; corrupt strings heal from IDB; bidirectional sync. | Unit: Empty array & malformed JSON<br>Integration: `test/storage-resilience-csp.test.js` Suite 5<br>Browser: Level survival wipe |
| **TASK-SAVE-03** | B. Save Integrity | F-02, F-05 | **ADR-02** | `assets/sdk/auromind-adapters.js`<br>`assets/sdk/auromind-sdk.js` | `TASK-SAVE-01` | Corrupt payloads archived to `localStorage['_corrupt_*']`; clean initial envelope minted; telemetry queued. | Unit: Binary garbage injection<br>Integration: Quarantine test<br>Browser: Graceful UI alert |
| **TASK-SDK-01** | C. Shared SDK | Baseline | **ADR-03** | `assets/sdk/auromind-sdk.js` | `TASK-ID-01`<br>`TASK-SAVE-01` | All sub-services frozen with `Object.freeze`; errors in telemetry/sync isolated from storage/identity. | Unit: Immutability assertion<br>Integration: E2E Suite C (1–3)<br>Browser: `window.AuroMindSDK` check |
| **TASK-SDK-02** | C. Shared SDK | GAP-02 | **ADR-03**, **ADR-10** | `assets/sdk/auromind-adapters.js` | `TASK-SDK-01` | `createLocalMockBridge` embedded in all bridges; standalone direct game URL loads and plays 100% offline. | Unit: `window.parent === window`<br>Integration: Standalone execution<br>Browser: Direct navigation to 6 games |
| **TASK-ADP-01** | D. Game Adapters | F-02, F-03 | **ADR-02** | `games/auroblocks/assets/auroblocks-sdk-bridge.js` | `TASK-SAVE-01`<br>`TASK-SDK-02` | AuroBlocks envelope computes canonical SHA-256; high score persists across reloads; mock fallback active. | Unit: AuroBlocks envelope framing<br>Integration: Theatre launch test<br>Browser: Play 1 round AuroBlocks |
| **TASK-ADP-02** | D. Game Adapters | F-03, F-05 | **ADR-02** | `games/auromatch/assets/auromatch-sdk-bridge.js` (NEW)<br>`games/auromatch/index.html` | `TASK-SAVE-01`<br>`TASK-SAVE-02`<br>`TASK-SDK-02` | Author dedicated bridge connecting `storageAdapter.js` to SDK; standardized envelope framing; mock fallback. | Unit: Contract validation<br>Integration: Theatre sync test<br>Browser: Clear Level 1 in browser |
| **TASK-ADP-03** | D. Game Adapters | F-03 | **ADR-02**, **ADR-03** | `games/vak/assets/vak-sdk-bridge.js` (NEW)<br>`games/vak/index.html` | `TASK-SAVE-01`<br>`TASK-SDK-02` | Author dedicated ES module bridge for VAK; adapt `vak_game_data`; standalone fallback; corpus SHA-256 untouched. | Unit: VAK envelope validation<br>Integration: `test/sdk-adapter-contracts.test.js` Suite 3<br>Browser: VAK mic & phonemes |
| **TASK-ADP-04** | D. Game Adapters | F-03 | **ADR-02**, **ADR-03** | `games/word-riddle/assets/word-riddle-sdk-bridge.js` (NEW)<br>`games/word-riddle/index.html` | `TASK-SAVE-01`<br>`TASK-SDK-02` | Author dedicated bridge for Word Riddle; adapt `word_riddle_progress`; standalone mock fallback. | Unit: Riddle contract validation<br>Integration: Theatre session test<br>Browser: Solve riddle 1 |
| **TASK-ADP-05** | D. Game Adapters | F-03 | **ADR-02**, **ADR-03** | `games/vak-living-sanctuary/assets/vak-living-sanctuary-sdk-bridge.js` (NEW)<br>`games/vak-living-sanctuary/index.html` | `TASK-SAVE-01`<br>`TASK-SDK-02` | Author dedicated bridge for Sanctuary; adapt `vak_sanctuary_save_v1`; mock fallback; Flora DB byte count untouched. | Unit: Sanctuary contract test<br>Integration: Theatre session test<br>Browser: Sanctuary flora growth |
| **TASK-SYNC-01** | E. Sync & Merging | F-07 | **ADR-06**, **ADR-04** | `assets/sdk/auromind-adapters.js` | `TASK-SAVE-01`<br>`TASK-ADP-01..05` | Bespoke domain merges for all 6 games: Max high scores, Set union of levels, monotonic minutes. | Unit: `test/domain-merges.test.js`<br>Integration: `test/save-integrity-merge.test.js` Suite 7<br>Browser: Multi-tab merge |
| **TASK-SYNC-02** | E. Sync & Merging | F-02 | **ADR-05** | `assets/sdk/auromind-sdk.js` | `TASK-ID-01`<br>`TASK-SAVE-01` | Outbox persists in IndexedDB (`platform_sync_outbox`); retries with exponential backoff; play never blocked. | Unit: Outbox serialization<br>Integration: Simulated offline sync<br>Browser: Reconnect outbox drain |
| **TASK-ART-01** | F. Artwork Protection | F-01 | **ADR-06**, **ADR-02** | `games/auromandala/assets/auromandala-sdk-bridge.js` | `TASK-SAVE-01` | Migrate `savedArtworks` to UUIDv4 map; track `currentVersion`, history snapshots; archive legacy backup. | Unit: `test/mandala-artwork-schema.test.js`<br>Integration: `test/save-integrity-merge.test.js` Suite 1<br>Browser: Draw strokes in browser |
| **TASK-ART-02** | F. Artwork Protection | F-01 | **ADR-06** | `games/auromandala/assets/auromandala-sdk-bridge.js`<br>`assets/sdk/auromind-adapters.js` | `TASK-ART-01`<br>`TASK-SYNC-01` | Concurrent stroke conflicts fork into `[Title] (Cloud Copy)` with new UUID; soft deletions preserve tombstones. | Unit: `test/mandala-conflict-forking.test.js`<br>Integration: Multi-device simulated conflict<br>Browser: Concurrent edit simulation |
| **TASK-ACH-01** | G. Achievements | F-06 | **ADR-03**, **ADR-02** | `assets/sdk/auromind-sdk.js`<br>`assets/sdk/auromind-adapters.js` | `TASK-SDK-01`<br>`TASK-SAVE-01` | `sdk.achievements` API: typed definitions; idempotent `unlock()`; monotonic union sync; toast queueing. | Unit: `test/achievements-service.test.js`<br>Integration: `test/sdk-adapter-contracts.test.js` Suite 6<br>Browser: Unlock badge in Portal |
| **TASK-COMM-01**| H. Commerce Engine | GAP-04, GAP-05 | **ADR-08**, **ADR-10** | `assets/sdk/auromind-sdk.js`<br>`assets/sdk/config/backend-config.js` | `TASK-SDK-01` | `sdk.purchases` interface; `MockPurchaseProvider`; simulated transactions; `COMMERCIAL_GATE_ENABLED: false` launch invariant. | Unit: `test/purchases-mock.test.js`<br>Integration: Entitlement conformance<br>Browser: Supporter pass UI check |
| **TASK-COMM-02**| H. Commerce Engine | GAP-04 | **ADR-08** | `assets/sdk/auromind-sdk.js` | `TASK-COMM-01` | Ed25519 token verification; 30-day offline grace period; monotonic clock rollback defense; non-destructive revocation. | Unit: `test/ed25519-entitlements.test.js`<br>Integration: Clock skew simulation<br>Browser: Offline token validation |
| **TASK-TEL-01** | I. Telemetry | F-08 | **ADR-09**, **ADR-03** | `assets/sdk/auromind-sdk.js` | `TASK-SDK-01` | 3-tier queue (CRITICAL: 100 in IDB, ENGAGEMENT: 300, DIAGNOSTIC: 100); observable overflow counter; consent purge. | Unit: `test/telemetry-queue.test.js`<br>Integration: `test/sdk-adapter-contracts.test.js` Suite 8<br>Browser: Opt-out network purge |
| **TASK-TEL-02** | I. Telemetry | F-08, GAP-03 | **ADR-09** | `assets/sdk/auromind-sdk.js`<br>`assets/sdk/config/backend-config.js` | `TASK-TEL-01` | Deep pre-queue privacy filter purges `sankalpa`, intentions, reflections, audio; Sankalpa Vault local-only E2EE. | Unit: `test/privacy-sanitizer.test.js`<br>Integration: Sacred privacy tests<br>Browser: Zero PII in network tab |
| **TASK-CSP-01** | J. CSP & Security | F-09 | **ADR-07**, **ADR-10** | `server.js`<br>`vercel.json`<br>`_headers`<br>`netlify.toml` | None | Unified CSP matching `server.js` deployed across Vercel, CF, Netlify; `frame-ancestors 'self'`; Supabase allowlisted. | Unit: `test/csp-configs.test.js`<br>Integration: `test/storage-resilience-csp.test.js` Suite 9<br>Browser: Zero CSP violations |
| **TASK-REG-01** | K. Regression Gate | GAP-06 | Platform Baseline | `test/sacred-invariants.test.js` | All Tasks (`TASK-ID-01..CSP-01`) | Full automated regression: 251 baseline + 42 new assertions (293 passing); VAK & Flora invariants byte-exact. | Unit: Full `node --test` suite<br>Integration: E2E platform run<br>Browser: Playwright theater regression |
