# AuroMasti B18-B1 — Final ADR Governance Register
## Complete Status of Canonical ADR-01 through ADR-10, Implementation Task Mapping, and Owner Choice Gates

- **Document Version:** 1.0.0
- **Batch Reference:** B18-B1 Implementation Plan Reconciliation & Final Acceptance
- **Canonical Workspace:** `C:\AuroMindPortal`
- **Target Release:** January 1, 2027
- **Governance Mandate:** The Product Owner holds sole approval authority. All 10 original ADRs remain **PENDING OWNER APPROVAL**.

---

## 1. Master ADR Governance Register (ADR-01 through ADR-10)

| ADR ID | Canonical Title | Governance Status | Architect Recommendation | Technical Conditions Bound to Approval | Affected Implementation Tasks | Execution Blocked on Specific Choice? |
|:---:|:---|:---:|:---:|:---|:---|:---:|
| **ADR-01** | **Canonical Player Identity Model** | `PENDING OWNER APPROVAL` | **Approve with conditions** | 1. Non-blocking `navigator.storage.persist()` registration.<br>2. Strict single identity rule: One browser profile = one persistent player identity. | `TASK-ID-01`<br>`TASK-ID-02`<br>`TASK-ID-03`<br>`TASK-SAVE-02` | **YES: Choice 1** (`TASK-ID-03` requires Storage Failure UI choice) |
| **ADR-02** | **Versioned Opaque Save Payloads** | `PENDING OWNER APPROVAL` | **Approve with conditions** | 1. Canonical JSON sorting & Web Crypto SHA-256 excluding transport metadata.<br>2. Valid brand-new player saves (`completedLevels: []`) accepted cleanly.<br>3. Standalone envelope bridges for all 6 games. | `TASK-SAVE-01`<br>`TASK-SAVE-03`<br>`TASK-ADP-01..05`<br>`TASK-ART-01`<br>`TASK-ACH-01` | No (Standard cryptographic format) |
| **ADR-03** | **Singleton Shared SDK** | `PENDING OWNER APPROVAL` | **Approve with conditions** | 1. Sub-services frozen with `Object.freeze`.<br>2. Standalone game mock fallback embedded into all bridges.<br>3. Formal `sdk.achievements` API. | `TASK-SDK-01`<br>`TASK-SDK-02`<br>`TASK-ADP-03..05`<br>`TASK-ACH-01`<br>`TASK-TEL-01` | No (Standard SDK singleton structure) |
| **ADR-04** | **Non-Destructive Guest Identity Migration** | `PENDING OWNER APPROVAL` | **Approve with conditions** | 1. Client migration atomicity (network drop leaves local saves 100% intact).<br>2. ADR-06 domain merge invoked if linked account owns existing cloud saves. | `TASK-SYNC-01` | No (Scheduled for Phase B18-B Cloud Integration) |
| **ADR-05** | **Offline Synchronization Strategy** | `PENDING OWNER APPROVAL` | **Approve with conditions** | 1. Durable IndexedDB outbox queue surviving tab reloads.<br>2. Offline gameplay never blocked by outbox state. | `TASK-SAVE-01`<br>`TASK-SYNC-02` | No (Standard durable outbox pattern) |
| **ADR-06** | **Conflict Resolution Policy** | `PENDING OWNER APPROVAL` | **Approve with conditions** | 1. AuroMandala: Versioned artwork with UUIDv4, soft deletes, and conflict forking.<br>2. Tailored non-destructive domain merges for all 6 games.<br>3. Zero silent overwrite under any condition. | `TASK-SYNC-01`<br>`TASK-ART-01`<br>`TASK-ART-02` | **YES: Choice 2** (`TASK-ART-02` requires Conflict Label choice) |
| **ADR-07** | **Local Operational Authority** | `PENDING OWNER APPROVAL` | **Approve with conditions** | 1. Device is primary operational authority; 100% offline gameplay.<br>2. Storage failure activates ephemeral RAM mode with amber banner.<br>3. Storage persistence requested as eviction defense (not physical guarantee). | `TASK-ID-02`<br>`TASK-ID-03`<br>`TASK-SAVE-02`<br>`TASK-CSP-01` | **YES: Choice 1** (`TASK-ID-03` requires Storage Failure UI choice) |
| **ADR-08** | **Purchase and Entitlement Architecture** | `PENDING OWNER APPROVAL` | **Approve with conditions** | 1. Provider-independent `sdk.purchases` interface & `MockPurchaseProvider`.<br>2. Server-verified Ed25519 tokens.<br>3. `COMMERCIAL_GATE_ENABLED: false` launch invariant. | `TASK-COMM-01`<br>`TASK-COMM-02` | **YES: Choice 3** (`TASK-COMM-02` requires Offline Grace Period choice) |
| **ADR-09** | **Privacy, Telemetry & Sankalpa Exclusion** | `PENDING OWNER APPROVAL` | **Approve with conditions** | 1. 3-tier queue (CRITICAL: 100 in IDB, ENGAGEMENT: 300, DIAGNOSTIC: 100).<br>2. Observable critical overflow counter.<br>3. Pre-queue privacy sanitizer; Sankalpa Vault local-only E2EE. | `TASK-TEL-01`<br>`TASK-TEL-02` | **YES: Choice 4** (`TASK-TEL-01` requires Retention Window choice) |
| **ADR-10** | **Provider-Independent Backend Adapter** | `PENDING OWNER APPROVAL` | **Approve with conditions** | 1. Provider Adapter Pattern (Supabase/Firebase/Null).<br>2. Zero frontend private/service-role credentials.<br>3. Live cloud provisioning strictly deferred to Phase B18-C. | `TASK-SDK-02`<br>`TASK-COMM-01`<br>`TASK-CSP-01` | No (Decoupled provider abstraction) |

---

## 2. Outstanding Product Owner Decisions Breakdown

The four specific policy choices identified in the B18-B1 review are isolated below. They affect specific task configurations but do not invalidate or replace the foundational ADR register:

### Choice 1: Storage Failure UI Presentation (Affects `TASK-ID-03`)
- **Governing ADRs:** ADR-01, ADR-07
- **Technical Context:** When both IndexedDB and localStorage fail (e.g. disk quota exhaustion or private browsing lockdown), the platform activates RAM-backed ephemeral storage so gameplay is never blocked.
- **Architect Recommendation:** **Option A (Non-blocking amber banner at the top of the portal with one-click JSON backup export).**
- **Alternative:** Option B (Blocking modal dialog requiring user acknowledgement before entering games).

### Choice 2: Conflict Copy Presentation Label (Affects `TASK-ART-02`)
- **Governing ADRs:** ADR-06, ADR-02
- **Technical Context:** In AuroMandala, concurrent stroke edits on different devices fork the incoming cloud artwork into an independent artwork entity.
- **Architect Recommendation:** **Option A (Display label `[Title] (Cloud Copy)`).**
- **Alternatives:** Option B (`[Title] (Synced YYYY-MM-DD)`), Option C (`[Title] (Alternate)`).

### Choice 3: Offline Entitlement Grace Period Duration (Affects `TASK-COMM-02`)
- **Governing ADRs:** ADR-08
- **Technical Context:** Cached Ed25519 signed entitlement tokens permit offline access to premium expansions. (Note: Master gate remains disabled for Jan 1 launch regardless of option).
- **Architect Recommendation:** **Option A (30-Day Offline Grace Period with monotonic clock checks).**
- **Alternatives:** Option B (14 days), Option C (60 days).

### Choice 4: Cloud Telemetry Retention Period (Affects `TASK-TEL-01`)
- **Governing ADRs:** ADR-09
- **Technical Context:** Anonymous non-PII telemetry events stored in cloud database.
- **Architect Recommendation:** **Option A (30-Day Rolling Purge).**
- **Alternatives:** Option B (90-day rolling purge), Option C (Immediate aggregate roll-up).
