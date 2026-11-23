/**
 * AuroMind Shared Platform SDK — Supabase CloudSyncProvider Adapter
 *
 * Implements optimistic concurrency cloud synchronization, pull, and push
 * using the server-authoritative PostgreSQL database and `upsert_game_save_checked` RPC.
 */

const KNOWN_SYNC_GAME_IDS = new Set([
  'vak',
  'auromatch',
  'auromandala',
  'word-riddle',
  'wordriddle',
  'vak-living-sanctuary',
  'vak-sanctuary',
  'auroblocks'
]);

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

export function createSupabaseSyncProvider(client) {
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
      // Only swap when caller passes (gameId, userId) using a known game slug
      if (KNOWN_SYNC_GAME_IDS.has(first) && !KNOWN_SYNC_GAME_IDS.has(second)) {
        gameId = first;
        userId = second;
      }
    }

    // Sacred privacy boundary: Sankalpa vault is strictly local-only and never pulled or synced
    if (typeof gameId === 'string' && /sankalpa/i.test(gameId)) {
      return null;
    }

    try {
      const { data, error } = await client
        .from('game_saves')
        .select('*')
        .eq('user_id', userId)
        .eq('game_id', gameId)
        .maybeSingle();

      if (error || !data) {
        return null;
      }

      return Object.freeze({
        envelopeVersion: data.envelope_version || 1,
        gameId: data.game_id,
        gameSchemaVersion: data.game_schema_version,
        revision: Number(data.revision) || 1,
        sourceGuestId: data.source_guest_id,
        checksum: data.checksum,
        payload: data.payload,
        clientUpdatedAt: data.client_updated_at,
        serverUpdatedAt: data.server_updated_at,
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

    // Sacred privacy boundary: Sankalpa vault and local-only data are strictly excluded from cloud sync
    if (
      (typeof envelope.gameId === 'string' && /sankalpa/i.test(envelope.gameId)) ||
      envelope.localOnly === true ||
      payloadContainsForbiddenSankalpa(envelope.payload)
    ) {
      return Object.freeze({
        status: 'disabled',
        message: 'Sankalpa vault and local-only data are strictly excluded from cloud sync'
      });
    }

    try {
      const { data: res, error } = await client.rpc('upsert_game_save_checked', {
        p_game_id: envelope.gameId,
        p_envelope_version: envelope.envelopeVersion || 1,
        p_game_schema_version: envelope.gameSchemaVersion || 1,
        p_expected_revision: expectedRevision,
        p_source_guest_id: envelope.guestId || null,
        p_checksum: envelope.checksum,
        p_payload: envelope.payload,
        p_client_updated_at: envelope.clientUpdatedAt || new Date().toISOString()
      });

      if (error) {
        return Object.freeze({
          status: 'error',
          message: error.message
        });
      }

      if (res && res.status === 'conflict') {
        return Object.freeze({
          status: 'conflict',
          currentRevision: res.currentRevision,
          expectedRevision: res.expectedRevision,
          serverRecord: res.serverRecord
        });
      }

      if (res && res.ok) {
        return Object.freeze({
          status: 'success',
          newRevision: res.revision,
          gameId: envelope.gameId
        });
      }

      return Object.freeze({
        status: 'error',
        message: res?.message || 'UNKNOWN_SYNC_RESULT'
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
      const { data, error } = await client
        .from('game_saves')
        .select('game_id, revision, checksum, client_updated_at, server_updated_at')
        .eq('user_id', userId);

      if (error || !Array.isArray(data)) return Object.freeze([]);
      return Object.freeze(data.map((r) => ({
        gameId: r.game_id,
        revision: Number(r.revision),
        checksum: r.checksum,
        clientUpdatedAt: r.client_updated_at,
        serverUpdatedAt: r.server_updated_at
      })));
    } catch {
      return Object.freeze([]);
    }
  }

  return Object.freeze({
    providerName: 'supabase-cloud-sync',
    isConfigured,
    pullLatest,
    pushWithOptimisticLock,
    listSaves
  });
}
