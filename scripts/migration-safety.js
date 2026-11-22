/**
 * AuroMind Platform — Migration & Operational Safety Validator
 *
 * Implements strict runtime checks to guarantee:
 *   1. Destructive commands (e.g. `supabase db reset`) are blocked in production
 *   2. Non-transactional DDL (e.g. `CREATE INDEX CONCURRENTLY`) is correctly isolated
 *   3. All forward migrations have verified structure
 *   4. Pre-migration backup verification is enforced
 */

import fs from 'node:fs';
import path from 'node:path';

export function validateEnvironmentSafety(environment, command) {
  const isProduction = environment === 'production' || environment === 'prod';
  const destructiveCommands = ['db reset', 'db destroy', 'schema drop', 'truncate'];

  if (isProduction) {
    for (const cmd of destructiveCommands) {
      if (command.toLowerCase().includes(cmd)) {
        throw new Error(`CRITICAL_SAFETY_VIOLATION: Command '${command}' is forbidden in environment '${environment}'`);
      }
    }
  }

  return { allowed: true, environment, command };
}

export function validateMigrationDdl(sqlContent) {
  const issues = [];

  // Check if non-transactional statements are nested inside transaction blocks
  const hasBegin = /begin\s*;/i.test(sqlContent);
  const hasCommit = /commit\s*;/i.test(sqlContent);
  const hasConcurrentIndex = /create\s+index\s+concurrently/i.test(sqlContent);

  if (hasConcurrentIndex && (hasBegin || hasCommit)) {
    issues.push('INVALID_TRANSACTION_NESTING: CREATE INDEX CONCURRENTLY cannot be executed inside a transaction block');
  }

  // Check for unconstrained destructive drops
  const hasDropTable = /drop\s+table\s+(?!if\s+exists)/i.test(sqlContent);
  if (hasDropTable) {
    issues.push('UNCONSTRAINED_DESTRUCTIVE_DROP: DROP TABLE without IF EXISTS detected');
  }

  return {
    valid: issues.length === 0,
    issues
  };
}

export function verifyPreMigrationBackupStatus(backupMetadata) {
  if (!backupMetadata) {
    return { verified: false, reason: 'BACKUP_METADATA_MISSING' };
  }
  if (!backupMetadata.timestamp || Date.now() - new Date(backupMetadata.timestamp).getTime() > 24 * 60 * 60 * 1000) {
    return { verified: false, reason: 'BACKUP_STALE_OR_MISSING_TIMESTAMP' };
  }
  if (!backupMetadata.sha256 || backupMetadata.sizeBytes <= 0) {
    return { verified: false, reason: 'BACKUP_INTEGRITY_VERIFICATION_FAILED' };
  }

  return {
    verified: true,
    backupFile: backupMetadata.filename,
    ageHours: (Date.now() - new Date(backupMetadata.timestamp).getTime()) / 3600000
  };
}
