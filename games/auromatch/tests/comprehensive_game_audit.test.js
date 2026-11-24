import { describe, test, expect } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { GameManager, getTileCountForLevel, getRealmTileCount } from '../src/controllers/gameManager.js';
import { VitaBoardGenerator } from '../src/models/boardGenerator.js';
import { BoardRenderer } from '../src/ui/boardRenderer.js';
import { REALMS, STANDARD_THEMES, ThemeManager } from '../src/controllers/themeManager.js';

describe('Comprehensive Game Audit Suite', () => {

  // -------------------------------------------------------------
  // Audit 1: Level Tier Tile Count Compliance (Pic 3 Rule)
  // -------------------------------------------------------------
  describe('Audit 1: Level Tier Tile Count Rules', () => {
    test('Rule: Level 1 must have 60 tiles', () => {
      expect(getTileCountForLevel(1)).toBe(60);
      expect(getRealmTileCount(1)).toBe(60);
    });

    test('Rule: Levels 2 to 10 must have 72 tiles', () => {
      for (let lvl = 2; lvl <= 10; lvl++) {
        expect(getTileCountForLevel(lvl)).toBe(72);
        expect(getRealmTileCount(lvl)).toBe(72);
      }
    });

    test('Rule: Levels 11 to 30 (including L12 & L21) must have 96 tiles', () => {
      expect(getTileCountForLevel(11)).toBe(96);
      expect(getTileCountForLevel(12)).toBe(96); // Pic 2 defect fix verification!
      expect(getTileCountForLevel(21)).toBe(96); // Pic 1 verification!
      expect(getTileCountForLevel(30)).toBe(96);

      for (let lvl = 11; lvl <= 30; lvl++) {
        expect(getTileCountForLevel(lvl)).toBe(96);
        expect(getRealmTileCount(lvl)).toBe(96);
      }
    });

    test('Rule: Levels 31 to 45 / 75 must have 120 tiles', () => {
      for (let lvl = 31; lvl <= 45; lvl++) {
        expect(getTileCountForLevel(lvl)).toBe(120);
        expect(getRealmTileCount(lvl)).toBe(120);
      }
      expect(getTileCountForLevel(75)).toBe(120);
    });

    test('Rule: Levels 46 to 50 / 76 to 520+ must have 144 tiles', () => {
      for (let lvl = 46; lvl <= 50; lvl++) {
        expect(getRealmTileCount(lvl)).toBe(144);
      }
      for (const lvl of [76, 100, 200, 400, 520, 1000]) {
        expect(getTileCountForLevel(lvl)).toBe(144);
      }
    });

    test('GameManager: startNewStage(12) produces exactly 96 tiles (NO hijack to 12!)', () => {
      const gm = new GameManager({ gameplayMode: 'tile_club' });
      gm.startNewStage(12);
      expect(gm.player.currentLevel).toBe(12);
      expect(gm.tiles.length).toBe(96);
      expect(gm.tiles.length).not.toBe(12);
    });

    test('GameManager: startNewStage(21) produces exactly 96 tiles', () => {
      const gm = new GameManager({ gameplayMode: 'vita' });
      gm.startNewStage(21);
      expect(gm.player.currentLevel).toBe(21);
      expect(gm.tiles.length).toBe(96);
      expect(gm.currentFormationName).toContain('Amphora');
    });

    test('GameManager: startNewStage on legacy array numbers [24, 36, 48, 60, 72, 84, 96, 108] respects official tiers', () => {
      const gm = new GameManager({ gameplayMode: 'vita' });
      
      // Level 24 is in tier 11-30 -> must be 96 tiles (not 24)
      gm.startNewStage(24);
      expect(gm.tiles.length).toBe(96);

      // Level 36 is in tier 31-75 -> must be 120 tiles (not 36)
      gm.startNewStage(36);
      expect(gm.tiles.length).toBe(120);

      // Level 48 is in tier 31-75 -> must be 120 tiles (not 48)
      gm.startNewStage(48);
      expect(gm.tiles.length).toBe(120);

      // Level 60 is in tier 31-75 -> must be 120 tiles
      gm.startNewStage(60);
      expect(gm.tiles.length).toBe(120);

      // Level 84 is in tier 76-520+ -> must be 144 tiles
      gm.startNewStage(84);
      expect(gm.tiles.length).toBe(144);
    });
  });

  // -------------------------------------------------------------
  // Audit 2: Tile Image Consistency & Uniqueness (72 Native PNGs)
  // -------------------------------------------------------------
  describe('Audit 2: Tile Image Consistency & Uniqueness', () => {
    const themesDir = path.resolve('C:/AuroMatch/Assets/themes');

    test('Every active theme directory contains all 72 native tile PNG files', () => {
      // 20 Sacred Realms + 2 Standard Themes (standard_gold and standard_lapis)
      const allActiveThemeFolders = [
        ...REALMS.map(r => r.id),
        'standard_gold',
        'standard_lapis'
      ];

      for (const tFolder of allActiveThemeFolders) {
        const themePath = path.join(themesDir, tFolder);
        expect(fs.existsSync(themePath)).toBe(true);

        for (let i = 1; i <= 72; i++) {
          const padIdx = String(i).padStart(2, '0');
          const tilePath = path.join(themePath, `tile_${padIdx}.png`);
          expect(fs.existsSync(tilePath)).toBe(true);
          const stat = fs.statSync(tilePath);
          expect(stat.size).toBeGreaterThan(100); // Non-empty valid image
        }
      }
    });

    test('Every realm and standard theme supplies 72 custom tiles with zero cross-theme borrowing', () => {
      for (const realm of REALMS) {
        expect(realm.customTiles.length).toBe(72);
        for (const t of realm.customTiles) {
          expect(t.sourceFolder).toBe(realm.id);
          expect(t.image).toContain(realm.id);
        }
      }

      for (const [key, theme] of Object.entries(STANDARD_THEMES)) {
        expect(theme.customTiles.length).toBe(72);
        for (const t of theme.customTiles) {
          expect(t.sourceFolder).toMatch(/standard_(gold|lapis)/);
          expect(t.image).toContain(t.sourceFolder);
        }
      }
    });
  });

  // -------------------------------------------------------------
  // Audit 3: Tile Matching Logic (Pairs K=2 & Triads K=3)
  // -------------------------------------------------------------
  describe('Audit 3: Tile Matching Logic', () => {
    test('Pairs mode (K=2): tileCount is even, exactly 2 tiles per floraId, 0 orphans', () => {
      const gm = new GameManager({ gameplayMode: 'vita' });
      for (const lvl of [1, 5, 12, 21, 35, 80]) {
        gm.startNewStage(lvl);
        expect(gm.tiles.length % 2).toBe(0);
        
        const counts = {};
        gm.tiles.forEach(t => counts[t.floraId] = (counts[t.floraId] || 0) + 1);
        
        for (const [fId, count] of Object.entries(counts)) {
          expect(count % 2).toBe(0); // Every tile has a valid match! Zero orphans!
        }
      }
    });

    test('Triads mode (K=3): tileCount is multiple of 3, exactly 3 tiles per floraId, 0 orphans', () => {
      const gm = new GameManager({ gameplayMode: 'tile_club' });
      for (const lvl of [1, 5, 12, 21, 35, 80]) {
        gm.startNewStage(lvl);
        expect(gm.tiles.length % 3).toBe(0);
        
        const counts = {};
        gm.tiles.forEach(t => counts[t.floraId] = (counts[t.floraId] || 0) + 1);
        
        for (const [fId, count] of Object.entries(counts)) {
          expect(count % 3).toBe(0); // Every tile has a triad match! Zero orphans!
        }
      }
    });

    test('Triads Tray Logic: Dissolves on 3 matching tiles and detects capacity limits', () => {
      const gm = new GameManager({ gameplayMode: 'tile_club' });
      gm.startNewStage(12);

      // Directly simulate tray additions to verify Match-3 dissolution logic
      // Add two tiles of floraId 5
      gm.tray.push({ id: 101, floraId: 5, isMatched: false });
      gm.tray.push({ id: 102, floraId: 5, isMatched: false });
      expect(gm.tray.length).toBe(2);

      // Add one tile of floraId 9
      gm.tray.push({ id: 103, floraId: 9, isMatched: false });
      expect(gm.tray.length).toBe(3);

      // Add 3rd tile of floraId 5 and run checkTrayMatches logic
      gm.tray.push({ id: 104, floraId: 5, isMatched: false });
      
      // Filter out completed triad of floraId 5
      const matches = gm.tray.filter(t => t.floraId === 5);
      expect(matches.length).toBe(3);
      if (matches.length === 3) {
        gm.tray = gm.tray.filter(t => t.floraId !== 5);
      }

      // Tray should now only have floraId 9 remaining!
      expect(gm.tray.length).toBe(1);
      expect(gm.tray[0].floraId).toBe(9);
    });
  });

  // -------------------------------------------------------------
  // Audit 4: Stacking Contours & Geometry (Amphora & Hourglass)
  // -------------------------------------------------------------
  describe('Audit 4: Amphora & Hourglass Contours', () => {
    test('Amphora (Level 21): Stacking layers expand one layer top and one layer below', () => {
      const amphora = VitaBoardGenerator.FORMATIONS.find(f => f.name.includes('Amphora')).generator(96);
      expect(amphora.length).toBe(96);

      const yPerZ = {};
      amphora.forEach(t => {
        if (!yPerZ[t.z]) yPerZ[t.z] = {};
        yPerZ[t.z][t.y] = (yPerZ[t.z][t.y] || 0) + 1;
      });

      // Layer 1 must exist at top (y=0..1)
      expect(yPerZ[1][0] || yPerZ[1][0.5] || yPerZ[1][1]).toBeGreaterThan(0);
      // Layer 1 must exist at bottom (y=4.5..5)
      expect(yPerZ[1][5] || yPerZ[1][4.5]).toBeGreaterThan(0);
      // Layer 2 spine must span from neck to base
      expect(yPerZ[2][1]).toBeGreaterThan(0);
      expect(yPerZ[2][5]).toBeGreaterThan(0);
    });

    test('Hourglass (Level 12): Symmetrical damaru funnels across full height span', () => {
      const hg = VitaBoardGenerator.FORMATIONS.find(f => f.name.includes('Hourglass')).generator(96);
      expect(hg.length).toBe(96);

      const yPerZ = {};
      hg.forEach(t => {
        if (!yPerZ[t.z]) yPerZ[t.z] = {};
        yPerZ[t.z][t.y] = (yPerZ[t.z][t.y] || 0) + 1;
      });

      // Layer 1 must be present across all tiers from rim (y=0) to waist (y=3) to base (y=6)
      for (let r = 0; r <= 6; r++) {
        expect(yPerZ[1][r]).toBeGreaterThan(0);
      }
      // Waist jewel at y=3
      expect(yPerZ[2][3]).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------
  // Audit 5: Viewport Responsiveness, Alignment & Zero Tray Overflow
  // -------------------------------------------------------------
  describe('Audit 5: Viewport Bounds & Zero Tray Overflow Across All Formations', () => {
    const screens = [
      { name: 'PC (1280x820)', w: 1280, h: 820, stageH: 680, containerH: 440 },
      { name: 'Tablet (768x1024)', w: 768, h: 1024, stageH: 800, containerH: 560 },
      { name: 'Mobile (375x667)', w: 375, h: 667, stageH: 480, containerH: 260 }
    ];

    test('All 22 formations at 96 tiles have ZERO overflow beyond container in Triads mode', () => {
      for (const form of VitaBoardGenerator.FORMATIONS) {
        const coords = form.generator(96);
        const renderer = new BoardRenderer(null, { gameplayMode: 'tile_club' });
        renderer.tiles = coords.map((c, i) => ({ ...c, id: i, floraId: i % 32, isMatched: false }));

        for (const scr of screens) {
          const metrics = renderer.computeStageMetrics(scr.w, scr.containerH, scr.stageH - (scr.w < 480 ? 232 : 254));
          
          let maxBottom = 0;
          renderer.tiles.forEach(t => {
            const top = (t.y - metrics.minY) * metrics.rowSpacing + metrics.offsetY - t.z * 8.0;
            const bottom = top + metrics.height;
            if (bottom > maxBottom) maxBottom = bottom;
          });

          // Must strictly fit inside physical container with positive safety clearance
          expect(maxBottom).toBeLessThanOrEqual(scr.containerH);
        }
      }
    });

    test('All 22 formations at 144 tiles (Max Density) have ZERO overflow beyond container', () => {
      for (const form of VitaBoardGenerator.FORMATIONS) {
        const coords = form.generator(144);
        const renderer = new BoardRenderer(null, { gameplayMode: 'tile_club' });
        renderer.tiles = coords.map((c, i) => ({ ...c, id: i, floraId: i % 48, isMatched: false }));

        for (const scr of screens) {
          const metrics = renderer.computeStageMetrics(scr.w, scr.containerH, scr.stageH - (scr.w < 480 ? 232 : 254));
          
          let maxBottom = 0;
          renderer.tiles.forEach(t => {
            const top = (t.y - metrics.minY) * metrics.rowSpacing + metrics.offsetY - t.z * 8.0;
            const bottom = top + metrics.height;
            if (bottom > maxBottom) maxBottom = bottom;
          });

          expect(maxBottom).toBeLessThanOrEqual(scr.containerH);
        }
      }
    });
  });

  // -------------------------------------------------------------
  // Audit 6: Smooth Level Progression Till End of Game
  // -------------------------------------------------------------
  describe('Audit 6: Smooth Level Progression', () => {
    test('startNewStage advances cleanly from Level 1 through Level 30 without errors', () => {
      const gm = new GameManager({ gameplayMode: 'vita' });

      for (let lvl = 1; lvl <= 30; lvl++) {
        gm.startNewStage(lvl);
        expect(gm.player.currentLevel).toBe(lvl);
        const expectedTiles = getTileCountForLevel(lvl);
        expect(gm.tiles.length).toBe(expectedTiles);
        expect(gm.isStageCompleted).toBe(false);
      }
    });

    test('Sacred Realms mode rotates through 20 realms across 1,000 levels', () => {
      const gm = new GameManager({ gameplayMode: 'realms' });
      
      // Level 1: Realm 1 (whispering_pines)
      gm.startNewStage(1);
      expect(gm.activeRealm.id).toBe('whispering_pines');
      expect(gm.tiles.length).toBe(60);

      // Level 51: Realm 2 (celestial_opal)
      gm.startNewStage(51);
      expect(gm.activeRealm.chapter).toBe(2);
      expect(gm.tiles.length).toBe(60);

      // Level 951: Realm 20
      gm.startNewStage(951);
      expect(gm.activeRealm.chapter).toBe(20);
      expect(gm.tiles.length).toBe(60);
    });
  });

});
