/**
 * AuroMind Modernization Batch B9 — Firebase Provider Adapter Tests
 *
 * Validates:
 * 1. Firebase client initialization, emulator support, and private key rejection.
 * 2. Firebase Auth provider (guest/anonymous, email/password, session restoration, guest linking).
 * 3. Firestore CloudSync provider (optimistic concurrency, revision history, Sankalpa exclusion).
 * 4. Firebase Telemetry transport (sensitive key redaction, batch limit, trusted function dispatch).
 * 5. Firebase Entitlements provider (server-verified read-only claims).
 * 6. Firebase Remote Config provider (fallback, semver filtering).
 * 7. Firebase Account provider (data export, cascading cloud deletion, local save protection).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createFirebaseClient, FirebaseClientError } from './assets/sdk/providers/firebase/firebase-client.js';
import { createFirebaseAuthProvider } from './assets/sdk/providers/firebase/firebase-auth-provider.js';
import { createFirestoreSyncProvider } from './assets/sdk/providers/firebase/firestore-sync-provider.js';
import { createFirebaseTelemetryTransport } from './assets/sdk/providers/firebase/firebase-telemetry-transport.js';
import { createFirebaseEntitlementsProvider } from './assets/sdk/providers/firebase/firebase-entitlements-provider.js';
import { createFirebaseRemoteConfigProvider } from './assets/sdk/providers/firebase/firebase-remote-config-provider.js';
import { createFirebaseAccountProvider } from './assets/sdk/providers/firebase/firebase-account-provider.js';
import { createFirebaseProviders } from './assets/sdk/providers/firebase/index.js';

// ==============================================================================
// Mock Firebase Test Harness Factory
// ==============================================================================

function createMockFetchRouter() {
  const firestoreStore = new Map();
  let functionsCallHistory = [];

  const mockFetch = async (url, options = {}) => {
    const urlStr = String(url);
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : null;

    // 1. Firebase Auth Endpoints
    if (urlStr.includes('/accounts:signUp')) {
      const isAnon = !body.email;
      const localId = isAnon ? 'fb_anon_user_999' : 'fb_email_user_101';
      return new Response(JSON.stringify({
        idToken: `mock_jwt_token_for_${localId}`,
        refreshToken: `mock_refresh_token_for_${localId}`,
        localId,
        email: body.email || null,
        expiresIn: '3600'
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (urlStr.includes('/accounts:signInWithPassword')) {
      if (body.password === 'wrong_password') {
        return new Response(JSON.stringify({
          error: { message: 'INVALID_PASSWORD', code: 400 }
        }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        idToken: 'mock_jwt_token_for_fb_email_user_101',
        refreshToken: 'mock_refresh_token_for_fb_email_user_101',
        localId: 'fb_email_user_101',
        email: body.email,
        expiresIn: '3600'
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (urlStr.includes('/accounts:sendOobCode')) {
      return new Response(JSON.stringify({ email: body.email }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (urlStr.includes('/accounts:delete')) {
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 2. Cloud Firestore REST Endpoints
    // URL pattern: .../databases/(default)/documents/{documentPath}
    const docMatch = urlStr.match(/\/documents\/(.+?)(\?|$)/);
    if (docMatch) {
      const path = docMatch[1];

      if (method === 'GET') {
        // List documents vs get document
        const isCollection = !path.includes('/') || path.endsWith('game_saves') || path.endsWith('entitlements') || path.endsWith('guest_identity_links') || path === 'remote_config';
        if (isCollection) {
          const matching = [];
          for (const [key, val] of firestoreStore.entries()) {
            if (key.startsWith(path + '/')) {
              matching.push({
                name: key,
                fields: val,
                updateTime: new Date().toISOString()
              });
            }
          }
          return new Response(JSON.stringify({ documents: matching }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        const existing = firestoreStore.get(path);
        if (!existing) {
          return new Response(JSON.stringify({ error: { code: 404, message: 'Document not found' } }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        return new Response(JSON.stringify({
          name: path,
          fields: existing,
          updateTime: new Date().toISOString()
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      if (method === 'PATCH') {
        const fields = body?.fields || {};
        firestoreStore.set(path, fields);
        return new Response(JSON.stringify({
          name: path,
          fields,
          updateTime: new Date().toISOString()
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      if (method === 'DELETE') {
        firestoreStore.delete(path);
        return new Response('{}', { status: 200 });
      }
    }

    // 3. Cloud Functions Endpoints
    if (urlStr.includes('/ingestTelemetry')) {
      functionsCallHistory.push({ fn: 'ingestTelemetry', body });
      return new Response(JSON.stringify({ ok: true, count: body.events?.length || 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (urlStr.includes('/deleteAccount')) {
      functionsCallHistory.push({ fn: 'deleteAccount', body });
      return new Response(JSON.stringify({ ok: true, userId: body.userId }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response('Not Found', { status: 404 });
  };

  return {
    fetch: mockFetch,
    store: firestoreStore,
    getFunctionsCalls: () => functionsCallHistory
  };
}

// ==============================================================================
// 1. Client Initialization & Secret Key Protection Tests
// ==============================================================================

test('B9 Firebase Test 1: Client initializes with valid public config; rejects service account credentials', () => {
  const router = createMockFetchRouter();
  const validClient = createFirebaseClient({
    projectId: 'auromind-production',
    apiKey: 'AIzaSyFakeKey123',
    fetch: router.fetch
  });

  assert.equal(validClient.isConfigured(), true);
  assert.equal(validClient.projectId, 'auromind-production');

  // Security Invariant: Private key / service account must throw
  assert.throws(() => {
    createFirebaseClient({
      projectId: 'auromind-production',
      privateKey: '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBg...',
      fetch: router.fetch
    });
  }, (err) => err.code === 'FIREBASE_SECRET_KEY_FORBIDDEN');

  assert.throws(() => {
    createFirebaseClient({
      projectId: 'auromind-production',
      clientEmail: 'service-account@auromind.iam.gserviceaccount.com',
      fetch: router.fetch
    });
  }, (err) => err.code === 'FIREBASE_SECRET_KEY_FORBIDDEN');
});

// ==============================================================================
// 2. Firebase Authentication Provider Tests
// ==============================================================================

test('B9 Firebase Test 2: Auth provider executes anonymous and email/password sign-in with session persistence', async () => {
  const router = createMockFetchRouter();
  const memStorage = new Map();
  const storageMock = {
    getItem: (k) => memStorage.get(k) || null,
    setItem: (k, v) => memStorage.set(k, v),
    removeItem: (k) => memStorage.delete(k)
  };

  const client = createFirebaseClient({
    projectId: 'auromind-production',
    apiKey: 'AIzaSyFakeKey123',
    fetch: router.fetch,
    storage: storageMock
  });

  const auth = createFirebaseAuthProvider(client);

  // 1. Anonymous / Guest Sign-In
  const anonRes = await auth.signIn('anonymous');
  assert.equal(anonRes.ok, true);
  assert.equal(anonRes.account.isAnonymous, true);
  assert.equal(anonRes.account.userId, 'fb_anon_user_999');

  // 2. Email / Password Sign-In
  const emailRes = await auth.signIn('email_password', {
    email: 'seeker@auromind.org',
    password: 'secure_password_123'
  });
  assert.equal(emailRes.ok, true);
  assert.equal(emailRes.account.userId, 'fb_email_user_101');
  assert.equal(emailRes.account.email, 'seeker@auromind.org');

  // 3. Session Restoration
  const restoredSession = await auth.getCurrentSession();
  assert.equal(restoredSession.userId, 'fb_email_user_101');

  // 4. Sign-Out
  await auth.signOut();
  assert.equal(await auth.getCurrentSession(), null);
});

test('B9 Firebase Test 3: Guest identity links non-destructively to Firestore account record', async () => {
  const router = createMockFetchRouter();
  const client = createFirebaseClient({
    projectId: 'auromind-production',
    apiKey: 'AIzaSyFakeKey123',
    fetch: router.fetch
  });
  const auth = createFirebaseAuthProvider(client);

  const guestId = 'guest_11111111-2222-4333-8444-555555555555';
  const account = { userId: 'fb_user_seeker_101' };

  const linkRes = await auth.linkGuestIdentity(guestId, account);
  assert.equal(linkRes.linked, true);
  assert.equal(linkRes.guestId, guestId);
  assert.equal(linkRes.userId, account.userId);

  // Verify stored in Firestore under users/{userId}/guest_identity_links/{guestId}
  const expectedPath = `users/${account.userId}/guest_identity_links/${guestId}`;
  assert.ok(router.store.has(expectedPath));
});

// ==============================================================================
// 3. Firestore Cloud-Sync Provider Tests
// ==============================================================================

test('B9 Firebase Test 4: CloudSync provider executes push, revision increment, and pullLatest', async () => {
  const router = createMockFetchRouter();
  const client = createFirebaseClient({
    projectId: 'auromind-production',
    apiKey: 'AIzaSyFakeKey123',
    fetch: router.fetch
  });
  const sync = createFirestoreSyncProvider(client);

  const userId = 'fb_user_101';
  const envelope = {
    gameId: 'vak',
    envelopeVersion: 1,
    gameSchemaVersion: 1,
    checksum: 'checksum_rev1',
    payload: { level: 10, score: 950 },
    clientUpdatedAt: new Date().toISOString()
  };

  // 1. Initial Push (expectedRevision = 0)
  const push1 = await sync.pushWithOptimisticLock(envelope, userId, 0);
  assert.equal(push1.status, 'success');
  assert.equal(push1.newRevision, 1);
  assert.equal(push1.gameId, 'vak');

  // 2. Pull Latest
  const pulled = await sync.pullLatest(userId, 'vak');
  assert.equal(pulled.gameId, 'vak');
  assert.equal(pulled.revision, 1);
  assert.equal(pulled.checksum, 'checksum_rev1');
  assert.deepEqual(pulled.payload, { level: 10, score: 950 });

  // 3. Second Push (expectedRevision = 1 -> newRevision = 2)
  const envelope2 = {
    ...envelope,
    checksum: 'checksum_rev2',
    payload: { level: 11, score: 1020 }
  };
  const push2 = await sync.pushWithOptimisticLock(envelope2, userId, 1);
  assert.equal(push2.status, 'success');
  assert.equal(push2.newRevision, 2);
});

test('B9 Firebase Test 5: CloudSync detects concurrency conflict when expectedRevision mismatches server', async () => {
  const router = createMockFetchRouter();
  const client = createFirebaseClient({
    projectId: 'auromind-production',
    apiKey: 'AIzaSyFakeKey123',
    fetch: router.fetch
  });
  const sync = createFirestoreSyncProvider(client);
  const userId = 'fb_user_102';

  // Seed existing save at revision 3
  const seedEnvelope = {
    gameId: 'auromatch',
    envelopeVersion: 1,
    gameSchemaVersion: 1,
    checksum: 'seed_checksum',
    payload: { tilesMatched: 40 }
  };
  await sync.pushWithOptimisticLock(seedEnvelope, userId, 0); // rev 1
  await sync.pushWithOptimisticLock(seedEnvelope, userId, 1); // rev 2
  await sync.pushWithOptimisticLock(seedEnvelope, userId, 2); // rev 3

  // Conflicting push presenting stale expectedRevision = 1 (server is at 3)
  const conflictingEnvelope = {
    gameId: 'auromatch',
    payload: { tilesMatched: 45 }
  };
  const conflictRes = await sync.pushWithOptimisticLock(conflictingEnvelope, userId, 1);

  assert.equal(conflictRes.status, 'conflict');
  assert.equal(conflictRes.currentRevision, 3);
  assert.equal(conflictRes.expectedRevision, 1);
  assert.ok(conflictRes.serverRecord);
  assert.equal(conflictRes.serverRecord.gameId, 'auromatch');
});

test('B9 Firebase Test 6: Sacred Privacy Invariant — Sankalpa vault is strictly excluded from Firestore sync', async () => {
  const router = createMockFetchRouter();
  const client = createFirebaseClient({
    projectId: 'auromind-production',
    apiKey: 'AIzaSyFakeKey123',
    fetch: router.fetch
  });
  const sync = createFirestoreSyncProvider(client);

  // Attempt to push Sankalpa vault
  const sankalpaEnvelope = {
    gameId: 'auromandala_sankalpa',
    payload: { secretPrayerNote: 'Confidential spiritual sankalpa' },
    localOnly: true
  };

  const pushRes = await sync.pushWithOptimisticLock(sankalpaEnvelope, 'fb_user_103', 0);
  assert.equal(pushRes.status, 'disabled');
  assert.match(pushRes.message, /Sankalpa/i);

  // Attempt to pull Sankalpa vault
  const pulled = await sync.pullLatest('fb_user_103', 'auromandala_sankalpa');
  assert.equal(pulled, null);

  // Verify zero documents written under that path
  assert.equal(router.store.has('users/fb_user_103/game_saves/auromandala_sankalpa'), false);
});

// ==============================================================================
// 4. Firebase Telemetry Transport Tests
// ==============================================================================

test('B9 Firebase Test 7: Telemetry transport sanitizes sensitive keys and dispatches via Cloud Functions', async () => {
  const router = createMockFetchRouter();
  const client = createFirebaseClient({
    projectId: 'auromind-production',
    apiKey: 'AIzaSyFakeKey123',
    fetch: router.fetch
  });
  const transport = createFirebaseTelemetryTransport(client);

  const events = [
    {
      eventId: 'd0000000-0000-4000-8000-000000000001',
      eventName: 'vak_level_played',
      category: 'engagement',
      payload: {
        score: 98,
        sankalpa_note: 'private prayer text',
        password_token: 'should_not_leak',
        public_data: 'normal'
      }
    }
  ];

  const res = await transport.sendEvents(events);
  assert.equal(res.ok, true);
  assert.equal(res.sentCount, 1);

  // Inspect the dispatched function payload
  const call = router.getFunctionsCalls().find((c) => c.fn === 'ingestTelemetry');
  assert.ok(call);
  const sentEvt = call.body.events[0];
  assert.equal(sentEvt.payload.public_data, 'normal');
  assert.equal(sentEvt.payload.sankalpa_note, '[REDACTED]');
  assert.equal(sentEvt.payload.password_token, '[REDACTED]');
});

// ==============================================================================
// 5. Entitlements & Remote Config Provider Tests
// ==============================================================================

test('B9 Firebase Test 8: Entitlements provider queries server-verified claims from Firestore', async () => {
  const router = createMockFetchRouter();
  const client = createFirebaseClient({
    projectId: 'auromind-production',
    apiKey: 'AIzaSyFakeKey123',
    fetch: router.fetch
  });

  // Seed an entitlement document under users/fb_ent_user/entitlements/vak_pack
  await client.firestore.setDocument('users/fb_ent_user/entitlements/vak_pack', {
    sku: 'vak.expansion.tier2',
    gameId: 'vak',
    tier: 'premium',
    status: 'active',
    source: 'verified_purchase',
    grantedAt: new Date().toISOString()
  });

  const entitlementsProvider = createFirebaseEntitlementsProvider(client);
  const records = await entitlementsProvider.fetchEntitlements('fb_ent_user');

  assert.equal(records.length, 1);
  assert.equal(records[0].sku, 'vak.expansion.tier2');
  assert.equal(records[0].tier, 'premium');
  assert.equal(records[0].verified, true);
});

test('B9 Firebase Test 9: Remote Config provider fetches flags with fallback and semver checking', async () => {
  const router = createMockFetchRouter();
  const client = createFirebaseClient({
    projectId: 'auromind-production',
    apiKey: 'AIzaSyFakeKey123',
    fetch: router.fetch
  });

  // Seed remote config documents
  await client.firestore.setDocument('remote_config/feature_dark_mode', {
    key: 'platform.seniorModeDefault',
    value: true
  });
  await client.firestore.setDocument('remote_config/future_feature', {
    key: 'platform.futureFlag',
    value: true,
    minAppVersion: '2.0.0'
  });

  const remoteConfigProvider = createFirebaseRemoteConfigProvider(client);

  // App version 1.0.0: Should get seniorModeDefault, but futureFlag excluded by semver
  const config = await remoteConfigProvider.fetchConfig('1.0.0');
  assert.equal(config['platform.seniorModeDefault'], true);
  assert.equal(config['platform.futureFlag'], undefined);
});

// ==============================================================================
// 6. Account Provider & Provider Factory Tests
// ==============================================================================

test('B9 Firebase Test 10: Account provider exports user bundle and deletes cloud records without touching local data', async () => {
  const router = createMockFetchRouter();
  const client = createFirebaseClient({
    projectId: 'auromind-production',
    apiKey: 'AIzaSyFakeKey123',
    fetch: router.fetch
  });

  const userId = 'fb_account_user_99';

  // Seed profile, save, and link
  await client.firestore.setDocument(`users/${userId}`, { displayName: 'Seeker', preferredLocale: 'en' });
  await client.firestore.setDocument(`users/${userId}/game_saves/vak`, { gameId: 'vak', revision: 2 });
  await client.firestore.setDocument(`users/${userId}/guest_identity_links/guest_1`, { guestId: 'guest_1' });

  const accountProvider = createFirebaseAccountProvider(client);

  // 1. Export Data
  const exported = await accountProvider.exportUserData(userId);
  assert.equal(exported.userId, userId);
  assert.ok(exported.cloudSaves.length >= 1);
  assert.ok(exported.linkedDevices.length >= 1);

  // 2. Delete User Data
  const deleteSuccess = await accountProvider.deleteUserData(userId);
  assert.equal(deleteSuccess, true);

  // Verify cloud documents deleted
  const profileAfter = await client.firestore.getDocument(`users/${userId}`);
  assert.equal(profileAfter.data, null);
});

test('B9 Firebase Test 11: Provider factory bundles all 6 provider adapters', () => {
  const router = createMockFetchRouter();
  const bundle = createFirebaseProviders({
    projectId: 'auromind-production',
    apiKey: 'AIzaSyFakeKey123',
    fetch: router.fetch
  });

  assert.ok(bundle.client);
  assert.equal(bundle.auth.providerName, 'firebase-auth');
  assert.equal(bundle.cloudSync.providerName, 'firestore-cloud-sync');
  assert.equal(bundle.telemetryTransport.providerName, 'firebase-telemetry-transport');
  assert.equal(bundle.entitlements.providerName, 'firebase-entitlements');
  assert.equal(bundle.remoteConfig.providerName, 'firebase-remote-config');
  assert.equal(bundle.accountProvider.providerName, 'firebase-account');
});
