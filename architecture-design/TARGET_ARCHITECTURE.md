# AuroMind Platform Modernization — Target Architecture

**Status:** Design Freeze Deliverable (2 of 7)  
**Target Launch:** 1 January 2027 (VAK Speech Control, AuroMatch, AuroMandala)  
**Canonical Baseline:** `gapskris/AuroMind` · `dev/studio-integration` · `67d04726fb82cdb3d9f253bd36e627fe0d7aef20`

---

## 1. Architectural Principles

1. **Local-First & Offline-First:** Every game launches and plays fully offline in guest mode with zero network requests and zero account requirements.
2. **One Persistent Device Guest Identity:** A single local guest identity (`guest_<uuidv4>`) is shared across the AuroMind Portal and all games executing on the same AuroMind origin.
3. **Strict Separation of Local vs. Authenticated Identity:** A device guest ID is never treated as an authenticated account, and signing in/out never destroys the local guest ID or local game progress.
4. **Decentralized Game Save Ownership:** Each game retains 100% ownership of its existing IndexedDB database, `localStorage` keys, schema versioning, and gameplay mechanics. The shared SDK wraps and adapts game saves; it never consolidates them into one monolithic database.
5. **Provider Independence:** Games call **only** the AuroMind Shared SDK interfaces. Cloud providers (Supabase initially; Firebase, Appwrite, or self-hosted backends in the future) plug in exclusively via provider adapter interfaces.
6. **Zero Fake Security:** If authentication, cloud sync, entitlements, or payments are not production-ready by launch, they remain cleanly disabled via capability flags — never simulated with fake `authenticated: true` responses or client-side bypasses.
7. **Portal Preference Isolation:** Clearing portal UI preferences (`Clear Cache`) must never erase the shared device guest identity or any game's saved progress.

---

## 2. System Context & Layered Architecture

```text
+=============================================================================+
|                          BROWSER ORIGIN (PWA)                               |
|        http://localhost:3000  |  https://gapskris.github.io/AuroMind        |
+=============================================================================+
|                                                                             |
|  +-----------------------+    +------------------------------------------+  |
|  |   AuroMind Portal     |    |          Priority Launch Games           |  |
|  |   (index.html +       |    |  [1] VAK Speech Control (games/vak/)     |  |
|  |    portal.js)         |    |  [2] AuroMatch (games/auromatch/)        |  |
|  |                       |    |  [3] AuroMandala (games/auromandala/)    |  |
|  |  - Theater iframe     |    |                                          |  |
|  |  - Portal preferences |    |  Future-Compatible Games (Post-Jan):     |  |
|  |  - Optional Auth UI   |    |  [4] Word Riddle  [5] VAK Sanctuary      |  |
|  |  - Optional Account   |    |  [6] AuroBlocks                          |  |
|  +-----------+-----------+    +--------------------+---------------------+  |
|              |                                     |                        |
|              +------------------+------------------+                        |
|                                 v                                           |
|  +-----------------------------------------------------------------------+  |
|  |            AUROMIND SHARED PLATFORM SDK (Provider-Independent)        |  |
|  |                                                                       |  |
|  |  1. Identity        2. Guest Access      3. Authentication (Adapter)  |  |
|  |  4. Local Persist   5. Game-Save Bridge  6. Cloud Sync (Adapter)      |  |
|  |  7. Entitlements    8. Analytics         9. Remote Config & Content   |  |
|  +-----------------+---------------------------------+-------------------+  |
|                    |                                 |                      |
|        (Always Active, Local)             (Optional, Feature-Flagged)       |
|                    v                                 v                      |
|  +-------------------------------+   +-----------------------------------+  |
|  | Local Browser Storage Layer   |   | Pluggable Cloud Provider Adapter  |  |
|  |                               |   |  - Default: NullProviders (offline)|  |
|  | [Platform Vault]              |   |  - Target: SupabaseAdapter        |  |
|  |  - AuroMindPlatformDB (IDB)   |   |  - Future: Firebase/Appwrite/Self |  |
|  |  - auromind.platform.v1.guest |   +-----------------+-----------------+  |
|  |                               |                     | HTTPS + TLS        |
|  | [Game-Owned Vaults — Untouched|                     v                    |
|  |  Schemas]                     |   +-----------------------------------+  |
|  |  - AuroVakDB + vak_* LS       |   | External Cloud Backend (Supabase) |  |
|  |  - AuroMatchDB + auromatch_*  |   |  - Auth (JWT / OAuth / Email)     |  |
|  |  - pranamandala_game_cache_v2 |   |  - Postgres + Strict RLS          |  |
|  |  - word-discovery-db (Dexie)  |   |  - Edge Functions (Payments /     |  |
|  |  - VakSanctuaryDB             |   |    Verified Entitlements / Merge) |  |
|  |  - auroblocks_* LS            |   +-----------------------------------+  |
|  +-------------------------------+                                          |
+=============================================================================+
```

---

## 3. Responsibility Boundary: Shared SDK vs. Individual Games

| Domain | Shared Platform SDK Responsibility | Individual Game Responsibility |
|---|---|---|
| **1. Identity** | Mint, persist, auto-heal, and synchronize `deviceGuestId` across tabs; expose unified `PlayerIdentity` snapshot (`guest` + optional `account`). | Read `identity.guest.guestId` (and optional `identity.account`) without minting conflicting global IDs; manage any game-local named display profiles (e.g., VAK/AuroMatch profile slots). |
| **2. Guest Access** | Enforce guest-first default policy (`canPlayGame()` returns `allowed: true` offline); separate guest mode from authenticated mode. | Honor access decisions cleanly; never ship hardcoded client-side bypass passcodes or fake `authenticated` flags. |
| **3. Authentication** | Abstract provider lifecycle (`signIn`, `signOut`, `getSession`, `onAuthStateChange`) behind `AuthProvider`; ensure sign-out reverts cleanly to `'guest'` without deleting local progress. | Optionally display account/sync status or delegate sign-in triggers to Portal; remain 100% playable when signed out. |
| **4. Local Persistence** | Provide resilient `AuroMindPlatformDB` (IDB) + protected `localStorage` primitives for platform metadata, outbox queues, and cached remote config; handle private-mode/quota errors gracefully. | Own and maintain game-specific IndexedDB databases, `localStorage` keys, schema upgrades, purge locks, and E2EE vaults (e.g., PranaMandala Sankalpa vault). |
| **5. Game-Save Integration** | Define standard `GameSaveEnvelope<T>` (envelope version, game schema version, guest ID, revision, timestamp, checksum, `isEmpty`) and coordinate snapshot export/import & conflict UI triggers. | Implement its own `GameStorageAdapter` (read/write its native schema) and `GameMergeStrategy<T>` (domain-specific merge/conflict rules). |
| **6. Cloud Synchronization** | Manage offline sync outbox, retry/backoff, optimistic revision concurrency, empty-remote protection, and provider dispatch via `CloudSyncProvider`. | Emit `notifyProgressChanged()` signals after local commits; provide valid snapshots and apply resolved merged states back into native storage. |
| **7. Entitlements** | Expose `EntitlementsManager` backed by verified server claims (defaulting to free/beta-open when commercial gating is disabled); cache signed/verified read-only entitlement snapshots with TTL for offline continuity. | Query `entitlements.canAccess(featureKey)` instead of reading spoofable `localStorage` pass keys; present informational or checkout flows through Portal/SDK. |
| **8. Analytics** | Provide privacy-first, opt-in/local-buffered event ingestion (`AnalyticsProvider`), stripping PII and dropping silently when offline/unconfigured. | Emit semantic gameplay milestones (e.g., `level_completed`, `session_completed`) using anonymized IDs only. |
| **9. Remote Config & Content** | Fetch, validate, and cache non-critical remote feature flags/announcements via `RemoteConfigProvider` with compile-time safe defaults. | Supply hardcoded safe local defaults so offline/first-run behavior never depends on remote config; keep protected game corpora embedded locally. |

---

## 4. Service Worker & Offline Asset Delivery Architecture

### Strict Controller & Isolation Rules
1. **Every document is controlled by its longest-prefix Service Worker:**
   - `/` → root `sw.js` (`auro-portal-*` caches only).
   - `/games/vak/` → `games/vak/sw.js` (`auro-vak-*` caches only).
   - `/games/auromatch/` → `games/auromatch/sw.js` (`auro-match-*` caches only).
   - `/games/auromandala/` → `games/auromandala/sw.js` (Workbox scope-qualified precache + `auromandala-*` font caches).
2. **Root `sw.js` NEVER intercepts `/games/*` navigations or subresources.**
3. **Zero-Build Games (`vak`, `auromatch`) Own Their Offline Copy of Shared SDK Scripts:**
   - Compute `sdkBaseUrl = new URL('../../assets/sdk/', self.registration.scope).href` dynamically (subpath-safe for GitHub Pages `/AuroMind/`).
   - Precache `auromind-sdk.js` and `auromind-adapters.js` during each game SW's `install` phase into that game's own cache (`auro-vak-v*` / `auro-match-v*`).
   - Intercept `url.href.startsWith(sdkBaseUrl)` **before** the game's `scopePath` early-return guard using **Network-First with `cleanUrl` cache update and cache fallback**.
4. **Compiled Vite Games (`auromandala`) Bundle the SDK Client at Build Time:**
   - When AuroMandala is rebuilt from its legitimate upstream Vite source, the shared SDK module is bundled directly into its Workbox-precached Vite output (zero cross-scope network requests) while talking to the exact same origin-shared `AuroMindPlatformDB` and `auromind.platform.v1.guest` key.
5. **No Cross-SW Cache Deletion:** Every SW's `activate` handler strictly deletes only cache keys matching its own prefix.

---

## 5. Guest Identity Lifecycle, Persistence & Recovery Design

### Storage Topology
- **Primary Durable Store:** IndexedDB `AuroMindPlatformDB` (version `1`), object store `platform_meta`, record key `'guest_identity'`:
  ```json
  {
    "schemaVersion": 1,
    "guestId": "guest_550e8400-e29b-41d4-a716-446655440000",
    "createdAt": "2026-11-19T12:00:00.000Z",
    "lastSeenAt": "2026-11-19T12:00:00.000Z",
    "origin": "https://gapskris.github.io"
  }
  ```
- **Synchronous Mirror Store:** `localStorage['auromind.platform.v1.guest']` (identical JSON payload).
  - Uses dot-delimited prefix `auromind.platform.` so legacy `key.startsWith('auromind_')` clear loops cannot match it.
- **Cross-Tab Coordination:** Web Locks API (`navigator.locks.request('auromind-platform-guest-init')`) + `BroadcastChannel('auromind_platform_bus')` + `window.addEventListener('storage')`.

### Nine-Scenario Lifecycle & Recovery Matrix

| # | Scenario | Exact Behavior & Invariant |
|---|---|---|
| 1 | **First-time guest creation** | Acquire Web Lock `'auromind-platform-guest-init'`. Re-check IDB and LS inside lock. If both absent, generate `guest_<crypto.randomUUID()>` (fallback: `crypto.getRandomValues` RFC-4122 v4). Write to **both** `AuroMindPlatformDB` and `auromind.platform.v1.guest`. Broadcast `GUEST_IDENTITY_READY` on `BroadcastChannel`. |
| 2 | **Subsequent visits** | Read LS synchronously for instant boot; asynchronously verify against IDB. If both match, update `lastSeenAt` (throttled, e.g., once per session/hour). |
| 3 | **Browser restart** | Both IDB and LS persist across browser restarts; exact same `guestId` restored on next launch of Portal or any game. |
| 4 | **Storage partially cleared (LS cleared, IDB intact — or vice versa)** | **Auto-heal:** If LS is missing but IDB has valid record → restore LS from IDB (`repairedFrom: 'idb'`). If IDB is empty/deleted but LS has valid record → re-seed IDB from LS (`repairedFrom: 'localStorage'`). **Never** mint a new UUID while either store holds a valid record. |
| 5 | **IndexedDB corruption / `onblocked` / `onerror`** | Catch IDB failure with bounded timeout (`1500 ms`); fall back cleanly to `localStorage['auromind.platform.v1.guest']` (`storageHealth.idb = 'degraded'`). Schedule non-blocking DB recovery without discarding the LS `guestId`. |
| 6 | **`localStorage` unavailable (Private mode / SecurityError / QuotaExceeded)** | Fall back cleanly to `AuroMindPlatformDB`. If **both** IDB and LS throw, mint an in-memory session-only identity marked `{ storageSource: 'memory', ephemeral: true }` so gameplay never crashes or blocks. |
| 7 | **Portal `Clear Cache` action** | `assets/js/portal.js` explicitly removes only Portal UI keys (`auromind_reduced_motion`, `auromind_senior_mode`, `auromind_ambient_volume`, `auromind_guide_seen`) and skips any key matching `auromind.platform.*`. Even if LS were externally cleared, `AuroMindPlatformDB` auto-heals on next init. |
| 8 | **Multiple tabs opening simultaneously** | Web Lock serializes creation so Tab 2 waits for Tab 1's write and reads Tab 1's `guestId`. On browsers without `navigator.locks`, `BroadcastChannel` + `storage` listener reconciles any race by **deterministic earliest `createdAt` (then lexicographical `guestId` tie-break)**, converging all tabs onto one canonical `guestId`. |
| 9 | **Identity recovery & account migration** | When a user later links an authenticated account (Supabase), the server stores `(user_id, guest_id)` in `guest_identity_links`. Local `guestId` remains intact on-device. If the user signs out, local gameplay continues seamlessly under the preserved `guestId` with zero local data loss. |

---

## 6. Launch Readiness Classification (Target: 1 January 2027)

### Tier 1 — Mandatory for 1 January 2027 Launch (Must Be 100% Production-Verified)
- Shared persistent device guest identity across Portal, VAK Speech Control, AuroMatch, and AuroMandala.
- Local-first gameplay and complete offline operation (cold offline standalone & portal iframe launch).
- 100% preservation of existing player progress across all game databases/keys.
- Genuine game-level SDK integration for all three priority launch products (including AuroMandala upstream rebuild).
- Non-Supabase remediation items verified (including Portal `Clear Cache` safety and tracked-file budget `< 1,000`).
- Full three-product regression suite and release sign-off.

### Tier 2 — Target for 1 January 2027, Subject to Production Readiness (Safely Feature-Flagged)
- Optional User Authentication & Account Linking (Supabase Auth).
- Cloud Saves & Cross-Device Synchronization (with game-specific merge & conflict resolution).
- Server-Verified Entitlements & Payment Integration (Stripe/Razorpay/etc. via Supabase Edge Functions).
- Privacy-First Analytics & Remote Configuration.

### Safe Deactivation Guarantee (If Any Tier-2 Feature Is Not Production-Ready)
Every Tier-2 capability is controlled by compile-time/runtime capability flags (`AUTH_ENABLED`, `CLOUD_SYNC_ENABLED`, `ENTITLEMENTS_ENABLED`, `ANALYTICS_ENABLED`, `REMOTE_CONFIG_ENABLED`) that default to **`false`** with inert `NullProvider` implementations:
- **No broken UI buttons, no dead `/api/*` `404` probes, no fake `authenticated: true` stubs.**
- Core guest gameplay, local saves, and offline PWA operation remain 100% unaffected.
- Enabling a Tier-2 capability later requires only registering the verified provider adapter and flipping its capability flag after passing its dedicated security & RLS gate.
