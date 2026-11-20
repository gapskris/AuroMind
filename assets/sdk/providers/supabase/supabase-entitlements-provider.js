/**
 * AuroMind Shared Platform SDK — Supabase EntitlementsProvider Adapter
 *
 * Fetches server-verified entitlements for the authenticated player.
 * Browser client is strictly read-only; writes are enforced by server RLS.
 */

export function createSupabaseEntitlementsProvider(client) {
  function isConfigured() {
    return Boolean(client && client.isConfigured());
  }

  async function fetchEntitlements(userId) {
    if (!isConfigured() || !userId) {
      return Object.freeze([]);
    }

    try {
      const { data, error } = await client
        .from('entitlements')
        .select('sku, game_id, tier, status, source, granted_at, expires_at')
        .eq('user_id', userId)
        .eq('status', 'active');

      if (error || !Array.isArray(data)) {
        return Object.freeze([]);
      }

      return Object.freeze(data.map((rec) => Object.freeze({
        sku: rec.sku,
        gameId: rec.game_id,
        tier: rec.tier || 'full',
        status: rec.status,
        verified: true,
        source: rec.source,
        grantedAt: rec.granted_at,
        expiresAt: rec.expires_at || null
      })));
    } catch {
      return Object.freeze([]);
    }
  }

  return Object.freeze({
    providerName: 'supabase-entitlements',
    isConfigured,
    fetchEntitlements
  });
}
