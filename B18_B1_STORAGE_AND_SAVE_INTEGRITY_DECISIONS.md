# AuroMasti B18-B1 — Storage Resilience & Save Integrity Decisions
## Technical Clarifications for ADR-01, ADR-02, and ADR-07

- **Document Version:** 1.0.0
- **Batch Reference:** B18-B1 Final ADR Clarification & Approval Preparation
- **Canonical Workspace:** `C:\AuroMindPortal`
- **Target Release:** January 1, 2027
- **Governance Status:** PENDING OWNER APPROVAL

---

## 1. ADR-01 & ADR-07: Identity & Storage Resilience Specification

### 1.1 Dual-Store Operational Matrix
AuroMasti utilizes a dual-storage strategy combining **IndexedDB** (`AuroMindPlatformDB`) as the durable primary store and **localStorage** (`auromind.platform.*`) as a fast synchronous cache:

| Storage Environment State | Operating Behavior | Read Resolution Policy | Write Resolution Policy |
| :--- | :--- | :--- | :--- |
| **State 1: Both IDB & LocalStorage Functional** (Normal Operating Mode) | Reads serve synchronously from localStorage for instant UI rendering; writes persist to IDB asynchronously first, then sync to localStorage mirror. | Returns localStorage cached identity if valid; reconciles against IDB if timestamps differ (earliest `createdAt` wins). | Atomic dual-write: Write to IndexedDB -> On success, write to localStorage. |
| **State 2: IDB Unavailable / Blocked; LocalStorage Works** | Platform operates in localStorage-only mode. Storage health emits `IDB_DEGRADED` warning. | Reads from localStorage directly. | Writes to localStorage directly; queues IDB write in memory for retry if IDB recovers. |
| **State 3: LocalStorage Unavailable / QuotaExceeded; IDB Works** | Platform operates in IDB-only mode. Storage health emits `LS_DEGRADED` warning. | Reads asynchronously from IDB during SDK bootstrap. | Writes to IndexedDB directly; skips localStorage write. |
| **State 4: Both IDB and LocalStorage Fail** (Total Storage Lockout) | Platform degrades gracefully to **Ephemeral In-Memory Storage**. Gameplay is 100% UNBLOCKED. | Reads from in-memory Map. | Writes to in-memory Map; displays persistent non-blocking alert in Portal UI. |

### 1.2 User Notification & Ephemeral Mode UI
When both persistent storage mechanisms fail (State 4) or when private browsing prevents persistent writes:
1. **Zero Gameplay Interruption:** The player is **never locked out of gameplay**. Games load and play normally in RAM.
2. **Non-Intrusive Portal Banner:** A discreet, non-blocking amber banner appears at the top of the portal:
   > *"Notice: Browser storage is currently disabled or full. Your current gameplay progress will be kept in memory for this session, but will not be saved if you close this browser tab."*
3. **One-Click Manual Export:** A button in the banner labeled *"Export Session Progress"* allows the player to immediately download their save state as an unencrypted local JSON file bundle.

### 1.3 Private Browsing / Incognito Mode Behavior
In modern browsers (Safari Private, Firefox Private, Chrome Incognito):
- **IndexedDB:** May be memory-backed (Firefox) or restricted in size (50 MB in Safari).
- **Behavior:** The SDK mints an anonymous guest ID for the duration of the private session. When the incognito session terminates, the identity and local progress are naturally discarded by the browser.
- **Invariant:** The platform never displays aggressive modal dialogs demanding the user leave private mode.

### 1.4 Persistent Storage (`navigator.storage.persist()`) Technical Reality
The SDK invokes `navigator.storage.persist()` non-blockingly during initialization:

```javascript
export async function requestStoragePersistence() {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) {
    return { supported: false, persisted: false, reason: 'API_UNSUPPORTED' };
  }
  try {
    const isAlreadyPersisted = await navigator.storage.persisted();
    if (isAlreadyPersisted) {
      return { supported: true, persisted: true, reason: 'ALREADY_GRANTED' };
    }
    const granted = await navigator.storage.persist();
    return { supported: true, persisted: granted, reason: granted ? 'GRANTED' : 'DENIED_BY_BROWSER' };
  } catch (err) {
    return { supported: true, persisted: false, reason: err.message };
  }
}
```

#### Realistic Security & Operational Boundaries:
- **`navigator.storage.persist()` DOES NOT physically guarantee permanent data retention.**
- What it actually does: In Blink (Chrome) and Gecko (Firefox), granting persistence exempts the origin from automated Low-Disk-Space LRU (Least Recently Used) clearing. In WebKit (Safari), it suspends the 7-day Intelligent Tracking Prevention (ITP) script storage wipe.
- What it CANNOT prevent: It **cannot** prevent data loss if the user explicitly clicks "Clear Browsing Data / Site Data", resets their browser profile, uninstalls the browser, or experiences physical device storage corruption.
- Therefore, `navigator.storage.persist()` is treated as a **valuable client-side resilience defense**, but true disaster recovery relies on optional cloud backup (B18-C) or manual file export.

### 1.5 Storage Quota Monitoring & Recovery
- The SDK queries `navigator.storage.estimate()` every 15 minutes during active sessions and on platform startup.
- **Telemetry & Alerts:**
  - Usage < 70%: Normal state (`storageHealth = 'HEALTHY'`).
  - Usage $\ge 70\%$ and < 80%: Diagnostic logging (`storageHealth = 'WARNING'`).
  - Usage $\ge 80\%$: CRITICAL telemetry alert emitted; Portal Settings displays amber warning with one-click *"Purge Diagnostic Cache"* button.

### 1.6 Backup & Recovery Options
To defend against device loss or browser storage purges:
1. **Manual JSON Save Bundle Export:** Portal Settings provides *"Download Save Backup"*, packaging all six game envelopes and platform guest identity into an unencrypted `.auromind-backup.json` file.
2. **Manual JSON Save Bundle Import:** Allows a player to restore their entire local progress on any browser without requiring an account.

---

## 2. ADR-02: Save Integrity & Checksum Specification

### 2.1 Canonical JSON Serialization & Key Ordering
To ensure byte-for-byte deterministic hashing across all JavaScript runtime engines, all payloads are canonicalized prior to hashing:

```javascript
/**
 * Recursively canonicalizes an object by sorting all dictionary keys lexicographically.
 * Arrays maintain their exact element order.
 * Primitives, null, and booleans are preserved.
 */
export function canonicalizeJson(obj) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(canonicalizeJson);
  }
  const sortedKeys = Object.keys(obj).sort();
  const result = {};
  for (const key of sortedKeys) {
    result[key] = canonicalizeJson(obj[key]);
  }
  return result;
}
```

### 2.2 SHA-256 Checksum Inclusion vs. Exclusion Matrix
To ensure that transport metadata does not invalidate save integrity during network replication, fields are strictly partitioned:

| Envelope Property | Included in SHA-256 Checksum? | Rationale |
| :--- | :---: | :--- |
| `envelopeVersion` | **YES** | Structural schema definition. |
| `gameId` | **YES** | Prevents cross-game payload injection. |
| `gameSchemaVersion` | **YES** | Ensures payload matches game data model. |
| `isEmpty` | **YES** | Validates baseline empty state. |
| `payload` | **YES** | The complete game-owned data tree (canonicalized). |
| `guestId` | **NO** (Transport Metadata) | Excluded: Allows guest-to-account linking without changing payload checksum. |
| `baseRevision` | **NO** (Transport Metadata) | Excluded: Increments monotonically on server push without mutating gameplay content. |
| `clientUpdatedAt` | **NO** (Transport Metadata) | Excluded: Clock timestamp of sync transit. |
| `checksum` | **NO** (Self-Referential) | Excluded: The computed hash itself. |

```javascript
export async function computePayloadChecksum(envelope) {
  const hashTarget = {
    envelopeVersion: envelope.envelopeVersion,
    gameId: envelope.gameId,
    gameSchemaVersion: envelope.gameSchemaVersion,
    isEmpty: envelope.isEmpty,
    payload: canonicalizeJson(envelope.payload)
  };
  const jsonString = JSON.stringify(hashTarget);
  const encoder = new TextEncoder();
  const data = encoder.encode(jsonString);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
```

### 2.3 AuroMatch Empty Save Defect & Legitimate New-Player Validation
In B18-A3, finding F-05 identified that `autoHealFromIndexedDB()` in AuroMatch's `storageAdapter.js` aborted recovery if `localStorage.getItem('auro_match_user')` was truthy, even if it contained corrupted data.

**Crucial Clarification on Legitimate Empty Saves:**
A brand-new player who has just launched AuroMatch has an initialized save file where:
```json
{
  "profile": { "level": 1, "hints": 3, "score": 0 },
  "completedLevels": [],
  "settings": { "sfx": true, "zenMode": false }
}
```
**This is a 100% valid, non-corrupt save file.** 

#### Deep Validation Function:
```javascript
export function validateAuroMatchSavePayload(data) {
  // 1. Must be a non-null object
  if (!data || typeof data !== 'object') {
    return { valid: false, reason: 'PAYLOAD_NOT_OBJECT' };
  }
  // 2. Must possess valid profile structure
  if (!data.profile || typeof data.profile !== 'object') {
    return { valid: false, reason: 'MISSING_PROFILE' };
  }
  // 3. completedLevels must be an array (EMPTY ARRAY IS 100% VALID)
  if (!Array.isArray(data.completedLevels)) {
    return { valid: false, reason: 'INVALID_COMPLETED_LEVELS_TYPE' };
  }
  // 4. If elements exist, each must have valid level number
  for (const lvl of data.completedLevels) {
    if (typeof lvl !== 'object' || typeof lvl.level !== 'number' || lvl.level < 1) {
      return { valid: false, reason: 'MALFORMED_LEVEL_RECORD' };
    }
  }
  return { valid: true, isEmpty: data.completedLevels.length === 0 };
}
```

### 2.4 Corruption Quarantine & Recovery Protocol
If an unrecoverable corrupted payload is detected in localStorage:
1. **Quarantine:** The corrupted string is copied to `localStorage.setItem('auro_match_user.corrupt.' + Date.now(), corruptedData)`.
2. **IndexedDB Probe:** The adapter inspects IndexedDB for a valid previous snapshot.
3. **Recovery:** If IndexedDB holds a valid snapshot, it is restored to localStorage and a `CORRUPT_LOCAL_AUTOHEALED` telemetry event is queued.
4. **Clean Baseline:** If both stores are corrupted, a clean initial envelope (`isEmpty: true`) is minted, preserving user ability to play.

---

## 3. Acceptance Test Specifications for Storage & Integrity

| Test ID | Test Category | Scenario & Input Condition | Expected Result & Output |
| :--- | :--- | :--- | :--- |
| **TC-INT-01** | Empty Save | Brand-new player launches game (`completedLevels: []`, `isEmpty: true`). | Checksum computes cleanly; validator marks `valid: true`; envelope accepted. |
| **TC-INT-02** | Corruption | `localStorage` contains truncated JSON `{"profile": {`. | Deep validation fails; auto-heal restores from IDB; corrupt data quarantined. |
| **TC-INT-03** | Checksum Mismatch| Envelope payload tampered with while `checksum` header untouched. | SDK rejects envelope with `AuroMindAdapterError('CHECKSUM_MISMATCH')`. |
| **TC-INT-04** | Key Reordering | Two envelopes with identical payload data but inverted JSON keys. | `computePayloadChecksum()` produces identical 64-char SHA-256 hex string. |
| **TC-INT-05** | Total Storage Loss| Both IDB and localStorage throw `QuotaExceededError`. | In-memory storage activates; game plays offline; portal displays amber alert banner. |
| **TC-INT-06** | Transport Metadata| `baseRevision` incremented from 1 to 2, `clientUpdatedAt` updated. | Checksum remains identical; save committed without invalidation. |
