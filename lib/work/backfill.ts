import type { prisma as Db, Tx } from "@/lib/db";
import { txnStepKey } from "@/lib/workflow/tat";
import { arriveItem } from "@/lib/services/work-items";

/**
 * D-046 item 7: existing open work becomes inbox items from the recorded times. Where a time is missing the item is
 * marked "Migrated" and left out of TAT performance reports. Safe to run again: a subject that already has an item
 * (open or done) is left alone. Times are the records' own; nothing else is changed.
 */
export interface BackfillCounts { made: number; migrated: number; skipped: number }

export async function backfillWorkItems(db: typeof Db): Promise<BackfillCounts> {
  const counts: BackfillCounts = { made: 0, migrated: 0, skipped: 0 };
  const has = async (kind: string, subjectId: string) => !!(await db.workItem.findFirst({ where: { kind, subjectId }, select: { id: true } }));
  const make = async (kind: string, subjectId: string, fn: (tx: Tx) => Promise<{ id: string } | null>, migrated: boolean) => {
    if (await has(kind, subjectId)) { counts.skipped++; return; }
    await db.$transaction(async (tx) => {
      const it = await fn(tx);
      if (it && migrated) await tx.workItem.update({ where: { id: it.id }, data: { migrated: true } });
    });
    counts.made++;
    if (migrated) counts.migrated++;
  };

  const txns = await db.loanTransaction.findMany({
    where: { status: { notIn: ["COMPLETED", "CANCELLED"] } },
    include: { type: true, loan: { select: { pn: true, branchId: true, openedById: true, createdAt: true } }, dpAssignments: { orderBy: { endorsedAt: "desc" }, take: 1 } },
  });
  for (const t of txns) {
    const a = t.dpAssignments[0];
    const base = { loanId: t.loanId, pn: t.loan.pn, label: `${t.loan.pn}: ${t.type.name}`, by: null };
    if (["FOR_CHECKLIST", "READY", "RETURNED"].includes(t.status)) {
      // Back with the LA. After a return: in the sender's inbox from the return (not accepted). Otherwise the LA who
      // opened the loan has it from Find loan (arrive and accept at once).
      const returned = t.status === "RETURNED" && a;
      const at = returned ? a.returnedAt ?? a.closedAt ?? null : t.loan.createdAt;
      await make("TRANSACTION", t.id, (tx) => arriveItem(tx, {
        ...base, kind: "TRANSACTION", subjectId: t.id, role: "LA", branchId: t.loan.branchId,
        holderUserId: returned ? a.assignedById : t.loan.openedById, accepted: !returned, targetKey: t.type.code === "EDST" ? "P3_EDST" : "P3_ASSIGN", at: at ?? t.statusSince,
      }), !at);
    } else if (a && t.status === "ASSIGNED" && a.status === "PENDING_ACCEPTANCE") {
      await make("DP_JOB", t.id, (tx) => arriveItem(tx, { ...base, kind: "DP_JOB", subjectId: t.id, role: "DP", branchId: a.dpBranchId, holderUserId: a.dpUserId, targetKey: txnStepKey("IN_PROCESS", t.type.code), at: a.endorsedAt }), false);
    } else if (a && t.status === "IN_PROCESS" && a.status === "ACCEPTED") {
      const at = a.decidedAt;
      await make("DP_JOB", t.id, async (tx) => {
        const it = await arriveItem(tx, { ...base, kind: "DP_JOB", subjectId: t.id, role: "DP", branchId: a.dpBranchId, holderUserId: a.dpUserId, accepted: true, dueDate: a.dueDate, targetDays: a.targetDays, at: at ?? a.endorsedAt });
        // Arrival is when it was sent; accepted when the processor accepted.
        if (at) await tx.workItem.update({ where: { id: it.id }, data: { arrivedAt: a.endorsedAt, acceptedAt: at } });
        return it;
      }, !at);
    } else if (a && t.status === "FORWARDED") {
      const at = a.forwardedAt;
      await make("PACKAGE", a.id, (tx) => arriveItem(tx, {
        ...base, kind: "PACKAGE", subjectId: a.id, role: "LA", branchId: a.receivingBranchId ?? t.loan.branchId, label: `${t.loan.pn}: ${t.type.name} package`,
        holderUserId: a.receivingLaId, measure: "WAITING", targetKey: "P5_ACCEPT", at: at ?? t.statusSince,
      }), !at);
    }
  }

  // Funds requests not released yet: Finance's pool (requested), or with the approver (approved).
  const advances = await db.cashAdvance.findMany({ where: { status: { in: ["REQUESTED", "APPROVED"] } }, include: { requestedBy: { select: { name: true } } } });
  for (const c of advances) {
    await make("FUND_REQUEST", c.id, async (tx) => {
      const it = await arriveItem(tx, {
        kind: "FUND_REQUEST", subjectId: c.id, role: "FIN", branchId: c.branchId, poolKey: c.fundsTypeCode, label: `${c.number}: ${c.fundsTypeName} for ${c.requestedBy.name}`,
        measure: "WAITING", targetKey: "P3_CA_RELEASE", at: c.createdAt,
      });
      if (c.status === "APPROVED" && c.approvedById) await tx.workItem.update({ where: { id: it.id }, data: { state: "HELD", holderUserId: c.approvedById, acceptedAt: c.approvedAt ?? c.createdAt } });
      return it;
    }, c.status === "APPROVED" && !c.approvedAt);
  }
  return counts;
}
