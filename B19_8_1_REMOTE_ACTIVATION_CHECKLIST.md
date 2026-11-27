# AuroMasti B19.8.1 — Remote Activation & Cloud Migration Checklist

**Project:** AuroMasti (AuroMind Portal)  
**Execution Window:** On or after November 28, 2026 (Upon IPv4 broadband restoration)  
**Target Release:** January 1, 2027 — Version 2.0.0 Beta  
**Branch:** `dev/studio-integration`  
**Target Project:** `rlqrtbjynaihdspbqtce` (ap-southeast-1)  
**Production Origin:** `https://auromasti.com`  
**Staging Origin:** `https://staging.auromasti.pages.dev`

---

## 1. Overview & Operating Rules

This checklist contains **strictly genuine remote/connectivity-dependent operations** required to connect AuroMasti to its live Supabase project and Cloudflare Pages infrastructure.

### Operating Rules
1. **Never Execute Early:** Do not execute until broadband/IPv4 connection is active and stable.
2. **Fail-Closed Gate:** Do not push migrations without satisfying all 8 mandatory conditions in `validateMigrationExecutionGate()`.
3. **Preserve Sacred Invariants:** Commercial gate must remain `COMMERCIAL_GATE_ENABLED=false`.
4. **Credential Quarantine:** Never commit `.env.local` or print secrets in logs/prompts.

---

## 2. Remote Activation Execution Phases

### Phase 1: Connectivity & Preflight Readiness
- [ ] **1.1 Broadband Connectivity:** Connect developer workstation to reliable IPv4 broadband network (avoid cellular hotspots that translate IPv6).
- [ ] **1.2 Verify Local Credentials:**
  - Confirm `.env.local` exists and contains:
    - `SUPABASE_PUBLISHABLE_KEY=sb_publishable_...` (or legacy anon JWT)
    - `SUPABASE_ACCESS_TOKEN=sbp_...`
    - `SUPABASE_DB_PASSWORD=...`
- [ ] **1.3 Verify Local Tools:**
  ```powershell
  npx supabase --version
  node --version  # Must be >= 18.0.0
  ```
- [ ] **1.4 Run Health Check:**
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
  - Verify if remote project is empty (0 migrations) or partially migrated.
  - Confirm whether any unexpected remote migrations exist.
- [ ] **2.3 Run Dry-Run Push:**
  ```powershell
  npx supabase db push --dry-run --project-ref rlqrtbjynaihdspbqtce
  ```
  - Verify dry-run completes without SQL syntax errors or relation conflicts.

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
- [ ] **3.2 Record Approval:** Document formal PO signoff timestamp and release authorization.

---

### Phase 4: Remote Database Migration Execution
- [ ] **4.1 Execute Database Migrations (Choose Primary or Fallback):**
  - **Option A: CLI Migration Push (Primary):**
    ```powershell
    npx supabase db push --project-ref rlqrtbjynaihdspbqtce
    ```
  - **Option B: Dashboard SQL Editor (Fallback):**
    - Open `https://supabase.com/dashboard/project/rlqrtbjynaihdspbqtce/sql`.
    - Paste contents of `supabase/consolidated_migration_preview.sql`.
    - Execute within a single transaction.
- [ ] **4.2 Execute Post-Migration Schema Verification:**
  - Run `supabase/verify_remote_schema.sql` via psql or Dashboard SQL editor.
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
  - Cloudflare Pages builds automatically via GitHub connection (or manual direct upload).
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

## 3. Contingency & Rollback Runbook

| Failure Scenario | Immediate Action | Secondary Action |
|:---|:---|:---|
| CLI `db push` connection timeout | Check IPv4 connectivity; verify DB password | Fall back to Option B (Dashboard SQL Editor) |
| SQL Syntax Error during migration | Stop immediately; transaction aborts | Inspect migration diff against `consolidated_migration_preview.sql` |
| Verification SQL reports missing table | Query `pg_tables` directly in dashboard | Re-apply specific migration file manually |
| Cloudflare build fails | Inspect build log; verify Node version >= 18 | Check `package.json` build command (`npm run build`) |
| Auth redirects fail | Inspect origin query parameters | Ensure current origin matches redirect allowlist in Supabase |
