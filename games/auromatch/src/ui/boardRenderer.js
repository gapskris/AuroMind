// 2.5D Isometric Board Renderer for AuroMatch

// Supports Standard ($68 x 88px) and Senior View ($85 x 110px) sizing

// Isometric Layer Offsets: dx = -2px, dy = -3px per layer

// High-contrast, WCAG AAA compliant styling and visual lock indicators



import { VitaBoardGenerator } from '../models/boardGenerator.js';

import { floraCatalog, getFloraById } from '../models/floraDatabase.js';



export class BoardRenderer {

  constructor(boardContainerId, options = {}) {

    this.container = (typeof document !== 'undefined' && boardContainerId) ? document.getElementById(boardContainerId) : null;

    let actualOptions = options;

    if (Array.isArray(options)) {

      this.tiles = options;

      actualOptions = arguments[2] || {};

    } else {

      this.tiles = [];

    }

    this.options = {

      seniorView: false,

      gameplayMode: 'vita', // 'vita' | 'tile_club'

      onTileClick: null,

      ...actualOptions

    };

    this.stageLayoutMetrics = null;

  }



  setSeniorView(enabled) {

    this.options.seniorView = !!enabled;

    this.stageLayoutMetrics = null;

    this.render();

  }



  setGameplayMode(mode) {

    this.options.gameplayMode = mode;

    this.stageLayoutMetrics = null;

    this.render();

  }



  setActiveArchetype(archetype) {

    this.options.activeArchetype = archetype || null;

    this.render();

  }



  setTiles(tiles) {

    this.tiles = tiles || [];

    this.stageLayoutMetrics = null;

    // rAF defer: let CSS finish painting so clientWidth/clientHeight are real values

    if (typeof requestAnimationFrame !== 'undefined') {

      requestAnimationFrame(() => { this.render(); });

    } else {

      this.render();

    }

  }



  getTileDimensions(containerWidth = null) {

    if (this.options.seniorView) {

      if (containerWidth && containerWidth < 460) {

        const w = Math.max(52, Math.min(85, Math.floor(containerWidth / 5.2)));

        const h = Math.round(w * 1.29);

        return { width: w, height: h, fontSize: Math.max(12, Math.round(w * 0.17)), iconSize: Math.max(26, Math.round(w * 0.54)) };

      }

      return { width: 85, height: 110, fontSize: 13, iconSize: 48 };

    }

    if (containerWidth && containerWidth < 460) {

      const w = Math.max(44, Math.min(68, Math.floor(containerWidth / 5.5)));

      const h = Math.round(w * 1.29);

      return { width: w, height: h, fontSize: Math.max(10, Math.round(w * 0.16)), iconSize: Math.max(22, Math.round(w * 0.54)) };

    }

    return { width: 68, height: 88, fontSize: 11, iconSize: 42 };

  }



  computeStageMetrics(containerW, containerH, sizingH = null) {

    const isRealmsMode = (this.options.gameplayMode === 'realms');
    const isArtThemeMode = (this.options.gameplayMode === 'realms' || this.options.gameplayMode === 'botanical');

    const isTileClubMode = (this.options.gameplayMode === 'tile_club');

    const isSenior = !!this.options.seniorView;

    const isMobile = containerW < 480;

    const isTablet = containerW >= 480 && containerW < 1024;



    // 1. Compute bounding coordinate bounds from the FULL permanent stage layout (this.tiles)

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, maxZ = 0;

    const allStageTiles = (this.tiles && this.tiles.length > 0) ? this.tiles : [];

    if (allStageTiles.length > 0) {

      allStageTiles.forEach(t => {

        if (t.x < minX) minX = t.x;

        if (t.x > maxX) maxX = t.x;

        if (t.y < minY) minY = t.y;

        if (t.y > maxY) maxY = t.y;

        if (t.z > maxZ) maxZ = t.z;

      });

    } else {

      minX = 0; maxX = 5; minY = 0; maxY = 3; maxZ = 0;

    }



    const colSpan = Math.max(1, maxX - minX + 1);

    const rowSpan = Math.max(1, maxY - minY + 1);



    const aspect = 1.125; // 320x360 8:9 ratio unified across all themes

    const spacingFactor = 0.85; // Unified across all themes and modes



    // Available board area inside container (leaving slight margin for aesthetic floating)
    const availW = Math.max(260, containerW - 16);

    // Sizing Parity: Use unified stage height budget across all gameplay modes (Pairs, Triads, Botanical, Realms)
    // while strictly guaranteeing that effective height NEVER exceeds physical containerH to prevent tray collisions.
    const promptDeduction = isMobile ? 24 : (isTablet ? 28 : 24);
    const baseSizingH = (typeof sizingH === 'number' && sizingH > 160) ? sizingH : containerH;
    const effectiveSizingH = Math.min(containerH, baseSizingH);
    const availH = Math.max(120, effectiveSizingH - promptDeduction - (isMobile ? 12 : 20));

    const colDenominator = 1 + (colSpan - 1) * spacingFactor;
    const rowDenominator = 1 + (rowSpan - 1) * spacingFactor;

    const CANONICAL_COLS = 12;
    const CANONICAL_ROWS = 8;
    const canonicalColDenom = 1 + (CANONICAL_COLS - 1) * spacingFactor;
    const canonicalRowDenom = 1 + (CANONICAL_ROWS - 1) * spacingFactor;

    // Target coverage: 96% of width on mobile, 94% on tablet/desktop
    const widthCoverage = isMobile ? 0.96 : 0.94;
    const heightCoverage = isMobile ? 0.92 : 0.91;

    const maxWFromWidth = (availW * widthCoverage) / colDenominator;
    const maxHFromHeight = (availH * heightCoverage) / rowDenominator;
    const maxWFromHeight = maxHFromHeight / aspect;

    const canonicalWFromWidth = (availW * widthCoverage) / canonicalColDenom;
    const canonicalWFromHeight = ((availH * heightCoverage) / canonicalRowDenom) / aspect;
    const canonicalFitW = Math.floor(Math.min(canonicalWFromWidth, canonicalWFromHeight));

    let rawFitW = Math.floor(Math.min(canonicalFitW, maxWFromWidth, maxWFromHeight));

    // Dynamic width bounds across viewports (Unified parity across Pairs, Triads, Botanical, Realms)
    let minAllowed, maxAllowed;
    if (isMobile) {
      minAllowed = isSenior ? 48 : 32;
      maxAllowed = isSenior ? 84 : 72;
    } else if (isTablet) {
      minAllowed = isSenior ? 66 : 48;
      maxAllowed = isSenior ? 130 : 116;
    } else {
      minAllowed = isSenior ? 70 : 52;
      maxAllowed = isSenior ? 144 : 126;
    }

    let targetW = Math.max(minAllowed, Math.min(maxAllowed, rawFitW));
    let width = targetW;
    let height = Math.round(width * aspect);
    let colSpacing = Math.round(width * spacingFactor);
    let rowSpacing = Math.round(height * spacingFactor);

    const isoScaleX = 5.0;
    const isoScaleY = 8.0;

    // Strict boundary & overflow guard: verify vertical footprint against physical container
    const maxSafeBoardH = Math.max(100, containerH - (isMobile ? 24 : 32));
    let estBoardH = (maxY - minY) * rowSpacing + height + Math.ceil(maxZ * isoScaleY);
    if (estBoardH > maxSafeBoardH && estBoardH > 0) {
      const scaleDown = maxSafeBoardH / estBoardH;
      targetW = Math.max(isMobile ? 22 : 30, Math.floor(targetW * scaleDown));
      width = targetW;
      height = Math.round(width * aspect);
      colSpacing = Math.round(width * spacingFactor);
      rowSpacing = Math.round(height * spacingFactor);
    }

    // Hero Game Icons and Typography: Scale proportionally with tile width
    const iconRatio = isSenior ? 0.58 : 0.56;
    const fontRatio = isSenior ? 0.17 : 0.155;
    const iconSize = Math.max(18, Math.round(width * iconRatio));
    const fontSize = Math.max(8, Math.round(width * fontRatio));
    const boardTotalW = (maxX - minX) * colSpacing + width;
    const boardTotalH = (maxY - minY) * rowSpacing + height;

    let minRelX = 0, maxRelX = (maxX - minX) * colSpacing + width;
    let minRelY = 0, maxRelY = (maxY - minY) * rowSpacing + height;

    if (allStageTiles.length > 0) {
      minRelX = Infinity; maxRelX = -Infinity;
      minRelY = Infinity; maxRelY = -Infinity;
      allStageTiles.forEach(t => {
        const rx = (t.x - minX) * colSpacing - (t.z * isoScaleX);
        if (rx < minRelX) minRelX = rx;
        if (rx + width > maxRelX) maxRelX = rx + width;
        const ry = (t.y - minY) * rowSpacing - (t.z * isoScaleY);
        if (ry < minRelY) minRelY = ry;
        if (ry + height > maxRelY) maxRelY = ry + height;
      });
    }

    const actualBoardW = maxRelX - minRelX;
    const actualBoardH = maxRelY - minRelY;

    const minSafeOffsetX = Math.ceil(maxZ * isoScaleX) + (isMobile ? 8 : 16);
    const minSafeOffsetY = Math.ceil(maxZ * isoScaleY) + (isMobile ? 8 : 14);

    let offsetX = minSafeOffsetX;
    if (containerW && containerW > actualBoardW) {
      offsetX = Math.max(minSafeOffsetX, Math.floor((containerW - actualBoardW) / 2) - minRelX);
    }

    let offsetY = minSafeOffsetY;
    if (containerH && containerH > actualBoardH) {
      offsetY = Math.max(minSafeOffsetY, Math.floor((containerH - actualBoardH) / 2) - minRelY);
    }

    // Strict boundary enforcement: Ensure bottom-most tile never exceeds containerH - safeBottomMargin
    const safeBottomMargin = isMobile ? 8 : 16;
    const bottomEdge = maxRelY + offsetY;
    if (containerH && bottomEdge > containerH - safeBottomMargin) {
      offsetY = Math.max(minSafeOffsetY, offsetY - (bottomEdge - (containerH - safeBottomMargin)));
    }

    return {

      minX, maxX, minY, maxY,

      colSpan, rowSpan,

      width, height,

      fontSize, iconSize,

      colSpacing, rowSpacing,

      offsetX, offsetY,

      boardTotalW, boardTotalH,
      actualBoardW, actualBoardH,

      containerW, containerH,

      seniorView: this.options.seniorView,

      gameplayMode: this.options.gameplayMode

    };

  }



  render() {

    if (!this.container) return;

    this.container.innerHTML = '';



    // RC1+RC4 fix: measure the PARENT .board-container (not #board which has max-width:980px).

    // Fall back to window dimensions so desktop never returns null/tiny values.

    const _boardParent = this.container ? this.container.parentElement : null;

    const _rawW = (_boardParent && _boardParent.clientWidth > 120)

      ? _boardParent.clientWidth

      : (this.container && this.container.clientWidth > 120 ? this.container.clientWidth : 0);

    const containerW = _rawW > 120

      ? _rawW

      : (typeof window !== 'undefined' ? window.innerWidth : 1280);



    const isMobile = containerW < 480;
    const isTablet = containerW >= 480 && containerW < 1024;
    const isTileClub = (this.options.gameplayMode === 'tile_club');

    const _minHThresh = isMobile ? 120 : 160;
    const _rawH = (this.container && this.container.clientHeight > _minHThresh)
      ? this.container.clientHeight
      : ((_boardParent && _boardParent.clientHeight > _minHThresh)
        ? _boardParent.clientHeight
        : 0);

    const _stageCol = (typeof document !== 'undefined') ? document.getElementById('center-stage-col') : null;
    const _stageH = (_stageCol && _stageCol.clientHeight > 200) ? _stageCol.clientHeight : 0;
    const trayReserve = isTileClub ? (isMobile ? 85 : 110) : 0;
    const unifiedUiReserve = (isMobile ? 142 : 144) + trayReserve;
    const unifiedSizingH = (_stageH > 200) ? Math.max(160, _stageH - unifiedUiReserve) : null;

    let containerH;
    if (_rawH > _minHThresh) {
      containerH = _rawH;
    } else {
      if (_stageH > 200) {
        containerH = unifiedSizingH;
      } else {
        containerH = typeof window !== 'undefined' ? Math.floor(window.innerHeight * (isMobile ? 0.52 : (isTileClub ? 0.58 : 0.70))) : 600;
      }
    }



    if (containerW && containerW > 100) {

      if (!this.stageLayoutMetrics ||

          this.stageLayoutMetrics.containerW !== containerW ||

          this.stageLayoutMetrics.containerH !== containerH ||

          this.stageLayoutMetrics.seniorView !== this.options.seniorView ||

          this.stageLayoutMetrics.gameplayMode !== this.options.gameplayMode) {

        this.stageLayoutMetrics = this.computeStageMetrics(containerW, containerH, unifiedSizingH || containerH);

      }

    }



    const metrics = this.stageLayoutMetrics || {

      ...this.getTileDimensions(),

      minX: 0, maxX: 5, minY: 0, maxY: 3,

      colSpacing: 58, rowSpacing: 75,

      offsetX: 10, offsetY: 12

    };



    const {

      minX, minY,

      width, height,

      fontSize, iconSize,

      colSpacing, rowSpacing,

      offsetX, offsetY

    } = metrics;



    const activeTiles = this.tiles.filter(t => !t.isMatched);

    // Prioritize higher z-layer and free playable tiles first in DOM so visible top-layer <img> tags download first,
    // while explicit CSS z-index preserves exact 2.5D painter's stacking order.
    const sortedActiveTiles = [...activeTiles].sort((a, b) => {
      if (a.z !== b.z) return b.z - a.z;
      const aFree = VitaBoardGenerator.isTileFree(a, activeTiles);
      const bFree = VitaBoardGenerator.isTileFree(b, activeTiles);
      if (aFree !== bFree) return aFree ? -1 : 1;
      return 0;
    });

    const domainRibbons = {

      'Fauna & Wildlife': '#15803d',

      'Flora & Ecology': '#16a34a',

      'Cosmos & Astronomy': '#4f46e5',

      'Earth & Geology': '#b45309',

      'Mind & Science': '#0284c7',

      'Arts & Culture': '#e11d48',

      'Character & Will': '#d97706',

      'Heart, Empathy & Peace': '#ec4899',

      'Wisdom & Integral Yoga': '#9333ea'

    };



    sortedActiveTiles.forEach(tile => {

      const isFree = VitaBoardGenerator.isTileFree(tile, activeTiles);

      const isSelected = !!tile.isSelected;



      // Authentic 2.5D Isometric depth offset: dx = -5.0px, dy = -8.0px per tier for prominent, tangible 3D stepped elevation
      const isoDx = -(tile.z * 5.0);
      const isoDy = -(tile.z * 8.0);

      const posX = offsetX + (tile.x - minX) * colSpacing + isoDx;
      const posY = offsetY + (tile.y - minY) * rowSpacing + isoDy;

      // Flora details & Archetype
      const flora = tile.floraData || getFloraById(tile.floraId);
      const arch = this.options.activeArchetype || tile.archetype || flora.archetype || 'ivory';
      const ribbonColor = domainRibbons[flora.domain] || '#c5a880';

      const el = document.createElement('div');
      el.className = `tile-element archetype-${arch} ${isFree ? 'tile-free' : 'tile-blocked'} ${isSelected ? 'tile-selected' : ''}`;
      if (this.options.seniorView) el.classList.add('senior-tile');

      el.id = tile.id;
      el.dataset.id = tile.id;
      el.dataset.archetype = arch;
      el.dataset.z = `${tile.z}`;
      el.style.width = `${width}px`;
      el.style.height = `${height}px`;
      el.style.left = `${posX}px`;
      el.style.top = `${posY}px`;

      const baseZ = Math.round(tile.z * 200 + (tile.y - minY) * 10 + (tile.x - minX) + 10);
      el.style.zIndex = `${baseZ + (isSelected ? 80 : (isFree ? 20 : 0))}`;



      const bonusBadge = (arch === 'golden_relic') ? '<div class="tile-spark-badge">✨+10</div>' : '';



      const tileName = tile.thematicName || (flora && flora.customName) || (flora && flora.commonName) || 'Tile';
      const domainInfo = (flora && flora.domain) ? ` (${flora.domain})` : '';
      el.title = isFree ? `${tileName}${domainInfo}` : `${tileName} (Blocked: clear covering tiles)`;



      // Hybrid Typography Engine: Dynamic font-clamp & soft 2-line balancing

      const nameLen = (flora.commonName || '').length;

      let dynFontSize = fontSize;

      let dynLineHeight = '1.08';

      if (nameLen <= 5) {

        dynFontSize = fontSize;

        dynLineHeight = '1.1';

      } else if (nameLen <= 8) {

        dynFontSize = Math.max(9.5, Math.round(fontSize * 0.88 * 10) / 10);

        dynLineHeight = '1.05';

      } else if (nameLen <= 11) {

        dynFontSize = Math.max(8.5, Math.round(fontSize * 0.78 * 10) / 10);

        dynLineHeight = '1.02';

      } else {

        dynFontSize = Math.max(8.0, Math.round(fontSize * 0.72 * 10) / 10);

        dynLineHeight = '0.98';

      }



      const isRealmsMode = (this.options.gameplayMode === 'realms');

      const isArtThemeMode = (this.options.gameplayMode === 'realms' || this.options.gameplayMode === 'botanical');
      const customImg = tile.customImage || (flora && flora.customImage) || null;



      if (customImg) {

        el.classList.add('tile-authentic-art');

        const tileName = tile.thematicName || (flora && flora.customName) || (flora && flora.commonName) || 'Tile';

        const tileSym = tile.thematicSymbol || (flora && flora.customSymbol) || (flora && flora.symbol) || '✨';

        const isInsetPlaque = /\/(biblios_wisdom|blooming_mandala|celestial_starlight|floral_harmony|golden_harvest|golden_nebula|granite_monolith|lotus_pond|master_sanctuary|obsidian_vault|ocean_horizon|sacred_sanctuary|sacred_spiral|sandalwood_amber|spirit_altar|temple_of_lines|terracotta_earth|whispering_pines)\//.test(customImg);
        const isCloisonne = /\/(standard_lapis|standard_gold|botanical_art)\//.test(customImg);
        const imgScale = isInsetPlaque ? 1.52 : (isCloisonne ? 1.24 : 1.14);

        el.innerHTML = `

          <div class="tile-face tile-art-face">

            <img class="tile-art-img" src="${customImg}" alt="${tileName}" fetchpriority="${tile.z >= 2 ? 'high' : 'auto'}" style="--tile-img-scale: ${imgScale};" draggable="false" onload="if(this.naturalWidth<=1&&this.naturalHeight<=1){this.classList.add('tile-img-hidden');this.style.setProperty('display','none','important');if(this.nextElementSibling)this.nextElementSibling.style.display='flex';}" onerror="this.classList.add('tile-img-hidden');this.style.setProperty('display','none','important'); if(this.nextElementSibling) this.nextElementSibling.style.display='flex';" />

            <div class="tile-art-fallback" style="display: none; width: 100%; height: 100%; flex-direction: column; align-items: center; justify-content: center; background: #1e293b; border: 2px solid #fbbf24; border-radius: 12px; color: #fff; text-align: center; padding: 4px;">

              <span style="font-size: ${iconSize}px;">${tileSym}</span>

              <span style="font-size: ${dynFontSize}px; font-weight: 700; margin-top: 2px;">${tileName}</span>

            </div>

            ${bonusBadge}

          </div>

        `;

      } else {

        el.innerHTML = `

          <div class="tile-face">

            <div class="tile-category-ribbon" style="background: ${ribbonColor};"></div>

            ${bonusBadge}

            <div class="tile-icon" style="font-size: ${iconSize}px;">${flora.symbol || '🪷'}</div>

            <div class="tile-label-banner">

              <div class="tile-label" style="font-size: ${dynFontSize}px; line-height: ${dynLineHeight};">${flora.commonName}</div>

            </div>

          </div>

        `;

      }



      el.addEventListener('pointerdown', (e) => {

        e.stopPropagation();

        if (this.options.onTileClick) {

          this.options.onTileClick(tile, isFree, e);

        }

      });



      this.container.appendChild(el);

    });

  }



  highlightTiles(tileIds = []) {

    const ids = new Set(tileIds);

    const elements = this.container.querySelectorAll('.tile-element');

    elements.forEach(el => {

      if (ids.has(el.dataset.id)) {

        el.classList.add('tile-hint-aura');

      } else {

        el.classList.remove('tile-hint-aura');

      }

    });

  }



  clearHighlights() {

    const elements = this.container.querySelectorAll('.tile-element');

    elements.forEach(el => el.classList.remove('tile-hint-aura'));

  }

}



export function reshuffleBoard() {

  if (typeof window !== 'undefined' && window.gameManager) {

    window.gameManager.restartStage();

  }

}



export function renderBoard(boardId, statusId, onComplete) {

  if (typeof window !== 'undefined' && window.gameManager) {

    window.gameManager.boardRenderer?.render();

  }

}

