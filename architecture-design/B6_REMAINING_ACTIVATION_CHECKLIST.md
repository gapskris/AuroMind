# AuroMind — Batch B6 Production Activation Checklist & Operator Guide

**Document ID:** `B6_REMAINING_ACTIVATION_CHECKLIST.md`  
**Date:** 2026-11-20  
**Status:** READY FOR OPERATOR EXECUTION  
**Scope:** Production Activation Procedures for Live Supabase, Edge Functions, Owner Role, Protected Hosting, Backups & Rollback  
**Primary Working Directory:** `C:\AuroMind_Studio`  
**Git Reference Directory:** `C:\AuroMindPortal` (`dev/studio-integration`, commit `67d0472` - pristine)  

---

## 1. Implementation & Verification Status Taxonomy

To eliminate ambiguity between code completion and external provisioning, AuroMind platform capabilities are classified into four distinct operational states:

| Capability / Component | Implemented | Locally Tested | Live Connected | Production Verified | Current Status & Notes |
|---|:---:|:---:|:---:|:---:|---|
| **Core Shared SDK (UUIDv4 & Dual Storage)** | **YES** | **YES** | **N/A** | **YES** | 31/31 unit tests passing; auto-heals across IDB/LS corruptions. |
| **Launch Game Adapters (VAK, Match, Mandala)** | **YES** | **YES** | **N/A** | **YES** | Adapters conform to contract; VAK corpus 100% byte-intact. |
| **Sankalpa E2EE Vault Zero-Leakage** | **YES** | **YES** | **N/A** | **YES** | PBKDF2/AES-GCM encrypted; `cloudSyncEligible: false` enforced. |
| **Compatibility Games (Riddle, Sanctuary, Blocks)** | **YES** | **YES** | **N/A** | **YES** | Standalone save structures; isolated service worker caches. |
| **Provider-Independent Services (Logging, Telemetry)**| **YES** | **YES** | **N/A** | **YES** | 10/10 test suites pass; PII redactor & consent purge verified. |
| **Centralized Provider Configuration** | **YES** | **YES** | **N/A** | **YES** | Externalized via `backend-config.js`; service role key blocked. |
| **Database Migrations (10 Tables, RLS, Triggers)** | **YES** | **YES** | PENDING | PENDING | Complete SQL schema ready; awaiting remote DB push. |
| **Optimistic Concurrency RPC (`upsert_game_save`)** | **YES** | **YES** | PENDING | PENDING | Stored procedure & archive trigger implemented; tested in mocks. |
| **Edge Functions (`sync-save`, `owner-metrics`, etc.)**| **YES** | **YES** | PENDING | PENDING | Deno function scripts ready in `supabase/functions/`. |
| **Dedicated Owner Analytics Auth & Gate** | **YES** | **YES** | PENDING | PENDING | Admin login, recovery, session expiry & role check verified. |
| **GitHub Pages Allowlist Pipeline** | **YES** | **YES** | PENDING | PENDING | Manual `workflow_dispatch` configured with asset allowlist. |
| **Live Supabase Project Provisioning** | **N/A** | **N/A** | PENDING | PENDING | External operator action required (Supabase dashboard). |
| **Payment Provider (Stripe) Credentials** | **N/A** | **N/A** | PENDING | PENDING | External operator action required (Stripe dashboard). |

---

## 2. Step 1: Provisioning the Supabase Project

1. Log in to the [Supabase Dashboard](https://supabase.com/dashboard).
2. Create a new production project:
   - **Name:** `auromind-production` (or `auromasti-production`).
   - **Database Password:** Generate a secure 32+ character password.
   - **Region:** Select a region optimal for the player base (e.g. `ap-south-1` Mumbai or `ap-southeast-1` Singapore).
3. Once provisioned, navigate to **Project Settings -> API** and record:
   - **Project URL:** `https://<project-ref>.supabase.co`
   - **Anon Public API Key:** `eyJhbGciOi...` (`anon` / `public`)
   - **Service Role Secret Key:** `eyJhbGciOi...` (`service_role` — **CONFIDENTIAL: NEVER PASS TO BROWSER CLIENTS**)

---

## 3. Step 2: Database Migration Application

The full database schema is located at:
`supabase/migrations/20261120000001_b5_core_schema.sql`

### Execution via Supabase CLI (Recommended):
```bash
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push
```

### Verification Query:
Confirm that all 10 tables and RLS are active:
```sql
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
ORDER BY tablename;
```
*Expected: 10 tables (`entitlement_audit`, `entitlements`, `game_save_revisions`, `game_saves`, `guest_identity_links`, `owner_roles`, `purchase_receipts`, `remote_config`, `telemetry_events`, `user_profiles`), all showing `rowsecurity = true`.*

---

## 4. Step 3: Edge Function Deployment

Deploy the five serverless Edge Functions from the project root:

```bash
# 1. Cloud Save Synchronization & Concurrency Validation
npx supabase functions deploy sync-save --no-verify-jwt

# 2. Privacy-Compliant Telemetry Ingestion
npx supabase functions deploy ingest-telemetry --no-verify-jwt

# 3. Server-Authoritative Entitlement Verification
npx supabase functions deploy verify-entitlements

# 4. Owner-Only Business Analytics Metrics
npx supabase functions deploy owner-metrics

# 5. GDPR-Compliant Account Deletion
npx supabase functions deploy delete-account
```

### Configure Secrets on Edge Functions:
```bash
npx supabase secrets set SUPABASE_SERVICE_ROLE_KEY="<your-service-role-key>"
# If integrating Stripe for one-time payments:
# npx supabase secrets set STRIPE_SECRET_KEY="sk_live_..."
# npx supabase secrets set STRIPE_WEBHOOK_SECRET="whsec_..."
```

---

## 5. Step 4: Owner Account Provisioning & Role Assignment

Access to the Owner Analytics Dashboard (`/owner-analytics/`) requires explicit authorization in `public.owner_roles`.

### Procedure:
1. Create your administrator account via the portal Auth modal or Supabase Auth Dashboard -> Users -> Invite User.
2. Copy the user UUID from the Supabase Authentication dashboard.
3. In the Supabase SQL Editor, execute:

```sql
INSERT INTO public.owner_roles (user_id, role, permissions)
VALUES (
  '<YOUR-USER-UUID-HERE>',
  'owner',
  '{"analytics": true, "entitlements": true, "config": true}'::jsonb
)
ON CONFLICT (user_id) 
DO UPDATE SET 
  role = EXCLUDED.role,
  permissions = EXCLUDED.permissions,
  updated_at = NOW();
```

---

## 6. Step 5: Public Frontend & Centralized Configuration

Configure the public client runtime with the project's externalized URL and public anon key.

### Configuration Injection:
In `index.html` (or via an injected deployment script `assets/js/env-config.js`):
```html
<script>
  window.__AUROMIND_SUPABASE_CONFIG__ = {
    supabaseUrl: "https://<project-ref>.supabase.co",
    supabaseAnonKey: "eyJhbGciOi..." // ANON KEY ONLY!
  };
</script>
```

> [!CAUTION]
> **NEVER PASS `SUPABASE_SERVICE_ROLE_KEY` TO FRONTEND CLIENTS.**
> Both `assets/sdk/config/backend-config.js` and `supabase-client.js` will immediately throw `SERVICE_ROLE_KEY_FORBIDDEN` if a service-role secret is detected.

---

## 7. Step 6: Protected Owner Analytics Hosting Arrangement

The Owner Analytics dashboard at `/owner-analytics/` contains **zero static data or credentials**. The dashboard client is 100% locked behind a dedicated Administrator Login Gate until authenticated via Supabase Auth and verified by `/functions/v1/owner-metrics`.

Operators may choose between two hosting models:

### Model A: Co-Hosted on GitHub Pages with Zero-Trust Edge Gate (Standard)
- Deployed alongside the public portal at `https://gapskris.github.io/AuroMind/owner-analytics/`.
- **Protection Architecture:**
  - When loaded, the dashboard UI is completely hidden; only the Administrator Sign-In form is rendered.
  - Submitting credentials verifies password with Supabase Auth, then calls `/functions/v1/owner-metrics` with the user's JWT.
  - If the user is not present in `public.owner_roles` with `role = 'owner'`, the Edge Function returns HTTP 403 Forbidden. The client shows an "Access Denied" error and immediately purges the session.
  - Zero private analytics data or secrets are exposed in the HTML/JS bundle.

### Model B: Isolated Private Host / Cloudflare Access (Strict Defense-in-Depth)
- For organizations requiring network-level invisibility:
  - Exclude `owner-analytics/` from the GitHub Pages workflow.
  - Deploy `owner-analytics/` as an independent static site on Cloudflare Pages or Netlify under a private subdomain (e.g. `owner.auromind.org`).
  - Protect the domain with Cloudflare Zero Trust / Cloudflare Access (requiring corporate SSO or email OTP before the page even loads).
  - The client still communicates with the same production Supabase project via the verified Owner JWT.

---

## 8. Step 7: Payment-Provider (Stripe) Integration Requirements

AuroMind's commercial model consists strictly of **ad-free, one-time premium purchases** (no subscriptions, no paywalls on spiritual contemplation):

### Products & SKU Tiers:
- `supporter`: Contemplative patron badge and aesthetic themes.
- `founder`: Lifetime access to bonus modes and expansion audio tracks.
- `game_pass_<gameId>`: Optional single-game expansion passes.

### Stripe Webhook Configuration:
1. In the Stripe Dashboard, create Products matching the SKU IDs above.
2. Configure a Webhook Endpoint pointing to:
   `https://<project-ref>.supabase.co/functions/v1/verify-entitlements`
3. Listen for event: `checkout.session.completed`.
4. The Edge Function verifies the Stripe signature and atomically records the purchase in `public.entitlements` and `public.entitlement_audit`.

---

## 9. Step 8: Backup and Recovery Requirements

### 9.1 Database Backup Architecture
- **Automated Daily Backups:** Enabled via Supabase Pro tier (7-day to 30-day retention).
- **Point-in-Time Recovery (PITR):** Enables restoring database state to any specific second in the event of operator error.
- **Manual Logical Snapshot (`supabase db dump`):**
  ```bash
  # Dump complete schema and data
  npx supabase db dump -f auromind_backup_$(date +%Y%m%d).sql
  ```

### 9.2 Table-Level Save Revision Recovery
Every update to `public.game_saves` automatically executes the PostgreSQL trigger `trg_archive_game_save`, snapshotting the prior revision into `public.game_save_revisions`.
- **Accidental Save Corruption Rollback:**
  If a client submits a corrupted save, the prior revision can be restored with a single SQL query:
  ```sql
  UPDATE public.game_saves s
  SET 
    payload = r.payload,
    checksum = r.checksum,
    revision = s.revision + 1,
    client_updated_at = NOW()
  FROM public.game_save_revisions r
  WHERE s.user_id = '<user-id>' 
    AND s.game_id = '<game-id>'
    AND r.user_id = s.user_id
    AND r.game_id = s.game_id
    AND r.revision = <desired-prior-revision>;
  ```

### 9.3 Client-Side Storage Auto-Healing
If a player's browser cache is partially cleared or IndexedDB is corrupted, the SDK automatically recovers the player's `guestId` and preferences from the `localStorage` mirror and re-heals IndexedDB without data loss.

---

## 10. Step 9: Production Smoke Tests & Rollback Procedure

### 10.1 Production Smoke Test Checklist

Execute these 8 verification steps on the live URL:

| Step | Action | Expected Behavior | Status |
|:---:|---|---|:---:|
| **1** | Open live portal URL as new guest | Stable UUIDv4 guest ID created in dual stores; portal shell loads. | [ ] |
| **2** | Launch VAK, AuroMatch, AuroMandala | Games launch in theater; shared guest ID verified in identity banner. | [ ] |
| **3** | Record Sankalpa prayer in AuroMandala | Prayer saved to local E2EE vault; network log confirms zero cloud sync. | [ ] |
| **4** | Toggle Telemetry consent to "ON" | Telemetry events queued and batch dispatched to Supabase. | [ ] |
| **5** | Sign in as regular player | Guest identity linked to `auth.users`; local game progress intact. | [ ] |
| **6** | Trigger Cloud Save Sync | Save pushed with `revision: 1` in `public.game_saves`. | [ ] |
| **7** | Disconnect WiFi / Go Offline | Games remain 100% playable; SDK functions fail-open gracefully. | [ ] |
| **8** | Access `/owner-analytics/` as Owner | Dedicated login displays; sign in succeeds; server metrics render. | [ ] |

### 10.2 Production Rollback Procedure

If a critical issue occurs post-deployment:

1. **Frontend Rollback (GitHub Pages):**
   - Re-run the GitHub Actions workflow targeting the previous known-good commit:
     `git tag -l` -> select release tag -> Trigger `Deploy static content to Pages` workflow.
   - GitHub Pages completes static rollback in under 90 seconds.
2. **Database Schema Rollback:**
   - Execute targeted down-migration or restore from PITR snapshot via the Supabase Dashboard.
3. **Emergency Client Fail-Safe:**
   - If Supabase becomes unresponsive, the client automatically defaults to **Offline-Safe Mode**. Gameplay, local progress, and guest identity function continuously without downtime.
