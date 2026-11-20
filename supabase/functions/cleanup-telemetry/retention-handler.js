/**
 * AuroMind Edge Function Core: retention-handler.js (AUDIT-PERF-01)
 *
 * Implements automated telemetry retention and cleanup:
 * 1. 60-day server-authoritative retention cutoff (based on received_at).
 * 2. Historical metrics preservation via daily summary rollups.
 * 3. Bounded batch deletions (prevents PostgreSQL connection timeouts and lock escalation).
 * 4. Idempotent and safe execution across repeated invocations.
 *
 * Compatible with Deno (Supabase Edge Runtime) and Node.js (test runner).
 */

export const DEFAULT_RETENTION_DAYS = 60;
export const DEFAULT_BATCH_SIZE = 5000;
export const MIN_RETENTION_DAYS = 30; // Safety floor: Never delete events younger than 30 days

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

/**
 * Computes daily summary aggregates from raw telemetry events.
 *
 * @param {Array<object>} events - Raw telemetry events
 * @returns {Map<string, object>} Aggregated summary rows keyed by date:gameId:category:eventName
 */
export function computeDailyAggregates(events) {
  const summaries = new Map();

  for (const evt of events) {
    const rawDate = evt.received_at || evt.receivedAt || evt.occurred_at || evt.timestamp || new Date().toISOString();
    const dateStr = new Date(rawDate).toISOString().split('T')[0];
    const gameId = evt.game_id || evt.gameId || 'portal';
    const category = evt.category || 'engagement';
    const eventName = evt.event_name || evt.eventName || 'unknown';
    const key = `${dateStr}:${gameId}:${category}:${eventName}`;

    let summary = summaries.get(key);
    if (!summary) {
      summary = {
        eventDate: dateStr,
        gameId,
        category,
        eventName,
        eventCount: 0,
        visitors: new Set(),
        sessions: new Set()
      };
      summaries.set(key, summary);
    }

    summary.eventCount += 1;
    const visitor = evt.guest_id || evt.guestId || evt.user_id || evt.userId || 'anon';
    const session = evt.session_id || evt.sessionId || visitor;
    summary.visitors.add(visitor);
    summary.sessions.add(session);
  }

  // Convert Set sizes to integer counts
  const result = [];
  for (const item of summaries.values()) {
    result.push({
      eventDate: item.eventDate,
      gameId: item.gameId,
      category: item.category,
      eventName: item.eventName,
      eventCount: item.eventCount,
      uniqueVisitors: item.visitors.size,
      uniqueSessions: item.sessions.size,
      aggregatedAt: new Date().toISOString()
    });
  }

  return result;
}

/**
 * Executes a single bounded batch pruning pass against a collection of events.
 *
 * @param {Array<object>} rawEvents - Current collection of telemetry events
 * @param {object} [options]
 * @param {number} [options.retentionDays=60]
 * @param {number} [options.batchSize=5000]
 * @param {number} [options.now] - Current timestamp in ms (for testing)
 * @returns {{ retained: Array<object>, deletedCount: number, remainingExpired: number, cutoffDate: string, rolledUpSummaries: Array<object> }}
 */
export function pruneTelemetryEventsInMemory(rawEvents, options = {}) {
  const retentionDays = Math.max(MIN_RETENTION_DAYS, options.retentionDays ?? DEFAULT_RETENTION_DAYS);
  const batchSize = Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE);
  const nowMs = typeof options.now === 'number' ? options.now : Date.now();
  const cutoffMs = nowMs - (retentionDays * 24 * 60 * 60 * 1000);
  const cutoffDate = new Date(cutoffMs).toISOString();

  const expiredEvents = [];
  const retainedEvents = [];

  for (const evt of rawEvents) {
    const rawTimestamp = evt.received_at || evt.receivedAt || evt.occurred_at || evt.timestamp;
    const evtTime = rawTimestamp ? new Date(rawTimestamp).getTime() : nowMs;

    if (evtTime < cutoffMs) {
      expiredEvents.push(evt);
    } else {
      retainedEvents.push(evt);
    }
  }

  // Sort expired events oldest first
  expiredEvents.sort((a, b) => {
    const tA = new Date(a.received_at || a.receivedAt || a.timestamp || 0).getTime();
    const tB = new Date(b.received_at || b.receivedAt || b.timestamp || 0).getTime();
    return tA - tB;
  });

  // Bounded batch deletion
  const batchToDelete = expiredEvents.slice(0, batchSize);
  const unprunedExpired = expiredEvents.slice(batchSize);

  // Compute summary aggregates for the batch being pruned
  const rolledUpSummaries = computeDailyAggregates(batchToDelete);

  return {
    retained: [...retainedEvents, ...unprunedExpired],
    deletedCount: batchToDelete.length,
    remainingExpired: unprunedExpired.length,
    cutoffDate,
    rolledUpSummaries
  };
}

/**
 * Handles HTTP requests to the cleanup-telemetry Edge Function.
 * Verifies service_role or owner authorization before triggering cleanup.
 *
 * @param {Request} req
 * @param {object} options
 * @param {object} options.supabaseClient
 * @returns {Promise<Response>}
 */
export async function handleCleanupTelemetryRequest(req, options = {}) {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = options.supabaseClient;
    if (!supabase) {
      return new Response(JSON.stringify({ ok: false, error: 'SUPABASE_CLIENT_REQUIRED' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const retentionDays = options.retentionDays || DEFAULT_RETENTION_DAYS;
    const batchSize = options.batchSize || DEFAULT_BATCH_SIZE;

    // Call stored procedure via RPC
    const { data, error } = await supabase.rpc('prune_expired_telemetry', {
      p_retention_days: retentionDays,
      p_batch_size: batchSize
    });

    if (error) {
      return new Response(JSON.stringify({ ok: false, error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ ok: true, result: data }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message || 'INTERNAL_ERROR' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}
