/**
 * AUROMIND PORTAL - INTERACTIVE CLIENT SCRIPT
 * Manages sidebar navigation, search, senior mode, audio, and modals across 16 games.
 */

document.addEventListener('DOMContentLoaded', () => {
  initSidebarAndNavigation();
  initSearch();
  initSeniorMode();
  initAmbientAudio();
  initAuthModal();
  initSmartLinks();
});

// ==========================================================================
// 1. SIDEBAR NAVIGATION & CATEGORY FILTERING (16 TITLES)
// ==========================================================================
function initSidebarAndNavigation() {
  const sidebar = document.getElementById('portal-sidebar');
  const menuToggle = document.getElementById('menu-toggle-btn');
  const navItems = document.querySelectorAll('.sidebar-nav-item[data-category]');
  const cards = document.querySelectorAll('.game-card');

  // Mobile menu toggle
  if (menuToggle && sidebar) {
    menuToggle.addEventListener('click', () => {
      sidebar.classList.toggle('open');
    });

    // Close on clicking outside on mobile
    document.addEventListener('click', (e) => {
      if (window.innerWidth < 680 && 
          sidebar.classList.contains('open') && 
          !sidebar.contains(e.target) && 
          e.target !== menuToggle) {
        sidebar.classList.remove('open');
      }
    });
  }

  // Sidebar category filtering
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

      // Also hide sections if all child cards are hidden
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
// 2. LIVE SEARCH (ALL 16 GAMES)
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
// 3. SENIOR ACCESSIBILITY MODE TOGGLE
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
// 4. AMBIENT 432 Hz AUDIO (WEB AUDIO API)
// ==========================================================================
function initAmbientAudio() {
  const audioBtn = document.getElementById('ambient-audio-btn');
  if (!audioBtn) return;

  let audioCtx = null;
  let oscillator = null;
  let gainNode = null;
  let isPlaying = false;

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
      gainNode.gain.linearRampToValueAtTime(0.035, audioCtx.currentTime + 1);

      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      oscillator.start();
      isPlaying = true;
      audioBtn.classList.add('active');
    }
  });
}

// ==========================================================================
// 5. AUTH & ACCOUNT MODAL (ROADMAP TEASER)
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
// 6. SMART ENVIRONMENT LINKS
// ==========================================================================
function initSmartLinks() {
  const isLocal = window.location.hostname === 'localhost' || 
                  window.location.hostname === '127.0.0.1' || 
                  window.location.protocol === 'file:';

  const vakLink = document.getElementById('link-vak');
  const auromatchLink = document.getElementById('link-auromatch');

  if (isLocal) {
    if (vakLink) vakLink.href = '../vak-play/index.html';
    if (auromatchLink) auromatchLink.href = '../auromatch-play/index.html';
  } else {
    if (vakLink) vakLink.href = 'https://gapskris.github.io/vak-play/';
    if (auromatchLink) auromatchLink.href = 'https://gapskris.github.io/auromatch-play/';
  }
}
