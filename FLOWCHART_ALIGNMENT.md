# Flowchart Alignment: v2 charts vs the current DMS

Date: 16 November 2026 (PHT)
Branch: `feature/foundation-settings-rbac-myloans`
This is part of Step 1: analysis only. Companion to `FOUNDATION_CHECK.md`.

Status labels used throughout:

| Label | Meaning |
|---|---|
| ✅ **Matches** | Built and matches the chart |
| ⚠️ **Different** | Built, but works differently from the chart |
| ❌ **Not built** | Not in the system |

## 0. Which charts were compared

| Source | Contents | Edition |
|---|---|---|
| **v2 .docx, embedded images** (`word/media`, in document order: Chart 1 = `image.png` … Chart 9b = `imagea.png`; the ERD = `imageb.png`) | Charts 1–9b, light theme | **Newest.** Matches the v2 text |
| `LDMS-Process-Flowcharts.png` | Charts 1–9b on one dark sheet | **Older** (see the table below) |
| `DP.png` | Chart 5 | Same as the sheet's Chart 5 (older) |
| `FUNDS and LTO Processing.png` | Chart 6 | Same as the sheet's Chart 6 (older) |

**The PNGs are an older edition, not the same charts.** Differences found:

| Chart | Older PNG / sheet | v2 .docx |
|---|---|---|
| 2 | "Found and **Released**?" | "Found and **selectable**? (Released, active, not a superseded copy)"; 404 / 422 messages; store SourceUpdatedAt + ContentHash |
| 5 | Receive → Documents complete? → Accept → **"DP: Set schedule date; group PN #"** → Compute fund (fees + km + meals + other) → Request fund | Queue → Open account → **Accept / Decline / Hold** → Compute (doc fees + km × rate + meals) → **Add other expenses with remarks; rates locked** → Request (one per account) → Required details CA / FT → Route to the matching Finance user. **No schedule step** |
| 6 | "Finance CA/FT: **Release**" → Receipt matches? → "Drop off at LTO, process, and pick up **on schedule date**" → No issue? → **"With issue: Reschedule or return to LA"** → Liquidate CA or confirm FT → Forward | "Finance: **Approve and release**" → **"Funds credited"** → Receipt matches? → Drop-off proof → Pick-up proof → No issue? → **"With issue: retry or return to LA"** → Update document status (Done) → Liquidate (2 working days) → **Finance verify liquidation** → Forward |
| 8 | Scan → Safekeeping → Fully paid? → Admin Closure → Records archive → Dispose | Same, plus **Archiver: storage hierarchy → generate QR, print label → QR opens record? → box to warehouse, mark Stored → box moved** |
| 9 | Check at interval → "MyLoans **updated_at newer**?" → re-run rules → Open Item → Sup/Head approves? → Apply | Check at interval (since = checkpoint − 5 min, 500 per page) → returns ANY status → **PN open in DMS?** → **ContentHash differs?** (no: save timestamp only) → compare and re-run rules → Open Item (notify holder and Sup/Head) → approve / reject (remarks, timestamp logged) |

**Recommendation:** treat the .docx charts as authoritative and retire the PNGs. Question Q1 in `FOUNDATION_CHECK.md` asks you to confirm this. The step tables below follow the .docx charts and note where a PNG differs.

---

## Chart 1. Loan file overview

| Step (chart) | Current DMS | Status | Evidence |
|---|---|---|---|
| Loan opened (LA) | Open loan file | ✅ | `lib/services/loan-file.ts` (`openLoanFile`) |
| Classified (automatic) | Rules 1–4 at open | ✅ (Rule 4 decimals ⚠️) | `lib/rules/index.ts`; `FOUNDATION_CHECK.md` E.1 #18 |
| Check documents (LA) | Checklist per transaction | ✅ | `lib/services/workflow.ts:121` |
| DP Processing (DP, Finance CA/FT) | DP jobs and funds | ⚠️ (see Charts 5–6) | `lib/services/jobs.ts`, `funds.ts` |
| LA Acceptance (receiving branch) | Receive package | ✅ | `jobs.ts:377-418` |
| Collateral (LA transmittal, Collateral receives) | Stage names only; vault steps only in the test simulator | ❌ | `lib/services/simulator.ts:212-236` |
| Quality Assurance | Stage-map entries marked "planned" | ❌ | `lib/workflow/stage-map.ts:89-94` |
| Digital Records | "planned" | ❌ | `stage-map.ts:95-96` |
| In Safekeeping (until fully paid) | Stage exists; nothing sets it outside the simulator | ❌ | `stage-map.ts:98` |
| Closure (Admin) | Stage name "Closed"; nothing sets `closedAt` | ❌ | `stage-map.ts:100` |
| Archived / Disposed (Records) | Stage names only | ❌ | `stage-map.ts:106-107` |
| Cancelled in myloans (any stage) | Close-as-cancelled from the myloans review | ✅ (to become an Open Item decision) | `lib/services/source-sync.ts:475-508` |

The current stepper uses the same 10 step names as this chart (`lib/workflow/stage-map.ts:25-36`). ✅

**Chart problems**

| # | Problem |
|---|---|
| P1.1 | The title says "10 stages" but the chart draws **12** boxes. Archived and Disposed are drawn as stages, while v2 §6.1 lists them after Closure. |
| P1.2 | **Closure contradiction:** Chart 1 / Chart 8 / §6.1 (safekeeping until fully paid → Closure → Archived) against §2.1 / §3.6 / §5.3 / §8 (Archiver → warehouse → **Stored = closed**, right after scanning). Your decision 6 resolves the intent: documents stay in the vault until fully paid, with "Processing complete" and "Loan closed/released". The charts and v2 text still need updating to match (see P8.1). |

---

## Chart 2. Open the loan file

| Step | Current DMS | Status | Evidence |
|---|---|---|---|
| LA: Search PN # | Find screen | ✅ | `app/(app)/search/page.tsx` |
| PN # format valid? No → message, myloans not touched | ✓ | ✅ | `lib/services/loan-file.ts:90-94, 111-112` |
| New to DMS? No → open the existing file, no duplicate | ✓ Plus a unique PN constraint and P2002 handling | ✅ | `loan-file.ts:117-124, 363-369`; `schema.prisma:623` |
| Get loan from myloans API (by PN) | ✓ (API-key HTTP, not OAuth) | ⚠️ | `lib/myloans/http-adapter.ts:41-50` |
| Found and **selectable** (Released, active, not superseded)? | Status 12 only; no active or superseded check | ⚠️ | `lib/myloans/status.ts:13, 33-36` |
| No → message (404 / 422 with status), no file | Status card / "not found" | ✅ (no 422 contract) | `loan-file.ts:146-156` |
| Save loan; store SourceUpdatedAt **and ContentHash** as the change baseline | `sourceUpdatedAt` saved but never compared; DMS hash in the snapshot | ⚠️ | `lib/myloans/account.ts:33`; `lib/myloans/changes.ts:116-118` |
| (v2 §10.4) PN # Search Log | none | ❌ | — |

**Chart problems**

| # | Problem |
|---|---|
| P2.1 | "New to DMS? → No → open the existing file" skips permission and branch scope. Today an out-of-branch PN shows a card with the borrower name hidden (`docs/workflow/09`). The chart should say so. |

---

## Chart 3. Classify the loan

| Step | Current DMS | Status | Evidence |
|---|---|---|---|
| Classify from product name (whole words; neither word = Refinancing) | ✓ | ✅ | `lib/rules/index.ts:55-64` |
| Financing → LA picks Undertaking and OR/CR | ✓ Preview card | ✅ | `lib/rules/index.ts:19-20` |
| Refinancing skips OR/CR | ✓ | ✅ | |
| Check loan type and amount: Mortgage? (≤ ₱500k New, ≤ ₱1M Renewal) | ✓ Thresholds hardcoded | ✅ (⚠️ not a setting) | `lib/rules/index.ts:25-28, 82-90` |
| Can't determine (other type, missing or invalid amount) | Type check ✓. **"1,000" and "1e6" are accepted; float comparison** | ⚠️ | `lib/myloans/data-check.ts:51-57` |
| Mortgage → auto Notary, For EDST, For Entry PPSR, Mortgage | ✓ | ✅ | `lib/rules/index.ts:200-202` |
| Not Mortgage → auto Notary, For EDST | ✓ | ✅ | same |
| **Optional transactions available** (Cancellation of Mortgage, Transfer of Ownership, Renewal of OR, PPSR Termination) | Custom types can be added by hand; no optional / unavailable matrix; the 4 types are not seeded | ❌ | `lib/services/workflow.ts:336` |
| Untransferred → Notary, For EDST only; save the Mortgage result | ✓ | ✅ | |
| AUTO_MORTGAGE_RULE / MANUAL_CORRECTION (`loans:correct_completed_steps`) | Override with `rules:override` (Admin) | ⚠️ (different key and role) | `lib/services/workflow.ts:675` |

**Chart problems**

| # | Problem |
|---|---|
| P3.1 | The footnote cites `prisma/seed-data.ts` and migration `20261005090000`. **Neither exists**: the seed is `prisma/seed.ts`, and all migrations were squashed into `20261119090014_baseline`. |
| P3.2 | Chart 3 is the only place that says Untransferred still runs Rule 4 "either result". It agrees with §4.3. OK. |

---

## Chart 4. Check documents and assign to DP

| Step | Current DMS | Status | Evidence |
|---|---|---|---|
| LA checks each transaction's own checklist; completes LA-only transactions | ✓ | ✅ | `workflow.ts:121, 363` |
| Missing → LA flags it with a required reason; can still assign | ✓ (reason plus 5–500 character remarks) | ✅ | `lib/services/papers.ts:99, 179` |
| Assign a DP per transaction, each with its own LTO location | ✓ | ✅ | `workflow.ts:521-633` |
| Each transaction keeps its own DP, LTO office, documents and status; several DPs per loan | ✓ `DpAssignment` | ✅ | `schema.prisma` (`DpAssignment`) |
| Sample checklists (8 types) | 4 types seeded, different papers | ⚠️ | `prisma/seed.ts:176-187` |
| LA TAT (1 working day, §2.2) | Counted from **release** ("Day 2") | ⚠️ | `lib/workflow/tat.ts:26-70` |

**Chart problems**

| # | Problem |
|---|---|
| P4.1 | **No start event for the LA's TAT.** §2.2 says TAT starts when a user accepts, but the LA never accepts at this stage (v2 C10). See question Q12. |

---

## Chart 5. DP accepts and requests funds

| Step (.docx) | Current DMS | Status | Evidence |
|---|---|---|---|
| DP: queue of assigned accounts (which documents can be processed now) | DP Home and Jobs list (per transaction, not per account) | ⚠️ | `components/jobs/dp-home.tsx` |
| Open account: name, transactions, documents | Job page per transaction | ⚠️ | `app/(app)/jobs/[id]/page.tsx` |
| Accept (date and time logged; DP TAT starts) | ✓ Server time; clock from accept | ✅ | `lib/services/jobs.ts:76-88` |
| Decline (remarks, back to LA) | ✓ | ✅ | `jobs.ts:142` |
| Hold (reason; "TAT hold logged"; accept when resumed) | Holds exist; the clock never pauses | ⚠️ | `lib/services/holds.ts:48-81` |
| Missing, not flagged by LA → return to the assigning LA with remarks | ✓ | ✅ | `lib/services/return-to-la.ts` |
| System computes expense per document and account total (doc fees + km × rate + meals) | **No formula.** Expense kinds with suggested / max amounts | ❌ | `lib/services/funds.ts:126`; `CashAdvanceRule` |
| Add other expenses with remarks; computed rates locked | Kinds can be added; nothing is locked | ⚠️ | |
| Request fund CA / FT; **one per account** | One request per DP covering several lines and PNs | ⚠️ | `funds.ts:126-206` |
| Required details (CA: amount, date, needs; FT: amount, payee, account last 4) | FT last 4 is entered by Finance at release | ⚠️ | `docs/workflow/05-funds.md` |
| Route to the matching Finance user; status Fund Requested | One Finance role holds both types; plus approval bands | ⚠️ | `lib/auth/permissions.ts:401-404` |
| **(PNG only) "Set schedule date; group PN #"** | Not built | ❌ | — |

**Chart problems**

| # | Problem |
|---|---|
| P5.1 | **"Set schedule date; group PN #"** is in the PNG / sheet edition only. It is in no v2 text section, status or table, and the .docx Chart 5 dropped it. Decide whether it exists (Q1). If it does, "group PN #" conflicts with "one fund request per account". |
| P5.2 | **"One fund request per account" vs several DPs per loan file** (Chart 4). If one loan file has two DPs, whose request covers "the account"? It only works if "account" means one DP's share of the PN. |
| P5.3 | **"TAT hold logged"**: it is unclear whether a hold pauses the clock (Q13). |

---

## Chart 6. Funds and LTO processing

| Step (.docx) | Current DMS | Status | Evidence |
|---|---|---|---|
| Finance (CA or FT user): approve and release with reference #, amount, last 4 (FT) or voucher (CA) | Approve, then release; reference and last 4 required; bands | ⚠️ | `funds.ts:305, 389` |
| "Funds credited" with the date | Released status | ⚠️ (label) | |
| DP receipt matches (ref #, amount, last 4)? | **Not built** | ❌ | — |
| No → Fund mismatch to Finance and Admin; DP cannot start LTO | Not built (LTO is blocked until **released**, not until confirmed) | ❌ | `jobs.ts:177`; setting `funds.blockLtoUntilFunded` |
| Drop off at LTO; upload proof (photo or receipt), timestamped | Stage evidence fields (date, office, OR #); file evidence possible; **no viewer link** | ⚠️ | `lib/services/job-stages.ts:137-191` |
| Process, pick up, upload proof, timestamped | Same | ⚠️ | |
| No issue found? No → With issue: retry or return to LA | Problems and return to LA exist; no "With issue → retry" state | ⚠️ | `jobs.ts:511`; `return-to-la.ts` |
| Update each document's status (Done) | Check and verify stage per paper | ✅ | `job-stages.ts:191` |
| Liquidate CA (OR #, actual, **within 2 working days**) or confirm FT | Receipts; due **10 business days after release**; FT itemized like a CA | ⚠️ | `lib/settings.ts:46`; `funds.ts:608` |
| Finance verifies; excess returned or shortage reimbursed | Return of cash plus Finance confirm; shortage not computed | ⚠️ | `funds.ts:629-668` |
| Forward package to the LA branch | ✓ (needs Check and verify; **not** gated on liquidation) | ⚠️ | `jobs.ts:342-364` |
| Unliquidated CA past the deadline → no new CA | Blocked only while **overdue**, with a Finance exception | ⚠️ | `funds.ts:166-172, 671` |
| Late fund release counted against Finance | No per-user TAT | ❌ | |

**Chart problems**

| # | Problem |
|---|---|
| P6.1 | **Approve vs no approval:** the box says "Approve and release", but v2 §3.5 / §5.7 / §8 have no approval status (v2 C5). |
| P6.2 | **"Reschedule"** (PNG) vs **"Retry"** (.docx / §6.2). There is no reschedule-date field anywhere (v2 C7). |
| P6.3 | **Finance "verify liquidation" sits before Forward.** That makes the DP's forward wait on Finance, yet the TAT text says delays caused by Finance count against Finance only for release. Who owns the clock while Finance verifies? |
| P6.4 | "Only accounts with approved and credited funds can be processed": this contradicts LA-only and no-funds transactions (e.g. Notary with no cash needed). Today funds are optional per transaction (`funds:flag`). |

---

## Chart 7. Transmittal and Quality Assurance

| Step | Current DMS | Status | Evidence |
|---|---|---|---|
| LA accepts package (receiving branch) | ✓ Receive: Complete / Incomplete | ✅ | `jobs.ts:377-418` |
| Missing documents in package → LA flags them, still proceeds | "Incomplete" sends it back to the DP; confirm papers back | ⚠️ (different path) | `jobs.ts:386-400`; `workflow.ts:487` |
| LA fills the transmittal form (courier, tracking #, delivery mode) | `Transmittal` table unused; no fields for courier, tracking or delivery mode | ❌ | `schema.prisma` (`Transmittal`) |
| Collateral receives by scan; checks tracking # | Simulator only | ❌ | `lib/services/simulator.ts:212-236` |
| Matches transmittal? No → not received or not found; last holder resolves | Not built | ❌ | |
| QA checks documents | Not built (`QaFinding` unused) | ❌ | |
| QA findings → holder corrects, QA re-checks, demerits may apply | Not built | ❌ | |

**Chart problems**

| # | Problem |
|---|---|
| P7.1 | **"Receive by scan": scan what?** v2 has QR codes only for archive boxes. Labels were removed on 11 Nov (`docs/workflow/09` #67). A per-document or per-transmittal barcode is needed for "receive by scan" to mean anything. |
| P7.2 | **Who a QA finding goes back to:** "holder corrects" (Chart 7), "return to Custodians with findings" (§7 QA row) and "responsible user corrects" (§6.4) disagree. |
| P7.3 | **Vault / QA / scan order:** Chart 7 is Collateral → QA, then Chart 8 is Scan → Safekeeping. §8 is In Vault → QA → Scanning → Archiving. §6.3 is Collateral → QA → Scanned → **In vault** (v2 C2). |

---

## Chart 8. Safekeeping to disposal (with QR archive)

| Step | Current DMS | Status |
|---|---|---|
| Digital Records: scan and upload (record the scan reference) | Not built (`DigitalRecord` unused) | ❌ |
| Collateral: in safekeeping (box, shelf) | Stage name only | ❌ |
| Fully paid, no open exceptions? No → resolve open exceptions | "Resolve open exceptions" next-step text exists (`lib/workflow/stage-map.ts:111, 141`); no fully-paid signal | ❌ |
| Admin: Closure | Not built | ❌ |
| Archiver: storage hierarchy; generate QR; print label; QR opens the record? | Not built (QR removed 11 Nov) | ❌ |
| Mark Stored (transaction closed); box moved → location history | Not built | ❌ |
| Records: keep until retention ends → dispose | `RetentionRule` / `DisposalBatch` unused | ❌ |

**Chart problems**

| # | Problem |
|---|---|
| P8.1 | **Closure contradiction (v2 C1).** The chart puts the Archiver and "mark Stored (transaction closed)" **after** Admin Closure, but §2.1 / §3.6 / §5.3 close at Stored right after scanning. Your decision 6 keeps documents in the vault until fully paid. That still leaves two points to settle:<br>• "Processing complete" should replace "Stored (Closed)" as the end of the processing flow.<br>• "Loan closed/released" follows full payment. The archive steps then belong after it. |
| P8.2 | **Two location records:** "Collateral: in safekeeping (box, shelf)" before closure, then "Archiver: record storage hierarchy … box" after closure. Is the vault box the same box as the archive box? |
| P8.3 | **No source for "fully paid":** the v2 API lists have no paid-off status or date. |
| P8.4 | **Vault pull-out / retrieval is out of scope (v2 §1.5)**, but §6.3 says documents are "released … after the loan is fully paid", which needs a release step. Per your decision 7, vault pull-out is deferred, not dropped. |

---

## Chart 9. myloans change review

| Step | Current DMS | Status | Evidence |
|---|---|---|---|
| Change check at the set interval (since = checkpoint − 5 min; 500 per page) | Polls each PN by tier; external cron; no checkpoint feed in live mode | ⚠️ | `lib/myloans/live-mapping.ts:18`; `source-sync.ts:844-940` |
| API returns changed loans of ANY status | Poll returns the loan regardless of status | ✅ (per PN) | |
| PN open in DMS (not Stored or Cancelled)? No → ignore | Tiers stop at Closed / Archived / Disposed / Cancelled | ✅ | `lib/myloans/tiers.ts:12` |
| ContentHash differs? No → **save the new SourceUpdatedAt only** | Hash compared (DMS-computed); the timestamp is **not** saved in that case | ⚠️ | `source-sync.ts:821-828, 914` |
| Compare monitored fields; re-run rules on new data | ✓ `detectChanges` plus `proposeEffect` | ✅ | `lib/myloans/changes.ts:129-204` |
| Open Item: old vs new per field and what would change; notify holder and LA Sup/Head | Review item per loan (JSON list of fields); notifies reviewers by permission. **Minor fields auto-applied** | ⚠️ | `source-sync.ts:193-207, 280-318` |
| LA Supervisor/Head approves? | Admin (material, status, replacement); Admin, Finance or SUP (borrower) | ⚠️ | `lib/auth/permissions.ts:100-101, 407-433` |
| Yes → apply; update SourceUpdatedAt and hash; sent / in-process transactions never change | Apply ✓; in-process transactions protected ✓ | ✅ | `source-sync.ts:371-441` |
| Rare: becomes Financing → pick Undertaking and OR/CR before Apply | ✓ | ✅ | `components/loan/source-review.tsx` |
| No → keep DMS data; remarks and myloans timestamp logged | Keep current with a required note ✓; **myloans timestamp not logged** | ⚠️ | `source-sync.ts:444-456` |
| Checkpoint = maxSourceUpdatedAt after the last page; a failed run keeps the old one | n/a (no feed) | ❌ | |
| Every run in the myloans Sync Log | Last 10 runs in a setting plus audit rows; no table or report | ⚠️ | `lib/settings.ts:38-42` |
| Cannot mark Stored with an unresolved Open Item | No Stored step | ❌ | |

**Chart problems**

| # | Problem |
|---|---|
| P9.1 | Chart 9 tests only "ContentHash differs?", while §3.2 says "timestamp newer **and** hash differs". With API 2 the "since" filter makes the timestamp test implicit; with polling (today), the timestamp check must be explicit. |
| P9.2 | **"PN # open (not Stored or Cancelled)"** needs updating for decision 6: should "open" now mean "not Loan closed/released"? Loans in safekeeping can wait years for full payment. Checking them every 30 minutes for years multiplies the API load. |

---

## Chart 9b. Sample scenarios after approval

| Scenario | Current DMS | Status |
|---|---|---|
| A. Mortgage → Not Mortgage: unsent PPSR / Mortgage cancelled; sent ones continue with an exception for LA | ✓ Apply removes unsent transactions; sent ones are kept and the LA is told | ✅ (`source-sync.ts:371-441`) |
| B. Not Mortgage → Mortgage: PPSR / Mortgage added as Open (Transferred); Untransferred saves the result only | ✓ | ✅ |
| C. Untransferred → Transferred | — | ⚠️ see P9b.1 |
| D. Financing → Refinancing: OR/CR transaction cancelled if not sent | ✓ Rules re-run | ✅ |
| E. Data correction only (borrower name, plate #, engine #) | Borrower: review ✓. Plate / engine: **auto-applied** as minor, and not supplied by live myloans | ⚠️ |
| F. Change while at LTO: in-process transaction keeps old values; reminder | ✓ Protected | ✅ |
| G. No longer Released: loan file goes **On Hold**; LA Head decides return / close / continue | Status review by **Admin**: close as cancelled, keep, ask for cash back. **No loan-level On Hold** | ⚠️ |
| H. Newer change while pending: older item **Superseded**, new item shows the latest values | Updated in place, history kept; no Superseded status | ⚠️ |

**Chart problems**

| # | Problem |
|---|---|
| P9b.1 | **Scenario C cannot come from myloans.** OR/CR Transferred is the **LA's pick** on the preview card (§4.3, glossary), not a myloans field. No v2 API returns it, so a myloans change cannot raise it. |
| P9b.2 | **Scenario E uses plate # and engine #,** which no v2 API (1–5) returns (`docs/myloans/field-map.md:61`: "not in this query"). |
| P9b.3 | **Scenario G's "On Hold"** is not in the §8 status list (only "On Hold (DP)") (v2 C9). |
| P9b.4 | **Scenario H's "Superseded"** is not in the §12.2 OpenItems StatusCode list (PENDING / APPROVED / REJECTED) (v2 C8). |

---

## Summary of chart problems to resolve

| # | Problem | Suggested fix |
|---|---|---|
| 1 | Two editions of the charts (PNGs older) | Use the .docx edition; retire the PNGs (Q1) |
| 2 | Chart 5 "set schedule date; group PN #" (PNG only) | Drop it, or define it with its own status and fields (Q1) |
| 3 | Closure contradiction (C1) and the Chart 8 archive order | Decision 6: "Processing complete" ends the flow, documents stay in the vault, and "Loan closed/released" follows full payment. Update §2.1 / §3.6 / §5.3 / §8 and Charts 1 and 8 to match (Q15) |
| 4 | Vault / QA / scan order (C2) | Pick one order; I suggest Collateral → QA → Digicur → vault (Charts 1 and 7–8) |
| 5 | Chart 1 says "10 stages" but shows 12 | Retitle |
| 6 | Chart 3 footnote cites files that no longer exist | Update to `prisma/seed.ts` |
| 7 | LA TAT has no accept event (C10) | Q12 |
| 8 | Hold vs TAT | Q13 |
| 9 | One fund request per account vs several DPs | Define "account" as one DP's transactions on one PN |
| 10 | Approve vs no approval for Finance (C5) | Remove "approve" from Chart 6 or add it to §8 |
| 11 | Reschedule vs Retry (C7) | Use Retry (the .docx edition) |
| 12 | Finance verification blocks the DP's forward | State who owns the clock during verification |
| 13 | "Receive by scan" with no document barcode | Decide what is scanned |
| 14 | Who receives a QA finding | Pick one of: holder / Custodian / responsible user |
| 15 | Chart 9 timestamp test; "open" PNs under decision 6 | Explicit timestamp test while polling; stop or slow checks once "Processing complete" (Q11) |
| 16 | 9b-C (OR/CR) and 9b-E (plate / engine) are not myloans fields | Remove or reword those scenarios |
| 17 | 9b-G On Hold and 9b-H Superseded are missing from the status lists | Add them to §8 and §12.2 (Q8) |
