/**
 * AUROMIND PORTAL - INTERACTIVE CLIENT SCRIPT
 * Manages in-portal game theater, search, filters, senior mode, audio, and modals.
 */

document.addEventListener('DOMContentLoaded', () => {
  initTheaterMode();
  initSidebarAndNavigation();
  initSearch();
  initSeniorMode();
  initAmbientAudio();
  initAuthModal();
  initSettingsModal();
  initAboutModal();
});

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

  const isLocal = window.location.hostname === 'localhost' || 
                  window.location.hostname === '127.0.0.1' || 
                  window.location.protocol === 'file:';

  const gameUrls = {
    'vak': isLocal ? '../vak-play/index.html' : 'https://gapskris.github.io/vak-play/',
    'auromatch': isLocal ? '../auromatch-play/index.html' : 'https://gapskris.github.io/auromatch-play/'
  };

  function openGameInTheater(gameId, title, icon) {
    const url = gameUrls[gameId];
    if (!url) return;

    if (theaterTitle) theaterTitle.textContent = title || 'AuroMind Game';
    if (theaterIcon && icon) theaterIcon.src = icon;
    
    // Enter True Game Mode: hides portal header & sidebar for 100% viewport height
    document.body.classList.add('in-game-mode');

    // Load into iframe
    if (theaterIframe) theaterIframe.src = url;

    // Transition view
    if (catalogScroll) catalogScroll.style.display = 'none';
    if (theaterView) theaterView.style.display = 'block';

    // Update browser history state without leaving page or exposing sub-url
    history.pushState({ inGame: true, gameId }, title, `#play-${gameId}`);
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
  }

  // Play button click handlers
  playButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const gameId = btn.dataset.gameId;
      const title = btn.dataset.title;
      const icon = btn.dataset.icon;
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

  if (!searchInput) return;

  searchInput.addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();

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

  function toggleSeniorMode() {
    document.body.classList.toggle('senior-mode');
    const isActive = document.body.classList.contains('senior-mode');
    
    if (seniorBtn) {
      seniorBtn.classList.toggle('active', isActive);
      seniorBtn.querySelector('span:last-child').textContent = isActive ? 'Senior: ON' : 'Senior View';
    }
    if (sidebarSeniorBtn) {
      sidebarSeniorBtn.classList.toggle('active', isActive);
    }
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

  window.setAmbientVolume = (volRatio) => {
    currentVolume = volRatio * 0.07;
    if (gainNode && audioCtx && isPlaying) {
      gainNode.gain.setValueAtTime(Math.max(0.001, currentVolume), audioCtx.currentTime);
    }
  };

  audioBtn.addEventListener('click', () => {
    if (!audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioContext();
    }

    if (isPlaying) {
      gainNode.gain.linearRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
      setTimeout(() => {
        if (oscillator) {
          oscillator.stop();
          oscillator.disconnect();
          oscillator = null;
        }
      }, 500);
      isPlaying = false;
      audioBtn.classList.remove('active');
    } else {
      oscillator = audioCtx.createOscillator();
      gainNode = audioCtx.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(432, audioCtx.currentTime);

      gainNode.gain.setValueAtTime(0.001, audioCtx.currentTime);
      gainNode.gain.linearRampToValueAtTime(currentVolume, audioCtx.currentTime + 1);

      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      oscillator.start();
      isPlaying = true;
      audioBtn.classList.add('active');
    }
  });
}

// ==========================================================================
// 6. AUTH & ACCOUNT MODAL (ROADMAP TEASER)
// ==========================================================================
function initAuthModal() {
  const authBtn = document.getElementById('auth-btn');
  const modal = document.getElementById('auth-modal');
  const closeBtn = document.getElementById('modal-close-btn');
  const confirmBtn = document.getElementById('modal-confirm-btn');

  if (!authBtn || !modal) return;

  const openModal = () => modal.classList.add('open');
  const closeModal = () => modal.classList.remove('open');

  authBtn.addEventListener('click', openModal);
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (confirmBtn) confirmBtn.addEventListener('click', closeModal);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
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
  const resetBtn = document.getElementById('settings-reset-btn');

  if (!settingsBtn || !modal) return;

  const openModal = () => {
    // Sync current Senior Mode state
    if (seniorToggle) {
      seniorToggle.checked = document.body.classList.contains('senior-mode');
    }
    // Sync reduced motion
    if (motionToggle) {
      motionToggle.checked = document.documentElement.classList.contains('reduced-motion');
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
      const seniorBtn = document.getElementById('senior-mode-btn');
      const sidebarSeniorBtn = document.getElementById('sidebar-senior-btn');
      document.body.classList.toggle('senior-mode', seniorToggle.checked);
      if (seniorBtn) {
        seniorBtn.classList.toggle('active', seniorToggle.checked);
        seniorBtn.querySelector('span:last-child').textContent = seniorToggle.checked ? 'Senior: ON' : 'Senior View';
      }
      if (sidebarSeniorBtn) {
        sidebarSeniorBtn.classList.toggle('active', seniorToggle.checked);
      }
    });
  }

  // Reduced Motion Toggle
  if (motionToggle) {
    motionToggle.addEventListener('change', () => {
      document.documentElement.classList.toggle('reduced-motion', motionToggle.checked);
      try {
        localStorage.setItem('auromind_reduced_motion', motionToggle.checked ? 'true' : 'false');
      } catch (err) {}
    });
  }

  // Volume slider
  if (volumeSlider) {
    volumeSlider.addEventListener('input', (e) => {
      const vol = parseFloat(e.target.value) / 100;
      if (window.setAmbientVolume) {
        window.setAmbientVolume(vol);
      }
    });
  }

  // Reset Cache / Local Storage
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (confirm('Clear local AuroMind cache and preferences?')) {
        try {
          localStorage.clear();
        } catch (err) {}
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
