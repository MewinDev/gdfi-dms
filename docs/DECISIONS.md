# Decisions

Each decision has a number, the date it was made (Philippine time), what was decided, and the reason.

- Where the project owner gave a reason, it is quoted.
- Where no reason was given, the entry points to the v2 section it follows and says the reason is to be confirmed.
- A decision is never deleted: one that changes gets a new entry that replaces the old number.

v2 below means *Loan Document Management System v2* (16 Nov 2026), the main spec.

---

## D-001 Database stays on PostgreSQL for now

- **Date:** 16 November 2026
- **Decision:** Keep PostgreSQL. Do not port to SQL Server.
- **Reason:** v2 §12 names SQL Server (DMSDB), but IT has not confirmed it. Porting is postponed until IT decides.
- **Effect:** none now. If SQL Server is confirmed later, see `V2_GAP_ANALYSIS.md` §6 (D1) for what the port touches.

## D-002 Ten roles; LA Supervisor/Head is a separate role

- **Date:** 16 November 2026
- **Decision:** The roles are:
  1. Superadmin
  2. Admin
  3. LA
  4. LA Supervisor/Head
  5. DP
  6. Finance
  7. Custodian
  8. QA
  9. Digicur
  10. Archiver

  LA Supervisor/Head is its own role. It has every LA permission, plus "Approve/Reject myloans Open Items".
- **Reason:** Project owner's decision. v2 §1.6 and §12.2 model the Supervisor as an LA with an `IsSupervisor` flag. A separate role was chosen instead. The reason is to be confirmed.
- **Open points:** resolved by D-009 (Finance CA / FT) and D-010 (old roles).

## D-003 Permissions are customizable in a matrix

- **Date:** 16 November 2026
- **Decision:**
  - A matrix screen shows roles × permissions with tickboxes. It is seeded with the v2 §7 defaults.
  - Only the Superadmin can edit it.
  - Permissions are enforced on the server and read from the database (a cache is allowed). There are no hardcoded role checks.
  - The Superadmin cannot remove their own access.
  - The last Superadmin cannot lose "manage permissions".
  - Every change is audit-logged.
- **Reason:** Project owner's decision. The reason is to be confirmed. v2 §9.5 lists "user roles and permissions" as an Admin-maintained setting. This decision restricts editing to the Superadmin.
- **Extended by:** D-008 (per-user overrides and scope).

## D-004 myloans changes follow v2 strictly

- **Date:** 16 November 2026
- **Decision:**
  - Nothing from myloans is applied automatically, not even minor changes.
  - Every differing field becomes an Open Item.
  - DMS data stays unchanged until the LA Supervisor/Head approves.
  - Remarks are required on approve and on reject.
- **Reason:** v2 §3.2 and §5.2 say DMS data is not changed until the change is approved.
- **Replaces:** the earlier rule that applied "minor" changes (area, division, company, vehicle details) automatically, and the split of reviewers between the Admin and the Branch Supervisor (`docs/workflow/08-systems.md`).
- **Narrowed by D-012:** only monitored loan and borrower fields raise Open Items. Renames of reference data (area, division, company, branch and product names) update automatically, with a log.

## D-005 myloans check interval

- **Date:** 16 November 2026
- **Decision:**
  - Default: every 30 minutes, editable in Settings.
  - A value below 30 or above 60 minutes shows a warning but is allowed.
  - A change applies without a restart and is audit-logged.
- **Reason:** v2 §9.2 gives "every 30 minutes during office hours" as the example. The reason for the 30–60 warning band is to be confirmed.
- **Applied by D-016:** the interval drives the API 2 change feed.

## D-006 Closure: documents stay in the vault until the loan is fully paid

- **Date:** 16 November 2026
- **Decision:**
  - Documents stay in the vault until the loan is fully paid.
  - There are two separate statuses:
    - **Processing complete**: the document work is finished.
    - **Loan closed/released**: the loan is fully paid and the file is closed.
- **Reason:** v2 contradicts itself (`V2_GAP_ANALYSIS.md` C1):
  - §2.1, §3.6, §5.3 and §8 close the transaction when the box is Stored, right after scanning.
  - §6.1, Chart 1 and Chart 8 keep the documents in safekeeping until the loan is fully paid.

  This decision follows §6.1, Chart 1 and Chart 8.
- **Open points:** where "Processing complete" is set, and what tells the DMS that a loan is fully paid (`FOUNDATION_CHECK.md` Q15).

## D-007 BRD-only features are deferred, not dropped

- **Date:** 16 November 2026
- **Decision:** Three features from the BRDs (MTLMS, MoD) that are missing from v2 move to a later phase. They are not dropped:
  - vault pull-out;
  - 1–8 units per PN;
  - NTC / NTE / NOD notices.
- **Reason:** v2 is the source of truth for this phase. v2 §1.5 puts retrieval and borrowing out of scope for now.

---

Decisions D-008 to D-021 come from the project owner's answers to the Step 1 questions (`FOUNDATION_CHECK.md` §E.2), dated 16 November 2026. Where an answer gave a reason, it is quoted. Otherwise the reason is the problem the question raised.

## D-008 Per-user permission overrides and scope (built now)

- **Date:** 16 November 2026
- **Decision:**
  - **Effective permission** = the role's default ticks (D-003 matrix) plus per-user overrides. An override is Grant or Deny.
  - The user edit screen shows each permission as **Inherited / Granted / Denied**.
  - **Per-user scope:**
    - branch tickboxes plus an explicit "All branches" tickbox;
    - Finance "Handles CA" and "Handles FT" (D-009);
    - "Can approve LA Open Items" (D-010).
  - Only the Superadmin edits permissions and overrides. Every change is audit-logged.
  - **One server-side helper** resolves permissions and branch scope. Every query, count, page, API route and file download uses it, with no inline checks.
- **Reason:** D-009, D-010 and D-011 each need a per-user setting, so overrides can no longer be deferred.
- **Replaces:** the Step 3 instruction to assess overrides "for later, don't build".

## D-009 One Finance role; CA and FT handled per user

- **Date:** 16 November 2026
- **Decision:**
  - One Finance role.
  - Each user has two tickboxes, "Handles CA" and "Handles FT". A user can have one or both.
  - Finance screens, queues and approvals are filtered by these tickboxes.
- **Reason:** v2 §5.7 says a Finance user cannot process the other fund type. Per-user tickboxes do that without two roles.
- **Answers:** `FOUNDATION_CHECK.md` Q3.

## D-010 Open Item approvers and the migration of old roles

- **Date:** 16 November 2026
- **Decision:**
  - LA Supervisor/Head is the **default** approver of LA Open Items.
  - Approval is a per-user tickbox, "Can approve LA Open Items". The Superadmin can give it to, or remove it from, any user.
  - Old roles migrate as follows:

    | Old role | Becomes |
    |---|---|
    | Branch Supervisor | LA Supervisor/Head |
    | Operations Monitor | a read-only role built from matrix tickboxes |
    | Approvers (APPR and the custom approver roles) | per-user approval tickboxes |

  - The users affected are listed in `IMPLEMENTATION_PLAN.md` §3.3.
- **Reason:** to fit the 10 roles of D-002 while keeping the current abilities, without adding extra roles.
- **Answers:** Q4.

## D-011 Approvers work only on their assigned branches; an "Unassigned" queue

- **Date:** 16 November 2026
- **Decision:**
  - An approver handles only the branches assigned to them.
  - Branch assignment is per-user tickboxes and can be changed at any time.
  - Items for a branch with no approver go to an **"Unassigned"** queue. The Superadmin and all-branch approvers see that queue.
- **Reason:** so that no Open Item waits unseen.
- **Answers:** Q6.

## D-012 Only loan and borrower fields raise Open Items; reference renames update automatically, with a log

- **Date:** 16 November 2026
- **Decision:**
  - Only **loan and borrower fields** create Open Items.
  - Which fields are monitored is a tickbox setting.
  - Renames of reference data (area, division, company, branch and product **names**) update automatically. Each one is written to a **"Reference data changes"** log (old value, new value, when, source) that the Admin and LA Supervisor/Head can see, and also raises an in-app notice.
- **Reason:** a rename is not a change to the loan. Raising an Open Item on every open loan for one rename would flood the approvers.
- **Partly replaces:** D-004 ("every differing field becomes an Open Item").
- **Answers:** Q7.

## D-013 A myloans cancellation is an Open Item

- **Date:** 16 November 2026
- **Decision:** When myloans reports a cancellation, or that a loan is no longer released:
  - an Open Item is raised;
  - the loan is flagged **"Cancellation pending review"**;
  - Forward is blocked;
  - DMS data stays unchanged until the item is approved.
- **Reason:** follows D-004 (nothing applied without approval). Blocking Forward stops work moving on a loan that may be cancelled.
- **Answers:** Q8.

## D-014 TAT is per user, from accept to forward; waiting time is recorded too

- **Date:** 16 November 2026
- **Decision:**
  - TAT is measured **per user, from accept to forward**.
  - **Waiting time** (from arrival in the inbox to accept) is also recorded.
- **Reason:** v2 §2.2 and §5.3. Waiting time shows delays before work starts.
- **Answers:** Q12.

## D-015 Branch pool plus personal inbox

- **Date:** 16 November 2026
- **Decision:**
  - Work arrives in a **branch pool**. Each user also has a **personal inbox**.
  - **Accepting** an item from the pool assigns it to the user who accepted it.
- **Reason:** gives the LA an accept event, so the LA's TAT has a start (v2 C10), while any LA in the branch can still pick up work.
- **Answers:** Q14.

## D-016 myloans sync uses the change feed (API 2), matched on ExternalLoanId

- **Date:** 16 November 2026
- **Decision:**
  - **API 2** (changed since, with cursor) is the main sync. The rotating-batch polling is dropped.
  - **Checkpoint:**
    - the new checkpoint is the `maxSourceUpdatedAt` of the last **successful** full run, minus 5 minutes;
    - it is saved only after **all** pages succeed;
    - a failed run keeps the old checkpoint.
  - The interval comes from D-005.
  - **Repeats are handled safely:**

    | Repeat | Action |
    |---|---|
    | Same ExternalLoanId and same ContentHash | Nothing |
    | Newer timestamp, same hash | Update the saved timestamp only |
    | Different hash | One Open Item per field: field, DMS value, myloans value, SourceUpdatedAt |

  - **Matching and superseded copies:**
    - Loans are matched on **ExternalLoanId**, not PN #.
    - Rows with `IsSuperseded = 1` are ignored.
    - If API 1 returns more than one row for a PN, the non-superseded one is used and a warning is logged.
  - **Status and active changes** follow D-013.
  - **Released loans not yet in the DMS:** loans in API 2 with `IsSelectable = 1` that are not yet in the DMS appear in the branch pool as **"Released. Not yet in DMS"**. No DMS transaction is created until an LA accepts.
  - **Duplicate ExternalLoanId within one run** is logged and alerts the Admin. It never crashes the run.
  - **ContentHash:** stored as hex, using myloans' hash. The DMS stops computing its own.
  - **Sync run log** (visible to the Admin): start, end, pages, rows, Open Items created, errors, checkpoint before and after.
  - **Failures:** retries with backoff, a timeout, and an alert after N failed runs (N is a setting).
  - A **local mock of APIs 1–3** follows the exact contract.
- **Reason:** the polling cannot keep up at a 30-minute interval (`FOUNDATION_CHECK.md` C.7). v2 §11 defines APIs 1–3.
- **Answers:** Q9 and Q10.
- **Birth date:** not stored until the project owner decides. The options are in `docs/MYLOANS_QUESTIONS.md`.

## D-017 Liquidation due date: one setting, saved on the record

- **Date:** 16 November 2026
- **Decision:**
  - Liquidation is due **N working days after LTO completion**.
  - There are separate values for **CA** and **FT**; both default to 2.
  - The due date is calculated and **saved on the record** when LTO completion is recorded.
  - Changing the setting affects new records only. Existing records keep their due dates.
  - The 10-day and 5-day constants and the unused `CashAdvanceRule.liquidationDays` column are removed by migration.
  - Changes to the setting are audit-logged.
- **Reason:** there were three conflicting sources (`FOUNDATION_CHECK.md` A.3). v2 §5.8 says 2 working days after LTO.

## D-018 One working-days calendar

- **Date:** 16 November 2026
- **Decision:**
  - Working days are set with **Mon–Sun tickboxes**. The default is **Mon–Sat working**: "Saturday IS a working day".
  - **Holiday list:** date, name, national or local. A local holiday can apply to specific branches (tickboxes).
  - **One calendar service** is used by TAT, liquidation, the sync and reports. All other day-counting code is removed, including the sync's separate Saturday rule.
- **Reason:** the TAT calendar (Mon–Fri) and the sync window (Mon–Sat) disagreed (`FOUNDATION_CHECK.md` A.3).
- **Changes:** TAT, overdue and due dates move from Mon–Fri to Mon–Sat by default.

## D-019 Branch scope everywhere; file access is logged

- **Date:** 16 November 2026
- **Decision:**
  - Every list, count, detail and download is filtered by the user's branch scope, through the one helper (D-008). This applies to all roles, starting with Finance.
  - Receipts and evidence files are served **only** through a signed-in download route that checks branch scope. There are no public or static URLs.
  - A request outside the user's scope returns **404** (not 403).
  - Every file view or download is logged: user, record, file, time. This is also the RA 10173 view log.
  - Tests: every role tries to read another branch's list, count, detail and file. All must be blocked.
- **Reason:** fixes scope gaps G1 and G2 (`FOUNDATION_CHECK.md` B.4) and gives the Data Privacy Act access log.

## D-020 Charts: no scheduling step; LTO-PASIG seeded as a sample

- **Date:** 16 November 2026
- **Decision:**
  - "Set schedule date; group PN #" and "Reschedule" are **removed**. "Not in scope."
  - The v2 .docx charts are the reference.
  - LTO-PASIG is seeded with a **sample** distance, clearly marked "Sample. Verify with Operations", and the UI shows a warning on that record.
- **Reason:** "Not in scope" (project owner). The three PASIG source files disagree (10, 50 and 2 km).
- **Answers:** Q1 and Q17.

## D-021 Sign-in hardening is priority #1

- **Date:** 16 November 2026
- **Decision:** the sign-in fix is the first item built in Step 4.
- **Reason:** production currently only warns when test sign-in is on (`FOUNDATION_CHECK.md` B.8).

## D-022 myloans: build the DMS side to the agreed contract

- **Date:** 16 November 2026
- **Decision:** the DMS side is built to the contract agreed with the myloans team after their updated answers and query. The query is reference only and is never run by the DMS (`docs/myloans-api-contract.sql`; answers in `docs/MYLOANS_ANSWERS.md`, both to be saved when pasted).

  1. **Link loans on CIN.** ExternalLoanId and PN # are stored as current values **with history**.
  2. **FeedState has five values:** Released, Cancelled, Superseded, Inactive, NotReleased. Released = selectable. Any change away from Released raises an Open Item and blocks Forward (D-013). DMS data is unchanged until approved.
  3. **Replacement detection:** "myloans record replaced" is raised, showing the old and new PN #, when **either**:
     - (a) a row we hold has `ReplacedByExternalLoanId`; **or**
     - (b) a new ExternalLoanId arrives with a CIN we already hold.

     Case (b) covers cancel-then-redo, where the old row stays Cancelled and its hash does not change. This has its own test.
  4. **Paging and checkpoint:**
     - pages by ExternalLoanId with `@AfterId`; `@Since` is fixed for the whole run;
     - checkpoint = page 1's `RunStartedAt` minus 5 minutes, saved only after all pages succeed;
     - same hash → no action.
  5. **ReleaseDate** arrives as datetimeoffset. It is converted to the Manila date for display, TAT and rules.
  6. **The birth date never arrives.** `BirthDateHash` identifies a change: "Birth date changed in myloans", with no values.
  7. **LoanID or LoanClass changes** → an Open Item showing the LoanType name. An empty LoanTypeId → a "Can't classify" alert.
  8. **Reference names** (branch / area / division / company / product) from the feed update the lookups automatically and go in the Reference data changes log (D-012).
  9. **Go-live cutoff:** setting "Branch pool cutoff date" (Superadmin), default = go-live date minus 30 days. A one-time first load uses `@ReleasedSince`; ongoing new releases come from API 2.
  10. **Safeguards kept:**
      - API 1 returns up to 2 rows; with 2, the one with `IsSelectable = 1` is picked and an alert raised;
      - a duplicate ExternalLoanId in one run → an alert and no Open Items.
  11. **The local mock follows this exact contract,** including:
      - cancel-then-redo;
      - NotReleased;
      - superseded with ReplacedBy;
      - a timestamp-only change;
      - pages of exactly 500;
      - the pool mode.
- **Reason:** the myloans team's updated answers and query.
- **Replaces parts of D-016:**
  - matching on ExternalLoanId → linking on CIN;
  - "ignore IsSuperseded = 1" → FeedState and replacement detection;
  - checkpoint = maxSourceUpdatedAt − 5 min → RunStartedAt − 5 min;
  - paging cursor (SourceUpdatedAt, ExternalLoanId) → `@AfterId` with a fixed `@Since`.
- **Resolves:**
  - `IMPLEMENTATION_PLAN.md` Q-N1 (superseded copies);
  - Q-N13 (birth date: neither stored nor received; the hash only).
- **Requested from myloans** (`docs/MYLOANS_REPLY_2.md`):
  - add ReplacedByExternalLoanId to the ContentHash before it is frozen;
  - correct the FeedState header;
  - make `@AfterId` a bigint;
  - indexes on `Transactions.application_code`, `LOANS.CIN` and `Transactions.pn_no`.
- **Still open with myloans:**
  - hard deletes;
  - the released amount;
  - **the source of Financing / Refinancing and API 5. This blocks the LA module;**
  - timing, limits, credentials;
  - the empty-page / nextCursor format.
- **Scope of this change:** docs and plan only; no sync code yet.
- **Amended 16 November 2026, after checking the actual query** (`docs/myloans-api-contract.sql`):
  - API 1 returns 0–2 rows of any status; the 404 / 422 mapping is the API's job, still to confirm;
  - the query has **no API 3 mode**: refresh uses API 1;
  - every row carries `RunStartedAt`; the checkpoint uses page 1's;
  - FeedState follows a fixed order (Cancelled, Superseded, NotReleased, Inactive, Released), so a cancelled-then-redone loan stays Cancelled but carries `ReplacedBy…`;
  - the hash covers 17 fields with NULL as empty text, and no names.

  Full list: `IMPLEMENTATION_PLAN.md` §7.1. Q-N14 is answered by D-027.

## D-023 Who edits access and scope

- **Date:** 16 November 2026
- **Decision:**

  | Who | May change |
  |---|---|
  | **Superadmin only** | the permission matrix; per-user permission overrides; the "Can approve LA Open Items" tickbox; the "All branches" tickbox |
  | **Admin and Superadmin** | specific branch tickboxes; the "Handles CA" / "Handles FT" tickboxes (day-to-day staffing) |
  | **Nobody** | their own access or scope |

  Every change is audit-logged.
- **Reason:** permissions and wide access stay with the Superadmin. Staffing changes (who covers which branch, who handles CA or FT) are routine and should not wait for the developer.
- **Answers:** `IMPLEMENTATION_PLAN.md` Q-N4. **Narrows D-008** ("only the Superadmin edits permissions and overrides") for branch and CA / FT ticks.

## D-024 Finance keeps approve-then-release; amount bands are a setting, off by default

- **Date:** 16 November 2026
- **Decision:**
  - The Finance **approve, then release** steps stay.
  - Approval **amount bands** become a setting, **off by default**. That matches v2, which has no bands.
  - With bands off, a request is approved by a user who has the approve permission for its fund type (role tick or override) and handles that type (D-009).
  - **To confirm with Finance.**
- **Reason:** separation of duties (the person who approves is not the only check before money moves). Bands stay available if Finance wants them.
- **Answers:** Q-N6. Departs from v2 §3.5 / §5.7 (no approval step) on purpose.

## D-025 Cancel-then-redo raises one Open Item

- **Date:** 16 November 2026
- **Decision:** a cancel-then-redo raises **one** "myloans record replaced" Open Item, not a separate cancellation item as well.
- **Reason:** it is one business event. Two items would ask the approver to decide the same thing twice.
- **Answers:** Q-N15.

## D-026 Real branch names are kept

- **Date:** 16 November 2026
- **Decision:** the development and test data keep the real GDFI branch names (and areas and divisions).
- **Reason:** branch names are organization data, not personal data. Borrower data stays fake.

## D-027 Financing vs Refinancing comes from keywords in the product name

- **Date:** 16 November 2026
- **Decision:**
  - The loan classification is decided by **keywords in the product name**, a business rule from the users. **Not by ProductCode / ProductID.**
  - There are two keyword lists in Settings: **Refinancing keywords** and **Financing keywords**.
    - They are matched case-insensitively.
    - Admin and Superadmin edit them; every change is audit-logged.
    - Before saving, a **"Test keyword rules"** preview lists every known product with its result.
  - **No keyword matches** → **"Can't classify"**. **Both lists match** → **"Classification conflict"**. Either way:
    - the Admin and the LA Supervisor/Head are alerted;
    - the loan **cannot be forwarded** until it is resolved.
  - **When the LA accepts a loan,** it saves its classification and the product name used.
    - If the name or the keywords later give a different result, the loan is flagged **"Classification changed since accepted"**.
    - A logged **reclassify** action (its own permission tickbox) applies the new result. The system never switches silently.
  - ProductCode / ProductID are used **only** to recognise that the same product was renamed (Reference data changes log).
- **Reason:** business rule from the users (A7.3); myloans has no classification field.
- **Replaces:**
  - any earlier code-based mapping;
  - v2 §4.1 / Chart 3 Rule 1 as built (`lib/rules/index.ts:55-64`): whole words "Refinancing" / "Financing", and **"neither word or a blank name = Refinancing"**. Under this decision, no match is "Can't classify", not Refinancing.
- **Still to confirm:**
  - the exact matching rule (Q-N16);
  - the starting keywords (Q-N17).

  Proposals and a preview are in `IMPLEMENTATION_PLAN.md` §3a. **Nothing is seeded until confirmed.**

## D-028 Piece 2 build choices (point 1 final, 17 November 2026; the rest proposed)

- **Date:** 17 November 2026
- **Decision:** while building the permission core, these points were not covered by D-002 to D-027. They were decided as below and can be changed in the matrix or by a new decision.
  1. **Superadmin default ticks:** everything **except** the loan-file work steps (LA, DP, Finance actions) and the Open Item approver ticks. Admin already worked this way.
     - The Superadmin is not offered as a processor, receiver or Finance handler, and is not told about every myloans change.
     - Any of these can be ticked in the matrix.
     - (Answers Step 1 question Q5, `FOUNDATION_CHECK.md`, for now.)
  2. **No role escalation, but staffing stays with the Admin:**
     - Someone without "Manage permissions" may give any role **except** one that can manage permissions or give All branches.
     - So the Admin can add LAs, DPs and Finance people, but cannot create a Superadmin.
  3. **"Handles CA / FT" gates every per-type funds key** (view, approve, release, settle, edit lines, change type, print), for every role.
     - Existing people were ticked to match what their role could do (migration backfill), so nobody's access changed.
     - A new person starts with neither tick.
  4. **"Can approve LA Open Items"** is a per-person override of the two myloans review keys.
     - The LA Supervisor/Head has it by default.
     - Admin keeps them until the Open Items piece (8) rewrites the review. The Unassigned queue (D-011) comes with that piece.
  5. **Reviewers of myloans changes are limited to the loan's branch** (D-011): the review key, and the branch in their access.
  6. **"Nobody is left to approve or handle this" notices** go to the people who manage access and staffing (Admin and Superadmin), not only to the Superadmin.
  7. **The D-010 migration** (`npm run roles:migrate`, dry run by default; also run by `db:create-test` and `db:reset-seed`):
     - Branch Supervisor people keep their old ticks as per-person grants. Approvers and custom funds roles become Finance with exactly the same abilities (grants and denies).
     - Admin loses "Manage permissions" only once an active Superadmin exists.
     - Roles keep their keys (SUP, FIN, VAULT, DIG, MONITOR); only their names and ticks change. Keys are internal ids that no code checks.
  8. **Approval amount bands** (D-024): built as the setting "Use approval bands by amount" (Settings, Cash-advance rules), off by default.
- **Reason:** to finish piece 2 without guessing on things that change what people can do. Each point keeps today's access unless a decision changed it.

- **Update, 17 November 2026 (review of piece 2): point 1 is final, with two Superadmins.**
  - The Superadmin's default is every setup and configuration right and **no day-to-day action**: no approving (funds or Open Items), no releasing funds, no Accept / Forward, no job work, no moving holds, no resolving problems or LTO advisories (`DAY_TO_DAY_PERMISSIONS` in `lib/auth/permissions.ts`). Any of them can still be ticked.
  - **Two Superadmin accounts are seeded** (test seed and both kits). Settings and Home warn the Superadmin when only one active Superadmin is left; the role migration says so too.
  - Point 4 changes with D-029 (Admin approves by default; no Admin fallback).
  - **Reason:** the Superadmin sets the system up and fixes access; day-to-day work belongs to the people who do it, and two Superadmins means one can always fix the other.

## D-029 Approvers: permission only, no automatic fallback to Admin

- **Date:** 17 November 2026
- **Decision:**
  1. **No fallback.** The "nobody in the branch, so Admin reviews it" logic is removed.
  2. **Approval is purely permission-based.** Anyone with the approver tick (`myloans:review`, `myloans:review_borrower`) whose access includes the loan's branch can approve. With "All branches" they see and approve every branch, including branches with no approver of their own. These are also the people told about it.
  3. **Admin's default:** All branches plus the approver tick. A Superadmin can untick it.
  4. **Branches with no approver of their own** (nobody with the tick has the branch in their own access; "All branches" does not count here): a warning "N active branches have no approver assigned." on Settings, Branches and on the Superadmin's Home, so it gets fixed. The items stay visible to All-branches approvers; there is no hidden queue. This replaces the "Unassigned queue" of D-011.
  5. **Moving holds is a default tick of the LA Supervisor/Head** (customizable). The per-person grants the D-010 migration gave former Branch Supervisors are removed by the migration, which lists every person and what they no longer have (`npm run roles:migrate`).
- **Reason:** one rule everyone can read off the matrix; nothing is routed somewhere people do not expect; a gap is shown so it is fixed rather than silently covered.
- **To note:** Finance has "Review borrower detail corrections" (`myloans:review_borrower`) by default with All branches, so under this rule Finance can decide borrower corrections for every branch and is told about them (Q-N19).

## D-030 Branch scope fixes found in the piece 2 review

- **Date:** 17 November 2026
- **Decision:** the audit of Home cards, counts, badges, to-do lists, search and exports found these leaks. All are fixed with the scope helpers in `lib/auth/scope.ts` and covered by `tests/integration/branch-scope-home.test.ts`:
  1. Home "MyLoans changes" card and the review on a loan file: limited to the person's branches.
  2. Loans list: a `?branch=` filter narrowed nothing and could replace the scope; it is now added on top of it.
  3. "Possible replacement" suggestions on a review: only loans in the person's branches.
  4. Funds lists, Finance Home counts, the liquidation report and receipts: a request is in scope only when the requesting processor's branch **and** every line's loan are in the person's access (`advanceScope`). The Finance actions (approve, release, change type, top-up, carry-over, confirm returned cash, close, edit lines) check the same rule.
  5. Funds notices (new request, release, liquidation, returned cash, Pasuyo, LTO) and "problem reported" notices go only to handlers whose access covers the request's or loan's branches. Named people (the requester, the assigned processor, the receiving LA) are told as before.
  6. Settings, Expense kinds: the "Used in N request lines" and open-request counts are of the person's branches.
- **Not changed (checked):** the audit log and the email outbox CSV are global but need Admin-only ticks; a full PN outside the person's access answers "Outside your branch access" with the branch name (by design: it says where to ask); processor capacity counts are global by design.
- **Reason:** D-019.

## D-031 Product classification: final rule (answers Q-N16, Q-N17; replaces the open part of D-027)

- **Date:** 17 November 2026
- **Decision:** the product name decides Financing or Refinancing. Matching is case-insensitive and ignores hyphens and extra spaces ("Re-Financing" = "refinancing"). Checks, in order:
  1. it contains a **Refinancing** keyword → Refinancing;
  2. else it contains a **Financing** keyword → Financing;
  3. else (no match) → the **default**, a setting (starting value: Refinancing).
- Because Refinancing is checked first, "Refinancing" never becomes Financing, so there is **no conflict state** and no "Can't classify" state.
- **Keywords** are two lists in Settings (Product classification), editable and audited. Starting values: Refinancing `refinanc`, `refi`; Financing `financ`.
- **Classified by default:** a loan classified by step 3 shows a small "Classified by default" label and is in a filter on the Loans page (for Admin), but is **not blocked**.
- **Kept from D-027:** the classification is saved when the LA opens (accepts) the loan file. A later keyword change flags "Classification changed since accepted" (was X, now Y) and the change is made only by a logged **Reclassify** action (remarks required). A myloans product rename goes through the existing MyLoans change review (Apply re-runs the rules and is logged). "Test keyword rules" in Settings previews the result for every product name on open loan files before saving.
- **Reason:** the user's final rule (review of piece 2): simplest to explain, never blocks work, and the default is visible and fixable.

## D-032 Open questions answered (review of piece 2)

- **Date:** 17 November 2026
- **Q-N3:** liquidation is due N working days after the **last** LTO completion of that fund request. (Piece 5.)
- **Q-N5:** **no test sign-in on staging**; staging uses Entra like production. (Built in piece 1: `AUTH_MODE=test` is refused outside local.)
- **Q-N7:** each hold reason has a **"Pauses TAT" tickbox**, ticked by default for reasons outside the user's control (waiting on the borrower or another department). Hold time is always recorded and shown separately. While on hold the inbox shows "Paused" instead of a countdown. (With the TAT work in pieces 4 and 9.)
- **Q-N8:** the sync runs **24/7**, for each loan **until "Loan closed/released"**. (Piece 7.)
- **Q-N9:** Accept / Forward on the **existing hand-offs now**; each new stage's piece adds its own. (Piece 9.)
- **Q-N10:** **supersede** (not update in place). (Piece 8.)
- **Q-N11:** "Processing complete" = the documents are **stored in the vault box**. "Fully paid" must come from myloans: added to `docs/MYLOANS_REPLY_2.md` as a **required** field (paid/closed status and date). "Loan closed/released" is **blocked** until myloans provides it.
- **Q-N12:** Rule 4 uses **exact decimals now**; amounts like "1,000" or "1e6" are rejected with a clear message that shows the expected format. (With the myloans parsing, pieces 6 and 7.)
- **Q-N18:** branch pool cutoff = **go-live minus 30 days**, as a setting. (Piece 7.)
- **D-024** (approval bands): still **to confirm with Finance**.
- **Reason:** the user's answers, chosen as best for users and safety.

## D-033 UX rules for every screen touched

- **Date:** 17 November 2026
- **Decision:** on every screen a piece touches:
  - messages are in plain language and say **what to do next** (for example who to ask: "Ask a Superadmin to turn on …");
  - a **disabled button shows why** on hover (and to screen readers);
  - the **inbox is sorted by least TAT remaining first**, with colour (green / amber / red). (The inbox comes with piece 9.)
- **Reason:** people should never be stuck without knowing why or who can help.

## D-034 Decisions from the review of 17 November 2026 (round 2)

- **Date:** 17 November 2026
- **Q-N19: Finance does not review borrower corrections.** "Review borrower detail corrections" is unticked on the Finance role's default. The LA Supervisor/Head and Admin decide them (D-029). A Finance person who should can be given the tick by a Superadmin. **Reason:** keeps Finance on funds; no all-branch Finance notices about borrower details.
- **Keyword tickbox "Whole word only"** (refines D-031). Each keyword matches at the **start of a word**, or, ticked, only as a **whole word**. Hyphens inside a word are ignored and a hyphen is also a word break, so "Re-Financing" = refinancing and "Pre-Financing" contains the word "Financing". Starting values: `refinanc` (starts a word), `refi` (whole word only), `financ` (starts a word). Order unchanged: Refinancing, then Financing, then the default (Refinancing, labelled "Classified by default"). "Test keyword rules" shows which keyword matched and whether it is whole-word. **Reason:** "refi" must not match "Refinery"; the user chose "start of a word" for "contains" so that "Pre-Financing" is Financing.
- **LA Supervisor/Head defaults** (branch-scoped) gain "Resolve any problem", both monitors (DP, LTO) and the TAT report. The role migration now lists, for each former Branch Supervisor whose legacy grants it removes, what is truly lost and what the role now gives back. **Reason:** the supervisors' oversight work belongs to the role, not to per-person grants.
- **React key warning on Funds** is logged as a dev-only known issue (`docs/KNOWN_ISSUES.md`); not fixed.

## D-035 Finance is branch-scoped (replaces "Finance All branches, to confirm")

- **Date:** 17 November 2026
- **Decision:**
  - The Finance role's default is **not** All branches. Each Finance person gets branch tickboxes like an LA. "All branches" means every branch, new ones included.
  - Combined with Handles CA / Handles FT: a person handles only the fund types **and** branches ticked for them (lists, counts, receipts, liquidation reports, actions and notices).
  - Edit rights (Q-N4, D-023): Admin and Superadmin assign specific branches and CA / FT; only the Superadmin ticks All branches.
  - "N active branches have no CA handler" / "no FT handler" on Settings, Branches and on the Superadmin's Home, in the approver warning's style. A handler is a Finance person (or anyone) with the type's approve or release tick and the type ticked; All branches covers every branch.
  - Existing Finance people keep the access they have (the role migration lists those with All branches); only the role's default changed.
  - Seed: Test Finance (CA + FT, All branches), Test Finance Cash (CA only, Antipolo and Angono), Test Finance Transfer (FT only, Alaminos).
- **Reason:** the user's decision; funds work follows branch scope like every other screen (D-019).

## D-036 myloans contract, round 2 (amends D-016 and D-022)

- **Date:** 17 November 2026
- **Decision:** the DMS follows myloans' round 2 contract (`docs/myloans-api-contract.sql`, reference only; `docs/MYLOANS_ANSWERS_R2.md`):
  1. ContentHash has 18 fields (18 = `ReplacedByExternalLoanId`). The DMS only compares hash strings; it never recomputes them in production.
  2. API 2 pages are cut by loan: `{ runStartedAt, items, nextAfterId }`; `nextAfterId` null is the last page; an empty page is `items: []` with null. Page 1's `runStartedAt` is kept for the run; the checkpoint (it minus 5 minutes) is saved only after every page succeeded.
  3. `RowsForThisLoan` > 1: a duplicate alert to Admin with the rows logged, and no Open Items for that loan in that run.
  4. API 1: 404 not found; 422 not selectable (FeedState and "Replaced by <PN>"); 200; 409: log all rows, use the single selectable row if there is exactly one, else "Multiple records in myloans, contact Admin." and an alert.
  5. API 3 is dropped: the Refresh button calls API 1.
  6. All 5 FeedStates are handled in API 2 as well (NotReleased can appear for an ever-released loan).
  7. Redo chains: the CIN always links to its current live transaction; a new `ExternalLoanId` for a known CIN raises "record replaced" (rule b), even if older copies are never re-sent.
  8. API 5: the full product list each sync; renames by `ProductID` re-run the keyword classification and flag the loans that flip.
  9. The mock implements the real hash (SHA-256 over UTF-16LE, lowercase hex, NULL = empty text) and the round 2 scenarios; the test of myloans' 3 vectors is skipped until they send the outputs.
  10. "Loan closed/released" stays blocked until myloans finds the paid/closed source (their check R2-4).
- **Built now:** `lib/myloans/r2/` (contract types, hash, mock, sync planning; tested). The database side (Open Items, checkpoint row, alerts, the product table) comes with pieces 6 to 8 and 11.
- **Reply:** `docs/MYLOANS_REPLY_3.md` (filtered unique indexes with `<> N''`, optional; the application_code index recommended; the NotReleased correction; 200 vs 409; re-generated test vectors; what is still needed).
- **Reason:** the agreed contract; paging by loan already protects the DMS from duplicates.

## D-037 The borrower's birth date is removed (replaces the BirthDateHash part of D-022)

- **Date:** 17 November 2026
- **Decision:** the DMS neither receives, stores nor monitors the borrower's birth date. No `BirthDateHash` / HMAC, no HMAC key setting, no "Birth date changed in myloans" Open Item. The myloans query drops `BirthDate` from its output and from the ContentHash, which becomes **17 fields** (`ReplacedByExternalLoanId` is field 17). Recorded as a deliberate v2 spec correction (`IMPLEMENTATION_PLAN.md` §14b): v2 asks for the birth date; the DMS does not keep it.
- **Reason:** not needed by the business; less personal data under the Data Privacy Act (RA 10173).

## D-038 No legacy borrower-corrections grant for Finance; keyword rule confirmed

- **Date:** 17 November 2026
- **Finance (Q-N19, D-034):** the role migration no longer carries "Review borrower detail corrections" over to people moved to Finance. It lists them in its report instead, so an admin can review and give it by hand if someone really needs it. The four migrated kit accounts (Finance Cash, Finance Transfer, Approver Cash, Approver Transfer) no longer have it.
- **Keyword rule (D-034), agreed behaviour:** unticked, a keyword must **start a word**; ticked "Whole word only", it must be the whole word. Hyphens inside a word are ignored, and a hyphen is also a word break.
- **Reason:** the user's review; Finance stays on funds.

## D-039 Piece 3 scope rules: files, jobs, funds exceptions, holds; no dead buttons

- **Date:** 17 November 2026
- **Files:** one download route `/api/files/[kind]/[id]` for receipts, stage evidence and LTO proof: session required, branch scope checked on the parent record, 404 otherwise, no public or static file URLs, and a `FileAccessLog` row for every view, download and log export. The log is append-only (a database trigger refuses updates and deletes). It is read on Audit, File access log, with the tick "View file access log" (`audit:files`), on by default for Superadmin and Admin and customizable (for example for a Data Protection Officer). Filters: user, branch, PN #, file type, date range; CSV export, itself logged.
- **Job pages:** require the loan's branch. A processor's **own** jobs stay visible anywhere; other people's jobs only when the loan is in the person's branches.
- **Funds exception:** a Finance user grants a funds exception only to processors who work in their ticked branches ("All branches" = any processor).
- **Holds and problems:** allowed on the processor's **own** job even when the loan is outside their branches (the own-job rule).
- **UX rule (extends D-033):** never show a button that leads to "not found". Either allow the action or hide it, or disable it with the reason.
- **Reason:** the user's decisions on the piece 3 audit; D-019.

## D-040 myloans contract, round 3 (amends D-036)

- **Date:** 17 November 2026
- **Decision:** the DMS follows myloans' round 3 answers (`docs/MYLOANS_ANSWERS_R3.md`; query `docs/myloans-api-contract.sql`, reference only):
  1. **ContentHash: 17 fields, confirmed** (BirthDate removed, no HMAC; field 17 = `ReplacedByExternalLoanId`). Round 3 changed freshness, not the hash: nothing to re-baseline.
  2. **SourceUpdatedAt** is the latest of the `updated_at` columns, the redo suffix time (`x<yyyymmddhhmmss>`, Manila time) and the replacement transaction's `created_at`. A redo does not touch `Transactions.updated_at`, so without this a redo of a loan that was not also cancelled would never reach API 2.
  3. Consequence for the sync: the **oldest copy of a redo chain is re-sent** (as Superseded, with the newest replacement). When the replacement is in the same run, the CIN link raises one "record replaced" and nothing else; when it is not, the decision is "superseded" and the sync fetches the replacement with API 1 (amends D-036 item 7).
  4. **API 1 with more than one row is always 409 with every row**, whatever their states. The DMS reading is unchanged (log all rows; use the single selectable row if there is exactly one, else "Multiple records in myloans, contact Admin.").
  5. Still to verify by myloans: that cancel and deactivate always update `updated_at` (`docs/myloans/myloans_round3_checks.sql`), and that no other code path changes status or `is_active` without it.
- **Built now:** `lib/myloans/r2/` (`redoSuffixAt`, `sourceUpdatedAtOf`, the planner's "superseded" decision) with the scenarios "redo without cancellation, seen only through the suffix time" and "redo chain of 3 whose oldest copy is re-sent". Plan §7.3.
- **Reason:** myloans' finding that 22 of 29 superseded copies have an `updated_at` earlier than their suffix time.

## D-041 Piece 4: one working-days calendar, closures, saved due dates (builds D-018; Q-N7 of D-032)

- **Date:** 17 November 2026
- **Decision (the user's, after checking nine worked examples):**
  - **One calendar service**, Manila dates, used by TAT, liquidation, the sync, reports and the job lists (the inbox in piece 9). All other day-counting code is removed.
  - **Working days:** Mon to Sun tickboxes, default **Mon to Sat** (Saturday on).
  - **Holidays:** date, name, type (regular / special non-working / local), for all branches or ticked branches. Admin and Superadmin edit; audited. Only **sample** dates are seeded, labelled "Sample. Enter the official list from the government proclamation."; no real holiday dates are guessed.
  - **Office closure:** a quick action for one date and selected branches (typhoon, sudden declaration) with a reason; a non-working day for those branches.
  - **Counting:** by Manila date; the working days after the start date up to and including the end date. Accept and forward on the same day = 0. Due = the end of the due date (23:59 Manila).
  - **Whose calendar:** LA work, the loan's branch; a DP job and liquidation, the processor's branch; Finance, the requesting processor's branch.
  - **Holds:** a hold reason ticked "Pauses TAT" stops the clock. Paused days = the working days after the hold day up to and including the resume day; in plain words wherever pauses appear: "The day you put it on hold counts; the day you resume doesn't." While paused the lists show "Paused" instead of a countdown. Hold time is always shown separately.
  - **Saved due dates:** saved at accept; recalculated only through the logged extension rule below or an explicit, logged admin correction.
  - **Late-added holiday or closure:** an open item is extended when the new non-working day falls **inside its counting window** (after its start date, up to and including its due date), **even if it is already overdue** (the closure may be what made it late). Items whose window does not contain the date are unchanged. A back-dated entry (date before today) needs a reason, is allowed up to N days back (setting, default 7) and only for Admin and Superadmin. The preview says "This will extend N items (M currently overdue)". Each change is logged and each owner notified. Saved due dates such as liquidation follow the same rule.
  - **Colours:** green with 2 or more working days left, amber with 1 day left or due today (the amber point is a setting, default 1), red when late, grey "Paused".
  - **Lists:** the current Jobs lists are sorted by due date, overdue and soonest first. Waiting time and the full inbox stay in piece 9.
  - **Liquidation:** the new calendar now; piece 5 changes the start point to the last LTO completion (D-017, Q-N3).
  - **Mon-Sat default:** due dates move from Mon-Fri to Mon-Sat (test data only so far).
- **Reason:** D-018; one calendar for everyone; a closure must never make work look late.

## D-042 Calendar fixes after piece 4: every path, reversal, corrections, screenshots on purpose

- **Date:** 18 November 2026
- **Decision (the user's):**
  1. The **holiday CSV import** uses the same Check then Save preview and extension rule as Settings ("This will extend N items (M currently overdue)"); back-dated rows follow the same reason and 7-day limit. **No path** adds a non-working day without the rule (the generic settings save refuses holidays; Make inactive / active goes through the rule).
  2. **Making a holiday or closure inactive** reverses ONLY the extensions that entry caused: per item, by the working days it took from the item's window, logged (linked to the extension it undoes), owner told, with the same preview. Making it active again extends like a new one.
  3. **Admin due-date correction:** one item at a time, reason required, tick "Correct due dates" (`duedates:correct`, default Superadmin and Admin), shown in the item's due-date history, logged, owner told.
  4. **Screenshots:** committed once ("docs: refresh screenshots"); normal e2e runs no longer write them; `npm run docs:screenshots` refreshes them on purpose.
- **Built:** `lib/services/calendar.ts` (tx-level add / set active, reversal, `correctDueDate`, exact previews by a rolled-back run), the import's holiday columns (type, branches, reason), migration `20261119090019_due_date_reversal` (`DueDateChange.reversesChangeId`, the new tick on Admin and Superadmin).

## D-043 A removed holiday also undoes the moves it set off (confirms D-042 item 2)

- **Date:** 18 November 2026
- **Decision:** when a holiday or closure is made inactive, the item goes back to the due date it would have had without it, even when that entry had pushed the item into another non-working day. Example (confirmed by the user): due Fri 4 Dec; a holiday on Wed 2 moves it to Sat 5; a closure on Sat 5 moves it to Mon 7; making the holiday inactive brings it back to **Fri 4**, because without the holiday its count never reaches the Sat 5 closure. The closure's own history line stays.
- **Reason:** "only the extensions that day caused" includes the ones that would not have happened without it.

## D-044 Piece 5: liquidation due date (builds D-017; Q-N3 of D-032)

- **Date:** 18 November 2026
- **Decision (the user's, after the worked examples):**
  - Due **N working days after the last LTO pickup** of the advance's lines, N per type (cash advance, fund transfer; default 2; 0 to 30; audited), on the requesting processor's branch calendar; saved on the advance; a setting change moves no existing advance. Until it can be computed the advance shows what it waits for, never a date and never overdue.
  1. An LTO redone or cancelled **after** the due date was saved: the saved date **stays**. Cash for a redo is a top-up or a new advance; more time only through a carry-over or Correct due date (logged).
  2. A line whose transaction is **cancelled before its LTO**: due N working days after the **later** of the last pickup and the cancellation. All lines cancelled: due N working days after the last cancellation (the cash must be returned).
  3. **Carry-over** follows D-017: due N working days after that attempt's LTO pickup (not the decision day); the fallback below applies.
  4. A **note-only line** (no transaction): due N working days after the release.
  5. **The LTO never happens:** a fallback due date = the job's TAT due date + N working days (it moves when the TAT due date moves, for example after a pausing hold, and stays once set even if the LTO is then done). When it applies the advance shows "LTO not done. Liquidation due by fallback", and Finance (the CA / FT handlers of that branch) and the LA Supervisor/Head are alerted.
  6. **The late record:** the due date, the liquidated date and the working days late are saved on the advance and shown in Funds and the TAT report. Days late count like every TAT: the working days after the due date up to and including the liquidation day (due Fri 27, liquidated Mon 30 = Sat 28 and Mon 30 = **2 working days late**; Saturday is a working day). v2 demerit points (a later phase) will read this record.
  - **Removed:** the setting `funds.liquidationDueDays` (10), the TAT row `P4_LIQUIDATE` (5) and its fallback, the column `CashAdvanceRule.liquidationDays`.
  - **UX (the user's instruction):** keep it simple. One line per advance in plain words: "Due Fri 27 Nov", "Due 2 working days after the LTO pickup (1 of 3 left)", "LTO not done. Liquidation due by fallback: Mon 30 Nov", "Liquidated 2 working days late". No new screens; the two values are on Settings, Funds types.
- **Reason:** D-017 and the user's answers to the six open questions.

## D-045 Build order: the myloans pieces wait for staging access

- **Date:** 18 November 2026
- **Decision (the user's):** pieces **6, 7, 8 and 10** (myloans mock APIs, the sync, Open Items, PN # search) are **on hold, waiting for myloans staging access (C5)**: we test against the real myloans API before building more of it. The new order: **piece 9 next** (Accept / Forward, inbox, TAT); then 6, 7, 8 and 10 when staging access arrives; piece 11 when the product list (R2-3) arrives.
  - Piece 9 is built on the loans already in the DMS. The branch pool's "Released, not yet in the DMS" loans come from the sync later: piece 9 leaves one clear hook for that feed and builds no sync.
  - Piece 9 scope also includes **Correct due date on LA work items** (the same rule as D-042: one item, a reason, the tick, in its history).
  - The funds-types CSV import gains "liquidation_due_days" (whole number 0 to 30; blank keeps it, new types 2).
- **Reason:** testing against the real API first avoids building twice; staging access is not there yet.
