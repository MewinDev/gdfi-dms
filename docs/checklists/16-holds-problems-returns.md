# 16 Holds, problems and returns

Last updated: 18 November 2026 (PHT)

## A. Purpose and roles

Exceptions on work (v2 §6.4): a hold (waiting on something that is not a fault), a problem (a fault, with its own red timer), a return (papers back to the previous person with a reason), missing papers. Roles: whoever does the work raises and resolves their own; LA Supervisor/Head resolves any problem and moves holds; Admin keeps the reason lists.

## B and C. Checklist: v2 §6.4 exception types and rules

| # | Item (v2 source) | Status | Where | Who | Customizable? | Evidence | UAT check |
|---|---|---|---|---|---|---|---|
| 1 | Hold with a reason and required remarks; resume with remarks; only the owner resumes | ✅ Built | Loan file, Job | `holds:raise`, `holds:resolve` | Hold reasons | `lib/services/holds.ts`, e2e `on-hold.spec.ts` | UAT LA-9 |
| 2 | A hold reason can pause the TAT ("Paused") | ✅ Built (DMS addition, D-046) | Settings, Hold reasons | `holds:manage` | Pauses TAT per reason | `HoldReason.pausesTat` | Demo "Paused" item |
| 3 | Transfer a hold to another person (owner on leave) | ✅ Built | Loan file | `holds:transfer` | No | kit item 4 (moving a hold) | Kit "Moving a hold" |
| 4 | Problem: raise, resolve own, resolve any, mark outside our control | ✅ Built | Loan file, Job | `problems:*` | Problem reasons | e2e `open-items.spec.ts` | UAT SUP-10 |
| 5 | Missing document flagged by the LA (blocks closure later) | ✅ Built (closure is phase C) | Check documents | `papers:mark_missing` | Missing-paper reasons | module 12 row 14 | UAT LA-6 |
| 6 | Missing document found by the DP: return to the LA | ✅ Built | Job | `jobs:return_to_la` | Return reasons | module 13 row 6 | UAT DP-5 |
| 7 | Transaction with issue at the LTO: retry or return | ✅ Built | Job | `jobs:work` | Problem reasons | module 13 row 14 | UAT DP-4 |
| 8 | Fund mismatch exception | ❌ Missing | n/a | n/a | n/a | module 14 row 10 | n/a |
| 9 | Unliquidated CA exception (no new CA) | ✅ Built as decided | My funds | System | No | module 15 row 5 | UAT DP-9 |
| 10 | myloans change (Open Item) exception | ✅ Built | Open Items | approvers | Monitored fields | module 10 | UAT SUP-2 |
| 11 | QA finding; document not received at the vault | 📦 Later phase (B) | n/a | n/a | n/a | STATUS phase B | n/a |
| 12 | Every exception records type, owner, dates, remarks, resolution; resolution in the audit trail | ✅ Built (holds, problems, returns, missing papers each keep their own history and audit rows) | Loan file Journey, Audit log | n/a | No | `writeAudit` in each service | Read a hold's history |
| 13 | Open exceptions on the dashboard and an Exceptions report (§6.4) | ⚠️ Partial: Home counts, the Open items card on the loan file, Monitoring; TAT report "Problems and holds by reason"; no single Exceptions report | Home, TAT report | various | No | `app/(app)/reports/tat/page.tsx` | TAT report by reason |
| 14 | Returned documents report (§10.1) | ⚠️ Partial: returns counted per person in the TAT report; no list report | TAT report | `reports:tat` | No | module 19, report 5 | n/a |

## D. Known limits and open questions

- One Exceptions report (holds, problems, returns, missing papers, Open Items in one list) would cover row 13 and report 5; proposed as "soon after go-live".
