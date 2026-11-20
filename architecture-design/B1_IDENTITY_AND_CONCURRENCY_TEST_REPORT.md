# Batch B1 — Identity & Concurrency Test Report

- **Test Suite File:** `auromind-sdk.test.js`
- **Runner:** Node.js built-in test runner (`node --test auromind-sdk.test.js`)
- **Execution Mode:** 100% deterministic, offline, isolated in-memory mocks (`MockIndexedDB`, `MockLocalStorage`, `MockWebLocks`, `MockBroadcastHub`, `MockWindow`) — **zero internet access, zero Supabase dependency, zero real player data**.
- **Latest Verified Result:** **`24 / 24` tests PASSED (`0` failed, `0` skipped, `706.95 ms`)**.

---

## 1. Coverage Matrix — All 17 Mandatory Identity & Concurrency Scenarios

| # | Required Scenario | Test Name in `auromind-sdk.test.js` | Verified Assertions | Result |
|---:|---|---|---|---|
| 1 | First-time guest identity creation | `1. First-time guest identity creation persists versioned UUID record to IDB and localStorage` | UUIDv4 `guest_*` minted; `schemaVersion: 1`; persisted to both `AuroMindPlatformDB` and `auromind.platform.v1.guest`; `mode: 'guest'`; `storageSource: 'idb+ls'`; `ephemeral: false`; Web Lock acquired once. | **PASS** |
| 2 | Returning guest identity retrieval | `2. Returning guest identity retrieval preserves guestId and createdAt while updating lastSeenAt` | Exact `guestId` and original `createdAt` preserved; `lastSeenAt` updated to current clock. | **PASS** |
| 3 | Stable identity across page reloads | `3. Stable identity persists identically across simulated page reloads` | Fresh SDK instance initialized 24 hours later against same persistent IDB/LS recovers identical `guestId` and `createdAt`. | **PASS** |
| 4 | Multiple simultaneous initialization requests | `4. Multiple simultaneous init() calls share a single flight and return identical guestId` | 5 concurrent `Promise.all([sdk.init(), ...])` calls resolve to 1 unique `guestId` with only 1 Web Lock acquisition; repeated post-init `init()` is idempotent. | **PASS** |
| 5 | Multiple browser tabs attempting first-time initialization | `5. Multiple browser tabs attempting first-time init simultaneously converge via Web Locks` | 3 concurrent tab instances sharing IDB/LS/WebLocks/BroadcastChannel serialize first-launch creation and converge on 1 identical `guestId`. | **PASS** |
| 6 | Reconciliation of competing valid identities | `6. Reconciliation of competing valid identities chooses earliest createdAt deterministically (plus tie-break)` | Order-independent earliest `createdAt` selection; exact timestamp tie breaks by lexicographical `guestId`; live 2-tab race without Web Locks converges over `BroadcastChannel` onto earliest tab's `guestId`. | **PASS** |
| 7 | IndexedDB unavailable | `7. IndexedDB unavailable (null, failing, blocked, or timed out) falls back cleanly to localStorage` | Both `indexedDB: null` and hanging/blocked IDB (`idbTimeoutMs: 30`) degrade cleanly to `localStorage` (`storageSource: 'ls'`, `ephemeral: false`, `idbAvailable: false`). | **PASS** |
| 8 | `localStorage` unavailable | `8. localStorage unavailable falls back cleanly to IndexedDB; both unavailable degrades to ephemeral memory` | Throwing `SecurityError`/`QuotaExceededError` LS degrades cleanly to IDB (`storageSource: 'idb'`, `ephemeral: false`); both unavailable degrades to in-memory (`storageSource: 'memory'`, `ephemeral: true`) without crashing. | **PASS** |
| 9 | Corrupted IndexedDB record | `9. Corrupted IndexedDB record recovers valid guestId from localStorage and auto-heals IndexedDB` | Malformed IDB record detected (`corruptedStores: ['indexedDB']`), valid `guestId` recovered from LS (`lastRepairedFrom: 'localStorage'`), and IDB healed with valid record. | **PASS** |
| 10 | Corrupted `localStorage` mirror | `10. Corrupted localStorage mirror recovers valid guestId from IndexedDB and auto-heals localStorage` | Broken JSON `"{not-valid-json!!!"` detected (`corruptedStores: ['localStorage']`), valid `guestId` recovered from IDB (`lastRepairedFrom: 'idb'`), and LS healed. | **PASS** |
| 11 | IndexedDB/`localStorage` disagreement | `11. IndexedDB and localStorage disagreement reconciles deterministically to earliest createdAt in both stores` | Two valid distinct records reconcile to strictly earlier `createdAt`, converging both IDB and LS onto the winner and reporting `lastReconciledFrom`. | **PASS** |
| 12 | Partial deletion of one storage location | `12. Partial deletion of either storage location auto-heals without minting a new guestId` | Clearing LS restores exact `guestId` from IDB; deleting `AuroMindPlatformDB` re-seeds IDB from LS — zero new UUID minted in either case. | **PASS** |
| 13 | Interrupted initialization and retry | `13. Interrupted initialization resets cleanly and retry succeeds without losing existing identity` | Injected mid-init failure rejects cleanly with `isInitialized() === false`; subsequent `init()` retry recovers existing valid identity without minting a duplicate. | **PASS** |
| 14 | Unsupported Web Locks | `14. Unsupported Web Locks degrades cleanly and still reconciles via storage event` | `locks: null` completes without error (`webLocksSupported: false`) and reconciles an earlier peer identity delivered via `window` `'storage'` event. | **PASS** |
| 15 | Unsupported `BroadcastChannel` | `15. Unsupported BroadcastChannel degrades cleanly without errors while Web Locks still operate` | `BroadcastChannel: undefined` completes without error (`broadcastChannelSupported: false`) while Web Locks continues operating normally. | **PASS** |
| 16 | Invalid or unsupported identity record versions | `16. Invalid and unsupported identity record versions are detected and handled safely` | `schemaVersion: 0` / `'1'` rejected as `INVALID_VERSION` and healed from healthy sibling store; unsupported future `schemaVersion: 2` without valid v1 fallback throws `AuroMindSDKError('UNSUPPORTED_IDENTITY_VERSION')` and **does not overwrite** the stored v2 record. | **PASS** |
| 17 | No accidental overwrite of a valid existing identity | `17. No accidental overwrite of a valid existing identity by newer peers, repeated calls, or mid-flight writes` | Repeated `init()`, `ensureGuestIdentity()`, and rogue newer peer broadcasts cannot overwrite an existing earlier valid identity in memory, IDB, or LS. | **PASS** |

---

## 2. Additional Adapter Contract, Boundary & Zero-Network Tests (Tests 18–24)

| # | Test Name | Verified Assertions | Result |
|---:|---|---|---|
| 18 | Adapter registration, retrieval, listing, duplicate guard, and explicit replacement | Registers synthetic adapter, prevents silent duplicate overwrite (`DUPLICATE_ADAPTER`), supports `{ replace: true }` and `unregister()`. | **PASS** |
| 19 | Adapter initialization requires SDK init first and supplies scoped read-only identity context | Rejects `adapters.init()` before `AuroMind.init()` (`SDK_NOT_INITIALIZED`), idempotent after init, passes frozen scoped context (`getIdentity`, `getGuestId`, `canPlay`). | **PASS** |
| 20 | Explicit capability discovery exposes local-only vault boundaries and adapter features | Verifies `discoverCapabilities()` per-game and globally, including `hasLocalOnlyVaults` and `localOnlyVaults: ['sankalpa_e2ee_vault']`. | **PASS** |
| 21 | Adapter version and compatibility checks reject incompatible contracts and SDK bounds | Rejects mismatched `contractVersion`, `minSdkVersion > 1.0.0`, and `maxSdkVersion < 1.0.0` (`INCOMPATIBLE_ADAPTER`). | **PASS** |
| 22 | Strict boundary prevents game adapters from claiming platform-owned DB or localStorage keys | Rejects adapters declaring `AuroMindPlatformDB` or `auromind.platform.*` keys (`PLATFORM_BOUNDARY_VIOLATION`); verifies `storage.isProtectedKey()`. | **PASS** |
| 23 | Game-owned save envelopes preserve arbitrary game schemas and enforce non-destructive merge invariants | Opaque game payload preserved untouched; empty/null remote returns `use_local`; equal checksums no-op; divergent non-empty states delegate to game-owned `mergeStrategy`. | **PASS** |
| 24 | SDK initialization requires zero network calls and keeps all Tier-2 cloud capabilities disabled by default | Monkey-patched throwing `globalThis.fetch` confirms `0` network calls; all 5 Tier-2 flags `false`; `auth.signOut()` preserves guest ID; `access.requiresNetwork()` is `false`. | **PASS** |
