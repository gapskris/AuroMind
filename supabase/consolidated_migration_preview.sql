-- ==============================================================================
-- AuroMasti Consolidated Idempotent Migration Bundle (OFFLINE CODE AUDIT PREVIEW)
-- Generated: 2026-11-27T03:26:59.572Z
-- Target Project: AuroMasti (rlqrtbjynaihdspbqtce)
-- Total Canonical Migrations: 10
-- ==============================================================================
-- ARCHITECTURAL WARNING (B82-03):
-- Direct execution of this bundle in the Supabase Dashboard SQL Editor
-- DOES NOT update the Supabase CLI migration ledger (supabase_migrations.schema_migrations).
-- It is strictly an offline code audit preview, NOT a drop-in alternative to 'supabase db push'.
-- Any emergency manual disaster-recovery execution requires a separately approved
-- operational procedure including post-execution 'supabase migration repair --status applied'.
-- ==============================================================================


-- ------------------------------------------------------------------------------
-- [1/10] 20261120000001_b5_core_schema.sql
-- SHA-256: 4d9374cfde43b2ec8fec14ff0d66934ff66b43b63f7c3a4f13388064cd574e74
-- ------------------------------------------------------------------------------

-- ==============================================================================
-- AuroMind Modernization Batch B5 — Supabase Core Database Schema & RLS Policies
-- ==============================================================================
-- Migration ID: 20261120000001_b5_core_schema.sql
-- Description: Establishes player profiles, guest identity links, game cloud saves,
--              save revisions, server-verified entitlements, telemetry ingestion,
--              remote config, owner authorization, triggers, and strict RLS.
-- ==============================================================================

-- Enable standard UUID generation
create extension if not exists "pgcrypto";

-- ------------------------------------------------------------------------------
-- 1. Player Profiles (1:1 with auth.users)
-- ------------------------------------------------------------------------------
create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Seeker',
  preferred_locale text not null default 'en',
  preferences jsonb not null default '{}'::jsonb,
  analytics_opt_in boolean not null default false,
  cloud_sync_opt_in boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------------------------
-- 2. Guest Identity Links (Many devices/guest IDs -> 1 authenticated account)
-- ------------------------------------------------------------------------------
create table if not exists public.guest_identity_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  guest_id text not null check (guest_id ~ '^guest_[0-9a-f-]{36}$'),
  device_label text,
  linked_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (user_id, guest_id)
);

create index if not exists idx_guest_links_guest_id on public.guest_identity_links(guest_id);
create index if not exists idx_guest_links_user_id on public.guest_identity_links(user_id);

-- ------------------------------------------------------------------------------
-- 3. Game Cloud Saves (1 active save per user per game, optimistic concurrency)
-- ------------------------------------------------------------------------------
create table if not exists public.game_saves (
  user_id uuid not null references auth.users(id) on delete cascade,
  game_id text not null check (game_id in (
    'vak', 'auromatch', 'auromandala', 'word-riddle', 'vak-living-sanctuary', 'auroblocks'
  )),
  envelope_version integer not null default 1,
  game_schema_version integer not null default 1,
  revision bigint not null default 1,
  source_guest_id text,
  checksum text not null,
  payload jsonb not null check (pg_column_size(payload) <= 524288), -- 512 KB guard
  client_updated_at timestamptz not null,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, game_id)
);

-- ------------------------------------------------------------------------------
-- 4. Game Save Revision History (Rollback safety net; bounded retention: 5)
-- ------------------------------------------------------------------------------
create table if not exists public.game_save_revisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  game_id text not null,
  revision bigint not null,
  checksum text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_save_revisions_lookup on public.game_save_revisions(user_id, game_id, revision desc);

-- ------------------------------------------------------------------------------
-- 5. Server-Verified Entitlements (Browser READ-ONLY; writes via service_role/Edge Fn)
-- ------------------------------------------------------------------------------
create table if not exists public.entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sku text not null,
  game_id text not null, -- specific game_id or 'all'
  tier text not null default 'full',
  status text not null check (status in ('active', 'revoked', 'expired')),
  source text not null check (source in ('beta_free', 'verified_purchase', 'comp', 'admin')),
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, sku)
);

create index if not exists idx_entitlements_user_id on public.entitlements(user_id);

-- ------------------------------------------------------------------------------
-- 6. Entitlement Audit Ledger (Audit trail for verification, grants and revokes)
-- ------------------------------------------------------------------------------
create table if not exists public.entitlement_audit (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in ('grant', 'revoke', 'verify', 'restore')),
  sku text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_entitlement_audit_user on public.entitlement_audit(user_id, created_at desc);

-- ------------------------------------------------------------------------------
-- 7. Purchase Receipts / Payment Ledger (SERVER-ONLY; zero direct browser access)
-- ------------------------------------------------------------------------------
create table if not exists public.purchase_receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  provider text not null,
  provider_transaction_id text not null unique,
  sku text not null,
  amount_minor integer not null default 0,
  currency text not null default 'USD',
  status text not null check (status in ('pending', 'succeeded', 'refunded', 'disputed')),
  raw_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------------------
-- 8. Privacy-First Telemetry Events (Append-only, opt-in, zero PII, deduplicated)
-- ------------------------------------------------------------------------------
create table if not exists public.telemetry_events (
  id bigint generated always as identity primary key,
  event_id uuid not null unique,
  user_id uuid references auth.users(id) on delete set null,
  guest_id text,
  session_id text,
  game_id text not null,
  event_name text not null,
  category text not null check (category in (
    'lifecycle', 'engagement', 'progression', 'error', 'commerce', 'ui', 'system'
  )),
  schema_version integer not null default 1,
  payload jsonb not null default '{}'::jsonb,
  app_version text,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now()
);

create index if not exists idx_telemetry_event_id on public.telemetry_events(event_id);
create index if not exists idx_telemetry_game_cat on public.telemetry_events(game_id, category, occurred_at desc);
create index if not exists idx_telemetry_user on public.telemetry_events(user_id, occurred_at desc);

-- ------------------------------------------------------------------------------
-- 9. Remote Config & Feature Flags (Public READ-ONLY; admin/service_role writes only)
-- ------------------------------------------------------------------------------
create table if not exists public.remote_config (
  key text primary key,
  value jsonb not null,
  min_app_version text,
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------------------------
-- 10. Owner & Administrative Roles (Server-authoritative role verification)
-- ------------------------------------------------------------------------------
create table if not exists public.owner_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'analyst')),
  granted_at timestamptz not null default now()
);

-- ==============================================================================
-- Triggers and Stored Procedures
-- ==============================================================================

-- Trigger to archive prior revision on game_saves update
create or replace function public.archive_game_save_revision()
returns trigger
language plpgsql
security definer
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

  -- Retain only the latest 5 revisions per user per game
  delete from public.game_save_revisions
  where id in (
    select id from public.game_save_revisions
    where user_id = old.user_id and game_id = old.game_id
    order by revision desc
    offset 5
  );

  return new;
end;
$$;

drop trigger if exists trg_archive_game_save on public.game_saves;
create trigger trg_archive_game_save
  before update on public.game_saves
  for each row
  execute function public.archive_game_save_revision();

-- RPC Function: Optimistic Concurrency Save Upsert (upsert_game_save_checked)
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
security invoker
as $$
declare
  v_user_id uuid;
  v_existing record;
  v_new_revision bigint;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'status', 'unauthenticated', 'message', 'Authentication required.');
  end if;

  -- Check existing save row
  select * into v_existing
  from public.game_saves
  where user_id = v_user_id and game_id = p_game_id;

  if found then
    -- Optimistic revision check
    if p_expected_revision > 0 and v_existing.revision <> p_expected_revision then
      return jsonb_build_object(
        'ok', false,
        'status', 'conflict',
        'currentRevision', v_existing.revision,
        'expectedRevision', p_expected_revision,
        'serverRecord', jsonb_build_object(
          'envelopeVersion', v_existing.envelope_version,
          'gameSchemaVersion', v_existing.game_schema_version,
          'revision', v_existing.revision,
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
      source_guest_id = p_source_guest_id,
      checksum = p_checksum,
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
      -- Caller expected an existing revision, but none exists
      return jsonb_build_object(
        'ok', false,
        'status', 'conflict',
        'message', 'No existing save found, but expectedRevision > 0.'
      );
    end if;

    v_new_revision := 1;

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
      p_source_guest_id,
      p_checksum,
      p_payload,
      p_client_updated_at,
      now()
    );

    return jsonb_build_object(
      'ok', true,
      'status', 'success',
      'revision', v_new_revision,
      'gameId', p_game_id
    );
  end if;
end;
$$;

-- ==============================================================================
-- Row Level Security (RLS) Policies
-- ==============================================================================

alter table public.user_profiles enable row level security;
alter table public.guest_identity_links enable row level security;
alter table public.game_saves enable row level security;
alter table public.game_save_revisions enable row level security;
alter table public.entitlements enable row level security;
alter table public.entitlement_audit enable row level security;
alter table public.purchase_receipts enable row level security;
alter table public.telemetry_events enable row level security;
alter table public.remote_config enable row level security;
alter table public.owner_roles enable row level security;

-- 1. user_profiles policies
drop policy if exists "user_profiles_select_own" on public.user_profiles;
create policy "user_profiles_select_own" on public.user_profiles
  for select using (auth.uid() = user_id);

drop policy if exists "user_profiles_insert_own" on public.user_profiles;
create policy "user_profiles_insert_own" on public.user_profiles
  for insert with check (auth.uid() = user_id);

drop policy if exists "user_profiles_update_own" on public.user_profiles;
create policy "user_profiles_update_own" on public.user_profiles
  for update using (auth.uid() = user_id);

-- 2. guest_identity_links policies
drop policy if exists "guest_links_select_own" on public.guest_identity_links;
create policy "guest_links_select_own" on public.guest_identity_links
  for select using (auth.uid() = user_id);

drop policy if exists "guest_links_insert_own" on public.guest_identity_links;
create policy "guest_links_insert_own" on public.guest_identity_links
  for insert with check (auth.uid() = user_id);

drop policy if exists "guest_links_delete_own" on public.guest_identity_links;
create policy "guest_links_delete_own" on public.guest_identity_links
  for delete using (auth.uid() = user_id);

-- 3. game_saves policies
drop policy if exists "game_saves_select_own" on public.game_saves;
create policy "game_saves_select_own" on public.game_saves
  for select using (auth.uid() = user_id);

-- Direct client updates/inserts strictly routed through upsert_game_save_checked RPC
-- but fallback user-isolated insert/update policy is enabled for security:
drop policy if exists "game_saves_modify_own" on public.game_saves;
create policy "game_saves_modify_own" on public.game_saves
  for all using (auth.uid() = user_id);

-- 4. game_save_revisions policies
drop policy if exists "game_save_revisions_select_own" on public.game_save_revisions;
create policy "game_save_revisions_select_own" on public.game_save_revisions
  for select using (auth.uid() = user_id);

-- 5. entitlements policies (Browser READ-ONLY; writes strictly via service_role)
drop policy if exists "entitlements_select_own" on public.entitlements;
create policy "entitlements_select_own" on public.entitlements
  for select using (auth.uid() = user_id);

-- 6. entitlement_audit policies (Browser READ-ONLY for own audit events)
drop policy if exists "entitlement_audit_select_own" on public.entitlement_audit;
create policy "entitlement_audit_select_own" on public.entitlement_audit
  for select using (auth.uid() = user_id);

-- 7. purchase_receipts policies (Deny direct client SELECT/INSERT; service_role only)
-- Default deny-all in place by enabling RLS without public policies.

-- 8. telemetry_events policies
-- Ingestion: allowed for authenticated users and anonymous clients
drop policy if exists "telemetry_insert_any" on public.telemetry_events;
create policy "telemetry_insert_any" on public.telemetry_events
  for insert with check (
    auth.uid() is null or auth.uid() = user_id
  );

-- Reading telemetry: OWNER ROLE ONLY (Never public)
drop policy if exists "telemetry_select_owner_only" on public.telemetry_events;
create policy "telemetry_select_owner_only" on public.telemetry_events
  for select using (
    exists (
      select 1 from public.owner_roles
      where owner_roles.user_id = auth.uid() and owner_roles.role = 'owner'
    )
  );

-- 9. remote_config policies (Public READ-ONLY for all seekers; writes service_role only)
drop policy if exists "remote_config_read_all" on public.remote_config;
create policy "remote_config_read_all" on public.remote_config
  for select using (true);

-- 10. owner_roles policies (Only authenticated owners can check their own role)
drop policy if exists "owner_roles_select_own" on public.owner_roles;
create policy "owner_roles_select_own" on public.owner_roles
  for select using (auth.uid() = user_id);


-- ------------------------------------------------------------------------------
-- [2/10] 20261120000002_b8_rate_limiting.sql
-- SHA-256: 93690d69e23f7409ec0cb6c16d3bbd2e0281902d30c145f7c6cf345a6562b143
-- ------------------------------------------------------------------------------

-- ==============================================================================
-- AuroMind Modernization Batch B8 — Telemetry Ingestion Rate Limiting
-- ==============================================================================
-- Migration ID: 20261120000002_b8_rate_limiting.sql
-- Description: Establishes an atomic, privacy-preserving rate-limiting table and
--              stored procedure for telemetry ingestion abuse protection (FIND-02).
-- Target: Supabase PostgreSQL Database
-- Status: Proposed Implementation for Live Activation (NOT EXECUTED LOCALLY)
-- ==============================================================================

-- 1. Dedicated Atomic Rate Limiting Table
-- Fixed-window counters indexed by hashed client network bucket and window timestamp.
-- Client hash contains SHA-256(ip + salt); zero personal identifiable data stored.
create table if not exists public.telemetry_rate_limits (
  client_hash text not null,
  window_bucket timestamptz not null,
  request_count integer not null default 1,
  primary key (client_hash, window_bucket)
);

create index if not exists idx_telemetry_rate_limits_window
  on public.telemetry_rate_limits (window_bucket);

-- 2. Atomic Rate-Limiting Stored Procedure
-- Atomically inserts or increments the request count for the caller's time bucket.
-- Returns JSONB { allowed: boolean, current: integer, limit: integer, remaining: integer, retry_after: integer }
create or replace function public.check_telemetry_rate_limit(
  p_client_hash text,
  p_max_requests integer default 30,
  p_window_seconds integer default 60
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_now timestamptz := now();
  v_bucket_epoch bigint;
  v_window_bucket timestamptz;
  v_current_count integer;
  v_remaining integer;
  v_retry_after integer;
begin
  -- Normalize to fixed window bucket
  v_bucket_epoch := floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds;
  v_window_bucket := to_timestamp(v_bucket_epoch);

  -- Atomic insert or increment within PostgreSQL
  insert into public.telemetry_rate_limits (client_hash, window_bucket, request_count)
  values (p_client_hash, v_window_bucket, 1)
  on conflict (client_hash, window_bucket)
  do update set request_count = public.telemetry_rate_limits.request_count + 1
  returning request_count into v_current_count;

  -- Bounded table size: probabilistic garbage collection of expired buckets (older than 10 minutes)
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

-- 3. Security Hardening
-- Revoke all permissions from public, anonymous, and authenticated clients
revoke all on function public.check_telemetry_rate_limit(text, integer, integer) from public, anon, authenticated;
-- Grant execute strictly to service_role (used by ingest-telemetry Edge Function)
grant execute on function public.check_telemetry_rate_limit(text, integer, integer) to service_role;


-- ------------------------------------------------------------------------------
-- [3/10] 20261120000003_b13a_telemetry_rls_hardening.sql
-- SHA-256: 5ae748ca2cdf6bcb027651c602d590b73b71d44ec80f49decf31b5025688746d
-- ------------------------------------------------------------------------------

-- ==============================================================================
-- AuroMind Production Hardening Migration: B13A Telemetry RLS Hardening
-- Finding: AUDIT-SEC-01 (Direct telemetry table insertion bypassing Edge Function controls)
--
-- RATIONALE:
-- Previously, public.telemetry_events had an open RLS INSERT policy ("telemetry_insert_any")
-- allowing direct insertion via PostgREST by any client with the anon key. This allowed
-- an attacker to bypass Edge Function abuse protection, specifically:
--   1. Rate limiting (FIND-02 / check_telemetry_rate_limit)
--   2. Bounded body size checks (MAX_TELEMETRY_BODY_BYTES = 64 KiB)
--   3. Batch size limits (MAX_EVENTS_PER_BATCH = 50)
--   4. Client IP hashing and privacy redaction
--
-- REMEDIATION:
-- 1. Drop "telemetry_insert_any" policy.
-- 2. Revoke table-level INSERT permissions from 'anon', 'authenticated', and 'public' roles.
-- 3. Grant table-level INSERT permissions strictly to 'service_role'.
-- All client telemetry must flow through the 'ingest-telemetry' Edge Function.
-- Direct PostgREST inserts by seekers or anonymous clients are strictly denied.
-- ==============================================================================

-- 1. Drop the legacy open insert policy
drop policy if exists "telemetry_insert_any" on public.telemetry_events;

-- 2. Revoke INSERT privilege on public.telemetry_events from public and seeker roles
revoke insert on table public.telemetry_events from anon, authenticated, public;

-- 3. Ensure service_role has explicit INSERT and SELECT privileges for Edge Functions
grant select, insert on table public.telemetry_events to service_role;

-- 4. Owner-only SELECT policy remains active (telemetry_select_owner_only)
-- Read access is strictly reserved for authenticated users with 'owner' role in public.owner_roles.


-- ------------------------------------------------------------------------------
-- [4/10] 20261120000004_b13b_telemetry_retention.sql
-- SHA-256: 6be4fe7b122555e84fe6120dc2ed2c042d6a1a694e2c1cf4e39cb3784eaded5e
-- ------------------------------------------------------------------------------

-- ==============================================================================
-- AuroMind Production Maintenance Migration: B13B Telemetry Retention & Cleanup
-- Finding: AUDIT-PERF-01 (Unbounded telemetry table growth / 500 MB Free Tier Limit)
--
-- OBJECTIVES:
-- 1. Index server-authoritative timestamp `received_at` for high-performance pruning.
-- 2. Create `telemetry_daily_aggregates` table to preserve lifetime historical KPI
--    trends before raw event deletion (MAU/WAU/DAU and game breakdowns remain intact).
-- 3. Stored procedure `rollup_telemetry_aggregates` to safely aggregate raw events.
-- 4. Stored procedure `prune_expired_telemetry` to delete raw events older than 60
--    days in bounded batches (default 5,000 rows) preventing database lock escalation.
--
-- SCHEDULING PREREQUISITES (Production Supabase):
-- Option A (Recommended): PostgreSQL `pg_cron` Extension
--   Enable extension via Supabase Dashboard -> Database -> Extensions -> pg_cron.
--   Schedule nightly job:
--     select cron.schedule('auromind-nightly-telemetry-prune', '0 3 * * *',
--       $$select * from public.prune_expired_telemetry(60, 5000);$$);
-- Option B: Supabase Scheduled Edge Function
--   Deploy Edge Function `cleanup-telemetry` triggered via cron schedule in config.toml.
-- Option C: External Scheduled Runner
--   GitHub Actions or monitoring worker calling RPC `prune_expired_telemetry` via
--   HTTPS POST with the service_role key.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Index server-authoritative received_at timestamp for fast range scanning
-- ------------------------------------------------------------------------------
create index if not exists idx_telemetry_received_at on public.telemetry_events(received_at);

-- ------------------------------------------------------------------------------
-- 2. Historical Daily Aggregates Table (Preserves long-term analytics beyond 60d)
-- ------------------------------------------------------------------------------
create table if not exists public.telemetry_daily_aggregates (
  id bigint generated always as identity primary key,
  event_date date not null,
  game_id text not null,
  category text not null,
  event_name text not null,
  event_count integer not null default 0,
  unique_visitors integer not null default 0,
  unique_sessions integer not null default 0,
  aggregated_at timestamptz not null default now(),
  unique (event_date, game_id, category, event_name)
);

create index if not exists idx_telemetry_daily_agg_date on public.telemetry_daily_aggregates(event_date desc);
create index if not exists idx_telemetry_daily_agg_game on public.telemetry_daily_aggregates(game_id, event_date desc);

-- Enable Row Level Security on daily aggregates
alter table public.telemetry_daily_aggregates enable row level security;

-- Reading aggregates: OWNER ROLE ONLY (Never public)
drop policy if exists "telemetry_daily_agg_select_owner_only" on public.telemetry_daily_aggregates;
create policy "telemetry_daily_agg_select_owner_only" on public.telemetry_daily_aggregates
  for select using (
    exists (
      select 1 from public.owner_roles
      where owner_roles.user_id = auth.uid() and owner_roles.role = 'owner'
    )
  );

-- Service role permissions
grant select, insert, update on table public.telemetry_daily_aggregates to service_role;
revoke insert, update, delete on table public.telemetry_daily_aggregates from anon, authenticated, public;

-- ------------------------------------------------------------------------------
-- 3. Stored Procedure: rollup_telemetry_aggregates
-- Pre-aggregates raw telemetry events into summary rows before pruning
-- ------------------------------------------------------------------------------
create or replace function public.rollup_telemetry_aggregates(
  p_start_date date default null,
  p_end_date date default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inserted integer := 0;
  v_start date := coalesce(p_start_date, (current_date - interval '90 days')::date);
  v_end date := coalesce(p_end_date, (current_date - interval '60 days')::date);
begin
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
    event_count = excluded.event_count,
    unique_visitors = excluded.unique_visitors,
    unique_sessions = excluded.unique_sessions,
    aggregated_at = now();

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

-- ------------------------------------------------------------------------------
-- 4. Stored Procedure: prune_expired_telemetry
-- Deletes raw telemetry records older than retention period in bounded batches
-- ------------------------------------------------------------------------------
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
set search_path = public, pg_temp
as $$
declare
  v_cutoff timestamptz;
  v_deleted integer := 0;
  v_remaining integer := 0;
  v_batch integer := least(greatest(p_batch_size, 100), 20000); -- Clamp between 100 and 20,000
  v_days integer := greatest(p_retention_days, 30); -- Minimum safety guard: never prune under 30 days
begin
  -- 1. Compute server-authoritative cutoff time based on received_at
  v_cutoff := now() - (v_days || ' days')::interval;

  -- 2. Pre-aggregate telemetry before deleting raw rows
  perform public.rollup_telemetry_aggregates(
    (v_cutoff - interval '7 days')::date,
    v_cutoff::date
  );

  -- 3. Delete in bounded batch using indexed subquery
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

  -- 4. Count remaining expired records for monitoring/looping
  select count(*)
  into v_remaining
  from public.telemetry_events
  where received_at < v_cutoff;

  return query select v_deleted, v_remaining, v_cutoff;
end;
$$;

-- Privileges: Only service_role can execute maintenance cleanup
revoke execute on function public.prune_expired_telemetry(integer, integer) from public, anon, authenticated;
grant execute on function public.prune_expired_telemetry(integer, integer) to service_role;

revoke execute on function public.rollup_telemetry_aggregates(date, date) from public, anon, authenticated;
grant execute on function public.rollup_telemetry_aggregates(date, date) to service_role;


-- ------------------------------------------------------------------------------
-- [5/10] 20261122000001_b18c_profile_rls_separation.sql
-- SHA-256: f0084584508c9f649e4a8199f41c41f050402797297afecec1d517c02f37bbd8
-- ------------------------------------------------------------------------------

-- ==============================================================================
-- AuroMind Modernization Batch B18-C — Public Profile RLS & Privacy Separation
-- ==============================================================================
-- Migration ID: 20261122000001_b18c_profile_rls_separation.sql
-- Description: Physically isolates private user preferences into an owner-only table
--              (public.user_private_settings) and hardens public.user_profiles
--              to strictly prevent any direct or view-based private data leakage.
-- ==============================================================================

-- 1. Create Private Settings Table (Owner-Only Physical Boundary)
create table if not exists public.user_private_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  preferences jsonb not null default '{}'::jsonb,
  analytics_opt_in boolean not null default false,
  cloud_sync_opt_in boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Enable RLS on Private Settings
alter table public.user_private_settings enable row level security;
revoke all on public.user_private_settings from anon;
revoke delete on public.user_private_settings from authenticated;

-- Strictly Owner-Only Policies on Private Settings
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

-- 2. Restructure public.user_profiles for Safe Public Readability
-- (Only non-sensitive columns reside in user_profiles)
alter table public.user_profiles
  add column if not exists is_public boolean not null default false;

-- Migrate existing private columns to user_private_settings if columns and data still exist
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_profiles'
      and column_name = 'preferences'
  ) then
    insert into public.user_private_settings (user_id, preferences, analytics_opt_in, cloud_sync_opt_in, created_at, updated_at)
    select user_id, preferences, analytics_opt_in, cloud_sync_opt_in, created_at, updated_at
    from public.user_profiles
    on conflict (user_id) do nothing;
  end if;
end;
$$;

-- 3. RLS Policies on public.user_profiles
alter table public.user_profiles enable row level security;
revoke all on public.user_profiles from anon;
revoke delete on public.user_profiles from authenticated;

-- Owner has full control over their own public profile
drop policy if exists "user_profiles_owner_all" on public.user_profiles;
create policy "user_profiles_owner_all" on public.user_profiles
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Public read access on user_profiles permitted ONLY when is_public = true
drop policy if exists "user_profiles_public_select" on public.user_profiles;
create policy "user_profiles_public_select" on public.user_profiles
  for select to anon, authenticated
  using (is_public = true);

-- 4. Column-Level Grants (Defense in Depth)
grant select (user_id, display_name, preferred_locale, is_public, created_at, updated_at)
  on public.user_profiles to anon, authenticated;
grant insert, update (display_name, preferred_locale, is_public)
  on public.user_profiles to authenticated;

-- 5. Public Projection View (PostgreSQL 15+ security_invoker = true + security_barrier = true)
create or replace view public.public_user_profiles
with (security_invoker = true, security_barrier = true) as
  select
    user_id,
    display_name,
    preferred_locale,
    created_at
  from public.user_profiles
  where is_public = true;

grant select on public.public_user_profiles to anon, authenticated;


-- ------------------------------------------------------------------------------
-- [6/10] 20261122000002_b18c_telemetry_token_bucket.sql
-- SHA-256: 938649adecec6d5ae5b20c0979978bacf2441431fb20447dbc021eb9d7b66e89
-- ------------------------------------------------------------------------------

-- ==============================================================================
-- AuroMind Modernization Batch B18-C — Atomic Token Bucket & Storage Deletion Queue
-- ==============================================================================
-- Migration ID: 20261122000002_b18c_telemetry_token_bucket.sql
-- Description: Establishes a race-free atomic token bucket for distributed Edge
--              Function rate limiting and a durable storage deletion queue.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Unlogged Rate Limit Buckets Table (Crash-safe reset, high write throughput)
-- ------------------------------------------------------------------------------
create unlogged table if not exists public.telemetry_rate_buckets (
  ip_hash bytea primary key,
  tokens numeric(8, 2) not null,
  last_fill timestamptz not null
);

create index if not exists idx_telemetry_rate_buckets_last_fill
  on public.telemetry_rate_buckets (last_fill);

-- Revoke client permissions completely; accessed strictly via Edge Function service_role
revoke all on public.telemetry_rate_buckets from anon, authenticated;
grant select, insert, update, delete on public.telemetry_rate_buckets to service_role;

-- ------------------------------------------------------------------------------
-- 2. Race-Free Atomic Token Bucket Consumption Function
-- ------------------------------------------------------------------------------
create or replace function public.consume_telemetry_token(
  p_ip_hash bytea,
  p_capacity numeric default 60.0,
  p_fill_rate numeric default 1.0 -- 1 token per second (60/minute)
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_tokens numeric(8, 2);
  v_last_fill timestamptz;
  v_new_tokens numeric(8, 2);
  v_allowed boolean;
begin
  -- Validate inputs
  if p_capacity <= 0 or p_fill_rate <= 0 then
    return jsonb_build_object('allowed', false, 'error', 'INVALID_PARAMETERS');
  end if;

  -- Step 1: Atomic initialization with ON CONFLICT DO NOTHING (eliminates insert races)
  insert into public.telemetry_rate_buckets (ip_hash, tokens, last_fill)
  values (p_ip_hash, p_capacity, v_now)
  on conflict (ip_hash) do nothing;

  -- Step 2: Row-level lock acquisition
  select tokens, last_fill into v_tokens, v_last_fill
  from public.telemetry_rate_buckets
  where ip_hash = p_ip_hash
  for update;

  -- Step 3: Continuous token replenishment based on elapsed time
  v_new_tokens := least(
    p_capacity,
    v_tokens + (extract(epoch from (v_now - v_last_fill)) * p_fill_rate)
  );

  -- Step 4: Token consumption check
  if v_new_tokens >= 1.0 then
    v_new_tokens := v_new_tokens - 1.0;
    v_allowed := true;
  else
    v_allowed := false;
  end if;

  -- Step 5: Update state atomically
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

-- ------------------------------------------------------------------------------
-- 3. Durable Storage Deletion Queue Table
-- ------------------------------------------------------------------------------
create table if not exists public.storage_deletion_queue (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null default 'user-artwork',
  object_path text not null,
  artwork_id uuid not null,
  snapshot_id uuid,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed')),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  last_error text,
  next_retry_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_storage_deletion_queue_pending
  on public.storage_deletion_queue (status, next_retry_at)
  where status in ('pending', 'processing');

revoke all on public.storage_deletion_queue from anon, authenticated;
grant select, insert, update, delete on public.storage_deletion_queue to service_role;


-- ------------------------------------------------------------------------------
-- [7/10] 20261122000003_b18c_telemetry_search_path_hardening.sql
-- SHA-256: 10ebff8ccbf0112e65cd58ed66df683e35560eb26e2b43bf2b68241bc55e8b33
-- ------------------------------------------------------------------------------

-- ==============================================================================
-- AuroMind Modernization Batch B18-C — Telemetry Security Definer Search Path Hardening
-- ==============================================================================
-- Migration ID: 20261122000003_b18c_telemetry_search_path_hardening.sql
-- Description: Hardens public.consume_telemetry_token against search_path hijacking
--              by explicitly pinning search_path to 'pg_catalog, public', ensuring
--              all table references are fully schema-qualified, and strictly
--              restricting EXECUTE grants to service_role only.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Redefine consume_telemetry_token with Explicit search_path
-- ------------------------------------------------------------------------------
create or replace function public.consume_telemetry_token(
  p_ip_hash bytea,
  p_capacity numeric default 60.0,
  p_fill_rate numeric default 1.0 -- 1 token per second (60/minute)
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_tokens numeric(8, 2);
  v_last_fill timestamptz;
  v_new_tokens numeric(8, 2);
  v_allowed boolean;
begin
  -- Validate inputs
  if p_capacity <= 0 or p_fill_rate <= 0 then
    return jsonb_build_object('allowed', false, 'error', 'INVALID_PARAMETERS');
  end if;

  -- Step 1: Atomic initialization with ON CONFLICT DO NOTHING (eliminates insert races)
  insert into public.telemetry_rate_buckets (ip_hash, tokens, last_fill)
  values (p_ip_hash, p_capacity, v_now)
  on conflict (ip_hash) do nothing;

  -- Step 2: Row-level lock acquisition
  select tokens, last_fill into v_tokens, v_last_fill
  from public.telemetry_rate_buckets
  where ip_hash = p_ip_hash
  for update;

  -- Step 3: Continuous token replenishment based on elapsed time
  v_new_tokens := least(
    p_capacity,
    v_tokens + (extract(epoch from (v_now - v_last_fill)) * p_fill_rate)
  );

  -- Step 4: Token consumption check
  if v_new_tokens >= 1.0 then
    v_new_tokens := v_new_tokens - 1.0;
    v_allowed := true;
  else
    v_allowed := false;
  end if;

  -- Step 5: Update state atomically
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

-- ------------------------------------------------------------------------------
-- 2. Strict Privilege Hardening
-- ------------------------------------------------------------------------------
-- Revoke all permissions on function from public, anon, and authenticated
revoke all on function public.consume_telemetry_token(bytea, numeric, numeric) from public, anon, authenticated;

-- Grant EXECUTE exclusively to service_role (used by Edge Functions)
grant execute on function public.consume_telemetry_token(bytea, numeric, numeric) to service_role;


-- ------------------------------------------------------------------------------
-- [8/10] 20261122000004_b18d_telemetry_token_bucket_input_validation.sql
-- SHA-256: dfdba762681b1ba5002bdc9ed4e8ad2b75fcb7f3644285decc73b68e89832fd3
-- ------------------------------------------------------------------------------

-- ==============================================================================
-- AuroMind Modernization Batch B18-D — Telemetry Token Bucket Input Validation & Numeric Overflow Hardening
-- ==============================================================================
-- Migration ID: 20261122000004_b18d_telemetry_token_bucket_input_validation.sql
-- Description: Hardens public.consume_telemetry_token with strict defensive parameter
--              validation:
--              1. Rejects NULL, empty, or oversized (> 64 bytes) IP hashes.
--              2. Rejects PostgreSQL numeric non-finite values ('NaN', 'Infinity', '-Infinity')
--                 without using unsafe 'x != x' checks.
--              3. Enforces bounded positive ranges for capacity [1.0, 1000.0] and
--                 refill rate [0.01, 100.0] tokens/sec, preventing numeric(8,2) overflow.
--              4. Prevents intermediate multiplication overflow on large elapsed times.
--              5. Retains SECURITY DEFINER, search_path = 'pg_catalog, public',
--                 schema-qualified table access, and service_role-only privileges.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Forward Migration: Replace consume_telemetry_token with Hardened Signature
-- ------------------------------------------------------------------------------
create or replace function public.consume_telemetry_token(
  p_ip_hash bytea,
  p_capacity numeric default 60.0,
  p_fill_rate numeric default 1.0 -- tokens per second (default 60/min)
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_tokens numeric(8, 2);
  v_last_fill timestamptz;
  v_new_tokens numeric(8, 2);
  v_allowed boolean;
  v_elapsed numeric;
begin
  -- ----------------------------------------------------------------------------
  -- Input Validation Gate 1: IP Hash Structure & Length
  -- ----------------------------------------------------------------------------
  if p_ip_hash is null or octet_length(p_ip_hash) = 0 then
    return jsonb_build_object(
      'allowed', false,
      'error', 'INVALID_PARAMETERS',
      'code', 'ERR_EMPTY_OR_NULL_IP_HASH'
    );
  end if;

  -- SHA-256 binary hash is 32 bytes; hex encoding is 64 bytes. Bounded to max 64 bytes.
  if octet_length(p_ip_hash) > 64 then
    return jsonb_build_object(
      'allowed', false,
      'error', 'INVALID_PARAMETERS',
      'code', 'ERR_IP_HASH_EXCEEDS_MAX_LENGTH'
    );
  end if;

  -- ----------------------------------------------------------------------------
  -- Input Validation Gate 2: Non-Finite PostgreSQL Numeric Rejection
  -- ----------------------------------------------------------------------------
  -- In PostgreSQL, numeric supports 'NaN' and in modern versions 'Infinity'/'-Infinity'.
  -- 'NaN' = 'NaN' is TRUE in PostgreSQL, so 'x != x' FAILS as a NaN detector.
  -- We evaluate explicit equality against 'NaN'::numeric and text representations.
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

  -- ----------------------------------------------------------------------------
  -- Input Validation Gate 3: Explicit Lower and Upper Bounds
  -- ----------------------------------------------------------------------------
  -- Capacity lower bound: at least 1.0 token.
  -- Capacity upper bound: 1000.0 tokens (burst limit, well within numeric(8,2) max 999999.99).
  if p_capacity < 1.0 or p_capacity > 1000.0 then
    return jsonb_build_object(
      'allowed', false,
      'error', 'INVALID_PARAMETERS',
      'code', 'ERR_CAPACITY_OUT_OF_BOUNDS'
    );
  end if;

  -- Fill rate lower bound: 0.01 tokens/sec (1 token per 100s).
  -- Fill rate upper bound: 100.0 tokens/sec (6,000/min burst throughput).
  if p_fill_rate < 0.01 or p_fill_rate > 100.0 then
    return jsonb_build_object(
      'allowed', false,
      'error', 'INVALID_PARAMETERS',
      'code', 'ERR_FILL_RATE_OUT_OF_BOUNDS'
    );
  end if;

  -- ----------------------------------------------------------------------------
  -- Step 1: Atomic initialization with ON CONFLICT DO NOTHING (race-free)
  -- ----------------------------------------------------------------------------
  insert into public.telemetry_rate_buckets (ip_hash, tokens, last_fill)
  values (p_ip_hash, p_capacity, v_now)
  on conflict (ip_hash) do nothing;

  -- ----------------------------------------------------------------------------
  -- Step 2: Row-level lock acquisition (strict serialization per IP hash)
  -- ----------------------------------------------------------------------------
  select tokens, last_fill into v_tokens, v_last_fill
  from public.telemetry_rate_buckets
  where ip_hash = p_ip_hash
  for update;

  -- ----------------------------------------------------------------------------
  -- Step 3: Elapsed time calculation & overflow-safe token replenishment
  -- ----------------------------------------------------------------------------
  v_elapsed := extract(epoch from (v_now - v_last_fill));

  -- Clock rollback protection (non-negative monotonic elapsed duration)
  if v_elapsed < 0 then
    v_elapsed := 0;
  end if;

  -- Arithmetic overflow protection: clamp replenishment before numeric(8,2) intermediate multiplication
  if (v_elapsed * p_fill_rate) >= p_capacity then
    v_new_tokens := p_capacity;
  else
    v_new_tokens := least(p_capacity, v_tokens + (v_elapsed * p_fill_rate));
  end if;

  -- ----------------------------------------------------------------------------
  -- Step 4: Token consumption check
  -- ----------------------------------------------------------------------------
  if v_new_tokens >= 1.0 then
    v_new_tokens := v_new_tokens - 1.0;
    v_allowed := true;
  else
    v_allowed := false;
  end if;

  -- ----------------------------------------------------------------------------
  -- Step 5: Update state atomically
  -- ----------------------------------------------------------------------------
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

-- ------------------------------------------------------------------------------
-- 2. Strict Privilege Hardening (Preserve Service Role Exclusivity)
-- ------------------------------------------------------------------------------
revoke all on function public.consume_telemetry_token(bytea, numeric, numeric) from public, anon, authenticated;
grant execute on function public.consume_telemetry_token(bytea, numeric, numeric) to service_role;


-- ------------------------------------------------------------------------------
-- [9/10] 20261123000001_b19_5_05_db_integrity_and_rls_hardening.sql
-- SHA-256: cfc36b11dbf5df5c5ef9f030580a9f227ceb639b4ccf929d88555551a157f7b8
-- ------------------------------------------------------------------------------

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


-- ------------------------------------------------------------------------------
-- [10/10] 20261123000002_b19_5_06_storage_buckets_and_rls.sql
-- SHA-256: bc6b04da5572076f10969a0874de5bfe89bfc77e8546ba13c991bc651549ef63
-- ------------------------------------------------------------------------------

-- ==============================================================================
-- AuroMind Remediation Batch B19.5-06 — Storage Buckets & Owner-Folder RLS
-- ==============================================================================
-- Migration ID: 20261123000002_b19_5_06_storage_buckets_and_rls.sql
-- Description:
--   1. Provisions private 'avatars' (512 KiB; PNG/JPEG/WebP only, no SVG) and
--      'user-artwork' (5 MiB; PNG/WebP/JSON optional opt-in cloud backup) buckets
--      when Supabase storage schema is present.
--   2. Enforces strict authenticated owner-folder RLS on storage.objects
--      ((storage.foldername(name))[1] = auth.uid()::text) with path-traversal
--      denial and zero anonymous object access.
-- ==============================================================================

do $$
begin
  -- Only apply storage bucket configuration when storage.buckets exists (Supabase Storage)
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'avatars',
      'avatars',
      false,
      524288,
      array['image/png', 'image/jpeg', 'image/webp']
    )
    on conflict (id) do update set
      public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'user-artwork',
      'user-artwork',
      false,
      5242880,
      array['image/png', 'image/webp', 'application/json']
    )
    on conflict (id) do update set
      public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
  end if;

  -- Enforce strict owner-folder RLS policies when storage.objects & storage.foldername exist
  if to_regclass('storage.objects') is not null
     and to_regprocedure('storage.foldername(text)') is not null then

    execute 'alter table storage.objects enable row level security';

    -- Avatars bucket: owner-only SELECT, INSERT, UPDATE, DELETE (zero anon access)
    execute 'drop policy if exists "avatars_owner_select" on storage.objects';
    execute $p$
      create policy "avatars_owner_select" on storage.objects
        for select to authenticated
        using (
          bucket_id = 'avatars'
          and name !~ '(^|/)\.\.(/|$)'
          and (storage.foldername(name))[1] = auth.uid()::text
        )
    $p$;

    execute 'drop policy if exists "avatars_owner_insert" on storage.objects';
    execute $p$
      create policy "avatars_owner_insert" on storage.objects
        for insert to authenticated
        with check (
          bucket_id = 'avatars'
          and name !~ '(^|/)\.\.(/|$)'
          and (storage.foldername(name))[1] = auth.uid()::text
          and (owner is null or owner = auth.uid())
        )
    $p$;

    execute 'drop policy if exists "avatars_owner_update" on storage.objects';
    execute $p$
      create policy "avatars_owner_update" on storage.objects
        for update to authenticated
        using (
          bucket_id = 'avatars'
          and name !~ '(^|/)\.\.(/|$)'
          and (storage.foldername(name))[1] = auth.uid()::text
        )
        with check (
          bucket_id = 'avatars'
          and name !~ '(^|/)\.\.(/|$)'
          and (storage.foldername(name))[1] = auth.uid()::text
          and (owner is null or owner = auth.uid())
        )
    $p$;

    execute 'drop policy if exists "avatars_owner_delete" on storage.objects';
    execute $p$
      create policy "avatars_owner_delete" on storage.objects
        for delete to authenticated
        using (
          bucket_id = 'avatars'
          and name !~ '(^|/)\.\.(/|$)'
          and (storage.foldername(name))[1] = auth.uid()::text
        )
    $p$;

    -- User-Artwork bucket (optional opt-in cloud backup only): strictly private owner-only RLS
    execute 'drop policy if exists "artwork_owner_select" on storage.objects';
    execute $p$
      create policy "artwork_owner_select" on storage.objects
        for select to authenticated
        using (
          bucket_id = 'user-artwork'
          and name !~ '(^|/)\.\.(/|$)'
          and (storage.foldername(name))[1] = auth.uid()::text
        )
    $p$;

    execute 'drop policy if exists "artwork_owner_insert" on storage.objects';
    execute $p$
      create policy "artwork_owner_insert" on storage.objects
        for insert to authenticated
        with check (
          bucket_id = 'user-artwork'
          and name !~ '(^|/)\.\.(/|$)'
          and (storage.foldername(name))[1] = auth.uid()::text
          and (owner is null or owner = auth.uid())
        )
    $p$;

    execute 'drop policy if exists "artwork_owner_update" on storage.objects';
    execute $p$
      create policy "artwork_owner_update" on storage.objects
        for update to authenticated
        using (
          bucket_id = 'user-artwork'
          and name !~ '(^|/)\.\.(/|$)'
          and (storage.foldername(name))[1] = auth.uid()::text
        )
        with check (
          bucket_id = 'user-artwork'
          and name !~ '(^|/)\.\.(/|$)'
          and (storage.foldername(name))[1] = auth.uid()::text
          and (owner is null or owner = auth.uid())
        )
    $p$;

    execute 'drop policy if exists "artwork_owner_delete" on storage.objects';
    execute $p$
      create policy "artwork_owner_delete" on storage.objects
        for delete to authenticated
        using (
          bucket_id = 'user-artwork'
          and name !~ '(^|/)\.\.(/|$)'
          and (storage.foldername(name))[1] = auth.uid()::text
        )
    $p$;
  end if;
end;
$$;

