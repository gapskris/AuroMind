-- ==============================================================================
-- AuroMind Batch B19.5-05 — Real PostgreSQL Runtime, RLS & RPC Verification Suite
-- ==============================================================================
-- Executes against a real PostgreSQL instance after applying all migrations in
-- supabase/migrations/ in chronological order. Rolls back all test mutations.
-- ==============================================================================

\set ON_ERROR_STOP on

begin;

-- ------------------------------------------------------------------------------
-- 1. Verify RLS enabled across ALL 15 public tables
-- ------------------------------------------------------------------------------
do $$
declare
  v_missing text[];
begin
  select array_agg(c.relname order by c.relname)
  into v_missing
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and not c.relrowsecurity;

  if v_missing is not null and array_length(v_missing, 1) > 0 then
    raise exception 'RLS_DISABLED_TABLES: %', v_missing;
  end if;
end;
$$;

-- ------------------------------------------------------------------------------
-- 2. Verify ALL SECURITY DEFINER functions pin search_path = pg_catalog, public
-- ------------------------------------------------------------------------------
do $$
declare
  v_bad text[];
begin
  select array_agg(p.proname order by p.proname)
  into v_bad
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and (
      p.proconfig is null
      or not ('search_path=pg_catalog, public' = any(p.proconfig))
    );

  if v_bad is not null and array_length(v_bad, 1) > 0 then
    raise exception 'UNPINNED_SECURITY_DEFINER_FUNCTIONS: %', v_bad;
  end if;
end;
$$;

-- ------------------------------------------------------------------------------
-- 3. Verify private columns physically removed from public.user_profiles
-- ------------------------------------------------------------------------------
do $$
declare
  v_leaked text[];
begin
  select array_agg(column_name order by column_name)
  into v_leaked
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'user_profiles'
    and column_name in ('preferences', 'analytics_opt_in', 'cloud_sync_opt_in');

  if v_leaked is not null and array_length(v_leaked, 1) > 0 then
    raise exception 'PRIVATE_COLUMNS_STILL_ON_USER_PROFILES: %', v_leaked;
  end if;
end;
$$;

-- ------------------------------------------------------------------------------
-- 4. Seed two authenticated users in auth.users
-- ------------------------------------------------------------------------------
insert into auth.users (id, email)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'alpha@auromind.test'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid, 'beta@auromind.test')
on conflict (id) do nothing;

-- ------------------------------------------------------------------------------
-- 5. Verify authenticated user_profiles INSERT/UPDATE column grants & isolation
-- ------------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
set local "request.jwt.claim.sub" = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

-- Owner can insert own profile (user_id included in INSERT grant)
insert into public.user_profiles (user_id, display_name, preferred_locale, is_public)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'Alpha', 'en', true);

-- Owner can update display_name
update public.user_profiles
set display_name = 'Alpha Updated'
where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid;

-- Owner CANNOT mutate user_id via UPDATE (column-level privilege denial)
do $$
begin
  begin
    update public.user_profiles
    set user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid
    where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid;
    raise exception 'EXPECTED_PRIVILEGE_ERROR_ON_USER_ID_UPDATE';
  exception
    when insufficient_privilege then
      null;
  end;
end;
$$;

-- ------------------------------------------------------------------------------
-- 6. Verify guest_identity_links idempotent upsert replay (INSERT + ON CONFLICT UPDATE)
-- ------------------------------------------------------------------------------
insert into public.guest_identity_links (user_id, guest_id, device_label)
values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
  'guest_11111111-2222-4333-8444-555555555555',
  'Device-1'
)
on conflict (user_id, guest_id)
do update set device_label = excluded.device_label, last_seen_at = now();

-- Replay same upsert (exercises UPDATE RLS policy!)
insert into public.guest_identity_links (user_id, guest_id, device_label)
values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
  'guest_11111111-2222-4333-8444-555555555555',
  'Device-1-Replayed'
)
on conflict (user_id, guest_id)
do update set device_label = excluded.device_label, last_seen_at = now();

-- ------------------------------------------------------------------------------
-- 7. Verify game_saves direct write block & upsert_game_save_checked strict locking
-- ------------------------------------------------------------------------------
do $$
declare
  v_res jsonb;
  v_rev_count integer;
begin
  -- Direct INSERT into game_saves must be denied for authenticated
  begin
    insert into public.game_saves (
      user_id, game_id, envelope_version, game_schema_version, revision,
      checksum, payload, client_updated_at
    ) values (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'vak', 1, 1, 1,
      'direct_bypass', '{"level":1}'::jsonb, now()
    );
    raise exception 'DIRECT_GAME_SAVES_INSERT_SHOULD_FAIL';
  exception
    when insufficient_privilege then
      null;
  end;

  -- Initial RPC push (expectedRevision = 0) creates revision 1
  v_res := public.upsert_game_save_checked(
    'vak', 1, 1, 0,
    'guest_11111111-2222-4333-8444-555555555555',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '{"level":10}'::jsonb,
    now()
  );
  if coalesce((v_res->>'ok')::boolean, false) is not true or (v_res->>'revision')::bigint <> 1 then
    raise exception 'INITIAL_SAVE_FAILED: %', v_res;
  end if;

  -- CRITICAL: Re-pushing with expectedRevision = 0 when rev 1 exists MUST CONFLICT
  -- and include serverRecord.gameId and serverRecord.sourceGuestId
  v_res := public.upsert_game_save_checked(
    'vak', 1, 1, 0,
    'guest_11111111-2222-4333-8444-555555555555',
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    '{"level":1}'::jsonb,
    now()
  );
  if v_res->>'status' <> 'conflict'
     or (v_res->>'currentRevision')::bigint <> 1
     or v_res->'serverRecord'->>'gameId' <> 'vak'
     or v_res->'serverRecord'->>'sourceGuestId' <> 'guest_11111111-2222-4333-8444-555555555555' then
    raise exception 'ZERO_EXPECTED_REVISION_CONFLICT_BROKEN: %', v_res;
  end if;

  -- Reject negative expectedRevision, array payload, and Sankalpa payload
  v_res := public.upsert_game_save_checked('vak', 1, 1, -1, null, 'abc', '{}'::jsonb, now());
  if v_res->>'status' <> 'rejected' then
    raise exception 'NEGATIVE_REVISION_NOT_REJECTED: %', v_res;
  end if;

  v_res := public.upsert_game_save_checked('vak', 1, 1, 1, null, 'abc', '[1,2,3]'::jsonb, now());
  if v_res->>'status' <> 'rejected' then
    raise exception 'ARRAY_PAYLOAD_NOT_REJECTED: %', v_res;
  end if;

  v_res := public.upsert_game_save_checked(
    'auromandala', 1, 1, 0, null, 'abc',
    '{"nested":{"sankalpa_reflections":"private"}}'::jsonb,
    now()
  );
  if v_res->>'error' <> 'PRIVACY_BOUNDARY_VIOLATION' then
    raise exception 'SANKALPA_PAYLOAD_NOT_REJECTED: %', v_res;
  end if;

  -- Advance 7 revisions to verify bounded archival (retains latest 5 in game_save_revisions)
  for i in 1..6 loop
    v_res := public.upsert_game_save_checked(
      'vak', 1, 1, i, null,
      repeat(to_hex(i), 64),
      jsonb_build_object('level', 10 + i),
      now()
    );
    if coalesce((v_res->>'ok')::boolean, false) is not true then
      raise exception 'REVISION_ADVANCE_FAILED at %: %', i, v_res;
    end if;
  end loop;

  select count(*) into v_rev_count
  from public.game_save_revisions
  where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid and game_id = 'vak';

  if v_rev_count <> 5 then
    raise exception 'ARCHIVE_RETENTION_EXPECTED_5_GOT_%', v_rev_count;
  end if;
end;
$$;

-- ------------------------------------------------------------------------------
-- 8. Verify service_role-only telemetry RPC input validation & retention rollup safety
-- ------------------------------------------------------------------------------
reset role;
set local role service_role;

do $$
declare
  v_res jsonb;
  v_hash bytea := decode('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'hex');
  v_prune record;
  v_agg_count integer;
begin
  -- check_telemetry_rate_limit: reject window <= 0 and NULL (no division by zero!)
  v_res := public.check_telemetry_rate_limit('hash_abc', 30, 0);
  if v_res->>'code' <> 'ERR_INVALID_WINDOW_SECONDS' then
    raise exception 'RATE_LIMIT_ZERO_WINDOW_FAILED: %', v_res;
  end if;
  v_res := public.check_telemetry_rate_limit(null, 30, 60);
  if v_res->>'code' <> 'ERR_INVALID_CLIENT_HASH' then
    raise exception 'RATE_LIMIT_NULL_HASH_FAILED: %', v_res;
  end if;

  -- consume_telemetry_token: reject NULL, empty, oversized, NaN, Infinity, -Infinity, out of bounds
  v_res := public.consume_telemetry_token(null, 60.0, 1.0);
  if v_res->>'code' <> 'ERR_EMPTY_OR_NULL_IP_HASH' then
    raise exception 'TOKEN_NULL_HASH_FAILED: %', v_res;
  end if;
  v_res := public.consume_telemetry_token('NaN'::numeric::text::bytea, 'NaN'::numeric, 1.0);
  if v_res->>'code' <> 'ERR_NON_FINITE_NUMERIC_PARAMETER' then
    raise exception 'TOKEN_NAN_FAILED: %', v_res;
  end if;
  v_res := public.consume_telemetry_token(v_hash, 'Infinity'::numeric, 1.0);
  if v_res->>'code' <> 'ERR_NON_FINITE_NUMERIC_PARAMETER' then
    raise exception 'TOKEN_INF_FAILED: %', v_res;
  end if;
  v_res := public.consume_telemetry_token(v_hash, 60.0, '-Infinity'::numeric);
  if v_res->>'code' <> 'ERR_NON_FINITE_NUMERIC_PARAMETER' then
    raise exception 'TOKEN_NEG_INF_FAILED: %', v_res;
  end if;
  v_res := public.consume_telemetry_token(v_hash, 60.0, 1.0);
  if coalesce((v_res->>'allowed')::boolean, false) is not true then
    raise exception 'TOKEN_VALID_CONSUME_FAILED: %', v_res;
  end if;

  -- Multi-batch telemetry pruning + >7d old event rollup preservation
  for i in 1..150 loop
    insert into public.telemetry_events (
      event_id, guest_id, session_id, game_id, event_name, category, occurred_at, received_at
    ) values (
      gen_random_uuid(),
      'guest_' || i,
      'sess_' || i,
      'vak',
      'b19_5_05_old_event',
      'engagement',
      now() - interval '95 days',
      now() - interval '95 days'
    );
  end loop;

  -- Batch 1 (100 rows deleted, 50 remaining)
  select * into v_prune from public.prune_expired_telemetry(60, 100);
  if v_prune.deleted_count <> 100 or v_prune.remaining_expired < 50 then
    raise exception 'PRUNE_BATCH_1_UNEXPECTED: %', v_prune;
  end if;

  -- Batch 2 (remaining 50 deleted)
  select * into v_prune from public.prune_expired_telemetry(60, 100);

  -- Aggregate count MUST remain 150 (NOT clobbered to 50 by batch 2!)
  select event_count into v_agg_count
  from public.telemetry_daily_aggregates
  where game_id = 'vak' and event_name = 'b19_5_05_old_event'
  order by event_date asc
  limit 1;

  if v_agg_count <> 150 then
    raise exception 'MULTI_BATCH_ROLLUP_CLOBBERED_EXPECTED_150_GOT_%', v_agg_count;
  end if;
end;
$$;

-- ------------------------------------------------------------------------------
-- 9. Verify purchase_receipts ON DELETE SET NULL allows GDPR account deletion
-- ------------------------------------------------------------------------------
reset role;

insert into public.purchase_receipts (
  user_id, provider, provider_transaction_id, sku, amount_minor, currency, status
) values (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,
  'razorpay',
  'txn_b19_5_05_gdpr_test',
  'patron_annual',
  99900,
  'INR',
  'succeeded'
);

delete from auth.users where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid;

do $$
declare
  v_user_id uuid;
begin
  select user_id into v_user_id
  from public.purchase_receipts
  where provider_transaction_id = 'txn_b19_5_05_gdpr_test';

  if not found or v_user_id is not null then
    raise exception 'PURCHASE_RECEIPT_GDPR_SET_NULL_FAILED';
  end if;
end;
$$;

rollback;

\echo '========================================================='
\echo 'B19.5-05 REAL POSTGRESQL RUNTIME VERIFICATION PASSED!'
\echo '========================================================='
