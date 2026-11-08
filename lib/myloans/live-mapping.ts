import type { MyLoansHit, MyLoansRecord, SourceCapabilities } from "./types";

/**
 * MyLoans LIVE MAPPING: the one place to change once the MyLoans team gives the real API.
 *
 * EVERYTHING HERE IS A PLACEHOLDER TO CONFIRM. Nothing below was given by MyLoans; do not treat these
 * paths or field names as known. The rest of the DMS uses the normalized MyLoansRecord and does not
 * change. The address and key come only from MYLOANS_BASE_URL and MYLOANS_API_KEY (server env).
 */
export const LIVE_CAPABILITIES: SourceCapabilities = {
  // TO CONFIRM: does MyLoans offer a partial PN / borrower search with a result limit?
  search: false,
  // TO CONFIRM: does MyLoans offer "loans changed since <time>"?
  changedSince: false,
};

/** TO CONFIRM: paths. Each returns a relative path (query included) under MYLOANS_BASE_URL. */
export const LIVE_PATHS = {
  byPn: (pn: string) => `/loans/${encodeURIComponent(pn)}`,
  search: (q: string, limit: number) => `/loans?q=${encodeURIComponent(q)}&limit=${limit}`,
  changedSince: (since: Date, limit: number) => `/loans/changes?since=${encodeURIComponent(since.toISOString())}&limit=${limit}`,
};

const s = (v: unknown) => (v === undefined || v === null ? null : String(v));

/**
 * TO CONFIRM: field names. Keep raw values (do not coerce or default): the Data Check must see bad
 * data as bad. Returns null when the payload is not a loan.
 */
export function mapLoan(raw: unknown): MyLoansRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const pn = s(r.pnNumber ?? r.pn);
  if (!pn) return null;
  return {
    pn,
    cin: s(r.cin),
    cif: s(r.cif),
    sourceLoanId: s(r.loanId ?? r.id),
    borrowerName: s(r.borrowerName) ?? "",
    branchName: s(r.branchName),
    branchCode: s(r.branchCode),
    status: s(r.status),
    loanType: s(r.loanType),
    productName: s(r.productName),
    totalReleasedAmount: (r.totalReleasedAmount as number | string | null | undefined) ?? null,
    releaseDate: s(r.releaseDate)?.slice(0, 10) ?? null,
    address: s(r.address),
    contactNo: s(r.contactNo),
    previousPn: s(r.previousPn ?? r.replacesPn),
    // TO CONFIRM: is there a payments field? true/false when MyLoans says; undefined when it has none.
    paymentRecorded: r.paymentRecorded === undefined && r.hasPayments === undefined ? undefined : Boolean(r.paymentRecorded ?? r.hasPayments),
    vehicle: null,
  };
}

/** TO CONFIRM: the search response shape ({ items: [...] } assumed). */
export function mapSearch(raw: unknown): MyLoansHit[] {
  const items = (raw as { items?: unknown[] } | null)?.items ?? (Array.isArray(raw) ? raw : []);
  return items.map(mapLoan).filter((x): x is MyLoansRecord => !!x).map((r) => ({ pn: r.pn, borrowerName: r.borrowerName, status: r.status, releaseDate: r.releaseDate, branchName: r.branchName }));
}

/** TO CONFIRM: the changed-since response shape ({ items: [loan, ...] } assumed: the changed loans themselves). */
export function mapChanged(raw: unknown): MyLoansRecord[] {
  const items = (raw as { items?: unknown[] } | null)?.items ?? (Array.isArray(raw) ? raw : []);
  return items.map(mapLoan).filter((x): x is MyLoansRecord => !!x);
}

/**
 * TO CONFIRM: the exact MyLoans status values that mean a loan has ENDED (cancelled, voided, replaced,
 * withdrawn). Only an ended loan can be replaced by a new PN; any other loan of the same borrower is an
 * additional unit. Placeholders until MyLoans confirms the spellings.
 */
export const ENDED_STATUSES: readonly string[] = ["CANCELLED", "CANCELED", "VOIDED", "VOID", "REPLACED", "WITHDRAWN"];

/** TO CONFIRM: the status words MyLoans uses, mapped to ours. */
export const STATUS_WORDS: Record<string, "RELEASED" | "CANCELLED" | "WITHDRAWN" | "NOT_RELEASED" | "REPLACED"> = {
  RELEASED: "RELEASED",
  CANCELLED: "CANCELLED",
  CANCELED: "CANCELLED",
  WITHDRAWN: "WITHDRAWN",
  PENDING: "NOT_RELEASED",
  NOT_RELEASED: "NOT_RELEASED",
  REPLACED: "REPLACED",
};
