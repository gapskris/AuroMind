# B19.9.6 — Post-Migration Live Database Verification Report

**Project:** AuroMasti v2.0.0 Beta  
**Workstream:** Bucket 2 — Supabase Database Foundation  
**Task:** B19.9.6  
**Execution Timestamp:** November 28, 2026  
**Supabase Project Ref:** `rlqrtbjynaihdspbqtce` (`ap-southeast-1`)  
**Target Connection:** Session Pooler `aws-1-ap-southeast-1.pooler.supabase.com:5432` with TLS 1.3 and CA verification  
**Execution Status:** **`PARTIALLY APPLIED (9/10 Migrations Applied, All 15 Public Tables Verified, Storage Migration 10 Rolled Back on SQLSTATE 42501)`**

---

## 1. Migration Ledger Live Evidence

The remote migration history on the live Supabase instance was queried via `supabase migration list` targeting the Session Pooler:

| Migration File | Version Timestamp | Live Ledger Status | Execution Note |
|---|---|---|---|
| `20261120000001_b5_core_schema.sql` | `20261120000001` | **`APPLIED`** | Baseline core tables, pgcrypto, core RLS policies. |
| `20261120000002_b8_rate_limiting.sql` | `20261120000002` | **`APPLIED`** | Telemetry rate limits table and sliding window RPCs. |
| `20261120000003_b13a_telemetry_rls_hardening.sql` | `20261120000003` | **`APPLIED`** | Hardened telemetry RLS and isolation policies. |
| `20261120000004_b13b_telemetry_retention.sql` | `20261120000004` | **`APPLIED`** | Daily telemetry aggregates table and retention pruning. |
| `20261122000001_b18c_profile_rls_separation.sql` | `20261122000001` | **`APPLIED`** | Private user settings table and profile isolation. |
| `20261122000002_b18c_telemetry_token_bucket.sql` | `20261122000002` | **`APPLIED`** | Rate buckets, storage deletion queue tables, RPCs. |
| `20261122000003_b18c_telemetry_search_path_hardening.sql` | `20261122000003` | **`APPLIED`** | Hardened search_path on database functions. |
| `20261122000004_b18d_telemetry_token_bucket_input_validation.sql` | `20261122000004` | **`APPLIED`** | Input validation on token bucket procedures. |
| `20261123000001_b19_5_05_db_integrity_and_rls_hardening.sql` | `20261123000001` | **`APPLIED`** | Comprehensive RLS, guest linking upsert, and FK hardening. |
| `20261123000002_b19_5_06_storage_buckets_and_rls.sql` | `20261123000002` | **`PENDING`** | **ROLLED BACK ATOMICALLY**. Halted at statement 0 on `SQLSTATE 42501` (`must be owner of table objects`). |

**Summary:** 9 of 10 migrations are recorded and committed in `supabase_migrations`. 1 migration is pending.

---

## 2. Public Schema & Application Tables Live Verification

Affirmative live schema inspection via `inspect db table-stats` through the Session Pooler verified that **all 15 public application tables** were successfully created and exist on the live database:

1. `public.user_profiles` (RLS Enabled)
2. `public.user_private_settings` (RLS Enabled)
3. `public.guest_identity_links` (RLS Enabled)
4. `public.game_saves` (RLS Enabled)
5. `public.game_save_revisions` (RLS Enabled)
6. `public.entitlements` (RLS Enabled)
7. `public.entitlement_audit` (RLS Enabled)
8. `public.purchase_receipts` (RLS Enabled)
9. `public.telemetry_events` (RLS Enabled)
10. `public.telemetry_rate_limits` (RLS Enabled)
11. `public.telemetry_daily_aggregates` (RLS Enabled)
12. `public.telemetry_rate_buckets` (RLS Enabled)
13. `public.storage_deletion_queue` (RLS Enabled)
14. `public.remote_config` (RLS Enabled)
15. `public.owner_roles` (RLS Enabled)

**Table Count:** Exactly 15 public application tables.  
**RLS Status:** 100% of public tables have Row-Level Security enabled.  
**Search Path Status:** Functions have explicit pinned `search_path = pg_catalog, public`.

---

## 3. Root Cause Analysis of Migration 10 Failure

### Execution Output
```
ERROR: must be owner of table objects (SQLSTATE 42501)
At statement: 0
execute 'alter table storage.objects enable row level security';
```

### Forensic Analysis
1. In Supabase's hosted architecture, the `storage.objects` table belongs to the `storage` schema and is owned by internal system role `supabase_storage_admin`.
2. The executing database connection role is `postgres` (via Session Pooler).
3. In PostgreSQL, executing `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` strictly requires that the executing role be the **owner of the table**. Even roles with table-level grants cannot alter table ownership or RLS enablement without table ownership.
4. In Supabase hosted environments, `storage.objects` **already has RLS enabled by default** upon project provisioning. Attempting an explicit `ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY` as role `postgres` raises permission error `42501`.
5. Because Migration 10 was encapsulated in a single transactional PL/pgSQL block (`do $$ begin ... end; $$`), the exception caused PostgreSQL to abort the transaction and cleanly roll back the entire migration.
6. **No Corrupt State:** No partial policies or half-provisioned bucket records were left in the database.

---

## 4. Live Storage Verification Status

- **`avatars` Bucket:** Not provisioned on hosted storage (rolled back).
- **`user-artwork` Bucket:** Not provisioned on hosted storage (rolled back).
- **`mandala-cloud-sync` Bucket:** Confirmed nonexistent.
- **Storage Subsystem Classification:** **`STORAGE_PROVISIONING_PENDING`**.
- **Remediation Path:** Storage bucket provisioning and owner-folder policies will be completed either:
  1. Via the Supabase Web Dashboard UI / Storage Management API; or
  2. By a targeted surgical migration that omits the redundant `ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY` statement.
