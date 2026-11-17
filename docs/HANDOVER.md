# Handover: pieces 4 and 5 done; stop before piece 6

Last updated: 17 November 2026 (PHT)
Branch: `feature/foundation-settings-rbac-myloans` (pushed)

## Where things stand

- **Green and committed:** pieces 1 to 4 (piece 3 branch scope; piece 4 the working-days calendar, D-041), the myloans round 3 contract (D-040) and the "users with no branches" warning. Last full run, 17 November 2026:
  - vitest: 1,243 passed, 1 skipped;
  - full e2e (`npm run e2e:groups`, production build, workers=1): 570 passed, 0 failed (191 / 191 / 188 at 1440 / 820 / 390);
  - tsc and lint clean.
- **18 November 2026, after piece 4 (D-042, committed):** the holiday CSV import, Make inactive / active and the generic paths all go through the calendar rule; deactivation undoes only its own extensions; "Correct due dates" (`duedates:correct`, migration 019); screenshots only with `npm run docs:screenshots`; `docs/STATUS.md` (the status table). Vitest 1,249 passed, 1 skipped; tsc and lint clean; kit rebuilt after migration 019.
- **Piece 5 done (D-044):** the liquidation due date after the last LTO pickup (`lib/funds/liquidation.ts` rule, `lib/services/liquidation.ts` triggers), migration `20261119090020_liquidation_due`, the late record, the Funds / My funds line and the TAT report section; `liquidationDueDays` on Settings, Funds types. D-043 records the holiday-removal chain case.
- **Last runs (18 November 2026):** vitest green (1,272 and the 2 updated funds tests); full e2e: 194 / 194 / 191 passed with the only failure a wrong fixture in the new liquidation spec, fixed and rerun at all three widths (pass); tsc and lint clean; kit rebuilt after migration 020.
- **Next: piece 6 (myloans mock APIs), not started.** Wait for the project owner.
- **Open small items:** the funds-types CSV import has no `liquidation_due_days` column yet (new types get 2); Correct due date is on the job page and the Funds liquidation details only.
- Decisions: `docs/DECISIONS.md` (D-001 to D-041); plan: `IMPLEMENTATION_PLAN.md` (piece 5 is section 6; myloans round 3 is 7.3).

## Piece 4: what was built (D-041)

- **`lib/calendar/`** is the one calendar: `core.ts` (pure: `daysFor`, `addWorkingDays`, `workingDaysBetween`, `pausedDays`, `lostWorkingDays`, `dueTone`, `PAUSE_RULE_TEXT`), `load.ts` (`loadCalendar`, `getCalendar` per request), `testing.ts` (test helpers only). The old `lib/time` counters and `getHolidaySet` are gone; `no-other-counting.test.ts` forbids any other counting.
- **Whose calendar:** LA steps the loan's branch; DP steps and liquidation the processor's branch (`stepBranch` in `lib/jobs/view.ts`, `branchDayCounters` in monitoring); Finance the request's branch.
- **Migration `20261119090018_working_calendar`:** holiday kind, type, branches (`HolidayBranch`), reason, `isSample`; `HoldReason.pausesTat` (on for CLIENT-PAPERS, CLIENT-DECISION, CLIENT-CORRECTIONS, BRANCH-HEAD, FUNDS, MYLOANS-UPDATE); `DpAssignment.dueDate / targetDays / dueBranchId`; `CashAdvance.liquidationDueFrom`; `DueDateChange` log. It deleted the 13 guessed 2026 holidays the old seed made; the seed now makes 2 labelled samples (14 and 21 December 2026).
- **Saved due dates:** at accept (`acceptCore`) and at release or carry-over (`liquidationDueFields`). Moved only by `lib/services/calendar.ts` (`addCalendarEntry`, `saveWorkingDays`: the window rule, a DueDateChange and audit row per item, the owner told) or by a pausing hold's end (`extendForPause` in holds). LA steps without an accept are still counted live (piece 9).
- **Screens:** Settings, Holidays and working days (`components/admin/calendar-area.tsx`, `app/actions/calendar.ts`): working days, office closure, add a holiday, each Check then Save. Chips: green / amber "N days left" / due today / red / grey "Paused" (with the plain rule on hover and for screen readers). Jobs lists sorted by due date (`sortByDue`). The job page shows the due date, how it moved and the pause rule. "Pauses TAT" on Settings, Hold reasons.
- **Not done (by decision):** waiting time and the full inbox (piece 9); liquidation's start at the last LTO (piece 5). The holiday CSV import still adds rows without the extension rule (use Settings for dates that may move due dates). Making a holiday inactive does not move a saved date back (an admin correction is not built yet).

## Earlier this session

- **Piece 3** (branch scope everywhere, D-019, D-039): the file route and its append-only log with the Audit screen; job pages by the loan's branch; own-job holds and problems; scope before every answer; the cross-branch test of every role. See D-039 and docs/workflow/07.
- **myloans round 3** (D-040): files saved; mock freshness (suffix time, replacement created_at); the planner's "superseded" decision; still waiting for the 3 vector outputs and their updated_at check.

## Things a fresh session must know

- **Both databases are on migration 020.** `gdfi_dms_test` was reset (with the owner's consent) and re-seeded on 17 November 2026; the kit was rebuilt after each migration up to 020 (`gdfi_dms` holds the CLEAN kit; automatic backups in `storage/kit/backups/`). Never touch the test DB directly; use the sanctioned scripts.
- **File access log rows keep their user forever** (append-only, `ON DELETE RESTRICT`). In tests, only seeded users that are never deleted (such as Test Admin) may open files or export the log; a temporary `zz.` user who does can never be removed, and every test that cleans `zz.` users then fails (this happened once; it took a test DB reset to fix).
- **Migrations:** never `prisma migrate dev`. Use `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script`, put it in the next numbered folder (`20261119090018_...`), remove the trigram DROP INDEX lines, apply with `npm run db:deploy`, then print the folder list and `npx prisma migrate status`. Full rules: `CLAUDE.md`.
- **The project owner's dev server is on port 3000.** Never touch it. The e2e tests use their own server on port 3100. A production build (`next build`) is allowed only when the project owner says the dev server is stopped.
- **Memory:** run vitest and e2e one after the other, never together. Long e2e runs were stopped twice by low memory; use `npm run e2e:groups` (workers=1, one group at a time). If memory runs low, stop and report the group, then resume from there later.
- **Destructive commands** (`db:reset-seed`, `kit:*`) only when the project owner approves; `ALLOW_DESTRUCTIVE=1` only for that one command.
- **Fake data only.** Replace real-looking PN # values with `<SAMPLE-PN>`. Never connect to the myloans database: API only, mocked locally (`lib/myloans/r2/`).
- **Shell quirk:** bash heredocs containing quotes sometimes fail in this environment; write edit scripts to the scratchpad with the Write tool and run them.
- **Known issue:** a dev-only React key warning on Funds (`docs/KNOWN_ISSUES.md`); run e2e on the production build.

## CI (after piece 3): waiting for the project owner to confirm the GitHub setup

Approved per `docs/CI_PROPOSAL.md`: full e2e on `main` and on ready pull requests only. Needed from the project owner:

1. allow GitHub Actions on `MewinDev/gdfi-dms`;
2. one repository secret: a random session secret of 32+ characters, used only by CI;
3. branch protection on `main`: require the checks and vitest jobs (e2e once stable) and require pull requests;
4. confirm the GitHub plan's Actions minutes are enough, or choose a self-hosted runner.

## Open with others

- **myloans:** send `docs/MYLOANS_REPLY_3.md`. Still waiting on:
  - R2-3, the product CSV and API 5;
  - R2-4, the paid/closed source (blocks only "Loan closed/released");
  - R2-6, timings;
  - A4, A5, C2, C5;
  - 200 vs 409 on API 1;
  - the `updated_at` confirmation;
  - the 17-field test vectors.
- **D-024:** approval bands, to confirm with Finance.
