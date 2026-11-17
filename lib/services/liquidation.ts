import "server-only";
import { prisma, type Tx } from "@/lib/db";
import { writeAudit, SYSTEM_ACTOR } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { businessDate, endOfBusinessDay, fmtDate } from "@/lib/time";
import { daysFor } from "@/lib/calendar/core";
import { loadCalendar } from "@/lib/calendar/load";
import { OPEN_ADVANCE } from "@/lib/funds/rules";
import { daysLate, liquidationDueOf, type LiqLine, type LiquidationBasis } from "@/lib/funds/liquidation";
import { handlersOrAdmins } from "./funds-handlers";
import { overseerIds } from "./jobs";

/**
 * Piece 5 (D-017, D-044): keeps each open advance's liquidation due date right. Called whenever a fact it depends
 * on changes: release, an LTO pickup finished, a transaction cancelled or completed, a carry-over decided, a job's
 * TAT due date moved (the fallback follows it), and by the daily run (a fallback starts when a TAT due date
 * passes). The rule itself is lib/funds/liquidation.ts; the calendar is the requesting processor's branch.
 */

async function facts(tx: Tx, advanceId: string) {
  return tx.cashAdvance.findUnique({
    where: { id: advanceId },
    include: {
      fundsType: { select: { liquidationDueDays: true, mustLiquidate: true, code: true } },
      lines: {
        where: { denied: false },
        select: {
          transactionId: true,
          transaction: {
            select: {
              status: true, cancelledAt: true, completedAt: true, type: { select: { needsLto: true } },
              dpAssignments: { orderBy: { endorsedAt: "desc" }, select: { status: true, dueDate: true, stages: { where: { kind: "LTO_PICKUP", finishedAt: { not: null } }, select: { finishedAt: true } } } },
            },
          },
        },
      },
    },
  });
}

/** Recomputes one open advance's liquidation due date; alerts once when the fallback starts. */
export async function refreshLiquidationDue(tx: Tx, advanceId: string, now: Date = new Date()) {
  const a = await facts(tx, advanceId);
  if (!a || !a.fundsType?.mustLiquidate || !OPEN_ADVANCE.includes(a.status) || !a.releasedAt) return;
  const from = a.liquidationCountFrom;
  const after = (d: Date | null | undefined) => (d && (!from || d >= from) ? businessDate(d) : null);
  const lines: LiqLine[] = a.lines.map((l) => {
    const t = l.transaction;
    if (!t) return { kind: "NOTE", doneDay: null, cancelledDay: null, jobDueDay: null };
    const pickups = t.dpAssignments.flatMap((j) => j.stages.map((s) => s.finishedAt!)).sort((x, y) => y.getTime() - x.getTime());
    const doneDay = t.type.needsLto ? after(pickups[0]) : t.status === "COMPLETED" ? after(t.completedAt) : null;
    const job = t.dpAssignments.find((j) => j.status === "ACCEPTED");
    return { kind: "TXN", doneDay, cancelledDay: !doneDay && t.status === "CANCELLED" ? after(t.cancelledAt) ?? businessDate(t.cancelledAt ?? now) : null, jobDueDay: job?.dueDate ?? null };
  });
  const days = daysFor(await loadCalendar(tx), a.branchId);
  const saved = { due: a.liquidationDueAt ? businessDate(a.liquidationDueAt) : null, basis: (a.liquidationBasis as LiquidationBasis | null) ?? null };
  const r = liquidationDueOf({ n: a.fundsType.liquidationDueDays, releasedDay: businessDate(a.releasedAt), lines, today: businessDate(now), days, saved });

  if (r.state === "waiting") {
    const note = r.total > 1 ? `${r.left} of ${r.total} left` : "";
    if (a.liquidationDueAt || a.liquidationBasis || a.liquidationNote !== note) {
      await tx.cashAdvance.update({ where: { id: a.id }, data: { liquidationDueAt: null, liquidationBasis: null, liquidationDueFrom: null, liquidationNote: note } });
    }
    return;
  }
  if (saved.due === r.due && saved.basis === r.basis) return;
  await tx.cashAdvance.update({ where: { id: a.id }, data: { liquidationDueAt: endOfBusinessDay(r.due), liquidationDueFrom: r.anchor, liquidationBasis: r.basis, liquidationNote: "", overdueNotifiedAt: null } });
  const why = { LTO: "the last LTO pickup", CANCELLED: "a cancelled transaction", RELEASE: "the release", FALLBACK: "the fallback (the LTO is not done after the job's due date)" }[r.basis];
  await writeAudit(tx, {
    actor: SYSTEM_ACTOR, mode: "AUTOMATIC", action: "liquidation_due_set", entityType: "CashAdvance", entityId: a.id,
    summary: `${a.number}: liquidation due ${fmtDate(r.due)} (${a.fundsType.liquidationDueDays} working days after ${why})`, before: { due: saved.due, basis: saved.basis }, after: { due: r.due, basis: r.basis },
  });
  if (r.basis === "FALLBACK" && !a.fallbackNotifiedAt) {
    // Finance (the handlers of this type and branch) and the branch's supervisors (D-044 item 5).
    const ids = [...(await handlersOrAdmins(tx, "settle", { fundsTypeId: a.fundsTypeId ?? undefined }, [a.branchId])), ...(await overseerIds(tx, a.branchId))];
    await notify(tx, { userIds: ids, title: `${a.number}: LTO not done. Liquidation due by fallback`, body: `The LTO pickup is not done after the job's due date. Liquidation is now due ${fmtDate(r.due)}.`, link: "/funds?tab=outstanding" });
    await tx.cashAdvance.update({ where: { id: a.id }, data: { fallbackNotifiedAt: now } });
  }
}

/** Every open advance with a line on this transaction. */
export async function refreshLiquidationForTransaction(tx: Tx, transactionId: string, now: Date = new Date()) {
  const advances = await tx.cashAdvance.findMany({ where: { status: { in: OPEN_ADVANCE as never }, lines: { some: { transactionId } } }, select: { id: true } });
  for (const a of advances) await refreshLiquidationDue(tx, a.id, now);
}

/** A carry-over decision (D-044 item 3): the wait restarts for that attempt's LTO pickup. */
export async function restartLiquidationWait(tx: Tx, advanceId: string, now: Date = new Date()) {
  await tx.cashAdvance.update({ where: { id: advanceId }, data: { liquidationCountFrom: now, liquidationDueAt: null, liquidationBasis: null, liquidationDueFrom: null, fallbackNotifiedAt: null } });
  await refreshLiquidationDue(tx, advanceId, now);
}

/** The daily run: advances still waiting, or on the fallback (it starts, or moves, as TAT due dates pass). */
export async function refreshOpenLiquidations(now: Date = new Date()) {
  const open = await prisma.cashAdvance.findMany({ where: { status: { in: OPEN_ADVANCE as never }, OR: [{ liquidationDueAt: null }, { liquidationBasis: "FALLBACK" }] }, select: { id: true } });
  for (const a of open) await prisma.$transaction((tx) => refreshLiquidationDue(tx, a.id, now));
  return open.length;
}

/** The late record (D-044 item 6), saved when an advance becomes Liquidated. */
export async function recordLiquidated(tx: Tx, advanceId: string, now: Date = new Date()) {
  const a = await tx.cashAdvance.findUnique({ where: { id: advanceId }, select: { branchId: true, liquidationDueAt: true, liquidatedAt: true } });
  if (!a || a.liquidatedAt) return;
  const late = a.liquidationDueAt ? daysLate(businessDate(a.liquidationDueAt), businessDate(now), daysFor(await loadCalendar(tx), a.branchId)) : 0;
  await tx.cashAdvance.update({ where: { id: advanceId }, data: { liquidatedAt: now, daysLate: late } });
}
