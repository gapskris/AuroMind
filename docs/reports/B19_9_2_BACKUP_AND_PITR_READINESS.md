# AuroMasti v2.0.0 Beta — Supabase Backup & Point-in-Time Recovery (PITR) Assessment

**Milestone:** B19.9.2 (Bucket 2)  
**Project:** AuroMasti (formerly AuroMind)  
**Workspace:** `C:\AuroMindPortal`  
**Target Project:** `rlqrtbjynaihdspbqtce` (ap-southeast-1)  
**Evaluation Date:** November 28, 2026  
**Target Release:** Version 2.0.0 Beta (Target Deadline: November 30, 2026)  
**Read-Only Provider Evidence Mode:** ZERO LIVE MUTATIONS — ZERO RESTORE INVOCATIONS  

---

## 1. Executive Summary & Core Finding

Under Work Package 2 of Bucket 2, an evidence-based audit of Supabase backup, snapshot, and Point-in-Time Recovery (PITR) readiness was conducted using read-only provider queries and Management API probes.

### Critical Provider Findings:
1. **Management API Project Status (`LIVE_VERIFIED`)**:  
   Probing `https://api.supabase.com/v1/projects/rlqrtbjynaihdspbqtce` returned **HTTP 200 OK**:
   ```json
   {
     "id": "rlqrtbjynaihdspbqtce",
     "name": "AuroMasti",
     "region": "ap-southeast-1",
     "status": "ACTIVE_HEALTHY"
   }
   ```
2. **Management API Backups Probe (`BLOCKED_ON_PERMISSION` / `NOT_VERIFIED`)**:  
   Probing `https://api.supabase.com/v1/projects/rlqrtbjynaihdspbqtce/database/backups` returned **HTTP 403 Forbidden**:
   ```json
   {
     "message": "Missing required permission(s): backups_read",
     "error": {
       "missing_permissions": ["backups_read"]
     }
   }
   ```
3. **Governance Determination**:  
   In strict adherence to the project instruction:  
   > *"If provider evidence cannot establish a claim, mark it NOT VERIFIED. Do not infer backup readiness from plan entitlement alone."*  
   
   All provider-managed backup capabilities (PITR, automated daily snapshots, retention window, and WAL archiving) are formally classified as **`NOT_VERIFIED`**.

---

## 2. Itemized Backup & PITR Capability Matrix

| Capability Dimension | Provider Evidence Status | Observed Provider Response | Evaluation Classification | Residual Risk & Owner Action |
|:---|:---:|:---|:---:|:---|
| **Supabase Plan & PITR Eligibility** | Absent in API payload | `GET /v1/projects/rlqrtbjynaihdspbqtce` returned HTTP 200 without exposing billing plan. | **`NOT_VERIFIED`** | Cannot infer Pro vs Free plan. Pro/Enterprise required for PITR. |
| **PITR Configuration & Status** | Forbidden (HTTP 403) | `GET /database/backups` returned `missing_permissions: ["backups_read"]`. | **`NOT_VERIFIED`** | **OWNER ACTION**: Verify PITR toggle in Supabase Dashboard (`Database -> Backups`). |
| **WAL Archiving Status** | Unexposed via API | Access restricted; cannot query `pg_stat_archiver` over pooler. | **`NOT_VERIFIED`** | Underlying continuous WAL archiving status cannot be confirmed via API. |
| **Automated Backup / Snapshot Availability** | Forbidden (HTTP 403) | Token lacks `backups_read` scope. | **`NOT_VERIFIED`** | **OWNER ACTION**: Confirm daily snapshot schedule exists in Dashboard. |
| **Latest Available Recovery Point** | Forbidden (HTTP 403) | Cannot retrieve backup timestamps. | **`NOT_VERIFIED`** | Exact timestamp of latest snapshot unconfirmed via API. |
| **Backup Retention Period** | Forbidden (HTTP 403) | Standard is 7 days (Pro) or unmanaged (Free); unverified. | **`NOT_VERIFIED`** | Formal retention duration unconfirmed via API. |
| **Restore Capability & Procedure** | Local Script & AST | Implemented in `scripts/restore-database.mjs`; tested in `b19-5-10`. | **`LOCALLY_VERIFIED`** | Local restore tooling verified; remote cloud restore unexecuted. |
| **Pre-Migration Data Loss Risk** | Remote Schema Query | `inspect db table-stats` returned 0 public tables. | **`LIVE_VERIFIED`** | **ZERO RISK**: Remote database has no existing user tables to overwrite or corrupt. |

---

## 3. Detailed Technical Analysis

### 3.1 Personal Access Token Permission Scope
The configured `SUPABASE_ACCESS_TOKEN` is authenticated and authorized to perform:
- Project discovery (`GET /v1/projects/rlqrtbjynaihdspbqtce` $\rightarrow$ 200 OK)
- Migration ledger queries (`supabase migration list --remote`)
- Non-mutating migration dry-runs (`supabase db push --dry-run`)
- Database inspection (`supabase inspect db table-stats`)

However, the token was generated without the `backups_read` scope, causing the Supabase IAM gateway to reject backup inspection requests with HTTP 403. Consequently, continuous WAL archiving and automated snapshot retention cannot be established through programmatic API queries alone.

### 3.2 Pre-Migration Data Safety Context
While cloud backup automation is `NOT_VERIFIED` via the API, the operational risk of executing initial database migrations is strictly bounded by the remote catalog state:
- The remote database was affirmatively verified as **`CLEAN_INITIAL_STATE`**.
- Exactly **0 user tables** and **0 user records** exist in the hosted `public` schema.
- Applying migrations 1 through 10 creates new schema structures; it does **not** truncate, drop, or overwrite pre-existing user data.
- If a migration failure occurs during initial push, PostgreSQL rolls back the failed transaction, leaving the database either in its clean initial state or with a verified partial subset.

---

## 4. Disaster Recovery Targets & SLA Truth

In accordance with architectural standards established in B19.5-10, Recovery Point Objective (RPO) and Recovery Time Objective (RTO) targets are documented with strict truthfulness:

| Layer / Subsystem | Failure Scenario | Documented Recovery Procedure | RPO Status | RTO Status |
|:---|:---|:---|:---:|:---:|
| **Client-Side Data (Sankalpa Vault / Game Saves)** | Network outage, browser crash, cloud disconnect | Local IndexedDB persistence + AES-256-GCM encrypted backup envelopes | **RPO = 0 seconds** (100% local persistence) | **RTO = Instant (0 s)** (Local-first architecture) |
| **Local Backup Tooling (`scripts/backup-database.mjs`)** | Host disaster recovery | Native SQL dump with privacy filter (excluding auth/secrets) | **`UNVERIFIED_TARGET`** (Target: 24h) | **`UNVERIFIED_TARGET`** (Target: 15m) |
| **Hosted Supabase PostgreSQL** | Remote database instance crash | Provider-managed point-in-time restore or snapshot rollback | **`NOT_VERIFIED`** (Blocked on API permissions) | **`NOT_VERIFIED`** (Blocked on API permissions) |

---

## 5. Required Owner Actions Prior to Live Commercial Traffic

To close the `NOT_VERIFIED` gap before general production release:

1. **Dashboard Inspection**:
   - Log in to the Supabase Dashboard: `https://supabase.com/dashboard/project/rlqrtbjynaihdspbqtce/settings/database`.
   - Navigate to **Backups**.
   - Confirm whether **Point-in-Time Recovery (PITR)** is enabled or if daily automated backups are scheduled.
   - If PITR is available, note the retention window (typically 7 days on Pro).
2. **Access Token Permission Upgrade (Optional)**:
   - If programmatic backup verification is required in CI/CD, generate a new Personal Access Token with the `backups_read` scope included.
   - Update `SUPABASE_ACCESS_TOKEN` in `.env.local`.
3. **Production Acknowledgment**:
   - The Product Owner must acknowledge that initial database migrations are safe to push due to `CLEAN_INITIAL_STATE`, but automated backups must be confirmed in the dashboard before onboarding live user data.
