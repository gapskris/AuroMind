# B20 — Bucket 4: AuroMandala Artwork Integration & Privacy Report

**Project:** AuroMasti v2.0.0 Beta  
**Workspace:** `C:\AuroMindPortal`  
**Branch:** `dev/studio-integration`  
**Remote:** `origin`  
**Target Delivery:** November 30, 2026  
**Integration Scope:** AuroMandala Studio (`games/auromandala`), Causal Versioning & Local-First Artwork

---

## 1. Executive Summary

AuroMandala integrates with the AuroMind Shared Platform SDK through `games/auromandala/assets/auromandala-sdk-bridge.js` and `assets/sdk/artwork-concurrency.js`.

The implementation guarantees four core invariants:
1. **Local-First Authoritative Gallery:** Artwork creation, autosaving, and rendering operate 100% offline using localStorage (`pranamandala_game_cache_v2`).
2. **Explicit Cloud Backup:** Cloud export to Supabase Storage (`user-artwork`) is strictly user-initiated. No artwork is uploaded automatically during startup or background polling.
3. **Causal Vector Ordering & Conflict Forking:** Artwork conflicts never overwrite local or remote edits; divergent concurrent edits fork non-destructively into `[Title] (Recovered Copy)`.
4. **Sacred Sankalpa Vault Privacy:** The E2EE Sankalpa journal vault (`sankalpa_e2ee_vault`) is permanently quarantined to the local device (`capabilities.sankalpaSyncEligible = false`).

---

## 2. Artwork Entity Schema & Versioning Lifecycle

Artwork entities are stored as a dictionary keyed by UUIDv4 (`assets/sdk/artwork-concurrency.js`):

```typescript
interface ArtworkEntity {
  artworkId: string;              // UUIDv4 primary identifier
  title: string;                  // User-assigned title
  strokes: CanvasStroke[];        // Vector drawing strokes
  revision: number;               // Monotonically increasing revision counter (>= 1)
  parentRevisionId: string | null;// Causal parent hash/revision
  contentHash: string;            // SHA-256 of normalized strokes payload
  deleted: boolean;               // Soft-deletion tombstone flag
  deletedAt: string | null;       // ISO-8601 deletion timestamp
  snapshots: ImmutableSnapshot[]; // Capped rolling history (max 10)
  createdAt: string;              // ISO-8601
  updatedAt: string;              // ISO-8601
}
```

### 2.1 Rolling 10-Snapshot Ceiling
To prevent unbounded localStorage consumption on player devices, `capSnapshots(snapshots)` enforces an immutable 10-snapshot cap. When an artwork exceeds 10 snapshots, oldest revisions are pruned while preserving the current revision and causal parent links.

### 2.2 Conflict Forking Algorithm (`mergeArtworksWithForking`)
When synchronizing with cloud or another device:
- **Identical Hash:** No-op (synchronized).
- **Linear Revision Advancement:** If remote causally descends from local, remote is accepted cleanly.
- **Concurrent Divergence:** If both local and remote have advanced independently from the same parent:
  1. The local artwork is preserved verbatim.
  2. The incoming remote revision is forked into a new UUID with title `[Title] (Recovered Copy)`.
  3. Zero data is lost or silently overwritten.

---

## 3. Storage Integration & Path Isolation

When the player triggers explicit cloud backup:
- **Target Bucket:** `user-artwork` (private, 5 MiB file size cap).
- **Target Path Structure:** `${auth.uid()}/${artworkId}.json` (or `.png`).
- **Enforcement:** PostgreSQL RLS policy `artwork_owner_insert` verifies that `foldername[1] = auth.uid()` and rejects directory traversal sequences.
- **Cross-User Protection:** Another authenticated user attempting to read or overwrite the file is rejected with 0 rows affected by RLS `artwork_owner_select` and `artwork_owner_update`.

---

## 4. Sacred Sankalpa Privacy Isolation

The Sankalpa meditation journal allows players to record sacred personal reflections. 

### Architectural Protections:
- **Local-Only Flag:** Declared in adapter capabilities:
  ```javascript
  capabilities: {
    sankalpaSyncEligible: false,
    localOnlyVaults: ['sankalpa_e2ee_vault'],
    artworkSyncEligible: true,
    progressionSyncEligible: true
  }
  ```
- **Envelope Sanitization:** In `exportEnvelope(guestId)`, `sankalpa`, `sankalpa_reflections`, and `sankalpa_e2ee_vault` are explicitly stripped from outgoing payloads.
- **Merge Quarantine:** In `applyEnvelope(envelope)`, the local `existingCache.sankalpa` is preserved unmodified; any `sankalpa` field present in incoming envelopes is deleted.

---

## 5. Verification Test Evidence

Verified across two independent test suites:
1. `test-b20-bucket4-integration.test.js`:
   - Sankalpa E2EE vault strictly excluded from cloud sync: **PASS**
   - Artwork dictionary migration enforces UUIDv4 keys: **PASS**
   - Rolling snapshot cap limits history to 10: **PASS**
   - Conflict forking forks divergent remote into Recovered Copy: **PASS**
   - `applyEnvelope` preserves local Sankalpa vault: **PASS**
2. `b19-5-03-sync-artwork-flora.test.js` (81/81 passed):
   - Comprehensive causal vector ordering, tombstone resurrection, and quarantine: **PASS**
