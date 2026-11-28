# AuroMasti B19.8.2 — Remaining Risk Register & Mitigation Strategy

**Project:** AuroMasti (formerly AuroMind)  
**Target Release:** January 1, 2027 — Version 2.0.0 Beta  
**Workspace:** `C:\AuroMindPortal`  
**Branch:** `dev/studio-integration`  
**Baseline Commit:** `83a2c59`  
**Report Date:** November 27, 2026  
**Commercial Gate:** `COMMERCIAL_GATE_ENABLED=false` (Preserved)

---

## 1. Executive Summary

This register catalogs the remaining active operational, architectural, and deployment risks prior to the scheduled remote activation sprint on November 28, 2026. 

All connectivity-independent risks have been closed through local code remediation, deterministic manifest generation, programmatic gate enforcement, and automated testing (688/688 tests passing). 

The remaining risks pertain strictly to remote cloud interaction, network environments, ledger tracking under manual fallbacks, client-side zero-knowledge key recovery, and live CDN cache lifecycle.

---

## 2. Risk Matrix Overview

| Risk ID | Title | Category | Severity | Likelihood | Residual Risk | Status |
| :--- | :--- | :--- | :---: | :---: | :---: | :--- |
| **RSK-01** | Mobile Hotspot IPv6 Direct DB Failure | Infrastructure | High | Medium | Low | Mitigated by Pooler Fallback |
| **RSK-02** | Dashboard SQL Ledger Divergence (B82-03) | Database | High | Low | Low | Mitigated by Repair Runbook |
| **RSK-03** | Cloudflare Pages vs Subdomain Routing | Deployment | Medium | Low | Low | Mitigated by `_routes.json` Guard |
| **RSK-04** | Service Worker Aggressive Asset Caching | Client PWA | Medium | Low | Low | Mitigated by Cache Bust & SW Versioning |
| **RSK-05** | Sankalpa Zero-Knowledge Passphrase Loss | Privacy / UX | High | Medium | Medium | Mitigated by Warning & Recovery Key |
| **RSK-06** | Remote Supabase API Rate Throttling | Availability | Medium | Low | Low | Mitigated by Exponential Backoff & Outbox |

---

## 3. Itemized Risk Details & Mitigation Plans

### RSK-01: Mobile Hotspot IPv6 Direct DB Connectivity Failure
- **Description:** Mobile hotspot or local ISP routing in the developer's environment fails to establish direct IPv6 TCP connections to port 5432 on `db.rlqrtbjynaihdspbqtce.supabase.co`.
- **Impact:** `supabase db push` or direct psql execution may hang or timeout during preflight and migration.
- **Severity:** High | **Likelihood:** Medium | **Residual Risk:** Low
- **Mitigation:**
  1. The preflight runner in `scripts/migration-workflow.mjs` probes IPv4 pooler connectivity (`aws-0-ap-southeast-1.pooler.supabase.com:6543`) alongside direct port 5432.
  2. If direct port 5432 is unreachable due to IPv6 routing, the CLI can be configured to use pooler connection strings or tunnel via cloudflare/tailscale.
  3. Preflight fails safe immediately and does not mutate any tables if connectivity checks fail.

### RSK-02: Dashboard SQL Ledger Divergence (Finding B82-03)
- **Description:** If emergency disaster recovery requires applying `consolidated_migration_preview.sql` manually in the Supabase Dashboard SQL Editor, PostgreSQL DDL executes but the `supabase_migrations.schema_migrations` tracking table is bypassed. Subsequent CLI runs (`supabase db push`) would assume migrations are unapplied and attempt duplicate DDL execution, resulting in fatal schema collision errors.
- **Impact:** CLI migration tracking becomes desynchronized from the actual database state.
- **Severity:** High | **Likelihood:** Low | **Residual Risk:** Low
- **Mitigation:**
  1. Emergency manual SQL execution is formally classified as a disaster-recovery fallback, not an alternative deployment path.
  2. Clear prominent warning banners are injected at the top of `supabase/consolidated_migration_preview.sql` and the CLI bundle output.
  3. Mandatory step documented in the emergency runbook: Operator must independently inspect remote public objects first via catalog queries (`information_schema`, `pg_proc`), verify database backup, and only then conditionally reconcile verified versions individually. Blanket `migration repair` loops without affirmative catalog verification are strictly prohibited.
  4. Integration tests in `test-b19-8-2-migration-safety.test.js` verify that the warning headers and CLI repair instructions are present in the generated SQL artifact.

### RSK-03: Cloudflare Pages Routing vs Custom Domain Subdomain Routing
- **Description:** Differences between Cloudflare Pages default deployment (`*.pages.dev`) and custom domain edge routing (`auromasti.com` or `portal.auromasti.com`) could introduce CSP header mismatches or SPA fallback routing errors.
- **Impact:** Sub-game iframes or deep links could receive 404s or CSP blocking.
- **Severity:** Medium | **Likelihood:** Low | **Residual Risk:** Low
- **Mitigation:**
  1. `_headers` and `_routes.json` files are tested and validated in test suite `b18-b5-csp.test.js` and `f3-f5-deployment-lifecycle.test.js`.
  2. Preflight validator `scripts/validate-cloudflare-config.mjs` verifies header formatting and origin whitelisting.
  3. Phase 5 of the remote activation checklist prescribes immediate live smoke-testing of both direct portal paths and iframe game containers across both apex and pages.dev preview domains.

### RSK-04: Service Worker Aggressive Asset Caching on Mobile Devices
- **Description:** Mobile browsers (especially iOS WebKit and Android Chrome) aggressively cache Service Worker scripts and cached PWA assets, potentially preventing clients from fetching updated game bundles or migration contracts.
- **Impact:** Users might run stale game code or obsolete API payloads.
- **Severity:** Medium | **Likelihood:** Low | **Residual Risk:** Low
- **Mitigation:**
  1. Real browser E2E test suites `auroblocks-sw-security.test.js` and `f2-cache-lifecycle-safeguards.test.js` verify that new SW versions install, activate, claim clients, and isolate cache namespaces (`auroblocks-v*`, `auromind-portal-v*`).
  2. Cache-Control headers on `sw.js` and `service-worker.js` are strictly set to `no-cache, no-store, must-revalidate` in Cloudflare `_headers`.
  3. SDK includes an automatic cache invalidation handshake upon detecting server version increments.

### RSK-05: Sankalpa Zero-Knowledge Client-Side Key Loss
- **Description:** Sankalpa reflections are encrypted client-side using AES-GCM-256 derived via PBKDF2 from a user-supplied passphrase. If a user forgets their passphrase, the server cannot recover the data, which could lead to user frustration.
- **Impact:** Permanent loss of encrypted reflection text for that individual user.
- **Severity:** High (User perception) | **Likelihood:** Medium | **Residual Risk:** Medium
- **Mitigation:**
  1. The UX displays prominent, unmissable warnings during passphrase setup explaining zero-knowledge architecture.
  2. Encrypted JSON backup export (`exportEncryptedBackup`) protected by PBKDF2 (210,000 iterations) with non-destructive merge import (`importEncryptedBackup`). BIP-39 mnemonic phrase backup is not implemented and must not be claimed.
  3. Only the reflection body is encrypted; user accounts, achievements, flora garden, and settings remain fully functional regardless of Sankalpa encryption status.

### RSK-06: Remote Supabase API Rate Throttling or Degraded Cloud Service
- **Description:** Sudden burst traffic during launch or temporary Cloudflare/Supabase outage could cause transient 429 (Too Many Requests) or 503 errors.
- **Impact:** Telemetry, artwork sync, or auth profile updates temporarily fail to reach cloud storage.
- **Severity:** Medium | **Likelihood:** Low | **Residual Risk:** Low
- **Mitigation:**
  1. Offline-First Architecture: Portal and games operate 100% locally using IndexedDB (`localforage`).
  2. Persistent Outbox Queue: All mutations are staged in an offline queue with exponential backoff and jitter (`b19-5-07a-outbox-isolation.test.js`).
  3. Token Bucket Rate Limiting: Client-side token bucket throttling (`b18-d-token-bucket-validation.test.js`) prevents the client from flooding Supabase endpoints.

---

## 4. Sign-Off and Risk Acceptance

| Role | Name / Title | Decision | Date |
| :--- | :--- | :--- | :--- |
| **Principal Architect** | Antigravity AI Engineering Lead | Recommended with Controls | 2026-11-27 |
| **Security Lead** | AppSec Review Lead | Approved (Controlled Fallbacks) | 2026-11-27 |
| **Product Owner** | Engineering & Product Owner | Pending Formal Activation Sign-Off | Scheduled Nov 28, 2026 |
