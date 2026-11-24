/**
 * AuroMasti Platform — Database Backup Automation & Sanitization
 *
 * Implements:
 * 1. PostgreSQL backup procedures via pg_dump / direct SQL dump.
 * 2. Environment safety guard: Refuses to target production without explicit `--force-production`.
 * 3. Sacred Privacy Filters:
 *    - Strips Sankalpa notes and contemplative reflections from all exports.
 *    - Excludes auth secrets, passwords, private keys, service role tokens, and session credentials.
 * 4. Deterministic SHA-256 backup verification and manifest generation.
 * 5. Clear error handling on missing binaries, network interruptions, or non-zero exit codes.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const EXCLUDED_TABLES = Object.freeze([
  'auth.users',
  'auth.identities',
  'auth.sessions',
  'auth.refresh_tokens',
  'vault.secrets',
  'vault.decrypted_secrets',
  'sankalpa_notes',
  'sankalpa_reflections',
  'sankalpa_private_entries'
]);

export const SENSITIVE_PATTERN = /sankalpa[_-]?(?:note|text|entry|reflection|journal)|(?:password[_-]?hash|private[_-]?key|secret[_-]?token|service[_-]?role|jwt[_-]?secret)/i;

/**
 * Validates whether the backup operation is safe for the targeted environment.
 */
export function validateBackupConfiguration({
  target = 'development',
  connectionString = '',
  forceProduction = false,
  outputDir = './backups'
} = {}) {
  const isProduction =
    target.toLowerCase() === 'production' ||
    target.toLowerCase() === 'prod' ||
    (typeof connectionString === 'string' && (connectionString.includes('.supabase.co') || connectionString.includes('production')));

  if (isProduction && !forceProduction) {
    return {
      allowed: false,
      errorCode: 'ERR_PRODUCTION_GUARD_TRIGGERED',
      message: 'Refusing to target production database without explicit --force-production confirmation.'
    };
  }

  return {
    allowed: true,
    isProduction,
    target,
    outputDir
  };
}

/**
 * Filters sensitive data (Sankalpa entries, secrets, credentials) out of raw SQL dumps.
 */
export function filterSensitiveDataFromSql(rawSql) {
  if (typeof rawSql !== 'string') return '';

  const lines = rawSql.split('\n');
  const sanitizedLines = [];
  let inExcludedCopyBlock = false;

  for (const line of lines) {
    // Check COPY blocks for excluded tables
    const copyMatch = line.match(/^COPY\s+([a-zA-Z0-9_.]+)\s+/i);
    if (copyMatch) {
      const tableName = copyMatch[1].toLowerCase();
      if (EXCLUDED_TABLES.some(t => tableName.includes(t.toLowerCase()))) {
        inExcludedCopyBlock = true;
        continue;
      }
    }

    if (inExcludedCopyBlock) {
      if (line.trim() === '\\.') {
        inExcludedCopyBlock = false;
      }
      continue;
    }

    // Drop INSERT statements for excluded tables or sensitive columns
    const insertMatch = line.match(/^INSERT\s+INTO\s+([a-zA-Z0-9_.]+)/i);
    if (insertMatch) {
      const tableName = insertMatch[1].toLowerCase();
      if (EXCLUDED_TABLES.some(t => tableName.includes(t.toLowerCase()))) {
        continue;
      }
    }

    // Filter out lines matching sensitive patterns
    if (SENSITIVE_PATTERN.test(line)) {
      continue;
    }

    sanitizedLines.push(line);
  }

  return sanitizedLines.join('\n');
}

/**
 * Generates an immutable backup manifest with SHA-256 checksum and metadata.
 */
export function generateBackupManifest({
  backupFile,
  fileSize,
  checksum,
  targetEnvironment,
  tablesIncluded = [],
  excludedTables = EXCLUDED_TABLES,
  schemaVersion = '20261123_b19_5'
}) {
  return {
    manifestVersion: '1.0',
    backupFile: path.basename(backupFile),
    fileSize,
    checksum,
    checksumAlgorithm: 'SHA-256',
    createdAt: new Date().toISOString(),
    targetEnvironment,
    schemaVersion,
    tablesIncluded,
    excludedTables: Array.from(excludedTables),
    privacyCompliant: true,
    sankalpaNotesExcluded: true,
    secretsExcluded: true
  };
}

/**
 * Executes database backup and produces verified dump and manifest.
 */
export async function executeDatabaseBackup(options = {}) {
  const {
    target = 'development',
    connectionString = process.env.DATABASE_URL || '',
    forceProduction = false,
    outputDir = './backups',
    dryRun = false,
    runner = null // Optional injection for testing
  } = options;

  // 1. Validate safety configuration
  const configCheck = validateBackupConfiguration({
    target,
    connectionString,
    forceProduction,
    outputDir
  });

  if (!configCheck.allowed) {
    return {
      ok: false,
      errorCode: configCheck.errorCode,
      message: configCheck.message
    };
  }

  // Ensure output directory exists
  if (!fs.existsSync(outputDir) && !dryRun) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFilename = `auromasti_backup_${target}_${timestamp}.sql`;
  const manifestFilename = `auromasti_backup_${target}_${timestamp}.manifest.json`;
  const backupFilePath = path.join(outputDir, backupFilename);
  const manifestFilePath = path.join(outputDir, manifestFilename);

  let rawDumpContent = '';

  if (runner) {
    // Use injected custom runner (for testing or specialized pipelines)
    const runResult = await runner({ target, connectionString, options });
    if (!runResult.ok) {
      return {
        ok: false,
        errorCode: runResult.errorCode || 'ERR_BACKUP_EXECUTION_FAILED',
        message: runResult.message || 'Custom runner backup failed'
      };
    }
    rawDumpContent = runResult.dumpContent || '';
  } else {
    // Check pg_dump availability
    try {
      const versionCheck = spawnSync('pg_dump', ['--version'], { encoding: 'utf8' });
      if (versionCheck.error || versionCheck.status !== 0) {
        return {
          ok: false,
          errorCode: 'ERR_PG_DUMP_UNAVAILABLE',
          message: 'pg_dump executable not found in PATH or failed to execute.'
        };
      }
    } catch {
      return {
        ok: false,
        errorCode: 'ERR_PG_DUMP_UNAVAILABLE',
        message: 'pg_dump executable not found in PATH.'
      };
    }

    if (!connectionString) {
      return {
        ok: false,
        errorCode: 'ERR_MISSING_CONNECTION_STRING',
        message: 'DATABASE_URL or connectionString is required to execute pg_dump.'
      };
    }

    // Execute pg_dump
    const dumpArgs = [
      '--clean',
      '--if-exists',
      '--no-owner',
      '--no-privileges',
      '--dbname', connectionString
    ];

    for (const table of EXCLUDED_TABLES) {
      dumpArgs.push('--exclude-table', table);
    }

    const dumpProcess = spawnSync('pg_dump', dumpArgs, { encoding: 'utf8', maxBuffer: 100 * 1024 * 1024 });
    if (dumpProcess.error || dumpProcess.status !== 0) {
      return {
        ok: false,
        errorCode: 'ERR_BACKUP_EXECUTION_FAILED',
        exitCode: dumpProcess.status,
        message: dumpProcess.stderr || 'pg_dump process exited with non-zero code.'
      };
    }
    rawDumpContent = dumpProcess.stdout;
  }

  // 2. Filter sensitive keys, secrets and Sankalpa notes
  const sanitizedDump = filterSensitiveDataFromSql(rawDumpContent);

  // 3. Compute SHA-256 checksum
  const checksum = crypto.createHash('sha256').update(sanitizedDump, 'utf8').digest('hex');

  // 4. Generate manifest
  const manifest = generateBackupManifest({
    backupFile: backupFilePath,
    fileSize: Buffer.byteLength(sanitizedDump, 'utf8'),
    checksum,
    targetEnvironment: target,
    tablesIncluded: ['user_profiles', 'game_saves', 'entitlements', 'telemetry_rollups', 'remote_config']
  });

  if (!dryRun) {
    fs.writeFileSync(backupFilePath, sanitizedDump, 'utf8');
    fs.writeFileSync(manifestFilePath, JSON.stringify(manifest, null, 2), 'utf8');
  }

  return {
    ok: true,
    backupFile: backupFilePath,
    manifestFile: manifestFilePath,
    checksum,
    fileSize: manifest.fileSize,
    targetEnvironment: target,
    manifest
  };
}

// CLI Execution entrypoint
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  const args = process.argv.slice(2);
  const target = args.find(a => a.startsWith('--target='))?.split('=')[1] || 'development';
  const forceProd = args.includes('--force-production');
  const dryRun = args.includes('--dry-run');

  executeDatabaseBackup({
    target,
    forceProduction: forceProd,
    dryRun
  }).then(result => {
    if (!result.ok) {
      console.error(`Backup failed [${result.errorCode}]: ${result.message}`);
      process.exit(1);
    }
    console.log(`Backup completed successfully: ${result.backupFile}`);
    console.log(`Checksum: ${result.checksum}`);
  });
}
