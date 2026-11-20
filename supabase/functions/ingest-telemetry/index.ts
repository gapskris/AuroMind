/**
 * AuroMind Edge Function: ingest-telemetry
 * Validates, deduplicates, and ingests telemetry event batches
 * with server-side rate limiting and abuse protection (FIND-02).
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import {
  handleTelemetryIngestRequest,
  MAX_TELEMETRY_BODY_BYTES,
  MAX_EVENTS_PER_BATCH,
  DEFAULT_RATE_LIMIT_MAX,
  DEFAULT_RATE_LIMIT_WINDOW_SECONDS,
  corsHeaders,
  VALID_CATEGORIES
} from './telemetry-handler.js';

export {
  handleTelemetryIngestRequest,
  MAX_TELEMETRY_BODY_BYTES,
  MAX_EVENTS_PER_BATCH,
  DEFAULT_RATE_LIMIT_MAX,
  DEFAULT_RATE_LIMIT_WINDOW_SECONDS,
  corsHeaders,
  VALID_CATEGORIES
};

serve(async (req: Request) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  return handleTelemetryIngestRequest(req, {
    supabaseClient: supabase
  });
});
