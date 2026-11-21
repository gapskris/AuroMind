# B18-B1 — AuroMandala Artwork Protection Design
## Versioned Preservation, Conflict Recovery, and Anti-Loss Engine (F-01)

**Author:** AuroMind Platform Architecture Team  
**Date:** November 21, 2026  
**Canonical Workspace:** `C:\AuroMindPortal`  
**Active Git Branch:** `dev/studio-integration`  
**Target Release:** January 1, 2027  
**Status:** ARCHITECTURAL DESIGN SPECIFICATION ONLY  

---

## 1. Executive Summary & Problem Analysis (F-01)

AuroMandala is unique among AuroMasti titles: in addition to game progression (stages, scores, resonance), it serves as a digital creative sanctuary where players design sacred mandalas, intricate vector geometries, and personalized color palettes.

### Why Existing Implementation Causes Data Loss
In the current adapter bridge ([auromandala-sdk-bridge.js](file:///C:/AuroMindPortal/games/auromandala/assets/auromandala-sdk-bridge.js#L78-L86)):
1. **Checksum Blindness:** Checksum is calculated solely from `'mandala_' + highestStageCleared + '_' + sessions.length`. User creations in `savedArtworks` are completely omitted. If a user spends two hours crafting a new mandala, the checksum is identical to before. The sync engine assumes no changes occurred and skips synchronization.
2. **Blanket Overwrite:** When applying a remote save, `applyEnvelope` executes:
   ```javascript
   localStorage.setItem(CACHE_KEY, JSON.stringify(envelope.payload.cache));
   ```
   This replaces the entire local cache. Any local mandala created offline that was not present in the incoming cloud snapshot is **permanently destroyed**.

### Why Naive Append-Only Storage is Insufficient
- If a player edits an existing mandala (e.g. adjusts symmetries or recolors petals), an append-only system either duplicates the artwork indefinitely or fails to reflect modifications.
- If a player deletes an unwanted artwork, append-only storage cannot distinguish a deletion from a missing record, resurrecting deleted mandalas from cloud backups ("zombie artworks").
- If a player edits the same mandala on two devices while offline, simple union cannot determine which version is authoritative, risking silent destruction of creative intent.

---

## 2. The Versioned Artwork Model Specification

To guarantee that **no user-created artwork is ever silently overwritten or lost**, AuroMandala adopts a **Versioned Collection Model with Deletion Tombstones and Fork-on-Conflict Recovery**.

### A. Artwork Entity Schema
Every user-created artwork record within `savedArtworks` must conform to the following schema:

```typescript
export interface VersionedArtworkRecord {
  artworkId: string;           // Immutable RFC-4122 UUIDv4 minted upon creation
  version: number;             // Monotonic revision counter (starts at 1; increments on edit)
  title: string;               // User-defined title (e.g. "Lotus of Peace")
  stageId: number;             // Originating stage / sacred geometry mode
  geometry: {
    symmetryOrder: number;     // e.g. 6, 8, 12, 16-fold symmetry
    nodes: Array<{ x: number, y: number, r: number }>;
    strokes: Array<{ pathData: string, brushId: string }>;
    canvasScale: number;
  };
  palette: {
    paletteId: string;         // e.g. "awakened_gold", "transcendental_rose"
    colors: string[];          // Array of hex color strings
  };
  createdAtISO: string;        // Creation timestamp (UTC)
  updatedAtISO: string;        // Last edit timestamp (UTC)
  clientGuestId: string;       // Originating device guest ID
  deleted: boolean;            // Soft-deletion tombstone flag
  tombstonedAtISO: string | null; // Timestamp of deletion, or null if active
}
```

---

## 3. Artwork Lifecycle State Machine

```
   [ User Creates Mandala ]
              |
              v
   +----------------------+
   | Mint UUIDv4          |
   | version = 1          |
   | deleted = false      |
   +----------------------+
              |
              +-----------------------------------+
              |                                   |
    [ User Modifies Artwork ]            [ User Deletes Artwork ]
              |                                   |
              v                                   v
   +----------------------+              +----------------------+
   | version = version + 1|              | deleted = true       |
   | updatedAtISO = now   |              | tombstonedAtISO = now|
   +----------------------+              +----------------------+
              |                                   |
              +-----------------+-----------------+
                                |
                                v
               [ Included in Save Envelope ]
               [ Checksum = SHA-256 of All Records ]
```

### A. Artwork Creation
- Generates a persistent `artworkId = generateUuidV4()`.
- Sets `version = 1`, `deleted = false`, `tombstonedAtISO = null`.
- Appends to the local `savedArtworks` collection.

### B. Artwork Modification
- When a user modifies an existing artwork, `artworkId` and `createdAtISO` remain immutable.
- `version` increments by 1 ($1 \rightarrow 2 \rightarrow 3$).
- `updatedAtISO` updates to current UTC time.

### C. Artwork Deletion (Tombstone Pattern)
- To prevent cloud sync from resurrecting deleted artworks, deletions are recorded as **tombstones** (`deleted: true`, `tombstonedAtISO = new Date().toISOString()`).
- The UI filters out tombstoned records from the gallery view.
- During cloud synchronization, tombstones propagate to other devices, ensuring the artwork is deleted across all linked devices.
- Tombstones older than 180 days are garbage-collected locally after confirmed cloud synchronization.

---

## 4. Conflict Resolution Engine: Non-Destructive Fork-on-Conflict

When `AuroMandalaMergeStrategy` reconciles local and remote `savedArtworks` collections:

```javascript
export const AuroMandalaMergeStrategy = {
  gameId: 'auromandala',
  resolve: (localEnvelope, remoteEnvelope) => {
    const localCache = localEnvelope.payload?.cache || {};
    const remoteCache = remoteEnvelope.payload?.cache || {};

    // 1. Reconcile non-creative progression data
    const mergedHighestStage = Math.max(localCache.highestStageCleared || 0, remoteCache.highestStageCleared || 0);
    const mergedResonance = Math.max(localCache.totalResonance || 0, remoteCache.totalResonance || 0);
    const mergedTotalScore = Math.max(localCache.totalScore || 0, remoteCache.totalScore || 0);

    // Union gameplay sessions by timestamp
    const localSessions = Array.isArray(localCache.sessions) ? localCache.sessions : [];
    const remoteSessions = Array.isArray(remoteCache.sessions) ? remoteCache.sessions : [];
    const sessionMap = new Map();
    for (const s of [...localSessions, ...remoteSessions]) {
      if (s && s.date) sessionMap.set(s.date, s);
    }

    // 2. Reconcile Versioned Artworks Collection (Anti-Loss Engine)
    const localArtworks = Array.isArray(localCache.savedArtworks) ? localCache.savedArtworks : [];
    const remoteArtworks = Array.isArray(remoteCache.savedArtworks) ? remoteCache.savedArtworks : [];

    const artworkMap = new Map();
    const forkedArtworks = [];

    // Index all local artworks
    for (const art of localArtworks) {
      if (art && art.artworkId) {
        artworkMap.set(art.artworkId, art);
      }
    }

    // Merge remote artworks
    for (const remoteArt of remoteArtworks) {
      if (!remoteArt || !remoteArt.artworkId) continue;

      const localArt = artworkMap.get(remoteArt.artworkId);

      if (!localArt) {
        // Case 1: Remote artwork is new to this device -> Adopt it!
        artworkMap.set(remoteArt.artworkId, remoteArt);
      } else {
        // Case 2: Exists on both devices. Compare versions.
        if (remoteArt.version > localArt.version) {
          // Remote is strictly newer -> Adopt remote!
          artworkMap.set(remoteArt.artworkId, remoteArt);
        } else if (remoteArt.version < localArt.version) {
          // Local is strictly newer -> Keep local!
        } else {
          // Same version on both sides! Check if content diverged.
          const localGeometryStr = JSON.stringify(localArt.geometry);
          const remoteGeometryStr = JSON.stringify(remoteArt.geometry);

          if (localGeometryStr === remoteGeometryStr && localArt.deleted === remoteArt.deleted) {
            // Content identical -> No conflict.
          } else {
            // CRITICAL CONCURRENT EDIT: Both edited same version offline!
            // FORK-ON-CONFLICT: Keep local version; fork remote version with new UUID
            const forkedRecord = {
              ...remoteArt,
              artworkId: generateUuidV4(),
              version: 1,
              title: `${remoteArt.title || 'Mandala'} (Cloud Version)`,
              updatedAtISO: new Date().toISOString()
            };
            forkedArtworks.push(forkedRecord);
          }
        }
      }
    }

    const mergedArtworks = [...artworkMap.values(), ...forkedArtworks];

    const mergedPayload = {
      schemaVersion: 2,
      cache: {
        ...localCache,
        highestStageCleared: mergedHighestStage,
        totalResonance: mergedResonance,
        totalScore: mergedTotalScore,
        sessions: Array.from(sessionMap.values()),
        savedArtworks: mergedArtworks,
        updatedAtISO: new Date().toISOString()
      },
      exportedAt: new Date().toISOString()
    };

    return {
      status: 'auto_merged',
      resolvedPayload: mergedPayload
    };
  }
};
```

---

## 5. Non-Destructive `applyEnvelope` Implementation

`applyEnvelope` in `auromandala-sdk-bridge.js` will be refactored to use the non-destructive merge engine rather than blanket replacement:

```javascript
applyEnvelope: async (envelope) => {
  if (!envelope || !envelope.payload || !envelope.payload.cache) return false;
  try {
    if (typeof localStorage === 'undefined') return false;
    const incomingCache = envelope.payload.cache;
    
    // Read current local cache
    const currentRaw = localStorage.getItem(CACHE_KEY);
    const currentCache = currentRaw ? JSON.parse(currentRaw) : null;

    if (!currentCache || !Array.isArray(currentCache.savedArtworks) || currentCache.savedArtworks.length === 0) {
      // Clean local cache: Safe to apply incoming cache directly
      localStorage.setItem(CACHE_KEY, JSON.stringify(incomingCache));
      return true;
    }

    // Merge artworks collections safely using non-destructive merge logic
    const resolution = AuroMandalaMergeStrategy.resolve(
      { payload: { cache: currentCache } },
      { payload: { cache: incomingCache } }
    );

    localStorage.setItem(CACHE_KEY, JSON.stringify(resolution.resolvedPayload.cache));
    return true;
  } catch (err) {
    console.error('[AuroMandala Bridge] applyEnvelope failed:', err);
    return false;
  }
}
```

---

## 6. Migration of Legacy Artworks

During the first boot of B18-B:
1. When loading existing artworks from `pranamandala_game_cache_v2`:
2. Any artwork missing an `artworkId` is assigned a new `artworkId = generateUuidV4()`.
3. Any artwork missing `version` is assigned `version: 1`, `deleted: false`, `tombstonedAtISO: null`.
4. The normalized collection is persisted back to `localStorage`.
5. **Outcome:** 100% of player artworks created in prior batches are safely upgraded to the versioned protection engine without user action or data loss.
