/**
 * AuroMasti Production & Staging Deployment Automation
 *
 * Implements:
 * 1. Environment-separated artifact staging (local-preview, staging, production) with genuinely distinct configurations.
 * 2. Strict allowlist static bundle assembly with SHA-256 build manifest generation.
 * 3. Atomic, fail-safe release promotion to versioned archive (.releases/v<version>/) with overwrite protection.
 * 4. Safe rollback to previous release via temporary staging, manifest validation, and atomic directory swap.
 * 5. Pre-deployment integrity validation and version compatibility checking.
 *
 * Boundary: Does NOT perform external DNS or unapproved cloud cutovers. Local artifact creation is distinct from cloud deployment.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const APPROVED_RUNTIME_FILES = Object.freeze([
  'index.html',
  'manifest.json',
  'sw.js',
  '_headers',
  '_routes.json',
  'release-manifest.json'
]);

export const APPROVED_RUNTIME_DIRS = Object.freeze([
  'assets',
  'games'
]);

export const FORBIDDEN_DEPLOY_PATTERNS = Object.freeze([
  /\.test\.js$/i,
  /\.git/i,
  /node_modules/i,
  /\.env/i,
  /server\.js$/i,
  /server\.test\.js$/i,
  /architecture-design/i,
  /phase0-audit/i,
  /package\.json$/i,
  /package-lock\.json$/i,
  /bun\.lock$/i
]);

export function computeFileSha256(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Validates environment configuration with explicit and genuinely distinct properties.
 */
export function validateEnvironmentConfiguration(environment = 'staging') {
  const validEnvs = ['local-preview', 'staging', 'production'];
  if (!validEnvs.includes(environment)) {
    throw new Error(`INVALID_ENVIRONMENT: ${environment}. Must be one of: ${validEnvs.join(', ')}`);
  }

  const configs = {
    'local-preview': {
      environment: 'local-preview',
      targetHost: 'localhost:8080',
      baseUrl: 'http://localhost:8080',
      cspMode: 'development',
      analyticsEnabled: false,
      mockProviders: true,
      commercialGateEnabled: false,
      strictHeadersEnforced: false,
      deploymentType: 'local-static-artifact-bundle',
      externalHostingTriggered: false
    },
    'staging': {
      environment: 'staging',
      targetHost: 'staging.auromasti.pages.dev',
      baseUrl: 'https://staging.auromasti.pages.dev',
      cspMode: 'staging-report-only',
      analyticsEnabled: true,
      mockProviders: false,
      commercialGateEnabled: false,
      strictHeadersEnforced: true,
      deploymentType: 'local-static-artifact-bundle',
      externalHostingTriggered: false
    },
    'production': {
      environment: 'production',
      targetHost: 'auromasti.com',
      baseUrl: 'https://auromasti.com',
      cspMode: 'strict-enforcing',
      analyticsEnabled: true,
      mockProviders: false,
      commercialGateEnabled: false,
      strictHeadersEnforced: true,
      deploymentType: 'local-static-artifact-bundle',
      externalHostingTriggered: false
    }
  };

  return configs[environment];
}

/**
 * Validates release integrity against build-manifest.json using SHA-256 hashes.
 */
export function verifyReleaseIntegrity(bundleDir, manifestPath) {
  const actualManifestPath = manifestPath || path.join(bundleDir, 'build-manifest.json');
  if (!fs.existsSync(actualManifestPath)) {
    throw new Error(`MANIFEST_NOT_FOUND: Build manifest at ${actualManifestPath} does not exist.`);
  }

  const manifest = JSON.parse(fs.readFileSync(actualManifestPath, 'utf8'));
  const errors = [];

  for (const [relPath, expectedHash] of Object.entries(manifest.files || {})) {
    const fullPath = path.join(bundleDir, relPath);
    if (!fs.existsSync(fullPath)) {
      errors.push(`MISSING_FILE: ${relPath}`);
      continue;
    }
    const actualHash = computeFileSha256(fullPath);
    if (actualHash !== expectedHash) {
      errors.push(`HASH_MISMATCH: ${relPath} (expected ${expectedHash}, got ${actualHash})`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`RELEASE_INTEGRITY_FAILED: ${errors.join('; ')}`);
  }

  return {
    valid: true,
    fileCount: Object.keys(manifest.files || {}).length,
    bundleVersion: manifest.bundleVersion,
    environment: manifest.environment
  };
}

/**
 * Validates version and service-worker/cache compatibility across the bundle.
 */
export function validateReleaseCompatibility(bundleDir, expectedVersion = '2.0.0') {
  const releaseManifestPath = path.join(bundleDir, 'release-manifest.json');
  if (!fs.existsSync(releaseManifestPath)) {
    throw new Error('COMPATIBILITY_ERROR: release-manifest.json missing in bundle');
  }

  const relManifest = JSON.parse(fs.readFileSync(releaseManifestPath, 'utf8'));
  if (relManifest.version !== expectedVersion) {
    throw new Error(`VERSION_MISMATCH: release-manifest version ${relManifest.version} does not match expected ${expectedVersion}`);
  }

  if (relManifest.featureFlags?.COMMERCIAL_GATE_ENABLED !== false) {
    throw new Error('COMMERCIAL_GATE_VIOLATION: Commercial gate must be false in release manifest');
  }

  const swPath = path.join(bundleDir, 'sw.js');
  if (!fs.existsSync(swPath)) {
    throw new Error('COMPATIBILITY_ERROR: sw.js missing in bundle');
  }

  const swContent = fs.readFileSync(swPath, 'utf8');
  const expectedCacheName = `auro-portal-v${expectedVersion}`;
  if (!swContent.includes(expectedCacheName)) {
    throw new Error(`CACHE_VERSION_MISMATCH: sw.js does not declare expected cache name ${expectedCacheName}`);
  }

  // Validate the 3 applications exist
  const expectedApps = ['auromandala', 'auromatch', 'auroblocks'];
  for (const appId of expectedApps) {
    const appIndex = path.join(bundleDir, 'games', appId, 'index.html');
    if (!fs.existsSync(appIndex)) {
      throw new Error(`APPLICATION_ENTRY_MISSING: ${appId} index.html not found in bundle`);
    }
  }

  return {
    compatible: true,
    version: expectedVersion,
    cacheName: expectedCacheName,
    applications: expectedApps
  };
}

/**
 * Builds static release bundle into output directory.
 */
export function buildReleaseBundle({
  workspaceDir = process.cwd(),
  outputDir = path.join(process.cwd(), '_site'),
  environment = 'staging'
} = {}) {
  const envConfig = validateEnvironmentConfiguration(environment);

  if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
  fs.mkdirSync(outputDir, { recursive: true });

  const manifest = {
    bundleVersion: '2.0.0',
    environment,
    builtAt: new Date().toISOString(),
    files: {}
  };

  // 1. Copy approved root files
  for (const file of APPROVED_RUNTIME_FILES) {
    const srcPath = path.join(workspaceDir, file);
    if (!fs.existsSync(srcPath)) {
      throw new Error(`MISSING_RUNTIME_FILE: Required file ${file} does not exist in workspace`);
    }
    const destPath = path.join(outputDir, file);
    fs.copyFileSync(srcPath, destPath);
    manifest.files[file] = computeFileSha256(destPath);
  }

  // 2. Copy approved directories recursively (excluding forbidden patterns)
  function copyDirectoryClean(src, dest, relPrefix = '') {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcItem = path.join(src, entry.name);
      const destItem = path.join(dest, entry.name);
      const relPath = path.join(relPrefix, entry.name).replace(/\\/g, '/');

      let isForbidden = false;
      for (const pattern of FORBIDDEN_DEPLOY_PATTERNS) {
        if (pattern.test(relPath) || pattern.test(entry.name)) {
          isForbidden = true;
          break;
        }
      }
      if (isForbidden) continue;

      if (entry.isDirectory()) {
        copyDirectoryClean(srcItem, destItem, relPath);
      } else if (entry.isFile()) {
        fs.copyFileSync(srcItem, destItem);
        manifest.files[relPath] = computeFileSha256(destItem);
      }
    }
  }

  for (const dir of APPROVED_RUNTIME_DIRS) {
    const srcDir = path.join(workspaceDir, dir);
    if (fs.existsSync(srcDir)) {
      copyDirectoryClean(srcDir, path.join(outputDir, dir), dir);
    }
  }

  // 3. Write .nojekyll for static serving
  fs.writeFileSync(path.join(outputDir, '.nojekyll'), '', 'utf8');

  // 4. Write build verification manifest
  fs.writeFileSync(
    path.join(outputDir, 'build-manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf8'
  );

  return {
    success: true,
    environment,
    envConfig,
    outputDir,
    fileCount: Object.keys(manifest.files).length,
    manifest,
    deploymentType: 'local-static-artifact-bundle',
    externalHostingTriggered: false
  };
}

/**
 * Promotes a release atomically with overwrite protection and pre-validation.
 */
export function promoteRelease({
  version = '2.0.0',
  bundleDir = path.join(process.cwd(), '_site'),
  releasesDir = path.join(process.cwd(), '.releases'),
  overwrite = false
} = {}) {
  if (!fs.existsSync(bundleDir)) {
    throw new Error(`BUNDLE_NOT_FOUND: Build bundle at ${bundleDir} does not exist. Run build first.`);
  }

  const targetReleaseDir = path.join(releasesDir, `v${version}`);

  // Prevent unsafe deletion or overwriting of existing release unless explicitly requested
  if (fs.existsSync(targetReleaseDir) && !overwrite) {
    throw new Error(`RELEASE_ALREADY_EXISTS: Release v${version} already exists in ${releasesDir}. Refusing unsafe overwrite. Pass overwrite: true to force.`);
  }

  fs.mkdirSync(releasesDir, { recursive: true });

  // Atomic promotion: stage into a unique temporary directory first
  const stagingDir = path.join(releasesDir, `.tmp-staging-v${version}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  fs.mkdirSync(stagingDir, { recursive: true });

  function copyRecursive(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const item of fs.readdirSync(src, { withFileTypes: true })) {
      const srcPath = path.join(src, item.name);
      const destPath = path.join(dest, item.name);
      if (item.isDirectory()) {
        copyRecursive(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  try {
    copyRecursive(bundleDir, stagingDir);

    // Verify integrity and version compatibility before finalizing
    verifyReleaseIntegrity(stagingDir);
    validateReleaseCompatibility(stagingDir, version);

    const releaseMeta = {
      version,
      promotedAt: new Date().toISOString(),
      status: 'promoted',
      sourceBundle: path.basename(bundleDir),
      integrityVerified: true
    };

    fs.writeFileSync(
      path.join(stagingDir, 'release-meta.json'),
      JSON.stringify(releaseMeta, null, 2),
      'utf8'
    );

    // If overwriting an existing release, move existing to backup first
    let backupDir = null;
    if (fs.existsSync(targetReleaseDir)) {
      backupDir = path.join(releasesDir, `.backup-v${version}-${Date.now()}`);
      fs.renameSync(targetReleaseDir, backupDir);
    }

    // Atomic move into final location
    fs.renameSync(stagingDir, targetReleaseDir);

    // Remove backup after successful swap
    if (backupDir && fs.existsSync(backupDir)) {
      fs.rmSync(backupDir, { recursive: true, force: true });
    }

    return {
      success: true,
      version,
      releasePath: targetReleaseDir,
      atomicPromotion: true
    };
  } catch (err) {
    // Clean up staging directory on any failure to guarantee no incomplete release is left
    if (fs.existsSync(stagingDir)) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    }
    throw err;
  }
}

/**
 * Rolls back release safely by restoring into temporary destination, validating, and atomically swapping.
 */
export function rollbackRelease({
  targetVersion,
  releasesDir = path.join(process.cwd(), '.releases'),
  targetDeployDir = path.join(process.cwd(), '_site')
} = {}) {
  if (!targetVersion) {
    throw new Error('ROLLBACK_TARGET_REQUIRED: Must provide targetVersion to rollback.');
  }

  const releaseDir = path.join(releasesDir, `v${targetVersion}`);
  if (!fs.existsSync(releaseDir)) {
    throw new Error(`ROLLBACK_VERSION_NOT_FOUND: Release v${targetVersion} does not exist in ${releasesDir}`);
  }

  // Verify target release integrity before attempting rollback
  verifyReleaseIntegrity(releaseDir);

  // Restore into temporary destination first
  const tempRestoreDir = path.join(path.dirname(targetDeployDir), `.tmp-rollback-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  fs.mkdirSync(tempRestoreDir, { recursive: true });

  function copyRecursive(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const item of fs.readdirSync(src, { withFileTypes: true })) {
      if (item.name === 'release-meta.json') continue;
      const srcPath = path.join(src, item.name);
      const destPath = path.join(dest, item.name);
      if (item.isDirectory()) {
        copyRecursive(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  try {
    copyRecursive(releaseDir, tempRestoreDir);

    // Validate restored bundle integrity
    verifyReleaseIntegrity(tempRestoreDir);

    // Atomic swap: move existing deploy dir to backup, move temp to deploy dir, remove backup
    let backupDir = null;
    if (fs.existsSync(targetDeployDir)) {
      backupDir = path.join(path.dirname(targetDeployDir), `.deploy-backup-${Date.now()}`);
      fs.renameSync(targetDeployDir, backupDir);
    }

    fs.renameSync(tempRestoreDir, targetDeployDir);

    if (backupDir && fs.existsSync(backupDir)) {
      fs.rmSync(backupDir, { recursive: true, force: true });
    }

    return {
      success: true,
      rolledBackToVersion: targetVersion,
      restoredDeployDir: targetDeployDir,
      zeroDowntimeAtomicSwap: true
    };
  } catch (err) {
    // Clean up temporary restore directory on failure so active deploy dir remains intact
    if (fs.existsSync(tempRestoreDir)) {
      fs.rmSync(tempRestoreDir, { recursive: true, force: true });
    }
    throw err;
  }
}
