import "server-only";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { getMyLoansAdapter } from "@/lib/myloans";
import { getPnFormat, cleanPn, describePn, isPnAttempt, parsePn, pnHeadline } from "@/lib/pn";
import { inBranches } from "./data-check";
import type { MyLoansAdapter } from "./types";

/**
 * Find loan: a live lookup, never a copy of the source. Exact PN always works (an indexed lookup);
 * with search support, at least 3 characters and at most 10 results, cached about a minute.
 */
export const FIND_MIN = 3;
export const FIND_LIMIT = 10;
const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; value: FindResult }>();
/** Tests only. */
export const clearFindCache = () => cache.clear();

export interface FindHit { pn: string; borrowerName: string; status: string | null; releaseDate: string | null; opened: boolean; changed: boolean }
export type FindResult =
  | { ok: true; exactOnly: boolean; hits: FindHit[] }
  | { ok: false; exactOnly: boolean; message: string };

export async function findLoans(user: CurrentUser, query: string, opts: { adapter?: MyLoansAdapter; now?: number } = {}): Promise<FindResult> {
  const adapter = opts.adapter ?? getMyLoansAdapter();
  const q = query.trim();
  const exactOnly = !adapter.capabilities.search;
  if (q.length < FIND_MIN) return { ok: true, exactOnly, hits: [] };
  const allowed = user.scopeBranchIds === null ? null : user.branchNames.map((name, i) => ({ name, code: user.branchCodes[i] ?? null }));
  const key = `${allowed ? allowed.map((b) => b.code ?? b.name).sort().join("|") : "*"}::${q.toUpperCase()}`;
  const now = opts.now ?? Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit.value;

  // The shared PN check: a wrong PN never reaches MyLoans. A part of a PN (still typing) is searched.
  const fmt = await getPnFormat();
  const parsed = parsePn(q, fmt);
  if (!parsed.ok && isPnAttempt(q, fmt) && (exactOnly || cleanPn(q).length >= describePn(fmt).length)) {
    return { ok: false, exactOnly, message: `${pnHeadline(fmt)}. ${parsed.message}` };
  }
  let rows: { pn: string; borrowerName: string; status: string | null; releaseDate: string | null; branchName: string | null; branchCode?: string | null }[] = [];
  if (exactOnly) {
    // Exact PN only: one indexed lookup at the source.
    if (!parsed.ok) return { ok: true, exactOnly, hits: [] };
    const pn = parsed.pn;
    const r = await adapter.getByPn(pn);
    if (!r.ok) return r.reason === "NOT_FOUND" ? { ok: true, exactOnly, hits: [] } : { ok: false, exactOnly, message: r.message };
    rows = [{ ...r.record }];
  } else {
    const r = await adapter.search(parsed.ok ? parsed.pn : q, FIND_LIMIT);
    if (!r.ok) return { ok: false, exactOnly, message: r.message };
    rows = r.hits.slice(0, FIND_LIMIT);
  }
  rows = rows.filter((r) => !allowed || inBranches({ branchCode: r.branchCode ?? null, branchName: r.branchName }, allowed));
  // Which of them are open here (the local PN index), and which have a MyLoans change waiting.
  const local = await prisma.loan.findMany({ where: { pn: { in: rows.map((r) => r.pn) } }, select: { pn: true, sourceChanges: { where: { state: "OPEN" }, select: { id: true } } } });
  const hits = rows.map((r) => {
    const l = local.find((x) => x.pn === r.pn);
    return { pn: r.pn, borrowerName: r.borrowerName, status: r.status, releaseDate: r.releaseDate, opened: !!l, changed: !!l?.sourceChanges.length };
  });
  const value: FindResult = { ok: true, exactOnly, hits };
  cache.set(key, { at: now, value });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return value;
}
