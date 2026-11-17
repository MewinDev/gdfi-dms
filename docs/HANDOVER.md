# Handover: piece 3 done; stop before piece 4

Last updated: 17 November 2026 (PHT)
Branch: `feature/foundation-settings-rbac-myloans`

## Where things stand

- **Green and committed:** pieces 1, 2, 3a, the piece 2 review (D-028 to D-036), D-037, D-038 and **piece 3 (branch scope everywhere, D-019, D-039)**. Last full run, 17 November 2026:
  - vitest: 1,210 passed, 1 skipped;
  - full e2e (`npm run e2e:groups`, production build, workers=1): 564 passed, 0 failed, 3 skipped (189 / 189 / 186 at 1440 / 820 / 390);
  - tsc and lint clean.
- **Next: piece 4 (one working-days calendar, D-018), not started.** Wait for the project owner.
- Decisions are in `docs/DECISIONS.md` (D-001 to D-039); the plan is `IMPLEMENTATION_PLAN.md` (piece 4 is §5).

## Piece 3: what was built

- **One file route** `app/api/files/[kind]/[id]/route.ts` (receipt, stage, lto-proof), session required, branch scope on the parent record, 404 otherwise, a `FileAccessLog` row per view or download. Old routes removed. Migration `20261119090017_file_access_log` (append-only trigger; `audit:files` for Admin and Superadmin).
- **Audit, File access log** (`app/(app)/admin/audit/files`, `lib/services/file-access-log.ts`): filters user, branch, PN #, file type, date range, within the reader's branches; Download CSV (`app/api/audit/files`) writes its own row (`FILE_ACCESS_LOG`, `EXPORT`); export rows have no branch, so only All-branches readers see them. Tabs with the Audit log; with only `audit:files`, Audit opens on it.
- **D-039:** jobs by the loan's branch, own job anywhere (`canSeeJob`); holds and problems on the processor's own active job (`inScopeOrOwnJob`); funds exception only to processors who work in the Finance person's branches (`worksInScope`, `exceptionTargets`); job page hides buttons the server would refuse for scope (loan file link replaced by "The loan file is in {branch}, outside your branches").
- **Scope first:** decideAdvance, decideTopUp, decideCarryOver call `needSee` before the "already approved" answer; job actions (`withJob`) check the role, then answer "Job not found." for a job the person cannot see.
- **Also fixed:** notifications (list, Home preview, unread count) within scope; `copyReusablePapers` (the "belong to the borrower" message was unreachable); the receipt store refuses a folder under `public/`.
- **Tests:** `tests/integration/cross-branch-roles.test.ts` (every built-in role, Finance first), `scope-d039.test.ts`, `file-access-log.test.ts`, `lib/storage/no-public-files.test.ts`, e2e `file-access-log.spec.ts`.

## Things a fresh session must know

- **Both databases are on migration 017.** `gdfi_dms_test` was reset (with the owner's consent) and re-seeded on 17 November 2026; the kit was rebuilt the same day (`gdfi_dms` now holds the CLEAN kit; backup `storage/kit/backups/pre-reset-20261117-065433.dump`). Never touch the test DB directly; use the sanctioned scripts.
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
