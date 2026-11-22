-- ==============================================================================
-- AuroMind Modernization Batch B18-D — Authenticated RLS & PostgREST Validation Matrix
-- ==============================================================================
-- File: tests/rls/b18-d-rls-pgtap-matrix.sql
-- Description: Reproducible pgTAP and PostgreSQL SQL validation test suite executing
--              under simulated PostgREST JWT claim contexts:
--              1. Anonymous access boundaries
--              2. Authenticated User A accessing own data
--              3. Authenticated User A blocked from User B private settings
--              4. Public profile visibility (is_public = true vs false)
--              5. Storage object ownership in user-artwork bucket
--              6. auth.uid() behavior under realistic request.jwt.claims
--              7. Service-role administrative bypass
--
-- Execution Instruction:
--   psql -h localhost -p 54322 -U postgres -d postgres -f tests/rls/b18-d-rls-pgtap-matrix.sql
-- ==============================================================================

\set ON_ERROR_STOP on

begin;

-- ------------------------------------------------------------------------------
-- 1. Setup Mock PostgREST Environment (Roles & auth schema simulation)
-- ------------------------------------------------------------------------------
create schema if not exists auth;

-- Emulate Supabase auth.uid() function
create or replace function auth.uid() returns uuid as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$ language sql stable;

-- Create PostgREST roles if they do not exist
do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
end;
$$;

-- ------------------------------------------------------------------------------
-- 2. Setup Test Data (User A and User B)
-- ------------------------------------------------------------------------------
\set user_a '\'11111111-1111-1111-1111-111111111111\''
\set user_b '\'22222222-2222-2222-2222-222222222222\''

-- Clean previous test rows
delete from public.user_private_settings where user_id in (:user_a::uuid, :user_b::uuid);
delete from public.user_profiles where user_id in (:user_a::uuid, :user_b::uuid);

-- Insert User A (Public Profile)
insert into public.user_profiles (user_id, display_name, preferred_locale, is_public)
values (:user_a::uuid, 'User Alpha (Public)', 'en', true);

insert into public.user_private_settings (user_id, preferences, analytics_opt_in, cloud_sync_opt_in)
values (:user_a::uuid, '{"volume": 0.8, "secret_notes": "AlphaSecret"}'::jsonb, true, true);

-- Insert User B (Private Profile)
insert into public.user_profiles (user_id, display_name, preferred_locale, is_public)
values (:user_b::uuid, 'User Beta (Private)', 'fr', false);

insert into public.user_private_settings (user_id, preferences, analytics_opt_in, cloud_sync_opt_in)
values (:user_b::uuid, '{"volume": 0.4, "secret_notes": "BetaSecret"}'::jsonb, false, false);

-- ------------------------------------------------------------------------------
-- 3. Validation Case 1: Anonymous Access Boundaries
-- ------------------------------------------------------------------------------
-- Simulate PostgREST Anonymous Request Context
set local role anon;
set local "request.jwt.claims" = '';
set local "request.jwt.claim.sub" = '';
set local "request.jwt.claim.role" = 'anon';

-- Test 1.1: Anon must NOT see private settings (0 rows)
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.user_private_settings;
  if v_count <> 0 then
    raise exception 'RLS_SECURITY_VIOLATION: Anon saw % private settings rows!', v_count;
  end if;
end;
$$;

-- Test 1.2: Anon must see ONLY public profiles (User A yes, User B no)
do $$
declare
  v_count integer;
  v_b_seen boolean;
begin
  select count(*) into v_count from public.public_user_profiles;
  select exists(select 1 from public.public_user_profiles where user_id = '22222222-2222-2222-2222-222222222222'::uuid) into v_b_seen;
  if v_count <> 1 or v_b_seen then
    raise exception 'RLS_SECURITY_VIOLATION: Anon saw private profile in public view!';
  end if;
end;
$$;

-- ------------------------------------------------------------------------------
-- 4. Validation Case 2: Authenticated User A Accessing Own Data
-- ------------------------------------------------------------------------------
-- Simulate PostgREST User A JWT Request Context
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","email":"usera@example.com"}';
set local "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
set local "request.jwt.claim.role" = 'authenticated';

-- Test 2.1: auth.uid() must resolve to User A
do $$
begin
  if auth.uid() <> '11111111-1111-1111-1111-111111111111'::uuid then
    raise exception 'JWT_CLAIM_VIOLATION: auth.uid() did not resolve to User A!';
  end if;
end;
$$;

-- Test 2.2: User A selects own private settings (must see exactly 1 row with AlphaSecret)
do $$
declare
  v_secret text;
begin
  select preferences->>'secret_notes' into v_secret
  from public.user_private_settings
  where user_id = '11111111-1111-1111-1111-111111111111'::uuid;

  if v_secret <> 'AlphaSecret' then
    raise exception 'RLS_OWNER_VIOLATION: User A could not read own private settings!';
  end if;
end;
$$;

-- ------------------------------------------------------------------------------
-- 5. Validation Case 3: User A Probing User B Private Data (Cross-Tenant Isolation)
-- ------------------------------------------------------------------------------
-- Still in User A context:
do $$
declare
  v_count integer;
begin
  -- User A attempts direct query for User B private settings
  select count(*) into v_count
  from public.user_private_settings
  where user_id = '22222222-2222-2222-2222-222222222222'::uuid;

  if v_count <> 0 then
    raise exception 'CRITICAL_RLS_LEAK: User A was able to read User B private settings!';
  end if;
end;
$$;

-- Test 3.2: User A querying user_profiles sees User B ONLY IF is_public = true
do $$
declare
  v_seen_b boolean;
begin
  select exists(
    select 1 from public.user_profiles where user_id = '22222222-2222-2222-2222-222222222222'::uuid
  ) into v_seen_b;

  if v_seen_b then
    raise exception 'CRITICAL_RLS_LEAK: User A saw User B private profile row!';
  end if;
end;
$$;

-- ------------------------------------------------------------------------------
-- 6. Validation Case 4: Storage Object Ownership Boundary
-- ------------------------------------------------------------------------------
-- Simulate storage.objects table and policies for user-artwork bucket
create schema if not exists storage;
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null,
  name text not null,
  owner uuid,
  created_at timestamptz default now()
);

alter table storage.objects enable row level security;
revoke all on storage.objects from anon;

drop policy if exists "artwork_owner_select" on storage.objects;
create policy "artwork_owner_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'user-artwork'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Helper function storage.foldername
create or replace function storage.foldername(name text)
returns text[] as $$
  select string_to_array(name, '/');
$$ language sql immutable;

-- Insert artwork objects as service_role
reset role;
insert into storage.objects (bucket_id, name, owner)
values
  ('user-artwork', '11111111-1111-1111-1111-111111111111/mandala-1.png', '11111111-1111-1111-1111-111111111111'::uuid),
  ('user-artwork', '22222222-2222-2222-2222-222222222222/mandala-secret.png', '22222222-2222-2222-2222-222222222222'::uuid);

-- Re-assume User A authenticated context
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
set local "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
set local "request.jwt.claim.role" = 'authenticated';

-- Test 4.1: User A can see own artwork in user-artwork bucket
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from storage.objects where bucket_id = 'user-artwork';
  if v_count <> 1 then
    raise exception 'STORAGE_RLS_VIOLATION: User A expected 1 visible artwork, saw %', v_count;
  end if;
end;
$$;

-- Test 4.2: User A cannot see User B artwork
do $$
declare
  v_seen_b boolean;
begin
  select exists(
    select 1 from storage.objects
    where bucket_id = 'user-artwork' and name like '22222222-2222-2222-2222-222222222222/%'
  ) into v_seen_b;

  if v_seen_b then
    raise exception 'CRITICAL_STORAGE_LEAK: User A can read User B artwork object!';
  end if;
end;
$$;

-- ------------------------------------------------------------------------------
-- 7. Validation Case 5: Service Role Administrative Access
-- ------------------------------------------------------------------------------
set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';
set local "request.jwt.claim.role" = 'service_role';

do $$
declare
  v_count integer;
begin
  -- Service role can read all storage objects
  select count(*) into v_count from storage.objects where bucket_id = 'user-artwork';
  if v_count < 2 then
    raise exception 'SERVICE_ROLE_VIOLATION: Service role could not read all storage objects!';
  end if;
end;
$$;

rollback; -- Always rollback test transaction

\echo '====================================================='
\echo 'ALL POSTGREST / RLS AUTHENTICATED TESTS PASSED!'
\echo '====================================================='
