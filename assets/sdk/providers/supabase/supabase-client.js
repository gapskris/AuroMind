/**
 * AuroMind Shared Platform SDK — Supabase Client Layer
 *
 * Lightweight, browser-native HTTP client for Supabase Auth, REST, and RPC.
 * Zero external dependencies. Zero service_role leaks.
 * Supports token refreshing, offline detection, retry logic, and bounded timeouts.
 */

export class SupabaseClientError extends Error {
  constructor(message, status = 500, details = null) {
    super(message);
    this.name = 'SupabaseClientError';
    this.status = status;
    this.details = details;
  }
}

export function createSupabaseClient(config = {}) {
  const url = (config.url || config.supabaseUrl || '').trim().replace(/\/+$/, '');
  const anonKey = (
    config.publishableKey ||
    config.supabasePublishableKey ||
    config.anonKey ||
    config.supabaseAnonKey ||
    ''
  ).trim();
  const fetchApi = config.fetch || globalThis.fetch?.bind(globalThis);
  const storage = config.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  const sessionKey = config.sessionKey || 'auromind.platform.v1.supabase_session';
  const oauthStateKey = config.oauthStateKey || 'auromind.platform.v1.supabase_oauth_state';
  const defaultTimeoutMs = typeof config.timeoutMs === 'number' ? config.timeoutMs : 6000;
  const nowFn = typeof config.now === 'function' ? config.now : () => Date.now();

  function decodeJwtPayload(token) {
    if (typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    try {
      const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '=');
      const jsonStr =
        typeof Buffer !== 'undefined'
          ? Buffer.from(padded, 'base64').toString('utf8')
          : atob(padded);
      const parsed = JSON.parse(jsonStr);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  function containsServiceRoleKey(key) {
    if (typeof key !== 'string' || !key) return false;
    if (key.startsWith('sb_secret_')) return true;
    if (key.includes('service_role')) return true;
    const claims = decodeJwtPayload(key);
    return Boolean(claims && (claims.role === 'service_role' || claims.user_role === 'service_role'));
  }

  // Strict security check: NEVER accept a service-role key or secret key in client configuration
  if (containsServiceRoleKey(anonKey)) {
    const err = new SupabaseClientError(
      'SECURITY_VIOLATION: SUPABASE_SERVICE_ROLE_KEY or secret key cannot be used in browser client code.',
      403
    );
    err.code = 'SERVICE_ROLE_KEY_FORBIDDEN';
    throw err;
  }

  let activeSession = null;
  let pendingOAuthStateMemory = null;
  let sessionEpoch = 0;
  let refreshInFlight = null;
  const consumedOAuthCodes = new Set();
  const authListeners = new Set();

  function getSessionExpiresAtMs(session) {
    if (!session || typeof session !== 'object') return null;
    if (session.expires_at !== undefined && session.expires_at !== null) {
      if (typeof session.expires_at === 'number' && Number.isFinite(session.expires_at)) {
        return session.expires_at > 1e11 ? session.expires_at : session.expires_at * 1000;
      }
      if (typeof session.expires_at === 'string') {
        const numeric = Number(session.expires_at);
        if (Number.isFinite(numeric) && session.expires_at.trim() !== '') {
          return numeric > 1e11 ? numeric : numeric * 1000;
        }
        const parsedMs = Date.parse(session.expires_at);
        if (!Number.isNaN(parsedMs)) return parsedMs;
      }
    }
    const claims = decodeJwtPayload(session.access_token);
    if (claims && typeof claims.exp === 'number' && Number.isFinite(claims.exp)) {
      return claims.exp > 1e11 ? claims.exp : claims.exp * 1000;
    }
    return null;
  }

  function hasRefreshTokenRecord(session) {
    return Boolean(
      session &&
        typeof session === 'object' &&
        !Array.isArray(session) &&
        typeof session.refresh_token === 'string' &&
        session.refresh_token.trim().length > 0 &&
        session.user &&
        typeof session.user === 'object' &&
        typeof session.user.id === 'string' &&
        session.user.id.trim().length > 0
    );
  }

  function isSessionValid(session) {
    if (!session || typeof session !== 'object' || Array.isArray(session)) return false;
    if (typeof session.access_token !== 'string' || session.access_token.trim().length === 0) return false;
    if (!session.user || typeof session.user !== 'object' || typeof session.user.id !== 'string' || !session.user.id.trim()) {
      return false;
    }
    const expMs = getSessionExpiresAtMs(session);
    if (expMs !== null && nowFn() >= expMs) {
      return false;
    }
    return true;
  }

  function readRawStoredSession() {
    if (!storage) return null;
    try {
      const raw = storage.getItem(sessionKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      try {
        storage.removeItem(sessionKey);
      } catch {}
      return null;
    }
  }

  function loadStoredSession() {
    if (!storage) return null;
    const parsed = readRawStoredSession();
    if (!parsed) return null;
    if (isSessionValid(parsed)) {
      return parsed;
    }
    // Retain refreshable session in storage ONLY when a refresh_token is present so refreshSession() can recover it;
    // purge expired non-refreshable or corrupted sessions immediately.
    if (!hasRefreshTokenRecord(parsed)) {
      try {
        storage.removeItem(sessionKey);
      } catch {}
    }
    return null;
  }

  function saveSession(session) {
    if (session && !isSessionValid(session)) {
      activeSession = null;
      if (storage && !hasRefreshTokenRecord(session)) {
        try {
          storage.removeItem(sessionKey);
        } catch {}
      }
      return false;
    }
    activeSession = session || null;
    if (storage) {
      try {
        if (session) {
          storage.setItem(sessionKey, JSON.stringify(session));
        } else {
          storage.removeItem(sessionKey);
        }
      } catch {}
    }
    return Boolean(activeSession);
  }

  function savePendingOAuthState(stateObj) {
    pendingOAuthStateMemory = stateObj || null;
    if (storage) {
      try {
        if (stateObj) {
          storage.setItem(oauthStateKey, JSON.stringify(stateObj));
        } else {
          storage.removeItem(oauthStateKey);
        }
      } catch {}
    }
  }

  function loadPendingOAuthState() {
    if (storage) {
      try {
        const raw = storage.getItem(oauthStateKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed.state === 'string') {
            return parsed;
          }
        }
      } catch {}
    }
    return pendingOAuthStateMemory;
  }

  function generateNonce() {
    try {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID().replace(/-/g, '');
      }
    } catch {}
    return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
  }

  activeSession = loadStoredSession();

  function isConfigured() {
    return Boolean(url && anonKey && url.startsWith('http'));
  }

  function emitAuthEvent(event, session) {
    for (const listener of authListeners) {
      try {
        listener(event, session);
      } catch {}
    }
  }

  async function requestWithTimeout(endpoint, options = {}, timeoutMs = defaultTimeoutMs) {
    if (!fetchApi) {
      throw new SupabaseClientError('Fetch API unavailable in this environment.', 503);
    }

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

    try {
      const res = await fetchApi(endpoint, {
        ...options,
        signal: controller ? controller.signal : undefined
      });
      return res;
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new SupabaseClientError(`Request to ${endpoint} timed out after ${timeoutMs}ms.`, 504);
      }
      throw err;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  function getStandardHeaders(extraHeaders = {}) {
    const headers = {
      apikey: anonKey,
      'Content-Type': 'application/json',
      ...extraHeaders
    };
    if (activeSession && isSessionValid(activeSession)) {
      headers.Authorization = `Bearer ${activeSession.access_token}`;
    } else {
      headers.Authorization = `Bearer ${anonKey}`;
    }
    return headers;
  }

  // --- Auth APIs ---
  const auth = {
    getSession() {
      if (storage) {
        const stored = loadStoredSession();
        if (!stored && activeSession) {
          // Session was cleared/expired in storage (e.g., another tab signed out or token expired)
          activeSession = null;
        } else if (stored && (!activeSession || stored.access_token !== activeSession.access_token)) {
          activeSession = stored;
        }
      }
      if (activeSession && !isSessionValid(activeSession)) {
        const keepForRefresh = hasRefreshTokenRecord(activeSession);
        activeSession = null;
        if (!keepForRefresh && storage) {
          try {
            storage.removeItem(sessionKey);
          } catch {}
        }
        emitAuthEvent('SIGNED_OUT', null);
        return null;
      }
      if (!activeSession) return null;
      const expMs = getSessionExpiresAtMs(activeSession);
      return Object.freeze({
        ...activeSession,
        expires_at_ms: expMs
      });
    },
    getUser() {
      const sess = this.getSession();
      return sess && sess.user ? Object.freeze({ ...sess.user }) : null;
    },
    hasRefreshableSession() {
      if (hasRefreshTokenRecord(activeSession)) return true;
      const raw = readRawStoredSession();
      return hasRefreshTokenRecord(raw);
    },
    async refreshSession() {
      if (!isConfigured()) {
        return { ok: false, error: 'SUPABASE_NOT_CONFIGURED' };
      }
      const candidate = hasRefreshTokenRecord(activeSession) ? activeSession : readRawStoredSession();
      if (!hasRefreshTokenRecord(candidate)) {
        return { ok: false, error: 'NO_REFRESH_TOKEN' };
      }
      if (refreshInFlight) {
        return refreshInFlight;
      }
      const opEpoch = sessionEpoch;
      refreshInFlight = (async () => {
        try {
          const res = await requestWithTimeout(`${url}/auth/v1/token?grant_type=refresh_token`, {
            method: 'POST',
            headers: {
              apikey: anonKey,
              'Content-Type': 'application/json',
              Authorization: `Bearer ${anonKey}`
            },
            body: JSON.stringify({ refresh_token: candidate.refresh_token })
          });
          let data = null;
          try {
            data = await res.json();
          } catch {}
          if (opEpoch !== sessionEpoch) {
            return { ok: false, stale: true, error: 'SESSION_SUPERSEDED' };
          }
          if (!res.ok) {
            if (res.status === 400 || res.status === 401 || res.status === 403) {
              // Revoked or expired refresh token: purge immediately and fail closed
              saveSession(null);
              emitAuthEvent('SIGNED_OUT', null);
              return {
                ok: false,
                retryable: false,
                error: data?.message || data?.error_description || 'REFRESH_TOKEN_INVALID'
              };
            }
            return {
              ok: false,
              retryable: true,
              error: data?.message || data?.error_description || `HTTP_${res.status}`
            };
          }
          if (!saveSession(data)) {
            saveSession(null);
            emitAuthEvent('SIGNED_OUT', null);
            return { ok: false, retryable: false, error: 'INVALID_OR_EXPIRED_SESSION' };
          }
          emitAuthEvent('TOKEN_REFRESHED', data);
          return { ok: true, user: data.user, session: data };
        } catch (err) {
          return { ok: false, retryable: true, error: err.message || 'NETWORK_ERROR' };
        } finally {
          refreshInFlight = null;
        }
      })();
      return refreshInFlight;
    },
    async signUp({ email, password, options = {} }) {
      if (!isConfigured()) {
        return { ok: false, error: 'SUPABASE_NOT_CONFIGURED' };
      }
      const opEpoch = sessionEpoch;
      try {
        const res = await requestWithTimeout(`${url}/auth/v1/signup`, {
          method: 'POST',
          headers: getStandardHeaders(),
          body: JSON.stringify({
            email,
            password,
            data: options.data || {}
          })
        });
        const data = await res.json();
        if (opEpoch !== sessionEpoch) {
          return { ok: false, stale: true, error: 'SESSION_SUPERSEDED' };
        }
        if (!res.ok) {
          return { ok: false, error: data.message || data.error_description || 'SIGNUP_FAILED' };
        }
        if (data.access_token) {
          if (!saveSession(data)) {
            return { ok: false, error: 'INVALID_OR_EXPIRED_SESSION' };
          }
          emitAuthEvent('SIGNED_IN', data);
        }
        return { ok: true, user: data.user, session: data };
      } catch (err) {
        return { ok: false, error: err.message || 'NETWORK_ERROR' };
      }
    },
    async signInWithPassword({ email, password }) {
      if (!isConfigured()) {
        return { ok: false, error: 'SUPABASE_NOT_CONFIGURED' };
      }
      const opEpoch = sessionEpoch;
      try {
        const res = await requestWithTimeout(`${url}/auth/v1/token?grant_type=password`, {
          method: 'POST',
          headers: getStandardHeaders(),
          body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (opEpoch !== sessionEpoch) {
          return { ok: false, stale: true, error: 'SESSION_SUPERSEDED' };
        }
        if (!res.ok) {
          return { ok: false, error: data.message || data.error_description || 'SIGNIN_FAILED' };
        }
        if (!saveSession(data)) {
          return { ok: false, error: 'INVALID_OR_EXPIRED_SESSION' };
        }
        emitAuthEvent('SIGNED_IN', data);
        return { ok: true, user: data.user, session: data };
      } catch (err) {
        return { ok: false, error: err.message || 'NETWORK_ERROR' };
      }
    },
    async signInWithOtp({ email, options = {} }) {
      if (!isConfigured()) {
        return { ok: false, error: 'SUPABASE_NOT_CONFIGURED' };
      }
      const normalizedEmail = typeof email === 'string' ? email.trim() : '';
      if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        return { ok: false, error: 'INVALID_EMAIL' };
      }
      try {
        const res = await requestWithTimeout(`${url}/auth/v1/otp`, {
          method: 'POST',
          headers: getStandardHeaders(),
          body: JSON.stringify({
            email: normalizedEmail,
            create_user: options.createUser ?? true,
            data: options.data || {}
          })
        });
        const data = await res.json();
        if (!res.ok) {
          return { ok: false, error: data.message || data.error_description || 'OTP_FAILED' };
        }
        return { ok: true, pendingVerification: true, message: 'OTP sent successfully.' };
      } catch (err) {
        return { ok: false, error: err.message || 'NETWORK_ERROR' };
      }
    },
    async verifyOtp({ email, token, type = 'email' }) {
      if (!isConfigured()) {
        return { ok: false, error: 'SUPABASE_NOT_CONFIGURED' };
      }
      const normalizedEmail = typeof email === 'string' ? email.trim() : '';
      const normalizedToken = typeof token === 'string' ? token.trim() : '';
      if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        return { ok: false, error: 'INVALID_EMAIL' };
      }
      if (!normalizedToken || normalizedToken.length < 4 || normalizedToken.length > 16) {
        return { ok: false, error: 'INVALID_OTP_TOKEN' };
      }
      const opEpoch = sessionEpoch;
      try {
        const res = await requestWithTimeout(`${url}/auth/v1/verify`, {
          method: 'POST',
          headers: getStandardHeaders(),
          body: JSON.stringify({
            email: normalizedEmail,
            token: normalizedToken,
            type: typeof type === 'string' && type.trim() ? type.trim() : 'email'
          })
        });
        const data = await res.json();
        if (opEpoch !== sessionEpoch) {
          return { ok: false, stale: true, error: 'SESSION_SUPERSEDED' };
        }
        if (!res.ok) {
          return { ok: false, error: data.message || data.error_description || 'OTP_VERIFICATION_FAILED' };
        }
        if (!saveSession(data)) {
          return { ok: false, error: 'INVALID_OR_EXPIRED_SESSION' };
        }
        emitAuthEvent('SIGNED_IN', data);
        return { ok: true, user: data.user, session: data };
      } catch (err) {
        return { ok: false, error: err.message || 'NETWORK_ERROR' };
      }
    },
    async signInWithOAuth({ provider = 'google', redirectTo = null, state = null } = {}) {
      if (!isConfigured()) {
        return { ok: false, error: 'SUPABASE_NOT_CONFIGURED' };
      }
      const normalizedProvider = typeof provider === 'string' ? provider.trim().toLowerCase() : '';
      if (normalizedProvider !== 'google') {
        return { ok: false, error: 'UNSUPPORTED_OAUTH_PROVIDER' };
      }
      let safeRedirect = null;
      if (redirectTo !== null && redirectTo !== undefined && redirectTo !== '') {
        try {
          const parsedRedirect = new URL(redirectTo);
          if (parsedRedirect.protocol !== 'http:' && parsedRedirect.protocol !== 'https:') {
            return { ok: false, error: 'INVALID_REDIRECT_URL' };
          }
          if (
            typeof globalThis.location !== 'undefined' &&
            globalThis.location &&
            globalThis.location.origin &&
            globalThis.location.origin !== 'null' &&
            parsedRedirect.origin !== globalThis.location.origin
          ) {
            return { ok: false, error: 'CROSS_ORIGIN_REDIRECT_FORBIDDEN' };
          }
          safeRedirect = parsedRedirect.toString();
        } catch {
          return { ok: false, error: 'INVALID_REDIRECT_URL' };
        }
      } else if (typeof globalThis.location !== 'undefined' && globalThis.location?.origin?.startsWith('http')) {
        safeRedirect = `${globalThis.location.origin}${globalThis.location.pathname || '/'}`;
      }

      const oauthState = typeof state === 'string' && state.trim() ? state.trim() : generateNonce();
      savePendingOAuthState({
        provider: normalizedProvider,
        state: oauthState,
        createdAt: nowFn()
      });

      const params = new URLSearchParams();
      params.set('provider', normalizedProvider);
      if (safeRedirect) params.set('redirect_to', safeRedirect);
      params.set('state', oauthState);
      const authUrl = `${url}/auth/v1/authorize?${params.toString()}`;
      return {
        ok: true,
        provider: normalizedProvider,
        url: authUrl,
        state: oauthState
      };
    },
    async handleOAuthCallback(callbackInput, options = {}) {
      if (!isConfigured()) {
        return { ok: false, error: 'SUPABASE_NOT_CONFIGURED' };
      }
      let params = new URLSearchParams();
      if (typeof callbackInput === 'string') {
        try {
          const parsedUrl = callbackInput.startsWith('http://') || callbackInput.startsWith('https://')
            ? new URL(callbackInput)
            : new URL(callbackInput, 'https://auromasti.invalid');
          const searchParams = new URLSearchParams(parsedUrl.search);
          const hashParams = new URLSearchParams((parsedUrl.hash || '').replace(/^#/, ''));
          for (const [k, v] of searchParams.entries()) params.set(k, v);
          for (const [k, v] of hashParams.entries()) {
            if (!params.has(k)) params.set(k, v);
          }
        } catch {
          return { ok: false, error: 'INVALID_CALLBACK_URL' };
        }
      } else if (callbackInput && typeof callbackInput === 'object') {
        for (const [k, v] of Object.entries(callbackInput)) {
          if (v !== undefined && v !== null) params.set(k, String(v));
        }
      } else {
        return { ok: false, error: 'INVALID_CALLBACK_INPUT' };
      }

      const oauthError = params.get('error');
      const oauthErrorDesc = params.get('error_description') || '';
      if (oauthError) {
        savePendingOAuthState(null);
        const cancelled = oauthError === 'access_denied' || oauthError === 'user_cancelled';
        return {
          ok: false,
          cancelled,
          error: cancelled ? 'OAUTH_CANCELLED' : oauthError,
          message: oauthErrorDesc || (cancelled ? 'Sign-in was cancelled.' : `OAuth error: ${oauthError}`)
        };
      }

      const code = params.get('code');
      const returnedState = params.get('state');
      if (!code) {
        return { ok: false, error: 'OAUTH_CODE_MISSING' };
      }

      // Replay / duplicate callback protection
      const replayKey = `${code}:${returnedState || ''}`;
      if (consumedOAuthCodes.has(replayKey)) {
        return { ok: false, duplicate: true, error: 'OAUTH_CALLBACK_DUPLICATE' };
      }

      // CSRF state validation (mandatory whenever a pending state was issued or expectedState passed)
      const pendingState = loadPendingOAuthState();
      const expectedState = options.expectedState || (pendingState ? pendingState.state : null);
      if (!expectedState || !returnedState || returnedState !== expectedState) {
        return { ok: false, error: 'OAUTH_STATE_MISMATCH' };
      }
      if (pendingState && pendingState.createdAt && nowFn() - pendingState.createdAt > 15 * 60 * 1000) {
        savePendingOAuthState(null);
        return { ok: false, error: 'OAUTH_STATE_EXPIRED' };
      }

      consumedOAuthCodes.add(replayKey);
      savePendingOAuthState(null);
      const opEpoch = sessionEpoch;

      try {
        const res = await requestWithTimeout(`${url}/auth/v1/token?grant_type=pkce`, {
          method: 'POST',
          headers: getStandardHeaders(),
          body: JSON.stringify({
            auth_code: code,
            code_verifier: options.codeVerifier || undefined
          })
        });
        const data = await res.json();
        if (opEpoch !== sessionEpoch) {
          return { ok: false, stale: true, error: 'SESSION_SUPERSEDED' };
        }
        if (!res.ok) {
          return { ok: false, error: data.message || data.error_description || 'OAUTH_EXCHANGE_FAILED' };
        }
        if (!saveSession(data)) {
          return { ok: false, error: 'INVALID_OR_EXPIRED_SESSION' };
        }
        emitAuthEvent('SIGNED_IN', data);
        return { ok: true, user: data.user, session: data };
      } catch (err) {
        return { ok: false, error: err.message || 'NETWORK_ERROR' };
      }
    },
    async resetPasswordForEmail(email, options = {}) {
      if (!isConfigured()) {
        return { ok: false, error: 'SUPABASE_NOT_CONFIGURED' };
      }
      try {
        const res = await requestWithTimeout(`${url}/auth/v1/recover`, {
          method: 'POST',
          headers: getStandardHeaders(),
          body: JSON.stringify({
            email,
            redirectTo: options.redirectTo
          })
        });
        const data = await res.json();
        if (!res.ok) {
          return { ok: false, error: data.message || 'PASSWORD_RESET_FAILED' };
        }
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err.message || 'NETWORK_ERROR' };
      }
    },
    async signOut() {
      sessionEpoch += 1;
      refreshInFlight = null;
      const tokenToRevoke = activeSession && isSessionValid(activeSession) ? activeSession.access_token : null;
      savePendingOAuthState(null);
      // Clear activeSession and persisted storage IMMEDIATELY before awaiting remote logout
      saveSession(null);
      emitAuthEvent('SIGNED_OUT', null);
      if (isConfigured() && tokenToRevoke) {
        try {
          await requestWithTimeout(`${url}/auth/v1/logout`, {
            method: 'POST',
            headers: {
              apikey: anonKey,
              'Content-Type': 'application/json',
              Authorization: `Bearer ${tokenToRevoke}`
            }
          });
        } catch {}
      }
      return { ok: true };
    },
    onAuthStateChange(listener) {
      if (typeof listener === 'function') {
        authListeners.add(listener);
        return () => authListeners.delete(listener);
      }
      return () => {};
    }
  };

  // --- Storage REST APIs (Bucket Object Operations) ---
  function normalizeStorageObjectPath(objectPath) {
    if (typeof objectPath !== 'string') return null;
    const trimmed = objectPath.trim();
    if (!trimmed || trimmed.startsWith('/') || trimmed.includes('\\') || /[\u0000-\u001f\u007f]/.test(trimmed)) {
      return null;
    }
    const segments = trimmed.split('/');
    if (segments.some((seg) => !seg || seg === '.' || seg === '..')) {
      return null;
    }
    return segments.join('/');
  }

  function encodeStoragePath(normalizedPath) {
    return normalizedPath.split('/').map((seg) => encodeURIComponent(seg)).join('/');
  }

  const storageApi = {
    from(bucketId) {
      const safeBucket = typeof bucketId === 'string' && /^[a-z0-9][a-z0-9_-]{0,62}$/.test(bucketId.trim())
        ? bucketId.trim()
        : null;

      function invalidBucketResult() {
        return { data: null, error: new SupabaseClientError('INVALID_STORAGE_BUCKET', 400) };
      }

      async function writeObject(method, objectPath, body, opts = {}) {
        if (!isConfigured()) {
          return { data: null, error: new SupabaseClientError('SUPABASE_NOT_CONFIGURED', 503) };
        }
        if (!safeBucket) return invalidBucketResult();
        const normPath = normalizeStorageObjectPath(objectPath);
        if (!normPath) {
          return { data: null, error: new SupabaseClientError('INVALID_OBJECT_PATH', 400) };
        }
        try {
          const headers = getStandardHeaders({
            'Content-Type': opts.contentType || 'application/octet-stream',
            'cache-control': String(opts.cacheControl ?? '3600')
          });
          if (method === 'POST' && opts.upsert === true) {
            headers['x-upsert'] = 'true';
          }
          const res = await requestWithTimeout(
            `${url}/storage/v1/object/${encodeURIComponent(safeBucket)}/${encodeStoragePath(normPath)}`,
            { method, headers, body }
          );
          let data = null;
          try {
            if (typeof res.json === 'function') data = await res.json();
          } catch {}
          if (!res.ok) {
            return {
              data: null,
              error: new SupabaseClientError(data?.message || data?.error || `HTTP ${res.status}`, res.status, data)
            };
          }
          return { data: data || { Key: `${safeBucket}/${normPath}`, path: normPath }, error: null };
        } catch (err) {
          return { data: null, error: err };
        }
      }

      return Object.freeze({
        upload(objectPath, body, opts = {}) {
          return writeObject('POST', objectPath, body, opts);
        },
        update(objectPath, body, opts = {}) {
          return writeObject('PUT', objectPath, body, opts);
        },
        async download(objectPath) {
          if (!isConfigured()) {
            return { data: null, error: new SupabaseClientError('SUPABASE_NOT_CONFIGURED', 503) };
          }
          if (!safeBucket) return invalidBucketResult();
          const normPath = normalizeStorageObjectPath(objectPath);
          if (!normPath) {
            return { data: null, error: new SupabaseClientError('INVALID_OBJECT_PATH', 400) };
          }
          try {
            const headers = getStandardHeaders();
            delete headers['Content-Type'];
            const res = await requestWithTimeout(
              `${url}/storage/v1/object/authenticated/${encodeURIComponent(safeBucket)}/${encodeStoragePath(normPath)}`,
              { method: 'GET', headers }
            );
            if (!res.ok) {
              let errBody = null;
              try {
                if (typeof res.json === 'function') errBody = await res.json();
              } catch {}
              return {
                data: null,
                error: new SupabaseClientError(errBody?.message || `HTTP ${res.status}`, res.status, errBody)
              };
            }
            const bytes = typeof res.arrayBuffer === 'function'
              ? new Uint8Array(await res.arrayBuffer())
              : (typeof res.json === 'function' ? await res.json() : null);
            return { data: bytes, error: null };
          } catch (err) {
            return { data: null, error: err };
          }
        },
        async createSignedUrl(objectPath, expiresInSeconds = 300) {
          if (!isConfigured()) {
            return { data: null, error: new SupabaseClientError('SUPABASE_NOT_CONFIGURED', 503) };
          }
          if (!safeBucket) return invalidBucketResult();
          const normPath = normalizeStorageObjectPath(objectPath);
          if (!normPath) {
            return { data: null, error: new SupabaseClientError('INVALID_OBJECT_PATH', 400) };
          }
          const boundedExpires = Math.max(1, Math.min(3600, Math.floor(Number(expiresInSeconds) || 300)));
          try {
            const res = await requestWithTimeout(
              `${url}/storage/v1/object/sign/${encodeURIComponent(safeBucket)}/${encodeStoragePath(normPath)}`,
              {
                method: 'POST',
                headers: getStandardHeaders(),
                body: JSON.stringify({ expiresIn: boundedExpires })
              }
            );
            let data = null;
            try {
              if (typeof res.json === 'function') data = await res.json();
            } catch {}
            if (!res.ok) {
              return {
                data: null,
                error: new SupabaseClientError(data?.message || `HTTP ${res.status}`, res.status, data)
              };
            }
            const signedPath = data?.signedURL || data?.signedUrl || null;
            const signedUrl = signedPath
              ? (signedPath.startsWith('http') ? signedPath : `${url}/storage/v1${signedPath.startsWith('/') ? '' : '/'}${signedPath}`)
              : null;
            return { data: { signedUrl }, error: null };
          } catch (err) {
            return { data: null, error: err };
          }
        },
        async remove(paths = []) {
          if (!isConfigured()) {
            return { data: null, error: new SupabaseClientError('SUPABASE_NOT_CONFIGURED', 503) };
          }
          if (!safeBucket) return invalidBucketResult();
          const rawList = Array.isArray(paths) ? paths : [paths];
          const normalized = [];
          for (const p of rawList) {
            const norm = normalizeStorageObjectPath(p);
            if (!norm) {
              return { data: null, error: new SupabaseClientError('INVALID_OBJECT_PATH', 400) };
            }
            normalized.push(norm);
          }
          if (normalized.length === 0) {
            return { data: [], error: null };
          }
          try {
            const res = await requestWithTimeout(
              `${url}/storage/v1/object/${encodeURIComponent(safeBucket)}`,
              {
                method: 'DELETE',
                headers: getStandardHeaders(),
                body: JSON.stringify({ prefixes: normalized })
              }
            );
            let data = null;
            try {
              if (typeof res.json === 'function') data = await res.json();
            } catch {}
            if (!res.ok && res.status !== 404) {
              return {
                data: null,
                error: new SupabaseClientError(data?.message || `HTTP ${res.status}`, res.status, data)
              };
            }
            return { data: data || normalized.map((name) => ({ name })), error: null, status: res.status };
          } catch (err) {
            return { data: null, error: err };
          }
        },
        async list(prefix = '', opts = {}) {
          if (!isConfigured()) {
            return { data: null, error: new SupabaseClientError('SUPABASE_NOT_CONFIGURED', 503) };
          }
          if (!safeBucket) return invalidBucketResult();
          const normPrefix = prefix === '' ? '' : normalizeStorageObjectPath(prefix);
          if (prefix !== '' && !normPrefix) {
            return { data: null, error: new SupabaseClientError('INVALID_OBJECT_PATH', 400) };
          }
          try {
            const res = await requestWithTimeout(
              `${url}/storage/v1/object/list/${encodeURIComponent(safeBucket)}`,
              {
                method: 'POST',
                headers: getStandardHeaders(),
                body: JSON.stringify({
                  prefix: normPrefix,
                  limit: Math.max(1, Math.min(1000, Number(opts.limit) || 100)),
                  offset: Math.max(0, Number(opts.offset) || 0)
                })
              }
            );
            let data = null;
            try {
              if (typeof res.json === 'function') data = await res.json();
            } catch {}
            if (!res.ok) {
              return {
                data: null,
                error: new SupabaseClientError(data?.message || `HTTP ${res.status}`, res.status, data)
              };
            }
            return { data: Array.isArray(data) ? data : [], error: null };
          } catch (err) {
            return { data: null, error: err };
          }
        }
      });
    }
  };

  // --- Database / REST Query Builder ---
  function from(table) {
    return new QueryBuilder(table, url, getStandardHeaders, requestWithTimeout);
  }

  // --- RPC function caller ---
  async function rpc(functionName, params = {}) {
    if (!isConfigured()) {
      return { data: null, error: new SupabaseClientError('SUPABASE_NOT_CONFIGURED', 503) };
    }
    try {
      const res = await requestWithTimeout(`${url}/rest/v1/rpc/${functionName}`, {
        method: 'POST',
        headers: getStandardHeaders(),
        body: JSON.stringify(params)
      });
      const data = await res.json();
      if (!res.ok) {
        return { data: null, error: new SupabaseClientError(data.message || 'RPC_FAILED', res.status, data) };
      }
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err };
    }
  }

  // --- Edge Functions caller ---
  const functions = {
    async invoke(functionName, options = {}) {
      if (!isConfigured()) {
        return { data: null, error: new SupabaseClientError('SUPABASE_NOT_CONFIGURED', 503) };
      }
      try {
        const method = (options.method || 'POST').toUpperCase();
        const headers = {
          ...getStandardHeaders(),
          ...(options.headers || {})
        };
        const body = options.body !== undefined
          ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body))
          : undefined;

        const res = await requestWithTimeout(`${url}/functions/v1/${functionName}`, {
          method,
          headers,
          body
        });

        let data = null;
        const contentType = res.headers && typeof res.headers.get === 'function' ? res.headers.get('content-type') : '';
        try {
          if (contentType && contentType.includes('application/json')) {
            data = await res.json();
          } else if (typeof res.json === 'function') {
            data = await res.json();
          } else if (typeof res.text === 'function') {
            const text = await res.text();
            try {
              data = JSON.parse(text);
            } catch {
              data = text;
            }
          }
        } catch {
          data = null;
        }

        if (!res.ok) {
          const errMsg = (data && (data.error || data.message)) || `Edge function returned ${res.status}`;
          return { data: null, error: new SupabaseClientError(errMsg, res.status, data) };
        }
        return { data, error: null };
      } catch (err) {
        return { data: null, error: err };
      }
    }
  };

  // --- Health status ---
  async function checkHealth() {
    if (!isConfigured()) {
      return { ok: false, configured: false, online: false };
    }
    const start = Date.now();
    try {
      const res = await requestWithTimeout(`${url}/rest/v1/`, {
        method: 'GET',
        headers: { apikey: anonKey }
      }, 3000);
      const latencyMs = Date.now() - start;
      return {
        ok: res.status < 500,
        configured: true,
        online: true,
        status: res.status,
        latencyMs
      };
    } catch (err) {
      return {
        ok: false,
        configured: true,
        online: false,
        error: err.message
      };
    }
  }

  return Object.freeze({
    url,
    anonKey,
    publishableKey: anonKey,
    getUrl: () => url,
    getSupabaseUrl: () => url,
    isConfigured,
    auth,
    from,
    rpc,
    functions,
    storage: storageApi,
    checkHealth,
    requestWithTimeout,
    getStandardHeaders
  });
}

class QueryBuilder {
  constructor(table, baseUrl, getHeaders, requestWithTimeout) {
    this.table = table;
    this.baseUrl = baseUrl;
    this.getHeaders = getHeaders;
    this.requestWithTimeout = requestWithTimeout;
    this.queryParams = [];
    this.method = 'GET';
    this.body = null;
    this.headers = {};
    this.isSingle = false;
    this.isMaybeSingle = false;
  }

  select(columns = '*') {
    this.method = 'GET';
    this.queryParams.push(`select=${encodeURIComponent(columns)}`);
    return this;
  }

  insert(data, options = {}) {
    this.method = 'POST';
    this.body = data;
    if (options.upsert) {
      this.headers['Prefer'] = 'resolution=merge-duplicates';
    }
    return this;
  }

  upsert(data, options = {}) {
    this.method = 'POST';
    this.body = data;
    const onConflict = options.onConflict ? `&on_conflict=${encodeURIComponent(options.onConflict)}` : '';
    this.headers['Prefer'] = options.ignoreDuplicates
      ? 'resolution=ignore-duplicates'
      : 'resolution=merge-duplicates';
    if (onConflict) {
      this.queryParams.push(onConflict.slice(1));
    }
    return this;
  }

  update(data) {
    this.method = 'PATCH';
    this.body = data;
    return this;
  }

  delete() {
    this.method = 'DELETE';
    return this;
  }

  eq(column, value) {
    this.queryParams.push(`${encodeURIComponent(column)}=eq.${encodeURIComponent(value)}`);
    return this;
  }

  order(column, { ascending = true } = {}) {
    this.queryParams.push(`order=${encodeURIComponent(column)}.${ascending ? 'asc' : 'desc'}`);
    return this;
  }

  limit(count) {
    this.queryParams.push(`limit=${count}`);
    return this;
  }

  single() {
    this.isSingle = true;
    this.headers['Accept'] = 'application/vnd.pgrst.object+json';
    return this;
  }

  maybeSingle() {
    this.isMaybeSingle = true;
    this.limit(1);
    return this;
  }

  async execute() {
    const qs = this.queryParams.length > 0 ? `?${this.queryParams.join('&')}` : '';
    const endpoint = `${this.baseUrl}/rest/v1/${this.table}${qs}`;

    try {
      const res = await this.requestWithTimeout(endpoint, {
        method: this.method,
        headers: this.getHeaders(this.headers),
        body: this.body ? JSON.stringify(this.body) : undefined
      });

      if (!res.ok) {
        let errBody = null;
        try {
          errBody = await res.json();
        } catch {}
        return {
          data: null,
          error: new SupabaseClientError(errBody?.message || `HTTP ${res.status}`, res.status, errBody)
        };
      }

      if (res.status === 204) {
        return { data: null, error: null };
      }

      const data = await res.json();
      if (this.isMaybeSingle && Array.isArray(data)) {
        return { data: data[0] || null, error: null };
      }
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err };
    }
  }

  then(onFulfilled, onRejected) {
    return this.execute().then(onFulfilled, onRejected);
  }
}
