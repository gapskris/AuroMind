-- ==============================================================================
-- AuroMind Remediation Batch B19.5-05 — Database Integrity, Concurrency & RLS Hardening
-- ==============================================================================
-- Migration ID: 20261123000001_b19_5_05_db_integrity_and_rls_hardening.sql
-- Description:
--   1. Physically removes private columns from public.user_profiles after migrating
--      any remaining rows to public.user_private_settings, drops stale policies,
--      revokes table-level privileges from public/anon/authenticated, and fixes
--      column-level INSERT (including user_id) vs UPDATE grants.
--   2. Restores idempotent guest_identity_links upsert replay via owner-only UPDATE RLS.
--   3. Hardens public.game_saves / game_save_revisions constraints, pins search_path
--      on archive_game_save_revision(), revokes direct client INSERT/UPDATE on
--      game_saves, and fixes upsert_game_save_checked() concurrency (FOR UPDATE +
--      unique_violation conflict handling), strict expectedRevision=0 conflict
--      enforcement, serverRecord.gameId/sourceGuestId completeness, and Sankalpa
--      boundary rejection.
--   4. Aligns public.purchase_receipts user_id FK to nullable ON DELETE SET NULL
--      so GDPR account deletion succeeds while preserving statutory payment records.
--   5. Enables RLS and least-privilege grants across all internal/server-only tables
--      (telemetry_rate_limits, telemetry_rate_buckets, storage_deletion_queue,
--      purchase_receipts, entitlements, entitlement_audit, remote_config, owner_roles,
--      telemetry_events, telemetry_daily_aggregates).
--   6. Pins search_path = pg_catalog, public on all SECURITY DEFINER functions,
--      hardens check_telemetry_rate_limit() against NULL/<=0 division-by-zero,
--      fixes consume_telemetry_token() monotonic last_fill under lock contention,
--      and fixes prune_expired_telemetry() / rollup_telemetry_aggregates() against
--      >7-day rollup omission and multi-batch count clobbering.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 0. Shared Updated-At Trigger Helper
-- ------------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 1. Profile Privacy Separation & Column-Level Privilege Enforcement
-- ------------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_profiles'
      and column_name = 'preferences'
  ) then
    insert into public.user_private_settings (
      user_id,
      preferences,
      analytics_opt_in,
      cloud_sync_opt_in,
      created_at,
      updated_at
    )
    select
      user_id,
      coalesce(preferences, '{}'::jsonb),
      coalesce(analytics_opt_in, false),
      coalesce(cloud_sync_opt_in, false),
      created_at,
      updated_at
    from public.user_profiles
    on conflict (user_id) do nothing;
  end if;
end;
$$;

alter table public.user_profiles
  drop column if exists preferences,
  drop column if exists analytics_opt_in,
  drop column if exists cloud_sync_opt_in;

-- Drop stale Migration 1 & overlapping policies on public.user_profiles
drop policy if exists "user_profiles_select_own" on public.user_profiles;
drop policy if exists "user_profiles_insert_own" on public.user_profiles;
drop policy if exists "user_profiles_update_own" on public.user_profiles;
drop policy if exists "user_profiles_owner_all" on public.user_profiles;
drop policy if exists "user_profiles_owner_select" on public.user_profiles;
drop policy if exists "user_profiles_owner_insert" on public.user_profiles;
drop policy if exists "user_profiles_owner_update" on public.user_profiles;
drop policy if exists "user_profiles_public_select" on public.user_profiles;

alter table public.user_profiles enable row level security;

create policy "user_profiles_owner_select" on public.user_profiles
  for select to authenticated
  using (auth.uid() = user_id);

create policy "user_profiles_owner_insert" on public.user_profiles
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy "user_profiles_owner_update" on public.user_profiles
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "user_profiles_public_select" on public.user_profiles
  for select to anon, authenticated
  using (is_public = true);

-- Revoke table-level access before applying strict column-level grants
revoke all on table public.user_profiles from public, anon, authenticated;
grant select (user_id, display_name, preferred_locale, is_public, created_at, updated_at)
  on table public.user_profiles to anon, authenticated;
grant insert (user_id, display_name, preferred_locale, is_public)
  on table public.user_profiles to authenticated;
grant update (display_name, preferred_locale, is_public)
  on table public.user_profiles to authenticated;
grant select, insert, update, delete on table public.user_profiles to service_role;

drop trigger if exists trg_user_profiles_updated_at on public.user_profiles;
create trigger trg_user_profiles_updated_at
  before update on public.user_profiles
  for each row
  execute function public.set_updated_at();

-- Ensure public projection view has explicit least-privilege grants
revoke all on public.public_user_profiles from public, anon, authenticated;
grant select on public.public_user_profiles to anon, authenticated, service_role;

-- Harden public.user_private_settings privileges and repeatable policies
alter table public.user_private_settings enable row level security;
revoke all on table public.user_private_settings from public, anon, authenticated;
grant select, insert, update on table public.user_private_settings to authenticated;
grant select, insert, update, delete on table public.user_private_settings to service_role;

drop policy if exists "private_settings_owner_select" on public.user_private_settings;
create policy "private_settings_owner_select" on public.user_private_settings
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "private_settings_owner_insert" on public.user_private_settings;
create policy "private_settings_owner_insert" on public.user_private_settings
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "private_settings_owner_update" on public.user_private_settings;
create policy "private_settings_owner_update" on public.user_private_settings
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop trigger if exists trg_user_private_settings_updated_at on public.user_private_settings;
create trigger trg_user_private_settings_updated_at
  before update on public.user_private_settings
  for each row
  execute function public.set_updated_at();

-- ------------------------------------------------------------------------------
-- 2. Guest Identity Links: Idempotent Upsert Support & Least-Privilege RLS
-- ------------------------------------------------------------------------------
alter table public.guest_identity_links enable row level security;
revoke all on table public.guest_identity_links from public, anon, authenticated;
grant select, insert, update, delete on table public.guest_identity_links to authenticated, service_role;

drop policy if exists "guest_links_select_own" on public.guest_identity_links;
create policy "guest_links_select_own" on public.guest_identity_links
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "guest_links_insert_own" on public.guest_identity_links;
create policy "guest_links_insert_own" on public.guest_identity_links
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "guest_links_update_own" on public.guest_identity_links;
create policy "guest_links_update_own" on public.guest_identity_links
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "guest_links_delete_own" on public.guest_identity_links;
create policy "guest_links_delete_own" on public.guest_identity_links
  for delete to authenticated
  using (auth.uid() = user_id);

-- ------------------------------------------------------------------------------
-- 3. Game Saves Integrity, Revision Archival & Concurrency-Safe Upsert RPC
-- ------------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'game_saves_revision_positive') then
    alter table public.game_saves add constraint game_saves_revision_positive check (revision >= 1);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'game_saves_envelope_version_positive') then
    alter table public.game_saves add constraint game_saves_envelope_version_positive check (envelope_version >= 1);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'game_saves_schema_version_positive') then
    alter table public.game_saves add constraint game_saves_schema_version_positive check (game_schema_version >= 1);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'game_saves_checksum_nonempty') then
    alter table public.game_saves add constraint game_saves_checksum_nonempty check (length(btrim(checksum)) > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'game_saves_payload_object') then
    alter table public.game_saves add constraint game_saves_payload_object check (jsonb_typeof(payload) = 'object');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'game_save_revisions_revision_positive') then
    alter table public.game_save_revisions add constraint game_save_revisions_revision_positive check (revision >= 1);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'game_save_revisions_payload_object') then
    alter table public.game_save_revisions add constraint game_save_revisions_payload_object check (jsonb_typeof(payload) = 'object');
  end if;
end;
$$;

-- Pin search_path and deterministic retention ordering on archive trigger function
create or replace function public.archive_game_save_revision()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.game_save_revisions (
    user_id,
    game_id,
    revision,
    checksum,
    payload,
    created_at
  ) values (
    old.user_id,
    old.game_id,
    old.revision,
    old.checksum,
    old.payload,
    old.server_updated_at
  );

  -- Retain only the latest 5 archived revisions per user per game deterministically
  delete from public.game_save_revisions
  where id in (
    select id
    from public.game_save_revisions
    where user_id = old.user_id and game_id = old.game_id
    order by revision desc, created_at desc, id desc
    offset 5
  );

  return new;
end;
$$;

revoke all on function public.archive_game_save_revision() from public, anon, authenticated;

-- Route all client game_saves writes exclusively through upsert_game_save_checked
alter table public.game_saves enable row level security;
drop policy if exists "game_saves_modify_own" on public.game_saves;
drop policy if exists "game_saves_select_own" on public.game_saves;
drop policy if exists "game_saves_delete_own" on public.game_saves;

create policy "game_saves_select_own" on public.game_saves
  for select to authenticated
  using (auth.uid() = user_id);

create policy "game_saves_delete_own" on public.game_saves
  for delete to authenticated
  using (auth.uid() = user_id);

revoke all on table public.game_saves from public, anon, authenticated;
grant select, delete on table public.game_saves to authenticated;
grant select, insert, update, delete on table public.game_saves to service_role;

alter table public.game_save_revisions enable row level security;
drop policy if exists "game_save_revisions_select_own" on public.game_save_revisions;
create policy "game_save_revisions_select_own" on public.game_save_revisions
  for select to authenticated
  using (auth.uid() = user_id);

revoke all on table public.game_save_revisions from public, anon, authenticated;
grant select on table public.game_save_revisions to authenticated;
grant select, insert, update, delete on table public.game_save_revisions to service_role;

-- Hardened Optimistic Concurrency Save Upsert RPC
create or replace function public.upsert_game_save_checked(
  p_game_id text,
  p_envelope_version integer,
  p_game_schema_version integer,
  p_expected_revision bigint,
  p_source_guest_id text,
  p_checksum text,
  p_payload jsonb,
  p_client_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid;
  v_existing record;
  v_new_revision bigint;
  v_payload_text text;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    return jsonb_build_object(
      'ok', false,
      'status', 'unauthenticated',
      'message', 'Authentication required.'
    );
  end if;

  if p_game_id is null or p_game_id not in (
    'vak', 'auromatch', 'auromandala', 'word-riddle', 'vak-living-sanctuary', 'auroblocks'
  ) then
    return jsonb_build_object(
      'ok', false,
      'status', 'rejected',
      'error', 'INVALID_GAME_ID',
      'message', 'Unsupported or forbidden gameId.'
    );
  end if;

  if p_envelope_version is null or p_envelope_version < 1
     or p_game_schema_version is null or p_game_schema_version < 1
     or p_expected_revision is null or p_expected_revision < 0
     or p_checksum is null or length(btrim(p_checksum)) = 0
     or p_client_updated_at is null then
    return jsonb_build_object(
      'ok', false,
      'status', 'rejected',
      'error', 'INVALID_PARAMETERS',
      'message', 'Missing or invalid save envelope parameters.'
    );
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return jsonb_build_object(
      'ok', false,
      'status', 'rejected',
      'error', 'INVALID_PAYLOAD',
      'message', 'Save payload must be a JSON object.'
    );
  end if;

  v_payload_text := p_payload::text;
  if octet_length(v_payload_text) > 524288 then
    return jsonb_build_object(
      'ok', false,
      'status', 'rejected',
      'error', 'PAYLOAD_TOO_LARGE',
      'message', 'Save payload exceeds 512 KiB limit.'
    );
  end if;

  -- Defense-in-depth Sankalpa local-only privacy boundary at database layer
  if v_payload_text ~* '("[^"]*sankalpa[^"]*"\s*:|sankalpa_e2ee_vault|auromasti-sankalpa-backup|auromind_sankalpa_vault|sankalpa_reflections)' then
    return jsonb_build_object(
      'ok', false,
      'status', 'rejected',
      'error', 'PRIVACY_BOUNDARY_VIOLATION',
      'message', 'Sankalpa vault data is strictly excluded from cloud sync.'
    );
  end if;

  -- Serialize concurrent writes for the same (user_id, game_id)
  select * into v_existing
  from public.game_saves
  where user_id = v_user_id and game_id = p_game_id
  for update;

  if found then
    -- Strict optimistic concurrency: expectedRevision must match existing revision (including rejecting 0!)
    if v_existing.revision <> p_expected_revision then
      return jsonb_build_object(
        'ok', false,
        'status', 'conflict',
        'currentRevision', v_existing.revision,
        'expectedRevision', p_expected_revision,
        'serverRecord', jsonb_build_object(
          'gameId', v_existing.game_id,
          'envelopeVersion', v_existing.envelope_version,
          'gameSchemaVersion', v_existing.game_schema_version,
          'revision', v_existing.revision,
          'sourceGuestId', v_existing.source_guest_id,
          'checksum', v_existing.checksum,
          'payload', v_existing.payload,
          'clientUpdatedAt', v_existing.client_updated_at,
          'serverUpdatedAt', v_existing.server_updated_at
        )
      );
    end if;

    v_new_revision := v_existing.revision + 1;

    update public.game_saves
    set
      envelope_version = p_envelope_version,
      game_schema_version = p_game_schema_version,
      revision = v_new_revision,
      source_guest_id = nullif(btrim(p_source_guest_id), ''),
      checksum = btrim(p_checksum),
      payload = p_payload,
      client_updated_at = p_client_updated_at,
      server_updated_at = now()
    where user_id = v_user_id and game_id = p_game_id;

    return jsonb_build_object(
      'ok', true,
      'status', 'success',
      'revision', v_new_revision,
      'gameId', p_game_id
    );
  else
    -- Brand new cloud save (first revision)
    if p_expected_revision > 0 then
      return jsonb_build_object(
        'ok', false,
        'status', 'conflict',
        'currentRevision', 0,
        'expectedRevision', p_expected_revision,
        'message', 'No existing save found, but expectedRevision > 0.'
      );
    end if;

    v_new_revision := 1;

    begin
      insert into public.game_saves (
        user_id,
        game_id,
        envelope_version,
        game_schema_version,
        revision,
        source_guest_id,
        checksum,
        payload,
        client_updated_at,
        server_updated_at
      ) values (
        v_user_id,
        p_game_id,
        p_envelope_version,
        p_game_schema_version,
        v_new_revision,
        nullif(btrim(p_source_guest_id), ''),
        btrim(p_checksum),
        p_payload,
        p_client_updated_at,
        now()
      );
    exception
      when unique_violation then
        -- Concurrent initial save created the row first: return structured conflict
        select * into v_existing
        from public.game_saves
        where user_id = v_user_id and game_id = p_game_id;

        return jsonb_build_object(
          'ok', false,
          'status', 'conflict',
          'currentRevision', v_existing.revision,
          'expectedRevision', p_expected_revision,
          'serverRecord', jsonb_build_object(
            'gameId', v_existing.game_id,
            'envelopeVersion', v_existing.envelope_version,
            'gameSchemaVersion', v_existing.game_schema_version,
            'revision', v_existing.revision,
            'sourceGuestId', v_existing.source_guest_id,
            'checksum', v_existing.checksum,
            'payload', v_existing.payload,
            'clientUpdatedAt', v_existing.client_updated_at,
            'serverUpdatedAt', v_existing.server_updated_at
          )
        );
    end;

    return jsonb_build_object(
      'ok', true,
      'status', 'success',
      'revision', v_new_revision,
      'gameId', p_game_id
    );
  end if;
end;
$$;

revoke all on function public.upsert_game_save_checked(text, integer, integer, bigint, text, text, jsonb, timestamptz)
  from public, anon;
grant execute on function public.upsert_game_save_checked(text, integer, integer, bigint, text, text, jsonb, timestamptz)
  to authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 4. Purchase Receipts: GDPR Account Deletion Compatibility & Server-Only Lock
-- ------------------------------------------------------------------------------
alter table public.purchase_receipts alter column user_id drop not null;
alter table public.purchase_receipts drop constraint if exists purchase_receipts_user_id_fkey;
alter table public.purchase_receipts
  add constraint purchase_receipts_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete set null;

alter table public.purchase_receipts enable row level security;
revoke all on table public.purchase_receipts from public, anon, authenticated;
grant select, insert, update on table public.purchase_receipts to service_role;

-- ------------------------------------------------------------------------------
-- 5. Least-Privilege Grants & Explicit Role-Scoped RLS on Remaining Tables
-- ------------------------------------------------------------------------------
-- Entitlements (authenticated read-only own; writes strictly service_role)
alter table public.entitlements enable row level security;
drop policy if exists "entitlements_select_own" on public.entitlements;
create policy "entitlements_select_own" on public.entitlements
  for select to authenticated
  using (auth.uid() = user_id);
revoke all on table public.entitlements from public, anon, authenticated;
grant select on table public.entitlements to authenticated;
grant select, insert, update, delete on table public.entitlements to service_role;

drop trigger if exists trg_entitlements_updated_at on public.entitlements;
create trigger trg_entitlements_updated_at
  before update on public.entitlements
  for each row
  execute function public.set_updated_at();

-- Entitlement Audit (authenticated read-only own; writes strictly service_role)
alter table public.entitlement_audit enable row level security;
drop policy if exists "entitlement_audit_select_own" on public.entitlement_audit;
create policy "entitlement_audit_select_own" on public.entitlement_audit
  for select to authenticated
  using (auth.uid() = user_id);
revoke all on table public.entitlement_audit from public, anon, authenticated;
grant select on table public.entitlement_audit to authenticated;
grant select, insert, update, delete on table public.entitlement_audit to service_role;

-- Telemetry Events (remove duplicate index; lock writes to service_role; owner-only select)
drop index if exists public.idx_telemetry_event_id;
alter table public.telemetry_events enable row level security;
drop policy if exists "telemetry_insert_any" on public.telemetry_events;
drop policy if exists "telemetry_select_owner_only" on public.telemetry_events;
create policy "telemetry_select_owner_only" on public.telemetry_events
  for select to authenticated
  using (
    exists (
      select 1 from public.owner_roles
      where owner_roles.user_id = auth.uid() and owner_roles.role = 'owner'
    )
  );
revoke all on table public.telemetry_events from public, anon, authenticated;
grant select on table public.telemetry_events to authenticated;
grant select, insert, update, delete on table public.telemetry_events to service_role;

-- Telemetry Daily Aggregates (owner-only select; writes strictly service_role)
alter table public.telemetry_daily_aggregates enable row level security;
drop policy if exists "telemetry_daily_agg_select_owner_only" on public.telemetry_daily_aggregates;
create policy "telemetry_daily_agg_select_owner_only" on public.telemetry_daily_aggregates
  for select to authenticated
  using (
    exists (
      select 1 from public.owner_roles
      where owner_roles.user_id = auth.uid() and owner_roles.role = 'owner'
    )
  );
revoke all on table public.telemetry_daily_aggregates from public, anon, authenticated;
grant select on table public.telemetry_daily_aggregates to authenticated;
grant select, insert, update, delete on table public.telemetry_daily_aggregates to service_role;

-- Remote Config (public read-only; writes strictly service_role)
alter table public.remote_config enable row level security;
drop policy if exists "remote_config_read_all" on public.remote_config;
create policy "remote_config_read_all" on public.remote_config
  for select to anon, authenticated
  using (true);
revoke all on table public.remote_config from public, anon, authenticated;
grant select on table public.remote_config to anon, authenticated;
grant select, insert, update, delete on table public.remote_config to service_role;

drop trigger if exists trg_remote_config_updated_at on public.remote_config;
create trigger trg_remote_config_updated_at
  before update on public.remote_config
  for each row
  execute function public.set_updated_at();

-- Owner Roles (authenticated read-only own; writes strictly service_role)
alter table public.owner_roles enable row level security;
drop policy if exists "owner_roles_select_own" on public.owner_roles;
create policy "owner_roles_select_own" on public.owner_roles
  for select to authenticated
  using (auth.uid() = user_id);
revoke all on table public.owner_roles from public, anon, authenticated;
grant select on table public.owner_roles to authenticated;
grant select, insert, update, delete on table public.owner_roles to service_role;

-- Server-only internal infrastructure tables (enable RLS + revoke public/anon/authenticated)
alter table public.telemetry_rate_limits enable row level security;
revoke all on table public.telemetry_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.telemetry_rate_limits to service_role;

alter table public.telemetry_rate_buckets enable row level security;
revoke all on table public.telemetry_rate_buckets from public, anon, authenticated;
grant select, insert, update, delete on table public.telemetry_rate_buckets to service_role;

alter table public.storage_deletion_queue enable row level security;
revoke all on table public.storage_deletion_queue from public, anon, authenticated;
grant select, insert, update, delete on table public.storage_deletion_queue to service_role;

-- ------------------------------------------------------------------------------
-- 6. SECURITY DEFINER Hardening: Telemetry Rate Limiting & Retention Functions
-- ------------------------------------------------------------------------------

-- 6A. Harden check_telemetry_rate_limit (pin search_path + prevent NULL/<=0 div-by-zero)
create or replace function public.check_telemetry_rate_limit(
  p_client_hash text,
  p_max_requests integer default 30,
  p_window_seconds integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := now();
  v_bucket_epoch bigint;
  v_window_bucket timestamptz;
  v_current_count integer;
  v_remaining integer;
  v_retry_after integer;
begin
  if p_client_hash is null or length(btrim(p_client_hash)) = 0 or length(p_client_hash) > 128 then
    return jsonb_build_object(
      'allowed', false,
      'error', 'INVALID_PARAMETERS',
      'code', 'ERR_INVALID_CLIENT_HASH'
    );
  end if;

  if p_max_requests is null or p_max_requests < 1 or p_max_requests > 100000 then
    return jsonb_build_object(
      'allowed', false,
      'error', 'INVALID_PARAMETERS',
      'code', 'ERR_INVALID_MAX_REQUESTS'
    );
  end if;

  if p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 86400 then
    return jsonb_build_object(
      'allowed', false,
      'error', 'INVALID_PARAMETERS',
      'code', 'ERR_INVALID_WINDOW_SECONDS'
    );
  end if;

  -- Normalize to fixed window bucket
  v_bucket_epoch := floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds;
  v_window_bucket := to_timestamp(v_bucket_epoch);

  -- Atomic insert or increment within PostgreSQL
  insert into public.telemetry_rate_limits (client_hash, window_bucket, request_count)
  values (p_client_hash, v_window_bucket, 1)
  on conflict (client_hash, window_bucket)
  do update set request_count = public.telemetry_rate_limits.request_count + 1
  returning request_count into v_current_count;

  -- Probabilistic garbage collection of expired buckets
  if random() < 0.05 then
    delete from public.telemetry_rate_limits
    where window_bucket < (v_now - interval '10 minutes');
  end if;

  v_retry_after := greatest(1, p_window_seconds - floor(extract(epoch from (v_now - v_window_bucket)))::integer);

  if v_current_count > p_max_requests then
    return jsonb_build_object(
      'allowed', false,
      'current', v_current_count,
      'limit', p_max_requests,
      'remaining', 0,
      'retry_after', v_retry_after
    );
  else
    v_remaining := greatest(0, p_max_requests - v_current_count);
    return jsonb_build_object(
      'allowed', true,
      'current', v_current_count,
      'limit', p_max_requests,
      'remaining', v_remaining,
      'retry_after', 0
    );
  end if;
end;
$$;

revoke all on function public.check_telemetry_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.check_telemetry_rate_limit(text, integer, integer) to service_role;

-- 6B. Harden consume_telemetry_token (preserve all B18-D bounds + monotonic lock timestamp)
create or replace function public.consume_telemetry_token(
  p_ip_hash bytea,
  p_capacity numeric default 60.0,
  p_fill_rate numeric default 1.0
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_init_now timestamptz := clock_timestamp();
  v_now timestamptz;
  v_tokens numeric(8, 2);
  v_last_fill timestamptz;
  v_new_tokens numeric(8, 2);
  v_allowed boolean;
  v_elapsed numeric;
begin
  if p_ip_hash is null or octet_length(p_ip_hash) = 0 then
    return jsonb_build_object(
      'allowed', false,
      'error', 'INVALID_PARAMETERS',
      'code', 'ERR_EMPTY_OR_NULL_IP_HASH'
    );
  end if;

  if octet_length(p_ip_hash) > 64 then
    return jsonb_build_object(
      'allowed', false,
      'error', 'INVALID_PARAMETERS',
      'code', 'ERR_IP_HASH_EXCEEDS_MAX_LENGTH'
    );
  end if;

  if p_capacity is null or p_fill_rate is null then
    return jsonb_build_object(
      'allowed', false,
      'error', 'INVALID_PARAMETERS',
      'code', 'ERR_NULL_NUMERIC_PARAMETER'
    );
  end if;

  if p_capacity = 'NaN'::numeric or p_fill_rate = 'NaN'::numeric
     or p_capacity::text in ('NaN', 'Infinity', '-Infinity')
     or p_fill_rate::text in ('NaN', 'Infinity', '-Infinity') then
    return jsonb_build_object(
      'allowed', false,
      'error', 'INVALID_PARAMETERS',
      'code', 'ERR_NON_FINITE_NUMERIC_PARAMETER'
    );
  end if;

  if p_capacity < 1.0 or p_capacity > 1000.0 then
    return jsonb_build_object(
      'allowed', false,
      'error', 'INVALID_PARAMETERS',
      'code', 'ERR_CAPACITY_OUT_OF_BOUNDS'
    );
  end if;

  if p_fill_rate < 0.01 or p_fill_rate > 100.0 then
    return jsonb_build_object(
      'allowed', false,
      'error', 'INVALID_PARAMETERS',
      'code', 'ERR_FILL_RATE_OUT_OF_BOUNDS'
    );
  end if;

  insert into public.telemetry_rate_buckets (ip_hash, tokens, last_fill)
  values (p_ip_hash, p_capacity, v_init_now)
  on conflict (ip_hash) do nothing;

  -- Acquire row lock BEFORE reading authoritative clock_timestamp()
  select tokens, last_fill into v_tokens, v_last_fill
  from public.telemetry_rate_buckets
  where ip_hash = p_ip_hash
  for update;

  -- Monotonic timestamp under concurrent lock contention (never regress last_fill)
  v_now := greatest(v_last_fill, clock_timestamp());
  v_elapsed := extract(epoch from (v_now - v_last_fill));

  if v_elapsed < 0 then
    v_elapsed := 0;
  end if;

  if (v_elapsed * p_fill_rate) >= p_capacity then
    v_new_tokens := p_capacity;
  else
    v_new_tokens := least(p_capacity, v_tokens + (v_elapsed * p_fill_rate));
  end if;

  if v_new_tokens >= 1.0 then
    v_new_tokens := v_new_tokens - 1.0;
    v_allowed := true;
  else
    v_allowed := false;
  end if;

  update public.telemetry_rate_buckets
  set tokens = v_new_tokens,
      last_fill = v_now
  where ip_hash = p_ip_hash;

  return jsonb_build_object(
    'allowed', v_allowed,
    'remaining', floor(v_new_tokens),
    'capacity', p_capacity
  );
end;
$$;

revoke all on function public.consume_telemetry_token(bytea, numeric, numeric) from public, anon, authenticated;
grant execute on function public.consume_telemetry_token(bytea, numeric, numeric) to service_role;

-- 6C. Harden rollup_telemetry_aggregates & prune_expired_telemetry
--     (pin search_path = pg_catalog, public; prevent >7d rollup gap & multi-batch clobbering)
create or replace function public.rollup_telemetry_aggregates(
  p_start_date date default null,
  p_end_date date default null
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_inserted integer := 0;
  v_start date := coalesce(p_start_date, (current_date - interval '90 days')::date);
  v_end date := coalesce(p_end_date, (current_date - interval '60 days')::date);
begin
  if v_start > v_end then
    return 0;
  end if;

  insert into public.telemetry_daily_aggregates (
    event_date,
    game_id,
    category,
    event_name,
    event_count,
    unique_visitors,
    unique_sessions,
    aggregated_at
  )
  select
    received_at::date as event_date,
    game_id,
    category,
    event_name,
    count(*) as event_count,
    count(distinct coalesce(guest_id, session_id)) as unique_visitors,
    count(distinct session_id) as unique_sessions,
    now() as aggregated_at
  from public.telemetry_events
  where received_at::date >= v_start
    and received_at::date <= v_end
  group by received_at::date, game_id, category, event_name
  on conflict (event_date, game_id, category, event_name)
  do update set
    event_count = greatest(public.telemetry_daily_aggregates.event_count, excluded.event_count),
    unique_visitors = greatest(public.telemetry_daily_aggregates.unique_visitors, excluded.unique_visitors),
    unique_sessions = greatest(public.telemetry_daily_aggregates.unique_sessions, excluded.unique_sessions),
    aggregated_at = now();

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

create or replace function public.prune_expired_telemetry(
  p_retention_days integer default 60,
  p_batch_size integer default 5000
)
returns table (
  deleted_count integer,
  remaining_expired integer,
  retention_cutoff timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_cutoff timestamptz;
  v_deleted integer := 0;
  v_remaining integer := 0;
  v_batch integer := least(greatest(coalesce(p_batch_size, 5000), 100), 20000);
  v_days integer := least(greatest(coalesce(p_retention_days, 60), 30), 3650);
  v_oldest_expired_date date;
begin
  v_cutoff := now() - (v_days || ' days')::interval;

  -- Roll up ALL expired dates from oldest expired event up to cutoff before deleting
  select min(received_at)::date
  into v_oldest_expired_date
  from public.telemetry_events
  where received_at < v_cutoff;

  if v_oldest_expired_date is not null then
    perform public.rollup_telemetry_aggregates(
      v_oldest_expired_date,
      v_cutoff::date
    );
  end if;

  with to_delete as (
    select id
    from public.telemetry_events
    where received_at < v_cutoff
    order by received_at asc
    limit v_batch
  )
  delete from public.telemetry_events
  where id in (select id from to_delete);

  get diagnostics v_deleted = row_count;

  select count(*)
  into v_remaining
  from public.telemetry_events
  where received_at < v_cutoff;

  return query select v_deleted, v_remaining, v_cutoff;
end;
$$;

revoke all on function public.prune_expired_telemetry(integer, integer) from public, anon, authenticated;
grant execute on function public.prune_expired_telemetry(integer, integer) to service_role;

revoke all on function public.rollup_telemetry_aggregates(date, date) from public, anon, authenticated;
grant execute on function public.rollup_telemetry_aggregates(date, date) to service_role;
