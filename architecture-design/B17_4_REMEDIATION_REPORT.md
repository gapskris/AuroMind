# AuroMind B17.4 Browser Defect Remediation Report

**Date:** November 21, 2026  
**Canonical Workspace:** `C:\AuroMindPortal`  
**Active Git Branch:** `dev/studio-integration`  
**Baseline HEAD Commit:** `b6ccc860bb7d38a70ef678049a9588b8b73c40aa`  
**Target Release:** January 1, 2027  
**Remediation Status:** Complete (4 / 4 Defects Remediated & Verified)  
**Platform Test Status:** 251 / 251 Passing (100% across 17 test suites)

---

## 1. Executive Summary

Batch B17.4 executed the surgical remediation of the four real-browser defects discovered during the B17.3 real-browser E2E testing phase. In strict compliance with project invariants and execution boundaries:
- Zero application redesign or speculative refactoring was introduced.
- No production secrets or cloud backend connections were activated.
- All Sacred Invariants (VAK Speech Corpus SHA-256 baseline, Flora Botanical Database byte size, Sankalpa Vault local-only E2EE boundary) were verified 100% intact.
- The historical Studio snapshot (`C:\AuroMind_Studio`) remained untouched.
- All pre-existing test suites from B16 through B17.3 remained passing with zero regressions.

The platform automated test suite grew from **231 tests** to **251 tests** (17 new unit/integration tests in `b17-4-remediation.test.js` and 3 new real-browser E2E tests in `b17-3-e2e.test.js`), achieving a **100% pass rate with zero failures**.

---

## 2. Defect Remediation Summary Matrix

| Defect ID | Severity | Component | Issue Description | Remediation Scope | Verification Status |
|---|---|---|---|---|---|
| **B17-DEFECT-01** | High | `assets/js/portal.js` | Dynamic import used incorrect relative path (`./assets/sdk/...`) resulting in HTTP 404 | Corrected import specifiers to `../sdk/...` | **PASSED** (Unit & Real-Browser) |
| **B17-DEFECT-02** | Medium | `assets/js/portal.js` | Runtime Senior Mode toggle queried non-existent `#game-theater-iframe` | Updated selector to `#game-viewport-iframe` with fallback | **PASSED** (Unit & Real-Browser) |
| **B17-DEFECT-03** | High | `games/auromatch`<br>`games/auromandala` | `postMessage` passed `window.location.origin` which throws DOMException in opaque `'null'` origins | Implemented safe targetOrigin check and strict source/payload validation | **PASSED** (Unit & Real-Browser) |
| **B17-DEFECT-04** | Low | `games/auroblocks` | Inline scripts in HTML violated strict CSP `script-src 'self'` | Extracted inline routines into external `assets/auroblocks-init.js` | **PASSED** (Unit & Real-Browser) |

---

## 3. Detailed Defect Analysis & Implementation

### 3.1 B17-DEFECT-01: Backend Configuration Dynamic Import Path Resolution

#### Problem & Root Cause
In `assets/js/portal.js` lines 88, 103, and 114, dynamic `import()` calls referenced relative paths prefixed with `./assets/sdk/...`:
```javascript
const { createConfiguredProviders } = await import('./assets/sdk/config/backend-config.js');
```
Because `portal.js` is served from `/assets/js/portal.js`, ECMAScript module resolution resolves relative paths against the module's URL. Prepending `./assets/` resulted in the browser requesting `/assets/js/assets/sdk/config/backend-config.js`, which returned an HTTP 404 in the browser console. While the enclosing `try...catch` prevented portal crashes, dynamic backend configuration lookup failed on every launch.

#### Implementation & Exact Diff
In `assets/js/portal.js`:
- Updated line 88: `import('../sdk/auromind-sdk.js')`
- Updated line 103: `import('../sdk/config/backend-config.js')`
- Updated line 114: `import('../sdk/providers/supabase/index.js')`

```diff
--- a/assets/js/portal.js
+++ b/assets/js/portal.js
@@ -87,3 +87,3 @@
         try {
-          const mod = await import('./assets/sdk/auromind-sdk.js');
+          const mod = await import('../sdk/auromind-sdk.js');
           sdk = (mod && (mod.AuroMind || mod.default)) || window.AuroMind;
@@ -102,3 +102,3 @@
       try {
-        const { createConfiguredProviders } = await import('./assets/sdk/config/backend-config.js');
+        const { createConfiguredProviders } = await import('../sdk/config/backend-config.js');
         const resolved = await createConfiguredProviders();
@@ -113,3 +113,3 @@
         if (sbConfig.supabaseUrl && sbConfig.supabaseAnonKey) {
-          const mod = await import('./assets/sdk/providers/supabase/index.js');
+          const mod = await import('../sdk/providers/supabase/index.js');
           if (mod && mod.createSupabaseProviders) {
```

#### Verification
- Unit Test: `B17.4 Group A - 1` & `B17.4 Group A - 2` verified exports and path syntax.
- Real-Browser Test: `E2E Suite C - 3` asserted that loading the portal generates zero HTTP 404 console or network errors for `backend-config.js`.

---

### 3.2 B17-DEFECT-02: Senior Mode Mid-Session Synchronization Selector Mismatch

#### Problem & Root Cause
In `assets/js/portal.js` line 824, `applySeniorMode()` queried:
```javascript
const activeIframe = document.getElementById('game-theater-iframe');
```
However, in `index.html` line 1505 and throughout `portal.js` line 310, the theatre iframe is defined with ID `game-viewport-iframe`. Consequently, `activeIframe` was always `null` during runtime toggles, preventing mid-session accessibility preference propagation to active games.

#### Implementation & Exact Diff
In `assets/js/portal.js`:
- Updated line 824 to query `#game-viewport-iframe` with `#game-theater-iframe` as fallback.

```diff
--- a/assets/js/portal.js
+++ b/assets/js/portal.js
@@ -823,2 +823,2 @@
     // Broadcast Senior Mode state to active theater iframe
-    const activeIframe = document.getElementById('game-theater-iframe');
+    const activeIframe = document.getElementById('game-viewport-iframe') || document.getElementById('game-theater-iframe');
     if (activeIframe && activeIframe.contentWindow) {
```

Additionally, in `games/auromatch/src/main.js`, the Senior Mode message listener was hoisted to module top-level so that child iframes immediately receive and process `AUROMIND_SET_SENIOR_MODE` events even before full resource `window.onload` completion.

#### Verification
- Unit Test: `B17.4 Group B - 1` & `B17.4 Group B - 2` validated selector and message dispatch.
- Real-Browser Test: `E2E Suite D - 3` validated that launching a game in theatre mode, toggling Senior Mode ON mid-session, and toggling it OFF dynamically applies and removes `.senior-mode` on the child iframe without page reload.

---

### 3.3 B17-DEFECT-03: Opaque-Origin postMessage Failure and Mandatory Security Validation

#### Problem & Root Cause
In `games/auromatch/src/main.js` and `games/auromandala/assets/auromandala-sdk-bridge.js`:
```javascript
window.parent.postMessage({ type: 'AUROMIND_CLOSE_THEATER' }, window.location.origin);
```
When running inside sandboxed iframes (e.g. without `allow-same-origin`) or standalone file contexts, `window.location.origin` returns the string `"null"`. The browser postMessage API throws:
`DOMException: SyntaxError: Failed to execute 'postMessage' on 'Window': Invalid target origin 'null'`.

#### Implementation & Exact Diff
Implemented a secure origin resolution pattern:
1. When `window.location.origin` is a valid HTTP or HTTPS origin, preserve exact-origin targeting.
2. Only when `window.location.origin` is `'null'` or opaque, fall back to `'*'`.
3. In all message receivers (both games and portal shell), implement rigorous validation:
   - Mandatory source check: `event.source === window.parent` (in games) or `event.source === theaterIframe.contentWindow` (in portal).
   - Origin check: allow only exact origin or `'null'`. Reject third-party origins.
   - Strict payload allowlist: drop malformed, non-object, or unknown message types.

```diff
--- a/games/auromatch/src/main.js
+++ b/games/auromatch/src/main.js
@@ -1088,2 +1088,5 @@
         if (window.parent && window.parent !== window) {
-            window.parent.postMessage({ type: 'AUROMIND_CLOSE_THEATER' }, window.location.origin);
+            const targetOrigin = (window.location.origin && window.location.origin !== 'null' && (window.location.origin.startsWith('http:') || window.location.origin.startsWith('https:')))
+                ? window.location.origin
+                : '*';
+            window.parent.postMessage({ type: 'AUROMIND_CLOSE_THEATER' }, targetOrigin);
@@ -1746,4 +1749,15 @@
     window.addEventListener('message', (event) => {
-        if (event.origin !== window.location.origin) return;
-        if (event.data && event.data.type === 'AUROMIND_SET_SENIOR_MODE') {
+        // 1. Mandatory Source Validation
+        if (!window.parent || event.source !== window.parent) return;
+        // 2. Origin Validation
+        const currentOrigin = window.location.origin;
+        const isTrustedOrigin = (currentOrigin && currentOrigin !== 'null')
+            ? (event.origin === currentOrigin)
+            : (event.origin === 'null' || event.origin === '');
+        if (!isTrustedOrigin) return;
+        // 3. Strict Payload and Type Allowlist Validation
+        if (!event.data || typeof event.data !== 'object' || Array.isArray(event.data)) return;
+        if (event.data.type === 'AUROMIND_SET_SENIOR_MODE') {
```

Applied corresponding updates to `games/auromandala/assets/auromandala-sdk-bridge.js`, `games/auroblocks/assets/auroblocks-sdk-bridge.js`, and `assets/js/portal.js`.

#### Verification
- Unit Tests: `B17.4 Group C - 1` through `B17.4 Group C - 6` verified origin fallback, source validation, opaque origin acceptance, and rejection of foreign origins / unknown message types.
- Real-Browser Tests: All 6 launch games in `E2E Suite B` return to the portal successfully without DOMExceptions.

---

### 3.4 B17-DEFECT-04: AuroBlocks Strict CSP Compliance via Script Externalization

#### Problem & Root Cause
`games/auroblocks/index.html` contained three inline `<script>` tags in `<head>` performing cache cleanup, service worker registration rewriting, and artwork URL interception. Under production security headers enforcing `Content-Security-Policy: default-src 'self'; script-src 'self'`, all three inline scripts were blocked by the browser.

#### Implementation & Exact Diff
1. Created `games/auroblocks/assets/auroblocks-init.js` containing all three initialization routines in their exact execution order.
2. In `games/auroblocks/index.html`, replaced the inline script blocks with `<script src="./assets/auroblocks-init.js"></script>`.
3. Verified script execution order: `auroblocks-init.js` -> `auroblocks-sdk-bridge.js` -> `index-BLt2QrTp.js`.

```diff
--- a/games/auroblocks/index.html
+++ b/games/auroblocks/index.html
@@ -20,128 +20,3 @@
     <link rel="apple-touch-icon" sizes="180x180" href="./apple-touch-icon.png" />
-    <script>
-      (function () {
-        ... (stale dev cache purge)
-      })();
-    </script>
-    <script>
-      if ('serviceWorker' in navigator) {
-        ... (service worker registration rewrite)
-      }
-    </script>
-    <script>
-      (function () {
-        ... (artwork url rewriter)
-      })();
-    </script>
+    <!-- AuroBlocks Runtime Initialization (B17.4 externalized for strict script-src 'self' CSP compliance) -->
+    <script src="./assets/auroblocks-init.js"></script>
     <!-- AuroMind Shared Platform SDK Bridge -->
```

#### Verification
- Unit Tests: `B17.4 Group D - 1` through `B17.4 Group D - 4` verified zero inline scripts, valid syntax, correct dependency order, and relative path compliance.
- Real-Browser Test: `E2E Suite B - 8` launched AuroBlocks in real Chromium and asserted zero CSP violation errors in the console and successful mounting of `#root`.

---

## 4. Modified Application & Test Files

| File Path | Type | Modifications |
|---|---|---|
| `assets/js/portal.js` | Core Application | Fixed relative dynamic import paths (`../sdk/...`), updated Senior Mode iframe selector to `#game-viewport-iframe`, hardened message receiver. |
| `games/auromatch/src/main.js` | Game Application | Implemented safe targetOrigin, hoisted Senior Mode listener, added strict source/origin validation. |
| `games/auromandala/assets/auromandala-sdk-bridge.js` | Game Bridge | Implemented safe targetOrigin, added strict source/origin validation for Senior Mode. |
| `games/auroblocks/assets/auroblocks-sdk-bridge.js` | Game Bridge | Implemented safe targetOrigin, added strict source/origin validation for Senior Mode. |
| `games/auroblocks/index.html` | Game Shell | Replaced inline `<script>` blocks with externalized `<script src="./assets/auroblocks-init.js">`. |
| `games/auroblocks/assets/auroblocks-init.js` | **New File** | Externalized initialization logic (cache purge, SW scope rewrite, artwork rewriter). |
| `b17-4-remediation.test.js` | **New Test Suite** | 17 comprehensive unit/integration regression tests validating all 4 defects and security invariants. |
| `b17-3-e2e.test.js` | E2E Test Suite | Added 3 new real-browser E2E regression tests (Suite B-8, Suite C-3, Suite D-3). |

---

## 5. Test Accounting & Platform Evolution

```
+---------------------------------------------------------------------------------+
|                       Platform Automated Test Baseline Growth                   |
+---------------------------------------------------------------------------------+
| Milestone | Description                             | Suites | Tests | Result   |
+-----------+-----------------------------------------+--------+-------+----------+
| B16       | Canonical Integration Baseline          | 14     | 191   | 100% Pass|
| B17.1/2   | Platform Remediation Tiers 1 & 2        | 15     | 206   | 100% Pass|
| B17.3     | Browser E2E Automation (Initial)        | 16     | 231   | 100% Pass|
| **B17.4** | **Browser Defect Remediation & Tests**   | **17** | **251** | **100% Pass**|
+---------------------------------------------------------------------------------+
```

- **Pre-B17.4 Total:** 231 tests (206 unit/integration + 25 real-browser).
- **Newly Added in B17.4:** 20 tests (17 in `b17-4-remediation.test.js` + 3 in `b17-3-e2e.test.js`).
- **Post-B17.4 Total:** **251 tests (100% Passing across 17 files)**.
- **Failures:** 0.
- **Skipped:** 0.
- **Cancelled:** 0.
