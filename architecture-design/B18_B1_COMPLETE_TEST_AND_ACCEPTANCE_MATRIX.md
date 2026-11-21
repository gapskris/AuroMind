# AuroMasti B18-B1 — Complete Test & Acceptance Matrix
## Multi-Tier Validation Framework, Sacred Invariant Guards, and Acceptance Thresholds

- **Document Version:** 1.0.0
- **Batch Reference:** B18-B1 Master Implementation Execution Plan
- **Canonical Workspace:** `C:\AuroMindPortal`
- **Target Release:** January 1, 2027
- **Test Runner Frameworks:** Node.js Native Runner (`node --test`), Playwright E2E (`@playwright/test`)
- **Baseline Test Count:** 251 tests passing -> **Target Suite Count: 293 tests passing** (42 new assertions)

---

## 1. Test Architecture & Quality Gates

The B18-B1 test framework enforces strict, uncompromised quality gates across five testing tiers:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                       5-TIER AUTOMATED TEST ARCHITECTURE                        │
├────────┬────────────────────────────────┬──────────────────────────┬────────────┤
│ TIER   │ TEST SCOPE                     │ FRAMEWORK / SUITE FILE   │ COUNT      │
├────────┼────────────────────────────────┼──────────────────────────┼────────────┤
│ Tier 1 │ Platform Baseline Regression   │ `server.test.js`         │ 251 tests  │
│ Tier 2 │ Sacred Invariants Verification │ `sacred-invariants.test` │ 4 tests    │
│ Tier 3 │ Unit & Contract Specifications │ `sdk-contracts.test.js`  │ 18 tests   │
│ Tier 4 │ Save Integrity & Merge Engine  │ `save-merge.test.js`     │ 12 tests   │
│ Tier 5 │ Real-Browser E2E Simulation    │ `e2e/b18-b1-e2e.spec.js` │ 8 tests    │
├────────┴────────────────────────────────┴──────────────────────────┼────────────┤
│ TOTAL VALIDATION TARGET                                            │ 293 tests  │
└────────────────────────────────────────────────────────────────────┴────────────┘
```

---

## 2. Sacred Data Invariant Verification Guards

The platform holds three sacred data assets that **MUST NEVER DRIFT BY A SINGLE BYTE**:

| Sacred Asset | Canonical Workspace Path | Exact Required Invariant | Automated Test Gate |
| :--- | :--- | :--- | :--- |
| **VAK Speech Corpus** | `games/vak/assets/data/speech_training_corpus.json` | SHA-256: `9fdb3826030049c9eab183479bcb7fe29304b3ea08d045c8c67f1cfd4d77da09`<br>Levels count: exactly 1,368 levels | `test/sacred-invariants.test.js` Assertion 1 |
| **Flora Botanical DB** | `games/vak-living-sanctuary/assets/data/flora_database.json` | Byte Size: exactly 2,002,176 bytes<br>Line Count: 46,321 (LF) / 46,322 (CRLF)<br>SHA-256: `689d035cd52abd8d342528d8c5f61f298916b8052b8287450be4931cf8ae1a3a` | `test/sacred-invariants.test.js` Assertion 2 |
| **Sankalpa Vault E2EE** | `assets/sdk/config/backend-config.js` | `cloudSyncEligible: false`<br>`localOnlyVaults: ['sankalpa_e2ee_vault']`<br>AES-GCM-256 local-only encryption | `test/sacred-invariants.test.js` Assertion 3 |

---

## 3. Comprehensive Acceptance Test Matrix

| Test Suite / Area | Test ID | Target Component | Scenario & Input Condition | Expected Architectural Outcome | Pass Threshold |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Baseline Regression** | **TR-BASE-01** | Platform Core | Run full existing automated test suite (`node --test`). | All 251 tests pass with zero failures and zero warnings. | 251/251 passing |
| **Identity & Concurrency** | **TR-ID-01** | Web Locks Identity | 5 browser tabs open simultaneously within 50ms. | All tabs converge on identical `guest_<uuidv4>`; earliest timestamp wins. | 100% convergence |
| **Storage Resilience** | **TR-ID-02** | Persistence Manager | Browser executes `navigator.storage.persist()`. | Non-blocking call; `sdk.storage.isPersisted` accurately caches state. | Zero page lag |
| **Storage Failure** | **TR-ID-03** | Ephemeral Mode | Both IDB and localStorage throw storage full errors. | In-memory RAM storage activates; amber portal banner displays; game unblocked. | Zero crashes |
| **Canonical Hashing** | **TR-HASH-01** | SHA-256 Engine | Identical payload with inverted JSON key ordering. | Canonical key sorting produces byte-identical 64-char SHA-256 hash. | 100% hash parity |
| **Metadata Exclusion** | **TR-HASH-02** | Checksum Target | Mutate `baseRevision` from 1 to 2 and update `clientUpdatedAt`. | Checksum remains 100% identical; payload content untouched. | Zero hash change |
| **AuroMatch Auto-Heal**| **TR-MATCH-01**| Storage Adapter | Brand-new player launches game (`completedLevels: []`). | Empty array validated as legitimate non-corrupt save; accepted cleanly. | Zero false alarms |
| **AuroMatch Recovery** | **TR-MATCH-02**| Storage Adapter | Corrupt truncated string in `localStorage`. | Auto-heals from valid IDB; corrupt data archived to quarantine key. | Zero progress loss |
| **Standalone Bridges** | **TR-ADP-01** | VAK Bridge | Direct browser navigation to `games/vak/index.html`. | Dedicated bridge initializes; mock fallback activates; zero uncaught errors. | 0 console errors |
| **Standalone Bridges** | **TR-ADP-02** | Word Riddle Bridge| Direct browser navigation to `games/word-riddle/index.html`. | Dedicated bridge initializes; solved riddles persist to localStorage. | 0 console errors |
| **Standalone Bridges** | **TR-ADP-03** | Sanctuary Bridge | Direct navigation to `games/vak-living-sanctuary/index.html`.| Dedicated bridge initializes; offline service worker precaches shell. | 0 console errors |
| **Artwork Versioning** | **TR-ART-01** | AuroMandala Schema| Legacy array loaded into new bridge. | Converted cleanly to UUIDv4 entity map; legacy backup archived. | 100% converted |
| **Artwork Forking** | **TR-ART-02** | Conflict Engine | Device A & Device B concurrently edit same mandala ID. | Device A preserved; Device B forked into new entity `[Title] (Cloud Copy)`. | Zero strokes lost |
| **Soft Deletions** | **TR-ART-03** | Tombstone Engine | Player deletes mandala locally; remote snapshot arrives. | Tombstone record (`deleted: true`) prevents ghost resurrection. | Mandala remains deleted |
| **Domain Merges** | **TR-MERGE-01**| Bespoke Merges | Merging two offline saves across all 6 games. | High scores take max; levels take Set union; minutes take max. | Zero progress regression |
| **Durable Outbox** | **TR-OUT-01** | Sync Outbox | 10 saves executed while offline; browser tab reloaded. | Saves persist in IndexedDB outbox; drain in order upon network reconnect. | 10/10 saves synced |
| **Achievements API** | **TR-ACH-01** | Achievements Service| Calling `unlock('match_zen_journey')` 5 times in rapid succession. | First call returns `firstUnlock: true`; next 4 calls return `false` (no-op). | Zero duplicate events |
| **Purchase Mock** | **TR-COMM-01** | Purchases Service | Request purchase of supporter pass via `MockPurchaseProvider`. | Simulated checkout succeeds; token issued; content unlocked in test mode. | 100% mock success |
| **Offline Entitlement**| **TR-COMM-02** | Entitlements Guard | Offline player verifies cached Ed25519 token. | Valid token grants access for 30-day grace period; clock rollback detected. | Non-tamperable |
| **Launch Switch** | **TR-COMM-03** | Config Guard | `COMMERCIAL_GATE_ENABLED: false` set in `backend-config.js`. | All 520 AuroMatch levels and 1,368 VAK levels open unconditionally. | Zero paywalls |
| **Telemetry Buffer** | **TR-TEL-01** | 3-Tier Queue | Push 600 events offline (150 critical, 350 engagement, 100 diagnostic). | Total buffer caps at 500; Tier 3 evicted first; Tier 1 critical never dropped. | 0 critical drops |
| **Sacred Privacy Gate**| **TR-TEL-02** | Privacy Sanitizer | Push event containing `sankalpa`, journal notes, and raw audio. | Pre-queue filter purges 100% of sensitive keys; only clean metrics queued. | Zero PII / reflection leaks |
| **Multi-Host CSP** | **TR-CSP-01** | Security Headers | Check `server.js`, `vercel.json`, `_headers`, and `netlify.toml`. | Identical CSP directives; `frame-ancestors 'self'` present across all files. | 100% header parity |
| **Mobile & Desktop** | **TR-E2E-01** | Playwright E2E | Mobile viewport (390x844) and Desktop (1920x1080) sessions. | Zero horizontal overflow; theater open/close smooth; Senior Mode syncs. | 0 layout glitches |

---

## 4. Measurable Acceptance Thresholds

To achieve formal signoff for Phase B18-B1, the test runner must satisfy the following thresholds:

| Metric | Required Threshold | Verification Command |
| :--- | :--- | :--- |
| **Total Passing Tests** | $\ge 293$ tests passing | `npm test` |
| **Failed Tests** | **0 failures** | `npm test` |
| **Cancelled / Skipped Tests** | **0 cancelled / skipped** | `npm test` |
| **Sacred Corpus SHA-256** | `9fdb3826030049c9eab183479bcb7fe29304b3ea08d045c8c67f1cfd4d77da09` | `node test/sacred-invariants.test.js` |
| **Flora DB Byte Size** | `2,002,176 bytes` | `node test/sacred-invariants.test.js` |
| **Flora DB Line Count** | `46,321 lines` (LF) | `node test/sacred-invariants.test.js` |
| **Network Calls During Offline Test** | **0 external HTTP requests** | Network socket inspection in test runner |
| **Application Source Files Modified in Planning** | **0 files** | `git status -s` |
