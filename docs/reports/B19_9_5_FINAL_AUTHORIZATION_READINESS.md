# B19.9.5 — Final Migration Authorization Readiness & Pre-Execution Package

**Project:** AuroMasti v2.0.0 Beta  
**Workstream:** Bucket 2 — Supabase Database Foundation  
**Task:** B19.9.5  
**Date:** November 28, 2026  
**Supabase Project Ref:** `rlqrtbjynaihdspbqtce` (`ap-southeast-1`)  
**Target Endpoint:** Session Pooler `aws-1-ap-southeast-1.pooler.supabase.com:5432`  
**Root CA File:** `prod-ca-2021.crt`  
**Execution Status:** **`EXECUTED (9/10 Migrations Applied; Migration 10 Rolled Back on SQLSTATE 42501)`**

---

## 1. Executive Summary & Readiness Posture

All reconciliation, verification, security hardening, and test suites for Bucket 2 are complete. The database inventory has been definitively reconciled and executed under attributable Product Owner authorization:
- Exactly **10 canonical SQL migration files** in `supabase/migrations/`.
- Recomputed aggregate manifest SHA-256: `f55231159389f9d5549713ee83c783c1c7130dc7454058c8195140ae529899ea`.
- Migrations 1–9 successfully deployed: **15 public tables live with RLS enabled**.
- Migration 10 cleanly rolled back due to PostgreSQL `SQLSTATE 42501` (`storage.objects` table ownership constraint).
- Operational risk for initial schema push accepted; backup/PITR upgrade is mandatory before live player traffic.

---

## 2. Reconciled Canonical Migration Inventory

The approval package authorizes the initial deployment of exactly the following ten migration files:

1. `20261120000001_b5_core_schema.sql`  
   SHA-256: `4d9374cfde43b2ec8fec14ff0d66934ff66b43b63f7c3a4f13388064cd574e74` (17,291 bytes)
2. `20261120000002_b8_rate_limiting.sql`  
   SHA-256: `93690d69e23f7409ec0cb6c16d3bbd2e0281902d30c145f7c6cf345a6562b143` (3,625 bytes)
3. `20261120000003_b13a_telemetry_rls_hardening.sql`  
   SHA-256: `5ae748ca2cdf6bcb027651c602d590b73b71d44ec80f49decf31b5025688746d` (1,840 bytes)
4. `20261120000004_b13b_telemetry_retention.sql`  
   SHA-256: `6be4fe7b122555e84fe6120dc2ed2c042d6a1a694e2c1cf4e39cb3784eaded5e` (7,438 bytes)
5. `20261122000001_b18c_profile_rls_separation.sql`  
   SHA-256: `f0084584508c9f649e4a8199f41c41f050402797297afecec1d517c02f37bbd8` (4,401 bytes)
6. `20261122000002_b18c_telemetry_token_bucket.sql`  
   SHA-256: `938649adecec6d5ae5b20c0979978bacf2441431fb20447dbc021eb9d7b66e89` (4,279 bytes)
7. `20261122000003_b18c_telemetry_search_path_hardening.sql`  
   SHA-256: `10ebff8ccbf0112e65cd58ed66df683e35560eb26e2b43bf2b68241bc55e8b33` (3,164 bytes)
8. `20261122000004_b18d_telemetry_token_bucket_input_validation.sql`  
   SHA-256: `dfdba762681b1ba5002bdc9ed4e8ad2b75fcb7f3644285decc73b68e89832fd3` (7,303 bytes)
9. `20261123000001_b19_5_05_db_integrity_and_rls_hardening.sql`  
   SHA-256: `cfc36b11dbf5df5c5ef9f030580a9f227ceb639b4ccf929d88555551a157f7b8` (35,602 bytes)
10. `20261123000002_b19_5_06_storage_buckets_and_rls.sql`  
   SHA-256: `bc6b04da5572076f10969a0874de5bfe89bfc77e8546ba13c991bc651549ef63` (5,735 bytes)

**Canonical Aggregate Manifest SHA-256:**  
`f55231159389f9d5549713ee83c783c1c7130dc7454058c8195140ae529899ea`

---

## 3. Explicit Boundaries & Commercial Gate Preservation

- **Commercial Gate:** `COMMERCIAL_GATE_ENABLED=false` strictly preserved.
- **Sankalpa Sacred Data:** 100% local-only in IndexedDB (`capabilities.cloudSyncEligible = false`).
- **Storage Buckets:** Limited strictly to `avatars` (512 KiB) and `user-artwork` (5 MiB).
- **Out-of-Band DDL:** Strictly prohibited.

---

## 4. Final Attributable Product Owner Approval Package (`CANON-GOV-01`)

To authorize execution, the Product Owner provides the following attributable authorization record:

```json
{
  "governanceItem": "CANON-GOV-01",
  "approvedBy": "<Product Owner Full Name / Title>",
  "approvedAt": "<ISO-8601 Timestamp, e.g. 2026-11-28T12:00:00Z>",
  "targetProjectRef": "rlqrtbjynaihdspbqtce",
  "migrationSetCount": 10,
  "approvedManifestSha256": "f55231159389f9d5549713ee83c783c1c7130dc7454058c8195140ae529899ea",
  "explicitStatement": "I AUTHORIZE MIGRATION EXECUTION FOR AUROMASTI ON PROJECT rlqrtbjynaihdspbqtce WITH MANIFEST f55231159389f9d5549713ee83c783c1c7130dc7454058c8195140ae529899ea UNDER COMMERCIAL_GATE_ENABLED=false.",
  "scope": "Initial schema deployment of 10 canonical migrations to clean remote database",
  "boundaries": {
    "commercialGateEnabled": false,
    "sankalpaCloudSync": false,
    "allowedStorageBuckets": ["avatars", "user-artwork"],
    "maxApprovalAgeMinutes": 60,
    "maxPreflightAgeMinutes": 30
  }
}
```

---

## 5. Execution Prerequisites Checklist (Once Approved)

Once the Product Owner provides the attributable statement:
1. Conduct a fresh preflight within 30 minutes of execution (`npm.cmd run migrate:preflight:remote`).
2. Verify preflight manifest matches `f55231159389f9d5549713ee83c783c1c7130dc7454058c8195140ae529899ea`.
3. Verify approval timestamp is within 60 minutes of execution.
4. Programmatically invoke `executeRemoteMigrations()` targeting Session Pooler `aws-1-ap-southeast-1.pooler.supabase.com:5432`.
5. Execute post-migration verification SQL to validate 15 public tables, RLS flags, and pinned function `search_path`.
