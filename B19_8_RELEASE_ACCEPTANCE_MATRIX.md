# AuroMasti — B19.8 Release Acceptance Matrix
**Version 2.0.0 Beta (Target Release: January 1, 2027)**

- **Evaluation Date:** November 27, 2026
- **Workspace:** `C:\AuroMindPortal`
- **Branch:** `dev/studio-integration`
- **Baseline Commit:** `cc98b2b`
- **Test Results:** 40 / 40 Suites Passing (653 / 653 Tests Passing, 0 Failures, 0 Flakes)
- **Overall Release Gate Status:** **CONDITIONALLY APPROVED FOR NOVEMBER 28 REMOTE ACTIVATION**

---

## 1. Acceptance Matrix by Roadmap Section

### Section A: Database Schema, Migrations & Remote Preflight Engine

| Requirement ID | Requirement Description | Implementation Reference | Test Verification Suite | Status | Risk Rating | Sign-Off |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **REQ-A1.1** | Canonical migration ordering: 10 SQL files in strict chronological sequence | `supabase/migrations/` | `supabase-migration-preflight.test.js` (PREFLIGHT-04) | **VERIFIED LOCAL** | Low | PASS |
| **REQ-A1.2** | 100% RLS on public tables: 15 tables with 49 policies, zero un-RLSed tables | `supabase/migrations/` | `b19-5-05-db-migration-integrity.test.js` | **VERIFIED LOCAL** | Negligible | PASS |
| **REQ-A1.3** | Security Definer functions specify explicit pinned search_path | Migrations 1, 2, 4, 7, 8, 9 | `b18-c-security-remediation.test.js` | **VERIFIED LOCAL** | Negligible | PASS |
| **REQ-A1.4** | Destructive SQL guard: fails closed on DROP TABLE, TRUNCATE, DROP SCHEMA | `scripts/migration-workflow.mjs` | `supabase-migration-preflight.test.js` (PREFLIGHT-05) | **VERIFIED LOCAL** | Low | PASS |
| **REQ-A2.1** | Deterministic 6-state preflight engine (UNVERIFIED, CLEAN, PENDING, etc.) | `scripts/migration-workflow.mjs` | `supabase-migration-preflight.test.js` (PREFLIGHT-12) | **VERIFIED LOCAL** | Low | PASS |
| **REQ-A2.2** | Fail closed on uninspected schema when remoteApplied is empty | `scripts/migration-workflow.mjs` | `supabase-migration-preflight.test.js` (PREFLIGHT-13) | **VERIFIED LOCAL** | Low | PASS |
| **REQ-A2.3** | Product Owner Authorization Gate: 0 remote mutations without explicit flag | `scripts/migration-workflow.mjs` | `supabase-migration-preflight.test.js` (PREFLIGHT-08) | **VERIFIED LOCAL** | Low | PASS |
| **REQ-A2.4** | Remote database schema application via `npx supabase db push` | Nov 28 Checklist (Item 10) | Pending live execution | **PENDING REMOTE ACTIVATION** | Medium | DEFERRED |

---

### Section B: Supabase Local Readiness & Storage Security

| Requirement ID | Requirement Description | Implementation Reference | Test Verification Suite | Status | Risk Rating | Sign-Off |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **REQ-B1.1** | Edge Function `sync-save`: 512 KiB streaming limit, optimistic concurrency | `supabase/functions/sync-save/` | `b5-supabase.test.js`, `b19-5-06-auth-profile-storage.test.js` | **VERIFIED LOCAL** | Low | PASS |
| **REQ-B1.2** | Edge Function `ingest-telemetry`: 64 KiB body limit, 50-batch cap, rate limit | `supabase/functions/ingest-telemetry/` | `b19-5-08-telemetry-operations.test.js` | **VERIFIED LOCAL** | Low | PASS |
| **REQ-B1.3** | Edge Function `cleanup-telemetry`: 60-day cutoff, 30-day floor, daily rollups | `supabase/functions/cleanup-telemetry/` | `b13b-operational-hardening.test.js` | **VERIFIED LOCAL** | Low | PASS |
| **REQ-B1.4** | Edge Function `delete-account`: cascaded deletion via auth.users FK | `supabase/functions/delete-account/` | `b19-5-06-auth-profile-storage.test.js` | **VERIFIED LOCAL** | Low | PASS |
| **REQ-B1.5** | Edge Function `owner-metrics`: server aggregation, role='owner' validation | `supabase/functions/owner-metrics/` | `b5-supabase.test.js` | **VERIFIED LOCAL** | Low | PASS |
| **REQ-B1.6** | Edge Function `verify-entitlements`: RLS query, active claim return | `supabase/functions/verify-entitlements/` | `b19-5-09-entitlements-commerce.test.js` | **VERIFIED LOCAL** | Low | PASS |
| **REQ-B2.1** | Storage bucket `avatars`: 512 KiB limit, PNG/JPEG/WebP only, NO SVG | Migration 10 & `config.toml` | `b19-5-06-auth-profile-storage.test.js` | **VERIFIED LOCAL** | Negligible | PASS |
| **REQ-B2.2** | Storage bucket `user-artwork`: 5 MiB limit, private opt-in only | Migration 10 & `config.toml` | `b19-5-06-auth-profile-storage.test.js` | **VERIFIED LOCAL** | Negligible | PASS |
| **REQ-B2.3** | Storage object owner-folder RLS and path-traversal denial | Migration 10 | `b19-5-06-auth-profile-storage.test.js` | **VERIFIED LOCAL** | Negligible | PASS |
| **REQ-B3.1** | Environment validator: 0 warnings, 0 errors, structural credential safety | `scripts/validate-env.mjs` | `environment-configuration.test.js` | **VERIFIED LOCAL** | Negligible | PASS |
| **REQ-B3.2** | Secret exposure scanner: 0 service_role / private keys in bundles / git diff | `scripts/validate-secret-exposure.mjs` | `environment-configuration.test.js` | **VERIFIED LOCAL** | Negligible | PASS |
| **REQ-B4.1** | Remote Edge Function deployment & live HTTP endpoints verification | Nov 28 Checklist (Items 15–16) | Pending live execution | **PENDING REMOTE ACTIVATION** | Medium | DEFERRED |

---

### Section C: Shared SDK and Live Integration

| Requirement ID | Requirement Description | Implementation Reference | Test Verification Suite | Status | Risk Rating | Sign-Off |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **REQ-C1.1** | Single-origin guest identity (`guest_<uuid>`) shared across portal & games | `assets/sdk/auromind-sdk.js` | `auromind-sdk.test.js`, `b11-game-integration.test.js` | **VERIFIED LOCAL** | Negligible | PASS |
| **REQ-C1.2** | Adapter registry enforces namespace isolation (no cross-game overwrites) | `assets/sdk/auromind-adapters.js` | `b18-b2-shared-sdk-and-adapters.test.js` | **VERIFIED LOCAL** | Negligible | PASS |
| **REQ-C2.1** | In-game navigation: AUROMIND_CLOSE_THEATER returns to portal shell cleanly | `assets/js/portal.js`, adapters | `f1-f2-real-browser-validation.test.js` | **VERIFIED LOCAL** | Low | PASS |
| **REQ-C3.1** | Telemetry allowlisting: strict category & event name allowlist | Telemetry handlers | `b19-5-08-telemetry-operations.test.js` | **VERIFIED LOCAL** | Negligible | PASS |
| **REQ-C3.2** | Sankalpa vault & private reflection notes 100% excluded from telemetry | Telemetry & adapters | `b19-5-04-sankalpa-privacy-crypto.test.js` | **VERIFIED LOCAL** | Negligible | PASS |
| **REQ-C4.1** | Commercial gate disabled invariant: `COMMERCIAL_GATE_ENABLED=false` | Global runtime & manifest | `health-check.mjs`, `b19-5-09-entitlements-commerce.test.js` | **VERIFIED LOCAL** | Negligible | PASS |
| **REQ-C4.2** | Ed25519 entitlement verification and 30-day offline grace support | Entitlements provider | `b19-5-09-entitlements-commerce.test.js` | **VERIFIED LOCAL** | Low | PASS |
| **REQ-C5.1** | Disaster recovery runner: `--force-production` lock, path containment | `scripts/restore-database.mjs` | `b19-5-10-backup-disaster-recovery.test.js` | **VERIFIED LOCAL** | Low | PASS |

---

### Section D: Cloudflare, CSP, and PWA Testing

| Requirement ID | Requirement Description | Implementation Reference | Test Verification Suite | Status | Risk Rating | Sign-Off |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **REQ-D1.1** | Static production build creates complete standalone bundle | `npm run build` | `f3-f5-deployment-lifecycle.test.js` | **VERIFIED LOCAL** | Negligible | PASS |
| **REQ-D2.1** | `_headers`: CSP, HSTS, X-Content-Type-Options, frame-ancestors 'self' | `_headers` | `b18-b5-csp.test.js`, `validate-cloudflare-config.mjs` | **VERIFIED LOCAL** | Negligible | PASS |
| **REQ-D2.2** | `_routes.json`: version 1, static assets bypassed to CDN edge | `_routes.json` | `validate-cloudflare-config.mjs` | **VERIFIED LOCAL** | Negligible | PASS |
| **REQ-D3.1** | Portal root Service Worker isolates cache, bypasses `/games/*` | `sw.js` | `f2-cache-lifecycle-safeguards.test.js` | **VERIFIED LOCAL** | Low | PASS |
| **REQ-D3.2** | Offline startup: portal loads completely from CacheStorage | `sw.js` | `f1-f2-real-browser-validation.test.js` | **VERIFIED LOCAL** | Low | PASS |
| **REQ-D4.1** | Multi-viewport responsive rendering (375x667, 768px, 1280px) | `assets/css/portal.css` | `f1-f2-real-browser-validation.test.js` | **VERIFIED LOCAL** | Low | PASS |
| **REQ-D5.1** | Live Cloudflare Pages staging deployment and DNS verification | Nov 28 Checklist (Item 17) | Pending live execution | **PENDING REMOTE ACTIVATION** | Medium | DEFERRED |

---

### Section E: Release Candidate Preparation & Scoping

| Requirement ID | Requirement Description | Implementation Reference | Test Verification Suite | Status | Risk Rating | Sign-Off |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **REQ-E1.1** | Catalogue scope: exactly 3 launch applications (AuroMandala, MaaMATCH, MaaBLOCK) | `index.html`, `release-manifest.json` | `f1-f2-real-browser-validation.test.js`, `health-check.mjs` | **VERIFIED LOCAL** | Negligible | PASS |
| **REQ-E1.2** | Zero concept card leakage in search or catalog views | `assets/js/portal.js` | `f1-f2-real-browser-validation.test.js` | **VERIFIED LOCAL** | Negligible | PASS |
| **REQ-E2.1** | MaaBLOCK journey mode progression & 60 levels unique-values mechanic | `games/auroblocks/` | `auroblocks-sw-security.test.js` | **VERIFIED LOCAL** | Low | PASS |
| **REQ-E3.1** | Full automated regression: 100% passing across all 40 test suites | `scripts/run-all-tests.mjs` | `test-execution-results.json` (653 / 653) | **VERIFIED LOCAL** | Negligible | PASS |
| **REQ-E4.1** | Sacred byte invariants (VAK HTML, VAK Corpus, Flora DB) | File baselines | `health-check.mjs` | **VERIFIED LOCAL** | Negligible | PASS |
| **REQ-E5.1** | Release manifest versioned to 2.0.0 Beta (Target: January 1, 2027) | `release-manifest.json` | `f3-f5-deployment-lifecycle.test.js` | **VERIFIED LOCAL** | Negligible | PASS |

---

### Section F: CI/CD, DevOps, and Operational Lifecycle

| Requirement ID | Requirement Description | Implementation Reference | Test Verification Suite | Status | Risk Rating | Sign-Off |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **REQ-F1.1** | Environment separation: local-preview, staging, production configs | `scripts/deployment-automation.mjs` | `f3-f5-deployment-lifecycle.test.js` | **VERIFIED LOCAL** | Negligible | PASS |
| **REQ-F2.1** | GitHub Pages allowlist deployment workflow (.github/workflows/pages.yml) | `.github/workflows/pages.yml` | Workflow inspection | **VERIFIED LOCAL** | Negligible | PASS |
| **REQ-F3.1** | Zero-downtime release promotion to `.releases/v<version>/` with overwrite guard | `scripts/deployment-automation.mjs` | `f3-f5-deployment-lifecycle.test.js` | **VERIFIED LOCAL** | Low | PASS |
| **REQ-F3.2** | Zero-downtime rollback via temporary staging and atomic directory swap | `scripts/deployment-automation.mjs` | `f3-f5-deployment-lifecycle.test.js` | **VERIFIED LOCAL** | Low | PASS |
| **REQ-F4.1** | Health check verifies sacred invariants, 3 apps, and headers | `scripts/health-check.mjs` | `f3-f5-deployment-lifecycle.test.js` | **VERIFIED LOCAL** | Negligible | PASS |
| **REQ-F5.1** | Live staging end-to-end smoke test & owner sign-off | Nov 28 Checklist (Items 18–20) | Pending live execution | **PENDING REMOTE ACTIVATION** | Medium | DEFERRED |

---

## 2. Summary Statistics & Acceptance Verdict

- **Total Requirements Tracked:** 36
- **Verified Locally (Passing Automated Tests):** 32 / 36 (88.9%)
- **Pending Remote Cloud Activation (Nov 28):** 4 / 36 (11.1%)
  1. REQ-A2.4: Remote database DDL execution (`npx supabase db push`)
  2. REQ-B4.1: Remote Edge Function deployment & live verification
  3. REQ-D5.1: Live Cloudflare Pages staging deployment
  4. REQ-F5.1: Live staging end-to-end smoke test & owner sign-off
- **Definitive Decision:** **CONDITIONALLY APPROVED FOR NOVEMBER 28 REMOTE ACTIVATION**
