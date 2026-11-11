# Manual Test Kit: scenarios

Last updated: 10 November 2026 (PHT)

The old scenario data: sample accounts and one sample loan per case, already moved through the steps (sent, accepted, on hold, funded, returned, overdue and so on). It loads **only** with `--with-scenarios`; the default kit is the clean one ([Manual Test Kit](MANUAL-TEST-KIT.md)). The automated kit tests use it too.

## Commands

Run these in PowerShell, in the project folder.

| Command | What it does |
|---|---|
| `npm run kit:start -- --with-scenarios` | Puts `gdfi_dms` in the scenarios state. The first time it builds it (about a minute) and saves it as its own baseline (`storage/kit/baseline.dump`); after that it restores it. Says "Loaded: kit WITH SCENARIOS". |
| `npm run kit:reset -- --with-scenarios` | Back to the scenarios state. Asks you to type RESET; takes an automatic backup first. |
| `npm run kit:rebuild -- --with-scenarios` | Builds the scenarios baseline again (after a new migration). |
| `npm run kit:backup`, `kit:list`, `kit:restore` | The same as for the clean kit. |

In **Settings > Test kit** the button is **Reset with scenarios**.

**Dates.** Release dates count back from the day the scenarios were built (0, 2 or 4 business days). A reset or restore on a later day moves every date forward by the business days in between (weekends and holidays skipped).

## Sample accounts

Sign in at `/login`, under **Test sign-in**. Each button shows the role and branches.

| Account | Role | Branch access (home branch first) |
|---|---|---|
| Admin | Admin | All branches |
| Finance | Finance | All branches |
| Branch Supervisor | Branch Supervisor (the built-in role: loans of their branches, move a hold to another person, resolve any problem, Monitoring, TAT report) | Antipolo (101), Angono (165) |
| LA 1 | Loan Associate | Antipolo (101), Angono (165) |
| LA 2 | Loan Associate | Antipolo (101), Angono (165) |
| LA Alaminos (was "LA Davao") | Loan Associate | Alaminos (390) |
| DP 1 | Document Processor | Antipolo (101), Angono (165) |
| DP 2 | Document Processor | Antipolo (101), Angono (165) |
| Receiving LA A. Mabini (was "Receiving LA Makati") | Loan Associate | A. Mabini (168) |
| Inactive LA | Loan Associate, inactive (not in the list) | Antipolo (101), Angono (165) |
| DP 3 | Document Processor, on leave for a week | Alaminos (390) |
| DP 4 | Document Processor, own capacity 5 | A. Mabini (168) |
| Operations Monitor | Operations Monitor (read-only: Monitoring and LTO advisories) | All branches |
| Area Supervisor Luzon 1 | Branch Supervisor | The whole Area LUZON 1 (NGMA + RIZAL) in Branch Division, plus Alaminos (390); home Antipolo |
| LA Luzon 1 (not Amang Rodriguez) | Loan Associate | The whole Area LUZON 1 (NGMA + RIZAL) except Amang Rodriguez (174); home Angono |
| Roving LA | Loan Associate | All branches |
| LA Alicia | Loan Associate | Alicia (709), Alicia-Inactive (718) |
| LA No Refresh | LA (no refresh): a sample role with every Loan Associate tick except "Refresh a loan from MyLoans" | Antipolo (101), Angono (165) |

The branches are real MyLoans branches. The made-up sample branches were replaced: Quezon City (QC) is now Antipolo (101), Cebu (CEB) is Angono (165), Davao (DVO) is Alaminos (390) and Makati (MKT) is A. Mabini (168). The LTO offices did not change (Antipolo's usual office is still LTO Quezon City District Office).

**The real branch list.** Put the MyLoans branch file at `storage/kit/myloans-branches.csv` (Git ignores it; never commit it). `kit:start` and `kit:rebuild` then import the real 6 divisions, 25 areas and 298 branches through Import from MyLoans, leaving out the four rows that look like test or unused branches (213 Makati A, 999 Test Branch, 721 Bacoor(DONT USE), 753 Plaridel-DONT USE) so a manual import shows them as suggestions. Without the file the kit uses the built-in subset of 12 branches.

## Loan Associate

| PN | Case | Who signs in | What to do | What should happen |
|---|---|---|---|---|
| GD1012026902001 | Refinancing, no mortgage | LA 1 | Open the loan file. | Refinancing; New above 500,000 is Not Mortgage: Notary and For EDST only. |
| GD1012026902002 | Financing, Undertaking, Transferred | LA 1 | Open the loan file. | Financing, Undertaking and Transferred (picked by the LA); New 350,000 is Mortgage: Notary, For EDST, For Entry PPSR and Mortgage. |
| GD1012026902003 | Blank product, default Refinancing | LA 1 | Open the loan file. | Blank Product Name defaults to Refinancing; Renewal 800,000 is Mortgage: 4 transactions. |
| GD1012026902004 | Financing, Non-Undertaking | LA 1 | Open the loan file. | Financing, Non-Undertaking (picked by the LA), Transferred; Mortgage: 4 transactions. |
| GD1012026902005 | Financing, Untransferred | LA 1 | Open the loan file. | Rule 3: Untransferred gives Notary and For EDST; Mortgage not evaluated. |
| GD1012026902006 | New at 500,000 | LA 1 | Open the loan file. | Exactly 500,000 is Mortgage: 4 transactions. |
| GD1012026902007 | New at 500,001 | LA 1 | Open the loan file. | Above 500,000 is Not Mortgage: Notary and For EDST. |
| GD1652026902008 | Renewal at 1,000,000 (Angono) | LA 1 | Open the loan file. | Exactly 1,000,000 is Mortgage: 4 transactions. |
| GD1652026902009 | Renewal at 1,000,001 (Angono) | LA 1 | Open the loan file. | Above 1,000,000 is Not Mortgage: Notary and For EDST. |
| GD1012026902010 | "Auto Finance" is not the word Financing | LA 1 | Open the loan file. | Not the whole word Financing, so Refinancing; Not Mortgage. |
| GD1012026902011 | Needs LTO: office and cash estimate | LA 1 | Mortgage: the papers are ticked. Send it to DP 1. | Send asks for the LTO office and whether it needs funds, with the cash estimate. Then it waits for DP 1 to accept. |
| GD1012026902012 | Required paper missing, with remarks | LA 1 | Notary: Valid IDs of borrower (2) is marked Missing (Borrower to submit later, with remarks). Send it to DP 1. Then mark it Received with today's date. | The row is amber "Missing, with remarks"; Send is allowed. Received keeps the reason and remarks in the history and clears the "Missing papers" row. |
| GD1012026902080 | Optional paper included and missing | LA 1 | Notary: Valid ID of co-maker has "Include in this file" ticked and is Missing with remarks. Send Notary to DP 1. | An included optional paper behaves like a required one. An optional paper not included needs nothing. |
| GD1012026902038 | TAT on time | LA 1 | Notary: send it to DP 1. | On time: no late reason is asked. |
| GD1012026902039 | TAT due today | LA 1 | Notary: see the chip, then send it. | Due today (Day 2 from release): no late reason yet. |
| GD1012026902040 | TAT late | LA 1 | Notary: send it to DP 1. | Late: Send asks for a Beyond-TAT reason and refuses without it. |
| GD1012026902050 | Not opened yet | LA 1 | My loans > Find a loan: type GD1012026902050, Find, then Open loan file. | The preview shows the MyLoans details; opening creates the loan file. |
| GD1012026902046 | Same borrower, additional unit | LA 1 | Find GD1012026902046 and open it. | Find loan says the same borrower already has GD1012026902045 open. It is an additional unit, not a replacement; both show under related loans. |
| GD1012026902045 | Same borrower, first unit | LA 1 | Open GD1012026902045 after opening GD1012026902046. | Related loans lists GD1012026902046. |
| GD3902026902047 | Another branch (Alaminos) | LA 1, then LA Alaminos | LA 1: go to /loans/GD3902026902047. LA Alaminos: open it from My loans. | LA 1 gets "not found" (outside the branches); LA Alaminos sees it. |
| GD1012026902027 | Forwarded to a receiving LA in another branch | Receiving LA A. Mabini | Home: receive the Notary package; check each paper; Complete. | The package from DP 1 arrives at A. Mabini; received complete, Notary is done. |
| GD1012026902028 | Complete | LA 1 | Open the loan file. | Notary and For EDST are done: the loan file is complete. |

## DP

| PN | Case | Who signs in | What to do | What should happen |
|---|---|---|---|---|
| GD1012026902015 | Sent, waiting to accept | DP 1 | Jobs: open the Notary job; Accept. | In process; the stages show, Notarization first. |
| GD1012026902016 | DP declines | DP 2 | Jobs: open the Notary job; Decline with a reason and remarks. | It goes back to the LAs of the branch, with the reason; the job leaves DP 2's list. |
| GD1012026902018 | Round 2 (sent again after a return) | DP 1 | Jobs: open the Notary job; Accept. | Marked Round 2; the earlier return shows in the history. |
| GD1012026902020 | Notary stages in progress | DP 1 | Notarization is done; Start and Finish LTO drop off, LTO pickup, then Check and verify. | Each stage asks for its evidence; the stepper moves on. |
| GD1012026902021 | Entry of PPSR stages in progress | DP 1 | PPSR registration is done; work the next stages. | Same as above, for Entry of PPSR. |
| GD1012026902022 | Mortgage stages in progress | DP 1 | LTO drop off is done; Start LTO pickup. | LTO pickup asks for the annotated OR/CR. |
| GD1012026902023 | Check and verify blocking | DP 1 | Check and verify: one paper is ticked, a Missing paper problem is open. Try Finish, then Complete job. | Both refused while the problem is open and papers are not ticked. Resolve the problem, tick the papers, Finish, then Complete job. |
| GD1012026902024 | Pasuyo (cash decision first) | DP 1 | Mortgage: DP 1 holds 3,500 released cash. Pass the job to DP 2. | It asks first: return the cash, or hand the balance to DP 2. |
| GD1012026902082 | LA ticked a paper Present that is not there | DP 1 | Jobs: open the Notary job; Accept with a paper not received, return it to LA 1. | The return still works for a paper the LA ticked Present (Round 2 when sent again). |
| GD1012026902029 | Incomplete, back to the DP | DP 1 | Jobs: "Package incomplete" (the notarized deed of sale). Correct it and Forward to LA 1 again. | The incomplete note closes; LA 1 can receive it again. |
| GD1012026902030 | Funds: needed, no request yet | DP 1 | Mortgage needs funds (LTO fee). Try Start LTO drop off; then request funds: pick the type (Cash advance is the default; try Fund transfer too). | Blocked: "This job needs funds. Request a cash advance first." The request goes to Finance (Requested), with the type pill. |
| GD1012026902033 | Funds: released | DP 2 | My funds: liquidate CA for GD1012026902033 with a receipt, or return the cash. | Partly or fully liquidated; Finance closes it. |

## Finance

| PN | Case | Who signs in | What to do | What should happen |
|---|---|---|---|---|
| GD1012026902031 | Funds: requested | Finance | Funds > Approve: approve the request. | Approved; waiting for release. |
| GD1012026902032 | Funds: approved | Finance | Funds > To release: press Release on the row, type a voucher reference, Release cash. | Released; DP 1 sees the liquidation due date. |
| GD1012026902034 | Funds: overdue notice | Finance, then DP 2 | Notifications: "liquidation overdue". DP 2: try a new cash request. | DP 2 and Finance have the overdue notice. DP 2's new requests are refused until it is liquidated or Finance grants an exception. |
| GD1012026902035 | Funds: liquidated | Finance | Funds: close the advance. | Closed. |
| GD1012026902036 | Funds: closed | Finance | Open the advance. | Closed, with the receipt and the history. |
| GD1012026902051 | Fund transfer: requested | Finance | Funds > To approve: the FT · Fund transfer pill and its FT- number. Filter by type (FT), Download CSV, then approve it (Approve asks first). | The number is FT-2026-.... The list and the counts follow the type filter; the CSV has the Type column and only Fund transfers. "Approve this request?" shows the amount and the request; it is approved once. |
| GD1012026902052 | Fund transfer: approved (changed from Cash advance) | Finance | Funds > To release: open Details on the row, then History. Then Send: reference number, transfer date, bank or e-wallet, account name, last 4 digits, Send transfer. | Its number is FT-2026-... with "Formerly CA-2026-..." under it; History shows "changed the type from Cash advance to Fund transfer (formerly CA-...)" with the remarks; searching the CA- number finds it. More than 4 digits is refused; only the last 4 are stored. |
| GD1012026902053 | Fund transfer: sent | DP 1 | My funds: the FT pill and "sent ... to BPI, DP 1, account ending 4821". Liquidate with a receipt. | Same liquidation as a cash advance. |
| GD1012026902054 | Fund transfer: liquidated | Finance | Funds > Outstanding: close it. | Closed. |
| GD1012026902055 | Fund transfer: closed | Finance | Funds > History. | Closed, with the FT pill. |
| GD1012026902056 | Fund transfer: cash to settle after a return | DP 2, then Finance | My funds and Funds > Outstanding. | "Cash to settle" with the FT pill, as for a cash advance. |
| GD1012026902057 | Fund transfer: overdue notice | DP 2, Finance | Notifications: "(Fund transfer): liquidation overdue". | Same overdue notice and block as GD1012026902034. |
| GD1012026902037 | Funds: cash to settle after a return | DP 2, then LA 1 | DP 2: My funds shows Cash to settle. LA 1: confirm the Mortgage papers came back. | The return went ahead; the cash stays DP 2's to liquidate. LA 1 can send again only after confirming the papers. |
| (none) | Expense kinds: Other must say what it is | DP 1 | My funds > Request: Add an expense, pick Other. Leave "What is this expense?" empty, then type "Courier". | Send to Finance stays off with "Say what this expense is" until 3 to 60 characters are typed. The request shows "Other: Courier". |
| (none) | Expense kinds: often typed as Other | DP 1, then Finance | The kit has two "Other: Courier" expenses (DP 1, waiting for approval). DP 1 sends a third one (above). Finance: Settings > Expense kinds. | "Often typed as Other" lists Courier (typed 3 times). Add as a kind: pick the amount (for example Suggested 150), optionally tick "relabel"; Courier is now in every Expense kind dropdown, before Other. |
| (none) | Expense kinds: + Add new kind | Finance | Funds > To approve: on an Other: Courier row open More, press Change Other: Courier, then "+ Add new kind", name it Parking, Add. | Parking is saved Active and selected at once; the history says who added it. DP 1 (no "Add and manage expense kinds" tick) has no "+ Add new kind" link. |
| (none) | Expense kinds: fixed amount | Admin, then DP 1 | Settings > Expense kinds: Notary fee, Fixed amount 500, Save. DP 1: a Notary request line. | The amount is pre-filled and read only ("Fixed for this kind"). A rule's Suggested amount for the transaction still comes first. Old requests keep their amounts. |

## Admin

| PN | Case | Who signs in | What to do | What should happen |
|---|---|---|---|---|
| GD1012026902041 | MyLoans change: borrower details | Branch Supervisor | Open the loan file, To do, MyLoans corrections. | MyLoans now spells the name with "Jr." and has a new address and contact number. The loan keeps the old details with the chip "MyLoans changed borrower details, waiting for review"; old and new side by side, the differing characters marked. Accept the correction or Keep current (a note is required). Nothing is blocked. |
| GD1012026902042 | MyLoans change: material | Admin | MyLoans review: the amount is now 520,000. Apply or Keep current. | Material: the transactions would change (no longer Mortgage). Nothing changes until Admin decides. |
| GD1012026902043 | MyLoans change: status | Admin | MyLoans review: MyLoans says cancelled. Close as cancelled. | The loan file closes as cancelled, with the reason. |
| GD1012026902044 | MyLoans: replaced by a new PN | Admin, then LA 1 | Review shows GD1012026909100 replacing it. LA 1: Find GD1012026909100 and open it. | GD1012026909100 opens; it is not linked by itself. The review of GD1012026902044 lists it as a possible replacement; Admin presses **Link as replacement** (a note is required) to link them as "Replaces / Replaced by". |
| GD1012026909100 | The replacement PN (not opened) | LA 1 | Find a loan: GD1012026909100. | The preview says it replaces GD1012026902044 (same borrower). |
| (none) | Funds types | Admin | Settings > Funds types: CA · Cash advance and FT · Fund transfer, "Proposed, to be confirmed with Finance". Rename one, then look at an old record. | Saving confirms it (Proposed goes). Old records keep the name they had. |
| (none) | Test kit | Admin | Settings > Test kit: Take backup, then Reset to start (type RESET), then Restore the backup. | Each step says what it did; the reset first saves an automatic backup. |
| GD1012026902001 | Roles are just ticks: Refresh | LA No Refresh, then Admin, then LA No Refresh | LA No Refresh: open the loan file. Admin: Settings > Roles, LA (no refresh), tick "Refresh a loan from MyLoans" under MyLoans and sync, Save (the preview says "1 user gains: Refresh a loan from MyLoans"). Sign in again as LA No Refresh and open the same loan file. | First: "MyLoans · Last checked" shows, with no Refresh from MyLoans button. After the tick: the Refresh from MyLoans button is there. Settings > Roles shows the change on the role card. Reset to start removes the tick again. |

## Branches and the PN format

| PN | Case | Who signs in | What to do | What should happen |
|---|---|---|---|---|
| GD1012026902050 | A PN typed in a pasted variant | LA 1 | My loans > Find a loan: type `gd 101-2026-9-02050` (spaces, dashes, lower case), Find loan. | Found: the preview shows GD1012026902050. |
| (none) | A wrong PN | LA 1 | Find a loan: GD1012027902050, then GD10120269020, then XX1012026902050. | "This does not look like a PN. Example: GD1012026900001" with the wrong part: "The year is in the future (2027).", "The running number must be 5 digits (this one has 3).", "The PN must start with GD, not XX." Nothing is asked of MyLoans. |
| (none) | PN format setting | Admin | Settings > System and test mode > PN format: type in Try a PN, change the system digit to 8, then back to 9. | The pattern GD ### #### 9 ##### and the example; Try a PN says which part is wrong; with 8, GD1012026902050 is refused by Find loan. Switch the check off: any PN is looked up. |
| GD7772026902070 | Unknown branch code 777 in the PN (the loan is at Antipolo in MyLoans) | LA 1, then Admin | LA 1: Find GD7772026902070 and open it. Admin: Settings > Branches > Branch review. | The lookup is not blocked; the loan opens at Antipolo (101) and shows "Opened at branch code 777 (not a branch here yet), now at Antipolo". The Branch review has "Unknown branch code seen in a PN: Code 777" with the PN. |
| GD1012026902071 | MyLoans moved it to another branch: waiting for review | Admin | Open the loan file: MyLoans review. | Material change: Branch Antipolo → Angono, "Opened at Antipolo", who can see it before and after, and who has open work. Nothing changes until Apply. |
| GD1012026902072 | Branch change applied | LA 1 | Open the loan file. | Under the PN: "Opened at Antipolo, now at Angono". The Journey has the applied MyLoans change. |
| GD7182026902073 | Open loan at a branch MyLoans closed | Admin, then LA Alicia | Admin: Settings > Branches: Alicia-Inactive. LA Alicia: open the loan file, then Find a loan for a new Alicia-Inactive PN. | Alicia-Inactive is Inactive with "1 active user and 1 open loan file". LA Alicia still sees and works the open loan; no new loan file can be opened there; the branch is greyed in pickers. |
| (none) | A rename and a code change waiting in the Branch review | Admin | Settings > Branches > Branch review: Amang Rodriguez → Amang Rodriguez - Pasig (Renamed), Alicia 709 → 710 (Code changed). Accept one, ignore the other. | Accept shows who gains or loses access first, then applies it; the branch keeps its id, users and loans. Ignore leaves it as it is. Both stay in the decided list. |
| (none) | Import from MyLoans (the real file) | Admin | Settings > Branches > Import from MyLoans: pick `storage/kit/myloans-branches.csv`. | The preview: counts per Division and Area; the four test-looking rows first ("Looks like a test or unused branch", Inactive, Hide from DMS suggested, not ticked); the rest Unchanged; Alicia-Inactive "Not in this file". Confirm adds the four as inactive. |
| (none) | Branch access tree | Admin | Users > Edit "LA Luzon 1 (not Amang Rodriguez)", Branch access. Then "Area Supervisor Luzon 1" and "Roving LA". | Selected: LUZON 1 (NGMA + RIZAL) ticked with "Everything in this area except 1 branch"; the summary and the home branch Angono. The supervisor has the whole area plus Alaminos; Roving LA has All branches. |

### Old PN to new PN

The sample PNs now use the real format (GD + branch code + 2026 + 9 + a 5-digit running number). The running number keeps the old sample number, so PN-0002013 is GD1012026902013.

| Old PN | New PN |
|---|---|
| PN-0002001 | GD1012026902001 |
| PN-0002002 | GD1012026902002 |
| PN-0002003 | GD1012026902003 |
| PN-0002004 | GD1012026902004 |
| PN-0002005 | GD1012026902005 |
| PN-0002006 | GD1012026902006 |
| PN-0002007 | GD1012026902007 |
| PN-0002008 | GD1652026902008 |
| PN-0002009 | GD1652026902009 |
| PN-0002010 | GD1012026902010 |
| PN-0002011 | GD1012026902011 |
| PN-0002012 | GD1012026902012 |
| PN-0002013 | GD1012026902013 |
| PN-0002014 | GD1012026902014 |
| PN-0002015 | GD1012026902015 |
| PN-0002016 | GD1012026902016 |
| PN-0002017 | GD1012026902017 |
| PN-0002018 | GD1012026902018 |
| PN-0002019 | GD1012026902019 |
| PN-0002020 | GD1012026902020 |
| PN-0002021 | GD1012026902021 |
| PN-0002022 | GD1012026902022 |
| PN-0002023 | GD1012026902023 |
| PN-0002024 | GD1012026902024 |
| PN-0002025 | GD1012026902025 |
| PN-0002026 | GD1012026902026 |
| PN-0002027 | GD1012026902027 |
| PN-0002028 | GD1012026902028 |
| PN-0002029 | GD1012026902029 |
| PN-0002030 | GD1012026902030 |
| PN-0002031 | GD1012026902031 |
| PN-0002032 | GD1012026902032 |
| PN-0002033 | GD1012026902033 |
| PN-0002034 | GD1012026902034 |
| PN-0002035 | GD1012026902035 |
| PN-0002036 | GD1012026902036 |
| PN-0002037 | GD1012026902037 |
| PN-0002038 | GD1012026902038 |
| PN-0002039 | GD1012026902039 |
| PN-0002040 | GD1012026902040 |
| PN-0002041 | GD1012026902041 |
| PN-0002042 | GD1012026902042 |
| PN-0002043 | GD1012026902043 |
| PN-0002044 | GD1012026902044 |
| PN-0002045 | GD1012026902045 |
| PN-0002046 | GD1012026902046 |
| PN-0002047 | GD3902026902047 |
| PN-0002050 | GD1012026902050 |
| PN-0002051 | GD1012026902051 |
| PN-0002052 | GD1012026902052 |
| PN-0002053 | GD1012026902053 |
| PN-0002054 | GD1012026902054 |
| PN-0002055 | GD1012026902055 |
| PN-0002056 | GD1012026902056 |
| PN-0002057 | GD1012026902057 |
| PN-0002060 | GD1012026902060 |
| PN-0002061 | GD1012026902061 |
| PN-0002062 | GD1682026902062 |
| PN-0002063 | GD1682026902063 |
| PN-0002064 | GD1682026902064 |
| PN-0002065 | GD3902026902065 |
| PN-0009100 | GD1012026909100 |

## Monitoring

Dates on the Monitoring page are Philippine dates; the default is Last 30 days. Open counts are as of now. Every time includes time on hold.

| PN | Case | Who signs in | What to do | What should happen |
|---|---|---|---|---|
| (none) | DP monitor, grouped by branch | Operations Monitor | Sign in: Monitoring opens (no Home, no loan files). DPs tab: look at the groups "Angono · Antipolo", "Alaminos", "A. Mabini". Collapse one group. Click "How is this counted?". | DP 1 is Full (more open jobs than 10). DP 2 is Busy, "20% · 8 of 10 in use". DP 3 is "On leave until ..." (0%, not in the average availability). DP 4 is Available, "60% · 2 of 5 in use" (with a usage bar). Each Area has a subtotal; a branch has its own subtotal only when it has more than one processor. |
| GD1012026902060 | Finished by DP 2 in 5 business days | Operations Monitor | DP 2's row: the averages. | Avg time to accept 0.5 days, processing 2.5 days, total 3 days, each "2 jobs" (with GD1012026902061). |
| GD1012026902061 | Finished by DP 2 in 1 business day | Operations Monitor | Click DP 2's row: the drill-down. | Open jobs with age and due date; the PN is plain text (this role cannot open loans). Declined: none; Returned: GD1012026902037 and GD1012026902056. |
| GD1682026902062 | Finished by DP 4 in 4 business days (A. Mabini) | Admin | Monitoring, DPs: DP 4's averages, then click a PN in the drill-down. | Accept 1 day, processing 3 days, total 4 days, "1 job". Admin can open the loan from the PN. |
| GD1682026902063 | DP 4 overdue | Operations Monitor | DP 4's row: Overdue. Drill-down. | Overdue 1: sent 3 business days ago, not accepted (Accept is due the same day). |
| GD1682026902064 | DP 4 at LTO Makati now | Operations Monitor | LTO offices tab: LTO Makati District Office, then click it. | At the LTO now 1; the drill-down shows the drop off 1 business day ago, pickup "Not yet". |
| GD3902026902065 | Sent to DP 3 before the leave | LA Alaminos | Open another Alaminos transaction's Send step (or look at GD3902026902065's job). Admin: Settings > Processor capacity. | DP 3 shows "On leave until ..." and cannot be picked. In Monitoring the job counts for DP 3 as Assigned and Overdue (not accepted since yesterday). Admin can switch the leave off or change the day. |

**Date range check (three steps):**
1. Monitoring: press the date button ("11 Oct to 9 Nov 2026"), pick **Last 7 days**, Apply: the title, the button and Download CSV all say the same 7 days.
2. Open it again, click two days in the calendar (it switches to **Custom** and says "N days, M business days"), Apply: the URL keeps the range, so a refresh or a shared link shows the same days; By day uses them too.
3. Open it once more and press **Esc**: nothing changes and focus is back on the button. On a phone the picker is a bottom sheet with one month.
| GD1012026902022 | Active advisory: LTO Quezon City system down (2 hours ago) | LA 1, then DP 1 | LA 1: GD1012026902011, Mortgage, Send: pick LTO Quezon City District Office. DP 1: open the GD1012026902022 job. | LA 1 sees "LTO Quezon City District Office: System down, reported by DP 1, 2 h ago" under the office; Send still works. DP 1 sees the same in "Process at" and can resolve it (they filed it). |
| (none) | Advisory older than 24 hours (LTO Cebu, long queue) | Operations Monitor | LTO offices tab: LTO advisories. | "Still active? Please confirm" with "No longer active: resolve". Resolving needs remarks (5 to 500). |
| (none) | Resolved advisory (LTO Makati, office closed) | Operations Monitor | LTO advisories: "Resolved in ...". | Filed by DP 4, resolved by Operations Monitor with remarks and the time. |
| (none) | Report an LTO problem | DP 4 | Open the GD1682026902064 job (at LTO pickup): Report an LTO problem: Long queue, remarks, Report. | The advisory shows on the job and in Monitoring; Operations Monitor gets a notification. DP 1 and DP 2 get nothing. |
| (none) | Dates, By day, CSV | Operations Monitor | Dates: Custom, From and To the same day; then By day; then Download CSV. Try a To before From. | The heading shows the dates ("9 Nov to 9 Nov 2026"); By day lists each day per group; the CSV follows the view and filters. A To before From is refused with a message. |
| (none) | Roles: the Monitoring group | Admin | Settings > Roles and access: open Operations Monitor and Finance. | A "Monitoring" group with five switches. Operations Monitor has the two monitors and "Manage LTO advisories"; Finance has none. |

## Exceptions

| PN | Case | Who signs in | What to do | What should happen |
|---|---|---|---|---|
| GD1012026902013 | On hold (LA 1 and LA 2) | LA 1, then LA 2 | Notary is on hold by LA 1 (client's papers); For Entry PPSR by LA 2 (branch head). LA 1: try to resume PPSR. LA 2: Resume PPSR with remarks. | The held work is locked. Only the person who put it on hold resumes it. The hold shows the reason, the remarks as typed, who and when. |
| GD1012026902025 | Hold a supervisor can transfer | Branch Supervisor, then DP 2 | Notary is on hold by DP 1. Supervisor: Transfer hold to DP 2 with a note. DP 2: Resume. | The supervisor can transfer but not resume. After the transfer only DP 2 can resume. |
| GD1012026902026 | Problem at the LTO | DP 1, Admin | DP 1: resolve the problem with a note. Admin: mark it outside our control (before resolving). | The problem shows red until resolved; the history keeps both steps. |
| GD1012026902014 | Pull back before accept | LA 1 | Notary was sent to DP 1, not accepted. Pull it back with a reason. | Back to Ready to send; the papers stay at the branch; gone from DP 1's list; DP 1 is told. |
| GD1012026902017 | Returned to the LA with findings and papers | LA 1 | Notary returned by DP 1 (missing paper: the ID copy). Confirm the papers came back, tick the ID, Send again. | Sending waits until the papers are confirmed back. Sent again, it is Round 2 for the processor. |
| GD1012026902081 | Through the vault gate with a missing paper | LA 1, Operations Monitor | Loan file: the "Missing papers" row. Monitoring: Has missing papers. | Notary and For EDST are done, Valid IDs still missing: For Vault Transmittal, "Complete with exceptions". Monitoring lists the paper and its days missing. No alert and no email. |
| GD1012026902019 | Inactive sender | LA 1 or LA 2 | Home and Open items: the Notary declined by DP 1. | "Sender Inactive LA is inactive": the other LAs of the branch take it over and send it again. |
