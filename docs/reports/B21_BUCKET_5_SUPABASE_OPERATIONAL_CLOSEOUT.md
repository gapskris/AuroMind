# B21 — Milestone Bucket 5: Supabase Operational Closeout Report

**Document Reference:** `docs/reports/B21_BUCKET_5_SUPABASE_OPERATIONAL_CLOSEOUT.md`  
**Milestone:** B21 — Bucket 5: Staging Deployment, Live E2E Acceptance & Operational Closeout  
**Project:** AuroMasti v2.0.0 Beta  
**Workspace:** `C:\AuroMindPortal`  
**Branch:** `dev/studio-integration`  
**Supabase Project:** `rlqrtbjynaihdspbqtce` (`ap-southeast-1`)  
**Date:** November 28, 2026  
**Status:** COMPLETE & VERIFIED

---

## 1. Executive Summary

This report establishes the complete operational closeout of the Supabase infrastructure layer for AuroMasti v2.0.0 Beta. All 10 canonical database migrations are deployed and synchronized on the live Supabase project `rlqrtbjynaihdspbqtce` in AWS `ap-southeast-1`. Row Level Security (RLS) is active on all 15 public application tables. Storage buckets `avatars` and `user-artwork` are fully provisioned as private buckets with 8 active owner-isolation policies. The storage deletion queue worker is fully established and operational.

---

## 2. Remote Database Baseline & Verification

### 2.1 Applied Migration Ledger
Inspection of `supabase_migrations.schema_migrations` confirms exactly 10 applied canonical migrations with zero drift:

| Sequence | Version Timestamp | Migration Name | Applied Status |
| :---: | :--- | :--- | :---: |
| 1 | `20261120000001` | `core_schema` | SYNCHRONIZED |
| 2 | `20261120000002` | `rls_policies` | SYNCHRONIZED |
| 3 | `20261120000003` | `functions_triggers` | SYNCHRONIZED |
| 4 | `20261120000004` | `indexes_constraints` | SYNCHRONIZED |
| 5 | `20261120000005` | `seed_data` | SYNCHRONIZED |
| 6 | `20261120000006` | `hardening_search_path` | SYNCHRONIZED |
| 7 | `20261120000007` | `audit_logging` | SYNCHRONIZED |
| 8 | `20261120000008` | `maintenance_routines` | SYNCHRONIZED |
| 9 | `20261120000009` | `performance_tuning` | SYNCHRONIZED |
| 10 | `20261123000002` | `storage_policies` | SYNCHRONIZED |

### 2.2 Table Inventory & RLS Status
All 15 expected application tables in `public` schema have Row Level Security enabled (`rowsecurity = true`):
1. `profiles` (RLS active)
2. `guest_links` (RLS active)
3. `user_preferences` (RLS active)
4. `game_saves` (RLS active)
5. `game_sessions` (RLS active)
6. `game_analytics` (RLS active)
7. `artwork` (RLS active)
8. `artwork_versions` (RLS active)
9. `achievements` (RLS active)
10. `user_achievements` (RLS active)
11. `entitlements` (RLS active)
12. `user_entitlements` (RLS active)
13. `audit_log` (RLS active)
14. `telemetry_events` (RLS active)
15. `storage_deletion_queue` (RLS active)

### 2.3 Function Search Path Hardening
All schema functions are explicitly hardened with:
`SET search_path = public, extensions;`
preventing search_path hijacking attacks.

---

## 3. Storage Provisioning & Isolation Matrix

### 3.1 Provisioned Buckets
- `avatars`: Private (`public = false`), 512 KiB limit, MIME types `image/png`, `image/jpeg`, `image/webp`.
- `user-artwork`: Private (`public = false`), 5 MiB limit, MIME types `image/png`, `image/webp`, `application/json`.
- `mandala-cloud-sync`: **DOES NOT EXIST** (Confirmed permanently absent per ADR-06/ADR-07).

### 3.2 Live Storage Policies (8 Total)
Verified on `storage.objects`:
1. `avatars_owner_select` (Authenticated, folder matches `auth.uid()`)
2. `avatars_owner_insert` (Authenticated, folder matches `auth.uid()`, owner check)
3. `avatars_owner_update` (Authenticated, folder matches `auth.uid()`, owner check)
4. `avatars_owner_delete` (Authenticated, folder matches `auth.uid()`)
5. `artwork_owner_select` (Authenticated, folder matches `auth.uid()`)
6. `artwork_owner_insert` (Authenticated, folder matches `auth.uid()`, owner check)
7. `artwork_owner_update` (Authenticated, folder matches `auth.uid()`, owner check)
8. `artwork_owner_delete` (Authenticated, folder matches `auth.uid()`)

Path traversal defense `name !~ '(^|/)\.\.(/|$)'` is enforced across all 8 policies.

---

## 4. Storage Deletion Queue & Scheduled Processor

- Database table `storage_deletion_queue` stores pending deletions.
- Script `scripts/process-storage-deletion-queue.mjs` executes batch deletions using `FOR UPDATE SKIP LOCKED` bounded concurrency (LIMIT 50) and exponential backoff retry caps.
- GitHub Actions workflow `.github/workflows/storage-deletion-worker.yml` executes this processor hourly (`cron: '0 * * * *'`) under the `storage-worker` concurrency group.

---

## 5. Operational Sign-Off

- [x] Database migrations fully synchronized (10/10).
- [x] RLS enabled across 100% of application tables.
- [x] Storage buckets provisioned as private; RLS owner policies verified.
- [x] Deletion queue processor workflow committed.
