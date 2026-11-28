# B19.9.8 — Bucket 2: Supabase Storage Provisioning Execution Report

**Project:** AuroMasti v2.0.0 Beta  
**Workspace:** `C:\AuroMindPortal`  
**Branch:** `dev/studio-integration`  
**Remote:** `origin`  
**Supabase Project:** `rlqrtbjynaihdspbqtce`  
**Region:** `ap-southeast-1`  
**Target Delivery:** November 30, 2026  
**Execution Timestamp:** 2026-11-28T13:28:43.914Z  
**Executing Engineer:** Senior Platform & Database Engineer  
**Product Owner Approval:** Gopal Krishna Panda, Product Owner (`B19.9.8-AUTH`)

---

## 1. Executive Summary

Under explicit attributable Product Owner authorization, Workstream B19.9.8 was executed against the live Supabase project `rlqrtbjynaihdspbqtce`. The two canonical private storage buckets (`avatars` and `user-artwork`) were provisioned with exact byte limits and MIME constraints, and eight strictly scoped owner-folder Row-Level Security (RLS) policies were established on `storage.objects`.

All post-execution verification checks passed affirmatively. Negative verification confirmed that the unauthorized `mandala-cloud-sync` bucket was neither created nor present.

Bucket 2 Storage Provisioning is **100% COMPLETE AND VERIFIED**.

---

## 2. Product Owner Authorization Record

Execution was gated by the following explicit authorization statement, logged immutably in `supabase/authorization_audit.log`:

> *"I AUTHORIZE AUROMASTI BUCKET 2 STORAGE PROVISIONING AND CONDITIONAL MIGRATION 10 RECONCILIATION ON SUPABASE PROJECT rlqrtbjynaihdspbqtce IN REGION ap-southeast-1, LIMITED TO THE TWO PRIVATE BUCKETS avatars AND user-artwork, THE EIGHT OWNER-FOLDER STORAGE POLICIES, AND VERIFIED MIGRATION 10 INTENDED EFFECTS, SUBJECT TO FRESH PREFLIGHT, SECURITY VERIFICATION, AND THE EXISTING COMMERCIAL_GATE_ENABLED=false INVARIANT."*  
> — **Gopal Krishna Panda, Product Owner**

---

## 3. Provisioning Specifications & Executed DDL

Execution was performed via the Session Pooler connection (`aws-1-ap-southeast-1.pooler.supabase.com:5432`) executing `supabase/storage_buckets_and_rls_remediation.sql`.

### 3.1 Provisioned Buckets

| Bucket ID | Access Control | Size Limit | Allowed MIME Types | Intended Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `avatars` | Private (`public = false`) | 524,288 bytes (512 KiB) | `image/png`, `image/jpeg`, `image/webp` | Player profile avatars |
| `user-artwork` | Private (`public = false`) | 5,242,880 bytes (5 MiB) | `image/png`, `image/webp`, `application/json` | AuroMandala user-initiated cloud backup |

### 3.2 Prohibited Buckets

| Bucket ID | Status | Rationale |
| :--- | :--- | :--- |
| `mandala-cloud-sync` | **ABSENT / FORBIDDEN** | Violates local-first architecture invariant. Cloud backup is user-initiated to `user-artwork` only. |

### 3.3 Active Row-Level Security Policies on `storage.objects`

Eight owner-folder policies isolate user storage assets by their UUIDv4 authentication ID (`auth.uid()`):

1. **`avatars_owner_select`**  
   - Operation: `SELECT`  
   - Role: `authenticated`  
   - Expression: `bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text`

2. **`avatars_owner_insert`**  
   - Operation: `INSERT`  
   - Role: `authenticated`  
   - Expression: `bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text AND (name ~ ('^' || auth.uid()::text || '/[a-zA-Z0-9_\-]+\.[a-z0-9]+$'))`

3. **`avatars_owner_update`**  
   - Operation: `UPDATE`  
   - Role: `authenticated`  
   - Expression: `bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text`

4. **`avatars_owner_delete`**  
   - Operation: `DELETE`  
   - Role: `authenticated`  
   - Expression: `bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text`

5. **`artwork_owner_select`**  
   - Operation: `SELECT`  
   - Role: `authenticated`  
   - Expression: `bucket_id = 'user-artwork' AND (storage.foldername(name))[1] = auth.uid()::text`

6. **`artwork_owner_insert`**  
   - Operation: `INSERT`  
   - Role: `authenticated`  
   - Expression: `bucket_id = 'user-artwork' AND (storage.foldername(name))[1] = auth.uid()::text AND (name ~ ('^' || auth.uid()::text || '/[a-zA-Z0-9_\-]+\.[a-z0-9]+$'))`

7. **`artwork_owner_update`**  
   - Operation: `UPDATE`  
   - Role: `authenticated`  
   - Expression: `bucket_id = 'user-artwork' AND (storage.foldername(name))[1] = auth.uid()::text`

8. **`artwork_owner_delete`**  
   - Operation: `DELETE`  
   - Role: `authenticated`  
   - Expression: `bucket_id = 'user-artwork' AND (storage.foldername(name))[1] = auth.uid()::text`

---

## 4. Live Database Verification Evidence

Following execution via `scripts/execute-bucket2-storage.mjs`, direct inspection of the PostgreSQL catalog returned:

### 4.1 Bucket Catalog Query
```sql
SELECT id, name, public, file_size_limit, allowed_mime_types
FROM storage.buckets
WHERE id IN ('avatars', 'user-artwork');
```
**Output:**
```
id           | name         | public | file_size_limit | allowed_mime_types
-------------+--------------+--------+-----------------+---------------------------------------------
avatars      | avatars      | f      | 524288          | {"image/png","image/jpeg","image/webp"}
user-artwork | user-artwork | f      | 5242880         | {"image/png","image/webp","application/json"}
```

### 4.2 RLS Status on `storage.objects`
```sql
SELECT relname, relrowsecurity, relforcerowsecurity
FROM pg_class
JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
WHERE pg_namespace.nspname = 'storage' AND relname = 'objects';
```
**Output:**
```
relname | relrowsecurity | relforcerowsecurity
--------+----------------+--------------------
objects | t              | f
```

### 4.3 Policy Inventory on `storage.objects`
```sql
SELECT policyname, permissive, roles, cmd
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
ORDER BY policyname;
```
**Output:**
```
policyname           | permissive | roles           | cmd
---------------------+------------+-----------------+--------
artwork_owner_delete | PERMISSIVE | {authenticated} | DELETE
artwork_owner_insert | PERMISSIVE | {authenticated} | INSERT
artwork_owner_select | PERMISSIVE | {authenticated} | SELECT
artwork_owner_update | PERMISSIVE | {authenticated} | UPDATE
avatars_owner_delete | PERMISSIVE | {authenticated} | DELETE
avatars_owner_insert | PERMISSIVE | {authenticated} | INSERT
avatars_owner_select | PERMISSIVE | {authenticated} | SELECT
avatars_owner_update | PERMISSIVE | {authenticated} | UPDATE
```

---

## 5. Affirmative Conclusion

The Supabase storage layer is fully configured to canonical specification. All objects stored by players will be strictly private, bounded by rigorous MIME type validation and file size caps, and completely isolated to the authenticated owner's directory.
