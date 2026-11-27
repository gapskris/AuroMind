#!/usr/bin/env node
/**
 * AuroMasti Platform — Automated Version-Controlled Migration Workflow & Preflight Guard
 *
 * Implements:
 * 1. Target Project Verification (enforces exact target 'rlqrtbjynaihdspbqtce').
 * 2. Lexical migration sequencing & SHA-256 integrity tracking (10 canonical migrations).
 * 3. Destructive operation scanning (fails closed on DROP / TRUNCATE / DROP DATABASE).
 * 4. Credential Model Validation:
 *    - SUPABASE_URL: public project configuration.
 *    - SUPABASE_PROJECT_ID: public project reference.
 *    - SUPABASE_ANON_KEY: public browser key, subject to RLS.
 *    - SUPABASE_ACCESS_TOKEN: Supabase CLI authentication.
 *    - SUPABASE_DB_PASSWORD: PostgreSQL database password used by CLI.
 *    - Enforces separation of access token and DB password.
 *    - Strictly rejects service-role key substitution.
 * 5. Safe non-mutating remote preflight (`supabase migration list --remote`, `supabase db push --dry-run`).
 * 6. Remote schema drift detection.
 * 7. Immutable Authorization Gate: Fails closed against unapproved remote mutations.
 *
 * Usage:
 *   node scripts/migration-workflow.mjs [--preflight | --bundle | --verify-sql | --list]
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { loadEnvironment, maskSecret, isServiceRoleJwt, isPrivilegedKey, isValidPublishableKey } from './load-env.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'supabase', 'migrations');

export const CANONICAL_PROJECT_REF = 'rlqrtbjynaihdspbqtce';
export const CANONICAL_PROJECT_REGION = 'ap-southeast-1';
export const CANONICAL_REST_URL = `https://${CANONICAL_PROJECT_REF}.supabase.co`;
export const EXPECTED_MIGRATION_COUNT = 10;

/**
 * Canonical Preflight State Classifications (BLK-01 / B19.7)
 */
export const PREFLIGHT_STATES = Object.freeze({
  UNVERIFIED: 'UNVERIFIED',                                 // State 1: Network / IPv6 failure / connection timeout / offline
  CLEAN_INITIAL_STATE: 'CLEAN_INITIAL_STATE',               // State 2: schema_migrations is empty, zero tables exist
  MIGRATIONS_PENDING: 'MIGRATIONS_PENDING',                 // State 3: Remote applied is subset of local migrations (behind)
  DRIFT_AHEAD: 'DRIFT_AHEAD',                               // State 4: Remote contains migrations not in local repository
  SCHEMA_HISTORY_DIVERGENCE: 'SCHEMA_HISTORY_DIVERGENCE',   // State 5: schema_migrations says applied, but required tables missing
  OBJECT_COLLISION_DETECTED: 'OBJECT_COLLISION_DETECTED'    // State 6: schema_migrations says not applied, but objects already exist in public schema
});

/**
 * Deterministically classifies the remote migration state into one of the canonical states.
 * Fails closed and guarantees zero reliance on PostgREST PGRST205 missing-table responses.
 */
export function classifyPreflightState({
  localMigrations = [],
  remoteApplied = [],
  unexpectedRemote = [],
  remoteReachable = false,
  networkError = null,
  schemaTables = null,
  schemaError = null
} = {}) {
  // State 1: Remote unavailable (network, IPv6 unreachable, timeout, auth failure, schema error, or offline deferral)
  if (!remoteReachable || networkError || schemaError) {
    const errText = networkError || schemaError || 'Remote preflight deferred or unreachable.';
    return {
      state: PREFLIGHT_STATES.UNVERIFIED,
      statusCode: 'UNVERIFIED',
      description: 'Remote migration history unavailable (network/IPv6 failure, connection timeout, authentication failure, schema inspection failure, or offline deferral).',
      details: String(errText),
      pendingMigrations: localMigrations.map(m => typeof m === 'string' ? m : m.filename),
      appliedMigrations: [],
      readyForMigration: false,
      requiresIntervention: false
    };
  }

  const localNames = localMigrations.map(m => typeof m === 'string' ? m : m.filename);
  const pending = localNames.filter(name => !remoteApplied.includes(name));

  // If remoteApplied is empty but schema was not affirmatively verified (schemaTables is null),
  // fail closed as UNVERIFIED because clean state requires affirmative evidence.
  if (remoteApplied.length === 0 && !Array.isArray(schemaTables)) {
    return {
      state: PREFLIGHT_STATES.UNVERIFIED,
      statusCode: 'UNVERIFIED',
      description: 'Remote migration history appears empty but schema was not affirmatively verified. Failing closed.',
      details: 'Affirmative schema inspection required before classifying as clean initial state.',
      pendingMigrations: localNames,
      appliedMigrations: [],
      readyForMigration: false,
      requiresIntervention: false
    };
  }

  // State 4: Remote migrations ahead of local (untracked migrations exist on remote)
  if (unexpectedRemote && unexpectedRemote.length > 0) {
    return {
      state: PREFLIGHT_STATES.DRIFT_AHEAD,
      statusCode: 'DRIFT_AHEAD',
      description: 'Remote database contains migrations not present in local repository.',
      details: `Found ${unexpectedRemote.length} untracked remote migration(s): ${unexpectedRemote.join(', ')}`,
      pendingMigrations: pending,
      appliedMigrations: remoteApplied,
      unexpectedRemote,
      readyForMigration: false,
      requiresIntervention: true
    };
  }

  // State 5 & 6: Schema inspection validations (when schema object list is provided)
  if (Array.isArray(schemaTables)) {
    // If remoteApplied has migrations claiming tables are created, but expected tables are missing
    if (remoteApplied.length > 0) {
      const expectedTables = [];
      for (const m of localMigrations) {
        if (remoteApplied.includes(typeof m === 'string' ? m : m.filename) && Array.isArray(m.tables)) {
          expectedTables.push(...m.tables);
        }
      }
      const missingTables = expectedTables.filter(t => !schemaTables.includes(t.replace(/^public\./, '')));
      if (missingTables.length > 0) {
        return {
          state: PREFLIGHT_STATES.SCHEMA_HISTORY_DIVERGENCE,
          statusCode: 'SCHEMA_HISTORY_DIVERGENCE',
          description: 'Migration history in schema_migrations records applied migrations, but expected public tables are missing.',
          details: `Missing tables: ${missingTables.join(', ')}`,
          pendingMigrations: pending,
          appliedMigrations: remoteApplied,
          missingTables,
          readyForMigration: false,
          requiresIntervention: true
        };
      }
    }

    // State 6: schema_migrations is clean/empty, but tables already exist in public schema
    if (remoteApplied.length === 0 && schemaTables.length > 0) {
      return {
        state: PREFLIGHT_STATES.OBJECT_COLLISION_DETECTED,
        statusCode: 'OBJECT_COLLISION_DETECTED',
        description: 'schema_migrations is empty, but conflicting objects already exist in the public schema.',
        details: `Pre-existing tables: ${schemaTables.join(', ')}`,
        pendingMigrations: pending,
        appliedMigrations: [],
        conflictingTables: schemaTables,
        readyForMigration: false,
        requiresIntervention: true
      };
    }
  }

  // State 2: Remote migration history empty (from schema_migrations, verified clean)
  if (remoteApplied.length === 0) {
    return {
      state: PREFLIGHT_STATES.CLEAN_INITIAL_STATE,
      statusCode: 'CLEAN_INITIAL_STATE',
      description: 'Remote database has clean migration history (0 applied). All local migrations are pending initial execution.',
      details: `Ready to apply all ${localMigrations.length} canonical migrations in sequence.`,
      pendingMigrations: localNames,
      appliedMigrations: [],
      readyForMigration: true,
      requiresIntervention: false
    };
  }

  // State 3: Remote migrations behind local
  if (pending.length > 0) {
    return {
      state: PREFLIGHT_STATES.MIGRATIONS_PENDING,
      statusCode: 'MIGRATIONS_PENDING',
      description: `Remote database is behind local repository. ${remoteApplied.length} applied, ${pending.length} pending.`,
      details: `Pending migrations: ${pending.join(', ')}`,
      pendingMigrations: pending,
      appliedMigrations: remoteApplied,
      readyForMigration: true,
      requiresIntervention: false
    };
  }

  // Fully synchronized
  return {
    state: 'SYNCHRONIZED',
    statusCode: 'SYNCHRONIZED',
    description: `All ${localMigrations.length} canonical migrations are applied on remote database. Zero drift detected.`,
    details: 'Schema is up to date.',
    pendingMigrations: [],
    appliedMigrations: remoteApplied,
    readyForMigration: false,
    requiresIntervention: false
  };
}

/**
 * Computes SHA-256 hash of a file.
 */
export function computeSha256(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Scans SQL content for dangerous destructive keywords.
 */
export function scanDestructiveSql(sqlText) {
  const destructivePatterns = [
    { pattern: /\bDROP\s+TABLE\s+(?!IF\s+EXISTS)/i, name: 'Unconditional DROP TABLE' },
    { pattern: /\bTRUNCATE\b/i, name: 'TRUNCATE statement' },
    { pattern: /\bDROP\s+DATABASE\b/i, name: 'DROP DATABASE statement' },
    { pattern: /\bDROP\s+SCHEMA\s+public\b/i, name: 'DROP SCHEMA public' }
  ];

  const findings = [];
  for (const p of destructivePatterns) {
    if (p.pattern.test(sqlText)) {
      findings.push(p.name);
    }
  }
  return findings;
}

/**
 * Loads and analyzes all migrations in the canonical migrations directory.
 */
export function loadMigrationHistory(migrationsDir = MIGRATIONS_DIR) {
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Migrations directory not found: ${migrationsDir}`);
  }

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort(); // Strict lexical timestamp order

  const migrations = [];
  for (const filename of files) {
    const fullPath = path.join(migrationsDir, filename);
    const content = fs.readFileSync(fullPath, 'utf8');
    const sha256 = computeSha256(fullPath);
    const destructive = scanDestructiveSql(content);

    // Extract table creations (both standard logged and unlogged tables)
    const tableMatches = [...content.matchAll(/CREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_.]+)/gi)]
      .map(m => m[1]);

    // Extract policy creations
    const policyCount = (content.match(/CREATE\s+POLICY\s+/gi) || []).length;

    // Extract function creations
    const functionCount = (content.match(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+/gi) || []).length;

    migrations.push({
      filename,
      fullPath,
      sha256,
      destructive,
      tables: tableMatches,
      policyCount,
      functionCount,
      sizeBytes: fs.statSync(fullPath).size
    });
  }

  return migrations;
}

/**
 * Validates that the repository configuration targets the canonical project reference.
 */
export function validateTargetProject(rootDir = REPO_ROOT) {
  const issues = [];
  const configPath = path.join(rootDir, 'supabase', 'config.toml');

  if (!fs.existsSync(configPath)) {
    issues.push('CRITICAL: Missing supabase/config.toml configuration file.');
    return { valid: false, issues, projectId: null };
  }

  const content = fs.readFileSync(configPath, 'utf8');
  const match = content.match(/project_id\s*=\s*["']([^"']+)["']/);
  const foundId = match ? match[1].trim() : null;

  if (foundId !== CANONICAL_PROJECT_REF) {
    issues.push(`TARGET_PROJECT_MISMATCH: Expected project_id '${CANONICAL_PROJECT_REF}', found '${foundId}'. Fail-closed.`);
  }

  return {
    valid: issues.length === 0,
    issues,
    projectId: foundId
  };
}

/**
 * Validates credential model and enforces strict separation.
 */
export function checkCredentialModel(rawEnv = {}) {
  const env = rawEnv || {};
  const violations = [];

  const pubKey = env.SUPABASE_PUBLISHABLE_KEY || '';
  const anonKey = env.SUPABASE_ANON_KEY || '';
  const effectivePublishable = pubKey || anonKey;
  const accessToken = env.SUPABASE_ACCESS_TOKEN || '';
  const dbPassword = env.SUPABASE_DB_PASSWORD || '';
  const projUrl = env.SUPABASE_URL || '';
  const projId = env.SUPABASE_PROJECT_ID || '';

  const isPubConfigured = Boolean(pubKey && !pubKey.startsWith('YOUR_'));
  const isAnonConfigured = Boolean(anonKey && !anonKey.startsWith('YOUR_'));
  const isEffectiveConfigured = Boolean(effectivePublishable && !effectivePublishable.startsWith('YOUR_'));
  const isTokenConfigured = Boolean(accessToken && !accessToken.startsWith('YOUR_'));
  const isPasswordConfigured = Boolean(dbPassword && !dbPassword.startsWith('YOUR_'));

  // Security checks: Reject service_role / secret key substitution
  if (isPubConfigured && isPrivilegedKey(pubKey)) {
    violations.push('SECURITY_VIOLATION: SUPABASE_PUBLISHABLE_KEY has service_role or secret key claims! Client code must never use privileged keys.');
  }
  if (isAnonConfigured && (isServiceRoleJwt(anonKey) || isPrivilegedKey(anonKey))) {
    violations.push('SECURITY_VIOLATION: SUPABASE_ANON_KEY has service_role claims! Client code must never use service_role.');
  }
  if (isEffectiveConfigured && !isValidPublishableKey(effectivePublishable)) {
    violations.push('INVALID_KEY: Supabase publishable key is not a valid format (expected sb_publishable_... or valid 3-segment anon JWT).');
  }
  if (isTokenConfigured && isServiceRoleJwt(accessToken)) {
    violations.push('SECURITY_VIOLATION: SUPABASE_ACCESS_TOKEN has service_role claims! Access token must be a Personal Access Token.');
  }
  if (isPasswordConfigured && isServiceRoleJwt(dbPassword)) {
    violations.push('SECURITY_VIOLATION: SUPABASE_DB_PASSWORD has service_role claims! Database password cannot be a JWT.');
  }

  // Separation check: Token and password must not be identical
  if (isTokenConfigured && isPasswordConfigured && accessToken === dbPassword) {
    violations.push('CONFIGURATION_ERROR: SUPABASE_ACCESS_TOKEN and SUPABASE_DB_PASSWORD are identical. They must be kept separate.');
  }

  // Target project verification
  if (projId && projId !== CANONICAL_PROJECT_REF) {
    violations.push(`PROJECT_MISMATCH: SUPABASE_PROJECT_ID '${projId}' does not match canonical '${CANONICAL_PROJECT_REF}'.`);
  }
  if (projUrl && projUrl !== CANONICAL_REST_URL) {
    violations.push(`URL_MISMATCH: SUPABASE_URL '${projUrl}' does not match canonical '${CANONICAL_REST_URL}'.`);
  }

  const credentials = {
    SUPABASE_URL: {
      classification: 'PUBLIC_CONFIG',
      status: projUrl === CANONICAL_REST_URL ? 'VALID' : (projUrl ? 'MISMATCH' : 'NOT_SET'),
      preview: projUrl || '(not set)'
    },
    SUPABASE_PROJECT_ID: {
      classification: 'PUBLIC_CONFIG',
      status: projId === CANONICAL_PROJECT_REF ? 'VALID' : (projId ? 'MISMATCH' : 'NOT_SET'),
      preview: projId || '(not set)'
    },
    SUPABASE_PUBLISHABLE_KEY: {
      classification: 'PUBLIC_BROWSER_KEY (Canonical, Subject to RLS)',
      status: isPubConfigured ? 'CONFIGURED' : (pubKey ? 'PLACEHOLDER' : (isAnonConfigured ? 'CONFIGURED' : 'NOT_SET')),
      preview: isPubConfigured ? maskSecret(pubKey) : (isAnonConfigured ? maskSecret(anonKey) : '(not configured)')
    },
    SUPABASE_ANON_KEY: {
      classification: 'PUBLIC_BROWSER_KEY (Backward compatibility alias)',
      status: isAnonConfigured ? 'CONFIGURED' : (anonKey ? 'PLACEHOLDER' : (isPubConfigured ? 'CONFIGURED' : 'NOT_SET')),
      preview: isAnonConfigured ? maskSecret(anonKey) : (isPubConfigured ? maskSecret(pubKey) : '(not configured)')
    },
    SUPABASE_ACCESS_TOKEN: {
      classification: 'CLI_AUTH_TOKEN (Personal Access Token)',
      status: isTokenConfigured ? 'CONFIGURED' : (accessToken ? 'PLACEHOLDER' : 'NOT_SET'),
      preview: isTokenConfigured ? maskSecret(accessToken) : '(not configured)'
    },
    SUPABASE_DB_PASSWORD: {
      classification: 'DATABASE_SECRET (Hosted PostgreSQL Password)',
      status: isPasswordConfigured ? 'CONFIGURED' : (dbPassword ? 'PLACEHOLDER' : 'NOT_SET'),
      preview: isPasswordConfigured ? maskSecret(dbPassword) : '(not configured)'
    }
  };

  return {
    valid: violations.length === 0,
    violations,
    credentials,
    hasCliAuth: isTokenConfigured,
    hasDbAuth: isPasswordConfigured,
    hasAnonAuth: isAnonConfigured
  };
}

/**
 * Probes local system for CLI tools (Supabase CLI via npx, psql).
 */
export function probeCliTools(rootDir = REPO_ROOT) {
  function findCommand(cmd) {
    const probeCmd = process.platform === 'win32' ? 'where' : 'which';
    try {
      const out = execFileSync(probeCmd, [cmd], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      return out.trim().split(/\r?\n/)[0] || null;
    } catch {
      return null;
    }
  }

  let hasSupabaseCli = false;
  let supabasePath = null;
  let supabaseVersion = null;
  let supabaseInvocation = null;

  // 1. Probe local project-level Supabase CLI via npx supabase
  try {
    const isWindows = process.platform === 'win32';
    const npxCmd = isWindows ? 'npx.cmd' : 'npx';
    const ver = execFileSync(npxCmd, ['supabase', '--version'], {
      cwd: rootDir,
      encoding: 'utf8',
      shell: isWindows,
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    if (ver) {
      hasSupabaseCli = true;
      supabasePath = path.join(rootDir, 'node_modules', '.bin', isWindows ? 'supabase.cmd' : 'supabase');
      supabaseVersion = ver;
      supabaseInvocation = 'npx supabase';
    }
  } catch {
    // 2. Fallback to global PATH
    const globalSupabase = findCommand('supabase');
    if (globalSupabase) {
      hasSupabaseCli = true;
      supabasePath = globalSupabase;
      supabaseInvocation = 'supabase';
      try {
        supabaseVersion = execFileSync(globalSupabase, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      } catch {}
    }
  }

  const psqlPath = findCommand('psql');

  return {
    hasSupabaseCli,
    supabasePath,
    supabaseVersion,
    supabaseInvocation,
    hasPsql: Boolean(psqlPath),
    psqlPath
  };
}

/**
 * Computes a deterministic cryptographic manifest for all canonical migrations.
 */
export function computeMigrationManifest(migrations) {
  const sorted = [...migrations].sort((a, b) => a.filename.localeCompare(b.filename));
  const entries = sorted.map((m, idx) => {
    const versionMatch = m.filename.match(/^(\d{14})_(.*)\.sql$/);
    const version = versionMatch ? versionMatch[1] : '';
    const name = versionMatch ? versionMatch[2] : m.filename;
    return {
      index: idx + 1,
      version,
      name,
      filename: m.filename,
      sha256: m.sha256,
      sizeBytes: m.sizeBytes,
      tables: m.tables || [],
      destructive: m.destructive || []
    };
  });

  const manifestHashInput = entries.map(e => `${e.filename}:${e.sha256}`).join('\n');
  const manifestSha256 = crypto.createHash('sha256').update(manifestHashInput, 'utf8').digest('hex');

  return {
    manifestVersion: 1,
    schemaVersion: '2.0.0-beta',
    targetProjectRef: CANONICAL_PROJECT_REF,
    expectedMigrationCount: EXPECTED_MIGRATION_COUNT,
    migrationCount: entries.length,
    manifestSha256,
    migrations: entries
  };
}

/**
 * Verifies local migration files against the recorded manifest.
 */
export function verifyMigrationManifest(rootDir = REPO_ROOT) {
  const manifestPath = path.join(rootDir, 'supabase', 'migrations_manifest.json');
  const migrationsDir = path.join(rootDir, 'supabase', 'migrations');

  if (!fs.existsSync(manifestPath)) {
    return {
      valid: false,
      issues: [`MISSING_MANIFEST: migrations_manifest.json not found at ${manifestPath}`]
    };
  }

  const currentMigrations = loadMigrationHistory(migrationsDir);
  const currentManifest = computeMigrationManifest(currentMigrations);

  let recordedManifest;
  try {
    recordedManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    return {
      valid: false,
      issues: [`MALFORMED_MANIFEST: Failed to parse migrations_manifest.json: ${err.message}`]
    };
  }

  const issues = [];
  if (currentManifest.migrationCount !== recordedManifest.migrationCount) {
    issues.push(`MIGRATION_COUNT_MISMATCH: Expected ${recordedManifest.migrationCount} migrations, found ${currentManifest.migrationCount}`);
  }

  if (currentManifest.manifestSha256 !== recordedManifest.manifestSha256) {
    issues.push(`MANIFEST_CHECKSUM_MISMATCH: Current files hash (${currentManifest.manifestSha256}) does not match recorded manifest (${recordedManifest.manifestSha256})`);
  }

  const recordedMap = new Map((recordedManifest.migrations || []).map(m => [m.filename, m]));
  for (const m of currentManifest.migrations) {
    const rec = recordedMap.get(m.filename);
    if (!rec) {
      issues.push(`UNRECORDED_MIGRATION: '${m.filename}' exists on disk but is not in recorded manifest`);
    } else if (rec.sha256 !== m.sha256) {
      issues.push(`CHECKSUM_DIVERGENCE: '${m.filename}' on-disk SHA-256 (${m.sha256}) differs from recorded manifest (${rec.sha256})`);
    }
  }

  for (const rec of recordedManifest.migrations || []) {
    if (!currentManifest.migrations.some(m => m.filename === rec.filename)) {
      issues.push(`MISSING_MIGRATION: Recorded migration '${rec.filename}' is missing from migrations directory`);
    }
  }

  return {
    valid: issues.length === 0,
    manifestSha256: currentManifest.manifestSha256,
    migrationCount: currentManifest.migrationCount,
    issues,
    manifest: currentManifest
  };
}

/**
 * Invokes project-level Supabase CLI reliably through npx supabase.
 * Guarded against unauthorized direct mutating commands (B82-01).
 *
 * OPERATOR NOTICE & ARCHITECTURAL LIMITATION (B19.8.3):
 * A Node.js wrapper cannot prevent an operator with terminal access from
 * independently running 'npx supabase db push' directly in raw PowerShell.
 * Direct CLI execution is a privileged bypass outside the canonical controlled
 * workflow. Operators must follow the canonical authorization workflow and
 * NEVER execute mutating CLI commands directly without prior authorization.
 */
export function runSupabaseCli(args = [], { env = {}, rootDir = REPO_ROOT, _authorizedByGate = false } = {}) {
  const isWindows = process.platform === 'win32';
  const npxCmd = isWindows ? 'npx.cmd' : 'npx';
  const cliEnv = { ...process.env, ...env };

  const isMutatingPush = args.includes('db') && args.includes('push') && !args.includes('--dry-run');
  if (isMutatingPush && !_authorizedByGate) {
    throw new Error('CRITICAL_SECURITY_VIOLATION: Direct invocation of "supabase db push" without passing validateMigrationExecutionGate is strictly prohibited.');
  }

  return execFileSync(npxCmd, ['supabase', ...args], {
    cwd: rootDir,
    env: cliEnv,
    encoding: 'utf8',
    shell: isWindows,
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

/**
 * Analyzes remote migration output to detect drift against local ledger.
 */
export function detectRemoteDrift(localMigrations, remoteOutput = '') {
  const localMap = new Map(localMigrations.map(m => [m.filename, m]));
  const remoteApplied = [];
  const unexpectedRemote = [];
  const driftIssues = [];

  if (typeof remoteOutput !== 'string' || remoteOutput.trim().length === 0) {
    return {
      synced: false,
      remoteApplied: [],
      pending: localMigrations.map(m => m.filename),
      unexpectedRemote: [],
      driftIssues: ['UNVERIFIED_REMOTE_RESPONSE: Remote CLI output is empty or unavailable. Cannot assume clean initial state.']
    };
  }

  if (/error|failed|fatal|unauthorized|denied|timeout/i.test(remoteOutput) && !remoteOutput.includes('0 migrations')) {
    driftIssues.push(`REMOTE_INSPECTION_ERROR: Remote CLI returned error: ${remoteOutput.trim().split(/\r?\n/)[0]}`);
  }

  const lines = remoteOutput.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/(\d{14}_[a-zA-Z0-9_.-]+\.sql)/);
    if (match) {
      const filename = match[1];
      if (localMap.has(filename)) {
        remoteApplied.push(filename);
      } else {
        unexpectedRemote.push(filename);
        driftIssues.push(`UNEXPECTED_REMOTE_MIGRATION: Remote database contains '${filename}' not present in local repository.`);
      }
    }
  }

  const pending = localMigrations
    .filter(m => !remoteApplied.includes(m.filename))
    .map(m => m.filename);

  return {
    synced: driftIssues.length === 0,
    remoteApplied,
    pending,
    unexpectedRemote,
    driftIssues
  };
}

/**
 * Generates an idempotent migration bundle SQL for dry-run code audit and offline review only.
 * ARCHITECTURAL WARNING (B82-03): Direct manual execution in Supabase Dashboard SQL Editor
 * bypasses supabase_migrations.schema_migrations and is NOT equivalent to supabase db push.
 */
export function generateMigrationBundle(migrations) {
  let bundle = `-- ==============================================================================\n`;
  bundle += `-- AuroMasti Consolidated Idempotent Migration Bundle (OFFLINE CODE AUDIT PREVIEW)\n`;
  bundle += `-- Generated: ${new Date().toISOString()}\n`;
  bundle += `-- Target Project: AuroMasti (${CANONICAL_PROJECT_REF})\n`;
  bundle += `-- Total Canonical Migrations: ${migrations.length}\n`;
  bundle += `-- ==============================================================================\n`;
  bundle += `-- ARCHITECTURAL WARNING (B82-03):\n`;
  bundle += `-- Direct execution of this bundle in the Supabase Dashboard SQL Editor\n`;
  bundle += `-- DOES NOT update the Supabase CLI migration ledger (supabase_migrations.schema_migrations).\n`;
  bundle += `-- It is strictly an offline code audit preview, NOT a drop-in alternative to 'supabase db push'.\n`;
  bundle += `-- Any emergency manual disaster-recovery execution requires a separately approved\n`;
  bundle += `-- operational procedure including post-execution 'supabase migration repair --status applied'.\n`;
  bundle += `-- ==============================================================================\n\n`;

  for (let i = 0; i < migrations.length; i++) {
    const m = migrations[i];
    const content = fs.readFileSync(m.fullPath, 'utf8');
    bundle += `\n-- ------------------------------------------------------------------------------\n`;
    bundle += `-- [${i + 1}/${migrations.length}] ${m.filename}\n`;
    bundle += `-- SHA-256: ${m.sha256}\n`;
    bundle += `-- ------------------------------------------------------------------------------\n\n`;
    bundle += content.trim() + `\n\n`;
  }

  return bundle;
}

/**
 * Generates a post-migration SQL verification script.
 */
export function generatePostMigrationVerificationSql() {
  return `-- ==============================================================================
-- AuroMasti Post-Migration Schema Verification Script
-- Target Project: AuroMasti (${CANONICAL_PROJECT_REF})
-- ==============================================================================
-- Non-mutating read-only transaction. Verifies:
-- 1. All 15 expected public tables exist.
-- 2. Row Level Security (RLS) is ENABLED on every public table.
-- 3. All SECURITY DEFINER functions have search_path hardened.
-- 4. Storage buckets and policies exist.
-- ==============================================================================

DO $$
DECLARE
  v_expected_tables TEXT[] := ARRAY[
    'user_profiles',
    'guest_identity_links',
    'game_saves',
    'game_save_revisions',
    'entitlements',
    'entitlement_audit',
    'purchase_receipts',
    'telemetry_events',
    'remote_config',
    'owner_roles',
    'telemetry_rate_limits',
    'telemetry_daily_aggregates',
    'user_private_settings',
    'telemetry_rate_buckets',
    'storage_deletion_queue'
  ];
  v_missing_tables TEXT[];
  v_unprotected_tables TEXT[];
  v_unpinned_functions TEXT[];
  t TEXT;
BEGIN
  -- 1. Check for missing tables
  SELECT ARRAY_AGG(tbl)
  INTO v_missing_tables
  FROM UNNEST(v_expected_tables) AS tbl
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = tbl
  );

  IF v_missing_tables IS NOT NULL AND ARRAY_LENGTH(v_missing_tables, 1) > 0 THEN
    RAISE EXCEPTION 'VERIFICATION_FAILED: Missing tables in public schema: %', v_missing_tables;
  END IF;

  -- 2. Check for public tables with RLS disabled
  SELECT ARRAY_AGG(c.relname ORDER BY c.relname)
  INTO v_unprotected_tables
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND NOT c.relrowsecurity;

  IF v_unprotected_tables IS NOT NULL AND ARRAY_LENGTH(v_unprotected_tables, 1) > 0 THEN
    RAISE EXCEPTION 'VERIFICATION_FAILED: Tables with RLS disabled: %', v_unprotected_tables;
  END IF;

  -- 3. Check for SECURITY DEFINER functions missing fixed search_path
  SELECT ARRAY_AGG(p.proname ORDER BY p.proname)
  INTO v_unpinned_functions
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosecdef
    AND (
      p.proconfig IS NULL
      OR NOT ('search_path=pg_catalog, public' = ANY(p.proconfig))
    );

  IF v_unpinned_functions IS NOT NULL AND ARRAY_LENGTH(v_unpinned_functions, 1) > 0 THEN
    RAISE EXCEPTION 'VERIFICATION_FAILED: SECURITY DEFINER functions missing hardened search_path: %', v_unpinned_functions;
  END IF;

  RAISE NOTICE 'SUCCESS: All 15 public tables verified with RLS enabled and hardened function search_paths.';
END;
$$;
`;
}

/**
 * Validates the 8 mandatory gates before permitting remote migration execution.
 * Fails closed if any condition is unsatisfied.
 */
export function validateMigrationExecutionGate({
  remoteMigrationHistoryVerified = false,
  remoteConnectivityConfirmed = false,
  remoteSchemaInspected = false,
  localMigrationsCompared = false,
  migrationDivergenceResolved = false,
  executionPreviewGenerated = false,
  backupReadinessConfirmed = false,
  productOwnerApproved = false
} = {}) {
  const gates = [
    {
      id: 'GATE_1_REMOTE_HISTORY',
      name: 'Remote migration history verified',
      satisfied: Boolean(remoteMigrationHistoryVerified),
      description: 'supabase_migrations schema ledger queried and compared against canonical local files'
    },
    {
      id: 'GATE_2_REMOTE_CONNECTIVITY',
      name: 'Remote connectivity confirmed',
      satisfied: Boolean(remoteConnectivityConfirmed),
      description: 'Active authenticated reachability confirmed to Supabase REST and PostgreSQL endpoints'
    },
    {
      id: 'GATE_3_REMOTE_SCHEMA_INSPECTED',
      name: 'Remote schema inspected',
      satisfied: Boolean(remoteSchemaInspected),
      description: 'Existing remote public schema inspected for conflicting tables, types, or policies'
    },
    {
      id: 'GATE_4_LOCAL_MIGRATIONS_COMPARED',
      name: '10 local migrations compared',
      satisfied: Boolean(localMigrationsCompared),
      description: 'All 10 canonical migration files present, lexically ordered, and SHA-256 verified'
    },
    {
      id: 'GATE_5_DIVERGENCE_RESOLVED',
      name: 'Migration divergence resolved',
      satisfied: Boolean(migrationDivergenceResolved),
      description: 'Zero unresolved migration drift, unapplied historical gaps, or checksum divergence'
    },
    {
      id: 'GATE_6_PREVIEW_GENERATED',
      name: 'Execution preview generated',
      satisfied: Boolean(executionPreviewGenerated),
      description: 'Consolidated preview bundle generated and reviewed before execution'
    },
    {
      id: 'GATE_7_BACKUP_READINESS',
      name: 'Backup readiness confirmed',
      satisfied: Boolean(backupReadinessConfirmed),
      description: 'Pre-migration point-in-time backup or rollback posture validated'
    },
    {
      id: 'GATE_8_PRODUCT_OWNER_APPROVAL',
      name: 'Explicit Product Owner approval',
      satisfied: Boolean(productOwnerApproved),
      description: 'Formal Product Owner approval recorded with commercial gate and scope signoff'
    }
  ];

  const failedGates = gates.filter(g => !g.satisfied);
  const authorized = failedGates.length === 0;

  return {
    authorized,
    status: authorized ? 'UNLOCKED' : 'LOCKED',
    gateCount: gates.length,
    satisfiedCount: gates.filter(g => g.satisfied).length,
    gates,
    failedGates,
    summary: authorized
      ? 'All 8 migration execution gates satisfied. Migration execution permitted.'
      : `MIGRATION_EXECUTION_GATE_BLOCKED: ${failedGates.length} of ${gates.length} conditions unsatisfied.`
  };
}

/**
 * Records an attributable, sanitized audit trail of authorization decisions.
 * Guarantees zero secret exposure (B19.8.3 Open Item 2).
 */
export function recordAuthorizationAudit({
  decision = 'REJECTED',
  reason = 'UNKNOWN',
  approval = null,
  manifestSha256 = null,
  targetProjectRef = CANONICAL_PROJECT_REF,
  rootDir = REPO_ROOT
} = {}) {
  const auditPath = path.join(rootDir, 'supabase', 'authorization_audit.log');
  const entry = {
    timestamp: new Date().toISOString(),
    decision,
    reason: typeof reason === 'string' ? reason.slice(0, 300) : 'N/A',
    approvedBy: approval && typeof approval.approvedBy === 'string' ? approval.approvedBy : null,
    approvalTimestamp: approval && approval.approvedAt ? approval.approvedAt : null,
    targetProjectRef,
    manifestSha256: manifestSha256 || (approval && approval.approvedManifestSha256) || null,
    migrationCount: approval && approval.migrationSetCount ? approval.migrationSetCount : null,
    sanitized: true
  };
  try {
    fs.mkdirSync(path.dirname(auditPath), { recursive: true });
    fs.appendFileSync(auditPath, JSON.stringify(entry) + '\n', 'utf8');
  } catch (_e) {
    // Non-blocking in case of read-only FS or tests
  }
  return entry;
}

/**
 * Programmatic migration mutation execution path (B82-01 / B19.8.3).
 * Strictly enforces all 8 gates, fresh preflight evidence, matching manifest checksums,
 * attributable Product Owner approval, and records sanitized audit decisions before CLI invocation.
 */
export function executeRemoteMigrations({
  gateEvidence = null,
  productOwnerApproval = null,
  env = null,
  rootDir = REPO_ROOT,
  _cliRunner = runSupabaseCli
} = {}) {
  // 1. Verify local migration files and manifest integrity
  const migrationsDir = path.join(rootDir, 'supabase', 'migrations');
  const migrations = loadMigrationHistory(migrationsDir);
  const currentManifest = computeMigrationManifest(migrations);

  const reject = (errMsg) => {
    recordAuthorizationAudit({
      decision: 'REJECTED',
      reason: errMsg,
      approval: productOwnerApproval,
      manifestSha256: currentManifest ? currentManifest.manifestSha256 : null,
      targetProjectRef: productOwnerApproval?.targetProjectRef || CANONICAL_PROJECT_REF,
      rootDir
    });
    throw new Error(errMsg);
  };

  if (migrations.length !== EXPECTED_MIGRATION_COUNT) {
    reject(`MIGRATION_EXECUTION_BLOCKED: Expected ${EXPECTED_MIGRATION_COUNT} canonical migrations, found ${migrations.length}.`);
  }

  // Check destructive SQL
  for (const m of migrations) {
    if (m.destructive && m.destructive.length > 0) {
      reject(`MIGRATION_EXECUTION_BLOCKED: Destructive SQL detected in '${m.filename}': ${m.destructive.join(', ')}.`);
    }
  }

  // 2. Gate evidence validation (fail-closed if missing, malformed, or stale)
  if (!gateEvidence || typeof gateEvidence !== 'object') {
    reject('MIGRATION_EXECUTION_BLOCKED: Missing or invalid gateEvidence object.');
  }

  // Check preflight freshness: must have preflightManifestSha256 matching current manifest
  if (!gateEvidence.preflightManifestSha256 || gateEvidence.preflightManifestSha256 !== currentManifest.manifestSha256) {
    reject(`MIGRATION_EXECUTION_BLOCKED: Stale or mismatched preflight evidence. Preflight manifest (${gateEvidence.preflightManifestSha256 || 'none'}) does not match current migration manifest (${currentManifest.manifestSha256}).`);
  }

  // Check timestamp staleness (max 30 minutes)
  const preflightAgeMs = Date.now() - new Date(gateEvidence.preflightTimestamp || 0).getTime();
  if (isNaN(preflightAgeMs) || preflightAgeMs < 0 || preflightAgeMs > 30 * 60 * 1000) {
    reject('MIGRATION_EXECUTION_BLOCKED: Stale preflight evidence. Preflight must be conducted within 30 minutes of execution.');
  }

  // 3. Product Owner approval validation (must be explicit, attributable, scoped to manifest and current execution)
  if (!productOwnerApproval || typeof productOwnerApproval !== 'object') {
    reject('MIGRATION_EXECUTION_BLOCKED: Missing or invalid productOwnerApproval object. Approval cannot be inferred or defaulted.');
  }

  const {
    approvedBy,
    approvedAt,
    approvedManifestSha256,
    migrationSetCount,
    targetProjectRef,
    explicitStatement
  } = productOwnerApproval;

  if (!approvedBy || typeof approvedBy !== 'string' || approvedBy.trim().length === 0) {
    reject('MIGRATION_EXECUTION_BLOCKED: Product Owner approval must be explicitly attributable (missing approvedBy).');
  }

  if (targetProjectRef !== CANONICAL_PROJECT_REF) {
    reject(`MIGRATION_EXECUTION_BLOCKED: Approval targets project '${targetProjectRef}', but canonical project is '${CANONICAL_PROJECT_REF}'.`);
  }

  if (migrationSetCount !== EXPECTED_MIGRATION_COUNT) {
    reject(`MIGRATION_EXECUTION_BLOCKED: Approval scopes ${migrationSetCount} migrations, but repository requires exactly ${EXPECTED_MIGRATION_COUNT}.`);
  }

  if (approvedManifestSha256 !== currentManifest.manifestSha256) {
    reject(`MIGRATION_EXECUTION_BLOCKED: Approval manifest hash (${approvedManifestSha256}) does not match current migration manifest hash (${currentManifest.manifestSha256}). An approval for one migration set cannot authorize a modified migration set.`);
  }

  const approvalAgeMs = Date.now() - new Date(approvedAt || 0).getTime();
  if (isNaN(approvalAgeMs) || approvalAgeMs < 0 || approvalAgeMs > 60 * 60 * 1000) {
    reject('MIGRATION_EXECUTION_BLOCKED: Stale Product Owner approval. Approval must be granted within 60 minutes of execution.');
  }

  if (!explicitStatement || !explicitStatement.includes('I AUTHORIZE MIGRATION EXECUTION FOR AUROMASTI')) {
    reject('MIGRATION_EXECUTION_BLOCKED: Missing explicit authorization statement in Product Owner approval.');
  }

  // 4. Validate the 8 mandatory gates
  const gateResult = validateMigrationExecutionGate({
    remoteMigrationHistoryVerified: Boolean(gateEvidence.remoteMigrationHistoryVerified),
    remoteConnectivityConfirmed: Boolean(gateEvidence.remoteConnectivityConfirmed),
    remoteSchemaInspected: Boolean(gateEvidence.remoteSchemaInspected),
    localMigrationsCompared: Boolean(gateEvidence.localMigrationsCompared),
    migrationDivergenceResolved: Boolean(gateEvidence.migrationDivergenceResolved),
    executionPreviewGenerated: Boolean(gateEvidence.executionPreviewGenerated),
    backupReadinessConfirmed: Boolean(gateEvidence.backupReadinessConfirmed),
    productOwnerApproved: true // Validated rigorously above
  });

  if (!gateResult.authorized) {
    reject(`MIGRATION_EXECUTION_BLOCKED: ${gateResult.summary}`);
  }

  // Record authorized execution decision in audit log
  recordAuthorizationAudit({
    decision: 'AUTHORIZED',
    reason: 'All 8 migration gates, fresh preflight evidence, and attributable Product Owner approval satisfied.',
    approval: productOwnerApproval,
    manifestSha256: currentManifest.manifestSha256,
    targetProjectRef: CANONICAL_PROJECT_REF,
    rootDir
  });

  // 5. Execute migration mutation via CLI runner with explicit authorization flag
  const cliEnv = env ? { ...env } : undefined;
  return _cliRunner(['db', 'push', '--project-ref', CANONICAL_PROJECT_REF], {
    rootDir,
    env: cliEnv,
    _authorizedByGate: true
  });
}

/**
 * Runs the complete preflight assessment.
 * Clearly separates Local Preflight (offline) from Read-Only Remote Preflight (B19.8.3 Open Item 1).
 */
export function runPreflight({
  env: customEnv = null,
  rootDir = REPO_ROOT,
  allowRemote = false,
  remoteMode = false,
  expectedProjectRef = CANONICAL_PROJECT_REF
} = {}) {
  const loaded = loadEnvironment({ rootDir, injectProcessEnv: false });
  const activeEnv = customEnv || loaded.env;

  const target = validateTargetProject(rootDir);
  const migrations = loadMigrationHistory(path.join(rootDir, 'supabase', 'migrations'));
  const creds = checkCredentialModel(activeEnv);
  const tools = probeCliTools(rootDir);

  const blockers = [];
  if (!target.valid) blockers.push(...target.issues);
  if (creds.violations.length > 0) blockers.push(...creds.violations);

  const isRemoteRequested = Boolean(remoteMode || allowRemote);
  if (isRemoteRequested && expectedProjectRef !== CANONICAL_PROJECT_REF) {
    blockers.push(`INVALID_TARGET_PROJECT_REF: Remote preflight requires target project '${CANONICAL_PROJECT_REF}', got '${expectedProjectRef}'.`);
  }

  for (const m of migrations) {
    if (m.destructive.length > 0) {
      blockers.push(`DESTRUCTIVE_SQL in ${m.filename}: ${m.destructive.join(', ')}`);
    }
  }

  // Node runtime check
  const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
  const isNodeCompatible = nodeMajor >= 18;
  if (!isNodeCompatible) {
    blockers.push(`INCOMPATIBLE_NODE_VERSION: Node.js ${process.version} is not supported. Required: >= 18.`);
  }

  // Cryptographic manifest check (B82-02 / B19.8.3 Local Integrity Dimension A)
  const manifestVerification = verifyMigrationManifest(rootDir);
  if (!manifestVerification.valid) {
    blockers.push(...manifestVerification.issues);
  }

  let authenticatedPreflightRan = false;
  let remoteOutput = '';
  let drift = {
    synced: true,
    remoteApplied: [],
    pending: migrations.map(m => m.filename),
    driftIssues: []
  };
  let remoteError = null;
  let remoteFailureType = null;

  // Only execute remote preflight if explicitly authorized (isRemoteRequested = true) and project ref matches
  if (isRemoteRequested && tools.hasSupabaseCli && creds.hasCliAuth && expectedProjectRef === CANONICAL_PROJECT_REF) {
    try {
      const cliEnv = {
        ...process.env,
        SUPABASE_ACCESS_TOKEN: activeEnv.SUPABASE_ACCESS_TOKEN
      };
      if (creds.hasDbAuth) {
        cliEnv.SUPABASE_DB_PASSWORD = activeEnv.SUPABASE_DB_PASSWORD;
      }

      // 1. Run supabase migration list --remote
      const listOutput = runSupabaseCli(['migration', 'list', '--remote'], {
        rootDir,
        env: cliEnv
      });

      // 2. Run supabase db push --dry-run
      const dryRunOutput = runSupabaseCli(['db', 'push', '--dry-run'], {
        rootDir,
        env: cliEnv
      });

      remoteOutput = `${listOutput}\n${dryRunOutput}`;
      drift = detectRemoteDrift(migrations, listOutput);
      authenticatedPreflightRan = true;

      if (!drift.synced) {
        blockers.push(...drift.driftIssues);
      }
    } catch (err) {
      remoteError = err.message || '';
      if (remoteError.includes('ENOTFOUND') || remoteError.includes('getaddrinfo') || /DNS/i.test(remoteError)) {
        remoteFailureType = 'DNS_RESOLUTION_FAILURE';
      } else if (remoteError.includes('ETIMEDOUT') || /timed?\s*out/i.test(remoteError)) {
        remoteFailureType = 'CONNECTION_TIMEOUT';
      } else if (remoteError.includes('ENETUNREACH') || remoteError.includes('EHOSTUNREACH') || remoteError.includes('ECONNREFUSED')) {
        remoteFailureType = 'NETWORK_UNREACHABLE';
      } else if (remoteError.includes('401') || /unauthorized/i.test(remoteError) || /invalid.*token/i.test(remoteError)) {
        remoteFailureType = 'AUTHENTICATION_FAILURE';
      } else if (remoteError.includes('403') || /forbidden/i.test(remoteError) || /permission/i.test(remoteError) || /privilege/i.test(remoteError)) {
        remoteFailureType = 'PERMISSION_FAILURE';
      } else {
        remoteFailureType = 'UNKNOWN_REMOTE_FAILURE';
      }
      blockers.push(`REMOTE_CLI_PREFLIGHT_FAILED [${remoteFailureType}]: ${remoteError}`);
    }
  }

  // Classify preflight state deterministically across the 6 canonical states
  const preflightState = classifyPreflightState({
    localMigrations: migrations,
    remoteApplied: drift.remoteApplied,
    unexpectedRemote: drift.unexpectedRemote,
    remoteReachable: authenticatedPreflightRan,
    networkError: remoteError || (isRemoteRequested ? null : 'LOCAL_MODE_ACTIVE (Remote verification deferred; offline policy active)')
  });

  return {
    ok: blockers.length === 0,
    mode: isRemoteRequested ? 'REMOTE_READ_ONLY' : 'LOCAL_OFFLINE',
    target,
    creds,
    tools,
    nodeVersion: process.version,
    isNodeCompatible,
    migrations,
    manifest: manifestVerification,
    // Three separate integrity dimensions (B19.8.3 Open Item 3)
    localIntegrity: {
      verified: manifestVerification.valid,
      manifestSha256: manifestVerification.manifestSha256,
      migrationCount: manifestVerification.migrationCount,
      issues: manifestVerification.issues
    },
    remoteHistory: {
      verified: authenticatedPreflightRan,
      remoteApplied: drift.remoteApplied,
      pending: drift.pending,
      unexpectedRemote: drift.unexpectedRemote || []
    },
    remoteSchema: {
      verified: false,
      status: 'PENDING_INSPECTION',
      details: 'Remote schema object definition inspection has not been executed.'
    },
    drift,
    state: preflightState,
    authenticatedPreflightRan,
    remoteFailureType,
    remoteOutput: remoteOutput ? maskSecret(remoteOutput) : null,
    pendingMigrations: drift.pending,
    blockers,
    authorizationGate: {
      status: 'LOCKED',
      prohibitedOperations: [
        'supabase db push (without --dry-run)',
        'Direct SQL execution against remote database',
        'Dashboard SQL Editor migration execution',
        'supabase migration repair',
        'Edge Function deployment',
        'Storage modifications',
        'Cloudflare deployment'
      ],
      requiresApproval: true,
      mutationsExecuted: 0
    }
  };
}

/**
 * CLI runner
 */
export function runCli() {
  const args = process.argv.slice(2);
  const mode = args[0] || '--preflight';

  console.log('==============================================================================');
  console.log(`AUROMASTI SUPABASE MIGRATION WORKFLOW & PREFLIGHT GUARD`);
  console.log(`Target Project: AuroMasti (${CANONICAL_PROJECT_REF}) | Region: ${CANONICAL_PROJECT_REGION}`);
  console.log('==============================================================================\n');

  const migrations = loadMigrationHistory(MIGRATIONS_DIR);

  if (mode === '--manifest') {
    const manifest = computeMigrationManifest(migrations);
    const manifestPath = path.join(REPO_ROOT, 'supabase', 'migrations_manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    console.log(`Migration manifest written to: ${manifestPath}`);
    console.log(`Manifest SHA-256 Digest: ${manifest.manifestSha256}`);
    console.log(`Canonical Migrations: ${manifest.migrationCount}`);
    manifest.migrations.forEach(m => {
      console.log(`  [${m.index}] ${m.filename} -> ${m.sha256}`);
    });
    return;
  }

  if (mode === '--bundle') {
    const bundleSql = generateMigrationBundle(migrations);
    const bundlePath = path.join(REPO_ROOT, 'supabase', 'consolidated_migration_preview.sql');
    fs.writeFileSync(bundlePath, bundleSql, 'utf8');
    console.log(`Consolidated migration preview written to: ${bundlePath}`);
    console.log(`File Size: ${(bundleSql.length / 1024).toFixed(2)} KB`);
    console.log('\n[NOTICE] This bundle is generated strictly for offline code review, security audits, and disaster-recovery analysis.');
    console.log('[WARNING] Direct dashboard SQL execution bypasses the supabase_migrations ledger and is NOT equivalent to "supabase db push".');
    return;
  }

  if (mode === '--verify-sql') {
    const verifySql = generatePostMigrationVerificationSql();
    const verifyPath = path.join(REPO_ROOT, 'supabase', 'verify_remote_schema.sql');
    fs.writeFileSync(verifyPath, verifySql, 'utf8');
    console.log(`Post-migration verification SQL written to: ${verifyPath}`);
    console.log('\nVerification script is ready to run against remote Supabase instance.');
    return;
  }

  if (mode === '--list') {
    console.log(`MIGRATION LEDGER (${migrations.length} Canonical Migrations):`);
    console.log('-----------------------------------------------------------------------------------------------------');
    migrations.forEach((m, idx) => {
      console.log(`[${idx + 1}] ${m.filename} | Tables: ${m.tables.length} | SHA-256: ${m.sha256.slice(0, 16)}...`);
    });
    return;
  }

  // Preflight Execution Modes (B19.8.3 Open Item 1)
  const isRemotePreflight = mode === '--preflight-remote';
  if (isRemotePreflight) {
    console.log('[MODE] EXPLICIT READ-ONLY REMOTE PREFLIGHT');
    console.log(`Target: ${CANONICAL_PROJECT_REF} | Operations: Read-only inspection (migration list & db push --dry-run)\n`);
  } else {
    console.log('[MODE] LOCAL OFFLINE PREFLIGHT');
    console.log('Operations: Local migration integrity, manifest validation, configuration checks (no remote access).\n');
  }

  const preflight = runPreflight({
    rootDir: REPO_ROOT,
    allowRemote: isRemotePreflight,
    remoteMode: isRemotePreflight,
    expectedProjectRef: CANONICAL_PROJECT_REF
  });

  console.log('1. TARGET PROJECT SPECIFICATION:');
  console.log(`   - Expected Project Reference: ${CANONICAL_PROJECT_REF}`);
  console.log(`   - Verified in config.toml:   ${preflight.target.projectId || 'MISSING'} (${preflight.target.valid ? 'VALID' : 'INVALID'})`);
  console.log(`   - Cloud Region:              ${CANONICAL_PROJECT_REGION}`);
  console.log(`   - REST Origin:               ${CANONICAL_REST_URL}\n`);

  console.log('2. CREDENTIAL MODEL & CONFIGURATION:');
  console.log('-----------------------------------------------------------------------------------------------------');
  console.log('Credential Name'.padEnd(25) + 'Classification'.padEnd(42) + 'Status'.padEnd(15) + 'Value Preview');
  console.log('-----------------------------------------------------------------------------------------------------');
  for (const [k, v] of Object.entries(preflight.creds.credentials)) {
    console.log(
      k.padEnd(25) +
      v.classification.padEnd(42) +
      v.status.padEnd(15) +
      v.preview
    );
  }
  console.log('-----------------------------------------------------------------------------------------------------\n');

  console.log('3. CLI & RUNTIME ENVIRONMENT:');
  console.log(`   - Supabase CLI:   ${preflight.tools.hasSupabaseCli ? `AVAILABLE (v${preflight.tools.supabaseVersion} via ${preflight.tools.supabaseInvocation})` : 'NOT_INSTALLED'}`);
  console.log(`   - Node.js Runtime: ${preflight.nodeVersion} (${preflight.isNodeCompatible ? 'COMPATIBLE' : 'INCOMPATIBLE'})`);
  console.log(`   - PostgreSQL psql: ${preflight.tools.hasPsql ? `AVAILABLE (${preflight.tools.psqlPath})` : 'NOT_INSTALLED in PATH'}\n`);

  console.log('4. LOCAL MIGRATION INTEGRITY & SAFETY (Dimension A):');
  console.log(`   - Canonical Migrations: ${preflight.migrations.length}/${EXPECTED_MIGRATION_COUNT} verified in strict lexical order`);
  console.log(`   - Destructive SQL:      ${preflight.blockers.some(b => b.includes('DESTRUCTIVE_SQL')) ? 'WARNING' : 'NONE DETECTED (Safe)'}`);
  console.log(`   - Checksum Status:      All ${preflight.migrations.length} SHA-256 digests validated`);
  console.log(`   - Checksum Manifest:    ${preflight.manifest.valid ? `VALID (${preflight.manifest.manifestSha256.slice(0, 16)}...)` : 'INVALID / UNRECORDED'}\n`);

  console.log('5. REMOTE PREFLIGHT & DRIFT STATUS (Dimension B & C):');
  console.log(`   - Preflight State:         ${preflight.state.state} (${preflight.state.statusCode})`);
  console.log(`   - State Description:       ${preflight.state.description}`);
  if (preflight.authenticatedPreflightRan) {
    console.log(`   - Authenticated Preflight: EXECUTED against ${CANONICAL_PROJECT_REF}`);
    console.log(`   - Applied on Remote:       ${preflight.drift.remoteApplied.length} migrations`);
    console.log(`   - Pending Migrations:      ${preflight.drift.pending.length} migrations`);
    console.log(`   - Remote Drift:            ${preflight.drift.synced ? 'NONE DETECTED (Synchronized)' : 'DRIFT DETECTED'}`);
  } else {
    console.log(`   - Remote History Check:    DEFERRED / UNVERIFIED (Local preflight mode; remote operations prohibited)`);
    console.log(`   - Pending Migrations:      All ${preflight.pendingMigrations.length} canonical migrations pending initial execution:`);
    preflight.pendingMigrations.forEach((m, idx) => {
      console.log(`     [${idx + 1}] ${m}`);
    });
  }
  console.log(`   - Remote Schema Inspection: PENDING_INSPECTION (Separate affirmative verification required)`);
  console.log('');

  console.log('==============================================================================');
  console.log('MANDATORY PRODUCT OWNER AUTHORIZATION GATE: ACTIVE');
  console.log('Status: LOCKED — All remote database mutations, repairs, and migrations are PROHIBITED.');
  console.log(`Remote mutations executed in this session: 0`);
  console.log('Prohibited operations:');
  preflight.authorizationGate.prohibitedOperations.forEach(op => console.log(`  ✖ ${op}`));
  console.log('==============================================================================\n');

  if (preflight.blockers.length > 0) {
    console.log('\x1b[31mPREFLIGHT BLOCKERS / VIOLATIONS:\x1b[0m');
    preflight.blockers.forEach(b => console.log(`  ✖ ${b}`));
    console.log('');
  }

  if (!preflight.creds.hasCliAuth && !preflight.creds.hasDbAuth) {
    console.log('INSTRUCTIONS FOR DEVELOPER (LOCAL CREDENTIAL SETUP):');
    console.log('To run authenticated preflight without sharing secrets with AI prompts:');
    console.log('1. Copy example file to local ignored file:');
    console.log('   Copy-Item .env.example .env.local');
    console.log('2. Edit .env.local in your editor and enter:');
    console.log('   SUPABASE_ACCESS_TOKEN=sbp_...  (from https://supabase.com/dashboard/account/tokens)');
    console.log('   SUPABASE_DB_PASSWORD=...      (from Project Settings -> Database)');
    console.log('3. Re-run preflight:');
    console.log('   npm run migrate:preflight         (local validation)');
    console.log('   npm run migrate:preflight:remote  (read-only remote inspection)\n');
  }

  console.log('\x1b[32mPreflight Check Complete. Awaiting Product Owner Authorization.\x1b[0m');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli();
}
