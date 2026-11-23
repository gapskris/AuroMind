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

function isPlainInspectableObject(val) {
  if (val === null || typeof val !== 'object' || Array.isArray(val)) return false;
  if (Object.getOwnPropertySymbols(val).length > 0) return false;
  const proto = Object.getPrototypeOf(val);
  return proto === Object.prototype || proto === null;
}

function extractPlainDataProps(obj) {
  try {
    if (!isPlainInspectableObject(obj)) return { ok: false };
    const propNames = Object.getOwnPropertyNames(obj);
    const props = Object.create(null);
    for (let i = 0; i < propNames.length; i++) {
      const k = propNames[i];
      const desc = Object.getOwnPropertyDescriptor(obj, k);
      if (!desc || typeof desc.get === 'function' || typeof desc.set === 'function' || !Object.prototype.hasOwnProperty.call(desc, 'value')) {
        return { ok: false };
      }
      props[k] = desc.value;
    }
    return { ok: true, props };
  } catch {
    return { ok: false };
  }
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

    const PRIVACY_BLOCKED = Object.freeze({
      status: 'disabled',
      message: 'Sankalpa vault and local-only data are strictly excluded from cloud sync'
    });

    const outer = extractPlainDataProps(envelopeOrOptions);
    if (!outer.ok) {
      return PRIVACY_BLOCKED;
    }

    let envProps = outer.props;
    let userId = maybeUserId;
    let expectedRevision = maybeExpectedRevision;

    if (outer.props.envelope !== undefined) {
      const nested = extractPlainDataProps(outer.props.envelope);
      if (!nested.ok) {
        return PRIVACY_BLOCKED;
      }
      if (payloadContainsForbiddenSankalpa(outer.props)) {
        return PRIVACY_BLOCKED;
      }
      envProps = nested.props;
      userId = outer.props.userId !== undefined ? outer.props.userId : maybeUserId;
      expectedRevision =
        outer.props.expectedRevision !== undefined
          ? outer.props.expectedRevision
          : maybeExpectedRevision;
    }

    if (typeof userId !== 'string' || userId.length === 0) {
      return Object.freeze({ status: 'disabled', message: 'User ID required for cloud sync' });
    }
    if (typeof expectedRevision !== 'number' || !Number.isFinite(expectedRevision)) {
      return PRIVACY_BLOCKED;
    }

    // Sacred privacy boundary: inspect complete envelope & payload before any client/RPC call
    if (
      (typeof envProps.gameId === 'string' && /sankalpa/i.test(envProps.gameId)) ||
      envProps.localOnly === true ||
      payloadContainsForbiddenSankalpa(envProps)
    ) {
      return PRIVACY_BLOCKED;
    }

    try {
      const { data: res, error } = await client.rpc('upsert_game_save_checked', {
        p_game_id: envProps.gameId,
        p_envelope_version: envProps.envelopeVersion || 1,
        p_game_schema_version: envProps.gameSchemaVersion || 1,
        p_expected_revision: expectedRevision,
        p_source_guest_id: envProps.guestId || null,
        p_checksum: envProps.checksum,
        p_payload: envProps.payload,
        p_client_updated_at: envProps.clientUpdatedAt || new Date().toISOString()
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
          gameId: envProps.gameId
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
