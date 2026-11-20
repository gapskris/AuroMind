# AuroMind Platform Modernization — Supabase Backend Architecture & Security Design

**Status:** Design Freeze Deliverable (4 of 7)  
**Provisioning Status:** **Design Only — No Supabase project has been assumed or provisioned.** See §10 for mandatory pre-provisioning confirmations.  
**Integration Boundary:** Accessed **exclusively** through `SupabaseProvider` adapters implementing `SHARED_SDK_CONTRACTS.md` — **never** imported directly by game code.

---

## 1. Design Principles

1. **Optional Cloud Layer:** Supabase enhances AuroMind with optional accounts, cross-device saves, and server-verified entitlements; guest local-first play never depends on Supabase availability.
2. **Defense-in-Depth with Strict RLS:** Every table has Row Level Security (`RLS`) enabled by default with deny-all baseline policies; users may read/write only their own rows (`auth.uid() = user_id`), and privileged tables (`entitlements`, `purchase_receipts`, `remote_config`) are **read-only or server-only** from the browser.
3. **Strict Public vs. Secret Separation:** Browser code receives **only** the public `SUPABASE_URL` and `SUPABASE_ANON_KEY`. The `SUPABASE_SERVICE_ROLE_KEY`, payment provider webhook secrets, and signing keys reside **exclusively** in Supabase Edge Functions / server secrets.
4. **Preserve Decentralized Game Schemas:** Cloud saves store each game's self-versioned `GameSaveEnvelope` payload (`jsonb`) keyed by `(user_id, game_id)` — avoiding brittle server-side coupling to internal game state evolution while supporting strict schema versioning and optimistic revision locking.

---

## 2. Database Schema (PostgreSQL / Supabase)

```sql
-- 1. User Profiles (1:1 with auth.users)
create table public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  preferred_locale text default 'en',
  portal_preferences jsonb not null default '{}'::jsonb,
  analytics_opt_in boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. Guest Identity Mapping (Many devices/guestIds -> 1 authenticated user)
create table public.guest_identity_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  guest_id text not null check (guest_id ~ '^guest_[0-9a-f-]{36}$'),
  device_label text,
  linked_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (user_id, guest_id)
);
create index idx_guest_links_guest_id on public.guest_identity_links(guest_id);

-- 3. Game Cloud Saves (1 active save per user per game, optimistic concurrency via revision)
create table public.game_saves (
  user_id uuid not null references auth.users(id) on delete cascade,
  game_id text not null check (game_id in (
    'vak', 'auromatch', 'auromandala', 'word-riddle', 'vak-living-sanctuary', 'auroblocks'
  )),
  envelope_version integer not null default 1,
  game_schema_version integer not null,
  revision bigint not null default 1,
  source_guest_id text,
  checksum text not null,
  payload jsonb not null,
  client_updated_at timestamptz not null,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, game_id)
);

-- 4. Game Save Revision History (Rollback safety net: bounded retention, e.g. last 5 revisions)
create table public.game_save_revisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  game_id text not null,
  revision bigint not null,
  checksum text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index idx_save_revisions_lookup on public.game_save_revisions(user_id, game_id, revision desc);

-- 5. Server-Verified Entitlements (Browser READ-ONLY; writes strictly via Edge Functions / service_role)
create table public.entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sku text not null,
  game_id text not null, -- specific game_id or 'all'
  status text not null check (status in ('active', 'revoked', 'expired')),
  source text not null check (source in ('beta_free', 'verified_purchase', 'comp')),
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, sku)
);

-- 6. Purchase Receipts / Payment Ledger (STRICTLY SERVER-ONLY; zero direct browser access)
create table public.purchase_receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  provider text not null,              -- e.g., 'stripe', 'razorpay'
  provider_transaction_id text not null unique,
  sku text not null,
  amount_minor integer not null,
  currency text not null,
  status text not null check (status in ('pending', 'succeeded', 'refunded', 'disputed')),
  raw_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- 7. Privacy-First Analytics Events (Append-only, opt-in, no PII)
create table public.analytics_events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  guest_id text,
  game_id text not null,
  event_name text not null,
  properties jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now()
);

-- 8. Remote Config & Feature Flags (Public READ-ONLY; admin/service_role writes only)
create table public.remote_config (
  key text primary key,
  value jsonb not null,
  min_app_version text,
  updated_at timestamptz not null default now()
);
```

### Entity Relationships
- `auth.users (1)` ── `(1) user_profiles`
- `auth.users (1)` ── `(0..N) guest_identity_links` (a user can play on phone, tablet, and desktop — each with its own `guestId` linked to one `user_id`)
- `auth.users (1)` ── `(0..6) game_saves` (one canonical save row per game) ── `(0..5) game_save_revisions` (automatic pre-update archive trigger for rollback safety)
- `auth.users (1)` ── `(0..N) entitlements` (derived strictly from `purchase_receipts` or admin grants)

---

## 3. Row Level Security (RLS) Policy Matrix

| Table | `SELECT` | `INSERT` | `UPDATE` | `DELETE` |
|---|---|---|---|---|
| `user_profiles` | `auth.uid() = user_id` | `auth.uid() = user_id` | `auth.uid() = user_id` | Deny (cascade on account delete) |
| `guest_identity_links` | `auth.uid() = user_id` | `auth.uid() = user_id` | `auth.uid() = user_id` | `auth.uid() = user_id` |
| `game_saves` | `auth.uid() = user_id` | Via RPC `upsert_game_save_checked` (enforces `auth.uid() = user_id` + payload size limit + revision check) | Via RPC `upsert_game_save_checked` | Deny direct client delete (use explicit reset RPC) |
| `game_save_revisions` | `auth.uid() = user_id` | Trigger-only (`SECURITY DEFINER`) | Deny | Retention job only |
| `entitlements` | `auth.uid() = user_id` | **Deny (`service_role` / Edge Fn only)** | **Deny (`service_role` only)** | **Deny (`service_role` only)** |
| `purchase_receipts` | **Deny (Edge Fn only)** | **Deny (`service_role` only)** | **Deny (`service_role` only)** | **Deny** |
| `analytics_events` | **Deny** | Authenticated or validated Edge Fn (rate-limited, schema-checked) | **Deny** | **Deny** |
| `remote_config` | Public `anon` + `authenticated` | **Deny (`service_role` only)** | **Deny (`service_role` only)** | **Deny** |

---

## 4. User Authentication & Account Linking Flow

### Supported Auth Methods (Product-Owner Confirmed Before Provisioning)
- **Recommended primary:** Email Magic Link (OTP) and/or Google OAuth (PKCE flow — safe for static SPA / GitHub Pages with zero client secrets).
- **CSP Requirement (`index.html`):** When Supabase Auth is enabled, update `connect-src` in `index.html` CSP to explicitly allow **only** `https://<project-ref>.supabase.co` (never wildcard `https://*`).

### Guest-to-Account Linking Flow (Zero Data Loss)
1. User plays locally in `'guest'` mode under `guest_<uuid>` across VAK, AuroMatch, and AuroMandala.
2. User opts into Sign-In (via Portal Account modal or in-game Sync button).
3. Supabase Auth completes PKCE sign-in and issues short-lived JWT + refresh token.
4. `SupabaseAuthProvider.linkGuestIdentity(guestId, account)` upserts `(auth.uid(), guestId)` into `guest_identity_links`.
5. For each integrated game with local progress:
   - Pull `game_saves` row for `(auth.uid(), gameId)`.
   - **Case A — No remote save exists (new account):** Immediately push local guest envelope (`expectedRevision = 0`) → local guest progress becomes revision `1` in the cloud.
   - **Case B — Remote save exists & local is empty (new device):** Apply remote save to local game storage via game's `GameStorageAdapter` (creating local pre-apply backup first).
   - **Case C — Both local and remote have non-empty divergent saves:** Invoke the game's `GameMergeStrategy.resolve(local, remote)` (see `PRODUCT_INTEGRATION_MATRIX.md` §4). If `conflict_requires_user_choice`, present a clear comparison modal (Local Device vs. Cloud Account) before writing anything.
6. **Sign-Out Behavior:** Clears Supabase auth session tokens only; `PlayerIdentity.mode` reverts to `'guest'`; `guestId` and all local IndexedDB/`localStorage` game saves remain **100% untouched**.

---

## 5. Offline Synchronization & Optimistic Conflict Handling

### Optimistic Concurrency RPC (`upsert_game_save_checked`)
```sql
-- Conceptual PostgreSQL RPC signature (runs as invoker / enforces auth.uid())
-- Rejects blind overwrites when expected_revision != current revision,
-- returning status='conflict' + current server row instead of losing data.
```
- **Payload Size Guard:** Enforce max `payload` size per game in SQL check constraint (e.g., `pg_column_size(payload) <= 524288` — 512 KB cap — preventing canvas stroke bloat from AuroMandala).
- **Offline Outbox Queue (in `AuroMindPlatformDB`):**
  - While offline, local saves commit immediately to the game's native storage; the SDK marks `outbox[gameId] = { dirty: true, queuedAt }`.
  - When `online` fires (or on next launch), `CloudSyncService` flushes dirty games in sequence using `pushWithOptimisticLock(envelope, userId, lastKnownRevision)`.
  - On HTTP `409` / `status: 'conflict'`, the SDK pulls `serverRecord`, runs the game's `GameMergeStrategy`, archives the previous local state in `pre_merge_backup_<gameId>`, and only pushes the resolved state once safely merged or user-confirmed.
- **Trigger-Backed Server Rollback:** Before updating `game_saves`, a Postgres trigger copies the prior row into `game_save_revisions` (pruning revisions older than the latest 5 per `(user_id, game_id)`).

---

## 6. Entitlements & Payment Security Architecture

- **Zero Client-Side Trust:** Browser code can **never** write to `entitlements` or grant licenses via `localStorage` or `postMessage`.
- **Checkout & Webhook Flow (Supabase Edge Functions):**
  1. Authenticated user initiates checkout → browser calls Edge Function `create-checkout-session` with user JWT + `sku`.
  2. Payment provider (Stripe / Razorpay / etc.) handles card/UPI processing externally.
  3. Payment provider posts signed webhook → Edge Function `payment-webhook` verifies HMAC signature using server-only webhook secret, inserts `purchase_receipts`, and upserts `entitlements (status = 'active')` using `SUPABASE_SERVICE_ROLE_KEY`.
  4. Browser calls `entitlements.refresh()` → reads `entitlements` via RLS (`SELECT` where `auth.uid() = user_id`), caching verified read-only claims locally for offline continuity.

---

## 7. Public Client Configuration vs. Privileged Server Secrets

| Artifact / Credential | Classification | Allowed in Browser / Git? | Storage Location |
|---|---|---|---|
| `SUPABASE_URL` | Public configuration | Browser: Yes (env/config); Git: Only via `.env.example` placeholder | Build/runtime public config |
| `SUPABASE_ANON_KEY` | Public client key (RLS-gated) | Browser: Yes (only safe WITH strict RLS on every table) | Build/runtime public config |
| `SUPABASE_SERVICE_ROLE_KEY` | **PRIVILEGED SECRET** | **NEVER in browser, client bundle, or Git** | Supabase Edge Function Secrets only |
| Payment Provider Secret / Webhook Secret | **PRIVILEGED SECRET** | **NEVER in browser, client bundle, or Git** | Supabase Edge Function Secrets only |
| OAuth Provider Client Secrets | **PRIVILEGED SECRET** | **NEVER in browser, client bundle, or Git** | Supabase Auth Dashboard Secrets only |
| PranaMandala E2EE Sankalpa Passphrase | **USER-ONLY SECRET** | **NEVER sent to server or stored in Supabase** | Derived transiently in browser WebCrypto |

---

## 8. Privacy, Data Minimization & Compliance

- **Zero PII in Guest Mode:** `guest_<uuidv4>` is a random opaque identifier with zero email, name, IP, or device-fingerprinting attributes.
- **E2EE Preservation:** PranaMandala's Sankalpa vault remains client-side AES-GCM 256-bit encrypted; cloud sync either excludes it by default or syncs only opaque ciphertext + salt/IV with explicit user consent.
- **Right to Export & Delete:** Provide an authenticated Edge Function `delete-account` (`auth.admin.deleteUser` cascading all user rows) and local JSON export for all 3 launch games.

---

## 9. Pre-Provisioning Confirmation Checklist (Do Not Provision Until Confirmed)

Before provisioning any Supabase project or running migrations, the Product Owner must confirm:
1. Whether an existing Supabase organization/project already exists or a new project should be created.
2. Preferred cloud region (e.g., `ap-south-1` Mumbai / `ap-southeast-1` Singapore for India/global audience).
3. Approved authentication methods for 1 January 2027 (Email Magic Link, Email/Password, Google OAuth, Apple Sign-In).
4. Payment processor selection (Stripe, Razorpay, or deferred post-January).
5. Free vs. paid tier policy and SKU list for VAK Speech Control, AuroMatch, and AuroMandala.
6. Whether GitHub Pages (`gapskris.github.io/AuroMind`) or a custom domain will be the canonical production origin (required for Supabase Auth Redirect URLs and CORS allowlists).
