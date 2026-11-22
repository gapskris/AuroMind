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
  loadProfileState,
  saveProfileState,
  setItemAsync
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

      const hasProgress = Boolean(
        userObj &&
        (userObj.progression?.completedLevelsCount > 0 ||
          (Array.isArray(unlockedTiles) && unlockedTiles.length > 0) ||
          (Array.isArray(consecrations) && consecrations.length > 0))
      );

      const payload = {
        schemaVersion: 1,
        user: userObj || null,
        consecrations: Array.isArray(consecrations) ? consecrations : [],
        unlockedTiles: Array.isArray(unlockedTiles) ? unlockedTiles : [],
        exportedAt: new Date().toISOString()
      };

      let checksum;
      try {
        checksum = await computePayloadChecksum(payload);
      } catch {
        checksum = 'match_' + (unlockedTiles.length || 0) + '_' + (consecrations.length || 0);
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
    applyEnvelope: async (envelope) => {
      if (!envelope || !envelope.payload) return false;
      try {
        const { user, consecrations, unlockedTiles } = envelope.payload;
        if (user && typeof localStorage !== 'undefined') {
          localStorage.setItem('auro_match_user', JSON.stringify(user));
          await setItemAsync('auro_match_user', user);
        }
        if (Array.isArray(consecrations) && typeof localStorage !== 'undefined') {
          localStorage.setItem('auro_match_consecrations', JSON.stringify(consecrations));
          await setItemAsync('auro_match_consecrations', consecrations);
        }
        if (Array.isArray(unlockedTiles) && typeof localStorage !== 'undefined') {
          localStorage.setItem('auro_match_unlocked_tiles', JSON.stringify(unlockedTiles));
          await setItemAsync('auro_match_unlocked_tiles', unlockedTiles);
        }
        if (typeof localStorage !== 'undefined') {
          loadProfileState();
        }
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
 * Resolves and validates the exact parent portal HTTP(S) origin (B19.5-01D).
 * Does not assume parent and child always share an origin.
 * Works for same-origin deployments and cross-origin embedding.
 * Rejects missing, opaque ('null'), empty, or malformed origins.
 * Returns null if not in an iframe or if no trusted HTTP(S) parent origin is determined.
 */
export function resolveParentPortalOrigin() {
  if (typeof window === 'undefined' || !window.parent || window.parent === window) {
    return null;
  }

  // 1. Same-origin or accessible parent window: read window.parent.location.origin directly
  try {
    if (window.parent.location && window.parent.location.origin) {
      const parentOrigin = window.parent.location.origin;
      if (
        parentOrigin &&
        parentOrigin !== 'null' &&
        (parentOrigin.indexOf('http://') === 0 || parentOrigin.indexOf('https://') === 0)
      ) {
        return parentOrigin;
      }
    }
  } catch (_crossOriginErr) {
    // Cross-origin parent window access throws DOMException (SecurityError)
  }

  // 2. Verified message origin received from window.parent (e.g. handshake on load)
  if (typeof window !== 'undefined' && window.__AUROMIND_PARENT_ORIGIN__) {
    const cachedOrigin = window.__AUROMIND_PARENT_ORIGIN__;
    if (
      cachedOrigin &&
      cachedOrigin !== 'null' &&
      (cachedOrigin.indexOf('http://') === 0 || cachedOrigin.indexOf('https://') === 0)
    ) {
      return cachedOrigin;
    }
  }

  // 3. Cross-origin parent: derive from document.referrer if available and valid HTTP(S)
  if (typeof document !== 'undefined' && document.referrer) {
    try {
      const refUrl = new URL(document.referrer);
      if (
        (refUrl.protocol === 'http:' || refUrl.protocol === 'https:') &&
        refUrl.origin &&
        refUrl.origin !== 'null'
      ) {
        return refUrl.origin;
      }
    } catch (_refErr) {}
  }

  return null;
}

/**
 * Return to AuroMind Portal navigation.
 * Authoritative implementation (B19.5-01D).
 * Targets the verified parent portal origin, never wildcard '*', 'null', or empty.
 * If in standalone mode or parent origin cannot be verified, navigates cleanly to portal root.
 */
export function exitToAuroMindPortal() {
  try {
    if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
      const targetOrigin = resolveParentPortalOrigin();
      if (!targetOrigin) {
        // Untrusted, opaque, or missing parent origin - fallback to relative portal navigation
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

/**
 * Self-initializing SDK Bridge lifecycle.
 */
(async function initAuroMatchSdkBridge() {
  attachSeniorModeListener();
  mountPortalReturnButton();

  try {
    let sdk = window.AuroMind || (window.parent && window.parent.AuroMind);
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