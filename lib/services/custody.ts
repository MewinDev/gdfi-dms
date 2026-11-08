import type { Tx } from "@/lib/db";

/** Who did a movement: the person (id when it is a real user) and the name as shown. */
export interface MoveBy {
  id: string | null;
  label: string;
}

/**
 * Moves document items to a new custodian/location and writes one movement per item (append-only).
 * When `to.custodian` is set the receiver takes custody now (acknowledged by `by`); otherwise the
 * papers are in transit and the sender stays accountable until the receiver acknowledges.
 */
export async function moveDocs(
  tx: Tx,
  docs: { id: string; custodianLabel: string }[],
  to: { stage: "WITH_DP" | "AT_BRANCH" | "IN_TRANSIT"; custodian: string | null; role: string; userId: string | null; location: string; action: string },
  opts: { simulated?: boolean; by?: MoveBy | null } = {},
) {
  const now = new Date();
  for (const d of docs) {
    // In transit: custody (and accountability) stays with the sender until the receiver acknowledges.
    const custodianLabel = to.custodian ?? d.custodianLabel;
    await tx.documentItem.update({
      where: { id: d.id },
      data: { stage: to.stage, custodianLabel, ...(to.custodian ? { custodianRole: to.role, custodianUserId: to.userId } : {}), location: to.location, since: now },
    });
    await tx.documentMovement.create({
      data: {
        documentItemId: d.id, action: to.action, fromCustodian: d.custodianLabel, toCustodian: to.custodian ?? to.location,
        actorId: opts.by?.id ?? null, actorLabel: opts.by?.label ?? null, location: to.location,
        acknowledgedAt: to.custodian ? now : null, acknowledgedById: to.custodian ? (opts.by?.id ?? null) : null,
        simulated: !!opts.simulated,
      },
    });
  }
}

/** A movement that does not change the holder (label printed, at the LTO, passed to a second processor). */
export async function noteDocs(
  tx: Tx,
  docs: { id: string; custodianLabel: string; location?: string }[],
  m: { action: string; location?: string; remarks?: string; by?: MoveBy | null; simulated?: boolean },
) {
  for (const d of docs) {
    await tx.documentMovement.create({
      data: {
        documentItemId: d.id, action: m.action, fromCustodian: d.custodianLabel, toCustodian: d.custodianLabel,
        location: m.location ?? d.location ?? null, remarks: m.remarks ?? null,
        actorId: m.by?.id ?? null, actorLabel: m.by?.label ?? null, simulated: !!m.simulated,
      },
    });
  }
}
