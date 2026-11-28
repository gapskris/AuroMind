/**
 * AuroMasti B19.8.2 — Migration Safety, Execution Boundary Enforcement & Manifest Verification Tests
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  runSupabaseCli,
  executeRemoteMigrations,
  validateMigrationExecutionGate,
  computeMigrationManifest,
  verifyMigrationManifest,
  generateMigrationBundle,
  loadMigrationHistory,
  CANONICAL_PROJECT_REF,
  EXPECTED_MIGRATION_COUNT
} from './scripts/migration-workflow.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = __dirname;

describe('B19.8.2 Migration Execution Boundary & Direct Invocation Guard', () => {
  test('runSupabaseCli throws CRITICAL_SECURITY_VIOLATION when db push is called without _authorizedByGate', () => {
    assert.throws(
      () => {
        runSupabaseCli(['db', 'push', '--project-ref', CANONICAL_PROJECT_REF], {
          rootDir: REPO_ROOT,
          _authorizedByGate: false
        });
      },
      /CRITICAL_SECURITY_VIOLATION.*validateMigrationExecutionGate/
    );
  });

  test('runSupabaseCli allows non-mutating dry-run push without _authorizedByGate', () => {
    // Should not throw security violation because --dry-run is present
    // It may throw a CLI execution error or fail to connect, but NOT the critical security violation
    try {
      runSupabaseCli(['db', 'push', '--dry-run', '--project-ref', CANONICAL_PROJECT_REF], {
        rootDir: REPO_ROOT,
        _authorizedByGate: false
      });
    } catch (err) {
      assert.ok(
        !err.message.includes('CRITICAL_SECURITY_VIOLATION'),
        'Dry run must not trigger the mutating push security violation'
      );
    }
  });
});

describe('B19.8.2 Cryptographic Manifest Integrity & Tamper Detection', () => {
  test('Recorded migrations_manifest.json matches current migration directory exactly', () => {
    const result = verifyMigrationManifest(REPO_ROOT);
    assert.strictEqual(result.valid, true, `Manifest verification failed: ${result.issues.join(', ')}`);
    assert.strictEqual(result.migrationCount, EXPECTED_MIGRATION_COUNT);
    assert.ok(result.manifestSha256 && result.manifestSha256.length === 64);
  });

  test('computeMigrationManifest creates deterministic hash for canonical migrations', () => {
    const migrations = loadMigrationHistory(path.join(REPO_ROOT, 'supabase', 'migrations'));
    const manifest1 = computeMigrationManifest(migrations);
    const manifest2 = computeMigrationManifest(migrations);
    assert.strictEqual(manifest1.manifestSha256, manifest2.manifestSha256);
    assert.strictEqual(manifest1.migrationCount, EXPECTED_MIGRATION_COUNT);
  });

  test('verifyMigrationManifest detects modified migration checksum', () => {
    const manifestPath = path.join(REPO_ROOT, 'supabase', 'migrations_manifest.json');
    const originalContent = fs.readFileSync(manifestPath, 'utf8');

    try {
      const parsed = JSON.parse(originalContent);
      // Alter one checksum in manifest to simulate divergence
      parsed.migrations[0].sha256 = '0000000000000000000000000000000000000000000000000000000000000000';
      parsed.manifestSha256 = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
      fs.writeFileSync(manifestPath, JSON.stringify(parsed, null, 2), 'utf8');

      const verification = verifyMigrationManifest(REPO_ROOT);
      assert.strictEqual(verification.valid, false);
      assert.ok(verification.issues.some(i => i.includes('CHECKSUM_DIVERGENCE') || i.includes('MANIFEST_CHECKSUM_MISMATCH')));
    } finally {
      fs.writeFileSync(manifestPath, originalContent, 'utf8');
    }
  });
});

describe('B19.8.2 Programmatic Migration Execution & 8-Gate Integration Guard', () => {
  function getValidSetup() {
    const migrations = loadMigrationHistory(path.join(REPO_ROOT, 'supabase', 'migrations'));
    const manifest = computeMigrationManifest(migrations);

    const validEvidence = {
      remoteMigrationHistoryVerified: true,
      remoteConnectivityConfirmed: true,
      remoteSchemaInspected: true,
      localMigrationsCompared: true,
      migrationDivergenceResolved: true,
      executionPreviewGenerated: true,
      backupReadinessConfirmed: true,
      preflightTimestamp: new Date().toISOString(),
      preflightManifestSha256: manifest.manifestSha256
    };

    const validApproval = {
      approvedBy: 'Lead Product Owner',
      approvedAt: new Date().toISOString(),
      approvedManifestSha256: manifest.manifestSha256,
      migrationSetCount: EXPECTED_MIGRATION_COUNT,
      targetProjectRef: CANONICAL_PROJECT_REF,
      explicitStatement: 'I AUTHORIZE MIGRATION EXECUTION FOR AUROMASTI'
    };

    return { manifest, validEvidence, validApproval };
  }

  test('executeRemoteMigrations blocks execution when gateEvidence is missing or null', () => {
    const { validApproval } = getValidSetup();
    assert.throws(
      () => {
        executeRemoteMigrations({
          gateEvidence: null,
          productOwnerApproval: validApproval,
          rootDir: REPO_ROOT
        });
      },
      /Missing or invalid gateEvidence/
    );
  });

  test('executeRemoteMigrations blocks execution when preflight is stale (> 30 mins)', () => {
    const { validEvidence, validApproval } = getValidSetup();
    const staleEvidence = {
      ...validEvidence,
      preflightTimestamp: new Date(Date.now() - 45 * 60 * 1000).toISOString() // 45 mins ago
    };

    assert.throws(
      () => {
        executeRemoteMigrations({
          gateEvidence: staleEvidence,
          productOwnerApproval: validApproval,
          rootDir: REPO_ROOT
        });
      },
      /Stale preflight evidence/
    );
  });

  test('executeRemoteMigrations blocks execution when preflight manifest does not match current migrations', () => {
    const { validEvidence, validApproval } = getValidSetup();
    const mismatchedEvidence = {
      ...validEvidence,
      preflightManifestSha256: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
    };

    assert.throws(
      () => {
        executeRemoteMigrations({
          gateEvidence: mismatchedEvidence,
          productOwnerApproval: validApproval,
          rootDir: REPO_ROOT
        });
      },
      /Stale or mismatched preflight evidence/
    );
  });

  test('executeRemoteMigrations blocks execution when Product Owner approval is missing or a boolean', () => {
    const { validEvidence } = getValidSetup();
    assert.throws(
      () => {
        executeRemoteMigrations({
          gateEvidence: validEvidence,
          productOwnerApproval: true, // Boolean shortcut forbidden
          rootDir: REPO_ROOT
        });
      },
      /Missing or invalid productOwnerApproval object/
    );
  });

  test('executeRemoteMigrations blocks execution when PO approval targets different manifest hash', () => {
    const { validEvidence, validApproval } = getValidSetup();
    const mismatchedApproval = {
      ...validApproval,
      approvedManifestSha256: 'bad0bad0bad0bad0bad0bad0bad0bad0bad0bad0bad0bad0bad0bad0bad0bad0'
    };

    assert.throws(
      () => {
        executeRemoteMigrations({
          gateEvidence: validEvidence,
          productOwnerApproval: mismatchedApproval,
          rootDir: REPO_ROOT
        });
      },
      /Approval manifest hash .* does not match current migration manifest hash/
    );
  });

  test('executeRemoteMigrations blocks execution when PO approval targets wrong project reference', () => {
    const { validEvidence, validApproval } = getValidSetup();
    const wrongProjectApproval = {
      ...validApproval,
      targetProjectRef: 'unexpected_foreign_project'
    };

    assert.throws(
      () => {
        executeRemoteMigrations({
          gateEvidence: validEvidence,
          productOwnerApproval: wrongProjectApproval,
          rootDir: REPO_ROOT
        });
      },
      /Approval targets project 'unexpected_foreign_project'/
    );
  });

  test('executeRemoteMigrations blocks execution when PO approval is stale (> 60 mins)', () => {
    const { validEvidence, validApproval } = getValidSetup();
    const staleApproval = {
      ...validApproval,
      approvedAt: new Date(Date.now() - 90 * 60 * 1000).toISOString() // 90 mins ago
    };

    assert.throws(
      () => {
        executeRemoteMigrations({
          gateEvidence: validEvidence,
          productOwnerApproval: staleApproval,
          rootDir: REPO_ROOT
        });
      },
      /Stale Product Owner approval/
    );
  });

  test('executeRemoteMigrations blocks execution when explicit authorization statement is missing', () => {
    const { validEvidence, validApproval } = getValidSetup();
    const missingStatementApproval = {
      ...validApproval,
      explicitStatement: 'Looks good to me'
    };

    assert.throws(
      () => {
        executeRemoteMigrations({
          gateEvidence: validEvidence,
          productOwnerApproval: missingStatementApproval,
          rootDir: REPO_ROOT
        });
      },
      /Missing explicit authorization statement in Product Owner approval/
    );
  });

  test('executeRemoteMigrations blocks execution when approvedBy is missing, empty, or non-attributable', () => {
    const { validEvidence, validApproval } = getValidSetup();
    
    // 1. Missing approvedBy
    assert.throws(
      () => {
        executeRemoteMigrations({
          gateEvidence: validEvidence,
          productOwnerApproval: { ...validApproval, approvedBy: '' },
          rootDir: REPO_ROOT
        });
      },
      /Product Owner approval must be explicitly attributable \(missing approvedBy\)/
    );

    // 2. Whitespace-only approvedBy
    assert.throws(
      () => {
        executeRemoteMigrations({
          gateEvidence: validEvidence,
          productOwnerApproval: { ...validApproval, approvedBy: '   ' },
          rootDir: REPO_ROOT
        });
      },
      /Product Owner approval must be explicitly attributable \(missing approvedBy\)/
    );
  });

  test('executeRemoteMigrations blocks execution when migrationSetCount does not match EXPECTED_MIGRATION_COUNT', () => {
    const { validEvidence, validApproval } = getValidSetup();
    assert.throws(
      () => {
        executeRemoteMigrations({
          gateEvidence: validEvidence,
          productOwnerApproval: { ...validApproval, migrationSetCount: 9 },
          rootDir: REPO_ROOT
        });
      },
      /Approval scopes 9 migrations, but repository requires exactly 10/
    );
  });

  // Individual failure conditions for each of the 7 other gates
  const gateTestMatrix = [
    { key: 'remoteMigrationHistoryVerified', name: 'Gate 1 (Remote History)' },
    { key: 'remoteConnectivityConfirmed', name: 'Gate 2 (Remote Connectivity)' },
    { key: 'remoteSchemaInspected', name: 'Gate 3 (Remote Schema)' },
    { key: 'localMigrationsCompared', name: 'Gate 4 (Local Migrations)' },
    { key: 'migrationDivergenceResolved', name: 'Gate 5 (Divergence Resolved)' },
    { key: 'executionPreviewGenerated', name: 'Gate 6 (Preview Generated)' },
    { key: 'backupReadinessConfirmed', name: 'Gate 7 (Backup Readiness)' }
  ];

  for (const { key, name } of gateTestMatrix) {
    test(`executeRemoteMigrations fails closed when ${name} is false`, () => {
      const { validEvidence, validApproval } = getValidSetup();
      const brokenEvidence = {
        ...validEvidence,
        [key]: false
      };

      assert.throws(
        () => {
          executeRemoteMigrations({
            gateEvidence: brokenEvidence,
            productOwnerApproval: validApproval,
            rootDir: REPO_ROOT
          });
        },
        /MIGRATION_EXECUTION_BLOCKED: MIGRATION_EXECUTION_GATE_BLOCKED: 1 of 8 conditions unsatisfied/
      );
    });
  }

  test('executeRemoteMigrations proceeds to CLI runner with _authorizedByGate ONLY when all conditions pass', () => {
    const { validEvidence, validApproval } = getValidSetup();
    let runnerCalledWith = null;

    const mockRunner = (args, options) => {
      runnerCalledWith = { args, options };
      return 'MOCK_CLI_SUCCESS: Applied 10 migrations';
    };

    const res = executeRemoteMigrations({
      gateEvidence: validEvidence,
      productOwnerApproval: validApproval,
      rootDir: REPO_ROOT,
      _cliRunner: mockRunner
    });

    assert.strictEqual(res, 'MOCK_CLI_SUCCESS: Applied 10 migrations');
    assert.ok(runnerCalledWith !== null, 'CLI runner must be called');
    assert.deepStrictEqual(runnerCalledWith.args, ['db', 'push', '--project-ref', CANONICAL_PROJECT_REF]);
    assert.strictEqual(runnerCalledWith.options._authorizedByGate, true, '_authorizedByGate must be set to true');
  });
});

describe('B19.8.2 Manual SQL Fallback Architectural Warnings', () => {
  test('generateMigrationBundle includes explicit B82-03 warning against direct dashboard ledger bypass', () => {
    const migrations = loadMigrationHistory(path.join(REPO_ROOT, 'supabase', 'migrations'));
    const bundle = generateMigrationBundle(migrations);

    assert.ok(
      bundle.includes('ARCHITECTURAL WARNING (B82-03)'),
      'Bundle must include explicit B82-03 architectural warning'
    );
    assert.ok(
      bundle.includes('DOES NOT update the Supabase CLI migration ledger'),
      'Bundle must warn that dashboard execution bypasses schema_migrations'
    );
    assert.ok(
      bundle.includes('supabase migration repair --status applied'),
      'Bundle must state that manual disaster-recovery requires migration repair'
    );
  });
});
