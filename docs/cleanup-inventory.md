# Repo cleanup inventory (step 1 of 2: list only)

Last updated: 13 November 2026 (PHT)

Nothing was deleted, moved or edited to make this list. Step 2 removes only what the business approves here.

## Step 2 result (13 November 2026)

The business approved sections 1a, 1b and 4, the two unused files and the README edits. Each step was checked before the next; no step was reverted.

| Section | Result | Files | Size |
|---|---|---|---|
| 1a Superseded screenshots | **Done** (`git rm`). It was 216 images + 1 CSV (the first count said 217 images) | 217 | 31.30 MB |
| 1b Only-picture screenshot folders | **Done**: all 12 folders | 193 | 29.00 MB |
| 1c Spec-written screenshots | **Kept**: the specs write them on every run | | |
| 2 Docs | **Kept**, all of them. The six stale README lines were **edited** (see below) | | |
| 3 Sample and kit text | **Kept**: all used | | |
| 4 Unused files | **Done**: `filters-sheet.tsx`, `loan-row.tsx`. **Kept**: `lib/storage/index.ts` (the Supabase stub, business decision), `scripts/kit-build.ts`, `prisma/schema.prisma` | 2 | 3 KB |
| 4 Unused names | **Done**: 57 names here and `assertDestructiveAllowed` in the next row, so 58 of the 59 to decide (the inventory's 60 include `entraProvider`). **Kept**: `entraProvider` and its type `AuthProvider` (the planned Microsoft sign-in; the type is the shape that provider follows and holds the file's doc comment) | in 37 files | 597 lines removed in all |
| 4 `assertDestructiveAllowed` | **Done** (removed): `destructiveRefusal` and stricter guards cover every destructive script (below) | | |
| 5 Build and output folders | **Not a repo change**: the owner runs the command below | | |
| 6 Other clutter | **Kept**: nothing found to remove | | |
| 7 Repo weight | Tracked: 1,469 files and 142.2 MB before; **1,057 files and 81.9 MB after** (543 PNG, 76.7 MB). `.git` not rewritten | 412 | 60.3 MB |

Removed with the dead names, because only the removed code used them:
- `components/loan/forms.tsx`: the types `ChecklistLine` and `AssignOptions` and the helpers `KIND_TITLE` and `groupLines`.
- `components/chips.tsx`: `STAGE_TONE` and `TXN_STATUS`.
- `lib/services/queries.ts`: `rank`.
- `lib/ui/plain.ts`: `NUMBER_WORDS`.
- The imports that became unused in 12 files.

The server actions those old forms imported (`saveChecklistAction`, `recordEdstAction`, `assignToDpAction`, `resolveExceptionAction`) stay; `work.tsx` and `send-panel.tsx` use them. No name turned out to be used dynamically or by a test, so nothing was put back. `canExport` is gone, but the permission it read (`loans:export`) stays in the roles; removing a permission is a roles change, not this cleanup.

`assertDestructiveAllowed`: nothing ever called it. These guards cover the scripts:

| Script | Guard |
|---|---|
| `db:reset` | `scripts/guard-destructive.ts` (`destructiveRefusal`) |
| `test`, `test:e2e`, `e2e:groups`, `test:kit-screens` | `assertTestDatabase` (`tests/integration/helpers.ts`, `tests/e2e/db.ts`): a test database only, and `ALLOW_DESTRUCTIVE` does not change that |
| `db:create-test` | `assertTestDatabase`, and APP_ENV=local |
| `kit:reset`, `kit:restore`, `kit:rebuild` | The kit guard (`gdfi_dms`, APP_ENV=local, TEST_MODE, the sample MyLoans), plus RESET and an automatic backup. These target `gdfi_dms` on purpose |
| `db:deploy`, `db:migrate` | Not destructive (forward migrations, `migrate:check` before and after) |
| `db:seed`, `db:seed:reference` | Not destructive (upserts only) |

README lines edited (text only):
- **178:** `FindLoan` is a search box for a PN, CIN or CIF (placeholder "PN, CIN or CIF").
- **179:** the `LoanCard` row is now `HomeLoanRow` and `MyLoansList`, with their data type in `loan-card.tsx`.
- **180:** the `Stepper` has the 10 steps from the stage map, with "Step N of 10 · name" under 1024px.
- **201:** "label code (Document ID)" is now "Document ID".
- **204:** the placeholder is "PN, CIN or CIF" on every page.
- **218:** "fixed by Rule 4" is now "fixed by the Mortgage needed rule".

Every row of the README component table was checked against the code after step 4, and every export it names exists.

Links: all 108 relative links and image paths in `docs/` and the README resolve. The only misses were three `journey` image paths in this file's own size table (section 7), marked removed there.

Local disk (the owner runs this in PowerShell, with no dev server or test running):

```powershell
Remove-Item -Recurse -Force -LiteralPath "C:\Users\GD - MERIN\gdfi-dms\.next", "C:\Users\GD - MERIN\gdfi-dms\.next-e2e", "C:\Users\GD - MERIN\gdfi-dms\.next-e2e-prod"
```

Each folder is rebuilt when needed: `.next` by `npm run dev` or `build`, `.next-e2e` by `npm run test:e2e`, `.next-e2e-prod` by `npm run e2e:groups`.

Checks after all steps:
- Typecheck clean; lint 0 errors, 0 warnings.
- `migrate:check` ok (1 folder, newest `20261119090014_baseline`).
- Vitest alone: 98 of 98 files, 1,054 of 1,054 tests. Docs test 47 of 47.
- Full `npm run e2e:groups` (13 November 2026, 05:30 to 06:25 UTC, nothing else running): 188 passed at 1440 px, 188 at 820 px, 185 at 390 px (3 skipped by design); no failures.
- The run re-created none of the removed screenshots and added no new file. It rewrote 260 images inside the kept, spec-written folders (section 1c), as every run does.
- Tracked after the run: 1,057 files, 81.8 MB.

How it was checked:
- **Sizes:** tracked files (`git ls-files`).
- **Dates:** the last commit that touched the path.
- **References:** a search of every tracked text file (docs, code, tests, scripts, configs). The screenshot folders each Playwright spec writes come from the specs themselves. A file in a written folder counts as stale when the full E2E run of 12 November 2026 (17:14 UTC) did not rewrite it.
- **Unused code:** `npx knip@5`, then every flagged name searched by hand.
- **Dependencies:** `npx depcheck`, then checked by hand.

Risk levels:
- **none:** nothing refers to it and nothing rebuilds it.
- **low:** nothing refers to it, but it is a picture or note someone might like to keep.
- **check:** needs a business or owner decision first.

## Totals

| | Files | Size |
|---|---|---|
| Tracked in git now | 1,469 | 142.2 MB (137.0 MB of it is 952 PNG images) |
| Could go, risk none or low | 217 images + 1 CSV + 3 code files | about 31.3 MB |
| Could go after a decision (risk check) | 193 images | about 29.0 MB |
| **Most that could go** | **about 414 files** | **about 60 MB, 42% of the tracked size** |

The `.git` folder is 373 MB because it keeps every old screenshot. Removing files makes the checkout lighter, but `.git` does not shrink unless the history is rewritten. That is a separate business decision (section 7).

## 1. Screenshots

All images are under `docs/`. `public/` has one small tracked image, which is kept. Two kinds of folder:
- **Written:** a current Playwright spec writes it again on every run.
- **Not written:** no spec writes it any more, so it is a frozen copy from an earlier job.

### 1a. Superseded: removable (risk none or low)

Nothing refers to any of these folders or file names: no doc, test, script or kit file. A newer, spec-written set shows the same screens.

| Path | Files | Size | Last changed | Superseded by | Why it can go | Risk |
|---|---|---|---|---|---|---|
| docs/screenshots/checklist-and-send | 48 | 9.42 MB | 2026-11-09 | loan-file-next-step | Not written; the Check documents and Send screens were redesigned since | low |
| docs/screenshots/journey | 18 | 5.52 MB | 2026-11-09 | journey-v2 | `journey.spec.ts` now writes `journey-v2` only | none |
| docs/ui-v2-screenshots | 21 | 2.69 MB | 2026-11-09 | home-compact, my-loans-compact, loans-table | Not written; older design | low |
| docs/send-step-screenshots | 12 | 2.03 MB | 2026-11-09 | loan-file-next-step | Not written | low |
| docs/dp-funds-tat-screenshots | 21 | 1.89 MB | 2026-11-09 | funds-design, funds-handlers | Not written | low |
| docs/redesign-screenshots | 12 | 1.40 MB | 2026-11-09 | home-compact, my-loans-compact | Not written | low |
| docs/roles-and-access-screenshots (12 PNG and `gdfi-dms-access-matrix.csv`) | 13 | 1.38 MB | 2026-11-11 | permissions | Not written. The CSV is an old download of the access matrix; the app makes it live at `/api/settings/roles-matrix` | low |
| docs/screenshots/funds | 12 | 1.37 MB | 2026-11-09 | funds-design, funds-handlers, funds-types | Not written (the funds specs write the three newer folders) | none |
| docs/top-bar-and-settings-screenshots | 12 | 1.22 MB | 2026-11-09 | find-loan-compact, settings screens | Not written | low |
| docs/confirm-and-loans-screenshots | 15 | 1.09 MB | 2026-11-09 | loans-table, paging | Not written | low |
| docs/compact-loan-file-screenshots | 10 | 1.04 MB | 2026-11-09 | loan-file-next-step, documents-tab | Not written | low |
| docs/screenshots/layout | 5 | 0.83 MB | 2026-11-09 | home-compact | Not written | low |
| docs/screenshots/find-loan-align/before | 9 | 0.81 MB | 2026-11-11 | find-loan-align | The "before" set of a finished job; no spec writes it | none |
| Stale files inside written folders (list below) | 9 | 0.61 MB | 2026-11-11 | (none) | Their spec no longer makes them | none |
| **Total** | **217 (+ 1 CSV)** | **31.3 MB** | | | | |

The 9 stale files inside written folders:
- `find-loan-align/message-not-released-{1440,820,390}.png`
- `find-loan-compact/dropdown-outside-{1440,820,390}.png`
- `find-loan-compact/message-not-released-{1440,820,390}.png`

### 1b. The only picture of a screen: business decision (risk check)

No spec writes these and nothing refers to them. But they are the only screenshots of their screens. They date from 9 November 2026, so some screens have changed since.

| Path | Files | Size | Last changed | Screen | Risk |
|---|---|---|---|---|---|
| docs/screenshots/jobs-and-dp | 39 | 5.28 MB | 2026-11-09 | Processor job screens | check |
| docs/screenshots/email | 21 | 4.77 MB | 2026-11-09 | Email settings and outbox | check |
| docs/screenshots/related-loans | 21 | 3.74 MB | 2026-11-09 | Related loans, copy papers, replacement | check |
| docs/screenshots/lto | 21 | 3.41 MB | 2026-11-09 | LTO office screens | check |
| docs/screenshots/myloans-sync | 18 | 3.27 MB | 2026-11-09 | MyLoans change review | check |
| docs/pasuyo-and-switcher-screenshots | 15 | 1.95 MB | 2026-11-09 | Pasuyo, transaction switcher | check |
| docs/users-import-inactive-screenshots | 15 | 1.88 MB | 2026-11-09 | Users import, inactive users | check |
| docs/required-and-settings-screenshots | 12 | 1.62 MB | 2026-11-09 | Required papers settings | check |
| docs/screenshots/dp-stages | 13 | 1.26 MB | 2026-11-09 | Job stages | check |
| docs/screenshots/environment | 9 | 0.72 MB | 2026-11-09 | Environment banner and checks | check |
| docs/screenshots/processing-stages-settings | 6 | 0.71 MB | 2026-11-09 | Settings, Processing stages | check |
| docs/screenshots/receiving | 3 | 0.37 MB | 2026-11-09 | Receiving | check |
| **Total** | **193** | **29.0 MB** | | | |

Proposal: remove them. The app and its specs are the record, and git history keeps the old pictures. If the business wants a current picture of a screen, add a screenshot step to that screen's spec (lto, related-loans, myloans-sync and pasuyo already have specs).

### 1c. Keep: written by a current spec, or referred to

| Path | Files | Size | Written by | Referred to by |
|---|---|---|---|---|
| docs/screenshots/paging | 12 | 11.00 MB | paging.spec | 09-status |
| docs/screenshots/hold-and-return | 51 | 8.52 MB | hold-and-return, transfer-and-papers | |
| docs/screenshots/loan-file-next-step | 21 | 5.73 MB | loan-file-next-step | 2 images named in a doc |
| docs/screenshots/journey-v2 | 21 | 4.65 MB | journey | 2 images named in a doc |
| docs/screenshots/test-kit | 12 | 3.71 MB | tests/e2e-kit (clean-kit, kit-screens) | |
| docs/screenshots/sync-check | 18 | 3.14 MB | sync-check | 09-status |
| docs/screenshots/pn-branches | 28 | 2.81 MB | pn-branches | 09-status |
| docs/screenshots/missing-papers | 18 | 2.79 MB | missing-papers | |
| docs/screenshots/monitoring-design | 21 | 2.77 MB | monitoring | 11-monitoring (3 images named) |
| docs/screenshots/on-hold | 15 | 2.56 MB | on-hold | |
| docs/screenshots/funds-design | 26 | 2.34 MB | funds-design | 05-funds (2 images named) |
| docs/screenshots/find-loan-align (without `before/` and the 3 stale files) | 27 | 2.11 MB | find-loan-align | |
| docs/screenshots/loans-table | 15 | 2.28 MB | loans-table | 09-status |
| docs/screenshots/monitoring | 16 | 2.26 MB | monitoring | 11-monitoring |
| docs/screenshots/home-compact | 30 | 2.14 MB | home-compact | 09-status |
| docs/screenshots/find-loan-compact (without the 6 stale files) | 24 | 1.77 MB | find-loan-compact | |
| docs/screenshots/my-loans-compact | 27 | 1.89 MB | my-loans-compact | 09-status |
| docs/screenshots/documents-tab | 13 | 1.61 MB | documents-tab | 2 images named in a doc |
| docs/screenshots/funds-handlers | 14 | 1.49 MB | funds-handlers | |
| docs/screenshots/decisions-batch | 14 | 1.39 MB | decisions-batch | |
| docs/screenshots/funds-types | 12 | 1.20 MB | funds-types | |
| docs/screenshots/permissions | 10 | 1.19 MB | permissions, role-editor | |
| docs/screenshots/find-loan-card | 12 | 1.09 MB | find-loan-card | 09-status |
| docs/screenshots/stage-map | 18 | 1.05 MB | stage-map, loans-table | 09-status |
| docs/screenshots/dp-review-missing | 12 | 1.01 MB | dp-review-missing | |
| docs/screenshots/remove-labels | 6 | 0.99 MB | remove-labels | |
| docs/screenshots/myloans-fields | 6 | 0.90 MB | myloans-fields | |
| docs/screenshots/find-loan-local-first | 12 | 0.77 MB | find-loan-local-first | |
| docs/screenshots/expense-kinds | 14 | 0.65 MB | expense-kinds | |
| docs/screenshots/status-card | 6 | 0.53 MB | status-card | |
| docs/screenshots/stage-map-fix | 12 | 0.31 MB | stage-map | 09-status |

Removing a written folder is pointless: the next E2E run makes it again.

## 2. Docs

Every file under `docs/` was checked. None is removable. All are current, and the stale terms found are intentional, except the README lines below.

| File | Size | Last changed | Verdict | Notes |
|---|---|---|---|---|
| docs/workflow/README.md and 01 to 13 | 2 to 43 KB each | 2026-11-08 to 11-13 | Current, **keep** | "Pull-out", "Notice to Decision" and "Archival & Warehousing" in 09 and 13 are the rename record ("was …", "no … in the guard"). The rule numbers in 09 are history rows. 10-processing-stages (the stages of a processor's job) does not duplicate 13 (the loan's stages). |
| docs/MANUAL-TEST-KIT.md | 16 KB | 2026-11-12 | Current, **keep** | Its "Labels (removed 11 November 2026)" section is a check that labels are gone, so it is not stale |
| docs/MANUAL-TEST-KIT-ANSWERS.md | 29 KB | 2026-11-13 | Current, **keep** | "Rule 1 to Rule 4" and "Pull-out" appear only as "never shows …" |
| docs/MANUAL-TEST-KIT-SCENARIOS.md | 29 KB | 2026-11-13 | Current, **keep** | Used by `kit --with-scenarios` (`scripts/kit.ts`) and checked by `kit.test.ts`. It is not a duplicate of ANSWERS: it covers the old scenario data, while ANSWERS covers the clean kit |
| docs/ENVIRONMENT.md | 18 KB | 2026-11-11 | Current, **keep** | Mentions `migrate dev` only to forbid it |
| docs/db/migration-inventory.md | 12 KB | 2026-11-12 | Current, **keep** | The old migration list on purpose; CLAUDE.md points to it |
| docs/db/squash-notes.md | 8 KB | 2026-11-12 | Current, **keep** | CLAUDE.md points to it |
| docs/myloans/field-map.md, scheduling.md, released-loans-source.sql | 8 to 22 KB | 2026-11-11 to 11-13 | Current, **keep** | |
| docs/roles-and-access-screenshots/gdfi-dms-access-matrix.csv | 2 KB | 2026-11-11 | Removable (in 1a) | An old download |

Stale lines to **edit, not delete**, in step 2. The top-level README is not under `docs/`, but it has these six:

| File:line | Stale text | Now |
|---|---|---|
| README.md:178 | `FindLoan`: "PN (also CIN, CIF, label code)" | Labels were removed on 11 November; the placeholder is "PN, CIN or CIF" |
| README.md:179 | `LoanCard`: "Home and My loans cards" | `LoanCard` is no longer used (section 4). Home uses `HomeLoanRow` |
| README.md:180 | `Stepper`: "5-step progress … Step N of 5" | The stepper has 10 steps (stage map) |
| README.md:201 | "Each ticked paper shows its label code (Document ID)" | Labels removed |
| README.md:204 | Find a loan placeholder "Type the PN number" | It is "PN, CIN or CIF" everywhere |
| README.md:218 | "Mortgage thresholds are fixed by Rule 4" | Rule numbers are no longer used; "the Mortgage needed rule" |

No "Masterlist" or "Export CSV" feature text is left in the docs. One "Export CSV" mention in 09-status is in a history row.

## 3. Sample and kit text

Everything is still read by the app, the seed, the kit or a test, so nothing is removable.

| Path | Read by | Verdict |
|---|---|---|
| lib/myloans/mock-data.ts | mock-adapter, samples, data-check.test, status.test | Keep |
| lib/myloans/mock-account.ts | mock-adapter, account-details.test | Keep |
| lib/myloans/mock-adapter.ts | lib/settings.ts, 3 integration tests | Keep |
| lib/myloans/samples.ts, lib/ui/samples.ts, components/loan/sample-loans.tsx | Home, Loans, Search (test mode), myloans-sync.test | Keep |
| lib/services/simulator.ts, components/loan/journey/simulator-block.tsx | Journey tab (test mode), 5 integration tests | Keep |
| lib/kit/catalog.ts, build.ts, clean.ts, build-clean.ts, funds-roles.ts, rebase.ts, access.ts, panel-data.ts, core.ts, guard.ts, docker.ts | scripts/kit.ts, scripts/kit-build.ts, the login page, Settings > Test kit, kit.test.ts | Keep. Two unused names inside them are in section 4 |
| lib/branches/kit-file.ts | lib/kit/build.ts, lib/myloans/index.ts | Keep |
| prisma/seed.ts | `db:seed`, `db:seed:reference`, db:create-test | Keep |
| tests/e2e-kit/* and playwright.kit.config.ts | The kit screenshots (`docs/screenshots/test-kit`) | Keep |
| docs/MANUAL-TEST-KIT*.md | See section 2 | Keep |

## 4. Unused code

knip flagged 393 exported names. 333 of them are used inside their own file, so only the word `export` is extra. That is not dead code and is left alone.

These 60 names appear **nowhere** but their own declaration. Nothing imports them, no test included.

| File | Unused names | Risk |
|---|---|---|
| components/loan/forms.tsx | `ChecklistForm`, `EdstForm`, `AssignForm`, `ResolveExceptionForm` | low (old forms, replaced by `work.tsx` and the send panel) |
| components/chips.tsx | `StageChip`, `TxnStatusChip`, `SimulatedTag` | low |
| components/jobs/chips.tsx | `HoldChip`, `ProblemChip` | low |
| components/jobs/forms.tsx | `ReturnToLaButton` | low |
| components/admin/forms.tsx | `SettingsRowForm` | low |
| components/ui/loan-card.tsx | `LoanCard` (the whole file; README still lists it) | low |
| components/ui/icons.tsx | `DownloadIcon` | none |
| lib/services/queries.ts | `dashboardCounts` (the old Home), `canExport` (the removed Export CSV) | low |
| lib/services/papers.ts | `hasMissingPapers`, `paperHistory` | low |
| lib/rules/index.ts | `CLASSIFICATION_LABEL`, `FINANCING_TYPE_LABEL`, `ORCR_LABEL`, `MORTGAGE_LABEL` | low (the words come from elsewhere now) |
| lib/ui/plain.ts | `txnHint`, `numberWord` | low (replaced by `lib/ui/txn-status.ts`) |
| lib/ui/holds.ts | `HOLD_REMARKS_MIN`, `HOLD_REMARKS_MAX`, `RESUME_REMARKS_MIN`, `TO_CONTINUE_OTHERS` (aliases of `REMARKS_MIN` and `REMARKS_MAX`) | none |
| lib/workflow/build-journey.ts | `SEG_LABEL`, `businessSpan` | low |
| lib/workflow/stage-map.ts | `STORED_STAGES` (its comment says "for checks", but no check uses it) | low |
| lib/stages/rules.ts | `FIELD_TYPE_LABEL`, `KIND_LABEL` | low |
| lib/funds/kinds.ts, lib/funds/rules.ts | `AMOUNT_MODES`, `SOURCE_TEXT`, `EXPENSE_LABEL` | low |
| lib/services/* (11 files) | `requireCapacityManager`, `requireUsableKind`, `namesText`, `fundsTypesSeen`, `todayText`, `keepCounts`, `countLine`, `openReviewLoanIds`, types `FundsActor`, `PasuyoInput` | low |
| lib/jobs/view.ts, lib/monitoring/rules.ts, lib/time.ts | `txnProblemDays`, `dueDate`, `fmtPeso` | low |
| lib/myloans/index.ts, live-mapping.ts | `normalizePn` (an alias of `cleanPn`), `STATUS_WORDS` | low |
| lib/kit/catalog.ts, core.ts, guard.ts | `KIT_PASTED_PN`, `OLD_BRANCHES`, `BASELINE_NAME`, `sqlLiteral`, `kitAvailable` | low (also run `kit.test.ts` after) |
| lib/ui/loan-filters.ts, lib/ui/rounds.ts | `FILTER_NAMES`, type `DeclineReason` | none |
| lib/env/destructive.ts | `assertDestructiveAllowed` | **check**: a safety guard. The scripts use `destructiveRefusal` instead, but keep this one if anyone plans to call it |
| lib/auth/providers.ts | `entraProvider`, type `AuthProvider` | **check, proposal Keep**: the planned Microsoft Entra sign-in, a TODO stub |

Unused files (knip, checked by hand):

| File | Lines | Last changed | Verdict | Risk |
|---|---|---|---|---|
| components/loan/filters-sheet.tsx | 43 | 2026-11-08 | Nothing imports it | none |
| components/ui/loan-row.tsx | 30 | 2026-11-08 | Nothing imports it (Home uses `components/home/home-loan-row.tsx`) | none |
| lib/storage/index.ts | 50 | 2026-11-08 | Nothing imports it; receipts use `lib/storage/receipts.ts`. A stub for future Supabase Storage | **check** |
| scripts/kit-build.ts | 26 | 2026-11-10 | **Keep**: `lib/kit/core.ts` runs it by path, so knip cannot see the use | |
| prisma/schema.prisma | | | **Keep**: knip false positive | |

Duplicate exports (one value under two names) are listed as "none" risk where an alias is unused. The rest (`receiptStore`/`localStore`, `BASELINE_MIGRATION`/`TRIGRAM_MIGRATION`, `mayResolveAdvisory`/`mayEditAdvisory`) are used under both names, so **keep** them.

## 5. Build and output folders

Every folder is ignored by `.gitignore` and none is tracked (`git ls-files` returns 0 files for each). Nothing tracked is in the wrong place.

| Folder | Size on disk | Ignored | Tracked | Note |
|---|---|---|---|---|
| .next | 1,462 MB | yes | 0 | The person's `next dev` and `next build`; rebuilt on demand |
| .next-e2e | 971 MB | yes | 0 | Playwright's dev-server build (`playwright.config.ts`); last used 8 November. Safe to delete locally; it rebuilds |
| .next-e2e-prod | 206 MB | yes | 0 | The `e2e:groups` production build; rebuilt each run |
| test-results | 33 KB | yes | 0 | Only the last E2E summary |
| playwright-report | (absent) | yes | 0 | |
| coverage | (absent) | yes | 0 | |
| storage | 4.2 MB | yes | 0 | **Keep**: attachments of the local database `gdfi_dms` |
| tsconfig.tsbuildinfo | 0.3 MB | yes (`*.tsbuildinfo`) | 0 | |
| `*.log`, `*.tmp` | none found | yes (`npm-debug.log*` etc.) | 0 | |

Deleting the three `.next*` folders frees about 2.6 GB of local disk. This is not part of the repo; it is local only.

## 6. Other clutter

| Item | Found | Verdict |
|---|---|---|
| Backup copies (`*.bak`, `*-old*`, `*copy*`, `*.orig`, `*~`) | None. The only "copy" and "old" names are the screenshots `related-loans/copy-papers-*` and `replacement-old-file-*`, which describe screens | Nothing to remove (related-loans is in 1b) |
| Scratch scripts | None. All 11 files in `scripts/` are used by `package.json` or the kit (`empty.cjs` and `server-only-stub.cjs` are loaders) | Keep |
| Empty folders | None | |
| Duplicate config | `playwright.config.ts` and `playwright.kit.config.ts` are two configs on purpose (app tests and kit screens) | Keep |
| npm dependencies (depcheck) | depcheck flagged `@tailwindcss/turbopack`, `tailwindcss` and `cross-env`. All three are used: `next.config.ts` (the turbopack loader), `app/globals.css` (`@import "tailwindcss"`) and the `db:seed:reference` script | Keep all |
| `.env.example` | 26 variables. Four are not read by code (`POSTGRES_PASSWORD`, `POSTGRES_DB`, `DB_HOST_PORT`, `ADMINER_HOST_PORT`), but `docker-compose.yml` reads all four | Keep all |

## 7. Repo weight

- Tracked: 1,469 files, 142.2 MB. PNG images are 137.0 MB, code about 4.4 MB, docs text 0.4 MB.
- Working folder without `node_modules`: 2.79 GB. Of this, `.next*` is 2.64 GB, `.git` 373 MB and `docs` 137 MB.
- `.git` is 373 MB and keeps all old screenshots. Only a history rewrite would shrink it. **Business decision: proposal No.** It changes every commit id, and everyone must clone again.

The 15 largest tracked files are all screenshots:

| Size | File |
|---|---|
| 1.19 MB | docs/screenshots/paging/users-390.png |
| 1.15 MB | docs/screenshots/paging/users-1440.png |
| 1.13 MB | docs/screenshots/journey/journey-list-1440.png (removed in step 2) |
| 1.11 MB | docs/screenshots/paging/users-820.png |
| 1.08 MB | docs/screenshots/journey/journey-list-820.png (removed in step 2) |
| 1.05 MB | docs/screenshots/journey/journey-list-390.png (removed in step 2) |
| 0.95 MB | docs/screenshots/paging/my-loans-1440.png |
| 0.93 MB | docs/screenshots/paging/loans-page-2-1440.png |
| 0.91 MB | docs/screenshots/paging/loans-page-2-820.png |
| 0.91 MB | docs/screenshots/paging/loans-page-1-1440.png |
| 0.91 MB | docs/screenshots/paging/loans-page-1-820.png |
| 0.87 MB | docs/screenshots/test-kit/test-sheet-1440.png |
| 0.84 MB | docs/screenshots/paging/my-loans-820.png |
| 0.77 MB | docs/screenshots/journey-v2/full-log-open-1440.png |
| 0.74 MB | docs/screenshots/paging/loans-page-2-390.png |

The paging shots are large because they are full-page captures of 50 to 100 rows. A later job could capture only the pager area and cut about 9 MB.

The 10 largest tracked folders:

| Size | Folder |
|---|---|
| 11.00 MB | docs/screenshots/paging |
| 9.42 MB | docs/screenshots/checklist-and-send |
| 8.52 MB | docs/screenshots/hold-and-return |
| 5.73 MB | docs/screenshots/loan-file-next-step |
| 5.52 MB | docs/screenshots/journey |
| 5.28 MB | docs/screenshots/jobs-and-dp |
| 4.77 MB | docs/screenshots/email |
| 4.65 MB | docs/screenshots/journey-v2 |
| 3.74 MB | docs/screenshots/related-loans |
| 3.71 MB | docs/screenshots/test-kit |

## Keep list (checked and still used)

- Every docs file (section 2) and every sample, mock, kit and seed file (section 3).
- The 31 spec-written screenshot folders in 1c, and `docs/screenshots/test-kit`.
- `scripts/` (all 11 files), `scripts/kit-build.ts`, `prisma/schema.prisma`.
- `entraProvider` (planned sign-in).
- All npm dependencies and all `.env.example` variables.
- `storage/` (local attachments) and both Playwright configs.

## Proposed order of removal (step 2, after approval)

Each step is checked before the next.

1. **Screenshots 1a** (superseded, 31.3 MB). Then run `npx vitest run lib/docs/workflow-docs.test.ts tests/integration/kit.test.ts`, which checks doc links and the kit.
2. **Screenshots 1b**: only the folders the business approves.
3. **Dead code**: the two unused files, then the 60 unused names, excluding the "check" items unless approved. Then run typecheck, lint, the whole Vitest suite alone, then `npm run e2e:groups` alone.
4. **README edits** (section 2): text only.
5. **Optional, local only**: delete `.next-e2e` (and `.next`, `.next-e2e-prod` when no server is running) to free about 2.6 GB of disk. Not a repo change.

Commands I would run (not run):

```bash
# 1. Superseded screenshots (1a)
git rm -r -q docs/screenshots/checklist-and-send docs/screenshots/journey docs/screenshots/funds docs/screenshots/layout \
  docs/screenshots/find-loan-align/before docs/ui-v2-screenshots docs/send-step-screenshots docs/dp-funds-tat-screenshots \
  docs/redesign-screenshots docs/roles-and-access-screenshots docs/top-bar-and-settings-screenshots \
  docs/confirm-and-loans-screenshots docs/compact-loan-file-screenshots
git rm -q docs/screenshots/find-loan-align/message-not-released-{1440,820,390}.png \
  docs/screenshots/find-loan-compact/dropdown-outside-{1440,820,390}.png \
  docs/screenshots/find-loan-compact/message-not-released-{1440,820,390}.png
npx vitest run lib/docs/workflow-docs.test.ts tests/integration/kit.test.ts

# 2. Only-picture folders (1b), as approved, for example:
git rm -r -q docs/screenshots/jobs-and-dp docs/screenshots/email docs/screenshots/related-loans docs/screenshots/lto \
  docs/screenshots/myloans-sync docs/screenshots/dp-stages docs/screenshots/environment docs/screenshots/receiving \
  docs/screenshots/processing-stages-settings docs/pasuyo-and-switcher-screenshots \
  docs/users-import-inactive-screenshots docs/required-and-settings-screenshots

# 3. Dead code: two files, then the unused names (by hand, with Edit), then the checks
git rm -q components/loan/filters-sheet.tsx components/ui/loan-row.tsx
npx tsc --noEmit && npx eslint . && npx vitest run
npm run e2e:groups        # alone, after Vitest has finished

# 5. Local disk only (not git)
rm -rf .next-e2e
```

No commit and no push in either step unless the business asks.
