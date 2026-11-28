# AuroMasti v2.0.0 Beta — Final 20-Step Migration Authorization & Pre-Execution Checklist

**Milestone:** B19.9.3 (Bucket 2 Closeout)  
**Governance ID:** `CANON-GOV-01`  
**Target Project Reference:** `rlqrtbjynaihdspbqtce` (ap-southeast-1)  
**Canonical Manifest SHA-256:** `f55231159389f9d5549713ee83c783c1c7130dc7454058c8195140ae529899ea`  
**Target Release Deadline:** November 30, 2026  
**Commercial Gate:** `COMMERCIAL_GATE_ENABLED=false` (Strictly Preserved)  
**Execution Boundary:** STEPS 1–15 VERIFIED — STEPS 16–20 STRICTLY UNEXECUTED IN THIS TASK  

---

## 1. Executive Summary & Purpose

This document defines the authoritative, deterministic 20-step pre-execution and execution protocol for applying the 10 canonical Supabase migrations to project `rlqrtbjynaihdspbqtce`.

Steps 1 through 15 establish the rigorous preflight verification and authorization checks. Steps 16 through 20 define the execution, post-migration verification, and sanitized logging procedure to be carried out exclusively upon receipt of formal Product Owner authorization.

---

## 2. Deterministic 20-Step Migration Execution Protocol

| Step # | Protocol Checkpoint | Verification Method & Target Criterion | Pre-Execution Status |
|:---:|:---|:---|:---:|
| **01** | **Confirm Exact Project Reference** | Must strictly equal `rlqrtbjynaihdspbqtce`. Verified in `.env.local`, `config.toml`, and `backend-config.js`. | **VERIFIED** |
| **02** | **Confirm Exact Branch & Workspace** | Workspace must be `C:\AuroMindPortal`; active branch must be `dev/studio-integration` tracking `origin`. | **VERIFIED** |
| **03** | **Confirm Clean & Understood Git Working Tree** | `git status --short --branch` inspected; zero unintended modifications; untracked historical files preserved. | **VERIFIED** |
| **04** | **Confirm Exact 10 Migration Files** | Exactly 10 canonical `.sql` files in `supabase/migrations/` matching timestamps `20261120000001` through `20261123000002`. | **VERIFIED** |
| **05** | **Recompute & Compare Manifest SHA-256** | Manifest dynamically recomputed; must match: `f55231159389f9d5549713ee83c783c1c7130dc7454058c8195140ae529899ea`. | **VERIFIED** |
| **06** | **Confirm Current Remote Migration Ledger** | `npx supabase migration list --remote` reports 0 applied migrations on remote project. | **VERIFIED** |
| **07** | **Confirm Database Baseline & Absence of User Data** | `npx supabase inspect db table-stats` returns affirmative clean check (0 user tables in public schema). | **VERIFIED** |
| **08** | **Confirm Latest Dry-Run Push** | `npx supabase db push --dry-run` over Session Pooler succeeds with exit code 0 and 0 errors. | **VERIFIED** |
| **09** | **Confirm Supported Automated Auth Mechanism** | Password delivered in-memory via `cliEnv.PGPASSWORD = cliEnv.SUPABASE_DB_PASSWORD`; zero password flags in CLI. | **VERIFIED** |
| **10** | **Confirm TLS Protocol & Root CA Validation** | Session Pooler port 5432 negotiates TLS 1.3 `TLS_AES_256_GCM_SHA384` with `prod-ca-2021.crt` (`Authorized: true`). | **VERIFIED** |
| **11** | **Confirm Backup/PITR Decision & Documented Risk** | Risk accepted for empty DB schema push (0 user data loss); Dashboard check mandated before live user traffic. | **VERIFIED** |
| **12** | **Confirm Recovery Runbook Availability** | `B19_9_2_1_MIGRATION_RECOVERY_RUNBOOK.md` available; blanket public schema drops explicitly prohibited. | **VERIFIED** |
| **13** | **Confirm Explicit Product Owner Approval** | Attributable JSON record provided by named Product Owner with explicit statement. | **AWAITING PO SIGNATURE** |
| **14** | **Confirm Approval Parameters Match Repository** | Approval record must bind exact project `rlqrtbjynaihdspbqtce`, count `10`, and hash `f55231159389...`. | **READY TO VALIDATE** |
| **15** | **Obtain Fresh Remote Preflight Evidence ($\le 30$ min)** | Re-run `npm.cmd run migrate:preflight:remote` immediately prior to execution; timestamp must be $\le 30$ min old. | **READY TO EXECUTE** |
| **16** | **Apply Only 10 Approved Migrations via Guarded Runner** | Execute `node scripts/migration-workflow.mjs --execute` within the 60-minute approval window. | **LOCKED (STEP 16)** |
| **17** | **Verify Remote Migration Ledger Post-Push** | `supabase migration list --remote` must report all 10 canonical migrations marked as applied. | **LOCKED (STEP 17)** |
| **18** | **Verify Schema, 100% RLS, Search Paths & Buckets** | Execute `supabase/verify_remote_schema.sql`; verify 15 tables, 100% RLS, hardened search paths, 2 buckets. | **LOCKED (STEP 18)** |
| **19** | **Run Post-Migration Regression Tests** | Run `node scripts/run-all-tests.mjs` (45 suites, 740 tests); confirm zero regressions. | **LOCKED (STEP 19)** |
| **20** | **Capture Sanitized Evidence Without Exposing Secrets** | Append sanitized audit log entry; generate execution proof report; zero credentials exposed. | **LOCKED (STEP 20)** |

---

## 3. Product Owner Authorization Record Specification

To satisfy Step 13 and Step 14, the Product Owner must provide the following signed JSON record:

```json
{
  "approvedBy": "<Full Name of Product Owner>",
  "approvedAt": "2026-11-28T16:55:00.000Z",
  "approvedManifestSha256": "f55231159389f9d5549713ee83c783c1c7130dc7454058c8195140ae529899ea",
  "migrationSetCount": 10,
  "targetProjectRef": "rlqrtbjynaihdspbqtce",
  "targetRegion": "ap-southeast-1",
  "commercialGateEnforced": false,
  "explicitStatement": "I AUTHORIZE MIGRATION EXECUTION FOR AUROMASTI"
}
```

### Strict Validity Rules Enforced by Code:
1. `approvedAt` must be within **60 minutes** of execution time (`executeRemoteMigrations()`).
2. Preflight evidence timestamp must be within **30 minutes** of execution time.
3. `approvedManifestSha256` must match the dynamically recomputed manifest hash exactly.
4. `targetProjectRef` must strictly equal `rlqrtbjynaihdspbqtce`.
5. `migrationSetCount` must strictly equal `10`.

---

## 4. Attestation of Non-Execution of Steps 16–20

In strict adherence to the non-negotiable execution boundaries:
> **STEPS 16 THROUGH 20 HAVE NOT BEEN PERFORMED IN THIS TASK.**  
> - No remote migrations have been executed.  
> - No DDL or DML has been applied to the hosted database.  
> - The database remains in its verified `CLEAN_INITIAL_STATE`.  
> - Execution remains strictly locked until the Product Owner signs and delivers the approval record.
