/**
 * AuroMind Shared Platform SDK — Supabase Providers Factory
 *
 * Bundles the lightweight Supabase HTTP client and all SDK provider adapters:
 *   - auth: SupabaseAuthProvider
 *   - cloudSync: SupabaseSyncProvider
 *   - telemetryTransport: SupabaseTelemetryTransport
 *   - entitlements: SupabaseEntitlementsProvider
 *   - remoteConfig: SupabaseRemoteConfigProvider
 *   - accountProvider: SupabaseAccountProvider
 */

import { createSupabaseClient } from './supabase-client.js';
import { createSupabaseAuthProvider } from './supabase-auth-provider.js';
import { createSupabaseSyncProvider } from './supabase-sync-provider.js';
import { createSupabaseTelemetryTransport } from './supabase-telemetry-transport.js';
import { createSupabaseEntitlementsProvider } from './supabase-entitlements-provider.js';
import { createSupabaseRemoteConfigProvider } from './supabase-remote-config-provider.js';
import { createSupabaseAccountProvider } from './supabase-account-provider.js';
import { createSupabaseProfileProvider } from './supabase-profile-provider.js';
import { createSupabaseStorageProvider } from './supabase-storage-provider.js';

export function createSupabaseProviders(config = {}) {
  const client = createSupabaseClient(config);

  return Object.freeze({
    client,
    auth: createSupabaseAuthProvider(client),
    cloudSync: createSupabaseSyncProvider(client),
    telemetryTransport: createSupabaseTelemetryTransport(client),
    entitlements: createSupabaseEntitlementsProvider(client),
    remoteConfig: createSupabaseRemoteConfigProvider(client),
    accountProvider: createSupabaseAccountProvider(client),
    profileProvider: createSupabaseProfileProvider(client),
    storageProvider: createSupabaseStorageProvider(client)
  });
}

export default createSupabaseProviders;
