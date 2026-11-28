# AuroMasti v2.0.0 Beta — B19.9.7 Storage Provisioning Plan

**Project:** AuroMasti v2.0.0 Beta  
**Workstream:** Bucket 2 — Supabase Storage Provisioning Readiness  
**Target Project:** `rlqrtbjynaihdspbqtce` (`ap-southeast-1`)  
**Status:** **`PREPARED — AWAITING SEPARATE AUTHORIZATION`**

---

## 1. Root Cause Analysis: Migration 10 Failure

During B19.9.6, Migration 10 (`20261123000002_b19_5_06_storage_buckets_and_rls.sql`) was halted at Statement 0:

```sql
alter table storage.objects enable row level security;
```

* **Error Code:** `SQLSTATE 42501 (must be owner of table objects)`
* **Architecture Boundary:** In hosted Supabase, the `storage` schema and its internal tables (`storage.buckets`, `storage.objects`, `storage.migrations`) are provisioned and owned by the platform administrative role `supabase_storage_admin`.
* **Connecting Role:** The CLI connection through the Session Pooler or direct port connects as role `postgres`. In PostgreSQL, running `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` requires table ownership. Role `postgres` does not own `storage.objects`.
* **Redundancy:** In Supabase hosted cloud instances, `storage.objects` has Row-Level Security enabled **by default upon project creation**. Attempting to re-enable it via DDL is both unauthorized for role `postgres` and redundant.
* **Safe Halting Invariant:** In accordance with runbook B19.9.2.1, the migration pipeline immediately halted upon error. Transaction atomicity rolled back Migration 10 completely, leaving `storage.buckets` clean with zero partial records.

---

## 2. Target Storage Bucket Specifications

Two private storage buckets are specified for AuroMasti:

### 2.1. Bucket `avatars`
* **Bucket ID:** `avatars`
* **Visibility:** **Private** (`public = false`)
* **Maximum File Size:** `524288` bytes (**512 KiB**)
* **Allowed MIME Types:** `image/png`, `image/jpeg`, `image/webp`
* **Security Restriction:** **SVG is strictly prohibited** to prevent stored Cross-Site Scripting (XSS) vectors.
* **Access Model:** Strict authenticated owner-folder isolation. A user may only read, upload, update, and delete files located in their own UUID folder:
  `avatars/{auth.uid()}/...`

### 2.2. Bucket `user-artwork`
* **Bucket ID:** `user-artwork`
* **Visibility:** **Private** (`public = false`)
* **Maximum File Size:** `5242880` bytes (**5 MiB**)
* **Allowed MIME Types:** `image/png`, `image/webp`, `application/json`
* **Purpose:** Optional, user-initiated cloud backup of user-generated mandalas and artwork.
* **Integration:** Integrated with `public.storage_deletion_queue` to ensure guaranteed asynchronous object removal upon artwork or account deletion.
* **Access Model:** Strict authenticated owner-folder isolation:
  `user-artwork/{auth.uid()}/...`

### 2.3. Mandatory Sacred Exclusions & Invariants
* **Exclusion 1: Bucket `mandala-cloud-sync` is STRICTLY PROHIBITED.** No automatic cloud syncing bucket may be created.
* **Exclusion 2: Sankalpa Cloud Sync is STRICTLY PROHIBITED.** Sankalpa entries remain 100% local, client-encrypted vaults (PBKDF2-210,000 + AES-GCM-256). Zero Sankalpa data may ever touch Supabase Storage or database tables.
* **Exclusion 3: Client Capability Invariant:** `capabilities.cloudSyncEligible = false` remains permanently enforced across the shared SDK and all game bridges.
* **Exclusion 4: Local-First Artwork Invariant:** AuroMandala artwork is saved locally in IndexedDB by default. Cloud backup is strictly opt-in and triggered only by explicit user action.

---

## 3. Storage Security Policies (RLS on `storage.objects`)

Regardless of the provisioning strategy selected, the following 8 access policies must be enforced on `storage.objects`:

```sql
-- ==============================================================================
-- AVATARS POLICIES (4 policies: SELECT, INSERT, UPDATE, DELETE)
-- ==============================================================================
CREATE POLICY "avatars_owner_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'avatars'
    AND name !~ '(^|/)\.\.(/|$)'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "avatars_owner_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND name !~ '(^|/)\.\.(/|$)'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND (owner IS NULL OR owner = auth.uid())
  );

CREATE POLICY "avatars_owner_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND name !~ '(^|/)\.\.(/|$)'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND name !~ '(^|/)\.\.(/|$)'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND (owner IS NULL OR owner = auth.uid())
  );

CREATE POLICY "avatars_owner_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND name !~ '(^|/)\.\.(/|$)'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ==============================================================================
-- USER-ARTWORK POLICIES (4 policies: SELECT, INSERT, UPDATE, DELETE)
-- ==============================================================================
CREATE POLICY "artwork_owner_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'user-artwork'
    AND name !~ '(^|/)\.\.(/|$)'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "artwork_owner_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'user-artwork'
    AND name !~ '(^|/)\.\.(/|$)'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND (owner IS NULL OR owner = auth.uid())
  );

CREATE POLICY "artwork_owner_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'user-artwork'
    AND name !~ '(^|/)\.\.(/|$)'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'user-artwork'
    AND name !~ '(^|/)\.\.(/|$)'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND (owner IS NULL OR owner = auth.uid())
  );

CREATE POLICY "artwork_owner_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'user-artwork'
    AND name !~ '(^|/)\.\.(/|$)'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
```

---

## 4. Comparison of Remediation Strategies

| Dimension | Strategy A: Dashboard UI Provisioning (Recommended) | Strategy B: Additive SQL Migration Script |
| :--- | :--- | :--- |
| **Execution Path** | Supabase Web Dashboard (`https://supabase.com/dashboard/project/rlqrtbjynaihdspbqtce/storage/buckets`) | CLI / Session Pooler migration pipeline |
| **Permission Context** | Executes internally under `supabase_storage_admin` service privileges | Executes as PostgreSQL role `postgres` |
| **Ownership Conflict** | **Zero risk** — Native UI bypasses DDL table ownership issues | Risk of permission boundaries if DDL statements touch internal tables |
| **Manifest Impact** | **Zero manifest disruption** — Keeps canonical 10-migration manifest intact | Modifying Migration 10 changes manifest hash and requires complete governance re-signing |
| **Migration Ledger** | Migration 10 can be marked resolved via `supabase migration repair` | Migration 10 must be reconciled in `supabase_migrations` |
| **Rollback Simplicity** | 1-click bucket deletion in Dashboard | Requires manual SQL rollback script |
| **Recommendation** | **STRONGLY RECOMMENDED** as safest, least disruptive operational path | Alternative only if automated CLI execution is strictly required |

---

## 5. Exact Execution Runbook: Strategy A (Dashboard UI — Recommended)

### Step 1: Create Bucket `avatars`
1. Navigate to: `https://supabase.com/dashboard/project/rlqrtbjynaihdspbqtce/storage/buckets`
2. Click **"New bucket"**.
3. Configure settings:
   - **Name:** `avatars`
   - **Public bucket:** **Toggle OFF** (Ensure it is Private).
   - **Restrict file size:** Check and enter `524288` (or `512 KB`).
   - **Allowed MIME types:** Enter `image/png, image/jpeg, image/webp` (Do NOT include SVG).
4. Click **"Save"**.

### Step 2: Create Bucket `user-artwork`
1. On the same Storage page, click **"New bucket"**.
2. Configure settings:
   - **Name:** `user-artwork`
   - **Public bucket:** **Toggle OFF** (Ensure it is Private).
   - **Restrict file size:** Check and enter `5242880` (or `5 MB`).
   - **Allowed MIME types:** Enter `image/png, image/webp, application/json`.
3. Click **"Save"**.

### Step 3: Apply Storage RLS Policies
1. Navigate to **SQL Editor** in the Supabase Dashboard:
   `https://supabase.com/dashboard/project/rlqrtbjynaihdspbqtce/sql/new`
2. Paste the SQL block from **Section 3** of this report (the 8 policies).
3. Click **"Run"**.
4. Confirm output: `Success. No rows returned.`

### Step 4: Reconcile Migration Ledger (Optional / Milestone Closeout)
1. In the canonical workspace, mark Migration 10 as reconciled:
   ```bash
   npx supabase migration repair --status applied 20261123000002
   ```

---

## 6. Verification Protocol

After execution, run the following verification commands from `C:\AuroMindPortal`:

### 6.1. REST Storage Verification
```bash
node -e "import('./scripts/load-env.mjs').then(m => { const { env } = m.loadEnvironment(); const key = env.SUPABASE_ANON_KEY || env.SUPABASE_PUBLISHABLE_KEY; fetch('https://rlqrtbjynaihdspbqtce.supabase.co/storage/v1/bucket', { headers: { apikey: key, Authorization: 'Bearer ' + key } }).then(r => r.json()).then(d => console.log('BUCKETS:', JSON.stringify(d))).catch(e => console.error(e)); });"
```
**Expected Output:** Both `avatars` and `user-artwork` are listed with `public: false`.

### 6.2. CLI Ledger Verification
```bash
npm run migrate:preflight:remote
```
**Expected Output:** Preflight state reports `SYNCHRONIZED`, 10 applied, 0 pending, 0 drift.

---

## 7. Rollback Procedure

If provisioning must be rolled back:
1. In the Supabase Dashboard Storage pane, select bucket `user-artwork` -> Settings -> **"Delete bucket"**.
2. Select bucket `avatars` -> Settings -> **"Delete bucket"**.
3. In SQL Editor, execute:
   ```sql
   DROP POLICY IF EXISTS "avatars_owner_select" ON storage.objects;
   DROP POLICY IF EXISTS "avatars_owner_insert" ON storage.objects;
   DROP POLICY IF EXISTS "avatars_owner_update" ON storage.objects;
   DROP POLICY IF EXISTS "avatars_owner_delete" ON storage.objects;
   DROP POLICY IF EXISTS "artwork_owner_select" ON storage.objects;
   DROP POLICY IF EXISTS "artwork_owner_insert" ON storage.objects;
   DROP POLICY IF EXISTS "artwork_owner_update" ON storage.objects;
   DROP POLICY IF EXISTS "artwork_owner_delete" ON storage.objects;
   ```
4. If migration repair was run, reverse the ledger entry:
   ```bash
   npx supabase migration repair --status reverted 20261123000002
   ```

---

## 8. Authorization Boundary Notice

> [!IMPORTANT]
> This plan is prepared for engineering readiness and review only.
> In accordance with the non-negotiable boundaries of B19.9.7:
> **ZERO LIVE MUTATIONS HAVE BEEN PERFORMED.**
> Live creation of storage buckets, policies, or migration repair requires separate, explicit Product Owner authorization.
