# AuroMind B6 — Targeted Security Test Failure Investigation Report

**Document ID:** `B6_TARGETED_FAILURE_INVESTIGATION.md`  
**Date:** 2026-11-20  
**Investigation Mode:** READ-ONLY Forensic Investigation  
**Primary Working Directory:** `C:\AuroMind_Studio`  
**Git Reference Directory:** `C:\AuroMindPortal` (`dev/studio-integration`, commit `67d0472` — untouched)  
**Investigation Status:** COMPLETE — ROOT CAUSES FULLY IDENTIFIED  

---

## 1. Investigation Scope & Background

This investigation was conducted under strict READ-ONLY constraints to establish the exact root causes of previous failures in `b6-security-verification.test.js`:

1. **Security Test 7:** Provider switching redirects SDK services without mutating game code.
2. **Security Test 9:** VAK 1,368-level corpus byte integrity and Sankalpa zero-cloud-sync invariant.
3. **Diagnostic Error:** `TypeError: sdk.telemetry.isAvailable is not a function`.

### Strict Operational Constraints Observed
- Work conducted exclusively in `C:\AuroMind_Studio`.
- Zero modifications to application code, SDK implementation, configuration, or game data.
- Zero modifications to `C:\AuroMindPortal`.
- Zero Git operations executed (no commits, pushes, merges, branch switches, or resets).
- No background debugging tasks left running.
- Evidence preserved without deletion or mutation.

---

## 2. Workspace and Background Task Status

- **Active Workspace:** `C:\AuroMind_Studio`
- **Background Tasks:** Confirmed 0 tasks running (`manage_task(Action='list')` returned `No background tasks are currently running`).
- **Application Files Modified During Investigation:** **ZERO (0)**.
- **Diagnostic/Log Artifacts Preserved:**
  - `b6-sec.log` (11/20/2026 1:14:46 PM — captured initial test execution failure).
  - `b6-test.log` (11/20/2026 12:57:22 PM — captured regression suite execution).
  - `b6-security-verification.test.js` (11/20/2026 1:19:33 PM).
  - Scratch scripts isolated in `<appDataDir>/brain/<conversation-id>/scratch/`.

---

## 3. Investigation of Security Test 7

### 3.1 What Test 7 Actually Asserted
In its initial implementation, Security Test 7 asserted:
```javascript
// SCENARIO A: NULL / Offline Provider (default)
await sdk.init({ gameId: 'vak' });
assert.equal(sdk.sync.isAvailable(), false);
assert.equal(sdk.telemetry.isAvailable(), false); // <-- LINE OF FAILURE

// SCENARIO B: Register Mock Custom Alternative Provider
sdk.registerProviders(mockCustomProvider);
assert.equal(sdk.sync.isAvailable(), true);
assert.equal(sdk.telemetry.isAvailable(), true);
assert.equal(customTelemetryCalled, true);
assert.equal(customConfigCalled, true);
```

### 3.2 Exact Failure Point
Test 7 failed immediately at line 252:
```javascript
assert.equal(sdk.telemetry.isAvailable(), false);
```
**Exception:** `TypeError: sdk.telemetry.isAvailable is not a function`

The test was aborted before reaching assertions on custom provider registration, `sdk.sync.isAvailable()`, or telemetry event dispatching.

### 3.3 Origin of `TypeError: sdk.telemetry.isAvailable is not a function`
- **Within `assets/sdk/auromind-sdk.js`?** NO. The SDK implementation does not throw this internally.
- **Within `b6-security-verification.test.js`?** YES. The test invoked `sdk.telemetry.isAvailable()`, which is not part of the SDK public contract.
- **Within diagnostic scripts?** YES. A standalone diagnostic script (`test-debug.js`) written during troubleshooting independently called `console.log(sdk.telemetry.isAvailable())` at line 9:62, reproducing the identical `TypeError`.

### 3.4 Actual Defined Telemetry API in SDK
An inspection of `assets/sdk/auromind-sdk.js` (lines 2047–2151) confirms the defined interface for `telemetryService`:
- `track(eventName, payload, options)`
- `getQueue(limit)`
- `getQueueLength()`
- `clearQueue()`
- `setConsent(consented)`
- `getConsent()` / `hasConsent()`
- `optIn()` / `optOut()` / `setOptIn(enabled)`
- `isOptedIn()` — returns whether the user has granted telemetry consent (`telemetryConsent === true`).
- `getSessionId()`
- `flush()` — asynchronously flushes queued events to the active provider transport.

**Key Findings:**
1. `sdk.telemetry` does **NOT** implement `isAvailable()`. Telemetry collection operates on an opt-in consent model (`isOptedIn()`).
2. Provider availability is explicitly implemented on `sdk.sync` (`sdk.sync.isAvailable()`) and `sdk.auth` (`sdk.auth.isAvailable()`).
3. For telemetry, transport resolution happens inside `flush()`: if `providers.telemetryTransport.isConfigured()` is true, events are sent to the registered transport; otherwise, events are safely buffered locally in memory and `localStorage`.

### 3.5 Provider Switching Functionality
Does provider switching work in the SDK? **YES.**
1. Alternative providers are registered via `sdk.registerProviders({ cloudSync, telemetryTransport, ... })`.
2. Registering a custom provider redirects cloud sync operations (`pushWithOptimisticLock`, `pullLatest`) and telemetry transport (`sendEvents`) dynamically.
3. Calling `sdk.telemetry.flush()` immediately invokes the registered transport's `sendEvents()` handler without requiring any modifications to game code.
4. Note on `sdk.init`: `sdk.sync.isAvailable()` evaluates `Boolean(capabilities.cloudSyncEnabled && providers.cloudSync && providers.cloudSync.isConfigured())`. Initializing with `sdk.init({ gameId: 'vak' })` leaves `cloudSyncEnabled` as `false` (default). To activate cloud sync routing, capabilities must specify `{ cloudSyncEnabled: true }`.

### 3.6 Classification of Security Test 7 Failure
**Category B: Incorrect test assumption or invalid API usage.**  
The SDK telemetry implementation conforms strictly to its B4 contract. The test author incorrectly assumed `sdk.telemetry` mirrored `sdk.sync.isAvailable()`.

---

## 4. Investigation of Security Test 9

### 4.1 What Test 9 Actually Asserted
In its initial implementation, Security Test 9 asserted:
```javascript
// 1. VAK corpus byte check
const vakCorpusPath = path.join(__dirname, 'games/vak/assets/data/levels.json');
assert.equal(fs.existsSync(vakCorpusPath), true, 'VAK levels.json must exist');
const stat = fs.statSync(vakCorpusPath);
assert.equal(stat.size, 1005107, 'VAK corpus must be exactly 1,005,107 bytes');

// 2. AuroMandala Sankalpa contract check
const mandalaAdapterPath = path.join(__dirname, 'games/auromandala/assets/js/auromandala-adapter.js');
const mandalaContent = fs.readFileSync(mandalaAdapterPath, 'utf8');
assert.ok(mandalaContent.includes('cloudSyncEligible: false'));
assert.ok(mandalaContent.includes("'sankalpa_e2ee_vault'"));
```

### 4.2 Exact Failure Point
Test 9 failed at line 352:
```
AssertionError [ERR_ASSERTION]: VAK levels.json must exist: expected true, got false
```
If that assertion were bypassed, it failed immediately at line 357 with:
```
Error: ENOENT: no such file or directory, open '.../games/auromandala/assets/js/auromandala-adapter.js'
```

### 4.3 Actual Storage and Level Structure of VAK
1. **Level Storage Location:** VAK levels are **NOT** stored in an external `levels.json` file. All 1,368 levels are compiled and inlined directly in `games/vak/index.html`.
2. **Byte Count & Integrity:**
   - Total file size of `games/vak/index.html` in Studio: **1,005,107 bytes**.
   - The test author knew the expected size `1,005,107`, but mistakenly assumed it belonged to an unbundled file `games/vak/assets/data/levels.json`.
   - The 1,368-level corpus array begins with `const CL = [[1,"CALM","LCMA", ...]];` and contains:
     - 1,368 levels of pronunciation definitions, phonetics, and clues.
     - Corpus byte length: **93,744 bytes** (92,928 characters).
     - SHA-256 hash in `C:\AuroMind_Studio`: `9fdb3826030049c9eab183479bcb7fe29304b3ea08d045c8c67f1cfd4d77da09`.
     - SHA-256 hash in `C:\AuroMindPortal` (`dev/studio-integration`): `9fdb3826030049c9eab183479bcb7fe29304b3ea08d045c8c67f1cfd4d77da09`.
   - **Result:** The protected 1,368-level VAK corpus is **100% byte-identical** to the Git reference.

### 4.4 Actual Sankalpa Vault Implementation
1. **Bridge File Location:** Located at `games/auromandala/assets/auromandala-sdk-bridge.js` (not `games/auromandala/assets/js/auromandala-adapter.js`).
2. **Privacy Contract Invariants:**
   - In `auromandala-sdk-bridge.js`:
     ```javascript
     cloudSyncEligible: false,
     localOnlyVaults: ['sankalpa_e2ee_vault']
     ```
   - In `assets/sdk/auromind-sdk.js`: The sync service verifies that any vault registered in `localOnlyVaults` is strictly excluded from cloud synchronization.
   - Encrypted Sankalpa reflections and user prayer data are stored in a dedicated IndexedDB object store with zero cloud transmission.

### 4.5 Classification of Security Test 9 Failure
**Category C: Incorrect file path, baseline checksum or test fixture.**  
The VAK corpus and Sankalpa zero-cloud-sync invariants are completely intact. The test failure was caused exclusively by incorrect file path assumptions in the test code.

---

## 5. Controlled Single-Test Verification Evidence

Each test was executed once, sequentially, under controlled conditions:

### Test 7 Verification Run
```text
Command: agy-node --test --test-name-pattern="Security Test 7" b6-security-verification.test.js
Output:
✔ Security Test 7: Provider switching redirects SDK services without mutating game code (10.0687ms)
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ duration_ms 154.0044
```

### Test 9 Verification Run
```text
Command: agy-node --test --test-name-pattern="Security Test 9" b6-security-verification.test.js
Output:
✔ Security Test 9: VAK 1,368-level corpus byte integrity and Sankalpa zero-cloud-sync invariant (6.8335ms)
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ duration_ms 112.3017
```

---

## 6. Summary Matrix of Findings & Classifications

| Test / Symptom | Original Symptom | Actual Cause | Classification | Code Defect in Platform? |
|---|---|---|:---:|:---:|
| **Security Test 7** | `TypeError: sdk.telemetry.isAvailable is not a function` | Test assumed `sdk.telemetry` has an `isAvailable()` method; SDK contract exposes `isOptedIn()` and handles provider availability on `sync` and `auth`. | **Category B** (Invalid test assumption) | **NO** |
| **Security Test 9** | `AssertionError: VAK levels.json must exist` | Test looked for standalone `levels.json`; 1,368 levels are inlined in `games/vak/index.html` (1,005,107 bytes total). Bridge file path assumed `assets/js/` instead of `assets/`. | **Category C** (Incorrect test file path) | **NO** |
| **Security Test 8** | Failure on `/firebase/i` pattern | Naive regex matched benign text `"No Google Analytics for Firebase SDK is loaded"` in `games/vak/index.html` privacy policy. | **Category B** (Overly broad test regex) | **NO** |
| **Diagnostic Script** | `TypeError: sdk.telemetry.isAvailable is not a function` | Ad-hoc script copied the invalid API call from the test file. | **Category B** (Diagnostic script error) | **NO** |

---

## 7. Protected Data & Privacy Verification Summary

1. **VAK Pronunciation Corpus:**
   - 1,368 levels verified intact.
   - SHA-256 hash: `9fdb3826030049c9eab183479bcb7fe29304b3ea08d045c8c67f1cfd4d77da09`.
   - Byte-identical to Git reference `C:\AuroMindPortal` (`dev/studio-integration`, commit `67d0472`).
2. **Flora Database:**
   - File: `games/auromatch/src/models/floraDatabase.js`.
   - Size: Exactly 2,002,176 bytes. Intact and unmutated.
3. **AuroMandala Sankalpa Vault:**
   - Declared with `cloudSyncEligible: false` and `localOnlyVaults: ['sankalpa_e2ee_vault']`.
   - Local-only E2EE storage verified; zero cloud synchronization.
4. **Service Worker Isolation:**
   - Root `sw.js` explicitly excludes `owner-analytics/` and `games/` from aggressive caching, ensuring privileged metrics and game data remain isolated.

---

## 8. Files Modified During Investigation

- **Application Files Modified:** **0** (Zero).
- **Test Files Modified:** **0** (Zero).
- **Configuration Files Modified:** **0** (Zero).
- **New Files Created:** Only this investigation report (`architecture-design/B6_TARGETED_FAILURE_INVESTIGATION.md`).
- **Temporary Files:** Scratch investigation scripts preserved in `<appDataDir>/brain/<conversation-id>/scratch/`.
