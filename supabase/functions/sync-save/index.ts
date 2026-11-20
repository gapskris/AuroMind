/**
 * AuroMind Edge Function: sync-save
 * Handles authenticated, optimistic-concurrency game save synchronization
 * with upfront request-size protection (FIND-03).
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { handleSyncSaveRequest, MAX_SYNC_SAVE_BODY_BYTES, corsHeaders } from './sync-save-handler.js';

export { handleSyncSaveRequest, MAX_SYNC_SAVE_BODY_BYTES, corsHeaders };

serve(async (req: Request) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

  return handleSyncSaveRequest(req, {
    createSupabaseClient: (authHeader: string) =>
      createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } }
      })
  });
});
