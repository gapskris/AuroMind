# AuroMind — Studio-to-Git Reconciliation Unresolved Items & Next Actions

**Document ID:** `STUDIO_GIT_RECONCILIATION_UNRESOLVED_ITEMS.md`  
**Date:** 2026-11-20  
**Status:** COMPLETE — AWAITING USER DECISION & STAGING AUTHORIZATION  
**Primary Directory:** `C:\AuroMind_Studio`  
**Git Reference:** `C:\AuroMindPortal` (`dev/studio-integration`, commit `67d0472`)  

---

## 1. Statement of Zero Git Mutations

In strict adherence to the project instructions and safety restrictions:
- **No Git mutations were performed.**
- Neither `git add`, `git commit`, `git push`, `git checkout`, `git reset`, `git merge`, nor `git rebase` was executed.
- The Git reference repository at `C:\AuroMindPortal` remains on branch `dev/studio-integration` at commit `67d04726fb82cdb3d9f253bd36e627fe0d7aef20` (`67d0472`) with a clean working tree.
- The primary working directory `C:\AuroMind_Studio` remains independent, fully preserved, and uncommitted.

---

## 2. Items Requiring Explicit Human Approval

The following items are flagged for human decision and explicit authorization before proceeding with future Git operations or deployments.

---

### Item 1: Authorization of Future Git Staging and Integration
* **Context:** `C:\AuroMind_Studio` is now the authoritative working copy containing all Batch B0, B1, B1.1, and B2 enhancements, along with all 35 backported Git assets, normalized line endings (`.gitattributes`), and Phase 0 archive consolidation.
* **Decision Needed:** When and how should the reconciled Studio working tree be transferred into the Git repository `C:\AuroMindPortal`?
* **Options:**
  * **Option 1A (Recommended — Staged Worktree Sync):** Synchronize the reconciled Studio files into `C:\AuroMindPortal`, review `git status` and `git diff`, and stage them in logical, atomic commits (e.g., Commit 1: Asset backports & gitattributes; Commit 2: Phase 0 archive; Commit 3: B0–B2 SDK & portal integration; Commit 4: Security reports).
  * **Option 1B (Direct Git Initialization in Studio):** Initialize Git directly inside `C:\AuroMind_Studio`, set the remote tracking to the existing repository, and merge or commit directly.
  * **Option 1C (Hold):** Keep `C:\AuroMind_Studio` as a local sandbox without any Git operations until manual developer testing is conducted.
* **Status:** **AWAITING USER APPROVAL**

---

### Item 2: Removal of 10 Redundant Phase 0 Reports from Git Repository
* **Context:** The user explicitly approved Option 1 for Studio, which consolidated all 10 Phase 0 audit reports into `phase0-audit/ARCHIVE.md`. In `C:\AuroMind_Studio`, this archive was created and verified 100% verbatim against the originals. However, because no deletions were permitted in `C:\AuroMindPortal`, the 10 individual report files still exist in the Git reference working tree.
* **Decision Needed:** When syncing Studio to `C:\AuroMindPortal`, should the 10 individual files in `phase0-audit/` be deleted from Git tracking in favor of `phase0-audit/ARCHIVE.md`?
* **Recommendation:** **Yes.** Deleting the 10 redundant files fulfills the approved consolidation decision and reduces repository file clutter by 9 files.
* **Status:** **AWAITING USER APPROVAL**

---

### Item 3: Managing the 1,000-File Threshold for Google AI Studio
* **Context:** Google AI Studio imposes a practical limit / recommendation of fewer than 1,000 files per project. 
  - The reconciled physical file count in `C:\AuroMind_Studio` is **1,033**.
  - Candidate tracked files (excluding `.aistudio`, `.antigravity`, `.vscode`) count is **1,028**.
  - The runtime application files (portal, games, assets, SDK) account for **956** files.
  - The `architecture-design/` directory contains 29 extensive documentation reports (~30 files total).
* **Decision Needed:** Does the user wish to consolidate older historical architecture design reports (e.g., B0 and early B1 audits) into a single archive file to bring the total file count below 1,000 before importing back into Google AI Studio?
* **Options:**
  * **Option 3A (Consolidate Historical Reports):** Consolidate 12 historical B0/B1 audit reports into `architecture-design/HISTORICAL_ARCHIVE.md`, reducing total file count from 1,028 to 988 (< 1,000 files).
  * **Option 3B (Exclude via Config):** Add historical docs to `.aistudioignore` or equivalent sync configuration so they remain in Git but do not count toward Studio limits.
  * **Option 3C (Retain All):** Keep all 29 individual design documents if AI Studio currently accepts 1,028 files without throwing an import error.
* **Status:** **AWAITING USER APPROVAL**

---

### Item 4: Long-Term Secrets Management for Quarantined `.env`
* **Context:** The uncommitted `.env` file containing an active `GEMINI_API_KEY` was moved to `C:\AuroMind_Secret_Quarantine\quarantined.env`. Root `.gitignore` files in both directories actively prevent it from being committed.
* **Decision Needed:** Should the quarantined credential file remain in `C:\AuroMind_Secret_Quarantine`, or does the user wish to securely store the key in a password manager and delete the quarantine folder?
* **Recommendation:** Retain `C:\AuroMind_Secret_Quarantine\quarantined.env` on disk for local developer convenience while relying on verified `.gitignore` rules for repository safety, or migrate it to an official credential store if required by organizational security policy.
* **Status:** **AWAITING USER APPROVAL**

---

### Item 5: Host Node.js Runtime Installation
* **Context:** The local Windows host environment currently lacks `node.exe` in its system `PATH`. All SDK and server test suites were verified in the container baseline during Batch B2 (31/31 SDK tests passing, 7/7 portal suites passing).
* **Decision Needed:** Does the user plan to install Node.js v18+ or v20+ on the local Windows host machine for native local CLI testing, or will testing continue in containerized CI environments?
* **Recommendation:** Installing Node.js LTS on the host is recommended for faster local development cycles.
* **Status:** **AWAITING USER APPROVAL / INFORMATIONAL**

---

## 3. Summary of Completed Deliverables in `architecture-design/`

With all five reports authored, the reconciliation documentation is complete:

1. `STUDIO_GIT_RECONCILIATION_EXECUTION_REPORT.md`  
   *Chronological record of Stages 0 through 8, backups, SHA-256 baseline, and execution log.*
2. `STUDIO_GIT_RECONCILIATION_FINAL_INVENTORY.md`  
   *Complete inventory of 1,033 files, directory breakdowns, and file status classifications.*
3. `STUDIO_GIT_RECONCILIATION_VALIDATION_REPORT.md`  
   *Categorized verification matrix (Completed, Deferred, Approval Required) and cryptographic parity evidence.*
4. `STUDIO_GIT_RECONCILIATION_SECURITY_REPORT.md`  
   *Credential quarantine audit, `.gitignore` evaluation evidence, `.env.example`, and documentation security layers.*
5. `STUDIO_GIT_RECONCILIATION_UNRESOLVED_ITEMS.md`  
   *Formal confirmation of zero Git mutations and inventory of decisions reserved for human approval.*

---

## 4. Next Step Recommendation

Wait for explicit user feedback and approval on Items 1, 2, and 3 before taking any action in Git.
