# Status and open questions

What is built today, what is planned, and the questions still open for the business.

Last updated: 8 November 2026 (PHT)

## Status

Checked against the code and the tests on 8 November 2026. Each row gives one line of evidence.

| Area | Status | Evidence |
|---|---|---|
| Find loan, rules, Loan File, Check documents, required and optional papers, missing paper, hold, problem, Send panel, Pasuyo, pull back and update before accept, Open items card | Built | Playwright happy path, required papers, open items, Pasuyo and sent-and-return passed at 1440, 820 and 390 on 8 November 2026. |
| DP accept and decline, Return to LA, funds (request, approve, release, liquidate), TAT chips, Journey tab, LTO office and estimates, MyLoans sync, email (switch off) | Built | Playwright DP and funds full path, TAT chips, Journey, LTO, MyLoans sync and Email card passed; integration tests for decline and liquidation passed. |
| Job stages per transaction type (Notarization, PPSR registration, LTO drop off, LTO pickup), with system Start and Finish times and required evidence | Built | Integration job-stages tests (order, required evidence on the server, system times) and the Playwright full path on PN-0001001 passed. |
| Check and verify before Complete job and Forward | Built | Integration test: cannot finish until every paper is ticked; Something is missing opens a Problem that blocks it; custody Returned to DP and Verified by DP. Playwright full path passed. |
| Forward to branch chosen by the DP (branch first, then the named LA, nothing pre-selected, never automatic) | Built | Integration tests refuse a forward without Check and verify, a branch or an LA active in that branch; Playwright checks nothing is pre-selected. |
| Receiving LA outcomes Complete, Incomplete, Other; Incomplete (or a blocking Other) back to the DP | Built | Integration test: the DP is told, sees Package incomplete, forwards again; Playwright Incomplete path passed. A receiving LA in another branch receives on its own page. |
| On hold made clear: reason category and remarks (always required, 5+ characters) shown in one hold summary (Loan File banner, Check documents, DP job), the row line, Open items, the Resume form and two Journey entries; Add details for older holds; soft status colours (no filled navy pills) | Built | Playwright on-hold spec passed at 1440, 820 and 390 on 8 November 2026 (remarks shown, one pill per held row, in-browser contrast 4.5:1 or more); unit tests for the summary, the remarks rules and the palette contrast. |
| Hold owner and lock: only the person who put it on hold resumes it (Resume disabled for everyone else with "Only {name} can resume this."); a held transaction is locked on the screen and on the server, per transaction | Built | Integration test hold-lock-and-rounds: every LA and DP action refused with "Locked: on hold by ... Only ... can resume." while EDST of the same loan completes; Playwright hold-and-return passed at 1440, 820 and 390 on 8 November 2026. |
| Remark limits 5 to 500 with a counter (amber at 450) on Put on hold, Resume, Add details, Decline and Return to LA | Built | Unit tests on the shared limit and counter; integration refusals at 4 and 501 characters; Playwright counter checks. |
| Hold reasons as a managed list (`holds:manage`), proposed defaults, the hold keeps the id and a copy of the name, chips with counts in Open items and the Admin loans table | Built | Integration test: seeded list, rename keeps the old hold's text, loans filtered by reason; Playwright Settings screen. |
| Decline and Return to LA go back to the specific LA who sent it; the DP no longer sees it; rounds in the Journey | Built | Integration test: only the sender is notified and sees it, the DP's lists, counts and notifications no longer have it, send again is round 2 with the TAT start kept; Playwright with two rounds in the Journey. |
| Transfer hold (`holds:transfer`: Admin any hold, others their branches; same work role, active; remarks; never resume), the line "Needs to be resumed by {name}" | Built | Integration test transfer-papers-finance: supervisor of another branch refused, Admin and Finance allowed, refusals for self, current owner, DP, inactive and no remarks, old holder and Admin cannot resume; Playwright transfer form at 1440, 820 and 390 on 8 November 2026. Answers the open question on the hold owner leaving. |
| Inactive sending LA: the item goes to every active LA of the branch with "Sender {name} is inactive", in-app only | Built | Integration test: both branch LAs see it, no email queued, the Journey records who sent it again; Playwright Open items and Home. |
| Return to LA: no "keep the papers" or "keep the cash"; papers handed over and confirmed back (Not received raises a Problem); send blocked until confirmed; "Cash to settle" for the DP and Finance | Built | Integration tests: the removed options refused, hand-over required, confirm with one paper not received, send blocked then allowed, liquidation after the return; Playwright return form, My funds and Send panel. |
| Finance on a held transaction: request, approve, release, top-up and carry-over approval refused; receipts, returns, confirm, close and exceptions allowed | Built | Integration test of every action; Playwright Finance refusal message. |
| Fresh database: all migrations in order, seed, unit and integration tests | Built | On 8 November 2026 a new empty database took all 19 migrations and the seed, and 524 of 524 tests passed against it; the database was then removed. |
| DP lists: On hold tile on DP Home, On hold filter, chips (On hold, Package incomplete, current stage). The Returned tile and tab were removed: a declined or returned job leaves the DP | Built | Integration test of the list rows and the stage filter; Playwright DP Home with On hold passed. |
| Settings, Processing stages (`stages:manage`, Admin only): stages, evidence fields, targets, Inactive, Import / Export | Built | Integration tests: add, rename, reorder, Inactive with confirmation, Import / Export, refused for LA and DP. |
| The Received tick at Accept and "Some papers are missing" (Return to LA with those papers pre-selected) | Built | Integration test: one Received by the processor movement per paper received; the missing papers go back to the LA. |
| Phone bottom bar on the DP Job page (main next action, 48 px) | Built | Playwright at 390: bar visible above the bottom navigation, 48 px high; hidden at 820 and 1440. |
| Phases 6 to 10 (transmittal, vault, DigiCur, pull-out, QA, closure, archival, retention) | Later | Not checked (later phase). |

When a planned item is built, change its status to Built only after checking it in the app.

## Open questions for the business

- Collateral and Mortgage, processing stages (see [Processing stages](10-processing-stages.md)):
  - the stage names and the evidence fields of each stage (all fields are required for now);
  - a target in business days for each stage (none is set yet);
  - whether Notary and Entry of PPSR should run the LTO stages (they have "Needs LTO processing" on today);
  - whether Check and verify applies to every transaction type or only the LTO ones;
  - whether starting LTO drop off should stay blocked until the job is funded (today it follows the "At the LTO" funds block).
- Finance: carry-over days, overnight cash, who approves top-ups, block or only warn at "At the LTO" when unfunded, and who confirms liquidation.
- Holds: the hold reasons list ("Proposed, to be confirmed with the team").
- MyLoans team: lookup by PN, search, a changed-since feed, a field linking a replacement PN, status values, a payments field, plate, chassis and engine numbers, rate limit, response time, and a test environment.

[Back to the workflow index](README.md)
