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


## D-057 The build and the pages call no outside host: fonts self-hosted

- **Date:** 24 November 2026
- **Decision (the user's):** after `next build` failed because Google Fonts could not be reached (the final D-056 e2e run had to wait), the build must not depend on Google Fonts.
  - **Inter is self-hosted:** `app/fonts/inter-latin-wght-normal.woff2` (the same Inter variable font, latin, weights 100 to 900, that Google Fonts served) with its licence `app/fonts/Inter-OFL-LICENSE.txt` (SIL Open Font License 1.1, which allows bundling). `app/layout.tsx` uses `next/font/local` with the same CSS variable (`--font-inter`) and `display: swap`, so the look does not change. The file was taken from the npm package `@fontsource-variable/inter` 5.3.0 (`npm pack`, not added as a dependency), because Google Fonts was unreachable.
  - **Next.js telemetry is off** for `npm run dev`, `build`, `start` and the e2e runner (`NEXT_TELEMETRY_DISABLED=1`): it was the build's only other outside call.
  - **CSP:** `font-src 'self'` only (the `data:` it allowed is no longer needed).
  - **What still calls outside, on purpose, from the server only (each set from the environment):** Microsoft Graph for email (`login.microsoftonline.com` for the token, `graph.microsoft.com` to send), Microsoft sign-in (Entra, when built), the myloans API (`MYLOANS_BASE_URL`; the mock runs in process), and the backup bucket (`BACKUP_S3_ENDPOINT`, only when `BACKUP_TARGET=s3`). Nothing in the browser calls another host: no CDN, analytics or remote fonts.
  - The build needs no internet access except the package registry (`npm install`); recorded in `docs/GO_LIVE_RUNBOOK.md`.
  - `lib/security/headers.test.ts` checks `font-src 'self'` and that `app/layout.tsx` does not use Google Fonts.
- **Reason:** a build that depends on an outside host fails when that host or the network is down; the production server may have no general internet access.


## D-058 Responsive navigation and readable layout on every device: one sidebar, no bottom bar

- **Date:** 25 November 2026
- **Decision (the user's):** the phone bottom bar and the three separate menus are replaced by one sidebar with three behaviours, and every list screen follows readability rules from 320 px up.
  - **One sidebar** (`components/ui/app-shell.tsx`, `SidebarBody`): **phone (under 768 px)** hidden; the menu button (☰) in the header opens it as a drawer that slides in over a dark overlay. There is no close button on show (the user's follow-up the same day: "remove the x … only click outside to close"): it closes on a tap outside, a swipe to the left, Esc, and after choosing a page. Focus moves into it (on the current page's link), stays in it (Tab and Shift+Tab), and goes back to ☰ when it closes; keyboard and screen-reader users get a "Close menu" button as the drawer's last stop, shown only while it has focus. **Tablet (768 to 1279 px)** a 72 px icon rail with tooltips (on hover and keyboard focus) and an Expand button to the full labels. **Desktop (1280 px and up)** the full 264 px sidebar, collapsible to the rail. The tablet and desktop choices are remembered per person in that browser (`localStorage` key `gdfi-dms:nav:<user id>`, read and written inside try/catch; a blocked storage only forgets the choice).
  - **Content:** the same items as before, decided by the person's permissions (no role names; `app/(app)/layout.tsx`); count badges on Inbox and Open Items (the link's name carries the count: "Inbox, 2"); the active page marked (gold bar and `aria-current="page"`). **Top:** the logo (Home) and, on tablet and desktop, an icon-only Collapse / Expand button beside it (tooltip and `aria-label` "Collapse menu" / "Expand menu"); in the rail the same button sits above the logo. **Bottom, pinned on every width** (the menu scrolls above it when long; the block never scrolls away): the person's avatar (initials), name, role and branches ("All branches", the one branch's name, or "3 branches" with the names in a tooltip), with a Sign out icon button on the right (tooltip and `aria-label` "Sign out"). In the rail: only the avatar (its tooltip gives name, role and branches) and the Sign out icon. The phone drawer has the same block at its bottom. The **TEST MODE** line sits just above it, one line ("TEST MODE · sample loans only"; "TEST" in the rail), only with `TEST_MODE=true`, which `lib/test-mode.ts` always reads as off in production (`lib/test-mode.test.ts`). The sidebar shows **no Away line** (the user's review the same day): Away is unchanged and still set on the Inbox by the person, or by a supervisor with the permission (D-046). The short labels ("Items", "Loans", "Funds", "Monitor", "Audit") are gone: the rail shows icons only and the tooltip gives the full name.
  - **Accessibility:** a `nav` landmark named Main, `aria-current` on the active page, `aria-expanded` and `aria-controls` on ☰ and on the collapse button; the drawer is a modal dialog named Menu.
  - **Header:** phone: ☰, the logo, the short name "GDFI DMS" (the full name is there for screen readers) and the bell, on one 56 px line. Tablet and desktop: the full name "Loan Documents Management System" (kept on every page at the user's review; the page's name is the heading in the content), Find loan (Loan Associate) and the bell. **One Find loan per page:** the header's Find loan is hidden on My loans and Find a loan, which have their own beside the search box; it stays on the Loan Associate's other pages (Home, Inbox, Updates, a loan file), where it opens My loans with the search focused. The person's name moved from the header to the sidebar. The MOCK myloans banner stays (development and staging only) and is one short line on a phone ("MOCK myloans · sample data").
  - **The Next.js dev indicator** (the "N" badge) is off (`devIndicators: false` in `next.config.ts`); compile and runtime errors still show. It never shows in production.
  - **Pinned action bars on a phone** (the DP Job page's next action, the checklist's Send) sit at the bottom of the screen, above the safe area, now that there is no bottom bar.
  - **My loans cards** (`components/loan/my-loans-list.tsx`), one column under 1024 px and two from there: (1) avatar, borrower name (wraps) and the deadline chip on the right ("Late by 4 days"; it moves under the name rather than squeeze it); (2) the PN in monospace with a Copy button; (3) branch · amount; (4) the next step in full; (5) small badges: loan type (New / Renewal), classification (Financing / Refinancing), the flags, and the release date. The whole card opens the loan file (a stretched link; the Copy button sits above it). The product name is no longer on the card (it is on the loan file and in the admin Loans table).
  - **Search row:** the placeholder is "Search PN, name or CIN". On a phone the box is full width and Find loan and Filters sit on the row below (nothing cut); from 600 px all three share one row.
  - **Tabs** (My loans, Inbox, Open Items, Jobs, Funds, My funds): scroll sideways on a narrow screen with a fade at the edge that has more (`components/ui/scroll-fade.tsx`); counts stay visible; the selected tab is underlined (3 px) and, on My loans, its count is filled navy.
  - **The same card pattern on the other lists:** Inbox rows (the whole row opens the item; Accept, Move and Correct due date sit above the link), Open Items cards (borrower name and the waiting chip, then the PN with Copy, then the branch), Jobs rows and the admin Loans table: names, PNs and next steps wrap instead of being cut with "…". The Funds lists already wrapped and keep their compact table (D-056).
  - **Readability rules for every screen:** body text 14 px or more on phones (the small badges are 13 px); every field 16 px on phones (no iPhone zoom on focus; an unlayered rule in `app/globals.css`); tap targets 44 × 44 px or more (menu, bell, sidebar items, tabs, the search row, Copy); WCAG AA contrast (the status chips were already checked by `lib/ui/design-tokens.test.ts`; axe now checks every screen); no sideways page scroll from 320 px.
  - **Tests:** `tests/e2e/nav-sidebar.spec.ts` (no bottom bar; the drawer opens, traps focus, shows no close button, closes on Esc, a tap outside, a swipe left, the keyboard-only Close menu and a page; the rail expands on tablet and is remembered; desktop collapses; the icon-only collapse button at the top with its tooltip; the person's block pinned to the bottom with the menu scrolling above it on a short screen; branches and their tooltip; no Away line; only the permitted pages; badges), `tests/e2e/axe.spec.ts` (axe-core 4.14, WCAG 2.1 A and AA, the main screens of each role at 1440, 820 and 390, and the open drawer), `tests/e2e/ui-refresh.spec.ts` (the five-line card, nothing cut, Copy, the phone search row and tabs, and 320, 360, 390, 844 × 390, 820, 1024 and 1440 px: no sideways scroll, 44 px targets, 16 px fields, 14 px text). The specs that used the bottom bar or the "Items" label read the sidebar instead. Screenshots: `docs/screenshots/ui-refresh/` (also the sidebar full and as the rail at 820 and 1440, and the phone drawer).
- **Reason:** the user's UI fix request (25 November 2026): navigation that works the same way on phone, tablet and desktop, list text that is never cut where it matters (names, PNs, next steps), readable on every device, and no Next.js badge to confuse testers.

## D-059 Loans: one table and one smart search for every role

- **Date:** 25 November 2026
- **Decision (the user's):** "My loans" (Loan Associate), "Loans" (the read-only list) and the Find a loan page become **one Loans page** for every role (`app/(app)/loans/page.tsx`): the same component; what each person sees is their permissions and branch access. It replaces part of D-058 (the My loans cards on tablet and desktop, the tabs) and of the earlier Find loan screens.
  - **No tabs** (My queue, All branch loans, Needs action, All loans, Problems, Exceptions, Archived), no "Sample loans · TEST MODE" bar on this page (the samples stay on Home, which now searches the picked PN), no "Group by area and branch" (the Branch filter and sort replace it), no Filters panel with Stage, Classification, Area, Loan type, TAT and hold reason (Admin's "Classified by default" and "Changed since accepted" list filters went with it).
  - **Rows from three sources** (`lib/services/loan-list.ts`): (1) loan files in the DMS; (2) released loans not yet in the DMS: the open "Released, not yet in the DMS" items of the branch pools (D-046), shown in a search or with the Not yet in DMS filter, with View details to their preview (changed by D-060: at first marked "Not yet in DMS" with Accept and in the default list); (3) only in myloans: see the search below. The Inbox is unchanged (the personal to-do list); pool items show in both places.
  - **Filter row** (in the address, done by the server): the **Status** chips, a multi-select: Needs action (the Loan Associate's stages, or an open exception) · Not yet in DMS · On hold (an open hold, or myloans says it is no longer released) · Problems (open exceptions or problems) · Archived. None chosen: every open loan file, Archived and the pool items hidden (while searching, both are found too; D-060). On the same row a **Filters** button (the user's review the same day) with **Branch** (only the person's branches), **Assigned to** (Anyone · Me · Branch pool) and **Late only**. Every option shows its count, with the other filters applied. The chips are compact (30 px, 13 px text; on a phone an invisible margin keeps 44 px to tap).
  - **Columns, only these:** Borrower (name, the PN under it with Copy) · Branch · Loan (product, small New / Renewal and Financing / Refinancing badges) · Released on (the release date, its own column from 1440 px at the user's review on 26 November 2026; from 1024 to 1439 px, office laptops at 1280 and 1366 px included, it is the Loan cell's second line "Released Nov 24, 2026" and Assigned to may wrap, so the table fits without its own sideways scroll; checked at 1280, 1366 and 1440 px in `ui-refresh.spec.ts`; a loan not yet in the DMS has the "myloans · Not yet in DMS" badge in the Loan cell) · Released amount (every role; at first only with "See cash amounts", widened at the user's review on 26 November 2026; changed by D-062: only with "See loan amounts") · Status / next step (one column: the stage map's next step, "On hold: <reason>", "Fix a problem first", "Cancelled in myloans", or for a pool row "Released in myloans: view the details to open its loan file") · Assigned to (the person holding its open work, else "Branch pool", else the Loan Associate who opened it) · Due (the TAT chip: a small chip when due today or late, grey text otherwise) · Action (**View details**; D-060: a small pill, and the rows are not links). Badges and chips are compact (20 px, 12 px). Under 1024 px (phones and tablets) each row is a compact card with the same data, every line on one left edge (no avatar): name and Due, PN with Copy, branch · product · amount, the status, the badges, then a last row with Assigned to over the release date and the View details button on the right; one column on a phone, two from 768 px.
  - **Order and pages:** late first, then the soonest due, nothing due last (then the oldest release); Borrower, Branch, Released on, Amount and Due sort by their column heading (ascending / descending; Released on and Amount start with the newest / largest). 25 a page or 50. Under the list: on the left "Showing 1–25 of 37 loans"; on the right Previous, the page numbers, Next and the 25 / 50 buttons (the user's review).
  - **One smart search box** (button **Search**; it also runs as you type, after a short pause, from 3 characters, and on Enter). A name, part of a PN, the CIN or CIF, a paper's Document ID or a branch code searches the DMS loan files and the pool items, within the person's branches, and **never goes to myloans**. A full, valid PN that is neither a loan file here nor in a pool is looked up in myloans (API 1) once and shows **one** result: "Found in myloans" with Open loan file (released), or the reason (cancelled, replaced by another PN, not a released loan, not found, outside your branches, myloans busy), the same cards as before; every lookup is in the PN search log (a full PN found in the DMS is logged as "Already in the DMS", and its saved copy is refreshed in the background when old, as before). The header's Find loan opens this page with the box focused (and is hidden on it). `/search` (Find a loan) redirects here; `?fill=` and the old tab addresses too.
  - **Server side:** one SQL query loads every matching open loan file with only what the filters, counts and order need (open problems, holds, jobs in process and work items as grouped sets; the dates as Philippine days), then the TAT on each branch's calendar, the counts, the order and the page; the full details only for the 25 or 50 rows shown. Branch scope is in the query. Volume test (`npm run volume -- measure`, 15,000 loans): the default list 0.16 s for a Loan Associate and 0.25 s for Admin (all branches); with filters 0.21 s; a search 0.05 s; archived page 3 of 50 0.23 s. No new index was needed.
  - **Removed:** `components/loan/loans-toolbar.tsx`, `loan-tabs.tsx`, `loan-table.tsx`, `find-result.tsx`, `saved-loan-card.tsx`, `components/ui/find-loan.tsx`, `live-find-input.tsx` and the Filters "Show results (N)" count action; the result cards moved to `components/loan/myloans-result.tsx`. The typing suggestions API (`/api/loans/suggest`) is no longer used by a screen.
  - **Also:** the sidebar's Sign out tooltip opens to the right of the sidebar (not over the TEST MODE line).
  - **Tests:** `lib/ui/loan-list.test.ts` (the address, each filter, the counts, the order), `tests/e2e/loans-d059.spec.ts` at 1440, 820 and 390 (no tabs; the chips and Filters on one row with counts; default order; each filter; the address on reload and Back; sort; 25 / 50 and page numbers; Accept from the table, first accept wins, then Found in myloans and Open loan file; a full PN: found, cancelled, not released, not found, each logged; names never sent to myloans; branch scope; phone cards; screenshots). The specs of the old My loans, Loans and Find a loan screens were removed or moved to this page.
- **Reason:** the user's request (25 November 2026): one list for everyone instead of tabs that split the same loans, and one search box that finds a loan wherever it is (the DMS, the branch pool, or only in myloans) without sending names to myloans.

## D-060 Loans not yet in the DMS: View details and a preview page, no Accept

- **Date:** 26 November 2026
- **Decision (the user's; asked as "D-061, update D-060", recorded here as the next number after D-059, the Loans page it changes):**
  - **No Accept for a released loan not yet in the DMS**, on the Loans page and on Inbox › Branch pool (and anywhere a "Released, not yet in the DMS" item shows). Every row has **one action, View details**: the loan file for a loan in the DMS, the preview below for one that is not. The rows and cards themselves are no longer links (the user's review: a clickable row made the button pointless); View details is a small pill (24 px, 12 px text, navy outline that fills on hover; 44 px to tap on a phone).
  - **Badge "myloans · Not yet in DMS"** beside the release date on those rows (Loans table and cards, Inbox pool) and on the preview, in its own soft violet (`--myloans-*` tokens, `.c-myloans`; a source label, not a status colour; AA contrast checked in `lib/ui/design-tokens.test.ts`). Loans in the DMS have no badge. It replaces the "Not yet in DMS" status chip and the plain "MyLoans" chip of the preview.
  - **The preview page** `/loans/preview/<PN>` (`app/(app)/loans/preview/[pn]/page.tsx`), also the card of the full-PN "Found in myloans" search result (`components/loan/myloans-result.tsx`, `Preview`): the borrower's name, the PN with Copy and the badge; what myloans says now (API 1, logged in the PN search log): CIN, branch, product, loan type, classification by the keyword rule ("(classified by default)" when no keyword matched), the amount released, the release date, the status in myloans, and the area, division and company; how long it has waited since it arrived in the branch pool. **Open loan file** for people who may open loan files (the branch check runs first) and **Refresh from myloans** (API 1 again, past the one-minute cache). Another branch's PN is not found (404); a PN that is already a loan file goes to its loan file. When myloans says it is no longer released (cancelled, redone, not released) or not found, the reason card shows instead, with no Open. A person without the myloans search permission sees the pool's own copy from the last sync, with no Open.
  - **Open loan file** (unchanged rules, `openLoanFile`): makes the loan file with the opener as its Loan Associate, their checklist items arrive and are accepted at that moment (their TAT starts), and the pool item is closed (out of the pool and the "Not yet in DMS" list), then the loan file opens. Two people at once still make **one** loan file; the second now lands on the preview with "**Already opened by <name> at <time>.** Nothing else was created." and **View it**.
  - **The Loans list** (D-059 changed): the default list has **no pool rows**; a search and the "Not yet in DMS" status filter (off by default) show them. A full PN that is a pool item is that row (its View details opens the preview; no separate myloans call from the list).
  - **Tests:** `tests/e2e/loans-preview.spec.ts` at 1440, 820 and 390 (no Accept for pool loans on Loans or the Inbox pool, one View details; the badge only on those rows; the preview's data, waiting time, Refresh (a second logged lookup) and 404 outside the branches; Open loan file: the opener's loan file, items held and accepted at the same moment, the pool item done and gone from both lists; two people at once: one loan file and "Already opened by"; the cancelled reason card with no Open; the full-PN search shows the same preview), `lib/ui/loan-list.test.ts` (no pool rows by default; with a search or the filter), `loans-d059.spec.ts` and `ui-refresh.spec.ts` updated (View details, rows not links). Screenshots: `docs/screenshots/ui-refresh/loan-preview-<width>.png`.
  - **Review (the user's, 26 November 2026):**
    - **The arrival can never be before the release.** The kit demo (`npm run kit:demo`) put two Angono pool loans 1 and 3 working days back while the sample myloans had them released today, so the preview said "arrived Nov 16" beside "Released on Nov 19". Now: the demo moves the release date back to the arrival first (in the sample myloans and its copy here); the app's rule `poolArrival` (`lib/work/rules.ts`) uses the release time when an arrival would be earlier (the sync passes the release date, `receiveReleasedLoan`); and the database holds the same rule (migration `20261119090033_pool_arrival_after_release`: a trigger on WorkItem moves an earlier pool arrival up to the release date in the myloans copy, a trigger on SourceLoanCandidate moves that PN's pool items when the release date changes, and the rows written before were corrected). The preview page applies the same rule to what myloans says live: if myloans now gives a later release date than the pool item's copy (corrected after the last sync), the release day is the start of "In the branch pool since".
    - **One wording for the pool waiting time:** "In the branch pool since Nov 24 · 2 working days" ("less than a day" on the day it arrived), counted from the arrival in the pool (D-053): on the preview, on Inbox › Branch pool (every pool item; "Waiting … · arrived …" stays for items named to a person), and on the Loans table (the "Branch pool" cell's tooltip) and cards (the line instead of "Assigned to Branch pool").
    - **The badge once:** the subtitle "Released in myloans, not yet a loan file in the DMS" has no badge beside it; the card keeps the "Loan Released" chip and the "myloans · Not yet in DMS" badge at its top right (first removed, then put back at the user's request the same day). The "Status in myloans" field is gone from the details (the chip says it), on the preview and on the Found in myloans search card.
    - **The two questions:** "Please pick one to continue." and the warning colour only after Open loan file is pressed without answers; before that, a muted hint right beside the disabled button: "Answer both questions to open the loan file" (or the one question still open), under it on a phone; Cancel last.
    - **Compact** (the user's review, the same day): the card's padding 12 to 16 px, a 32 px avatar and a 16 px name, 24 px chips with 12 px text, the details 14 px (labels 12 px) in tighter rows, the waiting line 13 px, the question labels 13 px, "What will be set up" 12 px, and the answer buttons, Open loan file and Cancel 36 px high from 768 px (44 px to tap on a phone). The Found in myloans search card is the same component, so it is compact too.
    - **Refresh from myloans** is a compact icon button (28 px, the refresh icon only; its name in a small navy popover under it on hover or keyboard focus, and for screen readers; 44 px to tap on a phone) in the card header, at the top right after the chip and the badge.
- **Reason:** the user's request (26 November 2026): one action per row; a loan not yet in the DMS is looked at first (what myloans says now) and opened from there, so Accept without opening no longer leaves half-taken items in the pool.

## D-062 The loan file, compact: one summary header, one progress, compact paper rows

- **Date:** 26 November 2026
- **Decision (the user's request, the same day):**
  - **Loan summary header** (`components/loan/loan-summary-header.tsx`), the same at the top of every loan file tab (To do, Check documents, Documents, Journey). It replaces the big "Loan File" / "Check documents" title, the grey subtitle line, the "MyLoans · Last checked" text and the big Refresh button. Final layout (the user's review the same day, "so the user easily sees the details"): with a little space above, the borrower's name (the page's h1, 24 px; 20 px on a phone) on the left and, **on the same line at the right**, the due badge ("Late by 4 days", "1 day left"), the **branch badge** (its tooltip "Opened at Antipolo") and **Refresh from myloans** as an icon button (28 px; 44 px to tap on a phone; its tooltip and accessible description "Refresh from myloans · last checked <date, time>"; the answer, "No changes.", shows beside it), in that order (on a narrow phone they wrap under the name); under the name the PN in monospace with Copy (only when myloans moved the loan, one navy note "Opened at Antipolo, now at Angono" beside it; Replaces / Replaced by links there too when they apply); **then** (on To do, Documents and Journey) only Product · Loan type (myloans' New or Renewal, in plain words; at first two badges with Financing/Refinancing beside it, changed at the user's review: Financing/Refinancing is the DMS's classification from the product name, shown in Loan at a glance, not a loan type) · Amount (only with "See loan amounts", `seesReleasedAmounts`, the same rule as the Loans table; see below) · Released on, each a 12 px grey label above its 14 px value (two columns on a phone, one row from 640 px). A first version also had "With" (who has it) and "Opened at" on that line; they were taken out at the user's review. A person who may see the last check but not refresh it reads "myloans checked <date, time>" on line 2; "myloans did not answer" and "calls are paused by Admin" are chips there. Then the current step as a small heading (20 px: the stage map's step, "Check documents"), with the tabs right under it.
  - **Check documents: the borrower in the transactions card** (the user's review, the same day). The page header keeps only the breadcrumb and "Check documents" (the page's heading). At the top of the transactions card (the side panel from 1280 px; its own box above the strip below that): the borrower's name with the due badge and **Refresh from myloans** at the right of its line, the PN with Copy under it, then Product · Loan type · Amount · Released on · Branch (its tooltip: where it was opened) · Assigned to (who has it: the Loans table's Assigned to rule, `lib/services/loan-holder.ts`) in two columns on a phone and in the desktop side panel, three on a tablet (640 to 1279 px, above the strip), all compact (a 14 px name, a 20 px due badge with 11 px text, 11 px labels and 13 px values in tight rows; no branch badge there). It is its own card; "0 of 15 required papers" and the transactions are the next card (the user asked for a divider or separate cards; separate cards were chosen: the loan, then the work). At first these four sat there under a "Loan details" heading with a line under it; the heading and the line were removed at the same review and the name, PN and badges took their place. The other tabs keep them all in the header.
  - **To do › Check documents: one progress, no duplicates.** The "Do this now" card is gone for ordinary work: the transaction's header has one hint line ("Tick the 5 required papers, then send to DP"; "Tick the 3 remaining required papers, …"; once all are ticked "All required papers are ticked: choose a processor below and send it to DP."; for EDST "record the EDST reference", for a custom transaction "mark it as done") and the progress once ("0 of 5 required · 0 of 1 optional" and a thin bar). "Go to the papers" is gone. The step's button is only the Send panel's own (Send to <name>, locked with "Tick 5 more required papers" beside it), or Mark EDST done, or Mark as done: a compact "Send to DP" button in the header was tried and removed the same day at the user's review, because it repeated the Send panel's button. The card stays only for what needs its own controls: on hold (Resume), a problem (Mark as fixed), papers handed back (All received), and the processor's findings (Go to this paper, Choose a processor); the header's hint then points to it. The right panel keeps only the overall "0 of 15 required papers" and the transactions list.
  - **Paper rows:** about 36 px on tablet and desktop (44 px to tap on a phone): checkbox · paper name · its chips right after the name (status: Received, "Missing, remarks needed" / "Missing, with remarks", Received late; Requested; the returned marker; Required / Optional; Original / Copy; 20 px, 12 px text). "Missing" was a button that looked like a status. It is now in a quiet **"⋯" menu** at the end of each row (28 px, grey with no border until hover or focus; 44 px to tap on a phone; named "More actions", with the paper's name as its description, so the paper's name alone always means its tick box), whose item is **Mark as missing** (or **Not missing** to take a mark back before the first send). An outlined "Mark missing" button on every row was tried first and changed the same day at the user's review: repeated on each row it read as duplicated. The menu opens with Enter, Space or Arrow Down and focuses its item; Esc closes it and gives the focus back. An open paper has no status chip. Group labels ("Proof of sale: pick at least one") stay, 11 px.
  - **The Send panel, compact** (the user's request the same day, "all of it"): the ready check as 24 px chips (12 px text); the funds question and "Who should do it" in 8 to 12 px boxes with 13 px titles; the funds answers and kinds 32 px (44 px on a phone); each processor one compact row (28 px initials, the name with its 20 px Available and Recommended chips on one line, the load under it, 12 px); the branch pool row the same; Pasuyo, the LTO office (36 px field; its help line "Where the processor takes it. The approver uses it to judge transport and time." removed at the user's review) and the late reason (one line that grows) tighter; the summary in two 13 px lines (the user's review: "Notary goes to DP 1 (Angono), processed at LTO Cebu City District Office." then "Funds: Needs funds (Notary fee, LTO fee, Transport, Other).") and the Send button 36 px (44 px on a phone, still pinned at the bottom there); why Send is locked is one line under it: a lock and the first thing missing ("Tick 5 more required papers", the same words as before), and the words are the link: pressing them goes to that place and highlights it (the first unticked paper, the funds question, the processors, the LTO office, the late reason). A separate "Show" and a "· 1 more to do" count were tried and removed the same day at the user's review. The footer follows the card's own width: wide, the summary on the left and Send with the reason right-aligned under it; narrow (a tablet, or beside the side panel at 1280 to 1366 px), stacked and left-aligned; on a phone the reason above a full-width Send in the pinned bar. The funds and processor boxes sit side by side only when the card is 704 px or wider (a container query, not the screen width); the confirm step's buttons 36 px. The "Notary · Maria Santos" line under its title is gone (both are already on the page).
  - **Compact at every width** (the user's review the same day): paper rows about 36 px also on a phone (the tick, the "⋯" menu and Include keep 44 px to tap through an invisible margin, the Copy button's way); tabs 40 px (36 px from 768 px); the strip's cards 44 px; "Something wrong?" and "Waiting on the borrower or someone else?" 40 px with 13 px text; the step heading 18 px on a phone. "Waiting on the borrower or someone else?" is one quiet row with a pause icon and a › chevron, and the whole row opens Put on hold (no separate button; its name for screen readers ends with "Put on hold"). The Put on hold dialog no longer shows "Starts now: <date, time> PHT" or "No expected resume date…" (the user's review); the server records the time as before and the hold summary shows it after saving. **Drag down to close, on every bottom sheet on a phone** (first on Put on hold, then all of them at the user's request after checking where it applies; `components/ui/sheet-drag.tsx`, on by default in `Sheet` and `GuardedSheet`): a grab handle instead of the X; dragging the handle or the title down more than 80 px, or a quick flick, closes it through the sheet's own close (a guarded sheet still asks "Discard your changes?" when something was typed); a shorter drag springs back; tapping the handle closes it (named "Close" for screen readers); Esc and Cancel work as before. While a sheet is open the page behind it is locked (no scroll, no bounce, no pull-to-refresh; the user's review: only the sheet moves, never the background). Tablets and desktop keep the centred dialog with its X. Not applied, on purpose: the "are you sure" confirm (an alert answered with its buttons, often on top of a sheet), the full-screen Settings window (its own Back and X) and the menu drawer (it slides in from the left). Add a transaction and Cancel transaction are small secondary buttons (`btn-xs`: 28 px, 12 px text and icon; 44 px to tap on a phone). The Send button is 32 px with 13 px text from 640 px, and 40 px full width in the phone's pinned bar.
  - **Who sees a loan's amount (the user's decision, 26 November 2026):** one new tick, **See loan amounts** (`loans:view_amounts`; "See cash amounts in the Journey" stays the tick for cash-advance amounts). On by default for the Loan Associate, LA Supervisor/Head, Finance, Admin and Superadmin; off for the Document Processor, Custodian, Digicur, QA, Archiver and Monitoring; customizable per role and per person as usual. Migration `20261119090034_loan_amounts` adds it to those five built-in roles (data only). Without the tick the amount is hidden everywhere and the server does not put it in what it sends: the loan summary header and More loan details, the Loans table column and cards (and sorting by amount falls back to Due), the loan preview (myloans' copy and the pool's), Found in myloans and the status cards of the PN search (`lookupPn` drops it), Home's cards, the Inbox pool rows, Open Items changes to the amount field ("Amount changed") and Related loans, and the sample loans in test mode. The Open loan file card gets Rule 4's answer from the server (`mortgageMet`) instead of the amount, so "What will be set up" still shows; the rules that need the amount still run on the server when the loan file is opened. No export or report carries the loan amount today (checked: the PN-search CSV, the settings and audit exports). At first (D-059 review) the amount was shown to every role; this replaces that.
  - **Loan at a glance, Something wrong?, the hold card** (the user's review, 27 November 2026): Loan at a glance is one compact card with no open / close ("More loan details" is gone): Type, Mortgage needed, OR/CR, Send by, CIN, CIF, Area, Opened (when, by whom) and, under a divider line, Why this was set up (11 px labels, 13 px values, two columns at every width); what the header already shows is not repeated; the myloans codes and IDs only for people with "Manage MyLoans sync" (`myloans:manage`, Admin), in a small "myloans codes" section. "Something wrong?" is one row (alert icon, the words, a › chevron) and the whole row opens Report a problem (its name for screen readers ends with "Report a problem"). The hold card has one soft amber border around the whole card instead of the orange stripe on the left; its remark quote has a quiet neutral line (no orange bar); it is compact (14 px title, 13 px remarks, 12 px lines, a 28 px Resume on the loan file).
  - **One summary card on every tab** (the user's review, 27 November 2026): To do, Documents and Journey show the borrower the same way as Check documents, as a card at the top: the name (the page's h1) with, at the right of its line, the status in myloans as a chip ("Loan Released", green; another status amber), the due badge and Refresh from myloans, the PN with Copy, then Product · Loan type · Amount · Released on · Branch (its tooltip: where it was opened) · Assigned to, in two columns on a phone, three on a tablet and one row of six from 1024 px (11 px labels; values 14 px on a phone, 13 px from 640 px). The branch badge is gone (Branch is a detail). No "Check documents" heading above the stepper (the stepper says the step); Check documents keeps its heading (it has no stepper). The On hold block on the To do tab follows the problems card's pattern: one soft amber card with one heading ("On hold", "(2)" when more than one, "· The TAT clock keeps running"), then a white list with a row per transaction: "<transaction> · <reason>", the remarks, who put it on hold and when, who can resume it, "Locked until it is resumed" and a small Resume at the right. "On hold" and the clock note are said once. The hold card's Resume stays at the top right at every width (not under the text on a phone) and is small (28 px). The Documents tab uses the whole width: the filter and "N of M papers have a Document ID." on one line, the cards in balanced columns (two from 960 px of width) so each sits right under the one above with no empty gaps, 36 px card headers and 32 px paper rows. The Journey tab uses the whole width too and is compact: 14 px titles (Where it is now, the transactions, Full audit log, Papers), 13 px story, milestone and log lines, tighter paddings and gaps, the filter chips and switches 28 to 32 px from 640 px (36 px on a phone with a 44 px tap area). The To do / Documents / Journey tabs stay pinned under the top bar while the page scrolls, at every width (Check documents on a phone included, where they were hidden before), so another tab is always one tap away. Report a problem is a compact dialog (16 px title, 44 px choices on a phone with 12 px help, 36 px buttons from 768 px).
  - **Contrast:** the stepper's later steps' numbers were navy at 55% on white (axe: below AA); they are the secondary text colour (navy 70%) now.
  - **Density on the loan file** (the `loan-compact` scope in `app/globals.css`): body 14 px, labels 12 px, section titles 16 px, the step title 20 px; cards 12 px radius with 12 to 16 px padding and 8 to 12 px gaps; buttons and fields 36 px (small buttons 32 px) from 768 px, 44 px on a phone. The page is at most 1440 px wide, so the main column stays about 1100 px beside the 320 px right panel; Documents and Journey are at most 1100 px. The right panel (Check documents and To do) sits beside the main column from 1280 px (was 1100 px for Check documents) and below it (the transactions strip) on narrower screens. The Send panel, the transaction list, Loan at a glance and the Journey headings follow the same sizes.
  - **Tests:** `loan-file-layout.spec.ts` (the header: name, PN with Copy, due chip, branch, product, badges, amount, released on, with; no old title, subtitle or Refresh button; the step heading and no gap above the tabs on every tab; the icon refresh by keyboard with its tooltip and result; rows about 36 px, 44 px on a phone, chips right after the name at 12 px, no repeated Mark missing button and the row menu by keyboard; one progress per transaction and the overall count only once), `loan-file-next-step.spec.ts` (no card for ordinary work, the hint, one Send button only (the panel's, disabled until the papers are ticked); the card for returned, hold and problem as before), `ui-refresh.spec.ts` (the four loan file views in the readability walk from 320 to 1440 px, 1280 and 1366 included: no sideways scroll, nothing cut, 44 px tap targets and 14 px text on phones; screenshots `loan-todo`, `loan-check-documents`, `loan-documents`, `loan-journey` at 390, 820 and 1440), `axe.spec.ts` (the four views, also at 1366 px); other specs moved to the new names (Refresh from myloans, Mark missing, the h1, the 1280 px breakpoint). `E2E_1366=1` adds a `laptop-1366` project for a run at that width.
- **Reason:** the user's review (26 November 2026): the loan file repeated the same facts (progress three times, "Do this now" beside the transaction it described), the title took space without saying whose loan it was, and the rows were tall with their tags far from the paper's name.
