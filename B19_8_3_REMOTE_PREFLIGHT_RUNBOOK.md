# AuroMasti B19.8.3 — Remote Preflight & Cloud Activation Runbook

**Project:** AuroMasti (formerly AuroMind)  
**Milestone:** B19.8.3  
**Target Release:** January 1, 2027 — Version 2.0.0 Beta  
**Workspace:** `C:\AuroMindPortal`  
**Branch:** `dev/studio-integration`  
**Target Project:** `rlqrtbjynaihdspbqtce` (ap-southeast-1)  
**Target Hosts:**  
- Staging: `https://staging.auromasti.pages.dev`  
- Production: `https://auromasti.com`  
**Canonical Migration Manifest SHA-256:** `f55231159389f9d5549713ee83c783c1c7130dc7454058c8195140ae529899ea`  
**Commercial Gate:** `COMMERCIAL_GATE_ENABLED=false` (Strictly Preserved)  
**Execution Window:** On or after November 28, 2026 (Upon IPv4 broadband activation)

---

## 1. Operating Principles & Safety Requirements

> [!IMPORTANT]
> **FAIL-CLOSED GOVERNANCE POLICY**  
> Under no circumstances may remote database mutations (`supabase db push`, remote SQL execution, Edge Function deployment, or Cloudflare production DNS cutover) occur without completing the sequential verification steps in this runbook.

1. **Preflight Separation**: Local preflight (`npm run migrate:preflight`) validates offline artifacts only. Remote preflight (`npm run migrate:preflight:remote`) performs read-only live remote discovery.
2. **Attributable PO Authorization**: Execution requires a cryptographic/attributable approval record signed by the Product Owner within 60 minutes of execution.
3. **Audit Trail Accountability**: Every execution attempt, pass/fail decision, parameter digest, and manifest checksum is automatically appended to `supabase/authorization_audit.log`.
4. **Shell Execution Honesty**: Note that while the programmatic Node.js wrapper enforces all 8 safety gates, raw CLI invocation (`npx supabase db push`) in an interactive terminal bypasses the Node wrapper. Operators must strictly adhere to the audited runner.
5. **Ledger Integrity**: Manual SQL execution in the Supabase Dashboard SQL Editor is classified strictly as a disaster recovery fallback; if performed, it requires immediate sequential ledger repair.

---

## 2. Step-by-Step Activation Procedure (November 28, 2026)

### Step 1: Pre-Activation Diagnostics & Network Verification

Run the safe, non-leaking network diagnostic tool to inspect connectivity paths:

```powershell
Set-Location C:\AuroMindPortal
npm run diagnose:network
```

**Evaluation Criteria:**
- **DNS Resolution**: Checks IPv4 and IPv6 records for `db.rlqrtbjynaihdspbqtce.supabase.co` and `aws-0-ap-southeast-1.pooler.supabase.com`.
  - *If direct DB host fails IPv4 resolution (e.g. mobile hotspot)*: Verify that the AWS pooler host resolves IPv4 (e.g. `52.77.146.31`).
- **TCP Reachability**:
  - Pooler session port `6543`: Must establish TCP connection (typical latency < 150ms).
  - Pooler transaction port `5432`: Must establish TCP connection.
  - Direct DB port `5432`: May timeout on IPv6-only cellular networks.
- **REST API Reachability**:
  - Probes `https://rlqrtbjynaihdspbqtce.supabase.co/rest/v1/`.
  - Status `401 Unauthorized` is **NORMAL and EXPECTED** (proves reachability and origin identity without sending credentials).
- **Zero Secrets**: Confirm output contains zero tokens, passwords, or cleartext keys.

---

### Step 2: Read-Only Remote Preflight Inspection

Execute the read-only remote preflight script:

```powershell
npm run migrate:preflight:remote
```

**Validation Checks Performed:**
1. Verifies local 10-migration sequence against manifest `f55231159389f9d5...`.
2. Inspects remote `schema_migrations` ledger via Supabase CLI (`npx supabase migration list --remote`).
3. Classifies remote state into one of the 6 canonical states:
   - `CLEAN_INITIAL_STATE`: 0 migrations applied remotely; ready for initial deployment.
   - `MIGRATIONS_PENDING`: Partial sequential subset applied; unapplied migrations ready to push.
   - `DRIFT_AHEAD`: Remote contains untracked migrations not in local repository. **HALT IMMEDIATELY**.
   - `SCHEMA_HISTORY_DIVERGENCE`: Checksum mismatch between local file and remote ledger. **HALT IMMEDIATELY**.
   - `OBJECT_COLLISION_DETECTED`: Tables exist on remote before migrations applied. **HALT IMMEDIATELY**.
   - `UNVERIFIED`: Network timeout, DNS failure, or auth failure. Categorizes exact error (`DNS_RESOLUTION_FAILURE`, `CONNECTION_TIMEOUT`, etc.).

---

### Step 3: Product Owner Attributable Approval Signing

Prior to executing remote migrations, the Product Owner must formally sign an authorization record. The approval must satisfy the schema enforced by `validateMigrationExecutionGate()`:

```json
{
  "approvedBy": "Product Owner Name",
  "approvedAt": "2026-11-28T09:00:00.000Z",
  "approvedManifestSha256": "f55231159389f9d5549713ee83c783c1c7130dc7454058c8195140ae529899ea",
  "migrationSetCount": 10,
  "targetProjectRef": "rlqrtbjynaihdspbqtce",
  "explicitStatement": "I AUTHORIZE MIGRATION EXECUTION FOR AUROMASTI"
}
```

**Validity Constraints:**
- `approvedAt` must be within **60 minutes** of execution time.
- Fresh preflight evidence must be within **30 minutes** of execution time.
- `approvedManifestSha256` must match the local manifest exactly.

---

### Step 4: Programmatic Migration Execution

Execute the migrations through the audited workflow runner:

```powershell
# Execute through the audited wrapper
node scripts/migration-workflow.mjs --execute
```

**Execution Safeguards:**
- Evaluates all 8 fail-closed gates prior to CLI subprocess invocation.
- Records structured authorization attempt to `supabase/authorization_audit.log`:
  ```json
  {"timestamp":"2026-11-28T09:15:00.000Z","event":"MIGRATION_EXECUTION_ATTEMPT","status":"AUTHORIZED","approvedBy":"...","manifestSha256":"f55231159389..."}
  ```
- Executes `npx supabase db push --project-ref rlqrtbjynaihdspbqtce`.
- Redacts all secrets from subprocess output streams.

---

### Step 5: Post-Migration Remote Schema Verification

Immediately following migration push, verify that all schema objects, tables, RLS policies, and search_paths were created accurately:

```powershell
# Run the canonical SQL verification script against the remote database
# (via psql through pooler port 6543 or Supabase Dashboard SQL Editor)
Get-Content supabase/verify_remote_schema.sql
```

**Verification Checkpoints:**
1. **15 Public Tables Verified**:
   - 14 logged tables: `profiles`, `user_roles`, `user_game_saves`, `user_achievements`, `user_artwork`, `artwork_likes`, `shared_mandala_gallery`, `sankalpa_entries`, `user_preferences`, `feedback_submissions`, `guest_conversions`, `auromind_telemetry`, `cloud_sync_ledger`, `storage_deletion_queue`.
   - 1 unlogged table: `telemetry_rate_buckets`.
2. **100% RLS Enforcement**: Every public table must report `rowsecurity = true`.
3. **SECURITY DEFINER Search Paths**: Every security definer function must report `search_path = pg_catalog, public`.

---

### Step 6: Emergency Disaster-Recovery Ledger Repair (Fallback Only)

> [!CAUTION]
> **USE ONLY IF PROGRAMMATIC CLI EXECUTION FAILS IRRECOVERABLY**  
> If emergency deployment was performed by pasting `supabase/consolidated_migration_preview.sql` directly into the Supabase Dashboard SQL Editor, PostgreSQL created the tables but the `supabase_migrations.schema_migrations` tracking table was **BYPASSED**.  
> You MUST sequentially repair the ledger using the exact 10 canonical timestamps below:

```powershell
# 1. 20261120000001: Core Schema
npx supabase migration repair --status applied 20261120000001

# 2. 20261120000002: Rate Limiting
npx supabase migration repair --status applied 20261120000002

# 3. 20261120000003: Telemetry RLS Hardening
npx supabase migration repair --status applied 20261120000003

# 4. 20261120000004: Telemetry Retention
npx supabase migration repair --status applied 20261120000004

# 5. 20261122000001: Profile RLS Separation
npx supabase migration repair --status applied 20261122000001

# 6. 20261122000002: Telemetry Token Bucket
npx supabase migration repair --status applied 20261122000002

# 7. 20261122000003: Telemetry Search Path Hardening
npx supabase migration repair --status applied 20261122000003

# 8. 20261122000004: Telemetry Token Bucket Input Validation
npx supabase migration repair --status applied 20261122000004

# 9. 20261123000001: DB Integrity & RLS Hardening
npx supabase migration repair --status applied 20261123000001

# 10. 20261123000002: Storage Buckets & RLS
npx supabase migration repair --status applied 20261123000002
```

After repair, re-run `npm run migrate:preflight:remote` to confirm ledger status matches local repository.

---

### Step 7: Cloudflare Pages Staging & Production Deployment

Following successful remote database migration:

1. **Deploy to Staging**:
   - Push commit to `origin/dev/studio-integration`.
   - Cloudflare Pages automatically builds from repository.
   - Verify staging URL: `https://staging.auromasti.pages.dev`.
2. **Edge Security & Routing Smoke Test**:
   - Verify HTTP response headers: `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`.
   - Verify Service Worker precache and offline boot.
   - Launch all 3 curated games: AuroMandala, MaaMATCH, MaaBLOCK.
   - Test theater exit handshake (`AUROMIND_CLOSE_THEATER`) returning to portal.
3. **Production Apex Cutover**:
   - After staging verification signoff, promote build to production on `https://auromasti.com`.
   - Confirm SSL certificate resolution and custom domain apex routing.

---

## 3. Post-Activation Verification Signoff Matrix

| Verification Milestone | Responsible Role | Pass Criteria | Target Date |
| :--- | :--- | :--- | :--- |
| **Network & Pooler Diagnostic** | DevOps Lead | Pooler 6543/5432 connected; REST 401 | Nov 28, 2026 |
| **Remote Preflight List** | DBA | Clean initial state or pending subset | Nov 28, 2026 |
| **Product Owner Approval** | Product Owner | Signed record with manifest SHA-256 | Nov 28, 2026 |
| **Database Migration Push** | Release Engineer | 10 migrations applied; exit code 0 | Nov 28, 2026 |
| **Remote Schema Verification** | Security Architect | 15 tables with RLS; hardened functions | Nov 28, 2026 |
| **Cloudflare Staging Smoke Test** | QA Lead | 3 games load offline; CSP verified | Nov 28, 2026 |
| **Production Apex Cutover** | Infrastructure Lead | `https://auromasti.com` live & responsive | Nov 28, 2026 |
