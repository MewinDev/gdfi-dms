/**
 * Permission keys and the catalog shown in Settings > Roles and access.
 * Roles (Role table) list the keys they hold. Every authorization check goes through
 * can(user, key) in lib/auth/current-user.ts, backed by the database (re-read on every request).
 * Each key below is enforced somewhere on the server; there are no decorative keys.
 * Pure data: safe to import in the browser and in the seed.
 */
export const PERMISSIONS = {
  // Loans
  LOANS_VIEW: "loans:view", // see loan files (branch scope comes from the role's Branch access)
  LOANS_SEARCH: "loans:search", // find a loan (PN search, MyLoans preview)
  LOANS_OPEN: "loans:open", // open a new loan file
  LOANS_EXPORT: "loans:export", // export loans (CSV)
  RULES_OVERRIDE: "rules:override", // change an automatic result (Supervisor override)
  // Check documents
  CHECKLIST_TICK: "checklist:tick", // tick papers, ask for missing papers, report and resolve problems
  LABELS_PRINT: "labels:print", // print QR labels
  TXN_ADD: "transactions:add", // add a custom transaction to a loan file
  TXN_COMPLETE: "transactions:complete", // EDST reference, mark a custom transaction as done
  // Processing
  DP_SEND: "processing:send", // send to a processor (and ask Finance for a cash advance)
  DP_RECEIVE: "processing:receive", // be a processor: appear in the "Who should do it" list
  RETURNS_ACCEPT: "processing:accept_returns", // be the receiving LA for returned papers; branch updates
  // Funds (cash advance)
  FUNDS_FLAG: "funds:flag", // LA: say whether a transaction needs funds (no amount)
  FUNDS_VIEW: "funds:view", // see the funds status of transactions in scope
  FUNDS_REQUEST: "funds:request", // DP: request a cash advance, top-ups, carry-overs
  FUNDS_LIQUIDATE: "funds:liquidate", // DP: receipts, returns
  FUNDS_APPROVE: "funds:approve", // approve within the approval bands
  FUNDS_RELEASE: "funds:release", // Finance: release money, confirm returns, close
  FUNDS_VIEW_ALL: "funds:view_all", // see every advance in scope (Funds page)
  FUNDS_EXCEPTION: "funds:exception", // let an overdue DP submit one more request
  // Jobs (processor side)
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
  HOLDS_RESOLVE: "holds:resolve", // resume own holds
  HOLDS_TRANSFER: "holds:transfer", // give a hold to another owner (Admin: any; others: their branches). Never resume.
  // Journey
  JOURNEY_VIEW_AMOUNTS: "journey:view_amounts", // see cash amounts in the Journey (otherwise funds status only)
  // Reports
  REPORTS_TAT: "reports:tat",
  // Settings
  SETTINGS_BRANCHES: "settings:branches",
  SETTINGS_LOAN_TYPES: "settings:loan_types",
  SETTINGS_TRANSACTION_TYPES: "settings:transaction_types",
  SETTINGS_DOCUMENT_TYPES: "settings:document_types",
  SETTINGS_CHECKLIST: "settings:checklist",
  SETTINGS_TAT: "settings:tat",
  SETTINGS_HOLIDAYS: "settings:holidays",
  SETTINGS_CASH_ADVANCE: "settings:cash_advance",
  SETTINGS_LTO: "settings:lto",
  SETTINGS_SYSTEM: "settings:system", // MyLoans test switches, simulator switch, mock source changes
  SETTINGS_PROBLEM_REASONS: "settings:problem_reasons",
  HOLDS_MANAGE: "holds:manage", // Settings > Hold reasons (Admin only by default; was settings:hold_reasons)
  SETTINGS_RETURN_REASONS: "settings:return_reasons",
  STAGES_MANAGE: "stages:manage", // Settings > Processing stages (Admin only by default)
  SETTINGS_IMPORT: "settings:import", // Import / Export (with the permission for that list)
  EMAIL_MANAGE: "email:manage", // email notifications: on/off, events, messages, test send, recent emails
  // MyLoans sync
  SOURCE_REVIEW: "source:review", // decide MyLoans changes: Apply, Keep current, Close as cancelled, replacement PNs
  SOURCE_MANAGE: "source:manage", // MyLoans sync settings and Run now
  // People and access
  USERS_VIEW: "users:view",
  USERS_EDIT: "users:edit",
  ROLES_MANAGE: "roles:manage",
  // Reports and audit
  AUDIT_VIEW: "audit:view",
  // Test tools
  SIMULATOR_USE: "simulator:use",
  TESTDATA_RESET: "testdata:reset",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
export const ALL_PERMISSIONS = Object.values(PERMISSIONS) as Permission[];

export interface PermissionDef {
  key: Permission;
  label: string;
  help: string;
  /** Turning this on also turns these on (and turning one of them off turns this off). */
  requires?: Permission[];
  /** Words for the "In plain words" summary. */
  can: string;
}
export interface PermissionGroup {
  key: string;
  label: string;
  /** Admin's lock does not cover this group: these steps belong to the roles that do them. */
  workflow?: boolean;
  items: PermissionDef[];
}

const P = PERMISSIONS;

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    key: "loans", label: "Loans", items: [
      { key: P.LOANS_VIEW, label: "See loan files", help: "Open and read loan files, Home and Updates. Which branches depends on Branch access.", can: "see loan files" },
      { key: P.LOANS_SEARCH, label: "Find a loan", help: "Search MyLoans by PN, CIN or CIF and see the preview.", requires: [P.LOANS_VIEW], can: "find loans" },
      { key: P.LOANS_OPEN, label: "Open a loan file", help: "Start a new loan file from a MyLoans loan.", requires: [P.LOANS_SEARCH], can: "open new loan files" },
      { key: P.LOANS_EXPORT, label: "Export loans (CSV)", help: "Download the loan list as a spreadsheet file.", requires: [P.LOANS_VIEW], can: "export the loan list" },
      { key: P.RULES_OVERRIDE, label: "Change an automatic result", help: "Supervisor override of the classification and transactions, with a reason.", requires: [P.LOANS_VIEW], can: "override automatic results" },
    ],
  },
  {
    key: "documents", label: "Check documents", workflow: true, items: [
      { key: P.CHECKLIST_TICK, label: "Tick papers", help: "Tick the papers in hand, ask for missing papers, report and resolve problems.", requires: [P.LOANS_VIEW], can: "tick papers" },
      { key: P.LABELS_PRINT, label: "Print labels", help: "Print the QR labels for ticked papers.", requires: [P.CHECKLIST_TICK], can: "print labels" },
      { key: P.TXN_ADD, label: "Add a transaction", help: "Add a custom transaction type to a loan file.", requires: [P.CHECKLIST_TICK], can: "add transactions" },
      { key: P.TXN_COMPLETE, label: "Mark as done", help: "Record the EDST reference, and mark custom transactions done.", requires: [P.CHECKLIST_TICK], can: "mark transactions done" },
    ],
  },
  {
    key: "processing", label: "Processing", workflow: true, items: [
      { key: P.DP_SEND, label: "Send to a processor", help: "Pick a Document Processor and send the papers. Also asks Finance for a cash advance.", requires: [P.CHECKLIST_TICK], can: "send to a processor" },
      { key: P.DP_RECEIVE, label: "Receive and process transactions", help: "The processor side: people with this appear in the \"Who should do it\" list for their branches.", requires: [P.LOANS_VIEW], can: "receive transactions as a processor" },
      { key: P.RETURNS_ACCEPT, label: "Accept returned papers", help: "Be the Loan Associate who receives papers back from a processor, and get branch updates.", requires: [P.LOANS_VIEW], can: "accept returned papers" },
    ],
  },
  {
    key: "funds", label: "Funds", items: [
      { key: P.FUNDS_FLAG, label: "Flag funds", help: "Say whether a transaction needs funds when sending it. No amount.", requires: [P.CHECKLIST_TICK], can: "flag funds" },
      { key: P.FUNDS_VIEW, label: "See funds status", help: "See whether transactions need funds, are funded or settled.", requires: [P.LOANS_VIEW], can: "see funds status" },
      { key: P.FUNDS_REQUEST, label: "Request a cash advance", help: "Ask for one advance covering several jobs, top-ups and carry-overs.", requires: [P.JOBS_WORK], can: "request cash advances" },
      { key: P.FUNDS_LIQUIDATE, label: "Liquidate", help: "Record receipts and return cash.", requires: [P.FUNDS_REQUEST], can: "liquidate cash advances" },
      { key: P.FUNDS_APPROVE, label: "Approve cash advances", help: "Approve or deny requests within the approval bands.", requires: [P.FUNDS_VIEW_ALL], can: "approve cash advances" },
      { key: P.FUNDS_RELEASE, label: "Release funds", help: "Release money, confirm returned cash, close advances.", requires: [P.FUNDS_VIEW_ALL], can: "release funds" },
      { key: P.FUNDS_VIEW_ALL, label: "See all advances", help: "The Funds page: every advance in the role's branches.", requires: [P.LOANS_VIEW], can: "see all advances" },
      { key: P.FUNDS_EXCEPTION, label: "Grant a funds exception", help: "Let a processor with an overdue advance submit one more request.", requires: [P.FUNDS_VIEW_ALL], can: "grant funds exceptions" },
      { key: P.JOURNEY_VIEW_AMOUNTS, label: "See cash amounts in the Journey", help: "Show peso amounts of cash advances in a loan's Journey. Without it, the Journey shows the funds status only (for example Funded).", requires: [P.LOANS_VIEW], can: "see cash amounts in the Journey" },
    ],
  },
  {
    key: "jobs", label: "Jobs", items: [
      { key: P.JOBS_WORK, label: "Work on jobs", help: "Accept, decline, return, log attempts, complete and forward assigned jobs.", requires: [P.DP_RECEIVE], can: "work on processor jobs" },
      { key: P.JOBS_PASUYO, label: "Pass a job to a second processor", help: "Pasuyo: hand an accepted job to another processor, with a reason.", requires: [P.JOBS_WORK], can: "pass jobs to a second processor" },
      { key: P.JOBS_RETURN_TO_LA, label: "Return a job to the LA for missing papers", help: "After accepting: send the job back to the Loan Associate when a paper is missing or wrong. The clock keeps counting.", requires: [P.JOBS_WORK], can: "return jobs to the LA for missing papers" },
    ],
  },
  {
    key: "problems", label: "Problems", items: [
      { key: P.PROBLEMS_RAISE, label: "Raise a problem", help: "Open a problem on a transaction the person works on.", requires: [P.LOANS_VIEW], can: "raise problems" },
      { key: P.PROBLEMS_RESOLVE, label: "Resolve own problems", help: "Resolve problems on transactions the person works on.", requires: [P.PROBLEMS_RAISE], can: "resolve their problems" },
      { key: P.PROBLEMS_RESOLVE_ANY, label: "Resolve any problem", help: "Resolve a problem on any transaction in scope.", requires: [P.LOANS_VIEW], can: "resolve any problem" },
      { key: P.PROBLEMS_OUTSIDE, label: "Mark outside our control", help: "Tag a problem for reports. It does not stop the clock.", requires: [P.LOANS_VIEW], can: "mark problems outside our control" },
    ],
  },
  {
    key: "holds", label: "Holds", items: [
      { key: P.HOLDS_RAISE, label: "Put work on hold", help: "Put a transaction on hold while it waits on something that is not a fault (the borrower, another team, an LTO appointment). Only on work the person does. The clock keeps counting.", requires: [P.LOANS_VIEW], can: "put their work on hold" },
      { key: P.HOLDS_RESOLVE, label: "Resume own holds", help: "Resume a hold on work the person does.", requires: [P.HOLDS_RAISE], can: "resume their holds" },
      { key: P.HOLDS_TRANSFER, label: "Transfer a hold", help: "Give a hold to another person of the same work role (for example when the hold owner is on leave). Admin: any hold; others: holds in their branches. It never resumes the hold: only the new owner can.", requires: [P.LOANS_VIEW], can: "transfer holds" },
    ],
  },
  {
    key: "reports", label: "Reports", items: [
      { key: P.REPORTS_TAT, label: "TAT and problems report", help: "Problems and holds by reason, days, overdue counts.", requires: [P.LOANS_VIEW], can: "see the TAT and problems report" },
    ],
  },
  {
    key: "settings", label: "Settings", items: [
      { key: P.SETTINGS_BRANCHES, label: "Change branches", help: "Add, rename or make branches inactive.", can: "change branches" },
      { key: P.SETTINGS_LOAN_TYPES, label: "Change loan types", help: "Display names of the MyLoans loan types.", can: "change loan types" },
      { key: P.SETTINGS_TRANSACTION_TYPES, label: "Change transaction types", help: "Rename, add custom types, who does them.", can: "change transaction types" },
      { key: P.SETTINGS_DOCUMENT_TYPES, label: "Change document types", help: "The kinds of paper checklist items use.", can: "change document types" },
      { key: P.SETTINGS_CHECKLIST, label: "Change checklist items", help: "The papers for each transaction, required or optional.", can: "change checklist items" },
      { key: P.SETTINGS_TAT, label: "Change turnaround times", help: "Target business days for each step.", can: "change turnaround times" },
      { key: P.SETTINGS_HOLIDAYS, label: "Change holidays", help: "Days skipped when counting turnaround times.", can: "change holidays" },
      { key: P.SETTINGS_CASH_ADVANCE, label: "Change cash-advance rules", help: "Suggested and maximum amounts, carry-over and liquidation days, approval bands.", can: "change cash-advance rules" },
      { key: P.SETTINGS_LTO, label: "Change LTO offices", help: "Offices a processor can be sent to.", can: "change LTO offices" },
      { key: P.SETTINGS_PROBLEM_REASONS, label: "Change problem reasons", help: "The reasons a job can be stuck.", can: "change problem reasons" },
      { key: P.HOLDS_MANAGE, label: "Manage hold reasons", help: "Settings, Hold reasons: add, rename, reorder or switch off the reasons a transaction can be on hold. A switched-off reason stays on old holds.", can: "manage hold reasons" },
      { key: P.SETTINGS_RETURN_REASONS, label: "Change return reasons", help: "Why a processor returns a job to the Loan Associate for papers.", can: "change return reasons" },
      { key: P.STAGES_MANAGE, label: "Change processing stages", help: "The stages of each transaction type, their evidence and targets.", can: "change processing stages" },
      { key: P.SETTINGS_SYSTEM, label: "Change system switches", help: "MyLoans test switches, the simulator switch, mock source changes.", can: "change system switches" },
      { key: P.EMAIL_MANAGE, label: "Manage email notifications", help: "Turn emails on or off, choose events, edit messages, send a test email and see recent emails.", can: "manage email notifications" },
      { key: P.SETTINGS_IMPORT, label: "Import data", help: "Import / Export files, for the lists this role may change.", can: "import data" },
    ],
  },
  {
    key: "people", label: "People and access", items: [
      { key: P.USERS_VIEW, label: "See users", help: "See the Users page.", can: "see users" },
      { key: P.USERS_EDIT, label: "Add or edit users", help: "Add users, change their role, branches and status.", requires: [P.USERS_VIEW], can: "add and edit users" },
      { key: P.ROLES_MANAGE, label: "Manage roles and access", help: "Add and change roles and what each one may do.", requires: [P.USERS_VIEW], can: "manage roles and access" },
    ],
  },
  {
    key: "sync", label: "MyLoans sync", items: [
      { key: P.SOURCE_REVIEW, label: "Review MyLoans changes", help: "Decide what to do when MyLoans changes a loan: apply the change, keep the current setup, close it as cancelled, link a replacement PN and copy reusable papers.", requires: [P.LOANS_VIEW], can: "review MyLoans changes" },
      { key: P.SOURCE_MANAGE, label: "Change MyLoans sync settings", help: "How often loans are checked against MyLoans, business hours, and Run now.", can: "change MyLoans sync settings" },
    ],
  },
  {
    key: "audit", label: "Reports and audit", items: [
      { key: P.AUDIT_VIEW, label: "See the audit log", help: "Every automatic decision and user action (the technical log).", can: "see the audit log" },
    ],
  },
  {
    key: "test", label: "Test tools", items: [
      { key: P.SIMULATOR_USE, label: "Use the test simulator", help: "Move sample loans through the processor and vault steps. Only in test mode.", requires: [P.LOANS_VIEW], can: "use the test simulator" },
      { key: P.TESTDATA_RESET, label: "Reset test data", help: "Use the Test kit (back to the starting state, backups) and show data-check samples. Only in test mode, on a local test setup.", can: "reset test data" },
    ],
  },
];

export const PERMISSION_DEFS: PermissionDef[] = PERMISSION_GROUPS.flatMap((g) => g.items);
export const permissionDef = (k: string) => PERMISSION_DEFS.find((d) => d.key === k);
export const permissionLabel = (k: string) => permissionDef(k)?.label ?? k;

/** Settings permissions (any one of them shows the Settings page). */
export const SETTINGS_PERMISSIONS: Permission[] = PERMISSION_GROUPS.find((g) => g.key === "settings")!.items.map((i) => i.key);

/**
 * Admin is built-in and locked: it always has every permission except the loan-file workflow steps
 * (Check documents, Processing, Open a loan file). Those belong to the roles that do them, as before.
 */
export const ADMIN_ROLE_KEY = "ADMIN";
export const WORKFLOW_PERMISSIONS: Permission[] = [
  P.LOANS_OPEN,
  ...PERMISSION_GROUPS.filter((g) => g.workflow).flatMap((g) => g.items.map((i) => i.key)),
  // LA, DP and Finance work steps (Admin sees everything, but does not do them).
  P.FUNDS_FLAG, P.FUNDS_VIEW, P.FUNDS_REQUEST, P.FUNDS_LIQUIDATE, P.FUNDS_APPROVE, P.FUNDS_RELEASE, P.FUNDS_EXCEPTION,
  P.JOBS_WORK, P.JOBS_PASUYO, P.JOBS_RETURN_TO_LA, P.PROBLEMS_RAISE, P.PROBLEMS_RESOLVE, P.HOLDS_RAISE, P.HOLDS_RESOLVE,
];
export const ADMIN_PERMISSIONS: Permission[] = ALL_PERMISSIONS.filter((k) => !WORKFLOW_PERMISSIONS.includes(k));

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

/** Keeps known keys only, adds requirements, in catalog order. */
export function normalizePermissions(keys: Iterable<string>): Permission[] {
  const set = withRequirements([...keys].filter((k) => permissionDef(k)));
  return ALL_PERMISSIONS.filter((k) => set.has(k));
}

const joinWords = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "In plain words": what a role can do, built from its switches. */
export function plainWords(keys: Iterable<string>, branchAccess: "ASSIGNED" | "ALL"): string[] {
  const on = new Set(keys);
  const where = branchAccess === "ALL" ? "in all branches" : "in assigned branches";
  const lines: string[] = [];
  for (const g of PERMISSION_GROUPS) {
    const yes = g.items.filter((i) => on.has(i.key)).map((i) => i.can);
    if (!yes.length) continue;
    lines.push(`Can ${joinWords(yes)}${g.key === "loans" ? ` ${where}` : ""}.`);
  }
  const none = PERMISSION_GROUPS.filter((g) => !g.items.some((i) => on.has(i.key))).map((g) => g.label.toLowerCase());
  if (none.includes("settings")) lines.push("Cannot change Settings.");
  if (none.includes("people and access")) lines.push("Cannot see or change users and roles.");
  if (!on.has(P.LOANS_VIEW)) lines.push("Cannot see loan files.");
  if (lines.length === 0) lines.push("Cannot do anything yet. Turn on some switches.");
  return lines.map(cap);
}

/** Seeded built-in roles: the defaults that "Reset to default" restores. */
export const ROLE_DEFAULTS: Record<string, { name: string; description: string; canSignIn: boolean; sortOrder: number; branchAccess: "ASSIGNED" | "ALL"; permissions: Permission[] }> = {
  LA: {
    name: "Loan Associate", canSignIn: true, sortOrder: 1, branchAccess: "ASSIGNED",
    description: "Finds and opens loan files, checks papers, prints labels, sends to processors.",
    permissions: [P.LOANS_VIEW, P.LOANS_SEARCH, P.LOANS_OPEN, P.CHECKLIST_TICK, P.LABELS_PRINT, P.TXN_ADD, P.TXN_COMPLETE, P.DP_SEND, P.RETURNS_ACCEPT, P.FUNDS_FLAG, P.FUNDS_VIEW, P.PROBLEMS_RAISE, P.PROBLEMS_RESOLVE, P.HOLDS_RAISE, P.HOLDS_RESOLVE],
  },
  ADMIN: {
    name: "Admin", canSignIn: true, sortOrder: 2, branchAccess: "ALL",
    description: "Users, roles, Settings, audit log, CSV export, all loans (read-only), Supervisor override, test tools.",
    permissions: ADMIN_PERMISSIONS,
  },
  DP: { name: "Document Processor / Collateral & Mortgage", canSignIn: false, sortOrder: 3, branchAccess: "ASSIGNED", description: "Phase 4 processing, mortgage cancellation.", permissions: [P.LOANS_VIEW, P.DP_RECEIVE, P.JOBS_WORK, P.JOBS_PASUYO, P.JOBS_RETURN_TO_LA, P.FUNDS_REQUEST, P.FUNDS_LIQUIDATE, P.PROBLEMS_RAISE, P.PROBLEMS_RESOLVE, P.HOLDS_RAISE, P.HOLDS_RESOLVE] },
  FIN: { name: "Finance", canSignIn: false, sortOrder: 4, branchAccess: "ALL", description: "Approves and releases cash advances; confirms liquidation; may transfer holds.", permissions: [P.LOANS_VIEW, P.FUNDS_APPROVE, P.FUNDS_RELEASE, P.FUNDS_VIEW_ALL, P.FUNDS_EXCEPTION, P.JOURNEY_VIEW_AMOUNTS, P.HOLDS_TRANSFER] },
  VAULT: { name: "Vault Custodian", canSignIn: false, sortOrder: 5, branchAccess: "ASSIGNED", description: "Phases 6 and 8.", permissions: [P.LOANS_VIEW] },
  DIG: { name: "Digital Records", canSignIn: false, sortOrder: 6, branchAccess: "ASSIGNED", description: "Phase 7 DigiCur.", permissions: [P.LOANS_VIEW] },
  QA: { name: "QA", canSignIn: false, sortOrder: 7, branchAccess: "ASSIGNED", description: "Phase 9 QA review.", permissions: [P.LOANS_VIEW] },
  APPR: { name: "Approvers, Records, Compliance", canSignIn: false, sortOrder: 8, branchAccess: "ASSIGNED", description: "Phase 8 and 10 approvals.", permissions: [P.LOANS_VIEW, P.JOURNEY_VIEW_AMOUNTS] },
};

/** Role chips used everywhere (role key -> label and CSS token). */
export const ROLE_CHIPS: Record<string, { label: string; token: string }> = {
  LA: { label: "LA", token: "la" },
  DP: { label: "DP", token: "dp" },
  VAULT: { label: "Vault", token: "vault" },
  DIG: { label: "DIG", token: "dig" },
  QA: { label: "QA", token: "qa" },
  FIN: { label: "FIN", token: "fin" },
  APPR: { label: "APPR", token: "appr" },
  SYS: { label: "SYS", token: "sys" },
  ADMIN: { label: "Admin", token: "sys" },
  SUP: { label: "Supervisor", token: "appr" },
};

/** Which permission changes each list (Settings areas and Import list keys use the same names). */
export const LIST_PERMISSION: Record<string, Permission> = {
  branches: P.SETTINGS_BRANCHES,
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
  "return-reasons": P.SETTINGS_RETURN_REASONS,
  "processing-stages": P.STAGES_MANAGE,
  system: P.SETTINGS_SYSTEM,
  email: P.EMAIL_MANAGE,
  "myloans-sync": P.SOURCE_MANAGE,
  "test-data": P.TESTDATA_RESET,
  "test-kit": P.TESTDATA_RESET,
  roles: P.ROLES_MANAGE,
  users: P.USERS_EDIT,
};

/** Same, by the kind names the services use. */
export const KIND_PERMISSION: Record<string, Permission> = {
  branch: P.SETTINGS_BRANCHES,
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
  returnReason: P.SETTINGS_RETURN_REASONS,
  processingStage: P.STAGES_MANAGE,
  user: P.USERS_EDIT,
  role: P.ROLES_MANAGE,
};
