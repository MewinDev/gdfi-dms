# Rules and roles

The automatic rules, the turnaround targets, the roles and examples of permissions.

Last updated: 12 November 2026 (PHT)

### Automatic rules (run once, when the LA clicks Open Loan File)

| Rule | Input | Result |
|---|---|---|
| 1 Classification | Product Name contains the whole word "Refinancing", else "Financing", else (or blank) | Refinancing, Financing, or Refinancing by default |
| 2 Undertaking | Financing only, picked by the LA | Undertaking or Non-Undertaking |
| 3 ORCR | Financing + Untransferred | Notary + EDST |
| 4 Mortgage | New and amount at or below PHP 500,000; Renewal and amount at or below PHP 1,000,000 | Mortgage: Notary, EDST, Entry of PPSR, Mortgage. Otherwise Notary and EDST |

### Turnaround targets (business days, all editable in Settings)

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

The clock never pauses. Holds and problems only change the colour and add their own timers. All times are shown in Philippine time (PHT).

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

### Roles (Admin is locked from LA, DP and Finance work steps)

| Role | Main work |
|---|---|
| LA | Search and open loans, check papers, flag funds, send, receive forwarded packages, EDST |
| DP | Accept or decline, stages, attempts, funds requests (Cash advance or Fund transfer), liquidation, return to LA, Pasuyo, check and verify, forward to a branch |
| Branch Supervisor (built in; the same role is used for an area supervisor by giving the person Area access) | See the loans of their branches and open loan files, move a hold to another person, resolve any problem there, the Monitoring pages for DPs and LTO offices, the TAT report, review borrower detail corrections from MyLoans (their branches). No money, Settings, users, roles or branch imports |
| Finance and approvers (per type: cash advances and fund transfers can be handled by different people) | Approve and release cash advances, send fund transfers, change a request's funds type before release (with remarks), change or add a line before approval, add expense kinds ("+ Add new kind"), confirm returns, close advances, follow up overdue liquidation |
| Admin | Settings, roles and access, Audit Log, TAT reports, review of MyLoans changes, closing cancelled loans |
| Operations Monitor | Read-only, all branches: the Monitoring page (DPs and LTO offices) and LTO advisories (resolve, edit, file from Monitoring). No loan files and no amounts. Told when an advisory is filed or resolved |

### Branch access: where a person works

Roles say what a person can do; branch access says where. It is set per user (Users, Edit, Branch access): **All branches**, or **Selected**: whole Divisions, whole Areas (the pair Division and Area) and single Branches together, minus exceptions (a branch unticked inside a ticked Area or Division). A ticked Area or Division includes a branch added to it later. The result is kept in a derived table (`user_branch_access`), rebuilt when a person's access changes, a branch moves to another Area, or a branch, Area or Division appears; every query that is limited by branch reads it. Admin people have All branches (stored on each person, like anyone else). Changing a person's branch access needs the tick `access:manage` (Change branch access). Each person who works on loans has a **home branch** inside their access: the default for new work and sending. Every branch in the access is workable, not only the home branch. Forwarding a finished package stays unrestricted: the processor picks any branch, then the named LA. A role's branch access is now only the default for new users of that role. Existing users kept what they had: their branch became their home branch and a single-branch grant; users whose role gave all branches got All branches.

Branches themselves come from MyLoans (Settings, Branches): for MyLoans branches the code, name, area, division and status are read-only in the DMS; branches are never deleted, only switched off (an inactive branch cannot be chosen for new work but stays on old loans) or hidden from the DMS (test and retired branches). Accepting a Branch review item that moves a branch, closes it or changes an Area first shows who gains or loses access; every access change is audited.

### Roles are just ticks

A role is a name and a list of ticks (permissions). Admin opens Settings, Roles and ticks what each role may see or do; the app follows on each person's next page, and the server checks every action (a button only hides for convenience). No code decides anything by a role's name, Admin included: Admin is an ordinary role whose default ticks are everything except the loan-file work steps. The full catalogue, the defaults, the role editor, lock-out protection (someone active always keeps `roles:manage` and `access:manage`) and the audit are in [Permissions](12-permissions.md).

Examples: `loans:refresh` (Refresh from MyLoans on a loan file; LA, Admin, DP, Vault, Digital Records, QA by default, not Finance, Approvers or Operations Monitor), `myloans:view` ("MyLoans · Last checked"), `funds:flag`, `funds:request`, per funds type (cash advances `funds:ca_*` and fund transfers `funds:ft_*`, handled by different people): `view` (the Funds page, CSV, receipts), `approve` (within that type's approval bands), `release`, `settle` (confirm returned cash, close), `edit_lines` (change or add a line before approval), `change_type` (the type before release; changing into the other type needs that type's tick too) and `print` (the liquidation report); Finance has both types, Admin has See and Print of both; they replaced `funds:view_all`, `funds:approve`, `funds:release` and `funds:print` (migration 20261119090007_funds_per_type gave both types to every role that had the old key), `jobs:work`, `jobs:pasuyo`, `jobs:return_to_la`, `holds:raise`, `holds:resolve` (resume: only the hold owner), `holds:transfer` ("Move a hold to another person": in the person's branches, to someone with access there; Admin and the Branch Supervisor by default, not Finance since 10 November 2026), `holds:manage` (Settings, Hold reasons; Admin only by default), `problems:raise`, `problems:resolve`, `problems:resolve_any` (also told about problems, holds and overdue work in the branch), `journey:view_amounts`, `myloans:review` (decide MyLoans changes), `source:review_borrower` ("Review borrower detail corrections": Accept the correction or Keep current when MyLoans changes a borrower's name, address, contact number, CIF or CIN; loans in the person's branches only; the Branch Supervisor, Admin and every role that approves funds by default, migration 20261119090012_borrower_details; when nobody assigned to the branch has it, Admin reviews it), `myloans:manage` (MyLoans sync settings), `myloans:sync` (Run now), `email:view` and `email:manage`, `stages:manage` (Settings, Processing stages; Admin only by default), `branches:view`, `branches:manage` (the DMS-only fields of a branch, branches made by hand, Hide from DMS), `branches:import` (Import from MyLoans, Branches from MyLoans), `branches:review` (the Branch review and Hide from DMS), `settings:system` (Settings, System switches), `settings:pn_format` (the PN format), `users:edit` (a person's name, role and status), `access:manage` (a person's branch access), `roles:manage`, `fundtypes:manage` (Settings, Funds types; Admin only by default), `funds:kinds_view` (see Settings, Expense kinds; every role that sees funds) and `funds:kinds_manage` (add, edit, reorder, make inactive expense kinds, "+ Add new kind" on the funds screens, change a fixed amount on one request; Admin, Finance and Approvers by default). Changing a request's funds type before release goes with `funds:release` (Finance).

Monitoring (group "Monitoring" in Roles): `monitor:dp` (the DP monitor), `monitor:lto` (the LTO monitor), `ltoreports:create` (file an LTO advisory from a job at an LTO stage; DP by default), `ltoreports:manage` (resolve or edit any advisory, file one from Monitoring; Admin and Operations Monitor by default), `ltoreports:notify` (be told about advisories; Operations Monitor by default) and `dpcapacity:manage` (Settings, Processor capacity: the default capacity, a processor's own capacity and On leave; Admin only by default). Admin has them all. They are not given to Finance by default; the Branch Supervisor has `monitor:dp` and `monitor:lto` (for their branches). A monitor sees counts, times and PN lists; opening a loan needs `loans:view` in that branch and amounts need `journey:view_amounts`. Definitions: [Monitoring](11-monitoring.md).

[Back to the workflow index](README.md)
