/**
 * AuroMasti Platform — Supabase Credential Setup & Migration Preflight Guard Test Suite
 *
 * Verifies:
 * 1. Target Project Verification (enforcing canonical 'rlqrtbjynaihdspbqtce' and fail-closed on mismatch).
 * 2. Credential Model Separation (SUPABASE_ACCESS_TOKEN != SUPABASE_DB_PASSWORD).
 * 3. Service Role Rejection (rejecting service_role JWT key substitution).
 * 4. Migration Inventory & Ordering (10 canonical files in strict lexical sequence with SHA-256 hashes).
 * 5. Destructive SQL Detection (fails closed on DROP / TRUNCATE).
 * 6. Remote Schema Drift Detection (fails closed if remote has unexpected migrations).
 * 7. Pending Migrations Calculation (correctly lists all 10 canonical files).
 * 8. Product Owner Authorization Gate (locked status, 0 remote mutations).
 * 9. Secret Redaction & Log Safety (all secrets masked).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  CANONICAL_PROJECT_REF,
  CANONICAL_REST_URL,
  EXPECTED_MIGRATION_COUNT,
  PREFLIGHT_STATES,
  classifyPreflightState,
  loadMigrationHistory,
  scanDestructiveSql,
  validateTargetProject,
  checkCredentialModel,
  detectRemoteDrift,
  runPreflight,
  probeCliTools,
  runSupabaseCli
} from './scripts/migration-workflow.mjs';

const REPO_ROOT = process.cwd();

describe('Supabase Migration Workflow & Preflight Guard Suite', () => {

  test('PREFLIGHT-01: Target project verification strictly enforces canonical rlqrtbjynaihdspbqtce', () => {
    // Current repository config.toml should be valid
    const res = validateTargetProject(REPO_ROOT);
    assert.equal(res.valid, true, 'config.toml must be valid');
    assert.equal(res.projectId, CANONICAL_PROJECT_REF);
    assert.equal(res.issues.length, 0);

    // Negative test: Mismatched project ID must fail closed
    const fakeDir = path.join(REPO_ROOT, 'test-temp-fake-project');
    const fakeRes = validateTargetProject(fakeDir);
    assert.equal(fakeRes.valid, false, 'Missing config must fail closed');
    assert.ok(fakeRes.issues.length > 0);
  });

  test('PREFLIGHT-02: Credential model enforces strict separation between Access Token and DB Password', () => {
    // 1. Separate credentials should be valid
    const validCreds = {
      SUPABASE_URL: CANONICAL_REST_URL,
      SUPABASE_PROJECT_ID: CANONICAL_PROJECT_REF,
      SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.signature1',
      SUPABASE_ACCESS_TOKEN: 'sbp_mock_access_token_1234567890abcdef',
      SUPABASE_DB_PASSWORD: 'SuperSecretDatabasePassword2027!'
    };
    const resValid = checkCredentialModel(validCreds);
    assert.equal(resValid.valid, true);
    assert.equal(resValid.hasCliAuth, true);
    assert.equal(resValid.hasDbAuth, true);
    assert.equal(resValid.hasAnonAuth, true);
    assert.equal(resValid.violations.length, 0);

    // 2. Identical credentials MUST fail closed
    const toxicIdentical = {
      ...validCreds,
      SUPABASE_ACCESS_TOKEN: 'SameSecretStringValue12345',
      SUPABASE_DB_PASSWORD: 'SameSecretStringValue12345'
    };
    const resIdentical = checkCredentialModel(toxicIdentical);
    assert.equal(resIdentical.valid, false);
    assert.ok(resIdentical.violations.some(v => v.includes('CONFIGURATION_ERROR')));
  });

  test('PREFLIGHT-03: Credential model strictly rejects service_role JWT key substitution', () => {
    const serviceRoleJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signatureServiceRole';

    // 1. Service role as anon key MUST be rejected
    const toxicAnon = {
      SUPABASE_ANON_KEY: serviceRoleJwt
    };
    const resAnon = checkCredentialModel(toxicAnon);
    assert.equal(resAnon.valid, false);
    assert.ok(resAnon.violations.some(v => v.includes('SUPABASE_ANON_KEY has service_role claims')));

    // 2. Service role as CLI access token MUST be rejected
    const toxicToken = {
      SUPABASE_ACCESS_TOKEN: serviceRoleJwt
    };
    const resToken = checkCredentialModel(toxicToken);
    assert.equal(resToken.valid, false);
    assert.ok(resToken.violations.some(v => v.includes('SUPABASE_ACCESS_TOKEN has service_role claims')));

    // 3. Service role as DB password MUST be rejected
    const toxicDb = {
      SUPABASE_DB_PASSWORD: serviceRoleJwt
    };
    const resDb = checkCredentialModel(toxicDb);
    assert.equal(resDb.valid, false);
    assert.ok(resDb.violations.some(v => v.includes('SUPABASE_DB_PASSWORD has service_role claims')));
  });

  test('PREFLIGHT-04: Migration inventory verifies all 10 canonical migrations in chronological lexical order', () => {
    const migrations = loadMigrationHistory();
    assert.equal(migrations.length, EXPECTED_MIGRATION_COUNT, `Must contain exactly ${EXPECTED_MIGRATION_COUNT} migrations`);

    // Verify chronological lexical ordering
    for (let i = 1; i < migrations.length; i++) {
      const prev = migrations[i - 1].filename;
      const curr = migrations[i].filename;
      assert.ok(prev < curr, `Migrations must be in strict lexical order: ${prev} < ${curr}`);
    }

    // Verify SHA-256 digests
    for (const m of migrations) {
      assert.equal(m.sha256.length, 64, `Migration ${m.filename} must have 64-char SHA-256`);
      assert.equal(m.destructive.length, 0, `Migration ${m.filename} must contain zero destructive SQL`);
    }
  });

  test('PREFLIGHT-05: Destructive SQL guard detects dangerous operations and fails closed', () => {
    const dangerousQueries = [
      'DROP TABLE user_profiles;',
      'TRUNCATE TABLE game_saves;',
      'DROP DATABASE postgres;',
      'DROP SCHEMA public CASCADE;'
    ];

    for (const q of dangerousQueries) {
      const findings = scanDestructiveSql(q);
      assert.ok(findings.length > 0, `Query '${q}' must be flagged as destructive`);
    }

    // Safe queries should have 0 findings
    const safeQueries = [
      'CREATE TABLE IF NOT EXISTS test_table (id uuid primary key);',
      'DROP TABLE IF EXISTS temporary_scratch_table;',
      'CREATE INDEX IF NOT EXISTS idx_test ON test_table(id);'
    ];
    for (const sq of safeQueries) {
      const findings = scanDestructiveSql(sq);
      assert.equal(findings.length, 0, `Safe query '${sq}' should not be flagged`);
    }
  });

  test('PREFLIGHT-06: Remote schema drift detector flags unexpected remote migrations', () => {
    const migrations = loadMigrationHistory();

    // 1. Normal synchronized scenario
    const mockOutputSync = `
      20261120000001_b5_core_schema.sql | Applied
      20261120000002_b8_rate_limiting.sql | Applied
    `;
    const driftSync = detectRemoteDrift(migrations, mockOutputSync);
    assert.equal(driftSync.synced, true);
    assert.equal(driftSync.remoteApplied.length, 2);
    assert.equal(driftSync.pending.length, 8);
    assert.equal(driftSync.driftIssues.length, 0);

    // 2. Drift scenario: remote has an untracked rogue migration
    const mockOutputDrift = `
      20261120000001_b5_core_schema.sql | Applied
      20269999999999_rogue_manual_migration.sql | Applied
    `;
    const driftRogue = detectRemoteDrift(migrations, mockOutputDrift);
    assert.equal(driftRogue.synced, false, 'Must flag unexpected migration as drift');
    assert.ok(driftRogue.driftIssues.some(d => d.includes('rogue_manual_migration.sql')));
    assert.equal(driftRogue.unexpectedRemote.length, 1);
  });

  test('PREFLIGHT-07: Preflight execution accurately reports pending migrations and deferral status', () => {
    const preflight = runPreflight({ rootDir: REPO_ROOT });
    assert.equal(preflight.target.valid, true);
    assert.equal(preflight.migrations.length, 10);
    assert.equal(preflight.pendingMigrations.length, 10);

    // Since developer credentials are not yet entered in .env.local, authenticated preflight is deferred
    assert.equal(preflight.authenticatedPreflightRan, false);
    assert.equal(preflight.drift.pending.length, 10);
  });

  test('PREFLIGHT-08: Mandatory Product Owner Authorization Gate is locked with 0 mutations', () => {
    const preflight = runPreflight({ rootDir: REPO_ROOT });
    assert.equal(preflight.authorizationGate.status, 'LOCKED');
    assert.equal(preflight.authorizationGate.requiresApproval, true);
    assert.equal(preflight.authorizationGate.mutationsExecuted, 0);
    assert.ok(preflight.authorizationGate.prohibitedOperations.includes('supabase db push (without --dry-run)'));
    assert.ok(preflight.authorizationGate.prohibitedOperations.includes('Direct SQL execution against remote database'));
  });

  test('PREFLIGHT-09: Secrets are strictly redacted in preflight credentials report', () => {
    const envWithSecrets = {
      SUPABASE_URL: CANONICAL_REST_URL,
      SUPABASE_PROJECT_ID: CANONICAL_PROJECT_REF,
      SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.secretanonkey12345',
      SUPABASE_ACCESS_TOKEN: 'sbp_super_secret_developer_token_987654321',
      SUPABASE_DB_PASSWORD: 'UltraSecretPostgresPassword#2027'
    };

    const preflight = runPreflight({ env: envWithSecrets, rootDir: REPO_ROOT });
    const creds = preflight.creds.credentials;

    assert.ok(!creds.SUPABASE_ACCESS_TOKEN.preview.includes('developer_token'));
    assert.ok(creds.SUPABASE_ACCESS_TOKEN.preview.includes('[REDACTED]'));

    assert.ok(!creds.SUPABASE_DB_PASSWORD.preview.includes('PostgresPassword'));
    assert.ok(creds.SUPABASE_DB_PASSWORD.preview.includes('[REDACTED]'));

    assert.ok(!creds.SUPABASE_ANON_KEY.preview.includes('secretanonkey'));
    assert.ok(creds.SUPABASE_ANON_KEY.preview.includes('[REDACTED]'));
  });

  test('PREFLIGHT-10: Project-level Supabase CLI is detected and reliably invoked via npx supabase', () => {
    const tools = probeCliTools(REPO_ROOT);
    assert.equal(tools.hasSupabaseCli, true, 'Project-level Supabase CLI must be detected');
    assert.equal(tools.supabaseInvocation, 'npx supabase', 'Invocation must use npx supabase');
    assert.ok(tools.supabaseVersion, 'Supabase CLI version must be reported');
    assert.equal(tools.supabaseVersion, '3.4.0', 'Pinned version must be 3.4.0');

    // Run execution test via runSupabaseCli
    const output = runSupabaseCli(['--version'], { rootDir: REPO_ROOT }).trim();
    assert.equal(output, '3.4.0', 'npx supabase --version must return 3.4.0');
  });

  test('PREFLIGHT-11: Credential model accepts SUPABASE_PUBLISHABLE_KEY (sb_publishable_...) and rejects sb_secret_', () => {
    // 1. Valid publishable key format
    const validPublishable = {
      SUPABASE_URL: CANONICAL_REST_URL,
      SUPABASE_PROJECT_ID: CANONICAL_PROJECT_REF,
      SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abcdef12345678901234'
    };
    const resValid = checkCredentialModel(validPublishable);
    assert.equal(resValid.valid, true, 'SUPABASE_PUBLISHABLE_KEY must be valid');
    assert.equal(resValid.credentials.SUPABASE_PUBLISHABLE_KEY.status, 'CONFIGURED');
    assert.equal(resValid.credentials.SUPABASE_PUBLISHABLE_KEY.preview, '[REDACTED]');

    // 2. Reject sb_secret_ format as publishable key
    const toxicSecretKey = {
      SUPABASE_URL: CANONICAL_REST_URL,
      SUPABASE_PROJECT_ID: CANONICAL_PROJECT_REF,
      SUPABASE_PUBLISHABLE_KEY: 'sb_secret_developer_admin_token_99999'
    };
    const resToxic = checkCredentialModel(toxicSecretKey);
    assert.equal(resToxic.valid, false, 'sb_secret_ format must be rejected');
    assert.ok(resToxic.violations.some(v => v.includes('SECURITY_VIOLATION')));

    // 3. Precedence: SUPABASE_PUBLISHABLE_KEY overrides SUPABASE_ANON_KEY
    const dualKeyEnv = {
      SUPABASE_URL: CANONICAL_REST_URL,
      SUPABASE_PROJECT_ID: CANONICAL_PROJECT_REF,
      SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_canonical_precedence_123',
      SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.sig'
    };
    const resDual = checkCredentialModel(dualKeyEnv);
    assert.equal(resDual.valid, true);
    assert.equal(resDual.credentials.SUPABASE_PUBLISHABLE_KEY.status, 'CONFIGURED');
    assert.equal(resDual.credentials.SUPABASE_ANON_KEY.status, 'CONFIGURED');
  });

  test('PREFLIGHT-12: Deterministic classification of all 6 canonical remote preflight states', () => {
    const migrations = loadMigrationHistory();
    const localNames = migrations.map(m => m.filename);

    // State 1: Remote history unavailable (network/IPv6/timeout/offline)
    const state1 = classifyPreflightState({
      localMigrations: migrations,
      remoteReachable: false,
      networkError: 'ENETUNREACH: Network is unreachable'
    });
    assert.equal(state1.state, PREFLIGHT_STATES.UNVERIFIED);
    assert.equal(state1.statusCode, 'UNVERIFIED');
    assert.equal(state1.readyForMigration, false);
    assert.equal(state1.requiresIntervention, false);
    assert.equal(state1.pendingMigrations.length, EXPECTED_MIGRATION_COUNT);

    // State 2: Remote history empty (clean initial state)
    const state2 = classifyPreflightState({
      localMigrations: migrations,
      remoteApplied: [],
      unexpectedRemote: [],
      remoteReachable: true,
      schemaTables: []
    });
    assert.equal(state2.state, PREFLIGHT_STATES.CLEAN_INITIAL_STATE);
    assert.equal(state2.statusCode, 'CLEAN_INITIAL_STATE');
    assert.equal(state2.readyForMigration, true);
    assert.equal(state2.requiresIntervention, false);
    assert.equal(state2.pendingMigrations.length, EXPECTED_MIGRATION_COUNT);

    // State 3: Remote migrations behind local
    const appliedSubset = [localNames[0], localNames[1], localNames[2]];
    const state3 = classifyPreflightState({
      localMigrations: migrations,
      remoteApplied: appliedSubset,
      unexpectedRemote: [],
      remoteReachable: true
    });
    assert.equal(state3.state, PREFLIGHT_STATES.MIGRATIONS_PENDING);
    assert.equal(state3.statusCode, 'MIGRATIONS_PENDING');
    assert.equal(state3.readyForMigration, true);
    assert.equal(state3.requiresIntervention, false);
    assert.equal(state3.appliedMigrations.length, 3);
    assert.equal(state3.pendingMigrations.length, 7);

    // State 4: Remote migrations ahead of local (untracked remote migrations)
    const state4 = classifyPreflightState({
      localMigrations: migrations,
      remoteApplied: [localNames[0]],
      unexpectedRemote: ['20269999999999_rogue_migration.sql'],
      remoteReachable: true
    });
    assert.equal(state4.state, PREFLIGHT_STATES.DRIFT_AHEAD);
    assert.equal(state4.statusCode, 'DRIFT_AHEAD');
    assert.equal(state4.readyForMigration, false);
    assert.equal(state4.requiresIntervention, true);
    assert.equal(state4.unexpectedRemote.length, 1);

    // State 5: Migration history inconsistent with actual schema (divergence)
    const state5 = classifyPreflightState({
      localMigrations: migrations,
      remoteApplied: [localNames[0]], // migration 1 creates user_profiles, guest_identity_links, game_saves
      unexpectedRemote: [],
      remoteReachable: true,
      schemaTables: [] // schema table query returned empty
    });
    assert.equal(state5.state, PREFLIGHT_STATES.SCHEMA_HISTORY_DIVERGENCE);
    assert.equal(state5.statusCode, 'SCHEMA_HISTORY_DIVERGENCE');
    assert.equal(state5.readyForMigration, false);
    assert.equal(state5.requiresIntervention, true);
    assert.ok(state5.missingTables.length > 0);

    // State 6: Schema already containing conflicting objects
    const state6 = classifyPreflightState({
      localMigrations: migrations,
      remoteApplied: [], // schema_migrations says nothing applied
      unexpectedRemote: [],
      remoteReachable: true,
      schemaTables: ['user_profiles', 'game_saves'] // but tables exist
    });
    assert.equal(state6.state, PREFLIGHT_STATES.OBJECT_COLLISION_DETECTED);
    assert.equal(state6.statusCode, 'OBJECT_COLLISION_DETECTED');
    assert.equal(state6.readyForMigration, false);
    assert.equal(state6.requiresIntervention, true);
    assert.equal(state6.conflictingTables.length, 2);

    // Verify preflight report includes the classified state object
    const preflight = runPreflight({ rootDir: REPO_ROOT });
    assert.ok(preflight.state);
    assert.equal(preflight.state.state, PREFLIGHT_STATES.UNVERIFIED);
  });

});
