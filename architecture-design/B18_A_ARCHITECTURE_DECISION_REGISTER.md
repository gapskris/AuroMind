# B18-A — Architecture Decision Register (ADR)

**Author:** AuroMind Platform Architecture Team  
**Date:** November 21, 2026  
**Canonical Workspace:** `C:\AuroMindPortal`  
**Active Git Branch:** `dev/studio-integration`  
**Baseline HEAD Commit:** `b6ccc860bb7d38a70ef678049a9588b8b73c40aa`  
**Target Release:** January 1, 2027  
**Status:** PROPOSED & PENDING OWNER APPROVAL (Zero Code Changes)  

---

## Architecture Decision Summary Table

| ADR # | Architecture Decision Title | Proposed Recommendation | Status | Owner Approval |
|:---:|:---|:---|:---:|:---:|
| **ADR-01** | **Canonical Player Identity Model** | Unified RFC-4122 UUIDv4 guest identity with dual IDB+LS persistence and optional account linking. | Recommended | **REQUIRED** |
| **ADR-02** | **Game-Specific Progression Schema** | Opaque, versioned payload inside standardized `SAVE_ENVELOPE_VERSION = 1`. | Recommended | **REQUIRED** |
| **ADR-03** | **Shared Service Contracts** | Provider-independent ES module singleton (`assets/sdk/auromind-sdk.js`) exposing frozen sub-services. | Recommended | **REQUIRED** |
| **ADR-04** | **Guest-to-Account Migration** | Non-destructive `guest_identity_links` relational mapping preserving local progress. | Recommended | **REQUIRED** |
| **ADR-05** | **Offline Synchronization Strategy** | Local-authoritative outbox queue with optimistic revision concurrency (`upsert_game_save_checked`). | Recommended | **REQUIRED** |
| **ADR-06** | **Conflict Resolution Policy** | Non-destructive Invariants 1–4 with delegation to registered game merge strategies or user choice modal. | Recommended | **REQUIRED** |
| **ADR-07** | **Cloud vs. Local Data Ownership** | Client device owns primary authoritative state; cloud serves as durable synchronization replica. | Recommended | **REQUIRED** |
| **ADR-08** | **Purchase Entitlement Architecture** | Dual-phase: Free beta access currently; server-verified, cryptographically signed receipts when activated. | Recommended | **REQUIRED** |
| **ADR-09** | **Analytics & Privacy Boundaries** | Zero PII, strict opt-in consent, 64 KiB Edge Function caps, and absolute Sankalpa vault exclusion. | Recommended | **REQUIRED** |
| **ADR-10** | **Backend-Independent SDK Design** | Provider Adapter Pattern decoupling all games from concrete backend SDKs (Supabase/Firebase/Null). | Recommended | **REQUIRED** |

---

## ADR-01: Canonical Player Identity Model

### 1. What It Means
The platform mints a single, persistent guest identity formatted as `guest_<uuidv4>` per browser profile. It is persisted across IndexedDB (`AuroMindPlatformDB`, store `platform_meta`) and synchronous localStorage (`auromind.platform.v1.guest`), synchronized across concurrent browser tabs using Web Locks and BroadcastChannel. When a player registers or authenticates with Supabase, this guest ID is linked to the Supabase `auth.users.id` via a dedicated relational join table (`guest_identity_links`), rather than overwriting or replacing the local identifier.

### 2. Why It Is Needed
Without a unified guest identity, each game would generate its own independent identifier, preventing cross-game achievements, synchronized settings (e.g. Senior Mode), unified guest progression, and smooth cloud migration.

### 3. How It Affects Users
Users can launch the portal and play any of the six games immediately without encountering a sign-up modal, paywall, or login prompt. Their progress, high scores, and preferences survive browser restarts, tab reloads, and offline periods seamlessly.

### 4. What Can Go Wrong If We Choose Incorrectly
- *If we require registration upfront:* Friction increases dramatically, driving away casual players seeking quick contemplative gaming.
- *If we rely solely on cookies or localStorage:* Browsers with aggressive storage eviction (e.g. Safari ITP) will wipe player progress unexpectedly.
- *If we allow game-specific identities:* Players lose their unified identity across the AuroMasti portal.

### 5. Status: `PROPOSED — PENDING OWNER APPROVAL`

---

## ADR-02: Game-Specific Progression Schema

### 1. What It Means
The platform SDK standardizes the outer envelope framing (`GameSaveEnvelope`), requiring `envelopeVersion`, `gameId`, `gameSchemaVersion`, `guestId`, `baseRevision`, `clientUpdatedAt`, `isEmpty`, and `checksum`. However, the SDK treats the `payload` property as completely opaque, leaving the internal schema design, level tracking, and gameplay variables strictly to each game's domain logic.

### 2. Why It Is Needed
AuroMasti features wildly diverse game genres—rhythm words (VAK), physics block puzzles (AuroBlocks), tile solitaires (AuroMatch), generative sacred geometry (AuroMandala), and riddle engines (Word Riddle). Imposing a monolithic "progress" schema (such as forcing everything into `levelNumber: number`) would break game flexibility and cause brittle coupling.

### 3. How It Affects Users
Each game can save rich, genre-specific details—such as AuroMandala's exported SVG mandala geometry or AuroMatch's constellation petal states—without data corruption or loss.

### 4. What Can Go Wrong If We Choose Incorrectly
- *Monolithic schema:* Games are forced into artificial constraints, preventing advanced game-specific save mechanics.
- *Unenveloped saves:* The platform sync engine would be unable to calculate checksums, verify revisions, or detect concurrency conflicts.

### 5. Status: `PROPOSED — PENDING OWNER APPROVAL`

---

## ADR-03: Shared Service Contracts

### 1. What It Means
All shared platform capabilities (identity, storage, auth, sync, telemetry, entitlements, config, player profile) are exposed via a frozen, framework-agnostic ES module singleton (`AuroMindSDK`). Sub-services are accessible as namespaced sub-objects (`sdk.identity`, `sdk.storage`, `sdk.sync`, etc.) with immutable return structures (`Object.freeze`).

### 2. Why It Is Needed
Multiple games and the portal bootstrap need access to shared features without introducing globals that could be mutated, collided with, or monkey-patched.

### 3. How It Affects Users
Ensures reliable, predictable platform behavior, eliminates runtime crashes caused by concurrent script interference, and guarantees consistent UX across the portal theater.

### 4. What Can Go Wrong If We Choose Incorrectly
Scattering shared utilities across window globals or loose utility functions leads to version skew, namespace pollution, unmockable test harnesses, and security holes.

### 5. Status: `PROPOSED — PENDING OWNER APPROVAL`

---

## ADR-04: Guest-to-Account Migration

### 1. What It Means
When an anonymous guest player decides to create an account or sign in, the platform executes `sdk.auth.upgradeGuestToAccount()`:
1. Authenticates user via Supabase Auth (`signUp` or `signIn`).
2. Upserts a link in `guest_identity_links` associating `(user_id, guest_id, device_label)`.
3. Prompts the user with explicit consent to upload existing local saves to the cloud.
4. Preserves all local guest saves in the browser, ensuring zero data loss during migration.

### 2. Why It Is Needed
Players who invest hours into unlocking levels as guests must not lose their progress when registering for cloud backup or cross-device play.

### 3. How It Affects Users
Upgrading to a registered account is seamless, reassuring, and non-destructive. The user retains all unlocked content.

### 4. What Can Go Wrong If We Choose Incorrectly
- Overwriting local guest progress with an empty cloud account on first login would cause catastrophic player data loss and churn.
- Blindly associating multiple players' devices to a single account without consent can cause privacy violations.

### 5. Status: `PROPOSED — PENDING OWNER APPROVAL`

---

## ADR-05: Offline Synchronization Strategy

### 1. What It Means
The platform adopts an "Offline-Outbox with Optimistic Concurrency" architecture:
- Local changes are immediately written to local storage and tagged in an offline outbox (`LS_OUTBOX_KEY`).
- When network connectivity is established, `syncService.syncNow()` processes pending games sequentially.
- Pushes invoke a server-side PostgreSQL RPC (`upsert_game_save_checked`) supplying `expectedRevision = baseRevision`.
- If the server revision matches, the save is committed and revision incremented. If the server revision has advanced, an HTTP 409 Conflict is returned.

### 2. Why It Is Needed
Prevents silent data loss when a player switches devices, plays offline on a train or flight, and later reconnects while another device was also active.

### 3. How It Affects Users
Game saves sync smoothly in the background without lag, blocking dialogs, or gameplay interruption during poor network conditions.

### 4. What Can Go Wrong If We Choose Incorrectly
- "Last-write-wins" without revisions causes accidental progress erasure when an older offline device finally connects and overwrites newer progress.
- Blocking network sync ruins offline playability and degrades performance.

### 5. Status: `PROPOSED — PENDING OWNER APPROVAL`

---

## ADR-06: Conflict Resolution Policy

### 1. What It Means
When a sync collision occurs (HTTP 409), the platform enforces four strict non-destructive invariants before any custom logic:
- **Invariant 1:** Empty remote never overwrites local progress (`status: 'use_local'`).
- **Invariant 2:** Empty local adopts non-empty remote (`status: 'use_remote'`).
- **Invariant 3:** Identical payload checksums require no merge (`status: 'use_local'`).
- **Invariant 4:** If both local and remote contain distinct progress, the SDK delegates to the game's registered `GameMergeStrategy`. If none is registered, it triggers `status: 'conflict_requires_user_choice'`, presenting a visual comparison modal showing timestamps and levels.

### 2. Why It Is Needed
No generic algorithm can safely merge disparate game data (e.g. an incomplete puzzle grid vs. an alternative high score). Automated destructive merges risk wiping high scores or corrupted save files.

### 3. How It Affects Users
Players never have their hard-earned progress silently erased. In ambiguous cases, they are empowered with a clear, friendly choice.

### 4. What Can Go Wrong If We Choose Incorrectly
Arbitrary timestamp-based resolution can discard higher level progression simply because an older save had a skewed clock.

### 5. Status: `PROPOSED — PENDING OWNER APPROVAL`

---

## ADR-07: Cloud vs. Local Data Ownership

### 1. What It Means
The client device's IndexedDB and localStorage are the **primary operational authority**. The cloud database (Supabase) is designated as a **durable synchronization replica and backup vault**. Gameplay reads and writes are always executed locally first. Cloud replication occurs asynchronously.

### 2. Why It Is Needed
Guarantees 100% offline operability, instant load times, zero latency during gameplay interactions, and immunity to cloud outages or backend downtime.

### 3. How It Affects Users
Games load in milliseconds, controls remain ultra-responsive, and players are never locked out of their games due to network or server hiccups.

### 4. What Can Go Wrong If We Choose Incorrectly
Making the cloud authoritative turns AuroMasti into an "always-online" web app, destroying offline usability and dramatically increasing Supabase database compute/bandwidth costs.

### 5. Status: `PROPOSED — PENDING OWNER APPROVAL`

---

## ADR-08: Purchase Entitlement Architecture

### 1. What It Means
AuroMasti enforces a two-phase commercialization model:
- **Phase 1 (Current Beta):** Commercial gates disabled (`COMMERCIAL_GATE_ENABLED: false`). All 520 AuroMatch levels, all 1,368 VAK puzzles, and all game modes are completely free and open.
- **Phase 2 (Production Activation):** Entitlements will be verified server-side via Supabase `entitlements` table signed claims. Client-side localStorage license flags and unverified postMessage tokens are strictly disabled and blocked.

### 2. Why It Is Needed
Allows seamless beta testing, prevents premature commercial friction, while establishing a robust, tamper-resistant foundation for future season passes or expansions.

### 3. How It Affects Users
Current beta testers experience a peaceful, untimed, paywall-free sanctuary. Future buyers are guaranteed permanent, cross-device ownership of purchased content.

### 4. What Can Go Wrong If We Choose Incorrectly
- Premature paywalls alienate early adopters and contemplative audiences.
- Naive client-side license checks invite trivial piracy, reverse-engineering, and broken entitlement restores.

### 5. Status: `PROPOSED — PENDING OWNER APPROVAL`

---

## ADR-09: Analytics & Privacy Boundaries

### 1. What It Means
The platform maintains strict privacy boundaries:
1. **Zero PII:** No names, emails, IP addresses, or device hardware fingerprints in telemetry payloads.
2. **Explicit Opt-In:** Telemetry collection requires visitor consent (`LS_CONSENT_KEY`). Opting out immediately flushes and purges the local queue.
3. **Protected Data Exclusion:** The AuroMandala Sankalpa contemplation vault is declared `localOnlyVaults: ['sankalpa_e2ee_vault']` and **100% excluded from telemetry and cloud sync**.
4. **Ingestion Caps:** Payloads bounded to 64 KiB, batches capped at 50 events, enforced via Supabase Edge Function with rate limiting.

### 2. Why It Is Needed
AuroMasti is a sacred, mindful, contemplative space. Violating player trust or leaking intimate spiritual reflections (Sankalpa) would betray the core ethos of Sri Aurobindo and The Mother's teachings.

### 3. How It Affects Users
Players can reflect and contemplate in peace, confident that their inner aspirations and personal notes remain sacred and private on their own devices.

### 4. What Can Go Wrong If We Choose Incorrectly
Leaking sensitive reflection notes or tracking players without consent violates GDPR, COPPA, and platform integrity, causing reputational ruin.

### 5. Status: `PROPOSED — PENDING OWNER APPROVAL`

---

## ADR-10: Backend-Independent SDK Design

### 1. What It Means
The AuroMind SDK architecture enforces a strict Provider Adapter Pattern (`assets/sdk/config/backend-config.js`). Games interact exclusively with the high-level SDK interface (`AuroMind.sync`, `AuroMind.auth`, `AuroMind.telemetry`). Under the hood, the SDK delegates to configured provider adapters (`supabase`, `firebase`, or `null`). Games never import or reference cloud SDKs directly. Furthermore, frontend code is hardcoded to throw security violations if service role or private keys are detected.

### 2. Why It Is Needed
Prevents vendor lock-in, ensures easy local mock testing, and allows seamless backend migration without rewriting or retesting individual games.

### 3. How It Affects Users
Users experience zero disruption regardless of backend hosting updates, provider migrations, or infrastructure maintenance.

### 4. What Can Go Wrong If We Choose Incorrectly
Coupling games directly to Supabase APIs turns future backend refactoring into an expensive, high-risk rewrite of every individual game.

### 5. Status: `PROPOSED — PENDING OWNER APPROVAL`
