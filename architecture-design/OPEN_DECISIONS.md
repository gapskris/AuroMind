# AuroMind Platform Modernization — Open Decisions Requiring Product Owner Confirmation

**Status:** Design Freeze Deliverable (7 of 7)  
**Purpose:** Track every unresolved product, repository, or provisioning decision that blocks downstream batches or threatens the **1 January 2027** launch target. No assumptions have been silently baked into code.

---

## 1. Critical-Path Decisions (Blocking Launch Schedule)

### OD-01 — AuroMandala Upstream Source Repository Access (CRITICAL — Threatens 1 Jan 2027 Launch)
- **Verified Fact:** `games/auromandala/` contains only compiled Vite/React output (`assets/index-DhYVrlzX.js`, `assets/index-MfgMt68V.css`); zero editable `.ts`/`.tsx` source files exist in `gapskris/AuroMind`.
- **Decision Required:** Confirm where AuroMandala's authoritative upstream Vite/React source repository lives, how changes will be built and exported into `games/auromandala/`, and whether AuroMandala's build pipeline can import a shared JS/TS SDK module before Batch B5.
- **Impact if Unresolved:** Genuine game-level SDK integration and cloud-save readiness for AuroMandala cannot be completed by 1 January 2027 (host-page script injection is explicitly insufficient).

### OD-02 — Repository Tracked-File Budget Strategy (`1,001 / 1,000` Warning — Blocks Next GitHub Sync & Batch B1)
- **Verified Fact:** Prior to this design freeze, `dev/studio-integration` had `994` tracked files (6 below Google AI Studio's observed `1,000`-file GitHub import limit). Adding the 7 design-freeze documents under `architecture-design/` brings the workspace to **`1,001` files** (`1` file over the import limit), and `server.js` does not currently block `/architecture-design/*` from public HTTP serving.
- **Options for Product Owner Approval:**
  1. **Option 1 (Recommended — Immediate):** Move non-runtime documentation (`architecture-design/` and/or `phase0-audit/ARCHIVE.md`) to a dedicated `docs/architecture` branch (or consolidate into a single archive file) before syncing `dev/studio-integration` to GitHub, bringing `dev/studio-integration` to `993`–`994` files (`≤ 997` after adding the 3 SDK files in Batch B1).
  2. **Option 2 (If keeping `architecture-design/` on `dev/studio-integration`):** Approve a separate, read-only-first asset deduplication audit of `games/auromatch/Assets/` (`851` files = `85.6%` of repo) to create safe headroom (`< 950` tracked files), **and** add `'architecture-design'` to `BLOCKED_ROOT_SEGMENTS` in `server.js`.
- **Decision Required:** Select Option 1 or Option 2 (and confirm whether `bun.lock` should be added to `.gitignore` in Batch B0).

---

## 2. Product Behaviour & Merge Policy Decisions

### OD-03 — Spendable Currency & Canvas Conflict UX Policy (Blocks Batch S3)
- **Context:** Generic union/max-score merge is rejected because:
  - VAK Speech Control (`vak_sparks_balance`) and AuroMatch (`auromatch_sparks_balance`) have spendable currencies.
  - AuroMandala (`cachedCanvasStrokes`) has an atomic active drawing canvas.
- **Decision Required:** Confirm whether concurrent multi-device divergence on spendable currency or active canvas should:
  1. **Option 1 (Recommended):** Prompt the user with a clear **"Keep This Device vs. Load Cloud Save"** comparison dialog (with automatic local pre-merge backup), **or**
  2. **Option 2:** Introduce an append-only currency transaction ledger in VAK/AuroMatch and auto-archive the older AuroMandala canvas as a named draft.

### OD-04 — AuroMandala E2EE Sankalpa Vault Cloud-Sync Policy (Blocks Batch B5 / S3)
- **Verified Fact:** AuroMandala includes an AES-GCM 256-bit client-side encrypted Sankalpa vault (`pranamandala-fingerprint:`).
- **Decision Required:** Confirm whether the Sankalpa vault should:
  1. **Option 1 (Recommended for Jan 2027):** Remain strictly **local-only** (never uploaded to Supabase), **or**
  2. **Option 2:** Sync strictly as opaque client-encrypted ciphertext (`salt`, `iv`, `ciphertext`) behind an explicit user opt-in toggle (requiring the user's passphrase on the second device).

### OD-05 — AuroMatch Dual Entry File (`AuroMatch_Web_Prototype.html`) (Blocks Batch B4)
- **Verified Fact:** `games/auromatch/` contains both `index.html` (`87,928 B`) and `AuroMatch_Web_Prototype.html` (`87,843 B`).
- **Decision Required:** Confirm whether `AuroMatch_Web_Prototype.html` is a frozen historical artifact (leave untouched) or still actively used and needs matching SDK integration.

---

## 3. Supabase Pre-Provisioning Decisions (Blocks Batch S1)

### OD-06 — Supabase Project & Environment Confirmation
- **Decision Required:**
  1. Does an AuroMind Supabase organization/project already exist, or should a fresh project be provisioned (with separate Staging and Production projects)?
  2. Target cloud region (e.g., `ap-south-1` Mumbai / `ap-southeast-1` Singapore).
  3. Canonical production origin for Auth Redirect URLs and CSP `connect-src` (`https://gapskris.github.io/AuroMind` vs. custom domain).

### OD-07 — Approved Authentication Methods for Launch (Blocks Batch S2)
- **Decision Required:** Which sign-in methods should be enabled for 1 January 2027 (if Tier-2 Auth ships)?
  - Email Magic Link (OTP)
  - Email + Password
  - Google OAuth (PKCE)
  - Apple Sign-In

### OD-08 — Commercialization, Entitlements & Payment Processor Scope (Blocks Batch S4)
- **Decision Required:**
  1. Will VAK Speech Control, AuroMatch, and AuroMandala launch on 1 January 2027 in **Free Guest-First mode** (`entitlementsEnabled: false`), or with paid passes enabled?
  2. If paid passes are targeted for launch: confirm payment processor (Stripe / Razorpay / both), SKU catalog, free-tier cutoff per game, and refund/revocation policy.

### OD-09 — Analytics & Remote Configuration Scope (Blocks Batch S4)
- **Decision Required:** Confirm whether opt-in privacy-first analytics and remote feature flags are required for 1 January 2027 or deferred to a post-launch release (remaining cleanly disabled via `NullProvider` defaults).

---

## 4. Explicitly Deferred Decisions (Out of January 2027 Launch Scope)

- **AURO-26 (VAK Living Sanctuary `/api/beta-auth/*`):** Documented and formally deferred outside January 2027 launch scope; requires upstream VAK Living Sanctuary source rebuild when scheduled.
- **Word Riddle & AuroBlocks Native SDK Integration:** Deferred post-January; both remain architecture-compatible with `SHARED_SDK_CONTRACTS.md`.
