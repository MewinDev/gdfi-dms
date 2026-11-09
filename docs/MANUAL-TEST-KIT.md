# Manual Test Kit

Last updated: 10 November 2026 (PHT)

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

## If the sign-in page keeps coming back

Your browser still has the sign-in of an account from before a reset. Open a private window, or clear the cookies for `localhost:3000` (in Chrome: the lock icon left of the address, then Cookies and site data, then delete), and sign in again.
