/**
 * Permission keys and the catalogue shown in Settings > Roles ("roles are just ticks").
 * Roles (Role table) list the keys they hold. Every authorization check goes through
 * can(user, key) in lib/auth/current-user.ts, backed by the database (re-read on every request).
 * No code decides access by a role's name or key: a role can do exactly what is ticked on it.
 * Each key below is enforced somewhere on the server; there are no decorative keys.
 * docs/workflow/12-permissions.md is generated from this file (npm run docs:permissions).
 * Pure data: safe to import in the browser and in the seed.
 */
export const PERMISSIONS = {
  // Loans
  LOANS_VIEW: "loans:view", // see loan files (branch scope comes from the person's Branch access)
  LOANS_SEARCH: "loans:search", // find a loan (PN search, MyLoans preview)
  LOANS_OPEN: "loans:open", // open a new loan file
  LOANS_EXPORT: "loans:export", // export loans (CSV)
  RULES_OVERRIDE: "rules:override", // change an automatic result (Supervisor override)
  // Transactions and papers
  CHECKLIST_TICK: "checklist:tick", // tick papers, ask for missing papers, report and resolve problems
  LABELS_PRINT: "labels:print", // print QR labels
  TXN_ADD: "transactions:add", // add a custom transaction to a loan file
  TXN_COMPLETE: "transactions:complete", // EDST reference, mark a custom transaction as done
  // Send to DP and returns
  DP_SEND: "processing:send", // send to a processor (and ask Finance for a cash advance)
  DP_RECEIVE: "processing:receive", // be a processor: appear in the "Who should do it" list
  RETURNS_ACCEPT: "processing:accept_returns", // be the receiving LA for returned papers; branch updates
  // Funds (cash advance)
  FUNDS_FLAG: "funds:flag", // LA: say whether a transaction needs funds (no amount)
  FUNDS_REQUEST: "funds:request", // DP: request a cash advance, top-ups, carry-overs
  FUNDS_LIQUIDATE: "funds:liquidate", // DP: receipts, returns
  // Per funds type (handled by different people): Cash advance (CA) and Fund transfer (FT). Each step
  // is two ticks; there is no "any type" key. Was funds:view_all, funds:approve, funds:release,
  // funds:print (migration 20261119090007_funds_per_type).
  FUNDS_CA_VIEW: "funds:ca_view", // the Funds page, lists, counts, CSV, receipts: cash advances
  FUNDS_CA_APPROVE: "funds:ca_approve", // approve or deny cash advances (and their top-ups, carry-overs) within the CA bands
  FUNDS_CA_RELEASE: "funds:ca_release", // release cash advances (and their top-ups)
  FUNDS_CA_SETTLE: "funds:ca_settle", // confirm returned cash and close cash advances
  FUNDS_CA_EDIT_LINES: "funds:ca_edit_lines", // change or add a line of a cash advance before it is decided
  FUNDS_CA_CHANGE_TYPE: "funds:ca_change_type", // change the type of a cash advance before release (changing into a type needs that type's tick too)
  FUNDS_CA_PRINT: "funds:ca_print", // the liquidation report of a cash advance
  FUNDS_FT_VIEW: "funds:ft_view",
  FUNDS_FT_APPROVE: "funds:ft_approve",
  FUNDS_FT_RELEASE: "funds:ft_release",
  FUNDS_FT_SETTLE: "funds:ft_settle",
  FUNDS_FT_EDIT_LINES: "funds:ft_edit_lines",
  FUNDS_FT_CHANGE_TYPE: "funds:ft_change_type",
  FUNDS_FT_PRINT: "funds:ft_print",
  FUNDS_EXCEPTION: "funds:exception", // let an overdue DP submit one more request
  FUNDS_KINDS_VIEW: "funds:kinds_view", // see Settings, Expense kinds
  FUNDS_KINDS_MANAGE: "funds:kinds_manage", // add, edit, reorder, switch off expense kinds; "+ Add new kind"; change a fixed amount for one request
  // DP work (processor side)
  JOBS_WORK: "jobs:work", // accept, decline, return, attempts, complete, forward
  JOBS_PASUYO: "jobs:pasuyo", // pass a job to a second processor (Pasuyo)
  JOBS_RETURN_TO_LA: "jobs:return_to_la", // return an accepted job to the LA for missing or wrong papers
  // Problems
  PROBLEMS_RAISE: "problems:raise",
  PROBLEMS_RESOLVE: "problems:resolve", // on transactions the person works on
  PROBLEMS_RESOLVE_ANY: "problems:resolve_any",
  PROBLEMS_OUTSIDE: "problems:mark_outside_control",
  // Holds (waiting on something that is not a fault)
  HOLDS_RAISE: "holds:raise", // put own work on hold (LA: transactions in the LA's hands; DP: own jobs)
  HOLDS_RESOLVE: "holds:resolve", // resume own holds, add the remarks to an older hold
  HOLDS_TRANSFER: "holds:transfer", // move a hold to another person (in the person's branches, to someone with access there). Never resume.
  // Journey
  JOURNEY_VIEW_AMOUNTS: "journey:view_amounts", // see cash amounts in the Journey (otherwise funds status only)
  // Reports
  REPORTS_TAT: "reports:tat",
  REPORTS_TAT_EXPORT: "reports:tat_export", // download the TAT and problems report (CSV)
  // Monitoring (counts, times and PN lists only; opening a loan or seeing amounts needs the usual permissions)
  MONITOR_DP: "monitor:dp", // see the DP monitor
  MONITOR_LTO: "monitor:lto", // see the LTO monitor
  LTO_REPORTS_CREATE: "ltoreports:create", // file an LTO advisory (from the DP job at an LTO stage)
  LTO_REPORTS_MANAGE: "ltoreports:manage", // resolve or edit any LTO advisory; file one from the Monitoring page
  LTO_REPORTS_NOTIFY: "ltoreports:notify", // be told (in-app, email) when an LTO advisory is filed or resolved
  DP_CAPACITY_MANAGE: "dpcapacity:manage", // set a processor's capacity and on-leave status, and the default capacity
  // Settings
  SETTINGS_LOAN_TYPES: "settings:loan_types",
  SETTINGS_TRANSACTION_TYPES: "settings:transaction_types",
  SETTINGS_DOCUMENT_TYPES: "settings:document_types",
  SETTINGS_CHECKLIST: "settings:checklist",
  SETTINGS_TAT: "settings:tat",
  SETTINGS_HOLIDAYS: "settings:holidays",
  SETTINGS_CASH_ADVANCE: "settings:cash_advance",
  SETTINGS_LTO: "settings:lto",
  SETTINGS_SYSTEM: "settings:system", // MyLoans test switches, simulator switch, mock source changes
  SETTINGS_PN_FORMAT: "settings:pn_format", // Settings, System, PN format
  SETTINGS_PROBLEM_REASONS: "settings:problem_reasons",
  HOLDS_MANAGE: "holds:manage", // Settings > Hold reasons (Admin only by default; was settings:hold_reasons)
  SETTINGS_RETURN_REASONS: "settings:return_reasons",
  STAGES_MANAGE: "stages:manage", // Settings > Processing stages (Admin only by default)
  FUNDS_TYPES_MANAGE: "fundtypes:manage", // Settings > Funds types (Admin only by default)
  SETTINGS_IMPORT: "settings:import", // Import / Export (with the permission for that list)
  // Email
  EMAIL_VIEW: "email:view", // see the email settings and recent emails
  EMAIL_MANAGE: "email:manage", // email notifications: on/off, events, messages, test send, resend
  // MyLoans and sync
  MYLOANS_VIEW: "myloans:view", // see "MyLoans · Last checked" on a loan file
  LOANS_REFRESH: "loans:refresh", // Refresh from MyLoans on a loan file
  SOURCE_REVIEW: "myloans:review", // decide MyLoans changes: Apply, Keep current, Close as cancelled, replacement PNs (was source:review)
  SOURCE_MANAGE: "myloans:manage", // MyLoans sync settings (was source:manage)
  MYLOANS_SYNC: "myloans:sync", // run the bulk sync now (Run now)
  // Branches and access
  BRANCHES_VIEW: "branches:view", // see Settings, Branches
  BRANCHES_MANAGE: "branches:manage", // add, edit, hide branches (was settings:branches)
  BRANCHES_IMPORT: "branches:import", // import the MyLoans branch file, Branches from MyLoans, its schedule
  BRANCHES_REVIEW: "branches:review", // decide Branch review items
  USERS_VIEW: "users:view",
  USERS_EDIT: "users:edit",
  ACCESS_MANAGE: "access:manage", // a person's branch access (All, Division, Area, Branch, exceptions, home branch)
  ROLES_MANAGE: "roles:manage",
  // Reports and audit
  AUDIT_VIEW: "audit:view",
  // Test tools
  SIMULATOR_USE: "simulator:use",
  TESTDATA_RESET: "testdata:reset",
} as const;

/**
 * The keys split per funds type (migration 20261119090007_funds_per_type): a role that had the old key
 * has both new keys. Edit lines was part of Approve and Release; Change type was part of Release only.
 */
export const SPLIT_PERMISSIONS: Record<string, Permission[]> = {
  "funds:view_all": [PERMISSIONS.FUNDS_CA_VIEW, PERMISSIONS.FUNDS_FT_VIEW],
  "funds:approve": [PERMISSIONS.FUNDS_CA_APPROVE, PERMISSIONS.FUNDS_FT_APPROVE, PERMISSIONS.FUNDS_CA_EDIT_LINES, PERMISSIONS.FUNDS_FT_EDIT_LINES],
  "funds:release": [PERMISSIONS.FUNDS_CA_RELEASE, PERMISSIONS.FUNDS_FT_RELEASE, PERMISSIONS.FUNDS_CA_SETTLE, PERMISSIONS.FUNDS_FT_SETTLE, PERMISSIONS.FUNDS_CA_EDIT_LINES, PERMISSIONS.FUNDS_FT_EDIT_LINES, PERMISSIONS.FUNDS_CA_CHANGE_TYPE, PERMISSIONS.FUNDS_FT_CHANGE_TYPE],
  // The single Edit tick of 20261119090007 (split in 20261119090008_funds_edit_split).
  "funds:ca_edit": [PERMISSIONS.FUNDS_CA_EDIT_LINES],
  "funds:ft_edit": [PERMISSIONS.FUNDS_FT_EDIT_LINES],
  "funds:print": [PERMISSIONS.FUNDS_CA_PRINT, PERMISSIONS.FUNDS_FT_PRINT],
};

/** The old name of a key the permissions pass renamed (migration 20261119090004_permissions_pass). */
export const RENAMED_PERMISSIONS: Record<string, Permission> = {
  "source:review": PERMISSIONS.SOURCE_REVIEW,
  "source:manage": PERMISSIONS.SOURCE_MANAGE,
  "settings:branches": PERMISSIONS.BRANCHES_MANAGE,
};

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
export const ALL_PERMISSIONS = Object.values(PERMISSIONS) as Permission[];

export interface PermissionDef {
  key: Permission;
  /** The tick, in plain words. */
  label: string;
  /** One grey line: what it lets the person do. */
  help: string;
  /** Turning this on also turns these on (and turning one of them off turns this off). */
  requires?: Permission[];
  /** The "Change" half of a View / Change pair: shown side by side with this View key. */
  view?: Permission;
  /** Words for the "In plain words" summary. */
  can: string;
  /** Where it appears in the app (docs/workflow/12-permissions.md). */
  where: string;
  /** What decided it before the permissions pass ("none" = no check; a key = that key). */
  was: string;
  /** A sub-heading inside the group (Funds: "Cash advance", "Fund transfer"). */
  subgroup?: string;
}
export interface PermissionGroup {
  key: string;
  label: string;
  items: PermissionDef[];
}

const P = PERMISSIONS;

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    key: "loans", label: "Loans", items: [
      { key: P.LOANS_VIEW, label: "See loan files", help: "Open and read loan files, Home and Updates. Which branches depends on the person's Branch access.", can: "see loan files", where: "Loans, Loan File, Home, Updates", was: "loans:view" },
      { key: P.LOANS_SEARCH, label: "Find a loan", help: "Search MyLoans by PN, CIN or CIF and see the preview.", requires: [P.LOANS_VIEW], can: "find loans", where: "Find loan, Search", was: "loans:search" },
      { key: P.LOANS_OPEN, label: "Open a loan file", help: "Start a new loan file from a MyLoans loan.", requires: [P.LOANS_SEARCH], can: "open new loan files", where: "Search, Open loan file", was: "loans:open" },
      { key: P.LOANS_EXPORT, label: "Export loans (CSV)", help: "Download the loan list as a spreadsheet file.", requires: [P.LOANS_VIEW], can: "export the loan list", where: "Loans, Export", was: "loans:export" },
      { key: P.RULES_OVERRIDE, label: "Change an automatic result", help: "Supervisor override of the classification and transactions, with a reason.", requires: [P.LOANS_VIEW], can: "override automatic results", where: "Loan File, Change an automatic result", was: "rules:override" },
    ],
  },
  {
    key: "papers", label: "Transactions and papers", items: [
      { key: P.CHECKLIST_TICK, label: "Tick papers", help: "Tick the papers in hand, ask for missing papers, report and resolve problems.", requires: [P.LOANS_VIEW], can: "tick papers", where: "Loan File, To do and Papers", was: "checklist:tick" },
      { key: P.LABELS_PRINT, label: "Print labels", help: "Print the QR labels for ticked papers.", requires: [P.CHECKLIST_TICK], can: "print labels", where: "Loan File, Labels", was: "labels:print" },
      { key: P.TXN_ADD, label: "Add a transaction", help: "Add a custom transaction type to a loan file.", requires: [P.CHECKLIST_TICK], can: "add transactions", where: "Loan File, Add a transaction", was: "transactions:add" },
      { key: P.TXN_COMPLETE, label: "Mark as done", help: "Record the EDST reference, and mark custom transactions done.", requires: [P.CHECKLIST_TICK], can: "mark transactions done", where: "Loan File, EDST and Mark as done", was: "transactions:complete" },
      { key: P.PROBLEMS_RAISE, label: "Raise a problem", help: "Open a problem on a transaction the person works on.", requires: [P.LOANS_VIEW], can: "raise problems", where: "Loan File, Job", was: "problems:raise" },
      { key: P.PROBLEMS_RESOLVE, label: "Resolve own problems", help: "Resolve problems on transactions the person works on.", requires: [P.PROBLEMS_RAISE], can: "resolve their problems", where: "Loan File, Job", was: "problems:resolve" },
      { key: P.PROBLEMS_RESOLVE_ANY, label: "Resolve any problem", help: "Resolve a problem on any transaction in the person's branches. People with this are also told about problems, holds and overdue work there.", requires: [P.LOANS_VIEW], can: "resolve any problem", where: "Loan File, Job; notifications", was: "problems:resolve_any (notifications: the Admin role, by its name)" },
      { key: P.PROBLEMS_OUTSIDE, label: "Mark outside our control", help: "Tag a problem for reports. It does not stop the clock.", requires: [P.LOANS_VIEW], can: "mark problems outside our control", where: "Job, Problem", was: "problems:mark_outside_control" },
      { key: P.HOLDS_RAISE, label: "Put work on hold", help: "Put a transaction on hold while it waits on something that is not a fault. Only on work the person does. The clock keeps counting.", requires: [P.LOANS_VIEW], can: "put their work on hold", where: "Loan File, Job", was: "holds:raise" },
      { key: P.HOLDS_RESOLVE, label: "Resume own holds", help: "Resume a hold the person owns, or add the remarks to an older hold of theirs.", requires: [P.HOLDS_RAISE], can: "resume their holds", where: "Loan File, Job, Open items", was: "none (resume and add details checked only the hold owner)" },
      { key: P.HOLDS_TRANSFER, label: "Move a hold to another person", help: "Give a hold to another person of the same work (for example when the owner is on leave). Only in the person's branches, and only to someone who also has access to that branch. It never resumes the hold.", requires: [P.LOANS_VIEW], can: "move holds to another person", where: "Loan File, Open items", was: "holds:transfer (Admin: any branch, by role name)" },
    ],
  },
  {
    key: "send", label: "Send to DP and returns", items: [
      { key: P.DP_SEND, label: "Send to a processor", help: "Pick a Document Processor and send the papers. Also asks Finance for a cash advance.", requires: [P.CHECKLIST_TICK], can: "send to a processor", where: "Loan File, Send", was: "processing:send" },
      { key: P.FUNDS_FLAG, label: "Flag funds", help: "Say whether a transaction needs funds when sending it. No amount.", requires: [P.CHECKLIST_TICK], can: "flag funds", where: "Loan File, Send", was: "funds:flag" },
      { key: P.RETURNS_ACCEPT, label: "Accept returned papers", help: "Be the Loan Associate who receives papers back from a processor, and get branch updates.", requires: [P.LOANS_VIEW], can: "accept returned papers", where: "Receive package", was: "processing:accept_returns" },
    ],
  },
  {
    key: "dp", label: "DP work", items: [
      { key: P.DP_RECEIVE, label: "Receive and process transactions", help: "The processor side: people with this appear in the \"Who should do it\" list for their branches.", requires: [P.LOANS_VIEW], can: "receive transactions as a processor", where: "Send (Who should do it)", was: "processing:receive" },
      { key: P.JOBS_WORK, label: "Work on jobs", help: "Accept, decline, return, log attempts, complete and forward assigned jobs.", requires: [P.DP_RECEIVE], can: "work on processor jobs", where: "My jobs, Job", was: "jobs:work" },
      { key: P.JOBS_PASUYO, label: "Pass a job to a second processor", help: "Pasuyo: hand an accepted job to another processor, with a reason.", requires: [P.JOBS_WORK], can: "pass jobs to a second processor", where: "Job, Pasuyo", was: "jobs:pasuyo" },
      { key: P.JOBS_RETURN_TO_LA, label: "Return a job to the LA for missing papers", help: "After accepting: send the job back to the Loan Associate when a paper is missing or wrong. The clock keeps counting.", requires: [P.JOBS_WORK], can: "return jobs to the LA for missing papers", where: "Job, Return to LA", was: "jobs:return_to_la" },
      { key: P.LTO_REPORTS_CREATE, label: "File an LTO advisory", help: "Report a problem at an LTO office (system down, closed, long queue) from a job at an LTO stage. It warns others; it never blocks anything.", can: "file LTO advisories", where: "Job at an LTO stage", was: "ltoreports:create" },
    ],
  },
  {
    key: "funds", label: "Funds", items: [
      { key: P.FUNDS_REQUEST, label: "Request a cash advance", help: "Ask for one advance covering several jobs, top-ups and carry-overs.", requires: [P.JOBS_WORK], can: "request cash advances", where: "My funds, Job", was: "funds:request" },
      { key: P.FUNDS_LIQUIDATE, label: "Liquidate", help: "Record receipts and return cash.", requires: [P.FUNDS_REQUEST], can: "liquidate cash advances", where: "My funds", was: "funds:liquidate" },
      { key: P.FUNDS_EXCEPTION, label: "Grant a funds exception", help: "Let a processor with an overdue advance submit one more request (both types).", can: "grant funds exceptions", where: "Funds", was: "funds:exception" },
      { key: P.FUNDS_KINDS_VIEW, label: "See expense kinds", help: "See Settings, Expense kinds: what a cash advance or fund transfer can be for, and each kind's amount.", can: "see expense kinds", where: "Settings, Expense kinds", was: "none (the kinds were fixed in code)" },
      { key: P.FUNDS_KINDS_MANAGE, label: "Add and manage expense kinds", help: "Add, rename, reorder or switch off expense kinds and set their amount; \"+ Add new kind\" on the funds screens; change a fixed amount on one request.", requires: [P.FUNDS_KINDS_VIEW], view: P.FUNDS_KINDS_VIEW, can: "add and manage expense kinds", where: "Settings, Expense kinds; Funds, To approve; My funds", was: "none (the kinds were fixed in code)" },
      { key: P.JOURNEY_VIEW_AMOUNTS, label: "See cash amounts in the Journey", help: "Show peso amounts in a loan's Journey. Without it, the Journey shows the funds status only.", requires: [P.LOANS_VIEW], can: "see cash amounts in the Journey", where: "Loan File, Journey; LTO monitor amounts", was: "journey:view_amounts" },
      { key: P.FUNDS_CA_VIEW, label: "See cash advances", help: "The Funds page for cash advances: every request in the person's branches, the counts, the CSV and the receipts.", requires: [P.LOANS_VIEW], can: "see cash advances", where: "Funds, Funds export, Receipts", was: "funds:view_all", subgroup: "Cash advance" },
      { key: P.FUNDS_CA_APPROVE, label: "Approve cash advances", help: "Approve or deny cash advances (and their top-ups and carry-overs) within the approval bands of this type.", requires: [P.FUNDS_CA_VIEW], can: "approve cash advances", where: "Funds, To approve", was: "funds:approve", subgroup: "Cash advance" },
      { key: P.FUNDS_CA_RELEASE, label: "Release cash advances", help: "Release the approved money (and approved top-ups) of cash advances.", requires: [P.FUNDS_CA_VIEW], can: "release cash advances", where: "Funds, To release", was: "funds:release", subgroup: "Cash advance" },
      { key: P.FUNDS_CA_SETTLE, label: "Settle and close cash advances", help: "Confirm returned cash and close cash advances. Told when liquidation is submitted or overdue.", requires: [P.FUNDS_CA_VIEW], can: "settle and close cash advances", where: "Funds, Outstanding", was: "funds:release", subgroup: "Cash advance" },
      { key: P.FUNDS_CA_EDIT_LINES, label: "Edit lines of cash advances", help: "Change or add a line before the request is decided.", requires: [P.FUNDS_CA_VIEW], can: "edit the lines of cash advances", where: "Funds, To approve", was: "funds:approve or funds:release", subgroup: "Cash advance" },
      { key: P.FUNDS_CA_CHANGE_TYPE, label: "Change type of cash advances", help: "Change the type before release, with remarks. Changing into the other type needs that type's Change type tick too.", requires: [P.FUNDS_CA_VIEW], can: "change the type of cash advances", where: "Funds, To approve and To release", was: "funds:release", subgroup: "Cash advance" },
      { key: P.FUNDS_CA_PRINT, label: "Print liquidation report for cash advances", help: "Open and print the liquidation report of cash advances.", requires: [P.FUNDS_CA_VIEW], can: "print liquidation reports for cash advances", where: "Funds, Outstanding and History, Print; the liquidation report page", was: "funds:print", subgroup: "Cash advance" },
      { key: P.FUNDS_FT_VIEW, label: "See fund transfers", help: "The Funds page for fund transfers: every request in the person's branches, the counts, the CSV and the receipts.", requires: [P.LOANS_VIEW], can: "see fund transfers", where: "Funds, Funds export, Receipts", was: "funds:view_all", subgroup: "Fund transfer" },
      { key: P.FUNDS_FT_APPROVE, label: "Approve fund transfers", help: "Approve or deny fund transfers (and their top-ups and carry-overs) within the approval bands of this type.", requires: [P.FUNDS_FT_VIEW], can: "approve fund transfers", where: "Funds, To approve", was: "funds:approve", subgroup: "Fund transfer" },
      { key: P.FUNDS_FT_RELEASE, label: "Release fund transfers", help: "Release the approved money (and approved top-ups) of fund transfers.", requires: [P.FUNDS_FT_VIEW], can: "release fund transfers", where: "Funds, To release", was: "funds:release", subgroup: "Fund transfer" },
      { key: P.FUNDS_FT_SETTLE, label: "Settle and close fund transfers", help: "Confirm returned cash and close fund transfers. Told when liquidation is submitted or overdue.", requires: [P.FUNDS_FT_VIEW], can: "settle and close fund transfers", where: "Funds, Outstanding", was: "funds:release", subgroup: "Fund transfer" },
      { key: P.FUNDS_FT_EDIT_LINES, label: "Edit lines of fund transfers", help: "Change or add a line before the request is decided.", requires: [P.FUNDS_FT_VIEW], can: "edit the lines of fund transfers", where: "Funds, To approve", was: "funds:approve or funds:release", subgroup: "Fund transfer" },
      { key: P.FUNDS_FT_CHANGE_TYPE, label: "Change type of fund transfers", help: "Change the type before release, with remarks. Changing into the other type needs that type's Change type tick too.", requires: [P.FUNDS_FT_VIEW], can: "change the type of fund transfers", where: "Funds, To approve and To release", was: "funds:release", subgroup: "Fund transfer" },
      { key: P.FUNDS_FT_PRINT, label: "Print liquidation report for fund transfers", help: "Open and print the liquidation report of fund transfers.", requires: [P.FUNDS_FT_VIEW], can: "print liquidation reports for fund transfers", where: "Funds, Outstanding and History, Print; the liquidation report page", was: "funds:print", subgroup: "Fund transfer" },
    ],
  },
  {
    key: "monitoring", label: "Monitoring", items: [
      { key: P.MONITOR_DP, label: "See the DP monitor", help: "Each processor's open jobs, times, declines, returns and availability. Counts, times and PN lists only.", can: "see the DP monitor", where: "Monitoring, DPs; its CSV", was: "monitor:dp" },
      { key: P.MONITOR_LTO, label: "See the LTO monitor", help: "Jobs at each LTO office, time at the LTO and advisories.", can: "see the LTO monitor", where: "Monitoring, LTO offices; its CSV", was: "monitor:lto" },
      { key: P.LTO_REPORTS_MANAGE, label: "Manage LTO advisories", help: "Resolve or edit any LTO advisory, and file one from the Monitoring page. People with this are told when an advisory is filed.", requires: [P.MONITOR_LTO], view: P.MONITOR_LTO, can: "manage LTO advisories", where: "Monitoring, LTO offices", was: "ltoreports:manage" },
      { key: P.LTO_REPORTS_NOTIFY, label: "Be told about LTO advisories", help: "Get a notification (and an email when emails are on) when an LTO advisory is filed or resolved. Processors are never told.", requires: [P.MONITOR_LTO], can: "be told about LTO advisories", where: "Notifications", was: "none (the Operations Monitor role, by its name)" },
      { key: P.DP_CAPACITY_MANAGE, label: "Set processor capacity and leave", help: "The default number of open jobs, a processor's own capacity, and On leave.", can: "set processor capacity and leave", where: "Settings, Processor capacity", was: "dpcapacity:manage" },
    ],
  },
  {
    key: "reports", label: "Reports", items: [
      { key: P.REPORTS_TAT, label: "See the TAT and problems report", help: "Problems and holds by reason, days, overdue counts.", requires: [P.LOANS_VIEW], can: "see the TAT and problems report", where: "Reports, TAT", was: "reports:tat" },
      { key: P.REPORTS_TAT_EXPORT, label: "Download the TAT report (CSV)", help: "Download the TAT and problems report as a spreadsheet file.", requires: [P.REPORTS_TAT], view: P.REPORTS_TAT, can: "download the TAT report", where: "Reports, TAT, Download CSV", was: "reports:tat + loans:export" },
      { key: P.AUDIT_VIEW, label: "See the audit log", help: "Every automatic decision and user action (the technical log).", can: "see the audit log", where: "Audit log", was: "audit:view" },
    ],
  },
  {
    key: "myloans", label: "MyLoans and sync", items: [
      { key: P.MYLOANS_VIEW, label: "See when MyLoans was last checked", help: "Show \"MyLoans · Last checked\" on a loan file.", requires: [P.LOANS_VIEW], can: "see when MyLoans was last checked", where: "Loan File, top strip", was: "loans:view" },
      { key: P.LOANS_REFRESH, label: "Refresh a loan from MyLoans", help: "The Refresh from MyLoans button on a loan file: ask MyLoans for the latest copy now.", requires: [P.MYLOANS_VIEW], view: P.MYLOANS_VIEW, can: "refresh a loan from MyLoans", where: "Loan File, Refresh from MyLoans", was: "none (shown to everyone who sees the loan file)" },
      { key: P.SOURCE_REVIEW, label: "Review MyLoans changes", help: "Decide what to do when MyLoans changes a loan: apply, keep the current setup, close as cancelled, link a replacement PN, copy reusable papers.", requires: [P.LOANS_VIEW], can: "review MyLoans changes", where: "Loan File, Open items, MyLoans changes", was: "source:review (also Admin by role name)" },
      { key: P.SOURCE_MANAGE, label: "Change MyLoans sync settings", help: "How often loans are checked against MyLoans and the business hours.", can: "change MyLoans sync settings", where: "Settings, MyLoans sync", was: "source:manage" },
      { key: P.MYLOANS_SYNC, label: "Run the MyLoans sync now", help: "The Run now button: check every open loan against MyLoans at once.", can: "run the MyLoans sync now", where: "Settings, MyLoans sync, Run now", was: "source:manage" },
    ],
  },
  {
    key: "branches", label: "Branches and access", items: [
      { key: P.BRANCHES_VIEW, label: "See branches", help: "See Settings, Branches: codes, areas, divisions and the sync history.", can: "see branches", where: "Settings, Branches", was: "settings:branches or source:manage" },
      { key: P.BRANCHES_MANAGE, label: "Change branches", help: "Edit the DMS fields of a branch, add one by hand, hide a test branch.", requires: [P.BRANCHES_VIEW], view: P.BRANCHES_VIEW, can: "change branches", where: "Settings, Branches", was: "settings:branches" },
      { key: P.BRANCHES_IMPORT, label: "Import branches from MyLoans", help: "Import the MyLoans branch file, run Branches from MyLoans and set its schedule.", requires: [P.BRANCHES_VIEW], can: "import branches from MyLoans", where: "Settings, Branches, Import from MyLoans", was: "source:manage" },
      { key: P.BRANCHES_REVIEW, label: "Decide branch changes", help: "The Branch review: accept or ignore new, renamed, closed or moved branches from MyLoans.", requires: [P.BRANCHES_VIEW], can: "decide branch changes", where: "Settings, Branches, Branch review", was: "source:manage" },
      { key: P.USERS_VIEW, label: "See users", help: "See the Users page.", can: "see users", where: "Users", was: "users:view" },
      { key: P.USERS_EDIT, label: "Add or edit users", help: "Add users, change their name, role and status.", requires: [P.USERS_VIEW], view: P.USERS_VIEW, can: "add and edit users", where: "Users, Add and Edit", was: "users:edit" },
      { key: P.ACCESS_MANAGE, label: "Change branch access", help: "Choose which branches a person works in: All, divisions, areas, branches, exceptions and the home branch.", requires: [P.USERS_EDIT], can: "change branch access", where: "Users, Edit, Branch access; Copy access", was: "users:edit" },
      { key: P.ROLES_MANAGE, label: "Manage roles", help: "Add roles and change what each one may see and do.", requires: [P.USERS_VIEW], can: "manage roles", where: "Settings, Roles", was: "roles:manage" },
    ],
  },
  {
    key: "settings", label: "Settings and Admin", items: [
      { key: P.SETTINGS_LOAN_TYPES, label: "Change loan types", help: "Display names of the MyLoans loan types.", can: "change loan types", where: "Settings, Loan types", was: "settings:loan_types" },
      { key: P.SETTINGS_TRANSACTION_TYPES, label: "Change transaction types", help: "Rename, add custom types, who does them.", can: "change transaction types", where: "Settings, Transaction types", was: "settings:transaction_types" },
      { key: P.SETTINGS_DOCUMENT_TYPES, label: "Change document types", help: "The kinds of paper checklist items use.", can: "change document types", where: "Settings, Document types", was: "settings:document_types" },
      { key: P.SETTINGS_CHECKLIST, label: "Change checklist items", help: "The papers for each transaction, required or optional.", can: "change checklist items", where: "Settings, Checklist items", was: "settings:checklist" },
      { key: P.SETTINGS_TAT, label: "Change turnaround times", help: "Target business days for each step.", can: "change turnaround times", where: "Settings, Turnaround times", was: "settings:tat" },
      { key: P.SETTINGS_HOLIDAYS, label: "Change holidays", help: "Days skipped when counting turnaround times.", can: "change holidays", where: "Settings, Holidays", was: "settings:holidays" },
      { key: P.SETTINGS_CASH_ADVANCE, label: "Change cash-advance rules", help: "Suggested and maximum amounts, carry-over and liquidation days, approval bands.", can: "change cash-advance rules", where: "Settings, Cash advance", was: "settings:cash_advance" },
      { key: P.SETTINGS_LTO, label: "Change LTO offices", help: "Offices a processor can be sent to.", can: "change LTO offices", where: "Settings, LTO offices", was: "settings:lto" },
      { key: P.SETTINGS_PROBLEM_REASONS, label: "Change problem reasons", help: "The reasons a job can be stuck.", can: "change problem reasons", where: "Settings, Problem reasons", was: "settings:problem_reasons" },
      { key: P.HOLDS_MANAGE, label: "Change hold reasons", help: "Add, rename, reorder or switch off the reasons a transaction can be on hold.", can: "change hold reasons", where: "Settings, Hold reasons", was: "holds:manage" },
      { key: P.SETTINGS_RETURN_REASONS, label: "Change return reasons", help: "Why a processor returns a job to the Loan Associate for papers.", can: "change return reasons", where: "Settings, Return reasons", was: "settings:return_reasons" },
      { key: P.FUNDS_TYPES_MANAGE, label: "Change funds types", help: "Rename Cash advance or Fund transfer, add a type, set what Finance enters at release, or switch a type off.", can: "change funds types", where: "Settings, Funds types", was: "fundtypes:manage" },
      { key: P.STAGES_MANAGE, label: "Change processing stages", help: "The stages of each transaction type, their evidence and targets.", can: "change processing stages", where: "Settings, Processing stages", was: "stages:manage" },
      { key: P.SETTINGS_SYSTEM, label: "Change system switches", help: "MyLoans test switches, the simulator switch, sample MyLoans changes.", can: "change system switches", where: "Settings, System", was: "settings:system" },
      { key: P.SETTINGS_PN_FORMAT, label: "Change the PN format", help: "The parts of a PN (prefix, branch code, year, system digit, running number) and the PN check.", can: "change the PN format", where: "Settings, System, PN format", was: "settings:system" },
      { key: P.SETTINGS_IMPORT, label: "Import data", help: "Import / Export files, for the lists this role may change.", can: "import data", where: "Settings, Import / Export", was: "settings:import" },
      { key: P.SIMULATOR_USE, label: "Use the test simulator", help: "Move sample loans through the processor and vault steps, and simulate MyLoans changes. Only in test mode.", requires: [P.LOANS_VIEW], can: "use the test simulator", where: "Loan File, Simulator (test mode)", was: "simulator:use (the MyLoans change simulator: checked in the service only)" },
      { key: P.TESTDATA_RESET, label: "Use the Test kit", help: "Back to the starting state, backups, and the data-check samples. Only in test mode, on a local test setup.", can: "use the Test kit", where: "Settings, Test kit (local only)", was: "testdata:reset" },
    ],
  },
  {
    key: "email", label: "Email", items: [
      { key: P.EMAIL_VIEW, label: "See email settings", help: "See which emails are on, their messages and the recent emails.", can: "see email settings", where: "Settings, Email", was: "email:manage" },
      { key: P.EMAIL_MANAGE, label: "Change email settings", help: "Turn emails on or off, choose events, edit messages, send a test email, resend.", requires: [P.EMAIL_VIEW], view: P.EMAIL_VIEW, can: "change email settings", where: "Settings, Email", was: "email:manage" },
    ],
  },
];

export const PERMISSION_DEFS: PermissionDef[] = PERMISSION_GROUPS.flatMap((g) => g.items);
export const permissionDef = (k: string) => PERMISSION_DEFS.find((d) => d.key === k);
export const permissionLabel = (k: string) => permissionDef(k)?.label ?? k;
/** The View key a Change key pairs with, and the Change keys of a View key. */
export const viewOf = (k: string) => permissionDef(k)?.view;
export const changesOf = (k: string) => PERMISSION_DEFS.filter((d) => d.view === k).map((d) => d.key);

/** Any one of these shows the Settings page (each area needs its own). */
export const SETTINGS_PERMISSIONS: Permission[] = [
  ...PERMISSION_GROUPS.find((g) => g.key === "settings")!.items.map((i) => i.key).filter((k) => k !== P.SIMULATOR_USE),
  P.BRANCHES_VIEW, P.EMAIL_VIEW, P.FUNDS_KINDS_VIEW, P.FUNDS_KINDS_MANAGE, P.SOURCE_MANAGE, P.MYLOANS_SYNC, P.DP_CAPACITY_MANAGE, P.ROLES_MANAGE,
];

/**
 * The loan-file work steps: the default Admin role does not hold them (Admin sees everything, but does
 * not do the LA, DP and Finance steps). Only a default: an Admin may tick them on any role.
 */
export const WORKFLOW_PERMISSIONS: Permission[] = [
  P.LOANS_OPEN, P.CHECKLIST_TICK, P.LABELS_PRINT, P.TXN_ADD, P.TXN_COMPLETE, P.DP_SEND, P.DP_RECEIVE, P.RETURNS_ACCEPT,
  P.FUNDS_FLAG, P.FUNDS_REQUEST, P.FUNDS_LIQUIDATE, P.FUNDS_EXCEPTION,
  P.FUNDS_CA_APPROVE, P.FUNDS_CA_RELEASE, P.FUNDS_CA_SETTLE, P.FUNDS_CA_EDIT_LINES, P.FUNDS_CA_CHANGE_TYPE,
  P.FUNDS_FT_APPROVE, P.FUNDS_FT_RELEASE, P.FUNDS_FT_SETTLE, P.FUNDS_FT_EDIT_LINES, P.FUNDS_FT_CHANGE_TYPE,
  P.JOBS_WORK, P.JOBS_PASUYO, P.JOBS_RETURN_TO_LA, P.PROBLEMS_RAISE, P.PROBLEMS_RESOLVE, P.HOLDS_RAISE, P.HOLDS_RESOLVE,
];
/** Not work steps, and not in the default Admin role either: who is told about LTO advisories. */
const NOT_ADMIN_DEFAULT: Permission[] = [P.LTO_REPORTS_NOTIFY];
export const ADMIN_PERMISSIONS: Permission[] = ALL_PERMISSIONS.filter((k) => !WORKFLOW_PERMISSIONS.includes(k) && !NOT_ADMIN_DEFAULT.includes(k));

/** Turning keys on adds what they require (recursively). */
export function withRequirements(keys: Iterable<string>): Set<string> {
  const out = new Set(keys);
  let changed = true;
  while (changed) {
    changed = false;
    for (const k of [...out]) for (const r of permissionDef(k)?.requires ?? []) if (!out.has(r)) { out.add(r); changed = true; }
  }
  return out;
}

/** Keys that need `key` (directly or not): turning `key` off turns these off. */
export function dependentsOf(key: string): Permission[] {
  const out = new Set<Permission>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const d of PERMISSION_DEFS) {
      if (out.has(d.key)) continue;
      if ((d.requires ?? []).some((r) => r === key || out.has(r))) { out.add(d.key); changed = true; }
    }
  }
  return [...out];
}

/** Keeps known keys only (old names become their new names), adds requirements, in catalogue order. */
export function normalizePermissions(keys: Iterable<string>): Permission[] {
  const set = withRequirements([...keys].flatMap((k) => SPLIT_PERMISSIONS[k] ?? [RENAMED_PERMISSIONS[k] ?? k]).filter((k) => permissionDef(k)));
  return ALL_PERMISSIONS.filter((k) => set.has(k));
}

const joinWords = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "In plain words": what a role can do, built from its ticks. */
export function plainWords(keys: Iterable<string>, branchAccess: "ASSIGNED" | "ALL"): string[] {
  const on = new Set(keys);
  // Where comes from each person (Users, Edit, Branch access); the role only gives the default for new users.
  const where = branchAccess === "ALL" ? "in all branches (the default for new users)" : "in the branches of their own access";
  const lines: string[] = [];
  for (const g of PERMISSION_GROUPS) {
    const yes = g.items.filter((i) => on.has(i.key)).map((i) => i.can);
    if (!yes.length) continue;
    lines.push(`Can ${joinWords(yes)}${g.key === "loans" ? ` ${where}` : ""}.`);
  }
  if (!SETTINGS_PERMISSIONS.some((k) => on.has(k))) lines.push("Cannot change Settings.");
  if (![P.USERS_VIEW, P.ROLES_MANAGE].some((k) => on.has(k))) lines.push("Cannot see or change users and roles.");
  if (!on.has(P.LOANS_VIEW)) lines.push("Cannot see loan files.");
  if (lines.length === 0) lines.push("Cannot do anything yet. Tick some permissions.");
  return lines.map(cap);
}

/** What every role that saw the loan file before the permissions pass keeps: the MyLoans strip and Refresh. */
const SOURCE_STRIP: Permission[] = [P.MYLOANS_VIEW, P.LOANS_REFRESH];

/** Every per-type funds tick, both types (Finance's default, and what a role with the old funds keys has). */
export const FUNDS_BOTH_TYPES: Permission[] = [
  P.FUNDS_CA_VIEW, P.FUNDS_CA_APPROVE, P.FUNDS_CA_RELEASE, P.FUNDS_CA_SETTLE, P.FUNDS_CA_EDIT_LINES, P.FUNDS_CA_CHANGE_TYPE, P.FUNDS_CA_PRINT,
  P.FUNDS_FT_VIEW, P.FUNDS_FT_APPROVE, P.FUNDS_FT_RELEASE, P.FUNDS_FT_SETTLE, P.FUNDS_FT_EDIT_LINES, P.FUNDS_FT_CHANGE_TYPE, P.FUNDS_FT_PRINT,
];

/** Seeded built-in roles: the defaults that "Reset to default" restores. */
export const ROLE_DEFAULTS: Record<string, { name: string; description: string; canSignIn: boolean; sortOrder: number; branchAccess: "ASSIGNED" | "ALL"; permissions: Permission[] }> = {
  LA: {
    name: "Loan Associate", canSignIn: true, sortOrder: 1, branchAccess: "ASSIGNED",
    description: "Finds and opens loan files, checks papers, prints labels, sends to processors.",
    permissions: [P.LOANS_VIEW, P.LOANS_SEARCH, P.LOANS_OPEN, P.CHECKLIST_TICK, P.LABELS_PRINT, P.TXN_ADD, P.TXN_COMPLETE, P.DP_SEND, P.RETURNS_ACCEPT, P.FUNDS_FLAG, P.FUNDS_KINDS_VIEW, P.PROBLEMS_RAISE, P.PROBLEMS_RESOLVE, P.HOLDS_RAISE, P.HOLDS_RESOLVE, ...SOURCE_STRIP],
  },
  ADMIN: {
    name: "Admin", canSignIn: true, sortOrder: 2, branchAccess: "ALL",
    description: "Users, roles, Settings, audit log, CSV export, all loans (read-only), Supervisor override, test tools.",
    permissions: ADMIN_PERMISSIONS,
  },
  DP: { name: "Document Processor / Collateral & Mortgage", canSignIn: false, sortOrder: 3, branchAccess: "ASSIGNED", description: "Phase 4 processing, mortgage cancellation.", permissions: [P.LOANS_VIEW, P.DP_RECEIVE, P.JOBS_WORK, P.JOBS_PASUYO, P.JOBS_RETURN_TO_LA, P.FUNDS_REQUEST, P.FUNDS_LIQUIDATE, P.FUNDS_KINDS_VIEW, P.PROBLEMS_RAISE, P.PROBLEMS_RESOLVE, P.HOLDS_RAISE, P.HOLDS_RESOLVE, P.LTO_REPORTS_CREATE, ...SOURCE_STRIP] },
  FIN: { name: "Finance", canSignIn: false, sortOrder: 4, branchAccess: "ALL", description: "Approves and releases cash advances; confirms liquidation; prints liquidation reports.", permissions: [P.LOANS_VIEW, ...FUNDS_BOTH_TYPES, P.FUNDS_EXCEPTION, P.FUNDS_KINDS_VIEW, P.FUNDS_KINDS_MANAGE, P.JOURNEY_VIEW_AMOUNTS, P.MYLOANS_VIEW] },
  VAULT: { name: "Vault Custodian", canSignIn: false, sortOrder: 5, branchAccess: "ASSIGNED", description: "Phases 6 and 8.", permissions: [P.LOANS_VIEW, ...SOURCE_STRIP] },
  DIG: { name: "Digital Records", canSignIn: false, sortOrder: 6, branchAccess: "ASSIGNED", description: "Phase 7 DigiCur.", permissions: [P.LOANS_VIEW, ...SOURCE_STRIP] },
  QA: { name: "QA", canSignIn: false, sortOrder: 7, branchAccess: "ASSIGNED", description: "Phase 9 QA review.", permissions: [P.LOANS_VIEW, ...SOURCE_STRIP] },
  APPR: { name: "Approvers, Records, Compliance", canSignIn: false, sortOrder: 8, branchAccess: "ASSIGNED", description: "Phase 8 and 10 approvals.", permissions: [P.LOANS_VIEW, P.JOURNEY_VIEW_AMOUNTS, P.MYLOANS_VIEW, P.FUNDS_KINDS_VIEW, P.FUNDS_KINDS_MANAGE] },
  /** Read-only, all branches: the Monitoring page and LTO advisories. No loan files, no amounts. */
  MONITOR: { name: "Operations Monitor", canSignIn: true, sortOrder: 9, branchAccess: "ALL", description: "Watches processors and LTO offices (Monitoring page) and resolves LTO advisories. Read-only.", permissions: [P.MONITOR_DP, P.MONITOR_LTO, P.LTO_REPORTS_MANAGE, P.LTO_REPORTS_NOTIFY] },
  /**
   * Branch Supervisor (also the Area Supervisor: the same role with Area access on the person). Sees the
   * loans of their branches, moves holds there, resolves any problem there, the Monitoring pages and the
   * TAT report. Never money, Settings, users, roles or branch imports. Created by migration
   * 20261119090006_decisions_batch only when no role of this name exists (the seed does the same).
   */
  SUP: { name: "Branch Supervisor", canSignIn: true, sortOrder: 10, branchAccess: "ASSIGNED", description: "Sees the loans of their branches, moves holds to another person, resolves any problem there, the Monitoring pages and the TAT report. No money, Settings, users or roles.", permissions: [P.LOANS_VIEW, P.LOANS_SEARCH, P.HOLDS_TRANSFER, P.PROBLEMS_RESOLVE_ANY, P.MONITOR_DP, P.MONITOR_LTO, P.REPORTS_TAT, ...SOURCE_STRIP] },
};
/** The plain ticks of the Branch Supervisor role and their keys (the report and the role's docs). */
export const SUPERVISOR_TICKS: { plain: string; keys: Permission[] }[] = [
  { plain: "See loans and open loan files (within their branches)", keys: [P.LOANS_VIEW, P.LOANS_SEARCH, P.MYLOANS_VIEW, P.LOANS_REFRESH] },
  { plain: "Move a hold to another person", keys: [P.HOLDS_TRANSFER] },
  { plain: "Resolve any problem (at their branches)", keys: [P.PROBLEMS_RESOLVE_ANY] },
  { plain: "See the Monitoring pages for DPs and LTO offices (their branches)", keys: [P.MONITOR_DP, P.MONITOR_LTO] },
  { plain: "See the TAT report", keys: [P.REPORTS_TAT] },
];

/** Role chips used everywhere (role key -> label and CSS token). */
export const ROLE_CHIPS: Record<string, { label: string; token: string }> = {
  LA: { label: "LA", token: "la" },
  DP: { label: "DP", token: "dp" },
  VAULT: { label: "Vault", token: "vault" },
  DIG: { label: "DIG", token: "dig" },
  QA: { label: "QA", token: "qa" },
  FIN: { label: "FIN", token: "fin" },
  APPR: { label: "APPR", token: "appr" },
  MONITOR: { label: "Monitor", token: "sys" },
  SYS: { label: "SYS", token: "sys" },
  ADMIN: { label: "Admin", token: "sys" },
  SUP: { label: "Supervisor", token: "appr" },
};

/** Which permission changes each list (Settings areas and Import list keys use the same names). */
export const LIST_PERMISSION: Record<string, Permission> = {
  branches: P.BRANCHES_MANAGE,
  lto: P.SETTINGS_LTO,
  "loan-types": P.SETTINGS_LOAN_TYPES,
  "transaction-types": P.SETTINGS_TRANSACTION_TYPES,
  "document-types": P.SETTINGS_DOCUMENT_TYPES,
  checklist: P.SETTINGS_CHECKLIST,
  tat: P.SETTINGS_TAT,
  holidays: P.SETTINGS_HOLIDAYS,
  "cash-advance": P.SETTINGS_CASH_ADVANCE,
  "approval-bands": P.SETTINGS_CASH_ADVANCE,
  "problem-reasons": P.SETTINGS_PROBLEM_REASONS,
  "hold-reasons": P.HOLDS_MANAGE,
  "funds-types": P.FUNDS_TYPES_MANAGE,
  "expense-kinds": P.FUNDS_KINDS_MANAGE,
  "return-reasons": P.SETTINGS_RETURN_REASONS,
  "processing-stages": P.STAGES_MANAGE,
  system: P.SETTINGS_SYSTEM,
  email: P.EMAIL_MANAGE,
  "myloans-sync": P.SOURCE_MANAGE,
  "test-data": P.TESTDATA_RESET,
  "test-kit": P.TESTDATA_RESET,
  "dp-capacity": P.DP_CAPACITY_MANAGE,
  roles: P.ROLES_MANAGE,
  users: P.USERS_EDIT,
};

/**
 * Which ticks show each Settings area (any one of them). Seeing an area is not changing it: the
 * buttons inside follow LIST_PERMISSION (and the server checks every change).
 */
export const AREA_PERMISSIONS: Record<string, Permission[]> = {
  ...Object.fromEntries(Object.entries(LIST_PERMISSION).map(([k, v]) => [k, [v]])),
  branches: [P.BRANCHES_VIEW],
  system: [P.SETTINGS_SYSTEM, P.SETTINGS_PN_FORMAT],
  email: [P.EMAIL_VIEW],
  "expense-kinds": [P.FUNDS_KINDS_VIEW, P.FUNDS_KINDS_MANAGE],
  "myloans-sync": [P.SOURCE_MANAGE, P.MYLOANS_SYNC],
};

/** Same, by the kind names the services use. */
export const KIND_PERMISSION: Record<string, Permission> = {
  branch: P.BRANCHES_MANAGE,
  ltoOffice: P.SETTINGS_LTO,
  loanType: P.SETTINGS_LOAN_TYPES,
  transactionType: P.SETTINGS_TRANSACTION_TYPES,
  documentType: P.SETTINGS_DOCUMENT_TYPES,
  checklistRule: P.SETTINGS_CHECKLIST,
  tat: P.SETTINGS_TAT,
  holiday: P.SETTINGS_HOLIDAYS,
  caRule: P.SETTINGS_CASH_ADVANCE,
  approvalBand: P.SETTINGS_CASH_ADVANCE,
  problemReason: P.SETTINGS_PROBLEM_REASONS,
  holdReason: P.HOLDS_MANAGE,
  fundsType: P.FUNDS_TYPES_MANAGE,
  expenseKind: P.FUNDS_KINDS_MANAGE,
  returnReason: P.SETTINGS_RETURN_REASONS,
  processingStage: P.STAGES_MANAGE,
  user: P.USERS_EDIT,
  role: P.ROLES_MANAGE,
};
