import "server-only";
import { prisma } from "@/lib/db";
import { ACCOUNT_ITEMS } from "@/lib/myloans/account";

type Key = (typeof ACCOUNT_ITEMS)[number]["key"];

/**
 * Feed quality for Admin (Settings, MyLoans sync): of the loan files here, how many have each of the 15
 * MyLoans account items missing or empty. A two-part item (product, branch, area, division, company,
 * status) counts as missing when either part is. One query.
 */
export async function accountFeedQuality(): Promise<{ total: number; missing: { key: Key; label: string; count: number }[] }> {
  const e = (c: string) => `(${c} IS NULL OR btrim(${c}::text) = '')`;
  const cols: Record<Key, string> = {
    pn: e(`"pn"`), sourceLoanId: e(`"sourceLoanId"`), cin: e(`"cin"`), cif: e(`"cif"`), borrowerName: e(`"borrowerName"`),
    totalReleasedAmount: `("totalReleasedAmount" IS NULL OR "totalReleasedAmount" <= 0)`, releasedAt: `("releasedAt" IS NULL)`, loanType: e(`"loanType"`),
    product: `(${e(`"productName"`)} OR ${e(`"productCode"`)})`, branch: `(${e(`"sourceBranchCode"`)} OR ${e(`"sourceBranchName"`)})`,
    area: `(${e(`"sourceAreaId"`)} OR ${e(`"sourceAreaName"`)})`, division: `(${e(`"sourceDivisionId"`)} OR ${e(`"sourceDivisionName"`)})`,
    company: `(${e(`"sourceCompanyId"`)} OR ${e(`"sourceCompanyName"`)})`, status: `(${e(`"sourceStatusId"`)} OR ${e(`"sourceStatusName"`)})`, source: e(`"source"`),
  };
  const select = ACCOUNT_ITEMS.map((i) => `COUNT(*) FILTER (WHERE ${cols[i.key]})::int AS "${i.key}"`).join(", ");
  // Fixed SQL built from the constants above (no user input).
  const [row] = await prisma.$queryRawUnsafe<Record<string, number>[]>(`SELECT COUNT(*)::int AS "total", ${select} FROM "Loan"`);
  return { total: row?.total ?? 0, missing: ACCOUNT_ITEMS.map((i) => ({ key: i.key, label: i.label, count: row?.[i.key] ?? 0 })) };
}

/** One line for the card: "Area ID and name 3, Company ID and name 1 (of 40 loan files)", or none missing. */
export function feedQualityLine(q: Awaited<ReturnType<typeof accountFeedQuality>>): { value: string; bad: boolean } {
  const gaps = q.missing.filter((m) => m.count > 0);
  if (!q.total) return { value: "No loan files yet", bad: false };
  if (!gaps.length) return { value: `All 15 items given (${q.total} loan file${q.total === 1 ? "" : "s"})`, bad: false };
  return { value: `${gaps.map((g) => `${g.label} ${g.count}`).join(", ")} (of ${q.total} loan file${q.total === 1 ? "" : "s"}; warnings, opening is not blocked)`, bad: true };
}
