/**
 * AuroMind Shared Platform SDK — Firebase Telemetry Transport Adapter
 *
 * Dispatches buffered platform telemetry events to a trusted server-side
 * Cloud Function (`ingestTelemetry`).
 *
 * Invariants:
 * 1. Clients never write unrestricted telemetry directly into Firestore.
 * 2. Sensitive keys ('sankalpa', 'password', 'token', 'secret') are strictly redacted.
 * 3. Events deduplicated by UUIDv4 `eventId`.
 * 4. Bounded batch size (maximum 50 events).
 */

const SENSITIVE_KEY_PATTERN = /sankalpa|password|token|secret|credential/i;

export function createFirebaseTelemetryTransport(client) {
  function isConfigured() {
    return Boolean(client && client.isConfigured());
  }

  function sanitizePayload(payload) {
    if (!payload || typeof payload !== 'object') return {};
    const sanitized = {};
    for (const [k, v] of Object.entries(payload)) {
      if (SENSITIVE_KEY_PATTERN.test(k)) {
        sanitized[k] = '[REDACTED]';
      } else if (v && typeof v === 'object' && !Array.isArray(v)) {
        sanitized[k] = sanitizePayload(v);
      } else {
        sanitized[k] = v;
      }
    }
    return sanitized;
  }

  async function sendEvents(events) {
    if (!isConfigured() || !Array.isArray(events) || events.length === 0) {
      return Object.freeze({ ok: false, sentCount: 0 });
    }

    try {
      // 1. Deduplicate events by eventId
      const seen = new Set();
      const uniqueEvents = [];
      for (const evt of events) {
        const id = evt.eventId || evt.event_id;
        if (id && !seen.has(id)) {
          seen.add(id);
          uniqueEvents.push(evt);
        } else if (!id) {
          uniqueEvents.push(evt);
        }
      }

      if (uniqueEvents.length === 0) {
        return Object.freeze({ ok: true, sentCount: 0 });
      }

      // Enforce batch ceiling
      const batchToSend = uniqueEvents.slice(0, 50);

      // 2. Prepare sanitized event envelope
      const rows = batchToSend.map((evt) => ({
        eventId: evt.eventId || evt.event_id,
        userId: evt.userId || client.auth.getUser()?.id || null,
        guestId: evt.guestId || null,
        sessionId: evt.sessionId || null,
        gameId: evt.gameId || 'portal',
        eventName: evt.eventName || evt.event_name,
        category: evt.category || 'engagement',
        schemaVersion: evt.schemaVersion || 1,
        payload: sanitizePayload(evt.payload),
        appVersion: evt.appVersion || null,
        timestamp: evt.timestamp || new Date().toISOString()
      }));

      // 3. Dispatch to trusted Cloud Function endpoint
      const res = await client.functions.call('ingestTelemetry', { events: rows });

      if (res && res.ok) {
        return Object.freeze({ ok: true, sentCount: rows.length });
      }

      // If Cloud Functions endpoint returned an error or is unconfigured, return error status
      return Object.freeze({
        ok: false,
        sentCount: 0,
        error: res?.error || 'TELEMETRY_DISPATCH_FAILED'
      });
    } catch (err) {
      return Object.freeze({ ok: false, sentCount: 0, error: err.message });
    }
  }

  return Object.freeze({
    providerName: 'firebase-telemetry-transport',
    isConfigured,
    sendEvents
  });
}
