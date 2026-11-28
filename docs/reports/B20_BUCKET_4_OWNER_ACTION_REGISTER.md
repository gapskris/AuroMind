# B20 — Bucket 4: Consolidated Master Owner Action Register

**Project:** AuroMasti v2.0.0 Beta  
**Workspace:** `C:\AuroMindPortal`  
**Branch:** `dev/studio-integration`  
**Supabase Project:** `rlqrtbjynaihdspbqtce` (`ap-southeast-1`)  
**Target Delivery:** November 30, 2026  
**Register Authority:** Senior Release Engineer & Product Owner Master Log

---

## 1. Executive Summary

This register serves as the authoritative, comprehensive master list of all operational, governance, and infrastructure actions requiring Product Owner intervention for AuroMasti v2.0.0 Beta.

All tasks within engineering control across Bucket 2, Bucket 3, and Bucket 4 are **100% complete, code-complete, and test-verified**. The remaining open items are genuine external dependencies that cannot be resolved without dashboard-level actions, external provider credentials, or subscription tier decisions.

---

## 2. Consolidated Owner Action Master Register

| Action ID | Domain | Action Title | Current Status | Release Gating Impact | Action Required By Product Owner |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`OWNER-OPS-01`** | Database / DR | **Automated Backup & PITR Verification** | **OPEN / HARD GATE** | **BLOCKS PUBLIC PLAYERS**<br>Mandatory before public onboarding. | Upgrade project to Supabase Pro, or verify automated daily database dump solution. |
| **`OWNER-OPS-02`** | Storage | **Storage Provisioning & Migration 10** | **CLOSED** | Fully resolved in B19.9.8. | None (Completed & verified). |
| **`OWNER-OPS-03`** | Edge Functions | **PAT Scope Expansion for Edge Functions** | **OPEN / EXTERNAL** | **BLOCKS CLI EDGE PUSH**<br>Code is complete; needs CLI deploy. | Regenerate Personal Access Token in Supabase Dashboard with Edge Functions scopes. |
| **`OWNER-OPS-04`** | Auth / Email | **Production Custom SMTP Setup** | **OPEN / EXTERNAL** | **BLOCKS PUBLIC PLAYERS**<br>Required before public registrations. | Enter custom SMTP provider credentials (Resend/SendGrid/SES) in Auth Dashboard. |
| **`OWNER-OPS-05`** | Operations | **Storage Deletion Queue Scheduled Trigger** | **OPEN / OPERATIONAL**| **NON-BLOCKING FOR BETA**<br>Worker runs on demand / manual. | Authorize GitHub Actions hourly scheduled workflow for automated background execution. |
| **`CANON-GOV-01`** | Governance | **Attributable Migration Authorization Log** | **CLOSED** | Immutably logged in audit trail. | None (Completed & verified). |

---

## 3. Detailed Action Profiles & Resolution Procedures

### 3.1 `OWNER-OPS-01`: Automated Backup & PITR Verification
- **Status:** **OPEN / PRE-LAUNCH HARD BLOCK**
- **Context:** Project `rlqrtbjynaihdspbqtce` is on the Supabase Free tier (0 automated backups, no PITR). Developer preflight, staging assembly, and internal testing are authorized to proceed. However, public player registrations and live cloud-writes must remain blocked until an automated, recoverable backup pipeline is verified.
- **Resolution Step-by-Step:**
  - *Option A (Pro Plan):* In the Supabase Dashboard, upgrade project to Pro ($25/mo). Confirm that daily automated backups are active in **Database** -> **Backups**.
  - *Option B (Automated Logical Dump):* Set up an encrypted GitHub Actions `pg_dump` cron workflow to S3/R2 and verify a test restore.

### 3.2 `OWNER-OPS-03`: Personal Access Token Scope Expansion
- **Status:** **OPEN / EXTERNAL DEPENDENCY**
- **Context:** CLI command `supabase functions list` returned `HTTP 403: Missing required permission(s): edge_functions_read`. The existing PAT in `.env.local` lacks Edge Functions management privileges.
- **Resolution Step-by-Step:**
  1. Visit [Supabase Account Tokens](https://supabase.com/dashboard/account/tokens).
  2. Generate a new Personal Access Token with full `Edge Functions` scopes.
  3. Replace `SUPABASE_ACCESS_TOKEN` in `.env.local`.
  4. Run `npx supabase functions deploy --project-ref rlqrtbjynaihdspbqtce`.

### 3.3 `OWNER-OPS-04`: Production Custom SMTP Provider Configuration
- **Status:** **OPEN / EXTERNAL DEPENDENCY**
- **Context:** Supabase built-in mailer is capped at 3–4 emails/hour. Concurrent player signups will drop OTP verification emails.
- **Resolution Step-by-Step:**
  1. In the Supabase Dashboard, navigate to **Authentication** -> **SMTP Settings**.
  2. Toggle on "Enable Custom SMTP".
  3. Enter production SMTP credentials (Host, Port, Username, Password, Sender Email).
  4. Send a test email from the Dashboard to confirm delivery.

### 3.4 `OWNER-OPS-05`: Storage Deletion Queue Scheduled Trigger
- **Status:** **OPEN / OPERATIONAL RECOMMENDATION**
- **Context:** Worker script `scripts/process-storage-deletion-queue.mjs` is tested and verified (0 pending items). To ensure recurring automated garbage collection of deleted artwork, an automated trigger should be established.
- **Resolution:** Add a GitHub Actions scheduled workflow (`.github/workflows/storage-worker.yml`) to invoke the worker hourly.

---

## 4. Governance Sign-Off

All technical code, database schemas, and client integrations within engineering control are resolved and tested. The open items represent standard external cloud administrative tasks assigned to the Product Owner.
