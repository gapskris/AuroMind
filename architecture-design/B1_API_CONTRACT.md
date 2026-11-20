# Batch B1 — Shared SDK Public API Contract

- **Modules:**
  - `assets/sdk/auromind-sdk.js` (`SDK_VERSION = '1.0.0'`)
  - `assets/sdk/auromind-adapters.js` (`ADAPTER_CONTRACT_VERSION = 1`)
- **Consumption Modes:**
  - **ES Modules (recommended):** `import AuroMind, { createAuroMindSDK } from '../../assets/sdk/auromind-sdk.js';`
  - **Browser Global Facade:** `window.AuroMind` (alias: `window.AuroMindSDK`) automatically exposed when loaded in a browser `window` context.
- **Runtime Dependencies:** None (browser-native ES2022+ APIs only).

---

## 1. Core SDK API (`assets/sdk/auromind-sdk.js`)

### Exported Constants & Utilities
- `SDK_VERSION` (`'1.0.0'`)
- `IDENTITY_SCHEMA_VERSION` (`1`)
- `IDB_DB_NAME` (`'AuroMindPlatformDB'`), `IDB_DB_VERSION` (`1`), `IDB_STORE_NAME` (`'platform_meta'`), `IDB_GUEST_KEY` (`'guest_identity'`)
- `LS_GUEST_KEY` (`'auromind.platform.v1.guest'`), `LS_PROTECTED_PREFIX` (`'auromind.platform.'`)
- `WEB_LOCK_NAME` (`'auromind-platform-guest-init'`), `BROADCAST_CHANNEL_NAME` (`'auromind_platform_bus'`)
- `AuroMindSDKError` (`name`, `code`, `message`, `details`)
- `createAuroMindSDK(options?)` — creates an isolated SDK instance (supports `options.env` dependency injection for deterministic testing).
- `AuroMind` / `AuroMindSDK` / `default` — default singleton instance.
- Pure helpers: `generateUuidV4(cryptoApi?)`, `validateGuestRecord(raw)`, `reconcileGuestRecords(first, second)`.

### Lifecycle & Configuration Methods

| Method | Parameters | Return Value | Behaviour & Error Handling |
|---|---|---|---|
| `AuroMind.init(config?)` | Optional `{ gameId?, appVersion?, capabilities?, providers? }` | `Promise<SDKRuntimeContext>` (frozen) | Safe & idempotent to call repeatedly. Concurrent calls share a single in-flight promise. Performs zero network requests. Throws `AuroMindSDKError('INVALID_CONFIG')` for non-object config, or `AuroMindSDKError('UNSUPPORTED_IDENTITY_VERSION')` if only an unsupported future identity record (`schemaVersion > 1`) exists. Failed/interrupted init resets cleanly for retry. |
| `AuroMind.isInitialized()` | None | `boolean` | `true` only after `init()` has resolved successfully. |
| `AuroMind.getCapabilities()` | None | Frozen `CapabilityFlags` | All 5 flags (`authEnabled`, `cloudSyncEnabled`, `entitlementsEnabled`, `analyticsEnabled`, `remoteConfigEnabled`) default to `false`. |
| `AuroMind.registerProviders(providers)` | Partial `{ auth, cloudSync, entitlements, analytics, remoteConfig }` | `void` | Registers pluggable provider adapters without altering game code. Throws `AuroMindSDKError('INVALID_PROVIDERS' \| 'UNKNOWN_PROVIDER')` on invalid input. |
| `AuroMind.dispose()` | None | `void` | Closes `BroadcastChannel`, removes `storage` event listener, clears subscribers. |

### Identity Service (`AuroMind.identity`)

| Method | Return Value | Notes |
|---|---|---|
| `AuroMind.identity.get()` | Frozen `PlayerIdentity \| null` | `{ mode: 'guest' \| 'authenticated', guest: GuestIdentity, account: AuthenticatedAccount \| null }`. Returns `null` before `init()`. Alias: `getSnapshot()`. |
| `AuroMind.identity.getGuestId()` | `string \| null` | Active canonical `'guest_<uuidv4>'`, or `null` before `init()`. |
| `AuroMind.identity.ensureGuestIdentity()` | `Promise<GuestIdentity>` | Runs lock-protected read/reconcile/heal/persist sequence and emits updates to subscribers. |
| `AuroMind.identity.subscribe(listener)` | `() => void` (unsubscribe) | Invoked with frozen `PlayerIdentity` whenever identity initializes, reconciles across tabs, or auth state changes. Throws `AuroMindSDKError('INVALID_LISTENER')` if non-function. |
| `AuroMind.identity.getStorageHealth()` | Frozen diagnostic object | `{ idbAvailable, lsAvailable, webLocksSupported, broadcastChannelSupported, lastRepairedFrom, lastReconciledFrom, corruptedStores, lastError }`. |

### Local-First Platform Services (Provider-Independent)
- **`AuroMind.access`:** `canPlayGame(gameId)` → `{ allowed: true, mode, reason: 'guest-default', offlinePermitted: true }`; `isGuestMode()`; `requiresNetwork(gameId)` → always `false`.
- **`AuroMind.storage`:** `isProtectedKey(key)` (`true` for `'auromind.platform.*'`), `getPlatformMeta(key)`, `setPlatformMeta(key, value)`, `removePlatformMeta(key)`, `getOfflineState()`, `subscribeOfflineState(listener)`. Rejects attempts to overwrite reserved `'guest_identity'` key (`INVALID_META_KEY`).
- **`AuroMind.auth`:** `isAvailable()` (`false` in B1), `getAccount()` (`null`), `signIn()` (returns `{ ok: false, account: null, errorCode: 'NOT_CONFIGURED' }`), `signOut()` (clears provider session only; **never** deletes guest identity or game saves).
- **`AuroMind.sync` / `entitlements` / `analytics` / `config`:** Inert offline-safe facades backed by `NullProvider`s; `sync.syncNow()` returns `{ status: 'disabled' }`; `entitlements.isCommercialGateActive()` returns `false`; `config.getFlag(key, def)` and `getValue(key, def)` return caller defaults synchronously.

---

## 2. Game Adapter Contract & Registry (`assets/sdk/auromind-adapters.js`)

Accessible via `AuroMind.adapters` (alias: `AuroMind.saves`) or direct ESM import.

### Required Game Adapter Shape
```js
{
  gameId: 'example-game',             // lowercase slug; cannot be 'portal'
  adapterVersion: '1.0.0',            // strict MAJOR.MINOR.PATCH
  contractVersion: 1,                 // must equal ADAPTER_CONTRACT_VERSION (1)
  minSdkVersion: '1.0.0',             // optional semver lower bound
  maxSdkVersion: '1.9.9',             // optional semver upper bound
  integrationMode: 'native',          // 'native' | 'observer-only'
  storage: {
    kind: 'idb+ls',                   // 'idb+ls' | 'idb' | 'ls'
    ownedDatabases: ['ExampleDB'],    // FORBIDDEN: 'AuroMindPlatformDB'
    ownedLocalStorageKeys: ['ex_v1'], // FORBIDDEN: 'auromind.platform.*'
    localOnlyVaults: []               // e.g. ['sankalpa_e2ee_vault'] (never cloud-synced)
  },
  capabilities: {
    offlinePlay: true,
    localPersistence: true,
    cloudSyncEligible: false
  },
  async init(scopedContext) {},       // optional; receives read-only platform context
  async hasLocalProgress() {},        // required -> Promise<boolean>
  async exportEnvelope(guestId) {},   // required -> Promise<GameSaveEnvelope>
  async applyEnvelope(envelope) {},   // required for 'native', optional for 'observer-only'
  async dispose() {}                  // optional cleanup hook
}
```

### Registry Methods (`AuroMind.adapters`)

| Method | Return Value | Behaviour & Error Codes |
|---|---|---|
| `register(adapter, { mergeStrategy?, replace? }?)` | Frozen adapter record | Validates contract, semver bounds, and platform storage boundary (`INVALID_ADAPTER`, `INVALID_GAME_ID`, `INCOMPATIBLE_ADAPTER`, `PLATFORM_BOUNDARY_VIOLATION`, `MISSING_ADAPTER_METHOD`, `DUPLICATE_ADAPTER`). |
| `get(gameId)` | Frozen adapter record \| `null` | Retrieves registered adapter metadata, storage descriptor, capabilities, and init state. |
| `has(gameId)` / `list()` | `boolean` / Frozen array | Inspection helpers. |
| `init(gameId)` | `Promise<AdapterRecord>` | Requires `AuroMind.isInitialized() === true` (`SDK_NOT_INITIALIZED`). Idempotent. Supplies frozen scoped context `{ sdkVersion, gameId, getIdentity, getGuestId, getCapabilities, canPlay }`. |
| `discoverCapabilities(gameId?)` | Frozen capabilities object \| `null` | Explicit capability discovery per game or across all registered games, including `hasLocalOnlyVaults` and `localOnlyVaults`. |
| `exportLocalEnvelope(gameId)` | `Promise<GameSaveEnvelope>` | Passes verified `guestId` to adapter and validates envelope framing (`envelopeVersion: 1`, `gameId`, `gameSchemaVersion`, `guestId`, `baseRevision`, `clientUpdatedAt`, `isEmpty`, `checksum`, opaque `payload`). |
| `resolveMerge(gameId, local, remote)` | Frozen `MergeResolution` | Enforces non-destructive invariants (empty/null remote → `use_local`; empty local → `use_remote`; equal checksum → `use_local`; divergent → delegates strictly to game's `mergeStrategy`, or returns `conflict_requires_user_choice`). |
| `unregister(gameId)` | `Promise<boolean>` | Removes adapter and invokes optional `adapter.dispose()`. |
| `checkCompatibility(adapter)` | `{ compatible, reasons }` | Non-throwing compatibility check against running `SDK_VERSION`. |

---

## 3. Compatibility & Initialization Sequence

1. Host application loads `assets/sdk/auromind-sdk.js` (ESM or global script).
2. Host calls `await AuroMind.init({ gameId, appVersion })` (no network required).
3. Optional game module registers its adapter via `AuroMind.adapters.register(adapter, { mergeStrategy })` (can occur before or after `AuroMind.init()`).
4. Host initializes the adapter via `await AuroMind.adapters.init(gameId)` after `AuroMind.init()` resolves.
5. Compatibility is governed by `ADAPTER_CONTRACT_VERSION === 1`, SDK major version `1`, and each adapter's `minSdkVersion` / `maxSdkVersion` bounds.
