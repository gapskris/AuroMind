# AuroMasti — B19.8 CI/CD & Operational Lifecycle Readiness Report
**Release Automation, Multi-Tier Environment Isolation, Zero-Downtime Strategy, and Operational Runbooks**

- **Target Release:** Version 2.0.0 Beta (Target Release Date: January 1, 2027)
- **Workspace:** `C:\AuroMindPortal`
- **Branch:** `dev/studio-integration`
- **Baseline Commit:** `cc98b2b`
- **Commercial Gate Invariant:** `COMMERCIAL_GATE_ENABLED = false`
- **Status:** **OPERATIONAL & PRODUCTION-READY**

---

## 1. Multi-Tier Environment Separation

The AuroMasti deployment architecture (`scripts/deployment-automation.mjs`) defines three distinct environments with strictly enforced configuration separation:

| Dimension | `local-preview` | `staging` | `production` |
| :--- | :--- | :--- | :--- |
| **Target Host / Domain** | `localhost:8080` | `staging.auromasti.pages.dev` | `auromasti.com` |
| **Base URL** | `http://localhost:8080` | `https://staging.auromasti.pages.dev` | `https://auromasti.com` |
| **CSP Mode** | `development` (permissive connect) | `strict` (Cloudflare Pages headers) | `strict` (Full HSTS + CSP) |
| **Analytics & Telemetry** | `false` (Mocked / Offline) | `opt-in-only` (Staging Supabase) | `opt-in-only` (Production Supabase) |
| **Mock Providers Active** | `true` (createLocalMockBridge) | `false` (Real Supabase REST/Auth) | `false` (Real Supabase REST/Auth) |
| **Commercial Gate Enabled** | `false` (Unconditional Invariant) | `false` (Unconditional Invariant) | `false` (Unconditional Invariant) |
| **Strict Headers Enforced** | `false` | `true` (via `_headers`) | `true` (via `_headers`) |
| **Deployment Mechanism** | Local static server | Cloudflare Pages Direct Upload | Cloudflare Pages Production |
| **Target Audience** | Local Developers / QA | Product Owner & Beta Testers | General Public (AuroMasti) |

---

## 2. CI/CD Workflow & Allowlist Deployment Pipeline

### 2.1 GitHub Actions Workflow (`.github/workflows/pages.yml`)
- **Triggers:** Push to `dev/studio-integration`, manual `workflow_dispatch`.
- **Concurrency Control:** `group: pages`, `cancel-in-progress: false` (guarantees atomic build ordering).
- **Security Boundary:**
  - Strict static allowlist: copies ONLY approved runtime assets into `_site/` (`index.html`, `manifest.json`, `sw.js`, `assets/`, `games/`, `owner-analytics/`).
  - Strict exclusion: completely excludes `.git/`, `.github/`, `.env*`, `architecture-design/`, `phase0-audit/`, `supabase/`, `server.js`, `*.test.js`, `package.json`, `package-lock.json`, `bun.lock`, and all documentation.
  - Jekyll disabled via `.nojekyll` to prevent asset path rewriting.
  - Automated verification step verifies all 14 required entrypoints and asserts zero leakage of forbidden files before artifact publishing.

---

## 3. Zero-Downtime Release Promotion & Rollback

### 3.1 Release Promotion Workflow (`scripts/deployment-automation.mjs`)
1. **Bundle Assembly:** Compiles approved static files and directories into a versioned release bundle.
2. **Cryptographic Manifest Generation:** Generates `build-manifest.json` containing SHA-256 checksums and byte sizes for every included file.
3. **Overwrite Protection:** Prohibits re-promoting to an already existing release version tag without an explicit force flag.
4. **Atomic Version Staging:** Moves the validated release bundle to `.releases/v<version>/`.
5. **Zero-Downtime Swap:** Performs an atomic directory pointer update so active traffic experiences zero interruption or partial file reads.

### 3.2 Rollback Procedure
1. **Target Verification:** Resolves target rollback version (e.g. `v1.9.0` or previous release).
2. **Integrity Check:** Reads the rollback target's `build-manifest.json` and verifies SHA-256 hashes of all assets.
3. **Temporary Staging:** Unpacks to a isolated staging directory (`.rollback-staging/`).
4. **Atomic Directory Swap:** Performs an atomic directory swap replacing the active deployment with the rollback version.
5. **Windows Resilience:** In the event of a filesystem lock or interruption, staging directory rollback is caught cleanly and preserves the active deployment unharmed.

---

## 4. Service Worker Lifecycle & Offline Cache Governance

### 4.1 Multi-Service Worker Hierarchy
- **Root Portal Service Worker (`sw.js`):**
  - Manages `auro-portal-v2.0.0` CacheStorage namespace.
  - Pre-caches critical app shell: `index.html`, `manifest.json`, `assets/css/portal.css`, `assets/js/portal.js`, `assets/sdk/auromind-sdk.js`, `assets/sdk/auromind-adapters.js`.
  - Employs `Promise.allSettled` resilience: failure of optional assets (e.g. ambient audio or promo banners) does not abort service worker installation.
  - **Autonomous Route Delegation:** Specifically excludes `/games/*` routes from root cache storage (`url.pathname.startsWith('/games/')` returns network/game fetch), allowing game service workers full autonomous lifecycle control.
- **Autonomous Game Service Workers (e.g. `games/auroblocks/sw.js`):**
  - Manages isolated `auroblocks-v2.0.0` cache namespace.
  - Scope strictly bounded to `/games/auroblocks/`.
  - Cache deletion on activate strictly checks `cacheName.startsWith('auroblocks-')`, guaranteeing zero interference with portal or sibling game caches.

### 4.2 Cache Invalidation & Seamless Updates
1. Deploying a new release updates `serviceWorkerCacheVersion` in `release-manifest.json`.
2. Browser detects byte change in `sw.js` on navigation.
3. New SW installs in background and prepares new cache version.
4. Old cache is purged ONLY after the new SW successfully completes activation.
5. `clearPortalPreferencesOnly` preserves all user game saves, single-device guest identity, and offline artwork byte-for-byte.

---

## 5. Feature Flags & Operational Invariants

```json
"featureFlags": {
  "COMMERCIAL_GATE_ENABLED": false,
  "ENABLE_432HZ_AUDIO": true,
  "ENABLE_SENIOR_MODE": true,
  "ENABLE_OFFLINE_OUTBOX": true,
  "ENABLE_LOCAL_FIRST_SANKALPA": true,
  "ENABLE_ANALYTICS_CONSENT_BANNER": true,
  "TELEMETRY_DEFAULT_OPT_IN": false
}
```

- **Commercial Gate:** `COMMERCIAL_GATE_ENABLED = false` is enforced across portal runtime, release manifest, and deployment automation. Free, unmonetized access is guaranteed for the January 1, 2027 Beta release.
- **Privacy First:** `TELEMETRY_DEFAULT_OPT_IN = false`. Zero telemetry events are dispatched to cloud without affirmative user consent.
- **Local-First Sankalpa:** Sacred contemplation and personal reflection data remain 100% on-device in IndexedDB/localStorage and are strictly barred from cloud transmission.

---

## 6. Operational Health Checks & Monitoring

The continuous health check runner (`scripts/health-check.mjs`) is integrated into build and release pipelines:
- **Execution Command:** `node scripts/health-check.mjs`
- **Exit Code 0:** All 4 sacred invariants confirmed, exactly 3 launch applications active, deployment headers verified, status `HEALTHY`.
- **Exit Code 1 (Fail-Closed):** Any tampering with sacred hashes, manifest discrepancies, or `COMMERCIAL_GATE_ENABLED=true` immediately aborts the deployment and raises `UNHEALTHY`.

---

## 7. Operational Readiness Verdict

The CI/CD pipelines, multi-tier environment configurations, zero-downtime release automation, and rollback mechanisms are fully operational and verified. AuroMasti is structurally ready for the November 28 cloud activation and January 1, 2027 public release.
