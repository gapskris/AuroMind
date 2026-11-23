/**
 * AuroMind Shared Platform SDK — Supabase AccountProvider Adapter
 *
 * Implements user data export and account deletion workflows with strict
 * ownership verification, column-level grant alignment, and fail-closed
 * Edge Function deletion validation (zero client-table deletion fallback).
 */

const PUBLIC_PROFILE_COLUMNS = 'user_id,display_name,preferred_locale,is_public,created_at,updated_at';
const PRIVATE_SETTINGS_COLUMNS = 'preferences,analytics_opt_in,cloud_sync_opt_in,updated_at';

function isConfirmedAccountDeletionPayload(payload, expectedUserId) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return false;
  }
  if (payload.ok !== true) {
    return false;
  }
  if (payload.error !== undefined && payload.error !== null) {
    return false;
  }
  if (payload.deleted === false) {
    return false;
  }
  if (payload.deletedUserId !== undefined && payload.deletedUserId !== null) {
    return typeof payload.deletedUserId === 'string' && payload.deletedUserId.trim() === expectedUserId;
  }
  return payload.deleted === true;
}

export function createSupabaseAccountProvider(client) {
  function isConfigured() {
    return Boolean(client && client.isConfigured());
  }

  async function exportUserData(targetUserId = null) {
    if (!isConfigured()) return null;
    const activeUser = client.auth?.getUser?.();
    // Cross-account isolation: never export a different user's data when an active session is present
    if (activeUser?.id && targetUserId && targetUserId !== activeUser.id) {
      return null;
    }
    const userId = targetUserId || activeUser?.id;
    if (!userId) return null;

    try {
      const [profileRes, privateSettingsRes, linksRes, savesRes, entRes] = await Promise.all([
        client.from('user_profiles').select(PUBLIC_PROFILE_COLUMNS).eq('user_id', userId).maybeSingle(),
        Promise.resolve(
          client.from('user_private_settings').select(PRIVATE_SETTINGS_COLUMNS).eq('user_id', userId).maybeSingle()
        ).catch(() => ({ data: null, error: null })),
        client.from('guest_identity_links').select('guest_id, device_label, linked_at').eq('user_id', userId),
        client.from('game_saves').select('game_id, revision, checksum, client_updated_at').eq('user_id', userId),
        client.from('entitlements').select('sku, game_id, tier, status, granted_at').eq('user_id', userId)
      ]);

      return Object.freeze({
        userId,
        email: activeUser?.email || null,
        profile: profileRes?.data || null,
        privateSettings: privateSettingsRes?.error ? null : (privateSettingsRes?.data || null),
        linkedDevices: Array.isArray(linksRes?.data) ? linksRes.data : [],
        cloudSaves: Array.isArray(savesRes?.data) ? savesRes.data : [],
        gameSaves: Array.isArray(savesRes?.data) ? savesRes.data : [],
        entitlements: Array.isArray(entRes?.data) ? entRes.data : [],
        exportedAt: new Date().toISOString()
      });
    } catch {
      return null;
    }
  }

  async function deleteUserData(targetUserId = null) {
    if (!isConfigured()) return false;
    if (typeof client.requestWithTimeout !== 'function' || !client.url) {
      return false;
    }
    const activeUser = client.auth?.getUser?.();
    // Cross-account isolation: refuse deletion for a mismatched userId
    if (activeUser?.id && targetUserId && targetUserId !== activeUser.id) {
      return false;
    }
    const rawUserId = targetUserId || activeUser?.id;
    const userId = typeof rawUserId === 'string' ? rawUserId.trim() : '';
    if (!userId) return false;

    try {
      // Authoritative path ONLY: delete-account Edge Function (atomically deletes auth.users + cascades FKs).
      // Never fall back to deleting dependent tables directly if the Edge Function is missing (404) or fails.
      const res = await client.requestWithTimeout(`${client.url}/functions/v1/delete-account`, {
        method: 'POST',
        headers: client.getStandardHeaders ? client.getStandardHeaders() : {},
        body: JSON.stringify({ userId })
      });

      if (!res || !res.ok || typeof res.status !== 'number' || res.status < 200 || res.status >= 300) {
        return false;
      }
      if (typeof res.json !== 'function') {
        return false;
      }

      const payload = await res.json();
      if (!isConfirmedAccountDeletionPayload(payload, userId)) {
        return false;
      }

      // Sign out client session ONLY after confirmed Edge Function account deletion
      if (client.auth && typeof client.auth.signOut === 'function') {
        await client.auth.signOut();
      }
      return true;
    } catch {
      return false;
    }
  }

  return Object.freeze({
    providerName: 'supabase-account',
    isConfigured,
    exportUserData,
    deleteUserData
  });
}
