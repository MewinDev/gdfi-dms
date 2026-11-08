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
- **Prisma CLI** (`generate`, `migrate dev`, `migrate deploy`, `studio`, `db seed`) gets them through `prisma.config.ts`. When that file exists, Prisma no longer reads `.env` by itself.
- **Console scripts** (`npm run db:seed`, `db:seed:reference`, `email:test`, `email:reminders`, `myloans:sync`) use `tsx --env-file-if-exists=.env --env-file-if-exists=.env.local`, where the later file wins. They also run the startup check.
- **Vitest** (`vitest.config.mts`) uses the same order, with three exceptions:
  - Tests always run as `APP_ENV=local`.
  - The `GRAPH_*` values are blanked, so no test can send a real email.
  - The database helpers refuse any database that is not on this PC.
- **Playwright database helpers** (`tests/e2e/db.ts`) load `.env.local`, then `.env`.
- **Docker Compose** reads only `.env`, for `POSTGRES_*` and the ports. The ports are bound to 127.0.0.1.

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
- Reset test data;
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
