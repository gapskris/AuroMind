# AuroMind — Batch B4 Provider-Independent Platform Services Report

**Document ID:** `B4_PLATFORM_SERVICES_REPORT.md`  
**Date:** 2026-11-20  
**Status:** IMPLEMENTATION COMPLETE & VERIFIED  
**Primary Directory:** `C:\AuroMind_Studio`  
**Git Reference:** `C:\AuroMindPortal` (`dev/studio-integration`, commit `67d0472`)  

---

## 1. Executive Summary

Batch B4 ("Provider-Independent Platform Services") has been implemented in `C:\AuroMind_Studio`. Building upon the core runtime and guest identity foundation established in B0–B2 and the game integrations completed in B3, B4 expands the shared platform SDK with professional operational, diagnostic, analytical, and player-management capabilities.

All capabilities are engineered according to the mandatory modernization principles:
- **Local-First & Offline-First:** Zero runtime dependencies on cloud services. Full functionality without an active network connection.
- **Provider-Independent Abstractions:** Pluggable interfaces for telemetry transports, purchase providers, auth sessions, and remote configuration ready for future Supabase/Stripe integration in B5.
- **Strict Privacy & Redaction:** User consent controls (opt-in/opt-out) for telemetry. Automatic recursive redaction guaranteeing that passwords, auth tokens, private encryption keys, and Sankalpa vault contents never enter diagnostic logs or telemetry streams.
- **Fault-Tolerant Non-Blocking Design:** Platform service calls fail open. SDK initialization delays or service errors never crash portal bootstrap or game playability.
- **Zero Git Mutations:** No commits, pushes, merges, branch switches, or resets were performed in either `C:\AuroMind_Studio` or `C:\AuroMindPortal`.

---

## 2. Architecture Overview & Service Contracts

All shared platform capabilities are exposed uniformly through the `AuroMind` singleton and `createAuroMindSDK()` factory in `assets/sdk/auromind-sdk.js`.

```
+-------------------------------------------------------------------------------+
|                             AuroMind Shared SDK                               |
+-------------------------------------------------------------------------------+
| Core Services:                                                                |
|   - identity: Shared Guest Identity (IndexedDB + localStorage mirror)         |
|   - adapters: Game Save & Storage Adapter Registry                            |
|   - storage: Metadata & Offline Network State                                 |
|                                                                               |
| B4 Platform Services:                                                         |
|   - logging: Structured Multi-Level Logging & Bounded Diagnostic Storage       |
|   - diagnostics: Consolidated Operational Health & Bundle Exporter            |
|   - telemetry / analytics: Event Collection, Privacy Consent & Buffer         |
|   - config: Feature Flags, Default Fallbacks & Local Overrides                |
|   - player / profile: Cross-Game Preferences, Statistics & Data Ownership    |
|   - entitlements: Commercial Gates, Tier Validation & Local Caching           |
+-------------------------------------------------------------------------------+
         |                     |                     |                    |
         v                     v                     v                    v
+-----------------+   +-----------------+   +-----------------+   +-------------+
|   AuroMind      |   |   VAK Speech    |   |   AuroMatch     |   | AuroMandala |
|    Portal       |   |   (games/vak/)  |   | (games/auromatch)   | (Safe Bridge|
+-----------------+   +-----------------+   +-----------------+   +-------------+
```

### 2.1 Protected Platform Storage Namespace
All B4 storage keys are strictly isolated under the reserved `auromind.platform.` prefix, preventing portal cache-clearing operations and game adapters from colliding with or corrupting platform state:

| Constant | Storage Key | Purpose | Durability / Limits |
|---|---|---|---|
| `LS_LOGS_KEY` | `auromind.platform.v1.diagnostics_log` | Diagnostic log entries | Max 50 latest entries in localStorage |
| `LS_TELEMETRY_KEY` | `auromind.platform.v1.telemetry_queue` | Buffered telemetry events | Max 200 events FIFO |
| `LS_CONSENT_KEY` | `auromind.platform.v1.telemetry_consent` | Telemetry privacy consent | Persistent boolean string (`'true'`/`'false'`) |
| `LS_CONFIG_KEY` | `auromind.platform.v1.config_cache` | Local config overrides | JSON dictionary |
| `LS_PROFILE_KEY` | `auromind.platform.v1.player_profile` | Player profile & preferences | JSON object (schemaVersion: 1) |
| `LS_ENTITLEMENTS_KEY` | `auromind.platform.v1.entitlements_cache` | Cached entitlements | JSON array of entitlement records |

---

## 3. Centralized Logging & Diagnostics

### 3.1 Logging Service (`AuroMind.logging`)
- **Severity Levels:** `DEBUG: 0`, `INFO: 1`, `WARN: 2`, `ERROR: 3`, `FATAL: 4`. Default runtime level is `INFO`.
- **Filtering:** Configurable via `setLevel(levelName)`. Entries below the active threshold are rejected before stringification.
- **Ring Buffering:** In-memory queue bounded to 150 items. LocalStorage mirror automatically truncates to the 50 most recent entries.
- **Structured Log Entry Schema:**
  ```javascript
  {
    id: "UUIDv4",
    timestamp: "ISO8601",
    level: "INFO" | "DEBUG" | "WARN" | "ERROR" | "FATAL",
    tag: "portal" | "vak" | "auromatch" | "auromandala" | "sdk",
    message: "Sanitized string",
    data: { /* Recursively redacted metadata */ },
    sessionId: "sess_UUIDv4",
    gameId: "portal" | "vak" | "auromatch" | ...
  }
  ```
- **API Methods:** `log(level, tag, message, data)`, `debug()`, `info()`, `warn()`, `error()`, `fatal()`, `getRecentLogs(limit, minLevel)`, `clear()`, `setLevel()`, `getLevel()`, `exportDiagnostics()`.

### 3.2 Diagnostics Service (`AuroMind.diagnostics`)
Exports a consolidated JSON-serializable snapshot of platform health without exposing sensitive user secrets:
- SDK runtime context and active session identifier
- Shared guest identity verification status
- Storage health (`idbAvailable`, `lsAvailable`, `webLocksSupported`, `broadcastChannelSupported`, corruption records)
- Offline network state snapshot
- Merged active feature flags and configuration
- Cached commercial entitlements
- Player profile and preferences
- Telemetry buffer metrics and consent state
- 50 most recent diagnostic logs
- Memory usage metrics (when supported by browser performance API)

---

## 4. Telemetry and Event Collection

### 4.1 Event Envelope (v1 Schema)
```javascript
{
  eventId: "UUIDv4",
  schemaVersion: 1,
  timestamp: "ISO8601",
  eventName: "game_launch" | "game_session_start" | "portal_visit" | ...,
  category: "lifecycle" | "engagement" | "progression" | "error" | "commerce" | "ui" | "system",
  gameId: string,
  sessionId: "sess_UUIDv4",
  guestId: "UUIDv4" | null,
  payload: { /* Redacted event payload */ },
  appVersion: string
}
```

### 4.2 Privacy & Consent Controls
- **Opt-In Privacy Model:** Telemetry collection is inactive (`consent === false`) by default until explicit permission is given.
- **Strict Event Dropping:** When consent is false, calls to `track()` immediately drop events without persisting them to disk.
- **Opt-Out Purge:** Calling `optOut()` or setting consent to `false` immediately clears both the in-memory telemetry queue and the `LS_TELEMETRY_KEY` store.
- **Portal UI Toggle:** Integrated into the portal Settings modal (`#settings-telemetry-toggle`), bound live to `sdk.telemetry.getConsent()` and `sdk.telemetry.setConsent()`.

### 4.3 Pluggable Transport & Local Buffer
- **Bounded Buffer:** Bounded to 200 events FIFO.
- **Local-First Flush:** In B4 offline mode, `flush()` returns `{ ok: true, bufferedCount: N }` with zero network calls.
- **Provider Injection:** When a telemetry transport provider is registered (e.g. `{ sendEvents: async (batch) => ({ ok: true, sentCount: batch.length }) }`), `flush()` delivers the batch and dequeues acknowledged events.

---

## 5. Feature Flags & Configuration Management

### 5.1 Service Design (`AuroMind.config`)
- **Default Baseline:** Embedded platform and game defaults (`DEFAULT_PLATFORM_CONFIG`):
  - `portal.seniorModeDefault: false`
  - `portal.reducedMotionDefault: false`
  - `portal.theaterAutoplay: true`
  - `portal.analyticsOptInPrompt: true`
  - `games.vak.audioPresets: 'standard'`
  - `games.vak.micSensitivity: 1.0`
  - `games.auromatch.tileAnimations: true`
  - `games.auromandala.soundEffects: true`
  - `platform.commercialGatesActive: false`
  - `platform.debugDiagnostics: false`
- **Hierarchical Lookup:** Local overrides (`LS_CONFIG_KEY`) take precedence, followed by remote config cache, followed by built-in defaults, followed by caller fallback.
- **Typed Getters:** `getBoolean(key, fallback)`, `getNumber(key, fallback)`, `getString(key, fallback)`, `isFeatureEnabled(featureName)`.
- **Overrides:** `setOverride(key, value)` and `clearOverride(key)` persist instantly to localStorage cache.

---

## 6. Player Profile & Account Abstraction

### 6.1 Unified Cross-Game Profile (`AuroMind.player`, `AuroMind.profile`)
```javascript
{
  guestId: "UUIDv4",
  displayName: "Guest Seeker",
  preferences: {
    seniorMode: false,
    reducedMotion: false,
    ambientVolume: 0.5,
    sfxVolume: 0.8,
    theme: "system"
  },
  stats: {
    totalPlaytimeMinutes: 0,
    sessionsCount: 1,
    firstSeen: "ISO8601",
    lastSeen: "ISO8601"
  },
  schemaVersion: 1
}
```

### 6.2 Portal Preferences Synchronization
- Senior Mode, Reduced Motion, and Ambient Volume slider adjustments in the portal UI automatically update the shared player profile via `sdk.player.updatePreferences()`.
- Session counters and timestamps automatically update on SDK initialization.

### 6.3 Account Abstraction & User Data Rights
- `exportUserData()`: Generates a complete JSON bundle of user-owned profile, stats, identity, entitlements, and diagnostic logs.
- `deleteUserData()`: Executes a clean local purge of all user platform preferences, telemetry queues, diagnostics logs, and cached entitlements.

---

## 7. Entitlements & Monetization Abstraction

### 7.1 Service Design (`AuroMind.entitlements`)
- **Commercial Gate:** Configured via `platform.commercialGatesActive` (defaults to `false` in B4). While inactive, all games and levels return `hasAccess() === true`.
- **Trust Boundary Enforcement:** Client-side local entitlements granted in B4 are stored with `verified: false` and `source: 'local'`. Real cryptographic verification is reserved for B5 cloud integration.
- **Methods:** `isCommercialGateActive()`, `hasEntitlement(gameId, skuOrTier)`, `hasAccess(gameId, levelOrTier)`, `canAccessLevel(gameId, levelNumber, freeTierMax)`, `grantLocalEntitlement(gameId, tier)`, `revokeLocalEntitlement(gameId)`, `purchase(item)`, `restorePurchases()`.
- **Purchase Provider Slot:** Unconfigured purchase attempts fail gracefully with `{ ok: false, errorCode: 'PURCHASE_PROVIDER_NOT_CONFIGURED' }` without throwing.

---

## 8. Owner Analytics Dashboard Foundation

### 8.1 Architecture & Directory Structure
```
owner-analytics/
├── index.html                          # Executive dashboard UI with 6 tab views
├── styles.css                          # Sanctuary dark glassmorphic stylesheet
├── app.js                              # Interactive dashboard controller
└── models/
    └── analyticsDataContract.js        # Event schemas, metric calculation rules & benchmarks
```

### 8.2 Interactive Dashboard Views
1. **Executive Overview:** 6 high-level KPI cards (Total Seekers, DAU, MAU, Avg Session Length, D1/D7 Retention, Technical Health Rate) merged with live data.
2. **Game Performance:** Interactive distribution bars showing play shares across VAK (38%), AuroMatch (29%), AuroMandala (21%), AuroBlocks (5%), Word Riddle (4%), and VAK Living Sanctuary (3%).
3. **Discovery & Portal Navigation:** Live metrics for in-portal theater launches vs direct catalog browsing, telemetry buffer queue length, and consent adoption.
4. **Retention & Progression:** D1 (46%), D7 (28%), and D30 (17%) retention cohort visualizers.
5. **Monetization & Commercial Gates:** Commercial gate status display, provider readiness indicator, and local cached entitlements table.
6. **Technical Health & Live Logs:** Real-time storage health cards (IDB, LS, WebLocks, BroadcastChannel) and interactive filterable diagnostic log table with JSON export.

### 8.3 Security & Isolation
- **Service Worker Exclusion:** `sw.js` explicitly excludes `owner-analytics/` from root caching.
- **GitHub Pages Workflow Protection:** `.github/workflows/pages.yml` strictly excludes `owner-analytics/` from the public site build and tests for its absence in CI allowlist verification.

---

## 9. Privacy, Redaction & Security Enforcement

### 9.1 Zero PII and Sanitization Engine
The SDK implements `redactSensitive()` for all logs and telemetry payloads:
- **Key Matching:** Case-insensitive regular expression matching `password`, `token`, `secret`, `auth`, `bearer`, `credential`, `sankalpa`, `key`, `private`, `cipher`, `salt`, `iv`, `seed`. Matching key values are replaced with `"[REDACTED]"`.
- **Value Matching:** Regular expression scans for JWT tokens (`eyJ...`) and email addresses.
- **Recursive Traversal:** Recursively processes nested objects and arrays up to depth 6.

### 9.2 Sankalpa Vault Isolation
In accordance with mandatory architectural constraints, Sankalpa vault contents and E2EE encryption passwords in AuroMandala and VAK are strictly forbidden from entering logs, telemetry queues, or platform metadata.

### 9.3 Zero Cloud Calls in B4
The SDK performs zero external network calls during initialization, logging, telemetry buffering, config retrieval, or entitlement checks. All network calls are stubbed to null providers or local buffers.

---

## 10. Test Verification & Compliance Matrix

The automated test suite `b4-platform-services.test.js` exercises all platform capabilities using Node.js native test runner:

| Test Suite | Capability Tested | Status |
|---|---|---|
| **Suite 1.1** | Logging levels, minLevel filtering, buffer limits & LS persistence | **PASS** |
| **Suite 1.2** | Sensitive data sanitization, password/token/Sankalpa redaction | **PASS** |
| **Suite 1.3** | Diagnostics bundle export & structure validation | **PASS** |
| **Suite 2.1** | Telemetry consent enforcement, opt-in/opt-out queue purging | **PASS** |
| **Suite 2.2** | Telemetry offline local buffering & pluggable transport flushing | **PASS** |
| **Suite 3.1** | Config typed getters, default fallbacks & local overrides | **PASS** |
| **Suite 4.1** | Player profile, preferences sync, user data export & delete rights | **PASS** |
| **Suite 5.1** | Commercial gates, local entitlement grants & unconfigured purchase safe error | **PASS** |
| **Suite 6.1** | Analytics data contract validation & metric calculation algorithms | **PASS** |
| **Suite 7.1** | Zero network requests / local-first enforcement in B4 | **PASS** |

### 10.1 Compliance Matrix

| Requirement | Specification | Verification Result |
|---|---|---|
| Centralized Logging | `AuroMind.logging`, `AuroMind.diagnostics` | Compliant |
| Telemetry & Analytics | `AuroMind.telemetry`, `AuroMind.analytics` | Compliant |
| Configuration Management | `AuroMind.config` | Compliant |
| Player Profile Abstraction | `AuroMind.player`, `AuroMind.profile` | Compliant |
| Entitlements Abstraction | `AuroMind.entitlements` | Compliant |
| Owner Analytics Foundation | `owner-analytics/` (models, index, css, app) | Compliant |
| VAK Game Integration | `games/vak/index.html` telemetry & logging | Compliant |
| AuroMatch Game Integration | `games/auromatch/src/main.js` telemetry & logging | Compliant |
| AuroMandala Integration | `auromandala-sdk-bridge.js` telemetry & logging | Compliant |
| Portal Telemetry & Preferences | `portal.js` launch tracking & settings toggle | Compliant |
| Zero Cloud Calls in B4 | No Supabase, Firebase, or external network requests | Compliant |
| Zero Sankalpa Leakage | Passwords, tokens, and vault contents strictly redacted | Compliant |
| Zero Git Mutations | Pristine Git reference, zero commits or pushes | Compliant |
