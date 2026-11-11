# Environment variables

Where settings live, how they load, and what production needs. No value is written here.

## Which file holds what

| Where | What | Committed? |
|---|---|---|
| `.env` | Non-secret defaults for a developer PC: the local Docker database, ports, `APP_ENV=local`, `APP_BASE_URL=http://localhost:3001`. Safe to share. Never used in production. | No (ignored) |
| `.env.local` | This PC's secrets and switches: `SESSION_SECRET`, `TEST_MODE`, `CRON_SECRET`, `MYLOANS_*`, the Microsoft Graph values, `EMAIL_TEST_RECIPIENT`, and a personal `DATABASE_URL` if you have one. | No (ignored) |
| `.env.example` | Every name, with an empty or placeholder value and a one-line note. | Yes |
| Hosting provider | Production and staging: every variable is entered in the host's Environment Variables screen. No production secret is kept in a file on any PC. | n/a |

Supabase hosts the production **database** (and can run scheduled calls). It does **not** run the Next.js app; the app needs its own host.

## Load order

The first place that has a value wins:

1. The process environment (the shell, CI, the hosting provider).
2. `.env.local`.
3. `.env`.

This order is the same everywhere:

- **Next.js** (`npm run dev`, `npm run build`, `npm start`) loads the files itself.
- **Prisma CLI** (`generate`, `migrate diff`, `migrate deploy`, `studio`, `db seed`) gets them through `prisma.config.ts`, which uses `lib/env/load-files.ts` (unit-tested: the shell wins, then `.env.local`, then `.env`). When that file exists, Prisma no longer reads `.env` by itself.
  - Migrations connect through `DIRECT_URL`, the app through `DATABASE_URL`. If they name different databases (for example you set only `DATABASE_URL` in the shell for a scratch database, and `DIRECT_URL` still comes from `.env.local`), Prisma commands refuse to start. To point a command at another database, set **both** in the shell.
- **Console scripts** (`npm run db:seed`, `db:seed:reference`, `email:test`, `email:reminders`, `myloans:sync`) use `tsx --env-file-if-exists=.env --env-file-if-exists=.env.local`, where the later file wins. They also run the startup check.
- **Vitest** (`vitest.config.mts`) uses the same order (a value set in the shell is kept, not replaced by a file's), with three exceptions:
  - Tests always run as `APP_ENV=local`.
  - `DATABASE_URL` and `DIRECT_URL` always point at the test database, `gdfi_dms_test` (see Two local databases).
  - The `GRAPH_*` values are blanked, so no test can send a real email.
  - The database helpers refuse any database that is not on this PC.
- **Playwright database helpers** (`tests/e2e/db.ts`) use the same loader (the shell wins, then `.env.local`, then `.env`) and the same `DATABASE_URL` / `DIRECT_URL` check.
- **Docker Compose** reads only `.env`, for `POSTGRES_*` and the ports. The ports are bound to 127.0.0.1.

## Two local databases

| Database | For | Who changes it |
|---|---|---|
| `gdfi_dms` | Your own data and manual testing (`DATABASE_URL` / `DIRECT_URL`). | You, the dev server (`npm run dev`) and the Manual Test Kit (`npm run kit:*`). |
| `gdfi_dms_test` | The automated tests: unit tests that use a database, integration, Playwright e2e. | The tests only. |

Create the test database once with `npm run db:create-test`. It works with the existing Docker volume (`CREATE DATABASE` through the container, because an init script only runs on a new volume), applies the migrations and seeds it. It is safe to run again; run it again after a new migration.

How the tests find it: `TEST_DATABASE_URL` if you set one, otherwise `DATABASE_URL` with the database name swapped for `gdfi_dms_test` (`lib/env/test-db.ts`, unit-tested).

- **Vitest** (`vitest.config.mts`) sets `DATABASE_URL` and `DIRECT_URL` to the test database for every test.
- **Playwright** (`playwright.config.ts`) starts its own `next dev` on port 3100 with the test database and its own build folder (`.next-e2e`; Next.js allows one dev server per folder), so it runs beside your server on port 3000. Before any test, the global setup adds a one-off test user to `gdfi_dms_test` and checks that the server's sign-in page shows it: a server on `gdfi_dms` (for example `E2E_BASE_URL` pointed at port 3000) is refused before anything changes.
- **The test helpers** (`tests/integration/helpers.ts`, `tests/e2e/db.ts`) refuse any database without `test` in its name, and any database not on this PC. `ALLOW_DESTRUCTIVE=1` does not change that: nothing automated touches `gdfi_dms`.

## Commands that reset or drop data

These refuse unless every database they would touch has `test` in its name, or you set `ALLOW_DESTRUCTIVE=1` for that one command on purpose. They never run when `APP_ENV` is `staging` or `production`, whatever else is set (`lib/env/destructive.ts`, unit-tested):

| Command | What it does | Guard |
|---|---|---|
| `npm run db:reset` | `prisma migrate reset --force`: drops every table, re-applies the migrations and seeds. No question. | `scripts/guard-destructive.ts` runs first |

The automated tests follow the stricter rule above (test database only, no override). The Manual Test Kit has its own rule (next section).

Not guarded by this rule, and why:

- `npm run db:seed` and `db:seed:reference` only add missing rows (and refresh the built-in role names); they delete nothing. Production needs `db:seed:reference`, and the seed already refuses test users when `APP_ENV=production`.
- `npm run db:migrate` is the same as `db:deploy` (`prisma migrate dev` is not used in this project).
- `npm run db:deploy` runs `migrate:check`, applies new migrations only, then checks again.
- **Reset test data** is gone from Settings: starting over is the Manual Test Kit's Reset (below).

## The Manual Test Kit

`npm run kit:start`, `kit:reset`, `kit:backup -- <name>`, `kit:list`, `kit:restore -- <name>` and `kit:rebuild`, and **Settings > Test kit** (Admin). What they do, the accounts and the PNs to try: [`docs/MANUAL-TEST-KIT.md`](MANUAL-TEST-KIT.md). The default is the clean kit; `--with-scenarios` loads the old scenario data ([`docs/MANUAL-TEST-KIT-SCENARIOS.md`](MANUAL-TEST-KIT-SCENARIOS.md)).

They run only when all of these hold (`lib/kit/guard.ts`, unit-tested), checked on the server on every call:

- `APP_ENV` is exactly `local` (never staging or production);
- `TEST_MODE=true`;
- `MYLOANS_MODE` is `mock` (the sample loans come from the sample MyLoans);
- `DATABASE_URL` and `DIRECT_URL` both name `gdfi_dms` on this PC (the allow-list; `gdfi_dms_test` is not on it).

Elsewhere the Test kit card is not listed, `/admin/settings?open=test-kit`, `/admin/test-kit` and `/admin/test-kit/sheet` are "not found", and the server actions refuse, even for Admin. The `kit:*` commands blank the `GRAPH_*` values for their own run; the sample accounts use `@example.test`; the email switch is set to Not active after every start, reset and restore.

**The real branch list.** `kit:start` and `kit:rebuild` import `storage/kit/myloans-branches.csv` when it is there, through the same import code as Settings, Branches, Import from MyLoans, so the kit has the real 6 divisions, 25 areas and 298 branches with their codes. Put the file (the MyLoans export, comma-separated with the header row, or the tab-separated dump) at exactly that path. Git ignores `storage/`: never commit it. Without the file the kit uses a small built-in subset (12 branches in 3 divisions, `lib/branches/builtin.ts`). The automated tests always use the built-in subset and never read the file (a database with `test` in its name never does).

Files: `storage/kit/` (ignored by Git): `baseline.dump` and `baseline.json`, and `backups/<name>.dump` and `.json`. They are `pg_dump` files, moved in and out of the container with `docker cp`, so a backup can be copied to another PC. Reset and Restore ask for the typed word RESET and take an automatic backup first (`pre-reset-<time>`, the last 5 kept). A save made with other migrations is not restored: after a new migration run `npm run kit:rebuild`.

## MyLoans: no direct database access

The DMS never connects to the MyLoans database (MYLOSDB) and never runs SQL against it. Loans come from the MyLoans API (`MYLOANS_BASE_URL`, `MYLOANS_API_KEY`); the branch list comes from the API through `listBranches()` (`lib/myloans/http-adapter.ts`, mapped in `lib/myloans/live-mapping.ts`), or from an export file (Settings, Branches, Import from MyLoans) until the API has it. If the MyLoans team can only offer database access, it must be a read-only login on a read-only view or replica, used only inside that one adapter method, never ad-hoc SQL elsewhere in the app; its connection string is a secret like the API key (hosting settings or `.env.local`, never `.env` or Git).

The branch list runs once a day at about 02:00 PHT through the existing cron endpoint (`/api/cron/myloans-sync`, `CRON_SECRET`); the time and a pause switch are in Settings, Branches.

## Migration names

Never use `prisma migrate dev` in this project (not even `--create-only`: twice it left a stray folder with Prisma's own date name, and `migrate deploy` then dropped the two loan-search trigram indexes). Create a migration only with `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script`, save it in a folder named with the next number after the latest one (`20261119090011_<name>`, then `20261119090012_<name>`, and so on), and remove the trigram "drop index" lines (`Loan_pn_trgm_idx`, `Loan_borrowerName_trgm_idx`) from the SQL. Apply it with `npm run db:deploy`.

`npm run migrate:check` (`lib/db/migration-check.ts`, unit-tested) fails when a folder does not match `<14 digits>_<lower-case name>`, the list is not strictly increasing (each new folder is the previous number plus one; a folder dated among the older ones that is not one of them is a stray), or the connected database applied them out of order, has a waiting folder that sorts before the last applied one, or is missing `Loan_pn_trgm_idx` / `Loan_borrowerName_trgm_idx`. It runs before and after `migrate deploy` in `npm run db:deploy`, `db:migrate` (now the same as `db:deploy`), `db:reset`, `db:create-test` and the kit rebuild (the folder check runs before anything is emptied).

After every migration, print the folder list of `prisma/migrations/` in order and the output of `npx prisma migrate status`, and check the new one is last. `lib/db/migrations.test.ts` checks every folder name (a 14-digit timestamp and a name), that names are unique, and, when a local database is reachable, that it applied them in name order.

## `APP_ENV` and the startup check

`NODE_ENV=production` is also used when this PC runs `next start` for tests, so it can't tell this PC from the real server. `APP_ENV` does that job, with three values: `local` (the default), `staging` and `production`.

At startup (`instrumentation.ts`, and in the console scripts), `lib/env` checks every variable. Messages name the variable and never show its value.

**`production` refuses to start when any of these is true:**

- `TEST_MODE` is true.
- `MYLOANS_MODE` is not `live`.
- `DATABASE_URL` or `DIRECT_URL` is missing, or points to this computer (localhost, 127.x, ::1).
- `APP_BASE_URL` is missing, not https, or localhost.
- `CRON_SECRET` is missing or shorter than 24 characters.
- `SESSION_SECRET` is missing or shorter than 32 characters.
- `MYLOANS_BASE_URL` or `MYLOANS_API_KEY` is missing.
- A variable has a value it doesn't know, such as `MYLOANS_MODE=sandbox`. An unknown `APP_ENV` is checked as strictly as production.

**These only print a warning:**

- `EMAIL_AUTO_DRAIN=false`.
- Any `GRAPH_*` value is missing. Emails stay Not set up.
- `AUTH_MODE=test` in production.

**`staging`** runs the same checks, with two exceptions:

- `MYLOANS_MODE` may be `mock`. The MyLoans address and key are then not needed.
- `TEST_MODE` may be true. Emails then go to `EMAIL_TEST_RECIPIENT` with "[TEST]".

Every page shows a "Staging" banner.

**`local`** never blocks; it only prints warnings.

**Test helpers in production:** these return "… is not available in production." on the server, even for Admin:

- the test simulator and its switches;
- the Manual Test Kit (also refused on staging, and anywhere but `gdfi_dms` on this PC);
- Simulate a MyLoans change;
- the sample MyLoans (mock) and its overrides;
- seeding test users.

Test mode also reads as off in production.

**Settings, System** shows "Environment: Local / Staging / Production" and "Test mode: On / Off" (never a value).

**`GET /api/health`** returns `ok`, `environment`, `database` (up or down) and the build version. It needs no sign-in and holds no data, variable names or values. It answers 200 when healthy and 503 when the database doesn't answer. Point the host's health check at it.

## Set up a new PC

1. `Copy-Item .env.example .env`
2. In `.env`, set `DB_HOST_PORT` and the port inside `DATABASE_URL` and `DIRECT_URL` (this PC uses 5434), and pick a local `POSTGRES_PASSWORD`. Use the same password in both URLs.
3. Create `.env.local`. Move these names there and fill them:
   - `SESSION_SECRET` (32 or more random characters);
   - `TEST_MODE=true`;
   - `MYLOANS_MODE=mock`;
   - `CRON_SECRET` (24 or more characters; only needed to call the cron endpoints locally);
   - optionally the `GRAPH_*` values and `EMAIL_TEST_RECIPIENT`, which you get from the IT owner and never paste into chat or email;
   - empty `MYLOANS_BASE_URL` and `MYLOANS_API_KEY`.

   Then delete those lines from `.env`.
4. Run, in order:
   - `npm install`
   - `npm run db:up`
   - `npm run db:migrate`
   - `npm run db:seed`
   - `npm run db:create-test` (the automated tests' database)
   - `npm run kit:start` (optional: the clean test kit, see `docs/MANUAL-TEST-KIT.md`)
   - `npm run dev`

PowerShell, a random secret: `[Convert]::ToBase64String((1..36 | ForEach-Object { Get-Random -Maximum 256 }))`

## Variables

| Name | What | Secret | Needed in |
|---|---|---|---|
| `APP_ENV` | local, staging or production | no | all (default local) |
| `TEST_MODE` | Test helpers and redirected emails | no | local, staging; must be false in production |
| `DATABASE_URL` | App's database connection (Supabase: pooled, port 6543) | **yes** | all |
| `DIRECT_URL` | Migrations' connection (Supabase: direct, port 5432) | **yes** | all |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Local Docker database | local only | local |
| `DB_HOST_PORT`, `ADMINER_HOST_PORT` | Local Docker ports | no | local |
| `APP_BASE_URL` | Public address, for links in emails | no | all |
| `SESSION_SECRET` | Signs the sign-in cookie (32+ characters) | **yes** | all |
| `AUTH_MODE` | test or entra | no | all |
| `CRON_SECRET` | `x-cron-secret` header for the cron endpoints (24+ in staging and production) | **yes** | staging, production |
| `MYLOANS_MODE` | mock or live | no | all; live in production |
| `MYLOANS_BASE_URL` | MyLoans API address (old name `MYLOANS_API_BASE_URL` is still read, with a warning) | **yes** | production, or when live |
| `MYLOANS_API_KEY` | MyLoans API key | **yes** | production, or when live |
| `MYLOANS_TIMEOUT_MS` | MyLoans time limit | no | optional |
| `GRAPH_CLIENT_ID`, `GRAPH_TENANT_ID` | Microsoft app and tenant IDs | **yes** | staging, production |
| `GRAPH_CLIENT_SECRET` | Microsoft app secret | **yes** | staging, production |
| `GRAPH_SENDER_EMAIL` | Mailbox emails are sent from | no | staging, production |
| `EMAIL_TEST_RECIPIENT` | Where every email goes in test mode | no | local, staging |
| `EMAIL_AUTO_DRAIN` | false = send only from the scheduled run | no | optional |
| `STORAGE_DRIVER`, `STORAGE_LOCAL_DIR`, `RECEIPTS_DIR` | File storage | no | optional |
| `SEED_TEST_USERS` | false = reference data only (set by `db:seed:reference`) | no | scripts |
| `E2E_BASE_URL`, `SHOTS_DIR` | Playwright only | no | tests |
| `ENTRA_*` | Future Microsoft sign-in (not read yet) | **yes** | later |

`NODE_ENV`, `NEXT_RUNTIME` and `VITEST` are set by the tools themselves. No variable uses `NEXT_PUBLIC_`, so nothing reaches the browser.

## Production checklist

1. **Supabase.** Create the project in a region close to the users. Copy the **pooled** connection string (port 6543, add `?pgbouncer=true&connection_limit=1&sslmode=require`) into `DATABASE_URL`, and the **direct** connection string (port 5432, `?sslmode=require`) into `DIRECT_URL`.
2. **App host.** Supabase doesn't run Next.js, so choose a host for the app. In the host's Environment Variables screen, set:
   - Mark as **secret:** `DATABASE_URL`, `DIRECT_URL`, `SESSION_SECRET`, `CRON_SECRET`, `MYLOANS_BASE_URL`, `MYLOANS_API_KEY`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`, `GRAPH_TENANT_ID`.
   - Plain values: `APP_ENV=production`, `TEST_MODE=false`, `MYLOANS_MODE=live`, `APP_BASE_URL=https://…`, `AUTH_MODE`, `GRAPH_SENDER_EMAIL`, `STORAGE_DRIVER`. `EMAIL_AUTO_DRAIN` can stay unset.
3. **Migrations.** Run `npx prisma migrate deploy` (`npm run db:deploy`) from a trusted machine or the deploy pipeline, with `DIRECT_URL` set for that run only. Then run `npm run db:seed:reference`. Never seed test users; production refuses to.
4. **Health check.** Point the host's health check at `GET /api/health`.
5. **Scheduler.** Every 15 minutes, call `POST /api/cron/email-reminders` and `POST /api/cron/myloans-sync` with the header `x-cron-secret: <CRON_SECRET>`. Supabase cron (`pg_cron` with `pg_net`) or the host's scheduler can do it.
6. **Rotate secrets.** Replace any secret that was ever pasted into chat, email or a ticket: the Microsoft client secret, the MyLoans key, `SESSION_SECRET` and `CRON_SECRET`.
7. **Microsoft app.** Confirm it has the **Mail.Send** application permission with **admin consent** granted. Better still, limit it to the sender mailbox with an application access policy.
8. **Start the app.** If any setting is unsafe it refuses to start and lists the variable names. Fix them and start again.
9. **Sign-in.** `AUTH_MODE=test` only gives a warning, because Microsoft sign-in is not built yet. The test sign-in buttons must not be on a public production address.
