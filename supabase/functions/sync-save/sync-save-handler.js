/**
 * AuroMind Edge Function Core: sync-save-handler.js
 *
 * Implements bounded request-size protection (FIND-03), upfront Content-Length
 * validation, streaming body limits, JSON parsing guards, authentication verification,
 * and optimistic concurrency save RPC delegation.
 *
 * Designed using Web Standard APIs (Request, Response, ReadableStream, TextDecoder)
 * compatible with both Deno (Supabase Edge Runtime) and Node.js (test runner).
 */

export const MAX_SYNC_SAVE_BODY_BYTES = 512 * 1024; // 524,288 bytes (512 KiB)

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

/**
 * Safely reads a request body up to maxBytes without unbounded buffering.
 * Cancels and releases the stream immediately if total read bytes exceed maxBytes.
 *
 * @param {Request} req
 * @param {number} maxBytes
 * @returns {Promise<{ ok: true, text: string, bytesRead: number } | { ok: false, error: 'PAYLOAD_TOO_LARGE', bytesRead: number }>}
 */
export async function readBoundedBody(req, maxBytes = MAX_SYNC_SAVE_BODY_BYTES) {
  // 1. Upfront Content-Length header validation
  const clHeader = req.headers.get('content-length');
  if (clHeader !== null) {
    const declaredLength = parseInt(clHeader, 10);
    if (!Number.isNaN(declaredLength) && declaredLength > maxBytes) {
      if (req.body && typeof req.body.cancel === 'function') {
        try {
          await req.body.cancel();
        } catch {
          // Stream cancel errors safely swallowed
        }
      }
      return { ok: false, error: 'PAYLOAD_TOO_LARGE', bytesRead: declaredLength };
    }
  }

  // 2. If no request body is attached
  if (!req.body) {
    if (typeof req.text === 'function') {
      try {
        const text = await req.text();
        const byteLength = new TextEncoder().encode(text).byteLength;
        if (byteLength > maxBytes) {
          return { ok: false, error: 'PAYLOAD_TOO_LARGE', bytesRead: byteLength };
        }
        return { ok: true, text, bytesRead: byteLength };
      } catch {
        return { ok: true, text: '', bytesRead: 0 };
      }
    }
    return { ok: true, text: '', bytesRead: 0 };
  }

  // 3. Streaming bounded reader (prevents unbounded memory consumption)
  const reader = req.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  let exceeded = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          exceeded = true;
          try {
            await reader.cancel('payload_too_large');
          } catch {
            // Cancel safely swallowed
          }
          break;
        }
        chunks.push(value);
      }
    }
  } catch (err) {
    if (exceeded || totalBytes > maxBytes) {
      return { ok: false, error: 'PAYLOAD_TOO_LARGE', bytesRead: totalBytes };
    }
    throw err;
  }

  if (exceeded) {
    return { ok: false, error: 'PAYLOAD_TOO_LARGE', bytesRead: totalBytes };
  }

  // Concatenate chunks and decode as UTF-8
  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder('utf-8').decode(combined);
  return { ok: true, text, bytesRead: totalBytes };
}

/**
 * Handles incoming sync-save HTTP requests.
 *
 * @param {Request} req
 * @param {object} options
 * @param {function} [options.createSupabaseClient]
 * @param {object} [options.supabaseClient]
 * @returns {Promise<Response>}
 */
export async function handleSyncSaveRequest(req, options = {}) {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 1. Upfront declared Content-Length check (fast reject before auth/body processing)
    const clHeader = req.headers.get('content-length');
    if (clHeader !== null) {
      const declaredLength = parseInt(clHeader, 10);
      if (!Number.isNaN(declaredLength) && declaredLength > MAX_SYNC_SAVE_BODY_BYTES) {
        if (req.body && typeof req.body.cancel === 'function') {
          try {
            await req.body.cancel();
          } catch {
            // Stream cancel safely swallowed
          }
        }
        return new Response(JSON.stringify({
          ok: false,
          error: 'PAYLOAD_TOO_LARGE',
          message: `Request body exceeds maximum allowed size of 512 KiB (${MAX_SYNC_SAVE_BODY_BYTES} bytes)`
        }), {
          status: 413,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // 2. Authorization Header Check
    const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ ok: false, error: 'UNAUTHORIZED' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 3. Supabase Auth Verification
    const supabase = options.createSupabaseClient
      ? options.createSupabaseClient(authHeader)
      : options.supabaseClient;

    if (!supabase) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'INTERNAL_ERROR',
        message: 'Backend client unavailable'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { data: userData, error: userError } = await supabase.auth.getUser();
    const user = userData?.user;
    if (userError || !user) {
      return new Response(JSON.stringify({ ok: false, error: 'INVALID_TOKEN' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 4. Bounded Request-Body Reading (Guards against deceptive/missing/malformed Content-Length)
    const bounded = await readBoundedBody(req, MAX_SYNC_SAVE_BODY_BYTES);
    if (!bounded.ok) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'PAYLOAD_TOO_LARGE',
        message: `Request body exceeds maximum allowed size of 512 KiB (${MAX_SYNC_SAVE_BODY_BYTES} bytes)`
      }), {
        status: 413,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 5. JSON Parsing Guard (Ensures oversized body was never passed to JSON.parse)
    let body;
    try {
      body = JSON.parse(bounded.text);
    } catch {
      return new Response(JSON.stringify({
        ok: false,
        error: 'INVALID_JSON',
        message: 'Request body must be valid JSON'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 6. Request Body Structure Validation
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return new Response(JSON.stringify({ ok: false, error: 'INVALID_REQUEST_BODY' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const {
      gameId,
      envelopeVersion = 1,
      gameSchemaVersion = 1,
      expectedRevision = 0,
      sourceGuestId,
      checksum,
      payload,
      clientUpdatedAt
    } = body;

    const ALLOWED_GAME_IDS = new Set([
      'vak',
      'auromatch',
      'auromandala',
      'word-riddle',
      'vak-living-sanctuary',
      'auroblocks'
    ]);

    if (
      typeof gameId !== 'string' ||
      !ALLOWED_GAME_IDS.has(gameId) ||
      typeof checksum !== 'string' ||
      checksum.trim().length === 0 ||
      !payload ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      !Number.isInteger(envelopeVersion) ||
      envelopeVersion < 1 ||
      !Number.isInteger(gameSchemaVersion) ||
      gameSchemaVersion < 1 ||
      !Number.isInteger(expectedRevision) ||
      expectedRevision < 0
    ) {
      return new Response(JSON.stringify({ ok: false, error: 'INVALID_REQUEST_BODY' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Privacy boundary: reject any Sankalpa vault keys or markers before RPC execution
    const serializedPayload = JSON.stringify(payload);
    if (
      /("[^"]*sankalpa[^"]*"\s*:|sankalpa_e2ee_vault|auromasti-sankalpa-backup|auromind_sankalpa_vault|sankalpa_reflections)/i.test(
        serializedPayload
      )
    ) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'PRIVACY_BOUNDARY_VIOLATION',
        message: 'Sankalpa vault data is strictly excluded from cloud sync.'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 7. Atomic Concurrency Save RPC Execution
    const { data: rpcRes, error: rpcError } = await supabase.rpc('upsert_game_save_checked', {
      p_game_id: gameId,
      p_envelope_version: envelopeVersion,
      p_game_schema_version: gameSchemaVersion,
      p_expected_revision: expectedRevision,
      p_source_guest_id: sourceGuestId || null,
      p_checksum: checksum.trim(),
      p_payload: payload,
      p_client_updated_at: clientUpdatedAt || new Date().toISOString()
    });

    if (rpcError) {
      return new Response(JSON.stringify({ ok: false, error: rpcError.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const httpStatus = rpcRes?.status === 'conflict'
      ? 409
      : (rpcRes?.status === 'rejected' ? 400 : 200);

    return new Response(JSON.stringify(rpcRes), {
      status: httpStatus,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message || 'INTERNAL_ERROR' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}
