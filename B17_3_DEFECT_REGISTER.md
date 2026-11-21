# AuroMind B17.3 Real-Browser Defect Register

**Date:** November 20, 2026  
**Canonical Workspace:** `C:\AuroMindPortal`  
**Active Git Branch:** `dev/studio-integration`  
**Baseline HEAD Commit:** `b6ccc860bb7d38a70ef678049a9588b8b73c40aa`  
**Target Release:** January 1, 2027  
**Scope:** Real-Browser Defect Findings from B17.3 E2E Automation

---

## 1. Defect Classification Summary

In strict compliance with B17.3 guidelines, real-browser defects discovered during E2E test execution were **not masked or suppressed by modifying application code**. Instead, they are formally logged in this register with exact reproduction steps, root cause analyses, operational impacts, and verified proposed remediations for subsequent authorized fix batches.

| Defect ID | Severity | Component | Summary | Proposed Fix Scope | B17.4 Status |
|---|---|---|---|---|---|
| **B17-DEFECT-01** | High | Portal Shell (`portal.js`) | Dynamic import path resolves to 404 (`/assets/js/assets/sdk/...`) | 1 line in `assets/js/portal.js` | **RESOLVED & VERIFIED** |
| **B17-DEFECT-02** | Medium | Accessibility (`portal.js`) | Senior Mode runtime toggle queries mismatched iframe ID (`game-theater-iframe`) | 1 line in `assets/js/portal.js` | **RESOLVED & VERIFIED** |
| **B17-DEFECT-03** | High | Game Bridges (`auromatch`, `auromandala`) | `postMessage` throws DOMException when `window.location.origin` is `'null'` | 2 files in game adapters | **RESOLVED & VERIFIED** |
| **B17-DEFECT-04** | Low | Game Security (`auroblocks`) | Inline `<script>` blocks in AuroBlocks HTML trigger CSP violations | 1 file in `games/auroblocks/index.html` | **RESOLVED & VERIFIED** |

---

## 2. Detailed Defect Reports

### B17-DEFECT-01: Dynamic Import Path Resolves to HTTP 404 in Portal Shell
- **Severity:** High
- **Component:** `assets/js/portal.js` (Line 103)
- **Observed Behavior:**
  When loading the portal in a real Chromium browser, the browser console logs:
  ```
  GET http://localhost:3000/assets/js/assets/sdk/config/backend-config.js net::ERR_ABORTED 404 (Not Found)
  ```
- **Root Cause Analysis:**
  Line 103 in `assets/js/portal.js` executes:
  ```javascript
  const { getBackendConfig } = await import('./assets/sdk/config/backend-config.js');
  ```
  In standard ECMAScript modules, relative paths inside a module are resolved relative to the module's own URL (`/assets/js/portal.js`). Prepending `./assets/` results in the URL path `/assets/js/assets/sdk/config/backend-config.js`. The file actually resides at `/assets/sdk/config/backend-config.js`.
- **Impact:**
  The `try...catch` block in `portal.js` catches the error and falls back gracefully, preventing an unhandled crash. However, the runtime dynamic backend config lookup fails unnecessarily on every portal launch.
- **Reproduction Steps:**
  1. Start portal static server (`node server.js`).
  2. Open DevTools Console on `http://localhost:3000/index.html`.
  3. Observe HTTP 404 network failure for `backend-config.js`.
- **Proposed Remediation:**
  Update line 103 in `assets/js/portal.js`:
  ```javascript
  // Change from:
  const { getBackendConfig } = await import('./assets/sdk/config/backend-config.js');
  // Change to:
  const { getBackendConfig } = await import('../sdk/config/backend-config.js');
  ```

---

### B17-DEFECT-02: Senior Mode Runtime Iframe Selector Mismatch
- **Severity:** Medium
- **Component:** `assets/js/portal.js` (Line 824)
- **Observed Behavior:**
  If a user launches a game in the theater and subsequently clicks the Senior Mode toggle button in the portal navigation bar while the theater is open, the child game does not receive the `AUROMIND_SENIOR_MODE` message.
- **Root Cause Analysis:**
  In `assets/js/portal.js` line 824:
  ```javascript
  const gameIframe = document.getElementById('game-theater-iframe');
  if (gameIframe && gameIframe.contentWindow) {
    gameIframe.contentWindow.postMessage({ type: 'AUROMIND_SENIOR_MODE', enabled: isSenior }, '*');
  }
  ```
  However, in `index.html` line 1505 and in `portal.js` line 310, the iframe element is defined as:
  ```html
  <iframe id="game-viewport-iframe" ...></iframe>
  ```
  Because the ID is `game-viewport-iframe`, `document.getElementById('game-theater-iframe')` always returns `null`.
  *(Note: Initial synchronization on theater launch succeeds because `portal.js:347` listens to the iframe `onload` event and queries the correct element).*
- **Impact:**
  Mid-session accessibility toggles do not propagate to the currently active game iframe without reloading the theater.
- **Reproduction Steps:**
  1. Open portal and launch any game in theater mode.
  2. With theater open, toggle `#senior-mode-toggle`.
  3. Inspect child iframe DOM: `.senior-mode` class is missing.
- **Proposed Remediation:**
  Update line 824 in `assets/js/portal.js`:
  ```javascript
  // Change from:
  const gameIframe = document.getElementById('game-theater-iframe');
  // Change to:
  const gameIframe = document.getElementById('game-viewport-iframe');
  ```

---

### B17-DEFECT-03: `DOMException: Invalid target origin 'null'` in Sandboxed Iframes
- **Severity:** High
- **Component:** `games/auromatch/src/main.js` (Line 1089) and `games/auromandala/assets/auromandala-sdk-bridge.js` (Line 142)
- **Observed Behavior:**
  When executing inside sandboxed iframes without `allow-same-origin`, or when the origin resolves to the string `'null'`, triggering "Return to Portal" throws:
  ```
  DOMException: SyntaxError: Failed to execute 'postMessage' on 'Window': Invalid target origin 'null'
  ```
- **Root Cause Analysis:**
  Both scripts execute:
  ```javascript
  window.parent.postMessage({ type: 'AUROMIND_CLOSE_THEATER' }, window.location.origin);
  ```
  Under browser specifications, if an iframe has an opaque or sandboxed origin, `window.location.origin` returns the string `"null"`. The browser's `postMessage` API rejects `"null"` as a valid targetOrigin argument with a `SyntaxError` DOMException.
- **Impact:**
  In sandboxed or restricted iframe configurations, clicking the return button fails to close the theater.
- **Reproduction Steps:**
  1. Embed `games/auromatch/index.html` inside a sandboxed iframe (`sandbox="allow-scripts"`).
  2. Click the Return to Portal button.
  3. Observe DOMException in console.
- **Proposed Remediation:**
  Adopt the resilient pattern already used in `auroblocks-sdk-bridge.js` line 115:
  ```javascript
  const targetOrigin = (window.location.origin && window.location.origin !== 'null') ? window.location.origin : '*';
  window.parent.postMessage({ type: 'AUROMIND_CLOSE_THEATER' }, targetOrigin);
  ```

---

### B17-DEFECT-04: CSP Inline Script Violations in AuroBlocks
- **Severity:** Low
- **Component:** `games/auroblocks/index.html` (Lines 28–35)
- **Observed Behavior:**
  When opening AuroBlocks under server environments enforcing strict Content Security Policy (`script-src 'self'`), the browser console displays CSP violation notices:
  ```
  Refused to execute inline script because it violates the following Content Security Policy directive: "script-src 'self'"
  ```
- **Root Cause Analysis:**
  `games/auroblocks/index.html` contains raw inline `<script>` tags initializing canvas setup and variables directly in the HTML body rather than loading them from an external `.js` source file.
- **Impact:**
  While the game runs in standard development environments, strict CSP headers deployed in production will block the inline script execution.
- **Reproduction Steps:**
  1. Serve the application with strict CSP headers (`Content-Security-Policy: script-src 'self'`).
  2. Navigate to `http://localhost:3000/games/auroblocks/index.html`.
  3. Check console for CSP evaluation errors.
- **Proposed Remediation:**
  Extract the inline script contents into `games/auroblocks/src/auroblocks-init.js` and include via `<script src="src/auroblocks-init.js"></script>`.

---

## 3. Remediation Recommendations

All four defects are self-contained and require minimal, surgical edits (< 10 lines of code across 4 files). It is recommended that these remediations be scheduled for authorization in the next targeted remediation batch (B17.4), after which the existing 25 E2E tests and 206 platform tests will verify complete resolution.
