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

  // ---- The account details MyLoans gives (docs/myloans/field-map.md). Kept as MyLoans gave them. ----
  /** MyLoans product code (Transactions.product_code). */
  productCode?: string | null;
  /** MyLoans organisation ids and names at the time of the answer (never used for access). */
  areaId?: string | null;
  areaName?: string | null;
  divisionId?: string | null;
  divisionName?: string | null;
  companyId?: string | null;
  companyName?: string | null;
  /** MyLoans TransactionStatusId (12 = Loan Released) and its name; `status` above is the DMS word for it. */
  statusId?: string | null;
  statusName?: string | null;
  /** MyLoans TransactionIsActive. */
  isActive?: boolean | null;
  /** The latest update of any part of the loan in MyLoans (SourceUpdatedAt, ISO). */
  sourceUpdatedAt?: string | null;
}

/** Where the account details come from. One source today. */
export const SOURCE_NAME = "MyLoans";

export type FailReason = "NOT_FOUND" | "UNAVAILABLE";

export type MyLoansLookup =
  | { ok: true; record: MyLoansRecord; raw: unknown; adapter: "mock" | "live"; retrievedAt: Date }
  /** limited: no call was made (the hourly limit, the circuit breaker, or the shared count could not be written). */
  | { ok: false; reason: FailReason; message: string; retryAfterMs?: number; limited?: true };

/** One row of a search result (never more than the limit asked for). */
export interface MyLoansHit { pn: string; borrowerName: string; status: string | null; releaseDate: string | null; branchName: string | null; branchCode?: string | null }

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
  /** The branch list (listBranches). Without it branches come from Import from MyLoans (a file). */
  branches?: boolean;
  /** listBranches can return only the branches changed since a time (incremental runs). */
  branchesUpdatedSince?: boolean;
}

/** One page of the MyLoans branch list (the same normalized row as Import from MyLoans). */
export type MyLoansBranches =
  | { ok: true; branches: import("@/lib/branches/file").MyLoansBranchRow[]; nextPage: number | null }
  | { ok: false; reason: "UNSUPPORTED" | "UNAVAILABLE"; message: string; retryAfterMs?: number };

export interface ListBranchesOptions {
  /** Only branches changed since this time (when branchesUpdatedSince is supported); null = the full list. */
  updatedSince: Date | null;
  page: number;
  pageSize: number;
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
  /**
   * The branch list (id, code, name, area, division, status, address, updatedAt), paged. Optional (see
   * capabilities.branches). The DMS never reads the MyLoans database: this method (or a file) is the feed.
   */
  listBranches?(o: ListBranchesOptions): Promise<MyLoansBranches>;
}

export const UNAVAILABLE_MESSAGE = "MyLoans did not answer. Try again in a moment.";
export const NOT_FOUND_MESSAGE = "PN not found. Check the number.";
