# 23 Operations (scheduler, environments, runbook, rollback, UAT)

Last updated: 18 November 2026 (PHT)

## A. Purpose and roles

Running the DMS for real: where it runs, what calls it on a schedule, how it goes live, how to step back, and how users accept it. Roles: project owner (decides), infrastructure (hosts), developer, Admin (data entry), testers per role.

## B. Checklist

| # | Item | Status | Where | Who | Customizable? | Evidence | UAT check |
|---|---|---|---|---|---|---|---|
| 1 | Three environments (`APP_ENV` local, staging, production) with startup checks; staging banner | ✅ Built | n/a | n/a | env | `lib/env/check.ts`, `docs/ENVIRONMENT.md` | n/a |
| 2 | Health check `GET /api/health` | ✅ Built | n/a | Host | No | `app/api/health/route.ts` | n/a |
| 3 | One scheduler entry point (sync, branch list); email reminders endpoint | ✅ Built | n/a | Scheduler | n/a | `docs/SCHEDULER.md` | n/a |
| 4 | Hosting decided; staging and production servers | ⏸ Blocked (project owner, infrastructure) | n/a | n/a | n/a | `docs/STATUS.md` | n/a |
| 5 | Production scheduler | ⏸ Blocked (hosting) | n/a | n/a | n/a | module 09 row 10 | n/a |
| 6 | CI on GitHub | ⏸ Blocked (project owner: GitHub setup) | n/a | n/a | n/a | `docs/CI_PROPOSAL.md` | n/a |
| 7 | Go-live runbook: Entra and settings, scheduler, first load, go-live date, backups, go-live day checklist, rollback | ✅ Built | `docs/GO_LIVE_RUNBOOK.md` | n/a | n/a | D-055 | n/a |
| 8 | Rollback plan (who decides, switch off safely, back to the current process, keep the work, try again) | ✅ Built | runbook section 7 | Project owner | n/a | runbook | n/a |
| 9 | UAT checklist per role with sign-off | ✅ Built | `docs/UAT_CHECKLIST.md` | testers | n/a | D-055 | n/a |
| 10 | UAT run and signed | ⏸ Blocked (needs staging and testers) | n/a | n/a | n/a | n/a | n/a |
| 11 | Volume test (15,000 loans; every main screen under 100 ms) | ✅ Built | console | Developer | n/a | `npm run volume`, `scripts/volume-*.ts` (18 Nov 2026) | n/a |
| 12 | Data migration of loans already in process at go-live (v2 §13.6) | ⚠️ Partial: the first load brings released loans from the cutoff into the pools; papers and jobs already in process are entered by hand | n/a | Admin, LAs | Cutoff | runbook section 3 | n/a |
| 13 | Training materials per role | ❌ Missing (the UAT checklist and the demo script are a start) | n/a | n/a | n/a | `docs/DEMO_SCRIPT.md` | n/a |
| 14 | Monitoring of the running app (errors, uptime) beyond the health check | ⚠️ Partial: health check and the sync alert; no error tracking service | n/a | n/a | n/a | n/a | n/a |

## D. Known limits and open questions

- Hosting choice decides rows 4, 5, the backup target and whether a cloud file driver is needed (module 17 row 6).
