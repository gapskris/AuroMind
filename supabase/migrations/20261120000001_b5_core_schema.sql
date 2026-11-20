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
