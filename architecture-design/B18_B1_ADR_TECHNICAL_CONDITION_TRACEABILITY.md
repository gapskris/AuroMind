# AuroMasti B18-B1 — ADR Technical Condition Traceability Matrix
## Comprehensive Technical Specifications Across Identity, Storage, Integrity, Game Adapters, Sync, Commerce, Privacy, and Hosting

- **Document Version:** 3.0.0 (Final Technical Closure Baseline)
- **Batch Reference:** B18-B1 Final Decision Preparation & Technical Closure
- **Canonical Workspace:** `C:\AuroMindPortal`
- **Active Git Branch:** `dev/studio-integration`
- **Baseline HEAD:** `b6ccc860bb7d38a70ef678049a9588b8b73c40aa`
- **Target Release:** January 1, 2027
- **Governance Mandate:** All 10 original ADRs remain **PENDING OWNER DECISION**.

---

## 1. Identity & Browser Storage Architecture (ADR-01, ADR-07)

### 1.1 Foundational Invariants
1. **One Profile = One Identity:** One browser profile represents exactly one persistent player identity (`guest_<uuidv4>`).
2. **Zero In-App Profile Selectors:** In-app player profile pickers, player switching dialogs, or session-boundary prompts are strictly prohibited.
3. **Shared Platform Identity:** All six portal games share the exact same platform identity.
4. **Independent Progression Namespaces:** Each game maintains its own isolated save key (`auromind.game.<gameId>.v1`), ensuring zero property bleeding or cross-game contamination.

### 1.2 Multi-Tab Identity Initialization & Race Conditions
When multiple browser tabs boot simultaneously (e.g. portal and game iframes opening concurrently):
- **Web Locks Coordination:** Initialization acquires `navigator.locks.request('auromind_identity_lock')`.
- **Lock Timeout Fallback:** If the lock is held for $> 3000\text{ms}$ (e.g., background tab suspended), the acquiring tab aborts the lock request and falls back to inspecting `localStorage` with `storage` event listeners.
- **Earliest Timestamp Rule:** If competing identities are detected, the identity with the earliest `createdAt` ISO timestamp wins deterministically. BroadcastChannel informs all tabs to converge on the winner.

### 1.3 Storage Hierarchy, Failure Matrix & Recovery Behavior
The platform employs a dual-store architecture (IndexedDB `AuroMindPlatformDB` primary + synchronous `localStorage` mirror).

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          STORAGE FAILURE RECOVERY MATRIX                        │
├──────────────────┬──────────────────┬──────────────────┬────────────────────────┤
│ INDEXEDDB STATE  │ LOCALSTORAGE     │ PLATFORM MODE    │ RECOVERY BEHAVIOR      │
├──────────────────┼──────────────────┼──────────────────┼────────────────────────┤
│ Healthy          │ Healthy          │ Normal Dual-Store│ IDB written first;     │
│                  │                  │                  │ LS mirror updated next.│
├──────────────────┼──────────────────┼──────────────────┼────────────────────────┤
│ Unavailable      │ Healthy          │ LS-Degraded Mode │ Read/write from LS;    │
│ (Blocked/Corrupt)│                  │                  │ flag background IDB    │
│                  │                  │                  │ repair; play unblocked.│
├──────────────────┼──────────────────┼──────────────────┼────────────────────────┤
│ Healthy          │ Unavailable      │ IDB-Only Mode    │ IDB handles all saves; │
│                  │ (Quota/Blocked)  │                  │ catch & suppress LS    │
│                  │                  │                  │ QuotaExceededError.    │
├──────────────────┼──────────────────┼──────────────────┼────────────────────────┤
│ Unavailable      │ Unavailable      │ Ephemeral RAM    │ InMemoryStorageAdapter │
│ (Total Failure)  │ (Total Failure)  │ Mode             │ active; amber banner;  │
│                  │                  │                  │ manual JSON export.    │
└──────────────────┴──────────────────┴──────────────────┴────────────────────────┘
```

#### Detailed Recovery Behaviors:
- **Interrupted Writes:** If the browser terminates mid-write, on next boot the SDK compares timestamps: if `localStorage.updatedAt > idb.updatedAt`, IDB is healed from LS. If `idb.updatedAt > localStorage.updatedAt`, LS is healed from IDB.
- **Private Browsing / Ephemeral Mode:** In Safari Private Browsing or Incognito, storage caps or per-session isolation apply. Identity and progression run cleanly in RAM. Progress naturally dissolves when the window closes, strictly respecting privacy mode design.
- **Storage Persistence Reality:** `navigator.storage.persist()` is invoked non-blockingly on startup. It is **explicitly recognized as an eviction defense** (protecting against automatic LRU purging under low disk pressure in Blink/Gecko and Safari ITP), **NOT an absolute guarantee against physical data loss or user deletion**.
- **Quota Exhaustion ($\ge 80\%$):** Polled via `navigator.storage.estimate()` every 15 minutes. Emits a CRITICAL telemetry warning and renders a non-blocking cache management button in Settings.
- **User Data Export:** `sdk.storage.exportBackup()` compiles all 6 game saves into an authenticated `.auromind-backup.json` payload for one-click download.

### 1.4 Storage Failure-Injection Test Suite
- `test_storage_idb_blocked()`: Mocks `window.indexedDB.open` throwing `SecurityError`; asserts LS mirror serves identity.
- `test_storage_ls_quota_exceeded()`: Mocks `localStorage.setItem` throwing `QuotaExceededError`; asserts IDB save succeeds.
- `test_storage_both_failed_ram_fallback()`: Mocks both stores failing; asserts `InMemoryStorageAdapter` active, banner visible, game loops uninterrupted.

---

## 2. Save Integrity & Canonical Hashing (ADR-02, ADR-05)

### 2.1 Standardized Outer Envelope Framing
All game saves are wrapped in a strict outer envelope:
```typescript
interface GameSaveEnvelope {
  envelopeVersion: 1;
  gameId: string;
  gameSchemaVersion: number;
  guestId: string;
  baseRevision: number;
  clientUpdatedAt: string;
  isEmpty: boolean;
  checksum: string; // 64-char hex SHA-256
  payload: Record<string, unknown>; // Opaque to platform
}
```

### 2.2 Canonical JSON Serialization & SHA-256 Engine
To eliminate false checksum mismatches across browsers and engines:
1. **Deterministic Key Sorting:** Recursive lexicographical sorting of all dictionary keys via `canonicalizeJson(obj)`.
2. **Preserving Array Order:** Array element sequence is strictly preserved (gameplay move sequences, level progression lists).
3. **Web Crypto SHA-256:** Checksums are computed using native `crypto.subtle.digest('SHA-256', ...)`.
4. **Transport Metadata Exclusion Justification:**
   - The checksum covers `{ envelopeVersion, gameId, gameSchemaVersion, isEmpty, payload }`.
   - **Excluded Fields:** `clientUpdatedAt`, `baseRevision`, and `guestId`.
   - *Technical Justification:* These three fields are transport/sync metadata. `baseRevision` increments on server commit, `clientUpdatedAt` updates on sync ping, and `guestId` may be re-bound during guest-to-account linking without changing game state. Excluding them ensures idempotent hash stability over the actual game progress.

### 2.3 Corruption Detection & Quarantine
- **Empty-Save Validity:** Legitimate brand-new player saves (`completedLevels: []`, `isEmpty: true`) are validated as 100% healthy states and are **never** flagged as corrupt.
- **Quarantine Protocol:** If an envelope fails JSON parse or SHA-256 checksum verification:
  1. The corrupt raw string is moved to `localStorage['_corrupt_' + gameId + '_' + Date.now()]`.
  2. A clean initial empty envelope is minted for the player.
  3. A CRITICAL telemetry event (`save_corruption_quarantined`) is queued.

### 2.4 Addressing Existing Checksum Flaws
- **AuroBlocks:** Replaced fragile string concatenation (`blocks_${score}_${len}`) with canonical JSON SHA-256.
- **AuroMatch:** Fixed auto-healing bug where `completedLevels: []` was treated as corrupt; authored standardized external SDK bridge.
- **AuroMandala:** Replaced unindexed raw array with versioned UUIDv4 entity map and deep stroke hashing.

---

## 3. Six Game Adapters: Implementation & Validation Matrix (ADR-02, ADR-03)

| Adapter Domain | AuroBlocks (`TASK-ADP-01`) | AuroMatch (`TASK-ADP-02`) | AuroMandala (`TASK-ART-01/02`) | VAK Speech (`TASK-ADP-03`) | Word Riddle (`TASK-ADP-04`) | VAK Sanctuary (`TASK-ADP-05`) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Initialization** | `auroblocks-sdk-bridge.js` | Dedicated new bridge | `auromandala-sdk-bridge.js` | Dedicated new bridge | Dedicated new bridge | Dedicated new bridge |
| **2. Identity Access** | `sdk.identity.getGuestId()` | Via standardized bridge | `sdk.identity.getGuestId()` | `sdk.identity.getGuestId()` | `sdk.identity.getGuestId()` | `sdk.identity.getGuestId()` |
| **3. Save / Load** | Envelope framing | Envelope wraps storageAdapter | Envelope wraps artwork dict | Envelope wraps `vak_game_data` | Envelope wraps riddle progress| Envelope wraps flora save |
| **4. Isolation** | Namespace `auroblocks` | Namespace `auromatch` | Namespace `auromandala` | Namespace `vak` | Namespace `word-riddle` | Namespace `vak-sanctuary` |
| **5. Validation** | Score & lines numeric | Array of level IDs | UUIDv4 keys & stroke arrays | Phoneme progress dict | Solved riddle index list | Discovered species IDs |
| **6. Checksum** | Canonical SHA-256 | Canonical SHA-256 | Canonical SHA-256 | Canonical SHA-256 | Canonical SHA-256 | Canonical SHA-256 |
| **7. Offline Play** | 100% autonomous | 100% autonomous | 100% autonomous | 100% autonomous (Corpus frozen)| 100% autonomous | 100% autonomous (Flora DB) |
| **8. Sync Logic** | Max score merge | Set union of levels | Entity dict + conflict fork | Set union of phonemes | Set union of riddles | Set union of flora species |
| **9. Standalone** | `createLocalMockBridge` | `createLocalMockBridge` | `createLocalMockBridge` | `createLocalMockBridge` | `createLocalMockBridge` | `createLocalMockBridge` |
| **10. Fault Isolation**| Adapter crash isolated | Adapter crash isolated | Adapter crash isolated | Adapter crash isolated | Adapter crash isolated | Adapter crash isolated |

---

## 4. Synchronization & Conflict Handling (ADR-05, ADR-06)

### 4.1 Durable Outbox & Offline Reconnect
- **IndexedDB Outbox:** Saves queue locally in `AuroMindPlatformDB` store `platform_sync_outbox`.
- **Reconnect & Backoff:** When `navigator.onLine` fires, queue processes sequentially. Retries use exponential backoff with jitter:
  $$t_{\text{wait}} = \min(15\text{m}, 2^{\text{attempt}} \times 1\text{s}) \pm \text{jitter}$$
- **Optimistic Concurrency:** Cloud push invokes PostgreSQL RPC `upsert_game_save_checked(p_game_id, p_payload, p_expected_revision)`.
- **HTTP 409 Collision:** Returned when remote revision has advanced beyond `baseRevision`. Triggers domain merge engine.

### 4.2 Six-Game Bespoke Merge Policies
1. **AuroBlocks:** $\text{highScore} = \max(\text{local.score}, \text{remote.score})$; $\text{lines} = \max(\text{local.lines}, \text{remote.lines})$.
2. **AuroMatch:** $\text{completedLevels} = \text{local.completedLevels} \cup \text{remote.completedLevels}$; stars merged via $\max(\text{stars})$.
3. **AuroMandala:** Entity dictionary union; stroke conflicts fork into `[Title] (Cloud Copy)`; soft tombstones preserved.
4. **VAK Speech Control:** Phoneme mastery merged via Set union; completed lessons merged via Set union; corpus untouched.
5. **Word Riddle:** Solved riddles merged via Set union; hint tokens merged via $\max(\text{tokens})$.
6. **VAK Living Sanctuary:** Discovered flora species merged via Set union; contemplation minutes merged monotonically.

### 4.3 AuroMandala Artwork Protection Invariants
- **UUIDv4 Entity Dictionary:** Artworks stored as `artworks[artworkId]`.
- **History Snapshotting:** Retains up to 10 immutable historical snapshots per artwork.
- **Soft Deletion Tombstones:** Deleting an artwork writes `{ deleted: true, deletedAt: ISO }`. Prevents stale cloud sync from resurrecting deleted artwork.
- **Non-Destructive Conflict Forking:** If local and remote versions have identical `artworkId` but divergent stroke arrays, the remote version is minted as a new entity titled `[Title] (Cloud Copy)` with a fresh UUIDv4. **Zero silent overwrites under any condition.**

---

## 5. Entitlements & Offline Verification Technical Review (ADR-08)

### 5.1 Business Model & Launch Invariant
- **Model:** One-time purchases for premium supporter packs / expansion features. **Zero subscriptions.**
- **Launch Invariant:** Commercial gate is **strictly disabled** for January 1, 2027 (`COMMERCIAL_GATE_ENABLED: false`). All levels, puzzles, and features are 100% free.

### 5.2 Ed25519 Token Structure & Webhook Lifecycle
- **Token Format:** Compact JWT signed with Ed25519 (EdDSA):
  ```json
  {
    "iss": "https://api.auromind.org",
    "sub": "guest_<uuidv4>",
    "aud": "auromind_game_platform",
    "jti": "<uuidv4_nonce>",
    "sku": "supporter_pack_v1",
    "iat": 1767225600,
    "exp": 1769817600,
    "kid": "key_2027_auth_01"
  }
  ```
- **Public Key Distribution & Rotation:** Public keys published via `/.well-known/jwks.json`. Unknown `kid` triggers automatic key refresh.
- **Revocations & Refunds:** Webhook pushes revoked `jti` nonces to `revoked_keys.json`. On revocation, premium access transitions gracefully without deleting user-created content.

### 5.3 Offline Time Security: Technical Reality & Defensible Policy

> [!IMPORTANT]
> **Defensible Engineering Truth:** In an untrusted client web browser running on user hardware:
> 1. `performance.now()` is monotonic **only within a single document session** and resets to 0 upon tab reload, browser restart, or device reboot.
> 2. An IndexedDB timestamp or forward-only local counter is **NOT tamper-proof** against a user with root access or Developer Tools.
> 3. A 100% mathematically tamper-proof 30-day offline guarantee in a client browser is **technically impossible**.

#### Multi-Layered Defensible Time Oracle Architecture:
1. **Cryptographic Token Authenticity (Mathematical Truth):** Token validity, SKU binding, and signature authenticity are verified using Web Crypto Ed25519. Unforgable without private key.
2. **Persistent Monotonic Forward Delta (`entitlement_time_oracle` in IDB):**
   - The SDK tracks `cumulative_offline_seconds` and `last_known_wall_clock`.
   - While the app runs, uninterrupted session deltas ($\Delta t$ via `performance.now()`) increment `cumulative_offline_seconds`.
3. **Restart & Rollback Handling:**
   - *Rollback:* If $\text{Date.now()} < \text{last\_known\_wall\_clock}$, the system detects clock tampering, clamps time to $\text{last\_known\_wall\_clock}$, and accumulates offline time using minimum session increments.
   - *Forward Jump:* If the user advances the system clock into the future past token expiry ($\text{Date.now()} \ge \text{token.exp}$), access expires immediately. Advancing the clock cannot cheat the system.
4. **Hard Cumulative Cutoff:** Access enters `GRACE_EXPIRED` when:
   $$\text{cumulative\_offline\_seconds} \ge 30 \times 86400 \quad \text{OR} \quad \max(\text{Date.now()}, \text{last\_known\_wall\_clock}) \ge \text{token.exp}$$
5. **Grace Expiration UX:** Displays a gentle, respectful prompt: *"Please reconnect to verify your supporter pass"*. All gameplay and saved data remain 100% accessible.
6. **Online Re-Anchoring:** Online check-in validates server time, resets `cumulative_offline_seconds` to 0, and re-anchors the time oracle.

---

## 6. Shared Achievements Contract (ADR-03, ADR-02)

### 6.1 SDK Achievements Interface
```typescript
interface AchievementsService {
  unlock(achievementId: string): Promise<boolean>;
  hasUnlocked(achievementId: string): boolean;
  getProgress(achievementId: string): { unlocked: boolean; unlockedAt: string | null };
  listDefinitions(): ReadonlyArray<AchievementDefinition>;
  subscribe(callback: (event: AchievementUnlockedEvent) => void): () => void;
}
```

### 6.2 Idempotency, Isolation & Non-Blocking Execution
- **Idempotency:** Calling `unlock(id)` multiple times is a no-op; earliest `unlockedAt` timestamp is preserved.
- **Cross-Game Isolation:** Achievements maintain isolated namespace storage; duplicate events are discarded.
- **Non-Blocking:** Unlocks dispatch via `requestIdleCallback`; achievement evaluation or toast rendering never blocks game animation frames or inputs.
- **Account Linking Restoration:** On account upgrade, unlocked achievements merge via Set union.

---

## 7. Telemetry & Privacy Boundaries (ADR-09, ADR-03)

### 7.1 3-Tier Telemetry Queue (500-Event Cap)
1. **Tier 1: CRITICAL (Capacity: 100 events, IDB-backed):** Save corruption quarantined, storage failure fallbacks, authorization rejections. **Never dropped voluntarily.**
2. **Tier 2: ENGAGEMENT (Capacity: 300 events, Memory FIFO):** Level completions, high score milestones, achievement unlocks.
3. **Tier 3: DIAGNOSTIC (Capacity: 100 events, Memory Eviction):** Performance timings, audio toggles, theme changes.

### 7.2 Saturation & Total Storage Loss Protocol

> [!CAUTION]
> **Engineering Reality:** A critical event CAN be lost if the browser experiences a sudden process kill or catastrophic disk failure before IndexedDB flushes. An overflow counter reduces silent failures, but does not guarantee hardware immutability.

- **Eviction Order on Queue Full (500 events):** Tier 3 dropped first $\rightarrow$ Tier 2 dropped next.
- **Critical Queue Saturation (100 events):**
  1. Emits observable console error: `[AuroMind:Telemetry] CRITICAL queue saturated (100)`.
  2. Increments atomic `critical_overflow_count` in `localStorage`.
  3. Prepends an overflow incident record to the next transmitted batch.
- **Total Storage Failure Protocol (Both IDB and LS unavailable):**
  - If storage is completely dead, critical events buffer in a 50-event RAM ring buffer.
  - An emergency `navigator.sendBeacon()` transmits the batch on window unload if user consent exists.
  - If network and storage are both dead, the session loss count is logged to console; gameplay proceeds unhindered.

### 7.3 Sacred Privacy Sanitizer
Pre-queue sanitizer scans all telemetry payloads recursively:
- **Blacklisted Keys:** Strips all matching `sankalpa`, `reflection`, `prayer`, `intention`, `voice`, `audio`, `passphrase`.
- **Sankalpa Vault:** Fully isolated in `localOnlyVaults: ['sankalpa_e2ee_vault']` encrypted with AES-GCM-256; `cloudSyncEligible: false`.
- **VAK & Flora Protection:** Educational corpus and botanical database contents are never transmitted in telemetry.

---

## 8. Multi-Host CSP & Edge Deployment Security (ADR-07, ADR-10)

### 8.1 Comparative Evaluation: Option 1 vs. Option 2

| Criterion | Option 1: GitHub Pages + Cloudflare Proxy | Option 2: Direct Cloudflare Pages or Vercel |
| :--- | :--- | :--- |
| **1. Security Headers** | Injected via Cloudflare Transform Rules | Natively defined in `_headers` or `vercel.json` |
| **2. CSP Enforcement** | Full HTTP response header enforcement | Full HTTP response header enforcement |
| **3. `frame-ancestors`** | Supported at proxy edge | Supported at CDN edge |
| **4. Game Iframe Parity** | Supported (same-origin theatre) | Supported (same-origin theatre) |
| **5. Service Worker** | Standard PWA caching | Standard PWA caching |
| **6. PWA Installation** | Fully supported | Fully supported |
| **7. Offline Caching** | Full Cache API support | Full Cache API support |
| **8. Custom Domain** | Requires Orange Cloud DNS proxy | Direct custom domain binding |
| **9. Complexity** | High (decoupled Git + Cloudflare dashboard) | Low (all configuration in source repository) |
| **10. Rollback** | Complex (Git rollback + proxy rule audit) | Instant (1-click atomic deployment rollback) |
| **11. Dependencies** | Coupled to both GitHub and Cloudflare | Single hosting provider |
| **12. Operational Cost** | Free tier | Free tier |

### 8.2 Why JavaScript Frame-Busting is INSUFFICIENT
1. **Sandbox Bypass:** An attacker framing AuroMasti inside `<iframe sandbox="allow-scripts allow-forms" src="...">` without `allow-top-navigation` prevents JavaScript from redirecting `window.top`, silently defeating the frame-buster.
2. **Timing Window:** JavaScript runs after HTML parsing; clickjacking overlays can capture clicks before execution.
3. **HTTP Header Enforcement:** HTTP response headers (`frame-ancestors 'self'` and `X-Frame-Options: SAMEORIGIN`) are enforced by the browser network engine before response parsing, aborting malicious framing before rendering.

### 8.3 Security Acceptance Suite (Required Prior to Production)
1. **HTTP Header Assertions:** Production URL returns `Content-Security-Policy: frame-ancestors 'self'`, `X-Frame-Options: SAMEORIGIN`, and `X-Content-Type-Options: nosniff`.
2. **External Clickjacking Test:** Playwright test from external origin asserting browser refuses to frame portal.
3. **Sandboxed Iframe Test:** Playwright test asserting network load aborted by HTTP header before render.
4. **Same-Origin Theatre Test:** Assert portal successfully embeds internal game frames (`games/*/index.html`).
5. **PWA Installation Check:** Assert valid web app manifest.
6. **Service Worker Update & Rollback:** Assert cache updates cleanly.
7. **Offline Launch:** Assert portal and 6 games launch with 0 connectivity.
8. **Asset & API Origin Restrictions:** Assert CSP blocks unauthorized external script/fetch origins.