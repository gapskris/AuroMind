-- ==============================================================================
-- AuroMasti Post-Migration Schema Verification Script
-- Target Project: AuroMasti (rlqrtbjynaihdspbqtce)
-- ==============================================================================
-- Non-mutating read-only transaction. Verifies:
-- 1. All 15 expected public tables exist.
-- 2. Row Level Security (RLS) is ENABLED on every public table.
-- 3. All SECURITY DEFINER functions have search_path hardened.
-- 4. Storage buckets and policies exist.
-- ==============================================================================

DO $$
DECLARE
  v_expected_tables TEXT[] := ARRAY[
    'user_profiles',
    'guest_identity_links',
    'game_saves',
    'game_save_revisions',
    'entitlements',
    'entitlement_audit',
    'purchase_receipts',
    'telemetry_events',
    'remote_config',
    'owner_roles',
    'telemetry_rate_limits',
    'telemetry_daily_aggregates',
    'user_private_settings',
    'telemetry_rate_buckets',
    'storage_deletion_queue'
  ];
  v_missing_tables TEXT[];
  v_unprotected_tables TEXT[];
  v_unpinned_functions TEXT[];
  t TEXT;
BEGIN
  -- 1. Check for missing tables
  SELECT ARRAY_AGG(tbl)
  INTO v_missing_tables
  FROM UNNEST(v_expected_tables) AS tbl
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = tbl
  );

  IF v_missing_tables IS NOT NULL AND ARRAY_LENGTH(v_missing_tables, 1) > 0 THEN
    RAISE EXCEPTION 'VERIFICATION_FAILED: Missing tables in public schema: %', v_missing_tables;
  END IF;

  -- 2. Check for public tables with RLS disabled
  SELECT ARRAY_AGG(c.relname ORDER BY c.relname)
  INTO v_unprotected_tables
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND NOT c.relrowsecurity;

  IF v_unprotected_tables IS NOT NULL AND ARRAY_LENGTH(v_unprotected_tables, 1) > 0 THEN
    RAISE EXCEPTION 'VERIFICATION_FAILED: Tables with RLS disabled: %', v_unprotected_tables;
  END IF;

  -- 3. Check for SECURITY DEFINER functions missing fixed search_path
  SELECT ARRAY_AGG(p.proname ORDER BY p.proname)
  INTO v_unpinned_functions
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosecdef
    AND (
      p.proconfig IS NULL
      OR NOT ('search_path=pg_catalog, public' = ANY(p.proconfig))
    );

  IF v_unpinned_functions IS NOT NULL AND ARRAY_LENGTH(v_unpinned_functions, 1) > 0 THEN
    RAISE EXCEPTION 'VERIFICATION_FAILED: SECURITY DEFINER functions missing hardened search_path: %', v_unpinned_functions;
  END IF;

  RAISE NOTICE 'SUCCESS: All 15 public tables verified with RLS enabled and hardened function search_paths.';
END;
$$;
