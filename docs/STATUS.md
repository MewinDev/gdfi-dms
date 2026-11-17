# GDFI-DMS: project status

As of 18 November 2026 (PHT), after piece 9, with the new build order (D-045). Branch `feature/foundation-settings-rbac-myloans`.

Effort is in **developer-days for one experienced developer**. Figures for the foundation pieces are the plan's estimates (`IMPLEMENTATION_PLAN.md`, section 1), adjusted for work already done. Figures for the later modules and go-live are **rough estimates** (no detailed plan yet); they will change once each module is planned.

## Summary

| | Remaining effort |
|---|---|
| Foundation (pieces 6 to 8 and 10 to 12, plus CI) | **23 to 31 days** |
| Go-live preparation (phase A) | **10 to 15 days** |
| **Phase A go-live: LA, DP and Funds on the live myloans feed** | **33 to 46 days** (about 7 to 9 weeks) |
| v2 modules after the foundation (phases B and C) | **34 to 52 days** |
| **Everything to the last phase** | **67 to 98 days** |

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
| 6 | myloans mock APIs 1 to 5 (the agreed contract) | **On hold, waiting for myloans staging access (C5)**. Partly done: contract, hash, mock and sync planning are built and tested as code | 2 |
| 7 | myloans sync on API 2: checkpoint, paging, superseded copies, duplicates, run log, alerts | **On hold, waiting for myloans staging access (C5)**; also needs limits (C2) and timings (R2-6) | 5 to 7 |
| 8 | Open Items per field: approver queues, Unassigned, superseded, cancellations, monitored fields | **On hold, waiting for myloans staging access (C5)** | 7 to 9 |
| 9 | Accept / Forward engine: movement ledger, branch pool and personal inbox, per-user TAT and waiting time; Correct due date on LA items | **Done** (D-046; built on the loans already in the DMS, with a hook for the feed) | 0 |
| 10 | PN # search on API 1, Search Log, "Released, not yet in the DMS" from the pool | **On hold, waiting for myloans staging access (C5)** | 2 to 3 |
| 11 | Products (API 5) and branches (API 4) | **Waiting for the product list and API 5 (R2-3)** | 2 to 3 |
| 12 | Docs, Manual Test Kit, e2e update, final verification | **Pending** (ongoing with each piece) | 4 to 6 |
| — | CI on GitHub (approved proposal) | **Blocked**: waiting for the GitHub setup (Actions, one secret, branch protection) | 1 |
| | **Foundation remaining** | | **23 to 31** |

**Build order (D-045):** piece **9 done** (18 November 2026); next **6, 7, 8 and 10** (the project owner plans to un-hold them and build them on the mock; going live on them still needs myloans staging access, C5); **11** when the product list (R2-3) arrives; 12 runs with each piece. Phase A go-live needs all of them, so its date depends on when C5 arrives.

## Outside decisions and blockers

| Item | Who | Blocks |
|---|---|---|
| myloans: 3 hash test-vector outputs | myloans team | Only the hash test (skipped until then) |
| myloans R2-4: paid / closed source | myloans team | "Loan closed / released" (closure module) |
| myloans staging access (C5) | myloans team, infrastructure | **Pieces 6, 7, 8 and 10 (on hold, D-045)** |
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
| Collateral (Custodian) | Receive, verify and keep documents; locations; pull-out requests and approval | 8 to 12 | B |
| Quality Assurance | QA checks and findings | 4 to 6 | B |
| Digital Records (Digicur) | Scan and scan reference; For NTC / NTE / NOD stages | 5 to 8 | C |
| Archival and warehousing | Boxes, parts, locations, the QR code | 6 to 9 | C |
| Closure | "Loan closed / released" (blocked by myloans R2-4) | 3 to 5 | C |
| Demerit points | Read the liquidation late record (D-044) and the TAT record | in the module that needs them | later |
| Retention | Retention rules and the disposal log | 3 to 5 | C |
| | **v2 modules** | **34 to 52** | |

## Phased go-live

| Phase | Contents | Remaining effort (days) | Cumulative |
|---|---|---|---|
| **A** | Foundation (pieces 6 to 8 and 10 to 12, CI) and go-live preparation: production sign-in (Entra), staging, backups and monitoring, first load of open loans (branch pool cutoff), user acceptance testing, training, first weeks of support | 33 to 46 | 33 to 46 |
| **B** | Vault transmittal, Collateral, Quality Assurance | 17 to 25 | 50 to 71 |
| **C** | Digital Records, archival and warehousing, closure, retention | 17 to 27 | 67 to 98 |

Phase A can go live without B and C: loans then stop at "For Vault Transmittal" until phase B. Any myloans item still open at that point delays only the parts listed under "Blocks".
