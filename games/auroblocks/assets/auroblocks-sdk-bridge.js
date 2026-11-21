/**
 * AuroMind Shared Platform SDK — AuroBlocks Safe Integration Bridge
 *
 * Connects AuroBlocks to the AuroMind Shared Platform SDK:
 * - Binds game to the single-device platform guest identity (guest_<uuid>)
 * - Registers AuroBlocks-owned storage keys in the platform adapter registry
 * - Exports and applies game save envelopes for cloud sync eligibility
 * - Relays telemetry events: level_attempt, level_completed, score, game_session_start
 * - Supports Senior Mode preference synchronization
 * - Provides in-game Return to Portal navigation via AUROMIND_CLOSE_THEATER
 * - Preserves 100% offline and local-first gameplay
 */

import {
  computePayloadChecksum,
  createLocalMockBridge
} from '../../../assets/sdk/auromind-adapters.js';

const SAVE_KEY = 'auroblocks_player_save_v1';
const OWNED_STORAGE_KEYS = Object.freeze([
  SAVE_KEY,
  'auroblocks_active_session',
  'auroblocks_progression_v1',
  'auroblocks_high_score',
  'auroblocks_high_score_classic',
  'auroblocks_high_score_sudoku',
  'auroblocks_stages',
  'auroblocks_stage_scores'
]);

/**
 * Creates the platform adapter for AuroBlocks.
 */
export function createAuroBlocksGameAdapter() {
  return {
    gameId: 'auroblocks',
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
        const rawSave = localStorage.getItem(SAVE_KEY);
        if (rawSave) {
          const parsed = JSON.parse(rawSave);
          if (parsed && (parsed.highScore > 0 || (Array.isArray(parsed.stages) && parsed.stages.length > 0))) {
            return true;
          }
        }
        const highScore = Number(localStorage.getItem('auroblocks_high_score') || 0);
        const stagesRaw = localStorage.getItem('auroblocks_stages');
        const stages = stagesRaw ? JSON.parse(stagesRaw) : [];
        return highScore > 0 || (Array.isArray(stages) && stages.length > 0);
      } catch {
        return false;
      }
    },
    exportEnvelope: async (guestId) => {
      let saveData = null;
      try {
        if (typeof localStorage !== 'undefined') {
          const raw = localStorage.getItem(SAVE_KEY);
          if (raw) saveData = JSON.parse(raw);
          if (!saveData) {
            const highScore = Number(localStorage.getItem('auroblocks_high_score') || 0);
            const stages = JSON.parse(localStorage.getItem('auroblocks_stages') || '[]');
            const stageScores = JSON.parse(localStorage.getItem('auroblocks_stage_scores') || '{}');
            saveData = {
              highScore,
              stages,
              stageScores,
              updatedAt: new Date().toISOString()
            };
          }
        }
      } catch {}

      const hasProgress = Boolean(saveData && (saveData.highScore > 0 || (Array.isArray(saveData.stages) && saveData.stages.length > 0)));

      const payload = {
        schemaVersion: 1,
        save: saveData || null,
        exportedAt: new Date().toISOString()
      };

      let checksum;
      try {
        checksum = await computePayloadChecksum(payload);
      } catch {
        checksum = 'blocks_' + (saveData?.highScore || 0) + '_' + (saveData?.stages?.length || 0);
      }

      return {
        envelopeVersion: 1,
        gameId: 'auroblocks',
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
        const store = typeof localStorage !== 'undefined'
          ? localStorage
          : (typeof globalThis !== 'undefined' && globalThis.localStorage ? globalThis.localStorage : null);

        if (envelope.payload.save) {
          if (store && typeof store.setItem === 'function') {
            store.setItem(SAVE_KEY, JSON.stringify(envelope.payload.save));
            if (typeof envelope.payload.save.highScore === 'number') {
              store.setItem('auroblocks_high_score', String(envelope.payload.save.highScore));
            }
            if (Array.isArray(envelope.payload.save.stages)) {
              store.setItem('auroblocks_stages', JSON.stringify(envelope.payload.save.stages));
            }
            if (envelope.payload.save.stageScores) {
              store.setItem('auroblocks_stage_scores', JSON.stringify(envelope.payload.save.stageScores));
            }
          }
          return true;
        }
      } catch {}
      return false;
    },
    init: async (scopedContext) => {
      const guestId = scopedContext.getGuestId();
      if (guestId) {
        if (typeof window !== 'undefined') {
          window.__AUROMIND_GUEST_ID__ = guestId;
        }
      }
    }
  };
}

/**
 * Return to AuroMind Portal action.
 */
export function exitToAuroMindPortal() {
  try {
    if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
      const targetOrigin = (window.location.origin && window.location.origin !== 'null' && (window.location.origin.startsWith('http:') || window.location.origin.startsWith('https:')))
        ? window.location.origin
        : '*';
      window.parent.postMessage({
        type: 'AUROMIND_CLOSE_THEATER',
        gameId: 'auroblocks'
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

// Global attachment for convenience
if (typeof window !== 'undefined') {
  window.exitToAuroMindPortal = exitToAuroMindPortal;
}

/**
 * Mount floating Return to Portal button when running in theater mode.
 */
function mountPortalReturnButton() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  if (window.parent === window) return; // Only show in embedded iframe theater

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
 * Storage observer to synchronize save envelope and relay telemetry events.
 */
function attachStorageObserver(sdk) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  const originalSetItem = window.localStorage.setItem.bind(window.localStorage);

  window.localStorage.setItem = function (key, value) {
    originalSetItem(key, value);

    try {
      if (typeof key !== 'string' || !key.startsWith('auroblocks_')) return;

      // Consolidate into auroblocks_player_save_v1
      if (key === 'auroblocks_high_score' || key === 'auroblocks_stages' || key === 'auroblocks_stage_scores') {
        const highScore = Number(window.localStorage.getItem('auroblocks_high_score') || 0);
        const stages = JSON.parse(window.localStorage.getItem('auroblocks_stages') || '[]');
        const stageScores = JSON.parse(window.localStorage.getItem('auroblocks_stage_scores') || '{}');
        const savePayload = {
          highScore,
          stages,
          stageScores,
          updatedAt: new Date().toISOString()
        };
        originalSetItem(SAVE_KEY, JSON.stringify(savePayload));
      }

      // Relay telemetry on progression / score write
      if (sdk && sdk.telemetry && typeof sdk.telemetry.track === 'function') {
        if (key === 'auroblocks_high_score' && value) {
          const scoreNum = Number(value);
          if (scoreNum > 0) {
            sdk.telemetry.track(
              'score',
              { gameId: 'auroblocks', score: scoreNum },
              { category: 'progression', gameId: 'auroblocks' }
            );
          }
        } else if (key === 'auroblocks_stages' && value) {
          try {
            const stages = JSON.parse(value);
            if (Array.isArray(stages) && stages.length > 0) {
              const latestStage = stages[stages.length - 1];
              sdk.telemetry.track(
                'level_completed',
                { gameId: 'auroblocks', levelId: latestStage },
                { category: 'progression', gameId: 'auroblocks' }
              );
            }
          } catch {}
        }
      }

      // Relay postMessage to parent if embedded
      if (window.parent && window.parent !== window) {
        if (key === 'auroblocks_high_score' && value) {
          window.parent.postMessage({
            type: 'AUROMIND_LEVEL_COMPLETED',
            gameId: 'auroblocks',
            score: Number(value)
          }, window.location.origin);
        }
      }
    } catch (_syncErr) {}
  };
}

/**
 * Senior mode message listener.
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
    }
  });
}

/**
 * Self-initializing SDK Bridge lifecycle.
 */
(async function initAuroBlocksSdkBridge() {
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
        gameId: 'auroblocks',
        appVersion: '1.0.0'
      });

      const adapter = createAuroBlocksGameAdapter();
      if (sdk.adapters && typeof sdk.adapters.register === 'function') {
        sdk.adapters.register(adapter, { replace: true });
        if (!sdk.adapters.get('auroblocks')?.initialized && typeof sdk.adapters.init === 'function') {
          await sdk.adapters.init('auroblocks');
        }
      }

      const guestId = (sdk.identity && typeof sdk.identity.getGuestId === 'function')
        ? sdk.identity.getGuestId()
        : (ctx && ctx.identity ? ctx.identity.guestId : null);

      if (guestId) {
        window.__AUROMIND_GUEST_ID__ = guestId;
        console.info('[AuroBlocks] AuroMind shared platform guest identity established:', guestId);
      }

      attachStorageObserver(sdk);

      if (sdk.telemetry && typeof sdk.telemetry.track === 'function') {
        sdk.telemetry.track(
          'game_session_start',
          {
            gameId: 'auroblocks',
            appVersion: '1.0.0',
            mode: 'bridge'
          },
          { category: 'lifecycle', gameId: 'auroblocks' }
        );
      }

      if (sdk.logging && typeof sdk.logging.info === 'function') {
        sdk.logging.info('auroblocks', 'AuroBlocks bridge initialized with shared platform SDK', {
          guestId
        });
      }
    } else {
      const mock = createLocalMockBridge('auroblocks');
      if (typeof window !== 'undefined') {
        window.AuroMind = window.AuroMind || mock;
        window.AuroMindSDK = window.AuroMindSDK || mock;
      }
      attachStorageObserver(mock);
    }
  } catch (err) {
    const mock = createLocalMockBridge('auroblocks');
    if (typeof window !== 'undefined') {
      window.AuroMind = window.AuroMind || mock;
      window.AuroMindSDK = window.AuroMindSDK || mock;
    }
    attachStorageObserver(mock);
    console.warn('[AuroBlocks] AuroMind SDK bridge running in local mock fallback:', err && err.message ? err.message : err);
  }
})();
