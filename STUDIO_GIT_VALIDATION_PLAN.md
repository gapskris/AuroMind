# AuroMind — Studio to Git Validation Plan
## Phased Execution Protocol, Quality Gates & Verification Checklist

**Studio Source:** `C:\AuroMind_Studio`  
**Git Target:** `C:\AuroMindPortal` (`dev/studio-integration`)  
**Audit Date:** 2026-11-20  
**Scope:** Planning and Audit Only (Execution Deferred Until Explicit Authorization)

---

## 1. Overview & Phased Architecture

This document establishes the step-by-step verification protocol to be executed once Product Owner approval is granted. The plan guarantees that reconciling `C:\AuroMind_Studio` into `C:\AuroMindPortal` introduces zero regressions, causes zero credential leakage, preserves all game artwork, and maintains total tracked files below Google AI Studio's 1,000-file ceiling (`≤ 990`).

```
[Phase 1: Pre-Flight Safety & Credential Quarantine]
                         │
                         ▼
[Phase 2: Bidirectional Staged Synchronization (Dry-Run)]
                         │
                         ▼
[Phase 3: Binary SHA-256 Parity & Content Verification]
                         │
                         ▼
[Phase 4: Automated Unit & Integration Testing (Node.js)]
                         │
                         ▼
[Phase 5: Real-Browser Playwright & Cold-Offline Validation]
                         │
                         ▼
[Phase 6: GitHub Pages Allowlist Assembly Dry-Run]
                         │
                         ▼
[Phase 7: Tracked-File Budget Verification (≤ 990 Files)]
                         │
                         ▼
[Phase 8: Controlled Commit & Review Checkpoint]
```

---

## 2. Phased Execution Protocol

### Phase 1: Pre-Flight Safety & Credential Quarantine
*Objective: Ensure secrets are isolated and the Git repository is in a safe, clean baseline state before touching any file.*

1. **Working Tree Cleanliness Assertion:**
   ```powershell
   git -C "C:\AuroMindPortal" status --porcelain
   ```
   *Expected Result:* Output is empty (0 uncommitted changes, 0 untracked files).
2. **Credential Quarantine in `.gitignore`:**
   Add exact ignore rules to both `.gitignore` files:
   ```gitignore
   # Local environment & secrets (MANDATORY)
   .env
   .env.*
   *.env
   ```
3. **Secret Scan Verification:**
   Verify `.env` in `C:\AuroMind_Studio` is ignored by Git rules:
   ```powershell
   git -C "C:\AuroMindPortal" check-ignore -v .env
   ```
   Confirm that `.env` will never be staged or copied into the Git worktree.

---

### Phase 2: Bidirectional Staged Synchronization (Dry-Run Mode)
*Objective: Transfer verified Studio deliverables into Git and backport Git-only artwork into Studio.*

1. **Step 2A: Copy Verified Studio Deliverables into Git Worktree:**
   - Copy `index.html` (with SDK `<script type="module">` tags and `portal.js?v=3.7`).
   - Copy `assets/js/portal.js` (with single-init SDK bootstrap and Clear Cache identity protection).
   - Copy `sw.js` (with `auro-portal-v1.1.0`, precaching, and SDK offline route).
   - Copy `server.js` (with `'architecture-design'` route blocking).
   - Copy `server.test.js` (with comprehensive 611-line B2 test suite).
   - Copy `assets/sdk/` directory (`auromind-sdk.js`, `auromind-adapters.js`).
   - Copy `auromind-sdk.test.js`.
   - Copy `.github/workflows/pages.yml`.
   - Copy `architecture-design/` (all 24 architecture and batch reports).
   - If Option 1 approved: copy `phase0-audit/ARCHIVE.md` and stage removal of the 10 separate reports.
2. **Step 2B: Backport Git-Only Assets into Studio Workspace:**
   - Copy 19 missing `*_clean.png` background variants from `C:\AuroMindPortal\games\auromatch\Assets\backgrounds/` into `C:\AuroMind_Studio\games\auromatch\Assets\backgrounds/`.
   - Copy 4 thumbnails from `C:\AuroMindPortal\assets\thumbnails/` into `C:\AuroMind_Studio\assets\thumbnails/`.
3. **Step 2C: Add `.gitattributes` for Line-Ending Standardization:**
   ```gitattributes
   * text=auto eol=lf
   *.png binary
   *.jpg binary
   *.webp binary
   *.svg text eol=lf
   ```
4. **Step 2D: Exclude Studio Ephemera:**
   Assert that `.vscode/`, `.antigravity/`, `.aistudio/`, and `.env` are strictly untouched and not copied to Git.

---

### Phase 3: Binary SHA-256 Parity & Content Verification
*Objective: Mathematically guarantee zero corruption of game source, compiled bundles, or protected corpora.*

Run automated SHA-256 verification asserting 100% hash parity for the core protected files:

| Monitored File Path | Expected SHA-256 Hash |
|---|---|
| `assets/sdk/auromind-sdk.js` | `174e31eab5d88a1ee391ec0f1bafc4eb75d71362680dbb038964d82c1b0c22b7` |
| `assets/sdk/auromind-adapters.js` | `2d168d746537b8fc3b5396432b44a8ed85a89fcdec0ea910d38d1aea67c72717` |
| `auromind-sdk.test.js` | `78652b4eedfba2dd5b1496c9e5cde2fe0be2449222280c1a0b73f8de4b1f131b` |
| `games/auromatch/src/models/floraDatabase.js` | `689d035cd52abd8d342528d8c5f61f298916b8052b8287450be4931cf8ae1a3a` (LF) |
| `games/vak/index.html` | `04034bd881a478cd807b999220bdf3c228354e9674717113c510dca173c29d1f` (LF) |
| `games/auromandala/assets/index-DhYVrlzX.js` | `aa043f4d4d39e9797d128928b5d4cbbc444be1edd71d9f5c6cf876689dc5c80e` (LF) |
| `games/vak-living-sanctuary/assets/index-CUrzyYgb.js` | `f851ec703259c1e6c19b1241b67d8f6ed553fc3079e8f25656228571d3076d3f` (LF) |
| `games/auroblocks/assets/index-BLt2QrTp.js` | `cab995d6dea93f9caeae2d0ea804c3e47d41e29119ee48f1663fe80407b8588a` (LF) |
| `phase0-audit/ARCHIVE.md` | `a01afe7d1454cb4245bc05eb4fc01444cf30980893fc37f2b98f14627c03c0a7` |

*Pass Condition:* 100% match. Any hash discrepancy triggers an immediate abort.

---

### Phase 4: Automated Unit & Integration Testing (Node.js)
*Objective: Verify all server and SDK capabilities pass in the reconciled worktree.*

1. **Syntax Check:**
   ```powershell
   node --check assets/js/portal.js
   node --check sw.js
   node --check server.js
   node --check server.test.js
   ```
2. **Server Integration Tests:**
   ```powershell
   node --test server.test.js
   ```
   *Expected Result:* 7/7 subtests pass.
3. **Shared Platform SDK Regression Tests:**
   ```powershell
   node --test auromind-sdk.test.js
   ```
   *Expected Result:* 31/31 subtests pass (zero B1/B1.1 regressions).

---

### Phase 5: Real-Browser Playwright & Cold-Offline Validation
*Objective: Execute real headless Chromium browser validation against the reconciled portal.*

Launch headless Chromium via Playwright against `http://localhost:3000` and assert:
1. **Online Load:** Both SDK modules load with HTTP 200, CSP script-src 'self' valid, `AuroMind.isInitialized() === true`, `portalInitCount === 1`, guest identity `guest_<uuidv4>` created in both `AuroMindPlatformDB` and `localStorage`.
2. **Page Reload:** Exact same `guestId` preserved, `portalInitCount === 1`.
3. **Clear Cache:** Click `#settings-reset-btn`, confirm dialog; verify portal preferences cleared (`null`), `'Cache Cleared ✓'` feedback displayed, reload page, verify exact same `guestId` and `AuroMindPlatformDB` intact.
4. **Service Worker Precache:** Confirm active worker `sw.js` controls scope, cache `auro-portal-v1.1.0` contains both SDK files and `portal.js?v=3.7`, with 0 `/games/*` entries.
5. **Cold-Offline Portal Visit:** Set `context.setOffline(true)`, open fresh tab to `http://localhost:3000/`:
   - `/`, SDK files, and `portal.js` return HTTP 200 `fromSW: true`.
   - `sameOriginFailedCount === 0`, `offlineConsoleErrors.length === 0`.
   - `AuroMind.isInitialized() === true`, identical `guestId` retrieved offline.
6. **Six Game Routes Isolation:** Navigate to each of the 6 game entry points; verify HTTP 200 with `fromServiceWorker === false` and 0 page errors.

---

### Phase 6: GitHub Pages Allowlist Assembly Dry-Run
*Objective: Validate that the Pages deployment artifact assembles cleanly without leaking private files.*

Execute a local simulation of `.github/workflows/pages.yml`:
1. Assemble `_site/` directory from approved allowlist (`index.html`, `manifest.json`, `sw.js`, `assets/`, `games/`).
2. Run automated verification assertions:
   - Required files exist: `_site/index.html`, `_site/assets/sdk/auromind-sdk.js`, `_site/assets/sdk/auromind-adapters.js`, all 6 game entry points.
   - Forbidden directories absent: `_site/architecture-design`, `_site/phase0-audit`, `_site/server.js`, `_site/*.test.js`.
   - Markdown leakage check: `find _site -name "*.md"` returns `0` files.
3. Clean up temporary directory immediately.

---

### Phase 7: Tracked-File Budget Audit (Ceiling ≤ 990 Files)
*Objective: Ensure the repository remains safely importable into Google AI Studio.*

Count total tracked files in Git:
```powershell
(git -C "C:\AuroMindPortal" ls-files | Measure-Object).Count
```
*Pass Condition:* Must be **`≤ 990`** (target ceiling). With Option 1, the count will be exactly **`987`**, leaving 13 files of headroom before the 1,000-file ceiling.

---

### Phase 8: Final Review & Controlled Commit Protocol
*Objective: Safely record the reconciliation in Git under a descriptive, auditable commit message.*

1. Review `git diff --stat` and `git status` output.
2. Confirm `.env` is NOT in `git status` (must be completely ignored).
3. Stage only verified files:
   ```powershell
   git add .gitignore .gitattributes index.html assets/ sw.js server.js server.test.js auromind-sdk.test.js .github/ architecture-design/ phase0-audit/
   ```
4. Record reconciliation commit (only after human approval):
   ```
   feat(platform): reconcile Batch B0-B2 Studio implementation into dev/studio-integration

   - Integrate AuroMind Shared Platform SDK (auromind-sdk.js, auromind-adapters.js)
   - Add comprehensive SDK test suite (auromind-sdk.test.js, 31 tests passing)
   - Wire portal SDK bootstrap and read-only window.AuroMindPortal bridge
   - Harden Settings Clear Cache to preserve guest identity and game saves
   - Bump service worker to auro-portal-v1.1.0 with offline SDK caching
   - Enforce root service worker isolation from all /games/* routes
   - Add GitHub Pages manual allowlist deployment workflow (.github/workflows/pages.yml)
   - Consolidate Phase 0 audit reports into phase0-audit/ARCHIVE.md (file budget: 987 <= 990)
   - Standardize line endings via .gitattributes and enforce .env credential isolation
   - Retain all Git-only game backgrounds, artwork, and thumbnails
   ```
5. Do NOT push to remote without explicit separate authorization.

---

## 3. Human Approval Checklist (Unresolved Decisions)

Before Phase 1 execution begins, the Product Owner must decide on the following three points:

- [ ] **Decision 1: Phase 0 Audit Consolidation Strategy**
  - **Option 1 (Recommended):** Replace the 10 separate markdown reports with `phase0-audit/ARCHIVE.md` in Git. This preserves all 10 reports verbatim in one file and brings total tracked files to `987 ≤ 990`, guaranteeing smooth future imports in Google AI Studio.
  - **Option 2:** Retain the 10 separate reports in Git and also add `ARCHIVE.md`. Total tracked files would be `997`, leaving only 3 files of headroom before AI Studio's 1,000-file ceiling.
- [ ] **Decision 2: Backporting 19 Backgrounds and 4 Thumbnails into Studio**
  - **Approval:** Approve copying the 19 `*_clean.png` background variants and 4 thumbnails from Git into `C:\AuroMind_Studio` so both environments have 100% visual asset parity.
- [ ] **Decision 3: Adding `.gitattributes` for Line-Ending Standardization**
  - **Approval:** Approve adding `.gitattributes` (`* text=auto eol=lf`) to permanently resolve the 85-file CRLF/LF diff noise between Windows and Linux/AI Studio environments.
