# GDFI-DMS: Continue or Rebuild? Analysis Report

Date: 16 November 2026 (PHT)
Scope: `C:\Users\GD - MERIN\gdfi-dms`, branch `feature/stage-map-and-compact-ui`, commit `8fc835e`. This was a read-only analysis; the only file written is this report.

> **Note on the folder.** The request names a folder called "Loan Document Management System v2". No folder with that name exists. This report covers the project the request was run from, `gdfi-dms`. Older copies sit next to it (`Loans-Document-Ageing-DMS`, `-rc2` to `-rc3.5`, `-review-candidate`, `gdfi-dms-backup`) and a design pack is in `Downloads\gdfi-dms-design-v2`. Those were **not** assessed (see Open Questions).

---

## 1. Executive Summary

- **Recommendation: CONTINUE with the current system. Do not rebuild.** It is modern (released within the last few months), well organized and heavily tested. About 77 workflow items are built, and its data model already fits how GDFI handles loan papers.
- Rebuilding would take roughly **4–6 months** to get back to where the system is today. Making the current system ready to go live is about **3–5 weeks** of focused work.
- **One blocker for go-live:** real sign-in does not exist yet. Today anyone who can reach the login page can sign in as any user, including Admin, with one click and no password. Microsoft (Entra ID) sign-in is planned but not built. **It must be built before the system goes on any shared server.**
- The second big gap is **data privacy (RA 10173)**: there is no record of who viewed borrower files, no retention or disposal process, and no privacy notice. All of these can be added to the current system.
- **Important business question:** today the system tracks the **physical papers** (who has them, what is missing, where they are). It does **not** store scanned copies of loan documents. If management expects a digital archive of scans, that is a new module, but it can be added on top of the current design.
- The automated checks run cleanly: no type errors, no lint errors, and all 1,054 unit and integration tests pass.

---

## 2. Inventory

### 2.1 Folder structure
(node_modules, .next, .git, test-results excluded)

```
gdfi-dms/
├── app/                      Next.js pages, server actions, API routes (48 files, ~7.8k lines)
│   ├── (app)/                signed-in screens: dashboard, loans/[pn], loans/[pn]/journey, jobs/[id],
│   │                         funds, funds/[number]/print, my-funds, monitoring, receive, reports/tat,
│   │                         search, notifications, admin/{users,settings,audit,test-kit}
│   ├── actions/              10 "use server" action files (loan, jobs, funds, admin, branches, kit, email…)
│   ├── api/                  health, cron/{myloans-sync,email-reminders}, loans/suggest, receipts/[id],
│   │                         stage-files/[id]/[field], settings/{csv,emails,roles-matrix,branches-template}
│   └── login/                test sign-in page and actions
├── components/               React UI (98 files, ~13.1k lines): loan, jobs, funds, admin, monitoring, home, ui
├── lib/                      domain and service layer (212 files, ~28.3k lines, incl. ~60 unit tests)
│   ├── services/             business logic (workflow, funds, holds, papers, custody, source-sync, monitoring…)
│   ├── auth/ roles/ rules/ workflow/ stages/ pn/ branches/ funds/ myloans/ email/ import/ storage/
│   ├── env/ db/ docs/ kit/ test-data/ ui/ monitoring/ jobs/
├── prisma/                   schema.prisma (66 models, 38 enums), seed.ts, 1 baseline migration
├── tests/                    integration (39), e2e (56 Playwright files), e2e-kit, stubs (~19.1k lines)
├── scripts/                  migrate-check, db-create-test, kit, email, myloans-sync, e2e-groups…
├── docs/                     workflow/ (14 md), db/, myloans/, manual test kit, 543 screenshots
├── storage/                  (git-ignored) receipts/ (86 PDFs/images), kit/ (DB dumps, backups)
├── public/
└── config files              package.json, next.config.ts, proxy.ts, instrumentation.ts, tsconfig.json,
                              prisma.config.ts, vitest.config.mts, playwright*.config.ts, eslint.config.mjs,
                              docker-compose.yml, .env.example, .gitignore, .gitattributes
```

### 2.2 Classification

| Category | Contents |
|---|---|
| **(a) Application source** | `app/`, `components/`, `lib/`, `proxy.ts`, `instrumentation.ts`, `scripts/`, `tests/` |
| **(b) Database / schema** | `prisma/schema.prisma`, `prisma/migrations/20261119090014_baseline/migration.sql` (2,100 lines, including hand-written SQL), `prisma/seed.ts`, `docs/db/*.md`, `docs/myloans/released-loans-source.sql` |
| **(c) Config / deployment** | `package.json`, `next.config.ts`, `prisma.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `vitest.config.mts`, `playwright.config.ts`, `playwright.kit.config.ts`, `docker-compose.yml` (local Postgres only), `.env.example`, `.gitignore`. Untracked: `.env`, `.env.local`. **No Dockerfile, CI pipeline or hosting config.** |
| **(d) Business documents** | Markdown only: `docs/workflow/01–13` plus README (glossary, big picture, LA / DP / Funds procedures, exceptions, rules and roles, systems, status and open questions, processing stages, monitoring, permissions, stage map), `docs/myloans/field-map.md` and `scheduling.md`, `docs/MANUAL-TEST-KIT*.md`, `README.md` (assumptions and open items), `storage/kit/myloans-branches.csv`. **No Word, Excel or PDF loan forms, templates or SOPs are in this folder.** The PDFs in `storage/receipts/` are uploaded test receipts, not reference documents. |

### 2.3 Technology stack

| Layer | Technology |
|---|---|
| Language | TypeScript 5.9 (strict; 0 `any`, 0 `eslint-disable`, 0 `@ts-ignore`) |
| Runtime | Node.js 24 (local v24.16) |
| Framework | Next.js 16.4.5 (App Router, Server Components, Server Actions, `proxy.ts`), React 19.3 |
| Styling | Tailwind CSS 4 |
| Database | PostgreSQL 16 (Docker locally; Supabase Postgres planned for production), Prisma ORM 6.19, `pg_trgm` for search |
| Validation | Zod 4 |
| Authentication | Own JWT session cookie (`jose`, HS256, 10 h). Login is **test sign-in only**; Microsoft Entra ID is a TODO (`lib/auth/providers.ts:33-57`) |
| Authorization | Permission ticks per role (about 90 ticks), plus branch / area / division access per user |
| File storage | Local disk `storage/receipts` (UUID file names). The Supabase Storage driver is a TODO (`lib/storage/index.ts:48`) |
| Email | Microsoft Graph Mail.Send through an outbox table; switched off by default |
| Integration | MyLoans API (mock and live adapters), with tiered sync, rate limit and circuit breaker |
| Scheduling | External cron calls `POST /api/cron/*` with a shared secret |
| Testing | Vitest 5 (unit and integration against `gdfi_dms_test`), Playwright 1.65 (e2e at 3 screen sizes) |
| Run / deploy | `npm run dev` locally; production is `next build && next start` against Supabase (documented in README; no deployment scripts) |

---

## 3. Requirements from Documents

Source: `docs/workflow/*`, `docs/myloans/*`, `README.md`. No other business documents were available (see 2.2).

### 3.1 Summary

- **Document types**
  - Transaction types: Notary, EDST, Entry of PPSR, Mortgage, plus custom types.
  - Papers: Promissory Note, valid IDs, Deed of Sale group, OR/CR (annotated), PPSR Certificate, LTO receipt, Undertaking, Others.
  - Each paper gets a Document ID such as `GD1012026901001-ORCR-01`, never reused, and is marked Original or Copy.
  - Funds: Cash Advance (CA) and Fund Transfer (FT), with expense kinds and receipts.
  - Stage evidence files, such as the PPSR certificate.
  - Phase 2: transmittal, ARF, pull-out form, NTC/NTE/NOD notices.
- **Lifecycle**: a 10-step stepper.
  1. Loan opened
  2. Classified
  3. Check documents
  4. DP Processing
  5. LA Acceptance
  6. Collateral
  7. Quality Assurance
  8. Digital Records
  9. In Safekeeping
  10. Closure

  Terminal states are Cancelled, Archived and Disposed. The DP sub-stages are Notarization, PPSR registration, LTO drop-off, LTO pick-up, and Check and verify (`docs/workflow/10`, `13`).
- **Turnaround targets** (business days, editable; the clock never pauses) (`07`):

  | Clock | Target |
  |---|---|
  | LA check and send | Day 2 |
  | EDST | 1 |
  | DP accepts | Same day |
  | Notary | 3 |
  | PPSR | 5 |
  | Mortgage | 10 |
  | Receiving LA | 2 |
  | Vault transmittal | 3 |

  Funds rules: liquidation is due in 10 business days; carry-over is free for 3 business days.
- **Metadata**
  - The 15 MyLoans loan fields, plus borrower address and contact.
  - Snapshot of each MyLoans response.
  - Missing-paper reason and remarks (5–500 characters).
  - Hold, decline and return reasons.
  - Stage evidence (notary book, page and series; PPSR registration number; LTO OR number).
  - Funds lines and release references (FT: last 4 digits of the account only).
- **Approvals**
  - Funds approval bands by type and amount (the ₱5,000 split is a placeholder).
  - Finance exceptions.
  - MyLoans change reviews: Supervisor for borrower details, Admin for material, status and replacement changes.
  - Branch review and rule overrides (Admin).
  - Hold transfer (Supervisor or Admin).
  - Phase 2: pull-out approval.
- **Roles**: LA, DP, Finance, Approvers (Small, Large, Cash, Transfer), Admin, Branch / Area Supervisor, Operations Monitor, Vault, Digital Records, QA.
- **Retention**: "10 years per document type by default, no screen yet" (`README.md`, Assumption 20). Archive and Dispose are deferred. **No disposal procedure is documented.**
- **Reports**
  - Home per role, Loans table, Journey.
  - Monitoring (DP and LTO tabs, capacity).
  - TAT and problems report, liquidation print, audit log.
  - Email reminders and digest. CSV exports are switched off.
- **Privacy**: no treatment of RA 10173 (consent, data-subject rights, access logs, retention) anywhere in the docs.

### 3.2 Requirements list

| # | Requirement | Source |
|---|---|---|
| R1 | Find a loan by PN (DMS first, then MyLoans); accept only status 12 (Released); one file per PN | workflow/03, myloans/field-map |
| R2 | One PN format parser (GD + branch + year + 9 + 5 digits) | workflow/01, 08 |
| R3 | Store 15 MyLoans fields plus a snapshot of each response; Data Check blockers and warnings | myloans/field-map |
| R4 | Automatic rules create transactions (classification, Undertaking, OR/CR, Mortgage thresholds) | workflow/07 |
| R5 | Paper checklist per transaction (required, pick-one, optional, others) | workflow/03 |
| R6 | Document ID per paper, never reused; Original/Copy; custody trail | README, workflow/03 |
| R7 | Missing papers: reason and remarks, immutable history, received-late date; vault gate "complete with exceptions" | workflow/03, 09 |
| R8 | LA Send readiness check; pull back before DP accepts | workflow/03 |
| R9 | DP accept, decline or return to the specific LA; rounds; papers handed back and confirmed | workflow/04, 06 |
| R10 | DP stages in order with system times and required evidence; Check and verify before forward | workflow/10 |
| R11 | Forward to the receiving LA; Complete, Incomplete or Other | workflow/04 |
| R12 | Holds (owner lock, transfer), Problems (own timer), Pasuyo | workflow/01, 06 |
| R13 | TAT targets in business days, holidays, chips and overdue | workflow/07 |
| R14 | Funds: CA/FT request, approval bands, release by type, receipts, top-up, carry-over, return, liquidation, print | workflow/05 |
| R15 | Overdue advance blocks new requests unless Finance grants an exception | workflow/05 |
| R16 | Roles as permission ticks checked on the server; lock-out protection; Admin read-only on work steps | workflow/12 |
| R17 | Branch / area / division access per user; out-of-branch file returns 404 | workflow/07 |
| R18 | Journey (Story, By document, Full log), read-only | workflow/03 |
| R19 | Audit row for every write, in the same DB transaction; audit log screen | README, workflow/12 |
| R20 | MyLoans change classes and reviewers; replacement PN only suggested | workflow/08 |
| R21 | MyLoans sync: tiers, business hours, hourly ceiling, circuit breaker, pause switch | myloans/scheduling |
| R22 | Branch import from MyLoans, branch review; branches never deleted | workflow/08 |
| R23 | Email through Graph (master switch, test redirect, reminders, opt-out); in-app notifications | workflow/08, 12 |
| R24 | Monitoring: DP and LTO tabs, capacity and availability, LTO advisories | workflow/11 |
| R25 | TAT and problems report | workflow/12 |
| R26 | Settings-managed lists (reasons, LTO offices, holidays, types, checklist, stages, funds types, expense kinds) | workflow/12 |
| R27 | Production start-up guards; cron secret; health endpoint | ENVIRONMENT.md |
| R28 | Microsoft Entra ID sign-in (@gdfi.ph only) | README, ENVIRONMENT.md |
| R29 | Durable file storage (Supabase Storage) | README |
| R30 | Phase 2 stages: transmittal, vault, Collateral, QA, Digital Records, NTC/NTE/NOD, Pull out, Archiving, Warehousing | workflow/13 |
| R31 | Retention (10 years per document type) and disposal | README #20, workflow/13 |
| R32 | Privacy: out-of-branch lookups hide the borrower name; emails carry no borrower data; amounts gated | workflow/03, 09 |
| R33 | Privacy (RA 10173): read-access log, consent / notice, PII retention and disposal, data-subject requests | *not documented; legal requirement* |
| R34 | Accessibility: WCAG AA, 44 px targets, 1440 / 820 / 390 layouts | README |

---

## 4. Current System Assessment

### 4.1 Features vs. requirements: **Good** for phase 1, **Missing** for phase 2 and privacy

| Req | Status | Evidence |
|---|---|---|
| R1–R3 | ✅ Built | `lib/services/find-local.ts`, `lib/pn/`, `lib/myloans/`, `LoanSourceSnapshot` model |
| R4 | ✅ Built (thresholds hard-coded) | `lib/rules/index.ts:25-28` |
| R5–R7 | ✅ Built | `lib/services/papers.ts`, `custody.ts`, `ChecklistCheck` and `DocumentItem` models |
| R8–R11 | ✅ Built | `lib/services/workflow.ts`, `jobs.ts`, `job-stages.ts` |
| R10 evidence files | ⚠️ Partly built: stored, but **no link in the UI to open them** | `app/api/stage-files/...` has no caller in `app/` or `components/` |
| R12–R15 | ✅ Built | `holds.ts`, `funds.ts`, `lib/funds/` |
| R16–R18 | ✅ Built | `lib/auth/current-user.ts`, `lib/roles/`, `lib/workflow/build-journey.ts` |
| R19 | ✅ Built (writes only) | `lib/audit.ts:29` |
| R20–R22 | ✅ Built | `lib/services/source-sync.ts`, `branches.ts`, `borrower-review.ts` |
| R23 | ✅ Built (off by default) | `lib/email/` |
| R24–R25 | ✅ Built | `lib/services/monitoring.ts`, `app/(app)/reports/tat` |
| R26–R27 | ✅ Built | `app/(app)/admin/settings`, `lib/env/check.ts`, `lib/email/cron-auth.ts` |
| R28 Entra sign-in | ❌ **Missing (stub only)** | `lib/auth/providers.ts:33-57` |
| R29 Durable storage | ❌ Missing (local disk only) | `lib/storage/index.ts:48` |
| R30 Phase 2 stages | ❌ Missing (empty tables exist) | `Transmittal`, `DigitalRecord`, `PullOutRequest`, `QaFinding` models are unused |
| R31 Retention | ❌ Missing (`RetentionRule` and `DisposalBatch` unused) | `schema.prisma:1139-1158` |
| R32 | ✅ Built | `docs/workflow/09` (tested) |
| R33 RA 10173 | ❌ Missing | see 4.5 |
| R34 | ✅ Built (e2e at 3 viewports) | `playwright.config.ts` |

About **27 of 34 requirements are built**; 6 are missing and 1 is partly built. The missing ones are either planned for phase 2 or tied to going live.

### 4.2 Code quality and structure: **Good** (some Needs Work items)

**Strengths**
- The code has a clear layering: pages → `app/actions/*` (all wrapped in `runAction`, `lib/action.ts:8`) → `lib/services/*` → Prisma.
- Pure rules are separated and unit-tested (`lib/rules`, `lib/workflow/stage.ts`, `lib/myloans/tiers.ts`).
- Hygiene is very clean: zero `any`, zero lint suppressions, and only 3 TODOs, all deliberate.
- Naming is consistent, and a docs-consistency test keeps `docs/workflow` aligned with the code.

**Needs work**
- Some pages and components bypass the service layer:
  - 13 pages and 8 server components call Prisma directly.
  - `app/(app)/admin/settings/page.tsx` alone makes 34 Prisma calls.
- Several large files:
  - `lib/services/source-sync.ts` (1,119 lines)
  - `admin/settings/page.tsx` (983)
  - `loans/[pn]/page.tsx` (955)
  - `components/jobs/forms.tsx` (788)
- Duplication:
  - The two file-serving routes are nearly identical (`app/api/receipts/[id]` and `app/api/stage-files/...`).
  - File validation is repeated in `app/actions/jobs.ts:325-340` and `lib/services/job-stages.ts:137-143`.
  - There are two storage abstractions, and one of them (`lib/storage/index.ts`) is never imported.
- Hard-coded values:
  - Mortgage thresholds (₱500k / ₱1M) in `lib/rules/index.ts:25-28`.
  - The four transaction codes, used as literals 111 times.
  - `APP_BASE_URL` falls back to `localhost:3001` in `lib/email/outbox.ts:40`.
  - Test emails in `app/login/page.tsx:40-44`.
- 543 PNG screenshots (~77 MB) are committed to git under `docs/screenshots`.

### 4.3 Database design: **Good** (some Needs Work items)

- **Size and protection**
  - 66 models with clear relations, enums for statuses, row locking (`withLoanLock`) and audit in the same transaction.
  - The squashed migration baseline is protected by `npm run migrate:check`.
  - Hand-written SQL: trigram search indexes, partial unique index (one open hold), CHECK constraints.
- **Missing foreign-key indexes**
  - `CashAdvanceLine.advanceId` and `.transactionId`
  - `Receipt.lineId`
  - `DocumentItem.transactionId`
  - `Problem.loanId`
  - `LoanException.transactionId`
  - `Notification.loanId`
  - `AuditLog(entityType, entityId)`
  - `Loan.releasedAt` (used for sorting)

  This is fine at today's scale and cheap to add.
- **Conflicting cascades.** `DocumentMovement` and `PaperEvent` are documented as append-only, but they cascade-delete with the loan (`schema.prisma:909`).
- **Inconsistencies**
  - Money types: `Decimal` in `Loan.totalReleasedAmount` and `CashAdvanceRule`, but integer centavos in the funds tables.
  - Several codes are stored as strings where a foreign key would be expected (`DocumentItem.docTypeCode`, `Loan.loanType`, `Hold.reasonName`).
  - Several user-id columns have no FK.
  - 17 JSON columns.
- **Unused tables.** 9 "Phase 6–10" tables are present but unused. This is scaffolding, not harmful.
- **Verdict:** the data model **can support** every documented requirement, including phase 2. Nothing structural needs redesign.

### 4.4 Security

| Area | Rating | Detail |
|---|---|---|
| **Authentication** | 🔴 **Broken (for production)** | Test sign-in is the only login method and has no password (`app/login/actions.ts:15-24`). The default is test mode: `authMode()` returns `"test"` unless `AUTH_MODE=entra` (`lib/auth/providers.ts:16-18`). Production with test mode only **warns** (`lib/env/check.ts:125`). Users created through the Admin form or CSV import get `isTestUser: true` (`lib/services/admin.ts:103`, `lib/import/importer.ts:743`), so every real user can be signed in as. `/login` lists every account as a "Continue as…" button. There is no rate limiting, and a stolen token cannot be revoked during its 10-hour life. |
| Open redirect | 🟡 Needs Work | `safeNext` (`app/login/actions.ts:10-13`) blocks `//` but not `/\host` (not tested). |
| Role-based access | 🟢 **Good** | Every server action and API route checks permissions on the server (`requirePermission`, `lib/auth/current-user.ts`). Loans, jobs and files are branch-scoped (`loadTxnInScope`, `inScope`, `canSeeJob`). The user is re-read on every request, so deactivation takes effect immediately. No route without a check was found. |
| Passwords | N/A | No passwords are stored. The plan is to rely on Entra. |
| SQL injection | 🟢 Good | All raw SQL is parameterized. The two `*Unsafe` calls are built only from constants (`lib/services/feed-quality.ts:23`, and the local-only kit). |
| File uploads | 🟢 Good | File type is checked from the file's first bytes (PNG/JPEG/PDF/WEBP). Size limit 5 MB. Files get UUID names, keys are regex-checked, and paths are guarded against traversal. Every download is authorized, and responses set `nosniff`, a sandbox CSP and `no-store` (`lib/storage/receipts.ts`, `app/api/receipts/[id]/route.ts`). |
| Secrets | 🟢 Good | Only `.env.example` is tracked in git, and there is a secret-scan test. ⚠️ The untracked `.env.local` on this PC holds **live Microsoft Graph credentials**. Restrict the app to one sender mailbox, and rotate the secret if the PC is shared. |
| Cron endpoints | 🟢 Good | Shared secret with timing-safe comparison, at least 24 characters in production. |
| Audit trail | 🟡 Needs Work | Every write is audited in the same transaction. But the log is append-only only by convention (no DB trigger or revoked permissions), **reads are not logged**, and the log itself holds borrower data with no retention rule. |
| Security headers | 🟡 Needs Work | No HSTS, CSP, `frame-ancestors` or Referrer-Policy (`next.config.ts`). CSRF is handled by Next.js server-action origin checks plus a SameSite=Lax cookie. |

### 4.5 Data privacy (RA 10173): 🔴 **Missing**

| DPA expectation | Current state |
|---|---|
| Inventory of personal data | Stored data: borrower name, address, contact number, CIN, CIF, loan amount; **full raw MyLoans responses** in `LoanSourceSnapshot.payload` (possibly more than needed); receipts and evidence files; and borrower data inside audit JSON. |
| Access logs (who viewed what) | ❌ Not recorded. Only writes and sign-in/out are logged. |
| Retention and disposal | ❌ `RetentionRule` and `DisposalBatch` exist but nothing uses them. There is no purge for loans, snapshots, audit rows or files. |
| Consent and privacy notice | ❌ None in the app. Consent is probably collected at origination in MyLoans, which needs confirming. |
| Data-subject requests (access, correction, erasure) | ❌ No process or tooling. |
| Security of processing | ✅ Role and branch scoping, minimal data in emails, last 4 digits only for bank accounts, borrower name hidden for out-of-branch lookups. ❌ No encryption at rest at the app level; files sit plain on local disk. |
| Breach readiness | ❌ No error tracking or alerting, and no read logs to support an investigation. |

### 4.6 Document handling: 🟡 **Needs Work**

- **What a "document" is today.** It is a **physical paper**: checklist tick, Document ID, Original or Copy, custodian, location and movement history (`DocumentItem`, `DocumentMovement`). **No scanned file is attached to loan documents.**
- **Uploads that do exist.** Cash-advance receipts and DP stage evidence. Both are capped at 5 MB, file types are checked from file content, and files are stored on local disk.
- **Versioning.** None for files. A corrected receipt is a new row (`correctsId`). There are no checksums or size columns.
- **Search.**
  - Fields: Document ID, PN, CIN, CIF and borrower name, with trigram indexes (`lib/services/find-local.ts`).
  - There is no content search, because no scanned content is stored.
- **Preview.** Files open in a new browser tab; there is no in-app viewer. Stage evidence **cannot be opened from the UI at all**.
- **Storage and backups.**
  - Files are on local disk only, so they would be lost on serverless or multi-server hosting.
  - Orphan files are left if the database write fails (`app/actions/jobs.ts:335`).
  - There is no production backup plan for files. The test-kit backups (`storage/kit/`) cover the dev database only.

### 4.7 Dependencies: 🟢 **Good**

- All core frameworks are current and supported: Next 16.4.5 (latest 16.4.6), React 19.3, Node 24 LTS, Tailwind 4, Vitest 5, Playwright 1.65.
- Prisma 6.19 is one major version behind (7.x is out).
- `npm audit`:
  - 3 high-severity findings in the production dependency tree, all through `prisma` → `@prisma/config` → `deepmerge-ts`. These are CLI or build-time tools; the fix is the Prisma 7 upgrade.
  - 7 moderate findings in dev tools.
- TypeScript 7 and ESLint 10 are available. Neither is urgent.

### 4.8 Tests, error handling and logging

**Tests: 🟢 Good**
- 98 Vitest files (about 1,100 cases), including a 20,000-loan performance test.
- 54 Playwright specs, run at 3 screen sizes.
- Results from this review:
  - `tsc --noEmit`: **pass, 0 errors**.
  - `eslint`: **pass, 0 problems**.
  - `vitest run` (against `gdfi_dms_test`): **98 of 98 files and 1,054 of 1,054 tests passed** (377 s).
- `next build` was **not** run, because a dev server is running on port 3000 and the build would overwrite its `.next` folder. The running app's `/api/health` answers `{"ok":true,"database":"up"}`, and `/login` returns 200.
- Gaps: no CI, no component tests, no coverage report.

**Error handling: 🟢 Good**
- `runAction` maps known errors to friendly messages, and error boundaries exist.
- A few `catch` blocks swallow errors silently: the cron routes, `lib/email/outbox.ts`, `lib/myloans/client.ts:104`.

**Logging: 🟡 Needs Work**
- Only `console.error`. There is no structured logs, no request IDs and no error tracking such as Sentry.
- The error boundaries do not log the error digest.

### 4.9 Scalability and maintainability: 🟡 **Needs Work**

**Maintainability is high**
- The code and docs are clear and tests are extensive.
- New document types, checklist items, reasons and stages are configured in Settings.
- Adding a top-level loan **stage** means editing several files (`lib/workflow/stage.ts`, `stage-map.ts`, `lib/myloans/tiers.ts`). The rule engine only creates the four built-in transaction codes.

**Scalability issues**
- **The Loans list silently caps at 500 rows**: `take: 500` in `lib/services/queries.ts:183`. Paging and tab counts happen in memory, with 4–6 queries per page load.
- **Long sync transaction.** The MyLoans sync holds a database transaction open for up to 30 minutes just to keep an advisory lock (`lib/services/source-sync.ts:863-867`). This is risky with Supabase connection pooling.
- **In-process email.** Email sending uses an in-process `setTimeout`, which is unreliable on serverless. The cron route covers for it.

**Deployment: 🔴 Missing**
- No Dockerfile, CI or hosting configuration.
- Durable storage, Entra sign-in and an external scheduler are all still to do.

---

## 5. Possible Changes

### 5.1 Quick fixes (under a day each)

| # | What | Why | Files | Effort | Risk |
|---|---|---|---|---|---|
| Q1 | Make `AUTH_MODE=test` a start-up **error** in staging and production; default `authMode()` to deny | Stops an accidental open deployment | `lib/auth/providers.ts`, `lib/env/check.ts` | 1 h | Low |
| Q2 | Stop creating users with `isTestUser: true` | Real users must not be usable for test sign-in | `lib/services/admin.ts:103`, `lib/import/importer.ts:743` | 1 h | Low (check seed and tests) |
| Q3 | Harden `safeNext` (reject `\`, compare origin) | Open redirect | `app/login/actions.ts` | 30 min | Low |
| Q4 | Add security headers (HSTS, CSP, `frame-ancestors`, Referrer-Policy) | Clickjacking, transport security | `next.config.ts` | 2–4 h | Low–Med (CSP needs testing) |
| Q5 | Add a "View file" link for stage evidence | Uploaded evidence currently cannot be opened | `components/jobs/stages.tsx` | 2 h | Low |
| Q6 | Add the missing FK and sort indexes | Performance as data grows | new migration (per CLAUDE.md procedure) | 2–3 h | Low |
| Q7 | Log errors in error boundaries and silent catches | Diagnose production failures | `app/(app)/error.tsx`, cron routes, `lib/email/outbox.ts` | 2 h | Low |
| Q8 | Fix the `APP_BASE_URL` fallback and remove hard-coded test emails from `/login` | Wrong email links | `lib/email/outbox.ts:40`, `app/login/page.tsx` | 1 h | Low |
| Q9 | Remove the unused `lib/storage/index.ts`, or make it the single driver (see M3) | One storage path | `lib/storage/*` | 1 h | Low |
| Q10 | Restrict and rotate the Graph app secret | Live mail credential on a dev PC | Entra admin (not code) | 1 h | Low |

### 5.2 Medium changes (days to two weeks)

| # | What | Why | Files | Effort | Risk |
|---|---|---|---|---|---|
| M1 | **Implement Microsoft Entra ID sign-in** (OIDC code flow, @gdfi.ph only); remove the user list from `/login` | Go-live blocker | `lib/auth/providers.ts`, new `app/auth/callback` route, `app/login/*` | 3–5 days | Medium (needs Entra app registration) |
| M2 | Session revocation (per-user session version) and sign-in rate limiting | Kill stolen sessions | `lib/auth/session.ts`, `current-user.ts`, schema | 1–2 days | Low |
| M3 | **Durable file storage driver** (Supabase Storage or S3-compatible) with checksum and size; write the file after or inside the transaction; backfill existing files | Local disk is lost on hosting; orphan files | `lib/storage/*`, `app/actions/jobs.ts`, `lib/services/job-stages.ts`, file routes | 3–5 days | Medium |
| M4 | **Read-access logging** for loan file, journey, receipts and evidence views | RA 10173 accountability | `lib/audit.ts`, the loan / journey pages, file routes; possibly a separate `AccessLog` table | 2–3 days | Low (watch volume) |
| M5 | Make `AuditLog` append-only in the DB (trigger or REVOKE UPDATE/DELETE); stop `DocumentMovement` and `PaperEvent` cascading | Tamper-evidence, as documented | new migration | 1 day | Low |
| M6 | Database-side paging and counts for the Loans list (one grouped count query) | 500-row cap, query count | `lib/services/queries.ts`, `app/(app)/loans/page.tsx` | 2–3 days | Low–Med |
| M7 | Replace the 30-minute sync transaction with a session advisory lock or a lease row | Connection pooling on Supabase | `lib/services/source-sync.ts` | 1–2 days | Medium |
| M8 | **CI pipeline** (typecheck, lint, vitest, e2e groups) and a Dockerfile or hosting config | No automated gate | new `.github/workflows/*`, `Dockerfile` | 2–3 days | Low |
| M9 | Structured logging and error tracking (e.g. Sentry); a health check that also covers MyLoans, storage and the email backlog | Operations | `lib/`, `instrumentation.ts`, `lib/health.ts` | 2–3 days | Low |
| M10 | Move the Mortgage thresholds and other constants to Settings; move direct Prisma calls out of pages into services | Maintainability | `lib/rules/index.ts`, `admin/settings/page.tsx`, others | 3–5 days | Low–Med |
| M11 | Upgrade Prisma 6 → 7 | Clears the npm audit highs, keeps support | `package.json`, `prisma.config.ts`, generated client | 2–4 days | Medium (re-verify hand-written SQL and migrate:check) |
| M12 | Privacy notice page, data inventory and data-subject request runbook; trim `LoanSourceSnapshot.payload` to needed fields | RA 10173 | docs, `lib/services/source-sync.ts` | 3–5 days | Low |
| M13 | Move `docs/screenshots` out of git (Git LFS or artifact storage) | Repo size (~77 MB) | repo | 0.5–1 day | Low |

### 5.3 Major work (needs design, not a restructure of what exists)

| # | What | Why | Effort | Risk |
|---|---|---|---|---|
| X1 | **Digital document archive.** Scanned file(s) per `DocumentItem` with versioning, checksum, uploader, in-app preview and optional OCR search. Reuses the existing `DigitalRecord` / `Attachment` tables | Only if "DMS" must hold scans (Open Question 1) | 3–6 weeks | Medium |
| X2 | **Phase 2 stages**: transmittal, vault, Collateral, QA, Digital Records, NTC/NTE/NOD, Pull out with approvals and return periods, Archiving, Warehousing | Documented roadmap (`docs/workflow/13`) | 6–10 weeks | Medium (stage logic is hard-coded in 3–4 files) |
| X3 | **Retention and disposal engine** (per-document-type periods, legal hold, disposal batches with sign-off, purge of files, snapshots and audit PII) | RA 10173 and the documented 10-year rule | 2–3 weeks | Medium–High (irreversible deletes need careful approval flow) |
| X4 | Make loan-file stages data-driven (table instead of `STAGES` constants) | Easier phase 2 and future changes | 1–2 weeks | Medium |

---

## 6. Continue vs. Rebuild Comparison

| Factor | **Continue** (improve this system) | **Rebuild** (new DMS, reuse documents) | Hybrid (keep DB, rewrite app) |
|---|---|---|---|
| Time to production-ready | **~3–5 weeks** (Q1–Q10, M1–M9) | ~4–6 months to match the 77 built items, then the same go-live work | ~3–4 months |
| Time to phase 2 | +2–3 months | +2–3 months after the rebuild | similar to Rebuild |
| Cost (relative) | **1×** | ~4–6× | ~3–4× |
| Risk | **Low.** Changes are incremental and protected by ~1,100 unit/integration tests and 54 e2e specs | High. Must re-discover dozens of edge rules (holds, rounds, Pasuyo, funds bands, MyLoans change classes) already encoded and tested | High. The app layer *is* where the business rules live |
| Data migration | None (no production data yet) | None (no production data yet), but all seed and reference data must be rebuilt | None |
| What is reused | Everything | Docs in `docs/workflow`, perhaps the schema as a reference | Schema and migrations |
| Stack health | Current (Next 16, React 19, Node 24, Postgres 16) | Would likely pick the same stack | Same |
| Long-term maintainability | Good: typed, tested, documented, doc-consistency tests; some refactors recommended | Unknown; starts at zero tests | Unknown |
| Fixes the security gaps? | Yes. Auth is missing, not built wrong; RBAC is already sound | Yes, but same work | Yes, but same work |

**How the guidelines apply**

| Guideline | Finding |
|---|---|
| Stack outdated or unsupported? | **No** |
| Data model can't support the requirements? | **No.** It already includes tables for phase 2 and retention. |
| Security problems structural? | **No.** Authorization is solid. Authentication is an unfinished, isolated module (one provider stub). |
| Fixing costs more than 60–70% of a rewrite? | **No.** Estimated at about 10–15%. |

---

## 7. Recommendation & Roadmap

### Recommendation: **CONTINUE.**

Reasons:
1. The architecture and data model are sound and modern. Nothing calls for a rewrite.
2. The serious problems are a few clear, separate gaps: sign-in, durable storage, privacy controls and deployment. Each one can be fixed on its own.
3. The test suite is large, and the business rules in `docs/workflow` are captured in code and tested. That is the most expensive part of any rebuild, and it is already done.
4. There is no production data yet, so every fix is cheap now.

### Prioritized roadmap

**Phase A: Go-live hardening (weeks 1–5). Must finish before any shared or online deployment.**
1. Q1, Q2, Q3: lock down test sign-in (day 1).
2. M1: Entra ID sign-in, then M2: session revocation.
3. M3: durable file storage and a backup plan for both the database and files (agree RPO/RTO with IT).
4. Q4: security headers. M5: append-only audit. M4: read-access logging.
5. M8: CI. M9: logging and error tracking. Q7: error logging.
6. Q5, Q6, M6, M7: evidence link, indexes, Loans paging, sync lock.
7. Q10: rotate and restrict the Graph secret. Pen-test or security review of the staging deployment.

**Phase B: Compliance and clean-up (weeks 5–8)**
1. M12: privacy notice, data inventory, data-subject request runbook. Get DPO sign-off.
2. X3: retention and disposal engine (after the retention periods are confirmed).
3. M11: Prisma 7 upgrade.
4. M10: move constants to Settings and thin out the large pages.
5. M13: move screenshots out of git.

**Phase C: Feature expansion (months 3–5)**
1. X4: data-driven stages (makes X2 cheaper).
2. X2: Phase 2 stages (transmittal → vault → QA → Digital Records → pull out → archiving).
3. X1: digital document archive, if confirmed.

---

## 8. Open Questions for you

1. **Digital scans or physical tracking?** Today the DMS tracks *physical papers* and stores only receipts and stage evidence files. Must it also store **scanned copies of every loan document** (a digital archive)? This is the biggest scope decision (X1).
2. **Which folder did you mean?** The request says "Loan Document Management System v2". I assessed `gdfi-dms`. Should `Loans-Document-Ageing-DMS` (and its rc versions) or `Downloads\gdfi-dms-design-v2` also be compared? Are any of them meant to be the "v2"?
3. **Where are the business documents?** No Word, Excel or PDF loan forms, templates or SOPs are in this folder; requirements came from `docs/workflow/*.md`. If source forms or SOPs exist (for example the checklist forms, transmittal or ARF, pull-out form), please point me to them.
4. **Retention periods.** Is 10 years per document type correct (README Assumption 20)? Who approves disposal? Are legal holds needed?
5. **Privacy / DPO.** Who is GDFI's Data Protection Officer? Is borrower consent and the privacy notice handled at origination in MyLoans, so the DMS only needs to reference it? Is the DMS registered in the NPC processing-system inventory?
6. **Hosting.** Is production confirmed as Supabase (database and storage), or on-premise? This decides M3, the backup design and where cron runs.
7. **Microsoft Entra.** Is an Entra app registration available, and should sign-in be limited to a security group?
8. **Open business values** from `docs/workflow/09`: approval bands (the ₱5,000 split), carry-over days, FT limits, hold reasons, capacity thresholds. All are marked as placeholders.
9. **Team and timeline.** How many developers, and is there a target go-live date? The estimates above assume one experienced developer working full time.
