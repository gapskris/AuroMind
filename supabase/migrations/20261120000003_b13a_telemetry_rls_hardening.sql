-- ==============================================================================
-- AuroMind Production Hardening Migration: B13A Telemetry RLS Hardening
-- Finding: AUDIT-SEC-01 (Direct telemetry table insertion bypassing Edge Function controls)
--
-- RATIONALE:
-- Previously, public.telemetry_events had an open RLS INSERT policy ("telemetry_insert_any")
-- allowing direct insertion via PostgREST by any client with the anon key. This allowed
-- an attacker to bypass Edge Function abuse protection, specifically:
--   1. Rate limiting (FIND-02 / check_telemetry_rate_limit)
--   2. Bounded body size checks (MAX_TELEMETRY_BODY_BYTES = 64 KiB)
--   3. Batch size limits (MAX_EVENTS_PER_BATCH = 50)
--   4. Client IP hashing and privacy redaction
--
-- REMEDIATION:
-- 1. Drop "telemetry_insert_any" policy.
-- 2. Revoke table-level INSERT permissions from 'anon', 'authenticated', and 'public' roles.
-- 3. Grant table-level INSERT permissions strictly to 'service_role'.
-- All client telemetry must flow through the 'ingest-telemetry' Edge Function.
-- Direct PostgREST inserts by seekers or anonymous clients are strictly denied.
-- ==============================================================================

-- 1. Drop the legacy open insert policy
drop policy if exists "telemetry_insert_any" on public.telemetry_events;

-- 2. Revoke INSERT privilege on public.telemetry_events from public and seeker roles
revoke insert on table public.telemetry_events from anon, authenticated, public;

-- 3. Ensure service_role has explicit INSERT and SELECT privileges for Edge Functions
grant select, insert on table public.telemetry_events to service_role;

-- 4. Owner-only SELECT policy remains active (telemetry_select_owner_only)
-- Read access is strictly reserved for authenticated users with 'owner' role in public.owner_roles.
