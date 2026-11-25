/**
 * B19.5-10 — Backup and Disaster Recovery Behavioral Test Suite (Hardened)
 *
 * Validates:
 * 1. Multi-indicator production safety guards (flags, environments, hostnames).
 * 2. Path traversal defenses on backup and restore file paths.
 * 3. Privacy compliance: Fails closed if Sankalpa or Auth secrets are detected in dumps.
 * 4. Structural completeness verification (rejects truncated dumps).
 * 5. Atomic file writing and permissions.
 * 6. Strict manifest verification: Rejects missing, malformed, or mismatched manifests.
 * 7. Transaction compatibility: Detects non-transactional statements and prevents invalid BEGIN/COMMIT wrapping.
 * 8. Error handling: Missing binaries, corrupted dumps, and runner failures fail closed.
 * 9. SLA honesty: RPO/RTO reported as unverified targets without fabricated measurements.
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';

import {
  isProductionTarget,
  validateBackupConfiguration,
  verifyDumpPrivacyCompliance,
  verifyDumpStructuralCompleteness,
  generateBackupManifest,
  executeDatabaseBackup,
  redactConnectionString,
  ALLOWED_TABLES,
  EXCLUDED_TABLES
} from './scripts/backup-database.mjs';

import {
  validateRestoreConfiguration,
  validateManifestAndIntegrity,
  checkTransactionCompatibility,
  prepareRestoreSql,
  executeDatabaseRestore,
  parseRestoreCliArgs
} from './scripts/restore-database.mjs';

const TEST_TMP_DIR = path.join(process.cwd(), '.tmp_test_backup_dr_hardened');

describe('B19.5-10: Production Safety Guards & Target Detection', () => {

  test('10.1: Multi-indicator production detection catches targets, env vars, and hostnames', () => {
    // 1. Explicit target name
    assert.equal(isProductionTarget({ target: 'production' }), true);
    assert.equal(isProductionTarget({ target: 'prod' }), true);

    // 2. Environment variables
    assert.equal(isProductionTarget({ env: { NODE_ENV: 'production' } }), true);
    assert.equal(isProductionTarget({ env: { DB_ENV: 'production' } }), true);

    // 3. Supabase hostnames
    assert.equal(isProductionTarget({ connectionString: 'postgresql://postgres:pwd@db.abcxyz.supabase.co:5432/postgres' }), true);
    assert.equal(isProductionTarget({ connectionString: 'postgres://app:pwd@prod-cluster.internal.db:5432/main' }), true);

    // 4. Local / development target is not production
    assert.equal(isProductionTarget({ target: 'development', connectionString: 'postgresql://postgres:pwd@localhost:54322/postgres', env: {} }), false);
  });

  test('10.2: Refuses to target production database; forceProduction never authorizes restore', () => {
    const resBackup = validateBackupConfiguration({ target: 'production', forceProduction: false });
    assert.equal(resBackup.allowed, false);
    assert.equal(resBackup.errorCode, 'ERR_PRODUCTION_GUARD_TRIGGERED');

    const resRestore = validateRestoreConfiguration({
      target: 'production',
      backupFile: 'backup.sql',
      forceProduction: false
    });
    assert.equal(resRestore.allowed, false);
    assert.equal(resRestore.errorCode, 'ERR_PRODUCTION_GUARD_TRIGGERED');

    // Passing forceProduction: true allows target for backup
    const allowedBackup = validateBackupConfiguration({ target: 'production', forceProduction: true });
    assert.equal(allowedBackup.allowed, true);

    // BUT forceProduction: true NEVER authorizes restore to production
    const forbiddenRestore = validateRestoreConfiguration({
      target: 'production',
      backupFile: 'backup.sql',
      forceProduction: true
    });
    assert.equal(forbiddenRestore.allowed, false);
    assert.equal(forbiddenRestore.errorCode, 'ERR_PRODUCTION_RESTORE_FORBIDDEN');
  });

  test('10.2b: Ambiguous targets rejected and actual restore requires disposable target confirmation', () => {
    // 1. Ambiguous target rejected
    const resAmbiguous = validateRestoreConfiguration({
      target: '',
      backupFile: 'backup.sql'
    });
    assert.equal(resAmbiguous.allowed, false);
    assert.equal(resAmbiguous.errorCode, 'ERR_AMBIGUOUS_DATABASE_TARGET');

    const resUnknown = validateRestoreConfiguration({
      target: 'unspecified',
      backupFile: 'backup.sql'
    });
    assert.equal(resUnknown.allowed, false);
    assert.equal(resUnknown.errorCode, 'ERR_AMBIGUOUS_DATABASE_TARGET');

    // 2. Non-dry-run restore requires explicit disposable target confirmation
    const resNoConfirm = validateRestoreConfiguration({
      target: 'development',
      backupFile: 'backup.sql',
      confirmDisposableTarget: false,
      dryRun: false
    });
    assert.equal(resNoConfirm.allowed, false);
    assert.equal(resNoConfirm.errorCode, 'ERR_DISPOSABLE_TARGET_CONFIRMATION_REQUIRED');

    // 3. Dry-run allows preflight without disposable confirmation
    const resDryRun = validateRestoreConfiguration({
      target: 'development',
      backupFile: 'backup.sql',
      dryRun: true
    });
    assert.equal(resDryRun.allowed, true);

    // 4. Generic boolean rejected as unverified confirmation
    const resBoolConfirm = validateRestoreConfiguration({
      target: 'development',
      backupFile: 'backup.sql',
      confirmDisposableTarget: true
    });
    assert.equal(resBoolConfirm.allowed, false);
    assert.equal(resBoolConfirm.errorCode, 'ERR_TARGET_CONFIRMATION_MISMATCH');

    // 5. Explicitly confirmed matching disposable target allowed
    const resConfirmed = validateRestoreConfiguration({
      target: 'development',
      backupFile: 'backup.sql',
      confirmDisposableTarget: 'development'
    });
    assert.equal(resConfirmed.allowed, true);
  });

  test('10.3: Path traversal sequences are blocked on backup and restore paths', () => {
    const resTraverse = validateRestoreConfiguration({
      target: 'development',
      backupFile: '../outside/malicious.sql',
      forceProduction: false
    });
    assert.equal(resTraverse.allowed, false);
    assert.equal(resTraverse.errorCode, 'ERR_PATH_TRAVERSAL_DETECTED');
  });

});

describe('B19.5-10: Privacy Compliance & Structural Verification', () => {

  test('10.4: Dump privacy verification fails closed on leaked Sankalpa or Auth secrets', () => {
    // 1. Clean public schema dump passes
    const cleanSql = `
CREATE TABLE public.game_saves (user_id text, game_id text, score integer);
COPY public.game_saves (user_id, game_id, score) FROM stdin;
usr_1\tvak\t1000
\\.
    `;
    const cleanRes = verifyDumpPrivacyCompliance(cleanSql);
    assert.equal(cleanRes.compliant, true);

    // 2. Leaked Sankalpa notes detected and rejected
    const sankalpaSql = cleanSql + '\nINSERT INTO public.sankalpa_notes VALUES (1, "Sacred");';
    const sankalpaRes = verifyDumpPrivacyCompliance(sankalpaSql);
    assert.equal(sankalpaRes.compliant, false);
    assert.equal(sankalpaRes.reason, 'FORBIDDEN_DATA_LEAK_DETECTED');

    // 3. Leaked auth.users detected and rejected
    const authSql = cleanSql + '\nCOPY auth.users FROM stdin;\nusr_1\tpassword_hash\t\\.';
    const authRes = verifyDumpPrivacyCompliance(authSql);
    assert.equal(authRes.compliant, false);
    assert.equal(authRes.reason, 'FORBIDDEN_DATA_LEAK_DETECTED');
  });

  test('10.5: Truncated or incomplete dump fails structural completeness check', () => {
    const emptyCheck = verifyDumpStructuralCompleteness('');
    assert.equal(emptyCheck.complete, false);

    const garbageCheck = verifyDumpStructuralCompleteness('random unfinished garbage without sql');
    assert.equal(garbageCheck.complete, false);

    const validCheck = verifyDumpStructuralCompleteness('CREATE TABLE public.entitlements (id text);');
    assert.equal(validCheck.complete, true);
  });

  test('10.6: Connection string credentials are redacted from logs and errors', () => {
    const connStr = 'postgresql://admin:super_secret_password_123@db.supabase.co:5432/postgres';
    const redacted = redactConnectionString(connStr);
    assert.equal(redacted.includes('super_secret_password_123'), false);
    assert.equal(redacted, 'postgresql://admin:***@db.supabase.co:5432/postgres');
  });

});

describe('B19.5-10: Strict Manifest Validation & Restore Atomicity', () => {

  test('10.7: Missing, malformed, or mismatched manifests are strictly rejected', () => {
    if (!fs.existsSync(TEST_TMP_DIR)) {
      fs.mkdirSync(TEST_TMP_DIR, { recursive: true });
    }

    const testBackup = path.join(TEST_TMP_DIR, 'test_backup.sql');
    fs.writeFileSync(testBackup, 'CREATE TABLE test (id int);', 'utf8');

    // 1. Missing manifest
    const missingRes = validateManifestAndIntegrity(testBackup, path.join(TEST_TMP_DIR, 'non_existent.manifest.json'));
    assert.equal(missingRes.valid, false);
    assert.equal(missingRes.errorCode, 'ERR_MISSING_MANIFEST');

    // 2. Malformed JSON manifest
    const badManifestPath = path.join(TEST_TMP_DIR, 'bad.manifest.json');
    fs.writeFileSync(badManifestPath, '{ invalid json', 'utf8');
    const badJsonRes = validateManifestAndIntegrity(testBackup, badManifestPath);
    assert.equal(badJsonRes.valid, false);
    assert.equal(badJsonRes.errorCode, 'ERR_MALFORMED_MANIFEST');

    // 3. Mismatched file size
    const manifestMismatch = {
      manifestVersion: '1.0',
      backupFile: 'test_backup.sql',
      fileSize: 999999, // Wrong size
      checksum: 'a'.repeat(64),
      checksumAlgorithm: 'SHA-256'
    };
    const mismatchPath = path.join(TEST_TMP_DIR, 'mismatch.manifest.json');
    fs.writeFileSync(mismatchPath, JSON.stringify(manifestMismatch), 'utf8');
    const sizeRes = validateManifestAndIntegrity(testBackup, mismatchPath);
    assert.equal(sizeRes.valid, false);
    assert.equal(sizeRes.errorCode, 'ERR_FILE_SIZE_MISMATCH');

    // 4. Missing backupFile field
    const noBackupFile = {
      manifestVersion: '1.0',
      fileSize: 26,
      checksum: 'a'.repeat(64),
      checksumAlgorithm: 'SHA-256'
    };
    const noBackupFilePath = path.join(TEST_TMP_DIR, 'no_file.manifest.json');
    fs.writeFileSync(noBackupFilePath, JSON.stringify(noBackupFile), 'utf8');
    const noFileRes = validateManifestAndIntegrity(testBackup, noBackupFilePath);
    assert.equal(noFileRes.valid, false);
    assert.equal(noFileRes.errorCode, 'ERR_MISSING_MANIFEST_FIELD');

    // 5. Missing or invalid fileSize
    const badFileSize = {
      manifestVersion: '1.0',
      backupFile: 'test_backup.sql',
      fileSize: NaN,
      checksum: 'a'.repeat(64),
      checksumAlgorithm: 'SHA-256'
    };
    const badFileSizePath = path.join(TEST_TMP_DIR, 'bad_size.manifest.json');
    fs.writeFileSync(badFileSizePath, JSON.stringify(badFileSize), 'utf8');
    const badSizeRes = validateManifestAndIntegrity(testBackup, badFileSizePath);
    assert.equal(badSizeRes.valid, false);
    assert.equal(badSizeRes.errorCode, 'ERR_MISSING_MANIFEST_FIELD');

    // 6. Invalid checksum format (not 64 hex chars)
    const badChecksum = {
      manifestVersion: '1.0',
      backupFile: 'test_backup.sql',
      fileSize: 26,
      checksum: 'not_64_hex_characters',
      checksumAlgorithm: 'SHA-256'
    };
    const badChecksumPath = path.join(TEST_TMP_DIR, 'bad_hash.manifest.json');
    fs.writeFileSync(badChecksumPath, JSON.stringify(badChecksum), 'utf8');
    const badHashRes = validateManifestAndIntegrity(testBackup, badChecksumPath);
    assert.equal(badHashRes.valid, false);
    assert.equal(badHashRes.errorCode, 'ERR_INVALID_CHECKSUM_FORMAT');
  });

  test('10.8: Checksum mismatch detects tampered backup dumps', () => {
    const testBackup = path.join(TEST_TMP_DIR, 'tamper_test.sql');
    const content = 'CREATE TABLE valid_table (id int);';
    fs.writeFileSync(testBackup, content, 'utf8');

    const manifestData = {
      manifestVersion: '1.0',
      backupFile: 'tamper_test.sql',
      fileSize: Buffer.byteLength(content, 'utf8'),
      checksum: '0'.repeat(64), // Bogus hash
      checksumAlgorithm: 'SHA-256'
    };
    const manifestPath = path.join(TEST_TMP_DIR, 'tamper_test.manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifestData), 'utf8');

    const res = validateManifestAndIntegrity(testBackup, manifestPath);
    assert.equal(res.valid, false);
    assert.equal(res.errorCode, 'ERR_CHECKSUM_MISMATCH');
  });

  test('10.9: Transaction compatibility safely handles non-transactional statements', () => {
    // 1. DDL with CREATE INDEX CONCURRENTLY cannot be wrapped in BEGIN/COMMIT
    const concurrentSql = 'CREATE INDEX CONCURRENTLY idx_foo ON foo (bar);';
    const compat1 = checkTransactionCompatibility(concurrentSql);
    assert.equal(compat1.canWrapInTransaction, false);

    const prep1 = prepareRestoreSql(concurrentSql);
    assert.equal(prep1.wrappedInTransaction, false);
    assert.equal(prep1.sql.includes('BEGIN;'), false);

    // 2. Standard transactional DDL is safely wrapped
    const standardSql = 'CREATE TABLE foo (bar int);';
    const compat2 = checkTransactionCompatibility(standardSql);
    assert.equal(compat2.canWrapInTransaction, true);

    const prep2 = prepareRestoreSql(standardSql);
    assert.equal(prep2.wrappedInTransaction, true);
    assert.ok(prep2.sql.startsWith('BEGIN;'));
  });

  test('10.10: Manifest documents RPO/RTO as unverified targets without fabricated claims', async () => {
    const mockDumpSql = 'CREATE TABLE public.user_profiles (id text);';
    const backupResult = await executeDatabaseBackup({
      target: 'development',
      outputDir: TEST_TMP_DIR,
      runner: async () => ({ ok: true, dumpContent: mockDumpSql })
    });

    assert.equal(backupResult.ok, true);
    assert.ok(fs.existsSync(backupResult.manifestFile));

    const manifest = JSON.parse(fs.readFileSync(backupResult.manifestFile, 'utf8'));
    assert.equal(manifest.slaTargets.measurementStatus, 'UNVERIFIED_TARGET');
    assert.equal(manifest.slaTargets.rpoTarget, '24h');
    assert.equal(manifest.slaTargets.rtoTarget, '15m');
  });

});

describe('B19.5-10: Restore CLI Confirmation & Execution Defenses', () => {

  test('10.11: parseRestoreCliArgs correctly parses flags and isolates unknown arguments', () => {
    const args = [
      '--file=backups/test.sql',
      '--manifest=backups/test.manifest.json',
      '--target=disposable_test',
      '--confirm-disposable-target=disposable_test',
      '--dry-run',
      '--force-production',
      '--malicious-flag',
      '--another-unknown=true'
    ];
    const parsed = parseRestoreCliArgs(args);
    assert.equal(parsed.backupFile, 'backups/test.sql');
    assert.equal(parsed.manifestFile, 'backups/test.manifest.json');
    assert.equal(parsed.target, 'disposable_test');
    assert.equal(parsed.confirmDisposableTarget, 'disposable_test');
    assert.equal(parsed.dryRun, true);
    assert.equal(parsed.forceProduction, true);
    assert.deepEqual(parsed.unknownArgs, ['--malicious-flag', '--another-unknown=true']);
  });

  test('10.12: Unknown CLI arguments cause restore execution to fail closed', async () => {
    const res = await executeDatabaseRestore({
      unknownArgs: ['--unexpected-option']
    });
    assert.equal(res.ok, false);
    assert.equal(res.errorCode, 'ERR_UNKNOWN_CLI_ARGUMENT');
    assert.ok(res.message.includes('--unexpected-option'));
  });

  test('10.13: Missing disposable target confirmation rejects non-dry-run restore', async () => {
    const res = await executeDatabaseRestore({
      target: 'disposable_test',
      backupFile: 'test.sql',
      confirmDisposableTarget: false,
      dryRun: false
    });
    assert.equal(res.ok, false);
    assert.equal(res.errorCode, 'ERR_DISPOSABLE_TARGET_CONFIRMATION_REQUIRED');
  });

  test('10.14: Confirmed disposable target with valid manifest and runner succeeds', async () => {
    if (!fs.existsSync(TEST_TMP_DIR)) fs.mkdirSync(TEST_TMP_DIR, { recursive: true });
    const backupPath = path.join(TEST_TMP_DIR, 'valid_restore.sql');
    const content = 'CREATE TABLE public.game_saves (user_id text, game_id text, score integer);';
    fs.writeFileSync(backupPath, content, 'utf8');

    const manifestData = {
      manifestVersion: '1.0',
      backupFile: path.basename(backupPath),
      fileSize: Buffer.byteLength(content, 'utf8'),
      checksum: crypto.createHash('sha256').update(content, 'utf8').digest('hex'),
      checksumAlgorithm: 'SHA-256'
    };
    const manifestPath = path.join(TEST_TMP_DIR, 'valid_restore.manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifestData), 'utf8');

    let runnerExecuted = false;
    const res = await executeDatabaseRestore({
      target: 'disposable_test',
      backupFile: path.relative(process.cwd(), backupPath),
      manifestFile: path.relative(process.cwd(), manifestPath),
      confirmDisposableTarget: 'disposable_test',
      dryRun: false,
      runner: async () => {
        runnerExecuted = true;
        return { status: 0, stderr: '' };
      }
    });

    assert.equal(res.ok, true);
    assert.equal(runnerExecuted, true);
    assert.equal(res.checksumVerified, true);
  });

  test('10.14b: Generic boolean and mismatched target confirmations fail closed without invoking runner', async () => {
    let runnerExecuted = false;
    const dummyRunner = async () => {
      runnerExecuted = true;
      return { status: 0 };
    };

    // 1. Generic boolean confirmation fails closed
    const resBool = await executeDatabaseRestore({
      target: 'disposable_test',
      backupFile: 'test.sql',
      confirmDisposableTarget: true,
      runner: dummyRunner
    });
    assert.equal(resBool.ok, false);
    assert.equal(resBool.errorCode, 'ERR_TARGET_CONFIRMATION_MISMATCH');
    assert.equal(runnerExecuted, false);

    // 2. Mismatched target name fails closed
    const resMismatch = await executeDatabaseRestore({
      target: 'disposable_test',
      backupFile: 'test.sql',
      confirmDisposableTarget: 'staging_db',
      runner: dummyRunner
    });
    assert.equal(resMismatch.ok, false);
    assert.equal(resMismatch.errorCode, 'ERR_TARGET_CONFIRMATION_MISMATCH');
    assert.equal(runnerExecuted, false);

    // 3. Conflicting CLI arguments fail closed
    const conflictingParsed = parseRestoreCliArgs([
      '--file=backup_a.sql',
      '--file=backup_b.sql'
    ]);
    assert.ok(conflictingParsed.conflictingArgs.length > 0);
    const resConflict = await executeDatabaseRestore({
      ...conflictingParsed,
      runner: dummyRunner
    });
    assert.equal(resConflict.ok, false);
    assert.equal(resConflict.errorCode, 'ERR_CONFLICTING_CLI_ARGUMENTS');
    assert.equal(runnerExecuted, false);
  });

  test('10.15: Dry run validates manifest and integrity without executing runner', async () => {
    if (!fs.existsSync(TEST_TMP_DIR)) fs.mkdirSync(TEST_TMP_DIR, { recursive: true });
    const backupPath = path.join(TEST_TMP_DIR, 'dry_run_test.sql');
    const content = 'CREATE TABLE public.game_saves (user_id text, game_id text, score integer);';
    fs.writeFileSync(backupPath, content, 'utf8');

    const manifestData = {
      manifestVersion: '1.0',
      backupFile: path.basename(backupPath),
      fileSize: Buffer.byteLength(content, 'utf8'),
      checksum: crypto.createHash('sha256').update(content, 'utf8').digest('hex'),
      checksumAlgorithm: 'SHA-256'
    };
    const manifestPath = path.join(TEST_TMP_DIR, 'dry_run_test.manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifestData), 'utf8');

    let runnerExecuted = false;
    const res = await executeDatabaseRestore({
      target: 'disposable_test',
      backupFile: path.relative(process.cwd(), backupPath),
      manifestFile: path.relative(process.cwd(), manifestPath),
      confirmDisposableTarget: false, // Not required for dry-run
      dryRun: true,
      runner: async () => {
        runnerExecuted = true;
        return { status: 0 };
      }
    });

    assert.equal(res.ok, true);
    assert.equal(res.dryRun, true);
    assert.equal(runnerExecuted, false, 'Dry run must never execute the restore runner');
  });

  test('10.16: Force production flag never authorizes production restore', async () => {
    const res = await executeDatabaseRestore({
      target: 'production',
      backupFile: 'backup.sql',
      forceProduction: true,
      confirmDisposableTarget: true
    });
    assert.equal(res.ok, false);
    assert.equal(res.errorCode, 'ERR_PRODUCTION_RESTORE_FORBIDDEN');
  });

  test('10.17: Manifest and backup path traversal escapes approved workspace and fails closed', () => {
    // 1. Parent path traversal
    const resBackupTraverse = validateRestoreConfiguration({
      target: 'development',
      backupFile: '../../etc/passwd.sql',
      confirmDisposableTarget: 'development'
    });
    assert.equal(resBackupTraverse.allowed, false);
    assert.equal(resBackupTraverse.errorCode, 'ERR_PATH_TRAVERSAL_DETECTED');

    const resManifestTraverse = validateManifestAndIntegrity('valid.sql', '../../etc/passwd.manifest.json');
    assert.equal(resManifestTraverse.valid, false);
    assert.equal(resManifestTraverse.errorCode, 'ERR_PATH_TRAVERSAL_DETECTED');

    // 2. Sibling directory prefix breakout
    const cwd = process.cwd();
    const siblingDirBreakout = path.join(path.dirname(cwd), path.basename(cwd) + '_evil', 'backup.sql');
    const resSibling = validateRestoreConfiguration({
      target: 'development',
      backupFile: siblingDirBreakout,
      confirmDisposableTarget: 'development'
    });
    assert.equal(resSibling.allowed, false);
    assert.equal(resSibling.errorCode, 'ERR_PATH_TRAVERSAL_DETECTED');
  });

  test('10.18: Adversarial restore safety: symlink escape, runner failure, and connection string credential sanitization', async () => {
    // 1. Conflicting CLI arguments fail closed
    const cliConflict = await executeDatabaseRestore({
      target: 'development',
      backupFile: 'backup.sql',
      conflictingArgs: ["Conflicting values for target: 'dev' vs 'staging'"]
    });
    assert.equal(cliConflict.ok, false);
    assert.equal(cliConflict.errorCode, 'ERR_CONFLICTING_CLI_ARGUMENTS');

    // 2. Runner failure does not report success and sanitizes credentials
    if (!fs.existsSync(TEST_TMP_DIR)) fs.mkdirSync(TEST_TMP_DIR, { recursive: true });
    const testDump = path.join(TEST_TMP_DIR, 'failing_runner.sql');
    const testManifest = path.join(TEST_TMP_DIR, 'failing_runner.manifest.json');
    const dumpSql = 'CREATE TABLE test (id text);';
    fs.writeFileSync(testDump, dumpSql, 'utf8');
    const checksum = crypto.createHash('sha256').update(dumpSql, 'utf8').digest('hex');
    const manifest = {
      manifestVersion: '1.0',
      backupFile: 'failing_runner.sql',
      fileSize: Buffer.byteLength(dumpSql, 'utf8'),
      checksumAlgorithm: 'SHA-256',
      checksum,
      createdAt: new Date().toISOString()
    };
    fs.writeFileSync(testManifest, JSON.stringify(manifest), 'utf8');

    const failingRes = await executeDatabaseRestore({
      target: 'development',
      confirmDisposableTarget: 'development',
      backupFile: testDump,
      manifestFile: testManifest,
      connectionString: 'postgresql://postgres:SuperSecretPassword123@db.example.com:5432/postgres',
      runner: async () => {
        return { ok: false, errorCode: 'ERR_RUNNER_CRASH', message: 'Connection to postgresql://postgres:SuperSecretPassword123@db.example.com:5432/postgres refused' };
      }
    });

    assert.equal(failingRes.ok, false);
    assert.equal(failingRes.errorCode, 'ERR_RUNNER_CRASH');
    assert.ok(!failingRes.message.includes('SuperSecretPassword123'), 'Connection string credentials must be redacted in runner failure message');
    assert.ok(failingRes.message.includes('[REDACTED]'), 'Redacted token must be present in failure message');

    // 3. Real symlink / junction breakout: external directory outside approved workspace must fail closed
    const outsideTargetDir = path.join(os.tmpdir(), `outside_restore_${Date.now()}`);
    fs.mkdirSync(outsideTargetDir, { recursive: true });
    const outsideDump = path.join(outsideTargetDir, 'outside_escaped.sql');
    const dumpContent = 'CREATE TABLE escaped_test (id int);';
    fs.writeFileSync(outsideDump, dumpContent, 'utf8');
    const outsideChecksum = crypto.createHash('sha256').update(dumpContent, 'utf8').digest('hex');
    const outsideManifest = path.join(outsideTargetDir, 'outside_escaped.manifest.json');
    fs.writeFileSync(outsideManifest, JSON.stringify({
      manifestVersion: '1.0',
      backupFile: 'outside_escaped.sql',
      fileSize: Buffer.byteLength(dumpContent, 'utf8'),
      checksumAlgorithm: 'SHA-256',
      checksum: outsideChecksum,
      createdAt: new Date().toISOString()
    }), 'utf8');

    const junctionLink = path.join(TEST_TMP_DIR, 'symlink_breakout_link');
    try {
      try {
        fs.symlinkSync(outsideTargetDir, junctionLink, 'junction');
      } catch {
        fs.symlinkSync(outsideTargetDir, junctionLink, 'dir');
      }

      const escapedDumpPath = path.join(junctionLink, 'outside_escaped.sql');
      const escapedManifestPath = path.join(junctionLink, 'outside_escaped.manifest.json');

      const escapeRes = await executeDatabaseRestore({
        target: 'development',
        confirmDisposableTarget: 'development',
        backupFile: escapedDumpPath,
        manifestFile: escapedManifestPath
      });

      assert.equal(escapeRes.ok, false);
      assert.equal(escapeRes.errorCode, 'ERR_PATH_TRAVERSAL_DETECTED');
      assert.ok(escapeRes.message.includes('escape the approved workspace'));
    } finally {
      try { fs.unlinkSync(junctionLink); } catch {}
      try { fs.rmSync(outsideTargetDir, { recursive: true, force: true }); } catch {}
    }
  });

  test.after(() => {
    try {
      if (fs.existsSync(TEST_TMP_DIR)) {
        fs.rmSync(TEST_TMP_DIR, { recursive: true, force: true });
      }
    } catch {}
  });

});
