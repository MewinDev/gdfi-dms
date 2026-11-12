# Stages and next steps

The one description of the loan-file process: the 10 steps of the loan-file stepper, the process from opening to warehousing, and for every stage its name, step, next step and owner.

Last updated: 12 November 2026 (PHT)

The business confirmed the end-to-end process on 12 November 2026 and corrected it the same day after reviewing its Monitoring of Documents system. Phase 1 (this page, built) changes only how stages are **named and shown**: which stage a loan is in, how it moves, the rules, permissions, counts, tabs, filters and sorts are unchanged. The stages that exist today keep their stored keys; only their names on screen changed. The stages marked **Phase 2, not yet in the app** are definitions only: no loan can be in them yet, and nothing moves a loan there. Phase 2 makes them real, one department at a time.

In the code the map is one module, `lib/workflow/stage-map.ts`. Every screen that shows a stage name, a step name or a next step reads it from there: the loan-file stepper, the Loans table, My loans, Home, Find a loan, the Journey, Monitoring, Related loans and the history lines. A unit test (`lib/workflow/stage-map.test.ts`) fails when another file defines them, when a stored stage has no entry, or when an old step name ("Processing", "Your acceptance", "Vault", "DigiCur", "Pull-out", "QA review") or "Notice to Decision" comes back.

## The 10 steps

The stepper on the loan file. Steps 1 and 2 are done as soon as the loan file exists and are never a stage's step. Step 5 is "LA Acceptance" for everyone.

| # | Step name |
|---|---|
| 1 | Loan opened |
| 2 | Classified |
| 3 | Check documents |
| 4 | DP Processing |
| 5 | LA Acceptance |
| 6 | Collateral |
| 7 | Quality Assurance |
| 8 | Digital Records |
| 9 | In Safekeeping |
| 10 | Closure |

The current step comes from the loan's stage (the tables below); the steps before it are done (green tick) and the later ones grey. A stage with no step (Pull out, Cancelled in MyLoans, Archived, Disposed) highlights no step and shows its name small and grey under the stepper. Archived and Disposed show every step done.

On a desktop (1024px and wider) all 10 names are shown, each wrapping to two lines when needed. On a tablet and a phone (under 1024px) only the current step's name is shown ("Step 9 of 10 · In Safekeeping") with a 10-part bar; tapping it lists all 10 steps.

## The process

From opening to warehousing, in order. Archiving and Warehousing start only after the loan is fully paid and released (confirmed for now; the stage definitions stay in the map, so this can change without code changes elsewhere).

| # | Process step | Who | Moves on when | Stage column shows | Step |
|---|---|---|---|---|---|
| 1 | Loan opened | The system | File created | Check documents | 3 |
| 2 | Check documents | Loan Associate | Assigned to DP | Check documents | 3 |
| 3 | DP processing | Document Processor / Collateral & Mortgage | All processing done | DP Assigning, LTO Processing, LTO Done | 4 |
| 4 | LA acceptance | Loan Associate | Accepted | Forwarding to LA branch | 5 |
| 5 | Transmittal | Loan Associate | Transmittal sent | For transmittal | 6 |
| 6 | Receiving | Collateral custodian | Tagged received | Receiving | 6 |
| 7 | Prior to safekeeping | Quality Assurance | Pass, or findings logged | Prior to safekeeping | 7 |
| 8 | Thorough checking | Quality Assurance | Passed | Thorough checking | 7 |
| 9 | Digital validation | Digital Records | Fully digitized | Digital validation | 8 |
| 10 | In safekeeping | Collateral | Loan fully paid | In safekeeping | 9 |
| 11 | Closed (fully paid) | Collateral / Records | Handed over | Closed | 10 |
| 12 | Archiving | Archival & Warehousing | ARF scanned | Archiving | 10 |
| 13 | Warehousing | Archival & Warehousing | Forwarded | Warehousing | 10 |
| 14 | Warehoused | The system | None (the end) | Warehoused | 10 |

Process steps 7, 8, 9, 12, 13 and 14, and the LTO Done stage, are **Phase 2, not yet in the app**. Closed is the fully paid closure: the documents are released to the borrower, or returned to the vault for safekeeping.

### Two loops outside the straight line (Phase 2, not yet in the app)

- **Findings loop.** Quality Assurance findings lead to For NTC (Notice to Comply: the LA or releaser complies), then For NTE (Notice to Explain: explain), then For NOD (Notice of Decision: the decision). Digital Records puts accounts that are not fully digitized (tagged KYC only, Transactional only or Not digitized, or untagged past 7 days) in For NTE (Digital Records). The loan returns to its stage once the finding is closed. The LA can view a Notice to Explain and a Notice of Decision but cannot issue them.
- **Pull out loop (while in safekeeping).** A request with the signed form; approval by an approver (never the requester); release by a custodian. Return periods: Legal 60 days, Mortgage and Remortgage 45, Fully paid 60, Repo and Other per request. The request is flagged 7 days before the return date and again once overdue. The documents then return to safekeeping. "Pull out" (two words) is the stage name; "Pull-out" with a hyphen was only an old step name and is never shown.

## The stages

"Stored key" is the value kept in the database today (none for a Phase 2 stage). The Stage column of the Loans table shows the "Stage column shows" text; the Next step column shows the "Next step" text, and hovering it shows "Waiting for: {owner}". The system rows have no tooltip.

| Stored key today | Stage column shows | Step | Next step | Owner | Status |
|---|---|---|---|---|---|
| Opened | Check documents | 3 | System sets up the transactions | The system (no tooltip) | In the app |
| For checklist | Check documents | 3 | Check documents, then assign to DP | Loan Associate | In the app |
| No DP assignment required | Check documents (LA only) | 3 | Complete the LA-only transactions | Loan Associate | In the app |
| Assigned to DP | DP Assigning | 4 | DP accepts the assignment | Document Processor / Collateral & Mortgage | In the app |
| In process | LTO Processing | 4 | DP processes the transactions | Document Processor / Collateral & Mortgage | In the app |
| (none) | LTO Done | 4 | DP forwards the package to the LA branch | Document Processor | **Phase 2, not yet in the app** |
| Awaiting LA acceptance | Forwarding to LA branch | 5 | LA accepts the package | Loan Associate (receiving branch) | In the app (renamed on screen only) |
| For Vault Transmittal | For transmittal | 6 | Create the transmittal | Loan Associate | In the app |
| In transit to Vault | Receiving | 6 | Collateral receives by scan | Collateral | In the app (renamed on screen only; Receiving is this stage, there is no separate Receiving stage) |
| (none) | Pull out | no step | Pull out request in progress: an approver approves, then a custodian releases | Approver / Collateral custodian | **Phase 2, not yet in the app** |
| (none) | Prior to safekeeping | 7 | QA checks the package before safekeeping | Quality Assurance | **Phase 2, not yet in the app** |
| (none) | Thorough checking | 7 | QA does the thorough check | Quality Assurance | **Phase 2, not yet in the app** |
| (none) | For NTC | 7 | LA complies with the Notice to Comply | Loan Associate | **Phase 2, not yet in the app** |
| (none) | For NTE | 7 | QA issues the Notice to Explain (the LA can view it) | Quality Assurance | **Phase 2, not yet in the app** |
| (none) | For NOD | 7 | QA issues the Notice of Decision (the LA can view it) | Quality Assurance | **Phase 2, not yet in the app** |
| (none) | Digital validation | 8 | Digital Records validates the digital copy | Digital Records | **Phase 2, not yet in the app** |
| (none) | For NTE (Digital Records) | 8 | Digital Records issues the Notice to Explain (the LA can view it) | Digital Records | **Phase 2, not yet in the app** |
| In Safekeeping | In safekeeping | 9 | Kept in the vault until the loan is fully paid ("Resolve open exceptions" while an exception is open) | Collateral | In the app |
| Closed | Closed | 10 | Records archives the file (as the code says today) | Records | In the app (kept as is) |
| (none) | Archiving | 10 | Archival & Warehousing uploads the scanned ARF | Archival & Warehousing | **Phase 2, not yet in the app** |
| (none) | Warehousing | 10 | Archival & Warehousing forwards the documents to the warehouse | Archival & Warehousing | **Phase 2, not yet in the app** |
| (none) | Warehoused | 10 | No further steps | The system (no tooltip) | **Phase 2, not yet in the app** (the last stage of the flow) |
| Cancelled in MyLoans | Cancelled in MyLoans (grey) | no step | No further steps | The system (no tooltip) | In the app |
| Archived | Archived (grey) | no step | Kept until the retention period ends | The system (no tooltip) | In the app |
| Disposed | Disposed (grey) | no step | No further steps | The system (no tooltip) | In the app |

### Notes and differences still open

- **Closed, Archived and the new end.** In the process, Closed (fully paid) is followed by Archiving, Warehousing and Warehoused. The app has Closed, then Archived (kept for a retention period), then Disposed; it has no Archiving, Warehousing or Warehoused yet. Closed still says "Records archives the file" with the owner Records, as before. Phase 2 decides whether Archived becomes the Archiving to Warehoused stages, and what happens to Disposed. Phase 1 changes no transition.
- **Nothing makes a loan Closed today.** A loan is Closed when its `closedAt` date is set, and no screen or service in the app sets it yet (only test data does); there is no payoff or hand-over step. The process says Closed comes when the loan is fully paid and the documents are handed over; phase 2 adds that.
- **In Safekeeping.** It is a normal stage, under step 9. Today a loan reaches it straight from Receiving, because the Quality Assurance and Digital Records stages (steps 7 and 8) do not exist yet; the stepper then shows steps 7 and 8 as done.
- **The Journey phases.** The Journey tab still lists its ten detailed phases in the old order (6 transmittal and vaulting, 7 digitization, 8 pull out and return, 9 Quality Assurance check, 10 closure and archival), and events while In Safekeeping stay under Journey phase 7. Only their titles were reworded so no old step name shows. Phase 2 reorders them to match the steps above.
- **Two stages, one name.** Opened and For checklist both show "Check documents", so the "Where it is" and "Stage" filters list that name twice (each still filters its own stage, as before).
- **Stored text.** Audit rows, Journey lines and snapshots are never edited: an old line that has an old stage name in its text is shown as stored.
- **Role and target names.** The role names (Vault, QA, Digital Records) and the stored turnaround targets ("DigiCur to Verified", "Pull-out overdue") are data in Settings, not stage names; they are unchanged.
