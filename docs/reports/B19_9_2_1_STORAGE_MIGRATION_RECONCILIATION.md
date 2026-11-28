# AuroMasti v2.0.0 Beta — Storage Migration Reconciliation & Scope Assessment

**Milestone:** B19.9.2.1 (Bucket 2.1)  
**Project:** AuroMasti (formerly AuroMind)  
**Workspace:** `C:\AuroMindPortal`  
**Target Migration:** `supabase/migrations/20261123000002_b19_5_06_storage_buckets_and_rls.sql`  
**Canonical Manifest SHA-256:** `f55231159389f9d5549713ee83c783c1c7130dc7454058c8195140ae529899ea`  
**Target Release:** Version 2.0.0 Beta (Target Deadline: November 30, 2026)  
**Commercial Gate:** `COMMERCIAL_GATE_ENABLED=false` (Strictly Preserved)  
**Execution Boundary:** ZERO LIVE MUTATIONS  

---

## 1. Executive Summary & Purpose

This document provides the definitive architectural reconciliation of Migration 10 (`20261123000002_b19_5_06_storage_buckets_and_rls.sql`) against the AuroMasti platform storage architecture, local-first artwork policies, client-side privacy invariants, and release acceptance criteria.

### Key Conclusions:
1. **Actual Buckets in Migration 10**:  
   Migration 10 creates **exactly two private storage buckets**: `avatars` and `user-artwork`.
2. **Reconciliation of `mandala-cloud-sync`**:  
   A third bucket named `mandala-cloud-sync` was erroneously cited in earlier release reports (`AC-STO-01` in Bucket 1). Architectural and AST analysis confirms that **`mandala-cloud-sync` does NOT exist in Migration 10 SQL, does not exist in any other migration, and does not exist in the SDK or game source trees.**
3. **Core Privacy Invariant Preserved**:  
   Sankalpa contemplative journaling and notes remain **100% client-side only** in IndexedDB (encrypted with PBKDF2 210,000 iterations and non-extractable AES-256-GCM keys). Sankalpa data is **strictly excluded** from all cloud storage buckets and API telemetry.
4. **Recommendation**:  
   **Option 1: Retain Migration 10 AS-IS with evidence.**  
   No SQL modifications are required or recommended. The canonical manifest checksum `f55231159389f9d5...` remains 100% stable, avoiding unnecessary manifest churn and invalidation of preflight evidence.

---

## 2. In-Depth Technical Specification of Configured Buckets

Migration 10 provisions storage buckets within a defensive PostgreSQL anonymous block (`do $$ begin ... end; $$;`) that applies configuration only if the Supabase `storage.buckets` and `storage.objects` catalog tables exist.

### 2.1 Bucket: `avatars`
- **Bucket Identifier:** `'avatars'`
- **Public / Private Visibility:** `public = false` (Strictly private; direct unauthenticated CDN URLs disabled).
- **Maximum File Size Limit:** `524,288 bytes` (512 KiB).
- **Allowed MIME Types:** `['image/png', 'image/jpeg', 'image/webp']`.
  - *SVG Prohibition:* `image/svg+xml` is explicitly prohibited to prevent Stored Cross-Site Scripting (XSS) via embedded SVG `<script>` tags.
- **Intended Owner & Consumer:** Authenticated users (`auth.uid()`) uploading custom user profile pictures for portal identity display.
- **Path Structure & Ownership Policy:**  
  Path pattern enforced: `avatars/<auth.uid()>/<filename>`.  
  Ownership rule: `(storage.foldername(name))[1] = auth.uid()::text`.  
  Path-traversal denial: `name !~ '(^|/)\.\.(/|$)'`.
- **Policy Matrix (RLS on `storage.objects`):**
  - `SELECT`: Allowed only to `authenticated` where folder matches `auth.uid()`. Zero anonymous read.
  - `INSERT`: Allowed only to `authenticated` where folder matches `auth.uid()` and `(owner is null or owner = auth.uid())`.
  - `UPDATE`: Allowed only to `authenticated` where folder matches `auth.uid()`.
  - `DELETE`: Allowed only to `authenticated` where folder matches `auth.uid()`.
- **Service-Role Requirement:** None for standard client profile flows.
- **Release Requirement Status:** **REQUIRED FOR V2.0.0 BETA** to support profile avatar personalization without public leakage.

---

### 2.2 Bucket: `user-artwork`
- **Bucket Identifier:** `'user-artwork'`
- **Public / Private Visibility:** `public = false` (Strictly private).
- **Maximum File Size Limit:** `5,242,880 bytes` (5 MiB).
- **Allowed MIME Types:** `['image/png', 'image/webp', 'application/json']`.
  - Supports rendered PNG/WebP artwork images and optional JSON layer/palette metadata.
  - SVG is strictly prohibited.
- **Intended Owner & Consumer:** Authenticated players opting to manually back up or export AuroMandala creations.
- **Path Structure & Ownership Policy:**  
  Path pattern enforced: `user-artwork/<auth.uid()>/<artwork_id>/<file>`.  
  Ownership rule: `(storage.foldername(name))[1] = auth.uid()::text`.  
  Path-traversal denial: `name !~ '(^|/)\.\.(/|$)'`.
- **Policy Matrix (RLS on `storage.objects`):**
  - `SELECT`: Allowed only to `authenticated` where folder matches `auth.uid()`. Zero anonymous read.
  - `INSERT`: Allowed only to `authenticated` where folder matches `auth.uid()` and owner matches.
  - `UPDATE`: Allowed only to `authenticated` where folder matches `auth.uid()`.
  - `DELETE`: Allowed only to `authenticated` where folder matches `auth.uid()`.
- **Integration with Platform SDK:**  
  Directly wired to `assets/sdk/artwork-concurrency.js` (`StorageDeletionQueue`), which handles durable asynchronous cleanup of user-deleted artwork files with exponential backoff:
  ```javascript
  enqueue({ bucketId = 'user-artwork', objectPath, artworkId, snapshotId = null, ownerUserId = null })
  ```
- **Service-Role Requirement:** None for standard operations.
- **Release Requirement Status:** **REQUIRED FOR V2.0.0 BETA** to support explicit user artwork backup and deletion queue processing.

---

### 2.3 Reconciliation of Phantom Bucket: `mandala-cloud-sync`
- **Origin of Reference:** Earlier B18/B19 design drafts proposed a dedicated bucket named `mandala-cloud-sync`. This name was subsequently incorporated into descriptive text in `docs/reports/MASTER_RELEASE_ACCEPTANCE_MATRIX.md` (Row `AC-STO-01`).
- **Codebase Truth:**  
  Inspection of `supabase/migrations/20261123000002_b19_5_06_storage_buckets_and_rls.sql` confirms that **no such bucket is defined**.  
  Instead, AuroMandala implements a **local-first architecture**:
  - Primary save and undo/redo states reside in browser IndexedDB via `AuroMindPlatformDB`.
  - Multi-snapshot causal conflict resolution operates locally without requiring an active cloud storage connection.
  - When an authenticated player explicitly initiates an export or cloud backup, the asset is routed through the generic, secure `user-artwork` bucket.
- **Resolution:** The reference to `mandala-cloud-sync` is reconciled as documentation technical debt. No separate `mandala-cloud-sync` bucket is needed or desired for the v2.0.0 Beta release.

---

## 3. Sacred Privacy Invariant Reconciliation: Sankalpa Contemplation Vault

A critical security question raised during independent review is whether Migration 10 creates any cloud storage mechanism that could expose Sankalpa journal entries.

### Cryptographic and Architectural Isolation:
1. **Zero Cloud Sync Eligibility**:  
   In `assets/sdk/sankalpa-vault-lifecycle.js`, the capability descriptor explicitly locks cloud eligibility:
   ```javascript
   capabilities.cloudSyncEligible = false;
   ```
2. **Local Key Non-Extractability**:  
   Sankalpa encryption keys are generated in browser WebCrypto with `extractable: false`. The master passphrase derives the operational key via PBKDF2 with **210,000 iterations** (`SANKALPA_PBKDF2_ITERATIONS = 210000`).
3. **Storage Boundary Enforcement**:  
   Sankalpa records are stored exclusively in IndexedDB object store `sankalpa_vault_store` on the user's physical device.
4. **Exclusion from Migration 10**:  
   Migration 10 contains zero policies, buckets, triggers, or pathways for Sankalpa data. Neither `avatars` nor `user-artwork` accepts or processes Sankalpa payloads.
5. **Dump Privacy Filter**:  
   In `scripts/backup-database.mjs`, `verifyDumpPrivacyCompliance()` specifically fails closed if any Sankalpa table pattern is detected in a database dump (`/sankalpa_notes/i`, `/sankalpa_reflections/i`).

---

## 4. Evaluation and Final Recommendation

Three potential courses of action were evaluated:

| Option | Description | Architectural Impact | Manifest Checksum Impact | Recommendation |
|:---:|:---|:---|:---|:---:|
| **Option 1** | **Retain Migration 10 As-Is** | Reconciles documentation to reflect that `avatars` and `user-artwork` are the exact two intended buckets. Confirms `mandala-cloud-sync` is unnecessary. | **ZERO CHANGE** (`f55231159389...` remains canonical and verified). | **RECOMMENDED** |
| **Option 2** | **Amend Migration 10 to add `mandala-cloud-sync`** | Adds an unneeded duplicate bucket that is not consumed by the SDK or games, increasing cloud attack surface. | **CHECKSUM MUTATION** (Invalidates manifest, invalidates preflight, requires re-audit). | **REJECTED** |
| **Option 3** | **Defer / Delete `user-artwork` from Migration 10** | Breaks `assets/sdk/artwork-concurrency.js` (`StorageDeletionQueue`) and user artwork export functionality. | **CHECKSUM MUTATION** (Invalidates manifest and breaking SDK contract). | **REJECTED** |

### Decision:
**Option 1 is adopted.** Migration 10 is verified as structurally sound, cryptographically hardened, and correctly scoped. The canonical manifest checksum remains:
`f55231159389f9d5549713ee83c783c1c7130dc7454058c8195140ae529899ea`.
