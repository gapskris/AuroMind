# B21 — Milestone Bucket 5: Auth, SMTP & Scheduler Operational Report

**Document Reference:** `docs/reports/B21_BUCKET_5_AUTH_SMTP_SCHEDULER_REPORT.md`  
**Milestone:** B21 — Bucket 5: Staging Deployment, Live E2E Acceptance & Operational Closeout  
**Project:** AuroMasti v2.0.0 Beta  
**Workspace:** `C:\AuroMindPortal`  
**Branch:** `dev/studio-integration`  
**Supabase Project:** `rlqrtbjynaihdspbqtce` (`ap-southeast-1`)  
**Date:** November 28, 2026  
**Status:** COMPLETE & MONITORED (Tracked under `OWNER-OPS-04`)

---

## 1. Executive Summary

This report establishes the operational readiness and constraints for Authentication, Identity, SMTP email delivery, and background scheduling for AuroMasti v2.0.0 Beta. Live audit of Supabase project `rlqrtbjynaihdspbqtce` confirms that the native email auth provider is active, all third-party OAuth providers are disabled per architectural specifications, and redirect URLs include both staging and production hostnames. The built-in email rate ceiling of 3-4 emails/hour is documented under `OWNER-OPS-04`, and an automated GitHub Actions scheduler has been established for processing the storage deletion queue.

---

## 2. Supabase Auth & Identity Configuration

### 2.1 Provider Status (Live API Audit: `GET /auth/v1/settings`)
- **Email Provider:** Enabled (`email: true`).
- **OAuth / External Providers:** All 24 external providers (Google, Apple, GitHub, Discord, Facebook, Twitter, etc.) are strictly **disabled** (`false`).
- **Signups:** Enabled (`disable_signup: false`).
- **Confirmations:** `mailer_autoconfirm: false` (requires email verification token).
- **Phone / SMS:** Disabled (`phone: false`).

### 2.2 Allowed Redirect URLs (`supabase/config.toml`)
The project configuration explicitly allows the following redirect targets:
- `https://staging.auromasti.pages.dev/**` (Staging Cloudflare Pages)
- `https://auromasti.com/**` (Canonical Production Domain)
- `http://localhost:3000/**`, `http://localhost:8080/**`, `http://127.0.0.1:3342/**` (Local Dev & E2E Test Origins)

---

## 3. SMTP Mail Delivery Architecture & Invariant

### 3.1 Free Tier Rate Limiting Constraint
The project is hosted on the Supabase Free tier. Under this tier:
- Supabase provides a default shared SMTP mailer.
- The shared mailer enforces a hard ceiling of approximately **3 to 4 confirmation emails per hour**.
- Exceeding this rate results in HTTP 429 rate limit errors for user signups or magic links.

### 3.2 Owner Operational Requirement (`OWNER-OPS-04`)
For development and staging testing, the built-in mailer is operational. However, before opening live-player onboarding or public marketing:
1. Product Owner must configure a custom SMTP provider (Resend, SendGrid, Postmark, or AWS SES) in the Supabase Dashboard:
   - Path: **Project Settings > Authentication > SMTP Settings**.
   - Enable Custom SMTP.
   - Enter Host, Port, Username, and Password.
2. Custom SMTP lifts the hourly rate limit to thousands of emails/hour and improves delivery inbox placement.

---

## 4. Background Scheduled Processing

### 4.1 Storage Deletion Queue Automation
To prevent orphan storage objects after account deletion or artwork purges:
- Script `scripts/process-storage-deletion-queue.mjs` executes batch deletions.
- Workflow `.github/workflows/storage-deletion-worker.yml`:
  - Schedule: `cron: '0 * * * *'` (hourly).
  - Concurrency: `group: storage-worker` (prevents race conditions).
  - Processing: Bounded to 50 items per invocation using `FOR UPDATE SKIP LOCKED`.
  - Cap: Maximum 5 retry attempts before marking items as terminal failure.

---

## 5. Compliance Sign-Off

- [x] Email authentication enabled; OAuth providers disabled.
- [x] Redirect URLs include staging origin and production domain.
- [x] SMTP rate limit documented and tracked under `OWNER-OPS-04`.
- [x] Hourly storage deletion worker configured and committed.
