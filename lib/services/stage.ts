import type { Tx } from "@/lib/db";
import { writeAudit, SYSTEM_ACTOR } from "@/lib/audit";
import { computeStage } from "@/lib/workflow/stage";
import { fundsDone, fundsStatus } from "@/lib/funds/rules";
import { tierOf } from "@/lib/myloans/tiers";

/** Recomputes the cached Loan.stage from its transactions. Called inside every write transaction. */
export async function recomputeStage(tx: Tx, loanId: string, opts: { simulated?: boolean } = {}) {
  const loan = await tx.loan.findUniqueOrThrow({
    where: { id: loanId },
    select: {
      id: true, pn: true, stage: true, closedAt: true, cancelledAt: true, archivedAt: true, disposedAt: true, syncTier: true,
      transactions: { select: { status: true, fundsNeeded: true, type: { select: { requiresDp: true } }, advanceLines: { select: { denied: true, releasedCents: true, advance: { select: { status: true } } } } } },
      // A paper marked Missing (not in hand) does not hold the file at the vault gate: the file goes on
      // "Complete with exceptions" (lib/services/papers.ts) until the paper is Received.
      documents: { where: { documentId: { not: null }, NOT: { check: { is: { missingState: "MISSING" } } } }, select: { stage: true } },
    },
  });
  // Cash out: an advance released and not yet settled.
  const cashOut = loan.transactions.some((t) => t.advanceLines.some((l) => ["RELEASED", "FOR_LIQUIDATION", "PARTIALLY_LIQUIDATED"].includes(l.advance.status)));
  const stage = computeStage({
    transactions: loan.transactions.map((t) => ({ status: t.status, requiresDp: t.type.requiresDp })),
    fundsOpen: loan.transactions.some((t) => t.status !== "CANCELLED" && !fundsDone(fundsStatus(t.fundsNeeded, t.advanceLines.map((l) => ({ denied: l.denied, releasedCents: l.releasedCents, advanceStatus: l.advance.status }))))),
    documentStages: loan.documents.map((d) => d.stage),
    closedAt: loan.closedAt,
    cancelledAt: loan.cancelledAt,
    archivedAt: loan.archivedAt,
    disposedAt: loan.disposedAt,
  });
  // MyLoans polling tier follows the work (closed and cancelled: never checked again). A new tier is checked at the next run.
  const tier = tierOf(stage, { cancelled: !!loan.cancelledAt, closed: !!loan.closedAt, cashOut });
  if (tier !== loan.syncTier) await tx.loan.update({ where: { id: loanId }, data: { syncTier: tier, nextCheckAt: tier ? new Date() : null } });
  if (stage !== loan.stage) {
    await tx.loan.update({ where: { id: loanId }, data: { stage, stageSince: new Date() } });
    await writeAudit(tx, {
      actor: SYSTEM_ACTOR,
      mode: opts.simulated ? "SIMULATED" : "AUTOMATIC",
      action: "stage_changed",
      entityType: "Loan",
      entityId: loanId,
      loanId,
      pn: loan.pn,
      journeyStep: stage === "For Vault Transmittal" ? "5.3" : null,
      summary: `Stage changed from ${loan.stage} to ${stage}`,
      before: { stage: loan.stage },
      after: { stage },
    });
  }
  return stage;
}
