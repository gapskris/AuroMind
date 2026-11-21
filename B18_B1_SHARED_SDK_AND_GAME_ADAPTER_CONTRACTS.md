# B18-B1 — Shared SDK and Game Adapter Contracts
## Standardizing Native Adapters Across All Six Launch Games (F-03)

**Author:** AuroMind Platform Architecture Team  
**Date:** November 21, 2026  
**Canonical Workspace:** `C:\AuroMindPortal`  
**Active Git Branch:** `dev/studio-integration`  
**Target Release:** January 1, 2027  
**Status:** ARCHITECTURAL DESIGN & CONTRACT SPECIFICATION ONLY  

---

## 1. Executive Summary & Problem Statement

Currently, only three of AuroMasti's six launch titles have standalone native adapter modules:
- **AuroMatch:** Native controller adapter in [storageAdapter.js](file:///C:/AuroMindPortal/games/auromatch/src/controllers/storageAdapter.js#L574-L658).
- **AuroMandala:** Standalone bridge in [auromandala-sdk-bridge.js](file:///C:/AuroMindPortal/games/auromandala/assets/auromandala-sdk-bridge.js).
- **AuroBlocks:** Standalone bridge in [auroblocks-sdk-bridge.js](file:///C:/AuroMindPortal/games/auroblocks/assets/auroblocks-sdk-bridge.js).

The remaining three games—**VAK Speech Control**, **Word Riddle**, and **VAK Living Sanctuary**—persist save data into localStorage keys (`auro_vak_user`, `word_discovery_save_v1`, `vak_sanctuary_codex_v1`) via inlined scripts. Because they lack standalone adapter modules implementing the `GameStorageAdapter` contract, the shared platform SDK cannot discover, validate, export, or synchronize their progress.

This document specifies the exact contract, implementation design, and lifecycle hooks for the three missing game adapters, and standardizes all six game adapters under a single, unified interface.

---

## 2. Standard Game Adapter Contract Interface (`GameStorageAdapter` v1)

Every game adapter must implement and export a factory function returning a frozen object adhering to the following interface:

```typescript
export interface GameStorageAdapter {
  gameId: string;                     // Unique lowercase slug (e.g. 'vak', 'word-riddle')
  adapterVersion: string;             // Semver string (e.g. '1.0.0')
  contractVersion: 1;                 // Platform contract version (must be 1)
  integrationMode: 'native';          // Must be 'native' for sync eligibility
  
  storage: {
    kind: 'idb+ls' | 'idb' | 'ls';   // Declared local storage engine
    ownedDatabases: string[];        // Array of owned IndexedDB database names
    ownedLocalStorageKeys: string[]; // Strict list of owned localStorage keys
    localOnlyVaults: string[];       // Keys excluded from cloud synchronization
  };

  capabilities: {
    offlinePlay: boolean;            // True (all games support offline play)
    localPersistence: boolean;       // True (all games persist locally)
    cloudSyncEligible: boolean;      // True (except games with declared local-only vaults)
    hasLocalOnlyVaults: boolean;     // True if local-only secrets exist
    localOnlyVaults: string[];       // Duplicate array of local-only vault names
  };

  /** Returns true if local non-empty player progress exists. */
  hasLocalProgress(): boolean | Promise<boolean>;

  /** Serializes game save state into a standardized GameSaveEnvelope. */
  exportEnvelope(guestId: string): Promise<GameSaveEnvelope>;

  /** Deserializes and applies a remote or merged GameSaveEnvelope into local storage. */
  applyEnvelope(envelope: GameSaveEnvelope): Promise<boolean>;

  /** Scoped initialization hook called when adapter is registered with the SDK. */
  init?(scopedContext: ScopedAdapterContext): Promise<void>;

  /** Cleanup hook called when game theater unmounts or SDK disposes. */
  dispose?(): Promise<void>;
}
```

---

## 3. Specification for the Three Missing Adapters

### A. VAK Speech Control (`games/vak/assets/vak-sdk-bridge.js`)

#### 1. Identity & Storage Ownership
- **File to Create:** `games/vak/assets/vak-sdk-bridge.js`
- **Game ID:** `'vak'`
- **Storage Kind:** `'ls'`
- **Owned Storage Keys:**
  - `auro_vak_user` (Primary profile & level index)
  - `vak_level_index` (Active level index integer)
  - `vak_sparks_balance` (Collected contemplative sparks)
  - `vak_player_profile` (Player display name & preferences)
  - `auro_vak_user_v2` (Secondary cache mirror)
- **Local-Only Vaults:** `[]` (None; speech puzzle progress is safe for cloud backup)
- **Cloud Sync Eligibility:** `true`

#### 2. Adapter Implementation Blueprint
```javascript
export function createVakGameAdapter() {
  const PRIMARY_KEY = 'auro_vak_user';
  const OWNED_KEYS = [
    PRIMARY_KEY,
    'vak_level_index',
    'vak_sparks_balance',
    'vak_player_profile',
    'auro_vak_user_v2'
  ];

  return {
    gameId: 'vak',
    adapterVersion: '1.0.0',
    contractVersion: 1,
    integrationMode: 'native',
    storage: {
      kind: 'ls',
      ownedDatabases: [],
      ownedLocalStorageKeys: [...OWNED_KEYS],
      localOnlyVaults: []
    },
    capabilities: {
      offlinePlay: true,
      localPersistence: true,
      cloudSyncEligible: true,
      hasLocalOnlyVaults: false,
      localOnlyVaults: []
    },
    hasLocalProgress: () => {
      try {
        if (typeof localStorage === 'undefined') return false;
        const raw = localStorage.getItem(PRIMARY_KEY);
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        return Boolean(parsed && (parsed.levelIndex > 0 || parsed.lotusPetals > 100 || (parsed.player && parsed.player.currentLevel > 1)));
      } catch {
        return false;
      }
    },
    exportEnvelope: async (guestId) => {
      let saveData = null;
      try {
        if (typeof localStorage !== 'undefined') {
          const raw = localStorage.getItem(PRIMARY_KEY);
          if (raw) saveData = JSON.parse(raw);
        }
      } catch {}

      const hasProgress = Boolean(saveData && (saveData.levelIndex > 0 || (saveData.player && saveData.player.currentLevel > 1)));
      const payload = {
        schemaVersion: 1,
        save: saveData || null,
        exportedAt: new Date().toISOString()
      };

      const checksum = await computePayloadChecksum(payload);

      return {
        envelopeVersion: 1,
        gameId: 'vak',
        gameSchemaVersion: 1,
        guestId,
        baseRevision: 0,
        clientUpdatedAt: new Date().toISOString(),
        isEmpty: !hasProgress,
        checksum,
        payload
      };
    },
    applyEnvelope: async (envelope) => {
      if (!envelope || !envelope.payload || !envelope.payload.save) return false;
      try {
        if (typeof localStorage !== 'undefined') {
          const save = envelope.payload.save;
          localStorage.setItem(PRIMARY_KEY, JSON.stringify(save));
          if (typeof save.levelIndex === 'number') {
            localStorage.setItem('vak_level_index', String(save.levelIndex));
          }
          if (typeof save.lotusPetals === 'number') {
            localStorage.setItem('vak_sparks_balance', String(save.lotusPetals));
          }
          return true;
        }
      } catch {}
      return false;
    },
    init: async (scopedContext) => {
      const guestId = scopedContext.getGuestId();
      if (guestId && typeof window !== 'undefined') {
        window.__AUROMIND_GUEST_ID__ = guestId;
      }
    }
  };
}
```

---

### B. Word Riddle (`games/word-riddle/assets/word-riddle-sdk-bridge.js`)

#### 1. Identity & Storage Ownership
- **File to Create:** `games/word-riddle/assets/word-riddle-sdk-bridge.js`
- **Game ID:** `'word-riddle'`
- **Storage Kind:** `'ls'`
- **Owned Storage Keys:**
  - `word_discovery_save_v1` (Array of solved riddle IDs, active theme, solved timestamps)
  - `word_riddle_settings` (Audio, difficulty, visual preferences)
- **Local-Only Vaults:** `[]`
- **Cloud Sync Eligibility:** `true`

#### 2. Adapter Implementation Blueprint
```javascript
export function createWordRiddleGameAdapter() {
  const SAVE_KEY = 'word_discovery_save_v1';
  const OWNED_KEYS = [SAVE_KEY, 'word_riddle_settings'];

  return {
    gameId: 'word-riddle',
    adapterVersion: '1.0.0',
    contractVersion: 1,
    integrationMode: 'native',
    storage: {
      kind: 'ls',
      ownedDatabases: [],
      ownedLocalStorageKeys: [...OWNED_KEYS],
      localOnlyVaults: []
    },
    capabilities: {
      offlinePlay: true,
      localPersistence: true,
      cloudSyncEligible: true,
      hasLocalOnlyVaults: false,
      localOnlyVaults: []
    },
    hasLocalProgress: () => {
      try {
        if (typeof localStorage === 'undefined') return false;
        const raw = localStorage.getItem(SAVE_KEY);
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        return Boolean(parsed && Array.isArray(parsed.solvedRiddles) && parsed.solvedRiddles.length > 0);
      } catch {
        return false;
      }
    },
    exportEnvelope: async (guestId) => {
      let saveData = null;
      try {
        if (typeof localStorage !== 'undefined') {
          const raw = localStorage.getItem(SAVE_KEY);
          if (raw) saveData = JSON.parse(raw);
        }
      } catch {}

      const hasProgress = Boolean(saveData && Array.isArray(saveData.solvedRiddles) && saveData.solvedRiddles.length > 0);
      const payload = {
        schemaVersion: 1,
        save: saveData || null,
        exportedAt: new Date().toISOString()
      };

      const checksum = await computePayloadChecksum(payload);

      return {
        envelopeVersion: 1,
        gameId: 'word-riddle',
        gameSchemaVersion: 1,
        guestId,
        baseRevision: 0,
        clientUpdatedAt: new Date().toISOString(),
        isEmpty: !hasProgress,
        checksum,
        payload
      };
    },
    applyEnvelope: async (envelope) => {
      if (!envelope || !envelope.payload || !envelope.payload.save) return false;
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(SAVE_KEY, JSON.stringify(envelope.payload.save));
          return true;
        }
      } catch {}
      return false;
    },
    init: async (scopedContext) => {
      const guestId = scopedContext.getGuestId();
      if (guestId && typeof window !== 'undefined') {
        window.__AUROMIND_GUEST_ID__ = guestId;
      }
    }
  };
}
```

---

### C. VAK Living Sanctuary (`games/vak-living-sanctuary/assets/vak-living-sanctuary-sdk-bridge.js`)

#### 1. Identity & Storage Ownership
- **File to Create:** `games/vak-living-sanctuary/assets/vak-living-sanctuary-sdk-bridge.js`
- **Game ID:** `'vak-living-sanctuary'`
- **Storage Kind:** `'ls'`
- **Owned Storage Keys:**
  - `vak_sanctuary_codex_v1` (Discovered wisdom words, contemplation reflections)
  - `vak_sanctuary_preferences` (Visual theme, audio tones)
- **Local-Only Vaults:** `[]`
- **Cloud Sync Eligibility:** `true`

#### 2. Adapter Implementation Blueprint
```javascript
export function createVakLivingSanctuaryGameAdapter() {
  const CODEX_KEY = 'vak_sanctuary_codex_v1';
  const OWNED_KEYS = [CODEX_KEY, 'vak_sanctuary_preferences'];

  return {
    gameId: 'vak-living-sanctuary',
    adapterVersion: '1.0.0',
    contractVersion: 1,
    integrationMode: 'native',
    storage: {
      kind: 'ls',
      ownedDatabases: [],
      ownedLocalStorageKeys: [...OWNED_KEYS],
      localOnlyVaults: []
    },
    capabilities: {
      offlinePlay: true,
      localPersistence: true,
      cloudSyncEligible: true,
      hasLocalOnlyVaults: false,
      localOnlyVaults: []
    },
    hasLocalProgress: () => {
      try {
        if (typeof localStorage === 'undefined') return false;
        const raw = localStorage.getItem(CODEX_KEY);
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        return Boolean(parsed && (
          (Array.isArray(parsed.unlockedWords) && parsed.unlockedWords.length > 0) ||
          (Array.isArray(parsed.discoveries) && parsed.discoveries.length > 0)
        ));
      } catch {
        return false;
      }
    },
    exportEnvelope: async (guestId) => {
      let codexData = null;
      try {
        if (typeof localStorage !== 'undefined') {
          const raw = localStorage.getItem(CODEX_KEY);
          if (raw) codexData = JSON.parse(raw);
        }
      } catch {}

      const hasProgress = Boolean(codexData && (
        (Array.isArray(codexData.unlockedWords) && codexData.unlockedWords.length > 0) ||
        (Array.isArray(codexData.discoveries) && codexData.discoveries.length > 0)
      ));

      const payload = {
        schemaVersion: 1,
        codex: codexData || null,
        exportedAt: new Date().toISOString()
      };

      const checksum = await computePayloadChecksum(payload);

      return {
        envelopeVersion: 1,
        gameId: 'vak-living-sanctuary',
        gameSchemaVersion: 1,
        guestId,
        baseRevision: 0,
        clientUpdatedAt: new Date().toISOString(),
        isEmpty: !hasProgress,
        checksum,
        payload
      };
    },
    applyEnvelope: async (envelope) => {
      if (!envelope || !envelope.payload || !envelope.payload.codex) return false;
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(CODEX_KEY, JSON.stringify(envelope.payload.codex));
          return true;
        }
      } catch {}
      return false;
    },
    init: async (scopedContext) => {
      const guestId = scopedContext.getGuestId();
      if (guestId && typeof window !== 'undefined') {
        window.__AUROMIND_GUEST_ID__ = guestId;
      }
    }
  };
}
```

---

## 4. Harmonization of Existing Game Adapters

The three existing game adapters will be updated in B18-B to adopt canonical SHA-256 checksumming and seamless integration with the SDK:

| Game Adapter | Existing Location | Changes Required in B18-B |
|:---|:---|:---|
| **AuroBlocks** | `games/auroblocks/assets/auroblocks-sdk-bridge.js` | Replace `blocks_${highScore}_${stages.length}` with `computePayloadChecksum(payload)`. Register `AuroBlocksMergeStrategy`. |
| **AuroMatch** | `games/auromatch/src/controllers/storageAdapter.js` | Replace `match_${completedLevelsCount}_${lotusPetalCount}` with `computePayloadChecksum(payload)`. Register `AuroMatchMergeStrategy`. Fix auto-heal validation. |
| **AuroMandala** | `games/auromandala/assets/auromandala-sdk-bridge.js` | Replace `mandala_${highestStageCleared}_${sessions.length}` with `computePayloadChecksum(payload)`. Integrate versioned artwork collection engine. |

---

## 5. Portal Registration & Lifecycle Hooks

When a game is launched in the portal theater (`assets/js/portal.js`), the portal dynamically registers the game's adapter with `sdk.adapters.register(adapter, { replace: true })`.

```
[ Portal Launches Game Theater: /games/<id>/index.html ]
                     |
                     v
   [ Game Loads <id>-sdk-bridge.js ]
                     |
                     v
   [ Calls sdk.init({ gameId, appVersion }) ]
                     |
                     v
   [ Calls sdk.adapters.register(createAdapter(), { replace: true }) ]
                     |
                     v
   [ Adapter init(scopedContext) receives platform guestId ]
                     |
                     v
   [ Game runs 100% locally; saves exportable via sdk.sync ]
```
