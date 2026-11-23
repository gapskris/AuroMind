/**
 * AuroMind Shared Platform SDK — Supabase Profile & Private Settings Provider
 *
 * Aligns strictly with Migration 9 column-level grants and physical privacy separation:
 *   - public.user_profiles:
 *       SELECT (user_id, display_name, preferred_locale, is_public, created_at, updated_at)
 *       INSERT (user_id, display_name, preferred_locale, is_public)
 *       UPDATE (display_name, preferred_locale, is_public)  -- NEVER sends user_id or private columns!
 *   - public.user_private_settings:
 *       Owner-only SELECT / INSERT / UPDATE (preferences, analytics_opt_in, cloud_sync_opt_in)
 *   - public.public_user_profiles:
 *       Public projection view (user_id, display_name, preferred_locale, created_at)
 */

const USER_PROFILE_SELECT_COLS = 'user_id,display_name,preferred_locale,is_public,created_at,updated_at';
const PUBLIC_PROFILE_VIEW_COLS = 'user_id,display_name,preferred_locale,created_at';
const PRIVATE_SETTINGS_SELECT_COLS = 'user_id,preferences,analytics_opt_in,cloud_sync_opt_in,created_at,updated_at';

const SANKALPA_FORBIDDEN_RE =
  /("[^"]*sankalpa[^"]*"\s*:|sankalpa_e2ee_vault|auromasti-sankalpa-backup|auromind_sankalpa_vault|sankalpa_reflections)/i;

function sanitizeLocale(locale) {
  if (typeof locale !== 'string') return 'en';
  const trimmed = locale.trim();
  return /^[a-zA-Z]{2,5}(?:-[a-zA-Z0-9]{2,8})?$/.test(trimmed) ? trimmed : 'en';
}

function sanitizeDisplayName(name) {
  if (typeof name !== 'string') return 'Seeker';
  const clean = name.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return clean || 'Seeker';
}

export function createSupabaseProfileProvider(client) {
  function isConfigured() {
    return Boolean(client && client.isConfigured());
  }

  function getAuthenticatedUserId() {
    const user = client?.auth?.getUser?.();
    return user && typeof user.id === 'string' && user.id.trim() ? user.id.trim() : null;
  }

  async function getOwnProfile() {
    if (!isConfigured()) {
      return Object.freeze({ ok: false, errorCode: 'SUPABASE_NOT_CONFIGURED', profile: null, privateSettings: null });
    }
    const userId = getAuthenticatedUserId();
    if (!userId) {
      return Object.freeze({ ok: false, errorCode: 'UNAUTHENTICATED', profile: null, privateSettings: null });
    }

    try {
      const [profileRes, privateRes] = await Promise.all([
        client.from('user_profiles').select(USER_PROFILE_SELECT_COLS).eq('user_id', userId).maybeSingle(),
        client.from('user_private_settings').select(PRIVATE_SETTINGS_SELECT_COLS).eq('user_id', userId).maybeSingle()
      ]);

      if (profileRes?.error) {
        return Object.freeze({ ok: false, errorCode: 'PROFILE_FETCH_FAILED', message: profileRes.error.message, profile: null, privateSettings: null });
      }
      if (privateRes?.error) {
        return Object.freeze({ ok: false, errorCode: 'PRIVATE_SETTINGS_FETCH_FAILED', message: privateRes.error.message, profile: null, privateSettings: null });
      }

      return Object.freeze({
        ok: true,
        profile: profileRes?.data ? Object.freeze({ ...profileRes.data }) : null,
        privateSettings: privateRes?.data ? Object.freeze({ ...privateRes.data }) : null
      });
    } catch (err) {
      return Object.freeze({ ok: false, errorCode: 'NETWORK_ERROR', message: err.message, profile: null, privateSettings: null });
    }
  }

  async function createOwnProfile({ displayName = 'Seeker', preferredLocale = 'en', isPublic = false } = {}) {
    if (!isConfigured()) {
      return Object.freeze({ ok: false, errorCode: 'SUPABASE_NOT_CONFIGURED' });
    }
    const userId = getAuthenticatedUserId();
    if (!userId) {
      return Object.freeze({ ok: false, errorCode: 'UNAUTHENTICATED' });
    }

    // Strictly emit ONLY the columns permitted by GRANT INSERT (user_id, display_name, preferred_locale, is_public)
    const insertPayload = {
      user_id: userId,
      display_name: sanitizeDisplayName(displayName),
      preferred_locale: sanitizeLocale(preferredLocale),
      is_public: Boolean(isPublic)
    };

    try {
      const { data, error } = await client.from('user_profiles').insert(insertPayload);
      if (error) {
        return Object.freeze({ ok: false, errorCode: 'PROFILE_CREATE_FAILED', message: error.message });
      }
      return Object.freeze({ ok: true, profile: data || insertPayload });
    } catch (err) {
      return Object.freeze({ ok: false, errorCode: 'NETWORK_ERROR', message: err.message });
    }
  }

  async function updateOwnProfile(patch = {}) {
    if (!isConfigured()) {
      return Object.freeze({ ok: false, errorCode: 'SUPABASE_NOT_CONFIGURED' });
    }
    const userId = getAuthenticatedUserId();
    if (!userId) {
      return Object.freeze({ ok: false, errorCode: 'UNAUTHENTICATED' });
    }
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      return Object.freeze({ ok: false, errorCode: 'INVALID_PATCH' });
    }

    // Strictly emit ONLY the columns permitted by GRANT UPDATE (display_name, preferred_locale, is_public).
    // NEVER include user_id, created_at, updated_at, preferences, analytics_opt_in, or cloud_sync_opt_in.
    const updatePayload = {};
    if (Object.prototype.hasOwnProperty.call(patch, 'displayName')) {
      updatePayload.display_name = sanitizeDisplayName(patch.displayName);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'preferredLocale')) {
      updatePayload.preferred_locale = sanitizeLocale(patch.preferredLocale);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'isPublic')) {
      updatePayload.is_public = Boolean(patch.isPublic);
    }

    if (Object.keys(updatePayload).length === 0) {
      return Object.freeze({ ok: false, errorCode: 'EMPTY_PROFILE_UPDATE' });
    }

    try {
      const { data, error } = await client
        .from('user_profiles')
        .update(updatePayload)
        .eq('user_id', userId);
      if (error) {
        return Object.freeze({ ok: false, errorCode: 'PROFILE_UPDATE_FAILED', message: error.message });
      }
      return Object.freeze({ ok: true, updatedFields: Object.keys(updatePayload), profile: data });
    } catch (err) {
      return Object.freeze({ ok: false, errorCode: 'NETWORK_ERROR', message: err.message });
    }
  }

  async function updatePrivateSettings({ preferences, analyticsOptIn, cloudSyncOptIn } = {}) {
    if (!isConfigured()) {
      return Object.freeze({ ok: false, errorCode: 'SUPABASE_NOT_CONFIGURED' });
    }
    const userId = getAuthenticatedUserId();
    if (!userId) {
      return Object.freeze({ ok: false, errorCode: 'UNAUTHENTICATED' });
    }

    if (preferences !== undefined) {
      if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) {
        return Object.freeze({ ok: false, errorCode: 'INVALID_PREFERENCES' });
      }
      if (SANKALPA_FORBIDDEN_RE.test(JSON.stringify(preferences))) {
        return Object.freeze({ ok: false, errorCode: 'PRIVACY_BOUNDARY_VIOLATION' });
      }
    }

    const row = { user_id: userId };
    if (preferences !== undefined) row.preferences = preferences;
    if (analyticsOptIn !== undefined) row.analytics_opt_in = Boolean(analyticsOptIn);
    if (cloudSyncOptIn !== undefined) row.cloud_sync_opt_in = Boolean(cloudSyncOptIn);

    try {
      const { data, error } = await client
        .from('user_private_settings')
        .upsert(row, { onConflict: 'user_id' });
      if (error) {
        return Object.freeze({ ok: false, errorCode: 'PRIVATE_SETTINGS_UPDATE_FAILED', message: error.message });
      }
      return Object.freeze({ ok: true, privateSettings: data || row });
    } catch (err) {
      return Object.freeze({ ok: false, errorCode: 'NETWORK_ERROR', message: err.message });
    }
  }

  async function getPublicProfile(targetUserId) {
    if (!isConfigured()) {
      return Object.freeze({ ok: false, errorCode: 'SUPABASE_NOT_CONFIGURED', profile: null });
    }
    if (typeof targetUserId !== 'string' || !targetUserId.trim()) {
      return Object.freeze({ ok: false, errorCode: 'INVALID_USER_ID', profile: null });
    }

    try {
      // Query ONLY the hardened public_user_profiles projection view (never user_private_settings)
      const { data, error } = await client
        .from('public_user_profiles')
        .select(PUBLIC_PROFILE_VIEW_COLS)
        .eq('user_id', targetUserId.trim())
        .maybeSingle();

      if (error) {
        return Object.freeze({ ok: false, errorCode: 'PUBLIC_PROFILE_FETCH_FAILED', message: error.message, profile: null });
      }

      if (!data) {
        return Object.freeze({ ok: true, profile: null });
      }

      // Defensive projection: strip any unexpected private keys even if a misconfigured proxy injected them
      return Object.freeze({
        ok: true,
        profile: Object.freeze({
          user_id: data.user_id,
          display_name: data.display_name,
          preferred_locale: data.preferred_locale,
          created_at: data.created_at
        })
      });
    } catch (err) {
      return Object.freeze({ ok: false, errorCode: 'NETWORK_ERROR', message: err.message, profile: null });
    }
  }

  return Object.freeze({
    providerName: 'supabase-profile',
    isConfigured,
    getOwnProfile,
    createOwnProfile,
    updateOwnProfile,
    updatePrivateSettings,
    getPublicProfile
  });
}
