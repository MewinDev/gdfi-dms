# Module checklists

Last updated: 18 November 2026 (PHT)

One file per module (D-055). Each has: A) purpose and roles; B) a checklist row per feature or requirement (status, where, who, customizable, evidence, UAT check); C) for the phase A workflow modules (12 to 16, 19), every v2 requirement and every step of the v2 .docx charts, with "Changed by D-xxx" where a decision replaced a v2 rule; D) known limits and open questions. Module 04 is the master list of everything customizable, including every permission tick and its default roles.

**Rule (CLAUDE.md):** every future piece or fix updates the matching checklist file (status, evidence, settings) in the same commit.

Status values: ✅ Built · ⚠️ Partial · ❌ Missing · ⏸ Blocked (by whom) · 📦 Later phase (B / C). Readiness = ✅ rows out of the rows that are not 📦.

| # | Module | ✅ | ⚠️ | ❌ | ⏸ | 📦 | Readiness |
|---|---|---|---|---|---|---|---|
| 01 | [Sign-in and accounts](01-sign-in-and-accounts.md) | 9 | 0 | 1 | 0 | 0 | 9 / 10 (Entra missing) |
| 02 | [Roles and permissions](02-roles-and-permissions.md) | 12 | 0 | 0 | 0 | 0 | 12 / 12 |
| 03 | [Branch scope and data access](03-branch-scope-and-data-access.md) | 9 | 0 | 0 | 0 | 0 | 9 / 9 |
| 04 | [Settings and customization (master list)](04-settings-and-customization.md) | 3 | 2 | 2 | 0 | 2 | 3 / 7 |
| 05 | [Working-days calendar](05-working-days-calendar.md) | 9 | 0 | 0 | 1 | 0 | 9 / 10 |
| 06 | [Product classification](06-product-classification.md) | 7 | 0 | 0 | 0 | 0 | 7 / 7 |
| 07 | [myloans API](07-myloans-api.md) | 9 | 1 | 0 | 2 | 0 | 9 / 12 |
| 08 | [PN # search](08-pn-search.md) | 9 | 0 | 0 | 0 | 0 | 9 / 9 |
| 09 | [myloans sync](09-myloans-sync.md) | 12 | 0 | 0 | 2 | 0 | 12 / 14 |
| 10 | [Open Items and Reference data changes](10-open-items-and-reference-changes.md) | 13 | 1 | 0 | 0 | 1 | 13 / 14 |
| 11 | [Inbox, branch pool, Accept / Forward, TAT, Move work items](11-inbox-pool-and-tat.md) | 12 | 0 | 1 | 0 | 0 | 12 / 13 |
| 12 | [LA workflow](12-la-workflow.md) (phase A) | 20 | 5 | 0 | 0 | 1 | 20 / 25 |
| 13 | [DP workflow](13-dp-workflow.md) (phase A) | 15 | 4 | 1 | 0 | 0 | 15 / 20 |
| 14 | [Finance and funds](14-finance-funds.md) (phase A) | 12 | 5 | 1 | 0 | 0 | 12 / 18 |
| 15 | [Liquidation](15-liquidation.md) (phase A) | 8 | 3 | 1 | 0 | 0 | 8 / 12 |
| 16 | [Holds, problems and returns](16-holds-problems-returns.md) (phase A) | 10 | 2 | 1 | 0 | 1 | 10 / 13 |
| 17 | [Files and file access log](17-files-and-file-access-log.md) | 6 | 1 | 1 | 0 | 1 | 6 / 8 |
| 18 | [Notifications and Home warnings](18-notifications-and-home.md) | 9 | 0 | 0 | 2 | 0 | 9 / 11 |
| 19 | [Reports (the 19 v2 reports)](19-reports.md) (phase A) | 2 | 10 | 0 | 0 | 8 | 2 / 12 |
| 20 | [Audit logs](20-audit-logs.md) | 8 | 0 | 1 | 0 | 1 | 8 / 9 |
| 21 | [Security](21-security.md) | 12 | 0 | 1 | 1 | 0 | 12 / 14 |
| 22 | [Backup and restore](22-backup-and-restore.md) | 7 | 0 | 0 | 2 | 0 | 7 / 9 |
| 23 | [Operations](23-operations.md) | 7 | 2 | 1 | 4 | 0 | 7 / 14 |
| 24 | [Test kit, seed data and demo](24-test-kit-and-demo.md) | 10 | 0 | 0 | 0 | 0 | 10 / 10 |
| | **Total** | **232** | **36** | **12** | **14** | **15** | **232 / 294 (79%)** |

(Module 19 counts row 0, "filters and export for all reports", as one ⚠️ besides the 19 reports.)

## Overall phase A readiness

**Not ready for go-live yet.** Everything that can be built on the mock is built and tested (vitest 1,373 passed; full e2e, see `docs/STATUS.md`). What stands between today and go-live:

1. **Blocked by others (⏸):** Microsoft sign-in set-up (IT), myloans staging access (C5), the hosting decision (scheduler, backups, file storage), the GitHub setup (CI), the official holiday list (Admin), UAT on staging.
2. **Go-live gaps (❌ / ⚠️) to build once decided:** Entra sign-in, DP receipt confirmation, Admin cancel, the four optional transactions, and small items: `docs/PHASE_A_GAPS.md` section 1 (4 to 9 days beyond the go-live preparation).
3. **Soon after go-live:** the fund formula (if wanted), liquidation details, an Exceptions report, report exports: `docs/PHASE_A_GAPS.md` section 2.

Total to a phase A go-live: **18 to 29 days** (`docs/STATUS.md`).
