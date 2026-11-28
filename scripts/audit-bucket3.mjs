#!/usr/bin/env node
/**
 * AuroMasti Platform — Bucket 3 (Authentication, Identity & Edge Functions) Audit Runner
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSupabaseCli, CANONICAL_PROJECT_REF } from './migration-workflow.mjs';
import { loadEnvironment } from './load-env.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const loaded = loadEnvironment({ injectProcessEnv: false });
const env = loaded.env;

async function main() {
  console.log('==============================================================================');
  console.log('AUROMASTI BUCKET 3 AUDIT: AUTH, IDENTITY, STORAGE QUEUE & FUNCTIONS');
  console.log(`Target: ${CANONICAL_PROJECT_REF} | Region: ap-southeast-1`);
  console.log('==============================================================================\n');

  // 1. Inspect Auth Schema Tables & Live Counts
  console.log('1. DATABASE AUTH SCHEMA & IDENTITY TABLES:');
  const tempSqlPath = path.join(REPO_ROOT, 'supabase', 'temp_bucket3_audit.sql');
  const auditSql = `
    SELECT
      (SELECT count(*) FROM auth.users) AS auth_users_count,
      (SELECT count(*) FROM public.guest_identity_links) AS guest_links_count,
      (SELECT count(*) FROM public.user_profiles) AS profiles_count,
      (SELECT count(*) FROM public.storage_deletion_queue) AS deletion_queue_count;
  `;
  fs.writeFileSync(tempSqlPath, auditSql, 'utf8');

  try {
    const rawCounts = runSupabaseCli(['db', 'query', '--file', tempSqlPath, '--read-only'], {
      env,
      rootDir: REPO_ROOT,
      targetPooler: true
    });
    console.log('Catalog Counts:\n' + rawCounts + '\n');
  } finally {
    if (fs.existsSync(tempSqlPath)) fs.unlinkSync(tempSqlPath);
  }

  // 2. Query GoTrue / Auth Settings endpoint
  console.log('2. SUPABASE AUTH SETTINGS (GET /auth/v1/settings):');
  const key = env.SUPABASE_ANON_KEY || env.SUPABASE_PUBLISHABLE_KEY;
  try {
    const authSettingsRes = await fetch(`${env.SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }
    });
    const authSettings = await authSettingsRes.json();
    console.log('Auth Settings:', JSON.stringify(authSettings, null, 2));
  } catch (err) {
    console.log('Auth settings query error:', err.message);
  }
  console.log('');

  // 3. Inspect Guest Identity Implementation
  console.log('3. GUEST IDENTITY & ACCOUNT LINKING AUDIT:');
  const guestSdkPath = path.join(REPO_ROOT, 'assets', 'sdk', 'guest-identity.js');
  const hasGuestSdk = fs.existsSync(guestSdkPath);
  console.log(`  - assets/sdk/guest-identity.js: ${hasGuestSdk ? 'PRESENT' : 'MISSING'}`);
  if (hasGuestSdk) {
    const src = fs.readFileSync(guestSdkPath, 'utf8');
    const hasCrypto = src.includes('crypto.subtle') || src.includes('getRandomValues');
    const hasEd25519orSha = src.includes('SHA-256') || src.includes('digest');
    console.log(`    - Cryptographic ID Generation: ${hasCrypto ? 'YES' : 'NO'}`);
    console.log(`    - Hash / Proof of Possession: ${hasEd25519orSha ? 'YES' : 'NO'}`);
  }

  // 4. Inspect Storage Deletion Queue Architecture
  console.log('\n4. STORAGE DELETION QUEUE & SCHEDULED WORKER:');
  const delQueuePath = path.join(REPO_ROOT, 'assets', 'sdk', 'artwork-concurrency.js');
  if (fs.existsSync(delQueuePath)) {
    const src = fs.readFileSync(delQueuePath, 'utf8');
    const hasQueueClass = src.includes('StorageDeletionQueue');
    console.log(`  - StorageDeletionQueue in artwork-concurrency.js: ${hasQueueClass ? 'PRESENT' : 'MISSING'}`);
  }

  // 5. Inspect Edge Functions Inventory
  console.log('\n5. EDGE FUNCTIONS INVENTORY & COMPLETENESS:');
  const fnDir = path.join(REPO_ROOT, 'supabase', 'functions');
  const canonicalFns = [
    'cleanup-telemetry',
    'delete-account',
    'ingest-telemetry',
    'owner-metrics',
    'sync-save',
    'verify-entitlements'
  ];

  for (const fn of canonicalFns) {
    const p = path.join(fnDir, fn);
    const exists = fs.existsSync(p);
    const hasIndexTs = exists && fs.existsSync(path.join(p, 'index.ts'));
    console.log(`  - Function '${fn}': ${exists ? 'DIR_EXISTS' : 'MISSING'} | index.ts: ${hasIndexTs ? 'YES' : 'NO'}`);
  }

  // 6. Test Edge Functions deployment permission check
  console.log('\n6. SUPABASE CLI FUNCTIONS DEPLOYMENT PREREQUISITES:');
  try {
    runSupabaseCli(['functions', 'list', '--remote=rlqrtbjynaihdspbqtce'], { env, rootDir: REPO_ROOT });
    console.log('  - Edge Functions CLI Access: PERMITTED');
  } catch (err) {
    const msg = err.message || '';
    if (msg.includes('403') || msg.includes('edge_functions_read') || msg.includes('missing_permissions')) {
      console.log('  - Edge Functions CLI Access: BLOCKED (403 Forbidden - SUPABASE_ACCESS_TOKEN lacks edge_functions_read/write scope)');
    } else {
      console.log('  - Edge Functions CLI Access: FAILED (' + msg.split('\n')[0] + ')');
    }
  }

  console.log('\n==============================================================================');
  console.log('BUCKET 3 AUDIT COMPLETED.');
  console.log('==============================================================================');
}

main().catch(err => {
  console.error('\nAUDIT FAILED:', err.message);
  process.exit(1);
});
