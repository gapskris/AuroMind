# AuroMasti B18-B1 — Final Hosting Security Strategy
## Realistic Multi-Host CSP Analysis, GitHub Pages Edge Limitations, and Deployment Architecture (ADR-07, ADR-10)

- **Document Version:** 1.0.0
- **Batch Reference:** B18-B1 Implementation Plan Reconciliation & Final Acceptance
- **Canonical Workspace:** `C:\AuroMindPortal`
- **Active Git Branch:** `dev/studio-integration`
- **Target Release:** January 1, 2027
- **Governance Mandate:** All 10 original ADRs remain **PENDING OWNER APPROVAL**.

---

## 1. Architectural Reality: Static Hosting Capabilities & Limitations

An architectural failure mode in web security planning is assuming that static configuration files (such as `_headers` or `vercel.json`) automatically inject HTTP response headers across all hosting providers.

In AuroMasti's current deployment, the portal is deployed via **GitHub Pages**. The technical realities of each hosting environment are contrasted below:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      MULTI-HOST SECURITY HEADER REALITY MATRIX                  │
├────────────────────┬───────────────────────┬─────────────────┬──────────────────┤
│ HOSTING PROVIDER   │ HEADER MECHANISM      │ FRAME-ANCESTORS │ REALITY & STATUS │
├────────────────────┼───────────────────────┼─────────────────┼──────────────────┤
│ Local Node Express │ Express middleware in │ Supported       │ Active in local  │
│ (`server.js`)      │ `server.js`           │ (Native HTTP)   │ testing baseline │
├────────────────────┼───────────────────────┼─────────────────┼──────────────────┤
│ GitHub Pages       │ Static file server    │ NOT SUPPORTED   │ HTML <meta> tags │
│ (Current Host)     │ (No custom headers)   │ by static files │ cannot enforce   │
│                    │                       │                 │ frame-ancestors  │
├────────────────────┼───────────────────────┼─────────────────┼──────────────────┤
│ Cloudflare Pages   │ Plain text `_headers` │ Supported       │ Native edge      │
│                    │ in publish directory  │ (Native HTTP)   │ header injection │
├────────────────────┼───────────────────────┼─────────────────┼──────────────────┤
│ Vercel             │ `headers` array in    │ Supported       │ Native serverless│
│                    │ `vercel.json`         │ (Native HTTP)   │ edge routing     │
├────────────────────┼───────────────────────┼─────────────────┼──────────────────┤
│ Netlify            │ `[[headers]]` in      │ Supported       │ Native CDN edge  │
│                    │ `netlify.toml`        │ (Native HTTP)   │ header injection │
└────────────────────┴───────────────────────┴─────────────────┴──────────────────┘
```

---

## 2. GitHub Pages Specific Constraints & Mitigations

### 2.1 The GitHub Pages Technical Limitation
- GitHub Pages is a purely static file server. It **does not execute server-side code** and **ignores** server configuration files (`vercel.json`, `_headers`, `netlify.toml`, `.htaccess`, or `nginx.conf`).
- While HTML `<meta http-equiv="Content-Security-Policy" content="...">` tags can be placed in `index.html`, the W3C Content Security Policy specification explicitly forbids `<meta>` tags from enforcing:
  1. `frame-ancestors` (Clickjacking defense).
  2. `report-uri` / `report-to` (Security reporting).
  3. `sandbox` directives.
- Therefore, **GitHub Pages alone CANNOT prevent external third-party sites from framing AuroMasti inside an iframe**.

### 2.2 Realistic Deployment Strategies for Production

To achieve genuine clickjacking protection (`frame-ancestors 'self'`) in production, the Product Owner has three viable architectural deployment paths:

#### Option 1: Cloudflare Reverse-Proxy Fronting GitHub Pages (Zero Migration)
- The GitHub Pages repository remains the origin server.
- The custom domain (e.g. `play.auromind.org`) is routed through **Cloudflare DNS with Proxy enabled (Orange Cloud)**.
- A Cloudflare Transform Rule or Cloudflare Worker injects the production CSP response headers on all outgoing responses.
- **Advantage:** Preserves existing GitHub Pages automated deployment workflow; achieves 100% HTTP header security.

#### Option 2: Direct Deployment to Cloudflare Pages (Recommended for January 1, 2027)
- The repository connects directly to Cloudflare Pages.
- Cloudflare Pages natively reads the `_headers` file authored in `TASK-CSP-01`.
- **Advantage:** Native header support, global CDN caching, zero proxy hops, completely free tier.

#### Option 3: Direct Deployment to Vercel or Netlify
- The repository connects to Vercel or Netlify.
- Natively injects headers via `vercel.json` or `netlify.toml`.
- **Advantage:** Automatic preview deployments on pull requests.

#### Interim In-Code Defense on GitHub Pages (Frame-Busting Script)
Until an edge proxy or modern host is activated, `assets/js/portal.js` incorporates a lightweight client-side frame-busting guard as defense-in-depth:
```javascript
// Defense-in-depth frame guard for static hosts lacking HTTP frame-ancestors:
if (window.top !== window.self) {
  // If framed by external domain, break out
  try {
    if (window.top.location.hostname !== window.location.hostname) {
      window.top.location = window.self.location;
    }
  } catch (e) {
    // Cross-origin framing detected: blank out content to prevent clickjacking
    document.documentElement.style.display = 'none';
  }
}
```

---

## 3. Production Content Security Policy Directives

For hosts supporting native HTTP headers (Local Express, Cloudflare, Vercel, Netlify):

```http
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; media-src 'self' data: blob:; connect-src 'self' https://*.supabase.co wss://*.supabase.co; frame-src 'self'; child-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self';
X-Frame-Options: SAMEORIGIN
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(self), geolocation=(), interest-cohort=()
```

### 3.1 Directive Rationale:
- `frame-ancestors 'self'`: Guarantees that only the canonical AuroMind Portal origin can frame its minigames (`/games/*`). External embedding is completely blocked.
- `Permissions-Policy: microphone=(self)`: Explicitly authorizes VAK Speech Control to access the microphone on the canonical origin while blocking camera and geolocation.
- `connect-src 'self' https://*.supabase.co wss://*.supabase.co`: Pre-authorizes future Supabase REST and WebSocket endpoints for Phase B18-C without relaxing origin safety.
- `worker-src 'self' blob:`: Authorizes the Root Service Worker (`sw.js`) and inline web workers.

---

## 4. Dual-Execution Compatibility: Portal Theater vs. Standalone Games

The security architecture guarantees that both modes of game execution remain 100% operational:
1. **Portal Theater Mode (`index.html` framing `games/*/index.html`):** Permitted because parent portal and child games share the same origin (`'self'`).
2. **Direct Standalone Mode (`games/auromatch/index.html` opened directly):** Permitted because `default-src 'self'` governs top-level browsing without frame constraints. `createLocalMockBridge` activates to supply mock platform services.

---

## 5. Security Regression Test Plan

In `test/storage-resilience-csp.test.js`:
- **TC-CSP-01 (Header Parity):** Validates that `server.js`, `vercel.json`, `_headers`, and `netlify.toml` specify identical CSP strings.
- **TC-CSP-02 (Frame Ancestor Assertion):** Confirms that `frame-ancestors` is strictly `'self'`.
- **TC-CSP-03 (Plugin Lockdown):** Confirms `object-src` is `'none'`.
- **TC-CSP-04 (Microphone Boundary):** Confirms `microphone` is restricted to `(self)`.
