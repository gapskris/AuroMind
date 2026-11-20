# AuroMasti Platform — Local Development Workflow Guide

**Canonical Workspace:** `C:\AuroMindPortal`  
**Active Development Branch:** `dev/studio-integration`  
**Target Release:** January 1, 2027  
**Platform Architecture:** Local-First Web Applets, Plug-and-Play Shared SDK, Offline-Safe Fallbacks  

---

## 1. Architecture Overview

AuroMasti is an intergenerational cognitive wellness platform hosting six mindfulness games. The platform adheres to strict local-first principles:

1. **Zero Mandatory Cloud Dependency:** All 6 games and the portal execute entirely in-browser without network requirements.
2. **Pluggable Provider Architecture:** The Shared Platform SDK ([assets/sdk/auromind-sdk.js](file:///C:/AuroMindPortal/assets/sdk/auromind-sdk.js)) decouples all games from concrete backend providers.
3. **Multi-Provider Support:**
   - **`NULL` Provider:** Default offline mode. Player saves and profiles remain in local storage (`localStorage` + `IndexedDB`).
   - **`SUPABASE` Provider:** Centralized consent-based analytics and server-authorized Owner Analytics (inactive until live project credentials are provided).
   - **`FIREBASE` Provider:** Extensible portability provider (fully implemented, currently inactive).
4. **Sacred Data Guarantees:**
   - **Sankalpa Contemplation Vault:** 100% local-only E2EE storage. Telemetry never ingests or syncs contemplation notes.
   - **VAK Speech Corpus:** Frozen 1,368-level speech training dataset (SHA-256 `9fdb3826030049c9eab183479bcb7fe29304b3ea08d045c8c67f1cfd4d77da09`).
   - **AuroMatch Flora Database:** Exactly 2,002,176 bytes across 46,321 botanical records.

---

## 2. Prerequisites & Environment Setup

- **Runtime:** Node.js v20.x or higher (v24.22.0 tested and certified).
- **External Dependencies:** Zero external npm packages required for runtime or tests. [server.js](file:///C:/AuroMindPortal/server.js) dynamically detects Express if available and seamlessly falls back to native `node:http`.
- **Environment Variables:**
  - Copy [.env.example](file:///C:/AuroMindPortal/.env.example) to `.env` if custom local overrides are needed (port, etc.).
  - **Security Rule:** Never commit real API keys, passwords, or service-role keys. `.env` and `.env.*` are ignored by [.gitignore](file:///C:/AuroMindPortal/.gitignore).

---

## 3. Starting the Local Development Server

Run the development preview server:

```powershell
# From the repository root (C:\AuroMindPortal):
node server.js
```

Or using npm:

```powershell
npm run dev
# or
npm start
```

- **Default URL:** [http://localhost:3000](http://localhost:3000)
- **Custom Port:** Set the `PORT` environment variable:
  ```powershell
  $env:PORT=8080; node server.js
  ```
- **Security Headers Applied:** The server automatically emits hardened headers on every response:
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: SAMEORIGIN` (allows in-portal iframe game embedding; blocks cross-origin framing)
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`
  - Content Security Policy (CSP) with `frame-ancestors 'self'` and `connect-src https://*.supabase.co`

---

## 4. Running the Automated Test Suites

The test suite runs using Node.js's native test runner (`node --test`), requiring zero third-party test dependencies.

### 4.1 Running All 14 Test Suites (191 Tests)

```powershell
# Run the complete test suite:
node --test server.test.js auromind-sdk.test.js b3-game-integration.test.js b4-platform-services.test.js b5-supabase.test.js b6-regression.test.js b6-security-verification.test.js b8-security-remediation.test.js b9-firebase-provider.test.js b9-provider-conformance.test.js b10-analytics.test.js b11-game-integration.test.js b13a-remediation.test.js b13b-operational-hardening.test.js
```

Expected output:
```
ℹ tests 191
ℹ pass 191
ℹ fail 0
ℹ skipped 0
```

### 4.2 Running Specific Test Categories

| Test Category | Command | Target Coverage |
|---|---|---|
| **Portal & Server Routes** | `node --test server.test.js` | Static serving, security headers, SDK bootstrap, service worker precache |
| **Shared SDK & Identity** | `node --test auromind-sdk.test.js` | Guest identity, Web Locks, cross-tab sync, storage self-healing, save envelopes |
| **Game Integrations** | `node --test b3-game-integration.test.js b11-game-integration.test.js` | 6 games E2E lifecycle, manifest alignment, isolated iframe storage |
| **Platform Services** | `node --test b4-platform-services.test.js` | Telemetry buffering, outbox sync, state managers |
| **Security & Hardening** | `node --test b6-security-verification.test.js b8-security-remediation.test.js b13a-remediation.test.js b13b-operational-hardening.test.js` | Rate limiting, payload size caps, proxy handling, retention, RLS |
| **Supabase Integration** | `node --test b5-supabase.test.js` | Client layer, Auth, REST, RPC, Edge Function mocks |
| **Firebase Portability** | `node --test b9-firebase-provider.test.js b9-provider-conformance.test.js` | Firestore sync, dual-provider conformance, zero coupling |
| **Analytics & Retention** | `node --test b10-analytics.test.js` | Consent lifecycle, opt-out purge, attribution parsing, Free tier quotas |

---

## 5. Game Directory & Integration Structure

Each of the six launch games resides in its dedicated directory under `games/`:

```
games/
├── auroblocks/             # AuroBlocks Mindful Geometry
│   ├── index.html, sw.js, manifest.webmanifest, assets/
├── auromandala/            # PranaMandala Meditation
│   ├── index.html, sw.js, manifest.webmanifest, assets/auromandala-sdk-bridge.js
├── auromatch/              # AuroMatch Solitaire & Flora
│   ├── index.html, sw.js, manifest.json, src/models/floraDatabase.js
├── vak/                    # VAK Speech Training
│   ├── index.html, sw.js, manifest.json, speech corpus
├── vak-living-sanctuary/   # VAK Living Sanctuary 3D
│   ├── index.html, sw.js, manifest.webmanifest, assets/
└── word-riddle/            # Word Riddle Wisdom
    ├── index.html, sw.js, manifest.webmanifest, assets/
```

### Game Integration Rules
1. **Never Import Cloud SDKs:** Games interact solely via the global `window.AuroMind` SDK instance or game-specific adapter bridges.
2. **Game-Owned Storage:** Each game manages its own save data keys and format. The platform SDK never mutates game-specific internal state.
3. **Isolated Cache Domains:** The root service worker ([sw.js](file:///C:/AuroMindPortal/sw.js)) bypasses `/games/*` routes so each game maintains its isolated cache domain.

---

## 6. Offline Validation & Service Worker Behavior

1. **Root Service Worker:** Pre-caches portal assets and Shared SDK modules under cache name `auro-portal-v1.1.0`.
2. **Testing Offline Mode in Browser:**
   - Start the local server: `node server.js`.
   - Open [http://localhost:3000](http://localhost:3000) in Chrome/Edge/Firefox.
   - Open Developer Tools -> **Application** -> **Service Workers** (verify registered and active).
   - Go to **Network** tab -> select **Offline**.
   - Reload page: Portal and all 6 games must load and remain playable from cache.
3. **Storage Fallback:**
   - If IndexedDB is blocked or unavailable, the platform automatically degrades to `localStorage`.
   - If both are unavailable, the platform degrades to ephemeral in-memory storage without crashing.

---

## 7. Inspecting the Active Backend Provider

In the browser developer console:

```javascript
// Check backend configuration:
import('./assets/sdk/config/backend-config.js').then(m => console.log(m.resolveBackendConfig()));

// Expected offline output:
// { environment: "development", provider: "supabase", isConfigured: false, supabaseUrl: null, ... }
```

- When `isConfigured` is `false`, the platform automatically operates in local-first `NULL` provider mode.
- When `AUROMIND_SUPABASE_URL` and `AUROMIND_SUPABASE_ANON_KEY` are provided, the platform seamlessly connects to Supabase.

---

## 8. Environment Variables Reference

| Variable Name | Environment | Purpose | Required / Default |
|---|---|---|---|
| `PORT` | Local Dev | HTTP server listening port | Optional (Default: `3000`) |
| `NODE_ENV` | All | Runtime environment mode | Optional (`development`, `testing`, `production`) |
| `AUROMIND_SUPABASE_URL` | Production / Staging | Supabase project API endpoint (`https://<id>.supabase.co`) | Required for live analytics |
| `AUROMIND_SUPABASE_ANON_KEY` | Production / Staging | Public publishable Anon JWT key | Required for live analytics |
| `SUPABASE_SERVICE_ROLE_KEY` | Server Edge Functions ONLY | Secret administrative key for `ingest-telemetry` | **NEVER in frontend** |
| `TELEMETRY_SALT` | Server Edge Functions ONLY | Salt for anonymous client IP hashing | Server-side only |

---

## 9. Code Quality & Pre-Commit Checks

Before staging or proposing code changes:

```powershell
# 1. Verify syntax across modified files:
node --check server.js
node --check assets/js/portal.js
node --check assets/sdk/auromind-sdk.js

# 2. Run the complete test suite:
node --test server.test.js auromind-sdk.test.js b*.test.js

# 3. Verify protected invariants:
node -e "
const fs = require('fs');
const crypto = require('crypto');
const vak = fs.readFileSync('games/vak/index.html', 'utf8');
const match = vak.match(/const CL = \[\[[\s\S]*?\]\];/);
const hash = crypto.createHash('sha256').update(match[0]).digest('hex');
console.log('VAK Checksum:', hash === '9fdb3826030049c9eab183479bcb7fe29304b3ea08d045c8c67f1cfd4d77da09' ? 'PASS' : 'FAIL');
const floraSize = fs.statSync('games/auromatch/src/models/floraDatabase.js').size;
console.log('Flora Size:', floraSize === 2002176 ? 'PASS (2,002,176 B)' : 'FAIL');
"
```
