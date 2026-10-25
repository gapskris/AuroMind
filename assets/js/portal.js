/**
 * AUROMIND PORTAL - INTERACTIVE CLIENT SCRIPT
 * Manages search, category filtering, ambient audio, and modal interactions.
 */

document.addEventListener('DOMContentLoaded', () => {
  initSearchAndFilter();
  initAmbientAudio();
  initAuthModal();
  initSmartLinks();
});

// ==========================================================================
// 1. SEARCH & CATEGORY FILTERING
// ==========================================================================
function initSearchAndFilter() {
  const searchInput = document.getElementById('search-input');
  const filterChips = document.querySelectorAll('.filter-chip');
  const cards = document.querySelectorAll('.game-card');
  const countDisplay = document.getElementById('visible-count');

  let activeCategory = 'all';
  let searchQuery = '';

  function applyFilters() {
    let visibleCount = 0;

    cards.forEach(card => {
      const title = (card.dataset.title || '').toLowerCase();
      const genre = (card.dataset.genre || '').toLowerCase();
      const usp = (card.dataset.usp || '').toLowerCase();
      const category = (card.dataset.category || '').toLowerCase();

      const matchesCategory = (activeCategory === 'all' || category.includes(activeCategory));
      const matchesSearch = !searchQuery || 
        title.includes(searchQuery) || 
        genre.includes(searchQuery) || 
        usp.includes(searchQuery);

      if (matchesCategory && matchesSearch) {
        card.style.display = 'flex';
        visibleCount++;
      } else {
        card.style.display = 'none';
      }
    });

    if (countDisplay) {
      countDisplay.textContent = `${visibleCount} Game${visibleCount === 1 ? '' : 's'}`;
    }
  }

  // Search input handler
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.trim().toLowerCase();
      applyFilters();
    });
  }

  // Category chip handler
  filterChips.forEach(chip => {
    chip.addEventListener('click', () => {
      filterChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      activeCategory = chip.dataset.filter || 'all';
      applyFilters();
    });
  });
}

// ==========================================================================
// 2. AMBIENT 432 Hz SOUNDSCAPE (WEB AUDIO API - ZERO ASSETS NEEDED)
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
      // Fade out
      gainNode.gain.linearRampToValueAtTime(0.001, audioCtx.currentTime + 0.6);
      setTimeout(() => {
        if (oscillator) {
          oscillator.stop();
          oscillator.disconnect();
          oscillator = null;
        }
      }, 600);
      isPlaying = false;
      audioBtn.style.color = '';
      audioBtn.title = 'Play Ambient 432 Hz Soundscape';
    } else {
      // 432 Hz Meditative Drone
      oscillator = audioCtx.createOscillator();
      gainNode = audioCtx.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(432, audioCtx.currentTime); // 432 Hz natural resonance

      // Soft volume
      gainNode.gain.setValueAtTime(0.001, audioCtx.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.04, audioCtx.currentTime + 1.2);

      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      oscillator.start();
      isPlaying = true;
      audioBtn.style.color = 'var(--accent-gold)';
      audioBtn.title = 'Ambient 432 Hz Playing (Click to Mute)';
    }
  });
}

// ==========================================================================
// 3. AUTH & PURCHASE MODAL (ROADMAP TEASER)
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
// 4. SMART LINKS (LOCAL VS GITHUB PAGES)
// ==========================================================================
function initSmartLinks() {
  // If running locally in a file system or local server, we adjust links
  const isLocal = window.location.hostname === 'localhost' || 
                  window.location.hostname === '127.0.0.1' || 
                  window.location.protocol === 'file:';

  const vakLink = document.getElementById('link-vak');
  const auromatchLink = document.getElementById('link-auromatch');

  if (isLocal) {
    if (vakLink) vakLink.href = '../vak-play/index.html';
    if (auromatchLink) auromatchLink.href = '../auromatch-play/index.html';
  } else {
    // When live on GitHub Pages
    if (vakLink) vakLink.href = 'https://gapskris.github.io/vak-play/';
    if (auromatchLink) auromatchLink.href = 'https://gapskris.github.io/auromatch-play/';
  }
}
