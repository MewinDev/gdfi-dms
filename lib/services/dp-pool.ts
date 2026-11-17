import "server-only";
import { prisma, withLoanLock } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { can, inScope, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { andWhere } from "@/lib/auth/holders";
import { worksAtWhere } from "@/lib/branches/access";
import { businessDate, fmtDate } from "@/lib/time";
import { isAway } from "@/lib/work/rules";
import { onLeaveToday } from "@/lib/monitoring/rules";
import { acceptCore, loadAssignment, whoOf } from "./jobs";
import { createAssignmentTx, evaluateChecklist } from "./workflow";
import { acceptItemTx, arriveItem, closeItem, openItem } from "./work-items";
import { recomputeStage } from "./stage";
import { assertNotHeld } from "./locks";
import { UserError } from "./errors";

/**
 * The Branch DP pool (D-046 item 6). A pool job waits as an inbox item holding the send details. Accept creates
 * the normal named job for that processor and accepts it in the same moment, so everything after works as today.
 * The first accept wins (the loan lock and the item's conditional take); the next one is told who has it.
 */
interface SendInput {
  dpBranchId: string; ltoOfficeId: string | null; fundsNeeded: "YES" | "NO"; fundsKinds: string[];
  beyond: string | null; byId: string; byName: string; recommendedId: string | null;
}

export async function acceptFromPool(u: CurrentUser, itemId: string, now: Date = new Date()): Promise<string> {
  if (!can(u, PERMISSIONS.JOBS_WORK)) throw new UserError("Your role does not allow working on jobs.");
  const it0 = await prisma.workItem.findUnique({ where: { id: itemId } });
  if (!it0 || it0.kind !== "DP_JOB" || !it0.loanId) throw new UserError("This item is no longer open. Refresh the page.");
  const me = await prisma.user.findFirst({ where: andWhere({ id: u.id, active: true }, worksAtWhere(it0.branchId)), select: { id: true, dpOnLeave: true, dpLeaveUntil: true, awayFrom: true, awayTo: true } });
  if (!me) throw new UserError("This job is in another branch's pool.");
  const today = businessDate(now);
  if (onLeaveToday(me, today) || isAway(me, today)) throw new UserError("You are marked away or on leave today. Clear it first, or leave the job for another processor.");
  return withLoanLock(it0.loanId, async (tx) => {
    await assertNotHeld(tx, it0.subjectId);
    const before = await tx.workItem.findUniqueOrThrow({ where: { id: it0.id } });
    const it = await acceptItemTx(tx, it0.id, u, now); // the race is decided here
    if (before.state === "HELD") {
      const job = await tx.dpAssignment.findFirst({ where: { transactionId: it.subjectId, dpUserId: u.id, status: "ACCEPTED" } });
      if (job) return job.id; // a double tap
    }
    const s = it.sendInput as unknown as SendInput | null;
    if (!s) throw new UserError("This item is no longer open. Refresh the page.");
    const t0 = await tx.loanTransaction.findUniqueOrThrow({ where: { id: it.subjectId }, include: { type: true, documents: true, loan: { include: { branch: true } } } });
    if (t0.status !== "ASSIGNED") throw new UserError("This job is no longer waiting in the pool. Refresh the page.");
    const [dpBranch, lto, recommended, sender] = await Promise.all([
      tx.branch.findUniqueOrThrow({ where: { id: s.dpBranchId }, select: { id: true, name: true } }),
      s.ltoOfficeId ? tx.ltoOffice.findUnique({ where: { id: s.ltoOfficeId }, select: { id: true, name: true } }) : null,
      s.recommendedId ? tx.user.findUnique({ where: { id: s.recommendedId }, select: { id: true, name: true } }) : null,
      tx.user.findUnique({ where: { id: s.byId }, select: { id: true, name: true } }),
    ]);
    const job = await createAssignmentTx(tx, {
      t0, txn: t0, dpBranch, dp: { id: u.id, name: u.name }, secondary: null, lto,
      input: { fundsNeeded: s.fundsNeeded, pasuyo: false, pasuyoReason: null }, fundsKinds: s.fundsKinds, beyond: s.beyond, recommended,
      by: { id: sender?.id ?? s.byId, label: sender?.name ?? s.byName }, now, fromPool: true,
    });
    await acceptCore(tx, await loadAssignment(tx, job.id), whoOf(u));
    return job.id;
  });
}

/** The LA takes a job back from the pool before anyone accepts it (the same as Pull back for a named processor). */
export async function takeBackFromPool(u: CurrentUser, transactionId: string, reason: string, now: Date = new Date()) {
  if (!can(u, PERMISSIONS.DP_SEND)) throw new UserError("Your role does not allow sending to a processor.");
  if (reason.trim().length < 3) throw new UserError("Say why you take it back (at least 3 characters).", "reason");
  const t = await prisma.loanTransaction.findUnique({ where: { id: transactionId }, include: { type: true, loan: true } });
  if (!t || !inScope(u, t.loan.branchId)) throw new UserError("Transaction not found.");
  await withLoanLock(t.loanId, async (tx) => {
    await assertNotHeld(tx, t.id);
    const it = await openItem(tx, "DP_JOB", t.id);
    if (!it || it.state !== "POOL") {
      const job = await tx.dpAssignment.findFirst({ where: { transactionId: t.id, status: { in: ["PENDING_ACCEPTANCE", "ACCEPTED"] } }, include: { dpUser: { select: { name: true } } } });
      throw new UserError(job ? `${job.dpUser.name} already accepted it from the pool.` : "It is no longer in the pool. Refresh the page.");
    }
    const by = { id: u.id, label: u.name };
    await closeItem(tx, "DP_JOB", t.id, "PULLED_BACK", { at: now, by, remarks: reason.trim() });
    await arriveItem(tx, { kind: "TRANSACTION", subjectId: t.id, role: "LA", branchId: t.loan.branchId, loanId: t.loanId, pn: t.loan.pn, label: `${t.loan.pn}: ${t.type.name}`, holderUserId: u.id, accepted: true, targetKey: "P3_ASSIGN", at: now, by });
    const checks = await tx.checklistCheck.findMany({ where: { transactionId: t.id }, include: { rule: true } });
    await tx.loanTransaction.update({ where: { id: t.id }, data: { status: evaluateChecklist(checks).complete ? "READY" : "FOR_CHECKLIST" } });
    await writeAudit(tx, { actor: by, mode: "MANUAL", action: "taken_back_from_dp_pool", entityType: "LoanTransaction", entityId: t.id, loanId: t.loanId, pn: t.loan.pn, summary: `Took ${t.type.name} back from the DP pool: ${reason.trim()}` });
    await recomputeStage(tx, t.loanId);
  });
}

/** The loan file's line for a transaction waiting in the pool (null when it is not there). */
export async function poolLine(transactionId: string): Promise<string | null> {
  const it = await openItem(prisma, "DP_JOB", transactionId);
  if (!it || it.state !== "POOL") return null;
  const b = await prisma.branch.findUnique({ where: { id: it.branchId }, select: { name: true } });
  return `In the ${b?.name ?? ""} DP pool since ${fmtDate(businessDate(it.arrivedAt))}. The first processor of ${b?.name ?? "the branch"} to accept it gets it.`;
}

