#!/usr/bin/env node
/**
 * AuroMind B19.5-05 — Reproducible Local PostgreSQL Migration & RLS Runner
 *
 * Probes for a local PostgreSQL runtime (`psql` / `createdb` / `dropdb`, or Docker).
 * - When a PostgreSQL runtime is available:
 *     1. Creates a disposable isolated database (`auromind_test_<timestamp>`).
 *     2. Bootstraps Supabase-compatible `auth` schema + `anon`, `authenticated`, `service_role`.
 *     3. Applies every migration in `supabase/migrations/*.sql` in strict lexical order.
 *     4. Re-applies idempotent migrations to verify repeatability.
 *     5. Executes `tests/rls/b18-d-rls-pgtap-matrix.sql` and
 *        `tests/rls/b19-5-05-postgres-runtime-verification.sql`.
 *     6. Drops the disposable database cleanly in a `finally` block.
 * - When NO PostgreSQL runtime is installed locally:
 *     Reports exact missing prerequisites (`RUNTIME_UNAVAILABLE`) and exits with code 2.
 *     Never substitutes JavaScript simulations or static parsing as database validation.
 *
 * Usage:
 *   node scripts/verify-postgres-migrations.mjs [--probe]
 *   DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres node scripts/verify-postgres-migrations.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'supabase', 'migrations');
const RLS_TESTS = [
  path.join(REPO_ROOT, 'tests', 'rls', 'b18-d-rls-pgtap-matrix.sql'),
  path.join(REPO_ROOT, 'tests', 'rls', 'b19-5-05-postgres-runtime-verification.sql')
];

function commandExists(cmd) {
  const probeCmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    const out = execFileSync(probeCmd, [cmd], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.trim().split(/\r?\n/)[0] || null;
  } catch {
    return null;
  }
}

export function probeLocalDatabaseRuntime() {
  const tools = {
    psql: commandExists('psql'),
    createdb: commandExists('createdb'),
    dropdb: commandExists('dropdb'),
    docker: commandExists('docker'),
    supabase: commandExists('supabase')
  };
  return {
    hasPsql: Boolean(tools.psql),
    hasDocker: Boolean(tools.docker),
    hasSupabaseCli: Boolean(tools.supabase),
    tools
  };
}

export function listMigrationsInOrder() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    return [];
  }
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b))
    .map((f) => path.join(MIGRATIONS_DIR, f));
}

function runPsql(connUrl, args = [], input = null) {
  const fullArgs = [connUrl, '-v', 'ON_ERROR_STOP=1', ...args];
  return execFileSync('psql', fullArgs, {
    encoding: 'utf8',
    input: input ?? undefined,
    stdio: [input !== null ? 'pipe' : 'ignore', 'pipe', 'pipe']
  });
}

function buildBootstrapSql() {
  return `
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key,
  email text
);
create or replace function auth.uid() returns uuid as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'), '')
  )::uuid;
$$ language sql stable;

do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end;
$$;

grant usage on schema public, auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
`;
}

async function main() {
  const probeOnly = process.argv.includes('--probe');
  const runtime = probeLocalDatabaseRuntime();
  const migrations = listMigrationsInOrder();

  if (probeOnly) {
    console.log(JSON.stringify({
      status: runtime.hasPsql ? 'RUNTIME_AVAILABLE' : 'RUNTIME_UNAVAILABLE',
      runtime,
      migrationCount: migrations.length,
      rlsTestCount: RLS_TESTS.length
    }, null, 2));
    process.exit(runtime.hasPsql ? 0 : 2);
  }

  if (!runtime.hasPsql) {
    console.error('RUNTIME_UNAVAILABLE: No local PostgreSQL client (`psql`) detected.');
    console.error('Tool probe:', JSON.stringify(runtime.tools));
    console.error('Prerequisite: Install PostgreSQL 15+ (with psql) or Supabase CLI + Docker, then re-run:');
    console.error('  DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres node scripts/verify-postgres-migrations.mjs');
    process.exit(2);
  }

  const adminUrl = process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/postgres';
  const parsed = new URL(adminUrl);
  const testDbName = `auromind_b19_5_05_${Date.now()}`;
  const testUrl = new URL(adminUrl);
  testUrl.pathname = `/${testDbName}`;

  console.log(`Creating disposable PostgreSQL database: ${testDbName}`);
  runPsql(adminUrl, ['-c', `CREATE DATABASE "${testDbName}";`]);

  try {
    console.log('Bootstrapping Supabase-compatible auth schema and roles...');
    runPsql(testUrl.toString(), [], buildBootstrapSql());

    console.log(`Applying ${migrations.length} migrations in chronological order...`);
    for (const migrationFile of migrations) {
      console.log(`  -> ${path.basename(migrationFile)}`);
      runPsql(testUrl.toString(), ['-f', migrationFile]);
    }

    // Verify repeatability of the hardening migration
    const latestMigration = migrations[migrations.length - 1];
    console.log(`Verifying idempotent re-application of ${path.basename(latestMigration)}...`);
    runPsql(testUrl.toString(), ['-f', latestMigration]);

    // Execute real PostgreSQL RLS & RPC verification suites
    for (const testSql of RLS_TESTS) {
      console.log(`Running SQL verification suite: ${path.basename(testSql)}`);
      const output = runPsql(testUrl.toString(), ['-f', testSql]);
      if (output.trim()) {
        console.log(output.trim());
      }
    }

    console.log('ALL REAL POSTGRESQL MIGRATION, RLS, AND RPC CHECKS PASSED.');
  } finally {
    try {
      runPsql(adminUrl, ['-c', `DROP DATABASE IF EXISTS "${testDbName}" WITH (FORCE);`]);
    } catch {
      try {
        runPsql(adminUrl, ['-c', `DROP DATABASE IF EXISTS "${testDbName}";`]);
      } catch {
        // Best-effort cleanup
      }
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((err) => {
    console.error('POSTGRES_VERIFICATION_FAILED:', err.stderr || err.message || err);
    process.exit(1);
  });
}
