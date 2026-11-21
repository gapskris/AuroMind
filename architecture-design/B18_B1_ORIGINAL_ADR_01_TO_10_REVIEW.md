# AuroMasti B18-B1 — Formal Architecture Decision Review
## Evidence-Based Review of Original ADR-01 through ADR-10 & Remediation Alignment

- **Document Version:** 1.0.0
- **Batch Reference:** B18-B1 Formal Architecture Decision Review
- **Canonical Workspace:** `C:\AuroMindPortal`
- **Active Git Branch:** `dev/studio-integration`
- **Baseline HEAD:** `b6ccc860bb7d38a70ef678049a9588b8b73c40aa`
- **Target Platform Release:** January 1, 2027
- **Governance Mandate:** All 10 original ADRs remain **PENDING OWNER APPROVAL**. This review establishes the formal evidence base, risk profile, and technical conditions required for owner signoff.

---

## 1. Executive Summary & Governance Alignment

During the initial B18-A/A2 architecture phase, ten foundational Architecture Decision Records (ADR-01 through ADR-10) were established to govern AuroMasti's transition into a resilient, local-first web gaming platform. Subsequent critical reviews in B18-A3 and blueprint specifications in B18-B1 identified specific operational vulnerabilities (findings F-01 through F-09).

This document executes a **formal, evidence-based review of the original ten ADRs** in their exact canonical definitions. It re-anchors every finding, contract, and merge policy directly to these original decisions.

### Non-Negotiable Architectural Principles:
1. **One Browser Profile = One Persistent Player Identity:** All six launch games share a unified anonymous guest identifier (`guest_<uuidv4>`) managed by the Shared SDK. In-app multiple profiles, profile pickers, and player switching are strictly prohibited.
2. **Local Operational Authority:** The browser device is the primary authority for gameplay state, level progression, and offline execution. Cloud services (Supabase) function solely as an optional durable backup and cross-device sync replica.
3. **Zero Data Loss Guarantee (AuroMandala Artwork Protection):** The owner has explicitly selected **versioned artwork with conflict recovery**. No sync or merge operation may ever silently overwrite player artwork.
4. **Sacred Data Immutability:** VAK Speech Training Corpus, Flora Botanical Database, and Sankalpa Contemplation Vault must remain byte-exact and architecturally protected.
5. **Zero Deferred Findings:** Every P1, P2, and P3 finding (F-01 through F-09) and discovered architectural gap is fully addressed in the design without deferral.

---

## 2. Evidence-Based Review: Original ADR-01 through ADR-10

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           ORIGINAL ADR REGISTER INDEX                           │
├─────────┬──────────────────────────────────────────┬────────────────────────────┤
│ ADR-01  │ Canonical Player Identity Model          │ Section 2.1                │
│ ADR-02  │ Versioned Opaque Save Payloads           │ Section 2.2                │
│ ADR-03  │ Singleton Shared SDK                     │ Section 2.3                │
│ ADR-04  │ Non-Destructive Guest Identity Migration │ Section 2.4                │
│ ADR-05  │ Local-Authoritative Sync Outbox          │ Section 2.5                │
│ ADR-06  │ Game-Specific Conflict Resolution        │ Section 2.6                │
│ ADR-07  │ Local Operational Authority              │ Section 2.7                │
│ ADR-08  │ Purchase and Entitlement Architecture    │ Section 2.8                │
│ ADR-09  │ Privacy, Telemetry & Sankalpa Exclusion  │ Section 2.9                │
│ ADR-10  │ Provider-Independent Backend Adapter     │ Section 2.10               │
└─────────┴──────────────────────────────────────────┴────────────────────────────┘
```

---

### 2.1 ADR-01: Canonical Player Identity Model

#### 1. Original Proposal & Intent
Establish a single, stable anonymous guest identity formatted as `guest_<uuidv4>` per browser profile. Persist identically across IndexedDB (`AuroMindPlatformDB`, store `platform_meta`) and synchronous localStorage (`auromind.platform.v1.guest`). Coordinate concurrent initialization across tabs using Web Locks (`navigator.locks`) and BroadcastChannel. When registering or authenticating, link this guest ID to the cloud account via a relational join table (`guest_identity_links`) rather than replacing the local identifier.

#### 2. Implementation Evidence in Current Codebase
- **Source File:** [auromind-sdk.js](file:///C:/AuroMindPortal/assets/sdk/auromind-sdk.js#L140-L310)
- **Active Tests:** `server.test.js` tests 1–17 verify:
  - First-time UUIDv4 generation and dual-store persistence.
  - Multi-tab convergence via Web Locks (`auromind_identity_lock`).
  - Deterministic tie-breaking favoring the earliest `createdAt` timestamp.
  - Auto-healing between corrupted localStorage and valid IndexedDB.
- **Current Test Coverage:** 17/17 dedicated automated identity tests passing.

#### 3. B18-A3 & B18-B1 Finding Alignment
- **F-04 (Storage Resilience):** Safari 7-day ITP and Chromium LRU eviction threaten the persistent identity.
- **F-05 (Auto-Healing):** Cross-store corruption recovery mechanics must be hardened.

#### 4. Architectural Analysis
- **Benefits:** Frictionless, zero-login onboarding; instant gameplay across all 6 games; unified identity foundation for cross-game achievements and synchronized settings (Senior Mode).
- **Trade-offs:** Browser data purges (e.g., clearing site data) will mint a new identity unless linked to cloud backup.
- **Security Implications:** Zero PII exposure; identity is an anonymous cryptographic UUIDv4; no device fingerprinting or IP tracking.
- **Data-Integrity Implications:** Web Locks completely prevent identity race conditions when multiple game tabs open simultaneously.
- **Dependencies:** Foundation for ADR-02, ADR-04, ADR-05, ADR-06, ADR-08, ADR-09.

#### 5. Evaluation & Recommendation
- **Recommendation:** **APPROVE WITH CONDITIONS**
- **Approval Conditions:**
  1. Formal integration of non-blocking `navigator.storage.persist()` (F-04) during identity initialization to mitigate Safari 7-day eviction.
  2. Maintain strict non-negotiable rule: **One browser profile = one persistent player identity**. No in-app profile switching or selector dialogs.
- **Implementation Milestone Phase:** Phase B18-B1 (Client SDK Hardening).

---

### 2.2 ADR-02: Versioned Opaque Save Payloads

#### 1. Original Proposal & Intent
Standardize the outer save envelope (`GameSaveEnvelope`) with required platform metadata (`envelopeVersion: 1`, `gameId`, `gameSchemaVersion`, `guestId`, `baseRevision`, `clientUpdatedAt`, `isEmpty`, `checksum`), while treating the `payload` object as completely opaque to the Shared SDK. Game engines retain full autonomy over their internal game-specific data models.

#### 2. Implementation Evidence in Current Codebase
- **Source Files:**
  - [auromind-adapters.js](file:///C:/AuroMindPortal/assets/sdk/auromind-adapters.js#L80-L150): Defines envelope framing and invariant checks.
  - [auroblocks-sdk-bridge.js](file:///C:/AuroMindPortal/games/auroblocks/assets/auroblocks-sdk-bridge.js): Implements envelope packing/unpacking for AuroBlocks.
  - [auromandala-sdk-bridge.js](file:///C:/AuroMindPortal/games/auromandala/assets/auromandala-sdk-bridge.js): Envelope framing for AuroMandala.
- **Active Tests:** `server.test.js` tests 22–24 pass envelope validation checks.

#### 3. B18-A3 & B18-B1 Finding Alignment
- **F-01 (Artwork Protection):** Opaque payload framing in AuroMandala failed to deeply inspect `savedArtworks`.
- **F-02 (Weak Checksums):** Existing bridges used fragile string concatenation (`blocks_${score}_${len}`) instead of canonical hashing.
- **F-03 (Missing Adapters):** VAK, Word Riddle, and Sanctuary lacked standalone adapter bridges implementing this envelope.

#### 4. Architectural Analysis
- **Benefits:** Decouples the shared platform from diverse game genres (riddles, geometric art, physics, speech); enables platform-level revision tracking, checksums, and cloud sync without modifying game loop engines.
- **Trade-offs:** Opaque payloads prevent the generic SDK from performing deep automatic property merging without game-specific adapters.
- **Security Implications:** Payloads must be sanitized to ensure local-only vaults (Sankalpa) are never included in the transport envelope.
- **Data-Integrity Implications:** A standardized envelope is essential for optimistic concurrency control and detecting corrupted saves.
- **Dependencies:** Depends on ADR-01; prerequisite for ADR-05 and ADR-06.

#### 5. Evaluation & Recommendation
- **Recommendation:** **APPROVE WITH CONDITIONS**
- **Approval Conditions:**
  1. Mandate canonical JSON serialization and Web Crypto SHA-256 (`crypto.subtle`) across all game envelopes (F-02), excluding transport fields (`clientUpdatedAt`, `baseRevision`).
  2. Implement standalone envelope adapters for VAK, Word Riddle, and Sanctuary (F-03).
- **Implementation Milestone Phase:** Phase B18-B1 (Client SDK & Game Adapters).

---

### 2.3 ADR-03: Singleton Shared SDK

#### 1. Original Proposal & Intent
All shared platform capabilities (identity, storage, auth, sync, telemetry, entitlements, config) are exposed via a frozen, framework-agnostic ES module singleton (`AuroMindSDK`) loaded at the portal root and accessed via postMessage or direct bridge by game iframes. Sub-services are namespaced (`sdk.identity`, `sdk.storage`, `sdk.sync`, etc.) and protected with `Object.freeze`.

#### 2. Implementation Evidence in Current Codebase
- **Source Files:**
  - [auromind-sdk.js](file:///C:/AuroMindPortal/assets/sdk/auromind-sdk.js): Defines `AuroMindSDK` singleton.
  - [portal.js](file:///C:/AuroMindPortal/assets/js/portal.js): Initializes SDK on startup and coordinates iframe messaging.
- **Active Tests:** E2E Suite C tests 1–3 verify SDK loading, identity exposure, and dynamic config resolution.

#### 3. B18-A3 & B18-B1 Finding Alignment
- **F-03 (Missing Adapters):** Inconsistent game integration led to some games running standalone without the SDK.
- **F-06 (Achievements API):** Achievements service was missing from the SDK singleton interface.
- **F-08 (Telemetry Queue):** Telemetry queue inside SDK singleton lacked bounded durability and priority tiers.

#### 4. Architectural Analysis
- **Benefits:** Prevents namespace pollution, enforces immutability, provides a single point of contract enforcement, and eliminates script version skew.
- **Trade-offs:** If the singleton throws an uncaught error during initialization, downstream services could stall if not isolated.
- **Security Implications:** Exposing frozen sub-services prevents malicious or buggy third-party scripts from monkey-patching platform methods.
- **Data-Integrity Implications:** Ensures that all game saves flow through a single, validated pipeline with guaranteed invariant checks.
- **Dependencies:** Pre-requisite for all platform capabilities (ADR-01 through ADR-10).

#### 5. Evaluation & Recommendation
- **Recommendation:** **APPROVE WITH CONDITIONS**
- **Approval Conditions:**
  1. Standalone Game Graceful Degradation: Every game adapter bridge MUST include a local mock fallback (`window.AuroMindSDK || LocalMockBridge`) to guarantee that standalone game launches (outside the portal iframe) continue to play 100% offline without crashing.
  2. Add formal `sdk.achievements` service namespace to the singleton (F-06).
- **Implementation Milestone Phase:** Phase B18-B1 (Client SDK Remediation).

---

### 2.4 ADR-04: Non-Destructive Guest Identity Migration

#### 1. Original Proposal & Intent
When an anonymous guest player authenticates or registers an account, the platform executes `sdk.auth.upgradeGuestToAccount()`:
1. Authenticates via Supabase Auth (`signUp` or `signIn`).
2. Upserts a relational link in the cloud database (`guest_identity_links`) associating `(user_id, guest_id, device_label)`.
3. Prompts the user with explicit consent to upload local saves.
4. Preserves all local guest saves and local guestId in the browser, guaranteeing zero progress loss during migration.

#### 2. Implementation Evidence in Current Codebase
- **Source Files:**
  - [backend-migration.js](file:///C:/AuroMindPortal/assets/sdk/migration/backend-migration.js): Defines guest linking contracts and canonical export bundles.
  - [backend-config.js](file:///C:/AuroMindPortal/assets/sdk/config/backend-config.js): Defines schema mappings.
- **Active Tests:** `server.test.js` tests verify guest identity linking contracts and non-destructive cloud purges.

#### 3. B18-A3 & B18-B1 Finding Alignment
- **F-01 (Artwork Protection):** Artwork collections must not be overwritten or purged when a guest links an account.
- **F-07 (Domain Merge):** When linking to an account with existing cloud saves from another device, bespoke merge strategies must execute.

#### 4. Architectural Analysis
- **Benefits:** Completely eliminates the risk of "first-login wipe", where registering replaces a rich local guest save with an empty cloud profile.
- **Trade-offs:** Requires relational link management in the backend database rather than a simple 1:1 foreign key swap.
- **Security Implications:** User authorization must verify ownership of both the authenticated account and the guest device.
- **Data-Integrity Implications:** Local saves remain intact on disk even if network connectivity drops midway through the account linking operation.
- **Dependencies:** Depends on ADR-01; tightly coupled with ADR-02, ADR-05, and ADR-07.

#### 5. Evaluation & Recommendation
- **Recommendation:** **APPROVE WITH CONDITIONS**
- **Approval Conditions:**
  1. Client-Side Migration Atomicity: Account linking failure (network timeout, 5xx error) must cleanly roll back cloud-link state while leaving local guest storage 100% intact.
  2. Conflict Resolution Integration: If the linked account already owns existing cloud saves, ADR-06 domain merge policies must execute before committing.
- **Implementation Milestone Phase:** Phase B18-B (Supabase Schema & Auth Design).

---

### 2.5 ADR-05: Local-Authoritative Sync Outbox

#### 1. Original Proposal & Intent
Adopt an "Offline-Outbox with Optimistic Revision Concurrency" architecture:
- Local changes write immediately to local storage and queue in an offline outbox (`LS_OUTBOX_KEY`).
- When online, `syncService.syncNow()` processes pending saves sequentially.
- Pushes invoke a server-side PostgreSQL RPC (`upsert_game_save_checked`) verifying `expectedRevision = baseRevision`.
- If revisions match, save commits and revision increments. If the cloud revision has advanced, an HTTP 409 Conflict is returned, triggering ADR-06 reconciliation.

#### 2. Implementation Evidence in Current Codebase
- **Source Files:**
  - [auromind-sdk.js](file:///C:/AuroMindPortal/assets/sdk/auromind-sdk.js#L540-L660): Implements outbox queueing and sync trigger loop.
  - [backend-migration.js](file:///C:/AuroMindPortal/assets/sdk/migration/backend-migration.js): Implements optimistic concurrency handling.
- **Active Tests:** `server.test.js` B8 Security Tests 8–18 and Supabase Conformance Tests pass optimistic concurrency checks.

#### 3. B18-A3 & B18-B1 Finding Alignment
- **F-02 (Canonical SHA-256):** Checksum verification must confirm payload integrity before and after outbox transit.
- **F-04 (Storage Resilience):** Outbox must be durable across browser tab restarts and ITP storage pressure.

#### 4. Architectural Analysis
- **Benefits:** Zero gameplay latency; saves are instantaneous locally; cloud synchronization is completely non-blocking and backgrounded; automatic network retry with exponential backoff.
- **Trade-offs:** Requires robust conflict handling (ADR-06) when multiple offline devices reconnect.
- **Security Implications:** Outbox payloads must be validated against schema and size limits before dispatch.
- **Data-Integrity Implications:** Optimistic concurrency prevents blind overwriting of newer cloud saves by older offline devices.
- **Dependencies:** Depends on ADR-01, ADR-02, ADR-03; triggers ADR-06 on conflict.

#### 5. Evaluation & Recommendation
- **Recommendation:** **APPROVE WITH CONDITIONS**
- **Approval Conditions:**
  1. Durable Outbox Storage: Outbox queue MUST be persisted in IndexedDB with localStorage fallback, not solely in memory.
  2. Total Offline Independence: Offline gameplay must never be blocked or degraded by a stalled outbox queue.
- **Implementation Milestone Phase:** Phase B18-B1 (Client Outbox Durability) & Phase B18-B (Cloud RPC Design).

---

### 2.6 ADR-06: Game-Specific Conflict Resolution

#### 1. Original Proposal & Intent
When a sync collision occurs (HTTP 409), enforce four strict non-destructive invariants before any custom logic:
- **Invariant 1:** Empty remote never overwrites local progress (`status: 'use_local'`).
- **Invariant 2:** Empty local adopts non-empty remote (`status: 'use_remote'`).
- **Invariant 3:** Identical payload checksums require no merge (`status: 'use_local'`).
- **Invariant 4:** If both local and remote contain distinct progress, delegate to the game's registered `GameMergeStrategy`. If none is registered, trigger `status: 'conflict_requires_user_choice'`, presenting a visual comparison modal showing timestamps and levels.

#### 2. Implementation Evidence in Current Codebase
- **Source Files:**
  - [auromind-adapters.js](file:///C:/AuroMindPortal/assets/sdk/auromind-adapters.js#L140-L240): Implements Invariants 1–4 and adapter registry.
  - [auromandala-sdk-bridge.js](file:///C:/AuroMindPortal/games/auromandala/assets/auromandala-sdk-bridge.js): Implements legacy merge strategy.
- **Active Tests:** `server.test.js` tests 23 and Conformance test 3 verify merge invariants.

#### 3. B18-A3 & B18-B1 Finding Alignment
- **F-01 (Artwork Protection):** AuroMandala merge strategy executed blanket overwrite of `savedArtworks`. The owner explicitly selected **versioned artwork with conflict recovery**.
- **F-07 (Domain Merge Policies):** Inconsistent merge rules across AuroBlocks, AuroMatch, VAK, Word Riddle, and Sanctuary.

#### 4. Architectural Analysis
- **Benefits:** Prevents destructive "last-write-wins" erasures; respects the unique domain semantics of each game genre.
- **Trade-offs:** Requires maintaining dedicated merge algorithms for each of the six games.
- **Security Implications:** Merged payloads must be re-validated and re-checksummed before local persistence or cloud commit.
- **Data-Integrity Implications:** For AuroMandala, conflicting artworks fork into separate local copies, ensuring zero artwork loss under any sync race condition.
- **Dependencies:** Depends on ADR-01, ADR-02, ADR-05.

#### 5. Evaluation & Recommendation
- **Recommendation:** **APPROVE WITH CONDITIONS**
- **Approval Conditions:**
  1. AuroMandala Versioned Artwork Model: Re-structure artwork storage to UUIDv4 keys with monotonic revisions, soft deletions (tombstones), and automatic forking into `(Cloud Copy)` on content conflict.
  2. Implement tailored monotonic merge functions for all 6 games in `auromind-adapters.js` (F-07).
- **Implementation Milestone Phase:** Phase B18-B1 (Client Adapter Implementation).

---

### 2.7 ADR-07: Local Operational Authority

#### 1. Original Proposal & Intent
The client device's IndexedDB and localStorage are designated as the **primary operational authority**. The cloud database (Supabase) is designated as a **durable synchronization replica and backup vault**. Gameplay reads and writes are always executed locally first. Cloud replication occurs asynchronously.

#### 2. Implementation Evidence in Current Codebase
- **Source Files:**
  - [auromind-sdk.js](file:///C:/AuroMindPortal/assets/sdk/auromind-sdk.js): Storage service reads/writes local storage first.
  - [portal.js](file:///C:/AuroMindPortal/assets/js/portal.js): Boots and operates completely offline.
  - [sw.js](file:///C:/AuroMindPortal/sw.js): Precaches all game assets and shells for 100% offline play.
- **Active Tests:** All 251 test suite assertions run and pass in simulated offline environment.

#### 3. B18-A3 & B18-B1 Finding Alignment
- **F-04 (Storage Resilience):** Local operational authority requires the browser origin to be protected against ITP eviction via `navigator.storage.persist()`.
- **F-05 (AuroMatch Auto-Healing):** Local authority requires robust recovery when local storage is corrupted.

#### 4. Architectural Analysis
- **Benefits:** Instant load times; 100% offline capability; complete immunity to cloud outages; zero recurring server compute costs for local gameplay.
- **Trade-offs:** Requires sophisticated offline-to-online sync reconciliation when reconnecting.
- **Security Implications:** Local data must be protected against cross-site scripting via strict CSP (F-09).
- **Data-Integrity Implications:** Local data is never overwritten without explicit cryptographic validation and user protection.
- **Dependencies:** Foundational pillar underpinning ADR-01, ADR-02, ADR-05, ADR-06.

#### 5. Evaluation & Recommendation
- **Recommendation:** **APPROVE WITH CONDITIONS**
- **Approval Conditions:**
  1. Mandatory non-blocking persistent storage request via `navigator.storage.persist()` (F-04).
  2. Portal Settings UI must expose local storage health indicator to the player.
- **Implementation Milestone Phase:** Phase B18-B1 (Client SDK Resilience).

---

### 2.8 ADR-08: Purchase and Entitlement Architecture

#### 1. Original Proposal & Intent
Enforce a provider-independent commercialization architecture:
- **Phase 1 (Current Beta / Launch):** Commercial gates disabled (`COMMERCIAL_GATE_ENABLED: false`). All 520 AuroMatch levels, all 1,368 VAK puzzles, and all game modes are completely free and open.
- **Phase 2 (Production Commercialization):** Entitlements will be verified server-side via cryptographic signed tokens (JWT / Ed25519) issued upon payment verification. Client-side localStorage license flags and unverified postMessage tokens are strictly forbidden.

#### 2. Implementation Evidence in Current Codebase
- **Source Files:**
  - [backend-config.js](file:///C:/AuroMindPortal/assets/sdk/config/backend-config.js): Defines `COMMERCIAL_GATE_ENABLED: false` and entitlement contracts.
  - [auromind-sdk.js](file:///C:/AuroMindPortal/assets/sdk/auromind-sdk.js): Defines `sdk.entitlements` service interface.
- **Active Tests:** `server.test.js` B9 Firebase Test 8 and Supabase Conformance Test 6 verify entitlement query interfaces.

#### 3. Owner Clarification & Additional Architecture Gaps Addressed
The owner has explicitly clarified that **purchase capability must not be deferred simply because it may be disabled at launch**. The complete capability must be designed, implemented, and validated even if commercial gates remain disabled on January 1, 2027.

#### 4. Comprehensive Purchase Capability Design Review
- **Provider-Independent Abstraction:** Core SDK interacts with `sdk.purchases` via generic interfaces (`requestPurchase(sku)`, `restorePurchases()`, `getEntitlements()`), completely abstracting the payment gateway (Stripe, Razorpay, or App Store).
- **One-Time Non-Consumable Model:** Purchases represent permanent content unlocks (e.g., "Full Sanctuary Expansion Pack", "Constellation Master Tier").
- **Server-Side Transaction Verification:** Webhook endpoints verify digital signatures directly with the payment provider before committing entitlements to the database.
- **Signed Entitlement Tokens:** Cloud backend issues a tamper-proof JWT signed with Ed25519/RS256 containing `(guest_id, user_id, sku, granted_at, expires_at)`.
- **Offline Entitlement Verification & Grace Period:** The SDK caches signed tokens locally. The player retains offline entitlement access for up to **30 days** without cloud re-verification.
- **Device-Clock Manipulation Defense:** The SDK cross-checks device clock against monotonic monotonic timestamp anchors stored in save envelopes and Service Worker network headers. If the clock is artificially wound backward, the grace period is computed from monotonic elapsed time.
- **Signing Key Rotation:** Tokens specify `kid` (Key ID). The SDK downloads and caches public keys, supporting seamless background key rotation.
- **Refund & Revocation Handling:** On cloud sync, revoked or refunded SKUs update the local entitlement cache, disabling premium content non-destructively while preserving all user-created content (e.g., mandalas drawn using a premium palette are never deleted).
- **Reinstall & Purchase Restoration:** Reinstalling on a new device restores entitlements upon signing in to the linked cloud account.
- **Test / Production Separation:** Dual environment configuration (`sandbox` vs `production`) with strict key isolation preventing test transactions in production.
- **Launch Switch (`COMMERCIAL_GATE_ENABLED`):** A single master configuration flag allows the owner to keep the entire platform 100% free for the January 1, 2027 launch, while the verified engine remains ready in the codebase.

#### 5. Evaluation & Recommendation
- **Recommendation:** **APPROVE WITH CONDITIONS**
- **Approval Conditions:**
  1. Complete provider-independent client contract implementation in Phase B18-B1.
  2. Server verification and signed token issuance architecture designed in Phase B18-B.
  3. Commercial gate remains disabled (`COMMERCIAL_GATE_ENABLED: false`) for January 1, 2027 launch unless explicitly activated by owner.
- **Implementation Milestone Phase:** Phase B18-B1 (Client Contract) & Phase B18-B (Cloud Architecture).

---

### 2.9 ADR-09: Privacy, Telemetry and Sankalpa Exclusion

#### 1. Original Proposal & Intent
Maintain sacred privacy boundaries across the entire platform:
1. **Zero PII:** No names, emails, IP addresses, or device fingerprints in telemetry payloads.
2. **Explicit User Consent:** Collection requires affirmative consent (`LS_CONSENT_KEY`). Opting out immediately purges the local queue.
3. **Sacred Data Exclusion (Sankalpa Vault):** AuroMandala Sankalpa contemplation vault is declared `localOnlyVaults: ['sankalpa_e2ee_vault']` and **100% excluded from telemetry and cloud sync**.
4. **Bounded Ingestion:** Payloads bounded to 64 KiB, batches capped at 50 events, with rate limiting.

#### 2. Implementation Evidence in Current Codebase
- **Source Files:**
  - [auromind-sdk.js](file:///C:/AuroMindPortal/assets/sdk/auromind-sdk.js#L350-L450): Implements telemetry dispatch and queueing.
  - [backend-config.js](file:///C:/AuroMindPortal/assets/sdk/config/backend-config.js): Declares `localOnlyVaults: ['sankalpa_e2ee_vault']` and `cloudSyncEligible: false`.
- **Active Tests:** `server.test.js` tests B10 Suites 1–6 and B8 Security tests 10–18 verify zero PII, consent purge, rate limiting, and Sankalpa exclusion.

#### 3. B18-A3 & B18-B1 Finding Alignment
- **F-08 (Telemetry Queue & Privacy):** Legacy in-memory queue dropped events arbitrarily on overflow, lacked reload durability, and lacked an automated deep sanitization filter.

#### 4. Architectural Analysis
- **Benefits:** Preserves the contemplative, sacred atmosphere of AuroMasti; strictly respects privacy laws (GDPR, COPPA); protects inner spiritual reflections.
- **Trade-offs:** Limited diagnostic visibility due to strict zero-PII and payload size constraints.
- **Security Implications:** Guaranteed local-only E2EE encryption of Sankalpa data prevents cloud compromise from exposing user reflections.
- **Data-Integrity Implications:** Telemetry collection runs entirely off the main thread or during idle periods (`requestIdleCallback`), ensuring zero performance impact on gameplay.
- **Dependencies:** Interacts with ADR-01, ADR-03, ADR-07.

#### 5. Evaluation & Recommendation
- **Recommendation:** **APPROVE WITH CONDITIONS**
- **Approval Conditions:**
  1. Implement 3-Tier Priority Queue (CRITICAL, ENGAGEMENT, DIAGNOSTIC) capped at 500 events, with CRITICAL events never evicted and persisted across reloads in IndexedDB (F-08).
  2. Implement mandatory hardcoded pre-queue privacy sanitizer stripping `sankalpa`, user intentions, private journal text, and raw speech audio recordings.
- **Implementation Milestone Phase:** Phase B18-B1 (Client Telemetry Hardening).

---

### 2.10 ADR-10: Provider-Independent Backend Adapter

#### 1. Original Proposal & Intent
The AuroMind SDK architecture enforces a strict Provider Adapter Pattern (`assets/sdk/config/backend-config.js`). Games and shared services interact exclusively with the high-level SDK interface (`sdk.sync`, `sdk.auth`, `sdk.telemetry`, `sdk.entitlements`). The SDK delegates to configured provider adapters (`supabase`, `firebase`, or `null`). Games never import or reference concrete cloud SDKs directly.

#### 2. Implementation Evidence in Current Codebase
- **Source Files:**
  - [backend-config.js](file:///C:/AuroMindPortal/assets/sdk/config/backend-config.js): Defines provider adapter factory and configuration.
  - [auromind-sdk.js](file:///C:/AuroMindPortal/assets/sdk/auromind-sdk.js): Connects SDK services to configured adapter.
- **Active Tests:** `server.test.js` verifies conformance across both Supabase and Firebase provider adapters and validates the cross-provider migration harness.

#### 3. B18-A3 & B18-B1 Finding Alignment
- **F-03 (Missing Adapters):** Standalone game bridges must cleanly interface through this provider-independent SDK.
- **F-09 (Production CSP):** CSP directives must authorize provider connection endpoints (`https://*.supabase.co`) without coupling game code.

#### 4. Architectural Analysis
- **Benefits:** Completely prevents vendor lock-in; enables flawless 100% offline local testing via `null` or mock adapter; allows the backend provider to be swapped without modifying a single line of game code.
- **Trade-offs:** Requires maintaining abstraction interfaces and error normalization mapping.
- **Security Implications:** Frontend code is hardcoded to throw security violations if service role or private keys are ever introduced into client configurations.
- **Data-Integrity Implications:** Clean separation guarantees that network or provider errors are normalized into standard platform error codes handled gracefully by the local outbox.
- **Dependencies:** Interacts with ADR-03, ADR-04, ADR-05, ADR-08, ADR-09.

#### 5. Evaluation & Recommendation
- **Recommendation:** **APPROVE WITH CONDITIONS**
- **Approval Conditions:**
  1. Supabase remains the preferred cloud candidate, but provisioning and activation remain strictly blocked until Phase B18-C approval.
  2. Frontend configuration must maintain zero credentials or secret keys; public anonymous keys only.
- **Implementation Milestone Phase:** Phase B18-B1 (Contract Hardening) & Phase B18-B (Cloud Integration Design).

---

## 3. Summary of Review Recommendations

| ADR # | Canonical Decision Title | Recommendation | Primary Conditions / Remediation Binding |
|:---:|:---|:---:|:---|
| **ADR-01** | Canonical Player Identity Model | **APPROVE WITH CONDITIONS** | Add `navigator.storage.persist()` (F-04); preserve single profile rule. |
| **ADR-02** | Versioned Opaque Save Payloads | **APPROVE WITH CONDITIONS** | Canonical JSON & SHA-256 (F-02); standalone bridges (F-03). |
| **ADR-03** | Singleton Shared SDK | **APPROVE WITH CONDITIONS** | Standalone game mock fallback; formal `sdk.achievements` API (F-06). |
| **ADR-04** | Non-Destructive Guest Identity Migration | **APPROVE WITH CONDITIONS** | Client migration atomicity; zero data loss rollback guarantee. |
| **ADR-05** | Local-Authoritative Sync Outbox | **APPROVE WITH CONDITIONS** | Durable IndexedDB outbox queue; 100% offline gameplay autonomy. |
| **ADR-06** | Game-Specific Conflict Resolution | **APPROVE WITH CONDITIONS** | AuroMandala versioned artwork with forking (F-01); tailored merges (F-07). |
| **ADR-07** | Local Operational Authority | **APPROVE WITH CONDITIONS** | Storage resilience registration (F-04); portal health indicator. |
| **ADR-08** | Purchase and Entitlement Architecture | **APPROVE WITH CONDITIONS** | Offline verification & clock skew defense; commercial gate toggleable. |
| **ADR-09** | Privacy, Telemetry and Sankalpa Exclusion | **APPROVE WITH CONDITIONS** | 3-tier queue (F-08); automated privacy filter; Sankalpa E2EE quarantine. |
| **ADR-10** | Provider-Independent Backend Adapter | **APPROVE WITH CONDITIONS** | Zero frontend secrets; separate Phase B18-C activation approval. |
