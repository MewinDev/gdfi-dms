# GDFI-DMS: project status

As of 18 November 2026 (PHT), after pieces 9, 6, 10a, 7 and 8, with the build order of D-047. Branch `feature/foundation-settings-rbac-myloans`.

Effort is in **developer-days for one experienced developer**. Figures for the foundation pieces are the plan's estimates (`IMPLEMENTATION_PLAN.md`, section 1), adjusted for work already done. Figures for the later modules and go-live are **rough estimates** (no detailed plan yet); they will change once each module is planned.

## Summary

| | Remaining effort |
|---|---|
| Foundation (pieces 10b, 11, 12, real API verification, production scheduler, CI) | **10 to 15 days** |
| Go-live preparation (phase A) | **10 to 15 days** |
| **Phase A go-live: LA, DP and Funds on the live myloans feed** | **20 to 30 days** (about 4 to 6 weeks) |
| v2 modules after the foundation (phases B and C) | **34 to 52 days** |
| **Everything to the last phase** | **54 to 82 days** |

Done so far: pieces 1, 2, 3, 3a, 4 and 5 (the plan estimated 18.5 to 24.5 days for them), plus the calendar fixes (D-042). Last full test run (18 November 2026): every automated test passes; see `docs/HANDOVER.md` for the numbers.

## Foundation pieces (`IMPLEMENTATION_PLAN.md`)

| # | Piece | Status | Remaining (days) |
|---|---|---|---|
| 1 | Sign-in hardening | **Done** | 0 |
| 2 | Permission core: one resolver, 10 roles, per-user overrides and branch access, role and user screens, role migration | **Done** | 0 |
| 3 | Branch scope everywhere; one file route; file access log; cross-branch tests | **Done** | 0 |
| 3a | Product classification by keywords | **Done** | 0 |
| 4 | One working-days calendar: holidays, office closures, saved due dates, pauses (with the D-042 fixes) | **Done** | 0 |
| 5 | Liquidation due date: N working days after the last LTO pickup, per CA / FT; fallback; late record (D-044) | **Done** | 0 |
| 6 | myloans mock APIs 1 to 5 (the agreed contract): one client for mock and real mode, the mock with its own tables, failure simulation, contract tests (mock in every run; staging by hand) | **Done** (18 November 2026, D-047, D-048) | 0 |
| 7 | myloans sync on API 2: checkpoint, paging, superseded copies, duplicates, run log, alerts, the daily catch-up run, released loans not yet in the DMS from the cutoff; nothing applied by itself; the old tiered refresh removed; one entry point for any scheduler (D-052) | **Done** (18 November 2026, D-052) | 0 |
| 8 | Open Items per field: approver queues, Unassigned, superseded and reverted, every move away from Released blocks Forward, monitored fields, waiting time, Reference data changes for renames (D-053) | **Done** (18 November 2026, D-053) | 0 |
| 9 | Accept / Forward engine: movement ledger, branch pool and personal inbox, per-user TAT and waiting time; Correct due date on LA items | **Done** (D-046; built on the loans already in the DMS, with a hook for the feed) | 0 |
| 10a | PN # search on API 1 and the Search Log; Find loan and Refresh on the contract client; identity saved on open; product classification by hand (D-049) | **Done** (18 November 2026, D-049, D-051) | 0 |
| 10b | "Released, not yet in the DMS": connect the feed hook (piece 9) to the branch LA pool | **Next** (plan first) | 1 |
| 11 | Products (API 5) and branches (API 4) | **Waiting for the product list and API 5 (R2-3)** | 2 to 3 |
| 12 | Docs, Manual Test Kit, e2e update, final verification | **Pending** (ongoing with each piece) | 4 to 6 |
| — | CI on GitHub (approved proposal) | **Blocked**: waiting for the GitHub setup (Actions, one secret, branch protection) | 1 |
| — | Real API verification: the contract tests and a sync dry run against myloans staging | **Blocked: myloans staging access (C5)** | 2 to 3 |
| — | Production scheduler for the sync and the daily jobs (cron on the real hosting; the entry point is ready, docs/SCHEDULER.md) | **Blocked: the hosting decision** | 1 |
| | **Foundation remaining** | | **10 to 15** |

**Build order (D-047, replaces D-045):** pieces 9, 6, 10a, 7 and 8 done (18 November 2026); next **10b** (plan first). The order was **6** (mock APIs 1 to 5) → **10a** (PN # search and Search Log, API 1 on the mock) → **7** (sync on API 2) → **8** (Open Items per field) → **10b** (the feed hook to the branch pool) → **11** when the product list (R2-3) arrives → **12** with each piece. Built on the mock; **Real API verification** waits for myloans staging (C5) and the **Production scheduler** for the hosting decision, as separate items.

## Outside decisions and blockers

| Item | Who | Blocks |
|---|---|---|
| myloans: 3 hash test-vector outputs | myloans team | Only the hash test (skipped until then) |
| myloans R2-4: paid / closed source | myloans team | "Loan closed / released" (closure module) |
| myloans staging access (C5) | myloans team, infrastructure | **Real API verification** (pieces 6, 7, 8 and 10 are built on the mock meanwhile, D-047) |
| Hosting decision | Project owner, infrastructure | **Production scheduler** |
| myloans R2-3 (product list, API 5) | myloans team | Piece 11 |
| myloans R2-6 (timings), A4, A5, C2 (limits) | myloans team, infrastructure | Piece 7 going live |
| myloans: do cancel and deactivate always update `updated_at` | myloans team | Confidence in the change feed (round 3 check) |
| D-024 approval bands | Finance | Only whether bands are switched on |
| GitHub setup for CI | Project owner | CI |
| The official holiday list | Admin | Correct due dates in production (only samples are seeded) |

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
| **A** | Foundation (pieces 10b, 11, 12, real API verification, production scheduler, CI) and go-live preparation: production sign-in (Entra), staging, backups and monitoring, first load of open loans (branch pool cutoff), user acceptance testing, training, first weeks of support | 20 to 30 | 20 to 30 |
| **B** | Vault transmittal, Collateral (with vehicle details), Quality Assurance; related-loan tags (additional unit / replacement) return with vehicle data from myloans; the renewal link (previous loan / OldPNNo) (D-051) | 17 to 25 | 37 to 55 |
| **C** | Digital Records, archival and warehousing, closure, retention | 17 to 27 | 54 to 82 |

Phase A can go live without B and C: loans then stop at "For Vault Transmittal" until phase B. Any myloans item still open at that point delays only the parts listed under "Blocks".
