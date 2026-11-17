# Handover: pieces 4, 5, 9 and 6 done; stop before piece 10a

Last updated: 18 November 2026 (PHT)
Branch: `feature/foundation-settings-rbac-myloans` (pushed)

## Where things stand

- **Green and committed:** pieces 1 to 4 (piece 3 branch scope; piece 4 the working-days calendar, D-041), the myloans round 3 contract (D-040) and the "users with no branches" warning. Last full run, 17 November 2026:
  - vitest: 1,243 passed, 1 skipped;
  - full e2e (`npm run e2e:groups`, production build, workers=1): 570 passed, 0 failed (191 / 191 / 188 at 1440 / 820 / 390);
  - tsc and lint clean.
- **18 November 2026, after piece 4 (D-042, committed):** the holiday CSV import, Make inactive / active and the generic paths all go through the calendar rule; deactivation undoes only its own extensions; "Correct due dates" (`duedates:correct`, migration 019); screenshots only with `npm run docs:screenshots`; `docs/STATUS.md` (the status table). Vitest 1,249 passed, 1 skipped; tsc and lint clean; kit rebuilt after migration 019.
- **Piece 5 done (D-044):** the liquidation due date after the last LTO pickup (`lib/funds/liquidation.ts` rule, `lib/services/liquidation.ts` triggers), migration `20261119090020_liquidation_due`, the late record, the Funds / My funds line and the TAT report section; `liquidationDueDays` on Settings, Funds types. D-043 records the holiday-removal chain case.
- **Last runs (18 November 2026):** vitest green (1,272 and the 2 updated funds tests); full e2e: 194 / 194 / 191 passed with the only failure a wrong fixture in the new liquidation spec, fixed and rerun at all three widths (pass); tsc and lint clean; kit rebuilt after migration 020.
- **Piece 9 done (D-046):** the inbox engine (`lib/services/work-items.ts`, rules in `lib/work/rules.ts`), WorkItem / WorkMovement (migration `20261119090021_work_items`), wired into every hand-off; the Inbox page; the Branch DP pool (`lib/services/dp-pool.ts`); Away and Move; the supervisors' Home lines; TAT by person; `npm run work:backfill`. See the section below.
- **Last runs (18 November 2026, piece 9):** vitest 1,296 passed (the 2 guard failures fixed and rerun); full e2e 192 / 192 / 188 with 5 / 5 / 6 failures, all fixed (the job's own Accept takes the item; the pool choice outside the processor list; a file-access-log PN collision) and rerun green at all three widths; tsc and lint clean; kit rebuilt on migration 021.
- **D-047:** pieces 6, 7, 8 and 10 un-held, built on the mock: 6 → 10a → 7 → 8 → 10b → 11 (R2-3) → 12. Real API verification (C5) and the Production scheduler (hosting) are separate, blocked items.
- **D-048, done before piece 6:**
  - the Inbox waiting colours Settings card;
  - the kit accounts renamed to the current role names;
  - `npm run kit:demo` (aged items);
  - the demo script with both approval flows (`docs/DEMO_SCRIPT.md`).
- **Piece 6 done (D-047, D-048):**
  - `lib/myloans/v1`: the schema, client, mock rows, mock store, scenarios and failures;
  - the route `app/api/dev/myloans/api/dms/v1/[...path]`;
  - migration `20261119090022_myloans_mock`;
  - the Settings, System "myloans mock" panel and the "MOCK myloans data" banner;
  - `tests/contract` (`npm run test:contract`).

  See `docs/myloans/mock-and-contract.md`. Find loan and Refresh still use the old adapter (moved in 10a).
- **Next: piece 10a** (plan first). Wait for the project owner.
- **Open small items:** none from pieces 4, 5 and 9 (the funds-types CSV has `liquidation_due_days`; Correct due date is also on LA items in the Inbox).
- Decisions: `docs/DECISIONS.md` (D-001 to D-041); plan: `IMPLEMENTATION_PLAN.md` (piece 5 is section 6; myloans round 3 is 7.3).

## Piece 9: what was built (D-046)

- **One engine, `lib/services/work-items.ts`:** `arriveItem` (pool or named inbox; accepted at once for Find loan), `acceptItemTx` (conditional update: the first accept wins, the next is told who has it), `takeItem` ("counts as accept": Finance Approve / Release, the receiving LA's Receive), `closeItem` (forward, return with a required reason, done, cancel, pull back, moved), `moveItem`, `setAway` / `refuseAway`, the lists (`myItems`, `poolItems`, `itemsWithAway`), `supervisorWorkCounts`, `tatByPerson`, and `receiveReleasedLoan` (the feed hook, for piece 10). Rules (pure, tested with the six worked examples): `lib/work/rules.ts`.
- **Wiring:** Find loan and Add transaction (`loan-file.ts`, `workflow.ts`), Send (named or pool), Accept, Decline / Return, Forward, Receive (`jobs.ts`), Return to LA (`return-to-la.ts`), pull back and change processor (`sent-changes.ts`), cancellations (`workflow.ts`, `source-sync.ts`), funds request / approve / deny / release (`funds.ts`). LA items follow the calendar rule (`openDueDates`, `applyMoves`, Correct due date with subjectType `WorkItem`) and pausing holds (`extendForPause`).
- **Branch DP pool:** `assignToDp` with `dpUserId = POOL` keeps the send details on the item (transaction ASSIGNED, no job yet). `acceptFromPool` (inside the loan lock) takes the item, then `createAssignmentTx` (the send body, shared with a named send) and `acceptCore`. `takeBackFromPool` before anyone accepts.
- **Screens:** `/inbox` (My items, Branch pool, With people away; Accept, Move, Correct due date, Away), the Send panel's Branch DP pool choice, the loan file's pool line with Take it back, the supervisors' Home card (`components/home/work-counts.tsx`), the TAT report's By person tables.
- **Settings and ticks:** `pool.amberAfterDays` (1), `pool.redAfterDays` (2); `workitems:move` and `users:away` (LA Supervisor/Head and Admin).
- **Backfill:** `lib/work/backfill.ts`, `npm run work:backfill`, also at the end of the kit build. Safe to run again; items with a missing time are `migrated` and left out of TAT by person.
- **Tests:** `lib/work/rules.test.ts`, `tests/integration/work-items.test.ts` (examples, pool colours, return reason, Away, Move never late, first accept wins incl. the DP pool race, migrated left out, backfill), `tests/e2e/inbox.spec.ts`.

## Piece 4: what was built (D-041)

- **`lib/calendar/`** is the one calendar: `core.ts` (pure: `daysFor`, `addWorkingDays`, `workingDaysBetween`, `pausedDays`, `lostWorkingDays`, `dueTone`, `PAUSE_RULE_TEXT`), `load.ts` (`loadCalendar`, `getCalendar` per request), `testing.ts` (test helpers only). The old `lib/time` counters and `getHolidaySet` are gone; `no-other-counting.test.ts` forbids any other counting.
- **Whose calendar:** LA steps the loan's branch; DP steps and liquidation the processor's branch (`stepBranch` in `lib/jobs/view.ts`, `branchDayCounters` in monitoring); Finance the request's branch.
- **Migration `20261119090018_working_calendar`:** holiday kind, type, branches (`HolidayBranch`), reason, `isSample`; `HoldReason.pausesTat` (on for CLIENT-PAPERS, CLIENT-DECISION, CLIENT-CORRECTIONS, BRANCH-HEAD, FUNDS, MYLOANS-UPDATE); `DpAssignment.dueDate / targetDays / dueBranchId`; `CashAdvance.liquidationDueFrom`; `DueDateChange` log. It deleted the 13 guessed 2026 holidays the old seed made; the seed now makes 2 labelled samples (14 and 21 December 2026).
- **Saved due dates:** at accept (`acceptCore`) and at release or carry-over (`liquidationDueFields`). Moved only by `lib/services/calendar.ts` (`addCalendarEntry`, `saveWorkingDays`: the window rule, a DueDateChange and audit row per item, the owner told) or by a pausing hold's end (`extendForPause` in holds). LA work has its own saved due date per round since piece 9 (WorkItem.dueDate).
- **Screens:** Settings, Holidays and working days (`components/admin/calendar-area.tsx`, `app/actions/calendar.ts`): working days, office closure, add a holiday, each Check then Save. Chips: green / amber "N days left" / due today / red / grey "Paused" (with the plain rule on hover and for screen readers). Jobs lists sorted by due date (`sortByDue`). The job page shows the due date, how it moved and the pause rule. "Pauses TAT" on Settings, Hold reasons.
- **Not done (by decision):** waiting time and the full inbox (piece 9); liquidation's start at the last LTO (piece 5). The holiday CSV import still adds rows without the extension rule (use Settings for dates that may move due dates). Making a holiday inactive does not move a saved date back (an admin correction is not built yet).

## Earlier this session

- **Piece 3** (branch scope everywhere, D-019, D-039): the file route and its append-only log with the Audit screen; job pages by the loan's branch; own-job holds and problems; scope before every answer; the cross-branch test of every role. See D-039 and docs/workflow/07.
- **myloans round 3** (D-040): files saved; mock freshness (suffix time, replacement created_at); the planner's "superseded" decision; still waiting for the 3 vector outputs and their updated_at check.

## Things a fresh session must know

- **Both databases are on migration 022** (`20261119090022_myloans_mock`).
- **Migration 020 history:** `gdfi_dms_test` was reset (with the owner's consent) and re-seeded on 17 November 2026; the kit was rebuilt after each migration up to 020 (`gdfi_dms` holds the CLEAN kit; automatic backups in `storage/kit/backups/`). Never touch the test DB directly; use the sanctioned scripts.
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
