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
