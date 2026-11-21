# AuroMasti B18-B1 — Final Technical Exception Register
## Exhaustive Risk Inventory, Edge Cases, Browser Limitations, and Defensible Security Boundaries

- **Document Version:** 1.0.0 (Official Governance Register)
- **Batch Reference:** B18-B1 Final Decision Preparation & Technical Closure
- **Canonical Workspace:** `C:\AuroMindPortal`
- **Active Git Branch:** `dev/studio-integration`
- **Baseline HEAD:** `b6ccc860bb7d38a70ef678049a9588b8b73c40aa`
- **Target Release:** January 1, 2027
- **Governance Mandate:** Strictly expose all unresolved risks and edge cases without concealment or premature mitigation assumptions.

---

## 1. Classification Taxonomy

To ensure clarity for the Product Owner, every technical exception and edge condition is classified into one of four rigid operational categories:

1. **`MUST_RESOLVE_BEFORE_APPROVAL`:** Fundamental governance ambiguity that requires Product Owner determination before ADR signoff.
2. **`MUST_RESOLVE_DURING_IMPLEMENTATION`:** Known engineering defect or gap with a verified technical design that must be implemented and validated across Batches 1–7.
3. **`MUST_RESOLVE_BEFORE_PRODUCTION`:** Infrastructure, hosting, or deployment requirement that must be satisfied before public launch on January 1, 2027.
4. **`ACCEPTED_PRODUCT_LIMITATION`:** Inherent platform, browser sandbox, or cryptographic reality that cannot be eliminated by code and requires explicit Product Owner acceptance.

---

## 2. Technical Exception Register

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          TECHNICAL EXCEPTION REGISTER                           │
├────┬─────────────────────────────────────────────────┬──────────────────────────┤
│ #  │ EXCEPTION / EDGE CONDITION                      │ CLASSIFICATION           │
├────┼─────────────────────────────────────────────────┼──────────────────────────┤
│ 1  │ Four Outstanding Product Policy Choices         │ MUST_RESOLVE_BEFORE_APPR │
│ 2  │ Production Hosting & Response Header Strategy   │ MUST_RESOLVE_BEFORE_PROD │
│ 3  │ Browser Storage Eviction Reality (`persist()`)  │ ACCEPTED_LIMITATION      │
│ 4  │ Offline Clock Tampering Defense in Browser      │ ACCEPTED_LIMITATION      │
│ 5  │ Critical Telemetry Saturation on Storage Loss   │ ACCEPTED_LIMITATION      │
│ 6  │ Historical Browser Test-Runner Provenance       │ MUST_RESOLVE_DURING_IMP  │
│ 7  │ Missing Standalone Bridges (VAK, Riddle, Sanct) │ MUST_RESOLVE_DURING_IMP  │
│ 8  │ AuroMatch storageAdapter Auto-Healing Bug       │ MUST_RESOLVE_DURING_IMP  │
│ 9  │ AuroMandala Concurrent Artwork Overwrite Flaw   │ MUST_RESOLVE_DURING_IMP  │
│ 10 │ Sacred Invariants Preservation (VAK & Flora)    │ NON_NEGOTIABLE_INVARIANT │
└────┴─────────────────────────────────────────────────┴──────────────────────────┘
```

---

## 3. In-Depth Technical Exception Analysis

---

### Exception 1: Four Outstanding Product Policy Choices
- **Classification:** `MUST_RESOLVE_BEFORE_APPROVAL`
- **Affected Tasks:** `TASK-ID-03`, `TASK-ART-02`, `TASK-COMM-02`, `TASK-TEL-01`.
- **Technical Description:** While the technical architecture for ephemeral RAM storage, conflict forking, Ed25519 verification, and telemetry queueing is fully designed, exact presentation parameters and constants depend on Product Owner policy selection (Choice A: Storage failure UI; Choice B: Artwork conflict label; Choice C: Offline grace duration; Choice D: Telemetry cloud retention).
- **Engineering Resolution:** The 24-task implementation plan separates the 20 unblocked tasks from these 4 tasks. The Product Owner selects preferred options on the decision sheet before code authoring.

---

### Exception 2: Production Hosting & Response Header Strategy
- **Classification:** `MUST_RESOLVE_BEFORE_PRODUCTION`
- **Governing ADRs:** ADR-07, ADR-10
- **Affected Task:** `TASK-CSP-01`
- **Technical Reality:** GitHub Pages is a purely static host and cannot inject custom HTTP response headers (`frame-ancestors 'self'`). JavaScript frame-busting scripts (`window.top !== window.self`) **do not provide equivalent protection** because an attacker framing the site with `<iframe sandbox="allow-scripts allow-forms">` blocks top navigation, rendering the frame-buster ineffective.
- **Engineering Resolution:** The Product Owner must choose between Option 1 (GitHub Pages behind a Cloudflare proxy with Transform Rules) or Option 2 (Direct deployment to Cloudflare Pages or Vercel). Prior to production cutover, all 8 security acceptance tests must pass.

---

### Exception 3: Browser Storage Eviction Reality (`navigator.storage.persist()`)
- **Classification:** `ACCEPTED_PRODUCT_LIMITATION`
- **Governing ADRs:** ADR-01, ADR-07
- **Affected Task:** `TASK-ID-02`
- **Technical Reality:** `navigator.storage.persist()` is a browser permission request that exempts an origin from automated background LRU storage eviction under low disk pressure in Chromium and Gecko, and relaxes Safari ITP script storage purges. **It is NOT an absolute guarantee against data loss.** It cannot prevent explicit user clearing of browser history/cache, browser profile deletion, browser uninstallation, or disk corruption.
- **Engineering Mitigation:** Dual-store persistence (IndexedDB + localStorage), non-blocking quota telemetry at 80% capacity, and one-click manual JSON backup export (`.auromind-backup.json`) provide robust multi-layered recovery. Explicit Product Owner acceptance is required.

---

### Exception 4: Offline Clock Tampering Defense in Browser Sandbox
- **Classification:** `ACCEPTED_PRODUCT_LIMITATION`
- **Governing ADR:** ADR-08
- **Affected Task:** `TASK-COMM-02`
- **Technical Reality:** In an untrusted client web browser running on user hardware, `performance.now()` resets to 0 upon reload, restart, or reboot. Any timestamp stored in IndexedDB or localStorage can be edited by a user with root access or Developer Tools. Therefore, a mathematically tamper-proof 30-day offline guarantee in a client browser is **technically impossible**.
- **Engineering Mitigation:** Defensible multi-layered time oracle tracking persistent monotonic offline deltas in IndexedDB (`cumulative_offline_seconds`), cross-checked against save envelope timestamps, clamped against clock rollbacks, and triggering immediate expiry on forward clock leaps. Commercial gates remain false for launch. Explicit Product Owner acceptance is required.

---

### Exception 5: Critical Telemetry Saturation During Catastrophic Storage Loss
- **Classification:** `ACCEPTED_PRODUCT_LIMITATION`
- **Governing ADR:** ADR-09
- **Affected Task:** `TASK-TEL-01`
- **Technical Reality:** An event overflow counter (`critical_overflow_count`) provides visibility when queue buffers are full, but if the browser crashes abruptly or the disk experience catastrophic write failure before IndexedDB flushes, uncommitted in-flight events can be lost.
- **Engineering Mitigation:** 100-event IndexedDB buffer for critical events, atomic localStorage counter fallback, 50-event emergency RAM ring buffer, and `navigator.sendBeacon()` on unload. Acknowledged as an inherent limitation of client-side web runtimes.

---

### Exception 6: Historical Browser Test-Runner Provenance
- **Classification:** `MUST_RESOLVE_DURING_IMPLEMENTATION`
- **Owning Scope:** Platform Baseline / Regression Gate
- **Affected Task:** `TASK-REG-01`
- **Technical Reality:** While exactly 251 tests pass via Node.js native test runner (`node --test`), historical B17.4 browser-level validation utilized a custom in-browser harness and did not execute Playwright Test CLI. Claiming historical Playwright CLI runs would be inaccurate.
- **Engineering Mitigation:** In Phase B18-B1, Playwright test suites will be formally authored and executed to validate multi-tab Web Locks, standalone game launches, and iframe framing. Target remains exactly 293 verified tests (251 baseline + 42 new).

---

### Exception 7: Missing Standalone Bridges for VAK, Word Riddle & Sanctuary
- **Classification:** `MUST_RESOLVE_DURING_IMPLEMENTATION`
- **Governing ADRs:** ADR-02, ADR-03
- **Affected Tasks:** `TASK-ADP-03`, `TASK-ADP-04`, `TASK-ADP-05`
- **Technical Reality:** Standalone bridge files do not currently exist in the source tree for VAK Speech Control, Word Riddle, and VAK Living Sanctuary (Finding F-03).
- **Engineering Mitigation:** Batch 3 authors dedicated standalone bridges extracting standardized envelopes and embedding local mock fallbacks (`createLocalMockBridge`) while keeping educational content 100% frozen.

---

### Exception 8: AuroMatch `storageAdapter.js` Auto-Healing Bug
- **Classification:** `MUST_RESOLVE_DURING_IMPLEMENTATION`
- **Governing ADRs:** ADR-01, ADR-07
- **Affected Tasks:** `TASK-SAVE-02`, `TASK-ADP-02`
- **Technical Reality:** In `games/auromatch/src/controllers/storageAdapter.js`, legitimate empty arrays (`completedLevels: []`) are rejected as invalid, causing auto-healing to falsely treat clean saves as corrupt (Finding F-05).
- **Engineering Mitigation:** Remediate `storageAdapter.js` deep schema validation in Batch 1; author external SDK bridge in Batch 3.

---

### Exception 9: AuroMandala Concurrent Artwork Overwrite Flaw
- **Classification:** `MUST_RESOLVE_DURING_IMPLEMENTATION`
- **Governing ADRs:** ADR-06, ADR-02
- **Affected Tasks:** `TASK-ART-01`, `TASK-ART-02`
- **Technical Reality:** Legacy code stores artworks in an unindexed raw array (`savedArtworks`), causing incoming cloud sync envelopes to execute blanket `setItem` overwrites, silently destroying local player artwork (Finding F-01).
- **Engineering Mitigation:** Migrate to UUIDv4 entity dictionary with 10 snapshots in Batch 3; implement conflict forking into `[Title] (Cloud Copy)` and soft deletion tombstones in Batch 4.

---

### Exception 10: Sacred Data Invariants Protection
- **Classification:** `NON_NEGOTIABLE_INVARIANT`
- **Owning Scope:** Sacred Platform Invariants
- **Affected Task:** `TASK-REG-01`
- **Technical Invariant:**
  - VAK Speech Training Corpus: SHA-256 `9fdb3826030049c9eab183479bcb7fe29304b3ea08d045c8c67f1cfd4d77da09` (1,368 levels).
  - Flora Botanical Database: 2,002,176 bytes, 46,321 lines (LF), SHA-256 `689d035cd52abd8d342528d8c5f61f298916b8052b8287450be4931cf8ae1a3a`.
  - Sankalpa Vault: Local-only E2EE with AES-GCM-256 (`cloudSyncEligible: false`).
- **Enforcement:** Preflight and postflight hash checks in `TASK-REG-01`. Any byte drift halts implementation immediately. Zero modifications authorized.