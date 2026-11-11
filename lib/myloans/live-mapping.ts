import type { MyLoansHit, MyLoansRecord, SourceCapabilities } from "./types";
import type { MyLoansBranchRow } from "@/lib/branches/file";
import { composeBorrowerName } from "./borrower-name";
import { statusFromId } from "./status";

/**
 * MyLoans LIVE MAPPING: the one place that knows MyLoans names.
 *
 * The loan fields follow the column aliases the MyLoans team gave (their source query, kept for reference
 * in docs/myloans/released-loans-source.sql). The paths, the response shapes, the status names and the
 * branch list are still PLACEHOLDERS TO CONFIRM. The rest of the DMS uses the normalized MyLoansRecord and does not
 * change. The address and key come only from MYLOANS_BASE_URL and MYLOANS_API_KEY (server env).
 */
export const LIVE_CAPABILITIES: SourceCapabilities = {
  // TO CONFIRM: does MyLoans offer a partial PN / borrower search with a result limit?
  search: false,
  // TO CONFIRM: does MyLoans offer "loans changed since <time>"?
  changedSince: false,
  // TO CONFIRM (MyLoans team): an endpoint listing branches (id, code, name, area, division, status,
  // address, updatedAt). Until then branches come from Import from MyLoans (a file).
  branches: false,
  // TO CONFIRM: can that endpoint return only the branches changed since a time (updated since)?
  branchesUpdatedSince: false,
};

/** TO CONFIRM: paths. Each returns a relative path (query included) under MYLOANS_BASE_URL. */
export const LIVE_PATHS = {
  byPn: (pn: string) => `/loans/${encodeURIComponent(pn)}`,
  search: (q: string, limit: number) => `/loans?q=${encodeURIComponent(q)}&limit=${limit}`,
  changedSince: (since: Date, limit: number) => `/loans/changes?since=${encodeURIComponent(since.toISOString())}&limit=${limit}`,
  /** TO CONFIRM: the branch list, paged, optionally only those updated since a time. */
  branches: (page: number, pageSize: number, updatedSince: Date | null) => `/branches?page=${page}&pageSize=${pageSize}${updatedSince ? `&updatedSince=${encodeURIComponent(updatedSince.toISOString())}` : ""}`,
};

const s = (v: unknown) => (v === undefined || v === null ? null : String(v));

/**
 * One released loan as MyLoans gives it. The names are the column aliases of the MyLoans team's source
 * query (docs/myloans/released-loans-source.sql: the definition of the read-only view behind the API; the
 * DMS never runs it and never connects to MyLoans' databases). The older placeholder names are read only
 * when an alias is absent. Keep raw values (do not coerce or default): the Data Check must see bad data
 * as bad. Never reads BirthDate or TitleId. Returns null when the payload is not a loan.
 */
export function mapLoan(raw: unknown): MyLoansRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const pn = s(r.PNNo ?? r.pnNumber ?? r.pn);
  if (!pn) return null;
  // Status: the id (TransactionStatusId) and, once MyLoans adds it, the name (TransactionStatusName: TO CONFIRM).
  const st = r.TransactionStatusId !== undefined && r.TransactionStatusId !== null
    ? statusFromId(r.TransactionStatusId, r.TransactionStatusName)
    : { status: s(r.status), statusId: null, statusName: s(r.TransactionStatusName) };
  const hasParts = ["FirstName", "MiddleName", "LastName", "Suffix", "BorrowerCompanyName"].some((k) => r[k] !== undefined);
  const active = r.TransactionIsActive;
  return {
    pn,
    cin: s(r.CIN ?? r.cin),
    cif: s(r.CIFNo ?? r.cif),
    sourceLoanId: s(r.ExternalLoanId ?? r.loanId ?? r.id),
    borrowerName: hasParts
      ? composeBorrowerName({ first: r.FirstName, middle: r.MiddleName, last: r.LastName, suffix: r.Suffix, company: r.BorrowerCompanyName })
      : s(r.borrowerName) ?? "",
    branchName: s(r.BranchName ?? r.branchName),
    branchCode: s(r.BranchCode ?? r.branchCode),
    status: st.status,
    statusId: st.statusId,
    statusName: st.statusName,
    isActive: active === undefined || active === null ? null : /^(1|true|yes)$/i.test(String(active)),
    loanType: s(r.LoanType ?? r.loanType),
    productName: s(r.ProductName ?? r.productName),
    productCode: s(r.ProductCode ?? r.productCode),
    totalReleasedAmount: (r.TotalLoanAmount ?? r.totalReleasedAmount ?? null) as number | string | null,
    releaseDate: s(r.ReleaseDate ?? r.releaseDate)?.slice(0, 10) ?? null,
    areaId: s(r.AreaId), areaName: s(r.AreaName),
    divisionId: s(r.DivisionId), divisionName: s(r.DivisionName),
    companyId: s(r.CompanyID), companyName: s(r.CompanyName),
    sourceUpdatedAt: s(r.SourceUpdatedAt),
    // Not in the source query (field-map question 6): optional until MyLoans says where they are.
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
  return items.map(mapLoan).filter((x): x is MyLoansRecord => !!x).map((r) => ({ pn: r.pn, borrowerName: r.borrowerName, status: r.status, releaseDate: r.releaseDate, branchName: r.branchName, branchCode: r.branchCode }));
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

/**
 * TO CONFIRM (MyLoans team): one branch as the API returns it. Fields to fill: a stable branch id (and
 * whether it stays the same when the code changes), code, name, area (id and name), division (id and
 * name), status (active or inactive), address, updatedAt. Matching uses the ids first.
 * The unknown 8-digit column of the database export is not wanted here.
 */
export function mapBranch(raw: unknown): MyLoansBranchRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown) => (v === undefined || v === null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
  const code = s(r.code ?? r.branchCode ?? r.branch_code)?.trim() ?? "";
  const name = s(r.name ?? r.branchName ?? r.branch_name)?.trim() ?? "";
  if (!/^[1-9][0-9]{2}$/.test(code) || !name) return null;
  const status = s(r.status ?? r.isActive ?? r.is_active);
  return {
    branchId: num(r.id ?? r.branchId ?? r.branch_id), code, name, address: s(r.address)?.trim() ?? "",
    areaId: num(r.areaId ?? r.area_id), areaName: s(r.areaName ?? r.area_name ?? r.area)?.trim() ?? "",
    divisionId: num(r.divisionId ?? r.division_id), divisionName: s(r.divisionName ?? r.division_name ?? r.division)?.trim() ?? "",
    active: status === null ? null : /^(1|true|active|yes)$/i.test(status),
    updatedAt: s(r.updatedAt ?? r.updated_at),
  };
}

/** TO CONFIRM: the branch list response shape ({ items: [...], nextPage } assumed). */
export function mapBranches(raw: unknown): { rows: MyLoansBranchRow[]; nextPage: number | null } {
  const o = (raw ?? {}) as { items?: unknown[]; nextPage?: number | null };
  const items = o.items ?? (Array.isArray(raw) ? raw : []);
  return { rows: items.map(mapBranch).filter((x): x is MyLoansBranchRow => !!x), nextPage: typeof o.nextPage === "number" ? o.nextPage : null };
}
