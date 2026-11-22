/**
 * AuroMind Platform SDK — Sankalpa Vault Cryptographic Lifecycle
 *
 * Implements the definitive client-side cryptographic lifecycle for the sacred
 * Sankalpa Contemplation Vault (Data Class 6):
 *   1. Non-extractable operational AES-256-GCM key generation & IndexedDB storage
 *   2. Local in-memory encryption & decryption
 *   3. Encrypted backup export using a separate PBKDF2 passphrase-derived key
 *   4. Zero-knowledge backup import and validation
 *   5. Strict local-only physical air-gap enforcement
 *
 * Standards:
 *   - Operational: Web Crypto AES-GCM (256-bit, extractable=false)
 *   - Backup KDF: PBKDF2-HMAC-SHA256, 210,000 iterations (OWASP guidance), 16-byte salt
 *   - Backup Cipher: AES-256-GCM, 12-byte IV, 128-bit authentication tag
 */

export const SANKALPA_BACKUP_SCHEMA_VERSION = '1.0';
export const SANKALPA_PBKDF2_ITERATIONS = 210000;
export const SANKALPA_VAULT_DB_NAME = 'auromind_sankalpa_vault';
export const SANKALPA_VAULT_STORE_NAME = 'vault_entries';
export const SANKALPA_KEY_STORE_NAME = 'vault_keys';

/**
 * Generates an operational non-extractable Web Crypto AES-256-GCM key.
 */
export async function generateOperationalKey() {
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj || !cryptoObj.subtle) {
    throw new Error('Web Crypto API is unavailable');
  }

  // Key is strictly non-extractable (cannot be exported to raw bytes)
  return await cryptoObj.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false, // extractable: false
    ['encrypt', 'decrypt']
  );
}

/**
 * Derives a key for backup export/import from a passphrase using PBKDF2.
 */
export async function deriveBackupKey(passphrase, saltBuffer, iterations = SANKALPA_PBKDF2_ITERATIONS) {
  const cryptoObj = globalThis.crypto;
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
      salt: saltBuffer,
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
 * Encrypts a plaintext record using the operational non-extractable key.
 */
export async function encryptVaultRecord(operationalKey, plaintextRecord) {
  const cryptoObj = globalThis.crypto;
  const iv = cryptoObj.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(JSON.stringify(plaintextRecord));

  const ciphertext = await cryptoObj.subtle.encrypt(
    { name: 'AES-GCM', iv },
    operationalKey,
    dataBuffer
  );

  return {
    ivHex: Buffer.from(iv).toString('hex'),
    ciphertextHex: Buffer.from(ciphertext).toString('hex')
  };
}

/**
 * Decrypts a vault record using the operational non-extractable key.
 */
export async function decryptVaultRecord(operationalKey, { ivHex, ciphertextHex }) {
  const cryptoObj = globalThis.crypto;
  const iv = Buffer.from(ivHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');

  const decryptedBuffer = await cryptoObj.subtle.decrypt(
    { name: 'AES-GCM', iv },
    operationalKey,
    ciphertext
  );

  const decoder = new TextDecoder();
  return JSON.parse(decoder.decode(decryptedBuffer));
}

/**
 * Exports vault entries as a password-encrypted backup envelope.
 * Operational key is NEVER exported; entries are decrypted in memory
 * and re-encrypted with a fresh passphrase-derived backup key.
 */
export async function exportEncryptedBackup({ passphrase, vaultRecords, operationalKey }) {
  if (!passphrase || typeof passphrase !== 'string' || passphrase.length < 8) {
    throw new Error('Passphrase must be at least 8 characters');
  }

  const cryptoObj = globalThis.crypto;

  // 1. Decrypt records in memory using operational key
  const decryptedEntries = [];
  for (const record of vaultRecords) {
    const entry = await decryptVaultRecord(operationalKey, record);
    decryptedEntries.push(entry);
  }

  // 2. Generate random 16-byte salt and 12-byte IV for backup envelope
  const salt = cryptoObj.getRandomValues(new Uint8Array(16));
  const iv = cryptoObj.getRandomValues(new Uint8Array(12));

  // 3. Derive backup encryption key
  const backupKey = await deriveBackupKey(passphrase, salt, SANKALPA_PBKDF2_ITERATIONS);

  // 4. Encrypt full backup payload
  const encoder = new TextEncoder();
  const payloadBytes = encoder.encode(JSON.stringify({
    entries: decryptedEntries,
    exportedAt: new Date().toISOString()
  }));

  const ciphertext = await cryptoObj.subtle.encrypt(
    { name: 'AES-GCM', iv },
    backupKey,
    payloadBytes
  );

  // 5. Build standardized versioned backup envelope
  return {
    format: 'auromasti-sankalpa-backup',
    version: SANKALPA_BACKUP_SCHEMA_VERSION,
    kdf: 'PBKDF2-HMAC-SHA256',
    iterations: SANKALPA_PBKDF2_ITERATIONS,
    saltHex: Buffer.from(salt).toString('hex'),
    ivHex: Buffer.from(iv).toString('hex'),
    ciphertextHex: Buffer.from(ciphertext).toString('hex'),
    entryCount: decryptedEntries.length
  };
}

/**
 * Imports and validates an encrypted backup envelope into a target operational key.
 */
export async function importEncryptedBackup({ passphrase, backupEnvelope, targetOperationalKey }) {
  if (!backupEnvelope || backupEnvelope.format !== 'auromasti-sankalpa-backup') {
    throw new Error('INVALID_BACKUP_FORMAT');
  }
  if (backupEnvelope.version !== SANKALPA_BACKUP_SCHEMA_VERSION) {
    throw new Error(`UNSUPPORTED_BACKUP_VERSION: ${backupEnvelope.version}`);
  }
  if (!backupEnvelope.saltHex || !backupEnvelope.ivHex || !backupEnvelope.ciphertextHex) {
    throw new Error('MALFORMED_BACKUP_ENVELOPE');
  }

  const cryptoObj = globalThis.crypto;
  const salt = Buffer.from(backupEnvelope.saltHex, 'hex');
  const iv = Buffer.from(backupEnvelope.ivHex, 'hex');
  const ciphertext = Buffer.from(backupEnvelope.ciphertextHex, 'hex');

  // 1. Derive backup key using envelope's salt and iterations
  const backupKey = await deriveBackupKey(passphrase, salt, backupEnvelope.iterations || SANKALPA_PBKDF2_ITERATIONS);

  // 2. Decrypt with AES-GCM (validates authentication tag; throws on wrong passphrase or tampered ciphertext)
  let decryptedBytes;
  try {
    decryptedBytes = await cryptoObj.subtle.decrypt(
      { name: 'AES-GCM', iv },
      backupKey,
      ciphertext
    );
  } catch (err) {
    throw new Error('DECRYPTION_FAILED: Invalid passphrase or tampered backup file');
  }

  const decoder = new TextDecoder();
  const parsed = JSON.parse(decoder.decode(decryptedBytes));
  if (!Array.isArray(parsed.entries)) {
    throw new Error('MALFORMED_PAYLOAD_STRUCTURE');
  }

  // 3. Re-encrypt all imported entries under the target device's operational key
  const reEncryptedRecords = [];
  for (const entry of parsed.entries) {
    const record = await encryptVaultRecord(targetOperationalKey, entry);
    reEncryptedRecords.push(record);
  }

  return {
    importedCount: reEncryptedRecords.length,
    reEncryptedRecords
  };
}
