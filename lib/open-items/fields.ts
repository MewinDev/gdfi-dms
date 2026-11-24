import type { FieldChange, Tracked, TrackedKey } from "@/lib/myloans/changes";

/**
 * Piece 8 (D-004, D-010 to D-013, D-053): which myloans changes become Open Items, and which are lookup data.
 * Pure: no database.
 *
 *  - Open Item fields: the loan's own fields and the borrower's. One item per field. Loan type, amount, product and
 *    release date are decided together (group "rules"), because together they decide the transactions.
 *  - Status: every move away from Released (Cancelled, Inactive, NotReleased, Superseded / replaced) is one "status"
 *    item; Forward, Send and new cash are blocked while it is pending (D-053).
 *  - Lookup data (D-012, D-053): area, division, company names (and ids), a branch or product NAME whose code did not
 *    change. Applied by itself and written to Reference data changes. Never an Open Item.
 */

export type OpenItemField = "borrowerName" | "cif" | "cin" | "loanType" | "amount" | "productCode" | "releaseDate" | "branchCode" | "sourceLoanId" | "status";
export type Audience = "LOAN" | "BORROWER";

export const OI_FIELDS: Record<OpenItemField, { label: string; audience: Audience; group?: "rules" }> = {
  status: { label: "Status in myloans", audience: "LOAN" },
  loanType: { label: "Loan type", audience: "LOAN", group: "rules" },
  amount: { label: "Amount", audience: "LOAN", group: "rules" },
  productCode: { label: "Product", audience: "LOAN", group: "rules" },
  releaseDate: { label: "Release date", audience: "LOAN", group: "rules" },
  branchCode: { label: "Branch", audience: "LOAN" },
  sourceLoanId: { label: "Source loan ID", audience: "LOAN" },
  borrowerName: { label: "Borrower name", audience: "BORROWER" },
  cif: { label: "CIF", audience: "BORROWER" },
  cin: { label: "CIN", audience: "BORROWER" },
};
export const OI_FIELD_KEYS = Object.keys(OI_FIELDS) as OpenItemField[];
export const RULE_FIELDS = OI_FIELD_KEYS.filter((f) => OI_FIELDS[f].group === "rules");
/** Fields that can be switched off in Settings (the status is always watched: it blocks Forward). */
export const MONITORABLE_FIELDS = OI_FIELD_KEYS.filter((f) => f !== "status");

/** The tracked keys behind each Open Item field. */
const SOURCE_KEYS: Record<OpenItemField, TrackedKey[]> = {
  status: ["status", "statusId", "statusName", "isActive"],
  loanType: ["loanType"], amount: ["amount"], productCode: ["productCode", "productName"], releaseDate: ["releaseDate"],
  branchCode: ["branchId", "branchCode", "branchName"], sourceLoanId: ["sourceLoanId"], borrowerName: ["borrowerName"], cif: ["cif"], cin: ["cin"],
};

export type FeedStateWord = "Released" | "Cancelled" | "Superseded" | "NotReleased" | "Inactive";
export const STATUS_WORDS: Record<FeedStateWord, string> = {
  Released: "Released",
  Cancelled: "Cancelled in myloans",
  Superseded: "Redone in myloans (replaced)",
  NotReleased: "Not released in myloans",
  Inactive: "Inactive in myloans",
};

/** The myloans state of a copy, from its tracked status (D-050 words). */
export function feedStateOf(t: Pick<Tracked, "status" | "isActive">): FeedStateWord {
  const s = (t.status ?? "").toUpperCase();
  if (s === "CANCELLED" || s === "STATUS_CANCELLED") return "Cancelled";
  if (s === "REPLACED" || s === "STATUS_SUPERSEDED") return "Superseded";
  if (s === "STATUS_INACTIVE") return "Inactive";
  if (s === "RELEASED") return t.isActive === "No" ? "Inactive" : "Released";
  return "NotReleased";
}

export interface Value { raw: unknown; text: string | null; key: string }
const plain = (v: unknown): Value => {
  const t = v === null || v === undefined || v === "" ? null : String(v);
  return { raw: v ?? null, text: t, key: t ?? "" };
};
const pesoText = (centavos: number) => `₱${(centavos / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const named = (code: string | null, name: string | null): Value => ({
  raw: { code, name }, text: name || code ? `${name ?? code}${name && code ? ` (${code})` : ""}` : null, key: code ?? `name:${name ?? ""}`,
});

/** The value myloans now has for a field. */
export function myloansValue(f: OpenItemField, t: Tracked, extra: { replacedByPn?: string | null } = {}): Value {
  switch (f) {
    case "amount": return typeof t.amount === "number" ? { raw: t.amount, text: pesoText(t.amount), key: String(t.amount) } : plain(t.amount);
    case "productCode": return named(t.productCode ?? null, t.productName ?? null);
    case "branchCode": { const v = named(t.branchCode ?? null, t.branchName ?? null); return { ...v, raw: { ...(v.raw as object), id: t.branchId ? Number(t.branchId) : null } }; }
    case "status": {
      const state = feedStateOf(t);
      const rep = state === "Superseded" ? extra.replacedByPn ?? null : null;
      return { raw: { state, replacedByPn: rep }, text: `${STATUS_WORDS[state]}${rep ? `: replaced by ${rep}` : ""}`, key: state };
    }
    default: return plain(t[f]);
  }
}

export interface DmsLoan {
  borrowerName: string; cif: string | null; cin: string | null; loanType: string; totalReleasedAmount: number | string | { toString(): string };
  productCode: string | null; productName: string; releasedYmd: string | null; sourceBranchCode: string | null; sourceBranchName: string | null;
  sourceLoanId: string | null; cancelledAt: Date | null;
  /** D-054: myloans' BranchID of the loan's DMS branch. */
  branchMyloansId?: number | null;
  /** D-053: on hold because myloans no longer shows it released (NotReleased or Inactive). */
  sourceHold?: string | null;
}
/** The value the DMS has for a field (what an approval would replace). */
export function dmsValue(f: OpenItemField, l: DmsLoan): Value {
  switch (f) {
    case "amount": { const c = Math.round(Number(String(l.totalReleasedAmount)) * 100); return { raw: c, text: pesoText(c), key: String(c) }; }
    case "productCode": return named(l.productCode, l.productName || null);
    case "branchCode": { const v = named(l.sourceBranchCode, l.sourceBranchName); return { ...v, raw: { ...(v.raw as object), id: l.branchMyloansId ?? null } }; }
    case "releaseDate": return plain(l.releasedYmd);
    case "status":
      if (l.cancelledAt) return { raw: { state: "Cancelled" }, text: "Closed in the DMS", key: "Cancelled" };
      if (l.sourceHold) return { raw: { state: l.sourceHold }, text: `On hold: ${STATUS_WORDS[l.sourceHold as FeedStateWord]?.toLowerCase() ?? "not released in myloans"}`, key: l.sourceHold };
      return { raw: { state: "Released" }, text: STATUS_WORDS.Released, key: "Released" };
    case "borrowerName": return plain(l.borrowerName);
    default: return plain(l[f]);
  }
}

/** Lookup keys: never an Open Item (D-012, D-053). Vehicle details are not sent by the contract; they never count either. */
const LOOKUP_ALWAYS: TrackedKey[] = ["areaId", "areaName", "divisionId", "divisionName", "companyId", "companyName", "plateNo", "engineNo", "chassisNo", "make", "previousPn"];

export interface Split {
  /** Open Item fields touched by this change (the status once, whatever status keys moved). */
  fields: OpenItemField[];
  /** Lookup changes to apply by themselves and log (a rename: area, division, company, branch name, product name). */
  lookup: FieldChange[];
}

/**
 * Splits a detected change into Open Item fields and lookup data. A name whose code also changed is a real change.
 * D-054: when both copies carry myloans' BranchID, the branch is matched by it: a new code or name with the same id is
 * a rename (lookup data, logged), and only a different BranchID moves the loan (an Open Item).
 */
export function splitChanges(changes: FieldChange[], o: { branchIdTracked?: boolean } = {}): Split {
  const moved = new Set(changes.map((c) => c.field));
  const byId = !!o.branchIdTracked;
  const lookup = changes.filter((c) => LOOKUP_ALWAYS.includes(c.field)
    || (c.field === "branchName" && (byId ? !moved.has("branchId") : !moved.has("branchCode")))
    || (c.field === "branchCode" && byId && !moved.has("branchId"))
    || (c.field === "productName" && !moved.has("productCode")));
  const lookupKeys = new Set(lookup.map((c) => c.field));
  const fields = OI_FIELD_KEYS.filter((f) => SOURCE_KEYS[f].some((k) => moved.has(k) && !lookupKeys.has(k)));
  return { fields, lookup };
}

/** The reference entity a lookup change belongs to, with the key that names it. */
export function referenceOf(c: FieldChange, t: Tracked): { entity: "AREA" | "DIVISION" | "COMPANY" | "BRANCH" | "BRANCH_CODE" | "PRODUCT"; key: string } | null {
  switch (c.field) {
    case "areaName": return { entity: "AREA", key: t.areaId ?? "" };
    case "divisionName": return { entity: "DIVISION", key: t.divisionId ?? "" };
    case "companyName": return { entity: "COMPANY", key: t.companyId ?? "" };
    case "branchName": return { entity: "BRANCH", key: t.branchId ?? t.branchCode ?? "" };
    case "branchCode": return { entity: "BRANCH_CODE", key: t.branchId ?? "" };
    case "productName": return { entity: "PRODUCT", key: t.productCode ?? "" };
    default: return null; // ids and vehicle details: applied, not a rename to log
  }
}

/**
 * D-053: what approving a status item does, said before it is pressed. Cancelled: the loan file is closed. Redone
 * (replaced): the same loan file moves to the new PN. Not released or inactive: the loan stays on hold.
 */
export function statusOutcome(state: FeedStateWord, replacedByPn: string | null): { kind: "close" | "relink" | "hold"; text: string } {
  if (state === "Superseded") return { kind: "relink", text: replacedByPn ? `This will move the loan file to PN ${replacedByPn}. Its papers, jobs and work stay with it; the old PN stays in its history.` : "This will move the loan file to the PN myloans names as the replacement." };
  if (state === "NotReleased" || state === "Inactive") return { kind: "hold", text: "The loan stays on hold until released again. Nothing is closed; it continues by itself when myloans shows it released." };
  return { kind: "close", text: "This will close the loan file." };
}

/** The same value on both sides? The branch by myloans' BranchID when both sides have it (D-054), else by key. */
export function sameValue(f: OpenItemField, a: Value, b: Value): boolean {
  if (f === "branchCode") {
    const x = (a.raw as { id?: number | null } | null)?.id, y = (b.raw as { id?: number | null } | null)?.id;
    if (x && y) return x === y;
  }
  return a.key === b.key;
}

/** Waiting colour of an Open Item, on the inbox thresholds (working days). */
export function waitingTone(days: number, t: { amberDays: number; redDays: number }): "ok" | "act" | "bad" {
  return days >= t.redDays ? "bad" : days >= t.amberDays ? "act" : "ok";
}
