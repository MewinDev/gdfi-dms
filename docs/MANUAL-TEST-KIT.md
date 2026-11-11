# Manual Test Kit

Last updated: 11 November 2026 (PHT)

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

Add `-- --with-scenarios` to `kit:start`, `kit:reset` or `kit:rebuild` to load the old scenario data instead (see [Manual Test Kit: scenarios](MANUAL-TEST-KIT-SCENARIOS.md)). The first time the clean kit replaces your data, the backup is called `before-clean-kit`.

The same Reset to clean kit, Reset with scenarios, Backup now and Restore are in **Settings > Test kit** (Admin). It runs only on this PC with `APP_ENV=local` and `TEST_MODE=true`, and it never sends email.

## Sign-in accounts

Sign in at `/login`, under **Test sign-in**. The accounts are grouped by role, with the branches under each name.

| Account | Role | Branch access |
|---|---|---|
| Admin | Admin | All branches |
| Finance | Finance | All branches |
| Approver Small | Approver (lowest band) | All branches |
| Approver Large | Approver (higher band) | All branches |
| Finance Cash | Finance (cash advance) | All branches |
| Finance Transfer | Finance (fund transfer) | All branches |
| Approver Cash | Approver (cash advance) | All branches |
| Approver Transfer | Approver (fund transfer) | All branches |
| Operations Monitor | Operations Monitor | All branches |
| Branch Supervisor | Branch Supervisor | Antipolo and Angono |
| Area Supervisor Luzon 1 | Supervisor (Branch Supervisor role) | Whole Luzon 1 area plus Alaminos |
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
3. **Print liquidation report.** As Admin, untick **Print liquidation report** on the Approver Small role. Sign in as Approver Small and look for Print on Outstanding and History, then open a liquidation report link. Tick it back afterwards.
4. **Moving a hold.** Put a transaction of an Angono or Antipolo loan on hold as its LA. Sign in as **Finance**, then as **Branch Supervisor**, then as **Area Supervisor Luzon 1**, and look for **Transfer hold**.
5. **Who can move holds.** As Admin, open Settings, Roles and read the top of the list. Untick **Move a hold to another person** on Admin and look again; tick it back afterwards.
6. **Journey filters.** On any loan's Journey, Story, look at the filter row.

### Funds handled by different people

7. **Finance Cash.** Sign in as Finance Cash (after a processor has asked for one cash advance and one fund transfer): look through Funds (every tab, the counts, the search, Download CSV) and Home.
8. **Finance Transfer.** Do the same as Finance Transfer.
9. **Approver Cash and Approver Transfer.** Sign in as each one and open Funds, To approve. Each role shares its own type's approval bands (with Approver Small and Approver Large), so nothing needs setting up.
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

## If the sign-in page keeps coming back

Your browser still has the sign-in of an account from before a reset. Open a private window, or clear the cookies for `localhost:3000` (in Chrome: the lock icon left of the address, then Cookies and site data, then delete), and sign in again.
