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

Run the safe, non-leaking network diagnostic tool to inspect connectivity paths and verify TLS Root CA:

```powershell
Set-Location C:\AuroMindPortal
npm run diagnose:network
```

**Evaluation Criteria:**
- **DNS Resolution**: Checks IPv4 and IPv6 records for `db.rlqrtbjynaihdspbqtce.supabase.co`, `aws-1-ap-southeast-1.pooler.supabase.com` (Primary Pooler), and `aws-0-ap-southeast-1.pooler.supabase.com`.
  - *If direct DB host fails IPv4 resolution (e.g. mobile hotspot)*: Verify that the primary AWS pooler host resolves IPv4 (e.g. `54.179.210.0`).
- **TCP Reachability**:
  - Primary Session Pooler port `5432` (`aws-1-ap-southeast-1.pooler.supabase.com`): Must establish TCP connection (typical latency < 100ms; Nov 28 confirmed 64ms).
  - Transaction Pooler port `6543`: Must establish TCP connection.
  - Direct DB port `5432`: May timeout on IPv6-only cellular networks.
- **PostgreSQL STARTTLS Protocol (Layer 3)**:
  - SSLRequest packet (code 80877103) accepted by Session Pooler port `5432` with byte `'S'`.
- **TLS Handshake & Root CA Verification (Layer 4)**:
  - Negotiates TLS 1.3 with cipher `TLS_AES_256_GCM_SHA384`.
  - Supabase Root CA `prod-ca-2021.crt` loaded from repository root (`CN=Supabase Root 2021 CA`, valid to 2031).
  - Certificate authorization: `Authorized: true`, Trust status: `SUPABASE_CA_VERIFIED`.
- **REST API Reachability**:
  - Probes `https://rlqrtbjynaihdspbqtce.supabase.co/rest/v1/`.
  - Status `401 Unauthorized` is **NORMAL and EXPECTED** (proves reachability and origin identity without sending credentials).
- **Zero Secrets**: Confirm output contains zero tokens, passwords, or cleartext keys.

---

### Step 2: Read-Only Remote Preflight Inspection (Session Pooler Targeting)

Execute the read-only remote preflight script:

```powershell
npm run migrate:preflight:remote
```

**Zero-Exposure Credential Architecture:**
The preflight runner automatically targets the Session Pooler URL without exposing database passwords in command-line arguments, process tables (`Get-CimInstance Win32_Process`, `Get-Process`), shell history, or console logs.

If running manually via raw Supabase CLI, operators MUST pass the password via `PGPASSWORD` and NEVER embed it into `--remote`:

```powershell
# Set database password strictly in current PowerShell in-memory environment block:
$env:PGPASSWORD = $env:SUPABASE_DB_PASSWORD

# Target Session Pooler with verified TLS and Root CA (Password OMITTED from CLI arguments):
npx supabase migration list --remote="postgresql://postgres.rlqrtbjynaihdspbqtce@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=verify-full&sslrootcert=C:/AuroMindPortal/prod-ca-2021.crt"

# Non-mutating dry-run push:
npx supabase db push --dry-run --remote="postgresql://postgres.rlqrtbjynaihdspbqtce@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=verify-full&sslrootcert=C:/AuroMindPortal/prod-ca-2021.crt"
```

**Validation Checks Performed:**
1. Verifies local 10-migration sequence against manifest `f55231159389f9d5...`.
2. Inspects remote `schema_migrations` ledger via Supabase CLI (`npx supabase migration list --remote=<pooler-url>`).
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

### Step 4: Programmatic Migration Execution (Session Pooler Targeting)

Execute the migrations through the audited workflow runner:

```powershell
# Execute through the audited wrapper (targets Session Pooler port 5432 with verified TLS CA and in-memory PGPASSWORD)
node scripts/migration-workflow.mjs --execute
```

**Execution Safeguards:**
- Evaluates all 8 fail-closed gates prior to CLI subprocess invocation.
- Records structured authorization attempt to `supabase/authorization_audit.log`:
  ```json
  {"timestamp":"2026-11-28T09:15:00.000Z","event":"MIGRATION_EXECUTION_ATTEMPT","status":"AUTHORIZED","approvedBy":"...","manifestSha256":"f55231159389..."}
  ```
- Executes `npx supabase db push --remote=<pooler-url>` with database password passed strictly via in-memory `PGPASSWORD` environment variable.
- Uses `sslmode=verify-full&sslrootcert=C:/AuroMindPortal/prod-ca-2021.crt` ensuring strict TLS 1.3 encryption and CA certificate validation.
- Redacts all secrets from subprocess output streams (`maskSecret`).

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

### Step 6: Emergency Controlled Disaster-Recovery & Ledger Reconciliation (Fallback Only)

> [!CAUTION]
> **CRITICAL RECOVERY GOVERNANCE — DO NOT EXECUTE A BLANKET REPAIR LOOP**  
> Running `supabase migration repair --status applied <version>` merely alters migration-history bookkeeping. It DOES NOT prove that the SQL executed correctly, that objects exist, or that the schema matches the canonical implementation.  
> Marking a migration as applied solely because SQL was submitted to the Dashboard SQL Editor is STRICTLY PROHIBITED.

If programmatic CLI execution is permanently blocked by an irrecoverable network gateway defect and emergency manual execution was authorized by the Product Owner:

#### 6.1 Pre-Recovery Safeguards & Inspection
1. **Target Project Identity Check**: Verify connected project reference is exactly `rlqrtbjynaihdspbqtce`.
2. **Pre-Execution Backup**: Trigger a manual snapshot or pg_dump backup in the Supabase Dashboard (`Database -> Backups`).
3. **Read-Only Baseline Inspection**: Inspect current `schema_migrations` and `information_schema.tables` before touching any objects.
4. **Attributable Emergency PO Authorization**: Obtain written Product Owner signoff specifically authorizing manual SQL execution.

#### 6.2 Controlled Execution & Per-Migration Verification
Execute individual migration scripts sequentially inside explicit transaction blocks (`BEGIN; ... COMMIT;`), verifying catalog objects before proceeding to the next migration.

| Version | Migration File | Expected Objects | Verification SQL Query | Precondition for `migration repair` |
| :--- | :--- | :--- | :--- | :--- |
| **`20261120000001`** | `b5_core_schema.sql` | 12 tables (`profiles`, `user_roles`, `user_game_saves`, etc.), 3 functions (`handle_new_user`, etc.) | `SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('profiles', 'user_roles', 'user_game_saves', 'user_achievements', 'user_artwork', 'artwork_likes', 'shared_mandala_gallery', 'sankalpa_entries', 'user_preferences', 'feedback_submissions', 'guest_conversions', 'cloud_sync_ledger');` | Affirmative query result = 12, RLS enabled on all 12. |
| **`20261120000002`** | `b8_rate_limiting.sql` | Table `auromind_telemetry`, functions `record_telemetry_event`, `enforce_telemetry_rate_limit` | `SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='auromind_telemetry';` | Affirmative query result = 1, functions exist. `20261120000001` reconciled. |
| **`20261120000003`** | `b13a_telemetry_rls_hardening.sql` | Policy `telemetry_insert_only` on `auromind_telemetry` | `SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='auromind_telemetry' AND policyname='telemetry_insert_only';` | Affirmative query result = 1. `20261120000002` reconciled. |
| **`20261120000004`** | `b13b_telemetry_retention.sql` | Function `purge_expired_telemetry_events()` | `SELECT count(*) FROM information_schema.routines WHERE routine_schema='public' AND routine_name='purge_expired_telemetry_events';` | Affirmative query result = 1. `20261120000003` reconciled. |
| **`20261122000001`** | `b18c_profile_rls_separation.sql` | Policies `profiles_read_public`, `profiles_update_owner` on `profiles` | `SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='profiles' AND policyname IN ('profiles_read_public', 'profiles_update_owner');` | Affirmative query result = 2. `20261120000004` reconciled. |
| **`20261122000002`** | `b18c_telemetry_token_bucket.sql` | Unlogged table `telemetry_rate_buckets` (`relpersistence='u'`), function `consume_token_bucket_slot` | `SELECT relpersistence FROM pg_class WHERE relname='telemetry_rate_buckets';` | Table exists with `relpersistence='u'` (unlogged). `20261122000001` reconciled. |
| **`20261122000003`** | `b18c_telemetry_search_path_hardening.sql` | `search_path = pg_catalog, public` on `consume_token_bucket_slot` and `purge_expired_telemetry_events` | `SELECT count(*) FROM pg_proc WHERE proname IN ('consume_token_bucket_slot', 'purge_expired_telemetry_events') AND proconfig::text LIKE '%search_path=pg_catalog, public%';` | Affirmative query result = 2. `20261122000002` reconciled. |
| **`20261122000004`** | `b18d_telemetry_token_bucket_input_validation.sql` | Parameter checks in `consume_token_bucket_slot` body | `SELECT prosrc FROM pg_proc WHERE proname='consume_token_bucket_slot' AND pronamespace='public'::regnamespace;` | Function body contains parameter validation checks. `20261122000003` reconciled. |
| **`20261123000001`** | `b19_5_05_db_integrity_and_rls_hardening.sql` | FK constraints, cascade rules, 100% RLS across all 15 public tables | `SELECT count(*) FROM pg_tables WHERE schemaname='public' AND rowsecurity=true;` | Affirmative query result = 15. `20261122000004` reconciled. |
| **`20261123000002`** | `b19_5_06_storage_buckets_and_rls.sql` | Table `storage_deletion_queue`, buckets `avatars` & `user-artwork` | `SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='storage_deletion_queue'; SELECT count(*) FROM storage.buckets WHERE id IN ('avatars', 'user-artwork');` | Table exists and both buckets exist. `20261123000001` reconciled. |

#### 6.3 Conditional Ledger Reconciliation (Per-Migration Command)
Only AFTER the verification SQL query for migration $V_i$ returns the affirmative result, execute:
```powershell
# Reconcile ONLY the verified migration version:
npx supabase migration repair --status applied <verified_version>
```

#### 6.4 Handling Partial Failure
If any migration $V_k$ fails execution or verification:
1. **HALT IMMEDIATELY**.
2. **DO NOT run `migration repair`** for version $V_k$ or any subsequent migration.
3. The ledger will accurately record that migrations through $V_{k-1}$ are applied and $V_k$ is unapplied.
4. Diagnose and resolve the error on version $V_k$ before attempting further operations.

#### 6.5 Post-Recovery Validation
Once all verified versions are reconciled, run:
```powershell
npm run migrate:preflight:remote
```
Confirm that the preflight classifies the database state as fully synchronized with zero drift.

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
