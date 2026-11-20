# AuroMind — Batch B2 Change Inventory
## File Manifest, SHA-256 Parity & Repository File-Budget Verification

**Repository:** `gapskris/AuroMind`  
**Branch:** `dev/studio-integration`  
**Batch:** B2 — Portal Integration & Offline SDK Support  
**Inventory Date:** 2026-11-19

---

## 1. Files Modified in Batch B2 (5 Files)

| File | Before Size / SHA-256 | After Size / SHA-256 | Summary of Changes |
| --- | --- | --- | --- |
| `index.html` | `92,978 B`<br>`e37f47f11c47f7c24a4f5357fde888e5ce0746862fc73ea0dc0d02f94f5e16f6` | `93,187 B`<br>`8afa0254f559ce47ab980eec8089afd24b4abd8337a0cfa8dc6b7d3d7089f0c5` | Added `<script type="module" src="assets/sdk/auromind-adapters.js">` and `<script type="module" src="assets/sdk/auromind-sdk.js">` before `assets/js/portal.js?v=3.7` under existing `script-src 'self'` CSP. |
| `assets/js/portal.js` | `30,764 B`<br>`8d05ceb3f37542b75676fa50a95469b16614ad16f6252cb4c42b13ae2700e9a5` | `34,890 B`<br>`9787c9a3a03853209416b53e7338e35d155412e45a11535ff51b19828c507583` | Added idempotent single-init `initPortalSDK()`, read-only frozen `window.AuroMindPortal` bridge, graceful failure handling, and explicit platform-identity protection (`isProtectedPlatformStorageKey`, `clearPortalPreferencesOnly`) in Settings Clear Cache. |
| `sw.js` | `7,938 B`<br>`69b66b55f6268fea6449aef563f2394b7bfc4e244e92ae43c0749eeb4122ee15` | `9,358 B`<br>`90e1a359f7759a0e807219b490e6d01ba7874d3a2c3862cadde28dfbb7e19f76` | Bumped `PORTAL_CACHE_NAME` to `auro-portal-v1.1.0`, added both shared SDK files and `portal.js?v=3.7` to `PORTAL_SHELL_ASSETS`, expanded non-portal private path bypass, and added narrowly scoped SDK Cache-First route strictly after `/games/*` bypass. |
| `.github/workflows/pages.yml` | `4,724 B`<br>`79d682702d0bbf1369fabdbe2a41c1797282768b35d527340d2e52da83960422` | `4,827 B`<br>`2c08f4ece4d259c60db3bef291ea95d7f4cd7ec0c0923d2c805f0cd77cb7083c` | Added `_site/assets/sdk/auromind-sdk.js` and `_site/assets/sdk/auromind-adapters.js` to the required runtime assets verification loop while retaining manual `workflow_dispatch:` only and all doc/test exclusions. |
| `server.test.js` | `3,921 B`<br>`63b8be04ab496b4e1cbd0a88747444f835ab62033e2a7ed707424afd03d4d433` | `23,014 B`<br>`d586fbf6922ccbd150bbc80358c2a78058f339ba923bd93a23f020742e57eb68` | Updated `sw.js` cache expectation to `auro-portal-v1.1.0` and added 6 automated B2 verification tests (module loading & CSP, single-init idempotency, failure resilience, Clear Cache identity protection, SW offline SDK & `/games/*` isolation, Pages workflow verification). |

---

## 2. Files Created in Batch B2 (3 Reports)

| File | Purpose |
| --- | --- |
| `architecture-design/B2_IMPLEMENTATION_REPORT.md` | Architecture and technical summary of B2 portal integration and offline SDK support |
| `architecture-design/B2_VALIDATION_REPORT.md` | Acceptance matrix (`B2-01`..`B2-14`), automated test results, and real-browser cold-offline evidence |
| `architecture-design/B2_CHANGE_INVENTORY.md` | Modified/created file manifest, protected-file SHA-256 parity table, and file-budget audit |

---

## 3. Protected & Baseline File Integrity Verification (100% SHA-256 Match)

| Protected File | Baseline & Post-B2 SHA-256 | Status |
| --- | --- | --- |
| `assets/sdk/auromind-sdk.js` | `174e31eab5d88a1ee391ec0f1bafc4eb75d71362680dbb038964d82c1b0c22b7` | **UNCHANGED** |
| `assets/sdk/auromind-adapters.js` | `2d168d746537b8fc3b5396432b44a8ed85a89fcdec0ea910d38d1aea67c72717` | **UNCHANGED** |
| `auromind-sdk.test.js` | `78652b4eedfba2dd5b1496c9e5cde2fe0be2449222280c1a0b73f8de4b1f131b` | **UNCHANGED** |
| `games/vak/index.html` | `04034bd881a478cd807b999220bdf3c228354e9674717113c510dca173c29d1f` | **UNCHANGED** |
| `games/auromatch/index.html` | `ab8cd4d467fd06b5cca1f75b9fa080c8b37f143a22961c172e0e5628df1c6337` | **UNCHANGED** |
| `games/auromatch/AuroMatch_Web_Prototype.html` | `a7d31aadba46f45716d06a3c73a6bfb2680a6da5ccf1464f2a7b71b01d03c777` | **UNCHANGED** |
| `games/auromatch/src/models/floraDatabase.js` | `689d035cd52abd8d342528d8c5f61f298916b8052b8287450be4931cf8ae1a3a` | **UNCHANGED** |
| `games/auromandala/index.html` | `67de600d2aea565b260514b3db71572db33b67b07148e4204bb4e0a685db71f0` | **UNCHANGED** |
| `games/auromandala/assets/index-DhYVrlzX.js` | `aa043f4d4d39e9797d128928b5d4cbbc444be1edd71d9f5c6cf876689dc5c80e` | **UNCHANGED** |
| `games/word-riddle/index.html` | `dbe68a5bac059ab81294c28830f5db403e9e1d2c0659c6e11ddec234e369e793` | **UNCHANGED** |
| `games/vak-living-sanctuary/index.html` | `ae3215f1896247ae4c775de728bb4bfcec155517621239b136730775613df24a` | **UNCHANGED** |
| `games/vak-living-sanctuary/assets/index-CUrzyYgb.js` | `f851ec703259c1e6c19b1241b67d8f6ed553fc3079e8f25656228571d3076d3f` | **UNCHANGED** |
| `games/auroblocks/index.html` | `2985732537e0731e0de76113015e89bbaa8178c0cb0dcb0078096b6e67dda5e6` | **UNCHANGED** |
| `phase0-audit/ARCHIVE.md` | `a01afe7d1454cb4245bc05eb4fc01444cf30980893fc37f2b98f14627c03c0a7` | **UNCHANGED** |
| `server.js` | `31484d05403cee29176c74661663709294b1f500045d856104470c078009162c` | **UNCHANGED** |
| `bun.lock` | `9d39d91a1e32ea38e92e66c2330ddbb6f7e7ebec3afced6ab1d300b6cf601b08` | **UNCHANGED** |
| `package.json` | `1a98cb5d521cd0d3788d24a256ab3b77200739e0c75784da4cb561c3d784ca68` | **UNCHANGED** |
| `manifest.json` | `9011269fefc2c21bd2250b2ad698e0d9ddda104bb98722449bdcce9b5a0b09b0` | **UNCHANGED** |

---

## 4. Repository Tracked-File Budget Verification

- **Pre-B2 candidate tracked files:** `984`
- **Net new files added in B2:** `+3` (`architecture-design/B2_IMPLEMENTATION_REPORT.md`, `B2_VALIDATION_REPORT.md`, `B2_CHANGE_INVENTORY.md`)
- **Post-B2 candidate tracked files:** **`987`**
- **Target budget ceiling:** `≤ 990` (headroom remaining: `3` files under `990`; `13` files under the observed `1,000`-file Google AI Studio GitHub import limit)
- **Ignored / excluded transient directories:** `.git`, `node_modules`, `.playwright-cli`, `_site`, `bun.lock`
