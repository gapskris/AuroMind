# AuroMasti v2.0.0 Beta — Migration Integrity Audit & Guarded Execution Plan

**Milestone:** B19.9.2 (Bucket 2)  
**Project:** AuroMasti (formerly AuroMind)  
**Workspace:** `C:\AuroMindPortal`  
**Target Project:** `rlqrtbjynaihdspbqtce` (ap-southeast-1)  
**Evaluation Date:** November 28, 2026  
**Canonical Manifest SHA-256:** `f55231159389f9d5549713ee83c783c1c7130dc7454058c8195140ae529899ea`  
**Target Release:** Version 2.0.0 Beta (Target Deadline: November 30, 2026)  
**Commercial Gate:** `COMMERCIAL_GATE_ENABLED=false` (Strictly Preserved)  
**Execution Posture:** PREFLIGHT VERIFIED — LOCKED AWAITING PRODUCT OWNER APPROVAL  

---

## 1. Executive Summary

This document presents the definitive chronological audit of all 10 canonical database migrations for AuroMasti v2.0.0 Beta and defines the guarded execution plan for Phase 2 remote deployment.

### Key Audit Findings:
- **10/10 Migrations Verified (`LOCALLY_VERIFIED`)**: All migration files in `supabase/migrations/` match the canonical manifest `f55231159389...` in strict lexical timestamp sequence.
- **Remote Initial State (`LIVE_VERIFIED`)**: Remote PostgreSQL catalog is in `CLEAN_INITIAL_STATE` (0 applied migrations, 10 pending, 0 public user tables).
- **Zero Unconditional Data-Loss SQL (`LOCALLY_VERIFIED`)**: No unconditional `DROP TABLE`, `TRUNCATE`, `DROP DATABASE`, or `DROP SCHEMA` statements exist.
- **Search-Path Hardening (`LOCALLY_VERIFIED`)**: All `SECURITY DEFINER` functions enforce `SET search_path = pg_catalog, public`.
- **100% RLS Coverage (`LOCALLY_VERIFIED`)**: All 15 public tables (14 logged + 1 unlogged) have Row-Level Security explicitly enabled.
- **Execution Workflow (`LOCALLY_VERIFIED` / `BLOCKED`)**: Guarded runner `executeRemoteMigrations()` enforces all 8 safety gates and fails closed without an attributable Product Owner approval.

---

## 2. Chronological Audit of All 10 Canonical Migrations

| Seq | Migration Filename | Version Timestamp | File Size | SHA-256 Checksum | Schema Objects & Key Operations | Destructive SQL Check |
|:---:|:---|:---:|:---:|:---|:---|:---:|
| **01** | `20261120000001_b5_core_schema.sql` | `20261120000001` | 17,291 B | `4d9374cfde43b2ec8fec14ff0d66934ff66b43b63f7c3a4f13388064cd574e74` | Creates extension `pgcrypto`; defines 10 core tables (`user_profiles`, `guest_identity_links`, `game_saves`, `game_save_revisions`, `entitlements`, `entitlement_audit`, `purchase_receipts`, `telemetry_events`, `remote_config`, `owner_roles`); 10 RLS enables; 15 policies; trigger `update_user_profiles_updated_at`. | **NONE** (Safe) |
| **02** | `20261120000002_b8_rate_limiting.sql` | `20261120000002` | 3,625 B | `93690d69e23f7409ec0cb6c16d3bbd2e0281902d30c145f7c6cf345a6562b143` | Defines table `telemetry_rate_limits`; function `check_telemetry_rate_limit(client_id, max_events, window_sec)`. | **NONE** (Safe) |
| **03** | `20261120000003_b13a_telemetry_rls_hardening.sql` | `20261120000003` | 1,840 B | `5ae748ca2cdf6bcb027651c602d590b73b71d44ec80f49decf31b5025688746d` | Hardens telemetry RLS; locks inserts to authenticated/anon with rate-limiting check; prevents client read of raw events. | **NONE** (Safe) |
| **04** | `20261120000004_b13b_telemetry_retention.sql` | `20261120000004` | 7,438 B | `6be4fe7b122555e84fe6120dc2ed2c042d6a1a694e2c1cf4e39cb3784eaded5e` | Defines table `telemetry_daily_aggregates`; functions `rollup_telemetry_aggregates()`, `prune_expired_telemetry(retention_days)`. | **NONE** (Safe) |
| **05** | `20261122000001_b18c_profile_rls_separation.sql` | `20261122000001` | 4,401 B | `f0084584508c9f649e4a8199f41c41f050402797297afecec1d517c02f37bbd8` | Separates public profile from private settings; creates table `user_private_settings`; migrates private columns; RLS policies. | **NONE** (Safe) |
| **06** | `20261122000002_b18c_telemetry_token_bucket.sql` | `20261122000002` | 4,279 B | `938649adecec6d5ae5b20c0979978bacf2441431fb20447dbc021eb9d7b66e89` | Creates `UNLOGGED TABLE public.telemetry_rate_buckets` (avoids WAL bloat) and `storage_deletion_queue`; function `consume_telemetry_token()`. | **NONE** (Safe) |
| **07** | `20261122000003_b18c_telemetry_search_path_hardening.sql` | `20261122000003` | 3,164 B | `10ebff8ccbf0112e65cd58ed66df683e35560eb26e2b43bf2b68241bc55e8b33` | Hardens search path on `consume_telemetry_token()`: `SET search_path = pg_catalog, public`. | **NONE** (Safe) |
| **08** | `20261122000004_b18d_telemetry_token_bucket_input_validation.sql` | `20261122000004` | 7,303 B | `dfdba762681b1ba5002bdc9ed4e8ad2b75fcb7f3644285decc73b68e89832fd3` | Adds parameter boundary validation (`capacity > 0`, `refill_rate > 0`) to `consume_telemetry_token()`. | **NONE** (Safe) |
| **09** | `20261123000001_b19_5_05_db_integrity_and_rls_hardening.sql` | `20261123000001` | 35,602 B | `cfc36b11dbf5df5c5ef9f030580a9f227ceb639b4ccf929d88555551a157f7b8` | Drops deprecated columns (`DROP COLUMN IF EXISTS preferences, analytics_opt_in, cloud_sync_opt_in` on `user_profiles` moved to `user_private_settings`); hardens FKs with `ON DELETE CASCADE`; enforces 100% RLS on all 15 public tables; hardens search path on all `SECURITY DEFINER` functions. | **CONDITIONAL SAFE** (Drop column if exists on empty table; 0 data loss) |
| **10** | `20261123000002_b19_5_06_storage_buckets_and_rls.sql` | `20261123000002` | 5,735 B | `bc6b04da5572076f10969a0874de5bfe89bfc77e8546ba13c991bc651549ef63` | Provisions storage buckets `avatars`, `user-artwork`, and `mandala-cloud-sync`; establishes storage RLS policies (`(storage.foldername(name))[1] = auth.uid()::text`). | **NONE** (Safe) |

---

## 3. Remote Clean Initial State Verification (`LIVE_VERIFIED`)

On November 28, 2026, the remote database was queried via the Session Pooler:
- **Connection Host**: `aws-1-ap-southeast-1.pooler.supabase.com:5432`
- **TLS Configuration**: TLS 1.3 `TLS_AES_256_GCM_SHA384`, `sslmode=verify-full`, Root CA `prod-ca-2021.crt`
- **Credential Delivery**: In-memory `PGPASSWORD` via Node child process runner; zero CLI argument leakage.

### Verification Results:
1. `supabase migration list --remote`:
   ```
   • 20261120000001_b5_core_schema.sql (pending)
   • 20261120000002_b8_rate_limiting.sql (pending)
   • 20261120000003_b13a_telemetry_rls_hardening.sql (pending)
   • 20261120000004_b13b_telemetry_retention.sql (pending)
   • 20261122000001_b18c_profile_rls_separation.sql (pending)
   • 20261122000002_b18c_telemetry_token_bucket.sql (pending)
   • 20261122000003_b18c_telemetry_search_path_hardening.sql (pending)
   • 20261122000004_b18d_telemetry_token_bucket_input_validation.sql (pending)
   • 20261123000001_b19_5_05_db_integrity_and_rls_hardening.sql (pending)
   • 20261123000002_b19_5_06_storage_buckets_and_rls.sql (pending)
   ```
   **Total Applied Remotely**: 0  
   **Total Pending**: 10  
2. `supabase inspect db table-stats`:  
   Confirmed **0 user tables** in the remote `public` schema.  
3. `supabase db push --dry-run`:  
   Simulated push succeeded with **exit code 0** and zero syntax or dependency errors.

---

## 4. Guarded Execution Workflow (`executeRemoteMigrations`)

When Product Owner authorization (`CANON-GOV-01`) is formally granted, execution proceeds through the audited programmatic runner:

```powershell
Set-Location C:\AuroMindPortal
node scripts/migration-workflow.mjs --execute
```

### Safety Enforcements in Code:
1. **Gate Verification**: `validateMigrationExecutionGate()` validates all 8 conditions.
2. **Preflight Freshness**: Re-checks that preflight inspection is $\le 30$ minutes old.
3. **Approval Expiry**: Re-checks that PO approval was granted within the last 60 minutes.
4. **Manifest Match**: Re-hashes all local migration files; aborts if mismatch against `f55231159389...`.
5. **Session Pooler Driver**: Builds the verified Session Pooler connection URL:
   `postgresql://postgres.rlqrtbjynaihdspbqtce@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=verify-full&sslrootcert=C:/AuroMindPortal/prod-ca-2021.crt`
6. **In-Memory Credential**: Injects `PGPASSWORD = env.SUPABASE_DB_PASSWORD` into child process environment without passing `--password` flag.
7. **Audit Trail Logging**: Records execution decision in [`supabase/authorization_audit.log`](file:///C:/AuroMindPortal/supabase/authorization_audit.log).

---

## 5. Post-Migration Remote Schema Verification Plan

Immediately following execution, the Release Engineer will run the canonical schema verification script against the remote instance:

```powershell
# Inspect verification SQL
Get-Content supabase/verify_remote_schema.sql
```

### Required Verification Assertions:
1. **15 Public Tables Present**:
   - 14 logged tables: `user_profiles`, `guest_identity_links`, `game_saves`, `game_save_revisions`, `entitlements`, `entitlement_audit`, `purchase_receipts`, `telemetry_events`, `remote_config`, `owner_roles`, `telemetry_rate_limits`, `telemetry_daily_aggregates`, `user_private_settings`, `storage_deletion_queue`.
   - 1 unlogged table: `telemetry_rate_buckets` (`relpersistence = 'u'`).
2. **100% RLS Coverage**:
   - Every public table must report `rowsecurity = true` in `pg_tables`.
3. **Search Path Hardening**:
   - Every `SECURITY DEFINER` function in `pg_proc` must have `proconfig` containing `search_path=pg_catalog, public`.
4. **Storage Buckets**:
   - `storage.buckets` contains `avatars`, `user-artwork`, and `mandala-cloud-sync`.

---

## 6. Partial Failure & Rollback Runbook

If any migration fails during `supabase db push`:
1. **PostgreSQL Transaction Safety**: Each individual migration runs inside an implicit transaction block. A failure in migration $V_k$ causes PostgreSQL to roll back migration $V_k$.
2. **Ledger Truth**: `supabase migration list --remote` will accurately report migrations $V_1 \dots V_{k-1}$ as applied and $V_k$ as unapplied.
3. **DO NOT Execute Blanket Repair**: Running `supabase migration repair` without object verification is strictly prohibited.
4. **Emergency Clean Recovery**: Because this is pre-production initial deployment with zero live user data, if unexpected corruption occurs, the DBA can drop public schema tables and re-execute clean push.
