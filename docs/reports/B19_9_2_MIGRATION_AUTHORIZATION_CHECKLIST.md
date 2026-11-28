# AuroMasti v2.0.0 Beta — Migration Authorization Checklist & Governance Package

**Milestone:** B19.9.2 (Bucket 2)  
**Governance ID:** `CANON-GOV-01`  
**Target Release:** Version 2.0.0 Beta (Target Deadline: November 30, 2026)  
**Target Project:** `rlqrtbjynaihdspbqtce` (ap-southeast-1)  
**Canonical Manifest SHA-256:** `f55231159389f9d5549713ee83c783c1c7130dc7454058c8195140ae529899ea`  
**Current Authorization Status:** `READY_FOR_PRODUCT_OWNER_REVIEW` (Awaiting PO Signature)  
**Fail-Closed Policy:** NO UNATTRIBUTABLE OR SIMULATED APPROVALS PERMITTED  

---

## 1. Governance Context & Authority

Under the AuroMasti release engineering charter, remote database mutations (`supabase db push`, DDL/DML execution, storage bucket provisioning, and Edge Function deployment) are **strictly locked** behind the `CANON-GOV-01` authorization gate.

To prevent accidental, unreviewed, or unauthorized cloud modifications:
1. The migration workflow fails closed if any approval field is missing, invalid, or expired.
2. Simulated, defaulted, or mock approvals are strictly prohibited in non-test execution contexts.
3. Attributable signoff from the named Product Owner is legally and procedurally required before executing Phase 2 of the deployment plan.

---

## 2. Authorization Parameter Specification

The Product Owner authorization package requires exact match on all cryptographic, environmental, and temporal parameters:

| Parameter Field | Canonical Expected Value | Verification Method | Enforcement Rule |
|:---|:---|:---|:---|
| **Target Project Reference** | `rlqrtbjynaihdspbqtce` | Strict string equality against `CANONICAL_PROJECT_REF` | Fails closed if pointing to any other project ref. |
| **Migration Set Count** | `10` | Integer check against `EXPECTED_MIGRATION_COUNT` | Fails closed if partial or extra migrations scoped. |
| **Manifest Checksum (SHA-256)** | `f55231159389f9d5549713ee83c783c1c7130dc7454058c8195140ae529899ea` | Exact 64-character hex digest of `migrations_manifest.json` | Fails closed if any migration SQL file was modified. |
| **Preflight Evidence Freshness** | $\le 30$ minutes | `Date.now() - preflightTimestamp <= 1800000 ms` | Fails closed if preflight inspection is older than 30 min. |
| **Approval Signature Age** | $\le 60$ minutes | `Date.now() - approvedAt <= 3600000 ms` | Fails closed if signature is older than 60 min at execution. |
| **Attributable Signer** | Named Person (e.g. `"Product Owner"`) | Non-empty string (`approvedBy`) | Fails closed if null, anonymous, or empty. |
| **Explicit Statement** | Exact text matching required clause | Must contain: `"I AUTHORIZE MIGRATION EXECUTION FOR AUROMASTI"` | Fails closed if statement is missing or paraphrased. |

---

## 3. Product Owner Review & Sign-Off Checklist

Before signing the authorization record, the Product Owner must complete the following 5 verification checkpoints:

### Checkpoint 1: Remote Preflight Freshness & Clean State
- [ ] Confirm that `npm run migrate:preflight:remote` has been executed within the last 30 minutes.
- [ ] Confirm that the reported preflight state is **`CLEAN_INITIAL_STATE`**.
- [ ] Confirm that 0 migrations are applied remotely and 10 migrations are pending.
- [ ] Confirm that 0 user tables exist in the public schema (zero object collisions).

### Checkpoint 2: Manifest & Invariant Checksum Verification
- [ ] Confirm that the migration manifest SHA-256 is:  
  `f55231159389f9d5549713ee83c783c1c7130dc7454058c8195140ae529899ea`.
- [ ] Confirm that the canonical Flora Botanical Database SHA-256 is:  
  `689d035cd52abd8d342528d8c5f61f298916b8052b8287450be4931cf8ae1a3a` ([`floraDatabase.js`](file:///C:/AuroMindPortal/games/auromatch/src/models/floraDatabase.js)).
- [ ] Confirm that `COMMERCIAL_GATE_ENABLED=false` is enforced in `.env.local` and `backend-config.js`.
- [ ] Confirm that VAK remains excluded from the launch catalogue and 3 games are curated.

### Checkpoint 3: Backup & Disaster Recovery Acknowledgment
- [ ] Review [`docs/reports/B19_9_2_BACKUP_AND_PITR_READINESS.md`](file:///C:/AuroMindPortal/docs/reports/B19_9_2_BACKUP_AND_PITR_READINESS.md).
- [ ] Acknowledge that Supabase Management API returned HTTP 403 (`backups_read` scope missing) and provider backups are `NOT_VERIFIED` via API.
- [ ] Acknowledge that because the remote database is in `CLEAN_INITIAL_STATE` with zero user tables, applying the initial schema carries zero risk of destroying existing user data.
- [ ] Inspect the Supabase Dashboard (`Database -> Backups`) to verify manual/automated snapshot availability before production cutover.

### Checkpoint 4: Non-Destructive SQL & Search Path Verification
- [ ] Review [`docs/reports/B19_9_2_MIGRATION_INTEGRITY_AND_EXECUTION_PLAN.md`](file:///C:/AuroMindPortal/docs/reports/B19_9_2_MIGRATION_INTEGRITY_AND_EXECUTION_PLAN.md).
- [ ] Confirm zero unconditional `DROP TABLE`, zero `TRUNCATE`, and zero `DROP DATABASE` statements exist.
- [ ] Confirm all `SECURITY DEFINER` functions enforce `SET search_path = pg_catalog, public`.
- [ ] Confirm 100% Row-Level Security (RLS) coverage across all 15 public tables.

### Checkpoint 5: Attributable Signature Generation
- [ ] Generate the signed approval record using the canonical schema below.
- [ ] Provide the signed record to the Release Engineer for execution via `executeRemoteMigrations()`.

---

## 4. Canonical Approval Record Schema & Template

When authorized by the Product Owner, the approval must be recorded in the following structured JSON format:

```json
{
  "approvedBy": "<Full Name of Product Owner>",
  "approvedAt": "2026-11-28T15:30:00.000Z",
  "approvedManifestSha256": "f55231159389f9d5549713ee83c783c1c7130dc7454058c8195140ae529899ea",
  "migrationSetCount": 10,
  "targetProjectRef": "rlqrtbjynaihdspbqtce",
  "targetRegion": "ap-southeast-1",
  "commercialGateEnforced": false,
  "explicitStatement": "I AUTHORIZE MIGRATION EXECUTION FOR AUROMASTI"
}
```

---

## 5. Audit Trail & Logging Guarantee

When the Release Engineer submits this approval object to `executeRemoteMigrations()`:
1. `validateMigrationExecutionGate()` validates all 8 conditions.
2. `recordAuthorizationAudit()` appends an immutable entry to [`supabase/authorization_audit.log`](file:///C:/AuroMindPortal/supabase/authorization_audit.log):
   ```json
   {
     "timestamp": "2026-11-28T15:30:15.000Z",
     "decision": "AUTHORIZED",
     "reason": "All 8 migration gates, fresh preflight evidence, and attributable Product Owner approval satisfied.",
     "approvedBy": "Product Owner Name",
     "approvalTimestamp": "2026-11-28T15:30:00.000Z",
     "targetProjectRef": "rlqrtbjynaihdspbqtce",
     "manifestSha256": "f55231159389f9d5549713ee83c783c1c7130dc7454058c8195140ae529899ea",
     "migrationCount": 10,
     "sanitized": true
   }
   ```
3. If any gate fails, a `decision: "REJECTED"` entry is written with the exact failure reason, and execution is aborted before invoking the CLI.
4. Database passwords, access tokens, and secrets are strictly excluded from the audit log.

---

## 6. Current Authorization Assessment

| Check Item | Current Status | Finding | Next Action |
|:---|:---:|:---|:---|
| **Attributable PO Signature** | `MISSING` | No signed authorization record has been submitted yet for execution. | Product Owner to review and sign. |
| **Manifest Checksum Parity** | `VALID` | Local files match canonical SHA-256 (`f55231159389...`). | Ready for signoff. |
| **Project Ref Match** | `VALID` | Config matches `rlqrtbjynaihdspbqtce`. | Ready for signoff. |
| **Preflight State** | `VALID` | `CLEAN_INITIAL_STATE` verified over Session Pooler. | Ready for signoff. |
| **Overall Gate Status** | **`READY_FOR_PRODUCT_OWNER_REVIEW`** | Technical prerequisites 100% satisfied. Execution locked awaiting PO signature. | Awaiting PO signature. |
