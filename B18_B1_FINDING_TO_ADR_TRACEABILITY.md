# AuroMasti B18-B1 — Finding to ADR Traceability Matrix
## Complete Mapping of Findings F-01 through F-09 and Architectural Gaps to Original ADRs

- **Document Version:** 1.0.0
- **Batch Reference:** B18-B1 Formal Architecture Decision Review
- **Canonical Workspace:** `C:\AuroMindPortal`
- **Target Release:** January 1, 2027
- **Findings Traceability Scope:** All original findings F-01 through F-09 (with un-downgraded priorities) plus all discovered architectural gaps.

---

## 1. Master Traceability Matrix

| Finding / Gap ID | Original Priority | Description | Owning Original ADR(s) | Remediation Phase | Resolution Status |
| :--- | :---: | :--- | :--- | :---: | :---: |
| **F-01** | **P1** | AuroMandala Artwork Overwrite Risk | **ADR-06** (Conflict Resolution)<br>**ADR-02** (Save Envelope) | **B18-B1** | **Designed** (Awaiting Owner Decision) |
| **F-02** | **P1** | Weak / Inconsistent Checksums | **ADR-02** (Save Envelope)<br>**ADR-05** (Sync Outbox) | **B18-B1** | **Designed** (Awaiting Owner Decision) |
| **F-03** | **P1** | Missing Standalone Adapters (VAK, Riddle, Sanctuary) | **ADR-02** (Save Envelope)<br>**ADR-03** (Shared SDK)<br>**ADR-10** (Backend Adapter) | **B18-B1** | **Designed** (Awaiting Owner Decision) |
| **F-04** | **P2** | Storage Eviction Vulnerability (ITP / LRU) | **ADR-01** (Canonical Identity)<br>**ADR-07** (Local Authority) | **B18-B1** | **Designed** (Awaiting Owner Decision) |
| **F-05** | **P2** | AuroMatch Auto-Healing Logic Flaw | **ADR-01** (Canonical Identity)<br>**ADR-07** (Local Authority) | **B18-B1** | **Designed** (Awaiting Owner Decision) |
| **F-06** | **P2** | Missing Shared SDK Achievements API | **ADR-03** (Shared SDK)<br>**ADR-02** (Save Envelope) | **B18-B1** | **Designed** (Awaiting Owner Decision) |
| **F-07** | **P2** | Domain Merge Policy Discrepancies | **ADR-06** (Conflict Resolution)<br>**ADR-04** (Guest Migration) | **B18-B1** | **Designed** (Awaiting Owner Decision) |
| **F-08** | **P3** | Telemetry Queue Overflow & Privacy Risk | **ADR-09** (Privacy & Telemetry)<br>**ADR-03** (Shared SDK) | **B18-B1** | **Designed** (Awaiting Owner Decision) |
| **F-09** | **P3** | Production CSP & Hosting Discrepancies | **ADR-07** (Local Authority)<br>**ADR-10** (Backend Adapter) | **B18-B1** | **Designed** (Awaiting Owner Decision) |
| **GAP-01** | **P1** | Single Identity Rule Enforcement | **ADR-01** (Canonical Identity) | **B18-B1** | **Designed** (Awaiting Owner Decision) |
| **GAP-02** | **P2** | Standalone Game Offline Degradation | **ADR-03** (Shared SDK) | **B18-B1** | **Designed** (Awaiting Owner Decision) |
| **GAP-03** | **P1** | Sankalpa Vault Local-Only E2EE Guarantee | **ADR-09** (Privacy & Telemetry) | **B18-B1** | **Designed** (Awaiting Owner Decision) |
| **GAP-04** | **P2** | Offline Entitlement Verification & Clock Skew | **ADR-08** (Purchase & Entitlement) | **B18-B1** / **B18-B** | **Designed** (Awaiting Owner Decision) |
| **GAP-05** | **P2** | Refund & Revocation Non-Destructive Handling | **ADR-08** (Purchase & Entitlement) | **B18-B** | **Designed** (Awaiting Owner Decision) |
| **GAP-06** | **P1** | Sacred Data Asset Byte-Exact Immutability | **ADR-02**, **ADR-07**, **ADR-09** | **B18-B1** | **Designed & Validated** |

---

## 2. Deep Finding & Gap Breakdown

---

### Finding F-01 (Priority: P1) — AuroMandala Artwork Overwrite Risk

- **Owning ADRs:** **ADR-06** (Game-Specific Conflict Resolution), **ADR-02** (Versioned Opaque Save Payloads)
- **Root Cause:** In `games/auromandala/assets/auromandala-sdk-bridge.js`, the save checksum only hashed `highestStageCleared` and `sessions.length`. The `savedArtworks` array was completely omitted from the hash. During `applyEnvelope()`, the bridge executed a blind `localStorage.setItem('pranamandala_game_cache_v2')`, overwriting any artworks created locally while offline.
- **Proposed Resolution:**
  1. Migrate artwork storage schema from an ordered array to a map keyed by immutable UUIDv4 (`artworkId`).
  2. Maintain monotonic entity versions (`version: number`, `updatedAt: ISO`).
  3. Implement soft deletions via tombstone records (`deleted: true`, `deletedAt: ISO`) to prevent resurrection.
  4. Implement **conflict forking**: If an incoming cloud envelope contains an artwork with identical `artworkId` but differing strokes/hashes, the incoming copy is assigned a fresh UUIDv4 with the title appended with `" (Cloud Copy)"`. Local artwork is never overwritten.
- **Dependencies:** ADR-01 (UUID generator), ADR-02 (Canonical JSON hash).
- **Acceptance Criteria:**
  - Locally created mandalas are never lost or overwritten during sync.
  - Deleted mandalas do not reappear from stale cloud snapshots.
  - Conflicting edits on two devices fork cleanly into two separate artworks.
- **Regression Test Requirements:** `test/save-integrity-merge.test.js` Suite 1 (4 test cases).
- **Implementation Phase:** **Phase B18-B1** (Shared Services SDK Remediation).

---

### Finding F-02 (Priority: P1) — Weak / Inconsistent Checksum Computation

- **Owning ADRs:** **ADR-02** (Versioned Opaque Save Payloads), **ADR-05** (Local-Authoritative Sync Outbox)
- **Root Cause:** Game bridges used fragile ad-hoc string concatenation (`blocks_${highScore}_${stages.length}`) that failed to detect deep mutations (e.g. changes to individual level scores, custom strokes, or settings).
- **Proposed Resolution:**
  1. Implement standardized canonical JSON serialization with deterministic recursive key sorting.
  2. Compute cryptographic SHA-256 hashes using Web Crypto API (`crypto.subtle.digest('SHA-256', ...)`).
  3. Explicitly exclude transitory transport fields (`clientUpdatedAt`, `baseRevision`, `guestId`) from the checksum calculation.
- **Dependencies:** Web Crypto API availability (with graceful fallback in non-secure contexts).
- **Acceptance Criteria:**
  - Objects with identical data in different key orders produce identical hashes.
  - Any internal data mutation alters the hash.
  - Updating transport metadata leaves the checksum invariant.
- **Regression Test Requirements:** `test/sdk-adapter-contracts.test.js` Suite 2 (4 test cases).
- **Implementation Phase:** **Phase B18-B1** (Shared Services SDK Remediation).

---

### Finding F-03 (Priority: P1) — Missing Standalone Adapters (VAK, Word Riddle, Sanctuary)

- **Owning ADRs:** **ADR-02** (Save Envelope), **ADR-03** (Singleton Shared SDK), **ADR-10** (Backend Adapter)
- **Root Cause:** VAK, Word Riddle, and VAK Sanctuary lacked dedicated ES module adapter bridges. They relied on direct global script injection and ad-hoc `localStorage` reads, breaking encapsulation and preventing envelope framing.
- **Proposed Resolution:**
  1. Author three dedicated standalone bridge modules:
     - `games/vak/assets/vak-sdk-bridge.js`
     - `games/word-riddle/assets/word-riddle-sdk-bridge.js`
     - `games/vak-living-sanctuary/assets/vak-living-sanctuary-sdk-bridge.js`
  2. Implement standardized `extractEnvelope()`, `applyEnvelope()`, and `onSaveStateChanged()` methods.
  3. Include local offline mock fallback to ensure games can run standalone outside the portal theater.
- **Dependencies:** ADR-02, ADR-03.
- **Acceptance Criteria:**
  - All 6 games communicate through standardized adapter bridge interfaces.
  - Zero direct cross-game `localStorage` key bleeding.
  - Standalone game execution succeeds offline with zero uncaught exceptions.
- **Regression Test Requirements:** `test/sdk-adapter-contracts.test.js` Suite 3 (4 test cases).
- **Implementation Phase:** **Phase B18-B1** (Shared Services SDK Remediation).

---

### Finding F-04 (Priority: P2) — Storage Eviction Vulnerability (ITP / LRU)

- **Owning ADRs:** **ADR-01** (Canonical Player Identity), **ADR-07** (Local Operational Authority)
- **Root Cause:** The portal never requested persistent storage permission via `navigator.storage.persist()`. Safari's Intelligent Tracking Prevention (ITP) purges script-writable storage after 7 days of inactivity, and Chromium/Firefox evict LRU origins under disk storage pressure.
- **Proposed Resolution:**
  1. Implement `AuroMindStorageResilienceManager` in the Shared SDK.
  2. Non-blockingly invoke `navigator.storage.persist()` on platform initialization.
  3. Query `navigator.storage.estimate()` and emit a CRITICAL telemetry warning if quota consumption exceeds 80%.
  4. Expose storage persistence status in Portal Settings.
- **Dependencies:** Browser `navigator.storage` API.
- **Acceptance Criteria:**
  - SDK calls `navigator.storage.persist()` on startup without blocking page load.
  - Storage persistence state is tracked and queryable via `sdk.storage.isPersisted`.
- **Regression Test Requirements:** `test/storage-resilience-csp.test.js` Suite 4 (2 test cases).
- **Implementation Phase:** **Phase B18-B1** (Shared Services SDK Remediation).

---

### Finding F-05 (Priority: P2) — AuroMatch Auto-Healing Logic Flaw

- **Owning ADRs:** **ADR-01** (Canonical Player Identity), **ADR-07** (Local Operational Authority)
- **Root Cause:** In `games/auromatch/src/controllers/storageAdapter.js`, `autoHealFromIndexedDB()` checked `if (localStorage.getItem('auro_match_user')) return;`. If `localStorage` contained an empty object `{}`, invalid JSON, or truncated data, auto-healing aborted, permanently refusing to restore from valid IndexedDB.
- **Proposed Resolution:**
  1. Implement deep payload validation (`validateAuroMatchSavePayload`) verifying `completedLevels.length > 0`.
  2. If `localStorage` is corrupt or empty, auto-heal from IndexedDB.
  3. Implement bidirectional sync: If IndexedDB is empty/corrupt but `localStorage` is valid, restore IndexedDB from `localStorage`.
- **Dependencies:** IndexedDB and localStorage access.
- **Acceptance Criteria:**
  - Corrupt or empty `localStorage` string recovers valid progression from IndexedDB.
  - Wiped IndexedDB recovers progression from `localStorage`.
- **Regression Test Requirements:** `test/storage-resilience-csp.test.js` Suite 5 (3 test cases).
- **Implementation Phase:** **Phase B18-B1** (Shared Services SDK Remediation).

---

### Finding F-06 (Priority: P2) — Missing Shared SDK Achievements API

- **Owning ADRs:** **ADR-03** (Singleton Shared SDK), **ADR-02** (Versioned Opaque Save Payloads)
- **Root Cause:** The Shared SDK lacked an achievements namespace. Games recorded progress into ad-hoc `localStorage` keys without deduplication, atomic unlocks, or cloud sync envelopes.
- **Proposed Resolution:**
  1. Design and implement `sdk.achievements` service namespace on the SDK singleton.
  2. Provide typed `init()`, `unlock()`, `incrementProgress()`, and `getAllAchievements()`.
  3. Enforce strict monotonicity and idempotency (duplicate unlocks are no-ops).
  4. Support monotonic union merge during cloud sync (Max Progress, Earliest Unlock Time).
- **Dependencies:** ADR-01, ADR-03.
- **Acceptance Criteria:**
  - Calling `unlock()` repeatedly for the same ID does not emit duplicate events.
  - Monotonic union preserves highest progress and earliest unlock timestamp.
- **Regression Test Requirements:** `test/sdk-adapter-contracts.test.js` Suite 6 (3 test cases).
- **Implementation Phase:** **Phase B18-B1** (Shared Services SDK Remediation).

---

### Finding F-07 (Priority: P2) — Domain Merge Policy Discrepancies

- **Owning ADRs:** **ADR-06** (Game-Specific Conflict Resolution), **ADR-04** (Guest Identity Migration)
- **Root Cause:** Conflict resolution rules were inconsistent across games. AuroBlocks only compared high scores, while AuroMatch compared level counts, risking regressions during multi-tab or offline merges.
- **Proposed Resolution:**
  1. Author tailored, deterministic merge functions in `auromind-adapters.js`:
     - **AuroBlocks:** $\max(\text{highScore})$, union of unlocked stages.
     - **AuroMatch:** Union of completed level arrays, max stars per level.
     - **AuroMandala:** Union of sessions, fork-on-conflict for artwork entities.
     - **VAK Speech:** Union of completed phoneme levels, preserve highest mastery score.
     - **Word Riddle:** Union of solved riddle IDs, max streak counter.
     - **VAK Sanctuary:** Monotonic max of meditation minutes, union of discovered flora.
- **Dependencies:** ADR-02, ADR-06.
- **Acceptance Criteria:**
  - Merging two offline saves never regresses unlocked levels or high scores.
- **Regression Test Requirements:** `test/save-integrity-merge.test.js` Suite 7 (6 test cases).
- **Implementation Phase:** **Phase B18-B1** (Shared Services SDK Remediation).

---

### Finding F-08 (Priority: P3) — Telemetry Queue Overflow & Privacy Risk

- **Owning ADRs:** **ADR-09** (Privacy, Telemetry & Sankalpa Exclusion), **ADR-03** (Shared SDK)
- **Root Cause:** The telemetry queue in `auromind-sdk.js` was an unprioritized in-memory array capped at 200 items that dropped oldest events indiscriminately on overflow, was lost on tab reload, and lacked an automated deep privacy filter.
- **Proposed Resolution:**
  1. Restructure telemetry queue into 3 priority tiers: CRITICAL (100), ENGAGEMENT (300), DIAGNOSTIC (100), total capacity capped at 500.
  2. CRITICAL events are never evicted and are persisted in IndexedDB across reloads.
  3. Overflow evicts DIAGNOSTIC events first, then ENGAGEMENT events.
  4. Implement pre-queue privacy sanitizer stripping `sankalpa`, user intentions, private reflections, and raw audio.
- **Dependencies:** ADR-03, ADR-09.
- **Acceptance Criteria:**
  - Queue overflow drops Tier 3 diagnostic events first, preserving Tier 1 critical errors.
  - Page refresh restores pending critical telemetry events from IndexedDB.
  - Forbidden keys are 100% purged from telemetry payloads.
- **Regression Test Requirements:** `test/sdk-adapter-contracts.test.js` Suite 8 (3 test cases).
- **Implementation Phase:** **Phase B18-B1** (Shared Services SDK Remediation).

---

### Finding F-09 (Priority: P3) — Production CSP & Hosting Discrepancies

- **Owning ADRs:** **ADR-07** (Local Operational Authority), **ADR-10** (Provider-Independent Backend Adapter)
- **Root Cause:** The strict Content Security Policy enforced by `server.js` was absent from static edge hosting deployment definitions (`vercel.json`, `_headers`, `netlify.toml`), leaving production iframes vulnerable to clickjacking.
- **Proposed Resolution:**
  1. Codify unified CSP, `X-Frame-Options: SAMEORIGIN`, and `Permissions-Policy` matching `server.js` across `vercel.json`, `_headers` (Cloudflare), and `netlify.toml`.
  2. Restrict frame ancestors to `'self'`.
  3. Pre-authorize future Supabase endpoints (`https://*.supabase.co`, `wss://*.supabase.co`) in `connect-src`.
- **Dependencies:** Static hosting providers.
- **Acceptance Criteria:**
  - All hosting config files share identical security headers and CSP directives.
  - External framing of the portal is blocked.
- **Regression Test Requirements:** `test/storage-resilience-csp.test.js` Suite 9 (3 test cases).
- **Implementation Phase:** **Phase B18-B1** (Shared Services SDK Remediation).

---

### GAP-01: Single Identity Rule Enforcement

- **Owning ADR:** **ADR-01** (Canonical Player Identity Model)
- **Description:** System must strictly enforce one browser profile = one persistent player identity. In-app multiple profiles, profile pickers, player switching, and session-boundary dialogs are completely forbidden.
- **Resolution:** `assets/sdk/auromind-sdk.js` and `portal.js` expose no multi-profile APIs. All games share the single guest identity.
- **Implementation Phase:** **Phase B18-B1**.

---

### GAP-02: Standalone Game Offline Degradation

- **Owning ADR:** **ADR-03** (Singleton Shared SDK)
- **Description:** Direct browser navigation to individual game URLs (e.g. `games/auromatch/index.html`) outside the portal iframe must play 100% offline without throwing SDK missing errors.
- **Resolution:** Every game adapter bridge includes a self-contained local mock fallback (`window.AuroMindSDK || LocalMockBridge`).
- **Implementation Phase:** **Phase B18-B1**.

---

### GAP-03: Sankalpa Vault Local-Only E2EE Guarantee

- **Owning ADR:** **ADR-09** (Privacy, Telemetry & Sankalpa Exclusion)
- **Description:** Intimate spiritual prayers, vows, and contemplations in AuroMandala must remain strictly on the local device, encrypted with AES-GCM-256, and never synced to the cloud or logged to telemetry.
- **Resolution:** Explicitly configured as `cloudSyncEligible: false` and `localOnlyVaults: ['sankalpa_e2ee_vault']`. Telemetry sanitizer strips any field named `sankalpa` or `intention`.
- **Implementation Phase:** **Phase B18-B1**.

---

### GAP-04: Offline Entitlement Verification & Clock Skew Defense

- **Owning ADR:** **ADR-08** (Purchase and Entitlement Architecture)
- **Description:** When commercial purchasing is activated, entitlements must be verifiable offline without constant phone-home, while defending against device clock manipulation.
- **Resolution:** SDK caches server-signed Ed25519 tokens with a 30-day offline grace period. Monotonic timestamp anchors in saves and Service Worker headers prevent clock rollback exploits.
- **Implementation Phase:** **Phase B18-B1** (Client Contract) & **Phase B18-B** (Cloud Architecture).

---

### GAP-05: Refund & Revocation Non-Destructive Handling

- **Owning ADR:** **ADR-08** (Purchase and Entitlement Architecture)
- **Description:** If a payment is refunded or an entitlement revoked, premium features are disabled gracefully without deleting user-created content (e.g., mandalas drawn with premium colors remain viewable).
- **Resolution:** The entitlement manager downgrades access flags while preserving all user-created content.
- **Implementation Phase:** **Phase B18-B** (Supabase Schema & Security Design).

---

### GAP-06: Sacred Data Asset Byte-Exact Immutability

- **Owning ADRs:** **ADR-02**, **ADR-07**, **ADR-09**
- **Description:** VAK Speech Training Corpus (SHA-256: `9fdb38...`) and Flora Botanical Database (2,002,176 bytes, SHA-256: `689d03...`) must remain untouched across all development batches.
- **Resolution:** Automated test suites enforce byte-exact SHA-256 checks before and after every build.
- **Implementation Phase:** **Phase B18-B1** (Validated in baseline).
