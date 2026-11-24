import "server-only";
import { z } from "zod";
import { prisma, withLoanLock, type Tx } from "@/lib/db";
import { writeAudit, type Actor } from "@/lib/audit";
import { notify, branchLaUserIds } from "@/lib/notify";
import { can, inScope, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { advanceBalance, peso } from "@/lib/funds/rules";
import { closeItem } from "./work-items";
import { refreshLiquidationForTransaction } from "./liquidation";
import { handlersOrAdmins } from "./funds-handlers";
import { recomputeStage } from "./stage";
import { NotInScopeError, UserError } from "./errors";

/**
 * Cancel a transaction (D-056 item 2): the tick "Cancel a transaction" (LA Supervisor/Head and Admin by default), a
 * reason of 5 to 500 characters, logged. Open processor jobs stop and the processor is told; its work items close.
 * Cash already released for it stays owed: liquidation is due N working days after the later of the last LTO pickup
 * and the cancellation (D-044 item 2). Cash asked for but not released yet is left for Finance to decide.
 */

const OPEN_JOB = ["PENDING_ACCEPTANCE", "ACCEPTED"] as const;
const NOT_RELEASED = ["REQUESTED", "APPROVED"];
const RELEASED = ["RELEASED", "FOR_LIQUIDATION", "PARTIALLY_LIQUIDATED"];

export const cancelSchema = z.object({
  transactionId: z.string().min(1),
  reason: z.string().trim().min(5, "Say why, in 5 to 500 characters.").max(500, "Keep the reason under 500 characters."),
});

export interface CashOnCancel { number: string; cents: number; released: boolean; dueDays: number; dp: string }

/** The cash tied to a transaction: released and still owed (balance), and asked for but not released yet. */
async function cashFor(db: Tx | typeof prisma, transactionId: string): Promise<CashOnCancel[]> {
  const lines = await db.cashAdvanceLine.findMany({
    where: { transactionId, denied: false, advance: { status: { in: [...NOT_RELEASED, ...RELEASED] as never } } },
    include: { advance: { include: { fundsType: true, requestedBy: { select: { name: true } } } }, receipts: true, returns: true },
  });
  const out: CashOnCancel[] = [];
  for (const l of lines) {
    const released = RELEASED.includes(l.advance.status);
    const cents = released
      ? advanceBalance({ releasedCents: l.releasedCents, receiptCents: l.receipts.reduce((s, r) => s + r.cents, 0), returnedCents: l.returns.reduce((s, r) => s + r.cents, 0) })
      : l.approvedCents ?? l.requestedCents;
    if (cents > 0) out.push({ number: l.advance.number, cents, released, dueDays: l.advance.fundsType?.liquidationDueDays ?? 2, dp: l.advance.requestedBy.name });
  }
  return out;
}

/** The confirm step's words about the cash (D-056: "show that on the confirm step"). */
export function cashWords(cash: CashOnCancel[]): string[] {
  return cash.map((c) => c.released
    ? `${c.number}: ${peso(c.cents)} released to ${c.dp} stays owed. It must be liquidated within ${c.dueDays} working day${c.dueDays === 1 ? "" : "s"} after the cancellation (or the last LTO pickup, if later).`
    : `${c.number}: ${peso(c.cents)} asked for and not released yet. Finance decides it (deny it, or release it to be liquidated).`);
}

async function loadInScope(user: CurrentUser, transactionId: string) {
  const t = await prisma.loanTransaction.findUnique({ where: { id: transactionId }, include: { type: true, loan: true } });
  if (!t || !inScope(user, t.loan.branchId)) throw new NotInScopeError();
  return t;
}

/** What the confirm step shows before cancelling. */
export async function cancelPreview(user: CurrentUser, transactionId: string) {
  if (!can(user, PERMISSIONS.TXN_CANCEL)) throw new UserError("Your role does not allow cancelling transactions.");
  const t = await loadInScope(user, transactionId);
  const jobs = await prisma.dpAssignment.findMany({ where: { transactionId, status: { in: [...OPEN_JOB] } }, include: { dpUser: { select: { name: true } } } });
  const cash = await cashFor(prisma, transactionId);
  return { name: t.type.name, pn: t.loan.pn, jobs: jobs.map((j) => j.dpUser.name), cash, words: cashWords(cash) };
}

export async function cancelTransaction(user: CurrentUser, raw: unknown, now: Date = new Date()): Promise<string> {
  if (!can(user, PERMISSIONS.TXN_CANCEL)) throw new UserError("Your role does not allow cancelling transactions.");
  const p = cancelSchema.safeParse(raw);
  if (!p.success) { const i = p.error.issues[0]; throw new UserError(i.message, String(i.path[0] ?? "")); }
  const t0 = await loadInScope(user, p.data.transactionId);
  const actor: Actor = { id: user.id, label: user.name };
  return withLoanLock(t0.loanId, async (tx) => {
    const t = await tx.loanTransaction.findUniqueOrThrow({ where: { id: t0.id }, include: { type: true, loan: true } });
    if (t.status === "CANCELLED") throw new UserError(`${t.type.name} is already cancelled.`);
    if (t.status === "COMPLETED") throw new UserError(`${t.type.name} is already done and cannot be cancelled.`);
    const reason = p.data.reason;
    const jobs = await tx.dpAssignment.findMany({ where: { transactionId: t.id, status: { in: [...OPEN_JOB] } } });
    for (const j of jobs) await tx.dpAssignment.update({ where: { id: j.id }, data: { status: "PULLED_BACK", closedAt: now } });
    await tx.loanTransaction.update({ where: { id: t.id }, data: { status: "CANCELLED", statusSince: now, cancelledAt: now, cancelReason: reason } });
    await refreshLiquidationForTransaction(tx, t.id, now); // cancelled before its LTO: D-044 item 2
    for (const k of ["TRANSACTION", "DP_JOB"] as const) await closeItem(tx, k, t.id, "CANCELLED", { at: now, by: actor });
    const cash = await cashFor(tx, t.id);
    const words = cashWords(cash);
    await writeAudit(tx, {
      actor, mode: "MANUAL", action: "transaction_cancelled", entityType: "LoanTransaction", entityId: t.id, loanId: t.loanId, pn: t.loan.pn,
      summary: `${user.name} cancelled ${t.type.name}: ${reason}${jobs.length ? `. Processor job stopped` : ""}${words.length ? `. ${words.join(" ")}` : ""}`,
      before: { status: t.status }, after: { status: "CANCELLED" }, details: { reason, cash },
    });
    for (const j of jobs) {
      await notify(tx, {
        userIds: [j.dpUserId, ...(j.secondaryDpUserId ? [j.secondaryDpUserId] : [])], loanId: t.loanId, title: `${t.loan.pn}: ${t.type.name} cancelled`,
        body: `${user.name} cancelled it: ${reason}. Stop work on it and keep the papers safe; the Loan Associate will collect them.${words.length ? ` ${words.join(" ")}` : ""}`, link: "/jobs",
        email: { event: "job_changed", transactionId: t.id, vars: { pn: t.loan.pn, transaction: t.type.name, who: user.name, reason: `Cancelled: ${reason}` } },
      });
    }
    await notify(tx, { userIds: (await branchLaUserIds(tx, t.loan.branchId)).filter((id) => id !== user.id), loanId: t.loanId, title: `${t.loan.pn}: ${t.type.name} cancelled`, body: `${user.name} cancelled it: ${reason}`, link: `/loans/${t.loan.pn}` });
    // Finance hears about cash tied to it (the handlers of the type and branch).
    const advances = await tx.cashAdvance.findMany({ where: { number: { in: cash.map((c) => c.number) } }, select: { number: true, fundsTypeId: true, branchId: true } });
    for (const a of advances) {
      const ids = await handlersOrAdmins(tx, "settle", { fundsTypeId: a.fundsTypeId ?? undefined }, [a.branchId]);
      await notify(tx, { userIds: ids, title: `${a.number}: ${t.type.name} cancelled`, body: `${t.loan.pn}: ${words.find((w) => w.startsWith(a.number)) ?? ""}`, link: "/funds" });
    }
    await recomputeStage(tx, t.loanId);
    return `${t.type.name} cancelled.${words.length ? ` ${words.join(" ")}` : ""}`;
  });
}
