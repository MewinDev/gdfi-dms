# 09 myloans sync (30-minute runs, daily catch-up, first load, run log)

Last updated: 18 November 2026 (PHT)

## A. Purpose and roles

One sync on API 2 (D-052) reads what changed in myloans and turns each change into an Open Item; nothing is applied automatically. It also keeps released loans not yet in the DMS for the branch pools (10b). Admin watches the run log and changes the settings; the scheduler calls it (`docs/SCHEDULER.md`).

## B. Checklist

| # | Item | Status | Where | Who | Customizable? | Evidence | UAT check |
|---|---|---|---|---|---|---|---|
| 1 | Change runs every 30 minutes from the checkpoint; checkpoint moves only after a fully good run | ✅ Built (mock) | Settings, MyLoans sync | System | Interval | `lib/services/myloans-sync.ts`, `tests/integration/myloans-sync-run.test.ts` | Run now; checkpoint moves |
| 2 | Daily catch-up (02:00, last 26 hours) | ✅ Built | same | System | Time, hours | D-049 | Run the catch-up now |
| 3 | Runs never overlap (lock, 30-minute expiry) | ✅ Built | n/a | System | No | `SyncLease` | Two calls: one skipped |
| 4 | Run log (Changes read up to, last run, last catch-up, every run with counts and errors) | ✅ Built | same | `myloans:manage` | No | e2e `myloans-sync.spec.ts` | UAT ADM-5 |
| 5 | Alert after N failed runs in a row | ✅ Built | Notifications | Admin, Superadmin | N | D-052 | Mock failure 3 times |
| 6 | Pause MyLoans calls | ✅ Built | same | `myloans:manage` | Yes | `docs/workflow/09-status-and-open-questions.md` | UAT ADM-5 |
| 7 | Run now / catch-up now | ✅ Built | same | `myloans:sync` | No | D-052 | Press Run now |
| 8 | First load from the branch-pool cutoff (`--first-load`) | ✅ Built (mock) | console | Developer | Cutoff, go-live date | `scripts/myloans-sync.ts` | Go-live checklist step 9 |
| 9 | One entry point for any scheduler (console or `POST /api/cron/myloans-sync`) | ✅ Built | n/a | Scheduler | n/a | `docs/SCHEDULER.md` | n/a |
| 10 | Production scheduler set up | ⏸ Blocked (project owner, infrastructure: hosting decision) | n/a | n/a | n/a | `docs/STATUS.md` | Go-live checklist step 10 |
| 11 | Duplicates and superseded copies handled (one loan per ExternalLoanId) | ✅ Built | n/a | n/a | No | D-016, D-036 | n/a |
| 12 | Same ContentHash with a newer timestamp: only the timestamp saved | ✅ Built | n/a | n/a | No | `lib/myloans/changes.ts` | n/a |
| 13 | Branch and product lists read daily from the same entry point | ✅ Built (mock) | Settings, Branches | System | Time | D-054 | n/a |
| 14 | Sync dry run against myloans staging | ⏸ Blocked (myloans team, infrastructure: C5) | n/a | n/a | n/a | `docs/STATUS.md` | n/a |

## D. Known limits and open questions

- Timings and limits for production (R2-6, A4, A5, C2) are confirmed only in the staging dry run.
