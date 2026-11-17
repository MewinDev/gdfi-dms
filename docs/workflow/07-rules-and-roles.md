# Rules and roles

The automatic rules, the turnaround targets, the roles and examples of permissions.

Last updated: 17 November 2026 (PHT)

### Automatic rules (run once, when the LA clicks Open Loan File)

| Rule | Input | Result |
|---|---|---|
| 1 Classification | Product name (case, hyphens and extra spaces ignored) contains a Refinancing keyword, else a Financing keyword, else the default (D-031; keywords and default in Settings, Product classification) | Refinancing, Financing, or the default (Refinancing to start), labelled "Classified by default" |
| 2 Undertaking | Financing only, picked by the LA | Undertaking or Non-Undertaking |
| 3 ORCR | Financing + Untransferred | Notary + EDST |
| 4 Mortgage | New and amount at or below PHP 500,000; Renewal and amount at or below PHP 1,000,000 | Mortgage: Notary, EDST, Entry of PPSR, Mortgage. Otherwise Notary and EDST |

### Turnaround targets (working days, all editable in Settings)

| Clock | Default |
|---|---|
| LA check and send | Day 2 from release |
| EDST | 1 |
| DP accepts | Same day |
| Notary | 3 |
| Entry of PPSR | 5 |
| Mortgage | 10 |
| Receiving LA acceptance | 2 |
| Transmittal to the vault | 3 |

### Working days and due dates (D-018, D-041)

- **One calendar** (Settings, Holidays and working days) counts every working day in the app: turnaround times, liquidation, carry-over, reminders, reports and the job lists. Working days are Monday to Sunday tickboxes, **Monday to Saturday** by default. Holidays (date, name, type: regular, special non-working or local; for all branches or ticked branches) and **office closures** (a quick action: one date, the branches closed and a reason, for a typhoon or a sudden declaration) are non-working days. Only **sample** holidays are seeded ("Sample. Enter the official list from the government proclamation."); the official list is entered from the proclamation. Changes need "Change holidays" (Admin and Superadmin by default) and are audited.
- **Counting**, by Manila date: the working days after the start date, up to and including the end date; accept and forward on the same day is 0. Friday to Monday is 2 (Saturday counts); Saturday to Monday is 1. A due date is due until the end of that day.
- **Whose calendar:** LA work counts on the loan's branch; a DP job and the liquidation on the processor's branch; Finance on the requesting processor's branch. A closure of Angono does not move a Pasig item.
- **Saved due dates:** a DP job's due date is saved when the processor accepts (the target of its processing step, on the processor's branch calendar); the liquidation due date is saved at release (piece 5 moves its start to the last LTO completion). A saved date moves only through the logged rules below or an explicit, logged admin correction. LA steps without an accept are still counted from the calendar each time (until the inbox, piece 9).
- **A holiday or closure added late** extends an open item when the new non-working day falls **inside its counting window** (after its start, up to and including its due date), **even if it is already overdue** (the closure may be what made it late); an item whose window does not hold the date is unchanged. Before saving, Check shows "This will extend N items (M currently overdue)"; each change is logged on the item and its owner is told. A date in the past needs a reason and may be at most 7 days back (setting). Taking a working weekday away follows the same rule. **Every path** follows it: Settings, the holiday CSV import (Check file shows the same line) and Make inactive / Make active. Making a holiday or closure **inactive** moves back only the due dates that entry moved, each by the days it took (an item it never reached, or a move made by something else, stays); making it active again extends like a new one; both have Check first, are logged per item and tell the owner (D-042).
- **Correct a due date** (tick "Correct due dates", `duedates:correct`; Superadmin and Admin by default): one item at a time, on the job page or the Funds liquidation details, a working day of the item's branch and a reason. It shows in the item's due-date history, is logged and the owner is told.
- **Holds that pause TAT:** each hold reason has a "Pauses TAT" tick (on by default for waiting on the client, another department or MyLoans; off for "No available DP" and "Other"). While such a hold is open the chip says **Paused** instead of a countdown; when it ends, the saved due date moves by the paused days. In plain words, shown wherever pauses appear: "The day you put it on hold counts; the day you resume doesn't." A hold for another reason does not stop the clock. Problems never pause it. Hold time is always shown separately.
- **Colours:** green with 2 or more working days left, amber with 1 day left or due today (the amber point is a setting), red when late, grey when Paused. The Jobs lists are sorted by due date, overdue and soonest first.

All times are shown in Philippine time (PHT).

On hold: the reason category (from Settings, Hold reasons) and the remarks are both required, for every reason, "Other" included. The system records who put it on hold and when; there is no expected resume date. While it is on hold the transaction is locked: it stays readable but nobody can change it, on the screen or on the server, until it is resumed. Only the hold owner can resume it or add details to an older hold without remarks; nobody else can, Admin included. A person whose role has "Move a hold to another person" (`holds:transfer`; the Branch Supervisor and Admin by default, no longer Finance) can give the hold to another active person with the same work role, only in the branches of their own access and only to someone who also has access to that branch (Admin has All branches), with remarks; they can never resume it. Settings, Roles shows "N active branches have nobody who can move a hold." (with Show branches) when that happens. A hold saved without an owner can be transferred too. Remarks for Put on hold, Resume, Add details, Decline and Return to LA: 5 to 500 characters (trimmed). Finance on a held transaction: request, approve, release, top-up and carry-over approval are refused; denying, receipts, recording and confirming cash returns, liquidation, close and exceptions stay allowed, so money already out can be settled.

Decline and Return to LA: the transaction goes back to the specific Loan Associate who sent it (not another LA of the branch) with the DP's findings; only that LA is notified (in-app, and by email when the switch is on). When that LA is inactive, every active LA of the branch sees it ("Sender {name} is inactive"), in-app only, and any of them can send it again. On a Return to LA the DP hands over every paper received at Accept and the LA confirms them before sending again; cash already released stays with the DP as "Cash to settle" until it is liquidated. The DP gets nothing and no longer sees the job. Sending it again starts a new round; the TAT clock never restarts.

### Processing stages (defaults, editable in Settings)

| Transaction | Stages a DP job runs, in order |
|---|---|
| Notary | Notarization, then the LTO stages if the type needs LTO, then Check and verify |
| Entry of PPSR | PPSR registration, then the LTO stages if the type needs LTO, then Check and verify |
| Mortgage | No stage of its own: LTO drop off, LTO pickup, then Check and verify |
| Any type with a processor | LTO drop off and LTO pickup when "Needs LTO processing" is on; Check and verify always last |
| EDST | No DP stages |

Details and evidence fields: [Processing stages](10-processing-stages.md).

### Roles (Admin and Superadmin are locked from LA, DP and Finance work steps by default)

The ten decided roles (D-002) and Monitoring (D-010). Every built-in role may sign in. What a role does is its ticks in Settings, Permissions (the matrix); a person can also have overrides (Granted / Denied) on Users, Edit (D-008).

| Role | Main work |
|---|---|
| Superadmin (two are seeded; a warning when only one active is left) | Setup and configuration: the permission matrix, per-person overrides, "Can approve LA Open Items", All branches, Settings, users, the myloans integration. No day-to-day action by default: no approving, releasing funds, Accept / Forward, job work, moving holds or resolving problems, unless ticked (D-023, D-028). Told on Home about branches with no approver |
| LA | Search and open loans, check papers, flag funds, send, receive forwarded packages, EDST |
| DP | Accept or decline, stages, attempts, funds requests (Cash advance or Fund transfer), liquidation, return to LA, Pasuyo, check and verify, forward to a branch |
| LA Supervisor/Head (built in, key SUP: the former Branch Supervisor; the same role is used for an area head by giving the person Area access) | Every LA tick, plus approving or rejecting myloans changes and moving holds, for their branches (D-002, D-010, D-029). No per-person legacy grants (the migration removed them and listed each person). No money, Settings, users, roles or branch imports |
| Finance (one role; each person ticks Handles CA and/or Handles FT, D-009, and the branches they handle, D-035: not All branches by default; approvers are Finance people with the approve tick only, D-010) | Approve and release cash advances, send fund transfers, change a request's funds type before release (with remarks), change or add a line before approval, add expense kinds ("+ Add new kind"), confirm returns, close advances, follow up overdue liquidation |
| Admin (Group Head) | Settings, users and day-to-day staffing (specific branches, Handles CA / FT), Audit Log, TAT reports, All branches with the Open Item approver tick by default (approves MyLoans changes for every branch, D-029), closing cancelled loans. Not the permission matrix, overrides or All branches (D-023) |
| Custodian, QA, Digicur, Archiver | See loan files of their branches; their work steps come with their modules |
| Monitoring (read-only; the former Operations Monitor) | Read-only, all branches: the Monitoring page (DPs and LTO offices) and LTO advisories (resolve, edit, file from Monitoring). No loan files and no amounts. Told when an advisory is filed or resolved |

### Home: the same layout for every role

Home is one quick look, then the work. Every Home has the same parts, top to bottom: the title and one muted line (the date and "Good morning, {first name}"; never a count), one **summary strip** (the counts as tappable segments; a zero is grey, an amber dot when something needs the person, a red dot for problems; three per row, never more than two rows), **Do these next** (at most six rows, then "See all (N)"; when empty, one line "You're all caught up."), then the attention cards **only when their count is above zero**; when none has anything, one line "Nothing to review and no problems." The side column (Latest updates, the test-mode Sample loans, closed by default) shows only when it has something; otherwise the main column takes the width. The counts, their order, the links and who sees what are the ones that existed before: which blocks a person gets depends on their ticks, never on a role name. Decisions stay on their own pages; Home only lists and links.

| Who (by ticks) | Summary strip | Do these next | Attention cards (only when above zero) |
|---|---|---|---|
| Loan Associate (`checklist:tick`) | Need you now, Waiting on others, Problems to fix | The loans that need them (avatar, name, PN · branch · amount, the next step, the due chip, Continue or Open); "Waiting on others" and "Problems to fix" as closed rows under it when above zero | Package forwarded to you: receive it; Sent back to you |
| Admin | The same three, plus MyLoans changes and Branch review | As the LA (all branches) | MyLoans changes to review, Branch review, TAT and problems (its link: "Open the TAT report"; the report has no export) |
| Branch Supervisor | The same three, plus Corrections to review | The loans of their branches that need the LA | MyLoans corrections to review, TAT and problems |
| Approvers (loan files only, no funds ticks) | The same three | The loans of their branches | MyLoans corrections when they have that tick |
| Document Processor (`jobs:work` without `checklist:tick`) | To review, In process, Problems, Need funds, On hold | The jobs to look at first (problems, overdue, due today, to review); "All jobs" at the top | Liquidation overdue |
| Finance, or anyone with funds approve or release ticks without `checklist:tick` | To approve, To release, Outstanding, Overdue; "Open Funds" at the top and the outstanding cash in one line | (Home has no request list; the Funds page has the queues) | MyLoans corrections to review (with that tick) |
| Operations Monitor (monitoring ticks only) | Home is the Monitoring page, as before | | |

### My loans: one compact list

The same layout for everyone who sees loan files: the title only (no subtitle), one 40px toolbar (the search box with its button inside the right end, and **Filters** beside it with a count when filters are on), the active filters as removable chips in one line with **Clear all** (nothing when none is on), underline tabs with their counts, and the list. "Showing X of Y" appears on the tab row only while a filter or a search is on. An empty tab is one calm line ("You're all caught up.", "No loan files in your branches yet.", "No problems.", "Nothing archived."; with a filter: "No loans match." and **Clear filters**). The tabs, their counts, which loans each lists, the order, the filters and the search work as before; typing in the search never calls MyLoans (only a full unsaved PN plus **Find loan** does, once). In test mode the Sample loans (and the Data-check samples when switched on) are one closed row each.

| Who (by ticks) | Title and search | Tabs | The list |
|---|---|---|---|
| Loan Associate (`checklist:tick`) | My loans; "PN, borrower name, CIN or CIF" with **Find loan** (suggestions from the DMS while typing) | My queue, All branch loans, Problems, Archived | One block, aligned columns: Borrower (name; PN · branch), Loan (amount; loan type · product), Next step (the stage map's next step text, its owner on hover; released on), Due (amber or red chip only when due today or late, otherwise grey text), Open. A header row from five rows. Flags when something is different: MyLoans changed, borrower details waiting, problems (two at most, the rest as "+N"). Most urgent first. On a phone each loan is two or three short lines and the whole row opens it. |
| Everyone else who sees loan files (Admin, Branch Supervisor, approvers, Finance, a processor with `loans:view`) | Loans; "Search by PN, CIN or CIF" with **Search** (the DMS only) | Needs action, All loans, Exceptions, Archived | The Loans table (below); On hold by reason chips; Group by area and branch. |

### The Loans table

One column per fact: **Borrower** (the name, the PN under it), **Branch**, **Product** (the product name, the loan type under it), **Released**, **Amount** (₱1,000,000), **Stage**, **TAT**, **Next step**. No Classification column (it stays on the loan file, in the filters, the reports and the data). The whole row opens the loan file. Under 1024px the branch goes under the PN and the released date and the amount under the product; on a phone each loan is a block of short lines.

- **Stage** is the stage's name from the one stage map ([Stages and next steps](13-stages-and-next-steps.md); in the code `lib/workflow/stage-map.ts`). No name depends on the viewer.
- **TAT** is a small chip with the deadline date, amber for "Due today · Nov 12" and red for "Late by 2 days · Nov 10"; any other deadline is grey text ("2 days left · Nov 14").
- **Next step** is the stage map's next step text; who does it is in its tooltip ("Waiting for: Loan Associate"). When the system has the next step there is no tooltip.
- A loan that needs attention has small chips after the name (MyLoans changed, borrower details waiting, problems; two at most, the rest as "+N").

| Stage (internal) | Stage column | Step on the loan-file stepper |
|---|---|---|
| Opened, For checklist | Check documents | 3 Check documents |
| No DP assignment required | Check documents (LA only) | 3 Check documents |
| Assigned to DP | DP Assigning | 4 DP Processing |
| In process | LTO Processing | 4 DP Processing |
| Awaiting LA acceptance | Forwarding to LA branch | 5 LA Acceptance |
| For Vault Transmittal | For transmittal | 6 Collateral |
| In transit to Vault | Receiving | 6 Collateral |
| In Safekeeping | In safekeeping | 9 In Safekeeping |
| Closed | Closed | 10 Closure |
| Cancelled in MyLoans, Archived, Disposed | The word itself, in grey | No step |

Steps 1 (Loan opened) and 2 (Classified) are done as soon as the loan file exists, so a loan is never shown at them; 7 (Quality Assurance) and 8 (Digital Records) have no stage in the app yet (Phase 2), so a loan goes from 6 (Collateral) straight to 9 (In Safekeeping). Archiving, Warehousing and Warehoused come after Closed, under step 10 (Phase 2). The full table, with the next steps, owners and the Phase 2 stages: [Stages and next steps](13-stages-and-next-steps.md).

### Long lists: pages

Long lists are shown a page at a time, with one compact line under the list: "1–50 of 312 · Previous · Next" (no line when everything fits on one page).

| List | Rows a page | Notes |
|---|---|---|
| Loans (the Loans table) and My loans | 50 | The tabs, their counts, the filters, the search and the order are as before; the whole list is filtered and put in order first, then one page is shown. |
| Settings > Users | 100 | "N of M users" counts the whole filtered list. |
| Settings > Branches | 100 | Was cut at 400 rows ("N more: narrow the search"); now every branch can be reached. |
| Home: Do these next, Waiting on others, Problems to fix | 6 | Unchanged: already limited, with **See all (N)** to My loans. |
| Monitoring drill-downs (a processor's jobs, an LTO office's jobs, Loan files with missing papers) | 100 rows each | A row limit, not pages: a pop-up holds up to three lists. The heading keeps the whole count and a line says "Showing the first 100 of N" and how to narrow it. |

- **Counts are the total.** Tab counts, "Showing X of Y" and "N of M users" never count only the page.
- **The page is in the address** (`page=2`), so Back and refresh keep it. A new filter, search, tab or grouping goes back to page 1.
- **Group by area and branch.** The whole result is grouped (Area, then Branch, the usual order inside each), then cut into pages of 50 rows. Each heading shows its group's count over the whole result, and "(continued)" when the group began on an earlier page. Whole groups per page were not chosen: one branch with 300 loan files would make a page of 300.
- **Still read in full on the server.** The order of My loans (most urgent first) and the TAT filter are worked out from every loan file, so the server still reads the whole filtered list (at most 500 loan files per tab, as before) and sends one page to the browser. Settings > Users is paged in the database.

### Branch access: where a person works

Roles say what a person can do; branch access says where. It is set per user (Users, Edit, Branch access): **All branches**, or **Selected**: whole Divisions, whole Areas (the pair Division and Area) and single Branches together, minus exceptions (a branch unticked inside a ticked Area or Division). A ticked Area or Division includes a branch added to it later. The result is kept in a derived table (`user_branch_access`), rebuilt when a person's access changes, a branch moves to another Area, or a branch, Area or Division appears; every query that is limited by branch reads it. Admin people have All branches (stored on each person, like anyone else). Changing a person's branch access needs the tick `access:manage` (Change branch access). Each person who works on loans has a **home branch** inside their access: the default for new work and sending. Every branch in the access is workable, not only the home branch. Forwarding a finished package stays unrestricted: the processor picks any branch, then the named LA. A role's branch access is now only the default for new users of that role. Existing users kept what they had: their branch became their home branch and a single-branch grant; users whose role gave all branches got All branches.

Branches themselves come from MyLoans (Settings, Branches): for MyLoans branches the code, name, area, division and status are read-only in the DMS; branches are never deleted, only switched off (an inactive branch cannot be chosen for new work but stays on old loans) or hidden from the DMS (test and retired branches). Accepting a Branch review item that moves a branch, closes it or changes an Area first shows who gains or loses access; every access change is audited.

### Roles are just ticks

A role is a name and a list of ticks (permissions). Admin opens Settings, Roles and ticks what each role may see or do; the app follows on each person's next page, and the server checks every action (a button only hides for convenience). No code decides anything by a role's name, Admin included: Admin is an ordinary role whose default ticks are everything except the loan-file work steps. The full catalogue, the defaults, the role editor, lock-out protection (someone active always keeps `roles:manage` and `access:manage`, counting per-person overrides) and the audit are in [Permissions](12-permissions.md).

Who changes what (D-023): only the Superadmin (by default) changes the matrix, per-person overrides, "Can approve LA Open Items" and All branches; the Admin and the Superadmin assign specific branches and Handles CA / FT. Nobody changes their own role, access, scope or overrides. Someone who cannot manage permissions cannot give a role that can manage permissions or give All branches. Every change is audited. One server-side helper (`lib/auth/scope.ts`, `lib/auth/holders.ts`) applies branch scope and "who holds this permission" everywhere; a record outside a person's branches is "not found".

**Files and the file access log (D-019, D-039).** Receipts, stage evidence and LTO proof open only through one signed-in link (`/api/files/{kind}/{id}`): the parent record is checked against the person's branches ("not found" otherwise) and there is no public or static file address. Every view and download is written to the **file access log**, which nobody can change or delete. Audit, **File access log** (tick "View file access log", `audit:files`; Superadmin and Admin by default, and it can be given to a Data Protection Officer) lists who opened which file and when, within the reader's branches, with filters for user, branch, PN #, file type and date range (Philippine dates). **Download CSV** exports the filtered rows; each export is itself a row in the log (only someone with All branches sees export rows). With both Audit ticks, the two pages are tabs; with only this tick, Audit opens straight on the file access log.

Examples: `loans:refresh` (Refresh from MyLoans on a loan file; LA, Admin, DP, Vault, Digital Records, QA by default, not Finance, Approvers or Operations Monitor), `myloans:view` ("MyLoans · Last checked"), `funds:flag`, `funds:request`, per funds type (cash advances `funds:ca_*` and fund transfers `funds:ft_*`, handled by different people): `view` (the Funds page, CSV, receipts), `approve` (within that type's approval bands), `release`, `settle` (confirm returned cash, close), `edit_lines` (change or add a line before approval), `change_type` (the type before release; changing into the other type needs that type's tick too) and `print` (the liquidation report); Finance has both types, Admin has See and Print of both; they replaced `funds:view_all`, `funds:approve`, `funds:release` and `funds:print` (migration 20261119090007_funds_per_type gave both types to every role that had the old key), `jobs:work`, `jobs:pasuyo`, `jobs:return_to_la`, `holds:raise`, `holds:resolve` (resume: only the hold owner), `holds:transfer` ("Move a hold to another person": in the person's branches, to someone with access there; Admin and the Branch Supervisor by default, not Finance since 10 November 2026), `holds:manage` (Settings, Hold reasons; Admin only by default), `problems:raise`, `problems:resolve`, `problems:resolve_any` (also told about problems, holds and overdue work in the branch), `journey:view_amounts`, `myloans:review` (decide MyLoans changes), `myloans:review_borrower` ("Review borrower detail corrections"; renamed from its first "source" name on 12 November 2026, migration 20261119090013_myloans_shared_limits: Accept the correction or Keep current when MyLoans changes a borrower's name, address, contact number, CIF or CIN; loans in the person's branches only; the Branch Supervisor, Admin and every role that approves funds by default, migration 20261119090012_borrower_details; when nobody assigned to the branch has it, Admin reviews it), `myloans:manage` (MyLoans sync settings), `myloans:sync` (Run now), `email:view` and `email:manage`, `stages:manage` (Settings, Processing stages; Admin only by default), `branches:view`, `branches:manage` (the DMS-only fields of a branch, branches made by hand, Hide from DMS), `branches:import` (Import from MyLoans, Branches from MyLoans), `branches:review` (the Branch review and Hide from DMS), `settings:system` (Settings, System switches), `settings:pn_format` (the PN format), `users:edit` (a person's name, role and status), `access:manage` (a person's branch access), `roles:manage`, `fundtypes:manage` (Settings, Funds types; Admin only by default), `funds:kinds_view` (see Settings, Expense kinds; every role that sees funds) and `funds:kinds_manage` (add, edit, reorder, make inactive expense kinds, "+ Add new kind" on the funds screens, change a fixed amount on one request; Admin, Finance and Approvers by default). Changing a request's funds type before release goes with `funds:release` (Finance).

Monitoring (group "Monitoring" in Roles): `monitor:dp` (the DP monitor), `monitor:lto` (the LTO monitor), `ltoreports:create` (file an LTO advisory from a job at an LTO stage; DP by default), `ltoreports:manage` (resolve or edit any advisory, file one from Monitoring; Admin and Operations Monitor by default), `ltoreports:notify` (be told about advisories; Operations Monitor by default) and `dpcapacity:manage` (Settings, Processor capacity: the default capacity, a processor's own capacity and On leave; Admin only by default). Admin has them all. They are not given to Finance by default; the Branch Supervisor has `monitor:dp` and `monitor:lto` (for their branches). A monitor sees counts, times and PN lists; opening a loan needs `loans:view` in that branch and amounts need `journey:view_amounts`. Definitions: [Monitoring](11-monitoring.md).

[Back to the workflow index](README.md)

### Approvers (D-029, 17 November 2026)

- Approving MyLoans changes is **permission only**: anyone with the approver tick whose access includes the loan's branch decides it, and is told about it. "All branches" covers every branch, including branches with no approver of their own.
- There is **no automatic fallback to Admin**. A branch where nobody has the approver tick in their own access is listed as "N active branches have no approver assigned." on Settings, Branches and on the Superadmin's Home, so it gets fixed. Its items stay visible to All-branches approvers.
- **People with no branch** (active, not All branches, no branch in their access) see nothing at all. Users and the Superadmin's Home show "N users have no branches assigned (they see nothing)." in the same style, with the names (Show users on Users, each a link to Edit) and what to do: give them their branches on Users, Edit, or make them inactive if they have left.
- Funds requests and their notices follow branch scope too (D-030): a request is in a person's scope only when the processor's branch and every line's loan are in their access.
