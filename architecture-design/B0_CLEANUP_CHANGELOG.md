# Batch B0 — Safe Cleanup Changelog

- **Programme:** AuroMind Platform Modernization
- **Batch:** B0 — Repository File-Budget & Documentation Safety
- **Execution Policy:** Lossless-only deduplication of conclusively proven zero-reference binary duplicates
- **Files Removed:** `35`
- **Total Redundant Bytes Freed:** `54,058,611` bytes (`51.55 MiB`)
- **Unique Bytes Lost:** `0` bytes (100% of removed files have a verified exact SHA-256 identical twin preserved untouched in the repository)
- **Net Tracked-File Count Change:** `1,001 → 966` (cleanup) `→ 970` (after adding the 4 Batch B0 deliverable reports)

---

## 1. Safety Criteria Enforced Prior to Removal

Every file listed below passed all five automated verification gates before `fs.unlinkSync()` was invoked:

1. **Zero Static References:** `0` occurrences of the relative path AND `0` occurrences of the bare filename across all `.html`, `.htm`, `.js`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.css`, `.json`, `.webmanifest`, `.svg`, `.xml`, `.txt`, `.yml`, `.yaml`, and `README.md` files (including root `sw.js`, all 6 game service workers, all manifests, `index.html`, `portal.js`, `AuroMatch_Web_Prototype.html`, and all `games/auromatch/src/**` modules).
2. **Zero Dynamic Path Construction Risk:** Full regex inspection of `games/auromatch/` confirmed that the only dynamic template path is `` `./Assets/themes/${themeId}/tile_${...}.png` `` (`themeManager.js:540`). All `Assets/backgrounds/` paths are statically enumerated on the 20 active `REALMS` objects (40 files, all untouched).
3. **Exact Byte-for-Byte SHA-256 Duplicate Verified:** SHA-256 digest of the removed file matched the SHA-256 digest of its preserved twin both immediately before and immediately after deletion.
4. **Non-Protected Asset:** Not part of any protected corpus, compiled bundle, active game runtime, portal precache, or explicitly excluded file.
5. **Reversibility:** Any removed file can be restored byte-for-byte either from Git commit `67d04726fb82cdb3d9f253bd36e627fe0d7aef20` or by copying its preserved identical twin.

---

## 2. Group A — Duplicate Top-Level Copies in `games/auromatch/Assets/` (12 Files Removed)

These 12 image files sat directly under `games/auromatch/Assets/` as unreferenced legacy copies of identical files already stored in `games/auromatch/Assets/backgrounds/`.

| # | Removed File Path | Size (Bytes) | Original SHA-256 | Preserved Identical Twin (Matching SHA-256) | Refs (Path / Name) |
|---:|---|---:|---|---|---|
| 1 | `games/auromatch/Assets/ashram_library.png` | 1,871,183 | `e9cae9976c9d1c95fee63781764e3ce6d8b8a21f5baab9348a1f4758f2fca7a5` | `games/auromatch/Assets/backgrounds/ashram_library.png` | `0 / 0` |
| 2 | `games/auromatch/Assets/auromatch_ui_mockup.png` | 900,733 | `9c940cc2ab35bcc2fb74b9b38a7ff591c7e0dad7e55a48990b241e695c271d2f` | `games/auromatch/Assets/backgrounds/auromatch_ui_mockup.png` | `0 / 0` |
| 3 | `games/auromatch/Assets/banyan_tree_theme.png` | 1,862,859 | `54dea96d1024312b26270b1e7257d69a9022398f10d685d09a409cf95fbb25eb` | `games/auromatch/Assets/backgrounds/banyan_tree_theme.png` | `0 / 0` |
| 4 | `games/auromatch/Assets/blooming_mandala.jpg` | 1,090,943 | `5a625d7b5abffea2e4931afcb9d7809b058892be0a9fff65be98da6b67505aac` | `games/auromatch/Assets/backgrounds/blooming_mandala.jpg` | `0 / 0` |
| 5 | `games/auromatch/Assets/brass_altar_game.jpg` | 853,804 | `313abe973e4c0f2ce978e5c6312161055da76da19fbaa97634b333a779c4bcff` | `games/auromatch/Assets/backgrounds/brass_altar_game.jpg` | `0 / 0` |
| 6 | `games/auromatch/Assets/brass_altar_game.png` | 1,615,069 | `3160d34d866c4b04e5a46fe8d2c41c96fc5fe26f59511ac2bfc1239a95642bb9` | `games/auromatch/Assets/backgrounds/brass_altar_game.png` | `0 / 0` |
| 7 | `games/auromatch/Assets/coastline_theme.png` | 1,329,285 | `b13877aa3532032fd592386f4e0c9a00c630b9db3d176281ef7342788e92d196` | `games/auromatch/Assets/backgrounds/coastline_theme.png` | `0 / 0` |
| 8 | `games/auromatch/Assets/golconde_slate.png` | 1,405,790 | `d483bc1660db05d66b9166e6796d2d9d641e222963738ac550db303797726e5d` | `games/auromatch/Assets/backgrounds/golconde_slate.png` | `0 / 0` |
| 9 | `games/auromatch/Assets/golden_aura_stack.jpg` | 846,214 | `552e421c713dc04c02ea2d2bb6f06dc6135ce90d19cbad9bd9ada64ac6d0b28c` | `games/auromatch/Assets/backgrounds/golden_aura_stack.jpg` | `0 / 0` |
| 10 | `games/auromatch/Assets/golden_aura_stack.png` | 1,516,292 | `796877057352919290d9f960b55f6b4a6b2688089a87551ddbd8beebe136932a` | `games/auromatch/Assets/backgrounds/golden_aura_stack.png` | `0 / 0` |
| 11 | `games/auromatch/Assets/matrimandir_petals.png` | 1,679,975 | `315fbe7efe30013bd2f285bc83c0ead4b615acd24f0c5bfc0b4528355740d00b` | `games/auromatch/Assets/backgrounds/matrimandir_petals.png` | `0 / 0` |
| 12 | `games/auromatch/Assets/service_tree_theme.png` | 1,569,817 | `c6e16a55cae7f05a9c5a80e88ea471f2f1b87c9abd274072eccd7821bad9aacf` | `games/auromatch/Assets/backgrounds/service_tree_theme.png` | `0 / 0` |

**Group A Subtotal:** `12` files (`16,541,964` bytes freed).

---

## 3. Group B — Unreferenced Exact-Duplicate `*_clean.png` Backgrounds (19 Files Removed)

These 19 `*_clean.png` files belonged to unused/unreferenced theme concepts in `games/auromatch/Assets/backgrounds/`. Neither the `<stem>_clean.png`, nor `<stem>.png`, nor `<stem>` itself appears anywhere in `themeManager.js` or any other file in the repository, and each `*_clean.png` was a byte-for-byte SHA-256 copy of its corresponding `<stem>.png`, which remains preserved untouched.

| # | Removed File Path | Size (Bytes) | Original SHA-256 | Preserved Identical Twin (Matching SHA-256) | Refs (Clean / Base / Stem) |
|---:|---|---:|---|---|---|
| 13 | `games/auromatch/Assets/backgrounds/aegean_seaglass_clean.png` | 1,843,972 | `bcb89ff2707e47aa71fc575098a9f3cf8fc705f5231cf0cf1624662d1f3a2944` | `games/auromatch/Assets/backgrounds/aegean_seaglass.png` | `0 / 0 / 0` |
| 14 | `games/auromatch/Assets/backgrounds/amethyst_geode_clean.png` | 1,865,169 | `fe567ecece619d6679f3fe4f0a8f59e3f324f70d4c9fcb72eb7cf897cc50f75d` | `games/auromatch/Assets/backgrounds/amethyst_geode.png` | `0 / 0 / 0` |
| 15 | `games/auromatch/Assets/backgrounds/celestial_opal_clean.png` | 1,851,551 | `ed33b5959e8e469671aa89e1122b1586fb8114fca9d125ca267be4d2304498df` | `games/auromatch/Assets/backgrounds/celestial_opal.png` | `0 / 0 / 0` |
| 16 | `games/auromatch/Assets/backgrounds/desert_sandstone_clean.png` | 1,828,493 | `f1ed5f4265fe06385db2395be97b5b5050562b95702907ca29fc16a3bd6b390e` | `games/auromatch/Assets/backgrounds/desert_sandstone.png` | `0 / 0 / 0` |
| 17 | `games/auromatch/Assets/backgrounds/golden_honeycomb_clean.png` | 1,862,050 | `f2b1545fca252bd8389afac8f1f8d543b876836f9f59090f036b38b0bc6fdb59` | `games/auromatch/Assets/backgrounds/golden_honeycomb.png` | `0 / 0 / 0` |
| 18 | `games/auromatch/Assets/backgrounds/kyoto_bamboo_clean.png` | 1,837,870 | `dd07c9c2179d8a04ac58b7b263530d2c71d8ffe62be38eaa7deb8446b66e6b9a` | `games/auromatch/Assets/backgrounds/kyoto_bamboo.png` | `0 / 0 / 0` |
| 19 | `games/auromatch/Assets/backgrounds/kyoto_porcelain_clean.png` | 1,761,827 | `d4f2169f3b7692d96c115dd8a44f86761d7d40131630b3605a262c646a29ca99` | `games/auromatch/Assets/backgrounds/kyoto_porcelain.png` | `0 / 0 / 0` |
| 20 | `games/auromatch/Assets/backgrounds/lapis_lazuli_clean.png` | 1,835,545 | `860b27b879419a6fa1651ad0b11dbb149df70bbb7e34ed05c0e57d85863f04a4` | `games/auromatch/Assets/backgrounds/lapis_lazuli.png` | `0 / 0 / 0` |
| 21 | `games/auromatch/Assets/backgrounds/midnight_obsidian_clean.png` | 1,765,558 | `82ce4cbd37c3832e47063d3e01157c9d4f1f6f13088cc74ddb5f832a10ed30d7` | `games/auromatch/Assets/backgrounds/midnight_obsidian.png` | `0 / 0 / 0` |
| 22 | `games/auromatch/Assets/backgrounds/moroccan_zellige_clean.png` | 1,845,752 | `db15fca8b9cd32ad0d4981fb617029e08dad34c7cccbe44cce940308679f0e26` | `games/auromatch/Assets/backgrounds/moroccan_zellige.png` | `0 / 0 / 0` |
| 23 | `games/auromatch/Assets/backgrounds/murano_crystal_clean.png` | 1,828,094 | `ad8afda6ef949602e2874d7409e43eaf715d22a98cf0a0a1c039228b2c7f8c82` | `games/auromatch/Assets/backgrounds/murano_crystal.png` | `0 / 0 / 0` |
| 24 | `games/auromatch/Assets/backgrounds/nacre_pearl_clean.png` | 1,813,619 | `2e9a4418d4933259a394dc1c73252f02dc5bc2cb6584872af1b4a14749436016` | `games/auromatch/Assets/backgrounds/nacre_pearl.png` | `0 / 0 / 0` |
| 25 | `games/auromatch/Assets/backgrounds/nordic_pine_clean.png` | 1,784,432 | `5ca5147cba55c69a0a70cc174e2ef7ade629967117671f1a19398160b4f4126d` | `games/auromatch/Assets/backgrounds/nordic_pine.png` | `0 / 0 / 0` |
| 26 | `games/auromatch/Assets/backgrounds/river_basalt_clean.png` | 1,795,891 | `fff8698a33a67b01b318a7b0e27be86e97e45cdb3eeb746fd4d0d04e7e7e693c` | `games/auromatch/Assets/backgrounds/river_basalt.png` | `0 / 0 / 0` |
| 27 | `games/auromatch/Assets/backgrounds/rose_alabaster_clean.png` | 1,815,514 | `9b131a5021f5744e86b64ba9a037a15536a4d1d46c97af10e5540429c8069282` | `games/auromatch/Assets/backgrounds/rose_alabaster.png` | `0 / 0 / 0` |
| 28 | `games/auromatch/Assets/backgrounds/sandalwood_teak_clean.png` | 1,838,712 | `fb296dcdb8feafa2a92921c85c0322a9afcbc50051fe703ee0a87bf538b59892` | `games/auromatch/Assets/backgrounds/sandalwood_teak.png` | `0 / 0 / 0` |
| 29 | `games/auromatch/Assets/backgrounds/silver_granite_clean.png` | 1,805,835 | `79069bdb4825605dfbea65d49f7810ba47e2dd284687989d546f54d2124d7a15` | `games/auromatch/Assets/backgrounds/silver_granite.png` | `0 / 0 / 0` |
| 30 | `games/auromatch/Assets/backgrounds/smoked_topaz_clean.png` | 1,818,837 | `23534d591d7dc40e9bbd57ea23b1a7af41a45c82c8d0d2f8a2d5a1836405a9e3` | `games/auromatch/Assets/backgrounds/smoked_topaz.png` | `0 / 0 / 0` |
| 31 | `games/auromatch/Assets/backgrounds/tuscan_terracotta_clean.png` | 1,861,687 | `27886e7db151b032137e8023c495c4a07874c02b4c43c5a8ab8f449d9bc501d4` | `games/auromatch/Assets/backgrounds/tuscan_terracotta.png` | `0 / 0 / 0` |

**Group B Subtotal:** `19` files (`34,660,408` bytes freed).

---

## 4. Group C — Unreferenced Exact-Duplicate Legacy Portal Thumbnails (4 Files Removed)

These 4 legacy thumbnails in `assets/thumbnails/` were superseded by current portal card assets (not referenced in `index.html`, `portal.js`, `manifest.json`, or `sw.js`'s 54 precache entries) and were exact SHA-256 duplicates of existing game assets that remain preserved untouched.

| # | Removed File Path | Size (Bytes) | Original SHA-256 | Preserved Identical Twin (Matching SHA-256) | Refs (Path / Name) |
|---:|---|---:|---|---|---|
| 32 | `assets/thumbnails/auroblocks-gameplay.webp` | 57,688 | `f02e475719d58a0c5ae7b96b4016ce3ca3b963e32911438d3ee329b673c39f5d` | `games/auroblocks/assets/artwork/mode-classic-flow.webp` | `0 / 0` |
| 33 | `assets/thumbnails/auromatch.jpg` | 1,090,943 | `5a625d7b5abffea2e4931afcb9d7809b058892be0a9fff65be98da6b67505aac` | `games/auromatch/Assets/backgrounds/blooming_mandala.jpg` | `0 / 0` |
| 34 | `assets/thumbnails/logic_riddles.jpg` | 853,804 | `313abe973e4c0f2ce978e5c6312161055da76da19fbaa97634b333a779c4bcff` | `games/auromatch/Assets/backgrounds/spirit_altar.jpg` | `0 / 0` |
| 35 | `assets/thumbnails/mahjong_zen.jpg` | 853,804 | `313abe973e4c0f2ce978e5c6312161055da76da19fbaa97634b333a779c4bcff` | `games/auromatch/Assets/backgrounds/spirit_altar.jpg` | `0 / 0` |

**Group C Subtotal:** `4` files (`2,856,239` bytes freed).

---

## 5. Files Explicitly Excluded & Left Untouched

- `games/auromatch/AuroMatch_Web_Prototype.html` — explicitly forbidden from removal in Batch B0.
- `games/auromatch/Assets/blooming_mandala.png` — SHA-256 differs from `Assets/backgrounds/blooming_mandala.png`; left untouched.
- `games/auromatch/Assets/themes/**` — dynamically loaded by `themeManager.js`; left untouched.
- `assets/thumbnails/{auroblocks.jpg,auromandala.png,block_puzzle.png,merge_games.png,wordriddle.jpg}` — unreferenced, but have no exact byte-for-byte duplicate preserved elsewhere; left untouched.
- All 7 frozen documents in `architecture-design/` and `phase0-audit/ARCHIVE.md` — left untouched.
- `server.js`, `server.test.js`, `sw.js`, `manifest.json`, `.gitignore`, `bun.lock`, `.playwright-cli/` — left untouched.
- All 6 games' source code, compiled bundles, protected corpora, service workers, and active assets — left untouched.
