/**
 * AuroMind Shared Platform SDK — Firebase RemoteConfigProvider Adapter
 *
 * Fetches dynamic feature flags and configuration from Firestore `remote_config` collection.
 */

export function createFirebaseRemoteConfigProvider(client) {
  function isConfigured() {
    return Boolean(client && client.isConfigured());
  }

  async function fetchConfig(appVersion = null) {
    if (!isConfigured()) {
      return Object.freeze({});
    }

    try {
      const { data, error } = await client.firestore.listDocuments('remote_config');

      if (error || !Array.isArray(data)) {
        return Object.freeze({});
      }

      const configMap = {};
      for (const row of data) {
        const key = row.key || row.id;
        if (!key) continue;

        // Semantic / lexical version check
        if (row.minAppVersion && appVersion && row.minAppVersion > appVersion) {
          continue;
        }

        configMap[key] = row.value !== undefined ? row.value : row;
      }

      return Object.freeze(configMap);
    } catch {
      return Object.freeze({});
    }
  }

  return Object.freeze({
    providerName: 'firebase-remote-config',
    isConfigured,
    fetchConfig
  });
}
