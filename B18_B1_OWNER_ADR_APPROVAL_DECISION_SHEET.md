# AuroMasti B18-B1 — Owner ADR Approval Decision Sheet
## Formal Decision Package for Original Architecture Decision Records (ADR-01 through ADR-10)

- **Document Version:** 1.0.0
- **Batch Reference:** B18-B1 Final ADR Clarification & Approval Preparation
- **Canonical Workspace:** `C:\AuroMindPortal`
- **Target Release:** January 1, 2027
- **Governance Mandate:** The Product Owner holds sole approval authority. All recommendations herein are submitted for owner evaluation.

---

## 1. Summary Decision Sheet (ADR-01 through ADR-10)

| ADR # | Canonical Title | Architect Recommendation | Implementation Phase | Key Owner Choice Required |
|:---:|:---|:---:|:---:|:---|
| **ADR-01** | **Canonical Player Identity Model** | Approve with conditions | **B18-B1** | Confirm whether an "Identity Reset" button is exposed in Portal Settings or solely via browser site data clearing. |
| **ADR-02** | **Versioned Opaque Save Payloads** | Approve with conditions | **B18-B1** | Confirm 90-day retention policy for un-enveloped legacy backup saves. |
| **ADR-03** | **Singleton Shared SDK** | Approve with conditions | **B18-B1** | Confirm event notification mechanism (`auromind:ready` DOM event vs promise). |
| **ADR-04** | **Non-Destructive Guest Identity Migration** | Approve with conditions | **B18-B** | Confirm account-link conflict UX (interactive comparison modal vs automatic non-destructive merge). |
| **ADR-05** | **Local-Authoritative Sync Outbox** | Approve with conditions | **B18-B1** / **B18-B** | Confirm outbox retry backoff interval (max 15 minutes before low-frequency polling). |
| **ADR-06** | **Game-Specific Conflict Resolution** | Approve with conditions | **B18-B1** | **Confirm display label for forked artworks: `(Cloud Copy)` vs `(Conflicting Copy)`.** |
| **ADR-07** | **Local Operational Authority** | Approve with conditions | **B18-B1** | **Confirm storage failure UX: Amber non-blocking banner + one-click JSON backup export.** |
| **ADR-08** | **Purchase and Entitlement Architecture** | Approve with conditions | **B18-B1** / **B18-B** | **Confirm offline grace period (recommended: 30 days) and keep launch gate disabled.** |
| **ADR-09** | **Privacy, Telemetry & Sankalpa Exclusion** | Approve with conditions | **B18-B1** | **Confirm telemetry retention window (recommended: 30 days) and EU opt-in default.** |
| **ADR-10** | **Provider-Independent Backend Adapter** | Approve with conditions | **B18-B1** / **B18-B** | Confirm provider mock flag (`?mock=true`) for post-provisioning staging tests. |

---

## 2. Detailed Decision Parameters by ADR

### ADR-01: Canonical Player Identity Model
- **Canonical Scope:** Unified RFC-4122 UUIDv4 guest identity per browser profile, dual-persisted across IndexedDB and localStorage, coordinated across tabs via Web Locks (`auromind_identity_lock`).
- **Proposed Decision:** **APPROVE WITH CONDITIONS**
- **Approval Conditions:**
  1. Integrate non-blocking `navigator.storage.persist()` registration during initialization.
  2. Enforce strict single-identity rule: One browser profile = one persistent player identity. No in-app player switching or profile selectors.
- **Outstanding Owner Choice:** Does the owner want a visible "Reset Identity / New Journey" button in Portal Settings, or should identity reset rely strictly on standard browser site data clearing?
- **Implementation Phase:** Phase B18-B1.
- **Acceptance Criteria:** E2E multi-tab convergence tests pass; dual-store auto-healing verified under simulated storage corruption.

### ADR-02: Versioned Opaque Save Payloads
- **Canonical Scope:** Standardized save envelope (`envelopeVersion: 1`, `gameId`, `gameSchemaVersion`, `checksum`, `payload`) treating game internal schemas as opaque.
- **Proposed Decision:** **APPROVE WITH CONDITIONS**
- **Approval Conditions:**
  1. Mandate canonical JSON key sorting and Web Crypto SHA-256 hashing excluding transport fields (`clientUpdatedAt`, `baseRevision`, `guestId`).
  2. Valid brand-new player saves (`completedLevels: []`, `isEmpty: true`) must be validated as legitimate non-corrupt state.
- **Outstanding Owner Choice:** Should un-migrated legacy save keys be purged after 90 days or retained indefinitely?
- **Implementation Phase:** Phase B18-B1.
- **Acceptance Criteria:** Deep mutations alter checksum; key re-ordering produces identical hash; valid empty saves initialize cleanly.

### ADR-03: Singleton Shared SDK
- **Canonical Scope:** Framework-agnostic ES module singleton (`AuroMindSDK`) exposing frozen sub-services (`sdk.identity`, `sdk.storage`, `sdk.sync`, `sdk.achievements`, `sdk.telemetry`).
- **Proposed Decision:** **APPROVE WITH CONDITIONS**
- **Approval Conditions:**
  1. Standalone Game Fallback: Every game bridge MUST include an internal mock fallback to ensure games load and play 100% offline outside the portal iframe.
  2. Formalize `sdk.achievements` service namespace.
- **Outstanding Owner Choice:** Confirm whether SDK ready state should emit a custom window DOM event `auromind:ready` or rely on `window.AuroMindSDK.whenReady()`.
- **Implementation Phase:** Phase B18-B1.
- **Acceptance Criteria:** Standalone launch of all 6 games succeeds offline with zero unhandled exceptions.

### ADR-04: Non-Destructive Guest Identity Migration
- **Canonical Scope:** Relational `guest_identity_links` join table in PostgreSQL linking `guest_<uuidv4>` to authenticated `auth.users.id` without overwriting local progress.
- **Proposed Decision:** **APPROVE WITH CONDITIONS**
- **Approval Conditions:**
  1. Client migration atomicity: Network failure during account linking must leave local guest progress 100% intact.
  2. Invoke ADR-06 domain merges if the linked cloud account already contains existing saves from another device.
- **Outstanding Owner Choice:** When an account already has existing saves, should the user review an itemized comparison modal or execute automatic non-destructive domain merge?
- **Implementation Phase:** Phase B18-B (Supabase Schema & Security Design).
- **Acceptance Criteria:** Linking guest with 50 completed levels to new account preserves all 50 levels locally and in cloud.

### ADR-05: Local-Authoritative Sync Outbox
- **Canonical Scope:** Offline-outbox with optimistic revision concurrency (`expectedRevision = baseRevision`) and HTTP 409 conflict detection.
- **Proposed Decision:** **APPROVE WITH CONDITIONS**
- **Approval Conditions:**
  1. Outbox queue must be persisted in IndexedDB across browser tab restarts.
  2. Offline gameplay must never be blocked or degraded by outbox queue state.
- **Outstanding Owner Choice:** Confirm maximum retry backoff interval before outbox switches to low-frequency background polling (recommended: 15 minutes).
- **Implementation Phase:** Phase B18-B1 (Client Durability) & Phase B18-B (Cloud RPC Design).
- **Acceptance Criteria:** 10 offline saves queue reliably and synchronize in chronological order upon reconnection.

### ADR-06: Game-Specific Conflict Resolution
- **Canonical Scope:** Invariants 1–4 with delegation to registered game merge strategies. For AuroMandala: **Versioned artwork with conflict recovery**.
- **Proposed Decision:** **APPROVE WITH CONDITIONS**
- **Approval Conditions:**
  1. Restructure AuroMandala artwork storage to UUIDv4 keys, soft deletions (tombstones), and conflict forking.
  2. Zero silent artwork overwrites under any sync condition.
- **Outstanding Owner Choice:** Confirm display label for conflicting cloud artworks: `(Cloud Copy)` vs `(Alternate Copy)`.
- **Implementation Phase:** Phase B18-B1.
- **Acceptance Criteria:** Concurrent edits on two devices produce an independent forked copy; no strokes are ever overwritten.

### ADR-07: Local Operational Authority
- **Canonical Scope:** Client device is the primary operational authority; cloud is a durable synchronization replica.
- **Proposed Decision:** **APPROVE WITH CONDITIONS**
- **Approval Conditions:**
  1. Call `navigator.storage.persist()` on portal launch as an eviction defense (clarifying it is not a physical guarantee).
  2. Storage failure must never block gameplay; provide amber banner with manual JSON export.
- **Outstanding Owner Choice:** Confirm storage failure UI presentation (amber top banner vs dismissible modal).
- **Implementation Phase:** Phase B18-B1.
- **Acceptance Criteria:** Entire platform boots and all 6 games play with zero internet connectivity.

### ADR-08: Purchase and Entitlement Architecture
- **Canonical Scope:** Provider-independent commerce architecture with server-verified signed Ed25519 tokens.
- **Proposed Decision:** **APPROVE WITH CONDITIONS**
- **Approval Conditions:**
  1. Commercial gate remains disabled (`COMMERCIAL_GATE_ENABLED: false`) for January 1, 2027 launch.
  2. Implement provider-independent client contract and `MockPurchaseProvider` in B18-B1.
  3. Realistic security boundaries: Best-effort clock manipulation defense locally; true enforcement server-side.
- **Outstanding Owner Choice:** Confirm recommended 30-day offline grace period for purchased entitlements.
- **Implementation Phase:** Phase B18-B1 (Client Contract) & Phase B18-B (Cloud Architecture).
- **Acceptance Criteria:** Full transaction, verification, offline grace period, and revocation flows validated in test harness.

### ADR-09: Privacy, Telemetry and Sankalpa Exclusion
- **Canonical Scope:** Zero PII, explicit user consent, 3-tier queue (500 events), and absolute Sankalpa Vault local-only E2EE exclusion.
- **Proposed Decision:** **APPROVE WITH CONDITIONS**
- **Approval Conditions:**
  1. CRITICAL events are never silently dropped; logged to observable overflow counter if tier is saturated.
  2. Pre-queue privacy sanitizer strips `sankalpa`, intentions, reflections, and raw audio.
- **Outstanding Owner Choice:** Confirm cloud telemetry retention period (recommended: 30 days rolling purge).
- **Implementation Phase:** Phase B18-B1.
- **Acceptance Criteria:** Queue overflow drops Tier 3 diagnostic events first; sensitive keys are 100% purged.

### ADR-10: Provider-Independent Backend Adapter
- **Canonical Scope:** Decoupled Provider Adapter Pattern (Supabase/Firebase/Null).
- **Proposed Decision:** **APPROVE WITH CONDITIONS**
- **Approval Conditions:**
  1. Supabase remains preferred cloud candidate, but live provisioning is strictly blocked until Phase B18-C approval.
  2. Zero frontend service-role or private keys.
- **Outstanding Owner Choice:** Confirm whether an admin query parameter `?mock=true` should be enabled in development builds to simulate backend outages.
- **Implementation Phase:** Phase B18-B1 (Contract Hardening) & Phase B18-B (Cloud Integration Design).
- **Acceptance Criteria:** Swapping provider config from `supabase` to `mock` requires zero game code changes.

---

## 3. Formal Owner Signoff Block

```
=================================================================================
                    AUROMASTI B18-B1 ARCHITECTURAL SIGNOFF
=================================================================================

The Product Owner has reviewed the ten Architecture Decision Records (ADR-01 
through ADR-10), the evidence base, and the technical clarifications.

[ ] APPROVED: Proceed to Phase B18-B1 Shared Services SDK Remediation & Adapter
    Implementation.
[ ] APPROVED WITH CONDITIONS: Proceed subject to attached owner stipulations.
[ ] REJECTED: Return to architecture review with owner feedback.

Product Owner Signature: ________________________________________________________

Date: ________________________
=================================================================================
```
