# Decisions

Each decision has a number, the date it was made (Philippine time), what was decided, and the reason.

- Where the project owner gave a reason, it is quoted.
- Where no reason was given, the entry points to the v2 section it follows and says the reason is to be confirmed.
- A decision is never deleted: one that changes gets a new entry that replaces the old number.

v2 below means *Loan Document Management System v2* (16 Nov 2026), the main spec.

---

## D-001 Database stays on PostgreSQL for now

- **Date:** 16 November 2026
- **Decision:** Keep PostgreSQL. Do not port to SQL Server.
- **Reason:** v2 §12 names SQL Server (DMSDB), but IT has not confirmed it. Porting is postponed until IT decides.
- **Effect:** none now. If SQL Server is confirmed later, see `V2_GAP_ANALYSIS.md` §6 (D1) for what the port touches.

## D-002 Ten roles; LA Supervisor/Head is a separate role

- **Date:** 16 November 2026
- **Decision:** The roles are:
  1. Superadmin
  2. Admin
  3. LA
  4. LA Supervisor/Head
  5. DP
  6. Finance
  7. Custodian
  8. QA
  9. Digicur
  10. Archiver

  LA Supervisor/Head is its own role. It has every LA permission, plus "Approve/Reject myloans Open Items".
- **Reason:** Project owner's decision. v2 §1.6 and §12.2 model the Supervisor as an LA with an `IsSupervisor` flag. A separate role was chosen instead. The reason is to be confirmed.
- **Open points:**
  - Finance CA vs FT users (`FOUNDATION_CHECK.md` Q3).
  - What happens to today's extra roles: Monitor, Approvers, Branch Supervisor (Q4).

## D-003 Permissions are customizable in a matrix

- **Date:** 16 November 2026
- **Decision:**
  - A matrix screen shows roles × permissions with tickboxes. It is seeded with the v2 §7 defaults.
  - Only the Superadmin can edit it.
  - Permissions are enforced on the server and read from the database (a cache is allowed). There are no hardcoded role checks.
  - The Superadmin cannot remove their own access.
  - The last Superadmin cannot lose "manage permissions".
  - Every change is audit-logged.
- **Reason:** Project owner's decision. The reason is to be confirmed. v2 §9.5 lists "user roles and permissions" as an Admin-maintained setting. This decision restricts editing to the Superadmin.

## D-004 myloans changes follow v2 strictly

- **Date:** 16 November 2026
- **Decision:**
  - Nothing from myloans is applied automatically, not even minor changes.
  - Every differing field becomes an Open Item.
  - DMS data stays unchanged until the LA Supervisor/Head approves.
  - Remarks are required on approve and on reject.
- **Reason:** v2 §3.2 and §5.2 say DMS data is not changed until the change is approved.
- **Replaces:** the earlier rule that applied "minor" changes (area, division, company, vehicle details) automatically, and the split of reviewers between the Admin and the Branch Supervisor (`docs/workflow/08-systems.md`).

## D-005 myloans check interval

- **Date:** 16 November 2026
- **Decision:**
  - Default: every 30 minutes, editable in Settings.
  - A value below 30 or above 60 minutes shows a warning but is allowed.
  - A change applies without a restart and is audit-logged.
- **Reason:** v2 §9.2 gives "every 30 minutes during office hours" as the example. The reason for the 30–60 warning band is to be confirmed.

## D-006 Closure: documents stay in the vault until the loan is fully paid

- **Date:** 16 November 2026
- **Decision:**
  - Documents stay in the vault until the loan is fully paid.
  - There are two separate statuses:
    - **Processing complete**: the document work is finished.
    - **Loan closed/released**: the loan is fully paid and the file is closed.
- **Reason:** v2 contradicts itself (`V2_GAP_ANALYSIS.md` C1):
  - §2.1, §3.6, §5.3 and §8 close the transaction when the box is Stored, right after scanning.
  - §6.1, Chart 1 and Chart 8 keep the documents in safekeeping until the loan is fully paid.

  This decision follows §6.1, Chart 1 and Chart 8.
- **Open points:** where "Processing complete" is set, and what tells the DMS that a loan is fully paid (`FOUNDATION_CHECK.md` Q15).

## D-007 BRD-only features are deferred, not dropped

- **Date:** 16 November 2026
- **Decision:** Three features from the BRDs (MTLMS, MoD) that are missing from v2 move to a later phase. They are not dropped:
  - vault pull-out;
  - 1–8 units per PN;
  - NTC / NTE / NOD notices.
- **Reason:** v2 is the source of truth for this phase. v2 §1.5 puts retrieval and borrowing out of scope for now.
