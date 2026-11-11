# MyLoans sync: scheduling

How to make the background MyLoans sync and the email reminders run on a schedule, and how to check that they do.

Last updated: 12 November 2026 (PHT)

- **Nothing runs by itself.** The DMS has no timer of its own for the MyLoans sync or the email reminders. Something outside the app must call them: a scheduler on this PC, a cron job on a server, or Supabase.
- **The rules live in the app.** The scheduler only knocks on the door. Business hours, "every N minutes", the cap per run and the hourly limit are checked by the app (`lib/services/source-sync.ts`, `runMyLoansSync`).
- **Related:** [field-map.md](field-map.md) (what a sync compares), [../ENVIRONMENT.md](../ENVIRONMENT.md) (`CRON_SECRET`, `APP_BASE_URL`).

## 1. What must call what

| What | Call | Code |
|---|---|---|
| MyLoans sync (and the daily branch list) | `POST /api/cron/myloans-sync` | `app/api/cron/myloans-sync/route.ts` |
| Email reminders (then the email sender) | `POST /api/cron/email-reminders` | `app/api/cron/email-reminders/route.ts` |
| MyLoans sync from the console | `npm run myloans:sync` | `scripts/myloans-sync.ts` |
| Email reminders from the console | `npm run email:reminders` | `scripts/email.ts` |

**The secret.** Both endpoints check `CRON_SECRET` (`lib/email/cron-auth.ts`, `cronAllowed`). Send it in one of these headers:

- `x-cron-secret: <CRON_SECRET>` (preferred; this is what `docs/ENVIRONMENT.md` names), or
- `Authorization: Bearer <CRON_SECRET>`.

The endpoints take `POST` only. They do not need a signed-in person: `proxy.ts` lets `/api/cron/` through, and the secret is the only check.

**What the caller gets back:**

| Case | Status | Body |
|---|---|---|
| Wrong secret, no header, or `CRON_SECRET` not set (or shorter than 16 characters) on the server | 401 | `{"error":"Not allowed."}` |
| Sync skipped by a rule | 200 | `{"ok":true,"ran":false,"reason":"Outside business hours.", "branches":{...}}` (the reasons are in section 6) |
| Sync ran | 200 | `{"ok":true,"ran":true, ...the run's numbers..., "branches":{...}}` |
| Sync failed | 500 | `{"ok":false,"error":"The MyLoans sync could not run. Try again later.","branches":{...}}` |
| Reminders ran | 200 | `{"ok":true,"businessDay":true,"dueSoon":0,"approvalWaiting":0,"digest":0,"sent":0,"failed":0,"retrying":0}` |
| Reminders failed | 500 | `{"ok":false,"error":"The reminders could not run. Try again later."}` |

`branches` is the daily branch list from MyLoans (Settings, Branches). It runs on the first sync call at or after its set time (default 02:00 PHT), once a day. It never makes the loan sync fail.

**The console script** (`npm run myloans:sync`) runs one sync now and prints the result as one line of JSON. It reads `.env` and `.env.local`. It never prints the MyLoans address or key.

## 2. How often

- **MyLoans sync: call the endpoint every 5 to 15 minutes, all day.** The run itself does nothing when it ran less than `myloans.backgroundMinutes` ago (default 60) or when it is outside business hours. So calling more often than the setting is harmless: most calls return `"ran":false` at once. Keep calling at night too if the daily branch list should run at 02:00.
- **Email reminders: call the endpoint every 15 minutes.** This is the cadence the code expects (the comment in the route: "every 15 minutes on business days, and once in the morning for the digest"). Each call marks overdue jobs, sends the reminders that are due (each one only once; they are deduplicated), and then sends what is waiting in the email outbox. On weekends and holidays it sends no reminders, but still marks overdue jobs and sends the outbox. While emails are Not active (`email.active`, off by default), nothing is sent.
- **The daily overdue digest goes on the first call of a business day (Mon to Fri, Manila).** There is no time-of-day check. If you call all night, it goes out just after midnight. To have it arrive in the morning, call the reminders from 7:00 AM to 7:00 PM PHT only.

## 3. The Settings that limit each run

Settings > System > MyLoans sync. Saving needs "Change MyLoans sync settings"; it is audited as `myloans_sync_settings`.

| Setting key | Label on screen | Default | What it does |
|---|---|---|---|
| `myloans.backgroundMinutes` | Background run every (minutes) | 60 | A scheduled call is skipped when the last run was less than this many minutes ago (30 seconds of slack). 5 to 1,440. |
| `myloans.businessHoursOnly` | Business hours only | On | A scheduled call is skipped outside Mon to Sat, 7:00 AM to 7:00 PM PHT. Holidays in the DMS holiday list are skipped too. |
| `myloans.maxPerRun` | Loans per run (at most) | 50 | The most loans one run checks. The app halves its own cap after a slow or troubled run and raises it again by a quarter after a healthy one, never above this. 1 to 500. |
| `myloans.pauseMs` | Pause between calls (milliseconds) | 500 | The wait between two calls in a run, plus up to half again at random. 0 to 10,000. |
| `myloans.tierMinutes` | Work in progress / Not yet sent / Finished, not closed: check every (minutes) | A 60, B 240, C 1,440 | When a loan is due again, by tier. A loan MyLoans did not answer for is asked again within 30 minutes. Closed and cancelled loans are never checked. |
| `myloans.hourlyCeiling` | Calls to MyLoans per hour (at most) | 600 | At the limit, the background run stops and waits for the next clock hour. People opening a loan still get it. 10 to 100,000. |
| `myloans.refreshOnOpenMinutes` | Refresh when opened if older than (minutes) | 60 | Not part of the schedule: opening a loan file refreshes it when its copy is older than this. 0 means every time. |
| `myloans.refreshOnFindHours` | When a saved loan is found, refresh it from MyLoans if last checked more than this many hours ago | 4 | Not part of the schedule: Find a loan refreshes a saved loan in the background. 0 means never. |
| `myloans.slowMs` | (not on screen) | 2000 | An average answer slower than this marks the run "Slowed down" and halves the cap. |

**Pause MyLoans calls** (`myloans.paused`, default off; an Admin switch on the same card). When it is on, the background run, the stale refresh and refresh on open make no call to MyLoans, and the run history shows "Paused". The scheduler can keep calling; nothing reaches MyLoans until the switch is off.

**What one run does.** Only one sync runs at a time (a database advisory lock). If MyLoans offers a changed-since feed, the run makes one call for what changed since the last run (with 5 minutes of overlap) and updates only the loans open here. Otherwise it reads the due loans, oldest first, up to the cap, with the pause between calls. Unchanged loans get one batched "last checked" update; only changes are written. The last 10 runs are kept for the card (`myloans.state`).

## 4. How to schedule

### a. This PC: Windows Task Scheduler

Run this once in **Command Prompt** (not PowerShell). It runs the sync every 10 minutes from 7:00 AM to 7:00 PM and writes the output to a log file.

```bat
mkdir C:\gdfi-dms-logs
schtasks /create /tn "GDFI-DMS MyLoans sync" /sc minute /mo 10 /st 07:00 /et 19:00 /tr "cmd /c cd /d C:\Users\GD - MERIN\gdfi-dms && npm run myloans:sync >> C:\gdfi-dms-logs\myloans-sync.log 2>&1"
```

- **Check it:** `schtasks /query /tn "GDFI-DMS MyLoans sync" /v /fo list`. **Run it once now:** `schtasks /run /tn "GDFI-DMS MyLoans sync"`. **Remove it:** `schtasks /delete /tn "GDFI-DMS MyLoans sync" /f`.
- **The log:** each run adds one JSON line (or an error line) to `C:\gdfi-dms-logs\myloans-sync.log`. The folder is outside the project, so it never shows in git.
- **The PC must be on, and you signed in.** By default the task runs only while you are signed in. To run it signed out, add `/ru <user> /rp *` (it asks for the password) or tick "Run whether user is logged on or not" in Task Scheduler.
- **The database must be reachable.** The script uses `DATABASE_URL` from `.env` / `.env.local`. With the local Docker database, Docker must be running.
- **`npm` must be on the PATH** for the task. If the log says `'npm' is not recognized`, use the full path, for example `"C:\Program Files\nodejs\npm.cmd"`.
- **The script ignores two settings.** `npm run myloans:sync` always runs (it is forced): it does not check "Background run every (minutes)" or "Business hours only". The `/st 07:00 /et 19:00` window stands in for business hours, but Sundays and holidays are not skipped. The cap per run, the pause and the hourly limit still apply.
- **The script does not run the daily branch list.** Only the endpoint does.
- **If the app is running on this PC**, you can call the endpoint instead, which keeps every setting: `/tr "curl.exe -s -X POST -H \"x-cron-secret: <CRON_SECRET>\" http://localhost:3001/api/cron/myloans-sync"` (use your `APP_BASE_URL`). Then the secret is stored in the task; keep the task private.

### b. A hosted server: cron

Keep the two values in a file only the cron user can read, for example `/etc/gdfi-dms/cron.env`:

```sh
APP_BASE_URL=https://dms.example.ph
CRON_SECRET=<the same value as the app's CRON_SECRET>
```

Then `crontab -e`:

```cron
CRON_TZ=Asia/Manila
# MyLoans sync: every 10 minutes, all day (the app skips outside business hours and keeps "every N minutes").
*/10 * * * * . /etc/gdfi-dms/cron.env && curl -fsS -m 900 -X POST -H "x-cron-secret: $CRON_SECRET" "$APP_BASE_URL/api/cron/myloans-sync" >> /var/log/gdfi-dms/myloans-sync.log 2>&1
# Email reminders: every 15 minutes, 7:00 AM to 6:45 PM.
*/15 7-18 * * * . /etc/gdfi-dms/cron.env && curl -fsS -m 300 -X POST -H "x-cron-secret: $CRON_SECRET" "$APP_BASE_URL/api/cron/email-reminders" >> /var/log/gdfi-dms/email-reminders.log 2>&1
```

- `-f` makes curl fail on 401 and 500, so the log shows the error. `-m` gives a long run time to finish.
- `CRON_TZ` works with cronie and most Linux crons. If yours ignores it, the times are the server clock's; convert them (PHT is UTC+8).
- Many hosts have their own scheduler screen. Use the same address, method and header there.

### c. Supabase

**pg_cron with pg_net.** Turn on the `pg_cron` and `pg_net` extensions (Database, Extensions). Put the secret and the address in **Supabase Vault** (Project Settings, Vault, or the Vault screen) so they are never in the SQL text. Name them `gdfi_cron_secret` and `gdfi_app_base_url`. Then, in the SQL editor:

```sql
-- MyLoans sync: every 10 minutes, all day.
select cron.schedule(
  'gdfi-myloans-sync',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'gdfi_app_base_url') || '/api/cron/myloans-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'gdfi_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

-- Email reminders: every 15 minutes, 7:00 AM to 6:45 PM PHT. pg_cron uses UTC: that is 23:00 to 10:45 UTC.
select cron.schedule('gdfi-email-reminders-early', '*/15 23 * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'gdfi_app_base_url') || '/api/cron/email-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'gdfi_cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 60000);
$$);
select cron.schedule('gdfi-email-reminders-day', '*/15 0-10 * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'gdfi_app_base_url') || '/api/cron/email-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'gdfi_cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 60000);
$$);
```

- **Check the calls:** `select * from cron.job_run_details order by start_time desc limit 20;` (did the job run) and `select id, status_code, content from net._http_response order by created desc limit 20;` (what the app answered: 200, or 401 for a wrong secret).
- **Stop a job:** `select cron.unschedule('gdfi-myloans-sync');`.
- `pg_net` does not wait for the answer inside the job. A long sync may pass the timeout in `net._http_response` while the app still finishes the run; the Settings card is the true record.
- **Scheduled Edge Function** (the other way): a small function that does `fetch(APP_BASE_URL + "/api/cron/myloans-sync", { method: "POST", headers: { "x-cron-secret": Deno.env.get("CRON_SECRET")! } })`, with `CRON_SECRET` and `APP_BASE_URL` set as the function's secrets (`supabase secrets set`), triggered on the same schedule from Integrations, Cron. Never write the secret into the function's code.

## 5. How to know the schedule is working

1. **Last run.** Settings > System > MyLoans sync, line "Last run": the time, how it ran ("Scheduled" for the endpoint, "Console" for `npm run myloans:sync`, "Run now" for the button) and the mode ("changed-since feed" or "due loans"). During business hours it should move about every `myloans.backgroundMinutes`.
2. **Last runs table.** The last 10 runs, newest first. Column "Result": **Healthy**, **Slowed down** (MyLoans was slow, rate limited, or failed; the cap is halved) or **Paused** (the hourly limit was reached; with the new switch, also "Pause MyLoans calls").
3. **The health line** at the top of the card: "Healthy", "Slowed down: MyLoans is answering slowly" or "Paused: hourly limit reached".
4. **Calls this hour.** Line "This hour": "N of 600 calls". It shows red at the ceiling. This count is kept in the web server's memory: it starts at 0 after a restart, and it does not include calls made by `npm run myloans:sync` (a separate process).
5. **The audit log.** What is audited:
   - `myloans_sync_run`: only **Run now** on the card ("<name> ran the MyLoans sync: N checked, N with changes, N calls").
   - `myloans_sync_settings`: the sync settings were saved.
   - Per loan, from any refresh, scheduled ones included (actor System, mode Automatic): `source_minor_updated`, `source_change_detected`, `replacement_linked`.
   - `source_refreshed` and `source_refresh_failed`: only the Refresh button on a loan file (and the simulator).
   - **A scheduled run or a console run writes no audit row of its own.** Its record is the Last runs table. A run that found no changes leaves nothing in the audit log.
6. **"Last checked" on loan files.** On a loan file: "MyLoans · Last checked 2:10 PM" (and "Last checked" under the MyLoans details). Pick an active loan nobody has opened recently (opening it refreshes it too) and see the time move after its tier's interval. With the changed-since feed, only loans that MyLoans says changed are touched.
7. **The tier counts** ("Active loans by how often they are checked") show how many loans are in A, B and C. If all are 0, no run has anything to check.

**If nothing moves:**

- Check the scheduler first: the Task Scheduler "Last Run Result" and the log file, the cron log, or `cron.job_run_details` / `net._http_response` in Supabase.
- A 401 means the secret does not match (section 6).
- `"ran":false` with a reason means the app was reached and chose to skip. That is normal outside business hours.
- Press **Run now** on the card. If that works, MyLoans and the database are fine and the problem is the scheduler.
- Check the card's "Last error" line and the Mode line (Mock or Live).

## 6. Troubleshooting

| What you see | Meaning | What to do |
|---|---|---|
| 401 `{"error":"Not allowed."}` | The header is missing, the secret is wrong, or the server has no `CRON_SECRET` (or one shorter than 16 characters). | Send `x-cron-secret` with exactly the app's `CRON_SECRET` (no extra spaces or quotes). Staging and production also refuse to start with one shorter than 24. |
| `"reason":"Outside business hours."` | `myloans.businessHoursOnly` is on and it is not Mon to Sat, 7:00 AM to 7:00 PM PHT, or it is a holiday. | Normal. Turn off "Business hours only" to run at all hours. |
| `"reason":"Ran less than N minutes ago."` | The last run (any kind, Run now and the console included) was less than "Background run every (minutes)" ago. | Normal when the scheduler calls more often than the setting. |
| `"reason":"Another MyLoans sync is running."` | Another run holds the lock (a slow run, Run now, or a second server). | Nothing; the next call runs. If it repeats for a long time, check for a run that hangs. |
| Result "Paused", health "Paused: hourly limit reached" | The calls to MyLoans this clock hour reached "Calls to MyLoans per hour (at most)". | It resumes next hour. Raise the ceiling only if MyLoans agrees. |
| "Last error": "MyLoans did not answer several times; paused for a minute." | The circuit breaker: after 5 failures in a row, calls stop for 60 seconds ("MyLoans did not answer several times. We will try again in a minute."). | Wait. If it keeps opening, MyLoans is down or slow; work continues on the last copy. |
| Result "Slowed down" | MyLoans was slow (average over 2,000 ms), rate limited (429) or failed. The cap per run is halved. | Nothing; it grows back after healthy runs. Lower "Loans per run" or raise the pause if it stays. |
| 500 `"The MyLoans sync could not run. Try again later."` | The run itself failed (often the database). | Check the server log and that the database is reachable. |

## Notes

- **`npm run myloans:sync` is forced.** The brief assumed the console script keeps the "every N minutes" and business-hours checks. It does not (`force: true` in `scripts/myloans-sync.ts`), and it does not run the daily branch list. Run now is forced too. Only the endpoint keeps every setting.
- **"Paused" today means the hourly limit.** In the code at the time of writing, a run is "paused" only when the hourly ceiling is reached. The "Pause MyLoans calls" switch (`myloans.paused`) is being added in a separate change and will also show "Paused".
- **Refresh on open default.** `lib/settings.ts` still says 15 minutes at the time of writing; the same separate change makes it 60 for new setups. A database that already saved a value keeps it.
- **The hourly count and the circuit breaker are per process.** They live in memory (`lib/myloans/client.ts`, `lib/myloans/resilience.ts`). For the console script, each run starts at 0, so the ceiling limits only that one run.
- **No audit row for scheduled runs.** Only Run now writes `myloans_sync_run`.
- **Saturday.** The sync's business hours include Saturday; the email reminders' business days (`isBusinessDay`) are Mon to Fri only.
