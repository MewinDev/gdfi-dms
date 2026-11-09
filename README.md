# GDFI DMS: Loan Document Management System

The Loan Document Management System (DMS) of **Global Dominion Financing, Inc.** tracks the physical and digital loan documents of every released loan, from release to the end of archival retention.

Built now: **Phase 1** (search PN and open the Loan File), **Phase 2** (automatic classification and transactions) and **Phase 3** (checklist, Document IDs and QR labels, EDST, cash-advance request, Assign to DP, notifications) for the **Loan Associate** and **Admin** test accounts. Phases 4 to 10 are modelled in the database and shown on each Loan File's **Journey** tab; an Admin-only **test simulator** pushes a loan through Phases 3.5 to 6 for demonstration.

Stack: Next.js 16 (App Router, TypeScript), Tailwind CSS 4, Prisma 6 + PostgreSQL 16, Zod, Vitest, Playwright.

---

## Workflow

How a released loan moves from MyLoans to the vault gate (glossary, diagrams, rules, status and open questions): [`docs/workflow/README.md`](docs/workflow/README.md).

## Run it (Windows, PowerShell, Docker Desktop)

Environment variables, load order, `APP_ENV` and the production checklist: [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md).

```powershell
Copy-Item .env.example .env      # local defaults; secrets go in .env.local (see docs/ENVIRONMENT.md)
npm install
npm run db:up                    # PostgreSQL 16 in Docker (service gdfi-dms-db)
npm run db:migrate               # applies prisma/migrations
npm run db:seed                  # reference data + test users
npm run db:create-test           # the automated tests' own database (gdfi_dms_test)
npm run kit:start                # optional: sample accounts and loans for testing by hand (docs/MANUAL-TEST-KIT.md)
npm run dev                      # http://localhost:3000 (Next picks the next free port if 3000 is busy)
```

If port 5432 is already used on your PC (for example a native PostgreSQL service), set `DB_HOST_PORT` in `.env` (e.g. `5434`) and use the same port in `DATABASE_URL` and `DIRECT_URL`.

| Script | What it does |
|---|---|
| `npm run db:up` / `db:down` | Start / stop the Docker database (data is kept in a named volume) |
| `npm run db:tools` | Also start Adminer on http://localhost:8081 (compose profile `tools`) |
| `npm run db:migrate` | `prisma migrate dev` (local development) |
| `npm run db:deploy` | `prisma migrate deploy` (Supabase / any shared database) |
| `npm run db:seed` | Reference data + test users (idempotent) |
| `npm run db:seed:reference` | Reference data only (never test users) |
| `npm run db:reset` | Drop and recreate the local database, then seed. **Destroys local data.** Refused unless the database name contains `test` or `ALLOW_DESTRUCTIVE=1` is set (see `docs/ENVIRONMENT.md`). |
| `npm run db:studio` | Prisma Studio |
| `npm run db:create-test` | Create (or bring up to date) `gdfi_dms_test`, the automated tests' database. Safe to run again. |
| `npm run kit:start`, `kit:reset`, `kit:backup -- <name>`, `kit:list`, `kit:restore -- <name>`, `kit:rebuild` | The Manual Test Kit on `gdfi_dms`: see [`docs/MANUAL-TEST-KIT.md`](docs/MANUAL-TEST-KIT.md) |
| `npm run test:kit-screens` | Screenshots of the kit (sign-in list, two sample loans, Settings > Test kit) against your own server; run `npm run kit:reset` after |
| `npm test` | Unit tests (rules, Data Check, stage, business days) |
| `npm run test:e2e` | Playwright happy path (see below) |
| `npm run typecheck`, `npm run lint` | TypeScript and ESLint |

### Testing by hand: the Manual Test Kit

`npm run kit:start` puts your own database (`gdfi_dms`) in a starting state with sample accounts (one per role, `@example.test`) and one sample loan per case; `npm run kit:reset` puts it back. The test sheet, with each PN, who signs in, what to do and what should happen, is [`docs/MANUAL-TEST-KIT.md`](docs/MANUAL-TEST-KIT.md) (also in the app: Settings > Test kit > Open the test sheet). It replaces the older notes below for testing by hand.

### Test accounts of the seed (Test sign-in panel on `/login`)

| Account | Role | Branches |
|---|---|---|
| `test.admin@gdfi.ph` | Admin (also holds the Supervisor override for now) | All |
| `test.la@gdfi.ph` | Loan Associate | Quezon City, Cebu |

Five Document Processors are seeded (no sign-in yet) so the LA can assign transactions: Rico Dela Cruz and Joy Navarro (Quezon City), Paolo Lim and Grace Tan (Cebu), Ben Ocampo (Davao).

### Mock MyLoans PNs

`GD1012026901001` to `GD1652026901011` and `GD1012026999999` behave exactly as listed in the build prompt, section 9. Release dates are relative to today (0 to 3 business days ago) so the TAT badges can be seen. In **Settings > System and test mode** an Admin can:

- simulate **MyLoans unavailable**;
- turn on the **test-mode simulator** (shown on each Loan File's Journey tab);
- change the amount MyLoans returns for a PN, to demonstrate the **source-change flag** on refresh.

### Test mode (`TEST_MODE=true`)

Never set in live. When on:

- **Sample loans.** Home and Find a loan show three sample cards: GD1012026901001, GD1652026901003 and GD1652026901004. Pressing a card only fills the PN box; the tester still presses Find loan, and nothing is saved until Open loan file. Each card shows "Opened" once a loan file exists, and "Try it" before that. All the other mock PNs still work when typed, but are not listed.
- **Settings > Test data.**
  - **Show data-check test PNs** (default off) lists the refusal and edge-case PNs as a second group on Find a loan.
  - Starting over is **Settings > Test kit** (the Manual Test Kit), on a local test setup with `gdfi_dms` only.
- **Seed.** The seed never creates loan files. After `npm run db:reset`, Home shows the empty state.

### Tests

```powershell
npm run db:create-test           # once, and after every new migration
npm test                         # unit + integration, on gdfi_dms_test
npm run test:e2e                 # Playwright at 1440, 820 and 390 px; starts its own next dev on port 3100 with gdfi_dms_test
# Your own gdfi_dms is never used by a test run (see docs/ENVIRONMENT.md, "Two local databases").
```

The integration tests (`tests/integration`) and the Playwright helpers (`tests/e2e/db.ts`) only run against the test database on `localhost`. They **remove all loan files** there before each test. Each test then opens its own loan file. Playwright also adds a Davao fixture, `GD3902026909007`, to check that an LA gets 404 for another branch's file.

---

## Switch the MyLoans adapter

`lib/myloans` has one interface (`MyLoansAdapter.getLoanByPn`) and two implementations:

| `MYLOANS_MODE` | Adapter | Notes |
|---|---|---|
| `mock` (default) | `MockMyLoansAdapter` | Section 9 data, plus the Settings toggles above |
| `live` | `HttpMyLoansAdapter` | Reads `MYLOANS_BASE_URL`, `MYLOANS_API_KEY`, `MYLOANS_TIMEOUT_MS`. **TODO:** confirm the endpoint and map the real response in `lib/myloans/http-adapter.ts` (`endpointFor`, `mapResponse`) |

There is no sync and no import job: the MyLoans API is called only when an LA searches a PN, opens a Loan File, or clicks **Refresh from MyLoans**.

## Switch authentication

`AUTH_MODE=test` shows the Test sign-in panel. Pages only call `getCurrentUser()` / `requirePermission()` (`lib/auth/current-user.ts`); identity providers live in `lib/auth/providers.ts`. To enable Microsoft Entra ID, implement the OIDC flow in `entraProvider` (TODO marked), set `AUTH_MODE=entra` and the `ENTRA_*` variables. The session cookie, roles, branches and permission checks do not change.

## Move to Supabase (live)

The same Prisma schema and migrations run unchanged: the app uses only standard PostgreSQL, no Supabase Auth, RLS, SDK or Edge Functions. SSL is controlled only by the connection string.

1. Create the Supabase project (region close to the users).
2. Put the two connection strings in the app host's Environment Variables screen, never in a file (see `docs/ENVIRONMENT.md`):
   - `DATABASE_URL` = pooled connection, port **6543**, with `?pgbouncer=true&connection_limit=1&sslmode=require`
   - `DIRECT_URL` = direct connection, port **5432**, `?sslmode=require` (used by migrations)
3. `npx prisma migrate deploy` (or `npm run db:deploy`).
4. `npm run db:seed:reference` - branches, transaction types, checklist items, TATs, LTO offices, holidays. **Never seed test users in live.**
5. Switch sign-in from test to Microsoft Entra ID (`AUTH_MODE=entra`) and create real users.
6. Set `MYLOANS_MODE=live` once the MyLoans mapping is done; implement the Supabase Storage driver in `lib/storage` (TODO) and set `STORAGE_DRIVER`.

---

## How it is organised

| Path | What |
|---|---|
| `lib/rules` | Rules 1 to 4 (pure, unit-tested) |
| `lib/myloans` | Adapter interface, mock and HTTP adapters, Data Check (pure, tested) |
| `lib/workflow` | Stage derivation, TAT, 10-phase journey (pure) |
| `lib/services` | Server-side workflow: open Loan File, refresh, checklist, EDST, cash advance, Assign to DP, exceptions, override, simulator, admin |
| `lib/auth` | Session cookie, providers, permissions |
| `app/(app)` | Pages: dashboard, loans, Loan File, search, notifications, admin |
| `prisma` | Schema, migrations, seed |

Every write runs in one database transaction that locks the Loan row (`SELECT ... FOR UPDATE`) and writes its audit row in the same transaction. Permissions are checked on the server in every action; out-of-branch Loan Files return 404.

---

## UI guide

The Loan Associate screens follow the approved redesign (mockups in `gdfi-dms-design`). Principles: one screen, one job; plain words; cards for daily work; one solid brand-coloured button per screen (the main action; secondary actions are outline or text); 44px+ touch targets; 15px+ body text.

### Colour rule: the soft status palette

Every pill, status card and highlighted row uses a **soft** colour: a very light background, a dark text colour and a thin border. No full or strong backgrounds: no filled navy pills (Sent, Processing, On hold, Open now), no large blocks of solid colour. Colour is never the only signal: each pill has an icon and a word. Red is for Problem only. Text meets WCAG AA (4.5:1) on every soft background; `lib/ui/design-tokens.test.ts` checks the tokens, and `tests/e2e/on-hold.spec.ts` measures the rendered pills in the browser.

| Status | Tokens (`app/globals.css`) | Background / text | Contrast (text, secondary text) |
|---|---|---|---|
| On hold | `--hold-bg` `--hold-fg` `--hold-line` (+ `--hold-stripe`, the left edge of a held card) | `#FFF8E8` / `#774300` | 7.67, 5.82 |
| Missing paper, needs you | `--missing-*` (`--act-*`) | `#FFF8E8` / `#774300` | 7.67, 5.82 |
| Problem | `--problem-*` (`--bad-*`) | `#FDF1EF` / `#A8261D` | 6.42, 5.70 |
| Sent, Processing, waiting on others | `--sent-*` (`--wait-*`) | `#EFF3F8` / `#2B4366` | 8.99, 5.65 |
| Done, Ready to send | `--done-*` (`--ok-*`) | `#EDF7F1` / `#1C6B42` | 5.93, 5.70 |
| Neutral, not started | `--neutral-*` (`--mute-*`) | `#F3F5F7` / `#3C4857` | 8.51, 5.71 |

A held card is white with a thin light border and a soft amber stripe on the left (`.hold-card`). The selected transaction ("Open now") has a very light tint and a thin left accent, not a strong fill. The sidebar, the phone top bar, toasts and the selected state of a choice (a ticked box, a picked processor) keep the brand navy: they are not status colours.

### Tokens (`app/globals.css`, the only place colors are defined)

| Token | Use |
|---|---|
| `--navy` `--gold` `--cream` `--sand` `--border` `--hover` `--ink` `--ink-2` `--white` | Brand set |
| The soft status palette above | Every status pill, card and highlighted row |
| `--act-*`, `--wait-*`, `--ok-*`, `--bad-*`, `--mute-*` (`-bg`, `-fg`, `-line`) | The component names, mapped onto the soft palette |
| `--highlight-border`, `--done-row-bg`, `--done-row-border`, `--box-border`, `--wait-bar` | Small tints (highlight card border, ticked row, empty checkbox, "Waiting" tile bar) |

Component classes: `.btn-gold` (the one main action), `.btn-navy`, `.btn-ghost`, `.btn-sm` (44px), `.btn-lg` (52px), `.card` (16px radius), `.card-hl`, `.hold-card`, `.chip` + `.c-act/.c-hold/.c-wait/.c-ok/.c-bad/.c-mute` (`.c-navy` is kept as an alias of the soft blue-grey), `.tag`, `.tab`, `.input` (48px), `.page-title`. The old names `.btn-primary/.btn-accent/.btn-secondary` map to navy/gold/ghost for the Admin screens. The sign-in screen uses frozen `.login-*` classes so it looks exactly as before.

### Shared components

| Component | File | Notes |
|---|---|---|
| `AppShell` | `components/ui/app-shell.tsx` | Sidebar (1024px+), 88px icon rail (640-1023px), top header + bottom tab bar (below 640px). `/` focuses Find a loan. |
| `FindLoan` | `components/ui/find-loan.tsx` | PN (also CIN, CIF, label code) search box, `id="find-loan"` |
| `LoanCard` | `components/ui/loan-card.tsx` | Home and My loans cards; whole card is the link |
| `Stepper` | `components/ui/stepper.tsx` | 5-step progress; segmented bar with "Step N of 5" on phones |
| `Avatar`, `ToneChip`, `Banner` | `components/ui/basics.tsx` | |
| `Sheet` | `components/ui/sheet.tsx` | Native `<dialog>`: centered card, bottom sheet on phones, or side panel (`side`) |
| `WorkCard` (checklist rows, send block, EDST) | `components/loan/work.tsx` | Checklist saves automatically ("Saved just now"); send asks for confirmation |
| `ReportProblem`, `FixProblem` | `components/loan/work.tsx` | Report a problem sheet; Mark problem as fixed |
| Plain words | `lib/ui/plain.ts` | Stage words, deadline chips, history sentences, update sentences, message rewording (unit-tested) |
| `HoldSummary` | `components/jobs/hold-summary.tsx` | The one hold summary (reason, remarks as typed, who and when in PHT, how to continue, Resume). Words in `lib/ui/holds.ts` (unit-tested) |

### Breakpoints

| Width | Layout |
|---|---|
| 1024px and up (`lg`) | 248px sidebar, content max 1100px, main column + 300px side column |
| 640-1023px (`sm`) | 88px icon rail, one column, side cards below |
| below 640px | Top header + bottom tab bar, 16px side padding, full-width buttons, pinned Send button on the checklist screen |

Full-height shells use `100dvh`. Checked with no horizontal scroll at 1440, 1280, 1024, 820, 390 and 320px.

### What differs from the mockups

- The mockups show "Deed of Sale (proof of sale)" inline; the app shows a small "Proof of sale: pick at least one" line above the one-of group (as the redesign brief asks), so both one-of items are listed.
- Each ticked paper shows its label code (Document ID) as a small caption, which the mockup rows do not have.
- The LTO office field appears in the send block for Mortgage only (it is required there); the mockup shows Notary, which does not need it.
- "Who should do it" is a standard dropdown with the Recommended chip drawn inside it, not a custom list.
- The Find a loan placeholder is the short "Type the PN number" on Home and My loans (one text fits every width); the Find a loan page uses the longer example text.
- The sidebar shows a sign-out button next to the user; on phones, sign out is at the bottom of Updates. The mockups do not show sign out.
- Phases 4 to 10 have no LA screens yet, so "Check the returned package" and "Send the papers to the vault" show the step without a button.
- Admin keeps a Journey tab (with the test simulator) on the Loan File; the LA sees three tabs and can open the full 10-phase view from More loan details.
- The tablet Home mockup labels the rail item "Loans"; the phone tab bar says "My loans", as in the phone mockup.

---

## Assumptions

1. **Ports on this PC.** A native PostgreSQL already listens on 5432 and 5433, and another app uses 3000, so this PC's `.env` uses `DB_HOST_PORT=5434` and the dev server ran on 3001. The compose file defaults to 5432. The compose project is named `gdfi-loan-dms` so it never collides with the existing `gdfi-dms` compose project and its `gdfi-dms-db` container at `C:\dev\gdfi-dms` (left untouched).
2. **Prisma 6, not 7.** Prisma 7 no longer accepts `url`/`directUrl` in `schema.prisma`, which section 10 requires, so Prisma is pinned to 6.x.
3. **Next.js Cache Components is off.** Every page depends on the signed-in user.
4. **Stage is derived, then cached.** `Loan.stage` is recomputed from the transactions, cash advances and documents inside every write (never typed in) and cached for list filters. Lists hold at most 500 rows per query for now.
5. **Mortgage thresholds are fixed by Rule 4** (New PHP 500,000; Renewal PHP 1,000,000, inclusive). Loan types in Settings only change the display name.
6. **Loan File fields keep the values used for the automatic decisions.** A refresh stores a new snapshot, updates `Retrieved at`, records field differences, and raises a **Source change** exception (LA and Supervisor notified, in-app and email outbox) only when the automatic result would change or the record fails the Data Check. Transactions are never changed by a refresh; a Supervisor override is the way to apply a change.
7. **Checklist completeness** = every active Required item ticked and at least one item ticked in each One-of group. "Others" items are free text, present when added, and get a Document ID with type code `OTH`.
8. **Document IDs** are generated when an item is first ticked; un-ticking keeps the ID (never reused) and moves the item back to Expected. Sequence is per PN and document type (`GD1012026901001-ORCR-01`, `-02`, ...).
9. **Custody hand-over at Assign to DP:** labelled items become In Transit with the LA still accountable until the DP acknowledges (simulated "DP accepts").
10. **Legal Docs Completion** is raised by the LA ("Request missing documents") and closes automatically when that checklist becomes complete.
11. **Fund status** options: No funds needed, For funding, Funded (needs a released cash advance). Cash-advance limits come from Settings > Cash-advance rules.
12. **LTO office** is required when assigning a Mortgage transaction and optional for Notary and For Entry PPSR.
13. **Beyond-TAT reason** is required when today is after Day 2 (business days after release, weekends and the seeded 2026 holidays skipped).
14. **TAT badge** follows the current stage: Day 2 from release while the LA has the file, then the stage target measured from when the stage started.
15. **Email** is not sent yet: notifications are in-app; emails are written to the server log (email outbox) until Microsoft Graph is connected.
16. **Admin sees loans read-only** and cannot run LA steps (server-enforced). Admin can search MyLoans and see a preview, but only an LA can open a Loan File.
17. **Overrides** cannot remove a transaction that is already with a DP.
18. **Report a problem** (redesign) adds one server action, `reportProblemAction`, for "Wrong details" and "Something else". It follows the existing exception pattern (audited, Supervisor notified). "Missing paper" still uses the existing Legal Docs Completion action.
19. **Test users added in Users** are marked test users and can use the Test sign-in "Other test user" picker if their role can sign in.
20. **Retention** defaults to 10 years per document type (editable later; no screen yet).
21. Release dates in MyLoans are treated as dates in Asia/Manila.

## Open items

| # | Question | Built assumption |
|---|---|---|
| O-1 | Who handles **For Entry PPSR**, and do PPSR and Mortgage wait for Notary to finish? | C&M handles it through a DP assignment; each transaction runs independently |
| O-2 | Processing rules that differ between Undertaking and Non-Undertaking | Separate classifications, no different requirements |
| O-3 | ~~Which MyLoans fields hold the Undertaking flag and ORCR status?~~ **Closed** | The LA picks both on the preview card |
| O-4 | Product Name with only part of a word, such as "Auto Finance" | Not a match; defaults to Refinancing |
| O-5 | Who may override an automatic result? | Supervisor only (Admin account for now), with a reason, audited |
| O-6 | TATs, approval matrix, escalation days, retention periods | Proposed values seeded; TATs and holidays editable in Settings |
| - | Real MyLoans endpoint and field mapping | `HttpMyLoansAdapter` TODO |
| - | Microsoft Entra ID sign-in, Graph email, Supabase Storage | TODOs in `lib/auth/providers.ts`, `lib/notify.ts`, `lib/storage` |
