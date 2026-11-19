# AuroMind — Recovery Step 5 & 6: Safe GitHub Handoff Plan (Revised)

- **Document Version:** 2.0 (Recovery Step 6 Revision)
- **Date:** 2026-11-18
- **Mode:** Strictly Read-Only Architecture & Handoff Planning (Zero Git or GitHub mutations executed)
- **Target Repository:** `https://github.com/gapskris/AuroMind.git`
- **Protected Recovery Branch:** `recovery/phase1-batch1-2-checkpoint`
- **Protected Recovery Commit:** `3805f624ce3d63b80278e7fc531f38b1af1b0a5b`
- **Original `main` Baseline Commit:** `0366de23fba6301622432ee08569382218a5c854`

---

## 1. Execution Status Ledger: Completed vs. Pending Actions

To prevent ambiguity between read-only audits already performed inside Google AI Studio and external Git/GitHub operations that have **not yet been executed**, the table below records the exact current state:

| Phase / Item | Current Status | Evidence / Notes |
| :--- | :---: | :--- |
| **AI Studio Import & Runtime Compatibility Setup** | **COMPLETED (In Studio Container Only)** | `package.json`, `bun.lock`, `server.js`, and `server.test.js` exist in `/app/applet`. All 987 imported files remain untouched. |
| **Step 4: Read-Only Import Integrity Audit** | **COMPLETED** | Recorded in `/phase0-audit/AUROMIND_FRESH_STUDIO_IMPORT_INTEGRITY_AUDIT.md`. Verified 987/987 files, 18/18 recovered files, and 29/29 compiled bundles match commit `3805f624ce3d63b80278e7fc531f38b1af1b0a5b` (SHA-1 & SHA-256). |
| **Step 5 & 6: Safe GitHub Handoff Plan Document** | **COMPLETED (This Document)** | Saved at `/phase0-audit/AUROMIND_SAFE_GITHUB_HANDOFF_PLAN.md`. Zero Git or GitHub write operations performed. |
| **Mandatory Step 1: Protect `recovery/phase1-batch1-2-checkpoint` on GitHub** | **PENDING (User Action Required)** | GitHub API currently reports `"protected": false` on `recovery/phase1-batch1-2-checkpoint`. |
| **Mandatory Step 2: Create & Protect Annotated Backup Tag `checkpoint/phase1-batch1-2`** | **PENDING (User Action Required)** | Tag does not yet exist on GitHub. |
| **Mandatory Step 3: Merge Verified Recovery Checkpoint into `main` (No Force Push)** | **PENDING (User Action Required)** | Remote `main` is still at `0366de23fba6301622432ee08569382218a5c854`. |
| **Mandatory Step 4: Restore `main` as GitHub's Default Branch & Protect `main`** | **PENDING (User Action Required)** | Remote `default_branch` must be confirmed/restored to `main` and protected (`"protected": false` currently). |
| **Mandatory Step 5: Validate AI Studio Workspace Restart & Reopen Reliability (Levels A, B, C)** | **PARTIAL — LEVEL C PENDING** | Level A (server restart) and Level B (browser refresh/game relaunch) verified in active container; **Level C (full AI Studio workspace close & cold reopen) is UNVERIFIED** and must be completed before remediation begins. |
| **Mandatory Step 6: Create `dev/studio-integration` from Verified, Updated `main`** | **PENDING (User Action Required)** | Must only be created after `main` is updated to `3805f624ce3d63b80278e7fc531f38b1af1b0a5b` and verified. |
| **Mandatory Step 7: Controlled ZIP Transfer of 4 Compatibility Files + 2 Audit Reports to `dev/studio-integration`** | **PENDING (User Action Required)** | Must only target `dev/studio-integration`, never `recovery/phase1-batch1-2-checkpoint` or the initial recovery merge to `main`. |
| **Mandatory Step 8: Begin Approved Remediation Batches on `dev/studio-integration`** | **PENDING (Blocked on Steps 1–7)** | Strictly blocked until Steps 1–7 pass all verification gates and receive explicit user sign-off. |
| **Mandatory Step 9: Promote Reviewed Work to `main` via Pull Requests** | **PENDING (Future Phase)** | Occurs after remediation batches are verified on `dev/studio-integration`. |

---

## 2. Complete Workspace File Inventory & Compatibility File Assessment

### 2.1 Workspace Inventory (Categories A–E)

Every file currently in `/app/applet` falls into one of five categories:

#### Category A — Original GitHub Recovery Files (`987` files, `0` modified)
All 987 files imported from `gapskris/AuroMind` @ `3805f624ce3d63b80278e7fc531f38b1af1b0a5b` (`recovery/phase1-batch1-2-checkpoint`) are 100% byte-for-byte identical to the recovery commit:

| Subtree / Path | File Count | Complete Path Breakdown & Description |
| :--- | :---: | :--- |
| **Root Portal Files** | `4` | `/.gitignore` (120 B)<br>`/README.md` (2,003 B)<br>`/index.html` (92,618 B — Master AuroMind Portal)<br>`/manifest.json` (479 B — Portal PWA Manifest) |
| **Portal Assets (`/assets/`)** | `56` | **CSS (`1`):** `/assets/css/portal.css` (36,175 B)<br>**JS (`1`):** `/assets/js/portal.js` (26,470 B)<br>**Icons (`10`):** `/assets/icons/{auroblocks-logo,auromandala-logo,auromatch-logo,auromind-logo,logic-logo,mahjong-logo,merge-logo,vak-logo,vak-sanctuary-logo,wordriddle-logo}.svg`<br>**Thumbnails (`44`):** `/assets/thumbnails/{01_stillwater.png, 02_living_terrarium.png, 03_pattern_and_petal.jpg, 04_the_quiet_eye.png, 05_chords_of_calm.png, 06_lux.jpg, 07_hue_and_harmony.png, 08_living_tributary.png, 09_windborn.png, 10_starlight_origami.png, auroblocks-gameplay.webp, auroblocks.jpg, auroblocks.webp, auromandala.jpg, auromandala.png, auromatch.jpg, auromatch.png, block_puzzle.png, logic_riddles.jpg, logic_riddles.png, mahjong_zen.jpg, match3_puzzle.jpg, merge_games.png, sanctuary_merge.jpg, strat_01_chronostasis.png .. strat_16_pranamirror.png, vak.png, vak_living_sanctuary.jpg, wordriddle.jpg, wordriddle.png}` |
| **Game 1: VAK (`/games/vak/`)** | `6` | `/games/vak/index.html` (1,000,624 B — Single-file app + 1,368-level corpus)<br>`/games/vak/manifest.json` (17,970 B)<br>`/games/vak/manifest.webmanifest` (17,978 B)<br>`/games/vak/sw.js` (3,069 B)<br>`/games/vak/icon-192.png`<br>`/games/vak/icon-512.png` |
| **Game 2: AuroMatch (`/games/auromatch/`)** | `851` | `/games/auromatch/index.html` (87,928 B)<br>`/games/auromatch/AuroMatch_Web_Prototype.html` (87,843 B)<br>`/games/auromatch/favicon.ico`<br>`/games/auromatch/manifest.json` (924 B)<br>`/games/auromatch/sw.js` (2,923 B)<br>`/games/auromatch/styles/main.css` (159,045 B)<br>**Source Modules (`12`):** `/games/auromatch/src/main.js`, `/games/auromatch/src/audio/synthesizer.js`, `/games/auromatch/src/controllers/{entitlementManager,gameManager,inputDispatcher,settings,storageAdapter,themeManager}.js`, `/games/auromatch/src/models/{boardGenerator,floraDatabase}.js` (`floraDatabase.js` = 2,002,176 B), `/games/auromatch/src/ui/{boardRenderer,constellation,particles,scriptureCard}.js`<br>**Botanical & Icon Assets (`833`):** `/games/auromatch/Assets/icons/*` and `/games/auromatch/Assets/flowers/*` |
| **Game 3: Word Riddle (`/games/word-riddle/`)** | `24` | `/games/word-riddle/index.html` (2,139 B)<br>`/games/word-riddle/manifest.webmanifest` (403 B)<br>`/games/word-riddle/sw.js` (1,284 B)<br>`/games/word-riddle/icon.svg`<br>**Compiled Vite Assets (`20`):** `/games/word-riddle/assets/index-ClQZWKJi.js`, `/games/word-riddle/assets/index-w4eIMPyb.css`, `/games/word-riddle/assets/vendor-Bb8JjhAW.js`, `/games/word-riddle/assets/vendor-data-ukx0zKqE.js`, `/games/word-riddle/assets/vendor-react-BohcAXVY.js`, and 15 theme bundles `/games/word-riddle/assets/theme-th01-XkqLvUYb.js` through `theme-th15-DRqodAya.js` |
| **Game 4: VAK — The Living Sanctuary (`/games/vak-living-sanctuary/`)** | `13` | `/games/vak-living-sanctuary/index.html` (2,065 B)<br>`/games/vak-living-sanctuary/manifest.webmanifest` (636 B)<br>`/games/vak-living-sanctuary/registerSW.js` (686 B)<br>`/games/vak-living-sanctuary/sw.js` (2,594 B)<br>`/games/vak-living-sanctuary/offline-shell-sw.js` (3,322 B)<br>`/games/vak-living-sanctuary/workbox-63c18b4d.js` (22,770 B)<br>`/games/vak-living-sanctuary/assets/index-CUrzyYgb.js` (521,880 B)<br>`/games/vak-living-sanctuary/assets/index-Dw9BQKWO.css` (111,759 B)<br>**Icons (`5`):** `/games/vak-living-sanctuary/{icon.svg,apple-touch-icon.png,pwa-192x192.png,pwa-512x512.png,pwa-maskable-512x512.png}` |
| **Game 5: AuroMandala (`/games/auromandala/`)** | `14` | `/games/auromandala/index.html` (1,850 B)<br>`/games/auromandala/manifest.webmanifest` (661 B)<br>`/games/auromandala/registerSW.js` (136 B)<br>`/games/auromandala/sw.js` (2,398 B)<br>`/games/auromandala/workbox-835c8c05.js` (21,863 B)<br>`/games/auromandala/assets/index-DhYVrlzX.js` (396,251 B)<br>`/games/auromandala/assets/index-MfgMt68V.css` (40,329 B)<br>`/games/auromandala/assets/aistudio/{image_22cc95c6.png,image_b342a4e7.png}`<br>**Icons (`5`):** `/games/auromandala/{icon.svg,apple-touch-icon.png,pwa-192x192.png,pwa-512x512.png,pwa-maskable-512x512.png}` |
| **Game 6: AuroBlocks (`/games/auroblocks/`)** | `19` | `/games/auroblocks/index.html` (3,955 B)<br>`/games/auroblocks/manifest.webmanifest` (1,114 B)<br>`/games/auroblocks/precache-manifest.json` (143 B)<br>`/games/auroblocks/sw.js` (8,303 B)<br>**Compiled Vite Assets (`3`):** `/games/auroblocks/assets/{index-BLt2QrTp.js,index-Ccfp-y1N.css,web-BbouHfjM.js}`<br>**Artwork (`4`):** `/games/auroblocks/assets/artwork/{hero-sacred-geometry,mode-classic-flow,mode-sacred-journey,mode-sacred-sudoku}.webp`<br>**Fonts (`3`):** `/games/auroblocks/assets/fonts/{cinzel-latin,jetbrains-mono-latin,plus-jakarta-sans-latin}.woff2`<br>**Icons (`5`):** `/games/auroblocks/{icon.svg,apple-touch-icon.png,pwa-192x192.png,pwa-512x192.png,pwa-maskable-512x512.png}` |

#### Category B — Required Google AI Studio Compatibility Files (`4` files)
*Note: These 4 files must **NOT** be included when merging `recovery/phase1-batch1-2-checkpoint` into `main` (Step 3). They are transferred **only** to `dev/studio-integration` in Step 7.*

| File Path | Size | SHA-256 | Role in AI Studio & GitHub Pages Disposition |
| :--- | :---: | :--- | :--- |
| `/package.json` | 350 B | `1a98cb5d521cd0d3788d24a256ab3b77200739e0c75784da4cb561c3d784ca68` | Required for AI Studio `bun install`, `npm run dev`, `npm run build`, and `npm run lint`. Retain on `dev/studio-integration`; exclude from production GitHub Pages artifact if deploying via Actions. |
| `/bun.lock` | 13,862 B | `21ad9ccd9d45f122217e801e45a261cbeb8d4b1f804fa13f0f1f56aaa324f943` | Lockfile pinning `express@4.22.3`. Retain on `dev/studio-integration`; exclude from production GitHub Pages artifact. |
| `/server.js` | 920 B | `778b2d1fa3c76df92c6b31e8b546940e11ef4a38a69d1bd13024f09e32e77d05` | Express server on `0.0.0.0:3000` with `/assets/artwork` alias and `/health` check. Retain on `dev/studio-integration` (and harden in a future approved batch so it does not serve `/server.js` or `/package.json` over HTTP). |
| `/server.test.js` | 2,414 B | `cca681ffeff5c9c3182134b34456c79b2df8a78d328b3377416ad6b9b7c0fe59` | Node `node:test` verification suite. Retain on `dev/studio-integration`; exclude from production GitHub Pages artifact. |

#### Category C — Generated Runtime Files and Directories (Strictly Excluded from Git)
- `/node_modules/` (~2.5 MB, 66 directories) — Installed npm packages. Never transfer or commit.
- `/.aistudio/` (~748 KB, 5 PNG screenshots in `/.aistudio/artifacts/brain/7efc807f-195c-4bf4-b8d7-24228fdeb6d8/.tempmediaStorage/`) — AI Studio internal artifacts. Never transfer or commit.
- `/.playwright-cli/` (ephemeral browser automation logs/traces) — Never transfer or commit.

#### Category D — Audit Reports and Evidence (`2` files)
*Note: Transferred **only** to `dev/studio-integration` in Step 7, never included in the Step 3 recovery merge to `main`.*
- `/phase0-audit/AUROMIND_FRESH_STUDIO_IMPORT_INTEGRITY_AUDIT.md` (38,762 B)
- `/phase0-audit/AUROMIND_SAFE_GITHUB_HANDOFF_PLAN.md` *(this revised document)*

#### Category E — Any Other Files Created After Import
- **None (`0` files).**

---

## 3. Mandatory 9-Step End-to-End Workflow Sequence

All operations below follow the strict agreed sequence. **Do not skip steps or reorder phases.**

```
[Step 1: Protect recovery/phase1-batch1-2-checkpoint on GitHub]
       │
       ▼
[Step 2: Create, Push & Protect Annotated Tag checkpoint/phase1-batch1-2 -> 3805f624...]
       │
       ▼
[Step 3: Pre-Merge Verification -> Merge Recovery Checkpoint into main (NO Force Push, NO Studio Files)]
       │
       ▼
[Step 4: Restore main as Default Branch on GitHub & Protect main]
       │
       ▼
[Step 5: Validate AI Studio Workspace Restart & Reopen Reliability (Levels A, B, and C)]
       │
       ▼
[Step 6: Create dev/studio-integration from Verified, Updated main (3805f624...)]
       │
       ▼
[Step 7: Controlled ZIP Transfer of 4 Compatibility Files + 2 Audit Reports to dev/studio-integration]
       │
       ▼
[Step 8: Execute Approved Remediation Batches on dev/studio-integration]
       │
       ▼
[Step 9: Promote Completed & Reviewed Work to main via Pull Requests]
```

---

## 4. Detailed Phase Procedures, GitHub Protections, and Verification Gates

### STEP 1 — Protect the Existing Recovery Checkpoint on GitHub

- **Target Branch:** `recovery/phase1-batch1-2-checkpoint`
- **Expected Commit:** `3805f624ce3d63b80278e7fc531f38b1af1b0a5b`
- **Expected Parent:** `0366de23fba6301622432ee08569382218a5c854`

#### 1.1 Pre-Operation Check (Local Terminal)
```bash
git clone https://github.com/gapskris/AuroMind.git
cd AuroMind
git fetch --all --prune --tags

# Verify remote recovery branch head and its parent commit:
git rev-parse origin/recovery/phase1-batch1-2-checkpoint
# MUST output: 3805f624ce3d63b80278e7fc531f38b1af1b0a5b

git rev-parse origin/recovery/phase1-batch1-2-checkpoint^1
# MUST output: 0366de23fba6301622432ee08569382218a5c854
```

#### 1.2 GitHub UI Steps to Protect `recovery/phase1-batch1-2-checkpoint`
1. Open `https://github.com/gapskris/AuroMind/settings/rules` (Repository Rulesets — preferred on modern GitHub) or `https://github.com/gapskris/AuroMind/settings/branches` (Classic Branch Protection).
2. Create a rule targeting exact branch name `recovery/phase1-batch1-2-checkpoint`:
   - **Block force pushes:** Enabled (Classic: leave *"Allow force pushes"* **UNCHECKED**; Rulesets: check **"Block force pushes"**).
   - **Restrict deletions:** Enabled (Classic: leave *"Allow deletions"* **UNCHECKED**; Rulesets: check **"Restrict deletions"**).
   - **Lock branch (Read-Only):**
     - In Classic Branch Protection: check **"Lock branch"** (*"Branch is read-only. Users cannot push to the branch."*).
     - In Repository Rulesets: check **"Restrict updates"** (prevents any new commits from being pushed to the ref).
   - **Bypass / Admin Enforcement:**
     - In Classic Branch Protection: check **"Do not allow bypassing the above settings"** so repository administrators are also protected against accidental force pushes from connected OAuth apps (including Google AI Studio).
     - In Repository Rulesets: leave the **Bypass list** empty.

#### 1.3 GitHub Plan & Repository-Setting Limitations (Important)
- **Public vs. Private Repository Availability:** `gapskris/AuroMind` is currently a **public** repository (`"private": false`), where GitHub Free supports both Classic Branch Protection Rules and Repository Rulesets (for branches and tags). **Limitation:** If the repository is ever converted to a **private** repository under a personal **GitHub Free** account, GitHub disables enforcement of branch protection rules and rulesets until the account is upgraded to GitHub Pro/Team or the repo remains public.
- **Repository Owner Bypass Caveat:** Even when *"Do not allow bypassing"* is enabled, a repository owner can still manually edit settings in the GitHub UI, and certain GitHub App / OAuth tokens with `repo` admin scope could potentially fail only if the rule explicitly applies to admins. Therefore, technical branch protection **must** be paired with the operational rule: **Never click "Force push to `gapskris/AuroMind`" in the Google AI Studio GitHub panel.**

#### 1.4 Post-Operation Verification Gate (Step 1)
```bash
curl -s https://api.github.com/repos/gapskris/AuroMind/branches/recovery/phase1-batch1-2-checkpoint | grep -E '"name"|"sha"|"protected"'
```
- **Pass Criteria:** `"sha"` is `"3805f624ce3d63b80278e7fc531f38b1af1b0a5b"` and `"protected"` is `true` (or confirmed active in `settings/rules`).
- **APPROVAL CHECKPOINT 1:** Confirm `recovery/phase1-batch1-2-checkpoint` protection is active before proceeding to Step 2.

---

### STEP 2 — Create, Verify, and Protect the Annotated Backup Tag

- **Tag Name:** `checkpoint/phase1-batch1-2`
- **Target Commit:** `3805f624ce3d63b80278e7fc531f38b1af1b0a5b`

#### 2.1 GitHub Tag Protection Setup (Before or Immediately Upon Pushing Tag)
To protect `checkpoint/phase1-batch1-2` against accidental deletion or movement (`git push --force origin refs/tags/...`):
1. Navigate to `https://github.com/gapskris/AuroMind/settings/rules` → **New ruleset** → **New tag ruleset**.
2. Set **Ruleset Name:** `Protect Recovery Checkpoint Tags`.
3. Set **Enforcement status:** `Active` (leave Bypass list empty so even the repo owner cannot overwrite/delete the tag without first disabling the ruleset).
4. Under **Target tags**, click **Add target** → **Include by pattern** → enter `checkpoint/*` (or `checkpoint/phase1-batch1-2`).
5. Under **Tag rules**, enable:
   - **Restrict deletions** (prevents `git push --delete origin checkpoint/phase1-batch1-2`).
   - **Block force pushes** (prevents moving the tag to a different commit).
   - *(Note: Do **not** check "Restrict creations" until **after** you push the tag in Step 2.2, or check "Restrict updates" + "Restrict deletions" + "Block force pushes" now so initial creation is allowed while any subsequent modification or deletion is blocked).*
   - *GitHub Limitation Note:* GitHub abolished the legacy "Protected Tags" settings page in favor of **Repository Rulesets targeting tags**. Tag rulesets are supported on public repositories on GitHub Free, and on private repositories with GitHub Pro/Team/Enterprise.

#### 2.2 Create and Push the Annotated Tag Locally
```bash
# Verify target commit and parent before tagging:
git cat-file -p 3805f624ce3d63b80278e7fc531f38b1af1b0a5b

# Create annotated tag pointing explicitly to 3805f624ce3d63b80278e7fc531f38b1af1b0a5b:
git tag -a checkpoint/phase1-batch1-2 3805f624ce3d63b80278e7fc531f38b1af1b0a5b \
  -m "Immutable Phase 1 Batch 1.2 recovery checkpoint (commit 3805f624ce3d63b80278e7fc531f38b1af1b0a5b, parent 0366de23fba6301622432ee08569382218a5c854)"

# Push tag to GitHub:
git push origin refs/tags/checkpoint/phase1-batch1-2
```
*(Optional hardening after push: edit the Tag Ruleset on GitHub to also enable **"Restrict creations"** on `checkpoint/phase1-batch1-2` so even if someone tried to recreate it, creation is locked.)*

#### 2.3 Post-Operation Verification Gate (Step 2)
```bash
git fetch origin --tags
git show-ref --tags -d | grep "checkpoint/phase1-batch1-2"
# MUST show two lines:
# <tag-object-sha> refs/tags/checkpoint/phase1-batch1-2
# 3805f624ce3d63b80278e7fc531f38b1af1b0a5b refs/tags/checkpoint/phase1-batch1-2^{}

git rev-parse checkpoint/phase1-batch1-2^{commit}
# MUST output: 3805f624ce3d63b80278e7fc531f38b1af1b0a5b
```
- **APPROVAL CHECKPOINT 2:** Confirm `checkpoint/phase1-batch1-2^{commit}` resolves to `3805f624ce3d63b80278e7fc531f38b1af1b0a5b` and tag ruleset is active before proceeding to Step 3.

---

### STEP 3 — Merge the Verified Recovery Checkpoint into `main` (Without Force-Pushing)

- **Strict Scope Rule:** This merge brings `main` up to the exact verified recovery checkpoint (`3805f624ce3d63b80278e7fc531f38b1af1b0a5b`). **Do NOT include `package.json`, `bun.lock`, `server.js`, `server.test.js`, `phase0-audit/*`, or any remediation edits in this merge.**

#### 3.1 Pre-Merge Verification Gate (Mandatory Ancestry & Diff Checks)
Do **not** assume a fast-forward merge is possible without running these exact checks first:

```bash
git fetch origin --prune --tags

# 1. Verify remote main HEAD:
git rev-parse origin/main
# Expected: 0366de23fba6301622432ee08569382218a5c854

# 2. Verify remote recovery branch HEAD:
git rev-parse origin/recovery/phase1-batch1-2-checkpoint
# Expected: 3805f624ce3d63b80278e7fc531f38b1af1b0a5b

# 3. Verify recovery commit's parent(s):
git log -n 1 --pretty=format:"Commit: %H%nParents: %P%nSubject: %s%n" origin/recovery/phase1-batch1-2-checkpoint
# Expected:
# Commit: 3805f624ce3d63b80278e7fc531f38b1af1b0a5b
# Parents: 0366de23fba6301622432ee08569382218a5c854

# 4. Programmatically test whether origin/main is an ancestor of the recovery commit:
if git merge-base --is-ancestor origin/main origin/recovery/phase1-batch1-2-checkpoint; then
  echo "ANCESTRY CHECK PASSED: origin/main IS a direct ancestor of recovery/phase1-batch1-2-checkpoint (Fast-Forward possible)."
else
  echo "WARNING: origin/main is NOT a direct ancestor. Fast-forward is NOT possible."
fi

# 5. Check for any unexpected commits on either side:
git log --oneline --left-right origin/main...origin/recovery/phase1-batch1-2-checkpoint
# Expected: exactly 1 right-side commit (> 3805f62 ...) and 0 left-side (<) commits.

# 6. Inspect the exact file list changed between origin/main and the recovery commit:
git diff --name-status origin/main..origin/recovery/phase1-batch1-2-checkpoint
# Expected: Only the 18 recovered files (no Studio compatibility files, no unexpected deletions).
```

#### 3.2 Merge Execution Procedure (Case A vs. Case B)

- **Case A — Fast-Forward Merge IS Possible (Expected when `origin/main` = `0366de23...`):**
  ```bash
  git checkout main
  git reset --hard origin/main
  git status --short
  # MUST be completely empty (clean working tree, no untracked Studio files present)

  # Execute strict fast-forward merge:
  git merge --ff-only origin/recovery/phase1-batch1-2-checkpoint

  # Verify local main now points to the exact recovery commit:
  git rev-parse HEAD
  # MUST output: 3805f624ce3d63b80278e7fc531f38b1af1b0a5b

  # Push to origin/main WITHOUT --force:
  git push origin main
  ```

- **Case B — Fallback Procedure If Fast-Forward Is NOT Possible (`git merge-base --is-ancestor` returns false):**
  1. **STOP and inspect the divergent commits on `origin/main` first:**
     ```bash
     git log --stat origin/recovery/phase1-batch1-2-checkpoint..origin/main
     ```
  2. Verify with the user why `origin/main` advanced past `0366de23fba6301622432ee08569382218a5c854`.
  3. If the divergent commit(s) on `main` are legitimate and must be preserved alongside the recovery checkpoint, perform a non-fast-forward merge without committing automatically so the tree can be audited before commit:
     ```bash
     git checkout main
     git merge --no-ff --no-commit origin/recovery/phase1-batch1-2-checkpoint
     ```
  4. Verify zero conflicts (`git status --short`), verify that all 18 recovered files and all 29 protected compiled bundles match the exact blobs from `3805f624ce3d63b80278e7fc531f38b1af1b0a5b` (`git diff 3805f624ce3d63b80278e7fc531f38b1af1b0a5b -- index.html assets/ games/`), then complete the merge commit (`git commit`) and push normally (`git push origin main`). **Never run `git push --force origin main`.**

#### 3.3 Post-Merge Verification Gate (Step 3)
Run all checks below immediately after pushing `main`:
```bash
git fetch origin --prune --tags

# 1. Verify remote main HEAD matches the recovery commit (or contains it as parent in Case B):
git rev-parse origin/main
# Expected (Case A): 3805f624ce3d63b80278e7fc531f38b1af1b0a5b

# 2. Verify zero tree difference between origin/main and checkpoint/phase1-batch1-2:
git diff origin/main checkpoint/phase1-batch1-2
# Expected: empty output (0 byte difference across all 987 files)

# 3. Verify total tracked file count on origin/main is exactly 987 (no Studio files leaked):
git ls-tree -r --name-only origin/main | wc -l
# MUST output: 987

# 4. Verify all 18 recovered files match checkpoint/phase1-batch1-2:
git diff origin/main checkpoint/phase1-batch1-2 -- \
  index.html assets/css/portal.css assets/js/portal.js \
  games/vak/index.html games/vak/manifest.json games/vak/manifest.webmanifest games/vak/sw.js \
  games/auromatch/index.html games/auromatch/manifest.json games/auromatch/sw.js games/auromatch/styles/main.css \
  games/auromatch/src/main.js games/auromatch/src/controllers/gameManager.js games/auromatch/src/models/boardGenerator.js \
  games/auromatch/src/models/floraDatabase.js games/auromatch/src/ui/boardRenderer.js \
  games/word-riddle/index.html games/auroblocks/index.html
# Expected: empty output

# 5. Verify all 29 protected compiled bundles match checkpoint/phase1-batch1-2:
git diff origin/main checkpoint/phase1-batch1-2 -- \
  games/word-riddle/assets/ \
  games/vak-living-sanctuary/assets/ games/vak-living-sanctuary/workbox-63c18b4d.js games/vak-living-sanctuary/sw.js games/vak-living-sanctuary/offline-shell-sw.js \
  games/auromandala/assets/index-DhYVrlzX.js games/auromandala/assets/index-MfgMt68V.css games/auromandala/workbox-835c8c05.js games/auromandala/sw.js \
  games/auroblocks/assets/index-BLt2QrTp.js games/auroblocks/assets/index-Ccfp-y1N.css games/auroblocks/assets/web-BbouHfjM.js games/auroblocks/sw.js
# Expected: empty output

# 6. Verify recovery branch and backup tag still point to 3805f624ce3d63b80278e7fc531f38b1af1b0a5b:
git rev-parse origin/recovery/phase1-batch1-2-checkpoint checkpoint/phase1-batch1-2^{commit}
# Both lines MUST output: 3805f624ce3d63b80278e7fc531f38b1af1b0a5b
```
- **APPROVAL CHECKPOINT 3:** Confirm `origin/main` is at `3805f624ce3d63b80278e7fc531f38b1af1b0a5b` with 987 intact files before proceeding to Step 4.

---

### STEP 4 — Restore `main` as GitHub's Default Branch and Protect `main`

#### 4.1 GitHub UI Steps
1. Open `https://github.com/gapskris/AuroMind/settings` (General → **Default branch**).
2. If the default branch is set to `recovery/phase1-batch1-2-checkpoint` (or anything other than `main`), click the switch icon (`⇄`), select `main`, and click **Update** → **I understand, update the default branch**.
3. Open `https://github.com/gapskris/AuroMind/settings/rules` or `https://github.com/gapskris/AuroMind/settings/branches` and configure protection for `main`:
   - **Block force pushes:** Enabled (Classic: leave *"Allow force pushes"* **UNCHECKED**; Rulesets: check **"Block force pushes"**).
   - **Restrict deletions:** Enabled (Classic: leave *"Allow deletions"* **UNCHECKED**; Rulesets: check **"Restrict deletions"**).
   - **Require a pull request before merging:** Recommended once `main` is at `3805f624ce3d63b80278e7fc531f38b1af1b0a5b` so all future changes from `dev/studio-integration` enter `main` through reviewed Pull Requests (Step 9).

#### 4.2 Post-Operation Verification Gate (Step 4)
```bash
curl -s https://api.github.com/repos/gapskris/AuroMind | grep '"default_branch"'
# MUST output: "default_branch": "main",

curl -s https://api.github.com/repos/gapskris/AuroMind/branches/main | grep -E '"name"|"sha"|"protected"'
# MUST show "sha": "3805f624ce3d63b80278e7fc531f38b1af1b0a5b" and "protected": true
```
- **APPROVAL CHECKPOINT 4:** Confirm `default_branch` is `"main"` and `main` protection is active before proceeding to Step 5.

---

### STEP 5 — Validate Imported Google AI Studio Workspace Restart & Reopen Reliability (Mandatory Pre-Remediation Gate)

Before creating `dev/studio-integration` or beginning any remediation work, the AI Studio workspace must be evaluated across three distinct restart levels (**Level A**, **Level B**, and **Level C**). **Browser refresh or preview server restart alone does NOT prove full workspace close/reopen survival.**

#### 5.1 Comparison of the Three Validation Levels

| Validation Level | What It Tests | Current Verification Status | Who Can Execute |
| :--- | :--- | :---: | :--- |
| **Level A: Preview Restart / Server Process Restart** | Stopping and restarting the Node.js/Express process (`restart_dev_server` / `npm run dev`) inside the running container and re-running dependency/health checks. | **VERIFIED (In Step 4 Audit)** | Agent or User |
| **Level B: Browser Refresh & Game Relaunch** | Hard reloading (`page.reload()`) the portal, re-launching all 6 games in `#game-viewport-iframe`, verifying SW registration, `localStorage` persistence, and offline cache behavior. | **VERIFIED (In Step 4 Audit)** | Agent or User |
| **Level C: Full AI Studio Workspace Close & Cold Reopen (or Container Recreation)** | Closing the AI Studio browser tab/session completely, waiting for the container lifecycle to suspend/recreate, reopening the applet in AI Studio, and verifying that `package.json`, `bun.lock`, `server.js`, and `server.test.js` persist in AI Studio's backing store and `bun install` + `npm run dev` succeed automatically on cold start. | **UNVERIFIED (Must Be Executed by User)** | **User Only** (AI Studio does not expose a self-recreate container API to the agent inside the container) |

#### 5.2 Explicit Limitation Regarding Level C (Container Recreation)
- Inside the Google AI Studio runtime environment, the agent has access to `restart_dev_server` (which restarts the Node process in the *existing* Linux container) and `playwright-cli` (which opens/reloads headless Chromium tabs against `http://localhost:3000`).
- Google AI Studio **does not expose an API or tool for the agent to destroy and cold-recreate its own Linux container** or simulate closing and reopening the AI Studio host IDE.
- Therefore, **Level C remains UNVERIFIED until performed by the user** (by closing the AI Studio session/tab, reopening the applet URL after container suspension or in a fresh browser session, and running the Level C verification checklist below).
- **Closest Agent-Executable Test:** Kill/restart the dev server (`restart_dev_server`), verify `bun install` (`install_applet_dependencies`), run `node --test server.test.js`, and execute a fresh headless browser verification pass across all 6 games.

#### 5.3 Mandatory Verification Checklist & Evidence Required for Levels A, B, and C

When executing Level A, Level B, and Level C (after user closes and reopens the AI Studio workspace), verify and record evidence for every item below:

1. **Persistence of Compatibility Files:**
   - Check that `/package.json` (350 B, SHA-256 `1a98cb5d...`), `/bun.lock` (13,862 B, SHA-256 `21ad9ccd...`), `/server.js` (920 B, SHA-256 `778b2d1f...`), and `/server.test.js` (2,414 B, SHA-256 `cca681ff...`) still exist on disk after reopen.
2. **Dependency Installation Succeeds:**
   - Confirm AI Studio startup does **not** throw `error: Bun could not find a package.json file to install from`, and `node_modules/express` is present.
3. **`npm run dev` Starts the Server:**
   - Confirm `node server.js` binds to `0.0.0.0:3000` cleanly.
4. **`/health` Responds Successfully:**
   - `curl -i http://localhost:3000/health` returns `HTTP/1.1 200 OK` with `{"status":"ok"}`.
   - `node --test server.test.js` passes all 5 test cases (`pass 5`, `fail 0`).
5. **All Six Games Launch in Browser & Theater View:**
   - Launch each of the 6 games (`vak`, `auromatch`, `wordriddle`, `vak-sanctuary`, `auromandala`, `auroblocks`) via `.game-card[data-game-id="<id>"]` into `#game-viewport-iframe` and verify non-empty DOM/Canvas rendering and interactive controls.
6. **Game Progress Persistence (`localStorage` / `IndexedDB`):**
   - Verify that `localStorage` keys written by the portal (`auromind-theme`, `auromind_Sound`, `auromind_last_played`) and games (`vak_save_v4`, `auromatch_save_v2`, `auromind_wr_save_v1`, `vak_sanctuary_state_v5`, `auromind_mandala_state`, `auroblocks:player-storage`) persist across browser refresh (Level B) and server restart (Level A). *(Note: In headless Playwright runs, each fresh browser context starts with empty storage unless storage state is reused; in the user's real browser across Level C reopen, verify whether the preview origin URL `https://ais-dev-...run.app` remains constant so browser `localStorage` persists).*
7. **Service Worker Registration & Cache Inspection:**
   - Verify `navigator.serviceWorker.getRegistrations()` registers the 5 sub-game Service Workers (`/games/vak/sw.js`, `/games/auromatch/sw.js`, `/games/word-riddle/sw.js`, `/games/vak-living-sanctuary/sw.js`, `/games/auromandala/sw.js`, `/games/auroblocks/sw.js`) and populates CacheStorage (`vak-speech-control-v2.0.0`, `auromatch-v4.0-cache`, `auromind-word-riddle-v1`, `workbox-precache-v2-...`, `auroblocks-static-v2`).
8. **Offline Behavior Tested with Known Pre-Existing Limitations Explicitly Recorded:**
   - Do **not** silently treat existing upstream offline issues from commit `3805f624ce3d63b80278e7fc531f38b1af1b0a5b` as fixed during this baseline check. Record the baseline behavior accurately:
     - **Portal Root (`/`):** No root Service Worker exists in commit `3805f624...` (`ERR_INTERNET_DISCONNECTED` when offline).
     - **Game 1 (`vak`), Game 4 (`vak-living-sanctuary`), Game 5 (`auromandala`), Game 6 (`auroblocks`):** Load and render their game shells offline (`offlineLoaded: true`) once their Service Workers are installed.
     - **Game 6 (`auroblocks`) Offline Artwork Limitation:** `/assets/artwork/*.webp` is outside the `/games/auroblocks/` Service Worker scope, so those 4 artwork WebPs miss cache when strictly offline.
     - **Game 2 (`auromatch`) Offline Query-String Mismatch:** `games/auromatch/sw.js` precaches `./styles/main.css` and `./src/main.js` without query strings, while `index.html` requests `./styles/main.css?v=4.0` and `./src/main.js?v=4.0` without `{ ignoreSearch: true }` in `caches.match(event.request)`, causing main module cache misses offline.
     - **Game 3 (`word-riddle`) Partial Precache List:** `games/word-riddle/sw.js` precaches only 4 shell files (`./`, `index.html`, `manifest.webmanifest`, `icon.svg`) and omits `/games/word-riddle/assets/*.js` and `*.css`, so the React root does not hydrate when offline if browser HTTP cache is bypassed.

- **APPROVAL CHECKPOINT 5:** User confirms Level C (full AI Studio close/reopen) and signs off on Step 5 before creating `dev/studio-integration` or starting remediation.

---

### STEP 6 — Create `dev/studio-integration` from the Verified, Updated `main`

Once `main` has been updated to `3805f624ce3d63b80278e7fc531f38b1af1b0a5b` (Step 3), set as default branch (Step 4), and Studio restart validation has been completed (Step 5):

```bash
cd /path/to/AuroMind
git fetch origin --prune --tags

# Verify origin/main is at the exact recovery checkpoint commit:
git rev-parse origin/main
# MUST output: 3805f624ce3d63b80278e7fc531f38b1af1b0a5b

# Create dev/studio-integration cleanly from origin/main:
git checkout -b dev/studio-integration origin/main

# Verify starting commit of dev/studio-integration:
git rev-parse HEAD
# MUST output: 3805f624ce3d63b80278e7fc531f38b1af1b0a5b

# Push dev/studio-integration to GitHub:
git push -u origin dev/studio-integration
```
- **APPROVAL CHECKPOINT 6:** Confirm `origin/dev/studio-integration` exists on GitHub at commit `3805f624ce3d63b80278e7fc531f38b1af1b0a5b`.

---

### STEP 7 — Controlled ZIP Transfer of Compatibility Files & Audit Reports to `dev/studio-integration`

Transfer **only** the 4 Studio compatibility files and 2 audit reports into `dev/studio-integration`.

#### 7.1 Whitelisted Files for Step 7 Transfer (`6` files total)
1. `package.json`
2. `bun.lock`
3. `server.js`
4. `server.test.js`
5. `phase0-audit/AUROMIND_FRESH_STUDIO_IMPORT_INTEGRITY_AUDIT.md`
6. `phase0-audit/AUROMIND_SAFE_GITHUB_HANDOFF_PLAN.md`

#### 7.2 Strictly Excluded Runtime Artifacts
- `.aistudio/`
- `.playwright-cli/`
- `node_modules/`

#### 7.3 Step-by-Step Controlled Transfer Commands
1. In Google AI Studio, click **Download / Export ZIP** (never click "Sync to GitHub" or "Force push").
2. Unzip the archive into a separate temporary folder outside your Git repo, e.g. `~/Downloads/auromind-studio-export/`.
3. Copy **only** the 6 whitelisted files into your local checkout of `dev/studio-integration`:
   ```bash
   cd /path/to/AuroMind
   git checkout dev/studio-integration

   # Verify clean starting state on dev/studio-integration:
   git status --short
   # MUST be empty before copying

   # Copy the 4 compatibility files:
   cp ~/Downloads/auromind-studio-export/package.json ./package.json
   cp ~/Downloads/auromind-studio-export/bun.lock ./bun.lock
   cp ~/Downloads/auromind-studio-export/server.js ./server.js
   cp ~/Downloads/auromind-studio-export/server.test.js ./server.test.js

   # Copy the 2 audit reports:
   mkdir -p ./phase0-audit
   cp ~/Downloads/auromind-studio-export/phase0-audit/AUROMIND_FRESH_STUDIO_IMPORT_INTEGRITY_AUDIT.md ./phase0-audit/
   cp ~/Downloads/auromind-studio-export/phase0-audit/AUROMIND_SAFE_GITHUB_HANDOFF_PLAN.md ./phase0-audit/
   ```

#### 7.4 Mandatory Pre-Commit Verification Gate (Step 7)
Stage the 6 files and run all six required verification commands **before** running `git commit`:

```bash
git add package.json bun.lock server.js server.test.js \
  phase0-audit/AUROMIND_FRESH_STUDIO_IMPORT_INTEGRITY_AUDIT.md \
  phase0-audit/AUROMIND_SAFE_GITHUB_HANDOFF_PLAN.md

# Run all 6 mandatory verification commands:
git status --short
git diff --name-only
git diff --cached --name-only
git diff --stat
git diff --cached --stat
node --test server.test.js
```
*(Note: If `node_modules` is not yet installed in your local Git checkout, run `bun install` or `npm install` locally before `node --test server.test.js`, and ensure `node_modules/` remains ignored by `.gitignore` and never staged).*

**Expected Output of the 6 Commands:**
- `git status --short`: Shows **only** `A  bun.lock`, `A  package.json`, `A  phase0-audit/AUROMIND_FRESH_STUDIO_IMPORT_INTEGRITY_AUDIT.md`, `A  phase0-audit/AUROMIND_SAFE_GITHUB_HANDOFF_PLAN.md`, `A  server.js`, `A  server.test.js`. Zero `M` (modified) or `D` (deleted) files, and zero `.aistudio` / `.playwright-cli` entries.
- `git diff --name-only`: Empty (`0` unstaged modifications to tracked files).
- `git diff --cached --name-only`: Lists **only** the 6 newly added files above (`0` of the 987 original files appear).
- `git diff --stat`: Empty.
- `git diff --cached --stat`: Shows 6 files changed (insertions only, `0` deletions).
- `node --test server.test.js`: All 5 server & MIME type tests pass (`fail 0`).

> **CRITICAL STOP-AND-INVESTIGATE RULE:**
> If **any** of the 987 original files (including the 18 recovered files, 29 compiled bundles, or VAK/AuroMatch corpus files) appear as modified or deleted in `git status --short`, `git diff`, or `git diff --cached`, **STOP IMMEDIATELY AND INVESTIGATE.**
> **Do NOT automatically run `git checkout -- <path>` or `git restore` to silently discard unexpected changes.** Instead, inspect the diff (`git diff <path>`), determine how and why the file changed, and report the discrepancy before taking any corrective action.

#### 7.5 Commit and Push `dev/studio-integration`
```bash
git commit -m "chore(studio): add AI Studio compatibility layer and Phase 0 recovery audit reports"
git push origin dev/studio-integration
```
- **APPROVAL CHECKPOINT 7:** Confirm the commit on `origin/dev/studio-integration` adds only the 6 files and leaves all 987 baseline files untouched.

---

### STEP 8 — Begin Approved Remediation Batches on `dev/studio-integration`

Only after Steps 1–7 are completed and verified may approved remediation batches begin:
1. Each remediation batch must have an explicit, pre-approved file whitelist before any edits are made in Google AI Studio.
2. Protected files (the 29 compiled Vite/Workbox bundles, VAK 1,368-level corpus, AuroMatch `floraDatabase.js`, and all unapproved game/portal files) must remain untouched unless a batch explicitly authorizes a specific file.
3. After completing and verifying a batch in Google AI Studio, export via ZIP to your local `dev/studio-integration` checkout, copy only the batch's approved files, and run the mandatory 6-command gate (`git status --short`, `git diff --name-only`, `git diff --cached --name-only`, `git diff --stat`, `git diff --cached --stat`, `node --test server.test.js`) before committing.
4. Apply the **Stop-and-Investigate Rule** if any unexpected file differs.

---

### STEP 9 — Promote Completed and Reviewed Work to `main` Through Pull Requests

1. Open a Pull Request on GitHub from `dev/studio-integration` (or a feature sub-branch) targeting `main`.
2. Review the PR file diff on GitHub to confirm:
   - Zero unintended changes to protected compiled bundles or corpus datasets.
   - Determine whether AI Studio dev-only files (`server.js`, `server.test.js`, `package.json`, `bun.lock`) should be kept on `main` (with a GitHub Actions workflow or `.nojekyll` exclusion for GitHub Pages) or kept exclusively on `dev/studio-integration`.
3. Merge the Pull Request into `main` via standard merge or fast-forward (never force-push `main`).

---

## 5. Rollback & Emergency Recovery Instructions

If an error or unexpected state occurs during any phase, follow the corresponding non-destructive recovery procedure below. **Never delete `recovery/phase1-batch1-2-checkpoint` or `checkpoint/phase1-batch1-2`.**

### Scenario A — Unexpected File Changes Detected Locally Before Commit (Step 3, 7, or 8)
1. **Do NOT commit or push.**
2. **Do NOT blindly run `git checkout` / `git reset --hard` before capturing forensic evidence.**
3. Save the unexpected diff to an external inspection file outside the repo:
   ```bash
   git status --short > ~/Downloads/unexpected-status.txt
   git diff > ~/Downloads/unexpected-unstaged.diff
   git diff --cached > ~/Downloads/unexpected-staged.diff
   ```
4. Inspect the saved diff files to identify the root cause. Only after the cause is understood and documented should the working tree be reset or re-staged with user approval.

### Scenario B — Local `main` Merge Goes Wrong Before Pushing (Step 3)
1. Capture the current local commit hash and status (`git rev-parse HEAD`, `git status --short`).
2. Reset local `main` back to `origin/main` (`0366de23fba6301622432ee08569382218a5c854`) only after confirming no unbacked local work exists:
   ```bash
   git checkout main
   git merge --abort 2>/dev/null || true
   git reset --hard origin/main
   ```

### Scenario C — Bad Commit Pushed to `dev/studio-integration` (Step 7 or 8)
Because `dev/studio-integration` is a non-force-pushed development branch, revert the bad commit cleanly using `git revert` (preserving full audit history):
```bash
git checkout dev/studio-integration
git revert HEAD --no-edit
git push origin dev/studio-integration
```
Or, if you need to start a fresh integration branch from the verified recovery checkpoint on `main`:
```bash
git checkout -b dev/studio-integration-v2 checkpoint/phase1-batch1-2
```

### Scenario D — Worst-Case Recovery If Any Branch Ref Is Ever Corrupted
Because the recovery checkpoint is pinned in **three independent places**:
1. Protected branch `recovery/phase1-batch1-2-checkpoint` (`3805f624ce3d63b80278e7fc531f38b1af1b0a5b`)
2. Protected annotated tag `checkpoint/phase1-batch1-2` (`3805f624ce3d63b80278e7fc531f38b1af1b0a5b`)
3. Your local Git clone (`git reflog` and local object database)

Any branch can be restored to the exact 987-file recovery state at any time without losing a single byte by creating a branch from `checkpoint/phase1-batch1-2^{commit}` (`3805f624ce3d63b80278e7fc531f38b1af1b0a5b`).

---

## 6. Summary of Mandatory User Approval Checkpoints

No subsequent step may start until the preceding checkpoint is verified and approved by the user:

| Checkpoint | Gate Condition Required Before Proceeding |
| :--- | :--- |
| **Checkpoint 1 (After Step 1)** | `recovery/phase1-batch1-2-checkpoint` (`3805f624...`) has branch protection active on GitHub (force-push blocked, deletion blocked, branch locked/read-only). |
| **Checkpoint 2 (After Step 2)** | Annotated tag `checkpoint/phase1-batch1-2` points to `3805f624ce3d63b80278e7fc531f38b1af1b0a5b` on GitHub and tag protection ruleset is active. |
| **Checkpoint 3 (After Step 3)** | Pre-merge ancestry checks passed; `origin/main` is merged to `3805f624ce3d63b80278e7fc531f38b1af1b0a5b` without force-push; post-merge diff against `checkpoint/phase1-batch1-2` is 0 bytes across all 987 files (18 recovered files + 29 compiled bundles verified intact; 0 Studio files included). |
| **Checkpoint 4 (After Step 4)** | GitHub repository default branch is restored to `main`, and branch protection is active on `main` (force-push and deletion blocked). |
| **Checkpoint 5 (After Step 5)** | AI Studio restart and reopen reliability is verified across **Level A** (server restart), **Level B** (browser refresh & 6-game relaunch), and **Level C** (full AI Studio workspace close & cold reopen by user), with existing offline limitations explicitly documented. |
| **Checkpoint 6 (After Step 6)** | `dev/studio-integration` is branched from the verified, updated `main` (`3805f624ce3d63b80278e7fc531f38b1af1b0a5b`) and pushed to GitHub. |
| **Checkpoint 7 (After Step 7)** | The 4 compatibility files and 2 audit reports are transferred via ZIP to `dev/studio-integration`, all 6 pre-commit verification commands pass with zero changes to the 987 original files, and the commit is pushed to `origin/dev/studio-integration`. |
| **Checkpoint 8 (Before Each Step 8 Batch)** | Explicit user approval of the exact target file list and scope for each remediation batch on `dev/studio-integration`. |
