# GDFI-DMS: notes for Claude Code

@AGENTS.md

## Documentation rule

- When a change alters a workflow rule, a status, a turnaround target, a role or permission, or a screen flow described in `docs/workflow/`, update the matching file and its "Last updated" date (Philippine date) in the same change.
- When a planned item in `docs/workflow/09-status-and-open-questions.md` is built, change its status to Built only after verifying it in the app, with one line of evidence.
- Keep the diagrams' meaning unless the workflow itself changed. `lib/docs/workflow-docs.test.ts` checks titles, dates, links and Mermaid blocks.

## Migrations

- Until 19 November 2026, create every migration with `npx prisma migrate dev --create-only --name <name>`, then rename the new folder to the next number after the latest one (`20261119090001`, `20261119090002`, and so on) before applying it. Never leave Prisma's automatic date name. From 20 November 2026 this rule no longer applies.
- After every migration, print the folder list of `prisma/migrations/` in order and the output of `npx prisma migrate status`, and check the new one is last. `lib/db/migrations.test.ts` checks the folder names and that the test database applied them in name order.
- After every migration, also run `npm run db:create-test` (brings `gdfi_dms_test` up to date) and `npm run kit:rebuild` (the Manual Test Kit's baseline; until then `kit:reset` refuses with "The baseline is out of date").

## Two databases and the Manual Test Kit

- `gdfi_dms` is the person's own data and manual testing; `gdfi_dms_test` is for the automated tests (`npm run db:create-test`). Vitest, the integration helpers and Playwright always use `gdfi_dms_test` (`lib/env/test-db.ts`) and refuse any database without `test` in its name; `ALLOW_DESTRUCTIVE` does not change that. Never point a test run at `gdfi_dms`.
- The Manual Test Kit (`npm run kit:*`, Settings > Test kit, `docs/MANUAL-TEST-KIT.md`) works only on `gdfi_dms` with `APP_ENV=local`, `TEST_MODE=true` and the sample MyLoans (`lib/kit/guard.ts`). When a sample case or account changes, update `lib/kit/catalog.ts`, `lib/kit/build.ts` and the test sheet together; `tests/integration/kit.test.ts` checks that they agree.

## Destructive commands

- `npm run db:reset` refuses unless the database name contains `test` or `ALLOW_DESTRUCTIVE=1` is set, and never runs when `APP_ENV` is `staging` or `production` (`lib/env/destructive.ts`). Set `ALLOW_DESTRUCTIVE=1` only for that one command, on purpose.
- `kit:reset`, `kit:restore` and `kit:rebuild` replace everything in `gdfi_dms`: they ask for RESET (or `--confirm=RESET`) and take an automatic backup first. Run them only when the person asked.
