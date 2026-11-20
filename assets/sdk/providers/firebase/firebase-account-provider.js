/**
 * AuroMind Shared Platform SDK — Firebase AccountProvider Adapter
 *
 * Implements user data export and account deletion workflows for Google Firebase.
 *
 * Safety Invariants:
 * 1. Deletes ONLY cloud data (Firestore documents + Firebase Auth user).
 * 2. Local game progress remains untouched until explicit local action.
 * 3. Accounts for all user-associated cloud paths:
 *    - `users/{userId}/game_saves/*`
 *    - `users/{userId}/guest_identity_links/*`
 *    - `users/{userId}/entitlements/*`
 *    - `users/{userId}` profile doc
 *    - Firebase Auth user record
 */

export function createFirebaseAccountProvider(client) {
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
        client.firestore.getDocument(`users/${userId}`),
        client.firestore.listDocuments(`users/${userId}/guest_identity_links`),
        client.firestore.listDocuments(`users/${userId}/game_saves`),
        client.firestore.listDocuments(`users/${userId}/entitlements`)
      ]);

      const cloudSaves = savesRes.data || [];

      return Object.freeze({
        userId,
        email: activeUser?.email || null,
        profile: profileRes.data || null,
        linkedDevices: linksRes.data || [],
        cloudSaves,
        gameSaves: cloudSaves,
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
      // 1. Invoke trusted server-side Cloud Function if available
      try {
        await client.functions.call('deleteAccount', { userId });
      } catch {
        // Fallback to client-side document cleanup if function unconfigured
      }

      // 2. Comprehensive cleanup of all user-associated Firestore documents
      const [linksRes, savesRes, entRes] = await Promise.all([
        client.firestore.listDocuments(`users/${userId}/guest_identity_links`),
        client.firestore.listDocuments(`users/${userId}/game_saves`),
        client.firestore.listDocuments(`users/${userId}/entitlements`)
      ]);

      const deletePromises = [];

      for (const link of linksRes.data || []) {
        const id = link.guestId || link.id;
        if (id) deletePromises.push(client.firestore.deleteDocument(`users/${userId}/guest_identity_links/${id}`));
      }

      for (const save of savesRes.data || []) {
        const id = save.gameId || save.id;
        if (id) deletePromises.push(client.firestore.deleteDocument(`users/${userId}/game_saves/${id}`));
      }

      for (const ent of entRes.data || []) {
        const id = ent.sku || ent.id;
        if (id) deletePromises.push(client.firestore.deleteDocument(`users/${userId}/entitlements/${id}`));
      }

      deletePromises.push(client.firestore.deleteDocument(`users/${userId}`));
      await Promise.all(deletePromises);

      // 3. Delete Firebase Auth user record
      try {
        if (typeof client.auth.deleteUserAccount === 'function') {
          await client.auth.deleteUserAccount();
        }
      } catch {
        // Non-fatal if session already revoked
      }

      // 4. Clear local session tokens
      if (typeof client.auth.signOut === 'function') {
        await client.auth.signOut();
      }

      return true;
    } catch {
      return false;
    }
  }

  return Object.freeze({
    providerName: 'firebase-account',
    isConfigured,
    exportUserData,
    deleteUserData
  });
}
