/**
 * B19.8.1 Governance, Schema, SW & Sacred Invariant Verification Test Suite
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  validateMigrationExecutionGate,
  generatePostMigrationVerificationSql,
  loadMigrationHistory
} from './scripts/migration-workflow.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = __dirname;

describe('B19.8.1 Governance & Migration Execution Gate', () => {
  test('validateMigrationExecutionGate fails closed by default when no arguments are passed', () => {
    const result = validateMigrationExecutionGate();
    assert.strictEqual(result.authorized, false);
    assert.strictEqual(result.status, 'LOCKED');
    assert.strictEqual(result.gateCount, 8);
    assert.strictEqual(result.satisfiedCount, 0);
    assert.strictEqual(result.failedGates.length, 8);
    assert.ok(result.summary.includes('MIGRATION_EXECUTION_GATE_BLOCKED: 8 of 8 conditions unsatisfied'));
  });

  test('validateMigrationExecutionGate fails closed if any single gate is missing or false', () => {
    const fullApproval = {
      remoteMigrationHistoryVerified: true,
      remoteConnectivityConfirmed: true,
      remoteSchemaInspected: true,
      localMigrationsCompared: true,
      migrationDivergenceResolved: true,
      executionPreviewGenerated: true,
      backupReadinessConfirmed: true,
      productOwnerApproved: true
    };

    const keys = Object.keys(fullApproval);
    for (const key of keys) {
      const partial = { ...fullApproval, [key]: false };
      const res = validateMigrationExecutionGate(partial);
      assert.strictEqual(res.authorized, false, `Gate must fail closed when ${key} is false`);
      assert.strictEqual(res.status, 'LOCKED');
      assert.strictEqual(res.failedGates.length, 1);
    }
  });

  test('validateMigrationExecutionGate unlocks only when all 8 gates are satisfied', () => {
    const res = validateMigrationExecutionGate({
      remoteMigrationHistoryVerified: true,
      remoteConnectivityConfirmed: true,
      remoteSchemaInspected: true,
      localMigrationsCompared: true,
      migrationDivergenceResolved: true,
      executionPreviewGenerated: true,
      backupReadinessConfirmed: true,
      productOwnerApproved: true
    });

    assert.strictEqual(res.authorized, true);
    assert.strictEqual(res.status, 'UNLOCKED');
    assert.strictEqual(res.satisfiedCount, 8);
    assert.strictEqual(res.failedGates.length, 0);
    assert.ok(res.summary.includes('All 8 migration execution gates satisfied'));
  });
});

describe('B19.8.1 Database Schema Table Count & Verification Script', () => {
  test('loadMigrationHistory detects 15 distinct tables across all 10 migrations', () => {
    const migrations = loadMigrationHistory(path.join(REPO_ROOT, 'supabase', 'migrations'));
    assert.strictEqual(migrations.length, 10);

    const allTables = new Set();
    for (const m of migrations) {
      for (const t of m.tables) {
        allTables.add(t.replace(/^public\./, ''));
      }
    }

    assert.strictEqual(allTables.size, 15, `Expected 15 public tables, found: ${Array.from(allTables).join(', ')}`);
    assert.ok(allTables.has('telemetry_rate_buckets'), 'telemetry_rate_buckets unlogged table must be captured');
    assert.ok(allTables.has('user_profiles'));
    assert.ok(allTables.has('game_saves'));
    assert.ok(allTables.has('entitlements'));
    assert.ok(allTables.has('storage_deletion_queue'));
  });

  test('generatePostMigrationVerificationSql includes all 15 expected tables and proper notice', () => {
    const sql = generatePostMigrationVerificationSql();
    assert.ok(sql.includes("'telemetry_rate_buckets'"), 'Generated SQL must include telemetry_rate_buckets');
    assert.ok(sql.includes('All 15 expected public tables exist'), 'Generated SQL header must state 15 tables');
    assert.ok(sql.includes('SUCCESS: All 15 public tables verified'), 'Generated SQL notice must state 15 tables');
  });

  test('supabase/verify_remote_schema.sql matches the 15-table expectation', () => {
    const sqlPath = path.join(REPO_ROOT, 'supabase', 'verify_remote_schema.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    assert.ok(sql.includes("'telemetry_rate_buckets'"), 'verify_remote_schema.sql must include telemetry_rate_buckets');
    assert.ok(sql.includes('All 15 expected public tables exist'), 'verify_remote_schema.sql header must state 15 tables');
    assert.ok(sql.includes('SUCCESS: All 15 public tables verified'), 'verify_remote_schema.sql notice must state 15 tables');
  });
});

describe('B19.8.1 Service Worker Shared SDK Offline Delivery', () => {
  test('sw.js allows assets/sdk/* delivery without game referrer bypass blockage', () => {
    const swPath = path.join(REPO_ROOT, 'sw.js');
    const swCode = fs.readFileSync(swPath, 'utf8');

    assert.ok(
      swCode.includes("relPath.startsWith('assets/sdk/')") || swCode.includes("isSdkAsset"),
      'sw.js must explicitly treat all assets/sdk/* requests as SDK assets'
    );
    assert.ok(
      swCode.includes('!isSdkAsset && request.referrer && request.referrer.includes(\'/games/\')') ||
      swCode.includes('!relPath.startsWith(\'assets/sdk/\')'),
      'sw.js must exempt all SDK assets from the game referrer bypass'
    );
  });
});

describe('B19.8.1 Game Theater Exit & PostMessage Alignment', () => {
  test('games/auromatch/src/main.js sends gameId in AUROMIND_CLOSE_THEATER', () => {
    const mainJsPath = path.join(REPO_ROOT, 'games/auromatch/src/main.js');
    const content = fs.readFileSync(mainJsPath, 'utf8');

    assert.ok(
      content.includes("window.parent.postMessage({ type: 'AUROMIND_CLOSE_THEATER', gameId: 'auromatch' }"),
      'auromatch exitToAuroMindPortal must explicitly include gameId: auromatch'
    );
  });

  test('assets/js/portal.js strictly validates gameId and alias for AUROMIND_CLOSE_THEATER', () => {
    const portalJsPath = path.join(REPO_ROOT, 'assets/js/portal.js');
    const content = fs.readFileSync(portalJsPath, 'utf8');

    assert.ok(
      content.includes("data.type === 'AUROMIND_CLOSE_THEATER' || data.action === 'EXIT_GAME'"),
      'portal.js must handle AUROMIND_CLOSE_THEATER'
    );
    assert.ok(
      content.includes("if (!data.gameId || typeof data.gameId !== 'string') return;"),
      'portal.js must strictly require non-empty string gameId'
    );
    assert.ok(
      content.includes('validAliases.includes(normPayload)'),
      'portal.js must validate against GAME_ID_ALIASES'
    );
  });
});

describe('B19.8.1 Sacred Invariants and Hash Verification', () => {
  test('Sacred Invariant 1: games/vak/index.html full file SHA-256', () => {
    const vakPath = path.join(REPO_ROOT, 'games/vak/index.html');
    const content = fs.readFileSync(vakPath);
    const hash = crypto.createHash('sha256').update(content).digest('hex').toUpperCase();
    assert.strictEqual(
      hash,
      'A8E2EF8B9B5E7F95B231C75B185C3DDEB61EA8FCB4C25C85FABC6872FA780360',
      'Vak full HTML hash must match canonical invariant'
    );
  });

  test('Sacred Invariant 2: VAK corpus const CL substring SHA-256', () => {
    const vakPath = path.join(REPO_ROOT, 'games/vak/index.html');
    const contentStr = fs.readFileSync(vakPath, 'utf8');
    const clMatch = contentStr.match(/const CL = \[\[[\s\S]*?\]\];/);
    assert.ok(clMatch, 'const CL array must be extractable from games/vak/index.html');
    const hash = crypto.createHash('sha256').update(clMatch[0], 'utf8').digest('hex');
    assert.strictEqual(
      hash,
      '9fdb3826030049c9eab183479bcb7fe29304b3ea08d045c8c67f1cfd4d77da09',
      'Vak corpus const CL substring hash must match canonical invariant'
    );
  });

  test('Sacred Invariant 3: games/auromatch/src/models/floraDatabase.js SHA-256', () => {
    const floraPath = path.join(REPO_ROOT, 'games/auromatch/src/models/floraDatabase.js');
    const content = fs.readFileSync(floraPath);
    const hash = crypto.createHash('sha256').update(content).digest('hex').toLowerCase();
    assert.strictEqual(
      hash,
      '689d035cd52abd8d342528d8c5f61f298916b8052b8287450be4931cf8ae1a3a',
      'Flora database SHA-256 must match canonical invariant'
    );
  });

  test('Sacred Invariant 4: COMMERCIAL_GATE_ENABLED = false in backend-config.js', () => {
    const configPath = path.join(REPO_ROOT, 'assets/sdk/config/backend-config.js');
    const content = fs.readFileSync(configPath, 'utf8');
    assert.match(
      content,
      /export\s+const\s+COMMERCIAL_GATE_ENABLED\s*=\s*false/,
      'COMMERCIAL_GATE_ENABLED must remain false in backend-config.js'
    );
  });
});
