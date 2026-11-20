/**
 * AuroMind Shared Platform SDK — Firebase EntitlementsProvider Adapter
 *
 * Fetches server-verified entitlements for the authenticated player from Cloud Firestore.
 * Browser client is strictly read-only; writes are enforced by Firestore security rules.
 */

export function createFirebaseEntitlementsProvider(client) {
  function isConfigured() {
    return Boolean(client && client.isConfigured());
  }

  async function fetchEntitlements(userId) {
    if (!isConfigured() || !userId) {
      return Object.freeze([]);
    }

    try {
      const collectionPath = `users/${userId}/entitlements`;
      const { data, error } = await client.firestore.listDocuments(collectionPath);

      if (error || !Array.isArray(data)) {
        return Object.freeze([]);
      }

      // Filter active entitlements only
      const activeEntitlements = data.filter((rec) => rec.status === 'active');

      return Object.freeze(activeEntitlements.map((rec) => Object.freeze({
        sku: rec.sku,
        gameId: rec.gameId,
        tier: rec.tier || 'full',
        status: rec.status,
        verified: true, // Server-verified via Firestore rules and Cloud Functions
        source: rec.source || 'verified_purchase',
        grantedAt: rec.grantedAt || rec.__createTime,
        expiresAt: rec.expiresAt || null
      })));
    } catch {
      return Object.freeze([]);
    }
  }

  return Object.freeze({
    providerName: 'firebase-entitlements',
    isConfigured,
    fetchEntitlements
  });
}
