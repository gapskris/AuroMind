# AuroMasti B19.8.3 — Remaining Risk Register & Mitigation Strategy

**Project:** AuroMasti (formerly AuroMind)  
**Milestone:** B19.8.3  
**Target Release:** January 1, 2027 — Version 2.0.0 Beta  
**Workspace:** `C:\AuroMindPortal`  
**Branch:** `dev/studio-integration`  
**Baseline Commit:** `51905465f3ac1e1e7ba2b8a78a855e90162a8b7f`  
**Report Date:** November 28, 2026 (Reconciled in B19.8.3.1)  
**Commercial Gate:** `COMMERCIAL_GATE_ENABLED=false` (Strictly Preserved)

---

## 1. Executive Summary

This register catalogs the active operational, architectural, and deployment risks prior to the scheduled remote cloud activation sprint on November 28, 2026.

All connectivity-independent risks have been permanently closed through local code remediation, deterministic manifest generation, attributable audit logging, and automated testing (44 suites, 719 tests, 100% passing).

The remaining 6 risks pertain strictly to remote cloud interaction, IPv6 ISP routing, ledger synchronization under disaster recovery fallbacks, client-side zero-knowledge key management, and live edge cache lifecycles.

---

## 2. Risk Matrix Overview

| Risk ID | Title | Category | Severity | Likelihood | Residual Risk | Status |
| :--- | :--- | :--- | :---: | :---: | :---: | :--- |
| **RSK-01** | Mobile Hotspot IPv6 Direct DB Failure | Infrastructure | High | Medium | Low-Medium | TLS 1.3 & CA Verified; Auth & CLI Lock Gates Pending |
| **RSK-02** | Dashboard SQL Ledger Divergence | Database | High | Low | Low | Mitigated by Repair Runbook & 10 Canonical Timestamps |
| **RSK-03** | Cloudflare Pages vs Custom Apex Routing | Deployment | Medium | Low | Medium | Config Validated Offline; Live Edge Verification Pending |
| **RSK-04** | Service Worker Aggressive Asset Caching | Client PWA | Medium | Low | Low | Tested on Desktop Chromium/Edge; Mobile WebKit Untested |
| **RSK-05** | Sankalpa Zero-Knowledge Passphrase Loss | Privacy / UX | High | Medium | Medium | Mitigated by PBKDF2 Backup; Inherent ZK Key Loss Risk Retained |
| **RSK-06** | Remote Supabase API Rate Throttling | Availability | Medium | Low | Low | Local Outbox & Limiter Verified; Live Cloud Throttling Pending |

---

## 3. Itemized Risk Details & Mitigation Plans

### RSK-01: Mobile Hotspot IPv6 Direct DB Connectivity Failure
- **Description:** Mobile hotspot or local ISP routing fails to resolve or route direct IPv6 TCP traffic to port 5432 on `db.rlqrtbjynaihdspbqtce.supabase.co`.
- **Impact:** Direct `supabase db push` or psql connections timeout or fail during preflight and migration.
- **Severity:** High | **Likelihood:** Medium | **Residual Risk:** Low-Medium (TLS 1.3 and CA Trust Verified; Auth & Migration Gates Pending)
- **Mitigation & B19.8.3.1 Layered Evidence:**
  1. **Layer 1 (DNS)**: Direct DB host fails IPv4 resolution on cellular hotspots. Primary Session Pooler (`aws-1-ap-southeast-1.pooler.supabase.com`) resolves cleanly to IPv4 (`54.179.210.0`), bypassing IPv6 routing barriers.
  2. **Layer 2 (TCP)**: TCP socket connects successfully to primary Session Pooler on port `5432` with 73ms latency.
  3. **Layer 3 (PostgreSQL Protocol)**: Primary Session Pooler accepts PostgreSQL STARTTLS SSLRequest packet (`80877103`), returning response byte `'S'` (SSL supported).
  4. **Layer 4 (TLS Handshake & CA Trust)**: TLS 1.3 negotiated successfully with cipher `TLS_AES_256_GCM_SHA384`. Supabase Root CA `prod-ca-2021.crt` (`CN=Supabase Root 2021 CA`, valid to 2031) verified with `Authorized: true` and trust status `SUPABASE_CA_VERIFIED`.
  5. **Session Pooler CLI Targeting & Zero-Exposure Credential Architecture**:
     Supabase CLI 3.4.0 supports `--remote=<postgres-url>` targeting custom Postgres URLs. `buildSessionPoolerUrl` constructs `postgresql://postgres.rlqrtbjynaihdspbqtce@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=verify-full&sslrootcert=C:/AuroMindPortal/prod-ca-2021.crt` with password strictly omitted from CLI arguments. Password is delivered in-memory via `PGPASSWORD` environment variable, preventing password leakage in Windows process listings (`Get-CimInstance Win32_Process`), shell history, or logs.
  6. **Remaining Verification Gates (Deferred to Live Broadband Activation in B19.9)**:
     - **Gate 1: PostgreSQL Wire Authentication**: Challenge and verify `postgres.rlqrtbjynaihdspbqtce` role credentials over the pooler connection.
     - **Gate 2: Database Selection**: Confirm access to target database `postgres`.
     - **Gate 3: Schema Permissions**: Confirm DDL permissions, table creation, and read/write access to `supabase_migrations.schema_migrations`.
     - **Gate 4: CLI Session Pooler Transaction / Lock Semantics**: Confirm Supabase CLI 3.4.0 migration locking and advisory lock compatibility over Supavisor session pooler.
  7. The preflight runner in `scripts/migration-workflow.mjs` provides explicit failure categorization (`DNS_RESOLUTION_FAILURE`, `CONNECTION_TIMEOUT`, `NETWORK_UNREACHABLE`) and fails safe immediately without modifying any tables.

### RSK-02: Dashboard SQL Ledger Divergence
- **Description:** If emergency disaster recovery requires applying `consolidated_migration_preview.sql` manually in the Supabase Dashboard SQL Editor, PostgreSQL DDL executes but the `supabase_migrations.schema_migrations` tracking table is bypassed. Subsequent CLI runs (`supabase db push`) would assume migrations are unapplied and attempt duplicate DDL execution, resulting in fatal schema collision errors.
- **Impact:** CLI migration tracking becomes desynchronized from the actual database state.
- **Severity:** High | **Likelihood:** Low | **Residual Risk:** Low
- **Mitigation & B19.8.3.1 Evidence:**
  1. Emergency manual SQL execution is formally classified as a disaster-recovery fallback, not an alternative deployment path.
  2. Prominent warning banners (`ARCHITECTURAL WARNING (B82-03 / B19.8.3.1)`) are injected at the top of `supabase/consolidated_migration_preview.sql` and the CLI bundle generator.
  3. **Strict Prohibition of Blanket Repair**: Blanket `migration repair` loops without affirmative verification are strictly prohibited. Ledger reconciliation is allowed ONLY on a strict per-migration basis after catalog inspection confirms all expected objects (tables, functions, policies) exist on the remote database.
  4. The controlled recovery procedure is documented in `B19_8_3_REMOTE_PREFLIGHT_RUNBOOK.md` Step 6 and exported programmatically in `MIGRATION_RECOVERY_SPECIFICATION` in `scripts/migration-workflow.mjs`.
  5. Integration tests verify warning presence, per-migration recovery specifications, and exact 10-timestamp consistency.

### RSK-03: Cloudflare Pages Routing vs Custom Apex Domain Routing
- **Description:** Differences between Cloudflare Pages default deployment (`*.pages.dev`) and custom domain edge routing (`auromasti.com`) could introduce CSP header mismatches or SPA fallback routing errors.
- **Impact:** Sub-game iframes or deep links could receive 404s or CSP blocking.
- **Severity:** Medium | **Likelihood:** Low | **Residual Risk:** Medium (Pending live staging deployment)
- **Mitigation & B19.8.3.1 Evidence:**
  1. Static configuration files `_headers` and `_routes.json` are validated offline by `scripts/validate-cloudflare-config.mjs` and tested in `b18-b5-csp.test.js`.
  2. Local verification confirms syntax and origin definitions, but DOES NOT prove live Cloudflare edge response behavior.
  3. Live edge header and routing verification is classified as `PENDING_REMOTE_VALIDATION` to be executed on `staging.auromasti.pages.dev` in B19.9.

### RSK-04: Service Worker Aggressive Asset Caching on Mobile Devices
- **Description:** Mobile browsers (especially iOS WebKit and Android Chrome) aggressively cache Service Worker scripts and cached PWA assets, potentially preventing clients from fetching updated game bundles or migration contracts.
- **Impact:** Users might run stale game code or obsolete API payloads.
- **Severity:** Medium | **Likelihood:** Low | **Residual Risk:** Low
- **Mitigation & B19.8.3.1 Evidence:**
  1. Real browser E2E test suites `auroblocks-sw-security.test.js` and `f2-cache-lifecycle-safeguards.test.js` verify that new SW versions install, activate, claim clients, and isolate cache namespaces (`auroblocks-v*`, `auromind-portal-v*`) on Chromium / Microsoft Edge on desktop.
  2. **Test Scope Limitation**: Testing is confirmed on Chromium desktop engine; mobile WebKit (iOS Safari) and mobile Chrome lifecycle must be smoke-tested on physical devices during staging validation.
  3. Cache-Control headers on `sw.js` and `service-worker.js` are strictly set to `no-cache, no-store, must-revalidate` in Cloudflare `_headers`.
  4. Root `sw.js` delivers `assets/sdk/*` via Cache-First strategy to child game iframes while allowing sub-game service workers complete autonomy over `/games/*`.

### RSK-05: Sankalpa Zero-Knowledge Passphrase Loss
- **Description:** Sankalpa reflections are encrypted client-side using WebCrypto AES-GCM-256 derived via PBKDF2 from a user-supplied passphrase. If a user forgets their passphrase, the server cannot recover the data.
- **Impact:** Permanent loss of encrypted reflection text for that individual user.
- **Severity:** High (User perception) | **Likelihood:** Medium | **Residual Risk:** Medium (Inherent zero-knowledge architectural risk)
- **Mitigation & B19.8.3.1 Evidence:**
  1. The UX displays prominent warnings during passphrase setup explaining zero-knowledge architecture.
  2. Encrypted JSON backup export (`exportEncryptedBackup`) protected by PBKDF2 (210,000 iterations) with non-destructive merge import (`importEncryptedBackup`).
  3. **Truth in Documentation**: Purged all false claims suggesting BIP-39 mnemonic phrase backup exists. The system relies strictly on PBKDF2 encrypted JSON envelopes.
  4. Full 14-step recovery test suite (`test-b19-8-3-1-integration-and-recovery.test.js`) verifies successful backup export, clean vault import, corrupted backup rejection, and wrong passphrase rejection.
  5. Only reflection body content is encrypted; user accounts, achievements, flora garden, and settings remain fully functional regardless of Sankalpa encryption status.

### RSK-06: Remote Supabase API Rate Throttling or Degraded Cloud Service
- **Description:** Burst traffic during launch or temporary Cloudflare/Supabase outage could cause transient 429 (Too Many Requests) or 503 errors.
- **Impact:** Telemetry, artwork sync, or auth profile updates temporarily fail to reach cloud storage.
- **Severity:** Medium | **Likelihood:** Low | **Residual Risk:** Low
- **Mitigation & B19.8.3.1 Evidence:**
  1. Offline-First Architecture: Portal and games operate 100% locally using IndexedDB (`localforage`).
  2. Persistent Outbox Queue: All mutations are staged in an offline queue with exponential backoff and jitter (`b19-5-07a-outbox-isolation.test.js`).
  3. Token Bucket Rate Limiting: Client-side token bucket throttling (`b18-d-token-bucket-validation.test.js`) prevents the client from flooding Supabase endpoints.
  4. **Distinction**: Local simulation validates that the client throttles requests and queues mutations, but actual remote cloud 429/503 behavior remains pending live traffic observation.

---

## 4. Sign-Off and Risk Acceptance

| Role | Name / Title | Decision | Date |
| :--- | :--- | :--- | :--- |
| **Principal Architect** | Antigravity AI Engineering Lead | Recommended with Controls | 2026-11-27 |
| **Security Lead** | AppSec Review Lead | Approved (Controlled Fallbacks) | 2026-11-27 |
| **Product Owner** | Engineering & Product Owner | Pending Formal Activation Sign-Off | Scheduled Nov 28, 2026 |
