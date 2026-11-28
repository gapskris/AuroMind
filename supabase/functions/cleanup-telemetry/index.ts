/**
 * AuroMind Edge Function: cleanup-telemetry
 * Server-authoritative 60-day telemetry retention cleanup and summary rollup.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { handleCleanupTelemetryRequest, corsHeaders } from './retention-handler.js';

export { handleCleanupTelemetryRequest, corsHeaders };

serve(async (req: Request) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  return handleCleanupTelemetryRequest(req, {
    supabaseClient: supabase
  });
});
