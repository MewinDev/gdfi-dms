# GDFI-DMS: notes for Claude Code

@AGENTS.md

## Documentation rule

- When a change alters a workflow rule, a status, a turnaround target, a role or permission, or a screen flow described in `docs/workflow/`, update the matching file and its "Last updated" date (Philippine date) in the same change.
- When a planned item in `docs/workflow/09-status-and-open-questions.md` is built, change its status to Built only after verifying it in the app, with one line of evidence.
- Keep the diagrams' meaning unless the workflow itself changed. `lib/docs/workflow-docs.test.ts` checks titles, dates, links and Mermaid blocks.

## Migrations

- Never use `prisma migrate dev` in this project (not even `--create-only`: twice it left a stray folder with Prisma's own date name, and `migrate deploy` then dropped the two loan-search trigram indexes). Create a migration only with `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script`, save it in a folder named with the next number after the latest one (`20261119090011_<name>`, then `20261119090012_<name>`, and so on), and remove the trigram "drop index" lines (`Loan_pn_trgm_idx`, `Loan_borrowerName_trgm_idx`) from the SQL. Apply it with `npm run db:deploy`.
- `npm run migrate:check` fails when a folder does not match `<14 digits>_<name>`, the numbers are not strictly increasing (the next number each time; no stray date-named folder), or the connected database is missing a loan-search trigram index. It runs before and after `migrate deploy` in `db:deploy`, `db:migrate`, `db:reset`, `db:create-test` and the kit rebuild. Rules: `lib/db/migration-check.ts` (tested in `migration-check.test.ts`).
- After every migration, print the folder list of `prisma/migrations/` in order and the output of `npx prisma migrate status`, and check the new one is last. `lib/db/migrations.test.ts` checks the folder names and that the test database applied them in name order.
- After every migration, also run `npm run db:create-test` (brings `gdfi_dms_test` up to date) and `npm run kit:rebuild` (the Manual Test Kit's baseline; until then `kit:reset` refuses with "The baseline is out of date").

## Two databases and the Manual Test Kit

- `gdfi_dms` is the person's own data and manual testing; `gdfi_dms_test` is for the automated tests (`npm run db:create-test`). Vitest, the integration helpers and Playwright always use `gdfi_dms_test` (`lib/env/test-db.ts`) and refuse any database without `test` in its name; `ALLOW_DESTRUCTIVE` does not change that. Never point a test run at `gdfi_dms`.
- The Manual Test Kit (`npm run kit:*`, Settings > Test kit, `docs/MANUAL-TEST-KIT.md`) works only on `gdfi_dms` with `APP_ENV=local`, `TEST_MODE=true` and the sample MyLoans (`lib/kit/guard.ts`). The default is the clean kit (`lib/kit/clean.ts`, `lib/kit/build-clean.ts`, `docs/MANUAL-TEST-KIT.md` and `docs/MANUAL-TEST-KIT-ANSWERS.md`); `--with-scenarios` loads the old scenario data (`lib/kit/catalog.ts`, `lib/kit/build.ts`, `docs/MANUAL-TEST-KIT-SCENARIOS.md`). When an account or PN changes, update the matching catalog, builder and sheets together; `tests/integration/kit.test.ts` checks that they agree.

## Destructive commands

- `npm run db:reset` refuses unless the database name contains `test` or `ALLOW_DESTRUCTIVE=1` is set, and never runs when `APP_ENV` is `staging` or `production` (`lib/env/destructive.ts`). Set `ALLOW_DESTRUCTIVE=1` only for that one command, on purpose.
- `kit:reset`, `kit:restore` and `kit:rebuild` replace everything in `gdfi_dms`: they ask for RESET (or `--confirm=RESET`) and take an automatic backup first. Run them only when the person asked.
