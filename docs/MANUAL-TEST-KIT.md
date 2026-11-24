# Manual Test Kit

Last updated: 24 November 2026 (PHT)

Test GDFI DMS by hand from zero. The kit puts your own database (`gdfi_dms`) in a clean state: the settings, the branches and the sign-in accounts below, and a list of PNs that exist only in the sample MyLoans. Nothing is opened yet: you search each PN and open it yourself. The automated tests use another database (`gdfi_dms_test`).

## Start and reset

Run these in PowerShell, in the project folder. Each one says what it will do, asks you to type RESET before it replaces anything, and takes a backup first.

| Command | What it does |
|---|---|
| `npm run kit:start` | Loads the clean kit. The first time it builds it (about a minute); after that it restores it (a few seconds). Says "Loaded: CLEAN kit". |
| `npm run kit:reset` | Back to the clean kit. |
| `npm run kit:rebuild` | Builds the clean kit again (needed after a new migration). |
| `npm run kit:backup -- my-name` | Saves what is there now as `my-name`. |
| `npm run kit:restore -- my-name` | Puts a backup back. |
| `npm run kit:list` | Which kit is loaded, the saved kits and the backups. |
| (Settings, System) | **myloans mock**: switch a failure on (for example API 1 Unavailable, next call only), add a scenario, or Reset the mock data. Every page shows "MOCK myloans data" while the mock is on. See [myloans mock and contract](myloans/mock-and-contract.md). |
| `npm run kit:demo` | Adds a few aged Inbox items to the clean kit (red, amber, Paused, and two loans waiting in the Angono pool) for the [demo script](DEMO_SCRIPT.md). |

Add `-- --with-scenarios` to `kit:start`, `kit:reset` or `kit:rebuild` to load the old scenario data instead (see [Manual Test Kit: scenarios](MANUAL-TEST-KIT-SCENARIOS.md)). The first time the clean kit replaces your data, the backup is called `before-clean-kit`.

The same Reset to clean kit, Reset with scenarios, Backup now and Restore are in **Settings > Test kit** (Admin). It runs only on this PC with `APP_ENV=local` and `TEST_MODE=true`, and it never sends email.

## Sign-in accounts

Sign in at `/login`, under **Test sign-in**. The accounts are grouped by role, with the branches under each name.

| Account | Role | Branch access |
|---|---|---|
| Superadmin | Superadmin | All branches |
| Superadmin Two | Superadmin | All branches |
| Admin | Admin | All branches |
| Finance | Finance | All branches |
| Approver (small amounts) | Approver (lowest band) | All branches |
| Approver (large amounts) | Approver (higher band) | All branches |
| Finance Cash | Finance (cash advance) | All branches |
| Finance Transfer | Finance (fund transfer) | All branches |
| Approver (cash advances) | Approver (cash advance) | All branches |
| Approver (fund transfers) | Approver (fund transfer) | All branches |
| Operations Monitor | Monitoring (read-only) | All branches |
| LA Supervisor/Head | LA Supervisor/Head | Antipolo and Angono |
| LA Supervisor/Head Luzon 1 | Supervisor (LA Supervisor/Head role) | Whole Luzon 1 area plus Alaminos |
| LA Antipolo | Loan Associate | Antipolo (101) |
| LA Angono | Loan Associate | Angono (165) |
| LA A. Mabini | Loan Associate | A. Mabini (168) |
| LA Alaminos | Loan Associate | Alaminos (390) |
| LA Luzon 1 | Loan Associate | All of Luzon 1 except Amang Rodriguez |
| Roving LA | Loan Associate | All branches |
| LA No Refresh | LA (no refresh) | Antipolo (101) |
| Receiving LA Antipolo | Receiving LA (Loan Associate role) | Antipolo (101) |
| Receiving LA A. Mabini | Receiving LA (Loan Associate role) | A. Mabini (168) |
| DP 1 | Document Processor | Antipolo and Angono |
| DP 2 | Document Processor | Antipolo and Angono |
| DP 3 | Document Processor | A. Mabini (168) |
| DP 4 | Document Processor | Alaminos (390) |
| Vault | Vault | All branches |
| Digital Records | Digital Records | All branches |
| QA | QA | All branches |
| LA Inactive | Loan Associate (inactive) | Antipolo (101) |

## PNs to try

### Antipolo (101)

- GD1012026903001
- GD1012026903002
- GD1012026903003
- GD1012026903004
- GD1012026903005
- GD1012026903006
- GD1012026903007
- GD1012026903008
- GD1012026903009
- GD1012026903010
- GD7772026903011
- GD1012026903041
- GD1012026903042
- GD1012026903043
- GD1012026903044

### Angono (165)

- GD1652026903012
- GD1652026903013
- GD1652026903014
- GD1652026903015
- GD1652026903016
- GD1652026903017
- GD1652026903018
- GD1652026903019

### A. Mabini (168)

- GD1682026903020
- GD1682026903021
- GD1682026903022
- GD1682026903023
- GD1682026903024
- GD1682026903025

### Alaminos (390)

- GD3902026903026
- GD3902026903027
- GD3902026903028
- GD3902026903029
- GD3902026903030
- GD3902026903031

### Amang Rodriguez (174)

- GD1742026903032
- GD1742026903033

### Cainta (102)

- GD1022026903034

### Binangonan (123)

- GD1232026903035

### Marikina (104)

- GD1042026903036

### Marcos Highway (163)

- GD1632026903037

### Mandaluyong (147)

- GD1472026903038

### Libis (155)

- GD1552026903039

### Alicia-Inactive (718)

- GD7182026903040

Answers, only if you get stuck: [what each PN is](MANUAL-TEST-KIT-ANSWERS.md).

## Things to check (10 November 2026)

Use any opened loan with a job sent to a processor. What you should see is in the [answers](MANUAL-TEST-KIT-ANSWERS.md#things-to-check-10-november-2026).

1. **Approve asks first.** As a processor, request a cash advance; as the approver, press **Approve** on Funds, To approve. Try **Cancel**, **Esc**, then **Approve** (also a quick double tap). Then open **Change amounts** on another request, lower an amount and press Approve.
2. **Request numbers.** Request one **Cash advance** and one **Fund transfer**. As Finance, **Change type** on one of them before release, then search Funds for its old number.
3. **Print liquidation report.** As Admin, untick **Print liquidation report** on the Approver (small amounts) role. Sign in as Approver (small amounts) and look for Print on Outstanding and History, then open a liquidation report link. Tick it back afterwards.
4. **Moving a hold.** Put a transaction of an Angono or Antipolo loan on hold as its LA. Sign in as **Finance**, then as **LA Supervisor/Head**, then as **LA Supervisor/Head Luzon 1**, and look for **Transfer hold**.
5. **Who can move holds.** As Admin, open Settings, Roles and read the top of the list. Untick **Move a hold to another person** on Admin and look again; tick it back afterwards.
6. **Journey filters.** On any loan's Journey, Story, look at the filter row.

### Funds handled by different people

7. **Finance Cash.** Sign in as Finance Cash (after a processor has asked for one cash advance and one fund transfer): look through Funds (every tab, the counts, the search, Download CSV) and Home.
8. **Finance Transfer.** Do the same as Finance Transfer.
9. **Approver (cash advances) and Approver (fund transfers).** Sign in as each one and open Funds, To approve. Each role shares its own type's approval bands (with Approver (small amounts) and Approver (large amounts)), so nothing needs setting up.
10. **Nobody can release fund transfers.** As Admin, untick **Release fund transfers** on every role that has it (Settings, Roles). Look at Settings, Funds types, at Settings, Roles and at Funds. Tick it again on Finance and look once more.

### Missing papers

11. **Missing papers.** On Check papers, press **Missing** on a required paper and try to Send; then write the reason and remarks and Send. Tick **Include in this file** on an optional paper and mark it Missing too. As the processor, open the job: the paper is in **Review the papers** as an amber **Missing** row with no tick box; press **Accept**, then try to return the file for that paper. Try it also with a paper you ticked first (it gets a Document ID) and then marked Missing. When it arrives, mark it **Received**. Check the Loan File row, the Journey and Monitoring, **Has missing papers**.
12. **The reason and remarks box.** Press **Missing** on a required paper, pick a reason, type a short note and press Enter. Then press **Edit**, change it and press Esc. Try it on a phone too.

### Labels (removed 11 November 2026)

13. **No labels.** Check the papers of a transaction and send it, then accept it as the processor. Look for anything about labels on Check papers, the Loan File (To do and Documents), the processor's job page and Settings, Roles.

| Item | Status |
|---|---|
| Print labels, the labels warning, "Labels printed" chips, "Labels are on all papers" at Accept, the Print labels permission | Removed |
| Archiving and Warehousing QR code (vault, box, part, specific numbers) | Not built |

### Find a loan (11 November 2026)

14. **Find a loan, compact.** As **LA Angono**, open `/search` and look at the page: the search row, the sample loans, then search an Angono PN that asks the two questions (Auto Financing). Try **Open loan file** before answering, then answer both. Do it on a phone too.
15. **Outside your branches.** As **LA Angono**, type an Alaminos PN (GD390...) in the search box and press **Find loan**. Then type a PN that is not in MyLoans (any Angono PN from the list with its last four digits changed to 9999) and press **Find loan**.
16. **The result follows the box.** Search any PN, then change one character in the box, or pick a sample loan.

### MyLoans account details (11 November 2026)

17. **Find a loan, account details.** As **LA Angono**, find any Angono PN from the list above and read the card: the chips and the two rows of details.
18. **More loan details.** Open that loan file, then open **More loan details** under Loan at a glance.
19. **Feed quality (Admin).** As **Admin**, open Settings, MyLoans sync and read **Account details missing**. Then find an Angono PN on Find a loan as Admin.

### Find a loan, local first (11 November 2026)

20. **Typing stays in the DMS.** As **LA Angono**, open one Angono PN from the list (Find loan, answer the questions if asked, **Open loan file**). Go back to **My loans** and type the first 8 characters of that PN in the search box, then part of the borrower's name, then a few random letters. Use the arrow keys and Enter on a row, and Esc.
21. **Already in the DMS.** On `/search`, type the whole PN of the loan file you opened and press **Find loan**. Read the card, then press **Open loan file**. Try **Cancel** too.
22. **A full PN not opened yet.** Type the whole PN of another Angono loan from the list that nobody opened yet. Wait for the dropdown, then press **Find loan**.
23. **Part of a PN or a name, with the button.** Type the first 8 characters of an Angono PN and press **Find loan**. Then type a name nobody has (for example "Zzz Nobody") and press **Find loan**.
24. **Outside your branches while typing.** As **LA Angono**, type the whole PN of a loan that **LA Antipolo** opened (open one as LA Antipolo first) and wait for the dropdown. Then type part of that borrower's name.
25. **Refresh when found (Admin).** As **Admin**, open Settings, MyLoans sync and find the setting for a saved loan found on Find a loan. Change it, save, and read it again.
26. **Two people, one PN.** In two browsers (one private window), sign in as **LA Angono** and **Roving LA**. Both find the same Angono PN that nobody opened yet and answer the questions. Press **Open loan file** in both, as close together as you can.
27. **Without GD.** Type the PN of a loan file you opened without the GD (the 13 digits only) and press **Find loan**. Then do the same with an Angono PN from the list that nobody opened yet.

### MyLoans status (12 November 2026)

28. **Not released, cancelled, not a loan.** As **Admin**, open Settings and turn on **Show data-check test PNs**. As **LA Angono**, open `/search` and, under Data-check samples, pick the one whose tooltip says "Check Prepared", then press **Find loan**. Do the same with the "For Approval (Loan Released)", "status 49" and "disbursement-check record" samples. Then, as **LA Antipolo**, pick the "Cancelled" sample. Try it on a phone too. Turn the setting off again when done.
29. **Cancelled, outside your branches.** As **LA Angono**, pick the "Cancelled" sample (an Antipolo loan) and press **Find loan**.

### MyLoans sync check (12 November 2026)

Before these, as **Admin**, turn on the test simulator in Settings, System. "Simulate a MyLoans change" is on the Journey tab of a loan file (Admin).

30. **Borrower details (Open Items).** As **LA Angono**, open an Angono PN from the list, tick the Notary papers and send one transaction to a processor. As **Admin**, on its Journey tab, simulate "Change the borrower name". As **LA Angono**, open the loan file and read the banner. As **LA Supervisor/Head**, open **Open Items** from Home and approve it with remarks. Then, as Admin, simulate "Change the borrower's CIF" and, as LA Supervisor/Head, **Reject** it. Press **Refresh from MyLoans** afterwards.
31. **Amount and branch.** On another Angono loan, as Admin, simulate "Change the amount". As LA Angono, open Check documents for Mortgage and Notary. As Admin, open Open Items for that PN and press **Reject** without remarks, then with some. On an Antipolo loan (LA Antipolo opens it), simulate "Move the loan to another branch" and approve it as Admin on Open Items; then look for the loan as LA Antipolo and as LA Angono.
32. **Pause MyLoans calls.** As **Admin**, Settings, MyLoans sync: press **Pause MyLoans calls**, then **Run now**. Open a loan file. Then turn MyLoans calls back on. As **Finance**, look for the same switch.
33. **Area name (a rename).** As Admin, simulate "Correct the area name (minor)" on any loan, open its Journey tab, then Settings, Reference data changes.

34. **Return the cash and remarks.** On a loan with cash out, as Admin simulate "Set the loan cancelled". Read the loan file. Open Open Items for that PN and press **Ask for the cash back** without remarks, then with 4 characters, then with more. Try **Approve** on its status item. Try **Reject** on another Open Item with 4 characters.
35. **Replacement at another branch.** As Admin, on a cancelled Angono loan whose borrower has a new loan at Antipolo (Related loans), open the Link form and read it before linking.
36. **The sync from the console.** Run `npm run sync:myloans -- --now` in PowerShell, then open Settings, MyLoans sync and read the Run log.


### Find a loan card and rule names (12 November 2026)

37. **The answer buttons.** As **LA Angono**, find an Angono PN from the list that asks the two questions (Auto Financing, Renewal) and nobody opened yet. Look at the card before answering, then choose **Non-Undertaking**, then **Undertaking**, click it again, use the arrow keys, and choose **Untransferred**, then **Transferred**. Read the line beside **Open loan file** each time. Then press **Open loan file**, open **More loan details** and read the last line.
38. **Refinancing and the status card.** As **Admin**, find a PN from the list with no questions (Auto Refinancing) and read "What will be set up". Then, with **Show data-check test PNs** on, pick the "Check Prepared" sample and press **Find loan**.

### Home, compact (12 November 2026)

39. **Home for each role.** Sign in as **LA Angono** with nothing opened and look at Home. Open two Angono loans from the list, go back to Home, and look again. Then look at Home as **Admin**, as a Document Processor and as Finance (test mode sign-in), and on a phone.

### My loans, compact (12 November 2026)

40. **My loans.** As **LA Angono**, open **My loans** with nothing opened, then open three Angono loans from the list and come back. Open each tab, set a filter (Loan type), remove it, open the Sample loans row and pick one, and type part of a PN in the box. Then look at **Loans** as **Admin**, and both on a phone.

### The Loans table (12 November 2026)

41. **The Loans table.** As **Admin**, open **Loans**, All loans, with a few loan files opened at different steps (open one, send one to a processor). Read a row from left to right, open **Group by area and branch**, and look at it on a phone.

### Stage names and next steps (12 November 2026)

42. **The new stage names.** As **LA Angono**, open a loan file and read the progress line at the top; finish or send every transaction (EDST done, the others sent to a processor) and read it again. Open **My loans** and hover the Next step of a few rows. Then as **Admin** open **Loans**, All loans, read the Stage and Next step columns and hover a Next step. Look at the loan file on a tablet and a phone too.

### Open Items: what approving a status does (18 November 2026)

43. **Not released, then released again.** As LA Angono open an Angono PN. As Admin, on its Journey tab, simulate "Set the loan not released", then press **Refresh from MyLoans**. On Open Items, read the status card (what approving does is said first) and **Approve** with remarks. As LA Angono, try **Send** on the loan file. As Admin, simulate "Set the loan released again" and press **Refresh from MyLoans**; read the loan file again.
44. **A redo (new PN).** As LA Angono open another Angono PN and tick a few papers. As Admin, simulate "Create a replacement PN". On Open Items, read the status card, then **Approve** with remarks. Look for the loan by the old PN and by the new PN.
45. **Branch pool to loan file.** After `npm run kit:demo`, as LA Angono open **Inbox, Branch pool**: press **Accept** on the first released loan waiting there, then open it from **My items** and **Open loan file**. Look at the pool again.

### Phase A gaps (24 November 2026)

46. **Cancel a transaction.** As LA Angono, send a transaction of an Angono loan to a processor; as that processor, accept it and ask for funds; as Finance, approve and release. Then as **LA Supervisor/Head**, open the loan file, press **Cancel transaction**, read the confirm step, press it once without a reason, then with one. Look for the same button as LA Angono.
47. **Fund transfer and its receipt.** As a processor with an accepted job that needs funds, ask for a **Fund transfer**: fill in the bank or e-wallet, the account name and the account number. As Finance, open **Send** on it and read the account; send it with and without the tick. As the processor, on My funds, confirm the receipt with a wrong amount, then look at Funds, Outstanding as Finance and clear it.

## If the sign-in page keeps coming back

Your browser still has the sign-in of an account from before a reset. Open a private window, or clear the cookies for `localhost:3000` (in Chrome: the lock icon left of the address, then Cookies and site data, then delete), and sign in again.
