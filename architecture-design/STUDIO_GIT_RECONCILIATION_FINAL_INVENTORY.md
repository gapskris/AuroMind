# AuroMind — Studio-to-Git Final File Inventory
## Post-Reconciliation Manifest, File-Budget Audit & Hash Registry

**Primary Working Directory:** `C:\AuroMind_Studio`  
**Git Reference Directory:** `C:\AuroMindPortal`  
**Audit Date:** 2026-11-20  
**Status:** Completed and Verified

---

## 1. Directory Tree Summary

Following the completion of Stages 1–6, `C:\AuroMind_Studio` contains **1,033 total physical files**:

| Top-Level Directory | File Count | Description / Role | Status |
|---|---|---|---|
| `(root)` | 15 | Core configuration, server, tests, attributes, ignore rules | **Completed and verified** |
| `.github/` | 1 | Manual-only GitHub Pages allowlist deployment workflow | **Completed and verified** |
| `architecture-design/` | 29 | Architecture specs (24) + reconciliation reports (5) | **Completed and verified** |
| `assets/` | 60 | Portal CSS, JS, SDK modules (2), icons (18), thumbnails (38) | **Completed and verified** |
| `games/` | 927 | All 6 games, compiled bundles, audio, data, corpora, assets | **Completed and verified** |
| `phase0-audit/` | 1 | Consolidated `ARCHIVE.md` (Option 1) | **Completed and verified** |
| `.aistudio/` *(Excluded)* | 2 | Headless browser execution screenshots | **Excluded from Git** |
| `.vscode/` *(Excluded)* | 2 | Local IDE settings and launch configurations | **Excluded from Git** |
| `.antigravity/` *(Excluded)* | 1 | Ephemeral agent runtime session protobuf | **Excluded from Git** |
| **Total Physical Files** | **1,033** | Full physical tree on disk | — |

---

## 2. File-Budget & Tracked-File Analysis

### 2.1 Studio Candidate Tracked Files
Excluding local tool ephemera (`.aistudio/`, `.vscode/`, `.antigravity/`), `C:\AuroMind_Studio` contains:
- **`1,028` candidate tracked files**

### 2.2 Comparison with Git Reference Baseline
- Git reference repository (`C:\AuroMindPortal`): **`1,003` tracked files**
- Net difference: **`+25` candidate files**
  - Added Studio architecture documentation: `+29` files (`architecture-design/`)
  - Added Shared Platform SDK & tests: `+3` files (`auromind-sdk.js`, `auromind-adapters.js`, `auromind-sdk.test.js`)
  - Added GitHub Pages workflow: `+1` file (`.github/workflows/pages.yml`)
  - Added `.env.example` & `.gitattributes`: `+2` files
  - Added Root reconciliation reports: `+4` files (created during Stage 0)
  - Quarantined `.env`: `-1` file
  - Consolidated Phase 0 reports into `ARCHIVE.md`: `-9` files (10 files replaced by 1)
  - Backported Git assets into Studio: `+0` net delta vs Git (they already existed in Git)

### 2.3 AI Studio 1,000-File Ceiling Advisory
- **Runtime Web Application:** The production portal and all 6 games require **`956` runtime files** (well below the 1,000-file ceiling).
- **Total Repository:** Including all 29 architecture and reconciliation documents plus the 35 backported high-resolution assets brings the total tracked count to `1,028`.
- **Recommendation:** If a future Google AI Studio import strictly enforces the 1,000-file ceiling:
  - Option A: Archive or consolidate older architectural design documents (e.g. `B0_*.md` and `B1_*.md`) into a single `architecture-design/ARCHIVE.md` (reducing ~15 files, bringing total to `~1,013`).
  - Option B: Use `.gitattributes` or `.gitignore` to omit non-runtime design documents from the AI Studio shallow clone if necessary.

---

## 3. Post-Reconciliation Hash Registry for Critical Files

### 3.1 Six Overlapping Reconciled Files
| File Path | Post-Reconciliation Size | SHA-256 Digest | Status |
|---|---|---|---|
| `index.html` | 93,187 B | `8afa0254f559ce47ab980eec8089afd24b4abd8337a0cfa8dc6b7d3d7089f0c5` | **Completed and verified** |
| `assets/js/portal.js` | 34,890 B | `9787c9a3a03853209416b53e7338e35d155412e45a11535ff51b19828c507583` | **Completed and verified** |
| `sw.js` | 9,358 B | `90e1a359f7759a0e807219b490e6d01ba7874d3a2c3862cadde28dfbb7e19f76` | **Completed and verified** |
| `server.js` | 2,152 B | `31484d05403cee29176c74661663709294b1f500045d856104470c078009162c` | **Completed and verified** |
| `server.test.js` | 23,014 B | `d586fbf6922ccbd150bbc80358c2a78058f339ba923bd93a23f020742e57eb68` | **Completed and verified** |
| `.gitignore` | 288 B | `12ae354968846c4b2ffb38340d58be9fec0e38634839cf77cecf5067980e224e` | **Completed and verified** |

### 3.2 Shared Platform SDK & Infrastructure
| File Path | Post-Reconciliation Size | SHA-256 Digest | Status |
|---|---|---|---|
| `assets/sdk/auromind-sdk.js` | 55,854 B | `174e31eab5d88a1ee391ec0f1bafc4eb75d71362680dbb038964d82c1b0c22b7` | **Completed and verified** |
| `assets/sdk/auromind-adapters.js` | 26,340 B | `2d168d746537b8fc3b5396432b44a8ed85a89fcdec0ea910d38d1aea67c72717` | **Completed and verified** |
| `auromind-sdk.test.js` | 77,570 B | `78652b4eedfba2dd5b1496c9e5cde2fe0be2449222280c1a0b73f8de4b1f131b` | **Completed and verified** |
| `.github/workflows/pages.yml` | 4,827 B | `2c08f4ece4d259c60db3bef291ea95d7f4cd7ec0c0923d2c805f0cd77cb7083c` | **Completed and verified** |
| `.gitattributes` | 610 B | `0dc2e59df6231ee6f8c792138e3a2414777ca22be7402693895e7c2ebae3ff70` | **Completed and verified** |
| `.env.example` | 178 B | `14f5fb2b23dbb7eb93155799ef7d0139e8bcbe3a84620f4c9bf66b3fef1c4636` | **Completed and verified** |
| `phase0-audit/ARCHIVE.md` | 283,745 B | `a01afe7d1454cb4245bc05eb4fc01444cf30980893fc37f2b98f14627c03c0a7` | **Completed and verified** |

### 3.3 Core Protected Game Corpora and Bundles (100% Intact)
| File Path | Post-Reconciliation Size | SHA-256 Digest | Status |
|---|---|---|---|
| `games/auromatch/src/models/floraDatabase.js` | 2,002,176 B | `689d035cd52abd8d342528d8c5f61f298916b8052b8287450be4931cf8ae1a3a` | **Completed and verified** |
| `games/vak/index.html` | 1,000,413 B | `04034bd881a478cd807b999220bdf3c228354e9674717113c510dca173c29d1f` | **Completed and verified** |
| `games/auromandala/assets/index-DhYVrlzX.js` | 396,251 B | `aa043f4d4d39e9797d128928b5d4cbbc444be1edd71d9f5c6cf876689dc5c80e` | **Completed and verified** |
| `games/vak-living-sanctuary/assets/index-CUrzyYgb.js` | 521,880 B | `f851ec703259c1e6c19b1241b67d8f6ed553fc3079e8f25656228571d3076d3f` | **Completed and verified** |
| `games/auroblocks/assets/index-BLt2QrTp.js` | 488,553 B | `cab995d6dea93f9caeae2d0ea804c3e47d41e29119ee48f1663fe80407b8588a` | **Completed and verified** |

### 3.4 Thirty-Five Backported Assets
| Destination File Path | Size (Bytes) | SHA-256 Digest | Status |
|---|---|---|---|
| `assets/thumbnails/auroblocks-gameplay.webp` | 57,688 | `f02e475719d58a0c5ae7b96b4016ce3ca3b963e32911438997a06f3630f40ef0` | **Completed and verified** |
| `assets/thumbnails/auromatch.jpg` | 1,090,943 | `5a625d7b5abffea2e4931afcb9d7809b058892be0a9fff6b270a64016a2ef189` | **Completed and verified** |
| `assets/thumbnails/logic_riddles.jpg` | 853,804 | `313abe973e4c0f2ce978e5c6312161055da76da19fbaa97ca26bdf3b5be5e5fc` | **Completed and verified** |
| `assets/thumbnails/mahjong_zen.jpg` | 853,804 | `313abe973e4c0f2ce978e5c6312161055da76da19fbaa97ca26bdf3b5be5e5fc` | **Completed and verified** |
| `games/auromatch/Assets/backgrounds/aegean_seaglass_clean.png` | 1,843,972 | `bcb89ff2707e47aa71fc575098a9f3cf8fc705f5231cf0ca4666fca5549ee1fc` | **Completed and verified** |
| `games/auromatch/Assets/backgrounds/amethyst_geode_clean.png` | 1,865,169 | `fe567ecece619d6679f3fe4f0a8f59e3f324f70d4c9fcb781432f864cf4c935c` | **Completed and verified** |
| `games/auromatch/Assets/backgrounds/celestial_opal_clean.png` | 1,851,551 | `ed33b5959e8e469671aa89e1122b1586fb8114fca9d125cb779532822d561a33` | **Completed and verified** |
| `games/auromatch/Assets/backgrounds/desert_sandstone_clean.png` | 1,828,493 | `f1ed5f4265fe06385db2395be97b5b5050562b95702907cc36cb5658e411516e` | **Completed and verified** |
| `games/auromatch/Assets/backgrounds/golden_honeycomb_clean.png` | 1,862,050 | `f2b1545fca252bd8389afac8f1f8d543b876836f9f59090b8ff4f1bead696a41` | **Completed and verified** |
| `games/auromatch/Assets/backgrounds/kyoto_bamboo_clean.png` | 1,837,870 | `dd07c9c2179d8a04ac58b7b263530d2c71d8ffe62be38ea3bf8d79a2a7a97495` | **Completed and verified** |
| `games/auromatch/Assets/backgrounds/kyoto_porcelain_clean.png` | 1,761,827 | `d4f2169f3b7692d96c115dd8a44f86761d7d40131630b36e8903328eb973e218` | **Completed and verified** |
| `games/auromatch/Assets/backgrounds/lapis_lazuli_clean.png` | 1,835,545 | `860b27b879419a6fa1651ad0b11dbb149df70bbb7e34ed0e68be5e7e1a39943d` | **Completed and verified** |
| `games/auromatch/Assets/backgrounds/midnight_obsidian_clean.png` | 1,765,558 | `82ce4cbd37c3832e47063d3e01157c9d4f1f6f13088cc74b971a067e7c84414f` | **Completed and verified** |
| `games/auromatch/Assets/backgrounds/moroccan_zellige_clean.png` | 1,845,752 | `db15fca8b9cd32ad0d4981fb617029e08dad34c7cccbe44b58ebc43f76921387` | **Completed and verified** |
| `games/auromatch/Assets/backgrounds/murano_crystal_clean.png` | 1,828,094 | `ad8afda6ef949602e2874d7409e43eaf715d22a98cf0a0a86d9bf3c9a6223455` | **Completed and verified** |
| `games/auromatch/Assets/backgrounds/nacre_pearl_clean.png` | 1,813,619 | `2e9a4418d4933259a394dc1c73252f02dc5bc2cb65848722b5123d420f8ebce4` | **Completed and verified** |
| `games/auromatch/Assets/backgrounds/nordic_pine_clean.png` | 1,784,432 | `5ca5147cba55c69a0a70cc174e2ef7ade629967117671f11e95655745bf388aa` | **Completed and verified** |
| `games/auromatch/Assets/backgrounds/river_basalt_clean.png` | 1,795,891 | `fff8698a33a67b01b318a7b0e27be86e97e45cdb3eeb746979bb9540c49fcb25` | **Completed and verified** |
| `games/auromatch/Assets/backgrounds/rose_alabaster_clean.png` | 1,815,514 | `9b131a5021f5744e86b64ba9a037a15536a4d1d46c97af16d2679fe2821b34e4` | **Completed and verified** |
| `games/auromatch/Assets/backgrounds/sandalwood_teak_clean.png` | 1,838,712 | `fb296dcdb8feafa2a92921c85c0322a9afcbc50051fe703a451e0646c039f99f` | **Completed and verified** |
| `games/auromatch/Assets/backgrounds/silver_granite_clean.png` | 1,805,835 | `79069bdb4825605dfbea65d49f7810ba47e2dd284687989df0b6ee454eb8bece` | **Completed and verified** |
| `games/auromatch/Assets/backgrounds/smoked_topaz_clean.png` | 1,818,837 | `23534d591d7dc40e9bbd57ea23b1a7af41a45c82c8d0d2f88cfbe03c301cb4d1` | **Completed and verified** |
| `games/auromatch/Assets/backgrounds/tuscan_terracotta_clean.png` | 1,861,687 | `27886e7db151b032137e8023c495c4a07874c02b4c43c5ad27c1ec07b1ef27a7` | **Completed and verified** |
| `games/auromatch/Assets/ashram_library.png` | 1,871,183 | `e9cae9976c9d1c95fee63781764e3ce6d8b8a21f5baab9388147d338f9024c08` | **Completed and verified** |
| `games/auromatch/Assets/auromatch_ui_mockup.png` | 900,733 | `9c940cc2ab35bcc2fb74b9b38a7ff591c7e0dad7e55a4891b2e1bf88f28fa958` | **Completed and verified** |
| `games/auromatch/Assets/banyan_tree_theme.png` | 1,862,859 | `54dea96d1024312b26270b1e7257d69a9022398f10d685d0d17671b563beea95` | **Completed and verified** |
| `games/auromatch/Assets/blooming_mandala.jpg` | 1,090,943 | `5a625d7b5abffea2e4931afcb9d7809b058892be0a9fff6b270a64016a2ef189` | **Completed and verified** |
| `games/auromatch/Assets/brass_altar_game.jpg` | 853,804 | `313abe973e4c0f2ce978e5c6312161055da76da19fbaa97ca26bdf3b5be5e5fc` | **Completed and verified** |
| `games/auromatch/Assets/brass_altar_game.png` | 1,615,069 | `3160d34d866c4b04e5a46fe8d2c41c96fc5fe26f59511ac92019c4d284f18635` | **Completed and verified** |
| `games/auromatch/Assets/coastline_theme.png` | 1,329,285 | `b13877aa3532032fd592386f4e0c9a00c630b9db3d17628a8d116238b6910609` | **Completed and verified** |
| `games/auromatch/Assets/golconde_slate.png` | 1,405,790 | `d483bc1660db05d66b9166e6796d2d9d641e222963738acfe04f98126b8014e7` | **Completed and verified** |
| `games/auromatch/Assets/golden_aura_stack.jpg` | 846,214 | `552e421c713dc04c02ea2d2bb6f06dc6135ce90d19cbad9965d5eec38515321d` | **Completed and verified** |
| `games/auromatch/Assets/golden_aura_stack.png` | 1,516,292 | `796877057352919290d9f960b55f6b4a6b2688089a87551fa0d7ff419e598921` | **Completed and verified** |
| `games/auromatch/Assets/matrimandir_petals.png` | 1,679,975 | `315fbe7efe30013bd2f285bc83c0ead4b615acd24f0c5bfae15f8e52c8427772` | **Completed and verified** |
| `games/auromatch/Assets/service_tree_theme.png` | 1,569,817 | `c6e16a55cae7f05a9c5a80e88ea471f2f1b87c9abd2740707c9c049084bb25aa` | **Completed and verified** |
