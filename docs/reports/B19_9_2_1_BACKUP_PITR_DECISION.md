# AuroMasti v2.0.0 Beta — Backup & Point-in-Time Recovery (PITR) Decision Framework

**Milestone:** B19.9.2.1 (Bucket 2.1)  
**Project:** AuroMasti (formerly AuroMind)  
**Workspace:** `C:\AuroMindPortal`  
**Target Project:** `rlqrtbjynaihdspbqtce` (ap-southeast-1)  
**Target Release:** Version 2.0.0 Beta (Target Deadline: November 30, 2026)  
**Evaluation Boundary:** ZERO LIVE MUTATIONS — ZERO PRIVILEGE ESCALATION REQUESTS  

---

## 1. Executive Summary & Purpose

This document resolves the operational and governance decision regarding Supabase database backup and Point-in-Time Recovery (PITR) verification prior to remote migration authorization.

It evaluates what can be verified programmatically through existing read-only credentials, establishes the exact manual Dashboard inspection runbook for project administrators, and provides a risk-based readiness decision across the three deployment milestones:
1. **Milestone 1**: Initial schema migration into a confirmed empty database.
2. **Milestone 2**: Staging integration and end-to-end smoke testing.
3. **Milestone 3**: Production live user onboarding.

---

## 2. Granular Classification of Provider Capabilities

In accordance with release engineering standards, provider capabilities are strictly segregated based on empirical evidence. Capabilities are **never inferred** from marketing plan names or theoretical entitlements.

| Capability Dimension | Read-Only API Evidence | Evaluation Classification | Technical Basis & Limitation |
|:---|:---:|:---:|:---|
| **Plan / PITR Eligibility** | `GET /v1/projects/rlqrtbjynaihdspbqtce` $\rightarrow$ 200 OK | **`NOT_VERIFIED`** | Basic project metadata endpoint returns `id`, `name`, `status`, and `region`, but omits billing tier (`plan`). Cannot infer Pro vs Free without org billing read scope. |
| **Backup Schedule** | `GET /database/backups` $\rightarrow$ **HTTP 403 Forbidden** | **`NOT_VERIFIED`** | Personal Access Token lacks `backups_read` IAM scope (`missing_permissions: ["backups_read"]`). Automated backup frequency cannot be verified via API. |
| **WAL Archiving** | Unexposed on Session Pooler port 5432 | **`NOT_VERIFIED`** | Underlying continuous WAL archiving status (`archive_mode`, `pg_stat_archiver`) is unreadable to standard application roles over transaction/session poolers. |
| **Latest Available Recovery Point** | Forbidden (HTTP 403) | **`NOT_VERIFIED`** | Exact timestamp and availability of most recent snapshot cannot be retrieved via API. |
| **Retention Period** | Forbidden (HTTP 403) | **`NOT_VERIFIED`** | Standard Pro retention is 7 days; Free tier retains no continuous snapshots. Cannot be confirmed via API. |
| **Restore Procedure (Tooling)** | Local Script & AST Analyzer | **`LOCALLY_VERIFIED`** | `scripts/restore-database.mjs` implements multi-indicator production safety guards, manifest validation, transaction compatibility checks, and credential masking (verified by test suite `b19-5-10`). |
| **Initial Catalog Clean State** | Session Pooler Catalog Query | **`LIVE_VERIFIED`** | `supabase inspect db table-stats` and `supabase migration list --remote` prove that the remote database contains **0 public tables** and **0 applied migrations**. |

---

## 3. Product Owner / Admin Dashboard Inspection Runbook

To establish empirical truth without requesting a broader or higher-privileged Personal Access Token, the Product Owner or Organization Administrator should execute the following 4-step manual inspection in the Supabase Management Console:

```
Step 1: Authenticate to the Supabase Dashboard
        URL: https://supabase.com/dashboard/project/rlqrtbjynaihdspbqtce

Step 2: Navigate to Database Backups
        Path: Project Settings (gear icon) -> Database -> Backups
        Direct URL: https://supabase.com/dashboard/project/rlqrtbjynaihdspbqtce/settings/database

Step 3: Inspect Scheduled Backups
        - Check if "Daily Backups" are active.
        - Record the timestamp of the latest completed backup snapshot.
        - Record the retention window (e.g., "7 days").

Step 4: Inspect Point-in-Time Recovery (PITR)
        - Check if "Point in time recovery" is toggled ON.
        - If enabled, note the earliest available recovery time.
        - If disabled, note whether the project plan supports enabling PITR (Pro plan required).
```

---

## 4. Risk-Based Decision Across Release Milestones

A common release management error is treating backup verification as an undifferentiated binary gate for all phases. We evaluate the risk profile of each milestone independently:

### 4.1 Milestone 1: Initial Schema Migration (Session Pooler Push)
- **Target Context:** Applying 10 canonical DDL migrations to the hosted database.
- **Pre-Migration Data State:** Affirmatively verified as **`CLEAN_INITIAL_STATE`**. Exactly **0 user tables** and **0 player records** exist in the `public` schema.
- **Data Loss Risk:** **ZERO RISK OF USER DATA LOSS.** Initial DDL creates empty tables, functions, triggers, and storage buckets. There is no pre-existing user data to corrupt, truncate, or overwrite.
- **Failure Blast Radius:** If a migration fails midway (e.g. at Migration 4), PostgreSQL rolls back the failed transaction. Migrations 1–3 remain in clean empty state, and the ledger reflects this with zero data loss.
- **Milestone Gate Decision:** **PROCEED TO EXECUTE.** Backup verification is **NOT a hard prerequisite** for applying initial schema to a confirmed empty database.

### 4.2 Milestone 2: Staging Integration & E2E Verification
- **Target Context:** Connecting Cloudflare Pages preview (`staging.auromasti.pages.dev`) to the Supabase backend and running automated E2E tests.
- **Data State:** Ephemeral synthetic test data generated by test accounts (`guest_<uuid>` and test user accounts).
- **Data Loss Risk:** **VERY LOW.** Test data is ephemeral and can be recreated on demand.
- **Milestone Gate Decision:** **PROCEED TO INTEGRATE.** Ephemeral staging data does not require production PITR guarantees.

### 4.3 Milestone 3: Production Live User Onboarding
- **Target Context:** DNS apex cutover (`auromasti.com`) and accepting real player registrations, achievements, and cloud artwork backups.
- **Data State:** Genuine player profiles, game saves, and user data.
- **Data Loss Risk:** **CRITICAL.** Any database corruption, accidental deletion, or hosting outage would cause irreversible loss of real user data without backups.
- **Milestone Gate Decision:** **HARD PREREQUISITE (BLOCKING).** Automated daily backups and snapshot availability **MUST be verified** by the Product Owner in the Dashboard before activating live production user onboarding.

---

## 5. Summary Recommendation

1. **Authorize Phase 2 (Initial Database Migration Push)**:  
   Do not block the initial schema deployment on API backup permissions. The confirmed `CLEAN_INITIAL_STATE` guarantees zero data loss risk.
2. **Execute Dashboard Runbook Prior to Phase 6 (Production Cutover)**:  
   The Product Owner executes the Dashboard Inspection Runbook (Section 3) during the staging validation window (Phase 5), recording confirmation before the live production apex domain is enabled.
3. **Preserve Current Token Security**:  
   Do not elevate token scopes or generate broad service-role keys. The current read-only token adheres strictly to the principle of least privilege.
