# B21 — Milestone Bucket 5: Portal Browser Acceptance Report

**Document Reference:** `docs/reports/B21_BUCKET_5_PORTAL_BROWSER_ACCEPTANCE.md`  
**Milestone:** B21 — Bucket 5: Staging Deployment, Live E2E Acceptance & Operational Closeout  
**Project:** AuroMasti v2.0.0 Beta  
**Workspace:** `C:\AuroMindPortal`  
**Date:** November 28, 2026  
**Status:** COMPLETE & VERIFIED

---

## 1. Executive Summary

This report establishes the browser acceptance verification for the AuroMasti Portal shell across desktop and mobile viewports using real browser test suites (`f1-f2-real-browser-validation.test.js` and `b17-3-e2e.test.js`). The portal renders exactly three launch titles in the catalogue, with zero concept card leakage or prototype exposure. Iframe theater mode seamlessly launches all three games and handles clean return navigation. Portal storage cleanup preserves all game saves, identity, and artwork intact.

---

## 2. Portal Catalogue & Release Invariant Verification

### 2.1 Release Invariant 1: Exactly Three Launch Titles
Test: `F1.1: Portal renders exactly 3 launch titles with zero concept card leakage`
- **Rendered Cards:** Exactly 3 game cards found in DOM:
  1. `auromandala` (AuroMandala)
  2. `auromatch` (MaaMATCH)
  3. `auroblocks` (AuroBlocks)
- **Concept / Prototype Leakage:** Zero. VAK and non-launch cards are absent from the DOM without deleting source directories.
- **Verification Result:** PASS (1051ms).

### 2.2 Search & Category Filtering
Test: `F1.2: Search filter dynamically isolates launch titles and handles empty matches`
- Typing "Maa" isolates `auromatch`.
- Typing "Blocks" isolates `auroblocks`.
- Typing "Mandala" isolates `auromandala`.
- Empty search string restores all 3 titles.
- Non-matching queries display the empty state with zero broken DOM nodes.
- **Verification Result:** PASS (1280ms).

---

## 3. Game Theater Navigation & Return Flow

Test: `F1.3: Game theater launches all 3 games in iframe context and handles clean return`
- Clicking any game card transitions the portal into theater mode:
  - Portal catalogue hides.
  - `#game-theater` opens with active iframe element.
  - Game URL loaded into iframe with `src="games/<id>/index.html"`.
- Clicking the return navigation button (`#btn-back-to-portal`):
  - Theater cleanly closes.
  - Iframe `src` is unloaded (`about:blank`) to release memory.
  - Portal catalogue is restored with preserved scroll position.
- Executed and verified for all 3 games sequentially:
  - AuroMandala: PASS
  - MaaMATCH: PASS
  - AuroBlocks: PASS
- **Verification Result:** PASS (2035ms).

---

## 4. Mobile Responsiveness & Viewport Invariants

Test: `F1.4: Mobile viewport renders responsive layout with zero horizontal overflow`
- Viewport set to `375 x 667` (iPhone SE standard mobile viewport).
- Document body width and `document.documentElement.scrollWidth` strictly match viewport width.
- Zero horizontal overflow (`scrollWidth <= clientWidth`).
- Game cards stack responsively in a single-column layout.
- Navigation bar, search input, and profile header resize cleanly.
- **Verification Result:** PASS (821ms).

---

## 5. Storage Preservation Under Portal Cleanup

Test: `F2.5: Real browser portal storage cleanup preserves game saves, identity, and artwork byte-for-byte`
- When user triggers portal preference reset (`clearPortalPreferencesOnly`):
  - Portal theme, UI volume, and layout preferences are cleared to defaults.
  - Player identity tokens (`auromind_identity_token`, `guest_id`) are preserved intact.
  - Game save keys (`save_auromandala`, `save_auromatch`, `save_auroblocks`) are untouched.
  - Local IndexedDB artwork and Sankalpa vaults are preserved byte-for-byte.
- **Verification Result:** PASS (977ms).

---

## 6. Compliance Sign-Off

- [x] Portal renders exactly 3 launch games; zero concept card leakage.
- [x] Dynamic search and filtering verified.
- [x] Iframe theater mode launches and returns cleanly for all 3 games.
- [x] Zero horizontal overflow on mobile viewports.
- [x] Storage cleanup preserves player identity and saves.
