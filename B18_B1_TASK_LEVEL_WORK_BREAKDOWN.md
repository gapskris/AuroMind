# AuroMasti B18-B1 — Task-Level Work Breakdown Structure
## Granular Engineering Specifications for All 24 Canonical Tasks Across Workstreams A through K

- **Document Version:** 1.0.0
- **Batch Reference:** B18-B1 Master Implementation Execution Plan
- **Canonical Workspace:** `C:\AuroMindPortal`
- **Active Git Branch:** `dev/studio-integration`
- **Target Release:** January 1, 2027
- **Governance Mandate:** All 10 original ADRs remain **PENDING OWNER APPROVAL**. This breakdown provides complete field-by-field implementation blueprints for immediate execution upon authorization.

---

## 1. Workstream A: Shared Identity & Storage Resilience

### TASK-ID-01: Shared Identity Multi-Tab Convergence & Web Locks
- **Finding IDs:** F-04, GAP-01
- **Owning ADR:** **ADR-01** (Canonical Player Identity Model)
- **Files to Modify:** `assets/sdk/auromind-sdk.js`
- **Description:** Enforce strict single-identity rule: One browser profile = one persistent player identity (`guest_<uuidv4>`). Wrap initialization in `navigator.locks.request('auromind_identity_lock')` with BroadcastChannel synchronization. Prevent split-brain race conditions when multiple game tabs boot simultaneously.
- **Dependencies:** None (Base task).
- **Risks:** Browser lock timeouts in inactive background tabs. Mitigation: 3000ms lock timeout fallback to localStorage storage events.
- **Acceptance Criteria:** 5 concurrent tabs boot within 50ms of each other; all 5 converge on identical `guestId`; earliest `createdAt` wins deterministically.
- **Unit Tests:** `test/identity-weblocks.test.js` (Simulate concurrent init calls).
- **Integration Tests:** `server.test.js` tests 4–6 (Multi-tab Web Locks convergence).
- **Browser Tests:** Playwright multi-page concurrency test opening portal and two game tabs.
- **Regression Tests:** Verify existing tests 1–17 in `server.test.js` continue passing.
- **Completion Evidence:** Test log showing 0 lock rejections and identical UUID in all tabs.

### TASK-ID-02: Storage Resilience Manager & Quota Telemetry
- **Finding IDs:** F-04
- **Owning ADR:** **ADR-01**, **ADR-07** (Local Operational Authority)
- **Files to Modify:** `assets/sdk/auromind-sdk.js`
- **Description:** Implement `AuroMindStorageResilienceManager`. Non-blockingly invoke `navigator.storage.persist()`. Monitor quota via `navigator.storage.estimate()` every 15 minutes. Emit CRITICAL telemetry warning if disk consumption exceeds 80%.
- **Dependencies:** `TASK-ID-01`.
- **Risks:** Unhandled promise rejections on legacy browsers. Mitigation: Safe feature-detection check for `navigator.storage`.
- **Acceptance Criteria:** `sdk.storage.isPersisted` accurately reflects browser permission; 85% simulated quota emits CRITICAL alert.
- **Unit Tests:** Mock `navigator.storage.persist()` and `estimate()`.
- **Integration Tests:** `test/storage-resilience-csp.test.js` Suite 4.
- **Browser Tests:** Real-browser check verifying non-blocking initialization in Chrome and Firefox.
- **Regression Tests:** Storage health property exposed without altering existing identity schema.
- **Completion Evidence:** Telemetry queue inspection showing `storage_quota_warning` event.

### TASK-ID-03: Ephemeral In-Memory Storage & Backup Export UI
- **Finding IDs:** F-04, GAP-01
- **Owning ADR:** **ADR-01**, **ADR-07**
- **Files to Modify:** `assets/sdk/auromind-sdk.js`, `assets/js/portal.js`, `assets/css/portal.css`
- **Description:** If both IndexedDB and localStorage throw storage exceptions (e.g. storage full or private mode lockdown), degrade cleanly to RAM-backed `InMemoryStorageAdapter`. Render non-blocking amber portal banner with one-click *"Export Session Progress"* button downloading `.auromind-backup.json`. Gameplay is never blocked.
- **Dependencies:** `TASK-ID-01`.
- **Risks:** Memory leaks if sessions run for days in RAM. Mitigation: Bound in-memory game state to active session envelopes.
- **Acceptance Criteria:** Total storage failure permits full offline gameplay; banner renders cleanly; export produces valid JSON.
- **Unit Tests:** Inject throwing storage mocks; verify games boot and save in RAM.
- **Integration Tests:** Simulated storage lockdown test in `server.test.js`.
- **Browser Tests:** Playwright simulation with blocked storage permissions.
- **Regression Tests:** Normal storage mode does not render the warning banner.
- **Completion Evidence:** Browser screenshot and downloaded backup JSON validation.

---

## 2. Workstream B: Save Integrity, Canonical Hashing & Quotas

### TASK-SAVE-01: Canonical JSON Serialization & Web Crypto SHA-256 Engine
- **Finding IDs:** F-02
- **Owning ADR:** **ADR-02** (Versioned Opaque Save Payloads), **ADR-05** (Sync Outbox)
- **Files to Modify:** `assets/sdk/auromind-adapters.js`, `assets/sdk/auromind-sdk.js`
- **Description:** Implement `canonicalizeJson(obj)` with deterministic lexicographical key sorting. Compute 64-character SHA-256 hex checksums using `crypto.subtle.digest()`. Include `{ envelopeVersion, gameId, gameSchemaVersion, isEmpty, payload }`; explicitly exclude transport metadata (`clientUpdatedAt`, `baseRevision`, `guestId`).
- **Dependencies:** None.
- **Risks:** Non-secure HTTP contexts where `crypto.subtle` is undefined. Mitigation: Graceful fallback to pure-JS SHA-256 implementation.
- **Acceptance Criteria:** Objects with inverted keys yield identical hash; mutating deep payload property alters hash; incrementing `baseRevision` leaves hash invariant.
- **Unit Tests:** `test/canonical-json-hash.test.js` (Key order permutations, type preservation).
- **Integration Tests:** `test/sdk-adapter-contracts.test.js` Suite 2.
- **Browser Tests:** Real-browser Web Crypto execution in Playwright.
- **Regression Tests:** Invariant 3 check (`local.checksum === remote.checksum`) continues working.
- **Completion Evidence:** Hash output validation across 100 random JSON structures.

### TASK-SAVE-02: AuroMatch Auto-Healing & Valid Empty Save Fix
- **Finding IDs:** F-05
- **Owning ADR:** **ADR-01**, **ADR-07**
- **Files to Modify:** `games/auromatch/src/controllers/storageAdapter.js`
- **Description:** Overhaul `autoHealFromIndexedDB()` in AuroMatch. Fix logic flaw where truthy localStorage prevented recovery. Validate structure: brand-new player saves (`completedLevels: []`, `isEmpty: true`) are validated as **100% valid non-corrupt state**. Corrupt or unparseable strings trigger automatic recovery from IndexedDB. Implement bidirectional sync.
- **Dependencies:** `TASK-SAVE-01`.
- **Risks:** Erroneously overwriting valid empty saves of new players. Mitigation: Explicit check `Array.isArray(completedLevels)`.
- **Acceptance Criteria:** Empty new-player save is never treated as corrupt; truncated JSON in localStorage recovers from IDB; wiped IDB recovers from valid localStorage.
- **Unit Tests:** Test empty array, malformed JSON, and wiped IDB scenarios.
- **Integration Tests:** `test/storage-resilience-csp.test.js` Suite 5.
- **Browser Tests:** Launch AuroMatch in browser; verify level progression survives simulated storage wipe.
- **Regression Tests:** Existing AuroMatch level unlocking and constellation progression pass.
- **Completion Evidence:** Test assertion logs showing successful bidirectional heal.

### TASK-SAVE-03: Save Corruption Quarantine Protocol
- **Finding IDs:** F-02, F-05
- **Owning ADR:** **ADR-02**
- **Files to Modify:** `assets/sdk/auromind-adapters.js`, `assets/sdk/auromind-sdk.js`
- **Description:** When an unrecoverable corrupted payload is encountered in local storage, archive the raw corrupted string to `localStorage['_corrupt_' + gameId + '_' + Date.now()]` before minting a clean initial envelope. Queue a `CORRUPT_PAYLOAD_QUARANTINED` critical telemetry event.
- **Dependencies:** `TASK-SAVE-01`.
- **Risks:** Storage exhaustion if corruption loops continuously. Mitigation: Cap quarantine archives at 3 per game.
- **Acceptance Criteria:** Corrupt data is never discarded without quarantine; game resets to clean playable state without throwing uncaught exceptions.
- **Unit Tests:** Inject garbage binary data; verify quarantine key creation.
- **Integration Tests:** Quarantine recovery test in `server.test.js`.
- **Browser Tests:** Verify UI alerts player gracefully after corruption event.
- **Regression Tests:** Healthy saves do not trigger quarantine logic.
- **Completion Evidence:** LocalStorage dump showing preserved quarantine record.

---

## 3. Workstream C: Shared SDK Singleton Lifecycle & Fallbacks

### TASK-SDK-01: SDK Singleton Hardening & Frozen Sub-Services
- **Finding IDs:** None (Structural)
- **Owning ADR:** **ADR-03** (Singleton Shared SDK)
- **Files to Modify:** `assets/sdk/auromind-sdk.js`
- **Description:** Ensure all sub-services (`sdk.identity`, `sdk.storage`, `sdk.sync`, `sdk.achievements`, `sdk.telemetry`, `sdk.purchases`) are frozen with `Object.freeze`. Isolate service errors so a failure in telemetry or sync never impairs identity or storage.
- **Dependencies:** `TASK-ID-01`, `TASK-SAVE-01`.
- **Risks:** Downstream code attempting to mutate SDK properties throwing in strict mode. Mitigation: Expose explicit setter methods where configuration updates are required.
- **Acceptance Criteria:** All sub-services return frozen objects; monkey-patching fails silently or throws in strict mode; SDK initialization promise resolves reliably.
- **Unit Tests:** Attempt to overwrite `sdk.identity` methods; verify immutability.
- **Integration Tests:** E2E Suite C tests 1–3.
- **Browser Tests:** Check `window.AuroMindSDK` in browser console.
- **Regression Tests:** Portal initialization flow continues passing.
- **Completion Evidence:** Test logs confirming `Object.isFrozen(sdk.identity) === true`.

### TASK-SDK-02: Standalone Game Offline Mock Fallback Engine
- **Finding IDs:** GAP-02
- **Owning ADR:** **ADR-03**, **ADR-10** (Provider-Independent Backend Adapter)
- **Files to Modify:** `assets/sdk/auromind-adapters.js`
- **Description:** Provide a reusable `createLocalMockBridge(gameId)` utility embedded into every game bridge. If a game is opened directly via standalone URL outside the portal theater (where `window.parent.AuroMindSDK` is absent), the bridge activates the mock fallback, saving progress to local storage with zero console errors.
- **Dependencies:** `TASK-SDK-01`.
- **Risks:** Divergent behavior between theater mode and standalone mode. Mitigation: Mock bridge enforces identical `GameSaveEnvelope` structure and checksums.
- **Acceptance Criteria:** Direct browser navigation to all 6 game HTML files boots and plays 100% offline with 0 uncaught errors.
- **Unit Tests:** Test bridge initialization with `window.parent === window`.
- **Integration Tests:** Standalone execution tests in `server.test.js`.
- **Browser Tests:** Playwright navigates directly to `games/auromatch/index.html` and `games/vak/index.html`.
- **Regression Tests:** E2E Suite B - 7 ("Direct standalone access loads without crashing") passes.
- **Completion Evidence:** Console error log count = 0 during standalone runs.

---

## 4. Workstream D: Six Game Adapter Bridge Implementations

### TASK-ADP-01: AuroBlocks Adapter Bridge Update
- **Finding IDs:** F-02, F-03
- **Owning ADR:** **ADR-02**
- **Files to Modify:** `games/auroblocks/assets/auroblocks-sdk-bridge.js`
- **Description:** Update existing bridge to replace string concatenation with `computePayloadChecksum()` (canonical SHA-256). Verify bidirectional save state synchronization between game loop and SDK envelope.
- **Dependencies:** `TASK-SAVE-01`, `TASK-SDK-02`.
- **Risks:** High-frequency block placements causing excessive checksum recomputation. Mitigation: Debounce save envelope extraction to 500ms.
- **Acceptance Criteria:** AuroBlocks save envelope contains valid 64-character SHA-256; high scores persist across reloads.
- **Unit Tests:** Test envelope generation and extraction for AuroBlocks.
- **Integration Tests:** AuroBlocks theatre launch test in `server.test.js`.
- **Browser Tests:** Play 1 round of AuroBlocks in Playwright; verify high score updates.
- **Regression Tests:** B17 CSP test (B17-DEFECT-04) continues passing.
- **Completion Evidence:** Verified save envelope JSON with valid SHA-256 hash.

### TASK-ADP-02: AuroMatch Standalone Adapter Bridge
- **Finding IDs:** F-03, F-05
- **Owning ADR:** **ADR-02**
- **Files to Create:** `games/auromatch/assets/auromatch-sdk-bridge.js`
- **Files to Modify:** `games/auromatch/index.html`
- **Description:** Author dedicated bridge module connecting AuroMatch's `storageAdapter.js` to the Shared SDK. Expose standardized `extractEnvelope()` and `applyEnvelope()`. Support standalone offline fallback.
- **Dependencies:** `TASK-SAVE-01`, `TASK-SAVE-02`, `TASK-SDK-02`.
- **Risks:** Storage race between internal `storageAdapter.js` and SDK bridge. Mitigation: Bridge acts as an observer/delegate over `storageAdapter.js`.
- **Acceptance Criteria:** AuroMatch progression envelope extracted with valid SHA-256; standalone play intact.
- **Unit Tests:** Contract validation test for AuroMatch adapter.
- **Integration Tests:** AuroMatch theatre launch and sync test.
- **Browser Tests:** Clear 1 level in AuroMatch; verify level count in parent portal.
- **Regression Tests:** AuroMatch audio and theme rendering intact.
- **Completion Evidence:** Source file exists, passes linter and contract tests.

### TASK-ADP-03: VAK Speech Control Dedicated SDK Bridge
- **Finding IDs:** F-03
- **Owning ADR:** **ADR-02**, **ADR-03**
- **Files to Create:** `games/vak/assets/vak-sdk-bridge.js`
- **Files to Modify:** `games/vak/index.html`
- **Description:** Author dedicated ES module bridge for VAK. Encapsulate `vak_game_data` localStorage reads/writes. Implement `extractEnvelope()`, `applyEnvelope()`, and standalone mock fallback.
- **Dependencies:** `TASK-SAVE-01`, `TASK-SDK-02`.
- **Risks:** Inadvertent modification of speech training corpus. Mitigation: Strict zero-touch rule for `speech_training_corpus.json`.
- **Acceptance Criteria:** VAK progress framed into standard envelope; standalone speech training works offline; corpus SHA-256 untouched.
- **Unit Tests:** Verify VAK envelope framing and checksumming.
- **Integration Tests:** `test/sdk-adapter-contracts.test.js` Suite 3.
- **Browser Tests:** Launch VAK in browser; verify microphone permission request and phoneme levels load.
- **Regression Tests:** VAK corpus SHA-256 test passes with exact hash `9fdb38...`.
- **Completion Evidence:** Source file created, corpus hash verified byte-exact.

### TASK-ADP-04: Word Riddle Dedicated SDK Bridge
- **Finding IDs:** F-03
- **Owning ADR:** **ADR-02**, **ADR-03**
- **Files to Create:** `games/word-riddle/assets/word-riddle-sdk-bridge.js`
- **Files to Modify:** `games/word-riddle/index.html`
- **Description:** Author dedicated ES module bridge for Word Riddle. Encapsulate `word_riddle_progress` storage. Implement `extractEnvelope()`, `applyEnvelope()`, and standalone mock fallback.
- **Dependencies:** `TASK-SAVE-01`, `TASK-SDK-02`.
- **Risks:** Conflict with bundled React app initialization. Mitigation: Bridge loads before bundled scripts and attaches to window bridge namespace.
- **Acceptance Criteria:** Word Riddle envelope extracted cleanly; solved riddles persist across reloads.
- **Unit Tests:** Contract validation for Word Riddle adapter.
- **Integration Tests:** Word Riddle theatre session test.
- **Browser Tests:** Launch Word Riddle; solve riddle 1; verify save envelope.
- **Regression Tests:** Bundled React theme loading passes.
- **Completion Evidence:** Source file created and verified.

### TASK-ADP-05: VAK Living Sanctuary Dedicated SDK Bridge
- **Finding IDs:** F-03
- **Owning ADR:** **ADR-02**, **ADR-03**
- **Files to Create:** `games/vak-living-sanctuary/assets/vak-living-sanctuary-sdk-bridge.js`
- **Files to Modify:** `games/vak-living-sanctuary/index.html`
- **Description:** Author dedicated ES module bridge for VAK Sanctuary. Encapsulate `vak_sanctuary_save_v1` storage. Implement `extractEnvelope()`, `applyEnvelope()`, and standalone mock fallback.
- **Dependencies:** `TASK-SAVE-01`, `TASK-SDK-02`.
- **Risks:** Inadvertent touch of Flora Botanical DB. Mitigation: Flora database file marked read-only in verification tests.
- **Acceptance Criteria:** Sanctuary progress framed into envelope; Flora DB byte count (2,002,176) and SHA-256 untouched.
- **Unit Tests:** Contract validation for Sanctuary adapter.
- **Integration Tests:** Sanctuary theatre session test.
- **Browser Tests:** Launch Sanctuary; verify plant growth and ambient audio.
- **Regression Tests:** Flora DB byte size and SHA-256 tests pass exact match.
- **Completion Evidence:** Source file created, Flora DB hash verified byte-exact.

---

## 5. Workstream E: Game-Specific Sync & Bespoke Domain Merging

### TASK-SYNC-01: Six-Game Bespoke Domain Merge Policies
- **Finding IDs:** F-07
- **Owning ADR:** **ADR-06** (Game-Specific Conflict Resolution), **ADR-04** (Guest Migration)
- **Files to Modify:** `assets/sdk/auromind-adapters.js`
- **Description:** Implement tailored, non-destructive merge algorithms in `resolveGameMerge()` for all six games. Enforce Invariants 1–4. Merge rules:
  - AuroBlocks: $\max(\text{highScore})$, Set union of unlocked stages.
  - AuroMatch: Set union of completed levels, max stars.
  - AuroMandala: Union of sessions, artwork entity conflict forking.
  - VAK Speech: Set union of phoneme levels, highest mastery score.
  - Word Riddle: Set union of solved riddles, max streak.
  - VAK Sanctuary: Monotonic max meditation minutes, Set union of discovered flora.
- **Dependencies:** `TASK-SAVE-01`, `TASK-ADP-01` through `TASK-ADP-05`.
- **Risks:** Progress regression during merge. Mitigation: Monotonic Set union guarantees unlocked items never regress.
- **Acceptance Criteria:** Merging two conflicting offline saves preserves the union of all progress across all 6 games.
- **Unit Tests:** `test/domain-merges.test.js` (6 dedicated merge test suites).
- **Integration Tests:** `test/save-integrity-merge.test.js` Suite 7.
- **Browser Tests:** Multi-tab merge simulation in Playwright.
- **Regression Tests:** Non-destructive Invariants 1–3 verified.
- **Completion Evidence:** Test logs showing zero regressions across 20 synthetic merge scenarios.

### TASK-SYNC-02: Durable Outbox IndexedDB Persistence
- **Finding IDs:** F-02
- **Owning ADR:** **ADR-05** (Local-Authoritative Sync Outbox)
- **Files to Modify:** `assets/sdk/auromind-sdk.js`
- **Description:** Migrate sync outbox queue from in-memory array to persistent IndexedDB store (`platform_sync_outbox`). Queue pending game saves immediately on write. When online, dispatch with exponential backoff (1s, 2s, 4s... max 15m). Offline gameplay is never blocked.
- **Dependencies:** `TASK-ID-01`, `TASK-SAVE-01`.
- **Risks:** Outbox queue deadlock on persistent 4xx/5xx errors. Mitigation: Max 5 retries before marking operation `REQUIRES_USER_SYNC` while leaving local save intact.
- **Acceptance Criteria:** Saves queued while offline persist across tab reloads; queue drains automatically upon network reconnect.
- **Unit Tests:** Outbox queueing, retry backoff, and serialization tests.
- **Integration Tests:** Simulated offline outbox sync test in `server.test.js`.
- **Browser Tests:** Disconnect network in Playwright; execute 5 game saves; reconnect network; verify outbox drains.
- **Regression Tests:** Local save is committed instantly regardless of outbox state.
- **Completion Evidence:** IndexedDB inspection confirming outbox persistence and clean drain.

---

## 6. Workstream F: AuroMandala Versioned Artwork Protection

### TASK-ART-01: AuroMandala UUIDv4 Artwork Schema & Version History
- **Finding IDs:** F-01
- **Owning ADR:** **ADR-06**, **ADR-02**
- **Files to Modify:** `games/auromandala/assets/auromandala-sdk-bridge.js`
- **Description:** Migrate `savedArtworks` from ordered array to UUIDv4 entity map (`artworks: Record<string, VersionedArtworkEntity>`). Track `artworkId`, `currentVersion`, `createdAt`, `updatedAt`, `deleted`, `deletedAt`, and up to 10 historical snapshots. Provide dual-read migration: convert legacy array to entity map on first load while archiving raw legacy backup to `localStorage.pranamandala_legacy_backup`. Deeply hash all artwork strokes into payload checksum.
- **Dependencies:** `TASK-SAVE-01`.
- **Risks:** Data loss during legacy array migration. Mitigation: Dual-read fallback and raw backup archive before write.
- **Acceptance Criteria:** Legacy artworks convert cleanly to UUIDv4 entities; modifying a stroke alters checksum; historical snapshots preserved.
- **Unit Tests:** `test/mandala-artwork-schema.test.js` (Migration, hashing, history).
- **Integration Tests:** `test/save-integrity-merge.test.js` Suite 1.
- **Browser Tests:** Open AuroMandala in browser; draw strokes; verify UUIDv4 entity in localStorage.
- **Regression Tests:** Canvas rendering, symmetry presets, and export SVG functionality remain intact.
- **Completion Evidence:** Checksum verification log and localStorage dump.

### TASK-ART-02: AuroMandala Conflict Forking & Tombstone Deletion Sync
- **Finding IDs:** F-01
- **Owning ADR:** **ADR-06**
- **Files to Modify:** `games/auromandala/assets/auromandala-sdk-bridge.js`, `assets/sdk/auromind-adapters.js`
- **Description:** Implement conflict forking: If incoming cloud artwork has identical `artworkId` but different `strokesHash`, fork incoming artwork into a new entity with fresh UUIDv4 and display title `[Title] (Cloud Copy)`. Local artwork is never overwritten. Deletions record soft-delete tombstones (`deleted: true`, `deletedAt: ISO`) preventing stale remote snapshots from resurrecting deleted mandalas.
- **Dependencies:** `TASK-ART-01`, `TASK-SYNC-01`.
- **Risks:** Ghost resurrections or duplicate forking loops. Mitigation: Forked entity receives `forkedFromId` metadata to track lineage.
- **Acceptance Criteria:** Concurrent edits on two devices fork cleanly into two distinct mandalas; soft-deleted mandalas remain deleted across sync.
- **Unit Tests:** `test/mandala-conflict-forking.test.js`.
- **Integration Tests:** Multi-device simulated conflict merge in `server.test.js`.
- **Browser Tests:** Playwright simulation of concurrent mandala edits.
- **Regression Tests:** Non-conflicting artwork syncs cleanly without forking.
- **Completion Evidence:** Verified artwork dictionary containing both original and `(Cloud Copy)` entities.

---

## 7. Workstream G: Shared SDK Achievements Service

### TASK-ACH-01: Shared SDK Achievements Service & Monotonic Union
- **Finding IDs:** F-06
- **Owning ADR:** **ADR-03**, **ADR-02**
- **Files to Modify:** `assets/sdk/auromind-sdk.js`, `assets/sdk/auromind-adapters.js`
- **Description:** Implement `sdk.achievements` service namespace. Expose typed `init()`, `unlock()`, `incrementProgress()`, `getAllAchievements()`. Persist achievement state locally in IndexedDB/localStorage. Enforce idempotence: duplicate unlocks emit zero events. Enforce monotonic progression: remote sync executes monotonic union ($\max(\text{progress}), \min(\text{unlockedAt})$).
- **Dependencies:** `TASK-SDK-01`, `TASK-SAVE-01`.
- **Risks:** Toast notification spam during bulk unlock. Mitigation: Queue achievement notifications and suppress during active meditation in Sanctuary and AuroMandala.
- **Acceptance Criteria:** Multiple rapid `unlock()` calls execute idempotently; offline unlocks persist; remote sync never revokes unlocked status.
- **Unit Tests:** `test/achievements-service.test.js`.
- **Integration Tests:** `test/sdk-adapter-contracts.test.js` Suite 6.
- **Browser Tests:** Trigger level clear in AuroMatch; verify achievement unlock badge in Portal UI.
- **Regression Tests:** Portal gamer score calculation remains consistent.
- **Completion Evidence:** Test logs demonstrating idempotent duplicate suppression and monotonic merge.

---

## 8. Workstream H: Purchase & Entitlement Infrastructure

### TASK-COMM-01: Provider-Independent Purchases Interface & Mock Engine
- **Finding IDs:** GAP-04, GAP-05
- **Owning ADR:** **ADR-08** (Purchase and Entitlement Architecture), **ADR-10**
- **Files to Modify:** `assets/sdk/auromind-sdk.js`, `assets/sdk/config/backend-config.js`
- **Description:** Implement `sdk.purchases` interface exposing `requestPurchase(sku)`, `restorePurchases()`, and `hasEntitlement(sku)`. Implement `MockPurchaseProvider` supporting simulated checkout, success, decline, and refund events for automated testing. Keep `COMMERCIAL_GATE_ENABLED: false` in `backend-config.js` to ensure 100% free beta for launch.
- **Dependencies:** `TASK-SDK-01`.
- **Risks:** Commercial gate accidentally locking content in launch mode. Mitigation: Invariant test asserting `hasEntitlement()` returns `true` for all SKUs when `COMMERCIAL_GATE_ENABLED: false`.
- **Acceptance Criteria:** Entire purchase flow executes in test harness with zero network calls; launch switch keeps platform completely free.
- **Unit Tests:** `test/purchases-mock.test.js`.
- **Integration Tests:** Entitlement conformance tests in `server.test.js`.
- **Browser Tests:** Verify Portal Settings displays "Supporter Pass" status cleanly.
- **Regression Tests:** All games load and play all levels with zero paywalls.
- **Completion Evidence:** Verified test report for mock purchase, restore, and refund.

### TASK-COMM-02: Ed25519 Token Verification & Clock Manipulation Defense
- **Finding IDs:** GAP-04
- **Owning ADR:** **ADR-08**
- **Files to Modify:** `assets/sdk/auromind-sdk.js`
- **Description:** Implement Ed25519 public-key signature verification using Web Crypto API. Support recommended 30-day offline grace period. Cross-check device clock against monotonic timestamp anchors in save envelopes and Service Worker headers. If clock rollback detected, compute grace period from monotonic elapsed time. Revoked tokens degrade gracefully without deleting user creations.
- **Dependencies:** `TASK-COMM-01`.
- **Risks:** Device clock tampering. Mitigation: Monotonic anchors prevent artificial extension of grace period.
- **Acceptance Criteria:** Valid Ed25519 tokens verified offline; tampered tokens rejected; expired tokens (>30 days offline) prompt gentle refresh; user artwork preserved upon revocation.
- **Unit Tests:** `test/ed25519-entitlements.test.js`.
- **Integration Tests:** Clock skew simulation test in `server.test.js`.
- **Browser Tests:** Offline entitlement verification in Playwright.
- **Regression Tests:** Free tier access unaffected by entitlement token presence/absence.
- **Completion Evidence:** Cryptographic verification logs for valid, forged, and expired tokens.

---

## 9. Workstream I: 3-Tier Telemetry Queue & Privacy Sanitizer

### TASK-TEL-01: 3-Tier Telemetry Queue & Saturation Overflow Policy
- **Finding IDs:** F-08
- **Owning ADR:** **ADR-09** (Privacy, Telemetry & Sankalpa Exclusion), **ADR-03**
- **Files to Modify:** `assets/sdk/auromind-sdk.js`
- **Description:** Implement 500-event capacity buffer partitioned into CRITICAL (100, IDB-backed, never dropped), ENGAGEMENT (300, memory FIFO), and DIAGNOSTIC (100, memory, aggressive eviction). On queue full, drop DIAGNOSTIC first, then ENGAGEMENT. If CRITICAL tier is full, log observable console error, increment `critical_overflow_count` in localStorage, and prepend overflow incident to next batch. Support consent withdrawal and queue purge.
- **Dependencies:** `TASK-SDK-01`.
- **Risks:** Telemetry dispatch blocking main thread. Mitigation: Batched dispatch during `requestIdleCallback` or every 30s.
- **Acceptance Criteria:** 600 simulated events drop Tier 3 first; CRITICAL events never lost; opt-out immediately purges local queue.
- **Unit Tests:** `test/telemetry-queue.test.js`.
- **Integration Tests:** `test/sdk-adapter-contracts.test.js` Suite 8.
- **Browser Tests:** Playwright test verifying zero network calls after consent revocation.
- **Regression Tests:** B10 Suite 1 (Consent lifecycle) continues passing.
- **Completion Evidence:** Queue dump verifying tiered eviction and purge behavior.

### TASK-TEL-02: Pre-Queue Privacy Sanitizer & Sankalpa E2EE Isolation
- **Finding IDs:** F-08, GAP-03
- **Owning ADR:** **ADR-09**
- **Files to Modify:** `assets/sdk/auromind-sdk.js`, `assets/sdk/config/backend-config.js`
- **Description:** Implement deep pre-queue privacy sanitizer. Purge all occurrences of `sankalpa`, user intentions, private reflections, and raw speech audio. Enforce that Sankalpa Vault is `cloudSyncEligible: false` and encrypted locally with AES-GCM-256.
- **Dependencies:** `TASK-TEL-01`.
- **Risks:** Leaking private spiritual prayers. Mitigation: Regex and recursive key blacklist purges forbidden keys before queueing.
- **Acceptance Criteria:** Sankalpa text is 100% stripped from telemetry; encrypted locally; zero cloud sync exposure.
- **Unit Tests:** `test/privacy-sanitizer.test.js`.
- **Integration Tests:** Sacred privacy invariant tests in `server.test.js`.
- **Browser Tests:** Verify telemetry payload in browser network tab contains zero PII.
- **Regression Tests:** B8 Security Test 18 (No telemetry leakage) passes.
- **Completion Evidence:** Test assertion confirming 100% removal of sensitive keys.

---

## 10. Workstream J: Multi-Host CSP & Edge Deployment Security

### TASK-CSP-01: Multi-Host Production CSP & Static Edge Configs
- **Finding IDs:** F-09
- **Owning ADR:** **ADR-07**, **ADR-10**
- **Files to Create:** `vercel.json`, `_headers`, `netlify.toml`
- **Files to Modify:** `server.js`
- **Description:** Deploy unified CSP, `X-Frame-Options: SAMEORIGIN`, and `Permissions-Policy` across Vercel, Cloudflare Pages, Netlify, and local Express. Directives enforce `frame-ancestors 'self'` (blocking external framing while permitting portal theatre iframe), `object-src 'none'`, and pre-authorizes future Supabase endpoints (`connect-src https://*.supabase.co wss://*.supabase.co`). Account for GitHub Pages HTTP response header limitations.
- **Dependencies:** None.
- **Risks:** Broken asset loading if external CDNs are blocked. Mitigation: Whitelist `https://cdn.jsdelivr.net` and `https://fonts.googleapis.com`.
- **Acceptance Criteria:** All edge config files share identical security headers; external framing blocked; standalone and portal execution functional.
- **Unit Tests:** `test/csp-configs.test.js` (Parse all config files; assert header parity).
- **Integration Tests:** `test/storage-resilience-csp.test.js` Suite 9.
- **Browser Tests:** Playwright CSP violation listener confirms 0 CSP violation reports during complete gameplay session.
- **Regression Tests:** B17-DEFECT-04 (AuroBlocks CSP inline script compliance) passes.
- **Completion Evidence:** Verified header response dumps across all four hosting configurations.

---

## 11. Workstream K: Platform Integration & Regression Gates

### TASK-REG-01: Platform-Wide Regression & Sacred Invariant Verification Gate
- **Finding IDs:** GAP-06
- **Owning ADR:** Platform Baseline
- **Files to Modify:** `test/sacred-invariants.test.js`
- **Description:** Execute complete automated regression test run. Verify that all 251 baseline tests pass with 0 failures and 0 warnings. Verify that VAK speech corpus matches SHA-256 `9fdb38...` (1,368 levels). Verify Flora Botanical DB measures exactly 2,002,176 bytes, 46,321 LF lines, and matches SHA-256 `689d03...`. Verify Sankalpa Vault local-only E2EE.
- **Dependencies:** All previous tasks (`TASK-ID-01` through `TASK-CSP-01`).
- **Risks:** Unintended byte drift during batch authoring. Mitigation: Preflight and postflight SHA-256 assertions block build on mismatch.
- **Acceptance Criteria:** 251/251 baseline tests pass; 42 new test assertions pass; 100% offline air-gapped execution; zero invariant drift.
- **Unit Tests:** Full test suite execution (`node --test`).
- **Integration Tests:** Complete E2E simulation.
- **Browser Tests:** Playwright full theater regression across all 6 games.
- **Regression Tests:** 100% of historical tests passing.
- **Completion Evidence:** Complete test runner summary: `pass 293, fail 0, cancelled 0`.
