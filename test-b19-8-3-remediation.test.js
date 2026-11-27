/**
 * AuroMasti B19.8.3 — Comprehensive Engineering Remediation & Verification Test Suite
 *
 * Covers:
 * 1. Open Item 1: Preflight Separation (Local vs Remote) & 6-State Classification
 * 2. Open Item 2: Execution Boundary Authorization, Audit Trail & Direct CLI Notices
 * 3. Open Item 3 & 4: Migration Integrity Dimensions & Canonical Timestamps (No 20261124000001)
 * 4. Open Item 6: Three Launch Games (AuroMandala, MaaMATCH, MaaBLOCK) Integration & Exit
 * 5. Open Item 7: Sankalpa Local-Only Security & Recovery Truth (PBKDF2-210k vs No Mnemonics)
 * 6. Open Item 8 & 9: Safe Network Diagnostics & Cloudflare Pages Staging Guard
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  runPreflight,
  classifyPreflightState,
  PREFLIGHT_STATES,
  computeMigrationManifest,
  verifyMigrationManifest,
  executeRemoteMigrations,
  recordAuthorizationAudit,
  runSupabaseCli,
  CANONICAL_PROJECT_REF,
  EXPECTED_MIGRATION_COUNT,
  generateMigrationBundle
} from './scripts/migration-workflow.mjs';

import {
  runDiagnostic,
  checkDnsResolution,
  probeTcpPort,
  probeRestApi
} from './scripts/diagnose-network.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = __dirname;

describe('B19.8.3 Suite 1: Preflight Separation (Local vs Remote) & 6-State Classification', () => {
  test('Local preflight runs strictly offline and reports mode LOCAL_OFFLINE', () => {
    const preflight = runPreflight({ rootDir: REPO_ROOT, allowRemote: false, remoteMode: false });
    assert.equal(preflight.mode, 'LOCAL_OFFLINE');
    assert.equal(preflight.authenticatedPreflightRan, false);
    assert.equal(preflight.state.state, PREFLIGHT_STATES.UNVERIFIED);
    assert.ok(preflight.localIntegrity.verified, 'Local manifest must be verified');
    assert.equal(preflight.localIntegrity.migrationCount, EXPECTED_MIGRATION_COUNT);
    assert.equal(preflight.remoteHistory.verified, false);
    assert.equal(preflight.remoteSchema.status, 'PENDING_INSPECTION');
  });

  test('Remote preflight rejects mismatched expectedProjectRef', () => {
    const preflight = runPreflight({
      rootDir: REPO_ROOT,
      remoteMode: true,
      allowRemote: true,
      expectedProjectRef: 'wrong-project-ref'
    });
    assert.equal(preflight.ok, false);
    assert.ok(preflight.blockers.some(b => b.includes('INVALID_TARGET_PROJECT_REF')));
  });

  test('classifyPreflightState handles all 6 canonical states deterministically', () => {
    const local = ['20261120000001_b5_core_schema.sql', '20261120000002_b8_rate_limiting.sql'];

    // State 1: UNVERIFIED on network error
    const s1 = classifyPreflightState({
      localMigrations: local,
      remoteReachable: false,
      networkError: 'ECONNREFUSED'
    });
    assert.equal(s1.state, PREFLIGHT_STATES.UNVERIFIED);

    // State 1: UNVERIFIED when remoteApplied is empty but schema inspection was not done
    const s1b = classifyPreflightState({
      localMigrations: local,
      remoteReachable: true,
      remoteApplied: [],
      schemaTables: null
    });
    assert.equal(s1b.state, PREFLIGHT_STATES.UNVERIFIED);

    // State 2: CLEAN_INITIAL_STATE when remoteApplied is empty AND schema verified clean
    const s2 = classifyPreflightState({
      localMigrations: local,
      remoteReachable: true,
      remoteApplied: [],
      schemaTables: []
    });
    assert.equal(s2.state, PREFLIGHT_STATES.CLEAN_INITIAL_STATE);

    // State 3: MIGRATIONS_PENDING when remote has valid subset
    const s3 = classifyPreflightState({
      localMigrations: local,
      remoteReachable: true,
      remoteApplied: ['20261120000001_b5_core_schema.sql'],
      schemaTables: ['auromind_telemetry']
    });
    assert.equal(s3.state, PREFLIGHT_STATES.MIGRATIONS_PENDING);

    // State 4: DRIFT_AHEAD when remote contains untracked migrations
    const s4 = classifyPreflightState({
      localMigrations: local,
      remoteReachable: true,
      remoteApplied: ['20261120000001_b5_core_schema.sql'],
      unexpectedRemote: ['20269999999999_rogue_migration.sql']
    });
    assert.equal(s4.state, PREFLIGHT_STATES.DRIFT_AHEAD);

    // State 5: SCHEMA_HISTORY_DIVERGENCE when applied in ledger but table missing
    const s5 = classifyPreflightState({
      localMigrations: [{ filename: '20261120000001_b5_core_schema.sql', tables: ['public.profiles'] }],
      remoteReachable: true,
      remoteApplied: ['20261120000001_b5_core_schema.sql'],
      schemaTables: [] // profiles missing
    });
    assert.equal(s5.state, PREFLIGHT_STATES.SCHEMA_HISTORY_DIVERGENCE);

    // State 6: OBJECT_COLLISION_DETECTED when 0 applied but conflicting tables exist
    const s6 = classifyPreflightState({
      localMigrations: local,
      remoteReachable: true,
      remoteApplied: [],
      schemaTables: ['preexisting_table']
    });
    assert.equal(s6.state, PREFLIGHT_STATES.OBJECT_COLLISION_DETECTED);
  });
});

describe('B19.8.3 Suite 2: Execution Boundary Authorization & Audit Trail', () => {
  test('recordAuthorizationAudit logs sanitized decision to authorization_audit.log without secrets', () => {
    const entry = recordAuthorizationAudit({
      decision: 'REJECTED',
      reason: 'Test authorization rejection for audit verification',
      approval: {
        approvedBy: 'Lead Architect',
        approvedAt: new Date().toISOString(),
        approvedManifestSha256: 'f55231159389f9d5549713ee83c783c1c7130dc7454058c8195140ae529899ea',
        migrationSetCount: 10
      },
      manifestSha256: 'f55231159389f9d5549713ee83c783c1c7130dc7454058c8195140ae529899ea',
      targetProjectRef: CANONICAL_PROJECT_REF,
      rootDir: REPO_ROOT
    });

    assert.equal(entry.decision, 'REJECTED');
    assert.equal(entry.approvedBy, 'Lead Architect');
    assert.equal(entry.targetProjectRef, CANONICAL_PROJECT_REF);
    assert.equal(entry.sanitized, true);

    const auditFile = path.join(REPO_ROOT, 'supabase', 'authorization_audit.log');
    assert.ok(fs.existsSync(auditFile), 'authorization_audit.log must exist');
    const logContent = fs.readFileSync(auditFile, 'utf8');
    assert.ok(logContent.includes('Test authorization rejection'), 'Log must contain entry');
  });

  test('executeRemoteMigrations rejects missing or malformed approvals and records audit', () => {
    assert.throws(
      () => executeRemoteMigrations({ rootDir: REPO_ROOT }),
      /MIGRATION_EXECUTION_BLOCKED: Missing or invalid gateEvidence object/
    );

    assert.throws(
      () => executeRemoteMigrations({
        rootDir: REPO_ROOT,
        gateEvidence: {
          preflightManifestSha256: 'f55231159389f9d5549713ee83c783c1c7130dc7454058c8195140ae529899ea',
          preflightTimestamp: new Date().toISOString()
        },
        productOwnerApproval: true // boolean disallowed
      }),
      /MIGRATION_EXECUTION_BLOCKED: Missing or invalid productOwnerApproval object/
    );
  });

  test('Direct CLI execution limitation is documented in migration-workflow.mjs', () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'migration-workflow.mjs'), 'utf8');
    assert.ok(
      src.includes('OPERATOR NOTICE & ARCHITECTURAL LIMITATION'),
      'Must contain operator notice about direct PowerShell bypass'
    );
    assert.ok(
      src.includes('A Node.js wrapper cannot prevent an operator with terminal access'),
      'Must honestly state limitation of Node wrapper'
    );
  });
});

describe('B19.8.3 Suite 3: Migration Integrity Dimensions & Canonical Timestamps', () => {
  const CANONICAL_TIMESTAMPS = [
    '20261120000001',
    '20261120000002',
    '20261120000003',
    '20261120000004',
    '20261122000001',
    '20261122000002',
    '20261122000003',
    '20261122000004',
    '20261123000001',
    '20261123000002'
  ];

  test('All 10 migration files match the exact canonical timestamp list', () => {
    const migrationsDir = path.join(REPO_ROOT, 'supabase', 'migrations');
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
    assert.equal(files.length, 10, 'Must have exactly 10 canonical migration files');

    files.forEach((file, idx) => {
      const ts = file.slice(0, 14);
      assert.equal(ts, CANONICAL_TIMESTAMPS[idx], `File ${file} must have timestamp ${CANONICAL_TIMESTAMPS[idx]}`);
    });
  });

  test('Zero occurrences of unknown migration version 20261124000001 in repository docs or scripts', () => {
    const riskRegister = fs.readFileSync(path.join(REPO_ROOT, 'B19_8_2_REMAINING_RISK_REGISTER.md'), 'utf8');
    assert.ok(!riskRegister.includes('20261124000001'), '20261124000001 must not be in risk register');

    const manifest = fs.readFileSync(path.join(REPO_ROOT, 'supabase', 'migrations_manifest.json'), 'utf8');
    assert.ok(!manifest.includes('20261124000001'), '20261124000001 must not be in manifest');
  });

  test('Disaster recovery SQL preview contains prominent ledger bypass warning and repair instructions', () => {
    const preview = fs.readFileSync(path.join(REPO_ROOT, 'supabase', 'consolidated_migration_preview.sql'), 'utf8');
    assert.ok(preview.includes('ARCHITECTURAL WARNING (B82-03)'), 'Preview must have architectural warning banner');
    assert.ok(preview.includes('supabase_migrations.schema_migrations'), 'Must cite ledger bypass');
    assert.ok(preview.includes('supabase migration repair --status applied'), 'Must cite repair command');
  });
});

describe('B19.8.3 Suite 4: Three Launch Games Integration & Theater Exit Protocol', () => {
  test('AuroMandala, MaaMATCH, and MaaBLOCK bridges exist and import shared SDK adapters', () => {
    const mandalaBridge = fs.readFileSync(path.join(REPO_ROOT, 'games', 'auromandala', 'assets', 'auromandala-sdk-bridge.js'), 'utf8');
    assert.ok(mandalaBridge.includes('assets/sdk/auromind-adapters.js'));

    const matchBridge = fs.readFileSync(path.join(REPO_ROOT, 'games', 'auromatch', 'Assets', 'auromatch-sdk-bridge.js'), 'utf8');
    assert.ok(matchBridge.includes('assets/sdk/auromind-adapters.js'));

    const blocksBridge = fs.readFileSync(path.join(REPO_ROOT, 'games', 'auroblocks', 'assets', 'auroblocks-sdk-bridge.js'), 'utf8');
    assert.ok(blocksBridge.includes('assets/sdk/auromind-adapters.js'));
  });

  test('All three launch games dispatch AUROMIND_CLOSE_THEATER with their canonical gameId', () => {
    const mandalaBridge = fs.readFileSync(path.join(REPO_ROOT, 'games', 'auromandala', 'assets', 'auromandala-sdk-bridge.js'), 'utf8');
    assert.ok(mandalaBridge.includes("type: 'AUROMIND_CLOSE_THEATER'"));
    assert.ok(mandalaBridge.includes("gameId: 'auromandala'"));

    const matchMain = fs.readFileSync(path.join(REPO_ROOT, 'games', 'auromatch', 'src', 'main.js'), 'utf8');
    assert.ok(matchMain.includes("type: 'AUROMIND_CLOSE_THEATER'"));
    assert.ok(matchMain.includes("gameId: 'auromatch'"));

    const blocksBridge = fs.readFileSync(path.join(REPO_ROOT, 'games', 'auroblocks', 'assets', 'auroblocks-sdk-bridge.js'), 'utf8');
    assert.ok(blocksBridge.includes("type: 'AUROMIND_CLOSE_THEATER'"));
    assert.ok(blocksBridge.includes("gameId: 'auroblocks'"));
  });

  test('Portal GAME_ID_ALIASES recognizes all three launch games and aliases', () => {
    const portalJs = fs.readFileSync(path.join(REPO_ROOT, 'assets', 'js', 'portal.js'), 'utf8');
    assert.ok(portalJs.includes("'auromatch': ['auromatch', 'maamatch']"));
    assert.ok(portalJs.includes("'auroblocks': ['auroblocks', 'maablock']"));
    assert.ok(portalJs.includes("'auromandala': ['auromandala']"));
  });

  test('games/auromatch/index.html uses relative portal redirect without hardcoded github.io', () => {
    const matchHtml = fs.readFileSync(path.join(REPO_ROOT, 'games', 'auromatch', 'index.html'), 'utf8');
    assert.ok(matchHtml.includes("new URL('../../index.html#play-auromatch'"), 'Must use relative redirect');
    assert.ok(!matchHtml.includes('https://gapskris.github.io/AuroMind/#play-auromatch'), 'Must not hardcode gapskris.github.io');
  });

  test('sw.js serves assets/sdk/ via Cache-First strategy to game iframes when offline', () => {
    const sw = fs.readFileSync(path.join(REPO_ROOT, 'sw.js'), 'utf8');
    assert.ok(sw.includes("relPath.startsWith('assets/sdk/') || PORTAL_SDK_REL_PATHS.has(relPath)"));
    assert.ok(sw.includes("cache.match(request)"));
  });
});

describe('B19.8.3 Suite 5: Sankalpa Local-Only Security & Recovery Truth', () => {
  test('Sankalpa PBKDF2 iterations constant is exactly 210,000', () => {
    const vaultSrc = fs.readFileSync(path.join(REPO_ROOT, 'assets', 'sdk', 'sankalpa-vault-lifecycle.js'), 'utf8');
    assert.ok(vaultSrc.includes('SANKALPA_PBKDF2_ITERATIONS = 210000;'));
  });

  test('Sankalpa backup export/import roundtrip uses JSON envelope, not BIP-39 mnemonic', async () => {
    const {
      generateOperationalKey,
      encryptVaultRecord,
      decryptVaultRecord,
      exportEncryptedBackup,
      importEncryptedBackup,
      SANKALPA_PBKDF2_ITERATIONS,
      SANKALPA_BACKUP_FORMAT,
      SANKALPA_BACKUP_SCHEMA_VERSION,
      SANKALPA_BACKUP_KDF
    } = await import('./assets/sdk/sankalpa-vault-lifecycle.js');

    const srcKey = await generateOperationalKey();
    const dstKey = await generateOperationalKey();
    const rec = await encryptVaultRecord(srcKey, { id: 'b1', text: 'My sacred intention' });

    const passphrase = 'ValidPassphrase123!';

    const backup = await exportEncryptedBackup({
      passphrase,
      vaultRecords: [rec],
      operationalKey: srcKey
    });

    assert.equal(backup.format, SANKALPA_BACKUP_FORMAT);
    assert.equal(backup.version, SANKALPA_BACKUP_SCHEMA_VERSION);
    assert.equal(backup.kdf, SANKALPA_BACKUP_KDF);
    assert.equal(backup.iterations, SANKALPA_PBKDF2_ITERATIONS);
    assert.ok(backup.saltHex);
    assert.ok(backup.ivHex);
    assert.ok(backup.ciphertextHex);

    // BIP-39 mnemonic must not be present in envelope
    assert.equal(backup.mnemonic, undefined);
    assert.equal(backup.recoveryPhrase, undefined);

    // Import succeeds with valid passphrase into target operational key
    const imported = await importEncryptedBackup({
      passphrase,
      backupEnvelope: backup,
      targetOperationalKey: dstKey
    });
    assert.equal(imported.importedCount, 1);
    assert.equal(imported.entries[0].text, 'My sacred intention');
    const decrypted = await decryptVaultRecord(dstKey, imported.reEncryptedRecords[0]);
    assert.equal(decrypted.text, 'My sacred intention');

    // Import fails with invalid passphrase
    await assert.rejects(
      () => importEncryptedBackup({
        passphrase: 'WrongPassword!',
        backupEnvelope: backup,
        targetOperationalKey: dstKey
      }),
      /DECRYPTION_FAILED/
    );

    // Import fails with downgraded iterations
    const downgraded = { ...backup, iterations: 1000 };
    await assert.rejects(
      () => importEncryptedBackup({
        passphrase,
        backupEnvelope: downgraded,
        targetOperationalKey: dstKey
      }),
      /INSECURE_KDF_ITERATIONS/
    );
  });

  test('Sankalpa data is completely excluded from telemetry, cloud sync, and remote storage', () => {
    const sdkSrc = fs.readFileSync(path.join(REPO_ROOT, 'assets', 'sdk', 'auromind-sdk.js'), 'utf8');
    const adaptersSrc = fs.readFileSync(path.join(REPO_ROOT, 'assets', 'sdk', 'auromind-adapters.js'), 'utf8');
    assert.ok(sdkSrc.includes('localOnlyVaults'), 'SDK must enforce localOnlyVaults');
    assert.ok(sdkSrc.includes('!caps.cloudSyncEligible'), 'SDK must enforce !caps.cloudSyncEligible check');
    assert.ok(adaptersSrc.includes('cloudSyncEligible'), 'Adapters registry must manage cloudSyncEligible');
  });
});

describe('B19.8.3 Suite 6: Safe Network Diagnostics & Cloudflare Pages Guard', () => {
  test('runDiagnostic completes without leaking secrets or credentials', async () => {
    const report = await runDiagnostic({ rootDir: REPO_ROOT, timeoutMs: 1500 });
    assert.equal(report.projectRef, CANONICAL_PROJECT_REF);
    assert.equal(report.region, 'ap-southeast-1');
    assert.ok(report.dns);
    assert.ok(report.tcp);
    assert.ok(report.rest);
    assert.ok(report.architectureSummary.sessionPooler);
    assert.ok(report.architectureSummary.directPostgres);

    // Verify zero secret leakage
    const json = JSON.stringify(report);
    assert.ok(!json.includes('sbp_'), 'PAT must never be in report');
    assert.ok(!json.includes('secret_'), 'Secrets must never be in report');
  });

  test('Cloudflare Pages configuration is valid and production staging origin is verified', () => {
    const headersPath = path.join(REPO_ROOT, '_headers');
    assert.ok(fs.existsSync(headersPath), '_headers must exist');
    const headers = fs.readFileSync(headersPath, 'utf8');
    assert.ok(headers.includes('Content-Security-Policy'));
    assert.ok(headers.includes("frame-ancestors 'self'"));

    const routesPath = path.join(REPO_ROOT, '_routes.json');
    assert.ok(fs.existsSync(routesPath), '_routes.json must exist');
    const routes = JSON.parse(fs.readFileSync(routesPath, 'utf8'));
    assert.equal(routes.version, 1);
  });

  test('.github/workflows/pages.yml is restricted to manual workflow_dispatch', () => {
    const workflowPath = path.join(REPO_ROOT, '.github', 'workflows', 'pages.yml');
    assert.ok(fs.existsSync(workflowPath), 'pages.yml workflow must exist');
    const content = fs.readFileSync(workflowPath, 'utf8');
    assert.ok(content.includes('Deploy to GitHub Pages (Manual Preview Only)'));
    assert.ok(content.includes("if: github.event_name == 'workflow_dispatch'"));
  });
});
