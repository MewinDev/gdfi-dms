# Manual Test Kit

Last updated: 8 November 2026

Test GDFI DMS by hand from a clean start, then put everything back. The kit fills your own database (`gdfi_dms`) with sample accounts and one sample loan per case. The automated tests use another database (`gdfi_dms_test`), so they never touch your data.

## Commands

Run these in PowerShell, in the project folder. Each one says what it will do and what it did.

| Command | What it does |
|---|---|
| `npm run kit:start` | Puts `gdfi_dms` in the starting state. The first time it builds it (about a minute) and saves it as the baseline; after that it restores the baseline (a few seconds). |
| `npm run kit:reset` | Back to the starting state. Asks you to type RESET. Takes an automatic backup first (`pre-reset-...`, the last 5 are kept). |
| `npm run kit:backup -- after-funds` | Saves the current state as `after-funds`. |
| `npm run kit:list` | Lists the baseline and the backups, with date, size, loan files and migration version. |
| `npm run kit:restore -- after-funds` | Puts a backup back (same RESET question and automatic backup). |
| `npm run kit:rebuild` | Builds the baseline again. Needed after a new migration: until then `kit:reset` says "The baseline is out of date. Run `npm run kit:rebuild`." and does nothing. |

The same Reset, Backup and Restore are in **Settings > Test kit** (Admin). The files are in `storage/kit/` (backups in `storage/kit/backups/`); copy a `.dump` file and its `.json` to use them on another PC.

The kit only runs on a local test setup: `APP_ENV=local`, `TEST_MODE=true`, the sample MyLoans and the database `gdfi_dms` on this PC. It never sends email: the accounts use `@example.test` addresses, the email switch stays Not active, and the commands blank the Microsoft Graph values for their own run.

**Dates.** Release dates count back from the day of `kit:start` (0, 2 or 4 business days), so the turnaround times show as written below. A reset or restore on a later day moves every date forward by the business days in between (weekends and holidays skipped), so they still show the same way.

## Sample accounts

Sign in at `/login`, under **Test sign-in**. Each button shows the role and branches.

| Account | Role | Branches |
|---|---|---|
| Admin | Admin | All |
| Finance | Finance | All |
| Branch Supervisor | Branch Supervisor (a sample role: view loans, transfer holds) | Quezon City, Cebu |
| LA 1 | Loan Associate | Quezon City, Cebu |
| LA 2 | Loan Associate | Quezon City, Cebu |
| LA Davao | Loan Associate | Davao |
| DP 1 | Document Processor | Quezon City, Cebu |
| DP 2 | Document Processor | Quezon City, Cebu |
| Receiving LA Makati | Loan Associate | Makati |
| Inactive LA | Loan Associate, inactive (not in the list) | Quezon City, Cebu |

## Loan Associate

| PN | Case | Who signs in | What to do | What should happen |
|---|---|---|---|---|
| PN-0002001 | Refinancing, no mortgage | LA 1 | Open the loan file. | Refinancing; New above 500,000 is Not Mortgage: Notary and For EDST only. |
| PN-0002002 | Financing, Undertaking, Transferred | LA 1 | Open the loan file. | Financing, Undertaking and Transferred (picked by the LA); New 350,000 is Mortgage: Notary, For EDST, For Entry PPSR and Mortgage. |
| PN-0002003 | Blank product, default Refinancing | LA 1 | Open the loan file. | Blank Product Name defaults to Refinancing; Renewal 800,000 is Mortgage: 4 transactions. |
| PN-0002004 | Financing, Non-Undertaking | LA 1 | Open the loan file. | Financing, Non-Undertaking (picked by the LA), Transferred; Mortgage: 4 transactions. |
| PN-0002005 | Financing, Untransferred | LA 1 | Open the loan file. | Rule 3: Untransferred gives Notary and For EDST; Mortgage not evaluated. |
| PN-0002006 | New at 500,000 | LA 1 | Open the loan file. | Exactly 500,000 is Mortgage: 4 transactions. |
| PN-0002007 | New at 500,001 | LA 1 | Open the loan file. | Above 500,000 is Not Mortgage: Notary and For EDST. |
| PN-0002008 | Renewal at 1,000,000 (Cebu) | LA 1 | Open the loan file. | Exactly 1,000,000 is Mortgage: 4 transactions. |
| PN-0002009 | Renewal at 1,000,001 (Cebu) | LA 1 | Open the loan file. | Above 1,000,000 is Not Mortgage: Notary and For EDST. |
| PN-0002010 | "Auto Finance" is not the word Financing | LA 1 | Open the loan file. | Not the whole word Financing, so Refinancing; Not Mortgage. |
| PN-0002011 | Needs LTO: office and cash estimate | LA 1 | Mortgage: the papers are ticked. Send it to DP 1. | Send asks for the LTO office and whether it needs funds, with the cash estimate. Then it waits for DP 1 to accept. |
| PN-0002012 | Missing paper, with reminder | LA 1 | Notary: see the Missing paper reminder (asked from the borrower). Tick the paper. | The reminder names the paper and closes by itself when it is ticked. Then Notary can be sent. |
| PN-0002038 | TAT on time | LA 1 | Notary: send it to DP 1. | On time: no late reason is asked. |
| PN-0002039 | TAT due today | LA 1 | Notary: see the chip, then send it. | Due today (Day 2 from release): no late reason yet. |
| PN-0002040 | TAT late | LA 1 | Notary: send it to DP 1. | Late: Send asks for a Beyond-TAT reason and refuses without it. |
| PN-0002050 | Not opened yet | LA 1 | My loans > Find a loan: type PN-0002050, Find, then Open loan file. | The preview shows the MyLoans details; opening creates the loan file. |
| PN-0002046 | Same borrower, additional unit | LA 1 | Find PN-0002046 and open it. | Find loan says the same borrower already has PN-0002045 open. It is an additional unit, not a replacement; both show under related loans. |
| PN-0002045 | Same borrower, first unit | LA 1 | Open PN-0002045 after opening PN-0002046. | Related loans lists PN-0002046. |
| PN-0002047 | Another branch (Davao) | LA 1, then LA Davao | LA 1: go to /loans/PN-0002047. LA Davao: open it from My loans. | LA 1 gets "not found" (outside the branches); LA Davao sees it. |
| PN-0002027 | Forwarded to a receiving LA in another branch | Receiving LA Makati | Home: receive the Notary package; check each paper; Complete. | The package from DP 1 arrives at Makati; received complete, Notary is done. |
| PN-0002028 | Complete | LA 1 | Open the loan file. | Notary and For EDST are done: the loan file is complete. |

## DP

| PN | Case | Who signs in | What to do | What should happen |
|---|---|---|---|---|
| PN-0002015 | Sent, waiting to accept | DP 1 | Jobs: open the Notary job; Accept (labels are on the papers). | In process; the stages show, Notarization first. |
| PN-0002016 | DP declines | DP 2 | Jobs: open the Notary job; Decline with a reason and remarks. | It goes back to the LAs of the branch, with the reason; the job leaves DP 2's list. |
| PN-0002018 | Round 2 (sent again after a return) | DP 1 | Jobs: open the Notary job; Accept. | Marked Round 2; the earlier return shows in the history. |
| PN-0002020 | Notary stages in progress | DP 1 | Notarization is done; Start and Finish LTO drop off, LTO pickup, then Check and verify. | Each stage asks for its evidence; the stepper moves on. |
| PN-0002021 | Entry of PPSR stages in progress | DP 1 | PPSR registration is done; work the next stages. | Same as above, for Entry of PPSR. |
| PN-0002022 | Mortgage stages in progress | DP 1 | LTO drop off is done; Start LTO pickup. | LTO pickup asks for the annotated OR/CR. |
| PN-0002023 | Check and verify blocking | DP 1 | Check and verify: one paper is ticked, a Missing paper problem is open. Try Finish, then Complete job. | Both refused while the problem is open and papers are not ticked. Resolve the problem, tick the papers, Finish, then Complete job. |
| PN-0002024 | Pasuyo (cash decision first) | DP 1 | Mortgage: DP 1 holds 3,500 released cash. Pass the job to DP 2. | It asks first: return the cash, or hand the balance to DP 2. |
| PN-0002029 | Incomplete, back to the DP | DP 1 | Jobs: "Package incomplete" (the notarized deed of sale). Correct it and Forward to LA 1 again. | The incomplete note closes; LA 1 can receive it again. |
| PN-0002030 | Funds: needed, no request yet | DP 1 | Mortgage needs funds (LTO fee). Try Start LTO drop off; then request a cash advance. | Blocked: "This job needs funds. Request a cash advance first." The request goes to Finance (Requested). |
| PN-0002033 | Funds: released | DP 2 | My funds: liquidate CA for PN-0002033 with a receipt, or return the cash. | Partly or fully liquidated; Finance closes it. |

## Finance

| PN | Case | Who signs in | What to do | What should happen |
|---|---|---|---|---|
| PN-0002031 | Funds: requested | Finance | Funds > Approve: approve the request. | Approved; waiting for release. |
| PN-0002032 | Funds: approved | Finance | Funds: release it with a voucher reference. | Released; DP 1 sees the liquidation due date. |
| PN-0002034 | Funds: overdue notice | Finance, then DP 2 | Notifications: "liquidation overdue". DP 2: try a new cash request. | DP 2 and Finance have the overdue notice. DP 2's new requests are refused until it is liquidated or Finance grants an exception. |
| PN-0002035 | Funds: liquidated | Finance | Funds: close the advance. | Closed. |
| PN-0002036 | Funds: closed | Finance | Open the advance. | Closed, with the receipt and the history. |
| PN-0002037 | Funds: cash to settle after a return | DP 2, then LA 1 | DP 2: My funds shows Cash to settle. LA 1: confirm the Mortgage papers came back. | The return went ahead; the cash stays DP 2's to liquidate. LA 1 can send again only after confirming the papers. |

## Admin

| PN | Case | Who signs in | What to do | What should happen |
|---|---|---|---|---|
| PN-0002041 | MyLoans change: minor | Admin | Open the loan file and its history. | MyLoans now spells the name with "Jr." and has a new address. The copy was updated by itself; no review needed. |
| PN-0002042 | MyLoans change: material | Admin | MyLoans review: the amount is now 520,000. Apply or Keep current. | Material: the transactions would change (no longer Mortgage). Nothing changes until Admin decides. |
| PN-0002043 | MyLoans change: status | Admin | MyLoans review: MyLoans says cancelled. Close as cancelled. | The loan file closes as cancelled, with the reason. |
| PN-0002044 | MyLoans: replaced by a new PN | Admin, then LA 1 | Review shows PN-0009100 replacing it. LA 1: Find PN-0009100 and open it. | PN-0009100 opens linked to PN-0002044 as its replacement; the review lists it as the candidate. |
| PN-0009100 | The replacement PN (not opened) | LA 1 | Find a loan: PN-0009100. | The preview says it replaces PN-0002044 (same borrower). |
| (none) | Test kit | Admin | Settings > Test kit: Take backup, then Reset to start (type RESET), then Restore the backup. | Each step says what it did; the reset first saves an automatic backup. |

## Exceptions

| PN | Case | Who signs in | What to do | What should happen |
|---|---|---|---|---|
| PN-0002013 | On hold (LA 1 and LA 2) | LA 1, then LA 2 | Notary is on hold by LA 1 (client's papers); For Entry PPSR by LA 2 (branch head). LA 1: try to resume PPSR. LA 2: Resume PPSR with remarks. | The held work is locked. Only the person who put it on hold resumes it. The hold shows the reason, the remarks as typed, who and when. |
| PN-0002025 | Hold a supervisor can transfer | Branch Supervisor, then DP 2 | Notary is on hold by DP 1. Supervisor: Transfer hold to DP 2 with a note. DP 2: Resume. | The supervisor can transfer but not resume. After the transfer only DP 2 can resume. |
| PN-0002026 | Problem at the LTO | DP 1, Admin | DP 1: resolve the problem with a note. Admin: mark it outside our control (before resolving). | The problem shows red until resolved; the history keeps both steps. |
| PN-0002014 | Pull back before accept | LA 1 | Notary was sent to DP 1, not accepted. Pull it back with a reason. | Back to Ready to send; the papers stay at the branch; gone from DP 1's list; DP 1 is told. |
| PN-0002017 | Returned to the LA with findings and papers | LA 1 | Notary returned by DP 1 (missing paper: the ID copy). Confirm the papers came back, tick the ID, Send again. | Sending waits until the papers are confirmed back. Sent again, it is Round 2 for the processor. |
| PN-0002019 | Inactive sender | LA 1 or LA 2 | Home and Open items: the Notary declined by DP 1. | "Sender Inactive LA is inactive": the other LAs of the branch take it over and send it again. |
