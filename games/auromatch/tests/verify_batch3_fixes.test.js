import { describe, test, expect, beforeEach } from 'bun:test';
import fs from 'fs';
import { GameManager } from '../src/controllers/gameManager.js';
import { syncTeachingsRepository } from '../src/controllers/storageAdapter.js';

// Setup mock localStorage
const mockStorage = {};
globalThis.localStorage = {
  getItem: (k) => (k in mockStorage ? mockStorage[k] : null),
  setItem: (k, v) => { mockStorage[k] = String(v); },
  removeItem: (k) => { delete mockStorage[k]; },
  clear: () => { for (const k in mockStorage) delete mockStorage[k]; }
};

describe('Batch 3 Quality Audit & Defect Fixes Verification', () => {

  const html = fs.readFileSync('C:/AuroMatch/AuroMatch_Web_Prototype.html', 'utf8');

  beforeEach(() => {
    localStorage.clear();
  });

  // -------------------------------------------------------------
  // TEST SUITE 1: DEF-06 (Mid-Game In-Progress Session Persistence)
  // -------------------------------------------------------------
  describe('DEF-06: In-Progress Mid-Game Session Persistence Verification', () => {
    let gm;
    beforeEach(() => {
      gm = new GameManager();
      gm.gameplayMode = 'tile_club';
      gm.player = { name: 'LotusSeeker', score: 0, sparks: 100, currentLevel: 5 };
      gm.tiles = [
        { id: 't1', floraId: 'lotus', isMatched: false },
        { id: 't2', floraId: 'lotus', isMatched: false },
        { id: 't3', floraId: 'lotus', isMatched: false },
        { id: 't4', floraId: 'rose', isMatched: false },
        { id: 't5', floraId: 'rose', isMatched: false },
        { id: 't6', floraId: 'rose', isMatched: false }
      ];
      gm.tray = [];
      gm.hintsUsedInStage = 0;
      gm.shufflesUsedInStage = 0;
    });

    test('DEF-06.1: saveActiveBoardSession saves active and tray state accurately', () => {
      // Move 2 tiles to tray
      gm.tiles[0].isMatched = true; // In tray
      gm.tiles[1].isMatched = true; // In tray
      gm.tray = [gm.tiles[0], gm.tiles[1]];
      gm.hintsUsedInStage = 1;
      gm.shufflesUsedInStage = 2;

      gm.saveActiveBoardSession();

      const raw = localStorage.getItem('auromatch_active_session');
      expect(raw).not.toBeNull();
      const session = JSON.parse(raw);
      expect(session.level).toBe(5);
      expect(session.gameplayMode).toBe('tile_club');
      expect(session.trayTileIds).toEqual(['t1', 't2']);
      expect(session.activeTileIds).toEqual(['t3', 't4', 't5', 't6']);
      expect(session.hintsUsed).toBe(1);
      expect(session.shufflesUsed).toBe(2);
    });

    test('DEF-06.2: tryRestoreActiveBoardSession accurately reconstructs partial board and tray on page reload', () => {
      // Simulate saved session from mid-game
      const mockSession = {
        level: 5,
        gameplayMode: 'tile_club',
        activeTileIds: ['t4', 't5', 't6'],
        trayTileIds: ['t3'],
        elapsedSec: 45,
        hintsUsed: 2,
        shufflesUsed: 1,
        timestamp: Date.now()
      };
      localStorage.setItem('auromatch_active_session', JSON.stringify(mockSession));

      // Re-create manager simulating a fresh page reload
      const newGm = new GameManager();
      newGm.gameplayMode = 'tile_club';
      newGm.player = { name: 'LotusSeeker', score: 0, sparks: 100, currentLevel: 5 };
      newGm.tiles = [
        { id: 't1', floraId: 'lotus', isMatched: false },
        { id: 't2', floraId: 'lotus', isMatched: false },
        { id: 't3', floraId: 'lotus', isMatched: false },
        { id: 't4', floraId: 'rose', isMatched: false },
        { id: 't5', floraId: 'rose', isMatched: false },
        { id: 't6', floraId: 'rose', isMatched: false }
      ];

      const restored = newGm.tryRestoreActiveBoardSession();
      expect(restored).toBe(true);

      // t1 and t2 were matched pairs dissolved previously
      expect(newGm.tiles.find(t => t.id === 't1').isMatched).toBe(true);
      expect(newGm.tiles.find(t => t.id === 't2').isMatched).toBe(true);
      // t3 is in tray
      expect(newGm.tray.length).toBe(1);
      expect(newGm.tray[0].id).toBe('t3');
      // t4, t5, t6 remain active on board
      expect(newGm.tiles.find(t => t.id === 't4').isMatched).toBe(false);
      expect(newGm.tiles.find(t => t.id === 't5').isMatched).toBe(false);
      expect(newGm.tiles.find(t => t.id === 't6').isMatched).toBe(false);

      expect(newGm.hintsUsedInStage).toBe(2);
      expect(newGm.shufflesUsedInStage).toBe(1);
      expect(newGm.stageElapsedBeforePause).toBe(45000);
    });

    test('DEF-06.3: Stale sessions (> 24 hours) are discarded and purged', () => {
      const staleSession = {
        level: 5,
        gameplayMode: 'tile_club',
        activeTileIds: ['t4'],
        trayTileIds: [],
        timestamp: Date.now() - 90000000 // > 24 hrs
      };
      localStorage.setItem('auromatch_active_session', JSON.stringify(staleSession));

      const restored = gm.tryRestoreActiveBoardSession();
      expect(restored).toBe(false);
      expect(localStorage.getItem('auromatch_active_session')).toBeNull();
    });

    test('DEF-06.4: restartStage and completion clear the active board session', () => {
      localStorage.setItem('auromatch_active_session', JSON.stringify({ level: 5 }));
      gm.restartStage();
      expect(localStorage.getItem('auromatch_active_session')).toBeNull();
    });
  });

  // -------------------------------------------------------------
  // TEST SUITE 2: DEF-08 (Campaign Grand Victory & Ending Loop Fix)
  // -------------------------------------------------------------
  describe('DEF-08: Campaign Grand Victory Verification', () => {
    test('DEF-08.1: Clearing final level triggers isCampaignComplete flag in onStageComplete callback', () => {
      const gm = new GameManager();
      gm.gameplayMode = 'vita';
      const maxLevels = gm.getTotalLevels(); // 400
      gm.player = { currentLevel: maxLevels, sparks: 100, score: 0 };
      gm.tiles = [
        { id: 't1', isMatched: true },
        { id: 't2', isMatched: true }
      ];
      gm.tray = [];

      let completionInfo = null;
      gm.onStageComplete = (info) => { completionInfo = info; };

      gm.checkStageCompletion();

      expect(completionInfo).not.toBeNull();
      expect(completionInfo.completedLevel).toBe(maxLevels);
      expect(completionInfo.isCampaignComplete).toBe(true);
      // Player level does not overshoot beyond campaign max
      expect(gm.player.currentLevel).toBe(maxLevels);
    });

    test('DEF-08.2: Clearing non-final level sets isCampaignComplete to false', () => {
      const gm = new GameManager();
      gm.gameplayMode = 'vita';
      gm.player = { currentLevel: 50, sparks: 100, score: 0 };
      gm.tiles = [
        { id: 't1', isMatched: true },
        { id: 't2', isMatched: true }
      ];
      gm.tray = [];

      let completionInfo = null;
      gm.onStageComplete = (info) => { completionInfo = info; };

      gm.checkStageCompletion();

      expect(completionInfo).not.toBeNull();
      expect(completionInfo.completedLevel).toBe(50);
      expect(completionInfo.isCampaignComplete).toBe(false);
      expect(gm.player.currentLevel).toBe(51);
    });

    test('DEF-08.3: Prototype HTML contains Grand Transcendence celebration and sanctuary routing', () => {
      expect(html).toContain('Grand Transcendence Cleared!');
      expect(html).toContain('Return to Sanctuary 🪷');
      expect(html).toContain('window._isCampaignGrandVictory');
      expect(html).toContain('btn-victory-next-level');
    });
  });

  // -------------------------------------------------------------
  // TEST SUITE 3: DEF-10 (Corrupted Teachings JSON Robustness)
  // -------------------------------------------------------------
  describe('DEF-10: Robustness Against Corrupted Teachings JSON Verification', () => {
    test('DEF-10.1: Corrupted auro_match_teachings in localStorage does not throw SyntaxError', () => {
      localStorage.setItem('auro_match_teachings', '{"broken_json": invalid}');

      const remoteRepo = {
        version: 102,
        themes: { lotus: { title: 'Sacred Lotus' } }
      };

      // Must not throw uncaught SyntaxError!
      expect(() => {
        syncTeachingsRepository(remoteRepo);
      }).not.toThrow();

      // Corrupted cache should be replaced with valid remote repo data
      const saved = localStorage.getItem('auro_match_teachings');
      expect(saved).not.toBeNull();
      const parsed = JSON.parse(saved);
      expect(parsed.version).toBe(102);
      expect(parsed.themes.lotus.title).toBe('Sacred Lotus');
    });

    test('DEF-10.2: Prototype HTML syncTeachingsRepository contains defensive try/catch', () => {
      const fnMatch = html.match(/function\s+syncTeachingsRepository[\s\S]*?\{([\s\S]*?)\n\}/);
      expect(fnMatch).not.toBeNull();
      const fnBody = fnMatch[1];
      expect(fnBody).toContain('try {');
      expect(fnBody).toContain('catch (e)');
      expect(fnBody).toContain('isCorrupted = true');
    });
  });

  // -------------------------------------------------------------
  // TEST SUITE 4: DEF-11 (Clean Solve Bonus Requires 0 Shuffles)
  // -------------------------------------------------------------
  describe('DEF-11: Clean Solve Bonus Disqualification by Shuffles Verification', () => {
    test('DEF-11.1: 0 Hints and 0 Shuffles earns clean solve bonus sparks (+5) and score (+500)', () => {
      const gm = new GameManager();
      gm.player = { currentLevel: 1, sparks: 100, score: 0, focusIQ: 80 };
      gm.tiles = [{ id: 't1', isMatched: true }, { id: 't2', isMatched: true }];
      gm.tray = [];
      gm.hintsUsedInStage = 0;
      gm.shufflesUsedInStage = 0;

      let completionInfo = null;
      gm.onStageComplete = (info) => { completionInfo = info; };

      gm.checkStageCompletion();

      expect(completionInfo.cleanSolve).toBe(true);
      // Clean solve bonus: 10 base + 5 clean + 15 PR = 30 sparks (or 15 without PR)
      expect(completionInfo.earnedSparks).toBeGreaterThanOrEqual(15);
      // Score: 1000 base + 500 clean = 1500
      expect(gm.player.score).toBe(1500);
      // Focus IQ bonus: +3 for clean solve
      expect(gm.player.focusIQ).toBe(83);
    });

    test('DEF-11.2: 0 Hints but 1+ Shuffles DISQUALIFIES clean solve bonus', () => {
      const gm = new GameManager();
      gm.player = { currentLevel: 1, sparks: 100, score: 0, focusIQ: 80 };
      gm.tiles = [{ id: 't1', isMatched: true }, { id: 't2', isMatched: true }];
      gm.tray = [];
      gm.hintsUsedInStage = 0;
      gm.shufflesUsedInStage = 1; // Used reshuffle!

      let completionInfo = null;
      gm.onStageComplete = (info) => { completionInfo = info; };

      gm.checkStageCompletion();

      expect(completionInfo.cleanSolve).toBe(false);
      // Score: 1000 base only (no 500 clean bonus)
      expect(gm.player.score).toBe(1000);
      // Focus IQ bonus: +2 standard only (not +3)
      expect(gm.player.focusIQ).toBe(82);
    });
  });

  // -------------------------------------------------------------
  // TEST SUITE 5: DEF-12 (Tamper Defense & Integrity Validation)
  // -------------------------------------------------------------
  describe('DEF-12: Tamper Defense & Save State Integrity Verification', () => {
    test('DEF-12.1: savePlayerState attaches cryptographically stable checksum chk', () => {
      const gm = new GameManager();
      gm.player = { name: 'Sadhak', currentLevel: 10, sparks: 350, score: 12500, focusIQ: 98 };
      gm.savePlayerState();

      const saved = JSON.parse(localStorage.getItem('auromatch_player_state'));
      expect(saved.chk).toBeDefined();
      expect(typeof saved.chk).toBe('string');
      expect(saved.chk.length).toBeGreaterThan(0);
      expect(saved.chk).toBe(gm._computeChecksum(saved));
    });

    test('DEF-12.2: Tampered score (99,999,999) and sparks (500,000) on Level 1 are clamped to realistic bounds', () => {
      // Simulate malicious player editing localStorage in devtools
      const tampered = {
        name: 'Hacker',
        currentLevel: 1,
        sparks: 500000,
        score: 99999999,
        focusIQ: 80,
        chk: 'invalid_or_stale_hash'
      };
      localStorage.setItem('auromatch_player_state', JSON.stringify(tampered));

      const gm = new GameManager();
      const loaded = gm.loadPlayerState();

      // On Level 1, maxRealisticScore = 1 * 10,000 = 10,000
      // maxRealisticSparks = 100 + 1 * 200 = 300
      expect(loaded.score).toBeLessThanOrEqual(10000);
      expect(loaded.sparks).toBeLessThanOrEqual(300);
    });

    test('DEF-12.3: Legitimate saved state with matching checksum loads without clamping', () => {
      const gm = new GameManager();
      gm.player = { name: 'Devotee', currentLevel: 15, sparks: 450, score: 25000, focusIQ: 110 };
      gm.savePlayerState();

      const newGm = new GameManager();
      const loaded = newGm.loadPlayerState();

      expect(loaded.currentLevel).toBe(15);
      expect(loaded.sparks).toBe(450);
      expect(loaded.score).toBe(25000);
      expect(loaded.focusIQ).toBe(110);
    });
  });
});
