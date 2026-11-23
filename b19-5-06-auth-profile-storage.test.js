/**
 * AuroMind Batch B19.5-06 — Authentication Lifecycle, Profile Isolation & Artwork Storage Tests
 *
 * Clearly distinguishes:
 *   - Executable SDK, Supabase Client, Profile Provider, Storage Provider, and Account Provider tests
 *     using deterministic HTTP/storage test doubles (mocked network, real production code).
 *   - Static DDL validation of Migration 10 (storage buckets & Storage RLS policies).
 *
 * NOTE: No live PostgreSQL or Supabase/PostgREST runtime is assumed in this file.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createAuroMindSDK,
  LS_PROFILE_KEY,
  LS_SYNC_META_KEY,
  LS_SYNC_CONSENT_KEY
} from './assets/sdk/auromind-sdk.js';
import { createSupabaseClient } from './assets/sdk/providers/supabase/supabase-client.js';
import { createSupabaseProviders } from './assets/sdk/providers/supabase/index.js';
import { createSupabaseProfileProvider } from './assets/sdk/providers/supabase/supabase-profile-provider.js';
import {
  createSupabaseStorageProvider,
  AVATARS_BUCKET,
  ARTWORK_BUCKET
} from './assets/sdk/providers/supabase/supabase-storage-provider.js';
import { createSupabaseAccountProvider } from './assets/sdk/providers/supabase/supabase-account-provider.js';
import { createLocalArtworkStore, StorageDeletionQueue } from './assets/sdk/artwork-concurrency.js';
import { validateMigrationDdl } from './scripts/migration-safety.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createMemoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get length() { return map.size; },
    key(i) { return Array.from(map.keys())[i] ?? null; },
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(String(k), String(v)); },
    removeItem(k) { map.delete(k); },
    clear() { map.clear(); },
    _dump() { return Object.fromEntries(map.entries()); }
  };
}

function createJwt(payloadObj) {
  const b64url = (obj) =>
    Buffer.from(JSON.stringify(obj), 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payloadObj)}.sig_placeholder`;
}

// Valid minimal PNG (67 bytes)
const VALID_PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
  0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,
  0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
  0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xdd, 0x8d,
  0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
  0x44, 0xae, 0x42, 0x60, 0x82
]);

const ANON_JWT = createJwt({ role: 'anon', iss: 'supabase' });

function makeFetchRouter(handler) {
  return async (url, options = {}) => {
    const res = await handler({
      url: String(url),
      method: (options.method || 'GET').toUpperCase(),
      headers: options.headers || {},
      body: options.body
    });
    if (!res) {
      return { ok: false, status: 404, json: async () => ({ message: 'Not Found' }) };
    }
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      headers: new Map(Object.entries(res.headers || { 'content-type': 'application/json' })),
      json: async () => res.body ?? {},
      arrayBuffer: async () => (res.bytes ? res.bytes.buffer.slice(res.bytes.byteOffset, res.bytes.byteOffset + res.bytes.byteLength) : new ArrayBuffer(0))
    };
  };
}

// =============================================================================
// 1. Auth Lifecycle: Refresh, Expiry, Offline Recovery & Concurrent SignOut Race
// =============================================================================

describe('B19.5-06 Part 1 — Authentication Lifecycle (Mocked HTTP)', () => {
  test('1. Expired access token with refresh_token is never sent as Bearer, and refreshes cleanly on validateSession / init / online recovery', async () => {
    const storage = createMemoryStorage();
    let nowMs = 1_760_000_000_000;
    const expInitialSec = Math.floor((nowMs + 30_000) / 1000);
    const expRefreshedSec = Math.floor((nowMs + 3_600_000) / 1000);
    const initialJwt = createJwt({ sub: '11111111-1111-4111-8111-111111111111', role: 'authenticated', exp: expInitialSec });
    const refreshedJwt = createJwt({ sub: '11111111-1111-4111-8111-111111111111', role: 'authenticated', exp: expRefreshedSec });

    let offline = false;
    let refreshCount = 0;

    const mockFetch = makeFetchRouter(({ url, body }) => {
      if (url.includes('/auth/v1/token?grant_type=password')) {
        return {
          status: 200,
          body: {
            access_token: initialJwt,
            refresh_token: 'rt_valid_1',
            expires_at: expInitialSec,
            user: { id: '11111111-1111-4111-8111-111111111111', email: 'seeker@auromind.test' }
          }
        };
      }
      if (url.includes('/auth/v1/token?grant_type=refresh_token')) {
        if (offline) throw new Error('Network offline');
        refreshCount += 1;
        const parsed = JSON.parse(body);
        assert.equal(parsed.refresh_token, 'rt_valid_1');
        return {
          status: 200,
          body: {
            access_token: refreshedJwt,
            refresh_token: 'rt_valid_2',
            expires_at: expRefreshedSec,
            user: { id: '11111111-1111-4111-8111-111111111111', email: 'seeker@auromind.test' }
          }
        };
      }
      return null;
    });

    const bundle1 = createSupabaseProviders({
      url: 'https://test.supabase.co',
      anonKey: ANON_JWT,
      fetch: mockFetch,
      storage,
      now: () => nowMs
    });
    const sdk1 = createAuroMindSDK({ env: { localStorage: storage, indexedDB: null, now: () => new Date(nowMs) } });
    await sdk1.init({
      gameId: 'portal',
      capabilities: { authEnabled: true },
      providers: { auth: bundle1.auth }
    });

    const signInRes = await sdk1.auth.signInWithEmail('seeker@auromind.test', 'pw');
    assert.equal(signInRes.ok, true);
    sdk1.dispose();

    // Expire the access token while offline -> getSession() returns null & headers NEVER use expired JWT
    nowMs += 60_000;
    offline = true;

    let onlineListener = null;
    const mockWin = {
      addEventListener(evt, fn) { if (evt === 'online') onlineListener = fn; },
      removeEventListener() {}
    };

    const bundle2 = createSupabaseProviders({
      url: 'https://test.supabase.co',
      anonKey: ANON_JWT,
      fetch: mockFetch,
      storage,
      now: () => nowMs
    });
    assert.equal(bundle2.client.auth.getSession(), null, 'Expired access token must not be returned');
    assert.equal(
      bundle2.client.getStandardHeaders().Authorization,
      `Bearer ${ANON_JWT}`,
      'Expired JWT must never be attached as Bearer header'
    );
    assert.equal(bundle2.client.auth.hasRefreshableSession(), true);

    const sdk2 = createAuroMindSDK({
      env: { localStorage: storage, indexedDB: null, window: mockWin, now: () => new Date(nowMs) }
    });
    await sdk2.init({
      gameId: 'portal',
      capabilities: { authEnabled: true },
      providers: { auth: bundle2.auth }
    });
    // Offline startup gracefully stays in guest mode without crashing or losing guestId
    assert.equal(sdk2.auth.getAccount(), null);
    assert.ok(sdk2.identity.getGuestId().startsWith('guest_'));

    // Reconnect -> online handler automatically recovers session via refresh_token!
    offline = false;
    assert.equal(typeof onlineListener, 'function');
    onlineListener();
    await new Promise((r) => setTimeout(r, 25));

    assert.equal(refreshCount, 1);
    assert.equal(sdk2.auth.getAccount()?.userId, '11111111-1111-4111-8111-111111111111');
    assert.equal(bundle2.client.getStandardHeaders().Authorization, `Bearer ${refreshedJwt}`);
    sdk2.dispose();
  });

  test('2. Revoked refresh token (HTTP 401) purges stored session immediately and fails closed to guest mode', async () => {
    const storage = createMemoryStorage();
    const nowMs = 1_760_000_000_000;
    const expiredSec = Math.floor((nowMs - 60_000) / 1000);
    storage.setItem(
      'auromind.platform.v1.supabase_session',
      JSON.stringify({
        access_token: createJwt({ sub: 'usr_revoked', exp: expiredSec }),
        refresh_token: 'rt_revoked',
        expires_at: expiredSec,
        user: { id: 'usr_revoked', email: 'revoked@auromind.test' }
      })
    );

    const mockFetch = makeFetchRouter(({ url }) => {
      if (url.includes('/auth/v1/token?grant_type=refresh_token')) {
        return { status: 401, body: { error_description: 'Refresh token revoked' } };
      }
      return null;
    });

    const bundle = createSupabaseProviders({
      url: 'https://test.supabase.co',
      anonKey: ANON_JWT,
      fetch: mockFetch,
      storage,
      now: () => nowMs
    });
    const sdk = createAuroMindSDK({ env: { localStorage: storage, indexedDB: null, now: () => new Date(nowMs) } });
    await sdk.init({
      gameId: 'portal',
      capabilities: { authEnabled: true },
      providers: { auth: bundle.auth }
    });

    assert.equal(sdk.auth.getAccount(), null);
    assert.equal(storage.getItem('auromind.platform.v1.supabase_session'), null, 'Revoked refresh session must be purged');
    sdk.dispose();
  });

  test('3. Concurrent signOut clears session immediately before /logout completes and blocks in-flight refresh from resurrecting session', async () => {
    const storage = createMemoryStorage();
    const nowMs = 1_760_000_000_000;
    const expSec = Math.floor((nowMs + 3600_000) / 1000);
    const tok1 = createJwt({ sub: 'usr_race', exp: expSec });
    const tok2 = createJwt({ sub: 'usr_race', exp: expSec + 3600 });

    let resolveRefresh;
    let resolveLogout;
    const mockFetch = makeFetchRouter(({ url }) => {
      if (url.includes('/auth/v1/token?grant_type=password')) {
        return {
          status: 200,
          body: { access_token: tok1, refresh_token: 'rt_1', expires_at: expSec, user: { id: 'usr_race', email: 'r@test.com' } }
        };
      }
      if (url.includes('/auth/v1/token?grant_type=refresh_token')) {
        return new Promise((resolve) => {
          resolveRefresh = () =>
            resolve({
              status: 200,
              body: { access_token: tok2, refresh_token: 'rt_2', expires_at: expSec + 3600, user: { id: 'usr_race', email: 'r@test.com' } }
            });
        });
      }
      if (url.includes('/auth/v1/logout')) {
        return new Promise((resolve) => {
          resolveLogout = () => resolve({ status: 204, body: {} });
        });
      }
      return null;
    });

    const client = createSupabaseClient({
      url: 'https://test.supabase.co',
      anonKey: ANON_JWT,
      fetch: mockFetch,
      storage,
      now: () => nowMs
    });

    await client.auth.signInWithPassword({ email: 'r@test.com', password: 'pw' });
    assert.equal(client.auth.getUser()?.id, 'usr_race');

    // Start slow refresh, then immediately trigger signOut while refresh & logout are still pending
    const refreshPromise = client.auth.refreshSession();
    const signOutPromise = client.auth.signOut();

    // Even BEFORE /logout resolves, session MUST already be cleared locally!
    assert.equal(client.auth.getSession(), null);
    assert.equal(storage.getItem('auromind.platform.v1.supabase_session'), null);

    resolveRefresh();
    const refreshRes = await refreshPromise;
    assert.equal(refreshRes.ok, false);
    assert.equal(refreshRes.error, 'SESSION_SUPERSEDED');
    assert.equal(client.auth.getSession(), null, 'Superseded refresh must never resurrect signed-out session');

    resolveLogout();
    await signOutPromise;
  });

  test('4. Guest linking idempotent upsert replay succeeds and rejects malformed guestId or cross-account mismatch', async () => {
    const storage = createMemoryStorage();
    const nowMs = 1_760_000_000_000;
    const expSec = Math.floor((nowMs + 3600_000) / 1000);
    let upsertCalls = 0;
    let lastUrl = '';

    const mockFetch = makeFetchRouter(({ url, method }) => {
      if (url.includes('/auth/v1/token?grant_type=password')) {
        return {
          status: 200,
          body: {
            access_token: createJwt({ sub: '11111111-1111-4111-8111-111111111111', exp: expSec }),
            expires_at: expSec,
            user: { id: '11111111-1111-4111-8111-111111111111', email: 'g@test.com' }
          }
        };
      }
      if (url.includes('/rest/v1/guest_identity_links') && method === 'POST') {
        upsertCalls += 1;
        lastUrl = url;
        return { status: 201, body: [] };
      }
      return null;
    });

    const bundle = createSupabaseProviders({
      url: 'https://test.supabase.co',
      anonKey: ANON_JWT,
      fetch: mockFetch,
      storage,
      now: () => nowMs
    });
    await bundle.auth.signIn('email_password', { email: 'g@test.com', password: 'pw' });

    const validGuestId = 'guest_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const r1 = await bundle.auth.linkGuestIdentity(validGuestId, { userId: '11111111-1111-4111-8111-111111111111' });
    const r2 = await bundle.auth.linkGuestIdentity(validGuestId, { userId: '11111111-1111-4111-8111-111111111111' });
    assert.equal(r1.linked, true);
    assert.equal(r2.linked, true);
    assert.equal(upsertCalls, 2);
    assert.ok(lastUrl.includes('on_conflict=user_id%2Cguest_id'));

    // Reject cross-account mismatch and invalid guestId without making HTTP calls
    const badAcct = await bundle.auth.linkGuestIdentity(validGuestId, { userId: '22222222-2222-4222-8222-222222222222' });
    assert.equal(badAcct.linked, false);
    assert.equal(badAcct.error, 'ACCOUNT_MISMATCH');

    const badGuest = await bundle.auth.linkGuestIdentity('guest_bad', { userId: '11111111-1111-4111-8111-111111111111' });
    assert.equal(badGuest.linked, false);
    assert.equal(badGuest.error, 'INVALID_GUEST_ID');
    assert.equal(upsertCalls, 2);
  });
});

// =============================================================================
// 2. Direct Account Switching, Collision-Free Isolation & Profile Column Grants
// =============================================================================

describe('B19.5-06 Part 2 — Profile Privacy, Column Grants & Account Isolation', () => {
  test('5. Direct Account A (user/a) -> Account B (user_a) switch isolates cached profile, sync metadata, sync consent, and artwork store without collisions', async () => {
    const storage = createMemoryStorage();
    let currentMockUser = null;
    const mockAuth = {
      providerName: 'mock-switch',
      isConfigured: () => true,
      getCurrentSession: async () => currentMockUser,
      signIn: async (_m, { userId, email }) => {
        currentMockUser = { userId, email };
        return { ok: true, account: currentMockUser };
      },
      signOut: async () => { currentMockUser = null; },
      onAuthStateChange: () => () => {}
    };

    const sdk = createAuroMindSDK({ env: { localStorage: storage, indexedDB: null } });
    await sdk.init({
      gameId: 'portal',
      capabilities: { authEnabled: true, cloudSyncEnabled: true },
      providers: { auth: mockAuth }
    });

    // Sign in as adversarial ID 'user/a', set profile + sync consent
    await sdk.auth.signIn('email_password', { userId: 'user/a', email: 'slash@test.com' });
    sdk.player.setDisplayName('Slash Account');
    sdk.sync.setConsent(true);
    assert.equal(sdk.player.getDisplayName(), 'Slash Account');
    assert.equal(sdk.sync.hasConsent(), true);

    // Direct switch (WITHOUT signing out first) to colliding ID 'user_a'
    await sdk.auth.signIn('email_password', { userId: 'user_a', email: 'underscore@test.com' });
    assert.equal(sdk.auth.getAccount().userId, 'user_a');
    assert.notEqual(sdk.player.getDisplayName(), 'Slash Account', 'user_a must NEVER read user/a profile');
    assert.equal(sdk.sync.hasConsent(), false, 'user_a must NEVER inherit user/a sync consent');

    // Artwork stores for 'user/a' vs 'user_a' must also use distinct keys
    const artSlash = createLocalArtworkStore({ storage, accountScope: 'user/a' });
    const artUnderscore = createLocalArtworkStore({ storage, accountScope: 'user_a' });
    assert.notEqual(artSlash.storageKey, artUnderscore.storageKey);
    artSlash.create({ title: 'Slash Mandala', strokes: [{ x: 1, y: 1 }] });
    assert.equal(artUnderscore.list().length, 0);

    sdk.dispose();
  });

  test('6. SupabaseProfileProvider enforces Migration 9 column-level INSERT/UPDATE grants, private settings isolation, and public projection view', async () => {
    const storage = createMemoryStorage();
    const nowMs = 1_760_000_000_000;
    const expSec = Math.floor((nowMs + 3600_000) / 1000);
    const uidA = '11111111-1111-4111-8111-111111111111';
    const recordedRequests = [];

    const mockFetch = makeFetchRouter(({ url, method, body }) => {
      recordedRequests.push({ url, method, body: body ? JSON.parse(body) : null });
      if (url.includes('/auth/v1/token?grant_type=password')) {
        return {
          status: 200,
          body: { access_token: createJwt({ sub: uidA, exp: expSec }), expires_at: expSec, user: { id: uidA, email: 'a@test.com' } }
        };
      }
      if (url.includes('/rest/v1/user_profiles') && method === 'POST') {
        return { status: 201, body: JSON.parse(body) };
      }
      if (url.includes('/rest/v1/user_profiles') && method === 'PATCH') {
        return { status: 200, body: JSON.parse(body) };
      }
      if (url.includes('/rest/v1/user_private_settings') && method === 'POST') {
        return { status: 201, body: JSON.parse(body) };
      }
      if (url.includes('/rest/v1/public_user_profiles') && method === 'GET') {
        return {
          status: 200,
          body: [{
            user_id: uidA,
            display_name: 'Public Alpha',
            preferred_locale: 'en',
            created_at: '2026-11-23T00:00:00Z',
            preferences: { injected_leak: true } // Provider must strip unexpected private fields!
          }]
        };
      }
      return null;
    });

    const client = createSupabaseClient({ url: 'https://test.supabase.co', anonKey: ANON_JWT, fetch: mockFetch, storage, now: () => nowMs });
    await client.auth.signInWithPassword({ email: 'a@test.com', password: 'pw' });
    const profileProvider = createSupabaseProfileProvider(client);

    // 1. Create profile: ONLY permitted INSERT columns (user_id, display_name, preferred_locale, is_public)
    const createRes = await profileProvider.createOwnProfile({ displayName: 'Alpha', preferredLocale: 'en', isPublic: true });
    assert.equal(createRes.ok, true);
    const insertReq = recordedRequests.find((r) => r.url.includes('/rest/v1/user_profiles') && r.method === 'POST');
    assert.deepEqual(Object.keys(insertReq.body).sort(), ['display_name', 'is_public', 'preferred_locale', 'user_id']);

    // 2. Update profile: ONLY permitted UPDATE columns (NEVER user_id, created_at, updated_at, preferences)
    const updateRes = await profileProvider.updateOwnProfile({
      displayName: 'Alpha Renamed',
      user_id: '22222222-2222-4222-8222-222222222222',
      preferences: { secret: 1 }
    });
    assert.equal(updateRes.ok, true);
    const patchReq = recordedRequests.find((r) => r.url.includes('/rest/v1/user_profiles') && r.method === 'PATCH');
    assert.deepEqual(Object.keys(patchReq.body), ['display_name']);
    assert.equal(patchReq.body.user_id, undefined);
    assert.equal(patchReq.body.preferences, undefined);

    // 3. Private settings reject Sankalpa markers before network call
    const sankalpaRes = await profileProvider.updatePrivateSettings({ preferences: { sankalpa_notes: 'private' } });
    assert.equal(sankalpaRes.ok, false);
    assert.equal(sankalpaRes.errorCode, 'PRIVACY_BOUNDARY_VIOLATION');

    const privRes = await profileProvider.updatePrivateSettings({ preferences: { theme: 'dark' }, analyticsOptIn: false, cloudSyncOptIn: true });
    assert.equal(privRes.ok, true);

    // 4. Public projection queries public_user_profiles view and strips any private field
    const pubRes = await profileProvider.getPublicProfile(uidA);
    assert.equal(pubRes.ok, true);
    assert.equal(pubRes.profile.display_name, 'Public Alpha');
    assert.equal(pubRes.profile.preferences, undefined);
  });
});

// =============================================================================
// 3. Avatar & Artwork Storage Ownership, Opt-In Backup & Orphan Cleanup
// =============================================================================

describe('B19.5-06 Part 3 — Avatar & Artwork Storage Ownership & Orphan Cleanup', () => {
  test('7. Avatar upload/read/replace/delete enforces owner prefix, rejects SVG & cross-user paths, and queues orphan cleanup on transient delete failure', async () => {
    const storage = createMemoryStorage();
    const nowMs = 1_760_000_000_000;
    const expSec = Math.floor((nowMs + 3600_000) / 1000);
    const uidA = '11111111-1111-4111-8111-111111111111';
    const uidB = '22222222-2222-4222-8222-222222222222';

    const storedObjects = new Map();
    let failNextDelete = false;
    let httpCalls = 0;

    const mockFetch = makeFetchRouter(({ url, method, body }) => {
      httpCalls += 1;
      if (url.includes('/auth/v1/token?grant_type=password')) {
        return {
          status: 200,
          body: { access_token: createJwt({ sub: uidA, exp: expSec }), expires_at: expSec, user: { id: uidA, email: 'a@test.com' } }
        };
      }
      if (url.includes(`/storage/v1/object/${AVATARS_BUCKET}/`) && method === 'POST') {
        const objPath = decodeURIComponent(url.split(`/storage/v1/object/${AVATARS_BUCKET}/`)[1]);
        storedObjects.set(objPath, body);
        return { status: 200, body: { Key: `${AVATARS_BUCKET}/${objPath}` } };
      }
      if (url.includes(`/storage/v1/object/authenticated/${AVATARS_BUCKET}/`) && method === 'GET') {
        const objPath = decodeURIComponent(url.split(`/storage/v1/object/authenticated/${AVATARS_BUCKET}/`)[1]);
        const bytes = storedObjects.get(objPath);
        return bytes ? { status: 200, bytes } : { status: 404, body: { message: 'Not found' } };
      }
      if (url.endsWith(`/storage/v1/object/${AVATARS_BUCKET}`) && method === 'DELETE') {
        if (failNextDelete) {
          failNextDelete = false;
          return { status: 503, body: { message: 'Storage transiently unavailable' } };
        }
        const parsed = JSON.parse(body);
        for (const p of parsed.prefixes) storedObjects.delete(p);
        return { status: 200, body: parsed.prefixes.map((name) => ({ name })) };
      }
      return null;
    });

    const client = createSupabaseClient({ url: 'https://test.supabase.co', anonKey: ANON_JWT, fetch: mockFetch, storage, now: () => nowMs });
    await client.auth.signInWithPassword({ email: 'a@test.com', password: 'pw' });
    const storageProvider = createSupabaseStorageProvider(client);

    // 1. Upload valid PNG avatar
    const up1 = await storageProvider.uploadAvatar({ bytes: VALID_PNG_BYTES, mimeType: 'image/png' });
    assert.equal(up1.ok, true);
    assert.ok(up1.objectPath.startsWith(`${uidA}/avatar_`));

    // 2. Read own avatar
    const rd1 = await storageProvider.readAvatar(up1.objectPath);
    assert.equal(rd1.ok, true);
    assert.equal(rd1.bytes.byteLength, VALID_PNG_BYTES.byteLength);

    // 3. Reject cross-user read/delete, path traversal, and SVG BEFORE any HTTP call
    const callsBeforeBlocked = httpCalls;
    const crossRead = await storageProvider.readAvatar(`${uidB}/avatar_secret.png`);
    assert.equal(crossRead.ok, false);
    assert.equal(crossRead.errorCode, 'CROSS_USER_STORAGE_FORBIDDEN');

    const traversalDel = await storageProvider.deleteAvatar(`${uidA}/../${uidB}/avatar_secret.png`);
    assert.equal(traversalDel.ok, false);
    assert.equal(traversalDel.errorCode, 'INVALID_OBJECT_PATH');

    const svgUp = await storageProvider.uploadAvatar({
      bytes: new TextEncoder().encode('<svg onload="alert(1)"/>'),
      mimeType: 'image/svg+xml'
    });
    assert.equal(svgUp.ok, false);
    assert.equal(svgUp.errorCode, 'AVATAR_INVALID_MIME_TYPE');
    assert.equal(httpCalls, callsBeforeBlocked, 'Blocked storage calls must never hit the network');

    // 4. Replace avatar when previous-avatar deletion fails transiently -> enqueues orphan cleanup job
    const deletionQueue = new StorageDeletionQueue({
      async remove(bucket, objectPath) {
        const res = await client.storage.from(bucket).remove([objectPath]);
        return { status: res.error ? 503 : 200 };
      }
    });
    failNextDelete = true;
    const up2 = await storageProvider.uploadAvatar({
      bytes: VALID_PNG_BYTES,
      mimeType: 'image/png',
      previousObjectPath: up1.objectPath,
      deletionQueue
    });
    assert.equal(up2.ok, true);
    assert.equal(up2.previousCleanup, 'queued_for_retry');
    assert.equal(storedObjects.has(up1.objectPath), true, 'Previous avatar still orphaned until queue retries');

    // Retry orphan queue -> deletes orphaned avatar cleanly!
    const processed = await deletionQueue.processQueue(Date.now() + 1000);
    assert.equal(processed[0].status, 'completed');
    assert.equal(storedObjects.has(up1.objectPath), false, 'Orphaned previous avatar removed by retry queue');

    // 5. StorageDeletionQueue enforces ownerUserId prefix and rejects traversal
    assert.throws(
      () => deletionQueue.enqueue({ objectPath: `${uidB}/mandala.png`, artworkId: 'art1', ownerUserId: uidA }),
      /CROSS_USER_STORAGE_FORBIDDEN/
    );
    assert.throws(
      () => deletionQueue.enqueue({ objectPath: `${uidA}/../${uidB}/mandala.png`, artworkId: 'art1', ownerUserId: uidA }),
      /INVALID_OBJECT_PATH/
    );
  });

  test('8. Artwork stays local-first by default and refuses cloud upload unless explicitCloudBackupOptIn === true', async () => {
    const storage = createMemoryStorage();
    const nowMs = 1_760_000_000_000;
    const expSec = Math.floor((nowMs + 3600_000) / 1000);
    const uidA = '11111111-1111-4111-8111-111111111111';
    let uploadCalls = 0;

    const mockFetch = makeFetchRouter(({ url, method }) => {
      if (url.includes('/auth/v1/token?grant_type=password')) {
        return {
          status: 200,
          body: { access_token: createJwt({ sub: uidA, exp: expSec }), expires_at: expSec, user: { id: uidA, email: 'a@test.com' } }
        };
      }
      if (url.includes(`/storage/v1/object/${ARTWORK_BUCKET}/`) && method === 'POST') {
        uploadCalls += 1;
        return { status: 200, body: { Key: 'ok' } };
      }
      return null;
    });

    const client = createSupabaseClient({ url: 'https://test.supabase.co', anonKey: ANON_JWT, fetch: mockFetch, storage, now: () => nowMs });
    await client.auth.signInWithPassword({ email: 'a@test.com', password: 'pw' });
    const storageProvider = createSupabaseStorageProvider(client);

    // Default call without explicitCloudBackupOptIn MUST fail closed with ZERO network uploads
    const blocked = await storageProvider.backupArtwork({
      artworkId: 'mandala_01',
      snapshotId: 'snap_1',
      bytes: VALID_PNG_BYTES,
      mimeType: 'image/png'
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.errorCode, 'CLOUD_ARTWORK_BACKUP_OPT_IN_REQUIRED');
    assert.equal(uploadCalls, 0);

    // Explicit opt-in still blocks Sankalpa JSON content
    const blockedSankalpa = await storageProvider.backupArtwork({
      artworkId: 'mandala_01',
      snapshotId: 'snap_1',
      bytes: JSON.stringify({ sankalpa_e2ee_vault: 'secret' }),
      mimeType: 'application/json',
      explicitCloudBackupOptIn: true
    });
    assert.equal(blockedSankalpa.ok, false);
    assert.equal(blockedSankalpa.errorCode, 'PRIVACY_BOUNDARY_VIOLATION');
    assert.equal(uploadCalls, 0);

    // Explicit opt-in with valid artwork PNG uploads strictly to user-artwork/${uidA}/...
    const allowed = await storageProvider.backupArtwork({
      artworkId: 'mandala_01',
      snapshotId: 'snap_1',
      bytes: VALID_PNG_BYTES,
      mimeType: 'image/png',
      explicitCloudBackupOptIn: true
    });
    assert.equal(allowed.ok, true);
    assert.equal(allowed.objectPath, `${uidA}/mandala_01/snap_1.png`);
    assert.equal(uploadCalls, 1);
  });
});

// =============================================================================
// 4. Account Deletion Failure Consistency & Migration 10 Static Verification
// =============================================================================

describe('B19.5-06 Part 4 — Account Deletion Consistency & Storage RLS Migration', () => {
  test('9. Account deletion fails closed on 404, 401/403/500, network failure, and malformed/contradictory responses with zero fallback table deletes or sign-out; cleans dependent records only on confirmed success', async () => {
    const storage = createMemoryStorage();
    const nowMs = 1_760_000_000_000;
    const expSec = Math.floor((nowMs + 3600_000) / 1000);
    const uidA = '11111111-1111-4111-8111-111111111111';

    let edgeBehavior = { type: 'status', status: 404, body: { message: 'Function not found' } };
    let restDeleteCalls = 0;
    let logoutCalls = 0;

    const mockFetch = async (url, options = {}) => {
      const urlStr = String(url);
      const method = (options.method || 'GET').toUpperCase();

      if (urlStr.includes('/auth/v1/token?grant_type=password')) {
        return {
          ok: true,
          status: 200,
          headers: new Map([['content-type', 'application/json']]),
          json: async () => ({
            access_token: createJwt({ sub: uidA, exp: expSec }),
            expires_at: expSec,
            user: { id: uidA, email: 'del@test.com' }
          })
        };
      }
      if (urlStr.includes('/rest/v1/') && method === 'DELETE') {
        restDeleteCalls += 1;
        return {
          ok: true,
          status: 204,
          headers: new Map(),
          json: async () => ({})
        };
      }
      if (urlStr.includes('/auth/v1/logout')) {
        logoutCalls += 1;
        return {
          ok: true,
          status: 204,
          headers: new Map(),
          json: async () => ({})
        };
      }
      if (urlStr.includes('/functions/v1/delete-account') && method === 'POST') {
        if (edgeBehavior.type === 'network_error') {
          throw new Error('Network disconnected');
        }
        if (edgeBehavior.type === 'invalid_json') {
          return {
            ok: true,
            status: 200,
            headers: new Map([['content-type', 'application/json']]),
            json: async () => { throw new SyntaxError('Unexpected token < in JSON'); }
          };
        }
        const st = edgeBehavior.status;
        return {
          ok: st >= 200 && st < 300,
          status: st,
          headers: new Map([['content-type', 'application/json']]),
          json: async () => edgeBehavior.body
        };
      }
      return { ok: false, status: 404, headers: new Map(), json: async () => ({ message: 'Not Found' }) };
    };

    const bundle = createSupabaseProviders({ url: 'https://test.supabase.co', anonKey: ANON_JWT, fetch: mockFetch, storage, now: () => nowMs });
    const sdk = createAuroMindSDK({ env: { localStorage: storage, indexedDB: null, now: () => new Date(nowMs) } });
    await sdk.init({
      gameId: 'portal',
      capabilities: { authEnabled: true, cloudSyncEnabled: true },
      providers: { auth: bundle.auth, accountProvider: bundle.accountProvider }
    });

    const guestId = sdk.identity.getGuestId();
    storage.setItem('vak_local_save', 'level_99');

    await sdk.auth.signInWithEmail('del@test.com', 'pw');
    sdk.player.setDisplayName('Soon Deleted');
    sdk.sync.setConsent(true);
    storage.setItem(`${LS_SYNC_META_KEY}.user.${uidA}`, JSON.stringify({ vak: { revision: 3 } }));

    // Cross-account export/delete rejected when active user differs
    assert.equal(await bundle.accountProvider.exportUserData('22222222-2222-4222-8222-222222222222'), null);
    assert.equal(await bundle.accountProvider.deleteUserData('22222222-2222-4222-8222-222222222222'), false);

    function assertAccountAndDependentStateIntact(contextLabel) {
      assert.equal(restDeleteCalls, 0, `${contextLabel}: must NEVER fall back to deleting dependent REST tables`);
      assert.equal(logoutCalls, 0, `${contextLabel}: must NEVER sign out on failed deletion`);
      assert.equal(sdk.auth.getAccount()?.userId, uidA, `${contextLabel}: active session must remain intact`);
      assert.equal(sdk.player.getDisplayName(), 'Soon Deleted', `${contextLabel}: local profile must remain intact`);
      assert.ok(storage.getItem(`${LS_PROFILE_KEY}.user.${uidA}`), `${contextLabel}: stored profile must remain intact`);
      assert.ok(storage.getItem(`${LS_SYNC_META_KEY}.user.${uidA}`), `${contextLabel}: sync metadata must remain intact`);
      assert.equal(storage.getItem(`${LS_SYNC_CONSENT_KEY}.user.${uidA}`), 'true', `${contextLabel}: sync consent must remain intact`);
    }

    // 1. HTTP 404 (missing Edge Function) -> MUST fail closed with zero fallback table deletes or sign-out
    edgeBehavior = { type: 'status', status: 404, body: { message: 'Function not found' } };
    assert.equal(await sdk.auth.deleteAccount(), false);
    assertAccountAndDependentStateIntact('HTTP 404');

    // 2. HTTP 401, 403, 500 -> MUST fail closed
    for (const status of [401, 403, 500]) {
      edgeBehavior = { type: 'status', status, body: { ok: false, error: `ERR_${status}` } };
      assert.equal(await sdk.auth.deleteAccount(), false);
      assertAccountAndDependentStateIntact(`HTTP ${status}`);
    }

    // 3. Network failure -> MUST fail closed (both auth.deleteAccount and player.deleteUserData)
    edgeBehavior = { type: 'network_error' };
    assert.equal(await sdk.auth.deleteAccount(), false);
    assert.equal(await sdk.player.deleteUserData(), false);
    assertAccountAndDependentStateIntact('Network failure');

    // 4. Malformed JSON and contradictory 200 OK payloads -> MUST fail closed
    edgeBehavior = { type: 'invalid_json' };
    assert.equal(await sdk.auth.deleteAccount(), false);
    assertAccountAndDependentStateIntact('Invalid JSON');

    const contradictoryPayloads = [
      null,
      [],
      {},
      { ok: false, deleted: true },
      { ok: true }, // missing both deletedUserId and deleted: true
      { ok: true, deleted: false },
      { ok: true, deletedUserId: '22222222-2222-4222-8222-222222222222' }, // wrong user ID
      { ok: true, deletedUserId: uidA, error: 'PARTIAL_FAILURE' }, // contradictory error field
      { ok: true, deletedUserId: uidA, deleted: false }
    ];
    for (const badBody of contradictoryPayloads) {
      edgeBehavior = { type: 'status', status: 200, body: badBody };
      assert.equal(await sdk.auth.deleteAccount(), false, `Expected false for payload ${JSON.stringify(badBody)}`);
      assertAccountAndDependentStateIntact(`Contradictory payload ${JSON.stringify(badBody)}`);
    }

    // 5. Confirmed 200 OK deletion for authenticated user -> cleans profile, sync meta, sync consent & signs out, preserving guestId + saves
    edgeBehavior = { type: 'status', status: 200, body: { ok: true, deletedUserId: uidA } };
    const okDel = await sdk.auth.deleteAccount();
    assert.equal(okDel, true);
    assert.equal(restDeleteCalls, 0, 'Authoritative Edge Function handles DB cascade without client table deletes');
    assert.equal(sdk.auth.getAccount(), null);
    assert.equal(storage.getItem(`${LS_PROFILE_KEY}.user.${uidA}`), null);
    assert.equal(storage.getItem(`${LS_SYNC_META_KEY}.user.${uidA}`), null);
    assert.equal(storage.getItem(`${LS_SYNC_CONSENT_KEY}.user.${uidA}`), null);
    assert.equal(sdk.identity.getGuestId(), guestId, 'Guest ID must be preserved after account deletion');
    assert.equal(storage.getItem('vak_local_save'), 'level_99', 'Local game saves must be preserved');

    sdk.dispose();
  });

  test('10. Static DDL: Migration 10 configures private avatars & user-artwork buckets with owner-folder RLS and portal provider wiring excludes raw client handle', () => {
    const m10Path = path.join(__dirname, 'supabase', 'migrations', '20261123000002_b19_5_06_storage_buckets_and_rls.sql');
    assert.ok(fs.existsSync(m10Path), 'Migration 10 must exist');
    const sql = fs.readFileSync(m10Path, 'utf8');
    assert.equal(validateMigrationDdl(sql).valid, true);
    assert.ok(sql.includes("'avatars'"));
    assert.ok(sql.includes("'user-artwork'"));
    assert.ok(sql.includes("array['image/png', 'image/jpeg', 'image/webp']"));
    assert.equal(sql.includes('image/svg+xml'), false, 'SVG must NEVER be allowed in Storage buckets');
    assert.ok(sql.includes('(storage.foldername(name))[1] = auth.uid()::text'));
    assert.ok(sql.includes("name !~ '(^|/)\\.\\.(/|$)'"));

    // Verify portal.js filters SDK provider slots so raw `client` from createSupabaseProviders never throws UNKNOWN_PROVIDER
    const portalSrc = fs.readFileSync(path.join(__dirname, 'assets', 'js', 'portal.js'), 'utf8');
    assert.ok(portalSrc.includes('pickSdkProviders'));
  });
});
