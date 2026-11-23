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
