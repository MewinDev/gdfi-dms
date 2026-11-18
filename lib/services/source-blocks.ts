import "server-only";
import { prisma, type Tx } from "@/lib/db";
import type { TransactionCode } from "@/lib/rules";
import { STATUS_WORDS, type FeedStateWord } from "@/lib/open-items/fields";

/**
 * While an Open Item is pending (piece 8, D-013, D-053): what is blocked. Never because myloans did not answer.
 *  - The loan left Released in myloans (Cancelled, Inactive, NotReleased, Superseded / replaced): Send, Forward and
 *    new cash wait until an approver decides the status item.
 *  - Loan type, amount, product or release date changed: Send waits only for the transactions the change reaches.
 * (Kept apart from the services so Send, Forward and cash requests can ask without an import cycle.)
 */
export const CHANGED_REASON = "myloans changed this loan. An approver decides the Open Item first.";
export const endedText = (state: FeedStateWord, rep: string | null) =>
  `myloans says this loan is no longer released (${STATUS_WORDS[state].toLowerCase()}${rep ? `: replaced by ${rep}` : ""}). Send, Forward and new cash wait until an approver decides the Open Item.`;
/** Kept for older callers: the words for a loan that left Released. */
export const CANCELLED_REASON = endedText("Cancelled", null);

async function closedOrEnded(db: Tx | typeof prisma, loanId: string): Promise<string | null> {
  const loan = await db.loan.findUnique({ where: { id: loanId }, select: { cancelledAt: true, cancelReason: true } });
  if (loan?.cancelledAt) return `This loan was closed: ${loan.cancelReason ?? "Cancelled in MyLoans"}.`;
  const st = await db.openItem.findFirst({ where: { loanId, field: "status", status: "PENDING" }, select: { newRaw: true } });
  if (!st) return null;
  const raw = (st.newRaw ?? {}) as { state?: FeedStateWord; replacedByPn?: string | null };
  return endedText(raw.state ?? "NotReleased", raw.replacedByPn ?? null);
}

/** Why Send is blocked for this transaction now, or null. */
export async function sendBlockReason(db: Tx | typeof prisma, loanId: string, txnCode: string): Promise<string | null> {
  const ended = await closedOrEnded(db, loanId);
  if (ended) return ended;
  // Borrower and branch items never block Send; the rule group blocks the transactions it reaches.
  if (!(await db.openItem.count({ where: { loanId, groupKey: "rules", status: "PENDING" } }))) return null;
  const { ruleGroupEffect } = await import("./open-items");
  const p = await ruleGroupEffect(loanId);
  if (!p) return null;
  return p.needsPicks || !p.ruleNext || p.removed.includes(txnCode as TransactionCode) ? CHANGED_REASON : null;
}

/** Why Forward (the processor's Forward to branch) is blocked now, or null (D-053). */
export async function forwardBlockReason(db: Tx | typeof prisma, loanId: string): Promise<string | null> {
  const loan = await db.loan.findUnique({ where: { id: loanId }, select: { cancelledAt: true } });
  return loan?.cancelledAt ? null : closedOrEnded(db, loanId); // a closed loan's papers still go back to the branch
}

/** Why a new cash request for this loan is blocked now, or null. */
export async function cashBlockReason(db: Tx | typeof prisma, loanId: string): Promise<string | null> {
  return closedOrEnded(db, loanId);
}

/** The loan file's banner: why the loan cannot move on now (null when it can). */
export async function loanBlockedReason(db: Tx | typeof prisma, loanId: string): Promise<string | null> {
  const loan = await db.loan.findUnique({ where: { id: loanId }, select: { cancelledAt: true } });
  if (loan?.cancelledAt) return null; // the closed banner already says it
  return closedOrEnded(db, loanId);
}
