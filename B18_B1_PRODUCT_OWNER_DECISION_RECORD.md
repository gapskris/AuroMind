# AuroMasti — B18-B1 Product Owner Decision Record

**Document status:** Final Binding Product Owner Decision Record — Implementation Authorized  
**Decision stage:** Architecture, Governance, and Implementation Authorization  
**Implementation status:** **AUTHORIZED (All 24 Tasks Authorized)**  
**Workspace:** `C:\AuroMindPortal`  
**Branch:** `dev/studio-integration`  
**Baseline HEAD:** `b6ccc860bb7d38a70ef678049a9588b8b73c40aa`  
**Authorization Date:** November 21, 2026  

---

## 1. Product Owner Final Binding Decisions

### 1.1 Architecture Decision Records (ADR-01 through ADR-10)

**Decision: APPROVE ADR-01 through ADR-10 WITH STATED TECHNICAL CONDITIONS.**

The ten canonical ADRs are:
1. **ADR-01 — Canonical Player Identity Model**
2. **ADR-02 — Game-Specific Progression Schema**
3. **ADR-03 — Shared Service Contracts**
4. **ADR-04 — Guest-to-Account Migration**
5. **ADR-05 — Offline Synchronization Strategy**
6. **ADR-06 — Conflict Resolution Policy**
7. **ADR-07 — Cloud vs. Local Data Ownership**
8. **ADR-08 — Purchase Entitlement Architecture**
9. **ADR-09 — Analytics & Privacy Boundaries**
10. **ADR-10 — Backend-Independent SDK Design**

Approval is subject to the 14 non-negotiable architectural conditions recorded in Section 2.

---

### 1.2 Hosting Decision

**Decision: DEFER.**
- Retain existing GitHub Pages arrangement during current development and validation.
- Cloudflare proxy vs. Cloudflare Pages vs. Vercel remains open for a later deployment decision.
- GitHub remains the permanent source of truth.
- Before production deployment, the selected hosting solution must support and pass validation for required HTTP response headers (`frame-ancestors 'self'`, `X-Frame-Options: SAMEORIGIN`, CSP, `nosniff`).
- No DNS, domain, proxy, hosting, or deployment changes are authorized at this stage.

---

### 1.3 Four Product Owner Policy Choices (All Decided)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    FINAL BINDING PRODUCT POLICY DECISIONS                       │
├──────────┬─────────────────────────────┬────────────────────────────────────────┤
│ CHOICE   │ POLICY FOCUS                │ APPROVED BEHAVIOUR                     │
├──────────┼─────────────────────────────┼────────────────────────────────────────┤
│ Choice A │ Storage Failure UX          │ APPROVED: Option A1                    │
│          │ (`TASK-ID-03`)              │ Amber warning banner + JSON export +   │
│          │                             │ temporary in-memory RAM gameplay.      │
├──────────┼─────────────────────────────┼────────────────────────────────────────┤
│ Choice B │ Artwork Conflict Label      │ APPROVED: Option B (Distinct Naming)   │
│          │ (`TASK-ART-02`)             │ Preserve both versions; label recovered│
│          │                             │ copy as "[Title] (Recovered Copy)".    │
├──────────┼─────────────────────────────┼────────────────────────────────────────┤
│ Choice C │ Offline Entitlement Grace   │ APPROVED: Option C (Calendar-Based)    │
│          │ (`TASK-COMM-02`)            │ 30 calendar days elapsed time from     │
│          │                             │ last trusted server validation.        │
├──────────┼─────────────────────────────┼────────────────────────────────────────┤
│ Choice D │ Telemetry Retention Period  │ APPROVED: Option D1                    │
│          │ (`TASK-TEL-01`)             │ 30-day raw telemetry retention window; │
│          │                             │ automatic purge of events > 30 days.   │
└──────────┴─────────────────────────────┴────────────────────────────────────────┘
```

#### Detailed Policy Specifications:
1. **Choice A — Storage Failure UX (A1):**
   - When persistent storage (both IDB and localStorage) is unavailable:
     1. Display a non-blocking amber warning banner in the portal.
     2. Explain that progress cannot currently be saved.
     3. Offer one-click JSON export of recoverable player data (`.auromind-backup.json`).
     4. Allow gameplay to continue in temporary in-memory RAM mode.
     5. Warn that progress may be lost when the session closes.
     6. Never show a blocking modal as default. Never expose passphrases or Sankalpa Vault contents in export.
2. **Choice B — Artwork Conflict Preservation & Naming:**
   - Different artworks on different devices synchronize independently without conflict.
   - Same artwork edited independently on two devices:
     - Detect competing revisions.
     - Preserve both original and recovered versions; **never silently overwrite either**.
     - Give the recovered version a distinct name: `[Title] (Recovered Copy)`.
     - Recovered artwork receives a unique UUIDv4 and its own revision history.
     - Deletion tombstones prevent deleted artwork from unexpectedly reappearing during sync.
3. **Choice C — Offline Entitlement Grace Period (Calendar-Based 30 Days):**
   - Measured using **elapsed calendar time** from last trusted server validation, not active gameplay time.
   - Explicitly accepted limitation: Browser-only client time cannot be tamper-proof against hostile device owners.
   - Detect obvious clock rollback and inconsistent records; avoid extending validity based solely on untrusted client clock; preserve last trusted server validation record; fail safely without damaging user's local game progress.
   - Purchase activation remains **strictly disabled** for launch (`COMMERCIAL_GATE_ENABLED: false`).
4. **Choice D — Telemetry Retention (D1 — 30 Days):**
   - Raw telemetry queue automatically purges events older than 30 days.
   - 3-tier queue (CRITICAL: 100 in IDB, ENGAGEMENT: 300, DIAGNOSTIC: 100).
   - Strict positive allowlists; no Sankalpa, no reflections, no raw audio, no raw strokes, no passphrases.

---

## 2. Conditions Attached to Architecture Approval

1. **Local-first operation:** Basic gameplay must work offline without cloud dependencies.
2. **Sacred data protection:** VAK corpus, Flora database, and Sankalpa Vault protections remain non-negotiable and frozen.
3. **Sankalpa Vault:** Remains local-only and end-to-end encrypted; it must never be synchronized or included in telemetry.
4. **Save integrity:** Use canonical serialization and cryptographic SHA-256 integrity checks rather than weak string-based checksums.
5. **Storage recovery:** Use revision-based reconciliation and integrity validation. Timestamps may be supporting metadata but must not be the authoritative conflict-resolution mechanism.
6. **Artwork safety:** AuroMandala artwork must support versioning, non-destructive conflict recovery, deletion tombstones, and conflict forking.
7. **Game adapters:** All six games must have the required shared-service integration and appropriate standalone fallback behaviour.
8. **Achievements:** Implement a defined, typed, and idempotent achievements contract.
9. **Telemetry privacy:** Use strict event schemas and field allowlists. Do not rely solely on recursive blacklist-based sanitization.
10. **Telemetry delivery:** Document queue saturation and data-loss limitations. Do not promise guaranteed delivery when browser storage or process execution is unavailable.
11. **Purchase security:** Use server-verified purchase records and signed entitlements. Client-side state alone must never establish purchase validity.
12. **Backend independence:** The shared SDK must remain provider-independent.
13. **Storage resilience:** `navigator.storage.persist()` is a request, not a guarantee. Storage eviction and unavailable-storage modes must be handled explicitly.
14. **Security headers:** Production CSP and related HTTP response headers must be configured at the selected hosting layer and verified in real browsers.

---

## 3. Implementation Authorization

**DECISION: AUTHORIZE IMPLEMENTATION OF ALL 24 TASKS ACROSS WORKSTREAMS A THROUGH K.**

The 24 canonical implementation tasks are:
- `TASK-ID-01`: Identity Multi-Tab Web Locks
- `TASK-ID-02`: Storage Persistence and Quota
- `TASK-ID-03`: Storage Failure UX (A1 Experience)
- `TASK-SAVE-01`: Canonical JSON and SHA-256
- `TASK-SAVE-02`: AuroMatch Auto-Healing Fix
- `TASK-SAVE-03`: Save Corruption Quarantine
- `TASK-SDK-01`: SDK Singleton Hardening
- `TASK-SDK-02`: Standalone Game Mock Fallback
- `TASK-ADP-01`: AuroBlocks Bridge Update
- `TASK-ADP-02`: AuroMatch SDK Bridge Authoring
- `TASK-ADP-03`: VAK Speech SDK Bridge Authoring
- `TASK-ADP-04`: Word Riddle SDK Bridge Authoring
- `TASK-ADP-05`: VAK Sanctuary SDK Bridge Authoring
- `TASK-SYNC-01`: Six-Game Bespoke Merge Strategies
- `TASK-SYNC-02`: Durable Outbox in IndexedDB
- `TASK-ART-01`: UUIDv4 Artwork Schema
- `TASK-ART-02`: Artwork Conflict Preservation and Naming (`(Recovered Copy)`)
- `TASK-ACH-01`: Typed Achievements Service
- `TASK-COMM-01`: Purchase Interface and Mock Provider
- `TASK-COMM-02`: Ed25519 Entitlement Verification (30 Calendar Days)
- `TASK-TEL-01`: Three-Tier Telemetry Queue and 30-Day Retention
- `TASK-TEL-02`: Telemetry Privacy and Strict Allowlisting
- `TASK-CSP-01`: Multi-Host CSP Configurations and Validation
- `TASK-REG-01`: Platform Regression Gate (293 Tests Target)

---

## 4. Explicit Authorization Boundaries

This decision record authorizes Phase B18-B1 client-side and test implementation only.

It does **NOT** authorize:
- Git commits, pushes, merges, rebases, or resets.
- Provisioning Supabase or Firebase projects.
- Running production database migrations.
- Deploying Edge Functions.
- Activating Razorpay, Stripe, or any commercial payment provider.
- Changing hosting, DNS, proxy, or production deployment.
- Modifying sacred assets (VAK corpus, Flora DB, Sankalpa Vault).

---

## 5. Execution Confirmation

**Product Owner Confirmation:**  
All 10 ADRs approved with conditions. All 4 policy choices confirmed (A1, B Distinct Naming, C 30 Calendar Days, D1 30 Days Retention). Hosting deferred. All 24 tasks authorized for immediate implementation.

**Date:** November 21, 2026  
**Status:** **AUTHORIZED — PROCEED TO CODE IMPLEMENTATION**  
