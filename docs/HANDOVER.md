# Handover: foundation pieces 1 to 12 done; phase A review next

Last updated: 18 November 2026 (PHT)
Branch: `feature/foundation-settings-rbac-myloans`

## Where things stand

- **Every foundation piece that can be built on the mock is built** (pieces 1 to 11, D-039 to D-054); piece 12 (D-055) added backups of the database and the uploaded files, the security headers, the volume test, the go-live runbook and the UAT checklist. Status table: `docs/STATUS.md`. Decisions: `docs/DECISIONS.md` (D-001 to D-055).
- **Last full runs:** see the piece 12 release note at the end of `docs/STATUS.md`.
- **Go-live:** `docs/GO_LIVE_RUNBOOK.md` (Entra sign-in, scheduler, first load, backups, the go-live day checklist, rollback); `docs/UAT_CHECKLIST.md` (per role, with sign-off).
- **Per module:** `docs/checklists/` (status, where, who, settings, evidence, UAT check per feature); gaps to a phase A go-live: `docs/PHASE_A_GAPS.md`.
- **Workflow (business view):** `docs/workflow/`. Scheduling: `docs/SCHEDULER.md`. Environment: `docs/ENVIRONMENT.md`. Manual testing: `docs/MANUAL-TEST-KIT.md`, the demo `docs/DEMO_SCRIPT.md`.

## Piece 12 commands (D-055)

| Command | What |
|---|---|
| `npm run backup` | One set (`gdfi-dms-YYYYMMDD-HHMMSS/`: `db.dump`, `files/`, `manifest.json` with SHA-256) to `BACKUP_TARGET` (folder or s3); prunes sets older than `BACKUP_KEEP_DAYS` |
| `npm run restore -- --into=<new db> --files-into=<empty dir> [--set=<name>] [--list]` | Checks every checksum, then restores into a clean copy only |
| `npm run volume -- create` / `measure` | `gdfi_dms_volume_test` with 15,000 loans; timings of the main screens (all under 100 ms on 18 November 2026) |

## Things a fresh session must know

- **Both databases are on migration 031** (`20261119090031_branch_ids_lto_sample`). The next is `20261119090032_<name>`.
- **Migration 020 history:** `gdfi_dms_test` was reset (with the owner's consent) and re-seeded on 17 November 2026; the kit was rebuilt after each migration up to 020 (`gdfi_dms` holds the CLEAN kit; automatic backups in `storage/kit/backups/`). Never touch the test DB directly; use the sanctioned scripts.
- **File access log rows keep their user forever** (append-only, `ON DELETE RESTRICT`). In tests, only seeded users that are never deleted (such as Test Admin) may open files or export the log; a temporary `zz.` user who does can never be removed, and every test that cleans `zz.` users then fails (this happened once; it took a test DB reset to fix).
- **Migrations:** never `prisma migrate dev`. Use `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script`, put it in the next numbered folder (`20261119090032_...`), remove the trigram DROP INDEX lines, apply with `npm run db:deploy`, then print the folder list and `npx prisma migrate status`. Full rules: `CLAUDE.md`.
- **The project owner's dev server is on port 3000.** Never touch it. The e2e tests use their own server on port 3100. A production build (`next build`) is allowed only when the project owner says the dev server is stopped.
- **Memory:** run vitest and e2e one after the other, never together. Long e2e runs were stopped twice by low memory; use `npm run e2e:groups` (workers=1, one group at a time). If memory runs low, stop and report the group, then resume from there later.
- **Destructive commands** (`db:reset-seed`, `kit:*`) only when the project owner approves; `ALLOW_DESTRUCTIVE=1` only for that one command.
- **Fake data only.** Replace real-looking PN # values with `<SAMPLE-PN>`. Never connect to the myloans database: API only, mocked locally (`lib/myloans/r2/`).
- **Shell quirk:** bash heredocs containing quotes sometimes fail in this environment; write edit scripts to the scratchpad with the Write tool and run them.
- **Never run `prisma generate` while an e2e run is going:** the running server then breaks on the new client.
- **Commit only after reading the test result:** never chain `git commit` after a test or scan command (twice a commit went in with a failing secret scan).
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
