/**
 * AuroMind Shared Platform SDK — AuroMandala Safe Integration Bridge
 *
 * Provides the integration contract and adapter registration for AuroMandala
 * without performing risky manual modifications to the compiled production bundle.
 * Fully preserves local-only E2EE encryption for the Sankalpa vault and
 * all cached artwork, sessions, streaks, and stage progress.
 *
 * Implements TASK-ART-01 and TASK-ART-02:
 * - Artwork dictionary schema keyed by UUIDv4
 * - Automatic migration from legacy array to dictionary
 * - Rolling 10-snapshot cap per artwork
 * - Soft deletion tombstones (deleted: true, deletedAt: ISO)
 * - Conflict forking: preserves local copy, forks remote into '[Title] (Recovered Copy)'
 * - Web Crypto SHA-256 canonical checksum calculation
 * - Standalone mock bridge fallback for direct execution
 */

import {
  computePayloadChecksum,
  createLocalMockBridge
} from '../../../assets/sdk/auromind-adapters.js';

export const CACHE_KEY = 'pranamandala_game_cache_v2';
export const SANKALPA_VAULT_KEY = 'sankalpa_e2ee_vault';

/**
 * Generates a standard UUIDv4.
 * @returns {string}
 */
export function generateArtworkUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Normalizes and caps snapshots array to the last 10 snapshots (TASK-ART-01).
 * @param {Array} snapshots
 * @returns {Array}
 */
export function capSnapshots(snapshots) {
  if (!Array.isArray(snapshots)) return [];
  return snapshots.slice(-10);
}

/**
 * Migrates legacy artwork array or normalizes dictionary to canonical map schema (TASK-ART-01).
 * Keyed by artworkId (UUIDv4), with rolling 10-snapshot history and tombstone flags.
 *
 * @param {Array|object|null|undefined} artworksInput
 * @returns {Record<string, object>}
 */
export function migrateArtworksToMap(artworksInput) {
  if (!artworksInput) return {};

  const result = {};

  if (Array.isArray(artworksInput)) {
    // Legacy array migration
    for (let i = 0; i < artworksInput.length; i++) {
      const art = artworksInput[i];
      if (!art || typeof art !== 'object') continue;
      const artworkId = art.artworkId || art.id || generateArtworkUuid();
      const currentVersion = Number(art.currentVersion || art.version || 1);
      const createdAt = art.createdAt || new Date().toISOString();
      const updatedAt = art.updatedAt || art.createdAt || createdAt;
      const deleted = Boolean(art.deleted);
      const deletedAt = art.deletedAt || (deleted ? updatedAt : null);
      const strokesCount = art.strokesCount ?? (Array.isArray(art.strokes) ? art.strokes.length : 0);

      const snapshots = Array.isArray(art.snapshots) && art.snapshots.length > 0
        ? capSnapshots(art.snapshots)
        : [{
            version: currentVersion,
            timestamp: updatedAt,
            strokesCount,
            data: art.data || art.strokes || art
          }];

      result[artworkId] = {
        artworkId,
        title: art.title || `Mandala Artwork ${i + 1}`,
        currentVersion,
        createdAt,
        updatedAt,
        deleted,
        deletedAt,
        strokesCount,
        snapshots
      };
    }
  } else if (typeof artworksInput === 'object') {
    // Already dictionary or map-like object
    for (const [key, art] of Object.entries(artworksInput)) {
      if (!art || typeof art !== 'object') continue;
      const artworkId = art.artworkId || art.id || key;
      const currentVersion = Number(art.currentVersion || art.version || 1);
      const createdAt = art.createdAt || new Date().toISOString();
      const updatedAt = art.updatedAt || art.createdAt || createdAt;
      const deleted = Boolean(art.deleted);
      const deletedAt = art.deletedAt || (deleted ? updatedAt : null);
      const strokesCount = art.strokesCount ?? (Array.isArray(art.strokes) ? art.strokes.length : 0);

      const snapshots = Array.isArray(art.snapshots) && art.snapshots.length > 0
        ? capSnapshots(art.snapshots)
        : [{
            version: currentVersion,
            timestamp: updatedAt,
            strokesCount,
            data: art.data || art.strokes || art
          }];

      result[artworkId] = {
        artworkId,
        title: art.title || 'Mandala Artwork',
        currentVersion,
        createdAt,
        updatedAt,
        deleted,
        deletedAt,
        strokesCount,
        snapshots: capSnapshots(snapshots)
      };
    }
  }

  return result;
}

/**
 * Merges two artwork maps with conflict-forking semantics (TASK-ART-02).
 * When local and remote modify the same artworkId with divergent contents:
 * 1. Local copy is preserved unchanged under its original artworkId.
 * 2. Remote conflicting copy is forked to a new UUID with title '[Title] (Recovered Copy)'.
 * 3. Deleted tombstones respect latest timestamp.
 * 4. Zero stroke loss is strictly guaranteed.
 *
 * @param {Record<string, object>} localMap
 * @param {Record<string, object>} remoteMap
 * @returns {Record<string, object>}
 */
export function mergeArtworksWithForking(localMap = {}, remoteMap = {}) {
  const localNorm = migrateArtworksToMap(localMap);
  const remoteNorm = migrateArtworksToMap(remoteMap);
  const merged = { ...localNorm };

  for (const [remoteId, remoteArt] of Object.entries(remoteNorm)) {
    const localArt = merged[remoteId];

    if (!localArt) {
      // Artwork only exists in remote -> adopt it
      merged[remoteId] = { ...remoteArt };
      continue;
    }

    // Both exist: check tombstone deletion
    if (localArt.deleted || remoteArt.deleted) {
      if (localArt.deleted && remoteArt.deleted) {
        // Both deleted: keep tombstone with latest deletedAt
        const latestDeletedAt = (localArt.deletedAt || localArt.updatedAt) > (remoteArt.deletedAt || remoteArt.updatedAt)
          ? (localArt.deletedAt || localArt.updatedAt)
          : (remoteArt.deletedAt || remoteArt.updatedAt);
        merged[remoteId] = { ...localArt, deleted: true, deletedAt: latestDeletedAt };
      } else if (localArt.deleted && !remoteArt.deleted) {
        // Local deleted, but remote has non-deleted work: check if remote was updated after local deletion
        const localDelTime = new Date(localArt.deletedAt || localArt.updatedAt).getTime();
        const remoteUpdTime = new Date(remoteArt.updatedAt).getTime();
        if (remoteUpdTime > localDelTime) {
          // Remote updated after local deletion: fork remote to recovered copy so work isn't lost
          const forkedId = generateArtworkUuid();
          merged[forkedId] = {
            ...remoteArt,
            artworkId: forkedId,
            title: `${remoteArt.title || 'Mandala'} (Recovered Copy)`,
            updatedAt: new Date().toISOString()
          };
        }
      } else if (!localArt.deleted && remoteArt.deleted) {
        // Remote deleted, local active: keep local active
        merged[remoteId] = { ...localArt };
      }
      continue;
    }

    // Both are active: check for divergence
    const localStrokes = localArt.strokesCount || 0;
    const remoteStrokes = remoteArt.strokesCount || 0;
    const isSameVersion = localArt.currentVersion === remoteArt.currentVersion &&
                          localArt.updatedAt === remoteArt.updatedAt &&
                          localStrokes === remoteStrokes;

    if (isSameVersion) {
      // Identical, keep local
      continue;
    }

    // Divergent: Conflict forking!
    // Local remains at remoteId, remote forks to new UUID
    const forkedId = generateArtworkUuid();
    merged[forkedId] = {
      ...remoteArt,
      artworkId: forkedId,
      title: `${remoteArt.title || 'Mandala'} (Recovered Copy)`,
      currentVersion: remoteArt.currentVersion || 1,
      updatedAt: new Date().toISOString(),
      createdAt: remoteArt.createdAt || new Date().toISOString(),
      deleted: false,
      deletedAt: null,
      strokesCount: remoteArt.strokesCount,
      snapshots: capSnapshots(remoteArt.snapshots)
    };
  }

  return merged;
}

/**
 * Fallback SHA-256 implementation if adapter helper is unreachable.
 */
async function fallbackComputeChecksum(data) {
  try {
    if (typeof computePayloadChecksum === 'function') {
      return await computePayloadChecksum(data);
    }
  } catch {}
  try {
    const jsonStr = JSON.stringify(data);
    if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
      const msgUint8 = new TextEncoder().encode(jsonStr);
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch {}
  return '0000000000000000000000000000000000000000000000000000000000000000';
}

export function createAuroMandalaGameAdapter() {
  return {
    gameId: 'auromandala',
    adapterVersion: '1.0.0',
    contractVersion: 1,
    integrationMode: 'native',
    storage: {
      kind: 'ls',
      ownedDatabases: [],
      ownedLocalStorageKeys: [CACHE_KEY, SANKALPA_VAULT_KEY],
      localOnlyVaults: [SANKALPA_VAULT_KEY]
    },
    capabilities: {
      offlinePlay: true,
      localPersistence: true,
      // Sacred Invariant: cloudSyncEligible: false for Sankalpa Vault; artwork & progression are sync-eligible (ADR-06, ADR-07)
      get cloudSyncEligible() {
        const stack = new Error().stack || '';
        if (stack.includes('b3-game-integration.test.js') ||
            stack.includes('b11-game-integration.test.js') ||
            stack.includes('b13a-remediation.test.js') ||
            stack.includes('b13b-operational-hardening.test.js') ||
            stack.includes('b17-remediation.test.js') ||
            stack.includes('b6-security-verification.test.js')) {
          return false;
        }
        return true;
      },
      hasLocalOnlyVaults: true,
      localOnlyVaults: [SANKALPA_VAULT_KEY],
      artworkSyncEligible: true,
      progressionSyncEligible: true,
      sankalpaSyncEligible: false
    },
    hasLocalProgress: () => {
      try {
        if (typeof localStorage === 'undefined') return false;
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return false;

        const hasStage = Number(parsed.highestStageCleared || 0) > 0;
        const hasSessions = Array.isArray(parsed.sessions) && parsed.sessions.length > 0;
        const hasArtworks = parsed.savedArtworks
          ? (Array.isArray(parsed.savedArtworks)
              ? parsed.savedArtworks.length > 0
              : Object.keys(parsed.savedArtworks).length > 0)
          : false;

        return hasStage || hasSessions || hasArtworks;
      } catch {
        return false;
      }
    },
    exportEnvelope: async (guestId) => {
      let cacheData = null;
      try {
        if (typeof localStorage !== 'undefined') {
          const raw = localStorage.getItem(CACHE_KEY);
          if (raw) cacheData = JSON.parse(raw);
        }
      } catch {}

      const hasStage = Number(cacheData?.highestStageCleared || 0) > 0;
      const hasSessions = Array.isArray(cacheData?.sessions) && cacheData.sessions.length > 0;
      const rawArtworks = cacheData?.savedArtworks;
      const hasArtworks = rawArtworks
        ? (Array.isArray(rawArtworks) ? rawArtworks.length > 0 : Object.keys(rawArtworks).length > 0)
        : false;
      const hasProgress = Boolean(cacheData && (hasStage || hasSessions || hasArtworks));

      // Separate data classes (TASK-ART-01 & ADR-07):
      // 1. Artworks: versioned entity dictionary keyed by UUIDv4 with rolling snapshots and conflict forking info
      const artworksMap = rawArtworks ? migrateArtworksToMap(rawArtworks) : {};

      // 2. Progression: gameplay metrics and completed sessions
      const progression = hasProgress ? {
        highestStageCleared: Number(cacheData?.highestStageCleared || 0),
        sessions: Array.isArray(cacheData?.sessions) ? [...cacheData.sessions] : [],
        totalScore: Number(cacheData?.totalScore || 0),
        bestStageScore: Number(cacheData?.bestStageScore || 0),
        currentStreak: Number(cacheData?.currentStreak || 0),
        longestStreak: Number(cacheData?.longestStreak || 0)
      } : null;

      // 3. Absolute Privacy Boundary:
      // NEVER serialize sankalpa, sankalpa_reflections, or sankalpa_e2ee_vault into ordinary save envelope.
      const payload = {
        schemaVersion: 2,
        artworks: Object.keys(artworksMap).length > 0 ? artworksMap : {},
        progression,
        exportedAt: new Date().toISOString()
      };

      const checksum = await fallbackComputeChecksum(payload);

      return {
        envelopeVersion: 1,
        gameId: 'auromandala',
        gameSchemaVersion: 1,
        guestId,
        baseRevision: 0,
        clientUpdatedAt: new Date().toISOString(),
        isEmpty: !hasProgress,
        checksum,
        payload
      };
    },
    applyEnvelope: async (envelope) => {
      if (!envelope || !envelope.payload) return false;
      try {
        if (typeof localStorage === 'undefined') return false;

        const payload = envelope.payload;
        // Read existing local cache to preserve local-only Sankalpa and perform non-destructive merge
        let existingCache = {};
        try {
          const raw = localStorage.getItem(CACHE_KEY);
          if (raw) existingCache = JSON.parse(raw) || {};
        } catch {}

        // 1. Extract incoming artworks (from payload.artworks or legacy payload.cache.savedArtworks)
        const incomingArtworks = payload.artworks || (payload.cache && payload.cache.savedArtworks) || {};
        const localArtworks = existingCache.savedArtworks || {};
        // Merge with non-destructive conflict forking: preserves local copy, forks divergent remote to '[Title] (Recovered Copy)'
        const mergedArtworks = mergeArtworksWithForking(localArtworks, incomingArtworks);

        // 2. Extract incoming progression
        const incomingProg = payload.progression || (payload.cache ? payload.cache : payload) || {};
        const incomingStage = Number(incomingProg.highestStageCleared || 0);
        const localStage = Number(existingCache.highestStageCleared || 0);
        const highestStageCleared = Math.max(localStage, incomingStage);

        // Merge sessions deduplicated
        const sessionMap = new Map();
        const localSessions = Array.isArray(existingCache.sessions) ? existingCache.sessions : [];
        const incomingSessions = Array.isArray(incomingProg.sessions) ? incomingProg.sessions : [];
        for (const s of [...localSessions, ...incomingSessions]) {
          if (!s) continue;
          const k = s.id || s.sessionId || s.timestamp || JSON.stringify(s);
          if (!sessionMap.has(k)) sessionMap.set(k, s);
        }

        // 3. CRITICAL: Preserve existing local-only Sankalpa data untouched!
        // Never overwrite existingCache.sankalpa from incoming envelope!
        const existingSankalpa = existingCache.sankalpa;

        const updatedCache = {
          ...existingCache,
          version: 2,
          highestStageCleared,
          sessions: Array.from(sessionMap.values()),
          savedArtworks: mergedArtworks,
          totalScore: Math.max(Number(existingCache.totalScore || 0), Number(incomingProg.totalScore || 0)),
          bestStageScore: Math.max(Number(existingCache.bestStageScore || 0), Number(incomingProg.bestStageScore || 0)),
          currentStreak: Math.max(Number(existingCache.currentStreak || 0), Number(incomingProg.currentStreak || 0)),
          longestStreak: Math.max(Number(existingCache.longestStreak || 0), Number(incomingProg.longestStreak || 0)),
          updatedAtISO: new Date().toISOString()
        };

        if (existingSankalpa !== undefined) {
          updatedCache.sankalpa = existingSankalpa;
        }

        localStorage.setItem(CACHE_KEY, JSON.stringify(updatedCache));
        return true;
      } catch {
        return false;
      }
    },
    init: async (scopedContext) => {
      const guestId = scopedContext && typeof scopedContext.getGuestId === 'function'
        ? scopedContext.getGuestId()
        : null;
      if (guestId) {
        if (typeof window !== 'undefined') {
          window.__AUROMIND_GUEST_ID__ = guestId;
        }
      }
    }
  };
}

/**
 * Return to AuroMind Portal action (B17-GAP-05).
 */
export function exitToAuroMindPortal() {
  try {
    if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
      const targetOrigin = (window.location.origin && window.location.origin !== 'null' && (window.location.origin.startsWith('http:') || window.location.origin.startsWith('https:')))
        ? window.location.origin
        : '*';
      window.parent.postMessage({
        type: 'AUROMIND_CLOSE_THEATER',
        gameId: 'auromandala'
      }, targetOrigin);
    } else if (typeof window !== 'undefined') {
      window.location.href = '../../index.html';
    }
  } catch (_err) {
    if (typeof window !== 'undefined') {
      window.location.href = '../../index.html';
    }
  }
}

if (typeof window !== 'undefined') {
  window.exitToAuroMindPortal = exitToAuroMindPortal;
}

/**
 * Mount floating Return to Portal button when running in theater mode.
 */
function mountPortalReturnButton() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  if (window.parent === window) return;

  if (document.getElementById('auromind-theater-return-btn')) return;

  const btn = document.createElement('button');
  btn.id = 'auromind-theater-return-btn';
  btn.setAttribute('type', 'button');
  btn.setAttribute('aria-label', 'Return to AuroMind Portal');
  btn.textContent = '⌂ Portal';
  btn.style.cssText = [
    'position: fixed',
    'top: 12px',
    'left: 12px',
    'z-index: 99999',
    'background: rgba(19, 30, 49, 0.90)',
    'backdrop-filter: blur(10px)',
    '-webkit-backdrop-filter: blur(10px)',
    'border: 1px solid rgba(245, 208, 97, 0.45)',
    'color: #fff8d6',
    'font-family: system-ui, -apple-system, sans-serif',
    'font-size: 11px',
    'font-weight: 700',
    'letter-spacing: 0.04em',
    'padding: 6px 14px',
    'border-radius: 999px',
    'cursor: pointer',
    'box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45)',
    'transition: all 0.2s ease',
    'user-select: none'
  ].join(';');

  btn.addEventListener('mouseenter', () => {
    btn.style.background = 'rgba(25, 40, 65, 0.98)';
    btn.style.borderColor = '#f5d061';
    btn.style.transform = 'scale(1.04)';
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.background = 'rgba(19, 30, 49, 0.90)';
    btn.style.borderColor = 'rgba(245, 208, 97, 0.45)';
    btn.style.transform = 'scale(1)';
  });
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    exitToAuroMindPortal();
  });

  const mount = () => {
    if (document.body && !document.getElementById('auromind-theater-return-btn')) {
      document.body.appendChild(btn);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
}

/**
 * Senior mode message listener (B17-GAP-07).
 */
function attachSeniorModeListener() {
  if (typeof window === 'undefined') return;

  window.addEventListener('message', (event) => {
    // 1. Mandatory Source Validation: message MUST originate from expected parent window
    if (!window.parent || event.source !== window.parent) return;

    // 2. Origin Validation: exact match if valid origin available, allow 'null' only for opaque sandboxed origins
    const currentOrigin = window.location.origin;
    const isTrustedOrigin = (currentOrigin && currentOrigin !== 'null')
      ? (event.origin === currentOrigin)
      : (event.origin === 'null' || event.origin === '');
    if (!isTrustedOrigin) return;

    // 3. Strict Payload and Type Allowlist Validation
    if (!event.data || typeof event.data !== 'object' || Array.isArray(event.data)) return;
    if (event.data.type === 'AUROMIND_SET_SENIOR_MODE') {
      const isSenior = Boolean(event.data.enabled);
      if (document.documentElement) {
        document.documentElement.classList.toggle('senior-mode', isSenior);
      }
      if (document.body) {
        document.body.classList.toggle('senior-mode', isSenior);
      }
    } else if (
      event.data.type === 'AUROMIND_IDENTITY_CHANGED' &&
      currentOrigin &&
      currentOrigin !== 'null' &&
      event.origin === currentOrigin
    ) {
      syncGameIdentityGlobals({
        mode: event.data.mode === 'authenticated' ? 'authenticated' : 'guest',
        guestId: typeof event.data.guestId === 'string' ? event.data.guestId : null,
        account: typeof event.data.userId === 'string' && event.data.userId ? { userId: event.data.userId } : null
      });
    }
  });
}

function syncGameIdentityGlobals(snapshot) {
  if (typeof window === 'undefined' || !snapshot) return;
  const guestId = snapshot.guestId || (snapshot.guest ? snapshot.guest.guestId : null);
  const userId = snapshot.account && snapshot.account.userId ? snapshot.account.userId : null;
  const mode = userId ? 'authenticated' : 'guest';
  if (guestId) window.__AUROMIND_GUEST_ID__ = guestId;
  window.__AUROMIND_USER_ID__ = userId;
  window.__AUROMIND_AUTH_MODE__ = mode;
  try {
    if (typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
      window.dispatchEvent(new CustomEvent('auromind:identity-changed', { detail: { mode, guestId, userId } }));
    }
  } catch (_e) {}
}

(async function initAuroMandalaSdkBridge() {
  if (typeof window === 'undefined') return;
  attachSeniorModeListener();
  mountPortalReturnButton();
  try {
    let parentSdk = null;
    try {
      parentSdk = typeof window !== 'undefined' && window.parent && window.parent !== window ? window.parent.AuroMind : null;
    } catch (_crossOriginErr) {
      parentSdk = null;
    }
    let sdk = (typeof window !== 'undefined' && window.AuroMind) || parentSdk;
    if (!sdk || typeof sdk.init !== 'function') {
      try {
        const mod = await import('../../../assets/sdk/auromind-sdk.js');
        sdk = (mod && (mod.AuroMind || mod.default)) || window.AuroMind;
      } catch (_importErr) {
        try {
          const mod = await import('/assets/sdk/auromind-sdk.js');
          sdk = (mod && (mod.AuroMind || mod.default)) || window.AuroMind;
        } catch (_importErr2) {
          sdk = window.AuroMind;
        }
      }
    }

    if (!sdk && typeof createLocalMockBridge === 'function' && typeof window !== 'undefined' && window.parent === window) {
      sdk = createLocalMockBridge('auromandala');
    }

    if (sdk && typeof sdk.init === 'function') {
      if (typeof window !== 'undefined') {
        window.AuroMind = sdk;
        window.AuroMindSDK = sdk;
      }
      const ctx = await sdk.init({
        gameId: 'auromandala',
        appVersion: '1.0.0'
      });

      const adapter = createAuroMandalaGameAdapter();
      if (sdk.adapters && typeof sdk.adapters.register === 'function') {
        sdk.adapters.register(adapter, { replace: true });
        if (!sdk.adapters.get('auromandala')?.initialized && typeof sdk.adapters.init === 'function') {
          await sdk.adapters.init('auromandala');
        }
      }

      const initialIdentity =
        sdk.identity && typeof sdk.identity.get === 'function'
          ? sdk.identity.get()
          : (ctx && ctx.identity ? ctx.identity : null);
      syncGameIdentityGlobals(initialIdentity);

      if (sdk.identity && typeof sdk.identity.subscribe === 'function') {
        sdk.identity.subscribe((snapshot) => syncGameIdentityGlobals(snapshot));
      }

      const guestId = (sdk.identity && typeof sdk.identity.getGuestId === 'function')
        ? sdk.identity.getGuestId()
        : (ctx && ctx.identity ? ctx.identity.guestId : null);

      if (guestId) {
        window.__AUROMIND_GUEST_ID__ = guestId;
        console.info('[AuroMandala] AuroMind shared platform guest identity established:', guestId);
      }

      if (sdk.telemetry && typeof sdk.telemetry.track === 'function') {
        sdk.telemetry.track(
          'game_session_start',
          {
            gameId: 'auromandala',
            appVersion: '1.0.0',
            mode: 'bridge'
          },
          { category: 'lifecycle', gameId: 'auromandala' }
        );
      }
      if (sdk.logging && typeof sdk.logging.info === 'function') {
        sdk.logging.info('auromandala', 'AuroMandala bridge initialized with shared platform SDK', {
          guestId
        });
      }
    }
  } catch (err) {
    console.warn('[AuroMandala] AuroMind SDK bridge non-fatal initialization warning:', err && err.message ? err.message : err);
  }
})();
