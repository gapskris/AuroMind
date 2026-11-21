# B18-A — Security, Privacy & Architectural Risk Register

**Author:** AuroMind Platform Architecture Team  
**Date:** November 21, 2026  
**Canonical Workspace:** `C:\AuroMindPortal`  
**Active Git Branch:** `dev/studio-integration`  
**Baseline HEAD Commit:** `b6ccc860bb7d38a70ef678049a9588b8b73c40aa`  
**Target Release:** January 1, 2027  

---

## 1. Executive Risk Summary

AuroMasti is designed as a mindful, contemplative digital sanctuary. As we prepare to introduce the Supabase cloud backend in B18-C, technical security and spiritual privacy must be uncompromisingly aligned.

This register catalogs identified security, architectural, and operational risks, assigns severity ratings, evaluates current mitigations, and sets out mandatory requirements that must be resolved prior to B18-C.

---

## 2. Risk Matrix & Status Overview

| Risk ID | Category | Risk Description | Inherent Severity | Current Mitigation Status | Residual Risk | Target Resolution |
|:---:|:---|:---|:---:|:---|:---:|:---:|
| **SEC-01** | **Backend Credentials** | Service role key or database master credentials accidentally committed or passed to client browser. | **CRITICAL** | Automated checks throw runtime errors in `supabase-client.js` and `backend-config.js`. Zero keys in git. | **LOW** | Maintained across all future PRs |
| **SEC-02** | **Sacred Privacy** | Leakage of AuroMandala Sankalpa contemplation vault to cloud database during sync or telemetry. | **CRITICAL** | Triple-tier isolation: `cloudSyncEligible: false`, sync service exclusion, migration regex gate. | **NEGLIGIBLE** | Verified in automated tests |
| **SEC-03** | **Player Isolation** | Multi-user device cross-contamination when switching between accounts on a shared tablet/PC. | **HIGH** | LocalStorage is device-scoped; guest data survives sign out. | **MEDIUM** | **MANDATORY RESOLUTION in B18-C** |
| **SEC-04** | **Database Authorization** | Missing or overly permissive Row Level Security (RLS) on PostgreSQL tables (`game_saves`, etc.). | **CRITICAL** | Proposed RLS policies enforce `auth.uid() = user_id`; direct table updates blocked via RPC. | **LOW** | **MANDATORY VALIDATION in B18-C** |
| **SEC-05** | **Telemetry Flooding / DoS** | Malicious or buggy client flooding `ingest-telemetry` endpoint with massive payloads. | **HIGH** | Edge Function enforces 64 KiB payload limit, 50-event batch cap, and sliding-window rate limit. | **LOW** | Verified in automated tests |
| **SEC-06** | **Client-Side Tampering** | Client spoofing save revisions, tampering with level completions, or forging high scores. | **MEDIUM** | In-game saves are single-player; server validates envelope schema, revision count, and timestamps. | **LOW** | Accepted risk for local-first single-player |
| **SEC-07** | **Entitlement Bypassing** | Players modifying localStorage to bypass commercial level gates. | **HIGH** | Commercial gate disabled in beta. Production architecture requires server-signed JWT claims. | **LOW** | Enforced when commercialization approved |
| **SEC-08** | **Corpus Tampering** | Accidental or malicious corruption of VAK 1,368-level corpus or Flora database. | **HIGH** | Bit-for-bit SHA-256 automated regression tests (`9fdb3826...`, `689d035c...`). | **NEGLIGIBLE** | Verified in every test suite |

---

## 3. In-Depth Risk Analysis & Mandatory Mitigations

### SEC-01: Backend Credential Leakage Prevention
- **Threat Scenario:** A developer or script exposes `SUPABASE_SERVICE_ROLE_KEY` in `index.html`, `backend-config.js`, or client bundle, granting full administrative bypass of Row Level Security to anyone inspecting browser network traffic.
- **Current Safeguards:**
  1. `assets/sdk/config/backend-config.js` ([Line 68](file:///C:/AuroMindPortal/assets/sdk/config/backend-config.js#L68-L73)):
     ```javascript
     if (raw.serviceRoleKey || (typeof supabaseAnonKey === 'string' && supabaseAnonKey.includes('service_role'))) {
       const err = new Error('SECURITY VIOLATION: Service role key must NEVER be passed to frontend configuration');
       err.code = 'SERVICE_ROLE_KEY_FORBIDDEN';
       throw err;
     }
     ```
  2. `assets/sdk/providers/supabase/supabase-client.js` ([Line 26](file:///C:/AuroMindPortal/assets/sdk/providers/supabase/supabase-client.js#L26-L34)):
     Throws `SupabaseClientError('SECURITY_VIOLATION: SUPABASE_SERVICE_ROLE_KEY cannot be used in browser client code.', 403)`.
- **Pre-B18-C Requirement:** Maintain continuous pre-commit scanning to ensure no service-role credentials ever enter the repository.

---

### SEC-02: Sankalpa Contemplation Privacy Invariant
- **Threat Scenario:** A player writes deep, personal spiritual prayers or contemplative notes in AuroMandala. If cloud sync is turned on, unencrypted spiritual reflections could be transmitted to an external cloud database.
- **Current Safeguards:**
  1. In `games/auromandala/assets/auromandala-sdk-bridge.js`, `capabilities.cloudSyncEligible` is hardcoded to `false`, and `localOnlyVaults: ['sankalpa_e2ee_vault']` is registered.
  2. In `assets/sdk/auromind-sdk.js` ([Line 1723](file:///C:/AuroMindPortal/assets/sdk/auromind-sdk.js#L1723-L1726)), `syncService.syncNow()` skips any game declaring local-only vaults.
  3. In `assets/sdk/migration/backend-migration.js` ([Line 53](file:///C:/AuroMindPortal/assets/sdk/migration/backend-migration.js#L53-L56)), export payloads are cryptographically rejected if `sankalpa` tokens are present.
- **Pre-B18-C Requirement:** Zero backend tables may ever be created with columns designed to store raw Sankalpa text.

---

### SEC-03: Multi-User Device Cross-Contamination
- **Threat Scenario:** On a shared family tablet or public kiosk, Player A plays as a guest and unlocks 50 levels. Player A logs into Account A and syncs. Later, Player A logs out. Player B picks up the device. If the SDK does not isolate or prompt on logout, Player B might see Player A's local saves, or Player B's new progress might erroneously merge into Player A's cloud save on subsequent login.
- **Current Safeguards:**
  - Guest identity is stable per browser profile.
  - Signing out invokes `providers.auth.signOut()` and clears the session JWT, but deliberately does not wipe local game saves to prevent accidental guest progress deletion.
- **Mandatory Pre-B18-C Resolution:**
  - Introduce an explicit **Session Boundary Modal** upon `signOut()`:
    1. *Option A (Keep Local Progress for Next Guest):* Leaves saves in place, unlinks cloud sync consent.
    2. *Option B (Clear Device Data for New Player):* Executes `clearPortalPreferencesOnly()` and scoped game save resets.
  - In `upgradeGuestToAccount()`, if the target cloud account already contains cloud saves differing from the local device saves, trigger `ADR-06` user conflict resolution modal rather than silently merging.

---

### SEC-04: Supabase Row Level Security (RLS) Architecture
- **Threat Scenario:** An attacker intercepts the anonymous client API key (`anonKey`) and attempts to execute direct SQL queries against `game_saves` or `guest_identity_links` to view or modify other players' data.
- **Mandatory Pre-B18-C RLS Specifications:**
  When Supabase SQL migrations are introduced in B18-C, the following RLS policies must be applied:

```sql
-- 1. Enable RLS on all platform tables
ALTER TABLE game_saves ENABLE ROW LEVEL SECURITY;
ALTER TABLE guest_identity_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE telemetry_events ENABLE ROW LEVEL SECURITY;

-- 2. Game Saves Policies
CREATE POLICY "Users can only read own game saves"
  ON game_saves FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can only insert/update own game saves"
  ON game_saves FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can only modify own game saves"
  ON game_saves FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can only delete own game saves"
  ON game_saves FOR DELETE
  USING (auth.uid() = user_id);

-- 3. Entitlements Policies (Read-Only for users; Writes restricted to Service Role)
CREATE POLICY "Users can read own active entitlements"
  ON entitlements FOR SELECT
  USING (auth.uid() = user_id AND status = 'active');

-- Zero INSERT/UPDATE/DELETE policies for public anon users on entitlements!
```

---

### SEC-05: Telemetry Transport Bounding & Rate Limiting
- **Threat Scenario:** A rogue client script loops and floods the telemetry ingestion API, consuming Supabase free tier database quota or Edge Function compute limits.
- **Current Safeguards:**
  1. Edge Function `supabase/functions/ingest-telemetry/telemetry-handler.js`:
     - Checks content length: max 64 KiB.
     - Checks batch size: max 50 events.
     - Rate limits per IP / guest ID: max 60 requests/minute. Returns HTTP 429 with `Retry-After`.
     - Validates event schema version and strips sensitive keys.
  2. Client Queue Cap:
     - `auromind-sdk.js` limits in-memory queue to 200 events. Oldest non-critical events are dropped if the queue overflows while offline.
- **Pre-B18-C Requirement:** Edge Function rate-limiting rules must be tested against live Supabase emulators prior to production launch.

---

### SEC-06: Content Security Policy (CSP) Enforcement
- **Threat Scenario:** XSS vulnerability in a game or portal allows an attacker to execute malicious scripts, stealing guest tokens or intercepting local storage.
- **Current Safeguards:**
  - `server.js` serves a robust CSP:
    ```http
    Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https:; frame-src 'self'; object-src 'none'; base-uri 'self';
    ```
  - AuroBlocks inline initialization scripts were extracted in B17.4 into an external bundle (`auroblocks-init.js`), eliminating all CSP violations.
- **Pre-B18-C Requirement:** Ensure production CDN / hosting configuration (Vercel, Cloudflare, or GitHub Pages) mirrors the exact CSP headers defined in `server.js`.
