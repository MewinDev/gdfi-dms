# Reply to the myloans team (round 3)

Date: 17 November 2026 (PHT)
Re: "myloans reply to the DMS team (round 2)", 17 Nov 2026

Thank you for the quick and thorough round 2.

## Accepted

- **All four changes are accepted:** `ReplacedByExternalLoanId` in the ContentHash, FeedState with 5 values, `@AfterId` as bigint, and the duplicate handling.
- **Paging by loan is accepted.** We follow your JSON exactly: `{ runStartedAt, items, nextAfterId }`, `nextAfterId` null on the last page, an empty page as `items: []` with null, and page 1's `runStartedAt` kept for the whole run.
- **API 3 dropped:** agreed. Our Refresh button calls API 1.
- **API 5:** agreed. If `PR_PRODUCTS` has no update-time column, send the full list every time; we detect renames by `ProductID`.

## Please remove the birth date

We decided not to receive or monitor the borrower's birth date (not needed by the business; less personal data under RA 10173).

- **Remove `BirthDate` from the query output and from the ContentHash.** The hash becomes **17 fields**: field 10 (`BirthDate`) goes, and `ReplacedByExternalLoanId` becomes field 17.
- **No HMAC and no `BirthDateHash` are needed.** The API code does not have to hash or drop anything.
- Please **re-generate the test vectors with the 17 fields** and the **real column types** (after check R2-5: `cifNo` type, the scale of `total_loan_amount`, the precision of `loan_released_date`). Then send us the three output rows (`HashInput` and `ContentHash`). Our test for them is ready.

## Database structure: no change needed

- **We do not need the unique indexes.** Please don't change the myloans database structure for us. Paging by loan already protects the DMS: when a loan comes back twice we alert our Admin and skip that loan until it is fixed.
- **The `application_code` index is optional.** It would only speed up the "replaced by" lookup; add it only if your DBA agrees.

## One correction: API 2 can return NotReleased

Your note says API 2 only returns Cancelled, Superseded, Inactive and Released. But API 2 returns every loan that was **ever** released, in any state. An ever-released loan whose status later moved away from 12 is `NotReleased` by the FeedState order. Please correct the note. The DMS handles all 5 states in API 1 and API 2.

## Please confirm

1. **`Transactions.updated_at`:** does **every** status change (cancel, deactivate, redo) **always** update `Transactions.updated_at`? The DMS relies on it: API 2 only returns loans whose `SourceUpdatedAt` moved after our checkpoint, so a status change that does not touch `updated_at` would never reach us.
2. **API 1, 200 vs 409:** when a PN # has **2 rows but only 1 is selectable**, does API 1 return **200** with that row, or **409** with both? We handle both answers (on 409 we log all rows and use the single selectable one; with none or several selectable we show "Multiple records in myloans, contact Admin."). We need to know which one to expect.

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

## Freeze

Once the birth date is removed, the test vectors are re-generated with the 17 fields, and the paid/closed source (R2-4) is added, **we propose to freeze the contract**. After the freeze, any change to the query or the hash needs both teams and a one-time re-baseline on our side.

Thank you.
