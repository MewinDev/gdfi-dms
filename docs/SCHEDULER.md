# Scheduling: the myloans sync, email reminders and backups

Last updated: 18 November 2026 (PHT)

The myloans sync (piece 7, D-052) has **one entry point**. Hosting is not decided yet, so it is built to be called by any scheduler: Windows Task Scheduler, cron on Linux, or a cloud scheduler. Whatever calls it, the sync itself decides what is due.

## What one call does

Each call (every 5 minutes is a good rhythm) does at most one of these, in this order:

1. **The daily catch-up**, when it is due: once a day at the catch-up time (default **02:00 Manila**), it reads everything myloans changed in the last **26 hours** (Settings, MyLoans sync). It finds changes a run missed, for example a change myloans stamped late. It never moves the checkpoint back.
2. **A change run**, when the interval has passed since the last run (default **every 30 minutes**): it reads what changed since the checkpoint (API 2, page by page).
3. **Nothing**, otherwise ("Ran less than 30 minutes ago.").

Rules that hold for every caller:

- **Runs never overlap.** A lock row (`SyncLease`) lets one run in; a second call at the same time is skipped and logged ("Another MyLoans sync is running."). A lock left by a crashed run expires after 30 minutes.
- **The checkpoint moves only when every page succeeded** (page 1's RunStartedAt minus 5 minutes). A failed run keeps it, so nothing is lost: the next good run reads the same changes again.
- **Nothing is applied automatically** (strict v2). Each change becomes the loan's review item (one per loan); the approvers of the loan's branch decide.
- **Released loans not yet in the DMS** are kept from the branch-pool cutoff (default: go-live minus 30 days), for the branch pool (piece 10b).
- **Paused by Admin** (Settings, MyLoans sync, Pause MyLoans calls): the run makes no call and the run log says so.
- **Every run is in the run log** (Settings, MyLoans sync) and the audit log. After **3 failed runs in a row** Admin and Superadmin get a notification (the number is a setting).

## The two ways to call it

| Way | Command | When to use it |
| --- | --- | --- |
| Console command | `npm run sync:myloans` | A scheduler on the same machine as the code (Windows Task Scheduler, cron). |
| HTTP endpoint | `POST /api/cron/myloans-sync` with the header `x-cron-secret: <CRON_SECRET>` | A cloud scheduler, or any scheduler that can only call a URL. The same call also runs the daily branch list from myloans. |

The console command takes a flag for a run by hand:

| Command | What it runs |
| --- | --- |
| `npm run sync:myloans` | What is due (the same as the endpoint). |
| `npm run sync:myloans -- --now` | A change run now, whatever the interval. |
| `npm run sync:myloans -- --catchup` | The catch-up now. |
| `npm run sync:myloans -- --first-load` | The first load (pool mode): released loans from the branch-pool cutoff. Run it once before go-live. |

It prints one line of JSON (never the myloans address or key). Exit code **0**: it ran or nothing was due. **1**: the run failed (the checkpoint was kept). **2**: another run holds the lock.

`CRON_SECRET` must be at least 24 characters on staging and production (16 locally). Keep it in the environment, never in the repository.

## Windows Task Scheduler

Every 5 minutes, all day (the catch-up runs at night):

```powershell
schtasks /create /tn "GDFI-DMS myloans sync" /sc minute /mo 5 /tr "cmd /c cd /d C:\path\to\gdfi-dms && npm run sync:myloans >> C:\gdfi-dms-logs\myloans-sync.log 2>&1"
```

Or call the endpoint (when the app runs on another machine):

```powershell
schtasks /create /tn "GDFI-DMS myloans sync" /sc minute /mo 5 /tr "powershell -NoProfile -Command \"Invoke-RestMethod -Method Post -Uri https://dms.example/api/cron/myloans-sync -Headers @{ 'x-cron-secret' = $env:CRON_SECRET }\""
```

Set `CRON_SECRET` as a system environment variable for the account that runs the task, not in the command.

## cron (Linux)

```cron
*/5 * * * * cd /srv/gdfi-dms && npm run sync:myloans >> /var/log/gdfi-dms/myloans-sync.log 2>&1
```

Or the endpoint:

```cron
*/5 * * * * curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" https://dms.example/api/cron/myloans-sync >/dev/null
```

The server's time zone does not matter: the catch-up time is read in Manila time by the sync.

## Cloud schedulers

Any scheduler that can send a POST every 5 minutes works. Examples:

- **Vercel Cron Jobs**: a cron entry for `/api/cron/myloans-sync` every 5 minutes. Vercel sends `Authorization: Bearer <CRON_SECRET>` when `CRON_SECRET` is set in the project; the endpoint accepts that header as well as `x-cron-secret`.
- **Google Cloud Scheduler, AWS EventBridge Scheduler, Azure Logic Apps**: an HTTP POST target to `https://<host>/api/cron/myloans-sync` with the header `x-cron-secret`, the secret kept in the provider's secret store.

## In development

No scheduler is needed: set `MYLOANS_SYNC_DEV_TIMER=true` and a `CRON_SECRET` in `.env.local`, with `APP_ENV=local`. `next dev` then calls the endpoint every minute (`lib/myloans/dev-timer.ts`). It never runs on staging or production. Without the flag, use **Run now** in Settings, MyLoans sync, or `npm run sync:myloans -- --now`.

## Checking that it works

Settings, MyLoans sync:

- **Changes read up to**: the checkpoint. It should move about every interval.
- **Last run** and **Last catch-up**: when, how (Scheduled, Console, Run now, Dev timer) and the result.
- **Run log**: the latest runs, with the changes read, review items raised, released loans not yet in the DMS, loans sent twice, and the error or the reason a run was skipped.
- **Failed runs in a row**: above 0, the last error says why; at the alert threshold Admin is notified.

## Email reminders

`POST /api/cron/email-reminders` (same `x-cron-secret` header) or `npm run email:reminders` on the app machine. Call it **every 15 minutes, 7:00 AM to 6:45 PM Manila**. Each call marks overdue jobs, sends the reminders that are due (each once) and then the email outbox. On weekends and holidays it sends no reminders but still marks overdue jobs and sends the outbox. While emails are Not active (Settings, Email notifications), nothing is sent. The daily overdue digest goes on the first call of a business day, so starting at 7:00 AM makes it arrive in the morning.

```cron
*/15 7-18 * * * curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" https://dms.example/api/cron/email-reminders >/dev/null
```

Answers: 200 with the counts; 401 `{"error":"Not allowed."}` for a wrong or missing secret; 500 when it could not run (the next call tries again).

## Backups

Once a day (for example 01:00 Manila, before the catch-up): `npm run backup` on a machine with the PostgreSQL client tools and read access to the storage folder. Targets, retention and the restore rehearsal: `docs/GO_LIVE_RUNBOOK.md`, section 5.

