/**
 * AuroMind Shared Platform SDK — Supabase RemoteConfigProvider Adapter
 *
 * Fetches dynamic feature flags and configuration from Supabase `remote_config`.
 */

export function createSupabaseRemoteConfigProvider(client) {
  function isConfigured() {
    return Boolean(client && client.isConfigured());
  }

  async function fetchConfig(appVersion = null) {
    if (!isConfigured()) {
      return Object.freeze({});
    }

    try {
      const { data, error } = await client
        .from('remote_config')
        .select('key, value, min_app_version');

      if (error || !Array.isArray(data)) {
        return Object.freeze({});
      }

      const configMap = {};
      for (const row of data) {
        if (!row.key) continue;
        // Simple semver / min version check if specified
        if (row.min_app_version && appVersion && row.min_app_version > appVersion) {
          continue;
        }
        configMap[row.key] = row.value;
      }

      return Object.freeze(configMap);
    } catch {
      return Object.freeze({});
    }
  }

  return Object.freeze({
    providerName: 'supabase-remote-config',
    isConfigured,
    fetchConfig
  });
}
