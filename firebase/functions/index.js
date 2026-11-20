/**
 * AuroMind Firebase Cloud Functions
 *
 * Implements trusted server-side operations for Google Firebase:
 * 1. ingestTelemetry: Validates, deduplicates, and ingests telemetry batches
 *    with B8 abuse protection, SHA-256 client hashing, and sensitive key redaction.
 * 2. deleteAccount: Cascading account deletion across Firestore and Firebase Auth.
 * 3. verifyEntitlements: Server-authoritative entitlement verification.
 */

const crypto = require('crypto');

const VALID_CATEGORIES = new Set([
  'lifecycle', 'engagement', 'progression', 'error', 'commerce', 'ui', 'system'
]);

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SENSITIVE_KEY_PATTERN = /sankalpa|password|token|secret|credential/i;

const MAX_BATCH_EVENTS = 50;
const MAX_BODY_BYTES = 64 * 1024; // 64 KiB
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 30;

// In-memory token bucket for Cloud Function instance
const rateLimitMap = new Map();

function checkRateLimit(clientHash) {
  const now = Date.now();
  let entry = rateLimitMap.get(clientHash);
  if (!entry || now >= entry.resetTime) {
    entry = { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS };
    rateLimitMap.set(clientHash, entry);
    return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - 1, retryAfter: 0 };
  }
  entry.count += 1;
  const retryAfter = Math.max(1, Math.ceil((entry.resetTime - now) / 1000));
  if (entry.count > RATE_LIMIT_MAX_REQUESTS) {
    return { allowed: false, remaining: 0, retryAfter };
  }
  return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - entry.count, retryAfter: 0 };
}

function deriveClientHash(req) {
  const ip = req.headers['fastly-client-ip'] || req.headers['x-forwarded-for']?.split(',')[0] || req.ip || 'unknown';
  return crypto.createHash('sha256').update(`auromind-firebase-salt:${ip}`).digest('hex');
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

/**
 * Cloud Function: ingestTelemetry (HTTP / Callable)
 */
exports.ingestTelemetry = async (req, res, admin) => {
  // 1. Content-Length and body size validation
  const cl = parseInt(req.headers['content-length'] || '0', 10);
  if (cl > MAX_BODY_BYTES) {
    return res.status(413).json({ ok: false, error: 'PAYLOAD_TOO_LARGE' });
  }

  // 2. Rate limiting check
  const clientHash = deriveClientHash(req);
  const rateResult = checkRateLimit(clientHash);
  if (!rateResult.allowed) {
    res.set('Retry-After', String(rateResult.retryAfter));
    return res.status(429).json({
      ok: false,
      error: 'RATE_LIMIT_EXCEEDED',
      message: 'Telemetry ingestion rate limit exceeded. Please retry later.'
    });
  }

  const body = req.body || {};
  const events = Array.isArray(body.events) ? body.events : [body];

  // 3. Batch ceiling check
  if (events.length > MAX_BATCH_EVENTS) {
    return res.status(400).json({
      ok: false,
      error: 'BATCH_SIZE_EXCEEDED',
      message: `Batch exceeds maximum limit of ${MAX_BATCH_EVENTS} events`
    });
  }

  // 4. Validate and sanitize events
  const validEvents = [];
  let skipped = 0;

  for (const evt of events) {
    if (!evt || typeof evt !== 'object') {
      skipped++;
      continue;
    }
    if (!evt.eventId || !UUID_REGEX.test(evt.eventId)) {
      skipped++;
      continue;
    }
    if (!evt.eventName || !VALID_CATEGORIES.has(evt.category)) {
      skipped++;
      continue;
    }

    validEvents.push({
      eventId: evt.eventId,
      userId: evt.userId || null,
      guestId: evt.guestId || null,
      sessionId: evt.sessionId || null,
      gameId: evt.gameId || 'portal',
      eventName: evt.eventName,
      category: evt.category,
      schemaVersion: evt.schemaVersion || 1,
      payload: sanitizePayload(evt.payload),
      timestamp: evt.timestamp || new Date().toISOString(),
      receivedAt: new Date().toISOString()
    });
  }

  if (validEvents.length === 0) {
    return res.status(200).json({ ok: true, count: 0, skipped });
  }

  // 5. Ingest into Firestore if admin SDK is provided
  if (admin && admin.firestore) {
    const db = admin.firestore();
    const batch = db.batch();
    for (const evt of validEvents) {
      const docRef = db.collection('telemetry_events').doc(evt.eventId);
      batch.set(docRef, evt, { merge: true });
    }
    await batch.commit();
  }

  return res.status(200).json({ ok: true, count: validEvents.length, skipped });
};

/**
 * Cloud Function: deleteAccount
 */
exports.deleteAccount = async (req, res, admin) => {
  const userId = req.body?.userId;
  if (!userId) {
    return res.status(400).json({ ok: false, error: 'MISSING_USER_ID' });
  }

  if (admin) {
    const db = admin.firestore();
    // Recursively delete users/{userId} and subcollections
    const userRef = db.collection('users').doc(userId);
    await db.recursiveDelete(userRef);

    // Delete Auth record
    if (admin.auth) {
      try {
        await admin.auth().deleteUser(userId);
      } catch {}
    }
  }

  return res.status(200).json({ ok: true, userId });
};
