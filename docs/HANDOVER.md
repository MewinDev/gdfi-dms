# Handover: piece 3 in progress

Last updated: 17 November 2026 (PHT)
Branch: `feature/foundation-settings-rbac-myloans`

## Where things stand

- **Green and committed:** pieces 1, 2, 3a (product classification), the piece 2 review (D-028 to D-036), the birth date removal (D-037) and the Finance grant fix (D-038). The last full green run (before the piece 3 work):
  - full e2e: 564 passed, 0 failed, 3 skipped;
  - vitest: 1,171 passed and 1 skipped, with the 3 test fixes that followed green too;
  - tsc and lint clean.
- **Piece 3 (branch scope everywhere): started, committed as WIP and UNTESTED** (`b152f22`). Decisions: D-019, D-039.
- Decisions are in `docs/DECISIONS.md` (D-001 to D-039); the plan is `IMPLEMENTATION_PLAN.md` (piece 3 is §4).

## Piece 3: done (untested)

- **One file route** `app/api/files/[kind]/[id]/route.ts`:
  - kinds `receipt`, `stage` (with `?field=`) and `lto-proof` (only LTO drop-off and pick-up stages); `?download=1` downloads;
  - session required, branch scope via `lib/services/files.ts` (which uses `mayOpenReceipt` / `mayOpenStageFile` in `lib/services/file-access.ts`), 404 otherwise;
  - a `FileAccessLog` row per view or download; no-store, nosniff and a sandbox CSP.
- **Old routes removed:** `app/api/receipts` and `app/api/stage-files`. Funds and My funds link with `fileHref()`.
- **Migration `20261119090017_file_access_log`:**
  - the `FileAccessLog` table, with an append-only trigger (`dms_file_access_log_append_only`, which refuses UPDATE and DELETE);
  - adds `audit:files` ("View file access log") to the ADMIN and SUPERADMIN roles.
  - The permission is defined in `lib/auth/permissions.ts` (`FILES_LOG_VIEW`) and added to `KEYS_ADDED_D031`, so the role migration ignores it when comparing defaults.
- **Scope gaps found by the action and detail-page audit, now fixed:**
  - reusable papers are listed and copied only from in-scope related loans (`reusablePapers(db, id, user)` and `copyReusablePapers`);
  - both test simulators check scope (`lib/services/simulator.ts`, `simulateSourceChange`);
  - `moveCashToNewPn` re-checks the new loan's branch.

## Piece 3: still to do

1. **Decisions D-039 in code:**
   - **Job pages:** `canSeeJob` in `lib/services/jobs.ts` (around line 66-71). Own job: any branch. Otherwise require `inScope(user, loan.branchId)` (today, someone with jobs:work is checked against the processor's branch, `dpBranchId`). Stage files inherit this through `mayOpenStageFile`.
   - **Funds exception:** `grantException` in `lib/services/funds.ts` (around line 679). Refuse unless the processor works in a branch in the Finance user's scope (All branches = any).
   - **Holds and problems on the processor's own job:** `lib/services/holds.ts` (raise around :55, resume around :84, details around :110) and `lib/services/jobs.ts` (raise problem around :515, resolve around :531, outside control around :548). These check `inScope(loan.branchId)` before the owner check: allow when the job is the user's own.
   - **No dead buttons:** wherever an action is refused for scope, hide it or disable it with the reason (job page buttons in `app/(app)/jobs/[id]/page.tsx` around :95 and :284).
2. **Early "already approved" answers before the scope check** in `lib/services/funds.ts`: decideAdvance (around :321), decideTopUp (around :516) and decideCarryOver (around :574). Call `needSee` first.
3. **File access log screen** (Audit, File access log; `audit:files`):
   - filters: user, branch, PN #, file type, date range;
   - a CSV export that writes its own `FileAccessLog` row (entityType `FILE_ACCESS_LOG`, action `EXPORT`);
   - add it to the Audit navigation.
4. **The remaining items of the plan's §4:**
   - lists and counts by branch (mostly done in D-030; re-check against the plan's list: Notifications, Reports, Open Items, search suggestions);
   - every detail page and action 404 out of scope (audited; see the fixes above and item 1);
   - a test that there is no stored file under `public/`.
5. **Cross-branch test for every role, Finance first.** For every seeded role, a user in branch A tries branch B's list (absent), count (not counted), detail (404), each action (404) and each file kind (404, with a log row only for allowed views). A user with no scope sees nothing. The existing tests `tests/integration/branch-scope-home.test.ts` and `tests/integration/finance-scope.test.ts` are the pattern.
6. **Update tests that used the old routes:** grep `api/receipts` and `api/stage-files` in `tests/`, if any.
7. **Run, one at a time:**
   1. `npm run db:create-test` (applies migration 017 to the test DB);
   2. `npm run kit:rebuild -- --confirm=RESET` (the kit baseline is out of date after migration 017; approved);
   3. full vitest;
   4. tsc and lint;
   5. full `npm run e2e:groups` (production build on port 3100, workers=1, one group at a time).
8. Commit piece 3 as green, then the summary to the project owner. **Stop before piece 4.**

## Things a fresh session must know

- **Migration `20261119090017_file_access_log` is applied to `gdfi_dms` but NOT to `gdfi_dms_test`.** Run `npm run db:create-test` before any vitest or e2e run. Never touch the test DB directly (a direct psql UPDATE was refused before); use the sanctioned scripts.
- **The kit baseline is out of date** after migration 017: `kit:reset` will refuse until `npm run kit:rebuild -- --confirm=RESET` runs.
- **Stale `.next*` folders:** `.next`, `.next-e2e` and `.next-e2e-prod` hold generated `types/validator.ts` files that still point at the two deleted routes, so `npx tsc --noEmit` reports errors in them. They regenerate on the next `next dev` / `next build`; ignore errors under `.next*`, or delete those folders while no server is running. Source code type-checks clean.
- **Migrations:** never `prisma migrate dev`. Use `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script`, put it in the next numbered folder (`20261119090018_...`), remove the trigram DROP INDEX lines, apply with `npm run db:deploy`, then print the folder list and `npx prisma migrate status`. Full rules: `CLAUDE.md`.
- **The project owner's dev server is on port 3000.** Never touch it. The e2e tests use their own server on port 3100. A production build (`next build`) is allowed only when the project owner says the dev server is stopped.
- **Memory:** run vitest and e2e one after the other, never together. Long e2e runs were stopped twice by low memory; use `npm run e2e:groups` (workers=1, one group at a time). If memory runs low, stop and report the group, then resume from there later.
- **Destructive commands** (`db:reset-seed`, `kit:*`) only when the project owner approves; `ALLOW_DESTRUCTIVE=1` only for that one command.
- **Fake data only.** Replace real-looking PN # values with `<SAMPLE-PN>`. Never connect to the myloans database: API only, mocked locally (`lib/myloans/r2/`).
- **Shell quirk:** bash heredocs containing quotes sometimes fail in this environment; write edit scripts to the scratchpad with the Write tool and run them.
- **Known issue:** a dev-only React key warning on Funds (`docs/KNOWN_ISSUES.md`); run e2e on the production build.

## CI (after piece 3)

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
