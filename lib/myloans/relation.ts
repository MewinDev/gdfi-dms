import { ENDED_STATUSES } from "./live-mapping";
import { recordStatusKind } from "./status";

/**
 * Replacement or additional unit. Pure. Two loans of the same borrower (same CIN or CIF; never by
 * name) are a replacement candidate only when the old one has ended in MyLoans (cancelled, voided,
 * replaced, withdrawn) AND the details match (product, loan type, amount, and the unit numbers when
 * MyLoans has them) AND the new one was released after the old one ended or within the window.
 * Anything else is an additional unit: a new loan, the old one stays as it is.
 */
export interface RelLoan {
  pn: string;
  status: string | null;
  productName: string | null;
  loanType: string | null;
  /** Centavos (or the raw text). */
  amount: number | string | null;
  /** YYYY-MM-DD. */
  releaseDate: string | null;
  plateNo?: string | null;
  chassisNo?: string | null;
  engineNo?: string | null;
  /** When it ended (YYYY-MM-DD), when known: the day MyLoans was seen saying so. */
  endedOn?: string | null;
}

export type Relation =
  | { kind: "REPLACEMENT_CANDIDATE"; matched: string[]; mismatched: []; reason: string }
  | { kind: "ADDITIONAL"; matched: string[]; mismatched: string[]; reason: string };

/** Ended: one of the ended words, or the MyLoans cancelled status by id (STATUS_14, lib/myloans/status.ts). */
export const isEnded = (status: string | null | undefined, ended: readonly string[] = ENDED_STATUSES) =>
  ended.includes((status ?? "").trim().toUpperCase()) || (/^STATUS_\d+$/i.test((status ?? "").trim()) && recordStatusKind({ status }) === "cancelled");

const norm = (v: unknown) => (v === null || v === undefined ? null : String(v).replace(/\s+/g, " ").trim().toUpperCase() || null);
const days = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

export function classifyRelation(old: RelLoan, nw: RelLoan, opts: { windowDays?: number; endedStatuses?: readonly string[] } = {}): Relation {
  const windowDays = opts.windowDays ?? 30;
  if (!isEnded(old.status, opts.endedStatuses)) {
    return { kind: "ADDITIONAL", matched: [], mismatched: [], reason: `${old.pn} is still active in MyLoans: a new loan for the same borrower.` };
  }
  const matched: string[] = [];
  const mismatched: string[] = [];
  const check = (label: string, a: unknown, b: unknown, optional = false) => {
    const x = norm(a), y = norm(b);
    if (optional && (x === null || y === null)) return; // MyLoans does not give it for one of them
    (x === y ? matched : mismatched).push(label);
  };
  check("Product name", old.productName, nw.productName);
  check("Loan type", old.loanType, nw.loanType);
  check("Amount", old.amount, nw.amount);
  check("Plate number", old.plateNo, nw.plateNo, true);
  check("Chassis number", old.chassisNo, nw.chassisNo, true);
  check("Engine number", old.engineNo, nw.engineNo, true);
  if (mismatched.length) {
    return { kind: "ADDITIONAL", matched, mismatched, reason: `The details differ (${mismatched.join(", ")}): a new loan, not a replacement.` };
  }
  const inTime = !!nw.releaseDate && (
    (old.endedOn ? days(nw.releaseDate, old.endedOn) >= 0 : false)
    || (old.releaseDate ? Math.abs(days(nw.releaseDate, old.releaseDate)) <= windowDays : false)
  );
  if (!inTime) {
    return { kind: "ADDITIONAL", matched, mismatched: [], reason: `Released more than ${windowDays} days apart: treated as a new loan.` };
  }
  return { kind: "REPLACEMENT_CANDIDATE", matched, mismatched: [], reason: `${old.pn} ended in MyLoans and the details match: ${matched.join(", ")}.` };
}

/** Payments on the old PN, as evidence: null when MyLoans has no payments field. */
export function paymentEvidence(paymentRecorded: boolean | null | undefined): { known: boolean; text: string | null; recorded: boolean } {
  if (paymentRecorded === null || paymentRecorded === undefined) return { known: false, text: null, recorded: false };
  return { known: true, recorded: paymentRecorded, text: paymentRecorded ? "Payment recorded in MyLoans" : "No payment recorded in MyLoans" };
}
