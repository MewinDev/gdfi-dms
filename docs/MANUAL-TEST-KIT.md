# Manual Test Kit

Last updated: 9 November 2026

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
| DP 3 | Document Processor, on leave for a week | Davao |
| DP 4 | Document Processor, own capacity 5 | Makati |
| Operations Monitor | Operations Monitor (read-only: Monitoring and LTO advisories) | All |

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
| PN-0002030 | Funds: needed, no request yet | DP 1 | Mortgage needs funds (LTO fee). Try Start LTO drop off; then request funds: pick the type (Cash advance is the default; try Fund transfer too). | Blocked: "This job needs funds. Request a cash advance first." The request goes to Finance (Requested), with the type pill. |
| PN-0002033 | Funds: released | DP 2 | My funds: liquidate CA for PN-0002033 with a receipt, or return the cash. | Partly or fully liquidated; Finance closes it. |

## Finance

| PN | Case | Who signs in | What to do | What should happen |
|---|---|---|---|---|
| PN-0002031 | Funds: requested | Finance | Funds > Approve: approve the request. | Approved; waiting for release. |
| PN-0002032 | Funds: approved | Finance | Funds: release it with a voucher reference. | Released; DP 1 sees the liquidation due date. |
| PN-0002034 | Funds: overdue notice | Finance, then DP 2 | Notifications: "liquidation overdue". DP 2: try a new cash request. | DP 2 and Finance have the overdue notice. DP 2's new requests are refused until it is liquidated or Finance grants an exception. |
| PN-0002035 | Funds: liquidated | Finance | Funds: close the advance. | Closed. |
| PN-0002036 | Funds: closed | Finance | Open the advance. | Closed, with the receipt and the history. |
| PN-0002051 | Fund transfer: requested | Finance | Funds > To approve: the FT · Fund transfer pill. Filter by type (FT), Download CSV, then approve it. | The list and the counts follow the type filter; the CSV has the Type column and only Fund transfers. |
| PN-0002052 | Fund transfer: approved (changed from Cash advance) | Finance | Funds > To release: open History on the card. Then Send transfer: reference number, transfer date, bank or e-wallet, account name, last 4 digits. | History shows "changed the type from Cash advance to Fund transfer" with the remarks. More than 4 digits is refused; only the last 4 are stored. |
| PN-0002053 | Fund transfer: sent | DP 1 | My funds: the FT pill and "sent ... to BPI, DP 1, account ending 4821". Liquidate with a receipt. | Same liquidation as a cash advance. |
| PN-0002054 | Fund transfer: liquidated | Finance | Funds > Outstanding: close it. | Closed. |
| PN-0002055 | Fund transfer: closed | Finance | Funds > History. | Closed, with the FT pill. |
| PN-0002056 | Fund transfer: cash to settle after a return | DP 2, then Finance | My funds and Funds > Outstanding. | "Cash to settle" with the FT pill, as for a cash advance. |
| PN-0002057 | Fund transfer: overdue notice | DP 2, Finance | Notifications: "(Fund transfer): liquidation overdue". | Same overdue notice and block as PN-0002034. |
| PN-0002037 | Funds: cash to settle after a return | DP 2, then LA 1 | DP 2: My funds shows Cash to settle. LA 1: confirm the Mortgage papers came back. | The return went ahead; the cash stays DP 2's to liquidate. LA 1 can send again only after confirming the papers. |

## Admin

| PN | Case | Who signs in | What to do | What should happen |
|---|---|---|---|---|
| PN-0002041 | MyLoans change: minor | Admin | Open the loan file and its history. | MyLoans now spells the name with "Jr." and has a new address. The copy was updated by itself; no review needed. |
| PN-0002042 | MyLoans change: material | Admin | MyLoans review: the amount is now 520,000. Apply or Keep current. | Material: the transactions would change (no longer Mortgage). Nothing changes until Admin decides. |
| PN-0002043 | MyLoans change: status | Admin | MyLoans review: MyLoans says cancelled. Close as cancelled. | The loan file closes as cancelled, with the reason. |
| PN-0002044 | MyLoans: replaced by a new PN | Admin, then LA 1 | Review shows PN-0009100 replacing it. LA 1: Find PN-0009100 and open it. | PN-0009100 opens linked to PN-0002044 as its replacement; the review lists it as the candidate. |
| PN-0009100 | The replacement PN (not opened) | LA 1 | Find a loan: PN-0009100. | The preview says it replaces PN-0002044 (same borrower). |
| (none) | Funds types | Admin | Settings > Funds types: CA · Cash advance and FT · Fund transfer, "Proposed, to be confirmed with Finance". Rename one, then look at an old record. | Saving confirms it (Proposed goes). Old records keep the name they had. |
| (none) | Test kit | Admin | Settings > Test kit: Take backup, then Reset to start (type RESET), then Restore the backup. | Each step says what it did; the reset first saves an automatic backup. |

## Monitoring

Dates on the Monitoring page are Philippine dates; the default is Last 30 days. Open counts are as of now. Every time includes time on hold.

| PN | Case | Who signs in | What to do | What should happen |
|---|---|---|---|---|
| (none) | DP monitor, grouped by branch | Operations Monitor | Sign in: Monitoring opens (no Home, no loan files). DPs tab: look at the groups "Cebu · Quezon City", "Davao", "Makati". Collapse one group. Click "How is this counted?". | DP 1 is Full (more open jobs than 10). DP 2 is Busy, "20% · 8 of 10 in use". DP 3 is "On leave until ..." (0%, not in the average availability). DP 4 is Available, "60% · 2 of 5 in use". Each group has a subtotal. |
| PN-0002060 | Finished by DP 2 in 5 business days | Operations Monitor | DP 2's row: the averages. | Avg time to accept 0.5 days, processing 2.5 days, total 3 days, each "2 jobs" (with PN-0002061). |
| PN-0002061 | Finished by DP 2 in 1 business day | Operations Monitor | Click DP 2's row: the drill-down. | Open jobs with age and due date; the PN is plain text (this role cannot open loans). Declined: none; Returned: PN-0002037 and PN-0002056. |
| PN-0002062 | Finished by DP 4 in 4 business days (Makati) | Admin | Monitoring, DPs: DP 4's averages, then click a PN in the drill-down. | Accept 1 day, processing 3 days, total 4 days, "1 job". Admin can open the loan from the PN. |
| PN-0002063 | DP 4 overdue | Operations Monitor | DP 4's row: Overdue. Drill-down. | Overdue 1: sent 3 business days ago, not accepted (Accept is due the same day). |
| PN-0002064 | DP 4 at LTO Makati now | Operations Monitor | LTO offices tab: LTO Makati District Office, then click it. | At the LTO now 1; the drill-down shows the drop off 1 business day ago, pickup "Not yet". |
| PN-0002065 | Sent to DP 3 before the leave | LA Davao | Open another Davao transaction's Send step (or look at PN-0002065's job). Admin: Settings > Processor capacity. | DP 3 shows "On leave until ..." and cannot be picked. In Monitoring the job counts for DP 3 as Assigned and Overdue (not accepted since yesterday). Admin can switch the leave off or change the day. |
| PN-0002022 | Active advisory: LTO Quezon City system down (2 hours ago) | LA 1, then DP 1 | LA 1: PN-0002011, Mortgage, Send: pick LTO Quezon City District Office. DP 1: open the PN-0002022 job. | LA 1 sees "LTO Quezon City District Office: System down, reported by DP 1, 2 h ago" under the office; Send still works. DP 1 sees the same in "Process at" and can resolve it (they filed it). |
| (none) | Advisory older than 24 hours (LTO Cebu, long queue) | Operations Monitor | LTO offices tab: LTO advisories. | "Still active? Please confirm" with "No longer active: resolve". Resolving needs remarks (5 to 500). |
| (none) | Resolved advisory (LTO Makati, office closed) | Operations Monitor | LTO advisories: "Resolved in ...". | Filed by DP 4, resolved by Operations Monitor with remarks and the time. |
| (none) | Report an LTO problem | DP 4 | Open the PN-0002064 job (at LTO pickup): Report an LTO problem: Long queue, remarks, Report. | The advisory shows on the job and in Monitoring; Operations Monitor gets a notification. DP 1 and DP 2 get nothing. |
| (none) | Dates, By day, CSV | Operations Monitor | Dates: Custom, From and To the same day; then By day; then Download CSV. Try a To before From. | The heading shows the dates ("9 Nov to 9 Nov 2026"); By day lists each day per group; the CSV follows the view and filters. A To before From is refused with a message. |
| (none) | Roles: the Monitoring group | Admin | Settings > Roles and access: open Operations Monitor and Finance. | A "Monitoring" group with five switches. Operations Monitor has the two monitors and "Manage LTO advisories"; Finance has none. |

## Exceptions

| PN | Case | Who signs in | What to do | What should happen |
|---|---|---|---|---|
| PN-0002013 | On hold (LA 1 and LA 2) | LA 1, then LA 2 | Notary is on hold by LA 1 (client's papers); For Entry PPSR by LA 2 (branch head). LA 1: try to resume PPSR. LA 2: Resume PPSR with remarks. | The held work is locked. Only the person who put it on hold resumes it. The hold shows the reason, the remarks as typed, who and when. |
| PN-0002025 | Hold a supervisor can transfer | Branch Supervisor, then DP 2 | Notary is on hold by DP 1. Supervisor: Transfer hold to DP 2 with a note. DP 2: Resume. | The supervisor can transfer but not resume. After the transfer only DP 2 can resume. |
| PN-0002026 | Problem at the LTO | DP 1, Admin | DP 1: resolve the problem with a note. Admin: mark it outside our control (before resolving). | The problem shows red until resolved; the history keeps both steps. |
| PN-0002014 | Pull back before accept | LA 1 | Notary was sent to DP 1, not accepted. Pull it back with a reason. | Back to Ready to send; the papers stay at the branch; gone from DP 1's list; DP 1 is told. |
| PN-0002017 | Returned to the LA with findings and papers | LA 1 | Notary returned by DP 1 (missing paper: the ID copy). Confirm the papers came back, tick the ID, Send again. | Sending waits until the papers are confirmed back. Sent again, it is Round 2 for the processor. |
| PN-0002019 | Inactive sender | LA 1 or LA 2 | Home and Open items: the Notary declined by DP 1. | "Sender Inactive LA is inactive": the other LAs of the branch take it over and send it again. |
