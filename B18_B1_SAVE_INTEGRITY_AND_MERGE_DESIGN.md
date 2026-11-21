# B18-B1 — Save Integrity and Merge Design
## Cryptographic Checksums (F-02) and Bespoke Game Merge Policies (F-07)

**Author:** AuroMind Platform Architecture Team  
**Date:** November 21, 2026  
**Canonical Workspace:** `C:\AuroMindPortal`  
**Active Git Branch:** `dev/studio-integration`  
**Target Release:** January 1, 2027  
**Status:** ARCHITECTURAL DESIGN SPECIFICATION ONLY  

---

## 1. Executive Summary & Audit of Weak Checksums (F-02)

The B18-A3 audit revealed that game save envelopes in existing bridge adapters rely on fragile, ad-hoc string concatenations rather than authentic payload integrity checksums:

```javascript
// AuroBlocks existing checksum:
checksum: 'blocks_' + (saveData?.highScore || 0) + '_' + (saveData?.stages?.length || 0)

// AuroMatch existing checksum:
checksum: 'match_' + (profileState?.progression?.completedLevelsCount || 0) + '_' + (profileState?.profile?.lotusPetalCount || 0)

// AuroMandala existing checksum:
checksum: 'mandala_' + (cacheData?.highestStageCleared || 0) + '_' + (cacheData?.sessions?.length || 0)
```

### Critical Flaws in Current Checksums
1. **Mutation Blindness:** In AuroBlocks, if a player improves their score on an already cleared stage in `stageScores`, neither `highScore` nor `stages.length` changes. The checksum is identical.
2. **Settings & Reflections Blindness:** In AuroMatch, if a player records new personal reflections or unlocks tiles within the same level count, the checksum is identical.
3. **Artwork Blindness (CRITICAL):** In AuroMandala, user-created mandalas in `savedArtworks` are completely omitted from the string. A player can create ten new mandalas, but the checksum remains unchanged.
4. **False Parity Skipping:** Under **Invariant 3** (`localEnvelope.checksum === remoteEnvelope.checksum`), the SDK treats identical checksums as identical data. Because weak checksums miss internal mutations, **the sync engine falsely skips syncing modified save files**, causing silent cloud backup failure.

---

## 2. Canonical Payload Serialization & SHA-256 Web Crypto Checksum Specification

To resolve F-02, the platform standardizes on deterministic JSON normalization and SHA-256 Web Crypto hashing across all six games.

### A. Field Inclusion & Exclusion Rules
To ensure that identical gameplay states produce identical checksums regardless of export timing:
- **INCLUDED in Checksum:** The complete `payload` object (all game progression, stage scores, reflections, artwork arrays, settings).
- **EXCLUDED from Checksum:** Outer envelope transport framing:
  - `clientUpdatedAt` (changes on every export)
  - `baseRevision` (managed by sync layer)
  - `guestId` (device identifier)
  - `envelopeVersion` / `gameSchemaVersion`

### B. Canonical Checksum Algorithm (`computePayloadChecksum`)
Every game adapter will utilize the platform's standardized hashing function (already proven in `assets/sdk/migration/backend-migration.js`):

```javascript
/**
 * Recursively normalizes an object by sorting all dictionary keys alphabetically.
 */
function canonicalizeObject(obj) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(canonicalizeObject);
  }
  const sortedKeys = Object.keys(obj).sort();
  const result = {};
  for (const key of sortedKeys) {
    if (obj[key] !== undefined) {
      result[key] = canonicalizeObject(obj[key]);
    }
  }
  return result;
}

/**
 * Computes a deterministic 64-character hex SHA-256 checksum of any payload.
 * Runs in all modern browsers via Web Crypto API with zero external dependencies.
 */
export async function computePayloadChecksum(payload) {
  const canonical = canonicalizeObject(payload);
  const jsonString = JSON.stringify(canonical);
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(jsonString);
  
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
```

### C. Migration & Backward Compatibility for Legacy Checksums
- When a game with a legacy string checksum (e.g. `'match_18_50'`) is loaded, the adapter recognizes that `checksum.length !== 64`.
- Upon the next game autosave or export, the adapter automatically computes the canonical 64-character SHA-256 hash.
- Legacy saves are never rejected; the checksum format is upgraded transparently.

---

## 3. Bespoke Game-Specific Merge Policies (F-07)

When two conflicting non-empty saves collide during synchronization (e.g. an offline device reconnecting while another device was active), the platform enforces **ADR-06**. Instead of falling back to disruptive user-choice dialogs, each game defines a mathematical merge strategy.

```
+---------------------------------------------------------------------------------------------------+
|                                 GAME MERGE STRATEGY TAXONOMY                                      |
+---------------------------------------------------------------------------------------------------+
| Game Slug            | Progression Merge Policy            | Conflict-Sensitive Fields            |
+----------------------+-------------------------------------+--------------------------------------+
| auroblocks           | Max high score, union of stages.    | stageScores: take max score per stage|
| auromatch            | Union of level IDs, max petals.     | reflections: union by creation date  |
| auromandala          | Max cleared stage, union sessions.  | savedArtworks: Versioned Fork-Merge  |
| vak                  | Max currentLevel, union words.      | lotusPetals / sparks: take max       |
| word-riddle          | Union of solvedRiddles IDs.         | activeTheme: take latest updatedAt   |
| vak-living-sanctuary | Union of unlockedWords codex.       | personalNotes: union by timestamp    |
+---------------------------------------------------------------------------------------------------+
```

---

### A. AuroBlocks Merge Strategy (`AuroBlocksMergeStrategy`)

```javascript
export const AuroBlocksMergeStrategy = {
  gameId: 'auroblocks',
  resolve: (localEnvelope, remoteEnvelope) => {
    const local = localEnvelope.payload?.save || {};
    const remote = remoteEnvelope.payload?.save || {};

    const mergedHighScore = Math.max(local.highScore || 0, remote.highScore || 0);

    // Union cleared stages
    const localStages = Array.isArray(local.stages) ? local.stages : [];
    const remoteStages = Array.isArray(remote.stages) ? remote.stages : [];
    const mergedStages = Array.from(new Set([...localStages, ...remoteStages])).sort((a, b) => a - b);

    // Merge stage scores: take highest score achieved per stage
    const localScores = local.stageScores || {};
    const remoteScores = remote.stageScores || {};
    const mergedStageScores = { ...localScores };
    for (const [stageId, score] of Object.entries(remoteScores)) {
      mergedStageScores[stageId] = Math.max(mergedStageScores[stageId] || 0, score);
    }

    const mergedPayload = {
      schemaVersion: 1,
      save: {
        highScore: mergedHighScore,
        stages: mergedStages,
        stageScores: mergedStageScores,
        updatedAt: new Date().toISOString()
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

### B. AuroMatch Merge Strategy (`AuroMatchMergeStrategy`)

```javascript
export const AuroMatchMergeStrategy = {
  gameId: 'auromatch',
  resolve: (localEnvelope, remoteEnvelope) => {
    const local = localEnvelope.payload?.profileState || {};
    const remote = remoteEnvelope.payload?.profileState || {};

    // 1. Union completed level IDs
    const localLevels = local.progression?.completedLevelIds || [];
    const remoteLevels = remote.progression?.completedLevelIds || [];
    const mergedLevelIds = Array.from(new Set([...localLevels, ...remoteLevels])).sort((a, b) => a - b);

    // 2. Monotonic stats: take highest lotus petals and consciousness points
    const mergedPetals = Math.max(local.profile?.lotusPetalCount || 0, remote.profile?.lotusPetalCount || 0);
    const mergedConsciousness = Math.max(local.profile?.consciousnessPoints || 0, remote.profile?.consciousnessPoints || 0);

    // 3. Union reflections (deduplicate by unique reflection timestamp or text)
    const localReflections = Array.isArray(local.reflections) ? local.reflections : [];
    const remoteReflections = Array.isArray(remote.reflections) ? remote.reflections : [];
    const seenReflectionKeys = new Set();
    const mergedReflections = [];
    for (const ref of [...localReflections, ...remoteReflections]) {
      const key = `${ref.date || ''}_${ref.text || ''}`;
      if (!seenReflectionKeys.has(key)) {
        seenReflectionKeys.add(key);
        mergedReflections.push(ref);
      }
    }

    // 4. Union unlocked themes
    const localThemes = local.progression?.unlockedThemes || ['flowers', 'qualities'];
    const remoteThemes = remote.progression?.unlockedThemes || ['flowers', 'qualities'];
    const mergedThemes = Array.from(new Set([...localThemes, ...remoteThemes]));

    const mergedPayload = {
      schemaVersion: 1,
      profileState: {
        profile: {
          ...(local.profile || {}),
          lotusPetalCount: mergedPetals,
          consciousnessPoints: mergedConsciousness,
          lastLaunchTimestamp: Date.now()
        },
        progression: {
          completedLevelsCount: mergedLevelIds.length,
          completedLevelIds: mergedLevelIds,
          unlockedThemes: mergedThemes
        },
        settings: { ...(local.settings || {}), ...(remote.settings || {}) },
        reflections: mergedReflections,
        dailyDrawDate: local.dailyDrawDate || remote.dailyDrawDate || ""
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

### C. VAK Speech Control Merge Strategy (`VakMergeStrategy`)

```javascript
export const VakMergeStrategy = {
  gameId: 'vak',
  resolve: (localEnvelope, remoteEnvelope) => {
    const local = localEnvelope.payload?.save || {};
    const remote = remoteEnvelope.payload?.save || {};

    const localLevel = (local.player && local.player.currentLevel) || local.levelIndex || 0;
    const remoteLevel = (remote.player && remote.player.currentLevel) || remote.levelIndex || 0;
    const mergedLevel = Math.max(localLevel, remoteLevel);

    const localSparks = (local.player && local.player.sparks) || local.lotusPetals || 100;
    const remoteSparks = (remote.player && remote.player.sparks) || remote.lotusPetals || 100;
    const mergedSparks = Math.max(localSparks, remoteSparks);

    const mergedPayload = {
      schemaVersion: 1,
      save: {
        name: local.name || remote.name || 'Seeker',
        levelIndex: mergedLevel,
        lotusPetals: mergedSparks,
        settings: { ...(local.settings || {}), ...(remote.settings || {}) }
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

### D. Word Riddle Merge Strategy (`WordRiddleMergeStrategy`)

```javascript
export const WordRiddleMergeStrategy = {
  gameId: 'word-riddle',
  resolve: (localEnvelope, remoteEnvelope) => {
    const local = localEnvelope.payload?.save || {};
    const remote = remoteEnvelope.payload?.save || {};

    const localSolved = Array.isArray(local.solvedRiddles) ? local.solvedRiddles : [];
    const remoteSolved = Array.isArray(remote.solvedRiddles) ? remote.solvedRiddles : [];
    const mergedSolved = Array.from(new Set([...localSolved, ...remoteSolved])).sort((a, b) => a - b);

    const mergedPayload = {
      schemaVersion: 1,
      save: {
        solvedRiddles: mergedSolved,
        currentTheme: local.currentTheme || remote.currentTheme || 'th01',
        stats: {
          totalSolved: mergedSolved.length,
          lastPlayedAt: new Date().toISOString()
        }
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

### E. VAK Living Sanctuary Merge Strategy (`VakLivingSanctuaryMergeStrategy`)

```javascript
export const VakLivingSanctuaryMergeStrategy = {
  gameId: 'vak-living-sanctuary',
  resolve: (localEnvelope, remoteEnvelope) => {
    const local = localEnvelope.payload?.codex || {};
    const remote = remoteEnvelope.payload?.codex || {};

    // Union unlocked wisdom words
    const localWords = Array.isArray(local.unlockedWords) ? local.unlockedWords : [];
    const remoteWords = Array.isArray(remote.unlockedWords) ? remote.unlockedWords : [];
    const mergedWords = Array.from(new Set([...localWords, ...remoteWords]));

    // Union discoveries / reflection notes
    const localDisc = Array.isArray(local.discoveries) ? local.discoveries : [];
    const remoteDisc = Array.isArray(remote.discoveries) ? remote.discoveries : [];
    const seenWordKeys = new Set();
    const mergedDisc = [];
    for (const item of [...localDisc, ...remoteDisc]) {
      if (item && item.word && !seenWordKeys.has(item.word)) {
        seenWordKeys.add(item.word);
        mergedDisc.push(item);
      }
    }

    const mergedPayload = {
      schemaVersion: 1,
      codex: {
        unlockedWords: mergedWords,
        discoveries: mergedDisc,
        updatedAt: new Date().toISOString()
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

## 4. Invariant Protection & User Conflict Fallback

Under `resolveGameMerge` (`assets/sdk/auromind-adapters.js`), all merges are guarded by platform laws:
- **Invariant 1:** Empty remote save never overwrites local progress (`status: 'use_local'`).
- **Invariant 2:** Empty local save adopts remote progress (`status: 'use_remote'`).
- **Invariant 3:** Identical SHA-256 hashes skip synchronization (`status: 'use_local'`).
- **Invariant 4:** If a game has no registered merge strategy or returns `status: 'conflict_requires_user_choice'`, the portal displays the visual conflict modal showing timestamps, scores, and levels, giving the user explicit control.
