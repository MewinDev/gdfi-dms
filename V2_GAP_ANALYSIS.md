# DMS v2 Gap Analysis: v2 spec vs. the current gdfi-dms

Date: 16 November 2026 (PHT)
Codebase: `gdfi-dms`, branch `feature/stage-map-and-compact-ui`, commit `8fc835e`
This is an analysis only. No project files were changed except this report.

---

## 0. Sources read

| File | How it was read | Result |
|---|---|---|
| `Downloads\Loan Document Management System v2.docx` (main spec, v2.0, 16 Nov 2026) | Text, headings and all tables extracted with a stdlib-only Python reader (pandoc and python-docx are not installed). All 11 embedded images were extracted. | ✅ Read in full |
| `Documents\Loan Document Management System v2.htm` | Converted to text. Used for sections 13.3–14, which the .docx extractor missed. | ✅ Same content as the .docx: only list numbering differs |
| v2 images: Charts 1, 7, 8, 9, 9b and the ERD (Figure 1) | Viewed one by one | ✅ |
| v2 images: Charts 2–6 | Viewed through `LDMS-Process-Flowcharts.png` (all charts 1–9b on one sheet), `DP.png` (= Chart 5) and `FUNDS and LTO Processing.png` (= Chart 6) | ✅ |
| `BRD_MTLMS_and_MoD.docx` | Text, tables, 12 images (viewed) | ✅ |
| `BRD_MTLMS.docx` | Text, tables, 6 images | ✅ Same as Part A of the file above |
| `Business Requirements Document — Mortgage Transaction Lifecycle Monitoring Syste.docx` / `.pdf` | Text and tables. The PDF text was decoded by script: no PDF renderer is installed, so its pages could not be shown as images. | ✅ Same content as BRD_MTLMS. The PDF cover page did not decode cleanly, so that page was not compared word for word. |
| `Monitoring of Documents (Copy).md` | Read | ✅ A text capture of the MoD prototype screen |
| Templates | Read | ⚠️ **There are no `.xls` files.** What exists:<br>• `gdfi-dms-template-loan-types.xlsx` and its `.csv` copy<br>• `gdfi-dms-template-lto-offices.csv`, `… (1).csv`, `… pasig.csv`<br>• `gdfi-dms-template-document-types.csv` |
| Older versions `Loan Document Management System.docx` and `(1).docx` | Not read, as instructed | — |

**Nothing failed to open.** The only limitation is the PDF cover page noted above.

---

## 1. What v2 requires (summary)

**Purpose:** track the **physical** loan documents from release to warehouse:
- the current holder of each document;
- a receive and release timestamp for each user;
- TAT per stage and per user;
- demerit points;
- funds (CA/FT);
- QR-located archive boxes.

**Scanned copies stay in Digicur.** The DMS stores only a link or reference to them (v2 §1.5). This answers open question 1 in the earlier `ANALYSIS_REPORT.md`: no scan archive needs to be built.

### 1.1 Modules (v2 §13.4)

1. Setup and Admin
2. PN # search and transaction creation
3. Workflow engine (accept, forward, return; TAT; audit)
4. DP acceptance and fund computation
5. Finance release and DP receipt
6. Liquidation
7. Custodians and QA (demerits)
8. Digicur and Archiver (QR)
9. myloans change sync and Open Items
10. Dashboard, notifications and reports

### 1.2 Workflow

**Sequence (§2.1, §5.3).** No stage may be skipped:

`LA → DP → Finance (CA or FT) → DP → LA → Custodians (vault) → QA → Digicur → Archiver → Warehouse (Stored = closed)`

**Custody rules:**
- Each document has **one current holder**.
- The next user must **Accept** before the document moves to them.
- Every accept, forward and return is timestamped.
- A **return** goes to the previous user and requires remarks.

**Three stage levels (§6):**
- **Loan file** (12 stages): Loan opened → Classified → Check documents → DP Processing → LA Acceptance → Collateral → QA → Digital Records → In Safekeeping → Closure → Archived → Disposed. It can also become Cancelled in myloans.
- **Transaction:** Set up → LA processing → DP Assigning → Fund requested → Fund released → Fund received → LTO Processing → With issue → Done → Removed or Cancelled.
- **Document:** Received → Checked → With DP → Returned to LA branch → In transmittal → Received by Collateral → QA reviewed → Scanned → In vault → Archived → Disposed.

**Status list (§8):** 26 statuses in a `StatusCodes` lookup, for example FOR_DP_ACCEPTANCE, FUND_MISMATCH, FOR_LIQUIDATION, FOR_SCANNING, STORED and WITH_OPEN_ITEM.

### 1.3 Rules (§4, §5)

**Classification and transactions:**
- **Rule 1:** Financing or Refinancing, taken from whole words in the product name. If neither word appears, the loan is Refinancing.
- **Rule 2:** the Undertaking pick is recorded only.
- **Rule 3:** the OR/CR Transferred or Untransferred pick decides which transactions are allowed.
- **Rule 4:** Mortgage applies when a New loan is ≤ ₱500k or a Renewal is ≤ ₱1M. Amounts are compared as exact decimals. The rule records AUTO_MORTGAGE_RULE; a manual change records MANUAL_CORRECTION.
- **Transaction types (8):**
  - Created automatically: Notary, For EDST, For Entry PPSR, Mortgage.
  - **Optional:** Cancellation of Mortgage, Transfer of Ownership, Renewal of OR, PPSR Termination.
  - Each transaction has its **own checklist, DP and LTO office**.

**PN # search:**
1. Validate the PN against the settings rule.
2. Search the DMS.
3. Search myloans only for a valid PN that is not yet in the DMS.
4. Only loans with IsSelectable = 1 can be picked.

**Funds:**
- **Computed amount** = document fee per transaction type + km × rate per km + meals per day per person + other expenses (each with remarks). The DP cannot edit the computed rates.
- **One request per account (PN).**
- CA requests go only to the CA Finance user; FT requests go only to the FT Finance user.
- Release details are required. The released amount must match the computed amount, or remarks are needed.
- The **DP confirms receipt** by matching the reference #, amount and last 4 digits. A mismatch blocks LTO processing.
- **LTO drop-off and pick-up each need a proof upload** (photo or LTO receipt) with a timestamp.
- **CA liquidation:**
  - OR # and amount per expense.
  - The system computes the excess or shortage.
  - Due **2 working days** after LTO processing.
  - No new CA is allowed while one is unliquidated.
- **FT:** "confirm amount used" only.
- Late fund release counts against Finance.

**Transmittal:** the LA records the courier, tracking # and delivery mode. The Custodian checks the tracking # on receipt.

**QA and demerits:**
- QA marks demerit points per employee.
- Demerits are added **automatically for TAT violations**.
- Employees can dispute; the Admin decides.
- Demerit summary and ranking.

**Archive and QR:**
- Full storage hierarchy: warehouse, room/section, aisle, rack, shelf, box, folder/position.
- A unique, non-sensitive **QR per box**.
- Box inventory.
- Movement history with the old and new location, reason, user and time.
- A box cannot be marked Stored until its location fields are complete and its QR is linked.

**myloans:**
- Change check uses API 2 (changed-since, with cursor and checkpoint) and API 3 (freshness).
- `SourceUpdatedAt` plus `ContentHash` decide whether anything changed.
- Every real change raises an **Open Item**. **DMS data is never updated automatically.**
- Only the **LA Supervisor/Head** approves or rejects an Open Item.
- A transaction cannot be marked Stored while it has an open Open Item.
- APIs 4 and 5 sync branches and products.

**Admin powers:** only the Admin or Superadmin can reassign or cancel transactions.

### 1.4 Roles (§7)

| Role | Notes |
|---|---|
| Superadmin | The developer |
| Admin | Group Head |
| LA | Has an LA Supervisor/Head flag |
| DP | |
| Finance CA user | Separate user |
| Finance FT user | Separate user |
| Custodians / Collateral | |
| QA | |
| Digicur | |
| Archiver | |
| All users | Pending inbox with TAT countdown, own demerits and disputes, read-only document search |

### 1.5 Data (§12)

- Database **DMSDB on SQL Server**.
- PascalCase plural table names, `bigint` identity keys, and `decimal(18,2)` amounts.
- Audit columns `CreatedAt/By` and `UpdatedAt/By` on **every** table.
- Reference numbers `TXN-`, `FR-`, `OI-` and `LQ-YYYY-######`.
- Uploaded files are named `PN_doctype_yyyyMMdd`.
- 27 tables and 44 relationships (ERD).
- The borrower name is stored in parts, together with **BirthDate**.

### 1.6 Settings (§9)

- TAT per stage and the working-day calendar.
- **Process flow stages: add, remove, reorder.**
- Alert rules.
- PN rules, checklists, return reasons, delivery modes and couriers, sync interval and monitored fields.
- Deficiency types and points, TAT demerit points and thresholds.
- Fund types and the Finance user assigned to each, document fee table, rate per km, km per LTO office/branch, meals, lead time, liquidation deadline.
- Archive hierarchy masterlist and QR label settings.

### 1.7 Reports (§10)

Every report can be filtered by date, branch, stage and user, and **exported to Excel or PDF**.

| Area | Reports |
|---|---|
| Workflow and performance | TAT · Pending/Overdue · Status per PN · Movement History · Returned · Closed |
| Quality and demerits | Demerit Summary · QA Deficiency · Dispute |
| Funds and LTO | Fund Request/LTO Status · Fund Release · Expense/Liquidation |
| myloans | Open Items · Sync Log · PN Search Log |
| Archive | Archive Location · QR Locator · Box Inventory · Movement History |

### 1.8 Notifications

- Configurable alerts (for example 1 day before the TAT is due), by email or in-system, to configurable recipients.
- New Open Items notify the current holder and the LA Supervisor/Head.
- The full notification matrix is a Phase 3 deliverable.

---

## 2. Gap table

Legend:
- ✅ **Built**: does what v2 says.
- 🟡 **Partly**: exists but incomplete.
- ❌ **Missing**: not in the system.
- ⚠️ **Conflicts**: built, but works differently from v2.

### 2.1 PN search, myloans, classification (v2 Modules 1, 2, 9)

| # | v2 requirement | Status | Evidence / note |
|---|---|---|---|
| 1 | PN # validation per a settings rule, before any lookup | ✅ | `lib/pn/` (one parser; the format is a setting), `docs/workflow/09` item 55 |
| 2 | Search the DMS first, then myloans only for a new valid PN; no duplicates | ✅ | `lib/services/find-local.ts`; `Loan.pn` is unique (`prisma/schema.prisma:621`) |
| 3 | Only selectable loans (status 12, active, not superseded) | 🟡 | Status 12 only (`docs/workflow/09` #20). There is no `IsSelectable` / `IsSuperseded` / `TransactionIsActive` check: no code mentions it. |
| 4 | Rule 1: classification from whole words; neither word means Refinancing | ✅ | `lib/rules/index.ts:38-63` (matches v2 exactly, including the "Auto Finance" case) |
| 5 | Rules 2–3: Undertaking and OR/CR picks for Financing loans | ✅ | `lib/rules/index.ts` (types at :19-20), preview card |
| 6 | Rule 4: Mortgage thresholds, inclusive; exact decimals; reject "1e6" and "1,000" | ✅ | `lib/rules/index.ts:25-28`. The thresholds are **code constants, not Settings**. v2 §4.5 says the transaction lists are editable seed data but does not say whether the thresholds must be editable. |
| 7 | AUTO_MORTGAGE_RULE / MANUAL_CORRECTION with a permission | 🟡 | A supervisor override exists (`rules:override`, Admin, audited). It uses a different key name and a different role from v2's `loans:correct_completed_steps`. |
| 8 | 8 transaction types: 4 created automatically plus **4 optional**, available depending on the result (§4.5) | 🟡 | The rule engine knows only `NOTARY`, `EDST`, `PPSR`, `MORTGAGE` (`lib/rules/index.ts:22, 31`). Custom types can be added by hand (`transactions:add`), but there is **no "optional / unavailable" logic** and no seed for Cancellation of Mortgage, Transfer of Ownership, Renewal of OR or PPSR Termination. |
| 9 | Checklist per transaction type, editable | ✅ | `ChecklistRule` (`schema.prisma:497`), Settings → Checklist. It also supports "pick at least one" groups, which v2 does not have. |
| 10 | myloans change check through API 2 (since / cursor / checkpoint, 500 per page) | 🟡 | A changed-since feed mode exists (`lib/myloans/http-adapter.ts:60`, `lib/myloans/types.ts:71`). The default is **tiered per-loan polling** (`lib/myloans/tiers.ts`). v2's cursor and `maxSourceUpdatedAt` contract is not implemented as specified. |
| 11 | `SourceUpdatedAt` + `ContentHash`: a timestamp-only change saves the timestamp and raises no item | 🟡 | A hash compare exists (`lib/services/source-sync.ts:164-189`, `LoanSourceSnapshot.hash`). The hash is computed by the DMS; v2 expects myloans to supply it. |
| 12 | **Open Item for every real change; DMS data never updated automatically** | ⚠️ | **Minor changes are applied automatically** (`lib/services/source-sync.ts:185-200`). Other changes are split into the classes BORROWER / MATERIAL / STATUS / REPLACEMENT (`:215-217`). |
| 13 | **Only the LA Supervisor/Head** approves or rejects, with remarks | ⚠️ | Borrower-detail changes go to the Branch Supervisor (`SOURCE_REVIEW_BORROWER`). MATERIAL, STATUS and REPLACEMENT changes go to the **Admin** (`myloans:review`) (`docs/workflow/08`, `lib/auth/permissions.ts:431`). |
| 14 | Open Item blocks Stored / Closure | ❌ | Stored and Closure do not exist yet |
| 15 | Superseded Open Item when a newer change arrives (Chart 9b, scenario H) | 🟡 | The pending review is updated in place; there is no "Superseded" status |
| 16 | API 3 freshness check before a fund request and before Stored | ❌ | Not built. There is a "refresh on open after 60 min" (`docs/workflow/09` #28). |
| 17 | API 4 branches sync | 🟡 | Branches come from a CSV/TSV import plus Branch review (`lib/services/branches.ts`). An API is not available yet (`docs/workflow/09`). |
| 18 | API 5 products sync, `Products` table | ❌ | No Products table; product name and code are copied onto `Loan` |
| 19 | OAuth client-credentials token, 60-minute expiry, renewal | ❌ | The HTTP adapter uses an API key (`MYLOANS_API_KEY`, `lib/env/check.ts:121`) |
| 20 | SyncLogs table and Sync Log report | 🟡 | Runs are audited, and the last 10 are kept in a setting (`myloans.state.runs`). `BranchSyncRun` exists. There is no SyncLogs table or report. |
| 21 | PN # Search Log (invalid PN, not found, not released) | ❌ | Not logged as a report |
| 22 | Borrower name in parts plus **BirthDate** | ⚠️ | A single `borrowerName`. **BirthDate is deliberately never read** (`docs/myloans/field-map.md`; privacy choice). |

### 2.2 LA and DP work (Modules 3, 4)

| # | v2 requirement | Status | Evidence / note |
|---|---|---|---|
| 23 | LA checks documents per transaction and flags missing ones with a reason; can still assign | ✅ | `lib/services/papers.ts`; Missing-paper Rules 1–10 (`docs/workflow/09` #34-43) |
| 24 | One DP and one LTO office **per transaction**; several DPs per loan file | ✅ | `DpAssignment` (`schema.prisma:935`), LTO office at Send |
| 25 | DP queue, Accept / Decline (remarks) / Hold | ✅ | `lib/services/jobs.ts`, `holds.ts`. The decline reasons list is fixed (`docs/workflow/01`). |
| 26 | DP finds an unflagged missing document → return to the assigning LA | ✅ | Decline "Papers not complete" / Return to LA (`docs/workflow/06`) |
| 27 | Transaction stages: Fund requested / released / **received** / LTO / With issue / Done | 🟡 | Current DP stages are Notarization → PPSR → LTO drop-off → LTO pick-up → Check and verify (`ProcessingStage`, `docs/workflow/10`). There is no "Fund received" step and no "With issue → retry". |
| 28 | **Proof upload** at LTO drop-off and pick-up (photo or LTO receipt), each timestamped; required for Processed | 🟡 | Stage evidence supports `file` fields (`schema.prisma:1839-1840`). Today's LTO evidence is date, office, OR # and the annotated OR/CR tick, **not a photo**. Stored files **cannot be opened from the UI** (no link to `/api/stage-files`). |
| 29 | DP "Set schedule date; group PN #" (Chart 5) | ❌ | Not in the system (and not in the v2 text: see §5) |
| 30 | Forward to the LA branch only after LTO **and liquidation** are done | ⚠️ | Today forward needs Check and verify only. Liquidation is separate, with a 10-day deadline. |
| 31 | Pasuyo (second processor), DP capacity, LTO advisories, Monitoring page | ➕ Extra | Built (`docs/workflow/09` #50-53) but **not in v2** |

### 2.3 Funds (Modules 4, 5, 6)

| # | v2 requirement | Status | Evidence / note |
|---|---|---|---|
| 32 | CA and FT fund types | ✅ | `FundsType` (`schema.prisma:1470`), with CA-/FT- number series |
| 33 | **Computed amount** = doc fee per type + km × rate + meals + other; the DP cannot edit rates | ⚠️ | Expense kinds with modes Person / Suggested / Fixed, rule amounts per transaction type and kind (`CashAdvanceRule`), and an office transport estimate (`LtoOffice.distanceKm`, used only as an estimate, `schema.prisma:546`). There is **no rate per km and no meal allowance**, and the DP types or picks amounts. |
| 34 | **One fund request per account (PN)** | ⚠️ | One `CashAdvance` per DP request, with lines per transaction. It can move balances across PNs (`movedFromLineId`, `schema.prisma:1355`). |
| 35 | Request fields: CA (amount, date, other needs); FT (amount, payee DP, bank/e-wallet, last 4) | 🟡 | The FT receiving account (last 4) is entered **at release** by Finance, not at request by the DP (`docs/workflow/05`) |
| 36 | Route to the **CA user** or the **FT user**; neither can do the other type | 🟡 | Per-type permission ticks exist (`FUNDS_CA_*` / `FUNDS_FT_*`, `lib/auth/permissions.ts:401-404`), so two Finance roles can be configured. The default Finance role holds both, and there is no "Finance user assigned to fund type" setting. |
| 37 | Finance accepts and releases; **no approval bands** in v2 | ⚠️ | Built as **approve, then release** with **approval bands by amount** (`ApprovalBand`, ₱5,000 placeholder) and Approver roles (`APPR`) |
| 38 | Release needs the reference # and amount (and last 4 for FT); a difference from the computed amount needs remarks | 🟡 | Reference and last 4 are required (`docs/workflow/09` #47). There is no rule requiring remarks when the released amount differs. |
| 39 | **DP confirms receipt; mismatch → FUND_MISMATCH**, flagged to Finance and the Admin; blocks LTO | ❌ | Not built (`mismatch` appears nowhere in the funds code) |
| 40 | "Funds credited" status; LTO blocked until released | 🟡 | "LTO drop-off blocked until funded" is a setting (`docs/workflow/04`) |
| 41 | CA liquidation: OR # and amount per expense, excess or shortage computed, Finance verifies | 🟡 | Receipts (date, amount, number, file), return of cash and Finance confirmation exist (`Receipt`, `CashReturn`). The shortage / reimbursement calculation is not explicit. |
| 42 | **Liquidation deadline 2 working days after LTO** | ⚠️ | `funds.liquidationDueDays = 10` from **release** (`lib/settings.ts:46`) |
| 43 | No new CA while one is unliquidated | ✅/⚠️ | Blocked while one is **overdue**, with a Finance one-time exception (`docs/workflow/05`). v2 says unliquidated, with no exception. |
| 44 | FT: confirm amount used only | ⚠️ | FT is settled like a CA (receipts) |
| 45 | Carry-over, top-up, move to a new PN, type change before release | ➕ Extra | Built (`CarryOver`, `CashAdvanceTopUp`) but not in v2 |
| 46 | Late fund release counts against Finance (TAT / demerits) | ❌ | No per-user TAT attribution |

### 2.4 Workflow engine, TAT, exceptions (Module 3)

| # | v2 requirement | Status | Evidence / note |
|---|---|---|---|
| 47 | **Generic accept / forward / return** for every stage and role, with **one current holder** | 🟡 | Built for LA → DP → receiving LA only (`lib/services/workflow.ts`, `jobs.ts`). Custodian, QA, Digicur and Archiver steps do not exist. `DocumentItem.custodian` exists per paper. |
| 48 | **TAT starts at accept, stops at forward, per user and stage**; sample targets per stage | ⚠️ | TAT clocks are measured **from release** per transaction type (LA Day 2, Notary 3, PPSR 5, Mortgage 10 …; `docs/workflow/07`, `TatRule`). There is no per-user accept → forward TAT. |
| 49 | Working days exclude weekends and holidays | ✅ | Business-day calendar and holidays in Settings (`HolidayCalendar`) |
| 50 | Return to the previous user with a return reason and remarks | 🟡 | Return to LA exists (reason plus 5–500 character remarks, `docs/workflow/06`). There is no general "previous user" return. |
| 51 | Only Admin / Superadmin reassign or cancel a transaction | ⚠️ | Admin is **read-only** on loans and locked out of the LA/DP/Finance work steps (`docs/workflow/07`, README) |
| 52 | Exceptions with type, owner, raised-by, resolution; block Closure; Exceptions report | 🟡 | Problems, Holds, Missing papers and `LoanException` exist, and an "Open items" list exists. There is no single exception register or Exceptions report. |
| 53 | Process stages configurable: add, remove, reorder (§9.1) | 🟡 | DP processing stages per transaction type are configurable (`ProcessingStage`). **Loan-file stages are hard-coded** (`lib/workflow/stage.ts`, `stage-map.ts`). |
| 54 | Pending inbox per user with a TAT countdown | ✅ | Home "Do these next", TAT chips (`docs/workflow/07`) |

### 2.5 Vault, QA, Digicur, Archive (Modules 7, 8)

| # | v2 requirement | Status | Evidence / note |
|---|---|---|---|
| 55 | Transmittal form (courier, tracking #, delivery mode) | ❌ | A `Transmittal` table exists but is unused (`schema.prisma:1023`; only the simulator uses it). There are no courier, tracking or delivery-mode fields. |
| 56 | Custodians receive by scan, check the tracking #, verify completeness, forward to QA | ❌ | The `VAULT` role exists with view permission only (`lib/auth/permissions.ts:419`) |
| 57 | QA checklist, findings, return for correction | ❌ | The `QA` role has view only. `QaFinding` is unused (`schema.prisma:1122`). |
| 58 | **Demerit points**: QA plus automatic TAT points, disputes, ranking | ❌ | Nothing in the code |
| 59 | Digicur: scan reference or link, forward to the Archiver | ❌ | The `DIG` role has view only. `DigitalRecord` is unused (`schema.prisma:1106`). |
| 60 | Archiver: storage hierarchy, box inventory, document position | ❌ | `VaultLocation` is unused |
| 61 | **QR code per box**, label print, QR lookup with role-limited view | ❌ | QR labels were **removed** on 11 Nov 2026 (`docs/workflow/09` #67) |
| 62 | Box movement history (old/new location, reason, user, time) | ❌ | — |
| 63 | Stored closes the transaction | ❌ | Nothing sets `closedAt` (`docs/workflow/13`) |
| 64 | Safekeeping until fully paid → Closure → Archived → Disposed (§6.1) | ❌ | Stage names exist in the stage map only (`lib/workflow/stage-map.ts`); there is no workflow behind them |

### 2.6 Roles, settings, reports, notifications, data (Modules 1, 10)

| # | v2 requirement | Status | Evidence / note |
|---|---|---|---|
| 65 | Superadmin role (developer) | ❌ | No such role. Admin is the top role. |
| 66 | Admin = Group Head: settings, reports, reassign/cancel, demerit disputes, fund mismatches | ⚠️ | The Admin role has users, settings, audit and override, but is read-only on work (see #51) |
| 67 | LA Supervisor/Head flag on the LA | 🟡 | A separate **Branch Supervisor** role (`SUP`) exists (`lib/auth/permissions.ts:431`) |
| 68 | Custodian, QA, Digicur, Archiver roles | 🟡 | `VAULT`, `QA` and `DIG` exist as placeholders that **cannot sign in**. There is no Archiver role. |
| 69 | DP and Finance users sign in | ⚠️ | `DP` and `FIN` default to `canSignIn: false` (`lib/auth/permissions.ts:417-418`); an Admin can change this per role |
| 70 | Settings lists: return reasons, delivery modes/couriers, deficiency types, fee table, rate per km, meals, Finance user per fund type, archive masterlist, QR label settings, alert rules, monitored fields | 🟡 | Return / hold / missing / problem reasons, LTO offices, holidays, types, checklists, stages, fund types and expense kinds exist (`app/(app)/admin/settings`). The rest of this list is missing. |
| 71 | 19 reports with filters, **Excel/PDF export** | 🟡 | Exists: TAT and problems report (`app/(app)/reports/tat`), Monitoring, Journey (≈ Movement History), audit log, liquidation print. **CSV exports are switched off** (`docs/workflow/09` #68). About 14 of the 19 v2 reports are missing. |
| 72 | Configurable alerts (when, channel, recipients) | 🟡 | Email through Graph (outbox, reminders, digest, opt-out) and in-app notifications by permission tick (`lib/email/`). Timings are fixed, not configurable per event. |
| 73 | Audit trail of every action | ✅ | `AuditLog` in the same transaction (`lib/audit.ts:29`) |
| 74 | **SQL Server DMSDB**, PascalCase, bigint identity, audit columns on every table | ⚠️ | **PostgreSQL 16** through Prisma; cuid string ids; camelCase models; no CreatedBy/UpdatedBy on most tables |
| 75 | Reference numbers TXN- / FR- / OI- / LQ-YYYY-###### (6 digits) | ⚠️ | CA-/FT-YYYY-#### (4 digits). No TXN, OI or LQ numbers. |
| 76 | Uploaded file names `PN_doctype_yyyyMMdd` | ⚠️ | Random UUID names (`lib/storage/receipts.ts`). This was a security choice; a display name could follow v2 instead. |
| 77 | Data Privacy Act compliance, retention policy | ❌ | See `ANALYSIS_REPORT.md` §4.5 |
| 78 | Web app inside the company network | ⚠️ | The plan in the repo is Supabase-hosted (cloud) (`README.md`, `docs/db/squash-notes.md`) |
| 79 | Login method (AD/SSO or local) | ❌ | Entra is not built; test sign-in only (see `ANALYSIS_REPORT.md`) |
| 80 | Migration of current Excel tracking lists and in-process documents | ❌ | Not built (a settings CSV import exists, `lib/import/`) |

### 2.7 Tally

| Status | Count (of 80) | Share |
|---|---|---|
| ✅ Built | ~15 | 19% |
| 🟡 Partly | ~27 | 34% |
| ⚠️ Conflicts | ~18 | 22% |
| ❌ Missing | ~20 | 25% |

Weighted by effort, the current system covers about **40%** of v2. It covers most of Modules 1–2, about half of Modules 3–6 and 9–10, and almost none of Modules 7–8.

---

## 3. Needs modification (built, but works differently from v2)

| # | Feature today | What v2 wants | Change needed | Files |
|---|---|---|---|---|
| M1 | MyLoans **minor** changes are applied automatically; changes are split into 4 classes; Admin approves the big ones | Every real change becomes an Open Item; nothing is applied until the **LA Supervisor/Head** approves or rejects | Remove the automatic apply; route every class to one Open Item flow; move approval to a Supervisor flag; add the Superseded, Approved and Rejected statuses and an OI- number | `lib/services/source-sync.ts`, `lib/services/borrower-review.ts`, `SourceChange` model, permissions |
| M2 | Tiered per-PN polling; DMS computes the hash | API 2 checkpoint/cursor feed; myloans supplies `SourceUpdatedAt` and `ContentHash`; API 3 freshness check; OAuth client credentials | Make feed mode the default and add the cursor/checkpoint contract; add a freshness call before a fund request and before Stored; add an OAuth token client | `lib/myloans/*`, `lib/services/source-sync.ts` |
| M3 | Fund request per DP, amounts from expense kinds | One request per **account**, with a computed **fee + km × rate + meals + other** formula; rates locked | Add rate per km, meals and a fee table per type; compute the lines; lock computed lines; enforce one request per PN; FT account details at request time | `lib/funds/*`, `lib/services/funds.ts`, `CashAdvance*` models, `components/funds/forms.tsx` |
| M4 | Approve, then release, with **approval bands** and Approver roles | The CA or FT user accepts and releases; no bands | Turn off bands (keep the code behind a setting) or remove them; bind the Finance user to a fund type | `ApprovalBand`, `lib/services/funds.ts`, roles |
| M5 | Liquidation due 10 days after **release**; overdue blocks; Finance exception; FT itemized | Due **2 working days after LTO**; any **unliquidated** CA blocks; FT is "confirm amount used" | Change the deadline base and default; change the block rule; add a simple FT confirmation path | `lib/settings.ts:46`, `lib/services/funds.ts` |
| M6 | TAT measured from release, per transaction type | TAT from **accept to forward, per user and stage**; late fund release counted against Finance | Add per-holder TAT computed from movement records; keep the release-based clocks only if wanted | `TatRule`, `lib/workflow/*`, reports |
| M7 | DP stages: Notary → PPSR → LTO drop-off → pick-up → Check and verify; evidence fields | Fund received → LTO Processing (drop-off and pick-up **photo proof**) → Done or With issue (retry) → For liquidation | Add file evidence to LTO stages and a viewer link; add With issue and retry; gate forward on liquidation | `ProcessingStage` seed, `lib/services/job-stages.ts`, `components/jobs/stages.tsx` |
| M8 | Admin is read-only on loans and locked out of work steps | Admin/Superadmin **reassign or cancel** transactions, resolve fund mismatches, decide demerit disputes | New Admin actions; a Superadmin role | `lib/auth/permissions.ts`, `lib/services/workflow.ts` |
| M9 | Branch Supervisor is a separate role | An LA with an `IsSupervisor` flag | Either map Supervisor to LA plus a flag, or keep the role and rename it in the UI. Low impact. | roles |
| M10 | 4 rule-created transaction types | 4 automatic plus 4 **optional** (by result), all editable seed data | Add an availability matrix (auto / optional / unavailable per result) to Settings; seed the 4 optional types and their checklists | `lib/rules/index.ts`, `TransactionType`, `ChecklistRule`, seed |
| M11 | Borrower name as one field; BirthDate never stored | Name parts and BirthDate | **Privacy decision needed**: storing BirthDate increases personal data held (RA 10173) | `Loan` model, `lib/myloans/account.ts` |
| M12 | CSV exports off; few reports | 19 reports, Excel/PDF export | Report framework with filters and export | `app/(app)/reports/*` |
| M13 | Reference numbers CA-/FT-YYYY-#### | TXN/FR/OI/LQ-YYYY-###### | Number series service. Changing CA/FT to FR- affects `dms_renumber_advances()`. | `lib/funds/*`, baseline SQL function |
| M14 | Supabase cloud plan; Postgres | SQL Server DMSDB, inside the company network | See §6, decision D1 | — |
| M15 | Pasuyo, carry-over, top-up, LTO advisories, capacity, Monitoring | Not in v2 | **Decide**: keep as extras, hide, or remove. They don't block v2, but they add training and testing load. | various |

---

## 4. Not yet in the system (v2 needs, none exists)

| # | Feature | v2 ref | Rough effort (1 experienced dev) |
|---|---|---|---|
| N1 | **Generic custody workflow engine**: accept / forward / return for 9 roles; one current holder; movement records with TAT used and IsLate; StatusCodes lookup | §5.3, §8, Module 3 | 3–4 weeks |
| N2 | **DP receipt confirmation and Fund Mismatch** flow | §5.7 | 3–4 days |
| N3 | **Transmittal** (courier, tracking #, delivery mode, transmittal no.) and Custodian receive with a tracking check | §5.8, Chart 7 | 1 week |
| N4 | **Custodian, QA, Digicur, Archiver** work screens (inboxes, accept, forward, return) | §7 | 2–3 weeks (on top of N1) |
| N5 | **QA checklist and findings**, deficiency types | §5.9, §9.3 | 1 week |
| N6 | **Demerits**: QA points, automatic TAT points, dispute and Admin decision, summary and ranking | §3.6, §5.9 | 1.5–2 weeks |
| N7 | **Archive locations, box inventory, document position, movement history** | §5.10, §9.6 | 1.5–2 weeks |
| N8 | **QR code** generation, label printing, authenticated QR lookup | §3.7, §5.10 | 1 week |
| N9 | Digicur scan reference or link per document | §3.7 | 2–3 days |
| N10 | Stored / Closure / Archived / Disposed transitions; Open Item blocks Stored | §6.1, §5.2 | 1 week |
| N11 | **Optional transactions** and the availability matrix | §4.5 | 3–5 days |
| N12 | Products sync (API 5); branches by API (API 4) | §11.4–11.5 | 3–5 days (depends on the myloans team) |
| N13 | **Superadmin** role; Finance user ↔ fund type binding | §1.6, §9.4 | 2–3 days |
| N14 | **Configurable alert rules** (event, timing, channel, recipients) | §9.1 | 1 week |
| N15 | **~14 new reports** plus Excel/PDF export on all reports | §10 | 2–3 weeks |
| N16 | Settings: delivery modes, couriers, fee table, rate per km, meals, lead time, archive masterlist, QR label settings, monitored myloans fields | §9 | 1–1.5 weeks |
| N17 | PN Search Log, SyncLogs table and report | §10.4 | 3–4 days |
| N18 | Data migration of the Excel tracking lists and in-process documents | §13.1 Phase 6 | 1–2 weeks |
| N19 | Go-live hardening from `ANALYSIS_REPORT.md`: sign-in, storage, privacy logging, CI, headers | §1.7, §13.6 NFRs | 3–5 weeks (unchanged) |

---

## 5. Contradictions between documents (flagged, not resolved)

### 5.1 Inside v2 itself

| # | Topic | One place says | Another place says |
|---|---|---|---|
| C1 | **When a transaction closes** | §2.1, §3.6, §5.3, §8: QA → Digicur → **Archiver → Warehouse, Stored = closed**, right after scanning | §6.1, §6.3, Chart 1 and Chart 8: Digital Records → **In Safekeeping (vault) until the loan is fully paid** → Closure (Admin) → Archived → Disposed. Chart 8 puts the Archiver and QR **after** Closure. |
| C2 | Order of vault, QA and scan | §8 status list: **In Vault → For QA Review → For Scanning → For Archiving** | §6.3 document stage: Received by Collateral → QA reviewed → Scanned → **In vault** (vault after scanning) |
| C3 | Retrieval | §1.5: retrieval and borrowing from the warehouse are not covered | §6.3: "Released or archived after the loan is fully paid"; §6.1 Closure after full payment (implies release and retrieval handling) |
| C4 | Current holder | §5.3: one holder per document; `Transactions.CurrentHolderUserId` is **one per loan file** | §5.4: one loan file can have several DPs at once, so one holder per loan file cannot be right |
| C5 | Fund approval | §2.1: Finance "approves and releases" | §3.5, §5.7: no approval step or status; Finance only accepts and releases |
| C6 | DP scheduling | Chart 5 (`DP.png`): "DP: **Set schedule date; group PN #**" | Not in any v2 text section, table or status |
| C7 | With issue | Chart 6: "With issue: **Reschedule** or return to LA" | §6.2, §8: "Retry LTO processing or return to LA" (no reschedule date field) |
| C8 | Open Item statuses | Chart 9b scenario H: the older item is closed as **Superseded** | §12.2 OpenItems StatusCode: PENDING, APPROVED, REJECTED only |
| C9 | No longer Released | Chart 9b scenario G: the loan file goes **On Hold**; the LA Head decides | §8 has no loan-level On Hold (only "On Hold (DP)") |
| C10 | First TAT stage | §2.2: TAT starts when a user **accepts** | §2.2 table: "LA: check documents and assign to DP, 1 day". The LA never accepts anything at stage 1, so there is no start event. |
| C11 | Archive history table | §5.10 requires box movement history | §12.2 / §13.7: no table for it yet (an open question in v2 itself) |

### 5.2 v2 vs. the BRDs (MTLMS, MoD), the MoD page and the templates

| Topic | v2 | BRDs / other |
|---|---|---|
| Overall flow | LA check → DP → Finance → DP → LA → Vault → QA → Digicur → Archiver | MTLMS: 15 stages from Receive to Transmit to vault. Funding comes **before** the document check; QA and liquidation come **before** the vault. |
| Where QA sits | After the vault, before Digicur | MTLMS: stage 12, before liquidation. MoD: at the vault, as prior-to-safekeeping and thorough checks. |
| Liquidation | DP, after LTO, before forwarding | MTLMS: Liquidation Officer, after QA (stage 13) |
| Closure | Stored in the warehouse | MTLMS: endorsed to the vault. MoD: warehoused after release to the borrower, digitization and ARF. |
| Source of loans | myloans API (core) | MTLMS: manual Receive/Encode/Validate; import from the loan system is "Won't". MoD: manual log by the custodian. |
| Who assigns the DP | LA | MTLMS: Operations Supervisor, from a ranked list (area, distance, capacity) |
| DP signs in | Yes: queue, accept, request funds | MTLMS: DPs do **not** sign in in phase 1 (A-04, FR-066 Won't) |
| Finance | Two users (CA, FT); no approval | MTLMS: one Finance Officer/Approver; CA/FT approval statuses; approval-authority matrix |
| Funding gate | Before LTO; DP confirms receipt | MTLMS: before the document check; no receipt confirmation |
| Fund formula | Doc fee + km × rate + meals + other; rates locked | MTLMS: base + notarial + PPSR + mortgage + LTO + other; editable with a reason |
| Bank details | Last 4 digits only | MTLMS: full details stored, masked for viewers |
| CA ↔ FT switch | One type per request | MTLMS: switch allowed before the document check |
| Liquidation deadline | 2 working days after LTO; block new CA | MTLMS: flagged at 14 days after LTO done; no block |
| FT liquidation | Confirm amount used | MTLMS: itemized like a CA |
| TAT model | Per user and stage, accept → forward | MTLMS: per transaction type, end to end (Mortgage 7, Notary/PPSR 3–4, Transfer 10 …), with 80%/100% bands, Mon–Sat business days. MoD: return periods 60/45/60. |
| Holds | DP hold only | MTLMS: 11 pending reasons, hold at any stage |
| Returns | To the previous user | MTLMS: QA returns to the stage that failed |
| Reassign / cancel | Admin / Superadmin only | MTLMS: Operations Supervisor reassigns |
| Classification | Financing/Refinancing and Mortgage thresholds | MTLMS: none; the type is picked at receipt; Undertaking changes fee and TAT. MoD: also Real Estate and DL products. |
| Transaction types | 8 (4 automatic, 4 optional); many per loan | MTLMS: 8 different rows (Notary/PPSR split by Undertaking); **one type per PN record** |
| Checklists | Per transaction type | MTLMS: fixed generic lists (validate 8, document check 7, EDST 4, LTO done 5, QA 8). MoD: about 30 QA groups. |
| Demerits | QA plus automatic TAT points; dispute | MoD: 1–3 points per finding from a catalogue; NTC/NTE/NOD notices; no TAT points; no dispute. MTLMS: none. |
| QR / location | QR per box; 7-level hierarchy | MTLMS: barcode/QR "Won't"; 9-level vault location. MoD: vault name only. |
| Pull-out / retrieval | Not covered | MTLMS: Must (FR-052). MoD: core (approval, return periods, release to borrower). |
| Retention | "Company policy"; no period | MTLMS: 10 years plus a disposal workflow. MoD: audit log 10 years, disposal out of scope. |
| Roles | Superadmin, Admin, LA, DP, Finance CA/FT, Custodians, QA, Digicur, Archiver | MTLMS: 14 roles (Receiving Clerk … Internal Auditor). MoD: Owner/Approver/Editor/Contributor/Viewer plus a pull-out Approver. |
| Sign-off parties | Group Head, Finance, IT, myloans team | Head of Operations, Finance, IT, Internal Audit, Compliance/Legal, Division Heads (+ Custodian Supervisor and QA Head in MoD) |
| Login | Open: AD/SSO or local | SSO **Must**, with MFA for editors (both BRDs) |
| Units per PN | One loan record per PN | MoD: 1–8 units per PN |
| Non-functional | Deferred to IT | MTLMS vs MoD disagree with each other (hours, RPO 1 h vs 24 h, load) |
| Templates: LTO offices | Km **per branch** (proposed `LtoOffices.BranchId`) | Templates: one distance per office, no branch column; extra `travel_hours` and `suggested_transport`. The two files give **different values for LTO-PASIG** (10 km/Iloilo City vs 50 km/Pasig). |
| Templates: loan types | LoanType is "New"/"Renewal" from myloans (read-only) | Template has a placeholder "Test" loan type (no v2 table) |
| Templates: document types | No original/copy attribute; vehicle documents only | Template has an `original_or_copy` column and real-estate examples (TCT, Barangay clearance) |

### 5.3 v2 vs. the current system's own documents

These are not contradictions between your source documents, but they matter for the change plan. `docs/workflow/*` records decisions made with the team (11–13 Nov 2026) that v2 reverses or omits:
- Labels/QR **removed** on 11 Nov; v2 brings QR back for archive boxes.
- CSV exports **switched off** on 11 Nov; v2 wants Excel/PDF on every report.
- Liquidation: 10 days after release; v2 says 2 days after LTO.
- Approval bands and Approver roles; v2 has none.
- Admin cannot do work steps; v2's Admin reassigns and cancels.
- MyLoans review: Admin for material changes; v2 has the LA Supervisor/Head for all changes.
- BirthDate never read (privacy); v2 stores it.

---

## 6. What forces major database or architecture changes

| # | Item | Why it is major | Estimate |
|---|---|---|---|
| D1 | **SQL Server mandate (§12)** | The app is built on PostgreSQL. Prisma supports SQL Server, but this codebase uses features Prisma does **not** support there:<br>• **38 enums**<br>• `String[]` lists (role permissions, `formerNumbers`, `loanIds`)<br>• 17 `Json` columns (SQL Server has no native JSON type in Prisma)<br>• `pg_trgm` search indexes<br>• partial indexes<br>• PL/pgSQL `dms_renumber_advances()`<br>• `FOR UPDATE` row locks<br>• advisory locks<br>• raw SQL in monitoring and sync<br><br>All of these must be redesigned. The migration baseline and the `migrate:check` tooling would be rebuilt. | **4–6 weeks** if required. **0** if IT accepts PostgreSQL. |
| D2 | **v2 naming conventions** (PascalCase plural tables, `bigint` identity, audit columns on every table) | Tables and columns can be renamed with Prisma `@@map` / `@map` at low risk. Switching cuid ids to `bigint` identity touches every relation and every URL that uses an id. | `@@map` only: 3–5 days. Full id change: 2–3 weeks. |
| D3 | **Custody / movement model** (`TransactionMovements`, one current holder, StatusCodes lookup) | Today custody is split across `DocumentItem` + `DocumentMovement`, `DpAssignment`, `LoanTransaction.status` (enum) and a cached `Loan.stage`. v2 needs one movement ledger that drives TAT, inbox and reports for 9 roles. This is the **central refactor**. | Part of N1 (3–4 weeks) |
| D4 | **Data-driven stages** (§9.1: add, remove, reorder stages) | Loan-file stages are hard-coded in `lib/workflow/stage.ts`, `stage-map.ts` and `lib/myloans/tiers.ts`. A config-driven stage table is needed. | 1–2 weeks (overlaps D3) |
| D5 | **Funds model** (one request per account; computed lines; liquidation table with excess/shortage; FR-/LQ- numbers) | Changes `CashAdvance`, `CashAdvanceLine`, `TopUp`, `CarryOver`, `Receipt`, `CashReturn` and the renumbering SQL function | 2–3 weeks (M3–M5, N2) |
| D6 | **Hosting inside the company network** vs the Supabase cloud plan | Changes storage, backups, cron, TLS and sign-in decisions | Decision, then 1–2 weeks of setup |
| D7 | **New tables**: Demerits, DeficiencyTypes, DeliveryModes, ArchiveLocations (+ movement history), OpenItems, SyncLogs, Products, StatusCodes | Additive. The existing unused placeholder tables (`Transmittal`, `VaultLocation`, `QaFinding`, `DigitalRecord`, `RetentionRule`) do not match v2's columns. | Included in N3–N8 |

Everything else (rules, PN search, checklist, missing papers, DP assignment, holds, audit, settings, imports, email, myloans client resilience, business-day calendar, RBAC and branch scoping) can be **kept and extended**.

---

## 7. Verdict: modify or build new

### 7.1 Effort comparison

Estimates are for one experienced full-time developer.

| Option | What it means | Effort | Risk |
|---|---|---|---|
| **A. Modify the current DMS, keep PostgreSQL** | Keep the platform, rules, PN search, checklist, myloans client, RBAC, audit, settings and tests. Rework funds, myloans review and TAT (§3). Build the custody engine and Modules 7, 8, 10 (§4). | **~24–30 weeks** (6–7 months) | Medium. Large but incremental; the existing ~1,050 tests and the e2e suite protect what is kept. |
| **A + SQL Server** | As A, plus the port (D1) and full v2 naming and ids (D2) | **~30–38 weeks** | Medium–High |
| **B. Build new to the v2 spec** (reuse the documents; new code on SQL Server) | Greenfield following v2 §13.4 Modules 1–10 | **~36–48 weeks** for the same quality and test coverage. v2's own plan says 8 weeks of development, which is not realistic for 27 tables, 10 roles, 19 reports, myloans sync and QR. | High. It must re-implement and re-test what already works (Rules 1–4, PN search, missing-paper rules, myloans resilience, business-day TAT, branch access). |

### 7.2 Updating the earlier estimate

- The **3–5 weeks** in `ANALYSIS_REPORT.md` was go-live hardening for **today's scope**, which is the LA → DP → Finance → LA part only.
- v2 widens the scope to the vault, QA, Digicur, archive, demerits and full reporting. **That estimate is no longer the go-live estimate for v2.**
- Revised plan:
  - **Phased go-live, v2 Modules 1–6 and 9** (LA through DP, Finance and liquidation, plus Open Items) **with hardening: ~12–16 weeks.**
  - **Full v2, Modules 7, 8 and 10 added: ~24–30 weeks** total. Add **6–8 weeks** if SQL Server is required.
  - These are developer weeks. v2 §13.2 also has UAT (2 weeks), pilot (2 weeks), training (1 week) and support (4 weeks), which run alongside or after.

### 7.3 Recommendation

**Modify the current DMS (Option A).** Build new only if IT makes SQL Server **and** v2's exact physical schema (bigint ids, names) a hard requirement. Even then, porting (A + SQL Server) costs less and is less risky than a rewrite.

Reasons:
1. About 40% of v2 is already built and tested. That includes the hardest-to-specify parts: classification Rules 1–4 match v2 word for word, and the PN search order, missing-paper flow and myloans resilience are done.
2. The gaps are mostly **new areas** (vault, QA, archive, demerits, reports), and those cost the same in either option.
3. The conflicts (§3) are rule and flow changes in specific files, not structural problems, except the custody engine (D3), which a rebuild would also have to design.

**Before any build work, close these decisions.** They change the estimates above:
- **D1 / D6:** SQL Server or PostgreSQL? Cloud or on-premise?
- **C1 / C2:** when the transaction closes (Stored after scan, or safekeeping until fully paid), and the order of vault, QA and scan.
- **v2 vs BRDs:** which document wins? v2 is labelled the source of truth, but the MoD BRD's pull-out, units-per-PN and QA catalogue are not in v2. Are they dropped, or deferred?
- **M15:** keep, hide or remove the extras v2 doesn't mention (Pasuyo, carry-over, top-up, approval bands, Monitoring, LTO advisories).
- **M11:** store BirthDate or not (privacy).

---

## 8. Prioritized to-do list

### 8.1 Must-have for go-live (phased go-live: v2 Modules 1–6 and 9)

**P0: decisions and security** (weeks 0–1)
1. Close decisions D1, D6, C1, C2 and M15. Get the v2 sign-off (§1, Approval).
2. Lock down test sign-in, then build the agreed SSO/AD login (`ANALYSIS_REPORT.md` Q1–Q3, M1). Allow DP and Finance users to sign in.
3. Durable file storage for receipts and LTO proof photos, plus backups (`ANALYSIS_REPORT.md` M3).

**P1: core workflow** (weeks 1–6)

4. **Custody engine (N1, D3, D4):** movement ledger, one current holder, StatusCodes, accept / forward / return, per-user TAT (M6), inbox.
5. **Optional transactions** and the availability matrix (N11, M10); seed the v2 checklists.
6. **Admin and Superadmin powers**: reassign and cancel (M8, N13); LA Supervisor flag (M9).

**P2: funds** (weeks 6–10)

7. Fund computation with fee, km × rate, meals and locked rates; one request per PN (M3); settings for the fee table, rate per km, meals and km per office (N16 part).
8. CA/FT Finance user routing; drop or disable approval bands (M4).
9. DP receipt confirmation and Fund Mismatch (N2).
10. LTO proof uploads, With issue and retry, and a proof viewer (M7).
11. Liquidation: 2 days after LTO, block on any unliquidated CA, excess/shortage, FT confirmation (M5). FR-/LQ- numbers (M13).

**P3: myloans** (weeks 10–12, depends on the myloans team delivering APIs 1–3)

12. Open Items: no automatic apply, LA Supervisor approves, Superseded status, OI- numbers (M1).
13. API 2 cursor/checkpoint feed, API 3 freshness check, OAuth token, SyncLogs and PN Search Log (M2, N17).

**P4: go-live readiness** (weeks 12–16)

14. Privacy: read-access log, append-only audit, retention rule, privacy notice (`ANALYSIS_REPORT.md` M4, M5, M12).
15. Minimum reports with Excel export: TAT, Pending/Overdue, Status per PN, Returned, Fund Release, Expense/Liquidation, Open Items (part of N15).
16. Configurable alerts for assigned, near-TAT, overdue, fund released, mismatch and Open Item (N14).
17. Migration of the Excel tracking lists and in-process documents (N18); CI pipeline; security headers; UAT; pilot with one branch.

### 8.2 Later phases (full v2)

18. Transmittal (courier, tracking #, delivery mode) and Custodian receiving (N3, N4).
19. QA checklist, findings and deficiency types (N5); Demerits with automatic TAT points, disputes and ranking (N6).
20. Digicur scan reference (N9).
21. Archive hierarchy, box inventory, movement history, QR labels and lookup (N7, N8); Stored / Closure / Archived / Disposed (N10).
22. The remaining reports (Demerit, QA Deficiency, Dispute, Archive ×4, Closed, Movement History export) (N15).
23. API 4 / API 5 branch and product sync (N12).
24. SQL Server port and v2 physical naming, if decided (D1, D2).
25. Retention and disposal engine once the retention period is set (`ANALYSIS_REPORT.md` X3).

### 8.3 Questions to answer first

1. **Database:** must the DMS run on SQL Server (v2 §12), or may it stay on PostgreSQL?
2. **Hosting:** company network (on-premise) or cloud (Supabase)?
3. **Closure (C1/C2):** is the transaction closed when the box is Stored right after scanning, or do documents stay in the vault until the loan is fully paid? What is the order of vault, QA and scan?
4. **BRD scope:** are the MoD pull-out/return cycle, units per PN (1–8), NTC/NTE/NOD notices and the 1–3 point QA catalogue dropped, or deferred to a later phase?
5. **Extras:** keep or remove Pasuyo, carry-over, top-up, approval bands, Monitoring and LTO advisories?
6. **BirthDate:** v2 stores the borrower birth date; the current system deliberately does not. Which does the DPO approve?
7. **Templates:** which LTO-PASIG values are correct (10 km, Iloilo City vs 50 km, Pasig)? Will distance be per branch, as v2 proposes?
