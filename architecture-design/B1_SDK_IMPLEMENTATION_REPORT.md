# Batch B1 — Shared SDK Implementation Report

- **Programme:** AuroMind Platform Modernization (Target Launch: 1 January 2027)
- **Batch:** B1 — Shared SDK Foundation (preceded by approved B0 Closeout Decisions A1 & A2)
- **SDK Version:** `1.0.0` (Adapter Contract Version: `1`, Identity Schema Version: `1`)
- **Implementation Footprint:** Strictly 3 SDK files (`assets/sdk/auromind-sdk.js`, `assets/sdk/auromind-adapters.js`, `auromind-sdk.test.js`) — **zero external runtime dependencies**, **zero network calls**.

---

## 1. Architecture & Design Summary

The AuroMind Shared SDK provides a framework-independent, provider-independent, local-first platform runtime usable both via native ES module `import` (AuroMatch, Vite/React builds such as AuroMandala) and via the automatic browser global facade (`window.AuroMind` / `window.AuroMindSDK` for Portal and vanilla JS environments such as VAK Speech Control).

### Strict Ownership Boundary
- **Platform-Owned (SDK):**
  - Shared device guest identity stored in IndexedDB database `AuroMindPlatformDB` (v1, object store `platform_meta`, key `guest_identity`) and mirrored synchronously in `localStorage['auromind.platform.v1.guest']`.
  - Optional platform-level metadata under `meta:<key>` (IDB) and `auromind.platform.meta.<key>` (LS).
  - Provider-independent service facades (`identity`, `adapters`/`saves`, `access`, `auth`, `storage`, `sync`, `entitlements`, `analytics`, `config`) defaulting strictly to offline/disabled `NullProvider` implementations.
- **Game-Owned (Strictly Untouched by SDK):**
  - All game-specific IndexedDB databases, `localStorage` keys, save schemas, progression models, migration logic, protected corpora, and local-only encrypted vaults (including AuroMandala's AES-GCM Sankalpa vault).
  - `assets/sdk/auromind-adapters.js` actively rejects any adapter attempting to claim ownership of `AuroMindPlatformDB` or any key prefixed with `auromind.platform.`.

---

## 2. Identity Lifecycle, Storage & Concurrency Strategy

### Versioned Record Format (`schemaVersion: 1`)
```json
{
  "schemaVersion": 1,
  "guestId": "guest_<rfc4122-v4-uuid>",
  "createdAt": "2026-11-19T08:00:00.000Z",
  "lastSeenAt": "2026-11-19T08:00:00.000Z",
  "origin": "https://gapskris.github.io"
}
```
The dot-delimited `localStorage` key `auromind.platform.v1.guest` avoids accidental removal by legacy `auromind_*` clear loops.

### Initialization & Multi-Tab Coordination Sequence
1. **Single-Flight Same-Tab Guard:** Simultaneous `AuroMind.init()` calls within the same tab share one in-flight promise (`initPromise`), preventing duplicate minting. Once initialized, repeated `init()` calls return the cached frozen runtime context idempotently.
2. **Cross-Tab Serialization (Web Locks):** When `navigator.locks.request` is available, guest identity read/mint/write runs under exclusive lock `'auromind-platform-guest-init'`. Simultaneous first-launch tabs serialize cleanly so Tab 2 reads Tab 1's committed `guestId`.
3. **Fallback & Cross-Tab Convergence (`BroadcastChannel` + `storage` Event):**
   - When Web Locks is unavailable, `BroadcastChannel('auromind_platform_bus')` and `window`'s `'storage'` listener propagate `GUEST_IDENTITY_READY` / `GUEST_IDENTITY_RECONCILED` messages across tabs.
   - Competing valid identities are reconciled by pure function `reconcileGuestRecords(a, b)`: **earliest valid `createdAt` wins**, with deterministic lexicographical `guestId` tie-breaking if timestamps are identical.
   - Before committing to IDB or `localStorage`, `persistWinnerSafely()` re-reads both stores and reconciles against any concurrently written valid record or mid-init peer broadcast so an existing valid identity is never accidentally overwritten.

---

## 3. Failure, Corruption & Recovery Behaviour

| Condition | Implemented Behaviour |
|---|---|
| **IndexedDB unavailable / throws / `onblocked` / hangs** | Bounded timeout (`1500 ms` default, configurable for tests) prevents startup hang. Degrades cleanly to `localStorage` (`storageSource: 'ls'`, `ephemeral: false`, `idbAvailable: false`). |
| **`localStorage` unavailable / `SecurityError` / `QuotaExceeded`** | Degrades cleanly to `AuroMindPlatformDB` (`storageSource: 'idb'`, `ephemeral: false`, `lsAvailable: false`). |
| **Both IDB and `localStorage` unavailable** | Mints an in-memory session guest identity (`storageSource: 'memory'`, `ephemeral: true`) so core gameplay remains playable without throwing. |
| **Partial deletion (IDB or LS wiped)** | Auto-heals the missing store from the surviving valid store (`lastRepairedFrom: 'idb' | 'localStorage'`), preserving original `guestId` and `createdAt`. |
| **Corrupted JSON / malformed structure / invalid UUID / invalid version (`<= 0`, non-integer)** | Flags affected store in `storageHealth.corruptedStores`, recovers valid identity from sibling store if available, and auto-heals the corrupted store. |
| **Unsupported future schema version (`schemaVersion > 1`)** | **Never silently overwritten.** If a valid `v1` exists in the sibling store, uses the `v1` record without clobbering the future store; if no valid `v1` exists anywhere, throws `AuroMindSDKError('UNSUPPORTED_IDENTITY_VERSION')` and leaves the future record untouched. |
| **Interrupted initialization** | Clears `initPromise` and keeps `initialized = false` in `catch`/`finally` so subsequent `init()` retries cleanly recover any already-persisted identity or complete first-time creation. |
| **Unsupported Web Locks or BroadcastChannel** | Gracefully skips unsupported API, records support flags in `getStorageHealth()`, and continues via remaining mechanisms without error. |

---

## 4. Known Limitations & Deferred Work

### Known Limitations (By Design in B1)
- **No Service Worker Precache Integration Yet:** Root `sw.js` and game-specific service workers were intentionally untouched in B1; offline precaching of `assets/sdk/*.js` is deferred to the approved service-worker/product integration batch.
- **No Concrete Game Integrations Yet:** VAK Speech Control, AuroMatch, AuroMandala, Word Riddle, VAK Living Sanctuary, and AuroBlocks have zero source or bundle changes in B1.
- **Cross-Tab Convergence Without Web Locks or BroadcastChannel:** If a browser lacks both Web Locks and BroadcastChannel AND also blocks `localStorage` (so `storage` events cannot fire), two tabs starting simultaneously in IDB-only mode converge on next reload via deterministic reconciliation rather than real-time push.
- **Provider-Dependent Cloud Services Disabled:** `authEnabled`, `cloudSyncEnabled`, `entitlementsEnabled`, `analyticsEnabled`, and `remoteConfigEnabled` all default to `false` with inert `NullProvider` implementations.

### Deferred Integration Work (Batch B2+)
- **Batch B2+:** Implementing game-specific adapters and integrating Portal, VAK Speech Control, AuroMatch, and (when upstream Vite source is available) AuroMandala, plus SW precaching of `assets/sdk/*.js` and Portal `Clear Cache` hardening.
- **Future Optional Cloud Batch (Unscheduled / Unprovisioned):** Implementing pluggable `SupabaseProvider` adapters behind `AuroMind.registerProviders(...)` only after explicit Supabase project provisioning approval.

### Deviations from Prompt
- **None.** All constraints, file limits (3 SDK files), storage names (`AuroMindPlatformDB`, `auromind.platform.v1.guest`), zero-dependency rules, and prohibited-touch boundaries were followed strictly.
