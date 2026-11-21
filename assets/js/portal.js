/**
 * AUROMIND PORTAL - INTERACTIVE CLIENT SCRIPT
 * Manages in-portal game theater, search, filters, senior mode, audio, and modals.
 */

const PORTAL_SDK_APP_VERSION = '2.5.0';
const PORTAL_PROTECTED_STORAGE_KEYS = new Set([
  'auromind.platform.v1.guest',
  'auromind.platform'
]);
const PORTAL_PROTECTED_STORAGE_PREFIX = 'auromind.platform.';

let portalBootstrapped = false;
let portalSdkInitPromise = null;
let portalSdkInitCount = 0;
let portalSdkContext = null;
let portalSdkError = null;

function isProtectedPlatformStorageKey(key) {
  if (typeof key !== 'string' || !key) return false;
  if (
    PORTAL_PROTECTED_STORAGE_KEYS.has(key) ||
    key.startsWith(PORTAL_PROTECTED_STORAGE_PREFIX)
  ) {
    return true;
  }
  try {
    if (
      window.AuroMind &&
      window.AuroMind.storage &&
      typeof window.AuroMind.storage.isProtectedKey === 'function' &&
      window.AuroMind.storage.isProtectedKey(key)
    ) {
      return true;
    }
  } catch (_err) {}
  return false;
}

function clearPortalPreferencesOnly(storage) {
  const store = storage || window.localStorage;
  if (!store) return [];

  const knownPortalPreferenceKeys = [
    'auromind_reduced_motion',
    'auromind_senior_mode',
    'auromind_ambient_volume',
    'auromind_guide_seen'
  ];

  const keysToRemove = new Set(knownPortalPreferenceKeys);
  try {
    for (let i = 0; i < store.length; i += 1) {
      const k = store.key(i);
      if (typeof k === 'string' && k.startsWith('auromind_')) {
        keysToRemove.add(k);
      }
    }
  } catch (_err) {}

  const removed = [];
  keysToRemove.forEach((key) => {
    // Strictly preserve shared platform identity keys (e.g. auromind.platform.v1.guest)
    // and never delete AuroMindPlatformDB or any game-owned IndexedDB/localStorage data.
    if (isProtectedPlatformStorageKey(key)) {
      return;
    }
    try {
      if (store.getItem(key) !== null) {
        removed.push(key);
      }
      store.removeItem(key);
    } catch (_err) {}
  });
  return removed;
}

function initPortalSDK() {
  if (portalSdkInitPromise) {
    return portalSdkInitPromise;
  }

  portalSdkInitPromise = (async () => {
    try {
      let sdk = window.AuroMind;
      if (!sdk || typeof sdk.init !== 'function') {
        try {
          const mod = await import('../sdk/auromind-sdk.js');
          sdk = (mod && (mod.AuroMind || mod.default)) || window.AuroMind;
        } catch (_importErr) {
          sdk = window.AuroMind;
        }
      }

      if (!sdk || typeof sdk.init !== 'function') {
        portalSdkError = new Error('AuroMind Shared SDK is unavailable');
        return null;
      }

      portalSdkInitCount += 1;
      let customProviders = {};
      try {
        const { createConfiguredProviders } = await import('../sdk/config/backend-config.js');
        const resolved = await createConfiguredProviders();
        if (resolved) {
          customProviders = resolved;
        }
      } catch {
        const sbConfig = window.__AUROMIND_SUPABASE_CONFIG__ || {
          supabaseUrl: window.AUROMIND_SUPABASE_URL || null,
          supabaseAnonKey: window.AUROMIND_SUPABASE_ANON_KEY || null
        };
        if (sbConfig.supabaseUrl && sbConfig.supabaseAnonKey) {
          const mod = await import('../sdk/providers/supabase/index.js');
          if (mod && mod.createSupabaseProviders) {
            customProviders = mod.createSupabaseProviders(sbConfig);
          }
        }
      }

      const ctx = await sdk.init({
        gameId: 'portal',
        appVersion: PORTAL_SDK_APP_VERSION,
        capabilities: {
          authEnabled: true,
          cloudSyncEnabled: true,
          entitlementsEnabled: true,
          analyticsEnabled: true,
          remoteConfigEnabled: true
        },
        providers: customProviders
      });
      portalSdkContext = ctx;
      portalSdkError = null;

      try {
        if (typeof trackWebsiteVisit === 'function') {
          trackWebsiteVisit();
        }
        if (sdk.logging && typeof sdk.logging.info === 'function') {
          sdk.logging.info('portal', 'Portal bootstrap complete', {
            appVersion: PORTAL_SDK_APP_VERSION,
            initCount: portalSdkInitCount
          });
        }
      } catch (_tErr) {}

      // Storage Resilience Amber Warning Banner & Export UI (TASK-ID-03)
      try {
        checkAndRenderStorageAmberBanner(sdk);
        if (sdk.identity && typeof sdk.identity.subscribe === 'function') {
          sdk.identity.subscribe(() => checkAndRenderStorageAmberBanner(sdk));
        }
      } catch (_bannerErr) {}

      return ctx;
    } catch (err) {
      portalSdkContext = null;
      portalSdkError = err;
      if (typeof console !== 'undefined' && typeof console.warn === 'function') {
        console.warn(
          '[AuroMind Portal] Shared SDK initialization could not complete:',
          err && err.message ? err.message : err
        );
      }
      return null;
    }
  })();

  return portalSdkInitPromise;
}

(function exposePortalBridge() {
  if (typeof window === 'undefined' || window.AuroMindPortal) return;
  const portalBridge = Object.freeze({
    ready: () => initPortalSDK(),
    isInitialized: () =>
      Boolean(
        window.AuroMind &&
          typeof window.AuroMind.isInitialized === 'function' &&
          window.AuroMind.isInitialized()
      ),
    getIdentity: () => {
      if (
        window.AuroMind &&
        window.AuroMind.identity &&
        typeof window.AuroMind.identity.get === 'function'
      ) {
        return window.AuroMind.identity.get();
      }
      return null;
    },
    getGuestId: () => {
      if (
        window.AuroMind &&
        window.AuroMind.identity &&
        typeof window.AuroMind.identity.getGuestId === 'function'
      ) {
        return window.AuroMind.identity.getGuestId();
      }
      return null;
    },
    getInitCount: () => portalSdkInitCount,
    getLastError: () => portalSdkError,
    isProtectedStorageKey: (key) => isProtectedPlatformStorageKey(key)
  });

  Object.defineProperty(window, 'AuroMindPortal', {
    value: portalBridge,
    writable: false,
    configurable: false,
    enumerable: true
  });
})();

// ==========================================================================
// WEBSITE ATTRIBUTION & CENTRALIZED ANALYTICS HELPERS
// ==========================================================================
function extractAttribution() {
  const params = new URLSearchParams((typeof window !== 'undefined' && window.location.search) || '');
  const utm = {};
  const utmKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
  for (const key of utmKeys) {
    const val = params.get(key);
    if (val) utm[key] = val.slice(0, 100);
  }
  let referrerDomain = null;
  if (typeof document !== 'undefined' && document.referrer) {
    try {
      const refUrl = new URL(document.referrer);
      // Strictly isolate domain; strip path, query, hash for privacy & zero credential leakage
      referrerDomain = refUrl.hostname || 'external';
    } catch {
      referrerDomain = 'external';
    }
  }
  return { utm, referrerDomain };
}

function trackWebsiteVisit() {
  if (!window.AuroMind || !window.AuroMind.telemetry) return;
  if (!window.AuroMind.telemetry.getConsent()) return;

  const { utm, referrerDomain } = extractAttribution();
  const resolution = typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : 'unknown';

  try {
    window.AuroMind.telemetry.track(
      'page_view',
      {
        path: (typeof window !== 'undefined' && window.location.pathname) || '/',
        title: (typeof document !== 'undefined' && document.title) || 'AuroMind',
        referrerDomain,
        ...utm
      },
      { category: 'ui', gameId: 'portal' }
    );

    window.AuroMind.telemetry.track(
      'portal_visit',
      {
        referrer: referrerDomain,
        screenResolution: resolution,
        hasCampaign: Object.keys(utm).length > 0,
        ...utm
      },
      { category: 'lifecycle', gameId: 'portal' }
    );
  } catch (_tErr) {}
}

function bootstrapPortal() {
  if (portalBootstrapped) return;
  portalBootstrapped = true;

  initPortalServiceWorker();
  initPortalSDK();
  initTheaterMode();
  initSidebarAndNavigation();
  initSearch();
  initSeniorMode();
  initAmbientAudio();
  initAuthModal();
  initSettingsModal();
  initAboutModal();
  initSanctuaryGuide();
  initFeedbackModal();
  initPurchaseBridge();
  initAnalyticsConsentBanner();
  initExitTracking();
}

document.addEventListener('DOMContentLoaded', bootstrapPortal);

// ==========================================================================
// 0. ROOT PORTAL SERVICE WORKER REGISTRATION
// ==========================================================================
function initPortalServiceWorker() {
  if ('serviceWorker' in navigator) {
    const registerSw = () => {
      navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
    };
    if (document.readyState === 'complete') {
      registerSw();
    } else {
      window.addEventListener('load', registerSw);
    }
  }
}

// ==========================================================================
// 1. IN-PORTAL GAME THEATER VIEW (KEEPS USERS INSIDE AUROMIND)
// ==========================================================================
function initTheaterMode() {
  const playButtons = document.querySelectorAll('.play-game-btn');
  const catalogScroll = document.querySelector('.portal-content-scroll');
  const theaterView = document.getElementById('game-theater-view');
  const theaterIframe = document.getElementById('game-viewport-iframe');
  const theaterTitle = document.getElementById('theater-game-title');
  const theaterIcon = document.getElementById('theater-game-icon');
  const backBtn = document.getElementById('theater-back-btn');
  const reloadBtn = document.getElementById('theater-reload-btn');
  const fullscreenBtn = document.getElementById('theater-fullscreen-btn');
  const edgeController = document.getElementById('game-edge-controller');
  const edgeTrigger = document.getElementById('edge-tab-trigger');

  if (edgeTrigger && edgeController) {
    edgeTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      edgeController.classList.toggle('open');
    });

    document.addEventListener('click', (e) => {
      if (edgeController.classList.contains('open') && !edgeController.contains(e.target)) {
        edgeController.classList.remove('open');
      }
    });
  }

  const gameUrls = {
    'vak': 'games/vak/index.html',
    'vak-sanctuary': 'games/vak-living-sanctuary/index.html',
    'auromatch': 'games/auromatch/index.html',
    'wordriddle': 'games/word-riddle/index.html',
    'auromandala': 'games/auromandala/index.html',
    'auroblocks': 'games/auroblocks/index.html'
  };

  let activeGameStartTime = null;
  let currentActiveGame = null;
  let ambientAudioWasPlaying = false;

  function openGameInTheater(gameId, title, icon) {
    const url = gameUrls[gameId];
    if (!url) return;

    activeGameStartTime = Date.now();
    currentActiveGame = gameId;

    ambientAudioWasPlaying = (typeof window.isAmbientAudioPlaying === 'function') && window.isAmbientAudioPlaying();

    // Suspend portal 432 Hz ambient audio so it does not collide with child game audio
    if (typeof window.suspendAmbientAudio === 'function') {
      window.suspendAmbientAudio();
    }

    if (theaterTitle) theaterTitle.textContent = title || 'AuroMind Game';
    if (theaterIcon && icon) theaterIcon.src = icon;
    
    // Enter True Game Mode: hides portal header & sidebar for 100% viewport height
    document.body.classList.add('in-game-mode');

    // Load into iframe (mock client-side license pass dispatch disabled)
    if (theaterIframe) {
      theaterIframe.onload = () => {
        try {
          if (theaterIframe.contentWindow) {
            theaterIframe.contentWindow.postMessage(
              { type: 'AUROMIND_SET_SENIOR_MODE', enabled: document.body.classList.contains('senior-mode') },
              '*'
            );
          }
        } catch (e) {}
      };
      theaterIframe.src = url;
    }

    // Transition view
    if (catalogScroll) catalogScroll.style.display = 'none';
    if (theaterView) theaterView.style.display = 'block';

    // Update browser history state without leaving page or exposing sub-url
    history.pushState({ inGame: true, gameId }, title, `#play-${gameId}`);

    try {
      if (window.AuroMind && window.AuroMind.telemetry) {
        window.AuroMind.telemetry.track(
          'game_launch',
          {
            gameId,
            title: title || gameId,
            launchContext: 'theater'
          },
          { category: 'engagement', gameId }
        );
        window.AuroMind.telemetry.track(
          'game_session_start',
          {
            gameId,
            title: title || gameId
          },
          { category: 'engagement', gameId }
        );
      }
      if (window.AuroMind && window.AuroMind.logging) {
        window.AuroMind.logging.info('portal', `Launching game in theater: ${gameId}`, {
          gameId,
          title
        });
      }
    } catch (_tErr) {}
  }

  function closeTheater() {
    // Exit True Game Mode
    document.body.classList.remove('in-game-mode');
    if (edgeController) edgeController.classList.remove('open');

    // Unload iframe to stop audio and clean memory
    if (theaterIframe) theaterIframe.src = 'about:blank';

    if (theaterView) theaterView.style.display = 'none';
    if (catalogScroll) catalogScroll.style.display = 'flex';

    if (window.location.hash.startsWith('#play-')) {
      history.pushState({ inGame: false }, 'AuroMind', window.location.pathname);
    }

    // Resume ambient audio if it was playing prior to entering theater
    if (ambientAudioWasPlaying) {
      if (typeof window.resumeAmbientAudio === 'function') {
        window.resumeAmbientAudio();
      }
      ambientAudioWasPlaying = false;
    }

    try {
      if (activeGameStartTime && currentActiveGame) {
        const durationSeconds = Math.max(1, Math.round((Date.now() - activeGameStartTime) / 1000));
        if (window.AuroMind && window.AuroMind.telemetry) {
          window.AuroMind.telemetry.track(
            'game_session_end',
            {
              gameId: currentActiveGame,
              durationSeconds
            },
            { category: 'engagement', gameId: currentActiveGame }
          );
        }
        activeGameStartTime = null;
        currentActiveGame = null;
      }

      if (window.AuroMind && window.AuroMind.telemetry) {
        window.AuroMind.telemetry.track(
          'theater_close',
          {
            action: 'back_to_catalog'
          },
          { category: 'engagement', gameId: 'portal' }
        );
      }
      if (window.AuroMind && window.AuroMind.logging) {
        window.AuroMind.logging.info('portal', 'Closed game theater, returned to catalog');
      }
    } catch (_tErr) {}
  }

  // Play button click handlers
  playButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const gameId = btn.dataset.gameId;
      const title = btn.dataset.title;
      const icon = btn.dataset.icon;
      try {
        if (window.AuroMind && window.AuroMind.telemetry) {
          window.AuroMind.telemetry.track(
            'game_select',
            {
              gameId,
              title: title || gameId,
              source: 'catalog_grid'
            },
            { category: 'engagement', gameId }
          );
        }
      } catch (_tErr) {}
      openGameInTheater(gameId, title, icon);
    });
  });

  // Back to Catalog handler
  if (backBtn) {
    backBtn.addEventListener('click', closeTheater);
  }

  // Reload handler
  if (reloadBtn) {
    reloadBtn.addEventListener('click', () => {
      if (theaterIframe && theaterIframe.src !== 'about:blank') {
        const currentSrc = theaterIframe.src;
        theaterIframe.src = 'about:blank';
        setTimeout(() => { theaterIframe.src = currentSrc; }, 100);
      }
    });
  }

  // Fullscreen toggle handler
  if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', () => {
      const container = document.querySelector('.theater-iframe-container');
      if (!container) return;

      if (!document.fullscreenElement) {
        if (container.requestFullscreen) {
          container.requestFullscreen();
        } else if (container.webkitRequestFullscreen) {
          container.webkitRequestFullscreen();
        }
      } else {
        if (document.exitFullscreen) {
          document.exitFullscreen();
        }
      }
    });
  }

  // Track child game load error if iframe fails
  if (theaterIframe) {
    theaterIframe.addEventListener('error', () => {
      try {
        if (window.AuroMind && window.AuroMind.telemetry && currentActiveGame) {
          window.AuroMind.telemetry.track(
            'game_load_error',
            {
              gameId: currentActiveGame,
              errorType: 'iframe_load_failure'
            },
            { category: 'error', gameId: currentActiveGame }
          );
        }
      } catch (_tErr) {}
    });
  }

  // Listen to HTML5 PostMessage from child game iframes (Vak, AuroMatch, etc.)
  window.addEventListener('message', (event) => {
    // 1. Mandatory Source Validation: message MUST originate from active theater iframe contentWindow
    if (!theaterIframe || event.source !== theaterIframe.contentWindow) return;

    // 2. Origin Validation: exact match for standard origins, permit 'null' for opaque sandboxed contexts
    const isSameOrigin = (event.origin === window.location.origin);
    const isOpaqueOrigin = (event.origin === 'null' || event.origin === '');
    if (!isSameOrigin && !isOpaqueOrigin) return;

    const data = event.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return;

    const activeGameId = history.state?.inGame ? history.state.gameId : null;
    if (!activeGameId || !gameUrls[activeGameId]) return;

    if (data.type === 'AUROMIND_CLOSE_THEATER' || data.action === 'EXIT_GAME') {
      closeTheater();
      return;
    }

    // Telemetry and gameplay event relay from child game iframes
    if (data.type === 'AUROMIND_TELEMETRY_TRACK' && data.eventName) {
      if (window.AuroMind && window.AuroMind.telemetry) {
        window.AuroMind.telemetry.track(
          data.eventName,
          { ...(data.payload || {}), gameId: data.gameId || activeGameId },
          { category: data.category || 'engagement', gameId: data.gameId || activeGameId }
        );
      }
      return;
    }

    if (data.type === 'AUROMIND_LEVEL_ATTEMPT') {
      if (window.AuroMind && window.AuroMind.telemetry) {
        window.AuroMind.telemetry.track(
          'level_attempt',
          {
            gameId: data.gameId || activeGameId,
            levelId: data.levelId ?? data.level ?? 1,
            attemptNumber: data.attemptNumber || 1
          },
          { category: 'progression', gameId: data.gameId || activeGameId }
        );
      }
      return;
    }

    if (data.type === 'AUROMIND_LEVEL_COMPLETED') {
      if (window.AuroMind && window.AuroMind.telemetry) {
        window.AuroMind.telemetry.track(
          'level_completed',
          {
            gameId: data.gameId || activeGameId,
            levelId: data.levelId ?? data.level ?? 1,
            score: data.score || 0,
            durationSeconds: data.durationSeconds || 0
          },
          { category: 'progression', gameId: data.gameId || activeGameId }
        );
      }
      return;
    }

    if (data.type === 'AUROMIND_LEVEL_FAILED') {
      if (window.AuroMind && window.AuroMind.telemetry) {
        window.AuroMind.telemetry.track(
          'level_failed',
          {
            gameId: data.gameId || activeGameId,
            levelId: data.levelId ?? data.level ?? 1,
            reason: data.reason || 'timeout_or_mistake'
          },
          { category: 'progression', gameId: data.gameId || activeGameId }
        );
      }
      return;
    }

    if (data.type === 'AUROMIND_GAME_ERROR' || data.type === 'AUROMIND_TELEMETRY_ERROR') {
      if (window.AuroMind && window.AuroMind.telemetry) {
        window.AuroMind.telemetry.track(
          'game_runtime_error',
          {
            gameId: data.gameId || activeGameId,
            errorMessage: String(data.errorMessage || data.message || 'Unknown runtime error').slice(0, 200),
            errorCategory: data.errorCategory || 'runtime'
          },
          { category: 'error', gameId: data.gameId || activeGameId }
        );
      }
      return;
    }

    if (data.type !== 'AUROMIND_REQUEST_PURCHASE') return;

    const purchaseTitles = {
      vak: 'VAK — The Control of Speech',
      auromatch: 'AuroMatch — Zen Tile Solitaire'
    };

    if (!Object.prototype.hasOwnProperty.call(purchaseTitles, activeGameId)) return;
    if (data.gameId !== activeGameId) return;

    if (typeof window.openPurchaseModal === 'function') {
      window.openPurchaseModal(activeGameId, purchaseTitles[activeGameId]);
    }
  });

  // Auto-launch game if arrived via deep link or standalone redirect (e.g., #play-vak or #play-auromatch)
  if (window.location.hash.startsWith('#play-')) {
    const deepGameId = window.location.hash.replace('#play-', '').trim();
    const deepBtn = document.querySelector(`.play-game-btn[data-game-id="${deepGameId}"]`);
    if (deepBtn) {
      setTimeout(() => {
        deepBtn.click();
      }, 80);
    }
  }

  // Listen to browser Back button
  window.addEventListener('popstate', (e) => {
    if (!e.state || !e.state.inGame) {
      closeTheater();
    }
  });
}

// ==========================================================================
// 2. SIDEBAR NAVIGATION & CATEGORY FILTERING (16 TITLES)
// ==========================================================================
function initSidebarAndNavigation() {
  const sidebar = document.getElementById('portal-sidebar');
  const menuToggle = document.getElementById('menu-toggle-btn');
  const navItems = document.querySelectorAll('.sidebar-nav-item[data-category]');
  const cards = document.querySelectorAll('.game-card');

  // Reconcile sidebar "All Games" count dynamically with actual unique catalogue cards (B17-GAP-02)
  const allGamesSpan = document.querySelector('.sidebar-nav-item[data-category="all"] span:last-child');
  if (allGamesSpan && cards.length > 0) {
    allGamesSpan.textContent = `All Games (${cards.length})`;
  }

  if (menuToggle && sidebar) {
    menuToggle.addEventListener('click', () => {
      sidebar.classList.toggle('open');
    });

    document.addEventListener('click', (e) => {
      if (window.innerWidth < 680 && 
          sidebar.classList.contains('open') && 
          !sidebar.contains(e.target) && 
          e.target !== menuToggle) {
        sidebar.classList.remove('open');
      }
    });
  }

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      navItems.forEach(i => i.classList.remove('active'));
      item.classList.add('active');

      const filterCategory = item.dataset.category;

      try {
        if (window.AuroMind && window.AuroMind.telemetry && window.AuroMind.telemetry.getConsent()) {
          window.AuroMind.telemetry.track(
            'catalog_filter',
            { category: filterCategory },
            { category: 'ui', gameId: 'portal' }
          );
        }
      } catch (_tErr) {}

      cards.forEach(card => {
        const cardCategory = (card.dataset.category || '').toLowerCase();
        if (filterCategory === 'all' || cardCategory.includes(filterCategory)) {
          card.style.display = 'flex';
        } else {
          card.style.display = 'none';
        }
      });

      document.querySelectorAll('.section-block').forEach(section => {
        const visibleCards = section.querySelectorAll('.game-card[style*="display: flex"]');
        const hiddenCards = section.querySelectorAll('.game-card[style*="display: none"]');
        if (filterCategory !== 'all' && visibleCards.length === 0 && hiddenCards.length > 0) {
          section.style.display = 'none';
        } else {
          section.style.display = 'flex';
        }
      });

      if (window.innerWidth < 680 && sidebar) {
        sidebar.classList.remove('open');
      }
    });
  });
}

// ==========================================================================
// 3. LIVE SEARCH (ALL 16 GAMES)
// ==========================================================================
function initSearch() {
  const searchInput = document.getElementById('search-input');
  const cards = document.querySelectorAll('.game-card');
  let searchDebounceTimer = null;

  if (!searchInput) return;

  searchInput.addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();

    clearTimeout(searchDebounceTimer);
    if (q.length >= 2) {
      searchDebounceTimer = setTimeout(() => {
        try {
          if (window.AuroMind && window.AuroMind.telemetry && window.AuroMind.telemetry.getConsent()) {
            window.AuroMind.telemetry.track(
              'catalog_search',
              { queryLength: q.length },
              { category: 'ui', gameId: 'portal' }
            );
          }
        } catch (_tErr) {}
      }, 500);
    }

    cards.forEach(card => {
      const title = (card.dataset.title || '').toLowerCase();
      const genre = (card.dataset.genre || '').toLowerCase();
      const usp = (card.dataset.usp || '').toLowerCase();

      if (!q || title.includes(q) || genre.includes(q) || usp.includes(q)) {
        card.style.display = 'flex';
      } else {
        card.style.display = 'none';
      }
    });

    document.querySelectorAll('.section-block').forEach(section => {
      const visibleCards = section.querySelectorAll('.game-card:not([style*="display: none"])');
      section.style.display = visibleCards.length > 0 ? 'flex' : 'none';
    });
  });
}

// ==========================================================================
// 4. SENIOR ACCESSIBILITY MODE TOGGLE
// ==========================================================================
function initSeniorMode() {
  const seniorBtn = document.getElementById('senior-mode-btn');
  const sidebarSeniorBtn = document.getElementById('sidebar-senior-btn');
  const seniorToggle = document.getElementById('settings-senior-toggle');

  function applySeniorMode(isActive, persist = true) {
    document.body.classList.toggle('senior-mode', isActive);

    if (seniorBtn) {
      seniorBtn.classList.toggle('active', isActive);
      const labelSpan = seniorBtn.querySelector('span:last-child');
      if (labelSpan) {
        labelSpan.textContent = isActive ? 'Senior: ON' : 'Senior View';
      }
    }
    if (sidebarSeniorBtn) {
      sidebarSeniorBtn.classList.toggle('active', isActive);
    }
    if (seniorToggle) {
      seniorToggle.checked = isActive;
    }

    if (persist) {
      try {
        localStorage.setItem('auromind_senior_mode', isActive ? 'true' : 'false');
      } catch (err) {}
    }

    // Broadcast Senior Mode state to active theater iframe
    const activeIframe = document.getElementById('game-viewport-iframe') || document.getElementById('game-theater-iframe');
    if (activeIframe && activeIframe.contentWindow) {
      try {
        activeIframe.contentWindow.postMessage(
          { type: 'AUROMIND_SET_SENIOR_MODE', enabled: isActive },
          '*'
        );
      } catch (err) {}
    }
  }

  window.applySeniorMode = applySeniorMode;

  // Restore saved Senior Mode preference on load
  try {
    const savedSenior = localStorage.getItem('auromind_senior_mode') === 'true';
    applySeniorMode(savedSenior, false);
  } catch (err) {}

  function toggleSeniorMode() {
    const nextState = !document.body.classList.contains('senior-mode');
    applySeniorMode(nextState, true);
  }

  if (seniorBtn) seniorBtn.addEventListener('click', toggleSeniorMode);
  if (sidebarSeniorBtn) sidebarSeniorBtn.addEventListener('click', toggleSeniorMode);
}

// ==========================================================================
// 5. AMBIENT 432 Hz AUDIO (WEB AUDIO API)
// ==========================================================================
function initAmbientAudio() {
  const audioBtn = document.getElementById('ambient-audio-btn');
  if (!audioBtn) return;

  let audioCtx = null;
  let oscillator = null;
  let gainNode = null;
  let isPlaying = false;
  let currentVolume = 0.035;

  function stopAmbientAudio() {
    if (!isPlaying) return;
    isPlaying = false;
    audioBtn.classList.remove('active');
    const activeOsc = oscillator;
    oscillator = null;
    if (gainNode && audioCtx) {
      try {
        gainNode.gain.linearRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);
      } catch (e) {}
    }
    setTimeout(() => {
      if (activeOsc) {
        try {
          activeOsc.stop();
          activeOsc.disconnect();
        } catch (e) {}
      }
    }, 260);
  }

  window.isAmbientAudioPlaying = () => isPlaying;
  window.suspendAmbientAudio = stopAmbientAudio;
  window.resumeAmbientAudio = startAmbientAudio;

  window.setAmbientVolume = (volRatio) => {
    const clampedRatio = Math.max(0, Math.min(1, Number.isFinite(volRatio) ? volRatio : 0.5));
    currentVolume = clampedRatio * 0.07;
    document.body.dataset.ambientVolume = String(Math.round(clampedRatio * 100));
    document.body.classList.toggle('ambient-muted', clampedRatio === 0);
    if (gainNode && audioCtx && isPlaying) {
      gainNode.gain.setValueAtTime(Math.max(0.0001, currentVolume), audioCtx.currentTime);
    }
  };

  // Restore saved Ambient Volume preference on load
  try {
    const rawSavedVolume = localStorage.getItem('auromind_ambient_volume');
    if (rawSavedVolume !== null) {
      const parsedVol = parseFloat(rawSavedVolume);
      if (Number.isFinite(parsedVol)) {
        const clampedVol = Math.max(0, Math.min(100, parsedVol));
        window.setAmbientVolume(clampedVol / 100);
        const volumeSlider = document.getElementById('settings-volume-slider');
        if (volumeSlider) {
          volumeSlider.value = String(clampedVol);
        }
      }
    } else {
      document.body.dataset.ambientVolume = '50';
    }
  } catch (err) {}

  function startAmbientAudio() {
    if (isPlaying) return;
    if (!audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioContext();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    oscillator = audioCtx.createOscillator();
    gainNode = audioCtx.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(432, audioCtx.currentTime);

    gainNode.gain.setValueAtTime(0.001, audioCtx.currentTime);
    gainNode.gain.linearRampToValueAtTime(Math.max(0.0001, currentVolume), audioCtx.currentTime + 1);

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.start();
    isPlaying = true;
    audioBtn.classList.add('active');
  }

  audioBtn.addEventListener('click', () => {
    if (!audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioContext();
    }

    if (isPlaying) {
      stopAmbientAudio();
    } else {
      startAmbientAudio();
    }
  });
}

// ==========================================================================
// 6. AUTH & ACCOUNT MODAL (B5 SUPABASE INTEGRATION)
// ==========================================================================
function initAuthModal() {
  const authBtn = document.getElementById('auth-btn');
  const modal = document.getElementById('auth-modal');
  const closeBtn = document.getElementById('modal-close-btn');
  const confirmBtn = document.getElementById('modal-confirm-btn');

  const modeBadge = document.getElementById('auth-mode-badge');
  const userIdentity = document.getElementById('auth-user-identity');
  const userEmail = document.getElementById('auth-user-email');
  const formContainer = document.getElementById('auth-form-container');
  const emailInput = document.getElementById('auth-email-input');
  const passwordInput = document.getElementById('auth-password-input');
  const signInBtn = document.getElementById('auth-signin-btn');
  const signUpBtn = document.getElementById('auth-signup-btn');
  const upgradeBtn = document.getElementById('auth-upgrade-btn');
  const syncToggle = document.getElementById('auth-sync-toggle');
  const syncNowBtn = document.getElementById('auth-sync-now-btn');
  const syncStatusMsg = document.getElementById('auth-sync-status-msg');
  const signedInActions = document.getElementById('auth-signed-in-actions');
  const signOutBtn = document.getElementById('auth-signout-btn');
  const notificationMsg = document.getElementById('auth-notification-msg');

  if (!authBtn || !modal) return;

  function showNotification(message, isError = false) {
    if (!notificationMsg) return;
    notificationMsg.textContent = message;
    notificationMsg.style.display = 'block';
    if (isError) {
      notificationMsg.style.background = 'rgba(239, 68, 68, 0.12)';
      notificationMsg.style.color = '#dc2626';
      notificationMsg.style.border = '1px solid rgba(239, 68, 68, 0.25)';
    } else {
      notificationMsg.style.background = 'rgba(16, 185, 129, 0.12)';
      notificationMsg.style.color = '#059669';
      notificationMsg.style.border = '1px solid rgba(16, 185, 129, 0.25)';
    }
  }

  function clearNotification() {
    if (notificationMsg) {
      notificationMsg.textContent = '';
      notificationMsg.style.display = 'none';
    }
  }

  function updateAuthUI() {
    const sdk = window.AuroMind;
    const account = sdk && sdk.auth && typeof sdk.auth.getAccount === 'function' ? sdk.auth.getAccount() : null;
    const guestId = sdk && sdk.identity && typeof sdk.identity.getGuestId === 'function' ? sdk.identity.getGuestId() : null;

    if (account && account.userId) {
      // Authenticated Mode
      if (modeBadge) {
        modeBadge.textContent = 'Authenticated';
        modeBadge.style.background = 'rgba(16, 185, 129, 0.15)';
        modeBadge.style.color = '#059669';
      }
      if (userIdentity) userIdentity.textContent = `User ID: ${account.userId}`;
      if (userEmail) {
        userEmail.textContent = account.email ? `Signed in as: ${account.email}` : '';
        userEmail.style.display = account.email ? 'block' : 'none';
      }
      if (formContainer) formContainer.style.display = 'none';
      if (signedInActions) signedInActions.style.display = 'block';

      const shortName = account.email ? account.email.split('@')[0] : 'Account';
      authBtn.textContent = '';
      const iconSpan = document.createElement('span');
      iconSpan.textContent = '👤';
      const labelSpan = document.createElement('span');
      labelSpan.textContent = shortName;
      authBtn.appendChild(iconSpan);
      authBtn.appendChild(labelSpan);
    } else {
      // Guest Mode
      if (modeBadge) {
        modeBadge.textContent = 'Guest Mode';
        modeBadge.style.background = 'rgba(245, 158, 11, 0.15)';
        modeBadge.style.color = '#d97706';
      }
      if (userIdentity) userIdentity.textContent = guestId ? `Guest ID: ${guestId}` : 'Guest ID: initializing...';
      if (userEmail) userEmail.style.display = 'none';
      if (formContainer) formContainer.style.display = 'block';
      if (signedInActions) signedInActions.style.display = 'none';

      authBtn.textContent = '';
      const iconSpan = document.createElement('span');
      iconSpan.textContent = '👤';
      const labelSpan = document.createElement('span');
      labelSpan.textContent = 'Account';
      authBtn.appendChild(iconSpan);
      authBtn.appendChild(labelSpan);
    }

    if (syncToggle && sdk && sdk.sync) {
      syncToggle.checked = Boolean(sdk.sync.hasConsent && sdk.sync.hasConsent());
    }

    if (syncStatusMsg && sdk && sdk.sync) {
      const status = typeof sdk.sync.getSyncStatus === 'function' ? sdk.sync.getSyncStatus() : null;
      if (status && status.lastSyncAt) {
        const d = new Date(status.lastSyncAt);
        syncStatusMsg.textContent = `Last sync: ${d.toLocaleTimeString()}`;
      } else {
        syncStatusMsg.textContent = 'Sync idle';
      }
    }
  }

  const openModal = () => {
    clearNotification();
    updateAuthUI();
    modal.classList.add('open');
  };
  const closeModal = () => modal.classList.remove('open');

  authBtn.addEventListener('click', openModal);
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (confirmBtn) confirmBtn.addEventListener('click', closeModal);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  // Wire Sign In
  if (signInBtn) {
    signInBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      clearNotification();
      const email = emailInput ? emailInput.value.trim() : '';
      const password = passwordInput ? passwordInput.value : '';
      if (!email || !password) {
        showNotification('Please enter both email and password.', true);
        return;
      }
      signInBtn.disabled = true;
      signInBtn.textContent = 'Signing in...';
      try {
        const sdk = window.AuroMind;
        if (!sdk || !sdk.auth) throw new Error('AuroMind Auth is unavailable.');
        const res = await sdk.auth.signInWithEmail(email, password);
        if (res && res.ok) {
          showNotification('Successfully signed in!');
          updateAuthUI();
        } else {
          showNotification(res?.message || 'Sign in failed.', true);
        }
      } catch (err) {
        showNotification(err.message || 'Network error occurred.', true);
      } finally {
        signInBtn.disabled = false;
        signInBtn.textContent = 'Sign In';
      }
    });
  }

  // Wire Sign Up
  if (signUpBtn) {
    signUpBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      clearNotification();
      const email = emailInput ? emailInput.value.trim() : '';
      const password = passwordInput ? passwordInput.value : '';
      if (!email || !password) {
        showNotification('Please enter both email and password.', true);
        return;
      }
      signUpBtn.disabled = true;
      signUpBtn.textContent = 'Creating...';
      try {
        const sdk = window.AuroMind;
        if (!sdk || !sdk.auth) throw new Error('AuroMind Auth is unavailable.');
        const res = await sdk.auth.signUp({ email, password });
        if (res && res.ok) {
          showNotification('Account created successfully! Check email for confirmation if required.');
          updateAuthUI();
        } else {
          showNotification(res?.message || 'Account creation failed.', true);
        }
      } catch (err) {
        showNotification(err.message || 'Error creating account.', true);
      } finally {
        signUpBtn.disabled = false;
        signUpBtn.textContent = 'Create Account';
      }
    });
  }

  // Wire Upgrade Guest to Account
  if (upgradeBtn) {
    upgradeBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      clearNotification();
      const email = emailInput ? emailInput.value.trim() : '';
      const password = passwordInput ? passwordInput.value : '';
      if (!email || !password) {
        showNotification('Enter email and password to link your current guest progress.', true);
        return;
      }
      upgradeBtn.disabled = true;
      upgradeBtn.textContent = 'Linking guest progress...';
      try {
        const sdk = window.AuroMind;
        if (!sdk || !sdk.auth) throw new Error('AuroMind Auth is unavailable.');
        const res = await sdk.auth.upgradeGuestToAccount(
          { email, password },
          { enableCloudSync: syncToggle ? syncToggle.checked : false }
        );
        if (res && res.ok) {
          showNotification('Guest progress successfully linked to your new account!');
          updateAuthUI();
        } else {
          showNotification(res?.message || 'Guest upgrade failed.', true);
        }
      } catch (err) {
        showNotification(err.message || 'Error linking guest progress.', true);
      } finally {
        upgradeBtn.disabled = false;
        upgradeBtn.textContent = '⭐ Link Current Guest Progress to New Account';
      }
    });
  }

  // Wire Sign Out
  if (signOutBtn) {
    signOutBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      clearNotification();
      signOutBtn.disabled = true;
      try {
        const sdk = window.AuroMind;
        if (sdk && sdk.auth) {
          await sdk.auth.signOut();
        }
        showNotification('Signed out. Local guest progress preserved.');
        updateAuthUI();
      } catch (err) {
        showNotification(err.message || 'Sign out failed.', true);
      } finally {
        signOutBtn.disabled = false;
      }
    });
  }

  // Wire Cloud Sync Toggle
  if (syncToggle) {
    syncToggle.addEventListener('change', () => {
      const sdk = window.AuroMind;
      if (sdk && sdk.sync && typeof sdk.sync.setConsent === 'function') {
        sdk.sync.setConsent(syncToggle.checked);
        showNotification(`Cloud sync ${syncToggle.checked ? 'enabled' : 'disabled'}.`);
        updateAuthUI();
      }
    });
  }

  // Wire Sync Now
  if (syncNowBtn) {
    syncNowBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      clearNotification();
      syncNowBtn.disabled = true;
      syncNowBtn.textContent = 'Syncing...';
      try {
        const sdk = window.AuroMind;
        if (!sdk || !sdk.sync) throw new Error('AuroMind Sync is unavailable.');
        const res = await sdk.sync.syncNow();
        if (res && res.status === 'success') {
          showNotification('Cloud save synchronization completed successfully!');
        } else if (res && res.status === 'skipped') {
          showNotification(`Sync skipped: ${res.reason}`, true);
        } else {
          showNotification('Sync completed with warnings. Check diagnostics for details.', true);
        }
        updateAuthUI();
      } catch (err) {
        showNotification(err.message || 'Sync failed.', true);
      } finally {
        syncNowBtn.disabled = false;
        syncNowBtn.textContent = 'Sync Now 🔄';
      }
    });
  }

  // Subscribe to identity changes
  if (window.AuroMind && window.AuroMind.identity && typeof window.AuroMind.identity.subscribe === 'function') {
    window.AuroMind.identity.subscribe(updateAuthUI);
  }
}

// ==========================================================================
// 7. SETTINGS MODAL & CONTROLS
// ==========================================================================
function initSettingsModal() {
  const settingsBtn = document.getElementById('sidebar-settings-btn');
  const modal = document.getElementById('settings-modal');
  const closeBtn = document.getElementById('settings-close-btn');
  const confirmBtn = document.getElementById('settings-confirm-btn');
  const sidebar = document.getElementById('portal-sidebar');

  const volumeSlider = document.getElementById('settings-volume-slider');
  const seniorToggle = document.getElementById('settings-senior-toggle');
  const motionToggle = document.getElementById('settings-motion-toggle');
  const telemetryToggle = document.getElementById('settings-telemetry-toggle');
  const resetBtn = document.getElementById('settings-reset-btn');

  function applyReducedMotion(isReduced, persist = true) {
    document.documentElement.classList.toggle('reduced-motion', isReduced);
    document.body.classList.toggle('reduced-motion', isReduced);
    if (motionToggle) {
      motionToggle.checked = isReduced;
    }
    if (persist) {
      try {
        localStorage.setItem('auromind_reduced_motion', isReduced ? 'true' : 'false');
      } catch (err) {}
    }
  }

  // Restore saved Reduced Motion and Ambient Volume controls on load
  try {
    const savedMotion = localStorage.getItem('auromind_reduced_motion') === 'true';
    applyReducedMotion(savedMotion, false);

    const rawSavedVolume = localStorage.getItem('auromind_ambient_volume');
    if (rawSavedVolume !== null && volumeSlider) {
      const parsedVol = parseFloat(rawSavedVolume);
      if (Number.isFinite(parsedVol)) {
        const clampedVol = Math.max(0, Math.min(100, parsedVol));
        volumeSlider.value = String(clampedVol);
        if (window.setAmbientVolume) {
          window.setAmbientVolume(clampedVol / 100);
        }
      }
    }
  } catch (err) {}

  if (!settingsBtn || !modal) return;

  const openModal = () => {
    // Sync current Senior Mode state
    if (seniorToggle) {
      seniorToggle.checked = document.body.classList.contains('senior-mode');
    }
    // Sync reduced motion
    if (motionToggle) {
      motionToggle.checked =
        document.documentElement.classList.contains('reduced-motion') ||
        document.body.classList.contains('reduced-motion');
    }
    // Sync telemetry consent state
    if (telemetryToggle && window.AuroMind && window.AuroMind.telemetry) {
      try {
        telemetryToggle.checked = window.AuroMind.telemetry.getConsent();
      } catch (_tErr) {}
    }
    modal.classList.add('open');
    if (window.innerWidth < 680 && sidebar) {
      sidebar.classList.remove('open');
    }
  };

  const closeModal = () => modal.classList.remove('open');

  settingsBtn.addEventListener('click', (e) => {
    e.preventDefault();
    openModal();
  });

  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (confirmBtn) confirmBtn.addEventListener('click', closeModal);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  // Senior Mode Toggle inside Settings
  if (seniorToggle) {
    seniorToggle.addEventListener('change', () => {
      if (typeof window.applySeniorMode === 'function') {
        window.applySeniorMode(seniorToggle.checked, true);
      } else {
        document.body.classList.toggle('senior-mode', seniorToggle.checked);
        try {
          localStorage.setItem('auromind_senior_mode', seniorToggle.checked ? 'true' : 'false');
        } catch (err) {}
      }
      try {
        if (window.AuroMind && window.AuroMind.player) {
          window.AuroMind.player.updatePreferences({ seniorMode: seniorToggle.checked });
        }
      } catch (_pErr) {}
    });
  }

  // Reduced Motion Toggle
  if (motionToggle) {
    motionToggle.addEventListener('change', () => {
      applyReducedMotion(motionToggle.checked, true);
      try {
        if (window.AuroMind && window.AuroMind.player) {
          window.AuroMind.player.updatePreferences({ reducedMotion: motionToggle.checked });
        }
      } catch (_pErr) {}
    });
  }

  // Anonymous Telemetry Toggle
  if (telemetryToggle) {
    telemetryToggle.addEventListener('change', () => {
      try {
        if (window.AuroMind && window.AuroMind.telemetry) {
          window.AuroMind.telemetry.setConsent(telemetryToggle.checked);
        }
      } catch (_tErr) {}
    });
  }

  // Volume slider
  if (volumeSlider) {
    const handleVolumeChange = (e) => {
      const rawVal = parseFloat(e.target.value);
      const clampedVal = Number.isFinite(rawVal) ? Math.max(0, Math.min(100, rawVal)) : 50;
      if (window.setAmbientVolume) {
        window.setAmbientVolume(clampedVal / 100);
      }
      try {
        localStorage.setItem('auromind_ambient_volume', String(clampedVal));
      } catch (err) {}
      try {
        if (window.AuroMind && window.AuroMind.player) {
          window.AuroMind.player.updatePreferences({ ambientVolume: clampedVal / 100 });
        }
      } catch (_pErr) {}
    };
    volumeSlider.addEventListener('input', handleVolumeChange);
    volumeSlider.addEventListener('change', handleVolumeChange);
  }

  // Reset Cache / Local Preferences (strictly preserves shared platform identity & game data)
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (
        confirm(
          'Clear local AuroMind cache and preferences? Your guest identity and game progress will be preserved.'
        )
      ) {
        try {
          clearPortalPreferencesOnly(window.localStorage);
        } catch (err) {}

        // Reset active UI state to defaults
        if (typeof window.applySeniorMode === 'function') {
          window.applySeniorMode(false, false);
        }
        applyReducedMotion(false, false);
        if (volumeSlider) {
          volumeSlider.value = '50';
        }
        if (window.setAmbientVolume) {
          window.setAmbientVolume(0.5);
        }

        resetBtn.textContent = 'Cache Cleared ✓';
        resetBtn.style.color = '#059669';
        setTimeout(() => {
          resetBtn.textContent = 'Clear Cache';
          resetBtn.style.color = '#DC2626';
        }, 2000);
      }
    });
  }
}

// ==========================================================================
// 8. ABOUT AUROMIND MODAL
// ==========================================================================
function initAboutModal() {
  const aboutBtn = document.getElementById('sidebar-about-btn');
  const modal = document.getElementById('about-modal');
  const closeBtn = document.getElementById('about-close-btn');
  const confirmBtn = document.getElementById('about-confirm-btn');
  const sidebar = document.getElementById('portal-sidebar');

  if (!aboutBtn || !modal) return;

  const openModal = () => {
    modal.classList.add('open');
    if (window.innerWidth < 680 && sidebar) {
      sidebar.classList.remove('open');
    }
  };

  const closeModal = () => modal.classList.remove('open');

  aboutBtn.addEventListener('click', (e) => {
    e.preventDefault();
    openModal();
  });

  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (confirmBtn) confirmBtn.addEventListener('click', closeModal);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
}


// ==========================================================================
// 9. SANCTUARY WELCOME GUIDE MODAL (POP-UP & ON-DEMAND)
// ==========================================================================
function initSanctuaryGuide() {
  const guideModal = document.getElementById('guide-modal');
  const sidebarGuideBtn = document.getElementById('sidebar-guide-btn');
  const exploreBtn = document.getElementById('guide-explore-btn');
  const dismissBtn = document.getElementById('guide-dismiss-btn');
  const closeBtn = document.getElementById('guide-close-btn');
  const sidebar = document.getElementById('portal-sidebar');

  if (!guideModal || !sidebarGuideBtn) return;

  const STORAGE_KEY = 'auromind_guide_seen';

  const openModal = () => {
    guideModal.classList.add('open');
    sidebarGuideBtn.classList.add('active');
    if (window.innerWidth < 680 && sidebar) {
      sidebar.classList.remove('open');
    }
  };

  const closeModal = (persistPermanent = false) => {
    guideModal.classList.remove('open');
    sidebarGuideBtn.classList.remove('active');

    if (persistPermanent) {
      try {
        localStorage.setItem(STORAGE_KEY, 'permanent');
      } catch (err) {}
    }
  };

  // Check if first-time visitor: Auto pop-up after a soft 400ms delay
  const hasSeen = localStorage.getItem(STORAGE_KEY) === 'permanent';
  if (!hasSeen) {
    setTimeout(() => {
      openModal();
    }, 400);
  }

  if (exploreBtn) {
    exploreBtn.addEventListener('click', (e) => {
      e.preventDefault();
      closeModal(false);
    });
  }

  if (dismissBtn) {
    dismissBtn.addEventListener('click', (e) => {
      e.preventDefault();
      closeModal(true);
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      closeModal(false);
    });
  }

  guideModal.addEventListener('click', (e) => {
    if (e.target === guideModal) {
      closeModal(false);
    }
  });

  sidebarGuideBtn.addEventListener('click', (e) => {
    e.preventDefault();
    openModal();
  });
}


// ==========================================================================
// 10. PLAYER FEEDBACK MODAL (DIRECT-TO-INBOX VIA WEB3FORMS)
// ==========================================================================
function initFeedbackModal() {
  const feedbackBtn = document.getElementById('sidebar-feedback-btn');
  const modal = document.getElementById('feedback-modal');
  const closeBtn = document.getElementById('feedback-close-btn');
  const form = document.getElementById('feedback-form');
  const statusMsg = document.getElementById('feedback-status-msg');
  const submitBtn = document.getElementById('feedback-submit-btn');
  const sentimentChips = document.querySelectorAll('.sentiment-chip');
  const sentimentInput = document.getElementById('feedback-sentiment-input');
  const messageInput = document.getElementById('feedback-message-text');
  const sidebar = document.getElementById('portal-sidebar');

  if (!feedbackBtn || !modal || !form) return;

  const openModal = () => {
    modal.classList.add('open');
    if (statusMsg) {
      statusMsg.style.display = 'none';
      statusMsg.className = 'feedback-status-msg';
      statusMsg.textContent = '';
    }
    if (window.innerWidth < 680 && sidebar) {
      sidebar.classList.remove('open');
    }
    setTimeout(() => {
      if (messageInput) messageInput.focus();
    }, 200);
  };

  const closeModal = () => modal.classList.remove('open');

  feedbackBtn.addEventListener('click', (e) => {
    e.preventDefault();
    openModal();
  });

  if (closeBtn) closeBtn.addEventListener('click', closeModal);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  // Sentiment Chip Selection
  sentimentChips.forEach(chip => {
    chip.addEventListener('click', () => {
      sentimentChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      if (sentimentInput) {
        sentimentInput.value = chip.dataset.sentiment || '';
      }
    });
  });

  // Handle Form Submit via CSP-compatible fetch() (connect-src https://api.web3forms.com)
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const topic = document.getElementById('feedback-topic-select')?.value || 'General Sanctuary Experience';
    const message = messageInput?.value.trim() || '';
    const subjectInput = document.getElementById('feedback-subject-input');

    if (!message) {
      if (statusMsg) {
        statusMsg.style.display = 'block';
        statusMsg.className = 'feedback-status-msg error';
        statusMsg.textContent = 'Please share a few words before sending.';
      }
      if (messageInput) messageInput.focus();
      return;
    }

    if (subjectInput) {
      subjectInput.value = `💬 AuroMind Feedback: [${topic}]`;
    }

    const originalBtnHTML = submitBtn ? submitBtn.innerHTML : '<span>Send Feedback 🕊️</span>';
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending...';
    }
    if (statusMsg) {
      statusMsg.style.display = 'none';
      statusMsg.className = 'feedback-status-msg';
      statusMsg.textContent = '';
    }

    try {
      const response = await fetch(form.action || 'https://api.web3forms.com/submit', {
        method: 'POST',
        headers: {
          'Accept': 'application/json'
        },
        body: new FormData(form)
      });

      let data = null;
      try {
        data = await response.json();
      } catch (parseErr) {}

      if (!response.ok || (data && data.success === false)) {
        const errorText = (data && data.message) || 'Unable to send feedback right now. Please try again.';
        if (statusMsg) {
          statusMsg.style.display = 'block';
          statusMsg.className = 'feedback-status-msg error';
          statusMsg.textContent = errorText;
        }
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = originalBtnHTML;
        }
        return;
      }

      if (statusMsg) {
        statusMsg.style.display = 'block';
        statusMsg.className = 'feedback-status-msg success';
        statusMsg.textContent = 'Thank you! Your thoughts have been received with gratitude 🌸';
      }
      if (submitBtn) {
        submitBtn.innerHTML = '<span>Sent with Gratitude 🌸</span>';
      }
      form.reset();
      sentimentChips.forEach((c, idx) => c.classList.toggle('active', idx === 0));
      setTimeout(() => {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = originalBtnHTML;
        }
        closeModal();
      }, 1800);
    } catch (err) {
      if (statusMsg) {
        statusMsg.style.display = 'block';
        statusMsg.className = 'feedback-status-msg error';
        statusMsg.textContent = 'Network error while sending feedback. Please check your connection and try again.';
      }
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnHTML;
      }
    }
  });
}

// ==========================================================================
// 8. SANCTUARY PASS & PURCHASE BRIDGE (PLANNED INFO MODAL ONLY)
// ==========================================================================
function initPurchaseBridge() {
  const modal = document.getElementById('purchase-modal');
  const closeBtn = document.getElementById('purchase-modal-close-btn');
  const confirmBtn = document.getElementById('btn-confirm-purchase');
  const titleEl = document.getElementById('purchase-game-title');

  window.openPurchaseModal = function(gameId, title) {
    const activePurchaseGameId = gameId || 'vak';
    if (titleEl) {
      titleEl.textContent = title || (activePurchaseGameId === 'vak' ? 'VAK — The Control of Speech' : 'AuroMatch — Zen Tile Solitaire');
    }
    if (modal) modal.classList.add('open');
  };

  const closeModal = () => {
    if (modal) modal.classList.remove('open');
  };

  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });
  }

  if (confirmBtn) {
    confirmBtn.addEventListener('click', () => {
      closeModal();
    });
  }
}

// ==========================================================================
// 11. VISITOR-FACING ANALYTICS CONSENT BANNER (JANUARY 1 RELEASE)
// ==========================================================================
function initAnalyticsConsentBanner() {
  const consentBanner = document.getElementById('analytics-consent-banner');
  const consentAcceptBtn = document.getElementById('consent-accept-btn');
  const consentDeclineBtn = document.getElementById('consent-decline-btn');
  const consentSettingsLink = document.getElementById('consent-settings-link');
  const telemetryToggle = document.getElementById('settings-telemetry-toggle');
  const settingsModal = document.getElementById('settings-modal');

  let consentChoice = null;
  try {
    consentChoice = localStorage.getItem('auromind.platform.v1.telemetry_consent');
  } catch {}

  // If visitor hasn't made a decision yet, display the polite, mindful banner
  if (consentBanner && consentChoice === null) {
    consentBanner.style.display = 'block';
  }

  function hideBanner() {
    if (consentBanner) {
      consentBanner.style.display = 'none';
    }
  }

  if (consentAcceptBtn) {
    consentAcceptBtn.addEventListener('click', () => {
      hideBanner();
      try {
        if (window.AuroMind && window.AuroMind.telemetry) {
          window.AuroMind.telemetry.setConsent(true);
        }
        if (telemetryToggle) {
          telemetryToggle.checked = true;
        }
        trackWebsiteVisit();
      } catch (_e) {}
    });
  }

  if (consentDeclineBtn) {
    consentDeclineBtn.addEventListener('click', () => {
      hideBanner();
      try {
        if (window.AuroMind && window.AuroMind.telemetry) {
          window.AuroMind.telemetry.setConsent(false);
        }
        if (telemetryToggle) {
          telemetryToggle.checked = false;
        }
      } catch (_e) {}
    });
  }

  if (consentSettingsLink) {
    consentSettingsLink.addEventListener('click', () => {
      hideBanner();
      if (settingsModal) {
        settingsModal.classList.add('open');
      }
    });
  }
}

// ==========================================================================
// 12. EXIT & RETENTION TRACKING
// ==========================================================================
function initExitTracking() {
  const portalStartTime = Date.now();
  window.addEventListener('pagehide', () => {
    try {
      if (window.AuroMind && window.AuroMind.telemetry && window.AuroMind.telemetry.getConsent()) {
        const portalDuration = Math.max(1, Math.round((Date.now() - portalStartTime) / 1000));
        window.AuroMind.telemetry.track(
          'portal_exit',
          { sessionDurationSeconds: portalDuration },
          { category: 'lifecycle', gameId: 'portal' }
        );
        if (typeof window.AuroMind.telemetry.flush === 'function') {
          window.AuroMind.telemetry.flush();
        }
      }
    } catch {}
  });
}

// ==========================================================================
// 13. EPHEMERAL STORAGE AMBER BANNER & BACKUP EXPORT (TASK-ID-03)
// ==========================================================================
function checkAndRenderStorageAmberBanner(sdk) {
  const instance = sdk || window.AuroMind;
  if (!instance) return;
  const guest = instance.identity?.get()?.guest;
  const resilience = instance.storage?.getStorageResilience ? instance.storage.getStorageResilience() : null;
  const isEphemeral = Boolean(guest?.ephemeral || resilience?.isEphemeral || guest?.storageSource === 'memory');

  let banner = document.getElementById('amber-storage-banner');
  if (isEphemeral) {
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'amber-storage-banner';
      banner.className = 'amber-storage-banner';
      banner.innerHTML = `
        <div class="amber-banner-content">
          <span class="amber-banner-icon">⚠️</span>
          <span class="amber-banner-text">Running in temporary in-memory mode (private browsing or storage restricted). Your progress will be lost when this tab is closed.</span>
          <button id="amber-export-backup-btn" class="amber-banner-btn" title="Download backup of current session">Export Backup (.json)</button>
        </div>
      `;
      const container = document.body;
      if (container && container.firstChild) {
        container.insertBefore(banner, container.firstChild);
      } else if (container) {
        container.appendChild(banner);
      }

      const exportBtn = document.getElementById('amber-export-backup-btn');
      if (exportBtn) {
        exportBtn.addEventListener('click', async () => {
          try {
            exportBtn.disabled = true;
            exportBtn.textContent = 'Exporting...';
            let backupData = null;
            if (instance.storage && typeof instance.storage.exportBackup === 'function') {
              backupData = await instance.storage.exportBackup();
            } else if (instance.player && typeof instance.player.exportUserData === 'function') {
              backupData = await instance.player.exportUserData();
            }
            if (backupData) {
              const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `auromind-backup-${Date.now()}.json`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
            }
          } catch (err) {
            console.error('Backup export failed:', err);
          } finally {
            exportBtn.disabled = false;
            exportBtn.textContent = 'Export Backup (.json)';
          }
        });
      }
    }
    banner.style.display = 'block';
  } else if (banner) {
    banner.style.display = 'none';
  }
}
