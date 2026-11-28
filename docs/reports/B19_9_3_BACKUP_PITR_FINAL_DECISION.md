# AuroMasti v2.0.0 Beta — Backup, PITR & Disaster Recovery Final Decision

**Milestone:** B19.9.3 (Bucket 2 Closeout)  
**Project:** AuroMasti (formerly AuroMind)  
**Workspace:** `C:\AuroMindPortal`  
**Target Project:** `rlqrtbjynaihdspbqtce` (ap-southeast-1)  
**Evaluation Date:** November 28, 2026  
**Target Release:** Version 2.0.0 Beta (Target Deadline: November 30, 2026)  
**Read-Only Provider Evidence Mode:** ZERO LIVE MUTATIONS — ZERO PRIVILEGE ESCALATIONS  

---

## 1. Executive Summary & Core Decision

This document establishes the authoritative, evidence-based disaster recovery policy for AuroMasti v2.0.0 Beta.

### Key Decisions:
1. **API Probe Status**:  
   Probing `https://api.supabase.com/v1/projects/rlqrtbjynaihdspbqtce/database/backups` returned **HTTP 403 Forbidden** (`missing_permissions: ["backups_read"]`). In strict compliance with release governance, **no provider backup capabilities are inferred from project health**.
2. **Phase 2 (Initial DDL Migration) Gate Decision: PROCEED**:  
   The remote database is affirmatively verified in **`CLEAN_INITIAL_STATE`** (0 user tables, 0 records). Pushing initial schema DDL carries **zero risk of user data loss**. Pre-migration backup is **NOT a mandatory blocker** for initial schema creation on an empty database.
3. **Phase 6 (Live Production User Cutover) Gate Decision: BLOCKING (MANDATORY)**:  
   Before routing real user traffic to `auromasti.com`, the Product Owner or Organization Administrator **MUST verify** automated daily backups or PITR in the Supabase Dashboard.

---

## 2. Definitive Status Matrix of Provider Capabilities

| Capability Dimension | Provider API Evidence | Evaluation Classification | Technical Basis & Limitation |
|:---|:---:|:---:|:---|
| **Supabase Plan Tier** | `GET /v1/projects/rlqrtbjynaihdspbqtce` $\rightarrow$ 200 OK | **`NOT_VERIFIED`** | Endpoint returns project metadata (`ACTIVE_HEALTHY`), but omits billing tier. Cannot infer Free vs Pro plan via API. |
| **Backup Availability & Frequency** | `GET /database/backups` $\rightarrow$ HTTP 403 Forbidden | **`NOT_VERIFIED`** | Token lacks `backups_read` scope. Automated backup schedule cannot be established via API. |
| **PITR Eligibility & Status** | Forbidden (HTTP 403) | **`NOT_VERIFIED`** | Cannot determine whether Point-in-Time Recovery is active via API. |
| **Retention Window** | Forbidden (HTTP 403) | **`NOT_VERIFIED`** | Standard Pro retention is 7 days; Free tier has no automated PITR. Unverified via API. |
| **Latest Available Recovery Point** | Forbidden (HTTP 403) | **`NOT_VERIFIED`** | Timestamp of latest snapshot cannot be retrieved via API. |
| **WAL Archiving Status** | Unexposed on Session Pooler | **`NOT_VERIFIED`** | Underlying continuous WAL archiving status (`pg_stat_archiver`) is unreadable to standard application roles. |
| **Cloud Test Restore Execution** | Untriggered | **`NOT_APPLICABLE`** | No cloud restore has been executed or tested against `rlqrtbjynaihdspbqtce` (mutations prohibited). |
| **Local Restore Tooling** | Verified by Node Test Runner | **`VERIFIED`** | `scripts/restore-database.mjs` passes all 20 tests in `b19-5-10-backup-disaster-recovery.test.js`. |
| **Initial Empty-DB Clean Baseline** | Verified over Session Pooler | **`VERIFIED`** | `table-stats` confirms 0 public tables; `migration list` confirms 0 applied migrations. |

---

## 3. Product Owner / Admin Dashboard Inspection Runbook

To establish empirical truth without requesting elevated Personal Access Tokens, the Product Owner or Organization Administrator executes this 4-step inspection:

```
Step 1: Open the Supabase Management Console
        URL: https://supabase.com/dashboard/project/rlqrtbjynaihdspbqtce

Step 2: Navigate to Database Backups Settings
        Direct URL: https://supabase.com/dashboard/project/rlqrtbjynaihdspbqtce/settings/database
        Section: "Database Backups"

Step 3: Inspect Scheduled Backups
        [ ] Check if "Daily Backups" are active.
        [ ] Record the timestamp of the latest completed backup snapshot.
        [ ] Record the retention window (e.g. 7 days).

Step 4: Inspect Point-in-Time Recovery (PITR)
        [ ] Check if "Point-in-Time Recovery (PITR)" is toggled ON.
        [ ] Record earliest available recovery timestamp.
        [ ] If disabled, note whether Pro plan upgrade is required.
```

---

## 4. Mandatory Phased Safety Gates & Risk Acceptance

We differentiate between the requirements for developer migrations into an empty database and production traffic:

### 4.1 Phase 2: Initial Schema Migration (Session Pooler Push)
- **Target Context:** Applying 10 canonical DDL migrations into `rlqrtbjynaihdspbqtce`.
- **Pre-Migration Data State:** Affirmatively verified as `CLEAN_INITIAL_STATE` (0 public tables, 0 records).
- **Data Loss Risk:** **ZERO RISK OF USER DATA LOSS.** Initial DDL creates empty tables, functions, triggers, and storage buckets. There is no pre-existing user data to corrupt, truncate, or overwrite.
- **Transactional Rollback:** In the event of a migration failure, PostgreSQL transaction isolation rolls back the failed file atomically.
- **Decision:** **PROCEED TO EXECUTE.** Backup verification is **NOT a hard prerequisite** for initial schema creation on a confirmed empty database.

### 4.2 Phase 6: Live Production User Onboarding
- **Target Context:** DNS apex cutover (`https://auromasti.com`) and accepting live player registrations, achievements, and cloud saves.
- **Data State:** Genuine player profiles, game saves, and user data.
- **Data Loss Risk:** **CRITICAL.** Any database corruption, accidental deletion, or hosting outage would cause irreversible loss of real user data without backups.
- **Decision:** **HARD PREREQUISITE (BLOCKING).** Automated daily backups and snapshot availability **MUST be verified** by the Product Owner in the Dashboard before activating live production user onboarding.

---

## 5. Test Restore Capability and Requirements

- **Local Restore Capability (`VERIFIED`)**:  
  `scripts/restore-database.mjs` has been tested offline across 20 behavioral tests in `b19-5-10-backup-disaster-recovery.test.js`. It verifies manifest checksums, enforces disposable-target confirmations, blocks path traversals, and sanitizes connection credentials.
- **Cloud Restore Truth (`NOT TESTED`)**:  
  **No cloud restore has been executed or tested against the hosted Supabase project.**  
  Testing a cloud restore on Supabase requires:
  1. A separate, disposable test project (since Supabase restores replace or fork the active database).
  2. Organization administrative privileges to trigger the restore operation via the Supabase Dashboard.
  3. Pre-production staging verification.
  We explicitly state that cloud restore remains **untested on live infrastructure** to maintain complete release honesty.
