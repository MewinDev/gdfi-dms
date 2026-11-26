# 08 PN # search (Find loan, Refresh, search log)

Last updated: 26 November 2026 (PHT)

## A. Purpose and roles

v2 §5.1: the LA finds a loan by PN #; the PN is checked first, then the DMS, and myloans only for a new valid PN. Refresh asks myloans for the latest copy of an open loan file. Every search is logged. Roles: LA, LA Supervisor/Head (search, open), Admin (search, preview).

## B. Checklist

| # | Item | Status | Where | Who | Customizable? | Evidence | UAT check |
|---|---|---|---|---|---|---|---|
| 1 | PN format checked first; a wrong PN never reaches myloans | ✅ Built | Find loan | `loans:search` | PN format | e2e `pn-branches.spec.ts` | Type a short PN |
| 2 | DMS first: a saved PN is its row in the Loans table (Changed by D-059: no separate "Already in the DMS" card), no myloans call, logged as already in the DMS, no duplicate | ✅ Built | Loans | `loans:search` | No | e2e `loans-d059.spec.ts` (26 Nov 2026) | Search an opened PN |
| 3 | Typing searches the DMS and the branch pools only, never myloans (Changed by D-059: the table is the result, from 3 characters, no dropdown) | ✅ Built | Loans search box | `loans:view` | No | e2e `loans-d059.spec.ts` (no log row, no myloans call); volume test: a search 0.05 s at 15,000 loans | Type a name: no myloans call |
| 4 | myloans (API 1) only for a new valid PN; preview card; only Released opens | ✅ Built | Find loan | `loans:search`, `loans:open` | No | e2e `status-card.spec.ts` | UAT LA-4 |
| 5 | One loan file per PN (two people at once: one file) | ✅ Built | n/a | n/a | No | unique PN, `lib/services/loan-file.ts` | n/a |
| 6 | Outside your branches: branch only | ✅ Built | Find loan | n/a | No | module 03 | UAT LA-5 |
| 7 | PN search log: who, PN, what myloans answered, when; CSV | ✅ Built | Reports, PN searches | `reports:pnsearch` (LA Supervisor/Head) | No | D-050, `app/api/reports/pn-searches` | Download the CSV |
| 8 | Refresh from MyLoans on a loan file; changes become Open Items | ✅ Built | Loan file | `loans:refresh` | Refresh on open (minutes) | e2e `myloans-sync.spec.ts` | UAT LA-12 |
| 9 | Identity saved on open (ExternalLoanId, CIN) | ✅ Built | n/a | n/a | No | D-051 | n/a |
| 10 | One Loans page for every role (D-059): one table (cards on a phone), Status chips and Filters (Branch, Assigned to, Late only) with counts, sort (Borrower, Branch, Released on, Amount, Due; the release date its own column from 1440 px, the Loan cell's second line below, so the table fits at 1280 and 1366 px), 25 / 50 a page, all in the address; pool rows only in a search or the Not yet in DMS filter, with View details (D-060, no Accept); a full PN found nowhere here: myloans once (Found in myloans, or the reason), logged; `/search` redirects | ✅ Built | Loans | `loans:view`; myloans: `loans:search` | No | `lib/ui/loan-list.test.ts`; e2e `loans-d059.spec.ts` at 1440, 820, 390 (26 Nov 2026); volume: default list 0.25 s (Admin, 15,000 loans) | Search a full PN not opened yet: Found in myloans |
| 11 | Loan preview of a released loan not yet in the DMS (D-060): `/loans/preview/<PN>` and the full-PN Found in myloans card: name, PN with Copy, the "myloans · Not yet in DMS" badge, CIN, branch, product, loan type, classification ("classified by default"), amount, release date, status in myloans, waiting time; Open loan file and Refresh from myloans (logged); 404 outside the branches; the reason card when no longer released | ✅ Built | Loan preview | `loans:view`; myloans: `loans:search`; open: `loans:open` | No | e2e `loans-preview.spec.ts` at 1440, 820, 390 (26 Nov 2026) | Open a pool loan's View details |

## D. Known limits and open questions

- Search by CIN, CIF or name is DMS-only (saved files); myloans is searched by full PN only, as v2 says.
