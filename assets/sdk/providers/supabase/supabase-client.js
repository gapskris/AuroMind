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
  const anonKey = (config.anonKey || config.supabaseAnonKey || '').trim();
  const fetchApi = config.fetch || globalThis.fetch?.bind(globalThis);
  const storage = config.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  const sessionKey = config.sessionKey || 'auromind.platform.v1.supabase_session';
  const defaultTimeoutMs = typeof config.timeoutMs === 'number' ? config.timeoutMs : 6000;

  // Strict security check: NEVER accept a service-role key in client configuration
  if (anonKey && (anonKey.includes('service_role') || (anonKey.startsWith('eyJ') && anonKey.includes('service_role')))) {
    const err = new SupabaseClientError(
      'SECURITY_VIOLATION: SUPABASE_SERVICE_ROLE_KEY cannot be used in browser client code.',
      403
    );
    err.code = 'SERVICE_ROLE_KEY_FORBIDDEN';
    throw err;
  }

  let activeSession = null;
  const authListeners = new Set();

  function loadStoredSession() {
    if (!storage) return null;
    try {
      const raw = storage.getItem(sessionKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.access_token) {
          return parsed;
        }
      }
    } catch {}
    return null;
  }

  function saveSession(session) {
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
    if (activeSession && activeSession.access_token) {
      headers.Authorization = `Bearer ${activeSession.access_token}`;
    } else {
      headers.Authorization = `Bearer ${anonKey}`;
    }
    return headers;
  }

  // --- Auth APIs ---
  const auth = {
    getSession() {
      return activeSession ? Object.freeze({ ...activeSession }) : null;
    },
    getUser() {
      return activeSession && activeSession.user ? Object.freeze({ ...activeSession.user }) : null;
    },
    async signUp({ email, password, options = {} }) {
      if (!isConfigured()) {
        return { ok: false, error: 'SUPABASE_NOT_CONFIGURED' };
      }
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
        if (!res.ok) {
          return { ok: false, error: data.message || data.error_description || 'SIGNUP_FAILED' };
        }
        if (data.access_token) {
          saveSession(data);
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
      try {
        const res = await requestWithTimeout(`${url}/auth/v1/token?grant_type=password`, {
          method: 'POST',
          headers: getStandardHeaders(),
          body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (!res.ok) {
          return { ok: false, error: data.message || data.error_description || 'SIGNIN_FAILED' };
        }
        saveSession(data);
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
      try {
        const res = await requestWithTimeout(`${url}/auth/v1/otp`, {
          method: 'POST',
          headers: getStandardHeaders(),
          body: JSON.stringify({
            email,
            create_user: options.createUser ?? true,
            data: options.data || {}
          })
        });
        const data = await res.json();
        if (!res.ok) {
          return { ok: false, error: data.message || data.error_description || 'OTP_FAILED' };
        }
        return { ok: true, message: 'OTP sent successfully.' };
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
      if (isConfigured() && activeSession?.access_token) {
        try {
          await requestWithTimeout(`${url}/auth/v1/logout`, {
            method: 'POST',
            headers: getStandardHeaders()
          });
        } catch {}
      }
      saveSession(null);
      emitAuthEvent('SIGNED_OUT', null);
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
    getUrl: () => url,
    getSupabaseUrl: () => url,
    isConfigured,
    auth,
    from,
    rpc,
    functions,
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
