import "server-only";
import { prisma } from "@/lib/db";
import { can, inScope, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { lookupPn, type PnLookupResult } from "@/lib/services/loan-file";
import { accountWarnings } from "@/lib/myloans/account";
import { getCalendar } from "@/lib/calendar/load";
import { daysFor } from "@/lib/calendar/core";
import { poolArrival, poolSinceText, waitingDays } from "@/lib/work/rules";
import { businessDate } from "@/lib/time";
import { dayText, peso } from "@/lib/ui/plain";

const OPEN = ["POOL", "INBOX", "HELD"];

/** The pool's own copy (from the last sync), for people without the myloans search tick. */
export interface PoolCopy { borrowerName: string; cin: string; branchName: string; productName: string; amount: string | null; releasedOn: string }

export type PoolPreview =
  | { kind: "gone" }
  | { kind: "opened"; pn: string }
  | { kind: "ok"; pn: string; r: PnLookupResult | null; waiting: string | null; warnings: string[]; copy: PoolCopy | null };

/**
 * D-063: what the Inbox's Branch pool panel shows for a released loan not yet in the DMS: the same as its preview
 * page (D-060): what myloans says now (API 1, logged), how long it has waited in the pool (never before the release
 * date), Admin's data check, or the pool's own copy without the search tick. Outside the person's branches, or no
 * longer in a pool: "gone". Already a loan file: "opened".
 */
export async function poolPreview(user: CurrentUser, pn: string): Promise<PoolPreview> {
  const item = await prisma.workItem.findFirst({ where: { kind: "LOAN_CANDIDATE", subjectId: pn, state: { in: OPEN } }, select: { branchId: true, arrivedAt: true } });
  if (!item || !inScope(user, item.branchId)) return { kind: "gone" };
  if (await prisma.loan.findUnique({ where: { pn }, select: { id: true } })) return { kind: "opened", pn };
  const r = can(user, PERMISSIONS.LOANS_SEARCH) ? await lookupPn(user, pn) : null;
  if (r?.kind === "existing") return { kind: "opened", pn };
  if (r?.kind === "refused" && r.field === "branch") return { kind: "gone" };
  const days = daysFor(await getCalendar(), item.branchId);
  const live = r?.kind === "preview" && r.record.releaseDate ? new Date(r.record.releaseDate) : null;
  const since = poolArrival(item.arrivedAt, live && !Number.isNaN(live.getTime()) ? live : null);
  const waiting = poolSinceText(dayText(since, { year: false }), waitingDays(businessDate(since), businessDate(new Date()), days));
  const cand = !r || r.kind !== "preview" ? await prisma.sourceLoanCandidate.findFirst({ where: { pn }, orderBy: { lastSeenAt: "desc" } }) : null;
  const n = cand?.amount ? Number(cand.amount) : NaN;
  return {
    kind: "ok", pn, r, waiting,
    warnings: r?.kind === "preview" && can(user, PERMISSIONS.SOURCE_MANAGE) ? accountWarnings(r.record) : [],
    copy: !r && cand ? {
      borrowerName: cand.borrowerName, cin: cand.cin ?? "-", branchName: cand.branchName ?? "-", productName: cand.productName ?? "-",
      amount: can(user, PERMISSIONS.LOANS_VIEW_AMOUNTS) && Number.isFinite(n) ? peso(n) : null, releasedOn: dayText(cand.releaseDate),
    } : null,
  };
}
