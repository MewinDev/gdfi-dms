# 19 Reports (the 19 v2 reports)

Last updated: 18 November 2026 (PHT)

## A. Purpose and roles

v2 §10 lists 19 reports, each filterable by date, branch, stage and user and exportable to Excel or PDF. The DMS has some as reports and covers others with lists, the Monitoring page, the Journey and the audit log. Roles: LA Supervisor/Head, Admin, Finance, Operations Monitor (by their ticks).

## B and C. Checklist: every v2 report (known gap 5)

| # | Report (v2 §10) | Status | Where | Who | Customizable? | Evidence | UAT check |
|---|---|---|---|---|---|---|---|
| 0 | All reports: filters (date, branch, stage, user) and export to Excel or PDF | ⚠️ Partial: filters differ per screen; export is CSV (opens in Excel); no PDF (the liquidation report prints) | n/a | n/a | No | CSV routes | Open a CSV in Excel |
| 1 | TAT Report per stage, per employee, per month | ⚠️ Partial: TAT and problems report with By person (TAT from accept, time to act), by reason, jobs, liquidations; CSV; no per-month view | Reports, TAT (`/reports/tat`) | `reports:tat`, `reports:tat_export` | Filters | `app/(app)/reports/tat/page.tsx`; volume 97 ms | UAT SUP-11 |
| 2 | Pending and Overdue Documents Report | ⚠️ Partial: Inbox (due colours), Monitoring (overdue jobs per processor), Home counts; no single report | Inbox, Monitoring | various | No | `app/(app)/monitoring` | n/a |
| 3 | Transaction Status Report per PN # (holder, stage, days in stage) | ⚠️ Partial: Loans table with stage, holder, days, filters and CSV | Loans | `loans:view`, `loans:export` | No | e2e `loans-table.spec.ts`; volume 75 ms | Export the Loans list |
| 4 | Document Movement History (audit per account, LTO times, transmittal) | ⚠️ Partial: the loan's Journey (story, timeline, papers) and the audit log; transmittal is phase B | Loan file, Journey; Audit log | `loans:view`, `audit:view` | No | e2e `journey.spec.ts` | Read a loan's Journey |
| 5 | Returned Documents Report (by, to, reason) | ⚠️ Partial: returns counted per person in the TAT report; each return in the Journey; no list report | TAT report | `reports:tat` | No | module 16 row 14 | n/a |
| 6 | Closed Transactions Report (stored in the warehouse) | 📦 Later phase (C) | n/a | n/a | n/a | STATUS phase C | n/a |
| 7 | Employee Demerit Summary | 📦 Later phase (B) | n/a | n/a | n/a | D-044 (late record kept for it) | n/a |
| 8 | QA Deficiency Report | 📦 Later phase (B) | n/a | n/a | n/a | STATUS phase B | n/a |
| 9 | Demerit Dispute Report | 📦 Later phase (B) | n/a | n/a | n/a | STATUS phase B | n/a |
| 10 | DP Fund Request and LTO Processing Status, per fund type | ⚠️ Partial: Funds page by type and status (CSV); Monitoring, LTO offices | Funds, Monitoring | Finance, `monitor:lto` | No | `app/(app)/funds/page.tsx` | Funds, filter CA |
| 11 | Fund Release Report per account (type, computed, released, ref #, last 4, by, date) | ⚠️ Partial: Funds list and CSV carry release details; no "computed" amount (module 14 row 1) | Funds | Finance | No | Funds CSV | Download the Funds CSV |
| 12 | Expense Breakdown and CA Liquidation Report (fees, km, meals, other; actual vs computed; unliquidated) | ⚠️ Partial: lines per expense kind, the liquidation report per advance, overdue list; no computed side | Funds; TAT report, Liquidations | Finance | No | e2e `liquidation.spec.ts` | Print a liquidation report |
| 13 | Open Items Report (PN, field, old, new, time, raised, status, approver, remarks) | ⚠️ Partial: Open Items page, Decided tab, filters; no export | Open Items | approvers | No | module 10 row 15 | Decided tab |
| 14 | myloans Sync Log (time, PNs checked, changes, errors) | ✅ Built (run log; no export) | Settings, MyLoans sync | `myloans:manage` | No | module 09 row 4 | UAT ADM-5 |
| 15 | PN # Search Log (invalid, not found, not released) | ✅ Built (with CSV) | Reports, PN searches | `reports:pnsearch` | No | module 08 row 7 | Download the CSV |
| 16 | Archive and Warehouse Location Report | 📦 Later phase (C) | n/a | n/a | n/a | STATUS phase C | n/a |
| 17 | Detailed QR Archive Locator Report | 📦 Later phase (C) | n/a | n/a | n/a | STATUS phase C | n/a |
| 18 | Archive Box Inventory Report | 📦 Later phase (C) | n/a | n/a | n/a | STATUS phase C | n/a |
| 19 | Archive Movement History Report | 📦 Later phase (C) | n/a | n/a | n/a | STATUS phase C | n/a |

Count of the 19 reports: ✅ 2 (14, 15), ⚠️ 9 (1 to 5, 10 to 13), 📦 8 (6 to 9, 16 to 19), ❌ 0. Row 0 (filters and export for all reports) is ⚠️ too.

## D. Known limits and open questions

- Which reports are needed on go-live day: proposed in `docs/PHASE_A_GAPS.md` (section Reports).
- PDF export: the CSV opens in Excel; PDF only where a printed page is used (the liquidation report). To confirm.
