/**
 * F3 & F5 Automated Deployment Lifecycle & Health Check Test Suite
 *
 * Verifies:
 * 1. Environment configuration validation and separation.
 * 2. Static release bundle assembly with strict allowlist and forbidden pattern exclusion.
 * 3. Release promotion to versioned archive (.releases/v2.0.0/).
 * 4. Safe rollback restoration from archived release.
 * 5. Full health check execution on canonical workspace.
 * 6. Fail-closed detection on tampered sacred invariants or enabled commercial gate.
 * 7. Cloudflare Pages routing (_routes.json) and security headers (_headers) validation.
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

  test('Environment validation: strictly allows valid environments with commercial gate disabled', () => {
    const validEnvs = ['local-preview', 'staging', 'production'];
    for (const env of validEnvs) {
      const config = validateEnvironmentConfiguration(env);
      assert.equal(config.environment, env);
      assert.equal(config.commercialGateEnabled, false, 'Commercial gate must be strictly disabled');
    }

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
  });

  test('Release promotion: archives release bundle to versioned directory', () => {
    const testSiteDir = path.join(tempTestDir, '_site');
    const testReleasesDir = path.join(tempTestDir, '.releases');

    const result = promoteRelease({
      version: '2.0.0',
      bundleDir: testSiteDir,
      releasesDir: testReleasesDir
    });

    assert.equal(result.success, true);
    assert.equal(result.version, '2.0.0');

    const promotedReleaseDir = path.join(testReleasesDir, 'v2.0.0');
    assert.ok(fs.existsSync(promotedReleaseDir));
    assert.ok(fs.existsSync(path.join(promotedReleaseDir, 'release-meta.json')));
    assert.ok(fs.existsSync(path.join(promotedReleaseDir, 'index.html')));

    const meta = JSON.parse(fs.readFileSync(path.join(promotedReleaseDir, 'release-meta.json'), 'utf8'));
    assert.equal(meta.version, '2.0.0');
    assert.equal(meta.status, 'promoted');
  });

  test('Release rollback: safely restores target version to deploy directory', () => {
    const testReleasesDir = path.join(tempTestDir, '.releases');
    const rollbackTargetDir = path.join(tempTestDir, 'rollback_site');

    const result = rollbackRelease({
      targetVersion: '2.0.0',
      releasesDir: testReleasesDir,
      targetDeployDir: rollbackTargetDir
    });

    assert.equal(result.success, true);
    assert.equal(result.rolledBackToVersion, '2.0.0');
    assert.ok(fs.existsSync(path.join(rollbackTargetDir, 'index.html')));
    assert.ok(fs.existsSync(path.join(rollbackTargetDir, 'manifest.json')));

    // Should fail if non-existent version requested
    assert.throws(
      () => rollbackRelease({
        targetVersion: '9.9.9',
        releasesDir: testReleasesDir,
        targetDeployDir: rollbackTargetDir
      }),
      /ROLLBACK_VERSION_NOT_FOUND/
    );
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

  test('Fail-closed verification: tampered sacred invariants or enabled commercial gate trigger UNHEALTHY', () => {
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
