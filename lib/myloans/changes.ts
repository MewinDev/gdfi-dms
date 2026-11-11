import { createHash } from "node:crypto";
import { evaluateLoanRules, MORTGAGE_THRESHOLDS, RuleInputError, TRANSACTION_ORDER, type FinancingType, type LoanTypeValue, type OrcrStatus, type RuleOutcome, type TransactionCode } from "@/lib/rules";
import { parseAmount } from "./data-check";
import type { MyLoansRecord } from "./types";

/**
 * MyLoans change detection. Pure: tracked fields of a source record, their hash, what changed and
 * what the rules would do on the new data (nothing is saved here).
 */

export interface Tracked {
  borrowerName: string | null;
  address: string | null;
  contactNo: string | null;
  plateNo: string | null;
  engineNo: string | null;
  chassisNo: string | null;
  make: string | null;
  cin: string | null;
  cif: string | null;
  status: string | null;
  loanType: string | null;
  productName: string | null;
  /** Centavos when it is a number; the raw text otherwise (so bad data stays visible). */
  amount: number | string | null;
  releaseDate: string | null;
  branchName: string | null;
  /** The loan's CURRENT branch code in MyLoans (the PN's code only says where it was opened). */
  branchCode: string | null;
  previousPn: string | null;
  // The account details added with docs/myloans/field-map.md. A copy saved before them has none of these
  // keys, so their first appearance is not a change (detectChanges skips keys the previous copy lacks).
  sourceLoanId: string | null;
  productCode: string | null;
  areaId: string | null;
  areaName: string | null;
  divisionId: string | null;
  divisionName: string | null;
  companyId: string | null;
  companyName: string | null;
  statusId: string | null;
  statusName: string | null;
  /** "Yes" or "No" (TransactionIsActive). */
  isActive: string | null;
}
export type TrackedKey = keyof Tracked;
export type FieldKind = "minor" | "material" | "status" | "replacement";

export const FIELDS: Record<TrackedKey, { label: string; kind: FieldKind }> = {
  borrowerName: { label: "Borrower name", kind: "minor" },
  address: { label: "Address", kind: "minor" },
  contactNo: { label: "Contact number", kind: "minor" },
  plateNo: { label: "Plate number", kind: "minor" },
  engineNo: { label: "Engine number", kind: "minor" },
  chassisNo: { label: "Chassis number", kind: "minor" },
  make: { label: "Make", kind: "minor" },
  cin: { label: "CIN", kind: "minor" },
  cif: { label: "CIF", kind: "minor" },
  status: { label: "Status", kind: "status" },
  loanType: { label: "Loan type", kind: "material" },
  productName: { label: "Product name", kind: "material" },
  amount: { label: "Amount", kind: "material" },
  releaseDate: { label: "Release date", kind: "material" },
  branchName: { label: "Branch", kind: "material" },
  branchCode: { label: "Branch code", kind: "material" },
  previousPn: { label: "Replaces PN", kind: "replacement" },
  sourceLoanId: { label: "Source loan ID", kind: "material" },
  productCode: { label: "Product code", kind: "material" },
  areaId: { label: "Area ID", kind: "minor" },
  areaName: { label: "Area", kind: "minor" },
  divisionId: { label: "Division ID", kind: "minor" },
  divisionName: { label: "Division", kind: "minor" },
  companyId: { label: "Company ID", kind: "minor" },
  companyName: { label: "Company", kind: "minor" },
  statusId: { label: "Status ID", kind: "status" },
  statusName: { label: "Status name", kind: "status" },
  isActive: { label: "Active in MyLoans", kind: "status" },
};
const KEYS = Object.keys(FIELDS) as TrackedKey[];

const txt = (v: unknown) => {
  const t = v === undefined || v === null ? "" : String(v).replace(/\s+/g, " ").trim();
  return t === "" ? null : t;
};

export function trackedOf(r: MyLoansRecord): Tracked {
  const n = parseAmount(r.totalReleasedAmount);
  return {
    borrowerName: txt(r.borrowerName), address: txt(r.address), contactNo: txt(r.contactNo),
    plateNo: txt(r.vehicle?.plateNo), engineNo: txt(r.vehicle?.engineNo), chassisNo: txt(r.vehicle?.chassisNo), make: txt(r.vehicle?.make),
    cin: txt(r.cin), cif: txt(r.cif), status: txt(r.status)?.toUpperCase() ?? null,
    loanType: txt(r.loanType), productName: txt(r.productName),
    amount: n !== null ? Math.round(n * 100) : txt(r.totalReleasedAmount),
    releaseDate: txt(r.releaseDate)?.slice(0, 10) ?? null, branchName: txt(r.branchName), branchCode: txt(r.branchCode), previousPn: txt(r.previousPn)?.toUpperCase() ?? null,
    sourceLoanId: txt(r.sourceLoanId), productCode: txt(r.productCode),
    areaId: txt(r.areaId), areaName: txt(r.areaName), divisionId: txt(r.divisionId), divisionName: txt(r.divisionName),
    companyId: txt(r.companyId), companyName: txt(r.companyName),
    statusId: txt(r.statusId), statusName: txt(r.statusName), isActive: r.isActive === undefined || r.isActive === null ? null : r.isActive ? "Yes" : "No",
  };
}

const ACCOUNT_KEYS = ["productCode", "areaId", "areaName", "divisionId", "divisionName", "companyId", "companyName", "statusId", "statusName", "isActive"] as const;

/**
 * Tracked fields of a copy saved before they were tracked (an old snapshot's payload): the account
 * details that copy never had are left out, so they do not count as changed.
 */
export function trackedOfSaved(r: MyLoansRecord): Tracked {
  const t = trackedOf(r);
  for (const k of ACCOUNT_KEYS) if (r[k] === undefined) delete (t as Partial<Tracked>)[k];
  return t;
}

/** Same values, same hash (key order fixed). */
export function hashTracked(t: Tracked): string {
  return createHash("sha256").update(JSON.stringify(KEYS.map((k) => [k, t[k] ?? null]))).digest("hex").slice(0, 32);
}

export interface FieldChange { field: TrackedKey; label: string; kind: FieldKind; was: string | number | null; now: string | number | null }
export type ChangeCategory = "NONE" | "MINOR" | "MATERIAL" | "STATUS" | "REPLACEMENT";

/** Released is the only status a working loan should have. */
export const isReleased = (status: string | null | undefined) => (status ?? "").toUpperCase() === "RELEASED";

/**
 * What changed between two copies, and one category: Replacement (a replaces-PN link appears),
 * Status, Material (anything the rules use), Minor (display fields), or None.
 */
export function detectChanges(previous: Tracked | null, current: Tracked): { category: ChangeCategory; changes: FieldChange[] } {
  if (!previous) return { category: "NONE", changes: [] };
  // A field the previous copy did not track yet (an older snapshot) is not a change.
  const changes: FieldChange[] = KEYS.filter((k) => k in previous && (previous[k] ?? null) !== (current[k] ?? null)).map((k) => ({
    field: k, label: FIELDS[k].label, kind: FIELDS[k].kind, was: previous[k] ?? null, now: current[k] ?? null,
  }));
  const has = (kind: FieldKind) => changes.some((c) => c.kind === kind);
  const category: ChangeCategory =
    changes.some((c) => c.kind === "replacement" && c.now) ? "REPLACEMENT"
      : has("status") ? "STATUS"
        : has("material") ? "MATERIAL"
          : changes.length ? "MINOR" : "NONE";
  return { category, changes };
}

// ---------------------------------------------------------------------------
// Proposed effect: the rules on the new data, without saving
// ---------------------------------------------------------------------------

export interface TxnNow { id: string; code: string; name: string; status: string; stateLine: string }
export interface Proposed {
  /** The rule that fires now and on the new data. */
  ruleNow: string;
  ruleNext: string | null;
  classificationNext: "FINANCING" | "REFINANCING" | null;
  mortgageNext: string | null;
  added: TransactionCode[];
  removed: TransactionCode[];
  /** Transactions the change reaches, with their state; locked = sent or in process (Apply never changes them). */
  affected: { code: string; name: string; stateLine: string; locked: boolean }[];
  /** Plain sentences for "What it means". */
  sentences: string[];
  /** It would become Financing: Undertaking and ORCR must be picked to apply it. */
  needsPicks: boolean;
}

const NAME: Record<TransactionCode, string> = { NOTARY: "Notary", EDST: "EDST", PPSR: "Entry of PPSR", MORTGAGE: "Mortgage" };
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
/** With the LA: not sent, or back from the processor. */
export const UNSENT = ["FOR_CHECKLIST", "READY", "RETURNED"];
const OPEN = ["FOR_CHECKLIST", "READY", "RETURNED", "ASSIGNED", "IN_PROCESS", "FORWARDED"];

export function proposeEffect(input: {
  category: ChangeCategory;
  loan: { classification: string; financingType: FinancingType | null; orcrStatus: OrcrStatus | null; mortgageResult: string; ruleFired: string };
  txns: TxnNow[];
  next: Tracked;
  picks?: { financingType?: FinancingType | null; orcrStatus?: OrcrStatus | null };
}): Proposed {
  const { loan, txns, next } = input;
  const base: Proposed = { ruleNow: loan.ruleFired, ruleNext: null, classificationNext: null, mortgageNext: null, added: [], removed: [], affected: [], sentences: [], needsPicks: false };
  const live = txns.filter((t) => t.status !== "CANCELLED");

  if (input.category === "STATUS" || input.category === "REPLACEMENT") {
    const open = live.filter((t) => OPEN.includes(t.status));
    base.affected = open.map((t) => ({ code: t.code, name: t.name, stateLine: t.stateLine, locked: !UNSENT.includes(t.status) }));
    const st = next.status ?? "blank";
    base.sentences.push(
      input.category === "REPLACEMENT" && next.previousPn
        ? `MyLoans says this PN replaces ${next.previousPn}.`
        : `MyLoans now says the loan is ${st.toLowerCase().replace(/_/g, " ")}.`,
      open.length ? `If it is closed as cancelled, these close too: ${list(open.map((t) => t.name))}.` : "Nothing is open on this loan.",
    );
    return base;
  }

  const amount = typeof next.amount === "number" ? next.amount / 100 : NaN;
  if (next.loanType !== "New" && next.loanType !== "Renewal") {
    base.sentences.push(`The loan type in MyLoans is "${next.loanType ?? "blank"}": the rules cannot run on it. Keep current, or ask MyLoans to correct it.`);
    return base;
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    base.sentences.push("The amount in MyLoans is not a valid number: the rules cannot run on it. Keep current, or ask MyLoans to correct it.");
    return base;
  }
  let outcome: RuleOutcome;
  const financingType = input.picks?.financingType ?? loan.financingType;
  const orcrStatus = input.picks?.orcrStatus ?? loan.orcrStatus;
  try {
    outcome = evaluateLoanRules({ productName: next.productName, loanType: next.loanType as LoanTypeValue, totalReleasedAmount: amount, financingType, orcrStatus });
  } catch (e) {
    if (!(e instanceof RuleInputError)) throw e;
    base.needsPicks = true;
    base.classificationNext = "FINANCING";
    base.sentences.push("The product name now means Financing. Undertaking and ORCR must be picked to apply it.");
    return base;
  }
  base.ruleNext = outcome.summary;
  base.classificationNext = outcome.classification;
  base.mortgageNext = outcome.mortgage;

  const have = TRANSACTION_ORDER.filter((c) => live.some((t) => t.code === c));
  const want = outcome.transactions;
  base.added = want.filter((c) => !have.includes(c));
  base.removed = have.filter((c) => !want.includes(c as TransactionCode)) as TransactionCode[];
  const stay = have.filter((c) => want.includes(c as TransactionCode)).map((c) => NAME[c as TransactionCode]);

  if (outcome.classification !== loan.classification) {
    base.sentences.push(`The product name now means ${outcome.classification === "FINANCING" ? "Financing" : "Refinancing"} (was ${loan.classification === "FINANCING" ? "Financing" : "Refinancing"}).`);
  }
  if (loan.mortgageResult === "MORTGAGE" && outcome.mortgage !== "MORTGAGE") base.sentences.push(`Rule 4 no longer applies (now above ₱${MORTGAGE_THRESHOLDS[next.loanType as LoanTypeValue].toLocaleString("en-PH")} for ${next.loanType}).`);
  if (loan.mortgageResult !== "MORTGAGE" && outcome.mortgage === "MORTGAGE") base.sentences.push(`Rule 4 now applies (at or below ₱${MORTGAGE_THRESHOLDS[next.loanType as LoanTypeValue].toLocaleString("en-PH")} for ${next.loanType}).`);
  if (base.removed.length) base.sentences.push(`${list(base.removed.map((c) => NAME[c]))} would be removed.`);
  if (base.added.length) base.sentences.push(`${list(base.added.map((c) => NAME[c]))} would be added.`);
  if (base.removed.length || base.added.length) {
    if (stay.length) base.sentences.push(`${list(stay)} stay.`);
  } else {
    base.sentences.push("Nothing changes in the transactions.");
  }
  base.affected = live.filter((t) => base.removed.includes(t.code as TransactionCode))
    .map((t) => ({ code: t.code, name: t.name, stateLine: t.stateLine, locked: !UNSENT.includes(t.status) }));
  return base;
}

/** Money text for a change row: amounts only for people who may see them. */
export function changeText(c: Pick<FieldChange, "field" | "was" | "now">, seesAmounts: boolean): { was: string; now: string } {
  const show = (v: string | number | null) => {
    if (v === null || v === "") return "blank";
    if (c.field === "amount") return typeof v === "number" ? `₱${(v / 100).toLocaleString("en-PH", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}` : String(v);
    return String(v);
  };
  if (c.field === "amount" && !seesAmounts) return { was: "", now: "" };
  return { was: show(c.was), now: show(c.now) };
}
