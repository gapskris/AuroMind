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
