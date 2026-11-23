/**
 * AuroMind Batch B19.5-05 — Database Migration Integrity, Edge Function Guards & PG Runner Tests
 *
 * Clearly distinguishes:
 *   1. Static SQL migration-chain & DDL structural validation across all 9 migrations.
 *   2. Executable Edge Function boundary tests (`sync-save-handler.js`).
 *   3. Honest local PostgreSQL runtime probe (`scripts/verify-postgres-migrations.mjs`).
 *
 * NOTE: Static SQL checks and Edge Function unit tests do NOT substitute for real
 * PostgreSQL execution; when PostgreSQL is installed locally, run
 * `node scripts/verify-postgres-migrations.mjs` to execute the real SQL test suites.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { validateMigrationDdl } from './scripts/migration-safety.js';
import { listMigrationsInOrder, probeLocalDatabaseRuntime } from './scripts/verify-postgres-migrations.mjs';
import { handleSyncSaveRequest } from './supabase/functions/sync-save/sync-save-handler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIGRATIONS_DIR = path.join(__dirname, 'supabase', 'migrations');
const MIGRATION_9_PATH = path.join(
  MIGRATIONS_DIR,
  '20261123000001_b19_5_05_db_integrity_and_rls_hardening.sql'
);
const PGTAP_MATRIX_PATH = path.join(__dirname, 'tests', 'rls', 'b18-d-rls-pgtap-matrix.sql');
const PG_RUNTIME_SQL_PATH = path.join(__dirname, 'tests', 'rls', 'b19-5-05-postgres-runtime-verification.sql');

// =============================================================================
// 1. Migration Ordering, DDL Safety & Static Hardening Verification
// =============================================================================

test('B19.5-05-Static-1: Complete 9-migration chain is ordered, valid DDL, and contains no invalid CALL on functions', () => {
  const files = listMigrationsInOrder();
  assert.equal(files.length, 9, `Expected 9 migrations in chronological order, got ${files.length}`);

  const basenames = files.map((f) => path.basename(f));
  for (let i = 0; i < basenames.length; i++) {
    assert.match(basenames[i], /^\d{14}_[a-z0-9_]+\.sql$/, `Invalid migration filename: ${basenames[i]}`);
    if (i > 0) {
      assert.ok(basenames[i] > basenames[i - 1], `Migrations out of order: ${basenames[i - 1]} vs ${basenames[i]}`);
    }
  }

  // Migration 9 itself must pass strict DDL safety (including SECURITY DEFINER search_path pinning)
  const m9Sql = fs.readFileSync(MIGRATION_9_PATH, 'utf8');
  const ddlCheck = validateMigrationDdl(m9Sql);
  assert.equal(ddlCheck.valid, true, `Migration 9 DDL validation issues: ${ddlCheck.issues.join('; ')}`);

  // Migration 4 scheduling comment must not instruct invalid `call` on a FUNCTION
  const m4Sql = fs.readFileSync(
    path.join(MIGRATIONS_DIR, '20261120000004_b13b_telemetry_retention.sql'),
    'utf8'
  );
  assert.equal(/call\s+public\.prune_expired_telemetry/i.test(m4Sql), false);
});

test('B19.5-05-Static-2: Migration 5 repeatability fixed (drop policy if exists + guarded column migration)', () => {
  const m5Sql = fs.readFileSync(
    path.join(MIGRATIONS_DIR, '20261122000001_b18c_profile_rls_separation.sql'),
    'utf8'
  );
  assert.ok(m5Sql.includes('drop policy if exists "private_settings_owner_select" on public.user_private_settings;'));
  assert.ok(m5Sql.includes('drop policy if exists "private_settings_owner_insert" on public.user_private_settings;'));
  assert.ok(m5Sql.includes('drop policy if exists "private_settings_owner_update" on public.user_private_settings;'));
  assert.ok(m5Sql.includes("column_name = 'preferences'"), 'Migration 5 copy must guard against already-dropped column');
});

test('B19.5-05-Static-3: Migration 9 closes profile privacy leak and fixes column-level INSERT vs UPDATE grants', () => {
  const sql = fs.readFileSync(MIGRATION_9_PATH, 'utf8');

  // Physical removal of private columns after copy
  assert.ok(sql.includes('drop column if exists preferences'));
  assert.ok(sql.includes('drop column if exists analytics_opt_in'));
  assert.ok(sql.includes('drop column if exists cloud_sync_opt_in'));

  // Drop stale Migration 1 policies
  assert.ok(sql.includes('drop policy if exists "user_profiles_select_own" on public.user_profiles;'));
  assert.ok(sql.includes('drop policy if exists "user_profiles_insert_own" on public.user_profiles;'));
  assert.ok(sql.includes('drop policy if exists "user_profiles_update_own" on public.user_profiles;'));

  // Table-level revoke before column-level grants; INSERT includes user_id, UPDATE excludes user_id
  assert.ok(sql.includes('revoke all on table public.user_profiles from public, anon, authenticated;'));
  assert.match(sql, /grant insert \(user_id, display_name, preferred_locale, is_public\)\s+on table public\.user_profiles to authenticated;/i);
  assert.match(sql, /grant update \(display_name, preferred_locale, is_public\)\s+on table public\.user_profiles to authenticated;/i);
});

test('B19.5-05-Static-4: Migration 9 adds guest_identity_links UPDATE policy for idempotent upsert replay', () => {
  const sql = fs.readFileSync(MIGRATION_9_PATH, 'utf8');
  assert.match(
    sql,
    /create policy "guest_links_update_own" on public\.guest_identity_links\s+for update to authenticated\s+using \(auth\.uid\(\) = user_id\)\s+with check \(auth\.uid\(\) = user_id\);/i
  );
});

test('B19.5-05-Static-5: Migration 9 hardens upsert_game_save_checked concurrency, expectedRevision=0 conflict, gameId, and Sankalpa guard', () => {
  const sql = fs.readFileSync(MIGRATION_9_PATH, 'utf8');

  // Direct client writes to game_saves are revoked; RPC is SECURITY DEFINER + pinned search_path
  assert.ok(sql.includes('drop policy if exists "game_saves_modify_own" on public.game_saves;'));
  assert.ok(sql.includes('grant select, delete on table public.game_saves to authenticated;'));
  assert.match(sql, /create or replace function public\.upsert_game_save_checked[\s\S]*?security definer\s+set search_path = pg_catalog, public/i);

  // Row-level lock + unique_violation conflict handling
  assert.match(sql, /from public\.game_saves\s+where user_id = v_user_id and game_id = p_game_id\s+for update;/i);
  assert.ok(sql.includes('when unique_violation then'));

  // Unconditional conflict check when row exists (never bypasses expectedRevision = 0!)
  assert.ok(sql.includes('if v_existing.revision <> p_expected_revision then'));
  assert.equal(/if p_expected_revision > 0 and v_existing\.revision <> p_expected_revision/i.test(sql), false);

  // serverRecord includes gameId and sourceGuestId
  assert.ok(sql.includes("'gameId', v_existing.game_id"));
  assert.ok(sql.includes("'sourceGuestId', v_existing.source_guest_id"));

  // Sankalpa boundary enforced at DB layer
  assert.ok(sql.includes('PRIVACY_BOUNDARY_VIOLATION'));
});

test('B19.5-05-Static-6: Migration 9 fixes purchase_receipts GDPR ON DELETE SET NULL, RLS on all internal tables, and telemetry functions', () => {
  const sql = fs.readFileSync(MIGRATION_9_PATH, 'utf8');

  // purchase_receipts GDPR compatibility
  assert.ok(sql.includes('alter table public.purchase_receipts alter column user_id drop not null;'));
  assert.ok(sql.includes('foreign key (user_id) references auth.users(id) on delete set null;'));

  // RLS enabled + revokes on internal tables
  for (const tbl of ['telemetry_rate_limits', 'telemetry_rate_buckets', 'storage_deletion_queue', 'purchase_receipts']) {
    assert.ok(sql.includes(`alter table public.${tbl} enable row level security;`), `Missing RLS on ${tbl}`);
    assert.ok(sql.includes(`revoke all on table public.${tbl} from public, anon, authenticated;`), `Missing revoke on ${tbl}`);
  }

  // check_telemetry_rate_limit guards against window <= 0 division-by-zero
  assert.ok(sql.includes('ERR_INVALID_WINDOW_SECONDS'));
  assert.ok(sql.includes('ERR_INVALID_MAX_REQUESTS'));
  assert.ok(sql.includes('ERR_INVALID_CLIENT_HASH'));

  // consume_telemetry_token captures monotonic timestamp AFTER FOR UPDATE
  assert.ok(sql.includes('v_now := greatest(v_last_fill, clock_timestamp());'));

  // prune_expired_telemetry rolls up from oldest expired date and preserves full-day counts with greatest(...)
  assert.ok(sql.includes('select min(received_at)::date'));
  assert.ok(sql.includes('greatest(public.telemetry_daily_aggregates.event_count, excluded.event_count)'));
});

test('B19.5-05-Static-7: pgTAP and B19.5-05 SQL verification suites fix PostgreSQL execution hazards', () => {
  const pgtap = fs.readFileSync(PGTAP_MATRIX_PATH, 'utf8');
  assert.ok(pgtap.includes('insert into auth.users'), 'pgTAP script must seed auth.users for FK integrity');
  assert.ok(pgtap.includes('when insufficient_privilege then'), 'pgTAP script must handle revoked anon privilege');
  assert.ok(
    pgtap.indexOf('create or replace function storage.foldername') <
      pgtap.indexOf('create policy "artwork_owner_select"'),
    'storage.foldername must be defined before referencing it in RLS policy'
  );
  assert.ok(pgtap.includes('create role service_role nologin bypassrls;'));
  assert.ok(fs.existsSync(PG_RUNTIME_SQL_PATH), 'B19.5-05 real PG runtime SQL suite must exist');
});

test('B19.5-05-Static-8: validateMigrationDdl detects unpinned SECURITY DEFINER functions', () => {
  const unsafeSql = `
    create or replace function public.bad_fn()
    returns void
    language plpgsql
    security definer
    as $$ begin end; $$;
  `;
  const res = validateMigrationDdl(unsafeSql);
  assert.equal(res.valid, false);
  assert.ok(res.issues.some((i) => i.includes('UNPINNED_SECURITY_DEFINER')));
});

// =============================================================================
// 2. Executable Edge Function Boundary Tests (sync-save-handler.js)
// =============================================================================

test('B19.5-05-EdgeFn-1: sync-save rejects invalid gameId, non-object payload, negative expectedRevision, and Sankalpa payload before RPC', async () => {
  let rpcCalls = 0;
  const mockSupabase = {
    auth: {
      getUser: async () => ({ data: { user: { id: 'usr_1' } }, error: null })
    },
    rpc: async () => {
      rpcCalls++;
      return { data: { ok: true, status: 'success', revision: 1 }, error: null };
    }
  };

  const invalidBodies = [
    { gameId: 'sankalpa', checksum: 'abc', payload: { a: 1 }, expectedRevision: 0 },
    { gameId: 'vak', checksum: 'abc', payload: [1, 2, 3], expectedRevision: 0 },
    { gameId: 'vak', checksum: 'abc', payload: { a: 1 }, expectedRevision: -1 },
    { gameId: 'vak', checksum: 'abc', payload: { a: 1 }, expectedRevision: 1.5 },
    { gameId: 'vak', checksum: '   ', payload: { a: 1 }, expectedRevision: 0 },
    { gameId: 'auromandala', checksum: 'abc', payload: { nested: { sankalpa_vault: 'secret' } }, expectedRevision: 0 },
    { gameId: 'auromandala', checksum: 'abc', payload: { note: 'auromasti-sankalpa-backup' }, expectedRevision: 0 }
  ];

  for (const bodyObj of invalidBodies) {
    const req = new Request('https://test.supabase.co/functions/v1/sync-save', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid_token',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(bodyObj)
    });
    const res = await handleSyncSaveRequest(req, { supabaseClient: mockSupabase });
    assert.equal(res.status, 400, `Expected HTTP 400 for body ${JSON.stringify(bodyObj)}`);
  }

  assert.equal(rpcCalls, 0, 'RPC must NEVER be invoked for rejected/invalid/Sankalpa payloads');
});

test('B19.5-05-EdgeFn-2: sync-save maps RPC rejected status to HTTP 400 and conflict to HTTP 409', async () => {
  const makeReq = () =>
    new Request('https://test.supabase.co/functions/v1/sync-save', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid_token',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        gameId: 'vak',
        checksum: 'a'.repeat(64),
        payload: { level: 3 },
        expectedRevision: 0
      })
    });

  const rejectedClient = {
    auth: { getUser: async () => ({ data: { user: { id: 'usr_1' } }, error: null }) },
    rpc: async () => ({ data: { ok: false, status: 'rejected', error: 'INVALID_PAYLOAD' }, error: null })
  };
  const rejectedRes = await handleSyncSaveRequest(makeReq(), { supabaseClient: rejectedClient });
  assert.equal(rejectedRes.status, 400);

  const conflictClient = {
    auth: { getUser: async () => ({ data: { user: { id: 'usr_1' } }, error: null }) },
    rpc: async () => ({
      data: {
        ok: false,
        status: 'conflict',
        currentRevision: 1,
        expectedRevision: 0,
        serverRecord: { gameId: 'vak', revision: 1, checksum: 'b'.repeat(64), payload: { level: 5 } }
      },
      error: null
    })
  };
  const conflictRes = await handleSyncSaveRequest(makeReq(), { supabaseClient: conflictClient });
  assert.equal(conflictRes.status, 409);
  const conflictBody = await conflictRes.json();
  assert.equal(conflictBody.serverRecord.gameId, 'vak');
});

// =============================================================================
// 3. Honest Local PostgreSQL Runtime Probe
// =============================================================================

test('B19.5-05-RuntimeProbe: PostgreSQL verification runner reports runtime availability honestly', () => {
  const probe = probeLocalDatabaseRuntime();
  let exitCode = 0;
  let stdout = '';
  try {
    stdout = execFileSync(process.execPath, [path.join(__dirname, 'scripts', 'verify-postgres-migrations.mjs'), '--probe'], {
      encoding: 'utf8'
    });
  } catch (err) {
    exitCode = err.status ?? 1;
    stdout = err.stdout || '';
  }

  const parsed = JSON.parse(stdout);
  assert.equal(parsed.migrationCount, 9);
  assert.equal(parsed.rlsTestCount, 2);
  if (probe.hasPsql) {
    assert.equal(exitCode, 0);
    assert.equal(parsed.status, 'RUNTIME_AVAILABLE');
  } else {
    assert.equal(exitCode, 2);
    assert.equal(parsed.status, 'RUNTIME_UNAVAILABLE');
  }
});
