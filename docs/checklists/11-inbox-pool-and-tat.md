# 11 Inbox, branch pool, Accept / Forward, TAT, Move work items

Last updated: 27 November 2026 (PHT)

## A. Purpose and roles

v2 §3.1 and §5.3: every person has a pending inbox; work is accepted before it is theirs; TAT counts from accept to forward (D-014). The DMS adds branch pools (D-015, D-046): work for a branch waits there until someone accepts it. Roles: LA, DP, Finance (items), LA Supervisor/Head and Admin (move work, Away).

## B. Checklist

| # | Item | Status | Where | Who | Customizable? | Evidence | UAT check |
|---|---|---|---|---|---|---|---|
| 1 | Personal inbox: My items, least time left first, due colours | ✅ Built | Inbox | LA, DP, Finance | Amber days | `lib/services/work-items.ts`, e2e `inbox.spec.ts`; volume 42 ms | UAT LA-2 |
| 2 | Branch pools (LA pool, DP pool) with waiting colours | ✅ Built | Inbox, Branch pool | same | Pool colours | D-046; volume 38 ms | UAT LA-2 |
| 3 | Released loans not yet in the DMS in the LA pool; waiting from pool entry; the "myloans · Not yet in DMS" badge and the preview (Changed by D-060: no Accept; D-063: the row opens the preview card in the Inbox's panel, with Refresh from myloans; no link to the page) | ✅ Built | Inbox, Branch pool; Loans (Not yet in DMS filter) | LA | Cutoff | D-053 (10b), e2e `open-items-outcomes.spec.ts`, `loans-preview.spec.ts` (26 Nov 2026) | Kit item 45 |
| 4 | Accept takes the item; one current holder | ✅ Built | Inbox | the item's role | No | `work-items.ts` | UAT LA-2 |
| 5 | Forward (to a person or the pool); every move in the movement ledger | ✅ Built | Loan file, Job | the item's role | No | `WorkMovement`, D-046 | UAT LA-10 |
| 6 | TAT per person from accept to forward; waiting time recorded separately | ✅ Built | Reports, TAT, By person | `reports:tat` | TAT targets | D-014, D-046 | UAT SUP-11 |
| 7 | Late fund release counted against Finance, not the DP (time to act from arrival) | ✅ Built | TAT report | n/a | No | D-046 | TAT report "Time to act" |
| 8 | Move work items: back to the pool, or to another person of the same role (reassign; v2 §5.3 "Admin reassigns") | ✅ Built (Changed by D-046: LA Supervisor/Head and Admin by `workitems:move`) | Inbox | `workitems:move` | No | e2e `inbox.spec.ts` | UAT SUP-7 |
| 9 | Away: items shown to supervisors; not named for new work | ✅ Built | Inbox, Home | `users:away` | No | D-046 | UAT SUP-8 |
| 10 | Home lines for supervisors (waiting too long, with people away) | ✅ Built | Home | LA Supervisor/Head | No | e2e `home-compact.spec.ts` | UAT SUP-1 |
| 11 | Return to the previous user with required remarks | ✅ Built (LA ↔ DP returns, declines, pull back) | Job, Loan file | by role | Return reasons | `return-to-la.ts`, `sent-changes.ts` | UAT DP-5 |
| 12 | Cancel a transaction (v2 §5.3, §8): a reason, logged; the job stops; released cash stays owed (D-056 item 2) | ✅ Built (D-056: the tick goes to the LA Supervisor/Head and Admin, not only Admin) | Loan file, Cancel transaction | `transactions:cancel` (LA Supervisor/Head, Admin) | Tick per role or person | `lib/services/cancel-transaction.ts`; `tests/integration/phase-a-gaps.test.ts`; e2e `cancel-transaction.spec.ts` | UAT SUP-12 |
| 13 | Correct a due date with a reason | ✅ Built | Inbox | `duedates:correct` | No | D-042 | n/a |
| 15 | Compact, quick Inbox (D-063): "Inbox" 22 px with one line and an (i) (My items, then Branch pool on the next line); Set away in the header ("Away until <date>"; the Away card is gone); tabs switch at once with the lists in the page and the tab in the address; quick filters in My items (Late, Due today, Paused); one row per loan (borrower with the PN under it, transactions as chips with their step, released date and amount, branch, due date with the status badge after it; the whole row opens the panel; no Open button, no measure text, no waiting time); the details panel (side panel, bottom sheet on a phone): borrower, PN with Copy, branch, product, released on, amount only with "See loan amounts", each transaction's step, due date, status and waiting time, Accept / Move / Correct due date, Check papers and Open loan file; Branch pool: the preview card with the two questions and Open loan file; arrow keys, Enter, Esc with the focus back on the row | ✅ Built | Inbox | LA, DP, Finance; Move: `workitems:move`; amount: `loans:view_amounts` | Quick filters (per visit) | e2e `inbox-compact.spec.ts`, `inbox.spec.ts`, `open-items-outcomes.spec.ts`, `loans-preview.spec.ts`, `myloans-sync.spec.ts`; unit `lib/work/inbox-groups.test.ts` | Open a loan, then Inbox: one row with four chips; click it: the panel; Esc |
| 14 | A released loan not yet in the DMS is taken by opening it (D-060): Open loan file on its preview makes the loan file the opener's, their items arrive and are accepted at that moment (TAT starts), the pool item closes; two at once make one file and the second is told "Already opened by <name> at <time>" | ✅ Built | Loan preview | `loans:open` | No | e2e `loans-preview.spec.ts` at 1440, 820, 390 (26 Nov 2026) | Two LAs open the same pool loan: one file |

## D. Known limits and open questions

- Cancel (row 12) was built on 19 to 24 November 2026 (D-056). Reassign is covered by Move work items.
