import type { Api1Answer, FeedPage, FeedRow, FeedState, ProductRow } from "./contract";
import { redoSuffixAt } from "./contract";
import { hashOf, type HashValues } from "./hash";
import { isAcceptedStatus } from "@/lib/myloans/status";

/**
 * In-memory mock of the myloans APIs, round 3 contract (D-036, D-037, D-040). Fake data only (GD999... PNs). The hash
 * is the real formula (SHA-256, UTF-16LE, 17 fields) so a change in any hashed field changes it, exactly as in
 * myloans. Freshness (SourceUpdatedAt) follows round 3: the latest of updated_at, the redo suffix time and the
 * replacement's created_at.
 */

export interface MockTxn {
  id: number; cin: string; pnNo: string; statusId: number; isActive: 0 | 1; productId: number; branchId: number;
  amount: string; releaseDate: string | null;
  /** The newest of the row's updated_at columns (Transactions, PDC, LoanComputations, LOANS, BORROWERS). */
  updatedAt: string;
  /** Transactions.created_at (a replacement's creation moves the old copy's freshness). Defaults to updatedAt. */
  createdAt?: string;
  /** The live transaction that replaced this one (redo). */
  replacedBy?: number;
  /** The transaction code: 20 characters, plus "x<yyyymmddhhmmss>" once redone (myloans adds it without touching updated_at). */
  code?: string;
  /** A duplicate LOANS.CIN row: the loan comes back twice. */
  duplicate?: boolean;
}

export interface MockDb { txns: MockTxn[]; products: ProductRow[]; now: string }

/** FeedState, first match wins (myloans_api_query.sql). */
export function feedStateOf(t: MockTxn): FeedState {
  if (t.statusId === 14) return "Cancelled";
  // In myloans a redone copy gets the "x<timestamp>" code (longer than 20); replacedBy marks it here too.
  if (t.replacedBy || (t.code?.length ?? 0) > 20) return "Superseded";
  if (!isAcceptedStatus(t.statusId)) return "NotReleased"; // lib/myloans/status.ts knows the one released status
  if (t.isActive === 0) return "Inactive";
  return "Released";
}

const ms = (iso: string) => new Date(iso).getTime();

/** SourceUpdatedAt, round 3: the latest of updated_at, the redo suffix time and the replacement's created_at. */
export function sourceUpdatedAtOf(t: MockTxn, db: MockDb): string {
  const rep = t.replacedBy ? db.txns.find((x) => x.id === t.replacedBy) : undefined;
  const times = [t.updatedAt, redoSuffixAt(t.code), rep ? rep.createdAt ?? rep.updatedAt : null].filter((x): x is string => !!x);
  return times.reduce((a, b) => (ms(b) > ms(a) ? b : a));
}

function rowOf(t: MockTxn, db: MockDb): FeedRow {
  const fs = feedStateOf(t);
  const p = db.products.find((x) => x.productId === t.productId) ?? null;
  const rep = t.replacedBy ? db.txns.find((x) => x.id === t.replacedBy) ?? null : null;
  const v: HashValues = {
    FeedState: fs, PNNo: t.pnNo, TransactionStatusId: t.statusId, TransactionIsActive: t.isActive, CIFNo: null, FirstName: null, MiddleName: null, LastName: null, Suffix: null,
    LoanID: t.id, LoanClass: 7, BorrowerCompanyName: null, TotalLoanAmount: t.amount, ReleaseDate: t.releaseDate, ProductCode: p?.productCode ?? null, BranchID: t.branchId, ReplacedByExternalLoanId: rep?.id ?? null,
  };
  return {
    externalLoanId: t.id, cin: t.cin, pnNo: t.pnNo, transactionStatusId: t.statusId, feedState: fs, isSelectable: fs === "Released" ? 1 : 0,
    replacedByExternalLoanId: rep?.id ?? null, replacedByPnNo: rep?.pnNo ?? null, productId: p?.productId ?? null, productCode: p?.productCode ?? null, productName: p?.name ?? null,
    branchCode: String(t.branchId), totalLoanAmount: t.amount, contentHash: hashOf(v), rowsForThisLoan: t.duplicate ? 2 : 1, sourceUpdatedAt: sourceUpdatedAtOf(t, db),
  };
}
const rowsOf = (t: MockTxn, db: MockDb) => (t.duplicate ? [rowOf(t, db), rowOf(t, db)] : [rowOf(t, db)]);

/** API 1: every row for the PN #. More than one row is 409 with all of them, whatever their states (round 3). */
export function api1(db: MockDb, pn: string): Api1Answer {
  const rows = db.txns.filter((t) => t.pnNo === pn).flatMap((t) => rowsOf(t, db));
  if (!rows.length) return { status: 404 };
  if (rows.length > 1) return { status: 409, body: { rows } };
  const r = rows[0];
  if (r.isSelectable === 1) return { status: 200, body: r };
  return { status: 422, body: { transactionStatusId: r.transactionStatusId, feedState: r.feedState, replacedByPnNo: r.replacedByPnNo } };
}

/** API 2: ever-released loans whose SourceUpdatedAt is after `since`, any FeedState; pages cut by LOAN after `afterId`. */
export function api2(db: MockDb, since: string, afterId: number, pageSize: number): FeedPage {
  const loans = db.txns
    .filter((t) => t.releaseDate !== null && ms(sourceUpdatedAtOf(t, db)) > ms(since) && t.id > afterId)
    .sort((a, b) => a.id - b.id)
    .slice(0, pageSize);
  return { runStartedAt: db.now, items: loans.flatMap((t) => rowsOf(t, db)), nextAfterId: loans.length === pageSize ? loans[loans.length - 1].id : null };
}

/** API 5: the full product list (no "since"). */
export const api5 = (db: MockDb): ProductRow[] => db.products.map((p) => ({ ...p }));

// ---------------------------------------------------------------------------
// Scenarios (fake data)
// ---------------------------------------------------------------------------

const T0 = "2026-11-17T08:00:00+08:00";
const LATER = "2026-11-17T09:00:00+08:00";
/** A 20-character transaction code, and the same code once redone at a Manila time (yyyymmddhhmmss). */
export const codeOf = (id: number) => `TXN-FAKE-${String(id).padStart(11, "0")}`;
export const redoneCode = (id: number, at: string) => `${codeOf(id)}x${at}`;
const base = (id: number, extra: Partial<MockTxn> = {}): MockTxn => ({
  id, cin: `CIN-FAKE-${id}`, pnNo: `GD99900000${String(id).padStart(5, "0")}`, statusId: 12, isActive: 1, productId: 1, branchId: 165,
  amount: "250000.00", releaseDate: "2026-11-02T10:30:00+08:00", updatedAt: LATER, code: codeOf(id), ...extra,
});

export function scenarioDb(): MockDb {
  return {
    now: "2026-11-17T09:30:00.0000000+08:00",
    products: [{ productId: 1, productCode: "01-AUTO", name: "Auto Loan", active: true }, { productId: 2, productCode: "01-PDL", name: "Personal Loan", active: true }],
    txns: [
      base(101), base(102), base(103),
      // A page cut by loan with a duplicate row (both rows on the same page).
      base(104, { duplicate: true }),
      // 409 on API 1: two transactions share one PN #; only one is selectable.
      base(105, { pnNo: "GD9990000099905" }), base(106, { pnNo: "GD9990000099905", statusId: 14 }),
      // Redo chain of 3 on one CIN: 201 -> 202 -> 203 (203 is live, created LATER). Round 3: the OLDEST copy (201,
      // updated and suffixed at T0) is re-sent, because the replacement's created_at moves its SourceUpdatedAt.
      base(201, { cin: "CIN-FAKE-CHAIN", replacedBy: 203, updatedAt: T0, createdAt: T0, code: redoneCode(201, "20261117080000") }),
      base(202, { cin: "CIN-FAKE-CHAIN", replacedBy: 203, updatedAt: T0, createdAt: T0, code: redoneCode(202, "20261117090000") }),
      base(203, { cin: "CIN-FAKE-CHAIN", createdAt: LATER }),
      // NotReleased in API 2: an ever-released loan whose status left 12.
      base(301, { statusId: 18 }),
      // Redo WITHOUT cancellation (round 3, transaction 51164's case): 401 stays status 12 and its updated_at stays
      // at T0; its replacement 402 was created at T0 too. Only the suffix time (09:00) is after the checkpoint.
      base(401, { cin: "CIN-FAKE-REDO", replacedBy: 402, updatedAt: T0, createdAt: T0, code: redoneCode(401, "20261117090000") }),
      base(402, { cin: "CIN-FAKE-REDO", updatedAt: T0, createdAt: T0 }),
    ],
  };
}

/** The product rename that flips the classification: "Auto Loan" (default) becomes "Auto Refinancing". */
export function renameProduct(db: MockDb, productId: number, name: string): MockDb {
  return { ...db, products: db.products.map((p) => (p.productId === productId ? { ...p, name } : p)) };
}
