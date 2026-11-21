# AuroMasti B18-B1 — Final Test Count & Acceptance Register
## Reconciled 251-to-293 Test Count Model, 18-Domain Acceptance Matrix, and Verification Distinctions

- **Document Version:** 1.0.0
- **Batch Reference:** B18-B1 Implementation Plan Reconciliation & Final Acceptance
- **Canonical Workspace:** `C:\AuroMindPortal`
- **Active Git Branch:** `dev/studio-integration`
- **Target Release:** January 1, 2027
- **Test Frameworks:** Node.js Native Runner (`node --test`), Playwright E2E (`@playwright/test`)
- **Baseline Executed Status:** **251 / 251 tests passing** (Measured at HEAD `b6ccc860bb7d38a70ef678049a9588b8b73c40aa`)
- **Target Reconciled Suite:** **293 tests passing** (251 Baseline + 42 New Test Cases)

---

## 1. Reconciled Test-Count Model (251 Baseline -> 293 Target)

To prevent confusion between individual test cases, assertions, and test suites, the test accounting model is formally partitioned below:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          RECONCILED TEST ACCOUNTING MODEL                       │
├────────────────────────────────────────┬─────────────┬───────────┬──────────────┤
│ CATEGORY / SUITE GROUP                 │ TEST CASES  │ STATUS    │ EXECUTION    │
├────────────────────────────────────────┼─────────────┼───────────┼──────────────┤
│ 1. Current Verified Baseline           │ 251 tests   │ Pass 251, │ Node native  │
│    - Identity, adapters, sync, audio,  │             │ Fail 0    │ & Playwright │
│      manifests, theatre, B17.1-B17.4   │             │ (VERIFIED)│ test runner  │
├────────────────────────────────────────┼─────────────┼───────────┼──────────────┤
│ 2. New Stage 1 & 2 Unit Tests          │ 12 tests    │ Designed  │ Node native  │
│    - Canonical JSON, SHA-256, WebLocks │             │ (Pending) │ `crypto`     │
├────────────────────────────────────────┼─────────────┼───────────┼──────────────┤
│ 3. New Stage 3 Game Adapter Contracts  │ 12 tests    │ Designed  │ Adapter mock │
│    - AuroMatch, VAK, Riddle, Sanctuary │             │ (Pending) │ harnesses    │
├────────────────────────────────────────┼─────────────┼───────────┼──────────────┤
│ 4. New Stage 4 Sync & Artwork Tests    │ 8 tests     │ Designed  │ Multi-device │
│    - Bespoke merges, Mandala forking   │             │ (Pending) │ simulations  │
├────────────────────────────────────────┼─────────────┼───────────┼──────────────┤
│ 5. New Stage 5 & 6 Platform Services   │ 10 tests    │ Designed  │ Telemetry &  │
│    - Achievements, Ed25519, 3-tier tel │             │ (Pending) │ MockCommerce │
├────────────────────────────────────────┼─────────────┼───────────┼──────────────┤
│ TOTAL COMBINED ACCEPTANCE TARGET       │ 293 tests   │ Target    │ Full air-gap │
└────────────────────────────────────────┴─────────────┴───────────┴──────────────┘
```

### Verification Terminology Standard:
- **`VERIFIED`:** Applies **only** to the existing 251 baseline tests and the three sacred data invariants where live automated execution logs and byte-exact SHA-256 hashes have been recorded in this workspace.
- **`DESIGNED / PENDING`:** Applies to all 42 new test cases specified for authoring during Phase B18-B1 Implementation.

---

## 2. 18-Domain Comprehensive Acceptance Matrix

| Domain # | Architectural Focus Area | Specific Acceptance Scenario | Test Type | Expected Observable Result | Verification Status |
|:---:|:---|:---|:---:|:---|:---:|
| **1** | **Multi-Tab Identity** | 5 browser tabs open simultaneously within 50ms. | Integration / Browser | Web Locks coordinate startup; all 5 tabs converge on identical `guestId`; earliest timestamp wins. | **VERIFIED** in baseline (Tests 4–6) |
| **2** | **Storage Corruption & Recovery** | LocalStorage contains truncated invalid JSON `{"profile": {`. | Unit / Integration | Deep validator rejects corrupt string; auto-heals from valid IndexedDB; corrupt data archived to quarantine key. | Designed / Pending (`TASK-SAVE-02`) |
| **3** | **Storage Eviction Limitations** | Browser grants `navigator.storage.persist()`. | Unit / Browser | Origin marked persistent; quota monitored; storage alert emitted if disk $\ge 80\%$. | Designed / Pending (`TASK-ID-02`) |
| **4** | **Private Browsing** | Portal loaded in Safari / Chrome Private Mode. | Browser E2E | Storage full error handled cleanly; in-memory RAM mode activates; amber portal banner displays; play unblocked. | Designed / Pending (`TASK-ID-03`) |
| **5** | **Save Integrity** | Payload object with inverted dictionary key order. | Unit | `canonicalizeJson()` sorts keys lexicographically; Web Crypto SHA-256 hash is byte-identical. | Designed / Pending (`TASK-SAVE-01`) |
| **6** | **All Six Game Adapters** | Direct browser navigation to all 6 game HTML files. | Browser E2E | All 6 games initialize dedicated bridge with mock fallback; save progress; 0 console errors. | Designed / Pending (`TASK-ADP-01..05`) |
| **7** | **Offline/Reconnect Sync** | 10 saves executed with network offline; tab reloaded. | Integration / Browser | Saves persist in IndexedDB outbox; drain in chronological order upon network reconnection. | Designed / Pending (`TASK-SYNC-02`) |
| **8** | **Conflict Resolution** | Offline progression merge across all 6 games. | Unit / Integration | Invariants 1–4 enforced; high scores take max; levels take Set union; minutes take max. | Designed / Pending (`TASK-SYNC-01`) |
| **9** | **Artwork History & Restoration** | Concurrent mandala edits on two devices. | Integration | Local strokes preserved; cloud strokes forked into new entity `[Title] (Cloud Copy)` with new UUIDv4. | Designed / Pending (`TASK-ART-01..02`) |
| **10** | **Achievements** | Calling `unlock()` repeatedly for same achievement. | Unit / Integration | First call returns `firstUnlock: true`; subsequent calls are idempotent no-ops; progress monotonic. | Designed / Pending (`TASK-ACH-01`) |
| **11** | **Ed25519 Purchase Verification** | Verifying server-signed Ed25519 JWT token offline. | Cryptographic Unit | Valid signature unlocks content; tampered signature throws `SIGNATURE_VERIFICATION_FAILED`. | Designed / Pending (`TASK-COMM-02`) |
| **12** | **Key Rotation & Revocation** | Token signed with unknown `kid` or revoked key. | Integration | SDK fetches JWKS; detects rotated key; rejects tokens on emergency revocation list. | Designed / Pending (`TASK-COMM-02`) |
| **13** | **Refund Handling** | Chargeback webhook dispatched for supporter pass. | Integration | Cloud status marks `REVOKED`; client sync disables pass gracefully; user mandalas preserved. | Designed / Pending (`TASK-COMM-01`) |
| **14** | **Offline Entitlement Expiry** | Device offline for 35 days (>30-day grace period). | Integration / Browser | Expired token locks premium content gently; prompts online refresh; clock rollback detected. | Designed / Pending (`TASK-COMM-02`) |
| **15** | **Telemetry Overflow & Privacy** | Push 600 telemetry events while offline. | Unit / Integration | Buffer capped at 500; Tier 3 diagnostic dropped first; CRITICAL events never lost; overflow logged. | Designed / Pending (`TASK-TEL-01`) |
| **16** | **Sankalpa Local-Only E2EE** | Inspect telemetry payloads and cloud sync envelopes. | Cryptographic Unit | 100% stripped of `sankalpa`, intentions, reflections; encrypted locally with AES-GCM-256. | **VERIFIED** in baseline & Designed |
| **17** | **CSP & Hosting Consistency** | Verify `server.js`, `vercel.json`, `_headers`, `netlify.toml`. | Unit / Static Analysis | Identical CSP directives; `frame-ancestors 'self'` blocks clickjacking; `object-src 'none'`. | Designed / Pending (`TASK-CSP-01`) |
| **18** | **Desktop, Mobile & Full Regression** | Full platform execution in 390x844 and 1920x1080 viewports. | Playwright E2E | All 36 catalogue games render; 6 live games launch in theatre; Senior Mode syncs; 0 horizontal scroll. | **VERIFIED** in baseline (Suites A–G) |

---

## 3. Sacred Data Invariant Verification Evidence

The three sacred data assets were cryptographically verified at baseline HEAD `b6ccc860bb7d38a70ef678049a9588b8b73c40aa`:

1. **VAK Speech Training Corpus (`games/vak/assets/data/speech_training_corpus.json`):**
   - Verified SHA-256: `9fdb3826030049c9eab183479bcb7fe29304b3ea08d045c8c67f1cfd4d77da09`.
   - Verified Level Count: Exactly 1,368 levels.
   - Status: **VERIFIED (EXACT MATCH)**.
2. **Flora Botanical Database (`games/vak-living-sanctuary/assets/data/flora_database.json`):**
   - Verified Byte Size: Exactly 2,002,176 bytes.
   - Verified Line Count: 46,321 lines (LF).
   - Verified SHA-256: `689d035cd52abd8d342528d8c5f61f298916b8052b8287450be4931cf8ae1a3a`.
   - Status: **VERIFIED (EXACT MATCH)**.
3. **Sankalpa Vault E2EE (`assets/sdk/config/backend-config.js`):**
   - Verified Config: `cloudSyncEligible: false`, `localOnlyVaults: ['sankalpa_e2ee_vault']`.
   - Status: **VERIFIED (LOCAL-ONLY E2EE BOUNDARY)**.
