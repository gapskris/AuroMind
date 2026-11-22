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
