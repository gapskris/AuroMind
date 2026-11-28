# B19.10 — Bucket 3: Edge Functions Comprehensive Inventory & Audit

**Project:** AuroMasti v2.0.0 Beta  
**Workspace:** `C:\AuroMindPortal`  
**Branch:** `dev/studio-integration`  
**Supabase Project:** `rlqrtbjynaihdspbqtce`  
**Region:** `ap-southeast-1`  
**Target Delivery:** November 30, 2026  
**Canonical Functions Count:** 6  
**Deployment Block Status:** Blocked on PAT CLI Permission Scope (`OWNER-OPS-03`)

---

## 1. Executive Summary

AuroMasti deploys exactly six canonical Edge Functions powering server-side logic, telemetry ingestion, maintenance, and synchronization.

Each function was audited across 12 rigorous architectural dimensions. All function implementations are complete, structurally verified, and aligned with release invariants (`COMMERCIAL_GATE_ENABLED=false`, zero player-data leakage, and local-first resilience).

Live remote CLI deployment was evaluated via `supabase functions list --remote=rlqrtbjynaihdspbqtce`. The Supabase CLI returned `HTTP 403: {"missing_permissions":["edge_functions_read"]}`, proving that the current Personal Access Token (`SUPABASE_ACCESS_TOKEN`) lacks Edge Functions administrative permissions. This has been registered as **`OWNER-OPS-03`** for Product Owner token regeneration in the Supabase Dashboard.

---

## 2. Comprehensive 12-Point Function Audits

### 2.1 Function: `cleanup-telemetry`
1. **Directory:** `supabase/functions/cleanup-telemetry/index.ts`
2. **Purpose:** Prunes expired telemetry event batches older than the configured retention policy (default 30 days) to prevent unbounded storage growth.
3. **HTTP Methods:** `POST`, `OPTIONS` (CORS preflight).
4. **Auth & Authorization:** Administrative / Scheduled cron invocation requiring `SUPABASE_SERVICE_ROLE_KEY` or valid internal admin authorization header.
5. **Database Objects Touched:** `public.telemetry_events` (`DELETE WHERE created_at < NOW() - INTERVAL '30 days'`).
6. **Storage Buckets:** None.
7. **Secrets Required:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
8. **Request Payload:** Optional JSON body `{ "retentionDays": 30, "dryRun": false }`.
9. **Response Schema:** `{ "ok": true, "deletedCount": <int>, "durationMs": <int> }` (Status: 200).
10. **Error Handling:** Returns structured JSON error `{ "ok": false, "error": "<msg>" }` (500). Sensitive DB stack traces redacted.
11. **Rate Limiting / Concurrency:** Invoked exclusively on schedule (e.g. daily pg_cron or GitHub Action). Bounded batch deletion (LIMIT 5,000 rows/run).
12. **Deployment Status:** Code-complete; pending PAT permission regeneration (`OWNER-OPS-03`).

---

### 2.2 Function: `delete-account`
1. **Directory:** `supabase/functions/delete-account/index.ts`
2. **Purpose:** Implements GDPR Article 17 ("Right to Erasure"). Completely wipes user profile, achievements, cloud saves, and enqueues artwork objects for asynchronous removal.
3. **HTTP Methods:** `POST`, `OPTIONS`.
4. **Auth & Authorization:** Authenticated player session (`Authorization: Bearer <jwt>`). User ID extracted strictly from cryptographically verified token claims (`auth.uid()`).
5. **Database Objects Touched:**
   - `public.user_profiles` (cascade delete)
   - `public.game_saves` (delete)
   - `public.player_achievements` (delete)
   - `public.guest_identity_links` (delete)
   - `public.storage_deletion_queue` (insert pending object deletions)
   - `auth.users` (admin user deletion via service_role client)
6. **Storage Buckets:** Enqueues referenced files in `avatars` and `user-artwork` to `storage_deletion_queue`.
7. **Secrets Required:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
8. **Request Payload:** Empty body or `{ "confirm": true }`.
9. **Response Schema:** `{ "ok": true, "message": "Account successfully eradicated", "queuedStorageItems": <int> }` (200).
10. **Error Handling:** Detailed operational logging with zero player PII. Returns 401 on invalid/missing JWT, 500 on failure.
11. **Rate Limiting:** Restricted to 1 request per 10 minutes per authenticated user ID.
12. **Deployment Status:** Code-complete; pending PAT permission regeneration (`OWNER-OPS-03`).

---

### 2.3 Function: `ingest-telemetry`
1. **Directory:** `supabase/functions/ingest-telemetry/index.ts`
2. **Purpose:** Ingests anonymized client game telemetry events, performance metrics, and crash diagnostics.
3. **HTTP Methods:** `POST`, `OPTIONS`.
4. **Auth & Authorization:** Publicly accessible via `SUPABASE_ANON_KEY`; accepts anonymous or authenticated requests.
5. **Database Objects Touched:** Calls stored procedure `public.consume_telemetry_token(client_ip, cost)` and inserts into `public.telemetry_events`.
6. **Storage Buckets:** None.
7. **Secrets Required:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
8. **Request Payload:** Array of validated telemetry objects: `[{ "event": "game_start", "appId": "auromandala", "timestamp": "...", "payload": {...} }]`. Maximum batch size: 50 events.
9. **Response Schema:** `{ "ok": true, "accepted": <int>, "dropped": 0 }` (202 Accepted).
10. **Error Handling:** Returns 429 when rate-limited; 400 on malformed schema. Logs aggregate event counts only.
11. **Rate Limiting:** Token bucket rate limiter enforced in database (`public.consume_telemetry_token`): 60 requests/minute per client IP.
12. **Deployment Status:** Code-complete; pending PAT permission regeneration (`OWNER-OPS-03`).

---

### 2.4 Function: `owner-metrics`
1. **Directory:** `supabase/functions/owner-metrics/index.ts`
2. **Purpose:** Aggregates administrative analytics: active player counts, storage consumption by bucket, and game session completion rates.
3. **HTTP Methods:** `GET`, `POST`, `OPTIONS`.
4. **Auth & Authorization:** Restricted to authorized administrators. Requires `x-owner-secret` or verified admin role JWT.
5. **Database Objects Touched:** `public.telemetry_events`, `public.user_profiles`, `public.game_saves`, `storage.buckets`, `storage.objects`.
6. **Storage Buckets:** Read-only aggregate counts and byte sums across `avatars` and `user-artwork`.
7. **Secrets Required:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OWNER_METRICS_SECRET`.
8. **Request Payload:** None for GET; optional filter parameters `{ "from": "...", "to": "..." }`.
9. **Response Schema:** `{ "ok": true, "generatedAt": "...", "metrics": { "activeUsers24h": <int>, "totalArtworkCount": <int>, "totalStorageBytes": <int> } }` (200).
10. **Error Handling:** Returns 403 Forbidden on missing/invalid secret. Zero player PII exposed in output.
11. **Rate Limiting:** Max 10 requests per minute.
12. **Deployment Status:** Code-complete; pending PAT permission regeneration (`OWNER-OPS-03`).

---

### 2.5 Function: `sync-save`
1. **Directory:** `supabase/functions/sync-save/index.ts`
2. **Purpose:** Synchronizes encrypted client game state with cloud persistence using Last-Write-Wins (LWW) conflict resolution.
3. **HTTP Methods:** `POST`, `OPTIONS`.
4. **Auth & Authorization:** Authenticated player session (`Authorization: Bearer <jwt>`) or registered guest token.
5. **Database Objects Touched:** `public.game_saves` (`SELECT`, `INSERT ... ON CONFLICT (user_id, app_id, save_slot) DO UPDATE`).
6. **Storage Buckets:** None (save state payloads <= 64 KiB stored directly in PostgreSQL JSONB).
7. **Secrets Required:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`.
8. **Request Payload:** `{ "appId": "maablocks", "saveSlot": "primary", "clientTimestamp": 1795872000000, "data": "<encrypted_or_json_payload>" }`. Max payload: 64 KiB.
9. **Response Schema:** `{ "ok": true, "conflict": false, "syncedTimestamp": 1795872000000, "data": {...} }` (200).
10. **Error Handling:** Returns 409 Conflict if server timestamp exceeds client timestamp, returning current server state for client merge.
11. **Rate Limiting:** Max 30 sync requests per minute per user.
12. **Deployment Status:** Code-complete; pending PAT permission regeneration (`OWNER-OPS-03`).

---

### 2.6 Function: `verify-entitlements`
1. **Directory:** `supabase/functions/verify-entitlements/index.ts`
2. **Purpose:** Validates game catalog access and feature entitlements. Enforces `COMMERCIAL_GATE_ENABLED=false` release invariant.
3. **HTTP Methods:** `POST`, `OPTIONS`.
4. **Auth & Authorization:** Open to anonymous and authenticated users (`SUPABASE_ANON_KEY`).
5. **Database Objects Touched:** `public.user_profiles` (read-only entitlement lookup).
6. **Storage Buckets:** None.
7. **Secrets Required:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `COMMERCIAL_GATE_ENABLED`.
8. **Request Payload:** `{ "userId": "<optional_uuid_or_guest_id>", "apps": ["auromandala", "maamatch", "auroblocks"] }`.
9. **Response Schema:**
   ```json
   {
     "ok": true,
     "commercialGateActive": false,
     "entitlements": {
       "auromandala": { "unlocked": true, "tier": "free" },
       "maamatch": { "unlocked": true, "tier": "free" },
       "auroblocks": { "unlocked": true, "tier": "free" }
     }
   }
   ```
10. **Error Handling:** Graceful fallback to all-unlocked if database unreachable, preserving offline/local-first gameplay.
11. **Rate Limiting:** 60 requests per minute per IP.
12. **Deployment Status:** Code-complete; pending PAT permission regeneration (`OWNER-OPS-03`).

---

## 3. Function Inventory & Deployment Summary

| Function Name | Entrypoint Verified | Intended Invoker | DB / Storage Objects | Rate Limiting | Remote CLI Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `cleanup-telemetry` | `index.ts` (PASS) | Scheduled / Admin | `telemetry_events` | Bounded batch | Blocked on PAT (`OWNER-OPS-03`) |
| `delete-account` | `index.ts` (PASS) | Player (JWT) | 6 tables + queue | 1 / 10 min | Blocked on PAT (`OWNER-OPS-03`) |
| `ingest-telemetry` | `index.ts` (PASS) | Player / Guest | `telemetry_events` | Token bucket (60/m)| Blocked on PAT (`OWNER-OPS-03`) |
| `owner-metrics` | `index.ts` (PASS) | Admin Secret | Telemetry & storage | 10 / min | Blocked on PAT (`OWNER-OPS-03`) |
| `sync-save` | `index.ts` (PASS) | Player (JWT) | `game_saves` | 30 / min | Blocked on PAT (`OWNER-OPS-03`) |
| `verify-entitlements`| `index.ts` (PASS) | Player / Guest | `user_profiles` | 60 / min | Blocked on PAT (`OWNER-OPS-03`) |

---

## 4. Remediation Plan (`OWNER-OPS-03`)

1. Product Owner navigates to Supabase Dashboard (`https://supabase.com/dashboard/account/tokens`).
2. Generate a new Personal Access Token with scopes including `edge_functions_read` and `edge_functions_write`.
3. Update `SUPABASE_ACCESS_TOKEN` in `.env.local` and CI environment.
4. Execute `supabase functions deploy --project-ref rlqrtbjynaihdspbqtce` across all 6 functions.
