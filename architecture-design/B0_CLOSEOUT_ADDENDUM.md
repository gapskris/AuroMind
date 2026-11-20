# Batch B0 — Closeout Addendum (Approved Housekeeping & Documentation Protection)

- **Programme:** AuroMind Platform Modernization (Target Launch: 1 January 2027)
- **Scope:** Approved B0 Closeout Decisions (Part A1 & Part A2) executed prior to Batch B1
- **Repository / Branch:** `gapskris/AuroMind` (`dev/studio-integration`)
- **Status:** Complete & Verified (zero Git operations, zero Pages settings changes, zero production deployment triggers)

---

## 1. Decision A1 — Add `bun.lock` to `.gitignore`

- **Change:** Added exact rule `bun.lock` under `# Dependencies` in `.gitignore` (line 4). No unrelated ignore rules were added.
- **Preservation Verified:** Existing workspace `bun.lock` was not deleted, renamed, modified, or staged (`13,862` bytes, SHA-256 `9d39d91a1e32ea38e92e66c2330ddbb6f7e7ebec3afced6ab1d300b6cf601b08`).
- **Ignore Verification:** Exact root-level pattern `bun.lock` matches `bun.lock` cleanly in Git ignore semantics while continuing to block HTTP serving via `server.js` `BLOCKED_ROOT_SEGMENTS`.

---

## 2. Decision A2 (Measure 1) — GitHub Pages Allowlist Workflow

- **File Created:** `.github/workflows/pages.yml` (`+1` tracked file)
- **Trigger Posture:** **Manual `workflow_dispatch:` ONLY.** No `push`, `pull_request`, or `schedule` triggers exist; automatic production deployment is NOT activated.
- **Least-Privilege Permissions:**
  - Workflow default: `contents: read`
  - `deploy` job only: `pages: write`, `id-token: write`
- **Official Actions Used:** `actions/checkout@v4`, `actions/configure-pages@v5`, `actions/upload-pages-artifact@v3`, `actions/deploy-pages@v4`.
- **Strict Runtime Allowlist Copied to `_site/`:**
  - `index.html`
  - `manifest.json`
  - `sw.js`
  - `assets/` (includes portal CSS/JS/icons/thumbnails and B1 `assets/sdk/`)
  - `games/` (all 6 games preserving exact `/games/<slug>/` URL structure)
  - `.nojekyll` generated inside `_site/` at build time only (not added as a tracked repo file)
- **Verified Exclusions & Automated Guardrail:**
  - Built-in workflow verification step confirms all required portal + 6-game entry points exist in `_site/` AND fails the workflow if any forbidden path (`architecture-design/`, `phase0-audit/`, `server.js`, `server.test.js`, `auromind-sdk.test.js`, `package.json`, `package-lock.json`, `bun.lock`, `README.md`, `.gitignore`, `.git`, `.github`, `.aistudio`, `.playwright-cli`, `node_modules`) or any `*.md` file is present in `_site/`.
  - Local dry-run execution of the allowlist copy produced strictly `assets`, `games`, `index.html`, `manifest.json`, `.nojekyll`, `sw.js` with `0` Markdown files (`MD in assets/: 0`, `MD in games/: 0`).
  - Verified no additional root-level files are required at runtime (`games/auroblocks/index.html` already rewrites `/assets/artwork/` to `./assets/artwork/` for GitHub Pages).

### Later Steps Required to Activate Production Pages Deployment (Requires Explicit Product Owner Approval)
1. Merge the approved branch changes into `main` (or designated deployment branch).
2. In GitHub Repository Settings → **Pages** → **Build and deployment** → **Source**, switch from *Deploy from a branch* to **GitHub Actions**.
3. Run a controlled manual `workflow_dispatch` deployment first and verify `https://gapskris.github.io/AuroMind/` serves the portal + all 6 games (`200 OK`) while `/architecture-design/`, `/phase0-audit/`, `/README.md`, and `/server.js` return `404 Not Found`.
4. Only after manual verification succeeds and Product Owner explicitly approves automatic deploys, add a `push: branches: [main]` trigger to `.github/workflows/pages.yml`.

---

## 3. Decision A2 (Measure 2) — Express Documentation Blocklist

- **Files Updated:** `server.js`, `server.test.js`
- **Change in `server.js`:** Added `'architecture-design'` to `BLOCKED_ROOT_SEGMENTS` (line 16). All existing AURO-33 controls (dotfile/traversal block, root `.md`/`.lock`/`.test.js` block, `phase0-audit`, `server.js`, `server.test.js`, `package.json`, `bun.lock`, `node_modules`) remain intact and unmodified.
- **Change in `server.test.js`:** Added explicit `404` regression checks for `/architecture-design`, `/architecture-design/`, `/architecture-design/TARGET_ARCHITECTURE.md`, `/architecture-design/OPEN_DECISIONS.md`, `/architecture-design/B0_FILE_INVENTORY.md`, `/phase0-audit/ARCHIVE.md`, `/README.md`, `/auromind-sdk.test.js`, and `/.github/workflows/pages.yml`.
- **Validation:** `node --test server.test.js` passed (`1/1`, `0` failed).

---

## 4. Honest Residual Exposure Reminder

- `gapskris/AuroMind` remains a **public** GitHub repository; Measures 1 and 2 prevent documentation from being served over HTTP on GitHub Pages (once activated) and on local/Studio Express preview servers, but do **not** make tracked Markdown files private on GitHub.com. Never commit secrets, credentials, or Supabase keys to tracked documentation.
