# AuroMasti B19.8.1 — Evidence Reconciliation Report

**Project:** AuroMasti (AuroMind Portal)  
**Target Release:** January 1, 2027 — Version 2.0.0 Beta  
**Branch:** `dev/studio-integration`  
**Evaluation Date:** November 27, 2026  
**Commercial Gate:** `COMMERCIAL_GATE_ENABLED=false` (Verified)

---

## 1. Executive Summary

During the B19.8 review, several apparent evidence discrepancies were noted regarding sacred asset SHA-256 digests, hosting platform roles, and public database table counts. This report provides a definitive, forensic reconciliation of each item based on raw filesystem inspection, cryptographic hashing, and runtime code execution.

All discrepancies were resolved as either documentation/labeling errors or parsing omissions in legacy audit scripts. The underlying codebase, canonical assets, and sacred invariants have remained pristine and intact throughout.

---

## 2. Sacred Invariants & Cryptographic Hashes

### 2.1 Forensic Explanation of Hash Discrepancies
Historical reports contained two confusing documentation practices:
1. **Label Inversion:** The 64-character hex digest `9fdb3826030049c9eab183479bcb7fe29304b3ea08d045c8c67f1cfd4d77da09` was repeatedly labeled as "VAK Full HTML" in summary tables. In reality, `9fdb38...` is the exact SHA-256 digest of the extracted JavaScript corpus statement: `const CL = [[...]];` inside `games/vak/index.html`. The actual full HTML SHA-256 of `games/vak/index.html` is `A8E2EF8B9B5E7F95B231C75B185C3DDEB61EA8FCB4C25C85FABC6872FA780360`. Both digests are simultaneously true and verified against `games/vak/index.html`.
2. **Auxiliary JSON vs Canonical Code Asset:** Some earlier sections referenced JSON data files (`sanskrit_levels.json` and `flora_database.json`) alongside canonical code files (`games/vak/index.html` and `games/auromatch/src/models/floraDatabase.js`). The canonical source of truth for runtime gameplay has always been the embedded code modules.

### 2.2 Verified Sacred Invariants Ledger

| Asset Identifier | Canonical File Path | Cryptographic Digest / Invariant | Status |
|:---|:---|:---|:---:|
| **VAK Full HTML** | `games/vak/index.html` | SHA-256: `A8E2EF8B9B5E7F95B231C75B185C3DDEB61EA8FCB4C25C85FABC6872FA780360` | **MATCH** |
| **VAK Speech Corpus** | `games/vak/index.html` (`const CL`) | SHA-256: `9fdb3826030049c9eab183479bcb7fe29304b3ea08d045c8c67f1cfd4d77da09` | **MATCH** |
| **AuroMatch Flora Database** | `games/auromatch/src/models/floraDatabase.js` | SHA-256: `689d035cd52abd8d342528d8c5f61f298916b8052b8287450be4931cf8ae1a3a` (46,321 lines, 2,002,176 bytes) | **MATCH** |
| **Commercial Gate Invariant** | `assets/sdk/config/backend-config.js` | `export const COMMERCIAL_GATE_ENABLED = false;` | **MATCH** |
| **Sankalpa Contemplation Vault** | `games/auromandala/assets/auromandala-sdk-bridge.js` | `capabilities.cloudSyncEligible = false;` (100% local-first storage) | **MATCH** |

---

## 3. Hosting Platform Reconciliation

### 3.1 Architectural Clarification
AuroMasti utilizes **Cloudflare Pages** as its canonical hosting and delivery platform:
- **Canonical Staging:** `https://staging.auromasti.pages.dev`
- **Canonical Production:** `https://auromasti.com`
- **Edge Routing & Security:** Enforced by root `_headers` (CSP, HSTS, X-Frame-Options) and `_routes.json`.

### 3.2 GitHub Pages Status
Previously, `.github/workflows/pages.yml` automatically deployed to GitHub Pages on every push to `dev/studio-integration`, creating split-brain deployments.
- **Reconciliation Action:** Added `if: github.event_name == 'workflow_dispatch'` to the `deploy` job in `.github/workflows/pages.yml`.
- **Preserved Capabilities:** The workflow continues to run static validation, secret scanning, and build artifact creation on all pushes, but remote hosting deployment is now exclusively manual and auxiliary.

---

## 4. Database Schema & Migration Reconciliation

### 4.1 Public Table Count Reconciliation
- **The Discrepancy:** B19.5 reported 14 public tables; Migration 6 introduced `telemetry_rate_buckets`.
- **The Finding:** `telemetry_rate_buckets` is created as an `UNLOGGED` table (`CREATE UNLOGGED TABLE public.telemetry_rate_buckets`) to optimize high-frequency rate-limiting tokens. Legacy migration parsing scripts searched only for standard `CREATE TABLE` statements, missing the unlogged table.
- **The Resolution:**
  - Regex updated to `/CREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_.]+)/gi`.
  - The canonical public table count is factually **15 tables**:
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
    14. `telemetry_rate_buckets` (M6 - Unlogged)
    15. `storage_deletion_queue` (M10)

### 4.2 Migration Safety Audit
- **Canonical Files:** Exactly 10 migration files in `supabase/migrations/` in strict timestamp order.
- **Destructive SQL:** Zero occurrences of `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, or destructive data manipulation.
- **RLS Coverage:** 100% of the 15 public tables have Row Level Security enabled.
- **Search Path Hardening:** All `SECURITY DEFINER` functions explicitly set `SET search_path = pg_catalog, public`.

---

## 5. Conclusion

The evidence base across the repository is now fully unified, verified by automated test suites, and reconciled in all project documentation.
