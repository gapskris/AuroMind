# B19.10 — Bucket 3: Consolidated Master Owner Action Register

**Project:** AuroMasti v2.0.0 Beta  
**Workspace:** `C:\AuroMindPortal`  
**Branch:** `dev/studio-integration`  
**Supabase Project:** `rlqrtbjynaihdspbqtce`  
**Region:** `ap-southeast-1`  
**Target Delivery:** November 30, 2026  
**Register Status:** Authoritative Master

---

## 1. Executive Summary

This register tracks all Product Owner governance, infrastructure, and operational action items required for the release of AuroMasti v2.0.0 Beta. 

It provides an unambiguous record of resolved actions and transparently enumerates the external dependencies that remain mandatory before live-player onboarding.

---

## 2. Consolidated Owner Action Master Table

| Action ID | Workstream | Title & Description | Current Status | Release Impact | Action Required By |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`OWNER-OPS-01`** | Bucket 2 / Infra | **Automated Backup & Disaster Recovery Verification**<br>Live project is on Free plan (0 scheduled backups, PITR not included). Schema push proceeded on verified clean DB with documented waiver. | **OPEN / GATED** | **BLOCKING LIVE PLAYERS**<br>Allowed for schema/dev; strictly forbidden for live player onboarding. | Upgrade project to Supabase Pro, or verify automated daily database dump solution. |
| **`OWNER-OPS-02`** | Bucket 2 / Storage| **Storage Provisioning & Migration 10 Authorization**<br>Attributable PO authorization for private buckets (`avatars`, `user-artwork`) and 8 owner policies. | **CLOSED** | Completed and verified in B19.9.8. | None (Resolved by Gopal Krishna Panda). |
| **`OWNER-OPS-03`** | Bucket 3 / Edge | **Personal Access Token Scope for Edge Functions**<br>Current CLI token lacks `edge_functions_read` / `write` permissions (HTTP 403 on CLI deployment). | **OPEN / EXTERNAL** | **BLOCKING REMOTE EDGE DEPLOY**<br>Functions code is complete; requires CLI push. | Product Owner to regenerate PAT with Edge Functions scopes in Dashboard. |
| **`OWNER-OPS-04`** | Bucket 3 / Auth | **Production Custom SMTP Provider Setup**<br>Built-in Supabase mailer capped at 3-4 emails/hour, causing dropped login links under live load. | **OPEN / EXTERNAL** | **BLOCKING LIVE PLAYERS**<br>Required before public player registrations. | Product Owner to input custom SMTP credentials (Resend/SendGrid/SES) in Auth Dashboard. |
| **`CANON-GOV-01`** | Bucket 2 / Gov | **Attributable Migration Authorization Audit Trail**<br>Formal audit trail recording PO approvals, timestamps, and hashes in `authorization_audit.log`. | **CLOSED** | Immutably recorded and synchronized. | None (Resolved). |

---

## 3. Detailed Action Profiles & Resolution Criteria

### 3.1 `OWNER-OPS-01`: Automated Backup & PITR Verification
- **Status:** **OPEN / MANDATORY PRE-LAUNCH GATE**
- **Context:** Supabase Free plan does not include Point-in-Time Recovery (PITR) or daily automated snapshots. The Product Owner authorized the initial schema deployment on the verified empty database with explicit acceptance of this risk.
- **Mandatory Pre-Launch Policy:**
  > *"Supabase Pro with automated backups, or an independently verified automated backup solution, remains mandatory before live-player onboarding."*
- **Resolution Criteria:**
  1. Project upgraded to Supabase Pro and automated daily backups verified in the Dashboard, OR
  2. Automated daily logical dump pipeline (`pg_dump` via scheduled GitHub Action to encrypted S3/R2) verified with a test restore run.

---

### 3.2 `OWNER-OPS-03`: Personal Access Token Scope for Edge Functions
- **Status:** **OPEN / EXTERNAL DEPENDENCY**
- **Context:** Execution of `supabase functions list --remote=rlqrtbjynaihdspbqtce` produced `HTTP 403: {"missing_permissions":["edge_functions_read"]}`. The CLI Personal Access Token in `.env.local` lacks Edge Functions administrative rights.
- **Resolution Step-by-Step:**
  1. Log in to [Supabase Dashboard Account Tokens](https://supabase.com/dashboard/account/tokens).
  2. Generate a new Personal Access Token.
  3. Ensure the token includes full permissions (`database`, `edge_functions`).
  4. Replace `SUPABASE_ACCESS_TOKEN` in `.env.local`.
  5. Run `supabase functions deploy --project-ref rlqrtbjynaihdspbqtce`.

---

### 3.3 `OWNER-OPS-04`: Production Custom SMTP Provider Configuration
- **Status:** **OPEN / EXTERNAL DEPENDENCY**
- **Context:** The live Supabase Auth instance currently uses the shared default mailer. The default rate limit of 3–4 emails per hour will cause player signup and magic link failures under live launch traffic.
- **Resolution Step-by-Step:**
  1. Open the Supabase Project Dashboard -> **Authentication** -> **SMTP Settings**.
  2. Enable "Enable Custom SMTP".
  3. Enter production SMTP credentials (Host, Port, Username, Password, Sender Email, Sender Name).
  4. Send a test email from the Dashboard to confirm delivery.

---

## 4. Governance Sign-Off

This register provides a complete and transparent accounting of platform operations. All technical code and database-side tasks within engineering control are resolved. The three open items (`OWNER-OPS-01`, `OWNER-OPS-03`, `OWNER-OPS-04`) are external administrative actions owned by the Product Owner.
