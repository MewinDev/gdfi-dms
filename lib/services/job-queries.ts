import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { getHolidaySet, getTatMap } from "@/lib/settings";
import { businessDate } from "@/lib/time";
import type { FundsStatus } from "@/lib/funds/rules";
import { doneTat, openHold, openProblem, txnFunds, txnTat, txnFundsType } from "@/lib/jobs/view";
import { holdDays, problemDays, type TatChipData } from "@/lib/workflow/tat";
import { holdReasonName } from "@/lib/ui/holds";

/**
 * Job tabs on the Jobs page. A declined or returned job is no longer the DP's: it is not in any DP
 * list, tile or count ("returned" is only used by the Admin report rows).
 */
export const JOB_TABS = [
  { key: "review", label: "To review" },
  { key: "process", label: "In process" },
  { key: "forwarded", label: "Forwarded" },
  { key: "done", label: "Done" },
] as const;
export type JobTab = (typeof JOB_TABS)[number]["key"] | "returned";

export interface JobRow {
  id: string;
  pn: string;
  borrower: string;
  branch: string;
  typeCode: string;
  typeName: string;
  dpName: string;
  tab: JobTab;
  endorsedAt: Date;
  tat: TatChipData | null;
  funds: FundsStatus;
  /** The live funds record's type (Cash advance, Fund transfer), when the job has one. */
  fundsType: { code: string; name: string } | null;
  problem: { id: string; reason: string; days: number; outsideControl: boolean } | null;
  problemDaysTotal: number;
  hold: { id: string; reason: string; days: number } | null;
  holdDaysTotal: number;
  attempts: number;
  ltoOffice: string | null;
  /** Second processor (Pasuyo): "from Ben Ocampo to Grace Tan" or "to Grace Tan". */
  pasuyo: string | null;
  /** The loan replaces another PN (a changed unit got a new PN): its own clock, not duplicate work. */
  replaces: string | null;
  /** The current processing stage (its name), or null before the first stage starts / when done. */
  stage: string | null;
  /** The receiving LA recorded the package Incomplete: the DP corrects it and forwards again. */
  incomplete: string | null;
  /** Sent back: Declined (before accepting) or Returned to LA (after). */
  returnedHow: "Declined" | "Returned" | null;
}

const include = {
  loan: { select: { pn: true, borrowerName: true, replacesPn: true, branch: { select: { name: true } } } },
  dpUser: { select: { name: true } },
  secondaryDpUser: { select: { name: true } },
  pasuyoEvents: { orderBy: { createdAt: "desc" }, take: 1, select: { fromLabel: true, toLabel: true } },
  ltoOffice: { select: { name: true } },
  stages: { orderBy: { sortOrder: "asc" }, select: { name: true, status: true } },
  transaction: {
    include: {
      type: { select: { code: true, name: true } },
      advanceLines: { include: { advance: { select: { status: true, fundsTypeCode: true, fundsTypeName: true } } } },
      problems: { include: { reason: { select: { name: true } } }, orderBy: { raisedAt: "desc" } },
      exceptions: { where: { type: "INCOMPLETE_PACKAGE", status: "OPEN" }, select: { reason: true, details: true }, take: 1 },
      holds: { include: { reason: { select: { name: true } } }, orderBy: { raisedAt: "desc" } },
      _count: { select: { attempts: true } },
    },
  },
} satisfies Prisma.DpAssignmentInclude;

function tabOf(a: { status: string; transaction: { status: string } }): JobTab {
  if (a.status === "PENDING_ACCEPTANCE") return "review";
  if (a.status === "DECLINED" || a.status === "WITHDRAWN") return "returned";
  if (a.status === "CLOSED" || a.transaction.status === "COMPLETED") return "done";
  if (a.transaction.status === "FORWARDED") return "forwarded";
  return "process";
}

/** Jobs as rows (TAT chip, funds, problem). `where` decides the scope (own jobs, or the Admin report). */
export async function jobRows(where: Prisma.DpAssignmentWhereInput, now: Date = new Date()): Promise<JobRow[]> {
  const [rows, tats, holidays] = await Promise.all([
    prisma.dpAssignment.findMany({ where: { AND: [where, { status: { not: "PULLED_BACK" } }] }, include, orderBy: { endorsedAt: "desc" }, take: 500 }),
    getTatMap(),
    getHolidaySet(),
  ]);
  return rows.map((a) => {
    const t = a.transaction;
    const tab = tabOf(a);
    const p = openProblem(t.problems);
    const h = openHold(t.holds);
    const tat = tab === "done" && a.decidedAt
      ? doneTat(t.type.code, a.decidedAt, a.forwardedAt ?? a.closedAt ?? now, tats, holidays)
      : tab === "returned" ? null : txnTat(t, tats, holidays, now);
    return {
      id: a.id, pn: a.loan.pn, borrower: a.loan.borrowerName, branch: a.loan.branch.name, typeCode: t.type.code, typeName: t.type.name,
      dpName: a.dpUser.name, tab, endorsedAt: a.endorsedAt, tat, funds: txnFunds(t), fundsType: txnFundsType(t),
      problem: p ? { id: p.id, reason: p.reason.name, days: Math.max(1, problemDays([p], holidays, now)), outsideControl: p.outsideControl } : null,
      problemDaysTotal: problemDays(t.problems, holidays, now),
      hold: h ? { id: h.id, reason: holdReasonName(h), days: Math.max(1, holdDays([h], holidays, now)) } : null,
      holdDaysTotal: holdDays(t.holds, holidays, now), attempts: t._count.attempts, ltoOffice: a.ltoOffice?.name ?? null,
      replaces: a.loan.replacesPn,
      stage: tab === "process" ? a.stages.find((s) => s.status !== "DONE")?.name ?? null : null,
      incomplete: tab === "process" && t.exceptions[0] ? ((t.exceptions[0].details as { note?: string } | null)?.note || t.exceptions[0].reason) : null,
      returnedHow: a.status === "DECLINED" ? "Declined" : a.status === "WITHDRAWN" ? "Returned" : null,
      pasuyo: a.secondaryDpUser ? (a.pasuyoEvents[0]?.fromLabel ? `from ${a.pasuyoEvents[0].fromLabel} to ${a.secondaryDpUser.name}` : `to ${a.secondaryDpUser.name}`) : null,
    };
  });
}

/**
 * The person's jobs: sent to them, or passed to them as the second processor (Pasuyo). Jobs they
 * declined or returned to the LA are left out: those went back to the LA who sent them.
 */
export const myJobs = (u: CurrentUser) => jobRows({ OR: [{ dpUserId: u.id }, { secondaryDpUserId: u.id }], status: { notIn: ["DECLINED", "WITHDRAWN"] } });

/** "Do these next": problems first, then overdue, then due today, then jobs to review. */
export function doNext(rows: JobRow[]): JobRow[] {
  const rank = (r: JobRow) =>
    r.problem ? 0 : r.tat?.state === "overdue" ? 1 : r.tat?.state === "due" ? 2 : r.tab === "review" ? 3 : 9;
  return rows.filter((r) => r.tab !== "done" && r.tab !== "returned" && rank(r) < 9).sort((a, b) => rank(a) - rank(b) || a.endorsedAt.getTime() - b.endorsedAt.getTime());
}

export function jobCounts(rows: JobRow[]) {
  const open = rows.filter((r) => r.tab === "review" || r.tab === "process");
  return {
    review: rows.filter((r) => r.tab === "review").length,
    process: rows.filter((r) => r.tab === "process").length,
    problems: open.filter((r) => r.problem).length,
    overdue: open.filter((r) => r.tat?.state === "overdue" || !!r.tat?.lateText).length,
    dueToday: open.filter((r) => r.tat?.state === "due").length,
    needsFunds: open.filter((r) => r.funds === "NEEDED").length,
    onHold: open.filter((r) => r.hold).length,
  };
}

export const todayText = () => businessDate(new Date());
