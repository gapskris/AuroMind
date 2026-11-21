# AuroMasti B18-B1 — Acceptance & Regression Test Plan
## Verification Framework for Findings F-01 through F-09 and Sacred Invariants

- **Document Version:** 1.0.0
- **Batch Reference:** AuroMasti B18-B1 (Read-Only Architecture & Blueprint)
- **Target Branch:** `dev/studio-integration`
- **Canonical Workspace:** `C:\AuroMindPortal`
- **Target Release:** January 1, 2027
- **Test Frameworks:** Node.js Native Test Runner (`node --test`), Playwright E2E (`@playwright/test`)
- **Execution Target:** B18-B Client Remediation Validation

---

## 1. Test Architecture & Quality Philosophy

AuroMasti's quality philosophy requires that **every finding identified in B18-A3 (F-01 through F-09) must have direct, automated verification** before cloud provisioning (B18-C). Furthermore, testing must enforce the platform's core pillars:
1. **Local-First Verification:** 100% of unit, contract, and adapter integration tests must execute and pass in a fully air-gapped environment (zero internet or backend connectivity required).
2. **Sacred Data Immutability:** Strict cryptographic checksum verification must ensure zero byte drift in the VAK Speech Corpus and Flora Botanical Database.
3. **Data Loss Zero-Tolerance:** Automated tests must verify non-destructive merge semantics across all 6 games, ensuring that offline progress and user artwork are never silently overwritten.

```
+--------------------------------------------------------------------------------+
|                     B18-B AUTOMATED TEST SUITE ARCHITECTURE                    |
+--------------------------------------------------------------------------------+
|  Level 1: Sacred Data & Invariant Verification Suite                           |
|  - Files: test/sacred-invariants.test.js                                       |
|  - Scope: Byte-exact SHA-256 verification of VAK corpus, Flora DB, Sankalpa   |
+--------------------------------------------------------------------------------+
|  Level 2: Shared SDK & Adapter Contract Test Suite                             |
|  - Files: test/sdk-adapter-contracts.test.js                                   |
|  - Scope: F-01, F-02, F-03, F-06, F-08 across all 6 game adapters              |
+--------------------------------------------------------------------------------+
|  Level 3: Save Integrity & Merge Engine Simulation Suite                       |
|  - Files: test/save-integrity-merge.test.js                                    |
|  - Scope: F-01 (Artwork Protection), F-07 (Bespoke Merges), F-05 (Auto-Heal)  |
+--------------------------------------------------------------------------------+
|  Level 4: Storage Resilience & CSP Verification Suite                          |
|  - Files: test/storage-resilience-csp.test.js                                  |
|  - Scope: F-04 (Persistence & Quota), F-09 (Multi-host CSP header sync)        |
+--------------------------------------------------------------------------------+
|  Level 5: Real-Browser Playwright E2E Regression Suite                         |
|  - Files: e2e/b18-platform-remediation.spec.js                                 |
|  - Scope: Multi-tab sync simulation, offline reload durability, audio bus      |
+--------------------------------------------------------------------------------+
```

---

## 2. Concrete Acceptance Criteria Matrix (F-01 through F-09)

| Finding ID | Priority | Description | Acceptance Criteria (Must Pass) | Verification Method |
| :--- | :--- | :--- | :--- | :--- |
| **F-01** | **P1** | AuroMandala Artwork Overwrite Risk | 1. Artwork save schema uses UUIDv4 keys and monotonic revisions.<br>2. Remote sync never overwrites local artworks; conflicts fork into `(Local Copy)`.<br>3. Checksum hashes `savedArtworks` collection deeply. | Automated Unit & Integration Tests |
| **F-02** | **P2** | Weak / Inconsistent Checksum Computation | 1. All 6 game bridges compute SHA-256 over canonicalized JSON payloads.<br>2. Transitory metadata (`clientUpdatedAt`, `baseRevision`) are excluded from checksum.<br>3. Checksum mismatch throws or triggers quarantine, preventing corrupted saves. | Automated Unit Tests (`crypto.subtle`) |
| **F-03** | **P2** | Missing Standalone Adapters for VAK, Word Riddle, Sanctuary | 1. Dedicated standalone bridge files exist for all three games.<br>2. Bridges implement `init()`, `extractEnvelope()`, `applyEnvelope()`, and `onSaveStateChanged()`.<br>3. Zero direct cross-game `localStorage` bleed. | Contract Interface Tests |
| **F-04** | **P2** | Storage Eviction Vulnerability (ITP / LRU) | 1. SDK invokes `navigator.storage.persist()` non-blockingly during initialization.<br>2. Persistence status is cached and queryable via `sdk.storage.isPersisted`.<br>3. Quota warnings trigger telemetry at 80% capacity. | Mocked Browser Storage Tests |
| **F-05** | **P2** | AuroMatch Auto-Healing Flaw | 1. Auto-healing executes if `localStorage` contains empty object `{}` or invalid JSON.<br>2. Bidirectional sync restores IndexedDB if IndexedDB is lost but `localStorage` is valid.<br>3. Zero level progression loss during simulated corruption. | Storage Adapter Unit Tests |
| **F-06** | **P2** | Shared SDK Achievements API Contract | 1. `sdk.achievements` provides typed `init()`, `unlock()`, `incrementProgress()`, `getAllAchievements()`.<br>2. Unlocks are idempotent; progress is monotonic.<br>3. Offline unlocks persist in local storage and merge cleanly. | Achievements Contract Tests |
| **F-07** | **P2** | Domain Merge Policy Discrepancies | 1. Every game has a dedicated, deterministic merge function.<br>2. High scores take `Math.max()`; level sets take Set union; timestamps preserve earliest unlocks.<br>3. No progression or artwork loss across concurrent offline sessions. | Merge Simulation Tests |
| **F-08** | **P3** | Telemetry In-Memory Queue Overflow & Privacy | 1. Telemetry employs 3-tier queue (CRITICAL, ENGAGEMENT, DIAGNOSTIC) capped at 500.<br>2. Queue overflow drops DIAGNOSTIC first; CRITICAL events are never dropped.<br>3. Strict privacy gate strips `sankalpa`, journal entries, and raw audio. | Telemetry Queue & Privacy Tests |
| **F-09** | **P3** | Production CSP & Hosting Discrepancies | 1. `server.js`, `vercel.json`, `_headers`, and `netlify.toml` share identical CSP headers.<br>2. Clickjacking prevented via `frame-ancestors 'self'`.<br>3. Future Supabase domains authorized via `connect-src`. | Static Header Consistency Tests |

---

## 3. Sacred Data Invariant Verification Plan

The platform holds three sacred data assets that MUST remain byte-exact and untouched across all development batches:

### 3.1 Sacred Verification Test Specification (`test/sacred-invariants.test.js`)

```javascript
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

describe('AuroMind Sacred Invariants Verification', () => {
  const root = 'C:\\AuroMindPortal';

  test('VAK Speech Training Corpus SHA-256 byte identity', () => {
    const vakPath = path.join(root, 'games', 'vak', 'assets', 'data', 'speech_training_corpus.json');
    assert.ok(fs.existsSync(vakPath), 'VAK speech corpus file must exist');
    const content = fs.readFileSync(vakPath);
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    assert.equal(hash, '9fdb3826030049c9eab183479bcb7fe29304b3ea08d045c8c67f1cfd4d77da09',
      'VAK speech corpus SHA-256 hash must match expected invariant exactly');
  });

  test('Flora Botanical Database SHA-256 byte identity & line count', () => {
    const floraPath = path.join(root, 'games', 'vak-living-sanctuary', 'assets', 'data', 'flora_database.json');
    assert.ok(fs.existsSync(floraPath), 'Flora database file must exist');
    const content = fs.readFileSync(floraPath);
    assert.equal(content.length, 2002176, 'Flora database byte size must be exactly 2,002,176 bytes');
    
    const lines = content.toString('utf8').split(/\r\n|\n/).length;
    assert.ok(lines === 46321 || lines === 46322, 'Flora line count must be 46,321 (LF) or 46,322 (CRLF/trailing newline)');

    const hash = crypto.createHash('sha256').update(content).digest('hex');
    assert.equal(hash, '689d035cd52abd8d342528d8c5f61f298916b8052b8287450be4931cf8ae1a3a',
      'Flora database SHA-256 hash must match expected invariant exactly');
  });

  test('Sankalpa Vault Local-Only & E2EE Isolation Guarantee', () => {
    const backendConfigPath = path.join(root, 'assets', 'sdk', 'config', 'backend-config.js');
    const configContent = fs.readFileSync(backendConfigPath, 'utf8');
    assert.match(configContent, /cloudSyncEligible:\s*false/, 'Sankalpa Vault must be marked cloudSyncEligible: false');
    assert.match(configContent, /sankalpa_e2ee_vault/, 'sankalpa_e2ee_vault must be in local-only vaults list');
  });
});
```

---

## 4. Test Case Matrix for B18-B Implementation

### Suite 1: AuroMandala Artwork Protection (F-01)
- **TC-01.1:** Save single artwork locally; verify metadata includes UUIDv4, `version: 1`, and `updatedAt`.
- **TC-01.2:** Simulate cloud sync arriving with an older snapshot; verify local artwork is NOT deleted.
- **TC-01.3:** Simulate cloud sync arriving with a conflicting artwork of the same ID but different strokes; verify merge engine forks conflicting artwork into a new local copy with `(Local Copy)` title suffix.
- **TC-01.4:** Soft-delete artwork locally; verify tombstone record (`deleted: true`) prevents resurrection by remote snapshot.

### Suite 2: Cryptographic Checksum Engine (F-02)
- **TC-02.1:** Compute payload checksum across identical objects with differently ordered keys; verify checksums are identical (canonical JSON normalization).
- **TC-02.2:** Mutate deeply nested artwork stroke or level score; verify checksum changes.
- **TC-02.3:** Mutate transport metadata (`clientUpdatedAt`, `baseRevision`); verify checksum remains unchanged.
- **TC-02.4:** Feed corrupted envelope with tampered payload; verify SDK rejects envelope with `CHECKSUM_MISMATCH`.

### Suite 3: Standalone Game Bridges (F-03)
- **TC-03.1:** Load VAK in standalone mode; verify `vak-sdk-bridge.js` successfully extracts envelope from `vak_game_data`.
- **TC-03.2:** Load Word Riddle; verify `word-riddle-sdk-bridge.js` extracts envelope from `word_riddle_progress`.
- **TC-03.3:** Load VAK Sanctuary; verify `vak-living-sanctuary-sdk-bridge.js` extracts envelope from `vak_sanctuary_save_v1`.
- **TC-03.4:** Execute bidirectional save updates; verify `onSaveStateChanged` fires on both game save and envelope sync.

### Suite 4: Storage Resilience & Auto-Healing (F-04 & F-05)
- **TC-04.1:** Mock `navigator.storage.persist()`; verify SDK calls method and updates state.
- **TC-04.2:** Mock storage quota at 85%; verify SDK emits `CRITICAL` telemetry warning.
- **TC-05.1:** Set `localStorage.setItem('auro_match_user', '{}')`; invoke `autoHealFromIndexedDB()`; verify progress is restored from valid IndexedDB.
- **TC-05.2:** Set `localStorage.setItem('auro_match_user', 'invalid-json{{{')`; verify auto-heal recovers from IDB.
- **TC-05.3:** Wipe IndexedDB while `localStorage` contains 50 cleared levels; verify IDB is restored with all 50 levels.

### Suite 5: Achievements & Telemetry (F-06 & F-08)
- **TC-06.1:** Call `unlock('match_zen_journey')` twice; verify second call returns `firstUnlock: false` and duplicate event is not fired.
- **TC-06.2:** Increment progress past `maxProgress`; verify status switches to `unlocked: true`.
- **TC-06.3:** Merge remote achievements with lower progress; verify local higher progress is retained.
- **TC-08.1:** Dispatch 600 telemetry events under simulated offline mode; verify queue size caps at 500.
- **TC-08.2:** Verify that all dropped events belong to `DIAGNOSTIC` tier, and 100% of `CRITICAL` events remain intact.
- **TC-08.3:** Push payload containing `{ sankalpa: "Secret Prayer", score: 100 }`; verify telemetry queue stores `{ score: 100 }` with `sankalpa` completely removed.

### Suite 6: Production CSP & Security Headers (F-09)
- **TC-09.1:** Parse `server.js`, `vercel.json`, `_headers`, and `netlify.toml`; verify `frame-ancestors 'self'` is present across all files.
- **TC-09.2:** Verify `connect-src` authorizes `https://*.supabase.co` and `wss://*.supabase.co`.
- **TC-09.3:** Verify `object-src 'none'` is present across all files.

---

## 5. Offline-First Verification Gate

Prior to approving any implementation PR in B18-B:
1. The test runner must execute `npm test` with all outbound network sockets blocked (`NODE_OPTIONS="--dns-result-order=ipv4first"` and simulated offline mode).
2. All tests (current 231 baseline + new remediation suites) must pass with **0 failures and 0 warnings**.
3. Zero network calls to Supabase, Firebase, Google Analytics, or external CDNs may be attempted during execution.
