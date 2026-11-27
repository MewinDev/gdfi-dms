import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { can, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { businessDate, fmtDate } from "@/lib/time";
import { peso } from "@/lib/ui/plain";
import { waitingDays } from "@/lib/work/rules";
import { timeLeft, type TimeLeft } from "@/lib/jobs/list";
import { getTatMap } from "@/lib/settings";
import { getCalendar } from "@/lib/calendar/load";
import { daysFor, daysLeft, type Days } from "@/lib/calendar/core";
import { stepClock, targetOf, txnStepKey } from "@/lib/workflow/tat";
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
  /** The loan's branch code (3 digits) and Area, for reports and CSV. */
  branchCode: string | null;
  area: string;
  typeCode: string;
  typeName: string;
  dpName: string;
  tab: JobTab;
  endorsedAt: Date;
  tat: TatChipData | null;
  /** The due date that sorts the list (D-041): the saved one of an accepted job, else the live step deadline. */
  dueDate: string | null;
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
  /**
   * D-064 (the Jobs list and its details panel): the CIN (search), the product, the LA who sent it, the released amount
   * (only with "See loan amounts"; never sent otherwise), the funds amounts, the working days left (0 = due today,
   * negative = late), the "Time left" chip, the waiting time before acceptance, whether it is completed (processing
   * recorded), its stages, the open hold's owner, and why it came back before (an earlier round returned or declined).
   */
  cin: string;
  product: string;
  sentBy: string;
  amount: string | null;
  fundsDetail: { requested: string | null; released: string | null; liquidationDue: string | null };
  daysLeft: number | null;
  timeLeft: TimeLeft | null;
  waiting: number;
  completed: boolean;
  stageCount: number;
  holdBy: string | null;
  earlierReturn: string | null;
  /** Money was released and is now due for liquidation (the Funds filter "To liquidate"). */
  liquidating: boolean;
}

const include = {
  loan: { select: { pn: true, borrowerName: true, replacesPn: true, branchId: true, cin: true, productName: true, totalReleasedAmount: true, branch: { select: { name: true, code: true, area: { select: { name: true } } } } } },
  dpUser: { select: { name: true } },
  assignedBy: { select: { name: true } },
  secondaryDpUser: { select: { name: true } },
  pasuyoEvents: { orderBy: { createdAt: "desc" }, take: 1, select: { fromLabel: true, toLabel: true } },
  ltoOffice: { select: { name: true } },
  stages: { orderBy: { sortOrder: "asc" }, select: { name: true, status: true } },
  transaction: {
    include: {
      type: { select: { code: true, name: true } },
      advanceLines: { include: { advance: { select: { status: true, fundsTypeCode: true, fundsTypeName: true, liquidationDueAt: true } } } },
      // An earlier round of this transaction that came back (returned to the LA or declined): its reasons.
      dpAssignments: { where: { status: { in: ["DECLINED", "WITHDRAWN"] } }, orderBy: { closedAt: "desc" }, take: 1, select: { id: true, status: true, returnReasons: true, declineReasons: true, closedAt: true } },
      problems: { include: { reason: { select: { name: true } } }, orderBy: { raisedAt: "desc" } },
      exceptions: { where: { type: "INCOMPLETE_PACKAGE", status: "OPEN" }, select: { reason: true, details: true }, take: 1 },
      holds: { include: { reason: { select: { name: true, pausesTat: true } } }, orderBy: { raisedAt: "desc" } },
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
export async function jobRows(where: Prisma.DpAssignmentWhereInput, now: Date = new Date(), opts: { seesAmounts?: boolean } = {}): Promise<JobRow[]> {
  const [rows, tats, cal] = await Promise.all([
    prisma.dpAssignment.findMany({ where: { AND: [where, { status: { not: "PULLED_BACK" } }] }, include, orderBy: { endorsedAt: "desc" }, take: 500 }),
    getTatMap(),
    getCalendar(),
  ]);
  return sortByDue(rows.map((a) => {
    const t = a.transaction;
    // A DP job counts on the processor's branch calendar (D-041).
    const holidays = daysFor(cal, a.dpBranchId);
    const tab = tabOf(a);
    const p = openProblem(t.problems);
    const h = openHold(t.holds);
    const tat = tab === "done" && a.decidedAt
      ? doneTat(t.type.code, a.decidedAt, a.forwardedAt ?? a.closedAt ?? now, tats, cal, a.dpBranchId)
      : tab === "returned" ? null : txnTat(t, tats, cal, { loan: a.loan.branchId, job: a.dpBranchId, saved: { dueDate: a.dueDate, targetDays: a.targetDays, acceptedAt: a.decidedAt } }, now);
    const live = tab === "done" || tab === "returned" ? null : a.dueDate ?? stepDeadline(t, tats, holidays, now);
    return {
      id: a.id, pn: a.loan.pn, borrower: a.loan.borrowerName, branch: a.loan.branch.name, branchCode: a.loan.branch.code, area: a.loan.branch.area?.name ?? "", typeCode: t.type.code, typeName: t.type.name,
      dpName: a.dpUser.name, tab, endorsedAt: a.endorsedAt, tat, dueDate: live, funds: txnFunds(t), fundsType: txnFundsType(t),
      problem: p ? { id: p.id, reason: p.reason.name, days: Math.max(1, problemDays([p], holidays, now)), outsideControl: p.outsideControl } : null,
      problemDaysTotal: problemDays(t.problems, holidays, now),
      hold: h ? { id: h.id, reason: holdReasonName(h), days: Math.max(1, holdDays([h], holidays, now)) } : null,
      holdDaysTotal: holdDays(t.holds, holidays, now), attempts: t._count.attempts, ltoOffice: a.ltoOffice?.name ?? null,
      replaces: a.loan.replacesPn,
      stage: tab === "process" ? a.stages.find((s) => s.status !== "DONE")?.name ?? null : null,
      incomplete: tab === "process" && t.exceptions[0] ? ((t.exceptions[0].details as { note?: string } | null)?.note || t.exceptions[0].reason) : null,
      returnedHow: a.status === "DECLINED" ? "Declined" : a.status === "WITHDRAWN" ? "Returned" : null,
      pasuyo: a.secondaryDpUser ? (a.pasuyoEvents[0]?.fromLabel ? `from ${a.pasuyoEvents[0].fromLabel} to ${a.secondaryDpUser.name}` : `to ${a.secondaryDpUser.name}`) : null,
      ...extras(a, tab, tat, live, h, holidays, now, cal.amberWithinDays ?? 1, !!opts.seesAmounts),
    };
  }));
}

type Assignment = Prisma.DpAssignmentGetPayload<{ include: typeof include }>;

/** D-064: the Jobs list's and panel's extra fields (see JobRow). */
function extras(a: Assignment, tab: JobTab, tat: TatChipData | null, due: string | null, h: { raisedById: string | null } | null, days: Days, now: Date, amberWithin: number, seesAmounts: boolean) {
  const t = a.transaction;
  const live = t.advanceLines.filter((l) => !l.denied && !["DENIED", "CANCELLED"].includes(l.advance.status));
  const cents = (n: number) => (n > 0 ? peso(n / 100) : null);
  const liqDue = live.map((l) => l.advance.liquidationDueAt).filter((d): d is Date => !!d).sort((x, y) => x.getTime() - y.getTime())[0];
  const n = Number(a.loan.totalReleasedAmount);
  const today = businessDate(now);
  const left = due ? daysLeft(due, today, days) : null;
  const back = t.dpAssignments.find((x) => x.id !== a.id);
  const why = back ? (back.status === "DECLINED" ? back.declineReasons : back.returnReasons) : null;
  return {
    cin: a.loan.cin ?? "", product: a.loan.productName, sentBy: a.assignedBy.name,
    amount: seesAmounts && Number.isFinite(n) && n > 0 ? peso(n) : null,
    fundsDetail: {
      requested: cents(live.reduce((s, l) => s + l.requestedCents, 0)),
      released: cents(live.reduce((s, l) => s + l.releasedCents, 0)),
      liquidationDue: liqDue ? fmtDate(businessDate(liqDue)) : null,
    },
    daysLeft: left,
    timeLeft: timeLeft({ tab, tat, daysLeft: left, amberWithin }),
    waiting: waitingDays(businessDate(a.endorsedAt), a.decidedAt ? businessDate(a.decidedAt) : today, days),
    completed: !!a.processing, stageCount: a.stages.length, holdBy: h?.raisedById ?? null,
    liquidating: live.some((l) => ["FOR_LIQUIDATION", "PARTIALLY_LIQUIDATED"].includes(l.advance.status)),
    earlierReturn: why ? `${back!.status === "DECLINED" ? "Declined" : "Returned to the Loan Associate"}${back!.closedAt ? ` on ${fmtDate(businessDate(back!.closedAt))}` : ""}: ${why}` : null,
  };
}

/** The live deadline of the job's current step (no saved due date yet: waiting for acceptance). */
function stepDeadline(t: Parameters<typeof txnTat>[0], tats: Awaited<ReturnType<typeof getTatMap>>, days: Days, now: Date): string | null {
  const target = targetOf(tats, txnStepKey(t.status, t.type.code));
  return target === null ? null : stepClock({ targetDays: target, start: t.statusSince }, days, now).deadline;
}

/**
 * Jobs lists, due first (D-041): open jobs by due date, overdue and soonest first (a job with no due date after
 * them); finished and returned jobs after, newest first.
 */
export function sortByDue<R extends { dueDate: string | null; endorsedAt: Date }>(rows: R[]): R[] {
  const rank = (r: R) => (r.dueDate ? 0 : 1);
  return [...rows].sort((x, y) => rank(x) - rank(y) || (x.dueDate && y.dueDate ? x.dueDate.localeCompare(y.dueDate) : 0) || y.endorsedAt.getTime() - x.endorsedAt.getTime());
}

/**
 * The person's jobs: sent to them, or passed to them as the second processor (Pasuyo). Jobs they
 * declined or returned to the LA are left out: those went back to the LA who sent them.
 */
export const myJobs = (u: CurrentUser) => jobRows({ OR: [{ dpUserId: u.id }, { secondaryDpUserId: u.id }], status: { notIn: ["DECLINED", "WITHDRAWN"] } }, new Date(), { seesAmounts: can(u, PERMISSIONS.LOANS_VIEW_AMOUNTS) });

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
