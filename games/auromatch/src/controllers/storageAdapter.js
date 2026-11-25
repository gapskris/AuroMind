// Cryptographic Storage & Local-First Adapter
const DB_NAME = 'AuroMatchDB';
const STORE_NAME = 'gameState';
const DB_VERSION = 1;

let dbPromise = null;
let isClosedByRemote = false;
const pendingDualWriteKeys = new Map();

export function resetIndexedDBConnection() {
    isClosedByRemote = false;
    dbPromise = null;
    pendingDualWriteKeys.clear();
}

export function mergeUniqueItems(baseItems = [], incomingItems = []) {
    const seen = new Set();
    const merged = [];
    for (const list of [baseItems, incomingItems]) {
        if (!Array.isArray(list)) continue;
        for (const item of list) {
            if (item === null || item === undefined) continue;
            let key;
            if (typeof item === 'object') {
                const stableId = item.id || item.tileId || item.floraId || item.key || item.timestamp;
                key = stableId ? `obj:${String(stableId)}` : `json:${JSON.stringify(item)}`;
            } else {
                key = `prim:${typeof item}:${String(item)}`;
            }
            if (!seen.has(key)) {
                seen.add(key);
                merged.push(item);
            }
        }
    }
    return merged;
}

export function mergeAuroMatchUserRecords(localUser = null, incomingUser = null) {
    if (!localUser || typeof localUser !== 'object') return incomingUser ? JSON.parse(JSON.stringify(incomingUser)) : null;
    if (!incomingUser || typeof incomingUser !== 'object') return JSON.parse(JSON.stringify(localUser));

    const localProg = localUser.progression || {};
    const incProg = incomingUser.progression || {};
    const mergedIds = mergeUniqueItems(localProg.completedLevelIds || [], incProg.completedLevelIds || []);
    const mergedThemes = mergeUniqueItems(localProg.unlockedThemes || [], incProg.unlockedThemes || []);
    const completedLevelsCount = Math.max(
        Number(localProg.completedLevelsCount || 0),
        Number(incProg.completedLevelsCount || 0),
        mergedIds.length
    );

    const localProf = localUser.profile || {};
    const incProf = incomingUser.profile || {};

    return {
        ...localUser,
        ...incomingUser,
        profile: {
            ...localProf,
            ...incProf,
            lotusPetalCount: Math.max(Number(localProf.lotusPetalCount || 0), Number(incProf.lotusPetalCount || 0)),
            consciousnessPoints: Math.max(Number(localProf.consciousnessPoints || 0), Number(incProf.consciousnessPoints || 0)),
            createdTimestamp: Math.min(
                Number(localProf.createdTimestamp || Date.now()),
                Number(incProf.createdTimestamp || Date.now())
            ),
            lastLaunchTimestamp: Math.max(
                Number(localProf.lastLaunchTimestamp || 0),
                Number(incProf.lastLaunchTimestamp || 0)
            )
        },
        progression: {
            ...localProg,
            ...incProg,
            completedLevelsCount,
            unlockedThemes: mergedThemes,
            completedLevelIds: mergedIds
        },
        settings: {
            ...(localUser.settings || {}),
            ...(incomingUser.settings || {})
        },
        dailyDrawDate:
            String(localUser.dailyDrawDate || '') >= String(incomingUser.dailyDrawDate || '')
                ? (localUser.dailyDrawDate || '')
                : (incomingUser.dailyDrawDate || '')
    };
}

function tryParseJson(raw) {
    if (typeof raw !== 'string') {
        if (raw && typeof raw === 'object') return { ok: true, value: raw };
        return { ok: false, value: null };
    }
    try {
        return { ok: true, value: JSON.parse(raw) };
    } catch {
        return { ok: false, value: null };
    }
}

async function writeToIndexedDBOnce(key, serialized) {
    const db = await initIndexedDB();
    if (!db) {
        return { ok: false, unavailable: true, error: 'IDB_UNAVAILABLE' };
    }
    await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(serialized, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction error'));
        tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
    });
    return { ok: true, unavailable: false, error: null };
}

async function writeToIndexedDBWithRetry(key, serialized, { maxRetries = 2, retryDelayMs = 10 } = {}) {
    let attempts = 0;
    let lastError = null;
    const totalAttempts = Math.max(1, maxRetries + 1);

    for (let i = 0; i < totalAttempts; i++) {
        attempts += 1;
        try {
            const res = await writeToIndexedDBOnce(key, serialized);
            if (res.ok) {
                return { ok: true, attempts, unavailable: false, error: null };
            }
            lastError = res.error || 'IDB_UNAVAILABLE';
            if (res.unavailable) {
                return { ok: false, attempts, unavailable: true, error: lastError };
            }
        } catch (err) {
            lastError = err && err.message ? err.message : String(err);
        }
        if (i + 1 < totalAttempts && retryDelayMs > 0) {
            await new Promise((r) => setTimeout(r, retryDelayMs));
        }
    }

    return { ok: false, attempts, unavailable: false, error: lastError };
}

export function getDualWriteStatus(key = null) {
    if (key !== null && key !== undefined) {
        const pending = pendingDualWriteKeys.get(key) || null;
        return {
            key,
            inSync: !pending,
            pendingRepair: Boolean(pending),
            lsOk: pending ? pending.lsOk : true,
            idbOk: pending ? pending.idbOk : true,
            lastError: pending ? pending.lastError : null,
            attempts: pending ? pending.attempts : 0
        };
    }
    const entries = Array.from(pendingDualWriteKeys.entries()).map(([k, v]) => ({
        key: k,
        lsOk: v.lsOk,
        idbOk: v.idbOk,
        lastError: v.lastError,
        attempts: v.attempts,
        updatedAt: v.updatedAt
    }));
    return {
        inSync: entries.length === 0,
        pendingCount: entries.length,
        pendingKeys: entries
    };
}

export async function setItemDualWrite(key, value, options = {}) {
    if (isPurgeActive()) {
        console.warn(`[Storage] setItemDualWrite blocked for ${key}: Purge is active.`);
        return { ok: false, blockedByPurge: true, lsOk: false, idbOk: false, partialFailure: false, attempts: 0 };
    }
    const serialized = (typeof value === 'string') ? value : JSON.stringify(value);
    const maxRetries = typeof options.maxRetries === 'number' ? options.maxRetries : 2;
    const retryDelayMs = typeof options.retryDelayMs === 'number' ? options.retryDelayMs : 10;

    // 1. Synchronous mirror in localStorage for instantaneous UI access
    let lsOk = false;
    let lsError = null;
    if (typeof localStorage !== 'undefined') {
        try {
            localStorage.setItem(key, serialized);
            lsOk = true;
        } catch (e) {
            lsError = e && e.message ? e.message : String(e);
            console.warn('[Storage] localStorage setItem error:', e);
        }
    }

    // 2. Durable IndexedDB write with bounded retry
    const idbRes = await writeToIndexedDBWithRetry(key, serialized, { maxRetries, retryDelayMs });
    const idbOk = idbRes.ok;

    if (lsOk && idbOk) {
        pendingDualWriteKeys.delete(key);
        return {
            ok: true,
            lsOk: true,
            idbOk: true,
            partialFailure: false,
            pendingRepair: false,
            attempts: idbRes.attempts,
            error: null
        };
    }

    const partialFailure = lsOk !== idbOk || (!lsOk && !idbOk);
    const error = idbRes.error || lsError || 'DUAL_WRITE_INCOMPLETE';

    const activeOwner = options?.accountScope || _activeScope || null;

    // Track divergence so getItemAsync() never serves stale secondary data and reconcileDualWriteParity() can heal it
    if (lsOk || idbOk) {
        pendingDualWriteKeys.set(key, {
            serialized,
            lsOk,
            idbOk,
            ownerId: activeOwner,
            lastError: error,
            attempts: idbRes.attempts,
            updatedAt: Date.now()
        });
    } else {
        pendingDualWriteKeys.set(key, {
            serialized,
            lsOk: false,
            idbOk: false,
            ownerId: activeOwner,
            lastError: error,
            attempts: idbRes.attempts,
            updatedAt: Date.now()
        });
    }

    if (!idbOk && !idbRes.unavailable) {
        console.warn('[Storage] IndexedDB setItem error after retries:', error);
    }

    return {
        ok: lsOk || idbOk,
        lsOk,
        idbOk,
        partialFailure,
        pendingRepair: true,
        attempts: idbRes.attempts,
        error
    };
}

export async function reconcileDualWriteParity(options = {}) {
    if (isPurgeActive()) {
        return { reconciled: 0, remaining: pendingDualWriteKeys.size, details: [] };
    }
    const maxRetries = typeof options.maxRetries === 'number' ? options.maxRetries : 2;
    const retryDelayMs = typeof options.retryDelayMs === 'number' ? options.retryDelayMs : 5;
    const targetScope = options?.accountScope || _activeScope || null;
    let reconciled = 0;
    const details = [];

    for (const [key, entry] of Array.from(pendingDualWriteKeys.entries())) {
        if (entry.ownerId && targetScope && entry.ownerId !== targetScope) {
            continue;
        }
        let lsOk = entry.lsOk;
        let idbOk = entry.idbOk;
        let payloadToWrite = entry.serialized;

        if (!lsOk && typeof localStorage !== 'undefined') {
            try {
                localStorage.setItem(key, payloadToWrite);
                lsOk = true;
            } catch (e) {
                entry.lastError = e?.message || String(e);
            }
        } else if (lsOk && typeof localStorage !== 'undefined') {
            try {
                const latestLocal = localStorage.getItem(key);
                if (latestLocal !== null) payloadToWrite = latestLocal;
            } catch {}
        }

        if (!idbOk) {
            const idbRes = await writeToIndexedDBWithRetry(key, payloadToWrite, { maxRetries, retryDelayMs });
            idbOk = idbRes.ok;
            if (!idbOk) entry.lastError = idbRes.error;
        }

        if (lsOk && idbOk) {
            pendingDualWriteKeys.delete(key);
            reconciled += 1;
            details.push({ key, status: 'reconciled' });
        } else {
            pendingDualWriteKeys.set(key, {
                ...entry,
                serialized: payloadToWrite,
                lsOk,
                idbOk,
                updatedAt: Date.now()
            });
            details.push({ key, status: 'pending', error: entry.lastError });
        }
    }

    return {
        reconciled,
        remaining: pendingDualWriteKeys.size,
        details
    };
}

export function initIndexedDB() {
    if (typeof window === 'undefined' && typeof globalThis.indexedDB === 'undefined') {
        return Promise.resolve(null);
    }
    const idb = (typeof window !== 'undefined' && window.indexedDB) ? window.indexedDB : globalThis.indexedDB;
    if (!idb) return Promise.resolve(null);
    if (isClosedByRemote) return Promise.resolve(null);

    if (!dbPromise) {
        dbPromise = new Promise((resolve) => {
            try {
                const req = idb.open(DB_NAME, DB_VERSION);
                req.onupgradeneeded = (e) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains(STORE_NAME)) {
                        db.createObjectStore(STORE_NAME);
                    }
                };
                req.onsuccess = (e) => {
                    const db = e.target.result;
                    db.onversionchange = () => {
                        console.warn('[Storage] AuroMatchDB versionchange/deletion requested by another context. Closing connection.');
                        try { db.close(); } catch (err) {}
                        isClosedByRemote = true;
                        dbPromise = Promise.resolve(null);
                    };
                    resolve(db);
                };
                req.onerror = () => resolve(null);
                req.onblocked = () => resolve(null);
            } catch (err) {
                resolve(null);
            }
        });
    }
    return dbPromise;
}

export async function setItemAsync(key, value) {
    const result = await setItemDualWrite(key, value);
    return Boolean(result && result.ok);
}

export async function getItemAsync(key) {
    // 0. Read-after-write consistency guard: if IndexedDB write failed for this key,
    // NEVER serve stale IndexedDB data — read fresh localStorage and opportunistically repair IDB.
    const pending = pendingDualWriteKeys.get(key);
    if (pending && pending.lsOk && !pending.idbOk) {
        let freshVal = pending.serialized;
        if (typeof localStorage !== 'undefined') {
            try {
                const lsVal = localStorage.getItem(key);
                if (lsVal !== null && lsVal !== undefined) freshVal = lsVal;
            } catch {}
        }
        try {
            const repair = await writeToIndexedDBWithRetry(key, freshVal, { maxRetries: 1, retryDelayMs: 0 });
            if (repair.ok) {
                pendingDualWriteKeys.delete(key);
            }
        } catch {}
        return freshVal;
    }

    // 1. Try IndexedDB primary vault
    let idbVal = undefined;
    try {
        const db = await initIndexedDB();
        if (db) {
            idbVal = await new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_NAME, 'readonly');
                const req = tx.objectStore(STORE_NAME).get(key);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
        }
    } catch (err) {}

    if (idbVal !== undefined && idbVal !== null) {
        return idbVal;
    }

    // 2. Fallback to localStorage
    if (typeof localStorage !== 'undefined') {
        try {
            return localStorage.getItem(key);
        } catch (e) {}
    }
    return null;
}

export function isValidAuroMatchState(raw) {
    if (!raw || typeof raw !== 'string') return false;
    const trimmed = raw.trim();
    if (!trimmed || trimmed === '{}' || trimmed === 'null' || trimmed === 'undefined') {
        return false;
    }
    try {
        const parsed = JSON.parse(trimmed);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return false;
        }
        // Legitimate new-player saves (empty arrays) or existing progress
        if (
            Array.isArray(parsed.completedLevels) ||
            Array.isArray(parsed.completedLevelIds) ||
            parsed.progression ||
            parsed.profile ||
            typeof parsed.currentLevel !== 'undefined' ||
            parsed.isEmpty === true
        ) {
            return true;
        }
        const keys = Object.keys(parsed);
        return keys.length > 0 && !keys.every((k) => parsed[k] === null || parsed[k] === undefined);
    } catch {
        return false;
    }
}

let _activeScope = null;
let _scopeGeneration = 0;

export function getActiveScope() {
    return _activeScope;
}

export function getScopeGeneration() {
    return _scopeGeneration;
}

export function setAccountScope(scope, options = {}) {
    const nextScope = scope ? String(scope) : null;
    const force = Boolean(options && options.force);
    if (_activeScope !== nextScope || force) {
        _activeScope = nextScope;
        _scopeGeneration++;

        // Isolate pending dual-write entries from foreign scopes
        if (typeof pendingDualWriteKeys !== 'undefined') {
            for (const [k, v] of Array.from(pendingDualWriteKeys.entries())) {
                if (v && v.ownerId && v.ownerId !== _activeScope) {
                    pendingDualWriteKeys.delete(k);
                }
            }
        }

        if (_activeScope) {
            loadProfileState({ accountScope: _activeScope });
            if (profileState && profileState.ownerId === _activeScope && (profileState.progression?.completedLevelsCount > 0 || profileState.profile?.lotusPetalCount > 0)) {
                syncWorkingCacheFromProfileState(_activeScope);
            }
        } else {
            profileState = createFreshProfileState(null);
            clearSharedWorkingCache();
        }
    }
}

export function syncWorkingCacheFromProfileState(activeScope) {
    if (typeof localStorage === 'undefined') return;
    try {
        const rawWorking = localStorage.getItem('auro_match_user');
        const parsedWorking = tryParseJson(rawWorking);
        const existingOwner = getRecordOwnerId(parsedWorking.value);
        if (existingOwner && existingOwner !== activeScope) {
            const hasProgress = Boolean(
                profileState &&
                (profileState.progression?.completedLevelsCount > 0 || profileState.profile?.lotusPetalCount > 0)
            );
            if (!hasProgress) return;
        }

        const userObj = {
            profile: profileState.profile,
            progression: profileState.progression,
            settings: profileState.settings,
            dailyDrawDate: profileState.dailyDrawDate,
            ownerId: activeScope || profileState.profile?.ownerId || null
        };
        localStorage.setItem('auro_match_user', JSON.stringify(userObj));
        localStorage.setItem('auro_match_consecrations', JSON.stringify(profileState.reflections || []));
        localStorage.setItem('auro_match_unlocked_tiles', JSON.stringify(profileState.progression?.completedLevelIds || []));
    } catch {}
}

export function clearSharedWorkingCache() {
    if (typeof localStorage === 'undefined') return;
    try {
        localStorage.removeItem('auro_match_user');
        localStorage.removeItem('auro_match_consecrations');
        localStorage.removeItem('auro_match_unlocked_tiles');
    } catch {}
}

export function resolveAccountScope(context) {
    if (!context) return null;
    if (typeof context === 'string') return context;
    if (typeof context.accountScope === 'string') return context.accountScope;
    if (typeof context.expectedUserId === 'string') return context.expectedUserId;
    if (typeof context.userId === 'string') return context.userId;
    if (typeof context.getIdentity === 'function') {
        try {
            const id = context.getIdentity();
            if (id?.mode === 'authenticated' && id?.account?.userId) return String(id.account.userId);
            if (id?.account?.accountId) return String(id.account.accountId);
            if (id?.account?.id) return String(id.account.id);
            if (id?.guestId) return String(id.guestId);
        } catch {}
    }
    if (typeof context.getGuestId === 'function') {
        try {
            const gid = context.getGuestId();
            if (gid) return String(gid);
        } catch {}
    }
    if (context.guestId) return String(context.guestId);
    return null;
}

export function getRecordOwnerId(record) {
    if (!record || typeof record !== 'object') return null;
    const raw = record.ownerId || record.profile?.ownerId || record.profile?.platformGuestId || record.userId || null;
    if (typeof raw === 'string' && raw.trim().length > 0) {
        return raw.trim();
    }
    return null;
}

export function createFreshProfileState(ownerId = null) {
    return {
        profile: {
            createdTimestamp: Date.now(),
            lastLaunchTimestamp: Date.now(),
            sanctuaryMode: "traditional",
            themePreference: "auto",
            voiceTonePreference: "french_cadence",
            lotusPetalCount: 0,
            consciousnessPoints: 0,
            ownerId: ownerId || null,
            platformGuestId: (ownerId && ownerId.startsWith('guest_')) ? ownerId : null
        },
        progression: {
            completedLevelsCount: 0,
            unlockedThemes: ["flowers", "qualities"],
            completedLevelIds: []
        },
        settings: {
            volumeRaga: 0.40,
            volumeGong: 0.60,
            speechRate: 0.70,
            speechPitch: 0.95,
            secularToggle: false,
            experienceMode: "gk_quest",
            seniorViewActive: false
        },
        reflections: [],
        dailyDrawDate: "",
        ownerId: ownerId || null
    };
}

export async function autoHealFromIndexedDB(scopedContext = null) {
    if (isPurgeActive()) {
        console.warn('[Storage] autoHealFromIndexedDB blocked: Purge is active.');
        return false;
    }
    if (typeof localStorage === 'undefined') return false;
    const idb = (typeof window !== 'undefined' && window.indexedDB) ? window.indexedDB : globalThis.indexedDB;
    if (!idb) return false;

    const activeScope = resolveAccountScope(scopedContext) || getActiveScope();
    const isAuthenticated = Boolean(activeScope && !activeScope.startsWith('guest_'));

    try {
        const db = await initIndexedDB();
        if (!db) return false;

        const baseKeys = [
            'auromatch_player_state',
            'auromatch_player_profiles',
            'auromatch_standard_theme',
            'auromatch_has_entered_sanctuary',
            'auro_match_user',
            'auro_match_consecrations',
            'auro_match_unlocked_tiles',
            'auro_match_teachings'
        ];

        // 1. Resolve local working state & ownership
        const rawLocalUser = activeScope
            ? (isAuthenticated
                ? localStorage.getItem(`auro_match_user:${activeScope}`)
                : (localStorage.getItem(`auro_match_user:${activeScope}`) || localStorage.getItem('auro_match_user')))
            : localStorage.getItem('auro_match_user');
        const parsedLocalUser = tryParseJson(rawLocalUser);
        const localOwner = getRecordOwnerId(parsedLocalUser.value);
        const isForeignLocal = Boolean(activeScope && localOwner && localOwner !== activeScope);

        // 2. Query IndexedDB for user record ownership
        let idbUserVal = null;
        let isFromScopedKey = false;
        try {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            if (activeScope) {
                idbUserVal = await new Promise((resolve) => {
                    const req = store.get(`auro_match_user:${activeScope}`);
                    req.onsuccess = () => resolve(req.result !== undefined ? req.result : null);
                    req.onerror = () => resolve(null);
                });
                if (idbUserVal !== null) {
                    isFromScopedKey = true;
                }
            }
            if (idbUserVal === null && !isAuthenticated) {
                idbUserVal = await new Promise((resolve) => {
                    const req = store.get('auro_match_user');
                    req.onsuccess = () => resolve(req.result !== undefined ? req.result : null);
                    req.onerror = () => resolve(null);
                });
            }
        } catch {
            return false;
        }

        const parsedIdbUser = tryParseJson(idbUserVal);
        const idbOwner = getRecordOwnerId(parsedIdbUser.value);

        // Fail closed for authenticated accounts:
        // Must have a verified user record in IDB matching activeScope.
        // Missing, unowned, malformed, or foreign records fail closed!
        if (isAuthenticated) {
            if (!idbOwner || idbOwner !== activeScope) {
                console.warn(`[Storage] autoHealFromIndexedDB: Authenticated account "${activeScope}" cannot hydrate unowned or foreign IDB records (idbOwner="${idbOwner}"). Rejecting.`);
                return false;
            }
        } else if (activeScope) {
            if (idbOwner && idbOwner !== activeScope) {
                console.warn(`[Storage] autoHealFromIndexedDB: IDB record belongs to "${idbOwner}", not guest "${activeScope}". Rejecting.`);
                return false;
            }
        }

        // 3. Determine if local state is healthy for activeScope
        let localState = localStorage.getItem(activeScope ? `auromatch_player_state:${activeScope}` : 'auromatch_player_state');
        let localUser = localStorage.getItem(activeScope ? `auro_match_user:${activeScope}` : 'auro_match_user');

        if (!localUser && !isForeignLocal && rawLocalUser && !isAuthenticated) {
            localUser = rawLocalUser;
        }

        const stateHealthy = isValidAuroMatchState(localState);
        const userHealthy = isValidAuroMatchState(localUser);
        const hasHealthyLocal = (stateHealthy || userHealthy) && !isForeignLocal;

        if (hasHealthyLocal) {
            let idbHealedCount = 0;
            let localHealedFromIdb = false;
            for (const key of baseKeys) {
                const scopedKey = activeScope ? `${key}:${activeScope}` : key;
                let localVal = activeScope ? localStorage.getItem(scopedKey) : localStorage.getItem(key);
                if (localVal === null && !isForeignLocal && (!isAuthenticated || localOwner === activeScope)) {
                    localVal = localStorage.getItem(key);
                }

                // Query IDB strictly: for authenticated accounts, ONLY read scopedKey!
                // Unscoped legacy keys in IDB cannot be read or merged unless key is a verified record with owner matching activeScope.
                const idbVal = await new Promise((resolve) => {
                    try {
                        const tx = db.transaction(STORE_NAME, 'readonly');
                        const store = tx.objectStore(STORE_NAME);
                        const req = store.get(scopedKey);
                        req.onsuccess = () => {
                            if (req.result !== undefined && req.result !== null) {
                                resolve(req.result);
                            } else if (!isAuthenticated && activeScope) {
                                try {
                                    const req2 = store.get(key);
                                    req2.onsuccess = () => resolve(req2.result !== undefined ? req2.result : null);
                                    req2.onerror = () => resolve(null);
                                } catch {
                                    resolve(null);
                                }
                            } else {
                                resolve(null);
                            }
                        };
                        req.onerror = () => resolve(null);
                    } catch {
                        resolve(null);
                    }
                });

                const idbStr = idbVal === null || idbVal === undefined
                    ? null
                    : (typeof idbVal === 'string' ? idbVal : JSON.stringify(idbVal));

                if (localVal === null || localVal === undefined) {
                    if (idbStr !== null) {
                        if (activeScope) localStorage.setItem(scopedKey, idbStr);
                        if (!isAuthenticated || localOwner === activeScope) localStorage.setItem(key, idbStr);
                        localHealedFromIdb = true;
                    }
                    continue;
                }

                if (idbStr === null) {
                    if (activeScope) await setItemDualWrite(scopedKey, localVal, { accountScope: activeScope });
                    if (!isAuthenticated) await setItemDualWrite(key, localVal);
                    idbHealedCount++;
                    continue;
                }

                if (idbStr !== localVal) {
                    if (key === 'auro_match_unlocked_tiles' || key === 'auro_match_consecrations') {
                        const pLocal = tryParseJson(localVal);
                        const pIdb = tryParseJson(idbStr);
                        if (pLocal.ok && Array.isArray(pLocal.value) && pIdb.ok && Array.isArray(pIdb.value)) {
                            const mergedArr = mergeUniqueItems(pLocal.value, pIdb.value);
                            const mergedStr = JSON.stringify(mergedArr);
                            if (mergedStr !== localVal) localHealedFromIdb = true;
                            if (activeScope) await setItemDualWrite(scopedKey, mergedArr, { accountScope: activeScope });
                            if (!isAuthenticated) await setItemDualWrite(key, mergedArr);
                            idbHealedCount++;
                            continue;
                        }
                    } else if (key === 'auro_match_user') {
                        const pLocal = tryParseJson(localVal);
                        const pIdb = tryParseJson(idbStr);
                        if (pLocal.ok && pLocal.value && typeof pLocal.value === 'object' &&
                            pIdb.ok && pIdb.value && typeof pIdb.value === 'object') {
                            const mergedUser = mergeAuroMatchUserRecords(pLocal.value, pIdb.value);
                            if (activeScope) mergedUser.ownerId = activeScope;
                            const mergedStr = JSON.stringify(mergedUser);
                            if (mergedStr !== localVal) localHealedFromIdb = true;
                            if (activeScope) await setItemDualWrite(scopedKey, mergedUser, { accountScope: activeScope });
                            if (!isAuthenticated) await setItemDualWrite(key, mergedUser);
                            idbHealedCount++;
                            continue;
                        }
                    }

                    if (activeScope) await setItemDualWrite(scopedKey, localVal, { accountScope: activeScope });
                    if (!isAuthenticated) await setItemDualWrite(key, localVal);
                    idbHealedCount++;
                }
            }
            if (idbHealedCount > 0) {
                console.info(`[Storage] Bidirectional auto-heal: reconciled ${idbHealedCount} records between localStorage and IndexedDB.`);
            }
            if (localHealedFromIdb) {
                loadProfileState({ accountScope: activeScope });
            }
            return localHealedFromIdb;
        }

        // Local state is empty or foreign: restore cleanly from IDB for activeScope
        let restoredCount = 0;
        for (const key of baseKeys) {
            const scopedKey = activeScope ? `${key}:${activeScope}` : key;
            const val = await new Promise((resolve) => {
                try {
                    const tx = db.transaction(STORE_NAME, 'readonly');
                    const store = tx.objectStore(STORE_NAME);
                    const req = store.get(scopedKey);
                    req.onsuccess = () => {
                        if (req.result !== undefined && req.result !== null) {
                            resolve(req.result);
                        } else if (!isAuthenticated && activeScope) {
                            try {
                                const req2 = store.get(key);
                                req2.onsuccess = () => resolve(req2.result !== undefined ? req2.result : null);
                                req2.onerror = () => resolve(null);
                            } catch {
                                resolve(null);
                            }
                        } else {
                            resolve(null);
                        }
                    };
                    req.onerror = () => resolve(null);
                } catch {
                    resolve(null);
                }
            });

            if (val !== null && val !== undefined) {
                const strVal = typeof val === 'string' ? val : JSON.stringify(val);
                if (activeScope) localStorage.setItem(scopedKey, strVal);
                if (!isAuthenticated) localStorage.setItem(key, strVal);
                restoredCount++;
            }
        }

        if (restoredCount > 0) {
            console.info(`[Storage] Auto-healed ${restoredCount} records from AuroMatchDB into localStorage.`);
            loadProfileState({ accountScope: activeScope });
            return true;
        }
    } catch (e) {
        console.warn('[Storage] autoHealFromIndexedDB exception:', e);
    }
    return false;
}

let _isPurgeActive = false;

export function isPurgeActive() {
    if (_isPurgeActive) return true;
    try {
        if (typeof localStorage !== 'undefined') {
            return localStorage.getItem('auromatch_purge_in_progress') === 'true';
        }
    } catch (e) {}
    return false;
}

export function setPurgeLock(active) {
    _isPurgeActive = Boolean(active);
    try {
        if (typeof localStorage !== 'undefined') {
            if (active) {
                localStorage.setItem('auromatch_purge_in_progress', 'true');
            } else {
                localStorage.removeItem('auromatch_purge_in_progress');
            }
        }
    } catch (e) {}
}

export let profileState = {
    profile: {
        createdTimestamp: Date.now(),
        lastLaunchTimestamp: Date.now(),
        sanctuaryMode: "traditional",
        themePreference: "auto",
        voiceTonePreference: "french_cadence",
        lotusPetalCount: 0,
        consciousnessPoints: 0
    },
    progression: {
        completedLevelsCount: 0,
        unlockedThemes: ["flowers", "qualities"],
        completedLevelIds: []
    },
    settings: {
        volumeRaga: 0.40,
        volumeGong: 0.60,
        speechRate: 0.70,
        speechPitch: 0.95,
        secularToggle: false,
        experienceMode: "gk_quest", // "gk_quest" (V1) or "ashram_sanctuary" (V2)
        seniorViewActive: false
    },
    reflections: [],
    dailyDrawDate: ""
};

export function saveProfileState(options = {}) {
    if (isPurgeActive()) {
        console.warn('[Storage] saveProfileState blocked: Purge is active.');
        return false;
    }
    const skipLocalMerge = options && options.skipLocalMerge === true;
    const currentScope = (options && options.accountScope) || _activeScope;
    const isAuthenticated = Boolean(currentScope && !currentScope.startsWith('guest_'));

    if (currentScope) {
        profileState.ownerId = currentScope;
        if (profileState.profile) profileState.profile.ownerId = currentScope;
    }

    if (typeof localStorage !== 'undefined') {
        if (!skipLocalMerge) {
            // Fresh-Read-Before-Merge:
            // For authenticated accounts, ONLY read from authoritative scoped keys!
            // Never merge unowned shared arrays into an authenticated profile!
            try {
                let freshUser = null;
                let freshConsecrations = null;
                let freshUnlocked = null;

                if (isAuthenticated) {
                    freshUser = localStorage.getItem(`auro_match_user:${currentScope}`);
                    freshConsecrations = localStorage.getItem(`auro_match_consecrations:${currentScope}`);
                    freshUnlocked = localStorage.getItem(`auro_match_unlocked_tiles:${currentScope}`);
                } else {
                    const rawShared = localStorage.getItem('auro_match_user');
                    const parsed = tryParseJson(rawShared);
                    const localOwner = getRecordOwnerId(parsed.value);
                    if (!currentScope || !localOwner || localOwner === currentScope) {
                        freshUser = rawShared;
                        freshConsecrations = localStorage.getItem('auro_match_consecrations');
                        freshUnlocked = localStorage.getItem('auro_match_unlocked_tiles');
                    }
                }

                if (freshConsecrations) {
                    const parsed = JSON.parse(freshConsecrations);
                    if (Array.isArray(parsed)) {
                        profileState.reflections = mergeUniqueItems(parsed, profileState.reflections);
                    }
                }
                if (freshUnlocked) {
                    const parsed = JSON.parse(freshUnlocked);
                    if (Array.isArray(parsed)) {
                        profileState.progression.completedLevelIds = mergeUniqueItems(
                            parsed,
                            profileState.progression.completedLevelIds
                        );
                    }
                }
                if (freshUser) {
                    const parsed = JSON.parse(freshUser);
                    if (parsed && typeof parsed === 'object') {
                        if (parsed.progression) {
                            if (Array.isArray(parsed.progression.completedLevelIds)) {
                                profileState.progression.completedLevelIds = mergeUniqueItems(
                                    parsed.progression.completedLevelIds,
                                    profileState.progression.completedLevelIds
                                );
                            }
                            profileState.progression.completedLevelsCount = Math.max(
                                Number(parsed.progression.completedLevelsCount || 0),
                                Number(profileState.progression.completedLevelsCount || 0),
                                profileState.progression.completedLevelIds.length
                            );
                            if (Array.isArray(parsed.progression.unlockedThemes)) {
                                profileState.progression.unlockedThemes = mergeUniqueItems(
                                    profileState.progression.unlockedThemes,
                                    parsed.progression.unlockedThemes
                                );
                            }
                        }
                        if (parsed.profile && profileState.profile) {
                            profileState.profile.lotusPetalCount = Math.max(
                                Number(parsed.profile.lotusPetalCount || 0),
                                Number(profileState.profile.lotusPetalCount || 0)
                            );
                            profileState.profile.consciousnessPoints = Math.max(
                                Number(parsed.profile.consciousnessPoints || 0),
                                Number(profileState.profile.consciousnessPoints || 0)
                            );
                        }
                    }
                }
            } catch (e) {}
        }

        // Deduplicate own arrays even on cold writes
        profileState.reflections = mergeUniqueItems(profileState.reflections, []);
        profileState.progression.completedLevelIds = mergeUniqueItems(profileState.progression.completedLevelIds, []);
        profileState.progression.completedLevelsCount = Math.max(
            Number(profileState.progression.completedLevelsCount || 0),
            profileState.progression.completedLevelIds.length
        );

        const userObj = {
            profile: profileState.profile,
            progression: profileState.progression,
            settings: profileState.settings,
            dailyDrawDate: profileState.dailyDrawDate,
            ownerId: currentScope || profileState.profile?.ownerId || null
        };

        const serializedUser = JSON.stringify(userObj);
        const serializedCons = JSON.stringify(profileState.reflections);
        const serializedTiles = JSON.stringify(profileState.progression.completedLevelIds);

        // 1. Authoritative account-scoped keys in localStorage and IndexedDB
        if (currentScope) {
            localStorage.setItem(`auro_match_user:${currentScope}`, serializedUser);
            localStorage.setItem(`auro_match_consecrations:${currentScope}`, serializedCons);
            localStorage.setItem(`auro_match_unlocked_tiles:${currentScope}`, serializedTiles);

            setItemAsync(`auro_match_user:${currentScope}`, userObj);
            setItemAsync(`auro_match_consecrations:${currentScope}`, profileState.reflections);
            setItemAsync(`auro_match_unlocked_tiles:${currentScope}`, profileState.progression.completedLevelIds);
        }

        // 2. Working cache in localStorage for active in-game UI
        // Only mirror to working cache if currentScope matches the active UI scope
        if (!currentScope || getActiveScope() === currentScope) {
            localStorage.setItem('auro_match_user', serializedUser);
            localStorage.setItem('auro_match_consecrations', serializedCons);
            localStorage.setItem('auro_match_unlocked_tiles', serializedTiles);
        }

        // 3. In IndexedDB: ONLY write unscoped keys for unauthenticated guest mode!
        // Authenticated accounts NEVER write to shared unscoped keys in IndexedDB.
        if (!isAuthenticated) {
            setItemAsync('auro_match_user', userObj);
            setItemAsync('auro_match_consecrations', profileState.reflections);
            setItemAsync('auro_match_unlocked_tiles', profileState.progression.completedLevelIds);
        }

        return true;
    }
    return false;
}

export function loadProfileState(options = {}) {
    const currentScope = (options && options.accountScope) || _activeScope;
    const isAuthenticated = Boolean(currentScope && !currentScope.startsWith('guest_'));
    let userData = null;
    let consecrationsData = null;
    let unlockedData = null;
    let isValidUserRecord = false;

    if (typeof localStorage !== 'undefined') {
        try {
            if (currentScope) {
                const rawScopedUser = localStorage.getItem(`auro_match_user:${currentScope}`);
                if (rawScopedUser) {
                    const parsed = tryParseJson(rawScopedUser);
                    if (parsed.ok && parsed.value && typeof parsed.value === 'object' && !Array.isArray(parsed.value)) {
                        const embeddedOwner = getRecordOwnerId(parsed.value);
                        if (isAuthenticated) {
                            // Strict validation for authenticated accounts:
                            // Embedded owner must be a valid non-empty string exactly matching currentScope!
                            // Reject missing, malformed, non-string, whitespace and foreign metadata.
                            if (embeddedOwner && embeddedOwner === currentScope) {
                                userData = parsed.value;
                                isValidUserRecord = true;
                                consecrationsData = localStorage.getItem(`auro_match_consecrations:${currentScope}`);
                                unlockedData = localStorage.getItem(`auro_match_unlocked_tiles:${currentScope}`);
                            } else {
                                console.warn(`[Storage] loadProfileState: Scoped user record in "auro_match_user:${currentScope}" failed ownership validation (owner="${embeddedOwner}"). Failing closed.`);
                            }
                        } else {
                            // Guest mode
                            if (!embeddedOwner || embeddedOwner === currentScope) {
                                userData = parsed.value;
                                isValidUserRecord = true;
                                consecrationsData = localStorage.getItem(`auro_match_consecrations:${currentScope}`);
                                unlockedData = localStorage.getItem(`auro_match_unlocked_tiles:${currentScope}`);
                            }
                        }
                    }
                }
            }

            // Shared working cache fallback: ONLY permitted for unauthenticated guest mode!
            // Authenticated accounts MUST NEVER load from shared unscoped storage.
            if (!isValidUserRecord && !isAuthenticated) {
                const rawWorking = localStorage.getItem('auro_match_user');
                if (rawWorking) {
                    const parsed = tryParseJson(rawWorking);
                    if (parsed.ok && parsed.value && typeof parsed.value === 'object' && !Array.isArray(parsed.value)) {
                        const owner = getRecordOwnerId(parsed.value);
                        if (!currentScope || !owner || owner === currentScope) {
                            userData = parsed.value;
                            isValidUserRecord = true;
                            consecrationsData = localStorage.getItem('auro_match_consecrations');
                            unlockedData = localStorage.getItem('auro_match_unlocked_tiles');
                        }
                    }
                }
            }
        } catch {
            // LocalStorage read error fails closed to fresh profile
            isValidUserRecord = false;
        }
    }

    // Legacy fallback (only for unauthenticated guest mode)
    const legacyData = (typeof localStorage !== 'undefined') ? localStorage.getItem('auro_match_profile') : null;
    if (legacyData && !isValidUserRecord && !currentScope && !isAuthenticated) {
        try {
            const parsedLegacy = JSON.parse(legacyData);
            profileState = parsedLegacy;
            saveProfileState();
            localStorage.removeItem('auro_match_profile');
            return profileState;
        } catch(e) {}
    }

    if (!isValidUserRecord) {
        // Scoped or shared user record failed validation or not found: reset to fresh profile state!
        // Do NOT retain stale in-memory state or load foreign reflections / unlocked tiles!
        profileState = createFreshProfileState(currentScope);
        return profileState;
    }

    if (userData && isValidUserRecord) {
        profileState.profile = userData.profile || createFreshProfileState(currentScope).profile;
        profileState.progression = userData.progression || createFreshProfileState(currentScope).progression;
        profileState.settings = { ...profileState.settings, ...(userData.settings || {}) };
        profileState.dailyDrawDate = userData.dailyDrawDate || "";
        if (Array.isArray(userData.reflections)) {
            profileState.reflections = userData.reflections;
        }
        if (currentScope) {
            profileState.ownerId = currentScope;
            if (profileState.profile) profileState.profile.ownerId = currentScope;
        }
    }
    
    if (consecrationsData && isValidUserRecord) {
        try {
            const parsed = JSON.parse(consecrationsData);
            if (Array.isArray(parsed)) {
                profileState.reflections = parsed;
            } else if (!Array.isArray(profileState.reflections)) {
                profileState.reflections = [];
            }
        } catch(e) {
            if (!Array.isArray(profileState.reflections)) profileState.reflections = [];
            console.error("Failed to parse auro_match_consecrations");
        }
    } else if (!Array.isArray(profileState.reflections)) {
        profileState.reflections = [];
    }
    
    if (unlockedData && isValidUserRecord) {
        try {
            const parsed = JSON.parse(unlockedData);
            if (Array.isArray(parsed)) {
                profileState.progression.completedLevelIds = parsed;
                profileState.progression.completedLevelsCount = Math.max(
                    Number(profileState.progression.completedLevelsCount || 0),
                    parsed.length
                );
            } else if (!Array.isArray(profileState.progression.completedLevelIds)) {
                profileState.progression.completedLevelIds = [];
            }
        } catch(e) {
            if (!Array.isArray(profileState.progression.completedLevelIds)) profileState.progression.completedLevelIds = [];
            console.error("Failed to parse auro_match_unlocked_tiles");
        }
    } else {
        if (!Array.isArray(profileState.progression.completedLevelIds)) {
            profileState.progression.completedLevelIds = [];
        }
        profileState.progression.completedLevelsCount = Math.max(
            Number(profileState.progression.completedLevelsCount || 0),
            profileState.progression.completedLevelIds.length
        );
    }

    if (currentScope) {
        profileState.ownerId = currentScope;
        if (profileState.profile) profileState.profile.ownerId = currentScope;
    }

    return profileState;
}

export function syncTeachingsRepository(remoteRepository) {
    if (isPurgeActive()) {
        console.warn('[Storage] syncTeachingsRepository blocked: Purge is active.');
        return;
    }
    const localData = (typeof localStorage !== 'undefined') ? localStorage.getItem('auro_match_teachings') : null;
    let currentVersion = 0;
    let isCorrupted = false;
    try {
        if (localData) {
            const parsed = JSON.parse(localData);
            if (parsed && typeof parsed.version === 'number') {
                currentVersion = parsed.version;
            }
        }
    } catch (e) {
        console.warn('[Storage] Corrupted auro_match_teachings JSON encountered in localStorage. Resetting repository cache.', e);
        isCorrupted = true;
    }
    
    if (!localData || isCorrupted || (remoteRepository && remoteRepository.version > currentVersion)) {
        const payload = {
            version: remoteRepository ? remoteRepository.version : 101,
            lastUpdated: new Date().toISOString().split('T')[0],
            themes: remoteRepository ? remoteRepository.themes : {}
        };
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem('auro_match_teachings', JSON.stringify(payload));
        }
        setItemAsync('auro_match_teachings', payload);
    }
}


export const PBKDF2_RECOMMENDED_ITERATIONS = 100000;

export async function encryptAndExportBackup(password) {
    if (!password) throw new Error("Decryption password is required.");
    
    // PBKDF2 Key Derivation with hardened iteration count (OWASP compliant)
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        enc.encode(password),
        "PBKDF2",
        false,
        ["deriveKey"]
    );
    
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iterations = PBKDF2_RECOMMENDED_ITERATIONS;
    const pbkdfKey = await crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: salt,
            iterations: iterations,
            hash: "SHA-256"
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt"]
    );
    
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const payload = enc.encode(JSON.stringify(profileState));
    
    const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        pbkdfKey,
        payload
    );
    
    const exportObj = {
        version: 2,
        iterations: iterations,
        salt: btoa(String.fromCharCode(...salt)),
        iv: btoa(String.fromCharCode(...iv)),
        data: btoa(String.fromCharCode(...new Uint8Array(encrypted)))
    };
    
    return JSON.stringify(exportObj);
}

export async function decryptAndImportBackup(password, jsonString) {
    if (!password) throw new Error("Decryption password is required.");
    
    const backupObj = JSON.parse(jsonString);
    
    const salt = new Uint8Array(atob(backupObj.salt).split("").map(c => c.charCodeAt(0)));
    const iv = new Uint8Array(atob(backupObj.iv).split("").map(c => c.charCodeAt(0)));
    const encryptedData = new Uint8Array(atob(backupObj.data).split("").map(c => c.charCodeAt(0)));
    
    // Support modern exports (100,000 iterations) and legacy v1 exports (10,000 iterations)
    const iterations = backupObj.iterations || 10000;
    
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        enc.encode(password),
        "PBKDF2",
        false,
        ["deriveKey"]
    );
    
    const pbkdfKey = await crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: salt,
            iterations: iterations,
            hash: "SHA-256"
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["decrypt"]
    );
    
    const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv },
        pbkdfKey,
        encryptedData
    );
    
    const dec = new TextDecoder();
    const restoredState = JSON.parse(dec.decode(decrypted));
    
    // Decoupled Merge: restored backup replaces state cleanly without merging stale local data
    if (isPurgeActive()) {
        throw new Error("Cannot restore backup while purge is active.");
    }
    profileState = restoredState;
    saveProfileState({ skipLocalMerge: true });
    return profileState;
}

export async function executeAbsolutePurge(targetGm = null) {
    // 1. Establish persistent purge lock before executing destructive operations
    setPurgeLock(true);
    pendingDualWriteKeys.clear();

    try {
        // 2. Broadcast purge event across tabs immediately
        if (typeof BroadcastChannel !== 'undefined') {
            try {
                const bus = new BroadcastChannel('auromatch_storage_bus');
                bus.postMessage({ type: 'AUROMATCH_PURGE_EXECUTED', timestamp: Date.now() });
                bus.close();
            } catch (e) {}
        }

        // 3. Reset in-memory GameManager state to eliminate the 800ms reload race condition
        const gm = targetGm || (typeof window !== 'undefined' ? (window.gameManager || window.activeGameManager) : null);
        if (gm && typeof gm.resetActivePlayerState === 'function') {
            gm.resetActivePlayerState();
        }

        // Phase 2: Asynchronous deletion of AuroMatchDB IndexedDB vault
        const idb = (typeof window !== 'undefined' && window.indexedDB) ? window.indexedDB : globalThis.indexedDB;
        if (idb) {
            try {
                const db = await (dbPromise || Promise.resolve(null));
                if (db) {
                    try { db.close(); } catch (err) {}
                }
            } catch (e) {}
            dbPromise = Promise.resolve(null);
            isClosedByRemote = false;

            await new Promise((resolve) => {
                try {
                    const delReq = idb.deleteDatabase(DB_NAME);
                    let settled = false;
                    const timer = setTimeout(() => {
                        if (!settled) {
                            settled = true;
                            resolve();
                        }
                    }, 5000);

                    delReq.onsuccess = () => {
                        if (!settled) {
                            settled = true;
                            clearTimeout(timer);
                            resolve();
                        }
                    };
                    delReq.onerror = () => {
                        if (!settled) {
                            settled = true;
                            clearTimeout(timer);
                            resolve();
                        }
                    };
                    delReq.onblocked = () => {
                        if (!settled) {
                            settled = true;
                            clearTimeout(timer);
                            resolve();
                        }
                    };
                } catch (delErr) {
                    resolve();
                }
            });
        }

        // Phase 3: Scoped removal of application keys (leaving foreign keys untouched)
        if (typeof localStorage !== 'undefined') {
            const knownKeys = [
                'auro_match_user',
                'auro_match_consecrations',
                'auro_match_unlocked_tiles',
                'auro_match_profile',
                'auro_match_teachings',
                'auromatch_has_entered_sanctuary',
                'auromatch_player_profiles',
                'auromatch_player_state',
                'auromatch_standard_theme'
            ];
            knownKeys.forEach(key => localStorage.removeItem(key));

            // Defensively remove any current or future Auromatch-owned keys, preserving active lock
            Object.keys(localStorage)
                .filter(key => (key.startsWith('auromatch_') || key.startsWith('auro_match_')) && key !== 'auromatch_purge_in_progress')
                .forEach(key => localStorage.removeItem(key));
        }

        // 5. Reset local in-memory profileState to canonical defaults
        profileState = {
            profile: {
                createdTimestamp: Date.now(),
                lastLaunchTimestamp: Date.now(),
                sanctuaryMode: "traditional",
                themePreference: "auto",
                voiceTonePreference: "french_cadence",
                lotusPetalCount: 0,
                consciousnessPoints: 0
            },
            progression: {
                completedLevelsCount: 0,
                unlockedThemes: ["flowers", "qualities"],
                completedLevelIds: []
            },
            settings: {
                volumeRaga: 0.40,
                volumeGong: 0.60,
                speechRate: 0.70,
                speechPitch: 0.95,
                secularToggle: false
            },
            reflections: [],
            dailyDrawDate: ""
        };
    } finally {
        // In headless testing or environments without full reload, release lock after safe cooldown
        setTimeout(() => {
            setPurgeLock(false);
        }, 1200);
    }
}

/**
 * Computes deterministic cryptographic checksum for the entire exported save envelope.
 */
export async function computeAuroMatchEnvelopeChecksum(payload) {
    try {
        const toHash = { ...payload };
        delete toHash.exportedAt;
        const serialized = JSON.stringify(toHash);

        if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle && typeof globalThis.crypto.subtle.digest === 'function') {
            const encoder = new TextEncoder();
            const dataBuffer = encoder.encode(serialized);
            const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', dataBuffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return 'match_sha256_' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        }

        let h1 = 0x811c9dc5;
        for (let i = 0; i < serialized.length; i++) {
            h1 ^= serialized.charCodeAt(i);
            h1 = Math.imul(h1, 0x01000193);
        }
        return 'match_fnv_' + (h1 >>> 0).toString(16);
    } catch {
        return 'match_' + Date.now();
    }
}

/**
 * Creates the AuroMind Platform Game Adapter for AuroMatch.
 * Bridges AuroMatch's native storage to the shared SDK identity and sync lifecycle
 * while strictly preserving game ownership of AuroMatchDB and player state.
 */
export function createAuroMatchGameAdapter() {
    return {
        gameId: 'auromatch',
        adapterVersion: '1.0.0',
        contractVersion: 1,
        integrationMode: 'native',
        storage: {
            kind: 'idb+ls',
            ownedDatabases: ['AuroMatchDB'],
            ownedLocalStorageKeys: [
                'auro_match_user',
                'auro_match_consecrations',
                'auro_match_unlocked_tiles',
                'auro_match_profile',
                'auro_match_teachings',
                'auromatch_has_entered_sanctuary',
                'auromatch_player_profiles',
                'auromatch_player_state',
                'auromatch_standard_theme'
            ],
            localOnlyVaults: []
        },
        capabilities: {
            offlinePlay: true,
            localPersistence: true,
            cloudSyncEligible: true
        },
        hasLocalProgress: () => {
            try {
                if (isPurgeActive()) return false;
                const active = getActiveScope();
                const isAuthenticated = Boolean(active && !active.startsWith('guest_'));
                if (isAuthenticated) {
                    if (typeof localStorage === 'undefined') return false;
                    let raw = null;
                    try {
                        raw = localStorage.getItem(`auro_match_user:${active}`);
                    } catch {
                        // LocalStorage access exception is a validation failure
                        return false;
                    }
                    if (!raw || typeof raw !== 'string') return false;
                    const parsed = tryParseJson(raw);
                    if (!parsed.ok || !parsed.value || typeof parsed.value !== 'object') return false;
                    const recordOwner = getRecordOwnerId(parsed.value);
                    if (!recordOwner || recordOwner !== active) return false;

                    const userVal = parsed.value;
                    let hasPersistedProgress = Boolean(
                        userVal &&
                        ((userVal.progression &&
                          (Number(userVal.progression.completedLevelsCount || 0) > 0 ||
                           (Array.isArray(userVal.progression.completedLevelIds) && userVal.progression.completedLevelIds.length > 0))) ||
                         (Array.isArray(userVal.reflections) && userVal.reflections.length > 0) ||
                         (userVal.profile &&
                          (Number(userVal.profile.lotusPetalCount || 0) > 0 ||
                           Number(userVal.profile.consciousnessPoints || 0) > 0)))
                    );

                    if (!hasPersistedProgress) {
                        try {
                            const rawTiles = localStorage.getItem(`auro_match_unlocked_tiles:${active}`);
                            if (rawTiles) {
                                const pt = JSON.parse(rawTiles);
                                if (Array.isArray(pt) && pt.length > 0) hasPersistedProgress = true;
                            }
                        } catch {}
                    }
                    if (!hasPersistedProgress) {
                        try {
                            const rawCons = localStorage.getItem(`auro_match_consecrations:${active}`);
                            if (rawCons) {
                                const pc = JSON.parse(rawCons);
                                if (Array.isArray(pc) && pc.length > 0) hasPersistedProgress = true;
                            }
                        } catch {}
                    }

                    if (!hasPersistedProgress) return false;

                    if (profileState && (profileState.ownerId !== active || profileState.profile?.ownerId !== active)) {
                        return false;
                    }
                    return true;
                }
                // Guest / unauthenticated mode
                let hasGuestProgress = Boolean(
                    profileState &&
                    ((profileState.progression &&
                      (Number(profileState.progression.completedLevelsCount || 0) > 0 ||
                       (Array.isArray(profileState.progression.completedLevelIds) && profileState.progression.completedLevelIds.length > 0))) ||
                     (Array.isArray(profileState.reflections) && profileState.reflections.length > 0) ||
                     (profileState.profile &&
                      (Number(profileState.profile.lotusPetalCount || 0) > 0 ||
                       Number(profileState.profile.consciousnessPoints || 0) > 0)))
                );
                if (!hasGuestProgress && typeof localStorage !== 'undefined') {
                    try {
                        const rawGuestUser = active ? (localStorage.getItem(`auro_match_user:${active}`) || localStorage.getItem('auro_match_user')) : localStorage.getItem('auro_match_user');
                        if (rawGuestUser) {
                            const parsed = tryParseJson(rawGuestUser);
                            if (parsed.ok && parsed.value && typeof parsed.value === 'object') {
                                const u = parsed.value;
                                if (
                                    (u.progression &&
                                     (Number(u.progression.completedLevelsCount || 0) > 0 ||
                                      (Array.isArray(u.progression.completedLevelIds) && u.progression.completedLevelIds.length > 0))) ||
                                    (Array.isArray(u.reflections) && u.reflections.length > 0) ||
                                    (u.profile &&
                                     (Number(u.profile.lotusPetalCount || 0) > 0 ||
                                      Number(u.profile.consciousnessPoints || 0) > 0))
                                ) {
                                    hasGuestProgress = true;
                                }
                            }
                        }
                    } catch {}
                    if (!hasGuestProgress) {
                        try {
                            const rawTiles = active ? (localStorage.getItem(`auro_match_unlocked_tiles:${active}`) || localStorage.getItem('auro_match_unlocked_tiles')) : localStorage.getItem('auro_match_unlocked_tiles');
                            if (rawTiles) {
                                const pt = JSON.parse(rawTiles);
                                if (Array.isArray(pt) && pt.length > 0) hasGuestProgress = true;
                            }
                        } catch {}
                    }
                    if (!hasGuestProgress) {
                        try {
                            const rawCons = active ? (localStorage.getItem(`auro_match_consecrations:${active}`) || localStorage.getItem('auro_match_consecrations')) : localStorage.getItem('auro_match_consecrations');
                            if (rawCons) {
                                const pc = JSON.parse(rawCons);
                                if (Array.isArray(pc) && pc.length > 0) hasGuestProgress = true;
                            }
                        } catch {}
                    }
                }
                return hasGuestProgress;
            } catch {
                return false;
            }
        },
        exportEnvelope: async (guestId) => {
            if (isPurgeActive()) {
                console.warn('[Storage] exportEnvelope blocked: Purge is active.');
                return {
                    envelopeVersion: 1,
                    gameId: 'auromatch',
                    gameSchemaVersion: 1,
                    guestId,
                    baseRevision: 0,
                    clientUpdatedAt: new Date().toISOString(),
                    isEmpty: true,
                    checksum: 'match_0_0',
                    payload: {
                        schemaVersion: 1,
                        profileState: createFreshProfileState(getActiveScope()),
                        exportedAt: new Date().toISOString()
                    }
                };
            }
            const active = getActiveScope();
            const generation = getScopeGeneration();
            const isAuthenticated = Boolean(active && !active.startsWith('guest_'));

            let isAuthoritativeValid = false;
            let persistenceError = null;

            if (isAuthenticated) {
                if (typeof localStorage === 'undefined') {
                    isAuthoritativeValid = false;
                    persistenceError = 'STORAGE_UNAVAILABLE';
                } else {
                    let rawScoped = null;
                    try {
                        rawScoped = localStorage.getItem(`auro_match_user:${active}`);
                    } catch (err) {
                        isAuthoritativeValid = false;
                        persistenceError = 'STORAGE_ACCESS_ERROR';
                    }
                    if (rawScoped === null || rawScoped === undefined) {
                        isAuthoritativeValid = false;
                        persistenceError = persistenceError || 'MISSING_SCOPED_RECORD';
                    } else {
                        const parsed = tryParseJson(rawScoped);
                        if (!parsed.ok || !parsed.value || typeof parsed.value !== 'object') {
                            isAuthoritativeValid = false;
                            persistenceError = 'MALFORMED_SCOPED_RECORD';
                        } else {
                            const recordOwner = getRecordOwnerId(parsed.value);
                            if (!recordOwner || recordOwner !== active) {
                                isAuthoritativeValid = false;
                                persistenceError = 'FOREIGN_OR_INVALID_OWNER';
                            } else {
                                isAuthoritativeValid = true;
                            }
                        }
                    }
                }

                // If authoritative persistence is valid, strictly synchronize profileState with the scoped record
                if (isAuthoritativeValid) {
                    loadProfileState({ accountScope: active });
                    if (!profileState || profileState.ownerId !== active || profileState.profile?.ownerId !== active) {
                        isAuthoritativeValid = false;
                        persistenceError = 'IN_MEMORY_OWNERSHIP_MISMATCH';
                    }
                }
            } else {
                // Guest / unauthenticated mode
                if (active) {
                    loadProfileState({ accountScope: active });
                } else if (!profileState || (profileState.progression?.completedLevelsCount === 0 && profileState.profile?.lotusPetalCount === 0)) {
                    loadProfileState();
                }
                const isGuestOwnerValid = !active || !profileState?.ownerId || profileState.ownerId.startsWith('guest_');
                isAuthoritativeValid = Boolean(isGuestOwnerValid);
                if (!isAuthoritativeValid) {
                    persistenceError = 'INVALID_GUEST_OWNER';
                }
            }

            let validationStatus = 'valid';
            if (!isAuthoritativeValid) {
                if (persistenceError === 'MISSING_SCOPED_RECORD') {
                    validationStatus = 'missing_persistence';
                } else if (persistenceError === 'STORAGE_UNAVAILABLE' || persistenceError === 'STORAGE_ACCESS_ERROR') {
                    validationStatus = 'inaccessible_persistence';
                } else {
                    validationStatus = 'invalid_persistence';
                }
            }

            const hasProgress = isAuthoritativeValid && Boolean(
                profileState &&
                ((profileState.progression &&
                  (Number(profileState.progression.completedLevelsCount || 0) > 0 ||
                   (Array.isArray(profileState.progression.completedLevelIds) && profileState.progression.completedLevelIds.length > 0))) ||
                 (Array.isArray(profileState.reflections) && profileState.reflections.length > 0) ||
                 (profileState.profile &&
                  (Number(profileState.profile.lotusPetalCount || 0) > 0 ||
                   Number(profileState.profile.consciousnessPoints || 0) > 0)))
            );
            const effectiveOwner = isAuthenticated ? active : (active || (isAuthoritativeValid ? profileState?.ownerId : null) || guestId || null);
            const exportedProfile = isAuthoritativeValid ? profileState : createFreshProfileState(active);
            const payload = {
                schemaVersion: 1,
                profileState: JSON.parse(JSON.stringify(exportedProfile)),
                consecrations: Array.isArray(exportedProfile.reflections) ? exportedProfile.reflections : [],
                unlockedTiles: Array.isArray(exportedProfile.progression?.completedLevelIds) ? exportedProfile.progression.completedLevelIds : [],
                ownerId: effectiveOwner,
                persistenceValid: isAuthoritativeValid,
                validationStatus,
                ...(persistenceError ? { persistenceError } : {}),
                exportedAt: new Date().toISOString()
            };
            const checksum = await computeAuroMatchEnvelopeChecksum(payload);

            // Concurrency check: verify active scope and generation did not transition during async checksum calculation
            const currentScopeAfterAsync = getActiveScope();
            const currentGenAfterAsync = getScopeGeneration();
            if ((isAuthenticated && currentScopeAfterAsync !== active) || currentGenAfterAsync !== generation) {
                console.warn(`[Storage] exportEnvelope: Scope transition race detected mid-flight (captured="${active}"/gen=${generation}, current="${currentScopeAfterAsync}"/gen=${currentGenAfterAsync}). Invalidate export.`);
                return {
                    envelopeVersion: 1,
                    gameId: 'auromatch',
                    gameSchemaVersion: 1,
                    guestId,
                    ownerId: active,
                    baseRevision: 0,
                    clientUpdatedAt: new Date().toISOString(),
                    isEmpty: true,
                    persistenceValid: false,
                    validationStatus: 'scope_race_detected',
                    persistenceError: 'SCOPE_TRANSITION_RACE',
                    checksum: 'match_0_0',
                    payload: {
                        schemaVersion: 1,
                        profileState: createFreshProfileState(active),
                        consecrations: [],
                        unlockedTiles: [],
                        ownerId: active,
                        persistenceValid: false,
                        validationStatus: 'scope_race_detected',
                        persistenceError: 'SCOPE_TRANSITION_RACE',
                        exportedAt: new Date().toISOString()
                    }
                };
            }

            return {
                envelopeVersion: 1,
                gameId: 'auromatch',
                gameSchemaVersion: 1,
                guestId,
                ownerId: effectiveOwner,
                baseRevision: 0,
                clientUpdatedAt: new Date().toISOString(),
                isEmpty: !hasProgress,
                persistenceValid: isAuthoritativeValid,
                validationStatus,
                ...(persistenceError ? { persistenceError } : {}),
                checksum,
                payload
            };
        },
        applyEnvelope: async (envelope, context = {}) => {
            if (!envelope || !envelope.payload) return false;
            if (envelope.gameId && envelope.gameId !== 'auromatch') return false;
            if (isPurgeActive()) {
                console.warn('[Storage] applyEnvelope blocked: Purge is active.');
                return false;
            }

            const entryScope = getActiveScope();
            const entryGen = getScopeGeneration();
            const targetScope = resolveAccountScope(context) || resolveAccountScope(envelope);
            const isAuthenticatedTarget = Boolean(targetScope && !targetScope.startsWith('guest_'));
            const isScopeTransition = Boolean(targetScope && targetScope !== entryScope);
            const skipLocalMerge = Boolean(context?.skipLocalMerge || envelope?.skipLocalMerge || isScopeTransition);

            // Resolve candidate owner from envelope metadata
            const rawOwnerCandidate = envelope.ownerId ??
                envelope.userId ??
                envelope.payload?.ownerId ??
                envelope.payload?.profileState?.ownerId ??
                envelope.payload?.profileState?.profile?.ownerId ??
                envelope.payload?.user?.ownerId ??
                envelope.payload?.user?.profile?.ownerId ??
                null;

            if (isAuthenticatedTarget) {
                // Authenticated target MUST receive a valid non-empty string owner
                if (typeof rawOwnerCandidate !== 'string' || rawOwnerCandidate.trim().length === 0) {
                    console.warn(`[Storage] applyEnvelope: Authenticated target "${targetScope}" requires non-empty string owner. Received: ${JSON.stringify(rawOwnerCandidate)}. Rejecting.`);
                    return false;
                }
                const envelopeOwner = rawOwnerCandidate.trim();

                // GUEST MIGRATION CAPABILITY STATUS:
                // Guest-to-authenticated migration is currently DISABLED in the client storage layer.
                // Existing guest data remains safely isolated in its guest scope (e.g., guest_<uuid>).
                // All cross-owner envelope applications to authenticated targets are rejected fail-closed.
                // Untrusted caller context (context.migrateFromGuest, context.guestId, window globals)
                // CANNOT authorize cross-owner migration without cryptographic transition proof.
                // A future implementation requires an authoritative, server-signed identity-provider
                // transition contract and comprehensive security review before migration can be re-enabled.
                if (envelopeOwner !== targetScope) {
                    console.warn(`[Storage] applyEnvelope: Rejected cross-owner envelope (belongs to "${envelopeOwner}", target is "${targetScope}"). Guest-to-authenticated migration is currently disabled; untrusted caller context cannot authorize migration. Failing closed.`);
                    return false;
                }
            } else if (targetScope) {
                // Guest target with explicit targetScope
                if (rawOwnerCandidate !== null && rawOwnerCandidate !== undefined) {
                    if (typeof rawOwnerCandidate !== 'string' || rawOwnerCandidate.trim().length === 0) {
                        return false;
                    }
                    const envelopeOwner = rawOwnerCandidate.trim();
                    if (envelopeOwner !== targetScope) {
                        return false;
                    }
                }
            } else {
                // Unscoped guest
                if (rawOwnerCandidate !== null && rawOwnerCandidate !== undefined) {
                    if (typeof rawOwnerCandidate === 'string') {
                        const envelopeOwner = rawOwnerCandidate.trim();
                        if (envelopeOwner.length > 0 && !envelopeOwner.startsWith('guest_')) {
                            // Reject authenticated account envelope applied to unscoped guest
                            return false;
                        }
                    } else {
                        return false;
                    }
                }
            }

            if (isScopeTransition) {
                setAccountScope(targetScope);
                if (getActiveScope() !== targetScope || getScopeGeneration() !== entryGen + 1) {
                    console.warn('[Storage] applyEnvelope: Mid-transition scope interference detected. Failing closed.');
                    return false;
                }
            }

            const expectedScope = targetScope !== null && targetScope !== undefined ? targetScope : entryScope;
            const expectedGen = isScopeTransition ? entryGen + 1 : entryGen;
            const isScopeConsistent = () => (getActiveScope() === expectedScope && getScopeGeneration() === expectedGen);

            if (!isScopeConsistent()) {
                console.warn('[Storage] applyEnvelope: Scope transition detected before write execution. Failing closed.');
                return false;
            }

            let nextProfileState = null;
            if (envelope.payload.profileState) {
                if (skipLocalMerge) {
                    nextProfileState = createFreshProfileState(targetScope);
                } else {
                    nextProfileState = JSON.parse(JSON.stringify(profileState));
                }
                const incoming = JSON.parse(JSON.stringify(envelope.payload.profileState));
                nextProfileState = { ...nextProfileState, ...incoming };
                if (targetScope) nextProfileState.ownerId = targetScope;
            } else if (envelope.payload.user || envelope.payload.consecrations || envelope.payload.unlockedTiles) {
                const { user, consecrations, unlockedTiles } = envelope.payload;
                if (skipLocalMerge) {
                    nextProfileState = createFreshProfileState(targetScope);
                } else {
                    nextProfileState = JSON.parse(JSON.stringify(profileState));
                }
                if (user && typeof user === 'object') {
                    nextProfileState.profile = user.profile || nextProfileState.profile;
                    nextProfileState.progression = user.progression || nextProfileState.progression;
                    nextProfileState.settings = { ...nextProfileState.settings, ...(user.settings || {}) };
                    nextProfileState.dailyDrawDate = user.dailyDrawDate || nextProfileState.dailyDrawDate;
                }
                if (Array.isArray(consecrations)) {
                    nextProfileState.reflections = consecrations;
                }
                if (Array.isArray(unlockedTiles)) {
                    nextProfileState.progression.completedLevelIds = unlockedTiles;
                    nextProfileState.progression.completedLevelsCount = Math.max(
                        Number(nextProfileState.progression.completedLevelsCount || 0),
                        unlockedTiles.length
                    );
                }
                if (targetScope) nextProfileState.ownerId = targetScope;
            } else {
                return false;
            }

            // Deduplicate reflections and tiles
            nextProfileState.reflections = mergeUniqueItems(nextProfileState.reflections || [], []);
            nextProfileState.progression.completedLevelIds = mergeUniqueItems(nextProfileState.progression?.completedLevelIds || [], []);
            nextProfileState.progression.completedLevelsCount = Math.max(
                Number(nextProfileState.progression?.completedLevelsCount || 0),
                nextProfileState.progression.completedLevelIds.length
            );

            const userObj = {
                profile: nextProfileState.profile,
                progression: nextProfileState.progression,
                settings: nextProfileState.settings,
                dailyDrawDate: nextProfileState.dailyDrawDate,
                ownerId: targetScope || nextProfileState.profile?.ownerId || null
            };
            const reflections = nextProfileState.reflections;
            const completedLevelIds = nextProfileState.progression.completedLevelIds;

            // Sequential asynchronous dual-write persistence with revalidation across every boundary
            if (targetScope) {
                if (!isScopeConsistent()) return false;
                await setItemDualWrite(`auro_match_user:${targetScope}`, userObj, { accountScope: targetScope });
                if (!isScopeConsistent()) return false;

                await setItemDualWrite(`auro_match_consecrations:${targetScope}`, reflections, { accountScope: targetScope });
                if (!isScopeConsistent()) return false;

                await setItemDualWrite(`auro_match_unlocked_tiles:${targetScope}`, completedLevelIds, { accountScope: targetScope });
                if (!isScopeConsistent()) return false;
            } else if (!isAuthenticatedTarget) {
                if (!isScopeConsistent()) return false;
                await setItemDualWrite('auro_match_user', userObj);
                if (!isScopeConsistent()) return false;

                await setItemDualWrite('auro_match_consecrations', reflections);
                if (!isScopeConsistent()) return false;

                await setItemDualWrite('auro_match_unlocked_tiles', completedLevelIds);
                if (!isScopeConsistent()) return false;
            }

            // Update in-memory profileState and active working cache ONLY if scope and generation remain strictly consistent
            if (!isScopeConsistent()) return false;
            profileState = nextProfileState;

            if (getActiveScope() === targetScope && typeof localStorage !== 'undefined') {
                if (!isScopeConsistent()) return false;
                syncWorkingCacheFromProfileState(targetScope);
            }

            if (!isScopeConsistent()) {
                console.warn('[Storage] applyEnvelope: Mid-flight account transition detected at completion boundary. Failing closed.');
                return false;
            }

            return true;
        },
        init: async (scopedContext) => {
            if (isPurgeActive()) {
                console.warn('[Storage] init blocked: Purge is active.');
                return;
            }
            const targetScope = resolveAccountScope(scopedContext);
            const guestId = scopedContext?.getGuestId ? scopedContext.getGuestId() : null;
            if (guestId) {
                if (typeof window !== 'undefined') {
                    window.__AUROMIND_GUEST_ID__ = guestId;
                }
                if (profileState && profileState.profile) {
                    profileState.profile.platformGuestId = guestId;
                }
            }

            if (targetScope !== getActiveScope()) {
                setAccountScope(targetScope);
                loadProfileState({ accountScope: targetScope });
            }

            await autoHealFromIndexedDB(scopedContext);
        }
    };
}
