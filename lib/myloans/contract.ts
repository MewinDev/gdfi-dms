import type { MyLoansAdapter } from "./types";

/**
 * The MyLoans adapter contract, as checks any adapter must pass (mock now; the live adapter once the
 * real API is mapped in live-mapping.ts). `known` is a PN the source has; `missing` one it does not.
 * Returns the problems found (empty = the adapter keeps the contract).
 */
export async function checkContract(a: MyLoansAdapter, known: string, missing: string): Promise<string[]> {
  const bad: string[] = [];
  const r = await a.getByPn(known);
  if (!r.ok) bad.push(`getByPn(${known}) did not answer: ${r.message}`);
  else {
    if (r.record.pn !== known) bad.push("getByPn returned another PN");
    for (const k of ["borrowerName", "status", "loanType", "productName", "totalReleasedAmount", "releaseDate", "branchName"] as const) {
      if (!(k in r.record)) bad.push(`record has no ${k}`);
    }
    if (r.record.releaseDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(r.record.releaseDate)) bad.push("releaseDate is not YYYY-MM-DD");
  }
  const m = await a.getByPn(missing);
  if (m.ok || m.reason !== "NOT_FOUND") bad.push(`getByPn(${missing}) should be NOT_FOUND`);
  const s = await a.search(known.slice(0, 6), 3);
  if (a.capabilities.search) {
    if (!s.ok) bad.push("search is said to be supported but failed");
    else if (s.hits.length > 3) bad.push("search returned more than the limit");
  } else if (s.ok || s.reason !== "UNSUPPORTED") bad.push("search is not supported: it must say UNSUPPORTED");
  const c = await a.getChangedSince(new Date(Date.now() - 86_400_000), 5);
  if (a.capabilities.changedSince) {
    if (!c.ok) bad.push("changedSince is said to be supported but failed");
    else if (c.records.length > 5) bad.push("changedSince returned more than the limit");
  } else if (c.ok || c.reason !== "UNSUPPORTED") bad.push("changedSince is not supported: it must say UNSUPPORTED");
  return bad;
}
