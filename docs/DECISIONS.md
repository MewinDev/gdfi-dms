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

## D-046 Piece 9: inbox, branch pool, Accept / Forward, TAT per person (builds D-014, D-015)

- **Date:** 18 November 2026
- **Decision (the user's, after six worked examples):**
  - **Inbox items:** every hand-off is an item with its history (arrive, accept, forward, return, move), times set by the server. New work lands in a **branch pool** or, when a person is named, in that person's **inbox**; **Accept** makes it theirs and starts their round. One list per person ("My items") sorted by least time left, with the green / amber / red / Paused colours; one **Branch pool** list with Accept.
  - **TAT per person:** accept to forward, on the work's branch calendar (D-041); **waiting time** (arrival to accept) recorded separately and never counted against the person.
  1. **Pool waiting is coloured:** amber after 1 working day, red after 2 (settings). The supervisors' Home says "N items waiting in the pool too long".
  2. **Returns:** a reason is **required** (the existing return reasons; decline keeps its reasons). The next round gets a **fresh full target**. Returns per person appear in the TAT report.
  3. **Away and moving work:** each user has an **Away** status with from / to dates, set by the person or by someone with the tick "Set who is away". While away the person cannot be named for new work, and supervisors see "N items are with people who are away". **"Move work items"** (default LA Supervisor/Head and Admin): **Back to the pool** or **Give to…** someone of the same work role with access to the branch. A move closes the old person's round as **"Moved (away)"**, never counted late; the new person's round starts at the move with a fresh target; the item's overall due date is unchanged; each move is logged and both people are told.
  4. **Find loan** (until the feed exists): arrive and accept at the same moment (waiting 0; the LA's TAT starts).
  5. **"Counts as Accept":** Finance's Approve / Release and the receiving LA's Receive take the item; there is no extra click. For these the reports measure **waiting time** (arrival to the action), labelled so.
  6. **DP jobs:** a **named DP** (the default, as today) or the **Branch DP pool** (any processor with access to that branch can accept; the first accept wins). Built so that a pool job waits as an inbox item holding the send details; Accept creates the normal named job for that processor and accepts it in the same moment, so everything after it works as today.
  7. **Existing open work** becomes inbox items from the recorded times; where a time is missing the item is marked **"Migrated"** and left out of TAT performance reports.
  - **Correct due date** also on LA items (D-042 rule).
  - **The feed hook:** one function receives "Released, not yet in the DMS" loans into the branch pool; the sync (piece 7, on hold) will call it. No sync is built.
- **Reason:** D-014, D-015 and the user's answers.

## D-047 Build order: the myloans pieces are built on the mock (replaces D-045)

- **Date:** 18 November 2026
- **Decision (the user's, after piece 9 was approved):** pieces **6, 7, 8 and 10 are un-held** and built on the myloans mock, in this order:
  1. **6:** mock APIs 1 to 5 (plan first, confirmed before building);
  2. **10a:** PN # search and the Search Log, through API 1 on the mock;
  3. **7:** the sync on API 2;
  4. **8:** Open Items per field;
  5. **10b:** connect the piece 9 feed hook ("Released, not yet in the DMS") to the branch LA pool;
  6. **11** when the product list (R2-3) arrives;
  7. **12** (docs, kit, e2e, final checks) with each piece.
- Two items stay **separate and blocked**: **Real API verification** (the contract tests and a sync dry run against myloans staging; blocked on staging access, C5) and the **Production scheduler** (the sync and daily jobs on the real hosting; blocked on the hosting decision).
- **Reason:** staging access is not in sight; building on the agreed contract with tests that can later run against staging keeps the foundation moving without building twice.

## D-048 Before piece 6: pool colour settings, the mock's limits, the demo

- **Date:** 18 November 2026
- **Decision (the user's, approving the piece 6 plan, IMPLEMENTATION_PLAN.md section 7.4):**
  - **Pool colour thresholds** get a small Settings card now, before piece 6: amber and red after N working days, validated (red after amber), audited.
  - **(a)** The myloans **mock may run on staging**, never in production. While the mock is on, every page shows a clear **"MOCK myloans data"** banner.
  - **(b)** The mock's data lives in **its own local-only table**, not in settings.
  - **(c)** The **staging contract run is by hand**, read-only, and kept out of CI. The staging key is never stored in the repo.
  - **Failure simulation** controls are refused and hidden in production.
  - **Demo script:**
    - show **both approval flows**, so the users can settle D-024 ("Which approval flow should we use?"):
      - bands on: an approver approves, Finance releases;
      - bands off: Finance approves and releases;
    - use the **current role names** (LA Supervisor/Head; approvers by their ticks), renaming kit accounts where needed;
    - seed a few **aged demo items**, so the Inbox and the pool show amber, red and Paused, not only green.
- **Reason:** the user's answers to the piece 6 plan and the demo review.

## D-049 Product classification kept simple; the daily catch-up sync; round 4 checks

- **Date:** 18 November 2026
- **Decision (the user's):**
  1. **Product classification** (amends D-031, D-034):
     - **Keywords:** as before, plus the Financing keywords **"brand new"** and **"2nd hand"** (multi-word phrases are supported). "Test keyword rules" runs over **all active products**, before and after. Expected: 20 products move from "Refinancing (default)" to Financing, and nothing else changes.
     - **One tick, "Manage product classification"** (the key `settings:classification`): edit the keywords **and** set any product to Financing or Refinancing. A setting on a product **overrides the keywords**. A reason is required, and every change is audit-logged. On by default for LA Supervisor/Head, Admin and Superadmin; customizable like every tick.
     - **Only two choices:** Financing or Refinancing. No other states.
     - **Unclear products are not pre-set.** The LA Supervisor/Head sets them on the screen once decided. The screen shows a small **"Please confirm"** note on:
       - SME - Car Financing (R);
       - Personal/SME REM Financing;
       - the three real-estate "Take Out" products;
       - the Doctors, Salary and Tricycle loans.
     - **Data:** `docs/incoming/myloans-round4-results/pr_products.tsv` is the mock's API 5 data and the kit's product list.
     - **Tests:**
       - the 20 "2nd hand" / "brand new" products become Financing;
       - "SME - Refinancing Heavy Truck" stays Refinancing;
       - a manual setting overrides the keywords;
       - a rename keeps the manual setting;
       - a user without the tick cannot change it.
  2. **Time-zone safety (added to the piece 7 plan, not built yet):** a **daily catch-up sync run**, by default at 02:00 Manila, asks API 2 for everything changed in the last **26 hours** (a setting). It uses the same logic as the normal run (the same hash means no action). It protects against wrong time labels, missed runs and clock problems, and it is logged in the sync run log like the other runs.
  3. **Round 4 checks recorded:**
     - **Cancel / deactivate update `updated_at`:** CONFIRMED. 37 of 42 changed within 18 ms; the other 5 were updated later.
     - **The mid-June time offset change:** covered by the daily catch-up.
- **Reason:** the user's decisions after the round 4 results.

## D-050 Piece 10a: the plan's recommendations (the user said "continue with piece 10a")

- **Date:** 18 November 2026
- **Decision:** piece 10a is built as planned in `IMPLEMENTATION_PLAN.md` 11.1, with its three recommendations (the user approved continuing; open to change on review):
  - **(a) Fields the agreed contract does not send:**
    - **Address and contact number** stay DMS fields. myloans does not send them yet; a new request asks myloans to add them. Until then a Refresh never treats them as changed.
    - **The vehicle** is a DMS-entered field.
    - **The replacement guess** (previous PN) goes. A redo is read from myloans' own link (Superseded / Cancelled with "Replaced by"). The automatic "Link as replacement" suggestion goes with it.
    - **Payment recorded** stays unknown.
  - **(b) The PN search log:** a new tick **"See PN searches"** (`reports:pnsearch`), on by default for Admin and LA Supervisor/Head, limited to the reader's branches.
  - **(c) Two small items:**
    - exact decimals for rule 4 (refuse "1,000" and "1e6", compare as decimal strings);
    - one active transaction per type on a loan (a partial unique index).
- **Reason:** the user's instruction to continue after the 10a plan.

## D-051 Piece 10a: the user's answers (replaces D-050 where they differ)

- **Date:** 18 November 2026
- **Decision (the user's):**
  1. **The replacement guess is removed.** The "additional unit / replacement" tags and the "payment recorded" check go for now. A redo shows only from myloans' own "Replaced by" link. The **existing manual linking** in Related loans stays (Admin, "Link as replacement", with a note and "I confirmed no payment was made on the old PN"). No new linking is built. STATUS, Phase B: "Related-loan tags (additional unit / replacement) return with vehicle data from myloans."
  2. **The borrower's address and contact number are removed completely:** the fields, the database columns (by migration), the screens, the kit and seed, the docs and the demo script. They are not kept as empty fields. **Reason:** not needed; data minimization under the Data Privacy Act (RA 10173), as for the birth date (D-037). The borrower-details review covers name, CIF and CIN only.
  3. **Find loan for a PN that is not a released loan** (API 1 422): approved as built. The card gives the reason only (myloans' status name and FeedState, "Replaced by" after a redo), with no borrower name or branch. Status 15 is "not a released loan".
  4. **Earlier decisions confirmed:**
     - **Vehicle details:** hidden, and moved to the Phase B Collateral module.
     - **Renewal link** (previous loan / OldPNNo): deferred to Phase B. No "other loans of this borrower" warning on Find loan, and no new linking now.
     - **Payment recorded:** unknown; the paid / closed source is parked for Phase C.
  5. **Products:** `docs/incoming/myloans-round4-results/pr_products.tsv` (104 products, 88 active) is the mock's API 5 and the kit's product list.
     - **"Test keyword rules"** over the 88 active products: exactly **20 move from Refinancing (default) to Financing** (the "2nd hand" and "Brand New" truck and van products), and nothing else changes. "SME - Refinancing Heavy Truck" and "WSME - Refinancing Heavy Truck" stay Refinancing.
     - **"Please confirm"** marks the 12 undecided products:
       - SME - Car Financing (R);
       - Personal and SME REM Financing;
       - the three real-estate take-outs (REF Developer In-House, REF Division / REM, Developer Real Estate In-House);
       - the four Doctors loans;
       - Personal Salary Loan;
       - Tricycle Loan.
- **Reason:** the user's answers after the 10a report.

## D-052 Product classification final; 10a notes; piece 7 approved

- **Date:** 18 November 2026
- **Decision (the user's):**
  1. **Product classification, final** (updates D-049 and D-051):
     - **The automatic keyword rule decides:**
       1. Refinancing words in the name → Refinancing;
       2. otherwise Financing words → Financing;
       3. no matching word → Refinancing (automatic).

       No products need confirming in advance: the **"Please confirm" markers and their list are removed**.
     - **"Classified by default"** (no matching word) keeps its label and filter, so supervisors find and check those quickly.
     - **"Manage product classification"** is on by default for the **LA Supervisor/Head only** (off by default for Admin and Superadmin). The Superadmin can grant it to others (for example an LA) in the permission matrix.
     - **Changing a product's classification always requires a reason, for anyone.** It is logged and shown in the product's history.
     - **Reason:** keep it simple; the rule decides, and people correct a product with a reason.
  2. **Notes on 10a:**
     - **Old audit-log rows with an address or contact number:** no action. The DMS is not live and they are fake test data. Confirmed: no production code can write an address or contact number anywhere, the audit log included.
     - **"Same borrower" in Related loans** is the existing Related loans card (other loans with the same CIN or CIF, within the reader's branches), with its guessed tag replaced by a neutral label. It is not new.
  3. **Piece 7, myloans sync on API 2: approved.**
     - **(a)** As a short bridge until piece 8, API 2 changes raise today's review items, one per loan. **Nothing is applied automatically** (strict v2). Only people with the approver tick for the loan's branch can act, and items show the changed fields.
     - **(b)** The old tiered background refresh retires: its code and settings are removed, so there is one sync path. Find loan and Refresh stay on API 1.
     - **(c)** Released loans not yet in the DMS are stored, only those released on or after the branch-pool cutoff (a setting, default go-live minus 30 days), keeping only what the pool card needs. They are shown in the pool in 10b.
     - **Scheduler:** the hosting is not decided. The sync is one command / entry point that any scheduler can call (Windows Task Scheduler, cron, a cloud scheduler); in development an in-app timer is fine. `docs/SCHEDULER.md` shows each option. Runs never overlap (a lock).
     - **Daily catch-up:** 02:00 Manila, the last 26 hours (settings).
- **Reason:** the user's decisions after the 10a report.
- **How it was built (18 November 2026), choices within the decision:**
  - A change run every **30 minutes** (the interval already decided for the sync, editable); the scheduler may call every 5 minutes and the sync decides what is due (the catch-up first, else a change run when the interval passed).
  - **Admin is alerted after 3 failed runs in a row** (a setting). A failed run keeps the checkpoint, so nothing is lost.
  - **Until go-live is set, the branch-pool cutoff is 30 days ago** (go-live minus 30 days once set; a cutoff date can be set directly).
  - **The first load (pool mode)** runs from the console only (`npm run sync:myloans -- --first-load`); Settings has Run now and Run the catch-up now.
  - **What counts as a change is the contract's ContentHash.** A field outside its 17 fields (area, division, company) is not seen by the sync on its own; it reaches the loan with the next change or a Refresh from MyLoans.
  - A loan sent twice in one run raises nothing and notifies Admin (ask the myloans team).
  - Removed: the tier columns, the old background refresh (business hours, cap per run, pause between calls, adaptive cap) and their settings; the hourly call ceiling stays for API 1 (Find loan and the refreshes of one loan).


## D-053 Piece 7 accepted; renames are lookup data (correction); piece 8 approved with four additions

- **Date:** 18 November 2026
- **Decision (the user's):**
  1. **Piece 7 approved**, with its choices: a change run every 30 minutes; the branch-pool cutoff is "30 days ago" until the go-live date is set; the first load runs from the console only; area, division and company are not in the ContentHash.
  2. **Correction (D-012, Q7):** changes to the area, division, company, branch and product **names** are lookup data. They never become review items or Open Items: they update automatically and are written to **Reference data changes**. Piece 7 had held them for review (strict v2, D-052 (a)); that is fixed.
  3. **Piece 8, Open Items: approved**, as planned (one pending item per loan and field, a database rule; supersede on a newer change; loan type, amount, product and release date decided together with the rule effect shown; remarks of 5 to 500 characters to approve and to reject; an Unassigned queue for branches with no approver; a banner on the loan file; the old review pop-ups removed and the development items moved), with four additions:
     1. **Reverted in myloans:** when myloans puts a field back to the DMS value while an item is pending, the item is closed as "Reverted in myloans" (logged; the approvers are notified).
     2. **Forward is blocked for every move away from Released** (Cancelled, Inactive, NotReleased, Superseded / replaced), not only a cancellation (D-013, Q8). The loan file says why.
     3. **Renames never create Open Items:** they are shown only on the Reference data changes page.
     4. **Waiting time:** each Open Item shows how long it has waited in working days, green / amber / red, oldest first. Home shows approvers "N Open Items waiting too long".
  4. **Tests:** the plan's list (§9.8) plus the four additions. During tests the development sync timer is off (`MYLOANS_SYNC_DEV_TIMER=false` for the e2e server; vitest starts no server).
- **Reason:** the user's decisions after the piece 7 report. A rename is not a change to the loan (D-012); a loan that left Released must not move on until a person decides.
- **How it was built (18 November 2026), choices within the decision:**
  - **Who decides:** loan fields with "Review MyLoans changes" (`myloans:review`), borrower name, CIF and CIN with "Review borrower detail corrections", each for the branches in the person's access. Unassigned = a branch with no approver of its own (All-branches approvers do not count there); the Superadmin and All-branches approvers see it.
  - **Status:** Approve closes the loan (refused while cash is out: ask for the cash back first); Reject keeps it open and unblocks it. The processor's Forward to branch is blocked while the status item is pending (a closed loan's papers can still go back).
  - **Waiting colours:** the inbox thresholds (Settings, Inbox waiting colours), on the loan branch's calendar.
  - **Monitored fields:** Settings, Open Items (myloans:manage); the status is always watched.
  - **Replacement:** the old loan's status item says "replaced by"; linking stays on Related loans (with the no-payment confirmation); the per-item Link, Apply and Keep current buttons are gone with the review pop-up.
  - **Renames from API 4 and API 5** (area, division, product) are logged in Reference data changes too.
- **Update (18 November 2026, the user's, after the piece 8 report): piece 8 approved with one correction and one change.**
  1. **Correction: what approving a status item does depends on the status.**
     - **Cancelled:** Approve closes the loan file (refused while cash is out). As built.
     - **Redone / replaced** (the same CIN, myloans' ReplacedBy): Approve **re-links the same loan file** to the replacement: the new PN # and the new ExternalLoanId. The old PN # and id stay in the loan's history; papers, jobs and work items stay with the loan file. It is **not** closed. The link comes from myloans by itself; linking by hand on Related loans stays only for unclear cases.
     - **Not released / Inactive:** Approve puts the loan **on hold** ("On hold: not released in myloans"): blocked, not closed. When myloans shows it Released again, the hold ends by itself, logged as "Reverted in myloans", and the approvers are told.
     - The decision card says what Approve will do before it is pressed ("This will close the loan file", "This will move the loan file to PN ...", "The loan stays on hold until released again").
  2. **Open Items in the top menu,** with the pending count, only for people with "Review MyLoans changes" or "Review borrower detail corrections" (both on by default for the LA Supervisor/Head and Admin).
  3. **Piece 10b approved,** with one addition: a "Released, not yet in the DMS" pool item's waiting time starts when it **entered the pool** (the sync), not at the release date, so the first load does not turn everything red on day one; the release date is shown on the card separately. The rest as planned: branch matching (an unmatched branch goes to the Branch review, with a Home warning for Admin), Accept opens the loan file, the item leaves the pool for each reason, one item per PN, the amount only for people allowed to see amounts, branch scope.
  - **Reason:** a redo is the same loan under a new PN (the papers and work belong to it); a loan not released may come back; closing is only right for a cancellation.
  - **How it was built (18 November 2026):** the re-link asks myloans (API 1) for the replacement PN when Approve is pressed and refuses if it is not a released loan now, or if that PN is already a loan file here (then link the two on Related loans; once linked by hand, Approve closes the old one as replaced). Myloans' new copy becomes the loan's baseline; a field it changed (other than the status) is its own Open Item. The hold is a column on the loan (`sourceHold`, migration 030); the loan file, Send, Forward and new cash say "On hold: not released in myloans ...". For 10b, a released loan waiting for an unknown branch enters the pool at the first sync after the branch exists in the DMS.

## D-054 Piece 11 approved, with three additions; the piece 8 correction, Open Items menu and 10b approved

- **Date:** 18 November 2026
- **Decision (the user's):**
  1. **The piece 8 correction, the Open Items menu and piece 10b are approved** as built (D-053).
  2. **Piece 11 approved** as planned: branches from API 4 and products from API 5, on the mock through the same client; a daily run from the scheduler entry point; a failed read keeps the last list; renames logged; inactive never deleted; the LTO-PASIG sample badge; Settings shows when each list was last read, with "Read the list from myloans"; contract tests. With three additions:
     - **Match branches by myloans' BranchID, not the code.** Each DMS branch keeps the myloans BranchID, and every match uses it (the loan feed, the 10b pool, the branch sync). The code is for display only: a code change is a logged change (Reference data changes), never a broken match. The 10b pool matching switches to the BranchID too.
     - **A branch closed in myloans:** its existing loan files, jobs, inbox items and history stay fully accessible to people with access to that branch. Only NEW pool items stop. Admin's Home warns: "Branch X is closed in myloans but has N open items".
     - **A new product from API 5** is classified by the keywords, and the people with "Manage product classification" (default the LA Supervisor/Head) get a notice: "New product: <name>, classified as <Financing/Refinancing>[ by default]".
  3. **At the end:** full vitest and full e2e, tsc, lint; commit; push; stop before piece 12 with a short plan and an updated STATUS.md (done, blocked and by whom, what remains to a Phase A go-live).
- **Reason:** a branch code can change in myloans; the BranchID cannot. Closing a branch must not hide work already in the DMS. People who classify products should know when a new one arrives.

## D-055 Piece 12: backups, security headers, volume test, runbook, UAT; no privacy notice; module checklists

- **Date:** 18 November 2026
- **Decision (the user's):**
  1. **Backup and restore cover the database AND the uploaded files** (receipts, stage evidence, LTO proof), with a timestamp and a checksum list; `npm run backup` and `npm run restore`. The target comes from configuration: a folder (a disk or NAS) or an S3-compatible bucket (keys from the environment, never in the repository). Retention is a setting. A rehearsal proves a restored receipt opens through the file route. The runbook has a section per hosting option (on-premise disk / NAS plus off-site; cloud object storage with versioning; Supabase) and the 3-2-1 rule.
  2. **No privacy notice** is needed; it is removed from the plan and STATUS if listed.
  3. **Security headers, minimal and compact:** one config with CSP (self and what the app truly needs), HSTS (production only), `X-Content-Type-Options: nosniff`, `frame-ancestors 'none'` / `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`; the session cookie Secure (production), HttpOnly, SameSite=Lax. One test. Nothing else.
  4. **A volume test** on a separate seed variant (not the normal kit): about 15,000 loans with pool items, Open Items and file-log rows; the main screens measured; anything slower than about 2 seconds fixed; before and after timings reported.
  5. **A go-live runbook** (with a rollback plan) and a **UAT checklist** per role.
  6. **Module checklists** (`docs/checklists/`, one file per module, an index) and a **Phase A gap summary** (`docs/PHASE_A_GAPS.md`); docs only, no gap is fixed until the user decides. From now on every piece or fix updates the matching checklist file in the same commit (CLAUDE.md).
- **How it was built (18 November 2026):**
  - Backup target: `BACKUP_TARGET=folder` (`BACKUP_DIR`, default `./backups/sets`) or `s3` (`BACKUP_S3_ENDPOINT`, `_BUCKET`, `_REGION`, `_ACCESS_KEY_ID`, `_SECRET_ACCESS_KEY`, `_PREFIX`; path-style, Signature V4, so AWS S3, Cloudflare R2, Backblaze B2, Wasabi, MinIO and Supabase's S3 endpoint all work). Retention is the environment setting `BACKUP_KEEP_DAYS` (default 30; the newest set is always kept): it belongs to the server, not to an in-app screen, because backups run outside the app.
  - A set is `gdfi-dms-YYYYMMDD-HHMMSS/`: `db.dump` (pg_dump custom format), `files/<storage root>/...`, `manifest.json` (database, migrations, every file with its size and SHA-256). Restore checks every checksum first and only ever goes into a clean copy (a new database and an empty folder), never over the database in use.
  - pg_dump / pg_restore run from the server's PATH; on a developer PC, inside the Docker database container.
  - Security headers: one function (`lib/security/headers.ts`) wired in `next.config.ts`; the CSP allows the Microsoft sign-in form target and inline scripts and styles (Next.js needs them without nonces). The session cookie already complied.
  - Volume test: its own database `gdfi_dms_volume_test` (`npm run volume -- create | measure`), 15,000 loans, 30,000 transactions, 26,000 work items, 6,000 processor jobs, 2,000 pool loans, 4,000 Open Items, 60,000 file-log and 30,000 audit rows. Every screen measured under 100 ms (the slowest: TAT report 97 ms, Jobs list 89 ms, Loans list 86 ms); nothing needed fixing.
  - Scheduling is in one doc (`docs/SCHEDULER.md`: the sync, email reminders, the backup); `docs/myloans/scheduling.md` points there.
  - The test simulator gained "Set the loan not released" and "Set the loan released again", so testers can try the hold outcome by hand (kit items 43 to 45). `db:reset-seed` is unchanged; pools are filled by `npm run sync:myloans -- --first-load` afterwards (README).
  - New e2e: role by screen (each role's menu; pages outside it are Not found, which a page with a loading screen shows with status 200) and the Open Items outcomes (reject, not released then released again, redo) with pool to loan file.
  - Checklists (`docs/checklists/`, 24 modules and an index) and `docs/PHASE_A_GAPS.md` record proposals only (G1 to G9, S1 to S13, questions Q1 to Q10); nothing in them is built until the user decides.
- **Reason:** files without their database rows (or the reverse) cannot be used; a restore that can overwrite live data is a risk on the worst day.


## D-056 Phase A gaps: decisions and working defaults

- **Date:** 19 November 2026
- **Decision (the user's, on `docs/PHASE_A_GAPS.md`):** items marked **[TO CONFIRM]** are working defaults until the business confirms them; each is built to be changed in Settings or with one small change. All of them are listed in `docs/BUSINESS_QUESTIONS.md`.
  1. **DP receipt confirmation: built for go-live.** For a funds type that sends money to an account (Fund transfer: "needs account"), after the release the processor confirms receipt by typing the reference number, the amount and the last 4 digits of the account. All three match: confirmed, logged. Any difference: flagged to Finance (the handlers of that type and branch) with what was typed and what Finance recorded, logged; Finance clears it with remarks, or the processor confirms again once it matches.
     - Not a gate by default: the LTO stage does not wait for the confirmation (setting `funds.blockLtoUntilReceiptConfirmed`, off). **[TO CONFIRM with Finance]** whether the LTO must wait (v2 §5.7 says it does).
  2. **Cancel transaction:** a new tick "Cancel transaction" (`transactions:cancel`), default **LA Supervisor/Head and Admin** (not the Superadmin: day-to-day work, D-028). A reason (5 to 500 characters) is required; the cancel is logged. Any transaction not done and not already cancelled can be cancelled: open processor jobs stop (the processor is told), its work items close, the loan's stage is recomputed. **If cash was already released for it, the cancel is allowed and the cash stays owed:** liquidation is due N working days after the later of the last LTO pickup and the cancellation (D-044 item 2). The confirm step says so, with the request number and the amount. Cash asked for but not yet released is shown on the confirm step too; Finance decides it.
  3. **The four optional transactions** (Cancellation of Mortgage, Transfer of Ownership, Renewal of OR, PPSR Termination) are seeded as transaction types the Loan Associate adds by hand (Add a transaction; not created by the rules), each with v2 §4.6's paper list (all required), needing a processor and the LTO. Checklists stay editable in Settings. **[TO CONFIRM with the LA Supervisor/Head]** the papers. The available / unavailable matrix by result (v2 §4.5) waits (PHASE_A_GAPS S6).
  4. **Fund request: keep today's model** (one request per processor covering several jobs; lines per expense kind with presets). The v2 formula (fee table + km × rate + meals) is not built. Added to the v2 spec corrections list (`IMPLEMENTATION_PLAN.md` §14b). **[TO CONFIRM with Finance and Operations]**
  5. **FT receiving account:** the processor enters it when requesting (v2): bank or e-wallet, account name and account number. Finance sees it in full **only on the release screen**, ticks "I checked the receiving account" and releases. The full number is kept only until the release and then cleared; the last 4 digits stay. Everywhere else it shows as "account ending 1234". A request made before this change, or changed to a fund transfer by Finance, has no account from the processor: Finance types it at release as before.
  6. **(a) Forward does not wait for liquidation** (as built: papers keep moving; an overdue liquidation already blocks new cash). **(b) A fund transfer is liquidated with receipts, like a cash advance** (as built: "must liquidate" on both types). **[TO CONFIRM with Finance]** (b).
  7. **Required papers stay per transaction type** (as built). **[TO CONFIRM with the LA Supervisor/Head]**; the four built-in types keep today's papers, and how they differ from v2 §4.6's samples is a question in `docs/BUSINESS_QUESTIONS.md`.
  8. **Reports:** the 11 usable reports are enough for go-live; CSV only (no PDF).
  9. **TAT targets:** LA 1 working day (Checklist complete, Assign to DP), DP 5 (Notary, PPSR registration, Mortgage), Finance 1 (cash advance release) as the seeded defaults. Databases that still have the earlier seeded values get the new ones (migration 032); a value an Admin already changed is kept. **[TO CONFIRM with the LA Head and Operations before UAT]**
- **Not built until IT answers Q10:** the cloud file driver and myloans OAuth.
- **Reason:** the user's decisions on the Phase A gap summary (D-055).
