/**
 * AuroMind Platform SDK — AuroMandala Artwork Concurrency & Deletion Lifecycle
 *
 * Implements deterministic parent-revision causal vector ordering and non-destructive
 * conflict forking for AuroMandala:
 *   - Explicit parent revision tracking: (artworkId, revision, parentRevisionId, contentHash)
 *   - Concurrent edit/edit branching into '[Title] (Recovered Copy)'
 *   - Resurrection strictly when edit causally descends from tombstone revision
 *   - Forked recovery when edit branched prior to tombstone
 *   - Ten immutable snapshot ceiling
 *   - Durable Storage deletion queue with exponential backoff & orphan reconciliation
 */

import {
  capSnapshots,
  computePayloadChecksumSync,
  generateArtworkUuid,
  quarantineCorruptSave
} from './auromind-adapters.js';

export const MAX_ARTWORK_SNAPSHOTS = 10;
export const MAX_STORAGE_PURGE_RETRIES = 5;
export const DEFAULT_ARTWORK_STORE_KEY = 'auromandala.artworks.v1';

/**
 * Generates a stable UUIDv4 in both browser and Node.js environments.
 */
export function generateUuid() {
  return generateArtworkUuid();
}

/**
 * Computes deterministic SHA-256 hash of artwork strokes/canvas content (browser + Node safe).
 */
export function computeArtworkContentHash(strokes) {
  return computePayloadChecksumSync(strokes || []);
}

function formatRecoveredTitle(title) {
  const base = typeof title === 'string' && title.trim() ? title.trim() : 'Mandala';
  return base.endsWith('(Recovered Copy)') ? base : `${base} (Recovered Copy)`;
}

function normalizeImmutableSnapshots(snapshots) {
  return capSnapshots(Array.isArray(snapshots) ? snapshots : []);
}

/**
 * Normalizes an artwork entity into canonical causal schema with immutable snapshots.
 */
export function createArtworkEntity({
  artworkId = generateUuid(),
  title = 'Sacred Mandala',
  strokes = [],
  revision = 1,
  parentRevisionId = null,
  deleted = false,
  deletedAt = null,
  tombstoneRevision = null,
  createdAt = new Date().toISOString(),
  updatedAt = createdAt,
  snapshots = []
} = {}) {
  const safeStrokes = Array.isArray(strokes) ? strokes.map((s) => (s && typeof s === 'object' ? { ...s } : s)) : [];
  const safeRevision = Math.max(1, Number(revision) || 1);
  const contentHash = computeArtworkContentHash(safeStrokes);
  const initialSnapshots = Array.isArray(snapshots) && snapshots.length > 0
    ? normalizeImmutableSnapshots(snapshots)
    : normalizeImmutableSnapshots([{
        revision: safeRevision,
        version: safeRevision,
        contentHash,
        strokesCount: safeStrokes.length,
        createdAt: updatedAt
      }]);

  return {
    artworkId,
    title: typeof title === 'string' && title.trim() ? title.trim() : 'Sacred Mandala',
    strokes: safeStrokes,
    strokesCount: safeStrokes.length,
    revision: safeRevision,
    currentVersion: safeRevision,
    parentRevisionId, // format: `${artworkId}@rev_${parentRevision}` or null
    contentHash,
    createdAt,
    updatedAt,
    deleted: Boolean(deleted),
    deletedAt: deleted ? (deletedAt || updatedAt) : null,
    tombstoneRevision: deleted ? (tombstoneRevision || safeRevision) : null,
    snapshots: initialSnapshots
  };
}

/**
 * Appends a new immutable snapshot and advances causal revision without mutating previous snapshots.
 */
export function appendArtworkSnapshot(entity, strokes, options = {}) {
  if (!entity || typeof entity !== 'object') {
    throw new Error('appendArtworkSnapshot requires a valid artwork entity.');
  }
  const nowIso = options.timestamp || new Date().toISOString();
  const prevRev = Math.max(1, Number(entity.revision || entity.currentVersion || 1));
  const nextRev = prevRev + 1;
  const safeStrokes = Array.isArray(strokes) ? strokes.map((s) => (s && typeof s === 'object' ? { ...s } : s)) : [];
  const contentHash = computeArtworkContentHash(safeStrokes);
  const nextSnap = Object.freeze({
    revision: nextRev,
    version: nextRev,
    contentHash,
    strokesCount: safeStrokes.length,
    createdAt: nowIso
  });

  return {
    ...entity,
    title: typeof options.title === 'string' && options.title.trim() ? options.title.trim() : entity.title,
    strokes: safeStrokes,
    strokesCount: safeStrokes.length,
    revision: nextRev,
    currentVersion: nextRev,
    parentRevisionId: `${entity.artworkId}@rev_${prevRev}`,
    contentHash,
    updatedAt: nowIso,
    deleted: false,
    deletedAt: null,
    tombstoneRevision: null,
    snapshots: normalizeImmutableSnapshots([...(entity.snapshots || []), nextSnap])
  };
}

/**
 * Marks an artwork soft-deleted with causal tombstone metadata.
 */
export function markArtworkDeleted(entity, options = {}) {
  if (!entity || typeof entity !== 'object') {
    throw new Error('markArtworkDeleted requires a valid artwork entity.');
  }
  const nowIso = options.timestamp || new Date().toISOString();
  const prevRev = Math.max(1, Number(entity.revision || entity.currentVersion || 1));
  const nextRev = prevRev + 1;
  return {
    ...entity,
    revision: nextRev,
    currentVersion: nextRev,
    parentRevisionId: `${entity.artworkId}@rev_${prevRev}`,
    deleted: true,
    deletedAt: nowIso,
    tombstoneRevision: nextRev,
    updatedAt: nowIso,
    snapshots: normalizeImmutableSnapshots(entity.snapshots)
  };
}

/**
 * Performs a genuine causal resurrection descending from an artwork's tombstone revision.
 */
export function resurrectArtwork(entity, strokes = null, options = {}) {
  if (!entity || typeof entity !== 'object') {
    throw new Error('resurrectArtwork requires a valid artwork entity.');
  }
  const nowIso = options.timestamp || new Date().toISOString();
  const tombstoneRev = Number(entity.tombstoneRevision || entity.revision || 1);
  const nextRev = tombstoneRev + 1;
  const nextStrokes = Array.isArray(strokes)
    ? strokes.map((s) => (s && typeof s === 'object' ? { ...s } : s))
    : (Array.isArray(entity.strokes) ? entity.strokes.map((s) => (s && typeof s === 'object' ? { ...s } : s)) : []);
  const contentHash = computeArtworkContentHash(nextStrokes);
  const restoredSnap = Object.freeze({
    revision: nextRev,
    version: nextRev,
    contentHash,
    strokesCount: nextStrokes.length,
    createdAt: nowIso,
    resurrectedFromRevision: tombstoneRev
  });

  return {
    ...entity,
    title: typeof options.title === 'string' && options.title.trim() ? options.title.trim() : entity.title,
    strokes: nextStrokes,
    strokesCount: nextStrokes.length,
    revision: nextRev,
    currentVersion: nextRev,
    parentRevisionId: `${entity.artworkId}@rev_${tombstoneRev}`,
    contentHash,
    deleted: false,
    deletedAt: null,
    tombstoneRevision: null,
    updatedAt: nowIso,
    snapshots: normalizeImmutableSnapshots([...(entity.snapshots || []), restoredSnap])
  };
}

/**
 * Resolves conflict between a local artwork entity and an incoming remote sync entity
 * based strictly on causal parent relationships.
 *
 * @param {object} localArt
 * @param {object} remoteArt
 * @returns {{ resolved: object, forked: object|null, action: string }}
 */
export function resolveArtworkCausalConflict(localArt, remoteArt) {
  const localSnaps = normalizeImmutableSnapshots(localArt?.snapshots);
  const remoteSnaps = normalizeImmutableSnapshots(remoteArt?.snapshots);

  // Case 1: Identical entities or duplicate delivery
  if (localArt.contentHash === remoteArt.contentHash && localArt.revision === remoteArt.revision && localArt.deleted === remoteArt.deleted) {
    return { resolved: { ...localArt, snapshots: localSnaps }, forked: null, action: 'IDEMPOTENT_NOOP' };
  }

  // Case 2: One entity is deleted (Tombstone Conflict Handling)
  if (localArt.deleted || remoteArt.deleted) {
    // Both deleted: preserve tombstone with latest revision
    if (localArt.deleted && remoteArt.deleted) {
      const activeTombstone = localArt.revision >= remoteArt.revision ? localArt : remoteArt;
      return {
        resolved: { ...activeTombstone, snapshots: normalizeImmutableSnapshots(activeTombstone.snapshots) },
        forked: null,
        action: 'BOTH_DELETED'
      };
    }

    // Local is deleted, Remote is an active edit
    if (localArt.deleted && !remoteArt.deleted) {
      // Check causal relationship: Did remote edit explicitly descend from or observe the tombstone?
      const tombstoneRevTag = `${localArt.artworkId}@rev_${localArt.tombstoneRevision || localArt.revision}`;
      const isDescendantOfTombstone = remoteArt.parentRevisionId === tombstoneRevTag;

      if (isDescendantOfTombstone) {
        // Genuine Resurrection: remote deliberately edited/restored after seeing tombstone
        return {
          resolved: {
            ...remoteArt,
            deleted: false,
            deletedAt: null,
            tombstoneRevision: null,
            snapshots: normalizeImmutableSnapshots([...localSnaps, ...remoteSnaps])
          },
          forked: null,
          action: 'RESURRECTED'
        };
      } else {
        // Concurrent / Stale Edit against pre-deletion state:
        // Honor local deletion, but preserve remote work by forking into a Recovered Copy!
        const forkedId = generateUuid();
        const forkedArt = {
          ...remoteArt,
          artworkId: forkedId,
          title: formatRecoveredTitle(remoteArt.title),
          parentRevisionId: remoteArt.parentRevisionId,
          revision: 1, // Fresh baseline for the recovered entity
          currentVersion: 1,
          deleted: false,
          deletedAt: null,
          tombstoneRevision: null,
          snapshots: remoteSnaps
        };
        return {
          resolved: { ...localArt, snapshots: localSnaps }, // Local tombstone remains intact
          forked: forkedArt,
          action: 'FORKED_ON_TOMBSTONE_CONFLICT'
        };
      }
    }

    // Remote is deleted, Local is active edit
    if (!localArt.deleted && remoteArt.deleted) {
      const remoteTombstoneRevTag = `${remoteArt.artworkId}@rev_${remoteArt.tombstoneRevision || remoteArt.revision}`;
      const isDescendantOfTombstone = localArt.parentRevisionId === remoteTombstoneRevTag;

      if (isDescendantOfTombstone) {
        // Local was created after observing remote tombstone -> keep local active
        return { resolved: { ...localArt, snapshots: localSnaps }, forked: null, action: 'LOCAL_SUPERSEDES_REMOTE_TOMBSTONE' };
      } else {
        // Remote deleted concurrently while local was edited -> keep local active, preserve work
        return { resolved: { ...localArt, snapshots: localSnaps }, forked: null, action: 'LOCAL_EDIT_PRESERVED_OVER_CONCURRENT_DELETE' };
      }
    }
  }

  // Case 3: Both entities are active edits
  // Check if one is a direct causal ancestor of the other
  const localRevTag = `${localArt.artworkId}@rev_${localArt.revision}`;
  const remoteRevTag = `${remoteArt.artworkId}@rev_${remoteArt.revision}`;

  if (remoteArt.parentRevisionId === localRevTag) {
    // Remote is a direct causal successor to local
    return {
      resolved: { ...remoteArt, snapshots: normalizeImmutableSnapshots([...localSnaps, ...remoteSnaps]) },
      forked: null,
      action: 'REMOTE_ADVANCED_CAUSALLY'
    };
  }

  if (localArt.parentRevisionId === remoteRevTag) {
    // Local is a direct causal successor to remote
    return {
      resolved: { ...localArt, snapshots: normalizeImmutableSnapshots([...remoteSnaps, ...localSnaps]) },
      forked: null,
      action: 'LOCAL_ADVANCED_CAUSALLY'
    };
  }

  // Case 4: Concurrent Edit / Edit Conflict (Both branched from same parent or divergent parents)
  // Non-Destructive Resolution: Keep local entity unchanged, fork remote into [Title] (Recovered Copy)
  const forkedId = generateUuid();
  const forkedArt = {
    ...remoteArt,
    artworkId: forkedId,
    title: formatRecoveredTitle(remoteArt.title),
    parentRevisionId: remoteArt.parentRevisionId,
    revision: 1,
    currentVersion: 1,
    snapshots: remoteSnaps
  };

  return {
    resolved: { ...localArt, snapshots: localSnaps },
    forked: forkedArt,
    action: 'FORKED_ON_CONCURRENT_EDIT'
  };
}

/**
 * Local-first AuroMandala artwork gallery store with autosave, reload persistence,
 * immutable 10-snapshot retention, tombstones, non-destructive conflict forking,
 * corrupt-state quarantine, quota/unavailable-storage memory fallback, and per-account scoping.
 */
export function createLocalArtworkStore({
  storage = typeof localStorage !== 'undefined' ? localStorage : null,
  storageKey = null,
  accountScope = 'guest',
  cloudSyncOptIn = false
} = {}) {
  const safeScope = typeof accountScope === 'string' && accountScope.trim()
    ? accountScope.trim().replace(/[^a-zA-Z0-9._-]/g, '_')
    : 'guest';
  const resolvedKey = storageKey || `${DEFAULT_ARTWORK_STORE_KEY}:${safeScope}`;

  let artworks = {};
  let fallbackMode = storage ? 'storage' : 'memory';
  let lastError = null;
  let corruptedRecoveries = 0;

  function persist() {
    if (!storage) {
      fallbackMode = 'memory';
      return { ok: true, persistedToStorage: false, fallbackMode };
    }
    try {
      storage.setItem(resolvedKey, JSON.stringify({
        schemaVersion: 1,
        accountScope: safeScope,
        cloudSyncOptIn: Boolean(cloudSyncOptIn),
        updatedAt: new Date().toISOString(),
        artworks
      }));
      fallbackMode = 'storage';
      lastError = null;
      return { ok: true, persistedToStorage: true, fallbackMode };
    } catch (err) {
      fallbackMode = 'memory';
      lastError = err && err.message ? err.message : String(err);
      return {
        ok: true,
        persistedToStorage: false,
        fallbackMode,
        quotaExceeded: err?.name === 'QuotaExceededError' || /quota/i.test(lastError),
        error: lastError
      };
    }
  }

  function load() {
    if (!storage) {
      fallbackMode = 'memory';
      return { ok: true, recoveredFromCorruption: false, count: Object.keys(artworks).length };
    }
    try {
      const raw = storage.getItem(resolvedKey);
      if (!raw) {
        artworks = {};
        return { ok: true, recoveredFromCorruption: false, count: 0 };
      }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || !parsed.artworks || typeof parsed.artworks !== 'object' || Array.isArray(parsed.artworks)) {
        throw new Error('CORRUPT_ARTWORK_STORE_ENVELOPE');
      }
      const hydrated = {};
      for (const [id, entry] of Object.entries(parsed.artworks)) {
        if (!entry || typeof entry !== 'object') continue;
        if (id === '__proto__' || id === 'constructor' || id === 'prototype') continue;
        hydrated[id] = createArtworkEntity({
          ...entry,
          artworkId: entry.artworkId || id
        });
      }
      artworks = hydrated;
      fallbackMode = 'storage';
      lastError = null;
      return { ok: true, recoveredFromCorruption: false, count: Object.keys(artworks).length };
    } catch (err) {
      lastError = err && err.message ? err.message : String(err);
      try {
        const raw = storage.getItem(resolvedKey);
        if (raw) {
          quarantineCorruptSave(`auromandala_${safeScope}`, raw);
          try { storage.removeItem(resolvedKey); } catch {}
        }
      } catch {}
      artworks = {};
      corruptedRecoveries += 1;
      return { ok: true, recoveredFromCorruption: true, error: lastError, count: 0 };
    }
  }

  load();

  return {
    storageKey: resolvedKey,
    accountScope: safeScope,
    cloudSyncOptIn: Boolean(cloudSyncOptIn),
    reload() {
      return load();
    },
    list({ includeDeleted = false } = {}) {
      return Object.values(artworks)
        .filter((a) => includeDeleted || !a.deleted)
        .map((a) => ({ ...a, snapshots: normalizeImmutableSnapshots(a.snapshots) }));
    },
    get(artworkId) {
      const found = artworks[artworkId];
      return found ? { ...found, snapshots: normalizeImmutableSnapshots(found.snapshots) } : null;
    },
    create(input = {}) {
      const entity = createArtworkEntity(input);
      artworks[entity.artworkId] = entity;
      const persistence = persist();
      return { artwork: entity, persistence };
    },
    autosave(input = {}) {
      if (!input || typeof input !== 'object') {
        throw new Error('autosave requires an artwork object.');
      }
      const existing = input.artworkId ? artworks[input.artworkId] : null;
      const nextEntity = existing
        ? appendArtworkSnapshot(existing, input.strokes ?? existing.strokes, {
            title: input.title,
            timestamp: input.timestamp
          })
        : createArtworkEntity(input);
      artworks[nextEntity.artworkId] = nextEntity;
      const persistence = persist();
      return { artwork: nextEntity, persistence };
    },
    update(artworkId, patch = {}) {
      const existing = artworks[artworkId];
      if (!existing) return null;
      const nextEntity = appendArtworkSnapshot(
        existing,
        patch.strokes !== undefined ? patch.strokes : existing.strokes,
        { title: patch.title !== undefined ? patch.title : existing.title, timestamp: patch.timestamp }
      );
      artworks[artworkId] = nextEntity;
      const persistence = persist();
      return { artwork: nextEntity, persistence };
    },
    softDelete(artworkId, options = {}) {
      const existing = artworks[artworkId];
      if (!existing) return null;
      const deletedEntity = markArtworkDeleted(existing, options);
      artworks[artworkId] = deletedEntity;
      const persistence = persist();
      return { artwork: deletedEntity, persistence };
    },
    restore(artworkId, strokes = null, options = {}) {
      const existing = artworks[artworkId];
      if (!existing) return null;
      const restored = resurrectArtwork(existing, strokes, options);
      artworks[artworkId] = restored;
      const persistence = persist();
      return { artwork: restored, persistence };
    },
    mergeRemote(remoteArtworksMap = {}) {
      const actions = [];
      for (const [remoteId, remoteEntry] of Object.entries(remoteArtworksMap || {})) {
        if (!remoteEntry || typeof remoteEntry !== 'object') continue;
        const normalizedRemote = createArtworkEntity({ ...remoteEntry, artworkId: remoteEntry.artworkId || remoteId });
        const local = artworks[normalizedRemote.artworkId];
        if (!local) {
          artworks[normalizedRemote.artworkId] = normalizedRemote;
          actions.push({ artworkId: normalizedRemote.artworkId, action: 'ADOPTED_REMOTE' });
          continue;
        }
        const { resolved, forked, action } = resolveArtworkCausalConflict(local, normalizedRemote);
        artworks[resolved.artworkId] = resolved;
        if (forked) {
          artworks[forked.artworkId] = forked;
        }
        actions.push({ artworkId: resolved.artworkId, forkedId: forked ? forked.artworkId : null, action });
      }
      const persistence = persist();
      return { actions, persistence };
    },
    exportMap() {
      const out = {};
      for (const [id, art] of Object.entries(artworks)) {
        out[id] = { ...art, snapshots: normalizeImmutableSnapshots(art.snapshots) };
      }
      return out;
    },
    getStorageStatus() {
      return {
        storageAvailable: Boolean(storage) && fallbackMode === 'storage',
        fallbackMode,
        lastError,
        corruptedRecoveries,
        accountScope: safeScope,
        storageKey: resolvedKey,
        cloudSyncOptIn: Boolean(cloudSyncOptIn)
      };
    }
  };
}

/**
 * In-memory / Mock Durable Storage Deletion Queue Engine.
 */
export class StorageDeletionQueue {
  constructor(storageClient) {
    this.storage = storageClient;
    this.queue = new Map();
  }

  enqueue({ bucketId = 'user-artwork', objectPath, artworkId, snapshotId = null }) {
    const id = generateUuid();
    const job = {
      id,
      bucketId,
      objectPath,
      artworkId,
      snapshotId,
      attempts: 0,
      maxAttempts: MAX_STORAGE_PURGE_RETRIES,
      status: 'pending',
      lastError: null,
      nextRetryAt: Date.now()
    };
    this.queue.set(id, job);
    return job;
  }

  async processQueue(now = Date.now()) {
    const results = [];
    for (const [id, job] of this.queue.entries()) {
      if (job.status !== 'pending' || job.nextRetryAt > now) continue;

      job.attempts += 1;
      try {
        const res = await this.storage.remove(job.bucketId, job.objectPath);
        if (res.status === 200 || res.status === 404) {
          job.status = 'completed';
          job.completedAt = new Date().toISOString();
          results.push({ id, status: 'completed' });
        } else {
          throw new Error(`Storage remove returned status ${res.status}`);
        }
      } catch (err) {
        job.lastError = err.message;
        if (job.attempts >= job.maxAttempts) {
          job.status = 'failed';
          results.push({ id, status: 'failed', error: err.message, orphanAlert: true });
        } else {
          // Exponential backoff: 2s, 4s, 8s, 16s...
          job.nextRetryAt = now + Math.pow(2, job.attempts) * 1000;
          results.push({ id, status: 'retry_scheduled', nextRetryAt: job.nextRetryAt });
        }
      }
    }
    return results;
  }
}
