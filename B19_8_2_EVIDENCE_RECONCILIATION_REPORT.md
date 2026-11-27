# AuroMasti B19.8.2 — Evidence Reconciliation Report

**Project:** AuroMasti (formerly AuroMind)  
**Target Release:** January 1, 2027 — Version 2.0.0 Beta  
**Branch:** `dev/studio-integration`  
**Evaluation Date:** November 27, 2026  
**Commercial Gate:** `COMMERCIAL_GATE_ENABLED=false` (Verified)

---

## 1. Executive Summary

This report establishes the verified, incontrovertible evidence base for the AuroMasti repository following B19.8.2. It definitively reconciles:
1. Sacred invariant cryptographic hashes and historical labeling confusion.
2. The deterministic cryptographic manifest for all 10 canonical database migrations.
3. The true 15-table public database schema (including unlogged tables).
4. The canonical hosting architecture on Cloudflare Pages.
5. The critical operational distinction between automated CLI migration pushes and manual dashboard SQL execution.

---

## 2. Sacred Invariants & Cryptographic Verification

### 2.1 Forensic Explanation of Historical Hash Label Inversion
Previous reports from earlier batches contained confusing documentation where the 64-character hex digest `9fdb3826030049c9eab183479bcb7fe29304b3ea08d045c8c67f1cfd4d77da09` was labeled as "VAK Full HTML".
- **The Forensic Fact:** `9fdb38...` is the exact SHA-256 digest of the extracted JavaScript statement `const CL = [[...]];` inside `games/vak/index.html`.
- **The True Full HTML Hash:** The SHA-256 of the complete `games/vak/index.html` file is `A8E2EF8B9B5E7F95B231C75B185C3DDEB61EA8FCB4C25C85FABC6872FA780360`.
Both digests are simultaneously true, unmodified, and verified against `games/vak/index.html`.

### 2.2 Sacred Invariants Ledger

| Asset Identifier | Canonical File Path | Cryptographic Digest / Invariant | Status |
|:---|:---|:---|:---:|
| **VAK Full HTML** | `games/vak/index.html` | SHA-256: `A8E2EF8B9B5E7F95B231C75B185C3DDEB61EA8FCB4C25C85FABC6872FA780360` | **MATCH** |
| **VAK Speech Corpus** | `games/vak/index.html` (`const CL`) | SHA-256: `9fdb3826030049c9eab183479bcb7fe29304b3ea08d045c8c67f1cfd4d77da09` | **MATCH** |
| **AuroMatch Flora Database** | `games/auromatch/src/models/floraDatabase.js` | SHA-256: `689d035cd52abd8d342528d8c5f61f298916b8052b8287450be4931cf8ae1a3a` (46,321 lines, 2,002,176 bytes) | **MATCH** |
| **Commercial Gate Invariant** | `assets/sdk/config/backend-config.js` | `export const COMMERCIAL_GATE_ENABLED = false;` | **MATCH** |
| **Sankalpa Contemplation Vault** | `games/auromandala/assets/auromandala-sdk-bridge.js` | `capabilities.cloudSyncEligible = false;` (100% local-first storage) | **MATCH** |

---

## 3. Cryptographic Migration Checksum Manifest (B82-02)

To ensure that migration file contents are strictly tamper-evident and that remote drift checks do not conflate version numbers with SQL content equality, B19.8.2 introduced `supabase/migrations_manifest.json`.

- **Target Project:** `rlqrtbjynaihdspbqtce`
- **Canonical Migration Count:** 10
- **Aggregate Manifest SHA-256:** `f55231159389f9d5549713ee83c783c1c7130dc7454058c8195140ae529899ea`

### Migration Checksums Ledger

| # | Migration Filename | Migration Version | SHA-256 Checksum |
|:---:|:---|:---:|:---|
| 1 | `20261120000001_b5_core_schema.sql` | `20261120000001` | `4d9374cfde43b2ec8fec14ff0d66934ff66b43b63f7c3a4f13388064cd574e74` |
| 2 | `20261120000002_b8_rate_limiting.sql` | `20261120000002` | `93690d69e23f7409ec0cb6c16d3bbd2e0281902d30c145f7c6cf345a6562b143` |
| 3 | `20261120000003_b13a_telemetry_rls_hardening.sql` | `20261120000003` | `5ae748ca2cdf6bcb027651c602d590b73b71d44ec80f49decf31b5025688746d` |
| 4 | `20261120000004_b13b_telemetry_retention.sql` | `20261120000004` | `6be4fe7b122555e84fe6120dc2ed2c042d6a1a694e2c1cf4e39cb3784eaded5e` |
| 5 | `20261122000001_b18c_profile_rls_separation.sql` | `20261122000001` | `f0084584508c9f649e4a8199f41c41f050402797297afecec1d517c02f37bbd8` |
| 6 | `20261122000002_b18c_telemetry_token_bucket.sql` | `20261122000002` | `938649adecec6d5ae5b20c0979978bacf2441431fb20447dbc021eb9d7b66e89` |
| 7 | `20261122000003_b18c_telemetry_search_path_hardening.sql` | `20261122000003` | `10ebff8ccbf0112e65cd58ed66df683e35560eb26e2b43bf2b68241bc55e8b33` |
| 8 | `20261122000004_b18d_telemetry_token_bucket_input_validation.sql` | `20261122000004` | `dfdba762681b1ba5002bdc9ed4e8ad2b75fcb7f3644285decc73b68e89832fd3` |
| 9 | `20261123000001_b19_5_05_db_integrity_and_rls_hardening.sql` | `20261123000001` | `cfc36b11dbf5df5c5ef9f030580a9f227ceb639b4ccf929d88555551a157f7b8` |
| 10 | `20261123000002_b19_5_06_storage_buckets_and_rls.sql` | `20261123000002` | `bc6b04da5572076f10969a0874de5bfe89bfc77e8546ba13c991bc651549ef63` |

---

## 4. Public Table Count & Schema Reconciliation

The canonical public database schema comprises exactly **15 public tables**:
1. `user_profiles` (M1)
2. `guest_identity_links` (M1)
3. `game_saves` (M1)
4. `game_save_revisions` (M1)
5. `entitlements` (M1)
6. `entitlement_audit` (M1)
7. `purchase_receipts` (M1)
8. `telemetry_events` (M1)
9. `remote_config` (M1)
10. `owner_roles` (M1)
11. `telemetry_rate_limits` (M2)
12. `telemetry_daily_aggregates` (M4)
13. `user_private_settings` (M5)
14. `telemetry_rate_buckets` (M6 — UNLOGGED table)
15. `storage_deletion_queue` (M10)

- **RLS Status:** 100% of tables have Row Level Security enabled.
- **Function Search Paths:** All `SECURITY DEFINER` functions specify `SET search_path = pg_catalog, public`.

---

## 5. Hosting Architecture Reconciliation

- **Canonical Staging:** `https://staging.auromasti.pages.dev`
- **Canonical Production:** `https://auromasti.com`
- **GitHub Pages:** Converted to manual dispatch (`workflow_dispatch`); automatic push deploys disabled to prevent split-brain hosting.
- **Edge Headers & Routing:** Hardened via `_headers` and `_routes.json`.

---

## 6. Manual SQL Dashboard Execution Risk Clarification (B82-03)

- Executing `consolidated_migration_preview.sql` directly in the Supabase Dashboard SQL Editor modifies database objects but **DOES NOT insert rows into `supabase_migrations.schema_migrations`**.
- As a consequence, subsequent CLI runs (`supabase db push`) will fail or detect false drift.
- `npx supabase db push` is the **only canonical automated migration path**.
- Manual dashboard SQL execution is reclassified strictly as an emergency disaster-recovery procedure requiring separate PO authorization, step-by-step transaction caution, and mandatory migration repair (`npx supabase migration repair --status applied`).
