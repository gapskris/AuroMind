# AuroMind — Studio to Git File Decision Matrix
## Granular File-by-File Disposition, Rationale & Action Plan

**Studio Source:** `C:\AuroMind_Studio`  
**Git Target:** `C:\AuroMindPortal` (`dev/studio-integration`)  
**Audit Date:** 2026-11-20  
**Scope:** Planning and Audit Only

---

## 1. Action Codes & Legend

| Action Code | Action Meaning | Direction |
|---|---|---|
| **UPDATE_GIT** | Overwrite Git file with verified Studio implementation | `Studio -> Git` |
| **ADD_TO_GIT** | Introduce new Studio implementation/documentation file into Git | `Studio -> Git` |
| **RETAIN_GIT** | Preserve existing Git-only file in Git repository | `Git stays in Git` |
| **COPY_TO_STUDIO** | Backport Git-only asset into Studio workspace for parity | `Git -> Studio` |
| **NORMALIZE** | Content is identical; normalize line endings (CRLF -> LF) via `.gitattributes` | Both |
| **EXCLUDE** | Strictly exclude from Git tracking (secrets, tool metadata, temp files) | Never commit |
| **DECISION_REQ** | Requires explicit human / Product Owner decision (Options 1 vs 2) | Pending approval |

---

## 2. Category A: Overlapping Files with Real Content Differences (6 Files)

These 6 files exist in both projects and have genuine semantic differences resulting from Batches B0, B1, and B2.

| Path | Studio Size / Hash | Git Size / Hash | Proposed Action | Technical Rationale & Risk Assessment |
|---|---|---|---|---|
| `.gitignore` | 202 B<br>`cdf068c0...` | 209 B<br>`ac4fc014...` | **UPDATE_GIT**<br>(+ amend with `.env`) | Studio includes `bun.lock` (Batch B0 Closeout decision A1). Git lacks it. Amendment required: Add `.env` and `.env*` to prevent credential exposure. |
| `index.html` | 93,187 B<br>`8afa0254...` | 94,861 B<br>`81bfa00d...` | **UPDATE_GIT** | Studio wires Shared SDK module scripts in dependency order (`auromind-adapters.js`, `auromind-sdk.js`) before `portal.js?v=3.7` under strict CSP `script-src 'self'`. All 1,880+ lines of catalog, modal, and accessibility markup are identical. Zero regression risk. |
| `assets/js/portal.js` | 34,890 B<br>`9787c9a3...` | 31,679 B<br>`881a3422...` | **UPDATE_GIT** | Studio implements idempotent SDK single-init (`initPortalSDK()`), frozen read-only `window.AuroMindPortal` helper, graceful initialization failure fallback, and platform-identity protection (`clearPortalPreferencesOnly`) in Clear Cache. Verified via Playwright. |
| `sw.js` | 9,358 B<br>`90e1a359...` | 8,167 B<br>`297ff017...` | **UPDATE_GIT** | Studio updates cache version to `auro-portal-v1.1.0`, precaches SDK modules, implements Cache-First SDK offline routing strictly after `/games/*` isolation bypass, and expands private doc/test bypass. Preserves all `/games/*` and game-referrer bypass rules. |
| `server.js` | 2,152 B<br>`31484d05...` | 2,205 B<br>`c03eefea...` | **UPDATE_GIT** | Studio adds `'architecture-design'` to blocked routes array, returning 404 for internal design documentation (Batch B0 doc protection). |
| `server.test.js` | 23,014 B<br>`d586fbf6...` | 3,412 B<br>`19d4b067...` | **UPDATE_GIT** | Studio expands test suite from 1 test (71 lines) to 7 comprehensive tests (611 lines) asserting static serving, CSP module tags, SDK single-init idempotency, Clear Cache identity survival, SW offline routing, and Pages workflow security. |

---

## 3. Category B: Studio-Only Implementation, Documentation & Test Files (29 Files)

These files represent authorized work delivered across Batches B0, B1, B1.1, and B2 that currently exist only in `C:\AuroMind_Studio`.

### 3.1 Shared Platform SDK & Automated Tests (3 Files)
| Path | Size (Bytes) | Proposed Action | Technical Rationale |
|---|---|---|---|
| `assets/sdk/auromind-sdk.js` | 55,854 | **ADD_TO_GIT** | Core provider-independent Shared Platform SDK: guest identity, dual-store persistence (IndexedDB + localStorage), auto-repair, single-flight init, multi-tab coordination. |
| `assets/sdk/auromind-adapters.js` | 26,340 | **ADD_TO_GIT** | Adapter registry, contract validation, capability discovery, and game save envelope validation. |
| `auromind-sdk.test.js` | 77,570 | **ADD_TO_GIT** | 31 comprehensive unit and concurrency tests for the Shared SDK (all passing). |

### 3.2 GitHub Pages Deployment Workflow (1 File)
| Path | Size (Bytes) | Proposed Action | Technical Rationale |
|---|---|---|---|
| `.github/workflows/pages.yml` | 4,827 | **ADD_TO_GIT** | Manual-only (`workflow_dispatch:`) GitHub Pages deployment workflow with strict allowlist assembling `_site/` and asserting zero doc/test leakage. |

### 3.3 Architecture & Implementation Reports (24 Files)
| Path | Size (Bytes) | Proposed Action | Technical Rationale |
|---|---|---|---|
| `architecture-design/TARGET_ARCHITECTURE.md` | 15,864 | **ADD_TO_GIT** | Master target platform architecture for 1 Jan 2027 launch |
| `architecture-design/SHARED_SDK_CONTRACTS.md` | 14,391 | **ADD_TO_GIT** | Shared SDK API specifications and contract boundaries |
| `architecture-design/SUPABASE_DESIGN.md` | 14,249 | **ADD_TO_GIT** | Future Tier-2 cloud sync architecture design |
| `architecture-design/PRODUCT_INTEGRATION_MATRIX.md` | 15,168 | **ADD_TO_GIT** | Integration matrix for all 6 games and portal |
| `architecture-design/IMPLEMENTATION_BATCH_PLAN.md` | 12,916 | **ADD_TO_GIT** | Master batch progression plan (B0 through B5) |
| `architecture-design/OPEN_DECISIONS.md` | 6,431 | **ADD_TO_GIT** | Architecture decision record and frozen decisions |
| `architecture-design/ARCHITECTURE_CORRECTIONS.md` | 18,542 | **ADD_TO_GIT** | Historical architectural adjustments and rationale |
| `architecture-design/B0_CLEANUP_CHANGELOG.md` | 12,311 | **ADD_TO_GIT** | Batch B0 file-budget cleanup audit log |
| `architecture-design/B0_CLOSEOUT_ADDENDUM.md` | 4,885 | **ADD_TO_GIT** | Batch B0 closeout decisions documentation |
| `architecture-design/B0_DOCUMENTATION_EXPOSURE_REVIEW.md` | 7,829 | **ADD_TO_GIT** | Analysis of documentation exposure risks on Pages |
| `architecture-design/B0_FILE_INVENTORY.md` | 8,674 | **ADD_TO_GIT** | Baseline pre-B1 tracked file budget inventory |
| `architecture-design/B0_VALIDATION_REPORT.md` | 6,952 | **ADD_TO_GIT** | Batch B0 verification and acceptance evidence |
| `architecture-design/B1_API_CONTRACT.md` | 8,944 | **ADD_TO_GIT** | Batch B1 Shared SDK API contract freeze |
| `architecture-design/B1_CHANGE_INVENTORY.md` | 5,298 | **ADD_TO_GIT** | Batch B1 change manifest and hash registry |
| `architecture-design/B1_IDENTITY_AND_CONCURRENCY_TEST_REPORT.md` | 8,227 | **ADD_TO_GIT** | Multi-tab concurrency and Web Locks test report |
| `architecture-design/B1_SDK_IMPLEMENTATION_REPORT.md` | 7,440 | **ADD_TO_GIT** | Batch B1 SDK architecture and implementation details |
| `architecture-design/B1_VALIDATION_REPORT.md` | 6,154 | **ADD_TO_GIT** | Batch B1 test suite execution and validation results |
| `architecture-design/B1_1_CHANGE_INVENTORY.md` | 3,112 | **ADD_TO_GIT** | Batch B1.1 hardening change inventory |
| `architecture-design/B1_1_HARDENING_REPORT.md` | 10,793 | **ADD_TO_GIT** | Independent review remediation (A-1, A-2, B-1, B-2) |
| `architecture-design/B1_1_TEST_CLOSURE_REPORT.md` | 8,267 | **ADD_TO_GIT** | Test closure and edge case verification report |
| `architecture-design/B1_1_VALIDATION_REPORT.md` | 6,350 | **ADD_TO_GIT** | Batch B1.1 acceptance evidence and 31/31 test passes |
| `architecture-design/B2_CHANGE_INVENTORY.md` | 5,967 | **ADD_TO_GIT** | Batch B2 change manifest and SHA-256 parity record |
| `architecture-design/B2_IMPLEMENTATION_REPORT.md` | 8,200 | **ADD_TO_GIT** | Batch B2 portal integration and offline SDK details |
| `architecture-design/B2_VALIDATION_REPORT.md` | 11,655 | **ADD_TO_GIT** | Batch B2 real-browser cold-offline validation evidence |

### 3.4 Consolidated Audit Archive (1 File)
| Path | Size (Bytes) | Proposed Action | Technical Rationale |
|---|---|---|---|
| `phase0-audit/ARCHIVE.md` | 283,745 | **ADD_TO_GIT**<br>(or DECISION_REQ) | Consolidates 10 historical Phase 0 markdown reports into one file to respect Google AI Studio's 1,000-file import ceiling (`-9` tracked files). |

---

## 4. Category C: Git-Only Assets, Artwork & Historical Reports (45 Files)

These files exist only in `C:\AuroMindPortal` and are absent from Studio. Per Instruction 5, all game assets must be preserved.

### 4.1 AuroMatch Background Variants & Artwork (31 Files)
| Path in Git | Size (Bytes) | Proposed Action | Notes / Disposition |
|---|---|---|---|
| `games/auromatch/Assets/aegean_seaglass_clean.png` | 1,843,972 | **RETAIN_GIT** + **COPY_TO_STUDIO** | Copy to `games/auromatch/Assets/backgrounds/` in Studio |
| `games/auromatch/Assets/amethyst_geode_clean.png` | 1,865,169 | **RETAIN_GIT** + **COPY_TO_STUDIO** | Copy to `games/auromatch/Assets/backgrounds/` in Studio |
| `games/auromatch/Assets/celestial_opal_clean.png` | 1,851,551 | **RETAIN_GIT** + **COPY_TO_STUDIO** | Copy to `games/auromatch/Assets/backgrounds/` in Studio |
| `games/auromatch/Assets/desert_sandstone_clean.png` | 1,828,493 | **RETAIN_GIT** + **COPY_TO_STUDIO** | Copy to `games/auromatch/Assets/backgrounds/` in Studio |
| `games/auromatch/Assets/golden_honeycomb_clean.png` | 1,862,050 | **RETAIN_GIT** + **COPY_TO_STUDIO** | Copy to `games/auromatch/Assets/backgrounds/` in Studio |
| `games/auromatch/Assets/kyoto_bamboo_clean.png` | 1,837,870 | **RETAIN_GIT** + **COPY_TO_STUDIO** | Copy to `games/auromatch/Assets/backgrounds/` in Studio |
| `games/auromatch/Assets/kyoto_porcelain_clean.png` | 1,761,827 | **RETAIN_GIT** + **COPY_TO_STUDIO** | Copy to `games/auromatch/Assets/backgrounds/` in Studio |
| `games/auromatch/Assets/lapis_lazuli_clean.png` | 1,835,545 | **RETAIN_GIT** + **COPY_TO_STUDIO** | Copy to `games/auromatch/Assets/backgrounds/` in Studio |
| `games/auromatch/Assets/midnight_obsidian_clean.png` | 1,765,558 | **RETAIN_GIT** + **COPY_TO_STUDIO** | Copy to `games/auromatch/Assets/backgrounds/` in Studio |
| `games/auromatch/Assets/moroccan_zellige_clean.png` | 1,845,752 | **RETAIN_GIT** + **COPY_TO_STUDIO** | Copy to `games/auromatch/Assets/backgrounds/` in Studio |
| `games/auromatch/Assets/murano_crystal_clean.png` | 1,828,094 | **RETAIN_GIT** + **COPY_TO_STUDIO** | Copy to `games/auromatch/Assets/backgrounds/` in Studio |
| `games/auromatch/Assets/nacre_pearl_clean.png` | 1,813,619 | **RETAIN_GIT** + **COPY_TO_STUDIO** | Copy to `games/auromatch/Assets/backgrounds/` in Studio |
| `games/auromatch/Assets/nordic_pine_clean.png` | 1,784,432 | **RETAIN_GIT** + **COPY_TO_STUDIO** | Copy to `games/auromatch/Assets/backgrounds/` in Studio |
| `games/auromatch/Assets/river_basalt_clean.png` | 1,795,891 | **RETAIN_GIT** + **COPY_TO_STUDIO** | Copy to `games/auromatch/Assets/backgrounds/` in Studio |
| `games/auromatch/Assets/rose_alabaster_clean.png` | 1,815,514 | **RETAIN_GIT** + **COPY_TO_STUDIO** | Copy to `games/auromatch/Assets/backgrounds/` in Studio |
| `games/auromatch/Assets/sandalwood_teak_clean.png` | 1,838,712 | **RETAIN_GIT** + **COPY_TO_STUDIO** | Copy to `games/auromatch/Assets/backgrounds/` in Studio |
| `games/auromatch/Assets/silver_granite_clean.png` | 1,805,835 | **RETAIN_GIT** + **COPY_TO_STUDIO** | Copy to `games/auromatch/Assets/backgrounds/` in Studio |
| `games/auromatch/Assets/smoked_topaz_clean.png` | 1,818,837 | **RETAIN_GIT** + **COPY_TO_STUDIO** | Copy to `games/auromatch/Assets/backgrounds/` in Studio |
| `games/auromatch/Assets/tuscan_terracotta_clean.png` | 1,861,687 | **RETAIN_GIT** + **COPY_TO_STUDIO** | Copy to `games/auromatch/Assets/backgrounds/` in Studio |
| `games/auromatch/Assets/ashram_library.png` | 1,871,183 | **RETAIN_GIT** | Identical copy already exists in Studio under `Assets/backgrounds/` |
| `games/auromatch/Assets/auromatch_ui_mockup.png` | 900,733 | **RETAIN_GIT** | Identical copy already exists in Studio under `Assets/backgrounds/` |
| `games/auromatch/Assets/banyan_tree_theme.png` | 1,862,859 | **RETAIN_GIT** | Identical copy already exists in Studio under `Assets/backgrounds/` |
| `games/auromatch/Assets/blooming_mandala.jpg` | 1,090,943 | **RETAIN_GIT** | Identical copy already exists in Studio under `Assets/backgrounds/` |
| `games/auromatch/Assets/brass_altar_game.jpg` | 853,804 | **RETAIN_GIT** | Identical copy already exists in Studio under `Assets/backgrounds/` |
| `games/auromatch/Assets/brass_altar_game.png` | 1,615,069 | **RETAIN_GIT** | Identical copy already exists in Studio under `Assets/backgrounds/` |
| `games/auromatch/Assets/coastline_theme.png` | 1,329,285 | **RETAIN_GIT** | Identical copy already exists in Studio under `Assets/backgrounds/` |
| `games/auromatch/Assets/golconde_slate.png` | 1,405,790 | **RETAIN_GIT** | Identical copy already exists in Studio under `Assets/backgrounds/` |
| `games/auromatch/Assets/golden_aura_stack.jpg` | 846,214 | **RETAIN_GIT** | Identical copy already exists in Studio under `Assets/backgrounds/` |
| `games/auromatch/Assets/golden_aura_stack.png` | 1,516,292 | **RETAIN_GIT** | Identical copy already exists in Studio under `Assets/backgrounds/` |
| `games/auromatch/Assets/matrimandir_petals.png` | 1,679,975 | **RETAIN_GIT** | Identical copy already exists in Studio under `Assets/backgrounds/` |
| `games/auromatch/Assets/service_tree_theme.png` | 1,569,817 | **RETAIN_GIT** | Identical copy already exists in Studio under `Assets/backgrounds/` |

### 4.2 Portal Thumbnails (4 Files)
| Path in Git | Size (Bytes) | Proposed Action | Notes / Disposition |
|---|---|---|---|
| `assets/thumbnails/auroblocks-gameplay.webp` | 57,688 | **RETAIN_GIT** + **COPY_TO_STUDIO** | Game artwork thumbnail; preserve in Git and sync to Studio |
| `assets/thumbnails/auromatch.jpg` | 1,090,943 | **RETAIN_GIT** + **COPY_TO_STUDIO** | AuroMatch catalog thumbnail; preserve in Git and sync to Studio |
| `assets/thumbnails/logic_riddles.jpg` | 853,804 | **RETAIN_GIT** + **COPY_TO_STUDIO** | Blockbuster card thumbnail; preserve in Git and sync to Studio |
| `assets/thumbnails/mahjong_zen.jpg` | 853,804 | **RETAIN_GIT** + **COPY_TO_STUDIO** | Blockbuster card thumbnail; preserve in Git and sync to Studio |

### 4.3 Unconsolidated Phase 0 Audit Reports (10 Files)
| Path in Git | Size (Bytes) | Proposed Action | Notes / Disposition |
|---|---|---|---|
| `phase0-audit/AUROMIND_BATCH_1_IMPLEMENTATION_REPORT.md` | 12,997 | **DECISION_REQ** | Covered verbatim in `phase0-audit/ARCHIVE.md` |
| `phase0-audit/AUROMIND_BATCH_2_IMPLEMENTATION_REPORT.md` | 20,713 | **DECISION_REQ** | Covered verbatim in `phase0-audit/ARCHIVE.md` |
| `phase0-audit/AUROMIND_BATCH_3_IMPLEMENTATION_REPORT.md` | 26,276 | **DECISION_REQ** | Covered verbatim in `phase0-audit/ARCHIVE.md` |
| `phase0-audit/AUROMIND_BATCH_4_IMPLEMENTATION_REPORT.md` | 24,658 | **DECISION_REQ** | Covered verbatim in `phase0-audit/ARCHIVE.md` |
| `phase0-audit/AUROMIND_FRESH_STUDIO_IMPORT_INTEGRITY_AUDIT.md` | 39,123 | **DECISION_REQ** | Covered verbatim in `phase0-audit/ARCHIVE.md` |
| `phase0-audit/AUROMIND_GITHUB_PRE_MERGE_READINESS_AUDIT.md` | 18,765 | **DECISION_REQ** | Covered verbatim in `phase0-audit/ARCHIVE.md` |
| `phase0-audit/AUROMIND_PHASE_0_1_NON_SUPABASE_RECONCILIATION.md` | 45,064 | **DECISION_REQ** | Covered verbatim in `phase0-audit/ARCHIVE.md` |
| `phase0-audit/AUROMIND_SAFE_GITHUB_HANDOFF_PLAN.md` | 45,888 | **DECISION_REQ** | Covered verbatim in `phase0-audit/ARCHIVE.md` |
| `phase0-audit/AUROMIND_STUDIO_POST_REOPEN_VALIDATION.md` | 16,137 | **DECISION_REQ** | Covered verbatim in `phase0-audit/ARCHIVE.md` |
| `phase0-audit/AUROMIND_STUDIO_PRE_RESTART_BASELINE.md` | 29,188 | **DECISION_REQ** | Covered verbatim in `phase0-audit/ARCHIVE.md` |

---

## 5. Category D: Sensitive Files, Editor Config & Studio Metadata (6 Files)

These files must be **strictly excluded from Git tracking** per Instructions 8 and 9.

| Path in Studio | Size | Classification | Action | Security / Operational Justification |
|---|---|---|---|---|
| `.env` | 68 B | **CRITICAL SECRET** | **EXCLUDE** | Contains active `GEMINI_API_KEY`. Must never be staged, committed, or pushed. Add to `.gitignore`. |
| `.antigravity/` | 14.5 MB | Agent Tool State | **EXCLUDE** | Ephemeral agent execution protobuf; internal IDE telemetry. |
| `.aistudio/artifacts/` | 355 KB (2 files) | Temp Media | **EXCLUDE** | Headless browser execution screenshots (`b2-portal-desktop.png`, etc.). Already ignored in `.gitignore`. |
| `.vscode/launch.json` | 212 B | User Editor Config | **EXCLUDE** | Personal IDE debugger configuration; keep local only. |
| `.vscode/settings.json` | 42 B | User Editor Config | **EXCLUDE** | Personal IDE workspace settings; keep local only. |

---

## 6. Category E: Line-Ending Normalization Summary (85 Files)

| Sub-directory | File Count | Examples | Action |
|---|---|---|---|
| `games/word-riddle/` | 22 files | `index.html`, `theme-th01-XkqLvUYb.js` .. `theme-th15-DRqodAya.js` | **NORMALIZE** (`eol=lf`) |
| `games/auromatch/` | 20 files | `src/models/floraDatabase.js`, `src/main.js`, `styles/main.css` | **NORMALIZE** (`eol=lf`) |
| `games/vak-living-sanctuary/` | 10 files | `index.html`, `assets/index-CUrzyYgb.js`, `offline-shell-sw.js` | **NORMALIZE** (`eol=lf`) |
| `games/auroblocks/` | 7 files | `index.html`, `assets/index-BLt2QrTp.js`, `manifest.webmanifest` | **NORMALIZE** (`eol=lf`) |
| `games/auromandala/` | 6 files | `index.html`, `assets/index-DhYVrlzX.js`, `workbox-835c8c05.js` | **NORMALIZE** (`eol=lf`) |
| `games/vak/` | 6 files | `index.html`, `manifest.json`, `sw.js` | **NORMALIZE** (`eol=lf`) |
| `assets/icons/` | 11 files | `auroblocks-logo.svg`, `auromatch-logo.svg`, `vak-logo.svg` | **NORMALIZE** (`eol=lf`) |
| `assets/css/` | 1 file | `portal.css` | **NORMALIZE** (`eol=lf`) |
| Root files | 3 files | `manifest.json`, `package.json`, `README.md` | **NORMALIZE** (`eol=lf`) |

---

## 7. Net Action Summary

| Action Type | File Count | Target Impact |
|---|---|---|
| **UPDATE_GIT** (Overlapping code changes) | 6 | Updates portal shell, service worker, server tests, and ignore rules |
| **ADD_TO_GIT** (Studio deliverables) | 28 (or 29 with `ARCHIVE.md`) | Introduces SDK, tests, workflow, and architecture documentation |
| **RETAIN_GIT** (Git artwork & assets) | 35 | Preserves all game backgrounds, artwork, and thumbnails |
| **COPY_TO_STUDIO** (Backport to Studio) | 23 | Copies 19 `_clean.png` backgrounds and 4 thumbnails into Studio |
| **EXCLUDE** (Secrets & Studio metadata) | 6 | Strictly blocks `.env`, `.antigravity/`, `.aistudio/`, `.vscode/` |
| **NORMALIZE** (CRLF -> LF) | 85 | Resolves line-ending noise via `.gitattributes` |
| **DECISION_REQ** (Phase 0 Audit reports) | 10 | Human choice: replace with `ARCHIVE.md` (recommended) or retain |
