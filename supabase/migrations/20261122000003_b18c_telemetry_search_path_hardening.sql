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
