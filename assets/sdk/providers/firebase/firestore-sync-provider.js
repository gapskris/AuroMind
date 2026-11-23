/**
 * AuroMind Shared Platform SDK — Firestore CloudSyncProvider Adapter
 *
 * Implements optimistic concurrency cloud synchronization, pull, and push
 * using Google Cloud Firestore documents.
 *
 * Architecture Invariants:
 * 1. Games own their save schemas (stored as opaque JSON payload).
 * 2. Ownership isolation: All saves scoped to `users/{userId}/game_saves/{gameId}`.
 * 3. Optimistic concurrency: Revision matching prevents blind overwrite conflicts.
 * 4. Sacred Privacy: Sankalpa vault is local-only and strictly rejected if passed.
 * 5. Bounded retention: History revisions tracked under `revisions` subcollection.
 */

const SANKALPA_FORBIDDEN_KEY_RE = /(?:sankalpa|auromasti-sankalpa-backup|auromind_sankalpa_vault)/i;
const SANKALPA_FORBIDDEN_VALUE_RE =
  /(?:sankalpa_e2ee_vault|auromasti-sankalpa-backup|auromind_sankalpa_vault|sankalpa_reflections)/i;
const MAX_PRIVACY_INSPECTION_DEPTH = 64;
const MAX_PRIVACY_INSPECTION_NODES = 10000;

/**
 * Iterative, cycle-safe, fail-closed Sankalpa privacy inspector.
 * Returns true if any forbidden Sankalpa key/marker is found at any depth OR
 * if the structure exceeds safe inspection bounds (never silently accepts uninspected data).
 */
function payloadContainsForbiddenSankalpa(payload) {
  if (payload === null || payload === undefined) return false;
  if (typeof payload === 'string') return SANKALPA_FORBIDDEN_VALUE_RE.test(payload);
  if (typeof payload !== 'object') return false;

  const activeAncestors = new Set();
  const completed = new WeakSet();
  const stack = [{ node: payload, depth: 0, phase: 'enter' }];
  let inspectedNodes = 0;

  while (stack.length > 0) {
    const { node, depth, phase } = stack.pop();
    if (phase === 'exit') {
      activeAncestors.delete(node);
      completed.add(node);
      continue;
    }
    if (depth > MAX_PRIVACY_INSPECTION_DEPTH) return true; // Fail closed
    inspectedNodes += 1;
    if (inspectedNodes > MAX_PRIVACY_INSPECTION_NODES) return true; // Fail closed

    if (node === null || node === undefined) continue;
    if (typeof node === 'string') {
      if (SANKALPA_FORBIDDEN_VALUE_RE.test(node)) return true;
      continue;
    }
    if (typeof node !== 'object') continue;
    if (activeAncestors.has(node)) return true; // Fail closed on cyclic payload
    if (completed.has(node)) continue;
    activeAncestors.add(node);
    stack.push({ node, depth, phase: 'exit' });

    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const item = node[i];
        if (typeof item === 'string') {
          if (SANKALPA_FORBIDDEN_VALUE_RE.test(item)) return true;
        } else if (item && typeof item === 'object') {
          stack.push({ node: item, depth: depth + 1, phase: 'enter' });
        }
      }
    } else {
      const keys = Object.keys(node);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        if (SANKALPA_FORBIDDEN_KEY_RE.test(k)) return true;
        const v = node[k];
        if (typeof v === 'string') {
          if (SANKALPA_FORBIDDEN_VALUE_RE.test(v)) return true;
        } else if (v && typeof v === 'object') {
          stack.push({ node: v, depth: depth + 1, phase: 'enter' });
        }
      }
    }
  }
  return false;
}

export function createFirestoreSyncProvider(client) {
  function isConfigured() {
    return Boolean(client && client.isConfigured());
  }

  async function pullLatest(first, second) {
    if (!isConfigured() || !first || !second) {
      return null;
    }

    let userId = first;
    let gameId = second;
    if (typeof first === 'string' && typeof second === 'string') {
      if (!first.includes('-') && second.includes('-')) {
        gameId = first;
        userId = second;
      }
    }

    // Sacred privacy check: Sankalpa vault is never pulled or synced
    if (typeof gameId === 'string' && /sankalpa/i.test(gameId)) {
      return null;
    }

    try {
      const docPath = `users/${userId}/game_saves/${gameId}`;
      const { data, error } = await client.firestore.getDocument(docPath);

      if (error || !data) {
        return null;
      }

      return Object.freeze({
        envelopeVersion: data.envelopeVersion || 1,
        gameId: data.gameId || gameId,
        gameSchemaVersion: data.gameSchemaVersion || 1,
        revision: Number(data.revision) || 1,
        sourceGuestId: data.sourceGuestId || null,
        checksum: data.checksum,
        payload: data.payload,
        clientUpdatedAt: data.clientUpdatedAt,
        serverUpdatedAt: data.serverUpdatedAt || data.__updateTime,
        isEmpty: false
      });
    } catch {
      return null;
    }
  }

  async function pushWithOptimisticLock(envelopeOrOptions, maybeUserId, maybeExpectedRevision = 0) {
    if (!isConfigured() || !envelopeOrOptions) {
      return Object.freeze({ status: 'disabled' });
    }

    let envelope = envelopeOrOptions;
    let userId = maybeUserId;
    let expectedRevision = maybeExpectedRevision;

    if (envelopeOrOptions && typeof envelopeOrOptions === 'object' && envelopeOrOptions.envelope) {
      envelope = envelopeOrOptions.envelope;
      userId = envelopeOrOptions.userId || maybeUserId;
      expectedRevision =
        envelopeOrOptions.expectedRevision !== undefined
          ? envelopeOrOptions.expectedRevision
          : maybeExpectedRevision;
    }

    if (!userId) {
      return Object.freeze({ status: 'disabled', message: 'User ID required for cloud sync' });
    }

    const gameId = envelope.gameId;

    // Sacred Privacy Invariant: Sankalpa is strictly local-only
    if (
      (typeof gameId === 'string' && /sankalpa/i.test(gameId)) ||
      envelope.localOnly ||
      payloadContainsForbiddenSankalpa(envelope.payload)
    ) {
      return Object.freeze({
        status: 'disabled',
        message: 'Sankalpa vault and local-only data are strictly excluded from cloud sync'
      });
    }

    try {
      const docPath = `users/${userId}/game_saves/${gameId}`;

      // 1. Fetch current server document to verify expectedRevision
      const { data: existingDoc, error: fetchError } = await client.firestore.getDocument(docPath);

      const serverRevision = existingDoc ? Number(existingDoc.revision) || 1 : 0;

      // 2. Optimistic Concurrency Revision Check
      if (existingDoc && expectedRevision !== serverRevision) {
        return Object.freeze({
          status: 'conflict',
          currentRevision: serverRevision,
          expectedRevision,
          serverRecord: Object.freeze({
            envelopeVersion: existingDoc.envelopeVersion || 1,
            gameId: existingDoc.gameId || gameId,
            gameSchemaVersion: existingDoc.gameSchemaVersion || 1,
            revision: serverRevision,
            sourceGuestId: existingDoc.sourceGuestId || null,
            checksum: existingDoc.checksum,
            payload: existingDoc.payload,
            clientUpdatedAt: existingDoc.clientUpdatedAt,
            serverUpdatedAt: existingDoc.serverUpdatedAt || existingDoc.__updateTime
          })
        });
      }

      // Compute next revision
      const newRevision = serverRevision + 1;
      const nowIso = new Date().toISOString();

      const newRecord = {
        envelopeVersion: envelope.envelopeVersion || 1,
        gameId,
        gameSchemaVersion: envelope.gameSchemaVersion || 1,
        revision: newRevision,
        sourceGuestId: envelope.guestId || null,
        checksum: envelope.checksum,
        payload: envelope.payload,
        clientUpdatedAt: envelope.clientUpdatedAt || nowIso,
        serverUpdatedAt: nowIso
      };

      // 3. Write active save document
      const writeRes = await client.firestore.setDocument(docPath, newRecord);

      if (!writeRes.ok) {
        return Object.freeze({
          status: 'error',
          message: writeRes.error || 'FIRESTORE_WRITE_ERROR'
        });
      }

      // 4. Archive into revisions subcollection (bounded history safety net)
      try {
        const revPath = `users/${userId}/game_saves/${gameId}/revisions/rev_${newRevision}`;
        await client.firestore.setDocument(revPath, {
          revision: newRevision,
          checksum: envelope.checksum,
          payload: envelope.payload,
          archivedAt: nowIso
        });
      } catch {
        // Non-fatal if revision archiving fails
      }

      return Object.freeze({
        status: 'success',
        newRevision,
        gameId
      });
    } catch (err) {
      return Object.freeze({
        status: 'error',
        message: err.message || 'NETWORK_FAILURE'
      });
    }
  }

  async function listSaves(userId) {
    if (!isConfigured() || !userId) return Object.freeze([]);
    try {
      const collectionPath = `users/${userId}/game_saves`;
      const { data, error } = await client.firestore.listDocuments(collectionPath);

      if (error || !Array.isArray(data)) return Object.freeze([]);

      return Object.freeze(data.map((r) => ({
        gameId: r.gameId,
        revision: Number(r.revision) || 1,
        checksum: r.checksum,
        clientUpdatedAt: r.clientUpdatedAt,
        serverUpdatedAt: r.serverUpdatedAt || r.__updateTime
      })));
    } catch {
      return Object.freeze([]);
    }
  }

  return Object.freeze({
    providerName: 'firestore-cloud-sync',
    isConfigured,
    pullLatest,
    pushWithOptimisticLock,
    listSaves
  });
}
