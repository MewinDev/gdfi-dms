# User acceptance test (UAT) checklist: phase A

Last updated: 24 November 2026 (PHT)

For staging, with fake or copied-and-masked loans, before the go-live checklist (`docs/GO_LIVE_RUNBOOK.md`, section 6). Each role is tested by someone who does that job today. Mark **P** (pass) or **F** (fail); every F needs a remark (what happened, the PN, a screenshot if possible). The module checklists (`docs/checklists/`) say where each feature is and how it is built.

Before starting: Admin has set up one tester per role with the right branches, entered the holiday list, and the sync has run at least once (Settings, MyLoans sync, run log).

## Loan Associate (LA)

| # | Task | Expected result | P/F | Tester | Date | Remarks |
|---|---|---|---|---|---|---|
| LA-1 | Sign in with Microsoft | Home opens; the menu shows Inbox, Loans, Find loan; only my branches' work | | | | |
| LA-2 | Inbox, Branch pool: accept a released loan waiting in the pool | It moves to My items; the waiting time shown counted from when it entered the pool | | | | |
| LA-3 | Open the loan file from it | The loan file opens with PN, borrower, product, Financing / Refinancing and the transactions | | | | |
| LA-4 | Find loan: type a full PN of my branch | The loan is found (or the myloans preview shows if not opened yet); the search is logged | | | | |
| LA-5 | Find loan: a PN of another branch | No borrower details of another branch are shown | | | | |
| LA-6 | Check papers: tick the papers in hand; mark one Missing with a reason | The transaction can be sent; the Missing paper shows with the reason | | | | |
| LA-7 | Send to a processor, with funds flagged | The DP gets it in their inbox; the loan stage changes; the TAT due date shows | | | | |
| LA-8 | Receive the missing paper later | Marked Received with the date; history keeps the reason | | | | |
| LA-9 | Put a transaction on hold, then resume it | Hold shows with the reason; resumed; the clock kept counting | | | | |
| LA-10 | Forward an item to another LA of the branch | It leaves my inbox; it is in theirs | | | | |
| LA-11 | Accept papers a DP returned | The return reason shows; the job comes back to me | | | | |
| LA-12 | Refresh from MyLoans on a loan file | "Last checked" updates; a changed field becomes an Open Item, not a direct change | | | | |
| LA-13 | Phone (narrow screen): Inbox and a loan file | Readable, no sideways scroll, buttons large enough | | | | |

## LA Supervisor / Head

| # | Task | Expected result | P/F | Tester | Date | Remarks |
|---|---|---|---|---|---|---|
| SUP-1 | Sign in; Home | Warnings for my branches: overdue, waiting long, people away | | | | |
| SUP-2 | Open Items: approve a changed amount | The loan takes the new value; the item closes with my name and remarks | | | | |
| SUP-3 | Open Items: reject a change | The DMS value stays; the item shows Rejected with remarks | | | | |
| SUP-4 | Open Items: a loan Cancelled in myloans | Approving closes the loan file's open work | | | | |
| SUP-5 | Open Items: a loan NotReleased / Inactive | Approving holds the loan (no sending, no cash); when Released again the hold ends | | | | |
| SUP-6 | Open Items: a superseded PN (redo) | Approving moves the same loan file to the new PN | | | | |
| SUP-7 | Move work items: move an LA's item back to the pool, and to another LA | Moved; both people see it right; the move is in the history | | | | |
| SUP-8 | Set an LA Away (dates) | They cannot be picked for new work; their items show on my Home | | | | |
| SUP-9 | Change an automatic classification with a reason | The new result shows; the reason and my name are in the history | | | | |
| SUP-10 | Resolve a problem on any transaction of my branches | Resolved; the owner is told | | | | |
| SUP-11 | Reports, TAT: filter by branch, download CSV | Numbers match the loans; the file opens in Excel | | | | |
| SUP-12 | Cancel a transaction that has released cash, with a reason | The confirm step says the cash stays owed and when it must be liquidated; after cancelling, the transaction shows Cancelled and the processor is told | | | | |

## Document Processor (DP)

| # | Task | Expected result | P/F | Tester | Date | Remarks |
|---|---|---|---|---|---|---|
| DP-1 | Sign in; Jobs | Only jobs sent to me; due dates and colours | | | | |
| DP-2 | Accept a job; decline another with a reason | Accepted job is mine; declined job goes back to the LA with the reason | | | | |
| DP-3 | Work the stages, with evidence where asked (LTO drop, pickup) | Each stage records date and evidence; the loan's Journey shows it | | | | |
| DP-4 | Log a not-processed attempt with a reason | Shown in the job history; the clock keeps counting | | | | |
| DP-5 | Return a job to the LA for a missing paper | The LA gets it with the reason | | | | |
| DP-6 | Pass a job to a second processor (pasuyo) | They get it; the history shows both | | | | |
| DP-7 | Request a cash advance covering several jobs | One request with the lines; Finance sees it | | | | |
| DP-8 | Liquidate: add receipts (photo) and return cash | Receipts open; totals add up; Finance is told | | | | |
| DP-9 | With an overdue liquidation, try a new request | Refused, with the reason, unless Finance granted an exception | | | | |
| DP-10 | File an LTO advisory from an LTO stage | Others see the warning; my job is not blocked | | | | |
| DP-11 | Ask for a Fund transfer with my account; after Finance sends it, confirm receipt with the reference, amount and last 4 digits (try one wrong digit first) | The account shows as "account ending 1234"; a wrong value says what does not match and Finance is told; the right values confirm it | | | | |

## Finance

| # | Task | Expected result | P/F | Tester | Date | Remarks |
|---|---|---|---|---|---|---|
| FIN-1 | Sign in; Funds | Requests of my branches by status, with counts | | | | |
| FIN-2 | Edit a line, then approve a cash advance | Approved amount saved; the DP is told | | | | |
| FIN-3 | Deny a request with remarks | Denied; the DP sees the remarks | | | | |
| FIN-4 | Release approved money (cash advance and a fund transfer) | Released amounts and dates saved; liquidation due date shows | | | | |
| FIN-5 | Open a receipt | It opens; the file access log records it | | | | |
| FIN-6 | Settle and close a liquidated advance | Closed; returned cash recorded | | | | |
| FIN-7 | Grant a funds exception to a DP with an overdue advance | The DP can submit one more request | | | | |
| FIN-8 | Print the liquidation report | Prints with the lines and receipts | | | | |
| FIN-9 | Send a Fund transfer (check the account the processor typed, tick "I checked"); then clear a receipt mismatch with remarks | The full account number shows only on the send form; after sending only the last 4 digits; the mismatch clears and the processor is told | | | | |

## Admin

| # | Task | Expected result | P/F | Tester | Date | Remarks |
|---|---|---|---|---|---|---|
| ADM-1 | Users: add a person, a role and branches | They can sign in and see only those branches | | | | |
| ADM-2 | Holidays and working days: add a holiday | "Check" lists the due dates it moves; after saving they move | | | | |
| ADM-3 | Turnaround times: change one target | New work uses the new target | | | | |
| ADM-4 | Checklist items: add a paper to a transaction | Loan files opened from now on have it | | | | |
| ADM-5 | MyLoans sync: run log, Run now, Pause | A run appears; Pause stops calls and the log says so | | | | |
| ADM-6 | Open Items, Unassigned (a branch without an approver) | Listed; Home warns which branches have no approver | | | | |
| ADM-7 | Reference data changes | Branch and product renames listed, applied by themselves | | | | |
| ADM-8 | Branches: a closed branch with open work | Its work stays; no new pool items; Home warning | | | | |
| ADM-9 | Product classification: add a keyword; check a product name | The check shows Financing / Refinancing as expected | | | | |
| ADM-10 | Approval bands and Cash-advance rules: read them | Values as agreed with Finance | | | | |
| ADM-11 | Audit log: find today's change by me | Listed with who, what, when | | | | |

## Superadmin

| # | Task | Expected result | P/F | Tester | Date | Remarks |
|---|---|---|---|---|---|---|
| SA-1 | Permissions: untick one permission for a role | On the next click, people of that role lose it | | | | |
| SA-2 | A per-user override (give one person one extra tick) | Only that person gains it | | | | |
| SA-3 | Roles and access: a role's branch scope | People see only the branches allowed | | | | |
| SA-4 | File access log: filter by person, export | Rows match; the export is itself logged | | | | |
| SA-5 | Settings, System: environment and test mode | "Production" (or "Staging"); test mode Off in production | | | | |
| SA-6 | Try a test helper (Test kit, simulator) in production | Not listed / "not available in production" | | | | |

## Sign-off

| Role | Tester (name) | All P? | Open F items (numbers) | Signature | Date |
|---|---|---|---|---|---|
| Loan Associate | | | | | |
| LA Supervisor / Head | | | | | |
| Document Processor | | | | | |
| Finance | | | | | |
| Admin | | | | | |
| Superadmin | | | | | |

**UAT accepted for go-live** (every F is fixed, or accepted as a known limit with a date):

| | Name | Signature | Date |
|---|---|---|---|
| Project owner | | | |
| Operations head | | | |
| Finance head | | | |
