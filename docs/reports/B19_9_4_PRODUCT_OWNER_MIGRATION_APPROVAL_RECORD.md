# B19.9.4 — Product Owner Migration Approval Record & Package

**Project:** AuroMasti v2.0.0 Beta  
**Workstream:** Bucket 2 — Supabase Database Foundation  
**Task:** B19.9.4  
**Date:** November 28, 2026  
**Governance Item Identifier:** `CANON-GOV-01`  
**Current Status:** **`PENDING APPROVAL — Product Owner Statement Still Required`**

---

## 1. Approval Package Specification

This document defines the formal, attributable authorization contract required to unlock the Supabase migration execution path (`executeRemoteMigrations`) in `scripts/migration-workflow.mjs`.

### Target Environment & Canonical Manifest
- **Target Project Reference:** `rlqrtbjynaihdspbqtce`
- **Hosted Database Cloud Region:** `ap-southeast-1`
- **Connection Endpoint:** Session Pooler `aws-1-ap-southeast-1.pooler.supabase.com:5432`
- **Expected Migration Count:** Exactly `10` canonical SQL migration files
- **Cryptographic Manifest SHA-256:**  
  `f55231159389f9d5549713ee83c783c1c7130dc7454058c8195140ae529899ea`

### Scoped Migrations
1. `20261120000001_b5_core_schema.sql` (SHA-256: `4d9374cfde43b2ec8fec14ff0d66934ff66b43b63f7c3a4f13388064cd574e74`)
2. `20261120000002_b8_rate_limiting.sql` (SHA-256: `93690d69e23f7409ec0cb6c16d3bbd2e0281902d30c145f7c6cf345a6562b143`)
3. `20261120000003_b13a_telemetry_rls_hardening.sql` (SHA-256: `5ae748ca2cdf6bcb027651c602d590b73b71d44ec80f49decf31b5025688746d`)
4. `20261120000004_b13b_telemetry_retention.sql` (SHA-256: `6be4fe7b122555e84fe6120dc2ed2c042d6a1a694e2c1cf4e39cb3784eaded5e`)
5. `20261122000001_b18c_profile_rls_separation.sql` (SHA-256: `f0084584508c9f649e4a8199f41c41f050402797297afecec1d517c02f37bbd8`)
6. `20261122000002_b18c_telemetry_token_bucket.sql` (SHA-256: `938649adecec6d5ae5b20c0979978bacf2441431fb20447dbc021eb9d7b66e89`)
7. `20261122000003_b18c_telemetry_search_path_hardening.sql` (SHA-256: `10ebff8ccbf0112e65cd58ed66df683e35560eb26e2b43bf2b68241bc55e8b33`)
8. `20261122000004_b18d_telemetry_token_bucket_input_validation.sql` (SHA-256: `dfdba762681b1ba5002bdc9ed4e8ad2b75fcb7f3644285decc73b68e89832fd3`)
9. `20261123000001_b19_5_05_db_integrity_and_rls_hardening.sql` (SHA-256: `cfc36b11dbf5df5c5ef9f030580a9f227ceb639b4ccf929d88555551a157f7b8`)
10. `20261123000002_b19_5_06_storage_buckets_and_rls.sql` (SHA-256: `bc6b04da5572076f10969a0874de5bfe89bfc77e8546ba13c991bc651549ef63`)

---

## 2. Explicit Boundaries, Scope & Sacred Invariants

Execution under this authorization is strictly limited to the initial deployment of the schema defined in the 10 canonical migrations above. The following boundaries are non-negotiable:

1. **Zero Additional Migrations:** No migrations beyond the 10 listed above may be executed.
2. **Zero Out-of-Band Schema Mutations:** Manual DDL in the Supabase SQL editor or CLI is strictly prohibited.
3. **No Unapproved Service Activations:**
   - Storage buckets are limited strictly to `avatars` (512 KiB) and `user-artwork` (5 MiB). Phantom bucket `mandala-cloud-sync` remains nonexistent.
   - Auth settings, SMTP provider, and Edge Functions remain unconfigured in this step.
4. **Commercial Gate Disabled:** `COMMERCIAL_GATE_ENABLED=false` remains strictly enforced. No payment processing, Stripe, Razorpay, or billing hooks are enabled.
5. **Sankalpa Cloud Sync Disabled:** Sankalpa reflections and sacred entries remain 100% local-only in client IndexedDB (`capabilities.cloudSyncEligible = false`).
6. **AuroMandala Local-First Persistence:** AuroMandala artwork is local-first in IndexedDB; cloud export to `user-artwork` occurs solely upon explicit user action.
7. **Launch Catalogue Strict Scope:** Launch catalogue is restricted to exactly AuroMandala, MaaMATCH, and MaaBLOCK (AuroBlocks). VAK remains excluded from the release catalogue with its source files and corpus strictly preserved.

---

## 3. Cryptographic Governance Clarification

> [!NOTE]
> **Attributable Record vs Asymmetric Digital Signature:**  
> The Product Owner authorization mechanism implemented in `scripts/migration-workflow.mjs` is an **attributable authorization record with cryptographic manifest hash binding**. It verifies:
> - Attributable identity of the approver (`approvedBy`).
> - Cryptographic match between the approved manifest hash and the current migration set SHA-256 (`approvedManifestSha256 === currentManifest.manifestSha256`).
> - Exact project reference matching (`targetProjectRef === 'rlqrtbjynaihdspbqtce'`).
> - Temporal freshness (must be within 60 minutes of execution).
> - Explicit authorization phrase (`explicitStatement.includes('I AUTHORIZE MIGRATION EXECUTION FOR AUROMASTI')`).
>
> It is **not** an asymmetric public/private key cryptographic signature (e.g. RSA/ECDSA/PGP) and must not be described as such.

---

## 4. Attributable Product Owner Approval Record (Pending Signoff)

```json
{
  "status": "PENDING_APPROVAL",
  "governanceItem": "CANON-GOV-01",
  "approvedBy": "[PENDING: Product Owner Full Name / Title]",
  "approvedAt": "[PENDING: ISO-8601 Timestamp, e.g. 2026-11-28T...Z]",
  "targetProjectRef": "rlqrtbjynaihdspbqtce",
  "migrationSetCount": 10,
  "approvedManifestSha256": "f55231159389f9d5549713ee83c783c1c7130dc7454058c8195140ae529899ea",
  "explicitStatement": "I AUTHORIZE MIGRATION EXECUTION FOR AUROMASTI ON PROJECT rlqrtbjynaihdspbqtce WITH MANIFEST f55231159389f9d5549713ee83c783c1c7130dc7454058c8195140ae529899ea UNDER COMMERCIAL_GATE_ENABLED=false.",
  "scope": "Initial application of 10 canonical migrations to clean remote database",
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

## 5. Execution Gate Enforcement & Status

- **Software Gate Status:** **`LOCKED`**
- **Migration Mutation Execution:** **`PROHIBITED`**
- **Pending Action:** Product Owner must provide the attributable signoff statement and timestamp. Until provided, no live mutations or database push operations will be triggered.
