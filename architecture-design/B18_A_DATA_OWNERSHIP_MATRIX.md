# B18-A — Data Ownership & Storage Sovereignty Matrix

**Author:** AuroMind Platform Architecture Team  
**Date:** November 21, 2026  
**Canonical Workspace:** `C:\AuroMindPortal`  
**Active Git Branch:** `dev/studio-integration`  
**Baseline HEAD Commit:** `b6ccc860bb7d38a70ef678049a9588b8b73c40aa`  
**Target Release:** January 1, 2027  

---

## 1. Data Classification & Ownership Taxonomy

Every piece of data generated, processed, or persisted within the AuroMasti ecosystem belongs to one of four sovereignty tiers:

```
+---------------------------------------------------------------------------------------------------+
|                                     DATA SOVEREIGNTY TIERS                                        |
+---------------------------------------------------------------------------------------------------+
| TIER 0: SACRED & IMMUTABLE (ReadOnly local corpus, bit-exact checksums, immutable platform assets)  |
| TIER 1: STRICTLY LOCAL-ONLY (User private E2EE vaults, local encryption keys; NEVER cloud-synced) |
| TIER 2: LOCAL AUTHORITATIVE / CLOUD SYNCHRONIZED (Game saves, player profiles, opt-in backup)      |
| TIER 3: SERVER AUTHORITATIVE (Payment entitlements, authenticated identity, remote configuration)  |
+---------------------------------------------------------------------------------------------------+
```

---

## 2. Comprehensive Data Ownership Matrix

| Data Domain / Entity | Primary Local Store | Cloud Mirror / Destination | Authoritative Source | Cloud Sync Status | Protection / Encryption | Lifecycle & GDPR Purge |
|:---|:---|:---|:---:|:---:|:---|:---|
| **Platform Guest Identity** | IndexedDB: `AuroMindPlatformDB` (`guest_identity`) + LS: `auromind.platform.v1.guest` | Table: `guest_identity_links` (`user_id`, `guest_id`) | **Local Device** | Linked on Account Registration | UUIDv4, Web Locks, cross-tab reconciliation | Retained across sessions; reset via Clear All Data |
| **Player Profile & Preferences** | LocalStorage: `auromind.platform.v1.player_profile` | Table: `user_profiles` (`preferences`, `display_name`) | **Local Device** | Sync Eligible (Opt-In) | Plaintext JSON, sanitized strings | Exportable via GDPR; cleared via `sdk.player.deleteUserData()` |
| **AuroMatch Save Data** | IndexedDB: `AuroMatchDB` (`gameState`) + LS: `auromatch_player_state` | Table: `game_saves` (`game_id = 'auromatch'`) | **Local Device** | Sync Eligible (Opt-In) | Save Envelope v1, SHA-256 payload checksum | Purged via in-game Absolute Purge or GDPR account delete |
| **AuroBlocks Save Data** | LocalStorage: `auroblocks_player_save_v1` & `auroblocks_high_score` | Table: `game_saves` (`game_id = 'auroblocks'`) | **Local Device** | Sync Eligible (Opt-In) | Save Envelope v1, High score integrity | Purged via Clear Cache or GDPR account delete |
| **AuroMandala Artwork & Stages** | LocalStorage: `pranamandala_game_cache_v2` | Table: `game_saves` (`game_id = 'auromandala'`) | **Local Device** | Sync Eligible (Non-Sankalpa only) | Save Envelope v1, stripped of Sankalpa data | Purged via Clear Cache or GDPR account delete |
| **Sankalpa Contemplation Vault** | LocalStorage: `sankalpa_e2ee_vault` / memory | **NONE (Cloud Prohibited)** | **Local Device Only** | **STRICTLY EXCLUDED (`cloudSyncEligible: false`)** | **Web Crypto AES-GCM (Passphrase-derived Key)** | Local-only; destroyed upon local storage purge |
| **VAK Speech Puzzles & Progress** | LocalStorage: `auro_vak_user` | Table: `game_saves` (`game_id = 'vak'`) | **Local Device** | Sync Eligible (Opt-In) | Plaintext progress record, level counters | Purged via Clear Cache or GDPR account delete |
| **Word Riddle Solved Riddles** | LocalStorage: `word_discovery_save_v1` | Table: `game_saves` (`game_id = 'word-riddle'`) | **Local Device** | Sync Eligible (Opt-In) | Plaintext array of solved riddle IDs | Purged via Clear Cache or GDPR account delete |
| **VAK Living Sanctuary Codex** | LocalStorage: `vak_sanctuary_codex_v1` | Table: `game_saves` (`game_id = 'vak-living-sanctuary'`) | **Local Device** | Sync Eligible (Opt-In) | Plaintext unlocked discovery keys | Purged via Clear Cache or GDPR account delete |
| **VAK 1,368-Level Speech Corpus** | Embedded in DOM: `games/vak/index.html` (`const CL`) | **NONE (Static Bundle)** | **Repository Code** | **STRICTLY EXCLUDED (Read-Only)** | SHA-256: `9fdb3826030049...` (Immutable) | Permanent static asset; never purged |
| **AuroMatch Flora Database** | Static JS: `games/auromatch/src/models/floraDatabase.js` | **NONE (Static Bundle)** | **Repository Code** | **STRICTLY EXCLUDED (Read-Only)** | 2,002,176 Bytes, SHA-256: `689d035c...` (Immutable) | Permanent static asset; never purged |
| **Platform Telemetry Queue** | LocalStorage: `auromind.platform.v1.telemetry_queue` (max 200) | Edge Function: `ingest-telemetry` -> Table: `telemetry_events` | **Server Ingestion** | Batch Transport (Opt-In) | Zero PII, UUIDv4 event IDs, rate-limited | Automated 90-day retention cleanup handler |
| **Commercial Entitlements** | LocalStorage: `auromind.platform.v1.entitlements_cache` | Table: `entitlements` (`sku`, `tier`, `status`) | **Server (Supabase)** | Read-Only Local Cache | Signed server claims, RLS enforced | Revoked on refund/expiration; cleared on sign out |
| **Remote Feature Flags** | LocalStorage: `auromind.platform.v1.config_cache` | Table: `remote_config` (`key`, `value`) | **Server (Supabase)** | Read-Only Local Cache | Fallback defaults, min semver check | Overwritten on refresh; reset on purge |
| **Active Auth Session** | LocalStorage: `auromind.platform.v1.supabase_session` | Supabase Auth GoTrue Server | **Server (Supabase)** | Session Token Exchange | JWT with automatic expiration, SSL/TLS | Cleared immediately on `signOut()` |

---

## 3. Storage Key Namespace Architecture

To prevent accidental cross-game contamination or overwrite, the platform partitions localStorage and IndexedDB into strict, protected boundaries:

```
LocalStorage Root
├── auromind.platform.*                   <-- RESERVED FOR SHARED PLATFORM SDK ONLY
│   ├── auromind.platform.v1.guest        (Shared device guest identity UUIDv4)
│   ├── auromind.platform.v1.player_profile (Preferences, audio, senior mode)
│   ├── auromind.platform.v1.sync_consent (Cloud sync opt-in flag)
│   ├── auromind.platform.v1.sync_outbox  (Pending offline sync game IDs)
│   ├── auromind.platform.v1.telemetry_consent (Analytics opt-in flag)
│   ├── auromind.platform.v1.telemetry_queue   (Buffered telemetry events)
│   ├── auromind.platform.v1.entitlements_cache (Cached server passes)
│   └── auromind.platform.v1.config_cache      (Cached remote flags)
│
├── auro_match_* / auromatch_*            <-- OWNED BY AUROMATCH ONLY
│   ├── auromatch_player_state
│   ├── auro_match_unlocked_tiles
│   └── auro_match_consecrations
│
├── auroblocks_*                          <-- OWNED BY AUROBLOCKS ONLY
│   ├── auroblocks_player_save_v1
│   ├── auroblocks_high_score
│   └── auroblocks_stages
│
├── pranamandala_*                        <-- OWNED BY AUROMANDALA ONLY
│   ├── pranamandala_game_cache_v2
│   └── sankalpa_e2ee_vault               (STRICTLY LOCAL-ONLY)
│
├── auro_vak_*                            <-- OWNED BY VAK ONLY
│   └── auro_vak_user
│
├── word_discovery_*                      <-- OWNED BY WORD RIDDLE ONLY
│   └── word_discovery_save_v1
│
└── vak_sanctuary_*                       <-- OWNED BY VAK SANCTUARY ONLY
    └── vak_sanctuary_codex_v1

IndexedDB Databases
├── AuroMindPlatformDB (v1)               <-- RESERVED FOR SHARED PLATFORM (platform_meta)
└── AuroMatchDB (v1)                      <-- OWNED BY AUROMATCH (gameState)
```

---

## 4. Sacred Privacy Guarantee: Sankalpa Contemplation Vault

The AuroMandala Sankalpa contemplation vault represents intimate, conscious spiritual aspirations written by players during contemplation. The architecture enforces three layers of isolation:

1. **Adapter Boundary Declaration:**
   ```javascript
   // In games/auromandala/assets/auromandala-sdk-bridge.js
   storage: {
     kind: 'ls',
     ownedLocalStorageKeys: ['pranamandala_game_cache_v2'],
     localOnlyVaults: ['sankalpa_e2ee_vault']
   },
   capabilities: {
     cloudSyncEligible: false, // Prevents automatic cloud sync
     hasLocalOnlyVaults: true,
     localOnlyVaults: ['sankalpa_e2ee_vault']
   }
   ```
2. **Sync Engine Rejection:**
   In `assets/sdk/auromind-sdk.js` (`syncService.syncNow()`), any game declaring `hasLocalOnlyVaults === true` is explicitly skipped by default:
   ```javascript
   if (caps.hasLocalOnlyVaults) {
     loggingService.warn('sync', `Skipping game "${gid}" with declared local-only vaults`);
     continue;
   }
   ```
3. **Migration Engine Privacy Interceptor:**
   In `assets/sdk/migration/backend-migration.js`, export payloads are scanned with regex `/sankalpa|sankalpa_e2ee_vault/i`. If detected, the migration pipeline throws a critical security error and refuses to produce an export artifact.

---

## 5. GDPR & Data Subject Rights Implementation

The platform implements the following functions for user sovereignty:

1. **Right of Access & Portability (`sdk.player.exportUserData()`):**
   Generates a unified JSON file containing:
   - Guest identity UUID and creation timestamps.
   - Profile preferences, display name, and statistics.
   - All active entitlements and recent diagnostics.
   - Complete cloud save records (if authenticated with Supabase).
2. **Right to Erasure / "Absolute Purge" (`sdk.player.deleteUserData()`):**
   - Wipes local profile, preferences, telemetry queue, entitlements, and config cache.
   - Calls Supabase `delete-account` Edge Function to remove cloud records.
   - Deletes rows in `game_saves`, `guest_identity_links`, and `user_profiles` through RLS.
   - Performs `signOut()` to invalidate active JWTs.
