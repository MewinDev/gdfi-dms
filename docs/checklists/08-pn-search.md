# 08 PN # search (Find loan, Refresh, search log)

Last updated: 18 November 2026 (PHT)

## A. Purpose and roles

v2 §5.1: the LA finds a loan by PN #; the PN is checked first, then the DMS, and myloans only for a new valid PN. Refresh asks myloans for the latest copy of an open loan file. Every search is logged. Roles: LA, LA Supervisor/Head (search, open), Admin (search, preview).

## B. Checklist

| # | Item | Status | Where | Who | Customizable? | Evidence | UAT check |
|---|---|---|---|---|---|---|---|
| 1 | PN format checked first; a wrong PN never reaches myloans | ✅ Built | Find loan | `loans:search` | PN format | e2e `pn-branches.spec.ts` | Type a short PN |
| 2 | DMS first: a saved PN shows the "Already in the DMS" card, no myloans call, no duplicate | ✅ Built | Find loan | `loans:search` | No | e2e `find-loan-card.spec.ts` | Find an opened PN |
| 3 | Typing suggests DMS loan files only (from 3 characters, at most 8) | ✅ Built | Find loan box | `loans:search` | No | e2e `find-loan-local-first.spec.ts`; volume test 4 ms | Type "GD165" |
| 4 | myloans (API 1) only for a new valid PN; preview card; only Released opens | ✅ Built | Find loan | `loans:search`, `loans:open` | No | e2e `status-card.spec.ts` | UAT LA-4 |
| 5 | One loan file per PN (two people at once: one file) | ✅ Built | n/a | n/a | No | unique PN, `lib/services/loan-file.ts` | n/a |
| 6 | Outside your branches: branch only | ✅ Built | Find loan | n/a | No | module 03 | UAT LA-5 |
| 7 | PN search log: who, PN, what myloans answered, when; CSV | ✅ Built | Reports, PN searches | `reports:pnsearch` (LA Supervisor/Head) | No | D-050, `app/api/reports/pn-searches` | Download the CSV |
| 8 | Refresh from MyLoans on a loan file; changes become Open Items | ✅ Built | Loan file | `loans:refresh` | Refresh on open (minutes) | e2e `myloans-sync.spec.ts` | UAT LA-12 |
| 9 | Identity saved on open (ExternalLoanId, CIN) | ✅ Built | n/a | n/a | No | D-051 | n/a |

## D. Known limits and open questions

- Search by CIN, CIF or name is DMS-only (saved files); myloans is searched by full PN only, as v2 says.
