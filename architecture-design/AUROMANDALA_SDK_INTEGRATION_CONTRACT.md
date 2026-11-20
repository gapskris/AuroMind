# AuroMind — AuroMandala Shared SDK Integration Contract & Future Source Architecture

**Document ID:** `AUROMANDALA_SDK_INTEGRATION_CONTRACT.md`  
**Date:** 2026-11-20  
**Status:** ACTIVE SPECIFICATION & INTERFACE CONTRACT (BATCH B3)  
**Target Game:** PranaMandala / AuroMandala (`games/auromandala/`)  
**Integration Status:** Safe Bridge Active in Production; Editable Source Integration Contract Ready  

---

## 1. Context and Architectural Baseline

During Batch B3 discovery, the source directory `games/auromandala/` was confirmed to contain the production-compiled Vite/Rollup bundle (`assets/index-DhYVrlzX.js`, 396 KB) without pre-compilation TypeScript/React source files (`src/`).

In accordance with strict architectural safety guidelines:
1. **Zero Risky Bundle Mutations:** The minified production bundle was not subjected to fragile binary/string patching.
2. **Safe Bridge Deployment:** A non-intrusive ES module bridge (`assets/auromandala-sdk-bridge.js`) was deployed and loaded in dependency order before the bundle in `index.html`.
3. **Formal Contract Specification:** This document establishes the binding integration contract, state mapping, and adapter implementation to be incorporated directly when editable source code becomes available.

---

## 2. Mandatory Architectural Boundaries

| System Domain | Authority & Storage Ownership |
| :--- | :--- |
| **Platform Identity** | Owned solely by `AuroMind.identity` (`AuroMindPlatformDB` / `auromind.platform.v1.guest`). AuroMandala never writes or modifies platform identity stores. |
| **Mandala Gameplay State** | Owned solely by AuroMandala (`pranamandala_game_cache_v2`). Contains 10 sacred stages, harmonic breathing metrics, streak records, and unlocked color palettes. |
| **Sankalpa Vault** | Owned solely by AuroMandala (`sankalpa_e2ee_vault`). Employs local-only Web Crypto PBKDF2/AES-GCM client-side encryption. **NEVER eligible for cloud synchronization.** |
| **Offline Independence** | AuroMandala must launch and function 100% offline via its nested Workbox PWA service worker (`games/auromandala/sw.js`). SDK initialization failure must never block the game loop. |

---

## 3. Game Adapter Specification (`createAuroMandalaGameAdapter`)

When editable React/TypeScript source is restored to `games/auromandala/src/`, the adapter must be instantiated and registered using the following frozen contract:

```typescript
import { defineGameAdapter, GameStorageAdapter } from '@/sdk/auromind-adapters';
import { AuroMind } from '@/sdk/auromind-sdk';

export const AUROMANDALA_CACHE_KEY = 'pranamandala_game_cache_v2';
export const SANKALPA_LOCAL_VAULT_ID = 'sankalpa_e2ee_vault';

export const auroMandalaAdapter = defineGameAdapter({
  gameId: 'auromandala',
  adapterVersion: '1.0.0',
  contractVersion: 1,
  integrationMode: 'native',
  storage: {
    kind: 'ls',
    ownedDatabases: [],
    ownedLocalStorageKeys: [AUROMANDALA_CACHE_KEY],
    localOnlyVaults: [SANKALPA_LOCAL_VAULT_ID]
  },
  capabilities: {
    offlinePlay: true,
    localPersistence: true,
    cloudSyncEligible: false, // Invariant: Sankalpa E2EE vault is strictly local-only
    hasLocalOnlyVaults: true,
    localOnlyVaults: [SANKALPA_LOCAL_VAULT_ID]
  },
  hasLocalProgress(): boolean {
    try {
      const raw = localStorage.getItem(AUROMANDALA_CACHE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      return Boolean(
        data &&
        (data.highestStageCleared > 0 ||
         (Array.isArray(data.sessions) && data.sessions.length > 0) ||
         (Array.isArray(data.savedArtworks) && data.savedArtworks.length > 0))
      );
    } catch {
      return false;
    }
  },
  async exportEnvelope(guestId: string) {
    let cache = null;
    try {
      const raw = localStorage.getItem(AUROMANDALA_CACHE_KEY);
      if (raw) cache = JSON.parse(raw);
    } catch {}

    const hasProgress = this.hasLocalProgress();

    return {
      envelopeVersion: 1,
      gameId: 'auromandala',
      gameSchemaVersion: 2,
      guestId,
      baseRevision: 0,
      clientUpdatedAt: new Date().toISOString(),
      isEmpty: !hasProgress,
      checksum: `mandala_${cache?.highestStageCleared || 0}_${cache?.sessions?.length || 0}`,
      payload: {
        schemaVersion: 2,
        cache,
        exportedAt: new Date().toISOString()
        // Note: Sankalpa plaintext secrets are strictly excluded from envelopes
      }
    };
  },
  async applyEnvelope(envelope: any): Promise<boolean> {
    if (!envelope || !envelope.payload || !envelope.payload.cache) return false;
    try {
      localStorage.setItem(AUROMANDALA_CACHE_KEY, JSON.stringify(envelope.payload.cache));
      return true;
    } catch {
      return false;
    }
  },
  async init(scopedContext: any): Promise<void> {
    const guestId = scopedContext.getGuestId();
    if (guestId && typeof window !== 'undefined') {
      (window as any).__AUROMIND_GUEST_ID__ = guestId;
    }
  }
});
```

---

## 4. Minimum Safe Integration Path for Editable Source

When the editable React repository is linked:

1. **Dependency Import:**
   Import `AuroMind` from the root shared SDK (`@/assets/sdk/auromind-sdk.js`).
2. **Hook Initialization in `App.tsx`:**
   ```typescript
   useEffect(() => {
     let mounted = true;
     async function bootstrapPlatform() {
       try {
         const sdk = window.AuroMind || (window.parent as any)?.AuroMind;
         if (sdk) {
           await sdk.init({ gameId: 'auromandala', appVersion: '1.0.0' });
           sdk.adapters.register(auroMandalaAdapter, { replace: true });
           await sdk.adapters.init('auromandala');
         }
       } catch (err) {
         console.warn('[AuroMandala] Platform SDK init non-fatal:', err);
       }
     }
     bootstrapPlatform();
     return () => { mounted = false; };
   }, []);
   ```
3. **Build Target:**
   Run Vite production build emitting assets to `games/auromandala/assets/`.
4. **PWA Precache Update:**
   Update `games/auromandala/sw.js` precache manifest entries to reflect new bundle revisions.

---

## 5. Security and Data Protection Invariants

1. **Zero Exfiltration of Sankalpa Vault:**
   Under no circumstances may encrypted or decrypted Sankalpa entries be included in platform telemetry, sync envelopes, or error logs.
2. **Deterministic Merge Policy:**
   If remote sync is ever enabled in future iterations, the resolution status for any conflict involving local-only vaults must resolve to `use_local` or require explicit user confirmation.
3. **Graceful Fallback:**
   If `localStorage` is disabled or full, the game defaults to in-memory state and continues rendering canvas geometries without crashing.
