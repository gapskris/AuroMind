# B18-A2 — Architecture Decision Review & Gap Clarification

**Author:** AuroMind Platform Architecture Team  
**Date:** November 21, 2026  
**Canonical Workspace:** `C:\AuroMindPortal`  
**Active Git Branch:** `dev/studio-integration`  
**Baseline HEAD Commit:** `b6ccc860bb7d38a70ef678049a9588b8b73c40aa`  
**Target Release:** January 1, 2027  
**Status:** READ-ONLY COMPREHENSIVE ARCHITECTURE REVIEW (Zero Code Changes)  

---

## 1. Executive Summary & Deliverable Consistency Audit

This review conducts a rigorous technical evaluation of the B18-A shared services readiness assessment, addresses all open architectural questions, and prepares the ten Architecture Decision Records (ADRs) for formal product-owner review.

### Consistency Verification of B18-A Deliverables
A cryptographic audit of all five B18-A deliverables across both the repository root and the `architecture-design/` mirror was executed:

| Deliverable | Root Path | Mirror Path | SHA-256 Hash Match | Consistency Finding |
|:---|:---|:---|:---:|:---|
| **Assessment** | `B18_A_SHARED_SERVICES_ARCHITECTURE_ASSESSMENT.md` | `architecture-design/B18_A_...` | **100% IDENTICAL** | Zero drift; complete alignment. |
| **ADR Register** | `B18_A_ARCHITECTURE_DECISION_REGISTER.md` | `architecture-design/B18_A_...` | **100% IDENTICAL** | Zero drift; all 10 ADRs aligned. |
| **Data Matrix** | `B18_A_DATA_OWNERSHIP_MATRIX.md` | `architecture-design/B18_A_...` | **100% IDENTICAL** | Zero drift; 4-tier sovereignty intact. |
| **Risk Register** | `B18_A_SECURITY_AND_RISK_REGISTER.md` | `architecture-design/B18_A_...` | **100% IDENTICAL** | Zero drift; risks SEC-01..08 aligned. |
| **Gap Register** | `B18_A_READINESS_GAP_REGISTER.md` | `architecture-design/B18_A_...` | **100% IDENTICAL** | Zero drift; gaps GAP-01..07 aligned. |

---

## 2. In-Depth Review of Ten Architecture Decision Records (ADR-01 to ADR-10)

> **Notice:** Under strict phase instructions, **no ADR is marked as approved**. All ten decisions remain **PROPOSED — PENDING OWNER APPROVAL**.

---

### ADR-01: Canonical Player Identity Model

- **Proposed Decision:** Standardize player identity around an RFC-4122 UUIDv4 prefixed with `guest_`, generated locally on first launch, stored redundantly in IndexedDB (`AuroMindPlatformDB`) and localStorage (`auromind.platform.v1.guest`), and synchronized across browser tabs using Web Locks and BroadcastChannel. When registering with Supabase, this guest ID is non-destructively linked to `auth.users.id` via `guest_identity_links`.
- **Alternatives Considered:**
  1. *Mandatory User Sign-Up Upfront:* Force email or social login before launching any game. Rejected due to extreme friction for contemplative, casual web players.
  2. *Hardware / Browser Fingerprinting (Canvas/Audio/WebGL):* Generate deterministic device hashes. Rejected due to privacy violations, GDPR non-compliance, and fragility across browser updates.
  3. *Pure LocalStorage Token:* Simple uncoordinated key. Rejected due to high risk of data eviction in Safari/WebKit and race conditions across simultaneous browser tabs.
- **Reason for Recommendation:** Combines instant zero-friction guest play with battle-tested cross-tab reconciliation, multi-store auto-healing, and seamless future account linking.
- **Impact on Existing Games:** Positive. All six games retrieve the identical player identity via `sdk.identity.getGuestId()`, preventing fractured per-game identity generation.
- **User Impact:** Players start playing in <1 second with zero sign-up friction. Progress persists across page reloads and browser restarts.
- **Security & Data-Loss Risks:** Minimal on single-user devices. On shared devices, unauthenticated players share the guest profile unless an explicit profile selector or logout purge is chosen (addressed in Section 3.A).
- **Can It Be Changed Later? (Reversibility):** Moderate. Changing the identity format after production launch would require a database schema migration and a client-side identity migration script.
- **Recommendation:** **ADOPT (Pending Owner Approval)**.
- **Owner Approval Required:** **YES**.

---

### ADR-02: Game-Specific Progression Schema

- **Proposed Decision:** Enforce a strict platform envelope framing (`SAVE_ENVELOPE_VERSION = 1`) containing metadata (`gameId`, `gameSchemaVersion`, `guestId`, `baseRevision`, `checksum`, `clientUpdatedAt`, `isEmpty`), but treat the internal `payload` as completely opaque, leaving save data structure to each game.
- **Alternatives Considered:**
  1. *Monolithic Shared Save Schema:* Force all games into a common schema (e.g. `{ currentLevel: number, score: number }`). Rejected because AuroMandala saves vector mandala geometry, AuroMatch saves raga constellation states, and Word Riddle saves theme token arrays.
  2. *Unenveloped Freeform JSON:* Allow games to upload raw JSON to the cloud without standardized framing. Rejected because the sync engine would lack revision tracking, checksum validation, and conflict detection capabilities.
- **Reason for Recommendation:** Provides necessary platform-level synchronization invariants while granting game developers total freedom to evolve game mechanics independently.
- **Impact on Existing Games:** Zero disruption. Existing save models in AuroMatch, AuroBlocks, and AuroMandala map cleanly into `payload` without modifying internal game storage logic.
- **User Impact:** Ensures rich game-specific progress (artwork, stats, constellation maps) is preserved without distortion or truncation.
- **Security & Data-Loss Risks:** Game schemas must validate their own internal payload versions on load to prevent crashes from outdated saves.
- **Can It Be Changed Later? (Reversibility):** High. The envelope has a dedicated `envelopeVersion` field, allowing future envelope schema upgrades ($v1 \rightarrow v2$) with backward compatibility.
- **Recommendation:** **ADOPT (Pending Owner Approval)**.
- **Owner Approval Required:** **YES**.

---

### ADR-03: Shared Service Contracts

- **Proposed Decision:** Provide all shared platform services via an immutable ES module singleton (`AuroMindSDK`) exposing frozen sub-services (`sdk.identity`, `sdk.storage`, `sdk.auth`, `sdk.sync`, `sdk.player`, `sdk.telemetry`, `sdk.entitlements`, `sdk.config`, `sdk.logging`).
- **Alternatives Considered:**
  1. *Global Window Utility Functions:* Expose loose functions on `window` (e.g. `window.saveGame()`). Rejected due to namespace pollution, lack of encapsulation, and vulnerability to script collisions.
  2. *Micro-Packages / NPM Monorepo:* Split services into separate npm packages. Rejected due to over-engineering for a local-first static web portal bundle.
- **Reason for Recommendation:** Delivers clean modularity, immutable contracts (`Object.freeze`), zero external runtime dependencies, and straightforward test mocking.
- **Impact on Existing Games:** Games import or reference one standardized facade.
- **User Impact:** Guarantees platform stability and uniform error handling across all launch titles.
- **Security & Data-Loss Risks:** Encapsulation prevents third-party scripts or game iframes from corrupting platform runtime state.
- **Can It Be Changed Later? (Reversibility):** High. The facade wraps internal sub-services; internal implementations can be refactored without breaking consumer game interfaces.
- **Recommendation:** **ADOPT (Pending Owner Approval)**.
- **Owner Approval Required:** **YES**.

---

### ADR-04: Guest-to-Account Migration

- **Proposed Decision:** Provide a non-destructive upgrade path via `sdk.auth.upgradeGuestToAccount()` that signs up/in the user, links the existing device `guest_id` to the Supabase `user_id` in `guest_identity_links`, and prompts the user for consent before uploading existing local saves as initial cloud saves (`expectedRevision = 0`).
- **Alternatives Considered:**
  1. *Destructive Account Overwrite:* Wipe local guest data on login and download whatever is in the cloud account. Rejected because players would lose hours of guest progress upon account creation.
  2. *Silent Automatic Cloud Upload:* Automatically upload local guest saves to the cloud account without asking. Rejected due to privacy regulations (GDPR/ePrivacy) and the risk of overwriting existing cloud saves if the user logs into an existing account.
- **Reason for Recommendation:** Guarantees zero data loss, complies with privacy consent requirements, and provides an intuitive, trustworthy user experience.
- **Impact on Existing Games:** Transparent to games; game save keys remain in local storage untouched while cloud links are established.
- **User Impact:** Seamless transition from casual guest play to synchronized cross-device player status.
- **Security & Data-Loss Risks:** If an existing cloud account already contains progress for Game X that conflicts with local guest progress, the SDK must trigger user conflict resolution rather than blind merging.
- **Can It Be Changed Later? (Reversibility):** Moderate. Relies on the schema of `guest_identity_links`.
- **Recommendation:** **ADOPT (Pending Owner Approval)**.
- **Owner Approval Required:** **YES**.

---

### ADR-05: Offline Synchronization Strategy

- **Proposed Decision:** Implement an offline outbox queue (`LS_OUTBOX_KEY`) with optimistic concurrency revision locking (`baseRevision` vs `expectedRevision`) against a PostgreSQL RPC `upsert_game_save_checked`. Pushes only execute on network connectivity with valid user authentication and explicit sync consent.
- **Alternatives Considered:**
  1. *Last-Write-Wins (LWW) via Client Timestamps:* Overwrite whatever is on the server with the newest client timestamp. Rejected because client clocks are easily skewed or manipulated, causing silent data erasure.
  2. *Continuous Background WebSocket Sync:* Real-time bidirectional replication. Rejected due to extreme compute/battery drain and incompatibility with intermittent offline play.
- **Reason for Recommendation:** Optimistic concurrency is mathematically sound, protects offline progress, and gracefully handles multi-device play without data loss.
- **Impact on Existing Games:** Games write locally as normal; the SDK sync worker handles queuing, background transmission, and revision incrementation.
- **User Impact:** Fast offline play with zero network blocking; reliable synchronization when network is available.
- **Security & Data-Loss Risks:** Requires atomic revision checking in PostgreSQL to prevent race conditions during simultaneous multi-device sync.
- **Can It Be Changed Later? (Reversibility):** Moderate. Bound to PostgreSQL RPC contract.
- **Recommendation:** **ADOPT (Pending Owner Approval)**.
- **Owner Approval Required:** **YES**.

---

### ADR-06: Conflict Resolution Policy

- **Proposed Decision:** Apply four mandatory non-destructive invariants (`resolveGameMerge`):
  1. Empty remote never overwrites local progress.
  2. Empty local adopts non-empty remote.
  3. Identical payload checksums require no merge.
  4. Non-empty conflicting saves delegate to game-specific `GameMergeStrategy`. If none is registered, trigger a user choice dialog (`conflict_requires_user_choice`).
- **Alternatives Considered:**
  1. *Generic Deep-Merge Algorithm:* Automatically merge JSON trees. Rejected because game progression trees cannot be safely merged generically (e.g. merging two puzzle boards creates an invalid game state).
  2. *Always Force User Choice:* Prompt the user on every conflict. Rejected as annoying when automated mathematical union (e.g. taking max level and union of completed IDs) is 100% safe.
- **Reason for Recommendation:** Balances automated convenience with absolute data safety. In ambiguous cases, the user is given full control with clear metadata comparison.
- **Impact on Existing Games:** Games can register bespoke merge strategies in B18-B to auto-resolve safe conflicts (e.g. highest level unlocked).
- **User Impact:** Eliminates anxiety over lost progress; provides transparent, understandable choices.
- **Security & Data-Loss Risks:** None. Progress is never silently discarded.
- **Can It Be Changed Later? (Reversibility):** High. Merge strategies are client-side functions that can be refined per game over time.
- **Recommendation:** **ADOPT (Pending Owner Approval)**.
- **Owner Approval Required:** **YES**.

---

### ADR-07: Cloud vs. Local Data Ownership

- **Proposed Decision:** Designate the local client device storage as the **primary operational authority** for gameplay execution. Designate the Supabase cloud database as a **durable synchronization replica and backup vault**.
- **Alternatives Considered:**
  1. *Cloud-Authoritative Engine:* All save reads and writes query Supabase directly. Rejected because it breaks offline play and turns AuroMasti into a fragile, high-latency online web app.
  2. *Pure Local-Only (Zero Cloud):* Never offer cloud sync. Rejected because players lose saves when changing phones, upgrading computers, or clearing browser caches.
- **Reason for Recommendation:** Honors the core sacred invariant that AuroMasti must remain playable even if every cloud service is unavailable.
- **Impact on Existing Games:** Native game performance remains decoupled from network speed.
- **User Impact:** Instant gameplay loading, zero lag during play, and robust protection against cloud outages.
- **Security & Data-Loss Risks:** Device failure before initial cloud sync causes loss of un-synced guest progress; mitigated by encouraging account registration for cloud backup.
- **Can It Be Changed Later? (Reversibility):** Very low. Reversing this would require fundamentally re-architecting AuroMasti into a server-rendered or cloud-streaming application.
- **Recommendation:** **ADOPT (Pending Owner Approval)**.
- **Owner Approval Required:** **YES**.

---

### ADR-08: Purchase Entitlement Architecture

- **Proposed Decision:** Enforce a two-phase commercialization model:
  - *Phase 1 (Beta):* Commercial gates disabled (`COMMERCIAL_GATE_ENABLED: false`); all content is free and unlocked.
  - *Phase 2 (Production Activation):* Entitlements verified server-side via Supabase `entitlements` table with signed server receipts. Client-side localStorage tokens and postMessage unlock events are strictly rejected.
- **Alternatives Considered:**
  1. *Client-Side LocalStorage License Flag:* Store `isPurchased = true` in localStorage. Rejected as insecure and trivially bypassed.
  2. *Immediate Beta Paywall:* Enable payments today. Rejected as premature prior to full platform hardening and commercial approval.
- **Reason for Recommendation:** Protects the free contemplative beta while establishing a tamper-resistant, server-verified architecture for future commercial offerings.
- **Impact on Existing Games:** AuroMatch's `entitlementManager.js` is already architected to honor this model. Other games remain unrestricted.
- **User Impact:** Beta users enjoy peaceful, free access. Future purchasing users receive tamper-proof, cross-device access to paid content.
- **Security & Data-Loss Risks:** Prevents client-side piracy while ensuring verified buyers can restore purchases after reinstalling or switching devices.
- **Can It Be Changed Later? (Reversibility):** High. The provider-agnostic `purchaseProvider` interface accommodates any payment gateway (Stripe, Razorpay, etc.) without altering game code.
- **Recommendation:** **ADOPT (Pending Owner Approval)**.
- **Owner Approval Required:** **YES**.

---

### ADR-09: Analytics & Privacy Boundaries

- **Proposed Decision:** Enforce strict privacy invariants: zero PII in telemetry, explicit opt-in visitor consent (`LS_CONSENT_KEY`), 64 KiB Edge Function ingestion caps, 50-event batch limits, sliding-window rate limiting, and **absolute exclusion of the AuroMandala Sankalpa contemplation vault** from telemetry and cloud sync.
- **Alternatives Considered:**
  1. *Third-Party Trackers (Google Analytics / Mixpanel):* Embed standard tracking scripts. Rejected due to third-party cookies, PII harvesting, script weight, and CSP violations.
  2. *Zero Analytics / Blind Operations:* Collect nothing. Rejected because the platform owner requires anonymous operational health metrics (DAU, error rates, game load times) to maintain quality.
- **Reason for Recommendation:** Provides necessary platform health metrics without violating user privacy or spiritual sanctuary principles.
- **Impact on Existing Games:** Games emit standard telemetry events (`level_attempt`, `game_session_start`) without handling network logic.
- **User Impact:** Clean, respectful experience with zero intrusive surveillance or tracking cookies.
- **Security & Data-Loss Risks:** Telemetry opt-out immediately purges the local queue, preventing unconsented data leakage.
- **Can It Be Changed Later? (Reversibility):** High. Edge Functions and SDK telemetry schemas can be updated without touching core game engines.
- **Recommendation:** **ADOPT (Pending Owner Approval)**.
- **Owner Approval Required:** **YES**.

---

### ADR-10: Backend-Independent SDK Design

- **Proposed Decision:** Maintain a strict Provider Adapter Pattern (`assets/sdk/config/backend-config.js`) where games interact exclusively with high-level SDK interfaces (`AuroMind.sync`, `AuroMind.auth`, etc.). Concrete backend providers (Supabase, Firebase, or Null/Mock) are decoupled and swappable via configuration.
- **Alternatives Considered:**
  1. *Direct Supabase SDK Imports:* Import `@supabase/supabase-js` directly into game scripts. Rejected because it tightly couples games to a single vendor, prevents offline unit testing, and risks credential leakage.
  2. *Bespoke Per-Game Backend Connectors:* Let each game author communicate with backend endpoints independently. Rejected as an architectural disaster causing fragmented error handling, inconsistent security, and impossible maintenance.
- **Reason for Recommendation:** Future-proofs the codebase, enables 100% offline unit/e2e testing with mock providers, and eliminates vendor lock-in.
- **Impact on Existing Games:** Games remain completely clean of cloud provider SDKs.
- **User Impact:** Seamless application behavior regardless of backend hosting updates or database migrations.
- **Security & Data-Loss Risks:** Rejects service role keys in client code with explicit runtime exceptions.
- **Can It Be Changed Later? (Reversibility):** High. Adding or swapping a provider requires only writing an adapter satisfying the provider contract.
- **Recommendation:** **ADOPT (Pending Owner Approval)**.
- **Owner Approval Required:** **YES**.

---

## 3. Resolution of Critical Architectural Questions

### A. Player Identity Deep-Dive

#### 1. Clarification: UUIDv4 vs. Deterministic Identity Generation
- **Is UUIDv4 Random or Deterministic?**
  The minted identifier itself is a **random RFC-4122 Version 4 UUID** generated using cryptographically secure pseudorandom number generators (`crypto.randomUUID()` or `crypto.getRandomValues()`). It is **not** derived deterministically from hardware, MAC address, IP, or browser canvas (which would violate GDPR privacy standards and break across network changes).
- **What "Deterministic Identity Generation" Means in AuroMind:**
  The term "deterministic" refers strictly to the **identity lifecycle and cross-tab convergence state machine**:
  1. *Deterministic Multi-Tab Initialization:* When two browser tabs open simultaneously on a brand-new device with empty storage, both tabs might generate a UUID in memory before either has written to disk. Web Locks (`auromind-platform-guest-init`) serializes the write. If competing records are broadcast, the SDK deterministically chooses the record with the **earliest `createdAt` timestamp** (with lexicographical tie-break on `guestId` if timestamps match to the millisecond).
  2. *Deterministic Read Idempotency:* Once established, every subsequent call to `sdk.identity.getGuestId()` on that device/profile deterministically returns the exact same string across all six games without re-minting.

#### 2. Safe Lifecycle Model Across User Scenarios

```
+---------------------------------------------------------------------------------------------------+
|                                 PLAYER IDENTITY SCENARIO MATRIX                                   |
+---------------------------------------------------------------------------------------------------+
| Scenario                 | Identity Mechanics                 | Storage Isolation & Protection    |
+--------------------------+------------------------------------+-----------------------------------+
| Single-Player Device     | guest_<uuid> generated once;       | Persisted in IDB + LS; all games  |
| (Private PC / Phone)     | persists across restarts.          | share this guestId.               |
+--------------------------+------------------------------------+-----------------------------------+
| Multi-Player Device      | Default: Shared browser profile.   | REQUIRES: B18-C "Switch Profile"  |
| (Shared Family Tablet)   | Shared guestId unless partitioned. | modal to isolate storage keys.    |
+--------------------------+------------------------------------+-----------------------------------+
| Guest Identity           | Anonymous guest_<uuid>; zero       | Full offline gameplay, local saves|
|                          | cloud sync by default.             | intact in local stores.           |
+--------------------------+------------------------------------+-----------------------------------+
| Registered Identity      | Supabase Auth UUID (user_id);      | Linked via guest_identity_links;  |
|                          | JWT session in localStorage.       | cloud sync enabled upon consent.  |
+--------------------------+------------------------------------+-----------------------------------+
| Account Switching        | User logs out of Account A;        | Prompts: Keep local saves for     |
| (Account A -> B)         | logs into Account B.               | guest, or clear for Account B.    |
+--------------------------+------------------------------------+-----------------------------------+
| Guest-to-Account         | guest_<uuid> linked to             | Local saves preserved and pushed  |
| Migration                | new user_id in database.           | as initial revision (rev: 1).     |
+--------------------------+------------------------------------+-----------------------------------+
| Cross-Device Continuity  | Player logs into Account A on      | Cloud saves pulled and applied to |
| (Phone -> Tablet)        | Device 2.                          | Device 2 via resolveGameMerge.    |
+---------------------------------------------------------------------------------------------------+
```

---

### B. Local Storage & Persistence Architecture

#### 1. Relationship Between IndexedDB & localStorage
AuroMind operates a **Coordinated Dual-Store Persistence Model**:
- **IndexedDB (`AuroMindPlatformDB`, store `platform_meta`):** The **primary durable vault**. Immune to the 5 MB browser quota limit; resilient against aggressive browser cleanup; supports structured transactions.
- **localStorage (`auromind.platform.v1.guest`):** The **synchronous access mirror**. Provides instant synchronous reads on page startup so the UI renders without asynchronous flickering before IndexedDB finishes opening.

#### 2. Authoritativeness & Consistency Maintenance
- **Authoritative Source:** IndexedDB is authoritative for long-term retention. LocalStorage is an access cache.
- **Write Consistency:** Writes execute synchronously to `localStorage`, followed immediately by an asynchronous transaction to `IndexedDB`.
- **Reconciliation Rule:** If IndexedDB and localStorage disagree (e.g. manual tampering or partial browser clearing), the SDK automatically adopts the record with the **earliest `createdAt` timestamp** and overwrites the newer/tampered record.

#### 3. Interrupted Write Recovery & Auto-Healing
- If an IndexedDB transaction aborts mid-write (e.g. mobile tab closed or battery died):
  - IndexedDB automatically rolls back the transaction (ACID transaction property).
  - On the next application launch, `sdk.init()` detects the missing or stale IndexedDB entry and **auto-heals IndexedDB from the intact localStorage mirror**.
  - Conversely, if localStorage was wiped by a privacy cleaner but IndexedDB remains, the SDK **auto-heals localStorage from IndexedDB**.
  - All healing actions are logged in `storageHealth.lastRepairedFrom`.

#### 4. Storage Unavailability Fallbacks
- *If IndexedDB is disabled (e.g. Firefox Strict Mode or full disk):* Falls back cleanly to `localStorage` (`storageSource: 'localStorage'`).
- *If localStorage is disabled (e.g. storage quota exceeded):* Runs on `IndexedDB` (`storageSource: 'indexedDB'`).
- *If both are blocked (e.g. restricted in-app webview):* Degrades cleanly to ephemeral in-memory storage (`storageSource: 'memory'`, `ephemeral: true`). Gameplay continues uninterrupted for the active session, with a diagnostic warning surfaced.

---

### C. Save Synchronization & Conflict Resolution Scenarios

To prove that **no valid player progress is ever silently discarded**, we evaluate six concrete edge cases:

#### Scenario 1: Offline Tablet vs. Online Phone
- **Context:** Player plays AuroMatch on phone while online (cloud revision advances from 1 to 2; completed levels 1–10). Player simultaneously plays offline on a tablet (completed levels 11–15; tablet local baseRevision is still 1).
- **Execution:**
  1. Tablet reconnects to Wi-Fi. Sync worker pulls remote revision 2.
  2. Tablet detects conflict: local baseRevision (1) < remote revision (2).
  3. SDK invokes AuroMatch's `resolveGameMerge(localEnvelope, remoteEnvelope)`.
  4. AuroMatch merge strategy executes a mathematical union:
     - Merged levels: `{1..10} ∪ {11..15} = {1..15}`.
     - Merged lotus petals: `max(phonePetals, tabletPetals)`.
  5. Merged payload is saved locally and pushed to Supabase with `expectedRevision = 2`.
  6. Server commits revision 3. **Result: Zero levels lost.**

#### Scenario 2: Two Devices Progressing Simultaneously
- **Context:** Device A and Device B both start at cloud revision 5. Both push at the exact same second.
- **Execution:**
  1. Device A's push arrives at PostgreSQL RPC first: `expectedRevision = 5` matches current server revision (5). Save commits; new revision is 6.
  2. Device B's push arrives second: `expectedRevision = 5` mismatches current server revision (6).
  3. PostgreSQL RPC rejects Device B's write with `status: 'conflict'`, returning revision 6 server record.
  4. Device B receives `HTTP 409 Conflict`, applies `resolveGameMerge` against revision 6, merges progress locally, and retries push with `expectedRevision = 6`.
  5. Server commits revision 7. **Result: Both devices' progress safely preserved.**

#### Scenario 3: Older Cloud Data vs. Newer Local Data
- **Context:** Player played offline for a month on a laptop (level 100). Cloud has old progress from a month ago (level 20).
- **Execution:**
  1. Laptop connects to internet. Cloud save has revision 3 (level 20); laptop has revision 1 (level 100).
  2. Invariant 4 applies: merge strategy unions progress or detects higher local level.
  3. If automated merge is ambiguous, SDK returns `status: 'conflict_requires_user_choice'`.
  4. Portal presents a visual comparison dialog:
     - *Option 1:* Local Laptop Save (Level 100, Updated Today)
     - *Option 2:* Cloud Save (Level 20, Updated Oct 20)
  5. Player selects Option 1. Local save is pushed as new authoritative revision. **Result: Explicit user sovereignty.**

#### Scenario 4: Interrupted Synchronization
- **Context:** Mobile device pushes save while driving through a tunnel. Network connection drops mid-request.
- **Execution:**
  1. Network request fails or times out.
  2. The game ID remains tagged in `syncOutbox` (`LS_OUTBOX_KEY`).
  3. Because `upsert_game_save_checked` is a PostgreSQL transaction, the server database either completely committed or completely rolled back—no half-written rows exist.
  4. Upon reconnecting, the next sync cycle re-evaluates the outbox, pulls latest revision, and retries push cleanly. **Result: Idempotent and crash-proof.**

#### Scenario 5: Duplicate Synchronization Requests
- **Context:** Double-click on "Sync Now" button or rapid tab reloads trigger concurrent sync invocations.
- **Execution:**
  1. `syncService.syncNow()` wraps execution in an in-flight promise (`syncPromise`). Concurrent calls await the active sync operation without spawning duplicate HTTP requests.
  2. If a push is attempted for data that matches the cloud, Invariant 3 detects identical payload checksums (`localEnvelope.checksum === remoteEnvelope.checksum`) and immediately short-circuits with `status: 'use_local'`, making zero network calls. **Result: Zero redundant writes or bandwidth waste.**

#### Scenario 6: Empty or Corrupted Save Envelopes
- **Context:** Storage corruption causes local save to return null or invalid JSON, or a fresh device has an empty envelope.
- **Execution:**
  1. If local is empty and remote is non-empty, **Invariant 2** automatically adopts the remote progress (`status: 'use_remote'`).
  2. If remote is empty or null, **Invariant 1** strictly prohibits overwriting local progress (`status: 'use_local'`).
  3. If an envelope fails `validateSaveEnvelope()` (e.g. missing checksum or bad version), an exception is thrown, halting synchronization before corrupt data can be written to disk or cloud. **Result: Complete structural defense against corruption.**

---

### D. Game Adapter Integration Requirements

To achieve platform-wide uniformity in B18-B, the six launch games are classified into four integration categories:

```
+---------------------------------------------------------------------------------------------------+
|                                 GAME ADAPTER INTEGRATION MATRIX                                   |
+---------------------------------------------------------------------------------------------------+
| Game Slug            | Existing Adapter State    | B18-B Harmonization Requirement                |
+----------------------+---------------------------+------------------------------------------------+
| auromatch            | Native Controller         | Implement bespoke GameMergeStrategy (union     |
|                      | (storageAdapter.js)       | level IDs, max lotus petals & stats).          |
+----------------------+---------------------------+------------------------------------------------+
| auroblocks           | Standalone Bridge Module  | Implement bespoke GameMergeStrategy (union     |
|                      | (auroblocks-sdk-bridge.js)| unlocked stages, max high scores).             |
+----------------------+---------------------------+------------------------------------------------+
| auromandala          | Standalone Bridge Module  | Verify local-only Sankalpa exclusion;          |
|                      | (auromandala-sdk-bridge)  | implement safe artwork session merge.          |
+----------------------+---------------------------+------------------------------------------------+
| vak                  | Iframe Observer-Only      | AUTHOR NEW: games/vak/assets/vak-sdk-bridge.js |
|                      | (Inlined local storage)   | with exportEnvelope and word union merge.      |
+----------------------+---------------------------+------------------------------------------------+
| word-riddle          | Iframe Observer-Only      | AUTHOR NEW: games/word-riddle/assets/          |
|                      | (Inlined local storage)   | word-riddle-sdk-bridge.js (riddle union merge).|
+----------------------+---------------------------+------------------------------------------------+
| vak-living-sanctuary | Iframe Observer-Only      | AUTHOR NEW: games/vak-living-sanctuary/assets/ |
|                      | (Inlined local storage)   | vak-living-sanctuary-sdk-bridge.js (codex union)|
+---------------------------------------------------------------------------------------------------+
```

---

### E. Cross-Game Achievements Architecture (`sdk.achievements`)

To support meta-progression across the sanctuary without altering individual game balance, we propose the following `sdk.achievements` service contract for B18-B:

#### 1. Interface Specification
```typescript
interface AchievementsService {
  isAvailable(): boolean;
  getUnlocked(): readonly AchievementUnlockRecord[];
  hasUnlocked(achievementId: string): boolean;
  unlock(achievementId: string): Promise<AchievementUnlockResult>;
  getProgress(achievementId: string): AchievementProgress;
  listDefinitions(): readonly AchievementDefinition[];
  subscribe(listener: (event: AchievementEvent) => void): () => void;
  exportEnvelope(guestId: string): Promise<GameSaveEnvelope>;
  applyEnvelope(envelope: GameSaveEnvelope): Promise<boolean>;
}
```

#### 2. Key Architectural Guarantees
- **100% Offline Behavior:** Evaluated and unlocked locally. Persisted in `auromind.platform.v1.achievements`.
- **Duplicate Prevention:** Keyed on unique string IDs (e.g. `zen_master_50_levels`). Re-unlocking an already unlocked achievement is a no-op that returns existing unlock metadata.
- **Game Independence:** Games emit generic events (e.g. `level_completed`); the achievements engine listens on the internal platform bus and evaluates unlock criteria independently.
- **Future Cloud Sync:** Implements `exportEnvelope()` and `applyEnvelope()`, allowing achievements to synchronize across devices as a standard save envelope.

---

### F. Purchase Entitlements Architecture & Server Verification

#### 1. Provider-Agnostic Trusted Server Verification
The architecture strictly decouples payment UI from payment processing. It does not assume Stripe, Razorpay, or App Store in client code:

```
[ Client Browser ]                         [ Payment Gateway ]              [ Supabase Trusted Server ]
        |                                           |                                   |
        | 1. Request Purchase                       |                                   |
        |------------------------------------------>|                                   |
        |                                           |                                   |
        | 2. User completes payment on gateway UI   |                                   |
        |                                           |                                   |
        |                                           | 3. Webhook: Payment Verified      |
        |                                           |---------------------------------->|
        |                                           |                                   |
        |                                           |                                   | 4. Service Role RPC:
        |                                           |                                   |    Insert into 'entitlements'
        |                                           |                                   |    (user_id, sku, tier, active)
        |                                           |                                   |
        | 5. Refresh Entitlements (RLS Read-Only)   |                                   |
        |<------------------------------------------------------------------------------|
```

#### 2. Offline Behavior of Paid Content
- Entitlements fetched from the server are cached in `auromind.platform.v1.entitlements_cache` alongside a cryptographically validated expiration timestamp.
- While offline, `sdk.entitlements.hasEntitlement(gameId)` reads the local cache. Valid active entitlements remain fully unlocked offline.

#### 3. Reinstall & Cross-Device Recovery
- When a user gets a new phone or clears their browser:
  1. User signs into their Supabase account.
  2. `sdk.entitlements.refresh()` executes a read-only query against the `entitlements` table.
  3. Server returns all active entitlements tied to `auth.uid() = user_id`.
  4. Local cache is populated immediately. Zero manual "Restore Purchases" friction.

---

### G. Privacy, Security & Sacred Invariants Review

1. **Consent Lifecycle:** Telemetry collection defaults to disabled (`telemetryConsent === false`). Turning consent off immediately executes `telemetryService.clearQueue()` and wipes `LS_TELEMETRY_KEY`.
2. **Telemetry Data Retention:** Telemetry events stored in Supabase are capped at a 90-day retention horizon, enforced via scheduled PostgreSQL function `prune_expired_telemetry()`.
3. **GDPR Account Erasure:** Invoking `sdk.player.deleteUserData()` executes client-side wiping and triggers `delete-account` Edge Function to scrub all user rows from PostgreSQL.
4. **Client Trust Model:** The browser client is treated as **100% untrusted**. Client-supplied user IDs, roles, and timestamps are ignored by server RPCs; `auth.uid()` is derived solely from the cryptographically verified JWT session.
5. **Permanent Sankalpa Vault Boundary:** The Sankalpa vault is encrypted locally via AES-GCM with a user-supplied passphrase. It is excluded from the sync outbox, excluded from save export envelopes, and barred by migration assertion filters. It remains a permanent local-only sacred invariant.

---

## 4. Evidence Matrix: Verification of Implementation Claims

| Architecture Claim | Canonical Source File & Interface | Existing Test Evidence | Remaining Unverified Assumptions |
|:---|:---|:---|:---|
| **Guest Identity Generation** | [auromind-sdk.js](file:///C:/AuroMindPortal/assets/sdk/auromind-sdk.js#L74-L94): `generateUuidV4()` | [auromind-sdk.test.js](file:///C:/AuroMindPortal/auromind-sdk.test.js#L412): Test 1 (Persists versioned UUID) | None (100% verified locally). |
| **Multi-Tab Web Locks** | [auromind-sdk.js](file:///C:/AuroMindPortal/assets/sdk/auromind-sdk.js#L33): `WEB_LOCK_NAME` | [auromind-sdk.test.js](file:///C:/AuroMindPortal/auromind-sdk.test.js#L540): Test 5 (Multiple tabs converge) | Assumes browser supports `navigator.locks` or degrades cleanly. |
| **Storage Auto-Healing** | [auromind-sdk.js](file:///C:/AuroMindPortal/assets/sdk/auromind-sdk.js#L1400): `getStorageHealth()` | [auromind-sdk.test.js](file:///C:/AuroMindPortal/auromind-sdk.test.js#L680): Tests 9 & 10 (IDB & LS mutual repair) | None (100% verified locally). |
| **Save Envelope Validation** | [auromind-adapters.js](file:///C:/AuroMindPortal/assets/sdk/auromind-adapters.js#L367): `validateSaveEnvelope()` | [auromind-sdk.test.js](file:///C:/AuroMindPortal/auromind-sdk.test.js#L1020): Test 23 (Save envelopes enforce invariants) | None (100% verified locally). |
| **Non-Destructive Merge** | [auromind-adapters.js](file:///C:/AuroMindPortal/assets/sdk/auromind-adapters.js#L453): `resolveGameMerge()` | [auromind-sdk.test.js](file:///C:/AuroMindPortal/auromind-sdk.test.js#L1040): Invariants 1–4 verified | Bespoke game merge strategies pending in B18-B. |
| **Optimistic RPC Locking** | [supabase-sync-provider.js](file:///C:/AuroMindPortal/assets/sdk/providers/supabase/supabase-sync-provider.js#L79): `upsert_game_save_checked` | [b5-supabase.test.js](file:///C:/AuroMindPortal/b5-supabase.test.js#L291): Mock RPC concurrency test | Real PostgreSQL execution pending live Supabase in B18-C. |
| **Service Role Key Shield** | [backend-config.js](file:///C:/AuroMindPortal/assets/sdk/config/backend-config.js#L68): Throws on `service_role` | [b6-security-verification.test.js](file:///C:/AuroMindPortal/b6-security-verification.test.js#L310): Rejection test | None (100% verified locally). |
| **Sankalpa Local-Only E2EE** | [auromandala-sdk-bridge.js](file:///C:/AuroMindPortal/games/auromandala/assets/auromandala-sdk-bridge.js#L27): `cloudSyncEligible: false` | [b6-security-verification.test.js](file:///C:/AuroMindPortal/b6-security-verification.test.js#L458): Vault isolation test | None (100% verified locally). |
| **VAK Corpus Checksum** | [games/vak/index.html](file:///C:/AuroMindPortal/games/vak/index.html): `const CL = [[...]]` | [b11-game-integration.test.js](file:///C:/AuroMindPortal/b11-game-integration.test.js#L109): SHA-256 exact match | None (Immutable `9fdb38...`). |
| **Flora Database Size** | [floraDatabase.js](file:///C:/AuroMindPortal/games/auromatch/src/models/floraDatabase.js): 2,002,176 Bytes | [b11-game-integration.test.js](file:///C:/AuroMindPortal/b11-game-integration.test.js#L117): Stat size exact match | None (Immutable `689d03...`). |
| **Telemetry Ingestion Cap** | [telemetry-handler.js](file:///C:/AuroMindPortal/supabase/functions/ingest-telemetry/telemetry-handler.js): 64 KiB cap | [b8-security-remediation.test.js](file:///C:/AuroMindPortal/b8-security-remediation.test.js#L180): 64 KiB rejection test | Real Edge Function execution pending live Supabase in B18-C. |

---

## 5. Security & Data-Loss Risk Review

| Risk ID | Threat Description | Inherent Severity | Planned Mitigation & Implementation Status | Residual Risk |
|:---:|:---|:---:|:---|:---:|
| **SEC-01** | Accidental commit of `SUPABASE_SERVICE_ROLE_KEY` | **CRITICAL** | Hardcoded runtime throw in SDK; pre-commit git secret scanning. | **NEGLIGIBLE** |
| **SEC-02** | Leakage of Sankalpa spiritual contemplation vault | **CRITICAL** | `cloudSyncEligible: false`, sync service skip, migration regex filter. | **NEGLIGIBLE** |
| **SEC-03** | Shared device cross-player save contamination | **HIGH** | Explicit Session Boundary modal upon logout (`GAP-02` in B18-C). | **LOW** |
| **SEC-04** | Client tampering with cloud save tables | **CRITICAL** | Strict Row Level Security (`auth.uid() = user_id`) + RPC validation. | **LOW** |
| **SEC-05** | Telemetry ingestion endpoint DoS flooding | **HIGH** | Edge Function 64 KiB limit, 50-event batch cap, sliding rate limit. | **LOW** |
| **SEC-06** | Stale cloud save overwriting newer offline progress | **HIGH** | Optimistic concurrency revision checks (`expectedRevision = baseRevision`). | **NEGLIGIBLE** |
| **SEC-07** | Commercial gate client-side bypass | **HIGH** | Server-verified signed claims required for paid content in Phase 2. | **LOW** |

---

## 6. Required Remediation Prior to B18-B Execution

The following technical tasks are confirmed as the scope of B18-B (zero cloud changes):

1. **Standardize Adapter Bridges (`GAP-01`):**
   - Author `games/vak/assets/vak-sdk-bridge.js`.
   - Author `games/word-riddle/assets/word-riddle-sdk-bridge.js`.
   - Author `games/vak-living-sanctuary/assets/vak-living-sanctuary-sdk-bridge.js`.
2. **Implement Game Merge Strategies (`GAP-04`):**
   - Author `AuroMatchMergeStrategy` (level union + max petals).
   - Author `AuroBlocksMergeStrategy` (stage union + max high scores).
   - Author `WordRiddleMergeStrategy` (riddle ID union).
3. **Formalize Cross-Game Achievements (`GAP-03`):**
   - Author `sdk.achievements` service namespace and definition registry.

---

## 7. Decisions Requiring Explicit Product Owner Approval

Prior to beginning code authoring in B18-B, the product owner must review and confirm:

1. **Approval of ADR-01 through ADR-10:** Confirmation of proposed technical recommendations.
2. **Commercial Gate Confirmation (ADR-08):** Explicit confirmation that AuroMasti remains 100% free and unrestricted during the current beta phase.
3. **Sankalpa Permanent Exclusion (ADR-09 / SEC-02):** Re-affirmation that the Sankalpa contemplation vault will never be uploaded to cloud databases.
4. **Scope of B18-B:** Approval to proceed with local adapter harmonization and achievements without provisioning Supabase.

---

## 8. Recommended Execution Sequence

```
+-----------------------------------------------------------------------------------------+
|                                  PHASE B18-A2 (Complete)                                |
|  - Comprehensive Architecture Review Delivered                                          |
|  - 10 ADRs Evaluated & Prepared for Review                                              |
|  - All 6 Critical Architectural Questions Answered                                      |
+-----------------------------------------------------------------------------------------+
                                            |
                                            v
                                  [ Owner Review & Sign-Off ]
                                            |
                                            v
+-----------------------------------------------------------------------------------------+
|                                    PHASE B18-B (Next)                                   |
|  - Author 3 Standalone Game Adapter Bridges (VAK, Word Riddle, VAK Sanctuary)           |
|  - Register 3 Bespoke Game Merge Strategies (AuroMatch, AuroBlocks, Word Riddle)        |
|  - Author sdk.achievements Interface & Registry                                         |
|  - Validate 100% Offline Regression Suite (All 251 Tests + New Adapter Tests)           |
+-----------------------------------------------------------------------------------------+
                                            |
                                            v
+-----------------------------------------------------------------------------------------+
|                                    PHASE B18-C (Backend)                                |
|  - Provision Supabase Project via Official CLI                                          |
|  - Execute Verified PostgreSQL Migrations with Strict RLS                               |
|  - Deploy Edge Functions (ingest-telemetry, sync-save, owner-metrics)                   |
|  - End-to-End Live Browser & Multi-Device Conformance Validation                        |
+-----------------------------------------------------------------------------------------+
```
