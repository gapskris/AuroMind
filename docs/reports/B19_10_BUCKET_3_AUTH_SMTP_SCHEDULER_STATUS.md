# B19.10 — Bucket 3: Authentication, SMTP Delivery & Scheduled Operations Status Report

**Project:** AuroMasti v2.0.0 Beta  
**Workspace:** `C:\AuroMindPortal`  
**Branch:** `dev/studio-integration`  
**Supabase Project:** `rlqrtbjynaihdspbqtce` (`ap-southeast-1`)  
**Target Delivery:** November 30, 2026  
**Operational Scope:** Auth Settings, Mail Delivery & Background Worker Scheduling

---

## 1. Executive Summary

This report establishes the operational configuration, delivery capabilities, and background maintenance architecture for the AuroMasti platform.

While core authentication and database identity schemas are fully active and tested, two operational components require Product Owner setup before public launch:
1. **Custom SMTP Provider (`OWNER-OPS-04`):** Necessary to lift the Free-tier rate limit of 3–4 emails/hour.
2. **Scheduled Worker Automation:** The asynchronous storage deletion queue processor is code-complete and tested; its recurring invocation requires a scheduled runner (e.g. GitHub Actions cron).

---

## 2. Live Supabase Auth Configuration Audit

Querying the live Auth management endpoint (`GET /auth/v1/settings`) confirmed:

```json
{
  "external": {
    "email": true,
    "anonymous_users": false,
    "apple": false,
    "google": false,
    "github": false
  },
  "disable_signup": false,
  "mailer_autoconfirm": false
}
```

### 2.1 Conformance Breakdown
- **Email Magic Link / OTP:** Active as the canonical login and signup mechanism.
- **Third-Party OAuth:** Permanently disabled to preserve player privacy and avoid external vendor dependencies.
- **Anonymous Sign-In:** Disabled in cloud auth; AuroMasti handles guest identity client-side via Web Locks (`auromind-identity` in IndexedDB) to enable offline gameplay without remote account pollution.
- **Redirect Allowlist:** Enforced in `supabase/config.toml` for `http://localhost:3000`, `https://staging.auromasti.pages.dev/**`, and `https://auromasti.com/**`. Open redirects are blocked.

---

## 3. SMTP Mail Delivery Assessment & Launch Risk

### 3.1 Current Status: Supabase Built-in Mailer
- **Throughput:** Hard-capped at 3–4 emails per hour.
- **Suitability:** Staging verification, internal development, and developer smoke testing.
- **Public Launch Risk:** Under public traffic, concurrent player signups or magic link requests will immediately exhaust the hourly rate ceiling. Subsequent players will receive HTTP 429 rate-limit errors or experience dropped login emails, causing abandonment.

### 3.2 Required Action: `OWNER-OPS-04`
Prior to public player onboarding, the Product Owner must:
1. Select an approved transactional SMTP service (e.g., Resend, SendGrid, Amazon SES, or Postmark).
2. Open the Supabase Project Dashboard -> **Authentication** -> **SMTP Settings**.
3. Enable "Custom SMTP" and enter Host, Port, Username, and Password.
4. Verify email delivery by triggering a test magic link from the staging portal.

---

## 4. Storage Deletion Queue Scheduled Worker

### 4.1 Worker Implementation (`scripts/process-storage-deletion-queue.mjs`)
Safe, asynchronous garbage collection of deleted player artwork and avatars:
- **Batch Processing:** Processes up to 50 pending records ordered by `next_retry_at ASC`.
- **Database Schema Alignment:** Uses exact column names (`id`, `bucket_id`, `object_path`, `attempts`, `max_attempts`, `status`, `last_error`, `next_retry_at`, `completed_at`).
- **Idempotency:** Deletes objects from `storage.objects`; treats not-found objects as terminal success.
- **Exponential Backoff:** Retries increment `attempts` and schedule `next_retry_at = NOW() + interval '5 minutes'`. Capped at 5 attempts before marking status `failed`.
- **Live Test Result:** Successfully executed against `rlqrtbjynaihdspbqtce` with 0 pending items, exit code 0.

### 4.2 Scheduler Evaluation & Deployment Options
On the Supabase Free plan, internal `pg_cron` with outbound HTTP capabilities is unavailable. Two scheduling models are supported:

| Mechanism | Description | Feasibility | Recommendation |
| :--- | :--- | :--- | :--- |
| **GitHub Actions Cron** | Scheduled workflow (`schedule: - cron: '0 * * * *'`) running the worker hourly. | Zero cost, fully supported. | **RECOMMENDED** |
| **Cloudflare Worker Cron** | Cloudflare Workers Cron Trigger invoking an Edge Function. | Supported on Cloudflare. | Alternative |
| **Hosted pg_cron** | Internal database cron. | Requires Supabase Pro. | Future upgrade |

---

## 5. Affirmative Status Summary

The authentication engine and deletion processor are code-complete and structurally verified. Public onboarding remains gated on `OWNER-OPS-04`.
