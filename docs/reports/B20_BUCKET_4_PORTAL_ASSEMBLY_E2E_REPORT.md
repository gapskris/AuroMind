# B20 — Bucket 4: Portal Assembly & End-to-End Game Lifecycle Report

**Project:** AuroMasti v2.0.0 Beta  
**Workspace:** `C:\AuroMindPortal`  
**Branch:** `dev/studio-integration`  
**Remote:** `origin`  
**Target Delivery:** November 30, 2026  
**Scope:** Portal Assembly, 3-Game Launch Catalogue & End-to-End Lifecycle Verification

---

## 1. Executive Summary

This report establishes the integrated end-to-end operational readiness of the AuroMasti portal (`index.html`, `assets/js/portal.js`) and its active release catalogue:
1. **AuroMandala** (`games/auromandala`)
2. **MaaMATCH** (`games/auromatch`)
3. **AuroBlocks** (`games/auroblocks`)

VAK source files remain archived in the repository (`games/vak`) but are verified strictly excluded from active portal cards, search filters, and release acceptance criteria.

All game iframe lifecycles, memory teardowns, cross-game storage isolations, and return navigation protocols were tested and verified.

---

## 2. Release Catalogue Audit (`index.html`)

A structural parse of `index.html` game cards confirmed:

| Game ID | Active Title | Genre / Category | Launch Status |
| :--- | :--- | :--- | :--- |
| `auromandala` | AuroMandala — Mindful Breath Sanctuary | Sacred Geometry & Mindful Breath | **ACTIVE RELEASE** |
| `auromatch` | MaaMATCH — Triple Garden of Solitaire | Zen Tile Matching & Solitaire | **ACTIVE RELEASE** |
| `auroblocks` | MaaBLOCK — Mindful Geometry | Polyomino · Sacred Sudoku | **ACTIVE RELEASE** |
| `vak` | VAK — The Vedic Sacred Word | Vedic Word Puzzles | **ARCHIVED / EXCLUDED** |
| `vak-living-sanctuary`| VAK Living Sanctuary | Interactive Word Sanctuary | **ARCHIVED / EXCLUDED** |

**Verification Evidence:** Test `Index.html catalogue contains exactly 3 games` passed in `test-b20-bucket4-integration.test.js`.

---

## 3. Theater Lifecycle & Return Navigation Protocol

```
[Portal Catalog Grid]
       │
       ▼  User clicks "Play Game ▶"
[openTheater(gameId)]
       ├── Adds .in-game-mode to <body>
       ├── Dispatches pushState({ inGame: true, gameId })
       ├── Mounts sandboxed <iframe> (allow="autoplay; fullscreen")
       └── Loads Game Shell
             │
             ├── Injects shared SDK
             ├── Mounts fixed floating button: ⌂ Portal (#auromind-theater-return-btn)
             │
             ▼  User clicks ⌂ Portal or finishes session
[exitToAuroMindPortal()]
       └── Dispatches postMessage({ type: 'AUROMIND_CLOSE_THEATER', gameId }, targetOrigin)
             │
             ▼
[portal.js message handler]
       ├── Validates event.origin against verified HTTP(S) allowlist
       ├── Validates gameId against GAME_ID_ALIASES
       └── closeTheater()
             ├── Sets iframe.src = 'about:blank' (Stops WebAudio & releases GPU)
             ├── Removes <iframe> from DOM
             ├── Removes .in-game-mode from <body>
             └── Restores Catalog View with focus management
```

---

## 4. End-to-End Integration Matrix (16 Scenarios)

| Scenario ID | Test Scenario | Execution Environment | Result | Evidence / Notes |
| :--- | :--- | :--- | :--- | :--- |
| **E2E-01** | First-time portal visitor | Local / Staging Browser | **PASS** | Auto-generates `guest_<uuid>` in IndexedDB; catalog displays 3 games. |
| **E2E-02** | Guest launches all 3 games | Local / Staging Browser | **PASS** | Shared SDK initializes cleanly in all 3 games; floating return pill mounts. |
| **E2E-03** | Guest progress persists on reload| Local Storage Simulation | **PASS** | High scores, cleared stages, and local artwork reload accurately. |
| **E2E-04** | Multiple guests remain isolated | Local Storage Simulation | **PASS** | Distinct guest IDs maintain separate save envelopes and profile state. |
| **E2E-05** | Guest creates an account | Staging Live (Supabase Auth) | **PASS** | Magic link dispatched; session established without dropping guest progress. |
| **E2E-06** | Guest records reconcile | Local / DB Staging | **PASS** | `reconcileGuestRecords` maps `guest_id` to `auth.users.id` without duplication. |
| **E2E-07** | AuroMandala artwork preserved | Local Canvas / IndexedDB | **PASS** | Local artworks persist across reloads; 10-snapshot ceiling respected. |
| **E2E-08** | Explicit artwork cloud backup | Local / Staging DB RLS | **PASS** | User-initiated upload targets `user-artwork/${uid}/...`; auto-upload blocked. |
| **E2E-09** | MaaMATCH progress persists | Local IndexedDB + LS | **PASS** | Dual-write preserves consecrations and themes across browser restarts. |
| **E2E-10** | AuroBlocks puzzle mechanics | Local Canvas / Solver | **PASS** | Unique tile values & each-tile-used-once rule preserved; 0 solver drift. |
| **E2E-11** | Session expiry and recovery | Local Mocked Token Expiry | **PASS** | Expired session falls back gracefully to local guest state without crashing. |
| **E2E-12** | Supabase offline fallback | Local Network Disconnect | **PASS** | Games load and save locally with 100% offline autonomy. |
| **E2E-13** | Service worker offline launch | Local SW Cache | **PASS** | `sw.js` serves cached shell and SDK assets; bypasses `/games/*`. |
| **E2E-14** | Game return navigation | Local DOM / Theater Event | **PASS** | `AUROMIND_CLOSE_THEATER` cleanly closes theater and stops WebAudio contexts. |
| **E2E-15** | Sign-out and re-entry | Local Auth Simulation | **PASS** | Session cleared; returning user defaults to clean guest profile. |
| **E2E-16** | Cross-user access denial | Live PostgreSQL RLS | **PASS** | User B blocked from accessing User A's artwork or game saves (0 rows). |

*Legend: Local = NodeJS test runner / simulated DOM; Mocked = mock bridge fallback; Staging Live = verified against staging endpoints / live database via Pooler.*

---

## 5. Affirmative Conclusion

The portal and all three games operate as a unified, resilient system. Offline capabilities, guest persistence, account transitions, and memory-safe theater lifecycles are fully established.
