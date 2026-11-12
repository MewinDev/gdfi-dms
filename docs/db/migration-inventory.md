# Migration inventory (before the squash)

What the 32 migrations `20261106060100_init` to `20261119090013_myloans_shared_limits` did beyond the plain tables, columns, enums, indexes and foreign keys that `prisma/schema.prisma` already describes. Written on 12 November 2026 for the squash into `20261119090014_baseline` ([squash notes](squash-notes.md)). The old files are kept outside the project in `C:\Users\GD - MERIN\gdfi-dms-backup\migrations-before-squash\` and in Git history.

Last updated: 12 November 2026 (PHT)

How this list was made: every migration file was read, then searched for extensions, functions, triggers, views, check constraints, partial and expression indexes, collations, sequences, `INSERT`, `UPDATE`, `DELETE` and `array_replace`. A new empty database built from the 32 migrations was then inspected (extensions, functions, triggers, views, constraints, every index definition, enum order, and every row left in it), so nothing that only the database shows was missed.

## 1. Extensions and the indexes that need them

| Item | Exact SQL | From | In the baseline |
|---|---|---|---|
| `pg_trgm` | `CREATE EXTENSION IF NOT EXISTS pg_trgm;` | 20261116090000_myloans_load | Block 1 (first) |
| Loan search by PN | `CREATE INDEX "Loan_pn_trgm_idx" ON "Loan" USING gin ("pn" gin_trgm_ops);` | 20261116090000_myloans_load | Block 3 |
| Loan search by borrower name | `CREATE INDEX "Loan_borrowerName_trgm_idx" ON "Loan" USING gin ("borrowerName" gin_trgm_ops);` | 20261116090000_myloans_load | Block 3 |

No other index uses an extension. `plpgsql` is built into PostgreSQL (not created by a migration).

## 2. Raw SQL Prisma cannot express

Prisma ignores all of these: they never show in `prisma migrate diff`, in either direction. A generated migration only ever tries to drop the two trigram indexes (the reason for the "remove the drop index lines" rule in CLAUDE.md).

| Kind | Item | Exact SQL (or summary) | From | In the baseline |
|---|---|---|---|---|
| Partial unique index | One open hold per transaction | `CREATE UNIQUE INDEX "Hold_one_open_per_transaction" ON "Hold"("transactionId") WHERE "resumedAt" IS NULL;` | 20261109090000_holds | Block 3 |
| Partial index | Loans due for the MyLoans sync | `CREATE INDEX "Loan_due_idx" ON "Loan" ("nextCheckAt") WHERE "syncTier" IS NOT NULL;` | 20261116090000_myloans_load | Block 3 |
| Check constraint | Missing state agrees with the tick | `ALTER TABLE "ChecklistCheck" ADD CONSTRAINT "ChecklistCheck_missing_state_check" CHECK ("missingState" IS NULL OR ("missingState" = 'MISSING' AND NOT "checked") OR ("missingState" = 'RECEIVED_LATE' AND "checked"));` | 20261119090009_missing_papers | Block 3 |
| Check constraint | Missing remarks 5 to 500 characters | `ALTER TABLE "ChecklistCheck" ADD CONSTRAINT "ChecklistCheck_missing_remarks_check" CHECK ("missingRemarks" IS NULL OR char_length("missingRemarks") BETWEEN 5 AND 500);` | 20261119090009_missing_papers | Block 3 |
| Function | `dms_renumber_advances()` (PL/pgSQL): renumbers a request whose number does not start with its funds type's code, changes every stored copy of the old number, keeps it in `formerNumbers`, writes a history row; re-runnable | Copied whole (95 lines) | 20261119090006_decisions_batch | Block 3. Kept: re-runnable by hand and called by `tests/integration/decisions-batch.test.ts` |
| One-off run | `DO $$ ... SELECT * FROM dms_renumber_advances() ... $$` (ran the function once on that day's data) | | 20261119090006_decisions_batch | Dropped: a new database has no requests to renumber |

None of the migrations made a trigger, a view, a sequence, a collation or an expression index. Column defaults Prisma cannot express: none (the `fundstype_ca` defaults on `CashAdvance`, `CashAdvanceTopUp` and `ApprovalBand` are in the schema as `@default("fundstype_ca")`).

## 3. Data steps

"Fresh database" means a new, empty database (Supabase at go-live, `npm run db:create-test`, the kit rebuild). Every step that reads existing rows (`UPDATE`, `DELETE`, `INSERT ... SELECT`) does nothing on an empty database, so only steps with literal rows can matter there.

### 3a. Kept in the baseline (a fresh database needs it)

| Data | From | Why |
|---|---|---|
| Expense kinds: `NOTARY_FEE` Notary fee, `PPSR_FEE` PPSR fee, `LTO_FEE` LTO fee, `TRANSPORT` Transport, `OTHER` Other (built in, last); ids `xk_*` | 20261119090005_expense_kinds | The seed does not create them, and cash-advance rules and lines point at a kind by code (foreign keys `CashAdvanceRule_kind_fkey`, `CashAdvanceLine_kind_fkey`). Without them `prisma/seed.ts` stops at its cash-advance rules. Block 4 of the baseline, same rows and ids. |

### 3b. Dropped: the seed creates it (one holder only)

`prisma/seed.ts` runs after the migrations on every fresh database (`db:create-test`, the kit rebuild, `npm run db:seed:reference` on Supabase). It is the only holder of these:

| Data | From (old migrations) | Held by |
|---|---|---|
| Problem reasons (7: LTO down, LTO closed, Long queue, Missing paper, Wrong paper, Waiting, Other) | 20261107120000_funds_dp_problems | seed `PROBLEM_REASONS` (same codes, names and order) |
| Hold reasons (the 7 proposed ones and Other) | 20261109090000_holds, 20261118090000_hold_lock_reasons | seed `HOLD_REASONS` (same codes, names and order, Proposed) |
| Return reasons (4) | 20261111090000_return_to_la | seed `RETURN_REASONS` |
| Missing paper reasons (5) | 20261119090009_missing_papers | seed `MISSING_REASONS` |
| Funds types Cash advance and Fund transfer (ids `fundstype_ca`, `fundstype_ft`) | 20261119090001_funds_types | seed `SEEDED_FUNDS_TYPES` (`lib/funds/types.ts`, same ids) |
| Approval bands (any amount, Finance, per type) | 20261107120000_funds_dp_problems, 20261119090007_funds_per_type | seed (one band per funds type) |
| Operations Monitor and Branch Supervisor roles | 20261119090002_monitoring, 20261119090006_decisions_batch | seed `ROLE_DEFAULTS` (`lib/auth/permissions.ts`); the seed also skips the Branch Supervisor when a role of that name was made by hand, as the migration did |
| Processing stages | 20261117090000_job_stages (`INSERT ... SELECT` from transaction types: nothing on an empty database) | seed `DEFAULT_OWN_STAGES`, `DEFAULT_SYSTEM_STAGES` |

Differences a fresh database shows after the seed, compared with the 32 migrations and the seed (all checked, none changes what the app does):

- The reason rows get generated ids instead of `pr_*`, `hr_*`, `rr_*`, `mpr_*`. Nothing in the code refers to these ids (searched).
- The three first testing hold reasons (`BORROWER`, `OTHER-TEAM`, `LTO-SCHEDULE`), which 20261118090000_hold_lock_reasons switched off, are not created. A new database has no hold that used them.
- The Branch Supervisor's ticks are stored in `ROLE_DEFAULTS` order (the same 10 ticks).
- No `dp.defaultCapacity` row in `Setting`. The code default is the same value, 10 (`lib/settings.ts`); the row is written the first time an Admin changes it.

### 3c. Dropped: it only fixed or moved old data (not needed on a fresh database)

| From | What it did |
|---|---|
| 20261106113854_checklist_required | Set `required` on existing checklist rules and checks from their kind |
| 20261106144042_settings_inactive_and_document_types | Marked the four built-in transaction types; copied a document type's default original or copy from its checklist rules |
| 20261106161431_roles_and_access | Marked the seeded roles built in; `loans:view_all` became Branch access All; the old coarse keys (`workflow:la`, `admin:settings` and so on) became the specific ticks |
| 20261107120000_funds_dp_problems | Kept the old single-loan cash advances in a temporary table, deleted them, turned them into the transaction's funds flag with a note; filled funds needed and labels printed from old rows; set the cash-advance rules' expense kind; new ticks for LA, DP and Finance |
| 20261108090000_pasuyo | Tick `jobs:pasuyo` for DP; a history row for jobs that already had a second processor |
| 20261109090000_holds, 20261111090000_return_to_la | New ticks for LA and DP and for whoever changed problem reasons |
| 20261110090000_journey | Filled the actor name on past custody movements; tick `journey:view_amounts` for Finance and Approvers |
| 20261112090000_needs_lto | Needs LTO on for Notary, PPSR and Mortgage (the seed sets it) |
| 20261113090000_email_outbox, 20261114090000_myloans_sync | Ticks for Admin; reusable on for the ID and SPA checklist rules (the seed sets it) |
| 20261116090000_myloans_load | Sync tier and next check for open loans; the first snapshot of each loan marked as the base copy |
| 20261117090000_job_stages | Stage rows (all Done, marked migrated) for jobs completed before stages existed |
| 20261118090000_hold_lock_reasons | Copied the reason name onto old holds; renamed `settings:hold_reasons` to `holds:manage` (`array_replace`) |
| 20261119090000_hold_transfer_and_papers_back | Hold owner from the person who raised it; removed `holds:resolve_any`; `holds:transfer` for Finance (later taken away again) |
| 20261119090001_funds_types | Every existing request and top-up became a Cash advance |
| 20261119090002_monitoring | Tick `ltoreports:create` for DP |
| 20261119090003_pn_branches | Non-3-digit branch codes moved to `legacyCode`; home branch, All branches and branch grants built from the old `user_branch_access` rows |
| 20261119090004_permissions_pass | Renamed `source:review`, `source:manage`, `settings:branches` (`array_replace`); new ticks to roles that could already do the thing; stored Admin's full list; All branches stored on Admin's people |
| 20261119090005_expense_kinds | Expense-kind ticks to the roles that see or approve funds (the kind rows themselves are kept, 3a) |
| 20261119090006_decisions_batch | `funds:print` to roles that saw all funds; `holds:transfer` taken from Finance; renumbered requests (the function is kept, 2) |
| 20261119090007_funds_per_type, 20261119090008_funds_edit_split | Split the funds ticks per type (Cash advance, Fund transfer) and the Edit tick; removed `funds:view`; copied every approval band to Fund transfer |
| 20261119090009_missing_papers | Marked optional papers already ticked as part of the file; paper ticks to the roles that tick papers |
| 20261119090010_remove_labels | Removed `labels:print` from every role; deleted the `P3_LABELS` turnaround target |
| 20261119090012_borrower_details | Copied each loan's address and contact number from its latest MyLoans copy; gave the new Borrower review tick to the Branch Supervisor, Admin and fund approvers |
| 20261119090013_myloans_shared_limits | Renamed that Borrower review tick to `myloans:review_borrower` (`array_replace`, then removed the old key) |

The code still reads a role saved with an old key the new way (`RENAMED_PERMISSIONS` and `SPLIT_PERMISSIONS` in `lib/auth/permissions.ts`), so a role restored from an old backup keeps working.

## 4. Migrations compared with schema.prisma

- In the migrations but not in `schema.prisma`: exactly the items in sections 1 and 2 (the extension, two trigram indexes, two partial indexes, two check constraints, one function). `schema.prisma` mentions `Loan_due_idx` and the check constraint in comments only.
- In `schema.prisma` but not in the migrations: nothing. Before the squash, `prisma migrate diff` from `gdfi_dms` and `gdfi_dms_test` to the schema printed only the two trigram "drop index" lines.
- Column order: 24 tables had columns added later with `ALTER TABLE ADD COLUMN`, so on an old database those columns come last; the baseline creates them in schema order. Only SQL that depends on column position would notice; the only `SELECT *` in the project reads the function's fixed result columns. Enum value order is the same.
