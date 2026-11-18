import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { can, scopeIds, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";

/**
 * D-050: the PN search log. Every PN # searched on Find loan, with what happened: who, the PN typed, the outcome,
 * myloans' status and FeedState when it answered, the loan's branch when known, when. Writing never blocks a search.
 * Read under Reports, PN searches ("See PN searches"), within the reader's branches (the searcher's home branch, or
 * the loan's branch).
 */
export const PN_OUTCOMES = {
  INVALID: "Not a valid PN",
  FOUND_IN_DMS: "Already in the DMS",
  NOT_FOUND: "Not found in myloans",
  NOT_SELECTABLE: "Not a released loan in myloans",
  MULTIPLE: "Several records in myloans",
  BUSY: "myloans busy (not asked)",
  UNAVAILABLE: "myloans did not answer",
  REFUSED: "Refused (data check or branch)",
  PREVIEW: "Shown, ready to open",
  OPENED: "Opened",
} as const;
export type PnOutcome = keyof typeof PN_OUTCOMES;

export async function logPnSearch(u: CurrentUser, pn: string, outcome: PnOutcome, extra: { statusId?: string | number | null; feedState?: string | null; loanBranchId?: string | null } = {}): Promise<void> {
  try {
    await prisma.pnSearchLog.create({
      data: {
        userId: u.id, userLabel: u.name, searcherBranchId: u.homeBranchId, pn: pn.slice(0, 40), outcome,
        statusId: extra.statusId === undefined || extra.statusId === null ? null : String(extra.statusId), feedState: extra.feedState ?? null, loanBranchId: extra.loanBranchId ?? null,
      },
    });
  } catch {
    // The log never blocks Find loan.
  }
}

export interface PnSearchFilter { from?: string; to?: string; pn?: string; outcome?: string; who?: string }

function whereOf(u: CurrentUser, f: PnSearchFilter): Prisma.PnSearchLogWhereInput {
  const scope = scopeIds(u);
  const and: Prisma.PnSearchLogWhereInput[] = [];
  if (scope !== null) and.push({ OR: [{ searcherBranchId: { in: scope } }, { loanBranchId: { in: scope } }] });
  if (f.from) and.push({ at: { gte: new Date(`${f.from}T00:00:00+08:00`) } });
  if (f.to) and.push({ at: { lte: new Date(`${f.to}T23:59:59.999+08:00`) } });
  if (f.pn?.trim()) and.push({ pn: { contains: f.pn.trim().toUpperCase() } });
  if (f.outcome && f.outcome in PN_OUTCOMES) and.push({ outcome: f.outcome });
  if (f.who?.trim()) and.push({ userLabel: { contains: f.who.trim(), mode: "insensitive" } });
  return and.length ? { AND: and } : {};
}

export async function listPnSearches(u: CurrentUser, f: PnSearchFilter = {}, take = 200) {
  if (!can(u, PERMISSIONS.REPORTS_PNSEARCH)) return { rows: [], total: 0 };
  const where = whereOf(u, f);
  const [rows, total] = await Promise.all([prisma.pnSearchLog.findMany({ where, orderBy: { at: "desc" }, take }), prisma.pnSearchLog.count({ where })]);
  return { rows, total };
}

/** Download CSV (the same rows, up to 10,000). */
export async function pnSearchCsvRows(u: CurrentUser, f: PnSearchFilter = {}) {
  if (!can(u, PERMISSIONS.REPORTS_PNSEARCH)) return [];
  return prisma.pnSearchLog.findMany({ where: whereOf(u, f), orderBy: { at: "desc" }, take: 10_000 });
}
