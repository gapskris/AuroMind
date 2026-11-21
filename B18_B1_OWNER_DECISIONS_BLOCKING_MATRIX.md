# AuroMasti B18-B1 — Owner Decisions & Blocking Matrix
## Governance Alignment: Task-to-ADR Dependencies, Outstanding Owner Choices, and Authorization Gates

- **Document Version:** 1.0.0
- **Batch Reference:** B18-B1 Master Implementation Execution Plan
- **Canonical Workspace:** `C:\AuroMindPortal`
- **Target Release:** January 1, 2027
- **Governance Mandate:** The Product Owner holds sole approval authority. All 10 original ADRs remain **PENDING OWNER APPROVAL**. This matrix isolates which tasks require specific owner decisions and which tasks can proceed immediately upon general ADR approval.

---

## 1. Task-to-ADR Governance Dependency Matrix

The following table explicitly links every implementation task to its governing ADR and indicates whether execution is blocked pending a specific owner decision:

| Task ID | Task Implementation Title | Governing ADR | ADR Status | Specific Owner Decision Needed? | Implementation Readiness |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **TASK-ID-01** | Identity Multi-Tab Web Locks | **ADR-01** | Pending Approval | No (Canonical UUIDv4 model) | **Ready upon ADR-01 Approval** |
| **TASK-ID-02** | Storage Persistence & Quota | **ADR-01**, **ADR-07** | Pending Approval | No (Standard browser API) | **Ready upon ADR-01/07 Approval** |
| **TASK-ID-03** | Ephemeral Mode & Backup UI | **ADR-01**, **ADR-07** | Pending Approval | **YES: Choice 1 (Storage Failure UI)** | Blocked on Choice 1 |
| **TASK-SAVE-01** | Canonical JSON & SHA-256 Engine | **ADR-02**, **ADR-05** | Pending Approval | No (Cryptographic standard) | **Ready upon ADR-02/05 Approval** |
| **TASK-SAVE-02** | AuroMatch Auto-Healing Fix | **ADR-01**, **ADR-07** | Pending Approval | No (Bug fix for empty saves) | **Ready upon ADR-01/07 Approval** |
| **TASK-SAVE-03** | Save Corruption Quarantine | **ADR-02** | Pending Approval | No (Data-protection protocol) | **Ready upon ADR-02 Approval** |
| **TASK-SDK-01** | SDK Singleton Hardening | **ADR-03** | Pending Approval | No (Core SDK architecture) | **Ready upon ADR-03 Approval** |
| **TASK-SDK-02** | Standalone Game Mock Fallback | **ADR-03**, **ADR-10** | Pending Approval | No (Offline reliability) | **Ready upon ADR-03/10 Approval** |
| **TASK-ADP-01** | AuroBlocks Bridge Update | **ADR-02** | Pending Approval | No (Standard bridge update) | **Ready upon ADR-02 Approval** |
| **TASK-ADP-02** | AuroMatch SDK Bridge | **ADR-02** | Pending Approval | No (Standard bridge creation) | **Ready upon ADR-02 Approval** |
| **TASK-ADP-03** | VAK Speech SDK Bridge | **ADR-02**, **ADR-03** | Pending Approval | No (Standard bridge creation) | **Ready upon ADR-02/03 Approval** |
| **TASK-ADP-04** | Word Riddle SDK Bridge | **ADR-02**, **ADR-03** | Pending Approval | No (Standard bridge creation) | **Ready upon ADR-02/03 Approval** |
| **TASK-ADP-05** | VAK Sanctuary SDK Bridge | **ADR-02**, **ADR-03** | Pending Approval | No (Standard bridge creation) | **Ready upon ADR-02/03 Approval** |
| **TASK-SYNC-01** | Six-Game Bespoke Merges | **ADR-06**, **ADR-04** | Pending Approval | No (Domain merge policies) | **Ready upon ADR-06/04 Approval** |
| **TASK-SYNC-02** | Durable Outbox in IDB | **ADR-05** | Pending Approval | No (Offline outbox queue) | **Ready upon ADR-05 Approval** |
| **TASK-ART-01** | AuroMandala UUIDv4 Artwork Schema | **ADR-06**, **ADR-02** | Pending Approval | No (Owner chosen: Versioned) | **Ready upon ADR-06 Approval** |
| **TASK-ART-02** | AuroMandala Conflict Forking | **ADR-06** | Pending Approval | **YES: Choice 2 (Conflict Label)** | Blocked on Choice 2 |
| **TASK-ACH-01** | Achievements Service | **ADR-03**, **ADR-02** | Pending Approval | No (Standard monotonic union) | **Ready upon ADR-03/02 Approval** |
| **TASK-COMM-01** | Purchases Interface & Mock | **ADR-08**, **ADR-10** | Pending Approval | No (Launch gate stays false) | **Ready upon ADR-08/10 Approval** |
| **TASK-COMM-02** | Ed25519 Entitlement Verification | **ADR-08** | Pending Approval | **YES: Choice 3 (Offline Grace Period)** | Blocked on Choice 3 |
| **TASK-TEL-01** | 3-Tier Telemetry Queue | **ADR-09**, **ADR-03** | Pending Approval | **YES: Choice 4 (Retention Window)** | Blocked on Choice 4 |
| **TASK-TEL-02** | Telemetry Privacy & Sankalpa E2EE | **ADR-09** | Pending Approval | No (Sacred data exclusion) | **Ready upon ADR-09 Approval** |
| **TASK-CSP-01** | Multi-Host CSP Headers | **ADR-07**, **ADR-10** | Pending Approval | No (Security configuration) | **Ready upon ADR-07/10 Approval** |
| **TASK-REG-01** | Platform Regression Gate | Platform Baseline | Active Baseline | No (251 baseline + invariants) | **Ready upon all tasks** |

---

## 2. Outstanding Owner Decision Points

The following four specific policy decisions require explicit Product Owner input. Unrelated tasks remain unblocked and can proceed immediately upon general ADR approval:

### Decision Choice 1: Storage Failure UI Presentation (`TASK-ID-03`)
- **Context:** When both IndexedDB and localStorage fail (e.g. disk full or extreme private mode), the platform activates RAM-backed ephemeral storage.
- **Option A (Architect Recommended):** Non-blocking amber banner at the top of the portal header with a one-click *"Export Session Progress"* button. Unobtrusive; allows immediate play.
- **Option B:** Modal dialog on portal launch requiring affirmative acknowledgement before entering gameplay.
- **Affected Task:** `TASK-ID-03`.

### Decision Choice 2: Conflict Copy Presentation Label (`TASK-ART-02`)
- **Context:** When concurrent edits occur on the same mandala across two devices, the incoming cloud version is forked into an independent artwork entity.
- **Option A (Architect Recommended):** Title appended with `" (Cloud Copy)"` (e.g., *"Lotus Mandala (Cloud Copy)"*). Clear, intuitive, preserves original title.
- **Option B:** Title appended with timestamp (e.g., *"Lotus Mandala (Synced 2026-11-21)"*).
- **Option C:** Title appended with `" (Alternate)"`.
- **Affected Task:** `TASK-ART-02`.

### Decision Choice 3: Offline Entitlement Grace Period Duration (`TASK-COMM-02`)
- **Context:** When commercial purchasing is activated, cached Ed25519 signed tokens permit offline gameplay.
- **Option A (Architect Recommended):** **30-Day Offline Grace Period**. Balances contemplative offline convenience with reasonable fraud protection.
- **Option B:** 14-Day Offline Grace Period.
- **Option C:** 60-Day Offline Grace Period.
- **Affected Task:** `TASK-COMM-02`. (Note: Commercial gate remains disabled for Jan 1 launch regardless of option selected).

### Decision Choice 4: Cloud Telemetry Retention Period (`TASK-TEL-01`)
- **Context:** Anonymous, non-PII telemetry events collected with user consent.
- **Option A (Architect Recommended):** **30-Day Rolling Purge**. Automatically deletes events older than 30 days from cloud ingest tables.
- **Option B:** 90-Day Rolling Purge.
- **Option C:** Immediate aggregate roll-up (raw events purged after daily metric computation).
- **Affected Task:** `TASK-TEL-01`.

---

## 3. Formal Owner Implementation Authorization Block

```
=================================================================================
             AUROMASTI B18-B1 IMPLEMENTATION AUTHORIZATION
=================================================================================

The Product Owner hereby authorizes the execution of Phase B18-B1 Implementation
in accordance with the Master Implementation Execution Plan:

1. ADR-01 through ADR-10 Approval:
   [ ] APPROVED as recommended with conditions
   [ ] APPROVED WITH REVISIONS (Attached)
   [ ] REJECTED

2. Outstanding Owner Decisions:
   - Choice 1 (Storage Failure UI):     [ ] Option A    [ ] Option B
   - Choice 2 (Conflict Artwork Label): [ ] Option A    [ ] Option B    [ ] Option C
   - Choice 3 (Offline Grace Period):   [ ] Option A    [ ] Option B    [ ] Option C
   - Choice 4 (Telemetry Retention):    [ ] Option A    [ ] Option B    [ ] Option C

3. Authorization to Begin Code Implementation:
   [ ] AUTHORIZED: Proceed with Phase B18-B1 client-side SDK and adapter authoring.
   [ ] HOLD: Await further instructions.

Product Owner Signature: ________________________________________________________

Date: ________________________
=================================================================================
```
