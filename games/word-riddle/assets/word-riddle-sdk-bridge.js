/**
 * AuroMind Shared Platform SDK — Word Riddle (Word Discovery) Integration Bridge
 *
 * Connects Word Riddle to the AuroMind Shared Platform SDK:
 * - Binds game to the single-device platform guest identity (guest_<uuid>)
 * - Registers Word Riddle storage (word-discovery-db) in the platform adapter registry
 * - Exports and applies standardized game save envelopes with canonical SHA-256
 * - Supports Senior Mode preference synchronization
 * - Provides in-game Return to Portal navigation
 * - Enables 100% offline standalone mock fallback (TASK-SDK-02)
 */

import {
  computePayloadChecksum,
  createLocalMockBridge
} from '../../../assets/sdk/auromind-adapters.js';

const OWNED_STORAGE_KEYS = Object.freeze([
  'word_riddle_progress',
  'word_discovery_settings',
  'word_discovery_achievements',
  'word_riddle_active_theme'
]);

/**
 * Low-level IndexedDB query for word-discovery-db
 */
async function readWordDiscoveryProgress() {
  if (typeof indexedDB === 'undefined') return null;
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open('word-discovery-db');
      req.onerror = () => resolve(null);
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('questionProgress')) {
          db.close();
          return resolve(null);
        }
        try {
          const tx = db.transaction(['questionProgress'], 'readonly');
          const store = tx.objectStore('questionProgress');
          const getAllReq = store.getAll();
          getAllReq.onsuccess = () => {
            const result = getAllReq.result || [];
            db.close();
            resolve(result);
          };
          getAllReq.onerror = () => {
            db.close();
            resolve(null);
          };
        } catch {
          db.close();
          resolve(null);
        }
      };
    } catch {
      resolve(null);
    }
  });
}

/**
 * Creates the platform adapter for Word Riddle.
 */
export function createWordRiddleGameAdapter() {
  return {
    gameId: 'word-riddle',
    adapterVersion: '1.0.0',
    contractVersion: 1,
    integrationMode: 'native',
    storage: {
      kind: 'idb+ls',
      ownedDatabases: ['word-discovery-db'],
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
        if (typeof localStorage !== 'undefined') {
          const raw = localStorage.getItem('word_riddle_progress');
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0) return true;
          }
        }
        return false;
      } catch {
        return false;
      }
    },
    exportEnvelope: async (guestId) => {
      let progressList = await readWordDiscoveryProgress();
      if (!progressList && typeof localStorage !== 'undefined') {
        try {
          const raw = localStorage.getItem('word_riddle_progress');
          if (raw) progressList = JSON.parse(raw);
        } catch {}
      }

      const solvedRiddles = Array.isArray(progressList)
        ? progressList.filter((item) => item.status === 'completed' || item.solved)
        : [];
      const hasProgress = solvedRiddles.length > 0;

      const payload = {
        schemaVersion: 1,
        solvedRiddles,
        totalProgressCount: progressList ? progressList.length : 0,
        exportedAt: new Date().toISOString()
      };

      let checksum;
      try {
        checksum = await computePayloadChecksum(payload);
      } catch {
        checksum = 'riddle_' + solvedRiddles.length + '_' + Date.now();
      }

      return {
        envelopeVersion: 1,
        gameId: 'word-riddle',
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
        const { solvedRiddles } = envelope.payload;
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('word_riddle_progress', JSON.stringify(solvedRiddles || []));
        }
        return true;
      } catch (err) {
        console.warn('[Word Riddle Bridge] Failed to apply save envelope:', err);
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
          gameId: 'word-riddle'
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
(async function initWordRiddleSdkBridge() {
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
        gameId: 'word-riddle',
        appVersion: '1.0.0'
      });

      const adapter = createWordRiddleGameAdapter();
      if (sdk.adapters && typeof sdk.adapters.register === 'function') {
        sdk.adapters.register(adapter, { replace: true });
        if (!sdk.adapters.get('word-riddle')?.initialized && typeof sdk.adapters.init === 'function') {
          await sdk.adapters.init('word-riddle');
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
        console.info('[Word Riddle] AuroMind shared platform guest identity established:', guestId);
      }

      if (sdk.telemetry && typeof sdk.telemetry.track === 'function') {
        sdk.telemetry.track(
          'game_session_start',
          {
            gameId: 'word-riddle',
            appVersion: '1.0.0',
            mode: 'bridge'
          },
          { category: 'lifecycle', gameId: 'word-riddle' }
        );
      }

      if (sdk.logging && typeof sdk.logging.info === 'function') {
        sdk.logging.info('word-riddle', 'Word Riddle bridge initialized with shared platform SDK', {
          guestId
        });
      }
    } else {
      const mock = createLocalMockBridge('word-riddle');
      if (typeof window !== 'undefined') {
        window.AuroMind = window.AuroMind || mock;
        window.AuroMindSDK = window.AuroMindSDK || mock;
      }
    }
  } catch (err) {
    const mock = createLocalMockBridge('word-riddle');
    if (typeof window !== 'undefined') {
      window.AuroMind = window.AuroMind || mock;
      window.AuroMindSDK = window.AuroMindSDK || mock;
    }
    console.warn('[Word Riddle] AuroMind SDK bridge running in local mock fallback:', err && err.message ? err.message : err);
  }
})();