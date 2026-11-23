/**
 * AuroMind Shared Platform SDK — Supabase Avatar & Optional Artwork Storage Provider
 *
 * Enforces strict bucket isolation, owner-folder object keys (`${userId}/...`),
 * MIME/magic-byte validation, orphan cleanup queueing, and local-first artwork guarantees:
 *   - Bucket 'avatars': private, max 512 KiB, PNG/JPEG/WebP only (NO SVG).
 *   - Bucket 'user-artwork': private, max 5 MiB, strictly opt-in (`explicitCloudBackupOptIn === true`).
 *     Artwork remains local-first and NEVER silently uploads or synchronizes.
 */

export const AVATARS_BUCKET = 'avatars';
export const ARTWORK_BUCKET = 'user-artwork';
export const MAX_AVATAR_STORAGE_BYTES = 512 * 1024; // 512 KiB
export const MAX_ARTWORK_STORAGE_BYTES = 5 * 1024 * 1024; // 5 MiB

const ALLOWED_AVATAR_MIME_TO_EXT = Object.freeze({
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp'
});

const ALLOWED_ARTWORK_MIME_TO_EXT = Object.freeze({
  'image/png': 'png',
  'image/webp': 'webp',
  'application/json': 'json'
});

const SANKALPA_FORBIDDEN_RE = /(?:sankalpa|auromasti-sankalpa-backup|auromind_sankalpa_vault)/i;

function detectImageMagicMime(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 12) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  // WebP: RIFF....WEBP
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

function isSafePathSegment(seg) {
  return typeof seg === 'string' && /^[a-zA-Z0-9._-]{1,128}$/.test(seg) && seg !== '.' && seg !== '..';
}

export function validateOwnedStoragePath(ownerUserId, objectPath) {
  if (typeof ownerUserId !== 'string' || !ownerUserId.trim()) {
    return { valid: false, errorCode: 'UNAUTHENTICATED' };
  }
  if (typeof objectPath !== 'string') {
    return { valid: false, errorCode: 'INVALID_OBJECT_PATH' };
  }
  const trimmed = objectPath.trim();
  if (!trimmed || trimmed.startsWith('/') || trimmed.includes('\\') || /[\u0000-\u001f\u007f]/.test(trimmed)) {
    return { valid: false, errorCode: 'INVALID_OBJECT_PATH' };
  }
  const segments = trimmed.split('/');
  if (segments.length < 2 || segments.some((s) => !s || s === '.' || s === '..')) {
    return { valid: false, errorCode: 'INVALID_OBJECT_PATH' };
  }
  if (SANKALPA_FORBIDDEN_RE.test(trimmed)) {
    return { valid: false, errorCode: 'PRIVACY_BOUNDARY_VIOLATION' };
  }
  if (segments[0] !== ownerUserId.trim()) {
    return { valid: false, errorCode: 'CROSS_USER_STORAGE_FORBIDDEN' };
  }
  return { valid: true, normalizedPath: segments.join('/') };
}

function generateObjectNonce() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    }
  } catch {}
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function createSupabaseStorageProvider(client) {
  function isConfigured() {
    return Boolean(client && client.isConfigured() && client.storage && typeof client.storage.from === 'function');
  }

  function getAuthenticatedUserId() {
    const user = client?.auth?.getUser?.();
    return user && typeof user.id === 'string' && user.id.trim() ? user.id.trim() : null;
  }

  async function uploadAvatar({ bytes, mimeType, previousObjectPath = null, deletionQueue = null } = {}) {
    if (!isConfigured()) {
      return Object.freeze({ ok: false, errorCode: 'SUPABASE_NOT_CONFIGURED' });
    }
    const userId = getAuthenticatedUserId();
    if (!userId) {
      return Object.freeze({ ok: false, errorCode: 'UNAUTHENTICATED' });
    }
    const dataBytes = bytes instanceof Uint8Array ? bytes : (bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : null);
    if (!dataBytes || dataBytes.byteLength === 0) {
      return Object.freeze({ ok: false, errorCode: 'AVATAR_EMPTY' });
    }
    if (dataBytes.byteLength > MAX_AVATAR_STORAGE_BYTES) {
      return Object.freeze({ ok: false, errorCode: 'AVATAR_FILE_TOO_LARGE' });
    }
    const normalizedMime = typeof mimeType === 'string' ? mimeType.trim().toLowerCase() : '';
    const ext = ALLOWED_AVATAR_MIME_TO_EXT[normalizedMime];
    if (!ext) {
      return Object.freeze({ ok: false, errorCode: 'AVATAR_INVALID_MIME_TYPE' });
    }
    const detectedMime = detectImageMagicMime(dataBytes);
    if (!detectedMime || detectedMime !== normalizedMime) {
      return Object.freeze({ ok: false, errorCode: 'AVATAR_MALFORMED_IMAGE' });
    }

    const objectPath = `${userId}/avatar_${generateObjectNonce()}.${ext}`;
    const { data, error } = await client.storage.from(AVATARS_BUCKET).upload(objectPath, dataBytes, {
      contentType: normalizedMime,
      upsert: false
    });
    if (error) {
      return Object.freeze({ ok: false, errorCode: 'AVATAR_UPLOAD_FAILED', message: error.message });
    }

    // Clean up replaced previous avatar object; queue orphan cleanup if removal fails transiently
    let previousCleanup = null;
    if (previousObjectPath && previousObjectPath !== objectPath) {
      const prevCheck = validateOwnedStoragePath(userId, previousObjectPath);
      if (prevCheck.valid) {
        const rm = await client.storage.from(AVATARS_BUCKET).remove([prevCheck.normalizedPath]);
        if (rm.error) {
          if (deletionQueue && typeof deletionQueue.enqueue === 'function') {
            deletionQueue.enqueue({
              bucketId: AVATARS_BUCKET,
              objectPath: prevCheck.normalizedPath,
              artworkId: `avatar_${userId}`,
              ownerUserId: userId
            });
            previousCleanup = 'queued_for_retry';
          } else {
            previousCleanup = 'cleanup_failed';
          }
        } else {
          previousCleanup = 'deleted';
        }
      } else {
        previousCleanup = 'skipped_unowned';
      }
    }

    return Object.freeze({
      ok: true,
      bucketId: AVATARS_BUCKET,
      objectPath,
      mimeType: normalizedMime,
      sizeBytes: dataBytes.byteLength,
      previousCleanup,
      raw: data
    });
  }

  async function readAvatar(objectPath) {
    if (!isConfigured()) {
      return Object.freeze({ ok: false, errorCode: 'SUPABASE_NOT_CONFIGURED' });
    }
    const userId = getAuthenticatedUserId();
    const check = validateOwnedStoragePath(userId, objectPath);
    if (!check.valid) {
      return Object.freeze({ ok: false, errorCode: check.errorCode });
    }
    const { data, error } = await client.storage.from(AVATARS_BUCKET).download(check.normalizedPath);
    if (error) {
      return Object.freeze({ ok: false, errorCode: 'AVATAR_READ_FAILED', message: error.message });
    }
    return Object.freeze({ ok: true, objectPath: check.normalizedPath, bytes: data });
  }

  async function deleteAvatar(objectPath, { deletionQueue = null } = {}) {
    if (!isConfigured()) {
      return Object.freeze({ ok: false, errorCode: 'SUPABASE_NOT_CONFIGURED' });
    }
    const userId = getAuthenticatedUserId();
    const check = validateOwnedStoragePath(userId, objectPath);
    if (!check.valid) {
      return Object.freeze({ ok: false, errorCode: check.errorCode });
    }
    const { error } = await client.storage.from(AVATARS_BUCKET).remove([check.normalizedPath]);
    if (error) {
      if (deletionQueue && typeof deletionQueue.enqueue === 'function') {
        const job = deletionQueue.enqueue({
          bucketId: AVATARS_BUCKET,
          objectPath: check.normalizedPath,
          artworkId: `avatar_${userId}`,
          ownerUserId: userId
        });
        return Object.freeze({ ok: false, queuedForRetry: true, jobId: job.id, errorCode: 'AVATAR_DELETE_QUEUED', message: error.message });
      }
      return Object.freeze({ ok: false, errorCode: 'AVATAR_DELETE_FAILED', message: error.message });
    }
    return Object.freeze({ ok: true, deletedPath: check.normalizedPath });
  }

  async function backupArtwork({
    artworkId,
    snapshotId = 'latest',
    bytes,
    mimeType = 'image/png',
    explicitCloudBackupOptIn = false
  } = {}) {
    // Sacred local-first invariant: artwork NEVER silently uploads or synchronizes unless explicitly opted in
    if (explicitCloudBackupOptIn !== true) {
      return Object.freeze({
        ok: false,
        errorCode: 'CLOUD_ARTWORK_BACKUP_OPT_IN_REQUIRED',
        message: 'Artwork remains local-first unless optional cloud artwork backup is explicitly enabled.'
      });
    }
    if (!isConfigured()) {
      return Object.freeze({ ok: false, errorCode: 'SUPABASE_NOT_CONFIGURED' });
    }
    const userId = getAuthenticatedUserId();
    if (!userId) {
      return Object.freeze({ ok: false, errorCode: 'UNAUTHENTICATED' });
    }
    if (!isSafePathSegment(artworkId) || !isSafePathSegment(snapshotId)) {
      return Object.freeze({ ok: false, errorCode: 'INVALID_ARTWORK_IDENTIFIER' });
    }
    if (SANKALPA_FORBIDDEN_RE.test(artworkId) || SANKALPA_FORBIDDEN_RE.test(snapshotId)) {
      return Object.freeze({ ok: false, errorCode: 'PRIVACY_BOUNDARY_VIOLATION' });
    }

    const normalizedMime = typeof mimeType === 'string' ? mimeType.trim().toLowerCase() : '';
    const ext = ALLOWED_ARTWORK_MIME_TO_EXT[normalizedMime];
    if (!ext) {
      return Object.freeze({ ok: false, errorCode: 'ARTWORK_INVALID_MIME_TYPE' });
    }

    let dataBytes;
    if (bytes instanceof Uint8Array) {
      dataBytes = bytes;
    } else if (bytes instanceof ArrayBuffer) {
      dataBytes = new Uint8Array(bytes);
    } else if (typeof bytes === 'string' && normalizedMime === 'application/json') {
      dataBytes = new TextEncoder().encode(bytes);
    } else {
      return Object.freeze({ ok: false, errorCode: 'ARTWORK_EMPTY' });
    }

    if (dataBytes.byteLength === 0) {
      return Object.freeze({ ok: false, errorCode: 'ARTWORK_EMPTY' });
    }
    if (dataBytes.byteLength > MAX_ARTWORK_STORAGE_BYTES) {
      return Object.freeze({ ok: false, errorCode: 'ARTWORK_FILE_TOO_LARGE' });
    }

    if (normalizedMime === 'application/json') {
      const text = new TextDecoder('utf-8').decode(dataBytes);
      if (SANKALPA_FORBIDDEN_RE.test(text)) {
        return Object.freeze({ ok: false, errorCode: 'PRIVACY_BOUNDARY_VIOLATION' });
      }
    } else {
      const detectedMime = detectImageMagicMime(dataBytes);
      if (!detectedMime || detectedMime !== normalizedMime) {
        return Object.freeze({ ok: false, errorCode: 'ARTWORK_MALFORMED_IMAGE' });
      }
    }

    const objectPath = `${userId}/${artworkId}/${snapshotId}.${ext}`;
    const { data, error } = await client.storage.from(ARTWORK_BUCKET).upload(objectPath, dataBytes, {
      contentType: normalizedMime,
      upsert: true
    });
    if (error) {
      return Object.freeze({ ok: false, errorCode: 'ARTWORK_UPLOAD_FAILED', message: error.message });
    }

    return Object.freeze({
      ok: true,
      bucketId: ARTWORK_BUCKET,
      objectPath,
      mimeType: normalizedMime,
      sizeBytes: dataBytes.byteLength,
      raw: data
    });
  }

  async function readArtworkBackup(objectPath) {
    if (!isConfigured()) {
      return Object.freeze({ ok: false, errorCode: 'SUPABASE_NOT_CONFIGURED' });
    }
    const userId = getAuthenticatedUserId();
    const check = validateOwnedStoragePath(userId, objectPath);
    if (!check.valid) {
      return Object.freeze({ ok: false, errorCode: check.errorCode });
    }
    const { data, error } = await client.storage.from(ARTWORK_BUCKET).download(check.normalizedPath);
    if (error) {
      return Object.freeze({ ok: false, errorCode: 'ARTWORK_READ_FAILED', message: error.message });
    }
    return Object.freeze({ ok: true, objectPath: check.normalizedPath, bytes: data });
  }

  async function deleteArtworkBackup({ artworkId, objectPath, snapshotId = null, deletionQueue = null } = {}) {
    if (!isConfigured()) {
      return Object.freeze({ ok: false, errorCode: 'SUPABASE_NOT_CONFIGURED' });
    }
    const userId = getAuthenticatedUserId();
    const check = validateOwnedStoragePath(userId, objectPath);
    if (!check.valid) {
      return Object.freeze({ ok: false, errorCode: check.errorCode });
    }
    const { error } = await client.storage.from(ARTWORK_BUCKET).remove([check.normalizedPath]);
    if (error) {
      if (deletionQueue && typeof deletionQueue.enqueue === 'function') {
        const job = deletionQueue.enqueue({
          bucketId: ARTWORK_BUCKET,
          objectPath: check.normalizedPath,
          artworkId: artworkId || 'unknown',
          snapshotId,
          ownerUserId: userId
        });
        return Object.freeze({
          ok: false,
          queuedForRetry: true,
          jobId: job.id,
          errorCode: 'ARTWORK_DELETE_QUEUED',
          message: error.message
        });
      }
      return Object.freeze({ ok: false, errorCode: 'ARTWORK_DELETE_FAILED', message: error.message });
    }
    return Object.freeze({ ok: true, deletedPath: check.normalizedPath });
  }

  return Object.freeze({
    providerName: 'supabase-storage',
    isConfigured,
    uploadAvatar,
    readAvatar,
    deleteAvatar,
    backupArtwork,
    readArtworkBackup,
    deleteArtworkBackup
  });
}
