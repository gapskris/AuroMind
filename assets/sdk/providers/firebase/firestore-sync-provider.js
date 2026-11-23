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

function isPlainInspectableObject(val) {
  if (val === null || typeof val !== 'object' || Array.isArray(val)) return false;
  const proto = Object.getPrototypeOf(val);
  if (proto !== Object.prototype && proto !== null) return false;
  return Object.prototype.toString.call(val) === '[object Object]';
}

/**
 * Iterative, descriptor-based, cycle-safe, fail-closed Sankalpa privacy inspector.
 * Rejects forbidden Sankalpa keys/markers, accessor properties (without invoking getters),
 * hostile proxies, unsupported non-plain objects, cycles, and depth/node limit breaches.
 */
function payloadContainsForbiddenSankalpa(payload) {
  try {
    if (payload === null || payload === undefined || typeof payload === 'boolean' || typeof payload === 'number') {
      return false;
    }
    if (typeof payload === 'string') return SANKALPA_FORBIDDEN_VALUE_RE.test(payload);
    if (typeof payload !== 'object') return true; // Reject function, symbol, bigint

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
      const isArr = Array.isArray(node);
      if (!isArr && !isPlainInspectableObject(node)) return true; // Fail closed on unsupported object type
      if (activeAncestors.has(node)) return true; // Fail closed on cyclic payload
      if (completed.has(node)) continue;
      activeAncestors.add(node);
      stack.push({ node, depth, phase: 'exit' });

      if (Object.getOwnPropertySymbols(node).length > 0) return true; // Fail closed on symbol properties

      const propNames = Object.getOwnPropertyNames(node);
      for (let i = 0; i < propNames.length; i++) {
        const k = propNames[i];
        if (isArr && k === 'length') {
          const lenDesc = Object.getOwnPropertyDescriptor(node, 'length');
          if (!lenDesc || typeof lenDesc.get === 'function' || typeof lenDesc.set === 'function' || !Object.prototype.hasOwnProperty.call(lenDesc, 'value')) {
            return true;
          }
          continue;
        }
        if (SANKALPA_FORBIDDEN_KEY_RE.test(k)) return true;
        const desc = Object.getOwnPropertyDescriptor(node, k);
        if (!desc || typeof desc.get === 'function' || typeof desc.set === 'function' || !Object.prototype.hasOwnProperty.call(desc, 'value')) {
          return true; // Reject accessor without invoking getter
        }
        const v = desc.value;
        if (v === null || v === undefined || typeof v === 'boolean' || typeof v === 'number') {
          continue;
        }
        if (typeof v === 'string') {
          if (SANKALPA_FORBIDDEN_VALUE_RE.test(v)) return true;
        } else if (typeof v === 'object') {
          stack.push({ node: v, depth: depth + 1, phase: 'enter' });
        } else {
          return true; // Unsupported primitive (function/symbol/bigint)
        }
      }
    }
    return false;
  } catch {
    return true; // Fail closed on hostile Proxy / trap exception
  }
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
