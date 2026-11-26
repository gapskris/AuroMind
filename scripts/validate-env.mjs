#!/usr/bin/env node
/**
 * AuroMasti Platform — Master Environment & Configuration Validator
 *
 * Validates syntax, safety, invariants, and completeness of environment variables
 * for Local Development and Cloudflare/Supabase Staging.
 *
 * Usage:
 *   node scripts/validate-env.mjs [--local | --staging | --file <path>]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadEnvFile,
  maskSecret,
  isServiceRoleJwt,
  isPrivilegedKey,
  isValidPublishableKey,
  loadEnvironment
} from './load-env.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

// Expected Project Constants
export const EXPECTED_SUPABASE_PROJECT_ID = 'rlqrtbjynaihdspbqtce';
export const EXPECTED_SUPABASE_REGION = 'ap-southeast-1';
export const EXPECTED_SUPABASE_URL = `https://${EXPECTED_SUPABASE_PROJECT_ID}.supabase.co`;
export const EXPECTED_POSTGRES_HOST = `db.${EXPECTED_SUPABASE_PROJECT_ID}.supabase.co`;
export const EXPECTED_CLOUDFLARE_PROJECT_NAME = 'auromasti';
export const EXPECTED_STAGING_URL = 'https://staging.auromasti.pages.dev';

/**
 * Determines whether a variable is sensitive and must be strictly redacted.
 * Zero-leakage policy: all credentials, tokens, passwords, database URLs,
 * and service keys are redacted.
 *
 * @param {string} key
 * @param {object} [spec]
 * @returns {boolean}
 */
export function isSensitiveVariable(key, spec = {}) {
  const k = (key || '').toUpperCase();
  const c = ((spec && spec.classification) || '').toUpperCase();

  if (
    c.includes('SECRET') ||
    c.includes('ONLY') ||
    c.includes('TOKEN') ||
    c.includes('PASSWORD') ||
    c.includes('CREDENTIAL') ||
    c.includes('PRIVATE') ||
    c.includes('CLI') ||
    c.includes('DATABASE')
  ) {
    return true;
  }

  if (
    k.includes('TOKEN') ||
    k.includes('PASSWORD') ||
    k.includes('SECRET') ||
    k.includes('SERVICE_ROLE') ||
    k.includes('PRIVATE_KEY') ||
    k.includes('ACCESS_TOKEN') ||
    k.includes('DATABASE_URL') ||
    k.includes('KEY')
  ) {
    return true;
  }

  return false;
}

export const VARIABLE_SPECIFICATION = Object.freeze({
  NODE_ENV: {
    category: 'RUNTIME',
    classification: 'PUBLIC',
    required: true,
    validator: v => ['development', 'staging', 'production', 'test'].includes(v),
    hint: "Must be 'development', 'staging', 'production', or 'test'"
  },
  COMMERCIAL_GATE_ENABLED: {
    category: 'SAFETY',
    classification: 'INVARIANT',
    required: true,
    validator: v => v === 'false' || v === false,
    hint: "MUST be strictly 'false' across all pre-release environments"
  },
  SUPABASE_PROJECT_ID: {
    category: 'SUPABASE',
    classification: 'PUBLIC',
    required: true,
    validator: v => v === EXPECTED_SUPABASE_PROJECT_ID,
    hint: `Must match AuroMasti project reference: ${EXPECTED_SUPABASE_PROJECT_ID}`
  },
  SUPABASE_REGION: {
    category: 'SUPABASE',
    classification: 'PUBLIC',
    required: false,
    validator: v => v === EXPECTED_SUPABASE_REGION,
    hint: `Expected region: ${EXPECTED_SUPABASE_REGION}`
  },
  SUPABASE_URL: {
    category: 'SUPABASE',
    classification: 'PUBLIC',
    required: true,
    validator: v => {
      try {
        const u = new URL(v);
        return u.protocol === 'https:' && u.hostname.includes('supabase.co');
      } catch {
        return false;
      }
    },
    hint: `Must be a valid Supabase URL: https://${EXPECTED_SUPABASE_PROJECT_ID}.supabase.co`
  },
  SUPABASE_PUBLISHABLE_KEY: {
    category: 'SUPABASE',
    classification: 'PUBLIC',
    required: false,
    validator: v => {
      if (!v || v.startsWith('YOUR_')) return 'PLACEHOLDER';
      if (isPrivilegedKey(v)) return 'SECURITY_VIOLATION_PRIVILEGED';
      if (!isValidPublishableKey(v)) return false;
      return true;
    },
    hint: "Canonical publishable key ('sb_publishable_...' or legacy 3-segment anon JWT). Must NEVER be a secret or service_role key!"
  },
  SUPABASE_ANON_KEY: {
    category: 'SUPABASE',
    classification: 'PUBLIC',
    required: false,
    validator: v => {
      if (!v || v.startsWith('YOUR_')) return 'PLACEHOLDER';
      if (isPrivilegedKey(v)) return 'SECURITY_VIOLATION_PRIVILEGED';
      if (!isValidPublishableKey(v)) return false;
      return true;
    },
    hint: "Backward-compatible alias for publishable key. Must NEVER be a service_role key or secret key!"
  },
  SUPABASE_SERVICE_ROLE_KEY: {
    category: 'SUPABASE',
    classification: 'SERVER_ONLY',
    required: false,
    validator: (v, all) => {
      if (!v || v.startsWith('YOUR_')) return 'PLACEHOLDER';
      if (v === all.SUPABASE_PUBLISHABLE_KEY || v === all.SUPABASE_ANON_KEY) return 'IDENTICAL_TO_ANON_KEY';
      if (typeof v !== 'string' || v.length < 20) return false;
      return true;
    },
    hint: 'Privileged server-side key. NEVER pass to browser bundles or public environment.'
  },
  SUPABASE_ACCESS_TOKEN: {
    category: 'MIGRATION_AUTH',
    classification: 'CLI_TOKEN',
    required: false,
    validator: (v, all) => {
      if (!v || v.startsWith('YOUR_')) return 'PLACEHOLDER';
      if (typeof v !== 'string' || v.length < 20) return false;
      if (isServiceRoleJwt(v)) return 'SECURITY_VIOLATION_SERVICE_ROLE';
      if (all.SUPABASE_DB_PASSWORD && v === all.SUPABASE_DB_PASSWORD) return 'TOKEN_EQUALS_PASSWORD';
      return true;
    },
    hint: "Personal Access Token for Supabase CLI (e.g. 'sbp_...'). Separate from database password."
  },
  SUPABASE_DB_PASSWORD: {
    category: 'MIGRATION_AUTH',
    classification: 'DATABASE_SECRET',
    required: false,
    validator: (v, all) => {
      if (!v || v.startsWith('YOUR_')) return 'PLACEHOLDER';
      if (typeof v !== 'string' || v.length < 8) return false;
      if (isServiceRoleJwt(v)) return 'SECURITY_VIOLATION_SERVICE_ROLE';
      if (all.SUPABASE_ACCESS_TOKEN && v === all.SUPABASE_ACCESS_TOKEN) return 'PASSWORD_EQUALS_TOKEN';
      return true;
    },
    hint: "Hosted PostgreSQL database password for rlqrtbjynaihdspbqtce. Kept separate from CLI token."
  },
  DATABASE_URL: {
    category: 'DATABASE',
    classification: 'SERVER_ONLY',
    required: false,
    validator: v => {
      if (!v) return true;
      if (v.includes('YOUR_')) return 'OPTIONAL_UNUSED';
      try {
        const u = new URL(v);
        return (u.protocol === 'postgres:' || u.protocol === 'postgresql:') && Boolean(u.hostname && u.port);
      } catch {
        return false;
      }
    },
    hint: `Optional direct connection URL: postgresql://postgres:[PASSWORD]@db.${EXPECTED_SUPABASE_PROJECT_ID}.supabase.co:5432/postgres?sslmode=require`
  },
  POSTGRES_PASSWORD: {
    category: 'DATABASE',
    classification: 'DATABASE_SECRET',
    required: false,
    validator: v => {
      if (!v) return true;
      if (v.startsWith('YOUR_')) return 'OPTIONAL_UNUSED';
      return typeof v === 'string' && v.length >= 8;
    },
    hint: 'Optional hosted PostgreSQL password alias for direct connection.'
  },
  POSTGRES_HOST: {
    category: 'DATABASE',
    classification: 'PUBLIC',
    required: false,
    validator: v => v === EXPECTED_POSTGRES_HOST,
    hint: `Expected database host: ${EXPECTED_POSTGRES_HOST}`
  },
  AUTH_SITE_URL: {
    category: 'AUTH',
    classification: 'PUBLIC',
    required: false,
    validator: v => {
      try {
        new URL(v);
        return true;
      } catch {
        return false;
      }
    },
    hint: 'Must be a valid HTTP/HTTPS URL'
  },
  STORAGE_AVATAR_BUCKET: {
    category: 'STORAGE',
    classification: 'PUBLIC',
    required: false,
    validator: v => v === 'avatars',
    hint: "Expected bucket name: 'avatars'"
  },
  STORAGE_ARTWORK_BUCKET: {
    category: 'STORAGE',
    classification: 'PUBLIC',
    required: false,
    validator: v => v === 'user-artwork',
    hint: "Expected bucket name: 'user-artwork'"
  },
  CLOUDFLARE_PROJECT_NAME: {
    category: 'CLOUDFLARE',
    classification: 'PUBLIC',
    required: false,
    validator: v => v === EXPECTED_CLOUDFLARE_PROJECT_NAME,
    hint: `Expected Pages project: ${EXPECTED_CLOUDFLARE_PROJECT_NAME}`
  },
  CLOUDFLARE_API_TOKEN: {
    category: 'CLOUDFLARE',
    classification: 'CI_ONLY',
    required: false,
    validator: v => {
      if (!v || v.startsWith('YOUR_')) return 'PLACEHOLDER';
      return typeof v === 'string' && v.length >= 20;
    },
    hint: 'Scoped Cloudflare API token (Pages:Edit). Do NOT use Global API Key!'
  }
});

/**
 * Validates a dictionary of environment variables against the specification.
 *
 * @param {Record<string, string>} env
 * @param {object} [options]
 * @returns {{ valid: boolean, errors: string[], warnings: string[], results: Array<object> }}
 */
export function validateEnvironmentDictionary(env, options = {}) {
  const isStaging = options.environment === 'staging' || env.NODE_ENV === 'staging';
  const errors = [];
  const warnings = [];
  const results = [];

  const hasPublishable = Boolean(env.SUPABASE_PUBLISHABLE_KEY && !env.SUPABASE_PUBLISHABLE_KEY.startsWith('YOUR_'));
  const hasAnon = Boolean(env.SUPABASE_ANON_KEY && !env.SUPABASE_ANON_KEY.startsWith('YOUR_'));
  const hasAnyPublishable = Boolean(
    (env.SUPABASE_PUBLISHABLE_KEY && env.SUPABASE_PUBLISHABLE_KEY.trim()) ||
    (env.SUPABASE_ANON_KEY && env.SUPABASE_ANON_KEY.trim())
  );

  // If neither key is provided in any form, report missing publishable key
  if (!hasAnyPublishable) {
    errors.push('[SUPABASE_PUBLISHABLE_KEY] MISSING: Missing required Supabase publishable key. Provide SUPABASE_PUBLISHABLE_KEY or SUPABASE_ANON_KEY.');
  }

  for (const [key, spec] of Object.entries(VARIABLE_SPECIFICATION)) {
    const val = env[key];
    const isRequired = spec.required;

    let status = 'OK';
    let detail = '';

    if (val === undefined || val === '') {
      if (key === 'SUPABASE_PUBLISHABLE_KEY' && (hasAnon || env.SUPABASE_ANON_KEY)) {
        status = 'NOT_SET';
        detail = 'Backward-compatible configuration active (satisfied by SUPABASE_ANON_KEY)';
      } else if (key === 'SUPABASE_ANON_KEY' && (hasPublishable || env.SUPABASE_PUBLISHABLE_KEY)) {
        status = 'NOT_SET';
        detail = 'Canonical configuration active (satisfied by SUPABASE_PUBLISHABLE_KEY)';
      } else if (key === 'SUPABASE_PUBLISHABLE_KEY' || key === 'SUPABASE_ANON_KEY') {
        status = 'MISSING';
        detail = spec.hint;
      } else if (isRequired) {
        status = 'MISSING';
        detail = `Missing required variable. ${spec.hint}`;
        errors.push(`[${key}] MISSING: ${detail}`);
      } else {
        status = 'NOT_SET';
        detail = 'Optional (Minimal Credential architecture)';
      }
    } else {
      const checkRes = spec.validator(val, env);
      if (checkRes === 'OPTIONAL_UNUSED') {
        status = 'OPTIONAL_UNUSED';
        detail = 'Optional direct-connection configuration unused in CLI migration workflow';
      } else if (checkRes === 'PLACEHOLDER') {
        status = 'PLACEHOLDER';
        detail = 'Value contains placeholder text. Replace with actual credential.';
        if (isStaging && isRequired) {
          warnings.push(`[${key}] PLACEHOLDER: Action required before staging deployment.`);
        }
      } else if (checkRes === 'SECURITY_VIOLATION_SERVICE_ROLE' || checkRes === 'SECURITY_VIOLATION_PRIVILEGED') {
        status = 'SECURITY_VIOLATION';
        detail = 'CRITICAL: Key contains service_role claims or secret format! This would expose admin access to users.';
        errors.push(`[${key}] SECURITY_VIOLATION: ${detail}`);
      } else if (checkRes === 'IDENTICAL_TO_ANON_KEY') {
        status = 'INVALID';
        detail = 'Service role key cannot be identical to publishable or anon key.';
        errors.push(`[${key}] INVALID: ${detail}`);
      } else if (checkRes === false) {
        status = 'INVALID';
        detail = `Validation failed. ${spec.hint}`;
        errors.push(`[${key}] INVALID: ${detail}`);
      } else {
        status = 'VALID';
        detail = 'Passed validation check';
      }
    }

    const masked = isSensitiveVariable(key, spec)
      ? maskSecret(val)
      : (val || '');

    results.push({
      key,
      category: spec.category,
      classification: spec.classification,
      status,
      maskedValue: masked,
      detail
    });
  }

  // Cross-variable security checks
  if (env.SUPABASE_SERVICE_ROLE_KEY) {
    if (env.SUPABASE_PUBLISHABLE_KEY && env.SUPABASE_PUBLISHABLE_KEY === env.SUPABASE_SERVICE_ROLE_KEY) {
      errors.push('CRITICAL: SUPABASE_PUBLISHABLE_KEY and SUPABASE_SERVICE_ROLE_KEY cannot have the same value!');
    }
    if (env.SUPABASE_ANON_KEY && env.SUPABASE_ANON_KEY === env.SUPABASE_SERVICE_ROLE_KEY) {
      errors.push('CRITICAL: SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY cannot have the same value!');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    results
  };
}

/**
 * CLI Entrypoint
 */
export function runCli() {
  const args = process.argv.slice(2);
  let targetFile = null;
  let targetEnv = 'development';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--staging') {
      targetEnv = 'staging';
    } else if (args[i] === '--local') {
      targetEnv = 'development';
    } else if (args[i] === '--file' && args[i + 1]) {
      targetFile = args[i + 1];
      i++;
    }
  }

  console.log('==============================================================================');
  console.log(`AUROMASTI ENVIRONMENT CONFIGURATION VALIDATOR`);
  console.log(`Target: ${targetEnv.toUpperCase()} | Working Directory: ${REPO_ROOT}`);
  console.log('==============================================================================\n');

  let envToValidate = {};
  let sourceDesc = '';

  if (targetFile) {
    const fullPath = path.isAbsolute(targetFile) ? targetFile : path.join(REPO_ROOT, targetFile);
    if (!fs.existsSync(fullPath)) {
      console.error(`Error: Specified file ${fullPath} does not exist.`);
      process.exit(1);
    }
    envToValidate = loadEnvFile(fullPath);
    sourceDesc = `File: ${targetFile}`;
  } else {
    const loaded = loadEnvironment({ environment: targetEnv, rootDir: REPO_ROOT });
    envToValidate = loaded.env;
    sourceDesc = loaded.loadedFiles.length > 0
      ? `Merged files: ${loaded.loadedFiles.join(', ')}`
      : 'No local .env files found (evaluated system process.env)';
  }

  console.log(`Configuration Source: ${sourceDesc}\n`);

  const { valid, errors, warnings, results } = validateEnvironmentDictionary(envToValidate, {
    environment: targetEnv
  });

  // Display Table
  console.log('VARIABLE INVENTORY & VALIDATION REPORT:');
  console.log('-----------------------------------------------------------------------------------------------------');
  console.log(
    'Variable Name'.padEnd(28) +
    'Classification'.padEnd(16) +
    'Status'.padEnd(16) +
    'Value / Preview'.padEnd(25) +
    'Notes / Hint'
  );
  console.log('-----------------------------------------------------------------------------------------------------');

  for (const r of results) {
    const statusFormatted = r.status === 'VALID' || r.status === 'OK'
      ? `\x1b[32m${r.status}\x1b[0m`
      : r.status === 'PLACEHOLDER'
        ? `\x1b[33m${r.status}\x1b[0m`
        : `\x1b[31m${r.status}\x1b[0m`;

    console.log(
      r.key.padEnd(28) +
      r.classification.padEnd(16) +
      r.status.padEnd(16) +
      (r.maskedValue || '(not set)').padEnd(25) +
      r.detail
    );
  }
  console.log('-----------------------------------------------------------------------------------------------------\n');

  console.log(`SUMMARY:`);
  console.log(`- Total Checked: ${results.length}`);
  console.log(`- Passed: ${results.filter(r => r.status === 'VALID' || r.status === 'OK').length}`);
  console.log(`- Optional / Not Set: ${results.filter(r => r.status === 'OPTIONAL_UNUSED' || r.status === 'NOT_SET').length}`);
  console.log(`- Placeholders: ${results.filter(r => r.status === 'PLACEHOLDER').length}`);
  console.log(`- Warnings: ${warnings.length}`);
  console.log(`- Errors: ${errors.length}\n`);

  if (warnings.length > 0) {
    console.log('WARNINGS:');
    warnings.forEach(w => console.log(`  ! ${w}`));
    console.log('');
  }

  if (errors.length > 0) {
    console.log('ERRORS:');
    errors.forEach(e => console.log(`  ✖ ${e}`));
    console.log('\nResult: FAILED');
    process.exit(1);
  }

  console.log('\x1b[32mResult: PASSED — Environment configuration is structurally valid and safe.\x1b[0m');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli();
}
