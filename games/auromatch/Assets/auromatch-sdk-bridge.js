/**
 * AuroMind Shared Platform SDK — AuroMatch Safe Integration Bridge
 *
 * Connects AuroMatch to the AuroMind Shared Platform SDK:
 * - Binds game to the single-device platform guest identity (guest_<uuid>)
 * - Registers AuroMatch-owned storage keys and AuroMatchDB in the adapter registry
 * - Exports and applies standardized game save envelopes with canonical SHA-256
 * - Coordinates auto-healing between IndexedDB and localStorage (F-05)
 * - Supports Senior Mode preference synchronization
 * - Provides in-game Return to Portal navigation
 * - Enables 100% offline standalone mock fallback (TASK-SDK-02)
 */

import {
  computePayloadChecksum,
  createLocalMockBridge
} from '../../../assets/sdk/auromind-adapters.js';

import {
  autoHealFromIndexedDB,
  isPurgeActive,
  loadProfileState,
  mergeAuroMatchUserRecords,
  mergeUniqueItems,
  saveProfileState,
  setItemAsync,
  setItemDualWrite
} from '../src/controllers/storageAdapter.js';

const OWNED_STORAGE_KEYS = Object.freeze([
  'auromatch_player_state',
  'auromatch_player_profiles',
  'auromatch_standard_theme',
  'auromatch_has_entered_sanctuary',
  'auro_match_user',
  'auro_match_consecrations',
  'auro_match_unlocked_tiles',
  'auro_match_teachings'
]);

/**
 * Creates the platform adapter for AuroMatch.
 */
export function createAuroMatchGameAdapter() {
  return {
    gameId: 'auromatch',
    adapterVersion: '1.0.0',
    contractVersion: 1,
    integrationMode: 'native',
    storage: {
      kind: 'idb+ls',
      ownedDatabases: ['AuroMatchDB'],
      ownedLocalStorageKeys: [...OWNED_STORAGE_KEYS],
      localOnlyVaults: []
    },
    capabilities: {
      offlinePlay: true,
      localPersistence: true,
      cloudSyncEligible: true,
      hasLocalOnlyVaults: false,
      localOnlyVaults: []
    },
    hasLocalProgress: () => {
      try {
        if (typeof localStorage === 'undefined') return false;
        const userRaw = localStorage.getItem('auro_match_user');
        if (userRaw) {
          const parsed = JSON.parse(userRaw);
          if (parsed && (parsed.progression?.completedLevelsCount > 0 || parsed.progression?.completedLevelIds?.length > 0)) {
            return true;
          }
        }
        const stateRaw = localStorage.getItem('auromatch_player_state');
        if (stateRaw) {
          const parsed = JSON.parse(stateRaw);
          if (parsed && (parsed.completedLevels?.length > 0 || parsed.currentLevel > 1)) {
            return true;
          }
        }
        return false;
      } catch {
        return false;
      }
    },
    exportEnvelope: async (guestId) => {
      let userObj = null;
      let consecrations = [];
      let unlockedTiles = [];

      try {
        if (typeof localStorage !== 'undefined') {
          const rawUser = localStorage.getItem('auro_match_user');
          if (rawUser) userObj = JSON.parse(rawUser);

          const rawCons = localStorage.getItem('auro_match_consecrations');
          if (rawCons) consecrations = JSON.parse(rawCons);

          const rawTiles = localStorage.getItem('auro_match_unlocked_tiles');
          if (rawTiles) unlockedTiles = JSON.parse(rawTiles);
        }
      } catch {}

      const normalizedConsecrations = mergeUniqueItems(Array.isArray(consecrations) ? consecrations : [], []);
      const normalizedTiles = mergeUniqueItems(Array.isArray(unlockedTiles) ? unlockedTiles : [], []);

      const hasProgress = Boolean(
        (userObj && (userObj.progression?.completedLevelsCount > 0 || (userObj.progression?.completedLevelIds?.length || 0) > 0)) ||
        normalizedTiles.length > 0 ||
        normalizedConsecrations.length > 0
      );

      const payload = {
        schemaVersion: 1,
        user: userObj || null,
        consecrations: normalizedConsecrations,
        unlockedTiles: normalizedTiles,
        exportedAt: new Date().toISOString()
      };

      let checksum;
      try {
        checksum = await computePayloadChecksum(payload);
      } catch {
        checksum = 'match_' + (normalizedTiles.length || 0) + '_' + (normalizedConsecrations.length || 0);
      }

      return {
        envelopeVersion: 1,
        gameId: 'auromatch',
        gameSchemaVersion: 1,
        guestId,
        baseRevision: 0,
        clientUpdatedAt: new Date().toISOString(),
        isEmpty: !hasProgress,
        checksum,
        payload
      };
    },
    applyEnvelope: async (envelope, context = {}) => {
      if (!envelope || !envelope.payload || typeof envelope.payload !== 'object') return false;
      if (envelope.gameId && envelope.gameId !== 'auromatch') return false;
      if (typeof isPurgeActive === 'function' && isPurgeActive()) {
        console.warn('[AuroMatch Bridge] applyEnvelope blocked: Purge is active.');
        return false;
      }
      try {
        if (typeof localStorage === 'undefined') return false;
        const skipLocalMerge = Boolean(context?.skipLocalMerge || envelope?.skipLocalMerge);
        const { user, consecrations, unlockedTiles, profileState: envelopeProfileState } = envelope.payload;

        let effectiveUser = user;
        let effectiveConsecrations = consecrations;
        let effectiveTiles = unlockedTiles;

        if (envelopeProfileState && typeof envelopeProfileState === 'object') {
          effectiveUser = {
            profile: envelopeProfileState.profile,
            progression: envelopeProfileState.progression,
            settings: envelopeProfileState.settings,
            dailyDrawDate: envelopeProfileState.dailyDrawDate
          };
          effectiveConsecrations = envelopeProfileState.reflections;
          effectiveTiles = envelopeProfileState.progression?.completedLevelIds;
        }

        let localUser = null;
        let localConsecrations = [];
        let localTiles = [];
        if (!skipLocalMerge) {
          try {
            const rawUser = localStorage.getItem('auro_match_user');
            if (rawUser) localUser = JSON.parse(rawUser);
          } catch {}
          try {
            const rawCons = localStorage.getItem('auro_match_consecrations');
            if (rawCons) localConsecrations = JSON.parse(rawCons);
          } catch {}
          try {
            const rawTiles = localStorage.getItem('auro_match_unlocked_tiles');
            if (rawTiles) localTiles = JSON.parse(rawTiles);
          } catch {}
        }

        const mergedTiles = Array.isArray(effectiveTiles)
          ? (skipLocalMerge ? effectiveTiles : mergeUniqueItems(localTiles, effectiveTiles))
          : (skipLocalMerge ? [] : mergeUniqueItems(localTiles, []));
        const mergedConsecrations = Array.isArray(effectiveConsecrations)
          ? (skipLocalMerge ? effectiveConsecrations : mergeUniqueItems(localConsecrations, effectiveConsecrations))
          : (skipLocalMerge ? [] : mergeUniqueItems(localConsecrations, []));

        if (effectiveUser && typeof effectiveUser === 'object') {
          const mergedUser = skipLocalMerge
            ? JSON.parse(JSON.stringify(effectiveUser))
            : mergeAuroMatchUserRecords(localUser, effectiveUser);
          if (mergedUser.progression) {
            mergedUser.progression.completedLevelIds = mergeUniqueItems(
              mergedUser.progression.completedLevelIds || [],
              mergedTiles
            );
            mergedUser.progression.completedLevelsCount = Math.max(
              Number(mergedUser.progression.completedLevelsCount || 0),
              mergedUser.progression.completedLevelIds.length
            );
          }
          await setItemDualWrite('auro_match_user', mergedUser);
        }
        if (Array.isArray(effectiveConsecrations) || skipLocalMerge) {
          await setItemDualWrite('auro_match_consecrations', mergedConsecrations);
        }
        if (Array.isArray(effectiveTiles) || skipLocalMerge) {
          await setItemDualWrite('auro_match_unlocked_tiles', mergedTiles);
        }
        loadProfileState();
        return true;
      } catch (err) {
        console.warn('[AuroMatch Bridge] Failed to apply save envelope:', err);
        return false;
      }
    },
    init: async (scopedContext) => {
      const guestId = scopedContext.getGuestId();
      if (guestId && typeof window !== 'undefined') {
        window.__AUROMIND_GUEST_ID__ = guestId;
      }
      // Execute auto-healing between IndexedDB and localStorage
      await autoHealFromIndexedDB();
    }
  };
}

/**
 * Resolves and validates the exact same-origin parent portal HTTP(S) origin (B19.5-01E).
 * Confirmed same-origin architecture: portal and games share the exact same origin.
 * Does not trust document.referrer or cached origins.
 * Rejects missing, opaque ('null'), empty, wildcard, or cross-origin contexts.
 * Returns null if not in a valid same-origin iframe context.
 */
export function resolveParentPortalOrigin() {
  if (typeof window === 'undefined' || !window.parent || window.parent === window) {
    return null;
  }

  const currentOrigin = window.location.origin;
  if (
    !currentOrigin ||
    currentOrigin === 'null' ||
    currentOrigin === '' ||
    (!currentOrigin.startsWith('http://') && !currentOrigin.startsWith('https://'))
  ) {
    return null;
  }

  // Same-origin verification: parent origin must be accessible and match exact currentOrigin
  try {
    if (window.parent.location && window.parent.location.origin === currentOrigin) {
      return currentOrigin;
    }
  } catch (_e) {
    // Cross-origin parent window access fails closed
  }

  return null;
}

/**
 * Return to AuroMind Portal navigation.
 * Authoritative implementation (B19.5-01E).
 * Targets the verified exact same-origin parent portal, never wildcard '*', 'null', or empty.
 * In standalone mode or if same-origin verification fails closed, navigates cleanly to portal root.
 */
export function exitToAuroMindPortal() {
  try {
    if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
      const targetOrigin = resolveParentPortalOrigin();
      if (!targetOrigin) {
        // Fail closed against posting messages; fallback to direct relative navigation to portal
        window.location.href = '../../index.html';
        return;
      }

      window.parent.postMessage(
        {
          type: 'AUROMIND_CLOSE_THEATER',
          gameId: 'auromatch'
        },
        targetOrigin
      );
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
  window.resolveParentPortalOrigin = resolveParentPortalOrigin;
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
    'background: rgba(20, 18, 16, 0.88)',
    'backdrop-filter: blur(10px)',
    '-webkit-backdrop-filter: blur(10px)',
    'border: 1px solid rgba(232, 193, 90, 0.4)',
    'color: #f5efe4',
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
    btn.style.background = 'rgba(30, 27, 24, 0.98)';
    btn.style.borderColor = '#e8c15a';
    btn.style.transform = 'scale(1.04)';
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.background = 'rgba(20, 18, 16, 0.88)';
    btn.style.borderColor = 'rgba(232, 193, 90, 0.4)';
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
 * Senior mode message listener.
 * Authoritative message validation and state synchronization is consolidated
 * exclusively in games/auromatch/index.html to ensure single listener ownership (B19.5-01C).
 * The SDK bridge explicitly does not register a duplicate window listener.
 */
function attachSeniorModeListener() {
  // Authoritative handler is registered exclusively by games/auromatch/index.html.
  // Bridge explicitly avoids registering a second listener.
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

/**
 * Self-initializing SDK Bridge lifecycle.
 */
(async function initAuroMatchSdkBridge() {
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

    if (sdk && typeof sdk.init === 'function') {
      if (typeof window !== 'undefined') {
        window.AuroMind = sdk;
        window.AuroMindSDK = sdk;
      }
      const ctx = await sdk.init({
        gameId: 'auromatch',
        appVersion: '1.0.0'
      });

      const adapter = createAuroMatchGameAdapter();
      if (sdk.adapters && typeof sdk.adapters.register === 'function') {
        sdk.adapters.register(adapter, { replace: true });
        if (!sdk.adapters.get('auromatch')?.initialized && typeof sdk.adapters.init === 'function') {
          await sdk.adapters.init('auromatch');
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

      const guestId =
        sdk.identity && typeof sdk.identity.getGuestId === 'function'
          ? sdk.identity.getGuestId()
          : ctx && ctx.identity
            ? ctx.identity.guestId
            : null;

      if (guestId) {
        window.__AUROMIND_GUEST_ID__ = guestId;
        console.info('[AuroMatch] AuroMind shared platform guest identity established:', guestId);
      }

      if (sdk.telemetry && typeof sdk.telemetry.track === 'function') {
        sdk.telemetry.track(
          'game_session_start',
          {
            gameId: 'auromatch',
            appVersion: '1.0.0',
            mode: 'bridge'
          },
          { category: 'lifecycle', gameId: 'auromatch' }
        );
      }

      if (sdk.logging && typeof sdk.logging.info === 'function') {
        sdk.logging.info('auromatch', 'AuroMatch bridge initialized with shared platform SDK', {
          guestId
        });
      }
    } else {
      const mock = createLocalMockBridge('auromatch');
      if (typeof window !== 'undefined') {
        window.AuroMind = window.AuroMind || mock;
        window.AuroMindSDK = window.AuroMindSDK || mock;
      }
    }
  } catch (err) {
    const mock = createLocalMockBridge('auromatch');
    if (typeof window !== 'undefined') {
      window.AuroMind = window.AuroMind || mock;
      window.AuroMindSDK = window.AuroMindSDK || mock;
    }
    console.warn('[AuroMatch] AuroMind SDK bridge running in local mock fallback:', err && err.message ? err.message : err);
  }
})();