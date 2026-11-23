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
    if (!session || !session.user || typeof session.user.id !== 'string' || !session.user.id.trim()) {
      return null;
    }
    const user = session.user;
    let expiresAt = null;
    if (typeof session.expires_at_ms === 'number' && Number.isFinite(session.expires_at_ms)) {
      expiresAt = new Date(session.expires_at_ms).toISOString();
    } else if (typeof session.expires_at === 'number' && Number.isFinite(session.expires_at)) {
      expiresAt = new Date(session.expires_at > 1e11 ? session.expires_at : session.expires_at * 1000).toISOString();
    } else if (typeof session.expires_at === 'string' && !Number.isNaN(Date.parse(session.expires_at))) {
      expiresAt = new Date(Date.parse(session.expires_at)).toISOString();
    }

    // Never expose raw access_token or refresh_token on the public account object
    return Object.freeze({
      userId: user.id.trim(),
      email: user.email || null,
      role: user.app_metadata?.role || user.role || 'authenticated',
      metadata: Object.freeze({ ...(user.user_metadata || {}) }),
      expiresAt
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
        ok: Boolean(res.ok),
        account: null,
        pendingVerification: Boolean(res.ok),
        errorCode: res.ok ? null : (res.error || 'OTP_FAILED'),
        message: res.message || res.error
      });
    }

    if (method === 'verify_otp') {
      return verifyOtp(params);
    }

    if (method === 'google' || method === 'oauth') {
      return signInWithOAuth({
        provider: params.provider || (method === 'google' ? 'google' : 'google'),
        redirectTo: params.redirectTo,
        state: params.state
      });
    }

    return Object.freeze({
      ok: false,
      account: null,
      errorCode: 'UNSUPPORTED_AUTH_METHOD',
      message: `Unsupported auth method "${method}".`
    });
  }

  async function verifyOtp(params = {}) {
    if (!isConfigured()) {
      return Object.freeze({
        ok: false,
        account: null,
        errorCode: 'SUPABASE_NOT_CONFIGURED',
        message: 'Supabase provider is not configured.'
      });
    }
    if (typeof client.auth.verifyOtp !== 'function') {
      return Object.freeze({
        ok: false,
        account: null,
        errorCode: 'METHOD_NOT_SUPPORTED',
        message: 'OTP verification is not supported by this client.'
      });
    }
    const res = await client.auth.verifyOtp({
      email: params.email,
      token: params.token || params.code,
      type: params.type || 'email'
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
      errorCode: res.error || 'OTP_VERIFICATION_FAILED',
      message: res.error || 'OTP verification failed.'
    });
  }

  async function signInWithOAuth(params = {}) {
    if (!isConfigured()) {
      return Object.freeze({
        ok: false,
        account: null,
        errorCode: 'SUPABASE_NOT_CONFIGURED',
        message: 'Supabase provider is not configured.'
      });
    }
    if (typeof client.auth.signInWithOAuth !== 'function') {
      return Object.freeze({
        ok: false,
        account: null,
        errorCode: 'METHOD_NOT_SUPPORTED',
        message: 'OAuth sign-in is not supported by this client.'
      });
    }
    const res = await client.auth.signInWithOAuth({
      provider: params.provider || 'google',
      redirectTo: params.redirectTo,
      state: params.state
    });
    if (res.ok) {
      return Object.freeze({
        ok: true,
        account: null,
        pendingRedirect: true,
        provider: res.provider,
        url: res.url,
        state: res.state
      });
    }
    return Object.freeze({
      ok: false,
      account: null,
      errorCode: res.error || 'OAUTH_INIT_FAILED',
      message: res.error || 'Failed to initiate OAuth flow.'
    });
  }

  async function handleOAuthCallback(callbackInput, options = {}) {
    if (!isConfigured()) {
      return Object.freeze({
        ok: false,
        account: null,
        errorCode: 'SUPABASE_NOT_CONFIGURED',
        message: 'Supabase provider is not configured.'
      });
    }
    if (typeof client.auth.handleOAuthCallback !== 'function') {
      return Object.freeze({
        ok: false,
        account: null,
        errorCode: 'METHOD_NOT_SUPPORTED',
        message: 'OAuth callback handling is not supported by this client.'
      });
    }
    const res = await client.auth.handleOAuthCallback(callbackInput, options);
    if (res.ok) {
      return Object.freeze({
        ok: true,
        account: mapAccount(res.session)
      });
    }
    return Object.freeze({
      ok: false,
      account: null,
      cancelled: Boolean(res.cancelled),
      duplicate: Boolean(res.duplicate),
      errorCode: res.error || 'OAUTH_CALLBACK_FAILED',
      message: res.message || res.error || 'OAuth callback failed.'
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

  function hasRefreshableSession() {
    if (!isConfigured()) return false;
    return typeof client.auth.hasRefreshableSession === 'function'
      ? Boolean(client.auth.hasRefreshableSession())
      : false;
  }

  async function refreshSession() {
    if (!isConfigured()) {
      return Object.freeze({
        ok: false,
        account: null,
        errorCode: 'SUPABASE_NOT_CONFIGURED',
        message: 'Supabase provider is not configured.'
      });
    }
    if (typeof client.auth.refreshSession !== 'function') {
      return Object.freeze({
        ok: false,
        account: null,
        errorCode: 'METHOD_NOT_SUPPORTED',
        message: 'Session refresh is not supported by this client.'
      });
    }
    const res = await client.auth.refreshSession();
    if (res && res.ok && res.session) {
      return Object.freeze({
        ok: true,
        account: mapAccount(res.session)
      });
    }
    return Object.freeze({
      ok: false,
      account: null,
      retryable: Boolean(res?.retryable),
      errorCode: res?.error || 'REFRESH_FAILED',
      message: res?.message || res?.error || 'Session refresh failed.'
    });
  }

  async function linkGuestIdentity(guestId, account) {
    if (!isConfigured() || !guestId || !account?.userId) {
      return Object.freeze({ linked: false, error: 'INVALID_INPUT' });
    }
    if (typeof guestId !== 'string' || !/^guest_[0-9a-f-]{36}$/i.test(guestId)) {
      return Object.freeze({ linked: false, error: 'INVALID_GUEST_ID' });
    }
    const activeUser = typeof client.auth?.getUser === 'function' ? client.auth.getUser() : null;
    if (activeUser?.id && activeUser.id !== account.userId) {
      return Object.freeze({ linked: false, error: 'ACCOUNT_MISMATCH' });
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
    hasRefreshableSession,
    refreshSession,
    signIn,
    signUp,
    verifyOtp,
    signInWithOAuth,
    handleOAuthCallback,
    signOut,
    linkGuestIdentity,
    onAuthStateChange,
    resetPassword
  });
}
