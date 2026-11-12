# Migration squash notes

On 12 November 2026 the 32 migrations in `prisma/migrations/` were replaced by one baseline, `20261119090014_baseline`, which builds the whole database in one step. No app code, rule or screen changed, and no data was lost. This was done before go-live because there was no production database yet. **After go-live no squash is allowed:** the live database's migration history must never be rewritten.

Last updated: 12 November 2026 (PHT)

## What was squashed

- **Before:** 32 folders, `20261106060100_init` to `20261119090013_myloans_shared_limits` (2,819 lines of SQL). What each one did beyond plain tables is in the [migration inventory](migration-inventory.md).
- **After:** `prisma/migrations/20261119090014_baseline/migration.sql` and `migration_lock.toml`. Its four blocks, each commented with its reason:
  1. `CREATE EXTENSION IF NOT EXISTS pg_trgm;`
  2. The tables, enums, indexes and foreign keys, generated with `npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script`.
  3. The SQL Prisma cannot express, copied exactly from the old migrations: the two loan-search trigram indexes, the partial indexes `Hold_one_open_per_transaction` and `Loan_due_idx`, the two `ChecklistCheck` check constraints and the function `dms_renumber_advances()`.
  4. The expense kinds, the only data a new database needs that the seed does not create.
- New migrations start after it (`20261119090015_<name>`, then `20261119090016_<name>`, and so on). The rules in CLAUDE.md are unchanged: `prisma migrate diff` only, never `prisma migrate dev`, remove the trigram "drop index" lines, run `npm run migrate:check`.
- `npm run migrate:check` (`lib/db/migration-check.ts`) now expects the baseline first and nothing before it. It still fails when a trigram index is missing, and it says in plain words when a database still lists the migrations from before the squash.

## How it was proved the same

Two throwaway databases on the local Docker server: `gdfi_dms_squash_old` (the 32 old migrations applied in order with `prisma migrate deploy`) and `gdfi_dms_squash_new` (the baseline alone, also with `prisma migrate deploy`).

| Check | Result |
|---|---|
| `prisma migrate diff --from-url <old> --to-url <new>`, and the other way round | Both: "This is an empty migration." |
| `pg_dump --schema-only` of both, statements sorted, `_prisma_migrations` left out | Identical (408 statements) apart from column order inside 24 tables |
| Column order | The old migrations added columns later with `ALTER TABLE ADD COLUMN`; the baseline creates them in schema order. Nothing depends on position: the only `SELECT *` reads the function's fixed result columns. |
| Enum value order (38 enums) | Identical |
| Extensions, every index with its definition (154), constraints (66 primary keys, 103 foreign keys, 2 checks), functions, triggers (none), views (none) | Identical, except that the old copy of `dms_renumber_advances()` has carriage returns at the line ends (from how the old file was applied). The text is otherwise the same, and no string in it spans a line, so it behaves the same. |
| Rows after the seed (every table, ids and times left out) | Same, except the 4 explained items in the inventory (section 3b): reason ids, three switched-off testing hold reasons, the order of the Branch Supervisor's ticks, and the `dp.defaultCapacity` row (code default 10). |
| `gdfi_dms` and `gdfi_dms_test` against `gdfi_dms_squash_old` (catalog and schema dump) | Identical apart from an empty `COMMENT ON SCHEMA public` left by an earlier `prisma migrate reset` |
| The clean kit and the kit with scenarios on a database built from the baseline | `tests/integration/kit.test.ts` (it empties the test database, runs `migrate deploy`, the seed and both kit builders) |
| `npm run db:create-test` on a new, empty `gdfi_dms_test`, then the full Vitest suite and Playwright | Vitest 1002 of 1003 (the failure expected the switched-off testing hold reasons: test fixed, its file passed); a second full run had one unrelated failure in `tests/integration/myloans-sync.test.ts:195` (an unordered `findFirstOrThrow` picks an older audit row left on the test database); Playwright on a production build, 1440: 153, 820: 153, 390: 150 passed (3 desktop-only skips), 0 failed |

The throwaway databases were dropped at the end.

## What was done to the two real databases

`gdfi_dms` and `gdfi_dms_test` were not rebuilt; their schema was already identical (above). In each one the 32 rows of `_prisma_migrations` were deleted, and `npx prisma migrate resolve --applied 20261119090014_baseline` recorded the baseline as applied (its checksum matches the file). After that `npm run migrate:check` and `npx prisma migrate status` were clean, and the row count of every one of the 66 data tables was the same as before. The old `_prisma_migrations` rows were also saved as CSV in the session's scratch folder.

`gdfi_dms_test_a` and `gdfi_dms_test_b` (left over from an earlier run, stopped at 20261119090004 and not used by any script) were backed up and left untouched. If they are needed again, drop them and use `npm run db:create-test`.

## Backups and how to restore

Everything is outside the project in `C:\Users\GD - MERIN\gdfi-dms-backup\`:

- `migrations-before-squash\`: the whole `prisma/migrations` folder as it was (32 folders and `migration_lock.toml`).
- `gdfi_dms-before-squash-20261112-0345.dump`, `gdfi_dms_test-before-squash-20261112-0345.dump`, `gdfi_dms_test_a-...` and `gdfi_dms_test_b-...`: `pg_dump -Fc` (custom format) of each database, taken before anything changed.

To go back to the old migrations (only before go-live):

1. Delete `prisma/migrations/20261119090014_baseline` and copy the 32 folders back from `migrations-before-squash\` (or `git checkout -- prisma/migrations lib/db` before this change is committed).
2. Restore each database from its dump (this replaces its contents with the copy from before the squash):

   ```powershell
   $c = docker compose ps -q gdfi-dms-db
   docker cp "C:\Users\GD - MERIN\gdfi-dms-backup\gdfi_dms-before-squash-20261112-0345.dump" "${c}:/tmp/restore.dump"
   docker exec $c pg_restore -U gdfi -d gdfi_dms --clean --if-exists --no-owner --single-transaction /tmp/restore.dump
   docker exec $c rm /tmp/restore.dump
   ```

   Same for `gdfi_dms_test` with its own dump. Stop the dev server first (or it holds connections).
3. Run `npm run migrate:check` and `npx prisma migrate status`.

To keep the baseline but bring back data from an old dump (for example a database restored from one of these dumps or from a kit backup saved before the squash): the schema is the same, so only the history needs changing. Run `DELETE FROM _prisma_migrations;` in that database, then `npx prisma migrate resolve --applied 20261119090014_baseline`. `npm run migrate:check` says when this is needed. The Manual Test Kit refuses to restore its own backups saved before the squash ("saved with other migrations"); run `npm run kit:rebuild` for a new baseline.

## Supabase at go-live

Supabase starts from the baseline:

1. Point `DATABASE_URL` and `DIRECT_URL` at the Supabase database (in the shell or the host's variables, never in a committed file).
2. `npm run migrate:check`, then `npx prisma migrate deploy`: it applies `20261119090014_baseline` (the extension, every table, the hand-written SQL and the expense kinds) and any later migration in order. `npm run migrate:check` again confirms both search indexes.
3. `npm run db:seed:reference`: roles, reasons, funds types, approval bands and the rest of the reference data (never test users).

Check at go-live: Supabase normally installs extensions in its `extensions` schema. `CREATE EXTENSION IF NOT EXISTS pg_trgm` and the unqualified `gin_trgm_ops` in the baseline work when that schema is on the search path, which it is by default on Supabase; if `pg_trgm` is already enabled in the dashboard, the line does nothing.
