# AuroMasti B18-B1 — Implementation Risk & Rollback Plan
## Technical Risk Mitigation, Safe Failure Modes, Feature-Flag Governance, and Granular Rollback Protocols

- **Document Version:** 1.0.0
- **Batch Reference:** B18-B1 Master Implementation Execution Plan
- **Canonical Workspace:** `C:\AuroMindPortal`
- **Target Release:** January 1, 2027
- **Governance Mandate:** All 10 original ADRs remain **PENDING OWNER APPROVAL**. This plan establishes safe operational boundaries and granular rollback procedures for Phase B18-B1 execution.

---

## 1. Technical & Data-Integrity Risk Register

| Risk ID | Risk Category | Potential Failure Mode & Impact | Probability | Impact Severity | Mitigation Strategy in B18-B1 Architecture |
| :--- | :--- | :--- | :---: | :---: | :--- |
| **RSK-01** | Data Loss | AuroMandala artwork corruption or data loss during legacy array migration to UUIDv4. | Low | **HIGH** | Dual-read fallback: Read legacy array, convert in RAM, archive raw backup to `localStorage.pranamandala_legacy_backup` before writing new schema. |
| **RSK-02** | Concurrency | Web Locks timeout in background browser tabs causing split-brain guest identities. | Medium | **MEDIUM** | 3000ms lock timeout fallback to cross-tab storage events (`window.onstorage`); earliest `createdAt` timestamp wins deterministically. |
| **RSK-03** | Save Rejection | Checksum mismatch rejecting valid older saves during hash engine migration. | Low | **HIGH** | Legacy checksum tolerance: If save lacks canonical SHA-256 header, validate via schema version and upgrade hash on next user save write. |
| **RSK-04** | Storage Quota | Browser denies `navigator.storage.persist()` or disk is 100% full. | High | **MEDIUM** | Graceful degradation to RAM-backed `InMemoryStorageAdapter` with amber portal warning and one-click JSON backup export. Gameplay never blocked. |
| **RSK-05** | Regression | Missing bridge modules in standalone mode causing uncaught script exceptions. | Low | **HIGH** | Every game bridge embeds self-contained mock fallback (`createLocalMockBridge`); standalone execution passes 100% offline. |
| **RSK-06** | Sacred Drift | Accidental modification of VAK Speech Corpus or Flora Botanical Database. | Low | **CRITICAL** | Automated test suites execute preflight and postflight SHA-256 byte verification; test runner aborts build on single-byte mismatch. |
| **RSK-07** | Performance | Web Crypto SHA-256 computation causing main thread frame drops during fast block drops. | Medium | **LOW** | Debounce save envelope extraction to 500ms; execute Web Crypto asynchronously off the critical rendering path. |

---

## 2. Multi-Tier Rollback Protocols

If an unexpected defect or regression is detected during Phase B18-B1 implementation, three tiers of rollback are available:

### Tier 1: Real-Time Feature Flag Deactivation (Zero File Changes)
The platform configuration in `assets/sdk/config/backend-config.js` maintains modular feature flags. Disabling any flag reverts the specific subsystem to its pre-B18-B1 baseline instantly without modifying game code:

```javascript
export const FEATURE_FLAGS = {
  // Feature flags governing B18-B1 implementation:
  ENABLE_CRYPTO_CHECKSUM: true,       // If false, falls back to legacy string hash
  ENABLE_STORAGE_PERSISTENCE: true,   // If false, skips navigator.storage.persist()
  ENABLE_ROBUST_AUTOHEAL: true,       // If false, falls back to legacy storageAdapter
  ENABLE_ACHIEVEMENTS_SERVICE: true,  // If false, bypasses achievements queueing
  ENABLE_PRIORITIZED_TELEMETRY: true, // If false, falls back to legacy 200-event queue
  
  // Launch state invariant (STRICTLY FALSE for Jan 1, 2027 release):
  COMMERCIAL_GATE_ENABLED: false,     // Keeps entire platform 100% free and open
  ENABLE_CLOUD_SYNC: false            // Cloud sync remains disabled until Phase B18-C
};
```

### Tier 2: Granular File-Level Git Rollback
Because every game adapter bridge is self-contained in its own directory, any individual bridge can be rolled back independently without destabilizing other games:

```bash
# Example: Reverting only the AuroMandala bridge if an artwork bug occurs:
git -C "C:\AuroMindPortal" checkout HEAD -- games/auromandala/assets/auromandala-sdk-bridge.js

# Example: Reverting only the AuroMatch storage adapter:
git -C "C:\AuroMindPortal" checkout HEAD -- games/auromatch/src/controllers/storageAdapter.js
```

### Tier 3: Local Storage Save State Recovery
- When legacy saves are upgraded (e.g. in AuroMandala), the original unmigrated string is archived in `localStorage.setItem('pranamandala_legacy_backup', rawJson)`.
- If a player encounters an issue with the versioned artwork model, the bridge can be rolled back, and the legacy backup key remains untouched and ready for immediate restoration.

---

## 3. Safe Failure Modes Summary

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          SAFE FAILURE MODES MATRIX                              │
├────────────────────┬─────────────────────────────┬──────────────────────────────┤
│ SUBSYSTEM          │ FAILURE CONDITION           │ OPERATIONAL FALLBACK STATE   │
├────────────────────┼─────────────────────────────┼──────────────────────────────┤
│ Storage Engine     │ Total storage quota full    │ Degrades to in-memory RAM;   │
│                    │ or private mode lockdown    │ amber banner; JSON export.   │
├────────────────────┼─────────────────────────────┼──────────────────────────────┤
│ Shared SDK         │ Game opened outside theater │ Bridge activates local mock; │
│                    │ (standalone URL navigation) │ saves locally; zero crashes. │
├────────────────────┼─────────────────────────────┼──────────────────────────────┤
│ Telemetry Queue    │ CRITICAL tier saturated     │ Observable console error;    │
│                    │ (100 events full)           │ increments overflow counter. │
├────────────────────┼─────────────────────────────┼──────────────────────────────┤
│ Sync Outbox        │ Network offline or 5xx      │ Buffers in IndexedDB; retry  │
│                    │ server error                │ with backoff; play unblocked.│
├────────────────────┼─────────────────────────────┼──────────────────────────────┤
│ AuroMandala Sync   │ Concurrent stroke conflict  │ Local preserved; remote      │
│                    │ between two devices         │ forked into `(Cloud Copy)`.  │
└────────────────────┴─────────────────────────────┴──────────────────────────────┘
```

---

## 4. Rollback Acceptance Criteria

Before authorizing a rollback in any workstream:
1. The defect must be isolated to a specific module or feature flag.
2. The rollback must restore 100% test pass rate across the baseline 251 tests.
3. No local save progress or player artwork may be purged during the rollback.
