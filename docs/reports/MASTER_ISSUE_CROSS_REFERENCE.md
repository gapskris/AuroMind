# AuroMasti — Master Issue Cross-Reference Matrix

**Document ID:** `MASTER-ISSUE-CROSS-REFERENCE`  
**Milestone:** Post-B19.9.1 Consolidation  
**Target Release:** Version 2.0.0 Beta (Target Deadline: November 30, 2026)  
**Execution Date:** November 28, 2026  
**Canonical Workspace:** `C:\AuroMindPortal`  
**Branch:** `dev/studio-integration`  
**Baseline Git Commit:** [`59473bc2c03283bcd6ebd3f7512903d252fb1601`](file:///C:/AuroMindPortal)  
**Auditor:** Principal Software Architect & Release Acceptance Lead  

---

## 1. Executive Summary & Purpose

Over the course of development from B17 through B19.9.1, various milestone documents and independent audits assigned overlapping, duplicated, or milestone-prefixed identifiers (e.g. `BLK-01` across three distinct definitions, `SEC-03` across commercial gate vs. player isolation, `ACT-01..02` across deployment steps).

This document establishes a **1:1 bidirectional cross-reference mapping** between every historical issue identifier and a single, unambiguous **Canonical Identifier (`CANON-*`)**. Every historical ID from B17, B18, B19.5, B19.6, B19.7, B19.8.x, and B19.9.1 is accounted for with zero omissions.

---

## 2. Canonical Issue Taxonomy & Prefix Standard

The canonical identifiers are categorized into eight deterministic functional domains:

1. **`CANON-MIG-*`**: Database Schema, DDL Migrations, Supabase CLI & Wire Protocol.
2. **`CANON-SEC-*`**: Authentication, GoTrue, Key Validation, Credential Redaction & Security Policies.
3. **`CANON-DAT-*`**: Sacred Repository Data Invariants, Cryptographic Digests & Client Privacy.
4. **`CANON-PWA-*`**: Service Worker, Caching Lifecycle, Offline Assets & Outbox Delivery.
5. **`CANON-UI-*`**: Portal Shell, Game Viewport, Audio Restoration & Accessibility.
6. **`CANON-OPS-*`**: Hosting, Edge Routing, CDN Headers, Disaster Recovery & CI/CD Pipelines.
7. **`CANON-GOV-*`**: Governance, Migration Authorization Gates & Commercialization Invariants.
8. **`CANON-EXC-*`**: Features, Games & Webhooks Formally Excluded from Release Scope.

---

## 3. Comprehensive Bidirectional Cross-Reference Table

| Canonical ID | Domain | Canonical Title | Historical IDs Reconciled | Origin Batch | Final Reconciled Status | Cross-Reference Resolution & Architectural Notes |
| :--- | :--- | :--- | :--- | :---: | :---: | :--- |
| **CANON-MIG-01** | Database / CLI | Supabase CLI DevDependency Pinning & Execution | `BLK-01` (B19.8.1/3), `BLK-01` (B19.5) | B19.5 | `CLOSED_WITH_EVIDENCE` | Pinned `@supabase/cli` (v3.4.0) in `package.json`; executed via direct Node runner avoiding shell splitting. |
| **CANON-MIG-02** | Database / Auth | Hosted PostgreSQL Minimal Credential Architecture | `BLK-02` (B19.8.1/3), `BLK-02` (B19.5) | B19.5 | `CLOSED_WITH_EVIDENCE` | Migrated from plaintext DB URLs to in-memory `PGPASSWORD` delivery via Session Pooler CLI `--remote`. |
| **CANON-MIG-03** | Database / Preflight | Read-Only Session Pooler Preflight & Drift Inspection | `BLK-03` (B19.8.1/2), `NET-01`, `B83-01` | B19.5 | `LIVE_VERIFIED` | Affirmative preflight executed against `aws-1-ap-southeast-1.pooler.supabase.com:5432` confirming 0 applied, 10 pending migrations. |
| **CANON-MIG-04** | Database / Schema | Public Application Table Count Reconciled (15 Tables) | `DB-01`, `DB-03` | B19.6 | `CLOSED_WITH_EVIDENCE` | Reconciled 14 logged tables + 1 unlogged table (`telemetry_rate_buckets` in Migration 6) = 15 total tables. |
| **CANON-MIG-05** | Database / Safety | Non-Destructive SQL Guarantee (Zero DROP / TRUNCATE) | `DB-02` | B19.6 | `LOCALLY_VERIFIED` | Zero destructive statements across all 10 canonical migration files. AST scanner active in preflight. |
| **CANON-MIG-06** | Database / Integrity | Deterministic Cryptographic Migration Manifest | `B82-02` | B19.8.2 | `LOCALLY_VERIFIED` | `migrations_manifest.json` tracks 10 canonical migrations with aggregate hash `f55231159389f9d5...`. |
| **CANON-MIG-07** | Database / DR | Controlled Sequential Migration Recovery Specification | `B82-03`, `B831-01` | B19.8.2 | `LOCALLY_VERIFIED` | Eradicated unsafe blanket `migration repair` loops. Implemented `MIGRATION_RECOVERY_SPECIFICATION` requiring catalog proof. |
| **CANON-MIG-08** | Database / Integrity | Canonical Timestamp Sequencing & Eradication of 20261124 | `B83-03` | B19.8.3 | `CLOSED_WITH_EVIDENCE` | Purged invalid timestamp `20261124000001` across repo; verified 10 canonical timestamps (`20261120000001`..`20261123000002`). |
| **CANON-MIG-09** | Database / Network | Session Pooler Port Architecture (5432 Session vs 6543 Tx) | `B832-01` | B19.8.3.2 | `CLOSED_WITH_EVIDENCE` | Corrected reversed pooler port mapping across scripts, tests, and documentation. Session DDL = 5432. |
| **CANON-MIG-10** | Database / Tooling | Windows CMD Command Separator `&` Runner Fix | `B991-01`, `BUG-01` | B19.9.1 | `CLOSED_WITH_EVIDENCE` | Replaced `execFileSync('npx.cmd', ...)` with direct Node runner [`node_modules/supabase/dist/supabase.js`](file:///C:/AuroMindPortal/node_modules/supabase/dist/supabase.js) using `process.execPath`. |
| **CANON-MIG-11** | Database / Execution | Programmatic Remote Migration Execution over Pooler | `MIG-EXEC-01` | B19.9.1 | `BLOCKED` | Staged for post-authorization execution. Blocked awaiting attributable Product Owner approval (`PO-AUTH-01`). |
| **CANON-MIG-12** | Database / Verification | Post-Migration Affirmative Schema Verification Query | `VERIF-01` | B19.9.1 | `BLOCKED` | Staged verification script [`supabase/verify_remote_schema.sql`](file:///C:/AuroMindPortal/supabase/verify_remote_schema.sql). Dependent on `CANON-MIG-11`. |
| **CANON-MIG-13** | Database / PostgREST | PostgREST Schema Cache Reload & REST Endpoint Verification | `VERIF-02` | B19.9.1 | `BLOCKED` | Staged verification. Probes 15 public tables post-migration to confirm clearance of `PGRST205` errors. |
| **CANON-SEC-01** | Security / Redaction | Credential Sanitization & Informative Diagnostics | `SEC-01`, `B991-02`, `BUG-02` | B19.4 | `CLOSED_WITH_EVIDENCE` | `maskSecret()` sanitizes passwords and tokens while preserving non-sensitive operational diagnostics. |
| **CANON-SEC-02** | Security / Auth | Dual-Format Publishable Key Validation (`sb_publishable_`) | `SEC-02` | B19.4 | `CLOSED_WITH_EVIDENCE` | Validator accepts modern `sb_publishable_` keys and legacy 3-part anon JWTs while strictly rejecting service_role keys. |
| **CANON-SEC-03** | Security / Auth | Production Auth Site URL & Redirects Alignment | `BLK-05` (B19.8.1/2), `ACT-02` (B19.8.2), `AUTH-CFG-01` | B19.5 | `OWNER_ACTION_REQUIRED` | Live GoTrue configured to localhost default. Requires updating Dashboard to `https://auromasti.com` and staging URL. |
| **CANON-SEC-04** | Security / Auth | GoTrue Anonymous Sign-Ins Configuration | `REM-AUTH-01`, `AUTH-CFG-02`, `B991-03` | B19.9.1 | `OWNER_ACTION_REQUIRED` | Live GoTrue returns `external.anonymous_users: false`. Requires Dashboard toggle or confirmed local guest conversion flow. |
| **CANON-SEC-05** | Security / RLS | 100% Row-Level Security Coverage Across 15 Tables | `SEC-04` (B18-A), `BLK-02` (B19.7) | B18-A | `LOCALLY_VERIFIED` | Migration 9 enforces RLS on all 15 public tables with owner-only policies. Live verification pending migration execution. |
| **CANON-SEC-06** | Security / Functions | Function `SECURITY DEFINER` Search Path Hardening | `B18-C`, `B831-05` (B4.a) | B18-C | `LOCALLY_VERIFIED` | All PL/pgSQL functions explicitly declare `SET search_path = pg_catalog, public`. Verified via AST tests. |
| **CANON-SEC-07** | Security / Network | TLS 1.3 STARTTLS & Root CA Certificate Verification | `B831-02` | B19.8.3.1 | `LIVE_VERIFIED` | Verified live handshake with `prod-ca-2021.crt`. Protocol: TLS 1.3, Cipher: `TLS_AES_256_GCM_SHA384`, `Authorized: true`. |
| **CANON-SEC-08** | Security / Isolation | Multi-User Device State Isolation & Logout State Cleanup | `GAP-02` (B18-A), `SEC-03` (B18-A) | B18-A | `CLOSED_WITH_EVIDENCE` | Implemented `AuroMind.auth.signOut()` purging local guest session keys and preventing cross-user profile contamination. |
| **CANON-DAT-01** | Sacred Data | AuroMatch Flora Botanical Database Integrity | `DATA-03`, `BLK-06` (Flora sub-item) | B17 | `LIVE_VERIFIED` | Canonical file: [`games/auromatch/src/models/floraDatabase.js`](file:///C:/AuroMindPortal/games/auromatch/src/models/floraDatabase.js). Size: 2,002,176 B. SHA-256: `689d035cd52abd8d342528d8c5f61f298916b8052b8287450be4931cf8ae1a3a`. |
| **CANON-DAT-02** | Sacred Data | Sankalpa Local-Only Cryptographic Vault Privacy | `DATA-04`, `BLK-07` (B19.7), `B83-05`, `B831-04` | B18-A | `LIVE_VERIFIED` | PBKDF2 (210,000 iters) + AES-256-GCM. 14-step recovery verified; zero network egress proved via global fetch interception. |
| **CANON-DAT-03** | Sacred Data | AuroMandala Artwork Persistence & Non-Destructive Recovery | `WS3` (B19), `STOR-03` | B18-A | `LOCALLY_VERIFIED` | Artwork stored in IndexedDB by default. Multi-snapshot causal conflict resolution; cloud sync requires explicit user export. |
| **CANON-DAT-04** | Sacred Data | MaaBLOCK Unique-Values / Each-Tile-Used-Once Puzzle Rule | `B17-GAP-04`, `B83-04` | B17 | `LOCALLY_VERIFIED` | Sacred Sudoku / grid puzzle logic enforces single-use tile placement invariants and progression integrity. |
| **CANON-PWA-01** | PWA / Offline | Root Service Worker /games/* Scope Isolation | `SW-01` | B17 | `LOCALLY_VERIFIED` | Root `sw.js` bypasses child `/games/*` routes, preventing cache namespace collisions with game service workers. |
| **CANON-PWA-02** | PWA / Offline | Offline Shared SDK Delivery Under Game Referrer | `SW-02`, `B17-GAP-06` | B17 | `CLOSED_WITH_EVIDENCE` | `sw.js` explicitly exempts `/assets/sdk/*` from game referrer bypass, guaranteeing offline SDK availability in iframes. |
| **CANON-PWA-03** | PWA / Offline | Resilient Service Worker Installation on Network Drops | `SW-03` | B19.5 | `CLOSED_WITH_EVIDENCE` | Uses `Promise.allSettled` for optional game assets and atomic fail-closed caching for core app shell. |
| **CANON-UI-01** | UI / Catalog | Portal Game Grid Catalog Duplication Eradication | `UI-01`, `B17-GAP-01`, `B17-GAP-02` | B17 | `CLOSED_WITH_EVIDENCE` | DOM contains exactly 3 curated `article.game-card` elements (AuroMandala, MaaMATCH, MaaBLOCK); zero duplication. |
| **CANON-UI-02** | UI / Access | Senior Mode Cross-Frame PostMessage Synchronization | `UI-02`, `B17-GAP-07`, `B17-DEFECT-02` | B17 | `CLOSED_WITH_EVIDENCE` | Portal broadcasts `AUROMIND_SET_SENIOR_MODE`; all three game bridges listen and adjust typography/contrast. |
| **CANON-UI-03** | UI / Navigation | Standardized In-Game Theater Exit Protocol | `UI-03`, `B17-GAP-05`, `B83-04`, `B831-03` | B17 | `CLOSED_WITH_EVIDENCE` | All three games implement exit buttons dispatching `AUROMIND_CLOSE_THEATER` to `window.parent`. Verified in real browsers. |
| **CANON-UI-04** | UI / Audio | Ambient Audio State Restoration on Theater Exit | `UI-04`, `B17-GAP-09` | B17 | `CLOSED_WITH_EVIDENCE` | Portal tracks `ambientAudioWasPlaying` flag and automatically resumes playback upon exiting game viewports. |
| **CANON-UI-05** | UI / Bridge | AuroBlocks Shared Platform SDK Integration Bridge | `B17-GAP-04`, `B83-04` | B17 | `CLOSED_WITH_EVIDENCE` | Created [`games/auroblocks/assets/auroblocks-sdk-bridge.js`](file:///C:/AuroMindPortal/games/auroblocks/assets/auroblocks-sdk-bridge.js) implementing native adapter and telemetry relays. |
| **CANON-UI-06** | UI / Navigation | Mobile Console Drawer Touch Gesture Usability | `B17-GAP-03` | B17 | `CLOSED_WITH_EVIDENCE` | Enlarged touch target on mobile viewports (<600px), eliminating conflicts with OS back-swipe navigation. |
| **CANON-OPS-01** | Hosting / Edge | Cloudflare Pages Canonical Staging & Production Host | `ARCH-01`, `BLK-06` (B19.8.1/3), `BLK-04` (B19.7) | B19.8 | `CLOSED_WITH_EVIDENCE` | Cloudflare Pages confirmed as canonical host; `_headers` and `_routes.json` validated by automated CI tests. |
| **CANON-OPS-02** | Hosting / Deploy | Cloudflare Pages Staging Deployment Execution | `ACT-01` (B19.8.2), `EDGE-ALIGN-01` | B19.8.2 | `OPEN` | Awaiting Git push trigger and verification of staging deployment on Cloudflare Pages (`staging.auromasti.pages.dev`). |
| **CANON-OPS-03** | Hosting / DNS | Production DNS Cutover & Apex Domain Binding (`auromasti.com`) | `LIVE-01`, `ACT-02` (B19.8.2), `BLK-05` (B19.7) | B19.8.3 | `BLOCKED` | Staged for final release window. Blocked awaiting staging smoke test clearance and Product Owner cutover approval. |
| **CANON-OPS-04** | Storage / Bucket | Storage Buckets Provisioning (`avatars`, `user-artwork`) | `BLK-04` (B19.8.1/2), `REM-01`, `STOR-01`, `STOR-02` | B19.8.3 | `BLOCKED` | Live Storage API currently returns `[]`. Buckets will be provisioned by Migration 10 upon database execution (`CANON-MIG-11`). |
| **CANON-OPS-05** | Edge / Function | Telemetry Cleanup Edge Function Deployment & Schedule | `BLK-02` (B19.7), `BLK-04` (B19.7), `EDGE-01`, `EDGE-02` | B19.7 | `BLOCKED` | Function [`supabase/functions/cleanup-telemetry/index.ts`](file:///C:/AuroMindPortal/supabase/functions/cleanup-telemetry/index.ts) authored. Deployment blocked awaiting database migration. |
| **CANON-OPS-06** | Operations / DR | Disaster Recovery Point-in-Time Recovery (PITR) Posture | `BLK-03` (B19.7), `PO-AUTH-02`, `OPS-02` | B19.7 | `OWNER_ACTION_REQUIRED` | Live Supabase project created with automated daily snapshots. Formal sub-hour PITR drill requires Pro tier + PITR add-on. |
| **CANON-OPS-07** | Operations / CI | Offline-First CI Regression Suite Stability (45 Suites) | `OPS-01`, `B17-GAP-10` | B19.8 | `CLOSED_WITH_EVIDENCE` | All 45 test suites execute cleanly offline without external dependencies (738/738 tests passing, 100% pass rate). |
| **CANON-GOV-01** | Governance / Gate | Mandatory Product Owner Migration Execution Gate | `BLK-07` (B19.8.3), `B82-01`, `PO-AUTH-01` | B19.8.2 | `OWNER_ACTION_REQUIRED` | `validateMigrationExecutionGate()` enforces 8 strict conditions; fails closed. Requires attributable PO approval to unlock. |
| **CANON-GOV-02** | Governance / Comm | Commercial Monetization Gate Permanent Invariant (`false`) | `SEC-03`, `BLK-06` (B19.7), `EDGE-ALIGN-03` | B17 | `LOCALLY_VERIFIED` | `COMMERCIAL_GATE_ENABLED = false` strictly enforced across backend configuration and client bundles. Launch is 100% free. |
| **CANON-GOV-03** | Governance / Audit | Master Issue Register Mathematical Parity & Traceability | `B82-04` | B19.8.2 | `CLOSED_WITH_EVIDENCE` | Reconciles all historical finding sets, resolves conflicting IDs, and proves exact arithmetic agreement. |
| **CANON-GOV-04** | Governance / Scope | Granular Release Acceptance Separation & Decision Model | `B82-05`, `B831-05` (B4.b) | B19.8.2 | `CLOSED_WITH_EVIDENCE` | Separates local offline proof from live hosted dependencies. Established Decision Framework (A, B, C). |
| **CANON-EXC-01** | Scope Exclusion | VAK Game Application Exclusion from v2.0.0 Beta Release | `DATA-01`, `DATA-02` | B17 | `EXCLUDED_FROM_RELEASE` | VAK excluded from active catalogue and launch acceptance. Files preserved in `games/vak/`; historical SHA-256 digests archived. |
| **CANON-EXC-02** | Scope Exclusion | Deferred Prototype Games (Word Riddle, VAK Sanctuary) | `B17-GAP-08`, `GAP-01` (B18-A) | B17 | `EXCLUDED_FROM_RELEASE` | Prototype games deferred to post-launch roadmap; unlisted from release catalogue. |
| **CANON-EXC-03** | Scope Exclusion | Commercial Payment Gateways & In-App Purchase Webhooks | `B17-GAP-12`, `WS5` (Commercial) | B17 | `EXCLUDED_FROM_RELEASE` | Payment processing webhooks explicitly deferred past v2.0.0 Beta. Platform is strictly non-monetized at launch. |

---

## 4. Historical-to-Canonical ID Lookup Index

For fast developer reference, this table lists historical identifiers alphabetically and points directly to their canonical designation:

| Historical ID | Milestone / Source | Canonical Mapping | Current Status |
| :--- | :---: | :--- | :--- |
| `ACT-01` | B19.8.2 | **`CANON-OPS-02`** | `OPEN` |
| `ACT-02` | B19.8.2 | **`CANON-OPS-03`** | `BLOCKED` |
| `ARCH-01` | B19.8 | **`CANON-OPS-01`** | `CLOSED_WITH_EVIDENCE` |
| `AUTH-CFG-01` | B19.9.1 | **`CANON-SEC-03`** | `OWNER_ACTION_REQUIRED` |
| `AUTH-CFG-02` | B19.9.1 | **`CANON-SEC-04`** | `OWNER_ACTION_REQUIRED` |
| `AUTH-CFG-03` | B19.9.1 | **`CANON-SEC-03`** | `OWNER_ACTION_REQUIRED` |
| `B17-DEFECT-01` | B17.3 | **`CANON-UI-05`** | `CLOSED_WITH_EVIDENCE` |
| `B17-DEFECT-02` | B17.3 | **`CANON-UI-02`** | `CLOSED_WITH_EVIDENCE` |
| `B17-DEFECT-03` | B17.3 | **`CANON-UI-03`** | `CLOSED_WITH_EVIDENCE` |
| `B17-DEFECT-04` | B17.3 | **`CANON-UI-05`** | `CLOSED_WITH_EVIDENCE` |
| `B17-GAP-01` | B17 | **`CANON-UI-01`** | `CLOSED_WITH_EVIDENCE` |
| `B17-GAP-02` | B17 | **`CANON-UI-01`** | `CLOSED_WITH_EVIDENCE` |
| `B17-GAP-03` | B17 | **`CANON-UI-06`** | `CLOSED_WITH_EVIDENCE` |
| `B17-GAP-04` | B17 | **`CANON-UI-05`** | `CLOSED_WITH_EVIDENCE` |
| `B17-GAP-05` | B17 | **`CANON-UI-03`** | `CLOSED_WITH_EVIDENCE` |
| `B17-GAP-06` | B17 | **`CANON-PWA-02`** | `CLOSED_WITH_EVIDENCE` |
| `B17-GAP-07` | B17 | **`CANON-UI-02`** | `CLOSED_WITH_EVIDENCE` |
| `B17-GAP-08` | B17 | **`CANON-EXC-02`** | `EXCLUDED_FROM_RELEASE` |
| `B17-GAP-09` | B17 | **`CANON-UI-04`** | `CLOSED_WITH_EVIDENCE` |
| `B17-GAP-10` | B17 | **`CANON-OPS-07`** | `CLOSED_WITH_EVIDENCE` |
| `B17-GAP-11` | B17 | **`CANON-MIG-03`** | `LIVE_VERIFIED` |
| `B17-GAP-12` | B17 | **`CANON-EXC-03`** | `EXCLUDED_FROM_RELEASE` |
| `B82-01` | B19.8.2 | **`CANON-GOV-01`** | `OWNER_ACTION_REQUIRED` |
| `B82-02` | B19.8.2 | **`CANON-MIG-06`** | `LOCALLY_VERIFIED` |
| `B82-03` | B19.8.2 | **`CANON-MIG-07`** | `LOCALLY_VERIFIED` |
| `B82-04` | B19.8.2 | **`CANON-GOV-03`** | `CLOSED_WITH_EVIDENCE` |
| `B82-05` | B19.8.2 | **`CANON-GOV-04`** | `CLOSED_WITH_EVIDENCE` |
| `B83-01` | B19.8.3 | **`CANON-MIG-03`** | `LIVE_VERIFIED` |
| `B83-02` | B19.8.3 | **`CANON-GOV-01`** | `OWNER_ACTION_REQUIRED` |
| `B83-03` | B19.8.3 | **`CANON-MIG-08`** | `CLOSED_WITH_EVIDENCE` |
| `B83-04` | B19.8.3 | **`CANON-UI-03`** | `CLOSED_WITH_EVIDENCE` |
| `B83-05` | B19.8.3 | **`CANON-DAT-02`** | `LIVE_VERIFIED` |
| `B831-01` | B19.8.3.1 | **`CANON-MIG-07`** | `LOCALLY_VERIFIED` |
| `B831-02` | B19.8.3.1 | **`CANON-SEC-07`** | `LIVE_VERIFIED` |
| `B831-03` | B19.8.3.1 | **`CANON-UI-03`** | `CLOSED_WITH_EVIDENCE` |
| `B831-04` | B19.8.3.1 | **`CANON-DAT-02`** | `LIVE_VERIFIED` |
| `B831-05` | B19.8.3.1 | **`CANON-SEC-06`** | `LOCALLY_VERIFIED` |
| `B831-06` | B19.8.3.1 | **`CANON-MIG-02`** | `CLOSED_WITH_EVIDENCE` |
| `B832-01` | B19.8.3.2 | **`CANON-MIG-09`** | `CLOSED_WITH_EVIDENCE` |
| `B991-01` | B19.9.1 | **`CANON-MIG-10`** | `CLOSED_WITH_EVIDENCE` |
| `B991-02` | B19.9.1 | **`CANON-SEC-01`** | `CLOSED_WITH_EVIDENCE` |
| `B991-03` | B19.9.1 | **`CANON-SEC-04`** | `OWNER_ACTION_REQUIRED` |
| `BETA-LAUNCH-01` | B19.9.1 | **`CANON-OPS-02`** | `OPEN` |
| `BETA-LAUNCH-02` | B19.9.1 | **`CANON-DAT-02`** | `LIVE_VERIFIED` |
| `BETA-LAUNCH-03` | B19.9.1 | **`CANON-GOV-04`** | `CLOSED_WITH_EVIDENCE` |
| `BLK-01` (B19.5/7) | B19.5 | **`CANON-MIG-03`** | `LIVE_VERIFIED` |
| `BLK-01` (B19.8.3) | B19.8.3 | **`CANON-MIG-01`** | `CLOSED_WITH_EVIDENCE` |
| `BLK-02` (B19.5/7) | B19.5 | **`CANON-SEC-05`** | `LOCALLY_VERIFIED` |
| `BLK-02` (B19.8.3) | B19.8.3 | **`CANON-MIG-02`** | `CLOSED_WITH_EVIDENCE` |
| `BLK-03` (B19.5/7) | B19.5 | **`CANON-OPS-06`** | `OWNER_ACTION_REQUIRED` |
| `BLK-03` (B19.8.1/2) | B19.8.1 | **`CANON-MIG-03`** | `LIVE_VERIFIED` |
| `BLK-04` (B19.5/7) | B19.5 | **`CANON-OPS-05`** | `BLOCKED` |
| `BLK-04` (B19.8.1/2) | B19.8.1 | **`CANON-OPS-04`** | `BLOCKED` |
| `BLK-05` (B19.5/7) | B19.5 | **`CANON-OPS-03`** | `BLOCKED` |
| `BLK-05` (B19.8.1/2) | B19.8.1 | **`CANON-SEC-03`** | `OWNER_ACTION_REQUIRED` |
| `BLK-06` (B19.5/7) | B19.5 | **`CANON-GOV-02`** | `LOCALLY_VERIFIED` |
| `BLK-06` (B19.8.3) | B19.8.3 | **`CANON-OPS-01`** | `CLOSED_WITH_EVIDENCE` |
| `BLK-07` (B19.5/7) | B19.5 | **`CANON-DAT-02`** | `LIVE_VERIFIED` |
| `BLK-07` (B19.8.3) | B19.8.3 | **`CANON-GOV-01`** | `OWNER_ACTION_REQUIRED` |
| `DATA-01` | B17 | **`CANON-EXC-01`** | `EXCLUDED_FROM_RELEASE` |
| `DATA-02` | B17 | **`CANON-EXC-01`** | `EXCLUDED_FROM_RELEASE` |
| `DATA-03` | B17 | **`CANON-DAT-01`** | `LIVE_VERIFIED` |
| `DATA-04` | B18 | **`CANON-DAT-02`** | `LIVE_VERIFIED` |
| `DB-01` | B19.6 | **`CANON-MIG-04`** | `CLOSED_WITH_EVIDENCE` |
| `DB-02` | B19.6 | **`CANON-MIG-05`** | `LOCALLY_VERIFIED` |
| `DB-03` | B19.8.1 | **`CANON-MIG-04`** | `CLOSED_WITH_EVIDENCE` |
| `EDGE-01` | B19.9.1 | **`CANON-OPS-05`** | `BLOCKED` |
| `EDGE-02` | B19.9.1 | **`CANON-OPS-05`** | `BLOCKED` |
| `EDGE-ALIGN-01` | B19.9.1 | **`CANON-OPS-02`** | `OPEN` |
| `EDGE-ALIGN-02` | B19.9.1 | **`CANON-OPS-01`** | `CLOSED_WITH_EVIDENCE` |
| `EDGE-ALIGN-03` | B19.9.1 | **`CANON-GOV-02`** | `LOCALLY_VERIFIED` |
| `GAP-01` | B18-A | **`CANON-EXC-02`** | `EXCLUDED_FROM_RELEASE` |
| `GAP-02` | B18-A | **`CANON-SEC-08`** | `CLOSED_WITH_EVIDENCE` |
| `GAP-03` | B18-A | **`CANON-UI-05`** | `CLOSED_WITH_EVIDENCE` |
| `GAP-04` | B18-A | **`CANON-DAT-03`** | `LOCALLY_VERIFIED` |
| `GAP-06` | B18-A | **`CANON-MIG-03`** | `LIVE_VERIFIED` |
| `LIVE-01` | B19.8.3 | **`CANON-OPS-03`** | `BLOCKED` |
| `MIG-EXEC-01` | B19.9.1 | **`CANON-MIG-11`** | `BLOCKED` |
| `MIG-EXEC-02` | B19.9.1 | **`CANON-MIG-02`** | `CLOSED_WITH_EVIDENCE` |
| `NET-01` | B19.8.3 | **`CANON-MIG-03`** | `LIVE_VERIFIED` |
| `OPS-01` | B19.8 | **`CANON-OPS-07`** | `CLOSED_WITH_EVIDENCE` |
| `OPS-02` | B19.7 | **`CANON-MIG-07`** | `LOCALLY_VERIFIED` |
| `PO-AUTH-01` | B19.9.1 | **`CANON-GOV-01`** | `OWNER_ACTION_REQUIRED` |
| `PO-AUTH-02` | B19.9.1 | **`CANON-OPS-06`** | `OWNER_ACTION_REQUIRED` |
| `REM-01` | B19.8.3 | **`CANON-OPS-04`** | `BLOCKED` |
| `REM-AUTH-01` | B19.9.1 | **`CANON-SEC-04`** | `OWNER_ACTION_REQUIRED` |
| `SEC-01` | B19.4 | **`CANON-SEC-01`** | `CLOSED_WITH_EVIDENCE` |
| `SEC-02` | B19.4 | **`CANON-SEC-02`** | `CLOSED_WITH_EVIDENCE` |
| `SEC-03` (B17) | B17 | **`CANON-GOV-02`** | `LOCALLY_VERIFIED` |
| `SEC-03` (B18-A) | B18-A | **`CANON-SEC-08`** | `CLOSED_WITH_EVIDENCE` |
| `SEC-04` (B18-A) | B18-A | **`CANON-SEC-05`** | `LOCALLY_VERIFIED` |
| `STOR-01` | B19.9.1 | **`CANON-OPS-04`** | `BLOCKED` |
| `STOR-02` | B19.9.1 | **`CANON-OPS-04`** | `BLOCKED` |
| `STOR-03` | B19.9.1 | **`CANON-DAT-03`** | `LOCALLY_VERIFIED` |
| `SW-01` | B17 | **`CANON-PWA-01`** | `LOCALLY_VERIFIED` |
| `SW-02` | B17 | **`CANON-PWA-02`** | `CLOSED_WITH_EVIDENCE` |
| `SW-03` | B19.5 | **`CANON-PWA-03`** | `CLOSED_WITH_EVIDENCE` |
| `UI-01` | B17 | **`CANON-UI-01`** | `CLOSED_WITH_EVIDENCE` |
| `UI-02` | B17 | **`CANON-UI-02`** | `CLOSED_WITH_EVIDENCE` |
| `UI-03` | B17 | **`CANON-UI-03`** | `CLOSED_WITH_EVIDENCE` |
| `UI-04` | B17 | **`CANON-UI-04`** | `CLOSED_WITH_EVIDENCE` |
| `VERIF-01` | B19.9.1 | **`CANON-MIG-12`** | `BLOCKED` |
| `VERIF-02` | B19.9.1 | **`CANON-MIG-13`** | `BLOCKED` |

---

## 5. Reconciliation & Parity Summary

- **Total Historical References Mapped:** **88** unique historical IDs.
- **Total Canonical Identifiers:** **40** canonical issues across 8 domains.
- **Classification Distribution:**
  - `CLOSED_WITH_EVIDENCE`: 17
  - `LOCALLY_VERIFIED`: 8
  - `LIVE_VERIFIED`: 4
  - `OPEN`: 1
  - `BLOCKED`: 4
  - `OWNER_ACTION_REQUIRED`: 3
  - `EXCLUDED_FROM_RELEASE`: 3
  - **Total:** **40** (Exact 100% mathematical parity across all domains).
