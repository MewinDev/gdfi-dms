import "server-only";
import { prisma, type Tx } from "@/lib/db";
import { financeLockedMessage, lockedMessage } from "@/lib/ui/holds";
import { UserError } from "./errors";

/**
 * The hold lock: while a transaction is on hold nobody can change it (papers, send, pull back,
 * update, notes, funds, the processor's steps, decline and return) until the person who put it on
 * hold resumes it. Per transaction: the other transactions of the loan keep working. Allowed while
 * held: viewing, Resume and "Add details" (both the holder only, see holds.ts). Refusals are not
 * logged. The TAT clock keeps counting.
 */
export async function assertNotHeld(db: Tx | typeof prisma, transactionId: string) {
  const h = await db.hold.findFirst({ where: { transactionId, resumedAt: null }, select: { raisedByLabel: true, raisedAt: true, ownerLabel: true } });
  if (h) throw new UserError(lockedMessage(h.raisedByLabel, h.raisedAt, h.ownerLabel));
}

/**
 * Finance actions that put cash to work on a held transaction are refused: request, approve, release,
 * top-up and carry-over. Settling money already out (receipts, returns, liquidation, close,
 * exceptions) stays allowed. "Locked: on hold by {name} since {date and time}."
 */
export async function assertFundsNotHeld(db: Tx | typeof prisma, transactionIds: (string | null | undefined)[]) {
  const ids = [...new Set(transactionIds.filter((x): x is string => !!x))];
  if (!ids.length) return;
  const h = await db.hold.findFirst({ where: { transactionId: { in: ids }, resumedAt: null }, select: { raisedByLabel: true, raisedAt: true } });
  if (h) throw new UserError(financeLockedMessage(h.raisedByLabel, h.raisedAt));
}
