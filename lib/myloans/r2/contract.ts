/**
 * myloans API contract, round 3 (17 Nov 2026; docs/myloans-api-contract.sql, docs/MYLOANS_ANSWERS_R2.md and _R3.md;
 * D-036, D-040). Types only, plus the pure readings of API 1 answers. API 3 is dropped: the Refresh button calls API 1.
 *
 * Round 3 (D-040): the hash is 17 fields (confirmed; unchanged by round 3). SourceUpdatedAt is the latest of the
 * row's updated_at columns, the redo suffix time ("x<yyyymmddhhmmss>", Manila time; a redo does NOT touch
 * Transactions.updated_at) and the replacement transaction's created_at. API 1 with more than one row is always
 * 409 with every row, whatever their states.
 */

/**
 * The time a redo suffix was added, read from a transaction code exactly as myloans' query does: a 35-character
 * code whose 21st character is "x", then yyyymmddhhmmss in Manila time. Null for any other code.
 */
export function redoSuffixAt(code: string | null | undefined): string | null {
  if (!code || code.length !== 35 || code[20] !== "x") return null;
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(code.slice(21));
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+08:00`;
  const d = new Date(iso);
  // TRY_CONVERT gives NULL for an impossible date (month 13, 31 November): so does this.
  if (Number.isNaN(d.getTime()) || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(d) !== `${m[1]}-${m[2]}-${m[3]}`) return null;
  return iso;
}

/** Decided in this order, first match wins: Cancelled, Superseded, NotReleased, Inactive, Released. */
export type FeedState = "Cancelled" | "Superseded" | "NotReleased" | "Inactive" | "Released";
export const FEED_STATES: FeedState[] = ["Cancelled", "Superseded", "NotReleased", "Inactive", "Released"];

/** One row of API 1 / API 2 (the fields the DMS reads). The birth date is not in the contract at all (D-037). */
export interface FeedRow {
  externalLoanId: number;
  cin: string | null;
  pnNo: string | null;
  transactionStatusId: number;
  feedState: FeedState;
  isSelectable: 0 | 1;
  replacedByExternalLoanId: number | null;
  replacedByPnNo: string | null;
  productId: number | null;
  productCode: string | null;
  productName: string | null;
  branchCode: string | null;
  /** Sent as a string (A5). */
  totalLoanAmount: string | null;
  contentHash: string;
  /** > 1: myloans returned this loan twice (a duplicate CIN or PN #). */
  rowsForThisLoan: number;
  sourceUpdatedAt: string;
}

/** API 2 page (and Pool): cut by LOAN. nextAfterId null = last page; an empty page is items [] and null. */
export interface FeedPage { runStartedAt: string; items: FeedRow[]; nextAfterId: number | null }

/** API 1 by PN #: 404 not found; 422 not selectable; 200 one selectable row; 409 several rows. */
export type Api1Answer =
  | { status: 404 }
  | { status: 422; body: { transactionStatusId: number; feedState: FeedState; replacedByPnNo: string | null } }
  | { status: 200; body: FeedRow }
  | { status: 409; body: { rows: FeedRow[] } };

/** API 5: the full product list every sync (UpdatedAt may not exist). */
export interface ProductRow { productId: number; productCode: string; name: string; active: boolean }

/** What the PN # search / Refresh shows for an API 1 answer (plain words; D-036 item 4). */
export type Api1Reading =
  | { kind: "found"; row: FeedRow; logRows?: FeedRow[] }
  | { kind: "not-found"; message: string }
  | { kind: "not-selectable"; feedState: FeedState; message: string }
  | { kind: "multiple"; message: string; logRows: FeedRow[]; alertAdmin: true };

export function readApi1(a: Api1Answer): Api1Reading {
  switch (a.status) {
    case 404: return { kind: "not-found", message: "PN not found in myloans. Check the number." };
    case 422:
      return { kind: "not-selectable", feedState: a.body.feedState, message: `${feedStateWords(a.body.feedState)}${a.body.replacedByPnNo ? ` Replaced by ${a.body.replacedByPnNo}.` : ""}` };
    case 200: return { kind: "found", row: a.body };
    case 409: {
      // Several rows for one PN #: log them all; use the single selectable one if there is exactly one.
      const selectable = a.body.rows.filter((r) => r.isSelectable === 1);
      if (selectable.length === 1) return { kind: "found", row: selectable[0], logRows: a.body.rows };
      return { kind: "multiple", message: "Multiple records in myloans, contact Admin.", logRows: a.body.rows, alertAdmin: true };
    }
  }
}

export function feedStateWords(s: FeedState): string {
  return {
    Cancelled: "Cancelled in myloans.",
    Superseded: "This copy was redone in myloans.",
    NotReleased: "Not released in myloans (its status is no longer Released).",
    Inactive: "Inactive in myloans.",
    Released: "Released.",
  }[s];
}
