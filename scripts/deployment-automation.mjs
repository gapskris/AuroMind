/**
 * AuroMasti Production & Staging Deployment Automation
 *
 * Implements:
 * 1. Environment-separated artifact staging (staging, production, local-preview).
 * 2. Strict allowlist static bundle assembly.
 * 3. Release promotion to versioned archive (.releases/<version>/).
 * 4. Safe rollback to previous release.
 * 5. Pre-deployment integrity validation.
 *
 * Boundary: Does NOT perform external DNS or unapproved cloud cutovers.
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

export function validateEnvironmentConfiguration(environment = 'staging') {
  const validEnvs = ['local-preview', 'staging', 'production'];
  if (!validEnvs.includes(environment)) {
    throw new Error(`INVALID_ENVIRONMENT: ${environment}. Must be one of: ${validEnvs.join(', ')}`);
  }
  return {
    environment,
    commercialGateEnabled: false, // Invariant: strictly false for launch beta
    targetHost: environment === 'production' ? 'auromasti.com' : 'staging.auromasti.pages.dev'
  };
}

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
    outputDir,
    fileCount: Object.keys(manifest.files).length,
    manifest
  };
}

export function promoteRelease({
  version = '2.0.0',
  bundleDir = path.join(process.cwd(), '_site'),
  releasesDir = path.join(process.cwd(), '.releases')
} = {}) {
  if (!fs.existsSync(bundleDir)) {
    throw new Error(`BUNDLE_NOT_FOUND: Build bundle at ${bundleDir} does not exist. Run build first.`);
  }

  const targetReleaseDir = path.join(releasesDir, `v${version}`);
  if (fs.existsSync(targetReleaseDir)) {
    fs.rmSync(targetReleaseDir, { recursive: true, force: true });
  }
  fs.mkdirSync(targetReleaseDir, { recursive: true });

  // Copy bundle contents into target release directory
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

  copyRecursive(bundleDir, targetReleaseDir);

  const releaseMeta = {
    version,
    promotedAt: new Date().toISOString(),
    status: 'promoted',
    sourceBundle: path.basename(bundleDir)
  };

  fs.writeFileSync(
    path.join(targetReleaseDir, 'release-meta.json'),
    JSON.stringify(releaseMeta, null, 2),
    'utf8'
  );

  return {
    success: true,
    version,
    releasePath: targetReleaseDir
  };
}

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

  if (fs.existsSync(targetDeployDir)) {
    fs.rmSync(targetDeployDir, { recursive: true, force: true });
  }
  fs.mkdirSync(targetDeployDir, { recursive: true });

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

  copyRecursive(releaseDir, targetDeployDir);

  return {
    success: true,
    rolledBackToVersion: targetVersion,
    restoredDeployDir: targetDeployDir
  };
}
