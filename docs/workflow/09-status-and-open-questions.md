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
| DP lists: On hold and Returned tiles on DP Home, On hold filter, chips (On hold, Returned, Package incomplete, current stage) | Built | Integration test of the list rows and the stage filter; Playwright DP Home with On hold and Returned passed. |
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
- MyLoans team: lookup by PN, search, a changed-since feed, a field linking a replacement PN, status values, a payments field, plate, chassis and engine numbers, rate limit, response time, and a test environment.

[Back to the workflow index](README.md)
