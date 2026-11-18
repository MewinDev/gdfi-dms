# 13 DP workflow (Phase A)

Last updated: 18 November 2026 (PHT)

## A. Purpose and roles

The Document Processor accepts (or declines, or holds) each transaction sent to them, asks Finance for funds, works the processing stages at the LTO with evidence, verifies the papers and forwards the package back to the branch. Roles: DP (does it), LA (sends and receives), LA Supervisor/Head and Operations Monitor (watch it on Monitoring).

## B and C. Checklist: v2 requirements and Chart 5 and 6 steps (DP side)

| # | Item (v2 source) | Status | Where | Who | Customizable? | Evidence | UAT check |
|---|---|---|---|---|---|---|---|
| 1 | Chart 5: queue of assigned work, which can be processed now (§3.4, §5.5) | ⚠️ Partial: Jobs list and Inbox per transaction, not grouped per account (loan) | Jobs, Inbox | `jobs:work` | No | `components/jobs/*`; volume 80 ms | UAT DP-1 |
| 2 | Open account: name, transactions, documents per transaction | ⚠️ Partial: job page per transaction with the loan's papers; other transactions of the loan reached from the loan file | Job (`/jobs/<id>`) | `jobs:work` | No | `app/(app)/jobs/[id]/page.tsx` | Open a job |
| 3 | Accept: date and time logged; DP TAT starts | ✅ Built | Job, Inbox | `jobs:work` | TAT targets | `lib/services/jobs.ts`, D-046 | UAT DP-2 |
| 4 | Decline with remarks, back to the LA | ✅ Built | Job | `jobs:work` | No | `jobs.ts` | UAT DP-2 |
| 5 | Hold with a reason, logged; resume | ✅ Built (on own work; a hold reason can pause the TAT, Changed by D-046) | Job | `holds:raise` | Hold reasons, pauses TAT | `lib/services/holds.ts` | UAT DP-2 / LA-9 |
| 6 | Missing paper not flagged by the LA: return to the assigning LA with remarks (§6.4) | ✅ Built | Job | `jobs:return_to_la` | Return reasons | `lib/services/return-to-la.ts`, e2e `hold-and-return.spec.ts` | UAT DP-5 |
| 7 | Branch DP pool: accept from the pool | ✅ Built (DMS addition, D-046) | Inbox, Branch pool | `jobs:work` | Pool colours | e2e `inbox.spec.ts` | Demo step 4 |
| 8 | Pass a job to a second processor (pasuyo) with a reason | ✅ Built (DMS addition) | Job | `jobs:pasuyo` | No | e2e `pasuyo.spec.ts` | UAT DP-6 |
| 9 | Chart 5: computed expenses, fund request (see module 14 rows 1 to 6) | ❌ / ⚠️ see module 14 | My funds | `funds:request` | Expense kinds | module 14 | UAT DP-7 |
| 10 | Chart 6: DP confirms receipt of funds (ref #, amount, last 4); mismatch flagged (see module 14 row 10) | ❌ Missing | n/a | n/a | n/a | module 14 | n/a |
| 11 | Only funded transactions go to the LTO (§5.7) | ✅ Built (blocks "At the LTO" until released; transactions without funds go on; Changed by FLOWCHART P6.4) | Job | System | Block LTO until funded | `funds.blockLtoUntilFunded` | Try the LTO stage before release |
| 12 | Drop-off proof (photo or LTO receipt) with time | ✅ Built (stage evidence: date, office, OR #, file) | Job, stages | `jobs:work` | Processing stages | `lib/services/job-stages.ts`, e2e `job-stages.spec.ts` | UAT DP-3 |
| 13 | Pick-up proof with time; cannot mark Processed without both | ✅ Built | Job, stages | `jobs:work` | Processing stages | `job-stages.ts` | UAT DP-3 |
| 14 | With issue: retry or return to LA (§6.2) | ✅ Built (Not processed attempt opens a problem; retry; return to LA) | Job | `jobs:work` | Problem reasons | `jobs.ts` (`attemptCore`), docs/workflow/04 | UAT DP-4 |
| 15 | LTO advisory (office down, closed, long queue): warns others, never blocks | ✅ Built (DMS addition) | Job, Monitoring | `ltoreports:create` | No | e2e `lto.spec.ts` | UAT DP-10 |
| 16 | Update each document's status (Check and verify) | ✅ Built | Job, Check and verify | `jobs:work` | No | `job-stages.ts` | Verify each paper |
| 17 | Forward to the LA branch only after LTO and liquidation (§5.8) | ⚠️ Partial: forward needs Check and verify; not gated on liquidation (liquidation has its own due date and blocks new requests) | Job | `jobs:work` | No | `jobs.ts`; module 15 | Forward with an open liquidation |
| 18 | DP TAT 5 working days (§2.2) | ✅ Built as per-stage targets (Notary 3, PPSR 5, Mortgage 10) | Settings, Turnaround times | `settings:tat` | Yes | TAT keys | TAT report |
| 19 | Processor capacity and On leave; Monitoring | ✅ Built (DMS addition) | Monitoring | `monitor:dp`, `dpcapacity:manage` | Capacity | e2e `monitoring.spec.ts` | n/a |
| 20 | "Set schedule date; group PN #" (older PNG Chart 5 only) | ✅ As decided: not built (Changed by D-020: no scheduling step) | n/a | n/a | n/a | D-020 | n/a |

## D. Known limits and open questions

- Rows 1 and 2: the DP works per transaction, not per account; v2's "one request per account" (module 14) depends on this.
- Row 10 (receipt confirmation) is a gap for go-live: see `docs/PHASE_A_GAPS.md`.
