# Batch B0 — Regression Validation Report

- **Programme:** AuroMind Platform Modernization
- **Batch:** B0 — Repository File-Budget & Documentation Safety
- **Repository / Branch:** `gapskris/AuroMind` (`dev/studio-integration`, canonical baseline `67d04726fb82cdb3d9f253bd36e627fe0d7aef20`)
- **Final Tracked-Candidate File Count:** **`970`** (Target: `≤ 990`; Margin: `−20` vs. target, `−30` vs. `1,000` AI Studio import ceiling)
- **Overall Result:** **PASS (0 regressions, 0 missing assets, 12/12 protected baseline hashes preserved byte-for-byte)**

---

## 1. Automated Build, Lint & Security Test Results

| Check | Command / Tool | Result | Details |
|---|---|---|---|
| **Build (`npm run build`)** | `compile_applet` (`node -e "console.log('Static site ready')"`) | **PASS** | Static site build verified clean |
| **Lint (`npm run lint`)** | `lint_applet` (`node --check server.js && node --check assets/js/portal.js`) | **PASS** | Zero syntax or import errors |
| **Server Security & Route Suite** | `node --test server.test.js` | **PASS** | `1/1` passed (`0` failed, `717 ms`): verifies portal, assets, all 6 live games, and AURO-33 blocking rules |
| **Live HTTP Endpoint Verification** | 20 live `GET` probes against `http://127.0.0.1:3000` | **PASS (20/20)** | See §4 |

---

## 2. File-Budget & Cleanup Verification

| Metric | Value | Status |
|---|---:|---|
| Pre-Batch B0 tracked candidates | `1,001` | Baseline |
| Verified zero-reference exact duplicates removed | `−35` | `54,058,611` bytes (`51.55 MiB`) freed |
| Preserved SHA-256 identical twins verified intact post-cleanup | `35 / 35` | `0` unique bytes lost |
| New Batch B0 deliverables added (`architecture-design/B0_*.md`) | `+4` | Included in tracked total |
| **Final Post-B0 tracked candidates** | **`970`** | **PASS (`≤ 990`)** |
| Untracked `bun.lock` (`13,862 B`) | Unmodified | Excluded from tracked count; documented in `B0_FILE_INVENTORY.md` |
| Ignored `.playwright-cli/` (5 files) | Unmodified | Ignored via `.gitignore:15` |

---

## 3. Protected Baseline & Frozen Documentation SHA-256 Verification (`12 / 12` Exact Match)

Every canonical root file, historical archive, explicitly excluded prototype, and all 7 frozen architecture design documents remain byte-for-byte identical:

| File | Size (Bytes) | Verified SHA-256 | Match |
|---|---:|---|---|
| `server.js` | 2,127 | `da3ede915d1ed754f92a7fcb391f746c984e1c15025c4814b3ba0c3c3c53b1ca` | EXACT |
| `server.test.js` | 3,342 | `33de41ed2f8c412ff69d43ab3585d87e8350fc72b730bb4b19e8e27737e889ab` | EXACT |
| `sw.js` | 7,938 | `69b66b55f6268fea6449aef563f2394b7bfc4e244e92ae43c0749eeb4122ee15` | EXACT |
| `phase0-audit/ARCHIVE.md` | 283,745 | `a01afe7d1454cb4245bc05eb4fc01444cf30980893fc37f2b98f14627c03c0a7` | EXACT |
| `games/auromatch/AuroMatch_Web_Prototype.html` | 87,843 | `a7d31aadba46f45716d06a3c73a6bfb2680a6da5ccf1464f2a7b71b01d03c777` | EXACT |
| `architecture-design/ARCHITECTURE_CORRECTIONS.md` | 18,542 | `77d7df410ccdf9009aa271162c186d4d81002a8cd40e98709683a7eedc0d5c62` | EXACT |
| `architecture-design/TARGET_ARCHITECTURE.md` | 15,864 | `5111d201a65d175fca24b8ba578e2ae77f0e4238d6955a8eb725648f45b76c65` | EXACT |
| `architecture-design/SHARED_SDK_CONTRACTS.md` | 14,391 | `79c844d5da0e90cceae3489399a41f21c0d4e28a1d4592c0207ee9c3e00a373a` | EXACT |
| `architecture-design/SUPABASE_DESIGN.md` | 14,249 | `46ff6045f3ad437749d5f66224fe1187fdf970387df7dc053134494436907346` | EXACT |
| `architecture-design/PRODUCT_INTEGRATION_MATRIX.md` | 15,168 | `c78b0ca6d8b46c03ea8cd5c8b408d5f7f5dd42599d36ace01856df8dc0314949` | EXACT |
| `architecture-design/IMPLEMENTATION_BATCH_PLAN.md` | 12,916 | `4899fa07771ee3a77e3ba9029ee70eff3b52d7d9a94c8f4a9f86aa4d4ca2cac5` | EXACT |
| `architecture-design/OPEN_DECISIONS.md` | 6,431 | `00c4242d99192c9b84c3b6fc3eaa1cc5c26bf3f7b601f8d6f7fb78a9b2fd3bd8` | EXACT |

---

## 4. Service Workers, Game Assets & Live Route Integrity

### 4.1 Service Worker Precache & Theme Background Integrity
- **Root Portal `sw.js` (`PORTAL_SHELL_ASSETS`):** `54 / 54` precache entries verified present on disk (`missing = 0`). Strict `/games/*` isolation preserved untouched.
- **AuroMatch `games/auromatch/sw.js` (`ASSETS_TO_CACHE`):** `28 / 28` precache entries verified present on disk (`missing = 0`).
- **AuroMatch Active `REALMS` Backgrounds (`themeManager.js`):** `40 / 40` referenced `mockupImage` and `bgImage` paths verified present on disk (`missing = 0`).

### 4.2 All Six Games — Entry Points, Manifests, Service Workers & Protected Corpora
| Game | Entry (`index.html`) | Manifest | Service Worker (`sw.js`) | Primary Corpus / Bundle Verified |
|---|---|---|---|---|
| VAK Speech Control (`games/vak/`) | Present | Present | Present | `games/vak/index.html` (`1,000,413 B`, `04034bd881a478cd...`) |
| AuroMatch (`games/auromatch/`) | Present | Present | Present | `games/auromatch/src/models/floraDatabase.js` (`2,002,176 B`, `689d035cd52abd8d...`) |
| Word Riddle (`games/word-riddle/`) | Present | Present | Present | `games/word-riddle/index.html` (`909 B`, `dbe68a5bac059ab8...`) |
| VAK Living Sanctuary (`games/vak-living-sanctuary/`) | Present | Present | Present | `games/vak-living-sanctuary/assets/index-CUrzyYgb.js` (`521,880 B`, `f851ec703259c1e6...`) |
| AuroMandala (`games/auromandala/`) | Present | Present | Present | `games/auromandala/assets/index-DhYVrlzX.js` (`396,251 B`, `aa043f4d4d39e979...`) |
| AuroBlocks (`games/auroblocks/`) | Present | Present | Present | `games/auroblocks/index.html` (`7,315 B`, `2985732537e0731e...`) |

### 4.3 Live Server Probes (`http://127.0.0.1:3000` — `20 / 20` Passed)
- **Expected `200 OK` (13/13 passed):** `/health`, `/`, `/manifest.json`, `/sw.js`, `/assets/js/portal.js`, `/assets/css/portal.css`, `/games/vak/`, `/games/auromatch/`, `/games/auromatch/sw.js`, `/games/word-riddle/`, `/games/vak-living-sanctuary/`, `/games/auromandala/`, `/games/auroblocks/`.
- **Expected `404 Not Found` (7/7 passed):** `/phase0-audit/ARCHIVE.md`, `/server.js`, `/server.test.js`, `/package.json`, `/bun.lock`, `/.gitignore`, `/README.md`.
- **Documented Exposure Observation (not modified in B0):** `/architecture-design/*.md` currently returns `200 OK` on local `server.js` (and will return `200 OK` on static GitHub Pages after merge to `main`); see `B0_DOCUMENTATION_EXPOSURE_REVIEW.md` for approved remediation options.

---

## 5. Scope & Prohibition Compliance Checklist

- [x] Shared SDK **NOT** created or implemented
- [x] Game code, storage schemas, service workers, and compiled bundles **NOT** modified
- [x] Supabase **NOT** configured or provisioned
- [x] `games/auromatch/AuroMatch_Web_Prototype.html` **NOT** removed or modified
- [x] All 7 original `architecture-design/*.md` documents **NOT** modified
- [x] Zero Git commits, pushes, merges, force-pushes, syncs, or deployments performed
- [x] Stopped cleanly after Batch B0 completion awaiting explicit approval for Batch B1
