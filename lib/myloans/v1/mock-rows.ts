import { hashOf, type HashValues } from "@/lib/myloans/r2/hash";
import { feedStateOf, sourceUpdatedAtOf, type MockDb, type MockTxn } from "@/lib/myloans/r2/mock";
import type { FeedRowV1 } from "./schema";

/**
 * Piece 6: the myloans mock's answers, built from its own rows (MockMyLoansTxn, MockMyLoansProduct, MockMyLoansBranch).
 * Pure: the route handler loads the rows and calls these. FeedState, freshness and the hash follow round 3
 * (lib/myloans/r2), with every column of the agreed query.
 */

export interface MockTxnRow {
  id: number; cin: string | null; pnNo: string | null; statusId: number; isActive: boolean; code: string;
  updatedAt: Date; createdAt: Date; replacedById: number | null; duplicate: boolean; releaseDate: Date | null; amount: string | null;
  cifNo: string | null; firstName: string | null; middleName: string | null; lastName: string | null; suffix: string | null;
  loanId: string | null; loanTypeId: string | null; loanType: string | null; borrowerCompanyName: string | null; productId: number | null; branchId: number | null;
}
export interface MockProductRow { productId: number; productCode: string; name: string; active: boolean }
export interface MockBranchRow {
  branchId: number; branchCode: string | null; branchName: string; areaId: number | null; areaName: string | null; divisionId: number | null; divisionName: string | null;
  companyId: number | null; companyName: string | null; isActive: boolean; updatedAt: Date | null;
}
export interface MockData { txns: MockTxnRow[]; products: MockProductRow[]; branches: MockBranchRow[] }

/** A datetimeoffset in +08:00 (as myloans sends it): "2026-11-17T09:30:00.000+08:00". */
export function pht(d: Date): string {
  const t = new Date(d.getTime() + 8 * 3_600_000).toISOString().replace("Z", "");
  return `${t}+08:00`;
}
/** SQL style 126 of a +08:00 value, as the hash input has it (no fraction when it is zero). */
const style126 = (d: Date | null) => (d ? pht(d).replace(".000+", "+") : null);

const asR2 = (t: MockTxnRow): MockTxn => ({
  id: t.id, cin: t.cin ?? "", pnNo: t.pnNo ?? "", statusId: t.statusId, isActive: t.isActive ? 1 : 0, productId: t.productId ?? 0, branchId: t.branchId ?? 0,
  amount: t.amount ?? "", releaseDate: t.releaseDate ? pht(t.releaseDate) : null, updatedAt: pht(t.updatedAt), createdAt: pht(t.createdAt),
  replacedBy: t.replacedById ?? undefined, code: t.code, duplicate: t.duplicate,
});

/** One request's view of the mock data (built once): the round 3 rows and lookups by id. */
export interface MockView { data: MockData; r2: MockDb; byId: Map<number, MockTxnRow>; runStartedAt: string }
export function viewOf(data: MockData, runStartedAt: string): MockView {
  return { data, r2: { txns: data.txns.map(asR2), products: [], now: runStartedAt }, byId: new Map(data.txns.map((t) => [t.id, t])), runStartedAt };
}

export function feedRowsOf(t: MockTxnRow, view: MockView): FeedRowV1[] {
  const { data, r2: db, runStartedAt } = view;
  const r2 = asR2(t);
  const fs = feedStateOf(r2);
  const p = data.products.find((x) => x.productId === t.productId) ?? null;
  const b = data.branches.find((x) => x.branchId === t.branchId) ?? null;
  const rep = t.replacedById ? view.byId.get(t.replacedById) ?? null : null;
  const v: HashValues = {
    FeedState: fs, PNNo: t.pnNo, TransactionStatusId: t.statusId, TransactionIsActive: t.isActive ? 1 : 0, CIFNo: t.cifNo, FirstName: t.firstName, MiddleName: t.middleName,
    LastName: t.lastName, Suffix: t.suffix, LoanID: t.loanId, LoanClass: t.loanTypeId, BorrowerCompanyName: t.borrowerCompanyName, TotalLoanAmount: t.amount,
    ReleaseDate: style126(t.releaseDate), ProductCode: p?.productCode ?? null, BranchID: t.branchId, ReplacedByExternalLoanId: rep?.id ?? null,
  };
  const row: FeedRowV1 = {
    runStartedAt,
    externalLoanId: t.id, cin: t.cin, pnNo: t.pnNo, transactionStatusId: t.statusId, transactionIsActive: t.isActive ? 1 : 0, feedState: fs, isSelectable: fs === "Released" ? 1 : 0,
    replacedByExternalLoanId: rep?.id ?? null, replacedByPnNo: rep?.pnNo ?? null,
    cifNo: t.cifNo, firstName: t.firstName, middleName: t.middleName, lastName: t.lastName, suffix: t.suffix,
    loanId: t.loanId, loanTypeId: t.loanTypeId, loanType: t.loanType, borrowerCompanyName: t.borrowerCompanyName,
    totalLoanAmount: t.amount, releaseDate: t.releaseDate ? pht(t.releaseDate) : null,
    productId: p?.productId ?? null, productCode: p?.productCode ?? null, productName: p?.name ?? null,
    companyId: b?.companyId ?? null, companyName: b?.companyName ?? null, divisionId: b?.divisionId ?? null, divisionName: b?.divisionName ?? null,
    areaId: b?.areaId ?? null, areaName: b?.areaName ?? null, branchId: t.branchId, branchCode: b?.branchCode ?? null, branchName: b?.branchName ?? null,
    sourceUpdatedAt: sourceUpdatedAtOf(r2, db), contentHash: hashOf(v), rowsForThisLoan: t.duplicate ? 2 : 1,
  };
  return t.duplicate ? [row, { ...row }] : [row];
}

export type Api1Http =
  | { status: 404; body: { error: string } }
  | { status: 422; body: { transactionStatusId: number; feedState: FeedRowV1["feedState"]; replacedByPnNo: string | null } }
  | { status: 200; body: FeedRowV1 }
  | { status: 409; body: { rows: FeedRowV1[] } };

/** API 1: every row for the PN #; more than one row is 409 with all of them (round 3). */
export function api1Of(data: MockData, pn: string, runStartedAt: string): Api1Http {
  const view = viewOf(data, runStartedAt);
  const rows = data.txns.filter((t) => t.pnNo === pn).sort((a, b) => a.id - b.id).flatMap((t) => feedRowsOf(t, view));
  if (!rows.length) return { status: 404, body: { error: "Not found" } };
  if (rows.length > 1) return { status: 409, body: { rows } };
  const r = rows[0];
  if (r.isSelectable === 1) return { status: 200, body: r };
  return { status: 422, body: { transactionStatusId: r.transactionStatusId, feedState: r.feedState, replacedByPnNo: r.replacedByPnNo } };
}

const ms = (iso: string) => new Date(iso).getTime();

/**
 * API 2 (change mode, `since`) or the pool mode (`releasedSince`): loans after `afterId`, at most `limit` LOANS per
 * page (a duplicated loan's rows stay on one page). nextAfterId: the last loan's id on a full page, else null.
 */
export function feedPageOf(data: MockData, q: { since?: string | null; releasedSince?: string | null; afterId: number; limit: number }, runStartedAt: string) {
  const view = viewOf(data, runStartedAt);
  const loans = data.txns
    .filter((t) => t.id > q.afterId && t.releaseDate !== null)
    .filter((t) => {
      const r = asR2(t);
      if (q.since) return ms(sourceUpdatedAtOf(r, view.r2)) > ms(q.since);
      return feedStateOf(r) === "Released" && t.releaseDate!.getTime() >= ms(q.releasedSince!);
    })
    .sort((a, b) => a.id - b.id)
    .slice(0, q.limit);
  return {
    runStartedAt,
    items: loans.flatMap((t) => feedRowsOf(t, view)),
    nextAfterId: loans.length === q.limit && loans.length > 0 ? loans[loans.length - 1].id : null,
  };
}

export const branchesOf = (data: MockData) => ({
  items: [...data.branches].sort((a, b) => a.branchId - b.branchId).map((b) => ({
    branchId: b.branchId, branchCode: b.branchCode, branchName: b.branchName, areaId: b.areaId, areaName: b.areaName, divisionId: b.divisionId, divisionName: b.divisionName,
    companyId: b.companyId, companyName: b.companyName, isActive: b.isActive ? 1 as const : 0 as const, updatedAt: b.updatedAt ? pht(b.updatedAt) : null,
  })),
});
export const productsOf = (data: MockData) => ({ items: [...data.products].sort((a, b) => a.productId - b.productId).map((p) => ({ ...p })) });
