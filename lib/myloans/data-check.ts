import { isValidLoanType, type LoanTypeValue } from "@/lib/rules";
import type { MyLoansRecord } from "./types";

/**
 * Data Check (prompt section 5.1). Pure. Runs before anything is saved.
 * The MyLoans "found" and "reachable" checks happen in the adapter; this covers the record itself.
 */

export interface DataCheckContext {
  /** Branch names the user may act on. `null` means all branches (no branch restriction). */
  allowedBranchNames: string[] | null;
  /** Today's date (YYYY-MM-DD, business time zone). */
  today: string;
}

export type DataCheckField = "branch" | "status" | "releaseDate" | "loanType" | "totalReleasedAmount";

export interface DataCheckFailure {
  ok: false;
  field: DataCheckField;
  fieldLabel: string;
  message: string;
}

export interface DataCheckPass {
  ok: true;
  normalized: {
    loanType: LoanTypeValue;
    totalReleasedAmount: number;
    releaseDate: string;
    productName: string;
  };
}

export type DataCheckResult = DataCheckPass | DataCheckFailure;

const fail = (field: DataCheckField, fieldLabel: string, message: string): DataCheckFailure => ({
  ok: false,
  field,
  fieldLabel,
  message,
});

export function parseAmount(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function runDataCheck(record: MyLoansRecord, ctx: DataCheckContext): DataCheckResult {
  // Branch
  if (ctx.allowedBranchNames !== null) {
    const allowed = ctx.allowedBranchNames.map((b) => b.toLowerCase());
    if (!record.branchName || !allowed.includes(record.branchName.toLowerCase())) {
      return fail("branch", "Branch", "Outside your branch access.");
    }
  }
  // Source status
  if ((record.status ?? "").toUpperCase() !== "RELEASED") {
    return fail("status", "Source status", `Not yet released. MyLoans status is ${record.status ? `"${record.status}"` : "blank"}.`);
  }
  // Release date
  if (!record.releaseDate || !/^\d{4}-\d{2}-\d{2}$/.test(record.releaseDate)) {
    return fail("releaseDate", "Release date", "Release date is missing in MyLoans.");
  }
  if (record.releaseDate > ctx.today) {
    return fail("releaseDate", "Release date", `Release date ${record.releaseDate} is in the future.`);
  }
  // Loan Type
  if (!isValidLoanType(record.loanType)) {
    return fail(
      "loanType",
      "Loan Type",
      `Loan Type must be exactly "New" or "Renewal" (MyLoans has ${record.loanType ? `"${record.loanType}"` : "blank"}).`,
    );
  }
  // Amount
  const amount = parseAmount(record.totalReleasedAmount);
  if (amount === null || amount <= 0) {
    return fail("totalReleasedAmount", "Total Released Amount", "Total Released Amount must be a number above 0.");
  }
  // Product Name may be blank: never fails.
  return {
    ok: true,
    normalized: {
      loanType: record.loanType,
      totalReleasedAmount: amount,
      releaseDate: record.releaseDate,
      productName: (record.productName ?? "").trim(),
    },
  };
}
