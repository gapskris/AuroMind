-- ==============================================================================
-- AuroMasti Platform — Storage Buckets & Owner-Folder RLS Remediation (B19.9.8)
-- ==============================================================================
-- Target: Supabase Project rlqrtbjynaihdspbqtce (ap-southeast-1)
-- Description:
--   1. Provisions private 'avatars' (512 KiB; PNG/JPEG/WebP only, no SVG) and
--      'user-artwork' (5 MiB; PNG/WebP/JSON) buckets in storage.buckets.
--   2. Enforces strict authenticated owner-folder RLS on storage.objects
--      ((storage.foldername(name))[1] = auth.uid()::text) with path-traversal
--      denial and zero anonymous object access.
--   3. Omits the redundant ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY
--      which triggers SQLSTATE 42501 on hosted Supabase instances where RLS is
--      already enabled by default under supabase_storage_admin ownership.
-- ==============================================================================

DO $$
BEGIN
  -- 1. Provision private storage buckets
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'avatars',
      'avatars',
      false,
      524288,
      ARRAY['image/png', 'image/jpeg', 'image/webp']
    )
    ON CONFLICT (id) DO UPDATE SET
      public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'user-artwork',
      'user-artwork',
      false,
      5242880,
      ARRAY['image/png', 'image/webp', 'application/json']
    )
    ON CONFLICT (id) DO UPDATE SET
      public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;
  END IF;

  -- 2. Enforce strict owner-folder RLS policies on storage.objects
  IF to_regclass('storage.objects') IS NOT NULL
     AND to_regprocedure('storage.foldername(text)') IS NOT NULL THEN

    -- Avatars bucket policies (4 policies)
    EXECUTE 'DROP POLICY IF EXISTS "avatars_owner_select" ON storage.objects';
    EXECUTE $p$
      CREATE POLICY "avatars_owner_select" ON storage.objects
        FOR SELECT TO authenticated
        USING (
          bucket_id = 'avatars'
          AND name !~ '(^|/)\.\.(/|$)'
          AND (storage.foldername(name))[1] = auth.uid()::text
        )
    $p$;

    EXECUTE 'DROP POLICY IF EXISTS "avatars_owner_insert" ON storage.objects';
    EXECUTE $p$
      CREATE POLICY "avatars_owner_insert" ON storage.objects
        FOR INSERT TO authenticated
        WITH CHECK (
          bucket_id = 'avatars'
          AND name !~ '(^|/)\.\.(/|$)'
          AND (storage.foldername(name))[1] = auth.uid()::text
          AND (owner IS NULL OR owner = auth.uid())
        )
    $p$;

    EXECUTE 'DROP POLICY IF EXISTS "avatars_owner_update" ON storage.objects';
    EXECUTE $p$
      CREATE POLICY "avatars_owner_update" ON storage.objects
        FOR UPDATE TO authenticated
        USING (
          bucket_id = 'avatars'
          AND name !~ '(^|/)\.\.(/|$)'
          AND (storage.foldername(name))[1] = auth.uid()::text
        )
        WITH CHECK (
          bucket_id = 'avatars'
          AND name !~ '(^|/)\.\.(/|$)'
          AND (storage.foldername(name))[1] = auth.uid()::text
          AND (owner IS NULL OR owner = auth.uid())
        )
    $p$;

    EXECUTE 'DROP POLICY IF EXISTS "avatars_owner_delete" ON storage.objects';
    EXECUTE $p$
      CREATE POLICY "avatars_owner_delete" ON storage.objects
        FOR DELETE TO authenticated
        USING (
          bucket_id = 'avatars'
          AND name !~ '(^|/)\.\.(/|$)'
          AND (storage.foldername(name))[1] = auth.uid()::text
        )
    $p$;

    -- User-Artwork bucket policies (4 policies)
    EXECUTE 'DROP POLICY IF EXISTS "artwork_owner_select" ON storage.objects';
    EXECUTE $p$
      CREATE POLICY "artwork_owner_select" ON storage.objects
        FOR SELECT TO authenticated
        USING (
          bucket_id = 'user-artwork'
          AND name !~ '(^|/)\.\.(/|$)'
          AND (storage.foldername(name))[1] = auth.uid()::text
        )
    $p$;

    EXECUTE 'DROP POLICY IF EXISTS "artwork_owner_insert" ON storage.objects';
    EXECUTE $p$
      CREATE POLICY "artwork_owner_insert" ON storage.objects
        FOR INSERT TO authenticated
        WITH CHECK (
          bucket_id = 'user-artwork'
          AND name !~ '(^|/)\.\.(/|$)'
          AND (storage.foldername(name))[1] = auth.uid()::text
          AND (owner IS NULL OR owner = auth.uid())
        )
    $p$;

    EXECUTE 'DROP POLICY IF EXISTS "artwork_owner_update" ON storage.objects';
    EXECUTE $p$
      CREATE POLICY "artwork_owner_update" ON storage.objects
        FOR UPDATE TO authenticated
        USING (
          bucket_id = 'user-artwork'
          AND name !~ '(^|/)\.\.(/|$)'
          AND (storage.foldername(name))[1] = auth.uid()::text
        )
        WITH CHECK (
          bucket_id = 'user-artwork'
          AND name !~ '(^|/)\.\.(/|$)'
          AND (storage.foldername(name))[1] = auth.uid()::text
          AND (owner IS NULL OR owner = auth.uid())
        )
    $p$;

    EXECUTE 'DROP POLICY IF EXISTS "artwork_owner_delete" ON storage.objects';
    EXECUTE $p$
      CREATE POLICY "artwork_owner_delete" ON storage.objects
        FOR DELETE TO authenticated
        USING (
          bucket_id = 'user-artwork'
          AND name !~ '(^|/)\.\.(/|$)'
          AND (storage.foldername(name))[1] = auth.uid()::text
        )
    $p$;
  END IF;
END;
$$;
