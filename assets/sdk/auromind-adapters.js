/**
 * AuroMind Shared SDK — Game Adapter Contracts & Registry (v1.0.0)
 *
 * Provider-independent, framework-independent browser-native ES module.
 * Enforces the strict boundary between platform-owned guest identity
 * (AuroMindPlatformDB / auromind.platform.*) and game-owned save storage.
 *
 * Zero external dependencies. Zero network calls. Zero game-specific
 * save schemas or concrete game integrations in Batch B1.
 */

export const ADAPTER_CONTRACT_VERSION = 1;
export const SUPPORTED_SDK_MAJOR = 1;
export const PLATFORM_DB_NAME = 'AuroMindPlatformDB';
export const PLATFORM_LS_ROOT = 'auromind.platform';
export const PLATFORM_LS_PREFIX = 'auromind.platform.';
export const SAVE_ENVELOPE_VERSION = 1;
export const GUEST_ID_RE =
  /^guest_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const KNOWN_GAME_IDS = Object.freeze([
  'vak',
  'auromatch',
  'auromandala',
  'word-riddle',
  'vak-living-sanctuary',
  'auroblocks',
  'maablocs'
]);

const VALID_GAME_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const VALID_SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/;
const VALID_STORAGE_KINDS = new Set(['idb+ls', 'idb', 'ls']);
const VALID_INTEGRATION_MODES = new Set(['native', 'observer-only']);

/**
 * Returns true if a localStorage key is reserved by the AuroMind platform
 * (exact root `auromind.platform` or any key under `auromind.platform.*`).
 * @param {unknown} key
 * @returns {boolean}
 */
export function isProtectedPlatformKey(key) {
  return (
    typeof key === 'string' &&
    (key === PLATFORM_LS_ROOT || key.startsWith(PLATFORM_LS_PREFIX))
  );
}
const VALID_MERGE_STATUSES = new Set([
  'use_local',
  'use_remote',
  'auto_merged',
  'conflict_requires_user_choice'
]);

export class AuroMindAdapterError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AuroMindAdapterError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

/**
 * Parses a strict MAJOR.MINOR.PATCH semantic version string.
 * @param {string} version
 * @returns {{ major: number, minor: number, patch: number } | null}
 */
export function parseSemver(version) {
  if (typeof version !== 'string') return null;
  const match = VALID_SEMVER_RE.exec(version.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
}

/**
 * Compares two semver strings: returns -1 if a < b, 0 if equal, 1 if a > b.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) {
    throw new AuroMindAdapterError(
      'INVALID_VERSION',
      `Invalid semver comparison between "${a}" and "${b}".`,
      { a, b }
    );
  }
  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1;
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1;
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1;
  return 0;
}

/**
 * Checks whether an adapter's declared contractVersion and SDK version bounds
 * are compatible with the running SDK version.
 *
 * @param {object} adapter
 * @param {string} sdkVersion
 * @returns {{ compatible: boolean, reasons: readonly string[] }}
 */
export function checkAdapterCompatibility(adapter, sdkVersion) {
  const reasons = [];
  const parsedSdk = parseSemver(sdkVersion);
  if (!parsedSdk) {
    reasons.push(`Invalid running SDK version "${sdkVersion}".`);
  }

  if (!adapter || typeof adapter !== 'object') {
    reasons.push('Adapter must be a non-null object.');
    return Object.freeze({ compatible: false, reasons: Object.freeze(reasons) });
  }

  if (adapter.contractVersion !== ADAPTER_CONTRACT_VERSION) {
    reasons.push(
      `Unsupported adapter contractVersion "${String(adapter.contractVersion)}"; expected ${ADAPTER_CONTRACT_VERSION}.`
    );
  }

  if (parsedSdk && parsedSdk.major !== SUPPORTED_SDK_MAJOR) {
    reasons.push(
      `SDK major version ${parsedSdk.major} is incompatible with adapter contract major ${SUPPORTED_SDK_MAJOR}.`
    );
  }

  if (adapter.minSdkVersion !== undefined) {
    const parsedMin = parseSemver(adapter.minSdkVersion);
    if (!parsedMin) {
      reasons.push(`Invalid minSdkVersion "${String(adapter.minSdkVersion)}".`);
    } else if (parsedSdk && compareSemver(sdkVersion, adapter.minSdkVersion) < 0) {
      reasons.push(
        `Adapter requires SDK >= ${adapter.minSdkVersion}, but running SDK is ${sdkVersion}.`
      );
    }
  }

  if (adapter.maxSdkVersion !== undefined) {
    const parsedMax = parseSemver(adapter.maxSdkVersion);
    if (!parsedMax) {
      reasons.push(`Invalid maxSdkVersion "${String(adapter.maxSdkVersion)}".`);
    } else if (parsedSdk && compareSemver(sdkVersion, adapter.maxSdkVersion) > 0) {
      reasons.push(
        `Adapter supports SDK <= ${adapter.maxSdkVersion}, but running SDK is ${sdkVersion}.`
      );
    }
  }

  return Object.freeze({
    compatible: reasons.length === 0,
    reasons: Object.freeze(reasons)
  });
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim().length > 0);
}

/**
 * Validates a GameStorageAdapter contract object without inspecting or
 * restricting game-specific save schemas.
 *
 * @param {object} adapter
 * @param {string} [sdkVersion='1.0.0']
 */
export function validateGameAdapter(adapter, sdkVersion = '1.0.0') {
  if (!adapter || typeof adapter !== 'object') {
    throw new AuroMindAdapterError(
      'INVALID_ADAPTER',
      'Game adapter must be a non-null object.'
    );
  }

  if (
    typeof adapter.gameId !== 'string' ||
    !VALID_GAME_ID_RE.test(adapter.gameId) ||
    adapter.gameId === 'portal'
  ) {
    throw new AuroMindAdapterError(
      'INVALID_GAME_ID',
      `Adapter gameId "${String(adapter.gameId)}" must be a lowercase slug and cannot be "portal".`,
      { gameId: adapter.gameId }
    );
  }

  if (!parseSemver(adapter.adapterVersion)) {
    throw new AuroMindAdapterError(
      'INVALID_ADAPTER_VERSION',
      `Adapter "${adapter.gameId}" must specify a valid semver adapterVersion.`,
      { gameId: adapter.gameId, adapterVersion: adapter.adapterVersion }
    );
  }

  const compat = checkAdapterCompatibility(adapter, sdkVersion);
  if (!compat.compatible) {
    throw new AuroMindAdapterError(
      'INCOMPATIBLE_ADAPTER',
      `Adapter "${adapter.gameId}" failed compatibility check: ${compat.reasons.join(' ')}`,
      { gameId: adapter.gameId, reasons: compat.reasons }
    );
  }

  if (!VALID_INTEGRATION_MODES.has(adapter.integrationMode)) {
    throw new AuroMindAdapterError(
      'INVALID_INTEGRATION_MODE',
      `Adapter "${adapter.gameId}" integrationMode must be "native" or "observer-only".`,
      { gameId: adapter.gameId, integrationMode: adapter.integrationMode }
    );
  }

  // Validate game-owned storage boundary declaration
  const storage = adapter.storage;
  if (!storage || typeof storage !== 'object') {
    throw new AuroMindAdapterError(
      'INVALID_STORAGE_DECLARATION',
      `Adapter "${adapter.gameId}" must declare a game-owned storage descriptor.`,
      { gameId: adapter.gameId }
    );
  }

  if (!VALID_STORAGE_KINDS.has(storage.kind)) {
    throw new AuroMindAdapterError(
      'INVALID_STORAGE_KIND',
      `Adapter "${adapter.gameId}" storage.kind must be "idb+ls", "idb", or "ls".`,
      { gameId: adapter.gameId, kind: storage.kind }
    );
  }

  const ownedDatabases = storage.ownedDatabases ?? [];
  const ownedLocalStorageKeys = storage.ownedLocalStorageKeys ?? [];
  const localOnlyVaults = storage.localOnlyVaults ?? [];

  if (!isStringArray(ownedDatabases)) {
    throw new AuroMindAdapterError(
      'INVALID_STORAGE_DECLARATION',
      `Adapter "${adapter.gameId}" storage.ownedDatabases must be an array of non-empty strings.`,
      { gameId: adapter.gameId }
    );
  }

  if (!isStringArray(ownedLocalStorageKeys)) {
    throw new AuroMindAdapterError(
      'INVALID_STORAGE_DECLARATION',
      `Adapter "${adapter.gameId}" storage.ownedLocalStorageKeys must be an array of non-empty strings.`,
      { gameId: adapter.gameId }
    );
  }

  if (!isStringArray(localOnlyVaults)) {
    throw new AuroMindAdapterError(
      'INVALID_STORAGE_DECLARATION',
      `Adapter "${adapter.gameId}" storage.localOnlyVaults must be an array of non-empty strings.`,
      { gameId: adapter.gameId }
    );
  }

  // Enforce strict boundary: game adapters may NEVER claim ownership of platform identity stores
  if (ownedDatabases.includes(PLATFORM_DB_NAME)) {
    throw new AuroMindAdapterError(
      'PLATFORM_BOUNDARY_VIOLATION',
      `Adapter "${adapter.gameId}" cannot claim ownership of platform database "${PLATFORM_DB_NAME}".`,
      { gameId: adapter.gameId, forbiddenDatabase: PLATFORM_DB_NAME }
    );
  }

  for (const key of ownedLocalStorageKeys) {
    if (isProtectedPlatformKey(key)) {
      throw new AuroMindAdapterError(
        'PLATFORM_BOUNDARY_VIOLATION',
        `Adapter "${adapter.gameId}" cannot claim ownership of protected platform key "${key}".`,
        { gameId: adapter.gameId, forbiddenKey: key }
      );
    }
  }

  // Validate required lifecycle & save-bridge functions
  if (typeof adapter.hasLocalProgress !== 'function') {
    throw new AuroMindAdapterError(
      'MISSING_ADAPTER_METHOD',
      `Adapter "${adapter.gameId}" must implement hasLocalProgress().`,
      { gameId: adapter.gameId, method: 'hasLocalProgress' }
    );
  }

  if (typeof adapter.exportEnvelope !== 'function') {
    throw new AuroMindAdapterError(
      'MISSING_ADAPTER_METHOD',
      `Adapter "${adapter.gameId}" must implement exportEnvelope(guestId).`,
      { gameId: adapter.gameId, method: 'exportEnvelope' }
    );
  }

  if (adapter.integrationMode === 'native' && typeof adapter.applyEnvelope !== 'function') {
    throw new AuroMindAdapterError(
      'MISSING_ADAPTER_METHOD',
      `Native adapter "${adapter.gameId}" must implement applyEnvelope(envelope).`,
      { gameId: adapter.gameId, method: 'applyEnvelope' }
    );
  }

  if (adapter.init !== undefined && typeof adapter.init !== 'function') {
    throw new AuroMindAdapterError(
      'INVALID_ADAPTER_METHOD',
      `Adapter "${adapter.gameId}" init property must be a function if provided.`,
      { gameId: adapter.gameId, method: 'init' }
    );
  }

  if (adapter.dispose !== undefined && typeof adapter.dispose !== 'function') {
    throw new AuroMindAdapterError(
      'INVALID_ADAPTER_METHOD',
      `Adapter "${adapter.gameId}" dispose property must be a function if provided.`,
      { gameId: adapter.gameId, method: 'dispose' }
    );
  }

  return true;
}

/**
 * Validates a GameMergeStrategy object paired with a game adapter.
 *
 * @param {object} mergeStrategy
 * @param {string} expectedGameId
 */
export function validateMergeStrategy(mergeStrategy, expectedGameId) {
  if (!mergeStrategy || typeof mergeStrategy !== 'object') {
    throw new AuroMindAdapterError(
      'INVALID_MERGE_STRATEGY',
      'Merge strategy must be a non-null object.',
      { expectedGameId }
    );
  }

  if (mergeStrategy.gameId !== expectedGameId) {
    throw new AuroMindAdapterError(
      'MERGE_STRATEGY_MISMATCH',
      `Merge strategy gameId "${String(mergeStrategy.gameId)}" does not match adapter gameId "${expectedGameId}".`,
      { expectedGameId, actualGameId: mergeStrategy.gameId }
    );
  }

  if (typeof mergeStrategy.resolve !== 'function') {
    throw new AuroMindAdapterError(
      'INVALID_MERGE_STRATEGY',
      `Merge strategy for "${expectedGameId}" must implement resolve(local, remote).`,
      { gameId: expectedGameId }
    );
  }

  return true;
}

/**
 * Validates the envelope framing returned by a game adapter without imposing
 * any schema constraints on the game-owned `payload`.
 *
 * @param {object} envelope
 * @param {string} [expectedGameId]
 */
export function validateSaveEnvelope(envelope, expectedGameId) {
  if (!envelope || typeof envelope !== 'object') {
    throw new AuroMindAdapterError(
      'INVALID_SAVE_ENVELOPE',
      'Game save envelope must be a non-null object.'
    );
  }

  if (envelope.envelopeVersion !== SAVE_ENVELOPE_VERSION) {
    throw new AuroMindAdapterError(
      'UNSUPPORTED_ENVELOPE_VERSION',
      `Unsupported save envelopeVersion "${String(envelope.envelopeVersion)}"; expected ${SAVE_ENVELOPE_VERSION}.`,
      { envelopeVersion: envelope.envelopeVersion }
    );
  }

  if (expectedGameId && envelope.gameId !== expectedGameId) {
    throw new AuroMindAdapterError(
      'ENVELOPE_GAME_MISMATCH',
      `Save envelope gameId "${String(envelope.gameId)}" does not match expected "${expectedGameId}".`,
      { expectedGameId, actualGameId: envelope.gameId }
    );
  }

  if (!Number.isInteger(envelope.gameSchemaVersion) || envelope.gameSchemaVersion < 1) {
    throw new AuroMindAdapterError(
      'INVALID_SAVE_ENVELOPE',
      'Save envelope gameSchemaVersion must be a positive integer.',
      { gameSchemaVersion: envelope.gameSchemaVersion }
    );
  }

  if (typeof envelope.guestId !== 'string' || !GUEST_ID_RE.test(envelope.guestId)) {
    throw new AuroMindAdapterError(
      'INVALID_SAVE_ENVELOPE',
      'Save envelope guestId must be a valid RFC-4122 UUIDv4 guest_* identifier.'
    );
  }

  if (!Number.isInteger(envelope.baseRevision) || envelope.baseRevision < 0) {
    throw new AuroMindAdapterError(
      'INVALID_SAVE_ENVELOPE',
      'Save envelope baseRevision must be a non-negative integer.'
    );
  }

  if (typeof envelope.clientUpdatedAt !== 'string' || Number.isNaN(Date.parse(envelope.clientUpdatedAt))) {
    throw new AuroMindAdapterError(
      'INVALID_SAVE_ENVELOPE',
      'Save envelope clientUpdatedAt must be a valid ISO-8601 timestamp.'
    );
  }

  if (typeof envelope.isEmpty !== 'boolean') {
    throw new AuroMindAdapterError(
      'INVALID_SAVE_ENVELOPE',
      'Save envelope isEmpty must be a boolean.'
    );
  }

  if (typeof envelope.checksum !== 'string' || envelope.checksum.trim().length === 0) {
    throw new AuroMindAdapterError(
      'INVALID_SAVE_ENVELOPE',
      'Save envelope checksum must be a non-empty string.'
    );
  }

  if (!Object.prototype.hasOwnProperty.call(envelope, 'payload')) {
    throw new AuroMindAdapterError(
      'INVALID_SAVE_ENVELOPE',
      'Save envelope must include a game-owned payload property.'
    );
  }

  return true;
}

/**
 * Generates an RFC-4122 UUIDv4 identifier.
 */
export function generateArtworkUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function formatRecoveredTitle(title) {
  const base = typeof title === 'string' && title.trim() ? title.trim() : 'Mandala';
  return base.endsWith('(Recovered Copy)') ? base : `${base} (Recovered Copy)`;
}

/**
 * Normalizes and caps snapshots to the last 10 immutable snapshots (TASK-ART-01 / B19.5-03).
 * @param {Array} snapshots
 * @returns {Array}
 */
export function capSnapshots(snapshots) {
  if (!Array.isArray(snapshots)) return [];
  return snapshots
    .filter((s) => s && typeof s === 'object')
    .slice(-10)
    .map((s) => Object.freeze({ ...s }));
}

/**
 * Migrates legacy artwork array or dictionary to canonical map schema (TASK-ART-01 / B19.5-03).
 * Keyed by artworkId (UUIDv4), with rolling 10 immutable snapshot history, causal revision fields, and tombstone flags.
 *
 * @param {Array|object|null|undefined} artworksInput
 * @returns {Record<string, object>}
 */
export function migrateArtworksToMap(artworksInput) {
  if (!artworksInput) return {};

  const result = {};

  function normalizeEntry(art, fallbackId, fallbackTitle) {
    if (!art || typeof art !== 'object') return null;
    const artworkId = String(art.artworkId || art.id || fallbackId);
    const currentVersion = Math.max(1, Number(art.currentVersion || art.revision || art.version || 1));
    const createdAt = art.createdAt || new Date().toISOString();
    const updatedAt = art.updatedAt || art.createdAt || createdAt;
    const deleted = Boolean(art.deleted);
    const deletedAt = art.deletedAt || (deleted ? updatedAt : null);
    const tombstoneRevision = deleted ? (Number(art.tombstoneRevision || currentVersion) || currentVersion) : null;
    const parentRevisionId = typeof art.parentRevisionId === 'string' && art.parentRevisionId.trim()
      ? art.parentRevisionId.trim()
      : null;
    const strokesCount = art.strokesCount ?? (Array.isArray(art.strokes) ? art.strokes.length : 0);
    const contentHash =
      typeof art.contentHash === 'string' && art.contentHash.trim()
        ? art.contentHash.trim()
        : computePayloadChecksumSync(art.strokes || art.data || { title: art.title || fallbackTitle, strokesCount });

    const snapshots = Array.isArray(art.snapshots) && art.snapshots.length > 0
      ? capSnapshots(art.snapshots)
      : capSnapshots([{
          version: currentVersion,
          revision: currentVersion,
          contentHash,
          timestamp: updatedAt,
          strokesCount,
          data: art.data || art.strokes || []
        }]);

    return {
      artworkId,
      title: typeof art.title === 'string' && art.title.trim() ? art.title.trim() : fallbackTitle,
      currentVersion,
      revision: currentVersion,
      parentRevisionId,
      contentHash,
      createdAt,
      updatedAt,
      deleted,
      deletedAt,
      tombstoneRevision,
      strokesCount,
      ...(Array.isArray(art.strokes) ? { strokes: art.strokes } : {}),
      snapshots
    };
  }

  if (Array.isArray(artworksInput)) {
    for (let i = 0; i < artworksInput.length; i++) {
      const normalized = normalizeEntry(artworksInput[i], generateArtworkUuid(), `Mandala Artwork ${i + 1}`);
      if (normalized) result[normalized.artworkId] = normalized;
    }
  } else if (typeof artworksInput === 'object') {
    for (const [key, art] of Object.entries(artworksInput)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      const normalized = normalizeEntry(art, key, 'Mandala Artwork');
      if (normalized) result[normalized.artworkId] = normalized;
    }
  }

  return result;
}

/**
 * Merges two artwork maps with causal parent-revision & non-destructive conflict-forking semantics (TASK-ART-02 / B19.5-03).
 *
 * @param {Record<string, object>} localMap
 * @param {Record<string, object>} remoteMap
 * @returns {Record<string, object>}
 */
export function mergeArtworksWithForking(localMap = {}, remoteMap = {}) {
  const localNorm = migrateArtworksToMap(localMap);
  const remoteNorm = migrateArtworksToMap(remoteMap);
  const merged = { ...localNorm };

  for (const [remoteId, remoteArt] of Object.entries(remoteNorm)) {
    const localArt = merged[remoteId];

    if (!localArt) {
      merged[remoteId] = { ...remoteArt, snapshots: capSnapshots(remoteArt.snapshots) };
      continue;
    }

    if (localArt.deleted || remoteArt.deleted) {
      if (localArt.deleted && remoteArt.deleted) {
        const latestDeletedAt = (localArt.deletedAt || localArt.updatedAt) > (remoteArt.deletedAt || remoteArt.updatedAt)
          ? (localArt.deletedAt || localArt.updatedAt)
          : (remoteArt.deletedAt || remoteArt.updatedAt);
        const latestRev = Math.max(localArt.currentVersion || 1, remoteArt.currentVersion || 1);
        merged[remoteId] = {
          ...localArt,
          currentVersion: latestRev,
          revision: latestRev,
          tombstoneRevision: Math.max(localArt.tombstoneRevision || latestRev, remoteArt.tombstoneRevision || latestRev),
          deleted: true,
          deletedAt: latestDeletedAt
        };
      } else if (localArt.deleted && !remoteArt.deleted) {
        const tombstoneTag = `${localArt.artworkId}@rev_${localArt.tombstoneRevision || localArt.currentVersion}`;
        if (remoteArt.parentRevisionId && remoteArt.parentRevisionId === tombstoneTag) {
          // Genuine causal resurrection: remote explicitly branched from tombstone revision
          merged[remoteId] = {
            ...remoteArt,
            deleted: false,
            deletedAt: null,
            tombstoneRevision: null,
            snapshots: capSnapshots(remoteArt.snapshots)
          };
        } else {
          // Honor local tombstone; fork concurrent pre-tombstone edit if causally branched or newer
          const localDelTime = new Date(localArt.deletedAt || localArt.updatedAt).getTime();
          const remoteUpdTime = new Date(remoteArt.updatedAt).getTime();
          if (remoteArt.parentRevisionId || remoteUpdTime > localDelTime) {
            const forkedId = generateArtworkUuid();
            merged[forkedId] = {
              ...remoteArt,
              artworkId: forkedId,
              title: formatRecoveredTitle(remoteArt.title),
              deleted: false,
              deletedAt: null,
              tombstoneRevision: null,
              updatedAt: new Date().toISOString(),
              snapshots: capSnapshots(remoteArt.snapshots)
            };
          }
        }
      } else if (!localArt.deleted && remoteArt.deleted) {
        // Local active edit preserved over concurrent remote delete
        merged[remoteId] = { ...localArt };
      }
      continue;
    }

    const localStrokes = localArt.strokesCount || 0;
    const remoteStrokes = remoteArt.strokesCount || 0;
    const isIdentical =
      localArt.currentVersion === remoteArt.currentVersion &&
      localArt.contentHash === remoteArt.contentHash &&
      localStrokes === remoteStrokes;

    if (isIdentical) {
      continue;
    }

    // Check direct causal lineage before forking
    const localRevTag = `${localArt.artworkId}@rev_${localArt.currentVersion}`;
    const remoteRevTag = `${remoteArt.artworkId}@rev_${remoteArt.currentVersion}`;

    if (remoteArt.parentRevisionId && remoteArt.parentRevisionId === localRevTag) {
      merged[remoteId] = {
        ...remoteArt,
        snapshots: capSnapshots([...(localArt.snapshots || []), ...(remoteArt.snapshots || [])])
      };
      continue;
    }

    if (localArt.parentRevisionId && localArt.parentRevisionId === remoteRevTag) {
      merged[remoteId] = {
        ...localArt,
        snapshots: capSnapshots([...(remoteArt.snapshots || []), ...(localArt.snapshots || [])])
      };
      continue;
    }

    // Divergent edit/edit conflict: keep local original unchanged, fork remote non-destructively!
    const forkedId = generateArtworkUuid();
    merged[forkedId] = {
      ...remoteArt,
      artworkId: forkedId,
      title: formatRecoveredTitle(remoteArt.title),
      currentVersion: remoteArt.currentVersion || 1,
      revision: 1,
      updatedAt: new Date().toISOString(),
      createdAt: remoteArt.createdAt || new Date().toISOString(),
      deleted: false,
      deletedAt: null,
      tombstoneRevision: null,
      strokesCount: remoteArt.strokesCount,
      snapshots: capSnapshots(remoteArt.snapshots)
    };
  }

  return merged;
}

export const AuroBlocksMergeStrategy = Object.freeze({
  gameId: 'auroblocks',
  strategyVersion: '1.0.0',
  resolve(localEnvelope, remoteEnvelope) {
    const local = (localEnvelope && localEnvelope.payload) || {};
    const remote = (remoteEnvelope && remoteEnvelope.payload) || {};
    const localSave = local.save || local;
    const remoteSave = remote.save || remote;

    const localClassic = localSave.highScoreClassic ?? localSave.highScore ?? 0;
    const remoteClassic = remoteSave.highScoreClassic ?? remoteSave.highScore ?? 0;
    const highScoreClassic = Math.max(localClassic, remoteClassic);

    const localSudoku = localSave.highScoreSudoku ?? 0;
    const remoteSudoku = remoteSave.highScoreSudoku ?? 0;
    const highScoreSudoku = Math.max(localSudoku, remoteSudoku);

    const highScore = Math.max(highScoreClassic, highScoreSudoku, localSave.highScore ?? 0, remoteSave.highScore ?? 0);

    const mergeStageCollection = (localCol, remoteCol) => {
      const stagesMap = {};
      const primitiveStages = new Set();
      let hasObjectStages = false;
      const localList = Array.isArray(localCol) ? localCol : (localCol && typeof localCol === 'object' ? Object.values(localCol) : []);
      const remoteList = Array.isArray(remoteCol) ? remoteCol : (remoteCol && typeof remoteCol === 'object' ? Object.values(remoteCol) : []);

      for (const st of [...localList, ...remoteList]) {
        if (st === null || st === undefined) continue;
        if (typeof st === 'number' || typeof st === 'string') {
          primitiveStages.add(st);
          continue;
        }
        if (typeof st === 'object') {
          const id = st.stageId ?? st.id;
          if (id === undefined) continue;
          hasObjectStages = true;
          if (!stagesMap[id]) {
            stagesMap[id] = { ...st };
          } else {
            stagesMap[id] = {
              ...stagesMap[id],
              ...st,
              score: Math.max(stagesMap[id].score || 0, st.score || 0),
              stars: Math.max(stagesMap[id].stars || 0, st.stars || 0),
              cleared: Boolean(stagesMap[id].cleared || st.cleared)
            };
          }
        }
      }

      const sortedPrimitives = Array.from(primitiveStages).sort((a, b) => Number(a) - Number(b));
      if (hasObjectStages) {
        if (Array.isArray(localCol) || Array.isArray(remoteCol)) {
          return [...sortedPrimitives, ...Object.values(stagesMap)];
        }
        return stagesMap;
      }
      return sortedPrimitives;
    };

    const mergedStages = mergeStageCollection(localSave.stages, remoteSave.stages);
    const hasCompletedStages = Array.isArray(localSave.completedStages) || Array.isArray(remoteSave.completedStages);
    const mergedCompletedStages = hasCompletedStages
      ? mergeStageCollection(localSave.completedStages, remoteSave.completedStages)
      : undefined;

    const mergedStageScores = { ...(localSave.stageScores || {}) };
    if (remoteSave.stageScores && typeof remoteSave.stageScores === 'object') {
      for (const [k, v] of Object.entries(remoteSave.stageScores)) {
        if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
        mergedStageScores[k] = Math.max(Number(mergedStageScores[k] || 0), Number(v || 0));
      }
    }

    const resolvedPayload = {
      ...local,
      ...remote,
      highScore,
      highScoreClassic,
      highScoreSudoku,
      stages: mergedStages,
      ...(hasCompletedStages ? { completedStages: mergedCompletedStages } : {}),
      ...(Object.keys(mergedStageScores).length > 0 ? { stageScores: mergedStageScores } : {}),
      lastMergedAt: new Date().toISOString()
    };

    if (local.save || remote.save) {
      resolvedPayload.save = {
        ...(local.save || {}),
        ...(remote.save || {}),
        highScore,
        highScoreClassic,
        highScoreSudoku,
        stages: mergedStages,
        ...(hasCompletedStages ? { completedStages: mergedCompletedStages } : {}),
        ...(Object.keys(mergedStageScores).length > 0 ? { stageScores: mergedStageScores } : {}),
        updatedAt: new Date().toISOString()
      };
    }

    return Object.freeze({
      status: 'auto_merged',
      resolvedPayload
    });
  }
});

export const AuroMatchMergeStrategy = Object.freeze({
  gameId: 'auromatch',
  strategyVersion: '1.1.0',
  resolve(localEnvelope, remoteEnvelope) {
    const local = (localEnvelope && localEnvelope.payload) || {};
    const remote = (remoteEnvelope && remoteEnvelope.payload) || {};

    const unionUnique = (arrA, arrB) => {
      const seen = new Set();
      const out = [];
      for (const item of [...(Array.isArray(arrA) ? arrA : []), ...(Array.isArray(arrB) ? arrB : [])]) {
        if (item === null || item === undefined) continue;
        const k = typeof item === 'object' ? JSON.stringify(canonicalizeObject(item)) : `${typeof item}:${String(item)}`;
        if (!seen.has(k)) {
          seen.add(k);
          out.push(item);
        }
      }
      return out;
    };

    const mergeReflections = (arrA, arrB) => {
      const map = new Map();
      for (const r of [...(Array.isArray(arrA) ? arrA : []), ...(Array.isArray(arrB) ? arrB : [])]) {
        if (!r) continue;
        const key = (typeof r === 'object' && (r.id || r.promptId || r.timestamp)) || JSON.stringify(canonicalizeObject(r));
        if (!map.has(key)) map.set(key, r);
      }
      return Array.from(map.values());
    };

    const localLevels = Array.isArray(local.completedLevels) ? local.completedLevels : [];
    const remoteLevels = Array.isArray(remote.completedLevels) ? remote.completedLevels : [];
    const completedLevels = Array.from(new Set([...localLevels, ...remoteLevels])).sort((a, b) => Number(a) - Number(b));

    const petals = Math.max(Number(local.petals || 0), Number(remote.petals || 0));
    const reflections = mergeReflections(local.reflections, remote.reflections);

    // Bridge format: { user, consecrations, unlockedTiles } (preserves canonical Flora tile unlocks)
    const hasBridgeShape = Boolean(
      local.user || remote.user ||
      Array.isArray(local.unlockedTiles) || Array.isArray(remote.unlockedTiles) ||
      Array.isArray(local.consecrations) || Array.isArray(remote.consecrations)
    );

    const mergedUnlockedTiles = hasBridgeShape
      ? unionUnique(local.unlockedTiles, remote.unlockedTiles)
      : undefined;
    const mergedConsecrations = hasBridgeShape
      ? mergeReflections(local.consecrations, remote.consecrations)
      : undefined;

    let mergedUser = undefined;
    if (local.user || remote.user) {
      const lu = local.user || {};
      const ru = remote.user || {};
      const lp = lu.progression || {};
      const rp = ru.progression || {};
      const lprof = lu.profile || {};
      const rprof = ru.profile || {};
      const mergedLevelIds = unionUnique(
        unionUnique(lp.completedLevelIds, rp.completedLevelIds),
        mergedUnlockedTiles
      );
      mergedUser = {
        ...lu,
        ...ru,
        profile: {
          ...lprof,
          ...rprof,
          lotusPetalCount: Math.max(Number(lprof.lotusPetalCount || 0), Number(rprof.lotusPetalCount || 0), petals),
          consciousnessPoints: Math.max(Number(lprof.consciousnessPoints || 0), Number(rprof.consciousnessPoints || 0))
        },
        progression: {
          ...lp,
          ...rp,
          completedLevelsCount: Math.max(
            Number(lp.completedLevelsCount || 0),
            Number(rp.completedLevelsCount || 0),
            mergedLevelIds.length
          ),
          completedLevelIds: mergedLevelIds,
          unlockedThemes: unionUnique(lp.unlockedThemes, rp.unlockedThemes)
        }
      };
    }

    // Native storageAdapter format: { profileState }
    let mergedProfileState = undefined;
    if (local.profileState || remote.profileState) {
      const lps = local.profileState || {};
      const rps = remote.profileState || {};
      const lp = lps.progression || {};
      const rp = rps.progression || {};
      const lprof = lps.profile || {};
      const rprof = rps.profile || {};
      const mergedIds = unionUnique(lp.completedLevelIds, rp.completedLevelIds);
      mergedProfileState = {
        ...lps,
        ...rps,
        profile: {
          ...lprof,
          ...rprof,
          lotusPetalCount: Math.max(Number(lprof.lotusPetalCount || 0), Number(rprof.lotusPetalCount || 0)),
          consciousnessPoints: Math.max(Number(lprof.consciousnessPoints || 0), Number(rprof.consciousnessPoints || 0))
        },
        progression: {
          ...lp,
          ...rp,
          completedLevelsCount: Math.max(
            Number(lp.completedLevelsCount || 0),
            Number(rp.completedLevelsCount || 0),
            mergedIds.length
          ),
          completedLevelIds: mergedIds,
          unlockedThemes: unionUnique(lp.unlockedThemes, rp.unlockedThemes)
        },
        reflections: mergeReflections(lps.reflections, rps.reflections)
      };
    }

    const resolvedPayload = {
      ...local,
      ...remote,
      completedLevels,
      petals,
      reflections,
      ...(mergedUser !== undefined ? { user: mergedUser } : {}),
      ...(mergedUnlockedTiles !== undefined ? { unlockedTiles: mergedUnlockedTiles } : {}),
      ...(mergedConsecrations !== undefined ? { consecrations: mergedConsecrations } : {}),
      ...(mergedProfileState !== undefined ? { profileState: mergedProfileState } : {}),
      lastMergedAt: new Date().toISOString()
    };

    return Object.freeze({
      status: 'auto_merged',
      resolvedPayload
    });
  }
});

export const AuroMandalaMergeStrategy = Object.freeze({
  gameId: 'auromandala',
  strategyVersion: '1.0.0',
  resolve(localEnvelope, remoteEnvelope) {
    const local = (localEnvelope && localEnvelope.payload) || {};
    const remote = (remoteEnvelope && remoteEnvelope.payload) || {};
    const localCache = local.cache || local;
    const remoteCache = remote.cache || remote;

    const localProg = local.progression || (local.cache ? local.cache : local);
    const remoteProg = remote.progression || (remote.cache ? remote.cache : remote);

    const highestStageCleared = Math.max(
      Number(localProg.highestStageCleared || 0),
      Number(remoteProg.highestStageCleared || 0)
    );

    const sessionMap = new Map();
    const localSessions = Array.isArray(localProg.sessions) ? localProg.sessions : [];
    const remoteSessions = Array.isArray(remoteProg.sessions) ? remoteProg.sessions : [];
    for (const s of [...localSessions, ...remoteSessions]) {
      if (!s) continue;
      const key = s.id || s.sessionId || s.timestamp || JSON.stringify(s);
      if (!sessionMap.has(key)) {
        sessionMap.set(key, s);
      }
    }

    const localArtworks = local.artworks || (local.cache && local.cache.savedArtworks) || local.savedArtworks || {};
    const remoteArtworks = remote.artworks || (remote.cache && remote.cache.savedArtworks) || remote.savedArtworks || {};
    const mergedArtworks = mergeArtworksWithForking(localArtworks, remoteArtworks);

    const mergedProgression = {
      highestStageCleared,
      sessions: Array.from(sessionMap.values()),
      totalScore: Math.max(Number(localProg.totalScore || 0), Number(remoteProg.totalScore || 0)),
      bestStageScore: Math.max(Number(localProg.bestStageScore || 0), Number(remoteProg.bestStageScore || 0)),
      longestStreak: Math.max(Number(localProg.longestStreak || 0), Number(remoteProg.longestStreak || 0)),
      lastMergedAt: new Date().toISOString()
    };

    // If inputs use legacy cache structure, include merged cache for backward compatibility
    const usesLegacyCache = (local.cache !== undefined || remote.cache !== undefined) && !local.artworks && !remote.artworks;
    const resolvedPayload = usesLegacyCache
      ? {
          schemaVersion: 2,
          cache: {
            ...localCache,
            ...remoteCache,
            ...mergedProgression,
            savedArtworks: mergedArtworks
          },
          exportedAt: new Date().toISOString()
        }
      : {
          schemaVersion: 2,
          artworks: mergedArtworks,
          progression: mergedProgression,
          exportedAt: new Date().toISOString()
        };

    return Object.freeze({
      status: 'auto_merged',
      resolvedPayload
    });
  }
});

export const VakMergeStrategy = Object.freeze({
  gameId: 'vak',
  strategyVersion: '1.0.0',
  resolve(localEnvelope, remoteEnvelope) {
    const local = (localEnvelope && localEnvelope.payload) || {};
    const remote = (remoteEnvelope && remoteEnvelope.payload) || {};

    const currentLevel = Math.max(Number(local.currentLevel || 1), Number(remote.currentLevel || 1));
    const sparks = Math.max(Number(local.sparks || 0), Number(remote.sparks || 0));
    const petals = Math.max(Number(local.petals || 0), Number(remote.petals || 0));

    const localWords = Array.isArray(local.completedWords) ? local.completedWords : [];
    const remoteWords = Array.isArray(remote.completedWords) ? remote.completedWords : [];
    const completedWords = Array.from(new Set([...localWords, ...remoteWords]));

    const mergedStats = {
      ...(local.stats || {}),
      ...(remote.stats || {})
    };
    if (local.stats && remote.stats) {
      for (const [k, v] of Object.entries(local.stats)) {
        if (typeof v === 'number' && typeof remote.stats[k] === 'number') {
          mergedStats[k] = Math.max(v, remote.stats[k]);
        }
      }
    }

    const resolvedPayload = {
      ...local,
      ...remote,
      currentLevel,
      sparks,
      petals,
      completedWords,
      stats: mergedStats,
      lastMergedAt: new Date().toISOString()
    };

    return Object.freeze({
      status: 'auto_merged',
      resolvedPayload
    });
  }
});

export const WordRiddleMergeStrategy = Object.freeze({
  gameId: 'word-riddle',
  strategyVersion: '1.0.0',
  resolve(localEnvelope, remoteEnvelope) {
    const local = (localEnvelope && localEnvelope.payload) || {};
    const remote = (remoteEnvelope && remoteEnvelope.payload) || {};

    const localRiddles = Array.isArray(local.solvedRiddles) ? local.solvedRiddles : [];
    const remoteRiddles = Array.isArray(remote.solvedRiddles) ? remote.solvedRiddles : [];
    const solvedRiddles = Array.from(new Set([...localRiddles, ...remoteRiddles]));

    const currentStreak = Math.max(Number(local.currentStreak || 0), Number(remote.currentStreak || 0));
    const maxStreak = Math.max(Number(local.maxStreak || 0), Number(remote.maxStreak || 0), currentStreak);

    const activeTheme = remote.activeTheme || local.activeTheme || 'default';

    const resolvedPayload = {
      ...local,
      ...remote,
      solvedRiddles,
      currentStreak,
      maxStreak,
      activeTheme,
      lastMergedAt: new Date().toISOString()
    };

    return Object.freeze({
      status: 'auto_merged',
      resolvedPayload
    });
  }
});

export const VakLivingSanctuaryMergeStrategy = Object.freeze({
  gameId: 'vak-living-sanctuary',
  strategyVersion: '1.1.0',
  resolve(localEnvelope, remoteEnvelope) {
    const local = (localEnvelope && localEnvelope.payload) || {};
    const remote = (remoteEnvelope && remoteEnvelope.payload) || {};

    const localWords = Array.isArray(local.unlockedWords)
      ? local.unlockedWords
      : (local.progress && Array.isArray(local.progress.unlockedWords) ? local.progress.unlockedWords : []);
    const remoteWords = Array.isArray(remote.unlockedWords)
      ? remote.unlockedWords
      : (remote.progress && Array.isArray(remote.progress.unlockedWords) ? remote.progress.unlockedWords : []);
    const unlockedWords = Array.from(new Set([...localWords, ...remoteWords]));

    const localBookmarks = Array.isArray(local.bookmarks) ? local.bookmarks : [];
    const remoteBookmarks = Array.isArray(remote.bookmarks) ? remote.bookmarks : [];
    const bookmarks = Array.from(new Set([...localBookmarks, ...remoteBookmarks]));

    function extractNoteRev(n) {
      if (!n || typeof n !== 'object') return null;
      if (typeof n.revision === 'number' && !Number.isNaN(n.revision)) return n.revision;
      if (typeof n.rev === 'number' && !Number.isNaN(n.rev)) return n.rev;
      if (typeof n.version === 'number' && !Number.isNaN(n.version)) return n.version;
      return null;
    }

    function extractNoteTime(n) {
      if (!n || typeof n !== 'object') return '';
      return n.updatedAt || n.timestamp || n.modifiedAt || n.createdAt || '';
    }

    function extractNoteText(n) {
      if (!n || typeof n !== 'object') return '';
      return n.text ?? n.content ?? n.body ?? n.note ?? '';
    }

    function normalizeNotesList(source) {
      if (!source) return [];
      if (Array.isArray(source.personalNotes)) return source.personalNotes;
      if (Array.isArray(source.notes)) return source.notes;
      if (source.notes && typeof source.notes === 'object') return Object.values(source.notes);
      if (source.personalNotes && typeof source.personalNotes === 'object') return Object.values(source.personalNotes);
      return [];
    }

    const localNotesList = normalizeNotesList(local);
    const remoteNotesList = normalizeNotesList(remote);

    const notesMap = new Map();

    // 1. Seed with local notes
    for (const n of localNotesList) {
      if (!n) continue;
      const key = String(n.id || n.wordId || n.timestamp || JSON.stringify(n));
      notesMap.set(key, { ...n, id: key });
    }

    // 2. Reconcile remote notes with revision-aware conflict resolution
    for (const n of remoteNotesList) {
      if (!n) continue;
      const key = String(n.id || n.wordId || n.timestamp || JSON.stringify(n));
      const incomingNote = { ...n, id: key };

      if (!notesMap.has(key)) {
        notesMap.set(key, incomingNote);
        continue;
      }

      const existing = notesMap.get(key);
      const revExisting = extractNoteRev(existing);
      const revIncoming = extractNoteRev(incomingNote);
      const timeExisting = extractNoteTime(existing);
      const timeIncoming = extractNoteTime(incomingNote);
      const textExisting = extractNoteText(existing);
      const textIncoming = extractNoteText(incomingNote);
      const isIdentical = textExisting === textIncoming;

      if (isIdentical) {
        // Identical content: preserve higher revision or latest metadata
        if (revIncoming !== null && revExisting !== null) {
          if (revIncoming > revExisting) {
            notesMap.set(key, incomingNote);
          }
        } else if (timeIncoming > timeExisting) {
          notesMap.set(key, incomingNote);
        }
        continue;
      }

      // Divergent content: Revision-aware reconciliation
      // Invariant: Timestamps are supporting metadata only; they never override higher revisions.
      if (revIncoming !== null && revExisting !== null) {
        if (revIncoming > revExisting) {
          // Higher revision wins primary key
          notesMap.set(key, incomingNote);
          // Preserve lower revision non-destructively
          const recKey = `${key}_recovered`;
          if (!notesMap.has(recKey)) {
            notesMap.set(recKey, {
              ...existing,
              id: recKey,
              title: `${existing.title || key} (Recovered Copy)`,
              recoveredFrom: key
            });
          }
        } else if (revIncoming < revExisting) {
          // Existing higher revision preserves primary key.
          // Lower revision incoming cannot overwrite higher revision despite newer timestamp!
          const recKey = `${key}_recovered`;
          if (!notesMap.has(recKey)) {
            notesMap.set(recKey, {
              ...incomingNote,
              id: recKey,
              title: `${incomingNote.title || key} (Recovered Copy)`,
              recoveredFrom: key
            });
          }
        } else {
          // Equal revisions with different content:
          // Preserve BOTH versions non-destructively. Use timestamp as supporting metadata for primary key.
          const recKey = `${key}_recovered`;
          if (timeIncoming > timeExisting) {
            notesMap.set(key, incomingNote);
            notesMap.set(recKey, {
              ...existing,
              id: recKey,
              title: `${existing.title || key} (Recovered Copy)`,
              recoveredFrom: key
            });
          } else {
            notesMap.set(recKey, {
              ...incomingNote,
              id: recKey,
              title: `${incomingNote.title || key} (Recovered Copy)`,
              recoveredFrom: key
            });
          }
        }
      } else {
        // Missing revision metadata on one or both notes:
        // Invariant: Missing revision metadata must NOT cause silent data loss!
        const recKey = `${key}_recovered`;
        if (timeIncoming > timeExisting) {
          notesMap.set(key, incomingNote);
          notesMap.set(recKey, {
            ...existing,
            id: recKey,
            title: `${existing.title || key} (Recovered Copy)`,
            recoveredFrom: key
          });
        } else {
          notesMap.set(recKey, {
            ...incomingNote,
            id: recKey,
            title: `${incomingNote.title || key} (Recovered Copy)`,
            recoveredFrom: key
          });
        }
      }
    }

    const notesObj = {};
    for (const [k, v] of notesMap.entries()) {
      notesObj[k] = v;
    }

    const resolvedPayload = {
      ...local,
      ...remote,
      unlockedWords,
      bookmarks,
      personalNotes: Array.from(notesMap.values()),
      notes: notesObj,
      lastMergedAt: new Date().toISOString()
    };

    if (local.progress || remote.progress) {
      resolvedPayload.progress = {
        ...(local.progress || {}),
        ...(remote.progress || {}),
        unlockedWords
      };
    }

    return Object.freeze({
      status: 'auto_merged',
      resolvedPayload
    });
  }
});

export const MaaBlocsMergeStrategy = Object.freeze({
  gameId: 'maablocs',
  strategyVersion: '1.0.0',
  resolve(localEnvelope, remoteEnvelope) {
    const local = (localEnvelope && localEnvelope.payload) || {};
    const remote = (remoteEnvelope && remoteEnvelope.payload) || {};

    const localProgress = local.levelProgress || {};
    const remoteProgress = remote.levelProgress || {};
    const mergedProgress = { ...localProgress, ...remoteProgress };

    const localPBs = local.personalBests || {};
    const remotePBs = remote.personalBests || {};
    const mergedPBs = { ...localPBs };
    for (const [lvl, score] of Object.entries(remotePBs)) {
      if (typeof score === 'number') {
        mergedPBs[lvl] = Math.max(mergedPBs[lvl] || 0, score);
      }
    }

    return Object.freeze({
      status: 'auto_merged',
      resolvedPayload: {
        ...local,
        ...remote,
        levelProgress: mergedProgress,
        personalBests: mergedPBs,
        lastMergedAt: new Date().toISOString()
      }
    });
  }
});

export function getDefaultGameMergeStrategy(gameId) {
  switch (gameId) {
    case 'auroblocks': return AuroBlocksMergeStrategy;
    case 'maablocs': return MaaBlocsMergeStrategy;
    case 'auromatch': return AuroMatchMergeStrategy;
    case 'auromandala': return AuroMandalaMergeStrategy;
    case 'vak': return VakMergeStrategy;
    case 'word-riddle':
    case 'wordriddle': return WordRiddleMergeStrategy;
    case 'vak-living-sanctuary':
    case 'vak-sanctuary': return VakLivingSanctuaryMergeStrategy;
    default: return null;
  }
}

/**
 * Enforces mandatory non-destructive merge invariants before delegating to
 * a game-specific merge strategy. Never invents a generic progress merge.
 *
 * @param {string} gameId
 * @param {object} localEnvelope
 * @param {object | null} remoteEnvelope
 * @param {object | null} mergeStrategy
 */
export function resolveGameMerge(gameId, localEnvelope, remoteEnvelope, mergeStrategy = null) {
  validateSaveEnvelope(localEnvelope, gameId);
  if (remoteEnvelope !== null && remoteEnvelope !== undefined) {
    validateSaveEnvelope(remoteEnvelope, gameId);
  }

  // Invariant 1: Empty or absent remote NEVER overwrites local guest progress
  if (!remoteEnvelope || remoteEnvelope.isEmpty) {
    return Object.freeze({
      status: 'use_local',
      resolvedPayload: localEnvelope.payload
    });
  }

  // Invariant 2: Empty local with non-empty remote adopts remote
  if (localEnvelope.isEmpty && !remoteEnvelope.isEmpty) {
    return Object.freeze({
      status: 'use_remote',
      resolvedPayload: remoteEnvelope.payload
    });
  }

  // Invariant 3: Identical checksums require no merge
  if (localEnvelope.checksum === remoteEnvelope.checksum) {
    return Object.freeze({
      status: 'use_local',
      resolvedPayload: localEnvelope.payload
    });
  }

  // Invariant 4: Delegate strictly to game-owned merge strategy (no generic merge)
  if (!mergeStrategy) {
    return Object.freeze({
      status: 'conflict_requires_user_choice',
      conflictSummary: Object.freeze({
        reason: 'NO_GAME_MERGE_STRATEGY_REGISTERED',
        localSummary: Object.freeze({
          baseRevision: localEnvelope.baseRevision,
          clientUpdatedAt: localEnvelope.clientUpdatedAt
        }),
        remoteSummary: Object.freeze({
          baseRevision: remoteEnvelope.baseRevision,
          clientUpdatedAt: remoteEnvelope.clientUpdatedAt
        })
      })
    });
  }

  const resolution = mergeStrategy.resolve(localEnvelope, remoteEnvelope);
  if (!resolution || typeof resolution !== 'object' || !VALID_MERGE_STATUSES.has(resolution.status)) {
    throw new AuroMindAdapterError(
      'INVALID_MERGE_RESOLUTION',
      `Merge strategy for "${gameId}" returned an invalid resolution status.`,
      { gameId, resolution }
    );
  }

  return Object.freeze({ ...resolution });
}

/**
 * Normalizes and freezes explicit adapter capabilities for discovery.
 *
 * @param {object} adapter
 * @param {boolean} hasMergeStrategy
 */
export function normalizeAdapterCapabilities(adapter, hasMergeStrategy = false) {
  const declared = (adapter && typeof adapter.capabilities === 'object' && adapter.capabilities) || {};
  const localOnlyVaults = Object.freeze([...(adapter.storage?.localOnlyVaults ?? [])]);

  return Object.freeze({
    offlinePlay: declared.offlinePlay !== false,
    localPersistence: declared.localPersistence !== false,
    exportEnvelope: typeof adapter.exportEnvelope === 'function',
    applyEnvelope: typeof adapter.applyEnvelope === 'function',
    customMergeStrategy: Boolean(hasMergeStrategy),
    cloudSyncEligible:
      adapter.integrationMode === 'native' &&
      declared.cloudSyncEligible === true,
    hasLocalOnlyVaults: localOnlyVaults.length > 0,
    localOnlyVaults
  });
}

/**
 * Convenience helper to validate and freeze a game adapter definition.
 *
 * @param {object} spec
 * @param {string} [sdkVersion='1.0.0']
 */
export function defineGameAdapter(spec, sdkVersion = '1.0.0') {
  validateGameAdapter(spec, sdkVersion);
  return Object.freeze({
    ...spec,
    storage: Object.freeze({
      kind: spec.storage.kind,
      ownedDatabases: Object.freeze([...(spec.storage.ownedDatabases ?? [])]),
      ownedLocalStorageKeys: Object.freeze([...(spec.storage.ownedLocalStorageKeys ?? [])]),
      localOnlyVaults: Object.freeze([...(spec.storage.localOnlyVaults ?? [])])
    }),
    capabilities: normalizeAdapterCapabilities(spec, false)
  });
}

/**
 * Creates a game adapter registry bound to an AuroMind SDK instance.
 *
 * @param {object} sdkHooks
 * @param {string} sdkHooks.sdkVersion
 * @param {() => boolean} sdkHooks.isSdkInitialized
 * @param {() => object | null} sdkHooks.getIdentity
 * @param {() => string | null} sdkHooks.getGuestId
 * @param {() => object} sdkHooks.getCapabilities
 * @param {(gameId: string) => object} sdkHooks.canPlayGame
 */
export function createAdapterRegistry(sdkHooks) {
  if (!sdkHooks || typeof sdkHooks !== 'object') {
    throw new AuroMindAdapterError(
      'INVALID_REGISTRY_HOOKS',
      'createAdapterRegistry requires SDK lifecycle hooks.'
    );
  }

  const sdkVersion = sdkHooks.sdkVersion || '1.0.0';
  const entries = new Map();

  function buildPublicRecord(entry) {
    return Object.freeze({
      gameId: entry.adapter.gameId,
      adapterVersion: entry.adapter.adapterVersion,
      contractVersion: entry.adapter.contractVersion,
      integrationMode: entry.adapter.integrationMode,
      initialized: entry.initialized,
      initializedAt: entry.initializedAt,
      storage: entry.storage,
      capabilities: entry.capabilities,
      hasMergeStrategy: Boolean(entry.mergeStrategy)
    });
  }

  function assertNoStorageOwnershipConflict(gameId, storage) {
    for (const [otherGameId, otherEntry] of entries.entries()) {
      if (otherGameId === gameId) continue;

      for (const dbName of storage.ownedDatabases) {
        if (otherEntry.storage.ownedDatabases.includes(dbName)) {
          throw new AuroMindAdapterError(
            'STORAGE_OWNERSHIP_CONFLICT',
            `Adapter "${gameId}" cannot claim database "${dbName}" already owned by adapter "${otherGameId}".`,
            { gameId, conflictingGameId: otherGameId, resourceKind: 'database', resource: dbName }
          );
        }
      }

      for (const lsKey of storage.ownedLocalStorageKeys) {
        if (otherEntry.storage.ownedLocalStorageKeys.includes(lsKey)) {
          throw new AuroMindAdapterError(
            'STORAGE_OWNERSHIP_CONFLICT',
            `Adapter "${gameId}" cannot claim localStorage key "${lsKey}" already owned by adapter "${otherGameId}".`,
            { gameId, conflictingGameId: otherGameId, resourceKind: 'localStorageKey', resource: lsKey }
          );
        }
      }

      for (const vaultName of storage.localOnlyVaults) {
        if (otherEntry.storage.localOnlyVaults.includes(vaultName)) {
          throw new AuroMindAdapterError(
            'STORAGE_OWNERSHIP_CONFLICT',
            `Adapter "${gameId}" cannot claim local-only vault "${vaultName}" already owned by adapter "${otherGameId}".`,
            { gameId, conflictingGameId: otherGameId, resourceKind: 'localOnlyVault', resource: vaultName }
          );
        }
      }
    }
  }

  function register(adapter, options = {}) {
    validateGameAdapter(adapter, sdkVersion);

    const mergeStrategy = options.mergeStrategy !== undefined
      ? options.mergeStrategy
      : (getDefaultGameMergeStrategy(adapter.gameId) ?? null);

    if (mergeStrategy !== null) {
      validateMergeStrategy(mergeStrategy, adapter.gameId);
    }

    if (entries.has(adapter.gameId) && options.replace !== true) {
      throw new AuroMindAdapterError(
        'DUPLICATE_ADAPTER',
        `Game adapter "${adapter.gameId}" is already registered. Pass { replace: true } to replace it explicitly.`,
        { gameId: adapter.gameId }
      );
    }

    const storage = Object.freeze({
      kind: adapter.storage.kind,
      ownedDatabases: Object.freeze([...(adapter.storage.ownedDatabases ?? [])]),
      ownedLocalStorageKeys: Object.freeze([...(adapter.storage.ownedLocalStorageKeys ?? [])]),
      localOnlyVaults: Object.freeze([...(adapter.storage.localOnlyVaults ?? [])])
    });

    assertNoStorageOwnershipConflict(adapter.gameId, storage);

    const capabilities = normalizeAdapterCapabilities(adapter, Boolean(mergeStrategy));

    const entry = {
      adapter,
      mergeStrategy,
      storage,
      capabilities,
      initialized: false,
      initializedAt: null,
      initPromise: null
    };

    entries.set(adapter.gameId, entry);
    return buildPublicRecord(entry);
  }

  function get(gameId) {
    const entry = entries.get(gameId);
    return entry ? buildPublicRecord(entry) : null;
  }

  function has(gameId) {
    return entries.has(gameId);
  }

  function list() {
    return Object.freeze(Array.from(entries.values(), buildPublicRecord));
  }

  function discoverCapabilities(gameId) {
    if (gameId !== undefined) {
      const entry = entries.get(gameId);
      return entry ? entry.capabilities : null;
    }
    const summary = {};
    for (const [id, entry] of entries.entries()) {
      summary[id] = entry.capabilities;
    }
    return Object.freeze(summary);
  }

  async function init(gameId) {
    const entry = entries.get(gameId);
    if (!entry) {
      throw new AuroMindAdapterError(
        'ADAPTER_NOT_FOUND',
        `Cannot initialize unregistered game adapter "${String(gameId)}".`,
        { gameId }
      );
    }

    if (!sdkHooks.isSdkInitialized()) {
      throw new AuroMindAdapterError(
        'SDK_NOT_INITIALIZED',
        `Cannot initialize adapter "${gameId}" before AuroMind.init() has completed.`,
        { gameId }
      );
    }

    if (entry.initialized) {
      return buildPublicRecord(entry);
    }

    if (entry.initPromise) {
      return entry.initPromise;
    }

    const scopedContext = Object.freeze({
      sdkVersion,
      gameId: entry.adapter.gameId,
      getIdentity: () => sdkHooks.getIdentity(),
      getGuestId: () => sdkHooks.getGuestId(),
      getCapabilities: () => sdkHooks.getCapabilities(),
      canPlay: () => sdkHooks.canPlayGame(entry.adapter.gameId)
    });

    entry.initPromise = (async () => {
      try {
        if (typeof entry.adapter.init === 'function') {
          await entry.adapter.init(scopedContext);
        }
        entry.initialized = true;
        entry.initializedAt = new Date().toISOString();
        return buildPublicRecord(entry);
      } catch (err) {
        if (err instanceof AuroMindAdapterError) {
          throw err;
        }
        throw new AuroMindAdapterError(
          'ADAPTER_INIT_FAILED',
          `Adapter "${gameId}" failed during initialization: ${err && err.message ? err.message : String(err)}`,
          { gameId, cause: err }
        );
      } finally {
        entry.initPromise = null;
      }
    })();

    return entry.initPromise;
  }

  async function exportLocalEnvelope(gameId) {
    const entry = entries.get(gameId);
    if (!entry) {
      throw new AuroMindAdapterError(
        'ADAPTER_NOT_FOUND',
        `Game adapter "${String(gameId)}" is not registered.`,
        { gameId }
      );
    }
    const guestId = sdkHooks.getGuestId();
    if (!guestId) {
      throw new AuroMindAdapterError(
        'SDK_NOT_INITIALIZED',
        `Cannot export local envelope for "${gameId}" before guest identity is initialized.`,
        { gameId }
      );
    }
    const envelope = await entry.adapter.exportEnvelope(guestId);
    validateSaveEnvelope(envelope, gameId);
    return envelope;
  }

  async function applyRemoteEnvelope(gameId, envelope, context = null) {
    const entry = entries.get(gameId);
    if (!entry) {
      throw new AuroMindAdapterError(
        'ADAPTER_NOT_FOUND',
        `Game adapter "${String(gameId)}" is not registered.`,
        { gameId }
      );
    }
    validateSaveEnvelope(envelope, gameId);
    if (context && typeof context.isStillActive === 'function' && !context.isStillActive()) {
      return false;
    }
    if (typeof entry.adapter.applyEnvelope === 'function') {
      return await entry.adapter.applyEnvelope(envelope, context);
    }
    return false;
  }

  function resolveMerge(gameId, localEnvelope, remoteEnvelope) {
    const entry = entries.get(gameId);
    if (!entry) {
      throw new AuroMindAdapterError(
        'ADAPTER_NOT_FOUND',
        `Game adapter "${String(gameId)}" is not registered.`,
        { gameId }
      );
    }
    return resolveGameMerge(gameId, localEnvelope, remoteEnvelope, entry.mergeStrategy);
  }

  function registerMergeStrategy(gameId, mergeStrategy) {
    validateMergeStrategy(mergeStrategy, gameId);
    const entry = entries.get(gameId);
    if (!entry) {
      throw new AuroMindAdapterError(
        'ADAPTER_NOT_FOUND',
        `Cannot register merge strategy for unregistered adapter "${gameId}".`,
        { gameId }
      );
    }
    entry.mergeStrategy = mergeStrategy;
    entry.capabilities = normalizeAdapterCapabilities(entry.adapter, true);
    return buildPublicRecord(entry);
  }

  function getMergeStrategy(gameId) {
    const entry = entries.get(gameId);
    return entry ? (entry.mergeStrategy || null) : null;
  }

  async function unregister(gameId) {
    const entry = entries.get(gameId);
    if (!entry) return false;
    entries.delete(gameId);
    if (typeof entry.adapter.dispose === 'function') {
      await entry.adapter.dispose();
    }
    return true;
  }

  return Object.freeze({
    register,
    registerMergeStrategy,
    getMergeStrategy,
    get,
    has,
    list,
    init,
    discoverCapabilities,
    exportLocalEnvelope,
    exportEnvelope: exportLocalEnvelope,
    applyRemoteEnvelope,
    applyEnvelope: applyRemoteEnvelope,
    resolveMerge,
    unregister,
    quarantineCorruptSave: (gameId, raw, options) =>
      quarantineCorruptSave(gameId, raw, { ...options, guestId: sdkHooks.getGuestId() }),
    computeEnvelopeChecksum,
    canonicalizeJson: canonicalizeObject,
    checkCompatibility: (adapter) => checkAdapterCompatibility(adapter, sdkVersion)
  });
}

/**
 * Deterministically orders object keys recursively and eliminates undefined values.
 *
 * @param {unknown} obj
 * @returns {unknown}
 */
export function canonicalizeObject(obj) {
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

export const canonicalizeJson = canonicalizeObject;

/**
 * Filters out transport/synchronization metadata fields before checksumming.
 * Transport fields: clientUpdatedAt, baseRevision, guestId, checksum.
 *
 * @param {object} envelope
 * @returns {object}
 */
export function filterEnvelopeTransportFields(envelope) {
  if (!envelope || typeof envelope !== 'object') return envelope;
  const filtered = {};
  const excludedKeys = new Set(['clientUpdatedAt', 'baseRevision', 'guestId', 'checksum']);
  for (const [key, val] of Object.entries(envelope)) {
    if (!excludedKeys.has(key)) {
      filtered[key] = val;
    }
  }
  return filtered;
}

/**
 * Computes deterministic SHA-256 lowercase hex string for an arbitrary payload.
 * Runs via Web Crypto API in browser / Node with synchronous fallback.
 *
 * @param {unknown} payload
 * @param {object} [cryptoApi=globalThis.crypto]
 * @returns {Promise<string>}
 */
export async function computePayloadChecksum(payload, cryptoApi = globalThis.crypto) {
  let toHash = payload;
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && 'exportedAt' in payload) {
    const copy = { ...payload };
    delete copy.exportedAt;
    toHash = copy;
  }
  const canonical = canonicalizeObject(toHash);
  const jsonString = JSON.stringify(canonical);

  if (cryptoApi?.subtle && typeof cryptoApi.subtle.digest === 'function') {
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(jsonString);
    const hashBuffer = await cryptoApi.subtle.digest('SHA-256', dataBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // Pure JavaScript synchronous fallback
  return computeSha256Fallback(jsonString);
}

/**
 * Computes deterministic 64-char hex SHA-256 checksum of a save envelope,
 * strictly excluding transport fields (clientUpdatedAt, baseRevision, guestId, checksum).
 *
 * @param {object} envelope
 * @param {object} [cryptoApi=globalThis.crypto]
 * @returns {Promise<string>}
 */
export async function computeEnvelopeChecksum(envelope, cryptoApi = globalThis.crypto) {
  const filtered = filterEnvelopeTransportFields(envelope);
  return computePayloadChecksum(filtered, cryptoApi);
}

/**
 * Synchronous deterministic SHA-256 checksum for canonicalized payloads (browser + Node).
 * @param {unknown} payload
 * @returns {string}
 */
export function computePayloadChecksumSync(payload) {
  let toHash = payload;
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && 'exportedAt' in payload) {
    const copy = { ...payload };
    delete copy.exportedAt;
    toHash = copy;
  }
  const canonical = canonicalizeObject(toHash);
  return computeSha256Fallback(JSON.stringify(canonical));
}

/**
 * Pure JS synchronous SHA-256 fallback implementation
 */
function computeSha256Fallback(inputStr) {
  function rightRotate(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
  }
  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  let i, j;
  let result = '';

  const bytes = typeof TextEncoder !== 'undefined'
    ? Array.from(new TextEncoder().encode(String(inputStr)))
    : Array.from(unescape(encodeURIComponent(String(inputStr)))).map((ch) => ch.charCodeAt(0));

  const words = [];
  const bitLength = bytes.length * 8;
  let hash = [];
  const k = [];
  let primeCounter = 0;

  const isComposite = {};
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (i = 0; i < 313; i += candidate) {
        isComposite[i] = candidate;
      }
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }

  bytes.push(0x80);
  while ((bytes.length % 64) !== 56) bytes.push(0x00);
  for (i = 0; i < bytes.length; i++) {
    words[i >> 2] = (words[i >> 2] || 0) | ((bytes[i] & 0xff) << (((3 - i) % 4) * 8));
  }
  words[words.length] = (bitLength / maxWord) | 0;
  words[words.length] = bitLength;

  for (j = 0; j < words.length; ) {
    const w = words.slice(j, (j += 16));
    const oldHash = hash.slice(0, 8);

    for (i = 0; i < 64; i++) {
      const w15 = w[i - 15], w2 = w[i - 2];
      const a = hash[0], e = hash[4];
      const temp1 =
        hash[7] +
        (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) +
        ((e & hash[5]) ^ (~e & hash[6])) +
        k[i] +
        (w[i] =
          i < 16
            ? (w[i] | 0)
            : (w[i - 16] +
                (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) +
                w[i - 7] +
                (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) |
              0);
      const temp2 =
        (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) +
        ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));

      hash = [(temp1 + temp2) | 0, hash[0], hash[1], hash[2], (hash[3] + temp1) | 0, hash[4], hash[5], hash[6]];
    }

    for (i = 0; i < 8; i++) {
      hash[i] = (hash[i] + oldHash[i]) | 0;
    }
  }

  for (i = 0; i < 8; i++) {
    for (j = 3; j >= 0; j--) {
      const b = (hash[i] >> (j * 8)) & 255;
      result += (b < 16 ? '0' : '') + b.toString(16);
    }
  }
  return result;
}

/**
 * Archives corrupted save payload to `localStorage['_corrupt_' + gameId + '_' + Date.now()]`,
 * caps archives at 3 per game, and mints a clean initial empty envelope so gameplay continues.
 *
 * @param {string} gameId
 * @param {unknown} raw
 * @param {object} [options]
 * @returns {object}
 */
export function quarantineCorruptSave(gameId, raw, options = {}) {
  const ls =
    options.localStorage ||
    (typeof globalThis.localStorage !== 'undefined' ? globalThis.localStorage : null);
  const now = options.now ? options.now() : Date.now();
  const timestamp = typeof now === 'number' ? now : Date.now();
  const quarantineKey = `_corrupt_${gameId}_${timestamp}`;

  if (ls && typeof ls.setItem === 'function') {
    try {
      ls.setItem(
        quarantineKey,
        typeof raw === 'string' ? raw : JSON.stringify(raw)
      );

      // Cap quarantine archives at 3 per game
      if (typeof ls.length === 'number' && typeof ls.key === 'function' && typeof ls.removeItem === 'function') {
        const matchingKeys = [];
        const prefix = `_corrupt_${gameId}_`;
        for (let i = 0; i < ls.length; i++) {
          const k = ls.key(i);
          if (k && k.startsWith(prefix)) {
            matchingKeys.push(k);
          }
        }
        if (matchingKeys.length > 3) {
          matchingKeys.sort();
          while (matchingKeys.length > 3) {
            const oldest = matchingKeys.shift();
            ls.removeItem(oldest);
          }
        }
      }
    } catch {}
  }

  const guestId = options.guestId || 'guest_00000000-0000-4000-8000-000000000000';
  const cleanEnvelope = Object.freeze({
    envelopeVersion: SAVE_ENVELOPE_VERSION,
    gameId,
    gameSchemaVersion: 1,
    guestId,
    baseRevision: 0,
    checksum: '0'.repeat(64),
    payload: {},
    clientUpdatedAt: new Date(timestamp).toISOString(),
    isEmpty: true
  });

  if (options.onQuarantined && typeof options.onQuarantined === 'function') {
    try {
      options.onQuarantined({ gameId, quarantineKey, raw });
    } catch {}
  }

  return cleanEnvelope;
}

/**
 * Creates a standalone mock bridge for offline play when a game is loaded
 * directly outside the portal theater (window.parent === window).
 *
 * @param {string} gameId
 * @param {object} [options]
 * @returns {object}
 */
export function createLocalMockBridge(gameId, options = {}) {
  const ls =
    options.localStorage ||
    (typeof globalThis.localStorage !== 'undefined' ? globalThis.localStorage : null);
  const now = options.now ? options.now : () => new Date().toISOString();
  const guestId = options.guestId || 'guest_standalone_00000000-0000-4000-8000-000000000000';
  const storagePrefix = `auromind_standalone_${gameId}_`;

  return Object.freeze({
    isMock: true,
    isStandalone: true,
    gameId,
    getGuestId: () => guestId,
    getIdentity: () =>
      Object.freeze({
        mode: 'guest',
        guestId,
        guest: Object.freeze({
          guestId,
          schemaVersion: 1,
          createdAt: new Date().toISOString(),
          lastSeenAt: new Date().toISOString(),
          origin: null,
          storageSource: 'mock',
          ephemeral: false
        }),
        account: null
      }),
    canPlay: () =>
      Object.freeze({ allowed: true, mode: 'guest', reason: 'standalone-mock', offlinePermitted: true }),
    getCapabilities: () =>
      Object.freeze({
        authEnabled: false,
        cloudSyncEnabled: false,
        entitlementsEnabled: false,
        analyticsEnabled: false,
        remoteConfigEnabled: false
      }),
    async exportEnvelope(payload = {}) {
      const canonical = canonicalizeObject(payload);
      const checksum = await computePayloadChecksum(canonical);
      return Object.freeze({
        envelopeVersion: SAVE_ENVELOPE_VERSION,
        gameId,
        gameSchemaVersion: 1,
        guestId,
        baseRevision: 1,
        checksum,
        payload: canonical,
        clientUpdatedAt: typeof now === 'function' ? now() : new Date().toISOString(),
        isEmpty: !payload || Object.keys(payload).length === 0
      });
    },
    async applyEnvelope(envelope) {
      if (!envelope || !envelope.payload) return false;
      if (ls && typeof ls.setItem === 'function') {
        try {
          ls.setItem(`${storagePrefix}save`, JSON.stringify(envelope.payload));
          return true;
        } catch {}
      }
      return true;
    },
    loadLocalSave() {
      if (ls && typeof ls.getItem === 'function') {
        try {
          const raw = ls.getItem(`${storagePrefix}save`);
          return raw ? JSON.parse(raw) : null;
        } catch {}
      }
      return null;
    },
    saveLocalSave(data) {
      if (ls && typeof ls.setItem === 'function') {
        try {
          ls.setItem(`${storagePrefix}save`, JSON.stringify(data));
          return true;
        } catch {}
      }
      return false;
    },
    logging: Object.freeze({
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {}
    }),
    storage: Object.freeze({
      getItem: (k) => (ls && typeof ls.getItem === 'function' ? ls.getItem(k) : null),
      setItem: (k, v) => (ls && typeof ls.setItem === 'function' ? ls.setItem(k, v) : undefined),
      removeItem: (k) => (ls && typeof ls.removeItem === 'function' ? ls.removeItem(k) : undefined)
    }),
    player: Object.freeze({
      getProfile: () => Object.freeze({ preferences: { seniorMode: false, reducedMotion: false, volume: 80 } }),
      updatePreferences: () => {}
    }),
    config: Object.freeze({
      get: (_k, def = null) => def,
      isFeatureEnabled: () => false
    }),
    achievements: Object.freeze({
      async unlock(id) {
        return Object.freeze({ unlocked: true, firstUnlock: false, id });
      },
      async incrementProgress(id, amount = 1, maxProgress = 100) {
        return Object.freeze({ id, unlocked: false, progress: amount, maxProgress });
      },
      hasUnlocked: () => false,
      getProgress: () => null,
      listDefinitions: () => Object.freeze([]),
      listUnlocked: () => Object.freeze([]),
      getAll: () => Object.freeze({}),
      subscribe: () => () => {}
    }),
    telemetry: Object.freeze({
      track: () => Object.freeze({ ok: true, buffered: true }),
      flush: async () => Object.freeze({ ok: true, sentCount: 0 })
    }),
    purchases: Object.freeze({
      hasAccess: () => true,
      purchase: async (sku) => Object.freeze({ ok: true, sku, status: 'mock_granted' })
    })
  });
}
