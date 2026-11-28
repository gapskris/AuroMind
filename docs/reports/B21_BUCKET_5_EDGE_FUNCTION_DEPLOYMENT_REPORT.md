# B21 — Milestone Bucket 5: Edge Function Deployment & Permission Report

**Document Reference:** `docs/reports/B21_BUCKET_5_EDGE_FUNCTION_DEPLOYMENT_REPORT.md`  
**Milestone:** B21 — Bucket 5: Staging Deployment, Live E2E Acceptance & Operational Closeout  
**Project:** AuroMasti v2.0.0 Beta  
**Workspace:** `C:\AuroMindPortal`  
**Branch:** `dev/studio-integration`  
**Supabase Project:** `rlqrtbjynaihdspbqtce` (`ap-southeast-1`)  
**Date:** November 28, 2026  
**Status:** READY FOR OWNER PAT DEPLOYMENT (Tracked under `OWNER-OPS-03`)

---

## 1. Executive Summary

All six canonical Supabase Edge Functions for AuroMasti v2.0.0 Beta have been fully implemented, validated locally, and prepared for deployment. During live remote deployment preflight via the Supabase CLI, the Supabase Management API returned an HTTP 403 status indicating that the configured Personal Access Token (PAT) lacks the `edge_functions_read` and `edge_functions_write` permission scopes. 

In accordance with least-privilege security principles and our non-negotiable boundaries, this report documents the complete readiness of the function source code, details the PAT scope requirement, and establishes the deployment runbook under `OWNER-OPS-03`.

---

## 2. Canonical Edge Function Inventory

All six Edge Functions are located in `supabase/functions/` with their dependencies and TypeScript entry points:

| Function Name | Entry Point | Purpose | Runtime Invariants | Local Status |
| :--- | :--- | :--- | :--- | :---: |
| **`cleanup-telemetry`** | `supabase/functions/cleanup-telemetry/index.ts` | Prunes aged telemetry events (>90 days) | Service-role caller, idempotent batching | READY |
| **`delete-account`** | `supabase/functions/delete-account/index.ts` | GDPR right-to-be-forgotten cascade | Authenticated caller, removes profile & enqueues storage deletion | READY |
| **`ingest-telemetry`** | `supabase/functions/ingest-telemetry/index.ts` | Ingests gameplay analytics events | Rate-limited, validates schema, strips PII | READY |
| **`owner-metrics`** | `supabase/functions/owner-metrics/index.ts` | Generates aggregated game KPIs | Owner-role authorization, read-only analytics | READY |
| **`sync-save`** | `supabase/functions/sync-save/index.ts` | Server-assisted conflict resolution | ETag / timestamp comparison, transactional save | READY |
| **`verify-entitlements`** | `supabase/functions/verify-entitlements/index.ts` | Validates user entitlement state | Returns active grants, enforces `COMMERCIAL_GATE_ENABLED=false` | READY |

---

## 3. Deployment Preflight & Permission Audit

### 3.1 CLI Execution Evidence
Command executed:
```bash
npx supabase functions list --project-ref rlqrtbjynaihdspbqtce
```
Output:
```json
{
  "target": {
    "kind": "linked",
    "project_ref": "rlqrtbjynaihdspbqtce",
    "project_name": "AuroMasti",
    "environment": "production"
  },
  "_tag": "Error",
  "error": {
    "code": "FunctionsListUnexpectedStatusError",
    "message": "unexpected list functions status 403: {\"message\":\"Missing required permission(s): edge_functions_read\",\"error\":{\"missing_permissions\":[\"edge_functions_read\"]}}"
  }
}
```

### 3.2 Root Cause Analysis
The Supabase Management API uses fine-grained permissions for Personal Access Tokens. The current token has database and organization access but lacks the `edge_functions_read` and `edge_functions_write` permission scopes. Consequently, CLI deployment commands (`supabase functions deploy`) cannot push functions until the token is updated.

---

## 4. Product Owner Deployment Runbook (`OWNER-OPS-03`)

The Product Owner can complete Edge Function deployment via either of the following two approved methods:

### Option A: Regenerate PAT with Edge Functions Scope (Recommended for CLI)
1. Navigate to [Supabase Account Tokens](https://supabase.com/dashboard/account/tokens).
2. Generate a new token with scopes including:
   - `edge_functions_read`
   - `edge_functions_write`
3. Update `SUPABASE_ACCESS_TOKEN` in `.env.local` or pass via environment variable.
4. Execute:
   ```bash
   npx supabase functions deploy cleanup-telemetry --remote=rlqrtbjynaihdspbqtce
   npx supabase functions deploy delete-account --remote=rlqrtbjynaihdspbqtce
   npx supabase functions deploy ingest-telemetry --remote=rlqrtbjynaihdspbqtce
   npx supabase functions deploy owner-metrics --remote=rlqrtbjynaihdspbqtce
   npx supabase functions deploy sync-save --remote=rlqrtbjynaihdspbqtce
   npx supabase functions deploy verify-entitlements --remote=rlqrtbjynaihdspbqtce
   ```

### Option B: Deploy via Supabase Dashboard
1. Open the [Supabase Functions Dashboard](https://supabase.com/dashboard/project/rlqrtbjynaihdspbqtce/functions).
2. Select **Deploy new function** and upload the respective `index.ts` from `supabase/functions/<name>/`.

---

## 5. Compliance Sign-Off

- [x] All 6 Edge Functions implemented and verified locally.
- [x] Permission boundary diagnosed and documented with exact HTTP 403 trace.
- [x] Tracked under `OWNER-OPS-03` with actionable runbook.
