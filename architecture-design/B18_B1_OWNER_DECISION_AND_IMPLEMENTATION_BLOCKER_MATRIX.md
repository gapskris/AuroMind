# AuroMasti B18-B1 — Owner Decision & Implementation Blocker Matrix
## Granular Mapping of All 24 Implementation Tasks to Formal Architecture Approvals, Policy Choices, and Authorization Gates

- **Document Version:** 5.0.0 (Implementation Authorized Baseline)
- **Batch Reference:** B18-B1 Master Implementation Execution
- **Canonical Workspace:** `C:\AuroMindPortal`
- **Active Git Branch:** `dev/studio-integration`
- **Baseline HEAD:** `b6ccc860bb7d38a70ef678049a9588b8b73c40aa`
- **Target Release:** January 1, 2027
- **Governance Mandate:** **ADR-01 THROUGH ADR-10 APPROVED WITH CONDITIONS**. All 4 Policy Choices Decided: **Choice A: A1**; **Choice B: Distinct Naming (`(Recovered Copy)`)**; **Choice C: 30 Calendar Days**; **Choice D: D1 (30 Days)**. Hosting: **DEFERRED**. All 24 Tasks: **AUTHORIZED FOR IMPLEMENTATION**.

---

## 1. Executive Implementation Readiness Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      IMPLEMENTATION READINESS SUMMARY                           │
├────────────────────────────────────────┬─────────────┬───────────┬──────────────┤
│ CATEGORY                               │ TASK COUNT  │ PERCENTAGE│ STATUS       │
├────────────────────────────────────────┼─────────────┼───────────┼──────────────┤
│ Authorized for Immediate Implementation│ 24 tasks    │ 100.0%    │ ALL 24 TASKS │
│ (All ADRs & Choices Approved)          │             │           │ AUTHORIZED   │
├────────────────────────────────────────┴─────────────┴───────────┴──────────────┤
│ IMPLEMENTATION AUTHORIZATION STATUS: FULLY AUTHORIZED BY PRODUCT OWNER          │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Master 24-Task Blocker & Implementation Status Matrix

| Task ID | Exact Implementation Title | Owning Workstream | Governing ADR | Governing Policy Decision | Implementation Status |
| :--- | :--- | :--- | :---: | :---: | :--- |
| **TASK-ID-01** | Identity Multi-Tab Web Locks | A. Identity & Storage | **ADR-01** | Architecture Approved | **AUTHORIZED — READY TO CODE** |
| **TASK-ID-02** | Storage Persistence & Quota | A. Identity & Storage | **ADR-01**, **ADR-07** | Architecture Approved | **AUTHORIZED — READY TO CODE** |
| **TASK-ID-03** | Ephemeral Mode & Backup UI | A. Identity & Storage | **ADR-01**, **ADR-07** | **Choice A1 Approved** (Amber banner + export) | **AUTHORIZED — READY TO CODE** |
| **TASK-SAVE-01** | Canonical JSON & SHA-256 | B. Save Integrity | **ADR-02**, **ADR-05** | Architecture Approved | **AUTHORIZED — READY TO CODE** |
| **TASK-SAVE-02** | AuroMatch Auto-Healing Fix | B. Save Integrity | **ADR-01**, **ADR-07** | Architecture Approved | **AUTHORIZED — READY TO CODE** |
| **TASK-SAVE-03** | Save Corruption Quarantine | B. Save Integrity | **ADR-02** | Architecture Approved | **AUTHORIZED — READY TO CODE** |
| **TASK-SDK-01** | SDK Singleton Hardening | C. Shared SDK | **ADR-03** | Architecture Approved | **AUTHORIZED — READY TO CODE** |
| **TASK-SDK-02** | Standalone Game Mock Fallback | C. Shared SDK | **ADR-03**, **ADR-10** | Architecture Approved | **AUTHORIZED — READY TO CODE** |
| **TASK-ADP-01** | AuroBlocks Bridge Update | D. Game Adapters | **ADR-02** | Architecture Approved | **AUTHORIZED — READY TO CODE** |
| **TASK-ADP-02** | AuroMatch SDK Bridge Authoring | D. Game Adapters | **ADR-02** | Architecture Approved | **AUTHORIZED — READY TO CODE** |
| **TASK-ADP-03** | VAK Speech SDK Bridge Authoring| D. Game Adapters | **ADR-02**, **ADR-03** | Architecture Approved | **AUTHORIZED — READY TO CODE** |
| **TASK-ADP-04** | Word Riddle SDK Bridge Authoring | D. Game Adapters | **ADR-02**, **ADR-03** | Architecture Approved | **AUTHORIZED — READY TO CODE** |
| **TASK-ADP-05** | VAK Sanctuary SDK Bridge | D. Game Adapters | **ADR-02**, **ADR-03** | Architecture Approved | **AUTHORIZED — READY TO CODE** |
| **TASK-SYNC-01** | Six-Game Bespoke Merges | E. Sync & Merging | **ADR-06**, **ADR-04** | Architecture Approved | **AUTHORIZED — READY TO CODE** |
| **TASK-SYNC-02** | Durable Outbox in IDB | E. Sync & Merging | **ADR-05** | Architecture Approved | **AUTHORIZED — READY TO CODE** |
| **TASK-ART-01** | AuroMandala UUIDv4 Schema | F. Artwork Protection | **ADR-06**, **ADR-02** | Architecture Approved | **AUTHORIZED — READY TO CODE** |
| **TASK-ART-02** | Artwork Conflict Preservation & Naming | F. Artwork Protection | **ADR-06** | **Choice B Approved** (`(Recovered Copy)`) | **AUTHORIZED — READY TO CODE** |
| **TASK-ACH-01** | Achievements Service | G. Achievements | **ADR-03**, **ADR-02** | Architecture Approved | **AUTHORIZED — READY TO CODE** |
| **TASK-COMM-01**| Purchases Interface & Mock | H. Commerce Engine | **ADR-08**, **ADR-10** | Architecture Approved (Gate False) | **AUTHORIZED — READY TO CODE** |
| **TASK-COMM-02**| Ed25519 Token Verification | H. Commerce Engine | **ADR-08** | **Choice C Approved** (Calendar 30d) | **AUTHORIZED — READY TO CODE** |
| **TASK-TEL-01** | 3-Tier Telemetry Queue | I. Telemetry | **ADR-09**, **ADR-03** | **Choice D1 Approved** (30d retention) | **AUTHORIZED — READY TO CODE** |
| **TASK-TEL-02** | Telemetry Privacy & Strict Allowlisting| I. Telemetry | **ADR-09** | Architecture Approved (Positive allowlist)| **AUTHORIZED — READY TO CODE** |
| **TASK-CSP-01** | Multi-Host CSP Headers | J. CSP & Security | **ADR-07**, **ADR-10** | Hosting Deferred (Repo configs ready) | **AUTHORIZED — READY TO CODE** |
| **TASK-REG-01** | Platform Regression Gate | K. Regression Gate | Platform Baseline | 293 Tests Target | **AUTHORIZED — FINAL ACCEPTANCE GATE** |

---

## 3. Test Accounting Model (251 Baseline -> 293 Target)

- **Current Verified Baseline:** Exactly **251 / 251 tests passing** via Node.js native test runner (`node --test`) at HEAD `b6ccc860bb7d38a70ef678049a9588b8b73c40aa`. Status: **`VERIFIED`**.
- **Historical Browser Provenance:** B17.4 evidence utilized a custom in-browser harness and did not run Playwright Test CLI. Playwright browser tests will be executed during B18-B1 batch validation.
- **Planned / Designed Test Cases:** Exactly **42 new test cases** across 10 targeted suites. Status: **`READY FOR EXECUTION`**.
- **Combined Target:** Exactly **293 automated tests passing** required for final B18-B1 acceptance (`TASK-REG-01`).
