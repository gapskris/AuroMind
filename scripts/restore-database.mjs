/**
 * AuroMasti Platform — Database Restore Automation & Integrity Verification
 *
 * Implements:
 * 1. Safe PostgreSQL database restoration with manifest validation.
 * 2. Multi-indicator production safety guard requiring explicit `--force-production`.
 * 3. Strict Pre-Restore Verification:
 *    - Validates manifest presence, version, file size, algorithm, and filename binding.
 *    - Computes and verifies SHA-256 checksum (fails closed on mismatch or corruption).
 *    - Rejects path traversal and malformed inputs.
 * 4. DDL transaction compatibility inspection (guards against wrapping non-transactional statements).
 * 5. Fails closed on missing binaries or non-zero execution exit codes.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { isProductionTarget } from './backup-database.mjs';

/**
 * Validates whether the restore operation is safe for the targeted environment.
 */
export function validateRestoreConfiguration({
  target = 'development',
  connectionString = '',
  forceProduction = false,
  backupFile = ''
} = {}) {
  if (!backupFile) {
    return {
      allowed: false,
      errorCode: 'ERR_MISSING_BACKUP_FILE',
      message: 'A backup SQL file must be specified for restoration.'
    };
  }

  // Prevent path traversal
  const normalizedBackupFile = path.normalize(backupFile);
  if (normalizedBackupFile.includes('..')) {
    return {
      allowed: false,
      errorCode: 'ERR_PATH_TRAVERSAL_DETECTED',
      message: 'backupFile path cannot contain path traversal sequences (..).'
    };
  }

  const isProd = isProductionTarget({ target, connectionString });

  if (isProd && !forceProduction) {
    return {
      allowed: false,
      errorCode: 'ERR_PRODUCTION_GUARD_TRIGGERED',
      message: 'Refusing to restore to production database without explicit --force-production confirmation.'
    };
  }

  return {
    allowed: true,
    isProduction: isProd,
    target,
    backupFile: path.resolve(backupFile)
  };
}

/**
 * Validates the backup manifest and verifies SHA-256 integrity against the backup file.
 */
export function validateManifestAndIntegrity(backupFile, manifestFile = null) {
  if (!fs.existsSync(backupFile)) {
    return {
      valid: false,
      errorCode: 'ERR_BACKUP_FILE_NOT_FOUND',
      message: `Backup file does not exist at path: ${backupFile}`
    };
  }

  const fileContent = fs.readFileSync(backupFile, 'utf8');
  if (fileContent.length === 0) {
    return {
      valid: false,
      errorCode: 'ERR_BACKUP_FILE_EMPTY',
      message: 'Backup file is empty (0 bytes).'
    };
  }

  // Resolve manifest path
  const resolvedManifestPath = manifestFile || `${backupFile.replace(/\.sql$/, '')}.manifest.json`;
  if (!fs.existsSync(resolvedManifestPath)) {
    return {
      valid: false,
      errorCode: 'ERR_MISSING_MANIFEST',
      message: `Required manifest file not found at: ${resolvedManifestPath}`
    };
  }

  let manifestData;
  try {
    const rawManifest = fs.readFileSync(resolvedManifestPath, 'utf8');
    manifestData = JSON.parse(rawManifest);
  } catch (parseErr) {
    return {
      valid: false,
      errorCode: 'ERR_MALFORMED_MANIFEST',
      message: `Manifest parsing failed: ${parseErr.message}`
    };
  }

  // Validate manifest structure and fields
  if (!manifestData || typeof manifestData !== 'object') {
    return { valid: false, errorCode: 'ERR_MALFORMED_MANIFEST', message: 'Manifest is not an object.' };
  }
  if (manifestData.manifestVersion !== '1.0') {
    return { valid: false, errorCode: 'ERR_UNSUPPORTED_MANIFEST_VERSION', message: `Unsupported manifest version: ${manifestData.manifestVersion}` };
  }
  if (manifestData.checksumAlgorithm !== 'SHA-256' || !manifestData.checksum) {
    return { valid: false, errorCode: 'ERR_INVALID_CHECKSUM_ALGORITHM', message: 'Manifest must specify SHA-256 algorithm and checksum.' };
  }

  // Validate filename association
  const backupBasename = path.basename(backupFile);
  if (manifestData.backupFile && manifestData.backupFile !== backupBasename) {
    return {
      valid: false,
      errorCode: 'ERR_MANIFEST_FILENAME_MISMATCH',
      message: `Manifest specifies file '${manifestData.backupFile}', but target is '${backupBasename}'`
    };
  }

  // Validate file size
  const actualSize = Buffer.byteLength(fileContent, 'utf8');
  if (manifestData.fileSize !== undefined && manifestData.fileSize !== actualSize) {
    return {
      valid: false,
      errorCode: 'ERR_FILE_SIZE_MISMATCH',
      message: `File size mismatch: expected ${manifestData.fileSize} bytes, but found ${actualSize} bytes.`
    };
  }

  // Compute and verify actual SHA-256 checksum
  const actualChecksum = crypto.createHash('sha256').update(fileContent, 'utf8').digest('hex');
  if (actualChecksum.toLowerCase() !== manifestData.checksum.toLowerCase()) {
    return {
      valid: false,
      errorCode: 'ERR_CHECKSUM_MISMATCH',
      message: `Integrity check failed: expected ${manifestData.checksum}, calculated ${actualChecksum}`,
      actualChecksum,
      expectedChecksum: manifestData.checksum
    };
  }

  return {
    valid: true,
    actualChecksum,
    manifest: manifestData,
    fileSize: actualSize
  };
}

/**
 * Checks SQL content for statements that cannot run inside a transaction block.
 */
export function checkTransactionCompatibility(sqlContent) {
  const nonTransactionalPatterns = [
    /CREATE\s+INDEX\s+CONCURRENTLY/i,
    /DROP\s+INDEX\s+CONCURRENTLY/i,
    /VACUUM/i,
    /REINDEX\s+(?:DATABASE|SYSTEM)/i,
    /ALTER\s+TYPE\s+.*\s+ADD\s+VALUE/i
  ];

  for (const pat of nonTransactionalPatterns) {
    if (pat.test(sqlContent)) {
      return {
        canWrapInTransaction: false,
        reason: 'CONTAINS_NON_TRANSACTIONAL_STATEMENTS',
        pattern: pat.toString()
      };
    }
  }

  return { canWrapInTransaction: true };
}

/**
 * Safely prepares SQL for restore without breaking non-transactional statements.
 */
export function prepareRestoreSql(rawSql) {
  const trimmed = rawSql.trim();
  const compat = checkTransactionCompatibility(trimmed);

  if (!compat.canWrapInTransaction) {
    // Cannot wrap in BEGIN/COMMIT; return raw statements for individual execution
    return { sql: trimmed, wrappedInTransaction: false };
  }

  const hasBegin = /^BEGIN\s*;/im.test(trimmed);
  const hasCommit = /COMMIT\s*;/im.test(trimmed);
  if (hasBegin && hasCommit) {
    return { sql: trimmed, wrappedInTransaction: true };
  }

  return {
    sql: `BEGIN;\n\n${trimmed}\n\nCOMMIT;`,
    wrappedInTransaction: true
  };
}

/**
 * Executes database restore with strict manifest and checksum verification.
 */
export async function executeDatabaseRestore(options = {}) {
  const {
    target = 'development',
    connectionString = process.env.DATABASE_URL || '',
    forceProduction = false,
    backupFile = '',
    manifestFile = '',
    dryRun = false,
    runner = null
  } = options;

  // 1. Validate safety configuration
  const configCheck = validateRestoreConfiguration({
    target,
    connectionString,
    forceProduction,
    backupFile
  });

  if (!configCheck.allowed) {
    return {
      ok: false,
      errorCode: configCheck.errorCode,
      message: configCheck.message
    };
  }

  const resolvedBackupFile = configCheck.backupFile;

  // 2. Strict Manifest & Checksum Integrity Verification
  const integrity = validateManifestAndIntegrity(resolvedBackupFile, manifestFile);
  if (!integrity.valid) {
    return {
      ok: false,
      errorCode: integrity.errorCode,
      message: integrity.message
    };
  }

  const rawSql = fs.readFileSync(resolvedBackupFile, 'utf8');
  const prep = prepareRestoreSql(rawSql);

  // 3. Execute Restore
  if (runner) {
    const runResult = await runner({
      target,
      connectionString,
      sql: prep.sql,
      wrappedInTransaction: prep.wrappedInTransaction,
      options
    });
    if (!runResult.ok) {
      return {
        ok: false,
        errorCode: runResult.errorCode || 'ERR_RESTORE_EXECUTION_FAILED',
        message: runResult.message || 'Custom runner restore failed'
      };
    }
  } else {
    if (dryRun) {
      return {
        ok: true,
        dryRun: true,
        targetEnvironment: target,
        backupFile: resolvedBackupFile,
        checksum: integrity.actualChecksum,
        wrappedInTransaction: prep.wrappedInTransaction
      };
    }

    // Check psql availability
    try {
      const psqlCheck = spawnSync('psql', ['--version'], { encoding: 'utf8' });
      if (psqlCheck.error || psqlCheck.status !== 0) {
        return {
          ok: false,
          errorCode: 'ERR_PSQL_UNAVAILABLE',
          message: 'psql executable not found in PATH or failed to execute.'
        };
      }
    } catch {
      return {
        ok: false,
        errorCode: 'ERR_PSQL_UNAVAILABLE',
        message: 'psql executable not found in PATH.'
      };
    }

    if (!connectionString) {
      return {
        ok: false,
        errorCode: 'ERR_MISSING_CONNECTION_STRING',
        message: 'DATABASE_URL or connectionString is required to execute psql restore.'
      };
    }

    const psqlArgs = ['--dbname', connectionString, '--set', 'ON_ERROR_STOP=on'];
    if (prep.wrappedInTransaction) {
      psqlArgs.push('--single-transaction');
    }

    const restoreProcess = spawnSync('psql', psqlArgs, {
      input: prep.sql,
      encoding: 'utf8',
      maxBuffer: 100 * 1024 * 1024
    });

    if (restoreProcess.error || restoreProcess.status !== 0) {
      return {
        ok: false,
        errorCode: 'ERR_RESTORE_EXECUTION_FAILED',
        exitCode: restoreProcess.status,
        message: restoreProcess.stderr || 'psql process exited with non-zero code.'
      };
    }
  }

  return {
    ok: true,
    restoredAt: new Date().toISOString(),
    targetEnvironment: target,
    backupFile: resolvedBackupFile,
    checksumVerified: true,
    checksum: integrity.actualChecksum,
    wrappedInTransaction: prep.wrappedInTransaction
  };
}

// CLI Execution entrypoint
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  const args = process.argv.slice(2);
  const backupFile = args.find(a => a.startsWith('--file='))?.split('=')[1] || '';
  const target = args.find(a => a.startsWith('--target='))?.split('=')[1] || 'development';
  const forceProd = args.includes('--force-production');
  const dryRun = args.includes('--dry-run');

  executeDatabaseRestore({
    backupFile,
    target,
    forceProduction: forceProd,
    dryRun
  }).then(result => {
    if (!result.ok) {
      console.error(`Restore failed [${result.errorCode}]: ${result.message}`);
      process.exit(1);
    }
    console.log(`Restore completed successfully from: ${result.backupFile}`);
  });
}
