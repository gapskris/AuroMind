/**
 * AuroMind Shared Platform SDK — Firebase Providers Factory
 *
 * Bundles the lightweight Firebase HTTP client and all SDK provider adapters:
 *   - auth: FirebaseAuthProvider
 *   - cloudSync: FirestoreSyncProvider
 *   - telemetryTransport: FirebaseTelemetryTransport
 *   - entitlements: FirebaseEntitlementsProvider
 *   - remoteConfig: FirebaseRemoteConfigProvider
 *   - accountProvider: FirebaseAccountProvider
 */

import { createFirebaseClient } from './firebase-client.js';
import { createFirebaseAuthProvider } from './firebase-auth-provider.js';
import { createFirestoreSyncProvider } from './firestore-sync-provider.js';
import { createFirebaseTelemetryTransport } from './firebase-telemetry-transport.js';
import { createFirebaseEntitlementsProvider } from './firebase-entitlements-provider.js';
import { createFirebaseRemoteConfigProvider } from './firebase-remote-config-provider.js';
import { createFirebaseAccountProvider } from './firebase-account-provider.js';

export {
  createFirebaseClient,
  createFirebaseAuthProvider,
  createFirestoreSyncProvider,
  createFirebaseTelemetryTransport,
  createFirebaseEntitlementsProvider,
  createFirebaseRemoteConfigProvider,
  createFirebaseAccountProvider
};

export function createFirebaseProviders(config = {}) {
  const client = createFirebaseClient(config);

  return Object.freeze({
    client,
    auth: createFirebaseAuthProvider(client),
    cloudSync: createFirestoreSyncProvider(client),
    telemetryTransport: createFirebaseTelemetryTransport(client),
    entitlements: createFirebaseEntitlementsProvider(client),
    remoteConfig: createFirebaseRemoteConfigProvider(client),
    accountProvider: createFirebaseAccountProvider(client)
  });
}

export default createFirebaseProviders;
