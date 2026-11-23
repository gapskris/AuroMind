/**
 * B19.5-04 — Sankalpa Privacy & Local Cryptographic Lifecycle Test Suite
 *
 * Exercises actual production code paths across:
 *   - Part 1: WebCrypto AES-256-GCM primitives, IV uniqueness, AAD binding, PBKDF2-210k KDF & anti-downgrade
 *   - Part 2: IndexedDB non-extractable CryptoKey lifecycle, reload persistence, account isolation,
 *             lock/logout/switch stale-op invalidation, key-loss & corruption safety, non-destructive
 *             backup merge, and multi-tab BroadcastChannel coordination
 *   - Part 3: Strict local-only privacy boundary across SDK sync, outbox, Supabase/Firestore providers,
 *             telemetry, logs, diagnostics, and backend-migration export
 *   - Part 4: Real Chromium/Edge browser verification (real WebCrypto, real IndexedDB key handles,
 *             real page.reload(), and two-tab BroadcastChannel coordination)
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SANKALPA_BACKUP_SCHEMA_VERSION,
  SANKALPA_BACKUP_FORMAT,
  SANKALPA_BACKUP_KDF,
  SANKALPA_PBKDF2_ITERATIONS,
  SANKALPA_SALT_BYTES,
  SANKALPA_IV_BYTES,
  SANKALPA_VAULT_DB_NAME,
  SANKALPA_VAULT_STORE_NAME,
  SANKALPA_KEY_STORE_NAME,
  bytesToHex,
  hexToBytes,
  generateOperationalKey,
  deriveBackupKey,
  encryptVaultRecord,
  decryptVaultRecord,
  exportEncryptedBackup,
  importEncryptedBackup,
  createSankalpaVaultManager
} from './assets/sdk/sankalpa-vault-lifecycle.js';

import {
  createAuroMindSDK,
  redactSensitive,
  sanitizeTelemetryPayload
} from './assets/sdk/auromind-sdk.js';
import { computePayloadChecksum, AuroBlocksMergeStrategy } from './assets/sdk/auromind-adapters.js';
import { createSupabaseSyncProvider } from './assets/sdk/providers/supabase/supabase-sync-provider.js';
import { createFirestoreSyncProvider } from './assets/sdk/providers/firebase/firestore-sync-provider.js';
import { exportCanonicalData, validateCanonicalData } from './assets/sdk/migration/backend-migration.js';
import { createTestEnvironment } from './e2e/browser-harness.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =============================================================================
// Shared Test Doubles (In-Memory IndexedDB, BroadcastChannel, Storage)
// =============================================================================

function createFakeIndexedDB({ failPutError = null, failOpen = false } = {}) {
  const dbs = new Map();
  let nextPutError = failPutError;
  let shouldFailOpen = failOpen;

  function getOrCreateDb(name) {
    if (!dbs.has(name)) {
      dbs.set(name, new Map());
    }
    const stores = dbs.get(name);
    const keyPaths = new Map();

    return {
      name,
      objectStoreNames: {
        contains: (storeName) => stores.has(storeName)
      },
      createObjectStore(storeName, opts = {}) {
        if (!stores.has(storeName)) stores.set(storeName, new Map());
        if (opts && opts.keyPath) keyPaths.set(storeName, opts.keyPath);
        return {};
      },
      close() {},
      transaction(storeName, _mode) {
        if (!stores.has(storeName)) stores.set(storeName, new Map());
        const store = stores.get(storeName);
        const pendingWrites = [];
        const tx = {
          oncomplete: null,
          onerror: null,
          onabort: null,
          error: null,
          _scheduled: false,
          _commit() {
            if (this._scheduled) return;
            this._scheduled = true;
            queueMicrotask(() => {
              if (pendingWrites.length > 0 && nextPutError) {
                const err = nextPutError;
                tx.error = err;
                if (tx.onerror) tx.onerror({ target: tx });
                return;
              }
              // Atomic commit of all queued writes in this transaction
              for (const op of pendingWrites) {
                if (op.type === 'put') store.set(op.key, op.value);
                else if (op.type === 'delete') store.delete(op.key);
              }
              if (tx.oncomplete) tx.oncomplete({ target: tx });
            });
          },
          objectStore() {
            return {
              get(key) {
                const req = { result: undefined, onsuccess: null, onerror: null };
                queueMicrotask(() => {
                  req.result = store.has(key) ? store.get(key) : undefined;
                  if (req.onsuccess) req.onsuccess({ target: req });
                });
                tx._commit();
                return req;
              },
              getAll() {
                const req = { result: [], onsuccess: null, onerror: null };
                queueMicrotask(() => {
                  req.result = Array.from(store.values());
                  if (req.onsuccess) req.onsuccess({ target: req });
                });
                tx._commit();
                return req;
              },
              put(value, explicitKey) {
                const kp = keyPaths.get(storeName);
                const k = explicitKey !== undefined
                  ? explicitKey
                  : (kp && value ? value[kp] : (value && (value.keyId || value.storageId || value.id || value.key)));
                pendingWrites.push({ type: 'put', key: k, value });
                const req = { result: k, onsuccess: null, onerror: null };
                tx._commit();
                return req;
              },
              delete(key) {
                pendingWrites.push({ type: 'delete', key });
                const req = { result: undefined, onsuccess: null, onerror: null };
                tx._commit();
                return req;
              }
            };
          }
        };
        return tx;
      }
    };
  }

  return {
    open(name) {
      const req = { result: null, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
      queueMicrotask(() => {
        if (shouldFailOpen) {
          req.error = new Error('Simulated IDB open failure');
          if (req.onerror) req.onerror({ target: req });
          return;
        }
        const db = getOrCreateDb(name);
        req.result = db;
        if (req.onupgradeneeded) req.onupgradeneeded({ target: req });
        if (req.onsuccess) req.onsuccess({ target: req });
      });
      return req;
    },
    _setNextPutError(err) {
      nextPutError = err;
    },
    _setFailOpen(flag) {
      shouldFailOpen = Boolean(flag);
    },
    _getStoreMap(dbName, storeName) {
      const db = dbs.get(dbName);
      if (!db) return null;
      return db.get(storeName) || null;
    }
  };
}

function createFakeBroadcastBus() {
  const channels = new Map();
  const capturedMessages = [];
  class FakeBroadcastChannel {
    constructor(name) {
      this.name = name;
      this.onmessage = null;
      this._closed = false;
      if (!channels.has(name)) channels.set(name, new Set());
      channels.get(name).add(this);
    }
    postMessage(data) {
      if (this._closed) return;
      const cloned = JSON.parse(JSON.stringify(data));
      capturedMessages.push({ channel: this.name, data: cloned });
      const peers = channels.get(this.name);
      if (!peers) return;
      for (const peer of peers) {
        if (peer !== this && !peer._closed && typeof peer.onmessage === 'function') {
          peer.onmessage({ data: JSON.parse(JSON.stringify(data)) });
        }
      }
    }
    close() {
      this._closed = true;
      const peers = channels.get(this.name);
      if (peers) peers.delete(this);
    }
  }
  return { BroadcastChannel: FakeBroadcastChannel, capturedMessages };
}

function createMemoryStorage() {
  const map = new Map();
  return {
    get length() { return map.size; },
    key(i) { return Array.from(map.keys())[i] ?? null; },
    getItem(k) { return map.has(String(k)) ? map.get(String(k)) : null; },
    setItem(k, v) { map.set(String(k), String(v)); },
    removeItem(k) { map.delete(String(k)); },
    clear() { map.clear(); }
  };
}

// =============================================================================
// PART 1 — CRYPTOGRAPHIC PRIMITIVES, IV UNIQUENESS & ANTI-DOWNGRADE
// =============================================================================

describe('Part 1 — Sankalpa Cryptographic Primitives & Anti-Downgrade', () => {
  test('Crypto-1: Zero Node Buffer dependency, non-extractable AES-256-GCM key, Unicode round-trip & AAD binding', async () => {
    const src = fs.readFileSync(path.join(__dirname, 'assets/sdk/sankalpa-vault-lifecycle.js'), 'utf8');
    assert.equal(/\bBuffer\s*\./.test(src), false, 'sankalpa-vault-lifecycle.js must be browser-safe with zero Buffer.* calls');

    const key = await generateOperationalKey();
    assert.equal(key.extractable, false, 'Operational key must be non-extractable');
    assert.equal(key.algorithm.name, 'AES-GCM');
    assert.equal(key.algorithm.length, 256);

    // Attempting to export a non-extractable key must fail
    await assert.rejects(async () => {
      await globalThis.crypto.subtle.exportKey('raw', key);
    });

    const record = {
      id: 'sankalpa_01',
      intention: 'ॐ May peace abide in every breath — शान्तिः',
      tags: ['stillness', 'gratitude']
    };

    const aad = 'auromind:sankalpa:v1:user_alice:sankalpa_01';
    const encrypted = await encryptVaultRecord(key, record, { aad });
    assert.equal(encrypted.ivHex.length, SANKALPA_IV_BYTES * 2, 'IV must be 12 bytes (24 hex chars)');
    assert.ok(encrypted.ciphertextHex.length >= 32, 'Ciphertext must include 128-bit GCM auth tag');
    assert.equal(encrypted.ciphertextHex.includes('peace'), false, 'Ciphertext must not leak plaintext');

    const decrypted = await decryptVaultRecord(key, encrypted, { aad });
    assert.deepEqual(decrypted, record);

    // AAD mismatch (swapping ciphertext into another entry/account scope) MUST fail authentication!
    await assert.rejects(
      async () => decryptVaultRecord(key, encrypted, { aad: 'auromind:sankalpa:v1:user_bob:sankalpa_01' }),
      /DECRYPTION_FAILED/
    );
  });

  test('Crypto-2: Wrong key, tampered ciphertext/tag, and malformed IV/ciphertext rejected without leaking plaintext', async () => {
    const keyA = await generateOperationalKey();
    const keyB = await generateOperationalKey();
    const secret = { id: 's2', note: 'TOP_SECRET_SANKALPA_INTENTION' };
    const encrypted = await encryptVaultRecord(keyA, secret);

    // Wrong key
    await assert.rejects(async () => decryptVaultRecord(keyB, encrypted), /DECRYPTION_FAILED/);

    // Flip 1 byte in ciphertext body
    const tamperedBody = {
      ...encrypted,
      ciphertextHex: (encrypted.ciphertextHex.startsWith('00') ? 'ff' : '00') + encrypted.ciphertextHex.slice(2)
    };
    await assert.rejects(async () => decryptVaultRecord(keyA, tamperedBody), /DECRYPTION_FAILED/);

    // Flip 1 byte in trailing 16-byte authentication tag
    const lastByte = encrypted.ciphertextHex.slice(-2);
    const tamperedTag = {
      ...encrypted,
      ciphertextHex: encrypted.ciphertextHex.slice(0, -2) + (lastByte === 'aa' ? 'bb' : 'aa')
    };
    await assert.rejects(async () => decryptVaultRecord(keyA, tamperedTag), /DECRYPTION_FAILED/);

    // Invalid IV length (8 bytes instead of 12)
    await assert.rejects(
      async () => decryptVaultRecord(keyA, { ivHex: 'aabbccddeeff0011', ciphertextHex: encrypted.ciphertextHex }),
      /INVALID_LENGTH_IV/
    );

    // Truncated ciphertext shorter than 16-byte GCM auth tag
    await assert.rejects(
      async () => decryptVaultRecord(keyA, { ivHex: encrypted.ivHex, ciphertextHex: 'deadbeef' }),
      /INVALID_LENGTH_CIPHERTEXT/
    );
  });

  test('Crypto-3: Unique 12-byte IVs across repeated and concurrent encryptions + stuck-RNG collision defense', async () => {
    const key = await generateOperationalKey();
    const samePlaintext = { note: 'Identical contemplation text' };

    const results = await Promise.all(
      Array.from({ length: 40 }, () => encryptVaultRecord(key, samePlaintext))
    );

    const uniqueIvs = new Set(results.map((r) => r.ivHex));
    const uniqueCiphertexts = new Set(results.map((r) => r.ciphertextHex));
    assert.equal(uniqueIvs.size, 40, 'Every concurrent encryption must produce a distinct 12-byte IV');
    assert.equal(uniqueCiphertexts.size, 40, 'Identical plaintext must never produce identical ciphertext');

    // Simulate a broken RNG that returns the exact same IV twice, then a fresh IV on attempt 3
    let calls = 0;
    const flakyCrypto = {
      subtle: globalThis.crypto.subtle,
      getRandomValues(arr) {
        calls += 1;
        if (calls <= 2) {
          arr.fill(0x42);
          return arr;
        }
        return globalThis.crypto.getRandomValues(arr);
      }
    };
    const first = await encryptVaultRecord(key, { n: 1 }, { crypto: flakyCrypto });
    const second = await encryptVaultRecord(key, { n: 2 }, { crypto: flakyCrypto });
    assert.notEqual(first.ivHex, second.ivHex, 'Duplicate IV from RNG must be rejected and re-rolled');

    // Permanently stuck RNG returning all zeros must fail closed (never encrypt with zero IV!)
    const zeroRngCrypto = {
      subtle: globalThis.crypto.subtle,
      getRandomValues(arr) {
        arr.fill(0);
        return arr;
      }
    };
    await assert.rejects(
      async () => encryptVaultRecord(key, { n: 3 }, { crypto: zeroRngCrypto }),
      /IV_GENERATION_FAILED/
    );
  });

  test('Crypto-4: PBKDF2-210k derivation correctness, salt validation, and anti-downgrade backup import', async () => {
    const salt16 = globalThis.crypto.getRandomValues(new Uint8Array(SANKALPA_SALT_BYTES));
    const derived = await deriveBackupKey('StrongPassphrase#2026', salt16, SANKALPA_PBKDF2_ITERATIONS);
    assert.equal(derived.extractable, false);
    assert.equal(derived.algorithm.name, 'AES-GCM');
    assert.equal(derived.algorithm.length, 256);

    // Reject short salt (< 16 bytes)
    await assert.rejects(
      async () => deriveBackupKey('StrongPassphrase#2026', new Uint8Array(8), SANKALPA_PBKDF2_ITERATIONS),
      /INVALID_SALT/
    );

    // Reject weak iterations (< 210,000)
    await assert.rejects(
      async () => deriveBackupKey('StrongPassphrase#2026', salt16, 10000),
      /INVALID_KDF_ITERATIONS/
    );

    // Produce a real backup, then attempt downgrade attacks on import
    const srcKey = await generateOperationalKey();
    const dstKey = await generateOperationalKey();
    const rec = await encryptVaultRecord(srcKey, { id: 'b1', text: 'Sacred intention' });
    const backup = await exportEncryptedBackup({
      passphrase: 'SacredPassphrase2026!',
      vaultRecords: [rec],
      operationalKey: srcKey
    });

    assert.equal(backup.format, SANKALPA_BACKUP_FORMAT);
    assert.equal(backup.version, SANKALPA_BACKUP_SCHEMA_VERSION);
    assert.equal(backup.kdf, SANKALPA_BACKUP_KDF);
    assert.equal(backup.iterations, SANKALPA_PBKDF2_ITERATIONS);
    assert.equal(backup.saltHex.length, SANKALPA_SALT_BYTES * 2);
    assert.equal(backup.ivHex.length, SANKALPA_IV_BYTES * 2);

    // Downgrade attack: iterations: 1 must be rejected BEFORE calling PBKDF2!
    await assert.rejects(
      async () => importEncryptedBackup({
        passphrase: 'SacredPassphrase2026!',
        backupEnvelope: { ...backup, iterations: 1 },
        targetOperationalKey: dstKey
      }),
      /INSECURE_KDF_ITERATIONS/
    );

    // Unsupported KDF
    await assert.rejects(
      async () => importEncryptedBackup({
        passphrase: 'SacredPassphrase2026!',
        backupEnvelope: { ...backup, kdf: 'MD5' },
        targetOperationalKey: dstKey
      }),
      /UNSUPPORTED_BACKUP_KDF/
    );

    // Tampered entryCount metadata
    await assert.rejects(
      async () => importEncryptedBackup({
        passphrase: 'SacredPassphrase2026!',
        backupEnvelope: { ...backup, entryCount: 99 },
        targetOperationalKey: dstKey
      }),
      /entryCount mismatch/
    );
  });

  test('Crypto-5: Rejects extractable AES-GCM keys and fails closed when WebCrypto is unavailable', async () => {
    const extractableKey = await globalThis.crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true, // extractable: true -> MUST BE REJECTED!
      ['encrypt', 'decrypt']
    );

    await assert.rejects(
      async () => encryptVaultRecord(extractableKey, { secret: 'nope' }),
      /EXTRACTABLE_KEY_FORBIDDEN/
    );

    const brokenCrypto = {};
    await assert.rejects(
      async () => generateOperationalKey(brokenCrypto),
      /WEB_CRYPTO_UNAVAILABLE/
    );
  });
});

// =============================================================================
// PART 2 — INDEXEDDB VAULT LIFECYCLE, ACCOUNT ISOLATION & CONCURRENCY
// =============================================================================

describe('Part 2 — Sankalpa Vault Lifecycle, Isolation, Recovery & Multi-Tab Concurrency', () => {
  test('Vault-1: IndexedDB non-extractable key-handle persistence & reload recovery without plaintext in storage', async () => {
    const fakeIdb = createFakeIndexedDB();
    const vm1 = createSankalpaVaultManager({ scopeId: 'guest_device_1', indexedDB: fakeIdb, BroadcastChannel: null });

    const unlockRes = await vm1.unlock();
    assert.equal(unlockRes.created, true);
    assert.equal(vm1.getStatus().unlocked, true);

    await vm1.putEntry('morning_1', { intention: 'Cultivate equanimity and luminous silence' });
    vm1.lock();
    assert.equal(vm1.getStatus().unlocked, false);
    assert.equal(vm1.getStatus().hasKeyHandle, false);

    // Inspect raw IndexedDB stores: verify key is non-extractable and entry has ZERO plaintext!
    const rawKeys = fakeIdb._getStoreMap(SANKALPA_VAULT_DB_NAME, SANKALPA_KEY_STORE_NAME);
    const rawEntries = fakeIdb._getStoreMap(SANKALPA_VAULT_DB_NAME, SANKALPA_VAULT_STORE_NAME);
    assert.equal(rawKeys.size, 1);
    const storedKeyRecord = Array.from(rawKeys.values())[0];
    assert.equal(storedKeyRecord.key.extractable, false);

    const rawEntryJson = JSON.stringify(Array.from(rawEntries.values()));
    assert.equal(rawEntryJson.includes('equanimity'), false, 'IndexedDB must never contain plaintext Sankalpa');
    assert.equal(rawEntryJson.includes('luminous'), false);
    vm1.dispose();

    // Simulated page reload: brand-new manager opens same IndexedDB and recovers existing key handle
    const vm2 = createSankalpaVaultManager({ scopeId: 'guest_device_1', indexedDB: fakeIdb, BroadcastChannel: null });
    const reloadUnlock = await vm2.unlock();
    assert.equal(reloadUnlock.created, false, 'Reload must reuse persisted non-extractable key handle');
    assert.equal(reloadUnlock.existingEntryCount, 1);

    const restored = await vm2.getEntry('morning_1');
    assert.equal(restored.intention, 'Cultivate equanimity and luminous silence');
    vm2.dispose();
  });

  test('Vault-2: Account isolation prevents cross-account access and cross-scope ciphertext transplantation', async () => {
    const fakeIdb = createFakeIndexedDB();
    const vm = createSankalpaVaultManager({ scopeId: 'user_alice', indexedDB: fakeIdb, BroadcastChannel: null });

    await vm.unlock('user_alice');
    await vm.putEntry('entry_1', { secret: 'ALICE_ONLY_PRAYER' });

    // Switch account to Bob -> immediately locks & drops Alice's key handle
    vm.switchAccount('user_bob');
    assert.equal(vm.getStatus().unlocked, false);
    assert.equal(vm.getStatus().scopeId, 'user_bob');

    // Reading while locked must throw
    await assert.rejects(async () => vm.getEntry('entry_1'), /VAULT_STALE_OPERATION/);

    await vm.unlock('user_bob');
    assert.equal(await vm.getEntry('entry_1'), null, 'Bob must not see Alice entries');
    assert.deepEqual(await vm.listEntries(), []);

    // Even if an attacker copies Alice's raw encrypted row into Bob's scopeId, decryption MUST fail!
    const rawEntries = fakeIdb._getStoreMap(SANKALPA_VAULT_DB_NAME, SANKALPA_VAULT_STORE_NAME);
    const aliceRow = rawEntries.get('user_alice::entry_1');
    rawEntries.set('user_bob::stolen_1', {
      ...aliceRow,
      storageId: 'user_bob::stolen_1',
      scopeId: 'user_bob',
      entryId: 'stolen_1'
    });
    await assert.rejects(async () => vm.getEntry('stolen_1'), /DECRYPTION_FAILED/);

    vm.dispose();
  });

  test('Vault-3: Lock, logout, and account switch invalidate in-flight async encrypt/decrypt operations cleanly', async () => {
    const fakeIdb = createFakeIndexedDB();
    let releaseEncrypt;
    let enteredEncrypt;
    const encryptEnteredP = new Promise((r) => { enteredEncrypt = r; });
    const encryptReleaseP = new Promise((r) => { releaseEncrypt = r; });

    const delayedCrypto = {
      getRandomValues: (arr) => globalThis.crypto.getRandomValues(arr),
      subtle: {
        generateKey: (...args) => globalThis.crypto.subtle.generateKey(...args),
        decrypt: (...args) => globalThis.crypto.subtle.decrypt(...args),
        async encrypt(...args) {
          enteredEncrypt();
          await encryptReleaseP;
          return globalThis.crypto.subtle.encrypt(...args);
        }
      }
    };

    const vm = createSankalpaVaultManager({
      scopeId: 'user_race',
      indexedDB: fakeIdb,
      crypto: delayedCrypto,
      BroadcastChannel: null
    });
    await vm.unlock();

    // Start async putEntry -> pauses inside WebCrypto encrypt -> logout fires mid-flight!
    const pendingPut = vm.putEntry('stale_write', { secret: 'SHOULD_NOT_PERSIST' });
    await encryptEnteredP;
    vm.onLogout();
    releaseEncrypt();

    await assert.rejects(async () => pendingPut, /VAULT_STALE_OPERATION/);

    // Verify NOTHING was written to IndexedDB after logout!
    const rawEntries = fakeIdb._getStoreMap(SANKALPA_VAULT_DB_NAME, SANKALPA_VAULT_STORE_NAME);
    assert.equal(rawEntries.has('user_race::stale_write'), false, 'Stale async write must NOT commit after logout');

    vm.dispose();
  });

  test('Vault-4: Missing key, corrupt metadata, and IndexedDB quota/open failures never destroy valid vault or fall back to plaintext', async () => {
    const fakeIdb = createFakeIndexedDB();
    const vm = createSankalpaVaultManager({ scopeId: 'user_recover', indexedDB: fakeIdb, BroadcastChannel: null });
    await vm.unlock();
    await vm.putEntry('sacred_1', { text: 'Original sacred entry' });

    // 1. Simulate IndexedDB QuotaExceededError on next write -> existing valid entry remains intact
    const quotaErr = new Error('QuotaExceededError: disk full');
    quotaErr.name = 'QuotaExceededError';
    fakeIdb._setNextPutError(quotaErr);
    await assert.rejects(async () => vm.putEntry('sacred_2', { text: 'Fails quota' }), /QuotaExceededError/);
    fakeIdb._setNextPutError(null);
    assert.deepEqual(await vm.getEntry('sacred_1'), { text: 'Original sacred entry' });

    // 2. Simulate operational key loss while encrypted entries still exist in IndexedDB
    vm.lock();
    const rawKeys = fakeIdb._getStoreMap(SANKALPA_VAULT_DB_NAME, SANKALPA_KEY_STORE_NAME);
    const savedKeyRecord = rawKeys.get('sankalpa_key::user_recover');
    rawKeys.delete('sankalpa_key::user_recover');

    await assert.rejects(async () => vm.unlock(), /KEY_MISSING_FOR_EXISTING_VAULT/);
    assert.equal(vm.getStatus().state, 'unrecoverable_missing_key');
    // Existing encrypted entry MUST NOT be silently deleted or overwritten!
    const rawEntries = fakeIdb._getStoreMap(SANKALPA_VAULT_DB_NAME, SANKALPA_VAULT_STORE_NAME);
    assert.equal(rawEntries.has('user_recover::sacred_1'), true, 'Missing key must NEVER silently destroy encrypted vault entries');

    // 3. Simulate corrupt key metadata in vault_keys
    rawKeys.set('sankalpa_key::user_recover', { keyId: 'sankalpa_key::user_recover', key: { fake: true } });
    await assert.rejects(async () => vm.unlock(), /CORRUPT_KEY_METADATA/);

    // 4. Restore valid key, then corrupt an entry's metadata
    rawKeys.set('sankalpa_key::user_recover', savedKeyRecord);
    await vm.unlock();
    rawEntries.set('user_recover::corrupt_1', {
      storageId: 'user_recover::corrupt_1',
      scopeId: 'user_recover',
      entryId: 'corrupt_1',
      ivHex: 'not_valid_hex',
      ciphertextHex: 'broken'
    });
    await assert.rejects(async () => vm.getEntry('corrupt_1'), /CORRUPT_VAULT_METADATA/);

    // 5. IndexedDB completely unavailable -> fails closed cleanly (never falls back to localStorage plaintext)
    const noIdbVm = createSankalpaVaultManager({ scopeId: 'guest', indexedDB: null, BroadcastChannel: null });
    await assert.rejects(async () => noIdbVm.unlock(), /INDEXEDDB_UNAVAILABLE/);
    assert.equal(noIdbVm.getStatus().state, 'storage_unavailable');

    vm.dispose();
    noIdbVm.dispose();
  });

  test('Vault-5: Export/import backup recovers entries non-destructively without overwriting valid existing entries', async () => {
    const idbSource = createFakeIndexedDB();
    const vmSource = createSankalpaVaultManager({ scopeId: 'device_a', indexedDB: idbSource, BroadcastChannel: null });
    await vmSource.unlock();
    await vmSource.putEntry('daily_1', { text: 'Backup version of daily_1' });
    await vmSource.putEntry('daily_2', { text: 'Only in backup daily_2' });

    const backupEnvelope = await vmSource.exportBackup('MyStrongSankalpaPass#2026');
    assert.equal(backupEnvelope.entryCount, 2);

    // Target device already has a valid existing 'daily_1' entry that MUST NOT be overwritten!
    const idbTarget = createFakeIndexedDB();
    const vmTarget = createSankalpaVaultManager({ scopeId: 'device_b', indexedDB: idbTarget, BroadcastChannel: null });
    await vmTarget.unlock();
    await vmTarget.putEntry('daily_1', { text: 'Existing local valid daily_1' });

    const importRes = await vmTarget.importBackup('MyStrongSankalpaPass#2026', backupEnvelope);
    assert.equal(importRes.ok, true);
    assert.equal(importRes.importedCount, 2);
    assert.equal(importRes.preservedExistingCount, 1);
    assert.equal(importRes.conflicts.length, 1);
    assert.equal(importRes.conflicts[0].originalEntryId, 'daily_1');
    assert.equal(importRes.conflicts[0].recoveredEntryId, 'daily_1__recovered_1');

    // Original local entry is 100% preserved, recovered copy & non-conflicting entry both exist!
    assert.deepEqual(await vmTarget.getEntry('daily_1'), { text: 'Existing local valid daily_1' });
    assert.deepEqual(await vmTarget.getEntry('daily_1__recovered_1'), { text: 'Backup version of daily_1' });
    assert.deepEqual(await vmTarget.getEntry('daily_2'), { text: 'Only in backup daily_2' });

    vmSource.dispose();
    vmTarget.dispose();
  });

  test('Vault-6: Multi-tab concurrent writes & BroadcastChannel lock coordination leak zero sensitive data', async () => {
    const sharedIdb = createFakeIndexedDB();
    const { BroadcastChannel, capturedMessages } = createFakeBroadcastBus();

    const tab1 = createSankalpaVaultManager({ scopeId: 'shared_user', indexedDB: sharedIdb, BroadcastChannel });
    const tab2 = createSankalpaVaultManager({ scopeId: 'shared_user', indexedDB: sharedIdb, BroadcastChannel });

    await tab1.unlock();
    await tab2.unlock();

    // Concurrent writes from both tabs
    const [w1, w2] = await Promise.all([
      tab1.putEntry('tab1_note', { intention: 'SECRET_TAB_ONE_PRAYER' }),
      tab2.putEntry('tab2_note', { intention: 'SECRET_TAB_TWO_PRAYER' })
    ]);
    assert.notEqual(w1.ivHex, w2.ivHex);

    const allInTab1 = await tab1.listEntries();
    assert.equal(allInTab1.length, 2);

    // Locking Tab 1 propagates non-sensitive lock signal to Tab 2
    tab1.lock();
    assert.equal(tab1.getStatus().unlocked, false);
    assert.equal(tab2.getStatus().unlocked, false, 'Peer tab must lock immediately upon cross-tab lock signal');

    // Verify BroadcastChannel carried ZERO plaintext, ciphertext, IVs, salts, or keys!
    const channelDump = JSON.stringify(capturedMessages);
    assert.equal(channelDump.includes('SECRET_TAB_ONE_PRAYER'), false);
    assert.equal(channelDump.includes('SECRET_TAB_TWO_PRAYER'), false);
    assert.equal(channelDump.includes(w1.ivHex), false);
    assert.equal(channelDump.includes(w2.ivHex), false);
    assert.equal(channelDump.includes('ciphertextHex'), false);
    assert.equal(channelDump.includes('saltHex'), false);

    tab1.dispose();
    tab2.dispose();
  });
});

// =============================================================================
// PART 3 — MANDATORY LOCAL-ONLY PRIVACY BOUNDARY VERIFICATION
// =============================================================================

describe('Part 3 — Mandatory Sankalpa Privacy Boundary (Sync, Outbox, Providers, Telemetry, Logs, Migration)', () => {
  test('Privacy-1: SDK blocks Sankalpa from syncOutbox, IDB outbox, and syncNow even if an adapter forgets localOnlyVaults', async () => {
    const storage = createMemoryStorage();
    const fakeIdb = createFakeIndexedDB();
    let pushCalls = 0;

    const authListeners = new Set();
    const privAccount = {
      userId: 'u_priv',
      email: 'priv@example.com',
      displayName: 'priv',
      provider: 'email',
      expiresAt: new Date(Date.now() + 3600_000).toISOString()
    };
    const auth = {
      providerName: 'mock-auth',
      isConfigured: () => true,
      async getSession() { return { ...privAccount }; },
      async getCurrentSession() { return { ...privAccount }; },
      async signIn() {
        for (const cb of authListeners) cb({ ...privAccount });
        return { status: 'authenticated', account: { ...privAccount } };
      },
      async signOut() {
        for (const cb of authListeners) cb(null);
      },
      onAuthStateChange(cb) {
        authListeners.add(cb);
        return () => authListeners.delete(cb);
      }
    };
    const cloudSync = {
      providerName: 'mock-sync',
      isConfigured: () => true,
      async pullLatest() { return null; },
      async pushWithOptimisticLock() { pushCalls += 1; return { status: 'success', newRevision: 1 }; }
    };

    const sdk = createAuroMindSDK({
      env: { localStorage: storage, indexedDB: fakeIdb, BroadcastChannel: null }
    });
    await sdk.init({
      gameId: 'portal',
      capabilities: { authEnabled: true, cloudSyncEnabled: true },
      providers: { auth, cloudSync }
    });

    // 1. Attempting to queue auromandala_sankalpa in sync outbox must be rejected!
    const queued = await sdk.sync.queueLocalChange('auromandala_sankalpa');
    assert.equal(queued, false);
    assert.equal(sdk.sync.getPendingOutboxCount(), 0);

    // 2. Register an adapter that FORGOT to declare localOnlyVaults, yet leaks a sankalpa key in payload!
    const leakyPayload = { highScore: 100, sankalpa: { secret: 'MUST_NEVER_SYNC' } };
    sdk.adapters.register({
      gameId: 'auroblocks',
      adapterVersion: '1.0.0',
      contractVersion: 1,
      integrationMode: 'native',
      storage: { kind: 'ls', ownedDatabases: [], ownedLocalStorageKeys: ['leaky_blocks'], localOnlyVaults: [] },
      capabilities: { offlinePlay: true, localPersistence: true, cloudSyncEligible: true },
      hasLocalProgress: () => true,
      exportEnvelope: async (guestId) => ({
        envelopeVersion: 1,
        gameId: 'auroblocks',
        gameSchemaVersion: 1,
        guestId,
        baseRevision: 0,
        clientUpdatedAt: new Date().toISOString(),
        isEmpty: false,
        checksum: await computePayloadChecksum(leakyPayload),
        payload: leakyPayload
      }),
      applyEnvelope: async () => true
    }, { mergeStrategy: AuroBlocksMergeStrategy });
    await sdk.adapters.init('auroblocks');

    await sdk.auth.signIn('email', { email: 'priv@example.com' });
    sdk.sync.setConsent(true);

    const directSankalpaSync = await sdk.sync.syncNow('auromandala_sankalpa');
    assert.equal(directSankalpaSync.results[0].action, 'blocked_local_only_vault');

    const leakySync = await sdk.sync.syncNow('auroblocks');
    assert.equal(leakySync.results[0].action, 'blocked_local_only_vault');
    assert.equal(pushCalls, 0, 'Zero cloud pushes permitted when Sankalpa data is present');

    sdk.dispose();
  });

  test('Privacy-2: Both Supabase and Firestore sync providers refuse Sankalpa gameIds, localOnly flags, and nested Sankalpa payloads', async () => {
    let supabaseCalls = 0;
    const supabaseClient = {
      isConfigured: () => true,
      from() { supabaseCalls += 1; throw new Error('Should never query Supabase for Sankalpa'); },
      async rpc() { supabaseCalls += 1; throw new Error('Should never invoke Supabase RPC for Sankalpa'); }
    };
    const sbSync = createSupabaseSyncProvider(supabaseClient);

    assert.equal(await sbSync.pullLatest('user_1', 'auromandala_sankalpa'), null);
    const sbPush1 = await sbSync.pushWithOptimisticLock({ gameId: 'auromandala_sankalpa', payload: {} }, 'user_1', 0);
    assert.equal(sbPush1.status, 'disabled');
    const sbPush2 = await sbSync.pushWithOptimisticLock({ gameId: 'auromandala', localOnly: true, payload: {} }, 'user_1', 0);
    assert.equal(sbPush2.status, 'disabled');
    const sbPush3 = await sbSync.pushWithOptimisticLock({
      gameId: 'auromandala',
      payload: { nested: { sankalpa_e2ee_vault: 'ciphertext_secret' } }
    }, 'user_1', 0);
    assert.equal(sbPush3.status, 'disabled');
    assert.equal(supabaseCalls, 0, 'Supabase client must never be invoked for Sankalpa data');

    let firestoreCalls = 0;
    const fbClient = {
      isConfigured: () => true,
      firestore: {
        async getDocument() { firestoreCalls += 1; throw new Error('Should never read Firestore for Sankalpa'); },
        async setDocument() { firestoreCalls += 1; throw new Error('Should never write Firestore for Sankalpa'); }
      }
    };
    const fsSync = createFirestoreSyncProvider(fbClient);
    assert.equal(await fsSync.pullLatest('user_1', 'auromandala_sankalpa'), null);
    const fsPush = await fsSync.pushWithOptimisticLock({
      gameId: 'auromandala',
      payload: { backup: { format: 'auromasti-sankalpa-backup', ciphertextHex: 'deadbeef' } }
    }, 'user_1', 0);
    assert.equal(fsPush.status, 'disabled');
    assert.equal(firestoreCalls, 0, 'Firestore client must never be invoked for Sankalpa data');
  });

  test('Privacy-3: Logs, telemetry, diagnostics, and migration export redact/strip/reject all Sankalpa secrets & markers', async () => {
    const rawSensitive = {
      event: 'vault_action',
      sankalpa: 'MY_SECRET_INTENTION',
      ivHex: '0123456789abcdef01234567',
      saltHex: '0123456789abcdef0123456789abcdef',
      ciphertextHex: 'deadbeefcafebabe',
      passphrase: 'SecretPassphrase123!',
      message: 'Tried to read sankalpa_e2ee_vault and auromasti-sankalpa-backup'
    };

    const redacted = redactSensitive(rawSensitive);
    assert.equal(redacted.sankalpa, '[REDACTED]');
    assert.equal(redacted.ivHex, '[REDACTED]');
    assert.equal(redacted.saltHex, '[REDACTED]');
    assert.equal(redacted.ciphertextHex, '[REDACTED]');
    assert.equal(redacted.passphrase, '[REDACTED]');
    assert.equal(redacted.message.includes('sankalpa_e2ee_vault'), false);
    assert.equal(redacted.message.includes('auromasti-sankalpa-backup'), false);

    const sanitizedTel = sanitizeTelemetryPayload(rawSensitive);
    assert.equal('sankalpa' in sanitizedTel, false);
    assert.equal('ivHex' in sanitizedTel, false);
    assert.equal('saltHex' in sanitizedTel, false);
    assert.equal('ciphertextHex' in sanitizedTel, false);
    assert.equal('passphrase' in sanitizedTel, false);

    // Backend migration export must strip nested sankalpa fields and validateCanonicalData must reject any Sankalpa presence
    const exported = await exportCanonicalData({
      accountProvider: {
        async exportUserData() {
          return {
            profile: { displayName: 'Seeker' },
            gameSaves: [
              { gameId: 'auromandala_sankalpa', payload: { secret: 'NOPE' } },
              { gameId: 'auromandala', payload: { highestStageCleared: 3, sankalpa: { note: 'LEAKED' } } }
            ],
            linkedDevices: [],
            entitlements: []
          };
        }
      }
    }, 'user_mig_1');

    assert.equal(exported.gameSaves.length, 1);
    assert.equal(exported.gameSaves[0].gameId, 'auromandala');
    assert.equal('sankalpa' in exported.gameSaves[0].payload, false);
    assert.equal(JSON.stringify(exported).includes('LEAKED'), false);

    const badValidation = await validateCanonicalData({
      schemaVersion: 1,
      sourceUserId: 'u1',
      gameSaves: [{ gameId: 'auromandala', payload: { sankalpa: 'LEAK' } }]
    });
    assert.equal(badValidation.valid, false);
    assert.ok(badValidation.errors.some((e) => /CRITICAL PRIVACY VIOLATION/.test(e)));
  });
});

// =============================================================================
// PART 4 — REAL BROWSER VERIFICATION (CHROMIUM / EDGE)
// =============================================================================

describe('Part 4 — Real Browser Verification (Chromium/Edge)', () => {
  let env;

  test.before(async () => {
    env = await createTestEnvironment({ port: 3343 });
  });

  test.after(async () => {
    if (env) await env.teardown();
  });

  test('Browser-1: Real Chromium/Edge executes sankalpa-vault-lifecycle.js with real WebCrypto & IndexedDB key handles and survives page.reload()', async () => {
    const inst = await env.createInstrumentedPage();
    try {
      await inst.page.goto(`${env.baseUrl}/index.html`, { waitUntil: 'networkidle0' });

      const pass1 = await inst.page.evaluate(async () => {
        const mod = await import('/assets/sdk/sankalpa-vault-lifecycle.js');
        const vm = mod.createSankalpaVaultManager({ scopeId: 'browser_alice' });
        const unlock1 = await vm.unlock();

        // Write 5 entries concurrently -> verify unique IVs
        const writes = await Promise.all([
          vm.putEntry('b_1', { intention: 'BROWSER_SECRET_ONE_ॐ' }),
          vm.putEntry('b_2', { intention: 'BROWSER_SECRET_TWO' }),
          vm.putEntry('b_3', { intention: 'BROWSER_SECRET_THREE' }),
          vm.putEntry('b_4', { intention: 'BROWSER_SECRET_FOUR' }),
          vm.putEntry('b_5', { intention: 'BROWSER_SECRET_FIVE' })
        ]);
        const uniqueIvs = new Set(writes.map((w) => w.ivHex)).size;

        // Inspect raw IndexedDB directly to confirm non-extractable key & zero plaintext!
        const dbCheck = await new Promise((resolve, reject) => {
          const req = indexedDB.open(mod.SANKALPA_VAULT_DB_NAME, mod.SANKALPA_VAULT_DB_VERSION);
          req.onerror = () => reject(req.error);
          req.onsuccess = async () => {
            const db = req.result;
            try {
              const keyRec = await new Promise((res, rej) => {
                const tx = db.transaction(mod.SANKALPA_KEY_STORE_NAME, 'readonly');
                const r = tx.objectStore(mod.SANKALPA_KEY_STORE_NAME).get('sankalpa_key::browser_alice');
                r.onsuccess = () => res(r.result);
                r.onerror = () => rej(r.error);
              });
              let exportBlocked = false;
              try {
                await crypto.subtle.exportKey('raw', keyRec.key);
              } catch {
                exportBlocked = true;
              }
              const entriesRaw = await new Promise((res, rej) => {
                const tx = db.transaction(mod.SANKALPA_VAULT_STORE_NAME, 'readonly');
                const r = tx.objectStore(mod.SANKALPA_VAULT_STORE_NAME).getAll();
                r.onsuccess = () => res(r.result);
                r.onerror = () => rej(r.error);
              });
              const rawStr = JSON.stringify(entriesRaw);
              resolve({
                keyExtractable: keyRec.key.extractable,
                exportBlocked,
                entryCount: entriesRaw.length,
                leaksPlaintext: rawStr.includes('BROWSER_SECRET_')
              });
            } finally {
              db.close();
            }
          };
        });

        vm.dispose();
        return { created: unlock1.created, uniqueIvs, dbCheck };
      });

      assert.equal(pass1.created, true);
      assert.equal(pass1.uniqueIvs, 5);
      assert.equal(pass1.dbCheck.keyExtractable, false);
      assert.equal(pass1.dbCheck.exportBlocked, true);
      assert.equal(pass1.dbCheck.entryCount, 5);
      assert.equal(pass1.dbCheck.leaksPlaintext, false);

      // Full real page reload -> verify IndexedDB persisted key handle decrypts all 5 entries!
      await inst.page.reload({ waitUntil: 'networkidle0' });

      const pass2 = await inst.page.evaluate(async () => {
        const mod = await import('/assets/sdk/sankalpa-vault-lifecycle.js');
        const vm = mod.createSankalpaVaultManager({ scopeId: 'browser_alice' });
        const unlock2 = await vm.unlock();
        const entry1 = await vm.getEntry('b_1');
        const all = await vm.listEntries();

        // Export PBKDF2-210k backup & import non-destructively into browser_bob (which already has b_1)
        const backup = await vm.exportBackup('BrowserPassphrase#2026');
        vm.switchAccount('browser_bob');
        await vm.unlock('browser_bob');
        await vm.putEntry('b_1', { intention: 'BOB_EXISTING_VALID_ENTRY' });
        const impRes = await vm.importBackup('BrowserPassphrase#2026', backup);
        const bobOrig = await vm.getEntry('b_1');
        const bobRecovered = await vm.getEntry('b_1__recovered_1');

        vm.dispose();
        return {
          createdOnReload: unlock2.created,
          entry1Text: entry1.intention,
          totalReloaded: all.length,
          backupIterations: backup.iterations,
          impRes,
          bobOrig: bobOrig.intention,
          bobRecovered: bobRecovered.intention
        };
      });

      assert.equal(pass2.createdOnReload, false);
      assert.equal(pass2.entry1Text, 'BROWSER_SECRET_ONE_ॐ');
      assert.equal(pass2.totalReloaded, 5);
      assert.equal(pass2.backupIterations, 210000);
      assert.equal(pass2.impRes.importedCount, 5);
      assert.equal(pass2.impRes.preservedExistingCount, 1);
      assert.equal(pass2.bobOrig, 'BOB_EXISTING_VALID_ENTRY');
      assert.equal(pass2.bobRecovered, 'BROWSER_SECRET_ONE_ॐ');

      const fatalErrors = inst.consoleErrors.filter((e) => e.type === 'pageerror' || !/504 \(Offline\)|Failed to load resource/i.test(e.text));
      assert.equal(fatalErrors.length, 0, `Unexpected browser console errors: ${JSON.stringify(fatalErrors)}`);
    } finally {
      await inst.close();
    }
  });

  test('Browser-2: Two real Chromium/Edge tabs coordinate Sankalpa lock via BroadcastChannel with zero secret leakage', async () => {
    const context = await env.browser.createBrowserContext();
    const page1 = await context.newPage();
    const page2 = await context.newPage();
    try {
      await Promise.all([
        page1.goto(`${env.baseUrl}/index.html`, { waitUntil: 'networkidle0' }),
        page2.goto(`${env.baseUrl}/index.html`, { waitUntil: 'networkidle0' })
      ]);

      // Unlock vault in Tab 1, write secret, then unlock in Tab 2 and attach BroadcastChannel spy
      await page1.evaluate(async () => {
        const mod = await import('/assets/sdk/sankalpa-vault-lifecycle.js');
        window.__vm1 = mod.createSankalpaVaultManager({ scopeId: 'two_tab_user' });
        await window.__vm1.unlock();
        await window.__vm1.putEntry('shared_1', { text: 'TWO_TAB_SACRED_SECRET' });
      });

      const tab2Before = await page2.evaluate(async () => {
        const mod = await import('/assets/sdk/sankalpa-vault-lifecycle.js');
        window.__bcObserved = [];
        window.__spyBc = new BroadcastChannel(mod.SANKALPA_VAULT_CHANNEL_NAME);
        window.__spyBc.onmessage = (evt) => window.__bcObserved.push(evt.data);

        window.__vm2 = mod.createSankalpaVaultManager({ scopeId: 'two_tab_user' });
        await window.__vm2.unlock();
        const entry = await window.__vm2.getEntry('shared_1');
        return { unlocked: window.__vm2.getStatus().unlocked, text: entry.text };
      });

      assert.equal(tab2Before.unlocked, true);
      assert.equal(tab2Before.text, 'TWO_TAB_SACRED_SECRET');

      // Lock in Tab 1 -> Tab 2 MUST automatically lock via BroadcastChannel signal
      await page1.evaluate(() => {
        window.__vm1.lock();
      });

      await page2.waitForFunction(() => window.__vm2 && window.__vm2.getStatus().unlocked === false, { timeout: 5000 });

      const tab2After = await page2.evaluate(() => {
        const status = window.__vm2.getStatus();
        const messages = window.__bcObserved;
        window.__spyBc.close();
        window.__vm2.dispose();
        return { status, messages };
      });
      await page1.evaluate(() => {
        window.__vm1.dispose();
      });

      assert.equal(tab2After.status.unlocked, false);
      assert.ok(tab2After.messages.some((m) => m.signal === 'locked'));
      const wireDump = JSON.stringify(tab2After.messages);
      assert.equal(wireDump.includes('TWO_TAB_SACRED_SECRET'), false);
      assert.equal(wireDump.includes('ivHex'), false);
      assert.equal(wireDump.includes('ciphertextHex'), false);
    } finally {
      await page1.close();
      await page2.close();
      await context.close();
    }
  });
});
