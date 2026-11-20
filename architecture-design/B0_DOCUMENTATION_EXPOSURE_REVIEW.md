# Batch B0 — Documentation Exposure & Deployment Safety Review

- **Programme:** AuroMind Platform Modernization
- **Batch:** B0 — Repository File-Budget & Documentation Safety
- **Repository:** `gapskris/AuroMind`
- **Branch Under Audit:** `dev/studio-integration` (canonical security baseline: `67d04726fb82cdb3d9f253bd36e627fe0d7aef20`)
- **Product-Owner Decision Preserved:** Architecture documents **remain in the AuroMind repository** under `architecture-design/` (all 7 original design documents preserved byte-for-byte).

---

## 1. Honest Exposure Summary (Three Distinct Publishing Surfaces)

Because `gapskris/AuroMind` is a **public GitHub repository** deployed via **static GitHub Pages**, architecture documents stored in the repository are **NOT private**. Blocking them in `server.js` protects local/Node preview servers only and has **zero effect** on public GitHub repository visibility or static GitHub Pages serving.

| Publishing Surface | Current Status for `architecture-design/*.md` | Current Status for `phase0-audit/ARCHIVE.md` | Controlled by `server.js`? |
|---|---|---|---|
| **1. GitHub Repository (`github.com/gapskris/AuroMind`)** | **Publicly readable** once committed/pushed (`private: false`, `visibility: "public"`) | **Publicly readable** (`dev/studio-integration`) | **No** |
| **2. Live Static GitHub Pages (`https://gapskris.github.io/AuroMind/`)** | Currently `404` **only** because Pages currently publishes branch `main` (`3805f624`), which predates `architecture-design/`. **WILL become HTTP `200` publicly served** as soon as `dev/studio-integration` is merged into `main` under the current branch-based Pages setup! | Currently `404` for the same reason (`main` @ `3805f624`). **WILL become HTTP `200` publicly served** once merged into `main`! | **No** — GitHub Pages serves static files directly and ignores `server.js` |
| **3. Local / AI Studio Express Server (`http://127.0.0.1:3000`)** | **Currently HTTP `200` (`text/markdown`)** — `architecture-design` is NOT in `BLOCKED_ROOT_SEGMENTS` in canonical `server.js` | **HTTP `404` (Blocked)** — `phase0-audit` IS in `BLOCKED_ROOT_SEGMENTS` (`server.js:15`) | **Yes** (preview/Node runtime only) |

---

## 2. Verified Evidence from Live Inspection

### 2.1 GitHub Repository Metadata
Queried via GitHub REST API (`GET https://api.github.com/repos/gapskris/AuroMind`):
- `private`: `false`
- `visibility`: `"public"`
- `default_branch`: `"dev/studio-integration"`
- `has_pages`: `true`
- Active branches:
  - `dev/studio-integration` → `67d04726fb82cdb3d9f253bd36e627fe0d7aef20`
  - `main` → `3805f624ce3df40a8a3d3c28c8832c206a298ee9` (pre-handoff root tree contains only `.gitignore`, `README.md`, `assets/`, `games/`, `index.html`, `manifest.json`)
  - `recovery/phase1-batch1-2-checkpoint` → `3805f624ce3df40a8a3d3c28c8832c206a298ee9` (protected)
- Custom workflows: `.github/workflows/` does **not** exist in the repository.

### 2.2 Live GitHub Pages Behavior (`https://gapskris.github.io/AuroMind/`)
Unauthenticated `GET /repos/gapskris/AuroMind/pages` returns `404` (GitHub restricts Pages settings metadata to authenticated repo collaborators), so live HTTP `HEAD` probes were executed directly against the production Pages URL:
- `HEAD https://gapskris.github.io/AuroMind/` → **`200 OK`**
- `HEAD https://gapskris.github.io/AuroMind/README.md` → **`200 OK`**
- `HEAD https://gapskris.github.io/AuroMind/phase0-audit/ARCHIVE.md` → **`404 Not Found`**
- `HEAD https://gapskris.github.io/AuroMind/architecture-design/OPEN_DECISIONS.md` → **`404 Not Found`**

**Conclusion:** GitHub Pages is configured in classic **Deploy from a branch** mode publishing the raw repository root of `main` (evidenced by `README.md` returning `200 OK`). There is no build step stripping documentation directories. Consequently, merging `dev/studio-integration` into `main` without changing the Pages deployment method will publish `architecture-design/*.md`, `phase0-audit/ARCHIVE.md`, `server.js`, `server.test.js`, and `package.json` as publicly fetchable static files on `gapskris.github.io/AuroMind/`.

### 2.3 Live Local Express Server (`server.js` @ `http://127.0.0.1:3000`)
Direct HTTP probes against canonical `server.js` (SHA-256 `da3ede915d1ed754f92a7fcb391f746c984e1c15025c4814b3ba0c3c3c53b1ca`):
- `GET /architecture-design/OPEN_DECISIONS.md` → **`200 OK`** (`text/markdown; charset=UTF-8`)
- `GET /architecture-design/TARGET_ARCHITECTURE.md` → **`200 OK`** (`text/markdown; charset=UTF-8`)
- `GET /phase0-audit/ARCHIVE.md` → **`404 Not Found`** (blocked by `BLOCKED_ROOT_SEGMENTS`)
- `GET /README.md` → **`404 Not Found`** (blocked by root-level `.md` rule)
- `GET /server.js`, `/server.test.js`, `/package.json`, `/bun.lock`, `/.gitignore` → **`404 Not Found`**

---

## 3. Content Hygiene Audit of Tracked Documentation

All 7 frozen documents in `architecture-design/` and `phase0-audit/ARCHIVE.md` were reviewed for sensitive material:
- **No secrets, API keys, passwords, service-role keys, or credentials** exist in `architecture-design/*.md`.
- **No Supabase project URLs, anon keys, or tenant IDs** exist (no Supabase project has been confirmed or provisioned).
- **What IS disclosed publicly if the repo remains public:** Internal architecture blueprints, security audit history (`AURO-*` findings in `phase0-audit/ARCHIVE.md`), deferred gaps (such as `AURO-26` VAK Living Sanctuary beta-auth endpoints), future Supabase schema plans, and product launch milestones.

---

## 4. Safe Arrangement Options (No Changes Made Without Explicit Approval)

Per Batch B0 constraints, **no changes** were made to `server.js`, GitHub Pages configuration, or `.github/workflows/`. The Product Owner should explicitly authorize which combination of controls to apply before merging `dev/studio-integration` to `main`:

| Option | Action Required | Protects GitHub Pages URL? | Protects Local/Studio `server.js`? | Protects GitHub Repo Source? | Cost / Complexity |
|---|---|---:|---:|---:|---|
| **Option 1 (Recommended for Static Pages Hygiene):** Add a minimal GitHub Actions Pages workflow (`.github/workflows/pages.yml`) that copies only runtime web assets (`index.html`, `manifest.json`, `sw.js`, `assets/`, `games/`, future `shared/`) into `_site/` and deploys via `actions/deploy-pages` | Product Owner approves creating `.github/workflows/pages.yml` (+1 tracked file) & switching Repo Settings → Pages → Source to **GitHub Actions** | **Yes** (excludes `architecture-design/`, `phase0-audit/`, `server.js`, `server.test.js`, `package.json`, `README.md`) | No (pair with Option 2) | **No** (repo remains public unless Option 3 is chosen) | Low; 1 workflow file |
| **Option 2 (Recommended for Preview Parity):** Add `'architecture-design'` to `BLOCKED_ROOT_SEGMENTS` in `server.js` + matching regression assertion in `server.test.js` | Product Owner approves modifying canonical `server.js` & `server.test.js` (tracked as a controlled security-baseline update, e.g. in Batch B1/hardening) | **No** (Pages ignores `server.js`) | **Yes** (returns `404` on preview/Node server) | **No** | Trivial (1 line + 1 test) |
| **Option 3 (Only way to make docs genuinely private):** Change `gapskris/AuroMind` repository visibility to **Private** (requires GitHub Pro/Team/Enterprise to continue using GitHub Pages on a private repo) OR relocate confidential operational/security notes out of the public repo | Product Owner repo-admin action on GitHub | Depends on GitHub plan | N/A | **Yes** | GitHub plan dependent |

### Non-Negotiable Operational Rule Going Forward
Until Option 3 is enabled, **never commit secrets, credentials, Supabase keys, service-role tokens, internal user data, or unpatched vulnerability exploits** into `architecture-design/` or any tracked file in `gapskris/AuroMind`.
