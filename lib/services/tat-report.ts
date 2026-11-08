import "server-only";
import { prisma } from "@/lib/db";
import { loanScope, type CurrentUser } from "@/lib/auth/current-user";
import { getHolidaySet } from "@/lib/settings";
import { endOfBusinessDay, startOfBusinessDay } from "@/lib/time";
import { holdDays, problemDays } from "@/lib/workflow/tat";
import { jobRows, type JobRow } from "./job-queries";
import { holdReasonName } from "@/lib/ui/holds";

export interface TatFilters { stage?: string; branch?: string; type?: string; show?: string; outside?: string; from?: string; to?: string }

/** Open jobs (and done jobs that ran late) for the TAT and problems report, in the person's loan scope. */
export async function tatReport(user: CurrentUser, f: TatFilters = {}): Promise<{ rows: JobRow[]; all: JobRow[] }> {
  const all = (await jobRows({ loan: loanScope(user) })).filter((r) => r.tab !== "returned");
  const show = f.show ?? "attention";
  const rows = all
    .filter((r) => !f.branch || r.branch === f.branch)
    .filter((r) => !f.type || r.typeCode === f.type)
    .filter((r) => !f.stage || (f.stage === "-" ? r.tab === "process" && !r.stage : r.stage === f.stage))
    .filter((r) => f.outside !== "1" || r.problem?.outsideControl)
    .filter((r) => {
      if (show === "problems") return !!r.problem;
      if (show === "holds") return !!r.hold;
      if (show === "overdue") return r.tat?.state === "overdue" || !!r.tat?.lateText;
      if (show === "open") return r.tab === "review" || r.tab === "process" || r.tab === "forwarded";
      if (show === "all") return true;
      // attention: open problems and holds, overdue, due today
      return !!r.problem || !!r.hold || r.tat?.state === "overdue" || r.tat?.state === "due" || !!r.tat?.lateText;
    })
    .sort((a, b) => Number(!!b.problem) - Number(!!a.problem) || b.problemDaysTotal - a.problemDaysTotal);
  return { rows, all };
}

export const TAT_SHOW = [["attention", "Needs attention"], ["problems", "Open problems"], ["holds", "On hold"], ["overdue", "Overdue"], ["open", "All open"], ["all", "All"]] as const;

export interface ReasonRow {
  type: "Problem" | "Hold" | "Returned";
  reason: string;
  count: number;
  open: number;
  /** Average business days (open ones count to today; holidays and weekends skipped). */
  avgDays: number;
  /** Problems only: how many were tagged "Outside our control" (null for holds). */
  outside: number | null;
}

const TYPE_ORDER: Record<ReasonRow["type"], number> = { Problem: 0, Hold: 1, Returned: 2 };
const ymd = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);

/**
 * Problems and holds by reason, in the person's loan scope, raised between two PHT dates (inclusive),
 * optionally for one branch (by name, as the report's branch filter).
 */
export async function reasonReport(user: CurrentUser, f: Pick<TatFilters, "branch" | "from" | "to" | "type"> = {}, now: Date = new Date()): Promise<ReasonRow[]> {
  const from = ymd(f.from), to = ymd(f.to);
  const raised = from || to ? { ...(from ? { gte: startOfBusinessDay(from) } : {}), ...(to ? { lte: endOfBusinessDay(to) } : {}) } : undefined;
  const loan = { ...loanScope(user), ...(f.branch ? { branch: { name: f.branch } } : {}) };
  const transaction = f.type ? { type: { code: f.type } } : undefined;
  const returnedAt = raised;
  const [problems, holds, returns, holidays] = await Promise.all([
    prisma.problem.findMany({ where: { loan, ...(transaction ? { transaction } : {}), ...(raised ? { raisedAt: raised } : {}) }, include: { reason: { select: { name: true } } } }),
    prisma.hold.findMany({ where: { loan, ...(transaction ? { transaction } : {}), ...(raised ? { raisedAt: raised } : {}) }, include: { reason: { select: { name: true } } } }),
    prisma.dpAssignment.findMany({
      where: { loan, returnReasonId: { not: null }, ...(transaction ? { transaction } : {}), ...(returnedAt ? { returnedAt } : {}) },
      include: { returnReason: { select: { name: true } }, transaction: { select: { dpAssignments: { select: { endorsedAt: true } } } } },
    }),
    getHolidaySet(),
  ]);
  const rows = new Map<string, ReasonRow & { days: number }>();
  const add = (type: ReasonRow["type"], reason: string, days: number, open: boolean, outside: boolean | null) => {
    const k = `${type}|${reason}`;
    const r = rows.get(k) ?? { type, reason, count: 0, open: 0, avgDays: 0, outside: type === "Problem" ? 0 : null, days: 0 };
    r.count++; r.days += days; if (open) r.open++;
    if (outside && r.outside !== null) r.outside++;
    rows.set(k, r);
  };
  for (const p of problems) add("Problem", p.reason.name, problemDays([p], holidays, now), !p.resolvedAt, p.outsideControl);
  for (const h of holds) add("Hold", holdReasonName(h), holdDays([h], holidays, now), !h.resumedAt, null);
  // Returned to the LA for papers: until it was sent again (or now).
  for (const a of returns) {
    const resent = a.transaction.dpAssignments.map((x) => x.endorsedAt).filter((x) => a.returnedAt && x > a.returnedAt).sort((x, y) => x.getTime() - y.getTime())[0] ?? null;
    add("Returned", a.returnReason?.name ?? "Returned", holdDays([{ raisedAt: a.returnedAt ?? a.createdAt, resumedAt: resent }], holidays, now), !resent, null);
  }
  return [...rows.values()]
    .map(({ days, ...r }) => ({ ...r, avgDays: Math.round((days / r.count) * 10) / 10 }))
    .sort((a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || b.count - a.count || a.reason.localeCompare(b.reason));
}
