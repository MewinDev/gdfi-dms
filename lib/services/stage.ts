import type { Tx } from "@/lib/db";
import { writeAudit, SYSTEM_ACTOR } from "@/lib/audit";
import { computeStage } from "@/lib/workflow/stage";
import { fundsDone, fundsStatus } from "@/lib/funds/rules";

/** Recomputes the cached Loan.stage from its transactions. Called inside every write transaction. */
export async function recomputeStage(tx: Tx, loanId: string, opts: { simulated?: boolean } = {}) {
  const loan = await tx.loan.findUniqueOrThrow({
    where: { id: loanId },
    select: {
      id: true, pn: true, stage: true, closedAt: true, cancelledAt: true, archivedAt: true, disposedAt: true,
      transactions: { select: { status: true, fundsNeeded: true, type: { select: { requiresDp: true } }, advanceLines: { select: { denied: true, releasedCents: true, advance: { select: { status: true } } } } } },
      // A paper marked Missing (not in hand) does not hold the file at the vault gate: the file goes on
      // "Complete with exceptions" (lib/services/papers.ts) until the paper is Received.
      // Written as an OR, not NOT(missingState = MISSING): SQL NOT on a NULL missingState (every normal
      // paper) is NULL, which dropped every paper, so a loan never showed In transit to Vault or In Safekeeping.
      documents: {
        where: { documentId: { not: null }, OR: [{ checkId: null }, { check: { is: { OR: [{ missingState: null }, { missingState: { not: "MISSING" } }] } } }] },
        select: { stage: true },
      },
    },
  });
  const stage = computeStage({
    transactions: loan.transactions.map((t) => ({ status: t.status, requiresDp: t.type.requiresDp })),
    fundsOpen: loan.transactions.some((t) => t.status !== "CANCELLED" && !fundsDone(fundsStatus(t.fundsNeeded, t.advanceLines.map((l) => ({ denied: l.denied, releasedCents: l.releasedCents, advanceStatus: l.advance.status }))))),
    documentStages: loan.documents.map((d) => d.stage),
    closedAt: loan.closedAt,
    cancelledAt: loan.cancelledAt,
    archivedAt: loan.archivedAt,
    disposedAt: loan.disposedAt,
  });
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
