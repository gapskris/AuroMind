# AuroMasti B18-B1 — Complete Remediation Scope & Governance Reconciliation
## Reconciliation of ADR Register, Corrected Roadmap Phases, and Zero-Deferred Issue Register

- **Document Version:** 1.0.0
- **Batch Reference:** B18-B1 Formal Architecture Decision Review
- **Canonical Workspace:** `C:\AuroMindPortal`
- **Target Release:** January 1, 2027
- **Governance Mandate:** All 10 original ADRs remain **PENDING OWNER APPROVAL**. This document clarifies historical governance drift, re-anchors the original ADR register, aligns roadmap phase boundaries, and provides the complete Zero-Deferred Issue Register.

---

## 1. Reconciliation of ADR Register Governance

### 1.1 Root Cause of Governance Drift in Prior Report
In the initial B18-B1 risk and dependency register, several ADR titles were restated using operational remediation labels (e.g., labeling ADR-05 as "Cryptographic Checksum Engine" and ADR-07 as "Storage Resilience"). 

**Official Governance Correction:**
1. The **canonical original Architecture Decision Register (ADR-01 through ADR-10)** established in B18-A/A2 is fully preserved with its original titles, scopes, and numbers.
2. The operational remediations (such as SHA-256 canonical hashing and `navigator.storage.persist()`) are explicitly mapped as **technical implementation conditions** under the owning original ADRs (specifically ADR-02 and ADR-07), rather than replacing the original decisions.
3. Historical traceability is 100% maintained across B18-A, B18-A2, B18-A3, and B18-B1.

### 1.2 Canonical ADR Title & Scope Alignment

| ADR ID | Canonical Original ADR Title | Owning Scope & Invariant |
|:---:|:---|:---|
| **ADR-01** | **Canonical Player Identity Model** | Single persistent anonymous guest identity per browser profile (`guest_<uuidv4>`); Web Locks multi-tab sync. |
| **ADR-02** | **Game-Specific Progression Schema (Save Envelopes)** | Standardized envelope framing with opaque game payloads; canonical JSON + SHA-256 integrity. |
| **ADR-03** | **Shared Service Contracts (Singleton Shared SDK)** | Frozen ES module singleton (`AuroMindSDK`); namespaced services; graceful standalone offline degradation. |
| **ADR-04** | **Guest-to-Account Migration** | Relational `guest_identity_links` mapping; atomic migration with zero local progress loss. |
| **ADR-05** | **Offline Synchronization Strategy (Sync Outbox)** | Local-authoritative outbox queue; optimistic revision concurrency (`expectedRevision = baseRevision`). |
| **ADR-06** | **Conflict Resolution Policy** | Invariants 1–4; game-specific merge algorithms; AuroMandala versioned artwork with conflict forking. |
| **ADR-07** | **Cloud vs. Local Data Ownership (Local Authority)** | Client device is primary operational authority; 100% offline gameplay; persistent storage registration. |
| **ADR-08** | **Purchase and Entitlement Architecture** | Provider-independent architecture; signed cryptographic tokens; offline verification; toggleable gate. |
| **ADR-09** | **Analytics & Privacy Boundaries** | Zero PII; explicit opt-in consent; 3-tier priority queue; absolute Sankalpa Vault local-only E2EE exclusion. |
| **ADR-10** | **Backend-Independent SDK Design** | Provider Adapter Pattern decoupling games from cloud backends (Supabase/Firebase/Null). |

---

## 2. Corrected Roadmap Phase Definitions

The platform execution roadmap follows strict, unblurred boundaries:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ PHASE B18-B1: SHARED SERVICES SDK REMEDIATION & CONTRACT IMPLEMENTATION        │
│ Scope:                                                                          │
│ - Comprehensive architecture review & design blueprints (Current Step).         │
│ - Client-side shared SDK remediation (hashing, outbox, storage hardening).      │
│ - Game adapter bridges (VAK, Word Riddle, Sanctuary, AuroMandala UUIDs).        │
│ - Save integrity, achievements API, 3-tier telemetry queue, and CSP sync.      │
│ - Execution of complete automated offline regression test suites (251+ tests).   │
│ Environment: 100% Local / Zero Cloud Dependencies / Zero Migrations.             │
└─────────────────────────────────────┬───────────────────────────────────────────┘
                                      │
                                      ▼ (Requires Owner Signoff)
┌─────────────────────────────────────────────────────────────────────────────────┐
│ PHASE B18-B: SUPABASE SCHEMA, SECURITY & INTEGRATION DESIGN                     │
│ Scope:                                                                          │
│ - PostgreSQL database relational schema design (`001_initial_schema.sql`).      │
│ - Row-Level Security (RLS) policies and role-based access rules.               │
│ - Supabase Auth integration design and guest-to-account linking RPCs.           │
│ - Cloud synchronization Edge Functions and webhook verification design.         │
│ - Purchase verification and signed entitlement token architecture.              │
│ Environment: Specification & Local Schema Simulation / No Live Cloud Activation.│
└─────────────────────────────────────┬───────────────────────────────────────────┘
                                      │
                                      ▼ (Requires Owner Signoff)
┌─────────────────────────────────────────────────────────────────────────────────┐
│ PHASE B18-C: CONTROLLED PROVISIONING, MIGRATION & ACTIVATION                    │
│ Scope:                                                                          │
│ - Explicitly approved live Supabase project provisioning.                       │
│ - Application of database migrations to production database.                    │
│ - Deployment of production Edge Functions and webhook endpoints.                │
│ - Controlled cloud backup and sync activation.                                  │
│ Environment: Live Cloud Infrastructure.                                         │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Zero-Deferred Issue Register

In strict compliance with the owner's directive:
- **No issue may be deferred merely because it is P1, P2, or P3.**
- **All identified issues must have a clear, documented resolution path.**
- Only valid statuses are assigned: `Designed`, `Awaiting owner decision`, `Ready for implementation`, `Implemented`, `Validated`, or `Blocked by a named external dependency`.

| Issue ID | Priority | Description | Owning ADR | Status | Resolution Summary | Implementation Phase |
|:---|:---:|:---|:---:|:---:|:---|:---:|
| **F-01** | **P1** | AuroMandala Artwork Overwrite Risk | ADR-06, ADR-02 | **Designed** | Versioned artwork entity with UUIDv4, soft deletes, and conflict forking into `(Cloud Copy)`. | **B18-B1** |
| **F-02** | **P1** | Weak / Inconsistent Checksums | ADR-02, ADR-05 | **Designed** | Standardized canonical JSON normalization and Web Crypto SHA-256 excluding transport metadata. | **B18-B1** |
| **F-03** | **P1** | Missing Standalone Adapters (3 games) | ADR-02, ADR-03, ADR-10 | **Designed** | Dedicated standalone ES module bridges for VAK, Word Riddle, and Sanctuary with mock fallbacks. | **B18-B1** |
| **F-04** | **P2** | Storage Eviction Vulnerability (ITP/LRU) | ADR-01, ADR-07 | **Designed** | Non-blocking `navigator.storage.persist()` registration and 80% quota telemetry warning. | **B18-B1** |
| **F-05** | **P2** | AuroMatch Auto-Healing Logic Flaw | ADR-01, ADR-07 | **Designed** | Deep payload validation (`completedLevels.length > 0`) and bidirectional IDB/LS sync. | **B18-B1** |
| **F-06** | **P2** | Missing Achievements Service Contract | ADR-03, ADR-02 | **Designed** | Formal `sdk.achievements` API with monotonic progress and idempotent unlocks. | **B18-B1** |
| **F-07** | **P2** | Domain Merge Policy Discrepancies | ADR-06, ADR-04 | **Designed** | Tailored non-destructive merge policies for all 6 games implemented in `auromind-adapters.js`. | **B18-B1** |
| **F-08** | **P3** | Telemetry Queue Overflow & Privacy Risk | ADR-09, ADR-03 | **Designed** | 3-tier queue (CRITICAL, ENGAGEMENT, DIAGNOSTIC) capped at 500; automated privacy filter. | **B18-B1** |
| **F-09** | **P3** | Production CSP & Hosting Discrepancies | ADR-07, ADR-10 | **Designed** | Identical CSP, `X-Frame-Options`, and `Permissions-Policy` across server, Vercel, CF, Netlify. | **B18-B1** |
| **GAP-01** | **P1** | Single Identity Rule Enforcement | ADR-01 | **Designed** | Single anonymous UUIDv4 per profile; zero in-app profile selectors or switching dialogs. | **B18-B1** |
| **GAP-02** | **P2** | Standalone Game Offline Degradation | ADR-03 | **Designed** | In-bridge local mock fallbacks (`window.AuroMindSDK || LocalMockBridge`) in all 6 games. | **B18-B1** |
| **GAP-03** | **P1** | Sankalpa Vault Local-Only Isolation | ADR-09 | **Designed & Validated** | Explicitly marked `cloudSyncEligible: false`; AES-GCM local-only encryption; telemetry purged. | **B18-B1** |
| **GAP-04** | **P2** | Offline Entitlement Verification & Clock Skew | ADR-08 | **Designed** | Locally cached Ed25519 tokens with 30-day grace period and monotonic anchor validation. | **B18-B1** / **B18-B** |
| **GAP-05** | **P2** | Refund & Revocation Non-Destructive Handling | ADR-08 | **Designed** | Feature access revoked gracefully while 100% of player-created artworks are preserved. | **B18-B** |
| **GAP-06** | **P1** | Sacred Data Asset Byte-Exact Immutability | ADR-02, ADR-07 | **Validated** | VAK Speech Corpus (SHA-256 `9fdb38...`) and Flora DB (2,002,176 bytes) 100% verified. | **B18-B1** |
| **GAP-07** | **P2** | Release Lifecycle & Rollback Procedures | Platform | **Designed** | Feature-flag boundaries in `backend-config.js` and git-isolated local file rollbacks. | **B18-B1** |

---

## 4. Purchase Capability Scope & Launch Control

The owner has clarified that commercial purchasing capabilities must be fully designed, implemented, and validated, even if commercial gates remain disabled on January 1, 2027.

### 4.1 Architecture Components Defined
1. **Provider-Agnostic Interface (`sdk.purchases`):** Exposes `requestPurchase(sku)`, `restorePurchases()`, `getEntitlements()`. Decoupled from Stripe, Razorpay, or App Store SDKs.
2. **Server-Side Transaction Verification:** Webhook endpoints verify signatures directly with payment gateways; client-side receipts are never trusted.
3. **Cryptographically Signed Entitlement Tokens:** JWT tokens signed with Ed25519/RS256 containing `(guest_id, sku, granted_at, expires_at)`.
4. **Offline Resilience & Grace Period:** Cached tokens grant full access offline for up to 30 days. Monotonic timestamp anchors detect device clock tampering.
5. **Master Launch Switch:** A single master configuration flag (`COMMERCIAL_GATE_ENABLED: false` in `backend-config.js`) ensures that for the January 1, 2027 launch, the entire platform remains 100% free and open, while the validated purchase engine remains dormant in the codebase.
