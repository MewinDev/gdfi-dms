# Reply to the myloans team (round 2)

Date: 16 November 2026 (PHT)
From: the DMS team
About: your updated answers and the DMS loan API query

Thank you for the updated answers and query. We will build the DMS side to them. Below are four changes we ask for before the contract is frozen, then the points that are still open.

---

## Please change before freezing

### 1. Add ReplacedByExternalLoanId to the ContentHash

**The problem is cancel-then-redo.** When a loan is cancelled and redone:
- the old row becomes Cancelled;
- a new row (new ExternalLoanId, same CIN) is created.

If the old row was already Cancelled, or its monitored fields don't change, **its ContentHash stays the same**. The DMS skips any row whose hash hasn't changed, so it never learns that the old row now points to a replacement.

If `ReplacedByExternalLoanId` is part of the hash, then setting it changes the hash, and the change reaches the DMS on the old row too.

Please add it **before the hash formula is frozen**. Adding it after go-live would change the hash of every replaced loan at once.

### 2. Fix the header: FeedState has 5 values

The header lists four values. The query returns five:

| FeedState | Meaning |
|---|---|
| `Released` | selectable |
| `Cancelled` | cancelled |
| `Superseded` | replaced by another record |
| `Inactive` | no longer active |
| `NotReleased` | not yet released |

Please list all five in the header and the API documentation. The DMS treats any change away from `Released` as needing review.

### 3. `@AfterId` as bigint; index on `Transactions.application_code`

- Please declare `@AfterId` as **bigint**, the same type as `Transactions.id` / ExternalLoanId, so paging never overflows or converts.
- Please confirm there is an **index on `Transactions.application_code`**. The CIN joins and the replacement lookup use it on every call.

### 4. Unique indexes on `LOANS.CIN` and `Transactions.pn_no`

**Why we ask:** if one CIN has two LOANS rows, or one PN # has two Transactions rows, the same loan can appear twice. When the two copies fall on either side of a page boundary, paging by ExternalLoanId can drop or repeat one of them.

**Please choose one:**
- **(a)** add **unique indexes** on `LOANS.CIN` and `Transactions.pn_no`, which removes the risk at the source; or
- **(b)** if unique indexes are not possible, have the API fetch **PageSize + 1** rows. It can then tell when a duplicate straddles the page edge, and either keep both copies on the same page or flag them.

In either case, the DMS keeps its own safeguard: a duplicate ExternalLoanId within one run is logged, alerts our Admin, and raises no Open Items.

---

## Still open

| Ref | Question | Why it matters |
|---|---|---|
| A4 | **Hard deletes.** Are loans ever physically deleted? If yes, how will the API show it? | A deleted loan never appears in the change feed, so the DMS would keep stale data |
| A5 | **Released amount.** Is `TotalLoanAmount` the total **released** amount used by our Mortgage rule (New ≤ ₱500,000; Renewal ≤ ₱1,000,000)? | It decides whether a Mortgage transaction is created |
| A7.3 | **Source of Financing / Refinancing, and API 5 (products).** The DMS classifies each loan as Financing or Refinancing from the product name. Please confirm the field the DMS should use (product name, or a classification flag from you), and when API 5 (products, with "updated since") will be available | **This blocks our LA module.** The classification decides which transactions each loan file gets |
| C1 | **Timing.** How long does one page of API 2 take at today's size (about 13,000 loans) and at 2–3 times that? Same for the first load in pool mode | We call API 2 every 30 minutes |
| C2 | **Limits.** Requests per minute or hour, over-limit response (429 with `Retry-After`?), timeouts, maintenance windows | Our retry and alert settings |
| C5 | **Credentials.** OAuth client credentials or API key; separate UAT and production credentials; IP allowlist | Set-up per environment |
| — | **Empty page and nextCursor format.** What exactly does a page with 0 rows return? What does a full page of exactly 500 rows return as the "next" marker: `nextAfterId`, `null`, or something else? Please send a sample JSON for a full page, a short last page and an empty page | Our paging must stop at the right place and never skip a page |

Thank you. Once the four changes are in and the open points are answered, we will freeze the contract on our side and send you our test results against your UAT API.
