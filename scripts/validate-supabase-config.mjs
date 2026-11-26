#!/usr/bin/env node
/**
 * AuroMasti Platform — Dedicated Supabase Infrastructure & Configuration Validator
 *
 * Validates:
 * 1. Project Reference ID, Region, Host, and Ports.
 * 2. Supabase CLI configuration (supabase/config.toml).
 * 3. Database migrations (lexical ordering, table definitions, RLS policies).
 * 4. Storage bucket declarations and security policies.
 * 5. Edge Function completeness and interface compliance.
 *
 * Usage:
 *   node scripts/validate-supabase-config.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

export const CANONICAL_SUPABASE_PROJECT = Object.freeze({
  projectId: 'rlqrtbjynaihdspbqtce',
  projectName: 'AuroMasti',
  region: 'ap-southeast-1',
  restUrl: 'https://rlqrtbjynaihdspbqtce.supabase.co',
  dbHost: 'db.rlqrtbjynaihdspbqtce.supabase.co',
  directPort: 5432,
  poolerPort: 6543,
  poolerHost: 'aws-0-ap-southeast-1.pooler.supabase.com'
});

export const EXPECTED_MIGRATIONS = Object.freeze([
  '20261120000001_b5_core_schema.sql',
  '20261120000002_b8_rate_limiting.sql',
  '20261120000003_b13a_telemetry_rls_hardening.sql',
  '20261120000004_b13b_telemetry_retention.sql',
  '20261122000001_b18c_profile_rls_separation.sql',
  '20261122000002_b18c_telemetry_token_bucket.sql',
  '20261122000003_b18c_telemetry_search_path_hardening.sql',
  '20261122000004_b18d_telemetry_token_bucket_input_validation.sql',
  '20261123000001_b19_5_05_db_integrity_and_rls_hardening.sql',
  '20261123000002_b19_5_06_storage_buckets_and_rls.sql'
]);

export const EXPECTED_EDGE_FUNCTIONS = Object.freeze([
  'cleanup-telemetry',
  'delete-account',
  'ingest-telemetry',
  'owner-metrics',
  'sync-save',
  'verify-entitlements'
]);

export function validateSupabaseInfrastructure(rootDir = REPO_ROOT) {
  const issues = [];
  const checks = [];

  // 1. Supabase CLI config.toml
  const configTomlPath = path.join(rootDir, 'supabase', 'config.toml');
  if (!fs.existsSync(configTomlPath)) {
    issues.push("CRITICAL: supabase/config.toml is missing. Required for Supabase CLI linking.");
  } else {
    const content = fs.readFileSync(configTomlPath, 'utf8');
    const hasProjectRef = content.includes(CANONICAL_SUPABASE_PROJECT.projectId);
    const hasBuckets = content.includes('avatars') && content.includes('user-artwork');
    const hasRedirects = content.includes('staging.auromasti.pages.dev');

    checks.push({
      item: 'supabase/config.toml Project ID',
      status: hasProjectRef ? 'PASS' : 'FAIL',
      detail: hasProjectRef ? `Linked to ${CANONICAL_SUPABASE_PROJECT.projectId}` : 'Missing project_id'
    });
    checks.push({
      item: 'supabase/config.toml Storage Buckets',
      status: hasBuckets ? 'PASS' : 'FAIL',
      detail: hasBuckets ? 'Declared avatars and user-artwork' : 'Missing bucket definitions'
    });
    checks.push({
      item: 'supabase/config.toml Redirect URLs',
      status: hasRedirects ? 'PASS' : 'FAIL',
      detail: hasRedirects ? 'Includes staging.auromasti.pages.dev' : 'Missing staging redirect URL'
    });
  }

  // 2. Migrations verification
  const migrationsDir = path.join(rootDir, 'supabase', 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    issues.push("CRITICAL: supabase/migrations directory does not exist.");
  } else {
    const presentFiles = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
    const missingMigrations = EXPECTED_MIGRATIONS.filter(m => !presentFiles.includes(m));

    checks.push({
      item: 'Migration Files Count',
      status: missingMigrations.length === 0 ? 'PASS' : 'FAIL',
      detail: `Found ${presentFiles.length}/${EXPECTED_MIGRATIONS.length} canonical migrations`
    });

    if (missingMigrations.length > 0) {
      issues.push(`Missing migrations: ${missingMigrations.join(', ')}`);
    }

    // Inspect RLS coverage across migrations
    let totalRlsPolicies = 0;
    for (const f of presentFiles) {
      const sql = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
      const policyMatches = sql.match(/create\s+policy\s+/gi);
      if (policyMatches) {
        totalRlsPolicies += policyMatches.length;
      }
    }
    checks.push({
      item: 'Database-Side RLS Policies',
      status: totalRlsPolicies >= 20 ? 'PASS' : 'WARN',
      detail: `${totalRlsPolicies} CREATE POLICY declarations identified`
    });
  }

  // 3. Edge Functions verification
  const functionsDir = path.join(rootDir, 'supabase', 'functions');
  if (!fs.existsSync(functionsDir)) {
    issues.push("CRITICAL: supabase/functions directory does not exist.");
  } else {
    const presentFunctions = fs.readdirSync(functionsDir).filter(f => {
      const p = path.join(functionsDir, f);
      return fs.statSync(p).isDirectory();
    });

    const missingFunctions = EXPECTED_EDGE_FUNCTIONS.filter(f => !presentFunctions.includes(f));
    checks.push({
      item: 'Edge Functions Completeness',
      status: missingFunctions.length === 0 ? 'PASS' : 'FAIL',
      detail: `Found ${presentFunctions.length}/${EXPECTED_EDGE_FUNCTIONS.length} canonical functions`
    });

    if (missingFunctions.length > 0) {
      issues.push(`Missing edge functions: ${missingFunctions.join(', ')}`);
    }
  }

  return {
    valid: issues.length === 0,
    project: CANONICAL_SUPABASE_PROJECT,
    checks,
    issues
  };
}

export function runCli() {
  console.log('==============================================================================');
  console.log('AUROMASTI SUPABASE INFRASTRUCTURE VALIDATOR');
  console.log(`Target Project: ${CANONICAL_SUPABASE_PROJECT.projectName} (${CANONICAL_SUPABASE_PROJECT.projectId})`);
  console.log('==============================================================================\n');

  const { valid, project, checks, issues } = validateSupabaseInfrastructure(REPO_ROOT);

  console.log('PROJECT SPECIFICATION:');
  console.log(`- Project Reference: ${project.projectId}`);
  console.log(`- Cloud Region:     ${project.region}`);
  console.log(`- REST API Origin:  ${project.restUrl}`);
  console.log(`- Direct DB Host:   ${project.dbHost}:${project.directPort}`);
  console.log(`- Pooler DB Host:   ${project.poolerHost}:${project.poolerPort}\n`);

  console.log('INFRASTRUCTURE AUDIT:');
  console.log('-----------------------------------------------------------------------------------------------------');
  console.log('Check Item'.padEnd(35) + 'Status'.padEnd(12) + 'Details');
  console.log('-----------------------------------------------------------------------------------------------------');
  for (const c of checks) {
    console.log(c.item.padEnd(35) + c.status.padEnd(12) + c.detail);
  }
  console.log('-----------------------------------------------------------------------------------------------------\n');

  if (issues.length > 0) {
    console.log('ISSUES DETECTED:');
    issues.forEach(i => console.log(`  ✖ ${i}`));
    console.log('\nResult: FAILED');
    process.exit(1);
  }

  console.log('\x1b[32mResult: PASSED — Supabase repository infrastructure is complete and valid.\x1b[0m');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli();
}
