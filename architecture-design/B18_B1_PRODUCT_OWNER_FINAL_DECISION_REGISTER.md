# AuroMasti B18-B1 — Product Owner Final ADR Decision Register
## Canonical Decisions for ADR-01 through ADR-10, Established Principles, Policy Choices, Hosting Security, and Test Accounting

- **Document Version:** 5.0.0 (Implementation Authorized Baseline)
- **Batch Reference:** B18-B1 Master Implementation Execution
- **Canonical Workspace:** `C:\AuroMindPortal`
- **Active Git Branch:** `dev/studio-integration`
- **Baseline HEAD:** `b6ccc860bb7d38a70ef678049a9588b8b73c40aa`
- **Target Release:** January 1, 2027
- **Governance Status:** **ADR-01 THROUGH ADR-10 APPROVED WITH CONDITIONS**. All 4 Policy Choices Decided: **Choice A: A1 (Banner + Export)**; **Choice B: Distinct Naming (`(Recovered Copy)`)**; **Choice C: 30 Calendar Days Grace**; **Choice D: D1 (30 Days Retention)**. Hosting: **DEFERRED**. All 24 Tasks: **AUTHORIZED FOR IMPLEMENTATION**.

---

## 1. Established & Non-Negotiable Owner Principles

The following foundational architectural principles have been formally confirmed by the Product Owner:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    ESTABLISHED & LOCKED OWNER PRINCIPLES                        │
├─────────────────────────────────────────────────────────────────────────────────┤
│ 1. ONE PROFILE = ONE IDENTITY: One browser profile represents exactly one       │
│    persistent player identity. All 6 games and all tabs share that identity.   │
│ 2. INDEPENDENT PROGRESSION NAMESPACES: Each game maintains its own progression  │
│    and save namespace; zero cross-game save corruption or property bleeding.   │
│ 3. ZERO IN-APP PROFILE SWITCHING: In-app player profile pickers, player        │
│    switching dialogs, or session-boundary prompts are strictly prohibited.      │
│ 4. AUROMANDALA ARTWORK PROTECTION: Must use versioned artwork protection with   │
│    conflict recovery. Zero silent artwork overwrites under any sync condition.  │
│ 5. SEQUENTIAL PHASING: Phase B18-B1 (Client SDK & Adapters) strictly precedes    │
│    Phase B18-B (Supabase Schema Design), which precedes B18-C (Live Activation).│
│ 6. ZERO DEFERRED FINDINGS: No P1, P2, or P3 finding may be omitted or deferred.│
│ 7. STRICT AUTHORIZATION BOUNDARY: Architecture approval authorizes B18-B1 client│
│    remediation only; does not authorize cloud provisioning or payment gateways. │
│ 8. SACRED DATA INVARIANTS: VAK Corpus (SHA-256 9fdb38...), Flora DB (2,002,176  │
│    bytes, SHA-256 689d03...), and Sankalpa Vault (local-only E2EE) are frozen.  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Canonical ADR Decisions: ADR-01 through ADR-10

> **DECISION: APPROVE ADR-01 THROUGH ADR-10 WITH STATED TECHNICAL CONDITIONS.**

1. **ADR-01 — Canonical Player Identity Model:** `APPROVED WITH CONDITIONS`. Unified UUIDv4 guest identity (`guest_<uuidv4>`), Web Locks multi-tab sync, dual IDB+LS persistence, RAM fallback on total storage failure.
2. **ADR-02 — Game-Specific Progression Schema:** `APPROVED WITH CONDITIONS`. Standardized envelope framing (`SAVE_ENVELOPE_VERSION = 1`) with opaque payload, canonical JSON key sorting, Web Crypto SHA-256 excluding transport metadata, corruption quarantine.
3. **ADR-03 — Shared Service Contracts:** `APPROVED WITH CONDITIONS`. Frozen ES module singleton (`AuroMindSDK`), embedded mock fallback (`createLocalMockBridge`), domain fault isolation.
4. **ADR-04 — Guest-to-Account Migration:** `APPROVED WITH CONDITIONS`. Non-destructive `guest_identity_links` relational mapping, atomic client rollback, domain merges on conflict.
5. **ADR-05 — Offline Synchronization Strategy:** `APPROVED WITH CONDITIONS`. Local-authoritative IndexedDB outbox queue, optimistic revision concurrency (`upsert_game_save_checked`), exponential backoff with jitter.
6. **ADR-06 — Conflict Resolution Policy:** `APPROVED WITH CONDITIONS`. Invariants 1–4, bespoke domain merges, AuroMandala versioned artwork protection with 10 snapshots, soft tombstones, and non-destructive conflict forking.
7. **ADR-07 — Cloud vs. Local Data Ownership:** `APPROVED WITH CONDITIONS`. Client device is primary operational authority, revision-based reconciliation (timestamps supporting metadata only), 100% offline operability.
8. **ADR-08 — Purchase Entitlement Architecture:** `APPROVED WITH CONDITIONS`. Free launch beta (`COMMERCIAL_GATE_ENABLED: false`), server-verified Ed25519 tokens for future one-time purchases, calendar-based offline grace (30 days), browser clock tampering limitations accepted, fail-safe operation.
9. **ADR-09 — Analytics & Privacy Boundaries:** `APPROVED WITH CONDITIONS`. Zero PII, strict opt-in consent, 3-tier queue (CRITICAL: 100 in IDB, ENGAGEMENT: 300, DIAGNOSTIC: 100), positive field allowlists, Sankalpa Vault 100% local-only E2EE.
10. **ADR-10 — Backend-Independent SDK Design:** `APPROVED WITH CONDITIONS`. Provider Adapter Pattern (`backend-config.js`) decoupling games from concrete backends, edge configs decouple static hosting infrastructure.

---

## 3. Product Policy Choices Final Decisions

- **Choice A (Storage Failure UX):** **APPROVED Option A1**. Non-blocking amber banner + manual JSON export + temporary in-memory RAM gameplay. Never a default blocking modal.
- **Choice B (Mandala Conflict Preservation & Naming):** **APPROVED Option B (Distinct Naming)**. Preserves both copies. Recovered artwork titled `[Title] (Recovered Copy)` with a fresh UUIDv4 and separate revision history. Never a generic Cloud Copy label.
- **Choice C (Offline Entitlement Grace):** **APPROVED Option C (Calendar-Based 30 Days)**. Measured in elapsed calendar time from last trusted server validation. Browser client clock tampering limitations explicitly accepted. Commercial gate remains false for launch.
- **Choice D (Telemetry Retention):** **APPROVED Option D1 (30 Days)**. Raw telemetry purged automatically after 30 days.

---

## 4. Hosting Architecture Decision: DEFERRED

- **Decision:** **DEFERRED**.
- Existing GitHub Pages arrangement remains unchanged during current development and validation.
- All configurations (`_headers`, `vercel.json`, `netlify.toml`) prepared and validated in repository for future deployment.

---

## 5. Implementation Authorization Status: AUTHORIZED

- **Implementation Authorization:** **AUTHORIZED**.
- All 24 canonical tasks across Workstreams A through K authorized for implementation.
