# AuroMasti v2.0.0 Beta — B19.9.7 Bucket 2 Remediation & Closeout Report

**Project:** AuroMasti (formerly AuroMind) v2.0.0 Beta  
**Workstream:** Bucket 2 — Supabase Database Foundation  
**Task:** B19.9.7 — Final Remediation, Governance Hardening & Storage Provisioning Readiness  
**Canonical Workspace:** `C:\AuroMindPortal`  
**Branch:** `dev/studio-integration`  
**Remote:** `origin`  
**Supabase Project:** `rlqrtbjynaihdspbqtce`  
**Region:** `ap-southeast-1`  
**Target Delivery:** November 30, 2026  
**Final Disposition:** **`READY FOR STORAGE PROVISIONING APPROVAL`**

---

## 1. Executive Summary & Context

Following the guarded deployment execution in B19.9.6 under attributable Product Owner authorization, the core database schema was established on the live Supabase instance with 9 of 10 canonical migrations applied cleanly. Migration 10 (`20261123000002_b19_5_06_storage_buckets_and_rls.sql`) was halted and rolled back atomically upon encountering `SQLSTATE 42501 (must be owner of table objects)` at Statement 0 (`ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY`).

Task **B19.9.7** completes all remaining engineering, governance hardening, and provisioning readiness for Bucket 2:
1. **Established Empirical Remote Baseline:** Verified read-only that the live remote database remains pristine with 9 applied migrations, 1 pending migration, 15 public application tables (100% RLS enabled), hardened search paths, 0 unexpected objects, and 0 partial storage records.
2. **Audited & Remediated Migration Workflow:** Replaced static boolean evidence assignments in `scripts/execute-authorized-migration.mjs` with dynamic, verifiable evidence from `runPreflight({ allowRemote: true })`; decoupled actual backup readiness (`backupReadinessConfirmed: false` on Free Tier) from initial schema deployment risk acceptance (`initialSchemaRiskAccepted: true`); restricted CLI extra arguments to prevent scope expansion; and enforced fail-closed guards against unauthorized remote mutations.
3. **Formulated Additive Storage Provisioning Plan:** Completed the safe, additive remediation design for private buckets `avatars` (512 KiB) and `user-artwork` (5 MiB), preserving all sacred invariants (zero `mandala-cloud-sync`, zero cloud sync for Sankalpa, local-first artwork).
4. **Formalized Backup & Disaster Recovery Governance:** Accurately recorded the Free Tier backup status (zero automated recovery points) and established the non-negotiable release gate mandating Supabase Pro / automated backups prior to real player onboarding.
5. **Passed Full Regression Suite:** All 45 test suites (745 total tests) passed with 100% success rate, 0 failures, and 0 secret exposures.

---

## 2. Classification of Findings & Facts

To ensure total transparency, all facts and governance items are categorized into five distinct classifications:

### A. Live-Verified Facts (Empirically Confirmed on Remote Project `rlqrtbjynaihdspbqtce`)
* **Remote Migration Ledger (`supabase migration list`):** Exactly 9 migrations applied, exactly 1 migration pending (`20261123000002`), 0 untracked migrations, 0 drift.
* **Public Schema Tables (`supabase inspect db table-stats`):** Exactly 15 application tables exist in `public`:
  1. `user_profiles`
  2. `user_private_settings`
  3. `guest_identity_links`
  4. `game_saves`
  5. `game_save_revisions`
  6. `entitlements`
  7. `entitlement_audit`
  8. `purchase_receipts`
  9. `telemetry_events`
  10. `telemetry_rate_limits`
  11. `telemetry_daily_aggregates`
  12. `telemetry_rate_buckets` (unlogged table)
  13. `storage_deletion_queue`
  14. `remote_config`
  15. `owner_roles`
* **RLS Coverage:** 15 of 15 public tables (100.0%) have Row-Level Security enabled.
* **Function Hardening:** SECURITY DEFINER functions have explicit pinned `search_path = public, pg_temp`.
* **Remote Storage State (`GET /storage/v1/bucket`):** Returns empty array (`[]`). Neither `avatars`, `user-artwork`, nor `mandala-cloud-sync` exist on the remote project.

### B. Locally Verified Facts (Validated in Canonical Repository)
* **Canonical Migration Files:** Exactly 10 SQL files in `supabase/migrations/` in strict lexical order.
* **Cryptographic Manifest:** Manifest hash `f55231159389f9d5549713ee83c783c1c7130dc7454058c8195140ae529899ea` verified.
* **Regression Suite:** 45 test files, 745 individual tests, 745 passed, 0 failed, 0 flaky.
* **Credential Hygiene:** Zero secrets, JWT tokens, or credentials committed or leaked.

### C. Pending Owner Actions
* **`OWNER-OPS-01` (Backup & Recovery Posture):** Mandatory upgrade to Supabase Pro with automated daily backups OR verified automated `pg_dump` recovery solution prior to live player onboarding.
* **`OWNER-OPS-02` (Storage Provisioning Approval):** Review and formally authorize the Storage Provisioning Plan (via Dashboard UI or surgical additive migration).

### D. Accepted Risks
* **Initial Schema Deployment Backup Limitation:** The Product Owner explicitly accepted the operational risk that initial empty-schema deployment proceeded on Supabase Free tier without automated PITR/backups, conditioned on the database remaining clean and empty of player data.

### E. Items Requiring Separate Authorization
* **Storage Bucket Creation:** Any live mutation to create `avatars` or `user-artwork` buckets.
* **Storage Policy Application:** Any live creation of RLS policies on `storage.objects`.
* **Edge Function Deployment:** Deployment of the 6 canonical edge functions.
* **Auth / SMTP Provider Activation:** Any changes to email auth or third-party providers.

---

## 3. Workflow & Runner Governance Audit Summary

The guarded migration runner and workflow scripts were audited and remediated against the 7 core governance principles:

| Audit Check Item | Finding Prior to B19.9.7 | Remediation Applied in B19.9.7 | Status |
| :--- | :--- | :--- | :---: |
| **1. Fresh Preflight Evidence** | Static boolean `true` assigned in runner | Dynamically invoked `runPreflight({ allowRemote: true })` and extracted verifiable evidence | **RESOLVED** |
| **2. Independent Verification** | Relied solely on manifest hash | Verified target project ref, migration count, manifest checksum, and ledger independently | **RESOLVED** |
| **3. Fail-Closed on Mismatch** | Checked only manifest and age | Added checks for project ref and migration count in gate evidence | **RESOLVED** |
| **4. Truthful Backup Reporting** | Runner claimed `backupReadinessConfirmed: true` | Corrected to `backupReadinessConfirmed: false` reflecting Free Tier zero recovery points | **RESOLVED** |
| **5. Accepted Risk Separation** | Conflated backup readiness with approval | Decoupled into `initialSchemaRiskAccepted: true`, verified in PO statement | **RESOLVED** |
| **6. CLI Scope Boundary** | Arbitrary flags could pass through | Restricted `extraArgs` strictly to `['--yes']`; disallowed flags immediately reject | **RESOLVED** |
| **7. Prevention of Silent Mutations** | Potential rerun of failing migration 10 | Explicit block added in runner preventing execution while migration 10 is pending | **RESOLVED** |

---

## 4. Storage Provisioning Design Summary

The failed operation in Migration 10 (`ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY`) was an attempt to modify an internal Supabase table owned by `supabase_storage_admin` from the `postgres` role. In hosted Supabase, RLS is already enabled by default on `storage.objects`.

* **Safe Remediation Strategy (Recommended):** Provision private buckets `avatars` (512 KiB; PNG, JPEG, WebP) and `user-artwork` (5 MiB; PNG, WebP, JSON) via the Supabase Dashboard UI, followed by creating the 8 owner-folder access policies.
* **Alternative Strategy:** Execute a surgical additive SQL script omitting the redundant `ALTER TABLE` statement, accompanied by an updated manifest package and Product Owner approval.
* **Invariants Preserved:**
  - `mandala-cloud-sync` is **STRICTLY EXCLUDED**.
  - Sankalpa cloud sync is **STRICTLY EXCLUDED** (remains local-first encrypted vault).
  - `capabilities.cloudSyncEligible = false` is **PRESERVED**.
  - AuroMandala artwork remains local-first with explicit user-controlled export.

*(For detailed execution runbooks, permissions, rollback procedures, and SQL scripts, see [B19_9_7_STORAGE_PROVISIONING_PLAN.md](file:///C:/AuroMindPortal/docs/reports/B19_9_7_STORAGE_PROVISIONING_PLAN.md).)*

---

## 5. Backup & Disaster Recovery Governance

The current posture of the Supabase project `rlqrtbjynaihdspbqtce` is documented accurately:
* **Current Plan:** Supabase Free Tier.
* **Automated Daily Backups:** Not included.
* **Point-in-Time Recovery (PITR):** Not available (requires Pro Plan + PITR add-on).
* **Live Recovery Points:** **0 recovery points established.**
* **Accepted Risk Scope:** Confined strictly to the initial schema deployment on an empty database.
* **Player Onboarding Gate:** Under no circumstances may real players be onboarded until either:
  1. The project is upgraded to Supabase Pro with daily automated backups verified; OR
  2. An automated out-of-band backup pipeline (e.g. daily scheduled `pg_dump` with S3/R2 storage and automated restore testing) is implemented and verified.

---

## 6. Final Bucket 2 Disposition

> **`READY FOR STORAGE PROVISIONING APPROVAL`**
>
> The core database foundation (9 of 10 migrations, 15 public tables, 100% RLS coverage, pinned function search paths) is live, stable, and verified. The migration workflow and execution runner have been hardened to enforce dynamic preflight evidence, truthful backup reporting, and fail-closed safety boundaries. All preparation for storage bucket provisioning is complete. Execution awaits separate, attributable Product Owner authorization.
