# B21 — Milestone Bucket 5: AuroMandala Staging Acceptance Report

**Document Reference:** `docs/reports/B21_BUCKET_5_AUROMANDALA_STAGING_ACCEPTANCE.md`  
**Milestone:** B21 — Bucket 5: Staging Deployment, Live E2E Acceptance & Operational Closeout  
**Project:** AuroMasti v2.0.0 Beta  
**Game Identifier:** `auromandala`  
**Workspace:** `C:\AuroMindPortal`  
**Date:** November 28, 2026  
**Status:** COMPLETE & VERIFIED

---

## 1. Executive Summary

This report certifies the staging acceptance of **AuroMandala**, the contemplative sacred geometry and creative canvas title in the AuroMasti launch catalogue. AuroMandala adheres strictly to local-first architecture: mandala creations are stored on-device in browser IndexedDB, user-initiated cloud backup targets exclusively the `user-artwork` bucket, and sacred Sankalpa reflections are cryptographically isolated in a local-only vault with zero cloud sync capability.

---

## 2. Architecture & Bridge Integration

### 2.1 Bridge Initialization
AuroMandala initializes via `games/auromandala/assets/auromandala-sdk-bridge.js`:
- Entry point `games/auromandala/index.html` loads the bridge before application scripts.
- Bridge registers with the portal Shared SDK via `createAdapterRegistry` and `registerGameAdapter`.
- Capability declaration:
  - `artworkSyncEligible: true` (User-initiated cloud backup).
  - `sankalpaSyncEligible: false` (Zero cloud sync).
  - `localOnlyVaults: ['sankalpa_e2ee_vault']`.

### 2.2 Local-First Storage & Legacy Artwork Migration
- Canvas drawings and mandala metadata are committed to local IndexedDB.
- Backward compatibility: The artwork repository automatically executes `migrateArtworksToMap`, transforming legacy array-based artwork collections into keyed Maps with UUIDv4 identifiers, preserving user creations without data loss.

---

## 3. Sacred Data & Cloud Synchronization Invariants

### 3.1 Local-First Artwork Backup
- Cloud sync is **strictly user-initiated** via the "Backup to Cloud" action.
- Target storage bucket: `user-artwork` (private, authenticated owner RLS).
- Zero automated background pushes without user consent.
- Target bucket `mandala-cloud-sync` is permanently prohibited and absent.

### 3.2 Sankalpa Vault Cryptographic Sealing
- Vault name: `auromind_sankalpa_vault`.
- Encryption: Client-side AES-256-GCM.
- Inbound and outbound envelope shielding:
  - `exportEnvelope` strips all `sankalpa*` fields.
  - `applyEnvelope` strictly preserves the local on-device vault.
- Verified in `test-b20-bucket4-integration.test.js` (Subtests passed).

---

## 4. Offline & Service Worker Verification

- Service worker namespace: `auromandala-cache-v1`.
- Excluded from parent portal cache namespace to maintain child SW autonomy.
- Tested and verified under offline network disconnection: Loads mandala canvas and local gallery without network dependency.

---

## 5. Compliance Sign-Off

- [x] AuroMandala loads and initializes cleanly in iframe theater.
- [x] Local-first artwork persistence and legacy migration verified.
- [x] Cloud backup strictly user-initiated to `user-artwork`.
- [x] Zero `mandala-cloud-sync` bucket.
- [x] Sankalpa local-only vault sealed and verified.
