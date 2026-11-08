import "server-only";
import { prisma, type Tx } from "@/lib/db";
import type { Proposed } from "@/lib/myloans/changes";
import type { TransactionCode } from "@/lib/rules";

/**
 * While a MyLoans review item is open: what is blocked. Never because MyLoans did not answer.
 * (Kept apart from source-sync so Send and cash requests can ask without an import cycle.)
 */
export const CANCELLED_REASON = "MyLoans says this loan is cancelled. Admin is reviewing.";
export const CHANGED_REASON = "MyLoans changed this loan. Admin is reviewing.";

/** Why Send is blocked for this transaction now, or null. */
export async function sendBlockReason(db: Tx | typeof prisma, loanId: string, txnCode: string): Promise<string | null> {
  const loan = await db.loan.findUnique({ where: { id: loanId }, select: { cancelledAt: true, cancelReason: true } });
  if (loan?.cancelledAt) return `This loan was closed: ${loan.cancelReason ?? "Cancelled in MyLoans"}.`;
  const item = await db.sourceChange.findFirst({ where: { loanId, state: "OPEN" } });
  if (!item) return null;
  if (item.category !== "MATERIAL") return CANCELLED_REASON;
  const p = item.proposed as unknown as Proposed;
  const reached = p.needsPicks || !p.ruleNext || p.removed.includes(txnCode as TransactionCode);
  return reached ? CHANGED_REASON : null;
}

/** Why a new cash request for this loan is blocked now, or null. */
export async function cashBlockReason(db: Tx | typeof prisma, loanId: string): Promise<string | null> {
  const loan = await db.loan.findUnique({ where: { id: loanId }, select: { cancelledAt: true, cancelReason: true } });
  if (loan?.cancelledAt) return `This loan was closed: ${loan.cancelReason ?? "Cancelled in MyLoans"}.`;
  const item = await db.sourceChange.findFirst({ where: { loanId, state: "OPEN", category: { in: ["STATUS", "REPLACEMENT"] } } });
  return item ? CANCELLED_REASON : null;
}

