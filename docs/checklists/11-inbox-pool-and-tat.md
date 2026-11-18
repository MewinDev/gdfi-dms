# 11 Inbox, branch pool, Accept / Forward, TAT, Move work items

Last updated: 18 November 2026 (PHT)

## A. Purpose and roles

v2 §3.1 and §5.3: every person has a pending inbox; work is accepted before it is theirs; TAT counts from accept to forward (D-014). The DMS adds branch pools (D-015, D-046): work for a branch waits there until someone accepts it. Roles: LA, DP, Finance (items), LA Supervisor/Head and Admin (move work, Away).

## B. Checklist

| # | Item | Status | Where | Who | Customizable? | Evidence | UAT check |
|---|---|---|---|---|---|---|---|
| 1 | Personal inbox: My items, least time left first, due colours | ✅ Built | Inbox | LA, DP, Finance | Amber days | `lib/services/work-items.ts`, e2e `inbox.spec.ts`; volume 42 ms | UAT LA-2 |
| 2 | Branch pools (LA pool, DP pool) with waiting colours | ✅ Built | Inbox, Branch pool | same | Pool colours | D-046; volume 38 ms | UAT LA-2 |
| 3 | Released loans not yet in the DMS in the LA pool; waiting from pool entry | ✅ Built | Inbox, Branch pool | LA | Cutoff | D-053 (10b), e2e `open-items-outcomes.spec.ts` | Kit item 45 |
| 4 | Accept takes the item; one current holder | ✅ Built | Inbox | the item's role | No | `work-items.ts` | UAT LA-2 |
| 5 | Forward (to a person or the pool); every move in the movement ledger | ✅ Built | Loan file, Job | the item's role | No | `WorkMovement`, D-046 | UAT LA-10 |
| 6 | TAT per person from accept to forward; waiting time recorded separately | ✅ Built | Reports, TAT, By person | `reports:tat` | TAT targets | D-014, D-046 | UAT SUP-11 |
| 7 | Late fund release counted against Finance, not the DP (time to act from arrival) | ✅ Built | TAT report | n/a | No | D-046 | TAT report "Time to act" |
| 8 | Move work items: back to the pool, or to another person of the same role (reassign; v2 §5.3 "Admin reassigns") | ✅ Built (Changed by D-046: LA Supervisor/Head and Admin by `workitems:move`) | Inbox | `workitems:move` | No | e2e `inbox.spec.ts` | UAT SUP-7 |
| 9 | Away: items shown to supervisors; not named for new work | ✅ Built | Inbox, Home | `users:away` | No | D-046 | UAT SUP-8 |
| 10 | Home lines for supervisors (waiting too long, with people away) | ✅ Built | Home | LA Supervisor/Head | No | e2e `home-compact.spec.ts` | UAT SUP-1 |
| 11 | Return to the previous user with required remarks | ✅ Built (LA ↔ DP returns, declines, pull back) | Job, Loan file | by role | Return reasons | `return-to-la.ts`, `sent-changes.ts` | UAT DP-5 |
| 12 | Admin cancels a transaction (v2 §5.3, §8 "Cancelled: Admin / Superadmin only") | ❌ Missing: no cancel action; a transaction ends only by completion, by the LA's pull back before accept, or when myloans cancels the loan (Open Item) | n/a | n/a | n/a | grep: no cancel service | n/a |
| 13 | Correct a due date with a reason | ✅ Built | Inbox | `duedates:correct` | No | D-042 | n/a |

## D. Known limits and open questions

- Admin cancel (row 12) is a gap: see `docs/PHASE_A_GAPS.md`. Reassign is covered by Move work items.
