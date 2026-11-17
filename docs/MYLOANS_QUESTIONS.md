# Questions for the myloans team

Date: 16 November 2026 (PHT)
From: the DMS team
About: the DMS loan API (APIs 1–3, and APIs 4–5 for branches and products), as defined in `docs/myloans-api-contract.sql`.

The DMS never reads the myloans database; it calls only the API. Each question below shows why we ask and what the DMS does until we hear back.

---

## A. Data shape

### A1. One LOANS row per CIN?
- **Why we ask:** the query joins `LOANS` on `L.CIN = T.application_code`. If one CIN has two LOANS rows, the same loan (`ExternalLoanId`) comes back twice in one page, with possibly different values and two different ContentHashes.
- **Until then:** the DMS treats a repeated `ExternalLoanId` within one run as a data problem. It logs it, alerts the DMS Admin, and does not create Open Items from either row until the next clean run.
- **Please confirm:** is `LOANS.CIN` unique? If not, which row is correct?

### A2. One BORROWERS row per cifNo?
- **Why we ask:** the same fan-out risk as A1, through `B.cifNo = L.cifNo`.
- **Please confirm:** is `BORROWERS.cifNo` unique?

### A3. Do superseded copies share the PN #?
- **Why we ask:** `IsSuperseded` = 1 when `application_code` is longer than 20 characters (the "x&lt;timestamp&gt;" copy).
  - If the superseded copy keeps the same `pn_no`, then **API 1 (Mode A) can return more than one row for a PN #**, although the header says "Returns 1 row (or none)".
  - The DMS will use the non-superseded row and log a warning.
- **Please confirm:**
  1. When a loan is superseded, does the **old** `Transactions.id` become the superseded copy and a **new** `Transactions.id` become the live one, or the other way round? This matters because the DMS matches loans on `ExternalLoanId`. If the live loan gets a new id, the DMS must re-link its saved loan to the new id.
  2. Can the live copy's `pn_no` differ from the superseded copy's?
  3. Can API 1 return the rows ordered with the non-superseded row first, or return only that row?

### A4. Hard deletes
- **Why we ask:** a row deleted from `Transactions` (or LOANS / BORROWERS) never appears in API 2, so the DMS would keep stale data with no signal.
- **Please confirm:** are loans ever physically deleted? If yes, can deletions be exposed, for example as a status, a soft-delete flag, or a "deleted since" list?

### A5. TotalLoanAmount = total released amount?
- **Why we ask:** the DMS Mortgage rule (Rule 4: New ≤ ₱500,000; Renewal ≤ ₱1,000,000) needs the **total released amount**. The query uses `SUM(LoanComputations.total_loan_amount)`.
- **Please confirm:**
  1. Is that sum the released amount?
  2. Can a loan have more than one LoanComputations row, and is summing them right?
  3. What precision and format does the API send: decimal(18,2) as a JSON string?

### A6. Status codes
- **Please send** the full list of `TransactionStatusId` values and their names.
- **Why we ask:** we know 12 = Released. The DMS currently treats 15–19 as "not found", which needs confirming.
- **Please confirm** which statuses mean **cancelled** and which mean **no longer released**.

### A7. Names and the loan type
- **Please confirm:**
  1. `LoanType` is always exactly `New` or `Renewal`. The DMS rules refuse anything else.
  2. Borrower names come as First / Middle / Last / Suffix. Can any part be NULL versus empty?
  3. `ProductName` comes from `PR_PRODUCTS`, but it is **not in the ContentHash**, and PR_PRODUCTS is **not in SourceUpdatedAt**. So a product rename never shows up in API 2.
- **Why point 3 matters:** the DMS classifies Financing vs Refinancing from the product name. We will take renames from API 5 (products). Please confirm that API 5 will exist, and its `updated since` behaviour.

---

## B. ContentHash

### B1. Encoding
- **Background:** `HASHBYTES('SHA2_256', …)` returns 32 bytes.
- **Please confirm** how the API writes it in JSON. The DMS will store it as 64 **lowercase hex** characters.
  - Upper- or lowercase hex? With or without `0x`? Not base64?
- **Please also fix one encoding for good.** A change of encoding later would look like a change on every loan.

### B2. The hash input must stay fixed
- **Background:** v2 §5.2 says changing the formula after go-live raises Open Items on every open loan.
- **Please confirm** that the field list, order, separators, NULL marker (`~`), date style (126) and number formats will not change without telling the DMS team first.
- **Please also confirm** that `CONVERT(nvarchar(40), TotalLoanAmount)` always gives the same text for the same value (for example `500000.00`).

### B3. The hash covers fields the DMS does not receive or keep
- **Background:** the hash includes `application_code` (full), `LoanClass` (code) and `BirthDate`.
- **What the DMS does:**
  - A change in a field the DMS **can** see becomes an Open Item for that field.
  - A change only in a field the DMS **cannot** see (see B4 for the birth date) raises an Open Item that says **"Changed in myloans: field not shown in DMS"**, so it is not silently ignored.
- **Please confirm** this is acceptable.

### B4. Birth date
- **Background:** BirthDate is inside the ContentHash, so a birth-date correction changes the hash. The DMS team has been told **not to store the birth date until the project owner decides.** The options are in section D.
- **Please confirm:** could the API also send a separate hash of the birth date alone, `BirthDateHash` (SHA-256 of a fixed salt plus the date)? That allows option D2.

---

## C. Performance, limits, availability

### C1. Hash and change-check cost at about 13,000+ loans
- **Background:** API 2 filters on `Freshness.SourceUpdatedAt`, which is a MAX over five tables computed per row in a CROSS APPLY, and computes a SHA-256 over joined columns per row. That cannot use an index, so each page call may scan every loan.
- **Please share** the measured time per page at today's size (about 12,998) and at 2–3 times that.
- Would a persisted / indexed `SourceUpdatedAt` (or a change table) be possible?
- The DMS calls API 2 every **30 minutes** (a setting, 30–60 advised), plus one call per page.

### C2. Rate limits
- **Please tell us:**
  - requests per minute or hour per client;
  - the response to an over-limit call (429 with `Retry-After`?);
  - timeouts;
  - maintenance windows.
- **Background:** the DMS retries with backoff, honours `Retry-After`, and stops after repeated failures. An alert is raised after N failed runs.

### C3. Paging edge cases
1. **Duplicate rows at a page boundary.** If two rows share both `SourceUpdatedAt` and `ExternalLoanId` (the A1 / A2 case) and fall on either side of a page boundary, the cursor condition `T.id > @AfterId` skips the second one. Can the API remove duplicates before paging, or flag them?
2. **Empty page.** What does a page with 0 rows return as `maxSourceUpdatedAt` and `nextCursor`: null? The DMS will keep its previous checkpoint when a run returns no rows.
3. **Exactly 500 rows.** When the last data page has exactly 500 rows, we expect `nextCursor` to be set and the next call to return 0 rows. Please confirm.
4. **`maxSourceUpdatedAt`.** Is it the last row of each page (as the comment says) or the maximum of the whole run? The DMS will use the maximum over all pages of the run.

### C4. First load
- **Background:** API 2 returns only loans changed after `since`. Loans released earlier but not changed since then would never appear in the DMS's "Released. Not yet in DMS" list.
- **Please confirm:**
  - Is a one-time first run with an early `since` (for example the go-live date minus 60 days) acceptable, or too heavy?
  - Or should we use a separate "released since" call?

### C5. Authentication and environments
- **Please confirm:**
  - OAuth client credentials or an API key (v2 §11.7)?
  - Separate UAT and production credentials?
  - The IP allowlist?

---

## D. Birth date: options (for the project owner)

The birth date is in the ContentHash. Today the DMS deliberately does not read it (privacy choice, `docs/myloans/field-map.md`). Until the project owner decides, **the DMS does not store it.**

| Option | How it works | What the approver sees | Privacy impact (RA 10173) |
|---|---|---|---|
| **D1. Store it, restricted** | The birth date is saved encrypted. Only roles with a "See birth date" permission can view it. Every view is logged in the view log (D-019). | Old and new birth date, to those allowed | The DMS holds one more item of personal data for every borrower. It needs a stated purpose in the privacy notice, a retention rule, and inclusion in data-subject requests. Higher impact if the database leaks: name plus birth date is a common identity-theft pair. |
| **D2. Compare without storing** | The DMS keeps only a salted hash of the birth date. It needs myloans to send `BirthDateHash` (B4), or the DMS hashes the incoming value at once and drops it. | "Birth date changed in myloans (value not kept in DMS)", with no values | Low. No birth date is kept, and a salted hash with a secret salt cannot easily be reversed. The DMS can still flag the change. The approver must check the value in myloans itself. |
| **D3. Ignore it** | Treat a hash change with no visible field change as "field not shown in DMS" (B3). | A generic Open Item | Lowest. But the DMS cannot tell a birth-date correction apart from any other hidden change. |

**DMS team's suggestion:** D2. It meets the "every change is reviewed" rule (D-004) without holding the birth date. If the DMS hashes the incoming value itself, the birth date passes through server memory only. Even so, it is "processed" under RA 10173 and should be listed in the processing inventory.

---

## E. Summary of what we need, in order

1. A1, A2, A3: the data shape of the join and supersession. These affect matching and duplicates.
2. B1, B2: hash encoding and how stable it is.
3. A5, A6: the amount and status codes. These affect the rules.
4. C1, C2, C3: performance, limits and paging.
5. C4, C5: first load and credentials.
6. A4, A7, B4: deletes, names, product renames, birth-date hash.
