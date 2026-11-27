# AuroMasti B19.8.2 — Master Open-Issue Register

**Project:** AuroMasti (formerly AuroMind)  
**Target Release:** January 1, 2027 — Version 2.0.0 Beta  
**Branch:** `dev/studio-integration`  
**Evaluation Date:** November 27, 2026  
**Status Baseline:** Hardened Offline Baseline with Complete Issue Closure & Safety Enforcement  
**Commercial Gate:** `COMMERCIAL_GATE_ENABLED=false` (Strictly Enforced)

---

## 1. Executive Summary & Register Arithmetic Reconciliation

This Master Open-Issue Register provides an exhaustive, mathematically reconciled accounting of every technical finding, security gap, migration risk, architectural ambiguity, and operational task across the AuroMasti project (batches B17 through B19.8.2).

### Arithmetic Reconciliation (B82-04 Resolution)
The B19.8.1 register contained an arithmetic discrepancy (claiming 27 total issues while category counts summed to 30). In B19.8.2, every operational deployment step and new safety remediation has been assigned an explicit, unique issue identifier, establishing exact 1:1 parity between the itemized register and category totals:

- **Total Tracked Issues:** **34**
- **Closed Locally (`CLOSED_LOCALLY`):** **22** (64.7%)
- **Policy Verified Invariants (`POLICY_VERIFIED`):** **7** (20.6%)
- **Deferred to Live Activation (`DEFERRED_REMOTE_ACTIVATION`):** **5** (14.7%)
- **Sum Check:** $22 + 7 + 5 = 34$ (Exact Match — Zero Discrepancy)

---

## 2. Master Issue & Finding Matrix

| Issue ID | Domain / Category | Severity | Origin | Title / Description | Status | Responsible Role / Owner | Dependencies | Resolution / Evidence | Action Required / Next Steps |
|:---|:---|:---:|:---:|:---|:---:|:---|:---|:---|:---|
| **BLK-01** | Database / Migration | Critical | B19.5 | Supabase CLI Missing & Unpinned | `CLOSED_LOCALLY` | DevOps Lead | None | Pinned `@supabase/cli` (v3.4.0) locally as devDependency; invoked reliably via `npx supabase`. | None (Locally complete). |
| **BLK-02** | Database / Migration | High | B19.5 | Direct DB Password Direct-Connection Reliance | `CLOSED_LOCALLY` | Backend Architect | None | Adopted Minimal Credential Model; all migrations executable via Supabase CLI (`SUPABASE_ACCESS_TOKEN`). | Use CLI push on Nov 28. |
| **BLK-03** | Database / Migration | Critical | B19.5 | Migration History & Drift Unverified | `DEFERRED_REMOTE_ACTIVATION` | DBA / Backend Lead | IPv4 Connectivity | Offline dry-run & preview bundle generated; CLI preflight command ready (`npx supabase migration list --remote`). | Run preflight once IPv4 connectivity is restored. |
| **BLK-04** | Security / Auth | High | B19.5 | Storage Bucket & RLS Setup Missing | `DEFERRED_REMOTE_ACTIVATION` | Cloud Security Lead | IPv4 Connectivity | Migration 10 (`20261123000002_b19_5_06_storage_buckets_and_rls.sql`) implements buckets & RLS; pre-verified offline. | Execute Migration 10 during remote activation. |
| **BLK-05** | Security / Auth | Medium | B19.5 | Production Auth Site URL & Redirects Unconfigured | `DEFERRED_REMOTE_ACTIVATION` | Security Architect | IPv4 Connectivity | Auth URL matrix and configuration runbook prepared for `auromasti.com` and `staging.auromasti.pages.dev`. | Update Supabase Dashboard Auth Settings on Nov 28. |
| **BLK-06** | Hosting / Edge | High | B19.5 | Cloudflare Pages Deployment & Edge Headers Unverified | `CLOSED_LOCALLY` | Infrastructure Lead | None | `_headers`, `_routes.json`, and deployment validation scripts implemented and verified by automated tests. | Deploy to Cloudflare Pages staging on Nov 28. |
| **BLK-07** | Governance / Release | Critical | B19.5 | Formal Product Owner Migration Authorization Gate | `CLOSED_LOCALLY` | Release Manager | None | `validateMigrationExecutionGate()` added with 8 strict mandatory conditions; fails closed by default. | PO must sign off gate conditions prior to live push. |
| **SEC-01** | Security / Redaction | High | B19.4 | Credential Exposure in Validation Output | `CLOSED_LOCALLY` | Security Engineer | None | `maskSecret()` applied to all sensitive keys (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`); scanner passes 100%. | None (Permanently enforced). |
| **SEC-02** | Security / Auth | Critical | B19.4 | Publishable Key (`sb_publishable_`) Rejected | `CLOSED_LOCALLY` | Fullstack Engineer | None | Dual-format validator implemented; accepts both `sb_publishable_` and legacy JWT anon keys while rejecting service_role keys. | None (Verified). |
| **SEC-03** | Security / Governance | Critical | B17 | Commercial Gate Invariant Maintenance | `POLICY_VERIFIED` | Product Owner | None | `COMMERCIAL_GATE_ENABLED = false` strictly enforced in `backend-config.js` and verified across 4+ test suites. | Retain `false` for 2.0.0 Beta release. |
| **DB-01** | Database / Schema | Medium | B19.6 | Public Table Count Discrepancy (14 vs 15) | `CLOSED_LOCALLY` | Database Engineer | None | Discrepancy reconciled: 14 logged tables + 1 unlogged table (`telemetry_rate_buckets` in Migration 6) = 15 total tables. | Verification script checks all 15. |
| **DB-02** | Database / Safety | High | B19.6 | Destructive SQL in Migrations Audit | `POLICY_VERIFIED` | DBA | None | Zero `DROP`, `TRUNCATE`, or destructive statements found across all 10 canonical migrations. | Maintain zero destructive SQL invariant. |
| **DB-03** | Database / Schema | Medium | B19.8.1 | Post-Migration Verification SQL Missing Table 15 | `CLOSED_LOCALLY` | Database Engineer | None | `verify_remote_schema.sql` and `scripts/migration-workflow.mjs` updated to verify all 15 tables with RLS. | Run `verify_remote_schema.sql` after migration push. |
| **SW-01** | PWA / Offline | High | B17 | Root Service Worker /games/* Isolation | `POLICY_VERIFIED` | Frontend Lead | None | Root `sw.js` strictly bypasses `/games/*` routes, preventing cross-game cache collisions and respecting child workers. | Preserved. |
| **SW-02** | PWA / Offline | Medium | B17 | Offline Shared SDK Delivery to Game Iframes | `CLOSED_LOCALLY` | Frontend Engineer | None | `sw.js` updated to exempt all `assets/sdk/*` paths from the game referrer bypass, ensuring full offline gameplay. | Verified in tests. |
| **SW-03** | PWA / Offline | High | B19.5 | Service Worker Install Rejection on Network Drops | `CLOSED_LOCALLY` | Frontend Engineer | None | Root and child SWs use `Promise.allSettled` for optional assets and atomic fail-closed for critical shell. | Tested in `f2-cache-lifecycle-safeguards.test.js`. |
| **UI-01** | UI / Catalog | Medium | B17 | Catalog Duplication (AuroBlocks / MaaBlocs) | `CLOSED_LOCALLY` | UI/UX Lead | None | DOM contains exactly 3 curated `article.game-card` elements (AuroMandala, MaaMATCH, MaaBLOCK); zero duplication. | None (Verified). |
| **UI-02** | UI / Catalog | Low | B17 | Senior Mode Broadcast Contract | `CLOSED_LOCALLY` | Accessibility Lead | None | Portal broadcasts `AUROMIND_SET_SENIOR_MODE`; all games listen and adjust typography/contrast accordingly. | Tested in `b17-remediation.test.js`. |
| **UI-03** | UI / Catalog | Medium | B17 | In-Game Theater Exit PostMessage Handshake | `CLOSED_LOCALLY` | Frontend Engineer | None | `auromatch` `window.exitToAuroMindPortal` updated to include `gameId: 'auromatch'`; `portal.js` strictly validates. | Tested in regression. |
| **UI-04** | UI / Audio | Low | B17 | Ambient Audio State Restoration on Theater Exit | `CLOSED_LOCALLY` | Audio Engineer | None | Portal records audio state on entry and automatically resumes playback when closing game theater. | Tested in `b17-remediation.test.js`. |
| **ARCH-01**| Architecture / Hosting | High | B19.8 | Hosting Platform Ambiguity (GitHub vs Cloudflare) | `CLOSED_LOCALLY` | Infrastructure Lead | None | Cloudflare Pages confirmed as canonical production/staging host; GitHub Pages deploy restricted to `workflow_dispatch`. | Cloudflare staging build verification on Nov 28. |
| **DATA-01**| Sacred Invariant | Critical | B17 | VAK Speech Corpus Integrity (`const CL`) | `POLICY_VERIFIED` | Principal Architect | None | Exact SHA-256 digest `9fdb3826030049c9eab183479bcb7fe29304b3ea08d045c8c67f1cfd4d77da09` verified. | Protected from modification. |
| **DATA-02**| Sacred Invariant | Critical | B17 | VAK Full HTML File Integrity (`index.html`) | `POLICY_VERIFIED` | Principal Architect | None | Exact SHA-256 digest `A8E2EF8B9B5E7F95B231C75B185C3DDEB61EA8FCB4C25C85FABC6872FA780360` verified. | Protected from modification. |
| **DATA-03**| Sacred Invariant | Critical | B17 | AuroMatch Flora Database Integrity | `POLICY_VERIFIED` | Principal Architect | None | Exact SHA-256 digest `689d035cd52abd8d342528d8c5f61f298916b8052b8287450be4931cf8ae1a3a` verified (46,321 lines, 2,002,176 bytes). | Protected from modification. |
| **DATA-04**| Sacred Invariant | Critical | B18 | Sankalpa Contemplation Vault Privacy | `POLICY_VERIFIED` | Security Architect | None | Vault is 100% local-first storage; zero telemetry, zero cloud sync, non-exportable private key. | Verified in `b17-remediation.test.js`. |
| **OPS-01** | Operations / CI | Medium | B19.8 | CI Regression Test Execution Stability | `CLOSED_LOCALLY` | QA Lead | None | All test suites run cleanly offline without external network dependencies. | Run full CI workflow on push. |
| **OPS-02** | Operations / Rollback | High | B19.7 | Remote Migration Rollback Readiness | `CLOSED_LOCALLY` | DevOps Lead | None | Consolidated preview bundle generated; rollback procedures documented in Activation Runbook. | Follow Runbook in event of migration failure. |
| **ACT-01** | Operations / Deployment | High | B19.8.2 | Cloudflare Pages Staging Deployment Execution | `DEFERRED_REMOTE_ACTIVATION` | Release Manager | Git Push to dev | Cloudflare Pages staging build triggered via Git push to `dev/studio-integration`. | Verify staging URL on Nov 28. |
| **ACT-02** | Operations / Deployment | High | B19.8.2 | Production DNS Cutover to auromasti.com | `DEFERRED_REMOTE_ACTIVATION` | Release Manager | Cloudflare Staging Pass | DNS CNAME and custom domain binding configured in Cloudflare Dashboard. | Perform cutover following staging signoff. |
| **B82-01** | Database / Safety | Critical | B19.8.2 | Migration Gate Execution Boundary Enforcement | `CLOSED_LOCALLY` | Application Security Lead | None | `executeRemoteMigrations` and `runSupabaseCli` enforce 8-gate verification, manifest hash matching, and explicit attributable PO approval. | Verified in `test-b19-8-2-migration-safety.test.js`. |
| **B82-02** | Database / Integrity | High | B19.8.2 | Deterministic Migration Checksum Manifest | `CLOSED_LOCALLY` | Release Engineer | None | `supabase/migrations_manifest.json` generated with aggregate SHA-256 digest `f55231159389f9d5...`; verified in preflight. | Tested in `test-b19-8-2-migration-safety.test.js`. |
| **B82-03** | Database / Operations | High | B19.8.2 | Manual SQL Fallback Ledger Drift Risk & Removal | `CLOSED_LOCALLY` | Principal Architect | None | Removed claims that manual SQL execution is equivalent to CLI push. Reclassified manual SQL as emergency disaster recovery requiring ledger repair. | Runbook updated. |
| **B82-04** | Governance / Audit | Medium | B19.8.2 | Master Issue Register Arithmetic & Traceability Reconciliation | `CLOSED_LOCALLY` | QA Lead | None | Reconciled all 34 issue IDs, category counts, and status totals with exact mathematical agreement. | Master Register published. |
| **B82-05** | Governance / Acceptance | High | B19.8.2 | Offline vs Live Release Acceptance Separation | `CLOSED_LOCALLY` | Release Manager | None | Re-evaluated all 36 acceptance requirements under granular 8-state model; separated offline proof from remote dependencies. | Matrix published. |

---

## 3. Summary of Issue Resolution

- **Total Tracked Issues:** 34
- **Closed Locally:** 22
- **Policy Verified / Enforced Invariants:** 7
- **Deferred to Remote Activation (Nov 28+):** 5
  - *BLK-03: Supabase Remote Drift Preflight*
  - *BLK-04: Storage Bucket Creation on Supabase*
  - *BLK-05: Auth Site URL Configuration on Supabase*
  - *ACT-01: Cloudflare Pages Staging Deployment Execution*
  - *ACT-02: Production DNS Cutover to auromasti.com*

Zero local unaddressed defects or ambiguities remain in the AuroMasti repository.
