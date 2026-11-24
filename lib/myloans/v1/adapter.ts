import type { ListBranchesOptions, MyLoansAdapter, MyLoansBranches, MyLoansChanged, MyLoansLookup, MyLoansRecord, MyLoansSearch, SourceCapabilities } from "@/lib/myloans/types";
import { UNAVAILABLE_MESSAGE } from "@/lib/myloans/types";
import { composeBorrowerName } from "@/lib/myloans/borrower-name";
import { statusFromId } from "@/lib/myloans/status";
import { feedStateWords } from "@/lib/myloans/r2/contract";
import type { MyLoansClientV1, V1Fail } from "./client";
import type { FeedRowV1 } from "./schema";

/**
 * Piece 10a (D-050): Find loan and Refresh read API 1 through the contract client. This adapter gives the rest of the
 * DMS the record it already uses (MyLoansRecord), built only from the agreed columns. Fields the contract does not send
 * (vehicle, previous PN, payment recorded; D-051) are listed in `notSent`, so a Refresh never reads
 * their absence as a change. API 1 422 and 409 come back in plain words (FeedState, "Replaced by", "Multiple records").
 * Retries, Retry-After, the breaker and the hourly count stay in ResilientAdapter and lookupPn, as before.
 */
export const NOT_SENT: NonNullable<MyLoansRecord["notSent"]> = ["vehicle", "previousPn", "paymentRecorded"];
const LOAN_TYPE: Record<string, string> = { "1": "New", "2": "Renewal" };

/** A released loan as the DMS keeps it, from one API row. The release date becomes the Manila date. */
export function recordOfRow(r: FeedRowV1): MyLoansRecord {
  const st = statusFromId(r.transactionStatusId);
  const id = (v: number | string | null) => (v === null || v === undefined ? null : String(v));
  return {
    pn: r.pnNo ?? "",
    cin: r.cin, cif: r.cifNo, sourceLoanId: id(r.loanId),
    borrowerName: composeBorrowerName({ first: r.firstName, middle: r.middleName, last: r.lastName, suffix: r.suffix, company: r.borrowerCompanyName }),
    branchName: r.branchName, branchCode: r.branchCode,
    ...st,
    loanType: r.loanType ?? (r.loanTypeId !== null ? LOAN_TYPE[String(r.loanTypeId)] ?? null : null),
    productName: r.productName, productCode: r.productCode,
    totalReleasedAmount: r.totalLoanAmount,
    releaseDate: r.releaseDate ? r.releaseDate.slice(0, 10) : null, // already +08:00: the date part is the Manila date
    areaId: id(r.areaId), areaName: r.areaName, divisionId: id(r.divisionId), divisionName: r.divisionName, companyId: id(r.companyId), companyName: r.companyName,
    isActive: r.transactionIsActive === 1 || r.transactionIsActive === true,
    sourceUpdatedAt: r.sourceUpdatedAt,
    externalLoanId: r.externalLoanId, contentHash: r.contentHash, feedState: r.feedState, myloansBranchId: r.branchId ?? null,
    notSent: NOT_SENT,
  };
}

function failed(f: V1Fail): MyLoansLookup {
  if (f.kind === "busy") return { ok: false, reason: "UNAVAILABLE", message: f.message, retryAfterMs: f.retryAfterMs };
  return { ok: false, reason: "UNAVAILABLE", message: f.kind === "unavailable" ? UNAVAILABLE_MESSAGE : f.message };
}

export interface ContractAdapterOptions {
  client: () => MyLoansClientV1;
  name: "mock" | "live";
  /** Settings, System, "Simulate MyLoans unavailable" (mock only). */
  isUnavailable?: () => Promise<boolean> | boolean;
  /** The branch list until piece 11 reads API 4 (the old source keeps working meanwhile). */
  branchSource?: Pick<MyLoansAdapter, "listBranches" | "capabilities">;
  /** Several records for one PN with one selectable: Admin is told (D-036 item 4). */
  onMultiple?: (pn: string, rows: FeedRowV1[]) => Promise<void> | void;
}

export class ContractMyLoansAdapter implements MyLoansAdapter {
  readonly name: "mock" | "live";
  readonly capabilities: SourceCapabilities;
  constructor(private readonly o: ContractAdapterOptions) {
    this.name = o.name;
    // No partial search and no changed-since in the contract's API 1; the background refresh reads PN by PN until
    // piece 7 moves it to API 2.
    // Changed-since reads API 2 (the background run's feed mode until piece 7 brings the full sync on API 2).
    // Piece 11 (D-054): the branch list is API 4, the whole list every time (no "updated since").
    this.capabilities = { search: false, changedSince: true, branches: true, branchesUpdatedSince: false };
  }

  async getByPn(pn: string): Promise<MyLoansLookup> {
    if (await this.o.isUnavailable?.()) return { ok: false, reason: "UNAVAILABLE", message: UNAVAILABLE_MESSAGE };
    const r = await this.o.client().api1(pn);
    if (!r.ok) return failed(r);
    const a = r.data;
    const retrievedAt = new Date();
    switch (a.status) {
      // The saved copy keeps the record the DMS reads ({ loan }) and the API row as it came ({ contract }).
      case 200: { const record = recordOfRow(a.row); return { ok: true, record, raw: { loan: record, contract: a.row }, adapter: this.name, retrievedAt }; }
      case 404: return { ok: false, reason: "NOT_FOUND", message: "PN not found in myloans. Check the number." };
      case 422: return {
        ok: false, reason: "NOT_SELECTABLE", feedState: a.feedState, statusId: a.transactionStatusId, replacedByPnNo: a.replacedByPnNo,
        message: `${feedStateWords(a.feedState)}${a.replacedByPnNo ? ` Replaced by ${a.replacedByPnNo}.` : ""}`,
      };
      case 409: {
        const selectable = a.rows.filter((x) => x.isSelectable === 1);
        await this.o.onMultiple?.(pn, a.rows);
        if (selectable.length === 1) { const record = recordOfRow(selectable[0]); return { ok: true, record, raw: { loan: record, contract: { rows: a.rows } }, adapter: this.name, retrievedAt }; }
        return { ok: false, reason: "MULTIPLE", message: "Multiple records in myloans, contact Admin." };
      }
    }
  }

  async search(): Promise<MyLoansSearch> {
    return { ok: false, reason: "UNSUPPORTED", message: "Type the full PN." };
  }

  /** API 2 from `since` (fixed for the run), every page, at most `limit` loans; only selectable rows become records. */
  async getChangedSince(since: Date, limit: number): Promise<MyLoansChanged> {
    if (await this.o.isUnavailable?.()) return { ok: false, reason: "UNAVAILABLE", message: UNAVAILABLE_MESSAGE };
    const c = this.o.client();
    const records: MyLoansRecord[] = [];
    let afterId = 0;
    let until: Date | null = null;
    for (let page = 0; page < 1000 && records.length < limit; page++) {
      const p = await c.changesPage({ since: since.toISOString(), afterId, limit: Math.min(500, limit) });
      if (!p.ok) return { ok: false, reason: "UNAVAILABLE", message: p.kind === "unavailable" ? UNAVAILABLE_MESSAGE : p.message, ...(p.kind === "busy" ? { retryAfterMs: p.retryAfterMs } : {}) };
      until ??= new Date(p.data.runStartedAt);
      for (const r of p.data.items) if (r.isSelectable === 1 && r.pnNo && !records.some((x) => x.pn === r.pnNo)) records.push(recordOfRow(r));
      if (p.data.nextAfterId === null) break;
      afterId = p.data.nextAfterId;
    }
    return { ok: true, records: records.slice(0, limit), until: until ?? new Date() };
  }

  /** API 4 (piece 11, D-054): myloans' branch list with each BranchID; one page here, cut into the caller's pages. */
  async listBranches(o: ListBranchesOptions): Promise<MyLoansBranches> {
    if (await this.o.isUnavailable?.()) return { ok: false, reason: "UNAVAILABLE", message: UNAVAILABLE_MESSAGE };
    const r = await this.o.client().branches();
    if (!r.ok) return { ok: false, reason: "UNAVAILABLE", message: r.kind === "unavailable" ? UNAVAILABLE_MESSAGE : r.message, ...(r.kind === "busy" ? { retryAfterMs: r.retryAfterMs } : {}) };
    const rows = r.data.items.filter((b) => b.branchCode).map((b) => ({
      branchId: b.branchId, code: b.branchCode!, name: b.branchName, areaId: b.areaId, areaName: b.areaName ?? "", divisionId: b.divisionId, divisionName: b.divisionName ?? "",
      address: "", active: b.isActive === 1 || b.isActive === true, updatedAt: b.updatedAt,
    }));
    const start = (o.page - 1) * o.pageSize;
    return { ok: true, branches: rows.slice(start, start + o.pageSize), nextPage: start + o.pageSize < rows.length ? o.page + 1 : null };
  }
}
