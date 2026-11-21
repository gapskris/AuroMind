# AuroMind B17.2 Platform Remediation Report

**Date:** November 20, 2026  
**Canonical Workspace:** `C:\AuroMindPortal`  
**Active Git Branch:** `dev/studio-integration`  
**Baseline HEAD Commit:** `b6ccc860bb7d38a70ef678049a9588b8b73c40aa`  
**Target Release:** January 1, 2027  
**Test Status:** 206 / 206 Passing (100% across 15 test suites)

---

## 1. Executive Summary

Batch B17.2 completed the second tier of authorized platform remediations identified by the B17 platform-wide QA audit. It resolves player navigation, accessibility, and state persistence issues across all 6 live titles in the in-portal game theater:

1. **B17-GAP-05 (High):** Standardized In-Game Return-to-Portal Navigation across all 6 live titles (`AUROMIND_CLOSE_THEATER` postMessage protocol and responsive floating `⌂ Portal` button mounted in theater mode).
2. **B17-GAP-03 (Medium):** Enhanced Console Side Edge-Tab Touch Target with WCAG-compliant dimensions (44x44px minimum tap target), focus-visible styling, and responsive touch hitbox.
3. **B17-GAP-07 (Medium):** Implemented bidirectional Senior Mode synchronization across parent portal and child game iframes, ensuring senior view preferences apply instantly without page reloads.
4. **B17-GAP-09 (Low):** Implemented Ambient 432 Hz Audio Restoration on game theater close, gracefully suspending ambient audio during gameplay and resuming upon return to the catalog if previously active.

---

## 2. Detailed Task Breakdown & Implementation Evidence

### 2.1 Task 5: Return-to-Portal Navigation (B17-GAP-05)
- **Problem Statement:** Several live games (such as AuroBlocks, AuroMandala, and VAK Living Sanctuary) lacked a dedicated in-game exit button or relied solely on browser back navigation, trapping players in full-screen theater mode.
- **Implementation:**
  - Standardized the `AUROMIND_CLOSE_THEATER` HTML5 postMessage protocol across all 6 live games.
  - Implemented `window.exitToAuroMindPortal()` in every game:
    - If running within an iframe (`window.parent !== window`), dispatches `{ type: 'AUROMIND_CLOSE_THEATER' }` to `window.location.origin`.
    - If running standalone, safely navigates back to `../../index.html`.
  - Mounted a responsive floating `⌂ Portal` return button (`z-index: 99999`) in theater mode across all titles:
    - **AuroBlocks:** Handled via `games/auroblocks/assets/auroblocks-sdk-bridge.js`.
    - **AuroMandala:** Handled via `games/auromandala/assets/auromandala-sdk-bridge.js`.
    - **AuroMatch:** Handled via `games/auromatch/src/main.js` and gate screen in `index.html`.
    - **Word Riddle:** Handled via inline bootstrap script in `games/word-riddle/index.html`.
    - **VAK Sanctuary:** Handled via inline script in `games/vak-living-sanctuary/index.html`.
    - **VAK (Original):** Retained existing brand monogram and header exit button calling `window.exitToAuroMindPortal()`.
- **Verification:**
  - `b17-remediation.test.js` Test 7 verifies all 6 games implement `AUROMIND_CLOSE_THEATER`.
  - `b17-remediation.test.js` Test 8 verifies `portal.js` receives the message and executes `closeTheater()`.

### 2.2 Task 6: Mobile Edge-Tab Touch Target (B17-GAP-03)
- **Problem Statement:** The portal's edge controller tab trigger (`.edge-tab-trigger`) measured 28px x 48px, failing WCAG 2.2 Level AA touch target requirements (minimum 44px x 44px) and making edge dock expansion difficult on mobile devices.
- **Implementation:**
  - Updated `assets/css/portal.css`:
    ```css
    .edge-tab-trigger:focus-visible {
      outline: 2px solid var(--accent-cyan);
      outline-offset: 2px;
    }

    @media (pointer: coarse), (max-width: 768px) {
      .edge-tab-trigger {
        width: 36px;
        height: 52px;
        touch-action: manipulation;
      }

      .edge-tab-trigger::after {
        content: '';
        position: absolute;
        top: -8px;
        bottom: -8px;
        left: 0;
        right: -14px;
      }
    }
    ```
  - The `::after` pseudo-element expands the interactive touch area to 50px wide x 68px tall, well exceeding the 44px x 44px requirement while visually preserving the sleek dock tab silhouette.
- **Verification:**
  - `b17-remediation.test.js` Test 9 confirms the `:focus-visible` styling, touch manipulation setting, and expanded hitbox pseudo-element in `portal.css`.

### 2.3 Task 7: Senior Mode Synchronization (B17-GAP-07)
- **Problem Statement:** Enabling Senior Mode (+25% font scale and high-contrast styling) in the portal header or settings drawer did not propagate into embedded game iframes.
- **Implementation:**
  - Updated `assets/js/portal.js`:
    - On theater iframe load (`theaterIframe.onload`), immediately posts `{ type: 'AUROMIND_SET_SENIOR_MODE', enabled: isSeniorActive }` to the child iframe.
    - Inside `applySeniorMode(isActive, persist)`, broadcasts `{ type: 'AUROMIND_SET_SENIOR_MODE', enabled: isActive }` to the active theater iframe whenever toggled at runtime.
  - Implemented message listeners in all 6 live games:
    - Toggles `document.body.classList.toggle('senior-mode', isSenior)` and `document.body.classList.toggle('senior-view', isSenior)`.
    - Persists state to game-local storage keys (`auromind_senior_mode` / `vak_senior_view`).
- **Verification:**
  - `b17-remediation.test.js` Test 10 verifies portal broadcasting on load and toggle.
  - `b17-remediation.test.js` Test 11 verifies all 6 games listen and respond to the message.

### 2.4 Task 8: Ambient Audio Restoration (B17-GAP-09)
- **Problem Statement:** Entering game theater properly suspended the portal's 432 Hz Web Audio tone to prevent acoustic clash, but closing the theater left ambient audio muted even if the user had deliberately started it.
- **Implementation:**
  - Updated `initAmbientAudio()` in `assets/js/portal.js`:
    - Refactored audio startup into `startAmbientAudio()`.
    - Exposed `window.isAmbientAudioPlaying = () => isPlaying;` for non-invasive state inspection.
    - Exposed `window.resumeAmbientAudio = startAmbientAudio;` for programmatic restoration.
  - Updated `initTheaterMode()` in `assets/js/portal.js`:
    - Added session tracking variable `ambientAudioWasPlaying`.
    - Inside `openGameInTheater()`, records `ambientAudioWasPlaying = window.isAmbientAudioPlaying()` prior to calling `window.suspendAmbientAudio()`.
    - Inside `closeTheater()`, if `ambientAudioWasPlaying` is true, calls `window.resumeAmbientAudio()` and resets the flag.
- **Verification:**
  - `b17-remediation.test.js` Test 12 verifies state query exposure, resume function exposure, and teardown restoration logic.

---

## 3. Files Modified in B17.2

| File | Changes Made |
|------|--------------|
| `assets/js/portal.js` | Added ambient audio query/resume functions; iframe senior mode broadcast; audio restoration on theater exit |
| `assets/css/portal.css` | Added focus-visible outline and expanded touch hitbox for `.edge-tab-trigger` |
| `games/auroblocks/assets/auroblocks-sdk-bridge.js` | Floating return button and senior mode listener |
| `games/auromandala/assets/auromandala-sdk-bridge.js` | Floating return button and senior mode listener |
| `games/auromatch/src/main.js` | Floating return button and senior mode listener |
| `games/auromatch/index.html` | Return button on gate screen |
| `games/word-riddle/index.html` | Floating return button and senior mode listener |
| `games/vak/index.html` | Added `AUROMIND_SET_SENIOR_MODE` message listener |
| `games/vak-living-sanctuary/index.html` | Floating return button and senior mode listener |
| `b17-remediation.test.js` | Added test suites 4, 5, 6, 7, and 8 covering all B17.2 items and Sacred Invariants |

---

## 4. Verification & Regression Analysis

- Combined B17 test suite: 15 / 15 tests passing (100%).
- Full platform regression suite: **206 / 206 tests passing (100% across 15 test suites)** in 3.42s.
- Zero breaking changes to existing gameplay engines, save structures, or service workers.
