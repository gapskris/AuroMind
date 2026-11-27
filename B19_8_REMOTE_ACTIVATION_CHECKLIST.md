# AuroMasti — B19.8 Remote Cloud Activation Checklist
**20-Item Step-by-Step Procedure for November 28, 2026 Resumption**

- **Target Resumption Date:** November 28, 2026
- **Workspace:** `C:\AuroMindPortal`
- **Branch:** `dev/studio-integration`
- **Canonical Supabase Project:** `rlqrtbjynaihdspbqtce` (Region: `ap-southeast-1`)
- **Staging URL:** `https://staging.auromasti.pages.dev`
- **Production URL:** `https://auromasti.com`
- **Commercial Gate Invariant:** `COMMERCIAL_GATE_ENABLED=false`

---

## Pre-Activation Instructions
> [!IMPORTANT]
> Do NOT execute any item in this checklist until reliable network connectivity (IPv4 broadband or working DNS/routing) is established on November 28.
> Maintain strict Product Owner authorization before executing any mutative step (Items 10, 13, 15, and 17).

---

## Part 1: Baseline, Network & Preflight Verification (Items 1–5)

- [ ] **Item 01: Verify Local Environment & Branch Parity**
  - Verify workspace is `C:\AuroMindPortal`.
  - Confirm current branch is `dev/studio-integration`.
  - Confirm Git status is clean and HEAD matches remote origin.
  - Run: `git status && git branch -vv`

- [ ] **Item 02: Validate Local Credential Configuration**
  - Verify `.env.local` is present and git-ignored.
  - Confirm `SUPABASE_PUBLISHABLE_KEY` (or `SUPABASE_ANON_KEY`), `SUPABASE_ACCESS_TOKEN`, and `SUPABASE_DB_PASSWORD` pass structural validation.
  - Confirm zero secrets are printed to stdout or logs.
  - Run: `node scripts/validate-env.mjs`

- [ ] **Item 03: Verify Internet & Supabase IPv4/IPv6 Network Reachability**
  - Confirm broadband connection is active (DNS resolution functioning).
  - Verify HTTPS reachability to `https://rlqrtbjynaihdspbqtce.supabase.co`.
  - Verify PostgreSQL connectivity (port 5432 / 6543 pooler) without socket timeouts (`ETIMEDOUT` / `ENETUNREACH`).
  - Run: `node -e "fetch('https://rlqrtbjynaihdspbqtce.supabase.co/rest/v1/').then(r => console.log('REST Reachable:', r.status)).catch(e => console.error('Unreachable:', e.code))"`

- [ ] **Item 04: Verify Sacred Invariants Before Any Operations**
  - Confirm byte-identical integrity for VAK HTML, VAK Corpus, Flora DB, and Commercial Gate.
  - Verify health check status is `HEALTHY`.
  - Run: `node scripts/health-check.mjs`

- [ ] **Item 05: Obtain Explicit Product Owner Authorization for Remote Execution**
  - Review release scope with Product Owner.
  - Confirm authorization flag is explicitly passed (`--authorized-by-product-owner`).
  - Verify zero unattended or rogue migrations are queued.

---

## Part 2: Supabase Remote Link & Preflight Classification (Items 6–9)

- [ ] **Item 06: Project-Level Supabase CLI Link**
  - Link project using the project-level Supabase CLI and Personal Access Token.
  - Ensure secrets are never echoed in terminal history.
  - Run: `npx supabase link --project-ref rlqrtbjynaihdspbqtce`

- [ ] **Item 07: Execute Non-Mutating Remote Migration Preflight**
  - Run the hardened 6-state preflight engine.
  - Inspect reported state code, remote applied count, and pending migration list.
  - Run: `node scripts/migration-workflow.mjs --preflight`

- [ ] **Item 08: Reconcile Preflight State Classification**
  - Verify preflight state is either:
    - `CLEAN_INITIAL_STATE` (0 remote applied, ready for initial push), OR
    - `MIGRATIONS_PENDING` (remote has clean subset, ready for forward delta).
  - If state is `UNVERIFIED`, `DRIFT_AHEAD`, `SCHEMA_HISTORY_DIVERGENCE`, or `OBJECT_COLLISION_DETECTED`, **ABORT IMMEDIATELY** and investigate.

- [ ] **Item 09: Capture Pre-Migration Remote Database Snapshot**
  - Before applying DDL, take a structural schema snapshot using the backup tool.
  - Run: `node scripts/restore-database.mjs --dry-run`

---

## Part 3: Migration Execution & Schema Verification (Items 10–14)

- [ ] **Item 10: Execute 10 Canonical Migrations in Chronological Lexical Sequence**
  - Apply the canonical migrations using `npx supabase db push`.
  - Migrations to apply:
    1. `20261120000001_b5_core_schema.sql`
    2. `20261120000002_b8_rate_limiting.sql`
    3. `20261120000003_b13a_telemetry_rls_hardening.sql`
    4. `20261120000004_b13b_telemetry_retention.sql`
    5. `20261122000001_b18c_profile_rls_separation.sql`
    6. `20261122000002_b18c_telemetry_token_bucket.sql`
    7. `20261122000003_b18c_telemetry_search_path_hardening.sql`
    8. `20261122000004_b18d_telemetry_token_bucket_input_validation.sql`
    9. `20261123000001_b19_5_05_db_integrity_and_rls_hardening.sql`
    10. `20261123000002_b19_5_06_storage_buckets_and_rls.sql`
  - Run: `npx supabase db push`

- [ ] **Item 11: Verify `schema_migrations` Audit History**
  - Verify remote `supabase_migrations.schema_migrations` contains all 10 entries with zero discrepancies.
  - Run: `node scripts/migration-workflow.mjs --status`

- [ ] **Item 12: Verify Public Schema Tables & RLS Policies**
  - Verify all 15 public tables exist:
    `user_profiles`, `guest_identity_links`, `game_saves`, `game_save_revisions`, `entitlements`, `entitlement_audit`, `purchase_receipts`, `telemetry_events`, `remote_config`, `owner_roles`, `user_private_settings`, `rate_limit_buckets`, `telemetry_token_buckets`, `telemetry_daily_rollups`, `backup_audit_log`.
  - Confirm 100% of tables have Row Level Security (`ENABLE ROW LEVEL SECURITY`) activated.
  - Verify all 49 RLS policies are active.

- [ ] **Item 13: Verify Storage Buckets Provisioning**
  - Verify `avatars` bucket: private, 512 KiB limit, mime types `image/png`, `image/jpeg`, `image/webp` (NO SVG).
  - Verify `user-artwork` bucket: private, 5 MiB limit, mime types `image/png`, `image/webp`, `application/json`.
  - Confirm zero public read access on both buckets.

- [ ] **Item 14: Verify Storage Object RLS Policies**
  - Confirm `(storage.foldername(name))[1] = auth.uid()::text` owner prefix policy on `storage.objects`.
  - Verify path-traversal denial: `name !~ '(^|/)\.\.(/|$)'`.

---

## Part 4: Edge Functions & Serverless API Activation (Items 15–16)

- [ ] **Item 15: Deploy All 6 Supabase Edge Functions**
  - Deploy functions to Supabase:
    1. `npx supabase functions deploy sync-save`
    2. `npx supabase functions deploy ingest-telemetry`
    3. `npx supabase functions deploy cleanup-telemetry`
    4. `npx supabase functions deploy delete-account`
    5. `npx supabase functions deploy owner-metrics`
    6. `npx supabase functions deploy verify-entitlements`

- [ ] **Item 16: Verify Edge Function Health & CORS Responses**
  - Send OPTIONS preflight requests to all 6 endpoints; verify `Access-Control-Allow-Origin: *` and 200 OK.
  - Verify unauthenticated POST/GET returns sanitized HTTP 401 `UNAUTHORIZED` with zero stack traces or internal leaks.

---

## Part 5: Staging Deployment & Live End-to-End Validation (Items 17–20)

- [ ] **Item 17: Deploy Static Site to Cloudflare Pages Staging**
  - Confirm static build: `npm run build`.
  - Deploy allowlisted artifact to Cloudflare Pages staging project `auromasti`.
  - Verify security headers on staging: `_headers` and `_routes.json` active on `https://staging.auromasti.pages.dev`.

- [ ] **Item 18: Live End-to-End Cloud Smoke Test on Staging**
  - Test guest identity initialization (`guest_<uuid>`).
  - Test anonymous game launch and progress saving for AuroMandala, MaaMATCH, and MaaBLOCK.
  - Test authenticated sign-in and guest identity linking.
  - Test game save cloud synchronization (`sync-save` endpoint).
  - Test telemetry batch dispatch with user consent (`ingest-telemetry` endpoint).
  - Confirm Sankalpa vault entries remain strictly local (zero cloud transmission).

- [ ] **Item 19: Verify Owner Analytics Dashboard Access**
  - Sign in with authorized owner account.
  - Access `/owner-analytics/` on staging.
  - Confirm `owner-metrics` Edge Function verifies `public.owner_roles` role='owner' and renders sanctuary intelligence metrics.
  - Verify non-owner accounts receive HTTP 403 `FORBIDDEN_OWNER_ROLE_REQUIRED`.

- [ ] **Item 20: Product Owner Acceptance & Release Sign-Off**
  - Present live staging evidence to Product Owner.
  - Confirm all 20 checklist items have passed.
  - Lock release candidate v2.0.0 Beta for January 1, 2027 production cutover.
