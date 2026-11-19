/**
 * AUROMIND PORTAL - INTERACTIVE CLIENT SCRIPT
 * Manages in-portal game theater, search, filters, senior mode, audio, and modals.
 */

document.addEventListener('DOMContentLoaded', () => {
  initPortalServiceWorker();
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
});

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

  function openGameInTheater(gameId, title, icon) {
    const url = gameUrls[gameId];
    if (!url) return;

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
      theaterIframe.src = url;
    }

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

  // Listen to HTML5 PostMessage from same-origin child game iframes (Vak, AuroMatch, etc.)
  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;

    if (event.data && (event.data.type === 'AUROMIND_CLOSE_THEATER' || event.data.action === 'EXIT_GAME')) {
      closeTheater();
    }

    // Handle commercial license purchase request from child game iframe (ENT-001)
    if (event.data && event.data.type === 'AUROMIND_REQUEST_PURCHASE') {
      if (typeof window.openPurchaseModal === 'function') {
        window.openPurchaseModal(event.data.gameId, event.data.title);
      }
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

  window.suspendAmbientAudio = stopAmbientAudio;

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

  audioBtn.addEventListener('click', () => {
    if (!audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioContext();
    }

    if (isPlaying) {
      stopAmbientAudio();
    } else {
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
    });
  }

  // Reduced Motion Toggle
  if (motionToggle) {
    motionToggle.addEventListener('change', () => {
      applyReducedMotion(motionToggle.checked, true);
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
    };
    volumeSlider.addEventListener('input', handleVolumeChange);
    volumeSlider.addEventListener('change', handleVolumeChange);
  }

  // Reset Cache / Local Storage
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (confirm('Clear local AuroMind cache and preferences?')) {
        try {
          // Explicitly remove known AuroMind keys
          localStorage.removeItem('auromind_reduced_motion');
          localStorage.removeItem('auromind_senior_mode');
          localStorage.removeItem('auromind_ambient_volume');
          localStorage.removeItem('auromind_guide_seen');

          // Defensively remove any current or future AuroMind-owned keys
          Object.keys(localStorage)
            .filter(key => key.startsWith('auromind_'))
            .forEach(key => localStorage.removeItem(key));
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
