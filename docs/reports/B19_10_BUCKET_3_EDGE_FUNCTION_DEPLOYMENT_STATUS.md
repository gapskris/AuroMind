# B19.10 — Bucket 3: Edge Function Deployment Status & Operational Readiness

**Project:** AuroMasti v2.0.0 Beta  
**Workspace:** `C:\AuroMindPortal`  
**Branch:** `dev/studio-integration`  
**Supabase Project:** `rlqrtbjynaihdspbqtce` (`ap-southeast-1`)  
**Target Delivery:** November 30, 2026  
**Canonical Functions Count:** 6  
**Deployment Status:** **LOCAL SOURCE COMPLETE; REMOTE CLI DEPLOYMENT GATED BY OWNER-OPS-03**

---

## 1. Executive Summary

AuroMasti deploys six canonical Edge Functions powering server-side game operations, telemetry collection, GDPR eradication, and platform synchronization.

All six functions are complete and structurally verified in `supabase/functions/`. However, live remote CLI deployment cannot be executed using the existing Personal Access Token (`SUPABASE_ACCESS_TOKEN`), which lacks the required `edge_functions_read` and `edge_functions_write` permissions.

In strict compliance with release governance, access controls have not been bypassed and no token credentials have been exposed. The functions are documented as **Code-Complete & Locally Verified**, with live cloud deployment registered under **`OWNER-OPS-03`**.

---

## 2. Canonical Functions Roster & Implementation Audit

| Function Name | Entrypoint | Authorization / Role | Method | Database / Storage Targets | Operational Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `cleanup-telemetry` | `index.ts` | Service Role / Cron | `POST` | `public.telemetry_events` | Ready for deploy |
| `delete-account` | `index.ts` | Authenticated (JWT) | `POST` | 6 tables + `storage_deletion_queue` | Ready for deploy |
| `ingest-telemetry` | `index.ts` | Anon / Auth (Rate-limited)| `POST` | `consume_telemetry_token`, `telemetry_events` | Ready for deploy |
| `owner-metrics` | `index.ts` | Admin Secret | `GET`/`POST`| Telemetry & Storage metrics | Ready for deploy |
| `sync-save` | `index.ts` | Authenticated (JWT) | `POST` | `public.game_saves` (LWW merge) | Ready for deploy |
| `verify-entitlements`| `index.ts` | Anon / Auth | `POST` | `COMMERCIAL_GATE_ENABLED=false` check | Ready for deploy |

---

## 3. Remote Deployment Attempt & Permission Evidence

The Supabase CLI was invoked to assess remote function listing and deployment feasibility:

```bash
npx supabase functions list --project-ref rlqrtbjynaihdspbqtce
```

### Raw CLI Error Output:
```text
Target: project AuroMasti (rlqrtbjynaihdspbqtce) · production
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

### Analysis:
1. **Authenticated Context:** The CLI is authenticated and successfully identifies project `AuroMasti (rlqrtbjynaihdspbqtce)`.
2. **Permission Boundary:** The Supabase API rejects the request with `HTTP 403 Forbidden` due to missing token scope `edge_functions_read`.
3. **Implication:** The token configured in `.env.local` was generated with database administration privileges (which allowed migration repair, schema queries, and pooler connections) but omitted Edge Functions privileges.

---

## 4. Remediation Procedure: `OWNER-OPS-03`

To complete live cloud deployment of the six Edge Functions:

1. **Dashboard Token Generation:** The Product Owner visits [Supabase Account Tokens](https://supabase.com/dashboard/account/tokens).
2. **Scope Selection:** Generate a new Personal Access Token ensuring permissions include `Edge Functions: Read and Write`.
3. **Environment Injection:** Update `SUPABASE_ACCESS_TOKEN` in `.env.local` and CI secrets.
4. **Automated Deploy:** Execute the standard deployment command:
   ```bash
   npx supabase functions deploy --project-ref rlqrtbjynaihdspbqtce
   ```
5. **Post-Deployment Verification:** Run smoke tests against each endpoint to confirm live execution and secret binding.

---

## 5. Architectural Integrity Invariants

- **Commercial Invariant:** All Edge Functions strictly enforce `COMMERCIAL_GATE_ENABLED=false`. No payment webhooks or billing validations exist.
- **Sankalpa Invariant:** Zero Edge Functions handle or store Sankalpa data.
- **Privacy Invariant:** Telemetry logs and error handlers redact player PII and authentication tokens.
