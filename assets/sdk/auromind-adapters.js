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
  'auroblocks'
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

    const mergeStrategy = options.mergeStrategy ?? null;
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

  async function applyRemoteEnvelope(gameId, envelope) {
    const entry = entries.get(gameId);
    if (!entry) {
      throw new AuroMindAdapterError(
        'ADAPTER_NOT_FOUND',
        `Game adapter "${String(gameId)}" is not registered.`,
        { gameId }
      );
    }
    validateSaveEnvelope(envelope, gameId);
    if (typeof entry.adapter.applyEnvelope === 'function') {
      return await entry.adapter.applyEnvelope(envelope);
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
    checkCompatibility: (adapter) => checkAdapterCompatibility(adapter, sdkVersion)
  });
}
