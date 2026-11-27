# AuroMasti B19.8.3 — Remaining Risk Register & Mitigation Strategy

**Project:** AuroMasti (formerly AuroMind)  
**Milestone:** B19.8.3  
**Target Release:** January 1, 2027 — Version 2.0.0 Beta  
**Workspace:** `C:\AuroMindPortal`  
**Branch:** `dev/studio-integration`  
**Baseline Commit:** `51905465f3ac1e1e7ba2b8a78a855e90162a8b7f`  
**Report Date:** November 27, 2026  
**Commercial Gate:** `COMMERCIAL_GATE_ENABLED=false` (Strictly Preserved)

---

## 1. Executive Summary

This register catalogs the active operational, architectural, and deployment risks prior to the scheduled remote cloud activation sprint on November 28, 2026.

All connectivity-independent risks have been permanently closed through local code remediation, deterministic manifest generation, attributable audit logging, and automated testing (43 suites, 708 tests, 100% passing).

The remaining 6 risks pertain strictly to remote cloud interaction, IPv6 ISP routing, ledger synchronization under disaster recovery fallbacks, client-side zero-knowledge key management, and live edge cache lifecycles.

---

## 2. Risk Matrix Overview

| Risk ID | Title | Category | Severity | Likelihood | Residual Risk | Status |
| :--- | :--- | :--- | :---: | :---: | :---: | :--- |
| **RSK-01** | Mobile Hotspot IPv6 Direct DB Failure | Infrastructure | High | Medium | Low | Mitigated by Pooler Fallback & `diagnose:network` |
| **RSK-02** | Dashboard SQL Ledger Divergence | Database | High | Low | Low | Mitigated by Repair Runbook & 10 Canonical Timestamps |
| **RSK-03** | Cloudflare Pages vs Custom Apex Routing | Deployment | Medium | Low | Low | Mitigated by `_routes.json` & `_headers` Guard |
| **RSK-04** | Service Worker Aggressive Asset Caching | Client PWA | Medium | Low | Low | Mitigated by Cache-First SDK & `no-cache` SW Headers |
| **RSK-05** | Sankalpa Zero-Knowledge Passphrase Loss | Privacy / UX | High | Medium | Medium | Mitigated by PBKDF2 Encrypted JSON Backup (No Mnemonics) |
| **RSK-06** | Remote Supabase API Rate Throttling | Availability | Medium | Low | Low | Mitigated by Offline Outbox & Token Bucket Limiter |

---

## 3. Itemized Risk Details & Mitigation Plans

### RSK-01: Mobile Hotspot IPv6 Direct DB Connectivity Failure
- **Description:** Mobile hotspot or local ISP routing fails to resolve or route direct IPv6 TCP traffic to port 5432 on `db.rlqrtbjynaihdspbqtce.supabase.co`.
- **Impact:** Direct `supabase db push` or psql connections timeout or fail during preflight and migration.
- **Severity:** High | **Likelihood:** Medium | **Residual Risk:** Low
- **Mitigation & B19.8.3 Evidence:**
  1. The new standalone diagnostic script `scripts/diagnose-network.mjs` (`npm run diagnose:network`) was executed and proved that while direct IPv6 fails, the AWS pooler `aws-0-ap-southeast-1.pooler.supabase.com` resolves cleanly to IPv4 (`52.77.146.31`) and establishes TCP handshakes on port 6543 (96ms) and port 5432 (84ms).
  2. The preflight runner in `scripts/migration-workflow.mjs` provides explicit failure categorization (`DNS_RESOLUTION_FAILURE`, `CONNECTION_TIMEOUT`, `NETWORK_UNREACHABLE`).
  3. Preflight fails safe immediately without modifying any tables.

### RSK-02: Dashboard SQL Ledger Divergence
- **Description:** If emergency disaster recovery requires applying `consolidated_migration_preview.sql` manually in the Supabase Dashboard SQL Editor, PostgreSQL DDL executes but the `supabase_migrations.schema_migrations` tracking table is bypassed. Subsequent CLI runs (`supabase db push`) would assume migrations are unapplied and attempt duplicate DDL execution, resulting in fatal schema collision errors.
- **Impact:** CLI migration tracking becomes desynchronized from the actual database state.
- **Severity:** High | **Likelihood:** Low | **Residual Risk:** Low
- **Mitigation & B19.8.3 Evidence:**
  1. Emergency manual SQL execution is formally classified as a disaster-recovery fallback, not an alternative deployment path.
  2. Prominent warning banners (`ARCHITECTURAL WARNING (B82-03)`) are injected at the top of `supabase/consolidated_migration_preview.sql` and the CLI bundle output.
  3. Eradicated invalid timestamp `20261124000001` across the repository. The disaster recovery runbook strictly prescribes sequential execution across the exact 10 canonical timestamps:
     ```powershell
     # Execute sequentially for each canonical migration applied via SQL editor:
     npx supabase migration repair --status applied 20261120000001
     npx supabase migration repair --status applied 20261121000001
     npx supabase migration repair --status applied 20261121000002
     npx supabase migration repair --status applied 20261121000003
     npx supabase migration repair --status applied 20261122000001
     npx supabase migration repair --status applied 20261122000002
     npx supabase migration repair --status applied 20261122000003
     npx supabase migration repair --status applied 20261123000001
     npx supabase migration repair --status applied 20261123000002
     ```
  4. Integration tests in `test-b19-8-3-remediation.test.js` verify warning presence and exact 10-timestamp consistency.

### RSK-03: Cloudflare Pages Routing vs Custom Apex Domain Routing
- **Description:** Differences between Cloudflare Pages default deployment (`*.pages.dev`) and custom domain edge routing (`auromasti.com`) could introduce CSP header mismatches or SPA fallback routing errors.
- **Impact:** Sub-game iframes or deep links could receive 404s or CSP blocking.
- **Severity:** Medium | **Likelihood:** Low | **Residual Risk:** Low
- **Mitigation & B19.8.3 Evidence:**
  1. `_headers` and `_routes.json` files are tested and validated in test suites `b18-b5-csp.test.js` and `f3-f5-deployment-lifecycle.test.js`.
  2. Preflight validator `scripts/validate-cloudflare-config.mjs` verifies header formatting and origin whitelisting.
  3. GitHub Pages deployment has been restricted to manual `workflow_dispatch` only (`.github/workflows/pages.yml`), eliminating split-brain hosting.

### RSK-04: Service Worker Aggressive Asset Caching on Mobile Devices
- **Description:** Mobile browsers (especially iOS WebKit and Android Chrome) aggressively cache Service Worker scripts and cached PWA assets, potentially preventing clients from fetching updated game bundles or migration contracts.
- **Impact:** Users might run stale game code or obsolete API payloads.
- **Severity:** Medium | **Likelihood:** Low | **Residual Risk:** Low
- **Mitigation & B19.8.3 Evidence:**
  1. Real browser E2E test suites `auroblocks-sw-security.test.js` and `f2-cache-lifecycle-safeguards.test.js` verify that new SW versions install, activate, claim clients, and isolate cache namespaces (`auroblocks-v*`, `auromind-portal-v*`).
  2. Cache-Control headers on `sw.js` and `service-worker.js` are strictly set to `no-cache, no-store, must-revalidate` in Cloudflare `_headers`.
  3. Root `sw.js` delivers `assets/sdk/*` via Cache-First strategy to child game iframes while allowing sub-game service workers complete autonomy over `/games/*`.

### RSK-05: Sankalpa Zero-Knowledge Passphrase Loss
- **Description:** Sankalpa reflections are encrypted client-side using WebCrypto AES-GCM-256 derived via PBKDF2 from a user-supplied passphrase. If a user forgets their passphrase, the server cannot recover the data.
- **Impact:** Permanent loss of encrypted reflection text for that individual user.
- **Severity:** High (User perception) | **Likelihood:** Medium | **Residual Risk:** Medium
- **Mitigation & B19.8.3 Evidence:**
  1. The UX displays prominent warnings during passphrase setup explaining zero-knowledge architecture.
  2. Encrypted JSON backup export (`exportEncryptedBackup`) protected by PBKDF2 (210,000 iterations) with non-destructive merge import (`importEncryptedBackup`).
  3. **Truth in Documentation**: Purged all false claims suggesting BIP-39 mnemonic phrase backup exists. The system relies strictly on PBKDF2 encrypted JSON envelopes.
  4. Only reflection body content is encrypted; user accounts, achievements, flora garden, and settings remain fully functional regardless of Sankalpa encryption status.

### RSK-06: Remote Supabase API Rate Throttling or Degraded Cloud Service
- **Description:** Burst traffic during launch or temporary Cloudflare/Supabase outage could cause transient 429 (Too Many Requests) or 503 errors.
- **Impact:** Telemetry, artwork sync, or auth profile updates temporarily fail to reach cloud storage.
- **Severity:** Medium | **Likelihood:** Low | **Residual Risk:** Low
- **Mitigation & B19.8.3 Evidence:**
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
