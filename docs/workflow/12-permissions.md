# Permissions

Every feature is a tick on a role: how the ticks work, the full catalogue, the defaults and the audit of the permissions pass.

Last updated: 11 November 2026 (PHT)

## Roles are just ticks

- A role is a name plus a list of ticks. Admin opens **Settings, Roles**, ticks what a role may see or do, and the app follows on each person's next page. No code looks at a role's name or key to decide anything; Admin is an ordinary role whose defaults are "everything except the loan-file work steps" (opening and checking loan files, sending, processing and the funds steps belong to the roles that do them).
- **The server is the real check.** Every server action and API route calls `requirePermission` / `requireAnyPermission` / `can` (one helper, `lib/auth/current-user.ts`). Buttons only hide for convenience. A test scans the code and fails when a new action or route has no check (the short allow-list is at the end of this page).
- **When a person lacks a tick:** a feature they never use is hidden. Inside a place they do use, the place stays tidy: for example on a loan file without "Refresh a loan from MyLoans" there is no Refresh button, and without "See when MyLoans was last checked" there is no "Last checked" line either. No dead buttons: if the server refuses, the message says which tick to ask for, for example "Ask an Admin to turn on "Refresh a loan from MyLoans" for your role."
- **View and Change.** Where a feature has both (See branches / Change branches, See email settings / Change email settings, See users / Add or edit users, See when MyLoans was last checked / Refresh, See the LTO monitor / Manage LTO advisories, See the TAT report / Download it), the editor shows them side by side. Ticking Change also ticks View; unticking View also unticks Change, and the editor says so in one line. Other ticks that need another one work the same way (for example Send to a processor needs Tick papers).
- **Branch access is separate.** Ticks say *what* a person can do; Users, Edit, Branch access says *where* (All branches, or Divisions, Areas and Branches minus exceptions). Changing it is its own tick, "Change branch access" (`access:manage`). See [Rules and roles](07-rules-and-roles.md).
- **Notifications follow ticks too.** "Be told about LTO advisories" decides who hears about LTO advisories (the Operations Monitor by default); people with "Resolve any problem" in a branch are told about its problems, holds and overdue work (Admin by default); "Review MyLoans changes" decides who is told about MyLoans changes.

## The role editor

- Ticks are grouped by area with plain headings: Loans; Transactions and papers; Send to DP and returns; DP work; Funds; Monitoring; Reports; MyLoans and sync; Branches and access; Settings and Admin; Email. Each tick has a plain label and one grey line saying what it lets the person do. "Show technical names" adds the key (for example `loans:refresh`) under each one.
- Each group has "Tick all in this group" and "Clear this group"; a search box filters the list. The top says "N permissions ticked" and "Used by N users".
- Before saving, an impact preview says who gains and who loses, for example "3 users gain: Refresh a loan from MyLoans. 0 users lose anything." A change that removes something asks for confirmation first.
- "Copy from another role" starts a new role from another role's ticks. Built-in roles stay editable (Reset to default restores the seeded ticks).
- Every change is recorded in the audit log (who, when, what was added or removed), and the role card shows the last change.

## Lock-out protection

Two ticks must always stay with someone: **Manage roles** (`roles:manage`) and **Change branch access** (`access:manage`). The server refuses, and the editor shows the reason before Save:

- removing the tick from the last active role that has it: "Admin is the last role that can manage roles. Keep "Manage roles" ticked, or tick it on another role first.";
- a change after which no active person would have it (removing it from the only role that active people hold, making that role inactive, or moving or deactivating the last such person): "Nobody active could change branch access after this change. Keep "Change branch access" ticked, or give a role with it to another active person first." / "This is the last active person who can manage roles. Give "Manage roles" to another active person first.";
- taking "Manage roles" away from your own role or from yourself.

The same rule applies to Users, Edit, to Make inactive and to the users import. It looks only at ticks, never at a role's name.

## Gaps found by the audit, and how they were closed

| Gap | Before | After |
|---|---|---|
| Refresh from MyLoans on a loan file | No check: shown to and allowed for everyone who could see the loan file | `loans:refresh` (button and server). Given to every role that saw it (LA, Admin, DP, Vault, Digital Records, QA, and custom roles that see loan files such as the kit's Branch Supervisor); not Finance, Approvers or Operations Monitor |
| "MyLoans · Last checked" on a loan file | Shown to everyone who could see the loan file | `myloans:view`, given to every role with `loans:view` |
| Resume a hold, add remarks to an older hold | Only "is the hold owner" (no tick) | `holds:resolve` on the server, plus the owner rule |
| Simulate a MyLoans change (test mode) | Signed-in only at the action; the tick was checked deeper in the service | `simulator:use` at the action too |
| Stage evidence files (`/api/stage-files/...`) | Signed-in and the job or branch in scope, no tick | `loans:view` plus the same scope rule |
| Admin's powers | Admin was locked in code: every key except the work steps, whatever was stored; Admin people always had All branches | Admin is an ordinary role; its ticks were stored by the migration and its people got All branches stored on their user |
| "Last active Admin" rules | By the role's key (ADMIN) | The lock-out rule above, by ticks |
| Who is told about problems, holds, overdue work | The Admin role, by its key | People with "Resolve any problem" in that branch |
| Who is told about LTO advisories | The Operations Monitor role, by its key | `ltoreports:notify` ("Be told about LTO advisories") |
| Who is told about MyLoans changes | The Admin role by its key, or `source:review` | `myloans:review` only |
| Hold transfer in any branch | Admin by its key | All branches in the person's own access (Admin people have it) |
| The DP round chip on a loan file | LA, or Admin by its key | LA, or `rules:override` (a supervisor) |

Splits (one old tick became several, nobody gained or lost anything): `source:manage` became `myloans:manage` (settings), `myloans:sync` (Run now), `branches:import` and `branches:review`; `settings:branches` became `branches:manage` with `branches:view`; `users:edit` gained `access:manage`; `settings:system` gained `settings:pn_format`; `email:manage` gained `email:view`; the TAT CSV (`reports:tat` + `loans:export`) became `reports:tat_export`; `source:review` was renamed `myloans:review`.

The migration `20261119090004_permissions_pass` does this for every role in the database, built-in and custom (permissions are stored as text in `Role.permissions`).

<!-- generated:permissions:start (npm run docs:permissions; do not edit by hand) -->

## The catalogue

Every tick in Settings, Roles, by group, in the order the role editor shows them. **Default roles** are the built-in roles that have it after a fresh install (Reset to default restores these). The technical name is what the server checks; the role editor shows it only with "Show technical names" on.

### Loans

| Tick | What it lets the person do | Where it appears | Needs | Technical name | Default roles |
|---|---|---|---|---|---|
| See loan files | Open and read loan files, Home and Updates. Which branches depends on the person's Branch access. | Loans, Loan File, Home, Updates | - | `loans:view` | LA, Admin, DP, Finance, Vault, Digital Records, QA, Approvers, Branch Supervisor |
| Find a loan | Search the loan files in the DMS, and look up a full PN in MyLoans to see the preview. | Find loan, Search | See loan files | `loans:search` | LA, Admin, Branch Supervisor |
| Open a loan file | Start a new loan file from a MyLoans loan. | Search, Open loan file | Find a loan | `loans:open` | LA |
| Change an automatic result | Supervisor override of the classification and transactions, with a reason. | Loan File, Change an automatic result | See loan files | `rules:override` | Admin |

### Transactions and papers

| Tick | What it lets the person do | Where it appears | Needs | Technical name | Default roles |
|---|---|---|---|---|---|
| Tick papers | Tick the papers in hand, report and resolve problems. | Loan File, To do and Papers | See loan files | `checklist:tick` | LA |
| Mark a paper Missing | On Check papers: mark a paper Missing with a reason and remarks, so the file can still be sent. Edits after sending are kept in the history. | Loan File, Check papers | Tick papers | `papers:mark_missing` | LA |
| Receive a missing paper | Mark a missing paper Received, with the date it arrived. The reason and remarks stay in the history. | Loan File, Check papers and Missing papers | See loan files | `papers:receive_late` | LA, Admin |
| Add a transaction | Add a custom transaction type to a loan file. | Loan File, Add a transaction | Tick papers | `transactions:add` | LA |
| Mark as done | Record the EDST reference, and mark custom transactions done. | Loan File, EDST and Mark as done | Tick papers | `transactions:complete` | LA |
| Raise a problem | Open a problem on a transaction the person works on. | Loan File, Job | See loan files | `problems:raise` | LA, DP |
| Resolve own problems | Resolve problems on transactions the person works on. | Loan File, Job | Raise a problem | `problems:resolve` | LA, DP |
| Resolve any problem | Resolve a problem on any transaction in the person's branches. People with this are also told about problems, holds and overdue work there. | Loan File, Job; notifications | See loan files | `problems:resolve_any` | Admin, Branch Supervisor |
| Mark outside our control | Tag a problem for reports. It does not stop the clock. | Job, Problem | See loan files | `problems:mark_outside_control` | Admin |
| Put work on hold | Put a transaction on hold while it waits on something that is not a fault. Only on work the person does. The clock keeps counting. | Loan File, Job | See loan files | `holds:raise` | LA, DP |
| Resume own holds | Resume a hold the person owns, or add the remarks to an older hold of theirs. | Loan File, Job, Open items | Put work on hold | `holds:resolve` | LA, DP |
| Move a hold to another person | Give a hold to another person of the same work (for example when the owner is on leave). Only in the person's branches, and only to someone who also has access to that branch. It never resumes the hold. | Loan File, Open items | See loan files | `holds:transfer` | Admin, Branch Supervisor |

### Send to DP and returns

| Tick | What it lets the person do | Where it appears | Needs | Technical name | Default roles |
|---|---|---|---|---|---|
| Send to a processor | Pick a Document Processor and send the papers. Also asks Finance for a cash advance. | Loan File, Send | Tick papers | `processing:send` | LA |
| Flag funds | Say whether a transaction needs funds when sending it. No amount. | Loan File, Send | Tick papers | `funds:flag` | LA |
| Accept returned papers | Be the Loan Associate who receives papers back from a processor, and get branch updates. | Receive package | See loan files | `processing:accept_returns` | LA |

### DP work

| Tick | What it lets the person do | Where it appears | Needs | Technical name | Default roles |
|---|---|---|---|---|---|
| Receive and process transactions | The processor side: people with this appear in the "Who should do it" list for their branches. | Send (Who should do it) | See loan files | `processing:receive` | DP |
| Work on jobs | Accept, decline, return, log attempts, complete and forward assigned jobs. | My jobs, Job | Receive and process transactions | `jobs:work` | DP |
| Pass a job to a second processor | Pasuyo: hand an accepted job to another processor, with a reason. | Job, Pasuyo | Work on jobs | `jobs:pasuyo` | DP |
| Return a job to the LA for missing papers | After accepting: send the job back to the Loan Associate when a paper is missing or wrong. The clock keeps counting. | Job, Return to LA | Work on jobs | `jobs:return_to_la` | DP |
| File an LTO advisory | Report a problem at an LTO office (system down, closed, long queue) from a job at an LTO stage. It warns others; it never blocks anything. | Job at an LTO stage | - | `ltoreports:create` | Admin, DP |

### Funds

| Tick | What it lets the person do | Where it appears | Needs | Technical name | Default roles |
|---|---|---|---|---|---|
| Request a cash advance | Ask for one advance covering several jobs, top-ups and carry-overs. | My funds, Job | Work on jobs | `funds:request` | DP |
| Liquidate | Record receipts and return cash. | My funds | Request a cash advance | `funds:liquidate` | DP |
| Grant a funds exception | Let a processor with an overdue advance submit one more request (both types). | Funds | - | `funds:exception` | Finance |
| See expense kinds | See Settings, Expense kinds: what a cash advance or fund transfer can be for, and each kind's amount. | Settings, Expense kinds | - | `funds:kinds_view` | LA, Admin, DP, Finance, Approvers |
| Add and manage expense kinds (Change; View is See expense kinds) | Add, rename, reorder or switch off expense kinds and set their amount; "+ Add new kind" on the funds screens; change a fixed amount on one request. | Settings, Expense kinds; Funds, To approve; My funds | See expense kinds | `funds:kinds_manage` | Admin, Finance, Approvers |
| See cash amounts in the Journey | Show peso amounts in a loan's Journey. Without it, the Journey shows the funds status only. | Loan File, Journey; LTO monitor amounts | See loan files | `journey:view_amounts` | Admin, Finance, Approvers |
| See cash advances | The Funds page for cash advances: every request in the person's branches, the counts and the receipts. | Funds, Receipts | See loan files | `funds:ca_view` | Admin, Finance |
| Approve cash advances | Approve or deny cash advances (and their top-ups and carry-overs) within the approval bands of this type. | Funds, To approve | See cash advances | `funds:ca_approve` | Finance |
| Release cash advances | Release the approved money (and approved top-ups) of cash advances. | Funds, To release | See cash advances | `funds:ca_release` | Finance |
| Settle and close cash advances | Confirm returned cash and close cash advances. Told when liquidation is submitted or overdue. | Funds, Outstanding | See cash advances | `funds:ca_settle` | Finance |
| Edit lines of cash advances | Change or add a line before the request is decided. | Funds, To approve | See cash advances | `funds:ca_edit_lines` | Finance |
| Change type of cash advances | Change the type before release, with remarks. Changing into the other type needs that type's Change type tick too. | Funds, To approve and To release | See cash advances | `funds:ca_change_type` | Finance |
| Print liquidation report for cash advances | Open and print the liquidation report of cash advances. | Funds, Outstanding and History, Print; the liquidation report page | See cash advances | `funds:ca_print` | Admin, Finance |
| See fund transfers | The Funds page for fund transfers: every request in the person's branches, the counts and the receipts. | Funds, Receipts | See loan files | `funds:ft_view` | Admin, Finance |
| Approve fund transfers | Approve or deny fund transfers (and their top-ups and carry-overs) within the approval bands of this type. | Funds, To approve | See fund transfers | `funds:ft_approve` | Finance |
| Release fund transfers | Release the approved money (and approved top-ups) of fund transfers. | Funds, To release | See fund transfers | `funds:ft_release` | Finance |
| Settle and close fund transfers | Confirm returned cash and close fund transfers. Told when liquidation is submitted or overdue. | Funds, Outstanding | See fund transfers | `funds:ft_settle` | Finance |
| Edit lines of fund transfers | Change or add a line before the request is decided. | Funds, To approve | See fund transfers | `funds:ft_edit_lines` | Finance |
| Change type of fund transfers | Change the type before release, with remarks. Changing into the other type needs that type's Change type tick too. | Funds, To approve and To release | See fund transfers | `funds:ft_change_type` | Finance |
| Print liquidation report for fund transfers | Open and print the liquidation report of fund transfers. | Funds, Outstanding and History, Print; the liquidation report page | See fund transfers | `funds:ft_print` | Admin, Finance |

### Monitoring

| Tick | What it lets the person do | Where it appears | Needs | Technical name | Default roles |
|---|---|---|---|---|---|
| See the DP monitor | Each processor's open jobs, times, declines, returns and availability. Counts, times and PN lists only. | Monitoring, DPs | - | `monitor:dp` | Admin, Operations Monitor, Branch Supervisor |
| See the LTO monitor | Jobs at each LTO office, time at the LTO and advisories. | Monitoring, LTO offices | - | `monitor:lto` | Admin, Operations Monitor, Branch Supervisor |
| Manage LTO advisories (Change; View is See the LTO monitor) | Resolve or edit any LTO advisory, and file one from the Monitoring page. People with this are told when an advisory is filed. | Monitoring, LTO offices | See the LTO monitor | `ltoreports:manage` | Admin, Operations Monitor |
| Be told about LTO advisories | Get a notification (and an email when emails are on) when an LTO advisory is filed or resolved. Processors are never told. | Notifications | See the LTO monitor | `ltoreports:notify` | Operations Monitor |
| Set processor capacity and leave | The default number of open jobs, a processor's own capacity, and On leave. | Settings, Processor capacity | - | `dpcapacity:manage` | Admin |

### Reports

| Tick | What it lets the person do | Where it appears | Needs | Technical name | Default roles |
|---|---|---|---|---|---|
| See the TAT and problems report | Problems and holds by reason, days, overdue counts. | Reports, TAT | See loan files | `reports:tat` | Admin, Branch Supervisor |
| See the audit log | Every automatic decision and user action (the technical log). | Audit log | - | `audit:view` | Admin |

### MyLoans and sync

| Tick | What it lets the person do | Where it appears | Needs | Technical name | Default roles |
|---|---|---|---|---|---|
| See when MyLoans was last checked | Show "MyLoans · Last checked" on a loan file. | Loan File, top strip | See loan files | `myloans:view` | LA, Admin, DP, Finance, Vault, Digital Records, QA, Approvers, Branch Supervisor |
| Refresh a loan from MyLoans (Change; View is See when MyLoans was last checked) | The Refresh from MyLoans button on a loan file: ask MyLoans for the latest copy now. | Loan File, Refresh from MyLoans | See when MyLoans was last checked | `loans:refresh` | LA, Admin, DP, Vault, Digital Records, QA, Branch Supervisor |
| Review MyLoans changes | Decide what to do when MyLoans changes a loan: apply, keep the current setup, close as cancelled, link a replacement PN, copy reusable papers. | Loan File, Open items, MyLoans changes | See loan files | `myloans:review` | Admin |
| Change MyLoans sync settings | How often loans are checked against MyLoans and the business hours. | Settings, MyLoans sync | - | `myloans:manage` | Admin |
| Run the MyLoans sync now | The Run now button: check every open loan against MyLoans at once. | Settings, MyLoans sync, Run now | - | `myloans:sync` | Admin |

### Branches and access

| Tick | What it lets the person do | Where it appears | Needs | Technical name | Default roles |
|---|---|---|---|---|---|
| See branches | See Settings, Branches: codes, areas, divisions and the sync history. | Settings, Branches | - | `branches:view` | Admin |
| Change branches (Change; View is See branches) | Edit the DMS fields of a branch, add one by hand, hide a test branch. | Settings, Branches | See branches | `branches:manage` | Admin |
| Import branches from MyLoans | Import the MyLoans branch file, run Branches from MyLoans and set its schedule. | Settings, Branches, Import from MyLoans | See branches | `branches:import` | Admin |
| Decide branch changes | The Branch review: accept or ignore new, renamed, closed or moved branches from MyLoans. | Settings, Branches, Branch review | See branches | `branches:review` | Admin |
| See users | See the Users page. | Users | - | `users:view` | Admin |
| Add or edit users (Change; View is See users) | Add users, change their name, role and status. | Users, Add and Edit | See users | `users:edit` | Admin |
| Change branch access | Choose which branches a person works in: All, divisions, areas, branches, exceptions and the home branch. | Users, Edit, Branch access; Copy access | Add or edit users | `access:manage` | Admin |
| Manage roles | Add roles and change what each one may see and do. | Settings, Roles | See users | `roles:manage` | Admin |

### Settings and Admin

| Tick | What it lets the person do | Where it appears | Needs | Technical name | Default roles |
|---|---|---|---|---|---|
| Change loan types | Display names of the MyLoans loan types. | Settings, Loan types | - | `settings:loan_types` | Admin |
| Change transaction types | Rename, add custom types, who does them. | Settings, Transaction types | - | `settings:transaction_types` | Admin |
| Change document types | The kinds of paper checklist items use. | Settings, Document types | - | `settings:document_types` | Admin |
| Change checklist items | The papers for each transaction, required or optional. | Settings, Checklist items | - | `settings:checklist` | Admin |
| Change turnaround times | Target business days for each step. | Settings, Turnaround times | - | `settings:tat` | Admin |
| Change holidays | Days skipped when counting turnaround times. | Settings, Holidays | - | `settings:holidays` | Admin |
| Change cash-advance rules | Suggested and maximum amounts, carry-over and liquidation days, approval bands. | Settings, Cash advance | - | `settings:cash_advance` | Admin |
| Change LTO offices | Offices a processor can be sent to. | Settings, LTO offices | - | `settings:lto` | Admin |
| Change problem reasons | The reasons a job can be stuck. | Settings, Problem reasons | - | `settings:problem_reasons` | Admin |
| Change hold reasons | Add, rename, reorder or switch off the reasons a transaction can be on hold. | Settings, Hold reasons | - | `holds:manage` | Admin |
| Change return reasons | Why a processor returns a job to the Loan Associate for papers. | Settings, Return reasons | - | `settings:return_reasons` | Admin |
| Change missing paper reasons | The reasons a Loan Associate can pick when marking a paper Missing. | Settings, Missing paper reasons | - | `settings:missing_reasons` | Admin |
| Change funds types | Rename Cash advance or Fund transfer, add a type, set what Finance enters at release, or switch a type off. | Settings, Funds types | - | `fundtypes:manage` | Admin |
| Change processing stages | The stages of each transaction type, their evidence and targets. | Settings, Processing stages | - | `stages:manage` | Admin |
| Change system switches | MyLoans test switches, the simulator switch, sample MyLoans changes. | Settings, System | - | `settings:system` | Admin |
| Change the PN format | The parts of a PN (prefix, branch code, year, system digit, running number) and the PN check. | Settings, System, PN format | - | `settings:pn_format` | Admin |
| Import data | Import / Export files, for the lists this role may change. | Settings, Import / Export | - | `settings:import` | Admin |
| Use the test simulator | Move sample loans through the processor and vault steps, and simulate MyLoans changes. Only in test mode. | Loan File, Simulator (test mode) | See loan files | `simulator:use` | Admin |
| Use the Test kit | Back to the starting state, backups, and the data-check samples. Only in test mode, on a local test setup. | Settings, Test kit (local only) | - | `testdata:reset` | Admin |

### Email

| Tick | What it lets the person do | Where it appears | Needs | Technical name | Default roles |
|---|---|---|---|---|---|
| See email settings | See which emails are on, their messages and the recent emails. | Settings, Email | - | `email:view` | Admin |
| Change email settings (Change; View is See email settings) | Turn emails on or off, choose events, edit messages, send a test email, resend. | Settings, Email | See email settings | `email:manage` | Admin |

## Audit: before and after this pass

One row per feature. **Permission today** is what decided it before the permissions pass ("none" means no check on the server, or only the role's name); **Permission after this pass** is the tick that decides it now. Every gap is closed.

| Feature | Where it appears | Permission today | Permission after this pass | Gap |
|---|---|---|---|---|
| See loan files | Loans, Loan File, Home, Updates | loans:view | `loans:view` |  |
| Find a loan | Find loan, Search | loans:search | `loans:search` |  |
| Open a loan file | Search, Open loan file | loans:open | `loans:open` |  |
| Change an automatic result | Loan File, Change an automatic result | rules:override | `rules:override` |  |
| Tick papers | Loan File, To do and Papers | checklist:tick | `checklist:tick` |  |
| Mark a paper Missing | Loan File, Check papers | none (a missing paper blocked Send; the LA asked for it with checklist:tick) | `papers:mark_missing` | **Gap, closed** |
| Receive a missing paper | Loan File, Check papers and Missing papers | none (new) | `papers:receive_late` | **Gap, closed** |
| Add a transaction | Loan File, Add a transaction | transactions:add | `transactions:add` |  |
| Mark as done | Loan File, EDST and Mark as done | transactions:complete | `transactions:complete` |  |
| Raise a problem | Loan File, Job | problems:raise | `problems:raise` |  |
| Resolve own problems | Loan File, Job | problems:resolve | `problems:resolve` |  |
| Resolve any problem | Loan File, Job; notifications | problems:resolve_any (notifications: the Admin role, by its name) | `problems:resolve_any` | **Gap, closed** |
| Mark outside our control | Job, Problem | problems:mark_outside_control | `problems:mark_outside_control` |  |
| Put work on hold | Loan File, Job | holds:raise | `holds:raise` |  |
| Resume own holds | Loan File, Job, Open items | none (resume and add details checked only the hold owner) | `holds:resolve` | **Gap, closed** |
| Move a hold to another person | Loan File, Open items | holds:transfer (Admin: any branch, by role name) | `holds:transfer` | **Gap, closed** |
| Send to a processor | Loan File, Send | processing:send | `processing:send` |  |
| Flag funds | Loan File, Send | funds:flag | `funds:flag` |  |
| Accept returned papers | Receive package | processing:accept_returns | `processing:accept_returns` |  |
| Receive and process transactions | Send (Who should do it) | processing:receive | `processing:receive` |  |
| Work on jobs | My jobs, Job | jobs:work | `jobs:work` |  |
| Pass a job to a second processor | Job, Pasuyo | jobs:pasuyo | `jobs:pasuyo` |  |
| Return a job to the LA for missing papers | Job, Return to LA | jobs:return_to_la | `jobs:return_to_la` |  |
| File an LTO advisory | Job at an LTO stage | ltoreports:create | `ltoreports:create` |  |
| Request a cash advance | My funds, Job | funds:request | `funds:request` |  |
| Liquidate | My funds | funds:liquidate | `funds:liquidate` |  |
| Grant a funds exception | Funds | funds:exception | `funds:exception` |  |
| See expense kinds | Settings, Expense kinds | none (the kinds were fixed in code) | `funds:kinds_view` | **Gap, closed** |
| Add and manage expense kinds | Settings, Expense kinds; Funds, To approve; My funds | none (the kinds were fixed in code) | `funds:kinds_manage` | **Gap, closed** |
| See cash amounts in the Journey | Loan File, Journey; LTO monitor amounts | journey:view_amounts | `journey:view_amounts` |  |
| See cash advances | Funds, Receipts | funds:view_all | `funds:ca_view` | Split or renamed |
| Approve cash advances | Funds, To approve | funds:approve | `funds:ca_approve` | Split or renamed |
| Release cash advances | Funds, To release | funds:release | `funds:ca_release` | Split or renamed |
| Settle and close cash advances | Funds, Outstanding | funds:release | `funds:ca_settle` | Split or renamed |
| Edit lines of cash advances | Funds, To approve | funds:approve or funds:release | `funds:ca_edit_lines` | Split or renamed |
| Change type of cash advances | Funds, To approve and To release | funds:release | `funds:ca_change_type` | Split or renamed |
| Print liquidation report for cash advances | Funds, Outstanding and History, Print; the liquidation report page | funds:print | `funds:ca_print` | Split or renamed |
| See fund transfers | Funds, Receipts | funds:view_all | `funds:ft_view` | Split or renamed |
| Approve fund transfers | Funds, To approve | funds:approve | `funds:ft_approve` | Split or renamed |
| Release fund transfers | Funds, To release | funds:release | `funds:ft_release` | Split or renamed |
| Settle and close fund transfers | Funds, Outstanding | funds:release | `funds:ft_settle` | Split or renamed |
| Edit lines of fund transfers | Funds, To approve | funds:approve or funds:release | `funds:ft_edit_lines` | Split or renamed |
| Change type of fund transfers | Funds, To approve and To release | funds:release | `funds:ft_change_type` | Split or renamed |
| Print liquidation report for fund transfers | Funds, Outstanding and History, Print; the liquidation report page | funds:print | `funds:ft_print` | Split or renamed |
| See the DP monitor | Monitoring, DPs | monitor:dp | `monitor:dp` |  |
| See the LTO monitor | Monitoring, LTO offices | monitor:lto | `monitor:lto` |  |
| Manage LTO advisories | Monitoring, LTO offices | ltoreports:manage | `ltoreports:manage` |  |
| Be told about LTO advisories | Notifications | none (the Operations Monitor role, by its name) | `ltoreports:notify` | **Gap, closed** |
| Set processor capacity and leave | Settings, Processor capacity | dpcapacity:manage | `dpcapacity:manage` |  |
| See the TAT and problems report | Reports, TAT | reports:tat | `reports:tat` |  |
| See the audit log | Audit log | audit:view | `audit:view` |  |
| See when MyLoans was last checked | Loan File, top strip | loans:view | `myloans:view` | Split or renamed |
| Refresh a loan from MyLoans | Loan File, Refresh from MyLoans | none (shown to everyone who sees the loan file) | `loans:refresh` | **Gap, closed** |
| Review MyLoans changes | Loan File, Open items, MyLoans changes | source:review (also Admin by role name) | `myloans:review` | **Gap, closed** |
| Change MyLoans sync settings | Settings, MyLoans sync | source:manage | `myloans:manage` | Split or renamed |
| Run the MyLoans sync now | Settings, MyLoans sync, Run now | source:manage | `myloans:sync` | Split or renamed |
| See branches | Settings, Branches | settings:branches or source:manage | `branches:view` | Split or renamed |
| Change branches | Settings, Branches | settings:branches | `branches:manage` | Split or renamed |
| Import branches from MyLoans | Settings, Branches, Import from MyLoans | source:manage | `branches:import` | Split or renamed |
| Decide branch changes | Settings, Branches, Branch review | source:manage | `branches:review` | Split or renamed |
| See users | Users | users:view | `users:view` |  |
| Add or edit users | Users, Add and Edit | users:edit | `users:edit` |  |
| Change branch access | Users, Edit, Branch access; Copy access | users:edit | `access:manage` | Split or renamed |
| Manage roles | Settings, Roles | roles:manage | `roles:manage` |  |
| Change loan types | Settings, Loan types | settings:loan_types | `settings:loan_types` |  |
| Change transaction types | Settings, Transaction types | settings:transaction_types | `settings:transaction_types` |  |
| Change document types | Settings, Document types | settings:document_types | `settings:document_types` |  |
| Change checklist items | Settings, Checklist items | settings:checklist | `settings:checklist` |  |
| Change turnaround times | Settings, Turnaround times | settings:tat | `settings:tat` |  |
| Change holidays | Settings, Holidays | settings:holidays | `settings:holidays` |  |
| Change cash-advance rules | Settings, Cash advance | settings:cash_advance | `settings:cash_advance` |  |
| Change LTO offices | Settings, LTO offices | settings:lto | `settings:lto` |  |
| Change problem reasons | Settings, Problem reasons | settings:problem_reasons | `settings:problem_reasons` |  |
| Change hold reasons | Settings, Hold reasons | holds:manage | `holds:manage` |  |
| Change return reasons | Settings, Return reasons | settings:return_reasons | `settings:return_reasons` |  |
| Change missing paper reasons | Settings, Missing paper reasons | none (new) | `settings:missing_reasons` | **Gap, closed** |
| Change funds types | Settings, Funds types | fundtypes:manage | `fundtypes:manage` |  |
| Change processing stages | Settings, Processing stages | stages:manage | `stages:manage` |  |
| Change system switches | Settings, System | settings:system | `settings:system` |  |
| Change the PN format | Settings, System, PN format | settings:system | `settings:pn_format` | Split or renamed |
| Import data | Settings, Import / Export | settings:import | `settings:import` |  |
| Use the test simulator | Loan File, Simulator (test mode) | simulator:use (the MyLoans change simulator: checked in the service only) | `simulator:use` | Split or renamed |
| Use the Test kit | Settings, Test kit (local only) | testdata:reset | `testdata:reset` |  |
| See email settings | Settings, Email | email:manage | `email:view` | Split or renamed |
| Change email settings | Settings, Email | email:manage | `email:manage` |  |

## Server entry points without a permission tick

Every server action and API route checks a permission (a test scans `app/actions`, `app/login/actions.ts` and `app/api` and fails otherwise). Only these are allowed without one, each with its own check:

| Entry point | Why | Its own check |
|---|---|---|
| `app/api/health/route.ts` GET | Health check for the host: ok, environment, database up or down. No data. | `health` |
| `app/api/cron/myloans-sync/route.ts` POST | Scheduled MyLoans sync: its own secret (CRON_SECRET header), not a person. | `cronAllowed` |
| `app/api/cron/email-reminders/route.ts` POST | Scheduled email reminders: its own secret (CRON_SECRET header), not a person. | `cronAllowed` |
| `app/login/actions.ts` testSignIn | Test sign-in: before anyone is signed in (the test provider refuses outside test mode). | `testProvider.resolveUser` |
| `app/login/actions.ts` signOut | Sign out: anyone may end their own session. | `cookies()).delete(SESSION_COOKIE)` |
| `app/actions/loan.ts` markNotificationsReadAction | Marks the signed-in person's own notifications as read. | `getCurrentUser` |
| `app/actions/email.ts` myEmailPreferenceAction | The signed-in person's own email choice (non-urgent emails on or off). | `getCurrentUser` |

<!-- generated:permissions:end -->

[Back to the workflow index](README.md)
