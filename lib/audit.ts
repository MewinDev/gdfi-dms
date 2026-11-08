import type { Prisma } from "@prisma/client";
import type { Tx } from "@/lib/db";

export interface Actor {
  id: string | null;
  label: string;
}

export const SYSTEM_ACTOR: Actor = { id: null, label: "System" };

export interface AuditEntry {
  actor: Actor;
  mode: "AUTOMATIC" | "MANUAL" | "SIMULATED";
  action: string;
  entityType: string;
  entityId?: string | null;
  loanId?: string | null;
  pn?: string | null;
  journeyStep?: string | null;
  summary: string;
  before?: unknown;
  after?: unknown;
  details?: unknown;
}

const json = (v: unknown) => (v === undefined || v === null ? undefined : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue));

/** Writes one audit row. Always called with the transaction client of the change it records. */
export async function writeAudit(tx: Tx, e: AuditEntry) {
  await tx.auditLog.create({
    data: {
      actorId: e.actor.id,
      actorLabel: e.actor.label,
      mode: e.mode,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId ?? null,
      loanId: e.loanId ?? null,
      pn: e.pn ?? null,
      journeyStep: e.journeyStep ?? null,
      summary: e.summary,
      before: json(e.before),
      after: json(e.after),
      details: json(e.details),
    },
  });
}
