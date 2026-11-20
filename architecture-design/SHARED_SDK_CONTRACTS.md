# AuroMind Platform Modernization — Shared SDK Contracts & Provider Abstractions

**Status:** Design Freeze Deliverable (3 of 7)  
**Target Runtime Footprint:** 2 browser-native ESM files (`assets/sdk/auromind-sdk.js`, `assets/sdk/auromind-adapters.js`) + 1 root test file (`auromind-sdk.test.js`) — **zero external runtime dependencies**.  
**Consumer Modes:** Native ES module `import` (AuroMatch, Vite builds like AuroMandala) **and** automatic `window.AuroMindSDK` facade (Portal, VAK Speech Control).

---

## 1. Core Initialization & Configuration Contract

```ts
export type GameId =
  | 'portal'
  | 'vak'
  | 'auromatch'
  | 'auromandala'
  | 'word-riddle'
  | 'vak-living-sanctuary'
  | 'auroblocks';

export interface CapabilityFlags {
  readonly authEnabled: boolean;          // Default: false until Supabase Auth ready
  readonly cloudSyncEnabled: boolean;     // Default: false until Cloud Sync ready
  readonly entitlementsEnabled: boolean;  // Default: false (free guest-first mode)
  readonly analyticsEnabled: boolean;     // Default: false
  readonly remoteConfigEnabled: boolean;  // Default: false
}

export interface AuroMindSDKConfig {
  readonly gameId: GameId;
  readonly appVersion: string;
  readonly capabilities?: Partial<CapabilityFlags>;
  readonly providers?: {
    auth?: AuthProvider;
    cloudSync?: CloudSyncProvider;
    entitlements?: EntitlementsProvider;
    analytics?: AnalyticsProvider;
    remoteConfig?: RemoteConfigProvider;
  };
}

export interface AuroMindSDK {
  init(config: AuroMindSDKConfig): Promise<SDKRuntimeContext>;
  isInitialized(): boolean;
  getCapabilities(): CapabilityFlags;

  // 9 Core Platform Services
  readonly identity: IdentityService;
  readonly access: GuestAccessService;
  readonly auth: AuthenticationService;
  readonly storage: LocalPersistenceService;
  readonly saves: GameSaveIntegrationService;
  readonly sync: CloudSyncService;
  readonly entitlements: EntitlementsService;
  readonly analytics: AnalyticsService;
  readonly config: RemoteConfigService;

  // Runtime Provider Registration (Provider-Independent Extension Points)
  registerProviders(providers: Partial<NonNullable<AuroMindSDKConfig['providers']>>): void;
}
```

---

## 2. Interface 1 — Identity (`IdentityService`)

Strictly separates persistent local device guest identity from optional verified account identity.

```ts
export interface GuestIdentity {
  readonly schemaVersion: 1;
  readonly guestId: string;           // Format: 'guest_<rfc4122-v4-uuid>'
  readonly createdAt: string;         // ISO-8601 UTC
  readonly lastSeenAt: string;        // ISO-8601 UTC
  readonly storageSource: 'idb+ls' | 'idb' | 'ls' | 'memory';
  readonly ephemeral: boolean;        // true ONLY if both IDB and LS are blocked
}

export interface AuthenticatedAccount {
  readonly provider: string;          // e.g., 'supabase', 'firebase', 'appwrite'
  readonly userId: string;            // Provider-verified canonical subject ID
  readonly email: string | null;
  readonly displayName: string | null;
  readonly verifiedAt: string;        // ISO-8601 UTC
}

export interface PlayerIdentity {
  readonly mode: 'guest' | 'authenticated'; // STRICT: 'authenticated' ONLY with verified provider session
  readonly guest: GuestIdentity;            // ALWAYS present; survives sign-in and sign-out
  readonly account: AuthenticatedAccount | null;
}

export interface IdentityService {
  ensureGuestIdentity(): Promise<GuestIdentity>;
  getSnapshot(): PlayerIdentity;
  subscribe(listener: (identity: PlayerIdentity) => void): () => void;
  getStorageHealth(): { idbAvailable: boolean; lsAvailable: boolean; lastRepairedFrom: string | null };
}
```

---

## 3. Interface 2 — Guest Access (`GuestAccessService`)

Governs local-first playability independently of authentication or network availability.

```ts
export interface GuestAccessDecision {
  readonly allowed: boolean;
  readonly mode: 'guest' | 'authenticated';
  readonly reason: 'guest-default' | 'verified-entitlement' | 'explicit-restriction';
  readonly offlinePermitted: boolean;
}

export interface GuestAccessService {
  canPlayGame(gameId: GameId): GuestAccessDecision;
  isGuestMode(): boolean;
  requiresNetwork(gameId: GameId): boolean; // Always false for core gameplay
}
```

---

## 4. Interface 3 — Authentication (`AuthenticationService` & `AuthProvider`)

Provider-independent authentication contract. Defaults to `NullAuthProvider` when `authEnabled === false`.

```ts
export type AuthSignInMethod = 'magic_link' | 'email_password' | 'oauth_google' | 'oauth_apple';

export interface AuthResult {
  readonly ok: boolean;
  readonly account: AuthenticatedAccount | null;
  readonly errorCode?: 'NOT_CONFIGURED' | 'OFFLINE' | 'INVALID_CREDENTIALS' | 'CANCELLED' | 'PROVIDER_ERROR';
  readonly message?: string;
}

export interface AuthProvider {
  readonly providerName: string;
  isConfigured(): boolean;
  getCurrentSession(): Promise<AuthenticatedAccount | null>;
  signIn(method: AuthSignInMethod, params?: Record<string, unknown>): Promise<AuthResult>;
  signOut(): Promise<void>; // MUST clear provider tokens ONLY; NEVER delete guestId or game saves
  linkGuestIdentity(guestId: string, account: AuthenticatedAccount): Promise<{ linked: boolean; linkedAt?: string }>;
  onAuthStateChange(cb: (account: AuthenticatedAccount | null) => void): () => void;
}

export interface AuthenticationService {
  isAvailable(): boolean;
  getAccount(): AuthenticatedAccount | null;
  signIn(method: AuthSignInMethod, params?: Record<string, unknown>): Promise<AuthResult>;
  signOut(): Promise<void>; // Reverts PlayerIdentity.mode to 'guest'; local saves untouched
}
```

---

## 5. Interface 4 — Local Persistence (`LocalPersistenceService`)

Provides durable platform-only persistence (`AuroMindPlatformDB` + `auromind.platform.*` mirror) without touching game databases.

```ts
export interface LocalPersistenceService {
  getPlatformMeta<T>(key: string): Promise<T | null>;
  setPlatformMeta<T>(key: string, value: T): Promise<boolean>;
  removePlatformMeta(key: string): Promise<boolean>;
  isProtectedKey(localStorageKey: string): boolean; // true for 'auromind.platform.*'
  getOfflineState(): OfflineStateSnapshot;
  subscribeOfflineState(listener: (state: OfflineStateSnapshot) => void): () => void;
}

export interface OfflineStateSnapshot {
  readonly online: boolean;
  readonly serviceWorkerControlled: boolean;
  readonly idbAvailable: boolean;
  readonly lsAvailable: boolean;
  readonly updatedAt: string;
}
```

---

## 6. Interface 5 — Game-Save Integration & Game-Specific Merge Contract (`GameSaveIntegrationService`)

Games retain 100% ownership of their native schemas and supply explicit domain merge strategies — **no generic union/max-score merge is permitted**.

```ts
export interface GameSaveEnvelope<TPayload = unknown> {
  readonly envelopeVersion: 1;
  readonly gameId: Exclude<GameId, 'portal'>;
  readonly gameSchemaVersion: number;
  readonly guestId: string;
  readonly baseRevision: number;     // 0 for never-synced local save
  readonly clientUpdatedAt: string;  // ISO-8601 UTC
  readonly isEmpty: boolean;         // Explicitly prevents empty-remote overwrite
  readonly payload: TPayload;        // Game-owned structured snapshot
  readonly checksum: string;         // SHA-256 hex of canonical serialized payload
}

export interface GameStorageAdapter<TPayload = unknown> {
  readonly gameId: Exclude<GameId, 'portal'>;
  readonly storageKind: 'idb+ls' | 'idb' | 'ls';
  readonly ownedDatabases: readonly string[];
  readonly ownedLocalStorageKeys: readonly string[];
  readonly integrationMode: 'native' | 'observer-only';

  hasLocalProgress(): Promise<boolean>;
  exportEnvelope(guestId: string): Promise<GameSaveEnvelope<TPayload>>;
  applyEnvelope(envelope: GameSaveEnvelope<TPayload>): Promise<{ applied: boolean; backupKey?: string }>;
}

export type MergeOutcomeStatus =
  | 'use_local'
  | 'use_remote'
  | 'auto_merged'
  | 'conflict_requires_user_choice';

export interface MergeResolution<TPayload = unknown> {
  readonly status: MergeOutcomeStatus;
  readonly resolvedPayload?: TPayload;
  readonly conflictSummary?: {
    readonly reason: string;
    readonly localSummary: Record<string, string | number>;
    readonly remoteSummary: Record<string, string | number>;
    readonly recommendedChoice?: 'local' | 'remote' | 'merge';
  };
}

export interface GameMergeStrategy<TPayload = unknown> {
  readonly gameId: Exclude<GameId, 'portal'>;
  resolve(
    local: GameSaveEnvelope<TPayload>,
    remote: GameSaveEnvelope<TPayload> | null
  ): MergeResolution<TPayload>;
}

export interface GameSaveIntegrationService {
  registerAdapter<T>(adapter: GameStorageAdapter<T>, mergeStrategy: GameMergeStrategy<T>): void;
  getAdapter(gameId: Exclude<GameId, 'portal'>): GameStorageAdapter | null;
  exportLocalEnvelope(gameId: Exclude<GameId, 'portal'>): Promise<GameSaveEnvelope>;
  resolveMerge<T>(
    gameId: Exclude<GameId, 'portal'>,
    local: GameSaveEnvelope<T>,
    remote: GameSaveEnvelope<T> | null
  ): MergeResolution<T>;
}
```

### Mandatory Non-Destructive Invariants Enforced by `GameSaveIntegrationService.resolveMerge()`
Before delegating to a game's `GameMergeStrategy`:
1. If `remote === null || remote.isEmpty` → **ALWAYS** return `{ status: 'use_local', resolvedPayload: local.payload }`. An empty cloud account can **never** overwrite local guest progress.
2. If `local.isEmpty && !remote.isEmpty` → return `{ status: 'use_remote', resolvedPayload: remote.payload }`.
3. If `local.checksum === remote.checksum` → return `{ status: 'use_local', resolvedPayload: local.payload }` (identical state, no-op).
4. Otherwise → delegate strictly to the game's domain-specific `GameMergeStrategy<T>.resolve(local, remote)`.
5. Before `applyEnvelope()` mutates native local storage, the adapter MUST create a rollback snapshot in `AuroMindPlatformDB` (`pre_merge_backup_<gameId>`) so failed writes never corrupt local progress.

---

## 7. Interface 6 — Cloud Synchronization (`CloudSyncService` & `CloudSyncProvider`)

```ts
export interface CloudSaveRecord<TPayload = unknown> {
  readonly gameId: Exclude<GameId, 'portal'>;
  readonly userId: string;
  readonly revision: number;
  readonly envelope: GameSaveEnvelope<TPayload>;
  readonly syncedAt: string;
}

export type PushResult =
  | { readonly status: 'synced'; readonly revision: number; readonly syncedAt: string }
  | { readonly status: 'conflict'; readonly serverRecord: CloudSaveRecord }
  | { readonly status: 'deferred_offline' }
  | { readonly status: 'disabled' }
  | { readonly status: 'error'; readonly message: string };

export interface CloudSyncProvider {
  readonly providerName: string;
  isConfigured(): boolean;
  pullLatest(gameId: Exclude<GameId, 'portal'>, userId: string): Promise<CloudSaveRecord | null>;
  pushWithOptimisticLock(
    envelope: GameSaveEnvelope,
    userId: string,
    expectedRevision: number
  ): Promise<PushResult>;
}

export interface CloudSyncService {
  isAvailable(): boolean;
  queueLocalChange(gameId: Exclude<GameId, 'portal'>): Promise<void>;
  syncNow(gameId: Exclude<GameId, 'portal'>): Promise<PushResult | MergeResolution>;
  getPendingOutboxCount(): Promise<number>;
}
```

---

## 8. Interface 7 — Entitlements (`EntitlementsService` & `EntitlementsProvider`)

Replaces duplicate `EntitlementManager` classes in VAK and AuroMatch with a single verified contract.

```ts
export interface EntitlementRecord {
  readonly sku: string;
  readonly gameId: GameId | 'all';
  readonly status: 'active' | 'revoked' | 'expired';
  readonly source: 'beta_free' | 'verified_purchase' | 'comp';
  readonly verifiedAt: string;
  readonly expiresAt: string | null;
}

export interface EntitlementsProvider {
  readonly providerName: string;
  isConfigured(): boolean;
  fetchEntitlements(userId: string): Promise<readonly EntitlementRecord[]>;
}

export interface EntitlementsService {
  isCommercialGateActive(gameId: GameId): boolean; // false when entitlementsEnabled === false
  hasEntitlement(gameId: GameId, sku?: string): boolean;
  canAccessLevel(gameId: GameId, levelNumber: number, freeTierMax?: number): boolean;
  refresh(): Promise<readonly EntitlementRecord[]>;
}
```
*Security Invariant:* Client-side `localStorage` pass tokens and unverified `postMessage` unlock grants are permanently prohibited. Offline access to paid entitlements (once enabled) uses a TTL-bounded cache of server-verified records fetched over authenticated HTTPS.

---

## 9. Interface 8 — Analytics (`AnalyticsService` & `AnalyticsProvider`)

```ts
export interface AnalyticsEvent {
  readonly name: string;             // e.g., 'game_launched', 'level_completed'
  readonly gameId: GameId;
  readonly timestamp: string;
  readonly properties?: Record<string, string | number | boolean>; // Strictly NO PII / journal text
}

export interface AnalyticsProvider {
  readonly providerName: string;
  isConfigured(): boolean;
  flush(events: readonly AnalyticsEvent[], identity: PlayerIdentity): Promise<void>;
}

export interface AnalyticsService {
  track(name: string, properties?: Record<string, string | number | boolean>): void;
  setOptIn(enabled: boolean): Promise<void>;
  isOptedIn(): boolean;
}
```

---

## 10. Interface 9 — Remote Configuration & Content (`RemoteConfigService` & `RemoteConfigProvider`)

```ts
export interface RemoteConfigProvider {
  readonly providerName: string;
  isConfigured(): boolean;
  fetchConfig(appVersion: string): Promise<Record<string, unknown>>;
}

export interface RemoteConfigService {
  getFlag(key: string, defaultValue: boolean): boolean;
  getValue<T>(key: string, defaultValue: T): T;
  refresh(): Promise<void>;
}
```
*Offline Invariant:* `getFlag` and `getValue` are synchronous, return cached values or caller-provided safe defaults, and never block gameplay or fetch protected game corpora remotely.

---

## 11. Provider Swappability Guarantee

Swapping Supabase for Firebase, Appwrite, or a self-hosted REST backend requires implementing **only** the 5 provider interfaces (`AuthProvider`, `CloudSyncProvider`, `EntitlementsProvider`, `AnalyticsProvider`, `RemoteConfigProvider`) and registering them via `AuroMindSDK.registerProviders(...)` in Portal/bootstrap configuration. **Zero lines of game logic or game storage adapter code change.**
