# Reply to the myloans team (round 2)

Date: 16 November 2026 (PHT)
From: the DMS team
About: your answers (16 Nov) and the API query as updated after review. Our copies: `docs/MYLOANS_ANSWERS.md` and `docs/myloans-api-contract.sql`.

Thank you. We will build the DMS side to this query. Before the contract is frozen, we ask for four changes and one list of products. The remaining open points follow.

---

## Please change before freezing

### 1. Add `ReplacedByExternalLoanId` to the ContentHash

**Why:** a loan that is **cancelled and then redone** never shows the DMS that it was replaced.
- Your example: transaction 51164 was cancelled at 13:22, got its code suffix at 13:42, and a new transaction was created.
- At 13:22, `FeedState` becomes `Cancelled`, so the hash changes and the DMS sees the cancellation. Good.
- At 13:42, the code suffix is added and `ReplacedByExternalLoanId` / `ReplacedByPNNo` are filled in. But:
  - `FeedState` stays `Cancelled`, because the CASE checks Cancelled before Superseded;
  - `application_code` and `ReplacedBy…` are not in the hash.

  So **the hash does not change**. The DMS skips a row whose hash is unchanged, so it never learns, from the old row, that the loan was replaced.
- Today the DMS can still catch it from the **new** row: a new ExternalLoanId with a CIN it already holds. But that depends on the new loan being released first, and it gives the DMS only one signal.

**Request:** add `ReplacedByExternalLoanId` (the id, not the PN) to the ContentHash **before the formula is frozen**. Adding it after go-live would change the hash of every replaced loan at once.

### 2. Fix the header: FeedState has 5 values

The header and the column comment list four values (Released / Cancelled / Superseded / Inactive). The CASE returns **five**, including **NotReleased**, and in a fixed order:

1. `Cancelled` (status 14)
2. `Superseded` (code longer than 20)
3. `NotReleased` (status ≠ 12)
4. `Inactive` (`is_active` = 0)
5. `Released`

Please list all five, in this order, in the header, the column comment and the API documentation. The DMS treats any change away from `Released` as needing review.

### 3. `@AfterId` as bigint; an index on `Transactions.application_code`

- `@AfterId` is declared `int`. Please make it **bigint**, the same type the DMS uses for ExternalLoanId, so paging can never overflow or convert.
- Please confirm there is an **index on `Transactions.application_code`**.
  - The `OUTER APPLY` that finds `ReplacedBy…` looks up `T2.application_code = LEFT(T.application_code, 20)` for every superseded row.
  - API 1 and our CIN link depend on it too.

### 4. Unique indexes on `LOANS.CIN` and `Transactions.pn_no`

Your checks found both unique in today's data, but nothing enforces it (A1, A3).

| If duplicated | Effect |
|---|---|
| A second LOANS row for one CIN | The same `ExternalLoanId` comes back twice. If the two copies straddle a page edge, `TOP (@PageSize)` cuts between them. The next page starts after that id (`T.id > @AfterId`), so the second copy is **silently skipped** |
| A third transaction for one PN # | API 1's `TOP 2` would hide it |

**Please choose one:**
- **(a)** add **unique indexes** on `LOANS.CIN` and `Transactions.pn_no`; or
- **(b)** if that is not possible, have the API fetch **PageSize + 1** rows. It can then see when a duplicate straddles the page edge, keep both copies on the same page, and flag them.

The DMS keeps its own safeguard either way: a duplicate ExternalLoanId within one run is logged, alerts our Admin, and raises no Open Items.

---

## Answered on our side

### A7.3 Financing vs Refinancing: answered

The business users decided that **Financing vs Refinancing is decided by keywords in the product name**. Our Admin maintains two keyword lists in the DMS settings. It is **not** decided by ProductCode, so nothing new is needed in the loan query for this.

Two points follow from it:
- **The DMS needs the product name to be current.** Today a product rename never reaches API 2, because only `ProductCode` is in the ContentHash and `PR_PRODUCTS` is not in `SourceUpdatedAt`. See the API 5 request below.
- **The DMS uses `ProductID` / `ProductCode` only to recognise that the same product was renamed.** Never to classify.

### Birth date

Thank you for **option D2 with an HMAC in the API**. The DMS will never receive or store a birth date; it compares `BirthDateHash` only.

---

## Required before go-live (not blocking our build)

### API 5: products

**Why it is needed:** a product rename does not put any loan into the API 2 feed. Without a product list, the DMS would classify with an old name until each loan happens to change.

**Request:**
1. **API 5** (`GET /api/dms/v1/products?since=…`): `ProductID`, `ProductCode`, `Name`, active flag, `UpdatedAt`. Full list without `since`.
2. **An alternative, if API 5 cannot be built in time:** add `ProductName` to the ContentHash. This is heavier: every product rename would then re-send every loan of that product.
3. **Now, please:** the **current `PR_PRODUCTS` list** (ProductID, ProductCode, Name, active flag) as a file, so we can set and test the keyword lists against real product names.

---

## Still open

| Ref | Question | Why it matters |
|---|---|---|
| A4 | **Hard deletes.** Are rows ever physically deleted from `Transactions`, `LoanComputations` or `TransactionPdcDetails`? If yes, how will the API show it? | A deleted loan never appears in the change feed, so the DMS would keep stale data |
| A5 | **Released amount.** Please confirm `SUM(LoanComputations.total_loan_amount)` is the total **released** amount our Mortgage rule needs (New ≤ ₱500,000; Renewal ≤ ₱1,000,000). Please also send it as a string, as you suggest | It decides whether a Mortgage transaction is created |
| C1 | **Timing.** `SET STATISTICS TIME ON` results for one API 2 page over a 30-minute window, for the pool mode, and for API 1. Your UNION pre-filter idea is welcome | We call API 2 every 30 minutes |
| C2 | **Limits.** Requests per minute or hour, the over-limit response (429 with `Retry-After`?), timeouts, maintenance windows | Our retry and alert settings |
| C5 | **Credentials.** OAuth client credentials or an API key; separate UAT and production credentials; IP allowlist | Set-up per environment |
| — | **Empty page and next-page marker.** What does an empty page return? Does a full page return a `nextAfterId` / `nextCursor`, or do we take the last row's id? Please send sample JSON for a full page, a short last page and an empty page | Our paging must stop at the right place and never skip a page |
| — | **API 1 response codes.** Is the mapping 404 (no row), 422 (no selectable row, with `TransactionStatusId`, `FeedState`, `ReplacedByPNNo`) and 200 (the selectable row)? | Our PN # search messages |
| — | **API 3.** The query has no freshness mode. Is API 3 dropped (we use API 1), or a cut-down API 1? | Our refresh button |
| — | **Hash test vectors.** Two or three fake or masked sample rows with the exact text that goes into the hash and the resulting `ContentHash` | So our mock produces byte-identical hashes |

Once the four changes are in and the open points are answered, we will freeze the contract on our side and send you our test results against your UAT API.
