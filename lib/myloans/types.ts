/**
 * MyLoans adapter contract. The DMS never copies the source: it asks MyLoans live, by PN, for the
 * loans someone opens (hundreds, not the whole book). Mock and live implement the same interface;
 * `capabilities` says what the source supports.
 */

/** Normalized MyLoans record, as the DMS uses it. Raw values are kept so the Data Check can judge them. */
export interface MyLoansRecord {
  pn: string;
  cin: string | null;
  cif: string | null;
  sourceLoanId: string | null;
  borrowerName: string;
  branchName: string | null;
  branchCode: string | null;
  /** Source status, e.g. RELEASED, CANCELLED, WITHDRAWN, NOT_RELEASED, REPLACED. */
  status: string | null;
  /** Exactly "New" or "Renewal" to pass the Data Check. Kept raw. */
  loanType: string | null;
  /** May be blank. */
  productName: string | null;
  /** Raw amount; the Data Check requires a number > 0. */
  totalReleasedAmount: number | string | null;
  /** ISO date (YYYY-MM-DD) or null. */
  releaseDate: string | null;
  vehicle?: { plateNo?: string | null; engineNo?: string | null; chassisNo?: string | null; make?: string | null } | null;
  /** Optional display fields (minor changes update the copy without an alert). */
  address?: string | null;
  contactNo?: string | null;
  /** Optional replacement link: this PN replaces that one (a changed unit got a new PN). */
  previousPn?: string | null;
  /** Optional: has a payment been made on this PN? undefined when MyLoans has no such field. */
  paymentRecorded?: boolean | null;
}

export type FailReason = "NOT_FOUND" | "UNAVAILABLE";

export type MyLoansLookup =
  | { ok: true; record: MyLoansRecord; raw: unknown; adapter: "mock" | "live"; retrievedAt: Date }
  | { ok: false; reason: FailReason; message: string; retryAfterMs?: number };

/** One row of a search result (never more than the limit asked for). */
export interface MyLoansHit { pn: string; borrowerName: string; status: string | null; releaseDate: string | null; branchName: string | null }

export type MyLoansSearch =
  | { ok: true; hits: MyLoansHit[] }
  | { ok: false; reason: "UNSUPPORTED" | "UNAVAILABLE"; message: string; retryAfterMs?: number };

/** The changed-since feed returns the changed loans themselves: one call, no per-loan lookups. */
export type MyLoansChanged =
  | { ok: true; records: MyLoansRecord[]; until: Date }
  | { ok: false; reason: "UNSUPPORTED" | "UNAVAILABLE"; message: string; retryAfterMs?: number };

export interface SourceCapabilities {
  /** Partial PN or borrower name search. Without it Find loan takes the exact PN only. */
  search: boolean;
  /** A feed of PNs changed since a time. Without it the background refresh re-reads each active loan. */
  changedSince: boolean;
}

export interface MyLoansAdapter {
  readonly name: "mock" | "live";
  readonly capabilities: SourceCapabilities;
  /** One loan by PN (an indexed lookup at the source). Required. */
  getByPn(pn: string): Promise<MyLoansLookup>;
  /** Up to `limit` loans whose PN or borrower name contains the text. Optional (see capabilities). */
  search(query: string, limit: number): Promise<MyLoansSearch>;
  /** Loans changed since a time, at most `limit`. Optional (see capabilities). */
  getChangedSince(since: Date, limit: number): Promise<MyLoansChanged>;
}

export const UNAVAILABLE_MESSAGE = "MyLoans did not answer. Try again in a moment.";
export const NOT_FOUND_MESSAGE = "PN not found. Check the number.";
