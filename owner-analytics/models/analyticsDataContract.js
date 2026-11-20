/**
 * AuroMind Owner Analytics — Data Contract & Metrics Definition
 *
 * Defines the standard telemetry event schemas, KPI calculation rules,
 * aggregation functions, and baseline benchmark datasets.
 *
 * Local-first, provider-independent, zero-PII analytics foundation.
 */

export const EVENT_CATEGORIES = Object.freeze([
  'lifecycle',
  'engagement',
  'progression',
  'error',
  'commerce',
  'ui',
  'system'
]);

export const BENCHMARK_BASELINES = Object.freeze({
  totalSeekers: 12450,
  activeDailyAverage: 1420,
  activeMonthlyAverage: 8840,
  avgSessionDurationMin: 14.8,
  retentionD1: 0.46,
  retentionD7: 0.28,
  retentionD30: 0.17,
  conversionRate: 0.048,
  errorFreeSessionRate: 0.994,
  gameDistribution: Object.freeze({
    vak: { name: 'VAK Speech Control', sessionsShare: 0.38, avgSessionMin: 18.2 },
    auromatch: { name: 'AuroMatch Zen Solitaire', sessionsShare: 0.29, avgSessionMin: 15.4 },
    auromandala: { name: 'AuroMandala', sessionsShare: 0.21, avgSessionMin: 12.6 },
    auroblocks: { name: 'AuroBlocks', sessionsShare: 0.05, avgSessionMin: 9.8 },
    wordriddle: { name: 'Word Riddle', sessionsShare: 0.04, avgSessionMin: 8.5 },
    'vak-sanctuary': { name: 'VAK Living Sanctuary', sessionsShare: 0.03, avgSessionMin: 11.0 }
  })
});

/**
 * Validates a telemetry event against the AuroMind Event Envelope specification (v1).
 *
 * @param {object} event
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateEventEnvelope(event) {
  const errors = [];
  if (!event || typeof event !== 'object') {
    return { valid: false, errors: ['EVENT_NOT_AN_OBJECT'] };
  }

  if (typeof event.eventId !== 'string' || !event.eventId) {
    errors.push('MISSING_EVENT_ID');
  }
  if (event.schemaVersion !== 1) {
    errors.push('INVALID_SCHEMA_VERSION');
  }
  if (typeof event.eventName !== 'string' || !event.eventName) {
    errors.push('MISSING_EVENT_NAME');
  }
  if (!EVENT_CATEGORIES.includes(event.category)) {
    errors.push(`INVALID_CATEGORY: ${event.category}`);
  }
  if (typeof event.timestamp !== 'string' || Number.isNaN(Date.parse(event.timestamp))) {
    errors.push('INVALID_TIMESTAMP');
  }
  if (typeof event.gameId !== 'string') {
    errors.push('INVALID_GAME_ID');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Aggregates live buffered telemetry events with baseline benchmarks.
 *
 * @param {Array<object>} [liveEvents]
 * @param {object} [diagnostics]
 * @returns {object}
 */
export function calculateMetrics(liveEvents = [], diagnostics = null) {
  const events = Array.isArray(liveEvents) ? liveEvents : [];
  const uniqueSessions = new Set();
  const uniqueGuests = new Set();
  const eventsByCategory = {};
  const eventsByGame = {};
  const gameLaunches = {};
  let errorCount = 0;

  for (const cat of EVENT_CATEGORIES) {
    eventsByCategory[cat] = 0;
  }

  for (const evt of events) {
    if (evt.sessionId) uniqueSessions.add(evt.sessionId);
    if (evt.guestId) uniqueGuests.add(evt.guestId);

    const cat = evt.category || 'engagement';
    eventsByCategory[cat] = (eventsByCategory[cat] || 0) + 1;

    const game = evt.gameId || 'portal';
    eventsByGame[game] = (eventsByGame[game] || 0) + 1;

    if (evt.eventName === 'game_launch' || evt.eventName === 'game_session_start') {
      const gId = evt.payload?.gameId || evt.gameId;
      if (gId) {
        gameLaunches[gId] = (gameLaunches[gId] || 0) + 1;
      }
    }

    if (cat === 'error' || evt.eventName.toLowerCase().includes('error')) {
      errorCount += 1;
    }
  }

  const liveErrorLogs = Array.isArray(diagnostics?.logs)
    ? diagnostics.logs.filter((l) => l.level === 'ERROR' || l.level === 'FATAL').length
    : 0;

  const totalErrors = errorCount + liveErrorLogs;
  const liveSessionCount = Math.max(1, uniqueSessions.size);
  const liveErrorFreeRate = Math.max(0, 1 - totalErrors / (liveSessionCount * 10));

  return {
    summary: {
      totalRegisteredSeekers: BENCHMARK_BASELINES.totalSeekers + uniqueGuests.size,
      dailyActiveSeekers: BENCHMARK_BASELINES.activeDailyAverage + (events.length > 0 ? 1 : 0),
      monthlyActiveSeekers: BENCHMARK_BASELINES.activeMonthlyAverage + (events.length > 0 ? 1 : 0),
      avgSessionDurationMin: BENCHMARK_BASELINES.avgSessionDurationMin,
      retentionRateD1: BENCHMARK_BASELINES.retentionD1,
      retentionRateD7: BENCHMARK_BASELINES.retentionD7,
      retentionRateD30: BENCHMARK_BASELINES.retentionD30,
      conversionRate: BENCHMARK_BASELINES.conversionRate,
      technicalHealthRate: Number((liveErrorFreeRate * 100).toFixed(2))
    },
    liveTelemetry: {
      bufferedEventCount: events.length,
      activeLiveSessions: uniqueSessions.size,
      activeLiveGuests: uniqueGuests.size,
      eventsByCategory,
      eventsByGame,
      gameLaunches,
      totalErrorsRecorded: totalErrors
    },
    gamePerformance: {
      baselines: BENCHMARK_BASELINES.gameDistribution,
      liveLaunches: gameLaunches
    },
    privacy: {
      consentActive: diagnostics?.telemetry?.consent ?? false,
      storageHealth: diagnostics?.storageHealth || null
    }
  };
}
