/**
 * The one source for Import / Export columns. The template, the "How to import" table, the
 * importer's checks and the tests all read these definitions, so they cannot drift apart.
 * Pure data (safe in the browser too).
 */

export type ImportListKey =
  | "branches" | "lto" | "loan-types" | "transaction-types" | "document-types"
  | "checklist" | "tat" | "holidays" | "cash-advance" | "users" | "problem-reasons" | "hold-reasons" | "return-reasons" | "processing-stages" | "funds-types";

export interface ImportColumn {
  /** Column name in the file (first row). */
  name: string;
  /** Plain label used in problem messages: "Row 7, Branch code: ...". */
  label: string;
  /** What to type. */
  what: string;
  /** "yes" always; "new" only for new rows; "no" optional. */
  required: "yes" | "new" | "no";
  /** Allowed values in plain words. */
  allowed: string;
  example: string;
  /** Free-text column: checked for formula-looking text (CSV injection). */
  text?: boolean;
}

export interface ImportListDef {
  key: ImportListKey;
  title: string;
  /** gdfi-dms-template-{slug}.csv / gdfi-dms-{slug}.csv */
  slug: string;
  /** Columns that together identify a row (matching: new keys are added, existing keys updated). */
  keyColumns: string[];
  /** Plain explanation of the key, shown in the tutorial. */
  keyHelp: string;
  columns: ImportColumn[];
  /** 2 or 3 example rows, each marked "EXAMPLE, delete this row" in the notes column. */
  examples: Record<string, string>[];
}

export const EXAMPLE_NOTE = "EXAMPLE, delete this row";
export const MAX_ROWS = 1000;
export const MAX_BYTES = 2 * 1024 * 1024;

const status: ImportColumn = {
  name: "status", label: "Status", what: "Active or Inactive. Blank keeps it as it is (new rows start Active).",
  required: "no", allowed: "Active, Inactive", example: "Active",
};
const notes: ImportColumn = {
  name: "notes", label: "Notes", what: "Anything you like. Not saved. Rows marked EXAMPLE are refused.",
  required: "no", allowed: "Any text", example: "", text: true,
};

export const IMPORT_LISTS: Record<ImportListKey, ImportListDef> = {
  branches: {
    key: "branches", title: "Branches", slug: "branches", keyColumns: ["code"],
    keyHelp: "Rows are matched by the branch code. A new code adds a branch made in the DMS; an existing code updates it. For a branch from MyLoans only the usual LTO office can change here: its code, name, division, area, address and status come from MyLoans (use Import from MyLoans).",
    columns: [
      { name: "code", label: "Branch code", what: "The 3-digit MyLoans branch code.", required: "yes", allowed: "3 digits, 100 to 999", example: "101", text: true },
      { name: "name", label: "Branch name", what: "Branch name as MyLoans spells it.", required: "yes", allowed: "Text, unique", example: "Antipolo", text: true },
      { name: "division", label: "Division", what: "The MyLoans division (business line).", required: "no", allowed: "A division name from Settings, Branches, or blank", example: "Branch Division", text: true },
      { name: "area", label: "Area", what: "The MyLoans area.", required: "no", allowed: "An area name from Settings, Branches, or blank", example: "LUZON 1 (NGMA + RIZAL)", text: true },
      { name: "address", label: "Address", what: "The branch address.", required: "no", allowed: "Text, or blank", example: "Unit 6 FLJ Building, Antipolo City", text: true },
      { name: "usual_lto_office", label: "Usual LTO office", what: "Pre-selected when sending a transaction that needs LTO processing.", required: "no", allowed: "An LTO office code, or blank for none", example: "LTO-QC", text: true },
      status, notes,
    ],
    examples: [
      { code: "101", name: "Antipolo", division: "Branch Division", area: "LUZON 1 (NGMA + RIZAL)", address: "Unit 6 FLJ Building, Antipolo City", usual_lto_office: "LTO-QC", status: "Active", notes: EXAMPLE_NOTE },
      { code: "189", name: "Angono - Car Financing", division: "Car Financing Division", area: "Luzon 1 - CFD", address: "", usual_lto_office: "", status: "Active", notes: EXAMPLE_NOTE },
    ],
  },
  lto: {
    key: "lto", title: "LTO offices", slug: "lto-offices", keyColumns: ["code"],
    keyHelp: "Rows are matched by code. A new code adds an office; an existing code updates it.",
    columns: [
      { name: "code", label: "LTO code", what: "Short code of the office.", required: "yes", allowed: "2 to 20 capital letters, numbers or -", example: "LTO-ILO", text: true },
      { name: "name", label: "Office name", what: "Name of the LTO office.", required: "yes", allowed: "Text", example: "LTO Iloilo District Office", text: true },
      { name: "city", label: "Area or city", what: "Area or city of the office.", required: "no", allowed: "Text", example: "Iloilo City", text: true },
      { name: "distance_km", label: "Usual distance (km)", what: "Usual distance from the branch. Only to help the approver.", required: "no", allowed: "Number, or blank", example: "25" },
      { name: "travel_hours", label: "Usual travel time (hours)", what: "One way. Only to help the approver.", required: "no", allowed: "Number, or blank", example: "1" },
      { name: "suggested_transport", label: "Suggested transport (PHP)", what: "Pre-fills the Transport amount of a cash advance.", required: "no", allowed: "Number, or blank", example: "600" },
      status, notes,
    ],
    examples: [
      { code: "LTO-ILO", name: "LTO Iloilo District Office", city: "Iloilo City", distance_km: "25", travel_hours: "1", suggested_transport: "600", status: "Active", notes: EXAMPLE_NOTE },
      { code: "LTO-BAG", name: "LTO Baguio District Office", city: "Baguio", distance_km: "", travel_hours: "", suggested_transport: "", status: "Active", notes: EXAMPLE_NOTE },
    ],
  },
  "loan-types": {
    key: "loan-types", title: "Loan types", slug: "loan-types", keyColumns: ["code"],
    keyHelp: "Rows are matched by the MyLoans value. Loan types cannot be added: they must match MyLoans (New, Renewal).",
    columns: [
      { name: "code", label: "MyLoans value", what: "The loan type exactly as MyLoans has it.", required: "yes", allowed: "New, Renewal", example: "New", text: true },
      { name: "name", label: "Display name", what: "The name shown in this app.", required: "yes", allowed: "Text", example: "New loan", text: true },
      { name: "description", label: "Description", what: "A short explanation.", required: "no", allowed: "Text", example: "", text: true },
      status, notes,
    ],
    examples: [
      { code: "New", name: "New loan", description: "First loan of the borrower", status: "Active", notes: EXAMPLE_NOTE },
      { code: "Renewal", name: "Renewal", description: "", status: "Active", notes: EXAMPLE_NOTE },
    ],
  },
  "transaction-types": {
    key: "transaction-types", title: "Transaction types", slug: "transaction-types", keyColumns: ["code"],
    keyHelp: "Rows are matched by short code. A new code adds a type; an existing code updates it. The four built-in types are always active.",
    columns: [
      { name: "code", label: "Short code", what: "Short code. Cannot change once used.", required: "yes", allowed: "2 to 12 capital letters", example: "SPA", text: true },
      { name: "name", label: "Name", what: "Plain name of the transaction.", required: "yes", allowed: "Text", example: "Special Power of Attorney", text: true },
      { name: "done_by", label: "Done by", what: "Who does it.", required: "yes", allowed: "LA, DP", example: "DP" },
      { name: "needs_processor", label: "Needs a processor", what: "Whether it is sent to a Document Processor.", required: "yes", allowed: "Yes, No", example: "Yes" },
      { name: "needs_lto", label: "Needs LTO processing", what: "The processor takes it to an LTO office; the LA picks the office when sending. Only with a processor.", required: "no", allowed: "Yes, No (blank keeps it as it is)", example: "No" },
      { name: "order", label: "Order", what: "Position in lists (smaller first).", required: "yes", allowed: "Whole number 0 to 99", example: "5" },
      status, notes,
    ],
    examples: [
      { code: "SPA", name: "Special Power of Attorney", done_by: "DP", needs_processor: "Yes", needs_lto: "No", order: "5", status: "Active", notes: EXAMPLE_NOTE },
      { code: "COLL", name: "Collection letter", done_by: "LA", needs_processor: "No", needs_lto: "No", order: "6", status: "Active", notes: EXAMPLE_NOTE },
    ],
  },
  "document-types": {
    key: "document-types", title: "Document types", slug: "document-types", keyColumns: ["code"],
    keyHelp: "Rows are matched by short code. A new code adds a document type; an existing code updates it.",
    columns: [
      { name: "code", label: "Short code", what: "Short code. Cannot change once used.", required: "yes", allowed: "2 to 12 capital letters or numbers", example: "TCT", text: true },
      { name: "name", label: "Name", what: "Name of the paper.", required: "yes", allowed: "Text", example: "Transfer Certificate of Title", text: true },
      { name: "original_or_copy", label: "Original or copy", what: "The usual form of this paper for new checklist items.", required: "yes", allowed: "Original, Copy, Either", example: "Original" },
      status,
      { name: "notes", label: "Notes", what: "Saved with the document type. Rows marked EXAMPLE are refused.", required: "no", allowed: "Any text", example: "", text: true },
    ],
    examples: [
      { code: "TCT", name: "Transfer Certificate of Title", original_or_copy: "Original", status: "Active", notes: EXAMPLE_NOTE },
      { code: "BRGY", name: "Barangay clearance", original_or_copy: "Copy", status: "Active", notes: EXAMPLE_NOTE },
    ],
  },
  checklist: {
    key: "checklist", title: "Checklist items", slug: "checklist-items", keyColumns: ["transaction_code", "document_code", "paper"],
    keyHelp: "Rows are matched by transaction code, document code and paper name together. Changes apply to loan files opened from now on.",
    columns: [
      { name: "transaction_code", label: "Transaction code", what: "Short code of the transaction type.", required: "yes", allowed: "A code from Transaction types", example: "NOTARY", text: true },
      { name: "document_code", label: "Document code", what: "Short code of the document type.", required: "yes", allowed: "A code from Document types", example: "PN", text: true },
      { name: "paper", label: "Paper", what: "Name shown on the checklist. Blank uses the document type name.", required: "no", allowed: "Text", example: "Promissory Note", text: true },
      { name: "original_or_copy", label: "Original or copy", what: "Whether the original or a copy is needed.", required: "yes", allowed: "Original, Copy", example: "Original" },
      { name: "required", label: "Required", what: "Must be ticked before sending to a processor.", required: "yes", allowed: "Yes, No", example: "Yes" },
      { name: "reusable", label: "Belongs to the borrower", what: "Can be reused on a replacement PN (valid IDs, SPA). Blank keeps the current value (No for new rows).", required: "no", allowed: "Yes, No", example: "No" },
      { name: "pick_one_group", label: "Pick-one group", what: "Papers with the same group: at least one must be ticked. Blank for a single paper.", required: "no", allowed: "Text", example: "", text: true },
      { name: "order", label: "Order", what: "Position on the checklist (smaller first).", required: "yes", allowed: "Whole number 0 to 99", example: "1" },
      status, notes,
    ],
    examples: [
      { transaction_code: "NOTARY", document_code: "SPA", paper: "Special Power of Attorney", original_or_copy: "Original", required: "No", reusable: "Yes", pick_one_group: "", order: "9", status: "Active", notes: EXAMPLE_NOTE },
      { transaction_code: "MORTGAGE", document_code: "INS", paper: "Insurance policy", original_or_copy: "Copy", required: "Yes", reusable: "No", pick_one_group: "", order: "4", status: "Active", notes: EXAMPLE_NOTE },
    ],
  },
  tat: {
    key: "tat", title: "Turnaround times", slug: "turnaround-times", keyColumns: ["key"],
    keyHelp: "Rows are matched by step key. Steps are fixed: you can change the days and note, not add steps. Turnaround times have no status.",
    columns: [
      { name: "key", label: "Step key", what: "The step key, as in Download current data.", required: "yes", allowed: "An existing step key", example: "P3_CHECKLIST", text: true },
      { name: "step", label: "Step", what: "For reading only. Not saved.", required: "no", allowed: "Any text", example: "3.6 Checklist", text: true },
      { name: "business_days", label: "Business days", what: "Target in business days (0 means the same day).", required: "yes", allowed: "Whole number 0 to 365", example: "2" },
      { name: "display_note", label: "Display note", what: "Shown instead of the number when set.", required: "no", allowed: "Text", example: "", text: true },
      notes,
    ],
    examples: [
      { key: "P3_CHECKLIST", step: "Checklist", business_days: "2", display_note: "", notes: EXAMPLE_NOTE },
      { key: "P5_ACCEPT", step: "Branch acceptance", business_days: "2", display_note: "", notes: EXAMPLE_NOTE },
    ],
  },
  holidays: {
    key: "holidays", title: "Holidays", slug: "holidays", keyColumns: ["date"],
    keyHelp: "Rows are matched by date. A new date adds a holiday; an existing date updates its name. Inactive holidays are no longer skipped.",
    columns: [
      { name: "date", label: "Date", what: "The day off.", required: "yes", allowed: "YYYY-MM-DD", example: "2027-04-09" },
      { name: "name", label: "Holiday name", what: "Name of the holiday.", required: "yes", allowed: "Text", example: "Araw ng Kagitingan", text: true },
      status, notes,
    ],
    examples: [
      { date: "2027-04-09", name: "Araw ng Kagitingan", status: "Active", notes: EXAMPLE_NOTE },
      { date: "2027-06-12", name: "Independence Day", status: "Active", notes: EXAMPLE_NOTE },
    ],
  },
  "cash-advance": {
    key: "cash-advance", title: "Cash-advance rules", slug: "cash-advance-rules", keyColumns: ["transaction_code", "purpose"],
    keyHelp: "Rows are matched by transaction code and purpose together.",
    columns: [
      { name: "transaction_code", label: "Transaction code", what: "Short code of the transaction type.", required: "yes", allowed: "A code from Transaction types", example: "MORTGAGE", text: true },
      { name: "kind", label: "Expense kind", what: "What the money is for.", required: "yes", allowed: "NOTARY_FEE, PPSR_FEE, LTO_FEE, TRANSPORT, OTHER", example: "LTO_FEE" },
      { name: "purpose", label: "Purpose", what: "A short description.", required: "yes", allowed: "Text", example: "LTO fees", text: true },
      { name: "suggested_amount", label: "Suggested amount", what: "Suggested amount in pesos. Leave blank when not set.", required: "no", allowed: "Number above 0, or blank", example: "1500" },
      { name: "max_amount", label: "Maximum per transaction", what: "Highest amount in pesos without a typed reason.", required: "yes", allowed: "Number above 0, not below the suggested amount", example: "3000" },
      status, notes,
    ],
    examples: [
      { transaction_code: "MORTGAGE", kind: "LTO_FEE", purpose: "LTO fees", suggested_amount: "1500", max_amount: "3000", status: "Active", notes: EXAMPLE_NOTE },
      { transaction_code: "NOTARY", kind: "TRANSPORT", purpose: "Transport to the notary", suggested_amount: "", max_amount: "500", status: "Active", notes: EXAMPLE_NOTE },
    ],
  },
  "problem-reasons": {
    key: "problem-reasons", title: "Problem reasons", slug: "problem-reasons", keyColumns: ["code"],
    keyHelp: "Rows are matched by code. A new code adds a reason; an existing code updates it.",
    columns: [
      { name: "code", label: "Code", what: "Short code of the reason.", required: "yes", allowed: "2 to 20 capital letters, numbers or -", example: "LTO-STRIKE", text: true },
      { name: "name", label: "Reason", what: "The reason in plain words.", required: "yes", allowed: "Text", example: "LTO staff on strike", text: true },
      { name: "order", label: "Order", what: "Position in lists (smaller first).", required: "yes", allowed: "Whole number 0 to 99", example: "8" },
      status, notes,
    ],
    examples: [
      { code: "LTO-STRIKE", name: "LTO staff on strike", order: "8", status: "Active", notes: EXAMPLE_NOTE },
      { code: "TYPHOON", name: "Typhoon or flood", order: "9", status: "Active", notes: EXAMPLE_NOTE },
    ],
  },
  "funds-types": {
    key: "funds-types", title: "Funds types", slug: "funds-types", keyColumns: ["code"],
    keyHelp: "Rows are matched by short code. A new code adds a type; an existing code updates it. Old records keep the name they had.",
    columns: [
      { name: "code", label: "Short code", what: "Short code shown on the pill.", required: "yes", allowed: "2 to 10 capital letters or numbers", example: "CHK", text: true },
      { name: "name", label: "Name", what: "The type in plain words.", required: "yes", allowed: "Text", example: "Check", text: true },
      { name: "order", label: "Order", what: "Position in lists (smaller first).", required: "yes", allowed: "Whole number 0 to 99", example: "3" },
      { name: "needs_reference", label: "Release needs a reference number", what: "Finance enters the transfer reference number and date at release.", required: "no", allowed: "Yes, No (blank keeps it; new rows No)", example: "Yes" },
      { name: "needs_account", label: "Release needs receiving account details", what: "Bank or e-wallet, account name and the last 4 digits.", required: "no", allowed: "Yes, No (blank keeps it; new rows No)", example: "No" },
      { name: "must_liquidate", label: "Must be liquidated with receipts", what: "Receipts and the liquidation due date, as for every advance.", required: "no", allowed: "Yes, No (blank keeps it; new rows Yes)", example: "Yes" },
      status, notes,
    ],
    examples: [
      { code: "CHK", name: "Check", order: "3", needs_reference: "Yes", needs_account: "No", must_liquidate: "Yes", status: "Active", notes: EXAMPLE_NOTE },
      { code: "GC", name: "GCash payout", order: "4", needs_reference: "Yes", needs_account: "Yes", must_liquidate: "Yes", status: "Active", notes: EXAMPLE_NOTE },
    ],
  },
  "hold-reasons": {
    key: "hold-reasons", title: "Hold reasons", slug: "hold-reasons", keyColumns: ["code"],
    keyHelp: "Rows are matched by code. A new code adds a reason; an existing code updates it.",
    columns: [
      { name: "code", label: "Code", what: "Short code of the reason.", required: "yes", allowed: "2 to 20 capital letters, numbers or -", example: "BANK", text: true },
      { name: "name", label: "Reason", what: "The reason in plain words.", required: "yes", allowed: "Text", example: "Waiting on the bank", text: true },
      { name: "order", label: "Order", what: "Position in lists (smaller first).", required: "yes", allowed: "Whole number 0 to 99", example: "5" },
      status, notes,
    ],
    examples: [
      { code: "BANK", name: "Waiting on the bank", order: "5", status: "Active", notes: EXAMPLE_NOTE },
      { code: "COURIER", name: "Waiting on the courier", order: "6", status: "Active", notes: EXAMPLE_NOTE },
    ],
  },
  "return-reasons": {
    key: "return-reasons", title: "Return reasons", slug: "return-reasons", keyColumns: ["code"],
    keyHelp: "Rows are matched by code. A new code adds a reason; an existing code updates it.",
    columns: [
      { name: "code", label: "Code", what: "Short code of the reason.", required: "yes", allowed: "2 to 20 capital letters, numbers or -", example: "UNSIGNED", text: true },
      { name: "name", label: "Reason", what: "The reason in plain words.", required: "yes", allowed: "Text", example: "Paper not signed", text: true },
      { name: "order", label: "Order", what: "Position in lists (smaller first).", required: "yes", allowed: "Whole number 0 to 99", example: "5" },
      status, notes,
    ],
    examples: [
      { code: "UNSIGNED", name: "Paper not signed", order: "5", status: "Active", notes: EXAMPLE_NOTE },
      { code: "EXPIRED", name: "Expired ID", order: "6", status: "Active", notes: EXAMPLE_NOTE },
    ],
  },
  "processing-stages": {
    key: "processing-stages", title: "Processing stages", slug: "processing-stages", keyColumns: ["transaction_code", "code"],
    keyHelp: "Rows are matched by transaction code and stage code. A new code adds a stage; an existing one updates it. LTO drop off, LTO pickup and Check and verify keep their place.",
    columns: [
      { name: "transaction_code", label: "Transaction code", what: "Short code of the transaction type (with a processor).", required: "yes", allowed: "An existing transaction code", example: "NOTARY", text: true },
      { name: "code", label: "Stage code", what: "Short code of the stage.", required: "yes", allowed: "2 to 20 capital letters, numbers or -", example: "NOTARIZATION", text: true },
      { name: "name", label: "Stage name", what: "The stage in plain words.", required: "yes", allowed: "Text", example: "Notarization", text: true },
      { name: "order", label: "Order", what: "Position among the type's own stages (smaller first).", required: "yes", allowed: "Whole number 0 to 99", example: "1" },
      { name: "evidence_fields", label: "Evidence fields", what: "Label:type:required or optional, separated by ;", required: "no", allowed: "Types: text, date, number, file, tick", example: "Notary name:text:required; Series:text:required", text: true },
      { name: "target_days", label: "Target (business days)", what: "Blank means no target.", required: "no", allowed: "Whole number 0 to 365, or blank", example: "" },
      status, notes,
    ],
    examples: [
      { transaction_code: "NOTARY", code: "SIGNING", name: "Borrower signing", order: "2", evidence_fields: "Signed on:date:required", target_days: "1", status: "Active", notes: EXAMPLE_NOTE },
      { transaction_code: "PPSR", code: "PPSR-PAY", name: "PPSR fee paid", order: "2", evidence_fields: "Paid on:date:required; Receipt:file:optional", target_days: "", status: "Active", notes: EXAMPLE_NOTE },
    ],
  },
  users: {
    key: "users", title: "Users", slug: "users", keyColumns: ["email"],
    keyHelp: "Rows are matched by email. A new email adds a user; an existing email updates it. Import never sets passwords or sign-in.",
    columns: [
      { name: "name", label: "Name", what: "Full name.", required: "yes", allowed: "Text", example: "Juan Dela Cruz", text: true },
      { name: "email", label: "Email", what: "Work email. Cannot change once added.", required: "yes", allowed: "An @gdfi.ph email", example: "juan.delacruz@gdfi.ph", text: true },
      { name: "role", label: "Role", what: "The role name, as in Settings > Roles and access (any case). Custom roles work too. Only roles that may sign in let the person sign in.", required: "yes", allowed: "An active role name, e.g. Loan Associate", example: "Loan Associate", text: true },
      { name: "branches", label: "Branches", what: "Where the person works: 3-digit branch codes separated by ; (semicolon), or ALL for all branches. Blank keeps what the person has. Whole areas, divisions and exceptions are set in Users, Edit, Branch access; this column changes only the single branches and keeps them.", required: "no", allowed: "Branch codes, e.g. 101;165, or ALL", example: "101;165", text: true },
      { name: "home_branch", label: "Home branch", what: "The default branch for new work and sending. Must be one of the person's branches. Blank keeps it (or takes the first branch).", required: "no", allowed: "A branch code, e.g. 101", example: "101", text: true },
      status, notes,
    ],
    examples: [
      { name: "Juan Dela Cruz", email: "juan.delacruz@gdfi.ph", role: "Loan Associate", branches: "101;165", home_branch: "101", status: "Active", notes: EXAMPLE_NOTE },
      { name: "Maria Reyes", email: "maria.reyes@gdfi.ph", role: "Document Processor / Collateral & Mortgage", branches: "390", home_branch: "", status: "Active", notes: EXAMPLE_NOTE },
    ],
  },
};

export const IMPORT_LIST_KEYS = Object.keys(IMPORT_LISTS) as ImportListKey[];

export function columnNames(list: ImportListKey): string[] {
  return IMPORT_LISTS[list].columns.map((c) => c.name);
}

export const templateFileName = (list: ImportListKey) => `gdfi-dms-template-${IMPORT_LISTS[list].slug}.csv`;
export const dataFileName = (list: ImportListKey) => `gdfi-dms-${IMPORT_LISTS[list].slug}.csv`;
