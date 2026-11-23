/**
 * AuroMind Platform SDK — Sankalpa Vault Cryptographic Lifecycle
 *
 * Implements the definitive client-side cryptographic lifecycle for the sacred
 * Sankalpa Contemplation Vault (Data Class 6):
 *   1. Non-extractable operational AES-256-GCM key generation & IndexedDB storage
 *   2. Local in-memory encryption & decryption with strict IV uniqueness & optional AAD binding
 *   3. Encrypted backup export using a separate PBKDF2 passphrase-derived key
 *   4. Zero-knowledge backup import, downgrade protection & non-destructive merge recovery
 *   5. Account/session-scoped vault manager with lock/logout/switch epoch invalidation
 *   6. Strict local-only physical air-gap enforcement (zero cloud sync, zero Buffer dependency)
 *
 * Standards:
 *   - Operational: Web Crypto AES-GCM (256-bit, extractable=false)
 *   - Backup KDF: PBKDF2-HMAC-SHA256, >= 210,000 iterations (OWASP guidance), 16-byte salt
 *   - Backup Cipher: AES-256-GCM, 12-byte IV, 128-bit authentication tag
 */

export const SANKALPA_BACKUP_SCHEMA_VERSION = '1.0';
export const SANKALPA_BACKUP_FORMAT = 'auromasti-sankalpa-backup';
export const SANKALPA_BACKUP_KDF = 'PBKDF2-HMAC-SHA256';
export const SANKALPA_PBKDF2_ITERATIONS = 210000;
export const SANKALPA_SALT_BYTES = 16;
export const SANKALPA_IV_BYTES = 12;
export const SANKALPA_GCM_TAG_BYTES = 16;
export const SANKALPA_VAULT_DB_NAME = 'auromind_sankalpa_vault';
export const SANKALPA_VAULT_DB_VERSION = 1;
export const SANKALPA_VAULT_STORE_NAME = 'vault_entries';
export const SANKALPA_KEY_STORE_NAME = 'vault_keys';
export const SANKALPA_VAULT_CHANNEL_NAME = 'auromind.sankalpa.vault.coord';

const HEX_RE = /^[0-9a-f]+$/i;
const MAX_IV_GENERATION_ATTEMPTS = 8;

// Tracks issued 12-byte IV hex values per operational CryptoKey instance to prevent IV reuse
const issuedIvsByKey = new WeakMap();

function getWebCrypto(cryptoOverride = null) {
  const cryptoObj = cryptoOverride || globalThis.crypto;
  if (!cryptoObj || !cryptoObj.subtle || typeof cryptoObj.getRandomValues !== 'function') {
    throw new Error('WEB_CRYPTO_UNAVAILABLE: Web Crypto API is unavailable');
  }
  return cryptoObj;
}

/**
 * Browser + Node universal Uint8Array/ArrayBuffer -> lowercase hex string encoder.
 */
export function bytesToHex(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

/**
 * Browser + Node universal strict hex string -> Uint8Array decoder.
 */
export function hexToBytes(hex, { exactBytes = null, minBytes = 0, fieldName = 'hex' } = {}) {
  if (typeof hex !== 'string' || hex.length === 0 || hex.length % 2 !== 0 || !HEX_RE.test(hex)) {
    throw new Error(`INVALID_HEX_${fieldName.toUpperCase()}: Malformed hexadecimal encoding`);
  }
  const byteLen = hex.length / 2;
  if (exactBytes !== null && byteLen !== exactBytes) {
    throw new Error(`INVALID_LENGTH_${fieldName.toUpperCase()}: Expected ${exactBytes} bytes, got ${byteLen}`);
  }
  if (byteLen < minBytes) {
    throw new Error(`INVALID_LENGTH_${fieldName.toUpperCase()}: Expected at least ${minBytes} bytes, got ${byteLen}`);
  }
  const bytes = new Uint8Array(byteLen);
  for (let i = 0; i < byteLen; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function assertNonExtractableAesGcmKey(key, label = 'operationalKey') {
  if (!key || typeof key !== 'object') {
    throw new Error(`INVALID_CRYPTO_KEY: ${label} is required`);
  }
  if (key.extractable !== false) {
    throw new Error(`EXTRACTABLE_KEY_FORBIDDEN: ${label} must be non-extractable`);
  }
  const algName = key.algorithm && key.algorithm.name;
  const algLength = key.algorithm && key.algorithm.length;
  if (algName !== 'AES-GCM' || (algLength !== undefined && algLength !== 256)) {
    throw new Error(`INVALID_KEY_ALGORITHM: ${label} must be 256-bit AES-GCM`);
  }
}

function isAllZeroBytes(bytes) {
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] !== 0) return false;
  }
  return true;
}

function generateUniqueGcmIv(cryptoObj, keyRef = null) {
  let seenSet = null;
  if (keyRef && typeof keyRef === 'object') {
    seenSet = issuedIvsByKey.get(keyRef);
    if (!seenSet) {
      seenSet = new Set();
      issuedIvsByKey.set(keyRef, seenSet);
    }
  }

  for (let attempt = 0; attempt < MAX_IV_GENERATION_ATTEMPTS; attempt++) {
    const iv = cryptoObj.getRandomValues(new Uint8Array(SANKALPA_IV_BYTES));
    if (iv.length !== SANKALPA_IV_BYTES || isAllZeroBytes(iv)) {
      continue;
    }
    const ivHex = bytesToHex(iv);
    if (seenSet && seenSet.has(ivHex)) {
      continue;
    }
    if (seenSet) {
      // Cap in-memory set size safely while preventing immediate/concurrent reuse
      if (seenSet.size >= 100000) {
        seenSet.clear();
      }
      seenSet.add(ivHex);
    }
    return { iv, ivHex };
  }

  throw new Error('IV_GENERATION_FAILED: Unable to generate a unique 12-byte AES-GCM IV');
}

function encodeAad(aad) {
  if (aad === undefined || aad === null || aad === '') return null;
  if (aad instanceof Uint8Array) return aad;
  return new TextEncoder().encode(String(aad));
}

function normalizeScopeId(scopeId) {
  if (typeof scopeId !== 'string' || scopeId.trim().length === 0) {
    return 'guest';
  }
  return scopeId.trim().replace(/[^a-zA-Z0-9._:@-]/g, '_');
}

function isValidStoredRecordShape(rec) {
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return false;
  if (typeof rec.ivHex !== 'string' || rec.ivHex.length !== SANKALPA_IV_BYTES * 2 || !HEX_RE.test(rec.ivHex)) {
    return false;
  }
  if (
    typeof rec.ciphertextHex !== 'string' ||
    rec.ciphertextHex.length < SANKALPA_GCM_TAG_BYTES * 2 ||
    rec.ciphertextHex.length % 2 !== 0 ||
    !HEX_RE.test(rec.ciphertextHex)
  ) {
    return false;
  }
  return true;
}

/**
 * Generates an operational non-extractable Web Crypto AES-256-GCM key.
 */
export async function generateOperationalKey(cryptoOverride = null) {
  const cryptoObj = getWebCrypto(cryptoOverride);

  // Key is strictly non-extractable (cannot be exported to raw bytes)
  return await cryptoObj.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false, // extractable: false
    ['encrypt', 'decrypt']
  );
}

/**
 * Derives a non-extractable AES-256-GCM key for backup export/import from a passphrase using PBKDF2-HMAC-SHA256.
 */
export async function deriveBackupKey(
  passphrase,
  saltBuffer,
  iterations = SANKALPA_PBKDF2_ITERATIONS,
  cryptoOverride = null
) {
  const cryptoObj = getWebCrypto(cryptoOverride);
  if (typeof passphrase !== 'string' || passphrase.length === 0) {
    throw new Error('INVALID_PASSPHRASE: Passphrase must be a non-empty string');
  }
  const saltBytes = saltBuffer instanceof Uint8Array
    ? saltBuffer
    : (saltBuffer instanceof ArrayBuffer ? new Uint8Array(saltBuffer) : null);
  if (!saltBytes || saltBytes.byteLength < SANKALPA_SALT_BYTES) {
    throw new Error(`INVALID_SALT: Salt must be at least ${SANKALPA_SALT_BYTES} bytes`);
  }
  if (typeof iterations !== 'number' || !Number.isInteger(iterations) || iterations < SANKALPA_PBKDF2_ITERATIONS) {
    throw new Error(`INVALID_KDF_ITERATIONS: PBKDF2 iterations must be an integer >= ${SANKALPA_PBKDF2_ITERATIONS}`);
  }

  const encoder = new TextEncoder();
  const passphraseKey = await cryptoObj.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return await cryptoObj.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations,
      hash: 'SHA-256'
    },
    passphraseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts a plaintext record using the operational non-extractable AES-256-GCM key.
 * Enforces unique 12-byte random IVs per key and optional AAD context binding.
 */
export async function encryptVaultRecord(operationalKey, plaintextRecord, options = {}) {
  const cryptoObj = getWebCrypto(options.crypto);
  assertNonExtractableAesGcmKey(operationalKey, 'operationalKey');
  if (plaintextRecord === undefined) {
    throw new Error('INVALID_PLAINTEXT_RECORD: Record cannot be undefined');
  }

  const serialized = JSON.stringify(plaintextRecord);
  if (typeof serialized !== 'string') {
    throw new Error('INVALID_PLAINTEXT_RECORD: Record is not JSON-serializable');
  }

  const { iv, ivHex } = generateUniqueGcmIv(cryptoObj, operationalKey);
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(serialized);

  const aadBytes = encodeAad(options.aad);
  const gcmParams = aadBytes
    ? { name: 'AES-GCM', iv, additionalData: aadBytes, tagLength: 128 }
    : { name: 'AES-GCM', iv, tagLength: 128 };

  const ciphertext = await cryptoObj.subtle.encrypt(
    gcmParams,
    operationalKey,
    dataBuffer
  );

  return {
    ivHex,
    ciphertextHex: bytesToHex(ciphertext)
  };
}

/**
 * Decrypts a vault record using the operational non-extractable key.
 * Verifies IV/ciphertext format, AES-GCM authentication tag, and optional AAD binding.
 */
export async function decryptVaultRecord(operationalKey, encryptedRecord, options = {}) {
  const cryptoObj = getWebCrypto(options.crypto);
  assertNonExtractableAesGcmKey(operationalKey, 'operationalKey');

  if (!encryptedRecord || typeof encryptedRecord !== 'object') {
    throw new Error('DECRYPTION_FAILED: Encrypted record must be an object');
  }

  const iv = hexToBytes(encryptedRecord.ivHex, { exactBytes: SANKALPA_IV_BYTES, fieldName: 'iv' });
  const ciphertext = hexToBytes(encryptedRecord.ciphertextHex, {
    minBytes: SANKALPA_GCM_TAG_BYTES,
    fieldName: 'ciphertext'
  });

  const aadBytes = encodeAad(options.aad);
  const gcmParams = aadBytes
    ? { name: 'AES-GCM', iv, additionalData: aadBytes, tagLength: 128 }
    : { name: 'AES-GCM', iv, tagLength: 128 };

  let decryptedBuffer;
  try {
    decryptedBuffer = await cryptoObj.subtle.decrypt(
      gcmParams,
      operationalKey,
      ciphertext
    );
  } catch {
    throw new Error('DECRYPTION_FAILED: Authentication tag mismatch, wrong key, or tampered ciphertext');
  }

  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    return JSON.parse(decoder.decode(decryptedBuffer));
  } catch {
    throw new Error('DECRYPTION_FAILED: Decrypted vault payload is corrupted');
  }
}

/**
 * Exports vault entries as a password-encrypted backup envelope.
 * Operational key is NEVER exported; entries are decrypted in memory
 * and re-encrypted with a fresh passphrase-derived backup key.
 */
export async function exportEncryptedBackup({
  passphrase,
  vaultRecords,
  operationalKey,
  aadResolver = null,
  crypto: cryptoOverride = null
}) {
  if (!passphrase || typeof passphrase !== 'string' || passphrase.length < 8) {
    throw new Error('Passphrase must be at least 8 characters');
  }
  if (!Array.isArray(vaultRecords)) {
    throw new Error('INVALID_VAULT_RECORDS: vaultRecords must be an array');
  }
  assertNonExtractableAesGcmKey(operationalKey, 'operationalKey');

  const cryptoObj = getWebCrypto(cryptoOverride);

  // 1. Decrypt records in memory using operational key
  const decryptedEntries = [];
  for (const record of vaultRecords) {
    const aad = typeof aadResolver === 'function' ? aadResolver(record) : record?.aad;
    const entry = await decryptVaultRecord(operationalKey, record, { aad, crypto: cryptoObj });
    decryptedEntries.push(entry);
  }

  // 2. Generate random 16-byte salt and unique 12-byte IV for backup envelope
  const salt = cryptoObj.getRandomValues(new Uint8Array(SANKALPA_SALT_BYTES));
  if (isAllZeroBytes(salt)) {
    throw new Error('SALT_GENERATION_FAILED: Cryptographic RNG returned zero salt');
  }
  const { iv, ivHex } = generateUniqueGcmIv(cryptoObj);

  // 3. Derive backup encryption key (PBKDF2-HMAC-SHA256, 210,000 iterations)
  const backupKey = await deriveBackupKey(passphrase, salt, SANKALPA_PBKDF2_ITERATIONS, cryptoObj);

  // 4. Encrypt full backup payload (authenticated with schema format+version AAD? Keep compatibility with raw AES-GCM)
  const encoder = new TextEncoder();
  const payloadBytes = encoder.encode(JSON.stringify({
    entries: decryptedEntries,
    exportedAt: new Date().toISOString()
  }));

  const ciphertext = await cryptoObj.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    backupKey,
    payloadBytes
  );

  // 5. Build standardized versioned backup envelope
  return {
    format: SANKALPA_BACKUP_FORMAT,
    version: SANKALPA_BACKUP_SCHEMA_VERSION,
    kdf: SANKALPA_BACKUP_KDF,
    iterations: SANKALPA_PBKDF2_ITERATIONS,
    saltHex: bytesToHex(salt),
    ivHex,
    ciphertextHex: bytesToHex(ciphertext),
    entryCount: decryptedEntries.length
  };
}

/**
 * Imports and validates an encrypted backup envelope into a target operational key.
 * Enforces PBKDF2 iteration floor (anti-downgrade), strict salt/IV/tag lengths,
 * and re-encrypts each entry with a fresh unique 12-byte IV under targetOperationalKey.
 */
export async function importEncryptedBackup({
  passphrase,
  backupEnvelope,
  targetOperationalKey,
  aadForEntry = null,
  crypto: cryptoOverride = null
}) {
  if (!backupEnvelope || typeof backupEnvelope !== 'object' || backupEnvelope.format !== SANKALPA_BACKUP_FORMAT) {
    throw new Error('INVALID_BACKUP_FORMAT');
  }
  if (backupEnvelope.version !== SANKALPA_BACKUP_SCHEMA_VERSION) {
    throw new Error(`UNSUPPORTED_BACKUP_VERSION: ${backupEnvelope.version}`);
  }
  if (backupEnvelope.kdf !== undefined && backupEnvelope.kdf !== SANKALPA_BACKUP_KDF) {
    throw new Error(`UNSUPPORTED_BACKUP_KDF: ${backupEnvelope.kdf}`);
  }
  if (!backupEnvelope.saltHex || !backupEnvelope.ivHex || !backupEnvelope.ciphertextHex) {
    throw new Error('MALFORMED_BACKUP_ENVELOPE');
  }
  if (typeof passphrase !== 'string' || passphrase.length === 0) {
    throw new Error('DECRYPTION_FAILED: Passphrase is required');
  }

  const iterations = backupEnvelope.iterations;
  if (
    iterations !== undefined &&
    (typeof iterations !== 'number' || !Number.isInteger(iterations) || iterations < SANKALPA_PBKDF2_ITERATIONS)
  ) {
    throw new Error(`INSECURE_KDF_ITERATIONS: Backup requires >= ${SANKALPA_PBKDF2_ITERATIONS} PBKDF2 iterations`);
  }

  assertNonExtractableAesGcmKey(targetOperationalKey, 'targetOperationalKey');
  const cryptoObj = getWebCrypto(cryptoOverride);

  let salt;
  let iv;
  let ciphertext;
  try {
    salt = hexToBytes(backupEnvelope.saltHex, { exactBytes: SANKALPA_SALT_BYTES, fieldName: 'salt' });
    iv = hexToBytes(backupEnvelope.ivHex, { exactBytes: SANKALPA_IV_BYTES, fieldName: 'iv' });
    ciphertext = hexToBytes(backupEnvelope.ciphertextHex, { minBytes: SANKALPA_GCM_TAG_BYTES, fieldName: 'ciphertext' });
  } catch {
    throw new Error('MALFORMED_BACKUP_ENVELOPE');
  }

  // 1. Derive backup key using envelope's salt and validated iteration floor
  const backupKey = await deriveBackupKey(
    passphrase,
    salt,
    iterations ?? SANKALPA_PBKDF2_ITERATIONS,
    cryptoObj
  );

  // 2. Decrypt with AES-GCM (validates 128-bit auth tag; throws on wrong passphrase or tampered ciphertext)
  let decryptedBytes;
  try {
    decryptedBytes = await cryptoObj.subtle.decrypt(
      { name: 'AES-GCM', iv, tagLength: 128 },
      backupKey,
      ciphertext
    );
  } catch {
    throw new Error('DECRYPTION_FAILED: Invalid passphrase or tampered backup file');
  }

  let parsed;
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    parsed = JSON.parse(decoder.decode(decryptedBytes));
  } catch {
    throw new Error('MALFORMED_PAYLOAD_STRUCTURE');
  }

  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.entries)) {
    throw new Error('MALFORMED_PAYLOAD_STRUCTURE');
  }
  if (
    typeof backupEnvelope.entryCount === 'number' &&
    backupEnvelope.entryCount !== parsed.entries.length
  ) {
    throw new Error('MALFORMED_PAYLOAD_STRUCTURE: entryCount mismatch');
  }

  // 3. Re-encrypt all imported entries under the target device's operational key (fresh unique IVs)
  const reEncryptedRecords = [];
  for (let i = 0; i < parsed.entries.length; i++) {
    const entry = parsed.entries[i];
    const aad = typeof aadForEntry === 'function' ? aadForEntry(entry, i) : null;
    const record = await encryptVaultRecord(targetOperationalKey, entry, { aad, crypto: cryptoObj });
    reEncryptedRecords.push(record);
  }

  return {
    importedCount: reEncryptedRecords.length,
    reEncryptedRecords,
    entries: parsed.entries
  };
}

/**
 * Local-only Sankalpa Vault Manager backed by IndexedDB non-extractable CryptoKey handles
 * and AES-256-GCM encrypted entries.
 *
 * Guarantees:
 * - Strictly local-only: zero cloud sync, zero plaintext persistence, zero fallback to weak storage.
 * - Per-account/scope isolation (`scopeId`): distinct non-extractable key handle and AAD per scope.
 * - Lock / logout / account-switch immediately increments `vaultEpoch` and rejects stale async ops.
 * - Key loss with existing encrypted entries enters `unrecoverable_missing_key` locked state without
 *   silently deleting or overwriting existing encrypted entries.
 * - Concurrent operations serialize cleanly; backup import merges non-destructively by default.
 * - Multi-tab coordination emits ONLY non-sensitive epoch/state signals (zero secrets on BroadcastChannel).
 */
export function createSankalpaVaultManager({
  scopeId = 'guest',
  indexedDB: idbOverride = undefined,
  crypto: cryptoOverride = null,
  BroadcastChannel: BroadcastChannelOverride = undefined,
  dbName = SANKALPA_VAULT_DB_NAME,
  channelName = SANKALPA_VAULT_CHANNEL_NAME,
  onStateChange = null
} = {}) {
  let activeScopeId = normalizeScopeId(scopeId);
  let vaultEpoch = 1;
  let unlocked = false;
  let operationalKey = null;
  let state = 'locked'; // 'locked' | 'unlocked' | 'unrecoverable_missing_key' | 'storage_unavailable'
  let lastError = null;
  let disposed = false;
  let opChain = Promise.resolve();

  const resolveIdb = () => {
    if (idbOverride !== undefined) return idbOverride;
    return typeof globalThis.indexedDB !== 'undefined' ? globalThis.indexedDB : null;
  };

  const resolveBroadcastChannel = () => {
    if (BroadcastChannelOverride !== undefined) return BroadcastChannelOverride;
    return typeof globalThis.BroadcastChannel !== 'undefined' ? globalThis.BroadcastChannel : null;
  };

  let coordChannel = null;
  try {
    const BC = resolveBroadcastChannel();
    if (typeof BC === 'function') {
      coordChannel = new BC(channelName);
      coordChannel.onmessage = (evt) => {
        const msg = evt && evt.data;
        if (!msg || typeof msg !== 'object' || msg.type !== 'SANKALPA_VAULT_SIGNAL') return;
        // Strictly non-sensitive cross-tab coordination: if another tab locks/switches same scope, lock locally
        if (msg.signal === 'locked' && msg.scopeId === activeScopeId && unlocked) {
          invalidateSession('locked', 'LOCKED_BY_PEER_TAB');
        }
      };
    }
  } catch {
    coordChannel = null;
  }

  function emitState(reason) {
    if (typeof onStateChange === 'function') {
      try {
        onStateChange({
          scopeId: activeScopeId,
          state,
          unlocked,
          epoch: vaultEpoch,
          reason
        });
      } catch {}
    }
  }

  function postCoordSignal(signal) {
    if (!coordChannel) return;
    try {
      // Strictly non-sensitive coordination payload only: NEVER includes keys, IVs, salts, ciphertext, or plaintext
      coordChannel.postMessage({
        type: 'SANKALPA_VAULT_SIGNAL',
        signal,
        scopeId: activeScopeId,
        epoch: vaultEpoch,
        timestamp: Date.now()
      });
    } catch {}
  }

  function invalidateSession(nextState = 'locked', reason = 'locked') {
    vaultEpoch += 1;
    unlocked = false;
    operationalKey = null;
    state = nextState;
    emitState(reason);
  }

  function assertEpochActive(capturedEpoch, capturedScope) {
    if (disposed || vaultEpoch !== capturedEpoch || activeScopeId !== capturedScope || !unlocked || !operationalKey) {
      throw new Error('VAULT_STALE_OPERATION: Vault was locked, switched, or disposed during operation');
    }
  }

  function openVaultDb() {
    const idb = resolveIdb();
    if (!idb || typeof idb.open !== 'function') {
      state = 'storage_unavailable';
      lastError = 'INDEXEDDB_UNAVAILABLE';
      return Promise.reject(new Error('INDEXEDDB_UNAVAILABLE: Sankalpa vault requires IndexedDB for non-extractable keys'));
    }

    return new Promise((resolve, reject) => {
      try {
        const req = idb.open(dbName, SANKALPA_VAULT_DB_VERSION);
        req.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(SANKALPA_KEY_STORE_NAME)) {
            db.createObjectStore(SANKALPA_KEY_STORE_NAME, { keyPath: 'keyId' });
          }
          if (!db.objectStoreNames.contains(SANKALPA_VAULT_STORE_NAME)) {
            db.createObjectStore(SANKALPA_VAULT_STORE_NAME, { keyPath: 'storageId' });
          }
        };
        req.onsuccess = (event) => resolve(event.target.result);
        req.onerror = () => reject(req.error || new Error('INDEXEDDB_OPEN_FAILED'));
        req.onblocked = () => reject(new Error('INDEXEDDB_BLOCKED'));
      } catch (err) {
        reject(err);
      }
    });
  }

  async function withDb(fn) {
    let db = null;
    try {
      db = await openVaultDb();
      return await fn(db);
    } catch (err) {
      lastError = err && err.message ? err.message : String(err);
      throw err;
    } finally {
      if (db && typeof db.close === 'function') {
        try { db.close(); } catch {}
      }
    }
  }

  function idbGet(db, storeName, key) {
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).get(key);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => reject(req.error || new Error('IDB_GET_FAILED'));
        tx.onerror = () => reject(tx.error || new Error('IDB_TX_GET_FAILED'));
      } catch (err) {
        reject(err);
      }
    });
  }

  function idbGetAll(db, storeName) {
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).getAll();
        req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
        req.onerror = () => reject(req.error || new Error('IDB_GET_ALL_FAILED'));
        tx.onerror = () => reject(tx.error || new Error('IDB_TX_GET_ALL_FAILED'));
      } catch (err) {
        reject(err);
      }
    });
  }

  function idbPutBatchAtomic(db, storeName, records) {
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        for (const rec of records) {
          store.put(rec);
        }
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error || new Error('IDB_PUT_FAILED'));
        tx.onabort = () => reject(tx.error || new Error('IDB_PUT_ABORTED'));
      } catch (err) {
        reject(err);
      }
    });
  }

  function idbDeleteOne(db, storeName, key) {
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).delete(key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error || new Error('IDB_DELETE_FAILED'));
        tx.onabort = () => reject(tx.error || new Error('IDB_DELETE_ABORTED'));
      } catch (err) {
        reject(err);
      }
    });
  }

  function serializeOp(task) {
    const next = opChain.then(task, task);
    opChain = next.catch(() => {});
    return next;
  }

  function keyIdForScope(scope) {
    return `sankalpa_key::${scope}`;
  }

  function storageIdFor(scope, entryId) {
    return `${scope}::${entryId}`;
  }

  function aadFor(scope, entryId) {
    return `auromind:sankalpa:v1:${scope}:${entryId}`;
  }

  return {
    getStatus() {
      return Object.freeze({
        scopeId: activeScopeId,
        state,
        unlocked,
        epoch: vaultEpoch,
        hasKeyHandle: Boolean(operationalKey),
        lastError
      });
    },

    async unlock(nextScopeId = activeScopeId) {
      if (disposed) throw new Error('VAULT_DISPOSED');
      const targetScope = normalizeScopeId(nextScopeId);
      if (targetScope !== activeScopeId) {
        activeScopeId = targetScope;
        invalidateSession('locked', 'scope_changed');
      }
      const startEpoch = vaultEpoch;
      const startScope = activeScopeId;

      return serializeOp(async () => {
        if (disposed || vaultEpoch !== startEpoch || activeScopeId !== startScope) {
          throw new Error('VAULT_STALE_OPERATION: Scope or lock changed during unlock');
        }
        const cryptoObj = getWebCrypto(cryptoOverride);

        const result = await withDb(async (db) => {
          const keyId = keyIdForScope(startScope);
          const existingKeyRec = await idbGet(db, SANKALPA_KEY_STORE_NAME, keyId);
          const allEntries = await idbGetAll(db, SANKALPA_VAULT_STORE_NAME);
          const scopeEntries = allEntries.filter((e) => e && e.scopeId === startScope);

          if (existingKeyRec) {
            // Validate stored key handle is an actual non-extractable AES-256-GCM CryptoKey
            if (
              !existingKeyRec.key ||
              typeof existingKeyRec.key !== 'object' ||
              existingKeyRec.key.extractable !== false ||
              existingKeyRec.key.algorithm?.name !== 'AES-GCM'
            ) {
              throw new Error('CORRUPT_KEY_METADATA: Stored Sankalpa key handle is invalid');
            }
            return { key: existingKeyRec.key, created: false, existingEntryCount: scopeEntries.length };
          }

          // Critical safety invariant: NEVER silently generate a replacement key and orphan/destroy
          // existing encrypted vault entries if the operational key handle was lost!
          if (scopeEntries.length > 0) {
            state = 'unrecoverable_missing_key';
            unlocked = false;
            operationalKey = null;
            lastError = 'KEY_MISSING_FOR_EXISTING_VAULT';
            emitState('unrecoverable_missing_key');
            throw new Error(
              'KEY_MISSING_FOR_EXISTING_VAULT: Operational key missing for existing encrypted entries; refusing destructive reset'
            );
          }

          // Fresh vault: generate non-extractable CryptoKey and persist atomically to IndexedDB
          const newKey = await generateOperationalKey(cryptoObj);
          if (disposed || vaultEpoch !== startEpoch || activeScopeId !== startScope) {
            throw new Error('VAULT_STALE_OPERATION: Scope or lock changed before key persistence');
          }
          await idbPutBatchAtomic(db, SANKALPA_KEY_STORE_NAME, [{
            keyId,
            scopeId: startScope,
            algorithm: 'AES-GCM',
            keyLength: 256,
            extractable: false,
            createdAt: new Date().toISOString(),
            key: newKey
          }]);
          return { key: newKey, created: true, existingEntryCount: 0 };
        });

        if (disposed || vaultEpoch !== startEpoch || activeScopeId !== startScope) {
          throw new Error('VAULT_STALE_OPERATION: Scope or lock changed during unlock');
        }

        operationalKey = result.key;
        unlocked = true;
        state = 'unlocked';
        lastError = null;
        emitState('unlocked');
        return Object.freeze({
          ok: true,
          scopeId: startScope,
          created: result.created,
          existingEntryCount: result.existingEntryCount
        });
      });
    },

    lock() {
      invalidateSession('locked', 'manual_lock');
      postCoordSignal('locked');
    },

    onLogout() {
      invalidateSession('locked', 'logout');
      postCoordSignal('locked');
    },

    switchAccount(nextScopeId) {
      activeScopeId = normalizeScopeId(nextScopeId);
      invalidateSession('locked', 'account_switch');
      postCoordSignal('locked');
      return activeScopeId;
    },

    async putEntry(entryId, plaintextRecord) {
      if (typeof entryId !== 'string' || entryId.trim().length === 0) {
        throw new Error('INVALID_ENTRY_ID: entryId must be a non-empty string');
      }
      const cleanId = entryId.trim();
      const capturedEpoch = vaultEpoch;
      const capturedScope = activeScopeId;
      assertEpochActive(capturedEpoch, capturedScope);

      return serializeOp(async () => {
        assertEpochActive(capturedEpoch, capturedScope);
        const keySnapshot = operationalKey;
        const aad = aadFor(capturedScope, cleanId);
        const encrypted = await encryptVaultRecord(keySnapshot, plaintextRecord, {
          aad,
          crypto: cryptoOverride
        });
        // Re-verify epoch after async WebCrypto encrypt before writing to IndexedDB!
        assertEpochActive(capturedEpoch, capturedScope);

        const nowIso = new Date().toISOString();
        const storageId = storageIdFor(capturedScope, cleanId);
        const recordToStore = {
          storageId,
          scopeId: capturedScope,
          entryId: cleanId,
          schemaVersion: 1,
          ivHex: encrypted.ivHex,
          ciphertextHex: encrypted.ciphertextHex,
          aad,
          updatedAt: nowIso
        };

        await withDb(async (db) => {
          const existing = await idbGet(db, SANKALPA_VAULT_STORE_NAME, storageId);
          recordToStore.createdAt = existing?.createdAt || nowIso;
          assertEpochActive(capturedEpoch, capturedScope);
          await idbPutBatchAtomic(db, SANKALPA_VAULT_STORE_NAME, [recordToStore]);
        });

        assertEpochActive(capturedEpoch, capturedScope);
        postCoordSignal('updated');
        return Object.freeze({
          ok: true,
          entryId: cleanId,
          ivHex: encrypted.ivHex,
          updatedAt: nowIso
        });
      });
    },

    async getEntry(entryId) {
      if (typeof entryId !== 'string' || entryId.trim().length === 0) {
        throw new Error('INVALID_ENTRY_ID: entryId must be a non-empty string');
      }
      const cleanId = entryId.trim();
      const capturedEpoch = vaultEpoch;
      const capturedScope = activeScopeId;
      assertEpochActive(capturedEpoch, capturedScope);

      const keySnapshot = operationalKey;
      const storageId = storageIdFor(capturedScope, cleanId);

      const stored = await withDb((db) => idbGet(db, SANKALPA_VAULT_STORE_NAME, storageId));
      assertEpochActive(capturedEpoch, capturedScope);
      if (!stored) return null;

      if (stored.scopeId !== capturedScope || stored.entryId !== cleanId || !isValidStoredRecordShape(stored)) {
        throw new Error('CORRUPT_VAULT_METADATA: Stored entry metadata is invalid or mismatched');
      }

      const plaintext = await decryptVaultRecord(keySnapshot, stored, {
        aad: aadFor(capturedScope, cleanId),
        crypto: cryptoOverride
      });
      // Re-verify epoch after async decrypt so a concurrent lock/logout never returns plaintext!
      assertEpochActive(capturedEpoch, capturedScope);
      return plaintext;
    },

    async listEntries() {
      const capturedEpoch = vaultEpoch;
      const capturedScope = activeScopeId;
      assertEpochActive(capturedEpoch, capturedScope);

      const keySnapshot = operationalKey;
      const all = await withDb((db) => idbGetAll(db, SANKALPA_VAULT_STORE_NAME));
      assertEpochActive(capturedEpoch, capturedScope);

      const scoped = all.filter((rec) => rec && rec.scopeId === capturedScope);
      const out = [];
      for (const rec of scoped) {
        if (!rec.entryId || !isValidStoredRecordShape(rec)) {
          throw new Error(`CORRUPT_VAULT_METADATA: Invalid record detected for entry "${rec?.entryId || 'unknown'}"`);
        }
        const plaintext = await decryptVaultRecord(keySnapshot, rec, {
          aad: aadFor(capturedScope, rec.entryId),
          crypto: cryptoOverride
        });
        assertEpochActive(capturedEpoch, capturedScope);
        out.push({
          entryId: rec.entryId,
          createdAt: rec.createdAt,
          updatedAt: rec.updatedAt,
          data: plaintext
        });
      }
      return out;
    },

    async deleteEntry(entryId) {
      if (typeof entryId !== 'string' || entryId.trim().length === 0) {
        throw new Error('INVALID_ENTRY_ID: entryId must be a non-empty string');
      }
      const cleanId = entryId.trim();
      const capturedEpoch = vaultEpoch;
      const capturedScope = activeScopeId;
      assertEpochActive(capturedEpoch, capturedScope);

      return serializeOp(async () => {
        assertEpochActive(capturedEpoch, capturedScope);
        await withDb((db) => idbDeleteOne(db, SANKALPA_VAULT_STORE_NAME, storageIdFor(capturedScope, cleanId)));
        assertEpochActive(capturedEpoch, capturedScope);
        postCoordSignal('updated');
        return true;
      });
    },

    async exportBackup(passphrase) {
      const capturedEpoch = vaultEpoch;
      const capturedScope = activeScopeId;
      assertEpochActive(capturedEpoch, capturedScope);

      const keySnapshot = operationalKey;
      const all = await withDb((db) => idbGetAll(db, SANKALPA_VAULT_STORE_NAME));
      assertEpochActive(capturedEpoch, capturedScope);

      const scoped = all.filter((rec) => rec && rec.scopeId === capturedScope);
      for (const rec of scoped) {
        if (!rec.entryId || !isValidStoredRecordShape(rec)) {
          throw new Error('CORRUPT_VAULT_METADATA: Cannot export corrupted vault record');
        }
      }

      // Decrypt entries with their scope+entryId AAD and embed entryId wrapper for lossless restore
      const cryptoObj = getWebCrypto(cryptoOverride);
      const decryptedWrapped = [];
      for (const rec of scoped) {
        const data = await decryptVaultRecord(keySnapshot, rec, {
          aad: aadFor(capturedScope, rec.entryId),
          crypto: cryptoObj
        });
        assertEpochActive(capturedEpoch, capturedScope);
        decryptedWrapped.push({
          entryId: rec.entryId,
          createdAt: rec.createdAt || null,
          updatedAt: rec.updatedAt || null,
          data
        });
      }

      // Encrypt via canonical backup pipeline using temporary operational-key records?
      // Better: directly run the exact PBKDF2-210k + AES-256-GCM envelope steps with fresh salt & IV
      if (!passphrase || typeof passphrase !== 'string' || passphrase.length < 8) {
        throw new Error('Passphrase must be at least 8 characters');
      }
      const salt = cryptoObj.getRandomValues(new Uint8Array(SANKALPA_SALT_BYTES));
      if (isAllZeroBytes(salt)) {
        throw new Error('SALT_GENERATION_FAILED: Cryptographic RNG returned zero salt');
      }
      const { iv, ivHex } = generateUniqueGcmIv(cryptoObj);
      const backupKey = await deriveBackupKey(passphrase, salt, SANKALPA_PBKDF2_ITERATIONS, cryptoObj);
      assertEpochActive(capturedEpoch, capturedScope);

      const payloadBytes = new TextEncoder().encode(JSON.stringify({
        entries: decryptedWrapped,
        exportedAt: new Date().toISOString()
      }));
      const ciphertext = await cryptoObj.subtle.encrypt(
        { name: 'AES-GCM', iv, tagLength: 128 },
        backupKey,
        payloadBytes
      );
      assertEpochActive(capturedEpoch, capturedScope);

      return {
        format: SANKALPA_BACKUP_FORMAT,
        version: SANKALPA_BACKUP_SCHEMA_VERSION,
        kdf: SANKALPA_BACKUP_KDF,
        iterations: SANKALPA_PBKDF2_ITERATIONS,
        saltHex: bytesToHex(salt),
        ivHex,
        ciphertextHex: bytesToHex(ciphertext),
        entryCount: decryptedWrapped.length
      };
    },

    /**
     * Imports a password-encrypted Sankalpa backup non-destructively into the unlocked vault.
     * Existing valid entries with the same entryId are NEVER overwritten — conflicting entries
     * are preserved under a recovered entryId (`<entryId>__recovered_<n>`).
     * Writes all imported entries in a single atomic IndexedDB transaction.
     */
    async importBackup(passphrase, backupEnvelope) {
      const capturedEpoch = vaultEpoch;
      const capturedScope = activeScopeId;
      assertEpochActive(capturedEpoch, capturedScope);

      return serializeOp(async () => {
        assertEpochActive(capturedEpoch, capturedScope);
        const keySnapshot = operationalKey;

        // Validate & decrypt backup first (before touching IndexedDB)
        const imported = await importEncryptedBackup({
          passphrase,
          backupEnvelope,
          targetOperationalKey: keySnapshot,
          crypto: cryptoOverride
        });
        assertEpochActive(capturedEpoch, capturedScope);

        const nowIso = new Date().toISOString();
        let importedCount = 0;
        let preservedExistingCount = 0;
        const conflicts = [];

        await withDb(async (db) => {
          const allExisting = await idbGetAll(db, SANKALPA_VAULT_STORE_NAME);
          assertEpochActive(capturedEpoch, capturedScope);

          const existingIds = new Set(
            allExisting
              .filter((r) => r && r.scopeId === capturedScope)
              .map((r) => r.entryId)
          );

          const batchToWrite = [];
          for (let i = 0; i < imported.entries.length; i++) {
            const rawEntry = imported.entries[i];
            const hasWrapper =
              rawEntry &&
              typeof rawEntry === 'object' &&
              typeof rawEntry.entryId === 'string' &&
              Object.prototype.hasOwnProperty.call(rawEntry, 'data');

            const baseId = hasWrapper
              ? rawEntry.entryId.trim()
              : (rawEntry && typeof rawEntry === 'object' && typeof rawEntry.id === 'string' && rawEntry.id.trim()
                  ? rawEntry.id.trim()
                  : `imported_${Date.now()}_${i}`);
            const payloadData = hasWrapper ? rawEntry.data : rawEntry;

            let targetId = baseId;
            if (existingIds.has(targetId)) {
              // Never overwrite existing valid vault entry — fork into recovered copy ID
              preservedExistingCount += 1;
              let suffix = 1;
              while (existingIds.has(`${baseId}__recovered_${suffix}`)) {
                suffix += 1;
              }
              targetId = `${baseId}__recovered_${suffix}`;
              conflicts.push({ originalEntryId: baseId, recoveredEntryId: targetId });
            }
            existingIds.add(targetId);

            const aad = aadFor(capturedScope, targetId);
            const enc = await encryptVaultRecord(keySnapshot, payloadData, {
              aad,
              crypto: cryptoOverride
            });
            assertEpochActive(capturedEpoch, capturedScope);

            batchToWrite.push({
              storageId: storageIdFor(capturedScope, targetId),
              scopeId: capturedScope,
              entryId: targetId,
              schemaVersion: 1,
              ivHex: enc.ivHex,
              ciphertextHex: enc.ciphertextHex,
              aad,
              createdAt: (hasWrapper && rawEntry.createdAt) || nowIso,
              updatedAt: nowIso
            });
            importedCount += 1;
          }

          if (batchToWrite.length > 0) {
            assertEpochActive(capturedEpoch, capturedScope);
            await idbPutBatchAtomic(db, SANKALPA_VAULT_STORE_NAME, batchToWrite);
          }
        });

        assertEpochActive(capturedEpoch, capturedScope);
        postCoordSignal('updated');
        return Object.freeze({
          ok: true,
          importedCount,
          preservedExistingCount,
          conflicts: Object.freeze(conflicts)
        });
      });
    },

    dispose() {
      disposed = true;
      invalidateSession('locked', 'disposed');
      if (coordChannel) {
        try { coordChannel.close(); } catch {}
        coordChannel = null;
      }
    }
  };
}
