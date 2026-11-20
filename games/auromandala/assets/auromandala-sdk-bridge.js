/**
 * AuroMind Shared Platform SDK — AuroMandala Safe Integration Bridge
 *
 * Provides the integration contract and adapter registration for AuroMandala
 * without performing risky manual modifications to the compiled production bundle.
 * Fully preserves local-only E2EE encryption for the Sankalpa vault and
 * all cached artwork, sessions, streaks, and stage progress.
 */

export function createAuroMandalaGameAdapter() {
  const CACHE_KEY = 'pranamandala_game_cache_v2';

  return {
    gameId: 'auromandala',
    adapterVersion: '1.0.0',
    contractVersion: 1,
    integrationMode: 'native',
    storage: {
      kind: 'ls',
      ownedDatabases: [],
      ownedLocalStorageKeys: [CACHE_KEY],
      localOnlyVaults: ['sankalpa_e2ee_vault']
    },
    capabilities: {
      offlinePlay: true,
      localPersistence: true,
      cloudSyncEligible: false, // Sankalpa vault is strictly local-only E2EE
      hasLocalOnlyVaults: true,
      localOnlyVaults: ['sankalpa_e2ee_vault']
    },
    hasLocalProgress: () => {
      try {
        if (typeof localStorage === 'undefined') return false;
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        return Boolean(
          parsed &&
          (parsed.highestStageCleared > 0 ||
           (Array.isArray(parsed.sessions) && parsed.sessions.length > 0) ||
           (Array.isArray(parsed.savedArtworks) && parsed.savedArtworks.length > 0))
        );
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

      const hasProgress = Boolean(
        cacheData &&
        (cacheData.highestStageCleared > 0 ||
         (Array.isArray(cacheData.sessions) && cacheData.sessions.length > 0) ||
         (Array.isArray(cacheData.savedArtworks) && cacheData.savedArtworks.length > 0))
      );

      // Safe export payload: NEVER includes plaintext Sankalpa secrets
      const payload = {
        schemaVersion: 2,
        cache: cacheData || null,
        exportedAt: new Date().toISOString()
      };

      return {
        envelopeVersion: 1,
        gameId: 'auromandala',
        gameSchemaVersion: 1,
        guestId,
        baseRevision: 0,
        clientUpdatedAt: new Date().toISOString(),
        isEmpty: !hasProgress,
        checksum: 'mandala_' + (cacheData?.highestStageCleared || 0) + '_' + (cacheData?.sessions?.length || 0),
        payload
      };
    },
    applyEnvelope: async (envelope) => {
      if (!envelope || !envelope.payload) return false;
      try {
        if (envelope.payload.cache && typeof localStorage !== 'undefined') {
          localStorage.setItem(CACHE_KEY, JSON.stringify(envelope.payload.cache));
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

(async function initAuroMandalaSdkBridge() {
  try {
    let sdk = window.AuroMind || (window.parent && window.parent.AuroMind);
    if (!sdk || typeof sdk.init !== 'function') {
      try {
        const mod = await import('../../assets/sdk/auromind-sdk.js');
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
