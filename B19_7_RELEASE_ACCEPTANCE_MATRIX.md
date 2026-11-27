# AuroMasti — B19.7 Release Acceptance Matrix

**Target Release:** January 1, 2027 — Version 2.0.0 Beta  
**Baseline Commit:** `4cb7995`  
**Execution Context:** Offline-First Engineering (November 27, 2026)  
**Cloud Activation Target:** Batch B19.8 (November 28, 2026)  

---

## 1. Definitive Acceptance Matrix (Local vs. Remote)

| Category / Component | Local Implementation & Offline Evidence | Remote Activation Requirement | Acceptance Status | Risk & Contingency Fallback |
| :--- | :--- | :--- | :---: | :--- |
| **BLK-01: Database & Migrations** | 10 canonical SQL migrations in `supabase/migrations/`; 100% RLS on 15 tables; hardened function search paths; verified via `b19-5-05-db-migration-integrity.test.js` & `supabase-migration-preflight.test.js` (23 tests passing). | Run `npx supabase db push` against `rlqrtbjynaihdspbqtce` and execute `supabase/verify_remote_schema.sql`. | **VERIFIED OFFLINE / PENDING REMOTE VALIDATION** | Low. All SQL statements are idempotent. Idempotent SQL bundle fallback prepared for Dashboard SQL Editor. |
| **BLK-02: Edge Functions** | 6 functions in `supabase/functions/` (`sync-save`, `ingest-telemetry`, `cleanup-telemetry`, `delete-account`, `owner-metrics`, `verify-entitlements`); error responses sanitized; owner role check enforced; verified via 35 unit/integration tests. | Deploy via `npx supabase functions deploy <name>` and verify HTTP response headers. | **VERIFIED OFFLINE / PENDING REMOTE VALIDATION** | Low. Deno Edge runtime matches local web-standard handler implementation. Client operates with graceful offline fallbacks. |
| **BLK-03: Storage Buckets** | Migration 10 provisions private `avatars` (512 KiB; PNG/JPEG/WebP; NO SVG) and `user-artwork` (5 MiB; PNG/WebP/JSON; private opt-in only); path traversal and owner-folder RLS verified; SDK storage provider tested (10 tests passing). | Provision buckets on Supabase project and verify storage RLS policies in dashboard. | **VERIFIED OFFLINE / PENDING REMOTE VALIDATION** | Very Low. SDK operates local-first; game art and saves persist in browser storage without cloud dependency. |
| **BLK-04: Cloudflare Pages Staging** | `_headers` and `_routes.json` validated; exactly 3 launch titles in catalogue (`auromandala`, `auromatch`, `auroblocks`); zero concept card leakage; responsive layout and real browser tests passing (15 tests). | Configure Cloudflare Pages project `auromasti` with build command `npm run build` and output `.`. | **VERIFIED OFFLINE / PENDING REMOTE VALIDATION** | Low. Staging deployment is non-disruptive and isolated from production. Rollback script available. |
| **BLK-05: Domain, DNS & SSL** | DNS activation plan prepared for `auromasti.com` (CNAME flattening) and `staging.auromasti.pages.dev`; redirect URIs in `config.toml` match domains; SSL Universal Certificate architecture documented. | Complete DNS record addition at domain registrar and configure Universal SSL mode in Cloudflare. | **PROCEDURALLY DOCUMENTED / PENDING ACTIVATION** | Low. Staging domain functions immediately without custom domain DNS cutover. |
| **BLK-06: Auth & SMTP** | Redirect URL allowlist in `config.toml` strictly qualified; storage limits aligned; transactional email checklist (SPF, DKIM, DMARC) and SMTP configuration prepared. | Enable custom SMTP in Supabase Dashboard (Auth > Settings > Email) and verify domain records. | **PROCEDURALLY DOCUMENTED / PENDING ACTIVATION** | Low. Passwordless magic link uses Supabase default transactional delivery if custom SMTP is deferred. |
| **BLK-07: DR & Operations** | `restore-database.mjs` enforces multi-indicator production guard (`isProductionTarget`), disposable target confirmation, path containment, and manifest SHA-256 verification (20 tests passing). | Test database restore against disposable staging database. | **VERIFIED OFFLINE** | Zero. Restore script fails closed on production targets by architectural design. |
| **BLK-07: Telemetry & Retention** | 60-day server-authoritative retention cutoff; daily rollup summaries (`telemetry_daily_aggregates`); bounded batch deletions (5,000 max); zero PII; verified via `b19-5-08-telemetry-operations.test.js`. | Execute periodic cron / scheduled Edge Function invocation for `cleanup-telemetry`. | **VERIFIED OFFLINE / PENDING REMOTE VALIDATION** | Low. In-memory and client-side pruning prevents local telemetry accumulation. |
| **BLK-07: Entitlements & Commerce** | `COMMERCIAL_GATE_ENABLED = false` active across all entrypoints; Ed25519 token verifier enforces `alg: 'EdDSA'`, `typ: 'JWT'`, and 30-day monotonic offline grace; payments bypassed (all 3 launch games free). | N/A (Commercial gate remains permanently disabled for Version 2.0.0 Beta release). | **VERIFIED OFFLINE & FROZEN** | Zero risk. Commercial execution paths are completely dormant and bypassed. |
| **PWA & Offline Resilience** | Root service worker precaches application shell; delegates child game routes (`/games/*`) to isolated game service workers; offline startup and cache cleanup verified in real browser. | Deploy static assets with cache-control headers via Cloudflare Pages edge. | **VERIFIED OFFLINE** | Zero risk. Fully tested in headless Chromium/Edge harness. |
| **Accessibility & Senior Mode** | Senior Mode toggle active; high-contrast tiles in MaaMATCH; large-print typography; touch targets $\ge 44 \times 44$px; zero horizontal scroll on mobile (375px). | N/A (Client-side presentation). | **VERIFIED OFFLINE** | Zero risk. Validated across mobile (375x667), tablet (768px), and desktop (1280px). |

---

## 2. Sacred Data Invariants Status

| Invariant Name | Canonical SHA-256 Checksum | Measured SHA-256 Checksum | File / Asset Path | Status |
| :--- | :--- | :--- | :--- | :---: |
| **VAK Full HTML** | `A8E2EF8B9B5E7F95B231C75B185C3DDEB61EA8FCB4C25C85FABC6872FA780360` | `A8E2EF8B9B5E7F95B231C75B185C3DDEB61EA8FCB4C25C85FABC6872FA780360` | `games/vak/index.html` | **HEALTHY** |
| **VAK Speech Corpus** | `9fdb3826030049c9eab183479bcb7fe29304b3ea08d045c8c67f1cfd4d77da09` | `9fdb3826030049c9eab183479bcb7fe29304b3ea08d045c8c67f1cfd4d77da09` | `const CL = [...]` (93,744 bytes) | **HEALTHY** |
| **Flora Botanical DB** | `689d035cd52abd8d342528d8c5f61f298916b8052b8287450be4931cf8ae1a3a` | `689d035cd52abd8d342528d8c5f61f298916b8052b8287450be4931cf8ae1a3a` | `games/auromatch/src/models/floraDatabase.js` | **HEALTHY** |
| **Commercial Gate** | `COMMERCIAL_GATE_ENABLED = false` | `false` | `assets/sdk/config/backend-config.js` | **HEALTHY** |

---

## 3. Executive Decision

All offline-executable components, security safeguards, regression suites, and infrastructure runbooks for AuroMasti Version 2.0.0 Beta have been validated. The repository is officially designated:

**READY FOR B19.8 REMOTE PREFLIGHT (WITH DOCUMENTED CONDITIONS)**
