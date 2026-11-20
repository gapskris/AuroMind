/**
 * AuroMind Shared Platform SDK — Supabase AuthProvider Adapter
 *
 * Implements the AuthProvider interface for the AuroMind Shared SDK,
 * connecting user authentication, guest identity linking, and session restoration.
 */

export function createSupabaseAuthProvider(client) {
  function isConfigured() {
    return Boolean(client && client.isConfigured());
  }

  function mapAccount(session) {
    if (!session || !session.user) return null;
    const user = session.user;
    return Object.freeze({
      userId: user.id,
      email: user.email || null,
      role: user.app_metadata?.role || user.role || 'authenticated',
      metadata: Object.freeze({ ...(user.user_metadata || {}) }),
      accessToken: session.access_token || null
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
        errorCode: 'SUPABASE_NOT_CONFIGURED',
        message: 'Supabase provider is not configured.'
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

    if (method === 'otp' || method === 'magic_link') {
      const res = await client.auth.signInWithOtp({
        email: params.email,
        options: params.options || {}
      });
      return Object.freeze({
        ok: res.ok,
        account: null,
        message: res.message || res.error
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
        errorCode: 'SUPABASE_NOT_CONFIGURED',
        message: 'Supabase provider is not configured.'
      });
    }

    const res = await client.auth.signUp({
      email: params.email,
      password: params.password,
      options: { data: params.metadata || {} }
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
      return Object.freeze({ linked: false });
    }

    try {
      const { error } = await client.from('guest_identity_links').upsert({
        user_id: account.userId,
        guest_id: guestId,
        device_label: typeof navigator !== 'undefined' ? navigator.userAgent?.slice(0, 100) : 'unknown',
        last_seen_at: new Date().toISOString()
      }, { onConflict: 'user_id,guest_id' });

      if (error) {
        return Object.freeze({ linked: false, error: error.message });
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
    return client.auth.onAuthStateChange((_event, session) => {
      listener(mapAccount(session));
    });
  }

  async function resetPassword(email) {
    if (!isConfigured() || !email) {
      return Object.freeze({ ok: false, errorCode: 'INVALID_INPUT' });
    }
    return client.auth.resetPasswordForEmail(email);
  }

  return Object.freeze({
    providerName: 'supabase-auth',
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
