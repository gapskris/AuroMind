# AuroMind — Studio to Git Risk Register
## Security, Architectural & Operational Risk Assessment

**Studio Source:** `C:\AuroMind_Studio`  
**Git Target:** `C:\AuroMindPortal` (`dev/studio-integration`)  
**Audit Date:** 2026-11-20  
**Scope:** Planning and Audit Only

---

## 1. Risk Matrix & Scoring Framework

| Severity Level | Definition | Action Required |
|---|---|---|
| **CRITICAL** | Direct credential leak, irreversible data loss, or production security failure | Must be eliminated before any file transfer |
| **HIGH** | Breaks platform import ceiling, regresses architecture, or introduces subtle runtime bugs | Explicit mitigation and verification gate required |
| **MEDIUM** | Large diff noise, missing non-critical assets, or suboptimal configuration | Addressed through standardization and testing |
| **LOW** | Minor cosmetic difference or developer tooling preference | Handled with standard hygiene |

---

## 2. Risk Register

| Risk ID | Risk Description | Severity | Probability | Impact Area | Primary Mitigation Strategy | Verification Check |
|---|---|---|---|---|---|---|
| **RISK-01** | **Active API Secret Exposure:** `C:\AuroMind_Studio\.env` contains an active `GEMINI_API_KEY`. Neither `.gitignore` file currently includes `.env`. Accidental staging or commit would leak credentials to GitHub history. | **CRITICAL** | High (if unmitigated) | Security / Governance | 1. Add `.env` and `.env*` to `.gitignore`.<br>2. Add pre-commit safety check script asserting `.env` is untracked.<br>3. Strictly exclude `.env` from file copy operations into `C:\AuroMindPortal`. | `git status --ignored` confirms `.env` is ignored; `git check-ignore -v .env` matches ignore rule; `git ls-files .env` returns empty. |
| **RISK-02** | **AI Studio 1,000-File Import Limit Breach:** If all 45 Git-only files and 29 Studio files are merged naively without consolidation, total tracked files would reach `1,038`, breaking Google AI Studio's observed ~1,000-file GitHub import ceiling. | **HIGH** | High | Tooling / Workflow Continuity | 1. Adopt Option 1 for Phase 0 Audit: replace the 10 separate markdown reports with `phase0-audit/ARCHIVE.md` in Git (`-9` files).<br>2. Exclude all tooling/temp files (`.vscode/`, `.antigravity/`, `.aistudio/artifacts/`).<br>3. Limit total reconciled tracked files to `987 ≤ 990`. | `git ls-files \| wc -l` yields `≤ 990` in reconciled worktree. |
| **RISK-03** | **Line-Ending Churn (85 Files):** Windows Git checkout (`CRLF`) vs. Linux container (`LF`) creates an artificial 85-file diff across all 6 games, polluting git history and making code reviews unreadable. | **MEDIUM** | High | Git Hygiene / Reviewability | Add `.gitattributes` at repository root defining `* text=auto eol=lf` for text files and binary flags for images, then run `git add --renormalize .` during reconciliation. | `git diff --ignore-space-at-eol` produces identical output to `git diff`; SHA-256 digests remain deterministic. |
| **RISK-04** | **Regression of B1 / B1.1 Hardening:** Inadvertent overwrite or omission of `assets/sdk/auromind-sdk.js` or `assets/sdk/auromind-adapters.js` could reintroduce race conditions, VersionError crashes, or unhandled peer broadcast bugs. | **HIGH** | Low | Runtime Stability / Storage | Preserve Studio SDK files verbatim. Run all 31 automated tests in `auromind-sdk.test.js` before and after reconciliation. Compare SHA-256 against accepted B1.1 baseline. | SHA-256 match: `auromind-sdk.js` (`174e31ea...`), `auromind-adapters.js` (`2d168d74...`); 31/31 unit tests pass. |
| **RISK-05** | **Regression of B2 Service Worker Isolation:** Inadvertent regression of `sw.js` could cause root SW to intercept `/games/*` routes or fail cold-offline portal visits. | **HIGH** | Low | Game Isolation / Offline PWA | Deploy Studio `sw.js` (v1.1.0) with strictly verified routing: Step 3 `/games/*` bypass precedes Step 3b SDK Cache-First route. Run automated SW simulation in `server.test.js` and real-browser offline validation in Playwright. | `server.test.js` tests 6 & 7 pass; Playwright cold-offline visit confirms HTTP 200 `fromSW: true` for SDK and `fromSW: false` for all 6 game routes. |
| **RISK-06** | **Loss of Git-Only Game Artwork & Thumbnails:** Studio is missing 19 `*_clean.png` background variants and 4 thumbnails present in Git. Deleting or omitting them would cause broken images in AuroMatch or portal catalog. | **MEDIUM** | Medium | Visual Quality / UX | Retain all 35 Git-only artwork/thumbnail files in Git. Additionally, backport the 19 missing `*_clean.png` backgrounds into Studio's `games/auromatch/Assets/backgrounds/` and thumbnails into Studio's `assets/thumbnails/`. | `Test-Path` check confirms all 35 files exist in both trees post-reconciliation; zero 404 image requests in Playwright. |
| **RISK-07** | **Violation of Execution Guardrails (Git Mutation):** Accidental execution of `git checkout`, `git reset`, `git merge`, `git push`, or branch switching during planning or unapproved execution could corrupt the Git baseline. | **CRITICAL** | Low | Governance / Audit Integrity | Enforce strict read-only execution policy. Zero mutating Git commands executed during planning. Require explicit Product Owner authorization before any file modification or Git commit. | Working tree at `C:\AuroMindPortal` remains clean on commit `67d0472` throughout this entire session. |
| **RISK-08** | **Documentation Exposure on GitHub Pages:** Accidental deployment of internal architecture design documents, security audit archives, or server test scripts to public Pages runtime. | **HIGH** | Low | Information Security / Compliance | 1. Ensure `server.js` blocks `/architecture-design` (HTTP 404).<br>2. Ensure `sw.js` never caches `.md`, test, or server files.<br>3. Verify `.github/workflows/pages.yml` strict allowlist excludes all markdown and private directories. | Pages workflow dry-run confirms `MD_COUNT=0` and zero forbidden directories in `_site/`. |

---

## 3. Preventive Controls & Verification Gates

### Gate 1: Credential Quarantine (Pre-Reconciliation)
- **Check:** Run automated string scanner across both workspaces for `GEMINI_API_KEY`, private tokens, and passwords.
- **Enforcement:** Ensure `.env` is listed in `.gitignore` in both projects. Assert `git status --ignored` shows `.env`.
- **Pass Condition:** `git ls-files .env` returns zero lines; no credentials staged.

### Gate 2: File-Budget Ceiling Check
- **Check:** Measure total candidate tracked files.
- **Enforcement:** Enforce maximum candidate tracked file budget `≤ 990`.
- **Pass Condition:** `(git ls-files | Measure-Object).Count <= 990`.

### Gate 3: Core Game Parity Check
- **Check:** Line-by-line normalized diff of all 71 game source and bundle files across both projects.
- **Pass Condition:** `0` content differences across all 6 games (`games/*`).

### Gate 4: Automated Test Gate
- **Check:** Run full test suite in reconciled workspace:
  - `node --test server.test.js` (7 tests)
  - `node --test auromind-sdk.test.js` (31 tests)
  - `node --check` across all JavaScript entry points.
- **Pass Condition:** 38/38 tests pass; zero syntax errors.

### Gate 5: Headless Browser Cold-Offline Gate
- **Check:** Real headless Chromium Playwright test verifying:
  - Online portal load & single-init (`portalInitCount === 1`)
  - Reload guest ID stability
  - Clear Cache preservation of `auromind.platform.v1.guest` and `AuroMindPlatformDB`
  - Cold offline load (`context.setOffline(true)`) serving SDK and portal from SW cache
  - All 6 game routes loaded with `fromServiceWorker === false`.
- **Pass Condition:** All Playwright assertions pass with zero console errors.
