# GDFI-DMS: notes for Claude Code

@AGENTS.md

## Documentation rule

- When a change alters a workflow rule, a status, a turnaround target, a role or permission, or a screen flow described in `docs/workflow/`, update the matching file and its "Last updated" date (Philippine date) in the same change.
- When a planned item in `docs/workflow/09-status-and-open-questions.md` is built, change its status to Built only after verifying it in the app, with one line of evidence.
- Keep the diagrams' meaning unless the workflow itself changed. `lib/docs/workflow-docs.test.ts` checks titles, dates, links and Mermaid blocks.

## Migrations

- Until 19 November 2026, create every migration with `npx prisma migrate dev --create-only --name <name>`, then rename the new folder to the next number after the latest one (`20261119090001`, `20261119090002`, and so on) before applying it. Never leave Prisma's automatic date name. From 20 November 2026 this rule no longer applies.
- After every migration, print the folder list of `prisma/migrations/` in order and the output of `npx prisma migrate status`, and check the new one is last. `lib/db/migrations.test.ts` checks the folder names and that the local database applied them in name order.

## Destructive commands

- `npm run db:reset`, the integration tests and the Playwright tests refuse unless the database name contains `test` or `ALLOW_DESTRUCTIVE=1` is set, and never run when `APP_ENV` is `staging` or `production` (`lib/env/destructive.ts`). Set `ALLOW_DESTRUCTIVE=1` only for that one command, on purpose.
