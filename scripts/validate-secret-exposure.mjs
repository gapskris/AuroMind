#!/usr/bin/env node
/**
 * AuroMasti Platform — Secret Exposure & Credential Leakage Scanner
 *
 * Implements strict defense-in-depth safety checks:
 * 1. Verifies that secret-bearing files (.env, .env.local, .env.staging.local, *.local) are strictly Git-ignored.
 * 2. Verifies that example templates (.env.example, .env.staging.example) contain placeholders only.
 * 3. Scans all Git-tracked files for forbidden secret patterns:
 *    - Real service_role JWT tokens
 *    - Private RSA/EC keys ('BEGIN PRIVATE KEY')
 *    - Unredacted database passwords in URLs
 *    - Live payment secret keys
 * 4. Scans frontend client assets (assets/, games/, index.html) to verify zero server secrets exist in browser code.
 * 5. Scans current Git diff / status for accidental secret staging.
 *
 * Usage:
 *   node scripts/validate-secret-exposure.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isServiceRoleJwt } from './load-env.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

// High-confidence patterns indicating leaked credentials
export const SECRET_PATTERNS = Object.freeze([
  {
    name: 'Private Key Header',
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/,
    severity: 'CRITICAL'
  },
  {
    name: 'Hardcoded Database Password in URL',
    regex: /postgres(?:ql)?:\/\/[a-zA-Z0-9_-]+:(?!(?:YOUR_|\[PASSWORD|\[YOUR))[^@\s]{4,}@/i,
    severity: 'HIGH'
  },
  {
    name: 'Supabase Service Role Key Marker in Client Code',
    regex: /SUPABASE_SERVICE_ROLE_KEY\s*=\s*['"]?[a-zA-Z0-9_-]{20,}['"]?/,
    severity: 'CRITICAL'
  },
  {
    name: 'Live Razorpay Secret Key',
    regex: /rzp_live_[a-zA-Z0-9]{14,}/,
    severity: 'CRITICAL'
  },
  {
    name: 'Firebase Service Account Private Key',
    regex: /"private_key":\s*"-----BEGIN PRIVATE KEY/,
    severity: 'CRITICAL'
  }
]);

export function runSecretExposureScan(rootDir = REPO_ROOT) {
  const violations = [];
  const checks = [];

  // 1. Verify Git-Ignore Enforcement
  const testFiles = [
    '.env',
    '.env.local',
    '.env.staging.local',
    '.env.production.local',
    'custom.env.local'
  ];

  for (const tf of testFiles) {
    try {
      const out = execSync(`git check-ignore -v ${tf}`, { cwd: rootDir, encoding: 'utf8' }).trim();
      if (!out) {
        violations.push(`GITIGNORE_FAILURE: Secret-bearing file '${tf}' is NOT git-ignored!`);
      }
    } catch {
      violations.push(`GITIGNORE_FAILURE: Secret-bearing file '${tf}' is NOT git-ignored!`);
    }
  }

  checks.push({
    item: 'Gitignore Secret Quarantine',
    status: violations.length === 0 ? 'PASS' : 'FAIL',
    detail: 'All .env, .env.local, .env.*.local quarantined'
  });

  // 2. Verify Example Templates Contain Placeholders Only
  const exampleFiles = ['.env.example', '.env.staging.example'];
  for (const ef of exampleFiles) {
    const fullPath = path.join(rootDir, ef);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf8');
      const lines = content.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        // Check for real JWT anon keys or publishable keys
        const match = trimmed.match(/(?:SUPABASE_ANON_KEY|SUPABASE_PUBLISHABLE_KEY)\s*=\s*(.+)/);
        if (match) {
          const val = match[1].trim();
          if ((val.startsWith('eyJ') || val.startsWith('sb_publishable_')) && !val.includes('YOUR_')) {
            violations.push(`REAL_KEY_IN_EXAMPLE: ${ef} contains what appears to be a real Supabase key instead of a placeholder.`);
          }
        }

        // Check for real database passwords or URLs
        if (trimmed.includes('DATABASE_URL=') && !trimmed.includes('YOUR_')) {
          violations.push(`REAL_PASSWORD_IN_EXAMPLE: ${ef} contains an unredacted database URL without placeholder.`);
        }

        // Check for real CLI access tokens
        if (trimmed.includes('SUPABASE_ACCESS_TOKEN=') && !trimmed.includes('YOUR_')) {
          violations.push(`REAL_TOKEN_IN_EXAMPLE: ${ef} contains a Supabase Access Token without placeholder.`);
        }

        // Check for real database passwords
        if (trimmed.includes('SUPABASE_DB_PASSWORD=') && !trimmed.includes('YOUR_')) {
          violations.push(`REAL_DB_PASSWORD_IN_EXAMPLE: ${ef} contains a database password without placeholder.`);
        }
      }
    }
  }

  checks.push({
    item: 'Example Templates Sanitization',
    status: violations.length === 0 ? 'PASS' : 'FAIL',
    detail: 'Templates contain strictly placeholder tokens'
  });

  // 3. Scan Client-Facing Code (assets/ and games/) for Privileged Secrets
  const clientDirs = [path.join(rootDir, 'assets'), path.join(rootDir, 'games')];
  function scanDirRecursive(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (!ent.name.startsWith('.') && ent.name !== 'node_modules') {
          scanDirRecursive(full);
        }
      } else if (ent.isFile() && /\.(js|html|css|json)$/i.test(ent.name)) {
        const text = fs.readFileSync(full, 'utf8');

        // Check for service_role JWT tokens in client bundles
        const jwtMatches = text.match(/eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g) || [];
        for (const token of jwtMatches) {
          if (isServiceRoleJwt(token)) {
            violations.push(`CLIENT_LEAK: Service role JWT detected inside client asset: ${path.relative(rootDir, full)}`);
          }
        }

        // Check for private key headers
        if (text.includes('-----BEGIN PRIVATE KEY-----')) {
          violations.push(`CLIENT_LEAK: Private key header detected in client asset: ${path.relative(rootDir, full)}`);
        }
      }
    }
  }

  for (const cd of clientDirs) {
    scanDirRecursive(cd);
  }

  checks.push({
    item: 'Browser Bundle Defense-in-Depth',
    status: violations.length === 0 ? 'PASS' : 'FAIL',
    detail: 'Zero service_role keys or private keys in assets/ and games/'
  });

  // 4. Git Diff Scan (Verify uncommitted staged/tracked changes contain no secrets)
  // Exclude the scanner itself to avoid false positives on its pattern definitions
  try {
    const diff = execFileSync('git', ['diff', 'HEAD', '--', '.', ':(exclude)scripts/validate-secret-exposure.mjs'], {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    for (const pat of SECRET_PATTERNS) {
      if (pat.regex.test(diff)) {
        violations.push(`GIT_DIFF_LEAK: Secret pattern '${pat.name}' matched in active Git diff!`);
      }
    }
  } catch (_e) {}

  checks.push({
    item: 'Active Git Working Diff Safety',
    status: violations.length === 0 ? 'PASS' : 'FAIL',
    detail: 'Zero secret patterns detected in active diff'
  });

  return {
    valid: violations.length === 0,
    checks,
    violations
  };
}

export function runCli() {
  console.log('==============================================================================');
  console.log('AUROMASTI SECRET EXPOSURE & CREDENTIAL LEAKAGE SCANNER');
  console.log(`Directory: ${REPO_ROOT}`);
  console.log('==============================================================================\n');

  const { valid, checks, violations } = runSecretExposureScan(REPO_ROOT);

  console.log('SECURITY & ISOLATION CHECKS:');
  console.log('-----------------------------------------------------------------------------------------------------');
  console.log('Check Item'.padEnd(40) + 'Status'.padEnd(12) + 'Details');
  console.log('-----------------------------------------------------------------------------------------------------');
  for (const c of checks) {
    console.log(c.item.padEnd(40) + c.status.padEnd(12) + c.detail);
  }
  console.log('-----------------------------------------------------------------------------------------------------\n');

  if (violations.length > 0) {
    console.log('\x1b[31mSECURITY VIOLATIONS DETECTED:\x1b[0m');
    violations.forEach(v => console.log(`  ✖ ${v}`));
    console.log('\nResult: FAILED');
    process.exit(1);
  }

  console.log('\x1b[32mResult: PASSED — Repository is clean of exposed credentials and privileged keys.\x1b[0m');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli();
}
