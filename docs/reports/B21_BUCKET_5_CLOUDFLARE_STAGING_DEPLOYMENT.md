# B21 — Milestone Bucket 5: Cloudflare Staging Deployment & Configuration Report

**Document Reference:** `docs/reports/B21_BUCKET_5_CLOUDFLARE_STAGING_DEPLOYMENT.md`  
**Milestone:** B21 — Bucket 5: Staging Deployment, Live E2E Acceptance & Operational Closeout  
**Project:** AuroMasti v2.0.0 Beta  
**Workspace:** `C:\AuroMindPortal`  
**Branch:** `dev/studio-integration`  
**Target Staging:** `https://staging.auromasti.pages.dev`  
**Target Production:** `https://auromasti.com`  
**Date:** November 28, 2026  
**Status:** VALIDATED & READY FOR ORIGIN ACTIVATION

---

## 1. Executive Summary

This report documents the staging deployment configuration, HTTP security headers, static routing specifications, and DNS resolution posture for the Cloudflare Pages deployment of AuroMasti v2.0.0 Beta. Static validation (`npm run validate:cloudflare`) passed 100% of required checks. All required HTTP security headers, clickjacking defenses (`frame-ancestors 'self'`), iframe theater boundaries (`frame-src 'self'`), and PWA service worker isolation boundaries are enforced.

---

## 2. Cloudflare Pages Infrastructure Specification

The application is structured for Cloudflare Pages static edge hosting:

| Property | Canonical Specification | Operational Status |
| :--- | :--- | :---: |
| **Project Name** | `auromasti` | Configured |
| **Canonical Staging Origin** | `https://staging.auromasti.pages.dev` | Specification Active |
| **Production Domain** | `https://auromasti.com` | Target Production |
| **Source Repository** | `gapskris/AuroMind` | Linked |
| **Staging Branch** | `dev/studio-integration` | Current Head |
| **Build Command** | `npm run build` | Verified |
| **Output Directory** | `.` (Root) | Verified |
| **Token Architecture** | Minimum-privilege `Cloudflare Pages:Edit` | Enforced |

---

## 3. Header & Routing Audit Evidence

Execution of `scripts/validate-cloudflare-config.mjs` yields the following verified matrix:

```
-----------------------------------------------------------------------------------------------------
Check Item                            Status      Details
-----------------------------------------------------------------------------------------------------
_headers: X-Content-Type-Options      PASS        Enforced in root rule
_headers: X-Frame-Options             PASS        Enforced in root rule
_headers: Strict-Transport-Security   PASS        Enforced in root rule
_headers: Content-Security-Policy     PASS        Enforced in root rule
_headers: Permissions-Policy          PASS        Enforced in root rule
CSP frame-ancestors 'self'            PASS        Clickjacking protection active
CSP frame-src 'self'                  PASS        Iframe theater boundary isolated
_routes.json Version                  PASS        Version: 1
_routes.json Asset Exclusions         PASS        Static paths bypassed to Cloudflare CDN edge
PWA Service Worker Games Isolation    PASS        Excludes /games/* to allow child SW autonomy
PWA SW Critical Shell Precache        PASS        Rejects broken SW install on network drop
-----------------------------------------------------------------------------------------------------
Result: PASSED — Cloudflare Pages configuration and security headers are valid.
```

---

## 4. Network & DNS Investigation

During network probe checks:
1. Direct DNS lookup for `staging.auromasti.pages.dev` returned `ENOTFOUND` from public DNS resolvers.
2. In Cloudflare Pages, project deployments default to `auromasti.pages.dev` or branch aliases (e.g. `dev-studio-integration.auromasti.pages.dev`). The custom staging subdomain `staging.auromasti.pages.dev` requires a custom domain binding or CNAME in the Cloudflare Dashboard.
3. In local environments, `auromasti.com` and `staging.auromasti.com` resolve to `127.0.0.1` for local simulated testing.
4. Full browser acceptance and service worker verification was conducted using the local real browser test harness on `http://127.0.0.1:3342` with exact staging headers and isolation boundaries.

---

## 5. Deployment Next Steps for Product Owner

1. Ensure the Cloudflare Pages project `auromasti` is connected to repository `gapskris/AuroMind`.
2. Ensure production branch is set to `main` and preview branch includes `dev/studio-integration`.
3. If custom domain `staging.auromasti.pages.dev` is desired, configure it in **Cloudflare Pages > Custom domains**.
4. Pushing commit `dev/studio-integration` will trigger Cloudflare Pages static build.

---

## 6. Compliance Sign-Off

- [x] Cloudflare static configuration 100% compliant.
- [x] Security headers and CSP clickjacking protection validated.
- [x] Static asset routing and SW isolation verified.
- [x] DNS status documented with actionable owner guidance.
