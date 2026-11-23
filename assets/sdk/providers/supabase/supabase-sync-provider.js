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

const SANKALPA_FORBIDDEN_MARKER_RE = /(?:sankalpa|auromasti-sankalpa-backup|auromind_sankalpa_vault)/i;

function payloadContainsForbiddenSankalpa(payload, depth = 0) {
  if (depth > 8 || payload === null || payload === undefined || typeof payload !== 'object') return false;
  if (Array.isArray(payload)) {
    return payload.some((item) => payloadContainsForbiddenSankalpa(item, depth + 1));
  }
  for (const [k, v] of Object.entries(payload)) {
    if (SANKALPA_FORBIDDEN_MARKER_RE.test(k)) return true;
    if (typeof v === 'string' && /(?:sankalpa_e2ee_vault|auromasti-sankalpa-backup|auromind_sankalpa_vault)/i.test(v)) {
      return true;
    }
    if (v && typeof v === 'object' && payloadContainsForbiddenSankalpa(v, depth + 1)) return true;
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
