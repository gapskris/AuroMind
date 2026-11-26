/**
 * F3 & F5 Automated Deployment Lifecycle & Health Check Test Suite
 *
 * Verifies:
 * 1. Environment configuration validation and separation (genuinely distinct configs).
 * 2. Static release bundle assembly with strict allowlist and forbidden pattern exclusion.
 * 3. Release promotion to versioned archive (.releases/v2.0.0/) with atomic staging & overwrite protection.
 * 4. Safe rollback restoration from archived release with pre-validation and zero-downtime swap.
 * 5. Full health check execution on canonical workspace.
 * 6. Fail-closed detection on tampered sacred invariants or enabled commercial gate.
 * 7. Cloudflare Pages routing (_routes.json) and security headers (_headers) validation.
 * 8. Release integrity verification via build manifest SHA-256 and compatibility checking.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  APPROVED_RUNTIME_FILES,
  APPROVED_RUNTIME_DIRS,
  FORBIDDEN_DEPLOY_PATTERNS,
  validateEnvironmentConfiguration,
  verifyReleaseIntegrity,
  validateReleaseCompatibility,
  buildReleaseBundle,
  promoteRelease,
  rollbackRelease
} from './scripts/deployment-automation.mjs';

import {
  SACRED_EXPECTATIONS,
  verifySacredInvariants,
  verifyConsolidatedApplications,
  verifyDeploymentConfiguration,
  executeFullHealthCheck
} from './scripts/health-check.mjs';

describe('F3 & F5 Deployment Lifecycle & Release Automation', () => {
  const workspaceDir = process.cwd();
  let tempTestDir;

  before(() => {
    tempTestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auromasti-deploy-test-'));
  });

  after(() => {
    if (tempTestDir && fs.existsSync(tempTestDir)) {
      fs.rmSync(tempTestDir, { recursive: true, force: true });
    }
  });

  test('Environment validation: strictly allows valid environments with distinct properties & commercial gate disabled', () => {
    const preview = validateEnvironmentConfiguration('local-preview');
    assert.equal(preview.environment, 'local-preview');
    assert.equal(preview.targetHost, 'localhost:8080');
    assert.equal(preview.mockProviders, true);
    assert.equal(preview.commercialGateEnabled, false);
    assert.equal(preview.strictHeadersEnforced, false);

    const staging = validateEnvironmentConfiguration('staging');
    assert.equal(staging.environment, 'staging');
    assert.equal(staging.targetHost, 'staging.auromasti.pages.dev');
    assert.equal(staging.mockProviders, false);
    assert.equal(staging.cspMode, 'staging-report-only');
    assert.equal(staging.commercialGateEnabled, false);
    assert.equal(staging.strictHeadersEnforced, true);

    const prod = validateEnvironmentConfiguration('production');
    assert.equal(prod.environment, 'production');
    assert.equal(prod.targetHost, 'auromasti.com');
    assert.equal(prod.cspMode, 'strict-enforcing');
    assert.equal(prod.mockProviders, false);
    assert.equal(prod.commercialGateEnabled, false);
    assert.equal(prod.strictHeadersEnforced, true);

    assert.throws(
      () => validateEnvironmentConfiguration('development'),
      /INVALID_ENVIRONMENT/,
      'Must reject unknown environment development'
    );
    assert.throws(
      () => validateEnvironmentConfiguration('arbitrary-test'),
      /INVALID_ENVIRONMENT/,
      'Must reject invalid environment'
    );
  });

  test('Release bundle build: creates clean allowlisted artifact bundle and excludes forbidden files', () => {
    const testSiteDir = path.join(tempTestDir, '_site');
    const result = buildReleaseBundle({
      workspaceDir,
      outputDir: testSiteDir,
      environment: 'staging'
    });

    assert.equal(result.success, true);
    assert.equal(result.environment, 'staging');
    assert.equal(result.deploymentType, 'local-static-artifact-bundle');
    assert.equal(result.externalHostingTriggered, false);
    assert.ok(result.fileCount > 0);

    // Verify all approved runtime files exist in bundle
    for (const f of APPROVED_RUNTIME_FILES) {
      const p = path.join(testSiteDir, f);
      assert.ok(fs.existsSync(p), `Approved runtime file ${f} must exist in bundle`);
    }

    // Verify .nojekyll and build-manifest.json exist
    assert.ok(fs.existsSync(path.join(testSiteDir, '.nojekyll')));
    assert.ok(fs.existsSync(path.join(testSiteDir, 'build-manifest.json')));

    // Read and verify build-manifest.json
    const manifest = JSON.parse(fs.readFileSync(path.join(testSiteDir, 'build-manifest.json'), 'utf8'));
    assert.equal(manifest.bundleVersion, '2.0.0');
    assert.equal(manifest.environment, 'staging');
    assert.ok(manifest.files['index.html']);
    assert.ok(manifest.files['release-manifest.json']);

    // Check that NO forbidden test files or dev files leaked into the bundle
    function scanDirForForbidden(dir) {
      for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, item.name);
        for (const pattern of FORBIDDEN_DEPLOY_PATTERNS) {
          assert.equal(
            pattern.test(item.name),
            false,
            `Forbidden file ${item.name} matching ${pattern} found in bundle: ${full}`
          );
        }
        if (item.isDirectory()) {
          scanDirForForbidden(full);
        }
      }
    }
    scanDirForForbidden(testSiteDir);

    // Verify release integrity of built bundle
    const integrity = verifyReleaseIntegrity(testSiteDir);
    assert.equal(integrity.valid, true);
    assert.equal(integrity.fileCount, Object.keys(manifest.files).length);

    // Verify release compatibility of built bundle
    const compatibility = validateReleaseCompatibility(testSiteDir, '2.0.0');
    assert.equal(compatibility.compatible, true);
    assert.equal(compatibility.version, '2.0.0');
  });

  test('Release promotion: enforces overwrite protection and atomic staging', () => {
    const testSiteDir = path.join(tempTestDir, '_site');
    const testReleasesDir = path.join(tempTestDir, '.releases');

    const result = promoteRelease({
      version: '2.0.0',
      bundleDir: testSiteDir,
      releasesDir: testReleasesDir
    });

    assert.equal(result.success, true);
    assert.equal(result.version, '2.0.0');
    assert.equal(result.atomicPromotion, true);

    const promotedReleaseDir = path.join(testReleasesDir, 'v2.0.0');
    assert.ok(fs.existsSync(promotedReleaseDir));
    assert.ok(fs.existsSync(path.join(promotedReleaseDir, 'release-meta.json')));
    assert.ok(fs.existsSync(path.join(promotedReleaseDir, 'index.html')));

    const meta = JSON.parse(fs.readFileSync(path.join(promotedReleaseDir, 'release-meta.json'), 'utf8'));
    assert.equal(meta.version, '2.0.0');
    assert.equal(meta.status, 'promoted');
    assert.equal(meta.integrityVerified, true);

    // Attempting to overwrite existing release WITHOUT overwrite flag must throw
    assert.throws(
      () => promoteRelease({
        version: '2.0.0',
        bundleDir: testSiteDir,
        releasesDir: testReleasesDir,
        overwrite: false
      }),
      /RELEASE_ALREADY_EXISTS/
    );

    // Promoting with overwrite: true succeeds
    const overwriteResult = promoteRelease({
      version: '2.0.0',
      bundleDir: testSiteDir,
      releasesDir: testReleasesDir,
      overwrite: true
    });
    assert.equal(overwriteResult.success, true);
  });

  test('Release rollback: validates restored bundle and performs zero-downtime atomic swap', () => {
    const testReleasesDir = path.join(tempTestDir, '.releases');
    const rollbackTargetDir = path.join(tempTestDir, 'rollback_site');

    // Initial deployment
    fs.mkdirSync(rollbackTargetDir, { recursive: true });
    fs.writeFileSync(path.join(rollbackTargetDir, 'dummy.txt'), 'old-content');

    const result = rollbackRelease({
      targetVersion: '2.0.0',
      releasesDir: testReleasesDir,
      targetDeployDir: rollbackTargetDir
    });

    assert.equal(result.success, true);
    assert.equal(result.rolledBackToVersion, '2.0.0');
    assert.equal(result.zeroDowntimeAtomicSwap, true);
    assert.ok(fs.existsSync(path.join(rollbackTargetDir, 'index.html')));
    assert.ok(fs.existsSync(path.join(rollbackTargetDir, 'manifest.json')));
    assert.equal(fs.existsSync(path.join(rollbackTargetDir, 'dummy.txt')), false);

    // Verify integrity of restored target
    const integrity = verifyReleaseIntegrity(rollbackTargetDir);
    assert.equal(integrity.valid, true);

    // Should fail if non-existent version requested without modifying deploy target
    assert.throws(
      () => rollbackRelease({
        targetVersion: '9.9.9',
        releasesDir: testReleasesDir,
        targetDeployDir: rollbackTargetDir
      }),
      /ROLLBACK_VERSION_NOT_FOUND/
    );
    // Active deploy target must remain intact
    assert.ok(fs.existsSync(path.join(rollbackTargetDir, 'index.html')));
  });

  test('Windows filesystem failure resilience: interrupted promotion or rollback never corrupts active deployment', () => {
    const testReleasesDir = path.join(tempTestDir, '.releases');
    const rollbackTargetDir = path.join(tempTestDir, 'rollback_site');

    // Verify current known-good active state
    assert.ok(fs.existsSync(path.join(rollbackTargetDir, 'index.html')));
    const knownGoodHtml = fs.readFileSync(path.join(rollbackTargetDir, 'index.html'), 'utf8');

    // 1. Corrupt the target release in releases directory (tamper build-manifest.json)
    const releaseV2Dir = path.join(testReleasesDir, 'v2.0.0');
    const manifestPath = path.join(releaseV2Dir, 'build-manifest.json');
    const realManifest = fs.readFileSync(manifestPath, 'utf8');

    try {
      // Intentionally tamper manifest to simulate corrupted release
      fs.writeFileSync(manifestPath, JSON.stringify({ bundleVersion: '2.0.0', files: { 'index.html': 'bad_hash_123' } }), 'utf8');

      assert.throws(
        () => rollbackRelease({
          targetVersion: '2.0.0',
          releasesDir: testReleasesDir,
          targetDeployDir: rollbackTargetDir
        }),
        /RELEASE_INTEGRITY_FAILED/
      );

      // Invariant: Failed rollback did NOT corrupt active deployment
      assert.ok(fs.existsSync(path.join(rollbackTargetDir, 'index.html')), 'Active deployment must remain intact after failed rollback');
      assert.equal(fs.readFileSync(path.join(rollbackTargetDir, 'index.html'), 'utf8'), knownGoodHtml, 'Active content unchanged');
    } finally {
      // Restore valid manifest
      fs.writeFileSync(manifestPath, realManifest, 'utf8');
    }

    // 2. Test promotion failure when bundle is missing required files
    const fakeBundleDir = path.join(tempTestDir, 'empty_bundle');
    fs.mkdirSync(fakeBundleDir, { recursive: true });

    assert.throws(
      () => promoteRelease({
        version: '3.0.0',
        bundleDir: fakeBundleDir,
        releasesDir: testReleasesDir
      }),
      /MANIFEST_NOT_FOUND/
    );

    // Release v3.0.0 was NOT created
    assert.equal(fs.existsSync(path.join(testReleasesDir, 'v3.0.0')), false, 'Incomplete release must not exist');
  });

  test('Health check: canonical workspace passes full health check cleanly', () => {
    const health = executeFullHealthCheck(workspaceDir);

    assert.equal(health.status, 'HEALTHY', 'Deployment health check must return HEALTHY');
    assert.equal(health.healthy, true);

    // Sacred Invariants
    assert.equal(health.sacred.vakHtmlMatch, true, 'VAK HTML SHA-256 must match');
    assert.equal(health.sacred.vakCorpusMatch, true, 'VAK Corpus SHA-256 must match');
    assert.equal(health.sacred.floraDbMatch, true, 'Flora DB SHA-256 must match');
    assert.equal(health.sacred.commercialGateDisabled, true, 'Commercial gate must be disabled');

    // Consolidated Applications
    assert.equal(health.apps.portalConsolidatedExactlyThree, true, 'Portal must have exactly 3 game cards');
    assert.equal(health.apps.portalCardCount, 3);
    assert.equal(health.apps.games.auromandala.healthy, true);
    assert.equal(health.apps.games.auromatch.healthy, true);
    assert.equal(health.apps.games.auroblocks.healthy, true);

    // Deployment Configuration
    assert.equal(health.deploy.headers.valid, true);
    assert.equal(health.deploy.routes.valid, true);
    assert.equal(health.deploy.manifest.valid, true);
  });

  test('Fail-closed verification: tampered sacred invariants, manifest hashes, or commercial gate trigger UNHEALTHY', () => {
    const mockDir = path.join(tempTestDir, 'mock-tampered');
    fs.mkdirSync(mockDir, { recursive: true });

    // Copy index.html, release-manifest.json, _headers, _routes.json
    fs.copyFileSync(path.join(workspaceDir, 'index.html'), path.join(mockDir, 'index.html'));
    fs.copyFileSync(path.join(workspaceDir, 'release-manifest.json'), path.join(mockDir, 'release-manifest.json'));
    fs.copyFileSync(path.join(workspaceDir, '_headers'), path.join(mockDir, '_headers'));
    fs.copyFileSync(path.join(workspaceDir, '_routes.json'), path.join(mockDir, '_routes.json'));

    // Create fake games dirs
    fs.mkdirSync(path.join(mockDir, 'games/auromandala'), { recursive: true });
    fs.writeFileSync(path.join(mockDir, 'games/auromandala/index.html'), '<html></html>');
    fs.writeFileSync(path.join(mockDir, 'games/auromandala/sw.js'), '// sw');

    fs.mkdirSync(path.join(mockDir, 'games/auromatch/src/models'), { recursive: true });
    fs.writeFileSync(path.join(mockDir, 'games/auromatch/index.html'), '<html></html>');
    fs.writeFileSync(path.join(mockDir, 'games/auromatch/sw.js'), '// sw');
    fs.writeFileSync(path.join(mockDir, 'games/auromatch/src/models/floraDatabase.js'), '// TAMPERED FLORA');

    fs.mkdirSync(path.join(mockDir, 'games/auroblocks'), { recursive: true });
    fs.writeFileSync(path.join(mockDir, 'games/auroblocks/index.html'), '<html></html>');
    fs.writeFileSync(path.join(mockDir, 'games/auroblocks/sw.js'), '// sw');

    fs.mkdirSync(path.join(mockDir, 'games/vak'), { recursive: true });
    fs.writeFileSync(path.join(mockDir, 'games/vak/index.html'), '<html>TAMPERED VAK</html>');

    fs.mkdirSync(path.join(mockDir, 'assets/sdk/config'), { recursive: true });
    fs.writeFileSync(path.join(mockDir, 'assets/sdk/config/backend-config.js'), 'export const COMMERCIAL_GATE_ENABLED = true;');

    const tamperedHealth = executeFullHealthCheck(mockDir);
    assert.equal(tamperedHealth.status, 'UNHEALTHY');
    assert.equal(tamperedHealth.healthy, false);
    assert.equal(tamperedHealth.sacred.vakHtmlMatch, false);
    assert.equal(tamperedHealth.sacred.floraDbMatch, false);
    assert.equal(tamperedHealth.sacred.commercialGateDisabled, false);

    // Test verifyReleaseIntegrity detects tampered file
    const testSiteDir = path.join(tempTestDir, '_site');
    const tamperedFile = path.join(testSiteDir, 'manifest.json');
    const originalContent = fs.readFileSync(tamperedFile, 'utf8');
    try {
      fs.writeFileSync(tamperedFile, originalContent + '/* TAMPERED */', 'utf8');
      assert.throws(
        () => verifyReleaseIntegrity(testSiteDir),
        /RELEASE_INTEGRITY_FAILED/
      );
    } finally {
      fs.writeFileSync(tamperedFile, originalContent, 'utf8');
    }
  });

  test('Deployment configuration: _routes.json and _headers have required security policies', () => {
    const routes = JSON.parse(fs.readFileSync(path.join(workspaceDir, '_routes.json'), 'utf8'));
    assert.equal(routes.version, 1);
    assert.ok(routes.include.includes('/*'));
    assert.ok(routes.exclude.includes('/assets/*'));

    const headers = fs.readFileSync(path.join(workspaceDir, '_headers'), 'utf8');
    assert.ok(headers.includes('Content-Security-Policy:'));
    assert.ok(headers.includes('X-Frame-Options: SAMEORIGIN'));
    assert.ok(headers.includes('X-Content-Type-Options: nosniff'));
    assert.ok(headers.includes('Referrer-Policy: strict-origin-when-cross-origin'));
  });
});
