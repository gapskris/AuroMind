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
