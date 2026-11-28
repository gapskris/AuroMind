# B19.10 — Bucket 3: Supabase Authentication & Identity Lifecycle Audit

**Project:** AuroMasti v2.0.0 Beta  
**Workspace:** `C:\AuroMindPortal`  
**Branch:** `dev/studio-integration`  
**Supabase Project:** `rlqrtbjynaihdspbqtce`  
**Region:** `ap-southeast-1`  
**Audit Script:** `scripts/audit-bucket3.mjs`  
**Target Delivery:** November 30, 2026

---

## 1. Executive Summary

This audit evaluates the authentication and identity tier of the AuroMasti platform on Supabase project `rlqrtbjynaihdspbqtce`.

AuroMasti utilizes a hybrid identity model:
1. **Local-First Guest Identity:** Bounded by Web Locks and persistent IndexedDB/localStorage storage, allowing instant offline and local gameplay without cloud friction.
2. **Authenticated Player Accounts:** Passwordless Magic Link / Email OTP powered by Supabase Auth, enabling cloud sync of artwork and multi-device persistence.
3. **Seamless Account Linking:** Links local guest identities to newly authenticated accounts via `public.guest_identity_links` and SDK-level reconciliation.

All settings have been verified directly against the live Supabase Auth API (`GET /auth/v1/settings`) and PostgreSQL database catalog.

---

## 2. Live Supabase Auth Configuration Audit

Inspection was conducted by querying the live Supabase Auth management endpoint (`https://rlqrtbjynaihdspbqtce.supabase.co/auth/v1/settings`):

| Setting Category | Configuration Attribute | Live Value | Conformance / Status |
| :--- | :--- | :--- | :--- |
| **Email Authentication** | `email.enabled` | `true` | **CONFORMS** — Primary authentication vector |
| **User Registration** | `signup.enabled` | `true` | **CONFORMS** — Open player registration |
| **Email Confirmation** | `mailer_autoconfirm` | `false` | **CONFORMS** — Secure verification required |
| **OAuth Providers** | `external.google.enabled` | `false` | **CONFORMS** — Third-party OAuth disabled |
| | `external.apple.enabled` | `false` | **CONFORMS** — Third-party OAuth disabled |
| | `external.github.enabled` | `false` | **CONFORMS** — Third-party OAuth disabled |
| **Anonymous Sign-In** | `anonymous_users.enabled` | `false` | **CONFORMS** — Handled via client SDK guest engine |
| **SMS / Phone Auth** | `sms.enabled` | `false` | **CONFORMS** — Phone auth not utilized |

---

## 3. Email Delivery & SMTP Provider Assessment

- **Current Operational Provider:** Default Supabase Built-in Mailer.
- **Provider Quota Limit:** Approximately 3–4 emails per hour (Free Tier constraint).
- **Risk Assessment:** The built-in mailer is suitable for staging verification and developer smoke tests. However, under live production load, player login OTP requests will quickly exhaust the hourly ceiling, leading to dropped verification emails.
- **Remediation Action:** Registered as **`OWNER-OPS-04`**. The Product Owner must provide and configure custom SMTP provider credentials (e.g. Resend, SendGrid, Amazon SES, or Postmark) in the Supabase Dashboard prior to live-player onboarding.

---

## 4. Redirect URL Allowlist & Security Header Review

The redirect allowlist configured in `supabase/config.toml` and Supabase Auth dashboard governs where authentication tokens and magic links may navigate:

- `AUTH_SITE_URL`: `http://localhost:3000` (Local developer portal)
- `additional_redirect_urls`:
  - `https://staging.auromasti.pages.dev/**` (Cloudflare Pages staging environment)
  - `https://auromasti.pages.dev/**` (Cloudflare Pages production environment)
  - `https://*.pages.dev/**` (Branch preview deployments)

### Security Considerations:
- **Wildcard Restraint:** Wildcards are strictly restricted to Cloudflare Pages domains (`*.pages.dev`). No open redirect vulnerabilities (`*` or unverified origins) are permitted.
- **Token Handling:** Hash fragment and PKCE parameters are stripped immediately by `assets/sdk/auromind-sdk.js` upon session extraction to prevent token leakage in browser history or referrer headers.

---

## 5. Guest Identity Lifecycle & Account Linking

AuroMasti implements a client-orchestrated, server-reconciled guest identity lifecycle:

### 5.1 Client Identity Engine (`assets/sdk/auromind-sdk.js`)
- **Generation:** Cryptographically random UUIDv4 generated on first portal launch.
- **Storage Tiering:**
  1. Primary: IndexedDB (`auromind-identity` database).
  2. Fallback: `localStorage` (`auromind_guest_id` key).
  3. In-memory session cache.
- **Cross-Tab Concurrency:** Uses the Web Locks API (`navigator.locks.request('auromind-identity-lock', ...)`) to prevent split-brain identity races when multiple tabs or iframes open concurrently.

### 5.2 Server-Side Linking Schema (`public.guest_identity_links`)
- **Table Definition:**
  ```sql
  CREATE TABLE public.guest_identity_links (
    guest_id text NOT NULL,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    linked_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (guest_id, user_id)
  );
  ```
- **Access Control:** `REVOKE ALL` from `anon`; `service_role` and `authenticated` with RLS restricting users to rows where `user_id = auth.uid()`.
- **Reconciliation Workflow:** When a guest logs in or signs up, `reconcileGuestRecords(guestId, user.id)` associates existing local progress and high scores with the authenticated account.

---

## 6. Live Database State Preflight

A live catalog query against `rlqrtbjynaihdspbqtce` confirmed:
- `auth.users`: **0 records** (clean database, no test or orphaned users).
- `public.guest_identity_links`: **0 records**.
- `public.user_profiles`: **0 records**.
- `public.storage_deletion_queue`: **0 records**.

---

## 7. Audit Conclusion

The authentication and identity architecture is structurally sound, secure, and fully aligned with release requirements. Live-player onboarding remains gated on custom SMTP configuration (`OWNER-OPS-04`) and automated backup verification (`OWNER-OPS-01`).
