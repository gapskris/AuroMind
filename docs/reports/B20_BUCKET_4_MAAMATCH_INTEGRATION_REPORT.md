# B20 — Bucket 4: MaaMATCH Guest Progress & Identity Adapter Report

**Project:** AuroMasti v2.0.0 Beta  
**Workspace:** `C:\AuroMindPortal`  
**Branch:** `dev/studio-integration`  
**Remote:** `origin`  
**Target Delivery:** November 30, 2026  
**Integration Scope:** MaaMATCH Solitaire (`games/auromatch`), Guest Identity & Progression Reconciliation

---

## 1. Executive Summary

MaaMATCH (Zen Tile Solitaire) integrates with the AuroMind Shared Platform SDK through `games/auromatch/Assets/auromatch-sdk-bridge.js` and `games/auromatch/src/controllers/storageAdapter.js`.

The integration guarantees:
1. **Progression Integrity:** Levels cleared, high scores, consecrations, and unlocked tile themes persist reliably across reloads.
2. **Dual-Tier Storage Architecture:** Implements dual-write with auto-healing between IndexedDB (`AuroMatchDB`) and localStorage to prevent browser storage eviction.
3. **Player & Profile Isolation:** Player profiles remain independent; multiple guests on the same device or distinct cloud accounts never merge progress uncontrollably.
4. **Idempotent Account Reconciliation:** When a guest transitions to an authenticated account, progress reconciles cleanly without duplicate level counts or score inflation.

---

## 2. Storage Architecture & Storage Keys

MaaMATCH declares the following owned storage keys in its adapter (`createAuroMatchGameAdapter`):
- `AuroMatchDB` (IndexedDB database)
- `auromatch_player_state`
- `auromatch_player_profiles`
- `auromatch_standard_theme`
- `auromatch_has_entered_sanctuary`
- `auro_match_user`
- `auro_match_consecrations`
- `auro_match_unlocked_tiles`
- `auro_match_teachings`

### 2.1 Dual-Write & Auto-Healing
If a player's browser clears localStorage (e.g. Safari 7-day ITP policy), the storage adapter automatically reconstitutes game state from IndexedDB (`autoHealFromIndexedDB`), ensuring progress is preserved.

---

## 3. Guest Identity & Account Reconciliation Workflow

```
[Unauthenticated Player]
       │
       ▼
[SDK Generates Guest ID: guest_<uuid>]
       │
       ▼
[Dual-Write to AuroMatchDB & localStorage]
       │
       ▼  (Player decides to sign up via Magic Link)
[Supabase Auth Login: auth.users.id]
       │
       ▼
[public.guest_identity_links (guest_id ↔ user_id)]
       │
       ▼
[SDK Triggers reconcileGuestRecords]
       │
       ▼
[Idempotent Progression Merge (Max Score, Deduplicated Themes)]
```

### 3.1 Idempotency Guarantees
Applying the same save envelope multiple times produces identical state without score doubling or level increment bugs, as validated in test `MaaMATCH preserves progression and does not duplicate on repeated reconciliation`.

---

## 4. Return Navigation & Senior Mode Ergonomics

- **Return Navigation:** A floating button `#auromind-theater-return-btn` triggers `window.exitToAuroMindPortal()`, dispatching `AUROMIND_CLOSE_THEATER` with verified origin to `portal.js`.
- **Senior Mode:** `window.addEventListener('message')` listens for `AUROMIND_SET_SENIOR_MODE` from the portal parent window, toggling high-contrast styling and larger card tap targets for senior players.

---

## 5. Verification Test Evidence

Verified in `test-b20-bucket4-integration.test.js`:
- Export valid save envelope with checksum: **PASS**
- Idempotent progression preservation on repeated reconciliation: **PASS**
- Cross-player guest isolation: **PASS**
- All 13 game integration suites in `b3-game-integration.test.js` & `b11-game-integration.test.js`: **PASS**
