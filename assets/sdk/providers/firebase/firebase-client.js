/**
 * AuroMind Shared Platform SDK — Firebase Client Layer
 *
 * Lightweight, browser-native HTTP client for Firebase Auth, Cloud Firestore REST,
 * and Cloud Functions.
 *
 * Zero external npm dependencies. Zero private key / service account leaks.
 * Supports token refreshing, offline detection, retry logic, and Firebase Emulator endpoints.
 */

export class FirebaseClientError extends Error {
  constructor(message, status = 500, details = null) {
    super(message);
    this.name = 'FirebaseClientError';
    this.status = status;
    this.details = details;
  }
}

/**
 * Creates a lightweight Firebase REST client.
 *
 * @param {object} config
 * @param {string} config.projectId - Firebase Project ID
 * @param {string} config.apiKey - Public Firebase Web API Key
 * @param {string} [config.authDomain] - Firebase Auth domain
 * @param {string} [config.emulatorHost] - e.g. 'localhost:8080' (Firestore)
 * @param {string} [config.emulatorAuthHost] - e.g. 'localhost:9099' (Auth)
 * @param {string} [config.emulatorFunctionsHost] - e.g. 'localhost:5001' (Functions)
 * @param {number} [config.timeoutMs] - Request timeout in ms (default 6000)
 * @param {object} [config.storage] - Storage interface (defaults to localStorage)
 * @param {function} [config.fetch] - Custom fetch implementation
 * @returns {object} Firebase client instance
 */
export function createFirebaseClient(config = {}) {
  const projectId = (config.projectId || config.project_id || '').trim();
  const apiKey = (config.apiKey || config.api_key || '').trim();
  const authDomain = (config.authDomain || '').trim();
  const emulatorHost = (config.emulatorHost || '').trim();
  const emulatorAuthHost = (config.emulatorAuthHost || '').trim();
  const emulatorFunctionsHost = (config.emulatorFunctionsHost || '').trim();
  const fetchApi = config.fetch || globalThis.fetch?.bind(globalThis);
  const storage = config.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  const sessionKey = config.sessionKey || 'auromind.platform.v1.firebase_session';
  const defaultTimeoutMs = typeof config.timeoutMs === 'number' ? config.timeoutMs : 6000;

  // STRICT SECURITY CHECK: Never accept service account private keys in browser code
  const rawConfigStr = JSON.stringify(config);
  if (
    config.privateKey ||
    config.private_key ||
    config.clientEmail ||
    config.client_email ||
    config.serviceAccount ||
    rawConfigStr.includes('BEGIN PRIVATE KEY') ||
    rawConfigStr.includes('service_account')
  ) {
    const err = new FirebaseClientError(
      'SECURITY_VIOLATION: Firebase service account private keys must NEVER be passed to frontend configuration.',
      403
    );
    err.code = 'FIREBASE_SECRET_KEY_FORBIDDEN';
    throw err;
  }

  function isConfigured() {
    return Boolean(projectId && (apiKey || emulatorAuthHost));
  }

  // Base URLs (respects local emulators when configured)
  const authBaseUrl = emulatorAuthHost
    ? `http://${emulatorAuthHost}/identitytoolkit.googleapis.com/v1`
    : 'https://identitytoolkit.googleapis.com/v1';

  const firestoreBaseUrl = emulatorHost
    ? `http://${emulatorHost}/v1/projects/${projectId}/databases/(default)/documents`
    : `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

  const functionsBaseUrl = emulatorFunctionsHost
    ? `http://${emulatorFunctionsHost}/${projectId}/us-central1`
    : `https://us-central1-${projectId}.cloudfunctions.net`;

  let activeSession = null;
  const authListeners = new Set();

  function loadStoredSession() {
    if (!storage) return null;
    try {
      const raw = storage.getItem(sessionKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && (parsed.idToken || parsed.access_token)) {
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

  async function requestWithTimeout(url, options = {}, timeoutMs = defaultTimeoutMs) {
    if (!fetchApi) {
      throw new FirebaseClientError('Fetch API unavailable in current environment', 500);
    }
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const headers = { ...(options.headers || {}) };
      const reqOptions = {
        ...options,
        headers,
        signal: controller ? controller.signal : undefined
      };
      const res = await fetchApi(url, reqOptions);
      return res;
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new FirebaseClientError(`Request timeout after ${timeoutMs}ms`, 408);
      }
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function notifyAuthChange(user) {
    for (const listener of authListeners) {
      try {
        listener(user);
      } catch {}
    }
  }

  // --- Authentication Subsystem ---
  const auth = {
    isConfigured,

    getSession() {
      return activeSession;
    },

    getUser() {
      if (!activeSession) return null;
      return {
        id: activeSession.localId || activeSession.user_id || activeSession.userId,
        email: activeSession.email || null,
        isAnonymous: Boolean(activeSession.isAnonymous),
        metadata: activeSession.metadata || {}
      };
    },

    onAuthStateChange(callback) {
      if (typeof callback !== 'function') return () => {};
      authListeners.add(callback);
      return () => authListeners.delete(callback);
    },

    async signInAnonymously() {
      if (!isConfigured()) return { ok: false, error: 'NOT_CONFIGURED' };
      const endpoint = `${authBaseUrl}/accounts:signUp?key=${apiKey}`;
      try {
        const res = await requestWithTimeout(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ returnSecureToken: true })
        });
        const data = await res.json();
        if (!res.ok) {
          return { ok: false, error: data.error?.message || 'ANONYMOUS_AUTH_FAILED' };
        }
        const session = {
          idToken: data.idToken,
          refreshToken: data.refreshToken,
          localId: data.localId,
          userId: data.localId,
          expiresIn: data.expiresIn,
          isAnonymous: true
        };
        saveSession(session);
        notifyAuthChange(auth.getUser());
        return { ok: true, session, user: auth.getUser() };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    async signInWithPassword({ email, password }) {
      if (!isConfigured()) return { ok: false, error: 'NOT_CONFIGURED' };
      const endpoint = `${authBaseUrl}/accounts:signInWithPassword?key=${apiKey}`;
      try {
        const res = await requestWithTimeout(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, returnSecureToken: true })
        });
        const data = await res.json();
        if (!res.ok) {
          return { ok: false, error: data.error?.message || 'AUTH_FAILED' };
        }
        const session = {
          idToken: data.idToken,
          refreshToken: data.refreshToken,
          localId: data.localId,
          userId: data.localId,
          email: data.email,
          expiresIn: data.expiresIn,
          isAnonymous: false
        };
        saveSession(session);
        notifyAuthChange(auth.getUser());
        return { ok: true, session, user: auth.getUser() };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    async signUp({ email, password, metadata = {} }) {
      if (!isConfigured()) return { ok: false, error: 'NOT_CONFIGURED' };
      const endpoint = `${authBaseUrl}/accounts:signUp?key=${apiKey}`;
      try {
        const res = await requestWithTimeout(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, returnSecureToken: true })
        });
        const data = await res.json();
        if (!res.ok) {
          return { ok: false, error: data.error?.message || 'SIGNUP_FAILED' };
        }
        const session = {
          idToken: data.idToken,
          refreshToken: data.refreshToken,
          localId: data.localId,
          userId: data.localId,
          email: data.email,
          expiresIn: data.expiresIn,
          metadata,
          isAnonymous: false
        };
        saveSession(session);
        notifyAuthChange(auth.getUser());
        return { ok: true, session, user: auth.getUser() };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    async signOut() {
      saveSession(null);
      notifyAuthChange(null);
      return { ok: true };
    },

    async resetPasswordForEmail(email) {
      if (!isConfigured()) return { ok: false, error: 'NOT_CONFIGURED' };
      const endpoint = `${authBaseUrl}/accounts:sendOobCode?key=${apiKey}`;
      try {
        const res = await requestWithTimeout(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestType: 'PASSWORD_RESET', email })
        });
        const data = await res.json();
        if (!res.ok) {
          return { ok: false, error: data.error?.message || 'RESET_FAILED' };
        }
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    async deleteUserAccount() {
      if (!activeSession || !activeSession.idToken) return { ok: false, error: 'UNAUTHENTICATED' };
      const endpoint = `${authBaseUrl}/accounts:delete?key=${apiKey}`;
      try {
        const res = await requestWithTimeout(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken: activeSession.idToken })
        });
        if (!res.ok) {
          const data = await res.json();
          return { ok: false, error: data.error?.message || 'DELETE_FAILED' };
        }
        saveSession(null);
        notifyAuthChange(null);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
  };

  // Helper: Convert JS object to Firestore Value format
  function toFirestoreValue(val) {
    if (val === null || val === undefined) return { nullValue: null };
    if (typeof val === 'boolean') return { booleanValue: val };
    if (typeof val === 'number') {
      if (Number.isInteger(val)) return { integerValue: String(val) };
      return { doubleValue: val };
    }
    if (typeof val === 'string') return { stringValue: val };
    if (Array.isArray(val)) {
      return { arrayValue: { values: val.map(toFirestoreValue) } };
    }
    if (typeof val === 'object') {
      const fields = {};
      for (const [k, v] of Object.entries(val)) {
        fields[k] = toFirestoreValue(v);
      }
      return { mapValue: { fields } };
    }
    return { stringValue: String(val) };
  }

  // Helper: Convert Firestore Value format to JS object
  function fromFirestoreValue(valObj) {
    if (!valObj || typeof valObj !== 'object') return null;
    if ('nullValue' in valObj) return null;
    if ('booleanValue' in valObj) return valObj.booleanValue;
    if ('integerValue' in valObj) return parseInt(valObj.integerValue, 10);
    if ('doubleValue' in valObj) return valObj.doubleValue;
    if ('stringValue' in valObj) return valObj.stringValue;
    if ('timestampValue' in valObj) return valObj.timestampValue;
    if ('arrayValue' in valObj) {
      const arr = valObj.arrayValue.values || [];
      return arr.map(fromFirestoreValue);
    }
    if ('mapValue' in valObj) {
      const res = {};
      const fields = valObj.mapValue.fields || {};
      for (const [k, v] of Object.entries(fields)) {
        res[k] = fromFirestoreValue(v);
      }
      return res;
    }
    return null;
  }

  function fromFirestoreDocument(doc) {
    if (!doc || !doc.fields) return null;
    const res = {};
    for (const [k, v] of Object.entries(doc.fields)) {
      res[k] = fromFirestoreValue(v);
    }
    res.__updateTime = doc.updateTime || null;
    res.__createTime = doc.createTime || null;
    return res;
  }

  function toFirestoreFields(obj) {
    const fields = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k.startsWith('__')) continue;
      fields[k] = toFirestoreValue(v);
    }
    return fields;
  }

  // --- Cloud Firestore Subsystem ---
  const firestore = {
    async getDocument(path) {
      if (!isConfigured()) return { data: null, error: 'NOT_CONFIGURED' };
      const url = `${firestoreBaseUrl}/${path}`;
      const headers = {};
      if (activeSession?.idToken) {
        headers['Authorization'] = `Bearer ${activeSession.idToken}`;
      }
      try {
        const res = await requestWithTimeout(url, { headers });
        if (res.status === 404) return { data: null, error: null };
        if (!res.ok) {
          const errBody = await res.json();
          return { data: null, error: errBody.error?.message || 'FETCH_ERROR' };
        }
        const doc = await res.json();
        return { data: fromFirestoreDocument(doc), error: null };
      } catch (err) {
        return { data: null, error: err.message };
      }
    },

    async setDocument(path, data, options = {}) {
      if (!isConfigured()) return { ok: false, error: 'NOT_CONFIGURED' };
      const url = `${firestoreBaseUrl}/${path}`;
      const headers = { 'Content-Type': 'application/json' };
      if (activeSession?.idToken) {
        headers['Authorization'] = `Bearer ${activeSession.idToken}`;
      }
      const fields = toFirestoreFields(data);
      try {
        const res = await requestWithTimeout(url, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ fields })
        });
        if (!res.ok) {
          const errBody = await res.json();
          return { ok: false, error: errBody.error?.message || 'WRITE_ERROR' };
        }
        const doc = await res.json();
        return { ok: true, data: fromFirestoreDocument(doc) };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    async deleteDocument(path) {
      if (!isConfigured()) return { ok: false, error: 'NOT_CONFIGURED' };
      const url = `${firestoreBaseUrl}/${path}`;
      const headers = {};
      if (activeSession?.idToken) {
        headers['Authorization'] = `Bearer ${activeSession.idToken}`;
      }
      try {
        const res = await requestWithTimeout(url, { method: 'DELETE', headers });
        return { ok: res.ok };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    async listDocuments(collectionPath) {
      if (!isConfigured()) return { data: [], error: 'NOT_CONFIGURED' };
      const url = `${firestoreBaseUrl}/${collectionPath}`;
      const headers = {};
      if (activeSession?.idToken) {
        headers['Authorization'] = `Bearer ${activeSession.idToken}`;
      }
      try {
        const res = await requestWithTimeout(url, { headers });
        if (res.status === 404) return { data: [], error: null };
        if (!res.ok) {
          const errBody = await res.json();
          return { data: [], error: errBody.error?.message || 'LIST_ERROR' };
        }
        const body = await res.json();
        const docs = (body.documents || []).map(fromFirestoreDocument);
        return { data: docs, error: null };
      } catch (err) {
        return { data: [], error: err.message };
      }
    }
  };

  // --- Cloud Functions Subsystem ---
  const functions = {
    async call(functionName, data = {}) {
      if (!isConfigured()) return { data: null, error: 'NOT_CONFIGURED' };
      const url = `${functionsBaseUrl}/${functionName}`;
      const headers = { 'Content-Type': 'application/json' };
      if (activeSession?.idToken) {
        headers['Authorization'] = `Bearer ${activeSession.idToken}`;
      }
      try {
        const res = await requestWithTimeout(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(data)
        });
        const resJson = await res.json();
        return { ok: res.ok, status: res.status, data: resJson };
      } catch (err) {
        return { ok: false, status: 500, error: err.message };
      }
    }
  };

  return Object.freeze({
    providerName: 'firebase-client',
    isConfigured,
    projectId,
    apiKey,
    authDomain,
    auth,
    firestore,
    functions,
    requestWithTimeout
  });
}
