# GDFI-DMS: project status

As of 24 November 2026 (PHT), after the Phase A go-live gaps (D-056). Branch `feature/foundation-settings-rbac-myloans`.

Effort is in **developer-days for one experienced developer**. Figures for the foundation pieces are the plan's estimates (`IMPLEMENTATION_PLAN.md`, section 1), adjusted for work already done. Figures for the later modules and go-live are **rough estimates** (no detailed plan yet); they will change once each module is planned.

## Summary

| | Remaining effort |
|---|---|
| Foundation (real API verification, production scheduler, CI) | **4 to 5 days** |
| Go-live preparation (phase A) | **10 to 15 days** |
| Phase A go-live gaps left (`docs/PHASE_A_GAPS.md`: the cloud file driver and myloans OAuth, only if IT's answers need them) | **0 to 3 days** |
| **Phase A go-live: LA, DP and Funds on the live myloans feed** | **14 to 23 days** (about 3 to 5 weeks) |
| v2 modules after the foundation (phases B and C) | **34 to 52 days** |
| **Everything to the last phase** | **48 to 75 days** |

Every foundation piece that can be built on the mock is built, piece 12 included. What is left for phase A: three items that wait for someone outside the team, go-live preparation, and the go-live gaps found by the module checklists (`docs/checklists/README.md`, `docs/PHASE_A_GAPS.md`), which wait for the project owner's decisions. Last full test run (18 November 2026): every automated test passes; see `docs/HANDOVER.md` for the numbers.

## Done

| # | Piece | Done |
|---|---|---|
| 1 | Sign-in hardening | Done |
| 2 | Permission core: one resolver, 10 roles, per-user overrides and branch access, role and user screens, role migration | Done |
| 3 | Branch scope everywhere; one file route; file access log; cross-branch tests | Done |
| 3a | Product classification by keywords; set by hand with a reason and a history; the tick on the LA Supervisor/Head (D-049, D-052) | Done |
| 4 | One working-days calendar: holidays, office closures, saved due dates, pauses (with the D-042 fixes) | Done |
| 5 | Liquidation due date: N working days after the last LTO pickup, per CA / FT; fallback; late record (D-044) | Done |
| 6 | myloans mock APIs 1 to 5 (the agreed contract): one client for mock and real mode, the mock with its own tables, failure simulation, contract tests | 18 November 2026 (D-047, D-048) |
| 7 | The one myloans sync on API 2: checkpoint, paging, superseded copies, duplicates, run log, alerts, the daily catch-up; one entry point for any scheduler (`docs/SCHEDULER.md`) | 18 November 2026 (D-052) |
| 8 | Open Items per field: approver queues, Unassigned, supersede and revert, status outcomes (close, re-link a redo, hold), the top-menu link, waiting time, renames as Reference data changes | 18 November 2026 (D-053) |
| 9 | Accept / Forward engine: movement ledger, branch pool and personal inbox, per-user TAT and waiting time | Done (D-046) |
| 10a | PN # search on API 1 and the Search Log; Find loan and Refresh on the contract client; identity saved on open | 18 November 2026 (D-050, D-051) |
| 10b | Released loans not yet in the DMS in the branch LA pool; waiting from pool entry | 18 November 2026 (D-053) |
| 11 | Branches (API 4) and products (API 5) on the mock, read daily; branches matched by myloans' BranchID; renames and code changes logged; a closed branch keeps its work; a new product notice; the LTO-PASIG sample badge | 18 November 2026 (D-054) |
| 12 | Backups of the database and the files (folder or S3, restore into a clean copy, rehearsed), security headers, volume test (15,000 loans, every screen under 100 ms), go-live runbook with rollback, UAT checklist, role-by-screen and Open Items outcome e2e, module checklists | 18 November 2026 (D-055) |

## Blocked, and by whom

| Item | Waiting for | Who | Effort once unblocked (days) |
|---|---|---|---|
| **Real API verification:** the contract tests and a sync dry run against myloans staging (APIs 1, 2, 4 and 5) | Staging access (C5) | myloans team, infrastructure | 2 to 3 |
| **Production scheduler** for the sync and the daily jobs (the entry point is ready) | The hosting decision | Project owner, infrastructure | 1 |
| **CI on GitHub** (approved proposal) | GitHub setup: Actions, one secret, branch protection | Project owner | 1 |
| Hash test vectors (only the hash test is skipped) | 3 test-vector outputs | myloans team | under 1 |
| Sync timings and limits before going live | R2-6 (timings), A4, A5, C2 (limits) | myloans team, infrastructure | in the dry run |
| Confidence in the change feed | Whether cancel and deactivate always update `updated_at` | myloans team | in the dry run |
| "Loan closed / released" (phase C closure) | R2-4: the paid / closed source | myloans team | in the closure module |
| Approval bands switched on | D-024 | Finance | none (a setting) |
| Correct due dates in production | The official holiday list | Admin | none (data entry) |

## What remains to a Phase A go-live

| Step | What | Days | Depends on |
|---|---|---|---|
| Real API verification | As above | 2 to 3 | Staging access (C5) |
| Production scheduler | As above | 1 | The hosting decision |
| CI | As above | 1 | GitHub setup |
| Go-live gaps | Built 24 Nov 2026 (D-056): receipt confirmation, Cancel transaction, the FT account, the four optional transactions, TAT defaults. Left, only if needed: a cloud file driver and myloans OAuth (G6, G7) | 0 to 3 | IT and myloans (Q10) |
| Go-live preparation | Production sign-in (Entra), staging, backups and monitoring, the first load of open loans (branch-pool cutoff, `npm run sync:myloans -- --first-load`), user acceptance testing, training, the first weeks of support | 10 to 15 | Hosting, Entra setup, a go-live date |
| | **Phase A total** | **14 to 23** | |

## v2 modules after the foundation (rough estimates)

| Module | What it covers | Effort (days) | Phase |
|---|---|---|---|
| Vault transmittal | For Vault Transmittal, in transit, received by Collateral; the vault gate | 5 to 7 | B |
| Collateral (Custodian) | Receive, verify and keep documents; locations; pull-out requests and approval; vehicle details (D-051) | 8 to 12 | B |
| Quality Assurance | QA checks and findings | 4 to 6 | B |
| Digital Records (Digicur) | Scan and scan reference; For NTC / NTE / NOD stages | 5 to 8 | C |
| Archival and warehousing | Boxes, parts, locations, the QR code | 6 to 9 | C |
| Closure | "Loan closed / released" (blocked by myloans R2-4); the paid / closed source and payment recorded (D-051) | 3 to 5 | C |
| Demerit points | Read the liquidation late record (D-044) and the TAT record | in the module that needs them | later |
| Retention | Retention rules and the disposal log | 3 to 5 | C |
| | **v2 modules** | **34 to 52** | |

## Phased go-live

| Phase | Contents | Remaining effort (days) | Cumulative |
|---|---|---|---|
| **A** | Real API verification, production scheduler, CI, the go-live gaps left and go-live preparation (above) | 14 to 23 | 14 to 23 |
| **B** | Vault transmittal, Collateral (with vehicle details), Quality Assurance; related-loan tags (additional unit / replacement) return with vehicle data from myloans; the renewal link (previous loan / OldPNNo) (D-051) | 17 to 25 | 31 to 48 |
| **C** | Digital Records, archival and warehousing, closure, retention | 17 to 27 | 48 to 75 |

Phase A can go live without B and C: loans then stop at "For Vault Transmittal" until phase B. Any myloans item still open at that point delays only the parts listed under "Blocked".

## Release note: piece 12 (D-055), 18 to 19 November 2026

- **Backups:** `npm run backup` / `npm run restore` for the database and the uploaded files together, to a folder or an S3-compatible bucket, with checksums and retention; restore only into a clean copy. Rehearsed: a restored receipt opens through the file route.
- **Security headers** in one place (CSP, HSTS in production, nosniff, frame DENY, Referrer-Policy); the session cookie already complied.
- **Volume test** (`npm run volume`, own database): 15,000 loans; every main screen under 100 ms; nothing needed fixing.
- **Docs:** `docs/GO_LIVE_RUNBOOK.md` (with backups per hosting option and the rollback plan), `docs/UAT_CHECKLIST.md`, one scheduling doc, README, HANDOVER, glossary and LA page brought up to date; no privacy notice (D-055).
- **Tests added:** role by screen, Open Items outcomes (reject, not released then released again, redo), branch pool to loan file, accessibility and phone-width basics; kit sheet items 43 to 45; the simulator can set a loan not released and released again.
- **Module checklists** (`docs/checklists/`) and the gap summary (`docs/PHASE_A_GAPS.md`): proposals and questions only.
- **Last full runs (26 November 2026, D-058 / D-059 / D-060):** vitest 1,399 passed, 1 skipped (the hash test waiting for myloans); e2e (production build, 1 worker) 208 / 208 / 207 passed at 1440 / 820 / 390, 5 test-side failures at each width, fixed and rerun green (see the final-run line below). Earlier (24 November): e2e 211 / 211 / 207 with 1 failure at 390 (monitoring: a fixture due date turned overdue when the run crossed midnight; rerun 10 / 10 passed); the new accessibility spec 15 / 15; tsc and lint clean; permission, secret and migration scans pass.
- **Loan preview fixes (26 November 2026, D-060 review; branch `feat/loan-preview-enhancement`):** a pool item never arrives before the loan's release date (app rule `poolArrival` and migration `20261119090033_pool_arrival_after_release`), one pool waiting wording, the preview page tidied and made compact. Runs: vitest 1,401 passed, 1 skipped; tsc and lint clean; `kit:rebuild` done after the migration; targeted e2e (loans-preview, loans-d059, inbox, ui-refresh readability, axe, find-loan-*, myloans-fields) passed at 1440, 820 and 390. Full e2e: see the final-run line below.


## Release note: Phase A go-live gaps (D-056), 19 to 24 November 2026

- **Built:** DP receipt confirmation for fund transfers (reference, amount, last 4; a mismatch is flagged to Finance, who clears it with remarks; the LTO gate is a Settings switch, off); Cancel transaction (new tick, LA Supervisor/Head and Admin; reason; the job stops; released cash stays owed, said on the confirm step); the FT receiving account typed by the processor at request (full number only on Finance's send form, cleared at release); the four optional transactions with v2's papers; TAT defaults LA 1, DP 5, Finance 1 (migration 032).
- **Docs:** D-056, `docs/BUSINESS_QUESTIONS.md` (every [TO CONFIRM] item, by who answers), checklists, UAT rows SUP-12, DP-11, FIN-9, kit items 46 and 47.
- **Runs (24 November 2026):** vitest 1,380 passed, 1 skipped; tsc and lint clean; targeted e2e passed (cancel-transaction and funds-types at 1440 and 390; due-dates, journey, inbox, stage-map, loan-file-next-step, happy-path at 1440).
- **Compact loan file and loan amounts (27 November 2026, D-062; branch `feat/loan-file-compact`, from `feat/loan-preview-enhancement`):** the summary card (name, status in myloans, due badge, Refresh; PN; six details), one progress per transaction, no "Do this now" card for ordinary work, 36 px paper rows with a "More actions" menu, a compact Send panel, On hold and "Something wrong?" as rows, compact Documents and Journey tabs, pinned tabs, drag-to-close bottom sheets on phones; the new permission "See loan amounts" (`loans:view_amounts`, on for LA, Supervisor, Finance, Admin and Superadmin; without it the server sends no amount: summary, Loans table and cards, preview, search, CSV, API) and data migration `20261119090034_loan_amounts`. Runs: targeted e2e (44 specs: loan file, sheets, Loans, preview, readability, axe and the specs they touch) at 1440 / 1366 / 820 / 390, 604 passed and 15 failed on the first pass, all test-side (an LA now sees amounts in Related loans, the 1366 width in older checks, a short page's sticky tabs, one check before its page opened, one network drop when the PC slept); fixed and rerun green, with a drag test that pressed during the 180 ms spring-back made to wait. vitest 1,401 passed, 1 skipped (one fix: the summary card uses the status helper instead of comparing to 12); tsc and lint clean; `db:create-test` done. **Still to do before merging:** the full e2e (`npm run e2e:groups`, production build) and `npm run kit:rebuild` after migration 034 (it replaces gdfi_dms, so only when the owner runs it; until then `kit:reset` says the baseline is out of date).
- **Final full e2e run (27 November 2026, D-064 DP Jobs page; branch `feat/dp-jobs-enhance-page`; `npm run e2e:groups`, production build, 1 worker, myloans dev timer off, the PC kept awake):** 240 / 238 / 237 passed at 1440 / 820 / 390 (67 specs in 17 groups; skips are width-specific), no failures; peak memory 11.1 GB in the build, 10.3 GB or less in the tests. Before it: the targeted Jobs, DP, Funds, readability and axe specs (and the Inbox, Loans, sidebar, Home and role screens, which share the new pieces) at 1440 / 1366 / 820 / 390: 342 passed, one timing flake (the Loans search as you type), now waiting for the server's answer and passed 5 / 5 at 1440; the new `jobs-compact.spec` with an axe check (rows and the panel open) and 44 px taps on a phone; vitest for the list rules (8) and the docs (52); tsc and lint clean. No migration in D-064. Seen, not changed (already there before this branch): a React "unique key" warning on the Funds page (`FundsRow`).
- **Final full e2e run (27 November 2026, D-063 compact Inbox; branch `feat/enhance-inbox-page`; `npm run e2e:groups`, production build, 1 worker, myloans dev timer off, the PC kept awake):** 231 / 230 / 229 passed at 1440 / 820 / 390 (66 specs in 17 groups; skips are width-specific; peak memory 10.8 GB in the build, 8.6 GB or less in the tests). One failure at each width, test-side: `roles.spec` counted "1 of 4 ticked" in the Loans group, but D-062 added "See loan amounts" (on for the Loan Associate), so a copy of the LA role now has "2 of 5 ticked"; fixed and rerun: 2 / 2 passed at each width. Before it: the targeted Inbox, sheet, Loans, preview, readability and axe specs at 1440 / 1366 / 820 / 390 (237 passed; the 4 failures were a real bug, fixed: a confirm inside a sheet also closed the sheet), the Inbox counts in loans (sidebar badge, tabs, waiting too long, Home) 100 passed at four widths; vitest 1,409 (one calendar test fixed: its "2 days ago" row fell on the fixed holiday an earlier test adds, only on 27 November 2026); tsc and lint clean. No migration in D-063.
- **Final full e2e run (26 November 2026, D-060 review, loan preview fixes; `npm run e2e:groups`, production build, 1 worker, myloans dev timer off, Node 26.13.1 LTS):** 214 / 214 / 213 passed at 1440 / 820 / 390 (64 specs; skips are width-specific), no failures. A first attempt was cut off when Windows (winget) upgraded Node from 24.16 to 26.13.1 during the run; the rerun used a fresh build on Node 26. Before it: `kit:demo` on gdfi_dms, both Angono pool loans arrive on their release date, and the preview, Inbox › Branch pool and the Loans table say "In the branch pool since Nov 23 · 3 working days" and "since Nov 25 · 1 working day". vitest 1,401 passed, 1 skipped (Node 24); tsc and lint clean.
- **Final full e2e run (26 November 2026, D-058 sidebar, D-059 one Loans page, D-060 loan preview; `npm run e2e:groups`, production build, 1 worker, myloans dev timer off):** 208 / 208 / 207 passed at 1440 / 820 / 390 (64 specs; skips are width-specific). The same 5 failed at each width, all test-side: `environment` (`/api/health` said the database was down: on Windows "localhost" tries IPv6 first and the Docker database listens on 127.0.0.1 only, so a fresh server's first connection took 2.1 s against the 2 s limit; the test database URL now uses 127.0.0.1, `lib/env/test-db.ts`, 33 ms); `happy-path` (the sample loans are on Home now); `myloans-mock` (the banner's short phone text); `open-items-outcomes` (no Accept for a pool loan: View details, the preview, the two questions, Open loan file); `pn-branches` (`/search` is now `/loans?q=`). Rerun of those 5 specs with loans-d059, loans-preview and ui-refresh (the Released on column, the PN on one line, the 1280 and 1366 px table check): all passed at each width. Integration `branch-pool` updated for the `/loans?q=` address; vitest 1,399 passed, 1 skipped; tsc and lint clean.
- **Final full e2e run (24 November 2026, production build with self-hosted fonts, D-057; 1 worker):** 214 / 213 / 210 passed at 1440 / 820 / 390. The 11 failures were test-side only: Send now asks for a late reason when the send date has passed (1-day LA checklist TAT, D-056), so the e2e helper `giveLateReason` fills it (lto, sent-and-return, transactions-list); related-loans at 390 failed once and passed on the rerun unchanged; and at 820 the funds row hides the money trail until Details is open, so funds-types opens it before checking the receipt mismatch. Rerun of those 5 specs: 10 / 10 passed at each width (30 / 30).
