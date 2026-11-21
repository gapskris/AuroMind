# AuroMasti B18-B1 — Telemetry Privacy & Multi-Host CSP Final Specification
## 3-Tier Queue Saturation, Privacy Boundaries, and Multi-Hosting Security Architecture (ADR-07, ADR-09, ADR-10)

- **Document Version:** 1.0.0
- **Batch Reference:** B18-B1 Final ADR Clarification & Approval Preparation
- **Canonical Workspace:** `C:\AuroMindPortal`
- **Target Release:** January 1, 2027
- **Governance Status:** PENDING OWNER APPROVAL

---

## 1. ADR-09: 3-Tier Telemetry Queue Architecture

### 1.1 Per-Tier Capacity & Priority Partitioning
To resolve the memory overflow and arbitrary event dropping identified in finding F-08, the telemetry queue is partitioned into three strict priority tiers with an aggregate capacity of **500 events**:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      3-TIER TELEMETRY BUFFER ARCHITECTURE                       │
├────────────────────┬──────────┬──────────────┬──────────────────────────────────┤
│ TIER NAME          │ CAPACITY │ PERSISTENCE  │ EVICTION POLICY & CONTENT        │
├────────────────────┼──────────┼──────────────┼──────────────────────────────────┤
│ TIER 1: CRITICAL   │ 100 max  │ Durable IDB  │ NEVER silently evicted.          │
│                    │          │ & Memory     │ Save corruption, cryptographic   │
│                    │          │              │ hash failures, storage quota 80% │
├────────────────────┼──────────┼──────────────┼──────────────────────────────────┤
│ TIER 2: ENGAGEMENT │ 300 max  │ Memory Only  │ FIFO eviction when buffer full.  │
│                    │          │              │ Level completed, game session    │
│                    │          │              │ start/end, achievement unlocked  │
├────────────────────┼──────────┼──────────────┼──────────────────────────────────┤
│ TIER 3: DIAGNOSTIC │ 100 max  │ Memory Only  │ Aggressively evicted first.      │
│                    │          │              │ Frame latency, asset load time,  │
│                    │          │              │ audio context state changes      │
└────────────────────┴──────────┴──────────────┴──────────────────────────────────┘
```

### 1.2 Queue Persistence & Reload Durability
- **Tier 1 (CRITICAL):** Every critical event writes synchronously to an IndexedDB object store (`AuroMindPlatformDB`, store `platform_critical_telemetry`). If the player closes or reloads the tab while offline, all un-dispatched critical events are restored on the next startup.
- **Tiers 2 & 3:** Buffered in RAM for fast, low-overhead operation and flushed periodically.

### 1.3 Buffer Eviction & Saturation Failure Policy
When a new event arrives and total queue size $\ge 500$:
1. If any **Tier 3 (DIAGNOSTIC)** events exist: Evict the oldest Tier 3 event.
2. If no Tier 3 events exist, but **Tier 2 (ENGAGEMENT)** events exist: Evict the oldest Tier 2 event.
3. **CRITICAL Queue Saturation Policy (Observable Failure Protocol):**
   - If the queue consists of 100 CRITICAL events and all 400 slots of Tiers 2 & 3 are exhausted:
   - **CRITICAL events are NEVER silently dropped.**
   - The queue logs an observable console alert: `[AuroMind Telemetry] CRITICAL_QUEUE_SATURATED`.
   - An un-evictable atomic integer `droppedCriticalCounter` in `localStorage.setItem('auromind.telemetry.critical_overflow', count)` increments.
   - The oldest CRITICAL event is rotated out to preserve memory bounds, but the next successful telemetry batch automatically prepends a synthesized `TELEMETRY_OVERFLOW_INCIDENT` event reporting the exact count of rotated events.

### 1.4 Consent Withdrawal & Queue Purge
- Telemetry collection requires explicit visitor consent (`auromind.platform.v1.consent = true`).
- If a player opts out in Portal Settings (`sdk.telemetry.revokeConsent()`):
  1. The in-memory event queue is immediately emptied (`queue = []`).
  2. The IndexedDB `platform_critical_telemetry` store is purged.
  3. All pending network fetch requests are aborted via `AbortController`.
  4. Telemetry collection terminates permanently until affirmative re-opt-in.

### 1.5 Strict Privacy Filter & Sacred Data Exclusion Gate
Before any event enters the queue, a mandatory pre-queue sanitization pipeline executes:

```javascript
const RESTRICTED_KEYS = [
  'sankalpa', 'intention', 'vault', 'passphrase', 'secret',
  'token', 'key', 'password', 'journal', 'reflection', 'note',
  'audio_blob', 'audio_buffer', 'speech_recording', 'corpus_text',
  'canvas_strokes', 'strokes', 'svg_data'
];

export function sanitizeTelemetryPayload(data) {
  if (!data || typeof data !== 'object') return {};
  const sanitized = {};
  for (const [k, v] of Object.entries(data)) {
    const lowerKey = k.toLowerCase();
    if (RESTRICTED_KEYS.some(bad => lowerKey.includes(bad))) {
      continue; // Purge completely
    }
    if (typeof v === 'object' && v !== null) {
      if (Array.isArray(v)) {
        sanitized[k] = v.length; // Record count, never raw contents
      } else {
        sanitized[k] = sanitizeTelemetryPayload(v);
      }
    } else {
      sanitized[k] = v;
    }
  }
  return sanitized;
}
```

#### Absolute Boundary: Sankalpa Vault Local-Only E2EE
- The Sankalpa Vault is declared `cloudSyncEligible: false` and `localOnlyVaults: ['sankalpa_e2ee_vault']`.
- Contents are encrypted with local AES-GCM-256 before storage and **never** exposed to telemetry or cloud synchronization.

---

## 2. ADR-07 & ADR-10: Multi-Host CSP & Header Reality

### 2.1 Provider-by-Provider Header Support Reality Check
Different hosting environments have distinct capabilities regarding custom HTTP response headers. It is an architectural error to assume that a single static configuration file behaves identically across all hosts.

| Hosting Environment | Custom Header Mechanism | `frame-ancestors` Supported? | Limitations & Reality Check |
| :--- | :--- | :---: | :--- |
| **Local Node / Express** (`server.js`) | Express middleware `res.setHeader()` | **YES** | Full programmatic control over all HTTP response headers. |
| **Vercel** | `vercel.json` (`headers` array) | **YES** | Native header injection for all routes. |
| **Cloudflare Pages** | `_headers` plain text file in publish dir | **YES** | Native HTTP header injection across Cloudflare edge. |
| **Netlify** | `netlify.toml` / `_headers` file | **YES** | Native HTTP header injection across Netlify CDN. |
| **GitHub Pages** | None (Static files only) | **NO** | **GitHub Pages does NOT support custom HTTP response headers.** Adding `_headers` or `vercel.json` has ZERO effect on GitHub Pages. Only `<meta http-equiv="Content-Security-Policy">` is supported in HTML, but `<meta>` tags **CANNOT enforce `frame-ancestors`, `report-uri`, or `sandbox`**. |

### 2.2 Unified Production CSP Specification
For hosts supporting HTTP headers (Vercel, Cloudflare Pages, Netlify, and `server.js`):

```http
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; media-src 'self' data: blob:; connect-src 'self' https://*.supabase.co wss://*.supabase.co; frame-src 'self'; child-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self';
X-Frame-Options: SAMEORIGIN
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(self), geolocation=(), interest-cohort=()
```

### 2.3 Portal & Standalone Game Isolation Architecture
1. **Theater Iframe Integration:** `frame-ancestors 'self'` allows the parent AuroMind Portal to frame all six games (`games/auromatch/`, `games/auroblocks/`, etc.) because they reside on the **same canonical origin**. External third-party websites are completely blocked from framing any page.
2. **Standalone Game Execution:** Games loaded directly via URL (e.g., `https://domain.com/games/vak/index.html`) load without framing restrictions because `default-src 'self'` permits top-level browsing.
3. **Microphone Permission Policy:** Restricting `microphone=(self)` authorizes speech recognition in VAK Speech Control on the canonical origin while permanently blocking third-party microphone access.
