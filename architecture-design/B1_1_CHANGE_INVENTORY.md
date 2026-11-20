# Batch B1.1 — Change Inventory

- **Batch:** B1.1 — Targeted SDK Hardening & Test Closure
- **Repository / Branch:** `gapskris/AuroMind` (`dev/studio-integration`)
- **Candidate Tracked-File Count Before B1.1:** `980`
- **Candidate Tracked-File Count After B1.1:** **`984`** (`+4` B1.1 architecture reports; **6 files below** the `990` guardrail and **16 files below** the `1,000` AI Studio import ceiling)
- **Git / Deploy Operations Performed:** None (`0` commits, `0` pushes, `0` merges, `0` deployments)

---

## 1. Modified Files (3 Existing B1 SDK/Test Files Only)

| File | Before B1.1 (Bytes / SHA-256) | After B1.1 (Lines / Bytes / SHA-256) | Summary of Changes |
|---|---|---|---|
| `assets/sdk/auromind-sdk.js` | `44,940` B<br>`774fe0da9fc569ff99470a6c7101355b0af8daecc9ea87100b473f1a63615aa6` | `1,686` lines / `55,854` B<br>`174e31eab5d88a1ee391ec0f1bafc4eb75d71362680dbb038964d82c1b0c22b7` | Implemented A-1 (`VersionError` guard), A-2 (confirmed `lastRepairedFrom`), A-3 (dead code removal), B-1 (serialization queue, pre-init peer buffering, post-init emit guard, synchronous pre-LS re-check + bounded post-write convergence), B-2 (`ensureGuestIdentity` single-flight), C-2 (`isProtectedPlatformKey` sync), and D-1 (`online`/`offline` listeners + `dispose()` teardown). |
| `assets/sdk/auromind-adapters.js` | `24,194` B<br>`dc61647301da3fcb1fc45d86094444915ae82ca088a839da18a3b6258ae87889` | `811` lines / `26,340` B<br>`2d168d746537b8fc3b5396432b44a8ed85a89fcdec0ea910d38d1aea67c72717` | Implemented C-1 (removed raw `adapter` property from `buildPublicRecord()`), C-2 (`PLATFORM_LS_ROOT` / `isProtectedPlatformKey()` + `assertNoStorageOwnershipConflict()`), and C-3 (strict RFC-4122 UUIDv4 `GUEST_ID_RE` validation in `validateSaveEnvelope()`). |
| `auromind-sdk.test.js` | `44,731` B<br>`5b1c6700561181ebc403aa992bf9a52fbb27b21a881d700e92b193269ce6e8e0` | `2,112` lines / `77,570` B<br>`78652b4eedfba2dd5b1496c9e5cde2fe0be2449222280c1a0b73f8de4b1f131b` | Upgraded `MockIndexedDB` (`dbVersions`/`VersionError`, `onAfterGet`/`onBeforePut`) and `MockWindow` (`listenerCount`), strengthened Tests #6, #7, #13, #15, #16, #17, #18, #22, #23, and added Tests #25–#31 (`31` total tests). |

---

## 2. Created Files (4 Required B1.1 Reports Only)

1. `architecture-design/B1_1_HARDENING_REPORT.md`
2. `architecture-design/B1_1_TEST_CLOSURE_REPORT.md`
3. `architecture-design/B1_1_CHANGE_INVENTORY.md`
4. `architecture-design/B1_1_VALIDATION_REPORT.md`

---

## 3. Explicitly Untouched Protected Surfaces (`0` Changes)

- All 6 games (`games/vak/`, `games/auromatch/`, `games/auromandala/`, `games/word-riddle/`, `games/vak-living-sanctuary/`, `games/auroblocks/`) — entry points, source code, compiled bundles, manifests, service workers, and protected corpora.
- Portal runtime & PWA (`index.html`, `manifest.json`, `sw.js`, `assets/js/portal.js`).
- Static server & B0 closeout artifacts (`server.js`, `server.test.js`, `.gitignore`, `bun.lock`, `.github/workflows/pages.yml`, `package.json`).
- Historical audit archive (`phase0-audit/ARCHIVE.md`) and all prior frozen design/B1 reports.
