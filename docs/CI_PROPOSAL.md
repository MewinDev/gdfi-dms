# CI proposal (not built)

Last updated: 17 November 2026 (PHT)

The repo is on GitHub, so the proposal is **GitHub Actions**. Nothing here is built yet.

## What runs, on every push and pull request

| Job | Steps | Time (estimate) |
|---|---|---|
| **checks** | `npm ci` · `npx prisma generate` · `npx tsc --noEmit` · `npm run lint` · `npm run migrate:check` (against the service DB) | 3–4 min |
| **vitest** | Postgres service · `npm run db:create-test` · `npx vitest run` | 10–12 min |
| **e2e** (3 shards: 1440, 820, 390) | Postgres service · `npm run db:create-test` · `npx playwright install --with-deps chromium` · `npx next build` once, cached between shards · `npx playwright test --project=<width> --workers=1` | 25–35 min per shard, in parallel |

- **vitest and e2e never share a database:** each job has its own Postgres service container, which matches the CLAUDE.md rule (they never run together on one `gdfi_dms_test`).
- **Pull requests** need **checks** and **vitest** to pass. **e2e** runs on every push but is required only on the `main` branch at first, while we watch for flaky tests.
- **Artifacts:** Playwright traces and screenshots of failed tests, kept for 7 days.
- **Not in CI:** `kit:*`, `db:reset-seed` and anything else that touches `gdfi_dms`; production and staging are never touched.

## Postgres service

- Image `postgres:16` (match the version in our Docker setup), database `gdfi_dms_test`, a throwaway user and password created in the workflow file.
- The `pg_trgm` extension must be available: the stock image has it.
- `DATABASE_URL` / `DIRECT_URL` point at `localhost:5432/gdfi_dms_test`; `lib/env/test-db.ts` already refuses any database without "test" in its name.

## Environment the jobs need

| Name | Where | Value |
|---|---|---|
| `APP_ENV` | workflow env | `local` |
| `TEST_MODE` | workflow env | `true` |
| `AUTH_MODE` | workflow env | `test` (local test sign-in; refused outside `local`, piece 1) |
| `MYLOANS_ADAPTER` (or the current name) | workflow env | `mock` (never the real myloans) |
| `AUTH_SECRET` / session secret | **repository secret** | a random 32+ character value used only by CI |
| `CRON_SECRET` | repository secret (optional) | only if a test calls the cron routes |
| Email | workflow env | email master switch off (the outbox only records) |

No myloans credentials, no Entra credentials and no production URLs are needed or allowed.

## Settings on GitHub

- **Branch protection on `main`:** require the checks and vitest jobs (and e2e later), and require pull requests.
- **Actions permissions:** read-only `GITHUB_TOKEN` (`permissions: contents: read`).
- **Concurrency:** cancel an older run of the same branch when a new push arrives.
- **Caches:** npm (`actions/setup-node` with `cache: npm`), Playwright browsers, and the Next build output (`.next-e2e-prod`) shared by the three e2e shards.

## Effort

| Work | Effort |
|---|---|
| Workflow file (three jobs, Postgres service, caches, artifacts) | 0.5 day |
| Make `db:create-test` and the Playwright config read CI env cleanly (no `.env.local`) | 0.5 day |
| First runs: fix CI-only differences (Linux paths, fonts in screenshots, timeouts) | 0.5–1 day |
| Branch protection, secrets, a short README section | 0.25 day |
| **Total** | **about 2–2.5 days** |

## Running cost and limits

- A private repo on the GitHub Free plan has 2,000 Actions minutes a month. One push costs about 15 minutes (checks + vitest) plus about 90 runner-minutes for the three e2e shards, so about **20 pushes a month** fit before e2e needs a paid plan or a self-hosted runner. Running e2e only on `main` and on pull requests marked "ready" keeps it well within the limit.
- The screenshot specs write to `docs/screenshots/`. In CI they should write to an artifact folder instead (a small change to the specs' `DIR`).
