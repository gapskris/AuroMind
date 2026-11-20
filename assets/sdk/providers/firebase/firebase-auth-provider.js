/**
 * AuroMind Shared Platform SDK — Firebase AuthProvider Adapter
 *
 * Implements the AuthProvider interface for the AuroMind Shared SDK,
 * connecting user authentication, guest identity linking, and session restoration
 * to Google Firebase Authentication.
 */

export function createFirebaseAuthProvider(client) {
  function isConfigured() {
    return Boolean(client && client.isConfigured());
  }

  function mapAccount(sessionOrUser) {
    if (!sessionOrUser) return null;
    const userId = sessionOrUser.userId || sessionOrUser.localId || sessionOrUser.id;
    if (!userId) return null;

    return Object.freeze({
      userId,
      email: sessionOrUser.email || null,
      role: sessionOrUser.role || 'authenticated',
      isAnonymous: Boolean(sessionOrUser.isAnonymous),
      metadata: Object.freeze({ ...(sessionOrUser.metadata || {}) }),
      accessToken: sessionOrUser.idToken || sessionOrUser.accessToken || null
    });
  }

  async function getCurrentSession() {
    if (!isConfigured()) return null;
    const session = client.auth.getSession();
    return mapAccount(session);
  }

  async function signIn(method, params = {}) {
    if (!isConfigured()) {
      return Object.freeze({
        ok: false,
        account: null,
        errorCode: 'FIREBASE_NOT_CONFIGURED',
        message: 'Firebase provider is not configured.'
      });
    }

    if (method === 'anonymous' || method === 'guest') {
      const res = await client.auth.signInAnonymously();
      if (res.ok) {
        return Object.freeze({
          ok: true,
          account: mapAccount(res.session)
        });
      }
      return Object.freeze({
        ok: false,
        account: null,
        errorCode: 'AUTH_FAILED',
        message: res.error
      });
    }

    if (method === 'email_password' || method === 'password') {
      const res = await client.auth.signInWithPassword({
        email: params.email,
        password: params.password
      });
      if (res.ok) {
        return Object.freeze({
          ok: true,
          account: mapAccount(res.session)
        });
      }
      return Object.freeze({
        ok: false,
        account: null,
        errorCode: 'AUTH_FAILED',
        message: res.error
      });
    }

    return Object.freeze({
      ok: false,
      account: null,
      errorCode: 'UNSUPPORTED_AUTH_METHOD',
      message: `Unsupported auth method "${method}".`
    });
  }

  async function signUp(params = {}) {
    if (!isConfigured()) {
      return Object.freeze({
        ok: false,
        errorCode: 'FIREBASE_NOT_CONFIGURED',
        message: 'Firebase provider is not configured.'
      });
    }

    const res = await client.auth.signUp({
      email: params.email,
      password: params.password,
      metadata: params.metadata || {}
    });

    if (res.ok) {
      return Object.freeze({
        ok: true,
        account: res.session ? mapAccount(res.session) : null,
        user: res.user
      });
    }

    return Object.freeze({
      ok: false,
      errorCode: 'SIGNUP_FAILED',
      message: res.error
    });
  }

  async function signOut() {
    if (!isConfigured()) return;
    await client.auth.signOut();
  }

  async function linkGuestIdentity(guestId, account) {
    if (!isConfigured() || !guestId || !account?.userId) {
      return Object.freeze({ linked: false, error: 'INVALID_PARAMETERS' });
    }

    try {
      // Store link document in Firestore under users/{userId}/guest_identity_links/{guestId}
      const linkPath = `users/${account.userId}/guest_identity_links/${guestId}`;
      const res = await client.firestore.setDocument(linkPath, {
        userId: account.userId,
        guestId,
        deviceLabel: typeof navigator !== 'undefined' ? navigator.userAgent?.slice(0, 100) : 'unknown',
        linkedAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString()
      });

      if (!res.ok && res.error) {
        return Object.freeze({ linked: false, error: res.error });
      }
      return Object.freeze({ linked: true, guestId, userId: account.userId });
    } catch (err) {
      return Object.freeze({ linked: false, error: err.message });
    }
  }

  function onAuthStateChange(listener) {
    if (!isConfigured() || typeof listener !== 'function') {
      return () => {};
    }
    return client.auth.onAuthStateChange((user) => {
      listener(mapAccount(user));
    });
  }

  async function resetPassword(email) {
    if (!isConfigured() || !email) {
      return Object.freeze({ ok: false, errorCode: 'INVALID_INPUT' });
    }
    const res = await client.auth.resetPasswordForEmail(email);
    return Object.freeze({ ok: res.ok, error: res.error });
  }

  return Object.freeze({
    providerName: 'firebase-auth',
    isConfigured,
    getCurrentSession,
    signIn,
    signUp,
    signOut,
    linkGuestIdentity,
    onAuthStateChange,
    resetPassword
  });
}
