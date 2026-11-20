/**
 * AuroMind Shared Platform SDK — Supabase AccountProvider Adapter
 *
 * Implements user data export and account deletion workflows.
 */

export function createSupabaseAccountProvider(client) {
  function isConfigured() {
    return Boolean(client && client.isConfigured());
  }

  async function exportUserData(targetUserId = null) {
    if (!isConfigured()) return null;
    const activeUser = client.auth?.getUser?.();
    const userId = targetUserId || activeUser?.id;
    if (!userId) return null;

    try {
      const [profileRes, linksRes, savesRes, entRes] = await Promise.all([
        client.from('user_profiles').select('*').eq('user_id', userId).maybeSingle(),
        client.from('guest_identity_links').select('guest_id, device_label, linked_at').eq('user_id', userId),
        client.from('game_saves').select('game_id, revision, checksum, client_updated_at').eq('user_id', userId),
        client.from('entitlements').select('sku, game_id, tier, status, granted_at').eq('user_id', userId)
      ]);

      return Object.freeze({
        userId,
        email: activeUser?.email || null,
        profile: profileRes.data || null,
        linkedDevices: linksRes.data || [],
        cloudSaves: savesRes.data || [],
        gameSaves: savesRes.data || [],
        entitlements: entRes.data || [],
        exportedAt: new Date().toISOString()
      });
    } catch {
      return null;
    }
  }

  async function deleteUserData(targetUserId = null) {
    if (!isConfigured()) return false;
    const activeUser = client.auth?.getUser?.();
    const userId = targetUserId || activeUser?.id;
    if (!userId) return false;

    try {
      // Invoke Edge Function if available
      try {
        if (client.requestWithTimeout && client.url) {
          await client.requestWithTimeout(`${client.url}/functions/v1/delete-account`, {
            method: 'POST',
            headers: client.getStandardHeaders ? client.getStandardHeaders() : {},
            body: JSON.stringify({ userId })
          });
        }
      } catch {}

      // Delete game saves, guest links, and profile through RLS
      await Promise.all([
        client.from('game_saves').delete().eq('user_id', userId),
        client.from('guest_identity_links').delete().eq('user_id', userId),
        client.from('user_profiles').delete().eq('user_id', userId)
      ]);

      // Sign out client session
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
