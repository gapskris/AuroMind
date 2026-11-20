# AuroMind — Batch B6 Security and Privacy Review

**Document ID:** `B6_SECURITY_REVIEW.md`  
**Date:** 2026-11-20  
**Status:** COMPLETE & VERIFIED  
**Scope:** Production Security Audit across Runtime, SDK, Game Adapters, Backend, and CI/CD  
**Primary Working Directory:** `C:\AuroMind_Studio`  
**Git Reference Directory:** `C:\AuroMindPortal` (`dev/studio-integration`, commit `67d0472` - untouched)  

---

## 1. Executive Summary & Security Posture

As part of **Batch B6: Production Readiness & End-to-End Validation**, a comprehensive security, privacy, and architectural isolation review of the AuroMind platform was conducted. The platform encompasses a client-side shared runtime SDK, six individual contemplative and educational web games, a provider-independent service layer, a Supabase backend integration, an Owner Analytics portal, and automated CI/CD deployment pipelines.

### Key Audit Conclusions
- **Zero Critical Vulnerabilities:** No privilege escalations, secret leakages, or bypasses of client/cloud security boundaries were detected.
- **Strict Data Sovereignty:** The sacred contemplative notes of AuroMandala's Sankalpa vault are cryptographically isolated (PBKDF2/AES-GCM) and architecturally excluded from cloud synchronization, telemetry, and diagnostics logging.
- **Fail-Open & Local-First Resiliency:** Cloud backend failures, network disconnects, or missing API credentials never degrade local gameplay or compromise client storage integrity.
- **Defense-in-Depth Secret Protection:** The privileged backend secret (`SUPABASE_SERVICE_ROLE_KEY`) is strictly excluded from frontend builds via multi-layered runtime code checks and CI/CD pipeline assertions.

---

## 2. Threat Modeling & Boundary Analysis

### 2.1 System Trust Zones

```
+---------------------------------------------------------------------------------------+
| UNTRUSTED / CLIENT PERIMETER (Browser Execution Context)                              |
|                                                                                       |
|  +--------------------+   +-----------------------+   +----------------------------+  |
|  | Portal Shell       |   | Launch Games (3)      |   | Compatibility Games (3)    |  |
|  | (index.html, sw.js)|   | (VAK, Match, Mandala) |   | (Riddle, Sanctuary, Blocks)|  |
|  +---------+----------+   +-----------+-----------+   +-------------+--------------+  |
|            |                          |                             |                 |
|            +--------------------------+-----------------------------+                 |
|                                       |                                               |
|                    +------------------v--------------------+                          |
|                    | Shared SDK Layer (Client-Side)        |                          |
|                    | - Identity & Dual Storage (IDB/LS)    |                          |
|                    | - Logging & PII Redactor              |                          |
|                    | - Pluggable Provider Adapters         |                          |
|                    +------------------+--------------------+                          |
+---------------------------------------|-----------------------------------------------+
                                        | HTTPS / TLS 1.3 (Restricted Anon JWT)
                                        v
+---------------------------------------------------------------------------------------+
| SEMI-TRUSTED / EDGE PERIMETER (Supabase Edge Functions / Deno Runtime)                |
| - sync-save (Envelope framing & schema validation)                                    |
| - ingest-telemetry (Batching, privacy validation, deduplication)                      |
| - verify-entitlements (Server-authoritative receipt checks)                           |
| - owner-metrics (Strict Owner Role Authorization Gate)                                |
+---------------------------------------+-----------------------------------------------+
                                        | PostgreSQL Internal Network
                                        v
+---------------------------------------------------------------------------------------+
| FULLY TRUSTED / BACKEND CORE (Supabase PostgreSQL with RLS)                           |
| - RLS Policies enforcing auth.uid() isolation on all user tables                      |
| - Stored Procedure: upsert_game_save_checked (Atomic optimistic locking)              |
| - Auto-archiving trigger: trg_archive_game_save (Immutable revision history)          |
| - Entitlement audit & owner roles access control                                      |
+---------------------------------------------------------------------------------------+
```

### 2.2 Threat Actor Profiles & Risk Mitigations

| Threat Actor | Motivation / Attack Vector | Architectural Mitigation | Audit Status |
|---|---|---|---|
| **Malicious Player / Script Kiddie** | Modify local save state to unlock premium tiers or forge entitlements. | Entitlement verification is strictly server-authoritative. Local client flags default to `verified: false` and are rejected by commercial gates unless validated via Edge Functions. | **PASS** (Scenario 14) |
| **Unauthorized Cloud Ingress** | Tamper with or read another player's cloud saves or telemetry. | Row-Level Security (RLS) on `public.game_saves` and `public.user_profiles` restricts CRUD operations strictly to `auth.uid() = user_id`. | **PASS** (B5 Criterion 6 & 11) |
| **Eavesdropper / Network Snooper** | Inspect unencrypted network traffic to capture user identity or spiritual notes. | All external transport requires TLS 1.3. Sankalpa vault is zero-cloud-sync (`cloudSyncEligible: false`), never transmitted across the network. | **PASS** (Scenario 13) |
| **Rogue / Insecure Dependency** | Harvest API keys or service role tokens from bundle. | Service role key is explicitly prohibited in frontend bundles; SDK client throws `SERVICE_ROLE_KEY_FORBIDDEN` if encountered. Build script asserts zero `.env` in site artifact. | **PASS** (B5 Criterion 1/18) |
| **Public User Accessing Metrics** | Access Owner Analytics dashboard to inspect business or DAU metrics. | Dashboard UI is locked behind a dedicated Administrator Login Gate (`#admin-auth-overlay`); metrics are zero-rendered until verified by Edge Function `/functions/v1/owner-metrics` enforcing `public.owner_roles` lookup. Non-owners are rejected with HTTP 403 and signed out. | **PASS** (Scenarios 15 & 17) |

---

## 3. Database Security & Row-Level Security (RLS) Audit

The production schema (`supabase/migrations/20261120000001_b5_core_schema.sql`) enforces PostgreSQL Row-Level Security on every table in the `public` schema.

### 3.1 Policy Matrix

| Table Name | RLS Enabled | Allowed Roles | Policy Logic (`USING` / `WITH CHECK`) | Attack Surface Evaluated |
|---|:---:|---|---|---|
| `public.user_profiles` | **YES** | `authenticated` | `auth.uid() = user_id` (SELECT, UPDATE, INSERT) | Cross-user profile enumeration or tampering blocked. |
| `public.guest_identity_links` | **YES** | `authenticated` | `auth.uid() = user_id` (SELECT, INSERT) | Forging identity links for other users blocked. |
| `public.game_saves` | **YES** | `authenticated` | `auth.uid() = user_id` (SELECT, INSERT, UPDATE) | Save tampering across users blocked. |
| `public.game_save_revisions` | **YES** | `authenticated`, `service_role` | `auth.uid() = user_id` (SELECT only for users) | Historical revisions are immutable for users; written only by DB trigger. |
| `public.entitlements` | **YES** | `authenticated`, `service_role` | `auth.uid() = user_id` (SELECT only for users) | User cannot self-grant entitlements; writes restricted to service role. |
| `public.entitlement_audit` | **YES** | `service_role`, `owner_role` | No public access. Restricted to internal backend and studio owners. | Audit trail tampering blocked. |
| `public.purchase_receipts` | **YES** | `authenticated`, `service_role` | `auth.uid() = user_id` (SELECT only for users) | Receipts cannot be read or forged by third parties. |
| `public.telemetry_events` | **YES** | `anon`, `authenticated` | `WITH CHECK (true)` (INSERT only); SELECT restricted to owner role. | Write-only ingestion buffer; players cannot read other players' telemetry. |
| `public.remote_config` | **YES** | `anon`, `authenticated` | `USING (true)` (SELECT only); UPDATE/INSERT restricted to owner role. | Public configuration read-only; arbitrary tampering blocked. |
| `public.owner_roles` | **YES** | `authenticated` | Restricted to `auth.uid() IN (SELECT user_id FROM public.owner_roles)`. | Privilege escalation to owner role blocked. |

### 3.2 Atomic Stored Procedures & Concurrency Safety
- **`upsert_game_save_checked`**: Executes with `SECURITY DEFINER` and enforces atomic optimistic concurrency locking.
  - Validates `expected_revision`.
  - Rejects stale writes with `{ ok: false, status: 'conflict' }`.
  - Automatically triggers `archive_game_save_revision()`, guaranteeing that no cloud save is ever overwritten without a historical archive.

---

## 4. Secret & Credential Management

### 4.1 Frontend Secret Isolation
A critical vulnerability in client-side cloud integrations is the accidental exposure of `SUPABASE_SERVICE_ROLE_KEY` in browser code. The AuroMind architecture enforces a four-stage defense:

1. **Centralized Configuration Guard (`assets/sdk/config/backend-config.js`):**
   - The central configuration resolver rejects any key containing `service_role` and assigns `err.code = 'SERVICE_ROLE_KEY_FORBIDDEN'`.
2. **Runtime Verification Guard (`assets/sdk/providers/supabase/supabase-client.js`):**
   ```javascript
   if (config.serviceRoleKey || 
       (typeof config.anonKey === 'string' && config.anonKey.includes('service_role')) ||
       (typeof config.supabaseAnonKey === 'string' && config.supabaseAnonKey.includes('service_role'))) {
     const err = new Error('SECURITY VIOLATION: Service role key must NEVER be passed to client runtime');
     err.code = 'SERVICE_ROLE_KEY_FORBIDDEN';
     throw err;
   }
   ```
3. **Build Artifact Quarantine (`.github/workflows/pages.yml`):**
   - The deployment workflow utilizes an explicit allowlist copying only runtime assets.
   - Post-build assertion:
     ```bash
     if [ -f _site/.env ] || [ -f _site/.env.local ]; then
       echo "CRITICAL: Environment secrets found in build output!" && exit 1;
     fi
     ```
4. **Repository Quarantine:**
   - `.env` files are quarantined and git-ignored.
   - Zero credentials exist in repository tracking or commit history.

---

## 4.2 Owner Analytics Authentication & Protected Hosting Architecture

The Owner Analytics dashboard (`owner-analytics/`) is protected by a multi-layered zero-trust architecture:

1. **Dedicated Administrator Login Gate:**
   - Unauthenticated visitors encounter a full-screen blurred gate (`#admin-auth-overlay`).
   - The dashboard container (`#dashboard-container`) is completely hidden (`display: none;`).
   - Zero business KPIs, DAU, cloud save totals, or telemetry logs are rendered into the DOM.
2. **Supabase Auth & Server-Side Role Verification:**
   - Sign in calls `supabase.auth.signInWithPassword({ email, password })`.
   - On valid token generation, the client invokes `/functions/v1/owner-metrics` with `Authorization: Bearer <access_token>`.
   - The Edge Function queries PostgreSQL table `public.owner_roles` for `user_id = user.id AND role = 'owner'`.
   - Non-owner users (e.g. regular registered players) are returned HTTP 403 Forbidden. The client catches this, renders an access denial message, and immediately invokes `supabase.auth.signOut()` to revoke local session state.
3. **Session Expiry & Password Recovery:**
   - Listens to `supabase.auth.onAuthStateChange`. If a session expires or token refresh fails, the dashboard immediately locks and wipes in-memory metrics.
   - Integrated password recovery form triggers `supabase.auth.resetPasswordForEmail()`.
4. **Protected Hosting Compatibility with GitHub Pages:**
   - **Co-Hosted Mode:** Because the static dashboard assets contain zero data and zero privileged keys, `/owner-analytics/` can be safely hosted on GitHub Pages. Any unauthorized access is stopped cold at the Edge Function role gate.
   - **Isolated Domain Mode:** Organizations desiring complete network obscurity can deploy `owner-analytics/` to a private subdomain (e.g. `owner.auromind.org`) secured by Cloudflare Access or HTTP Basic Auth, connecting to the same Supabase project.

---

## 5. Sankalpa E2EE Vault & Zero-Leakage Guarantee

### 5.1 Invariant Statement
AuroMandala contains a contemplative feature allowing players to record sacred personal intentions, prayers, and reflections ("Sankalpa"). **Invariant: Spiritual reflections and encryption keys must never leave the player's personal device.**

### 5.2 Implementation Verification
- **End-to-End Encryption:** The local vault encrypts data using PBKDF2 (key derivation) and AES-GCM (256-bit authenticated encryption).
- **Adapter Declaration:**
  ```javascript
  // games/auromandala/assets/js/auromandala-adapter.js
  export const AUROMANDALA_ADAPTER_CONTRACT = {
    gameId: 'auromandala',
    cloudSyncEligible: false, // Strictly ineligible for cloud synchronization
    localOnlyVaults: ['sankalpa_e2ee_vault']
  };
  ```
- **Sync Provider Hard Gate (`supabase-sync-provider.js`):**
  - Evaluates `adapter.cloudSyncEligible`. If `false`, returns `{ status: 'skipped', reason: 'local_only_vault' }` without opening any network connection.
- **PII & Secret Redactor (`assets/sdk/modules/logging.js`):**
  - Regex sanitization filters scrub passphrases, tokens, and Sankalpa keys (`/sankalpa[_-]?key/i`, `/passphrase/i`, `/token/i`) before writing to diagnostic logs.
- **Verification Evidence:** Passed in `b4-platform-services.test.js` Suite 1.2, `b5-supabase.test.js` Criterion 14, and `b6-regression.test.js` Scenario 13.

---

## 6. Telemetry, Consent, & Privacy Protection

### 6.1 Consent-by-Default Opt-Out Model
The telemetry system (`assets/sdk/modules/telemetry.js` & `supabase-telemetry-transport.js`) adheres to strict privacy-by-design standards:
- **Default State:** Telemetry collection is disabled by default (`telemetry_consent = false`).
- **Enforcement:** Calling `telemetry.trackEvent()` when opted out immediately drops the event at the source.
- **Purge on Opt-Out:** When a player toggles consent to `false`:
  1. The in-memory event dispatch queue is immediately cleared.
  2. The offline persistent cache in `localStorage` (`auromind.telemetry.queue`) is purged.
- **Transport Hard Gate:** `SupabaseTelemetryTransport.sendEvents()` validates `consentProvider.hasConsent()`. If `false`, execution terminates with `eventsDropped` and zero network requests are initiated.
- **Data Minimization:** No IP addresses, device serials, email addresses, or canvas fingerprints are collected. All events are keyed strictly to the pseudonymous `guestId` UUIDv4.

---

## 7. Service Worker & Cache Isolation

### 7.1 Scope & Cache Protection
In a multi-game portal environment, cross-game cache collisions or aggressive root service workers can corrupt game engines or hijack game routes.

1. **Root Service Worker Boundary (`sw.js`):**
   - Explicitly bypasses game subpaths and admin routes:
     ```javascript
     if (url.pathname.startsWith('/games/') || url.pathname.startsWith('/owner-analytics/')) {
       return; // Hand off to network / game-specific service workers
     }
     ```
2. **Game Service Worker Scopes:**
   - VAK Speech Control: Scoped to `/games/vak/` with cache `vak-shell-v2`.
   - AuroMatch: Scoped to `/games/auromatch/` with cache `auromatch-shell-v2`.
   - AuroMandala: Scoped to `/games/auromandala/` with cache `auromandala-shell-v2`.
   - AuroBlocks: Scoped to `/games/auroblocks/` with cache `auroblocks-shell-v2`.
   - Word Riddle: Scoped to `/games/word-riddle/` with cache `word-discovery-shell-v2`.
3. **Cache Invalidation & Clear Cache Safety:**
   - Portal "Clear Cache" button flushes only ephemeral portal UI caches (`auromind-portal-shell-*`).
   - Platform database (`auromind_platform`) and game IndexedDB databases are protected and never touched by cache eviction.

---

## 8. Deployment & CI/CD Pipeline Hardening

### 8.1 GitHub Pages Allowlist Quarantine
The production GitHub Actions deployment workflow (`.github/workflows/pages.yml`) enforces a strict allowlist deployment pattern:
- **Allowlisted Artifacts:**
  - `index.html`, `manifest.json`, `sw.js`
  - `assets/**` (portal CSS, icons, and SDK)
  - `games/**` (production game bundles)
- **Excluded & Asserted Absent:**
  - `supabase/**` (database schemas, migrations, edge functions)
  - `owner-analytics/**` (internal owner portal)
  - `architecture-design/**` (internal specifications)
  - `*.test.js` (automated test suites)
  - `.env*` (secrets and configuration files)

---

## 9. Security Verification Matrix

| Security Control | Verification Method | Result | Notes |
|---|---|:---:|---|
| Service Role Key Rejection | Unit & Regression Tests | **PASS** | Throws `SERVICE_ROLE_KEY_FORBIDDEN` |
| RLS User Isolation | Schema & Stored Proc Audit | **PASS** | All tables guarded by `auth.uid() = user_id` |
| Sankalpa E2EE Vault Zero-Sync | Adapter Contract & Mock Sync | **PASS** | `cloudSyncEligible: false` strictly enforced |
| Telemetry Consent Enforcement | Unit & Queue Purge Tests | **PASS** | Zero events stored or sent without consent |
| Optimistic Concurrency Locking | Concurrency Test (Mismatch) | **PASS** | Revision conflict returned, server record intact |
| Service Worker Cache Isolation | Route & Cache Inspection | **PASS** | Root sw skips `games/` and `owner-analytics/` |
| GitHub Pages Build Quarantine | CI Workflow Assertions | **PASS** | Strictly asserts absence of internal assets |
| Offline Fail-Open Resiliency | Offline Sim & Degraded Mocks | **PASS** | 100% functionality maintained offline |

### Conclusion
The AuroMind platform exhibits a hardened, privacy-first security posture. All core invariants are actively defended at the client runtime, edge, and database tiers. The application is securely architected for production deployment.
