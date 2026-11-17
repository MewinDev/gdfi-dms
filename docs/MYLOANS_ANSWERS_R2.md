> Saved from `docs/incoming/myloans-round2/myloans-reply-round-2.md` (17 Nov 2026). Real-looking PN # values replaced with `<SAMPLE-PN>`. The SQL files are in `docs/myloans-api-contract.sql` and `docs/myloans/`.

# myloans reply to the DMS team (round 2)

Date: 17 November 2026 (PHT)
Re: "Reply to the myloans team (round 2)", 16 Nov 2026
Files:
- `myloans_api_query.sql`: the API query, round 2 version
- `myloans_hash_test_vectors.sql`: hash test vectors (fake data)
- `myloans_round2_checks.sql`: read-only checks behind the open items
- `myloans_unique_indexes_FOR_DBA.sql`: index changes, pending DBA approval

---

## The four changes you asked for

### 1. `ReplacedByExternalLoanId` is in the ContentHash. Done.
- It's field 18, the last one. The hash now has 18 fields.
- A cancelled-then-redone loan now changes its hash twice: once when it is cancelled, and again when the replacement appears.
- **A loan redone twice:**
  - Example: transaction 11236 was replaced by 11634, which was itself replaced by 14009.
  - The middle copy (11634) changes its own code when it is replaced, so it comes through API 2 with the newest `ReplacedBy…`.
  - The oldest copy (11236) is not re-sent, because nothing on its own row changes.
  - The DMS can follow the chain through the CIN.

### 2. FeedState has 5 values. Done.
The header and the column comment now list all five, in the order they are decided (the first match wins):

1. `Cancelled`: status 14
2. `Superseded`: code longer than 20 characters
3. `NotReleased`: status other than 12
4. `Inactive`: `is_active` = 0
5. `Released`: everything else. This is the only selectable state.

In API 2 you'll only ever see `Cancelled`, `Superseded`, `Inactive` and `Released`, because API 2 returns ever-released loans only. API 1 can also return `NotReleased`.

### 3. `@AfterId` is bigint. Done.
- `ExternalLoanId` and `ReplacedByExternalLoanId` are also returned as bigint.
- **Index on `Transactions.application_code`: to confirm.**
  - Check R2-1 lists the indexes on `Transactions`.
  - If there is none, `myloans_unique_indexes_FOR_DBA.sql` (item 3) adds it, subject to DBA approval.

### 4. Duplicates. Option (b) is built in; option (a) is ready for the DBA.
**(b), done differently from PageSize + 1:**
- Pages are now cut **by loan, not by row**. Each distinct `ExternalLoanId` gets a `PageRank`, and a page holds the first `@PageSize` loans after `@AfterId`.
- If a loan ever comes back as two rows, both rows are always on the same page.
- `RowsForThisLoan` > 1 flags the duplicate.
- **API 1 no longer stops at 2 rows.** It returns every row for the PN #.
- A page can therefore hold more than `@PageSize` rows, but never more than `@PageSize` loans.

**(a):**
- `myloans_unique_indexes_FOR_DBA.sql` creates filtered unique indexes on `LOANS.CIN` and `Transactions.pn_no`.
- Our earlier checks covered released loans only. **Check R2-2 must show 0 duplicates across the whole table first.**
- This script changes the database. It needs myloans approval and a change ticket, and the DBA runs it.

---

## Your answers

### A7.3 Financing vs Refinancing (keywords in the product name)
Noted. The loan query needs no change.

### Birth date (D2, HMAC in the API)
Agreed. `BirthDate` is returned by the query only for the API code to hash, and is dropped before the JSON.

---

## Required before go-live

### API 5: products
- **Product list now:** check R2-3 returns the full `PR_PRODUCTS` table. We'll send it as a CSV.
- **API 5:** agreed, using `ProductID`, `ProductCode`, `Name`, an active flag and `UpdatedAt`.
  - The exact column names for the active flag and update time come from R2-3. We'll write the API 5 query once we have them.
  - If `PR_PRODUCTS` has no update-time column, "since" can't work. Then API 5 returns the full list every time; the table is small.
- **Not recommended:** adding `ProductName` to the ContentHash. One product rename would re-send every loan of that product.

### Paid / closed status and date: still open
- We haven't found where myloans records "fully paid". `TransactionStatuses` has 50 "Closed", but no transaction used it on 16 Nov.
- Check R2-4 searches both databases for paid, closed, balance and settlement columns.
- Once we know the source, we'll add it to API 1, API 2 and the hash. Adding a hash field means a one-time re-baseline, so it's best done before freezing.
- Your three questions are open until then: the status values, the date and its time zone, and whether a loan can be re-opened.

---

## Still open

| Ref | Status |
|---|---|
| A4 Hard deletes | **Open.** The transaction tables have no soft-delete column, so a hard delete would be invisible to API 2. Waiting for the myloans developers. |
| A5 Released amount | **Open.** Waiting for myloans to confirm. The amount will be sent as a string. |
| C1 Timing | Check R2-6: three timed runs (API 2 page, Pool, API 1). If API 2 is slow, we'll add the pre-filter. |
| C2 Limits | **Open** (infrastructure). |
| C5 Credentials | **Open** (infrastructure). |

**Empty page and next-page marker.** Proposed JSON:

```json
{ "runStartedAt": "2026-11-17T12:00:00.1234567+08:00",
  "items": [ { "externalLoanId": 51164, "...": "..." } ],
  "nextAfterId": 51164 }
```

- **Full page** (`@PageSize` loans): `nextAfterId` = the largest `externalLoanId` on the page.
- **Short last page:** `nextAfterId` = `null`.
- **Empty page:** `"items": []` and `"nextAfterId": null`.
- **Exactly full last page:** `nextAfterId` is set, and the next call returns an empty page.
- `runStartedAt` comes from page 1, and the DMS keeps it for the whole run.

**API 1 response codes.**

| Response | When |
|---|---|
| **404** | No row for the PN # |
| **422** | No selectable row. The body has `TransactionStatusId`, `FeedState`, `ReplacedByPNNo` |
| **200** | Exactly one selectable row |
| **409** | More than one row for the PN # (only possible without the unique index). The body has all rows, so the DMS can log them |

**API 3: dropped.** The DMS refresh button calls API 1 for that PN #. API 1 returns the loan in any state, so a refresh also shows a cancellation or a redo.

**Hash test vectors.**
- `myloans_hash_test_vectors.sql` builds three fake loans through the same formula:
  1. a released loan with "ñ" in the name and no suffix;
  2. a renewal stored in UTC;
  3. a cancelled loan that was redone.
- It returns the exact `HashInput` text and the `ContentHash` for each. We'll send the output.
- **For your mock:** the hash is SHA-256 over the **UTF-16LE** bytes of `HashInput` (SQL `nvarchar`), not UTF-8. Empty (NULL) fields are empty text between the `|` separators.
