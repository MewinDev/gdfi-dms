# Reply to the myloans team (round 3)

Date: 17 November 2026 (PHT)
Re: "myloans reply to the DMS team (round 2)", 17 Nov 2026

Thank you for the quick and thorough round 2.

## Accepted

- **All four changes are accepted:** `ReplacedByExternalLoanId` in the ContentHash (field 18), FeedState with 5 values, `@AfterId` as bigint, and the duplicate handling.
- **Paging by loan is accepted.** We follow your JSON exactly: `{ runStartedAt, items, nextAfterId }`, `nextAfterId` null on the last page, an empty page as `items: []` with null, and page 1's `runStartedAt` kept for the whole run.
- **API 3 dropped:** agreed. Our Refresh button calls API 1.
- **API 5:** agreed. If `PR_PRODUCTS` has no update-time column, send the full list every time; we detect renames by `ProductID`.

## Unique indexes (`myloans_unique_indexes_FOR_DBA.sql`)

1. **Filters:** please use `WHERE pn_no IS NOT NULL AND pn_no <> N''` (and the same for `CIN`). With `IS NOT NULL` alone, several rows with empty text would break the unique index.
2. **Before adding them,** the myloans **developers** should confirm that no code path ever writes a duplicate `pn_no` or `CIN`. A unique index makes myloans itself raise an error on such a write. Please test in UAT first.
3. Since paging by loan already protects the DMS from duplicates (we alert and skip that loan), **the two unique indexes are optional** for us.
4. **The `application_code` index (item 3) is recommended:** it speeds up the "replaced by" lookup.

## One correction: API 2 can return NotReleased

Your note says API 2 only returns Cancelled, Superseded, Inactive and Released. But API 2 returns every loan that was **ever** released, in any state. An ever-released loan whose status later moved away from 12 is `NotReleased` by the FeedState order. Please correct the note. The DMS handles all 5 states in API 2 and API 1.

## API 1: please clarify 200 vs 409

When a PN # has **2 rows but only 1 is selectable**, does API 1 return **200** with that row, or **409** with both? We handle both answers (on 409 we log all rows and use the single selectable one; with no or several selectable rows we show "Multiple records in myloans, contact Admin."). We need to know which one to expect.

## Hash test vectors

Please re-generate `myloans_hash_test_vectors.sql` **after check R2-5**, using the **real column types**: `BirthDate` date vs datetime, the scale of `total_loan_amount`, the type of `cifNo`, and the precision of `loan_released_date`. These change the text in `HashInput`. Then send us the three output rows (`HashInput` and `ContentHash`). Our test for them is ready and waiting.

## Still needed

| Ref | What | Blocks |
|---|---|---|
| R2-3 | The `PR_PRODUCTS` CSV, then the API 5 query | Setting the product keywords before go-live |
| R2-4 | Where myloans records **paid / closed** (status values, date and time zone, can it re-open). Please add it to API 1, API 2 and the hash before the freeze | Only the "Loan closed/released" stage |
| R2-6 | Timings of the three runs (API 2 page, Pool, API 1) | Our sync interval |
| A4 | Hard deletes: are rows ever deleted, and how would the API show it? | Stale data |
| A5 | Confirm the released amount (`SUM(total_loan_amount)`), sent as a string | The Mortgage rule |
| C2 | Limits: requests per minute or hour, the 429 response, timeouts, maintenance windows | Retry and alert settings |
| C5 | Credentials: OAuth or API key; UAT and production; IP allowlist | Set-up per environment |

Thank you.
