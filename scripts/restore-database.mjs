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
 * Sanitizes connection strings to prevent credential exposure in logs and errors.
 */
export function sanitizeConnectionString(connStr) {
  if (typeof connStr !== 'string') return '';
  return connStr.replace(/(postgres(?:ql)?:\/\/[^:]+:)[^@]+(@.+)/i, '$1[REDACTED]$2');
}

/**
 * Safely validates that candidatePath is canonically contained within baseDir
 * and does not escape via parent traversal, sibling prefix, or symlink dereferencing.
 *
 * @param {string} baseDir
 * @param {string} candidatePath
 * @returns {boolean}
 */
export function isPathContained(baseDir, candidatePath) {
  if (!candidatePath || typeof candidatePath !== 'string') return false;

  const normalized = path.normalize(candidatePath);
  if (normalized.split(path.sep).includes('..')) {
    return false;
  }

  const resolvedBase = path.resolve(baseDir);
  const resolvedCandidate = path.resolve(baseDir, candidatePath);

  // 1. Check relative containment (prevents escaping and sibling-prefix e.g. /app vs /app_evil)
  const rel = path.relative(resolvedBase, resolvedCandidate);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return false;
  }

  // 2. Real path validation: resolve symlinks to ensure they do not escape the workspace
  try {
    const realBase = fs.existsSync(resolvedBase) ? fs.realpathSync(resolvedBase) : resolvedBase;

    if (fs.existsSync(resolvedCandidate)) {
      const realCandidate = fs.realpathSync(resolvedCandidate);
      const realRel = path.relative(realBase, realCandidate);
      if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
        return false;
      }
    } else {
      let ancestor = path.dirname(resolvedCandidate);
      while (!fs.existsSync(ancestor) && ancestor !== path.dirname(ancestor)) {
        ancestor = path.dirname(ancestor);
      }
      if (fs.existsSync(ancestor)) {
        const realAncestor = fs.realpathSync(ancestor);
        const realRel = path.relative(realBase, realAncestor);
        if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
          return false;
        }
      }
    }
  } catch {
    return false;
  }

  return true;
}

/**
 * Validates whether the restore operation is safe for the targeted environment.
 */
export function validateRestoreConfiguration({
  target = 'development',
  connectionString = '',
  forceProduction = false,
  confirmDisposableTarget = false,
  backupFile = '',
  dryRun = false
} = {}) {
  if (!backupFile) {
    return {
      allowed: false,
      errorCode: 'ERR_MISSING_BACKUP_FILE',
      message: 'A backup SQL file must be specified for restoration.'
    };
  }

  // Prevent path traversal, sibling-prefix escapes, and symlink breakouts
  if (!isPathContained(process.cwd(), backupFile)) {
    return {
      allowed: false,
      errorCode: 'ERR_PATH_TRAVERSAL_DETECTED',
      message: 'backupFile path cannot contain path traversal sequences or escape the approved workspace.'
    };
  }

  // Prevent ambiguous or unverified database targets
  const normTarget = (target || '').toLowerCase().trim();
  if (!normTarget || normTarget === 'unspecified' || normTarget === 'unknown') {
    return {
      allowed: false,
      errorCode: 'ERR_AMBIGUOUS_DATABASE_TARGET',
      message: 'Restore target is ambiguous or unverified.'
    };
  }

  const isProd = isProductionTarget({ target, connectionString });

  if (isProd) {
    return {
      allowed: false,
      errorCode: forceProduction ? 'ERR_PRODUCTION_RESTORE_FORBIDDEN' : 'ERR_PRODUCTION_GUARD_TRIGGERED',
      message: 'Restoring to a production database is strictly forbidden. Database restores cannot target production environments.'
    };
  }

  // Require explicit confirmation matching target identity for non-dry-run restores against disposable/local targets
  if (!dryRun) {
    if (!confirmDisposableTarget) {
      return {
        allowed: false,
        errorCode: 'ERR_DISPOSABLE_TARGET_CONFIRMATION_REQUIRED',
        message: 'Restoration overwrites database data. Explicit confirmation matching target identity (--confirm-disposable-target=<target>) is required.'
      };
    }
    // Generic booleans or mismatched target confirmations are strictly forbidden
    if (confirmDisposableTarget === true || typeof confirmDisposableTarget !== 'string' || confirmDisposableTarget.toLowerCase().trim() !== normTarget) {
      return {
        allowed: false,
        errorCode: 'ERR_TARGET_CONFIRMATION_MISMATCH',
        message: `Disposable target confirmation must explicitly match target identity '${normTarget}'. Generic booleans or mismatched targets are rejected.`
      };
    }
  }

  return {
    allowed: true,
    isProduction: false,
    target,
    backupFile: path.resolve(backupFile)
  };
}

/**
 * Validates the backup manifest and verifies SHA-256 integrity against the backup file.
 */
export function validateManifestAndIntegrity(backupFile, manifestFile = null) {
  // Path traversal & containment validation must occur strictly before reading files
  if (!isPathContained(process.cwd(), backupFile)) {
    return {
      valid: false,
      errorCode: 'ERR_PATH_TRAVERSAL_DETECTED',
      message: 'backupFile path cannot contain path traversal sequences or escape the approved workspace.'
    };
  }

  const resolvedManifestPath = manifestFile || `${backupFile.replace(/\.sql$/, '')}.manifest.json`;
  if (!isPathContained(process.cwd(), resolvedManifestPath)) {
    return {
      valid: false,
      errorCode: 'ERR_PATH_TRAVERSAL_DETECTED',
      message: 'manifestFile path cannot contain path traversal sequences or escape the approved workspace.'
    };
  }

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
  if (manifestData.checksumAlgorithm !== 'SHA-256') {
    return { valid: false, errorCode: 'ERR_INVALID_CHECKSUM_ALGORITHM', message: 'Manifest must specify SHA-256 algorithm.' };
  }
  if (!manifestData.checksum || typeof manifestData.checksum !== 'string' || !/^[a-f0-9]{64}$/i.test(manifestData.checksum)) {
    return { valid: false, errorCode: 'ERR_INVALID_CHECKSUM_FORMAT', message: 'Manifest must specify a valid 64-character SHA-256 checksum.' };
  }
  if (!manifestData.backupFile || typeof manifestData.backupFile !== 'string') {
    return { valid: false, errorCode: 'ERR_MISSING_MANIFEST_FIELD', message: 'Manifest must specify backupFile name.' };
  }
  if (manifestData.fileSize === undefined || manifestData.fileSize === null || !Number.isFinite(manifestData.fileSize) || manifestData.fileSize <= 0) {
    return { valid: false, errorCode: 'ERR_MISSING_MANIFEST_FIELD', message: 'Manifest must specify a positive numeric fileSize.' };
  }

  // Validate filename association
  const backupBasename = path.basename(backupFile);
  if (manifestData.backupFile !== backupBasename) {
    return {
      valid: false,
      errorCode: 'ERR_MANIFEST_FILENAME_MISMATCH',
      message: `Manifest specifies file '${manifestData.backupFile}', but target is '${backupBasename}'`
    };
  }

  // Validate file size
  const actualSize = Buffer.byteLength(fileContent, 'utf8');
  if (manifestData.fileSize !== actualSize) {
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
    confirmDisposableTarget = false,
    backupFile = '',
    manifestFile = '',
    dryRun = false,
    runner = null,
    unknownArgs = [],
    conflictingArgs = []
  } = options;

  if (unknownArgs && unknownArgs.length > 0) {
    return {
      ok: false,
      errorCode: 'ERR_UNKNOWN_CLI_ARGUMENT',
      message: `Unknown CLI argument(s): ${unknownArgs.join(', ')}`
    };
  }

  if (conflictingArgs && conflictingArgs.length > 0) {
    return {
      ok: false,
      errorCode: 'ERR_CONFLICTING_CLI_ARGUMENTS',
      message: `Conflicting or duplicate CLI argument(s): ${conflictingArgs.join('; ')}`
    };
  }

  // 1. Validate safety configuration
  const configCheck = validateRestoreConfiguration({
    target,
    connectionString,
    forceProduction,
    confirmDisposableTarget,
    backupFile,
    dryRun
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

  // 3. Dry-run preflight returns before executing any restore runner
  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      targetEnvironment: target,
      backupFile: resolvedBackupFile,
      checksumVerified: true,
      checksum: integrity.actualChecksum,
      wrappedInTransaction: prep.wrappedInTransaction
    };
  }

  // 4. Execute Restore
  if (runner) {
    const runResult = await runner({
      target,
      connectionString: sanitizeConnectionString(connectionString),
      sql: prep.sql,
      wrappedInTransaction: prep.wrappedInTransaction,
      options
    });
    const isSuccess = runResult && runResult.ok !== false && (runResult.status === undefined || runResult.status === 0);
    if (!isSuccess) {
      return {
        ok: false,
        errorCode: runResult?.errorCode || 'ERR_RESTORE_EXECUTION_FAILED',
        message: sanitizeConnectionString(runResult?.message || runResult?.stderr || 'Custom runner restore failed')
      };
    }
  } else {

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
        message: sanitizeConnectionString(restoreProcess.stderr || 'psql process exited with non-zero code.')
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

/**
 * Parses and validates command line arguments for the restore script.
 * Rejects unknown arguments and duplicate/conflicting configurations.
 */
export function parseRestoreCliArgs(rawArgs = process.argv.slice(2)) {
  const options = {
    backupFile: '',
    manifestFile: '',
    target: 'development',
    connectionString: '',
    forceProduction: false,
    confirmDisposableTarget: false,
    dryRun: false,
    unknownArgs: [],
    conflictingArgs: []
  };

  const seen = new Map();

  function recordArg(type, value) {
    if (seen.has(type)) {
      const existing = seen.get(type);
      if (existing !== value) {
        options.conflictingArgs.push(`Conflicting values for ${type}: '${existing}' vs '${value}'`);
      } else {
        options.conflictingArgs.push(`Duplicate argument specified for ${type}: '${value}'`);
      }
    } else {
      seen.set(type, value);
    }
  }

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg.startsWith('--confirm-disposable-target=')) {
      const val = arg.slice('--confirm-disposable-target='.length).trim();
      options.confirmDisposableTarget = val || true;
      recordArg('confirmDisposableTarget', options.confirmDisposableTarget);
    } else if (arg === '--confirm-disposable-target') {
      if (i + 1 < rawArgs.length && !rawArgs[i + 1].startsWith('--')) {
        options.confirmDisposableTarget = rawArgs[++i].trim();
      } else {
        options.confirmDisposableTarget = true;
      }
      recordArg('confirmDisposableTarget', options.confirmDisposableTarget);
    } else if (arg === '--dry-run') {
      recordArg('dryRun', true);
      options.dryRun = true;
    } else if (arg === '--force-production') {
      recordArg('forceProduction', true);
      options.forceProduction = true;
    } else if (arg.startsWith('--file=')) {
      const val = arg.slice('--file='.length);
      recordArg('backupFile', val);
      options.backupFile = val;
    } else if (arg === '--file' && i + 1 < rawArgs.length) {
      const val = rawArgs[++i];
      recordArg('backupFile', val);
      options.backupFile = val;
    } else if (arg.startsWith('--backup-file=')) {
      const val = arg.slice('--backup-file='.length);
      recordArg('backupFile', val);
      options.backupFile = val;
    } else if (arg === '--backup-file' && i + 1 < rawArgs.length) {
      const val = rawArgs[++i];
      recordArg('backupFile', val);
      options.backupFile = val;
    } else if (arg.startsWith('--manifest=')) {
      const val = arg.slice('--manifest='.length);
      recordArg('manifestFile', val);
      options.manifestFile = val;
    } else if (arg === '--manifest' && i + 1 < rawArgs.length) {
      const val = rawArgs[++i];
      recordArg('manifestFile', val);
      options.manifestFile = val;
    } else if (arg.startsWith('--manifest-file=')) {
      const val = arg.slice('--manifest-file='.length);
      recordArg('manifestFile', val);
      options.manifestFile = val;
    } else if (arg === '--manifest-file' && i + 1 < rawArgs.length) {
      const val = rawArgs[++i];
      recordArg('manifestFile', val);
      options.manifestFile = val;
    } else if (arg.startsWith('--target=')) {
      const val = arg.slice('--target='.length);
      recordArg('target', val);
      options.target = val;
    } else if (arg === '--target' && i + 1 < rawArgs.length) {
      const val = rawArgs[++i];
      recordArg('target', val);
      options.target = val;
    } else if (arg.startsWith('--connection-string=')) {
      const val = arg.slice('--connection-string='.length);
      recordArg('connectionString', val);
      options.connectionString = val;
    } else if (arg === '--connection-string' && i + 1 < rawArgs.length) {
      const val = rawArgs[++i];
      recordArg('connectionString', val);
      options.connectionString = val;
    } else if (arg.startsWith('--dbname=')) {
      const val = arg.slice('--dbname='.length);
      recordArg('connectionString', val);
      options.connectionString = val;
    } else if (arg === '--dbname' && i + 1 < rawArgs.length) {
      const val = rawArgs[++i];
      recordArg('connectionString', val);
      options.connectionString = val;
    } else {
      options.unknownArgs.push(arg);
    }
  }

  return options;
}

// CLI Execution entrypoint
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  const parsed = parseRestoreCliArgs();
  if (parsed.unknownArgs.length > 0) {
    console.error(`Restore failed [ERR_UNKNOWN_CLI_ARGUMENT]: Unknown CLI argument(s): ${parsed.unknownArgs.join(', ')}`);
    process.exit(1);
  }
  if (parsed.conflictingArgs.length > 0) {
    console.error(`Restore failed [ERR_CONFLICTING_CLI_ARGUMENTS]: ${parsed.conflictingArgs.join('; ')}`);
    process.exit(1);
  }

  executeDatabaseRestore(parsed).then(result => {
    if (!result.ok) {
      console.error(`Restore failed [${result.errorCode}]: ${result.message}`);
      process.exit(1);
    }
    console.log(`Restore completed successfully from: ${result.backupFile}`);
  });
}
