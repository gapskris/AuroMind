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
    if (typeof raw !== 'string') return { ok: false, value: null };
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

    // Track divergence so getItemAsync() never serves stale secondary data and reconcileDualWriteParity() can heal it
    if (lsOk || idbOk) {
        pendingDualWriteKeys.set(key, {
            serialized,
            lsOk,
            idbOk,
            lastError: error,
            attempts: idbRes.attempts,
            updatedAt: Date.now()
        });
    } else {
        pendingDualWriteKeys.set(key, {
            serialized,
            lsOk: false,
            idbOk: false,
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
    let reconciled = 0;
    const details = [];

    for (const [key, entry] of Array.from(pendingDualWriteKeys.entries())) {
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

export function getActiveScope() {
    return _activeScope;
}

export function setAccountScope(scope) {
    const nextScope = scope ? String(scope) : null;
    if (_activeScope !== nextScope) {
        _activeScope = nextScope;
        if (_activeScope) {
            loadProfileState({ accountScope: _activeScope });
        } else {
            profileState = createFreshProfileState(null);
        }
    }
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
    return record.ownerId || record.profile?.ownerId || record.profile?.platformGuestId || record.userId || null;
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
        const rawLocalUser = localStorage.getItem('auro_match_user');
        const parsedLocalUser = tryParseJson(rawLocalUser);
        const localOwner = getRecordOwnerId(parsedLocalUser.value);
        const isForeignLocal = Boolean(activeScope && localOwner && localOwner !== activeScope);

        // 2. Query IndexedDB for ownership validation
        const idbUserVal = await new Promise((resolve) => {
            try {
                const tx = db.transaction(STORE_NAME, 'readonly');
                // Check scoped IDB key first if scope is present
                const keyToGet = activeScope ? `auro_match_user:${activeScope}` : 'auro_match_user';
                const req = tx.objectStore(STORE_NAME).get(keyToGet);
                req.onsuccess = () => {
                    if (req.result !== undefined && req.result !== null) {
                        resolve(req.result);
                    } else if (activeScope) {
                        // Fallback check to working key in IDB
                        try {
                            const tx2 = db.transaction(STORE_NAME, 'readonly');
                            const req2 = tx2.objectStore(STORE_NAME).get('auro_match_user');
                            req2.onsuccess = () => resolve(req2.result);
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

        const parsedIdbUser = tryParseJson(idbUserVal);
        const idbOwner = getRecordOwnerId(parsedIdbUser.value);

        // Foreign IDB data check: If IDB record belongs to another account, do NOT restore or merge into activeScope!
        if (activeScope && idbOwner && idbOwner !== activeScope) {
            console.warn(`[Storage] autoHealFromIndexedDB: IDB record belongs to "${idbOwner}", not active account "${activeScope}". Rejecting cross-account recovery.`);
            return false;
        }

        // Unowned IDB data check: An authenticated account cannot hydrate unowned guest mutations
        if (activeScope && !activeScope.startsWith('guest_') && !idbOwner && parsedIdbUser.ok) {
            console.warn(`[Storage] autoHealFromIndexedDB: Authenticated account "${activeScope}" cannot hydrate unowned IDB records.`);
            return false;
        }

        // 3. Determine if local state is healthy for the active scope
        let localState = localStorage.getItem(activeScope ? `auromatch_player_state:${activeScope}` : 'auromatch_player_state');
        let localUser = localStorage.getItem(activeScope ? `auro_match_user:${activeScope}` : 'auro_match_user');

        if (!localUser && !isForeignLocal && rawLocalUser) {
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
                if (localVal === null && !isForeignLocal) {
                    localVal = localStorage.getItem(key);
                }

                const idbVal = await new Promise((resolve) => {
                    try {
                        const tx = db.transaction(STORE_NAME, 'readonly');
                        const req = tx.objectStore(STORE_NAME).get(scopedKey);
                        req.onsuccess = () => {
                            if (req.result !== undefined && req.result !== null) {
                                resolve(req.result);
                            } else if (activeScope && (idbOwner === activeScope || !idbOwner)) {
                                try {
                                    const tx2 = db.transaction(STORE_NAME, 'readonly');
                                    const req2 = tx2.objectStore(STORE_NAME).get(key);
                                    req2.onsuccess = () => resolve(req2.result);
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
                        localStorage.setItem(key, idbStr);
                        if (activeScope) localStorage.setItem(scopedKey, idbStr);
                        localHealedFromIdb = true;
                    }
                    continue;
                }

                if (idbStr === null) {
                    await setItemDualWrite(key, localVal);
                    if (activeScope) await setItemDualWrite(scopedKey, localVal);
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
                            await setItemDualWrite(key, mergedArr);
                            if (activeScope) await setItemDualWrite(scopedKey, mergedArr);
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
                            await setItemDualWrite(key, mergedUser);
                            if (activeScope) await setItemDualWrite(scopedKey, mergedUser);
                            idbHealedCount++;
                            continue;
                        }
                    }

                    await setItemDualWrite(key, localVal);
                    if (activeScope) await setItemDualWrite(scopedKey, localVal);
                    idbHealedCount++;
                }
            }
            if (idbHealedCount > 0) {
                console.info(`[Storage] Bidirectional auto-heal: reconciled ${idbHealedCount} records between localStorage and IndexedDB.`);
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
                    const req = tx.objectStore(STORE_NAME).get(scopedKey);
                    req.onsuccess = () => {
                        if (req.result !== undefined && req.result !== null) {
                            resolve(req.result);
                        } else if (activeScope && idbOwner === activeScope) {
                            try {
                                const tx2 = db.transaction(STORE_NAME, 'readonly');
                                const req2 = tx2.objectStore(STORE_NAME).get(key);
                                req2.onsuccess = () => resolve(req2.result);
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
                localStorage.setItem(key, strVal);
                if (activeScope) localStorage.setItem(scopedKey, strVal);
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

    if (currentScope) {
        profileState.ownerId = currentScope;
        if (profileState.profile) profileState.profile.ownerId = currentScope;
    }

    if (typeof localStorage !== 'undefined') {
        if (!skipLocalMerge) {
            // Fresh-Read-Before-Merge (Set-Union & High-Water-Mark):
            // Check ownership of local records before merging to prevent cross-account pollution!
            try {
                const freshUser = localStorage.getItem('auro_match_user');
                let localOwner = null;
                if (freshUser) {
                    const parsed = JSON.parse(freshUser);
                    localOwner = getRecordOwnerId(parsed);
                }
                const isSameOwner = !currentScope || !localOwner || localOwner === currentScope;
                if (isSameOwner) {
                    const freshConsecrations = localStorage.getItem('auro_match_consecrations');
                    if (freshConsecrations) {
                        const parsed = JSON.parse(freshConsecrations);
                        if (Array.isArray(parsed)) {
                            profileState.reflections = mergeUniqueItems(parsed, profileState.reflections);
                        }
                    }
                    const freshUnlocked = localStorage.getItem('auro_match_unlocked_tiles');
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

        localStorage.setItem('auro_match_user', serializedUser);
        localStorage.setItem('auro_match_consecrations', serializedCons);
        localStorage.setItem('auro_match_unlocked_tiles', serializedTiles);

        // Asynchronously mirror into durable IndexedDB vault with retry & divergence tracking
        setItemAsync('auro_match_user', userObj);
        setItemAsync('auro_match_consecrations', profileState.reflections);
        setItemAsync('auro_match_unlocked_tiles', profileState.progression.completedLevelIds);

        // If scoped, also persist into account-scoped keys in localStorage and IndexedDB
        if (currentScope) {
            localStorage.setItem(`auro_match_user:${currentScope}`, serializedUser);
            localStorage.setItem(`auro_match_consecrations:${currentScope}`, serializedCons);
            localStorage.setItem(`auro_match_unlocked_tiles:${currentScope}`, serializedTiles);

            setItemAsync(`auro_match_user:${currentScope}`, userObj);
            setItemAsync(`auro_match_consecrations:${currentScope}`, profileState.reflections);
            setItemAsync(`auro_match_unlocked_tiles:${currentScope}`, profileState.progression.completedLevelIds);
        }

        return true;
    }
    return false;
}

export function loadProfileState(options = {}) {
    const currentScope = (options && options.accountScope) || _activeScope;
    let userData = null;
    let consecrationsData = null;
    let unlockedData = null;

    if (typeof localStorage !== 'undefined') {
        if (currentScope) {
            userData = localStorage.getItem(`auro_match_user:${currentScope}`);
            consecrationsData = localStorage.getItem(`auro_match_consecrations:${currentScope}`);
            unlockedData = localStorage.getItem(`auro_match_unlocked_tiles:${currentScope}`);
        }
        if (!userData) {
            const rawWorking = localStorage.getItem('auro_match_user');
            if (rawWorking) {
                const parsed = tryParseJson(rawWorking);
                const owner = getRecordOwnerId(parsed.value);
                if (!currentScope || !owner || owner === currentScope) {
                    userData = rawWorking;
                    consecrationsData = consecrationsData || localStorage.getItem('auro_match_consecrations');
                    unlockedData = unlockedData || localStorage.getItem('auro_match_unlocked_tiles');
                }
            }
        }
    }

    if (!userData && currentScope) {
        profileState = createFreshProfileState(currentScope);
        return profileState;
    }

    // Legacy fallback
    const legacyData = (typeof localStorage !== 'undefined') ? localStorage.getItem('auro_match_profile') : null;
    if (legacyData && !userData && !currentScope) {
        try {
            const parsedLegacy = JSON.parse(legacyData);
            profileState = parsedLegacy;
            saveProfileState();
            localStorage.removeItem('auro_match_profile');
            return profileState;
        } catch(e) {}
    }

    if (userData) {
        try {
            const parsed = JSON.parse(userData);
            profileState.profile = parsed.profile;
            profileState.progression = parsed.progression;
            profileState.settings = { ...profileState.settings, ...(parsed.settings || {}) };
            profileState.dailyDrawDate = parsed.dailyDrawDate || "";
            if (currentScope) profileState.ownerId = currentScope;
        } catch(e) {
            console.error("Failed to parse auro_match_user");
        }
    }
    
    if (consecrationsData) {
        try {
            profileState.reflections = JSON.parse(consecrationsData);
        } catch(e) {
            console.error("Failed to parse auro_match_consecrations");
        }
    }
    
    if (unlockedData) {
        try {
            profileState.progression.completedLevelIds = JSON.parse(unlockedData);
        } catch(e) {
            console.error("Failed to parse auro_match_unlocked_tiles");
        }
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
                return Boolean(
                    profileState &&
                    profileState.progression &&
                    (profileState.progression.completedLevelsCount > 0 ||
                     (profileState.progression.completedLevelIds && profileState.progression.completedLevelIds.length > 0))
                );
            } catch {
                return false;
            }
        },
        exportEnvelope: async (guestId) => {
            const hasProgress = Boolean(
                profileState &&
                profileState.progression &&
                (profileState.progression.completedLevelsCount > 0 ||
                 (profileState.progression.completedLevelIds && profileState.progression.completedLevelIds.length > 0))
            );
            const payload = {
                schemaVersion: 1,
                profileState: JSON.parse(JSON.stringify(profileState)),
                exportedAt: new Date().toISOString()
            };
            const checksum = await computeAuroMatchEnvelopeChecksum(payload);
            return {
                envelopeVersion: 1,
                gameId: 'auromatch',
                gameSchemaVersion: 1,
                guestId,
                baseRevision: 0,
                clientUpdatedAt: new Date().toISOString(),
                isEmpty: !hasProgress,
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
            const targetScope = resolveAccountScope(context) || resolveAccountScope(envelope);
            if (targetScope && targetScope !== getActiveScope()) {
                setAccountScope(targetScope);
            }
            const skipLocalMerge = Boolean(context?.skipLocalMerge || envelope?.skipLocalMerge || (targetScope && targetScope !== getActiveScope()));

            if (envelope.payload.profileState) {
                profileState = envelope.payload.profileState;
                if (targetScope) profileState.ownerId = targetScope;
                saveProfileState({ skipLocalMerge: true, accountScope: targetScope });
                return true;
            }
            if (envelope.payload.user || envelope.payload.consecrations || envelope.payload.unlockedTiles) {
                const { user, consecrations, unlockedTiles } = envelope.payload;
                if (skipLocalMerge && targetScope) {
                    profileState = createFreshProfileState(targetScope);
                }
                if (user && typeof user === 'object') {
                    profileState.profile = user.profile || profileState.profile;
                    profileState.progression = user.progression || profileState.progression;
                    profileState.settings = { ...profileState.settings, ...(user.settings || {}) };
                    profileState.dailyDrawDate = user.dailyDrawDate || profileState.dailyDrawDate;
                }
                if (Array.isArray(consecrations)) {
                    profileState.reflections = consecrations;
                }
                if (Array.isArray(unlockedTiles)) {
                    profileState.progression.completedLevelIds = unlockedTiles;
                    profileState.progression.completedLevelsCount = Math.max(
                        Number(profileState.progression.completedLevelsCount || 0),
                        unlockedTiles.length
                    );
                }
                if (targetScope) profileState.ownerId = targetScope;
                saveProfileState({ skipLocalMerge: true, accountScope: targetScope });
                return true;
            }
            return false;
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
