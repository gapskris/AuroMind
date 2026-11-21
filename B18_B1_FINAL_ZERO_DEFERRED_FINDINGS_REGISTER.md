# AuroMasti B18-B1 — Final Zero-Deferred Findings Register
## Uncompromised Technical Defect & Architecture Gap Reconciliation

- **Document Version:** 1.0.0
- **Batch Reference:** B18-B1 Final ADR Clarification & Approval Preparation
- **Canonical Workspace:** `C:\AuroMindPortal`
- **Target Release:** January 1, 2027
- **Non-Negotiable Policy:** Zero issues deferred due to priority or launch disabled status.
- **Governance Status:** PENDING OWNER APPROVAL

---

## 1. Governance Policy Statement

In strict compliance with the Product Owner's directive:
1. **Zero Deferral by Priority:** No P1, P2, or P3 issue may be postponed or marked "deferred" simply because lower priority findings are perceived as less urgent.
2. **Zero Deferral by Launch State:** Capabilities that will remain disabled at launch (such as commercial purchasing gates under ADR-08) must be **fully designed, implemented, and validated in test harnesses**, rather than deferred.
3. **Valid Permitted Statuses:** Only the following statuses are assigned: `Designed`, `Awaiting owner decision`, `Ready for implementation`, `Implemented`, `Validated`, or `Blocked by a named external dependency`.

---

## 2. Master Findings & Architectural Gaps Register

| Issue ID | Original Priority | Description | Owning ADR | Current Status | Remediation Phase |
|:---|:---:|:---|:---:|:---:|:---:|
| **F-01** | **P1** | AuroMandala Artwork Overwrite Risk | **ADR-06**, ADR-02 | **Designed** (Awaiting Owner Decision) | **B18-B1** |
| **F-02** | **P1** | Weak / Inconsistent Checksum Computation | **ADR-02**, ADR-05 | **Designed** (Awaiting Owner Decision) | **B18-B1** |
| **F-03** | **P1** | Missing Standalone Adapters (3 games) | **ADR-02**, **ADR-03**, ADR-10 | **Designed** (Awaiting Owner Decision) | **B18-B1** |
| **F-04** | **P2** | Storage Eviction Vulnerability (ITP / LRU) | **ADR-01**, **ADR-07** | **Designed** (Awaiting Owner Decision) | **B18-B1** |
| **F-05** | **P2** | AuroMatch Auto-Healing Logic Flaw | **ADR-01**, **ADR-07** | **Designed** (Awaiting Owner Decision) | **B18-B1** |
| **F-06** | **P2** | Missing Achievements Service Contract | **ADR-03**, ADR-02 | **Designed** (Awaiting Owner Decision) | **B18-B1** |
| **F-07** | **P2** | Domain Merge Policy Discrepancies | **ADR-06**, ADR-04 | **Designed** (Awaiting Owner Decision) | **B18-B1** |
| **F-08** | **P3** | Telemetry Queue Overflow & Privacy Risk | **ADR-09**, ADR-03 | **Designed** (Awaiting Owner Decision) | **B18-B1** |
| **F-09** | **P3** | Production CSP & Hosting Discrepancies | **ADR-07**, ADR-10 | **Designed** (Awaiting Owner Decision) | **B18-B1** |
| **GAP-01** | **P1** | Single Identity Rule Enforcement | **ADR-01** | **Designed** (Awaiting Owner Decision) | **B18-B1** |
| **GAP-02** | **P2** | Standalone Game Offline Degradation | **ADR-03** | **Designed** (Awaiting Owner Decision) | **B18-B1** |
| **GAP-03** | **P1** | Sankalpa Vault Local-Only Isolation | **ADR-09** | **Validated** (Cryptographically Enforced) | **B18-B1** |
| **GAP-04** | **P2** | Offline Entitlements & Clock Skew | **ADR-08** | **Designed** (Awaiting Owner Decision) | **B18-B1** / **B18-B** |
| **GAP-05** | **P2** | Refund & Revocation Non-Destructive | **ADR-08** | **Designed** (Awaiting Owner Decision) | **B18-B** |
| **GAP-06** | **P1** | Sacred Data Asset Byte Immutability | **ADR-02**, **ADR-07** | **Validated** (Byte-Exact SHA-256) | **B18-B1** |

---

## 3. Deep Issue Specifications

### F-01: AuroMandala Artwork Overwrite Risk (P1)
- **Current Evidence:** `games/auromandala/assets/auromandala-sdk-bridge.js` computes checksum only over `highestStageCleared` and `sessions.length`. Local artworks were wiped by blanket `localStorage.setItem` on envelope apply.
- **Owning ADR:** ADR-06 (Conflict Resolution), ADR-02 (Save Envelope).
- **Technical Resolution:** Restructure `savedArtworks` to UUIDv4 entity map with monotonic versions, soft deletes, and conflict forking into `(Cloud Copy)`. Checksum deeply hashes all strokes.
- **Implementation Dependency:** ADR-02 canonical hashing.
- **Acceptance Criteria:** Overwrite impossible; concurrent edits fork cleanly into separate local artworks.
- **Regression Tests:** `test/save-integrity-merge.test.js` Suite 1 (4 test cases).
- **Status:** **Designed** (Awaiting Owner Decision).

### F-02: Weak / Inconsistent Checksum Computation (P1)
- **Current Evidence:** AuroBlocks uses string concatenation (`blocks_${score}_${len}`); AuroMatch uses level count string. Internal payload mutations are ignored.
- **Owning ADR:** ADR-02 (Save Envelope), ADR-05 (Sync Outbox).
- **Technical Resolution:** Canonical JSON serialization with recursive key sorting; Web Crypto SHA-256 excluding transport metadata (`clientUpdatedAt`, `baseRevision`, `guestId`).
- **Implementation Dependency:** Browser `crypto.subtle`.
- **Acceptance Criteria:** Mutating any internal property alters checksum; key re-ordering leaves checksum identical.
- **Regression Tests:** `test/sdk-adapter-contracts.test.js` Suite 2 (4 test cases).
- **Status:** **Designed** (Awaiting Owner Decision).

### F-03: Missing Standalone Adapters for VAK, Word Riddle, Sanctuary (P1)
- **Current Evidence:** `games/vak/assets/`, `games/word-riddle/assets/`, and `games/vak-living-sanctuary/assets/` lack standalone ES module bridge files. Games rely on ad-hoc global scripts.
- **Owning ADR:** ADR-02 (Save Envelope), ADR-03 (Shared SDK), ADR-10 (Backend Adapter).
- **Technical Resolution:** Author dedicated bridge modules (`vak-sdk-bridge.js`, `word-riddle-sdk-bridge.js`, `vak-living-sanctuary-sdk-bridge.js`) with self-contained mock fallbacks.
- **Implementation Dependency:** ADR-02 envelope contract.
- **Acceptance Criteria:** All 6 games communicate through standardized bridge interface; zero global namespace pollution.
- **Regression Tests:** `test/sdk-adapter-contracts.test.js` Suite 3 (4 test cases).
- **Status:** **Designed** (Awaiting Owner Decision).

### F-04: Storage Eviction Vulnerability (ITP / LRU) (P2)
- **Current Evidence:** No calls to `navigator.storage.persist()` exist in codebase. Safari ITP wipes storage after 7 days of inactivity; Chromium LRU purges origins under disk pressure.
- **Owning ADR:** ADR-01 (Canonical Identity), ADR-07 (Local Authority).
- **Technical Resolution:** Non-blocking `navigator.storage.persist()` registration during bootstrap; quota monitoring with telemetry warnings at 80% usage.
- **Implementation Dependency:** `navigator.storage` API.
- **Acceptance Criteria:** SDK calls `navigator.storage.persist()` without blocking page load; storage persistence state tracked.
- **Regression Tests:** `test/storage-resilience-csp.test.js` Suite 4 (2 test cases).
- **Status:** **Designed** (Awaiting Owner Decision).

### F-05: AuroMatch Auto-Healing Logic Flaw (P2)
- **Current Evidence:** In `games/auromatch/src/controllers/storageAdapter.js`, `autoHealFromIndexedDB()` aborts if `localStorage.getItem('auro_match_user')` is truthy, blocking recovery if localStorage contains corrupt or empty string.
- **Owning ADR:** ADR-01 (Canonical Identity), ADR-07 (Local Authority).
- **Technical Resolution:** Deep payload validation verifying `completedLevels` structure. Legitimate empty saves (`completedLevels: []`) accepted as valid; corrupt strings trigger auto-healing from IDB; bidirectional sync restores IDB from LS.
- **Implementation Dependency:** IDB and LS access.
- **Acceptance Criteria:** Corrupt LS restores from IDB; valid empty save is not flagged as corrupt; wiped IDB restores from LS.
- **Regression Tests:** `test/storage-resilience-csp.test.js` Suite 5 (3 test cases).
- **Status:** **Designed** (Awaiting Owner Decision).

### F-06: Missing Achievements Service Contract (P2)
- **Current Evidence:** Games write unstructured achievement keys to `localStorage` with no deduplication or cloud sync envelope.
- **Owning ADR:** ADR-03 (Shared SDK), ADR-02 (Save Envelope).
- **Technical Resolution:** Formal `sdk.achievements` API supporting idempotent `unlock()`, monotonic progress tracking, and monotonic union merge.
- **Implementation Dependency:** ADR-01, ADR-03.
- **Acceptance Criteria:** Duplicate unlocks are no-ops; progress increments monotonically; cloud sync preserves highest progress.
- **Regression Tests:** `test/sdk-adapter-contracts.test.js` Suite 6 (3 test cases).
- **Status:** **Designed** (Awaiting Owner Decision).

### F-07: Domain Merge Policy Discrepancies (P2)
- **Current Evidence:** Inconsistent merge rules across games risking progress regression during multi-tab or offline merges.
- **Owning ADR:** ADR-06 (Conflict Resolution), ADR-04 (Guest Migration).
- **Technical Resolution:** Tailored non-destructive merge policies for all 6 games in `auromind-adapters.js`: Max high scores, Set union of levels, monotonic minutes.
- **Implementation Dependency:** ADR-02, ADR-06.
- **Acceptance Criteria:** Merging two offline saves never regresses unlocked levels or high scores.
- **Regression Tests:** `test/save-integrity-merge.test.js` Suite 7 (6 test cases).
- **Status:** **Designed** (Awaiting Owner Decision).

### F-08: Telemetry Queue Overflow & Privacy Risk (P3)
- **Current Evidence:** `assets/sdk/auromind-sdk.js` array capped at 200 drops events arbitrarily on overflow, is lost on reload, and has no privacy filter.
- **Owning ADR:** ADR-09 (Privacy & Telemetry), ADR-03 (Shared SDK).
- **Technical Resolution:** 3-tier queue (CRITICAL, ENGAGEMENT, DIAGNOSTIC) capped at 500 events; CRITICAL persisted in IDB; saturation policy increments observable overflow counter; pre-queue privacy sanitizer.
- **Implementation Dependency:** ADR-03, ADR-09.
- **Acceptance Criteria:** Queue overflow drops Tier 3 first; CRITICAL events never silently lost; forbidden keys purged.
- **Regression Tests:** `test/sdk-adapter-contracts.test.js` Suite 8 (3 test cases).
- **Status:** **Designed** (Awaiting Owner Decision).

### F-09: Production CSP & Hosting Discrepancies (P3)
- **Current Evidence:** Strict CSP in `server.js` absent from static deployment configs.
- **Owning ADR:** ADR-07 (Local Authority), ADR-10 (Backend Adapter).
- **Technical Resolution:** Unified CSP, `X-Frame-Options: SAMEORIGIN`, and `Permissions-Policy` matching `server.js` deployed across `vercel.json`, `_headers` (Cloudflare), and `netlify.toml`.
- **Implementation Dependency:** Hosting edge configuration.
- **Acceptance Criteria:** Identical security headers across supporting hosts; external framing blocked.
- **Regression Tests:** `test/storage-resilience-csp.test.js` Suite 9 (3 test cases).
- **Status:** **Designed** (Awaiting Owner Decision).

### GAP-01 through GAP-06: Architecture Gaps
- **GAP-01 (P1): Single Identity Rule:** One browser profile = one persistent player identity. Designed.
- **GAP-02 (P2): Standalone Offline Degradation:** In-bridge local mock fallbacks. Designed.
- **GAP-03 (P1): Sankalpa Vault Local-Only Isolation:** `cloudSyncEligible: false`, AES-GCM-256. Validated.
- **GAP-04 (P2): Offline Entitlements & Clock Skew:** Server-signed Ed25519 tokens with monotonic anchor checks. Designed.
- **GAP-05 (P2): Refund & Revocation Non-Destructive:** Content preserved, premium feature access revoked. Designed.
- **GAP-06 (P1): Sacred Data Asset Byte Immutability:** VAK corpus and Flora DB byte-exact SHA-256 match. Validated.
