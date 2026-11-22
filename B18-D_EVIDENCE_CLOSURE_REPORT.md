# AuroMasti — B18-D Local Runtime Evidence Closure Report

**Document ID:** `B18-D-EVIDENCE-CLOSURE-01`  
**Classification:** Evidence Audit & Local Runtime Verification  
**Workspace:** `C:\AuroMindPortal`  
**Approved Baseline Commit:** `63f03a72e9c656161d9137d8e867325ae3eac671`  
**Branch:** `dev/studio-integration`  
**Timestamp:** `2026-11-22T13:57:30+05:30`  
**Execution Portfolio:** 189 Tests Executed | 189 Passed | 0 Failed | 0 Skipped  
**Runtime Browser:** Microsoft Edge (Chromium) `Edg/158.0.4370.33`  

---

## 1. Executive Status

Every B18-D technical claim and workstream has been rigorously evaluated against actual local runtime capabilities and classified into standardized governance categories:

```
+--------------------------------------------------------+-------------------------------+------------------------------------------------------+
| Workstream / Capability                                | Classification                | Basis / Evidence Summary                             |
+--------------------------------------------------------+-------------------------------+------------------------------------------------------+
| 1. Git Baseline & Intervening Branding Commits         | PASS — REAL LOCAL RUNTIME     | Verified clean HEAD 63f03a7 with origin parity       |
| 2. Protected Sacred Data Invariants (VAK & Flora)      | PASS — REAL LOCAL RUNTIME     | Exact byte length & SHA-256 match via PowerShell     |
| 3. Migration 8 Static DDL & Safety Controls            | PASS — STATIC INSPECTION      | AST/regex parsing of search_path, permissions & NaN   |
| 4. Migration 8 Logic & Numeric Overflow Simulation     | PASS — UNIT/SIMULATION ONLY   | 13 simulated behavioral test vectors in Bun/Node     |
| 5. Migration 8 Live PostgreSQL Execution               | NOT EXECUTED                  | Local PostgreSQL engine/psql runtime unavailable     |
| 6. JWT, PostgREST & Storage RLS Live Execution         | NOT EXECUTED                  | Local Docker daemon / Supabase stack unavailable     |
| 7. PostgREST & RLS Policy Simulation Matrix            | PASS — UNIT/SIMULATION ONLY   | 9 simulated multi-tenant role vectors in Node        |
| 8. AuroBlocks SW Scope Isolation & Boundary Matrix     | PASS — UNIT/SIMULATION ONLY   | 11 mock URL resolution & parser differential tests   |
| 9. AuroBlocks Real Browser SW Version Update Lifecycle | PASS — REAL LOCAL RUNTIME     | Real Edge Chromium: new worker installs/activates    |
| 10. AuroBlocks Foreign Cache Namespace Immutability    | PASS — REAL LOCAL RUNTIME     | Real Edge Chromium: auro-match/portal unmutated      |
| 11. AuroBlocks Offline Game Shell Reload               | PASS — REAL LOCAL RUNTIME     | CDP offline network emulation on live Edge Chromium  |
| 12. Supabase Staging Architecture & Backup Audit       | PASS — STATIC INSPECTION      | Documented review of Free vs Pro limits & PITR add-on|
| 13. Physical Disaster Recovery / Restore Timing Drill  | NOT EXECUTED                  | Requires provisioned staging DB with active PITR     |
+--------------------------------------------------------+-------------------------------+------------------------------------------------------+
```

---

## 2. Evidence Matrix

| Claim Evaluated | Source Files & Targets | Execution Method | Environment | Actual Result | Classification | Remaining Limitation |
|---|---|---|---|---|---|---|
| **Git Baseline Parity** | `.git`, `dev/studio-integration` | `git rev-parse HEAD`, `git branch -vv` | Local Git 2.x / Windows | `HEAD` = `63f03a7`, identical to `origin/dev/studio-integration` | **PASS — REAL LOCAL RUNTIME** | None. Baseline established. |
| **VAK Speech Corpus Immutability** | `games/vak/index.html` (`CL` array) | Canonical extraction regex + SHA-256 | PowerShell / .NET Crypto | SHA-256: `9fdb38...da09`, 93,744 bytes | **PASS — REAL LOCAL RUNTIME** | None. 100% byte-exact. |
| **Flora Botanical DB Immutability** | `games/auromatch/src/models/floraDatabase.js` | Whole-file SHA-256 & byte size | PowerShell / .NET Crypto | SHA-256: `689d03...1a3a`, 2,002,176 bytes | **PASS — REAL LOCAL RUNTIME** | None. 100% byte-exact. |
| **Migration 8 DDL Security** | `supabase/migrations/20261122000004_...sql` | AST static analysis | `agy-node` test runner | Pins `search_path`, no `x != x`, grants to `service_role` | **PASS — STATIC INSPECTION** | Static inspection only; not executed against live PostgreSQL engine. |
| **Token Bucket Bounds & Overflow** | `b18-d-token-bucket-validation.test.js` | JavaScript IEEE-754 / BigInt simulation | `agy-node` (Node v24.22.0) | 13/13 tests pass: rejects NaN, clamps elapsed duration | **PASS — UNIT/SIMULATION ONLY** | Simulation of PostgreSQL `numeric(8,2)` math, not native C/PostgreSQL execution. |
| **Migration 8 PostgreSQL Execution** | `supabase/migrations/20261122000004_...sql` | Database migration execution | None (unavailable) | Aborted safely: No local PostgreSQL engine or `psql` found | **NOT EXECUTED** | Requires PostgreSQL 15+ engine installed locally or in CI container. |
| **Live JWT, PostgREST & Storage RLS** | `tests/rls/b18-d-rls-pgtap-matrix.sql` | Live HTTP PostgREST API requests | None (unavailable) | Aborted safely: No Docker daemon or local Supabase stack | **NOT EXECUTED** | Requires Docker Desktop / Supabase CLI (`supabase start`) or staging instance. |
| **RLS Policy Invariant Simulation** | `b18-d-rls-jwt-simulation.test.js` | JavaScript multi-tenant context simulation | `agy-node` (Node v24.22.0) | 9/9 tests pass: user isolation, storage folder boundaries | **PASS — UNIT/SIMULATION ONLY** | Models PostgREST GUC context without live PostgREST API. |
| **AuroBlocks SW Version Update** | `games/auroblocks/sw.js`, `auroblocks-sw-security.test.js` | Genuinely new SW URL registered in headless browser | Microsoft Edge `158.0.4370.33` | Worker transitions: `installing` $\rightarrow$ `installed` $\rightarrow$ `activating` $\rightarrow$ `activated` $\rightarrow$ takes page control | **PASS — REAL LOCAL RUNTIME** | None. Real browser lifecycle observed. |
| **Foreign Cache Non-Interference** | `games/auroblocks/sw.js`, `auroblocks-sw-security.test.js` | Inspect CacheStorage before/after SW lifecycle | Microsoft Edge `158.0.4370.33` | `auro-match-v7.0` and `auro-portal-v1.2.0` probe keys remain 100% unmutated; obsolete auroblocks cache deleted | **PASS — REAL LOCAL RUNTIME** | None. Verified in real Chromium engine. |
| **AuroBlocks Offline Availability** | `games/auroblocks/sw.js`, `auroblocks-sw-security.test.js` | CDP offline network emulation + page reload | Microsoft Edge `158.0.4370.33` | Page reloads offline from cache, title renders 'MaaBLOCK' | **PASS — REAL LOCAL RUNTIME** | None. Real browser offline execution verified. |
| **SW Path Traversal Protection** | `games/auroblocks/sw.js`, `auroblocks-sw-security.test.js` | VM path resolution harness | `agy-node` (Node v24.22.0) | Rejects backslashes (`%5c`, `\`), repeated encoding (`%252e%252e`) | **PASS — UNIT/SIMULATION ONLY** | Evaluates URL pathname containment logic in Node VM. |
| **Supabase Disaster Recovery Assessment** | `B18-D_FINAL_TECHNICAL_READINESS_REPORT.md` | Official documentation audit | Document inspection | Free tier pauses idle projects; RPO $\le$ 1h requires Pro + $100/mo PITR | **PASS — STATIC INSPECTION** | Documented analysis only; restore has not been physically executed. |
| **Physical Disaster Recovery Drill** | Cloud / Database backup archives | Physical restore command execution | None (unavailable) | Not performed | **NOT EXECUTED** | Requires provisioned staging project and active PITR backup stream. |

---

## 3. Test Accounting

Single-run portfolio executed via `agy-node --test` (Duration: 29.15s):

```
+------------------------------------------+-------------+---------+---------+----------------------------------------------------+
| Test Suite File                          | Total Tests | Passed  | Failed  | Runtime Category Breakdown                         |
+------------------------------------------+-------------+---------+---------+----------------------------------------------------+
| 1. b17-remediation.test.js               | 15          | 15      | 0       | 3 Real Runtime (Corpus/Flora/DOM), 12 Unit         |
| 2. b11-game-integration.test.js          | 6           | 6       | 0       | 6 Integration / Contract                           |
| 3. b18-c-security-remediation.test.js    | 17          | 17      | 0       | 3 Real Runtime (WebCrypto), 14 Unit Simulation     |
| 4. b18-b2-shared-sdk-and-adapters.test.js| 22          | 22      | 0       | 22 Unit / Adapter Contract                         |
| 5. b18-b3-sync-art-achievements.test.js  | 24          | 24      | 0       | 24 Unit / Sync Simulation                          |
| 6. b18-b4-commerce-and-telemetry.test.js | 24          | 24      | 0       | 24 Unit / Token Bucket Contract                    |
| 7. b18-b5-csp.test.js                    | 8           | 8       | 0       | 2 Real Runtime (server.js HTTP), 6 Static File     |
| 8. b13a-remediation.test.js              | 17          | 17      | 0       | 5 Static DDL, 12 Unit Contract                     |
| 9. b13b-operational-hardening.test.js    | 19          | 19      | 0       | 6 Static DDL, 13 Unit Simulation                   |
| 10. auroblocks-sw-security.test.js       | 15          | 15      | 0       | 4 Real Browser E2E (Edge Chromium), 11 Static/VM   |
| 11. b18-d-token-bucket-validation.test.js| 13          | 13      | 0       | 6 Static DDL Inspection, 7 Behavioral Simulation   |
| 12. b18-d-rls-jwt-simulation.test.js     | 9           | 9       | 0       | 2 Static pgTAP DDL, 7 Behavioral Policy Simulation |
+------------------------------------------+-------------+---------+---------+----------------------------------------------------+
| TOTAL PORTFOLIO                          | 189         | 189     | 0       | All suites passing (0 skipped, 0 cancelled)        |
+------------------------------------------+-------------+---------+---------+----------------------------------------------------+
```

### Grand Total Execution Breakdown:
- **Real Local Runtime Tests (Browser E2E / Server HTTP / WebCrypto / File System):** **12 tests**
- **Static DDL / AST / Configuration Inspection Tests:** **35 tests**
- **Unit Contract & Behavioral Simulation Tests:** **142 tests**
- **Live PostgreSQL / PostgREST / Storage Database Tests:** **0 tests (Classified as NOT EXECUTED)**

---

## 4. Migration Inventory & Ordering DAG

The repository contains 8 linear migrations in `supabase/migrations/`:

```
+----+-------------------------------------------------------------------+---------+------------------------------------------------------------+
| #  | Migration Filename                                                | Size    | Purpose & Dependency Details                               |
+----+-------------------------------------------------------------------+---------+------------------------------------------------------------+
| 1  | 20261120000001_b5_core_schema.sql                                 | 17.2 KB | B5 Core schema (enums, profiles, sync, storage buckets)    |
| 2  | 20261120000002_b8_rate_limiting.sql                               | 3.6 KB  | B8 Ingestion rate limiting table & function                |
| 3  | 20261120000003_b13a_telemetry_rls_hardening.sql                   | 1.8 KB  | B13A AUDIT-SEC-01: Revokes direct table insert from public |
| 4  | 20261120000004_b13b_telemetry_retention.sql                       | 7.4 KB  | B13B AUDIT-PERF-01: Retention cleanup function & partition |
| 5  | 20261122000001_b18c_profile_rls_separation.sql                    | 3.8 KB  | B18-C: Profiles private table & public projection view     |
| 6  | 20261122000002_b18c_telemetry_token_bucket.sql                    | 4.2 KB  | B18-C: Atomic token bucket & storage deletion queue        |
| 7  | 20261122000003_b18c_telemetry_search_path_hardening.sql           | 3.1 KB  | B18-C: Pinned search_path & service_role execute lock      |
| 8  | 20261122000004_b18d_telemetry_token_bucket_input_validation.sql   | 7.3 KB  | B18-D: Defensive parameter validation & overflow clamping  |
+----+-------------------------------------------------------------------+---------+------------------------------------------------------------+
```

### Application & Risk Status:
- **Application Status:** Tracked in Git; **NOT APPLIED** to any live database.
- **Dependency Invariant:** Strict linear execution order. Migration 8 replaces the function created in Migration 6 and modified in Migration 7; it cannot be applied without Migration 6's table definition (`public.telemetry_rate_buckets`).

---

## 5. Outstanding Blockers & Prerequisites

The following items cannot be closed locally and represent explicit prerequisites for staging authorization:

1. **PostgreSQL 15+ Local Runtime Engine:**
   - *Missing Prerequisite:* No local PostgreSQL service, `psql` binary, or container daemon exists on the host.
   - *Requirement to Close:* Apply all 8 migrations to an isolated PostgreSQL 15+ database and run `pgTAP` assertion suite.
2. **Containerized Supabase Stack (PostgREST / GoTrue / Storage):**
   - *Missing Prerequisite:* Docker Desktop and Supabase CLI (`supabase start`) are not available on the host.
   - *Requirement to Close:* Spin up local or staging PostgREST and Storage API services and execute authenticated HTTP requests using disposable JWT tokens.
3. **Physical Disaster Recovery Drill:**
   - *Missing Prerequisite:* Requires provisioned staging Supabase project with continuous WAL archiving (PITR).
   - *Requirement to Close:* Execute an actual PITR point restore from an archived WAL snapshot and measure the exact recovery time (verifying whether RTO $\le$ 30m is achieved in practice).

---

## 6. Recommendation

**Status:** **Evidence closure accepted with limitations.**

### Justification:
- All locally verifiable security and integration requirements are verified with 100% confidence:
  - 189/189 regression tests passing.
  - Real browser E2E evidence confirms AuroBlocks service worker update lifecycle, page control, and foreign cache immutability on Microsoft Edge Chromium.
  - VAK Speech Corpus and Flora Botanical Database checksums are 100% byte-exact.
  - Migration 8 parameter validation and RLS policy invariants are statically verified and behaviorally simulated.
- Database execution and live API tests are transparently classified as **NOT EXECUTED** due to the absence of a local PostgreSQL/Docker environment.
- **Staging Provisioning Remains Withheld:** In strict adherence to governance boundaries, no staging provisioning, database creation, or cloud connections have been initiated.
