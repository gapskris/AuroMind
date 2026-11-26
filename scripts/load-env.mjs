/**
 * AuroMasti Platform — Zero-Dependency Environment Variable Loader
 *
 * Implements deterministic environment loading, precedence resolution,
 * type sanitization, and secret redaction for logging and diagnostics.
 *
 * Precedence Order:
 * 1. Process environment (process.env)
 * 2. .env.<environment>.local (e.g. .env.staging.local)
 * 3. .env.local
 * 4. .env.<environment>
 * 5. .env
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Parses raw dotenv file content into key-value pairs.
 * Handles quoted strings, comments, export prefixes, and empty lines.
 *
 * @param {string} content
 * @returns {Record<string, string>}
 */
export function parseEnvContent(content) {
  const result = {};
  if (typeof content !== 'string') return result;

  const lines = content.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    // Strip leading "export " if present
    const cleaned = line.startsWith('export ') ? line.slice(7).trim() : line;
    const eqIdx = cleaned.indexOf('=');
    if (eqIdx === -1) continue;

    const key = cleaned.slice(0, eqIdx).trim();
    let val = cleaned.slice(eqIdx + 1).trim();

    if (!key) continue;

    // Handle quoted values
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    } else {
      // Strip inline comments for unquoted values
      const commentIdx = val.indexOf(' #');
      if (commentIdx !== -1) {
        val = val.slice(0, commentIdx).trim();
      }
    }

    result[key] = val;
  }

  return result;
}

/**
 * Reads and parses an environment file if it exists.
 *
 * @param {string} filePath
 * @returns {Record<string, string>}
 */
export function loadEnvFile(filePath) {
  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const content = fs.readFileSync(filePath, 'utf8');
      return parseEnvContent(content);
    }
  } catch (_e) {}
  return {};
}

/**
 * Redacts sensitive credentials for logging, error reports, and console outputs.
 * Strict zero-character-leakage guarantee: never prints prefixes, suffixes,
 * head/tail characters, or length information.
 *
 * @param {string} val
 * @param {number} [_preserveHead] Deprecated - ignored to ensure zero leakage
 * @param {number} [_preserveTail] Deprecated - ignored to ensure zero leakage
 * @returns {string}
 */
export function maskSecret(val, _preserveHead, _preserveTail) {
  if (typeof val !== 'string' || !val) return '';
  const trimmed = val.trim();
  if (!trimmed) return '';
  if (trimmed.includes('YOUR_') || trimmed.startsWith('<') || trimmed.toLowerCase().includes('placeholder')) {
    return '[PLACEHOLDER]';
  }
  return '[REDACTED]';
}

/**
 * Inspects a candidate JWT token to determine if it has service_role claims.
 * Also detects new Supabase secret format (sb_secret_...).
 *
 * @param {string} token
 * @returns {boolean}
 */
export function isServiceRoleJwt(token) {
  if (typeof token !== 'string') return false;
  const trimmed = token.trim();
  if (trimmed.startsWith('sb_secret_')) return true;
  if (trimmed.includes('service_role')) return true;
  const parts = trimmed.split('.');
  if (parts.length !== 3) return false;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '=');
    const jsonStr = Buffer.from(padded, 'base64').toString('utf8');
    const claims = JSON.parse(jsonStr);
    return Boolean(
      claims &&
      typeof claims === 'object' &&
      (claims.role === 'service_role' || claims.user_role === 'service_role')
    );
  } catch {
    return false;
  }
}

/**
 * Checks if a token is a privileged secret credential (service_role or sb_secret_).
 *
 * @param {string} token
 * @returns {boolean}
 */
export function isPrivilegedKey(token) {
  if (typeof token !== 'string') return false;
  const trimmed = token.trim();
  if (trimmed.startsWith('sb_secret_')) return true;
  if (isServiceRoleJwt(trimmed)) return true;
  return false;
}

/**
 * Validates whether a token is a valid Supabase publishable key.
 * Supports:
 * 1. New Supabase publishable key format: sb_publishable_...
 * 2. Legacy three-segment anon JWT (role: anon)
 * Strictly rejects privileged credentials (sb_secret_... and service_role JWTs).
 *
 * @param {string} token
 * @returns {boolean}
 */
export function isValidPublishableKey(token) {
  if (typeof token !== 'string') return false;
  const trimmed = token.trim();
  if (!trimmed) return false;
  if (isPrivilegedKey(trimmed)) return false;

  // Format 1: New Supabase publishable key format
  if (trimmed.startsWith('sb_publishable_')) {
    return trimmed.length >= 20;
  }

  // Format 2: Legacy three-segment anon JWT
  const parts = trimmed.split('.');
  if (parts.length === 3) {
    return true;
  }

  return false;
}

/**
 * Loads and merges environment variables according to strict precedence rules.
 *
 * @param {object} [options]
 * @param {string} [options.environment='development']
 * @param {string} [options.rootDir]
 * @param {boolean} [options.injectProcessEnv=true]
 * @returns {{ env: Record<string, string>, loadedFiles: string[] }}
 */
export function loadEnvironment({
  environment = process.env.NODE_ENV || 'development',
  rootDir = process.cwd(),
  injectProcessEnv = true
} = {}) {
  const normEnv = environment.toLowerCase().trim();
  const loadedFiles = [];

  const candidateFiles = [
    `.env.${normEnv}.local`,
    '.env.local',
    `.env.${normEnv}`,
    '.env'
  ];

  const merged = {};

  // Load from lowest to highest precedence so higher overrides lower
  for (let i = candidateFiles.length - 1; i >= 0; i--) {
    const fileName = candidateFiles[i];
    const fullPath = path.join(rootDir, fileName);
    if (fs.existsSync(fullPath)) {
      const parsed = loadEnvFile(fullPath);
      Object.assign(merged, parsed);
      loadedFiles.push(fileName);
    }
  }

  // Process.env takes ultimate precedence
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) {
      merged[k] = v;
    }
  }

  // Canonical precedence resolution between SUPABASE_PUBLISHABLE_KEY and SUPABASE_ANON_KEY
  const pubKey = merged.SUPABASE_PUBLISHABLE_KEY;
  const anonKey = merged.SUPABASE_ANON_KEY;
  const hasPub = typeof pubKey === 'string' && pubKey.trim() !== '' && !pubKey.startsWith('YOUR_');
  const hasAnon = typeof anonKey === 'string' && anonKey.trim() !== '' && !anonKey.startsWith('YOUR_');

  if (hasPub) {
    // Canonical SUPABASE_PUBLISHABLE_KEY takes precedence; sync to SUPABASE_ANON_KEY for backward compatibility
    merged.SUPABASE_ANON_KEY = pubKey;
  } else if (hasAnon) {
    // Backward compatibility: populate SUPABASE_PUBLISHABLE_KEY from legacy SUPABASE_ANON_KEY
    merged.SUPABASE_PUBLISHABLE_KEY = anonKey;
  }

  // Inject into process.env if requested
  if (injectProcessEnv) {
    for (const [k, v] of Object.entries(merged)) {
      if (process.env[k] === undefined) {
        process.env[k] = v;
      }
    }
  }

  return {
    env: merged,
    loadedFiles
  };
}

export default {
  parseEnvContent,
  loadEnvFile,
  maskSecret,
  isServiceRoleJwt,
  isPrivilegedKey,
  isValidPublishableKey,
  loadEnvironment
};
