# B21 — Milestone Bucket 5: Master Owner Action Register

**Document Reference:** `docs/reports/B21_BUCKET_5_OWNER_ACTION_REGISTER.md`  
**Milestone:** B21 — Bucket 5: Staging Deployment, Live E2E Acceptance & Operational Closeout  
**Project:** AuroMasti v2.0.0 Beta  
**Workspace:** `C:\AuroMindPortal`  
**Date:** November 28, 2026  
**Status:** ACTIVE AUDIT REGISTER

---

## 1. Executive Summary

This register tracks all Product Owner operational actions, governance gates, and infrastructure dependencies across AuroMasti v2.0.0 Beta. All engineering deliverables for Bucket 2 (Database & Storage), Bucket 3 (Auth & Identity), Bucket 4 (Game Integration), and Bucket 5 (Staging Acceptance) are complete. The remaining open items are external administrative actions required prior to live-player onboarding and commercial activation.

---

## 2. Master Action Item Inventory

| Action ID | Priority | Category | Status | Target Phase | Description & Action Required |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **`OWNER-OPS-01`** | **CRITICAL** | Infrastructure | **MANDATORY HARD GATE** | Pre-Live Players | Upgrade Supabase to Pro ($25/mo) with daily automated backups or establish verified automated pg_dump export before live players create accounts or persist artwork. |
| **`OWNER-OPS-03`** | **HIGH** | DevOps / Functions | **PENDING OWNER ACTION** | Staging / Prod | Regenerate Supabase PAT with `edge_functions_read` and `edge_functions_write` permission scopes to deploy 6 canonical Edge Functions via CLI, OR deploy functions directly via Dashboard. |
| **`OWNER-OPS-04`** | **HIGH** | Communications | **MANDATORY HARD GATE** | Pre-Live Players | Configure custom SMTP provider (Resend, SendGrid, or AWS SES) in Supabase Dashboard to bypass the Free tier ceiling of 3-4 emails/hour. |
| **`OWNER-OPS-02`** | **MEDIUM** | Deployment | **OPEN** | Production Launch | Bind production environment secrets in Cloudflare Pages Dashboard for production domain `https://auromasti.com`. |
| **`CANON-GOV-01`** | **RESOLVED** | Governance | **CLOSED (B19.9.6)** | Migration Gate | Attributable Product Owner authorization for the 10 canonical database migrations. Executed and confirmed. |
| **`CANON-GOV-02`** | **RESOLVED** | Governance | **CLOSED (B19.9.8)** | Storage Gate | Storage provisioning authorization for `avatars` and `user-artwork` buckets. Executed and confirmed. |

---

## 3. Operational Risk Analysis & Gating Policy

1. **Staging Testing Permissibility:**
   - Staging testing, internal QA, and automated browser verification may proceed immediately under the current Free plan posture.
2. **Hard Gate Before Public Launch:**
   - Under no circumstances shall real players be invited or public registration opened while `OWNER-OPS-01` (Automated Backups) and `OWNER-OPS-04` (Custom SMTP) remain unfulfilled.
   - Doing so risks unrecoverable data loss in event of project pause, and user lockout due to email rate limiting.

---

## 4. Compliance Sign-Off

- [x] All owner action items categorized with unambiguous owners and requirements.
- [x] Hard gates clearly demarcated from development staging permissions.
- [x] Closed governance gates recorded with historical provenance.
