/**
 * AuroMind Shared Platform SDK — VAK Living Sanctuary Integration Bridge
 *
 * Connects VAK Living Sanctuary to the AuroMind Shared Platform SDK:
 * - Binds game to the single-device platform guest identity (guest_<uuid>)
 * - Registers VAK Sanctuary storage keys in the platform adapter registry
 * - Exports and applies standardized game save envelopes with canonical SHA-256
 * - Preserves unlocked words codex, personal notes, and bookmarks
 * - Supports Senior Mode preference synchronization
 * - Provides in-game Return to Portal navigation
 * - Enables 100% offline standalone mock fallback (TASK-SDK-02)
 */

import {
  computePayloadChecksum,
  createLocalMockBridge
} from '../../../assets/sdk/auromind-adapters.js';

const OWNED_STORAGE_KEYS = Object.freeze([
  'vak_sanctuary_progress',
  'resonant_realms_index_v1',
  'vak_sanctuary_bookmarks',
  'vak_sanctuary_notes',
  'vak_sanctuary_discoveries'
]);

/**
 * Creates the platform adapter for VAK Living Sanctuary.
 */
export function createVakLivingSanctuaryGameAdapter() {
  return {
    gameId: 'vak-living-sanctuary',
    adapterVersion: '1.0.0',
    contractVersion: 1,
    integrationMode: 'native',
    storage: {
      kind: 'idb+ls',
      ownedDatabases: ['vak_sanctuary_db'],
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
        const progressRaw = localStorage.getItem('vak_sanctuary_progress');
        if (progressRaw) {
          const parsed = JSON.parse(progressRaw);
          if (parsed && (parsed.discoveredCount > 0 || (Array.isArray(parsed.unlockedWords) && parsed.unlockedWords.length > 0))) {
            return true;
          }
        }
        const realmsRaw = localStorage.getItem('resonant_realms_index_v1');
        if (realmsRaw) {
          const parsed = JSON.parse(realmsRaw);
          if (Array.isArray(parsed) && parsed.length > 0) return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    exportEnvelope: async (guestId) => {
      let progress = null;
      let bookmarks = [];
      let notes = {};
      let realmsIndex = null;

      try {
        if (typeof localStorage !== 'undefined') {
          const rawProg = localStorage.getItem('vak_sanctuary_progress');
          if (rawProg) progress = JSON.parse(rawProg);

          const rawBkmk = localStorage.getItem('vak_sanctuary_bookmarks');
          if (rawBkmk) bookmarks = JSON.parse(rawBkmk);

          const rawNotes = localStorage.getItem('vak_sanctuary_notes');
          if (rawNotes) notes = JSON.parse(rawNotes);

          const rawRealms = localStorage.getItem('resonant_realms_index_v1');
          if (rawRealms) realmsIndex = JSON.parse(rawRealms);
        }
      } catch {}

      const hasProgress = Boolean(
        progress &&
        (progress.discoveredCount > 0 ||
          (Array.isArray(progress.unlockedWords) && progress.unlockedWords.length > 0) ||
          bookmarks.length > 0)
      );

      const payload = {
        schemaVersion: 1,
        progress: progress || null,
        bookmarks: Array.isArray(bookmarks) ? bookmarks : [],
        notes: notes || {},
        realmsIndex: realmsIndex || null,
        exportedAt: new Date().toISOString()
      };

      let checksum;
      try {
        checksum = await computePayloadChecksum(payload);
      } catch {
        checksum = 'sanctuary_' + (bookmarks.length || 0) + '_' + Date.now();
      }

      return {
        envelopeVersion: 1,
        gameId: 'vak-living-sanctuary',
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
        const { progress, bookmarks, notes, realmsIndex } = envelope.payload;
        if (typeof localStorage !== 'undefined') {
          if (progress) {
            localStorage.setItem('vak_sanctuary_progress', JSON.stringify(progress));
          }
          if (Array.isArray(bookmarks)) {
            localStorage.setItem('vak_sanctuary_bookmarks', JSON.stringify(bookmarks));
          }
          if (notes) {
            localStorage.setItem('vak_sanctuary_notes', JSON.stringify(notes));
          }
          if (realmsIndex) {
            localStorage.setItem('resonant_realms_index_v1', JSON.stringify(realmsIndex));
          }
        }
        return true;
      } catch (err) {
        console.warn('[VAK Sanctuary Bridge] Failed to apply save envelope:', err);
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
          gameId: 'vak-sanctuary'
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
(async function initVakLivingSanctuarySdkBridge() {
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
        gameId: 'vak-living-sanctuary',
        appVersion: '1.0.0'
      });

      const adapter = createVakLivingSanctuaryGameAdapter();
      if (sdk.adapters && typeof sdk.adapters.register === 'function') {
        sdk.adapters.register(adapter, { replace: true });
        if (!sdk.adapters.get('vak-living-sanctuary')?.initialized && typeof sdk.adapters.init === 'function') {
          await sdk.adapters.init('vak-living-sanctuary');
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
        console.info('[VAK Sanctuary] AuroMind shared platform guest identity established:', guestId);
      }

      if (sdk.telemetry && typeof sdk.telemetry.track === 'function') {
        sdk.telemetry.track(
          'game_session_start',
          {
            gameId: 'vak-living-sanctuary',
            appVersion: '1.0.0',
            mode: 'bridge'
          },
          { category: 'lifecycle', gameId: 'vak-living-sanctuary' }
        );
      }

      if (sdk.logging && typeof sdk.logging.info === 'function') {
        sdk.logging.info('vak-living-sanctuary', 'VAK Sanctuary bridge initialized with shared platform SDK', {
          guestId
        });
      }
    } else {
      const mock = createLocalMockBridge('vak-living-sanctuary');
      if (typeof window !== 'undefined') {
        window.AuroMind = window.AuroMind || mock;
        window.AuroMindSDK = window.AuroMindSDK || mock;
      }
    }
  } catch (err) {
    const mock = createLocalMockBridge('vak-living-sanctuary');
    if (typeof window !== 'undefined') {
      window.AuroMind = window.AuroMind || mock;
      window.AuroMindSDK = window.AuroMindSDK || mock;
    }
    console.warn('[VAK Sanctuary] AuroMind SDK bridge running in local mock fallback:', err && err.message ? err.message : err);
  }
})();