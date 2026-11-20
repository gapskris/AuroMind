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
