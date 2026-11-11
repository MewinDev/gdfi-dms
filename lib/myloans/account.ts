import type { MyLoansRecord } from "./types";
import { SOURCE_NAME } from "./types";

const txt = (v: unknown) => (v === undefined || v === null || String(v).trim() === "" ? null : String(v).trim());

/** A MyLoans time (SourceUpdatedAt) as a date, or null when it is missing or not a time. */
export function sourceTime(v: unknown): Date | null {
  const t = txt(v);
  if (!t) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The account-detail columns of a loan file (Loan.source...), from a MyLoans answer, kept as given.
 * The DMS branch (branchId, used for access) is set elsewhere and never from these.
 */
export function accountColumns(r: MyLoansRecord) {
  return {
    source: SOURCE_NAME,
    productCode: txt(r.productCode),
    sourceBranchCode: txt(r.branchCode),
    sourceBranchName: txt(r.branchName),
    sourceAreaId: txt(r.areaId),
    sourceAreaName: txt(r.areaName),
    sourceDivisionId: txt(r.divisionId),
    sourceDivisionName: txt(r.divisionName),
    sourceCompanyId: txt(r.companyId),
    sourceCompanyName: txt(r.companyName),
    sourceStatusId: txt(r.statusId),
    sourceStatusName: txt(r.statusName),
    sourceIsActive: r.isActive ?? null,
    sourceUpdatedAt: sourceTime(r.sourceUpdatedAt),
  };
}

/** The minor (display) account fields and their loan column: changes copy straight onto the loan file. */
export const MINOR_ACCOUNT_COLUMNS = {
  areaId: "sourceAreaId", areaName: "sourceAreaName",
  divisionId: "sourceDivisionId", divisionName: "sourceDivisionName",
  companyId: "sourceCompanyId", companyName: "sourceCompanyName",
} as const;

/**
 * Feed quality (Admin): the 15 account items and, for a loan file, whether MyLoans gave it. Missing
 * product, area, division or company are warnings only; they never stop a loan file from opening.
 */
export const ACCOUNT_ITEMS = [
  { key: "pn", label: "PN" },
  { key: "sourceLoanId", label: "Source loan ID" },
  { key: "cin", label: "CIN" },
  { key: "cif", label: "CIF" },
  { key: "borrowerName", label: "Borrower name" },
  { key: "totalReleasedAmount", label: "Amount released" },
  { key: "releasedAt", label: "Released date" },
  { key: "loanType", label: "Loan type" },
  { key: "product", label: "Product name and code" },
  { key: "branch", label: "Branch code and name" },
  { key: "area", label: "Area ID and name" },
  { key: "division", label: "Division ID and name" },
  { key: "company", label: "Company ID and name" },
  { key: "status", label: "Status ID and name" },
  { key: "source", label: "Source" },
] as const;

/** Warnings for Admin's data check: present-but-empty account details that do not block opening. */
export function accountWarnings(r: MyLoansRecord): string[] {
  const w: string[] = [];
  if (!txt(r.productName)) w.push("Product name is empty.");
  if (!txt(r.productCode)) w.push("Product code is empty.");
  if (!txt(r.areaId) || !txt(r.areaName)) w.push("Area is missing.");
  if (!txt(r.divisionId) || !txt(r.divisionName)) w.push("Division is missing.");
  if (!txt(r.companyId) || !txt(r.companyName)) w.push("Company is missing.");
  return w;
}
