import { BUILTIN_BRANCHES } from "@/lib/branches/builtin";
import type { MyLoansRecord } from "./types";
import { recordStatusKind, releasedStatus } from "./status";

/**
 * The sample MyLoans only: fills the account details a sample record leaves out (product code, area,
 * division, company, status id and name, active, last updated), so every sample looks like a real
 * MyLoans answer. Area and division come from the built-in MyLoans branch list by branch code. A value the
 * record already has (a test, the simulator) is kept, including an empty one.
 */
const PRODUCT_CODES: Record<string, string> = {
  "auto financing": "AF-001",
  "auto finance": "AF-002",
  "auto refinancing": "ARF-001",
  "truck financing": "TF-001",
  "truck refinancing": "TRF-001",
};
export const SAMPLE_COMPANY = { companyId: "1", companyName: "Global Dominion Financing Inc." } as const;

export function productCodeFor(name: string | null | undefined): string | null {
  const n = (name ?? "").trim().toLowerCase();
  if (!n) return null;
  return PRODUCT_CODES[n] ?? `${n.split(/\s+/).map((w) => w[0]!.toUpperCase()).join("")}-900`;
}

export function completeSample(r: MyLoansRecord): MyLoansRecord {
  const br = BUILTIN_BRANCHES.find((b) => b.code === r.branchCode?.trim());
  const released = recordStatusKind({ status: r.status }) === "released";
  const has = (k: keyof MyLoansRecord) => r[k] !== undefined;
  return {
    ...r,
    ...(has("productCode") ? {} : { productCode: productCodeFor(r.productName) }),
    ...(has("areaId") ? {} : { areaId: br ? String(br.areaId) : null }),
    ...(has("areaName") ? {} : { areaName: br?.areaName || null }),
    ...(has("divisionId") ? {} : { divisionId: br ? String(br.divisionId) : null }),
    ...(has("divisionName") ? {} : { divisionName: br?.divisionName || null }),
    ...(has("companyId") ? {} : { companyId: SAMPLE_COMPANY.companyId }),
    ...(has("companyName") ? {} : { companyName: SAMPLE_COMPANY.companyName }),
    // A status changed by the simulator (CANCELLED...) has no MyLoans id here: the name is the word.
    ...(has("statusId") ? {} : { statusId: released ? releasedStatus().statusId : null }),
    ...(has("statusName") ? {} : { statusName: released ? releasedStatus().statusName : null }),
    ...(has("isActive") ? {} : { isActive: true }),
    ...(has("sourceUpdatedAt") ? {} : { sourceUpdatedAt: r.releaseDate ? `${r.releaseDate}T17:00:00+08:00` : null }),
  };
}
