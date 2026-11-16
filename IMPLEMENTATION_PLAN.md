# Implementation Plan: Foundation (Settings, RBAC, 3.1, 3.2)

Date: 16 November 2026 (PHT)
Branch: `feature/foundation-settings-rbac-myloans`
Inputs:
- `FOUNDATION_CHECK.md` and `FLOWCHART_ALIGNMENT.md` (Step 1);
- `docs/DECISIONS.md` D-001 to D-021;
- the myloans contract in `docs/myloans-api-contract.sql`;
- the questions for the myloans team in `docs/MYLOANS_QUESTIONS.md`.

Rules this plan follows:
- **Migrations** follow `CLAUDE.md`:
  - no `prisma migrate dev`;
  - `migrate diff`, saved as `20261119090015_<name>`, `…16`, and so on, with the trigram "drop index" lines removed;
  - applied with `npm run db:deploy`;
  - then `db:create-test` and `kit:rebuild`.
- **Hand-written SQL objects Prisma cannot see** (new partial unique indexes) are added to the "never drop" list in `CLAUDE.md` and to `lib/db/migration-check.ts`.
- **Docs:** each change that alters a workflow rule, role, status or turnaround target updates the matching `docs/workflow/` file and its date in the same commit.

Effort is in **developer-days** for one experienced developer.

---

## 1. Build order

| # | Piece | Effort | Depends on |
|---|---|---|---|
| **1** | **Sign-in hardening** (priority #1, D-021) | 1.5 | — |
| 2 | Permission core: one resolver; 10 roles; per-user overrides and scope; matrix screen; user screen; role migration | 6–8 | 1 |
| 3 | Branch scope everywhere; file download route; file-view log; cross-branch tests (Finance first) | 4–6 | 2 |
| 4 | One working-days calendar (Mon–Sun ticks, national and local holidays) | 2–3 | — |
| 5 | Liquidation due: one CA / FT setting, saved at LTO completion; remove the old constants | 2 | 4 |
| 6 | myloans mock APIs 1–5 (the exact contract) | 3–4 | — |
| 7 | myloans sync on API 2: checkpoint, paging, repeats, ExternalLoanId, superseded, duplicates, run log, alerts, interval setting | 5–7 | 6, 4 |
| 8 | Open Items per field: approver queue + Unassigned, Superseded, cancellation pending, monitored fields, Reference data changes log | 7–9 | 2, 3, 7 |
| 9 | Accept / Forward engine: movement ledger, branch pool + personal inbox, per-user TAT + waiting time, return with remarks | 8–12 | 2, 3, 4 |
| 10 | PN # search: IsSelectable, ExternalLoanId on open, Search Log, "Released. Not yet in DMS" accepted from the pool | 2–3 | 7, 9 |
| 11 | Products (API 5) and branches (API 4) from the mock; LTO-PASIG sample warning | 2–3 | 6 |
| 12 | Docs, manual test kit, e2e update; Step 5 verification | 4–6 | all |
| | **Total** | **≈ 47–64 days** | |

Pieces 4 and 6 have no dependencies and can be built early or in parallel. Each piece is committed on its own, with its tests.

---

## 2. Piece 1: Sign-in hardening (priority #1)

**Now (local testing)**

| Change | Where |
|---|---|
| Test sign-in only when `APP_ENV=local`. `AUTH_MODE=test` with `APP_ENV=staging` or `production` is an **error**, and the server refuses to start. Today this is only a warning | `lib/env/check.ts:128`; `lib/auth/providers.ts` |
| `authMode()` no longer defaults to `test`. An unset `AUTH_MODE` means `entra` in staging and production, and `test` only in local | `lib/auth/providers.ts:16-18` |
| Users created from the app or the import are **real users** (`isTestUser: false`). Only the local seed and kit create test users | `lib/services/admin.ts:103`; `lib/import/importer.ts:743` |
| The `/login` user list shows only in local test mode | `app/login/page.tsx` |
| `canSignIn` is replaced by a matrix permission, **"Sign in"** (`auth:sign_in`), ticked by default for all 10 roles. This lets DP, Finance, Custodian, QA and Digicur sign in | piece 2 |
| Fix the wrong allow-list comment (G3) | `lib/auth/permission-scan.ts:24` |

**Later (Entra ID; not in this foundation)**

- OIDC code flow with state and nonce: `/api/auth/entra/login` and `/api/auth/entra/callback`.
- ID-token check against the tenant keys (issuer, audience, tenant).
- `entraProvider.resolveUser(oid, email)` → session with `provider: "entra"`.
- `ENTRA_*` checks in `checkEnv`; optional security-group allow-list.
- Needs an app registration from IT.
- Effort: 3–5 days.

Until Entra is built, staging and production **cannot start**. That is intended.

**Tests:**
- `checkEnv` refuses `production` and `staging` with `AUTH_MODE=test`;
- the test provider refuses outside local;
- an imported or added user cannot use test sign-in;
- the login page hides the list outside local.

---

## 3. Piece 2: Permission core (D-002, D-003, D-008 to D-011)

### 3.1 Model

| Change | Detail |
|---|---|
| Role keys | `SUPERADMIN`, `ADMIN`, `LA`, `LA_HEAD`, `DP`, `FINANCE`, `CUSTODIAN`, `QA`, `DIGICUR`, `ARCHIVER`. These replace `FIN`, `VAULT`, `DIG`, `SUP` and `APPR`; see 3.3 |
| `Role.canSignIn` | Dropped. Data migration: roles with `canSignIn = true` get `auth:sign_in` |
| New `UserPermissionOverride` | `userId`, `key`, `effect` (`GRANT` / `DENY`), `setById`, `setAt`, `note`. Unique on (`userId`, `key`) |
| New `User` columns | `handlesCa`, `handlesFt` (D-009) |
| Approver tickbox | Permission `openitems:approve`. Default on for `LA_HEAD`; given to or removed from a single user with an override (D-010) |
| Branch scope | **Reuse** the existing `allBranches`, `UserAccessGrant` (division / area / branch, with exceptions) and `user_branch_access` (`prisma/schema.prisma:182-363`). The "All branches" tickbox is `allBranches` |
| New permission keys | `auth:sign_in`, `permissions:manage` (the matrix and overrides; Superadmin only; replaces `roles:manage` for this), `openitems:approve`, `openitems:view`, `refdata:view` (Reference data changes log), `syncruns:view`, `transactions:reassign`, `transactions:cancel` (v2 §5.3; Admin and Superadmin by default) |

**Effective permissions** = (role ticks ∪ user GRANTs) − user DENYs.

**Scope** = `allBranches` OR (grants − exceptions), plus `handlesCa` / `handlesFt` for Finance.

### 3.2 One resolver, used everywhere

`lib/auth/access-context.ts` builds an `AccessContext` once per request (React `cache()`):
- the set of effective permissions;
- the branch-id set, or ALL;
- the CA / FT flags.

It exposes:

| Function | Purpose |
|---|---|
| `can(ctx, key)` | Permission check |
| `requirePermission(ctx, key)` | Throws when the permission is missing |
| `branchWhere(ctx)` | Prisma `where` fragment for loans, transactions, jobs and advances |
| `fundTypeWhere(ctx)` | Prisma `where` fragment for fund types |
| `loadInScopeOr404(ctx, kind, id)` | Single-record loads for pages, actions and downloads |

The existing helpers `loanScope`, `inScope`, `canSeeJob` and `canFunds` become thin calls into this resolver, so there is one source.

A lint/scan test (extending `lib/auth/permission-scan.ts`) fails if:
- a page, action or route reads `prisma.*` for scoped models without going through the resolver; or
- a page, action or route compares role keys.

### 3.3 Role migration (D-010) and the users it affects

This is a data migration in the new migration, plus seed defaults. Dev data only; there is no production data.

| Old role (key) | New | Users in `gdfi_dms` today (all fake, `@example.test`) |
|---|---|---|
| Branch Supervisor (`SUP`) | LA Supervisor/Head (`LA_HEAD`): all LA ticks + `openitems:approve`; keeps their branch / area scope | Branch Supervisor (`kit.supervisor`), Area Supervisor Luzon 1 (`kit.area.supervisor`) |
| Operations Monitor (`MONITOR`) | A **custom read-only role**, "Monitoring (read-only)", built from matrix ticks: `monitor:dp`, `monitor:lto`, `ltoreports:*`; no loan files, no amounts | Operations Monitor (`kit.monitor`) |
| Approvers, Records, Compliance (`APPR`) | Removed. Its users become their real role (Finance), with per-user approval overrides | none |
| Custom roles "Approver (cash advance / fund transfer / large amounts / small amounts)" | Finance + per-user overrides (`funds:ca_approve` / `funds:ft_approve`) + `handlesCa` / `handlesFt`. The band question is Q-N6 below | Approver Cash, Approver Transfer, Approver Large, Approver Small |
| Custom roles "Finance (cash advance)", "Finance (fund transfer)" | Finance + `handlesCa` only / `handlesFt` only | Finance Cash, Finance Transfer |
| `FIN`, `VAULT`, `DIG`, `QA` | `FINANCE`, `CUSTODIAN`, `DIGICUR`, `QA` (renamed; ticks re-seeded to v2 §7) | 1 user each |
| Custom "LA (no refresh)" | LA + a DENY override on `loans:refresh` | LA No Refresh (`kit.la.norefresh`) |
| — (new) | `SUPERADMIN`, `ARCHIVER` | none. The seed adds one fake user each (Step 2) |

The migration writes one audit row per changed user. A migration report lists them, so the same list can be produced on any database.

### 3.4 Default ticks (seeded from v2 §7; editable afterwards)

| Role | Default permissions |
|---|---|
| Superadmin | everything, including `permissions:manage`, all Settings, myloans settings, audit, reassign / cancel |
| Admin | view all loans and reports; all customizable Settings (not the matrix); reassign / cancel; `refdata:view`, `syncruns:view`, `openitems:view` |
| LA | today's LA ticks + accept / forward / return |
| LA Supervisor/Head | LA + `openitems:approve` + `refdata:view` |
| DP | today's DP ticks |
| Finance | CA / FT keys, filtered by `handlesCa` / `handlesFt` |
| Custodian, QA, Digicur, Archiver | `auth:sign_in`, loans view, own inbox. Their work steps come with their modules |

### 3.5 Screens

| Screen | What it shows | Who |
|---|---|---|
| **Settings → Permissions** | A grid of roles (columns) × permissions (rows, grouped by area), with tickboxes and a help text per key. Save shows a diff of added and removed ticks per role before confirming | edit: Superadmin (`permissions:manage`); view: Admin |
| **Users → Edit** | Role; status; branch scope (existing tree + "All branches"); Handles CA / Handles FT; "Can approve LA Open Items". A **permissions panel** shows each key as Inherited ✓/✗ / **Granted** / **Denied**, with a reason note | Superadmin edits overrides and scope. Admin sees them read-only (see Q-N4) |
| **Users list** | Filter "has overrides"; badges for approver, CA, FT | Superadmin, Admin |

### 3.6 Lock-out rules

These carry over from `lib/services/lockout.ts`, re-pointed to the new keys:
- `permissions:manage` must stay with at least one active Superadmin.
- No one can remove their own `permissions:manage` or `auth:sign_in`, by role tick or by DENY override.
- No one can deactivate themselves.

Every change is audited with before and after.

### 3.7 Tests

- **Resolver unit tests:** inherit / grant / deny combinations; DENY beats role tick; GRANT beats missing tick; scope ALL vs grants vs exceptions; CA / FT filter.
- **Lock-out tests:** last Superadmin; self-removal by tick and by override.
- **A table test that runs every role through the permission matrix:** for each seeded role (and an override user), every page, action and route returns allowed or 404 / redirect as the matrix says. Generated from one table, so a new route cannot be missed.
- **Migration test:** old roles map as in 3.3.

---

## 4. Piece 3: Branch scope everywhere (D-019)

**Lists and counts.** Every list and count uses `branchWhere(ctx)`. This covers:
- Loans, Home, inbox, DP jobs, Funds (Finance first), Finance Home counts (G2), Monitoring, Reports, Notifications, Open Items, the Reference data changes log, and search suggestions.

**Detail pages and actions.** Every detail page and action loads through `loadInScopeOr404`. Out of scope means **404**.

**Files.** One download route, `GET /api/files/[kind]/[id]` (receipt, stage evidence, LTO proof). It:
1. requires a session;
2. checks the parent record through the resolver (G1 fix);
3. writes a `FileAccessLog` row;
4. streams the file with `no-store`, `nosniff` and a sandbox CSP.

The old routes `/api/receipts/[id]` and `/api/stage-files/...` are removed. The storage folder is never served statically. A test asserts there is no file path under `public/`.

**`FileAccessLog`:** `id`, `userId`, `entityType`, `entityId`, `loanId?`, `branchId?`, `fileKey`, `fileName`, `action` (`VIEW` / `DOWNLOAD`), `at` (database `now()`), `ip?`, `userAgent?`.
- Append-only: no update or delete grant.
- A screen under Audit, for Superadmin and Admin.

**Tests (D-019):** for every seeded role, a user in branch A tries branch B's:
- list (rows absent);
- count (not counted);
- detail (404);
- each action (404);
- each file kind (404, and a log row only for allowed views).

Finance runs first, then all roles. A user with no scope sees nothing.

---

## 5. Piece 4: One working-days calendar (D-018)

| Change | Detail |
|---|---|
| Setting `calendar.workingDays` | Mon–Sun ticks; default Mon–Sat. In Settings → Holidays & working days |
| `HolidayCalendar` | Add `scope` (`NATIONAL` / `LOCAL`) and a `HolidayBranch` join (branch tickboxes for local holidays) |
| `lib/calendar/` service | `isWorkingDay(date, branchId?)`, `addWorkingDays(date, n, branchId?)`, `workingDaysBetween(a, b, branchId?)`. Loads the calendar per request (cached for the request) |
| Removed | `isWeekend` / `isBusinessDay` in `lib/time.ts`; the sync's own Mon–Sat 07:00–19:00 rule (`lib/services/source-sync.ts:767-776`); every other day count, which a scan test then forbids |
| Sync window | The new sync has an interval only. Whether it runs only in office hours is Q-N8 |

**Note:** moving the default from Mon–Fri to Mon–Sat changes due dates across TAT, overdue and email reminders. Tests that assume Saturday is a weekend are updated.

**Tests:**
- weekends per tick pattern;
- national holiday;
- local holiday in branch A but not branch B;
- month end and year end (31 Dec → 2 Jan with 1 Jan a holiday);
- a holiday falling on a non-working day;
- `addWorkingDays(0)`.

---

## 6. Piece 5: Liquidation due date (D-017)

| Change | Detail |
|---|---|
| Settings | `funds.liquidationDueWorkingDaysCa` = 2 and `funds.liquidationDueWorkingDaysFt` = 2. Zod 0–30; audited |
| Saved on the record | When LTO completion is recorded (the DP stage that completes LTO; Mortgage pick-up), compute `addWorkingDays(completionDate, N, branch)` with the calendar and save it on the advance as `liquidationDueAt`. It is **not** recomputed when the setting changes |
| Removed by migration | Setting row `funds.liquidationDueDays` (10); TatRule row `P4_LIQUIDATE` (5) and its fallback `lib/workflow/tat.ts:48`; column `CashAdvanceRule.liquidationDays`. Existing advances keep their saved `liquidationDueAt` |
| Open point | An advance covering several transactions: due after the **last** LTO completion of its lines (proposal, Q-N3) |

**Tests:**
- due date across a weekend, a holiday, month end and year end;
- CA vs FT values;
- a setting change does not move existing records;
- the old keys are gone.

---

## 7. Piece 6: myloans mock (APIs 1–5, exact contract)

**What it is.** A local HTTP mock served by the app at `/api/dev/myloans/api/dms/v1/...`.
- It refuses unless `APP_ENV=local` and `MYLOANS_MODE=mock`.
- The **real** HTTP adapter points at it, so the production code path is exercised. It is swappable by changing `MYLOANS_BASE_URL`.

**Endpoints and behaviour (from `docs/myloans-api-contract.sql`):**

| API | Behaviour |
|---|---|
| API 1 `GET /loans/{pnNo}` | 404 when not found; **422** with `transactionStatusId` when not selectable; 200 with the loan. **Can return more than one row** for a PN when a superseded copy shares it (to test D-016 #3) |
| API 2 `GET /loans/changes?since=&cursor=&limit=500` | Rows ordered by `sourceUpdatedAt`, `externalLoanId`; `nextCursor` when the page is full; `maxSourceUpdatedAt`. Refuses neither / both of `pnNo` and `since` |
| API 3 `GET /loans/{pnNo}/freshness` | `pnNo`, `transactionStatusId`, `transactionIsActive`, `sourceUpdatedAt`, `contentHash` |
| API 4 `GET /branches?since=` | Branches |
| API 5 `GET /products?since=` | Products |

**ContentHash** is computed the way the contract does: SHA-256 over the UTF-16LE text of the same CONCAT, with fields in order, `~` for NULL and `|` separators. It is returned as lowercase hex, pending B1 in `docs/MYLOANS_QUESTIONS.md`.

**Data** lives in a mock table (`MockMyloansLoan`, local only) seeded with fake loans. Scenario builders:

| Scenario | What it tests |
|---|---|
| Superseded copy sharing a PN # (old id superseded, new id live) | A3 / matching |
| Cancellation (status changes from 12; `is_active` 0) | D-013 |
| Timestamp-only change (same hash) | D-016 repeats |
| Several rows with **identical** `SourceUpdatedAt` across a page boundary | paging ties |
| A run of **exactly 500** rows (full page, then an empty page) | paging end |
| A duplicate `ExternalLoanId` in one page (the join fan-out) | D-016 #6 |
| A product rename (API 5) and a branch rename (API 4) | D-012 |
| A borrower name correction; amount and type changes that flip the Mortgage result | Open Items, chart 9b |

Settings → Test data has a "myloans mock" panel (local only) to fire each scenario.

**Tests:** contract tests on the mock (status codes, ordering, cursor, exactly-500, refusal) and on the adapter's zod parsing of every response.

---

## 8. Piece 7: myloans sync on API 2 (D-005, D-016)

### 8.1 Job design

The external scheduler calls `POST /api/cron/myloans-sync` every **5 minutes** (fixed, with `CRON_SECRET`). The route:

1. **Interval check.** It runs a sync only if `now ≥ lastSuccessfulStart + myloans.intervalMinutes`. Because the interval is read each time, a change applies without a restart.
2. **Lease.** It takes a **lease row** (`SyncLease`: owner, expiresAt). This replaces the 30-minute database transaction that held the advisory lock (`source-sync.ts:863-867`).
3. **Paging.** It calls API 2 from `checkpoint − 5 min` and pages with the cursor until a page has fewer than 500 rows.
4. **Per page,** in one short database transaction:
   - zod-validate every row;
   - drop and count `isSuperseded = 1` rows (but see Q-N1);
   - detect a **duplicate `externalLoanId` within the run** (an in-memory set across pages; also by `(sourceUpdatedAt, id)`). The duplicate is logged and the Admin alerted; neither copy is applied;
   - match on `externalLoanId`;
   - handle each row as in 8.2.
5. **Commit the checkpoint** only after **all pages succeed**. The new checkpoint is the **maximum** `sourceUpdatedAt` of the run. A run with no rows keeps the old checkpoint.
6. **On failure:**
   - keep the checkpoint;
   - retry with backoff (the existing `resilience.ts`: 2 retries, `Retry-After`, breaker);
   - timeout from env;
   - count consecutive failed runs; at `myloans.alertAfterFailedRuns` (default 3) notify the Admin and Superadmin in-app and by email.
7. **Run log.** Write a `SyncRun` row (8.3).

The rotating-batch polling, the tiers, the `nextCheckAt` queue and the hourly ceiling for background polling are **removed**. On-demand refresh (open, Refresh button) uses **API 3**, then API 1 only if the timestamp is newer and the hash differs.

### 8.2 Row handling

| Case | Action |
|---|---|
| `externalLoanId` known, same `contentHash` | Nothing, not even the timestamp |
| Known, newer `sourceUpdatedAt`, same hash | Update `Loan.sourceUpdatedAt` only |
| Known, different hash | Diff the **monitored fields** (setting, D-012) against DMS values. For each differing field, create an Open Item (piece 8). Hash differs but no stored field differs → one Open Item "Changed in myloans: field not shown in DMS" (birth date, see MYLOANS_QUESTIONS B3 / D) |
| Known, reference-only difference (branch / product / area / division / company **name**) | Applied automatically and written to the **Reference data changes** log + in-app notice (D-012). Loan rows carry `BranchID` and `ProductCode` only, so names come through APIs 4 and 5 |
| Known, status or active change (cancelled / no longer released) | Open Item + loan flag `cancellationPending` + Forward blocked (D-013) |
| Unknown, `isSelectable = 1` | Upsert into `SourceLoanCandidate` (minimal fields: externalLoanId, pn, branchId, borrower display name, release date, amount, hash, sourceUpdatedAt). Shown in the branch pool as **"Released. Not yet in DMS"** (D-016 #5). Not a DMS transaction until an LA accepts (piece 10) |
| Unknown, not selectable | Ignored; candidate removed if present |

**Only open loans are synced.** A loan stops syncing once it is "Loan closed/released" (D-006). Whether checks slow down once the loan is "Processing complete" is Q-N8.

### 8.3 Data

| Model | Columns |
|---|---|
| `Loan` (new columns) | `externalLoanId` (unique, nullable for older rows), `contentHash` (char(64) hex), `borrowerFirstName` / `MiddleName` / `LastName` / `Suffix`, `borrowerCompanyName`, `sourceLoanNo` (LoanID), `cancellationPending`. `borrowerName` is kept as a generated display value |
| `SyncRun` | `id`, `kind` (`LOANS` / `BRANCHES` / `PRODUCTS`), `startedAt`, `endedAt`, `status`, `pages`, `rows`, `superseded`, `duplicates`, `openItemsCreated`, `timestampOnly`, `candidates`, `errors` (json), `checkpointBefore`, `checkpointAfter` |
| `SyncState` | Per kind: `checkpoint`, `lastSuccessfulStart`, `consecutiveFailures` |
| `SyncLease` | `owner`, `expiresAt` |
| `SourceLoanCandidate` | Described in 8.2 |

Retired after migrating dev rows: the `myloans.state`, `lastRun`, `tierMinutes`, `backgroundMinutes`, `maxPerRun`, `pauseMs`, `hourlyCeiling` and `businessHoursOnly` settings; the `Loan.nextCheckAt` / tier columns; and `MyLoansCallHour` if nothing else uses it. `LoanSourceSnapshot` is trimmed to the fields the DMS uses, which also reduces stored personal data.

### 8.4 Settings

| Setting | Rule |
|---|---|
| `myloans.intervalMinutes` | Default 30. A value below 30 or above 60 shows a **warning but saves**. Audited; live |
| `myloans.alertAfterFailedRuns` | Default 3 |
| `myloans.paused` | Kept |
| `myloans.monitoredFields` | Tickboxes over the loan and borrower fields of the contract: PN, status, active, CIN, CIF, name parts, LoanID, loan type, company name, amount, release date, product code, branch ID. Birth date is not offered until decided |

### 8.5 Screens

| Screen | Contents | Who |
|---|---|---|
| **Settings → myloans** | Interval (with the warning), alert threshold, monitored fields, pause, "Run now" | Superadmin |
| **Sync runs** | Table of `SyncRun` with filters. Opening a run shows its errors and duplicates | Admin, Superadmin |

### 8.6 Tests

- checkpoint saved only after all pages; a failure in the middle keeps the old one;
- the overlap re-delivers rows harmlessly;
- same hash means no action; timestamp-only updates the timestamp;
- a different hash creates per-field items;
- matching on `externalLoanId` when the PN changes;
- superseded rows ignored; duplicate within a run alerts and does not crash;
- exactly 500 rows; identical timestamps across a page boundary;
- a cancellation raises the flag;
- alert after N failures;
- an interval change takes effect without a restart;
- a warning below 30 or above 60;
- the lease stops two runs at once.

---

## 9. Piece 8: Open Items (D-004, D-010 to D-013)

### 9.1 Model

**`OpenItem`:**

| Column | Notes |
|---|---|
| `number` | `OI-YYYY-######`, reset yearly; one sequence row per year |
| `loanId`, `branchId` | |
| `field`, `fieldLabel` | |
| `oldValue` | DMS value |
| `newValue` | myloans value |
| `sourceUpdatedAt` | myloans timestamp |
| `syncRunId` | The run that raised it |
| `raisedAt` | |
| `status` | `PENDING` / `APPROVED` / `REJECTED` / `SUPERSEDED` |
| `supersededById` | |
| `groupKey` | See 9.2 |
| `decidedById`, `decidedAt`, `remarks` | Remarks required, 5–500 characters |

**Partial unique index:** one `PENDING` item per (`loanId`, `field`). This is hand-written SQL and goes on the `CLAUDE.md` never-drop list.

### 9.2 A newer change while an item is pending: proposal

**Recommended: supersede.**
1. The pending item for that field becomes **SUPERSEDED**, linked to its replacement.
2. A **new** item is created with `oldValue` = the DMS value (still unchanged) and `newValue` = the latest myloans value.
3. If the latest myloans value **equals the DMS value** (myloans reverted it), the old item is SUPERSEDED with the note "Reverted in myloans" and **no new item** is created.

**Alternative: update in place** (today's behaviour). It is simpler, but the approver cannot see that the value changed twice, and the audit trail of what was pending when is lost.

**Recommendation:** supersede. It matches chart 9b H and keeps a clean audit trail. Your decision is needed (Q-N10).

**Fields that feed the rules** (loan type, amount, product code, release date) form one **group** per loan and change (`groupKey`). They are decided together, because the screen shows the rule effect of the set (chart 9b A–D). Other fields are decided one by one.

### 9.3 What approval does

| Decision | Effect |
|---|---|
| **Approve** | Writes `newValue` to the Loan; updates `sourceUpdatedAt` and `contentHash` once no items remain pending for the loan; re-runs the rules for rule fields (existing apply logic, `source-sync.ts:371-441`; in-process transactions never change). For a cancellation: closes as cancelled and clears `cancellationPending` |
| **Reject** | Keeps the DMS value. The myloans timestamp and remarks are logged |

Both are audited.

### 9.4 Queues and approvers

**Who sees an item:** users with `openitems:approve` whose branch scope covers the item's branch.

**The Unassigned queue** shows items for branches where **no active user** has `openitems:approve` covering that branch. It is visible to the Superadmin and to approvers with All branches (D-011). This is computed live, so assigning an approver moves the items at once.

### 9.5 Screens

| Screen | Contents |
|---|---|
| **Open Items** (`/open-items`) | Tabs: Mine (my branches), Unassigned, Decided. Filters: branch, field, age. Each row shows PN, field, old → new, myloans time, raised time, and group. Approve / Reject with required remarks. Rule-field groups show the effect ("adds Mortgage and For Entry PPSR", "cancels unsent PPSR") |
| Loan file | Banner "N Open Items" and "Cancellation pending review" |
| Home | Approvers get a count card |
| **Reference data changes** (`/reference-changes`) | entity, field, old, new, when, source (API 4 / 5). Visible with `refdata:view` (Admin, LA Supervisor/Head). Each rename also raises an in-app notice to those users |

### 9.6 Notifications

New items notify:
- the current holder (piece 9);
- the approvers for the branch, or the Unassigned audience.

### 9.7 What is removed and rewritten

| Removed | Rewritten |
|---|---|
| The MINOR auto-apply (`source-sync.ts:193-207`); the five review classes; the `SourceChange` reviews and `components/loan/source-review.tsx` / `borrower-review.tsx` pop-ups (replaced by the Open Items screen). Dev rows are migrated to `OpenItem` | The tests listed in `FOUNDATION_CHECK.md` C.4; the kit simulator kinds; `docs/workflow/08-systems.md`; `docs/myloans/field-map.md` |

### 9.8 Tests

- every monitored field creates its own item;
- unmonitored fields create none;
- approve applies and reject keeps, both with remarks required;
- supersede, and reverted means no new item;
- the unique pending index;
- branch-scoped approver queues; Unassigned; giving an approver moves items;
- an override grant / deny on `openitems:approve`;
- a cancellation blocks Forward until decided;
- a rule-field group shows and applies the effect (chart 9b A–D);
- a reference rename is applied, logged and noticed.

---

## 10. Piece 9: Accept / Forward engine, inbox, TAT (D-014, D-015)

### 10.1 Model

| Model | Purpose |
|---|---|
| `WorkItem` | What is waiting or in hand. Columns: `subjectType` (LOAN_CANDIDATE, LOAN, TRANSACTION, FUND_REQUEST, PACKAGE), `subjectId`, `stageCode`, `branchId` (pool), `holderUserId` (null while in the pool), `arrivedAt`, `acceptedAt`, `dueAt`, `state` (`POOL` / `HELD` / `DONE`). **Partial unique index:** one open WorkItem per (subjectType, subjectId) |
| `Movement` | Append-only ledger (v2 `TransactionMovements`). Columns: `action` (ARRIVE, ACCEPT, FORWARD, RETURN, REASSIGN, CANCEL), `workItemId`, `stageCode`, `fromUserId`, `toUserId` / `toBranchId`, `at` (database `now()`), `remarks`, `returnReasonId`, `waitingDays`, `tatDaysUsed`, `isLate` |
| `StageTarget` | Replaces the `TatRule` keys. Per `stageCode` (and role): target working days. Seeded from v2 §2.2: LA check and assign 1, DP 5, Finance CA 1, Finance FT 1, LA accept and transmit 1, later stages for their modules |

### 10.2 TAT calculation: proposal

| Measure | Rule |
|---|---|
| **TAT used** | `workingDaysBetween(acceptedAt, forwardedAt, holder's branch)`. Counted by calendar day: the accept day is day 0; a forward on the same day is 0; the next working day is 1 |
| **Due** | The end of working day `target` after the accept day. Late when forwarded after that |
| **Waiting time** | `workingDaysBetween(arrivedAt, acceptedAt)`. Recorded and reported, not counted as the holder's TAT (D-014) |
| **Shown in the inbox** | "N days left" / "Due today" / "Late by N", using the same functions |
| **Holds** | The clock does not pause (today's rule), unless Q-N7 decides otherwise. Hold time is recorded on the movement so reports can show it |
| **Late fund release** | Recorded on Finance's own WorkItem (FUND_REQUEST), so it counts against Finance, not the DP (v2 §5.3) |

**Working days vs calendar days:** working days, per the calendar (piece 4) and the holder's branch for local holidays. Hours are kept in the movement (`at`), so an hours-based report is possible later without a data change.

### 10.3 Flows wired now

These are the stages that exist today. Custodian, QA, Digicur and Archiver are wired in their own modules (Q-N9 to confirm).

| Flow | Hand-off |
|---|---|
| LA | Pool item "Released. Not yet in DMS" or a PN search → **Accept** (the loan file opens, assigned to that LA; TAT starts) → check documents → **Forward** to DP (one WorkItem per transaction; the DP pool or the named DP) |
| DP | Accept / Decline (remarks) / Hold → fund request **Forward** to Finance (the CA or FT pool, by `handlesCa` / `handlesFt`) |
| Finance | Accept → release → **Forward** back to the DP |
| DP | Receipt confirmation is in the next module → LTO → **Forward** the package to the receiving LA branch pool |
| Receiving LA | Accept |
| Return | To the previous holder, with a required reason and remarks |
| Reassign / cancel | Admin and Superadmin (`transactions:reassign` / `cancel`); audited |

The existing `DpAssignment` / `DocumentMovement` records keep working. The engine writes `Movement` alongside them, and later modules can move fully to the engine.

### 10.4 Screens

| Screen | Contents |
|---|---|
| **Home → Inbox** | Two lists: **My items** (held) and **Branch pool** (my scope, my role's stages). Each row: what, PN, stage, arrived, waiting, days left. Accept on pool rows |
| Loan file | A **Movements** tab (accept / forward / return history with TAT used and late flag) |
| Report | **TAT per stage per user** (basic; export later) |

### 10.5 Tests

- TAT used and due across weekends, holidays, local holidays and the year end;
- waiting time;
- one open WorkItem per subject (index);
- accept from the pool assigns the item; a second accept is refused;
- forward closes the item and opens the next;
- return goes to the previous holder with remarks required;
- reassign / cancel only with the permission;
- inbox counts are branch-scoped.

---

## 11. Piece 10: PN # search

- **Order unchanged:** validate → DMS → myloans (API 1).
- **API 1 answers:**
  - 404 → "Not found";
  - 422 → a status card with the status;
  - several rows → use the non-superseded row and log a warning.
- **On open**, save `externalLoanId` and `contentHash`. Duplicates are prevented by the database (`Loan.pn` and `Loan.externalLoanId` unique; race handled).
- **IsSelectable** from the API replaces the status-12-only check.
- **`PnSearchLog`:** user, PN typed, outcome (INVALID / FOUND_IN_DMS / NOT_FOUND / NOT_SELECTABLE / OPENED), status id, time. Shown under Reports, scoped.
- **"Released. Not yet in DMS"** from the pool: Accept opens the file the same way.
- **LoanTransaction uniqueness:** a partial unique index on (`loanId`, `typeId`) for non-removed transactions. It goes on the never-drop list.
- **Rule 4 exact decimals:** reject "1,000" and "1e6"; compare as decimal strings. Included here if you agree (Q16, still open).

**Tests:** every outcome is logged; superseded handling; the unique constraints under concurrent opens; pool accept opens once.

---

## 12. Piece 11: Branches and products (APIs 4 and 5)

- **Branches:** the live adapter's `listBranches` uses API 4. The mock serves it. Renames are applied and logged (D-012). Existing Branch review is kept for new or unknown branches.
- **New `Product` table:** `productCode` (unique), `name`, `active`, `sourceUpdatedAt`. Synced from API 5. Loans keep `productCode`; the name is read from `Product`.
  - **Rule 1 risk:** a rename that would flip Financing / Refinancing for an open loan. See Q-N2.
- **LTO-PASIG** (D-020): seeded with a sample distance. New `LtoOffice.isSample` and `sampleNote` = "Sample. Verify with Operations". Settings and the Send panel show a warning badge on that office.

---

## 13. Step 2 and the new seed

Step 2 (reset and seed) runs **before** Step 4. So `npm run db:reset-seed` is built to grow:
- the first version seeds what today's schema supports;
- each Step 4 piece extends the seed for its new tables (overrides, Open Items, Products, calendar, mock data);
- the reset-seed is re-run after each piece.

`db:reset-seed`:
- refuses unless the database name is the local dev one, `APP_ENV=local`, and `ALLOW_DESTRUCTIVE=1` is set for that one command (reusing `lib/env/destructive.ts`);
- never runs in `staging` or `production`;
- takes an automatic backup first;
- is documented in the README.

**Note:** it replaces everything in `gdfi_dms`, including the Manual Test Kit data. `kit:restore` can bring a saved kit back, and `kit:rebuild` is needed after each migration (`CLAUDE.md`).

---

## 14. Tests (summary)

| Area | Tests |
|---|---|
| Permission rules | Resolver unit tests; a role × surface table test (every page, action, route and file) generated from the matrix; override grant / deny; lock-outs; scan test (no inline checks, no role-name checks) |
| Branch scope | Every role × other-branch list / count / detail / action / file → absent or 404; file access log rows |
| Open Items | Per field; monitored fields; approve / reject with remarks; supersede / revert; unique pending; approver queues and Unassigned; cancellation blocks Forward; rule groups; reference renames |
| Interval change | Live without restart; warning band; the cron gate respects the new value; audit row |
| Sync | Checkpoint commit rule; overlap repeats; timestamp-only; ExternalLoanId; superseded; duplicates; exactly 500; identical timestamps; N-failure alert; lease |
| PN # search paths | Invalid; in DMS; 404; 422; superseded double row; open; pool accept; Search Log; unique constraints |
| TAT | Calendar (ticks, national and local holidays, month and year end); TAT used; due; waiting; late; inbox wording |
| Liquidation | CA / FT settings; saved due date; unaffected by later setting changes |
| Sign-in | Production / staging refuse test mode; real users cannot use test sign-in |
| E2E | Each seeded role signs in and sees only its matrix (Step 5); Open Items approve / reject; inbox accept / forward |

Vitest and e2e run one after the other on `gdfi_dms_test` only (`CLAUDE.md`).

---

## 15. Questions still open

Some are carried from Step 1; some are new from the contract.

| # | Question | My proposal |
|---|---|---|
| Q-N1 | **Superseded copies vs "ignore IsSuperseded = 1".** If the loan the DMS saved becomes the superseded copy and a **new** `ExternalLoanId` becomes live (same PN), ignoring superseded rows would make the DMS loan stop syncing, and the new id would appear as "Released. Not yet in DMS" although the PN is already open. (myloans question A3) | When a superseded row matches a DMS loan, or a selectable row's PN is already in the DMS under another id, raise an Open Item **"myloans record replaced"**. Re-link to the new id only on approval |
| Q-N2 | A product rename (API 5) is auto-applied (D-012), but Rule 1 classifies from the product name. Should a rename that would **change Financing / Refinancing** for an open loan raise an Open Item instead? | Yes: auto-apply the name, and raise an Open Item only when the rule result would change |
| Q-N3 | A cash advance covering several transactions: is liquidation due N days after the **last** LTO completion, or per transaction? | Last |
| Q-N4 | Who edits branch scope, CA / FT ticks and the approver tick: Superadmin only, or Admin too? | Superadmin only (D-008); Admin read-only |
| Q-N5 | Allow test sign-in in **staging** for UAT before Entra exists? | No (staging refuses), unless you want an explicit `ALLOW_TEST_SIGNIN` for UAT |
| Q-N6 | Finance approval step and **amount bands**. v2 has no approval (release only). D-010 turns approvers into per-user tickboxes. Keep the approve-then-release step and the small / large bands, or drop approval? | Keep approve as an optional per-user tick; drop amount bands. Please confirm |
| Q-N7 | Does On Hold pause TAT? (Q13) | No pause; hold time reported separately |
| Q-N8 | Does the 30-minute sync run 24/7 or office hours only? Do checks continue for loans in safekeeping (years) until "Loan closed/released"? (Q11, Q15) | 24/7 (one API 2 call is cheap); keep syncing until closed |
| Q-N9 | Accept / Forward now for the existing stages only, with Custodian / QA / Digicur / Archiver in their modules? (Q2) | Yes |
| Q-N10 | A newer change while an Open Item is pending: supersede (recommended) or update in place? | Supersede (9.2) |
| Q-N11 | Where is "Processing complete" set, and what signals "fully paid"? (Q15) | Later module; not needed for the foundation |
| Q-N12 | Rule 4 exact decimals now? (Q16) | Yes, in piece 10 (½ day) |
| Q-N13 | Birth date: options D1 / D2 / D3 in `docs/MYLOANS_QUESTIONS.md` §D | D2 (compare without storing) |
