> Saved from `docs/incoming/myloans-round3/myloans-reply-round-3.md` (17 Nov 2026). Real-looking PN # values replaced with `<SAMPLE-PN>` (none in the reply itself). The SQL files are in `docs/myloans-api-contract.sql` and `docs/myloans/` (`myloans_hash_test_vectors.sql`, `myloans_round3_checks.sql`). Decisions: D-040.

# myloans reply to the DMS team (round 3)

Date: 17 November 2026 (PHT)
Re: "Reply to the myloans team (round 3)", 17 Nov 2026
Files:
- `myloans_api_query.sql` (round 3)
- `myloans_hash_test_vectors.sql` (17 fields, real column types)
- `myloans_round3_checks.sql`

---

## Birth date removed. Done.
- `BirthDate` is no longer in the output or the ContentHash.
- The hash now has **17 fields**, and `ReplacedByExternalLoanId` is field 17.
- There's no HMAC and no `BirthDateHash`.

Field order, separated by `|`, with NULL as empty text:

1. FeedState
2. pn_no
3. status
4. is_active
5. cifNo
6. FirstName
7. MiddleName
8. LastName
9. Suffix
10. LoanID
11. LoanClass
12. CompanyName
13. TotalLoanAmount
14. ReleaseDate (+08:00, style 126)
15. ProductCode
16. BranchID
17. ReplacedByExternalLoanId

## Test vectors: real types built in
- The script now copies the real myloans column types into its test table, so the fake values are converted to text exactly like real loans. That covers `cifNo`, the amount's scale and the release date's precision, without needing R2-5 first.
- We'll send the three output rows (`HashInput` and `ContentHash`).

## Database structure
Noted: no unique indexes. The `application_code` index stays optional, and only with the DBA's agreement.

## Correction: API 2 can return NotReleased
You're right. API 2 returns ever-released loans in **any of the 5 FeedStates**, NotReleased included. The header now says so.

On 16 Nov, only statuses 12 and 14 had release dates, so NotReleased doesn't occur in API 2 today, but it can.

---

## Your questions

### 1. Does every status change update `Transactions.updated_at`?
**No, not for a redo.** We checked this, and the query is now fixed.

- **Redo:** the "x<timestamp>" suffix is added **without** touching `updated_at`.
  - In 22 of 29 superseded copies, `updated_at` is earlier than the suffix time.
  - Example: transaction 51164 has `updated_at` 13:22:22 (the cancellation), but its suffix says 13:42:15.
  - The other 7 were edited again after the redo.
  - With the round 2 query, a redo of a loan that wasn't also cancelled would never have reached API 2.
- **Fix:** `SourceUpdatedAt` now also takes:
  - the suffix time, read from the code itself (`x20261116134215` → 16 Nov 2026 13:42:15 +08:00);
  - the `created_at` of the replacement transaction.

  So a redo moves the old row's `SourceUpdatedAt`, and API 2 returns it with `FeedState` = Superseded and `ReplacedBy…` filled in.
- **Cancel (status 14) and deactivate (`is_active` = 0):** likely yes, since 51164's `updated_at` matches its cancellation time. **To verify:** `myloans_round3_checks.sql` compares the audit trail with `updated_at` for every cancelled or inactive released loan. We'll report the result.
- **Other changes:** the myloans developers still need to confirm that no other code path changes status or `is_active` without updating `updated_at`.

### 2. API 1 with 2 rows and only 1 selectable
**409, with all rows.** The rule is simple: more than one row means 409, whatever their states.
- On 16 Nov no PN # had more than one transaction, so this shouldn't happen in practice.
- A redo creates a new PN #, so the old and new copies never share one.

---

## Still needed (no change since round 2)

| Ref | Status |
|---|---|
| R2-3 | `PR_PRODUCTS` CSV and API 5 query: we'll send them after running the check |
| R2-4 | Paid/closed source: searching. We'll add it to API 1, API 2 and the hash before the freeze |
| R2-6 | Timings: we'll send them after running the check. The redo lookup adds some cost, so we'll time it after this change |
| A4 | Hard deletes: open (myloans developers) |
| A5 | Released amount: open (myloans developers) |
| C2 | Limits: open (infrastructure) |
| C5 | Credentials: open (infrastructure) |

## Freeze
Agreed. We'll freeze once the test vectors are sent and the paid/closed source is added.

**Note:** this round changed the freshness rule (`SourceUpdatedAt`), not the hash formula. Freshness decides *which* loans API 2 returns, not their hash, so there's nothing to re-baseline on your side.
