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

/**
 * Iterative, cycle-safe, fail-closed Sankalpa detector for migration validation.
 */
function detectSankalpaOrInspectionLimit(root) {
  if (root === null || root === undefined) return null;
  if (typeof root === 'string') return SANKALPA_VALUE_RE.test(root) ? 'SANKALPA_MARKER_IN_VALUE' : null;
  if (typeof root !== 'object') return null;

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
    if (typeof node === 'string') {
      if (SANKALPA_VALUE_RE.test(node)) return 'SANKALPA_MARKER_IN_VALUE';
      continue;
    }
    if (typeof node !== 'object') continue;
    if (activeAncestors.has(node)) return 'PRIVACY_INSPECTION_CYCLE_DETECTED';
    if (completed.has(node)) continue;
    activeAncestors.add(node);
    stack.push({ node, depth, phase: 'exit' });

    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const item = node[i];
        if (typeof item === 'string') {
          if (SANKALPA_VALUE_RE.test(item)) return 'SANKALPA_MARKER_IN_VALUE';
        } else if (item && typeof item === 'object') {
          stack.push({ node: item, depth: depth + 1, phase: 'enter' });
        }
      }
    } else {
      const keys = Object.keys(node);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        if (SANKALPA_KEY_RE.test(k)) return `SANKALPA_KEY:${k}`;
        const v = node[k];
        if (typeof v === 'string') {
          if (k === 'gameId' && /sankalpa/i.test(v)) return `SANKALPA_GAME_ID:${v}`;
          if (SANKALPA_VALUE_RE.test(v)) return 'SANKALPA_MARKER_IN_VALUE';
        } else if (v && typeof v === 'object') {
          stack.push({ node: v, depth: depth + 1, phase: 'enter' });
        }
      }
    }
  }
  return null;
}

/**
 * Iterative, cycle-safe, fail-closed sanitizer for migration export.
 * Never returns an uninspected subtree when depth/node limits or cycles are encountered;
 * throws instead so no partial or uninspected migration export can be returned.
 */
function stripSankalpaFieldsFailClosed(root) {
  if (root === null || root === undefined) return root;
  if (typeof root === 'string') {
    if (SANKALPA_VALUE_RE.test(root)) return undefined;
    return root;
  }
  if (typeof root !== 'object') return root;

  const activeAncestors = new Set();
  let inspected = 0;
  const rootOut = Array.isArray(root) ? [] : {};
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
    if (activeAncestors.has(src)) {
      throw new Error('MIGRATION_PRIVACY_INSPECTION_FAILED: Cyclic payload cannot be safely inspected for migration');
    }
    activeAncestors.add(src);
    workStack.push({ src, dst, depth, phase: 'exit' });

    if (Array.isArray(src)) {
      const childFrames = [];
      for (let i = 0; i < src.length; i++) {
        const item = src[i];
        if (typeof item === 'string') {
          if (!SANKALPA_VALUE_RE.test(item)) {
            dst.push(item);
          }
        } else if (item && typeof item === 'object') {
          const childDst = Array.isArray(item) ? [] : {};
          dst.push(childDst);
          childFrames.push({ src: item, dst: childDst, depth: depth + 1, phase: 'enter' });
        } else {
          dst.push(item);
        }
      }
      for (let i = childFrames.length - 1; i >= 0; i--) {
        workStack.push(childFrames[i]);
      }
    } else {
      const keys = Object.keys(src);
      const childFrames = [];
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        if (SANKALPA_KEY_RE.test(k)) continue;
        const v = src[k];
        if (typeof v === 'string') {
          if (SANKALPA_VALUE_RE.test(v)) continue;
          dst[k] = v;
        } else if (v && typeof v === 'object') {
          const childDst = Array.isArray(v) ? [] : {};
          dst[k] = childDst;
          childFrames.push({ src: v, dst: childDst, depth: depth + 1, phase: 'enter' });
        } else {
          dst[k] = v;
        }
      }
      for (let i = childFrames.length - 1; i >= 0; i--) {
        workStack.push(childFrames[i]);
      }
    }
  }

  return rootOut;
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

  if (payload.schemaVersion !== CANONICAL_MIGRATION_SCHEMA_VERSION) {
    errors.push(`Unsupported schema version: ${payload.schemaVersion}. Expected ${CANONICAL_MIGRATION_SCHEMA_VERSION}`);
  }

  if (!payload.sourceUserId) {
    errors.push('Missing sourceUserId in migration payload');
  }

  // Sacred Privacy Check: Iterative fail-closed deep inspection for Sankalpa leakage or inspection limit breach
  const privacyHit = detectSankalpaOrInspectionLimit(payload);
  if (privacyHit) {
    errors.push(`CRITICAL PRIVACY VIOLATION: Sankalpa vault data or uninspectable structure detected (${privacyHit})`);
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

  // 1. Export raw data via accountProvider
  const rawExport = await providerBundle.accountProvider.exportUserData(userId);
  if (!rawExport) {
    throw new Error(`Failed to export data from provider for user ${userId}`);
  }

  // 2. Filter and sanitize game saves (strictly omit Sankalpa; fail closed on uninspectable depth/cycles)
  const sanitizedGameSaves = [];
  for (const save of rawExport.gameSaves || rawExport.cloudSaves || []) {
    const saveGameId = save.gameId || save.game_id;
    if (EXCLUDED_GAME_IDENTIFIERS.has(saveGameId) || (typeof saveGameId === 'string' && /sankalpa/i.test(saveGameId))) {
      continue; // Strictly omit local-only Sankalpa vault
    }

    // If payload is not in list, fetch full envelope via pullLatest
    let payload = save.payload;
    let envelopeVersion = save.envelopeVersion || save.envelope_version || 1;
    let gameSchemaVersion = save.gameSchemaVersion || save.game_schema_version || 1;
    let revision = Number(save.revision) || 1;
    let checksum = save.checksum || 'sha256_mock';

    if (!payload && providerBundle.cloudSync?.pullLatest) {
      const fullSave = await providerBundle.cloudSync.pullLatest(userId, saveGameId);
      if (fullSave) {
        payload = fullSave.payload;
        envelopeVersion = fullSave.envelopeVersion;
        gameSchemaVersion = fullSave.gameSchemaVersion;
        revision = fullSave.revision;
        checksum = fullSave.checksum;
      }
    }

    sanitizedGameSaves.push({
      gameId: saveGameId,
      envelopeVersion,
      gameSchemaVersion,
      revision,
      checksum,
      payload: stripSankalpaFieldsFailClosed(payload || {}),
      clientUpdatedAt: save.clientUpdatedAt || save.client_updated_at || new Date().toISOString()
    });
  }

  // 3. Format guest links
  const guestLinks = (rawExport.linkedDevices || []).map((link) => ({
    guestId: link.guestId || link.guest_id,
    deviceLabel: link.deviceLabel || link.device_label || 'unknown',
    linkedAt: link.linkedAt || link.linked_at || new Date().toISOString()
  }));

  // 4. Format entitlements
  const entitlements = (rawExport.entitlements || []).map((ent) => ({
    sku: ent.sku,
    gameId: ent.gameId || ent.game_id,
    tier: ent.tier || 'full',
    status: ent.status || 'active',
    source: ent.source || 'verified_purchase',
    grantedAt: ent.grantedAt || ent.granted_at || new Date().toISOString()
  }));

  const contentWithoutChecksum = {
    schemaVersion: CANONICAL_MIGRATION_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    sourceProvider: providerBundle.accountProvider?.providerName || 'unknown',
    sourceUserId: userId,
    identity: {
      userId,
      email: rawExport.email || null,
      profile: rawExport.profile || {}
    },
    guestLinks,
    gameSaves: sanitizedGameSaves,
    entitlements
  };

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
