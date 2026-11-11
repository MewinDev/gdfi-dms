# MyLoans account details: field map

MyLoans is the source of truth for a loan's account details. This page lists the 15 items the DMS receives, keeps and shows, where each comes from in the MyLoans team's source query, where it is stored, where it is shown and how a change to it is treated.

Last updated: 11 November 2026 (PHT)

- **Source query (reference only):** [released-loans-source.sql](released-loans-source.sql). It defines the read-only view the MyLoans team will expose behind the API. The DMS never runs it and never connects to MYLOSDB or MYLMSDB.
- **One place knows MyLoans names:** `lib/myloans/live-mapping.ts` (`mapLoan`). The rest of the DMS uses the normalized record (`MyLoansRecord`, `lib/myloans/types.ts`).
- **Never read:** `BirthDate`, `TitleId`.
- **Stored with every copy:** the loan file keeps the values MyLoans gave when it was opened (the columns below). Every saved copy (`LoanSourceSnapshot`) keeps the whole answer in `payload`, the compared values in `tracked`, and `source` ("MyLoans").
- **Access is unchanged:** branch access uses the DMS branch records (`Loan.branchId`). The MyLoans branch, area, division and company kept on the loan are display copies only.

## The 15 items

| # | Item | MyLoans alias | DMS (Loan column) | Shown on | Change class |
|---|---|---|---|---|---|
| 1 | PN | `PNNo` | `pn` | Both | Key (a PN never changes; a new PN is a replacement) |
| 2 | Source loan ID | `ExternalLoanId` | `sourceLoanId` | Loan file | Material |
| 3 | CIN | `CIN` | `cin` | Loan file | Minor (existing class) |
| 4 | CIF | `CIFNo` | `cif` | Loan file | Minor (existing class) |
| 5 | Borrower name | `FirstName`, `MiddleName`, `LastName`, `Suffix`; else `BorrowerCompanyName` | `borrowerName` | Both | Minor (existing class) |
| 6 | Amount released | `TotalLoanAmount` | `totalReleasedAmount` | Both | Material |
| 7 | Released date | `ReleaseDate` | `releasedAt` | Both | Material |
| 8 | Loan type | `LoanType` | `loanType` | Both | Material |
| 9a | Product name | `ProductName` | `productName` | Both | Material |
| 9b | Product code | `ProductCode` | `productCode` | Loan file | Material |
| 10a | Branch code | `BranchCode` | `sourceBranchCode` | Loan file | Material |
| 10b | Branch name | `BranchName` | `sourceBranchName` | Both | Material |
| 11a | Area ID | `AreaId` | `sourceAreaId` | Loan file | Minor |
| 11b | Area name | `AreaName` | `sourceAreaName` | Both | Minor |
| 12a | Division ID | `DivisionId` | `sourceDivisionId` | Loan file | Minor |
| 12b | Division name | `DivisionName` | `sourceDivisionName` | Both | Minor |
| 13a | Company ID | `CompanyID` | `sourceCompanyId` | Loan file | Minor |
| 13b | Company name | `CompanyName` | `sourceCompanyName` | Both | Minor |
| 14a | Transaction status ID | `TransactionStatusId` | `sourceStatusId` | Loan file | Status |
| 14b | Transaction status name | `TransactionStatusName` (to confirm: not in the query yet) | `sourceStatusName` | Both (Find a loan: the name only) | Status |
| 15 | Source | none (always "MyLoans") | `source` (Loan and LoanSourceSnapshot) | Both | Not compared |

Also kept, not one of the 15: `TransactionIsActive` → `sourceIsActive` (loan file, Status class) and `SourceUpdatedAt` → `sourceUpdatedAt` (loan file, "Last updated in MyLoans"; updated on every answer, not compared).

**Borrower name rule** (`composeBorrowerName`, `lib/myloans/borrower-name.ts`): First Middle Last Suffix, empty parts skipped and spaces collapsed; when the personal parts are all empty, the company name.

**Status** (`lib/myloans/status.ts`): until MyLoans sends `TransactionStatusName`, one small lookup names status 12 "Loan Released". Any other number shows as "Status 7" and counts as not released (the Data Check refuses it). Find a loan shows the name, never the number.

**Data Check:** unchanged blockers (released status, release date, loan type New or Renewal, amount above 0, the person's branch). New warnings, never blockers: product name or code empty, area, division or company missing. Admin sees them on Find a loan ("Data check (Admin)") and, as counts across loan files, on Settings, MyLoans sync ("Account details missing").

**Change classes:** Minor updates the copy with no review. Material and Status raise a review for Admin, as before. The brief assumed borrower name, CIN and CIF would be Material; they were already Minor, so they stay Minor (say if they should change).

## Where it is shown

- **Find a loan** (names only, no codes or IDs): borrower name, PN and product in the header; the status name, "Your branch", "Details complete" and "Source: MyLoans" as chips; amount released, released on, loan type, product, branch, area, division and company in two rows of four.
- **Loan file, More loan details** (collapsed): Identity (PN, source loan ID, CIN, CIF), Loan (borrower name, amount released, released on, loan type, product name, product code), Organization (company, division, area and branch, each "ID · name"), Status (status ID, status name, active), Source (MyLoans, retrieved at, last checked, last updated in MyLoans, opened at), and the rule that fired. The only everyday screen that shows branch code, area ID, division ID, company ID and status ID.

## Questions for MyLoans

1. `TotalLoanAmount` is a SUM over all loan computation rows of a transaction. If a transaction has several versions, the amount is overstated. Is it the released amount, and is there one active computation per transaction?
2. `ReleaseDate` is the latest `loan_released_date` in the PDC table. Is it the real release date? Can it be empty for status 12?
3. Is `T.branch_id` the branch where the loan was released, or the current branch? Can it change after release? Does it match the branch digits in the PN?
4. The query only returns status 12, so a loan that is later cancelled or replaced disappears. The feed must return the loan with its current status (ID and name) and the DMS decides what to accept. Which status IDs exist and what are their names?
5. Can a PN appear twice? The join on `CIN = LEFT(application_code, 20)` can duplicate rows if a CIN repeats in the origination table.
6. Where are the address, contact number, plate, chassis and engine numbers, and the old PN a replacement replaces? (Not in this query. The DMS treats them as optional for now.)
7. A read-only view on a replica is preferred, with the cross-database join and the collation casts inside it.
