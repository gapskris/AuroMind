# B18-A3 — Risk and Decision Register

**Author:** AuroMind Platform Architecture Team  
**Date:** November 21, 2026  
**Canonical Workspace:** `C:\AuroMindPortal`  
**Active Git Branch:** `dev/studio-integration`  
**Baseline HEAD Commit:** `b6ccc860bb7d38a70ef678049a9588b8b73c40aa`  
**Target Release:** January 1, 2027  
**Status:** READ-ONLY RISK & DECISION REGISTER  

---

## 1. Architecture Findings & Risk Register

Findings are prioritized by severity:
- **P0 (Critical / Blocker):** Must be resolved immediately; blocks architecture approval.
- **P1 (High):** Major functional or data integrity risk; blocks B18-B or B18-C.
- **P2 (Medium):** Important architectural enhancement; should be resolved during B18-B.
- **P3 (Low):** Minor operational or hygiene recommendation; scheduled for B19.

| Finding ID | Severity | Category | Description | Affected Files | Blocks Approval? | Blocks B18-B? | Blocks B18-C? |
|:---:|:---:|:---|:---|:---|:---:|:---:|:---:|
| **F-01** | **P1** | **Data Loss / Creative Work** | **AuroMandala Artwork Overwrite & Checksum Blindness:** `exportEnvelope()` omits `savedArtworks` from checksum, causing sync to miss artwork updates. `applyEnvelope()` does a blanket overwrite of the cache key, wiping local user-created mandalas. | `games/auromandala/assets/auromandala-sdk-bridge.js` | **NO** | **YES** | **YES** |
| **F-02** | **P1** | **Data Integrity** | **Ad-Hoc String Checksums Across Bridges:** AuroBlocks (`blocks_${highScore}_${stages.length}`) and AuroMatch (`match_${levels}_${petals}`) use crude string concatenations that miss internal payload mutations (stage scores, reflections). | `games/auroblocks/assets/auroblocks-sdk-bridge.js`, `games/auromatch/src/controllers/storageAdapter.js` | **NO** | **YES** | **YES** |
| **F-03** | **P1** | **Adapter Harmonization** | **Missing Standalone Adapter Bridges:** VAK, Word Riddle, and VAK Living Sanctuary lack standalone ES module adapter bridges implementing `exportEnvelope()` and `applyEnvelope()`. | `games/vak/`, `games/word-riddle/`, `games/vak-living-sanctuary/` | **NO** | **YES** | **YES** |
| **F-04** | **P2** | **Storage Durability** | **Missing Storage Eviction Defense:** The SDK does not request persistent storage quota via `navigator.storage.persist()`, leaving IndexedDB vulnerable to Safari 7-day ITP and Chromium LRU eviction. | `assets/sdk/auromind-sdk.js`, `assets/js/portal.js` | **NO** | **NO** | **YES** |
| **F-05** | **P2** | **Auto-Heal Asymmetry** | **AuroMatch LocalStorage Auto-Heal Defect:** `autoHealFromIndexedDB()` aborts if `localStorage.getItem('auro_match_user')` is truthy, failing to restore if the localStorage record is truncated or corrupt. | `games/auromatch/src/controllers/storageAdapter.js` | **NO** | **YES** | **NO** |
| **F-06** | **P2** | **Missing Contract** | **Unimplemented Achievements Contract:** `sdk.achievements` is proposed but not yet implemented as a formal service namespace in the SDK core. | `assets/sdk/auromind-sdk.js` | **NO** | **YES** | **NO** |
| **F-07** | **P2** | **Merge Fallback** | **Undefined Bespoke Merge Strategies:** Conflicting non-empty saves fall back to user choice dialogs because games lack domain-specific merge strategies. | `assets/sdk/auromind-adapters.js`, `games/*/` | **NO** | **YES** | **NO** |
| **F-08** | **P3** | **Offline Buffering** | **Telemetry Queue Overflow During Prolonged Offline Play:** Memory queue caps at 200 events, dropping older non-critical analytics when offline for extended periods. | `assets/sdk/auromind-sdk.js` | **NO** | **NO** | **NO** |
| **F-09** | **P3** | **Security / Hosting** | **Production CSP Replication:** Strict Content Security Policy headers defined in `server.js` must be replicated in static hosting configuration upon deployment. | `server.js`, hosting configs | **NO** | **NO** | **YES** |

---

## 2. In-Depth Finding Analysis & Actionable Recommendations

### F-01: AuroMandala Artwork Overwrite & Checksum Blindness
- **Severity:** **P1 (High)**
- **Evidence:** In `games/auromandala/assets/auromandala-sdk-bridge.js`:
  ```javascript
  // Line 78:
  checksum: 'mandala_' + (cacheData?.highestStageCleared || 0) + '_' + (cacheData?.sessions?.length || 0)
  // Line 86:
  localStorage.setItem(CACHE_KEY, JSON.stringify(envelope.payload.cache));
  ```
- **User Impact:** If a player creates or modifies a sacred mandala artwork, the save checksum does not change. The sync engine skips pushing the new artwork (Invariant 3). If a cloud sync does occur, `applyEnvelope` replaces the entire local cache, destroying any locally created artwork.
- **Recommendation:**
  1. Update `checksum` to compute a deterministic SHA-256 hash of the entire sanitized cache payload using `computePayloadChecksum`.
  2. Implement an append-only artwork collection merge strategy: merge `savedArtworks` by unique artwork UUID, never blindly overwriting local creations.
- **Blocks Approval:** No | **Blocks B18-B:** **YES** | **Blocks B18-C:** **YES**

---

### F-02: Ad-Hoc String Checksums Across Game Bridges
- **Severity:** **P1 (High)**
- **Evidence:**
  - AuroBlocks: `'blocks_' + (saveData?.highScore || 0) + '_' + (saveData?.stages?.length || 0)`
  - AuroMatch: `'match_' + (profileState?.progression?.completedLevelsCount || 0) + '_' + (profileState?.profile?.lotusPetalCount || 0)`
- **User Impact:** If a player improves their stage score in AuroBlocks or records reflections in AuroMatch, the checksum remains unchanged. The sync engine treats the save as unmodified, failing to back up player progress.
- **Recommendation:** Standardize all game adapters to use deterministic cryptographic checksums (`computePayloadChecksum` via Web Crypto `crypto.subtle.digest('SHA-256', ...)`).
- **Blocks Approval:** No | **Blocks B18-B:** **YES** | **Blocks B18-C:** **YES**

---

### F-03: Missing Standalone Native Adapter Bridges for Three Games
- **Severity:** **P1 (High)**
- **Evidence:** `games/vak/`, `games/word-riddle/`, and `games/vak-living-sanctuary/` persist save data into localStorage keys (`auro_vak_user`, `word_discovery_save_v1`, `vak_sanctuary_codex_v1`) via inlined scripts. None of them export a standalone `createGameAdapter()` module.
- **User Impact:** The SDK sync engine cannot discover, validate, export, or apply save envelopes for these three games, preventing cloud backup and cross-device synchronization.
- **Recommendation:** In B18-B, author dedicated adapter modules:
  - `games/vak/assets/vak-sdk-bridge.js`
  - `games/word-riddle/assets/word-riddle-sdk-bridge.js`
  - `games/vak-living-sanctuary/assets/vak-living-sanctuary-sdk-bridge.js`
- **Blocks Approval:** No | **Blocks B18-B:** **YES** | **Blocks B18-C:** **YES**

---

### F-04: Storage Eviction Vulnerability
- **Severity:** **P2 (Medium)**
- **Evidence:** Neither `auromind-sdk.js` nor `portal.js` calls `navigator.storage.persist()`.
- **User Impact:** In Safari/WebKit, unvisited web apps have their script-writable storage cleared after 7 days of inactivity. On mobile devices with low disk space, Chromium evicts non-persistent IndexedDB instances.
- **Recommendation:** Add a non-blocking request to `navigator.storage.persist()` during portal initialization. If granted, the browser marks the origin's IndexedDB as persistent.
- **Blocks Approval:** No | **Blocks B18-B:** No | **Blocks B18-C:** **YES**

---

### F-05: AuroMatch Auto-Heal One-Way Asymmetry
- **Severity:** **P2 (Medium)**
- **Evidence:** In `games/auromatch/src/controllers/storageAdapter.js` ([Line 117](file:///C:/AuroMindPortal/games/auromatch/src/controllers/storageAdapter.js#L117-L118)):
  ```javascript
  const hasLocal = localStorage.getItem('auromatch_player_state') || localStorage.getItem('auro_match_user');
  if (hasLocal) return false;
  ```
- **User Impact:** If localStorage contains a corrupted, empty, or partial object, auto-heal from the healthy IndexedDB vault is aborted.
- **Recommendation:** Parse and validate `auro_match_user`. If JSON parsing fails or `completedLevelsCount === 0` while IndexedDB has completed levels, proceed with auto-healing.
- **Blocks Approval:** No | **Blocks B18-B:** **YES** | **Blocks B18-C:** No

---

## 3. Architecture Decision Matrix (Ten ADR Reviews)

> **Notice:** All ten decisions remain **PROPOSED — PENDING OWNER APPROVAL**. Approval remains exclusively with the product owner.

| ADR # | Decision Title | Review Classification | Technical Justification & Conditions | Owner Approval |
|:---:|:---|:---:|:---|:---:|
| **ADR-01** | **Canonical Player Identity** | **Technically Sound with Conditions** | Sound under established product law: **1 browser profile = 1 player identity**. Condition: Formally rescind prior suggestions for in-app profile selectors / session-boundary dialogs. Separate browser profiles naturally represent separate players. | **PENDING OWNER APPROVAL** |
| **ADR-02** | **Opaque Save Payload** | **Technically Sound** | Standardized outer `SAVE_ENVELOPE_VERSION = 1` framing with opaque domain `payload` completely protects game diversity and allows independent schema evolution. | **PENDING OWNER APPROVAL** |
| **ADR-03** | **Singleton SDK Contract** | **Technically Sound** | Frozen ES module singleton (`Object.freeze`) encapsulates state, prevents script collisions, and provides uniform contracts across portal and games. | **PENDING OWNER APPROVAL** |
| **ADR-04** | **Non-Destructive Migration** | **Technically Sound** | Relational `guest_identity_links` join table maps device guest ID to registered account ID without overwriting local progress. | **PENDING OWNER APPROVAL** |
| **ADR-05** | **Offline Outbox & Concurrency** | **Sound with Conditions** | Sound in principle. Condition: Replace fragile ad-hoc string checksums with deterministic SHA-256 payload hashing (`F-02`). | **PENDING OWNER APPROVAL** |
| **ADR-06** | **Conflict Merge Strategies** | **Sound with Conditions** | Sound for progression. Condition: Explicitly exempt AuroMandala user-created artwork from automated union/max merges; treat artwork as append-only collection (`F-01`). | **PENDING OWNER APPROVAL** |
| **ADR-07** | **Local Operational Authority** | **Technically Sound** | Client device storage is primary operational authority; cloud is a durable synchronization replica. Essential for 100% offline gameplay. | **PENDING OWNER APPROVAL** |
| **ADR-08** | **Purchase Entitlements** | **Technically Sound with Conditions** | Sound for ad-free one-time theme purchases. Condition: Provider-agnostic server verification; public-key signed tokens; beta remains 100% free. | **PENDING OWNER APPROVAL** |
| **ADR-09** | **Privacy & Sankalpa Exclusion** | **Technically Sound** | Zero PII, 90-day retention, GDPR purge, and absolute triple-layer exclusion of the local-only E2EE Sankalpa contemplation vault. | **PENDING OWNER APPROVAL** |
| **ADR-10** | **Provider Adapter Pattern** | **Technically Sound** | Decouples games from concrete cloud SDKs. Hard-rejects service-role credentials in client code with explicit runtime exceptions. | **PENDING OWNER APPROVAL** |

---

## 4. Phase-Gating Roadmap: Prerequisites for B18-B & B18-C

```
+-----------------------------------------------------------------------------------------+
|                                    B18-A3 (Current)                                     |
|  - Architectural principle confirmed: 1 browser profile = 1 player identity             |
|  - Critical risks identified: Checksum blindness (F-02), Artwork overwrite (F-01)        |
|  - Sacred invariants verified 100% (VAK, Flora, Sankalpa)                               |
|  - ADR Decision Matrix delivered for owner review                                       |
+-----------------------------------------------------------------------------------------+
                                            |
                                            v
                                  [ Owner Review & Sign-Off ]
                                            |
                                            v
+-----------------------------------------------------------------------------------------+
|                                    B18-B (Local Remediation)                            |
|  - F-01: Fix AuroMandala artwork checksum and implement append-only artwork merge       |
|  - F-02: Standardize all save envelopes on deterministic SHA-256 payload checksums      |
|  - F-03: Author standalone adapter bridges for VAK, Word Riddle, VAK Sanctuary          |
|  - F-05: Fix AuroMatch auto-heal validation asymmetry                                   |
|  - F-06: Implement sdk.achievements interface & offline event persistence               |
|  - F-07: Implement bespoke merge strategies for progression data                        |
|  - Validate 100% offline regression suite (all existing 251 tests + new adapter tests)  |
+-----------------------------------------------------------------------------------------+
                                            |
                                            v
+-----------------------------------------------------------------------------------------+
|                                    B18-C (Backend Activation)                           |
|  - Provision Supabase project via official CLI                                          |
|  - Apply PostgreSQL migrations with verified RLS policies                               |
|  - Deploy Edge Functions (ingest-telemetry, sync-save, owner-metrics, cleanup)          |
|  - F-04: Call navigator.storage.persist() for persistent storage quota                  |
|  - F-09: Replicate strict Content Security Policy in production hosting headers         |
|  - Live real-browser cross-device integration validation                                |
+-----------------------------------------------------------------------------------------+
```
