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
| 8 | Refresh from MyLoans on a loan file; changes become Open Items (D-062: an icon button in the loan summary header, its tooltip "Refresh from myloans · last checked <date, time>", the answer beside it) | ✅ Built | Loan file, summary header | `loans:refresh` | Refresh on open (minutes) | e2e `myloans-sync.spec.ts`; `loan-file-layout.spec.ts` (keyboard, tooltip, answer) | UAT LA-12 |
| 9 | Identity saved on open (ExternalLoanId, CIN) | ✅ Built | n/a | n/a | No | D-051 | n/a |
| 10 | One Loans page for every role (D-059): one table (cards on a phone), Status chips and Filters (Branch, Assigned to, Late only) with counts, sort (Borrower, Branch, Released on, Amount, Due; the release date its own column from 1440 px, the Loan cell's second line below, so the table fits at 1280 and 1366 px), 25 / 50 a page, all in the address; pool rows only in a search or the Not yet in DMS filter, with View details (D-060, no Accept); a full PN found nowhere here: myloans once (Found in myloans, or the reason), logged; `/search` redirects | ✅ Built | Loans | `loans:view`; myloans: `loans:search` | No | `lib/ui/loan-list.test.ts`; e2e `loans-d059.spec.ts` at 1440, 820, 390 (26 Nov 2026); volume: default list 0.25 s (Admin, 15,000 loans) | Search a full PN not opened yet: Found in myloans |
| 11 | Loan preview of a released loan not yet in the DMS (D-060): `/loans/preview/<PN>` and the full-PN Found in myloans card: name, PN with Copy, CIN, branch, product, loan type, classification ("classified by default"), amount, release date; "In the branch pool since <date> · <N> working days" (from the arrival; the same words on Inbox › Branch pool and the Loans table tooltip and cards); Open loan file and Refresh from myloans (a compact icon button with a popover at the top right of the card, after the chip and badge; logged); 404 outside the branches; the reason card when no longer released. Review (26 Nov 2026): no badge beside the subtitle; the card's top right has the "Loan Released" chip, the "myloans · Not yet in DMS" badge and the Refresh icon button; the card is compact (14 px details, 24 px chips, 36 px buttons from 768 px, 44 px to tap on a phone); no "Status in myloans" field; the two questions show no warning until Open loan file is pressed, and the hint "Answer both questions to open the loan file" sits right beside the disabled button. A pool item never arrives before the loan's release date (app `poolArrival` and the database triggers of migration `20261119090033`; the kit demo moved arrivals back without looking at it) | ✅ Built | Loan preview | `loans:view`; myloans: `loans:search`; open: `loans:open` | No | e2e `loans-preview.spec.ts` at 1440, 820, 390; integration `branch-pool.test.ts` (arrival rule); `lib/work/rules.test.ts` (26 Nov 2026) | Open a pool loan's View details |

## D. Known limits and open questions

- Search by CIN, CIF or name is DMS-only (saved files); myloans is searched by full PN only, as v2 says.
