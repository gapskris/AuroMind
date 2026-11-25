/**
 * B19.5-02 — Identity, Authentication, and Player Profile Remediation Test Suite
 *
 * Clearly distinguishes:
 * - Part 1: Direct production-code unit/integration tests (with HTTP/storage test doubles)
 * - Part 2: Real-browser Chromium/Edge E2E tests via ./e2e/browser-harness.js
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  createAuroMindSDK,
  LS_GUEST_KEY,
  LS_PROFILE_KEY,
  LS_SYNC_META_KEY,
  LS_OUTBOX_KEY,
  AVATAR_MAX_BYTES,
  sanitizeDisplayName,
  validateAvatarInput
} from './assets/sdk/auromind-sdk.js';
import { createSupabaseClient } from './assets/sdk/providers/supabase/supabase-client.js';
import { createSupabaseAuthProvider } from './assets/sdk/providers/supabase/supabase-auth-provider.js';
import { createFirebaseAuthProvider } from './assets/sdk/providers/firebase/firebase-auth-provider.js';
import { resolveBackendConfig } from './assets/sdk/config/backend-config.js';
import { createTestEnvironment } from './e2e/browser-harness.js';

function createMemoryStorage() {
  const map = new Map();
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

function createFakeBroadcastBus() {
  const channels = new Set();
  return class FakeBroadcastChannel {
    constructor(name) {
      this.name = name;
      this.onmessage = null;
      this.closed = false;
      channels.add(this);
    }
    postMessage(data) {
      if (this.closed) return;
      for (const ch of channels) {
        if (ch !== this && !ch.closed && ch.name === this.name && typeof ch.onmessage === 'function') {
          ch.onmessage({ data });
        }
      }
    }
    close() {
      this.closed = true;
      channels.delete(this);
    }
  };
}

function createJwt(payloadObj) {
  const b64url = (obj) =>
    Buffer.from(JSON.stringify(obj), 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payloadObj)}.sig_test_placeholder`;
}

// Minimal valid 1x1 PNG (67 bytes)
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
const VALID_PNG_DATA_URL = `data:image/png;base64,${Buffer.from(VALID_PNG_BYTES).toString('base64')}`;

// Minimal valid JPEG header bytes
const VALID_JPEG_BYTES = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9
]);

// Minimal valid WebP header bytes (RIFF....WEBP)
const VALID_WEBP_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20
]);

function makeMockFetch(router) {
  return async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    const res = await router({ url: String(url), method: options.method || 'GET', body, headers: options.headers || {} });
    if (!res) {
      return { ok: false, status: 404, json: async () => ({ message: 'Not Found' }) };
    }
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      json: async () => res.body ?? {}
    };
  };
}

// ===========================================================================
// PART 1: PRODUCTION CODE UNIT & INTEGRATION TESTS (TEST DOUBLES)
// ===========================================================================

describe('B19.5-02 Part 1 — Identity, Auth, Profile & Security (Unit/Integration)', () => {
  test('1. Base64url-encoded JWT service_role key is strictly rejected in supabase-client and backend-config', () => {
    const serviceRoleJwt = createJwt({ role: 'service_role', iss: 'supabase', exp: Math.floor(Date.now() / 1000) + 3600 });
    assert.ok(!serviceRoleJwt.includes('service_role'), 'Test precondition: payload must be base64url encoded');

    assert.throws(
      () => createSupabaseClient({ url: 'https://test.supabase.co', anonKey: serviceRoleJwt }),
      (err) => err && err.code === 'SERVICE_ROLE_KEY_FORBIDDEN'
    );

    assert.throws(
      () => resolveBackendConfig({ provider: 'supabase', supabaseUrl: 'https://test.supabase.co', supabaseAnonKey: serviceRoleJwt }),
      (err) => err && err.code === 'SERVICE_ROLE_KEY_FORBIDDEN'
    );

    const anonJwt = createJwt({ role: 'anon', iss: 'supabase' });
    const okClient = createSupabaseClient({ url: 'https://test.supabase.co', anonKey: anonJwt, storage: createMemoryStorage() });
    assert.equal(okClient.isConfigured(), true);
  });

  test('2. Session persistence, restoration, and automatic expiry cleanup (expires_at and JWT exp)', async () => {
    const storage = createMemoryStorage();
    let nowMs = 1_760_000_000_000;
    const futureExpSec = Math.floor((nowMs + 60_000) / 1000);
    const validToken = createJwt({ sub: 'usr_exp_1', role: 'authenticated', exp: futureExpSec });

    const mockFetch = makeMockFetch(({ url }) => {
      if (url.includes('/auth/v1/token?grant_type=password')) {
        return {
          status: 200,
          body: {
            access_token: validToken,
            expires_at: futureExpSec,
            user: { id: 'usr_exp_1', email: 'exp@auromasti.test' }
          }
        };
      }
      return null;
    });

    const client1 = createSupabaseClient({
      url: 'https://test.supabase.co',
      anonKey: createJwt({ role: 'anon' }),
      fetch: mockFetch,
      storage,
      now: () => nowMs
    });
    const sdk1 = createAuroMindSDK({ env: { localStorage: storage, indexedDB: null, now: () => new Date(nowMs) } });
    await sdk1.init({
      gameId: 'portal',
      capabilities: { authEnabled: true },
      providers: { auth: createSupabaseAuthProvider(client1) }
    });

    const loginRes = await sdk1.auth.signInWithEmail('exp@auromasti.test', 'secret123');
    assert.equal(loginRes.ok, true);
    assert.equal(sdk1.auth.getAccount().userId, 'usr_exp_1');
    sdk1.dispose();

    // Simulate reload BEFORE expiry -> session restores
    const client2 = createSupabaseClient({
      url: 'https://test.supabase.co',
      anonKey: createJwt({ role: 'anon' }),
      fetch: mockFetch,
      storage,
      now: () => nowMs + 10_000
    });
    const sdk2 = createAuroMindSDK({ env: { localStorage: storage, indexedDB: null, now: () => new Date(nowMs + 10_000) } });
    await sdk2.init({
      gameId: 'portal',
      capabilities: { authEnabled: true },
      providers: { auth: createSupabaseAuthProvider(client2) }
    });
    assert.equal(sdk2.auth.getAccount()?.userId, 'usr_exp_1');
    assert.equal(sdk2.identity.get().mode, 'authenticated');

    // Advance clock PAST expiry -> getAccount & validateSession auto-clear expired session
    nowMs += 120_000;
    assert.equal(sdk2.auth.getAccount(), null);
    assert.equal(sdk2.identity.get().mode, 'guest');
    const valRes = await sdk2.auth.validateSession();
    assert.equal(valRes.valid, false);
    assert.equal(storage.getItem('auromind.platform.v1.supabase_session'), null);
    sdk2.dispose();
  });

  test('3. Token isolation: raw accessToken/refreshToken are NEVER exposed on account, identity, diagnostics, backup, or export', async () => {
    const storage = createMemoryStorage();
    const secretJwt = createJwt({ sub: 'usr_tok_1', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 });

    const mockFetch = makeMockFetch(({ url }) => {
      if (url.includes('/auth/v1/token?grant_type=password')) {
        return {
          status: 200,
          body: {
            access_token: secretJwt,
            refresh_token: 'super_secret_refresh_token_xyz',
            user: { id: 'usr_tok_1', email: 'tok@auromasti.test', user_metadata: { accessToken: 'leak_attempt', tier: 'seeker' } }
          }
        };
      }
      return null;
    });

    const client = createSupabaseClient({
      url: 'https://test.supabase.co',
      anonKey: createJwt({ role: 'anon' }),
      fetch: mockFetch,
      storage
    });
    const sdk = createAuroMindSDK({ env: { localStorage: storage, indexedDB: null } });
    await sdk.init({
      gameId: 'portal',
      capabilities: { authEnabled: true },
      providers: { auth: createSupabaseAuthProvider(client) }
    });

    const res = await sdk.auth.signInWithEmail('tok@auromasti.test', 'pw123');
    assert.equal(res.ok, true);
    assert.equal(res.account.accessToken, undefined);
    assert.equal(sdk.auth.getAccount().accessToken, undefined);
    assert.equal(sdk.auth.getAccount().metadata.accessToken, undefined);
    assert.equal(sdk.identity.get().account.accessToken, undefined);

    const diagStr = JSON.stringify(sdk.diagnostics.exportDiagnostics());
    const backupStr = JSON.stringify(await sdk.storage.exportBackup());
    const exportStr = JSON.stringify(await sdk.player.exportUserData());
    for (const serialized of [diagStr, backupStr, exportStr]) {
      assert.ok(!serialized.includes(secretJwt), 'Raw JWT must never leak into exported artifacts');
      assert.ok(!serialized.includes('super_secret_refresh_token_xyz'), 'Refresh token must never leak');
    }

    // Verify Firebase provider also strips accessToken
    const fbAuth = createFirebaseAuthProvider({
      isConfigured: () => true,
      auth: {
        getSession: () => ({ userId: 'fb_1', email: 'fb@test.com', idToken: 'fb_secret_tok' }),
        onAuthStateChange: () => () => {}
      }
    });
    const fbSession = await fbAuth.getCurrentSession();
    assert.equal(fbSession.userId, 'fb_1');
    assert.equal(fbSession.accessToken, undefined);

    sdk.dispose();
  });

  test('4. Email OTP flow: validation, send, verifyOtp success/failure, and cancelPendingAuth', async () => {
    const storage = createMemoryStorage();
    const mockFetch = makeMockFetch(({ url, body }) => {
      if (url.includes('/auth/v1/otp')) {
        return { status: 200, body: {} };
      }
      if (url.includes('/auth/v1/verify')) {
        if (body.token === '654321') {
          return {
            status: 200,
            body: {
              access_token: createJwt({ sub: 'usr_otp_1', exp: Math.floor(Date.now() / 1000) + 3600 }),
              user: { id: 'usr_otp_1', email: body.email }
            }
          };
        }
        return { status: 401, body: { message: 'Invalid or expired OTP' } };
      }
      return null;
    });

    const client = createSupabaseClient({
      url: 'https://test.supabase.co',
      anonKey: createJwt({ role: 'anon' }),
      fetch: mockFetch,
      storage
    });
    const sdk = createAuroMindSDK({ env: { localStorage: storage, indexedDB: null } });
    await sdk.init({
      gameId: 'portal',
      capabilities: { authEnabled: true },
      providers: { auth: createSupabaseAuthProvider(client) }
    });

    // Reject invalid email
    const badEmail = await sdk.auth.signInWithOtp('not-an-email');
    assert.equal(badEmail.ok, false);
    assert.equal(badEmail.errorCode, 'INVALID_EMAIL');

    // Send OTP -> pending state tracked
    const sent = await sdk.auth.signInWithOtp('otp@auromasti.test');
    assert.equal(sent.ok, true);
    assert.equal(sdk.auth.getPendingAuthState()?.method, 'otp');

    // Cancel pending auth cleanly
    sdk.auth.cancelPendingAuth();
    assert.equal(sdk.auth.getPendingAuthState(), null);

    // Reject malformed/short OTP token locally before network call
    const badToken = await sdk.auth.verifyOtp('otp@auromasti.test', '12');
    assert.equal(badToken.ok, false);
    assert.equal(badToken.errorCode, 'INVALID_OTP_TOKEN');

    // Wrong OTP code fails cleanly without signing in
    const wrongOtp = await sdk.auth.verifyOtp('otp@auromasti.test', '000000');
    assert.equal(wrongOtp.ok, false);
    assert.equal(sdk.auth.getAccount(), null);

    // Valid OTP completes authentication
    const goodOtp = await sdk.auth.verifyOtp('otp@auromasti.test', '654321');
    assert.equal(goodOtp.ok, true);
    assert.equal(goodOtp.account.userId, 'usr_otp_1');
    assert.equal(sdk.auth.getAccount().userId, 'usr_otp_1');

    sdk.dispose();
  });

  test('5. Google OAuth flow: initiation, redirect validation, CSRF state check, cancellation, PKCE exchange, and duplicate callback rejection', async () => {
    const storage = createMemoryStorage();
    let pkceCalls = 0;
    const mockFetch = makeMockFetch(({ url, body }) => {
      if (url.includes('/auth/v1/token?grant_type=pkce')) {
        pkceCalls += 1;
        return {
          status: 200,
          body: {
            access_token: createJwt({ sub: 'usr_google_1', exp: Math.floor(Date.now() / 1000) + 3600 }),
            user: { id: 'usr_google_1', email: 'seeker@gmail.com', user_metadata: { full_name: 'Mira' } }
          }
        };
      }
      return null;
    });

    const client = createSupabaseClient({
      url: 'https://test.supabase.co',
      anonKey: createJwt({ role: 'anon' }),
      fetch: mockFetch,
      storage
    });
    const sdk = createAuroMindSDK({ env: { localStorage: storage, indexedDB: null } });
    await sdk.init({
      gameId: 'portal',
      capabilities: { authEnabled: true },
      providers: { auth: createSupabaseAuthProvider(client) }
    });

    // Reject unsupported provider & javascript: redirect
    const badProvider = await sdk.auth.signInWithOAuth('evil_idp');
    assert.equal(badProvider.ok, false);
    assert.equal(badProvider.errorCode, 'UNSUPPORTED_OAUTH_PROVIDER');

    const badRedirect = await sdk.auth.signInWithOAuth('google', { redirectTo: 'javascript:alert(1)' });
    assert.equal(badRedirect.ok, false);
    assert.equal(badRedirect.errorCode, 'INVALID_REDIRECT_URL');

    // Valid Google OAuth initiation
    const initRes = await sdk.auth.signInWithOAuth('google', { redirectTo: 'https://auromasti.com/' });
    assert.equal(initRes.ok, true);
    assert.ok(initRes.url.includes('provider=google'));
    assert.ok(initRes.state && initRes.state.length >= 8);

    // Reject CSRF state mismatch
    const mismatchRes = await sdk.auth.handleAuthCallback(`https://auromasti.com/?code=auth_code_1&state=wrong_state`);
    assert.equal(mismatchRes.ok, false);
    assert.equal(mismatchRes.errorCode, 'OAUTH_STATE_MISMATCH');
    assert.equal(pkceCalls, 0);

    // Handle user cancellation cleanly
    const cancelRes = await sdk.auth.handleAuthCallback(`https://auromasti.com/?error=access_denied&error_description=User+cancelled`);
    assert.equal(cancelRes.ok, false);
    assert.equal(cancelRes.cancelled, true);
    assert.equal(cancelRes.errorCode, 'OAUTH_CANCELLED');
    assert.equal(sdk.auth.getAccount(), null);

    // Re-initiate and complete valid callback
    const initRes2 = await sdk.auth.signInWithOAuth('google', { redirectTo: 'https://auromasti.com/' });
    const callbackUrl = `https://auromasti.com/?code=auth_code_valid_99&state=${encodeURIComponent(initRes2.state)}`;
    const okCb = await sdk.auth.handleAuthCallback(callbackUrl);
    assert.equal(okCb.ok, true);
    assert.equal(okCb.account.userId, 'usr_google_1');
    assert.equal(pkceCalls, 1);

    // Duplicate callback replay is strictly rejected without hitting network again
    const dupCb = await sdk.auth.handleAuthCallback(callbackUrl);
    assert.equal(dupCb.ok, false);
    assert.equal(dupCb.duplicate, true);
    assert.equal(dupCb.errorCode, 'DUPLICATE_AUTH_CALLBACK');
    assert.equal(pkceCalls, 1);

    sdk.dispose();
  });

  test('6. Duplicate/concurrent auth operations and signOut superseding slow in-flight login', async () => {
    const storage = createMemoryStorage();
    let releaseLogin;
    let signInCalls = 0;

    const slowAuthProvider = {
      providerName: 'mock-slow-auth',
      isConfigured: () => true,
      getCurrentSession: async () => null,
      signIn: async () => {
        signInCalls += 1;
        await new Promise((resolve) => { releaseLogin = resolve; });
        return { ok: true, account: { userId: 'usr_slow_1', email: 'slow@test.com' } };
      },
      signOut: async () => {},
      onAuthStateChange: () => () => {}
    };

    const sdk = createAuroMindSDK({ env: { localStorage: storage, indexedDB: null } });
    await sdk.init({
      gameId: 'portal',
      capabilities: { authEnabled: true },
      providers: { auth: slowAuthProvider }
    });

    // Launch slow login #1
    const firstPromise = sdk.auth.signInWithEmail('slow@test.com', 'pw');
    // Concurrent duplicate login #2 must be rejected immediately with AUTH_IN_PROGRESS
    const secondRes = await sdk.auth.signInWithEmail('slow@test.com', 'pw');
    assert.equal(secondRes.ok, false);
    assert.equal(secondRes.errorCode, 'AUTH_IN_PROGRESS');
    assert.equal(signInCalls, 1);

    // User triggers signOut BEFORE slow login #1 resolves
    await sdk.auth.signOut();
    releaseLogin();
    const firstRes = await firstPromise;

    // Slow login MUST be discarded as superseded; user stays signed out!
    assert.equal(firstRes.ok, false);
    assert.equal(firstRes.stale, true);
    assert.equal(firstRes.errorCode, 'AUTH_SUPERSEDED');
    assert.equal(sdk.auth.getAccount(), null);

    sdk.dispose();
  });

  test('7. Guest-to-account linking preserves guestId, game saves, and migrates guest profile; rejects spoofed guestId and double-upgrade', async () => {
    const storage = createMemoryStorage();
    const linkedCalls = [];
    const mockAuth = {
      providerName: 'mock-link-auth',
      isConfigured: () => true,
      getCurrentSession: async () => null,
      signUp: async ({ email }) => ({
        ok: true,
        account: { userId: 'usr_linked_1', email }
      }),
      signIn: async (_m, { email }) => ({
        ok: true,
        account: { userId: 'usr_linked_1', email }
      }),
      linkGuestIdentity: async (guestId, account) => {
        linkedCalls.push({ guestId, userId: account.userId });
        return { linked: true, guestId, userId: account.userId };
      },
      signOut: async () => {},
      onAuthStateChange: () => () => {}
    };

    const sdk = createAuroMindSDK({ env: { localStorage: storage, indexedDB: null } });
    await sdk.init({
      gameId: 'portal',
      capabilities: { authEnabled: true },
      providers: { auth: mockAuth }
    });

    const guestId = sdk.identity.getGuestId();
    // Seed guest profile & local game progress BEFORE upgrade
    sdk.player.setDisplayName('Lotus Traveler');
    await sdk.player.setAvatar({ type: 'preset', presetId: 'sun' });
    storage.setItem('auroblocks_high_score', '4200');

    const upgradeRes = await sdk.auth.upgradeGuestToAccount(
      { email: 'linked@auromasti.test', password: 'pw123' },
      { mode: 'signUp' }
    );
    assert.equal(upgradeRes.ok, true);
    assert.equal(upgradeRes.linked, true);
    assert.equal(upgradeRes.guestId, guestId);
    assert.equal(sdk.identity.getGuestId(), guestId);
    assert.equal(storage.getItem('auroblocks_high_score'), '4200', 'Game progress must remain intact');

    // Guest profile data migrated into authenticated user's isolated profile!
    const linkedProfile = sdk.player.getProfile();
    assert.equal(linkedProfile.userId, 'usr_linked_1');
    assert.equal(linkedProfile.displayName, 'Lotus Traveler');
    assert.equal(linkedProfile.avatar.presetId, 'sun');
    assert.ok(linkedProfile.linkedGuestIds.includes(guestId));

    // Reject spoofed/malformed guestId in linkGuestIdentity
    const spoofRes = await sdk.auth.linkGuestIdentity('guest_not_a_uuid');
    assert.equal(spoofRes.linked, false);
    assert.equal(spoofRes.error, 'INVALID_GUEST_ID');

    // Reject upgrading again while already signed in (prevents accidental hijacking)
    const hijackRes = await sdk.auth.upgradeGuestToAccount({ email: 'other@test.com', password: 'pw' });
    assert.equal(hijackRes.ok, false);
    assert.equal(hijackRes.errorCode, 'ALREADY_AUTHENTICATED');

    sdk.dispose();
  });

  test('8. Account switching & logout isolation: User A profile, avatar, and entitlements NEVER leak to User B or Guest (even on offline/throwing signOut)', async () => {
    const storage = createMemoryStorage();
    let throwOnSignOut = true;
    const mockAuth = {
      providerName: 'mock-switch-auth',
      isConfigured: () => true,
      getCurrentSession: async () => null,
      signIn: async (_m, { email }) => ({
        ok: true,
        account: { userId: email.startsWith('alice') ? 'usr_alice' : 'usr_bob', email }
      }),
      signOut: async () => {
        if (throwOnSignOut) throw new Error('OFFLINE_NETWORK_ERROR');
      },
      onAuthStateChange: () => () => {}
    };
    const mockEntitlements = {
      providerName: 'mock-ent',
      isConfigured: () => true,
      fetchEntitlements: async (uid) =>
        uid === 'usr_alice' ? [{ gameId: 'auromatch', sku: 'pass_alice', status: 'active' }] : []
    };

    const sdk = createAuroMindSDK({ env: { localStorage: storage, indexedDB: null } });
    await sdk.init({
      gameId: 'portal',
      capabilities: { authEnabled: true, entitlementsEnabled: true },
      providers: { auth: mockAuth, entitlements: mockEntitlements }
    });

    const guestId = sdk.identity.getGuestId();
    sdk.player.setDisplayName('Guest Default');

    // 1. Alice signs in, sets custom display name, avatar, and refreshes entitlements
    await sdk.auth.signInWithEmail('alice@auromasti.test', 'pw');
    sdk.player.setDisplayName('Alice Sovereign');
    const avRes = await sdk.player.setAvatar(VALID_PNG_DATA_URL);
    assert.equal(avRes.ok, true);
    await sdk.entitlements.refresh();
    assert.equal(sdk.entitlements.hasEntitlement('auromatch', 'pass_alice'), true);

    // 2. Alice signs out while provider throws offline error -> local signOut MUST still succeed & clear Alice's state
    await sdk.auth.signOut();
    assert.equal(sdk.auth.getAccount(), null);
    assert.equal(sdk.identity.getGuestId(), guestId, 'Guest ID preserved on sign-out');
    assert.equal(sdk.player.getDisplayName(), 'Guest Default', 'Must revert to Guest profile, never Alice');
    assert.equal(sdk.player.getAvatar().type, 'preset', 'Alice avatar must not leak into Guest');
    assert.equal(sdk.entitlements.hasEntitlement('auromatch', 'pass_alice'), false, 'Alice entitlements cleared');

    // 3. Bob signs in -> must NOT inherit Alice's displayName, avatar, or entitlements!
    throwOnSignOut = false;
    await sdk.auth.signInWithEmail('bob@auromasti.test', 'pw');
    const bobProfile = sdk.player.getProfile();
    assert.equal(bobProfile.userId, 'usr_bob');
    assert.notEqual(bobProfile.displayName, 'Alice Sovereign');
    assert.equal(bobProfile.avatar.type, 'preset');
    assert.equal(sdk.entitlements.hasEntitlement('auromatch', 'pass_alice'), false);

    // Bob sets his own profile -> switch back to Alice -> Alice's isolated profile is still preserved!
    sdk.player.setDisplayName('Bob Mindful');
    await sdk.auth.signOut();
    await sdk.auth.signInWithEmail('alice@auromasti.test', 'pw');
    assert.equal(sdk.player.getDisplayName(), 'Alice Sovereign');
    assert.equal(sdk.player.getAvatar().type, 'data_url');

    sdk.dispose();
  });

  test('9. Profile validation, sanitization, prototype pollution defense, and missing/deleted profile recovery', async () => {
    const storage = createMemoryStorage();
    // Seed corrupted preferences attempting prototype pollution and out-of-range values
    storage.setItem(
      LS_PROFILE_KEY,
      JSON.stringify({
        displayName: '  \u0000<script>alert(1)</script>\u202E  Maya   Devi  ',
        preferences: {
          ambientVolume: 'not-a-number',
          sfxVolume: 99,
          seniorMode: 'truthy-string',
          theme: 'malicious_theme'
        },
        avatar: { type: 'data_url', value: 'data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Pjwvc2NyaXB0Pjwvc3ZnPg==' }
      })
    );

    const sdk = createAuroMindSDK({ env: { localStorage: storage, indexedDB: null } });
    await sdk.init({ gameId: 'portal' });

    const prof = sdk.player.getProfile();
    assert.equal(prof.displayName, 'scriptalert(1)/script Maya Devi');
    assert.ok(!prof.displayName.includes('<') && !prof.displayName.includes('>'));
    assert.equal(prof.preferences.ambientVolume, 0.5, 'Invalid non-numeric ambientVolume must NOT override default');
    assert.equal(prof.preferences.sfxVolume, 1, 'Out-of-range volume clamped to [0, 1]');
    assert.equal(prof.preferences.theme, 'system', 'Unknown theme falls back to system');
    assert.equal(prof.avatar.type, 'preset', 'Corrupted/SVG avatar in storage falls back safely to preset');

    // Empty/whitespace display name falls back to Guest Seeker
    assert.equal(sanitizeDisplayName('   \u200B\u0007   '), 'Guest Seeker');

    // Delete profile data -> recovers safely with fresh default profile without crashing
    await sdk.player.deleteUserData();
    assert.equal(storage.getItem(LS_PROFILE_KEY), null);
    const recovered = sdk.player.getProfile();
    assert.equal(recovered.displayName, 'Guest Seeker');
    assert.equal(recovered.avatar.presetId, 'lotus');

    sdk.dispose();
  });

  test('10. Avatar validation: valid PNG/JPEG/WebP accepted; SVG XSS, spoofed MIME, corrupt bytes, 0-byte, and >512KB rejected', async () => {
    const storage = createMemoryStorage();
    const sdk = createAuroMindSDK({ env: { localStorage: storage, indexedDB: null } });
    await sdk.init({ gameId: 'portal' });

    // Valid PNG, JPEG, WebP
    const pngRes = await sdk.player.setAvatar({ bytes: VALID_PNG_BYTES, mimeType: 'image/png', size: VALID_PNG_BYTES.length });
    assert.equal(pngRes.ok, true);
    assert.equal(pngRes.avatar.mimeType, 'image/png');

    const jpgPrep = await sdk.player.prepareAvatarUpload({ bytes: VALID_JPEG_BYTES, mimeType: 'image/jpeg', size: VALID_JPEG_BYTES.length });
    assert.equal(jpgPrep.ok, true);
    assert.equal(jpgPrep.mimeType, 'image/jpeg');
    assert.ok(jpgPrep.sha256 && jpgPrep.sha256.length > 10);

    const webpRes = await validateAvatarInput({ bytes: VALID_WEBP_BYTES, mimeType: 'image/webp', size: VALID_WEBP_BYTES.length });
    assert.equal(webpRes.valid, true);

    // Reject SVG XSS vector
    const svgRes = await sdk.player.setAvatar('data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+PC9zdmc+');
    assert.equal(svgRes.ok, false);
    assert.equal(svgRes.errorCode, 'AVATAR_INVALID_MIME_TYPE');

    // Reject spoofed MIME (HTML bytes pretending to be image/png)
    const htmlBytes = new TextEncoder().encode('<html><body><script>alert(1)</script></body></html>');
    const spoofRes = await sdk.player.setAvatar({ bytes: htmlBytes, mimeType: 'image/png', size: htmlBytes.length });
    assert.equal(spoofRes.ok, false);
    assert.equal(spoofRes.errorCode, 'AVATAR_MALFORMED_IMAGE');

    // Reject 0-byte file
    const emptyRes = await sdk.player.setAvatar({ bytes: new Uint8Array(0), mimeType: 'image/png', size: 0 });
    assert.equal(emptyRes.ok, false);
    assert.equal(emptyRes.errorCode, 'AVATAR_EMPTY');

    // Reject oversized file (> 512 KB)
    const bigBytes = new Uint8Array(AVATAR_MAX_BYTES + 16);
    bigBytes.set(VALID_PNG_BYTES, 0);
    const bigRes = await sdk.player.setAvatar({ bytes: bigBytes, mimeType: 'image/png', size: bigBytes.length });
    assert.equal(bigRes.ok, false);
    assert.equal(bigRes.errorCode, 'AVATAR_FILE_TOO_LARGE');

    // Previous valid PNG avatar was NOT corrupted by failed attempts
    assert.equal(sdk.player.getAvatar().mimeType, 'image/png');

    // Clear resets to default lotus preset
    const cleared = sdk.player.clearAvatar();
    assert.equal(cleared.type, 'preset');
    assert.equal(cleared.presetId, 'lotus');

    sdk.dispose();
  });

  test('11. Storage unavailable (both localStorage and IndexedDB throwing) + failing getCurrentSession degrades cleanly to offline guest mode', async () => {
    const throwingLs = {
      getItem() { throw new Error('SecurityError: storage blocked'); },
      setItem() { throw new Error('SecurityError: storage blocked'); },
      removeItem() { throw new Error('SecurityError: storage blocked'); }
    };
    const throwingAuth = {
      providerName: 'broken-auth',
      isConfigured: () => true,
      getCurrentSession: async () => { throw new Error('Corrupt provider store'); },
      signOut: async () => {},
      onAuthStateChange: () => () => {}
    };

    const sdk = createAuroMindSDK({ env: { localStorage: throwingLs, indexedDB: null } });
    const ctx = await sdk.init({
      gameId: 'portal',
      capabilities: { authEnabled: true },
      providers: { auth: throwingAuth }
    });

    assert.equal(ctx.initialized, true);
    assert.equal(ctx.identity.mode, 'guest');
    assert.equal(ctx.identity.guest.ephemeral, true);
    assert.equal(ctx.identity.guest.storageSource, 'memory');

    // Profile updates still function in-memory without throwing
    assert.equal(sdk.player.setDisplayName('Ephemeral Seeker'), 'Ephemeral Seeker');
    assert.equal(sdk.player.getDisplayName(), 'Ephemeral Seeker');

    sdk.dispose();
  });

  test('12. Cross-tab auth and profile synchronization via BroadcastChannel keeps Tab B consistent with Tab A', async () => {
    const sharedStorage = createMemoryStorage();
    const FakeBC = createFakeBroadcastBus();
    let sharedSession = null;

    const makeAuthProvider = () => ({
      providerName: 'shared-tab-auth',
      isConfigured: () => true,
      getCurrentSession: async () => sharedSession,
      signIn: async (_m, { email }) => {
        sharedSession = { userId: 'usr_tab_1', email };
        return { ok: true, account: sharedSession };
      },
      signOut: async () => { sharedSession = null; },
      onAuthStateChange: () => () => {}
    });

    const tabA = createAuroMindSDK({ env: { localStorage: sharedStorage, indexedDB: null, BroadcastChannel: FakeBC } });
    const tabB = createAuroMindSDK({ env: { localStorage: sharedStorage, indexedDB: null, BroadcastChannel: FakeBC } });

    await tabA.init({ gameId: 'portal', capabilities: { authEnabled: true }, providers: { auth: makeAuthProvider() } });
    await tabB.init({ gameId: 'portal', capabilities: { authEnabled: true }, providers: { auth: makeAuthProvider() } });

    assert.equal(tabA.identity.getGuestId(), tabB.identity.getGuestId());

    // Tab A signs in -> Tab B automatically syncs to authenticated user
    await tabA.auth.signInWithEmail('tabs@auromasti.test', 'pw');
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(tabB.auth.getAccount()?.userId, 'usr_tab_1');

    // Tab A updates profile displayName -> Tab B invalidates cache & reads new displayName
    tabA.player.setDisplayName('Synced Across Tabs');
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(tabB.player.getDisplayName(), 'Synced Across Tabs');

    // Tab A signs out -> Tab B automatically clears account & reverts to guest
    await tabA.auth.signOut();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(tabB.auth.getAccount(), null);
    assert.equal(tabB.identity.get().mode, 'guest');

    tabA.dispose();
    tabB.dispose();
  });

  test('13. Sync metadata isolation: Account A -> Account B (after logout and direct switch without logout), logout/offline sign-out, reinit, same-account refresh, and outbox/save preservation', async () => {
    const storage = createMemoryStorage();
    let activeSession = null;
    let authChangeCb = null;
    let failSignOut = false;

    const mockAuth = {
      providerName: 'mock-sync-iso-auth',
      isConfigured: () => true,
      getCurrentSession: async () => activeSession,
      signIn: async (_m, { email }) => {
        const uid = email.startsWith('alice') ? 'usr_sync_alice' : 'usr_sync_bob';
        activeSession = { userId: uid, email };
        return { ok: true, account: activeSession };
      },
      signOut: async () => {
        activeSession = null;
        if (failSignOut) throw new Error('OFFLINE_SIGNOUT_ERROR');
      },
      onAuthStateChange: (cb) => {
        authChangeCb = cb;
        return () => { authChangeCb = null; };
      }
    };

    const mockCloudSync = {
      providerName: 'mock-cloud-sync',
      isConfigured: () => true,
      pullLatest: async () => null,
      pushWithOptimisticLock: async () => ({ status: 'success', newRevision: 7 }),
      listSaves: async () => []
    };

    const makeSyncAdapter = () => ({
      gameId: 'auromatch',
      adapterVersion: '1.0.0',
      contractVersion: 1,
      integrationMode: 'native',
      storage: { kind: 'ls', ownedDatabases: [], ownedLocalStorageKeys: ['auromatch_test_save'], localOnlyVaults: [] },
      capabilities: { offlinePlay: true, localPersistence: true, cloudSyncEligible: true, hasLocalOnlyVaults: false, localOnlyVaults: [] },
      hasLocalProgress: () => true,
      exportEnvelope: async (guestId) => ({
        envelopeVersion: 1,
        gameId: 'auromatch',
        gameSchemaVersion: 1,
        guestId,
        baseRevision: 0,
        checksum: 'chk_alice_v1',
        payload: { level: 12 },
        clientUpdatedAt: new Date().toISOString(),
        isEmpty: false
      }),
      applyEnvelope: async () => true,
      init: async () => {}
    });

    const sdk = createAuroMindSDK({ env: { localStorage: storage, indexedDB: null } });
    let sdkReinitGuest = null;
    let sdkReinitAlice = null;
    try {
    await sdk.init({
      gameId: 'portal',
      capabilities: { authEnabled: true, cloudSyncEnabled: true },
      providers: { auth: mockAuth, cloudSync: mockCloudSync }
    });
    sdk.adapters.register(makeSyncAdapter());
    await sdk.adapters.init('auromatch');

    // Seed guest save data and a pending outbox item for another game
    storage.setItem('auromatch_test_save', JSON.stringify({ level: 12 }));
    await sdk.sync.queueLocalChange('auroblocks');
    sdk.sync.setConsent(true);

    // 1. Account A (Alice) signs in and completes a sync
    await sdk.auth.signInWithEmail('alice@auromasti.test', 'pw');
    const syncRes = await sdk.sync.syncNow('auromatch');
    assert.equal(syncRes.status, 'success');

    const aliceStatus = sdk.sync.getSyncStatus();
    assert.ok(aliceStatus.lastSyncAt, 'Alice must have persisted lastSyncAt after sync');
    assert.equal(aliceStatus.metadata.auromatch?.revision, 7);
    assert.equal(storage.getItem(LS_SYNC_META_KEY), null, 'Account sync metadata must NOT be stored under shared flat LS_SYNC_META_KEY');

    // 2. Same-account session refresh preserves Alice's valid metadata
    const refreshedExp = new Date(Date.now() + 3600_000).toISOString();
    activeSession = { userId: 'usr_sync_alice', email: 'alice@auromasti.test', expiresAt: refreshedExp };
    authChangeCb(activeSession);
    const aliceAfterRefresh = sdk.sync.getSyncStatus();
    assert.equal(aliceAfterRefresh.lastSyncAt, aliceStatus.lastSyncAt, 'Same-account refresh must preserve lastSyncAt');
    assert.equal(aliceAfterRefresh.metadata.auromatch?.revision, 7);

    // 3. Direct account switch from Alice -> Bob WITHOUT intermediate logout
    await sdk.auth.signInWithEmail('bob@auromasti.test', 'pw');
    const bobDirectStatus = sdk.sync.getSyncStatus();
    assert.equal(bobDirectStatus.lastSyncAt, null, 'Bob must NOT see Alice lastSyncAt after direct switch');
    assert.deepEqual(bobDirectStatus.metadata, {}, 'Bob must NOT see Alice per-game sync metadata');
    assert.deepEqual(bobDirectStatus.pendingGames, [], 'Bob must NOT inherit guest outbox without explicit migration');
    assert.ok(JSON.parse(storage.getItem(LS_OUTBOX_KEY) || '[]').includes('auroblocks'), 'Guest outbox entries must remain intact');
    assert.equal(JSON.parse(storage.getItem('auromatch_test_save')).level, 12, 'Guest save data must remain intact');

    // Also test direct switch via provider onAuthStateChange (Alice -> Bob)
    authChangeCb({ userId: 'usr_sync_alice', email: 'alice@auromasti.test' });
    assert.equal(sdk.sync.getSyncStatus().metadata.auromatch?.revision, 7, 'Alice own metadata restored when switching back to Alice');
    authChangeCb({ userId: 'usr_sync_bob', email: 'bob@auromasti.test' });
    assert.equal(sdk.sync.getSyncStatus().lastSyncAt, null);
    assert.deepEqual(sdk.sync.getSyncStatus().metadata, {});

    // 4. Switch back to Alice, then sign out WITH failing/offline provider signOut -> Guest cannot see Alice metadata
    await sdk.auth.signInWithEmail('alice@auromasti.test', 'pw');
    assert.equal(sdk.sync.getSyncStatus().metadata.auromatch?.revision, 7);
    failSignOut = true;
    await sdk.auth.signOut();
    const guestStatusAfterFailedSignOut = sdk.sync.getSyncStatus();
    assert.equal(sdk.auth.getAccount(), null);
    assert.equal(guestStatusAfterFailedSignOut.lastSyncAt, null, 'Guest mode must NOT see Alice lastSyncAt after logout');
    assert.deepEqual(guestStatusAfterFailedSignOut.metadata, {}, 'Guest mode must NOT see Alice metadata after logout');
    assert.ok(guestStatusAfterFailedSignOut.pendingGames.includes('auroblocks'), 'Outbox preserved after failed provider signOut');
    assert.equal(JSON.parse(storage.getItem('auromatch_test_save')).level, 12, 'Guest save preserved after logout');

    // 5. Bob signs in after Alice logged out -> Bob cannot see Alice metadata
    failSignOut = false;
    await sdk.auth.signInWithEmail('bob@auromasti.test', 'pw');
    assert.equal(sdk.sync.getSyncStatus().lastSyncAt, null);
    assert.deepEqual(sdk.sync.getSyncStatus().metadata, {});
    await sdk.auth.signOut();
    sdk.dispose();

    // 6. Reinitialize brand-new SDK instance after logout (even if legacy flat LS_SYNC_META_KEY existed)
    storage.setItem(LS_SYNC_META_KEY, JSON.stringify({ lastSyncAt: '2026-01-01T00:00:00.000Z', auromatch: { revision: 99 } }));
    sdkReinitGuest = createAuroMindSDK({ env: { localStorage: storage, indexedDB: null } });
    await sdkReinitGuest.init({
      gameId: 'portal',
      capabilities: { authEnabled: true, cloudSyncEnabled: true },
      providers: { auth: mockAuth, cloudSync: mockCloudSync }
    });
    assert.equal(sdkReinitGuest.sync.getSyncStatus().lastSyncAt, null, 'Stale metadata must NOT reappear on reinit in guest mode');
    assert.deepEqual(sdkReinitGuest.sync.getSyncStatus().metadata, {});
    assert.equal(storage.getItem(LS_SYNC_META_KEY), null, 'Stale legacy flat key must be cleared on reinit');
    assert.ok(sdkReinitGuest.sync.getSyncStatus().pendingGames.includes('auroblocks'), 'Pending outbox survives reinit');
    sdkReinitGuest.dispose();
    sdkReinitGuest = null;

    // 7. Reinitialize SDK as Alice (same-account reload) -> Alice's valid metadata IS preserved
    activeSession = { userId: 'usr_sync_alice', email: 'alice@auromasti.test' };
    sdkReinitAlice = createAuroMindSDK({ env: { localStorage: storage, indexedDB: null } });
    await sdkReinitAlice.init({
      gameId: 'portal',
      capabilities: { authEnabled: true, cloudSyncEnabled: true },
      providers: { auth: mockAuth, cloudSync: mockCloudSync }
    });
    assert.equal(sdkReinitAlice.sync.getSyncStatus().lastSyncAt, aliceStatus.lastSyncAt);
    assert.equal(sdkReinitAlice.sync.getSyncStatus().metadata.auromatch?.revision, 7);
    sdkReinitAlice.dispose();
    sdkReinitAlice = null;
    } finally {
      try { sdk.dispose(); } catch {}
      try { sdkReinitGuest?.dispose(); } catch {}
      try { sdkReinitAlice?.dispose(); } catch {}
    }
  });

  test('14. Multi-tab sync metadata isolation: two tabs switching accounts never expose another account sync metadata', async () => {
    const sharedStorage = createMemoryStorage();
    const FakeBC = createFakeBroadcastBus();
    let sharedSession = null;

    const makeTabAuth = () => ({
      providerName: 'multi-tab-sync-auth',
      isConfigured: () => true,
      getCurrentSession: async () => sharedSession,
      signIn: async (_m, { email }) => {
        const uid = email.startsWith('alice') ? 'usr_mt_alice' : 'usr_mt_bob';
        sharedSession = { userId: uid, email };
        return { ok: true, account: sharedSession };
      },
      signOut: async () => { sharedSession = null; },
      onAuthStateChange: () => () => {}
    });

    const mockCloudSync = {
      providerName: 'mock-mt-sync',
      isConfigured: () => true,
      pullLatest: async () => null,
      pushWithOptimisticLock: async () => ({ status: 'success', newRevision: 3 }),
      listSaves: async () => []
    };

    const tabA = createAuroMindSDK({ env: { localStorage: sharedStorage, indexedDB: null, BroadcastChannel: FakeBC } });
    const tabB = createAuroMindSDK({ env: { localStorage: sharedStorage, indexedDB: null, BroadcastChannel: FakeBC } });

    try {
    await tabA.init({ gameId: 'portal', capabilities: { authEnabled: true, cloudSyncEnabled: true }, providers: { auth: makeTabAuth(), cloudSync: mockCloudSync } });
    await tabB.init({ gameId: 'portal', capabilities: { authEnabled: true, cloudSyncEnabled: true }, providers: { auth: makeTabAuth(), cloudSync: mockCloudSync } });

    tabA.adapters.register({
      gameId: 'auromatch',
      adapterVersion: '1.0.0',
      contractVersion: 1,
      integrationMode: 'native',
      storage: { kind: 'ls', ownedDatabases: [], ownedLocalStorageKeys: ['mt_save'], localOnlyVaults: [] },
      capabilities: { offlinePlay: true, localPersistence: true, cloudSyncEligible: true, hasLocalOnlyVaults: false, localOnlyVaults: [] },
      hasLocalProgress: () => true,
      exportEnvelope: async (guestId) => ({
        envelopeVersion: 1,
        gameId: 'auromatch',
        gameSchemaVersion: 1,
        guestId,
        baseRevision: 0,
        checksum: 'chk_mt_1',
        payload: { score: 900 },
        clientUpdatedAt: new Date().toISOString(),
        isEmpty: false
      }),
      applyEnvelope: async () => true,
      init: async () => {}
    });
    await tabA.adapters.init('auromatch');

    // Tab A signs in as Alice and syncs -> Tab B syncs to Alice and sees Alice's metadata
    tabA.sync.setConsent(true);
    await tabA.auth.signInWithEmail('alice@auromasti.test', 'pw');
    await new Promise((r) => setTimeout(r, 20));
    await tabA.sync.syncNow('auromatch');
    await new Promise((r) => setTimeout(r, 20));

    assert.equal(tabB.auth.getAccount()?.userId, 'usr_mt_alice');
    assert.equal(tabB.sync.getSyncStatus().metadata.auromatch?.revision, 3);

    // Tab A switches directly to Bob -> Tab B immediately isolates & cannot see Alice's metadata
    await tabA.auth.signInWithEmail('bob@auromasti.test', 'pw');
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(tabB.auth.getAccount()?.userId, 'usr_mt_bob');
    assert.equal(tabB.sync.getSyncStatus().lastSyncAt, null, 'Tab B as Bob must NOT see Alice lastSyncAt');
    assert.deepEqual(tabB.sync.getSyncStatus().metadata, {}, 'Tab B as Bob must NOT see Alice sync metadata');

    // Tab A signs out -> Tab B reverts to guest with empty sync metadata
    await tabA.auth.signOut();
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(tabB.auth.getAccount(), null);
    assert.equal(tabB.sync.getSyncStatus().lastSyncAt, null);
    assert.deepEqual(tabB.sync.getSyncStatus().metadata, {});
    } finally {
      try { tabA.dispose(); } catch {}
      try { tabB.dispose(); } catch {}
    }
  });
});

// ===========================================================================
// PART 2: REAL CHROMIUM/EDGE BROWSER E2E TESTS
// ===========================================================================

describe('B19.5-02 Part 2 — Real Browser E2E Verification (Chromium/Edge)', () => {
  let env = null;

  before(async () => {
    env = await createTestEnvironment({ port: 3339 });
  });

  after(async () => {
    if (env) {
      await env.teardown();
    }
  });

  test('Real Browser 1: Guest identity persists across reload; Profile displayName & Avatar preset/file validation & onerror fallback work in DOM', async () => {
    const { page, close, consoleErrors } = await env.createInstrumentedPage();
    try {
      await page.goto(env.baseUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.AuroMindPortal && window.AuroMindPortal.isInitialized(), { timeout: 10000 });

      // Dismiss welcome guide modal if open
      await page.evaluate(() => {
        const g = document.getElementById('guide-modal');
        if (g) g.classList.remove('open');
      });

      const initialGuestId = await page.evaluate(() => window.AuroMindPortal.getGuestId());
      assert.ok(/^guest_[0-9a-f-]{36}$/.test(initialGuestId), `Valid guestId expected, got ${initialGuestId}`);

      // Open Account & Profile modal
      await page.evaluate(() => document.getElementById('auth-btn').click());
      await page.waitForSelector('#auth-modal.open', { timeout: 5000 });

      // Account-only Sync Now button must be disabled in unauthenticated Guest Mode
      const syncDisabled = await page.$eval('#auth-sync-now-btn', (el) => el.disabled);
      assert.equal(syncDisabled, true, 'Sync Now must be disabled for unauthenticated guest');

      // Update display name with unsafe characters -> sanitized & persisted
      await page.evaluate(() => {
        const input = document.getElementById('profile-display-name-input');
        input.value = '  <Ananda>  Seeker  ';
        document.getElementById('profile-save-btn').click();
      });
      const savedName = await page.$eval('#profile-display-name-input', (el) => el.value);
      assert.equal(savedName, 'Ananda Seeker');

      // Select avatar preset -> persisted
      await page.evaluate(() => document.querySelector('.avatar-preset-btn[data-preset="peacock"]').click());
      await page.waitForFunction(
        () => document.getElementById('profile-avatar-preview')?.textContent.trim() === '🦚',
        { timeout: 5000 }
      );

      // Upload invalid SVG file via real File + change event -> rejected with error & avatar unchanged
      await page.evaluate(() => {
        const input = document.getElementById('profile-avatar-file-input');
        const dt = new DataTransfer();
        dt.items.add(new File(['<svg onload="alert(1)"></svg>'], 'xss.svg', { type: 'image/svg+xml' }));
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await page.waitForFunction(() => {
        const msg = document.getElementById('auth-notification-msg');
        return msg && msg.style.display === 'block' && /Unsupported image type/i.test(msg.textContent);
      }, { timeout: 5000 });
      assert.equal(await page.$eval('#profile-avatar-preview', (el) => el.textContent.trim()), '🦚');

      // Upload valid PNG via real File + change event -> accepted and rendered as <img>
      await page.evaluate((pngArray) => {
        const input = document.getElementById('profile-avatar-file-input');
        const dt = new DataTransfer();
        dt.items.add(new File([new Uint8Array(pngArray)], 'avatar.png', { type: 'image/png' }));
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }, Array.from(VALID_PNG_BYTES));
      await page.waitForSelector('#profile-avatar-preview img', { timeout: 5000 });

      // Verify img.onerror fallback renders lotus emoji if image fails to decode
      const fallbackText = await page.evaluate(() => {
        const img = document.querySelector('#profile-avatar-preview img');
        if (img && typeof img.onerror === 'function') img.onerror(new Event('error'));
        return document.getElementById('profile-avatar-preview').textContent.trim();
      });
      assert.equal(fallbackText, '🪷');

      // Reload page -> guestId, displayName, and PNG avatar all persist across reload!
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.AuroMindPortal && window.AuroMindPortal.isInitialized(), { timeout: 10000 });
      const reloadedGuestId = await page.evaluate(() => window.AuroMindPortal.getGuestId());
      const reloadedProfile = await page.evaluate(() => window.AuroMind.player.getProfile());
      assert.equal(reloadedGuestId, initialGuestId);
      assert.equal(reloadedProfile.displayName, 'Ananda Seeker');
      assert.equal(reloadedProfile.avatar.type, 'data_url');
      assert.equal(reloadedProfile.avatar.mimeType, 'image/png');

      const pageErrors = consoleErrors.filter((e) => e.type === 'pageerror');
      assert.equal(pageErrors.length, 0, 'Zero uncaught runtime errors during profile/avatar flow');
    } finally {
      await close();
    }
  });

  test('Real Browser 2: Multi-tab real browser identity and profile consistency', async () => {
    const context = await env.browser.createBrowserContext();
    const pageA = await context.newPage();
    const pageB = await context.newPage();
    try {
      await pageA.setViewport({ width: 1280, height: 800 });
      await pageB.setViewport({ width: 1280, height: 800 });
      await Promise.all([
        pageA.goto(env.baseUrl, { waitUntil: 'domcontentloaded' }),
        pageB.goto(env.baseUrl, { waitUntil: 'domcontentloaded' })
      ]);
      await Promise.all([
        pageA.waitForFunction(() => window.AuroMindPortal && window.AuroMindPortal.isInitialized(), { timeout: 10000 }),
        pageB.waitForFunction(() => window.AuroMindPortal && window.AuroMindPortal.isInitialized(), { timeout: 10000 })
      ]);

      // Allow BroadcastChannel / Web Locks reconciliation to converge
      await new Promise((r) => setTimeout(r, 300));
      const idA = await pageA.evaluate(() => window.AuroMindPortal.getGuestId());
      const idB = await pageB.evaluate(() => window.AuroMindPortal.getGuestId());
      assert.equal(idA, idB, 'Both real browser tabs must converge onto the exact same guestId');

      // Update profile name in Tab A -> Tab B picks it up via BroadcastChannel/storage event
      await pageA.evaluate(() => window.AuroMind.player.setDisplayName('MultiTab Harmony'));
      await pageB.waitForFunction(() => window.AuroMind.player.getDisplayName() === 'MultiTab Harmony', { timeout: 5000 });
      const nameB = await pageB.evaluate(() => window.AuroMind.player.getDisplayName());
      assert.equal(nameB, 'MultiTab Harmony');
    } finally {
      await context.close();
    }
  });

  test('Real Browser 3: All 6 games in portal theater receive identical guestId and live auth/logout propagation without stale userId', async () => {
    const { page, close } = await env.createInstrumentedPage();
    const games = [
      { id: 'auroblocks', expectedUrl: 'games/auroblocks/index.html' },
      { id: 'auromatch', expectedUrl: 'games/auromatch/index.html' },
      { id: 'auromandala', expectedUrl: 'games/auromandala/index.html' },
      { id: 'vak', expectedUrl: 'games/vak/index.html' },
      { id: 'wordriddle', expectedUrl: 'games/word-riddle/index.html' },
      { id: 'vak-sanctuary', expectedUrl: 'games/vak-living-sanctuary/index.html' }
    ];
    try {
      await page.goto(env.baseUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.AuroMindPortal && window.AuroMindPortal.isInitialized(), { timeout: 10000 });

      await page.evaluate(() => {
        const g = document.getElementById('guide-modal');
        if (g) g.classList.remove('open');
      });

      const portalGuestId = await page.evaluate(() => window.AuroMindPortal.getGuestId());
      assert.ok(portalGuestId && portalGuestId.startsWith('guest_'));

      // Register an in-browser mock auth provider on the portal SDK to verify live auth propagation across iframes
      await page.evaluate(() => {
        window.AuroMind.registerProviders({
          auth: {
            providerName: 'e2e-mock-auth',
            isConfigured: () => true,
            getCurrentSession: async () => null,
            signIn: async (_m, { email }) => ({ ok: true, account: { userId: 'usr_e2e_portal_1', email } }),
            signOut: async () => {},
            onAuthStateChange: () => () => {}
          }
        });
      });

      for (const game of games) {
        await page.evaluate((targetId) => {
          const btn = document.querySelector(`.play-game-btn[data-game-id="${targetId}"]`);
          if (btn) btn.click();
        }, game.id);
        await page.waitForSelector('#game-theater-view', { visible: true, timeout: 8000 });

        await page.waitForFunction(
          (expected) => {
            const iframe = document.getElementById('game-viewport-iframe');
            return Boolean(iframe && iframe.contentWindow && iframe.contentWindow.location.href.includes(expected));
          },
          { timeout: 10000 },
          game.expectedUrl
        );

        const iframeHandle = await page.$('#game-viewport-iframe');
        const frame = await iframeHandle.contentFrame();
        await frame.waitForFunction(() => Boolean(window.__AUROMIND_GUEST_ID__), { timeout: 10000 });

        const iframeGuestId = await frame.evaluate(() => window.__AUROMIND_GUEST_ID__);
        assert.equal(iframeGuestId, portalGuestId, `Game "${game.id}" must match portal guestId`);

        // Sign in from portal while game iframe is active -> iframe receives userId & authenticated mode
        await page.evaluate(async () => {
          await window.AuroMind.auth.signInWithEmail('e2e@auromasti.test', 'pw');
        });
        await frame.waitForFunction(
          () => window.__AUROMIND_USER_ID__ === 'usr_e2e_portal_1' && window.__AUROMIND_AUTH_MODE__ === 'authenticated',
          { timeout: 5000 }
        );

        // Sign out from portal -> iframe immediately clears userId to null & reverts to guest mode (no stale session!)
        await page.evaluate(async () => {
          await window.AuroMind.auth.signOut();
        });
        await frame.waitForFunction(
          () => window.__AUROMIND_USER_ID__ === null && window.__AUROMIND_AUTH_MODE__ === 'guest',
          { timeout: 5000 }
        );

        // Close theater cleanly before next game
        await page.evaluate(() => {
          const backBtn = document.getElementById('theater-back-btn');
          if (backBtn) backBtn.click();
        });
        await page.waitForFunction(() => !document.body.classList.contains('in-game-mode'), { timeout: 5000 });
      }
    } finally {
      await close();
    }
  });

  test('Real Browser 4: Portal survives completely blocked localStorage and IndexedDB via ephemeral memory mode + amber banner', async () => {
    const context = await env.browser.createBrowserContext();
    const page = await context.newPage();
    try {
      await page.setViewport({ width: 1280, height: 800 });
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(window, 'localStorage', {
          get() { throw new DOMException('Blocked by privacy policy', 'SecurityError'); },
          configurable: true
        });
        Object.defineProperty(window, 'indexedDB', {
          get() { return null; },
          configurable: true
        });
      });
      await page.goto(env.baseUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.AuroMindPortal && window.AuroMindPortal.isInitialized(), { timeout: 10000 });

      const identity = await page.evaluate(() => window.AuroMindPortal.getIdentity());
      assert.equal(identity.mode, 'guest');
      assert.equal(identity.guest.ephemeral, true);
      assert.equal(identity.guest.storageSource, 'memory');

      const bannerVisible = await page.$eval('#amber-storage-banner', (el) => el.style.display === 'block');
      assert.equal(bannerVisible, true, 'Amber ephemeral-storage warning banner must display');
    } finally {
      await context.close();
    }
  });
});
