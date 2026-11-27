/**
 * AuroMasti Automated Deployment Health Check & Invariant Verification
 *
 * Validates:
 * 1. Essential runtime entrypoints (index.html, manifest.json, sw.js, release-manifest.json).
 * 2. Three consolidated applications (auromandala, auromatch, auroblocks).
 * 3. Sacred SHA-256 data invariants (VAK full HTML, VAK Corpus, Flora DB).
 * 4. Master commercial gate disabled invariant (COMMERCIAL_GATE_ENABLED: false).
 * 5. Security headers and Cloudflare routing configuration (_headers, _routes.json).
 * 6. Content Security Policy conformance.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const SACRED_EXPECTATIONS = Object.freeze({
  vakHtmlSha256: 'A8E2EF8B9B5E7F95B231C75B185C3DDEB61EA8FCB4C25C85FABC6872FA780360',
  vakCorpusSha256: '9fdb3826030049c9eab183479bcb7fe29304b3ea08d045c8c67f1cfd4d77da09',
  floraDbSha256: '689d035cd52abd8d342528d8c5f61f298916b8052b8287450be4931cf8ae1a3a'
});

export function verifySacredInvariants(rootDir = process.cwd()) {
  const results = {
    vakHtmlMatch: false,
    vakCorpusMatch: false,
    floraDbMatch: false,
    commercialGateDisabled: false
  };

  // 1. VAK Full HTML Checksum
  const vakPath = path.join(rootDir, 'games/vak/index.html');
  if (fs.existsSync(vakPath)) {
    const vakHtml = fs.readFileSync(vakPath, 'utf8');
    const actualVakHtmlHash = crypto.createHash('sha256').update(vakHtml).digest('hex').toUpperCase();
    results.vakHtmlMatch = actualVakHtmlHash === SACRED_EXPECTATIONS.vakHtmlSha256;

    // 2. VAK Corpus const CL array Checksum
    const clMatch = vakHtml.match(/const CL\s*=\s*\[[\s\S]*?\];/);
    if (clMatch) {
      const actualCorpusHash = crypto.createHash('sha256').update(clMatch[0], 'utf8').digest('hex');
      results.vakCorpusMatch = actualCorpusHash === SACRED_EXPECTATIONS.vakCorpusSha256;
    }
  }

  // 3. Flora Botanical Database Checksum
  const floraPath = path.join(rootDir, 'games/auromatch/src/models/floraDatabase.js');
  if (fs.existsSync(floraPath)) {
    const flora = fs.readFileSync(floraPath, 'utf8');
    const actualFloraHash = crypto.createHash('sha256').update(flora).digest('hex');
    results.floraDbMatch = actualFloraHash === SACRED_EXPECTATIONS.floraDbSha256;
  }

  // 4. Commercial Gate Disabled Check
  const backendConfigPath = path.join(rootDir, 'assets/sdk/config/backend-config.js');
  if (fs.existsSync(backendConfigPath)) {
    const configContent = fs.readFileSync(backendConfigPath, 'utf8');
    results.commercialGateDisabled = /export\s+const\s+COMMERCIAL_GATE_ENABLED\s*=\s*false;/.test(configContent);
  }

  return results;
}

export function verifyConsolidatedApplications(rootDir = process.cwd()) {
  const games = [
    { id: 'auromandala', entry: 'games/auromandala/index.html', sw: 'games/auromandala/sw.js' },
    { id: 'auromatch', entry: 'games/auromatch/index.html', sw: 'games/auromatch/sw.js' },
    { id: 'auroblocks', entry: 'games/auroblocks/index.html', sw: 'games/auroblocks/sw.js' }
  ];

  const appStatus = {};
  for (const g of games) {
    const entryExists = fs.existsSync(path.join(rootDir, g.entry));
    const swExists = fs.existsSync(path.join(rootDir, g.sw));
    appStatus[g.id] = { entryExists, swExists, healthy: entryExists && swExists };
  }

  // Verify portal index.html exposes ONLY these 3 games
  const indexPath = path.join(rootDir, 'index.html');
  const html = fs.readFileSync(indexPath, 'utf8');
  const cardMatches = html.match(/<article[^>]*class="game-card"[^>]*>/g) || [];
  const cardCount = cardMatches.length;

  return {
    games: appStatus,
    portalCardCount: cardCount,
    portalConsolidatedExactlyThree: cardCount === 3
  };
}

export function verifyDeploymentConfiguration(rootDir = process.cwd()) {
  const headersPath = path.join(rootDir, '_headers');
  const routesPath = path.join(rootDir, '_routes.json');
  const manifestPath = path.join(rootDir, 'release-manifest.json');

  const headersExist = fs.existsSync(headersPath);
  const routesExist = fs.existsSync(routesPath);
  const manifestExists = fs.existsSync(manifestPath);

  let headersValid = false;
  let routesValid = false;
  let manifestValid = false;

  if (headersExist) {
    const hText = fs.readFileSync(headersPath, 'utf8');
    headersValid = hText.includes('Content-Security-Policy:') &&
                   hText.includes('X-Frame-Options: SAMEORIGIN') &&
                   hText.includes('X-Content-Type-Options: nosniff');
  }

  if (routesExist) {
    try {
      const rJson = JSON.parse(fs.readFileSync(routesPath, 'utf8'));
      routesValid = rJson.version === 1 && Array.isArray(rJson.include) && Array.isArray(rJson.exclude);
    } catch (_e) {}
  }

  if (manifestExists) {
    try {
      const mJson = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      manifestValid = mJson.version === '2.0.0' &&
                      mJson.featureFlags?.COMMERCIAL_GATE_ENABLED === false &&
                      Array.isArray(mJson.applications) &&
                      mJson.applications.length === 3;
    } catch (_e) {}
  }

  return {
    headers: { exists: headersExist, valid: headersValid },
    routes: { exists: routesExist, valid: routesValid },
    manifest: { exists: manifestExists, valid: manifestValid },
    allValid: headersValid && routesValid && manifestValid
  };
}

export function executeFullHealthCheck(rootDir = process.cwd()) {
  const sacred = verifySacredInvariants(rootDir);
  const apps = verifyConsolidatedApplications(rootDir);
  const deploy = verifyDeploymentConfiguration(rootDir);

  const healthy =
    sacred.vakHtmlMatch &&
    sacred.vakCorpusMatch &&
    sacred.floraDbMatch &&
    sacred.commercialGateDisabled &&
    apps.portalConsolidatedExactlyThree &&
    Object.values(apps.games).every(g => g.healthy) &&
    deploy.allValid;

  return {
    timestamp: new Date().toISOString(),
    status: healthy ? 'HEALTHY' : 'UNHEALTHY',
    healthy,
    sacred,
    apps,
    deploy
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const result = executeFullHealthCheck();
  console.log('==============================================================================');
  console.log('AUROMASTI DEPLOYMENT HEALTH CHECK & INVARIANT VERIFICATION');
  console.log(`Status: ${result.status} | Timestamp: ${result.timestamp}`);
  console.log('==============================================================================');
  console.log(`Sacred Invariants:`);
  console.log(`  - VAK Full HTML SHA-256:        ${result.sacred.vakHtmlMatch ? 'PASS' : 'FAIL'}`);
  console.log(`  - VAK Corpus SHA-256:           ${result.sacred.vakCorpusMatch ? 'PASS' : 'FAIL'}`);
  console.log(`  - Flora Database SHA-256:       ${result.sacred.floraDbMatch ? 'PASS' : 'FAIL'}`);
  console.log(`  - Commercial Gate Disabled:     ${result.sacred.commercialGateDisabled ? 'PASS (false)' : 'FAIL'}`);
  console.log(`Consolidated Applications:`);
  console.log(`  - Portal Exposes Exactly Three: ${result.apps.portalConsolidatedExactlyThree ? 'PASS (3)' : 'FAIL'}`);
  for (const [k, v] of Object.entries(result.apps.games)) {
    console.log(`  - Game '${k}':`.padEnd(34) + (v.healthy ? 'PASS' : 'FAIL'));
  }
  console.log(`Deployment Configuration:`);
  console.log(`  - _headers:                     ${result.deploy.headers.valid ? 'PASS' : 'FAIL'}`);
  console.log(`  - _routes.json:                 ${result.deploy.routes.valid ? 'PASS' : 'FAIL'}`);
  console.log(`  - release-manifest.json:        ${result.deploy.manifest.valid ? 'PASS' : 'FAIL'}`);
  console.log('==============================================================================');
  console.log(`Overall Health Status: ${result.healthy ? 'HEALTHY' : 'UNHEALTHY'}`);
  process.exit(result.healthy ? 0 : 1);
}
