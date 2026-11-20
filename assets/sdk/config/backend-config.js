/**
 * AuroMind Platform — Centralized Backend & Provider Configuration
 *
 * Centralizes backend provider selection, externalized environment endpoints,
 * and decoupling of games from concrete cloud implementations.
 *
 * Architecture Invariants:
 * 1. Games NEVER import or reference concrete backend providers directly.
 * 2. Changing backend providers requires an adapter/configuration change,
 *    never rewriting individual games.
 * 3. SUPABASE_SERVICE_ROLE_KEY is strictly forbidden in client-accessible configuration.
 * 4. FIREBASE service account private keys and credentials are strictly forbidden.
 * 5. SUPABASE remains the default backend provider. Firebase is selected ONLY when explicitly requested.
 */

// Supported provider identifiers
export const SUPPORTED_PROVIDERS = Object.freeze({
  NULL: 'null',            // Local-first, offline-only fallback
  SUPABASE: 'supabase',    // Production Supabase backend (Auth, Cloud Sync, Telemetry, RLS)
  FIREBASE: 'firebase',    // Google Firebase backend (Auth, Cloud Firestore, Cloud Functions)
  CUSTOM: 'custom'         // Extensible third-party provider adapter
});

/**
 * Detect runtime environment: 'development', 'testing', or 'production'
 */
export function detectEnvironment(env = {}) {
  const globalObj = typeof window !== 'undefined' ? window : globalThis;
  if (env.NODE_ENV === 'test' || globalObj.__AUROMIND_TEST_ENV__) {
    return 'testing';
  }
  if (typeof location !== 'undefined') {
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      return 'development';
    }
    return 'production';
  }
  return 'development';
}

/**
 * Resolves externalized backend configuration.
 * Priority:
 * 1. Explicit config parameter
 * 2. window.__AUROMIND_BACKEND_CONFIG__
 * 3. window.__AUROMIND_SUPABASE_CONFIG__
 * 4. window.__AUROMIND_FIREBASE_CONFIG__ (only if provider === 'firebase')
 * 5. window.AUROMIND_SUPABASE_URL / window.AUROMIND_SUPABASE_ANON_KEY
 */
export function resolveBackendConfig(explicitConfig = null) {
  const globalObj = typeof window !== 'undefined' ? window : globalThis;
  const raw = explicitConfig ||
              globalObj.__AUROMIND_BACKEND_CONFIG__ ||
              globalObj.__AUROMIND_SUPABASE_CONFIG__ ||
              (globalObj.__AUROMIND_FIREBASE_CONFIG__ && globalObj.__AUROMIND_FIREBASE_CONFIG__.provider === SUPPORTED_PROVIDERS.FIREBASE ? globalObj.__AUROMIND_FIREBASE_CONFIG__ : null) || {
                provider: SUPPORTED_PROVIDERS.SUPABASE,
                supabaseUrl: globalObj.AUROMIND_SUPABASE_URL || null,
                supabaseAnonKey: globalObj.AUROMIND_SUPABASE_ANON_KEY || null
              };

  // The existing Supabase selection must remain default unless explicitly set to firebase or null
  const provider = raw.provider || (raw.supabaseUrl ? SUPPORTED_PROVIDERS.SUPABASE : (raw.projectId && raw.provider === SUPPORTED_PROVIDERS.FIREBASE ? SUPPORTED_PROVIDERS.FIREBASE : SUPPORTED_PROVIDERS.SUPABASE));

  // Strict defense-in-depth: Rejection of Supabase service role key in frontend configuration
  const supabaseUrl = raw.url || raw.supabaseUrl || null;
  const supabaseAnonKey = raw.anonKey || raw.supabaseAnonKey || null;

  if (raw.serviceRoleKey ||
      (typeof supabaseAnonKey === 'string' && supabaseAnonKey.includes('service_role'))) {
    const err = new Error('SECURITY VIOLATION: Service role key must NEVER be passed to frontend configuration');
    err.code = 'SERVICE_ROLE_KEY_FORBIDDEN';
    throw err;
  }

  // Strict defense-in-depth: Rejection of Firebase service account / private keys in frontend configuration
  const rawConfigStr = JSON.stringify(raw);
  if (
    raw.privateKey ||
    raw.private_key ||
    raw.clientEmail ||
    raw.client_email ||
    raw.serviceAccount ||
    rawConfigStr.includes('BEGIN PRIVATE KEY') ||
    rawConfigStr.includes('service_account')
  ) {
    const err = new Error('SECURITY VIOLATION: Firebase service account private keys must NEVER be passed to frontend configuration.');
    err.code = 'FIREBASE_SECRET_KEY_FORBIDDEN';
    throw err;
  }

  // Extract Firebase configuration if provider is firebase
  const firebaseConfig = (provider === SUPPORTED_PROVIDERS.FIREBASE)
    ? Object.freeze({
        projectId: raw.projectId || raw.project_id || (raw.firebase && raw.firebase.projectId) || null,
        apiKey: raw.apiKey || raw.api_key || (raw.firebase && raw.firebase.apiKey) || null,
        authDomain: raw.authDomain || (raw.firebase && raw.firebase.authDomain) || null,
        emulatorHost: raw.emulatorHost || (raw.firebase && raw.firebase.emulatorHost) || null,
        emulatorAuthHost: raw.emulatorAuthHost || (raw.firebase && raw.firebase.emulatorAuthHost) || null,
        emulatorFunctionsHost: raw.emulatorFunctionsHost || (raw.firebase && raw.firebase.emulatorFunctionsHost) || null
      })
    : null;

  const env = detectEnvironment();

  const isConfigured = (provider === SUPPORTED_PROVIDERS.FIREBASE)
    ? Boolean(firebaseConfig && firebaseConfig.projectId && (firebaseConfig.apiKey || firebaseConfig.emulatorAuthHost))
    : Boolean(supabaseUrl && supabaseAnonKey);

  return Object.freeze({
    environment: env,
    provider,
    isConfigured,
    supabaseUrl,
    supabaseAnonKey,
    firebaseConfig
  });
}

/**
 * Instantiates the providers corresponding to the centralized configuration.
 * Demonstrates that changing backend providers (Supabase <-> Firebase <-> Custom)
 * only requires providing a corresponding adapter bundle to the SDK, keeping all 6 games untouched.
 */
export async function createConfiguredProviders(backendConfig = null) {
  const resolved = resolveBackendConfig(backendConfig);

  if (resolved.provider === SUPPORTED_PROVIDERS.SUPABASE && resolved.isConfigured) {
    const mod = await import('../providers/supabase/index.js');
    if (mod && typeof mod.createSupabaseProviders === 'function') {
      return mod.createSupabaseProviders({
        url: resolved.supabaseUrl,
        anonKey: resolved.supabaseAnonKey
      });
    }
  }

  if (resolved.provider === SUPPORTED_PROVIDERS.FIREBASE && resolved.isConfigured) {
    const mod = await import('../providers/firebase/index.js');
    if (mod && typeof mod.createFirebaseProviders === 'function') {
      return mod.createFirebaseProviders(resolved.firebaseConfig);
    }
  }

  // Fallback to null (local-first, offline-safe) providers
  return null;
}

export default {
  SUPPORTED_PROVIDERS,
  detectEnvironment,
  resolveBackendConfig,
  createConfiguredProviders
};
