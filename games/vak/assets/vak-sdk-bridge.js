/**
 * AuroMind Shared Platform SDK — VAK Speech Control Integration Bridge
 *
 * Connects VAK to the AuroMind Shared Platform SDK:
 * - Binds game to the single-device platform guest identity (guest_<uuid>)
 * - Registers VAK-owned storage keys in the platform adapter registry
 * - Exports and applies standardized game save envelopes with canonical SHA-256
 * - Preserves 100% byte-exact immutability of the 1,368 levels sacred speech training corpus
 * - Supports Senior Mode preference synchronization
 * - Provides in-game Return to Portal navigation
 * - Enables 100% offline standalone mock fallback (TASK-SDK-02)
 */

import {
  computePayloadChecksum,
  createLocalMockBridge
} from '../../../assets/sdk/auromind-adapters.js';

const OWNED_STORAGE_KEYS = Object.freeze([
  'vak_player_profile_v1',
  'vak_game_data',
  'auro_vak_user',
  'vak_cosmos_progress',
  'vak_mandala_progress',
  'vak_level_index',
  'vak_sparks_balance',
  'vak_active_mode',
  'vak_profiles_map'
]);

/**
 * Creates the platform adapter for VAK.
 */
export function createVakGameAdapter() {
  return {
    gameId: 'vak',
    adapterVersion: '1.0.0',
    contractVersion: 1,
    integrationMode: 'native',
    storage: {
      kind: 'ls',
      ownedDatabases: [],
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
        const profileRaw = localStorage.getItem('vak_player_profile_v1') || localStorage.getItem('auro_vak_user');
        if (profileRaw) {
          const parsed = JSON.parse(profileRaw);
          if (parsed && (parsed.player?.currentLevel > 1 || parsed.player?.sparks > 100 || parsed.completedWords?.length > 0)) {
            return true;
          }
        }
        const levelIdx = Number(localStorage.getItem('vak_level_index') || 0);
        return levelIdx > 0;
      } catch {
        return false;
      }
    },
    exportEnvelope: async (guestId) => {
      let profileData = null;
      let cosmosProgress = null;
      let mandalaProgress = null;

      try {
        if (typeof localStorage !== 'undefined') {
          const rawProf = localStorage.getItem('vak_player_profile_v1') || localStorage.getItem('auro_vak_user');
          if (rawProf) profileData = JSON.parse(rawProf);

          const rawCosmos = localStorage.getItem('vak_cosmos_progress');
          if (rawCosmos) cosmosProgress = JSON.parse(rawCosmos);

          const rawMandala = localStorage.getItem('vak_mandala_progress');
          if (rawMandala) mandalaProgress = JSON.parse(rawMandala);
        }
      } catch {}

      const hasProgress = Boolean(
        profileData &&
        (profileData.player?.currentLevel > 1 ||
          profileData.player?.sparks > 100 ||
          (Array.isArray(profileData.completedWords) && profileData.completedWords.length > 0))
      );

      const payload = {
        schemaVersion: 1,
        profile: profileData || null,
        cosmosProgress: cosmosProgress || null,
        mandalaProgress: mandalaProgress || null,
        exportedAt: new Date().toISOString()
      };

      let checksum;
      try {
        checksum = await computePayloadChecksum(payload);
      } catch {
        checksum = 'vak_' + (profileData?.player?.currentLevel || 1) + '_' + (profileData?.player?.sparks || 0);
      }

      return {
        envelopeVersion: 1,
        gameId: 'vak',
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
        const { profile, cosmosProgress, mandalaProgress } = envelope.payload;
        if (profile && typeof localStorage !== 'undefined') {
          localStorage.setItem('vak_player_profile_v1', JSON.stringify(profile));
          if (profile.player?.currentLevel) {
            localStorage.setItem('vak_level_index', String(profile.player.currentLevel - 1));
          }
          if (profile.player?.sparks) {
            localStorage.setItem('vak_sparks_balance', String(profile.player.sparks));
          }
        }
        if (cosmosProgress && typeof localStorage !== 'undefined') {
          localStorage.setItem('vak_cosmos_progress', JSON.stringify(cosmosProgress));
        }
        if (mandalaProgress && typeof localStorage !== 'undefined') {
          localStorage.setItem('vak_mandala_progress', JSON.stringify(mandalaProgress));
        }
        return true;
      } catch (err) {
        console.warn('[VAK Bridge] Failed to apply save envelope:', err);
        return false;
      }
    },
    init: async (scopedContext) => {
      const guestId = scopedContext.getGuestId();
      if (guestId && typeof window !== 'undefined') {
        window.__AUROMIND_GUEST_ID__ = guestId;
      }
    }
  };
}

/**
 * Return to AuroMind Portal navigation.
 */
export function exitToAuroMindPortal() {
  try {
    if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
      const targetOrigin =
        window.location.origin && window.location.origin !== 'null' && (window.location.origin.startsWith('http:') || window.location.origin.startsWith('https:'))
          ? window.location.origin
          : '*';
      window.parent.postMessage(
        {
          type: 'AUROMIND_CLOSE_THEATER',
          gameId: 'vak'
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
 */
function attachSeniorModeListener() {
  if (typeof window === 'undefined') return;

  window.addEventListener('message', (event) => {
    if (!window.parent || event.source !== window.parent) return;

    const currentOrigin = window.location.origin;
    const isTrustedOrigin =
      currentOrigin && currentOrigin !== 'null'
        ? event.origin === currentOrigin
        : event.origin === 'null' || event.origin === '';
    if (!isTrustedOrigin) return;

    if (!event.data || typeof event.data !== 'object' || Array.isArray(event.data)) return;
    if (event.data.type === 'AUROMIND_SET_SENIOR_MODE') {
      const isSenior = Boolean(event.data.enabled);
      if (document.documentElement) {
        document.documentElement.classList.toggle('senior-mode', isSenior);
      }
      if (document.body) {
        document.body.classList.toggle('senior-mode', isSenior);
      }
    }
  });
}

/**
 * Self-initializing SDK Bridge lifecycle.
 */
(async function initVakSdkBridge() {
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
        gameId: 'vak',
        appVersion: '1.0.0'
      });

      const adapter = createVakGameAdapter();
      if (sdk.adapters && typeof sdk.adapters.register === 'function') {
        sdk.adapters.register(adapter, { replace: true });
        if (!sdk.adapters.get('vak')?.initialized && typeof sdk.adapters.init === 'function') {
          await sdk.adapters.init('vak');
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
        console.info('[VAK] AuroMind shared platform guest identity established:', guestId);
      }

      if (sdk.telemetry && typeof sdk.telemetry.track === 'function') {
        sdk.telemetry.track(
          'game_session_start',
          {
            gameId: 'vak',
            appVersion: '1.0.0',
            mode: 'bridge'
          },
          { category: 'lifecycle', gameId: 'vak' }
        );
      }

      if (sdk.logging && typeof sdk.logging.info === 'function') {
        sdk.logging.info('vak', 'VAK bridge initialized with shared platform SDK', {
          guestId
        });
      }
    } else {
      const mock = createLocalMockBridge('vak');
      if (typeof window !== 'undefined') {
        window.AuroMind = window.AuroMind || mock;
        window.AuroMindSDK = window.AuroMindSDK || mock;
      }
    }
  } catch (err) {
    const mock = createLocalMockBridge('vak');
    if (typeof window !== 'undefined') {
      window.AuroMind = window.AuroMind || mock;
      window.AuroMindSDK = window.AuroMindSDK || mock;
    }
    console.warn('[VAK] AuroMind SDK bridge running in local mock fallback:', err && err.message ? err.message : err);
  }
})();