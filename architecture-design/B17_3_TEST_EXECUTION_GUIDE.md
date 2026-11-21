# AuroMind B17.3 Real-Browser Test Execution Guide

**Date:** November 20, 2026  
**Canonical Workspace:** `C:\AuroMindPortal`  
**Active Git Branch:** `dev/studio-integration`  
**Target Release:** January 1, 2027  
**Test Suite Count:** 16 files (231 tests total, including 25 real-browser E2E tests)

---

## 1. Overview

The AuroMind platform includes a dual-mode testing framework:
1. **Built-in Node.js Test Runner (Autonomous / Zero External Dependency):** Executes using the Node.js built-in `--test` runner and local Chromium automation harness (`e2e/browser-harness.js`).
2. **Playwright CLI Runner (Standard CI / Cloud Automation):** Executes using `playwright.config.js` via `npx playwright test`.

Both approaches validate the application against authentic Chromium browser engines with real CSS rendering, iframe boundaries, and Chrome DevTools Protocol network manipulation.

---

## 2. Prerequisites & Environment Setup

### 2.1 System Requirements
- **Operating System:** Windows 10/11, macOS, or Linux
- **Node.js:** v18.0.0 or later (Tested on Node v24.22.0)
- **Chromium Browser:** Microsoft Edge (standard on Windows) or Google Chrome installed in standard application directories.

### 2.2 Binary Discovery Order
The browser harness automatically detects the browser binary in the following order:
1. Environment variable `CHROME_BIN` or `EDGE_BIN`
2. `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`
3. `C:\Program Files\Google\Chrome\Application\chrome.exe`
4. User AppData local browser paths

---

## 3. Running Tests

### Option A: Autonomous Built-in Test Runner (Recommended for Local Dev)

To execute only the 25 real-browser E2E tests:
```powershell
Set-Location C:\AuroMindPortal
& 'agy-node.cmd' --test b17-3-e2e.test.js
```
*Expected Output:*
```
✔ E2E Suite A - 1: Portal loads successfully and renders valid document title
...
✔ E2E Suite H - 2: Active audio is suspended on theater launch and restored on theater exit
ℹ tests 25
ℹ pass 25
ℹ fail 0
```

To execute the **entire platform suite** (all 231 tests across 16 files):
```powershell
Set-Location C:\AuroMindPortal
& 'agy-node.cmd' --test *.test.js
```
*Expected Output:*
```
ℹ tests 231
ℹ pass 231
ℹ fail 0
```

---

### Option B: Standard Playwright CLI Runner (CI Environments)

If Playwright is installed in your Node environment:
```powershell
# Run all Playwright tests
npx playwright test

# Run in UI mode
npx playwright test --ui

# Run only desktop project
npx playwright test --project=chromium-desktop

# Run only mobile project
npx playwright test --project=chromium-mobile
```

---

## 4. Test Configuration Reference

### 4.1 `playwright.config.js`
Key parameters configured for the platform:
- **`webServer`:** Automatically starts `node server.js` on `http://localhost:3000` before running tests, and closes it upon completion.
- **Projects:**
  - `chromium-desktop`: 1280 x 800 viewport, `msedge` channel.
  - `chromium-mobile`: 390 x 844 viewport, iPhone 13 device profile with touch enabled.
- **Artifacts:** Retains failure screenshots, traces, and video recordings in `test-results/`.

### 4.2 `e2e/browser-harness.js`
Key capabilities:
- **`createTestEnvironment({ port })`:** Launches an isolated in-process static HTTP server with full MIME type mapping and realistic headers.
- **`createInstrumentedPage({ viewport })`:** Creates an isolated Incognito BrowserContext per test, attaches CDP listeners for console and network errors, and returns a clean automation handle.
- **`page.captureScreenshot(testName)`:** Writes full-resolution PNG artifacts to `test-results/artifacts/<testName>.png` if an assertion fails.

---

## 5. Troubleshooting & FAQ

### Issue: "Browser binary not found"
**Cause:** Edge or Chrome is installed in a non-standard location.  
**Resolution:** Set the `EDGE_BIN` environment variable:
```powershell
$env:EDGE_BIN = "C:\Path\To\Your\msedge.exe"
& 'agy-node.cmd' --test b17-3-e2e.test.js
```

### Issue: Port 3335 is already in use
**Cause:** A previous orphaned process or background service is occupying port 3335.  
**Resolution:** The harness automatically detects port conflicts and increments to `3336-3340`. To manually specify a port:
```powershell
$env:PORT = "3350"
& 'agy-node.cmd' --test b17-3-e2e.test.js
```

### Issue: Intermittent timing failure under heavy concurrent CPU load
**Cause:** Running 16 test files simultaneously with real browser instances may slow DOM updates on lower-spec machines.  
**Resolution:** Increase the postMessage transition settling delay in `b17-3-e2e.test.js` or run the E2E suite as a discrete execution step.
