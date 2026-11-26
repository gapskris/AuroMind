/**
 * AuroMasti Environment Configuration & Infrastructure Safety Test Suite
 *
 * Verifies:
 * 1. Gitignore quarantine rules for secret-bearing files (.env, .env.local, .env.*.local).
 * 2. Example templates (.env.example, .env.staging.example) contain placeholders only.
 * 3. Environment loader (scripts/load-env.mjs) precedence, type sanitization, and secret masking.
 * 4. Master validator (scripts/validate-env.mjs) catching security violations (e.g. service_role key as anon key).
 * 5. Supabase infrastructure validator (scripts/validate-supabase-config.mjs) verifying 10 migrations, 6 edge functions, RLS.
 * 6. Cloudflare Pages validator (scripts/validate-cloudflare-config.mjs) verifying _headers and _routes.json.
 * 7. Secret exposure scanner (scripts/validate-secret-exposure.mjs) verifying zero leaked credentials.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

import {
  parseEnvContent,
  maskSecret,
  isServiceRoleJwt,
  loadEnvironment
} from './scripts/load-env.mjs';

import {
  validateEnvironmentDictionary,
  EXPECTED_SUPABASE_PROJECT_ID,
  EXPECTED_SUPABASE_REGION
} from './scripts/validate-env.mjs';

import {
  validateSupabaseInfrastructure,
  CANONICAL_SUPABASE_PROJECT,
  EXPECTED_MIGRATIONS,
  EXPECTED_EDGE_FUNCTIONS
} from './scripts/validate-supabase-config.mjs';

import {
  validateCloudflareConfiguration,
  CANONICAL_CLOUDFLARE_PAGES
} from './scripts/validate-cloudflare-config.mjs';

import { runSecretExposureScan } from './scripts/validate-secret-exposure.mjs';
import { loadMigrationHistory, generateMigrationBundle, scanDestructiveSql, generatePostMigrationVerificationSql } from './scripts/migration-workflow.mjs';

const REPO_ROOT = process.cwd();

describe('AuroMasti Environment Configuration System', () => {

  test('ENV-01: Git-ignore rules strictly quarantine local secret files and permit example templates', () => {
    // Secret files MUST be ignored (exit code 0)
    const secretFiles = ['.env', '.env.local', '.env.staging.local', '.env.production.local', 'custom.local'];
    for (const f of secretFiles) {
      const out = execSync(`git check-ignore ${f}`, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
      assert.equal(out, f, `File ${f} must be ignored by .gitignore`);
    }

    // Example templates MUST NOT be ignored (exit code 1, throws in execSync)
    assert.throws(() => {
      execSync('git check-ignore .env.example', { cwd: REPO_ROOT, stdio: 'pipe' });
    }, 'git check-ignore must exit 1 on .env.example (meaning it is tracked)');

    assert.throws(() => {
      execSync('git check-ignore .env.staging.example', { cwd: REPO_ROOT, stdio: 'pipe' });
    }, 'git check-ignore must exit 1 on .env.staging.example (meaning it is tracked)');
  });

  test('ENV-02: scripts/load-env.mjs correctly parses, masks secrets, and detects service_role JWTs', () => {
    const raw = `
      # Comment line
      export PORT=3000
      BASE_URL="http://localhost:3000"
      SINGLE_QUOTED='test value'
      UNQUOTED=some_value # inline comment
      ANON_KEY=eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.signature
      SERVICE_KEY=eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature
    `;

    const parsed = parseEnvContent(raw);
    assert.equal(parsed.PORT, '3000');
    assert.equal(parsed.BASE_URL, 'http://localhost:3000');
    assert.equal(parsed.SINGLE_QUOTED, 'test value');
    assert.equal(parsed.UNQUOTED, 'some_value');

    // Secret masking
    const masked = maskSecret('super_secret_password_12345');
    assert.ok(masked.startsWith('super_'));
    assert.ok(masked.endsWith('2345'));
    assert.ok(masked.includes('[REDACTED]'));

    // Service role JWT detection
    assert.equal(isServiceRoleJwt(parsed.ANON_KEY), false, 'Anon key is not service_role');
    assert.equal(isServiceRoleJwt(parsed.SERVICE_KEY), true, 'Service key correctly flagged as service_role');
  });

  test('ENV-03: scripts/validate-env.mjs validates example templates and catches safety violations', () => {
    // 1. Validate .env.example
    const envExampleContent = fs.readFileSync(path.join(REPO_ROOT, '.env.example'), 'utf8');
    const envExample = parseEnvContent(envExampleContent);
    const resExample = validateEnvironmentDictionary(envExample, { environment: 'development' });
    assert.equal(resExample.errors.length, 0, '.env.example must have zero errors');
    assert.equal(envExample.COMMERCIAL_GATE_ENABLED, 'false', 'Commercial gate must be false');
    assert.equal(envExample.SUPABASE_PROJECT_ID, EXPECTED_SUPABASE_PROJECT_ID);

    // 2. Validate .env.staging.example
    const stagingContent = fs.readFileSync(path.join(REPO_ROOT, '.env.staging.example'), 'utf8');
    const stagingEnv = parseEnvContent(stagingContent);
    const resStaging = validateEnvironmentDictionary(stagingEnv, { environment: 'staging' });
    assert.equal(resStaging.errors.length, 0, '.env.staging.example must have zero errors');
    assert.equal(stagingEnv.COMMERCIAL_GATE_ENABLED, 'false');
    assert.equal(stagingEnv.SUPABASE_PROJECT_ID, EXPECTED_SUPABASE_PROJECT_ID);
    assert.equal(stagingEnv.SUPABASE_REGION, EXPECTED_SUPABASE_REGION);

    // 3. Negative safety test: Anon key containing service_role claims MUST be rejected
    const toxicEnv = {
      ...envExample,
      SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.fake_signature'
    };
    const resToxic = validateEnvironmentDictionary(toxicEnv);
    assert.equal(resToxic.valid, false, 'Must fail when anon key contains service_role');
    assert.ok(resToxic.errors.some(e => e.includes('SECURITY_VIOLATION')));

    // 4. Negative safety test: Commercial gate enabled MUST be rejected
    const badGateEnv = {
      ...envExample,
      COMMERCIAL_GATE_ENABLED: 'true'
    };
    const resGate = validateEnvironmentDictionary(badGateEnv);
    assert.equal(resGate.valid, false, 'Must fail when commercial gate is true');
  });

  test('ENV-04: scripts/validate-supabase-config.mjs verifies project, 10 migrations, 6 edge functions, and RLS', () => {
    const res = validateSupabaseInfrastructure(REPO_ROOT);
    assert.equal(res.valid, true, 'Supabase infrastructure must be valid');
    assert.equal(res.project.projectId, 'rlqrtbjynaihdspbqtce');
    assert.equal(res.project.region, 'ap-southeast-1');

    // Verify all 10 migrations present
    const migrationsDir = path.join(REPO_ROOT, 'supabase', 'migrations');
    for (const m of EXPECTED_MIGRATIONS) {
      assert.ok(fs.existsSync(path.join(migrationsDir, m)), `Migration ${m} must exist`);
    }

    // Verify all 6 edge functions present
    const functionsDir = path.join(REPO_ROOT, 'supabase', 'functions');
    for (const f of EXPECTED_EDGE_FUNCTIONS) {
      assert.ok(fs.existsSync(path.join(functionsDir, f)), `Edge function ${f} must exist`);
    }
  });

  test('ENV-05: scripts/validate-cloudflare-config.mjs verifies _headers and _routes.json', () => {
    const res = validateCloudflareConfiguration(REPO_ROOT);
    assert.equal(res.valid, true, 'Cloudflare Pages configuration must be valid');
    assert.equal(res.config.projectName, 'auromasti');
    assert.equal(res.config.stagingOrigin, 'https://staging.auromasti.pages.dev');

    // Verify _headers exists and contains frame-ancestors
    const headersContent = fs.readFileSync(path.join(REPO_ROOT, '_headers'), 'utf8');
    assert.ok(headersContent.includes("frame-ancestors 'self'"));
    assert.ok(headersContent.includes('Strict-Transport-Security'));
    assert.ok(headersContent.includes('X-Content-Type-Options: nosniff'));

    // Verify _routes.json exists and excludes assets/games
    const routesContent = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, '_routes.json'), 'utf8'));
    assert.equal(routesContent.version, 1);
    assert.ok(routesContent.exclude.includes('/assets/*'));
    assert.ok(routesContent.exclude.includes('/games/*'));
  });

  test('ENV-06: scripts/validate-secret-exposure.mjs confirms zero leaked secrets across repository', () => {
    const res = runSecretExposureScan(REPO_ROOT);
    assert.equal(res.valid, true, 'Repository must be 100% clean of secret exposure');
    assert.equal(res.violations.length, 0);
  });

  test('ENV-07: scripts/migration-workflow.mjs verifies 10 migrations, detects zero destructive operations, and bundles idempotent SQL', () => {
    const migrations = loadMigrationHistory();
    assert.equal(migrations.length, 10, 'Must load exactly 10 canonical migrations');

    for (const m of migrations) {
      assert.equal(m.destructive.length, 0, `Migration ${m.filename} must contain zero destructive SQL`);
      assert.ok(m.sha256.length === 64, `Migration ${m.filename} must have valid SHA-256`);
    }

    const bundle = generateMigrationBundle(migrations);
    assert.ok(bundle.includes('20261120000001_b5_core_schema.sql'));
    assert.ok(bundle.includes('20261123000002_b19_5_06_storage_buckets_and_rls.sql'));
    assert.ok(bundle.length > 50000, 'Consolidated SQL bundle must be populated');

    // Negative test: scanDestructiveSql catches dangerous commands
    const dangerousSql = 'DROP TABLE users; TRUNCATE TABLE game_saves;';
    const findings = scanDestructiveSql(dangerousSql);
    assert.ok(findings.length >= 2, 'Must flag DROP TABLE and TRUNCATE');
  });

  test('ENV-08: scripts/migration-workflow.mjs generates valid post-migration verification SQL', () => {
    const verifySql = generatePostMigrationVerificationSql();
    assert.ok(verifySql.includes('user_profiles'));
    assert.ok(verifySql.includes('storage_deletion_queue'));
    assert.ok(verifySql.includes('v_unprotected_tables'));
    assert.ok(verifySql.includes('v_unpinned_functions'));
    assert.ok(verifySql.includes('rlqrtbjynaihdspbqtce'));
  });

});
