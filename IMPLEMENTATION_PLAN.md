# Implementation Plan: Foundation (Settings, RBAC, 3.1, 3.2)

Date: 16 November 2026 (PHT)
Branch: `feature/foundation-settings-rbac-myloans`
Inputs:
- `FOUNDATION_CHECK.md` and `FLOWCHART_ALIGNMENT.md` (Step 1);
- `docs/DECISIONS.md` D-001 to D-021;
- the myloans contract in `docs/myloans-api-contract.sql` (the agreed target is pending paste, D-022) and the reply in `docs/MYLOANS_REPLY_2.md`;
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
| **3a** | **Product classification by keywords** (D-027): settings, preview, Can't classify / conflict, saved result, reclassify, minimal Product table. Moved before the myloans pieces because the LA module needs it | 3–4 | 2, 3 |
| 4 | One working-days calendar (Mon–Sun ticks, national and local holidays) | 2–3 | — |
| 5 | Liquidation due: one CA / FT setting, saved at LTO completion; remove the old constants | 2 | 4 |
| 6 | myloans mock APIs 1–5 (the exact contract) | 3–4 | — |
| 7 | myloans sync on API 2: checkpoint, paging, repeats, ExternalLoanId, superseded, duplicates, run log, alerts, interval setting | 5–7 | 6, 4 |
| 8 | Open Items per field: approver queue + Unassigned, Superseded, cancellation pending, monitored fields, Reference data changes log | 7–9 | 2, 3, 7 |
| 9 | Accept / Forward engine: movement ledger, branch pool + personal inbox, per-user TAT + waiting time, return with remarks | 8–12 | 2, 3, 4 |
| 10 | PN # search: IsSelectable, ExternalLoanId on open, Search Log, "Released. Not yet in DMS" accepted from the pool | 2–3 | 7, 9 |
| 11 | Products (API 5) and branches (API 4) from the mock; LTO-PASIG sample warning | 2–3 | 6 |
| 12 | Docs, manual test kit, e2e update; Step 5 verification | 4–6 | all |
| | **Total** | **≈ 50–68 days** | |

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
| `canSignIn` is replaced by a matrix permission, **"Sign in"** (`auth:sign_in`), ticked by default for all 10 roles. **Not done in piece 2:** instead every built-in role's default `canSignIn` is now true (so DP, Finance, Custodian, QA, Digicur, Archiver can sign in). The permission version is deferred to the Entra piece | deferred |
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

> **Status: built 17 Nov 2026** (branch `feature/foundation-settings-rbac-myloans`). Choices made while building are recorded in D-028.
>
> **Where the build differs from this plan:**
> - **Role keys are kept.** `SUP` (now "LA Supervisor/Head"), `FIN`, `VAULT` ("Custodian"), `DIG` ("Digicur") and `MONITOR` ("Monitoring (read-only)") keep their keys; only the names and ticks changed. New keys: `SUPERADMIN`, `ARCHIVER`. `APPR` is retired. Keys are internal ids (no code checks them), so renaming them would have changed the kit, the seed and about 50 tests for no gain.
> - **No `openitems:approve` key yet.** "Can approve LA Open Items" is an override of the two myloans review keys (`OPEN_ITEM_APPROVER_KEYS`); piece 8 may rename it.
> - **No `transactions:reassign` / `transactions:cancel`** yet: they come with the engine (piece 9).
> - **`canSignIn` is not replaced by a permission:** every built-in role now defaults to sign-in on (see §2).
> - **Admin keeps myloans review and sync settings** until pieces 7 and 8 rewrite them.
> - **One download route and the file-view log** stay in piece 3. Piece 2 put the receipt and evidence checks in `lib/services/file-access.ts` and added branch scope to receipts (G1) and the Finance Home (G2).
> - **Also built:** approval bands as a setting, off by default (D-024); the reviewers of myloans changes limited to the loan's branch (D-011).

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
| **Users → Edit** | Role; status; branch scope (existing tree + "All branches"); Handles CA / Handles FT; "Can approve LA Open Items". A **permissions panel** shows each key as Inherited ✓/✗ / **Granted** / **Denied**, with a reason note | Per D-023. **Superadmin only:** overrides, the approver tick, "All branches", role. **Admin and Superadmin:** specific branches, Handles CA / FT. **Nobody** edits their own access or scope (server-side refusal, audited attempt). Admin sees the rest read-only |
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

## 3a. Piece 3a: Product classification by keywords (D-027, final rule D-031)

> **Status (17 November 2026): built** with the final rule of D-031, which replaces §3a.1 to §3a.3 below: Refinancing keyword first, then Financing, else a default setting; no "Can't classify" and no conflict state; "Classified by default" is a label and a Loans filter, never a block. Built: `lib/rules/classify.ts` (rule), `classification.rules` setting and Settings, Product classification (keywords, default, Test keyword rules), `Loan.classifiedByDefault` / `Loan.classificationNow` (migration `20261119090016_product_classification`), the re-check on save, "Classification changed since accepted" and Reclassify (`loans:reclassify`: LA Supervisor/Head and Admin; `settings:classification`: Admin and Superadmin). **Not built here:** the `Product` table and ProductID rename detection (with API 5 in piece 11); a myloans product rename goes through the existing MyLoans change review (Apply re-runs the rules). The fake product "Auto Finance" in the kit and mock data became "Car Loan" (no keyword), since `financ` now makes "Auto Finance" Financing.


### 3a.1 Rule

The rule decides **Financing**, **Refinancing**, **Can't classify** (no match) or **Classification conflict** (both lists match) from the **product name only**.

`lib/rules/index.ts` `classifyProductName` (whole words "Refinancing" / "Financing"; neither or blank = Refinancing) is replaced. Rules 2–4 stay as they are; Rules 2–3 (Undertaking and OR/CR picks) apply only to Financing.

### 3a.2 Matching: proposal (Q-N16)

The literal rule "ignore spaces and hyphens, then look for the keyword anywhere" causes **false conflicts**. Removing spaces joins words, so:
- "Agriculture Financing" becomes `agriculturefinancing`, which contains `refinanc`;
- "Auto Refinancing" contains `financing` as well as `refinanc`.

**Proposed rule C:**
- case-insensitive;
- a keyword matches **at the start of a word**;
- hyphens and extra spaces **inside** a word are ignored, so "Re-Financing" = "refinancing";
- " - " between words is a separator.

### 3a.3 Starting keywords: proposal (Q-N17)

**Not seeded until you confirm.** Preview on every product name in the kit and mock data, plus four examples from v2 and the BRDs:

| Product name | Today (v2 Rule 1) | Your example keywords, literal rule (Refi: `refinanc`, `refi`; Fin: `financing`) | **Proposal: rule C, Refi `refinanc`, `refi`; Fin `financ`** | Rule C with Fin `financing` only |
|---|---|---|---|---|
| Auto Financing | Financing | Financing | Financing | Financing |
| Auto Refinancing | Refinancing | **CONFLICT** | Refinancing | Refinancing |
| Auto Finance | Refinancing (v2 example) | Can't classify | **Financing** | Can't classify |
| Truck Financing | Financing | Financing | Financing | Financing |
| Truck Refinancing | Refinancing | **CONFLICT** | Refinancing | Refinancing |
| Angono - Car Financing | Financing | Financing | Financing | Financing |
| Auto | Refinancing | Can't classify | Can't classify | Can't classify |
| (blank) | Refinancing | Can't classify | Can't classify | Can't classify |
| Car Loan (v2 example) | Refinancing | Can't classify | Can't classify | Can't classify |
| Personal - Doctors Loan (v2 question) | Refinancing | Can't classify | Can't classify | Can't classify |
| Agriculture Financing (made-up) | Financing | **CONFLICT** | Financing | Financing |
| Hardware Financing (made-up) | Financing | **CONFLICT** | Financing | Financing |
| Auto Re-Financing (made-up) | Financing | **CONFLICT** | Refinancing | Refinancing |

The real product list (`PR_PRODUCTS`) is requested from myloans (`docs/MYLOANS_REPLY_2.md`). The keyword lists should be checked against it before go-live.

### 3a.4 Data

| Change | Detail |
|---|---|
| Setting `classification.keywords` | `{ refinancing: string[], financing: string[] }`; audited; Admin + Superadmin (`settings:classification`) |
| `Loan` columns | `classification` (FINANCING / REFINANCING / UNCLASSIFIED / CONFLICT), `classifiedProductName`, `classifiedAt`, `classificationChanged` (bool) |
| New `Product` table | `productId` (myloans ProductID, unique), `productCode`, `name`, `active`, `sourceUpdatedAt`. Moved here from piece 11. Filled from mock API 5 and from loans' product names; a rename (same ProductID, new name) goes to the Reference data changes log |
| Permission | `loans:reclassify` (default: LA Supervisor/Head, Superadmin) |

### 3a.5 Behaviour

| Event | What happens |
|---|---|
| **Accept / open** | Classify and save the result with the product name used |
| UNCLASSIFIED or CONFLICT | An alert (in-app; email when on) to Admin and the LA Supervisors/Heads of the branch. A banner on the loan file. **Send to DP / Forward is refused** with the reason (today's send action now; the engine in piece 9) |
| **Re-check** (keyword save, product rename, loan product change) | Re-classify open loans. If the result differs from the saved one, set `classificationChanged` and show the banner "Classification changed since accepted: was X, now Y" |
| **Reclassify** (`loans:reclassify`, remarks required) | Applies the new result: the existing Rules 2–4 and the transaction effects (re-uses the "apply" path; sent or in-process transactions never change). Audited |
| **Test keyword rules** (Settings) | Before saving, a table of every known product (`Product` + distinct product names on open loans) with today's and the new result, and how many open loans change |

### 3a.6 Mock products (piece 6)

The mock includes:
- a clear Financing name;
- a clear Refinancing name;
- no keyword;
- both keywords (e.g. "Financing and Refinancing Promo");
- a rename that flips the classification (same ProductID: "Auto Loan" → "Auto Refinancing").

### 3a.7 Tests

- the matching rule: case, hyphens, word start, both or none;
- the preview counts;
- the saved classification on accept;
- Can't classify / conflict block Send and Forward, and the alert goes out;
- a keyword change and a rename flag "changed since accepted" without switching;
- reclassify only with the permission, with remarks, audited;
- a rename recognised by ProductID and logged.

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
| Decided | D-044: due after the **last** LTO pickup; cancellations, note-only lines, carry-over and the fallback as recorded there; N is a column on Funds types (`liquidationDueDays`), not two settings |
| Late record | `liquidatedAt` and `daysLate` on the advance (working days after the due date up to the liquidation day). **v2 demerit points (a later phase) will read this record.** |

**Tests:**
- due date across a weekend, a holiday, month end and year end;
- CA vs FT values;
- a setting change does not move existing records;
- the old keys are gone.

---

## 7. Piece 6: myloans mock (agreed contract, D-022)

> Rewritten on 16 Nov 2026 for the myloans team's updated answers and query (D-022). This is plan only; no sync code yet.
> **Checked against the actual query** (`docs/myloans-api-contract.sql`, saved 16 Nov 2026) and the answers (`docs/MYLOANS_ANSWERS.md`). The list of corrections is in §7.1.

**What it is.** A local HTTP mock served by the app at `/api/dev/myloans/api/dms/v1/...`.
- It refuses unless `APP_ENV=local` and `MYLOANS_MODE=mock`.
- The **real** HTTP adapter points at it, so the production code path is exercised. It is swappable by changing `MYLOANS_BASE_URL`.

**Endpoints and behaviour:**

| Call | Behaviour |
|---|---|
| API 1 `GET /loans/{pnNo}` | The query returns **0–2 rows, any status** (`TOP 2`). The API layer maps them: no row → 404; no selectable row → 422 with `TransactionStatusId`, `FeedState` and, for a redo, `ReplacedByPNNo`; a selectable row → 200. The 404 / 422 mapping is v2 §11.1, still to be confirmed with myloans |
| API 2 change mode `GET /loans/changes?since=&afterId=&limit=500` | Loans **ever released** (they have a ReleaseDate) and changed after `since`, in **any FeedState**. `since` is **fixed for the whole run**. Pages are `ORDER BY ExternalLoanId` with `id > afterId`. **Every row** carries `RunStartedAt`; each page has its own, and the DMS uses page 1's. The query has no `nextCursor`: the next `afterId` is the last row's id. A page with fewer than 500 rows is the last; an exactly full last page is followed by an empty page |
| Pool mode (first load) `GET /loans/changes?releasedSince=&afterId=&limit=500` (URL proposed; the query defines the mode, not the URL) | Only `FeedState = Released` loans released on or after the cutoff, paged the same way (D-022 #9) |
| ~~API 3 freshness~~ | **Dropped (myloans round 2, D-036).** The Refresh button calls API 1 for that PN #; API 1 returns the loan in any state, so a refresh also shows a cancellation or a redo. Nothing in the mock or the code calls API 3 |
| API 4 `GET /branches` | Branches |
| API 5 `GET /products` | Products |

**Fields the mock returns** (exactly the query's columns, in its order; no birth date at all, D-037):
- `RunStartedAt`
- `ExternalLoanId`, `CIN` (base code, 20 characters), `PNNo`, `TransactionStatusId`, `TransactionIsActive`, `FeedState`, `IsSelectable`
- `ReplacedByExternalLoanId`, `ReplacedByPNNo` (superseded rows)
- `CIFNo`, `FirstName`, `MiddleName`, `LastName`, `Suffix` (empty parts are `null`)
- ~~`BirthDateHash`~~ **Removed (D-037):** no birth date and no HMAC in the contract
- `LoanID`, `LoanTypeId` (= LoanClass), `LoanType` (name: New / Renewal)
- `BorrowerCompanyName` (the borrower's employer: a **loan** field)
- `TotalLoanAmount` (a **string**, e.g. `"219590.00"`), `ReleaseDate` (datetimeoffset in +08:00)
- `ProductID`, `ProductCode`, `ProductName`
- `CompanyID`, `CompanyName`, `DivisionId`, `DivisionName`, `AreaId`, `AreaName`, `BranchID`, `BranchCode`, `BranchName` (the **organization**: reference data)
- `SourceUpdatedAt`, `ContentHash` (64 lowercase hex characters, no `0x`)

**FeedState values:**

| Value | Meaning |
|---|---|
| `Released` | Selectable |
| `Cancelled` | Cancelled in myloans |
| `Superseded` | Replaced by another myloans record |
| `Inactive` | No longer active |
| `NotReleased` | Not, or no longer, at status 12 |

The query picks the **first** state that applies, in this order:
1. Cancelled (status 14)
2. Superseded (code longer than 20 characters)
3. NotReleased (status ≠ 12)
4. Inactive (`is_active` = 0)
5. Released

So a loan that is cancelled **and then redone** stays `Cancelled`, never `Superseded`, but it still carries `ReplacedByExternalLoanId` / `ReplacedByPNNo`.

**ContentHash** is computed in the mock exactly as the query does:
- **Round 2 (D-036, D-037): 17 fields** (birth date removed; field 17 = `ReplacedByExternalLoanId`). SHA-256 over the UTF-16LE text of `CONCAT` of the fields joined by `|`, in this order: FeedState, PN, status id, is_active, CIF, first, middle, last, suffix, birth date (style 126), LoanID, LoanClass, borrower company name, amount, release date (+08:00, style 126), ProductCode, BranchID.
- **NULL counts as empty text** (no `~` marker).
- Output: 64 lowercase hex characters.
- `ReplacedByExternalLoanId` is **not** in today's hash (requested in `docs/MYLOANS_REPLY_2.md`). The mock has a switch to add it once myloans does.
- Byte-for-byte equality with SQL Server is checked against sample rows requested from myloans.

### 7.1 Corrections after checking the actual query (16 Nov 2026)

| # | The plan said | The actual query | Now |
|---|---|---|---|
| 1 | API 3 freshness exists | No API 3 | **Dropped (D-036):** on-demand refresh uses API 1 |
| 2 | API 1: 404 / 422 / 200 | The query returns 0–2 rows of any status; the HTTP codes are the API's job | Mapping kept, marked "to confirm"; 422 explains why from FeedState and `ReplacedByPNNo` |
| 3 | `RunStartedAt` on page 1 | On **every row**, set per call | The DMS uses page 1's value |
| 4 | Fields as summarized | Also `ReplacedByPNNo`, `ProductID`, org ids and names, `BranchCode`, and **two** company fields | Field list corrected. `BorrowerCompanyName` is a monitored loan field; `CompanyName` is reference data |
| 5 | FeedState: 5 values, no order | A CASE with a fixed order; Cancelled outranks Superseded | Documented above; cancel-then-redo keeps `Cancelled` but has `ReplacedBy…` |
| 6 | Hash input "per the agreed query" | 17 fields; NULL = empty text; lowercase hex; ReplacedBy and all names not hashed | Mock follows it exactly; test vectors requested |
| 7 | Amount a decimal | The API sends `TotalLoanAmount` as a **string** | Parsed as an exact decimal string |
| 8 | Names: borrower display name | `NULLIF`: empty name parts arrive as `null` | Stored as parts; display joins the non-null ones |
| 9 | PN search: statuses 15–19 = not found | FeedState explains every case | Replaces the status-range rule |
| 10 | Pool endpoint `releasedSince` | The query defines the mode, not a URL | URL marked "proposed" |
| 11 | Reference renames via the feed | Names come in the feed but are not hashed | A rename shows only when the loan also changes, or through APIs 4 / 5 (API 5 required before go-live) |

**Scenario builders** (fake data only, in a local-only mock table):

| Scenario | What it covers |
|---|---|
| **Cancel-then-redo** | The old row becomes `Cancelled` (its hash changes once, through FeedState). Later its code gets the suffix and `ReplacedBy…` is set, with the **hash unchanged** (Cancelled outranks Superseded, and ReplacedBy is not hashed). A **new ExternalLoanId with the same CIN** and a new PN # arrives as `Released` |
| `NotReleased` row (and later `Released`) | FeedState handling |
| **Superseded with `ReplacedByExternalLoanId` / `ReplacedByPNNo`** (a redo without a cancellation) | Replacement case (a) |
| Timestamp-only change (same hash) | No action |
| Runs with pages of **exactly 500** rows (full page, then a short or empty page) | Paging end |
| **Pool mode**: released loans since the cutoff, more than 500 | First load |
| API 1 returning **2 rows** for one PN # (one selectable) | Safeguard |
| A duplicate `ExternalLoanId` within one run | Safeguard |
| `LoanID` / `LoanClass` change | Loan-type Open Item |
| Empty `LoanTypeId` | "Can't classify" |
| ~~`BirthDateHash` change~~ | **Removed (D-037):** no birth date item |
| Branch / area / division / company / product renames | Reference data changes log |

Settings → Test data has a "myloans mock" panel (local only) to fire each scenario.

**Tests:** contract tests on the mock (status codes, `afterId` paging, fixed `since`, `runStartedAt`, exactly 500, pool mode, 2-row API 1) and on the adapter's zod parsing of every response.

---

### 7.2 Round 2 contract (17 Nov 2026, D-036)

The agreed query is `docs/myloans-api-contract.sql` (reference only, never run by the DMS); myloans' answers are `docs/MYLOANS_ANSWERS_R2.md`. Built now as pure, tested code in `lib/myloans/r2/` (the database side comes with pieces 7 and 8):

| # | Contract | Where |
|---|---|---|
| 1 | **ContentHash = 17 fields** (birth date removed, D-037; 17 = `ReplacedByExternalLoanId`). The DMS only **compares** hash strings; it never recomputes them in production | `hash.ts` (mock and test vectors only) |
| 2 | **Paging by loan:** `{ runStartedAt, items, nextAfterId }`; `nextAfterId` null = last page; empty page = `items: []` and null. Page 1's `runStartedAt` is kept for the run; checkpoint = it minus 5 minutes, saved **only after every page succeeded** | `sync-plan.ts` `fetchRun` |
| 3 | `RowsForThisLoan` > 1 (or two rows for one loan): **duplicate alert** to Admin with the rows logged; **no Open Items** for that loan in that run | `planRun` |
| 4 | **API 1 codes:** 404 not found; 422 not selectable (FeedState and "Replaced by <PN>"); 200; 409 several rows: log all, use the single `IsSelectable = 1` row if there is exactly one, else "Multiple records in myloans, contact Admin." and alert | `contract.ts` `readApi1` |
| 5 | **API 3 dropped:** Refresh calls API 1 | plan rows above |
| 6 | **All 5 FeedStates in API 2 too:** `NotReleased` can appear for an ever-released loan whose status left 12 (myloans' note says otherwise; corrected in `docs/MYLOANS_REPLY_3.md`) | `planRun`, mock |
| 7 | **Redo chains:** the CIN always links to its current live transaction. A new `ExternalLoanId` for a known CIN raises "record replaced" (rule b), even if the older copies are never re-sent | `planRun` |
| 8 | **API 5 products:** the full list each sync (`UpdatedAt` may not exist); renames by `ProductID`; re-run the keyword classification; flag "Classification changed since accepted" on the loans that flip | `productRenames`, `classificationFlips` |
| 9 | **Mock:** SHA-256 over UTF-16LE of HashInput, lowercase hex, NULL = empty text, 17 fields. Scenarios: page cut by loan with a duplicate row, 409 on API 1, redo chain of 3, NotReleased in API 2, product rename that flips the classification. The test of myloans' 3 vectors is **skipped until they send the outputs** | `mock.ts`, `r2.test.ts` |
| 10 | **"Loan closed/released" stays BLOCKED** until myloans finds the paid/closed source (their check R2-4) | stage map, piece 9 |

### 7.3 Round 3 contract (17 Nov 2026, D-040)

myloans' answers are `docs/MYLOANS_ANSWERS_R3.md`; the query in `docs/myloans-api-contract.sql` is now round 3; their read-only check is `docs/myloans/myloans_round3_checks.sql`. Changes to §7.2:

| # | Contract | Where |
|---|---|---|
| 1 | **ContentHash: 17 fields confirmed** by myloans (no BirthDate, no HMAC; 17 = `ReplacedByExternalLoanId`). Round 3 did not change the formula: nothing to re-baseline. The 3 test vectors now use myloans' real column types; the outputs are still to come (test stays skipped) | `hash.ts`, `r2.test.ts` |
| 2 | **Freshness:** `SourceUpdatedAt` = the latest of the `updated_at` columns, the **redo suffix time** (`x<yyyymmddhhmmss>`, Manila; a redo does not touch `Transactions.updated_at`) and the **replacement's `created_at`**. So a redo without a cancellation reaches API 2, and the oldest copy of a redo chain is re-sent when its newest replacement is created | mock `sourceUpdatedAtOf`, `contract.ts` `redoSuffixAt` |
| 3 | **A held copy comes back Superseded:** if its replacement is in the same run, the CIN link gives one "record replaced" (no second decision); if not (a redo seen only through the suffix time), the decision is "superseded" with the replacement's id and PN #, and the sync fetches it with API 1, then applies rule (b) | `planRun` |
| 4 | **API 1:** more than one row is **always 409 with every row**, whatever their states (the DMS reading of §7.2 row 4 is unchanged). A redo makes a new PN #, so old and new copies never share one | `api1`, `readApi1` |
| 5 | **Still open with myloans:** whether cancel and deactivate always touch `updated_at` (they will report the check); no other path changing status or `is_active` silently; R2-3, R2-4, R2-6, A4, A5, C2, C5 | HANDOVER |
| 6 | **Mock scenarios added:** a redo WITHOUT a cancellation that reaches API 2 only through the suffix time; the redo chain of 3 now re-sends its oldest copy | `mock.ts`, `r2.test.ts` |

## 8. Piece 7: myloans sync (D-005, D-016 as amended by D-022)

### 8.1 Identity: linked on CIN

| Change | Detail |
|---|---|
| Link key | A DMS loan file is linked to myloans by **CIN** (unique in the DMS) |
| `ExternalLoanId` and PN # | Stored as **current values with history** in a new `LoanSourceIdentity` table: `loanId`, `externalLoanId`, `pn`, `validFrom`, `validTo`, `reason` (FIRST_OPEN / REPLACED / CORRECTED), `openItemId`, `changedById` |
| `Loan` columns | `cin` (unique), `externalLoanId` (current), `pn` (current; stays unique), `contentHash` (char(64) hex), `feedState`, `sourceUpdatedAt`, `releaseDate` (Manila date), `releasedAt` (offset as received), `birthDateHash`, `loanTypeId`, `cancellationPending` |
| Updates | PN # and ExternalLoanId change only through an approved "myloans record replaced" Open Item |

### 8.2 Job design

The external scheduler calls `POST /api/cron/myloans-sync` every 5 minutes (fixed, `CRON_SECRET`). The route:

1. **Interval check.** It runs only if `now ≥ lastSuccessfulStart + myloans.intervalMinutes`. A change to the interval applies without a restart.
2. **Lease.** It takes a lease row (`SyncLease`). This replaces the 30-minute database transaction that held the advisory lock.
3. **Fixed `since` for the run.** `since` = the saved checkpoint. Every page of the run uses the same `since`.
4. **Paging.** Pages by `ExternalLoanId` with `afterId` (the last id of the previous page), until a page has fewer than 500 rows.
5. **Per page,** in one short database transaction:
   - zod-validate every row;
   - collect ExternalLoanIds for the duplicate check (across pages);
   - handle each row as in 8.3.
6. **Commit.** Only after **all pages succeed**: new checkpoint = **page 1's `runStartedAt` minus 5 minutes** (D-022 #4); save `lastSuccessfulStart`; reset the failure count.
7. **On failure:**
   - keep the old checkpoint; no partial checkpoint is ever written;
   - retry with backoff and `Retry-After`; timeout;
   - after `myloans.alertAfterFailedRuns` consecutive failures (default 3), alert the Admin and Superadmin in-app and by email.
8. **Run log.** Write a `SyncRun` row: start, end, pages, rows, Open Items created, timestamp-only updates, replacements, duplicates, errors, checkpoint before and after.

The rotating-batch polling, tiers, `nextCheckAt` and the background hourly ceiling are removed. On-demand refresh (open, Refresh button) uses **API 1** (the query has no API 3; see §7) and acts only when the `ContentHash` differs from the saved one.

### 8.3 Row handling

The rules apply in this order:

| # | Case | Action |
|---|---|---|
| 0 | **Duplicate `ExternalLoanId` within the run** | Alert the Admin; **no Open Items** for that id in this run; logged on the run (D-022 #10) |
| 1 | Known loan (by CIN and ExternalLoanId), **same `ContentHash`** | **No action** (D-022 #4) |
| 2 | Known, newer `SourceUpdatedAt`, same hash | Not reachable when the hash is the same (#1). Kept as a guard: update `sourceUpdatedAt` only |
| 3 | **Replacement (a):** a row we hold has `ReplacedByExternalLoanId`, in any FeedState (Superseded, or Cancelled after a cancel-then-redo) | Open Item **"myloans record replaced"** showing the **old and new PN #** (from `ReplacedByPNNo`, no extra call) and the ExternalLoanId. Forward blocked. On approval: re-link `externalLoanId` / `pn` (history row) and fetch the new record |
| 4 | **Replacement (b):** a **new ExternalLoanId** with a **CIN we already hold** | Same Open Item as #3. Covers **cancel-then-redo**, where the old row stays `Cancelled` with an **unchanged hash** (so #1 would skip it) |
| 5 | Known, `FeedState` changes **away from `Released`** (to Cancelled / Superseded / Inactive / NotReleased) | Open Item + loan flag **"Cancellation pending review"** (wording per state) + **Forward blocked** (D-013). DMS data unchanged until approved. When #3 or #4 also applies, **one** item is raised: "record replaced" |
| 6 | Known, different hash | Per monitored field that differs: one Open Item (field, DMS value, myloans value, `SourceUpdatedAt`). See the special fields below |
| 7 | Unknown CIN, `FeedState = Released` | Upsert into `SourceLoanCandidate`. Shown in the branch pool as "Released. Not yet in DMS", only if released on or after the **branch pool cutoff date** (#9). No DMS transaction until an LA accepts |
| 8 | Unknown CIN, any other FeedState | Ignored. Any existing candidate is removed |
| 9 | Reference names in the row (`BranchCode` / `BranchName`, `AreaName`, `DivisionName`, `CompanyName`, `ProductName`, matched on their ids) differ from the lookups. These are **not hashed**, so a rename reaches the DMS only when the loan also changes, or through APIs 4 / 5 | Update the lookup automatically; write the **Reference data changes** log (old, new, when, source = feed); in-app notice to Admin and LA Supervisor/Head (D-012). Never an Open Item |

**Special fields in case #6:**

| Field change | Open Item |
|---|---|
| ~~`BirthDateHash`~~ | **Removed (D-037):** the DMS neither stores nor monitors the birth date |
| `LoanID` or `LoanClass` | Shows the **LoanType name** (old → new), for example "New → Renewal", plus the rule effect |
| `LoanTypeId` empty | A **"Can't classify"** alert on the loan file and to the approvers. The rules are not re-run until it is fixed |
| `ReleaseDate` | Received as datetimeoffset, converted to the **Manila date** for display, TAT and rules (D-022 #5). Compared as a Manila date, so a change of offset alone is not a change |

### 8.4 First load and the branch pool cutoff

- **Setting `myloans.branchPoolCutoffDate`** (Superadmin only; audited). Default = go-live date minus 30 days. The go-live date is a setting too.
- **One-time first load:** API 2 pool mode with `releasedSince` = the cutoff. It fills `SourceLoanCandidate` and sets the first checkpoint from that run's `runStartedAt` − 5 min.
- **After the first load,** new releases arrive through the normal API 2 change mode.
- Loans released before the cutoff can still be opened by PN # search (API 1).

### 8.5 API 1 safeguard (PN # search and refresh)

- Up to 2 rows can come back.
- With 2 rows, use the one with `IsSelectable = 1` and alert the Admin.
- With 2 rows and none selectable, show the status of the newest, and alert.

### 8.6 Data

| Model | Columns |
|---|---|
| `Loan` and `LoanSourceIdentity` | As in 8.1 |
| `SyncRun` | As in 8.2 |
| `SyncState` | Per kind: `checkpoint`, `lastSuccessfulStart`, `consecutiveFailures`, `firstLoadDoneAt` |
| `SyncLease` | `owner`, `expiresAt` |
| `SourceLoanCandidate` | `cin`, `externalLoanId`, `pn`, `branchId`, display name, release date, amount, hash, `sourceUpdatedAt` |
| `ReferenceChange` | entity, entityId, field, old, new, at, source, syncRunId |

The old sync settings (tiers, `backgroundMinutes`, `maxPerRun`, `pauseMs`, `hourlyCeiling`, `businessHoursOnly`, `myloans.state`) and the tier columns are retired. `LoanSourceSnapshot` is trimmed to the fields the DMS uses.

### 8.7 Settings

| Setting | Rule |
|---|---|
| `myloans.intervalMinutes` | Default 30; a warning below 30 or above 60, but it saves; audited; live |
| `myloans.alertAfterFailedRuns` | Default 3 |
| `myloans.branchPoolCutoffDate` | Superadmin only |
| `myloans.paused` | Kept |
| `myloans.monitoredFields` | Tickboxes over the hashed loan and borrower fields: PN #, status / active / FeedState, CIF, first / middle / last name, suffix, LoanID, loan type, borrower company name, amount, release date, product code, branch. All are on by default |

### 8.8 Screens

| Screen | Contents | Who |
|---|---|---|
| **Settings → myloans** | Interval (with the warning), alert threshold, cutoff date, monitored fields, pause, Run now | Superadmin |
| **Sync runs** | Table of runs; run detail with errors, duplicates and replacements | Admin, Superadmin |

### 8.9 Tests

| Area | Tests |
|---|---|
| Checkpoint | `runStartedAt` − 5 min saved only after all pages; a failure on page 2 keeps the old checkpoint; `since` stays fixed across pages |
| Repeats and paging | Same hash means no action (repeat delivery from the overlap); `afterId` paging through exactly 500 rows and through a short last page |
| FeedState | All five states; any change away from Released → Open Item + Forward blocked + DMS unchanged until approved |
| **Cancel-then-redo** | The old row arrives `Cancelled` with an **unchanged hash**, and a new ExternalLoanId with the **same CIN** arrives `Released` → one "myloans record replaced" item with old and new PN #. On approval, PN # / ExternalLoanId are re-linked with a history row |
| Replacement (a) | `ReplacedByExternalLoanId` on a held row → the same item |
| Special fields | LoanID / LoanClass change → shows LoanType names; empty LoanTypeId → "Can't classify" |
| ReleaseDate | 2026-11-30T17:00:00Z becomes Manila 1 December (month end); 2026-12-31T16:30:00Z becomes 1 January (year end) |
| Reference renames | Lookup updated, logged and noticed; no Open Item |
| First load | Pool mode honours the cutoff; the first checkpoint is set |
| Safeguards | API 1 two rows → selectable one picked and alert; duplicate ExternalLoanId → alert, no items, run completes |
| Other | Failure alert after N runs; interval change live; warning band; lease |

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
  - no row (404) → "Not found";
  - no selectable row (422) → a status card that says why, from `FeedState`: Cancelled, Inactive, Not released, or **"Replaced by <new PN #>"** (`ReplacedByPNNo`), with a link when that PN is already in the DMS;
  - up to 2 rows → use the one with `IsSelectable = 1` and alert the Admin (8.5).
- The old rule "statuses 15–19 count as not found" (`lib/services/loan-file.ts:146-147`) is replaced by `FeedState`.
- **On open**, save `cin`, `externalLoanId` (with the first `LoanSourceIdentity` row) and `contentHash`. Duplicates are prevented by the database (`Loan.cin` and `Loan.pn` unique; race handled).
- **IsSelectable** (`FeedState = Released`) from the API replaces the status-12-only check. `ReleaseDate` is converted to the Manila date.
- **`PnSearchLog`:** user, PN typed, outcome (INVALID / FOUND_IN_DMS / NOT_FOUND / NOT_SELECTABLE / OPENED), status id, time. Shown under Reports, scoped.
- **"Released. Not yet in DMS"** from the pool: Accept opens the file the same way.
- **LoanTransaction uniqueness:** a partial unique index on (`loanId`, `typeId`) for non-removed transactions. It goes on the never-drop list.
- **Rule 4 exact decimals:** reject "1,000" and "1e6"; compare as decimal strings. Included here if you agree (Q16, still open).

**Tests:** every outcome is logged; superseded handling; the unique constraints under concurrent opens; pool accept opens once.

---

## 12. Piece 11: Branches and products (APIs 4 and 5)

- **Branches:** the live adapter's `listBranches` uses API 4. The mock serves it. Renames are applied and logged (D-012). Existing Branch review is kept for new or unknown branches.
- **Products:** the `Product` table is built in piece 3a. Here it is synced from API 5 (required before go-live, `docs/MYLOANS_REPLY_2.md`). A rename that flips a classification is handled by piece 3a (flag, then reclassify).
- **LTO-PASIG** (D-020): seeded with a sample distance. New `LtoOffice.isSample` and `sampleNote` = "Sample. Verify with Operations". Settings and the Send panel show a warning badge on that office.

---

## 13. Step 2 and the new seed

Step 2 (reset and seed) runs **before** Step 4. So `npm run db:reset-seed` is built to grow:
- the first version seeds what today's schema supports;
- each Step 4 piece extends the seed for its new tables (overrides, Open Items, Products, calendar, mock data);
- the reset-seed is re-run after each piece;
- **each piece adds sample loans for the stages it makes reachable** (Part E of the 16 Nov update).

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

## 14b. v2 spec corrections (deliberate)

Places where the DMS deliberately does not follow the v2 spec. Each one is a recorded decision.

| v2 asks for | The DMS does | Decision |
|---|---|---|
| The borrower's **birth date** (stored and monitored) | Neither receives, stores nor monitors it: not in the myloans contract, not in the ContentHash, no "birth date changed" item | D-037 (not needed by the business; less personal data under RA 10173) |

## 15. Questions still open

Some are carried from Step 1; some are new from the contract.

| # | Question | My proposal |
|---|---|---|
| Q-N1 | ~~Superseded copies vs "ignore IsSuperseded = 1"~~ | **Resolved by D-022:** link on CIN; "myloans record replaced" when a held row has `ReplacedByExternalLoanId` or a new ExternalLoanId arrives with a held CIN (8.3 #3–#4) |
| Q-N2 | ~~Product rename vs Rule 1~~ | **Resolved by D-027:** flag "Classification changed since accepted" and a logged reclassify; never silent |
| Q-N3 | ~~Liquidation due with several transactions~~ | **Resolved by D-032:** N working days after the **last** LTO completion of that fund request |
| Q-N4 | ~~Who edits scope, CA/FT and the approver tick~~ | **Resolved by D-023** |
| Q-N5 | ~~Test sign-in in staging~~ | **Resolved by D-032:** no; staging uses Entra like production |
| Q-N6 | ~~Finance approval and bands~~ | **Resolved by D-024:** keep approve-then-release; bands are a setting, off by default (to confirm with Finance) |
| Q-N7 | ~~Does On Hold pause TAT?~~ | **Resolved by D-032:** a "Pauses TAT" tickbox per hold reason (default on for reasons outside the user's control); hold time always recorded and shown; the inbox shows "Paused" |
| Q-N8 | ~~Sync hours and end~~ | **Resolved by D-032:** 24/7, until "Loan closed/released" |
| Q-N9 | ~~Accept / Forward scope~~ | **Resolved by D-032:** existing hand-offs now; each new stage's piece adds its own |
| Q-N10 | ~~Supersede or update in place~~ | **Resolved by D-032:** supersede |
| Q-N11 | ~~Processing complete / fully paid~~ | **Resolved by D-032:** Processing complete = documents stored in the vault box. Fully paid comes from myloans (required field in `docs/MYLOANS_REPLY_2.md`); "Loan closed/released" is blocked on it |
| Q-N12 | ~~Rule 4 exact decimals~~ | **Resolved by D-032:** exact decimals now; "1,000" or "1e6" refused with the expected format shown |
| Q-N13 | ~~Birth date~~ | **Resolved by D-037:** removed entirely; the DMS neither receives, stores nor monitors it (RA 10173) |
| Q-N14 | ~~Source of Financing / Refinancing~~ | **Resolved by D-027:** keywords in the product name. API 5 required before go-live |
| Q-N15 | ~~One or two items for cancel-then-redo~~ | **Resolved by D-025:** one item |
| Q-N16 | ~~Keyword matching rule~~ | **Resolved by D-031:** case-insensitive, hyphens and extra spaces ignored; Refinancing keyword first, then Financing, else the default (a setting); no conflict state |
| Q-N17 | ~~Starting keywords~~ | **Resolved by D-031:** Refinancing `refinanc`, `refi`; Financing `financ`; default Refinancing. Check against the real PR_PRODUCTS list before go-live |
| Q-N18 | ~~Go-live cutoff~~ | **Resolved by D-032:** go-live minus 30 days, a setting |
| Q-N19 | **Finance and borrower corrections.** Finance has "Review borrower detail corrections" by default with All branches, so under D-029 Finance can decide (and is told about) borrower corrections for every branch. Keep it, or untick it on Finance? | Untick on Finance (the LA Supervisor/Head and Admin decide); one click in the matrix |
