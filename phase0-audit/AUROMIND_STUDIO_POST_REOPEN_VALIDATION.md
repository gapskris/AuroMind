# AuroMind — Studio Validation Step 2: Post-Reopen Level C Verification Report

- **Audit Date:** 2026-11-18T01:20:30-08:00
- **Audit Mode:** Strictly Read-Only Post-Reopen Verification
- **Applet ID:** `7efc807f-195c-4bf4-b8d7-24228fdeb6d8`
- **Development Preview Origin:** `https://ais-dev-nbq7mkwnyq3d6qm2ktgfpm-366887512459.asia-southeast1.run.app`
- **Expected Recovery Baseline Commit:** `3805f624ce3d63b80278e7fc531f38b1af1b0a5b`
- **Pre-Restart Baseline Reference:** `phase0-audit/AUROMIND_STUDIO_PRE_RESTART_BASELINE.md`

---

## 1. Workspace Identity Verification

1. **Same Imported Workspace Confirmed (Zero Re-Import or Clone Artifacts):**
   - **Applet ID:** `7efc807f-195c-4bf4-b8d7-24228fdeb6d8` (identical to pre-restart baseline).
   - **Preview URL Origin:** `https://ais-dev-nbq7mkwnyq3d6qm2ktgfpm-366887512459.asia-southeast1.run.app` (identical to pre-restart baseline).
   - **Canonical Project Root:** `/app/applet` (`fs.realpathSync(process.cwd()) === "/app/applet"`).
   - **No Old Clone Paths or Nested Repositories:** `/app` contains only `['.dev.pid', 'applet', 'cloud_sql_proxy', 'cloudsql', 'control-plane-api', 'start.sh']`. Zero `.git` folders or nested `AuroMind` directories exist anywhere in `/app`, `/app/applet`, `/tmp`, or `/root`.
   - **GitHub Sync Safety Confirmed:** Reopening the workspace did **not** trigger any automatic Git pull, reset, or force-push, and did not overwrite any compatibility files or audit reports in `/app/applet`.

---

## 2. File Persistence & Hash Verification

### 2.1 Root, Compatibility & Audit Files (`10/10` Present & Byte-for-Byte Identical)

| File Path | Pre-Restart Size | Post-Reopen Size | Pre-Restart SHA-256 | Post-Reopen SHA-256 | Status |
| :--- | :---: | :---: | :--- | :--- | :---: |
| `package.json` | `350 B` | `350 B` | `1a98cb5d521cd0d3788d24a256ab3b77200739e0c75784da4cb561c3d784ca68` | `1a98cb5d521cd0d3788d24a256ab3b77200739e0c75784da4cb561c3d784ca68` | **IDENTICAL** |
| `bun.lock` | `13,862 B` | `13,862 B` | `21ad9ccd9d45f122217e801e45a261cbeb8d4b1f804fa13f0f1f56aaa324f943` | `21ad9ccd9d45f122217e801e45a261cbeb8d4b1f804fa13f0f1f56aaa324f943` | **IDENTICAL** |
| `server.js` | `920 B` | `920 B` | `778b2d1fa3c76df92c6b31e8b546940e11ef4a38a69d1bd13024f09e32e77d05` | `778b2d1fa3c76df92c6b31e8b546940e11ef4a38a69d1bd13024f09e32e77d05` | **IDENTICAL** |
| `server.test.js` | `2,414 B` | `2,414 B` | `cca681ffeff5c9c3182134b34456c79b2df8a78d328b3377416ad6b9b7c0fe59` | `cca681ffeff5c9c3182134b34456c79b2df8a78d328b3377416ad6b9b7c0fe59` | **IDENTICAL** |
| `index.html` | `92,618 B` | `92,618 B` | `5cbfe09a3775425d8b5bf00dfe586f9d7eefe02a9d5d93371589adee3baa1a55` | `5cbfe09a3775425d8b5bf00dfe586f9d7eefe02a9d5d93371589adee3baa1a55` | **IDENTICAL** |
| `assets/js/portal.js` | `26,470 B` | `26,470 B` | `2bf35d83417f4d5d1b6ca649dabd6ff90156ee5af0c692cef6e4b3f2d37d73dd` | `2bf35d83417f4d5d1b6ca649dabd6ff90156ee5af0c692cef6e4b3f2d37d73dd` | **IDENTICAL** |
| `manifest.json` | `479 B` | `479 B` | `b7f298bf6160d0afbf8c3f269f12e3351be3f17b2d9fb7b4a988b0a6c061af8a` | `b7f298bf6160d0afbf8c3f269f12e3351be3f17b2d9fb7b4a988b0a6c061af8a` | **IDENTICAL** |
| `phase0-audit/AUROMIND_FRESH_STUDIO_IMPORT_INTEGRITY_AUDIT.md` | `38,762 B` | `38,762 B` | `d3f0a919c66e742438df8bf0da103f1f327176293ccf0b29e555879ce9efe83f` | `d3f0a919c66e742438df8bf0da103f1f327176293ccf0b29e555879ce9efe83f` | **IDENTICAL** |
| `phase0-audit/AUROMIND_SAFE_GITHUB_HANDOFF_PLAN.md` | `45,310 B` | `45,310 B` | `23f5b170e82354258403fde62463a610582cb471b496a87947a9e774d518dc3e` | `23f5b170e82354258403fde62463a610582cb471b496a87947a9e774d518dc3e` | **IDENTICAL** |
| `phase0-audit/AUROMIND_STUDIO_PRE_RESTART_BASELINE.md` | `28,895 B` | `28,895 B` | `4a7e1bc4427b90153bd400ca2b0e0231a6b84fda1be718624fe347b770110b63` | `4a7e1bc4427b90153bd400ca2b0e0231a6b84fda1be718624fe347b770110b63` | **IDENTICAL** |

### 2.2 Game Directories, 18 Recovered Files, and 29 Protected Compiled Bundles

- **All 6 Game Directories (`6/6`):**
  - `games/vak`: `exists=true`, `6` files (unchanged)
  - `games/auromatch`: `exists=true`, `851` files (unchanged)
  - `games/word-riddle`: `exists=true`, `24` files (unchanged)
  - `games/vak-living-sanctuary`: `exists=true`, `13` files (unchanged)
  - `games/auromandala`: `exists=true`, `14` files (unchanged)
  - `games/auroblocks`: `exists=true`, `19` files (unchanged)
- **All 18 Recovered Files (`18/18`):** Verified `18/18` exact byte size and SHA-256 match against the pre-restart baseline (`AUROMIND_STUDIO_PRE_RESTART_BASELINE.md` Section 2.3) and commit `3805f624ce3d63b80278e7fc531f38b1af1b0a5b`.
- **All 29 Protected Compiled Bundles (`29/29`):** Verified `29/29` exact byte size and SHA-256 match against the pre-restart baseline (`AUROMIND_STUDIO_PRE_RESTART_BASELINE.md` Section 2.4) and commit `3805f624ce3d63b80278e7fc531f38b1af1b0a5b`.

---

## 3. Runtime Recovery Verification

1. **Dependencies Available:**
   - `/app/applet/node_modules` remains intact (`68` entries, `express@4.22.3`).
2. **Automatic Dev Server Restart on Reopen Confirmed:**
   - **Before Reopen (Step 1 Baseline at `09:03 UTC`):** The dev server ran under PID `288` (`npm run dev`, started at `08:46 UTC`) → PID `299` (`sh -c node server.js`) → PID `300` (`node server.js`).
   - **After Reopen (`09:07 UTC`):** When the workspace was closed and reopened at `09:07 UTC`, `/app/control-plane-api/control-plane-api` (`PID 6`) **automatically restarted the dev server process tree**:
     - `/app/.dev.pid`: `414`
     - PID `414`: `npm run dev` (started at `09:07 UTC` by PPID `6`)
     - PID `425`: `sh -c node server.js`
     - PID `426`: `node server.js` (listening on `0.0.0.0:3000`)
   - No duplicate server was started during this verification.
   - *Container Lifecycle Note:* The underlying container instance (`PID 1 /bin/bash ./start.sh`, started at `08:09 UTC`, uptime `1h 02m`) stayed warm during the short close-and-reopen window while the AI Studio control plane cleanly cycled the `npm run dev` process (`PID 288` → `PID 414`).
3. **`/health` Endpoint:**
   - `GET http://localhost:3000/health` → `HTTP 200 OK` (`application/json; charset=utf-8`, `11 B`, body `{"ok":true}`).
4. **`node --test server.test.js`:**
   - **PASS** (`ok 1 - Express static server serves portal, assets, and all live games`, `# tests 1`, `# pass 1`, `# fail 0`, duration `210.51 ms`).
5. **JavaScript Syntax Checks:**
   - `node --check server.js`: **PASS** (exit code `0`).
   - `node --check assets/js/portal.js`: **PASS** (exit code `0`).

---

## 4. Six-Game Verification (HTTP & Interactive Browser Launch)

Both HTTP endpoint checks (`fetch` against `http://localhost:3000`) and interactive headless Chromium browser launches (`playwright-cli`) were executed after reopen:

| # | Game Title | HTTP Entry Point & Core Assets | Interactive Browser Launch (`#game-viewport-iframe`) | Service Worker & CacheStorage State | Status |
| :-: | :--- | :--- | :--- | :--- | :---: |
| **1** | **VAK — The Control of Speech** | `/games/vak/index.html` (`200`, `1,000,624 B`)<br>`/games/vak/sw.js` (`200`, `3,069 B`)<br>`/games/vak/manifest.webmanifest` (`200`, `17,978 B`) | **LAUNCHED** (`src="games/vak/index.html"`, rendered DOM body `173,389` chars) | SW `/games/vak/` `activated`; Cache `auro-vak-v2.18` populated | **PASS** |
| **2** | **AuroMatch — Triple Garden** | `/games/auromatch/index.html` (`200`, `87,928 B`)<br>`/games/auromatch/src/main.js` (`200`, `86,664 B`)<br>`/games/auromatch/src/models/floraDatabase.js` (`200`, `2,002,176 B`)<br>`/games/auromatch/sw.js` (`200`, `2,923 B`) | **LAUNCHED** (`#play-auromatch`, rendered DOM body `87,147` chars) | SW `/games/auromatch/` `activated`; Cache `auro-match-v2.0` populated | **PASS** |
| **3** | **Word Riddle — Discovery** | `/games/word-riddle/index.html` (`200`, `2,139 B`)<br>`/games/word-riddle/assets/index-ClQZWKJi.js` (`200`, `68,216 B`)<br>`/games/word-riddle/sw.js` (`200`, `1,284 B`) | **LAUNCHED** (`src="games/word-riddle/index.html"`, rendered DOM body `3,137` chars) | SW `/games/word-riddle/` `activated`; Cache `word-discovery-shell-v1` populated | **PASS** |
| **4** | **VAK — The Living Sanctuary** | `/games/vak-living-sanctuary/index.html` (`200`, `2,065 B`)<br>`/games/vak-living-sanctuary/assets/index-CUrzyYgb.js` (`200`, `521,880 B`)<br>`/games/vak-living-sanctuary/sw.js` (`200`, `2,594 B`) | **LAUNCHED** (`src="games/vak-living-sanctuary/index.html"`, rendered DOM body `83,836` chars) | SW `/games/vak-living-sanctuary/` `activated`; Caches `workbox-precache-v2-...` & `vak-sanctuary-artwork-v1` populated | **PASS** |
| **5** | **AuroMandala — Mindful Breath** | `/games/auromandala/index.html` (`200`, `1,850 B`)<br>`/games/auromandala/assets/index-DhYVrlzX.js` (`200`, `396,251 B`)<br>`/games/auromandala/sw.js` (`200`, `2,398 B`) | **LAUNCHED** (`src="games/auromandala/index.html"`, rendered DOM body `7,983` chars) | SW `/games/auromandala/` `activated`; Cache `workbox-precache-v2-...` populated | **PASS** |
| **6** | **AuroBlocks — Mindful Geometry** | `/games/auroblocks/index.html` (`200`, `3,955 B`)<br>`/games/auroblocks/assets/index-BLt2QrTp.js` (`200`, `488,553 B`)<br>`/games/auroblocks/sw.js` (`200`, `8,303 B`)<br>`/assets/artwork/hero-sacred-geometry.webp` (`200`, `83,812 B`) | **LAUNCHED** (`src="games/auroblocks/index.html"`, rendered DOM body `32,665` chars) | SW `/games/auroblocks/` `activated`; Cache `auroblocks-v1.5.1` populated | **PASS** |

*(Note: After running the read-only headless Playwright verification, the browser session was closed and the temporary `.playwright-cli/` trace directory was removed so the workspace directory remains completely clean).*

---

## 5. Player Progress & Browser State Assessment

1. **Preview Origin Stability (Host Browser `localStorage`):**
   - The preview origin (`https://ais-dev-nbq7mkwnyq3d6qm2ktgfpm-366887512459.asia-southeast1.run.app`) did **not** change across workspace close and reopen. Because browser `localStorage` is scoped by origin in the user's host browser, all saved progress in the user's browser remains attached to the same origin.
   - *Inspection Boundary:* The Linux container cannot directly read the user's personal Chrome profile on their local machine; within the headless Chromium test session, game initialization confirmed active `localStorage` persistence writes (`auro_vak_events`, `vak_levels_since_surprise`, `pranamandala_game_cache_v2`, `auroblocks_watermark_v1`, `auroblocks_progression_v1`).
2. **Service Worker & CacheStorage State:**
   - All 6 sub-game Service Workers registered and reached `state: "activated"`, creating their expected CacheStorage buckets (`auro-vak-v2.18`, `auro-match-v2.0`, `word-discovery-shell-v1`, `workbox-precache-v2-...`, `vak-sanctuary-artwork-v1`, `auroblocks-v1.5.1`).
   - Zero user caches or progress data were cleared or reset.

---

## 6. Comparison Table: Pre-Restart Baseline vs. Post-Reopen State

| Item | Before Restart (Step 1 Baseline) | After Reopen (Step 2 Verification) | Result | Evidence |
| :--- | :--- | :--- | :---: | :--- |
| **Applet ID & Preview Origin** | `7efc807f-...` / `https://ais-dev-nbq7mkwnyq3d6qm2ktgfpm-366887512459.asia-southeast1.run.app` | `7efc807f-...` / `https://ais-dev-nbq7mkwnyq3d6qm2ktgfpm-366887512459.asia-southeast1.run.app` | **PASS** | Metadata & process environment |
| **Canonical Root & Clone Check** | `/app/applet` (`0` `.git` dirs, `0` nested clones) | `/app/applet` (`0` `.git` dirs, `0` nested clones) | **PASS** | `realpath /app/applet`, `/app` listing |
| **`package.json`** | `350 B` (`1a98cb5d...ca68`) | `350 B` (`1a98cb5d...ca68`) | **PASS** | SHA-256 match |
| **`bun.lock`** | `13,862 B` (`21ad9ccd...943`) | `13,862 B` (`21ad9ccd...943`) | **PASS** | SHA-256 match |
| **`server.js`** | `920 B` (`778b2d1f...7d05`) | `920 B` (`778b2d1f...7d05`) | **PASS** | SHA-256 match |
| **`server.test.js`** | `2,414 B` (`cca681ff...fe59`) | `2,414 B` (`cca681ff...fe59`) | **PASS** | SHA-256 match |
| **`index.html`** | `92,618 B` (`5cbfe09a...1a55`) | `92,618 B` (`5cbfe09a...1a55`) | **PASS** | SHA-256 match |
| **`assets/js/portal.js`** | `26,470 B` (`2bf35d83...73dd`) | `26,470 B` (`2bf35d83...73dd`) | **PASS** | SHA-256 match |
| **`manifest.json`** | `479 B` (`b7f298bf...af8a`) | `479 B` (`b7f298bf...af8a`) | **PASS** | SHA-256 match |
| **Phase 0 Audit Reports** | 3 reports present (`38,762 B`, `45,310 B`, `28,895 B`) | All 3 reports present with identical byte sizes & SHA-256 | **PASS** | Section 2.1 SHA-256 table |
| **Six Game Directories** | `6/6` dirs (`6`, `851`, `24`, `13`, `14`, `19` files) | `6/6` dirs (`6`, `851`, `24`, `13`, `14`, `19` files) | **PASS** | `find games/* -type f \| wc -l` |
| **18 Recovered Files** | `18/18` match commit `3805f624...` | `18/18` match pre-restart baseline & `3805f624...` | **PASS** | `18/18` SHA-256 verification |
| **29 Protected Compiled Bundles** | `29/29` match commit `3805f624...` | `29/29` match pre-restart baseline & `3805f624...` | **PASS** | `29/29` SHA-256 verification |
| **Dependencies (`node_modules`)** | `68` entries (`express@4.22.3`) | `68` entries (`express@4.22.3`) | **PASS** | `node_modules/express/package.json` |
| **Dev Server Process (`npm run dev`)** | Running (PID `288` → `300`, started `08:46 UTC`) | Automatically restarted on reopen (PID `414` → `426`, started `09:07 UTC`) | **PASS** | `/app/.dev.pid`, `ps -eo pid,ppid,stime,args` |
| **`/health` Endpoint** | `HTTP 200 OK` (`{"ok":true}`) | `HTTP 200 OK` (`{"ok":true}`) | **PASS** | Live HTTP fetch |
| **`node --test server.test.js`** | `1/1 pass` (`210.14 ms`) | `1/1 pass` (`210.51 ms`) | **PASS** | Test runner exit code `0` |
| **`node --check` Syntax Checks** | `server.js` PASS, `portal.js` PASS | `server.js` PASS, `portal.js` PASS | **PASS** | `node --check` exit code `0` |
| **All 6 Games HTTP & Interactive Launch** | `25/25` HTTP `200 OK`; `6/6` launch | `25/25` HTTP `200 OK`; `6/6` launch interactively in `#game-viewport-iframe` | **PASS** | Section 4 HTTP + Playwright verification |
| **Service Workers & Caches** | `6/6` game SWs & caches verified | `6/6` game SWs `activated` & `7` cache buckets populated | **PASS** | `navigator.serviceWorker.getRegistrations()`, `caches.keys()` |

- **Missing files:** `0`
- **Changed hashes:** `0`
- **Startup failures:** `0`
- **Data loss:** `0`

---

## 7. Final Verdict

**LEVEL C PASS WITH LIMITATIONS**

*(All file persistence checks, hash comparisons across all 987 original files / 18 recovered files / 29 compiled bundles / 4 compatibility files / 3 audit reports, automatic dev server restart `PID 288 → PID 414`, `/health` checks, `server.test.js`, HTTP checks, and interactive browser launches of all 6 games passed 100%. The verdict is recorded as `LEVEL C PASS WITH LIMITATIONS` rather than unconditional pass strictly to document three transparent technical boundaries: (1) the underlying container VM `PID 1` remained warm during the brief close/reopen interval while `control-plane-api` cycled `npm run dev`, (2) the user's host browser `localStorage` resides on the client machine outside the container shell and is verified via unchanged preview origin URL + headless browser storage tests, and (3) the pre-existing upstream offline Service Worker limitations from commit `3805f624ce3d63b80278e7fc531f38b1af1b0a5b` remain untouched pending approved remediation).*

### Explicit Non-Modification Confirmation
- **No** application source files, portal files, game files, corpus datasets, or protected compiled bundles were modified, deleted, or renamed.
- **No** runtime compatibility files (`package.json`, `bun.lock`, `server.js`, `server.test.js`) were modified.
- **No** user progress data, `localStorage`, `IndexedDB`, or Service Worker caches in the user's browser were reset or modified.
- **No** Git commands or GitHub synchronization actions were executed.
- Only `phase0-audit/AUROMIND_STUDIO_POST_REOPEN_VALIDATION.md` was created to record this verification.
