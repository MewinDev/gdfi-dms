import type { Api1Answer, FeedPage, FeedRow, FeedState, ProductRow } from "./contract";
import { hashOf, type HashValues } from "./hash";

/**
 * In-memory mock of the myloans APIs, round 2 contract (D-036). Fake data only (GD999... PNs). The hash is the
 * real formula (SHA-256, UTF-16LE, 18 fields) so a change in any hashed field changes it, exactly as in myloans.
 */

export interface MockTxn {
  id: number; cin: string; pnNo: string; statusId: number; isActive: 0 | 1; productId: number; branchId: number;
  amount: string; releaseDate: string | null; updatedAt: string;
  /** The live transaction that replaced this one (redo). */
  replacedBy?: number;
  /** A duplicate LOANS.CIN row: the loan comes back twice. */
  duplicate?: boolean;
}

export interface MockDb { txns: MockTxn[]; products: ProductRow[]; now: string }

/** FeedState, first match wins (myloans_api_query.sql). */
export function feedStateOf(t: MockTxn): FeedState {
  if (t.statusId === 14) return "Cancelled";
  // In myloans a redone copy gets the "x<timestamp>" code (longer than 20): here, replacedBy marks it.
  if (t.replacedBy) return "Superseded";
  if (t.statusId !== 12) return "NotReleased";
  if (t.isActive === 0) return "Inactive";
  return "Released";
}

function rowOf(t: MockTxn, db: MockDb): FeedRow {
  const fs = feedStateOf(t);
  const p = db.products.find((x) => x.productId === t.productId) ?? null;
  const rep = t.replacedBy ? db.txns.find((x) => x.id === t.replacedBy) ?? null : null;
  const v: HashValues = {
    FeedState: fs, PNNo: t.pnNo, TransactionStatusId: t.statusId, TransactionIsActive: t.isActive, CIFNo: null, FirstName: null, MiddleName: null, LastName: null, Suffix: null,
    BirthDate: null, LoanID: t.id, LoanClass: 7, BorrowerCompanyName: null, TotalLoanAmount: t.amount, ReleaseDate: t.releaseDate, ProductCode: p?.productCode ?? null, BranchID: t.branchId, ReplacedByExternalLoanId: rep?.id ?? null,
  };
  return {
    externalLoanId: t.id, cin: t.cin, pnNo: t.pnNo, transactionStatusId: t.statusId, feedState: fs, isSelectable: fs === "Released" ? 1 : 0,
    replacedByExternalLoanId: rep?.id ?? null, replacedByPnNo: rep?.pnNo ?? null, productId: p?.productId ?? null, productCode: p?.productCode ?? null, productName: p?.name ?? null,
    branchCode: String(t.branchId), totalLoanAmount: t.amount, contentHash: hashOf(v), rowsForThisLoan: t.duplicate ? 2 : 1, sourceUpdatedAt: t.updatedAt,
  };
}
const rowsOf = (t: MockTxn, db: MockDb) => (t.duplicate ? [rowOf(t, db), rowOf(t, db)] : [rowOf(t, db)]);

/** API 1: every row for the PN #. */
export function api1(db: MockDb, pn: string): Api1Answer {
  const rows = db.txns.filter((t) => t.pnNo === pn).flatMap((t) => rowsOf(t, db));
  if (!rows.length) return { status: 404 };
  if (rows.length > 1) return { status: 409, body: { rows } };
  const r = rows[0];
  if (r.isSelectable === 1) return { status: 200, body: r };
  return { status: 422, body: { transactionStatusId: r.transactionStatusId, feedState: r.feedState, replacedByPnNo: r.replacedByPnNo } };
}

/** API 2: ever-released loans changed after `since`, any FeedState; pages cut by LOAN after `afterId`. */
export function api2(db: MockDb, since: string, afterId: number, pageSize: number): FeedPage {
  const loans = db.txns
    .filter((t) => t.releaseDate !== null && t.updatedAt > since && t.id > afterId)
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
const base = (id: number, extra: Partial<MockTxn> = {}): MockTxn => ({
  id, cin: `CIN-FAKE-${id}`, pnNo: `GD99900000${String(id).padStart(5, "0")}`, statusId: 12, isActive: 1, productId: 1, branchId: 165,
  amount: "250000.00", releaseDate: "2026-11-02T10:30:00+08:00", updatedAt: LATER, ...extra,
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
      // Redo chain of 3 on one CIN: 201 -> 202 -> 203 (203 is live); 201 is never re-sent (not updated).
      base(201, { cin: "CIN-FAKE-CHAIN", replacedBy: 203, updatedAt: T0 }), base(202, { cin: "CIN-FAKE-CHAIN", replacedBy: 203 }), base(203, { cin: "CIN-FAKE-CHAIN" }),
      // NotReleased in API 2: an ever-released loan whose status left 12.
      base(301, { statusId: 18 }),
    ],
  };
}

/** The product rename that flips the classification: "Auto Loan" (default) becomes "Auto Refinancing". */
export function renameProduct(db: MockDb, productId: number, name: string): MockDb {
  return { ...db, products: db.products.map((p) => (p.productId === productId ? { ...p, name } : p)) };
}
