# Foundation Check: Settings, Access and Security (3.1), myloans (3.2)

Date: 16 November 2026 (PHT)
Branch: `feature/foundation-settings-rbac-myloans` (from `8fc835e`)
Spec: *Loan Document Management System v2.docx* (16 Nov 2026), checked against the `.htm` copy.
This is Step 1: analysis only. No code, schema or data was changed.

Status labels used throughout:

| Label | Meaning |
|---|---|
| ✅ **Matches v2** | Built and does what v2 says |
| ⚠️ **Different** | Built, but works differently from v2 or from your decisions |
| 🟡 **Partial** | Some of it exists |
| ❌ **Missing** | Not in the system |

File references are `path:line` from the repo root. The flowchart review is in `FLOWCHART_ALIGNMENT.md`.

> **Corrections to `V2_GAP_ANALYSIS.md`**
> 1. Row 6 said Rule 4 compares exact decimals and rejects "1e6" and "1,000". **It does not.** `parseAmount` strips commas and accepts `"1e6"` (`lib/myloans/data-check.ts:51-57`), and `determineMortgage` compares a JS `number` (`lib/rules/index.ts:82-90`).
> 2. Row 11 said the DMS hash "exists". It exists, but `sourceUpdatedAt` is **never used** to decide anything (`docs/myloans/field-map.md:39`).
> 3. Row 54 said the pending inbox is built. It is only **partial**: the LA list is per branch, not per person, and has no accept step (B.4).

---

## A. Settings

### A.1 How settings work today

- **Key/value settings** live in the `Setting` table.
  - Defaults are in `SETTING_DEFAULTS` (`lib/settings.ts:8-67`).
  - `getSetting` reads the database on every call (`lib/settings.ts:72-75`). There is no cache, so a change applies on the next request with no restart. ✅
- **Lists** (TAT, holidays, LTO offices, types, checklists and so on) are their own tables. Each is edited in Settings and also read on every request. ✅
- **Validation:** every Settings save goes through zod or hand-written checks. ✅
- **Audit:** every Settings save writes an audit row in the same database transaction (`lib/audit.ts:29`). ✅
- **Who can edit:** each list has its own permission key. By default only **Admin** holds them (`ADMIN_PERMISSIONS`, `lib/auth/permissions.ts:334-343`). The one exception is `funds:kinds_manage`, which Admin, Finance and Approvers all hold.
- **Environment variables** (`.env`) are checked only at start-up (`lib/env/check.ts:22-131`, called from `instrumentation.ts:6-9`). A change to one needs a restart or redeploy, and is not audited.

### A.2 Settings that exist

| Setting | Stored | Default | Edit permission (holders) | UI | Audit | Validated | Live | Evidence | vs v2 |
|---|---|---|---|---|---|---|---|---|---|
| TAT targets (`TatRule`) | table | P3_ASSIGN 2, P4_ACCEPT 0, Notary 3, PPSR 5, Mortgage 10, P5_ACCEPT 2, P6_VAULTED 3 | `settings:tat` (Admin) | ✓ | ✓ | zod 0–365 | ✓ | `schema.prisma:560-571`; `seed.ts:76-94` | ⚠️ Per transaction type, counted from release. v2 counts per user/stage, accept → forward |
| Holidays (`HolidayCalendar`) | table | 13 PH holidays for 2026 | `settings:holidays` (Admin) | ✓ | ✓ | zod date | ✓ | `schema.prisma:597-607`; `seed.ts:140-145` | ✅ No roll-over to 2027 |
| Weekend days | **hardcoded** Sat + Sun | — | — | ✗ | — | — | — | `lib/time.ts:48-51` | 🟡 v2 §9.1 wants weekends configurable |
| PN # format (`pn.format`) | key/value | GD + 3 + 4 + "9" + 5 digits | `settings:pn_format` (Admin) | ✓ | ✓ | hand-written, no zod | ✓ | `lib/settings.ts:58`; `app/actions/pn.ts:10-19` | ✅ |
| Checklist per transaction type (`ChecklistRule`) | table | seeded for 4 types | `settings:checklist` (Admin) | ✓ | ✓ | zod | new loan files only | `seed.ts:176-187` | ✅ The v2 sample lists and the 4 optional types are not seeded |
| Transaction types | table | NOTARY, EDST, PPSR, MORTGAGE | `settings:transaction_types` | ✓ | ✓ | zod | ✓ | `seed.ts:26-31` | 🟡 No auto / optional / unavailable matrix (v2 §4.5) |
| Document types, Loan types | tables | seeded; New / Renewal | `settings:document_types`, `settings:loan_types` | ✓ | ✓ | zod | ✓ | `admin.ts:166-170, 182` | ✅ The rules engine ignores the LoanType table |
| LTO offices (`LtoOffice`) | table | 6 offices | `settings:lto` | ✓ | ✓ | zod | ✓ | `schema.prisma:536-557`; `seed.ts:101-108` | 🟡 Has `distanceKm`, but no km per branch and no rate per km |
| DP processing stages (`ProcessingStage`) | table | from `DEFAULT_OWN_STAGES` | `stages:manage` | ✓ | ✓ | zod | jobs not yet started | `admin.ts:214-230` | 🟡 Loan-file stages are hardcoded (v2 §9.1 wants add / remove / reorder) |
| Return, hold, problem and missing-paper reasons | tables | `seed.ts:117-138` | `settings:*_reasons`, `holds:manage` | ✓ | ✓ | zod | ✓ | `admin.ts:202-212` | ✅ |
| Fund types (`FundsType`) | table | CA, FT | `fundtypes:manage` | ✓ | ✓ | zod | ✓ | `admin.ts:206-209` | 🟡 No "Finance user assigned to each" |
| Expense kinds | table | seeded + OTHER | `funds:kinds_manage` (Admin, Finance, Approvers) | ✓ | ✓ | zod | ✓ | `lib/services/expense-kinds.ts:43-120` | ⚠️ No fee table per type, rate per km or meals (v2 §9.4) |
| Cash-advance rules (`CashAdvanceRule`) | table | Notary 1500/5000, PPSR 1000/3000, Mortgage 2500/8000 | `settings:cash_advance` | ✓ | ✓ | zod | ✓ | `seed.ts:110-114` | ⚠️ Suggested / max amounts, not the v2 formula |
| Approval bands | table | one band from ₱0 per type | `settings:cash_advance` | ✓ | ✓ | zod | ✓ | `seed.ts:208-212` | ⚠️ v2 has no approval bands |
| `funds.liquidationDueDays` | key/value | **10** business days from **release** | `settings:cash_advance` | ✓ | ✓ | zod 1–90 | new releases only | `lib/settings.ts:46`; `funds.ts:405` | ⚠️ v2: **2** working days after **LTO** |
| `funds.carryOverLimitDays` | key/value | 3 | same | ✓ | ✓ | zod 0–60 | ✓ | `lib/settings.ts:44` | ➕ Not in v2 |
| `funds.blockLtoUntilFunded` | key/value | true | same | ✓ | ✓ | bool | ✓ | `lib/settings.ts:48` | ✅ Matches §5.7 |
| `dp.defaultCapacity` and per-DP capacity / leave | key/value + User columns | 10 | `dpcapacity:manage` | ✓ | ✓ | zod | ✓ | `lib/settings.ts:50`; `schema.prisma:197-202` | ➕ Not in v2 |
| myloans sync (`backgroundMinutes` 60, `tierMinutes` A 60 / B 240 / C 1440, `hourlyCeiling` 600, `maxPerRun` 50, `businessHoursOnly`, `refreshOnOpenMinutes` 60, `refreshOnFindHours` 4, `replacementWindowDays` 30, `paused`) | key/value | as listed | `myloans:manage` (Admin) | ✓ | ✓ | zod (`source-sync.ts:988-1000`) | ✓ (tier change waits for each loan's next check) | `lib/settings.ts:17-36` | ⚠️ No single "check interval". No 30–60 min warning. No "monitored fields" setting. See C.2 |
| `myloans.slowMs` | key/value | 2000 ms | **no write path** | ✗ | — | — | read per run | `lib/settings.ts:34` | — |
| Branch sync time (`branches.sync`) | key/value | 02:00 daily | `branches:import` | ✓ | ✓ | regex | ✓ | `lib/settings.ts:63` | 🟡 Live adapter cannot list branches yet (C.8) |
| Email on/off, events, templates | key/value | off / all events / code defaults | `email:manage` | ✓ | ✓ | zod | ✓ | `lib/email/outbox.ts:215-273` | 🟡 No "when / who / channel" alert rules (v2 §9.1) |
| Role permissions (`Role.permissions`) | table | `ROLE_DEFAULTS` | `roles:manage` (Admin) | ✓ | ✓ | zod + lock-out | ✓ (next request) | `permissions.ts:407-433`; `lib/services/roles.ts` | See B.2 |
| Retention (`RetentionRule`) | table | 10 years per document type | **none** | ✗ | — | — | **nothing reads it** | `schema.prisma:1139-1146`; `seed.ts:170-173` | 🟡 |
| `CashAdvanceRule.liquidationDays` | column | 5 | **none** | ✗ | — | — | **nothing reads it** | `schema.prisma:586-587` | dead column |
| Env: `APP_ENV`, `TEST_MODE`, `AUTH_MODE`, `MYLOANS_*` (timeout 8000 ms), `SESSION_SECRET`, `CRON_SECRET`, `GRAPH_*`, `STORAGE_*` | `.env` | `.env.example:15-83` | hosting | ✗ | ✗ | at boot | **restart** | `lib/env/check.ts:22-131` | — |

### A.3 Hardcoded business values that should be settings

Each item you asked about:

| Item asked about | Where / value | Verdict |
|---|---|---|
| TAT per stage / role | `TatRule` table. Fallbacks only in `lib/workflow/tat.ts:36-69` | Already a setting, but the wrong model (B.5) |
| Liquidation due days | **Three conflicting sources:**<br>• setting `funds.liquidationDueDays` = 10 (`lib/settings.ts:46`)<br>• TAT row `P4_LIQUIDATE` = 5 (`seed.ts:91`)<br>• unused column `CashAdvanceRule.liquidationDays` = 5 (`schema.prisma:587`) | ⚠️ Merge into one setting. v2 default: 2 working days after LTO |
| Working days | Weekend hardcoded Sat + Sun (`lib/time.ts:48-51`). **The myloans sync treats Saturday as a working day** (`lib/services/source-sync.ts:767-776`, Mon–Sat 07:00–19:00) | ❌ Needs a setting, and one calendar for both |
| Holidays | `HolidayCalendar` table | ✅ |
| Fund formula rates (km rate, meals, document fees) | **Not found anywhere.** `LtoOffice.distanceKm` and `suggestedTransportCents` are shown for information only | ❌ Missing (v2 §5.6, §9.4) |
| Approval limits | No hardcoded amount. Bands are in the database; ₱5,000 appears only in the test kit (`lib/kit/clean.ts:66`) | ⚠️ v2 has no bands |
| myloans interval | No single setting. Tiers 60 / 240 / 1440 min; runs at most every 60 min; business hours hardcoded Mon–Sat 07:00–19:00 (`source-sync.ts:767-776`) | ❌ Replace with one interval setting (decision 5) |
| Retention years | `RetentionRule` = 10, seeded, no UI, no reader | 🟡 |
| File size / type limits | 5 MB; PNG / JPG / PDF / WEBP (`lib/storage/receipts.ts:16, 33-41`; `app/actions/jobs.ts:331`; `lib/services/job-stages.ts:136-138`) | Could be a setting. Code-level is acceptable |
| Notification rules | Recipients and urgency per event are in code (`lib/email/templates.ts:6-63`). Reminder timings (1 business day) in `lib/email/reminders.ts:26, 47, 75` | ❌ v2 alert rules (when / who / channel) missing |
| LTO offices | Table ✅ | Templates disagree (see E) |
| Loan types | Table ✅ but **ignored by the rules**: "New" / "Renewal" are hardcoded (`lib/rules/index.ts:71-73`) | Correct per v2 (must match myloans) |
| Checklists per loan type | Per **transaction** type (`ChecklistRule`), in the database | ✅ v2 also uses transaction type |

Other hardcoded business values found:

| Value | Where | Should it be a setting? |
|---|---|---|
| Mortgage thresholds ₱500,000 / ₱1,000,000 | `lib/rules/index.ts:25-28` (Settings help even says "fixed", `admin/settings/page.tsx:67`) | Yes. v2 §4.5 says the result lists are editable seed data |
| Transactions per result (Mortgage → 4, else 2) | `lib/rules/index.ts:200-202` | Yes: the v2 availability matrix |
| User email must end in `@gdfi.ph` | `lib/services/admin.ts:42` | Yes, or an environment value |
| Session length 10 h | `lib/auth/session.ts:10` | Optional |
| Sync resilience (2 retries, breaker after 5 failures, 60 s) | `lib/myloans/resilience.ts:84` | No |
| "Available" DP threshold 40% | `lib/monitoring/rules.ts:18-26` | Optional (feature not in v2) |

### A.4 Verdict on A

| Requirement | Status |
|---|---|
| Settings stored in the database and applied without a redeploy | ✅ Matches v2 (except environment variables, which is correct for secrets) |
| Setting changes audit-logged | ✅ |
| Setting changes validated | ✅ |
| Settings editable by Admin **and Superadmin** | ⚠️ No Superadmin role. Admin only |
| v2 §9 settings list complete | 🟡 Partial. Missing:<br>• fee table, rate per km, meals, Finance user per fund type<br>• one myloans interval and monitored fields<br>• weekend calendar, alert rules, delivery modes / couriers<br>• deficiency types and demerit points (later module)<br>• archive / QR settings (later module) |
| Setting keys `Category.Name` (v2 §12.1, e.g. `Sync.IntervalMinutes`) | ⚠️ Keys are `lowercase.camel` (e.g. `myloans.backgroundMinutes`) |

---

## B. 3.1 Access and Security

### B.1 Roles: today vs the 10 decided roles

Defaults are in `lib/auth/permissions.ts:407-433`.

| Decided role | Today | Can sign in today? | Status |
|---|---|---|---|
| Superadmin | **none**; Admin is the top role | — | ❌ Missing |
| Admin | `ADMIN`: users, roles, Settings, audit, override. **Read-only on loans and locked out of work steps** (`permissions.ts:334-343`) | yes | ⚠️ v2 Admin also reassigns / cancels, decides disputes and resolves fund mismatches |
| LA | `LA` | yes | ✅ |
| LA Supervisor/Head | `SUP` "Branch Supervisor":<br>• moves holds, resolves any problem, Monitoring, TAT report, `myloans:review_borrower`<br>• **no LA work permissions**<br>• **not `myloans:review`** (Admin has that) | yes | ⚠️ Decided: all LA permissions plus Open Item approval |
| DP | `DP` | **no** (`canSignIn:false`; signs in only as a test user in TEST_MODE) | ⚠️ |
| Finance | `FIN`: CA and FT together, plus approve | **no** | ⚠️ v2 needs CA user ≠ FT user (see E, Q3) |
| Custodian | `VAULT`: view only, no actions | **no** | 🟡 Placeholder |
| QA | `QA`: view only | **no** | 🟡 Placeholder |
| Digicur | `DIG`: view only | **no** | 🟡 Placeholder |
| Archiver | **none** (`APPR` "Approvers, Records, Compliance" is the nearest) | — | ❌ Missing |
| (extra) | `APPR` Approvers; `MONITOR` Operations Monitor | APPR no / MONITOR yes | ➕ Not in the 10 (see E, Q4) |

**`canSignIn` cannot be changed in any screen.**
- `ROLE_SCHEMA` has no such field (`lib/services/roles.ts:27-34`).
- Custom roles are always created with `canSignIn:false` (`roles.ts:97, 151`).
- The seed re-applies `canSignIn` on every run (`prisma/seed.ts:155`).

So once test sign-in is off, DP, Finance, Custodian, QA and Digicur users **could not sign in at all** (`lib/auth/access.ts:29-33`).

### B.2 Permission storage and the matrix screen

| Decision 3 requirement | Today | Status |
|---|---|---|
| Matrix of roles × permissions with tickboxes | Settings → "Roles and access": one role at a time, with a tick per key. The CSV download is the only all-roles view (`app/api/settings/roles-matrix/route.ts:9`; `lib/services/roles.ts:235-249`) | 🟡 No grid screen |
| Seeded with v2 defaults | Seeded with the **current** defaults (88 keys). These differ from v2 §7 | ⚠️ |
| Only Superadmin edits | `roles:manage`, held by Admin | ⚠️ |
| Enforced on the server, read from the database, no hardcoded role checks | ✅ Every check is `can(user, key)` against `Role.permissions`, re-read each request (`lib/auth/current-user.ts:15-31`). A scan test forbids role-name checks (`lib/auth/permission-scan.ts:1-27`). The only `ownerRole === "LA"` checks are on the transaction type's data field, not the user (`lib/services/jobs.ts:505`) | ✅ |
| Cannot remove own access | ✅ `roles:manage` cannot be removed from your own role (`lib/services/roles.ts:55-60`) or from yourself (`lib/services/admin.ts:64-67`); you cannot deactivate yourself (`lib/services/settings-status.ts:87`) | ✅ |
| Last Superadmin keeps "manage permissions" | ✅ in principle: `roles:manage` and `access:manage` must stay with at least one active role held by at least one active person (`lib/services/lockout.ts:13, 59-75`). It is tied to the key, not a "Superadmin" role | ✅ (re-point to the new key) |
| All changes audit-logged | ✅ The audit records the permissions added and removed (`lib/services/roles.ts:100-105, 129-135, 173-178`) | ✅ |
| Cache | None; the database is read on every request (React per-request `cache()` only) | ✅ (a cache is optional) |

### B.3 Actual permission matrix today (default roles × keys)

There are 88 keys (`lib/auth/permissions.ts:10-118`). They are grouped here; the tick shows the default holder.

| Area / keys | LA | ADMIN | DP | FIN | VAULT | DIG | QA | APPR | MON | SUP |
|---|---|---|---|---|---|---|---|---|---|---|
| See loans `loans:view` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | ✓ |
| Find PN `loans:search` | ✓ | ✓ | | | | | | | | ✓ |
| Open a loan file `loans:open` | ✓ | | | | | | | | | |
| Checklist, missing papers, add / complete transactions, send to DP, funds flag, accept returns (`checklist:tick`, `papers:*`, `transactions:*`, `processing:send`, `funds:flag`, `processing:accept_returns`) | ✓ | (`papers:receive_late` only) | | | | | | | | |
| Problems raise / resolve own; holds raise / resume | ✓ | | ✓ | | | | | | | |
| Resolve any problem / move holds | | ✓ | | | | | | | | ✓ |
| DP work (`processing:receive`, `jobs:work`, `jobs:pasuyo`, `jobs:return_to_la`, `funds:request`, `funds:liquidate`) | | | ✓ | | | | | | | |
| Finance CA / FT view, approve, release, settle, edit lines, change type, print (14 keys), `funds:exception` | | (view / print) | | ✓ | | | | | | |
| Expense kinds manage | | ✓ | | ✓ | | | | ✓ | | |
| Rule override `rules:override` | | ✓ | | | | | | | | |
| myloans review (material / status / replacement) `myloans:review` | | ✓ | | | | | | | | |
| myloans borrower review `myloans:review_borrower` | | ✓ | | ✓ | | | | | | ✓ |
| myloans settings / run now | | ✓ | | | | | | | | |
| Refresh from myloans `loans:refresh` | ✓ | ✓ | ✓ | | ✓ | ✓ | ✓ | | | ✓ |
| Monitoring DP / LTO; LTO advisories | | ✓ | (create) | | | | | | ✓ | ✓ (monitor) |
| TAT report | | ✓ | | | | | | | | ✓ |
| Users, roles, branch access, branches, all Settings (≈30 keys), email, audit, simulator, test kit | | ✓ | | | | | | | | |

### B.4 Server-side checks on every surface

I listed every page under `app/(app)`, every server action in `app/actions/*.ts` and `app/login/actions.ts`, and every route under `app/api`. Each has a server check.
- `proxy.ts` only checks the session cookie. Signed-out users are sent to `/login`, and `/api/*` answers 401 (`proxy.ts:11-26`).
- Each page or action then checks the permission key itself (`requirePermission`, `requirePageAny`, `can`).
- Data is limited to the user's branches through `loanScope` / `inScope`: an out-of-branch loan file returns 404 (`lib/services/queries.ts:42-46, 154`).

**No surface relies on a client-side check alone.** The surfaces with no permission check are intentional:

| Surface | Why it has no check |
|---|---|
| `/` and `/loans/[pn]/journey` | Redirect only; they read no data (`app/page.tsx:4`; `app/(app)/loans/[pn]/journey/page.tsx:4-7`) |
| `GET /api/health` | By design; returns health information only |
| `/login`, `testSignIn` | Before sign-in |
| `markNotificationsReadAction`, `myEmailPreferenceAction` | Act on the user's own rows only |
| `/api/cron/*` | Protected by a shared secret, compared timing-safe (`lib/email/cron-auth.ts:4-13`) |

**Scope gaps found** (the permission is checked, but not the branch or fund-type limit):

| # | Gap | Evidence | Status |
|---|---|---|---|
| G1 | `GET /api/receipts/[id]`: any user with funds-view can open a receipt from **any branch** by its id | `app/api/receipts/[id]/route.ts:11-16`; `lib/funds/access.ts:42-45` | ⚠️ |
| G2 | Finance Home counts are not limited by branch or fund type (the /funds page itself is) | `components/funds/finance-home.tsx:21-25` | ⚠️ |
| G3 | The allow-list comment says the test provider "refuses outside test mode". It refuses only outside `AUTH_MODE=test`, not when `TEST_MODE` is off | `lib/auth/permission-scan.ts:24`; `lib/auth/providers.ts:23-27` | ⚠️ |

### B.5 Accept / Forward and server timestamps

**Every step stamps server time** (`new Date()` in the service). `AuditLog.at` defaults to database `now()` (`schema.prisma:1243`), and no action takes a timestamp from the browser (`app/actions/jobs.ts:55-110`). ✅

The only typed dates are business facts, not action times:
- attempt date, with future dates refused (`lib/services/jobs.ts:448`);
- Mortgage drop-off and pick-up dates;
- date a late paper was received;
- receipt and return dates.

| Hand-off | Accept? | Forward / send? | Server time | Audit | Movement record | Status |
|---|---|---|---|---|---|---|
| LA opens and checks the loan | **no accept**: the LA never "receives" anything | Send to DP (`lib/services/workflow.ts:521-633`) | ✓ `:583-596` | `assigned_to_dp` | `DISPATCHED_TO_DP` | 🟡 |
| DP | Accept / Decline / Return (`lib/services/jobs.ts:76-152`) | Forward to receiving LA (`jobs.ts:342-364`) | ✓ | ✓ `dp_assignment_*`, `package_forwarded` | ✓ | ✅ (per transaction) |
| Finance | Approve (`lib/services/funds.ts:305`) and Release (`:389`) | — | ✓ | ✓ | n/a | ⚠️ v2: accept + release, no approval step |
| DP after release | **no receipt confirmation** | — | — | — | — | ❌ (Fund Received / Mismatch) |
| Receiving LA | Receive: Complete / Incomplete (`jobs.ts:377-418`) | **No transmittal to vault** | ✓ | ✓ | ✓ | 🟡 |
| Custodian, QA, Digicur, Archiver | **No server actions exist.** The vault steps exist only in the test simulator (`lib/services/simulator.ts:212-236`) | — | — | — | — | ❌ |
| Return to previous user with remarks | Only DP → LA (decline / return with reason and 5–500 character remarks) | — | ✓ | ✓ | ✓ | 🟡 |
| One current holder per document | `DocumentItem.custodian` plus `DocumentMovement` (`lib/services/custody.ts:20-35`) | — | ✓ | — | ✓ | 🟡 No single holder per transaction; no generic engine |

### B.6 Pending inbox and "days remaining before TAT"

| Role | Inbox today | Days remaining shown? | Status |
|---|---|---|---|
| LA | Home "Do these next" (`app/(app)/dashboard/page.tsx:44-61`; `lib/ui/loan-cards.ts:24-49`) | Yes: "N days left", "Due today", "Late by N days" | ⚠️ **Per branch, not per person.** Every LA in a branch sees the same list, selected by loan stage (`loan-cards.ts:27`). Nothing to "accept" |
| DP | Own jobs (`components/jobs/dp-home.tsx:15-58`) | "Day N of M", "+N late"; **no "days remaining"** wording | 🟡 Per person ✅ |
| Finance | Counts only (`components/funds/finance-home.tsx:17-34`) | No | 🟡 |
| Admin, SUP, VAULT, DIG, QA, APPR | **The same LA home**, showing LA work they cannot do | — | ⚠️ |
| Custodian, QA, Digicur, Archiver as workers | none | — | ❌ |

### B.7 TAT calculation: today vs v2

| | Today | v2 (§2.2, §5.3, glossary) |
|---|---|---|
| Start | LA step: **loan release** (Day 2 rule, `lib/workflow/tat.ts:26-70`). Other steps: when the transaction entered its status (`statusSince`, `tat.ts:96-104`) | When **the user accepts** |
| Stop | When the status changes | When **the user forwards** |
| Unit | Business days (Mon–Fri, no holidays) ✅ | Working days ✅ |
| Keyed by | Transaction type and phase (`TatRule` P3_ASSIGN, P4_NOTARY …) | **Stage / role**, per user (`TransactionMovements.TatDaysUsed`, `IsLate`) |
| Stored per hand-off | No; computed live from `statusSince` | Yes (`TatDaysUsed`, `IsLate` per movement) |
| Pauses on hold | Never pauses (`docs/workflow/07-rules-and-roles.md:29`) | Chart 5: "TAT hold logged" (unclear, see E) |
| Late fund release blamed on Finance | No | Yes |
| Pasuyo hand-off | Clock does not restart | n/a |

**Verdict:** ⚠️ Built, but a different model. The DP clock happens to run from accept (`jobs.ts:80`) to forward (`jobs.ts:358`), but it is stored per transaction, not per user. Nothing records TAT used per hand-off.

### B.8 Sign-in

| Item | Today | Status |
|---|---|---|
| Default | `AUTH_MODE` unset means `test` (`lib/auth/providers.ts:16-18`) | ⚠️ |
| Test sign-in | **No password.** `/login` lists test users as "Continue as…" buttons (`app/login/page.tsx:25-46`) | OK for local only |
| Production with test sign-in | **Only a warning; the server still starts** (`lib/env/check.ts:128`). Anonymous visitors would see the buttons | ❌ Your rule: production must refuse |
| Real users created as test users | The Add-user form and users import set `isTestUser: true` (`lib/services/admin.ts:103`; `lib/import/importer.ts:743`). Side effect: they are never emailed outside test mode (`lib/email/outbox.ts:96`) | ❌ |
| Entra ID | Stub only: `entraProvider.resolveUser` (`providers.ts:34-55`). No route, no callback, no token check; the button is disabled (`app/login/page.tsx:64-73`) | ❌ |
| Session | Signed cookie, 10 h, `SESSION_SECRET` ≥ 32 characters (`lib/auth/session.ts`). User re-read every request, so deactivation is immediate | ✅ No revocation, no rate limit |

**What Entra ID needs:**
1. An app registration (tenant ID, client ID, secret, redirect URI) from IT.
2. An authorization-code flow with state and nonce: a login route and a callback route.
3. ID-token validation against the tenant keys (issuer, audience, tenant).
4. A call to `entraProvider.resolveUser(oid, email)`, then a session with `provider: "entra"`.
5. `ENTRA_*` checks in `lib/env/check.ts`.
6. `canSignIn` replaced by a permission in the matrix (or by "active user with an active role").
7. Optionally, an Entra security group as an allow-list.

---

## C. 3.2 myloans integration

### C.1 No direct database access: ✅ Confirmed

| Check | Result |
|---|---|
| SQL Server drivers, a second Prisma datasource, `MYLOANS_DB` or connection strings | None (`prisma/schema.prisma:8-11` has one Postgres datasource) |
| Only transport | HTTPS `fetch` (`lib/myloans/http-adapter.ts:18-35`) |
| `docs/myloans/released-loans-source.sql` | The myloans team's reference query, headed "REFERENCE ONLY. NEVER EXECUTED BY THE DMS" (lines 1-9). No code reads `.sql` files |

### C.2 updated_at per PN, scheduled check, interval

| v2 / decision | Today | Status |
|---|---|---|
| Save myloans updated_at per PN | `Loan.sourceUpdatedAt` (`schema.prisma:659`). Written on open (`lib/myloans/account.ts:33`) and on refresh (`source-sync.ts:173`). **Never compared** (`docs/myloans/field-map.md:39`). A background check with an unchanged hash does not update it (`source-sync.ts:821-828, 914`) | ⚠️ |
| Check at a set interval | External cron only: `POST /api/cron/myloans-sync` (`app/api/cron/myloans-sync/route.ts:12-23`) or `npm run myloans:sync`. Nothing runs inside the app (`docs/myloans/scheduling.md:7`) | 🟡 A scheduler is needed in every environment |
| One interval setting, default 30 min, warn below 30 / above 60, applies without restart, audited | **No single setting.** There are three separate clocks: `backgroundMinutes` 60, `tierMinutes` A 60 / B 240 / C 1440, and the external cron cadence. No warning. Live: ✓. Audited: ✓ | ❌ |
| API only | ✓ | ✅ |
| Only open transactions are checked | Tiers stop at Closed / Archived / Disposed / Cancelled (`lib/myloans/tiers.ts:12`) | ✅ (with the new closure statuses, see E) |
| API 2 "changed since" with checkpoint | Live mode: `changedSince: false` (`lib/myloans/live-mapping.ts:18`). Only the mock has a feed | ❌ Polls each PN (API 1 style) |
| API 3 freshness | None | ❌ |
| OAuth client credentials | API key (`MYLOANS_API_KEY`) | ⚠️ |

### C.3 Timestamp + ContentHash

| v2 | Today | Status |
|---|---|---|
| myloans supplies ContentHash (SHA-256 of the monitored fields) | The **DMS** computes it: the first 32 hex characters of SHA-256 over 28 tracked keys (`lib/myloans/changes.ts:116-118`) | ⚠️ |
| Pull full data only if the timestamp is newer **and** the hash differs | The full record is **always** fetched (`http-adapter.ts:41-50`). The hash only lets a background run skip the write (`source-sync.ts:914, 934`). No timestamp gate. Open, Refresh and Find skip the hash and compare field by field (`changes.ts:129-142`) | ⚠️ |
| Same hash + newer timestamp: save the timestamp only | Not done: the timestamp is not saved in that case | ❌ |
| Hash formula fixed before go-live and documented | Not documented. `field-map.md` lists field classes but not the hash fields or algorithm | ❌ |

The 28 fields in today's hash (`lib/myloans/changes.ts:11-45`):

| Group | Fields |
|---|---|
| Borrower | `borrowerName`, `address`, `contactNo` |
| Vehicle | `plateNo`, `engineNo`, `chassisNo`, `make` (always empty in live mode, `live-mapping.ts:86`) |
| Identity | `cin`, `cif` |
| Loan | `status`, `loanType`, `productName`, `amount`, `releaseDate`, `branchName`, `branchCode`, `previousPn`, `sourceLoanId`, `productCode` |
| Organisation | `areaId`, `areaName`, `divisionId`, `divisionName`, `companyId`, `companyName` |
| Status details | `statusId`, `statusName`, `isActive` |

Not hashed: `sourceUpdatedAt`, `paymentRecorded`, the raw payload.

**v2 monitored fields (API 1 list) that the DMS does not read or store:**
- `BirthDate` (deliberately not read, for privacy)
- `BorrowerCompanyName`
- `IsSelectable`, `IsSuperseded`
- name parts

### C.4 Open Items and the current auto-apply

**Field classes today** (`lib/myloans/changes.ts:50-79`):

| Class | Fields | Handling today | Reviewer | v2 / decision 4 |
|---|---|---|---|---|
| MINOR | plate, engine, chassis, make; area, division, company (id + name) | **Applied automatically** to the Loan (`source-sync.ts:193-207`, audit `source_minor_updated`). Vehicle fields have no Loan columns, so they are only audited | none | ⚠️ Must become Open Items |
| BORROWER | name, address, contact, CIN, CIF | Review (`lib/services/borrower-review.ts:73-113`) | `myloans:review_borrower`: Admin, **Finance**, SUP, branch-scoped, with Admin as fallback | ⚠️ |
| MATERIAL | loan type, product name / code, amount, release date, branch, source loan id | Review (`source-sync.ts:280-318`) | `myloans:review`: **Admin** | ⚠️ |
| STATUS | status, statusId / name, isActive | Review with extra outcomes: close as cancelled, ask for cash back | Admin | ⚠️ |
| REPLACEMENT | previousPn | Review: link replacement, move cash | Admin | ⚠️ Not in v2 |

**Open Item record vs v2 `OpenItems`:**

| v2 needs | Today (`SourceChange`, `schema.prisma:765-791`) | Status |
|---|---|---|
| One row per field | **One row per loan.** Changes are in a JSON array `{field, label, kind, was, now}` (line 773). At most one open non-borrower item plus one open borrower item per loan (`source-sync.ts:281`; `borrower-review.ts:76`) | ⚠️ |
| Old value (DMS) / new value (myloans) | `was` / `now` ✓. While pending, `was` stays the first value seen | ✅ |
| myloans timestamp per change | **Not stored.** Only `firstSeenAt` / `detectedAt` (DMS times); the borrower `at` is also DMS time (`borrower-review.ts:85, 90`) | ❌ |
| `OI-YYYY-######` number | none | ❌ |
| Status PENDING / APPROVED / REJECTED (+ Superseded, chart 9b) | `state` (open / applied / kept / closed …); a newer change **updates in place** and pushes the old version to `history` (`source-sync.ts:285-296`) | 🟡 |
| DMS data unchanged until approved | ✓ for BORROWER / MATERIAL / STATUS / REPLACEMENT; ✗ for MINOR | ⚠️ |
| Approve / reject with required remarks | Note of 5–500 characters required (`source-sync.ts:332-338`; `borrower-review.ts:207-212`) | ✅ |
| Approval by LA Supervisor/Head only | Admin (material, status, replacement); Admin, Finance or SUP (borrower) | ⚠️ |
| Approval screen | **No dedicated screen.** Pop-ups on the loan file (`?review=1`, `?correction=1`, `app/(app)/loans/[pn]/page.tsx:154-155`) plus a dashboard card (`components/loan/source-changes-card.tsx`) | 🟡 |
| Decision, approver and date logged | `source_change_applied` / `_kept` / `_closed`, `borrower_details_corrected` / `_kept`; `decidedById` / `decidedAt` | ✅ |
| Notify the current holder and LA Supervisor/Head | Notifies reviewers by permission (`source-sync.ts:315`; `borrower-review.ts:109`) | 🟡 |
| Open Item blocks Stored / closure | No Stored or closure step exists | ❌ |

**What depends on auto-apply or the review classes (must change with decision 4):**

| Kind | Files |
|---|---|
| Unit tests | `lib/myloans/sync.test.ts:16-37`; `lib/myloans/account-details.test.ts:78-108`; `lib/myloans/load.test.ts` |
| Integration tests | `tests/integration/myloans-sync.test.ts` (minor 153-160, material 162-222, cancel 223, replacement 250-303, account items 331-370)<br>`tests/integration/sync-check.test.ts` (116-372, 540-571)<br>`tests/integration/sync-followups.test.ts` (86-156)<br>`tests/integration/myloans-load.test.ts` (183-205)<br>`tests/integration/pn-format.test.ts:97-104`, `production-guards.test.ts:63`, `kit.test.ts:225-230`, `related-loans.test.ts:12,52` |
| E2E tests | `tests/e2e/myloans-sync.spec.ts` (109, 150, 172-187); `tests/e2e/sync-check.spec.ts` (60-190); `tests/e2e/home-compact.spec.ts:61`; `tests/e2e/pn-branches.spec.ts:53-70` |
| Kit and seed | `lib/kit/build.ts:367-377` (simulated name / amount / cancel / replace / branch changes); simulator kinds including `area` (`source-sync.ts:1050, 1080-1082`); `prisma/seed.ts:222`; `docs/MANUAL-TEST-KIT*.md` |
| Docs | `docs/workflow/08-systems.md`, `docs/myloans/field-map.md`, `docs/workflow/12-permissions.md` |

### C.5 Smart PN # search and duplicates

Everything here is in `lookupPn`, `lib/services/loan-file.ts:109-185`.

| Step | Today | Status |
|---|---|---|
| 1. Validate the format first; invalid means myloans is not called | `pnOf` / `parsePn` (`:90-94, 111-112`) | ✅ |
| 2. Search the DMS; found means open it, no duplicate | `loan.findUnique({pn})` (`:117-124`). Typing suggestions search the DMS only (`find-local.ts:95-105`) | ✅ |
| 3. myloans only if valid and not in the DMS | ✓ Ceiling-limited client (`:131-144`) | ✅ |
| 4. Not found / not released: message, nothing created | Statuses 15–19 count as "not found"; other statuses show a status card without Open (`:146-156`) | ✅ |
| Only `IsSelectable = 1` (Released, active, not superseded) | Status 12 only (`lib/myloans/status.ts:13, 33-36`). `isActive` is read but does not block; no superseded check | 🟡 |
| Duplicate prevention by **database constraint** | `Loan.pn @unique` (`schema.prisma:623`; `Loan_pn_key` in the baseline). The create path catches `P2002` and opens the existing file (`loan-file.ts:363-369`) | ✅ |
| Duplicate transactions per loan | **No unique constraint** on `(loanId, typeId)` for `LoanTransaction` (`schema.prisma:793-826`); prevented in code only | ⚠️ (matters once optional transactions arrive) |
| One open Open Item per loan / field | Code-only, under `withLoanLock` | ⚠️ (needs a partial unique index) |
| PN # Search Log (invalid / not found / not released) | none | ❌ |

### C.6 When myloans is down, slow or returns bad data

| Concern | Today | Status |
|---|---|---|
| Timeout | 8 s (`MYLOANS_TIMEOUT_MS`, `lib/myloans/http-adapter.ts:20, 29`) | ✅ |
| Retries | 2, with backoff 300 ms × 2ⁿ; honours `Retry-After` up to 10 s (`lib/myloans/resilience.ts:84-108`) | ✅ |
| Circuit breaker | Opens after 5 failures for 60 s; shared in the database (`MyLoansBreaker`) | ✅ |
| Rate limit | Hourly ceiling 600 calls, shared and reserved atomically (`lib/myloans/client.ts:59-67, 99-107`); 60 s answer cache | ✅ |
| Adaptive load | Halves the per-run cap when myloans is slow or errors (`lib/myloans/tiers.ts:30-33`) | ✅ |
| Response validation | **No schema validation**; a hand-written mapper (`lib/myloans/live-mapping.ts:44-88`). Bad JSON is treated as not found | ⚠️ Add a zod schema per API |
| Bad data | The Data Check blocks opening a file (`loan-file.ts:157, 248`). During sync, a bad loan type or amount goes into the review and Apply is refused (`source-sync.ts:380`) | ✅ |
| What the user sees | "MyLoans is busy…" / "MyLoans did not answer…" (`loan-file.ts:137-143`); refresh failure marked on the loan (`source-sync.ts:152-160`) | ✅ |
| Sync log | Last 10 runs kept in a setting (`myloans.state`); each run audited. **No SyncLogs table or report** | 🟡 |
| Long lock | The whole run sits in one 30-minute database transaction to hold an advisory lock (`source-sync.ts:863-867`) | ⚠️ Risky with connection pooling |

### C.7 Actual delay vs "near real-time"

Live mode has no change feed, so each loan is polled by tier. On top of that, a run happens at most every 60 min, only Mon–Sat 07:00–19:00, at most 50 loans per run (about 600 per business day).

| Tier | Typical delay before the DMS sees a myloans change |
|---|---|
| A | about 1–2 h |
| B | about 4–5 h |
| C | about 24–25 h; up to about 2 days across a weekend |

When a person acts, the copy is refreshed sooner: on open (if older than 60 min), on Find (if older than 4 h), and always on the Refresh button.

**Verdict:** ❌ Not near real-time. With 30-minute polling of every open PN, the hourly ceiling (600 calls per hour) caps the number of open loans at about **300**. Above that, API 2 (changed-since) is needed. See question Q9.

### C.8 Branches and products (APIs 4 and 5)

| Item | Today | Status |
|---|---|---|
| Branch sync | `runBranchSync` / daily at `branches.sync.time` (`lib/services/branches.ts:476-540`). The **mock** adapter lists branches; the **live** adapter returns UNSUPPORTED (`lib/myloans/http-adapter.ts:68-75`). Real data comes from a file import plus Branch review | 🟡 |
| Products | **No Products table.** Product name and code are copied onto each Loan | ❌ |
| API numbering (API 1–5) | Not used in code; adapter methods are `getByPn`, `search`, `getChangedSince`, `listBranches` (`lib/myloans/types.ts:99-113`) | — |

---

## D. Flowchart alignment

See `FLOWCHART_ALIGNMENT.md`.

**Headline:** `DP.png`, `FUNDS and LTO Processing.png` and charts 5–6 on `LDMS-Process-Flowcharts.png` are an **older version** than the charts inside the v2 .docx.

---

## E. Summary

### E.1 Gap table (foundation scope only)

| # | Item | Status | Effort (rough) |
|---|---|---|---|
| 1 | Superadmin and Archiver roles; LA Supervisor/Head as LA + Open Item approval; Custodian / QA / Digicur able to sign in | ❌ / ⚠️ | S |
| 2 | Matrix screen (roles × permissions grid), Superadmin-only editing, v2 default ticks, `canSignIn` folded into the matrix | 🟡 | M |
| 3 | Production refuses test sign-in; real users not created as test users | ❌ | S |
| 4 | Entra ID sign-in | ❌ | M (needs IT) |
| 5 | Generic Accept / Forward / Return with one holder and a movement ledger (TAT used, late flag) | 🟡 (DP only) | L |
| 6 | Per-user pending inbox with days remaining | ⚠️ | M |
| 7 | TAT per user and stage, accept → forward; weekend setting; one calendar for sync and TAT | ⚠️ | M |
| 8 | One myloans interval setting (30 min, warn < 30 or > 60) | ❌ | S |
| 9 | Timestamp + hash gate; save the timestamp on a batch touch; documented hash fields | ⚠️ | M |
| 10 | Open Items per field, myloans timestamp, OI number, Superseded, no auto-apply, LA Supervisor/Head only | ⚠️ | L (plus test rewrite) |
| 11 | Open Items approval screen (list, filter, approve / reject with remarks) | 🟡 | M |
| 12 | SyncLogs table and PN Search Log | ❌ / 🟡 | S–M |
| 13 | Products table; branches through the mock API 4 / 5 | ❌ / 🟡 | M |
| 14 | Unique constraints: open Open Item per (loan, field); transaction per (loan, type) | ⚠️ | S |
| 15 | Response validation (zod) for myloans answers | ⚠️ | S |
| 16 | Receipts route branch scope; Finance Home scope | ⚠️ | S |
| 17 | Liquidation days: three sources → one | ⚠️ | S |
| 18 | Rule 4 exact decimals; reject "1,000" and "1e6" | ⚠️ | S |
| 19 | IsSelectable (active, not superseded) check | 🟡 | S (depends on API fields) |

### E.2 Questions you must answer

**Charts and scope**

1. **Which charts are authoritative:** the v2 .docx charts or the PNGs? They differ on Charts 5 and 6:
   - the PNGs have "Set schedule date; group PN #" and "Reschedule";
   - the .docx has Accept / Decline / Hold, Retry and a Finance "verify liquidation" step.

   I suggest the .docx. If you keep "set schedule date; group PN #", say what grouping means: a DP trip covering several PNs? one fund request per group?
2. **Accept / Forward scope now:** build the generic engine now, used by LA → DP → Finance → DP → LA? Custodian, QA, Digicur and Archiver would get their steps in their own modules. Or wire all nine roles now?

**Roles**

3. **Finance CA vs FT.** Your role list has one "Finance" role, but v2 says the CA user and the FT user cannot process each other's type. Which do you want?
   - (a) one Finance role plus a per-user "fund type" setting (v2 `Users.FundTypeCode`); or
   - (b) two roles, "Finance CA" and "Finance FT", making 11 roles.
4. **The extra roles today:** Operations Monitor (`MONITOR`), Approvers/Records/Compliance (`APPR`), and Branch Supervisor (`SUP`, which also covers Area Supervisor). Should they be removed, merged into the 10, or kept as extra custom roles?
   - If removed: is SUP replaced by LA Supervisor/Head (scoped to their branches / area)?
   - The approval bands and Approver roles depend on `APPR` (v2 has no approval step).
5. **Superadmin vs Admin:**
   - May the Superadmin also do work steps, or only manage?
   - Should Admin get "reassign / cancel transaction" now (v2 §5.3)? Today Admin is locked out of work steps.

**Open Items**

6. **LA Supervisor/Head scope:** approve Open Items only for loans in their own branches / area, or for all branches? If a branch has no Supervisor/Head, who approves: Admin, or nobody?
7. **Which fields raise Open Items.** Strict v2 says every differing field. Today's hash also covers area, division and company names, `previousPn` and status fields.
   - Should organisation renames raise Open Items on every open loan, or are those branch data from API 4 and not monitored?
   - v2 §9.2 wants "monitored fields" as a setting. Shall I add it, seeded with the API 1 list?
8. **Status changes** (cancelled / no longer Released, chart 9b G). Is that also an Open Item waiting for approval, with the loan file "On Hold" meanwhile? Or is cancellation applied at once?
9. **API 2 / API 3 availability.** The myloans live API today has no changed-since feed.
   - Until it exists, the 30-minute interval would mean polling every open PN through API 1. That is capped at about 300 open loans by the 600-calls-per-hour ceiling.
   - Can the myloans team give a date for API 2 / 3? Should the mock implement the full v2 API 1–5 contract so the switch-over is a configuration change?
10. **Who computes the ContentHash** until myloans supplies it? I suggest the DMS computes SHA-256 over the monitored fields, in the same documented form v2 asks myloans to use. When myloans starts sending it, there is a one-time re-baseline with no Open Items.
11. **Interval window.** Should the 30-minute check run 24/7, or only in office hours? If office hours, which days: Mon–Fri like TAT, or Mon–Sat like today's sync?

**TAT and inbox**

12. **LA TAT start.** The LA never "accepts" at Check documents (v2 C10). Start the LA clock at loan release (today), or when the LA opens the loan file?
13. **Holds.** Does an On Hold (DP) pause the TAT? Chart 5 says "TAT hold logged". Today the clock never pauses.
14. **LA inbox holder.** Who "holds" a loan file at Check documents: the LA who opened it (then a per-person inbox works), or the whole branch (today)?

**Closure**

15. **Closure statuses (decision 6).**
    - At which step is "Processing complete" set? I suggest after Digicur records the scan and the documents are in the vault.
    - Who sets "Loan closed/released": Admin manually, or from a myloans "fully paid" status? myloans has no such field in the v2 API list.

**Small items**

16. Rule 4 exact decimals (gap 18): fix now with the foundation, or with the LA module?
17. LTO-PASIG: three values exist:
    - 10 km, city "Iloilo City" (`gdfi-dms-template-lto-offices.csv`)
    - 50 km, Pasig (`… pasig.csv`)
    - 2 km (`gdfi-dms-lto-offices sample.csv`)

    Which is correct? For Step 2 I will seed it with distance blank and flagged, unless you tell me otherwise.

### E.3 Items that block the LA module

1. **Roles and permission matrix** (gaps 1–2): the LA module needs LA and LA Supervisor/Head as real roles, and the DP needs to be able to sign in.
2. **Sign-in hardening** (gap 3): needed before anyone else tests.
3. **Accept / Forward engine and holder** (gap 5) with **per-user TAT** (gap 7): the LA's "assign to DP" and "accept back from DP" are hand-offs in this engine. Building the LA screens first would mean building them twice.
4. **Per-user inbox** (gap 6): the LA's daily entry point.
5. **Open Items without auto-apply and the approval screen** (gaps 9–11): the LA Supervisor/Head is part of the LA module, and chart 9b's effects (cancel or add transactions) touch LA transactions.
6. **PN search details** (gaps 18–19 plus the Search Log): Rule 4 decimals and IsSelectable are part of opening a loan file.
7. **Decisions on Q1, Q3, Q4, Q6–Q8, Q12, Q14.** Everything else can follow in parallel.

Not blocking the LA module: Entra ID (gap 4; test sign-in is fine locally), Products sync, receipts scope, liquidation days.
