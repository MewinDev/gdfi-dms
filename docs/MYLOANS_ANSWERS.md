<!--
  Saved by the DMS team, 16 November 2026 (PHT), from docs/incoming/myloan-answers.md.
  Agreed target, reference only. One change from the original: real-looking PN #s were replaced by
  <SAMPLE-PN>, <SAMPLE-PN-A> (old PN of a redo pair) and <SAMPLE-PN-B> (new PN of the pair).
  The query these answers describe: docs/myloans-api-contract.sql.
-->

# Answers: Questions for the myloans team

Date: 16 November 2026 (PHT)
Re: "Questions for the myloans team" (16 Nov 2026)

These answers come from checks run against the live MYLMSDB and MYLOSDB databases on 16 Nov 2026, and from the API query as it stands now (`myloans_api_query.sql`). Items marked **Still open** need the myloans team or infrastructure to answer.
---

## Changes after review (16 Nov, 22:36)

The query (`myloans_api_query.sql`) was updated after a review of these answers. Where this section and an answer below disagree, this section wins.

1. **API 2 scope reversed.** API 2 now returns changed loans in **any status, as long as they were ever released** (they have a ReleaseDate). Each row carries `FeedState` (Released / Cancelled / Superseded / Inactive) and `IsSelectable`.
   - Why: API 2 is a change feed. With "active only", a cancelled loan and an unchanged loan both just don't appear, so the DMS can't raise the "cancelled" Open Item or block Forward.
   - Never-released transactions (about 18,000) are still never returned.
   - **Selecting a loan in DMS is unchanged:** only `IsSelectable` = 1 (active, released) can be picked by LA.
2. **Link on the base CIN.** The DMS links loans on `CIN` (`LEFT(application_code, 20)`), which survives a redo. Superseded rows now carry `ReplacedByExternalLoanId` and `ReplacedByPNNo`. This feeds the "myloans record replaced" Open Item, and lets API 1 say "replaced by GD…".
3. **Paging built in:** `@AfterId`, `@PageSize`, `ORDER BY ExternalLoanId`, fixed `@Since`. Every row carries `RunStartedAt`. Checkpoint = page 1's `RunStartedAt` minus 5 minutes.
4. **Hash trimmed.** The hash now covers only fields DMS shows or uses, plus `FeedState`, so a redo or cancellation always changes it. Dropped: `TitleId`, the PDC row count and the LoanComputations row count.
5. **Birth date.** The API computes `BirthDateHash` = HMAC-SHA256 with a key in the API config, and **drops BirthDate from the JSON**. The birth date stays inside the hash, so a correction still changes `ContentHash`. `BirthDateHash` tells the DMS which field changed.
6. **Empty name parts are sent as NULL.**
7. **Go-live cutoff (`@ReleasedSince`).** The branch pool shows only selectable loans released on or after the go-live date. Older loans enter DMS through the PN # search. This avoids dropping about 13,000 historical loans into the pools on day one. **Decision needed:** the cutoff date.

---

## 0. The contract and the query don't match yet

The questions refer to `docs/myloans-api-contract.sql`. The query we tested differs from it in these places:

| Contract (per the questions) | Tested query |
|---|---|
| `IsSuperseded` flag, "Mode A" | `IsSelectable` flag (1 = released, active, not superseded); `@PNNo` mode |
| NULL marker `~` in the hash | `CONCAT`, which turns NULL into an empty string (so NULL and `''` hash the same) |
| `application_code` in the hash | Not in the hash |
| Paging with `T.id > @AfterId`, `maxSourceUpdatedAt`, `nextCursor` | No paging; one result set per call |

**Action:** pick one version before go-live. The answers below describe the tested query.

---

## A. Data shape

### A1. One LOANS row per CIN?
- **Yes today, but not enforced.** No CIN linked to a released transaction has more than one `LOANS` row.
- `LOANS` has no unique index on `CIN`. Its unique keys are `LoanID` (primary key) and (`cifNo`, `ProductID`, `Amount`, `UQ`, `IsActive`). So a second row for the same CIN is possible in future.
- **Keep the DMS safeguard you described:** a repeated `ExternalLoanId` in one run is logged and alerted, and no Open Items are raised from it.
- The join uses the **full** `application_code`, so the old "x<timestamp>" copies can't match the live loan's LOANS row any more.

### A2. One BORROWERS row per cifNo?
- **Yes, and enforced.** `cifNo` is the primary key of `BORROWERS` (`PK__Borrowers`), so it can't repeat.

### A3. Superseded copies
1. **The old id becomes the superseded copy, and a new id is the live one.**
   - In all 15 cases found, the lower (older) `Transactions.id` got the suffix. Example: 2661 became `…0028x20260408135340`, and 3309 is live.
   - The suffix timestamp matches the time the new transaction was created.
   - **So yes, the DMS must re-link.** The stable link is the base CIN, `LEFT(application_code, 20)`, which stays the same across the redo.
2. **The PN # differs.** All 15 pairs had different PN #s. Example: 2661 has <SAMPLE-PN-A>, and 3309 has <SAMPLE-PN-B>.
   - So searching by PN # returns the copy that PN # belongs to. Searching an old PN # returns the superseded row with `IsSelectable` = 0, `FeedState` = Superseded and `ReplacedByPNNo`, so the API can answer "replaced by GD…".
3. **Not needed.** No `pn_no` appears on more than one transaction (checked across all transactions on 16 Nov), so a PN # search returns at most one row.
   - There's no proof a unique index enforces this, so the DMS should still pick the `IsSelectable` = 1 row and log a warning if two ever come back.
- **Related: cancellation.** A released loan can be cancelled (status 14) and then redone. Example: transaction 51164 was cancelled at 13:22 on 16 Nov, its code got a suffix at 13:42, and a new transaction was created.

### A4. Hard deletes
- **Still open.** We found no evidence of deletes. MyLoans uses status 14 (Cancelled), `is_active` = 0, and the code suffix to retire a transaction.
- `Transactions`, `LoanComputations` and `TransactionPdcDetails` have no soft-delete columns (no `deleted_at` or similar). So if a row is ever removed, it's a hard delete.
- Deleted *child* rows (PDC, loan computations) show up only if they change the amount or release date, since the row counts are no longer in the hash.

### A5. TotalLoanAmount
1. **Still open.** It's `SUM(LoanComputations.total_loan_amount)`. Example: PN # <SAMPLE-PN> returns ₱219,590.00. The myloans team must confirm this is the released amount the Mortgage rule needs.
2. **Every active released loan has exactly one LoanComputations row** (13,083 loans, checked 16 Nov). So the SUM is just that row's value. Keeping the SUM is harmless: a second row would change the amount, which is in the hash.
3. **Format.** SQL returns a decimal with 2 decimals, for example `219590.00`. The API should send it as a string to avoid rounding errors.

### A6. Status codes
Full list from `TransactionStatuses`. These are the ones that appear on transactions:

| Id | Name | Transactions | With release date |
|---|---|---|---|
| 1 | Create Schedule | 373 | 0 |
| 2 | For Warehousing | 80 | 0 |
| 3 | For Posting | 2,299 | 0 |
| 4 | For Approval (PDC Received) | 52 | 0 |
| 8 | Check Prepared | 11,302 | 0 |
| 11 | For Approval (Loan Released) | 5 | 0 |
| **12** | **Loan Released** | 13,020 | 13,020 |
| 13 | For Approval (Pre-Posted) | 1,655 | 0 |
| **14** | **Cancelled** | 31 | **21** |
| 15 | Available (description: "Disbursement Check") | 18,704 | 0 |
| 49 | Check Assignment (Transaction) | 85 | 0 |

- **Cancelled = 14.** 21 of those 31 were released first.
- **"No longer released"** has three causes: status 14, `is_active` = 0, or a suffixed code.
- **Reversed (see "Changes after review").** API 2 returns ever-released loans in any status, so a cancellation, deactivation or redo arrives as a change with its `FeedState`.
- **Statuses 15–19:**
  - Statuses 15–19 are disbursement-check statuses in the shared status table; 18 is a different "Cancelled".
  - Only 15 appears on transactions, and none of those has a release date, so treating it as "not released" is correct.
  - **Still open:** why 18,704 transactions carry a disbursement-check status.

### A7. Names and loan type
1. **Mostly New or Renewal, but it can be NULL.**
   - LoanType comes from `LOANS.LoanClass` → `PR_REFERENCES` (typeID 50): Code 7 = New, Code 8 = Renewal.
   - `LOANS.ClassId` is not the loan type: it's 309 "New" on every loan.
   - **Every active released loan is New or Renewal today:** 10,411 New and 2,671 Renewal, none empty.
   - 56 LOANS rows have no `LoanClass`, but none of them belongs to an active released loan. Nothing in the database prevents it, so the DMS should still treat an empty value as "can't classify" and alert, not refuse the loan silently.
2. **Both NULL and empty occur in MiddleName.**

   | | NULL | Empty (`''`) |
   |---|---|---|
   | MiddleName | 260 | 157 |
   | Suffix | 19,333 | 0 |

   - The hash treats NULL and `''` the same, so switching between them doesn't raise an Open Item.
   - **Suggestion:** the API sends both as JSON `null`, so the DMS doesn't show a false difference.
3. **Correct, a product rename doesn't show in API 2.** Only `ProductCode` is in the hash.
   - If the DMS classifies Financing vs Refinancing **from the product name**, API 5 must cover renames. **Still open:** whether API 5 will exist.
   - **Still open:** confirm with the myloans team that the product name really is the source of the Financing classification. No MyLoans field for it has been found yet.

---

## B. ContentHash

### B1. Encoding
- **Fixed in the query:** `ContentHash` now comes out as **64 lowercase hex characters, no `0x`**, via `LOWER(CONVERT(char(64), HASHBYTES(...), 2))`. The API passes it through as a string, unchanged.

### B2. Stable formula
- The current field list, in order, separated by `|`:
  1. `FeedState`
  2. `pn_no`
  3. status
  4. `is_active`
  5. `cifNo`
  6. FirstName
  7. MiddleName
  8. LastName
  9. Suffix
  10. BirthDate (style 126)
  11. `LoanID`
  12. `LoanClass`
  13. `CompanyName`
  14. TotalLoanAmount
  15. ReleaseDate (in +08:00, style 126)
  16. `ProductCode`
  17. `BranchID`
- **NULL becomes empty text, not `~`** (see section 0).
- **Fix made:** ReleaseDate is now converted to +08:00 before hashing, into `varchar(40)`. Before, it went into `varchar(30)`, which can cut off the time-zone part, and the same instant stored as +00:00 or +08:00 could hash differently.
- **Amounts:** the same decimal value always gives the same text (`219590.00`) as long as the column type doesn't change. A change to the column's type or scale would change every hash.
- **Agreed rule:** freeze the formula at go-live. Any change goes through the DMS team first, together with a one-time re-baseline that doesn't raise Open Items.

### B3. Hash covers fields the DMS can't see
- Fields in the hash but not shown in the DMS are now only `LoanID`, `LoanClass` (the DMS sees the name instead) and BirthDate (identified through `BirthDateHash`).
- **The proposed handling is reasonable:** a generic "Changed in myloans: field not shown in DMS" Open Item.
- **Done:** `TitleId` and both row counts are out of the hash (see "Changes after review").

### B4. BirthDateHash
- **Possible.** For example: `HASHBYTES('SHA2_256', CONCAT(@BirthDateSalt, CONVERT(char(10), B.BirthDate, 23)))`, with the salt kept in the API's configuration, not in SQL.
- **Decided:** a keyed hash (HMAC-SHA256) computed in the API code, with the key in the API config. The query returns `BirthDate` only so the API code can do this, and the API must drop it before writing the JSON.

---

## C. Performance, limits, availability

### C1. Cost
- **Still open:** measured time. Run the API query with `SET STATISTICS TIME ON` for a full load and for a 30-minute window.
- **What to expect from today's data:**
  - About 550 loans a day get a newer `SourceUpdatedAt`.
  - About 520 of those are a background job: about 470 in bursts at 07:02–07:04, 08:50–09:03 and 12:05–12:06. It writes `Transactions.updated_at` with no audit-trail entry and no data change.
  - The hash filters these out on the DMS side, but they still come back from API 2.
- **Suggested improvement:**
  - First pick the candidate transaction ids with a UNION of simple `updated_at > @Since` filters on each of the five source tables. These can use indexes on `updated_at`.
  - Then run the full query only for those ids.
  - That avoids computing every loan on each call.

### C2. Rate limits, timeouts, maintenance
- **Still open** (myloans team / infrastructure).

### C3. Paging
- **Duplicates:** none today. BORROWERS can't repeat; LOANS could in future (see A1), so keep the DMS check.
- **Suggested design:**
  - Keep `@Since` fixed for the whole run and page by id: `ORDER BY T.id`, `WHERE T.id > @AfterId`.
  - Don't page by `SourceUpdatedAt`: a loan updated during the run would move between pages.
- **Checkpoint:** use the **API server time at the start of the run, minus about 5 minutes**, not `maxSourceUpdatedAt`.
  - A change that commits late can carry a timestamp earlier than the run's maximum and would be skipped.
  - Rows repeated because of the overlap are harmless: their hash is unchanged.
- **Built into the query:** `@AfterId` / `@PageSize`, and every row carries `RunStartedAt`. A page with fewer rows than `@PageSize` is the last one. An exactly-full last page is followed by an empty page.
- Empty page format and `nextCursor`: **Still open** (API design).

### C4. First load
- **Use `@ReleasedSince` with a go-live cutoff** instead of a full first load. It returns selectable loans released on or after the date, for the branch pool. Older loans enter through the PN # search.
- A call with no PN #, `@Since` or `@ReleasedSince` returns nothing, by design.
- **Decision needed:** the cutoff date.

### C5. Authentication, environments, IP allowlist
- **Still open** (myloans team / infrastructure).

---

## D. Birth date

- The decision belongs to the project owner.
- **Decided: D2, with the keyed hash made inside the API** (B4). The birth date never leaves myloans, and a correction is still flagged.

---

## E. What to chase first with the myloans team

1. **API 2 scope change:** any status, as long as the loan was ever released, with `FeedState`, `IsSelectable` and `ReplacedByPNNo` (see "Changes after review").
2. **A7.3:** which field drives Financing vs Refinancing, and whether API 5 will exist. This blocks LA classification.
3. **A5:** confirm TotalLoanAmount is the released amount.
4. **A4:** whether hard deletes happen.
5. **C1, C2, C5:** timings, limits, credentials.
6. **Section 0:** agree on one contract (NULL marker, paging, flags).
7. **Decide:** whether myloans adds a unique index on `LOANS.CIN` (A1) and on `Transactions.pn_no` (A3). Today both are unique in the data but nothing enforces it.

**For the project owner:** the go-live cutoff date for `@ReleasedSince`.