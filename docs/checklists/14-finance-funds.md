# 14 Finance and funds (CA / FT, approval, release, exceptions, bands)

Last updated: 18 November 2026 (PHT)

## A. Purpose and roles

The processor asks for money for LTO work as a Cash advance (CA) or a Fund transfer (FT); Finance approves and releases it; the processor later liquidates (module 15). Roles: DP (requests), Finance (approve, release, settle; each person handles CA, FT or both, D-009), an approver by amount band when bands are on (D-024), Admin (rules).

## B and C. Checklist: v2 §3.5, §5.6, §5.7 and Charts 5 and 6

| # | Item (v2 source) | Status | Where | Who | Customizable? | Evidence | UAT check |
|---|---|---|---|---|---|---|---|
| 1 | **Known gap 1. DP fund request, v2: one request per account; amount = document fees + km × rate + meals + other.** Built today: one request per DP covering several jobs and PNs, with lines per expense kind; each line's amount comes from the rule's suggested amount, the kind's preset, the LTO office's transport, or typed; maximums per transaction type; no km × rate or meals-per-day formula | ⚠️ Partial (formula ❌ missing; one request per DP, not per account) | My funds, New request | `funds:request` | Expense kinds, Cash-advance rules, LTO office transport | `lib/services/funds.ts` (`CashAdvanceLine` source RULE / PRESET / OFFICE / TYPED) | UAT DP-7 |
| 2 | Computed rates locked; other expenses with required remarks | ⚠️ Partial: "Other" lines need remarks; amounts are editable up to the maximum | My funds | `funds:request` | Maximums | `funds.ts` | Add an Other line without remarks |
| 3 | Fund type per request: CA or FT | ✅ Built | My funds | `funds:request` | Funds types | `lib/funds/types.ts` | UAT DP-7 |
| 4 | CA details: amount, date, needs; FT: amount, payee, receiving account (last 4 only) | ⚠️ Partial: FT account (provider, name, last 4) is entered by Finance at release, not by the DP at request | Funds, Release | Finance | Funds types (needs account / reference) | `checkRelease` in `lib/funds/types.ts` | UAT FIN-4 |
| 5 | Routed to the matching Finance user (CA only to CA users, FT to FT users) | ✅ Built (Changed by D-009: one Finance role, "Handles CA / FT" per person) | Funds | `funds:ca_*` / `funds:ft_*` | Per person | D-009, D-035 | CA-only user sees no FT |
| 6 | Finance: breakdown per PN and per expense type before release | ✅ Built | Funds, request | Finance | No | `app/(app)/funds/[number]` | UAT FIN-2 |
| 7 | Approve then release (Changed by D-024: Finance keeps approve-then-release; v2 had no approval step) | ✅ Built | Funds | `funds:*_approve`, `funds:*_release` | Approval bands (off) | D-024 | UAT FIN-2, FIN-4 |
| 8 | Approval bands by amount and role | ✅ Built, off by default | Settings, Approval bands | `settings:cash_advance` | Yes | D-024 | ⏸ Finance to confirm (D-024) |
| 9 | Release needs the details: FT bank reference # and date, account last 4; CA voucher reference; difference from the request needs remarks | ✅ Built (per funds type: needs reference, needs account) | Funds, Release | `funds:*_release` | Funds types | `lib/funds/types.ts` `checkRelease` | UAT FIN-4 |
| 10 | **Known gap 2. DP receipt confirmation:** the DP matches reference #, amount (and last 4 for FT); a mismatch is flagged to Finance and Admin; the DP cannot start LTO until resolved | ❌ Missing (the LTO stage waits for Released, not for the DP's confirmation; no mismatch flag) | n/a | n/a | n/a | grep: no confirm-receipt service | n/a |
| 11 | "Funds credited" with the date on the account | ⚠️ Partial: shown as Released with the date | Loan file Journey, Job | n/a | No | FLOWCHART Chart 6 | Read the job after release |
| 12 | Cannot release your own request | ✅ Built | Funds | n/a | No | `funds.ts` | n/a |
| 13 | Edit lines, change type before release, with remarks | ✅ Built (DMS addition) | Funds | `funds:*_edit_lines`, `funds:*_change_type` | No | e2e `funds-types.spec.ts` | n/a |
| 14 | Top-ups and carry-overs | ✅ Built (DMS addition) | Funds, My funds | Finance, DP | Carry-over limit | e2e `dp-funds.spec.ts` | n/a |
| 15 | Funds exception (one more request despite an overdue advance) | ✅ Built | Funds | `funds:exception` | No | D-039 | UAT FIN-7 |
| 16 | Finance TAT: CA release 1 day, FT 1 day; late release counted against Finance | ✅ Built (time to act from arrival, D-046; P3_CA_RELEASE 1 day) | TAT report | `reports:tat` | TAT | D-046 | TAT report, Finance rows |
| 17 | Fund release report, expense breakdown (v2 §10.3) | ⚠️ Partial: Funds page lists and CSV, by type and status | Funds | Finance | No | module 19, reports 10 to 12 | Download the Funds CSV |
| 18 | Receipts and amounts visible only with the tick | ✅ Built | Journey | `journey:view_amounts` | Yes | D-034 | An LA sees no amounts |

## D. Known limits and open questions

- Row 1: does v2's "one request per account" stay, now that one loan can have several processors (FLOWCHART P5.2)? And do Finance and Operations want the km × rate + meals formula (a fee table per transaction type, rate per km, km per LTO office, meals per day), or keep expense kinds with preset amounts?
- Row 10: receipt confirmation adds one DP step per release; worth it only if mismatches happen. Needs a decision.
- Approval bands wait for Finance (D-024).
