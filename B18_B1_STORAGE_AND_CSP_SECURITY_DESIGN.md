# AuroMasti B18-B1 — Storage Resilience & Security Architecture Design
## Comprehensive Architecture Design for F-04, F-05, and F-09

- **Document Version:** 1.0.0
- **Batch Reference:** AuroMasti B18-B1 (Read-Only Architecture & Blueprint)
- **Target Branch:** `dev/studio-integration`
- **Canonical Workspace:** `C:\AuroMindPortal`
- **Target Release:** January 1, 2027
- **Findings Addressed:**
  - **F-04 (P2):** Storage Resilience & WebKit/Blink Eviction Defense Missing `navigator.storage.persist()`
  - **F-05 (P2):** AuroMatch Auto-Healing Logic Flaw & Unidirectional Sync Vulnerability
  - **F-09 (P3):** Production CSP & Hosting Header Discrepancies Across Static Hosts

---

## 1. Executive Summary

AuroMasti is fundamentally a **local-first web gaming platform**. Players invest substantial time advancing through games (e.g., 100+ levels in AuroMatch, intricate custom mandalas in AuroMandala, speech progression in VAK). In a local-first platform, client-side storage is the primary system of record. 

Prior to B18-B1, the platform suffered from three distinct storage and security risks:
1. **Silent Storage Eviction (F-04):** WebKit/Safari Intelligent Tracking Prevention (ITP) purges script-writable client storage after 7 days of inactivity, and Chromium/Firefox evict LRU origins under disk storage pressure because the platform never requested persistent storage permission.
2. **AuroMatch Auto-Healing Failure (F-05):** The fallback recovery mechanism in `AuroMatch`'s `storageAdapter.js` contained a critical logic flaw: it checked if `localStorage.getItem('auro_match_user')` was truthy before attempting recovery from IndexedDB, meaning a corrupt, empty, or truncated string prevented auto-healing entirely.
3. **CSP Deployment Divergence (F-09):** The local Node.js development server (`server.js`) enforced a strict Content Security Policy, but static cloud hosting definitions (e.g., Vercel, Cloudflare Pages, Netlify) lacked synchronized security headers, leaving game iframes vulnerable to clickjacking and script injection.

This document designs a unified storage resilience architecture, a fault-tolerant auto-healing and corruption recovery protocol, and a production-grade multi-host CSP configuration.

---

## 2. Storage Resilience & Eviction Defense Architecture (F-04)

### 2.1 The Browser Eviction Threat Model
Web browsers classify client storage under two operational modes:
- **Best-Effort Storage (Default):** The browser may evict origin data without asking the user when disk space runs low. Safari on iOS/macOS further enforces ITP, wiping all non-cookie local storage after 7 days without user interaction on that origin.
- **Persistent Storage:** The browser guarantees that origin data will not be evicted during automated disk cleanups, and Safari suspends the 7-day ITP wiping policy for the origin.

### 2.2 Persistent Storage Initialization Specification
In `assets/sdk/auromind-sdk.js`, during platform bootstrap, the SDK must invoke `navigator.storage.persist()` non-blockingly and log origin persistence status:

```javascript
/**
 * Storage Resilience Manager
 * Handles browser persistent storage registration and quota telemetry.
 */
class AuroMindStorageResilienceManager {
  constructor(sdk) {
    this.sdk = sdk;
    this.isPersisted = false;
    this.quotaInfo = { quota: 0, usage: 0, percentage: 0 };
  }

  async init() {
    if (typeof navigator !== 'undefined' && navigator.storage) {
      await this.requestPersistence();
      await this.checkStorageQuota();
    }
  }

  async requestPersistence() {
    try {
      if (navigator.storage.persist && navigator.storage.persisted) {
        this.isPersisted = await navigator.storage.persisted();
        if (!this.isPersisted) {
          this.isPersisted = await navigator.storage.persist();
        }
      }
    } catch (err) {
      console.warn('[AuroMind SDK] Storage persistence request non-fatal error:', err);
    }
  }

  async checkStorageQuota() {
    try {
      if (navigator.storage.estimate) {
        const estimate = await navigator.storage.estimate();
        const usage = estimate.usage || 0;
        const quota = estimate.quota || 1;
        const percentage = Math.round((usage / quota) * 100);

        this.quotaInfo = { usage, quota, percentage };

        // Alert user and emit telemetry if storage consumption exceeds 80%
        if (percentage >= 80) {
          this.sdk.telemetry.track('storage_quota_warning', {
            priority: 'CRITICAL',
            usageBytes: usage,
            quotaBytes: quota,
            usagePercentage: percentage
          });
        }
      }
    } catch (err) {
      console.warn('[AuroMind SDK] Storage estimate check error:', err);
    }
  }
}
```

### 2.3 Portal UI Storage Health Indicator
To empower users without technical jargon, the Portal Settings modal will display a storage health indicator:
- **Status "Secured locally":** `navigator.storage.persisted() === true`.
- **Status "Standard local storage":** `persisted === false` (presents a one-click button: *"Enable Permanent Offline Storage"*).
- **Storage Gauge:** Displays human-readable MB used (e.g., `4.2 MB of 2.1 GB used`).

---

## 3. AuroMatch Auto-Healing & Corruption Handling (F-05)

### 3.1 Defect Root Cause Analysis in `storageAdapter.js`
In `games/auromatch/src/controllers/storageAdapter.js`:
```javascript
// DEFECTIVE LEGACY LOGIC:
async autoHealFromIndexedDB() {
  const localData = localStorage.getItem('auro_match_user');
  if (localData) {
    // BUG: If localData is "{}", "null", "[corrupted string]", or "{ completedLevels: [] }",
    // the method immediately returns, refusing to restore from healthy IndexedDB!
    return;
  }
  const idbData = await this.readFromIDB();
  if (idbData) {
    localStorage.setItem('auro_match_user', JSON.stringify(idbData));
  }
}
```

### 3.2 Robust Auto-Healing & Dual-Storage Architecture
The new `storageAdapter.js` design establishes a verified dual-write / verified dual-read pattern:

```
+--------------------------------------------------------------------------------+
|                        AUROMATCH STORAGE ENGINE                                |
+--------------------------------------------------------------------------------+
|                                READ FLOW                                       |
|  1. Read localStorage('auro_match_user') -> parse & validate schema.          |
|  2. Read IndexedDB('auro_match_db') -> validate schema.                        |
|  3. Reconciliation Matrix:                                                     |
|     - Both Valid: Compare completedLevels.length; take max (non-destructive).  |
|     - LS Corrupt / Empty & IDB Valid: Auto-heal LS from IDB (EMIT TELEMETRY).   |
|     - LS Valid & IDB Corrupt / Empty: Auto-heal IDB from LS.                   |
|     - Both Corrupt: Quarantine corrupt data to localStorage('_quarantine_');   |
|                     initialize clean baseline save.                            |
+--------------------------------------------------------------------------------+
|                               WRITE FLOW                                       |
|  1. Serialize payload with canonical JSON.                                     |
|  2. Calculate SHA-256 payload checksum.                                        |
|  3. Atomic Write to IndexedDB first (durable asynchronous storage).           |
|  4. Write to localStorage (synchronous fast-access cache).                     |
|  5. Notify Shared SDK Adapter Bridge.                                          |
+--------------------------------------------------------------------------------+
```

### 3.3 Deep Schema Validation Function

```javascript
function validateAuroMatchSavePayload(data) {
  if (!data || typeof data !== 'object') return { valid: false, reason: 'NOT_AN_OBJECT' };
  
  // Must possess player profile and progress array
  if (!data.profile || typeof data.profile !== 'object') {
    return { valid: false, reason: 'MISSING_PROFILE' };
  }
  if (!Array.isArray(data.completedLevels)) {
    return { valid: false, reason: 'INVALID_COMPLETED_LEVELS' };
  }
  
  // Validate level records
  for (const lvl of data.completedLevels) {
    if (typeof lvl.level !== 'number' || lvl.level < 1) {
      return { valid: false, reason: 'CORRUPTED_LEVEL_RECORD' };
    }
  }

  return { valid: true, levelCount: data.completedLevels.length };
}
```

---

## 4. Production Content Security Policy (CSP) Design (F-09)

### 4.1 Master CSP Directive Specification
To prevent XSS, data exfiltration, clickjacking, and unauthorized third-party scripts, the following unified CSP directive is enforced:

```http
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; media-src 'self' data: blob:; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.auromind.org; frame-src 'self'; child-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'; upgrade-insecure-requests;
```

#### Rationale for Directives:
- `default-src 'self'`: Default lockdown to canonical origin.
- `script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net`: Permits local game engines, inline initialization bridges, and trusted CDNs if required (e.g., Lucide icons or KaTeX).
- `connect-src 'self' https://*.supabase.co wss://*.supabase.co`: Authorizes future B18-C Supabase REST and WebSocket Realtime connections while completely blocking arbitrary exfiltration domains.
- `media-src 'self' data: blob:`: Authorizes audio synthesis in VAK and audio playback in AuroMind Ambient Audio.
- `worker-src 'self' blob:`: Authorizes Service Worker (`sw.js`) and inline web workers used for procedural generation in AuroMandala.
- `object-src 'none'`: Completely blocks Flash, Java applets, and legacy browser plugins.
- `frame-ancestors 'self'`: Completely prevents clickjacking by forbidding external domains from framing the Portal.

### 4.2 Multi-Hosting Deployment Configuration Files

#### 1. Vercel Configuration (`vercel.json`)
```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "Content-Security-Policy",
          "value": "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; media-src 'self' data: blob:; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.auromind.org; frame-src 'self'; child-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self';"
        },
        {
          "key": "X-Frame-Options",
          "value": "SAMEORIGIN"
        },
        {
          "key": "X-Content-Type-Options",
          "value": "nosniff"
        },
        {
          "key": "Referrer-Policy",
          "value": "strict-origin-when-cross-origin"
        },
        {
          "key": "Permissions-Policy",
          "value": "camera=(), microphone=(self), geolocation=(), interest-cohort=()"
        }
      ]
    }
  ]
}
```

#### 2. Cloudflare Pages Configuration (`_headers`)
```http
/*
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; media-src 'self' data: blob:; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.auromind.org; frame-src 'self'; child-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self';
  X-Frame-Options: SAMEORIGIN
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(self), geolocation=(), interest-cohort=()
```

#### 3. Netlify Configuration (`netlify.toml`)
```toml
[[headers]]
  for = "/*"
  [headers.values]
    Content-Security-Policy = "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; media-src 'self' data: blob:; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.auromind.org; frame-src 'self'; child-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self';"
    X-Frame-Options = "SAMEORIGIN"
    X-Content-Type-Options = "nosniff"
    Referrer-Policy = "strict-origin-when-cross-origin"
    Permissions-Policy = "camera=(), microphone=(self), geolocation=(), interest-cohort=()"
```

---

## 5. Local Data Boundaries & Sacred Data Security (Sankalpa Vault)

### 5.1 The Local-Only E2EE Guarantee
The Sankalpa Vault in AuroMandala allows players to embed deeply personal intentions, prayers, or vows into the mandala.
- **Architectural Boundary:**
  - Sankalpa text is **never** synchronized to the cloud (`cloudSyncEligible: false`).
  - Sankalpa text is **never** logged to telemetry.
  - When stored locally, the text is encrypted using the player's derived local key (Web Crypto AES-GCM-256) before touching IndexedDB or localStorage.
- **Quarantine Isolation:** If any cloud sync payload arrives containing a `sankalpa` field, the SDK sync engine will reject the field, strip it, and record a diagnostic security warning.

---

## 6. Implementation Verification Checklist

- [ ] `navigator.storage.persist()` is called non-blockingly on platform launch.
- [ ] `autoHealFromIndexedDB()` in AuroMatch recovers progression when `localStorage` contains empty object `{}` or corrupted JSON.
- [ ] Bidirectional healing in AuroMatch restores IndexedDB when IndexedDB is cleared but `localStorage` is healthy.
- [ ] `server.js`, `vercel.json`, `_headers`, and `netlify.toml` share identical CSP directives.
- [ ] Microphone permission in `Permissions-Policy` is restricted to `(self)` for VAK speech processing, while camera and geolocation are disabled `()`.
