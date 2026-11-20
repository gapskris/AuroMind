/**
 * AuroMind Edge Function: owner-metrics
 * Aggregates sanctuary intelligence metrics for the Owner Analytics Dashboard.
 * Strictly verifies owner authorization before returning metrics.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import {
  handleOwnerMetricsRequest,
  aggregateTelemetryMetrics,
  corsHeaders,
  LAUNCH_GAMES
} from './metrics-handler.js';

export {
  handleOwnerMetricsRequest,
  aggregateTelemetryMetrics,
  corsHeaders,
  LAUNCH_GAMES
};

serve(async (req: Request) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization') || '';

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } }
  });
  const adminClient = createClient(supabaseUrl, supabaseServiceKey);

  return handleOwnerMetricsRequest(req, {
    userClient,
    adminClient
  });
});
