# B20 — Bucket 4: Shared Platform SDK Integration & Adapter Baseline Report

**Project:** AuroMasti v2.0.0 Beta  
**Workspace:** `C:\AuroMindPortal`  
**Branch:** `dev/studio-integration`  
**Remote:** `origin`  
**Target Delivery:** November 30, 2026  
**Integration Phase:** Bucket 4 Platform Assembly  
**Status:** **COMPLETE & TEST-VERIFIED (25/25 INTEGRATION TESTS PASSING)**

---

## 1. Architectural Overview & Scope

The AuroMind Shared Platform SDK (`assets/sdk/auromind-sdk.js`) and Game Adapter Contracts (`assets/sdk/auromind-adapters.js`) form the foundational platform layer unifying the three launch games:
1. **AuroMandala** (`games/auromandala`)
2. **MaaMATCH** (`games/auromatch`)
3. **AuroBlocks** (`games/auroblocks`)

The SDK provides client-side guest identity, authentication bridges, local-first save envelopes, telemetry relays, senior mode ergonomics, and return-to-portal navigation—without coupling games to cloud network dependencies or breaking offline play.

---

## 2. Canonical SDK Lifecycle & Identity Engine

### 2.1 Single-Device Guest Identity
- **Generation:** Generates RFC 4122 compliant UUIDv4 strings prefixed with `guest_` (`GUEST_ID_RE`).
- **Device Persistence:** Tiered persistence using primary IndexedDB (`auromind-identity`), with automatic fallback to localStorage (`auromind_guest_id`).
- **Multi-Tab Concurrency:** Uses the Web Locks API (`navigator.locks.request('auromind-identity-lock', ...)`) to ensure concurrent browser tabs or iframes resolve the identical guest ID without race conditions.
- **Account Transition:** When an unauthenticated guest logs in via Supabase Magic Link/OTP, the SDK retains the `guest_id`, links it in `public.guest_identity_links`, and invokes `reconcileGuestRecords` to preserve local player progress.

### 2.2 Storage Boundary Isolation
The SDK strictly separates platform data from game-owned databases:
- **Platform Reserved Keys:** `PLATFORM_LS_ROOT` (`auromind.platform`) and `PLATFORM_LS_PREFIX` (`auromind.platform.*`).
- **Game Storage Ownership:**
  - `auromandala`: `pranamandala_game_cache_v2`, `sankalpa_e2ee_vault`.
  - `auromatch`: `AuroMatchDB` (IndexedDB), `auromatch_player_state`, `auromatch_player_profiles`.
  - `auroblocks`: `auroblocks_player_save_v1`, `auroblocks_high_score`, `auroblocks_stages`.
- Games never mutate platform identity tables; the platform never alters game progression directly.

---

## 3. Game Adapter Contracts (`contractVersion: 1`)

Each release game implements the standard game adapter interface registered via `createAdapterRegistry(sdkHooks)`:

```
┌────────────────────────────────────────────────────────┐
│                   AuroMind Shared SDK                  │
│       Identity ─── Telemetry ─── Auth ─── Storage      │
└───────────────────────────┬────────────────────────────┘
                            │
            ┌───────────────┼───────────────┐
            ▼               ▼               ▼
     ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
     │ AuroMandala │ │  MaaMATCH   │ │ AuroBlocks  │
     │   Adapter   │ │   Adapter   │ │   Adapter   │
     └─────────────┘ └─────────────┘ └─────────────┘
```

| Dimension | AuroMandala (`auromandala`) | MaaMATCH (`auromatch`) | AuroBlocks (`auroblocks`) |
| :--- | :--- | :--- | :--- |
| **Contract Version** | `1` | `1` | `1` |
| **Integration Mode** | `native` | `native` | `native` |
| **Storage Kind** | `ls` | `idb+ls` | `ls` |
| **Owned DBs** | None | `AuroMatchDB` | None |
| **Offline Play** | `true` | `true` | `true` |
| **Local-Only Vaults**| `['sankalpa_e2ee_vault']` | None | None |
| **Cloud Sync** | Artwork & Progression | Progression & Scores | Stages & High Score |
| **Sankalpa Cloud Sync**| **`false` (STRICTLY FORBIDDEN)**| N/A | N/A |

---

## 4. Game-to-Portal Theater Navigation Contract

All three games support embedded iframe execution in the portal catalog with seamless return navigation:

1. **Floating Return Pill:** An unobtrusive, accessible return button (`#auromind-theater-return-btn`) is mounted fixed at `top: 12px; left: 12px` in each game when running inside an iframe.
2. **PostMessage Protocol:** Clicking the return button or in-game exit triggers:
   ```javascript
   window.parent.postMessage({
     type: 'AUROMIND_CLOSE_THEATER',
     gameId: '<canonical_game_id>'
   }, targetOrigin);
   ```
3. **Origin Validation:** Messages require verified HTTP(S) origin matching `window.location.origin` (or exact portal domain) to prevent cross-origin injection.
4. **Portal Teardown:** `portal.js` validates the game alias, detaches the game iframe to stop WebAudio contexts and free GPU memory, removes `.in-game-mode` styling, and smoothly returns to the catalog.

---

## 5. Offline Service Worker Delivery

- **Route Bypass:** Root service worker (`sw.js`) explicitly bypasses all requests matching `/games/*` (`url.pathname.startsWith('/games/')`), allowing nested game service workers (e.g. AuroBlocks and MaaMATCH SWs) full autonomy over their own assets.
- **SDK Precaching:** `sw.js` precaches `assets/sdk/auromind-sdk.js` and `assets/sdk/auromind-adapters.js`, guaranteeing that games can load the shared platform SDK even when launched completely offline without a network connection.

---

## 6. Verification Status

Verified through automated test suite `test-b20-bucket4-integration.test.js`:
- Adapter instantiation and contract conformity: **PASS**
- Registry registration and initialization: **PASS**
- Cross-tab identity consistency: **PASS**
- Service worker offline delivery: **PASS**
