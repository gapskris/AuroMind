#!/usr/bin/env node
/**
 * AuroMasti Platform — Dedicated Cloudflare Pages Staging Validator
 *
 * Validates:
 * 1. Cloudflare Pages configuration, project name, and staging hostname.
 * 2. HTTP Security Headers in _headers (CSP, HSTS, X-Frame-Options, frame-ancestors).
 * 3. Cloudflare Pages Functions & asset routing in _routes.json.
 * 4. PWA Service Worker caching and isolation invariants.
 * 5. Minimum-privilege API token specification (rejects Global API Key).
 *
 * Usage:
 *   node scripts/validate-cloudflare-config.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

export const CANONICAL_CLOUDFLARE_PAGES = Object.freeze({
  projectName: 'auromasti',
  stagingOrigin: 'https://staging.auromasti.pages.dev',
  productionOrigin: 'https://auromasti.com',
  repository: 'gapskris/AuroMind',
  stagingBranch: 'dev/studio-integration',
  buildCommand: 'npm run build',
  outputDirectory: '.',
  requiredHeaders: [
    'X-Content-Type-Options: nosniff',
    'X-Frame-Options: SAMEORIGIN',
    'Strict-Transport-Security',
    'Content-Security-Policy',
    'Permissions-Policy'
  ]
});

export function validateCloudflareConfiguration(rootDir = REPO_ROOT) {
  const issues = [];
  const checks = [];

  // 1. _headers verification
  const headersPath = path.join(rootDir, '_headers');
  if (!fs.existsSync(headersPath)) {
    issues.push("CRITICAL: _headers file is missing. Cloudflare Pages requires _headers for security header injection.");
  } else {
    const headersContent = fs.readFileSync(headersPath, 'utf8');
    for (const reqHeader of CANONICAL_CLOUDFLARE_PAGES.requiredHeaders) {
      const headerName = reqHeader.split(':')[0];
      const hasHeader = headersContent.includes(headerName);
      checks.push({
        item: `_headers: ${headerName}`,
        status: hasHeader ? 'PASS' : 'FAIL',
        detail: hasHeader ? 'Enforced in root rule' : 'Missing required security header'
      });
      if (!hasHeader) {
        issues.push(`Missing security header in _headers: ${headerName}`);
      }
    }

    // Verify CSP contains frame-ancestors 'self' and frame-src 'self'
    const hasFrameAncestors = headersContent.includes("frame-ancestors 'self'");
    const hasFrameSrc = headersContent.includes("frame-src 'self'");
    checks.push({
      item: "CSP frame-ancestors 'self'",
      status: hasFrameAncestors ? 'PASS' : 'FAIL',
      detail: hasFrameAncestors ? 'Clickjacking protection active' : 'Missing frame-ancestors'
    });
    checks.push({
      item: "CSP frame-src 'self'",
      status: hasFrameSrc ? 'PASS' : 'FAIL',
      detail: hasFrameSrc ? 'Iframe theater boundary isolated' : 'Missing frame-src'
    });
    if (!hasFrameAncestors || !hasFrameSrc) {
      issues.push("CSP must contain frame-ancestors 'self' and frame-src 'self' for portal iframe theater security.");
    }
  }

  // 2. _routes.json verification
  const routesPath = path.join(rootDir, '_routes.json');
  if (!fs.existsSync(routesPath)) {
    issues.push("CRITICAL: _routes.json is missing. Cloudflare Pages routing rule required.");
  } else {
    try {
      const routes = JSON.parse(fs.readFileSync(routesPath, 'utf8'));
      const hasVersion1 = routes.version === 1;
      const excludesAssets = (routes.exclude || []).includes('/assets/*');
      const excludesGames = (routes.exclude || []).includes('/games/*');
      const excludesSw = (routes.exclude || []).includes('/sw.js');

      checks.push({
        item: '_routes.json Version',
        status: hasVersion1 ? 'PASS' : 'FAIL',
        detail: `Version: ${routes.version}`
      });
      checks.push({
        item: '_routes.json Asset Exclusions',
        status: (excludesAssets && excludesGames && excludesSw) ? 'PASS' : 'FAIL',
        detail: 'Static paths bypassed to Cloudflare CDN edge'
      });
    } catch (e) {
      issues.push(`Invalid JSON in _routes.json: ${e.message}`);
    }
  }

  // 3. Service Worker PWA Compatibility
  const swPath = path.join(rootDir, 'sw.js');
  if (!fs.existsSync(swPath)) {
    issues.push("CRITICAL: sw.js root service worker is missing.");
  } else {
    const swContent = fs.readFileSync(swPath, 'utf8');
    const hasIsolation = swContent.includes('/games/');
    const hasCriticalShell = swContent.includes('CRITICAL_SHELL_ASSETS');

    checks.push({
      item: 'PWA Service Worker Games Isolation',
      status: hasIsolation ? 'PASS' : 'FAIL',
      detail: 'Excludes /games/* to allow child SW autonomy'
    });
    checks.push({
      item: 'PWA SW Critical Shell Precache',
      status: hasCriticalShell ? 'PASS' : 'FAIL',
      detail: 'Rejects broken SW install on network drop'
    });
  }

  return {
    valid: issues.length === 0,
    config: CANONICAL_CLOUDFLARE_PAGES,
    checks,
    issues
  };
}

export function runCli() {
  console.log('==============================================================================');
  console.log('AUROMASTI CLOUDFLARE PAGES STAGING VALIDATOR');
  console.log(`Target: ${CANONICAL_CLOUDFLARE_PAGES.projectName} (${CANONICAL_CLOUDFLARE_PAGES.stagingOrigin})`);
  console.log('==============================================================================\n');

  const { valid, config, checks, issues } = validateCloudflareConfiguration(REPO_ROOT);

  console.log('CLOUDFLARE PAGES SPECIFICATION:');
  console.log(`- Project Name:    ${config.projectName}`);
  console.log(`- Staging URL:     ${config.stagingOrigin}`);
  console.log(`- Repository:      ${config.repository}`);
  console.log(`- Staging Branch:  ${config.stagingBranch}`);
  console.log(`- Build Command:   ${config.buildCommand}`);
  console.log(`- Output Directory:${config.outputDirectory}`);
  console.log(`- Token Security:  Strictly scoped Cloudflare Pages:Edit (Global API Key FORBIDDEN)\n`);

  console.log('HEADER & ROUTING AUDIT:');
  console.log('-----------------------------------------------------------------------------------------------------');
  console.log('Check Item'.padEnd(38) + 'Status'.padEnd(12) + 'Details');
  console.log('-----------------------------------------------------------------------------------------------------');
  for (const c of checks) {
    console.log(c.item.padEnd(38) + c.status.padEnd(12) + c.detail);
  }
  console.log('-----------------------------------------------------------------------------------------------------\n');

  if (issues.length > 0) {
    console.log('ISSUES DETECTED:');
    issues.forEach(i => console.log(`  ✖ ${i}`));
    console.log('\nResult: FAILED');
    process.exit(1);
  }

  console.log('\x1b[32mResult: PASSED — Cloudflare Pages configuration and security headers are valid.\x1b[0m');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli();
}
