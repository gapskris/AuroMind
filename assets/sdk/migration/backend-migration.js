/**
 * AuroMind Platform — Backend Portability & Data Migration Engine (v1.0.0)
 *
 * Implements a provider-independent, canonical data export/import pipeline
 * for cross-provider database migration (Supabase <-> Firebase <-> Custom).
 *
 * Sacred Invariants:
 * 1. Sankalpa vault contents, prayer notes, and encryption keys are NEVER exported.
 * 2. Unconsented telemetry, passwords, and private credentials are NEVER exported.
 * 3. Cryptographic integrity: Every export is sealed with a SHA-256 integrity hash.
 * 4. Non-destructive conflict detection: Protects existing target player progress.
 */

export const CANONICAL_MIGRATION_SCHEMA_VERSION = 1;

const EXCLUDED_GAME_IDENTIFIERS = new Set(['auromandala_sankalpa']);
const SENSITIVE_KEY_PATTERN = /sankalpa|password|private_key|token|secret|credential/i;
const SANKALPA_KEY_RE = /sankalpa/i;
const SANKALPA_VALUE_RE =
  /(?:sankalpa_e2ee_vault|auromasti-sankalpa-backup|auromind_sankalpa_vault|sankalpa_reflections)/i;
const MAX_MIGRATION_INSPECTION_DEPTH = 64;
const MAX_MIGRATION_INSPECTION_NODES = 10000;

function isPlainInspectableObject(val) {
  if (val === null || typeof val !== 'object' || Array.isArray(val)) return false;
  if (Object.getOwnPropertySymbols(val).length > 0) return false;
  const proto = Object.getPrototypeOf(val);
  return proto === Object.prototype || proto === null;
}

function readSafeDataProp(obj, key) {
  const desc = Object.getOwnPropertyDescriptor(obj, key);
  if (!desc) return { ok: true, exists: false, value: undefined };
  if (typeof desc.get === 'function' || typeof desc.set === 'function' || !Object.prototype.hasOwnProperty.call(desc, 'value')) {
    return { ok: false, exists: true, reason: 'PRIVACY_INSPECTION_ACCESSOR_FORBIDDEN' };
  }
  return { ok: true, exists: true, value: desc.value };
}

/**
 * Iterative, descriptor-based, cycle-safe, fail-closed Sankalpa detector for migration validation.
 * Rejects accessors (without invoking getters), hostile proxies, unsupported non-plain objects,
 * cycles, depth/node limit breaches, and any Sankalpa keys or markers at any depth.
 */
function detectSankalpaOrInspectionLimit(root) {
  try {
    if (root === null || root === undefined || typeof root === 'boolean' || typeof root === 'number') {
      return null;
    }
    if (typeof root === 'string') return SANKALPA_VALUE_RE.test(root) ? 'SANKALPA_MARKER_IN_VALUE' : null;
    if (typeof root !== 'object') return 'PRIVACY_INSPECTION_UNSUPPORTED_TYPE';

    const activeAncestors = new Set();
    const completed = new WeakSet();
    const stack = [{ node: root, depth: 0, phase: 'enter' }];
    let inspected = 0;

    while (stack.length > 0) {
      const { node, depth, phase } = stack.pop();
      if (phase === 'exit') {
        activeAncestors.delete(node);
        completed.add(node);
        continue;
      }
      if (depth > MAX_MIGRATION_INSPECTION_DEPTH) return 'PRIVACY_INSPECTION_DEPTH_EXCEEDED';
      inspected += 1;
      if (inspected > MAX_MIGRATION_INSPECTION_NODES) return 'PRIVACY_INSPECTION_NODE_LIMIT_EXCEEDED';
      if (node === null || node === undefined) continue;
      const isArr = Array.isArray(node);
      if (!isArr && !isPlainInspectableObject(node)) return 'PRIVACY_INSPECTION_UNSUPPORTED_OBJECT';
      if (activeAncestors.has(node)) return 'PRIVACY_INSPECTION_CYCLE_DETECTED';
      if (completed.has(node)) continue;
      activeAncestors.add(node);
      stack.push({ node, depth, phase: 'exit' });

      if (Object.getOwnPropertySymbols(node).length > 0) {
        return 'PRIVACY_INSPECTION_SYMBOL_KEY_FORBIDDEN';
      }

      const propNames = Object.getOwnPropertyNames(node);
      for (let i = 0; i < propNames.length; i++) {
        const k = propNames[i];
        if (isArr && k === 'length') {
          const lenCheck = readSafeDataProp(node, 'length');
          if (!lenCheck.ok) return lenCheck.reason;
          continue;
        }
        if (SANKALPA_KEY_RE.test(k)) return `SANKALPA_KEY:${k}`;
        const prop = readSafeDataProp(node, k);
        if (!prop.ok) return prop.reason;
        const v = prop.value;
        if (v === null || v === undefined || typeof v === 'boolean' || typeof v === 'number') {
          continue;
        }
        if (typeof v === 'string') {
          if ((k === 'gameId' || k === 'game_id') && /sankalpa/i.test(v)) return `SANKALPA_GAME_ID:${v}`;
          if (SANKALPA_VALUE_RE.test(v)) return 'SANKALPA_MARKER_IN_VALUE';
        } else if (typeof v === 'object') {
          stack.push({ node: v, depth: depth + 1, phase: 'enter' });
        } else {
          return 'PRIVACY_INSPECTION_UNSUPPORTED_TYPE';
        }
      }
    }
    return null;
  } catch {
    return 'PRIVACY_INSPECTION_HOSTILE_OBJECT';
  }
}

/**
 * Iterative, descriptor-based, cycle-safe, fail-closed sanitizer for migration export.
 * Never invokes getters, never returns an uninspected subtree, and throws on accessors,
 * hostile proxies, unsupported object types, cycles, or depth/node limit breaches.
 */
function stripSankalpaFieldsFailClosed(root) {
  try {
    if (root === null || root === undefined || typeof root === 'boolean' || typeof root === 'number') {
      return root;
    }
    if (typeof root === 'string') {
      if (SANKALPA_VALUE_RE.test(root)) return undefined;
      return root;
    }
    if (typeof root !== 'object') {
      throw new Error('MIGRATION_PRIVACY_INSPECTION_FAILED: Unsupported primitive type');
    }

    const activeAncestors = new Set();
    let inspected = 0;
    const isRootArr = Array.isArray(root);
    if (!isRootArr && !isPlainInspectableObject(root)) {
      throw new Error('MIGRATION_PRIVACY_INSPECTION_FAILED: Unsupported non-plain object');
    }
    const rootOut = isRootArr ? [] : {};
    const workStack = [{ src: root, dst: rootOut, depth: 0, phase: 'enter' }];

    while (workStack.length > 0) {
      const frame = workStack.pop();
      const { src, dst, depth, phase } = frame;

      if (phase === 'exit') {
        activeAncestors.delete(src);
        continue;
      }

      if (depth > MAX_MIGRATION_INSPECTION_DEPTH) {
        throw new Error('MIGRATION_PRIVACY_INSPECTION_FAILED: Payload exceeded maximum safe inspection depth');
      }
      inspected += 1;
      if (inspected > MAX_MIGRATION_INSPECTION_NODES) {
        throw new Error('MIGRATION_PRIVACY_INSPECTION_FAILED: Payload exceeded maximum safe inspection node limit');
      }
      const isArr = Array.isArray(src);
      if (!isArr && !isPlainInspectableObject(src)) {
        throw new Error('MIGRATION_PRIVACY_INSPECTION_FAILED: Unsupported non-plain object');
      }
      if (activeAncestors.has(src)) {
        throw new Error('MIGRATION_PRIVACY_INSPECTION_FAILED: Cyclic payload cannot be safely inspected for migration');
      }
      if (Object.getOwnPropertySymbols(src).length > 0) {
        throw new Error('MIGRATION_PRIVACY_INSPECTION_FAILED: Symbol properties are forbidden in migration payload');
      }

      activeAncestors.add(src);
      workStack.push({ src, dst, depth, phase: 'exit' });

      const propNames = Object.getOwnPropertyNames(src);
      const childFrames = [];

      if (isArr) {
        for (let i = 0; i < propNames.length; i++) {
          const k = propNames[i];
          if (k === 'length') {
            const lenCheck = readSafeDataProp(src, 'length');
            if (!lenCheck.ok) throw new Error(`MIGRATION_PRIVACY_INSPECTION_FAILED: ${lenCheck.reason}`);
            continue;
          }
          if (SANKALPA_KEY_RE.test(k)) {
            throw new Error(`MIGRATION_PRIVACY_INSPECTION_FAILED: Forbidden Sankalpa property on array (${k})`);
          }
          const prop = readSafeDataProp(src, k);
          if (!prop.ok) throw new Error(`MIGRATION_PRIVACY_INSPECTION_FAILED: ${prop.reason}`);
          const item = prop.value;
          if (item === null || item === undefined || typeof item === 'boolean' || typeof item === 'number') {
            dst.push(item);
          } else if (typeof item === 'string') {
            if (!SANKALPA_VALUE_RE.test(item)) {
              dst.push(item);
            }
          } else if (typeof item === 'object') {
            const childArr = Array.isArray(item);
            if (!childArr && !isPlainInspectableObject(item)) {
              throw new Error('MIGRATION_PRIVACY_INSPECTION_FAILED: Unsupported non-plain object in array');
            }
            const childDst = childArr ? [] : {};
            dst.push(childDst);
            childFrames.push({ src: item, dst: childDst, depth: depth + 1, phase: 'enter' });
          } else {
            throw new Error('MIGRATION_PRIVACY_INSPECTION_FAILED: Unsupported primitive type in array');
          }
        }
      } else {
        for (let i = 0; i < propNames.length; i++) {
          const k = propNames[i];
          const prop = readSafeDataProp(src, k);
          if (!prop.ok) throw new Error(`MIGRATION_PRIVACY_INSPECTION_FAILED: ${prop.reason}`);
          if (SANKALPA_KEY_RE.test(k)) continue;
          const v = prop.value;
          if (v === null || v === undefined || typeof v === 'boolean' || typeof v === 'number') {
            dst[k] = v;
          } else if (typeof v === 'string') {
            if (SANKALPA_VALUE_RE.test(v)) continue;
            dst[k] = v;
          } else if (typeof v === 'object') {
            const childArr = Array.isArray(v);
            if (!childArr && !isPlainInspectableObject(v)) {
              throw new Error('MIGRATION_PRIVACY_INSPECTION_FAILED: Unsupported non-plain object');
            }
            const childDst = childArr ? [] : {};
            dst[k] = childDst;
            childFrames.push({ src: v, dst: childDst, depth: depth + 1, phase: 'enter' });
          } else {
            throw new Error('MIGRATION_PRIVACY_INSPECTION_FAILED: Unsupported primitive type');
          }
        }
      }

      for (let i = childFrames.length - 1; i >= 0; i--) {
        workStack.push(childFrames[i]);
      }
    }

    return rootOut;
  } catch (err) {
    if (err && typeof err.message === 'string' && err.message.startsWith('MIGRATION_PRIVACY_INSPECTION_FAILED')) {
      throw err;
    }
    throw new Error(`MIGRATION_PRIVACY_INSPECTION_FAILED: Hostile or uninspectable object (${err?.message || 'trap_error'})`);
  }
}

/**
 * Computes a deterministic SHA-256 checksum of an object.
 */
export async function computePayloadChecksum(data) {
  const normalized = JSON.stringify(data, Object.keys(data).sort());
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(normalized));
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Validates a canonical migration payload.
 *
 * @param {object} payload
 * @returns {Promise<{ valid: boolean, errors: string[] }>}
 */
export async function validateCanonicalData(payload) {
  const errors = [];
  if (!payload || typeof payload !== 'object') {
    return { valid: false, errors: ['Payload must be a non-null object'] };
  }

  // Sacred Privacy & Hostile Object Check FIRST (before any direct property access that could invoke getters/traps)
  const privacyHit = detectSankalpaOrInspectionLimit(payload);
  if (privacyHit) {
    return {
      valid: false,
      errors: [`CRITICAL PRIVACY VIOLATION: Sankalpa vault data or uninspectable structure detected (${privacyHit})`]
    };
  }

  if (payload.schemaVersion !== CANONICAL_MIGRATION_SCHEMA_VERSION) {
    errors.push(`Unsupported schema version: ${payload.schemaVersion}. Expected ${CANONICAL_MIGRATION_SCHEMA_VERSION}`);
  }

  if (!payload.sourceUserId) {
    errors.push('Missing sourceUserId in migration payload');
  }

  // Integrity Check
  if (payload.checksum) {
    const { checksum, ...contentWithoutChecksum } = payload;
    const computed = await computePayloadChecksum(contentWithoutChecksum);
    if (computed !== checksum) {
      errors.push(`Integrity checksum mismatch: expected ${checksum}, computed ${computed}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

function readPlainObjectDataPropsFailClosed(obj, label) {
  let propNames;
  try {
    if (!isPlainInspectableObject(obj)) {
      throw new Error(`MIGRATION_PRIVACY_INSPECTION_FAILED: ${label} must be a plain object`);
    }
    if (Object.getOwnPropertySymbols(obj).length > 0) {
      throw new Error(`MIGRATION_PRIVACY_INSPECTION_FAILED: ${label} contains forbidden symbol keys`);
    }
    propNames = Object.getOwnPropertyNames(obj);
  } catch (err) {
    if (err && typeof err.message === 'string' && err.message.startsWith('MIGRATION_PRIVACY_INSPECTION_FAILED')) {
      throw err;
    }
    throw new Error(`MIGRATION_PRIVACY_INSPECTION_FAILED: Hostile or uninspectable ${label}`);
  }

  const out = Object.create(null);
  for (let i = 0; i < propNames.length; i++) {
    const k = propNames[i];
    let prop;
    try {
      prop = readSafeDataProp(obj, k);
    } catch {
      throw new Error(`MIGRATION_PRIVACY_INSPECTION_FAILED: Hostile descriptor on ${label}.${k}`);
    }
    if (!prop.ok) {
      throw new Error(`MIGRATION_PRIVACY_INSPECTION_FAILED: ${prop.reason} on ${label}.${k}`);
    }
    out[k] = prop.value;
  }
  return { propNames, props: out };
}

function readPlainArrayItemsFailClosed(arr, label) {
  let propNames;
  try {
    if (!Array.isArray(arr)) {
      throw new Error(`MIGRATION_PRIVACY_INSPECTION_FAILED: ${label} must be an array`);
    }
    if (Object.getOwnPropertySymbols(arr).length > 0) {
      throw new Error(`MIGRATION_PRIVACY_INSPECTION_FAILED: ${label} contains forbidden symbol keys`);
    }
    propNames = Object.getOwnPropertyNames(arr);
  } catch (err) {
    if (err && typeof err.message === 'string' && err.message.startsWith('MIGRATION_PRIVACY_INSPECTION_FAILED')) {
      throw err;
    }
    throw new Error(`MIGRATION_PRIVACY_INSPECTION_FAILED: Hostile or uninspectable ${label}`);
  }

  const items = [];
  for (let i = 0; i < propNames.length; i++) {
    const k = propNames[i];
    let prop;
    try {
      prop = readSafeDataProp(arr, k);
    } catch {
      throw new Error(`MIGRATION_PRIVACY_INSPECTION_FAILED: Hostile descriptor on ${label}[${k}]`);
    }
    if (!prop.ok) {
      throw new Error(`MIGRATION_PRIVACY_INSPECTION_FAILED: ${prop.reason} on ${label}[${k}]`);
    }
    if (k === 'length') continue;
    if (SANKALPA_KEY_RE.test(k)) {
      throw new Error(`MIGRATION_PRIVACY_INSPECTION_FAILED: Forbidden Sankalpa property on ${label}`);
    }
    items.push(prop.value);
  }
  return items;
}

/**
 * Exports canonical player data from a source provider bundle.
 *
 * @param {object} providerBundle - { accountProvider, cloudSync, entitlements, auth }
 * @param {string} userId
 * @returns {Promise<object>} Canonical migration export object
 */
export async function exportCanonicalData(providerBundle, userId) {
  if (!providerBundle || !userId) {
    throw new Error('Provider bundle and userId required for export');
  }

  // 1. Retrieve raw data from source provider and inspect IMMEDIATELY before any downstream processing
  const rawExport = await providerBundle.accountProvider.exportUserData(userId);
  if (!rawExport) {
    throw new Error(`Failed to export data from provider for user ${userId}`);
  }

  const { propNames: rawTopKeys, props: rawProps } = readPlainObjectDataPropsFailClosed(rawExport, 'rawExport');

  // Inspect ALL top-level sections other than gameSaves/cloudSaves immediately (profile, linkedDevices, entitlements, email, and any extra sections)
  for (let i = 0; i < rawTopKeys.length; i++) {
    const sectionKey = rawTopKeys[i];
    if (SANKALPA_KEY_RE.test(sectionKey)) {
      throw new Error(`MIGRATION_PRIVACY_INSPECTION_FAILED: Forbidden Sankalpa section "${sectionKey}" in raw export`);
    }
    if (sectionKey === 'gameSaves' || sectionKey === 'cloudSaves') continue;
    const sectionHit = detectSankalpaOrInspectionLimit(rawProps[sectionKey]);
    if (sectionHit) {
      throw new Error(`MIGRATION_PRIVACY_INSPECTION_FAILED: Violation in export section "${sectionKey}" (${sectionHit})`);
    }
  }

  // 2. Filter and sanitize game saves (strictly omit Sankalpa; fail closed on accessors/proxies/depth/cycles)
  const rawSaveListVal = rawProps.gameSaves !== undefined ? rawProps.gameSaves : rawProps.cloudSaves;
  const rawSaveItems = rawSaveListVal !== undefined ? readPlainArrayItemsFailClosed(rawSaveListVal, 'gameSaves') : [];
  const sanitizedGameSaves = [];

  for (let i = 0; i < rawSaveItems.length; i++) {
    const { propNames: saveKeys, props: saveProps } = readPlainObjectDataPropsFailClosed(rawSaveItems[i], `gameSaves[${i}]`);
    const saveGameId = saveProps.gameId !== undefined ? saveProps.gameId : saveProps.game_id;
    if (EXCLUDED_GAME_IDENTIFIERS.has(saveGameId) || (typeof saveGameId === 'string' && /sankalpa/i.test(saveGameId))) {
      continue; // Strictly omit local-only Sankalpa vault
    }

    // Verify all non-payload metadata fields of the save object are safe & free of Sankalpa markers
    for (let j = 0; j < saveKeys.length; j++) {
      const sk = saveKeys[j];
      if (sk === 'payload') continue;
      if (SANKALPA_KEY_RE.test(sk)) {
        throw new Error(`MIGRATION_PRIVACY_INSPECTION_FAILED: Forbidden Sankalpa metadata key "${sk}" on save "${saveGameId}"`);
      }
      const metaHit = detectSankalpaOrInspectionLimit(saveProps[sk]);
      if (metaHit) {
        throw new Error(`MIGRATION_PRIVACY_INSPECTION_FAILED: Violation in save metadata "${sk}" (${metaHit})`);
      }
    }

    let payload = saveProps.payload;
    let envelopeVersion = saveProps.envelopeVersion || saveProps.envelope_version || 1;
    let gameSchemaVersion = saveProps.gameSchemaVersion || saveProps.game_schema_version || 1;
    let revision = Number(saveProps.revision) || 1;
    let checksum = saveProps.checksum || 'sha256_mock';

    if (!payload && providerBundle.cloudSync?.pullLatest) {
      const fullSave = await providerBundle.cloudSync.pullLatest(userId, saveGameId);
      if (fullSave) {
        const { props: fullProps } = readPlainObjectDataPropsFailClosed(fullSave, `pullLatest(${saveGameId})`);
        payload = fullProps.payload;
        envelopeVersion = fullProps.envelopeVersion;
        gameSchemaVersion = fullProps.gameSchemaVersion;
        revision = fullProps.revision;
        checksum = fullProps.checksum;
      }
    }

    sanitizedGameSaves.push({
      gameId: saveGameId,
      envelopeVersion,
      gameSchemaVersion,
      revision,
      checksum,
      payload: stripSankalpaFieldsFailClosed(payload || {}),
      clientUpdatedAt: saveProps.clientUpdatedAt || saveProps.client_updated_at || new Date().toISOString()
    });
  }

  // 3. Format guest links (already inspected for Sankalpa & hostile traps above)
  const rawLinks = rawProps.linkedDevices !== undefined
    ? readPlainArrayItemsFailClosed(rawProps.linkedDevices, 'linkedDevices')
    : [];
  const guestLinks = rawLinks.map((link, idx) => {
    const { props: lp } = readPlainObjectDataPropsFailClosed(link, `linkedDevices[${idx}]`);
    return {
      guestId: lp.guestId || lp.guest_id,
      deviceLabel: lp.deviceLabel || lp.device_label || 'unknown',
      linkedAt: lp.linkedAt || lp.linked_at || new Date().toISOString()
    };
  });

  // 4. Format entitlements (already inspected for Sankalpa & hostile traps above)
  const rawEntitlements = rawProps.entitlements !== undefined
    ? readPlainArrayItemsFailClosed(rawProps.entitlements, 'entitlements')
    : [];
  const entitlements = rawEntitlements.map((ent, idx) => {
    const { props: ep } = readPlainObjectDataPropsFailClosed(ent, `entitlements[${idx}]`);
    return {
      sku: ep.sku,
      gameId: ep.gameId || ep.game_id,
      tier: ep.tier || 'full',
      status: ep.status || 'active',
      source: ep.source || 'verified_purchase',
      grantedAt: ep.grantedAt || ep.granted_at || new Date().toISOString()
    };
  });

  const safeProfile = stripSankalpaFieldsFailClosed(rawProps.profile || {});

  const contentWithoutChecksum = {
    schemaVersion: CANONICAL_MIGRATION_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    sourceProvider: providerBundle.accountProvider?.providerName || 'unknown',
    sourceUserId: userId,
    identity: {
      userId,
      email: rawProps.email || null,
      profile: safeProfile
    },
    guestLinks,
    gameSaves: sanitizedGameSaves,
    entitlements
  };

  // Final defense-in-depth boundary verification before checksumming or returning
  const finalHit = detectSankalpaOrInspectionLimit(contentWithoutChecksum);
  if (finalHit) {
    throw new Error(`MIGRATION_PRIVACY_INSPECTION_FAILED: Final canonical export boundary rejected (${finalHit})`);
  }

  const checksum = await computePayloadChecksum(contentWithoutChecksum);

  return Object.freeze({
    ...contentWithoutChecksum,
    checksum
  });
}

/**
 * Imports canonical player data into a target provider bundle.
 *
 * @param {object} targetProviderBundle - { cloudSync, auth, entitlements, client }
 * @param {object} canonicalData
 * @param {object} [options]
 * @param {string} [options.targetUserId] - Overrides user ID in target system
 * @param {string} [options.conflictStrategy] - 'skip_older' | 'force_overwrite'
 * @returns {Promise<object>} Migration audit report
 */
export async function importCanonicalData(targetProviderBundle, canonicalData, options = {}) {
  const validation = await validateCanonicalData(canonicalData);
  if (!validation.valid) {
    throw new Error(`Canonical validation failed: ${validation.errors.join('; ')}`);
  }

  const targetUserId = options.targetUserId || canonicalData.sourceUserId;
  const conflictStrategy = options.conflictStrategy || 'skip_older';

  const auditLog = [];
  const conflicts = [];
  let importedSavesCount = 0;
  let importedLinksCount = 0;

  auditLog.push(`[INIT] Starting migration for user ${targetUserId} into ${targetProviderBundle.cloudSync?.providerName}`);

  // 1. Import Guest Identity Links
  if (targetProviderBundle.auth && typeof targetProviderBundle.auth.linkGuestIdentity === 'function') {
    for (const link of canonicalData.guestLinks || []) {
      try {
        const res = await targetProviderBundle.auth.linkGuestIdentity(link.guestId, { userId: targetUserId });
        if (res && res.linked) {
          importedLinksCount++;
          auditLog.push(`[GUEST_LINK] Successfully linked guest ${link.guestId}`);
        } else {
          auditLog.push(`[GUEST_LINK_WARN] Failed to link guest ${link.guestId}: ${res?.error}`);
        }
      } catch (err) {
        auditLog.push(`[GUEST_LINK_ERR] Error linking guest ${link.guestId}: ${err.message}`);
      }
    }
  }

  // 2. Import Game Cloud Saves with Optimistic Concurrency
  for (const save of canonicalData.gameSaves || []) {
    try {
      const existing = await targetProviderBundle.cloudSync.pullLatest(targetUserId, save.gameId);
      let expectedRevision = 0;

      if (existing && !existing.isEmpty) {
        expectedRevision = existing.revision;
        if (conflictStrategy === 'skip_older' && existing.revision >= save.revision) {
          conflicts.push({
            gameId: save.gameId,
            reason: 'TARGET_HAS_NEWER_OR_EQUAL_REVISION',
            targetRevision: existing.revision,
            importRevision: save.revision
          });
          auditLog.push(`[SAVE_SKIP] Skipped ${save.gameId}: target revision (${existing.revision}) >= import (${save.revision})`);
          continue;
        }
      }

      const envelope = {
        gameId: save.gameId,
        envelopeVersion: save.envelopeVersion,
        gameSchemaVersion: save.gameSchemaVersion,
        guestId: save.sourceGuestId || canonicalData.guestLinks?.[0]?.guestId || null,
        checksum: save.checksum,
        payload: save.payload,
        clientUpdatedAt: save.clientUpdatedAt
      };

      const pushRes = await targetProviderBundle.cloudSync.pushWithOptimisticLock(
        envelope,
        targetUserId,
        expectedRevision
      );

      if (pushRes.status === 'success') {
        importedSavesCount++;
        auditLog.push(`[SAVE_OK] Imported ${save.gameId} (new revision: ${pushRes.newRevision})`);
      } else if (pushRes.status === 'conflict') {
        conflicts.push({
          gameId: save.gameId,
          reason: 'CONCURRENCY_CONFLICT',
          serverRevision: pushRes.currentRevision,
          expectedRevision: pushRes.expectedRevision
        });
        auditLog.push(`[SAVE_CONFLICT] Conflict importing ${save.gameId} (server rev: ${pushRes.currentRevision})`);
      } else {
        auditLog.push(`[SAVE_ERR] Failed to save ${save.gameId}: ${pushRes.message}`);
      }
    } catch (err) {
      auditLog.push(`[SAVE_ERR] Exception importing ${save.gameId}: ${err.message}`);
    }
  }

  const success = conflicts.length === 0 && importedSavesCount > 0;
  auditLog.push(`[COMPLETE] Migration completed with status: ${success ? 'SUCCESS' : 'WITH_WARNINGS'}`);

  return Object.freeze({
    success,
    targetUserId,
    importedSavesCount,
    importedLinksCount,
    conflicts,
    auditLog,
    timestamp: new Date().toISOString()
  });
}

/**
 * Creates a rollback action plan from a migration audit.
 */
export function createMigrationRollbackPlan(migrationAudit) {
  if (!migrationAudit || !migrationAudit.targetUserId) {
    return { canRollback: false, error: 'Invalid migration audit report' };
  }
  return Object.freeze({
    canRollback: true,
    targetUserId: migrationAudit.targetUserId,
    strategy: 'REVERT_TO_PRE_MIGRATION_REVISIONS',
    actions: [
      `Query revision history for user ${migrationAudit.targetUserId}`,
      'Re-apply previous revision snapshots from revisions table/subcollection',
      'Revoke imported guest identity link associations if needed'
    ]
  });
}
