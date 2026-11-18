# 10 Open Items and Reference data changes

Last updated: 18 November 2026 (PHT)

## A. Purpose and roles

v2 §5.2 and Chart 9: a myloans change to a loan or borrower field waits as an Open Item until an approver of the loan's branch approves (apply) or rejects (keep), with remarks. Names of areas, divisions, companies, branches and products are lookup data: applied by themselves and listed (D-012, D-053). Roles: LA Supervisor/Head and Admin approve (by permission, D-029); LA and DP see the banner.

## B. Checklist

| # | Item | Status | Where | Who | Customizable? | Evidence | UAT check |
|---|---|---|---|---|---|---|---|
| 1 | One Open Item per changed field (OI-YYYY-######), old and new value, myloans time | ✅ Built | Open Items (`/open-items`) | approvers | Monitored fields | D-053, `tests/integration/open-items.test.ts` | UAT SUP-2 |
| 2 | Approve applies, Reject keeps, remarks 5 to 500, decision logged | ✅ Built | Open Items | `myloans:review` / `myloans:review_borrower` | No | e2e `open-items-outcomes.spec.ts` | UAT SUP-2, SUP-3 |
| 3 | Rule group (loan type, amount, product, release date) decided together, with the effect on transactions said first | ✅ Built | Open Items | `myloans:review` | No | e2e `myloans-sync.spec.ts` | Kit item 31 |
| 4 | Borrower name, CIF, CIN: separate audience | ✅ Built | Open Items | `myloans:review_borrower` | Yes | D-053 | Kit item 30 |
| 5 | Supersede on a newer value; closes by itself when myloans puts the DMS value back | ✅ Built | n/a | System | No | `open-items.test.ts` | n/a |
| 6 | Status outcomes: Cancelled closes, Superseded moves the file to the new PN, NotReleased / Inactive hold until released | ✅ Built | Open Items | `myloans:review` | No | D-053 update; e2e `open-items-outcomes.spec.ts`, `myloans-sync.spec.ts` | UAT SUP-4 to SUP-6; kit 43, 44 |
| 7 | While a loan is not Released: Send, Forward and new cash wait (Changed by D-053: v2 lets work continue) | ✅ Built | Loan file | n/a | No | `lib/services/source-blocks.ts` | Kit item 34 |
| 8 | Cash out on a cancelled loan: Ask for the cash back before approving | ✅ Built | Open Items | approvers | No | `lib/services/open-items.ts` | Kit item 34 |
| 9 | Unassigned queue for branches without an approver; Admin Home warning | ✅ Built | Open Items, Unassigned | All-branches approvers | No | D-011 | UAT ADM-6 |
| 10 | Top-menu link with the pending count; Home card; waiting colours | ✅ Built | top menu, Home | approvers | Colours | D-054 | Count matches the list |
| 11 | Decided tab with filters (PN, branch, field) | ✅ Built | Open Items, Decided | approvers | No | `app/(app)/open-items/page.tsx` | Filter by PN |
| 12 | Notify the current holder and approvers of a new Open Item | ✅ Built (one update per loan and run, field names only, plus the email event "source_changed"; banner, menu count, Home card) | Updates, email | approvers, holders | Email event switch | `lib/services/open-items.ts` (`notify`) | Raise one: the approver gets an update |
| 13 | A loan cannot be Stored (closed) with an unresolved Open Item | 📦 Later phase (C: closure) | n/a | n/a | n/a | v2 §5.2 | n/a |
| 14 | Reference data changes (renames) applied by themselves and listed | ✅ Built | Settings, Reference data changes | `refdata:view` | No | D-053, D-054 | UAT ADM-7 |
| 15 | Open Items report (v2 §10.4): export | ⚠️ Partial: Decided tab, no CSV | Open Items | approvers | No | module 19, report 13 | n/a |

## D. Known limits and open questions

- v2 says "LA Supervisor/Head only"; the DMS uses the permission (Admin also approves by default, D-029).
