# 12 LA workflow (Phase A)

Last updated: 26 November 2026 (PHT)

## A. Purpose and roles

The Loan Associate opens the loan file, answers the preview card, gets the transactions from Rules 1 to 4, checks each transaction's papers, flags missing ones, and sends each transaction to a Document Processor with an LTO office; later receives the package back. Roles: LA (does it), LA Supervisor/Head (oversight, overrides), Admin (sees, cannot do LA steps by default).

## B and C. Checklist: v2 requirements and Chart 2, 3 and 4 steps

| # | Item (v2 source) | Status | Where | Who | Customizable? | Evidence | UAT check |
|---|---|---|---|---|---|---|---|
| 1 | Chart 2: LA searches PN #; PN valid?; new to DMS?; get from myloans; selectable?; save with SourceUpdatedAt and ContentHash (§5.1) | ✅ Built | Find loan | `loans:search`, `loans:open` | PN format | module 08; `lib/services/loan-file.ts` | UAT LA-3, LA-4 |
| 2 | Only Released, active, not superseded can be opened (§5.1, IsSelectable) | ✅ Built | Find loan status card | System | No | D-036 (FeedState), e2e `status-card.spec.ts` | Find a not-released PN |
| 3 | Chart 3 / Rule 1: Financing or Refinancing from the product name | ✅ Built (Changed by D-031/D-049: keyword lists) | Preview card | System | Keywords | module 06 | Preview |
| 4 | Rule 2: LA picks Undertaking / Non-Undertaking (Financing only); never guessed; recorded | ✅ Built | Preview card | LA | No | `lib/rules/index.ts` | Open loan file disabled until picked |
| 5 | Rule 3: LA picks Transferred / Untransferred (Financing only); Untransferred: only Notary and For EDST | ✅ Built | Preview card | LA | No | `lib/rules/index.ts` | Untransferred PN: 2 transactions |
| 6 | Rule 4: Mortgage when New ≤ ₱500,000 / Renewal ≤ ₱1,000,000; exact decimals; "1,000" and "1e6" refused; other loan types cannot be confirmed | ✅ Built | Preview card | System | No (fixed in code) | `lib/rules/index.ts`, `lib/myloans/data-check.test.ts` (D-032 Q-N12) | Kit PNs at the thresholds |
| 7 | §4.5 auto-created transactions (Notary, For EDST, plus For Entry PPSR and Mortgage when Mortgage) | ✅ Built | Loan file, To do | System | Transaction types | `lib/rules/index.ts` | UAT LA-3 |
| 8 | §4.5 optional transactions (Cancellation of Mortgage, Transfer of Ownership, Renewal of OR, PPSR Termination) and the available / unavailable matrix | ✅ Built: the four types seeded with v2's papers, added by hand (D-056 item 3) [TO CONFIRM papers]; the availability matrix waits (PHASE_A_GAPS S6) | Loan file, Add a transaction | `transactions:add` | Transaction types | `prisma/seed.ts` (`OPTIONAL_TRANSACTION_TYPES`); `tests/integration/phase-a-gaps.test.ts` | Add Transfer of Ownership: 6 papers |
| 9 | Preview card shows classification, the picks, the Mortgage result and the transactions to be created (§3.3) | ✅ Built | Find loan | LA | No | `docs/workflow/03-loan-associate.md` ("What will be set up") | Preview |
| 10 | Override of an automatic result with a reason (§4.4 MANUAL_CORRECTION) | ✅ Built (Changed by D-028: `rules:override`) | Loan file | `rules:override` | No | module 06 row 6 | n/a |
| 11 | Chart 4 / §4.6, §5.4: each transaction has its own checklist, loaded when created | ✅ Built (per transaction type) | Check documents | `checklist:tick` | Checklist items | `workflow.ts` | UAT LA-6 |
| 12 | Checklists per loan type (§9.2 "per loan type/transaction") | ✅ As decided: per transaction type (D-056 item 7) [TO CONFIRM with the LA Supervisor/Head] | Settings, Checklist items | `settings:checklist` | Yes | `ChecklistRule` (no loan-type column) | n/a |
| 13 | §4.6 the 8 sample checklists | ✅ As decided: the optional types have v2's lists; the four built-in keep today's papers (D-056 items 3 and 7) [TO CONFIRM with the LA Supervisor/Head] | Settings, Checklist items | Admin | Yes | `prisma/seed.ts` | n/a |
| 14 | Missing document flow: LA flags it with a reason and remarks, can still send; receives it later with the date (§6.4) | ✅ Built | Check documents | `papers:mark_missing`, `papers:receive_late` | Missing-paper reasons | `docs/workflow/09-status-and-open-questions.md` (Missing papers with reasons: Built), e2e `missing-papers.spec.ts` | UAT LA-6, LA-8 |
| 15 | LA-only transactions (For EDST): record the reference, done without a processor | ✅ Built | Loan file | `transactions:complete` | Transaction type "needs a processor" | `docs/workflow/03-loan-associate.md` | EDST row |
| 16 | Chart 4: assign a DP per transaction, each with its own LTO office; several DPs per loan | ✅ Built | Loan file, Send | `processing:send` | No | `DpAssignment`, e2e `happy-path.spec.ts` | UAT LA-7 |
| 17 | Send to the Branch DP pool instead of a person | ✅ Built (DMS addition, D-046) | Send | `processing:send` | No | e2e `inbox.spec.ts` | Demo step 2 |
| 18 | Funds answer per transaction (needs funds with kinds, or none) | ✅ Built (the LA flags; the DP requests the amount, module 14) | Send | `funds:flag` | Expense kinds | `docs/workflow/05-funds.md` | UAT LA-7 |
| 19 | DP assign / accept / decline / hold seen from the LA side (declined comes back with the reason; holds shown) | ✅ Built | Loan file, Inbox | LA | No | module 13 rows 3 to 5 | UAT LA-11 |
| 20 | Pull back a send before the DP accepts | ✅ Built (DMS addition) | Loan file | LA | No | `lib/services/sent-changes.ts` | Pull back, read the history |
| 21 | Return with remarks to the previous user (§5.3) | ✅ Built | Loan file, Job | LA, DP | Return reasons | module 11 row 11 | UAT LA-11 |
| 22 | LA TAT: 1 working day "check documents and assign to DP" (§2.2) | ✅ Built: LA 1 working day (Checklist complete, Assign to DP) (D-056 item 9) [TO CONFIRM] | Settings, Turnaround times | `settings:tat` | Yes | migration `20261119090032_phase_a_gaps`; `prisma/seed.ts` (TAT) | TAT report |
| 23 | Accept the package back from the DP (Chart 6 end) | ✅ Built | Inbox, Receive | `processing:accept_returns` | No | `app/(app)/receive` | Demo step 6 |
| 24 | Transmit to the vault with the transmittal form (courier, tracking #, mode) (§5.8, Chart 7) | 📦 Later phase (B: vault transmittal) | n/a | n/a | n/a | `docs/STATUS.md` phase B | n/a |
| 25 | View own transactions and demerits (§7) | ⚠️ Partial: My loans and Inbox; demerits are phase B | My loans | LA | No | e2e `my-loans-compact.spec.ts` | UAT LA-1 |
| 26 | Holds and problems on the LA's own work | ✅ Built | Loan file | `holds:raise`, `problems:raise` | Reasons | module 16 | UAT LA-9 |
| 27 | The loan file, compact (D-062): one summary card on every tab (top of the page; on Check documents the top of the transactions card) (the name, with the due badge, branch badge and Refresh from myloans icon at the right of its line; the PN with Copy under it; Product · Loan type (New or Renewal) · Amount · Released on as label-above-value cells; the step as a 20 px heading; on Check documents the name with the due badge and refresh, the PN, and six details with Branch and Assigned to at the top of the transactions card instead); Check documents with one hint line and one progress per transaction (no "Do this now" card for ordinary work, no "Go to the papers", one Send button: the panel's); paper rows about 36 px with their chips after the name and Mark as missing in a quiet "⋯" row menu; the Send panel compact; 14 px body, 36 px buttons from 768 px, 44 px on phones; right panel from 1280 px | ✅ Built | Loan file (all tabs) | `loans:view`; refresh `loans:refresh`; last checked `myloans:view` | No | e2e `loan-file-layout.spec.ts`, `loan-file-next-step.spec.ts`, `ui-refresh.spec.ts` (readability 320 to 1440 px), `axe.spec.ts` (1440, 1366, 820, 390); screenshots `docs/screenshots/ui-refresh/loan-*-{390,820,1440}.png` | Open a loan file: the header, then tick a paper and see the hint change |

## D. Known limits and open questions

- Optional transactions and the availability matrix (row 8) and checklists by loan type (row 12) are gaps: see `docs/PHASE_A_GAPS.md`.
- Row 22: v2's LA TAT has no start event when nobody accepts (FLOWCHART_ALIGNMENT P4.1); the DMS starts it when the LA opens the loan file or accepts it from the pool.
