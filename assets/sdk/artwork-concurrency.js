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

import crypto from 'node:crypto';

export const MAX_ARTWORK_SNAPSHOTS = 10;
export const MAX_STORAGE_PURGE_RETRIES = 5;

/**
 * Generates a stable UUIDv4.
 */
export function generateUuid() {
  return crypto.randomUUID();
}

/**
 * Computes deterministic SHA-256 hash of artwork strokes/canvas content.
 */
export function computeArtworkContentHash(strokes) {
  const serialized = JSON.stringify(strokes || []);
  return crypto.createHash('sha256').update(serialized).digest('hex');
}

/**
 * Normalizes an artwork entity into canonical causal schema.
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
  snapshots = []
}) {
  const contentHash = computeArtworkContentHash(strokes);
  const initialSnapshots = snapshots.length > 0 ? snapshots.slice(-MAX_ARTWORK_SNAPSHOTS) : [{
    revision,
    contentHash,
    createdAt: new Date().toISOString()
  }];

  return {
    artworkId,
    title,
    revision,
    parentRevisionId, // format: `${artworkId}@rev_${parentRevision}` or null
    contentHash,
    deleted,
    deletedAt,
    tombstoneRevision,
    snapshots: initialSnapshots
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
  // Case 1: Identical entities or duplicate delivery
  if (localArt.contentHash === remoteArt.contentHash && localArt.revision === remoteArt.revision && localArt.deleted === remoteArt.deleted) {
    return { resolved: { ...localArt }, forked: null, action: 'IDEMPOTENT_NOOP' };
  }

  // Case 2: One entity is deleted (Tombstone Conflict Handling)
  if (localArt.deleted || remoteArt.deleted) {
    // Both deleted: preserve tombstone with latest revision
    if (localArt.deleted && remoteArt.deleted) {
      const activeTombstone = localArt.revision >= remoteArt.revision ? localArt : remoteArt;
      return { resolved: { ...activeTombstone }, forked: null, action: 'BOTH_DELETED' };
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
            tombstoneRevision: null
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
          title: `${remoteArt.title || 'Mandala'} (Recovered Copy)`,
          parentRevisionId: remoteArt.parentRevisionId,
          revision: 1, // Fresh baseline for the recovered entity
          deleted: false,
          deletedAt: null
        };
        return {
          resolved: { ...localArt }, // Local tombstone remains intact
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
        return { resolved: { ...localArt }, forked: null, action: 'LOCAL_SUPERSEDES_REMOTE_TOMBSTONE' };
      } else {
        // Remote deleted concurrently while local was edited -> keep local active, preserve work
        return { resolved: { ...localArt }, forked: null, action: 'LOCAL_EDIT_PRESERVED_OVER_CONCURRENT_DELETE' };
      }
    }
  }

  // Case 3: Both entities are active edits
  // Check if one is a direct causal ancestor of the other
  const localRevTag = `${localArt.artworkId}@rev_${localArt.revision}`;
  const remoteRevTag = `${remoteArt.artworkId}@rev_${remoteArt.revision}`;

  if (remoteArt.parentRevisionId === localRevTag) {
    // Remote is a direct causal successor to local
    return { resolved: { ...remoteArt }, forked: null, action: 'REMOTE_ADVANCED_CAUSALLY' };
  }

  if (localArt.parentRevisionId === remoteRevTag) {
    // Local is a direct causal successor to remote
    return { resolved: { ...localArt }, forked: null, action: 'LOCAL_ADVANCED_CAUSALLY' };
  }

  // Case 4: Concurrent Edit / Edit Conflict (Both branched from same parent or divergent parents)
  // Non-Destructive Resolution: Keep local entity unchanged, fork remote into [Title] (Recovered Copy)
  const forkedId = generateUuid();
  const forkedArt = {
    ...remoteArt,
    artworkId: forkedId,
    title: `${remoteArt.title || 'Mandala'} (Recovered Copy)`,
    parentRevisionId: remoteArt.parentRevisionId,
    revision: 1,
    snapshots: remoteArt.snapshots.slice(-MAX_ARTWORK_SNAPSHOTS)
  };

  return {
    resolved: { ...localArt },
    forked: forkedArt,
    action: 'FORKED_ON_CONCURRENT_EDIT'
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
