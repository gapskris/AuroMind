# AuroMasti B19.8.2 — Remote Activation & Cloud Migration Checklist

**Project:** AuroMasti (formerly AuroMind)  
**Execution Window:** On or after November 28, 2026 (Upon IPv4 broadband restoration)  
**Target Release:** January 1, 2027 — Version 2.0.0 Beta  
**Branch:** `dev/studio-integration`  
**Target Project:** `rlqrtbjynaihdspbqtce` (ap-southeast-1)  
**Production Origin:** `https://auromasti.com`  
**Staging Origin:** `https://staging.auromasti.pages.dev`  
**Migration Manifest SHA-256:** `f55231159389f9d5549713ee83c783c1c7130dc7454058c8195140ae529899ea`

---

## 1. Overview & Operating Rules

This checklist defines the **strictly genuine remote/connectivity-dependent operations** required to connect AuroMasti to its live Supabase project and Cloudflare Pages infrastructure.

### Operating Rules
1. **Never Execute Early:** Do not execute until broadband/IPv4 connection is active and stable.
2. **Fail-Closed Gate:** Do not push migrations without satisfying all 8 mandatory conditions in `validateMigrationExecutionGate()` with fresh preflight evidence and matching manifest SHA-256.
3. **Preserve Sacred Invariants:** Commercial gate must remain `COMMERCIAL_GATE_ENABLED=false`.
4. **Credential Quarantine:** Never commit `.env.local` or print secrets in logs/prompts.
5. **No Blind Dashboard SQL (B82-03):** `npx supabase db push` is the only canonical automated migration path. Dashboard execution bypasses the `schema_migrations` ledger.

---

## 2. Remote Activation Execution Phases

### Phase 1: Connectivity & Preflight Readiness
- [ ] **1.1 Broadband Connectivity:** Connect developer workstation to reliable IPv4 broadband network (avoid cellular hotspots that translate IPv6).
- [ ] **1.2 Verify Local Credentials:**
  - Confirm `.env.local` exists and contains:
    - `SUPABASE_PUBLISHABLE_KEY=sb_publishable_...` (or legacy anon JWT)
    - `SUPABASE_ACCESS_TOKEN=sbp_...`
    - `SUPABASE_DB_PASSWORD=...`
- [ ] **1.3 Verify Local Tools & Manifest:**
  ```powershell
  npx supabase --version   # Must report 3.4.0
  node --version           # Must be >= 18.0.0
  npm run migrate:manifest # Must verify manifest hash f55231159389f9d5...
  ```
- [ ] **1.4 Run Health Check & Secret Scan:**
  ```powershell
  node scripts/health-check.mjs
  node scripts/validate-secret-exposure.mjs
  ```

---

### Phase 2: Remote Drift Inspection & Non-Mutating Preflight
- [ ] **2.1 Run Authenticated Remote Migration List:**
  ```powershell
  $env:SUPABASE_ACCESS_TOKEN = (Get-Content .env.local | Select-String "SUPABASE_ACCESS_TOKEN=").Line.Split('=',2)[1].Trim()
  npx supabase migration list --remote --project-ref rlqrtbjynaihdspbqtce
  ```
- [ ] **2.2 Inspect Remote Ledger:**
  - Verify if remote project is empty (0 migrations applied) or partially migrated.
  - Confirm zero unexpected remote migrations exist.
- [ ] **2.3 Run Dry-Run Push:**
  ```powershell
  npx supabase db push --dry-run --project-ref rlqrtbjynaihdspbqtce
  ```
  - Verify dry-run completes with zero syntax or constraint errors.

---

### Phase 3: Formal Product Owner Gate Signoff
- [ ] **3.1 Evaluate 8 Mandatory Gate Conditions:**
  1. `GATE_1_REMOTE_HISTORY`: Remote ledger state inspected.
  2. `GATE_2_REMOTE_CONNECTIVITY`: Reachability to Supabase API & Postgres verified.
  3. `GATE_3_REMOTE_SCHEMA_INSPECTED`: Public schema confirmed clean of conflicting tables.
  4. `GATE_4_LOCAL_MIGRATIONS_COMPARED`: 10 canonical migrations present.
  5. `GATE_5_DIVERGENCE_RESOLVED`: Zero checksum divergence detected.
  6. `GATE_6_PREVIEW_GENERATED`: `supabase/consolidated_migration_preview.sql` reviewed.
  7. `GATE_7_BACKUP_READINESS`: Rollback posture confirmed.
  8. `GATE_8_PRODUCT_OWNER_APPROVAL`: Explicit Product Owner authorization granted.
- [ ] **3.2 Record Explicit Attributable Approval:**
  Compile approval record matching the required schema:
  - `approvedBy`: Name of Product Owner
  - `approvedAt`: ISO timestamp (valid for 60 minutes)
  - `approvedManifestSha256`: `f55231159389f9d5549713ee83c783c1c7130dc7454058c8195140ae529899ea`
  - `migrationSetCount`: `10`
  - `targetProjectRef`: `rlqrtbjynaihdspbqtce`
  - `explicitStatement`: `"I AUTHORIZE MIGRATION EXECUTION FOR AUROMASTI"`

---

### Phase 4: Remote Database Migration Execution
- [ ] **4.1 Execute Canonical CLI Migration Push:**
  ```powershell
  npx supabase db push --project-ref rlqrtbjynaihdspbqtce
  ```
- [ ] **4.2 Execute Post-Migration Schema Verification:**
  - Run `supabase/verify_remote_schema.sql` via psql or Supabase SQL Editor.
  - Verify that script outputs:
    `SUCCESS: All 15 public tables verified with RLS enabled and hardened function search_paths.`

---

### Phase 5: Supabase Auth & Storage Cloud Configuration
- [ ] **5.1 Auth URL Configuration:**
  - Open `Project Settings -> Authentication -> URL Configuration`.
  - Set **Site URL**: `https://auromasti.com`
  - Add **Redirect URLs**:
    - `https://auromasti.com/**`
    - `https://staging.auromasti.pages.dev/**`
    - `http://localhost:3000/**`
- [ ] **5.2 Storage Bucket & Policy Verification:**
  - Open `Storage -> Buckets`.
  - Confirm `avatars` bucket exists (Public: Read-only public, write restricted to owner).
  - Confirm `user-artwork` bucket exists (Private: Read/write restricted to owner).
  - Confirm `storage_deletion_queue` table exists and trigger is active.

---

### Phase 6: Cloudflare Pages Staging & Production Deployment
- [ ] **6.1 Staging Build & Deploy:**
  - Push branch to `origin/dev/studio-integration`.
  - Cloudflare Pages builds automatically via GitHub connection.
  - Verify build logs and zero build warnings.
- [ ] **6.2 Staging Edge Verification:**
  - Open `https://staging.auromasti.pages.dev`.
  - Verify HTTP Security Headers in DevTools Network tab:
    - `Content-Security-Policy` matches `_headers`
    - `X-Frame-Options: SAMEORIGIN`
    - `X-Content-Type-Options: nosniff`
  - Verify Service Worker registration and offline game launch.
- [ ] **6.3 Production Promotion & DNS Verification:**
  - Promote verified staging build to production.
  - Verify `https://auromasti.com` resolves with valid SSL.
  - Smoke test gameplay: AuroMandala, MaaMATCH, MaaBLOCK.
  - Smoke test Senior Mode toggle, audio mute/resume, and theater close.

---

## 3. Emergency Disaster-Recovery Manual Procedure (B82-03)

> [!CAUTION]
> **DO NOT USE AS A STANDARD SHORTCUT.**
> Direct manual SQL execution in the Supabase Dashboard SQL Editor modifies database tables but **DOES NOT update `supabase_migrations.schema_migrations`**, causing future CLI migrations to fail or falsely detect drift.

If, and only if, CLI execution is permanently blocked by an irrecoverable network gateway defect:
1. **Prerequisite:** Obtain separate, written emergency authorization from Product Owner.
2. **Execute SQL Bundle:** In Supabase Dashboard SQL Editor, execute `supabase/consolidated_migration_preview.sql`.
3. **Mandatory Ledger Repair:** Immediately run the following for all 10 canonical migration versions:
   ```powershell
   npx supabase migration repair --status applied 20261120000001
   npx supabase migration repair --status applied 20261120000002
   npx supabase migration repair --status applied 20261120000003
   npx supabase migration repair --status applied 20261120000004
   npx supabase migration repair --status applied 20261122000001
   npx supabase migration repair --status applied 20261122000002
   npx supabase migration repair --status applied 20261122000003
   npx supabase migration repair --status applied 20261122000004
   npx supabase migration repair --status applied 20261123000001
   npx supabase migration repair --status applied 20261123000002
   ```
4. **Verify Schema & Ledger Parity:**
   ```powershell
   npx supabase migration list --remote --project-ref rlqrtbjynaihdspbqtce
   # Run supabase/verify_remote_schema.sql to verify all 15 public tables
   ```
