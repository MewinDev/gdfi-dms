# 04 Settings and customization: the master list

Last updated: 24 November 2026 (PHT)

## A. Purpose and roles

Everything that can be changed without a code change, in one place: app settings, the lists in Settings, the server's environment settings and every permission tick. Admin changes most settings (each area needs its own tick); Superadmin changes roles, the permission matrix and system switches. Every in-app change is audit-logged with who, before and after (`writeAudit`; `lib/services/admin.ts`: "Every change is audited"). In-app settings take effect on the next click or the next scheduled run; environment settings when the server or the scheduled job restarts.

## B. Checklist (the settings module itself)

| # | Item | Status | Where | Who | Customizable? | Evidence | UAT check |
|---|---|---|---|---|---|---|---|
| 1 | One Settings page with a card per area; each card shown only with its tick | ✅ Built | Settings (`/admin/settings`) | `settings:*` ticks | n/a | `app/(app)/admin/settings/page.tsx` (`AREAS`) | Admin sees every card; an LA sees none |
| 2 | Lists: add, rename, reorder, make inactive (never delete); CSV import / export with a preview | ✅ Built | Settings, each list, Import / Export | the area's tick + `settings:import` | Yes | `lib/import/*`, e2e `settings-crud-import.spec.ts` | Import the holidays CSV |
| 3 | Every in-app change audit-logged | ✅ Built | Audit log | `audit:view` | No | `writeAudit` in `lib/services/*` | UAT ADM-11 |
| 4 | v2 §9.1 process stages editable (add, remove, reorder, roles) | ⚠️ Partial: a processor's stages are editable; the loan-file stage order is fixed (Changed by D-020 and the stage map) | Settings, Processing stages | `stages:manage` | Partly | `docs/workflow/13-stages-and-next-steps.md` | Reorder a processing stage |
| 5 | v2 §9.1 alert settings (when, channel, recipients) | ⚠️ Partial: email per event on / off and templates; in-app updates always on; timing fixed | Settings, Email notifications | `email:manage` | Partly | `lib/email/*` | Turn one email event off |
| 6 | v2 §9.4 fee table per transaction type, rate per km, meals per day | ❌ Missing (expense kinds with amounts and the LTO office's usual km exist; no formula) | Settings, Expense kinds; LTO offices | `funds:kinds_manage` | n/a | module 14, row 1 | n/a |
| 7 | v2 §9.3 QA deficiency types and demerit points | 📦 Later phase (B) | n/a | n/a | n/a | `docs/STATUS.md` | n/a |
| 8 | v2 §9.6 archive locations and QR label settings | 📦 Later phase (C) | n/a | n/a | n/a | `docs/STATUS.md` | n/a |
| 9 | v2 §9.5 report filters and dashboard widgets per role | ❌ Missing (Home follows the person's ticks; not configurable) | n/a | n/a | n/a | `docs/workflow/07-rules-and-roles.md` (Home) | n/a |

## C. Master list

### C1. App settings (stored in the database)

| Setting | What it controls | Default | Allowed range | Where to change it | Who can change it | Audit-logged? | Takes effect when |
|---|---|---|---|---|---|---|---|
| Change run interval (`myloans.sync.intervalMinutes`) | How often the sync reads changes (API 2) | 30 minutes | 5 to 1,440 | Settings, MyLoans sync | `myloans:manage` (Admin) | Yes | Next scheduler call |
| Daily catch-up time and hours | Nightly re-read of the last N hours | 02:00 Manila, 26 hours | HH:MM; 1 to 168 | Settings, MyLoans sync | `myloans:manage` | Yes | Next scheduler call |
| Alert after failed runs | Admin and Superadmin told after N failed runs in a row | 3 | 1 to 50 | Settings, MyLoans sync | `myloans:manage` | Yes | Next failed run |
| Go-live date | The day the DMS starts; default branch-pool cutoff | not set | a date | Settings, MyLoans sync | `myloans:manage` | Yes | Next run / first load |
| Branch pool from (release date) | Released loans from this date enter the pools | go-live minus 30 days | a date | Settings, MyLoans sync | `myloans:manage` | Yes | Next run / first load |
| Refresh on open | A loan file older than this is refreshed when opened | 60 minutes | 0 to 1,440 (0 = always) | Settings, MyLoans sync | `myloans:manage` | Yes | Next open |
| Refresh on Find | Background refresh of a saved loan shown on Find loan | 4 hours | 0 to 720 (0 = never) | Settings, MyLoans sync | `myloans:manage` | Yes | Next search |
| Hourly limit | At most N myloans calls an hour | 600 | 10 to 100,000 | Settings, MyLoans sync | `myloans:manage` | Yes | At once |
| Pause MyLoans calls | No call from the sync or the refreshes | off | on / off | Settings, MyLoans sync | `myloans:manage` | Yes | At once |
| Monitored fields | Which fields raise Open Items (the status always does) | loan type, amount, product, release date, branch, source loan id, borrower name, CIF, CIN | any of these | Settings, Open Items | `myloans:manage` | Yes | Next sync or refresh |
| Product classification keywords | Financing / Refinancing from the product name | Refinancing: "refinanc", "refi" (whole word); Financing: "financ", "brand new", "2nd hand"; neither: Refinancing | any words, whole word or not | Settings, Product classification | `settings:classification` (LA Supervisor/Head) | Yes | Loan files opened from then on; Reclassify for open ones |
| A product set by hand | Overrides the keywords for one product | none | Financing / Refinancing, with a reason | Settings, Product classification | `settings:classification` | Yes, with the product's history | Loan files opened from then on |
| Working days | Which weekdays count | Monday to Saturday | at least one day | Settings, Holidays and working days | `settings:holidays` (Admin) | Yes | At once; Check lists the due dates it moves |
| Holidays and office closures | Days that do not count (all or some branches) | seeded sample list (the official list to be entered) | any date; back at most 7 days, with a reason | Settings, Holidays and working days | `settings:holidays` | Yes | At once; saved due dates move |
| Due dates corrected by hand | One item's due date | n/a | a working day, with a reason | Inbox, Correct due date | `duedates:correct` | Yes | At once |
| Pool waiting colours | Branch pool and Open Items waiting turns amber, then red | 1 and 2 working days | 1 to 30, red after amber | Settings, Inbox waiting colours | `settings:tat` (Admin) | Yes | At once |
| Turnaround times | Target working days per step | seeded (D-056 item 9, to confirm): checklist 1, assign to DP 1, DP accept 0, Notary 5, PPSR 5, Mortgage 5, cash advance release 1, receiving LA 2, and others | 0 or more | Settings, Turnaround times | `settings:tat` | Yes | New work items |
| Processor capacity and On leave | Open jobs a processor takes | 10 | 1 or more | Settings, Processor capacity | `dpcapacity:manage` | Yes | At once |
| Liquidation due days (per funds type) | Working days after the last LTO pickup | 2 | 0 to 30 | Settings, Funds types | `fundtypes:manage` (Admin) | Yes | New releases (saved on the record) |
| Carry-over limit | A balance carries to the next attempt without approval | 3 business days | 0 to 60 | Settings, Cash-advance rules | `settings:cash_advance` | Yes | At once |
| Block LTO until funded | "At the LTO" waits for released funds | on | on / off | Settings, Cash-advance rules | `settings:cash_advance` | Yes | At once |
| Block LTO until a transfer's receipt is confirmed (`funds.blockLtoUntilReceiptConfirmed`) | "At the LTO" also waits until the processor confirmed receipt of a fund transfer (D-056 item 1) [TO CONFIRM with Finance] | off | on / off | Settings, Cash-advance rules | `settings:cash_advance` | Yes | At once |
| Approval bands (switch and bands) | Who approves by amount (D-024) | off | bands by amount and role | Settings, Approval bands | `settings:cash_advance` | Yes | New requests |
| Cash-advance rules | Suggested and maximum amounts per transaction type | seeded | pesos | Settings, Cash-advance rules | `settings:cash_advance` | Yes | New requests |
| Expense kinds | What a request line can be for, with an amount | seeded; "Other" built in | any | Settings, Expense kinds | `funds:kinds_manage` (Finance) | Yes | New requests |
| Funds types | Cash advance, Fund transfer | CA, FT | on / off, fields | Settings, Funds types | `fundtypes:manage` | Yes | At once |
| PN format | Checks a PN before any search | GD + branch (3) + year (4) + "9" + running (5), on | parts, or off | Settings, System | `settings:pn_format` (Admin) | Yes | At once |
| Branch and product daily read | Time and pause of the daily read (APIs 4 and 5) | 02:00, on | HH:MM; pause | Settings, Branches | `branches:import` | Yes | Next run |
| Email master switch, events, templates | Which updates also go by email | off until go-live | on / off; text | Settings, Email notifications | `email:manage` | Yes | At once |
| Transaction types | Names, who does them, needs a processor, needs LTO | Notary, For EDST, For Entry PPSR, Mortgage (built in); Cancellation of Mortgage, Transfer of Ownership, Renewal of OR, PPSR Termination (added by hand, D-056) | add, rename, inactive | Settings, Transaction types | `settings:transaction_types` | Yes | Loan files opened from then on |
| Document types and checklist items | Kinds of paper; papers per transaction (required, pick-one group, reusable) | seeded | any | Settings, Document types / Checklist items | `settings:document_types`, `settings:checklist` | Yes | Loan files opened from then on |
| Processing stages | A processor's stages and their evidence | seeded (LTO drop off, LTO pickup, Check and verify, ...) | reorder, add | Settings, Processing stages | `stages:manage` | Yes | New jobs |
| Loan types | Display names for New and Renewal | New, Renewal | names only | Settings, Loan types | `settings:loan_types` | Yes | At once |
| Problem, hold, missing-paper and return reasons | The pick lists; whether a hold reason pauses the TAT | seeded ("Proposed") | add, rename, inactive, pauses TAT | Settings, the four reason cards | `settings:problem_reasons`, `holds:manage`, `settings:missing_reasons`, `settings:return_reasons` | Yes | At once |
| LTO offices | Offices, usual distance (km), suggested transport | seeded; LTO-PASIG marked sample | add, rename, inactive | Settings, LTO offices | `settings:lto` | Yes | At once |
| Branches (DMS fields) | Hide a test branch; decide closed or new branches (myloans owns code, name, area, division, status) | from myloans | n/a | Settings, Branches | `branches:manage`, `branches:review` | Yes | At once |
| Test helpers (simulator, mock failures, test data) | Testing only | off; refused in production | on / off | Settings, System and test mode; Test data | `simulator:use`, `testdata:reset` | Yes | At once |

### C2. Server (environment) settings

| Setting | What it controls | Default | Allowed range | Where to change it | Who can change it | Audit-logged? | Takes effect when |
|---|---|---|---|---|---|---|---|
| `APP_ENV`, `TEST_MODE`, `MYLOANS_MODE`, `AUTH_MODE` | Environment, test helpers, mock or live myloans, sign-in | local, false, mock, test (local only) | `docs/ENVIRONMENT.md` | Host environment variables | Infrastructure | No (the host's own log) | Restart; unsafe values refuse to start |
| `MYLOANS_TIMEOUT_MS` | myloans call time limit | the client's default | milliseconds | Host env | Infrastructure | No | Restart |
| `BACKUP_TARGET`, `BACKUP_DIR`, `BACKUP_S3_*` | Where backups go | folder `./backups/sets` | folder or s3 | Host env (keys as secrets) | Infrastructure | No | Next backup |
| `BACKUP_KEEP_DAYS` (backup retention) | How long backup sets are kept | 30 days; the newest always kept | whole days | Host env | Infrastructure | No | Next backup |
| `STORAGE_DRIVER`, `STORAGE_LOCAL_DIR`, `RECEIPTS_DIR` | Where uploaded files live | local, `./storage` | local (supabase not built) | Host env | Infrastructure | No | Restart |
| `EMAIL_AUTO_DRAIN`, `EMAIL_TEST_RECIPIENT`, `GRAPH_*` | Email sending | `docs/ENVIRONMENT.md` | `docs/ENVIRONMENT.md` | Host env | Infrastructure | No | Restart |
| `CRON_SECRET` | The scheduler's key | none | 24+ characters | Host env and the scheduler | Infrastructure | No | Restart |

### C3. Fixed in code (not settings; listed so nobody looks for them)

| Value | What | Where |
|---|---|---|
| Mortgage thresholds | New ≤ ₱500,000; Renewal ≤ ₱1,000,000 (v2 Rule 4) | `lib/rules/index.ts` |
| Backdate limit, due-date amber | A holiday back at most 7 days; due date amber 1 working day before | `lib/settings.ts` (defaults, no screen) |
| Import file sizes | Settings CSV import 2 MB; branch file 5 MB | `lib/import/columns.ts`, `lib/branches/file.ts` |
| Open Item remarks | 5 to 500 characters | `lib/services/open-items.ts` |
| Released status | Only myloans status 12 (Loan Released) opens a loan file | `lib/myloans/status.ts` |
| Sync lock expiry | 30 minutes | `docs/SCHEDULER.md` |

### C4. Permission ticks and their default roles

Generated from the code (`VISIBLE_PERMISSION_GROUPS` and `ROLE_DEFAULTS` in `lib/auth/permissions.ts`) on 24 November 2026. Change them in Settings, Permissions (per role) or Users, Edit (per person) with `roles:manage` (Superadmin by default). Every change is audit-logged and applies on the person's next click.

| Tick (key) | What it allows | Default roles | Where it shows |
|---|---|---|---|
| Loans: See loan files (`loans:view`) | Open and read loan files, Home and Updates. Which branches depends on the person's Branch access. | Superadmin, Loan Associate, Admin, Document Processor / Collateral & Mortgage, Finance, Custodian, Digicur, QA, Archiver, LA Supervisor/Head | Loans, Loan File, Home, Updates |
| Loans: Find a loan (`loans:search`) | Search the loan files in the DMS, and look up a full PN in MyLoans to see the preview. | Superadmin, Loan Associate, Admin, LA Supervisor/Head | Find loan, Search |
| Loans: Open a loan file (`loans:open`) | Start a new loan file from a MyLoans loan. | Loan Associate, LA Supervisor/Head | Search, Open loan file |
| Loans: Change an automatic result (`rules:override`) | Supervisor override of the classification and transactions, with a reason. | Superadmin, Admin | Loan File, Change an automatic result |
| Transactions and papers: Tick papers (`checklist:tick`) | Tick the papers in hand, report and resolve problems. | Loan Associate, LA Supervisor/Head | Loan File, To do and Papers |
| Transactions and papers: Mark a paper Missing (`papers:mark_missing`) | On Check papers: mark a paper Missing with a reason and remarks, so the file can still be sent. Edits after sending are kept in the history. | Loan Associate, LA Supervisor/Head | Loan File, Check papers |
| Transactions and papers: Receive a missing paper (`papers:receive_late`) | Mark a missing paper Received, with the date it arrived. The reason and remarks stay in the history. | Superadmin, Loan Associate, Admin, LA Supervisor/Head | Loan File, Check papers and Missing papers |
| Transactions and papers: Add a transaction (`transactions:add`) | Add a custom transaction type to a loan file. | Loan Associate, LA Supervisor/Head | Loan File, Add a transaction |
| Transactions and papers: Cancel a transaction (`transactions:cancel`) | Cancel a transaction that is not done, with a reason (D-056). Open processor jobs stop; cash already released stays owed and is liquidated as usual. | Admin, LA Supervisor/Head | Loan File, Cancel transaction |
| Transactions and papers: Mark as done (`transactions:complete`) | Record the EDST reference, and mark custom transactions done. | Loan Associate, LA Supervisor/Head | Loan File, EDST and Mark as done |
| Transactions and papers: Raise a problem (`problems:raise`) | Open a problem on a transaction the person works on. | Loan Associate, Document Processor / Collateral & Mortgage, LA Supervisor/Head | Loan File, Job |
| Transactions and papers: Resolve own problems (`problems:resolve`) | Resolve problems on transactions the person works on. | Loan Associate, Document Processor / Collateral & Mortgage, LA Supervisor/Head | Loan File, Job |
| Transactions and papers: Resolve any problem (`problems:resolve_any`) | Resolve a problem on any transaction in the person's branches. People with this are also told about problems, holds and overdue work there. | Admin, LA Supervisor/Head | Loan File, Job; notifications |
| Transactions and papers: Mark outside our control (`problems:mark_outside_control`) | Tag a problem for reports. It does not stop the clock. | Superadmin, Admin | Job, Problem |
| Transactions and papers: Put work on hold (`holds:raise`) | Put a transaction on hold while it waits on something that is not a fault. Only on work the person does. The clock keeps counting. | Loan Associate, Document Processor / Collateral & Mortgage, LA Supervisor/Head | Loan File, Job |
| Transactions and papers: Resume own holds (`holds:resolve`) | Resume a hold the person owns, or add the remarks to an older hold of theirs. | Loan Associate, Document Processor / Collateral & Mortgage, LA Supervisor/Head | Loan File, Job, Open items |
| Transactions and papers: Move a hold to another person (`holds:transfer`) | Give a hold to another person of the same work (for example when the owner is on leave). Only in the person's branches, and only to someone who also has access to that branch. It never resumes the hold. | Admin, LA Supervisor/Head | Loan File, Open items |
| Transactions and papers: Move work items (`workitems:move`) | Inbox: move someone's item back to the branch pool or give it to another person of the same work role who has the branch (for example when they are away). Their round closes as Moved (away), never late; the item keeps its overall due date. | Admin, LA Supervisor/Head | Inbox, Move |
| Transactions and papers: Set who is away (`users:away`) | Mark another person Away (from and to dates). While away they cannot be named for new work, and their items show on the supervisors' Home. Everyone can mark themselves away. | Admin, LA Supervisor/Head | Inbox, With people away |
| Send to DP and returns: Send to a processor (`processing:send`) | Pick a Document Processor and send the papers. Also asks Finance for a cash advance. | Loan Associate, LA Supervisor/Head | Loan File, Send |
| Send to DP and returns: Flag funds (`funds:flag`) | Say whether a transaction needs funds when sending it. No amount. | Loan Associate, LA Supervisor/Head | Loan File, Send |
| Send to DP and returns: Accept returned papers (`processing:accept_returns`) | Be the Loan Associate who receives papers back from a processor, and get branch updates. | Loan Associate, LA Supervisor/Head | Receive package |
| DP work: Receive and process transactions (`processing:receive`) | The processor side: people with this appear in the "Who should do it" list for their branches. | Document Processor / Collateral & Mortgage | Send (Who should do it) |
| DP work: Work on jobs (`jobs:work`) | Accept, decline, return, log attempts, complete and forward assigned jobs. | Document Processor / Collateral & Mortgage | My jobs, Job |
| DP work: Pass a job to a second processor (`jobs:pasuyo`) | Pasuyo: hand an accepted job to another processor, with a reason. | Document Processor / Collateral & Mortgage | Job, Pasuyo |
| DP work: Return a job to the LA for missing papers (`jobs:return_to_la`) | After accepting: send the job back to the Loan Associate when a paper is missing or wrong. The clock keeps counting. | Document Processor / Collateral & Mortgage | Job, Return to LA |
| DP work: File an LTO advisory (`ltoreports:create`) | Report a problem at an LTO office (system down, closed, long queue) from a job at an LTO stage. It warns others; it never blocks anything. | Superadmin, Admin, Document Processor / Collateral & Mortgage | Job at an LTO stage |
| Funds: Request a cash advance (`funds:request`) | Ask for one advance covering several jobs, top-ups and carry-overs. | Document Processor / Collateral & Mortgage | My funds, Job |
| Funds: Liquidate (`funds:liquidate`) | Record receipts and return cash. | Document Processor / Collateral & Mortgage | My funds |
| Funds: Grant a funds exception (`funds:exception`) | Let a processor with an overdue advance submit one more request (both types). | Finance | Funds |
| Funds: See expense kinds (`funds:kinds_view`) | See Settings, Expense kinds: what a cash advance or fund transfer can be for, and each kind's amount. | Superadmin, Loan Associate, Admin, Document Processor / Collateral & Mortgage, Finance, LA Supervisor/Head | Settings, Expense kinds |
| Funds: Add and manage expense kinds (`funds:kinds_manage`) | Add, rename, reorder or switch off expense kinds and set their amount; "+ Add new kind" on the funds screens; change a fixed amount on one request. | Superadmin, Admin, Finance | Settings, Expense kinds; Funds, To approve; My funds |
| Funds: See cash amounts in the Journey (`journey:view_amounts`) | Show peso amounts in a loan's Journey. Without it, the Journey shows the funds status only. | Superadmin, Admin, Finance | Loan File, Journey; LTO monitor amounts |
| Funds: See cash advances (`funds:ca_view`) | The Funds page for cash advances: every request in the person's branches, the counts and the receipts. | Superadmin, Admin, Finance | Funds, Receipts |
| Funds: Approve cash advances (`funds:ca_approve`) | Approve or deny cash advances (and their top-ups and carry-overs) within the approval bands of this type. | Finance | Funds, To approve |
| Funds: Release cash advances (`funds:ca_release`) | Release the approved money (and approved top-ups) of cash advances. | Finance | Funds, To release |
| Funds: Settle and close cash advances (`funds:ca_settle`) | Confirm returned cash and close cash advances. Told when liquidation is submitted or overdue. | Finance | Funds, Outstanding |
| Funds: Edit lines of cash advances (`funds:ca_edit_lines`) | Change or add a line before the request is decided. | Finance | Funds, To approve |
| Funds: Change type of cash advances (`funds:ca_change_type`) | Change the type before release, with remarks. Changing into the other type needs that type's Change type tick too. | Finance | Funds, To approve and To release |
| Funds: Print liquidation report for cash advances (`funds:ca_print`) | Open and print the liquidation report of cash advances. | Superadmin, Admin, Finance | Funds, Outstanding and History, Print; the liquidation report page |
| Funds: See fund transfers (`funds:ft_view`) | The Funds page for fund transfers: every request in the person's branches, the counts and the receipts. | Superadmin, Admin, Finance | Funds, Receipts |
| Funds: Approve fund transfers (`funds:ft_approve`) | Approve or deny fund transfers (and their top-ups and carry-overs) within the approval bands of this type. | Finance | Funds, To approve |
| Funds: Release fund transfers (`funds:ft_release`) | Release the approved money (and approved top-ups) of fund transfers. | Finance | Funds, To release |
| Funds: Settle and close fund transfers (`funds:ft_settle`) | Confirm returned cash and close fund transfers. Told when liquidation is submitted or overdue. | Finance | Funds, Outstanding |
| Funds: Edit lines of fund transfers (`funds:ft_edit_lines`) | Change or add a line before the request is decided. | Finance | Funds, To approve |
| Funds: Change type of fund transfers (`funds:ft_change_type`) | Change the type before release, with remarks. Changing into the other type needs that type's Change type tick too. | Finance | Funds, To approve and To release |
| Funds: Print liquidation report for fund transfers (`funds:ft_print`) | Open and print the liquidation report of fund transfers. | Superadmin, Admin, Finance | Funds, Outstanding and History, Print; the liquidation report page |
| Monitoring: See the DP monitor (`monitor:dp`) | Each processor's open jobs, times, declines, returns and availability. Counts, times and PN lists only. | Superadmin, Admin, Monitoring (read-only), LA Supervisor/Head | Monitoring, DPs |
| Monitoring: See the LTO monitor (`monitor:lto`) | Jobs at each LTO office, time at the LTO and advisories. | Superadmin, Admin, Monitoring (read-only), LA Supervisor/Head | Monitoring, LTO offices |
| Monitoring: Manage LTO advisories (`ltoreports:manage`) | Resolve or edit any LTO advisory, and file one from the Monitoring page. People with this are told when an advisory is filed. | Admin, Monitoring (read-only) | Monitoring, LTO offices |
| Monitoring: Be told about LTO advisories (`ltoreports:notify`) | Get a notification (and an email when emails are on) when an LTO advisory is filed or resolved. Processors are never told. | Monitoring (read-only) | Notifications |
| Monitoring: Set processor capacity and leave (`dpcapacity:manage`) | The default number of open jobs, a processor's own capacity, and On leave. | Superadmin, Admin | Settings, Processor capacity |
| Reports: See the TAT and problems report (`reports:tat`) | Problems and holds by reason, days, overdue counts. | Superadmin, Admin, LA Supervisor/Head | Reports, TAT |
| Reports: See PN searches (`reports:pnsearch`) | Every PN # searched on Find loan: who, the PN, what myloans answered, when (within the branches in your access). Download CSV. | Admin, LA Supervisor/Head | Reports, PN searches |
| Reports: See reference data changes (`refdata:view`) | Renames from myloans (area, division, company, branch and product names): applied by themselves and logged, with a notice for each new one. Never an Open Item. | Superadmin, Admin, LA Supervisor/Head | Settings, Reference data changes |
| Reports: See the audit log (`audit:view`) | Every automatic decision and user action (the technical log). | Superadmin, Admin | Audit log |
| Reports: View file access log (`audit:files`) | Who opened or downloaded which receipt, stage evidence or LTO proof, and when; filter and export it (each export is logged too). Give it to a Data Protection Officer if needed. | Superadmin, Admin | Audit, File access log |
| MyLoans and sync: See when MyLoans was last checked (`myloans:view`) | Show "MyLoans · Last checked" on a loan file. | Superadmin, Loan Associate, Admin, Document Processor / Collateral & Mortgage, Finance, Custodian, Digicur, QA, Archiver, LA Supervisor/Head | Loan File, top strip |
| MyLoans and sync: Reclassify a loan (`loans:reclassify`) | When the keyword rules changed after a loan file was opened ("Classification changed since accepted"): apply the new Financing or Refinancing result, with remarks. Sent work never changes. | Admin, LA Supervisor/Head | Loan File, Classification changed since accepted |
| MyLoans and sync: Refresh a loan from MyLoans (`loans:refresh`) | The Refresh from MyLoans button on a loan file: ask MyLoans for the latest copy now. | Superadmin, Loan Associate, Admin, Document Processor / Collateral & Mortgage, Custodian, Digicur, QA, Archiver, LA Supervisor/Head | Loan File, Refresh from MyLoans |
| MyLoans and sync: Review MyLoans changes (`myloans:review`) | Approve or reject Open Items on loan fields (loan type, amount, product, release date, branch, status), for the branches in your access; ask for cash back, link a replacement PN, copy reusable papers. | Admin, LA Supervisor/Head | Loan File, Open items, MyLoans changes |
| MyLoans and sync: Review borrower detail corrections (`myloans:review_borrower`) | Approve or reject Open Items on the borrower's name, CIF or CIN. Only for loans in the person's branches (All branches: every branch). No automatic fallback: a branch with no approver of its own is flagged on Settings, Branches. | Admin, LA Supervisor/Head | Loan File, To do, MyLoans corrections; Home |
| MyLoans and sync: Change MyLoans sync settings (`myloans:manage`) | The myloans sync: how often it runs, the daily catch-up, the alert, the go-live and branch-pool dates, and Pause MyLoans calls. | Superadmin, Admin | Settings, MyLoans sync |
| MyLoans and sync: Run the MyLoans sync now (`myloans:sync`) | Run now and Run the catch-up now: read what changed in myloans at once (nothing is applied; changes become review items). | Superadmin, Admin | Settings, MyLoans sync, Run now |
| Branches and access: See branches (`branches:view`) | See Settings, Branches: codes, areas, divisions and the sync history. | Superadmin, Admin | Settings, Branches |
| Branches and access: Change branches (`branches:manage`) | Edit the DMS fields of a branch, add one by hand, hide a test branch. | Superadmin, Admin | Settings, Branches |
| Branches and access: Import branches from MyLoans (`branches:import`) | Import the MyLoans branch file, run Branches from MyLoans and set its schedule. | Superadmin, Admin | Settings, Branches, Import from MyLoans |
| Branches and access: Decide branch changes (`branches:review`) | The Branch review: accept or ignore new, renamed, closed or moved branches from MyLoans. | Superadmin, Admin | Settings, Branches, Branch review |
| Branches and access: See users (`users:view`) | See the Users page. | Superadmin, Admin | Users |
| Branches and access: Add or edit users (`users:edit`) | Add users, change their name, role and status. | Superadmin, Admin | Users, Add and Edit |
| Branches and access: Change branch access (`access:manage`) | Choose which branches a person works in (divisions, areas, branches, exceptions, home branch) and whether they handle cash advances and fund transfers. Never your own. | Superadmin, Admin | Users, Edit, Branch access; Copy access |
| Branches and access: Give All branches (`access:all_branches`) | Give a person access to every branch. Never your own. | Superadmin | Users, Edit, Branch access |
| Branches and access: Manage permissions (`roles:manage`) | The permission matrix (what each role may see and do), per-user overrides, and who can approve LA Open Items. Never your own. | Superadmin | Settings, Permissions; Roles; Users, Edit, Permissions |
| Settings and Admin: Change loan types (`settings:loan_types`) | Display names of the MyLoans loan types. | Superadmin, Admin | Settings, Loan types |
| Settings and Admin: Change transaction types (`settings:transaction_types`) | Rename, add custom types, who does them. | Superadmin, Admin | Settings, Transaction types |
| Settings and Admin: Change document types (`settings:document_types`) | The kinds of paper checklist items use. | Superadmin, Admin | Settings, Document types |
| Settings and Admin: Change checklist items (`settings:checklist`) | The papers for each transaction, required or optional. | Superadmin, Admin | Settings, Checklist items |
| Settings and Admin: Change turnaround times (`settings:tat`) | Target business days for each step. | Superadmin, Admin | Settings, Turnaround times |
| Settings and Admin: Change holidays (`settings:holidays`) | The working days, holidays and office closures: the one calendar for every count. A change that takes a working day away moves the saved due dates it reaches (Check shows how many first). | Superadmin, Admin | Settings, Holidays and working days |
| Settings and Admin: Correct due dates (`duedates:correct`) | Change one saved due date (a job's TAT or a liquidation), with a reason. Shown in the item's due-date history and logged; the owner is told. | Superadmin, Admin | Job page and Funds, Due date |
| Settings and Admin: Change cash-advance rules (`settings:cash_advance`) | Suggested and maximum amounts, carry-over and liquidation days, approval bands. | Superadmin, Admin | Settings, Cash advance |
| Settings and Admin: Change LTO offices (`settings:lto`) | Offices a processor can be sent to. | Superadmin, Admin | Settings, LTO offices |
| Settings and Admin: Change problem reasons (`settings:problem_reasons`) | The reasons a job can be stuck. | Superadmin, Admin | Settings, Problem reasons |
| Settings and Admin: Change hold reasons (`holds:manage`) | Add, rename, reorder or switch off the reasons a transaction can be on hold. | Superadmin, Admin | Settings, Hold reasons |
| Settings and Admin: Change return reasons (`settings:return_reasons`) | Why a processor returns a job to the Loan Associate for papers. | Superadmin, Admin | Settings, Return reasons |
| Settings and Admin: Change missing paper reasons (`settings:missing_reasons`) | The reasons a Loan Associate can pick when marking a paper Missing. | Superadmin, Admin | Settings, Missing paper reasons |
| Settings and Admin: Change funds types (`fundtypes:manage`) | Rename Cash advance or Fund transfer, add a type, set what Finance enters at release, or switch a type off. | Superadmin, Admin | Settings, Funds types |
| Settings and Admin: Change processing stages (`stages:manage`) | The stages of each transaction type, their evidence and targets. | Superadmin, Admin | Settings, Processing stages |
| Settings and Admin: Change system switches (`settings:system`) | MyLoans test switches, the simulator switch, sample MyLoans changes. | Superadmin, Admin | Settings, System |
| Settings and Admin: Manage product classification (`settings:classification`) | The Refinancing and Financing keyword lists, the default for a product name with no keyword, and setting any product to Financing or Refinancing (overrides the keywords; a reason is required) (D-031, D-049). Saving re-checks open loan files. | LA Supervisor/Head | Settings, Product classification |
| Settings and Admin: Change the PN format (`settings:pn_format`) | The parts of a PN (prefix, branch code, year, system digit, running number) and the PN check. | Superadmin, Admin | Settings, System, PN format |
| Settings and Admin: Import data (`settings:import`) | Import / Export files, for the lists this role may change. | Superadmin, Admin | Settings, Import / Export |
| Settings and Admin: Use the test simulator (`simulator:use`) | Move sample loans through the processor and vault steps, and simulate MyLoans changes. Only in test mode. | Superadmin, Admin | Loan File, Simulator (test mode) |
| Settings and Admin: Use the Test kit (`testdata:reset`) | Back to the starting state, backups, and the data-check samples. Only in test mode, on a local test setup. | Superadmin, Admin | Settings, Test kit (local only) |
| Email: See email settings (`email:view`) | See which emails are on, their messages and the recent emails. | Superadmin, Admin | Settings, Email |
| Email: Change email settings (`email:manage`) | Turn emails on or off, choose events, edit messages, send a test email, resend. | Superadmin, Admin | Settings, Email |

## D. Known limits and open questions

- Audit log and file access log are kept forever today (append-only); a retention rule is phase C (D-007).
- The mortgage thresholds are fixed in code (v2 calls them rules); make them settings only if Operations asks.
- Receipt and evidence upload size is limited by the platform request limit, not a DMS setting.
